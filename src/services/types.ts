// --- Algora API response types ---

export type AlgoraSignal = {
    id: string;
    original_id: string;
    source: string;
    timestamp: string;
    category: string;
    severity: "critical" | "high" | "medium" | "low";
    value: number;
    unit: string;
    description: string;
    metadata: string;
    created_at: string;
};

export type AlgoraIssue = {
    id: string;
    title: string;
    description: string;
    category: string;
    priority: "critical" | "high" | "medium" | "low";
    status: string;
    detected_at: string;
    signal_ids: string;
    evidence: string;
    created_at: string;
};

export type AlgoraStats = {
    activeAgents: number;
    totalAgents?: number;
    activeSessions: number;
    signalsToday: number;
    openIssues: number;
    // Trend fields are optional: /algora-api/stats currently returns only
    // signalsTrend, so requiring the other two would misdescribe the payload.
    agentsTrend?: number;
    sessionsTrend?: number;
    signalsTrend?: number;
};

// --- AO API response types ---

export type AOSignal = {
    id: string;
    source: string;
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

export type AOIdea = {
    id: string;
    title: string;
    title_ko: string | null;
    summary: string;
    summary_ko: string | null;
    score: number;
    status: string;
    source_type: string;
    created_at: string;
};

export type AOPlan = {
    id: string;
    idea_id: string;
    title: string;
    title_ko: string | null;
    final_plan: string;
    score: number;
    status: string;
    created_at: string;
};

export type AOProject = {
    id: string;
    plan_id: string;
    name: string;
    tech_stack: string;
    status: string;
    created_at: string;
};

// --- Bridge API response types ---

export type BridgeSignal = {
    id: string;
    originalId: string;
    source: string;
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
        // null when no proof has been recorded yet — distinct from 0%, which
        // would mean every recorded outcome failed.
        successRate: number | null;
    };
    // Bridge counts simulated rows separately from real ones; `total` above is
    // real-only, and these are a disjoint parallel bucket (verified against the
    // live payload: each byCategory list sums to its own total).
    synthetic?: {
        total: number;
        byCategory?: Array<{ category: string; count: number }>;
    };
};

// Response shape of /bridge-api/proposals. Kept as the documented contract even
// though nothing fetches it today: the endpoint returns the full collection
// (~3.3 MB) and ignores ?limit, so it is not worth polling until the API grows
// server-side pagination. Proposal counts come from /bridge-api/stats instead.
export type BridgeProposal = {
    id: string;
    title: string;
    status: string;
    votingStartsAt: string;
    votingEndsAt: string;
    created_at: string;
};

export type BridgeOutcome = {
    id: string;
    proposalId: string;
    status: string;
    success: boolean;
    proofHash: string;
    created_at: string;
};

export type BridgeTrustEntry = {
    entityId: string;
    entityType: string;
    score: number;
    totalDecisions: number;
    successfulDecisions: number;
};

// --- Unified signal for visualization ---

export type UnifiedSignal = {
    id: string;
    origin: "algora" | "ao" | "bridge";
    source: string;
    category: string;
    severity: "critical" | "high" | "medium" | "low";
    title: string;
    description: string;
    url?: string;
    timestamp: string;
};
