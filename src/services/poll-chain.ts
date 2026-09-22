/**
 * One polling schedule: a job, run again a fixed wait after each run settles.
 *
 * DataBridge's reads and EcosystemFeed's two feeds all follow the same
 * discipline, and each rule here is a bug that has already shipped once:
 *
 *   Chained, never on a fixed interval. A run slower than the period would
 *   otherwise overlap the next one, and whichever finished last would win —
 *   flipping LIVE back to OFFLINE and caches back to older data.
 *
 *   Never two runs at once. run() while a run is in flight hands back that run
 *   instead of starting another. This guard did not exist before pause and
 *   resume: chaining alone kept runs apart, and a hide and show during one run
 *   would have left the old run re-arming beside a new chain — double traffic,
 *   and the older-result-wins race above.
 *
 *   A throw costs that run and nothing else. The next run is armed once a run
 *   settles, so a job that threw used to end its chain for the life of the tab,
 *   leaving the last numbers on screen as if they were current. Nothing in a
 *   job is meant to throw — every request settles on its own — so reaching the
 *   catch is a bug worth a console line, not a reason to stop watching.
 *
 *   Nothing is armed after stop(), so teardown during a run cannot be undone by
 *   that run re-arming when it settles.
 *
 * The chain owns scheduling only. Timeouts and aborts belong to the job's
 * owner, which is also what cancels a run in flight on teardown.
 */
export type PollChainOptions = {
    /** Wait after a run settles before the next one starts. */
    everyMs: number;
    /** Wait instead of `everyMs` after a run that failed — its job returned
     *  `false` or threw. Unset, a failed run waits `everyMs` like any other.
     *  A function is handed how many runs in a row have now failed (1 after
     *  the first), so a retry can back off; a success starts the count again. */
    retryMs?: number | ((failures: number) => number);
    /** Prefix for the console line when a job throws, e.g. "data". */
    label: string;
};

export class PollChain {
    private readonly job: () => Promise<boolean | void>;
    private readonly everyMs: number;
    private readonly retryMs: PollChainOptions["retryMs"];
    private readonly label: string;

    private timer: ReturnType<typeof setTimeout> | null = null;
    private current: Promise<void> | null = null;
    /** Runs in a row that failed, for a `retryMs` that backs off. */
    private failures = 0;
    /** When the next run is due: set as each run settles, from its outcome. */
    private dueAt = 0;
    /** False until the owner first runs it. resume() must not start a chain
     *  its owner has not: EcosystemFeed's health sweep waits for the registry. */
    private started = false;
    private paused = false;
    private stopped = false;

    constructor(job: () => Promise<boolean | void>, opts: PollChainOptions) {
        this.job = job;
        this.everyMs = opts.everyMs;
        this.retryMs = opts.retryMs;
        this.label = opts.label;
    }

    /**
     * Runs the job now and arms the next run once it settles. While a run is
     * in flight this returns that run rather than starting a second. Resolves
     * after the next run is armed; never rejects.
     *
     * Runs even while paused — it is the owner asking — but then arms nothing.
     */
    run(): Promise<void> {
        if (this.stopped) return Promise.resolve();
        if (this.current) return this.current;
        this.started = true;
        // A run started by hand replaces the one that was waiting.
        this.clearTimer();
        // `.then` always calls back asynchronously, so `current` is assigned
        // below before this clears it — even for a job that throws at once.
        const current = this.execute().then(ok => {
            this.current = null;
            this.failures = ok === false ? this.failures + 1 : 0;
            const wait = this.waitAfter(ok !== false);
            this.dueAt = Date.now() + wait;
            this.arm(wait);
        });
        this.current = current;
        return current;
    }

    /** Whether a run is in flight right now — started by run(), by its timer
     *  or by resume(). Its owner can read this to tell a reading that is being
     *  replaced from one that nothing is replacing. */
    get running(): boolean {
        return this.current !== null;
    }

    /**
     * Stops arming new runs. A run in flight is left to finish — its answer is
     * as current as any — but does not arm another.
     */
    pause(): void {
        this.paused = true;
        this.clearTimer();
    }

    /**
     * Picks the schedule up where pause() left it. A run that fell due while
     * paused starts at once; one that is not yet due is armed for the time it
     * still had to wait. If a run is in flight, it arms the next one itself when
     * it settles, so there is still only ever one chain.
     */
    resume(): void {
        if (this.stopped || !this.paused) return;
        this.paused = false;
        if (!this.started || this.current || this.timer) return;
        const wait = this.dueAt - Date.now();
        if (wait <= 0) void this.run();
        else this.arm(wait);
    }

    /** For good: nothing is armed afterwards, whatever is in flight does. */
    stop(): void {
        this.stopped = true;
        this.clearTimer();
    }

    private async execute(): Promise<boolean | void> {
        try {
            return await this.job();
        } catch (err) {
            console.error(`[${this.label}] a poll threw; the next one is still scheduled`, err);
            return false;
        }
    }

    private waitAfter(ok: boolean): number {
        if (ok || this.retryMs === undefined) return this.everyMs;
        return typeof this.retryMs === "function" ? this.retryMs(this.failures) : this.retryMs;
    }

    private arm(ms: number): void {
        if (this.stopped || this.paused) return;
        this.clearTimer();
        this.timer = setTimeout(() => {
            this.timer = null;
            void this.run();
        }, ms);
    }

    private clearTimer(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }
}
