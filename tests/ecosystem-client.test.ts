import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchServiceHealth } from "../src/services/ecosystem-client.ts";
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

let server: Server;
let base = "";

beforeAll(async () => {
    server = createServer((req, res) => {
        const c = CASES[req.url ?? ""];
        if (!c) { res.writeHead(404); res.end(); return; }
        res.writeHead(c.code, { "content-type": c.type });
        res.end(c.body);
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

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
        expect(typeof h?.latencyMs).toBe("number");
        // checkedAt is the contract's `timestamp`: when the service generated
        // its answer. Conflating it with our latency would misdate both.
        expect(h?.checkedAt).toBe("2026-09-10T03:00:00.000Z");
    });

    it("returns null without a statusUrl rather than guessing an address", async () => {
        expect(await fetchServiceHealth({ id: "svc" } as RegistryService)).toBeNull();
    });
});
