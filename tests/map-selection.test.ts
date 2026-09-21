import { describe, expect, it } from "vitest";
import { TouchSelection } from "../src/ui/map-selection.ts";

/**
 * Tap to inspect, tap again to open.
 *
 * With the mouse's handlers a single tap showed a body's tooltip, opened the
 * body — a new tab, for most — and hid the tooltip again, all in one gesture,
 * so a phone never saw what a body reports and left the monitor on every
 * exploratory tap. Each rule below is one way back to that.
 */
describe("TouchSelection", () => {
    it("selects on the first tap and opens only on a second tap on the same body", () => {
        const sel = new TouchSelection();
        expect(sel.tapBody("signalmap")).toBe("select");
        expect(sel.selected).toBe("signalmap");
        expect(sel.tapBody("signalmap")).toBe("activate");
        // Opening ends the selection: the next tap starts over.
        expect(sel.selected).toBeNull();
        expect(sel.tapBody("signalmap")).toBe("select");
    });

    it("moves the selection to another body rather than opening either", () => {
        const sel = new TouchSelection();
        sel.tapBody("signalmap");
        expect(sel.tapBody("passport")).toBe("select");
        expect(sel.selected).toBe("passport");
        // The first body needs its own two taps again.
        expect(sel.tapBody("signalmap")).toBe("select");
    });

    it("clears on a tap on empty space, and says whether there was anything to clear", () => {
        const sel = new TouchSelection();
        expect(sel.tapEmpty()).toBe(false);
        sel.tapBody("signalmap");
        expect(sel.tapEmpty()).toBe(true);
        expect(sel.selected).toBeNull();
        // So a tap after it selects instead of opening.
        expect(sel.tapBody("signalmap")).toBe("select");
    });

    it("forgets the selection when the map is hidden, so coming back cannot open on one tap", () => {
        const sel = new TouchSelection();
        sel.tapBody("signalmap");
        expect(sel.clear()).toBe(true);
        expect(sel.tapBody("signalmap")).toBe("select");
    });

    it("keeps a selection through a rebuild only while its body is still there", () => {
        const sel = new TouchSelection();
        sel.tapBody("signalmap");
        expect(sel.retain(id => id === "signalmap")).toBe(true);
        expect(sel.selected).toBe("signalmap");
        expect(sel.retain(() => false)).toBe(false);
        expect(sel.selected).toBeNull();
    });
});
