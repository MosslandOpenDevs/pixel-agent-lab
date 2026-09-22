import type { BridgeSignal, BridgeStats, BridgeOutcome, BridgeTrustEntry } from "./types.ts";
import { getJSON } from "./http.ts";

const BASE = "/bridge-api";

export async function fetchBridgeSignals(limit = 20, signal?: AbortSignal): Promise<BridgeSignal[]> {
    const data = await getJSON<{ signals?: BridgeSignal[] }>(`${BASE}/signals?limit=${limit}`, "Bridge signals", signal);
    // A list or nothing: anything else here would throw mid-ingest.
    return Array.isArray(data.signals) ? data.signals : [];
}

export async function fetchBridgeStats(signal?: AbortSignal): Promise<BridgeStats> {
    return getJSON<BridgeStats>(`${BASE}/stats`, "Bridge stats", signal);
}

// The two detail lists below throw when an answer carries no list, rather than
// reading it as an empty one. They refresh every few minutes, and an empty
// success would replace the outcomes or trust already on screen with nothing
// until the next interval; a failed read keeps them and is retried soon. An
// empty list that is actually sent (`{"outcomes": []}`) is a real answer.

export async function fetchBridgeOutcomes(limit = 20, signal?: AbortSignal): Promise<BridgeOutcome[]> {
    const data = await getJSON<{ outcomes?: BridgeOutcome[] }>(`${BASE}/outcomes`, "Bridge outcomes", signal);
    const list = data.outcomes;
    if (!Array.isArray(list)) throw new Error("Bridge outcomes: no list in the answer");
    return list.slice(0, limit);
}

export async function fetchBridgeTrustLeaderboard(type = "agent", signal?: AbortSignal): Promise<BridgeTrustEntry[]> {
    const data = await getJSON<{ leaderboard?: BridgeTrustEntry[] } | BridgeTrustEntry[]>(
        `${BASE}/trust/leaderboard/${type}`, "Bridge trust", signal);
    const list = Array.isArray(data) ? data : data.leaderboard;
    if (!Array.isArray(list)) throw new Error("Bridge trust: no list in the answer");
    return list;
}
