import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * How the origin serves a build: the `serve` process ecosystem.config.cjs
 * starts, run with those exact args against a stand-in dist/.
 *
 * Two behaviours ride on configuration that nothing else exercises before a
 * deploy, and both fail quietly:
 * - Missing files are 404, not index.html at 200. The app has no pathname
 *   routes, and a fallback turns a missing hashed asset into HTML that the
 *   browser then fails to run as a script. Re-adding `-s` would do that.
 * - Directories are not listed. serve lists them by default, as HTML or as
 *   JSON; public/serve.json, which the build copies into dist/, is the only
 *   thing turning that off.
 *
 * The real server is spawned rather than serve-handler called directly,
 * because the second behaviour depends on serve finding serve.json in the
 * served directory on its own — a handler handed the config would pass even
 * if that lookup stopped happening.
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const pm2 = createRequire(import.meta.url)("../ecosystem.config.cjs").apps[0] as {
    script: string;
    args: string;
    env?: Record<string, string>;
};

let dist = "";
let child: ChildProcess | undefined;
let base = "";

/** The PM2 args with only the directory and the port swapped for this test. */
function argsFor(dir: string): string[] {
    const args = pm2.args.split(/\s+/);
    // Everything else — flags added later included — is passed through as is.
    expect(args[0]).toBe("dist");
    args[0] = dir;
    const listen = args.findIndex(a => a === "-l" || a === "--listen");
    expect(listen).toBeGreaterThan(0);
    args[listen + 1] = "tcp://127.0.0.1:0";
    return args;
}

beforeAll(async () => {
    // What a build leaves in dist/: public/ copied verbatim, plus index.html
    // and hashed assets.
    dist = mkdtempSync(join(tmpdir(), "monitor-dist-"));
    cpSync(join(root, "public"), dist, { recursive: true });
    writeFileSync(join(dist, "index.html"), "<!doctype html><title>monitor-test-index</title>\n");
    mkdirSync(join(dist, "assets"));
    writeFileSync(join(dist, "assets", "index-abc123.js"), "console.log('app');\n");

    child = spawn(process.execPath, [join(root, pm2.script), ...argsFor(dist)], {
        cwd: root,
        // NO_UPDATE_CHECK: serve otherwise asks the npm registry for a newer
        // version before it starts listening.
        env: { ...process.env, ...pm2.env, NO_UPDATE_CHECK: "1" },
        stdio: ["ignore", "pipe", "pipe"],
    });
    base = await new Promise<string>((resolve, reject) => {
        let out = "";
        const onData = (chunk: Buffer) => {
            out += chunk.toString();
            const m = /Accepting connections at (http:\/\/\S+)/.exec(out);
            if (m) resolve(m[1]);
        };
        child!.stdout!.on("data", onData);
        child!.stderr!.on("data", onData);
        child!.on("exit", code => reject(new Error(`serve exited (${code}) before listening:\n${out}`)));
    });
}, 15_000);

afterAll(() => {
    child?.kill();
    if (dist) rmSync(dist, { recursive: true, force: true });
});

const get = (path: string, headers: Record<string, string> = {}) =>
    fetch(`${base}${path}`, { headers, redirect: "manual" });

describe("static serving (ecosystem.config.cjs + public/serve.json)", () => {
    it("serves index.html at /", async () => {
        const res = await get("/");
        expect(res.status).toBe(200);
        expect(await res.text()).toContain("monitor-test-index");
    });

    it("serves a hashed asset that exists", async () => {
        const res = await get("/assets/index-abc123.js");
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toMatch(/javascript/);
    });

    it("answers a missing asset with 404, not index.html", async () => {
        const res = await get("/assets/index-gone999.js");
        expect(res.status).toBe(404);
        expect(await res.text()).not.toContain("monitor-test-index");
    });

    it("answers a path the app does not route with 404, not index.html", async () => {
        const res = await get("/algora");
        expect(res.status).toBe(404);
        expect(await res.text()).not.toContain("monitor-test-index");
    });

    it("does not list a directory", async () => {
        for (const path of ["/assets/", "/assets"]) {
            const res = await get(path);
            expect(res.status, path).toBe(404);
            expect(await res.text(), path).not.toContain("index-abc123.js");
        }
    });

    it("does not list a directory as JSON either", async () => {
        const res = await get("/assets/", { accept: "application/json" });
        expect(res.status).toBe(404);
        const body = await res.text();
        expect(body).not.toContain("index-abc123.js");
        expect(body).not.toContain(dist);
    });
});
