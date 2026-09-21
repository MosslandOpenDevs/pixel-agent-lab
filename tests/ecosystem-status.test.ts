import { describe, expect, it } from "vitest";
import {
    ageText, clockTime, documentTitle, freshnessText, healthBucket, namesHtml, shortClock,
    tallyHtml, tallyServices,
} from "../src/ui/ecosystem-status.ts";
import type { EcosystemNode, HealthFreshness } from "../src/services/ecosystem-feed.ts";
import type { HealthEntry, RegistryService } from "../src/services/types.ts";

/**
 * The tally the map's HUD, the sidebar and the page title all read.
 *
 * Each rule here is the difference between the map saying what the services
 * report and saying something kinder: an off-contract answer folded into ok,
 * an unreachable service folded into down, a file counted as a service, or a
 * reading nobody could refresh presented in the tab strip as all clear.
 */

const node = (id: string, status: string | null, o: Partial<RegistryService> = {}, kind: EcosystemNode["kind"] = "service"): EcosystemNode => ({
    service: { id, name: id, url: `https://${id}.moss.land`, section: "ecosystem", tier: "labs", owner: "mossland", ...o } as RegistryService,
    health: status === null ? null : ({ service: id, status } as HealthEntry),
    instrumentation: status === null ? "listed" : "health",
    kind,
});
const textOf = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const at = new Date(2026, 8, 21, 14, 32, 5).getTime();
const fresh: HealthFreshness = { state: "fresh", checkedAt: at, sweeping: false, settled: true };
const stale: HealthFreshness = { state: "stale", checkedAt: at, sweeping: false, settled: true };

describe("healthBucket", () => {
    it("gives the contract's three verdicts their own buckets and nothing else", () => {
        expect(healthBucket({ service: "x", status: "ok" })).toBe("ok");
        expect(healthBucket({ service: "x", status: "degraded" })).toBe("degraded");
        expect(healthBucket({ service: "x", status: "down" })).toBe("down");
        // Untranslated: algora's "running" is an answer, not an ok.
        expect(healthBucket({ service: "x", status: "running" })).toBe("offcontract");
        expect(healthBucket({ service: "x", status: "OK" })).toBe("offcontract");
        // No reading is not an outage.
        expect(healthBucket(null)).toBe("unmeasured");
    });
});

