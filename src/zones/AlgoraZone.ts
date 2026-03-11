import Phaser from "phaser";
import type { DataBridge } from "../services/data-bridge.ts";

const ZONE_X = 10;
const ZONE_Y = 44;
const ZONE_W = 440;
const ZONE_H = 580;

const STAGES = [
    "Signal Intake",
    "Issue Detection",
    "Workflow Dispatch",
    "Specialist Work",
    "Document Production",
    "Dual-House Review",
    "Approval Routing",
    "Execution",
    "Outcome Verify",
] as const;

const STAGE_Y_START = 200;
const STAGE_H = 28;
const STAGE_GAP = 6;
const STAGE_X = ZONE_X + 20;
const STAGE_W = ZONE_W - 40;

const CLUSTERS = [
    { code: "VI", name: "Visionaries", count: 5 },
    { code: "BU", name: "Builders", count: 5 },
    { code: "IN", name: "Investors", count: 4 },
    { code: "GU", name: "Guardians", count: 4 },
    { code: "OP", name: "Operatives", count: 5 },
    { code: "MO", name: "Moderators", count: 3 },
    { code: "AD", name: "Advisors", count: 4 },
    { code: "OR", name: "Orchestrators", count: 2 },
    { code: "AR", name: "Archivists", count: 2 },
    { code: "RT", name: "Red Team", count: 3 },
    { code: "SC", name: "Scouts", count: 1 },
];

type FlowItem = {
    id: string;
    stageIdx: number;
    sprite: Phaser.GameObjects.Image;
    label: Phaser.GameObjects.Text;
    progress: number; // 0-1 within current stage
    title: string;
    severity: string;
};

export class AlgoraZone {
    private scene: Phaser.Scene;
    private g!: Phaser.GameObjects.Graphics;
    private stageLabels: Phaser.GameObjects.Text[] = [];
    private clusterDots: Array<{ x: number; y: number; active: boolean }> = [];
    private clusterLabels: Phaser.GameObjects.Text[] = [];
    private items: FlowItem[] = [];
    private spawnTimer = 0;
    private itemIdCounter = 0;
    private docChips: Phaser.GameObjects.Text[] = [];

