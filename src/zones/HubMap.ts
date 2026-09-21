import Phaser from "phaser";
import type {
    EcosystemNode, HealthFreshness, Instrumentation, NodeKind, RegistryState,
} from "../services/ecosystem-feed.ts";
import type { ConnState, ServiceFlags } from "../services/data-bridge.ts";
import { hubTooltipHtml } from "../ui/hub-tooltip.ts";
import {
    freshnessText, healthBucket, isArchived, namesHtml, shortClock, tallyHtml, tallyServices,
} from "../ui/ecosystem-status.ts";

/** This monitor's own id in the registry. Its star is the one place on the map
 *  the viewer is already standing, which changes what a click can usefully do. */
const SELF_ID = "monitor";

/**
 * The Space Hub map: the Mossland ecosystem as a slowly turning galaxy, with
 * every registered service a body in orbit around the registry at its core.
 *
 * The rule the visuals encode: **a body may only look as alive as the data
 * behind it.** Drawing 28 busy belts would be a lie.
 *
 *   listed  → hollow, dim, does not breathe. We know it exists. Nothing more.
 *   health  → filled and breathing, coloured by its own reported status.
 *   stream  → bright, haloed, and its belt is one click away. It breathes
 *             while its data API answers or it carries a health reading.
 *
 * A reading only counts as observed while it is current. Once no health sweep
 * has landed for STALE_AFTER_MS (the viewer's network is gone, say), every
 * measured body stops breathing and dims, and the HUD dates the reading
 * instead: the colours stay — they are the last thing known — but a snapshot
 * hours old must not pulse like a live one.
 *
 * Colour is never the only carrier of a verdict. A down or degraded body names
 * it on its label too, which is what a red-green colour-blind viewer — and
 * anyone on a phone, where the legend is hidden — can read. That is text, not
 * a new shape: shape is the FORM axis, and it is spoken for.
 *
 * A second axis, and the one that decides whether the first even applies: not
 * every registry entry is a service. `llms.txt`, `sitemap.xml` and the registry
 * JSON are *files*; the GitHub orgs, Medium, X and the exchange listings are
 * *destinations*. None of them can be "degraded", so none of them are graded —
 * they are drawn as small quiet marks. Asking whether llms.txt is up is not a
 * question with an answer, and a map that invites it is a map that misleads.
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
    kind: NodeKind;
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
export const HUB_DEPTH = 200;
const D = HUB_DEPTH;

const MAX_MOTES = 48;
const MAX_SPAWN_PER_TICK = 6;
const STAR_COUNT = 520;
/** Half the side of a square with the area of a unit circle: √π / 2. */
const STAR_HALF_SIDE = Math.sqrt(Math.PI) / 2;

