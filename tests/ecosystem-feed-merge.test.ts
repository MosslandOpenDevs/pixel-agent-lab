import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EcosystemFeed, REGISTRY_RETRY_MS } from "../src/services/ecosystem-feed.ts";
import type { RegistryService } from "../src/services/types.ts";

/**
 * How the feed grades each registry entry and merges its health sources.
 *
 * This decides every body's form and colour on the map, and each rule below
 * has shipped broken at least once: grading on a `statusUrl` nobody had read
 * drew unreachable services as health-checked, the aggregate's second-hand
 * inference has to lose to a service's own verdict, and one failed sweep must
 * not blank the map.
 *
 * `fetch` is stubbed, not the client module, so the real fetchRegistry,
 * fetchServiceHealth and getJSONWithStatus paths run. A mocked client is free
 * to agree with a wrong feed.
 */

const REGISTRY_URL = "https://links.moss.land/ecosystem-registry.json";
// city.moss.land's aggregate. It is also city's own registry `statusUrl`.
const AGGREGATE_URL = "https://city.moss.land/api/health";
const T = "2026-09-21T00:00:00.000Z";

const svc = (id: string, o: Partial<RegistryService> = {}): RegistryService => ({
    id, name: id, domain: `${id}.moss.land`, url: `https://${id}.moss.land`,
    tier: "labs", section: "ecosystem", status: "operational", owner: "mossland",
    statusUrl: `https://${id}.moss.land/api/health`, ...o,
});

const REGISTRY: RegistryService[] = [
    svc("bridge"),                                        // streamed, and answers its health too
    svc("npc"),                                           // a direct `ok`
    svc("signalmap"),                                     // its own 503 `degraded`; city calls it ok
    svc("alpha"),                                         // CORS wall; city covers it
    svc("recipe"),                                        // CORS wall; nobody covers it
    svc("wa"),                                            // off-contract "running"
    svc("city", { statusUrl: AGGREGATE_URL }),            // publishes the aggregate
    // A file. It has a statusUrl here and city names it, and neither may
    // give it health.
    svc("registry-json", { artifact: true, tier: "developer", section: "developers" }),
    svc("upbit", { owner: "third-party", tier: "third_party", section: "markets", statusUrl: "https://upbit.example/health" }),
    svc("links", { hidden: true }),
];

const AGGREGATE = {
    checkedAt: T,
    summary: { ok: 5, degraded: 0, down: 0, total: 5 },
    services: [
        { service: "signalmap", status: "ok", httpCode: 200, latencyMs: 0, checkedAt: T },
        { service: "alpha", status: "ok", httpCode: 200, latencyMs: 0, checkedAt: T },
        { service: "registry-json", status: "ok" },
        { service: "upbit", status: "ok" },
        { service: "links", status: "ok" },
    ],
};

type Route = (signal?: AbortSignal) => Response | Promise<Response>;

const corsWall = () => { throw new TypeError("Failed to fetch"); };

function routes(overrides: Record<string, Route> = {}): Record<string, Route> {
    return {
        [REGISTRY_URL]: () => Response.json({ version: "1", generatedAt: T, services: REGISTRY }),
        [AGGREGATE_URL]: () => Response.json(AGGREGATE),
        "https://bridge.moss.land/api/health": () => Response.json({ status: "ok", service: "bridge", timestamp: T }),
        "https://npc.moss.land/api/health": () => Response.json({ status: "ok", timestamp: T }),
        "https://signalmap.moss.land/api/health": () => Response.json({ status: "degraded" }, { status: 503 }),
        "https://alpha.moss.land/api/health": corsWall,
        "https://recipe.moss.land/api/health": corsWall,
        "https://wa.moss.land/api/health": () => Response.json({ status: "running", timestamp: T }),
        ...overrides,
    };
}

/** Rejects the way real fetch does: at once if already aborted, else on abort. */
function hangUntilAborted(signal?: AbortSignal): Promise<never> {
    return new Promise((_, reject) => {
        const abort = () => reject(new DOMException("Aborted", "AbortError"));
        if (signal?.aborted) abort();
        else signal?.addEventListener("abort", abort, { once: true });
    });
}

let calls: string[] = [];

function serve(table: Record<string, Route>): void {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(url);
        const route = table[url];
        // Anything unrouted is unreachable — and a test that reached for the
        // network by accident fails loudly instead of passing on live data.
        if (!route) throw new TypeError(`unrouted: ${url}`);
        return route(init?.signal ?? undefined);
    }));
}

const grade = (feed: EcosystemFeed) => Object.fromEntries(feed.nodes().map(n =>
    [n.service.id, [n.kind, n.instrumentation, n.health?.status ?? null]]));

