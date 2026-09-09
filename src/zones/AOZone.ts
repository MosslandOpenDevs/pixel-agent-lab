import Phaser from "phaser";
import type { DataBridge } from "../services/data-bridge.ts";

const ZONE_X = 650;
const ZONE_Y = 44;
const ZONE_W = 780;
const ZONE_H = 386;

// Horizontal conveyor belt for ideas flowing left->right through scoring
const BELT_Y = ZONE_Y + 210;
const BELT_H = 40;
const BELT_LEFT = ZONE_X + 20;
const BELT_RIGHT = ZONE_X + ZONE_W - 20;

type IdeaBubble = {
    sprite: Phaser.GameObjects.Image;
    label: Phaser.GameObjects.Text;
    score: number;
    x: number;
    phase: "belt" | "promoted" | "fading" | "done";
    title: string;
};

export class AOZone {
    private scene: Phaser.Scene;
    private g!: Phaser.GameObjects.Graphics;
    private beltG!: Phaser.GameObjects.Graphics;
    private bubbles: IdeaBubble[] = [];
    private spawnTimer = 0;
    private beltOffset = 0;
    private debateCard?: Phaser.GameObjects.Text;
    private debateSnippet?: Phaser.GameObjects.Text;
    private funnelText?: Phaser.GameObjects.Text;
    private bot!: Phaser.GameObjects.Sprite;

    // agent ring positions
    private divergeRing: Array<{ x: number; y: number }> = [];
    private convergeRing: Array<{ x: number; y: number }> = [];
    private planRing: Array<{ x: number; y: number }> = [];

