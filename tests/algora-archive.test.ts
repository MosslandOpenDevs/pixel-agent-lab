import { afterEach, describe, expect, it, vi } from "vitest";
import { DataBridge, POLL_INTERVAL_MS } from "../src/services/data-bridge.ts";
import { fetchAlgoraStats } from "../src/services/algora-client.ts";
import { EcosystemFeed } from "../src/services/ecosystem-feed.ts";

const stats = { activeAgents: 0, totalAgents: 38, activeSessions: 0, signalsToday: 113, openIssues: 123 };
const marker = { "X-Algora-Archive": "snapshot=2026-10-12T02:38:05Z" };
const json = (body: unknown, headers?: Record<string, string>) => Response.json(body, { headers });
let bridge: DataBridge | undefined;
let feed: EcosystemFeed | undefined;
afterEach(() => { bridge?.destroy(); feed?.destroy(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("Algora archive transition", () => {
    it("recognizes the archive header on a successful stats response and bypasses old HTTP cache", async () => {
        const fetcher = vi.fn(async () => json(stats, marker));
        vi.stubGlobal("fetch", fetcher);
        expect(await fetchAlgoraStats()).toEqual({ ...stats, archived: true });
        expect(fetcher).toHaveBeenCalledWith("/algora-api/stats", { signal: undefined, cache: "no-store" });
    });

    it("stops Algora polling and live totals after a static 200, while AO and Bridge continue", async () => {
        vi.useFakeTimers();
        const calls: string[] = [];
        vi.stubGlobal("fetch", vi.fn(async (url: string) => {
            calls.push(url);
            if (url === "/algora-api/stats") return json(stats, marker);
            if (url.startsWith("/algora-api/signals")) return new Response("{}", { status: 404, headers: marker });
            if (url.includes("/signals?")) return json({ signals: [] });
            if (url.endsWith("/status")) return json({ stats: { signals_today: 1 } });
            if (url.endsWith("/stats")) return json({ signals: { total: 1 } });
            return json({ debates: [], ideas: [], outcomes: [], leaderboard: [], total: 0 });
        }));
        bridge = new DataBridge();
        await bridge.init();
        expect(bridge.algoraArchived).toBe(true);
        expect(bridge.serviceUp).toEqual({ algora: false, ao: true, bridge: true });
        expect(bridge.statsUp.algora).toBe(false);
        expect(bridge.liveStats.algora).toBeNull();
        expect(bridge.statsAt.algora).toBeNull();
        expect(bridge.connectionState()).toBe("live");
        const before = calls.filter(u => u.startsWith("/algora-api/"));
        const aoBefore = calls.filter(u => u.startsWith("/ao-api/signals")).length;
        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
        expect(calls.filter(u => u.startsWith("/algora-api/"))).toEqual(before);
        expect(calls.filter(u => u.startsWith("/ao-api/signals")).length).toBeGreaterThan(aoBefore);
    });

    it("does not let a late pre-transition signal response refill the archived queue", async () => {
        vi.useFakeTimers();
        let resolveSignals!: (response: Response) => void;
        vi.stubGlobal("fetch", vi.fn(async (url: string) => {
            if (url === "/algora-api/stats") return json(stats, marker);
            if (url.startsWith("/algora-api/signals")) return new Promise<Response>(resolve => { resolveSignals = resolve; });
            if (url.includes("/signals?")) return json({ signals: [] });
            return json({ debates: [], ideas: [], outcomes: [], leaderboard: [], total: 0 });
        }));
        bridge = new DataBridge();
        const initialized = bridge.init();
        await vi.advanceTimersByTimeAsync(0);
        expect(bridge.algoraArchived).toBe(true);
        resolveSignals(json({ signals: [{ id: "old-signal", metadata: "{}", description: "Old signal" }] }));
        await initialized;
        expect(bridge.queueSize()).toBe(0);
        expect(bridge.newSignals.algora).toBe(0);
        expect(bridge.serviceUp.algora).toBe(false);
    });

    it("keeps archive health on the map without classifying it as a stream", async () => {
        vi.useFakeTimers();
        vi.stubGlobal("fetch", vi.fn(async (url: string) => {
            if (url.includes("ecosystem-registry.json")) return json({ services: [{ id: "algora", name: "Algora", domain: "algora.moss.land", url: "https://algora.moss.land", owner: "mossland", tier: "labs", section: "ecosystem", status: "deprecated", lifecycle: "archive", statusUrl: "https://algora.moss.land/api/health" }] });
            if (url.includes("algora.moss.land")) return json({ status: "ok", service: "algora", archived: true });
            return json({ services: [], summary: { total: 0, ok: 0, degraded: 0, down: 0 } });
        }));
        feed = new EcosystemFeed();
        await feed.init();
        feed.archiveDataSource("algora");
        expect(feed.nodes()).toHaveLength(1);
        expect(feed.nodes()[0].instrumentation).toBe("health");
        expect(feed.nodes()[0].health?.status).toBe("ok");
    });
});
