import Phaser from "phaser";
import type { DataBridge } from "../services/data-bridge.ts";

const ZONE_X = 460;
const ZONE_Y = 44;
const ZONE_W = 490;
const ZONE_H = 580;

type IdeaBubble = {
    sprite: Phaser.GameObjects.Image;
    label: Phaser.GameObjects.Text;
    score: number;
    y: number;
    targetY: number;
    phase: "diverge" | "converge" | "plan" | "done";
    title: string;
};

export class AOZone {
    private scene: Phaser.Scene;
    private g!: Phaser.GameObjects.Graphics;
    private bubbles: IdeaBubble[] = [];
    private spawnTimer = 0;
    private debateCard?: Phaser.GameObjects.Text;
    private debateSnippet?: Phaser.GameObjects.Text;
    private funnelText?: Phaser.GameObjects.Text;

    // agent ring positions
    private divergeRing: Array<{ x: number; y: number }> = [];
    private convergeRing: Array<{ x: number; y: number }> = [];
    private planRing: Array<{ x: number; y: number }> = [];

    // stats from real data
    totalIdeas = 0;
    totalPlans = 0;
    totalProjects = 0;

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
    }

    create(): void {
        this.g = this.scene.add.graphics().setDepth(5);

        // title
        this.scene.add.text(ZONE_X + 14, ZONE_Y + 8, "AO — Debate & Plan", {
            fontFamily: "monospace", fontSize: "12px", color: "#fcd34d",
            backgroundColor: "#0b1226ee", padding: { x: 6, y: 3 },
        }).setDepth(10);

        this.scene.add.text(ZONE_X + 14, ZONE_Y + 28, "34 agents · 3-phase debate · Signals→Ideas→Plans→Projects", {
            fontFamily: "monospace", fontSize: "9px", color: "#fbbf2488",
        }).setDepth(10);

        this.createAgentRings();
        this.createDebateCard();
        this.createThresholdLine();
        this.createFunnel();
    }

    private createAgentRings(): void {
        const cx = ZONE_X + ZONE_W / 2;
        const cy = ZONE_Y + 96;

        // outer: 16 divergence agents
        for (let i = 0; i < 16; i++) {
            const a = (Math.PI * 2 * i) / 16 - Math.PI / 2;
            this.divergeRing.push({ x: cx + Math.cos(a) * 68, y: cy + Math.sin(a) * 32 });
        }
        // middle: 8 convergence agents
        for (let i = 0; i < 8; i++) {
            const a = (Math.PI * 2 * i) / 8 - Math.PI / 2;
            this.convergeRing.push({ x: cx + Math.cos(a) * 42, y: cy + Math.sin(a) * 20 });
        }
        // inner: 10 planning agents
        for (let i = 0; i < 10; i++) {
            const a = (Math.PI * 2 * i) / 10 - Math.PI / 2;
            this.planRing.push({ x: cx + Math.cos(a) * 20, y: cy + Math.sin(a) * 10 });
        }

        // ring labels
        this.scene.add.text(cx + 72, cy - 40, "Diverge(16)", {
            fontFamily: "monospace", fontSize: "7px", color: "#f59e0b88",
        }).setDepth(12);
        this.scene.add.text(cx + 46, cy - 26, "Conv(8)", {
            fontFamily: "monospace", fontSize: "7px", color: "#fbbf2488",
        }).setDepth(12);
        this.scene.add.text(cx - 8, cy - 14, "Plan(10)", {
            fontFamily: "monospace", fontSize: "7px", color: "#fcd34d88",
        }).setDepth(12).setOrigin(0.5);
    }

    private createDebateCard(): void {
        this.debateCard = this.scene.add.text(ZONE_X + ZONE_W / 2, ZONE_Y + 150, "Awaiting debate data...", {
            fontFamily: "monospace", fontSize: "10px", color: "#0b1220",
            backgroundColor: "#fde68a", padding: { x: 8, y: 4 },
            wordWrap: { width: ZONE_W - 60 },
        }).setOrigin(0.5).setDepth(15);

        this.debateSnippet = this.scene.add.text(ZONE_X + ZONE_W / 2, ZONE_Y + 172, "", {
            fontFamily: "monospace", fontSize: "8px", color: "#92400e",
            backgroundColor: "#fef3c7ee", padding: { x: 6, y: 3 },
            wordWrap: { width: ZONE_W - 80 },
        }).setOrigin(0.5, 0).setDepth(15);
    }

    private createThresholdLine(): void {
        // score threshold at y = 370 area
        this.scene.add.text(ZONE_X + 18, 380, "── score ≥ 7.0 → Plan ─────", {
            fontFamily: "monospace", fontSize: "8px", color: "#fbbf2466",
        }).setDepth(12);
        this.scene.add.text(ZONE_X + 18, 440, "── score ≥ 8.0 → Project ───", {
            fontFamily: "monospace", fontSize: "8px", color: "#22c55e44",
        }).setDepth(12);
    }

    private createFunnel(): void {
        this.funnelText = this.scene.add.text(ZONE_X + ZONE_W / 2, ZONE_Y + ZONE_H - 50,
            "Ideas: 0 → Plans: 0 → Projects: 0", {
                fontFamily: "monospace", fontSize: "10px", color: "#fcd34d",
                backgroundColor: "#0b1226ee", padding: { x: 8, y: 4 },
            }).setOrigin(0.5).setDepth(12);
    }

    update(dt: number, dataBridge: DataBridge): void {
        this.spawnTimer += dt;

        // update debate card from real data
        const debate = dataBridge.getRandomDebate();
        if (debate && this.scene.time.now % 5000 < 50) {
            this.debateCard?.setText(`DEBATE: ${debate.topic}`);
            this.debateSnippet?.setText(debate.snippet);
        }

        // update counts from real data
        this.totalIdeas = dataBridge.ideaCache.length;
        this.totalPlans = dataBridge.planCache.length;
        this.totalProjects = dataBridge.projectCache.length;

        // spawn idea bubbles from real idea cache
        if (this.spawnTimer > 2500 && this.bubbles.length < 12) {
            const idea = dataBridge.ideaCache[Math.floor(Math.random() * Math.max(1, dataBridge.ideaCache.length))];
            if (idea) {
                this.spawnBubble(idea.title_ko ?? idea.title ?? "Idea", idea.score);
            } else {
                // mock fallback
                this.spawnBubble("Generating idea...", Math.random() * 10);
            }
            this.spawnTimer = 0;
        }

        // animate bubbles
        for (const b of this.bubbles) {
            if (b.phase === "diverge") {
                b.y -= dt * 0.02;
                if (b.y < 340) {
                    b.phase = "converge";
                }
            } else if (b.phase === "converge") {
                b.y -= dt * 0.015;
                if (b.score >= 7) {
                    if (b.y < 400) {
                        b.sprite.setTexture("plan-doc");
                        b.phase = "plan";
                    }
                } else {
                    b.sprite.setAlpha(Math.max(0, b.sprite.alpha - dt * 0.001));
                    if (b.sprite.alpha <= 0) b.phase = "done";
                }
            } else if (b.phase === "plan") {
                b.y -= dt * 0.01;
                if (b.score >= 8 && b.y < 460) {
                    b.sprite.setTexture("project-box");
                    b.phase = "done";
                    // keep visible briefly
                    this.scene.time.delayedCall(2000, () => {
                        b.sprite.destroy();
                        b.label.destroy();
                    });
                }
                if (b.y < 420) b.phase = "done";
            }

            if (b.phase !== "done") {
                b.sprite.setPosition(b.sprite.x, b.y);
                b.label.setPosition(b.sprite.x + 14, b.y - 4);
            }
        }

        this.bubbles = this.bubbles.filter(b => {
            if (b.phase === "done" && b.sprite.alpha <= 0) {
                b.sprite.destroy();
                b.label.destroy();
                return false;
            }
            return b.phase !== "done" || b.sprite.active;
        });

        // update funnel
        const ls = dataBridge.liveStats.ao;
        if (ls) {
            this.funnelText?.setText(
                `Ideas: ${ls.stats.ideas_generated} → Plans: ${ls.stats.plans_created} → Projects: ${this.totalProjects}`
            );
        } else {
            this.funnelText?.setText(
                `Ideas: ${this.totalIdeas} → Plans: ${this.totalPlans} → Projects: ${this.totalProjects}`
            );
        }

        this.drawGraphics();
    }

    private spawnBubble(title: string, score: number): void {
        const x = ZONE_X + 60 + Math.random() * (ZONE_W - 120);
        const y = ZONE_Y + ZONE_H - 140;
        const sprite = this.scene.add.image(x, y, "idea-bubble")
            .setDepth(18).setDisplaySize(18, 18);
        const scoreStr = score.toFixed(1);
        const color = score >= 8 ? "#22c55e" : score >= 7 ? "#fbbf24" : "#94a3b8";
        const label = this.scene.add.text(x + 14, y - 4, `${scoreStr} ${title.slice(0, 18)}`, {
            fontFamily: "monospace", fontSize: "7px", color,
            backgroundColor: "#0f172aee", padding: { x: 2, y: 1 },
        }).setDepth(19);

        this.bubbles.push({ sprite, label, score, y, targetY: 200, phase: "diverge", title });
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

        // threshold lines
        this.g.lineStyle(1, 0xfbbf24, 0.15);
        this.g.lineBetween(ZONE_X + 14, 388, ZONE_X + ZONE_W - 14, 388);
        this.g.lineStyle(1, 0x22c55e, 0.12);
        this.g.lineBetween(ZONE_X + 14, 448, ZONE_X + ZONE_W - 14, 448);
    }
}
