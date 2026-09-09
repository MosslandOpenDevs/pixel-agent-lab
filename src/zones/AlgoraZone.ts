import Phaser from "phaser";
import type { DataBridge } from "../services/data-bridge.ts";

const ZONE_X = 10;
const ZONE_Y = 44;
const ZONE_W = 620;
const ZONE_H = 386;

const STAGES = [
    "Signal Intake",
    "Issue Detection",
    "Workflow Dispatch",
    "Specialist Work",
    "Doc Production",
    "Dual-House Vote",
    "Approval Route",
    "Execution",
    "Outcome Verify",
] as const;

// Vertical belt along right side of pipeline
const BELT_X = ZONE_X + ZONE_W - 70;
const BELT_W = 50;
const BELT_TOP = ZONE_Y + 108;
const BELT_BOTTOM = ZONE_Y + 356;

const STAGE_Y_START = ZONE_Y + 112;
const STAGE_H = 22;
const STAGE_GAP = 5;
const STAGE_X = ZONE_X + 18;
const STAGE_W = ZONE_W - 100;

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
    progress: number;
    title: string;
    severity: string;
};

export class AlgoraZone {
    private scene: Phaser.Scene;
    private g!: Phaser.GameObjects.Graphics;
    private beltG!: Phaser.GameObjects.Graphics;
    private clusterDots: Array<{ x: number; y: number; active: boolean }> = [];
    private clusterLabels: Phaser.GameObjects.Text[] = [];
    private items: FlowItem[] = [];
    private spawnTimer = 0;
    private itemIdCounter = 0;
    private beltOffset = 0;
    private bot!: Phaser.GameObjects.Sprite;
    private botBusy = false;


    constructor(scene: Phaser.Scene) {
        this.scene = scene;
    }

    create(): void {
        this.g = this.scene.add.graphics().setDepth(5);
        this.beltG = this.scene.add.graphics().setDepth(6);

        // title
        this.scene.add.text(ZONE_X + 14, ZONE_Y + 8, "ALGORA \u2014 Sense & Detect", {
            fontFamily: "monospace", fontSize: "12px", color: "#86efac",
            backgroundColor: "#0b1226ee", padding: { x: 6, y: 3 },
        }).setDepth(10);

        this.scene.add.text(ZONE_X + 14, ZONE_Y + 26, "Independent Service \u00b7 Port 3201 \u00b7 38 agents \u00b7 11 clusters \u00b7 9-stage pipeline", {
            fontFamily: "monospace", fontSize: "10px", color: "#6ee7b7",
        }).setDepth(10);

        // loader bot near belt top
        this.bot = this.scene.add.sprite(BELT_X + BELT_W / 2, BELT_TOP - 22, "algora-bot-0")
            .setDepth(30).setDisplaySize(36, 36);
        this.scene.add.text(BELT_X + BELT_W / 2, BELT_TOP - 44, "LOADER", {
            fontFamily: "monospace", fontSize: "8px", color: "#86efac",
            backgroundColor: "#0b1226cc", padding: { x: 3, y: 1 },
        }).setOrigin(0.5).setDepth(31);

        this.createClusterArc();
        this.createPipelineStages();
        this.createDocDock();
    }

