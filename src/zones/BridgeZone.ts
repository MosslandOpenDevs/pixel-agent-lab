import Phaser from "phaser";
import type { DataBridge } from "../services/data-bridge.ts";

const ZONE_X = 10;
const ZONE_Y = 488;
const ZONE_W = 1420;
const ZONE_H = 262;

const L_STAGES = [
    "L0 \u00b7 Signal Collection",
    "L1 \u00b7 Deliberation",
    "L2 \u00b7 Human Voting",
    "L3 \u00b7 Execution",
    "L4 \u00b7 Outcome Proof",
] as const;

// Horizontal belt for Bridge pipeline (left section)
const BELT_LEFT = ZONE_X + 20;
const BELT_RIGHT = ZONE_X + 560;
const BELT_Y = ZONE_Y + 140;
const BELT_H = 40;

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

    // trust panel (migrated from FeedbackArc)
    private trustLabels: Phaser.GameObjects.Text[] = [];
    private outcomeLog?: Phaser.GameObjects.Text;

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
        this.scene.add.text(ZONE_X + 14, ZONE_Y + 8, "BRIDGE \u2014 Execute & Verify", {
            fontFamily: "monospace", fontSize: "12px", color: "#93c5fd",
            backgroundColor: "#0b1226ee", padding: { x: 6, y: 3 },
        }).setDepth(10);

        this.scene.add.text(ZONE_X + 14, ZONE_Y + 26, "Independent Service \u00b7 Port 3101 \u00b7 5 agents \u00b7 L0\u2192L4 \u00b7 Voting \u00b7 Trust", {
            fontFamily: "monospace", fontSize: "9px", color: "#60a5fa88",
        }).setDepth(10);

        // loader bot at belt entrance
        this.bot = this.scene.add.sprite(BELT_LEFT + 10, BELT_Y - 18, "bridge-bot-0")
            .setDepth(30).setDisplaySize(32, 32);

        this.createAgentRow();
        this.createPipelineLabels();
        this.createTrustPanel();
    }

    private createAgentRow(): void {
        const startX = ZONE_X + 55;
        const y = ZONE_Y + 62;
        const spacing = 80;

        AGENTS.forEach((agent, i) => {
            const x = startX + i * spacing;
            const sprite = this.scene.add.sprite(x, y, "bridge-bot-0")
                .setDepth(20).setDisplaySize(28, 28);
            this.agentSprites.push(sprite);

            this.scene.add.text(x, y + 20, agent.name, {
                fontFamily: "monospace", fontSize: "8px", color: "#93c5fd",
                backgroundColor: "#0b1226cc", padding: { x: 3, y: 1 },
            }).setOrigin(0.5).setDepth(21);
        });
    }

    private createPipelineLabels(): void {
        const stageWidth = (BELT_RIGHT - BELT_LEFT) / L_STAGES.length;
        L_STAGES.forEach((name, i) => {
            const x = BELT_LEFT + i * stageWidth + stageWidth / 2;
            this.scene.add.text(x, BELT_Y - 14, name, {
                fontFamily: "monospace", fontSize: "7px", color: "#bfdbfe",
            }).setOrigin(0.5).setDepth(12);
        });

        // belt direction labels
        this.scene.add.text(BELT_LEFT, BELT_Y + BELT_H + 6, "\u2190 Proposals enter", {
            fontFamily: "monospace", fontSize: "7px", color: "#60a5fa44",
        }).setDepth(10);
        this.scene.add.text(BELT_RIGHT - 90, BELT_Y + BELT_H + 6, "Outcomes verified \u2192", {
            fontFamily: "monospace", fontSize: "7px", color: "#22c55e44",
        }).setDepth(10);
    }

    private createTrustPanel(): void {
        // Trust & Outcomes section (right side of the wide zone)
        const px = ZONE_X + 600;

        this.scene.add.text(px, ZONE_Y + 8, "TRUST & OUTCOMES", {
            fontFamily: "monospace", fontSize: "11px", color: "#2dd4bf",
            backgroundColor: "#0b1226ee", padding: { x: 6, y: 3 },
        }).setDepth(10);

        this.scene.add.text(px, ZONE_Y + 28, "Bridge internal trust scoring and outcome verification", {
            fontFamily: "monospace", fontSize: "8px", color: "#2dd4bf44",
        }).setDepth(10);

        const gaugeNames = ["Agent Trust", "Proposals", "Success Rate"];
        const gaugeColors = ["#22c55e", "#3b82f6", "#a855f7"];
        gaugeNames.forEach((name, i) => {
            const x = px + 30 + i * 230;
            const label = this.scene.add.text(x, ZONE_Y + 60, `${name}\n--`, {
                fontFamily: "monospace", fontSize: "10px", color: gaugeColors[i],
                backgroundColor: "#0a162866", padding: { x: 8, y: 6 },
                align: "center",
            }).setDepth(12);
            this.trustLabels.push(label);
        });

        this.outcomeLog = this.scene.add.text(px, ZONE_Y + 130, "Outcomes: waiting for data...", {
            fontFamily: "monospace", fontSize: "8px", color: "#94a3b8",
            backgroundColor: "#0a162866", padding: { x: 6, y: 3 },
            wordWrap: { width: 780 },
        }).setDepth(12);
    }

    update(dt: number, dataBridge: DataBridge): void {
        this.spawnTimer += dt;
        this.beltOffset += dt * 0.035;

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
            this.scene.tweens.add({
                targets: this.bot, y: BELT_Y - 6, duration: 180, yoyo: true,
            });
        }

        // advance items along horizontal belt (left->right)
        const stageWidth = (BELT_RIGHT - BELT_LEFT) / L_STAGES.length;
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

            const x = BELT_LEFT + item.stageIdx * stageWidth + item.progress * stageWidth + stageWidth / 2;
            item.sprite.setPosition(x, BELT_Y + BELT_H / 2);
            item.label.setPosition(x, BELT_Y + BELT_H / 2 - 16);
        }

        this.items = this.items.filter(i => i.stageIdx < L_STAGES.length);

        // update trust data (migrated from FeedbackArc)
        const trust = dataBridge.trustCache;
        if (trust.length > 0) {
            const avgScore = trust.reduce((sum, t) => sum + t.score, 0) / trust.length;
            this.trustLabels[0]?.setText(`Agent Trust\n${avgScore.toFixed(1)}`);
        }
        if (bs) {
            this.trustLabels[1]?.setText(`Proposals\n${bs.proposals.total}`);
            this.trustLabels[2]?.setText(`Success Rate\n${bs.outcomes.successRate}%`);
        }

        // outcome log
        const outcomes = dataBridge.outcomeCache;
        if (outcomes.length > 0) {
            const logText = outcomes.slice(0, 3).map(o =>
                `[${o.success ? "OK" : "FAIL"}] ${o.id.slice(0, 8)}... ${o.status}`
            ).join("\n");
            this.outcomeLog?.setText(`Recent Outcomes:\n${logText}`);
        } else {
            const issueCount = bs?.issues.total ?? 0;
            this.outcomeLog?.setText(`Signals: ${bs?.signals.total.toLocaleString() ?? "?"} | Issues: ${issueCount} | Awaiting proposals...`);
        }

        this.drawGraphics();
        this.drawBelt();
    }

    private spawnItem(): void {
        const x = BELT_LEFT + 20;
        const y = BELT_Y + BELT_H / 2;
        const sprite = this.scene.add.image(x, y, "proposal-seal")
            .setDepth(20).setDisplaySize(16, 16);
        const label = this.scene.add.text(x, y - 16, "Proposal", {
            fontFamily: "monospace", fontSize: "7px", color: "#93c5fd",
            backgroundColor: "#0f172aee", padding: { x: 2, y: 1 },
        }).setDepth(21).setOrigin(0.5);

        this.items.push({ sprite, label, stageIdx: 0, progress: 0 });
    }

    private drawBelt(): void {
        this.beltG.clear();

        // belt track (horizontal)
        this.beltG.fillStyle(0x0d1b33, 0.85);
        this.beltG.fillRoundedRect(BELT_LEFT, BELT_Y, BELT_RIGHT - BELT_LEFT, BELT_H, 7);
        this.beltG.lineStyle(2, 0x60a5fa, 0.45);
        this.beltG.strokeRoundedRect(BELT_LEFT, BELT_Y, BELT_RIGHT - BELT_LEFT, BELT_H, 7);

        // rollers top & bottom
        for (let x = BELT_LEFT + 15; x < BELT_RIGHT - 10; x += 22) {
            this.beltG.fillStyle(0x60a5fa, 0.3);
            this.beltG.fillCircle(x, BELT_Y + 4, 3.5);
            this.beltG.fillCircle(x, BELT_Y + BELT_H - 4, 3.5);
            this.beltG.fillStyle(0x0d1b33, 0.8);
            this.beltG.fillCircle(x, BELT_Y + 4, 1.2);
            this.beltG.fillCircle(x, BELT_Y + BELT_H - 4, 1.2);
        }

        // moving treads
        const phase = this.beltOffset % 40;
        for (let x = BELT_LEFT + phase; x < BELT_RIGHT - 15; x += 40) {
            this.beltG.fillStyle(0x60a5fa, 0.1);
            this.beltG.fillRect(x, BELT_Y + 10, 18, BELT_H - 20);
        }

        // stage divider markers on belt
        const stageWidth = (BELT_RIGHT - BELT_LEFT) / L_STAGES.length;
        for (let i = 1; i < L_STAGES.length; i++) {
            const x = BELT_LEFT + i * stageWidth;
            this.beltG.lineStyle(1, 0x60a5fa, 0.3);
            this.beltG.lineBetween(x, BELT_Y + 2, x, BELT_Y + BELT_H - 2);
        }

        // voting indicator below L2
        const voteX = BELT_LEFT + 2 * stageWidth;
        this.beltG.fillStyle(0x22c55e, 0.35);
        this.beltG.fillRoundedRect(voteX + 5, BELT_Y + BELT_H + 4, 40, 12, 3);
        this.beltG.fillStyle(0xef4444, 0.25);
        this.beltG.fillRoundedRect(voteX + 48, BELT_Y + BELT_H + 4, 35, 12, 3);
    }

    private drawGraphics(): void {
        this.g.clear();

        // zone background
        this.g.fillStyle(0x10263f, 0.18);
        this.g.fillRoundedRect(ZONE_X, ZONE_Y, ZONE_W, ZONE_H, 10);
        this.g.lineStyle(2, 0x60a5fa, 0.45);
        this.g.strokeRoundedRect(ZONE_X, ZONE_Y, ZONE_W, ZONE_H, 10);

        // divider between pipeline and trust sections
        const divX = ZONE_X + 580;
        this.g.lineStyle(1, 0x60a5fa, 0.15);
        this.g.lineBetween(divX, ZONE_Y + 10, divX, ZONE_Y + ZONE_H - 10);

        // agent accent circles
        const now = this.scene.time.now;
        AGENTS.forEach((agent, i) => {
            const x = ZONE_X + 55 + i * 80;
            const y = ZONE_Y + 62;
            const active = Math.sin(now * 0.002 + i * 1.2) > 0;
            this.g.lineStyle(2, agent.color, active ? 0.6 : 0.15);
            this.g.strokeCircle(x, y, 18);
        });

        // stage highlight on belt when item is present
        const stageWidth = (BELT_RIGHT - BELT_LEFT) / L_STAGES.length;
        L_STAGES.forEach((_, i) => {
            const x = BELT_LEFT + i * stageWidth;
            const hasItem = this.items.some(it => it.stageIdx === i);
            if (hasItem) {
                this.g.fillStyle(0x1e3a5f, 0.3);
                this.g.fillRoundedRect(x + 2, BELT_Y + 2, stageWidth - 4, BELT_H - 4, 4);
            }
        });

        // trust gauge circles (right section)
        const gaugeColors = [0x22c55e, 0x3b82f6, 0xa855f7];
        const px = ZONE_X + 600;
        gaugeColors.forEach((color, i) => {
            const x = px + 30 + i * 230;
            const y = ZONE_Y + 66;
            this.g.lineStyle(2, color, 0.3);
            this.g.strokeCircle(x - 10, y + 8, 16);
        });
    }
}
