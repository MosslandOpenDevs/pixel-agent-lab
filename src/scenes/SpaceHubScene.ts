import Phaser from "phaser";
import { generateTextures } from "../objects/TextureFactory.ts";
import { AlgoraZone } from "../zones/AlgoraZone.ts";
import { AOZone } from "../zones/AOZone.ts";
import { BridgeZone } from "../zones/BridgeZone.ts";
import { CentralMonitor } from "../zones/CentralMonitor.ts";
import { DataBridge } from "../services/data-bridge.ts";
import { EcosystemFeed } from "../services/ecosystem-feed.ts";
import { HubMap, HUB_DEPTH } from "../zones/HubMap.ts";
import { setConnectionStatus, updateSidebar, updateEcosystem } from "../ui/Sidebar.ts";
import { documentTitle, tallyServices } from "../ui/ecosystem-status.ts";
import { BeltCard, beltCardHtml, type BeltCardInput } from "../ui/belt-card.ts";
import { reducedMotion } from "../ui/motion.ts";
import { syncZoneTabs } from "../ui/zone-tabs.ts";

const W = 1440;
const H = 760;

/** How often a hidden tab re-checks its title (see refreshTitle). It fetches
 *  nothing: it re-reads what the feed already holds against the clock. */
const HIDDEN_TITLE_MS = 15_000;

type ZoneKey = "hub" | "algora" | "ao" | "bridge";

// The map lives below the three service zones so the existing belts keep their
// coordinates. It is the default view: the ecosystem is the subject, and a belt
// is the detail you open for the two services that actually stream.
// Separation only — the hub's own depth band (see HubMap) is what actually
// keeps the belt zones from painting over it, since Phaser depth is global
// and the hub overscans this rectangle by far more than any gap could cover.
const MAP_Y = H + 120;
const MAP_H = 760;
// Outer orbit (376) + label and margin. The hub is fitted by this rather than by
// the map rectangle, so it fills a portrait screen instead of shrinking to fit
// the rectangle's unused width.
const HUB_DIAMETER = 880;

/** On a phone a belt view is framed at the top of the screen, this far down —
 *  clear of the ☰ button — so its text card fits underneath. */
const PHONE_BELT_TOP = 56;
/** The least of the screen that card is left, and the tab bar under it with
 *  its gap (the stylesheet's 58px). A landscape phone is too short for the
 *  zone at full width and a card as well, so there the zone gives way. */
const PHONE_CARD_MIN = 160;
const PHONE_TAB_BAR = 58;

const ZONE_VIEWS: Record<ZoneKey, { x: number; y: number; w: number; h: number }> = {
    hub:     { x: 0,   y: MAP_Y, w: W,   h: MAP_H },
    algora:  { x: 0,   y: 30,  w: 640, h: 410 },
    ao:      { x: 640,  y: 30,  w: 800, h: 410 },
    // Was 600x330, which framed under half the zone and cut off the desktop
    // Trust & Outcomes panel entirely.
    bridge:  { x: 0,   y: 425, w: 1340, h: 340 },
};

export class SpaceHubScene extends Phaser.Scene {
    private algoraZone!: AlgoraZone;
    private aoZone!: AOZone;
    private bridgeZone!: BridgeZone;
    private centralMonitor!: CentralMonitor;
    private dataBridge!: DataBridge;
    private ecosystem!: EcosystemFeed;
    private sidebarTimer = 0;
    private hubMap!: HubMap;
    /** Phones only: the belt views' text, which their canvas cannot show there. */
    private beltCard?: BeltCard;
    private currentZone: ZoneKey = "hub";
    private zoneSwitchHandler?: EventListener;
    private resizeHandler?: () => void;
    private visibilityHandler?: () => void;
    /** index.html's title, which the status prefix is added to and taken off. */
    private baseTitle = "";
    /** Set only while the tab is hidden: the one thing that keeps the title
     *  current then, since no frame runs to do it. */
    private hiddenTitleTimer?: ReturnType<typeof setInterval>;

    constructor() {
        super("SpaceHubScene");
    }

