import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EcosystemFeed, REGISTRY_INTERVAL_MS, STALE_AFTER_MS } from "../src/services/ecosystem-feed.ts";
import { fetchRegistry, fetchEcosystemHealth, fetchServiceHealth } from "../src/services/ecosystem-client.ts";
import type { RegistryService } from "../src/services/types.ts";

vi.mock("../src/services/ecosystem-client.ts", () => ({
    fetchRegistry: vi.fn(),
    fetchEcosystemHealth: vi.fn(),
    fetchServiceHealth: vi.fn(),
    HEALTH_URL: "https://city.moss.land/api/health",
    AGGREGATOR_ID: "city",
}));

describe("EcosystemFeed teardown", () => {
    let feed: EcosystemFeed;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.resetAllMocks();
        feed = new EcosystemFeed();
        vi.mocked(fetchRegistry).mockResolvedValue([]);
        vi.mocked(fetchEcosystemHealth).mockResolvedValue({ aggregate: null, own: null });
    });

    afterEach(() => {
        feed.destroy();
        vi.useRealTimers();
    });

    it("aborts registry and health requests when their independent schedules overlap", async () => {
        await feed.init();
        await vi.advanceTimersByTimeAsync(9 * 60_000);

        const pendingSignals: AbortSignal[] = [];
        const untilAborted = (signal?: AbortSignal) => new Promise<never>((_, reject) => {
            pendingSignals.push(signal!);
            signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        });
        vi.mocked(fetchRegistry).mockImplementation(untilAborted);
        vi.mocked(fetchEcosystemHealth).mockImplementation(untilAborted);

        // The ten-minute registry timer and the minute-by-minute health timer
        // now start in the same window; each owns a different controller.
        await vi.advanceTimersByTimeAsync(60_000);
        expect(pendingSignals).toHaveLength(2);
        feed.destroy();
        expect(pendingSignals.every(signal => signal.aborted)).toBe(true);

        const registryCalls = vi.mocked(fetchRegistry).mock.calls.length;
        const healthCalls = vi.mocked(fetchEcosystemHealth).mock.calls.length;
        await vi.advanceTimersByTimeAsync(10 * 60_000);
        expect(fetchRegistry).toHaveBeenCalledTimes(registryCalls);
        expect(fetchEcosystemHealth).toHaveBeenCalledTimes(healthCalls);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("does not start health polling or install timers after teardown during initialization", async () => {
        let requestSignal: AbortSignal | undefined;
        vi.mocked(fetchRegistry).mockImplementation(signal => new Promise((_, reject) => {
            requestSignal = signal;
            signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        }));
        const initialization = feed.init();
        feed.destroy();
        await initialization;

        expect(requestSignal?.aborted).toBe(true);
        expect(fetchEcosystemHealth).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it("keeps both schedules armed when a sweep throws, including the first", async () => {
        // The real client drops malformed entries before the feed sees them;
        // this one does not, so the merge throws. That stands in for any throw
        // inside a poll: it must cost that sweep, never the polling chain.
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        vi.mocked(fetchEcosystemHealth).mockResolvedValue({
            aggregate: { services: [null as never] }, own: null,
        });

        await expect(feed.init()).resolves.toBeUndefined();
        expect(vi.getTimerCount()).toBe(2);             // registry + health
        expect(error).toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(60_000);
        expect(fetchEcosystemHealth).toHaveBeenCalledTimes(2);
        expect(vi.getTimerCount()).toBe(2);

        // And once the answers are sane again, the sweep lands as usual.
        vi.mocked(fetchEcosystemHealth).mockResolvedValue({
            aggregate: { services: [{ service: "npc", status: "ok" }] }, own: null,
        });
        vi.mocked(fetchRegistry).mockResolvedValue([
            { id: "npc", name: "npc", owner: "mossland", tier: "showcase" } as never,
        ]);
        await vi.advanceTimersByTimeAsync(9 * 60_000);
        expect(feed.nodes().map(n => [n.service.id, n.health?.status])).toEqual([["npc", "ok"]]);
        error.mockRestore();
    });
});

/**
 * A hidden tab. The scene pauses the feed on `visibilitychange`; before that,
 * a background tab kept sweeping every service's health endpoint once a minute
 * for a map nobody could see.
 */
describe("EcosystemFeed while hidden", () => {
    let feed: EcosystemFeed;
    const calls = () => [vi.mocked(fetchRegistry).mock.calls.length, vi.mocked(fetchEcosystemHealth).mock.calls.length];

    beforeEach(() => {
        vi.useFakeTimers();
        vi.resetAllMocks();
        feed = new EcosystemFeed();
        vi.mocked(fetchRegistry).mockResolvedValue([]);
        vi.mocked(fetchEcosystemHealth).mockResolvedValue({ aggregate: null, own: null });
    });

    afterEach(() => {
        feed.destroy();
        vi.useRealTimers();
    });

    it("polls nothing while paused, and on resume runs at once whatever fell due", async () => {
        await feed.init();
        feed.pause();
        await vi.advanceTimersByTimeAsync(30 * 60_000);
        expect(calls()).toEqual([1, 1]);
        expect(vi.getTimerCount()).toBe(0);

        feed.resume();
        await vi.advanceTimersByTimeAsync(0);
        expect(calls()).toEqual([2, 2]);             // both were overdue
        expect(vi.getTimerCount()).toBe(2);           // and each is armed again, once
    });

    it("on resume, waits out the time a schedule had left", async () => {
        await feed.init();
        await vi.advanceTimersByTimeAsync(30_000);
        feed.pause();
        await vi.advanceTimersByTimeAsync(10_000);
        feed.resume();                                // 40 s in: the sweep is due at 60 s
        await vi.advanceTimersByTimeAsync(19_999);
        expect(calls()).toEqual([1, 1]);
        await vi.advanceTimersByTimeAsync(1);
        expect(calls()).toEqual([1, 2]);
    });

    it("never sends the first sweep ahead of the registry, however the tab flips during init", async () => {
        // The sweep reads its targets from the registry. A resume() that
        // started it on its own would sweep an empty list and leave the map
        // claiming nothing is measured until the next minute.
        let answer!: (services: never[]) => void;
        vi.mocked(fetchRegistry).mockImplementationOnce(() => new Promise(r => { answer = r; }));
        const init = feed.init();
        feed.pause();
        feed.resume();
        feed.resume();
        await vi.advanceTimersByTimeAsync(5 * 60_000);
        expect(fetchEcosystemHealth).not.toHaveBeenCalled();

        answer([]);
        await init;
        expect(calls()).toEqual([1, 1]);
        expect(vi.getTimerCount()).toBe(2);
    });
});

const NPC = { id: "npc", name: "NPC", owner: "mossland", tier: "showcase", statusUrl: "https://npc.moss.land/api/health" } as RegistryService;
const offline = () => Promise.reject(new TypeError("Failed to fetch"));
/** Answers after `ms` of fake time. */
const later = <T>(ms: number, value: T) => new Promise<T>(r => setTimeout(() => r(value), ms));

/**
 * A registry read that fails before the registry has ever loaded. It used to be
 * retried only on the ten-minute refresh, so one failed request at page load
 * left the default view an empty galaxy for ten minutes — labelled "loading",
 * although nothing was.
 */
describe("EcosystemFeed registry retry", () => {
    let feed: EcosystemFeed;
    let t0: number;
    let registryAt: number[];

    beforeEach(() => {
        vi.useFakeTimers();
        vi.resetAllMocks();
        t0 = Date.now();
        registryAt = [];
        feed = new EcosystemFeed();
        vi.mocked(fetchRegistry).mockImplementation(() => { registryAt.push(Date.now() - t0); return offline(); });
        vi.mocked(fetchEcosystemHealth).mockResolvedValue({ aggregate: null, own: null });
        vi.mocked(fetchServiceHealth).mockResolvedValue({ service: "npc", status: "ok" });
    });

    afterEach(() => {
        feed.destroy();
        vi.useRealTimers();
    });

    it("says it failed rather than loading, and retries after 5 s, 15 s, 30 s, then every minute", async () => {
        const init = feed.init();
        expect(feed.registryState()).toBe("loading");
        await init;
        expect(feed.registryState()).toBe("failed");
        expect(feed.isLoaded()).toBe(false);

        await vi.advanceTimersByTimeAsync(3 * 60_000);
        expect(registryAt).toEqual([0, 5_000, 20_000, 50_000, 110_000, 170_000]);
        expect(feed.registryState()).toBe("failed");
    });

    it("sweeps the new targets at once when a retry loads, then keeps the ten-minute cadence", async () => {
        await feed.init();
        expect(fetchServiceHealth).not.toHaveBeenCalled();     // the first sweep had no targets

        vi.mocked(fetchRegistry).mockImplementation(async () => { registryAt.push(Date.now() - t0); return [NPC]; });
        await vi.advanceTimersByTimeAsync(5_000);
        expect(feed.registryState()).toBe("loaded");
        // Not at the next minute's tick: straight after the registry landed.
        expect(fetchServiceHealth).toHaveBeenCalledTimes(1);
        expect(feed.nodes().map(n => [n.service.id, n.health?.status])).toEqual([["npc", "ok"]]);

        // A refresh that fails after that keeps the snapshot and waits the full
        // interval: the early retry is only for a map with nothing on it.
        vi.mocked(fetchRegistry).mockImplementation(() => { registryAt.push(Date.now() - t0); return offline(); });
        await vi.advanceTimersByTimeAsync(2 * REGISTRY_INTERVAL_MS);
        expect(registryAt).toEqual([0, 5_000, 5_000 + REGISTRY_INTERVAL_MS, 5_000 + 2 * REGISTRY_INTERVAL_MS]);
        expect(feed.registryState()).toBe("loaded");
        expect(feed.nodes()).toHaveLength(1);
    });

    it("waits for a sweep already out against the empty list, then sweeps again", async () => {
        // The first sweep is slow, so the 5 s retry lands while it is still
        // out. That sweep read its (empty) targets when it started.
        vi.mocked(fetchEcosystemHealth).mockImplementationOnce(() => later(8_000, { aggregate: null, own: null }));
        const init = feed.init();
        vi.mocked(fetchRegistry).mockImplementation(async () => [NPC]);
        await vi.advanceTimersByTimeAsync(5_000);
        expect(feed.registryState()).toBe("loaded");
        expect(fetchServiceHealth).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(3_000);
        await init;
        expect(fetchEcosystemHealth).toHaveBeenCalledTimes(2);
        expect(fetchServiceHealth).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(2);                    // one of each chain, no more
    });

    it("does not count init()'s sweep against the empty list as the registry's first", async () => {
        // That sweep could only ask city's aggregate. Counted as settled, the
        // map and sidebar would show "all unmeasured" for as long as the first
        // sweep that does ask the registry's services took.
        await feed.init();
        expect(feed.healthFreshness()).toMatchObject({ state: "none", sweeping: false, settled: false });

        vi.mocked(fetchRegistry).mockImplementation(async () => [NPC]);
        vi.mocked(fetchServiceHealth).mockImplementation(() => later(3_000, { service: "npc", status: "ok" }));
        await vi.advanceTimersByTimeAsync(5_000);
        expect(feed.registryState()).toBe("loaded");
        expect(feed.healthFreshness()).toEqual({ state: "none", checkedAt: null, sweeping: true, settled: false });

        await vi.advanceTimersByTimeAsync(3_000);
        expect(feed.healthFreshness()).toMatchObject({ state: "fresh", sweeping: false, settled: true });
    });

    it("leaves nothing scheduled after teardown during the backoff", async () => {
        await feed.init();
        await vi.advanceTimersByTimeAsync(6_000);
        feed.destroy();
        expect(vi.getTimerCount()).toBe(0);
        const calls = vi.mocked(fetchRegistry).mock.calls.length;
        await vi.advanceTimersByTimeAsync(10 * 60_000);
        expect(fetchRegistry).toHaveBeenCalledTimes(calls);
    });
});

/**
 * A reading that no sweep has been able to refresh. A sweep in which every
 * request failed — the viewer's own network gone — keeps the previous
 * snapshot, and nothing used to say how old it was: twelve green, breathing
 * bodies for as long as the outage lasted.
 */
describe("EcosystemFeed health freshness", () => {
    let feed: EcosystemFeed;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.resetAllMocks();
        feed = new EcosystemFeed();
        vi.mocked(fetchRegistry).mockResolvedValue([NPC]);
        vi.mocked(fetchEcosystemHealth).mockResolvedValue({ aggregate: null, own: null });
        vi.mocked(fetchServiceHealth).mockResolvedValue({ service: "npc", status: "ok" });
    });

    afterEach(() => {
        feed.destroy();
        vi.useRealTimers();
    });

    const goOffline = () => {
        vi.mocked(fetchServiceHealth).mockImplementation(offline);
        vi.mocked(fetchEcosystemHealth).mockImplementation(offline);
    };
    const state = () => feed.healthFreshness().state;

    it("has no reading before the first sweep lands", async () => {
        expect(feed.healthFreshness()).toEqual({ state: "none", checkedAt: null, sweeping: false, settled: false });
        await feed.init();
        expect(state()).toBe("fresh");
    });

    it("tells the sweeps after a first one that got nothing from the first", async () => {
        // Every one of them reads "none" while it is out, exactly as the first
        // did; without `settled` the tally vanished for the length of each.
        goOffline();
        await feed.init();
        expect(feed.healthFreshness()).toEqual({ state: "none", checkedAt: null, sweeping: false, settled: true });

        vi.mocked(fetchEcosystemHealth).mockImplementation(() => later(5_000, null as never).then(offline));
        await vi.advanceTimersByTimeAsync(61_000);
        expect(feed.healthFreshness()).toEqual({ state: "none", checkedAt: null, sweeping: true, settled: true });
    });

    it("turns stale while paused once the reading ages past STALE_AFTER_MS", async () => {
        // What a hidden tab's title reads, on a timer of its own: no sweep
        // runs while paused, so nothing is replacing the reading it holds.
        await feed.init();
        feed.pause();
        await vi.advanceTimersByTimeAsync(STALE_AFTER_MS);
        expect(feed.healthFreshness()).toMatchObject({ state: "fresh", sweeping: false });
        await vi.advanceTimersByTimeAsync(1);
        expect(feed.healthFreshness()).toMatchObject({ state: "stale", sweeping: false });
        expect(fetchEcosystemHealth).toHaveBeenCalledTimes(1);
    });

    it("turns stale once no sweep has landed for STALE_AFTER_MS, keeps the snapshot, and recovers", async () => {
        await feed.init();
        const checkedAt = feed.healthCheckedAt;
        goOffline();

        await vi.advanceTimersByTimeAsync(STALE_AFTER_MS);
        expect(state()).toBe("fresh");
        await vi.advanceTimersByTimeAsync(1);
        expect(state()).toBe("stale");
        // Kept, and still dated by the last sweep that landed.
        expect(feed.healthCheckedAt).toBe(checkedAt);
        expect(feed.nodes()[0].health?.status).toBe("ok");
        expect(feed.healthFreshness().checkedAt).toBe(Date.parse(checkedAt!));

        vi.mocked(fetchServiceHealth).mockResolvedValue({ service: "npc", status: "ok" });
        vi.mocked(fetchEcosystemHealth).mockResolvedValue({ aggregate: null, own: null });
        await vi.advanceTimersByTimeAsync(60_000);
        expect(state()).toBe("fresh");
    });

    it("stays stale through a failing schedule's attempts, rather than flickering at each", async () => {
        await feed.init();
        goOffline();
        await vi.advanceTimersByTimeAsync(STALE_AFTER_MS + 1);
        expect(state()).toBe("stale");
        // The next attempt (due at 180 s) is slow as well as doomed.
        vi.mocked(fetchEcosystemHealth).mockImplementation(() => later(5_000, null as never).then(offline));
        await vi.advanceTimersByTimeAsync(32_000);
        expect(feed.healthFreshness()).toMatchObject({ state: "stale", sweeping: true });
    });

    it("does not open a tab shown after a long hide on 'stale' while its sweep is under way", async () => {
        await feed.init();
        feed.pause();
        await vi.advanceTimersByTimeAsync(60 * 60_000);
        vi.mocked(fetchEcosystemHealth).mockImplementation(() => later(3_000, { aggregate: null, own: null }));

        feed.resume();
        expect(feed.healthFreshness()).toMatchObject({ state: "refreshing", sweeping: true });
        await vi.advanceTimersByTimeAsync(3_000);
        expect(state()).toBe("fresh");
    });

    it("counts the sweep a show started as refreshing even after a failed one, unless the reading was already stale", async () => {
        await feed.init();
        goOffline();
        await vi.advanceTimersByTimeAsync(70_000);             // the 60 s sweep failed; 70 s old
        feed.pause();
        await vi.advanceTimersByTimeAsync(60 * 60_000);
        vi.mocked(fetchEcosystemHealth).mockImplementation(() => later(3_000, null as never).then(offline));
        feed.resume();
        expect(state()).toBe("refreshing");
        await vi.advanceTimersByTimeAsync(3_000);
        expect(state()).toBe("stale");                         // and it failed too

        // Hidden while stale: showing it again is no reason to look fresher.
        feed.pause();
        await vi.advanceTimersByTimeAsync(60 * 60_000);
        feed.resume();
        expect(feed.healthFreshness()).toMatchObject({ state: "stale", sweeping: true });
    });

    it("reads a sweep that wakes after the clock jumped (a sleeping laptop) as refreshing", async () => {
        await feed.init();
        vi.mocked(fetchEcosystemHealth).mockImplementation(() => later(3_000, { aggregate: null, own: null }));
        // The clock moves on without the timers: nothing ran while asleep.
        vi.setSystemTime(Date.now() + 3 * 60 * 60_000);
        expect(state()).toBe("stale");                         // honest until the wake-up sweep starts
        await vi.advanceTimersByTimeAsync(60_000);
        expect(state()).toBe("refreshing");
        await vi.advanceTimersByTimeAsync(3_000);
        expect(state()).toBe("fresh");
    });
});
