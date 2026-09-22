import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataBridge, MAX_SEEN_IDS_PER_ORIGIN } from "../src/services/data-bridge.ts";
import type { UnifiedSignal } from "../src/services/types.ts";

/** Rejects the way real fetch does: at once if already aborted, else on abort. */
function aborted(): DOMException {
    return new DOMException("Aborted", "AbortError");
}

function hangUntilAborted(signal?: AbortSignal): Promise<never> {
    return new Promise((_, reject) => {
        if (signal?.aborted) reject(aborted());
        else signal?.addEventListener("abort", () => reject(aborted()), { once: true });
    });
}

/** Answers after `ms` of (fake) time, unless the cycle is aborted first. */
function after(ms: number, signal: AbortSignal | undefined, make: () => Response): Promise<Response> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) { reject(aborted()); return; }
        const t = setTimeout(() => resolve(make()), ms);
        signal?.addEventListener("abort", () => { clearTimeout(t); reject(aborted()); }, { once: true });
    });
}

/** The requests reachability is read from: each service's signals and stats. */
const isStatusRequest = (url: string) => /\/signals\?|\/stats$|\/status$/.test(url);

const STATS: Record<string, unknown> = {
    "/algora-api/stats": { activeAgents: 8, totalAgents: 38, activeSessions: 1, signalsToday: 372, openIssues: 129 },
    "/ao-api/status": { status: "operational", stats: { signals_today: 449, debates_today: 2, ideas_generated: 4402, plans_created: 80, agents_active: 34 } },
    "/bridge-api/stats": { signals: { total: 835170 }, issues: { total: 753 }, proposals: { total: 21 }, outcomes: { totalProofs: 0, successRate: null } },
};

type Call = { url: string; at: number; signal?: AbortSignal };

