import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initSidebar, setConnectionStatus, updateEcosystem, updateSidebar } from "../src/ui/Sidebar.ts";
import type { DataBridge, LiveStats } from "../src/services/data-bridge.ts";
import type { EcosystemFeed, EcosystemNode, HealthFreshness, RegistryState } from "../src/services/ecosystem-feed.ts";
import type { HealthEntry, RegistryService } from "../src/services/types.ts";
import { clockTime, shortClock } from "../src/ui/ecosystem-status.ts";

/**
 * What the sidebar writes into its markup from other services' JSON.
 *
 * Every value here arrives behind an unchecked cast and is rendered with
 * innerHTML twice a second, so each one is only as trustworthy as its type.
 * A figure that is not a finite number was not obtained — whatever it says —
 * and gets the same dash as a service that did not answer. That keeps a
 * renamed field from reading "undefined", a numeric string from passing as a
 * figure, and, as defence in depth, anything but a number out of the markup.
 *
 * The DOM is a stub of the few calls Sidebar makes; no DOM library needed.
 */

type El = { innerHTML: string };
let els: Record<string, El>;

beforeEach(() => {
    els = {};
    const el = () => ({
        innerHTML: "", dataset: {},
        addEventListener() {}, setAttribute() {},
        classList: { toggle() {}, contains: () => false },
    });
    vi.stubGlobal("document", {
        querySelector: (sel: string) => (els[sel] ??= el()),
        getElementById: (id: string) => (els[`#${id}`] ??= el()),
        querySelectorAll: () => [],
        addEventListener() {},
        dispatchEvent() {},
    });
    initSidebar();
});

afterEach(() => { vi.unstubAllGlobals(); });

const textOf = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

type Flags = { algora: boolean; ao: boolean; bridge: boolean };
const ALL: Flags = { algora: true, ao: true, bridge: true };

const bridgeWith = (liveStats: unknown, o: {
    up?: Flags; statsUp?: Flags; conn?: string; statsAt?: Record<string, number | null>;
} = {}): DataBridge => ({
    liveStats: liveStats as LiveStats,
    serviceUp: o.up ?? ALL,
    statsUp: o.statsUp ?? o.up ?? ALL,
    statsAt: o.statsAt ?? { algora: 1, ao: 1, bridge: 1 },
    connectionState: () => o.conn ?? "live",
    queueSize: () => 3,
}) as unknown as DataBridge;

const LIVE = {
    algora: { activeAgents: 8, totalAgents: 38, activeSessions: 1, signalsToday: 372, openIssues: 129 },
    ao: { status: "operational", stats: { signals_today: 449, debates_today: 2, ideas_generated: 4402, plans_created: 80, agents_active: 34 } },
    bridge: {
        signals: { total: 835170 }, issues: { total: 753 },
        proposals: { total: 21 }, outcomes: { totalProofs: 4, successRate: 75 },
    },
};

