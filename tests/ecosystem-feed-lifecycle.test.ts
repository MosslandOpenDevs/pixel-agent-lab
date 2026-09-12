import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EcosystemFeed } from "../src/services/ecosystem-feed.ts";
import { fetchRegistry, fetchEcosystemHealth } from "../src/services/ecosystem-client.ts";

vi.mock("../src/services/ecosystem-client.ts", () => ({
    fetchRegistry: vi.fn(),
    fetchEcosystemHealth: vi.fn(),
    fetchServiceHealth: vi.fn(),
}));

describe("EcosystemFeed teardown", () => {
    let feed: EcosystemFeed;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.resetAllMocks();
        feed = new EcosystemFeed();
        vi.mocked(fetchRegistry).mockResolvedValue([]);
        vi.mocked(fetchEcosystemHealth).mockResolvedValue(null);
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
});
