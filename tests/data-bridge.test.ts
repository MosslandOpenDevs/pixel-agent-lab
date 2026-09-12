import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataBridge } from "../src/services/data-bridge.ts";

describe("DataBridge signal identity", () => {
    let bridge: DataBridge;

    beforeEach(() => {
        vi.useFakeTimers();
        bridge = new DataBridge();
        vi.stubGlobal("fetch", vi.fn(async (url: string) => {
            // Independent services can use the same primary key. Repeating a
            // row within each response also exercises each origin's dedupe.
            const signal = {
                id: "shared-id", source: "github", category: "dev",
                description: "A signal", title: "A signal", summary: "A signal",
                metadata: "{}", timestamp: "2026-09-13T00:00:00Z",
                collected_at: "2026-09-13T00:00:00Z",
            };
            return Response.json(url.includes("/signals?") ? { signals: [signal, signal] } : {});
        }));
    });

    afterEach(() => {
        bridge.destroy();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it("ingests identical ids from different services once per origin", async () => {
        await bridge.init();

        expect(bridge.ingested).toEqual({ algora: 1, ao: 1, bridge: 1 });
        expect(bridge.queueSize()).toBe(3);
        const origins = Array.from({ length: 3 }, () => bridge.nextSignal()?.origin).sort();
        expect(origins).toEqual(["algora", "ao", "bridge"]);

        // Draining the animation queue must not replay the same signals at
        // the next refresh, even though their ids collide across services.
        await vi.advanceTimersByTimeAsync(15_000);
        expect(bridge.queueSize()).toBe(0);
        expect(bridge.ingested).toEqual({ algora: 1, ao: 1, bridge: 1 });
    });
});
