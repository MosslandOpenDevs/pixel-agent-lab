import { createServer, type Server, type ServerResponse } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { fetchEcosystemHealth, fetchServiceHealth } from "../src/services/ecosystem-client.ts";
import type { RegistryService } from "../src/services/types.ts";

/**
 * What the monitor concludes from one service's answer.
 *
 * This is the layer where a wrong conclusion is invisible. Every case below
 * produces a coloured dot on the map, and a dot that is confidently the wrong
 * colour reads exactly like a dot that is right — which is how a real outage
 * spent months rendering as "we never looked".
 *
 * The cases are driven against a real HTTP server rather than a mocked `fetch`,
 * because half of what is being asserted is how the reader treats a status line
 * it did not expect, and a mock is free to be wrong about that in the same
 * direction as the code.
 */

const CASES: Record<string, { code: number; type: string; body: string }> = {
    // The ordinary healthy answer.
    "/ok": {
        code: 200, type: "application/json",
        body: JSON.stringify({ status: "ok", service: "x", timestamp: "2026-09-10T03:00:00.000Z" }),
    },
    // signal and signalmap answer 503 on purpose when their feed is dry, and
    // HEALTH_CONTRACT.md rule 4 names that a documented exception rather than a
    // violation. The verdict is in the body and must survive the status line.
    "/degraded-503": {
        code: 503, type: "application/json",
        body: JSON.stringify({ status: "degraded", service: "signal", timestamp: "2026-09-10T03:00:00.000Z" }),
    },
    // The app is gone and nginx answers its own error page. We reached the
    // service and it failed, so "down" is its report by another means.
    "/bad-gateway": { code: 502, type: "text/html", body: "<html>502 Bad Gateway</html>" },
    // A health route that threw, answering with its framework's JSON error.
    // Readable, but it names no state, so the 5xx is still the only verdict.
    "/error-json": { code: 500, type: "application/json", body: JSON.stringify({ error: "Internal Server Error" }) },
    // A `status` that is present but is not a non-empty string is not a
    // verdict. It must not reach HealthEntry.status, which the renderers read
    // as a string. A 5xx carrying one still names no state, so the 5xx is the
    // verdict.
    "/numeric-status-503": { code: 503, type: "application/json", body: JSON.stringify({ status: 1 }) },
    "/object-status-503": { code: 503, type: "application/json", body: JSON.stringify({ status: { state: "degraded" } }) },
    "/empty-status-503": { code: 503, type: "application/json", body: JSON.stringify({ status: "" }) },
    // The same fields on a 200 are "answered, nothing to interpret", not health-checked.
    "/numeric-status-200": { code: 200, type: "application/json", body: JSON.stringify({ status: 1 }) },
    "/empty-status-200": { code: 200, type: "application/json", body: JSON.stringify({ status: "" }) },
    // A 4xx says the request was wrong — a moved path, a rate limit. The
    // service answered, and answering quickly is evidence it is alive, so
    // calling it down would be a false alarm.
    "/not-found": { code: 404, type: "text/html", body: "nope" },
    "/rate-limited": { code: 429, type: "application/json", body: JSON.stringify({ error: "slow down" }) },
    // city's aggregate: a 200 with no top-level status. Nothing to interpret.
    "/aggregate": {
        code: 200, type: "application/json",
        body: JSON.stringify({ checkedAt: "2026-09-10T03:00:00.000Z", summary: { ok: 6 }, services: [] }),
    },
    // algora answers outside the enum. Translating it would hide the last
    // non-conforming service, so it passes through untouched.
    "/off-contract": {
        code: 200, type: "application/json",
        body: JSON.stringify({ status: "running", timestamp: "2026-09-10T03:00:00.000Z" }),
    },
};

/**
 * Answers whose body never finishes arriving. The headers — a 503, which on its
 * own would read as "down" — are already out; what is missing is the part that
 * would have said which state the service is in.
 */
const PARTIAL: Record<string, (res: ServerResponse) => void> = {
    // Stalls mid-body until the reader gives up.
    "/stalls-503": res => {
        res.writeHead(503, { "content-type": "application/json" });
        res.write('{"status":"deg');
    },
    // The connection drops mid-body.
    "/resets-503": res => {
        res.writeHead(503, { "content-type": "application/json" });
        res.write('{"status":"deg', () => setTimeout(() => res.socket?.destroy(), 20));
    },
};

let server: Server;
let base = "";