    create(): void {
        generateTextures(this);
        this.drawSpaceBackground();

        // header bar
        this.add.text(W / 2, 16, "MOSSLAND SPACE HUB  |  ecosystem map  \u00b7  live belts for the services that stream", {
            fontFamily: "monospace", fontSize: "10px", color: "#94a3b8",
            backgroundColor: "#0b1226cc", padding: { x: 10, y: 4 },
        }).setOrigin(0.5).setDepth(100);

        // zones (no connection arrows — services are independent)
        this.algoraZone = new AlgoraZone(this);
        this.aoZone = new AOZone(this);
        this.bridgeZone = new BridgeZone(this);
        this.centralMonitor = new CentralMonitor(this);
        this.hubMap = new HubMap(this, W / 2, MAP_Y + MAP_H / 2, W, MAP_H);
        this.hubMap.onOpenZone = zone => this.switchZone(zone as ZoneKey, true);
        // Below the 768px breakpoint, which reloads the app when crossed.
        const stage = document.getElementById("stage");
        if (window.innerWidth < 768 && stage) this.beltCard = new BeltCard(stage);

        this.algoraZone.create();
        this.aoZone.create();
        this.bridgeZone.create();
        this.centralMonitor.create();
        this.hubMap.create();

        // data bridge
        this.dataBridge = new DataBridge();
        this.dataBridge.init().then(state => {
            setConnectionStatus(state);
        });

        // Registry + cross-service health. Separate from DataBridge because it
        // runs on its own far slower cadence (see EcosystemFeed) and is not part
        // of the LIVE/OFFLINE verdict for the three visualized services.
        this.ecosystem = new EcosystemFeed();
        this.baseTitle = document.title;
        this.ecosystem.init().then(() => this.refreshEcosystem());

        // The tab bar drives the camera at every width. This used to no-op above
        // 768px, from when the tabs were hidden outside the mobile breakpoint —
        // once they became visible on desktop, that guard silently made every
        // click dead: the tab highlighted, the event fired, nothing moved.
        this.zoneSwitchHandler = ((e: Event) => {
            const zone = (e as CustomEvent).detail?.zone as ZoneKey;
            if (zone && ZONE_VIEWS[zone]) this.switchZone(zone, true);
        }) as EventListener;
        document.addEventListener("zone-switch", this.zoneSwitchHandler);

        // A phone's camera is the window, so every resize reframes it. On the
        // desktop layouts the canvas is scaled as a whole, and only the map
        // view depends on the window: how far it sits from the legend, whose
        // size is fixed in CSS px (HubMap.viewShift).
        this.resizeHandler = () => {
            if (window.innerWidth < 768 || this.currentZone === "hub") this.switchZone(this.currentZone, false);
        };
        this.scale.on("resize", this.resizeHandler);

        this.switchZone("hub", false);

        // Polling stops while the tab is hidden, and picks up when it is shown:
        // whatever fell due in the meantime is fetched at once, the rest waits
        // out its remaining time. A background tab used to keep every schedule
        // running around the clock for a page nobody could see. Phaser's own
        // visibility handling does not help here — it pauses the game loop,
        // and polling runs on timers of its own. The services take explicit
        // calls because they are DOM-free; this scene owns the document
        // listeners.
        //
        // The paused loop also stops the 500 ms refresh, and with it the page
        // title — the one surface a hidden tab still shows, in the tab strip.
        // So while hidden a title-only timer keeps it current: it fetches
        // nothing, and turns the title stale on the same clock as everything
        // else once the last reading ages past STALE_AFTER_MS — up to
        // HIDDEN_TITLE_MS late, or about a minute once the browser throttles a
        // long-hidden tab's timers. It also picks up a sweep that was in flight
        // at hide and lands after, and init()'s first one in a tab opened in
        // the background.
        this.visibilityHandler = () => {
            if (document.hidden) {
                this.dataBridge.pause();
                this.ecosystem.pause();
                this.hiddenTitleTimer ??= setInterval(() => this.refreshTitle(), HIDDEN_TITLE_MS);
            } else {
                clearInterval(this.hiddenTitleTimer);
                this.hiddenTitleTimer = undefined;
                this.dataBridge.resume();
                this.ecosystem.resume();
                // At once rather than on the next tick: the sweep resume()
                // just started reads "refreshing", which drops the stale prefix.
                this.refreshTitle();
            }
        };
        document.addEventListener("visibilitychange", this.visibilityHandler);
        // A tab opened in the background starts hidden, and no event says so.
        // Its first load still runs, so there is something to show; it is the
        // schedules after it that wait.
        if (document.hidden) this.visibilityHandler();

        // Tear down listeners + polling when the scene stops (HMR / restart).
        this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
        this.events.once(Phaser.Scenes.Events.DESTROY, () => this.teardown());
    }

