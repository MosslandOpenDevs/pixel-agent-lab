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
    /** JSON text. Nullable upstream: a signal posted without metadata stores
     *  NULL, so this is not always there to parse. */
    metadata: string | null;
    created_at: string;
};

// Response shape of /algora-api/issues. Kept as the documented contract even
// though nothing fetches it today: the list was polled every cycle into a cache
// that nothing read. The sidebar's Open Issues figure comes from
// /algora-api/stats instead, which is Algora's own count rather than the size
// of a 30-item page.
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

/** One row of /ao-api/debates, as the list returns it. The list carries no
 *  transcript — `message_count` stands in for the messages, and the fields a
 *  detail view would have (`messages`, `conclusion`) are not in it. Each row also
 *  carries `ideas_generated` and `final_plan`, about 95% of its ~220 kB, which
 *  nothing here reads and so are not declared. */
export type AODebate = {
    id: string;
    idea_id: string | null;
    topic: string;
    context: string;
    status: string;
    phase: string;
    started_at: string;
    completed_at: string | null;
    message_count: number;
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

// Response shape of /ao-api/plans. Kept as the documented contract even though
// nothing fetches it today: 20 plans are ~237 kB gzip, almost all of it
// `final_plan` text, and the only thing ever read from them was the list's
// length — our fetch cap, shown as if it were a total. AO's own count is
// `stats.plans_created` in /ao-api/status.
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

// Response rows of /ao-api/projects. Only the envelope's `total` is read (see
// fetchAOProjectTotal); the rows are kept here as the documented contract.
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

/** What the Algora belt reads from a signal, and nothing more. It used to carry
 *  source, category, url, description and timestamp as well, filled by
 *  substring-matching normalizers that nothing read — and that were wrong on
 *  live data (`moc_blockchain` classified as "ai"). If a view ever needs a
 *  category, match exact tokens and test it against the live values. */
export type UnifiedSignal = {
    id: string;
    origin: "algora" | "ao" | "bridge";
    severity: "critical" | "high" | "medium" | "low";
    title: string;
};

// --- links.moss.land ecosystem registry (MIP-1 source of truth) ---

/** One entry of https://links.moss.land/ecosystem-registry.json `services[]`.
 *  Only the fields this app uses are declared; the payload carries more. */
export type RegistryService = {
    id: string;
    name: string;
    domain: string;
    url: string;
    /** Editorial grouping, e.g. "official" | "labs" | "developer" | "third_party". */
    tier: string;
    /** Layout grouping: official | ecosystem | markets | developers | participation. */
    section: string;
    /** Operational state: operational | degraded | beta | paused | offline | deprecated. */
    status: string;
    /** MIP-1 lifecycle. Absent on 13 of 30 entries, so it is genuinely optional —
     *  render "unspecified", never a default like "lab". */
    lifecycle?: "beta" | "lab" | "archive" | string;
    /** Health endpoint, per the ecosystem health contract (links/HEALTH_CONTRACT.md).
     *  16 of 30 entries have one; the rest are artifacts, channels and third-party
     *  links that have nothing to report. */
    statusUrl?: string;
    /** True on entries that are a *file*, not a running thing — llms.txt,
     *  sitemap.xml, ecosystem-registry.json. The registry says so itself, and it
     *  is the difference between "can be down" and "can only be missing". */
    artifact?: boolean;
    /** "mossland" for everything we run; "third-party" for the exchange listings. */
    owner?: string;
    maintainer?: string;
    hidden?: boolean;
};

export type EcosystemRegistry = {
    version: string;
    generatedAt: string;
    lifecycleReviewedAt?: string;
    services: RegistryService[];
};

// --- city.moss.land cross-service health aggregator ---

/** One health reading. Built by ecosystem-client from a first-hand answer or
 *  from one of city's entries, never cast from a response, so these types hold
 *  at runtime too. */
export type HealthEntry = {
    service: string;
    /** "ok" | "degraded" | "down" by the contract; any other string the
     *  service declared is kept as-is rather than translated. */
    status: string;
    httpCode?: number;
    latencyMs?: number;
    checkedAt?: string;
};

/** city's aggregate, reduced to what this monitor reads. Its `summary` counts
 *  are not carried: nothing here shows them, and the entries are the evidence. */
export type EcosystemHealth = {
    checkedAt?: string;
    services: HealthEntry[];
};
