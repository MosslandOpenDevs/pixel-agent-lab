import type {
    AlgoraSignal,
    AlgoraIssue,
    AODebate,
    AlgoraStats,
    AOStatus,
    BridgeStats,
    UnifiedSignal,
} from "./types.ts";
import { fetchAlgoraSignals, fetchAlgoraIssues, fetchAlgoraStats } from "./algora-client.ts";
import { fetchAOSignals, fetchAODebates, fetchAOStatus } from "./ao-client.ts";
import { fetchBridgeSignals, fetchBridgeStats } from "./bridge-client.ts";

// --- Source normalizer ---

function normalizeSource(raw: string): string {
    const lower = raw.toLowerCase();
    if (lower.startsWith("github") || lower.includes("github")) return "github";
    if (lower.startsWith("rss") || lower.includes("rss") || lower.includes("news")) return "rss";
    if (
        lower.startsWith("social") ||
        lower.includes("mastodon") ||
        lower.includes("twitter") ||
        lower.includes("reddit")
    )
        return "social";
    if (
        lower.includes("chain") ||
        lower.includes("blockchain") ||
        lower.includes("etherscan") ||
        lower.includes("onchain") ||
        lower.includes("telemetry")
    )
        return "chain";
    if (lower === "api") return "chain";
    return "rss"; // fallback
}

// --- Category normalizer ---

function normalizeCategory(raw: string): string {
    const lower = raw.toLowerCase();
    if (lower.includes("ai") || lower.includes("ml") || lower.includes("llm")) return "ai";
    if (lower.includes("dev") || lower.includes("protocol") || lower.includes("github_commit"))
        return "dev";
    if (lower.includes("security") || lower.includes("infosec") || lower.includes("vulnerability"))
        return "security";
    if (
        lower.includes("crypto") ||
        lower.includes("defi") ||
        lower.includes("web3") ||
        lower.includes("moc") ||
        lower.includes("token") ||
        lower.includes("market") ||
        lower.includes("price") ||
        lower.includes("treasury")
    )
        return "crypto";
    return "dev"; // fallback
}

// --- Convert Algora signals ---

function algoraSignalToUnified(s: AlgoraSignal): UnifiedSignal {
    let meta: { title?: string; link?: string; url?: string } = {};
    try {
        meta = JSON.parse(s.metadata);
    } catch {
        /* ignore */
    }
    return {
        id: s.id,
        origin: "algora",
        source: normalizeSource(s.source),
        category: normalizeCategory(s.category),
        severity: s.severity,
        title: meta.title ?? s.description.slice(0, 80),
        description: s.description,
        url: meta.link ?? meta.url,
        timestamp: s.timestamp,
    };
}

// --- Convert AO signals ---

function aoSignalToUnified(s: { id: string; source: string; category: string; title: string; summary: string; url: string; collected_at: string }): UnifiedSignal {
    return {
        id: s.id,
        origin: "ao",
        source: normalizeSource(s.source),
        category: normalizeCategory(s.category),
        severity: "medium",
        title: s.title,
        description: s.summary,
        url: s.url,
        timestamp: s.collected_at,
    };
}

// --- Convert Bridge signals ---

function bridgeSignalToUnified(s: { id: string; source: string; category: string; severity: "critical" | "high" | "medium" | "low"; description: string; timestamp: string }): UnifiedSignal {
    return {
        id: s.id,
        origin: "bridge",
        source: normalizeSource(s.source),
        category: normalizeCategory(s.category),
        severity: s.severity,
        title: s.description.slice(0, 80),
        description: s.description,
        timestamp: s.timestamp,
    };
}

// --- Live stats ---

export type LiveStats = {
    algora: AlgoraStats | null;
    ao: AOStatus | null;
    bridge: BridgeStats | null;
};

// --- Data Bridge singleton ---

export class DataBridge {
    private signalQueue: UnifiedSignal[] = [];
    private issueCache: AlgoraIssue[] = [];
    private debateCache: AODebate[] = [];
    private seenSignalIds = new Set<string>();
    private pollTimer: ReturnType<typeof setInterval> | null = null;
    private connected = false;
    liveStats: LiveStats = { algora: null, ao: null, bridge: null };

    async init(): Promise<boolean> {
        try {
            await this.poll();
            this.connected = true;
            this.pollTimer = setInterval(() => this.poll(), 15_000);
            return true;
        } catch (e) {
            console.warn("[DataBridge] init failed, falling back to mock:", e);
            this.connected = false;
            return false;
        }
    }

    isConnected(): boolean {
        return this.connected;
    }

    private async poll(): Promise<void> {
        const results = await Promise.allSettled([
            this.pollSignals(),
            this.pollIssues(),
            this.pollDebates(),
            this.pollStats(),
        ]);
        // If all signal fetches fail, mark disconnected
        const signalResult = results[0];
        if (signalResult.status === "rejected") {
            this.connected = false;
        } else {
            this.connected = true;
        }
    }

