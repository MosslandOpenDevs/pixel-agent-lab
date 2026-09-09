import { defineConfig, type Plugin } from "vite";
import { execSync } from "node:child_process";

/**
 * Emits `health.json` into the build, which nginx serves as `/api/health`.
 *
 * Shape follows the ecosystem health contract (HEALTH_CONTRACT.md in the links
 * repo): `status`, `service` and `timestamp` are the three fields every Mossland
 * service publishes; everything below them is monitor's own.
 *
 * Monitor is a static viewer: it runs no pipeline, so it has no "last processed"
 * time to report and deliberately omits `lastProcessedAt` while declaring
 * `pipeline: "none"` — consumers are told not to look for freshness here.
 *
 * What it can honestly report is which build is deployed. For a viewer the
 * artifact *is* the content, so a redeploy really is new content — unlike a
 * data service, where a no-op rebuild would overstate freshness.
 *
 * Fetching it also proves more than a hardcoded `{"status":"ok"}` would: the
 * response only arrives if nginx is up, the origin behind it is up, and the
 * build currently on disk is the one being served.
 */
function healthEndpoint(): Plugin {
    return {
        name: "monitor-health-endpoint",
        apply: "build",
        generateBundle() {
            let commit: string | null = null;
            try {
                commit = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
                    .toString().trim() || null;
            } catch {
                // Building outside a git checkout (e.g. from a tarball) is fine;
                // report null rather than inventing a value.
            }
            // One instant, two names. `timestamp` is what the ecosystem health
            // contract calls it; `buildTime` is what it actually is. They cannot
            // drift because there is only one value, and `pipeline: "none"` above
            // still tells a consumer not to read data freshness out of either.
            const buildTime = new Date().toISOString();
            this.emitFile({
                type: "asset",
                fileName: "health.json",
                source: JSON.stringify({
                    status: "ok",
                    service: "monitor",
                    role: "viewer",
                    pipeline: "none",
                    timestamp: buildTime,
                    buildTime,
                    commit,
                }, null, 2) + "\n",
            });
        },
    };
}

export default defineConfig({
    plugins: [healthEndpoint()],
    server: {
        proxy: {
            "/algora-api": {
                target: "http://localhost:3201",
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/algora-api/, "/api"),
            },
            "/ao-api": {
                target: "http://localhost:3001",
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/ao-api/, ""),
            },
            "/bridge-api": {
                target: "http://localhost:3101",
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/bridge-api/, "/api"),
            },
        },
    },
});
