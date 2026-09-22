import type {
    AlgoraSignal,
    AODebate,
    AOIdea,
    AOSignal,
    AlgoraStats,
    AOStatus,
    BridgeSignal,
    BridgeStats,
    BridgeOutcome,
    BridgeTrustEntry,
    UnifiedSignal,
} from "./types.ts";
import { isRecord, finiteOrNull } from "./http.ts";
import { PollChain } from "./poll-chain.ts";
import { fetchAlgoraSignals, fetchAlgoraStats } from "./algora-client.ts";
import { fetchAOSignals, fetchAODebates, fetchAOStatus, fetchAOIdeas, fetchAOProjectTotal } from "./ao-client.ts";
import { fetchBridgeSignals, fetchBridgeStats, fetchBridgeOutcomes, fetchBridgeTrustLeaderboard } from "./bridge-client.ts";

// --- Row conversion ---
//
// Each upstream row becomes the four fields the dedupe and the belt read, and
// nothing else: id and origin key the dedupe, title and severity are what the
// belt shows. The rows are other services' JSON behind an unchecked cast, so
// each field is checked for what it claims to be. A row that cannot be keyed
// throws, and the caller skips just that row.

/** A row's primary key. A row we cannot key cannot be deduplicated either, so
 *  it is refused rather than counted under a shared "undefined". */
function rowId(v: unknown): string {
    if (typeof v === "string" && v) return v;
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
    throw new TypeError("signal row has no usable id");
}

const text = (v: unknown): string => (typeof v === "string" ? v : "");

/** A title only if it is real text. An RSS feed parsed from XML can deliver a
 *  `<title>` that carries attributes as an object ({_, $}); coercing that with
 *  String() would put "[object Object]" on the belt, so it falls back instead. */
const titleOr = (v: unknown, fallback: string): string =>
    typeof v === "string" && v ? v : fallback.slice(0, 80);

const SEVERITIES: readonly unknown[] = ["critical", "high", "medium", "low"];
/** A severity only if it is one the belt knows. Anything else — a number, an
 *  object, a string outside the four — reads as the same "medium" a missing
 *  severity already gets, never as a stray value behind the union type. */
const severityOr = (v: unknown): UnifiedSignal["severity"] =>
    SEVERITIES.includes(v) ? (v as UnifiedSignal["severity"]) : "medium";

function algoraSignalToUnified(s: AlgoraSignal): UnifiedSignal {
    // `metadata` is JSON text, and nullable upstream. JSON.parse(null) and
    // JSON.parse("null") both *return* null rather than throwing, so the catch
    // alone does not make the read safe: only a parsed object is read. A
    // property read on that null used to throw and take every origin's signals
    // down with it.
    let meta: unknown = null;
    try { meta = JSON.parse(s.metadata ?? ""); } catch { /* not JSON: titled from the description */ }
    const title = isRecord(meta) ? meta.title : undefined;
    return {
        id: rowId(s.id), origin: "algora",
        severity: severityOr(s.severity), title: titleOr(title, text(s.description)),
    };
}

function aoSignalToUnified(s: AOSignal): UnifiedSignal {
    return {
        id: rowId(s.id), origin: "ao",
        severity: "medium", title: titleOr(s.title, text(s.summary)),
    };
}

function bridgeSignalToUnified(s: BridgeSignal): UnifiedSignal {
    return {
        id: rowId(s.id), origin: "bridge",
        severity: severityOr(s.severity), title: text(s.description).slice(0, 80),
    };
}

// --- Live stats ---
export type LiveStats = {
    algora: AlgoraStats | null;
    ao: AOStatus | null;
    bridge: BridgeStats | null;
};

// --- Per-service reachability ---
export type ServiceFlags = { algora: boolean; ao: boolean; bridge: boolean };

/** "connecting" until the first status-bearing poll settles. Without it the UI
 *  has to render the initial unknown state as one of live/offline, and picking
 *  offline makes a healthy system announce an outage on every page load. */
export type ConnState = "connecting" | "live" | "offline";
const NO_SERVICES: ServiceFlags = { algora: false, ao: false, bridge: false };

