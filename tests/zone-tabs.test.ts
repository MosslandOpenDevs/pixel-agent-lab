import { describe, expect, it } from "vitest";
import { syncZoneTabs, tabKeyTarget } from "../src/ui/zone-tabs.ts";

/**
 * The tab bar as the tabs pattern it announces itself as: a screen reader
 * says "tab, 1 of 4" and offers the arrow keys, which did nothing, and every
 * tab was a Tab stop of its own.
 */

describe("tabKeyTarget", () => {
    it("moves with the arrow keys, wrapping at either end", () => {
        expect(tabKeyTarget("ArrowRight", 0, 4)).toBe(1);
        expect(tabKeyTarget("ArrowRight", 3, 4)).toBe(0);
        expect(tabKeyTarget("ArrowLeft", 0, 4)).toBe(3);
        expect(tabKeyTarget("ArrowLeft", 2, 4)).toBe(1);
    });

    it("jumps with Home and End, and leaves every other key alone", () => {
        expect(tabKeyTarget("Home", 2, 4)).toBe(0);
        expect(tabKeyTarget("End", 1, 4)).toBe(3);
        for (const key of ["Tab", "Enter", " ", "ArrowUp", "ArrowDown", "a"]) {
            expect(tabKeyTarget(key, 1, 4)).toBeNull();
        }
    });
});

describe("syncZoneTabs", () => {
    const tab = (zone: string) => {
        const attrs: Record<string, string> = {};
        const classes = new Set<string>();
        return {
            id: `tab-${zone}`, dataset: { zone } as DOMStringMap, tabIndex: 0, attrs, classes,
            classList: { toggle: (c: string, on?: boolean) => (on ? classes.add(c) : classes.delete(c), !!on) },
            setAttribute: (n: string, v: string) => { attrs[n] = v; },
        };
    };

    it("selects one tab, makes it the only Tab stop, and labels the stage by it", () => {
        const tabs = ["hub", "algora", "ao", "bridge"].map(tab);
        const stage: Record<string, string> = {};
        const doc = {
            querySelectorAll: () => tabs,
            getElementById: (id: string) => (id === "stage" ? { setAttribute: (n: string, v: string) => { stage[n] = v; } } : null),
        };
        syncZoneTabs("ao", doc);
        expect(tabs.map(t => t.attrs["aria-selected"])).toEqual(["false", "false", "true", "false"]);
        expect(tabs.map(t => t.tabIndex)).toEqual([-1, -1, 0, -1]);
        expect(tabs.map(t => t.classes.has("active"))).toEqual([false, false, true, false]);
        expect(stage["aria-labelledby"]).toBe("tab-ao");

        // The map switches zone too (a streaming body's belt): same result.
        syncZoneTabs("hub", doc);
        expect(tabs.map(t => t.tabIndex)).toEqual([0, -1, -1, -1]);
        expect(stage["aria-labelledby"]).toBe("tab-hub");
    });
});
