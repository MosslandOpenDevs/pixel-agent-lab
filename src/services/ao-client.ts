import type { AOSignal, AODebate, AOStatus, AOIdea } from "./types.ts";
import { getJSON, finiteOrNull } from "./http.ts";

const BASE = "/ao-api";

export async function fetchAOSignals(limit = 20, signal?: AbortSignal): Promise<AOSignal[]> {
    const data = await getJSON<{ signals?: AOSignal[] }>(`${BASE}/signals?limit=${limit}`, "AO signals", signal);
    // A list or nothing: anything else here would throw mid-ingest.
    return Array.isArray(data.signals) ? data.signals : [];
}

/** The latest debates. `?limit=` is the only size control AO honours here —
 *  `fields=` and the like are ignored — and each row is ~220 kB, nearly all of
 *  it `ideas_generated`, so keep the limit to what the card rotates through. */
export async function fetchAODebates(limit: number, signal?: AbortSignal): Promise<AODebate[]> {
    const data = await getJSON<{ debates?: AODebate[] }>(`${BASE}/debates?limit=${limit}`, "AO debates", signal);
    // An answer without its list is a failed read, not an empty one: the
    // caller then keeps the debates it has and tries again soon, instead of
    // showing none until the next interval. `{"debates": []}` is a real answer.
    if (!Array.isArray(data.debates)) throw new Error("AO debates: no list in the answer");
    return data.debates;
}

export async function fetchAOStatus(signal?: AbortSignal): Promise<AOStatus> {
    return getJSON<AOStatus>(`${BASE}/status`, "AO status", signal);
}

/** The latest ideas, for the belt, and AO's own count of all of them. The list
 *  is capped at `limit`, so its length is our fetch size, never a total. An
 *  answer without the list throws, as fetchAODebates does, so the belt keeps
 *  the ideas and the total it has. */
export async function fetchAOIdeas(limit = 30, signal?: AbortSignal): Promise<{ ideas: AOIdea[]; total: number | null }> {
    const data = await getJSON<{ ideas?: AOIdea[]; total?: unknown }>(`${BASE}/ideas?limit=${limit}`, "AO ideas", signal);
    if (!Array.isArray(data.ideas)) throw new Error("AO ideas: no list in the answer");
    return { ideas: data.ideas, total: finiteOrNull(data.total) };
}

/** AO's count of its projects. Nothing here shows a project itself — the
 *  funnel shows the count — so one row is asked for (AO refuses `limit=0`) and
 *  only the envelope's `total` is kept. The list used to be fetched at 20 and
 *  shown by its length, which would have stuck at 20 once AO passed it. */
export async function fetchAOProjectTotal(signal?: AbortSignal): Promise<number | null> {
    const data = await getJSON<{ total?: unknown }>(`${BASE}/projects?limit=1`, "AO projects", signal);
    return finiteOrNull(data.total);
}
