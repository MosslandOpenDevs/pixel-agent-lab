import type { AlgoraSignal, AlgoraIssue, AlgoraStats } from "./types.ts";

const BASE = "/algora-api";

export async function fetchAlgoraSignals(limit = 20): Promise<AlgoraSignal[]> {
    const res = await fetch(`${BASE}/signals?limit=${limit}`);
    if (!res.ok) throw new Error(`Algora signals: ${res.status}`);
    const data = await res.json();
    return data.signals ?? [];
}

export async function fetchAlgoraIssues(limit = 20): Promise<AlgoraIssue[]> {
    const res = await fetch(`${BASE}/issues?limit=${limit}`);
    if (!res.ok) throw new Error(`Algora issues: ${res.status}`);
    const data = await res.json();
    return data.issues ?? [];
}

export async function fetchAlgoraStats(): Promise<AlgoraStats> {
    const res = await fetch(`${BASE}/stats`);
    if (!res.ok) throw new Error(`Algora stats: ${res.status}`);
    return res.json();
}