// Dedupe memory, bounded per origin. What decides the bound is not our queue
// but what the upstreams can send again: every poll re-fetches each service's
// latest 30/20/20 signals, so any id still inside one of those windows will
// come back. The memory is kept in order of when each id was last *seen* — an
// id a response contains is moved to the newest end — so it only ever forgets
// ids that have stopped being served, even from a source that has gone quiet
// and returns the same window for hours. It is per origin, so a service whose
// requests are failing (and whose window is therefore not being refreshed) is
// not pushed out by the others' churn and replayed when it recovers. The cap
// is far above any window; it exists only so an always-on tab stays bounded.
export const MAX_SEEN_IDS_PER_ORIGIN = 1000;

// --- Cadence ---
//
// Each read runs on its own schedule, sized to how often its data changes and
// what it costs to fetch. They used to share one 15 s cycle, and the detail
// views' reads were ~99% of its bytes — ~807 kB transferred and ~3.5 MB of JSON
// decoded every 15 s, whether anyone was looking or not:
//
//   AO debates   470 kB gzip for ten debates, almost all of it
//                `ideas_generated`, for a card that shows one topic and 100
//                characters of context. Debates start about every six hours.
//   AO plans     237 kB, read only as the list's length — the fetch cap, shown
//                as a total. /ao-api/status already reports `plans_created`.
//   AO ideas      92 kB, for belt bubbles. New ideas arrive in bursts, hours
//                apart.
//   Algora issues  read by nothing at all.
//
// AO sends no validators, so each AO read was a full download every time.
// Algora's issues were cacheable (max-age=60 plus an ETag), so most polls were
// answered by the HTTP cache or a 304, but nothing read them at all.
// Plans and issues are no longer fetched (see types.ts); the rest are below.
//
// README.md / README.ko.md ("Reading the data correctly") state these figures.
// Keep them in step.

/** Reachability — each service's signals and stats, a few kB — is what the
 *  LIVE badges and the Service I/O figures stand on, so it keeps the fast
 *  cadence. The CentralMonitor strip shows it beside DETAIL_INTERVAL_MS and
 *  DEBATE_INTERVAL_MS, the cadences of the belt views' detail reads. */
export const POLL_INTERVAL_MS = 15_000;
// Bounds a reachability read. An in-flight guard alone would let one stuck
// request block every later refresh, so the guard and this timeout have to ship
// together.
export const POLL_TIMEOUT_MS = 10_000;
/** AO ideas and the project total, Bridge outcomes and trust. */
export const DETAIL_INTERVAL_MS = 5 * 60_000;
/** AO debates, the largest rows there are. */
export const DEBATE_INTERVAL_MS = 10 * 60_000;
/** A detail read that failed tries again this soon, rather than leaving an
 *  empty panel — or "AO debates unavailable" — up for a whole interval. A
 *  success waits the full interval. */
export const DETAIL_RETRY_MS = 60_000;
/** Longer than reachability's, because these bodies are tens to hundreds of kB
 *  and read rarely: a slow link gets the time to finish them instead of paying
 *  for a download that is cut off and repeated. Each read has its own, so a
 *  slow one can neither cut another short nor hold up the status chain. */
export const DETAIL_TIMEOUT_MS = 30_000;
/** How many debates the card rotates through. Each is ~220 kB, and `?limit=` is
 *  the only size control AO honours. */
export const DEBATE_LIMIT = 3;

/** Reads the ServiceFlags out of a settled pollSignals/pollStats result. */
function settledFlags(r: PromiseSettledResult<unknown>): ServiceFlags {
    return r.status === "fulfilled" && r.value && typeof r.value === "object"
        ? (r.value as ServiceFlags)
        : NO_SERVICES;
}

/** A service's own totals, each null when we do not have it. */
export type AOTotals = { ideas: number | null; plans: number | null; projects: number | null };
export type BridgeTotals = {
    proposals: number | null;
    /** null also when Bridge has recorded no proof yet — not 0%, which would
     *  claim every recorded outcome failed. */
    successRate: number | null;
    signals: number | null;
    issues: number | null;
};

