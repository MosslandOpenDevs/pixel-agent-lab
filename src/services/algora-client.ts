import type { AlgoraSignal, AlgoraStats } from "./types.ts";
import { getJSON } from "./http.ts";

const BASE = "/algora-api";

export async function fetchAlgoraSignals(limit = 20, signal?: AbortSignal): Promise<AlgoraSignal[]> {
    const data = await getJSON<{ signals?: AlgoraSignal[] }>(`${BASE}/signals?limit=${limit}`, "Algora signals", signal);
    // A list or nothing: anything else here would throw mid-ingest.
    return Array.isArray(data.signals) ? data.signals : [];
}

export async function fetchAlgoraStats(signal?: AbortSignal): Promise<AlgoraStats> {
    // A successful static snapshot is reachable, but is not a live data feed.
    // Bypass a cached pre-transition response, and carry the archive server's
    // marker without changing any of its preserved JSON fields.
    const res = await fetch(`${BASE}/stats`, { signal, cache: "no-store" });
    if (!res.ok) throw new Error(`Algora stats: ${res.status}`);
    const data = await res.json() as AlgoraStats;
    return res.headers.has("x-algora-archive") ? { ...data, archived: true } : data;
}
