import type {
    AlgoraSignal,
    AlgoraIssue,
    AODebate,
    AOIdea,
    AOPlan,
    AOProject,
    AOSignal,
    AlgoraStats,
    AOStatus,
    BridgeSignal,
    BridgeStats,
    BridgeOutcome,
    BridgeTrustEntry,
    UnifiedSignal,
} from "./types.ts";
import { isRecord } from "./http.ts";
import { fetchAlgoraSignals, fetchAlgoraIssues, fetchAlgoraStats } from "./algora-client.ts";
import { fetchAOSignals, fetchAODebates, fetchAOStatus, fetchAOIdeas, fetchAOPlans, fetchAOProjects } from "./ao-client.ts";
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

const POLL_INTERVAL_MS = 15_000;
// Bounds a whole cycle. An in-flight guard alone would let one stuck request
// block every later refresh, so the guard and this timeout have to ship together.
const POLL_TIMEOUT_MS = 10_000;

/** Reads the ServiceFlags out of a settled pollSignals/pollStats result. */
function settledFlags(r: PromiseSettledResult<unknown>): ServiceFlags {
    return r.status === "fulfilled" && r.value && typeof r.value === "object"
        ? (r.value as ServiceFlags)
        : NO_SERVICES;
}

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
    private pollTimer: ReturnType<typeof setTimeout> | null = null;
    private inFlight: AbortController | null = null;
    private destroyed = false;
    private connState: ConnState = "connecting";

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
    issueCache: AlgoraIssue[] = [];
    debateCache: AODebate[] = [];
    ideaCache: AOIdea[] = [];
    planCache: AOPlan[] = [];
    projectCache: AOProject[] = [];
    outcomeCache: BridgeOutcome[] = [];
    trustCache: BridgeTrustEntry[] = [];

    async init(): Promise<ConnState> {
        await this.tick();
        return this.connState;
    }

    /** Polls are chained, never scheduled on a fixed interval: a cycle slower
     *  than the period would otherwise overlap the next one, and whichever
     *  finished last would win — flipping LIVE back to OFFLINE and caches back
     *  to older data. Chaining also means destroy() during the very first poll
     *  cannot be undone by init() installing a timer afterwards. */
    private scheduleNext(): void {
        if (this.destroyed) return;
        this.pollTimer = setTimeout(() => { void this.tick(); }, POLL_INTERVAL_MS);
    }

    /** One cycle, then the next is armed whatever the cycle did. Nothing in a
     *  cycle is meant to throw — every request settles on its own — but a throw
     *  would otherwise skip the re-arm and end polling for the life of the tab,
     *  leaving the last numbers on screen as if they were current. */
    private async tick(): Promise<void> {
        try {
            await this.poll();
        } catch (err) {
            console.error("[data] a poll threw; the next one is still scheduled", err);
        } finally {
            this.scheduleNext();
        }
    }

    connectionState(): ConnState { return this.connState; }
    queueSize(): number { return this.signalQueue.length; }

    private async poll(): Promise<void> {
        if (this.destroyed) return;

        // One controller per cycle, aborted on timeout or teardown, so a hung
        // upstream can neither stall the chain nor keep running after destroy().
        const ctrl = new AbortController();
        this.inFlight = ctrl;
        const timeout = setTimeout(() => ctrl.abort(), POLL_TIMEOUT_MS);
        try {
            await this.pollOnce(ctrl.signal);
        } finally {
            clearTimeout(timeout);
            if (this.inFlight === ctrl) this.inFlight = null;
        }
    }

    private async pollOnce(signal: AbortSignal): Promise<void> {
        // Reachability comes from signals+stats alone (a few KB). The bulk
        // fetches below are an order of magnitude larger, so awaiting them
        // before publishing status is what made a healthy board read OFFLINE
        // for the whole loading window.
        const status = await Promise.allSettled([this.pollSignals(signal), this.pollStats(signal)]);
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

        // Supporting detail: never gates the status above. Each of these keeps
        // its own stale cache on failure, so there is nothing to collect here —
        // awaiting them only keeps the cycle (and its abort signal) open until
        // they finish.
        await Promise.allSettled([
            this.pollIssues(signal), this.pollDebates(signal),
            this.pollAOPipeline(signal), this.pollBridgeGovernance(signal),
        ]);
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

    private async pollIssues(signal: AbortSignal): Promise<void> { try { this.issueCache = await fetchAlgoraIssues(30, signal); } catch { /* stale */ } }
    private async pollDebates(signal: AbortSignal): Promise<void> {
        try { this.debateCache = await fetchAODebates(10, signal); this.debatesErrored = false; }
        catch { this.debatesErrored = true; /* keep stale cache */ }
    }
    private async pollStats(signal: AbortSignal): Promise<ServiceFlags> {
        const [a, ao, b] = await Promise.allSettled([fetchAlgoraStats(signal), fetchAOStatus(signal), fetchBridgeStats(signal)]);
        if (a.status === "fulfilled") this.liveStats.algora = a.value;
        if (ao.status === "fulfilled") this.liveStats.ao = ao.value;
        if (b.status === "fulfilled") this.liveStats.bridge = b.value;
        return { algora: a.status === "fulfilled", ao: ao.status === "fulfilled", bridge: b.status === "fulfilled" };
    }
    private async pollAOPipeline(signal: AbortSignal): Promise<void> {
        const [ideas, plans, projects] = await Promise.allSettled([fetchAOIdeas(30, signal), fetchAOPlans(20, signal), fetchAOProjects(20, signal)]);
        if (ideas.status === "fulfilled") this.ideaCache = ideas.value;
        if (plans.status === "fulfilled") this.planCache = plans.value;
        if (projects.status === "fulfilled") this.projectCache = projects.value;
    }
    private async pollBridgeGovernance(signal: AbortSignal): Promise<void> {
        // Bridge's proposal list is deliberately NOT fetched here: /bridge-api/proposals
        // returns the full collection (~3.3 MB, and the API ignores ?limit), and nothing
        // in the app reads it — the proposal figures shown in the sidebar come from
        // /bridge-api/stats instead. Re-adding it needs a server-side limit first.
        const [outs, trust] = await Promise.allSettled([fetchBridgeOutcomes(20, signal), fetchBridgeTrustLeaderboard("agent", signal)]);
        if (outs.status === "fulfilled") this.outcomeCache = outs.value;
        if (trust.status === "fulfilled") this.trustCache = trust.value;
    }

    nextSignal(): UnifiedSignal | null { return this.signalQueue.shift() ?? null; }

    getRandomDebate(): { topic: string; snippet: string } | null {
        if (this.debateCache.length === 0) return null;
        const d = this.debateCache[Math.floor(Math.random() * this.debateCache.length)];
        if (!d) return null;
        const snippet = d.messages && d.messages.length > 0
            ? d.messages.slice(0, 2).map(m => `${m.agent ?? "?"}: ${(m.content_ko ?? m.content ?? "").slice(0, 50)}`).join(" | ")
            : (d.context ?? "").slice(0, 100);
        const topic = (d.topic ?? "").slice(0, 70);
        if (!topic) return null;
        return { topic, snippet };
    }

    destroy(): void {
        this.destroyed = true;
        if (this.pollTimer) { clearTimeout(this.pollTimer); this.pollTimer = null; }
        this.inFlight?.abort();
        this.inFlight = null;
    }
}
