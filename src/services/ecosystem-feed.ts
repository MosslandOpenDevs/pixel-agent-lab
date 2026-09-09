import type { RegistryService, HealthEntry } from "./types.ts";
import { fetchRegistry, fetchEcosystemHealth } from "./ecosystem-client.ts";

/**
 * How much this monitor can actually observe about a service. The visualization
 * keys off this directly: a service we only know the name of must not be able to
 * look as alive as one we are streaming data from.
 */
export type Instrumentation = "stream" | "health" | "listed";

/** Services whose data this monitor actually polls (see DataBridge). */
const STREAMING_IDS = new Set(["ao", "bridge"]);

/** The service that publishes the health aggregate (city.moss.land). */
const AGGREGATOR_ID = "city";

export type EcosystemNode = {
    service: RegistryService;
    health: HealthEntry | null;
    instrumentation: Instrumentation;
};

// The registry is served with max-age=300 and changes rarely; the health
// aggregator is cached for 60s upstream. Polling either at the 15s service
// cadence would just burn requests on unchanged bytes.
const REGISTRY_INTERVAL_MS = 10 * 60_000;
const HEALTH_INTERVAL_MS = 60_000;
const TIMEOUT_MS = 10_000;

export class EcosystemFeed {
    private registry: RegistryService[] = [];
    private health = new Map<string, HealthEntry>();
    private timers: ReturnType<typeof setTimeout>[] = [];
    private inFlight: AbortController | null = null;
    private destroyed = false;

    /** Null until the first registry fetch settles — distinct from "empty". */
    private loaded = false;

    /** Wall-clock of the aggregator's own last check, not ours. */
    healthCheckedAt: string | null = null;

    isLoaded(): boolean { return this.loaded; }

    /** Registry entries with their health, in registry order. */
    nodes(): EcosystemNode[] {
        return this.registry.map(service => {
            const health = this.health.get(service.id) ?? null;
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
            return { service, health, instrumentation };
        });
    }

    async init(): Promise<void> {
        await Promise.allSettled([this.pollRegistry(), this.pollHealth()]);
        this.schedule(() => this.pollRegistry(), REGISTRY_INTERVAL_MS);
        this.schedule(() => this.pollHealth(), HEALTH_INTERVAL_MS);
    }

    /** Same chained-timer discipline as DataBridge: never overlap, never
     *  reschedule after teardown. */
    private schedule(job: () => Promise<void>, everyMs: number): void {
        if (this.destroyed) return;
        const timer = setTimeout(async () => {
            await job();
            this.schedule(job, everyMs);
        }, everyMs);
        this.timers.push(timer);
    }

    private async withSignal<T>(run: (s: AbortSignal) => Promise<T>): Promise<T | null> {
        if (this.destroyed) return null;
        const ctrl = new AbortController();
        this.inFlight = ctrl;
        const timeout = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
        try {
            return await run(ctrl.signal);
        } catch {
            return null;                    // keep the previous snapshot
        } finally {
            clearTimeout(timeout);
            if (this.inFlight === ctrl) this.inFlight = null;
        }
    }

    private async pollRegistry(): Promise<void> {
        const services = await this.withSignal(s => fetchRegistry(s));
        if (this.destroyed || !services) return;
        this.registry = services;
        this.loaded = true;
    }

    private async pollHealth(): Promise<void> {
        const data = await this.withSignal(s => fetchEcosystemHealth(s));
        if (this.destroyed || !data) return;
        const entries = new Map(data.services.map(h => [h.service, h] as const));
        // The aggregator does not report on itself, but a successful response is
        // first-hand proof that it answered — so record that, rather than leaving
        // the one service we demonstrably reached looking unobserved.
        if (!entries.has(AGGREGATOR_ID)) {
            entries.set(AGGREGATOR_ID, {
                service: AGGREGATOR_ID,
                status: "ok",
                checkedAt: data.checkedAt,
            });
        }
        this.health = new Map(entries);
        this.healthCheckedAt = data.checkedAt ?? null;
    }

    destroy(): void {
        this.destroyed = true;
        this.timers.forEach(clearTimeout);
        this.timers = [];
        this.inFlight?.abort();
        this.inFlight = null;
    }
}