describe("tallyServices", () => {
    const nodes = [
        node("moss", "ok"), node("npc", "ok"),
        node("signalmap", "down", { name: "Signal Map" }),
        node("passport", "degraded", { name: "Passport" }),
        node("algora", "running", { name: "Algora", lifecycle: "archive" }),
        node("media", null, { name: "Media", status: "deprecated" }),
        node("recipe", null),
        node("upbit", "down", { owner: "third-party" }, "link"),
        node("llms-txt", "ok", { artifact: true }, "artifact"),
    ];

    it("counts services only, one bucket each", () => {
        const t = tallyServices(nodes);
        expect(t.counts).toEqual({ ok: 2, offcontract: 1, degraded: 1, down: 1, unmeasured: 2 });
        expect(t.services).toBe(7);
        expect(textOf(tallyHtml(t))).toBe("2 ok · 1 off-contract · 1 degraded · 1 down · 2 unmeasured");
    });

    it("counts archived services by their reading and flags them where they are named", () => {
        // An archived service still read here can still go down; leaving it
        // out of the tally would hide exactly that.
        const t = tallyServices(nodes);
        expect(t.archived).toBe(2);
        expect(textOf(namesHtml(t))).toBe("down: Signal Map · degraded: Passport · off-contract: Algora (archived)");
    });

    it("names nothing when every reading is ok or absent, and caps the list when asked", () => {
        expect(namesHtml(tallyServices([node("moss", "ok"), node("recipe", null)]))).toBe("");
        const many = tallyServices(["a", "b", "c", "d", "e", "f"].map(id => node(id, "down")));
        expect(textOf(namesHtml(many, 4))).toBe("down: a, b, c, d +2 more");
    });

    it("keeps each name whole on a line, with its bucket label or comma attached", () => {
        // Left to wrap at any space, "Mossland Signal" broke into "Mossland" /
        // "Signal" — and Mossland is a registry service of its own, so the
        // first line named the wrong one as down. The text is unchanged.
        const t = tallyServices([
            node("signal", "down", { name: "Mossland Signal" }),
            node("signalmap", "down", { name: "Signal Map" }),
            node("algora", "running", { name: "Algora", lifecycle: "archive" }),
        ]);
        const html = namesHtml(t);
        expect(textOf(html)).toBe("down: Mossland Signal, Signal Map · off-contract: Algora (archived)");
        expect(html).toContain('<span class="nm">down: Mossland Signal,</span> <span class="nm">Signal Map</span>');
        expect(html).toContain('<span class="nm">off-contract: Algora (archived)</span>');

        // "+N more" stays with the last name shown, never alone on a line.
        const many = tallyServices(["a", "b", "c", "d", "e", "f"].map(id => node(id, "down")));
        expect(namesHtml(many, 4)).toContain('<span class="nm">d +2 more</span>');
    });

    it("escapes a service name, and classes buckets only from the fixed set", () => {
        const t = tallyServices([node("x", "down", { name: '<img src=x onerror="alert(1)">' })]);
        expect(namesHtml(t)).not.toContain("<img");
        expect(namesHtml(t)).toContain("&lt;img");
        expect(tallyHtml(t)).toContain('<span class="tally-down"><b>1</b> down</span>');
        expect(tallyHtml(t)).toContain('<span class="tally-ok zero"><b>0</b> ok</span>');
    });
});

describe("documentTitle", () => {
    const base = "Mossland Space Hub — Governance Monitor";
    const t = (...statuses: (string | null)[]) => tallyServices(statuses.map((s, i) => node(`s${i}`, s)));

    it("prefixes while anything is down or degraded, and is the plain title when clear", () => {
        expect(documentTitle(base, t("ok", "down"), fresh)).toBe(`(1 down) ${base}`);
        expect(documentTitle(base, t("down", "degraded", "degraded"), fresh)).toBe(`(1 down, 2 degraded) ${base}`);
        // Off-contract and unmeasured are not alarms.
        expect(documentTitle(base, t("ok", "running", null), fresh)).toBe(base);
        expect(documentTitle(base, null, null)).toBe(base);
    });

    it("says so when the reading behind it is stale, rather than reading as all clear", () => {
        expect(documentTitle(base, t("ok"), stale)).toBe(`(health stale) ${base}`);
        expect(documentTitle(base, t("down"), stale)).toBe(`(1 down, stale) ${base}`);
        expect(documentTitle(base, t("ok"), { ...stale, state: "refreshing" })).toBe(base);
    });
});

describe("dating a reading", () => {
    it("formats local clock times and coarse ages", () => {
        expect(clockTime(at)).toBe("14:32:05");
        expect(shortClock(at)).toBe("14:32");
        expect(ageText(12_400)).toBe("12 s ago");
        expect(ageText(-5)).toBe("0 s ago");
        expect(ageText(3 * 60_000 + 59_000)).toBe("3 min ago");
        expect(ageText(2 * 3_600_000 + 1)).toBe("2 h ago");
    });

    it("reads every freshness state in words", () => {
        expect(freshnessText(fresh)).toBe("health checked 14:32:05");
        expect(freshnessText({ ...fresh, state: "refreshing", sweeping: true })).toBe("health checked 14:32:05 · refreshing…");
        expect(freshnessText(stale)).toBe("health stale since 14:32");
        expect(freshnessText({ state: "none", checkedAt: null, sweeping: true, settled: false })).toBe("checking health…");
        expect(freshnessText({ state: "none", checkedAt: null, sweeping: false, settled: true })).toBe("no health reading yet");
    });
});
