import { describe, expect, it } from "vitest";
import { kindOf } from "../src/services/ecosystem-feed.ts";
import type { RegistryService } from "../src/services/types.ts";

/**
 * Which registry entries "is it up?" is even a sensible question about.
 *
 * The map used to draw all 28 visible entries as bodies that could be up or
 * down. Most of them cannot be: llms.txt is a file, Upbit is somebody else's
 * exchange. The rules read the registry rather than naming ids, so the risk
 * this guards is the opposite of a typo — a plausible-looking reordering that
 * quietly reclassifies a whole tier.
 */

const entry = (o: Partial<RegistryService>): RegistryService =>
    ({ id: "x", owner: "mossland", ...o } as RegistryService);

describe("kindOf", () => {
    it("reads `artifact: true` before anything else", () => {
        // The three file entries are also tier `developer`, and being a file is
        // the more specific truth — so this must be checked first or llms.txt
        // becomes a link and the distinction is lost.
        expect(kindOf(entry({ id: "llms-txt", artifact: true, tier: "developer" }))).toBe("artifact");
    });

    it("calls anything we do not own a link", () => {
        expect(kindOf(entry({ id: "upbit", owner: "third-party", tier: "third_party" }))).toBe("link");
    });

    it("calls our own destinations links too", () => {
        // Ours, but they are places to go, not services to grade.
        expect(kindOf(entry({ id: "github-mossland", tier: "developer" }))).toBe("link");
        expect(kindOf(entry({ id: "medium", tier: "channel" }))).toBe("link");
    });

    it("calls everything else a service", () => {
        expect(kindOf(entry({ id: "moss", tier: "official" }))).toBe("service");
        expect(kindOf(entry({ id: "ao", tier: "labs" }))).toBe("service");
        // Archived is still a service — it has a body that can be up or down.
        // The dimming is applied separately.
        expect(kindOf(entry({ id: "algora", tier: "labs", lifecycle: "archive" }))).toBe("service");
    });
});
