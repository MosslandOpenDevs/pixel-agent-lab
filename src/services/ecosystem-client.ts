import type { EcosystemRegistry, RegistryService, EcosystemHealth, HealthEntry } from "./types.ts";
import { getJSON, getJSONWithStatus, isRecord } from "./http.ts";

// Both of these are served with `Access-Control-Allow-Origin: *`, so they are
// fetched cross-origin directly and need no entry in the monitor's nginx proxy.
// They must stay inside the page's Content-Security-Policy `connect-src`
// (deploy/nginx.conf.example, `location /`), though, as must every registry
// `statusUrl` that fetchServiceHealth reads. Development and CI send no CSP, so
// an address moved to another host passes every check here and is blocked in
// production only, where the fetch throws. What that costs depends on which
// address moved. The registry: it never loads, so nothing is drawn, and the
// map and the sidebar say "Registry unreachable — retrying" on every retry.
// The aggregate: city reads as unmeasured, and no other service has city's
// reading to fall back on. A statusUrl: that service falls back to city's
// second-hand reading if city probes it, or else reads as unmeasured. None of
// these shows a service as down, and nothing on the page names the policy as
// the cause.
const REGISTRY_URL = "https://links.moss.land/ecosystem-registry.json";
/** city.moss.land's aggregate — which is also city's own registry `statusUrl`. */
export const HEALTH_URL = "https://city.moss.land/api/health";
/** The registry id of the service that publishes HEALTH_URL. */
export const AGGREGATOR_ID = "city";

/** The MIP-1 registry: which services exist, and what lifecycle each is in. */
export async function fetchRegistry(signal?: AbortSignal): Promise<RegistryService[]> {
    const data = await getJSON<EcosystemRegistry>(REGISTRY_URL, "Ecosystem registry", signal);
    const services: unknown[] = Array.isArray(data?.services) ? data.services : [];
    // A row with no string id cannot be keyed, graded or matched to a health
    // reading, so it is not a registry entry this map can draw.
    return services.filter((s): s is RegistryService =>
        isRecord(s) && typeof s.id === "string" && !s.hidden);
}

/**
 * What one read of city's aggregate yields. The same answer is two readings:
 * city's reports on its siblings, and city's own health — because the
 * aggregate's address is also city's registry `statusUrl`.
 */
export type AggregateReading = {
    /** city's reports on its siblings. Only a 2xx that carried a list is
     *  believed as a report on anyone else. */
    aggregate: EcosystemHealth | null;
    /** What the same answer says about city itself, by exactly the rule
     *  `fetchServiceHealth` applies to any service: a declared non-empty
     *  string `status`, else "down" on a 5xx, else nothing. */
    own: HealthEntry | null;
};

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
 *
 * Read once per sweep. city recomputes the aggregate on every request —
 * probing each sibling again — so asking it a second time at the same address
 * for its own health doubled its load and could only add anything on a 5xx,
 * which this read already sees.
 *
 * Its entries come from another origin and reach the map's tooltip and the
 * sidebar's markup, so each one is rebuilt from the fields this monitor reads,
 * type-checked, and anything malformed is dropped. That is defence in depth —
 * the renderers escape too — but it also means one bad element costs only
 * itself: a `null` in the list used to throw out of the health sweep.
 */
export async function fetchEcosystemHealth(signal?: AbortSignal): Promise<AggregateReading> {
    const reading = await readHealth(HEALTH_URL, signal);
    const { httpCode, data } = reading;
    const aggregate = httpCode >= 200 && httpCode < 300 && isRecord(data) && Array.isArray(data.services)
        ? {
            checkedAt: typeof data.checkedAt === "string" ? data.checkedAt : undefined,
            services: data.services.flatMap(aggregateEntry),
        }
        : null;
    return { aggregate, own: verdict(AGGREGATOR_ID, reading) };
}

/** One of city's sibling reports, or nothing if it is not one we can read —
 *  including one whose `status` is empty, which names no state, by the same
 *  rule `verdict` applies to a first-hand answer. */
