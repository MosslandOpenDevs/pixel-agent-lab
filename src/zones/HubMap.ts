import Phaser from "phaser";
import type { EcosystemNode, Instrumentation } from "../services/ecosystem-feed.ts";

/**
 * The Space Hub map: the Mossland ecosystem as a slowly turning galaxy, with
 * every registered service a body in orbit around the registry at its core.
 *
 * The rule the visuals encode: **a body may only look as alive as the data
 * behind it.** Most of the ecosystem exposes nothing but a registry entry, so
 * drawing 28 busy belts would be a lie.
 *
 *   listed  → hollow, dim, does not breathe. We know it exists. Nothing more.
 *   health  → filled and breathing, coloured by the aggregator's verdict.
 *   stream  → bright, haloed, and its belt is one click away.
 *
 * Two kinds of motion, kept deliberately distinct:
 *
 *   Ambient — the galaxy's slow differential rotation and the cursor swirl.
 *   Uniform across every body, so it carries no per-service information and
 *   cannot imply activity. It is framing, the way the starfield is.
 *
 *   Meaningful — the breathing pulse (only for observed bodies), the motes
 *   (one per signal actually ingested) and the sweep (one per real health
 *   refresh). Each corresponds to something that happened.
 */

const RING_RADII: Record<string, number> = {
    official: 104,
    participation: 172,
    developers: 240,
    markets: 308,
    ecosystem: 376,
};
const RING_FALLBACK = 376;

const COLOR = {
    ok: 0x22c55e,
    degraded: 0xf59e0b,
    down: 0xef4444,
    /** Not measured — a calm blue-white star, NOT a dead one. Most of these are
     *  perfectly healthy sites we simply do not probe, and rendering them as
     *  unlit husks implied an outage: dishonest in the opposite direction. */
    unmeasured: 0xa9c4e8,
    archived: 0xc08a5e,
    hub: 0x38bdf8,
};

type Mote = { dot: Phaser.GameObjects.Arc; fromX: number; fromY: number; t: number; speed: number };

/** A background star: polar so the field can rotate differentially. */
type Star = { r: number; a: number; spin: number; size: number; alpha: number; tint: number };

type Body = {
    node: EcosystemNode;
    dot: Phaser.GameObjects.Arc;
    glow?: Phaser.GameObjects.Arc;
    halo?: Phaser.GameObjects.Arc;
    label: Phaser.GameObjects.Text;
    /** Orbit, in polar coords around the hub. */
    r: number;
    a: number;
    spin: number;
    /** Cursor-driven offset from the orbit position. */
    ox: number;
    oy: number;
    baseR: number;
    color: number;
    phase: number;
    instrumentation: Instrumentation;
    archived: boolean;
    hovered: boolean;
};

const MAX_MOTES = 48;
const MAX_SPAWN_PER_TICK = 6;
const STAR_COUNT = 520;

/** Cursor influence: wide and soft, like the reference field. */
const PULL_RADIUS = 260;
const PULL_STRENGTH = 30;

/** Radians/sec at the core. Outer orbits turn slower (differential rotation). */
const SPIN_BASE = 0.020;

export class HubMap {
    private scene: Phaser.Scene;
    private cx: number;
    private cy: number;
    private w: number;
    private h: number;

    private starGfx?: Phaser.GameObjects.Graphics;
    private orbitGfx?: Phaser.GameObjects.Graphics;
    private stars: Star[] = [];

    private summary?: Phaser.GameObjects.Text;
    private tipEl?: HTMLDivElement;
    private activityText?: Phaser.GameObjects.Text;
    private hint?: Phaser.GameObjects.Text;
    private bodies: Body[] = [];

    private signature = "";
    private elapsed = 0;
    private reducedMotion = false;

    private motes: Mote[] = [];
    private byId = new Map<string, Body>();
    private lastIngested: Record<string, number> | null = null;
    private lastHealthAt: string | null = null;
    private sweep?: Phaser.GameObjects.Arc;
    private sweepT = 1;
    private signalsSeen = 0;

    /** Set by the scene so a streaming body can open its belt. */
    onOpenZone?: (zone: string) => void;