describe("updateSidebar", () => {
    it("shows the services' own figures", () => {
        updateSidebar(bridgeWith(LIVE));

        expect(textOf(els["#stats"].innerHTML)).toContain("Open Issues 129 Debates Today 2");
        const io = textOf(els["#serviceStatus"].innerHTML);
        expect(io).toContain("Signals 372/today");
        expect(io).toContain("sessions:1 · agents:38");
        expect(io).toContain("Ideas 4402 · Plans 80");
        expect(io).toContain(`${(835170).toLocaleString()} signals`);
        expect(io).toContain("Issues 753 · Proofs 4");
        expect(io).toContain("proposals:21 · success:75%");
    });

    it("renders anything but a finite number as a dash, never as markup, zero or 'undefined'", () => {
        const payload = '<img src=x onerror="alert(1)">';
        updateSidebar(bridgeWith({
            algora: { openIssues: payload, signalsToday: "12", activeSessions: NaN, totalAgents: 38 },
            // A renamed or dropped field: only one of AO's figures survives.
            ao: { stats: { debates_today: 2 } },
            bridge: {
                signals: { total: "835170" }, issues: { total: 753 },
                outcomes: { totalProofs: null, successRate: Number.POSITIVE_INFINITY }, proposals: {},
            },
        }));

        const stats = els["#stats"].innerHTML;
        const io = els["#serviceStatus"].innerHTML;
        for (const html of [stats, io]) expect(html).not.toMatch(/<img|undefined|NaN|Infinity/);

        expect(textOf(stats)).toContain("Open Issues — Debates Today 2");
        expect(textOf(io)).toContain(
            "ALGORA LIVE Input Signals —/today Output Issues — open sessions:— · agents:38");
        expect(textOf(io)).toContain(
            "AO LIVE Input Signals —/today Output Ideas — · Plans — debates:2 · agents:—");
        expect(textOf(io)).toContain(
            "BRIDGE LIVE Input — signals Output Issues 753 · Proofs — proposals:— · success:—");
    });

    it("reads CONNECTING on every card before the first verdict, and OFFLINE on one that did not answer after it", () => {
        // Before: no badge at all, on a card identical to one whose service
        // had gone — the missing badge was the whole difference.
        const NONE = { algora: false, ao: false, bridge: false };
        updateSidebar(bridgeWith({ algora: null, ao: null, bridge: null }, { up: NONE, conn: "connecting" }));
        let io = els["#serviceStatus"].innerHTML;
        expect(io.match(/live-badge wait">CONNECTING/g)).toHaveLength(3);
        expect(io).not.toContain("OFFLINE");
        expect(textOf(io)).toContain("9-stage pipeline");

        updateSidebar(bridgeWith(LIVE, { up: { algora: true, ao: false, bridge: true }, conn: "live" }));
        io = els["#serviceStatus"].innerHTML;
        expect(io).toContain('<div class="svc ao offline">');
        expect(textOf(io)).toContain("AO OFFLINE Input Signals — Output — no response this poll");
        expect(textOf(io)).toContain("ALGORA LIVE");
        expect(textOf(io)).toContain("BRIDGE LIVE");
        expect(io.match(/class="live-badge off"/g)).toHaveLength(1);
    });

    it("shows a dash, not the last stats that arrived, for a service live on its signals alone", () => {
        // `liveStats` keeps the last stats ever read. A service is LIVE on its
        // signals or its stats, so gating the figures on LIVE put hours-old
        // numbers beside the badge whenever only /stats was failing.
        const at = new Date(2026, 8, 21, 14, 31, 20).getTime();
        updateSidebar(bridgeWith(LIVE, {
            up: ALL, statsUp: { algora: false, ao: true, bridge: false },
            statsAt: { algora: at, ao: at, bridge: null },
        }));
        const stats = textOf(els["#stats"].innerHTML);
        const io = textOf(els["#serviceStatus"].innerHTML);
        expect(stats).toContain("Open Issues — Debates Today 2");
        expect(io).toContain(`ALGORA LIVE Input Signals — Output Issues — no stats this poll · last read ${clockTime(at)}`);
        expect(io).toContain("BRIDGE LIVE Input — Output — no stats answer yet");
        expect(io).not.toContain("835");
        expect(io).toContain("Ideas 4402 · Plans 80");
    });

    it("keeps every figure out of the markup unless it is a number", () => {
        // Every figure the panel shows, each one hostile — so no single sink can
        // go back to raw interpolation without this failing. The case above
        // leaves some fields valid on purpose; this one leaves none.
        const x = '<img src=x onerror="alert(1)">';
        updateSidebar(bridgeWith({
            algora: { activeAgents: x, totalAgents: x, activeSessions: x, signalsToday: x, openIssues: x },
            ao: { stats: { signals_today: x, debates_today: x, ideas_generated: x, plans_created: x, agents_active: x } },
            bridge: {
                signals: { total: x }, issues: { total: x },
                proposals: { total: x }, outcomes: { totalProofs: x, successRate: x },
            },
        }));

        const stats = els["#stats"].innerHTML;
        const io = els["#serviceStatus"].innerHTML;
        for (const html of [stats, io]) expect(html).not.toContain("<img");
        expect(textOf(stats)).toContain("Open Issues — Debates Today —");
        expect(textOf(io)).toContain("Signals —/today Output Issues — open sessions:— · agents:—");
        expect(textOf(io)).toContain("Ideas — · Plans — debates:— · agents:—");
        expect(textOf(io)).toContain("Input — signals Output Issues — · Proofs — proposals:— · success:—");
    });
});

/**
 * The scene refreshes every panel twice a second, and assigning innerHTML
 * replaces every node even when the string is the same. A figure selected in
 * Service I/O to be copied was gone within half a second.
 */
describe("panel rewrites", () => {
    let writes: Record<string, string[]>;

    beforeEach(() => {
        // Panels that record each innerHTML assignment, then a fresh init.
        writes = {};
        for (const sel of ["#stats", "#serviceStatus", "#connStatus", "#ecosystem"]) {
            let html = "";
            const log: string[] = (writes[sel] = []);
            els[sel] = {
                get innerHTML() { return html; },
                set innerHTML(v: string) { html = v; log.push(v); },
            } as El;
        }
        initSidebar();
    });

    const feed = { isLoaded: () => false, registryState: () => "loading", nodes: () => [] } as unknown as EcosystemFeed;

    it("leaves a panel alone when its markup has not changed", () => {
        for (let i = 0; i < 5; i++) { updateSidebar(bridgeWith(LIVE)); updateEcosystem(feed); }
        expect(Object.values(writes).map(w => w.length)).toEqual([1, 1, 1, 1]);

        // And rewrites it the moment something in it does.
        updateSidebar(bridgeWith({ ...LIVE, algora: { ...LIVE.algora, openIssues: 130 } }));
        expect(writes["#stats"]).toHaveLength(2);
        expect(writes["#serviceStatus"]).toHaveLength(2);
        expect(writes["#connStatus"]).toHaveLength(1);
    });

    it("shares the memo between both writers of the connection line", () => {
        // setConnectionStatus writes the line once, when init resolves. Had
        // it written around the memo, the next updateSidebar would find its
        // own last markup memoised, skip, and leave this one-off text up.
        updateSidebar(bridgeWith(LIVE));
        setConnectionStatus("live");
        expect(textOf(els["#connStatus"].innerHTML)).toBe("LIVE — Real-time service data");
        updateSidebar(bridgeWith(LIVE));
        expect(textOf(els["#connStatus"].innerHTML)).toBe("LIVE — queue: 3");
    });
});

describe("updateEcosystem", () => {
    const node = (id: string, health: HealthEntry | null, o: Partial<RegistryService> = {}, kind: EcosystemNode["kind"] = "service"): EcosystemNode => ({
        service: { id, name: id, url: `https://${id}.moss.land`, section: "ecosystem", tier: "labs", owner: "mossland", ...o } as RegistryService,
        health, instrumentation: health ? "health" : "listed", kind,
    });
    const CHECKED = new Date(2026, 8, 21, 14, 32, 5).getTime();
    const FRESH: HealthFreshness = { state: "fresh", checkedAt: CHECKED, sweeping: false, settled: true };
    const feedOf = (nodes: EcosystemNode[], freshness: HealthFreshness = FRESH, registry: RegistryState = "loaded") =>
        ({
            isLoaded: () => registry === "loaded", registryState: () => registry,
            nodes: () => nodes, healthFreshness: () => freshness,
        }) as unknown as EcosystemFeed;
    const eco = () => els["#ecosystem"].innerHTML;

    it("escapes every health field it puts in an attribute", () => {
        // The ingest already drops a latency that is not a number; this is the
        // second layer, for a value that reaches the renderer some other way.
        updateEcosystem(feedOf([
            node("npc", { service: "npc", status: "ok", latencyMs: '"><img src=x onerror=alert(1)>' as never }),
            node("wa", { service: "wa", status: '<b>"running"</b>' }),
        ]));

        const html = els["#ecosystem"].innerHTML;
        expect(html).not.toContain("<img");
        expect(html).not.toContain('<b>"running"');
        expect(html).toContain('title="ok · &quot;&gt;&lt;img src=x onerror=alert(1)&gt;ms"');
        // Off-contract stays untranslated, with its own dot.
        expect(html).toContain('class="eco-dot offcontract" title="&lt;b&gt;&quot;running&quot;&lt;/b&gt; — not one of ok/degraded/down"');
    });

    it("titles an ordinary reading with its status and latency", () => {
        updateEcosystem(feedOf([node("npc", { service: "npc", status: "ok", latencyMs: 21 })]));
        expect(els["#ecosystem"].innerHTML).toContain('class="eco-dot ok" title="ok · 21ms"');
    });

    it("tells a registry still loading from one that could not be read, and from one that was empty", () => {
        // A failed first read used to say "loading…" for the ten minutes until
        // the next attempt; it is retried within seconds, and says so.
        updateEcosystem(feedOf([], FRESH, "loading"));
        expect(textOf(eco())).toBe("Ecosystem Registry loading…");
        updateEcosystem(feedOf([], FRESH, "failed"));
        expect(textOf(eco())).toBe("Ecosystem Registry unreachable — retrying");
        updateEcosystem(feedOf([], FRESH, "loaded"));
        expect(textOf(eco())).toBe("Ecosystem Registry unavailable");
    });

    const ecosystem = [
        node("moss", { service: "moss", status: "ok" }, { name: "Mossland" }),
        node("npc", { service: "npc", status: "ok" }, { name: "NPC" }),
        node("signalmap", { service: "signalmap", status: "down", httpCode: 503 }, { name: "Signal Map" }),
        node("passport", { service: "passport", status: "degraded" }, { name: "Passport" }),
        node("algora", { service: "algora", status: "running" }, { name: "Algora", lifecycle: "archive" }),
        node("recipe", null, { name: "Recipe" }),
        // Not services: never counted, never chipped, whatever turned up.
        node("upbit", { service: "upbit", status: "down" }, { name: "Upbit", owner: "third-party" }, "link"),
        node("llms-txt", null, { name: "llms.txt", artifact: true }, "artifact"),
    ];

    it("counts what the services report, one bucket each, and names every reading that is not ok", () => {
        updateEcosystem(feedOf(ecosystem));
        const text = textOf(eco());
        expect(text).toContain(`Reported health checked ${clockTime(CHECKED)}`);
        // Off-contract is not ok and unmeasured is not down; the link and
        // the file are in no bucket at all.
        expect(text).toContain("2 ok · 1 off-contract · 1 degraded · 1 down · 1 unmeasured");
        expect(text).toContain("down: Signal Map · degraded: Passport · off-contract: Algora (archived)");
        expect(text).toContain("1 archived, counted by its reading like any other service");
    });

    it("puts the verdict in words on every row that is not ok", () => {
        updateEcosystem(feedOf(ecosystem));
        const html = eco();
        const rowOf = (name: string) => html.match(new RegExp(`<a [^>]*>(?:(?!</a>).)*${name}(?:(?!</a>).)*</a>`))?.[0] ?? "";
        // Hidden from screen readers only: they hear the verdict in the
        // row's reading (below), and would otherwise hear it twice.
        expect(rowOf("Signal Map")).toContain('<span class="eco-chip down" aria-hidden="true">down</span>');
        expect(rowOf("Passport")).toContain('<span class="eco-chip degraded" aria-hidden="true">degraded</span>');
        expect(rowOf("Algora")).toContain('<span class="eco-chip offcontract" aria-hidden="true">off-contract</span>');
        for (const quiet of ["Mossland", "Recipe", "Upbit", "llms.txt"]) expect(rowOf(quiet)).not.toContain("eco-chip");
    });

    it("puts every row's reading in its link's name, which is where the map sends a screen reader", () => {
        // A title on an empty span is not part of a link's name: a screen
        // reader heard "Signal Map beta" whatever the row said.
        updateEcosystem(feedOf([
            ...ecosystem,
            node("city", { service: "city", status: "ok", latencyMs: 51 }, { name: "City" }),
        ]));
        const html = eco();
        const heard = (name: string) =>
            html.match(new RegExp(`<span class="eco-name">${name}</span><span class="sr-only">([^<]*)</span>`))?.[1];
        expect(heard("City")).toBe(", health ok · 51ms,");
        expect(heard("Signal Map")).toBe(", health down,");
        // Off-contract is read as what it said, untranslated — never "ok".
        expect(heard("Algora")).toBe(", health running — not one of ok/degraded/down,");
        expect(heard("Recipe")).toBe(", not health-checked,");
        expect(heard("llms.txt")).toBe(", a published file, not a service,");
        expect(heard("Upbit")).toBe(", an external destination,");
        // The same words as the dot's title, which a pointer still gets.
        expect(html).toContain('class="eco-dot ok" title="ok · 51ms"');
    });

    it("says a reading is stale in the link's name, where the dimmed list says it only to the eye", () => {
        updateEcosystem(feedOf(
            [node("city", { service: "city", status: "ok", latencyMs: 51 }, { name: "City" }), node("recipe", null, { name: "Recipe" })],
            { state: "stale", checkedAt: CHECKED, sweeping: false, settled: true },
        ));
        expect(eco()).toContain('<span class="sr-only">, health ok · 51ms, stale,</span>');
        // No reading, nothing to be stale.
        expect(eco()).toContain('<span class="sr-only">, not health-checked,</span>');
    });

    it("escapes what it reads out as it escapes the title", () => {
        updateEcosystem(feedOf([node("wa", { service: "wa", status: '<b>"running"</b>' }, { name: "WA" })]));
        const html = eco();
        expect(html).not.toContain('<b>"running"');
        expect(html).toContain('<span class="sr-only">, health &lt;b&gt;&quot;running&quot;&lt;/b&gt; — not one of ok/degraded/down,</span>');
    });

    it("dates a stale tally instead of presenting it as current", () => {
        updateEcosystem(feedOf(ecosystem, { state: "stale", checkedAt: CHECKED, sweeping: false, settled: true }));
        const html = eco();
        expect(textOf(html)).toContain(`Reported health stale · as of ${shortClock(CHECKED)}`);
        expect(html).toContain('class="eco-health stale"');
        expect(html).toContain('class="eco-list stale"');
        // Kept: they are the last thing known.
        expect(textOf(html)).toContain("1 down");
    });

    it("has no tally while the first sweep is under way, and an all-unmeasured one if it found nothing", () => {
        updateEcosystem(feedOf(ecosystem.map(n => ({ ...n, health: null })), { state: "none", checkedAt: null, sweeping: true, settled: false }));
        expect(eco()).not.toContain("Reported health");
        updateEcosystem(feedOf(ecosystem.map(n => ({ ...n, health: null })), { state: "none", checkedAt: null, sweeping: false, settled: true }));
        expect(textOf(eco())).toContain("Reported health no health reading yet");
        expect(textOf(eco())).toContain("0 ok · 0 off-contract · 0 degraded · 0 down · 6 unmeasured");
    });

    it("keeps that result on screen through the sweeps after it", () => {
        // Every later sweep also reads "none" while it is out. The block used
        // to vanish for as long as each took — up to the 10 s timeout, once a
        // minute — which is the churn an always-shown tally exists to avoid.
        updateEcosystem(feedOf(ecosystem.map(n => ({ ...n, health: null })), { state: "none", checkedAt: null, sweeping: true, settled: true }));
        expect(textOf(eco())).toContain("Reported health checking health…");
        expect(textOf(eco())).toContain("0 ok · 0 off-contract · 0 degraded · 0 down · 6 unmeasured");
    });

    it("leads with what the services report, ahead of how much is instrumented", () => {
        // At tablet widths this panel is a 35vh strip over the map, whose
        // heading leaves the tally to it; after the count rows it was below
        // the fold.
        updateEcosystem(feedOf(ecosystem));
        const text = textOf(eco());
        expect(text.indexOf("Reported health")).toBeGreaterThan(text.indexOf("Ecosystem"));
        expect(text.indexOf("Reported health")).toBeLessThan(text.indexOf("Services"));
        expect(text.indexOf("down: Signal Map")).toBeLessThan(text.indexOf("Services"));
    });
});