describe("DataBridge signal identity", () => {
    let bridge: DataBridge;

    beforeEach(() => {
        vi.useFakeTimers();
        bridge = new DataBridge();
        vi.stubGlobal("fetch", vi.fn(async (url: string) => {
            // Independent services can use the same primary key. Repeating a
            // row within each response also exercises each origin's dedupe.
            const signal = {
                id: "shared-id", source: "github", category: "dev",
                description: "A signal", title: "A signal", summary: "A signal",
                metadata: "{}", timestamp: "2026-09-13T00:00:00Z",
                collected_at: "2026-09-13T00:00:00Z",
            };
            return Response.json(url.includes("/signals?") ? { signals: [signal, signal] } : {});
        }));
    });

    afterEach(() => {
        bridge.destroy();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it("ingests identical ids from different services once per origin", async () => {
        await bridge.init();

        expect(bridge.ingested).toEqual({ algora: 1, ao: 1, bridge: 1 });
        expect(bridge.queueSize()).toBe(3);
        const origins = Array.from({ length: 3 }, () => bridge.nextSignal()?.origin).sort();
        expect(origins).toEqual(["algora", "ao", "bridge"]);

        // Draining the animation queue must not replay the same signals at
        // the next refresh, even though their ids collide across services.
        await vi.advanceTimersByTimeAsync(15_000);
        expect(bridge.queueSize()).toBe(0);
        expect(bridge.ingested).toEqual({ algora: 1, ao: 1, bridge: 1 });
    });
});

/**
 * The connection state machine and the poll chain.
 *
 * These are what the LIVE / OFFLINE / Connecting line and the sidebar's
 * numbers stand on, and each assertion is a bug that has already shipped once:
 * a healthy board announcing OFFLINE on every load, OFFLINE for the whole
 * bulk-loading window, and polls stacking up behind a black-holed upstream.
 */
describe("DataBridge lifecycle", () => {
    let bridge: DataBridge;
    let calls: Call[];
    let t0: number;

    /** Status requests answer after `statusMs`; the bulk ones never do. */
    function serve(statusMs: number, answer: (url: string) => Response = defaultAnswer): void {
        vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
            const signal = init?.signal ?? undefined;
            calls.push({ url, at: Date.now() - t0, signal });
            return isStatusRequest(url) ? after(statusMs, signal, () => answer(url)) : hangUntilAborted(signal);
        }));
    }

    function defaultAnswer(url: string): Response {
        return url.includes("/signals?") ? Response.json({ signals: [] }) : Response.json(STATS[url] ?? {});
    }

    beforeEach(() => {
        vi.useFakeTimers();
        t0 = Date.now();
        calls = [];
        bridge = new DataBridge();
    });

    afterEach(() => {
        bridge.destroy();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it("reads `connecting` until signals and stats settle — not offline", async () => {
        serve(8_000);
        const init = bridge.init();

        expect(bridge.connectionState()).toBe("connecting");
        await vi.advanceTimersByTimeAsync(7_999);
        expect(bridge.connectionState()).toBe("connecting");

        await vi.advanceTimersByTimeAsync(1);
        expect(bridge.connectionState()).toBe("live");

        await vi.advanceTimersByTimeAsync(2_000);
        await expect(init).resolves.toBe("live");
    });

    it("publishes reachability while the bulk fetches are still loading", async () => {
        serve(1_000);
        void bridge.init();
        await vi.advanceTimersByTimeAsync(1_000);

        // Every bulk request is still hanging here; the badge must not wait.
        expect(calls.some(c => !isStatusRequest(c.url))).toBe(true);
        expect(bridge.connectionState()).toBe("live");
        expect(bridge.serviceUp).toEqual({ algora: true, ao: true, bridge: true });
        expect(bridge.liveStats.algora?.openIssues).toBe(129);
    });

    it.each<[string, (url: string) => Response, object, string]>([
        [
            "stats alone",
            url => url === "/ao-api/status" ? Response.json(STATS[url]) : new Response("", { status: 502 }),
            { algora: false, ao: true, bridge: false }, "live",
        ],
        [
            "signals alone",
            url => url.startsWith("/bridge-api/signals?") ? Response.json({ signals: [] }) : new Response("", { status: 502 }),
            { algora: false, ao: false, bridge: true }, "live",
        ],
        [
            "nothing",
            () => new Response("", { status: 502 }),
            { algora: false, ao: false, bridge: false }, "offline",
        ],
    ])("counts a service reachable from %s", async (_, answer, up, state) => {
        serve(0, answer);
        void bridge.init();
        await vi.advanceTimersByTimeAsync(0);

        expect(bridge.serviceUp).toEqual(up);
        expect(bridge.connectionState()).toBe(state);
    });

    it("chains polls 15 s after each cycle ends, with each cycle capped at 10 s", async () => {
        // Status takes 8 s and the bulk fetches never finish, so every cycle
        // runs into the 10 s cap: polls start at 0, 10+15 and 35+15. A fixed
        // 15 s interval would put the third at 40 s, and no cap at all would
        // never start a second.
        serve(8_000);
        void bridge.init();
        await vi.advanceTimersByTimeAsync(60_000);

        const starts = calls.filter(c => c.url.startsWith("/algora-api/signals?")).map(c => c.at);
        expect(starts).toEqual([0, 25_000, 50_000]);
    });

    it("shares one signal across the status requests, and destroy() there aborts it and schedules nothing", async () => {
        // Status is still outstanding at 1 s, so only the status requests
        // have been made; the bulk phase is the next case.
        serve(8_000);
        const init = bridge.init();
        await vi.advanceTimersByTimeAsync(1_000);

        const signals = new Set(calls.map(c => c.signal));
        expect(signals.size).toBe(1);

        bridge.destroy();
        await init;
        expect([...signals].every(s => s?.aborted)).toBe(true);
        expect(vi.getTimerCount()).toBe(0);

        const before = calls.length;
        await vi.advanceTimersByTimeAsync(60_000);
        expect(calls.length).toBe(before);
    });

    it("carries the cycle's signal into the bulk fetches, and destroy() there aborts them and schedules nothing", async () => {
        // Status settles at 1 s, so by 2 s the bulk requests are in flight
        // (and, as served, never finish on their own).
        serve(1_000);
        const init = bridge.init();
        await vi.advanceTimersByTimeAsync(2_000);

        const bulk = calls.filter(c => !isStatusRequest(c.url));
        expect(bulk.length).toBeGreaterThan(0);
        expect(new Set(calls.map(c => c.signal)).size).toBe(1);

        bridge.destroy();
        // Checked before awaiting init: a bulk request destroy() cannot abort
        // would keep init pending forever under fake timers.
        expect(bulk.every(c => c.signal?.aborted)).toBe(true);
        await init;
        expect(vi.getTimerCount()).toBe(0);

        const before = calls.length;
        await vi.advanceTimersByTimeAsync(60_000);
        expect(calls.length).toBe(before);
    });
});

type Origin = UnifiedSignal["origin"];
const SIGNALS_PATH: Record<Origin, string> = {
    algora: "/algora-api/signals?", ao: "/ao-api/signals?", bridge: "/bridge-api/signals?",
};
const originOf = (url: string) =>
    (Object.keys(SIGNALS_PATH) as Origin[]).find(o => url.startsWith(SIGNALS_PATH[o]));

/** Serves each origin's signal rows (or a failure, for `null`); everything else answers `{}`. */
function serveSignals(rows: (origin: Origin) => unknown[] | object | null): void {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
        const origin = originOf(url);
        if (!origin) return Response.json({});
        const body = rows(origin);
        if (body === null) return new Response("", { status: 502 });
        return Response.json(Array.isArray(body) ? { signals: body } : body);
    }));
}

