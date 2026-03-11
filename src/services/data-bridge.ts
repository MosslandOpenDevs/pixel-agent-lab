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
    BridgeProposal,
    BridgeOutcome,
    BridgeTrustEntry,
    UnifiedSignal,
} from "./types.ts";
import { fetchAlgoraSignals, fetchAlgoraIssues, fetchAlgoraStats } from "./algora-client.ts";
import { fetchAOSignals, fetchAODebates, fetchAOStatus, fetchAOIdeas, fetchAOPlans, fetchAOProjects } from "./ao-client.ts";
import { fetchBridgeSignals, fetchBridgeStats, fetchBridgeProposals, fetchBridgeOutcomes, fetchBridgeTrustLeaderboard } from "./bridge-client.ts";

// --- Source normalizer ---
function normalizeSource(raw: string): string {
    const l = raw.toLowerCase();
    if (l.includes("github")) return "github";
    if (l.includes("rss") || l.includes("news")) return "rss";
    if (l.includes("social") || l.includes("mastodon") || l.includes("twitter") || l.includes("reddit")) return "social";
    if (l.includes("chain") || l.includes("blockchain") || l.includes("etherscan") || l.includes("telemetry")) return "chain";
    if (l === "api") return "chain";
    return "rss";
}

function normalizeCategory(raw: string): string {
    const l = raw.toLowerCase();
    if (l.includes("ai") || l.includes("ml") || l.includes("llm")) return "ai";
    if (l.includes("dev") || l.includes("protocol") || l.includes("github_commit")) return "dev";
    if (l.includes("security") || l.includes("infosec")) return "security";
    if (l.includes("crypto") || l.includes("defi") || l.includes("web3") || l.includes("moc") || l.includes("token") || l.includes("market") || l.includes("price") || l.includes("treasury")) return "crypto";
    return "dev";
}

function algoraSignalToUnified(s: AlgoraSignal): UnifiedSignal {
    let meta: { title?: string; link?: string; url?: string } = {};
    try { meta = JSON.parse(s.metadata); } catch { /* ignore */ }
    return {
        id: s.id, origin: "algora",
        source: normalizeSource(s.source), category: normalizeCategory(s.category),
        severity: s.severity, title: meta.title ?? s.description.slice(0, 80),
        description: s.description, url: meta.link ?? meta.url, timestamp: s.timestamp,
    };
}

function aoSignalToUnified(s: { id: string; source: string; category: string; title: string; summary: string; url: string; collected_at: string }): UnifiedSignal {
    return {
        id: s.id, origin: "ao",
        source: normalizeSource(s.source), category: normalizeCategory(s.category),
        severity: "medium", title: s.title, description: s.summary, url: s.url, timestamp: s.collected_at,
    };
}

function bridgeSignalToUnified(s: { id: string; source: string; category: string; severity: "critical" | "high" | "medium" | "low"; description: string; timestamp: string }): UnifiedSignal {
    return {
        id: s.id, origin: "bridge",
        source: normalizeSource(s.source), category: normalizeCategory(s.category),
        severity: s.severity, title: s.description.slice(0, 80), description: s.description, timestamp: s.timestamp,
    };
}

// --- Live stats ---
export type LiveStats = {
    algora: AlgoraStats | null;
    ao: AOStatus | null;
    bridge: BridgeStats | null;
};

// --- Data Bridge ---
export class DataBridge {
    private signalQueue: UnifiedSignal[] = [];
    private seenSignalIds = new Set<string>();
    private pollTimer: ReturnType<typeof setInterval> | null = null;
    private connected = false;

    liveStats: LiveStats = { algora: null, ao: null, bridge: null };
    issueCache: AlgoraIssue[] = [];
    debateCache: AODebate[] = [];
    ideaCache: AOIdea[] = [];
    planCache: AOPlan[] = [];
    projectCache: AOProject[] = [];
    proposalCache: BridgeProposal[] = [];
    outcomeCache: BridgeOutcome[] = [];
    trustCache: BridgeTrustEntry[] = [];

