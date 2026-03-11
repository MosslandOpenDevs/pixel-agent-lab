// --- Algora API response types ---

export type AlgoraSignal = {
    id: string;
    original_id: string;
    source: string; // e.g. "social:mastodon:...", "rss:Hacker News", "github:vercel/next.js"
    timestamp: string;
    category: string; // "security", "ai", "dev", "crypto", etc.
    severity: "critical" | "high" | "medium" | "low";
    value: number;
    unit: string;
    description: string;
    metadata: string; // JSON string
    created_at: string;
};

export type AlgoraIssue = {
    id: string;
    title: string;
    description: string;
    category: string;
    priority: "critical" | "high" | "medium" | "low";
    status: string; // "in_progress", "detected", etc.
    detected_at: string;
    signal_ids: string; // JSON array string
    evidence: string; // JSON array string
    created_at: string;
};

export type AlgoraStats = {
    activeAgents: number;
    activeSessions: number;
    signalsToday: number;
    openIssues: number;
    agentsTrend: number;
    sessionsTrend: number;
    signalsTrend: number;
};

// --- AO API response types ---

export type AOSignal = {
    id: string;
    source: string; // "github", "social", "rss"
    category: string;
    title: string;
    title_ko: string | null;
    summary: string;
    summary_ko: string | null;
    url: string;
    score: number;
    collected_at: string;
};

export type AODebateMessage = {
    agent: string;
    role: string;
    content: string;
    content_ko: string | null;
};

export type AODebate = {
    id: string;
    idea_id: string | null;
    topic: string;
    context: string;
    status: string;
    phase: string;
    messages: AODebateMessage[];
    conclusion: string | null;
    conclusion_ko: string | null;
    created_at: string;
};

export type AOStatus = {
    status: string;
    timestamp: string;
    stats: {
        signals_today: number;
        debates_today: number;
        ideas_generated: number;
        plans_created: number;
        agents_active: number;
    };
};

// --- Bridge API response types ---

export type BridgeSignal = {
    id: string;
    originalId: string;
    source: string; // "api", "telemetry"
    timestamp: string;
    category: string;
    severity: "critical" | "high" | "medium" | "low";
    value: number;
    unit: string;
    description: string;
};

export type BridgeStats = {
    signals: {
        total: number;
        byCategory: Array<{ category: string; count: number }>;
        adapterCount: number;
    };
    issues: {
        total: number;
        byStatus: Array<{ status: string; count: number }>;
    };
    proposals: {
        total: number;
        active: number;
        passed: number;
        rejected: number;
    };
    outcomes: {
        totalProofs: number;
        successRate: number;
    };
};

// --- Unified signal for visualization ---

export type UnifiedSignal = {
    id: string;
    origin: "algora" | "ao" | "bridge";
    source: string; // normalized: "github", "rss", "social", "chain", "api"
    category: string; // normalized: "ai", "dev", "security", "crypto", "market", "protocol"
    severity: "critical" | "high" | "medium" | "low";
    title: string;
    description: string;
    url?: string;
    timestamp: string;
};
