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

const W = 1440;
const H = 760;

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
    private currentZone: ZoneKey = "hub";
    private zoneSwitchHandler?: EventListener;
    private resizeHandler?: () => void;
    private visibilityHandler?: () => void;

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
        this.ecosystem.init().then(() => {
            updateEcosystem(this.ecosystem);
            this.hubMap.setNodes(this.ecosystem.nodes());
            this.hubMap.setActivity(this.dataBridge.ingested, this.ecosystem.healthCheckedAt);
        });

        // The tab bar drives the camera at every width. This used to no-op above
        // 768px, from when the tabs were hidden outside the mobile breakpoint —
        // once they became visible on desktop, that guard silently made every
        // click dead: the tab highlighted, the event fired, nothing moved.
        this.zoneSwitchHandler = ((e: Event) => {
            const zone = (e as CustomEvent).detail?.zone as ZoneKey;
            if (zone && ZONE_VIEWS[zone]) this.switchZone(zone, true);
        }) as EventListener;
        document.addEventListener("zone-switch", this.zoneSwitchHandler);

        this.resizeHandler = () => {
            if (window.innerWidth < 768) this.switchZone(this.currentZone, false);
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
        this.visibilityHandler = () => {
            if (document.hidden) {
                this.dataBridge.pause();
                this.ecosystem.pause();
            } else {
                this.dataBridge.resume();
                this.ecosystem.resume();
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

    private teardown(): void {
        if (this.zoneSwitchHandler) document.removeEventListener("zone-switch", this.zoneSwitchHandler);
        if (this.resizeHandler) this.scale.off("resize", this.resizeHandler);
        if (this.visibilityHandler) document.removeEventListener("visibilitychange", this.visibilityHandler);
        this.dataBridge?.destroy();
        this.ecosystem?.destroy();
        this.hubMap?.destroy();
    }

    private switchZone(zone: ZoneKey, animate: boolean): void {
        this.currentZone = zone;
        // The map can navigate too, so reflect it in the tab bar.
        document.querySelectorAll<HTMLButtonElement>(".zone-tab").forEach(b => {
            const active = b.dataset.zone === zone;
            b.classList.toggle("active", active);
            b.setAttribute("aria-selected", String(active));
        });
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
        const zoom = zone === "hub"
            ? (Math.min(cam.width, cam.height) / HUB_DIAMETER) * 0.96
            : Math.min(cam.width / v.w, cam.height / v.h) * 0.9;
        const cx = v.x + v.w / 2;
        const cy = v.y + v.h / 2;

        // Honor reduced-motion: jump the camera instead of animating the pan/zoom.
        if (animate && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            animate = false;
        }

        // The map HUD is a DOM overlay pinned over the stage, so it has to be
        // hidden when the camera is showing a belt zone instead.
        this.hubMap?.setHudVisible(zone === "hub");
        this.setBeltGraphicsVisible(zone !== "hub");

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
            updateEcosystem(this.ecosystem);
            // Cheap: HubMap ignores this unless the registry snapshot changed.
            this.hubMap.setNodes(this.ecosystem.nodes());
            // Must follow setNodes, which rebuilds the id->body map a mote spawns
            // from. Both are diffing calls — setActivity emits only on an
            // ingest delta and restarts the sweep only on a new health clock —
            // so re-running them every 500ms costs a comparison and nothing else.
            // Without this the map's two claims about motion being real were
            // simply false: the call existed once, at create(), where it did no
            // more than record the baseline it had nothing to compare against.
            this.hubMap.setActivity(this.dataBridge.ingested, this.ecosystem.healthCheckedAt);
        }
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
