import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    DataBridge, MAX_SEEN_IDS_PER_ORIGIN, POLL_INTERVAL_MS, POLL_TIMEOUT_MS, DETAIL_INTERVAL_MS,
    DEBATE_INTERVAL_MS, DETAIL_RETRY_MS, DETAIL_TIMEOUT_MS, DEBATE_LIMIT,
} from "../src/services/data-bridge.ts";
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
        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
        expect(bridge.queueSize()).toBe(0);
        expect(bridge.ingested).toEqual({ algora: 1, ao: 1, bridge: 1 });
    });
});

/**
 * The connection state machine and the poll schedules.
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

    /** Status requests answer after `statusMs`, detail requests after
     *  `detailMs`; `null` never answers (until aborted). */
    function serve(statusMs: number | null, detailMs: number | null = null, answer: (url: string) => Response = defaultAnswer): void {
        vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
            const signal = init?.signal ?? undefined;
            calls.push({ url, at: Date.now() - t0, signal });
            const ms = isStatusRequest(url) ? statusMs : detailMs;
            return ms === null ? hangUntilAborted(signal) : after(ms, signal, () => answer(url));
        }));
    }

    function defaultAnswer(url: string): Response {
        return url.includes("/signals?") ? Response.json({ signals: [] }) : Response.json(STATS[url] ?? {});
    }

    const startsOf = (prefix: string) => calls.filter(c => c.url.startsWith(prefix)).map(c => c.at);

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

        // init() is the first full load, so it waits out the detail reads,
        // which here never answer and are cut off at their own timeout.
        await vi.advanceTimersByTimeAsync(DETAIL_TIMEOUT_MS);
        await expect(init).resolves.toBe("live");
    });

    it("publishes reachability while the detail reads are still loading", async () => {
        serve(1_000);
        void bridge.init();
        await vi.advanceTimersByTimeAsync(1_000);

        // Every detail request is still hanging here; the badge must not wait.
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
        serve(0, 0, answer);
        void bridge.init();
        await vi.advanceTimersByTimeAsync(0);

        expect(bridge.serviceUp).toEqual(up);
        expect(bridge.connectionState()).toBe(state);
    });

    it("chains reachability reads 15 s after each one ends, each capped at 10 s", async () => {
        // Status never answers, so every read runs into its 10 s cap: they
        // start at 0, 10+15 and 35+15. A fixed 15 s interval would put the
        // third at 30 s, and no cap at all would never start a second.
        serve(null, 0);
        void bridge.init();
        await vi.advanceTimersByTimeAsync(60_000);

        expect(startsOf("/algora-api/signals?")).toEqual([0, 25_000, 50_000]);
    });

    it("never lets a slow detail read hold up reachability, or a slow reachability read cut one short", async () => {
        // Detail reads take 20 s: twice the reachability cap, inside their
        // own. They used to share one 10 s budget with reachability, so a
        // slow link lost them every cycle — and held the next status read
        // back until they gave up.
        serve(1_000, 20_000, url => url.startsWith("/ao-api/ideas?")
            ? Response.json({ ideas: [{ id: "i-1", title: "An idea", score: 7.5 }], total: 4402 })
            : defaultAnswer(url));
        void bridge.init();
        await vi.advanceTimersByTimeAsync(60_000);

        expect(startsOf("/algora-api/signals?")).toEqual([0, 16_000, 32_000, 48_000]);
        expect(bridge.ideaCache.map(i => i.id)).toEqual(["i-1"]);

        // And the other way round: status hangs to its cap, detail reads land.
        bridge.destroy();
        bridge = new DataBridge();
        calls = [];
        t0 = Date.now();
        serve(null, 12_000, url => url.startsWith("/ao-api/projects?")
            ? Response.json({ projects: [{}], total: 5 }) : defaultAnswer(url));
        void bridge.init();
        await vi.advanceTimersByTimeAsync(POLL_TIMEOUT_MS + 12_000);
        expect(bridge.aoTotals().projects).toBe(5);
    });

    it("shares one signal across the status requests, and destroy() there aborts it and schedules nothing", async () => {
        // Status is still outstanding at 1 s, so only the status requests
        // have been made; the detail reads are the next case.
        serve(8_000);
        const init = bridge.init();
        await vi.advanceTimersByTimeAsync(1_000);

        expect(calls.every(c => isStatusRequest(c.url))).toBe(true);
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

    it("gives each detail read a signal of its own, and destroy() aborts every one and schedules nothing", async () => {
        // Status settles at 1 s, so by 2 s the detail reads are in flight
        // (and, as served, never finish on their own).
        serve(1_000);
        const init = bridge.init();
        await vi.advanceTimersByTimeAsync(2_000);

        const detail = calls.filter(c => !isStatusRequest(c.url));
        const statusSignal = calls.find(c => isStatusRequest(c.url))?.signal;
        expect(detail.length).toBeGreaterThan(0);
        expect(detail.some(c => c.signal === statusSignal)).toBe(false);
        // ideas, the project total, debates, and Bridge's outcomes + trust as one
        expect(new Set(detail.map(c => c.signal)).size).toBe(4);

        bridge.destroy();
        // Checked before awaiting init: a request destroy() cannot abort
        // would keep init pending forever under fake timers.
        expect(detail.every(c => c.signal?.aborted)).toBe(true);
        await init;
        expect(vi.getTimerCount()).toBe(0);

        const before = calls.length;
        await vi.advanceTimersByTimeAsync(60 * 60_000);
        expect(calls.length).toBe(before);
    });
});