    constructor(scene: Phaser.Scene, cx: number, cy: number, w: number, h: number) {
        this.scene = scene;
        this.cx = cx; this.cy = cy; this.w = w; this.h = h;
    }

    create(): void {
        this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        // Own backdrop, so the service zones above cannot bleed into this view.
        this.scene.add.rectangle(this.cx, this.cy, this.w, this.h, 0x03060f).setDepth(2);

        const maxR = Math.hypot(this.w, this.h) / 2;
        for (let i = 0; i < STAR_COUNT; i++) {
            // sqrt keeps the field even rather than clumped at the core.
            const r = Math.sqrt(Math.random()) * maxR;
            const depth = Phaser.Math.FloatBetween(0.2, 1);
            this.stars.push({
                r,
                a: Math.random() * Math.PI * 2,
                spin: SPIN_BASE * (0.35 + 0.65 * (1 - r / maxR)),
                size: 0.5 + depth * 1.6,
                alpha: 0.10 + depth * 0.45,
                tint: Math.random() < 0.12 ? 0x7dd3fc : 0xdbeafe,
            });
        }
        this.starGfx = this.scene.add.graphics().setDepth(3);
        // Orbit guides, drawn every frame so they can stay faint and rotate-free.
        this.orbitGfx = this.scene.add.graphics().setDepth(4);

        this.scene.add.circle(this.cx, this.cy, 34, 0x0b1226, 0.9).setStrokeStyle(2, COLOR.hub, 0.85).setDepth(6);
        this.scene.add.circle(this.cx, this.cy, 22, COLOR.hub, 0.10).setDepth(6);
        this.scene.add.circle(this.cx, this.cy, 9, COLOR.hub).setDepth(7);
        this.scene.add.text(this.cx, this.cy + 44, "MOSSLAND", {
            fontFamily: "monospace", fontSize: "14px", color: "#7dd3fc",
        }).setOrigin(0.5).setDepth(7);

        this.summary = this.scene.add.text(this.cx, this.cy - this.h / 2 + 26, "Loading registry…", {
            fontFamily: "monospace", fontSize: "15px", color: "#cbd5e1",
            backgroundColor: "#03060fcc", padding: { x: 12, y: 5 },
        }).setOrigin(0.5).setDepth(8);

        this.activityText = this.scene.add.text(this.cx, this.cy + this.h / 2 - 44, "", {
            fontFamily: "monospace", fontSize: "13px", color: "#64748b",
        }).setOrigin(0.5).setDepth(8);

        this.hint = this.scene.add.text(this.cx, this.cy + this.h / 2 - 24,
            "hover a body for detail  ·  click to open it", {
            fontFamily: "monospace", fontSize: "11px", color: "#3f4d63",
        }).setOrigin(0.5).setDepth(8);

        this.sweep = this.scene.add.circle(this.cx, this.cy, 1)
            .setStrokeStyle(2, COLOR.hub, 0.5).setDepth(5).setVisible(false);

        // The tooltip is a DOM element, not a Phaser Text. The game runs with
        // `pixelArt: true`, which forces NEAREST filtering, and the whole 1440px
        // canvas is then downscaled to the stage (~0.68) and again by the camera
        // zoom. Small glyphs resampled at a non-integer factor with NEAREST are
        // exactly the mush that made this unreadable. A DOM node is rendered by
        // the browser at native resolution and stays crisp, without giving up the
        // pixel-art look of the scene itself.
        this.tipEl = document.createElement("div");
        this.tipEl.className = "hub-tip";
        this.tipEl.hidden = true;
        document.body.appendChild(this.tipEl);

        this.drawField(0, this.cx, this.cy, false);
    }

    setActivity(ingested: Record<string, number>, healthCheckedAt: string | null): void {
        if (this.lastIngested) {
            for (const [origin, total] of Object.entries(ingested)) {
                const delta = total - (this.lastIngested[origin] ?? 0);
                if (delta > 0) {
                    this.signalsSeen += delta;
                    if (!this.reducedMotion) {
                        for (let i = 0; i < Math.min(delta, MAX_SPAWN_PER_TICK); i++) this.emitMote(origin);
                    }
                }
            }
        }
        this.lastIngested = { ...ingested };

        if (healthCheckedAt && healthCheckedAt !== this.lastHealthAt) {
            this.lastHealthAt = healthCheckedAt;
            if (!this.reducedMotion) this.sweepT = 0;
        }
        this.activityText?.setText(
            this.signalsSeen > 0 ? `${this.signalsSeen} signals ingested this session` : "",
        );
    }

