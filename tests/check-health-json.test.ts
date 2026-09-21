import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

/**
 * The CI step that checks dist/health.json after the build.
 *
 * A gate is only worth its green if it can go red, so this drives the real
 * script against documents that are each wrong in one way the build could
 * plausibly produce, and against the one it should accept.
 */

const script = fileURLToPath(new URL("../scripts/check-health-json.mjs", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "monitor-health-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// The shape the monitor-health-endpoint plugin in vite.config.ts emits,
// written out by hand: this pins what the script accepts, not what the plugin
// produces. CI's step after `npm run build` runs the script on the real
// dist/health.json.
const GOOD = {
    status: "ok",
    service: "monitor",
    role: "viewer",
    pipeline: "none",
    timestamp: "2026-09-21T09:48:32.791Z",
    buildTime: "2026-09-21T09:48:32.791Z",
    commit: "9972730",
};

let n = 0;
function check(contents: string | undefined) {
    const file = join(dir, `health-${n++}.json`);
    if (contents !== undefined) writeFileSync(file, contents);
    const r = spawnSync(process.execPath, [script, file], { encoding: "utf8" });
    return { code: r.status, stderr: r.stderr };
}
const checkDoc = (doc: object) => check(JSON.stringify(doc));

describe("scripts/check-health-json.mjs", () => {
    it("accepts a document in the plugin's shape", () => {
        expect(checkDoc(GOOD).code).toBe(0);
    });

    it("fails when the build emitted no health.json", () => {
        const r = check(undefined);
        expect(r.code).toBe(1);
        expect(r.stderr).toMatch(/cannot read/);
    });

    it("fails on a file that is not JSON", () => {
        expect(check("<!doctype html><p>404</p>").code).toBe(1);
    });

    // The static-artifact contract: one frozen instant under two names. A
    // well-meant "fix" that stamps a fresher time into `timestamp` would
    // overstate freshness for a viewer that processes nothing.
    it("fails when timestamp and buildTime drift apart", () => {
        const r = checkDoc({ ...GOOD, timestamp: "2026-09-21T10:00:00.000Z" });
        expect(r.code).toBe(1);
        expect(r.stderr).toMatch(/timestamp should equal buildTime/);
    });

    // Both undefined would satisfy `timestamp === buildTime` on its own.
    it("fails when both times are missing rather than treating them as equal", () => {
        const { timestamp: _t, buildTime: _b, ...rest } = GOOD;
        const r = checkDoc(rest);
        expect(r.code).toBe(1);
        expect(r.stderr).toMatch(/buildTime should be an ISO timestamp/);
    });

    it("fails on a freshness field monitor has no pipeline to back", () => {
        expect(checkDoc({ ...GOOD, lastProcessedAt: GOOD.buildTime }).code).toBe(1);
        expect(checkDoc({ ...GOOD, pipeline: "batch" }).code).toBe(1);
    });

    // CI always builds in a git checkout; null means the lookup broke.
    it("fails when the build could not name its commit", () => {
        expect(checkDoc({ ...GOOD, commit: null }).code).toBe(1);
        expect(checkDoc({ ...GOOD, commit: "" }).code).toBe(1);
    });

    it("fails on the wrong identity or verdict", () => {
        expect(checkDoc({ ...GOOD, service: "pixel-agent-lab" }).code).toBe(1);
        expect(checkDoc({ ...GOOD, status: "healthy" }).code).toBe(1);
    });
});
