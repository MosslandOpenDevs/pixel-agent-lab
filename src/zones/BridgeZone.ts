import Phaser from "phaser";
import type { DataBridge } from "../services/data-bridge.ts";

const ZONE_X = 960;
const ZONE_Y = 44;
const ZONE_W = 470;
const ZONE_H = 370;

const L_STAGES = [
    "L0 · Signal Collection",
    "L1 · Agentic Deliberation",
    "L2 · Human Voting",
    "L3 · Execution",
    "L4 · Outcome Proof",
] as const;

const STAGE_Y_START = 192;
const STAGE_H = 26;
const STAGE_GAP = 6;
const STAGE_X = ZONE_X + 20;
const STAGE_W = ZONE_W - 40;

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
    private agentSprites: Phaser.GameObjects.Sprite[] = [];
    private agentLabels: Phaser.GameObjects.Text[] = [];
    private items: ProposalItem[] = [];
    private spawnTimer = 0;

    // live stats
    proposalCount = 0;
    outcomeCount = 0;
    successRate = 0;

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
    }

    create(): void {
        this.g = this.scene.add.graphics().setDepth(5);

        // title
        this.scene.add.text(ZONE_X + 14, ZONE_Y + 8, "BRIDGE — Execute & Verify", {
            fontFamily: "monospace", fontSize: "12px", color: "#93c5fd",
            backgroundColor: "#0b1226ee", padding: { x: 6, y: 3 },
        }).setDepth(10);

        this.scene.add.text(ZONE_X + 14, ZONE_Y + 28, "5 agents · L0→L4 pipeline · Voting · Trust Scores", {
            fontFamily: "monospace", fontSize: "9px", color: "#60a5fa88",
        }).setDepth(10);

        this.createAgentRow();
        this.createPipelineStages();
    }

    private createAgentRow(): void {
        const startX = ZONE_X + 50;
        const y = ZONE_Y + 72;
        const spacing = 85;

        AGENTS.forEach((agent, i) => {
            const x = startX + i * spacing;
            const sprite = this.scene.add.sprite(x, y, "bridge-bot-0")
                .setDepth(20).setDisplaySize(36, 36);
            this.agentSprites.push(sprite);

            const label = this.scene.add.text(x, y + 24, agent.name, {
                fontFamily: "monospace", fontSize: "8px", color: "#93c5fd",
                backgroundColor: "#0b1226cc", padding: { x: 3, y: 1 },
            }).setOrigin(0.5).setDepth(21);
            this.agentLabels.push(label);
        });
    }

    private createPipelineStages(): void {
        L_STAGES.forEach((name, i) => {
            const y = STAGE_Y_START + i * (STAGE_H + STAGE_GAP);
            this.scene.add.text(STAGE_X + 8, y + 5, name, {
                fontFamily: "monospace", fontSize: "9px", color: "#bfdbfe",
            }).setDepth(12);
        });
    }

    update(dt: number, dataBridge: DataBridge): void {
        this.spawnTimer += dt;

        // update stats from live data
        const bs = dataBridge.liveStats.bridge;
        if (bs) {
            this.proposalCount = bs.proposals.total;
            this.outcomeCount = bs.outcomes.totalProofs;
            this.successRate = bs.outcomes.successRate;
        }

        // spawn proposal items flowing through pipeline
        if (this.spawnTimer > 3000 && this.items.length < 4) {
            this.spawnItem();
            this.spawnTimer = 0;
        }

        // advance items
        for (const item of this.items) {
            item.progress += dt * 0.0003;
            if (item.progress >= 1) {
                item.progress = 0;
                item.stageIdx++;

                if (item.stageIdx === 3) {
                    item.sprite.setTexture("outcome-proof");
                }
            }

            if (item.stageIdx >= L_STAGES.length) {
                item.sprite.destroy();
                item.label.destroy();
                continue;
            }

            const y = STAGE_Y_START + item.stageIdx * (STAGE_H + STAGE_GAP) + STAGE_H / 2;
            const x = STAGE_X + STAGE_W - 30;
            item.sprite.setPosition(x, y);
            item.label.setPosition(x - 20, y - 2);
        }

        this.items = this.items.filter(i => i.stageIdx < L_STAGES.length);

        // animate agents
        const frame = Math.floor(this.scene.time.now / 500) % 2;
        this.agentSprites.forEach(s => s.setTexture(`bridge-bot-${frame}`));

        this.drawGraphics();
    }

    private spawnItem(): void {
        const y = STAGE_Y_START + STAGE_H / 2;
        const x = STAGE_X + STAGE_W - 30;
        const sprite = this.scene.add.image(x, y, "proposal-seal")
            .setDepth(18).setDisplaySize(18, 18);
        const label = this.scene.add.text(x - 20, y - 2, "Proposal", {
            fontFamily: "monospace", fontSize: "7px", color: "#93c5fd",
            backgroundColor: "#0f172aee", padding: { x: 2, y: 1 },
        }).setDepth(19).setOrigin(1, 0.5);

        this.items.push({ sprite, label, stageIdx: 0, progress: 0 });
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
            const x = ZONE_X + 50 + i * 85;
            const y = ZONE_Y + 72;
            const active = Math.sin(now * 0.002 + i * 1.2) > 0;
            this.g.lineStyle(2, agent.color, active ? 0.7 : 0.2);
            this.g.strokeCircle(x, y, 22);
        });

        // pipeline bars
        L_STAGES.forEach((_, i) => {
            const y = STAGE_Y_START + i * (STAGE_H + STAGE_GAP);
            const hasItem = this.items.some(it => it.stageIdx === i);
            this.g.fillStyle(hasItem ? 0x1e3a5f : 0x0d1b33, hasItem ? 0.6 : 0.4);
            this.g.fillRoundedRect(STAGE_X, y, STAGE_W, STAGE_H, 5);
            this.g.lineStyle(1, 0x60a5fa, hasItem ? 0.6 : 0.2);
            this.g.strokeRoundedRect(STAGE_X, y, STAGE_W, STAGE_H, 5);

            if (i < L_STAGES.length - 1) {
                this.g.lineStyle(1, 0x60a5fa, 0.15);
                this.g.lineBetween(STAGE_X + STAGE_W / 2, y + STAGE_H, STAGE_X + STAGE_W / 2, y + STAGE_H + STAGE_GAP);
            }
        });

        // voting bar at L2 stage
        const voteY = STAGE_Y_START + 2 * (STAGE_H + STAGE_GAP);
        this.g.fillStyle(0x22c55e, 0.4);
        this.g.fillRoundedRect(STAGE_X + STAGE_W - 100, voteY + 4, 45, 18, 3);
        this.g.fillStyle(0xef4444, 0.3);
        this.g.fillRoundedRect(STAGE_X + STAGE_W - 52, voteY + 4, 40, 18, 3);
    }
}
