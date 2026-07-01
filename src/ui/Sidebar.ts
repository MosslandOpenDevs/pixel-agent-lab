import type { DataBridge } from "../services/data-bridge.ts";

let statsEl: HTMLDivElement;
let serviceEl: HTMLDivElement;
let connEl: HTMLDivElement;

export function initSidebar(): void {
    const app = document.querySelector<HTMLDivElement>("#app")!;
    app.innerHTML = `
<div class="layout">
  <button id="panelToggle" class="panel-toggle" aria-label="Toggle info panel" aria-controls="panelAside" aria-expanded="false">☰</button>
  <aside id="panelAside" class="panel">
    <h1>Mossland Space Hub</h1>
    <p class="sub">Governance Monitor · 3 Independent Services</p>
    <div id="connStatus" class="conn-status"><span class="dot connecting"></span> Connecting...</div>
    <div id="stats" class="stats"></div>
    <div id="serviceStatus" class="stats"></div>
    <div class="detail">
      <h2>About</h2>
      <div class="detail-desc">Three independent Mossland services, each polled live every 15 seconds. Boxes moving along the belts are real signals, ideas, and proposals flowing through each service's pipeline.</div>
    </div>
  </aside>
  <div class="panel-backdrop"></div>
  <main class="stage-wrap">
    <div id="stage"></div>
  </main>
  <nav class="zone-tabs" role="tablist" aria-label="Service zone">
    <button class="zone-tab active" data-zone="algora" role="tab" aria-selected="true">Algora</button>
    <button class="zone-tab" data-zone="ao" role="tab" aria-selected="false">AO</button>
    <button class="zone-tab" data-zone="bridge" role="tab" aria-selected="false">Bridge</button>
  </nav>
</div>
`;
    statsEl = document.querySelector<HTMLDivElement>("#stats")!;
    serviceEl = document.querySelector<HTMLDivElement>("#serviceStatus")!;
    connEl = document.querySelector<HTMLDivElement>("#connStatus")!;

    // mobile panel toggle
    const toggle = document.getElementById("panelToggle")!;
    const panel = document.querySelector<HTMLElement>(".panel")!;
    const backdrop = document.querySelector<HTMLElement>(".panel-backdrop")!;
    const setPanelOpen = (open: boolean) => {
        panel.classList.toggle("open", open);
        backdrop.classList.toggle("open", open);
        toggle.setAttribute("aria-expanded", String(open));
    };
    toggle.addEventListener("click", () => setPanelOpen(!panel.classList.contains("open")));
    backdrop.addEventListener("click", () => setPanelOpen(false));

    // zone tabs for mobile
    document.querySelectorAll<HTMLButtonElement>(".zone-tab").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll<HTMLButtonElement>(".zone-tab").forEach(b => {
                const active = b === btn;
                b.classList.toggle("active", active);
                b.setAttribute("aria-selected", String(active));
            });
            document.dispatchEvent(new CustomEvent("zone-switch", {
                detail: { zone: btn.dataset.zone },
            }));
        });
    });
}

export function setConnectionStatus(live: boolean): void {
    if (live) {
        connEl.innerHTML = `<span class="dot live"></span> LIVE — Real-time service data`;
    } else {
        connEl.innerHTML = `<span class="dot offline"></span> OFFLINE — no service reachable`;
    }
}

export function updateSidebar(
    dataBridge: DataBridge,
    zoneStats: {
        algora: { signals: number; issues: number; docs: number };
        ao: { ideas: number; plans: number; projects: number };
        bridge: { proposals: number; outcomes: number; successRate: number };
    },
): void {
    const ls = dataBridge.liveStats;
    const up = dataBridge.serviceUp;
    const live = dataBridge.isConnected();

    // pipeline summary stats
    statsEl.innerHTML = `
    <div class="row"><span>Monitoring</span><b>Algora (Sense) | AO (Plan) | Bridge (Execute)</b></div>
    <div class="row"><span>Signal Queue</span><b>${dataBridge.queueSize()}</b></div>
    <div class="row"><span>Algora Issues</span><b>${dataBridge.issueCache.length}</b></div>
    <div class="row"><span>AO Debates</span><b>${dataBridge.debateCache.length}</b></div>
    `;

    // service I/O status — only show live figures for services that responded
    // this poll; a down service (e.g. AO 500) falls back to the mock counts and
    // drops its LIVE badge instead of the whole board claiming LIVE.
    const a = up.algora ? ls.algora : null;
    const aIn = a ? `${a.signalsToday ?? 0}/today` : `${zoneStats.algora.signals}`;
    const aOut = a ? `${a.openIssues ?? 0} open` : `${zoneStats.algora.issues}`;
    const aHint = a ? `sessions:${a.activeSessions ?? 0}` : "9-stage pipeline";

    const ao = up.ao ? ls.ao : null;
    const aoIn = ao ? `${ao.stats?.signals_today ?? 0}/today` : `${zoneStats.ao.ideas}`;
    const aoOut = ao
        ? `Ideas ${ao.stats?.ideas_generated ?? 0} · Plans ${ao.stats?.plans_created ?? 0}`
        : `Plans ${zoneStats.ao.plans}`;
    const aoHint = ao ? `debates:${ao.stats?.debates_today ?? 0} · agents:${ao.stats?.agents_active ?? 0}` : "3-phase debate";

    const b = up.bridge ? ls.bridge : null;
    const bIn = b ? `${(b.signals?.total ?? 0).toLocaleString()} signals` : `${zoneStats.bridge.proposals}`;
    const bOut = b
        ? `Issues ${b.issues?.total ?? 0} · Proofs ${b.outcomes?.totalProofs ?? 0}`
        : `Outcomes ${zoneStats.bridge.outcomes}`;
    const bHint = b ? `proposals:${b.proposals?.total ?? 0} · success:${b.outcomes?.successRate ?? 0}%` : "L0-L4 pipeline";

    const badge = (ok: boolean) => ok ? ' <span class="live-badge">LIVE</span>' : '';

    serviceEl.innerHTML = `
    <h2>Service I/O</h2>
    <div class="svc algora">
      <div class="svc-title">ALGORA${badge(up.algora)}</div>
      <div class="drow"><span>Input</span><b>Signals ${aIn}</b></div>
      <div class="drow"><span>Output</span><b>Issues ${aOut}</b></div>
      <div class="hint">${aHint} · 38 agents · docs:${zoneStats.algora.docs}</div>
    </div>
    <div class="svc ao">
      <div class="svc-title">AO${badge(up.ao)}</div>
      <div class="drow"><span>Input</span><b>Signals ${aoIn}</b></div>
      <div class="drow"><span>Output</span><b>${aoOut}</b></div>
      <div class="hint">${aoHint} · projects:${zoneStats.ao.projects}</div>
    </div>
    <div class="svc bridge">
      <div class="svc-title">BRIDGE${badge(up.bridge)}</div>
      <div class="drow"><span>Input</span><b>${bIn}</b></div>
      <div class="drow"><span>Output</span><b>${bOut}</b></div>
      <div class="hint">${bHint} · 5 specialist agents</div>
    </div>
    `;

    // connection status update
    if (live) {
        connEl.innerHTML = `<span class="dot live"></span> LIVE — queue: ${dataBridge.queueSize()}`;
    } else {
        connEl.innerHTML = `<span class="dot offline"></span> OFFLINE — no service reachable`;
    }
}