    totalIdeas = 0;
    totalPlans = 0;
    totalProjects = 0;

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
    }

    create(): void {
        this.g = this.scene.add.graphics().setDepth(5);
        this.beltG = this.scene.add.graphics().setDepth(6);

        // title
        this.scene.add.text(ZONE_X + 14, ZONE_Y + 8, "AO \u2014 Debate & Plan", {
            fontFamily: "monospace", fontSize: "12px", color: "#fcd34d",
            backgroundColor: "#0b1226ee", padding: { x: 6, y: 3 },
        }).setDepth(10);

        this.scene.add.text(ZONE_X + 14, ZONE_Y + 26, "Independent Service \u00b7 Port 3001 \u00b7 34 agents \u00b7 Signals\u2192Ideas\u2192Plans\u2192Projects", {
            fontFamily: "monospace", fontSize: "10px", color: "#fcd34d",
        }).setDepth(10);

        // loader bot at belt entrance
        this.bot = this.scene.add.sprite(BELT_LEFT + 10, BELT_Y - 18, "ao-bot-0")
            .setDepth(30).setDisplaySize(32, 32);

        this.createAgentRings();
        this.createDebateCard();
        this.createBeltLabels();
        this.createFunnel();
    }

    private createAgentRings(): void {
        const cx = ZONE_X + ZONE_W / 2;
        const cy = ZONE_Y + 76;

        for (let i = 0; i < 16; i++) {
            const a = (Math.PI * 2 * i) / 16 - Math.PI / 2;
            this.divergeRing.push({ x: cx + Math.cos(a) * 68, y: cy + Math.sin(a) * 25 });
        }
        for (let i = 0; i < 8; i++) {
            const a = (Math.PI * 2 * i) / 8 - Math.PI / 2;
            this.convergeRing.push({ x: cx + Math.cos(a) * 42, y: cy + Math.sin(a) * 15 });
        }
        for (let i = 0; i < 10; i++) {
            const a = (Math.PI * 2 * i) / 10 - Math.PI / 2;
            this.planRing.push({ x: cx + Math.cos(a) * 20, y: cy + Math.sin(a) * 8 });
        }

        this.scene.add.text(cx + 72, cy - 30, "Diverge(16)", {
            fontFamily: "monospace", fontSize: "7px", color: "#f59e0b88",
        }).setDepth(12);
        this.scene.add.text(cx + 46, cy - 18, "Conv(8)", {
            fontFamily: "monospace", fontSize: "7px", color: "#fbbf2488",
        }).setDepth(12);
        this.scene.add.text(cx - 8, cy - 10, "Plan(10)", {
            fontFamily: "monospace", fontSize: "7px", color: "#fcd34d88",
        }).setDepth(12).setOrigin(0.5);
    }

    private createDebateCard(): void {
        this.debateCard = this.scene.add.text(ZONE_X + ZONE_W / 2, ZONE_Y + 126, "Awaiting debate data...", {
            fontFamily: "monospace", fontSize: "10px", color: "#0b1220",
            backgroundColor: "#fde68a", padding: { x: 8, y: 4 },
            wordWrap: { width: ZONE_W - 60 },
        }).setOrigin(0.5).setDepth(15);

        this.debateSnippet = this.scene.add.text(ZONE_X + ZONE_W / 2, ZONE_Y + 148, "", {
            fontFamily: "monospace", fontSize: "8px", color: "#92400e",
            backgroundColor: "#fef3c7ee", padding: { x: 6, y: 3 },
            wordWrap: { width: ZONE_W - 80 },
        }).setOrigin(0.5, 0).setDepth(15);
    }

    private createBeltLabels(): void {
        const threshX7 = BELT_LEFT + (BELT_RIGHT - BELT_LEFT) * 0.55;
        const threshX8 = BELT_LEFT + (BELT_RIGHT - BELT_LEFT) * 0.8;

        this.scene.add.text(threshX7, BELT_Y - 13, "score\u22657\u2192Plan", {
            fontFamily: "monospace", fontSize: "8px", color: "#fcd34dcc",
        }).setDepth(12);
        this.scene.add.text(threshX8, BELT_Y - 13, "\u22658\u2192Project", {
            fontFamily: "monospace", fontSize: "8px", color: "#4ade80cc",
        }).setDepth(12);

        this.scene.add.text(BELT_LEFT, BELT_Y + BELT_H + 8, "\u2190 Ideas enter", {
            fontFamily: "monospace", fontSize: "7px", color: "#f59e0b44",
        }).setDepth(10);
        this.scene.add.text(BELT_RIGHT - 80, BELT_Y + BELT_H + 8, "Plans/Projects out \u2192", {
            fontFamily: "monospace", fontSize: "7px", color: "#22c55e44",
        }).setDepth(10);
    }

    private createFunnel(): void {
        this.funnelText = this.scene.add.text(ZONE_X + ZONE_W / 2, ZONE_Y + ZONE_H - 35,
            "Ideas: 0 \u2192 Plans: 0 \u2192 Projects: 0", {
                fontFamily: "monospace", fontSize: "10px", color: "#fcd34d",
                backgroundColor: "#0b1226ee", padding: { x: 8, y: 4 },
            }).setOrigin(0.5).setDepth(12);
    }

    update(dt: number, dataBridge: DataBridge): void {
        this.spawnTimer += dt;
        this.beltOffset += dt * 0.035;

        // animate bot
        const frame = Math.floor(this.scene.time.now / 420) % 2;
        this.bot.setTexture(`ao-bot-${frame}`);

        // update debate card
        const debate = dataBridge.getRandomDebate();
        if (debate) {
            if (this.scene.time.now % 5000 < 50) {
                this.debateCard?.setText(`DEBATE: ${debate.topic}`);
                this.debateSnippet?.setText(debate.snippet);
            }
        } else {
            // Distinguish "AO is erroring" from "still loading" instead of
            // leaving the placeholder up forever.
            const msg = dataBridge.debatesErrored ? "AO debates unavailable" : "Awaiting debate data...";
            if (this.debateCard && this.debateCard.text !== msg) {
                this.debateCard.setText(msg);
                this.debateSnippet?.setText("");
            }
        }

        // counts from real data
        this.totalIdeas = dataBridge.ideaCache.length;
        this.totalPlans = dataBridge.planCache.length;
        this.totalProjects = dataBridge.projectCache.length;

        // spawn idea bubbles on belt
        if (this.spawnTimer > 2800 && this.bubbles.filter(b => b.phase !== "done").length < 8) {
            const idea = dataBridge.ideaCache[Math.floor(Math.random() * Math.max(1, dataBridge.ideaCache.length))];
            if (idea) {
                const score = typeof idea.score === "number" && isFinite(idea.score) ? idea.score : 0;
                this.spawnBubble(idea.title_ko ?? idea.title ?? "Idea", score);
            } else {
                this.spawnBubble("Generating...", Math.random() * 10);
            }
            this.spawnTimer = 0;

            this.scene.tweens.add({
                targets: this.bot, y: BELT_Y - 6, duration: 150,
                yoyo: true,
            });
        }

        // move bubbles along belt (left->right)
        const beltLen = BELT_RIGHT - BELT_LEFT;
        const threshX7 = BELT_LEFT + beltLen * 0.55;
        const threshX8 = BELT_LEFT + beltLen * 0.8;

        for (const b of this.bubbles) {
            if (b.phase === "belt") {
                b.x += dt * 0.04;

                // transform at score thresholds
                if (b.x >= threshX7 && b.score >= 7) {
                    b.sprite.setTexture("plan-doc");
                    b.sprite.setDisplaySize(18, 16);
                    if (b.score >= 8 && b.x >= threshX8) {
                        b.sprite.setTexture("project-box");
                        b.sprite.setDisplaySize(20, 18);
                        b.phase = "promoted";
                    }
                }

                // low-score items fade after passing threshold zone
                if (b.x >= threshX7 && b.score < 7) {
                    b.phase = "fading";
                }

                // reached end of belt
                if (b.x >= BELT_RIGHT - 10) {
                    b.phase = "promoted";
                }

                b.sprite.setPosition(b.x, BELT_Y + BELT_H / 2);
                b.label.setPosition(b.x, BELT_Y + BELT_H / 2 - 16);
            } else if (b.phase === "fading") {
                b.sprite.setAlpha(Math.max(0, b.sprite.alpha - dt * 0.002));
                b.label.setAlpha(b.sprite.alpha);
                b.x += dt * 0.02;
                b.sprite.setPosition(b.x, BELT_Y + BELT_H / 2 + 20);
                b.label.setPosition(b.x, BELT_Y + BELT_H / 2 + 6);
                if (b.sprite.alpha <= 0) b.phase = "done";
            } else if (b.phase === "promoted") {
                b.sprite.setPosition(b.x, b.sprite.y - dt * 0.03);
                b.label.setPosition(b.x, b.sprite.y - 14);
                b.sprite.setAlpha(Math.max(0, b.sprite.alpha - dt * 0.001));
                b.label.setAlpha(b.sprite.alpha);
                if (b.sprite.alpha <= 0) b.phase = "done";
            }
        }

        // cleanup
        this.bubbles = this.bubbles.filter(b => {
            if (b.phase === "done") { b.sprite.destroy(); b.label.destroy(); return false; }
            return true;
        });

        // funnel
        // Guard `stats`, not just the envelope: /ao-api/status can answer 200
        // with a degraded body that omits `stats`, and this runs every frame —
        // an unguarded deref would throw on each update and stop the Bridge and
        // CentralMonitor updates that follow it in SpaceHubScene.
        const ls = dataBridge.liveStats.ao;
        if (ls?.stats) {
            this.funnelText?.setText(
                `Ideas: ${ls.stats.ideas_generated} \u2192 Plans: ${ls.stats.plans_created} \u2192 Projects: ${this.totalProjects}`
            );
        } else {
            this.funnelText?.setText(
                `Ideas: ${this.totalIdeas} \u2192 Plans: ${this.totalPlans} \u2192 Projects: ${this.totalProjects}`
            );
        }

        this.drawGraphics();
        this.drawBelt();
    }

    private spawnBubble(title: string, score: number): void {
        const x = BELT_LEFT + 20;
        const y = BELT_Y + BELT_H / 2;
        const sprite = this.scene.add.image(x, y, "idea-bubble")
            .setDepth(20).setDisplaySize(16, 16);
        const safeScore = Number.isFinite(score) ? score : 0;
        const scoreStr = safeScore.toFixed(1);
        const color = safeScore >= 8 ? "#22c55e" : safeScore >= 7 ? "#fbbf24" : "#94a3b8";
        const label = this.scene.add.text(x, y - 16, `${scoreStr} ${title.slice(0, 15)}`, {
            fontFamily: "monospace", fontSize: "7px", color,
            backgroundColor: "#0f172aee", padding: { x: 2, y: 1 },
        }).setOrigin(0.5).setDepth(21);

        this.bubbles.push({ sprite, label, score: safeScore, x, phase: "belt", title });
    }

    private drawBelt(): void {
        this.beltG.clear();

        // belt track (horizontal)
        this.beltG.fillStyle(0x2a1e0a, 0.85);
        this.beltG.fillRoundedRect(BELT_LEFT, BELT_Y, BELT_RIGHT - BELT_LEFT, BELT_H, 10);
        this.beltG.lineStyle(2, 0xf59e0b, 0.45);
        this.beltG.strokeRoundedRect(BELT_LEFT, BELT_Y, BELT_RIGHT - BELT_LEFT, BELT_H, 10);

        // rollers top & bottom
        for (let x = BELT_LEFT + 15; x < BELT_RIGHT - 10; x += 22) {
            this.beltG.fillStyle(0xfbbf24, 0.3);
            this.beltG.fillCircle(x, BELT_Y + 5, 3.5);
            this.beltG.fillCircle(x, BELT_Y + BELT_H - 5, 3.5);
            this.beltG.fillStyle(0x1f1305, 0.8);
            this.beltG.fillCircle(x, BELT_Y + 5, 1.2);
            this.beltG.fillCircle(x, BELT_Y + BELT_H - 5, 1.2);
        }

        // moving treads
        const phase = this.beltOffset % 40;
        for (let x = BELT_LEFT + phase; x < BELT_RIGHT - 15; x += 40) {
            this.beltG.fillStyle(0xfbbf24, 0.1);
            this.beltG.fillRect(x, BELT_Y + 12, 18, BELT_H - 24);
        }

        // threshold markers
        const beltLen = BELT_RIGHT - BELT_LEFT;
        const t7x = BELT_LEFT + beltLen * 0.55;
        const t8x = BELT_LEFT + beltLen * 0.8;
        this.beltG.lineStyle(1, 0xfbbf24, 0.4);
        this.beltG.lineBetween(t7x, BELT_Y + 2, t7x, BELT_Y + BELT_H - 2);
        this.beltG.lineStyle(1, 0x22c55e, 0.35);
        this.beltG.lineBetween(t8x, BELT_Y + 2, t8x, BELT_Y + BELT_H - 2);
    }

    private drawGraphics(): void {
        this.g.clear();

        // zone background
        this.g.fillStyle(0x3f2a12, 0.18);
        this.g.fillRoundedRect(ZONE_X, ZONE_Y, ZONE_W, ZONE_H, 10);
        this.g.lineStyle(2, 0xf59e0b, 0.45);
        this.g.strokeRoundedRect(ZONE_X, ZONE_Y, ZONE_W, ZONE_H, 10);

        const now = this.scene.time.now;

        // agent rings
        this.divergeRing.forEach((p, i) => {
            const active = Math.sin(now * 0.002 + i * 0.5) > 0;
            this.g.fillStyle(0xf59e0b, active ? 0.75 : 0.2);
            this.g.fillCircle(p.x, p.y, active ? 4 : 3);
        });
        this.convergeRing.forEach((p, i) => {
            const active = Math.sin(now * 0.003 + i * 0.8) > 0.2;
            this.g.fillStyle(0xfbbf24, active ? 0.8 : 0.2);
            this.g.fillCircle(p.x, p.y, active ? 4 : 3);
        });
        this.planRing.forEach((p, i) => {
            const active = Math.sin(now * 0.004 + i * 0.6) > 0.3;
            this.g.fillStyle(0xfcd34d, active ? 0.85 : 0.25);
            this.g.fillCircle(p.x, p.y, active ? 3 : 2);
        });
    }
}