    private createClusterArc(): void {
        const cx = ZONE_X + ZONE_W / 2 - 40;
        const cy = ZONE_Y + 68;
        const rx = 170;
        const ry = 22;

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
            this.scene.add.text(STAGE_X + 6, y + 3, `${i + 1}. ${name}`, {
                fontFamily: "monospace", fontSize: "9px", color: "#d1fae5",
            }).setDepth(12);
        });
    }

    private createDocDock(): void {
        const dockY = STAGE_Y_START + STAGES.length * (STAGE_H + STAGE_GAP) + 4;
        this.scene.add.text(STAGE_X + 2, dockY, "Docs:", {
            fontFamily: "monospace", fontSize: "8px", color: "#86efac88",
        }).setDepth(12);

        const docTypes = ["DP", "GP", "PA", "WGC", "ER", "DR"];
        docTypes.forEach((dt, i) => {
            this.scene.add.text(STAGE_X + 40 + i * 32, dockY, dt, {
                fontFamily: "monospace", fontSize: "7px", color: "#022c22",
                backgroundColor: "#34d39955", padding: { x: 3, y: 2 },
            }).setDepth(12);
        });
    }

    update(dt: number, dataBridge: DataBridge): void {
        this.spawnTimer += dt;
        this.beltOffset += dt * 0.03;

        // animate bot
        const frame = Math.floor(this.scene.time.now / 420) % 2;
        this.bot.setTexture(`algora-bot-${frame}`);

        // spawn: bot picks up signal and places on belt
        if (this.spawnTimer > 2200 && this.items.length < 5 && !this.botBusy) {
            const signal = dataBridge.nextSignal();
            if (signal) {
                this.botBusy = true;

                const title = signal.title.slice(0, 22);
                const severity = signal.severity;
                this.scene.tweens.add({
                    targets: this.bot, y: BELT_TOP - 40, duration: 200,
                    yoyo: true, onComplete: () => {
                        this.spawnItem(title, severity);
                        this.botBusy = false;
                    },
                });
            }
            this.spawnTimer = 0;
        }

        // advance items down the belt
        for (const item of this.items) {
            item.progress += dt * 0.00035;
            if (item.progress >= 1) {
                item.progress = 0;
                item.stageIdx++;

                if (item.stageIdx === 2) {
                    item.sprite.setTexture("issue-card");
                    item.sprite.setDisplaySize(18, 16);
                }
            }

            if (item.stageIdx >= STAGES.length) {
                item.sprite.destroy();
                item.label.destroy();
                continue;
            }

            const y = STAGE_Y_START + item.stageIdx * (STAGE_H + STAGE_GAP) + STAGE_H / 2
                + item.progress * (STAGE_H + STAGE_GAP);
            item.sprite.setPosition(BELT_X + BELT_W / 2, y);
            item.label.setPosition(BELT_X - 4, y - 3);
        }

        this.items = this.items.filter(i => i.stageIdx < STAGES.length);

        // cluster pulse
        const now = this.scene.time.now;
        this.clusterDots.forEach((cd, i) => {
            cd.active = Math.sin(now * 0.003 + i * 0.7) > 0.3;
            this.clusterLabels[i].setAlpha(cd.active ? 1 : 0.4);
        });

        this.drawGraphics();
        this.drawBelt();
    }

    private spawnItem(title: string, severity: string): void {
        const x = BELT_X + BELT_W / 2;
        const y = BELT_TOP + 8;
        const sprite = this.scene.add.image(x, y, "signal-orb")
            .setDepth(20).setDisplaySize(18, 18);
        const color = severity === "high" || severity === "critical" ? "#fca5a5" : severity === "medium" ? "#fcd34d" : "#94a3b8";
        const label = this.scene.add.text(BELT_X - 4, y - 3, title, {
            fontFamily: "monospace", fontSize: "7px", color,
            backgroundColor: "#0f172aee", padding: { x: 2, y: 1 },
        }).setDepth(21).setOrigin(1, 0.5);

        this.items.push({
            id: `a-${this.itemIdCounter++}`,
            stageIdx: 0, sprite, label,
            progress: 0, title, severity,
        });
    }

    private drawBelt(): void {
        this.beltG.clear();

        // belt track
        this.beltG.fillStyle(0x1a2e1a, 0.85);
        this.beltG.fillRoundedRect(BELT_X, BELT_TOP, BELT_W, BELT_BOTTOM - BELT_TOP, 8);
        this.beltG.lineStyle(2, 0x34d399, 0.5);
        this.beltG.strokeRoundedRect(BELT_X, BELT_TOP, BELT_W, BELT_BOTTOM - BELT_TOP, 8);

        // side wheels (rollers)
        for (let y = BELT_TOP + 12; y < BELT_BOTTOM - 8; y += 24) {
            this.beltG.fillStyle(0x4ade80, 0.35);
            this.beltG.fillCircle(BELT_X + 4, y, 4);
            this.beltG.fillCircle(BELT_X + BELT_W - 4, y, 4);
            this.beltG.fillStyle(0x0f2d2a, 0.8);
            this.beltG.fillCircle(BELT_X + 4, y, 1.5);
            this.beltG.fillCircle(BELT_X + BELT_W - 4, y, 1.5);
        }

        // moving tread marks
        const phase = this.beltOffset % 30;
        for (let y = BELT_TOP + phase; y < BELT_BOTTOM - 8; y += 30) {
            this.beltG.fillStyle(0x34d399, 0.12);
            this.beltG.fillRect(BELT_X + 10, y, BELT_W - 20, 10);
        }
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
            this.g.fillStyle(hasItem ? 0x166534 : 0x0a1e18, hasItem ? 0.55 : 0.35);
            this.g.fillRoundedRect(STAGE_X, y, STAGE_W, STAGE_H, 5);
            this.g.lineStyle(1, 0x34d399, hasItem ? 0.6 : 0.15);
            this.g.strokeRoundedRect(STAGE_X, y, STAGE_W, STAGE_H, 5);

            // connector to belt
            if (hasItem) {
                this.g.lineStyle(1, 0x34d399, 0.4);
                this.g.lineBetween(STAGE_X + STAGE_W, y + STAGE_H / 2, BELT_X, y + STAGE_H / 2);
            }

            // vertical connector
            if (i < STAGES.length - 1) {
                this.g.lineStyle(1, 0x34d399, 0.12);
                this.g.lineBetween(STAGE_X + STAGE_W / 2, y + STAGE_H, STAGE_X + STAGE_W / 2, y + STAGE_H + STAGE_GAP);
            }
        });
    }
}
