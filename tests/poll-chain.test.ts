import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PollChain } from "../src/services/poll-chain.ts";

/**
 * The schedule every poller here runs on. Each case is a way a tab left open
 * stops telling the truth: two chains racing (older answers overwriting newer
 * ones), a chain that died on one throw, a hidden tab still polling, or a
 * shown one that waits a whole interval before refreshing what went stale.
 */
describe("PollChain", () => {
    let starts: number[];
    let t0: number;

    beforeEach(() => {
        vi.useFakeTimers();
        t0 = Date.now();
        starts = [];
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    /** A job that takes `ms` of fake time (none at all for 0), and records
     *  when each run started. */
    const taking = (ms: number) => vi.fn(async () => {
        starts.push(Date.now() - t0);
        if (ms > 0) await new Promise(r => setTimeout(r, ms));
    });

    it("arms each run a full interval after the previous one settles, not on a fixed clock", async () => {
        // Runs take 4 s, so they start every 14 s. A fixed 10 s interval would
        // start them at 0, 10, 20 and 30 — overlapping.
        const chain = new PollChain(taking(4_000), { everyMs: 10_000, label: "t" });
        void chain.run();
        await vi.advanceTimersByTimeAsync(43_000);
        expect(starts).toEqual([0, 14_000, 28_000, 42_000]);
        chain.stop();
    });

    it("never runs twice at once: run() during a run hands back that run", async () => {
        const job = taking(4_000);
        const chain = new PollChain(job, { everyMs: 10_000, label: "t" });
        const first = chain.run();
        await vi.advanceTimersByTimeAsync(1_000);
        expect(chain.run()).toBe(first);
        await vi.advanceTimersByTimeAsync(3_000);
        await first;
        expect(job).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(1);
        chain.stop();
    });

    it("keeps the chain after a throw, and waits the retry delay after a failure", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        let n = 0;
        const job = vi.fn(async () => {
            starts.push(Date.now() - t0);
            n++;
            if (n === 1) throw new Error("boom");
            return n > 2;                     // run 2 reports failure, run 3 succeeds
        });
        const chain = new PollChain(job, { everyMs: 10_000, retryMs: 1_000, label: "t" });
        await chain.run();
        expect(error).toHaveBeenCalledWith("[t] a poll threw; the next one is still scheduled", expect.any(Error));
        await vi.advanceTimersByTimeAsync(12_000);
        // 0 threw, 1s reported failure, 2s succeeded, then the full interval.
        expect(starts).toEqual([0, 1_000, 2_000, 12_000]);
        chain.stop();
    });

    it("backs off by how many runs in a row failed, and starts again from a success", async () => {
        // The registry's retry before it has ever loaded: 1 s, 2 s, 4 s here.
        const outcomes = [false, false, false, false, true, false];
        const job = vi.fn(async () => { starts.push(Date.now() - t0); return outcomes.shift() ?? true; });
        const retryMs = vi.fn((failures: number) => 1_000 * 2 ** Math.min(failures - 1, 2));
        const chain = new PollChain(job, { everyMs: 60_000, retryMs, label: "t" });
        await chain.run();
        await vi.advanceTimersByTimeAsync(80_000);
        // failed ×4 (1, 2, 4, 4 s), succeeded (60 s), failed once more (1 s).
        expect(starts).toEqual([0, 1_000, 3_000, 7_000, 11_000, 71_000, 72_000]);
        expect(retryMs.mock.calls.map(c => c[0])).toEqual([1, 2, 3, 4, 1]);
        chain.stop();
    });

    it("reports whether a run is in flight, whoever started it", async () => {
        const chain = new PollChain(taking(4_000), { everyMs: 10_000, label: "t" });
        expect(chain.running).toBe(false);
        void chain.run();
        expect(chain.running).toBe(true);
        await vi.advanceTimersByTimeAsync(4_000);
        expect(chain.running).toBe(false);
        await vi.advanceTimersByTimeAsync(10_000);          // its own timer
        expect(chain.running).toBe(true);
        await vi.advanceTimersByTimeAsync(4_000);
        chain.pause();
        await vi.advanceTimersByTimeAsync(30_000);
        chain.resume();                                     // resume() starts the overdue one
        expect(chain.running).toBe(true);
        chain.stop();
    });

    it("stops arming while paused; a run in flight finishes and arms nothing", async () => {
        const job = taking(4_000);
        const chain = new PollChain(job, { everyMs: 10_000, label: "t" });
        void chain.run();
        await vi.advanceTimersByTimeAsync(1_000);
        chain.pause();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(job).toHaveBeenCalledTimes(1);           // it ran to the end
        expect(vi.getTimerCount()).toBe(0);             // and armed nothing
        chain.stop();
    });

    it("resumes at once when a run fell due while paused", async () => {
        const chain = new PollChain(taking(0), { everyMs: 10_000, label: "t" });
        await chain.run();
        chain.pause();
        await vi.advanceTimersByTimeAsync(25_000);
        chain.resume();
        await vi.advanceTimersByTimeAsync(0);
        expect(starts).toEqual([0, 25_000]);
        chain.stop();
    });

    it("resumes with the time it had left when nothing fell due", async () => {
        const chain = new PollChain(taking(0), { everyMs: 10_000, label: "t" });
        await chain.run();
        await vi.advanceTimersByTimeAsync(3_000);
        chain.pause();
        await vi.advanceTimersByTimeAsync(4_000);
        chain.resume();                                 // 7 s in, due at 10 s
        await vi.advanceTimersByTimeAsync(2_999);
        expect(starts).toEqual([0]);
        await vi.advanceTimersByTimeAsync(1);
        expect(starts).toEqual([0, 10_000]);
        chain.stop();
    });

    it("keeps one chain through a hide and show during a run", async () => {
        // Starts every 4 s (run) + 10 s (wait). The hide and show land inside
        // the second run; had resume() started a run of its own, the old run
        // would re-arm beside it and the starts would double up from there.
        const job = taking(4_000);
        const chain = new PollChain(job, { everyMs: 10_000, label: "t" });
        void chain.run();
        await vi.advanceTimersByTimeAsync(15_000);
        chain.pause();
        chain.resume();
        await vi.advanceTimersByTimeAsync(1_000);
        chain.pause();
        chain.resume();
        await vi.advanceTimersByTimeAsync(39_000);
        expect(starts).toEqual([0, 14_000, 28_000, 42_000]);
        expect(vi.getTimerCount()).toBe(1);
        chain.stop();
    });

    it("does not start a chain its owner has not, and a resume without a pause changes nothing", async () => {
        const job = taking(0);
        const chain = new PollChain(job, { everyMs: 10_000, label: "t" });
        chain.pause();
        chain.resume();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(job).not.toHaveBeenCalled();

        await chain.run();
        chain.resume();
        chain.resume();
        await vi.advanceTimersByTimeAsync(20_000);
        expect(starts).toEqual([60_000, 70_000, 80_000]);
        chain.stop();
    });

    it("runs when its owner asks even while paused, and then waits for resume()", async () => {
        // A tab opened in the background: the scene pauses at once, and the
        // first load still has to happen.
        const chain = new PollChain(taking(0), { everyMs: 10_000, label: "t" });
        chain.pause();
        await chain.run();
        await vi.advanceTimersByTimeAsync(30_000);
        expect(starts).toEqual([0]);
        chain.resume();
        await vi.advanceTimersByTimeAsync(0);
        expect(starts).toEqual([0, 30_000]);
        chain.stop();
    });

    it("arms nothing after stop(), not even from a run in flight, and ignores resume()", async () => {
        const job = taking(4_000);
        const chain = new PollChain(job, { everyMs: 10_000, label: "t" });
        const running = chain.run();
        await vi.advanceTimersByTimeAsync(1_000);
        chain.stop();
        await vi.advanceTimersByTimeAsync(3_000);
        await running;
        chain.pause();
        chain.resume();
        await chain.run();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(job).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });
});
