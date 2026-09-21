/**
 * Where the map's DOM text goes on screen: the tooltip, the body labels, the
 * ring names, and how far the hub sits from the legend.
 *
 * Every readable thing on the map is a DOM node placed over the canvas (see
 * HubMap for why), so nothing keeps two of them apart except this. Each
 * function takes page pixels HubMap has already projected, and is Phaser-free
 * so that it can be tested.
 */

export type Rect = { x: number; y: number; w: number; h: number };
export type Point = { left: number; top: number };

/** Space kept between the tooltip and the viewport, or the tab bar. */
const EDGE = 8;

/** Whether two rects overlap, counting `pad` px around them as part of each. */
export function overlaps(a: Rect, b: Rect, pad = 0): boolean {
    return a.x < b.x + b.w + pad && b.x < a.x + a.w + pad
        && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
}

const hitsAny = (r: Rect, avoid: readonly Rect[], pad: number): boolean =>
    avoid.some(o => overlaps(r, o, pad));

/**
 * The centre x for something `w` wide, moved just far enough to stay inside
 * [lo, hi] with `margin` to spare. Centred in the room when it is wider than
 * the room, rather than pinned to one edge.
 */
export function clampCentre(x: number, w: number, lo: number, hi: number, margin = 4): number {
    const min = lo + w / 2 + margin;
    const max = hi - w / 2 - margin;
    if (min > max) return (lo + hi) / 2;
    return Math.min(max, Math.max(min, x));
}

/**
 * The mouse tooltip: below and right of the cursor, pulled left at the right
 * edge and flipped above it at the bottom. This is the desktop behaviour as it
 * always was; the only change is that a cursor position that is not a number
 * (a TouchEvent has no clientX) no longer reaches the style as "NaNpx", which
 * the browser drops, leaving the tooltip at its static position below the fold.
 */
export function tipNearCursor(cx: number, cy: number, w: number, h: number, vw: number, vh: number): Point | null {
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
    const pad = 14;
    let x = cx + pad;
    let y = cy + pad;
    if (x + w > vw - EDGE) x = vw - w - EDGE;
    if (y + h > vh - EDGE) y -= h + pad * 2;
    return { left: Math.max(EDGE, x), top: Math.max(EDGE, y) };
}

/**
 * The touch tooltip, for a tapped body at (bx, by): centred above it, where
 * the finger that tapped does not cover it, or below the body and its label
 * (`below` px under the body's centre) when there is no room above. Always
 * inside the viewport and clear of whatever sits along the bottom of it —
 * `bottom` is the tab bar's top edge.
 */
export function tipBesideBody(
    bx: number, by: number, above: number, below: number,
    w: number, h: number, vw: number, bottom: number,
): Point {
    const gap = 10;
    const left = Math.max(EDGE, Math.min(vw - w - EDGE, bx - w / 2));
    let top = by - above - gap - h;
    if (top < EDGE) top = by + below + gap;
    top = Math.max(EDGE, Math.min(bottom - h - EDGE, top));
    return { left, top };
}

/**
 * A body's name: centred under its dot, kept inside `bounds` horizontally, and
 * moved above the dot when under it would cover something.
 *
 * Two kinds of something. `avoid` (the tab bar, the legend) is never printed
 * over. `soft` (the HUD footer's hint and activity line) is kept clear of
 * while either place allows it — but a service's name, and the down or
 * degraded word on it, outranks a line that says "tap a body for detail":
 * when neither place is clear of both, the name takes whichever place is
 * clear of `avoid` alone, over the hint. On a landscape phone the outer ring
 * runs through the footer, and hiding the name there left a down body
 * saying so by colour only.
 *
 * Null only when both places hit `avoid`, where the name would be covered
 * anyway. The body stays; its name is also in the tooltip and the sidebar.
 */
export function placeBodyLabel(
    x: number, dotY: number, gap: number, w: number, h: number,
    bounds: { left: number; right: number }, avoid: readonly Rect[], soft: readonly Rect[] = [],
): { x: number; y: number } | null {
    const cx = clampCentre(x, w, bounds.left, bounds.right);
    // Below, then above, clear of everything; then the same, clear of `avoid`.
    for (const obstacles of [[...avoid, ...soft], avoid]) {
        for (const y of [dotY + gap, dotY - gap - h]) {
            if (!hitsAny({ x: cx - w / 2, y, w, h }, obstacles, 2)) return { x: cx, y };
        }
    }
    return null;
}

