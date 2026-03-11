import type { AOSignal, AODebate, AOStatus, AOIdea, AOPlan, AOProject } from "./types.ts";

const BASE = "/ao-api";

export async function fetchAOSignals(limit = 20): Promise<AOSignal[]> {
    const res = await fetch(`${BASE}/signals?limit=${limit}`);
    if (!res.ok) throw new Error(`AO signals: ${res.status}`);
    const data = await res.json();
    return data.signals ?? [];
}

export async function fetchAODebates(limit = 10): Promise<AODebate[]> {
    const res = await fetch(`${BASE}/debates?limit=${limit}`);
    if (!res.ok) throw new Error(`AO debates: ${res.status}`);
    const data = await res.json();
    return data.debates ?? [];
}

export async function fetchAODebateDetail(id: string): Promise<AODebate> {
    const res = await fetch(`${BASE}/debates/${id}`);
    if (!res.ok) throw new Error(`AO debate ${id}: ${res.status}`);
    return res.json();
}

export async function fetchAOStatus(): Promise<AOStatus> {
    const res = await fetch(`${BASE}/status`);
    if (!res.ok) throw new Error(`AO status: ${res.status}`);
    return res.json();
}

export async function fetchAOIdeas(limit = 30): Promise<AOIdea[]> {
    const res = await fetch(`${BASE}/ideas?limit=${limit}`);
    if (!res.ok) throw new Error(`AO ideas: ${res.status}`);
    const data = await res.json();
    return data.ideas ?? [];
}

export async function fetchAOPlans(limit = 20): Promise<AOPlan[]> {
    const res = await fetch(`${BASE}/plans?limit=${limit}`);
    if (!res.ok) throw new Error(`AO plans: ${res.status}`);
    const data = await res.json();
    return data.plans ?? [];
}

export async function fetchAOProjects(limit = 20): Promise<AOProject[]> {
    const res = await fetch(`${BASE}/projects?limit=${limit}`);
    if (!res.ok) throw new Error(`AO projects: ${res.status}`);
    const data = await res.json();
    return data.projects ?? [];
}
