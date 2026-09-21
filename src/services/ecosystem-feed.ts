import type { RegistryService, HealthEntry } from "./types.ts";
import {
    fetchRegistry, fetchEcosystemHealth, fetchServiceHealth, HEALTH_URL, AGGREGATOR_ID,
} from "./ecosystem-client.ts";

/**
 * How much this monitor can actually observe about a service. The visualization
 * keys off this directly: a service we only know the name of must not be able to
 * look as alive as one we are streaming data from.
 */
export type Instrumentation = "stream" | "health" | "listed";

/**
 * What a registry entry *is*, which decides whether "is it up?" is even a
 * sensible question to ask of it.
 *
 *   service  — something Mossland runs. Can be ok, degraded or down.
 *   artifact — a file: llms.txt, sitemap.xml, ecosystem-registry.json. It cannot
 *              be "degraded"; it is either there or it is not.
 *   link     — a pointer somewhere else: a GitHub org, a blog, an exchange
 *              listing. Its uptime is not ours and not our claim to make.
 *
 * The registry already carries every field needed to tell these apart, so this
 * reads its answer rather than hard-coding a list of ids that would rot.
 */
export type NodeKind = "service" | "artifact" | "link";

export function kindOf(s: RegistryService): NodeKind {
    // The registry marks these itself — `artifact: true` on exactly the three
    // file entries. Checked first: an artifact is also tier `developer`, and
    // being a file is the more specific truth.
    if (s.artifact) return "artifact";
    // Exchange listings. Their status is the exchange's business.
    if (s.owner && s.owner !== "mossland") return "link";
    // GitHub orgs, Medium, X — ours, but they are destinations, not services.
    if (s.tier === "developer" || s.tier === "channel") return "link";
    return "service";
}

/** Services whose data this monitor actually polls (see DataBridge). DataBridge
 *  fetches signals/issues/stats from algora as well, so it belongs here even
 *  though the registry marks it archived — the archived styling is applied
 *  independently, and claiming we do not read it would be the inaccurate half. */
const STREAMING_IDS = new Set(["algora", "ao", "bridge"]);

export type EcosystemNode = {
    service: RegistryService;
    health: HealthEntry | null;
    instrumentation: Instrumentation;
    kind: NodeKind;
};

// The registry is served with max-age=300 and changes rarely, so polling it
// often would only re-fetch unchanged bytes. The health aggregator is the
// opposite case: it advertises s-maxage=60, but it answers freshly on every
// request, probing its siblings again each time (see fetchEcosystemHealth).
// Polling it at the 15s service cadence would therefore add load on city,
// not freshness.
const REGISTRY_INTERVAL_MS = 10 * 60_000;
const HEALTH_INTERVAL_MS = 60_000;
const TIMEOUT_MS = 10_000;

export class EcosystemFeed {
    private registry: RegistryService[] = [];
    private health = new Map<string, HealthEntry>();
    private timers = new Set<ReturnType<typeof setTimeout>>();
    private inFlight = new Set<AbortController>();
    private destroyed = false;

    /** Null until the first registry fetch settles — distinct from "empty". */
    private loaded = false;

    /** When this monitor last completed a health sweep. It used to be the
     *  aggregator's clock, which was the honest choice while the aggregate was
     *  the only source; now that most readings are our own first-hand fetches,
     *  ours is. Drives the map's sweep animation, which claims exactly this. */
    healthCheckedAt: string | null = null;

    isLoaded(): boolean { return this.loaded; }

    /** Registry entries with their health, in registry order. */
    nodes(): EcosystemNode[] {
        return this.registry.map(service => {
            const kind = kindOf(service);
            // A file and an exchange listing have no health for us to hold, so
            // they never carry one even if something turned up under their id.
            const health = kind === "service" ? this.health.get(service.id) ?? null : null;
            // Grade on evidence we actually hold, not on evidence that could in
            // principle be collected. A registry `statusUrl` we never call is not
            // an observation, and grading on it promoted two services (signal,
            // city) above `listed` with `health: null` behind them — which
            // HubMap then drew filled and pulsing.
            const instrumentation: Instrumentation = STREAMING_IDS.has(service.id)
                ? "stream"
                : health
                    ? "health"
                    : "listed";
            return { service, health, instrumentation, kind };
        });
    }

    async init(): Promise<void> {
        // Registry first, and awaited before the health sweep. These used to run
        // concurrently, which was fine while health came from one fixed URL — but
        // the sweep now fans out to the statusUrls the registry lists, so racing
        // them sends the first sweep against an empty list and leaves the map
        // claiming nothing is measured until the 60s tick. One cached request.
        //
        // Both schedules are armed whatever the first sweep does. A throw here
        // used to skip them, and the tab then never refreshed either feed.
        await this.guarded(() => this.pollRegistry());
        await this.guarded(() => this.pollHealth());
        this.schedule(() => this.pollRegistry(), REGISTRY_INTERVAL_MS);
        this.schedule(() => this.pollHealth(), HEALTH_INTERVAL_MS);
    }

