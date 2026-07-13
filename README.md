# Mossland Space Hub — Governance Monitor

**English** · [한국어](README.ko.md)

Mossland Space Hub is a live **space-logistics visualization** of Mossland's three core governance services — **Algora**, **AO**, and **Bridge** — rendering their real-time operations as conveyor belts and pixel agents on a single screen.

Each service runs its own pipeline **independently**; this dashboard gathers all three live streams into one operations map.

![Status](https://img.shields.io/badge/status-live-brightgreen)
[![Live](https://img.shields.io/badge/live-monitor.moss.land-brightgreen)](https://monitor.moss.land)
![Stack](https://img.shields.io/badge/stack-Vite%20%C2%B7%20TS%20%C2%B7%20Phaser%203-blue)
![License](https://img.shields.io/badge/license-MIT-blue)

https://github.com/user-attachments/assets/1e3ab6cb-41f0-4bff-a227-a6b4505b2c3e

## Why

- **Separation of responsibility at a glance** — see how three services split one governance loop across a single screen.
- **Trace the actual work** — follow each service's real processing stages as boxes move along its belt.
- **Input to outcome** — visualize the full flow from incoming signals to verified outcomes.

The conceptual governance loop the three services share:

`Signals → Issues → Debates/Plans → Execution/Delegation → Outcomes/Proof → Feedback`

> The screen renders the three services as **independent zones with no connecting lines** — the sidebar frames them as three independent services. For the real cross-service data-handoff contract, see [`docs/mossland-services-overview.md`](docs/mossland-services-overview.md).

## Services

| Service | Port | Role | Input | Output |
|---------|------|------|-------|--------|
| **Algora** | `:3201` | Sense & Detect | github / rss / social / chain signals | structured signals, prioritized issues |
| **AO** | `:3001` | Debate & Plan | signal / issue context | Ideas → Plans → Projects |
| **Bridge** | `:3101` | Execute & Verify | confirmed proposals / tasks | execution records, verified outcomes, trust scores |

### Algora — Sense & Detect · `:3201`

- **Responsibility** — multi-source signal collection, issue detection & prioritization, governance agenda-setting.
- **On screen:**
    - A `LOADER` bot picks up incoming signals and loads them onto a vertical conveyor belt.
    - 11 agent clusters (38 agents total): Visionaries · Builders · Investors · Guardians · Operatives · Moderators · Advisors · Orchestrators · Archivists · Red Team · Scouts.
    - A 9-stage pipeline: Signal Intake → Issue Detection → Workflow Dispatch → Specialist Work → Doc Production → Dual-House Vote → Approval Route → Execution → Outcome Verify.
    - Signals are promoted to issue cards partway along the belt; produced documents (`DP` · `GP` · `PA` · `WGC` · `ER` · `DR`) collect in a side dock.

### AO — Debate & Plan · `:3001`

- **Responsibility** — multi-agent debate; generating ideas, plans, and projects.
- **On screen:**
    - A loader bot feeds ideas onto a horizontal conveyor belt.
    - Agent ring: Diverge (16) → Converge (8) → Plan (10).
    - Score thresholds on the belt: **score ≥ 7 → Plan document**, **≥ 8 → Project box**, anything lower fades out.
    - Live Debate cards show the real debate topic and a snippet (falling back to "AO debates unavailable" when AO doesn't respond).
    - Bottom funnel: running totals of Ideas / Plans / Projects.

### Bridge — Execute & Verify · `:3101`

- **Responsibility** — execution/delegation, human voting, outcome/proof verification, trust metrics.
- **On screen:**
    - 5 specialist agents: Risk · Treasury · Community · Product · Moderator.
    - An L0→L4 pipeline: L0 Signal Collection → L1 Deliberation → L2 Human Voting → L3 Execution → L4 Outcome Proof (proposals swap to an outcome-proof at L4).
    - Trust & Outcomes panel: Agent Trust · Proposals · Success Rate, plus a recent outcome log.

## Interface

### Left panel
- **Connection status** — a single aggregate LIVE / OFFLINE (LIVE while any service is reachable; "OFFLINE — no service reachable" only when all three are down).
- **Stats** — signal queue, Algora issues, AO debate count.
- **Service I/O** — Algora / AO / Bridge listed separately, each with its own LIVE badge reflecting that service's reachability.
- **About** — a legend for the visualization.

### Right stage
- **Algora** — vertical belt + 9-stage pipeline + 11 agent-cluster arc.
- **AO** — horizontal belt (ideas promoted to Plan/Project by score threshold) + Debate cards + agent ring (Diverge/Converge/Plan).
- **Bridge** — horizontal belt (L0→L4) + 5 specialist agents + Trust & Outcomes panel.
- **Hub strip** — a full-width DataBridge status strip (aggregate connection · queue size · 15s polling).

### Mobile / responsive
- **< 768px** — a bottom tab bar (Algora / AO / Bridge) zooms one service zone at a time; a top-left ☰ button toggles the left panel as an overlay.
- **768–1100px** — the left panel lays out horizontally across the top.
- Crossing the mobile/desktop breakpoint (rotate/resize) re-initializes with the correct scale settings.
- Respects `prefers-reduced-motion` (pulses/transitions/camera pans are reduced).

### Live data
- All three services (Algora / AO / Bridge) are polled every **15 seconds**.
- Boxes on the **Algora** and **AO** belts are real signals and ideas pulled from each service's API; the **Bridge** lane animates a steady proposal flow while its real proposal, outcome, and trust data drive the L-stage stats and the Trust & Outcomes panel.
- Partial responses, missing fields, or a service outage never crash the view — the affected service simply drops its LIVE badge and falls back to placeholder counts while the rest keeps rendering.

## Data Flow (per zone · independent)

The three services run **their own pipelines** independently, with no connecting lines between them.

- **Algora** — signals arrive → `LOADER` loads the belt → 9 stages (issue promotion + document production) → discharged after Outcome Verify.
- **AO** — ideas arrive → promoted to Plan (≥ 7) / Project (≥ 8) by score, or fade out → funnel totals.
- **Bridge** — proposals arrive → run L0–L4 → swap to Outcome Proof at L4 → discharged.

When data is empty or a service is offline, each zone holds its placeholder state and the sidebar honestly reflects LIVE/OFFLINE per service.

## Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| 2D engine | Phaser 3 | Belt/agent animation, per-zone camera pan/zoom |
| Language | TypeScript | Typed service clients and world state |
| Build | Vite 7 | Fast dev server + static SPA build |
| UI | None (vanilla DOM) | Sidebar/panel are plain DOM; no framework |
| Serve | `serve` / PM2 | Static `dist` hosting in production |

Static SPA, no UI framework. Requires Node `>= 20.19` (Vite 7).

## Running Locally

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
```

Serve the build output:

```bash
npm run serve          # serve dist -l 6300 -s
# or with PM2
pm2 start ecosystem.config.cjs
```

## Deployment

The frontend is a static SPA — serve `dist/` from any static host.

At runtime the app calls the three service APIs on **same-origin** paths:

- `/algora-api` → Algora signals/issues/stats
- `/ao-api` → AO signals/debates/status/ideas/plans/projects
- `/bridge-api` → Bridge signals/stats/proposals/outcomes/trust

In development, `vite.config.ts`'s dev proxy maps these to `localhost:3201 / 3001 / 3101`. **The dev proxy does not run in production**, so a reverse proxy (nginx, etc.) in front of the static files must proxy these three paths to each service upstream.

See [`deploy/nginx.conf.example`](deploy/nginx.conf.example) for a sample config. Current deployment: `https://monitor.moss.land` (static `dist` + nginx reverse proxy).

### CORS (cross-origin consumers)

The monitor's API paths are called not only same-origin but also from **other origins** (e.g. the governance widget on the moss.land homepage). So the reverse proxy must **not hardcode** `Access-Control-Allow-Origin` to a single apex — it should **reflect** an allow-list of origins (`moss.land`, `www.moss.land`, dev `localhost:5173`) and answer `OPTIONS` preflight requests. See the `map $http_origin` block and the per-`/…-api/` CORS headers in the example config. (GitHub issue #1)

## Related Projects

- [`mossland-pixelops`](https://github.com/MosslandOpenDevs/mossland-pixelops) — a sibling, earlier-stage re-architecture of the same governance-visualization idea (an event-sourced pixel-art operations map), currently a pre-alpha scaffold.

## License

MIT — see [LICENSE](LICENSE) for details.
