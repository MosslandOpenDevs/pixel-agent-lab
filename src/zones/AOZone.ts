import Phaser from "phaser";
import type { DataBridge } from "../services/data-bridge.ts";
import { str } from "../ui/html.ts";
import { reducedMotion } from "../ui/motion.ts";

const ZONE_X = 650;
const ZONE_Y = 44;
const ZONE_W = 780;
const ZONE_H = 386;

// Horizontal conveyor belt for ideas flowing left->right through scoring
const BELT_Y = ZONE_Y + 210;
const BELT_H = 40;
const BELT_LEFT = ZONE_X + 20;
const BELT_RIGHT = ZONE_X + ZONE_W - 20;

// The scores at which an idea becomes a plan, then a project, and where along
// the belt each threshold sits. The marker lines, their labels, the point where
// a bubble is promoted and a bubble's colour all read these, so they cannot
// drift apart. README.md / README.ko.md state the two scores; keep them in step.
const PLAN_SCORE = 7;
const PROJECT_SCORE = 8;
const PLAN_AT = 0.55;
const PROJECT_AT = 0.8;
/** A point along the belt, as a fraction of its length. */
const beltX = (frac: number): number => BELT_LEFT + (BELT_RIGHT - BELT_LEFT) * frac;

/** Where a bubble enters the belt, and how far along it each one moves in a
 *  spawn interval (2.8 s at 0.04 px/ms): the belt's step with motion reduced. */
const SPAWN_X = BELT_LEFT + 20;
const STEP_PX = 112;

/**
 * Where a bubble at `x` is drawn with motion reduced: in steps of STEP_PX
 * rather than sliding — every bubble spawns STEP_PX behind the one before, so
 * the belt moves one place at a time — except that a bubble at a threshold
 * is drawn on its marker, where it changes, never a step short of it.
 */
const steppedX = (x: number): number => {
    const step = SPAWN_X + Math.floor((x - SPAWN_X) / STEP_PX) * STEP_PX;
    const marker = x >= beltX(PROJECT_AT) ? beltX(PROJECT_AT) : x >= beltX(PLAN_AT) ? beltX(PLAN_AT) : -Infinity;
    return Math.max(SPAWN_X, step, marker);
};

/** Placeholder for a figure we do not have, as in the sidebar. */
const NA = "\u2014";
const figure = (n: number | null): string => (n === null ? NA : String(n));