// --- Data Bridge ---
export class DataBridge {
    private signalQueue: UnifiedSignal[] = [];
    /** Primary keys belong to each upstream, not to the combined feed, so ids
     *  are remembered within their origin — the same id from two services is
     *  two signals. Sets iterate in insertion order, which is what makes the
     *  oldest-seen end cheap to find. */
    private seenSignalIds: Record<UnifiedSignal["origin"], Set<string>> = {
        algora: new Set(), ao: new Set(), bridge: new Set(),
    };
    /** Every read in flight, whichever schedule started it, so teardown can
     *  cancel them all. */
    private inFlight = new Set<AbortController>();
    private destroyed = false;
    private connState: ConnState = "connecting";

    private readonly status = new PollChain(() => this.pollStatus(),
        { everyMs: POLL_INTERVAL_MS, label: "data" });
    private readonly details: readonly PollChain[] = [
        new PollChain(() => this.pollIdeas(),
            { everyMs: DETAIL_INTERVAL_MS, retryMs: DETAIL_RETRY_MS, label: "data" }),
        new PollChain(() => this.pollProjectTotal(),
            { everyMs: DETAIL_INTERVAL_MS, retryMs: DETAIL_RETRY_MS, label: "data" }),
        new PollChain(() => this.pollBridgeGovernance(),
            { everyMs: DETAIL_INTERVAL_MS, retryMs: DETAIL_RETRY_MS, label: "data" }),
        new PollChain(() => this.pollDebates(),
            { everyMs: DEBATE_INTERVAL_MS, retryMs: DETAIL_RETRY_MS, label: "data" }),
    ];

    /** Per-service reachability, updated every poll. Lets the UI show AO as
     *  OFFLINE while Algora/Bridge stay LIVE, instead of one blanket status. */
    serviceUp: ServiceFlags = { ...NO_SERVICES };
    /** True when the last AO debates fetch failed (distinguishes "erroring"
     *  from "still loading" in the AO panel). */
    debatesErrored = false;

    /** Monotonic count of signals actually ingested, per origin. The hub map
     *  emits one mote per counted signal, so its motion can never outrun the
     *  data — an idle service simply produces none. */
    ingested: Record<"algora" | "ao" | "bridge", number> = { algora: 0, ao: 0, bridge: 0 };

    liveStats: LiveStats = { algora: null, ao: null, bridge: null };
    debateCache: AODebate[] = [];
    ideaCache: AOIdea[] = [];
    outcomeCache: BridgeOutcome[] = [];
    trustCache: BridgeTrustEntry[] = [];
    /** AO's own counts from the list envelopes, null until one arrives with a
     *  number in it. Not the lengths of the lists: those are our fetch sizes. */
    private ideaTotal: number | null = null;
    private projectTotal: number | null = null;

    /**
     * One full load, then every read keeps its own schedule.
     *
     * Reachability goes first, on its own. The detail reads are tens of times
     * larger, and on a slow link sharing the bandwidth with them is what would
     * hold up the first LIVE/OFFLINE verdict — the same reason they are never
     * awaited before reachability is published.
     *
     * resume() does not keep this order: after a long hide, every read that
     * fell due starts at once, reachability included. That is acceptable
     * there. The previous verdict is still on screen rather than "connecting",
     * and the verdict rests on the stats reads (a few hundred bytes each,
     * OR'ed with the signal reads), which finish long before their timeout
     * even when they share the link.
     *
     * This load runs to the end even if pause() lands while it is under way —
     * a tab opened in the background — so there is something to show once
     * the tab is. Only the schedules after it wait.
     */
    async init(): Promise<ConnState> {
        await this.status.run();
        await Promise.all(this.details.map(c => c.run()));
        return this.connState;
    }

    /**
     * Stops polling, for a tab nobody can see. Nothing new is scheduled; a
     * read already in flight finishes and lands, since its answer is as
     * current as any, but schedules nothing after it. The first load in
     * init() is the exception: it runs to the end, detail reads included, so
     * there is something to show, and only the schedules after it wait. The
     * scene calls this on `visibilitychange`: this layer is DOM-free, and a
     * hidden tab was downloading everything above around the clock.
     */
    pause(): void {
        for (const c of this.chains()) c.pause();
    }

