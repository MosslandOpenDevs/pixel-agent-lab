import { describe, expect, it } from "vitest";
import { beltCardHtml, trustAverage, type BeltState } from "../src/ui/belt-card.ts";

/**
 * The phone's text for a belt view, which the canvas draws at 3–6 px there.
 *
 * Every string in it is another service's JSON behind an unchecked cast —
 * debate topics, idea titles, signal titles, outcome ids — so each is checked
 * for its type and escaped, and a figure that is not a number is a dash, not
 * a zero. The card carries only text that exists nowhere else on a phone; the
 * figures the sidebar shows are left to it.
 *
 * It also states each service's connection state, with the sidebar's words,
 * because on a phone nothing else on a belt view does: the drawer that holds
 * the sidebar is closed, and the map's heading is hidden. Once a service has
 * not answered, its lists are the last it sent, and say so.
 */

const textOf = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const HOSTILE = '<img src=x onerror=alert(1)>"';
/** ☰ as the cards write it: hidden from screen readers, which would read it
 *  as "trigram for heaven". */
const GLYPH = '<span aria-hidden="true">☰</span>';

const LIVE: BeltState = { conn: "live", up: true };
const OFFLINE: BeltState = { conn: "live", up: false };
const CONNECTING: BeltState = { conn: "connecting", up: false };

describe("the Algora card", () => {
    it("lists the signals on the belt, newest first, with stage, severity and origin", () => {
        const html = beltCardHtml({
            zone: "algora", state: LIVE, items: [
                { id: "a-1", title: "Older signal", severity: "high", origin: "ao", stage: "Issue Detection" },
                { id: "a-2", title: "Newest signal", severity: "low", origin: "bridge", stage: "Signal Intake" },
            ],
        });
        const text = textOf(html);
        expect(text.indexOf("Newest signal")).toBeLessThan(text.indexOf("Older signal"));
        expect(text).toContain("low Newest signal Signal Intake · from Bridge");
        expect(text).toContain("high Older signal Issue Detection · from AO");
        expect(html).toContain('class="bc-sev high"');
        // Each row is keyed by the belt's id, which is what keeps it in place.
        expect(html).toContain('<li data-id="a-2">');
    });

    it("escapes a title, and takes the severity class from a fixed set only", () => {
        const html = beltCardHtml({
            zone: "algora", state: LIVE,
            items: [{ id: '"><b>', title: HOSTILE, severity: '"><script>', origin: "x", stage: "Execution" }],
        });
        expect(html).not.toContain("<img");
        expect(html).not.toContain("<script>");
        expect(html).not.toContain("<b>");
        expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;&quot;");
        expect(html).toContain('class="bc-sev low"');
    });

    it("says the belt is empty rather than showing nothing", () => {
        const html = beltCardHtml({ zone: "algora", state: LIVE, items: [] });
        expect(textOf(html)).toContain("No signals on the belt right now.");
        expect(html).toContain('<ol class="bc-list" hidden>');
        expect(html).not.toContain('class="bc-empty" hidden');
    });

    it("says whether Algora answered, and names the panel in words", () => {
        expect(beltCardHtml({ zone: "algora", state: LIVE, items: [] })).toContain('<span class="live-badge">LIVE</span>');
        const off = beltCardHtml({ zone: "algora", state: OFFLINE, items: [] });
        expect(off).toContain('<span class="live-badge off">OFFLINE</span>');
        // The belt carries every service's signals: Algora not answering does
        // not make them old, so the card does not say they are.
        expect(textOf(off)).toContain("No response from Algora this poll.");
        expect(textOf(off)).not.toContain("last data received");
        // The glyph is for the eye; the words match the ☰ button's name.
        expect(beltCardHtml({ zone: "algora", state: LIVE, items: [] }))
            .toContain(`Queue, issues and signal counts are in the info panel (${GLYPH}).`);
    });
});

