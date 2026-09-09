import Phaser from "phaser";
import { generateTextures } from "../objects/TextureFactory.ts";
import { AlgoraZone } from "../zones/AlgoraZone.ts";
import { AOZone } from "../zones/AOZone.ts";
import { BridgeZone } from "../zones/BridgeZone.ts";
import { CentralMonitor } from "../zones/CentralMonitor.ts";
import { DataBridge } from "../services/data-bridge.ts";
import { EcosystemFeed } from "../services/ecosystem-feed.ts";
import { HubMap } from "../zones/HubMap.ts";
import { setConnectionStatus, updateSidebar, updateEcosystem } from "../ui/Sidebar.ts";

const W = 1440;
const H = 760;

type ZoneKey = "hub" | "algora" | "ao" | "bridge";

// The map lives below the three service zones so the existing belts keep their
// coordinates. It is the default view: the ecosystem is the subject, and a belt
// is the detail you open for the two services that actually stream.
const MAP_Y = H + 40;   // just below the three service zones
// Matches the camera's aspect so the fitted view fills it, instead of leaving
// the map shrunk to a fraction of the screen with everything illegible.
const MAP_H = 760;

const ZONE_VIEWS: Record<ZoneKey, { x: number; y: number; w: number; h: number }> = {
    hub:     { x: 0,   y: MAP_Y, w: W,   h: MAP_H },
    algora:  { x: 0,   y: 30,  w: 640, h: 410 },
    ao:      { x: 640,  y: 30,  w: 800, h: 410 },
    bridge:  { x: 0,   y: 430, w: 600, h: 330 },
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

        // mobile: zoom into one zone at a time (zone tabs drive the camera).
        // Register the tab listener unconditionally so it is never a dead
        // control; the handler no-ops on desktop widths.
        this.zoneSwitchHandler = ((e: Event) => {
            if (window.innerWidth >= 768) return;
            const zone = (e as CustomEvent).detail?.zone as ZoneKey;
            if (zone) this.switchZone(zone, true);
        }) as EventListener;
        document.addEventListener("zone-switch", this.zoneSwitchHandler);

        this.resizeHandler = () => {
            if (window.innerWidth < 768) this.switchZone(this.currentZone, false);
        };
        this.scale.on("resize", this.resizeHandler);

        this.switchZone("hub", false);

        // Tear down listeners + polling when the scene stops (HMR / restart).
        this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
        this.events.once(Phaser.Scenes.Events.DESTROY, () => this.teardown());
    }

    private teardown(): void {
        if (this.zoneSwitchHandler) document.removeEventListener("zone-switch", this.zoneSwitchHandler);
        if (this.resizeHandler) this.scale.off("resize", this.resizeHandler);
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
        const v = ZONE_VIEWS[zone];
        const cam = this.cameras.main;
        const zoom = Math.min(cam.width / v.w, cam.height / v.h) * 0.88;
        const cx = v.x + v.w / 2;
        const cy = v.y + v.h / 2;

        // Honor reduced-motion: jump the camera instead of animating the pan/zoom.
        if (animate && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            animate = false;
        }

        if (animate) {
            cam.pan(cx, cy, 300, "Sine.easeInOut");
            cam.zoomTo(zoom, 300, "Sine.easeInOut");
        } else {
            cam.centerOn(cx, cy);
            cam.setZoom(zoom);
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
