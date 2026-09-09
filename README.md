# Mossland Space Hub — Governance Monitor

> **Status of this repository:** **`Lifecycle: Lab`** (실험, best-effort) — per [MIP-1](https://agora.moss.land/proposals/6a85129f8be190cf5d2ebcc1), ratified 2026-09-02, and the [links.moss.land registry](https://links.moss.land/ecosystem-registry.json) entry `monitor`. May change or stop without notice.

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

> The screen renders the three services as **independent zones with no connecting lines** — the sidebar frames them as three independent services. For the conceptual cross-service data-handoff model, see [`docs/mossland-services-overview.md`](docs/mossland-services-overview.md) (its handoff section is explicitly a design sketch, not an implemented contract).

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
    - Signals are promoted to issue cards partway along the belt; a fixed legend below the stage column names the document types the pipeline produces (`DP` · `GP` · `PA` · `WGC` · `ER` · `DR`). The legend is static — it labels the types rather than counting them.

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
- **Connection status** — a single aggregate `Connecting…` / `LIVE` / `OFFLINE`. It stays `Connecting…` until the first poll settles, is `LIVE` while any service is reachable, and only reports "OFFLINE — no service reachable" once a poll has actually found all three down.
- **Stats** — signal queue depth, Algora open issues, and AO debates today. The last two are the services' own totals; a service that did not respond shows `—`.
- **Service I/O** — Algora / AO / Bridge listed separately, each with its own LIVE badge reflecting that service's reachability.
- **About** — a one-paragraph description of what the screen is showing.

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
- The **Algora** belt is fed from a single merged queue of live signals from all three services' signal endpoints — it shows the whole sensed stream, not Algora-only traffic. **AO** belt bubbles are real AO ideas, and the belt stays empty when none are cached rather than inventing placeholder ones. The **Bridge** lane animates a steady proposal flow, and its proposal counts come from `/bridge-api/stats`. Its Trust & Outcomes panel currently has **no data to show**: `/bridge-api/outcomes` and `/bridge-api/trust/leaderboard/*` both return empty lists, and `outcomes.successRate` is `null`, so those figures render as `—` rather than as `0%`. (The `L0`-`L4` stage labels are static — no live figures are attached to them.)
- Partial responses, missing fields, or a service outage never crash the view — the affected service drops its LIVE badge and its figures show `—`, while the rest keeps rendering. No number is ever substituted from another source in place of a figure the service did not return.

## Data Flow (per zone · independent)

The three services run **their own pipelines** independently, with no connecting lines between them.

- **Algora** — signals arrive → `LOADER` loads the belt → 9 stages (issue promotion + document production) → discharged after Outcome Verify.
- **AO** — ideas arrive → promoted to Plan (≥ 7) / Project (≥ 8) by score, or fade out → funnel totals.
- **Bridge** — proposals arrive → run L0–L4 → swap to Outcome Proof at L4 → discharged.

When data is empty or a service is offline, each zone goes quiet rather than manufacturing items, and the sidebar honestly reflects LIVE/OFFLINE per service.

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