/**
 * What is fetched, and how often. The detail reads used to ride the 15 s
 * reachability cycle, and were ~99% of its ~807 kB: ten full AO debates, AO's
 * plans (read only as a count), its ideas, and Algora's issues (read by
 * nothing, though mostly answered from the HTTP cache). Each assertion here is
 * a request a tab left open was making for nothing it showed.
 */
describe("DataBridge cadence", () => {
    let bridge: DataBridge;
    let calls: Call[];
    let t0: number;
    let fail: (url: string) => boolean;

    /** Answers every request at once — or, for `status`, after that long. */
    function serve(statusMs = 0): void {
        vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
            const signal = init?.signal ?? undefined;
            calls.push({ url, at: Date.now() - t0, signal });
            const answer = (): Response => {
                if (fail(url)) return new Response("", { status: 502 });
                if (url.includes("/signals?")) return Response.json({ signals: [] });
                if (url.startsWith("/ao-api/debates?")) return Response.json({ debates: [{ id: "d-1", topic: "A debate", context: "Some context" }] });
                if (url.startsWith("/ao-api/ideas?")) return Response.json({ ideas: [], total: 4402 });
                if (url.startsWith("/ao-api/projects?")) return Response.json({ projects: [{}], total: 5 });
                // Bridge's detail lists, empty as they are live: an answer
                // without its list is a failed read, and would be retried.
                if (url.startsWith("/bridge-api/outcomes")) return Response.json({ outcomes: [], count: 0 });
                if (url.startsWith("/bridge-api/trust/")) return Response.json({ leaderboard: [] });
                return Response.json(STATS[url] ?? {});
            };
            return isStatusRequest(url) && statusMs > 0 ? after(statusMs, signal, answer) : Promise.resolve(answer());
        }));
    }

    beforeEach(() => {
        vi.useFakeTimers();
        t0 = Date.now();
        calls = [];
        fail = () => false;
        bridge = new DataBridge();
        serve();
    });

    afterEach(() => {
        bridge.destroy();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    const startsOf = (prefix: string) => calls.filter(c => c.url.startsWith(prefix)).map(c => c.at / 1000);
    const paths = () => new Set(calls.map(c => c.url));

    it("runs each read on its own cadence, and never fetches the issue or plan lists", async () => {
        await bridge.init();
        await vi.advanceTimersByTimeAsync(21 * 60_000);

        const every = (ms: number) => Array.from({ length: Math.floor(21 * 60_000 / ms) + 1 }, (_, i) => i * ms / 1000);
        for (const p of ["/algora-api/signals?", "/ao-api/status", "/bridge-api/stats"]) {
            expect(startsOf(p)).toEqual(every(POLL_INTERVAL_MS));
        }
        for (const p of ["/ao-api/ideas?", "/ao-api/projects?", "/bridge-api/outcomes", "/bridge-api/trust/"]) {
            expect(startsOf(p)).toEqual(every(DETAIL_INTERVAL_MS));
        }
        expect(startsOf("/ao-api/debates?")).toEqual(every(DEBATE_INTERVAL_MS));

        // README.md / README.ko.md state these.
        expect([POLL_INTERVAL_MS, DETAIL_INTERVAL_MS, DEBATE_INTERVAL_MS]).toEqual([15_000, 5 * 60_000, 10 * 60_000]);
        expect([POLL_TIMEOUT_MS, DETAIL_TIMEOUT_MS, DETAIL_RETRY_MS]).toEqual([10_000, 30_000, 60_000]);
        expect([...paths()].filter(u => /\/issues|\/plans/.test(u))).toEqual([]);
        // Only what is shown: three debates to rotate through, one project row
        // (AO refuses zero) for its envelope's total.
        expect(DEBATE_LIMIT).toBe(3);
        expect(paths()).toContain(`/ao-api/debates?limit=${DEBATE_LIMIT}`);
        expect(paths()).toContain("/ao-api/projects?limit=1");
    });

    it("retries a failed detail read after a minute, and waits its full interval once it succeeds", async () => {
        let debateTries = 0;
        fail = url => url.startsWith("/ao-api/debates?") && ++debateTries <= 2;
        await bridge.init();
        expect(bridge.debatesErrored).toBe(true);
        expect(bridge.getRandomDebate()).toBeNull();

        await vi.advanceTimersByTimeAsync(2 * DETAIL_RETRY_MS);
        expect(bridge.debatesErrored).toBe(false);
        expect(bridge.getRandomDebate()).toEqual({ topic: "A debate", snippet: "Some context" });

        await vi.advanceTimersByTimeAsync(DEBATE_INTERVAL_MS);
        expect(startsOf("/ao-api/debates?")).toEqual([0, 60, 120, 120 + DEBATE_INTERVAL_MS / 1000]);
        // A read that succeeded is not dragged along by one that failed.
        expect(startsOf("/ao-api/ideas?")).toEqual([0, 300, 600]);

        // A later failure keeps what the last success brought.
        fail = url => url.startsWith("/ao-api/debates?");
        await vi.advanceTimersByTimeAsync(DEBATE_INTERVAL_MS);
        expect(bridge.debatesErrored).toBe(true);
        expect(bridge.getRandomDebate()?.topic).toBe("A debate");
    });

    it("treats a 200 answer without its list as a failed read, not an empty one", async () => {
        // An upstream bug, a proxy fault or a renamed field can answer 200
        // with no list in it. Read as an empty list, that emptied a good
        // cache, counted as a success, and so held an empty panel — the card
        // saying it was still loading — for the whole 5 or 10 minutes.
        vi.stubGlobal("fetch", vi.fn(async (url: string) => {
            calls.push({ url, at: Date.now() - t0 });
            if (url.includes("/signals?")) return Response.json({ signals: [] });
            if (url.startsWith("/ao-api/debates?")) return Response.json({ debates: [{ id: "d-1", topic: "A debate", context: "Some context" }] });
            if (url.startsWith("/ao-api/ideas?")) return Response.json({ ideas: [{ id: "i-1", title: "An idea", score: 7.5 }], total: 99 });
            if (url.startsWith("/bridge-api/outcomes")) return Response.json({ outcomes: [{ id: "o-1" }], count: 1 });
            if (url.startsWith("/bridge-api/trust/")) return Response.json({ leaderboard: [{ entityId: "a-1", entityType: "agent", score: 0.9 }] });
            if (url.startsWith("/ao-api/projects?")) return Response.json({ projects: [{}], total: 5 });
            // No `stats`, so the funnel's Ideas figure is the ideas envelope's.
            if (url === "/ao-api/status") return Response.json({ status: "operational" });
            return Response.json(STATS[url] ?? {});
        }));
        await bridge.init();
        expect(bridge.aoTotals().ideas).toBe(99);

        calls = [];
        t0 = Date.now();
        vi.stubGlobal("fetch", vi.fn(async (url: string) => {
            calls.push({ url, at: Date.now() - t0 });
            if (url.includes("/signals?")) return Response.json({ signals: [] });
            if (/^\/(ao-api\/(debates|ideas)|bridge-api\/(outcomes|trust))/.test(url)) return Response.json({ detail: "db unavailable" });
            if (url.startsWith("/ao-api/projects?")) return Response.json({ projects: [{}], total: 5 });
            if (url === "/ao-api/status") return Response.json({ status: "operational" });
            return Response.json(STATS[url] ?? {});
        }));
        await vi.advanceTimersByTimeAsync(DEBATE_INTERVAL_MS);

        // Every cache keeps the last real answer, and the card says the read
        // failed rather than that it is still loading.
        expect(bridge.getRandomDebate()?.topic).toBe("A debate");
        expect(bridge.debatesErrored).toBe(true);
        expect(bridge.ideaCache.map(i => i.id)).toEqual(["i-1"]);
        expect(bridge.aoTotals().ideas).toBe(99);
        expect(bridge.outcomeCache).toHaveLength(1);
        expect(bridge.trustCache).toHaveLength(1);
        // And each is retried on the failure cadence, not left for an interval.
        expect(startsOf("/ao-api/ideas?")).toEqual([300, 360, 420, 480, 540, 600]);
        expect(startsOf("/ao-api/debates?")).toEqual([600]);
        await vi.advanceTimersByTimeAsync(DETAIL_RETRY_MS);
        expect(startsOf("/ao-api/debates?")).toEqual([600, 660]);
        // A read that did succeed is not dragged onto the retry cadence.
        expect(startsOf("/ao-api/projects?")).toEqual([300, 600]);
    });

    it("pauses every schedule while hidden, and on resume runs at once whatever fell due", async () => {
        await bridge.init();
        await vi.advanceTimersByTimeAsync(20_000);          // status also ran at 15 s
        bridge.pause();
        const before = calls.length;
        await vi.advanceTimersByTimeAsync(30 * 60_000);
        expect(calls.length).toBe(before);
        expect(vi.getTimerCount()).toBe(0);

        bridge.resume();
        await vi.advanceTimersByTimeAsync(0);
        const resumed = calls.slice(before).map(c => c.url.replace(/\?.*/, ""));
        expect([...resumed].sort()).toEqual([
            "/algora-api/signals", "/algora-api/stats", "/ao-api/debates", "/ao-api/ideas",
            "/ao-api/projects", "/ao-api/signals", "/ao-api/status", "/bridge-api/outcomes",
            "/bridge-api/signals", "/bridge-api/stats", "/bridge-api/trust/leaderboard/agent",
        ]);
    });

    it("on resume, waits out the remaining time of a read that had not fallen due", async () => {
        await bridge.init();
        await vi.advanceTimersByTimeAsync(5_000);
        bridge.pause();
        await vi.advanceTimersByTimeAsync(5_000);
        bridge.resume();                                    // 10 s in: status due at 15 s
        await vi.advanceTimersByTimeAsync(4_999);
        expect(startsOf("/ao-api/status")).toEqual([0]);
        await vi.advanceTimersByTimeAsync(1);
        expect(startsOf("/ao-api/status")).toEqual([0, 15]);
        await vi.advanceTimersByTimeAsync(DETAIL_INTERVAL_MS - 15_000);
        expect(startsOf("/ao-api/ideas?")).toEqual([0, 300]);
    });

    it("keeps a single chain when the tab is hidden and shown during a read", async () => {
        // Reachability takes 4 s here, so reads start every 19 s. The hide and
        // show land inside the second read. Resuming by starting a poll of its
        // own would leave the old read re-arming beside it: from then on two
        // chains, double the traffic, and the older answer able to land last.
        serve(4_000);
        void bridge.init();
        await vi.advanceTimersByTimeAsync(20_000);
        bridge.pause();
        await vi.advanceTimersByTimeAsync(1_000);
        bridge.resume();
        await vi.advanceTimersByTimeAsync(100_000 - 21_000);

        expect(startsOf("/ao-api/status")).toEqual([0, 19, 38, 57, 76, 95]);
    });

    it("runs its first load in a tab hidden from the start, then waits to be shown", async () => {
        // The scene pauses straight after init() when the page opens hidden.
        const init = bridge.init();
        bridge.pause();
        await init;
        const loaded = calls.length;
        expect(loaded).toBe(11);
        await vi.advanceTimersByTimeAsync(60 * 60_000);
        expect(calls.length).toBe(loaded);

        bridge.resume();
        await vi.advanceTimersByTimeAsync(0);
        expect(calls.length).toBe(2 * loaded);
    });

    it("does nothing on resume() after destroy()", async () => {
        await bridge.init();
        bridge.pause();
        bridge.destroy();
        bridge.resume();
        const before = calls.length;
        await vi.advanceTimersByTimeAsync(60 * 60_000);
        expect(calls.length).toBe(before);
        expect(vi.getTimerCount()).toBe(0);
    });
});

