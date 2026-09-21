import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initSidebar, setConnectionStatus, updateEcosystem, updateSidebar } from "../src/ui/Sidebar.ts";
import type { DataBridge, LiveStats } from "../src/services/data-bridge.ts";
import type { EcosystemFeed, EcosystemNode } from "../src/services/ecosystem-feed.ts";
import type { HealthEntry, RegistryService } from "../src/services/types.ts";

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
        dispatchEvent() {},
    });
    initSidebar();
});

afterEach(() => { vi.unstubAllGlobals(); });

const textOf = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

const bridgeWith = (liveStats: unknown): DataBridge => ({
    liveStats: liveStats as LiveStats,
    serviceUp: { algora: true, ao: true, bridge: true },
    connectionState: () => "live",
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

    const feed = { isLoaded: () => false, nodes: () => [] } as unknown as EcosystemFeed;

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
    const node = (id: string, health: HealthEntry | null): EcosystemNode => ({
        service: { id, name: id, url: `https://${id}.moss.land`, section: "ecosystem", tier: "labs", owner: "mossland" } as RegistryService,
        health, instrumentation: health ? "health" : "listed", kind: "service",
    });
    const feedOf = (nodes: EcosystemNode[]) =>
        ({ isLoaded: () => true, nodes: () => nodes }) as unknown as EcosystemFeed;

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
});
