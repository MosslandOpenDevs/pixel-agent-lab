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

/** Explicit stack: bare "monospace" resolves to Courier on Safari/macOS, whose
 *  thin strokes are the worst possible face to downscale with nearest-neighbour. */
const MONO = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace';

const RING_LABELS: Record<string, string> = {
    official: "OFFICIAL",
    participation: "PARTICIPATION",
    developers: "DEVELOPERS",
    markets: "MARKETS",
    ecosystem: "ECOSYSTEM",
};

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
    label: HTMLDivElement;
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

/**
 * The hub draws in its own depth band, above every belt-zone object.
 *
 * Phaser depth is global to the scene, so a Bridge sprite at depth 12 paints
 * over the map's backdrop at depth 2 whenever the camera happens to see both —
 * and the hub is fitted by its circle, so it overscans the map rectangle by
 * ~2000px on a phone. No amount of spacing in world coordinates fixes that;
 * only ordering does.
 */
const D = 200;

const MAX_MOTES = 48;
const MAX_SPAWN_PER_TICK = 6;
const STAR_COUNT = 520;

/** Cursor influence: wide and soft, like the reference field. */
const PULL_RADIUS = 260;
const PULL_STRENGTH = 30;

/**
 * Radians/sec at the core; outer orbits turn slower (differential rotation).
 *
 * Was 0.020, which is a full turn every ~6.4 minutes — about 1.7px/s on the inner
 * ring. Technically animating, indistinguishable from a still image. At 0.05 the
 * inner ring moves ~4px/s and the outer ~7px/s: clearly alive when you look, and
 * still slow enough to ignore while reading a label.
 */
const SPIN_BASE = 0.05;

export class HubMap {
    private scene: Phaser.Scene;
    private cx: number;
    private cy: number;
    private w: number;
    private h: number;

    private starGfx?: Phaser.GameObjects.Graphics;
    private orbitGfx?: Phaser.GameObjects.Graphics;
    private stars: Star[] = [];

    private tipEl?: HTMLDivElement;
    private labelLayer?: HTMLDivElement;
    private hudEl?: HTMLDivElement;
    private countsEl?: HTMLElement;
    private activityEl?: HTMLElement;
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
        // Oversized on purpose: the camera fits the hub by its circle, so it
        // overscans this rectangle and the belt zones above used to show through
        // along the top edge.
        // Sized for the worst overscan, not for the map. A portrait phone fitted by
        // the hub circle sees ~2000px of world height, far past this rectangle, and
        // anything uncovered shows the belt zones behind. Cheap: one solid quad.
        this.scene.add.rectangle(this.cx, this.cy, 6000, 6000, 0x03060f).setDepth(D + 2);

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
        this.starGfx = this.scene.add.graphics().setDepth(D + 3);
        // Orbit guides, drawn every frame so they can stay faint and rotate-free.
        this.orbitGfx = this.scene.add.graphics().setDepth(D + 4);

        this.scene.add.circle(this.cx, this.cy, 34, 0x0b1226, 0.9).setStrokeStyle(2, COLOR.hub, 0.85).setDepth(D + 6);
        this.scene.add.circle(this.cx, this.cy, 22, COLOR.hub, 0.10).setDepth(D + 6);
        this.scene.add.circle(this.cx, this.cy, 9, COLOR.hub).setDepth(D + 7);
        this.crisp(this.scene.add.text(this.cx, this.cy + 44, "MOSSLAND", {
            fontFamily: MONO, fontSize: "14px", color: "#7dd3fc",
        }).setOrigin(0.5).setDepth(D + 7));

        // Ring names: the orbits were pure geometry before, carrying none of the
        // grouping they actually encode.
        for (const [section, r] of Object.entries(RING_RADII)) {
            this.crisp(this.scene.add.text(this.cx, this.cy - r - 9, RING_LABELS[section] ?? section, {
                fontFamily: MONO, fontSize: "10px", color: "#3f5b80",
            }).setOrigin(0.5, 1).setDepth(D + 5));
        }

        // The HUD lives in the DOM for the same reason as the tooltip: these are
        // fixed-position labels, and canvas text here is filtered NEAREST and then
        // downscaled twice, which is what made it mushy.
        this.buildHud();

        this.sweep = this.scene.add.circle(this.cx, this.cy, 1)
            .setStrokeStyle(2, COLOR.hub, 0.5).setDepth(D + 5).setVisible(false);

