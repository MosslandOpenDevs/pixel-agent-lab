# Mossland Space Hub — Governance Monitor

<!-- opendevs-badges:start -->
[![Lifecycle: Lab](https://img.shields.io/badge/Lifecycle-Lab-eab308?style=flat)](https://links.moss.land/ecosystem-registry.json)
[![CI](https://github.com/MosslandOpenDevs/pixel-agent-lab/actions/workflows/ci.yml/badge.svg)](https://github.com/MosslandOpenDevs/pixel-agent-lab/actions/workflows/ci.yml)
[![Website: monitor.moss.land](https://img.shields.io/badge/Website-monitor.moss.land-2563eb?style=flat)](https://monitor.moss.land/)
[![License: MIT](https://img.shields.io/badge/License-MIT-64748b?style=flat)](https://github.com/MosslandOpenDevs/pixel-agent-lab/blob/main/LICENSE)
<!-- opendevs-badges:end -->

**English** · [한국어](README.ko.md) · [Open the monitor](https://monitor.moss.land)

> **Lifecycle: Lab** — experimental, best-effort, and subject to change or retirement. The `monitor` entry in the [Mossland ecosystem registry](https://links.moss.land/ecosystem-registry.json) follows [MIP-1](https://agora.moss.land/proposals/6a85129f8be190cf5d2ebcc1), ratified on 2026-09-02.

An interactive map of the Mossland ecosystem, with pixel-art detail views for Algora, AO, and Bridge. It brings registry metadata, service health, and governance data into one static web app.

The map separates **what exists**, **what can be observed**, and **what a service reports**. A registry entry alone is not evidence that a service is healthy.

## Explore the monitor

**Map** is the default view. Registry entries orbit by section: Official, Participation, Developers, Markets, and Ecosystem. Hover over a body for details; click Algora, AO, or Bridge to open its detail view, or other entries to visit their destination. Clicking the monitor's own body recenters the map.

| Map form | Meaning |
| --- | --- |
| Streaming, with a ring | This monitor polls the service's data APIs: Algora, AO, or Bridge. This does not itself mean the service is healthy. |
| Health-checked | A health reading is available, directly or through the fallback aggregator. |
| Listed only | The registry lists the service, but no health reading is available. |
| Link or file | A reference such as an exchange listing, social account, or published file; excluded from service health counts. |

Colour shows `ok`, `degraded`, `down`, or no interpretable measurement. Archived/deprecated entries stay visible with subdued styling. The sidebar lists registry entries and lifecycle labels, service counts, API reachability, and governance figures.

The **Map / Algora / AO / Bridge** tabs work on desktop and mobile. Below 768px, the information panel opens from the menu button; between 768px and 1100px it sits above the stage. Crossing the mobile breakpoint reloads the app to fit its canvas. Reduced-motion preferences suppress map rotation and activity effects and remove tab-switch camera transitions.

## Governance detail views

The three services are independent. Their stage labels illustrate each service's workflow; they do not establish an implemented data handoff between services.

| View | Displays |
| --- | --- |
| **Algora · Sense & Detect** | A vertical signal belt, nine workflow stages, and agent clusters. The belt consumes a merged queue of signals fetched from **all three services**, not only Algora. |
| **AO · Debate & Plan** | Cached AO ideas and scores, debate topics/snippets, and Ideas / Plans / Projects totals. Idea bubbles illustrate score thresholds of 7 for a plan and 8 for a project. |
| **Bridge · Execute & Verify** | An L0–L4 workflow, specialist agents, proposal totals from stats, agent trust, and recent outcomes. The monitor does not fetch the full proposal collection. |

See [the service overview](docs/mossland-services-overview.md) for responsibilities and the conceptual governance loop. Its cross-service handoff model is a design sketch.

### Reading the data correctly

- **Polling, not a push stream.** Service APIs refresh 15 seconds after the previous cycle finishes. Health sweeps refresh after 60 seconds; the registry after 10 minutes. Requests have a 10-second cycle timeout.
- **API reachability and health are different.** A service gets a `LIVE` badge when its signals or stats request succeeds. The aggregate is `LIVE` when any of the three responds, `OFFLINE` when none responds, and `Connecting…` before the first verdict. The ecosystem health feed has its own status readings.
- **Health comes from evidence.** The browser reads service `statusUrl` addresses from the registry; direct readings override the [city health aggregate](https://city.moss.land/api/health). A declared status survives an HTTP error response. An unparseable 5xx means `down`; network/CORS failures and responses without a usable verdict do not by themselves prove an outage. Unknown status strings stay untranslated.
- **Motion has different meanings.** Map particles are triggered by newly ingested signals and capped for display; a ring sweep follows a completed health refresh. Galaxy rotation is decorative. Belt travel, stage promotion, and Bridge's proposal/proof animation illustrate workflows; they are not execution traces or proof that work completed.
- **Snapshots can be older than the latest poll.** Detail caches survive individual request failures, and a wholly unsuccessful health sweep retains the previous snapshot. AO can replay cached ideas. Missing trust scores or an absent success rate display `—`; an unavailable value must not be interpreted as a measured zero. This is an observational viewer, not an uptime or execution audit log.

## Run locally

Use **Node.js 22 LTS (22.12+) or Node.js 24 LTS** and npm. The development toolchain supports `^22.12.0 || ^24.0.0 || >=26.0.0`. The app uses TypeScript, Vite 7, Phaser 3, vanilla DOM/CSS, and Vitest.

```bash
npm ci
npm run dev
```

Vite prints the local URL, normally `http://localhost:5173`. The registry and health map use public cross-origin endpoints. To populate all governance detail views, run the three APIs locally or adjust the proxy targets in [vite.config.ts](vite.config.ts):

| Browser path | Default development upstream | Data read |
| --- | --- | --- |
| `/algora-api/*` | `http://localhost:3201/api/*` | Signals, issues, stats |
| `/ao-api/*` | `http://localhost:3001/*` | Signals, status, debates, ideas, plans, projects |
| `/bridge-api/*` | `http://localhost:3101/api/*` | Signals, stats, outcomes, agent trust |

API servers are separate projects and are not started by this repository. No frontend API key or `.env` file is required. Registry and fallback health URLs are defined in [ecosystem-client.ts](src/services/ecosystem-client.ts); direct health endpoints must permit browser access with CORS. In production all of them must also stay inside the page's Content-Security-Policy `connect-src` (see [Deploy](#deploy)).

### Verify and build

```bash
npm run typecheck
npm test
npm run build
```

[GitHub Actions](.github/workflows/ci.yml) runs these checks on every pull request, whatever its base branch, and on `main` after each merge, then confirms the build emitted a well-formed `dist/health.json` (`node scripts/check-health-json.mjs`). A branch pushed without an open pull request is not tested automatically; open a draft pull request or run the workflow by hand. Tests cover health-response interpretation, ecosystem feed behaviour, and how the origin serves a build (404 for missing files, no directory listing). Use `npm run test:watch` while working on those readers.

```bash
npm run preview       # inspect the production build locally
# or
npm run serve         # serve dist/ on port 6300
```

Preview and static serving do **not** provide the Vite development API proxies. Full production verification needs the reverse-proxy setup below.

## Deploy

Build the reviewed commit and publish `dist/`. Deployment is manual; GitHub Actions validates the change but does not deploy it. The repository supports static hosting directly or an existing PM2 installation using [ecosystem.config.cjs](ecosystem.config.cjs), which runs the installed local `serve` package on port 6300. Run `npm ci` before starting it.

The app has no pathname-based routes. Static serving deliberately returns **404 for missing files**, including JavaScript assets, instead of substituting `index.html`, and does not list directory contents. [public/serve.json](public/serve.json), which the build copies into `dist/`, turns off `serve`'s default directory index however `serve` is started on `dist/`. `serve` reads it at startup, so restart the process after deploying a build that changes it. Preserve both behaviours when using another host or reverse proxy.

[deploy/nginx.conf.example](deploy/nginx.conf.example) documents the production routes. Adjust domains, certificates, upstream addresses, and disk paths for your host. The deployment must provide:

1. The three same-origin API proxies, preserving the path rewrites in the table above.
2. An exact `/api/health` route to the generated `health.json`.
3. Revalidation for HTML and health responses, and immutable caching for content-hashed `/assets/` files. Phaser is built as its own chunk, so a deploy that changes only app code leaves it cached.
4. CORS for intended API consumers. The example reflects an origin allowlist, handles `OPTIONS`, and varies API responses by `Origin` and `Accept-Encoding`. The public health endpoint uses `Access-Control-Allow-Origin: *`.
5. Security headers on every response (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, HSTS) and a `Content-Security-Policy` on the page. nginx drops inherited `add_header` lines in any location that sets its own, so the example includes them in each location. The policy's `connect-src` allows `moss.land` and its subdomains, which covers the registry and health-aggregate URLs in [ecosystem-client.ts](src/services/ecosystem-client.ts) and every registry `statusUrl`. If any of them moves to another host, add that host first: development and CI send no CSP, so only production would block the request. A blocked read is never shown as an outage; the service just loses that reading.

After deployment, open the map and all three detail tabs at desktop and mobile widths. Check that API responses are JSON, service reachability settles, registry/health data loads, and browser assets load without errors. Verify `/api/health` returns JSON identifying the commit that was built, that a nonexistent `/assets/` file returns 404, and that `/assets/` itself lists no files: `serve` with public/serve.json answers 404, and nginx serving `dist/` directly answers 403. Check the security headers with `curl -sI https://monitor.moss.land/ | grep -i -e x-frame -e content-security`, and that the browser console reports no Content Security Policy violations.

### Monitor health endpoint

Every production build emits `dist/health.json`. The reverse proxy exposes it at [`/api/health`](https://monitor.moss.land/api/health):

```json
{
  "status": "ok",
  "service": "monitor",
  "role": "viewer",
  "pipeline": "none",
  "timestamp": "<build timestamp>",
  "buildTime": "<same build timestamp>",
  "commit": "<short Git commit, or null outside a Git checkout>"
}
```

This identifies the served frontend build. Its timestamp is the **build time**, not the last health poll or the freshness of upstream data. `status: "ok"` does not certify Algora, AO, Bridge, or the wider ecosystem. Vite development mode does not expose this route; local builds can be inspected at `/health.json` through preview/static serving.

## Related projects and license

- [Mossland ecosystem registry](https://links.moss.land) — service discovery and lifecycle metadata.
- [mossland-pixelops](https://github.com/MosslandOpenDevs/mossland-pixelops) — a related event-sourced pixel-art operations map.
- [MIT License](LICENSE).
