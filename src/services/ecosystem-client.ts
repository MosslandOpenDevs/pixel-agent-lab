import type { EcosystemRegistry, RegistryService, EcosystemHealth, HealthEntry } from "./types.ts";
import { getJSON, getJSONWithStatus } from "./http.ts";

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
 *
 * Read through `getJSONWithStatus`, not `getJSON`, because a service is allowed
 * to declare bad news in the status line. `signal` and `signalmap` answer 503
 * when their feed is dry — on purpose, since a deploy gate reads that code — and
 * throwing on it meant their outage arrived here as nothing at all and drew as
 * "not health-checked". A body that names its own state is believed whatever the
 * code says; only a 5xx we could not parse makes us supply the verdict.
 */
export async function fetchServiceHealth(
    service: RegistryService,
    signal?: AbortSignal,
): Promise<HealthEntry | null> {
    if (!service.statusUrl) return null;
    const started = performance.now();
    const { httpCode, data } = await getJSONWithStatus<Partial<HealthEntry> & { timestamp?: string }>(
        service.statusUrl, signal,
    );
    const declared = typeof data?.status === "string" ? data.status : null;
    // Only 5xx stands in for a missing verdict. A 5xx is the service failing, so
    // "down" is its own report by another means. A 4xx is not: it says the
    // request was wrong — a moved path, a rate limit — and the service answering
    // "no" quickly is evidence it is alive, so calling it down would be a false
    // alarm. Those stay unmeasured, which is the honest reading of a health
    // address we can no longer use.
    const status = declared ?? (httpCode >= 500 ? "down" : null);
    if (!status) return null;
    return {
        service: service.id,
        status,
        httpCode,
        // Ours, not theirs: the round trip we just measured. The contract's
        // `timestamp` is when the service generated its answer, which is a
        // different fact and belongs in `checkedAt`.
        latencyMs: Math.round(performance.now() - started),
        checkedAt: typeof data?.timestamp === "string" ? data.timestamp : undefined,
    };
}
