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

export class SpaceHubScene extends Phaser.Scene {
    private algoraZone!: AlgoraZone;
    private aoZone!: AOZone;
    private bridgeZone!: BridgeZone;
    private centralMonitor!: CentralMonitor;
    private dataBridge!: DataBridge;
    private sidebarTimer = 0;

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
        this.dataBridge.init().then(ok => {
            setConnectionStatus(ok);
        });
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
            updateSidebar(this.dataBridge, {
                algora: {
                    signals: this.algoraZone.signalsProcessed,
                    issues: this.algoraZone.issuesDetected,
                    docs: this.algoraZone.docsProduced,
                },
                ao: {
                    ideas: this.aoZone.totalIdeas,
                    plans: this.aoZone.totalPlans,
                    projects: this.aoZone.totalProjects,
                },
                bridge: {
                    proposals: this.bridgeZone.proposalCount,
                    outcomes: this.bridgeZone.outcomeCount,
                    successRate: this.bridgeZone.successRate,
                },
            });
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
