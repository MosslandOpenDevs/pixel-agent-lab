import type {
    AlgoraSignal,
    AlgoraIssue,
    AODebate,
    AOIdea,
    AOPlan,
    AOProject,
    AlgoraStats,
    AOStatus,
    BridgeStats,
    BridgeOutcome,
    BridgeTrustEntry,
    UnifiedSignal,
} from "./types.ts";
import { fetchAlgoraSignals, fetchAlgoraIssues, fetchAlgoraStats } from "./algora-client.ts";
import { fetchAOSignals, fetchAODebates, fetchAOStatus, fetchAOIdeas, fetchAOPlans, fetchAOProjects } from "./ao-client.ts";
import { fetchBridgeSignals, fetchBridgeStats, fetchBridgeOutcomes, fetchBridgeTrustLeaderboard } from "./bridge-client.ts";

// --- Source normalizer ---
function normalizeSource(raw: string): string {
    const l = (raw ?? "").toLowerCase();
    if (l.includes("github")) return "github";
    if (l.includes("rss") || l.includes("news")) return "rss";
    if (l.includes("social") || l.includes("mastodon") || l.includes("twitter") || l.includes("reddit")) return "social";
    if (l.includes("chain") || l.includes("blockchain") || l.includes("etherscan") || l.includes("telemetry")) return "chain";
    if (l === "api") return "chain";
    return "rss";
}

function normalizeCategory(raw: string): string {
    const l = (raw ?? "").toLowerCase();
    if (l.includes("ai") || l.includes("ml") || l.includes("llm")) return "ai";
    if (l.includes("dev") || l.includes("protocol") || l.includes("github_commit")) return "dev";
    if (l.includes("security") || l.includes("infosec")) return "security";
    if (l.includes("crypto") || l.includes("defi") || l.includes("web3") || l.includes("moc") || l.includes("token") || l.includes("market") || l.includes("price") || l.includes("treasury")) return "crypto";
    return "dev";
}

function algoraSignalToUnified(s: AlgoraSignal): UnifiedSignal {
    let meta: { title?: string; link?: string; url?: string } = {};
    try { meta = JSON.parse(s.metadata); } catch { /* ignore */ }
    const description = s.description ?? "";
    return {
        id: s.id, origin: "algora",
        source: normalizeSource(s.source), category: normalizeCategory(s.category),
        severity: s.severity ?? "medium", title: meta.title ?? description.slice(0, 80),
        description, url: meta.link ?? meta.url, timestamp: s.timestamp,
    };
}

function aoSignalToUnified(s: { id: string; source: string; category: string; title: string; summary: string; url: string; collected_at: string }): UnifiedSignal {
    const summary = s.summary ?? "";
    return {
        id: s.id, origin: "ao",
        source: normalizeSource(s.source), category: normalizeCategory(s.category),
        severity: "medium", title: s.title ?? summary.slice(0, 80), description: summary, url: s.url, timestamp: s.collected_at,
    };
}

function bridgeSignalToUnified(s: { id: string; source: string; category: string; severity: "critical" | "high" | "medium" | "low"; description: string; timestamp: string }): UnifiedSignal {
    const description = s.description ?? "";
    return {
        id: s.id, origin: "bridge",
        source: normalizeSource(s.source), category: normalizeCategory(s.category),
        severity: s.severity ?? "medium", title: description.slice(0, 80), description, timestamp: s.timestamp,
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

// Cap on the dedupe memory: the signal queue is bounded to 200, so a few
// thousand remembered ids is plenty to suppress repeats without growing forever.
const MAX_SEEN_IDS = 2000;

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
    private seenSignalIds = new Set<string>();
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

    liveStats: LiveStats = { algora: null, ao: null, bridge: null };
    issueCache: AlgoraIssue[] = [];
    debateCache: AODebate[] = [];
    ideaCache: AOIdea[] = [];
    planCache: AOPlan[] = [];
    projectCache: AOProject[] = [];
    outcomeCache: BridgeOutcome[] = [];
    trustCache: BridgeTrustEntry[] = [];

    async init(): Promise<ConnState> {
        await this.poll();
        this.scheduleNext();
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

    private async tick(): Promise<void> {
        await this.poll();
        this.scheduleNext();
    }

    connectionState(): ConnState { return this.connState; }
    isConnected(): boolean { return this.connState === "live"; }
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
        if (a.status === "fulfilled") for (const s of a.value) if (!this.seenSignalIds.has(s.id)) { this.seenSignalIds.add(s.id); unified.push(algoraSignalToUnified(s)); }
        if (ao.status === "fulfilled") for (const s of ao.value) if (!this.seenSignalIds.has(s.id)) { this.seenSignalIds.add(s.id); unified.push(aoSignalToUnified(s)); }
        if (b.status === "fulfilled") for (const s of b.value) if (!this.seenSignalIds.has(s.id)) { this.seenSignalIds.add(s.id); unified.push(bridgeSignalToUnified(s)); }
        // shuffle
        for (let i = unified.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [unified[i], unified[j]] = [unified[j], unified[i]]; }
        this.signalQueue.push(...unified);
        if (this.signalQueue.length > 200) this.signalQueue = this.signalQueue.slice(-200);
        // Bound the dedupe memory: keep only ids still in the queue so it never
        // grows without limit on an always-on monitor.
        if (this.seenSignalIds.size > MAX_SEEN_IDS) {
            this.seenSignalIds = new Set(this.signalQueue.map(s => s.id));
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