    /** Same chained-timer discipline as DataBridge: never overlap, never
     *  reschedule after teardown — and always reschedule otherwise. The next
     *  timer is armed only once a job settles, so a job that threw used to end
     *  its chain for the life of the tab, and the map kept its last verdicts on
     *  screen as if they were current. */
    private schedule(job: () => Promise<void>, everyMs: number): void {
        if (this.destroyed) return;
        const timer = setTimeout(async () => {
            this.timers.delete(timer);
            await this.guarded(job);
            this.schedule(job, everyMs);
        }, everyMs);
        this.timers.add(timer);
    }

    /** Runs one poll so that a throw costs that poll and nothing else. Nothing
     *  in either poll is meant to throw — every request already settles on its
     *  own — so reaching the catch is a bug worth a console line, not a reason
     *  to stop watching. */
    private async guarded(job: () => Promise<void>): Promise<void> {
        try {
            await job();
        } catch (err) {
            console.error("[ecosystem] a poll threw; the next one is still scheduled", err);
        }
    }

    private async withSignal<T>(run: (s: AbortSignal) => Promise<T>): Promise<T | null> {
        if (this.destroyed) return null;
        const ctrl = new AbortController();
        // Registry and health have independent schedules and can overlap.
        // Teardown must cancel both, whichever request started last.
        this.inFlight.add(ctrl);
        const timeout = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
        try {
            return await run(ctrl.signal);
        } catch {
            return null;                    // keep the previous snapshot
        } finally {
            clearTimeout(timeout);
            this.inFlight.delete(ctrl);
        }
    }

    private async pollRegistry(): Promise<void> {
        const services = await this.withSignal(s => fetchRegistry(s));
        if (this.destroyed || !services) return;
        this.registry = services;
        this.loaded = true;
    }

    /**
     * Asks every service that publishes a health endpoint, and uses city's
     * aggregate to cover the ones we still cannot read.
     *
     * This used to be the aggregate alone, which is why most of the map sat at
     * `listed`: city probes six siblings, so twenty-odd services with perfectly
     * good health endpoints were rendered as if nothing were known about them.
     * The health contract fixed the reason for that — the endpoints now share a
     * shape and send `Access-Control-Allow-Origin: *` — so we ask them directly.
     *
     * First-hand wins over second-hand where both exist: a direct answer is
     * fresher, and it is the service's own verdict rather than an inference from
     * an unrelated data URL's status code.
     *
     * city is asked once. Its registry `statusUrl` *is* the aggregate, so it is
     * left out of the fan-out and its own reading comes from the aggregate read
     * instead — matched on the address, not on city's id, so that if city ever
     * publishes a separate health endpoint it is read first-hand like any other.
     *
     * The whole fan-out shares one AbortSignal, so teardown and the timeout
     * cancel every request in the cycle rather than the last one issued.
     */
    private async pollHealth(): Promise<void> {
        const result = await this.withSignal(async signal => {
            const targets = this.registry.filter(s =>
                s.statusUrl && s.statusUrl !== HEALTH_URL && kindOf(s) === "service");
            const [direct, reading] = await Promise.all([
                // One slow or unreachable service must not cost us the other
                // fifteen, so each failure resolves to null on its own.
                Promise.all(targets.map(s => fetchServiceHealth(s, signal).catch(() => null))),
                fetchEcosystemHealth(signal).catch(() => null),
            ]);
            return { direct, reading };
        });
        if (this.destroyed || !result) return;
        const { direct, reading } = result;
        const aggregate = reading?.aggregate ?? null;

        // city's verdict on itself is as first-hand as any statusUrl read — it
        // is the same request. It goes first, so that a separate endpoint of
        // its own, were there one, would be the answer that stands.
        const firstHand = [reading?.own ?? null, ...direct].filter((h): h is HealthEntry => h !== null);

        // Nothing came back at all — keep the previous snapshot rather than
        // blanking the map on one bad cycle.
        if (firstHand.length === 0 && !aggregate) return;

        const entries = new Map<string, HealthEntry>();
        // Aggregate first, so first-hand answers overwrite it.
        for (const h of aggregate?.services ?? []) entries.set(h.service, h);
        for (const h of firstHand) entries.set(h.service, h);

        // city reports on its siblings but not on itself, and its own endpoint is
        // an aggregate with no top-level `status` for us to read. A successful
        // response is still first-hand proof that it answered, so record that
        // rather than leaving the one service we demonstrably reached unobserved.
        // Last, and only where nothing else filed a reading for city, so a
        // verdict it declared for itself is never overridden.
        if (aggregate && !entries.has(AGGREGATOR_ID)) {
            entries.set(AGGREGATOR_ID, {
                service: AGGREGATOR_ID,
                status: "ok",
                checkedAt: aggregate.checkedAt,
            });
        }

        this.health = entries;
        // Our own sweep, not the aggregator's — most of these readings are now
        // ours, so reporting city's clock would misdate them.
        this.healthCheckedAt = new Date().toISOString();
    }

    destroy(): void {
        this.destroyed = true;
        this.timers.forEach(clearTimeout);
        this.timers.clear();
        this.inFlight.forEach(ctrl => ctrl.abort());
        this.inFlight.clear();
    }
}