        // The tooltip is a DOM element, not a Phaser Text. The game runs with
        // `pixelArt: true`, which forces NEAREST filtering, and the whole 1440px
        // canvas is then downscaled to the stage (~0.68) and again by the camera
        // zoom. Small glyphs resampled at a non-integer factor with NEAREST are
        // exactly the mush that made this unreadable. A DOM node is rendered by
        // the browser at native resolution and stays crisp, without giving up the
        // pixel-art look of the scene itself.
        this.labelLayer = document.createElement("div");
        this.labelLayer.className = "hub-labels";
        document.body.appendChild(this.labelLayer);

        this.tipEl = document.createElement("div");
        this.tipEl.className = "hub-tip";
        this.tipEl.hidden = true;
        document.body.appendChild(this.tipEl);

        this.drawField(0, this.cx, this.cy, false);
    }

    /**
     * World-anchored text has to stay on the canvas, so make it survive the
     * downscale: render the glyph texture at 3x and let it filter LINEAR. The
     * game runs `pixelArt: true`, which sets NEAREST globally — right for the
     * sprites, ruinous for small text resampled at a non-integer factor.
     */
    /**
     * Projection constants for this frame. getBoundingClientRect forces layout,
     * so it is read once per frame rather than once per label — 28 labels at
     * 60fps would otherwise be ~1700 forced layouts a second.
     */
    private projection(): { left: number; top: number; right: number; bottom: number; s: number; vx: number; vy: number } | null {
        const canvas = this.scene.game.canvas;
        if (!canvas) return null;
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !canvas.width) return null;
        const cam = this.scene.cameras.main;
        return {
            left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
            s: (rect.width / canvas.width) * cam.zoom,   // world units -> page px
            vx: cam.worldView.x, vy: cam.worldView.y,
        };
    }

    /** World point -> page pixels, using this frame's projection. */
    private placeLabel(b: Body, wx: number, wy: number, p: NonNullable<ReturnType<HubMap["projection"]>>): void {
        const sx = p.left + (wx - p.vx) * p.s;
        const sy = p.top + (wy + b.baseR + 6 - p.vy) * p.s;
        // Off-camera labels are hidden rather than piling up along the edges.
        const inside = sx > p.left - 60 && sx < p.right + 60 && sy > p.top - 20 && sy < p.bottom + 20;
        b.label.style.transform = `translate(-50%, 0) translate(${Math.round(sx)}px, ${Math.round(sy)}px)`;
        b.label.style.visibility = inside ? "visible" : "hidden";
    }

    private crisp(t: Phaser.GameObjects.Text): Phaser.GameObjects.Text {
        // Resolution only. Text rebuilds its texture on every setText, which
        // discards any filter set here — so calling setFilter(LINEAR) looks like
        // it helps and silently reverts the moment the label updates. Rendering
        // the glyphs at 3x is what actually survives the downscale.
        t.setResolution(3);
        return t;
    }

    private buildHud(): void {
        // Anchor to #stage (which the canvas fills) rather than .stage-wrap, so
        // the HUD sits on the map instead of floating in the letterbox above it.
        const host = document.querySelector<HTMLElement>("#stage")
            ?? document.querySelector<HTMLElement>(".stage-wrap") ?? document.body;
        const el = document.createElement("div");
        el.className = "hub-hud";
        el.innerHTML = `
          <div class="hud-top">
            <div class="hud-title">ECOSYSTEM MAP</div>
            <div class="hud-counts" id="hubCounts">Loading registry…</div>
          </div>
          <div class="hud-legend">
            <div class="lg">
              <div class="lg-h">FORM — how much we see</div>
              <span><i class="f stream"></i>streaming · ringed, we read its data</span>
              <span><i class="f health"></i>health-checked · breathing, status only</span>
              <span><i class="f listed"></i>listed · steady, not measured here</span>
            </div>
            <div class="lg">
              <div class="lg-h">COLOUR — what it reports</div>
              <span><i class="c ok"></i>ok</span>
              <span><i class="c degraded"></i>degraded</span>
              <span><i class="c down"></i>down</span>
              <span><i class="c none"></i>no measurement</span>
              <span><i class="c arch"></i>archived</span>
            </div>
          </div>
          <div class="hud-foot"><span id="hubActivity"></span><span class="hud-hint">hover a body for detail · click to open it</span></div>`;
        host.appendChild(el);
        this.hudEl = el;
        this.countsEl = el.querySelector<HTMLElement>("#hubCounts") ?? undefined;
        this.activityEl = el.querySelector<HTMLElement>("#hubActivity") ?? undefined;
    }

    /** The HUD only makes sense over the map, so hide it in the belt zones. */
    setHudVisible(visible: boolean): void {
        if (this.hudEl) this.hudEl.hidden = !visible;
        if (this.labelLayer) this.labelLayer.hidden = !visible;
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
        if (this.activityEl) {
            this.activityEl.textContent =
                this.signalsSeen > 0 ? `${this.signalsSeen} signals ingested this session` : "";
        }
    }

    private emitMote(originId: string): void {
        const body = this.byId.get(originId);
        if (!body || this.motes.length >= MAX_MOTES) return;
        const dot = this.scene.add.circle(body.dot.x, body.dot.y, 2.5, COLOR.hub).setDepth(D + 11).setAlpha(0.95);
        this.motes.push({ dot, fromX: body.dot.x, fromY: body.dot.y, t: 0, speed: 0.55 + Math.random() * 0.35 });
    }

    setNodes(nodes: EcosystemNode[]): void {
        const signature = nodes
            .map(n => `${n.service.id}:${n.instrumentation}:${n.health?.status ?? "-"}:${n.service.lifecycle ?? "-"}`)
            .join("|");
        if (signature === this.signature) return;
        this.signature = signature;

        this.bodies.forEach(b => { b.dot.destroy(); b.glow?.destroy(); b.halo?.destroy(); b.label.remove(); });
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
        if (this.countsEl) {
            this.countsEl.innerHTML =
                `<b>${nodes.length}</b> registered <i>·</i> <b>${streaming}</b> streaming `
                + `<i>·</i> <b>${health}</b> health-checked <i>·</i> <b>${listed}</b> listed only`;
        }
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
            color, instrumentation === "listed" ? 0.09 : 0.13).setDepth(D + 8);
        dot = this.scene.add.circle(x, y, baseR, color);
        if (instrumentation === "stream") {
            halo = this.scene.add.circle(x, y, baseR + 9).setStrokeStyle(1.5, color, 0.5).setDepth(D + 9);
        }
        dot.setDepth(D + 10).setAlpha(archived ? 0.55 : instrumentation === "listed" ? 0.85 : 1);

        // DOM, not a Phaser Text. `pixelArt: true` forces NEAREST filtering, and
        // raising the Text resolution does not save it — the oversized glyph
        // texture is still point-sampled on the way down, so strokes get dropped
        // rather than smoothed. Rendering names in the DOM is the same fix that
        // made the tooltip and the HUD legible, and it has the extra property
        // that names keep a constant size instead of shrinking with camera zoom.
        const label = document.createElement("div");
        label.className = "hub-label " + instrumentation + (archived ? " archived" : "");
        label.textContent = service.name;
        this.labelLayer?.appendChild(label);

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
        // A single non-finite frame used to corrupt the map permanently: `elapsed`
        // and the per-body offsets accumulate, and NaN is absorbing, so once one
        // got in nothing recovered — every body froze where it stood even after
        // the clock was fine again. That matters more now the loop survives a bad
        // frame instead of dying on it: surviving into a frozen map is no better.
        if (!Number.isFinite(dt)) return;
        const step = Math.min(Math.max(dt, 0), 50) / 1000;
        this.elapsed += dt;
        if (!Number.isFinite(this.elapsed)) this.elapsed = 0;
        const t = this.elapsed / 1000;
        const spinT = this.reducedMotion ? 0 : t;

        const p = this.scene.input.activePointer;
        const px = p.worldX, py = p.worldY;
        const inside = Math.abs(px - this.cx) < this.w / 2 && Math.abs(py - this.cy) < this.h / 2;

        this.drawField(spinT, inside ? px : this.cx, inside ? py : this.cy, inside);

        if (this.tipEl && !this.tipEl.hidden) this.placeTooltip();

        const proj = this.bodies.length > 0 ? this.projection() : null;

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
            // Self-healing rather than absorbing: a poisoned offset resets instead
            // of pinning its body for the life of the page.
            if (!Number.isFinite(b.ox) || !Number.isFinite(b.oy)) { b.ox = 0; b.oy = 0; }

            const x = hx + b.ox, y = hy + b.oy;
            b.dot.setPosition(x, y);
            b.glow?.setPosition(x, y);
            b.halo?.setPosition(x, y);
            if (proj) this.placeLabel(b, x, y, proj);

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
            b.label.classList.toggle("hovered", b.hovered);
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
        this.hudEl?.remove();
        this.tipEl?.remove();
        this.labelLayer?.remove();
        this.byId.clear();
        this.bodies.forEach(b => { b.dot.destroy(); b.glow?.destroy(); b.halo?.destroy(); b.label.remove(); });
        this.bodies = [];
    }
}
