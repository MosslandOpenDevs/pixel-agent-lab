import Phaser from "phaser";
import type { DataBridge } from "../services/data-bridge.ts";

const ZONE_X = 960;
const ZONE_Y = 44;
const ZONE_W = 470;
const ZONE_H = 370;

const L_STAGES = [
    "L0 · Signal Collection",
    "L1 · Deliberation",
    "L2 · Human Voting",
    "L3 · Execution",
    "L4 · Outcome Proof",
] as const;

// Vertical belt for Bridge pipeline
const BELT_X = ZONE_X + ZONE_W - 65;
const BELT_W = 44;
const BELT_TOP = 175;
const BELT_BOTTOM = 370;

const STAGE_Y_START = 178;
const STAGE_H = 24;
const STAGE_GAP = 12;
const STAGE_X = ZONE_X + 18;
const STAGE_W = ZONE_W - 100;

const AGENTS = [
    { name: "Risk", color: 0xef4444 },
    { name: "Treasury", color: 0xeab308 },
    { name: "Community", color: 0x22c55e },
    { name: "Product", color: 0x3b82f6 },
    { name: "Moderator", color: 0xa855f7 },
];

type ProposalItem = {
    sprite: Phaser.GameObjects.Image;
    label: Phaser.GameObjects.Text;
    stageIdx: number;
    progress: number;
};

export class BridgeZone {
    private scene: Phaser.Scene;
    private g!: Phaser.GameObjects.Graphics;
    private beltG!: Phaser.GameObjects.Graphics;
    private agentSprites: Phaser.GameObjects.Sprite[] = [];
    private items: ProposalItem[] = [];
    private spawnTimer = 0;
    private beltOffset = 0;
    private bot!: Phaser.GameObjects.Sprite;