/** How far a measured body dims while its reading is stale. */
const STALE_DIM = 0.45;
/** Names per verdict in the HUD, which sits over the map; the sidebar lists all. */
const HUD_NAMES = 4;

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
    /** World-anchored DOM text that is not attached to a body (rings, core). */
    private pinned: { el: HTMLDivElement; wx: number; wy: number }[] = [];
    private hudEl?: HTMLDivElement;
    private countsEl?: HTMLElement;
    private connEl?: HTMLElement;
    private clockEl?: HTMLElement;
    private tallyEl?: HTMLElement;
    private namesEl?: HTMLElement;
    private activityEl?: HTMLElement;
    /** The markup each HUD element was last given: they are refreshed twice a
     *  second, and almost always with the same text. */
    private hudWritten = new WeakMap<Element, string>();
    private bodies: Body[] = [];

    /** Null until the first setNodes. It used to start as "", which is also
     *  the signature of an empty registry, so setNodes([]) returned before
     *  writing anything and the HUD said "Loading registry…" for good. The
     *  HUD text is no longer behind this check at all (see renderHud). */
    private signature: string | null = null;
    private nodes: EcosystemNode[] = [];
    private registry: RegistryState = "loading";
    private freshness: HealthFreshness | null = null;
    private conn: ConnState = "connecting";
    /** Which streaming services' data APIs answered this poll (DataBridge
     *  .serviceUp). All false before the first verdict. */
    private dataUp: ServiceFlags = { algora: false, ao: false, bridge: false };
    /** The health reading is stale: measured bodies are drawn as not observed. */
    private healthStale = false;
    private tipHtml = "";
    private elapsed = 0;
    private reducedMotion = false;
    private mapVisible = true;

    private motes: Mote[] = [];
    private byId = new Map<string, Body>();
    /** Zero, like the count it follows (DataBridge.newSignals), which already
     *  leaves out each origin's first read. This used to start null and take
     *  its baseline at the first call — a race between the first poll and the
     *  first 500 ms tick that decided whether the backlog counted. */
    private lastIngested: Record<string, number> = {};
    private lastHealthAt: string | null = null;
    private sweep?: Phaser.GameObjects.Arc;
    private sweepT = 1;
    private signalsSeen = 0;

    /** Set by the scene so a streaming body can open its belt. */
    onOpenZone?: (zone: string) => void;

    /**
     * Shows or hides everything this map draws.
     *
     * It has to exist. The backdrop is deliberately enormous — it must cover the
     * hub's overscan, which on a portrait phone runs ~2000px past the map
     * rectangle — and it sits in a depth band above the belt zones so those
     * cannot paint through it. Left visible, that single rectangle covers the
     * whole world: switching to a belt moved the camera onto a zone that was
     * completely obscured, which looked exactly like the tab doing nothing.
     *
     * Selecting by depth rather than keeping a list means dynamically created
     * bodies and motes are covered automatically. Nothing else in the scene uses
     * this band — the belt zones stay far below it (their highest objects sit
     * at ~30), the header sits at 100. SpaceHubScene hides the belt Graphics by
     * the same boundary, HUB_DEPTH, from the other side.
     */
    setMapVisible(visible: boolean): void {
        this.mapVisible = visible;
        for (const o of this.scene.children.list) {
            const obj = o as Phaser.GameObjects.GameObject & { depth?: number; setVisible?: (v: boolean) => unknown };
            if (typeof obj.depth === "number" && obj.depth >= D && typeof obj.setVisible === "function") {
                obj.setVisible(visible);
            }
        }
        this.sweep?.setVisible(visible && !this.reducedMotion && this.sweepT < 1);
        if (!visible) {
            if (this.tipEl) this.tipEl.hidden = true;
            this.bodies.forEach(b => { b.hovered = false; });
            this.scene.input.setDefaultCursor("default");
        }
    }

    constructor(scene: Phaser.Scene, cx: number, cy: number, w: number, h: number) {
        this.scene = scene;
        this.cx = cx; this.cy = cy; this.w = w; this.h = h;
    }

    create(): void {
        this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        // Must exist before anything calls makePinned(): the ring and core labels
        // are built further down, and appending into a layer that did not exist
        // yet silently dropped them through the optional chain.
        this.labelLayer = document.createElement("div");
        this.labelLayer.className = "hub-labels";
        document.body.appendChild(this.labelLayer);


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
        // The last canvas text goes too. `pixelArt: true` filters NEAREST, and the
        // canvas is downscaled twice on top of that, so even large fixed labels
        // lose their strokes. Everything readable on this map is now DOM.
        this.pinned.push(this.makePinned("MOSSLAND", "hub-pin hub-pin-core", this.cx, this.cy + 44));

        // Ring names: the orbits were pure geometry before, carrying none of the
        // grouping they actually encode.
        for (const [section, r] of Object.entries(RING_RADII)) {
            // Upper-left diagonal. Twelve o'clock put them in the same column as
            // the planet names (bodies start there); nine o'clock put all five on
            // one row, where names up to 13 characters overlapped each other. On
            // the diagonal each ring's radius separates them in both axes.
            const k = Math.SQRT1_2;   // cos/sin of 135deg
            this.pinned.push(this.makePinned(
                RING_LABELS[section] ?? section, "hub-pin hub-pin-ring",
                this.cx - r * k, this.cy - r * k - 8));
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
        this.tipEl = document.createElement("div");
        this.tipEl.className = "hub-tip";
        this.tipEl.hidden = true;
        document.body.appendChild(this.tipEl);

        this.drawField(0, this.cx, this.cy, false);
    }

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

    private makePinned(text: string, cls: string, wx: number, wy: number): { el: HTMLDivElement; wx: number; wy: number } {
        const el = document.createElement("div");
        el.className = cls;
        el.textContent = text;
        this.labelLayer?.appendChild(el);
        return { el, wx, wy };
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

    private buildHud(): void {
        // Anchor to #stage (which the canvas fills) rather than .stage-wrap, so
        // the HUD sits on the map instead of floating in the letterbox above it.
        const host = document.querySelector<HTMLElement>("#stage")
            ?? document.querySelector<HTMLElement>(".stage-wrap") ?? document.body;
        const el = document.createElement("div");
        el.className = "hub-hud";
        // Under the counts: when the readings were taken (and, on a phone,
        // whether the data APIs answer — the sidebar that says so is a closed
        // drawer there), what the services report, and which of them are not
        // ok, by name. Where rows stacked over the stage would cover the top
        // of the outer orbit, the stylesheet leaves some of them to the panel
        // and the body labels: the tally and names on a landscape tablet, the
        // names on a short phone. The "stale" legend row is shown only while
        // the readings are, because only then does it describe anything on
        // the map.
        el.innerHTML = `
          <div class="hud-top">
            <div class="hud-title">ECOSYSTEM MAP</div>
            <div class="hud-counts" id="hubCounts">Loading registry…</div>
            <div class="hud-status"><span class="hud-conn" id="hubConn"></span><span class="hud-clock" id="hubClock"></span></div>
            <div class="hud-tally" id="hubTally"></div>
            <div class="hud-names" id="hubNames"></div>
          </div>
          <div class="hud-legend">
            <div class="lg">
              <div class="lg-h">FORM — how much we see</div>
              <span><i class="f stream"></i>streaming · ringed, we read its data</span>
              <span><i class="f health"></i>health-checked · breathing, status only</span>
              <span><i class="f listed"></i>listed · steady, not measured here</span>
              <span><i class="f reference"></i>link or file · not a service</span>
              <span class="lg-stale"><i class="f stale"></i>stale · dimmed and still, last reading kept</span>
            </div>
            <div class="lg">
              <div class="lg-h">COLOUR — what it reports</div>
              <span><i class="c ok"></i>ok</span>
              <span><i class="c degraded"></i>degraded · also on its label</span>
              <span><i class="c down"></i>down · also on its label</span>
              <span><i class="c none"></i>no measurement, or off-contract</span>
              <span><i class="c arch"></i>archived · in place of its health</span>
            </div>
          </div>
          <div class="hud-foot"><span id="hubActivity"></span><span class="hud-hint">hover a body for detail · click to open it</span></div>`;
        host.appendChild(el);
        this.hudEl = el;
        this.countsEl = el.querySelector<HTMLElement>("#hubCounts") ?? undefined;
        this.connEl = el.querySelector<HTMLElement>("#hubConn") ?? undefined;
        this.clockEl = el.querySelector<HTMLElement>("#hubClock") ?? undefined;
        this.tallyEl = el.querySelector<HTMLElement>("#hubTally") ?? undefined;
        this.namesEl = el.querySelector<HTMLElement>("#hubNames") ?? undefined;
        this.activityEl = el.querySelector<HTMLElement>("#hubActivity") ?? undefined;
        // What buildHud just wrote is what the memo must start from.
        this.hudWritten = new WeakMap();
        if (this.countsEl) this.hudWritten.set(this.countsEl, this.countsEl.innerHTML);
    }

    /** Writes a HUD element only when its markup changed. */
    private setHud(el: HTMLElement | undefined, markup: string): void {
        if (!el || this.hudWritten.get(el) === markup) return;
        this.hudWritten.set(el, markup);
        el.innerHTML = markup;
    }

    /** The HUD only makes sense over the map, so hide it in the belt zones. */
    setHudVisible(visible: boolean): void {
        if (this.hudEl) this.hudEl.hidden = !visible;
        if (this.labelLayer) this.labelLayer.hidden = !visible;
        this.setMapVisible(visible);
    }

    /** `ingested` is DataBridge.newSignals: signals that arrived after each
     *  origin's first read, so every delta here is activity, from zero. */
    setActivity(ingested: Record<string, number>, healthCheckedAt: string | null): void {
        for (const [origin, total] of Object.entries(ingested)) {
            const delta = total - (this.lastIngested[origin] ?? 0);
            if (delta > 0) {
                this.signalsSeen += delta;
                if (!this.reducedMotion) {
                    for (let i = 0; i < Math.min(delta, MAX_SPAWN_PER_TICK); i++) this.emitMote(origin);
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
        const dot = this.scene.add.circle(body.dot.x, body.dot.y, 2.5, COLOR.hub)
            .setDepth(D + 11).setAlpha(0.95).setVisible(this.mapVisible);
        this.motes.push({ dot, fromX: body.dot.x, fromY: body.dot.y, t: 0, speed: 0.55 + Math.random() * 0.35 });
    }

    /**
     * The registry snapshot and what state the registry read is in. Bodies are
     * rebuilt only when the snapshot changes; the HUD text is worked out on
     * every call and written when it differs, so no state — an empty registry,
     * a failed first read — can be caught behind the rebuild check again.
     */
    setNodes(nodes: EcosystemNode[], registry: RegistryState): void {
        this.nodes = nodes;
        this.registry = registry;
        this.rebuild(nodes);
        this.renderHud();
    }

    /**
     * How current the health reading is, and whether the data APIs answer —
     * overall for the HUD, per service for whether a streaming body has
     * anything behind its breathing (see update). Called every 500 ms: this is
     * what ages the reading into "stale" and keeps an open tooltip's age
     * current.
     */
    setHealthStatus(freshness: HealthFreshness, conn: ConnState, dataUp: ServiceFlags): void {
        this.freshness = freshness;
        this.conn = conn;
        this.dataUp = dataUp;
        const stale = freshness.state === "stale";
        if (stale !== this.healthStale) {
            this.healthStale = stale;
            this.hudEl?.classList.toggle("stale", stale);
            this.labelLayer?.classList.toggle("stale", stale);
        }
        this.renderHud();
        const hovered = this.bodies.find(b => b.hovered);
        if (hovered) this.showTooltip(hovered);
    }

    private renderHud(): void {
        const drawn = this.registry === "loaded" && this.nodes.length > 0;
        const f = this.freshness;
        const clock = drawn && f ? freshnessText(f) : "";
        // A phone has no sidebar on screen, so this is the only place it can
        // see whether the data APIs answer. Hidden above 767px, where the
        // sidebar's status line is always in view.
        this.setHud(this.connEl, (this.conn === "live" ? `<span class="dot live"></span>LIVE`
            : this.conn === "offline" ? `<span class="dot offline"></span>OFFLINE`
                : `<span class="dot connecting"></span>CONNECTING`) + (clock ? "<i>·</i>" : ""));
        this.setHud(this.clockEl, clock);

        if (!drawn) {
            // Same words as the sidebar. "failed" is a first read that got
            // nothing, retried within seconds; "loaded" with no entries is a
            // registry that answered without a list we can draw.
            this.setHud(this.countsEl, this.registry === "loading" ? "Loading registry…"
                : this.registry === "failed" ? `<span class="hud-warn">Registry unreachable — retrying</span>`
                    : `<span class="hud-warn">Registry unavailable</span>`);
            this.setHud(this.tallyEl, "");
            this.setHud(this.namesEl, "");
            return;
        }

        // Count services against services. Folding the files and the exchange
        // links into "listed only" made the ecosystem look far less observed than
        // it is — they are not unobserved services, they are not services.
        const nodes = this.nodes;
        const services = nodes.filter(n => n.kind === "service");
        const references = nodes.length - services.length;
        const streaming = services.filter(n => n.instrumentation === "stream").length;
        const health = services.filter(n => n.instrumentation === "health").length;
        const listed = services.filter(n => n.instrumentation === "listed").length;
        this.setHud(this.countsEl,
            `<b>${services.length}</b> services <i>·</i> <b>${streaming}</b> streaming `
            + `<i>·</i> <b>${health}</b> health-checked <i>·</i> <b>${listed}</b> listed only `
            + `<i>·</i> <b>${references}</b> links &amp; files`);

        // What they report, dated by the sweep clock (the line above). While
        // the first sweep of the registry's services is in flight there is
        // nothing to count yet; once one has settled with nothing, "all
        // unmeasured" is the result, and later sweeps must not blank it for
        // as long as each takes. A stale reading is counted but dated, so its
        // "ok"s never read as current.
        if (!f || (f.state === "none" && f.sweeping && !f.settled)) {
            this.setHud(this.tallyEl, "");
            this.setHud(this.namesEl, "");
            return;
        }
        const tally = tallyServices(nodes);
        this.setHud(this.tallyEl, (f.state === "stale" && f.checkedAt !== null
            ? `<span class="hud-asof">as of ${shortClock(f.checkedAt)}</span> <i>·</i> ` : "")
            + tallyHtml(tally));
        this.setHud(this.namesEl, namesHtml(tally, HUD_NAMES));
    }

    private rebuild(nodes: EcosystemNode[]): void {
        const signature = nodes
            .map(n => JSON.stringify([
                n.service.id, n.kind, n.instrumentation, n.health?.status,
                n.service.lifecycle, n.service.status, n.service.name, n.service.section,
            ]))
            .join("|");
        if (signature === this.signature) {
            // Latency and target URLs can change without changing a body's
            // appearance. Keep its data current without rebuilding its orbit.
            for (const node of nodes) {
                const body = this.byId.get(node.service.id);
                if (!body) continue;
                const changed = body.node.health !== node.health || body.node.service !== node.service;
                body.node = node;
                if (changed && body.hovered) this.showTooltip(body);
            }
            return;
        }
        this.signature = signature;

        // Destroying a hovered body does not deliver a pointerout event.
        if (this.tipEl) this.tipEl.hidden = true;
        this.scene.input.setDefaultCursor("default");

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

        // A rebuild can land while a belt zone is showing; new objects default to
        // visible, so re-apply the current state.
        this.setMapVisible(!this.hudEl?.hidden);
    }

    private makeBody(node: EcosystemNode, r: number, a: number, index: number): Body {
        const { service, health, instrumentation, kind } = node;
        const archived = isArchived(service);
        // Colour carries the health claim, and only a real verdict earns a
        // verdict colour. No measurement means the neutral star — present, lit,
        // and making no claim either way. An archived body takes the archived
        // colour *instead* of its health colour (README says so); its health
        // stays in the tooltip, the sidebar, and — when down or degraded — on
        // its label below.
        const statusColor = health?.status === "ok" ? COLOR.ok
            : health?.status === "degraded" ? COLOR.degraded
                : health?.status === "down" ? COLOR.down : COLOR.unmeasured;
        const color = archived ? COLOR.archived : statusColor;

        // A file and an exchange listing are not services, so they are drawn as
        // the smallest, quietest marks on the map. They are here because they are
        // part of the ecosystem's surface and worth finding — but sizing them
        // like a running service would invite the question "is llms.txt up?",
        // which has no answer.
        const reference = kind !== "service";
        const baseR = reference ? 3
            : instrumentation === "stream" ? 10
                : instrumentation === "health" ? 7.5 : 5;
        const x = this.cx + Math.cos(a) * r;
        const y = this.cy + Math.sin(a) * r;

        let dot: Phaser.GameObjects.Arc;
        let glow: Phaser.GameObjects.Arc | undefined;
        let halo: Phaser.GameObjects.Arc | undefined;

        // Every registered service is a lit star. What instrumentation changes is
        // the *character* of the light, never whether there is any: unmeasured
        // ones shine steadily, measured ones breathe, streaming ones carry a halo.
        // References get no glow at all — they are marks, not bodies.
        if (!reference) {
            glow = this.scene.add.circle(x, y, baseR * (instrumentation === "listed" ? 2.0 : 2.6),
                color, instrumentation === "listed" ? 0.09 : 0.13).setDepth(D + 8);
        }
        dot = this.scene.add.circle(x, y, baseR, color);
        if (instrumentation === "stream") {
            halo = this.scene.add.circle(x, y, baseR + 9).setStrokeStyle(1.5, color, 0.5).setDepth(D + 9);
        }
        dot.setDepth(D + 10).setAlpha(
            reference ? 0.5 : archived ? 0.55 : instrumentation === "listed" ? 0.85 : 1);

        // DOM, not a Phaser Text. `pixelArt: true` forces NEAREST filtering, and
        // raising the Text resolution does not save it — the oversized glyph
        // texture is still point-sampled on the way down, so strokes get dropped
        // rather than smoothed. Rendering names in the DOM is the same fix that
        // made the tooltip and the HUD legible, and it has the extra property
        // that names keep a constant size instead of shrinking with camera zoom.
        const label = document.createElement("div");
        label.className = "hub-label " + (reference ? "reference" : instrumentation)
            + (archived ? " archived" : "");
        label.textContent = service.name;
        // The verdict in words, for the two colours that make one a viewer
        // could misread: red and amber next to green are near-identical to a
        // red-green colour-blind eye. Built as a node, not markup — the name
        // beside it is registry data. The signature includes the status, so a
        // change of verdict rebuilds the body and this with it.
        const bucket = kind === "service" ? healthBucket(health) : null;
        if (bucket === "down" || bucket === "degraded") {
            const tag = document.createElement("span");
            tag.className = `hub-label-status ${bucket}`;
            tag.textContent = bucket;
            label.append(" ", tag);
        }
        this.labelLayer?.appendChild(label);

        // Generous hit area — the dots are small, the targets should not be.
        dot.setInteractive(new Phaser.Geom.Circle(baseR, baseR, baseR + 16), Phaser.Geom.Circle.Contains);

        const body: Body = {
            node, dot, glow, halo, label,
            r, a, spin: SPIN_BASE * (0.35 + 0.65 * (1 - r / RING_RADII.ecosystem)),
            ox: 0, oy: 0, baseR, color, phase: index * 0.7, instrumentation, kind, archived, hovered: false,
        };

        dot.on("pointerover", () => { body.hovered = true; this.showTooltip(body); this.scene.input.setDefaultCursor("pointer"); });
        dot.on("pointerout", () => { body.hovered = false; if (this.tipEl) this.tipEl.hidden = true; this.scene.input.setDefaultCursor("default"); });
        dot.on("pointerup", () => this.activate(body));
        return body;
    }

    private showTooltip(b: Body): void {
        const el = this.tipEl;
        if (!el || !this.mapVisible) return;
        // The markup is built outside this Phaser module so it can be tested.
        // It carries the reading's age, so setHealthStatus re-renders it every
        // 500 ms; it is written only when that changed the text.
        const html = hubTooltipHtml(b.node, {
            isSelf: b.node.service.id === SELF_ID, archived: b.archived, freshness: this.freshness,
        });
        if (el.hidden || html !== this.tipHtml) {
            this.tipHtml = html;
            el.innerHTML = html;
        }
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
        // Our own star. Opening monitor.moss.land in a new tab hands the viewer a
        // second copy of the page they are already looking at — the one click on
        // this map that cannot go anywhere. Recentre the view on it instead,
        // which is the useful reading of "take me to this one".
        if (id === SELF_ID) {
            this.focusSelf(b);
            return;
        }
        window.open(b.node.service.url, "_blank", "noopener,noreferrer");
    }

    /** Pulls the camera back to the hub and flashes our own star, so clicking it
     *  does something legible instead of nothing. */
    private focusSelf(b: Body): void {
        this.scene.cameras.main.pan(this.cx, this.cy, 420, "Sine.easeInOut");
        this.scene.tweens.add({
            targets: b.dot, scale: { from: 1, to: 2.2 },
            duration: 260, yoyo: true, repeat: 1, ease: "Sine.easeInOut",
        });
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
                // A square of the circle's area, not a circle. Phaser turns
                // every arc into ~100 points and triangulates it again on each
                // render, whatever its radius, so 520 stars of 1–4 px were the
                // costliest thing this map drew. At that size the two look the
                // same, and matching the area keeps each star's brightness.
                const h = s.size * STAR_HALF_SIDE;
                g.fillStyle(s.tint, s.alpha);
                g.fillRect(x - h, y - h, 2 * h, 2 * h);
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

        const proj = this.projection();
        if (proj) {
            for (const q of this.pinned) {
                const sx = proj.left + (q.wx - proj.vx) * proj.s;
                const sy = proj.top + (q.wy - proj.vy) * proj.s;
                q.el.style.transform = `translate(-50%, -50%) translate(${Math.round(sx)}px, ${Math.round(sy)}px)`;
            }
        }

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
            // going dark. A stale reading is not being watched either: every
            // measured body, streaming ones included — their ring comes from a
            // fixed list, not from a reading — stops and dims until a sweep lands.
            //
            // For the same reason a streaming body breathes only on evidence
            // of its own: its data API answered this poll, or it carries a
            // health reading (non-null only once a sweep has landed; stale is
            // the rule above). With neither — no sweep has ever landed and its
            // data API does not answer — it holds a steady light like a listed
            // body. Its ring stays: that it is polled is still true.
            const reference = b.kind !== "service";
            const measured = !reference && b.instrumentation !== "listed";
            const stale = measured && this.healthStale;
            const evidence = b.instrumentation !== "stream" || b.node.health !== null
                || this.dataUp[b.node.service.id as keyof ServiceFlags] === true;
            const observed = measured && evidence && !b.archived && !this.reducedMotion && !stale;
            const pulse = observed ? 0.78 + 0.22 * Math.sin(t * 1.8 + b.phase) : 1;
            const rest = (reference ? 0.5 : b.archived ? 0.55 : b.instrumentation === "listed" ? 0.85 : 1)
                * (stale ? STALE_DIM : 1);
            b.dot.setAlpha(rest * pulse);
            b.glow?.setAlpha(observed ? 0.10 + 0.07 * Math.sin(t * 1.8 + b.phase)
                : stale ? 0.04 : b.instrumentation === "listed" ? 0.09 : 0.08);
            if (b.halo) {
                b.halo.setScale(0.92 + (observed ? 0.14 * Math.sin(t * 1.8 + b.phase) : 0));
                b.halo.setAlpha(stale ? STALE_DIM : 1);
            }

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
            this.sweep?.setVisible(this.mapVisible)
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
        this.pinned.forEach(q => q.el.remove());
        this.pinned = [];
        this.labelLayer?.remove();
        this.byId.clear();
        this.bodies.forEach(b => { b.dot.destroy(); b.glow?.destroy(); b.halo?.destroy(); b.label.remove(); });
        this.bodies = [];
    }
}