    private emitMote(originId: string): void {
        const body = this.byId.get(originId);
        if (!body || this.motes.length >= MAX_MOTES) return;
        const dot = this.scene.add.circle(body.dot.x, body.dot.y, 2.5, COLOR.hub).setDepth(11).setAlpha(0.95);
        this.motes.push({ dot, fromX: body.dot.x, fromY: body.dot.y, t: 0, speed: 0.55 + Math.random() * 0.35 });
    }

    setNodes(nodes: EcosystemNode[]): void {
        const signature = nodes
            .map(n => `${n.service.id}:${n.instrumentation}:${n.health?.status ?? "-"}:${n.service.lifecycle ?? "-"}`)
            .join("|");
        if (signature === this.signature) return;
        this.signature = signature;

        this.bodies.forEach(b => { b.dot.destroy(); b.glow?.destroy(); b.halo?.destroy(); b.label.destroy(); });
        this.bodies = [];
        this.byId.clear();

        const groups = new Map<string, EcosystemNode[]>();
        for (const n of nodes) {
            const key = RING_RADII[n.service.section] ? n.service.section : "ecosystem";
            const list = groups.get(key);
            if (list) list.push(n); else groups.set(key, [n]);
        }

        for (const [section, list] of groups) {
            const r = RING_RADII[section] ?? RING_FALLBACK;
            list.forEach((node, i) => {
                const a = -Math.PI / 2 + (i / list.length) * Math.PI * 2;
                const body = this.makeBody(node, r, a, i);
                this.bodies.push(body);
                this.byId.set(node.service.id, body);
            });
        }

        const streaming = nodes.filter(n => n.instrumentation === "stream").length;
        const health = nodes.filter(n => n.instrumentation === "health").length;
        const listed = nodes.filter(n => n.instrumentation === "listed").length;
        this.summary?.setText(
            `${nodes.length} registered   ·   ${streaming} streaming   ·   ${health} health-checked   ·   ${listed} listed only`,
        );
    }

    private makeBody(node: EcosystemNode, r: number, a: number, index: number): Body {
        const { service, health, instrumentation } = node;
        const archived = service.lifecycle === "archive" || service.status === "deprecated";
        // Colour carries the health claim, and only a real verdict earns a
        // verdict colour. No measurement means the neutral star — present, lit,
        // and making no claim either way.
        const statusColor = health
            ? (COLOR[health.status as keyof typeof COLOR] as number) ?? COLOR.unmeasured
            : COLOR.unmeasured;
        const color = archived ? COLOR.archived : statusColor;

        const baseR = instrumentation === "stream" ? 10 : instrumentation === "health" ? 7.5 : 5;
        const x = this.cx + Math.cos(a) * r;
        const y = this.cy + Math.sin(a) * r;

        let dot: Phaser.GameObjects.Arc;
        let glow: Phaser.GameObjects.Arc | undefined;
        let halo: Phaser.GameObjects.Arc | undefined;

        // Every registered service is a lit star. What instrumentation changes is
        // the *character* of the light, never whether there is any: unmeasured
        // ones shine steadily, measured ones breathe, streaming ones carry a halo.
        glow = this.scene.add.circle(x, y, baseR * (instrumentation === "listed" ? 2.0 : 2.6),
            color, instrumentation === "listed" ? 0.09 : 0.13).setDepth(8);
        dot = this.scene.add.circle(x, y, baseR, color);
        if (instrumentation === "stream") {
            halo = this.scene.add.circle(x, y, baseR + 9).setStrokeStyle(1.5, color, 0.5).setDepth(9);
        }
        dot.setDepth(10).setAlpha(archived ? 0.55 : instrumentation === "listed" ? 0.85 : 1);

        const label = this.scene.add.text(x, y + baseR + 5, service.name, {
            fontFamily: "monospace",
            fontSize: instrumentation === "stream" ? "13px" : "11px",
            color: archived ? "#c08a5e" : instrumentation === "listed" ? "#a9c4e8" : "#e2e8f0",
        }).setOrigin(0.5, 0).setDepth(10);
        if (archived) label.setAlpha(0.8);

        // Generous hit area — the dots are small, the targets should not be.
        dot.setInteractive(new Phaser.Geom.Circle(baseR, baseR, baseR + 16), Phaser.Geom.Circle.Contains);

        const body: Body = {
            node, dot, glow, halo, label,
            r, a, spin: SPIN_BASE * (0.35 + 0.65 * (1 - r / RING_RADII.ecosystem)),
            ox: 0, oy: 0, baseR, color, phase: index * 0.7, instrumentation, archived, hovered: false,
        };

        dot.on("pointerover", () => { body.hovered = true; this.showTooltip(body); this.scene.input.setDefaultCursor("pointer"); });
        dot.on("pointerout", () => { body.hovered = false; if (this.tipEl) this.tipEl.hidden = true; this.scene.input.setDefaultCursor("default"); });
        dot.on("pointerup", () => this.activate(body));
        return body;
    }

