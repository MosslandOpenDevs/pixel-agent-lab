import { describe, expect, it } from "vitest";
import { hubTooltipHtml } from "../src/ui/hub-tooltip.ts";
import type { EcosystemNode } from "../src/services/ecosystem-feed.ts";
import type { HealthEntry, RegistryService } from "../src/services/types.ts";

/**
 * What the map's hover card writes into its markup.
 *
 * The registry and city's aggregate are other origins' JSON, and both reach
 * this card. The registry is checked only for a string id, so a row's name or
 * lifecycle can be anything; a latency that is not a number is already dropped
 * at ingest, and the escape here is the sink's own second layer behind that.
 */

const node = (o: Partial<RegistryService>, health: HealthEntry | null, kind: EcosystemNode["kind"] = "service"): EcosystemNode => ({
    service: { id: "svc", name: "Svc", url: "https://svc.moss.land", section: "ecosystem", tier: "labs", ...o } as RegistryService,
    health, instrumentation: health ? "health" : "listed", kind,
});
const plain = { isSelf: false, archived: false };

describe("hubTooltipHtml", () => {
    it("renders an ordinary reading", () => {
        const html = hubTooltipHtml(node({ lifecycle: "beta" }, { service: "svc", status: "ok", latencyMs: 21 }), plain);
        expect(html).toContain('<b class="ok">health ok</b> · 21ms');
        expect(html).toContain("beta · health");
        expect(html).toContain("click to open the service");
    });

    it("renders a registry row whose name or lifecycle is not a string, rather than throwing", () => {
        // What the string-only helper threw on, inside the hover handler.
        expect(() => hubTooltipHtml(node({ name: undefined as never }, null), plain)).not.toThrow();
        const html = hubTooltipHtml(node({ name: 42 as never, lifecycle: 7 as never }, null), plain);
        expect(html).toContain('<div class="t">42</div>');
        expect(html).toContain("7 · listed");
        expect(html).toContain("not measured by this monitor");
    });

    it("escapes a hostile status and latency, and never takes its class from the status", () => {
        const html = hubTooltipHtml(node({}, {
            service: "svc", status: '<b>"running"</b>', latencyMs: '"><img src=x onerror=alert(1)>' as never,
        }), plain);
        expect(html).not.toContain("<img");
        expect(html).not.toContain('<b>"running"');
        expect(html).toContain('<b class="unknown">health &lt;b&gt;&quot;running&quot;&lt;/b&gt;</b>');
        expect(html).toContain(" · &quot;&gt;&lt;img src=x onerror=alert(1)&gt;ms");
    });

    it("gives files and links no health line, whatever turned up under their id", () => {
        const reading: HealthEntry = { service: "svc", status: "ok" };
        expect(hubTooltipHtml(node({}, reading, "artifact"), plain)).not.toContain("health ok");
        expect(hubTooltipHtml(node({}, reading, "artifact"), plain)).toContain("a published file, not a service");
        expect(hubTooltipHtml(node({}, reading, "link"), plain)).toContain("an external destination");
    });

    it("says so when the body is this monitor, or archived", () => {
        const html = hubTooltipHtml(node({}, null), { isSelf: true, archived: true });
        expect(html).toContain("you are here — click to recentre");
        expect(html).toContain("archived — preserved read-only");
    });
});