    private async pollSignals(): Promise<void> {
        const [algoraSignals, aoSignals, bridgeSignals] = await Promise.allSettled([
            fetchAlgoraSignals(30),
            fetchAOSignals(20),
            fetchBridgeSignals(20),
        ]);

        const unified: UnifiedSignal[] = [];

        if (algoraSignals.status === "fulfilled") {
            for (const s of algoraSignals.value) {
                if (!this.seenSignalIds.has(s.id)) {
                    this.seenSignalIds.add(s.id);
                    unified.push(algoraSignalToUnified(s));
                }
            }
        }
        if (aoSignals.status === "fulfilled") {
            for (const s of aoSignals.value) {
                if (!this.seenSignalIds.has(s.id)) {
                    this.seenSignalIds.add(s.id);
                    unified.push(aoSignalToUnified(s));
                }
            }
        }
        if (bridgeSignals.status === "fulfilled") {
            for (const s of bridgeSignals.value) {
                if (!this.seenSignalIds.has(s.id)) {
                    this.seenSignalIds.add(s.id);
                    unified.push(bridgeSignalToUnified(s));
                }
            }
        }

        // Shuffle so we get a mix of sources
        for (let i = unified.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [unified[i], unified[j]] = [unified[j], unified[i]];
        }

        this.signalQueue.push(...unified);

        // Keep queue manageable
        if (this.signalQueue.length > 200) {
            this.signalQueue = this.signalQueue.slice(-200);
        }
    }

    private async pollIssues(): Promise<void> {
        try {
            this.issueCache = await fetchAlgoraIssues(30);
        } catch {
            /* keep stale cache */
        }
    }

    private async pollDebates(): Promise<void> {
        try {
            this.debateCache = await fetchAODebates(10);
        } catch {
            /* keep stale cache */
        }
    }

    private async pollStats(): Promise<void> {
        const [algora, ao, bridge] = await Promise.allSettled([
            fetchAlgoraStats(),
            fetchAOStatus(),
            fetchBridgeStats(),
        ]);
        if (algora.status === "fulfilled") this.liveStats.algora = algora.value;
        if (ao.status === "fulfilled") this.liveStats.ao = ao.value;
        if (bridge.status === "fulfilled") this.liveStats.bridge = bridge.value;
    }

    // --- Public interface for SpaceHubScene ---

    /** Pop the next signal from queue. Returns null if empty. */
    nextSignal(): UnifiedSignal | null {
        return this.signalQueue.shift() ?? null;
    }

    queueSize(): number {
        return this.signalQueue.length;
    }

    /**
     * Decide if a signal should be approved by Algora FILTER.
     * Uses real issue cache: if issues exist for the same category, approve.
     * Falls back to severity-based logic.
     */
    shouldApprove(signal: UnifiedSignal): boolean {
        // Critical/high always approved
        if (signal.severity === "critical" || signal.severity === "high") return true;

        // Check if there's a real issue matching this category
        const hasMatchingIssue = this.issueCache.some(
            (issue) =>
                issue.category.toLowerCase().includes(signal.category) ||
                signal.category.includes(issue.category.toLowerCase())
        );
        if (hasMatchingIssue) return true;

        // Medium: 70% approval, Low: 30% approval
        if (signal.severity === "medium") return Math.random() < 0.7;
        return Math.random() < 0.3;
    }

    /**
     * Get debate context for AO discussion display.
     * Returns the most recent debate data if available.
     */
    getDebateContext(): { topic: string; snippet: string; conclusion: string | null } | null {
        if (this.debateCache.length === 0) return null;
        const debate = this.debateCache[Math.floor(Math.random() * this.debateCache.length)];
        const snippet =
            debate.messages && debate.messages.length > 0
                ? debate.messages
                      .slice(0, 3)
                      .map((m) => `${m.agent}: ${(m.content_ko ?? m.content).slice(0, 60)}`)
                      .join("\n")
                : debate.context.slice(0, 120);
        return {
            topic: debate.topic.slice(0, 80),
            snippet,
            conclusion: debate.conclusion_ko ?? debate.conclusion,
        };
    }

    /**
     * Decide route based on AO debate conclusions and signal severity.
     */
    decideRoute(severity: "critical" | "high" | "medium" | "low"): "Immediate Action" | "Monitor" | "Defer" {
        if (severity === "critical" || severity === "high") return "Immediate Action";
        if (severity === "medium") return Math.random() > 0.4 ? "Monitor" : "Immediate Action";
        return Math.random() > 0.5 ? "Defer" : "Monitor";
    }

    destroy(): void {
        if (this.pollTimer) clearInterval(this.pollTimer);
    }
}