    private showTooltip(b: Body): void {
        const el = this.tipEl;
        if (!el) return;
        const { service: sv, health, instrumentation } = b.node;
        const esc = (v: string) => v.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
        const measured = health
            ? `<b class="ok">health ${esc(health.status)}</b>${health.latencyMs != null ? ` · ${health.latencyMs}ms` : ""}`
            : `<span class="dim">not measured by this monitor</span>`;
        el.innerHTML = `<div class="t">${esc(sv.name)}</div>`
            + `<div class="m">${esc(sv.lifecycle ?? "lifecycle unspecified")} · ${esc(instrumentation)}</div>`
            + `<div class="m">${measured}</div>`
            + (b.archived ? `<div class="m dim">archived — preserved read-only</div>` : "")
            + `<div class="a">${instrumentation === "stream" ? "click to open its belt" : "click to open the service"}</div>`;
        el.hidden = false;
        this.placeTooltip();
    }

    /** Follows the real cursor, in page coordinates. */
    private placeTooltip(): void {
        const el = this.tipEl;
        const p = this.scene.input.activePointer;
        if (!el || el.hidden) return;
        const pad = 14;
        const r = el.getBoundingClientRect();
        let x = p.event ? (p.event as MouseEvent).clientX + pad : 0;
        let y = p.event ? (p.event as MouseEvent).clientY + pad : 0;
        if (x + r.width > window.innerWidth - 8) x = window.innerWidth - r.width - 8;
        if (y + r.height > window.innerHeight - 8) y -= r.height + pad * 2;
        el.style.left = `${Math.max(8, x)}px`;
        el.style.top = `${Math.max(8, y)}px`;
    }

    private activate(b: Body): void {
        const id = b.node.service.id;
        if (b.instrumentation === "stream" && this.onOpenZone && (id === "algora" || id === "ao" || id === "bridge")) {
            this.onOpenZone(id);
            return;
        }
        window.open(b.node.service.url, "_blank", "noopener,noreferrer");
    }

    /**
     * Paints the starfield and orbit guides. Called from create() as well as
     * update() so the very first paint is complete — these are Graphics, not
     * persistent GameObjects, so without this the map would show nothing but
     * bodies until a frame ran.
     */
    private drawField(spinT: number, px: number, py: number, parallax: boolean): void {
        const g = this.starGfx;
        if (g) {
            g.clear();
            for (const s of this.stars) {
                const a = s.a + s.spin * spinT;
                let x = this.cx + Math.cos(a) * s.r;
                let y = this.cy + Math.sin(a) * s.r;
                if (parallax && !this.reducedMotion) {
                    const k = (s.size / 2.1) * 0.05;
                    x += (px - this.cx) * k;
                    y += (py - this.cy) * k;
                }
                g.fillStyle(s.tint, s.alpha);
                g.fillCircle(x, y, s.size);
            }
        }
        const og = this.orbitGfx;
        if (og) {
            og.clear();
            og.lineStyle(1, 0x1e3a5f, 0.35);
            for (const r of Object.values(RING_RADII)) og.strokeCircle(this.cx, this.cy, r);
        }
    }

