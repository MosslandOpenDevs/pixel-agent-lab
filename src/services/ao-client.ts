import type { AOSignal, AODebate, AOStatus, AOIdea, AOPlan, AOProject } from "./types.ts";
import { getJSON } from "./http.ts";

const BASE = "/ao-api";

export async function fetchAOSignals(limit = 20, signal?: AbortSignal): Promise<AOSignal[]> {
    const data = await getJSON<{ signals?: AOSignal[] }>(`${BASE}/signals?limit=${limit}`, "AO signals", signal);
    return data.signals ?? [];
}

export async function fetchAODebates(limit = 10, signal?: AbortSignal): Promise<AODebate[]> {
    const data = await getJSON<{ debates?: AODebate[] }>(`${BASE}/debates?limit=${limit}`, "AO debates", signal);
    return data.debates ?? [];
}

export async function fetchAODebateDetail(id: string, signal?: AbortSignal): Promise<AODebate> {
    return getJSON<AODebate>(`${BASE}/debates/${id}`, `AO debate ${id}`, signal);
}

export async function fetchAOStatus(signal?: AbortSignal): Promise<AOStatus> {
    return getJSON<AOStatus>(`${BASE}/status`, "AO status", signal);
}

export async function fetchAOIdeas(limit = 30, signal?: AbortSignal): Promise<AOIdea[]> {
    const data = await getJSON<{ ideas?: AOIdea[] }>(`${BASE}/ideas?limit=${limit}`, "AO ideas", signal);
    return data.ideas ?? [];
}

export async function fetchAOPlans(limit = 20, signal?: AbortSignal): Promise<AOPlan[]> {
    const data = await getJSON<{ plans?: AOPlan[] }>(`${BASE}/plans?limit=${limit}`, "AO plans", signal);
    return data.plans ?? [];
}

export async function fetchAOProjects(limit = 20, signal?: AbortSignal): Promise<AOProject[]> {
    const data = await getJSON<{ projects?: AOProject[] }>(`${BASE}/projects?limit=${limit}`, "AO projects", signal);
    return data.projects ?? [];
}
