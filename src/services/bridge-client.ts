import type { BridgeSignal, BridgeStats } from "./types.ts";

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