// How long one debate stays on the card before another is picked.
const DEBATE_ROTATE_MS = 5_000;

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
    /** Elapsed time since the card last showed a debate. */
    private debateTimer = 0;
    /** Whether the card currently shows a debate rather than a placeholder. */
    private debateShown = false;
    private debateCard?: Phaser.GameObjects.Text;
    private debateSnippet?: Phaser.GameObjects.Text;
    private funnelText?: Phaser.GameObjects.Text;
    private bot!: Phaser.GameObjects.Sprite;

    // agent ring positions
    private divergeRing: Array<{ x: number; y: number }> = [];
    private convergeRing: Array<{ x: number; y: number }> = [];
    private planRing: Array<{ x: number; y: number }> = [];

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
        this.scene.add.text(beltX(PLAN_AT), BELT_Y - 13, `score\u2265${PLAN_SCORE}\u2192Plan`, {
            fontFamily: "monospace", fontSize: "8px", color: "#fcd34dcc",
        }).setDepth(12);
        this.scene.add.text(beltX(PROJECT_AT), BELT_Y - 13, `\u2265${PROJECT_SCORE}\u2192Project`, {
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
            `Ideas: ${NA} \u2192 Plans: ${NA} \u2192 Projects: ${NA}`, {
                fontFamily: "monospace", fontSize: "10px", color: "#fcd34d",
                backgroundColor: "#0b1226ee", padding: { x: 8, y: 4 },
            }).setOrigin(0.5).setDepth(12);
    }

    update(dt: number, dataBridge: DataBridge): void {
        // With reduced motion (read live) the ambient loops stop — treads, the
        // loader's animation and hop, the blinking agent rings — and the ideas
        // step along the belt instead of sliding (steppedX). Where each idea
        // is, and what it becomes at each threshold, is unchanged.
        const still = reducedMotion();
        this.spawnTimer += dt;
        if (!still) this.beltOffset += dt * 0.035;

        // animate bot
        const frame = still ? 0 : Math.floor(this.scene.time.now / 420) % 2;
        this.bot.setTexture(`ao-bot-${frame}`);

        // Debate card: a fresh pick every DEBATE_ROTATE_MS of elapsed time, and
        // at once when debates first arrive. It used to be gated on
        // `time.now % 5000 < 50`, which a 60 Hz frame lands in about three
        // times a window (each picking a different debate), a slow frame can
        // miss entirely, and which left the placeholder up for up to five
        // seconds after the data was already here.
        this.debateTimer += dt;
        if (dataBridge.debateCache.length === 0) {
            // Distinguish "AO is erroring" from "still loading" instead of
            // leaving the placeholder up forever.
            const msg = dataBridge.debatesErrored ? "AO debates unavailable" : "Awaiting debate data...";
            if (this.debateCard && this.debateCard.text !== msg) {
                this.debateCard.setText(msg);
                this.debateSnippet?.setText("");
            }
            this.debateShown = false;
        } else if (!this.debateShown || this.debateTimer >= DEBATE_ROTATE_MS) {
            // A pick can come back empty (a debate with no topic); then the
            // card keeps what it has and the next frame tries again.
            const debate = dataBridge.getRandomDebate();
            if (debate) {
                this.debateCard?.setText(`DEBATE: ${debate.topic}`);
                this.debateSnippet?.setText(debate.snippet);
                this.debateShown = true;
                this.debateTimer = 0;
            }
        }

        // spawn idea bubbles on belt
        if (this.spawnTimer > 2800 && this.bubbles.filter(b => b.phase !== "done").length < 8) {
            // Only ever spawn a bubble for an idea that actually came back from
            // the API. The belt previously invented a "Generating..." bubble with
            // a `Math.random() * 10` score whenever the cache was empty — which is
            // exactly when AO is down — and rendered it identically to real ideas.
            // With no data the belt simply stays quiet.
            const ideas = dataBridge.ideaCache;
            const idea = ideas.length > 0 ? ideas[Math.floor(Math.random() * ideas.length)] : undefined;
            if (idea) {
                const score = typeof idea.score === "number" && isFinite(idea.score) ? idea.score : 0;
                // `??` passes a title AO sent as a number or an object straight
                // through, and spawnBubble slices it — inside the frame, where
                // a throw stops every surface drawn after this one for as long
                // as the row stays in the cache. The belt card already guards
                // these two fields this way.
                this.spawnBubble(str(idea.title_ko) || str(idea.title) || "Idea", score);
                // The loader hops as it loads — only when it loads something.
                // It used to hop every 2.8 s with no idea to load at all.
                if (!still) {
                    this.scene.tweens.add({
                        targets: this.bot, y: BELT_Y - 6, duration: 150,
                        yoyo: true,
                    });
                }
            }
            this.spawnTimer = 0;
        }

        // move bubbles along belt (left->right)
        const planX = beltX(PLAN_AT);
        const projectX = beltX(PROJECT_AT);

        for (const b of this.bubbles) {
            if (b.phase === "belt") {
                b.x += dt * 0.04;

                // transform at score thresholds
                if (b.x >= planX && b.score >= PLAN_SCORE) {
                    b.sprite.setTexture("plan-doc");
                    b.sprite.setDisplaySize(18, 16);
                    if (b.score >= PROJECT_SCORE && b.x >= projectX) {
                        b.sprite.setTexture("project-box");
                        b.sprite.setDisplaySize(20, 18);
                        b.phase = "promoted";
                    }
                }

                // low-score items fade after passing threshold zone
                if (b.x >= planX && b.score < PLAN_SCORE) {
                    b.phase = "fading";
                }

                // reached end of belt
                if (b.x >= BELT_RIGHT - 10) {
                    b.phase = "promoted";
                }

                const x = still ? steppedX(b.x) : b.x;
                b.sprite.setPosition(x, BELT_Y + BELT_H / 2);
                b.label.setPosition(x, BELT_Y + BELT_H / 2 - 16);
            } else if (b.phase === "fading") {
                b.sprite.setAlpha(Math.max(0, b.sprite.alpha - dt * 0.002));
                b.label.setAlpha(b.sprite.alpha);
                b.x += dt * 0.02;
                const x = still ? steppedX(b.x) : b.x;
                b.sprite.setPosition(x, BELT_Y + BELT_H / 2 + 20);
                b.label.setPosition(x, BELT_Y + BELT_H / 2 + 6);
                if (b.sprite.alpha <= 0) b.phase = "done";
            } else if (b.phase === "promoted") {
                // Rises off the belt as it fades; with motion reduced it only
                // fades, where it stands.
                const x = still ? steppedX(b.x) : b.x;
                b.sprite.setPosition(x, b.sprite.y - (still ? 0 : dt * 0.03));
                b.label.setPosition(x, b.sprite.y - 14);
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
        // AO's own totals, or a dash for one we do not have — never the length
        // of a list we fetched, which is our fetch size, not AO's count. That is
        // the sidebar's rule, and this line used to break it: Projects was the
        // length of a 20-item page, and whenever /ao-api/status answered without
        // `stats` all three figures became fetch caps labelled as totals.
        // aoTotals() also guards that degraded body: this runs every frame, and
        // an unguarded deref would throw on each update and stop the Bridge and
        // CentralMonitor updates that follow it in SpaceHubScene.
        const t = dataBridge.aoTotals();
        this.funnelText?.setText(
            `Ideas: ${figure(t.ideas)} \u2192 Plans: ${figure(t.plans)} \u2192 Projects: ${figure(t.projects)}`
        );

        this.drawGraphics(still);
        this.drawBelt();
    }

    private spawnBubble(title: string, score: number): void {
        const x = SPAWN_X;
        const y = BELT_Y + BELT_H / 2;
        const sprite = this.scene.add.image(x, y, "idea-bubble")
            .setDepth(20).setDisplaySize(16, 16);
        const safeScore = Number.isFinite(score) ? score : 0;
        const scoreStr = safeScore.toFixed(1);
        const color = safeScore >= PROJECT_SCORE ? "#22c55e" : safeScore >= PLAN_SCORE ? "#fbbf24" : "#94a3b8";
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
        const planX = beltX(PLAN_AT);
        const projectX = beltX(PROJECT_AT);
        this.beltG.lineStyle(1, 0xfbbf24, 0.4);
        this.beltG.lineBetween(planX, BELT_Y + 2, planX, BELT_Y + BELT_H - 2);
        this.beltG.lineStyle(1, 0x22c55e, 0.35);
        this.beltG.lineBetween(projectX, BELT_Y + 2, projectX, BELT_Y + BELT_H - 2);
    }

    private drawGraphics(still: boolean): void {
        this.g.clear();

        // zone background
        this.g.fillStyle(0x3f2a12, 0.18);
        this.g.fillRoundedRect(ZONE_X, ZONE_Y, ZONE_W, ZONE_H, 10);
        this.g.lineStyle(2, 0xf59e0b, 0.45);
        this.g.strokeRoundedRect(ZONE_X, ZONE_Y, ZONE_W, ZONE_H, 10);

        const now = this.scene.time.now;

        // agent rings — decorative: which agents light up is not AO's data.
        // Held at one steady level while motion is reduced.
        this.divergeRing.forEach((p, i) => {
            const active = Math.sin(now * 0.002 + i * 0.5) > 0;
            this.g.fillStyle(0xf59e0b, still ? 0.5 : active ? 0.75 : 0.2);
            this.g.fillCircle(p.x, p.y, still ? 3.5 : active ? 4 : 3);
        });
        this.convergeRing.forEach((p, i) => {
            const active = Math.sin(now * 0.003 + i * 0.8) > 0.2;
            this.g.fillStyle(0xfbbf24, still ? 0.5 : active ? 0.8 : 0.2);
            this.g.fillCircle(p.x, p.y, still ? 3.5 : active ? 4 : 3);
        });
        this.planRing.forEach((p, i) => {
            const active = Math.sin(now * 0.004 + i * 0.6) > 0.3;
            this.g.fillStyle(0xfcd34d, still ? 0.55 : active ? 0.85 : 0.25);
            this.g.fillCircle(p.x, p.y, still ? 2.5 : active ? 3 : 2);
        });
    }
}
