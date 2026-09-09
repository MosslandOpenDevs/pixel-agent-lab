import type { BridgeSignal, BridgeStats, BridgeOutcome, BridgeTrustEntry } from "./types.ts";
import { getJSON } from "./http.ts";

const BASE = "/bridge-api";

export async function fetchBridgeSignals(limit = 20, signal?: AbortSignal): Promise<BridgeSignal[]> {
    const data = await getJSON<{ signals?: BridgeSignal[] }>(`${BASE}/signals?limit=${limit}`, "Bridge signals", signal);
    return data.signals ?? [];
}

export async function fetchBridgeStats(signal?: AbortSignal): Promise<BridgeStats> {
    return getJSON<BridgeStats>(`${BASE}/stats`, "Bridge stats", signal);
}

export async function fetchBridgeOutcomes(limit = 20, signal?: AbortSignal): Promise<BridgeOutcome[]> {
    const data = await getJSON<{ outcomes?: BridgeOutcome[] }>(`${BASE}/outcomes`, "Bridge outcomes", signal);
    return (data.outcomes ?? []).slice(0, limit);
}

export async function fetchBridgeTrustLeaderboard(type = "agent", signal?: AbortSignal): Promise<BridgeTrustEntry[]> {
    const data = await getJSON<{ leaderboard?: BridgeTrustEntry[] } | BridgeTrustEntry[]>(
        `${BASE}/trust/leaderboard/${type}`, "Bridge trust", signal);
    const list = Array.isArray(data) ? data : data.leaderboard;
    return Array.isArray(list) ? list : [];
}