beforeAll(async () => {
    server = createServer((req, res) => {
        const partial = PARTIAL[req.url ?? ""];
        if (partial) { partial(res); return; }
        const c = CASES[req.url ?? ""];
        if (!c) { res.writeHead(404); res.end(); return; }
        res.writeHead(c.code, { "content-type": c.type });
        res.end(c.body);
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(() => new Promise<void>(resolve => {
    // The stalled answers hold their sockets open; close() alone waits on them.
    server.closeAllConnections();
    server.close(() => resolve());
}));

const at = (path: string): RegistryService =>
    ({ id: "svc", statusUrl: `${base}${path}` } as RegistryService);

describe("fetchServiceHealth", () => {
    it("reads an ordinary 200", async () => {
        const h = await fetchServiceHealth(at("/ok"));
        expect(h).toMatchObject({ service: "svc", status: "ok", httpCode: 200 });
    });

    it("keys the entry on the registry id, not the body's `service`", async () => {
        // npc, recipe and signalmap publish no `service` field, and city
        // publishes one that names its siblings. Trusting the body here would
        // file those readings under the wrong node, or lose them.
        const h = await fetchServiceHealth(at("/degraded-503"));
        expect(h?.service).toBe("svc");
    });

    it("believes a 503 that declares its own state", async () => {
        const h = await fetchServiceHealth(at("/degraded-503"));
        expect(h?.status).toBe("degraded");
        expect(h?.httpCode).toBe(503);
    });

    it("calls an unparseable 5xx down — we reached it and it failed", async () => {
        const h = await fetchServiceHealth(at("/bad-gateway"));
        expect(h?.status).toBe("down");
    });

    it("calls a readable 5xx with no `status` down too — the rule is a missing verdict, not a parse failure", async () => {
        const h = await fetchServiceHealth(at("/error-json"));
        expect(h?.status).toBe("down");
        expect(h?.httpCode).toBe(500);
    });

    it.each(["/numeric-status-503", "/object-status-503", "/empty-status-503"])(
        "calls %s down: a `status` that is not a non-empty string is no verdict",
        async (path) => {
            const h = await fetchServiceHealth(at(path));
            expect(h?.status).toBe("down");
            expect(h?.httpCode).toBe(503);
        },
    );

    it.each(["/numeric-status-200", "/empty-status-200"])(
        "returns null for %s: a 200 whose `status` names no state",
        async (path) => {
            expect(await fetchServiceHealth(at(path))).toBeNull();
        },
    );

    it("throws when the read is aborted mid-body, rather than calling the 503 down", async () => {
        // The sweep's timeout firing while the body is still arriving is "we
        // could not see the answer", exactly like an abort before the headers.
        //
        // The abort is tied to the headers arriving, not to a wall-clock delay.
        // Server and client share this event loop, so a stalled worker can let
        // a timer fire before the 503's headers are read. fetch() itself then
        // rejects, and the test passes whether or not the body read is guarded.
        const ctrl = new AbortController();
        const realFetch = globalThis.fetch;
        vi.stubGlobal("fetch", async (...a: Parameters<typeof fetch>) => {
            const res = await realFetch(...a);
            ctrl.abort();
            return res;
        });
        try {
            await expect(fetchServiceHealth(at("/stalls-503"), ctrl.signal)).rejects.toThrow();
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it("throws when the connection drops mid-body, rather than calling the 503 down", async () => {
        await expect(fetchServiceHealth(at("/resets-503"))).rejects.toThrow();
    });

    it.each([["/not-found", 404], ["/rate-limited", 429]])(
        "leaves %s unmeasured: a 4xx is our address being wrong, not their health",
        async (path) => {
            expect(await fetchServiceHealth(at(path))).toBeNull();
        },
    );

    it("returns null for a 200 with no status to read", async () => {
        // city's aggregate. EcosystemFeed has its own branch for this; what
        // must not happen is inventing a verdict here.
        expect(await fetchServiceHealth(at("/aggregate"))).toBeNull();
    });

    it("passes an off-contract status through untranslated", async () => {
        const h = await fetchServiceHealth(at("/off-contract"));
        expect(h?.status).toBe("running");
    });

    it("throws when the service cannot be reached at all", async () => {
        // The signalmap case: a CORS wall or a dead host is "we cannot see it",
        // which is a different claim from "it says it is unwell". pollHealth
        // catches this into null, and the node reads unmeasured — never down.
        const unreachable = { id: "svc", statusUrl: "http://127.0.0.1:1/nope" } as RegistryService;
        await expect(fetchServiceHealth(unreachable)).rejects.toThrow();
    });

    it("reports the round trip it measured, and the service's own clock separately", async () => {
        const h = await fetchServiceHealth(at("/ok"));
        // A measured round trip: finite, not negative, and — against a local
        // server — far under the sweep's 10 s cap. `typeof` alone passes NaN,
        // and the upper bound catches a Date.now()/performance.now() mix.
        expect(Number.isFinite(h?.latencyMs)).toBe(true);
        expect(h!.latencyMs).toBeGreaterThanOrEqual(0);
        expect(h!.latencyMs).toBeLessThan(10_000);
        // checkedAt is the contract's `timestamp`: when the service generated
        // its answer. Conflating it with our latency would misdate both.
        expect(h?.checkedAt).toBe("2026-09-10T03:00:00.000Z");
    });

    it("returns null without a statusUrl rather than guessing an address", async () => {
        expect(await fetchServiceHealth({ id: "svc" } as RegistryService)).toBeNull();
    });
});

/**
 * city's aggregate is another origin's JSON, and every field of it reaches the
 * map and the sidebar. It is reshaped here, once, into exactly the fields this
 * monitor reads — so the renderers never meet a type the declaration denies.
 */
describe("fetchEcosystemHealth", () => {
    const answer = (body: unknown, status = 200) => {
        const fetch = vi.fn(async () => Response.json(body, { status }));
        vi.stubGlobal("fetch", fetch);
        return fetch;
    };

    afterEach(() => { vi.unstubAllGlobals(); });

    it("keeps only well-formed entries, rebuilt from the fields it reads", async () => {
        answer({
            checkedAt: "2026-09-21T00:00:00.000Z",
            summary: { ok: 1 },
            services: [
                null,
                "npc",
                { status: "ok" },                                   // no service to file it under
                { service: "alpha", status: 7 },                    // no verdict to read
                { service: 5, status: "ok" },
                { service: "beta", status: "" },                    // names no state
                {
                    service: "npc", status: "ok", host: "npc.moss.land",
                    httpCode: "200", latencyMs: '"><img src=x onerror=alert(1)>', checkedAt: 12,
                },
                { service: "signal", status: "degraded", httpCode: 503, latencyMs: 41, checkedAt: "2026-09-21T00:00:00.000Z" },
                { service: "wa", status: "running", latencyMs: Number.MAX_VALUE },
            ],
        });
        const { aggregate } = await fetchEcosystemHealth();

        expect(aggregate?.services).toEqual([
            { service: "npc", status: "ok", httpCode: undefined, latencyMs: undefined, checkedAt: undefined },
            { service: "signal", status: "degraded", httpCode: 503, latencyMs: 41, checkedAt: "2026-09-21T00:00:00.000Z" },
            // Off-contract strings still pass through untranslated.
            { service: "wa", status: "running", httpCode: undefined, latencyMs: Number.MAX_VALUE, checkedAt: undefined },
        ]);
        expect(aggregate?.checkedAt).toBe("2026-09-21T00:00:00.000Z");
    });

    it("drops a number the JSON text overflows to Infinity", async () => {
        // Response.json cannot carry this: JSON.stringify writes Infinity as null.
        // JSON.parse of real text does produce it, and it would render as "Infinityms".
        vi.stubGlobal("fetch", vi.fn(async () => new Response(
            '{"services":[{"service":"npc","status":"ok","httpCode":1e999,"latencyMs":1e999}]}',
            { status: 200, headers: { "content-type": "application/json" } },
        )));
        const { aggregate } = await fetchEcosystemHealth();
        expect(aggregate?.services[0]).toMatchObject({ service: "npc", status: "ok" });
        expect(aggregate?.services[0].latencyMs).toBeUndefined();
        expect(aggregate?.services[0].httpCode).toBeUndefined();
    });

    it("asks once, and reads city's own verdict from that same answer", async () => {
        const fetch = answer({ status: "degraded", services: [] }, 503);
        const { aggregate, own } = await fetchEcosystemHealth();

        expect(fetch).toHaveBeenCalledTimes(1);
        // A 5xx is not believed as a report on anyone else...
        expect(aggregate).toBeNull();
        // ...but it is city answering for itself, by the same rule as any service.
        expect(own).toMatchObject({ service: "city", status: "degraded", httpCode: 503 });
    });

    it("asks the network, never the HTTP cache", async () => {
        // The aggregate is served cacheable. Answered from disk, an old copy
        // would pass for this sweep's first-hand reading, even offline.
        const fetch = answer({ services: [] });
        await fetchEcosystemHealth();
        expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ cache: "no-store" }));
    });

    it.each<[string, unknown, number]>([
        ["no services list", { checkedAt: "x" }, 200],
        ["a services list that is not a list", { services: { npc: "ok" } }, 200],
        ["a JSON null", null, 200],
    ])("reports no aggregate for %s", async (_, body, status) => {
        answer(body, status);
        const { aggregate, own } = await fetchEcosystemHealth();
        expect(aggregate).toBeNull();
        expect(own).toBeNull();
    });
});
