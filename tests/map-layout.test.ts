import { describe, expect, it } from "vitest";
import {
    clampCentre, hubShiftPx, overlaps, placeBodyLabel, placeByCore, placeOnRing, ringGap, tipBesideBody,
    tipNearCursor, type Rect,
} from "../src/ui/map-layout.ts";

/**
 * Where the map's DOM text goes. Every readable thing on the map is a DOM
 * node over the canvas, and nothing but this keeps two of them apart — or
 * keeps one on the screen. The numbers are page px, as HubMap projects them;
 * the cases are the ones seen on real layouts.
 */

const within = (r: Rect, o: Rect) => !overlaps(r, o);

describe("overlaps", () => {
    it("counts padding as part of each rect, and touching edges as clear", () => {
        const a = { x: 0, y: 0, w: 10, h: 10 };
        expect(overlaps(a, { x: 10, y: 0, w: 5, h: 5 })).toBe(false);
        expect(overlaps(a, { x: 11, y: 0, w: 5, h: 5 }, 2)).toBe(true);
        expect(overlaps(a, { x: 5, y: 5, w: 1, h: 1 })).toBe(true);
    });
});

describe("clampCentre", () => {
    it("keeps a name inside the screen at a phone's edge", () => {
        // "Mossland Signal", ~92px wide, centred at 341px on a 375px phone,
        // ran to 387 and was printed as "Mossland Signa".
        const x = clampCentre(341, 92, 0, 375);
        expect(x + 92 / 2).toBeLessThanOrEqual(375 - 4);
        expect(clampCentre(20, 60, 0, 375) - 30).toBeGreaterThanOrEqual(4);
        // Where it fits, it stays centred on its body.
        expect(clampCentre(187, 92, 0, 375)).toBe(187);
    });

    it("centres something wider than the room instead of pinning it to one edge", () => {
        expect(clampCentre(10, 400, 0, 375)).toBe(187.5);
    });
});

describe("tipNearCursor", () => {
    it("sits below and right of the cursor, as the desktop tooltip always has", () => {
        expect(tipNearCursor(100, 100, 200, 80, 1440, 900)).toEqual({ left: 114, top: 114 });
    });

    it("pulls left at the right edge and flips above at the bottom", () => {
        expect(tipNearCursor(1400, 870, 200, 80, 1440, 900)).toEqual({ left: 1232, top: 870 + 14 - 80 - 28 });
    });

    it("gives no position for a cursor that is not a number, rather than writing NaNpx", () => {
        // A TouchEvent has no clientX: the style write was dropped and the
        // tooltip sat at its static position, below the fold.
        expect(tipNearCursor(Number.NaN, 100, 200, 80, 375, 812)).toBeNull();
        expect(tipNearCursor(undefined as unknown as number, 100, 200, 80, 375, 812)).toBeNull();
    });
});

describe("tipBesideBody", () => {
    it("goes above a tapped body, where the finger does not cover it", () => {
        const p = tipBesideBody(187, 400, 10, 20, 200, 90, 375, 766);
        expect(p.top + 90).toBeLessThanOrEqual(400 - 10);
        expect(p.left).toBe(87);
    });

    it("goes below the body and its name when there is no room above", () => {
        const p = tipBesideBody(187, 60, 10, 20, 200, 90, 375, 766);
        expect(p.top).toBeGreaterThanOrEqual(60 + 20);
    });

    it("stays on screen and above the tab bar, whatever the body's position", () => {
        for (const [x, y] of [[0, 0], [375, 812], [370, 760], [5, 400]]) {
            const p = tipBesideBody(x, y, 10, 20, 240, 110, 375, 766);
            expect(p.left).toBeGreaterThanOrEqual(8);
            expect(p.left + 240).toBeLessThanOrEqual(375 - 8);
            expect(p.top).toBeGreaterThanOrEqual(8);
            expect(p.top + 110).toBeLessThanOrEqual(766 - 8);
        }
    });
});

describe("placeBodyLabel", () => {
    const tabBar = { x: 393, y: 723, w: 238, h: 30 };
    const bounds = { left: 0, right: 1024 };

    it("puts a name under its dot, inside the screen", () => {
        expect(placeBodyLabel(500, 300, 8, 60, 11, bounds, [tabBar])).toEqual({ x: 500, y: 308 });
        expect(placeBodyLabel(1020, 300, 8, 60, 11, bounds, [])?.x).toBe(1024 - 30 - 4);
    });

    it("moves a name above its dot when under it would cover the tab bar", () => {
        // "Recipe", the lowest body at 1024x768, sat under the tab bar.
        const at = placeBodyLabel(512, 712, 8, 40, 11, bounds, [tabBar]);
        expect(at).toEqual({ x: 512, y: 712 - 8 - 11 });
        expect(within({ x: at!.x - 20, y: at!.y, w: 40, h: 11 }, tabBar)).toBe(true);
    });

    it("hides a name that would cover something either way", () => {
        expect(placeBodyLabel(512, 735, 8, 40, 11, bounds, [tabBar])).toBeNull();
    });

    // A landscape phone, 740x360: the tab bar along the bottom and the touch
    // hint just above it, which the outer ring runs through.
    const phoneTabs = { x: 0, y: 314, w: 740, h: 46 };
    const hint = { x: 14, y: 287, w: 311, h: 13 };
    const phone = { left: 0, right: 740 };

    it("prints a name over the footer hint rather than hide it, when the tab bar leaves no other place", () => {
        // Under the dot is the tab bar; above it is the hint. MOSS.AO, down,
        // lost its name (and the word on it) here.
        const at = placeBodyLabel(282, 299, 8, 60, 24, phone, [phoneTabs], [hint]);
        expect(at).toEqual({ x: 282, y: 299 - 8 - 24 });
        expect(within({ x: at!.x - 30, y: at!.y, w: 60, h: 24 }, phoneTabs)).toBe(true);
    });

    it("still keeps a name off the footer where there is room clear of it", () => {
        // Under the dot is the hint; above it is clear: above, not over the hint.
        const at = placeBodyLabel(150, 272, 8, 60, 11, phone, [phoneTabs], [hint]);
        expect(at).toEqual({ x: 150, y: 272 - 8 - 11 });
        expect(within({ x: at!.x - 30, y: at!.y, w: 60, h: 11 }, hint)).toBe(true);
    });

    it("hides a name only when both places are under the tab bar or the legend", () => {
        const legend = { x: 100, y: 250, w: 120, h: 40 };
        expect(placeBodyLabel(150, 300, 8, 60, 11, phone, [phoneTabs, legend], [hint])).toBeNull();
    });
});