/**
 * The detail views' figures. The rule is the sidebar's: a service's own total,
 * or nothing — never the length of a list we fetched, which is our fetch size.
 * The AO funnel used to print a 20-item page's length as Projects, and when
 * /ao-api/status answered without `stats`, the 30/20 fetch caps as Ideas and
 * Plans; Bridge's gauges printed a missing total as 0.
 */
describe("DataBridge totals", () => {
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

    /** Answers each prefix with its body (`null`: a 502); the rest with `{}`. */
    function serveBodies(bodies: Record<string, unknown>): void {
        vi.stubGlobal("fetch", vi.fn(async (url: string) => {
            const key = Object.keys(bodies).find(k => url.startsWith(k));
            if (key) return bodies[key] === null ? new Response("", { status: 502 }) : Response.json(bodies[key]);
            return Response.json(url.includes("/signals?") ? { signals: [] } : {});
        }));
    }

    const thirtyIdeas = Array.from({ length: 30 }, (_, i) => ({ id: `i-${i}`, title: `Idea ${i}`, score: 7 }));

    it("shows AO's own totals, not the lengths of the lists behind them", async () => {
        serveBodies({
            "/ao-api/status": STATS["/ao-api/status"],
            "/ao-api/ideas?": { ideas: thirtyIdeas, total: 4402 },
            "/ao-api/projects?": { projects: [{ id: "p-1" }], total: 25 },
        });
        await bridge.init();

        expect(bridge.aoTotals()).toEqual({ ideas: 4402, plans: 80, projects: 25 });
        expect(bridge.ideaCache).toHaveLength(30);          // the belt still gets its bubbles
    });

    it("falls back to AO's own ideas count when the status body has no stats, and to nothing otherwise", async () => {
        serveBodies({
            "/ao-api/status": { status: "degraded" },
            "/ao-api/ideas?": { ideas: thirtyIdeas, total: 4402 },
            "/ao-api/projects?": { projects: [{ id: "p-1" }] },
        });
        await bridge.init();

        // Not 30, the fetch size; and no Plans figure rather than a page
        // length, since the plan list is no longer fetched at all.
        expect(bridge.aoTotals()).toEqual({ ideas: 4402, plans: null, projects: null });
    });

    it("has no figure before an answer, for one that is not a number, or for a read that failed", async () => {
        expect(bridge.aoTotals()).toEqual({ ideas: null, plans: null, projects: null });
        expect(bridge.bridgeTotals()).toEqual({ proposals: null, successRate: null, signals: null, issues: null });

        serveBodies({
            "/ao-api/status": { stats: { ideas_generated: "4402", plans_created: Number.NaN } },
            "/ao-api/ideas?": { ideas: thirtyIdeas, total: "4402" },
            "/ao-api/projects?": null,
            "/bridge-api/stats": { signals: { total: "835170" }, issues: {}, proposals: { total: null }, outcomes: { successRate: null } },
        });
        await bridge.init();

        expect(bridge.aoTotals()).toEqual({ ideas: null, plans: null, projects: null });
        expect(bridge.bridgeTotals()).toEqual({ proposals: null, successRate: null, signals: null, issues: null });
    });

    it("reads Bridge's totals from its stats", async () => {
        serveBodies({ "/bridge-api/stats": STATS["/bridge-api/stats"] });
        await bridge.init();
        // successRate stays null — no proof yet — rather than reading as 0%.
        expect(bridge.bridgeTotals()).toEqual({ proposals: 21, successRate: null, signals: 835170, issues: 753 });
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
            await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
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
        const pollStatus = vi.spyOn(
            DataBridge.prototype as unknown as { pollStatus(): Promise<void> }, "pollStatus",
        ).mockRejectedValueOnce(new Error("boom"));
        const bridge = new DataBridge();

        await expect(bridge.init()).resolves.toBe("connecting");
        expect(error).toHaveBeenCalled();
        // Reachability and the four detail reads, each armed.
        expect(vi.getTimerCount()).toBe(5);

        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
        expect(pollStatus).toHaveBeenCalledTimes(2);
        expect(bridge.connectionState()).toBe("live");
        bridge.destroy();
    });
});