describe("the AO card", () => {
    const base = { zone: "ao" as const, state: LIVE, debatesErrored: false, projects: 5 };

    it("shows the latest debates with their context, the latest ideas with scores, and the project total", () => {
        const html = beltCardHtml({
            ...base,
            debates: [{ topic: "Treasury policy", context: "Whether to rebalance" }],
            ideas: [
                { title: "Plain idea", score: 6.2 },
                { title: "English", title_ko: "한국어 제목", score: 7.4 },
                { title: "Project idea", score: 8.1 },
            ],
        });
        const text = textOf(html);
        expect(text).toContain("AO · latest debates LIVE");
        expect(text).toContain("Treasury policy Whether to rebalance");
        expect(text).toContain("6.2 Plain idea");
        // The belt's own choice of title: the Korean one first.
        expect(text).toContain("7.4 한국어 제목");
        expect(html).toContain('class="bc-score plan">7.4');
        expect(html).toContain('class="bc-score project">8.1');
        // Projects is in no sidebar row, so it is here; the ideas and plans
        // totals are the sidebar's, and are left to it.
        expect(text).toContain("Total projects: 5");
        expect(text).not.toMatch(/Ideas \d|Plans \d/);
        expect(html).toContain(`Idea and plan totals are in the info panel (${GLYPH}).`);
    });

    it("marks a Korean title as Korean, and only a Korean one", () => {
        const html = beltCardHtml({
            ...base, debates: [],
            ideas: [
                { title: "English", title_ko: "한국어 제목", score: 7 },
                { title: "Fallback", title_ko: null, score: 7 },
                { title: "Empty", title_ko: "", score: 7 },
            ],
        });
        expect(html).toContain('<span class="bc-t" lang="ko">한국어 제목</span>');
        expect(html).toContain('<span class="bc-t">Fallback</span>');
        expect(html).toContain('<span class="bc-t">Empty</span>');
        expect(html.match(/lang="ko"/g)).toHaveLength(1);
    });

    it("gives a score that is not a number a dash, never a zero, and a missing total a dash", () => {
        const html = beltCardHtml({
            ...base, projects: null,
            debates: [], ideas: [{ title: "Unscored", score: "9" }, { title: "NaN", score: Number.NaN }],
        });
        expect(textOf(html)).toContain("— Unscored");
        expect(textOf(html)).toContain("— NaN");
        expect(html).not.toContain(">0.0<");
        expect(textOf(html)).toContain("Total projects: —");
    });

    it("tells AO erroring from still loading, as the canvas card does", () => {
        expect(textOf(beltCardHtml({ ...base, debates: [], ideas: [] }))).toContain("Awaiting debate data…");
        expect(textOf(beltCardHtml({ ...base, debatesErrored: true, debates: [], ideas: [] }))).toContain("AO debates unavailable");
    });

    it("says OFFLINE, and calls its lists the last received, when AO did not answer", () => {
        const text = textOf(beltCardHtml({
            ...base, state: OFFLINE,
            debates: [{ topic: "Treasury policy" }], ideas: [{ title: "Old idea", score: 7 }],
        }));
        expect(text).toContain("OFFLINE");
        expect(text).not.toContain("LIVE");
        expect(text).toContain("No response from AO this poll — showing the last data received.");
        expect(text).toContain("AO · debates last received");
        expect(text).toContain("Ideas last received");
        expect(text).not.toMatch(/latest/i);
        expect(text).toContain("Total projects: 5 (last received)");
    });

    it("calls the debates the last received when their own read failed and kept them", () => {
        const text = textOf(beltCardHtml({ ...base, debatesErrored: true, debates: [{ topic: "Kept" }], ideas: [] }));
        expect(text).toContain("AO · debates last received LIVE");
        expect(text).toContain("Latest ideas");
    });

    it("escapes every string, and skips entries that are not objects", () => {
        const html = beltCardHtml({
            ...base,
            debates: [null, 7, { topic: HOSTILE, context: HOSTILE }],
            ideas: ["idea", { title: HOSTILE, score: 7 }],
        });
        expect(html).not.toContain("<img");
        expect(html.match(/&lt;img/g)).toHaveLength(3);
    });
});

describe("the Bridge card", () => {
    it("shows the trust average and recent outcomes, and leaves the sidebar's figures to it", () => {
        const html = beltCardHtml({
            zone: "bridge", state: LIVE,
            trust: [{ score: 7 }, { score: 8 }, { score: "9" }],
            outcomes: [{ id: "abcdef0123456789", status: "verified", success: true }, { id: "x2", success: false }],
        });
        const text = textOf(html);
        expect(text).toContain("Agent trust 7.5");
        expect(text).toContain("Recent outcomes");
        expect(text).toContain("OK abcdef01234… verified");
        expect(text).toContain("FAIL x2");
        expect(text).not.toMatch(/Proposals \d|Success \d/);
        expect(html).toContain(`Proposal and success figures are in the info panel (${GLYPH}).`);
    });

    it("says OFFLINE, and what its figures then are, when Bridge did not answer", () => {
        const text = textOf(beltCardHtml({
            zone: "bridge", state: OFFLINE, trust: [{ score: 7 }], outcomes: [{ id: "p1", success: true }],
        }));
        expect(text).toContain("OFFLINE");
        expect(text).not.toContain("LIVE");
        expect(text).toContain("Agent trust (last received) 7.0");
        expect(text).toContain("Outcomes last received");
        expect(text).not.toContain("Recent outcomes");
    });

    it("claims no verdict an outcome did not give, and no average without scores", () => {
        const html = beltCardHtml({ zone: "bridge", state: LIVE, trust: [], outcomes: [{ id: "p1", success: "yes" }] });
        expect(textOf(html)).toContain("Agent trust —");
        expect(textOf(html)).toContain("— p1");
        expect(html).not.toContain("bc-out ok");
        expect(textOf(beltCardHtml({ zone: "bridge", state: LIVE, trust: [], outcomes: [] }))).toContain("No outcomes to show.");
    });

    it("escapes an outcome's id and status", () => {
        const html = beltCardHtml({ zone: "bridge", state: LIVE, trust: [], outcomes: [{ id: HOSTILE, status: HOSTILE, success: true }] });
        expect(html).not.toContain("<img");
    });
});

describe("before the first verdict", () => {
    it("every card says CONNECTING, and nothing about the lists being old", () => {
        const cards = [
            beltCardHtml({ zone: "algora", state: CONNECTING, items: [] }),
            beltCardHtml({ zone: "ao", state: CONNECTING, debates: [], debatesErrored: false, ideas: [], projects: null }),
            beltCardHtml({ zone: "bridge", state: CONNECTING, trust: [], outcomes: [] }),
        ];
        for (const html of cards) {
            expect(html).toContain('<span class="live-badge wait">CONNECTING</span>');
            expect(html).not.toMatch(/OFFLINE|>LIVE<|last received|No response/);
        }
    });
});

describe("trustAverage", () => {
    it("averages the finite scores and nothing else", () => {
        expect(trustAverage([{ score: 2 }, { score: 4 }, { score: Number.POSITIVE_INFINITY }, null, { score: "6" }])).toBe(3);
        expect(trustAverage([])).toBeNull();
        expect(trustAverage([{ score: null }])).toBeNull();
    });
});
