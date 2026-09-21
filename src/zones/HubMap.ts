import Phaser from "phaser";
import type {
    EcosystemNode, HealthFreshness, Instrumentation, NodeKind, RegistryState,
} from "../services/ecosystem-feed.ts";
import type { ConnState, ServiceFlags } from "../services/data-bridge.ts";
import { hubTooltipHtml } from "../ui/hub-tooltip.ts";
import {
    freshnessText, healthBucket, isArchived, namesHtml, shortClock, tallyHtml, tallyServices,
} from "../ui/ecosystem-status.ts";
import { TouchSelection } from "../ui/map-selection.ts";
import {
    hubShiftPx, placeBodyLabel, placeByCore, placeOnRing, ringGap, tipBesideBody, tipNearCursor, type Rect,
} from "../ui/map-layout.ts";
import { onReducedMotionChange, reducedMotion } from "../ui/motion.ts";

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
 *
 * With reduced motion (read live, see ui/motion.ts) the ambient kind stops
 * where it is and the meaningful kind is not drawn: the colours, forms and
 * labels carry the same readings without it.
 *
 * Input: a mouse hovers for the tooltip and clicks to open. A touch has no
 * hover, so there the first tap on a body shows its tooltip and a second tap
 * on it opens it (ui/map-selection.ts). Only a pointer that went down and
 * came up on the canvas counts: one on the drawer or anything else laid over
 * the map is not a tap on the body beneath it.
 *
 * The canvas takes no keyboard focus; every body is also a link in the
 * sidebar's Ecosystem list, with its reading in the link's name, which is the
 * keyboard and screen-reader way in, and the map's DOM text is aria-hidden
 * so that it is not read out a second time as a list of loose words.
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
    /** The label's size in page px, measured when first laid out (0 until
     *  then). Not at creation: a rebuild can land while a belt view is shown,
     *  when the label layer is display:none and every size reads 0. */
    labelW: number;
    labelH: number;
    /** Until when (map clock, ms) the label carries its own `flash` class —
     *  the self star's feedback when motion is reduced. Distinct from hover
     *  and selection, which a click on it has always already lit. */
    flashUntil: number;
};

/** DOM text pinned to the map rather than to a body. */
type Pin = { el: HTMLDivElement; w: number; h: number };
/**
 * A ring's name. It sits in the middle of a gap between the ring's bodies and
 * turns with them: every body in a ring turns at the same rate, so the gap
 * never closes, and only a neighbouring ring's labels can reach the name —
 * which then steps aside along the ring, nearest the gap's middle first
 * (placeOnRing). It used to be pinned on a fixed diagonal the bodies turned
 * through, printed over their names. `angle` is the gap's middle at t = 0.
 */
type RingPin = Pin & { r: number; spin: number; angle: number };

