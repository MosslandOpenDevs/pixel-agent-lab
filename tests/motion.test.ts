import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onReducedMotionChange, reducedMotion, resetMotionForTests } from "../src/ui/motion.ts";

/**
 * The one place the page asks whether motion is reduced.
 *
 * Each reader used to ask matchMedia for itself, and the map asked once, at
 * create(): turning the setting on while the page was open stopped the
 * tab-switch pans and left the galaxy turning until a reload. What matters
 * is that the answer follows the setting, and that what needs to hear about
 * a change — the map, with motes in flight — does.
 */

/**
 * A MediaQueryList that behaves as Chromium's does: reading `matches` updates
 * the state `change` is decided against, so a read between the setting
 * changing and the dispatch swallows the event. `flip` changes the setting;
 * `dispatch` is the browser getting round to the event.
 */
function chromiumQuery(initial: boolean) {
    let setting = initial;
    let cached = initial;
    const listeners: ((e: { matches: boolean }) => void)[] = [];
    const mq = {
        reads: 0,
        get matches() { mq.reads++; cached = setting; return setting; },
        addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => { listeners.push(fn); },
        flip(v: boolean) { setting = v; },
        dispatch() {
            if (cached === setting) return;
            cached = setting;
            listeners.forEach(fn => fn({ matches: setting }));
        },
    };
    return mq;
}

beforeEach(() => resetMotionForTests());
afterEach(() => { vi.unstubAllGlobals(); resetMotionForTests(); });

describe("reducedMotion", () => {
    it("is false where there is no matchMedia, as in this runner", () => {
        expect(reducedMotion()).toBe(false);
    });

    it("asks the reduced-motion query once, and follows its change events", () => {
        const mq = chromiumQuery(true);
        const matchMedia = vi.fn(() => mq);
        vi.stubGlobal("window", { matchMedia });
        expect(reducedMotion()).toBe(true);
        expect(matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
        mq.flip(false);
        mq.dispatch();
        expect(reducedMotion()).toBe(false);
        expect(matchMedia).toHaveBeenCalledTimes(1);
    });

    it("tells a subscriber about a change even while something reads it every frame", () => {
        // The belts read this every frame. Had each read gone to `matches`,
        // the one between the change and its dispatch would have swallowed
        // the event, and the map — the subscriber — would have kept turning.
        const mq = chromiumQuery(false);
        vi.stubGlobal("window", { matchMedia: () => mq });
        const seen: boolean[] = [];
        onReducedMotionChange(r => seen.push(r));
        mq.flip(true);
        for (let frame = 0; frame < 3; frame++) reducedMotion();
        mq.dispatch();
        expect(seen).toEqual([true]);
        expect(reducedMotion()).toBe(true);
        // One read, when the query was made.
        expect(mq.reads).toBe(1);
    });

    it("stops telling a subscriber once it unsubscribes", () => {
        const mq = chromiumQuery(false);
        vi.stubGlobal("window", { matchMedia: () => mq });
        const seen: boolean[] = [];
        const off = onReducedMotionChange(r => seen.push(r));
        mq.flip(true); mq.dispatch();
        mq.flip(false); mq.dispatch();
        off();
        mq.flip(true); mq.dispatch();
        expect(seen).toEqual([true, false]);
    });
});
