import { describe, expect, it } from "vitest";
import { esc, str } from "../src/ui/html.ts";

/**
 * The two guards every sink puts between another service's JSON and the page.
 *
 * Both take `unknown` on purpose. The values they guard are typed `string` by
 * a cast over a response body, which is a claim about the upstream, not a
 * check — and the sinks that trusted it threw on the first number they met,
 * inside a hover handler and inside a Phaser frame.
 */

describe("esc", () => {
    it("escapes the four characters that can break out of text or an attribute", () => {
        expect(esc(`<img src="x" onerror=alert(1)>`))
            .toBe("&lt;img src=&quot;x&quot; onerror=alert(1)&gt;");
        expect(esc("a & b")).toBe("a &amp; b");
    });

    it("leaves a single quote alone, which is why every attribute it guards is double-quoted", () => {
        expect(esc("it's")).toBe("it's");
    });

    it("survives what a cast to string cannot promise", () => {
        expect(esc(null)).toBe("");
        expect(esc(undefined)).toBe("");
        expect(esc(42)).toBe("42");
        expect(esc(0)).toBe("0");
        expect(esc(false)).toBe("false");
    });
});

describe("str", () => {
    it("passes real text through unchanged", () => {
        expect(str("Arbitrum Liquidity Sentinel")).toBe("Arbitrum Liquidity Sentinel");
        expect(str("")).toBe("");
    });

    it("refuses everything that is not text, so a sink can slice the result", () => {
        // Each of these reached `.slice` behind a `?? ""` or a `??` chain and
        // threw inside a frame, which stops every surface drawn after it.
        for (const v of [42, 0, true, null, undefined, {}, { _: "x", $: {} }, [1, 2], () => "x"]) {
            expect(str(v)).toBe("");
            expect(() => str(v).slice(0, 8)).not.toThrow();
        }
    });

    it("does not print an object as text, the way String() would", () => {
        // An RSS <title> parsed from XML arrives as {_, $}; "[object Object]"
        // on the belt is worse than the caller's own fallback.
        expect(str({ _: "Title", $: { lang: "en" } })).not.toContain("object");
        expect(str(12) || str("Idea")).toBe("Idea");
    });
});
