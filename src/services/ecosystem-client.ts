import type { EcosystemRegistry, RegistryService, EcosystemHealth } from "./types.ts";
import { getJSON } from "./http.ts";

// Both of these are served with `Access-Control-Allow-Origin: *`, so they are
// fetched cross-origin directly and need no entry in the monitor's nginx proxy.
const REGISTRY_URL = "https://links.moss.land/ecosystem-registry.json";
const HEALTH_URL = "https://city.moss.land/api/health";

/** The MIP-1 registry: which services exist, and what lifecycle each is in. */
export async function fetchRegistry(signal?: AbortSignal): Promise<RegistryService[]> {
    const data = await getJSON<EcosystemRegistry>(REGISTRY_URL, "Ecosystem registry", signal);
    const services = Array.isArray(data?.services) ? data.services : [];
    return services.filter(s => s && !s.hidden);
}

/**
 * city.moss.land already polls its siblings and reports per-service status and
 * latency, so one request covers every service it watches. Using it beats
 * fanning out to each `statusUrl` ourselves: most of those do not send CORS
 * headers, and this is a single cached round trip.
 */
export async function fetchEcosystemHealth(signal?: AbortSignal): Promise<EcosystemHealth | null> {
    const data = await getJSON<EcosystemHealth>(HEALTH_URL, "Ecosystem health", signal);
    return data && Array.isArray(data.services) ? data : null;
}
