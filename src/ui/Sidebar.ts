import type { ConnState, DataBridge } from "../services/data-bridge.ts";

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
      <div class="detail-desc">Three independent Mossland services, each polled live every 15 seconds. The Algora belt carries the merged live signal stream from all three services; AO belt bubbles are real AO ideas, and the belt stays empty when none are available. Bridge's live outcome and trust data drives its stats and Trust panel. A service that does not respond shows \u2014 rather than a substituted figure.</div>
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

export function setConnectionStatus(state: ConnState): void {
    connEl.innerHTML = connMarkup(state, "Real-time service data");
}

/** Single source of truth for the status line. "connecting" is a real state:
 *  reporting it as OFFLINE claims an outage before anything has been polled. */
function connMarkup(state: ConnState, liveSuffix: string): string {
    if (state === "live") return `<span class="dot live"></span> LIVE — ${liveSuffix}`;
    if (state === "offline") return `<span class="dot offline"></span> OFFLINE — no service reachable`;
    return `<span class="dot connecting"></span> Connecting...`;
}

export function updateSidebar(dataBridge: DataBridge): void {
    const ls = dataBridge.liveStats;
    const up = dataBridge.serviceUp;
    const conn = dataBridge.connectionState();

    // Placeholder for a figure this poll could not obtain. A service that did not
    // respond has no numbers, and putting something in their place — as this panel
    // used to, by falling back to the zones' internal animation counters — reads as
    // live service data when it is nothing of the sort.
    const NA = "\u2014";

    const a = up.algora ? ls.algora : null;
    const ao = up.ao ? ls.ao : null;
    const b = up.bridge ? ls.bridge : null;

    // Pipeline summary. These are the services' own totals, not the sizes of our
    // fetch caches — `issueCache.length` only ever reported the 30-item fetch cap,
    // and `debateCache.length` the 10-item one.
    statsEl.innerHTML = `
    <div class="row"><span>Monitoring</span><b>Algora (Sense) | AO (Plan) | Bridge (Execute)</b></div>
    <div class="row"><span>Signal Queue</span><b>${dataBridge.queueSize()}</b></div>
    <div class="row"><span>Open Issues</span><b>${a ? a.openIssues ?? 0 : NA}</b></div>
    <div class="row"><span>Debates Today</span><b>${ao?.stats ? ao.stats.debates_today : NA}</b></div>
    `;

    // Service I/O — live figures for the services that responded this poll. The
    // rest show NA and lose their LIVE badge, instead of borrowing another number.
    const aIn = a ? `${a.signalsToday ?? 0}/today` : NA;
    const aOut = a ? `${a.openIssues ?? 0} open` : NA;
    const aHint = a ? `sessions:${a.activeSessions ?? 0} · agents:${a.totalAgents ?? NA}` : "9-stage pipeline";

    const aoIn = ao?.stats ? `${ao.stats.signals_today}/today` : NA;
    const aoOut = ao?.stats
        ? `Ideas ${ao.stats.ideas_generated} · Plans ${ao.stats.plans_created}`
        : NA;
    const aoHint = ao?.stats ? `debates:${ao.stats.debates_today} · agents:${ao.stats.agents_active}` : "3-phase debate";

    const bIn = b ? `${(b.signals?.total ?? 0).toLocaleString()} signals` : NA;
    const bOut = b
        ? `Issues ${b.issues?.total ?? 0} · Proofs ${b.outcomes?.totalProofs ?? 0}`
        : NA;
    const bHint = b ? `proposals:${b.proposals?.total ?? 0} · success:${b.outcomes?.successRate ?? 0}%` : "L0-L4 pipeline";

    const badge = (ok: boolean) => ok ? ' <span class="live-badge">LIVE</span>' : '';

    serviceEl.innerHTML = `
    <h2>Service I/O</h2>
    <div class="svc algora">
      <div class="svc-title">ALGORA${badge(up.algora)}</div>
      <div class="drow"><span>Input</span><b>Signals ${aIn}</b></div>
      <div class="drow"><span>Output</span><b>Issues ${aOut}</b></div>
      <div class="hint">${aHint}</div>
    </div>
    <div class="svc ao">
      <div class="svc-title">AO${badge(up.ao)}</div>
      <div class="drow"><span>Input</span><b>Signals ${aoIn}</b></div>
      <div class="drow"><span>Output</span><b>${aoOut}</b></div>
      <div class="hint">${aoHint}</div>
    </div>
    <div class="svc bridge">
      <div class="svc-title">BRIDGE${badge(up.bridge)}</div>
      <div class="drow"><span>Input</span><b>${bIn}</b></div>
      <div class="drow"><span>Output</span><b>${bOut}</b></div>
      <div class="hint">${bHint} · 5 specialist agents</div>
    </div>
    `;

    // connection status update
    connEl.innerHTML = connMarkup(conn, `queue: ${dataBridge.queueSize()}`);
}