describe("placeOnRing", () => {
    it("sits where it would like to when that is free", () => {
        const at = placeOnRing(0, 0, 100, 0, 1, 40, 10, []);
        expect(at!.x).toBeCloseTo(100);
        expect(at!.y).toBeCloseTo(0);
    });

    it("steps aside along the ring from a name in its way, nearest first", () => {
        // A neighbouring ring's label right where the name wants to be.
        const label = { x: 80, y: -8, w: 40, h: 16 };
        const at = placeOnRing(0, 0, 100, 0, 1, 40, 10, [label]);
        expect(at).not.toBeNull();
        expect(within({ x: at!.x - 20, y: at!.y - 5, w: 40, h: 10 }, label)).toBe(true);
        // …and not further than it has to: still near the angle it wanted.
        expect(Math.abs(Math.atan2(at!.y, at!.x))).toBeLessThan(0.4);
    });

    it("gives up, and the name is hidden, when its whole span is taken", () => {
        const wall = { x: -200, y: -200, w: 400, h: 400 };
        expect(placeOnRing(0, 0, 100, 0, 1, 40, 10, [wall])).toBeNull();
    });
});

describe("placeByCore", () => {
    it("tries under the core, then above, right and left", () => {
        expect(placeByCore(0, 0, 10, 40, 10, [])).toEqual({ x: 0, y: 10 + 4 + 5 });
        const under = { x: -30, y: 12, w: 60, h: 10 };
        expect(placeByCore(0, 0, 10, 40, 10, [under])).toEqual({ x: 0, y: -(10 + 4 + 5) });
        const above = { x: -30, y: -25, w: 60, h: 10 };
        expect(placeByCore(0, 0, 10, 40, 10, [under, above])?.x).toBe(10 + 4 + 20);
    });

    it("has nowhere to go when every side is taken", () => {
        expect(placeByCore(0, 0, 10, 40, 10, [{ x: -100, y: -100, w: 200, h: 200 }])).toBeNull();
    });
});

describe("ringGap", () => {
    it("puts a ring's name in the middle of a gap between its bodies, nearest the upper left", () => {
        // Four bodies at 12, 3, 6 and 9 o'clock: the gap centred on -135°.
        const g = ringGap(4, -0.75 * Math.PI);
        expect(Math.cos(g)).toBeCloseTo(Math.cos(-0.75 * Math.PI));
        expect(Math.sin(g)).toBeCloseTo(Math.sin(-0.75 * Math.PI));
        // Ten bodies, 36° apart: half a gap (18°) from the nearest body, the
        // furthest a name can be — never on one, as the fixed diagonal was.
        const ten = ringGap(10, -0.75 * Math.PI);
        const nearest = Math.min(...Array.from({ length: 10 }, (_, i) => {
            const body = -Math.PI / 2 + (i / 10) * Math.PI * 2;
            return Math.abs(Math.atan2(Math.sin(ten - body), Math.cos(ten - body)));
        }));
        expect(nearest).toBeCloseTo(Math.PI / 10);
    });

    it("keeps the preferred angle with one body or none", () => {
        expect(ringGap(0, 1)).toBe(1);
        expect(ringGap(1, 1)).toBe(1);
    });
});

describe("hubShiftPx", () => {
    it("moves the hub right just far enough that the outer ring's names clear the legend", () => {
        // 1120x760 desktop: the canvas spans 288-1120, the legend ends at 581.
        const shift = hubShiftPx({ legendRight: 581, canvasLeft: 288, canvasRight: 1120, ring: 180, reach: 60 });
        const centre = (288 + 1120) / 2 + shift;
        expect(centre - 180 - 60).toBeCloseTo(581 + 12);
        expect(centre + 180 + 60).toBeLessThanOrEqual(1120 - 8);
    });

    it("never pushes the other side off the canvas, and does nothing where it is already clear", () => {
        const capped = hubShiftPx({ legendRight: 700, canvasLeft: 288, canvasRight: 1000, ring: 200, reach: 60 });
        expect((288 + 1000) / 2 + capped + 260).toBeCloseTo(1000 - 8);
        // 1920 wide: the legend is far from the ring already.
        expect(hubShiftPx({ legendRight: 581, canvasLeft: 288, canvasRight: 1912, ring: 300, reach: 60 })).toBe(0);
    });
});
