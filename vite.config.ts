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

/**
 * Phaser is ~95% of the shipped JavaScript and changes only when the lockfile
 * does, so it is built as a chunk of its own (`build.rollupOptions` below).
 * /assets/ is served `immutable`, and a separate chunk keeps its content hash
 * across app-only deploys: a returning visitor re-downloads under 30 kB gzip
 * of app code instead of ~360 kB. A Phaser, Rollup or esbuild bump still
 * changes that chunk, as it should. Vite preloads it with
 * <link rel="modulepreload">, so a first visit is no slower for it.
 *
 * That split trips Vite's chunk-size warning on every build, and Vite's limit
 * is global: raising it far enough for Phaser (~1.2 MB minified) would also
 * stop it watching the app chunk, which is the one that can grow by accident.
 * So the global limit is set just above Phaser, and this plugin re-applies
 * Vite's default 500 kB to every other chunk. Like Vite's own, it warns and
 * does not fail the build. It is also the sign that the split has stopped
 * working — after a bundler upgrade, say — because Phaser would be back inside
 * the app chunk and set it off.
 */
const VENDOR_CHUNK = "phaser";
const VENDOR_CHUNK_WARNING_KB = 1300;
const APP_CHUNK_WARNING_KB = 500; // Vite's default chunkSizeWarningLimit

function appChunkSizeWarning(): Plugin {
    return {
        name: "monitor-app-chunk-size",
        apply: "build",
        generateBundle(_options, bundle) {
            for (const file of Object.values(bundle)) {
                if (file.type !== "chunk" || file.name === VENDOR_CHUNK) continue;
                // Measured the way Vite's reporter measures it: minified bytes / 1000.
                const kB = Buffer.byteLength(file.code) / 1000;
                if (kB > APP_CHUNK_WARNING_KB) {
                    this.warn(
                        `${file.fileName} is ${kB.toFixed(0)} kB after minification ` +
                        `(limit ${APP_CHUNK_WARNING_KB} kB for app chunks). If Phaser ` +
                        `is inside it, the "${VENDOR_CHUNK}" manualChunks split no longer applies.`,
                    );
                }
            }
        },
    };
}

export default defineConfig({
    plugins: [healthEndpoint(), appChunkSizeWarning()],
    build: {
        chunkSizeWarningLimit: VENDOR_CHUNK_WARNING_KB,
        rollupOptions: {
            output: {
                // Rollup's option. If Vite moves to Rolldown (Vite 8), port this
                // to its own chunk-grouping option and check that dist/assets/
                // still has a separate phaser-*.js.
                manualChunks: { [VENDOR_CHUNK]: ["phaser"] },
            },
        },
    },
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
