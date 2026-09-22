import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EcosystemFeed } from "../src/services/ecosystem-feed.ts";
import { fetchRegistry, fetchEcosystemHealth } from "../src/services/ecosystem-client.ts";

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