/**
 * A ring's name, somewhere along its orbit that nothing else is drawn on.
 *
 * `angle` is where it would like to be — the middle of a gap between the
 * ring's bodies, turning with them (ringGap) — and it may move up to `span`
 * radians either way, in steps of about `stepPx` along the ring, nearest
 * first. Null when every place is taken; the ring then goes unnamed for the
 * moment, which is better than a name printed over a body's (the sidebar
 * groups by the same sections).
 */
export function placeOnRing(
    cx: number, cy: number, r: number, angle: number, span: number,
    w: number, h: number, avoid: readonly Rect[], stepPx = 6, pad = 4,
): { x: number; y: number } | null {
    const step = Math.max(stepPx / Math.max(r, 1), 0.01);
    const n = Math.floor(span / step);
    for (let i = 0; i <= 2 * n; i++) {
        // 0, +1, -1, +2, -2, …: the nearest free place wins.
        const k = i % 2 === 1 ? (i + 1) / 2 : -i / 2;
        const a = angle + k * step;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        if (!hitsAny({ x: x - w / 2, y: y - h / 2, w, h }, avoid, pad)) return { x, y };
    }
    return null;
}

/**
 * Where "MOSSLAND" goes by the core: under it, or else above, right or left
 * of it — the first of those clear of `avoid`, with `gap` px between the core
 * (radius `r`) and the name. Null when all four are taken, which a phone's
 * inner ring, as long as its names are, does for a while every turn.
 */
export function placeByCore(
    cx: number, cy: number, r: number, w: number, h: number, avoid: readonly Rect[], gap = 4,
): { x: number; y: number } | null {
    const spots = [
        { x: cx, y: cy + r + gap + h / 2 },
        { x: cx, y: cy - r - gap - h / 2 },
        { x: cx + r + gap + w / 2, y: cy },
        { x: cx - r - gap - w / 2, y: cy },
    ];
    return spots.find(p => !hitsAny({ x: p.x - w / 2, y: p.y - h / 2, w, h }, avoid, 2)) ?? null;
}

/**
 * The middle of the gap between a ring's `n` bodies nearest `prefer` (all
 * angles at t = 0; bodies sit at -π/2 + i·2π/n, which is how HubMap lays
 * them out). Every body in a ring turns at the same rate, so a name turning
 * with them stays in the middle of its gap for good, as far from its own
 * ring's bodies as it can be; only a neighbouring ring's labels reach it.
 */
export function ringGap(n: number, prefer: number): number {
    // No bodies, or one: the whole ring is the gap, and the one body is an
    // obstacle like any other.
    if (n <= 1) return prefer;
    const gap = (Math.PI * 2) / n;
    let best = -Math.PI / 2 + gap / 2;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (i + 0.5) * gap;
        // Angular distance, wrapped into [0, π].
        const d = Math.abs(Math.atan2(Math.sin(a - prefer), Math.cos(a - prefer)));
        if (d < bestD - 1e-9) { bestD = d; best = a; }
    }
    return best;
}

/**
 * How far right, in page px, the hub has to sit so that the outer ring's
 * labels clear the legend on its left: `reach` is how far a label can stick
 * out past the ring (half the widest name). Capped so the other side stays
 * inside the canvas, which on the narrowest desktop layouts leaves part of
 * the overlap in place — the labels there then step aside (placeBodyLabel).
 */
export function hubShiftPx(o: {
    legendRight: number; canvasLeft: number; canvasRight: number; ring: number; reach: number; gap?: number;
}): number {
    const centre = (o.canvasLeft + o.canvasRight) / 2;
    const extent = o.ring + o.reach;
    const need = o.legendRight + (o.gap ?? 12) - (centre - extent);
    const room = o.canvasRight - EDGE - (centre + extent);
    return Math.max(0, Math.min(need, room));
}