    /**
     * Everything that shows the registry and its health: the sidebar panel,
     * the map and its HUD, and the page title. All of them are diffing calls
     * — each writes only what changed — so this runs every 500 ms for the
     * price of a comparison, and once more as soon as init() settles.
     */
    private refreshEcosystem(): void {
        const nodes = this.ecosystem.nodes();
        const freshness = this.ecosystem.healthFreshness();
        updateEcosystem(this.ecosystem);
        // Cheap: HubMap rebuilds bodies only when the registry snapshot changed.
        this.hubMap.setNodes(nodes, this.ecosystem.registryState());
        this.hubMap.setHealthStatus(freshness, this.dataBridge.connectionState(), this.dataBridge.serviceUp);
        // Must follow setNodes, which rebuilds the id->body map a mote spawns
        // from. setActivity emits only on an ingest delta and restarts the
        // sweep only on a new health clock. Without this the map's two claims
        // about motion being real were simply false: the call existed once, at
        // create(), where it did no more than record the baseline it had
        // nothing to compare against. The count is newSignals, not ingested:
        // DataBridge leaves each origin's first read out of it, so this
        // counts from zero whatever the timing.
        this.hubMap.setActivity(this.dataBridge.newSignals, this.ecosystem.healthCheckedAt);
        this.refreshTitle(nodes, freshness);
    }

    /**
     * "(1 down) Mossland Space Hub — …" while anything is down or degraded,
     * or the reading is stale, so the tab strip says so. Set only when it
     * changes; restored as soon as it is clear. Runs with the rest of
     * refreshEcosystem while the tab is shown, and on its own timer while it
     * is hidden (see the visibility handler).
     */
    private refreshTitle(nodes = this.ecosystem.nodes(), freshness = this.ecosystem.healthFreshness()): void {
        const title = documentTitle(this.baseTitle,
            this.ecosystem.registryState() === "loaded" ? tallyServices(nodes) : null, freshness);
        if (document.title !== title) document.title = title;
    }

    private teardown(): void {
        clearInterval(this.hiddenTitleTimer);
        this.hiddenTitleTimer = undefined;
        if (this.baseTitle) document.title = this.baseTitle;
        if (this.zoneSwitchHandler) document.removeEventListener("zone-switch", this.zoneSwitchHandler);
        if (this.resizeHandler) this.scale.off("resize", this.resizeHandler);
        if (this.visibilityHandler) document.removeEventListener("visibilitychange", this.visibilityHandler);
        this.dataBridge?.destroy();
        this.ecosystem?.destroy();
        this.hubMap?.destroy();
        this.beltCard?.destroy();
    }

    private switchZone(zone: ZoneKey, animate: boolean): void {
        this.currentZone = zone;
        // The map can navigate too, so reflect it in the tab bar — selection,
        // the roving tabindex, and the stage's label as the tabpanel.
        syncZoneTabs(zone);
        // Bridge stacks Trust & Outcomes under its left belt on phones. Fit
        // that compact layout, otherwise the empty desktop column halves its
        // size and makes the mobile labels unreadable.
        const v = zone === "bridge" && window.innerWidth < 768
            ? { x: 0, y: 480, w: 640, h: 280 }
            : ZONE_VIEWS[zone];
        const cam = this.cameras.main;
        // Fitting a landscape region into a portrait camera by its *limiting*
        // axis shrinks it to a fraction of the screen — on a phone the whole
        // world collapsed into roughly a fifth of the viewport, which is the
        // "circles in the middle and nothing else" report. The hub is radial, so
        // fit its diameter to the camera's smaller axis and let the wide, empty
        // sides crop instead.
        const room = this.beltCard ? cam.height - PHONE_BELT_TOP - PHONE_CARD_MIN - PHONE_TAB_BAR : cam.height;
        const zoom = zone === "hub"
            ? (Math.min(cam.width, cam.height) / HUB_DIAMETER) * 0.96
            : Math.min(cam.width / v.w, Math.max(room, 80) / v.h) * 0.9;
        let cx = v.x + v.w / 2;
        let cy = v.y + v.h / 2;

        // Honor reduced-motion: jump the camera instead of animating the pan/zoom.
        // Read live, like everything else that moves (ui/motion.ts).
        if (animate && reducedMotion()) animate = false;

        // The map HUD is a DOM overlay pinned over the stage, so it has to be
        // hidden when the camera is showing a belt zone instead.
        this.hubMap?.setHudVisible(zone === "hub");
        this.setBeltGraphicsVisible(zone !== "hub");

        // Where the legend is shown, the map sits right of it rather than
        // under it; measured after the HUD is shown, at the zoom about to be
        // used. The camera moves left, so the hub moves right.
        if (zone === "hub") cx -= this.hubMap?.viewShift(zoom) ?? 0;

        // On a phone a belt zone is fitted to the width, which leaves most of
        // a portrait screen empty and its canvas text far too small to read.
        // So the zone goes to the top of the screen and its text goes in a
        // card below it (ui/belt-card.ts).
        if (this.beltCard) {
            let cardTop = 0;
            if (zone !== "hub") {
                const zoneTop = PHONE_BELT_TOP;
                cy += (cam.height / 2 - (zoneTop + (v.h * zoom) / 2)) / zoom;
                cardTop = zoneTop + v.h * zoom + 8;
            }
            this.beltCard.show(zone === "hub" ? null : zone, cardTop);
            this.refreshBeltCard();
        }

        if (animate) {
            // force = true: without it a click landing inside the previous 300ms
            // animation is dropped, while the tab bar still switches — so the
            // control reports success and the view stays put.
            cam.pan(cx, cy, 300, "Sine.easeInOut", true);
            cam.zoomTo(zoom, 300, "Sine.easeInOut", true);
        } else {
            cam.centerOn(cx, cy);
            cam.setZoom(zoom);
        }
    }

