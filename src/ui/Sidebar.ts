import type { ConnState, DataBridge } from "../services/data-bridge.ts";
import type { EcosystemFeed, EcosystemNode } from "../services/ecosystem-feed.ts";

let statsEl: HTMLDivElement;
let serviceEl: HTMLDivElement;
let connEl: HTMLDivElement;
let ecoEl: HTMLDivElement;

export function initSidebar(): void {
    const app = document.querySelector<HTMLDivElement>("#app")!;
    app.innerHTML = `
<div class="layout">
  <button id="panelToggle" class="panel-toggle" aria-label="Toggle info panel" aria-controls="panelAside" aria-expanded="false">☰</button>
  <aside id="panelAside" class="panel">
    <h1>Mossland Space Hub</h1>
    <p class="sub">Governance Monitor · live map of the Mossland ecosystem</p>
    <div id="connStatus" class="conn-status"><span class="dot connecting"></span> Connecting...</div>
    <div id="stats" class="stats"></div>
    <div id="serviceStatus" class="stats"></div>
    <div id="ecosystem" class="stats eco"></div>
    <div class="detail">
      <h2>About</h2>
      <div class="detail-desc">A map of every service in the links.moss.land registry, and belts for the few that actually stream data here. How solid a body looks is how much this monitor can really see: services it streams are brightest, ones covered by the health aggregator pulse, and ones it only knows from the registry sit still with a hollow dot. Archived services stay on the map, dimmed. Motion on the map is real \u2014 each mote is one ingested signal, and the ring sweep is an actual health refresh. Anything a service does not report shows \u2014 rather than a substituted figure.</div>
    </div>
  </aside>
  <div class="panel-backdrop"></div>
  <main class="stage-wrap">
    <div id="stage"></div>
  </main>
  <nav class="zone-tabs" role="tablist" aria-label="Service zone">
    <button class="zone-tab active" data-zone="hub" role="tab" aria-selected="true">Map</button>
    <button class="zone-tab" data-zone="algora" role="tab" aria-selected="false">Algora</button>
    <button class="zone-tab" data-zone="ao" role="tab" aria-selected="false">AO</button>
    <button class="zone-tab" data-zone="bridge" role="tab" aria-selected="false">Bridge</button>
  </nav>
</div>
`;
    statsEl = document.querySelector<HTMLDivElement>("#stats")!;
    serviceEl = document.querySelector<HTMLDivElement>("#serviceStatus")!;
    ecoEl = document.querySelector<HTMLDivElement>("#ecosystem")!;
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

const SECTION_LABELS: Record<string, string> = {
    official: "Official",
    ecosystem: "Ecosystem",
    markets: "Markets",
    developers: "Developers",
    participation: "Participation",
};

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"]/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

/**
 * Ecosystem panel, driven by the links.moss.land registry.
 *
 * The rule: a row may only look as alive as the data behind it. `stream`
 * services are ones this monitor actually polls, `health` ones are covered by
 * the city.moss.land aggregator, and `listed` ones we know nothing about beyond
 * their registry entry — so those get a neutral dot, never a reassuring green.
 */
export function updateEcosystem(feed: EcosystemFeed): void {
    if (!ecoEl) return;
    if (!feed.isLoaded()) {
        ecoEl.innerHTML = `<h2>Ecosystem</h2><div class="row"><span>Registry</span><b>loading\u2026</b></div>`;
        return;
    }

    const nodes = feed.nodes();
    if (nodes.length === 0) {
        ecoEl.innerHTML = `<h2>Ecosystem</h2><div class="row"><span>Registry</span><b>unavailable</b></div>`;
        return;
    }

    // Count the disjoint instrumentation tiers, so these agree with the map's
    // own summary. Counting "anything with health data" would double-count the
    // streaming services and report a different number for the same word.
    const streaming = nodes.filter(n => n.instrumentation === "stream").length;
    const checked = nodes.filter(n => n.instrumentation === "health").length;
    const listed = nodes.filter(n => n.instrumentation === "listed").length;

    const groups = new Map<string, EcosystemNode[]>();
    for (const n of nodes) {
        const key = n.service.section || "other";
        const list = groups.get(key);
        if (list) list.push(n); else groups.set(key, [n]);
    }

    const row = (n: EcosystemNode) => {
        const { service: sv, health, instrumentation } = n;
        const archived = sv.lifecycle === "archive" || sv.status === "deprecated";
        const dot = health
            ? `<span class="eco-dot ${esc(health.status)}" title="${esc(health.status)}${health.latencyMs != null ? " \u00b7 " + health.latencyMs + "ms" : ""}"></span>`
            : `<span class="eco-dot unknown" title="not health-checked"></span>`;
        const life = sv.lifecycle
            ? `<span class="eco-life ${esc(sv.lifecycle)}">${esc(sv.lifecycle)}</span>`
            : `<span class="eco-life none" title="no MIP-1 lifecycle recorded">\u2014</span>`;
        return `<a class="eco-row${archived ? " archived" : ""}${instrumentation === "stream" ? " streaming" : ""}" href="${esc(sv.url)}" target="_blank" rel="noopener noreferrer">${dot}<span class="eco-name">${esc(sv.name)}</span>${life}</a>`;
    };

    const sections = [...groups.entries()].map(([key, list]) => `
    <div class="eco-group">
      <div class="eco-group-title">${esc(SECTION_LABELS[key] ?? key)}</div>
      ${list.map(row).join("")}
    </div>`).join("");

    ecoEl.innerHTML = `
    <h2>Ecosystem</h2>
    <div class="row"><span>Registered</span><b>${nodes.length}</b></div>
    <div class="row"><span>Streaming here</span><b>${streaming}</b></div>
    <div class="row"><span>Health-checked</span><b>${checked}</b></div>
    <div class="row"><span>Listed only</span><b>${listed}</b></div>
    ${sections}
    `;
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
    <div class="row"><span>Streaming</span><b>Algora (Sense) | AO (Plan) | Bridge (Execute)</b></div>
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
    const successRate = b?.outcomes?.successRate;
    // `?? 0` here used to turn "no proofs recorded yet" (null) into "0% success",
    // which reads as every outcome having failed.
    const bSuccess = typeof successRate === "number" ? `${successRate}%` : NA;
    const bHint = b ? `proposals:${b.proposals?.total ?? 0} · success:${bSuccess}` : "L0-L4 pipeline";

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