    async init(): Promise<boolean> {
        try {
            await this.poll();
            this.connected = true;
            this.pollTimer = setInterval(() => this.poll(), 15_000);
            return true;
        } catch (e) {
            console.warn("[DataBridge] init failed:", e);
            this.connected = false;
            return false;
        }
    }

    isConnected(): boolean { return this.connected; }
    queueSize(): number { return this.signalQueue.length; }

    private async poll(): Promise<void> {
        const results = await Promise.allSettled([
            this.pollSignals(), this.pollIssues(), this.pollDebates(),
            this.pollStats(), this.pollAOPipeline(), this.pollBridgeGovernance(),
        ]);
        this.connected = results[0].status === "fulfilled";
    }

    private async pollSignals(): Promise<void> {
        const [a, ao, b] = await Promise.allSettled([
            fetchAlgoraSignals(30), fetchAOSignals(20), fetchBridgeSignals(20),
        ]);
        const unified: UnifiedSignal[] = [];
        if (a.status === "fulfilled") for (const s of a.value) if (!this.seenSignalIds.has(s.id)) { this.seenSignalIds.add(s.id); unified.push(algoraSignalToUnified(s)); }
        if (ao.status === "fulfilled") for (const s of ao.value) if (!this.seenSignalIds.has(s.id)) { this.seenSignalIds.add(s.id); unified.push(aoSignalToUnified(s)); }
        if (b.status === "fulfilled") for (const s of b.value) if (!this.seenSignalIds.has(s.id)) { this.seenSignalIds.add(s.id); unified.push(bridgeSignalToUnified(s)); }
        // shuffle
        for (let i = unified.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [unified[i], unified[j]] = [unified[j], unified[i]]; }
        this.signalQueue.push(...unified);
        if (this.signalQueue.length > 200) this.signalQueue = this.signalQueue.slice(-200);
    }

    private async pollIssues(): Promise<void> { try { this.issueCache = await fetchAlgoraIssues(30); } catch { /* stale */ } }
    private async pollDebates(): Promise<void> { try { this.debateCache = await fetchAODebates(10); } catch { /* stale */ } }
    private async pollStats(): Promise<void> {
        const [a, ao, b] = await Promise.allSettled([fetchAlgoraStats(), fetchAOStatus(), fetchBridgeStats()]);
        if (a.status === "fulfilled") this.liveStats.algora = a.value;
        if (ao.status === "fulfilled") this.liveStats.ao = ao.value;
        if (b.status === "fulfilled") this.liveStats.bridge = b.value;
    }
    private async pollAOPipeline(): Promise<void> {
        const [ideas, plans, projects] = await Promise.allSettled([fetchAOIdeas(30), fetchAOPlans(20), fetchAOProjects(20)]);
        if (ideas.status === "fulfilled") this.ideaCache = ideas.value;
        if (plans.status === "fulfilled") this.planCache = plans.value;
        if (projects.status === "fulfilled") this.projectCache = projects.value;
    }
    private async pollBridgeGovernance(): Promise<void> {
        const [props, outs, trust] = await Promise.allSettled([fetchBridgeProposals(), fetchBridgeOutcomes(), fetchBridgeTrustLeaderboard()]);
        if (props.status === "fulfilled") this.proposalCache = props.value;
        if (outs.status === "fulfilled") this.outcomeCache = outs.value;
        if (trust.status === "fulfilled") this.trustCache = trust.value;
    }

    nextSignal(): UnifiedSignal | null { return this.signalQueue.shift() ?? null; }

    getRandomDebate(): { topic: string; snippet: string } | null {
        if (this.debateCache.length === 0) return null;
        const d = this.debateCache[Math.floor(Math.random() * this.debateCache.length)];
        const snippet = d.messages?.length > 0
            ? d.messages.slice(0, 2).map(m => `${m.agent}: ${(m.content_ko ?? m.content).slice(0, 50)}`).join(" | ")
            : d.context.slice(0, 100);
        return { topic: d.topic.slice(0, 70), snippet };
    }

    destroy(): void { if (this.pollTimer) clearInterval(this.pollTimer); }
}