    // public stats
    signalsProcessed = 0;
    issuesDetected = 0;
    docsProduced = 0;

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
    }

    create(): void {
        this.g = this.scene.add.graphics().setDepth(5);

        // zone panel
        this.g.fillStyle(0x0f2d2a, 0.18);
        this.g.fillRoundedRect(ZONE_X, ZONE_Y, ZONE_W, ZONE_H, 10);
        this.g.lineStyle(2, 0x34d399, 0.45);
        this.g.strokeRoundedRect(ZONE_X, ZONE_Y, ZONE_W, ZONE_H, 10);

        // title
        this.scene.add.text(ZONE_X + 14, ZONE_Y + 8, "ALGORA — Sense & Detect", {
            fontFamily: "monospace", fontSize: "12px", color: "#86efac",
            backgroundColor: "#0b1226ee", padding: { x: 6, y: 3 },
        }).setDepth(10);

        // subtitle: 38 agents
        this.scene.add.text(ZONE_X + 14, ZONE_Y + 28, "38 agents · 11 clusters · 9-stage pipeline", {
            fontFamily: "monospace", fontSize: "9px", color: "#4ade80aa",
        }).setDepth(10);

        this.createClusterArc();
        this.createPipelineStages();
        this.createDocDock();
    }

    private createClusterArc(): void {
        const cx = ZONE_X + ZONE_W / 2;
        const cy = ZONE_Y + 88;
        const rx = 170;
        const ry = 38;

        CLUSTERS.forEach((cl, i) => {
            const angle = Math.PI + (Math.PI * i) / (CLUSTERS.length - 1);
            const x = cx + Math.cos(angle) * rx;
            const y = cy + Math.sin(angle) * ry;
            this.clusterDots.push({ x, y, active: false });

            const label = this.scene.add.text(x, y, `${cl.code}\n${cl.count}`, {
                fontFamily: "monospace", fontSize: "8px", color: "#34d399",
                backgroundColor: "#0f2d2acc", padding: { x: 3, y: 1 },
                align: "center",
            }).setOrigin(0.5).setDepth(12);
            this.clusterLabels.push(label);
        });
    }

    private createPipelineStages(): void {
        STAGES.forEach((name, i) => {
            const y = STAGE_Y_START + i * (STAGE_H + STAGE_GAP);
            const label = this.scene.add.text(STAGE_X + 8, y + 6, `${i + 1}. ${name}`, {
                fontFamily: "monospace", fontSize: "9px", color: "#d1fae5",
            }).setDepth(12);
            this.stageLabels.push(label);
        });
    }

    private createDocDock(): void {
        const dockY = STAGE_Y_START + STAGES.length * (STAGE_H + STAGE_GAP) + 12;
        this.scene.add.text(STAGE_X + 4, dockY, "Documents:", {
            fontFamily: "monospace", fontSize: "9px", color: "#86efac99",
        }).setDepth(12);

        const docTypes = ["DP", "GP", "PA", "WGC", "ER", "DR"];
        docTypes.forEach((dt, i) => {
            const chip = this.scene.add.text(STAGE_X + 75 + i * 36, dockY, dt, {
                fontFamily: "monospace", fontSize: "8px", color: "#022c22",
                backgroundColor: "#34d39966", padding: { x: 4, y: 2 },
            }).setDepth(12);
            this.docChips.push(chip);
        });
    }

    update(dt: number, dataBridge: DataBridge): void {
        this.spawnTimer += dt;

        // spawn new signal items every 2s
        if (this.spawnTimer > 2000 && this.items.length < 6) {
            const signal = dataBridge.nextSignal();
            if (signal) {
                this.spawnItem(signal.title.slice(0, 25), signal.severity);
                this.signalsProcessed++;
            }
            this.spawnTimer = 0;
        }

        // advance items through stages
        for (const item of this.items) {
            item.progress += dt * 0.0004;
            if (item.progress >= 1) {
                item.progress = 0;
                item.stageIdx++;

                // transform sprite at stage 2 (issue detection)
                if (item.stageIdx === 2) {
                    item.sprite.setTexture("issue-card");
                    this.issuesDetected++;
                }
                // doc production
                if (item.stageIdx === 5) {
                    this.docsProduced++;
                }
            }

            // remove completed items
            if (item.stageIdx >= STAGES.length) {
                item.sprite.destroy();
                item.label.destroy();
                continue;
            }

            const y = STAGE_Y_START + item.stageIdx * (STAGE_H + STAGE_GAP) + STAGE_H / 2;
            const progressX = STAGE_X + STAGE_W - 40 + item.progress * 30;
            item.sprite.setPosition(progressX, y);
            item.label.setPosition(progressX - 30, y - 2);
        }

        this.items = this.items.filter(i => i.stageIdx < STAGES.length);

        // animate cluster activity
        const now = this.scene.time.now;
        this.clusterDots.forEach((cd, i) => {
            cd.active = Math.sin(now * 0.003 + i * 0.7) > 0.3;
            this.clusterLabels[i].setAlpha(cd.active ? 1 : 0.4);
        });

        this.drawGraphics();
    }

    private spawnItem(title: string, severity: string): void {
        const x = STAGE_X + STAGE_W - 30;
        const y = STAGE_Y_START + STAGE_H / 2;
        const sprite = this.scene.add.image(x, y, "signal-orb")
            .setDepth(20).setDisplaySize(20, 20);
        const label = this.scene.add.text(x - 30, y - 2, title, {
            fontFamily: "monospace", fontSize: "7px", color: "#a5f3fc",
            backgroundColor: "#0f172aee", padding: { x: 2, y: 1 },
        }).setDepth(21).setOrigin(1, 0.5);

        this.items.push({
            id: `a-${this.itemIdCounter++}`,
            stageIdx: 0, sprite, label,
            progress: 0, title, severity,
        });
    }

    private drawGraphics(): void {
        this.g.clear();

        // zone background
        this.g.fillStyle(0x0f2d2a, 0.18);
        this.g.fillRoundedRect(ZONE_X, ZONE_Y, ZONE_W, ZONE_H, 10);
        this.g.lineStyle(2, 0x34d399, 0.45);
        this.g.strokeRoundedRect(ZONE_X, ZONE_Y, ZONE_W, ZONE_H, 10);

        // cluster dots
        this.clusterDots.forEach(cd => {
            this.g.fillStyle(0x34d399, cd.active ? 0.8 : 0.2);
            this.g.fillCircle(cd.x, cd.y, cd.active ? 7 : 5);
            if (cd.active) {
                this.g.lineStyle(1, 0x34d399, 0.3);
                this.g.strokeCircle(cd.x, cd.y, 11);
            }
        });

        // pipeline stage bars
        STAGES.forEach((_, i) => {
            const y = STAGE_Y_START + i * (STAGE_H + STAGE_GAP);
            const hasItem = this.items.some(it => it.stageIdx === i);
            this.g.fillStyle(hasItem ? 0x166534 : 0x0a1e18, hasItem ? 0.6 : 0.4);
            this.g.fillRoundedRect(STAGE_X, y, STAGE_W, STAGE_H, 6);
            this.g.lineStyle(1, 0x34d399, hasItem ? 0.7 : 0.2);
            this.g.strokeRoundedRect(STAGE_X, y, STAGE_W, STAGE_H, 6);

            // connector line
            if (i < STAGES.length - 1) {
                this.g.lineStyle(1, 0x34d399, 0.2);
                this.g.lineBetween(STAGE_X + STAGE_W / 2, y + STAGE_H, STAGE_X + STAGE_W / 2, y + STAGE_H + STAGE_GAP);
            }
        });
    }
}