describe("EcosystemFeed grading and merge", () => {
    let feed: EcosystemFeed;

    beforeEach(() => {
        vi.useFakeTimers();
        calls = [];
        feed = new EcosystemFeed();
    });

    afterEach(() => {
        feed.destroy();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it("grades every entry on the evidence it actually holds", async () => {
        serve(routes());
        await feed.init();

        expect(grade(feed)).toEqual({
            bridge: ["service", "stream", "ok"],
            npc: ["service", "health", "ok"],
            // First-hand beats second-hand: its own 503 verdict, not city's ok.
            signalmap: ["service", "health", "degraded"],
            // Unreachable directly, so the aggregate's reading stands in.
            alpha: ["service", "health", "ok"],
            // Unreachable and uncovered. It has a statusUrl, and that is not an
            // observation: it must not be promoted above `listed`.
            recipe: ["service", "listed", null],
            // Answered outside the contract; passed through, never translated.
            wa: ["service", "health", "running"],
            // city reports on its siblings, not itself; answering is the proof.
            city: ["service", "health", "ok"],
            "registry-json": ["artifact", "listed", null],
            upbit: ["link", "listed", null],
            // `links` is hidden in the registry and never reaches the map.
        });
    });

    it("keeps `health` and a held reading in lockstep for every non-streamed node", async () => {
        serve(routes());
        await feed.init();

        for (const n of feed.nodes().filter(n => n.instrumentation !== "stream")) {
            expect({ id: n.service.id, health: n.instrumentation === "health" })
                .toEqual({ id: n.service.id, health: n.health !== null });
        }
    });

    it("never asks a file, a link or a hidden entry for its health", async () => {
        serve(routes());
        await feed.init();

        expect(calls).not.toContain("https://upbit.example/health");
        expect(calls).not.toContain("https://registry-json.moss.land/api/health");
        expect(calls).not.toContain("https://links.moss.land/api/health");
    });

    it("keeps the previous snapshot when a whole sweep reads nothing", async () => {
        serve(routes());
        await feed.init();
        const before = feed.nodes();
        const checkedAt = feed.healthCheckedAt;
        expect(checkedAt).not.toBeNull();

        // Every health request now fails. The registry is not due for ten
        // minutes, so only the health sweep runs at the one-minute tick.
        serve({ [REGISTRY_URL]: () => Response.json({ services: REGISTRY }) });
        calls = [];
        await vi.advanceTimersByTimeAsync(60_000);

        expect(calls).toContain(AGGREGATE_URL);          // the sweep did run
        expect(feed.nodes()).toEqual(before);
        expect(feed.healthCheckedAt).toBe(checkedAt);
    });

    it("lets a hung aggregate time out without costing the first-hand readings", async () => {
        serve(routes({ [AGGREGATE_URL]: hangUntilAborted }));
        let settled = false;
        const init = feed.init().then(() => { settled = true; });

        await vi.advanceTimersByTimeAsync(10_000);
        // Checked before awaiting: without the cycle cap this never settles,
        // and the test should say so rather than time out.
        expect(settled).toBe(true);
        await init;

        const g = grade(feed);
        expect(g.npc).toEqual(["service", "health", "ok"]);
        expect(g.signalmap).toEqual(["service", "health", "degraded"]);
        // Only the aggregate covered alpha, and city answered nothing.
        expect(g.alpha).toEqual(["service", "listed", null]);
        expect(g.city).toEqual(["service", "listed", null]);
    });
});

describe("city's own reading", () => {
    let feed: EcosystemFeed;

    beforeEach(() => {
        vi.useFakeTimers();
        calls = [];
        feed = new EcosystemFeed();
    });

    afterEach(() => {
        feed.destroy();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it.each<[string, Route, string | null]>([
        // nginx's own error page: we reached it and it failed.
        ["an HTML 503", () => new Response("<html>503</html>", { status: 503, headers: { "content-type": "text/html" } }), "down"],
        // A declared verdict survives the status line, as for any service.
        ["a 503 that declares itself degraded", () => Response.json({ status: "degraded" }, { status: 503 }), "degraded"],
        ["a 200 that declares itself degraded", () => Response.json({ ...AGGREGATE, status: "degraded" }), "degraded"],
        // A 4xx or a thrown fetch is "we could not see it", never down.
        ["a 404", () => new Response("nope", { status: 404 }), null],
        ["a thrown fetch", corsWall, null],
    ])("reads %s the way any statusUrl is read", async (_, answer, expected) => {
        serve(routes({ [AGGREGATE_URL]: answer }));
        await feed.init();

        expect(grade(feed).city).toEqual(["service", expected ? "health" : "listed", expected]);
    });

    it("still uses the siblings' readings when city declares its own state", async () => {
        serve(routes({ [AGGREGATE_URL]: () => Response.json({ ...AGGREGATE, status: "degraded" }) }));
        await feed.init();

        expect(grade(feed).alpha).toEqual(["service", "health", "ok"]);
    });

    it("prefers a separate city health endpoint, if it ever gets one, to the aggregate", async () => {
        // Matching the aggregate on its URL, not on city's id, is what keeps
        // this first-hand reading from being skipped.
        // The aggregate declaring "ok" for itself must not outrank it either.
        const registry = REGISTRY.map(s => s.id === "city" ? { ...s, statusUrl: "https://city.moss.land/api/status" } : s);
        serve(routes({
            [REGISTRY_URL]: () => Response.json({ services: registry }),
            [AGGREGATE_URL]: () => Response.json({ ...AGGREGATE, status: "ok" }),
            "https://city.moss.land/api/status": () => Response.json({ status: "degraded", timestamp: T }),
        }));
        await feed.init();

        expect(grade(feed).city).toEqual(["service", "health", "degraded"]);
        expect(grade(feed).alpha).toEqual(["service", "health", "ok"]);
    });
});

describe("EcosystemFeed against malformed or duplicate reads", () => {
    let feed: EcosystemFeed;

    beforeEach(() => {
        vi.useFakeTimers();
        calls = [];
        feed = new EcosystemFeed();
    });

    afterEach(() => {
        feed.destroy();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it("asks city once per sweep: its statusUrl is the aggregate", async () => {
        // city's registry statusUrl and the aggregate are the same address, and
        // every request makes city re-probe all of its siblings. One read
        // yields both the aggregate and city's own reading.
        serve(routes());
        await feed.init();
        expect(calls.filter(u => u === AGGREGATE_URL)).toHaveLength(1);
        const first = feed.healthCheckedAt;

        await vi.advanceTimersByTimeAsync(60_000);
        expect(calls.filter(u => u === AGGREGATE_URL)).toHaveLength(2);
        // A sweep that read something re-dates the snapshot; the map's ring
        // sweep keys on this value changing, so a frozen clock would stop it.
        // (Fake timers fake Date too, so the clock moves exactly 60 s.)
        expect(feed.healthCheckedAt).not.toBe(first);
    });

    it("drops malformed aggregate entries and keeps polling", async () => {
        // One `null` among the entries used to throw out of the sweep after
        // the fetches had resolved — past the guard that keeps the previous
        // snapshot — and a throw there ended the polling chain for the life of
        // the tab. On the first sweep it also stopped the registry refresh.
        const broken = { ...AGGREGATE, services: [null, "alpha", { service: 5 }, ...AGGREGATE.services] };
        serve(routes({ [AGGREGATE_URL]: () => Response.json(broken) }));
        await feed.init();

        expect(grade(feed).alpha).toEqual(["service", "health", "ok"]);
        expect(grade(feed).npc).toEqual(["service", "health", "ok"]);
        expect(vi.getTimerCount()).toBe(2);             // registry + health, both still armed

        calls = [];
        await vi.advanceTimersByTimeAsync(60_000);
        expect(calls).toContain(AGGREGATE_URL);
    });

    it("reads a registry answer with no list as unreachable, not as an ecosystem of nothing", async () => {
        // `{"error": "maintenance"}` is valid JSON, so taking its missing list
        // for an empty one counted as a load: the map emptied, the registry
        // read as loaded, and the early-retry ladder stood down to the
        // ten-minute schedule — a wrong answer held for ten minutes, where an
        // unreachable registry says so and is back within seconds.
        serve(routes({ [REGISTRY_URL]: () => Response.json({ error: "maintenance" }) }));
        await feed.init();

        expect(feed.isLoaded()).toBe(false);
        expect(feed.registryState()).toBe("failed");
        expect(feed.nodes()).toEqual([]);

        serve(routes());
        await vi.advanceTimersByTimeAsync(REGISTRY_RETRY_MS[0]);
        expect(feed.registryState()).toBe("loaded");
        expect(feed.nodes().map(n => n.service.id)).toContain("npc");
    });

    it("drops registry rows that have no id to key them on", async () => {
        const registry = [null, 42, { name: "no id", statusUrl: "https://noid.moss.land/api/health" }, ...REGISTRY];
        serve(routes({ [REGISTRY_URL]: () => Response.json({ services: registry }) }));
        await feed.init();

        expect(feed.nodes().map(n => n.service.id)).toEqual(REGISTRY.filter(s => !s.hidden).map(s => s.id));
        expect(calls).not.toContain("https://noid.moss.land/api/health");
    });
});