    update(dt: number): void {
        this.elapsed += dt;
        const t = this.elapsed / 1000;
        const step = Math.min(dt, 50) / 1000;
        const spinT = this.reducedMotion ? 0 : t;

        const p = this.scene.input.activePointer;
        const px = p.worldX, py = p.worldY;
        const inside = Math.abs(px - this.cx) < this.w / 2 && Math.abs(py - this.cy) < this.h / 2;

        this.drawField(spinT, inside ? px : this.cx, inside ? py : this.cy, inside);

        if (this.tipEl && !this.tipEl.hidden) this.placeTooltip();

        for (const b of this.bodies) {
            const a = b.a + b.spin * spinT;
            const hx = this.cx + Math.cos(a) * b.r;
            const hy = this.cy + Math.sin(a) * b.r;

            let tx = 0, ty = 0;
            if (!this.reducedMotion && inside) {
                const dx = px - hx, dy = py - hy;
                const d = Math.hypot(dx, dy);
                if (d < PULL_RADIUS && d > 0.01) {
                    const f = (1 - d / PULL_RADIUS) ** 2 * PULL_STRENGTH;
                    tx = (dx / d) * f; ty = (dy / d) * f;
                }
            }
            b.ox += (tx - b.ox) * Math.min(1, step * 6);
            b.oy += (ty - b.oy) * Math.min(1, step * 6);

            const x = hx + b.ox, y = hy + b.oy;
            b.dot.setPosition(x, y);
            b.glow?.setPosition(x, y);
            b.halo?.setPosition(x, y);
            b.label.setPosition(x, y + b.baseR + 5);

            // Only bodies we can actually observe are allowed to breathe.
            // Breathing is a claim that something is being watched, so only
            // measured bodies do it. The rest hold a steady light rather than
            // going dark.
            const observed = b.instrumentation !== "listed" && !b.archived && !this.reducedMotion;
            const pulse = observed ? 0.78 + 0.22 * Math.sin(t * 1.8 + b.phase) : 1;
            const rest = b.archived ? 0.55 : b.instrumentation === "listed" ? 0.85 : 1;
            b.dot.setAlpha(rest * pulse);
            b.glow?.setAlpha(observed ? 0.10 + 0.07 * Math.sin(t * 1.8 + b.phase)
                : b.instrumentation === "listed" ? 0.09 : 0.08);
            if (b.halo) b.halo.setScale(0.92 + (observed ? 0.14 * Math.sin(t * 1.8 + b.phase) : 0));

            const want = b.hovered ? 1.6 : 1;
            b.dot.setScale(b.dot.scaleX + (want - b.dot.scaleX) * Math.min(1, step * 12));
            b.label.setAlpha(b.hovered ? 1 : b.instrumentation === "listed" ? 0.7 : 0.95);
        }

        if (this.reducedMotion) return;

        for (let i = this.motes.length - 1; i >= 0; i--) {
            const m = this.motes[i];
            m.t += step * m.speed;
            if (m.t >= 1) { m.dot.destroy(); this.motes.splice(i, 1); continue; }
            const e = m.t * m.t;
            m.dot.setPosition(m.fromX + (this.cx - m.fromX) * e, m.fromY + (this.cy - m.fromY) * e);
            m.dot.setAlpha(0.95 * (1 - m.t * 0.6));
        }

        if (this.sweepT < 1) {
            this.sweepT = Math.min(1, this.sweepT + dt / 1100);
            this.sweep?.setVisible(true)
                .setRadius(34 + this.sweepT * (RING_RADII.ecosystem + 24))
                .setStrokeStyle(2, COLOR.hub, 0.5 * (1 - this.sweepT));
        } else {
            this.sweep?.setVisible(false);
        }
    }

    destroy(): void {
        this.motes.forEach(m => m.dot.destroy());
        this.motes = [];
        this.starGfx?.destroy();
        this.orbitGfx?.destroy();
        this.sweep?.destroy();
        this.activityText?.destroy();
        this.hint?.destroy();
        this.tipEl?.remove();
        this.summary?.destroy();
        this.byId.clear();
        this.bodies.forEach(b => { b.dot.destroy(); b.glow?.destroy(); b.halo?.destroy(); b.label.destroy(); });
        this.bodies = [];
    }
}