    /**
     * Shows or hides the belt zones' Graphics — the zone frames, belts, rings
     * and the CentralMonitor strip.
     *
     * Phaser rebuilds a Graphics' triangles from scratch on every render, arcs
     * at ~100 points each whatever their radius, and it culls nothing by
     * bounds. On the map those belts lie under the hub's opaque backdrop and
     * outside the camera, yet they were tessellated every frame — over a third
     * of the map's frame time, for nothing on screen. Hidden, they are skipped
     * at render.
     *
     * Only on the map. The belt cameras overlap their neighbours — the Bridge
     * view shows the lower halves of Algora and AO, and on a phone the Algora
     * view contains all of Bridge — so in a belt view every zone stays drawn.
     * Their update() keeps running regardless: AlgoraZone's drains the signal
     * queue, and each keeps rebuilding its commands, so a Graphics is current
     * the moment it is shown.
     *
     * Selected by depth, the mirror of HubMap.setMapVisible: everything below
     * the hub's band (HUB_DEPTH, the same constant it selects by) belongs to
     * the belt zones.
     */
    private setBeltGraphicsVisible(visible: boolean): void {
        for (const o of this.children.list) {
            if (o instanceof Phaser.GameObjects.Graphics && o.depth < HUB_DEPTH) o.setVisible(visible);
        }
    }

    update(_time: number, dt: number): void {
        if (!this.dataBridge) return;

        this.algoraZone.update(dt, this.dataBridge);
        this.aoZone.update(dt, this.dataBridge);
        this.bridgeZone.update(dt, this.dataBridge);
        this.centralMonitor.update(dt, this.dataBridge);
        this.hubMap.update(dt);

        // update sidebar every 500ms
        this.sidebarTimer += dt;
        if (this.sidebarTimer > 500) {
            this.sidebarTimer = 0;
            updateSidebar(this.dataBridge);
            this.refreshEcosystem();
            this.refreshBeltCard();
        }
    }

    /**
     * The phone's belt card, for the belt on screen. Writes only what
     * changed. Each card carries its service's LIVE / OFFLINE / CONNECTING
     * state, as the sidebar's Service I/O card does: on a phone that card is
     * in a closed drawer, and nothing else on a belt view says it.
     */
    private refreshBeltCard(): void {
        const zone = this.beltCard?.shownZone;
        if (!this.beltCard || !zone || !this.dataBridge) return;
        const d = this.dataBridge;
        const state = (s: "algora" | "ao" | "bridge") => ({ conn: d.connectionState(), up: d.serviceUp[s] });
        if (zone === "algora") {
            this.beltCard.updateAlgora(this.algoraZone.beltItems(), state("algora"));
            return;
        }
        const input: BeltCardInput = zone === "ao" ? {
            zone, state: state("ao"), debates: d.debateCache, debatesErrored: d.debatesErrored,
            ideas: d.ideaCache, projects: d.aoTotals().projects,
        }
            : { zone: "bridge", state: state("bridge"), trust: d.trustCache, outcomes: d.outcomeCache };
        this.beltCard.update(beltCardHtml(input));
    }

    private drawSpaceBackground(): void {
        // Covers the service zones and the map region below them.
        const worldH = MAP_Y + MAP_H;
        this.add.rectangle(W / 2, worldH / 2, W, worldH, 0x060b1b);
        for (let i = 0; i < 220; i++) {
            const s = this.add.image(
                Phaser.Math.Between(0, W),
                Phaser.Math.Between(0, worldH),
                "star",
            ).setDepth(1);
            s.setScale(Phaser.Math.FloatBetween(0.15, 0.5));
            s.setAlpha(Phaser.Math.FloatBetween(0.15, 0.7));
        }
    }
}