/** The projection of one frame, plus what the map's text must stay clear of. */
type Projection = {
    left: number; top: number; right: number; bottom: number;
    /** World units -> page px. */
    s: number;
    vx: number; vy: number;
    vw: number; vh: number;
    /** The tab bar, the legend and the HUD footer's text, in page px: what
     *  the core and ring names keep off. `hard` and `soft` split it for the
     *  body names, which outrank the footer (see placeBodyLabel). */
    avoid: Rect[];
    /** The tab bar and the legend: never printed over. */
    hard: Rect[];
    /** The footer's hint and activity line: kept clear of while there is room. */
    soft: Rect[];
    /** Where the tab bar starts: the bottom of the room a tooltip has. */
    floor: number;
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

/** Where a ring's name would rather be: upper left, where the names sat
 *  before they moved into the gaps between bodies. */
const RING_NAME_ANGLE = -0.75 * Math.PI;

/** How far a body's name can reach past its orbit, in page px: half of the
 *  widest name the registry has (18 characters at 11px). What the hub is
 *  moved right by to clear the legend is worked out from this. */
const LABEL_REACH = 60;

/** The label and ring-name font sizes step down at this width. */
const LABEL_FONT_BREAKPOINT = "(max-width: 900px)";

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
    /** The tooltip's size, measured when its content changes. */
    private tipW = 0;
    private tipH = 0;
    private labelLayer?: HTMLDivElement;
    /** "MOSSLAND" under the core, and the five ring names. */
    private core?: Pin;
    private rings: RingPin[] = [];
    /** What the map's text must not be printed over. */
    private avoidEls: HTMLElement[] = [];
    private legendEl?: HTMLElement;
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
    /** Seconds of rotation so far. Its own clock, advanced only while motion
     *  is allowed, so turning reduced motion on stops the galaxy where it is
     *  (and off again resumes it) rather than snapping it back to t = 0. */
    private spinT = 0;
    private reducedMotion = false;
    private mapVisible = true;
    private selection = new TouchSelection();
    private cleanups: (() => void)[] = [];

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
            // A tap selection too: coming back to the map should not find a
            // tooltip pinned to a body from before, or take the next tap on
            // it as the "again" that opens it.
            this.selection.clear();
            this.clearHover();
        }
    }

    /** Hides the tooltip and every hover highlight. */
    private clearHover(): void {
        if (this.tipEl) this.tipEl.hidden = true;
        this.bodies.forEach(b => { b.hovered = false; });
        this.scene.input.setDefaultCursor("default");
    }

    constructor(scene: Phaser.Scene, cx: number, cy: number, w: number, h: number) {
        this.scene = scene;
        this.cx = cx; this.cy = cy; this.w = w; this.h = h;
    }

    create(): void {
        // Read live: the setting can change while this long-lived page is open,
        // and the rest of the scene follows it on the next frame.
        this.reducedMotion = reducedMotion();
        this.cleanups.push(onReducedMotionChange(reduced => this.setReducedMotion(reduced)));

        // Must exist before anything calls makePinned(): the ring and core labels
        // are built further down, and appending into a layer that did not exist
        // yet silently dropped them through the optional chain.
        this.labelLayer = document.createElement("div");
        this.labelLayer.className = "hub-labels";
        // Every name here repeats a link or a section title in the sidebar's
        // Ecosystem list, whose links carry each body's reading in their
        // accessible names. Read out, the layer was 34 loose words after the
        // page, outside every landmark.
        this.labelLayer.setAttribute("aria-hidden", "true");
        document.body.appendChild(this.labelLayer);

        // The label sizes the layout works from change with the font sizes.
        const fonts = window.matchMedia(LABEL_FONT_BREAKPOINT);
        const remeasure = () => {
            this.bodies.forEach(b => { b.labelW = 0; b.labelH = 0; });
            for (const q of [this.core, ...this.rings]) if (q) { q.w = 0; q.h = 0; }
        };
        fonts.addEventListener("change", remeasure);
        this.cleanups.push(() => fonts.removeEventListener("change", remeasure));

        // A touch that lands on no body clears the tap selection. The scene's
        // pointerup follows the bodies' own, and carries what the pointer was
        // over: empty means the tap hit nothing. It needs no check of where
        // the touch landed, unlike a body's (see makeBody): Phaser emits it
        // only when the pointer came up on the canvas.
        const onUp = (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
            if (p.wasTouch && over.length === 0 && this.selection.tapEmpty()) this.clearHover();
        };
        // A touch on the page around the map — the drawer, its backdrop, ☰ —
        // arrives as up-outside, never as the scene's pointerup. It is not a
        // tap on a body, so it clears the selection too: a tap on the
        // backdrop dismisses the tooltip along with the drawer.
        const onUpOutside = (p: Phaser.Input.Pointer) => {
            if (p.wasTouch && this.selection.tapEmpty()) this.clearHover();
        };
        // A mouse leaving the canvas sends no pointerout to the body under it.
        // Phaser still counts the pointer as over that body, though, so coming
        // straight back onto it fires no pointerover: the body's pointermove
        // is what restores the hover (see makeBody).
        const onOut = () => { if (this.selection.selected === null) this.clearHover(); };
        this.scene.input.on("pointerup", onUp);
        this.scene.input.on("pointerupoutside", onUpOutside);
        this.scene.input.on("gameout", onOut);
        // The phone drawer covers the map. A tooltip pinned before it opened
        // was drawn over it, still saying "tap again to open", and the next
        // tap on that body after it closed was taken as that "again". So the
        // drawer opening ends the selection and any hover, as a tab switch
        // does (setMapVisible) — however it was opened, ☰ or the keyboard.
        const onPanel = (e: Event) => {
            if ((e as CustomEvent<{ open?: boolean }>).detail?.open) {
                this.selection.clear();
                this.clearHover();
            }
        };
        document.addEventListener("panel-toggle", onPanel);
        this.cleanups.push(() => {
            this.scene.input.off("pointerup", onUp);
            this.scene.input.off("pointerupoutside", onUpOutside);
            this.scene.input.off("gameout", onOut);
            document.removeEventListener("panel-toggle", onPanel);
        });


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
        this.core = this.makePinned("MOSSLAND", "hub-pin hub-pin-core");

        // Ring names: the orbits were pure geometry before, carrying none of the
        // grouping they actually encode. Inner ring first — the layout places
        // them in this order, each clear of the ones before it.
        for (const [section, r] of Object.entries(RING_RADII)) {
            // Where each name sits along its ring is worked out per frame (see
            // RingPin). Upper left until the registry says where the gaps are:
            // on that diagonal each ring's radius separates the names in both
            // axes, where twelve o'clock put them in the planet names' column
            // and nine o'clock put all five on one row.
            this.rings.push({
                ...this.makePinned(RING_LABELS[section] ?? section, "hub-pin hub-pin-ring"),
                r, spin: this.spinFor(r), angle: RING_NAME_ANGLE,
            });
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
        // Pointer-only, and what it says about a body the sidebar's row for it
        // says too: the row is a link whose accessible name carries the
        // body's reading (status, latency, stale), its lifecycle, and its
        // verdict chip on screen.
        this.tipEl.setAttribute("aria-hidden", "true");
        document.body.appendChild(this.tipEl);

        // Read once per frame alongside the canvas (see projection). The HUD
        // ones are this map's own; the tab bar is the sidebar's, and on the
        // 768-1100px layouts the bottom of the outer ring runs under it.
        const tabs = document.querySelector<HTMLElement>(".zone-tabs");
        this.legendEl = this.hudEl?.querySelector<HTMLElement>(".hud-legend") ?? undefined;
        this.avoidEls = [
            tabs, this.legendEl, this.activityEl,
            ...(this.hudEl ? Array.from(this.hudEl.querySelectorAll<HTMLElement>(".hud-hint > span")) : []),
        ].filter((e): e is HTMLElement => !!e);

        this.drawField(0, this.cx, this.cy, false);
    }

    /** Radians/sec for an orbit of radius r: outer orbits turn slower. Every
     *  body in a ring shares it, which is what keeps a ring's gaps open. */
    private spinFor(r: number): number {
        return SPIN_BASE * (0.35 + 0.65 * (1 - r / RING_RADII.ecosystem));
    }

    /**
     * The reduced-motion setting changed while the page was open. update()
     * stops advancing motes and the sweep as soon as motion is reduced, so any
     * in flight at that moment would stay frozen mid-map for the life of the
     * page: they go now. Rotation just stops where it is (see spinT).
     */
    private setReducedMotion(reduced: boolean): void {
        this.reducedMotion = reduced;
        if (!reduced) return;
        this.motes.forEach(m => m.dot.destroy());
        this.motes = [];
        this.sweepT = 1;
        this.sweep?.setVisible(false);
    }

    /**
     * Projection constants for this frame. getBoundingClientRect forces layout,
     * so it is read once per frame rather than once per label — 28 labels at
     * 60fps would otherwise be ~1700 forced layouts a second. The rects the
     * text must avoid are read in the same breath, before the frame writes
     * anything, so they cost no second layout.
     */
    private projection(): Projection | null {
        const canvas = this.scene.game.canvas;
        if (!canvas) return null;
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !canvas.width) return null;
        const cam = this.scene.cameras.main;
        const hard: Rect[] = [];
        const soft: Rect[] = [];
        let floor = window.innerHeight;
        for (const el of this.avoidEls) {
            // Zero-sized when not shown: the legend at 900px and below, an
            // empty activity line, the hint for the other kind of pointer.
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height) continue;
            const box = { x: r.left, y: r.top, w: r.width, h: r.height };
            (el === this.activityEl || el.closest(".hud-hint") ? soft : hard).push(box);
            if (el.classList.contains("zone-tabs")) floor = Math.min(floor, r.top);
        }
        return {
            left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
            s: (rect.width / canvas.width) * cam.zoom,   // world units -> page px
            vx: cam.worldView.x, vy: cam.worldView.y,
            vw: window.innerWidth, vh: window.innerHeight,
            avoid: [...hard, ...soft], hard, soft, floor,
        };
    }

    private makePinned(text: string, cls: string): Pin {
        const el = document.createElement("div");
        el.className = cls;
        el.textContent = text;
        this.labelLayer?.appendChild(el);
        return { el, w: 0, h: 0 };
    }

    /**
     * How many world units the map view's centre should move left of the hub,
     * so that the hub sits clear of the legend on its left (hubShiftPx). The
     * legend has no backing and the labels paint above it, and from about
     * 1000 to 1500px wide the outer ring's names ran across it; the canvas has
     * room to spare on the right at every one of those widths. Zero wherever
     * the legend is not shown (900px and below). The scene asks for this when
     * it frames the map, at the zoom it is about to use.
     */
    viewShift(zoom: number): number {
        const canvas = this.scene.game.canvas;
        if (!this.legendEl || !canvas?.width || this.hudEl?.hidden) return 0;
        const legend = this.legendEl.getBoundingClientRect();
        const rect = canvas.getBoundingClientRect();
        if (!legend.width || !rect.width) return 0;
        const s = (rect.width / canvas.width) * zoom;
        return hubShiftPx({
            legendRight: legend.right, canvasLeft: rect.left, canvasRight: rect.right,
            ring: RING_RADII.ecosystem * s, reach: LABEL_REACH,
        }) / s;
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
          <div class="hud-foot"><span id="hubActivity"></span><span class="hud-hint"><span class="hint-mouse"><span>hover a body for detail ·</span> <span>click to open it</span></span><span class="hint-touch"><span>tap a body for detail ·</span> <span>tap it again to open it</span></span></span></div>`;
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
        const shown = this.selectedBody() ?? this.bodies.find(b => b.hovered);
        if (shown) this.showTooltip(shown);
    }

    private selectedBody(): Body | undefined {
        const id = this.selection.selected;
        return id === null ? undefined : this.byId.get(id);
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
                if (changed && (body.hovered || this.selection.selected === node.service.id)) this.showTooltip(body);
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

        // Each ring's name goes in the gap between its bodies nearest the
        // upper left, and turns with them (see RingPin).
        for (const ring of this.rings) {
            const n = this.bodies.filter(b => b.r === ring.r).length;
            ring.angle = ringGap(n, RING_NAME_ANGLE);
        }

        // A tap selection survives the rebuild while its service is still on
        // the map — a change of verdict rebuilds, and that is exactly when the
        // pinned tooltip should say so rather than vanish.
        if (this.selection.retain(id => this.byId.has(id))) {
            const body = this.selectedBody();
            if (body) this.showTooltip(body);
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
            r, a, spin: this.spinFor(r),
            ox: 0, oy: 0, baseR, color, phase: index * 0.7, instrumentation, kind, archived, hovered: false,
            labelW: 0, labelH: 0, flashUntil: -Infinity,
        };

        // A mouse hovers and clicks, exactly as before. A touch branches off
        // in every handler (ui/map-selection.ts): Phaser fires over on the
        // touchstart, and up then out on the touchend, all in one tap — so
        // over and out must not show and hide the tooltip for it, and up is
        // where a tap selects or, on the selected body, opens.
        const enter = (p: Phaser.Input.Pointer) => {
            if (p.wasTouch) return;
            // A mouse on a touch laptop takes over from a tap selection.
            this.selection.clear();
            body.hovered = true;
            this.showTooltip(body);
            this.scene.input.setDefaultCursor("pointer");
        };
        dot.on("pointerover", enter);
        // Leaving the canvas clears the hover (gameout) but not Phaser's own
        // record of what the pointer is over, so coming straight back onto
        // the same body — off the tab bar, say — fired no pointerover, and the
        // body stayed without its tooltip and pointer cursor. A move over it
        // re-asserts the hover.
        dot.on("pointermove", (p: Phaser.Input.Pointer) => { if (!body.hovered) enter(p); });
        dot.on("pointerout", (p: Phaser.Input.Pointer) => {
            if (p.wasTouch) return;
            body.hovered = false;
            if (this.tipEl) this.tipEl.hidden = true;
            this.scene.input.setDefaultCursor("default");
        });
        dot.on("pointerup", (p: Phaser.Input.Pointer) => {
            // Phaser also listens on the window, and hands its input manager
            // touches (and mouse releases) that land on DOM laid over the
            // canvas — the phone drawer, its backdrop, ☰, the zone tabs. It
            // hit-tests the map under them and emits a body's pointerup
            // whatever element took them; only the scene's pointerup checks.
            // Without this, a tap or a scroll in the open drawer selected the
            // body hidden behind it, and a second one opened it.
            const canvas = this.scene.game.canvas;
            if (p.downElement !== canvas || p.upElement !== canvas) return;
            if (!p.wasTouch) { this.activate(body); return; }
            if (this.selection.tapBody(node.service.id) === "activate") {
                if (this.tipEl) this.tipEl.hidden = true;
                this.activate(body);
            } else {
                this.showTooltip(body);
            }
        });
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
            touch: this.selection.selected === b.node.service.id,
        });
        if (el.hidden || html !== this.tipHtml) {
            this.tipHtml = html;
            el.innerHTML = html;
            // Measured here, where its content changes, rather than every
            // frame. At the origin, so the width is the one it has wherever it
            // is placed: placement never lets it run into the right edge,
            // which is the only thing that would narrow it.
            el.style.left = "0px";
            el.style.top = "0px";
            el.hidden = false;
            const r = el.getBoundingClientRect();
            this.tipW = r.width;
            this.tipH = r.height;
        }
        el.hidden = false;
        this.placeTooltip(this.projection());
    }

    /**
     * A mouse's tooltip follows the cursor, as it always has. A tapped body's
     * is placed from the body itself — its projected position this frame,
     * since it keeps turning — and never from the event: a TouchEvent has no
     * clientX, and the NaN that made put the tooltip below the fold.
     */
    private placeTooltip(proj: Projection | null): void {
        const el = this.tipEl;
        if (!el || el.hidden) return;
        const vw = proj?.vw ?? window.innerWidth;
        const vh = proj?.vh ?? window.innerHeight;
        const e = this.scene.input.activePointer.event as MouseEvent | TouchEvent | undefined;
        const selected = this.selectedBody();
        let pos = !selected && e && "clientX" in e
            ? tipNearCursor(e.clientX, e.clientY, this.tipW, this.tipH, vw, vh) : null;
        const anchor = selected ?? (pos ? undefined : this.bodies.find(b => b.hovered));
        if (anchor && proj) {
            const x = proj.left + (anchor.dot.x - proj.vx) * proj.s;
            const y = proj.top + (anchor.dot.y - proj.vy) * proj.s;
            // Above the dot and its halo; below, past the name under it too.
            pos = tipBesideBody(x, y, (anchor.baseR + 10) * proj.s + 2,
                (anchor.baseR + 6) * proj.s + anchor.labelH + 2, this.tipW, this.tipH, vw, proj.floor);
        }
        if (!pos) return;
        el.style.left = `${Math.round(pos.left)}px`;
        el.style.top = `${Math.round(pos.top)}px`;
    }

    private activate(b: Body): void {
        const id = b.node.service.id;
        if (b.instrumentation === "stream" && this.onOpenZone && (id === "algora" || id === "ao" || id === "bridge")) {
            this.onOpenZone(id);
            return;
        }
        // Our own star. Opening monitor.moss.land in a new tab hands the viewer a
        // second copy of the page they are already looking at — the one click on
        // this map that cannot go anywhere, so it goes nowhere: it flashes the
        // star to say "this one is you", and the tooltip says the same in words.
        // It used to "recentre" too, which moved nothing: nothing but a tab
        // switch moves this camera, and the map view is already framed on the
        // hub (off it only by the legend's clearance, see viewShift).
        if (id === SELF_ID) {
            this.flashSelf(b);
            return;
        }
        window.open(b.node.service.url, "_blank", "noopener,noreferrer");
    }

    /** The click's feedback on our own star: a brief pulse, or with motion
     *  reduced, its name lit for a moment instead — in a style of its own
     *  (.hub-label.flash), since a mouse click always lands on a body that
     *  is already hovered, and hover's highlight would not change. */
    private flashSelf(b: Body): void {
        if (this.reducedMotion) {
            b.flashUntil = this.elapsed + 900;
            return;
        }
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

    /**
     * Places every piece of the map's DOM text for this frame: the body names,
     * the core's, the ring names, and a tooltip that follows a body or cursor.
     *
     * Reads first, then writes: the projection's rects and any size not yet
     * measured are all read before the first transform is written, so the
     * frame costs one layout rather than one per label.
     *
     * Body names come first and take their place under their dots, kept inside
     * the canvas (a phone's edge cut "Mossland Signal" to "Mossland Signa", for
     * good under reduced motion) and off the tab bar, legend and HUD footer —
     * except that a name, and the down or degraded word on it, outranks the
     * footer's hint and activity line: with no room clear of those it is
     * printed over them rather than hidden (placeBodyLabel). It is hidden only
     * rather than go under the tab bar or the legend.
     * Then "MOSSLAND" under the core, or beside it while a name passes below;
     * then the ring names, inner to outer, each clear of everything placed
     * before it. They are the lesser text — the sidebar groups by the same
     * sections — so a ring name that finds no room is hidden, never printed
     * over a service's name.
     */
    private layoutText(): void {
        const proj = this.projection();
        if (!proj) return;
        for (const b of this.bodies) {
            if (!b.labelW) { b.labelW = b.label.offsetWidth; b.labelH = b.label.offsetHeight; }
        }
        for (const q of [this.core, ...this.rings]) {
            if (q && !q.w) { q.w = q.el.offsetWidth; q.h = q.el.offsetHeight; }
        }

        const toX = (wx: number) => proj.left + (wx - proj.vx) * proj.s;
        const toY = (wy: number) => proj.top + (wy - proj.vy) * proj.s;
        const bounds = { left: Math.max(proj.left, 0), right: Math.min(proj.right, proj.vw) };
        // Names, and the dots the ring names must also keep off.
        const taken: Rect[] = [...proj.avoid];
        const dots: Rect[] = [];
        const selected = this.selection.selected;

        for (const b of this.bodies) {
            const x = toX(b.dot.x), y = toY(b.dot.y);
            // Off-camera labels are hidden rather than piling up along the edges.
            const inside = x > proj.left - 60 && x < proj.right + 60 && y > proj.top - 20 && y < proj.bottom + 20;
            const at = inside
                ? placeBodyLabel(x, y, (b.baseR + 6) * proj.s, b.labelW, b.labelH, bounds, proj.hard, proj.soft)
                : null;
            if (at) {
                b.label.style.transform = `translate(-50%, 0) translate(${Math.round(at.x)}px, ${Math.round(at.y)}px)`;
                taken.push({ x: at.x - b.labelW / 2, y: at.y, w: b.labelW, h: b.labelH });
            }
            b.label.style.visibility = at ? "visible" : "hidden";
            b.label.classList.toggle("hovered", b.hovered || b.node.service.id === selected);
            b.label.classList.toggle("flash", this.elapsed < b.flashUntil);
            // The dot too, halo and hover scale included: a ring name is
            // printed on the orbit the dots travel.
            const rd = (b.baseR * Math.max(1, b.dot.scaleX) + 4) * proj.s;
            dots.push({ x: x - rd, y: y - rd, w: 2 * rd, h: 2 * rd });
        }

        const cx = toX(this.cx), cy = toY(this.cy);
        const core = this.core;
        if (core) {
            // 34 is the core's outer circle (create()). It keeps off names
            // only: on a phone the inner ring is so tight that keeping off the
            // dots as well left it nowhere to go for most of every turn.
            const at = placeByCore(cx, cy, 34 * proj.s, core.w, core.h, taken, 4 * proj.s + 2);
            if (at) {
                core.el.style.transform = `translate(-50%, -50%) translate(${Math.round(at.x)}px, ${Math.round(at.y)}px)`;
                taken.push({ x: at.x - core.w / 2, y: at.y - core.h / 2, w: core.w, h: core.h });
            }
            core.el.style.visibility = at ? "visible" : "hidden";
        }

        // Anywhere along its ring, nearest the gap's middle first: the gap is
        // only the likeliest place to be free. Held to its own gap, a phone's
        // crowded inner rings left most names nowhere to go.
        taken.push(...dots);
        for (const ring of this.rings) {
            const at = placeOnRing(cx, cy, ring.r * proj.s, ring.angle + ring.spin * this.spinT, Math.PI,
                ring.w, ring.h, taken);
            if (at) {
                ring.el.style.transform = `translate(-50%, -50%) translate(${Math.round(at.x)}px, ${Math.round(at.y)}px)`;
                taken.push({ x: at.x - ring.w / 2, y: at.y - ring.h / 2, w: ring.w, h: ring.h });
            }
            ring.el.style.visibility = at ? "visible" : "hidden";
        }

        this.placeTooltip(proj);
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
        if (!this.reducedMotion) this.spinT += Math.max(dt, 0) / 1000;
        if (!Number.isFinite(this.spinT)) this.spinT = 0;
        const spinT = this.spinT;

        const inp = this.scene.input;
        // Hit tests run only when a pointer moves (Phaser's pollRate -1), and
        // the bodies move on their own: a body drifted out from under a still
        // cursor and kept its tooltip, highlight and pointer cursor for good,
        // while one drifting under it never lit up. So poll every frame — but
        // only for a mouse that is over the canvas. A lifted touch pointer,
        // and a mouse that has left, stay parked where they last were, and
        // polling those popped tooltips up for whatever turned under them.
        inp.pollRate = this.mapVisible && inp.isOver && !inp.activePointer.wasTouch ? 0 : -1;

        const p = inp.activePointer;
        const px = p.worldX, py = p.worldY;
        const inside = Math.abs(px - this.cx) < this.w / 2 && Math.abs(py - this.cy) < this.h / 2;

        this.drawField(spinT, inside ? px : this.cx, inside ? py : this.cy, inside);

        const selected = this.selection.selected;
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

            // A tapped body is lit as a hovered one is: it is the one the
            // tooltip is about.
            const want = b.hovered || b.node.service.id === selected ? 1.6 : 1;
            b.dot.setScale(b.dot.scaleX + (want - b.dot.scaleX) * Math.min(1, step * 12));
        }

        // The DOM text follows the bodies, and only while there is a map to
        // see: under a belt view its layer is display:none, where every size
        // reads 0 and every write is wasted.
        if (this.mapVisible) this.layoutText();

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
        this.selection.clear();
        this.cleanups.forEach(fn => fn());
        this.cleanups = [];
        this.core?.el.remove();
        this.rings.forEach(q => q.el.remove());
        this.core = undefined;
        this.rings = [];
        this.avoidEls = [];
        this.labelLayer?.remove();
        this.byId.clear();
        this.bodies.forEach(b => { b.dot.destroy(); b.glow?.destroy(); b.halo?.destroy(); b.label.remove(); });
        this.bodies = [];
    }
}