function aggregateEntry(h: unknown): HealthEntry[] {
    if (!isRecord(h) || typeof h.service !== "string" || typeof h.status !== "string" || h.status === "") return [];
    return [{
        service: h.service,
        status: h.status,
        httpCode: finite(h.httpCode),
        latencyMs: finite(h.latencyMs),
        checkedAt: typeof h.checkedAt === "string" ? h.checkedAt : undefined,
    }];
}

const finite = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined;

type HealthReading = { httpCode: number; data: unknown; latencyMs: number };

/** One health request, timed. Throws exactly when getJSONWithStatus does. */
async function readHealth(url: string, signal?: AbortSignal): Promise<HealthReading> {
    const started = performance.now();
    const { httpCode, data } = await getJSONWithStatus<unknown>(url, signal);
    // Ours, not theirs: the round trip we just measured. The contract's
    // `timestamp` is when the service generated its answer, which is a
    // different fact and belongs in `checkedAt`.
    return { httpCode, data, latencyMs: Math.round(performance.now() - started) };
}

/**
 * The verdict a health answer carries, filed under the registry id we asked
 * about. Keyed on our id, not the body's `service`: npc, recipe and signalmap
 * publish none, and city's names its siblings.
 */
function verdict(service: string, { httpCode, data, latencyMs }: HealthReading): HealthEntry | null {
    const body = isRecord(data) ? data : null;
    // A verdict is a non-empty string. An empty one names no state, so it is
    // no verdict at all: `??` below would otherwise keep it, and a 5xx that
    // carried one would read as unmeasured instead of down.
    const declared = typeof body?.status === "string" && body.status !== "" ? body.status : null;
    // Only 5xx stands in for a missing verdict. A 5xx is the service failing, so
    // "down" is its own report by another means. A 4xx is not: it says the
    // request was wrong — a moved path, a rate limit — and the service answering
    // "no" quickly is evidence it is alive, so calling it down would be a false
    // alarm. Those stay unmeasured, which is the honest reading of a health
    // address we can no longer use.
    const status = declared ?? (httpCode >= 500 ? "down" : null);
    if (!status) return null;
    return {
        service,
        status,
        httpCode,
        latencyMs,
        checkedAt: typeof body?.timestamp === "string" ? body.timestamp : undefined,
    };
}

/**
 * Asks one service how it is doing, at the address its registry entry gives.
 *
 * This is the payoff of the health contract: every conforming service answers
 * `{status, service, timestamp}` at `/api/health` with `Access-Control-Allow-
 * Origin: *`, so the browser can read it directly instead of taking one
 * aggregator's word for six services and calling the other twenty unobserved.
 *
 * Deliberately strict about `status`: any string the service declares is
 * passed through untranslated, including one outside the contract's three
 * values. Guessing that "running" means "ok" would hide exactly the
 * non-conformance worth seeing, so it is the renderers that decline to read it
 * as a verdict — the map draws it in the unmeasured colour, and the sidebar
 * gives it its own `offcontract` dot — while the node still counts as
 * health-checked, because the service did answer. `null` means there is no
 * verdict to read: no `statusUrl`, or a non-5xx answer with no non-empty string
 * `status` — a 200 that names no state, or a 4xx. (city's aggregate is such a
 * 200; it is read by the same rule through `fetchEcosystemHealth`, not here.)
 *
 * Read through `getJSONWithStatus`, not `getJSON`, because a service is allowed
 * to declare bad news in the status line. `signal` and `signalmap` answer 503
 * when their feed is dry — on purpose, since a deploy gate reads that code — and
 * throwing on it meant their outage arrived here as nothing at all and drew as
 * "not health-checked". A body that names its own state is believed whatever the
 * code says; only a 5xx with no non-empty string `status` — an HTML error page,
 * or JSON without the field — makes us supply the verdict.
 */
export async function fetchServiceHealth(
    service: RegistryService,
    signal?: AbortSignal,
): Promise<HealthEntry | null> {
    if (!service.statusUrl) return null;
    return verdict(service.id, await readHealth(service.statusUrl, signal));
}
