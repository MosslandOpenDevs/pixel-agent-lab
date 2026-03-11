import type { DataBridge } from "../services/data-bridge.ts";

let statsEl: HTMLDivElement;
let serviceEl: HTMLDivElement;
let detailEl: HTMLDivElement;
let connEl: HTMLDivElement;

export function initSidebar(): void {
    const app = document.querySelector<HTMLDivElement>("#app")!;
    app.innerHTML = `
<div class="layout">
  <aside class="panel">
    <h1>Mossland Space Hub</h1>
    <p class="sub">Governance Monitor · 3 Independent Services</p>
    <div id="connStatus" class="conn-status"><span class="dot connecting"></span> Connecting...</div>
    <div id="stats" class="stats"></div>
    <div id="serviceStatus" class="stats"></div>
    <div id="detail" class="detail"><h2>Detail</h2><p>Click an element for details.</p></div>
  </aside>
  <main class="stage-wrap">
    <div id="stage"></div>
  </main>
</div>
`;
    statsEl = document.querySelector<HTMLDivElement>("#stats")!;
    serviceEl = document.querySelector<HTMLDivElement>("#serviceStatus")!;
    detailEl = document.querySelector<HTMLDivElement>("#detail")!;
    connEl = document.querySelector<HTMLDivElement>("#connStatus")!;
}

export function setConnectionStatus(live: boolean): void {
    if (live) {
        connEl.innerHTML = `<span class="dot live"></span> LIVE — Real-time service data`;
    } else {
        connEl.innerHTML = `<span class="dot offline"></span> OFFLINE — Mock data fallback`;
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
    const live = dataBridge.isConnected();

    // pipeline summary stats
    statsEl.innerHTML = `
    <div class="row"><span>Monitoring</span><b>Algora (Sense) | AO (Plan) | Bridge (Execute)</b></div>
    <div class="row"><span>Signal Queue</span><b>${dataBridge.queueSize()}</b></div>
    <div class="row"><span>Algora Issues</span><b>${dataBridge.issueCache.length}</b></div>
    <div class="row"><span>AO Debates</span><b>${dataBridge.debateCache.length}</b></div>
    `;

    // service I/O status
    const aIn = live && ls.algora ? `${ls.algora.signalsToday}/today` : `${zoneStats.algora.signals}`;
    const aOut = live && ls.algora ? `${ls.algora.openIssues} open` : `${zoneStats.algora.issues}`;
    const aHint = live && ls.algora ? `sessions:${ls.algora.activeSessions}` : "9-stage pipeline";

    const aoIn = live && ls.ao ? `${ls.ao.stats.signals_today}/today` : `${zoneStats.ao.ideas}`;
    const aoOut = live && ls.ao
        ? `Ideas ${ls.ao.stats.ideas_generated} · Plans ${ls.ao.stats.plans_created}`
        : `Plans ${zoneStats.ao.plans}`;
    const aoHint = live && ls.ao ? `debates:${ls.ao.stats.debates_today} · agents:${ls.ao.stats.agents_active}` : "3-phase debate";

    const bIn = live && ls.bridge ? `${ls.bridge.signals.total.toLocaleString()} signals` : `${zoneStats.bridge.proposals}`;
    const bOut = live && ls.bridge
        ? `Issues ${ls.bridge.issues.total} · Proofs ${ls.bridge.outcomes.totalProofs}`
        : `Outcomes ${zoneStats.bridge.outcomes}`;
    const bHint = live && ls.bridge ? `proposals:${ls.bridge.proposals.total} · success:${ls.bridge.outcomes.successRate}%` : "L0-L4 pipeline";

    const liveTag = live ? ' <span class="live-badge">LIVE</span>' : '';

    serviceEl.innerHTML = `
    <h2>Service I/O</h2>
    <div class="svc algora">
      <div class="svc-title">ALGORA${liveTag}</div>
      <div class="drow"><span>Input</span><b>Signals ${aIn}</b></div>
      <div class="drow"><span>Output</span><b>Issues ${aOut}</b></div>
      <div class="hint">${aHint} · 38 agents · docs:${zoneStats.algora.docs}</div>
    </div>
    <div class="svc ao">
      <div class="svc-title">AO${liveTag}</div>
      <div class="drow"><span>Input</span><b>Signals ${aoIn}</b></div>
      <div class="drow"><span>Output</span><b>${aoOut}</b></div>
      <div class="hint">${aoHint} · projects:${zoneStats.ao.projects}</div>
    </div>
    <div class="svc bridge">
      <div class="svc-title">BRIDGE${liveTag}</div>
      <div class="drow"><span>Input</span><b>${bIn}</b></div>
      <div class="drow"><span>Output</span><b>${bOut}</b></div>
      <div class="hint">${bHint} · 5 specialist agents</div>
    </div>
    `;

    // connection status update
    if (live) {
        connEl.innerHTML = `<span class="dot live"></span> LIVE — queue: ${dataBridge.queueSize()}`;
    }
}

export function showDetail(title: string, rows: Array<[string, string]>, desc?: string): void {
    const rowsHtml = rows.map(([k, v]) => `<div class="drow"><span>${k}</span><b>${v}</b></div>`).join("");
    const descHtml = desc ? `<div class="detail-desc">${desc}</div>` : "";
    detailEl.innerHTML = `<h2>${title}</h2>${rowsHtml}${descHtml}`;
}
