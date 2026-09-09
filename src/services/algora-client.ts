import type { AlgoraSignal, AlgoraIssue, AlgoraStats } from "./types.ts";
import { getJSON } from "./http.ts";

const BASE = "/algora-api";

export async function fetchAlgoraSignals(limit = 20, signal?: AbortSignal): Promise<AlgoraSignal[]> {
    const data = await getJSON<{ signals?: AlgoraSignal[] }>(`${BASE}/signals?limit=${limit}`, "Algora signals", signal);
    return data.signals ?? [];
}

export async function fetchAlgoraIssues(limit = 20, signal?: AbortSignal): Promise<AlgoraIssue[]> {
    const data = await getJSON<{ issues?: AlgoraIssue[] }>(`${BASE}/issues?limit=${limit}`, "Algora issues", signal);
    return data.issues ?? [];
}

export async function fetchAlgoraStats(signal?: AbortSignal): Promise<AlgoraStats> {
    return getJSON<AlgoraStats>(`${BASE}/stats`, "Algora stats", signal);
}
