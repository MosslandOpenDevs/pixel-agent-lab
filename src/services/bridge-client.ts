import type { BridgeSignal, BridgeStats, BridgeProposal, BridgeOutcome, BridgeTrustEntry } from "./types.ts";

const BASE = "/bridge-api";

export async function fetchBridgeSignals(limit = 20): Promise<BridgeSignal[]> {
    const res = await fetch(`${BASE}/signals?limit=${limit}`);
    if (!res.ok) throw new Error(`Bridge signals: ${res.status}`);
    const data = await res.json();
    return data.signals ?? [];
}

export async function fetchBridgeStats(): Promise<BridgeStats> {
    const res = await fetch(`${BASE}/stats`);
    if (!res.ok) throw new Error(`Bridge stats: ${res.status}`);
    return res.json();
}

export async function fetchBridgeProposals(limit = 20): Promise<BridgeProposal[]> {
    const res = await fetch(`${BASE}/proposals`);
    if (!res.ok) throw new Error(`Bridge proposals: ${res.status}`);
    const data = await res.json();
    return (data.proposals ?? []).slice(0, limit);
}

export async function fetchBridgeOutcomes(limit = 20): Promise<BridgeOutcome[]> {
    const res = await fetch(`${BASE}/outcomes`);
    if (!res.ok) throw new Error(`Bridge outcomes: ${res.status}`);
    const data = await res.json();
    return (data.outcomes ?? []).slice(0, limit);
}

export async function fetchBridgeTrustLeaderboard(type = "agent"): Promise<BridgeTrustEntry[]> {
    const res = await fetch(`${BASE}/trust/leaderboard/${type}`);
    if (!res.ok) throw new Error(`Bridge trust: ${res.status}`);
    const data = await res.json();
    const list = data.leaderboard ?? data;
    return Array.isArray(list) ? list : [];
}