    proposalCount = 0;
    outcomeCount = 0;
    successRate = 0;

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
    }

    create(): void {
        this.g = this.scene.add.graphics().setDepth(5);
        this.beltG = this.scene.add.graphics().setDepth(6);

        // title
        this.scene.add.text(ZONE_X + 14, ZONE_Y + 8, "BRIDGE — Execute & Verify", {
            fontFamily: "monospace", fontSize: "12px", color: "#93c5fd",
            backgroundColor: "#0b1226ee", padding: { x: 6, y: 3 },
        }).setDepth(10);

        this.scene.add.text(ZONE_X + 14, ZONE_Y + 28, "5 agents · L0→L4 · Voting · Trust", {
            fontFamily: "monospace", fontSize: "9px", color: "#60a5fa88",
        }).setDepth(10);

        // loader bot
        this.bot = this.scene.add.sprite(BELT_X + BELT_W / 2, BELT_TOP - 18, "bridge-bot-0")
            .setDepth(30).setDisplaySize(32, 32);

        this.createAgentRow();
        this.createPipelineLabels();
    }

    private createAgentRow(): void {
        const startX = ZONE_X + 45;
        const y = ZONE_Y + 68;
        const spacing = 80;

        AGENTS.forEach((agent, i) => {
            const x = startX + i * spacing;
            const sprite = this.scene.add.sprite(x, y, "bridge-bot-0")
                .setDepth(20).setDisplaySize(32, 32);
            this.agentSprites.push(sprite);

            this.scene.add.text(x, y + 22, agent.name, {
                fontFamily: "monospace", fontSize: "8px", color: "#93c5fd",
                backgroundColor: "#0b1226cc", padding: { x: 3, y: 1 },
            }).setOrigin(0.5).setDepth(21);
        });
    }

    private createPipelineLabels(): void {
        L_STAGES.forEach((name, i) => {
            const y = STAGE_Y_START + i * (STAGE_H + STAGE_GAP);
            this.scene.add.text(STAGE_X + 6, y + 4, name, {
                fontFamily: "monospace", fontSize: "9px", color: "#bfdbfe",
            }).setDepth(12);
        });
    }

    update(dt: number, dataBridge: DataBridge): void {
        this.spawnTimer += dt;
        this.beltOffset += dt * 0.025;

        // update stats
        const bs = dataBridge.liveStats.bridge;
        if (bs) {
            this.proposalCount = bs.proposals.total;
            this.outcomeCount = bs.outcomes.totalProofs;
            this.successRate = bs.outcomes.successRate;
        }

        // animate bots
        const frame = Math.floor(this.scene.time.now / 500) % 2;
        this.agentSprites.forEach(s => s.setTexture(`bridge-bot-${frame}`));
        this.bot.setTexture(`bridge-bot-${frame}`);

        // spawn items on belt
        if (this.spawnTimer > 3200 && this.items.length < 4) {
            this.spawnItem();
            this.spawnTimer = 0;
            // bot loading animation
            this.scene.tweens.add({
                targets: this.bot, y: BELT_TOP - 6, duration: 180, yoyo: true,
            });
        }

        // advance items down belt
        for (const item of this.items) {
            item.progress += dt * 0.00025;
            if (item.progress >= 1) {
                item.progress = 0;
                item.stageIdx++;
                if (item.stageIdx === 4) {
                    item.sprite.setTexture("outcome-proof");
                    item.sprite.setDisplaySize(16, 16);
                }
            }
            if (item.stageIdx >= L_STAGES.length) {
                item.sprite.destroy();
                item.label.destroy();
                continue;
            }

            const y = STAGE_Y_START + item.stageIdx * (STAGE_H + STAGE_GAP) + STAGE_H / 2
                + item.progress * (STAGE_H + STAGE_GAP);
            item.sprite.setPosition(BELT_X + BELT_W / 2, y);
            item.label.setPosition(BELT_X - 4, y - 2);
        }

        this.items = this.items.filter(i => i.stageIdx < L_STAGES.length);

        this.drawGraphics();
        this.drawBelt();
    }

    private spawnItem(): void {
        const x = BELT_X + BELT_W / 2;
        const y = BELT_TOP + 6;
        const sprite = this.scene.add.image(x, y, "proposal-seal")
            .setDepth(20).setDisplaySize(16, 16);
        const label = this.scene.add.text(BELT_X - 4, y - 2, "Proposal", {
            fontFamily: "monospace", fontSize: "7px", color: "#93c5fd",
            backgroundColor: "#0f172aee", padding: { x: 2, y: 1 },
        }).setDepth(21).setOrigin(1, 0.5);

        this.items.push({ sprite, label, stageIdx: 0, progress: 0 });
    }

    private drawBelt(): void {
        this.beltG.clear();

        // belt track (vertical)
        this.beltG.fillStyle(0x0d1b33, 0.85);
        this.beltG.fillRoundedRect(BELT_X, BELT_TOP, BELT_W, BELT_BOTTOM - BELT_TOP, 7);
        this.beltG.lineStyle(2, 0x60a5fa, 0.45);
        this.beltG.strokeRoundedRect(BELT_X, BELT_TOP, BELT_W, BELT_BOTTOM - BELT_TOP, 7);

        // rollers
        for (let y = BELT_TOP + 10; y < BELT_BOTTOM - 8; y += 22) {
            this.beltG.fillStyle(0x60a5fa, 0.3);
            this.beltG.fillCircle(BELT_X + 4, y, 3.5);
            this.beltG.fillCircle(BELT_X + BELT_W - 4, y, 3.5);
            this.beltG.fillStyle(0x0d1b33, 0.8);
            this.beltG.fillCircle(BELT_X + 4, y, 1.2);
            this.beltG.fillCircle(BELT_X + BELT_W - 4, y, 1.2);
        }

        // moving treads
        const phase = this.beltOffset % 28;
        for (let y = BELT_TOP + phase; y < BELT_BOTTOM - 8; y += 28) {
            this.beltG.fillStyle(0x60a5fa, 0.1);
            this.beltG.fillRect(BELT_X + 8, y, BELT_W - 16, 10);
        }
    }

    private drawGraphics(): void {
        this.g.clear();

        // zone background
        this.g.fillStyle(0x10263f, 0.18);
        this.g.fillRoundedRect(ZONE_X, ZONE_Y, ZONE_W, ZONE_H, 10);
        this.g.lineStyle(2, 0x60a5fa, 0.45);
        this.g.strokeRoundedRect(ZONE_X, ZONE_Y, ZONE_W, ZONE_H, 10);

        // agent accent circles
        const now = this.scene.time.now;
        AGENTS.forEach((agent, i) => {
            const x = ZONE_X + 45 + i * 80;
            const y = ZONE_Y + 68;
            const active = Math.sin(now * 0.002 + i * 1.2) > 0;
            this.g.lineStyle(2, agent.color, active ? 0.6 : 0.15);
            this.g.strokeCircle(x, y, 20);
        });

        // pipeline bars
        L_STAGES.forEach((_, i) => {
            const y = STAGE_Y_START + i * (STAGE_H + STAGE_GAP);
            const hasItem = this.items.some(it => it.stageIdx === i);
            this.g.fillStyle(hasItem ? 0x1e3a5f : 0x0d1b33, hasItem ? 0.55 : 0.35);
            this.g.fillRoundedRect(STAGE_X, y, STAGE_W, STAGE_H, 5);
            this.g.lineStyle(1, 0x60a5fa, hasItem ? 0.5 : 0.15);
            this.g.strokeRoundedRect(STAGE_X, y, STAGE_W, STAGE_H, 5);

            // connector to belt
            if (hasItem) {
                this.g.lineStyle(1, 0x60a5fa, 0.3);
                this.g.lineBetween(STAGE_X + STAGE_W, y + STAGE_H / 2, BELT_X, y + STAGE_H / 2);
            }

            // vertical connector
            if (i < L_STAGES.length - 1) {
                this.g.lineStyle(1, 0x60a5fa, 0.1);
                this.g.lineBetween(STAGE_X + STAGE_W / 2, y + STAGE_H, STAGE_X + STAGE_W / 2, y + STAGE_H + STAGE_GAP);
            }
        });

        // voting bar at L2
        const voteY = STAGE_Y_START + 2 * (STAGE_H + STAGE_GAP);
        this.g.fillStyle(0x22c55e, 0.35);
        this.g.fillRoundedRect(STAGE_X + STAGE_W - 90, voteY + 3, 40, 18, 3);
        this.g.fillStyle(0xef4444, 0.25);
        this.g.fillRoundedRect(STAGE_X + STAGE_W - 48, voteY + 3, 35, 18, 3);
    }
}