function drain(bridge: DataBridge): UnifiedSignal[] {
    const out: UnifiedSignal[] = [];
    for (let s = bridge.nextSignal(); s; s = bridge.nextSignal()) out.push(s);
    return out;
}

/**
 * Signal rows are other services' data, converted one at a time. A row that
 * cannot be converted is that row's problem: it used to reject the whole poll,
 * dropping every origin's signals for the cycle, marking all three unreachable
 * in the signals half of the check, and leaving rows already marked seen
 * counted in `ingested` but never delivered.
 */
describe("DataBridge signal ingest", () => {
    let bridge: DataBridge;

    beforeEach(() => {
        vi.useFakeTimers();
        bridge = new DataBridge();
    });

    afterEach(() => {
        bridge.destroy();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it("skips only the row it cannot convert", async () => {
        serveSignals(origin => ({
            algora: [
                { id: "a-1", description: "kept, titled from its description", metadata: '{"title":"First"}' },
                // Upstream allows null metadata, and JSON.parse(null) *returns*
                // null — the property read after it is what used to throw.
                { id: "a-2", description: "null metadata", metadata: null },
                { id: "a-3", description: "metadata that parses to null", metadata: "null" },
                null,                                              // no row at all
                { description: "no id to key it on", metadata: "{}" },
                { id: "a-4", description: "after the bad ones", metadata: "{}" },
            ],
            ao: [{ id: "ao-1", title: "An AO signal", summary: "" }],
            bridge: [{ id: "b-1", description: "A Bridge signal", severity: "low" }],
        })[origin]);
        await bridge.init();

        const titles = drain(bridge).map(s => `${s.origin}:${s.id}:${s.title}`).sort();
        expect(titles).toEqual([
            "algora:a-1:First",
            "algora:a-2:null metadata",
            "algora:a-3:metadata that parses to null",
            "algora:a-4:after the bad ones",
            "ao:ao-1:An AO signal",
            "bridge:b-1:A Bridge signal",
        ]);
        // What the map counts is exactly what reached the belt.
        expect(bridge.ingested).toEqual({ algora: 4, ao: 1, bridge: 1 });
        expect(bridge.serviceUp).toEqual({ algora: true, ao: true, bridge: true });
    });

    // Every origin, not just the first one converted: a throw from a later
    // origin is the costly case, landing after earlier rows were marked seen
    // and counted but before anything reached the queue.
    it.each(["algora", "ao", "bridge"] as const)(
        "does not let %s's malformed list cost the others their signals", async bad => {
            serveSignals(origin => origin === bad
                ? { signals: { [`${origin}-1`]: "not a list" } }
                : [{ id: `${origin}-1`, title: "x", description: "x", summary: "x" }]);
            await bridge.init();

            const others = (["algora", "ao", "bridge"] as const).filter(o => o !== bad);
            expect(drain(bridge).map(s => s.origin).sort()).toEqual(others);
            // What the map counts is exactly what reached the belt.
            expect(bridge.ingested).toEqual({ algora: 1, ao: 1, bridge: 1, [bad]: 0 });
        });

    it("only ever hands the belt a severity it knows", async () => {
        // Severity is compared, not shown, so a stray value never threw — but
        // it did sit behind a union type that claimed otherwise. Anything
        // outside the four reads as a missing one does.
        serveSignals(origin => ({
            algora: [
                { id: "a-1", description: "x", metadata: "{}", severity: "high" },
                { id: "a-2", description: "x", metadata: "{}", severity: 7 },
                { id: "a-3", description: "x", metadata: "{}", severity: "bogus" },
                { id: "a-4", description: "x", metadata: "{}" },
            ],
            ao: [],
            bridge: [
                { id: "b-1", description: "x", severity: "low" },
                { id: "b-2", description: "x", severity: ["high"] },
            ],
        })[origin]);
        await bridge.init();

        const severities = Object.fromEntries(drain(bridge).map(s => [s.id, s.severity]));
        expect(severities).toEqual({
            "a-1": "high", "a-2": "medium", "a-3": "medium", "a-4": "medium",
            "b-1": "low", "b-2": "medium",
        });
    });

    it("only ever hands the belt a string title", async () => {
        // An RSS feed parsed from XML can deliver a `<title>` that carries
        // attributes as an object, {_, $}. `.slice` on that threw inside the
        // belt; "[object Object]" would be no better.
        serveSignals(origin => ({
            algora: [
                { id: "a-1", description: "falls back to this", metadata: JSON.stringify({ title: { _: "Title", $: { type: "html" } } }) },
                { id: "a-2", description: "and this", metadata: JSON.stringify({ title: "" }) },
                { id: "a-3", description: 42, metadata: JSON.stringify({ title: 7 }) },
            ],
            ao: [{ id: "ao-1", title: { en: "no" }, summary: "the summary instead" }],
            bridge: [{ id: "b-1", description: ["not", "text"] }],
        })[origin]);
        await bridge.init();

        const titles = Object.fromEntries(drain(bridge).map(s => [s.id, s.title]));
        expect(titles).toEqual({
            "a-1": "falls back to this", "a-2": "and this", "a-3": "",
            "ao-1": "the summary instead", "b-1": "",
        });
    });
});

/**
 * Dedupe memory against the upstreams' sliding latest-N windows.
 *
 * Every poll re-fetches each service's newest 30/20/20 signals, so the ids that
 * can come back are whatever those windows still hold. Memory has to remember
 * every id a window keeps returning — even one the belt has long since drained
 * — or the next poll re-counts it: more "signals ingested", a burst of motes
 * for nothing new, and old titles replayed on the belt.
 */
describe("DataBridge dedupe memory", () => {
    let bridge: DataBridge;
    let poll: number;
    let served: Record<Origin, Set<string>>;

    beforeEach(() => {
        vi.useFakeTimers();
        bridge = new DataBridge();
        poll = 0;
        served = { algora: new Set(), ao: new Set(), bridge: new Set() };
    });

    afterEach(() => {
        bridge.destroy();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    /** `perPoll` new ids per poll, newest first, `size` at a time. */
    const sliding = (prefix: string, size: number, perPoll: number) => (p: number) =>
        Array.from({ length: size }, (_, i) => `${prefix}-${p * perPoll + size - 1 - i}`);

    function upstream(windows: Record<Origin, (p: number) => string[] | null>): void {
        serveSignals(origin => {
            const ids = windows[origin](poll);
            if (!ids) return null;
            ids.forEach(id => served[origin].add(id));
            return ids.map(id => ({ id, title: id, summary: "", description: id, metadata: "{}" }));
        });
    }

    /** Runs `n` polls, draining the belt's queue after each, as the belt does. */
    async function runPolls(n: number): Promise<void> {
        await bridge.init();
        drain(bridge);
        for (poll = 1; poll < n; poll++) {
            await vi.advanceTimersByTimeAsync(15_000);
            drain(bridge);
        }
    }

    const counted = () => bridge.ingested;
    const unique = () => ({ algora: served.algora.size, ao: served.ao.size, bridge: served.bridge.size });

    it("counts each served id once, however long the tab stays open", async () => {
        // Enough polls to push the busiest origin well past its memory, twice.
        const polls = Math.ceil((2.5 * MAX_SEEN_IDS_PER_ORIGIN) / 4);
        const aoSlide = sliding("ao", 19, 2);
        upstream({
            bridge: sliding("b", 20, 4),
            // A source gone quiet: the same window, every poll. Its ids were the
            // first ever inserted, so evicting by first-seen order drops them.
            algora: () => Array.from({ length: 30 }, (_, i) => `a-${i}`),
            // One id the upstream keeps returning while the rest of its window
            // churns past the memory bound.
            ao: p => ["ao-pinned", ...aoSlide(p)],
        });
        await runPolls(polls);

        expect(unique().bridge).toBeGreaterThan(2 * MAX_SEEN_IDS_PER_ORIGIN);
        expect(unique().ao).toBeGreaterThan(MAX_SEEN_IDS_PER_ORIGIN);
        expect(counted()).toEqual(unique());
    });

    it("keeps a failing service's memory while the others churn", async () => {
        // Its window is not being refreshed while its requests fail, so it must
        // not be the others' growth that pushes it out. When it answers again
        // with the same signals, none of them is new.
        const polls = Math.ceil((2.5 * MAX_SEEN_IDS_PER_ORIGIN) / 4);
        const window = Array.from({ length: 30 }, (_, i) => `a-${i}`);
        upstream({
            algora: p => p === 0 || p === polls - 1 ? window : null,
            ao: () => [],
            bridge: sliding("b", 20, 4),
        });
        await runPolls(polls);

        expect(counted()).toEqual(unique());
        expect(counted().algora).toBe(30);
    });

    it("stays bounded: an id not served for longer than memory covers is new again", async () => {
        // The other side of the bound. Remembering everything forever would
        // grow without limit on a monitor that is meant to be left open.
        const polls = Math.ceil((2.5 * MAX_SEEN_IDS_PER_ORIGIN) / 4);
        const slide = sliding("b", 20, 4);
        upstream({
            algora: () => [], ao: () => [],
            bridge: p => p === polls - 1 ? ["b-0", ...slide(p)] : slide(p),
        });
        await runPolls(polls);

        expect(counted().bridge).toBe(unique().bridge + 1);    // b-0 twice
    });
});

describe("DataBridge poll chain", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it("keeps polling after a cycle throws", async () => {
        // Nothing in a cycle is meant to throw — every request settles on its
        // own — but if something ever does, it must cost that cycle, not the
        // chain: a tab left open would otherwise stop refreshing for good.
        vi.useFakeTimers();
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        serveSignals(() => []);
        const pollOnce = vi.spyOn(
            DataBridge.prototype as unknown as { pollOnce(signal: AbortSignal): Promise<void> }, "pollOnce",
        ).mockRejectedValueOnce(new Error("boom"));
        const bridge = new DataBridge();

        await expect(bridge.init()).resolves.toBe("connecting");
        expect(error).toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(1);

        await vi.advanceTimersByTimeAsync(15_000);
        expect(pollOnce).toHaveBeenCalledTimes(2);
        expect(bridge.connectionState()).toBe("live");
        bridge.destroy();
    });
});
