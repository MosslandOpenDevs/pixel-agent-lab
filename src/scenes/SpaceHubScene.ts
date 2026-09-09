import Phaser from "phaser";
import { generateTextures } from "../objects/TextureFactory.ts";
import { AlgoraZone } from "../zones/AlgoraZone.ts";
import { AOZone } from "../zones/AOZone.ts";
import { BridgeZone } from "../zones/BridgeZone.ts";
import { CentralMonitor } from "../zones/CentralMonitor.ts";
import { DataBridge } from "../services/data-bridge.ts";
import { setConnectionStatus, updateSidebar } from "../ui/Sidebar.ts";

const W = 1440;
const H = 760;

type ZoneKey = "algora" | "ao" | "bridge";

const ZONE_VIEWS: Record<ZoneKey, { x: number; y: number; w: number; h: number }> = {
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
    private sidebarTimer = 0;
    private currentZone: ZoneKey = "algora";
    private zoneSwitchHandler?: EventListener;
    private resizeHandler?: () => void;

    constructor() {
        super("SpaceHubScene");
    }

    create(): void {
        generateTextures(this);
        this.drawSpaceBackground();

        // header bar
        this.add.text(W / 2, 16, "MOSSLAND GOVERNANCE MONITOR  |  Algora (Sense)  \u00b7  AO (Plan)  \u00b7  Bridge (Execute)", {
            fontFamily: "monospace", fontSize: "10px", color: "#94a3b8",
            backgroundColor: "#0b1226cc", padding: { x: 10, y: 4 },
        }).setOrigin(0.5).setDepth(100);

        // zones (no connection arrows — services are independent)
        this.algoraZone = new AlgoraZone(this);
        this.aoZone = new AOZone(this);
        this.bridgeZone = new BridgeZone(this);
        this.centralMonitor = new CentralMonitor(this);

        this.algoraZone.create();
        this.aoZone.create();
        this.bridgeZone.create();
        this.centralMonitor.create();

        // data bridge
        this.dataBridge = new DataBridge();
        this.dataBridge.init().then(state => {
            setConnectionStatus(state);
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

        if (window.innerWidth < 768) this.switchZone("algora", false);

        // Tear down listeners + polling when the scene stops (HMR / restart).
        this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
        this.events.once(Phaser.Scenes.Events.DESTROY, () => this.teardown());
    }

    private teardown(): void {
        if (this.zoneSwitchHandler) document.removeEventListener("zone-switch", this.zoneSwitchHandler);
        if (this.resizeHandler) this.scale.off("resize", this.resizeHandler);
        this.dataBridge?.destroy();
    }

    private switchZone(zone: ZoneKey, animate: boolean): void {
        this.currentZone = zone;
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

        // update sidebar every 500ms
        this.sidebarTimer += dt;
        if (this.sidebarTimer > 500) {
            this.sidebarTimer = 0;
            updateSidebar(this.dataBridge);
        }
    }

    private drawSpaceBackground(): void {
        this.add.rectangle(W / 2, H / 2, W, H, 0x060b1b);
        for (let i = 0; i < 100; i++) {
            const s = this.add.image(
                Phaser.Math.Between(0, W),
                Phaser.Math.Between(0, H),
                "star",
            ).setDepth(1);
            s.setScale(Phaser.Math.FloatBetween(0.15, 0.5));
            s.setAlpha(Phaser.Math.FloatBetween(0.15, 0.7));
        }
    }
}
