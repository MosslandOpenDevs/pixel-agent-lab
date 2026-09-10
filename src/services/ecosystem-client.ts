import type { EcosystemRegistry, RegistryService, EcosystemHealth, HealthEntry } from "./types.ts";
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
 * city.moss.land polls six of its siblings and reports their status and latency.
 * It used to be our only health source, because almost nothing else sent CORS
 * headers. That is no longer true — see `fetchServiceHealth` — so this is now
 * the *fallback*, covering the stragglers we still cannot read first-hand.
 *
 * Worth knowing when reading its numbers: it does not call the health endpoints
 * at all. It probes ordinary data URLs (`/api/headlines/today`, `/api/proposals`
 * …) and derives status from the HTTP code, which is why its `latencyMs` is 0
 * for most entries.
 */
export async function fetchEcosystemHealth(signal?: AbortSignal): Promise<EcosystemHealth | null> {
    const data = await getJSON<EcosystemHealth>(HEALTH_URL, "Ecosystem health", signal);
    return data && Array.isArray(data.services) ? data : null;
}

/**
 * Asks one service how it is doing, at the address its registry entry gives.
 *
 * This is the payoff of the health contract: every conforming service answers
 * `{status, service, timestamp}` at `/api/health` with `Access-Control-Allow-
 * Origin: *`, so the browser can read it directly instead of taking one
 * aggregator's word for six services and calling the other twenty unobserved.
 *
 * Deliberately strict about `status`. A service that answers with something
 * outside the contract's three values is not translated into one of them —
 * `null` here means "answered, but we cannot interpret the verdict", which the
 * map then draws as unmeasured rather than inventing a colour. Guessing that
 * "running" means "ok" would hide exactly the non-conformance worth seeing.
 */
export async function fetchServiceHealth(
    service: RegistryService,
    signal?: AbortSignal,
): Promise<HealthEntry | null> {
    if (!service.statusUrl) return null;
    const started = performance.now();
    const data = await getJSON<Partial<HealthEntry> & { timestamp?: string }>(
        service.statusUrl, `${service.id} health`, signal,
    );
    const status = typeof data?.status === "string" ? data.status : null;
    if (!status) return null;
    return {
        service: service.id,
        status,
        // Ours, not theirs: the round trip we just measured. The contract's
        // `timestamp` is when the service generated its answer, which is a
        // different fact and belongs in `checkedAt`.
        latencyMs: Math.round(performance.now() - started),
        checkedAt: typeof data.timestamp === "string" ? data.timestamp : undefined,
    };
}