    /** Picks every schedule up again: a read that fell due while hidden runs at
     *  once — reachability included, see init() — and the rest wait out the
     *  time they had left. See PollChain.resume. */
    resume(): void {
        for (const c of this.chains()) c.resume();
    }

    private chains(): PollChain[] {
        return [this.status, ...this.details];
    }

    connectionState(): ConnState { return this.connState; }
    queueSize(): number { return this.signalQueue.length; }

    /**
     * One read, with a controller of its own that its timeout and teardown
     * abort. So a hung upstream can neither stall a schedule nor keep running
     * after destroy(), and a slow read cannot cut short one on another
     * schedule.
     */
    private async withSignal<T>(timeoutMs: number, read: (signal: AbortSignal) => Promise<T>): Promise<T> {
        const ctrl = new AbortController();
        this.inFlight.add(ctrl);
        const timeout = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
            return await read(ctrl.signal);
        } finally {
            clearTimeout(timeout);
            this.inFlight.delete(ctrl);
        }
    }

    /** Reachability. One signal across the six requests, so the timeout and
     *  teardown cancel all of them. */
    private async pollStatus(): Promise<void> {
        if (this.destroyed) return;
        const status = await this.withSignal(POLL_TIMEOUT_MS, signal =>
            Promise.allSettled([this.pollSignals(signal), this.pollStats(signal)]));
        if (this.destroyed) return;

        const sig = settledFlags(status[0]);
        const stat = settledFlags(status[1]);
        this.serviceUp = {
            algora: sig.algora || stat.algora,
            ao: sig.ao || stat.ao,
            bridge: sig.bridge || stat.bridge,
        };
        this.connState = (this.serviceUp.algora || this.serviceUp.ao || this.serviceUp.bridge)
            ? "live"
            : "offline";
    }

    private async pollSignals(signal: AbortSignal): Promise<ServiceFlags> {
        const [a, ao, b] = await Promise.allSettled([
            fetchAlgoraSignals(30, signal), fetchAOSignals(20, signal), fetchBridgeSignals(20, signal),
        ]);
        const unified: UnifiedSignal[] = [];
        const ingest = (s: UnifiedSignal) => {
            const seen = this.seenSignalIds[s.origin];
            if (seen.has(s.id)) {
                // Still being served: move it to the newest end, so it outlives
                // every id that has stopped being served.
                seen.delete(s.id);
                seen.add(s.id);
                return;
            }
            seen.add(s.id);
            unified.push(s);
            this.ingested[s.origin]++;
        };
        // Row by row, so a row that cannot be converted costs only itself.
        // Counting happens in `ingest`, after conversion succeeded, so
        // `ingested` stays exactly what reaches the queue.
        const take = <T>(r: PromiseSettledResult<T[]>, convert: (row: T) => UnifiedSignal) => {
            if (r.status !== "fulfilled") return;
            for (const row of r.value) {
                try { ingest(convert(row)); } catch { /* skip this row only */ }
            }
        };
        take(a, algoraSignalToUnified);
        take(ao, aoSignalToUnified);
        take(b, bridgeSignalToUnified);
        // shuffle
        for (let i = unified.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [unified[i], unified[j]] = [unified[j], unified[i]]; }
        this.signalQueue.push(...unified);
        if (this.signalQueue.length > 200) this.signalQueue = this.signalQueue.slice(-200);
        // Forget from the least recently seen end once past the cap. Anything
        // a window returned this poll was just touched, so it is never here.
        for (const seen of Object.values(this.seenSignalIds)) {
            for (const id of seen) {
                if (seen.size <= MAX_SEEN_IDS_PER_ORIGIN) break;
                seen.delete(id);
            }
        }
        return { algora: a.status === "fulfilled", ao: ao.status === "fulfilled", bridge: b.status === "fulfilled" };
    }

    private async pollStats(signal: AbortSignal): Promise<ServiceFlags> {
        const [a, ao, b] = await Promise.allSettled([fetchAlgoraStats(signal), fetchAOStatus(signal), fetchBridgeStats(signal)]);
        if (a.status === "fulfilled") this.liveStats.algora = a.value;
        if (ao.status === "fulfilled") this.liveStats.ao = ao.value;
        if (b.status === "fulfilled") this.liveStats.bridge = b.value;
        return { algora: a.status === "fulfilled", ao: ao.status === "fulfilled", bridge: b.status === "fulfilled" };
    }

    // Supporting detail for the belt views. None of it gates reachability, and
    // each read keeps its previous answer when it fails — and an answer that
    // arrives without its list counts as a failure (the clients throw), not as
    // an empty success that would blank the panel for a whole interval. Each
    // returns whether it succeeded, which is what decides between its retry
    // and its interval.

    /** A detail read with its own timeout. False when it threw — the stale
     *  cache stays — or when it reports that part of it failed. */
    private async detail(read: (signal: AbortSignal) => Promise<boolean | void>): Promise<boolean> {
        if (this.destroyed) return true;
        try {
            return (await this.withSignal(DETAIL_TIMEOUT_MS, read)) !== false;
        } catch {
            return false;
        }
    }

    private pollIdeas(): Promise<boolean> {
        return this.detail(async signal => {
            const { ideas, total } = await fetchAOIdeas(30, signal);
            this.ideaCache = ideas;
            this.ideaTotal = total;
        });
    }

    private pollProjectTotal(): Promise<boolean> {
        return this.detail(async signal => { this.projectTotal = await fetchAOProjectTotal(signal); });
    }

    private async pollDebates(): Promise<boolean> {
        const ok = await this.detail(async signal => {
            this.debateCache = await fetchAODebates(DEBATE_LIMIT, signal);
        });
        if (!this.destroyed) this.debatesErrored = !ok;
        return ok;
    }

    private pollBridgeGovernance(): Promise<boolean> {
        // Bridge's proposal list is deliberately NOT fetched here: /bridge-api/proposals
        // returns the full collection (~3.3 MB, and the API ignores ?limit), and nothing
        // in the app reads it — the proposal figures shown in the sidebar come from
        // /bridge-api/stats instead. Re-adding it needs a server-side limit first.
        return this.detail(async signal => {
            const [outs, trust] = await Promise.allSettled([fetchBridgeOutcomes(20, signal), fetchBridgeTrustLeaderboard("agent", signal)]);
            if (outs.status === "fulfilled") this.outcomeCache = outs.value;
            if (trust.status === "fulfilled") this.trustCache = trust.value;
            return outs.status === "fulfilled" && trust.status === "fulfilled";
        });
    }

    nextSignal(): UnifiedSignal | null { return this.signalQueue.shift() ?? null; }

    getRandomDebate(): { topic: string; snippet: string } | null {
        if (this.debateCache.length === 0) return null;
        const d = this.debateCache[Math.floor(Math.random() * this.debateCache.length)];
        if (!d) return null;
        // The list carries no transcript, only `message_count`, so the snippet
        // is the opening of the debate's context.
        const topic = text(d.topic).slice(0, 70);
        if (!topic) return null;
        return { topic, snippet: text(d.context).slice(0, 100) };
    }

    /**
     * AO's totals for the funnel: Ideas and Plans as /ao-api/status reports
     * them, Projects from the projects envelope. Never the length of a list we
     * fetched — that is our fetch size (30 ideas), and it used to be shown as
     * the total whenever the status body came without `stats`. The one
     * fallback is AO's own again: the ideas envelope's `total`.
     */
    aoTotals(): AOTotals {
        const s = this.liveStats.ao?.stats;
        return {
            ideas: finiteOrNull(s?.ideas_generated) ?? this.ideaTotal,
            plans: finiteOrNull(s?.plans_created),
            projects: this.projectTotal,
        };
    }

    /** Bridge's totals from /bridge-api/stats, each null unless it is a number. */
    bridgeTotals(): BridgeTotals {
        const b = this.liveStats.bridge;
        return {
            proposals: finiteOrNull(b?.proposals?.total),
            successRate: finiteOrNull(b?.outcomes?.successRate),
            signals: finiteOrNull(b?.signals?.total),
            issues: finiteOrNull(b?.issues?.total),
        };
    }

    destroy(): void {
        this.destroyed = true;
        for (const c of this.chains()) c.stop();
        this.inFlight.forEach(ctrl => ctrl.abort());
        this.inFlight.clear();
    }
}
