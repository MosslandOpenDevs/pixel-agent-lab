import type { ConnState, DataBridge } from "../services/data-bridge.ts";
import type { EcosystemFeed, EcosystemNode } from "../services/ecosystem-feed.ts";
import { esc } from "./html.ts";

/** The three values the ecosystem health contract defines. A service that
 *  answers with anything else is answering — we just cannot read its verdict,
 *  which is worth showing rather than quietly translating into "ok". */
const CONTRACT_STATUS = new Set(["ok", "degraded", "down"]);

let statsEl: HTMLDivElement;
let serviceEl: HTMLDivElement;
let connEl: HTMLDivElement;
let ecoEl: HTMLDivElement;

/** The markup each panel was last given. */
let written = new WeakMap<Element, string>();

/**
 * Writes a panel's markup only when it has changed. The scene refreshes every
 * panel twice a second, and assigning innerHTML replaces every child node even
 * when the string is identical — which drops keyboard focus and text selection
 * (a figure selected to be copied was gone within half a second) and rebuilds
 * the panel's accessibility tree, although no data changed.
 *
 * Every writer of a panel has to come through here. One that wrote around it
 * would leave the memo holding markup the panel no longer shows, and the next
 * identical write would be skipped over it.
 */
function setHTML(el: Element, markup: string): void {
    if (written.get(el) === markup) return;
    written.set(el, markup);
    el.innerHTML = markup;
}

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
      <div class="detail-desc">Explore the Mossland service registry and governance activity. Map colours show reported health; rings mark services whose data is read here. Links and files are references, and archived services remain dimmed. Map particles follow newly received signals, while a sweep marks a health refresh. Detail belts illustrate workflows, not confirmed execution. LIVE means a data API responded; cached details can remain visible when a later request fails.</div>
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
    written = new WeakMap();

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
    setHTML(connEl, connMarkup(state, "Real-time service data"));
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

function renderEcosystem(markup: string): void {
    // Replacing identical links drops keyboard focus as well as selection.
    setHTML(ecoEl, markup);
}

/**
 * Ecosystem panel, driven by the links.moss.land registry.
 *
 * The rule: a row may only look as alive as the data behind it. `stream`
 * services are ones this monitor actually polls, `health` ones have a reading —
 * first-hand from their own /api/health, or city.moss.land's aggregate as the
 * fallback — and `listed` ones we know nothing about beyond their registry
 * entry, so those get a neutral dot, never a reassuring green.
 */
export function updateEcosystem(feed: EcosystemFeed): void {
    if (!ecoEl) return;
    if (!feed.isLoaded()) {
        renderEcosystem(`<h2>Ecosystem</h2><div class="row"><span>Registry</span><b>loading\u2026</b></div>`);
        return;
    }

    const nodes = feed.nodes();
    if (nodes.length === 0) {
        renderEcosystem(`<h2>Ecosystem</h2><div class="row"><span>Registry</span><b>unavailable</b></div>`);
        return;
    }

    // Count the disjoint instrumentation tiers, so these agree with the map's
    // own summary. Counting "anything with health data" would double-count the
    // streaming services and report a different number for the same word.
    // Services only. The files and the external links are registry entries too,
    // but folding them in made "listed only" read as a pile of unwatched
    // services when most of it was llms.txt and six exchange listings.
    const services = nodes.filter(n => n.kind === "service");
    const streaming = services.filter(n => n.instrumentation === "stream").length;
    const checked = services.filter(n => n.instrumentation === "health").length;
    const listed = services.filter(n => n.instrumentation === "listed").length;

    const groups = new Map<string, EcosystemNode[]>();
    for (const n of nodes) {
        const key = n.service.section || "other";
        const list = groups.get(key);
        if (list) list.push(n); else groups.set(key, [n]);
    }

    const row = (n: EcosystemNode) => {
        const { service: sv, health, instrumentation, kind } = n;
        const archived = sv.lifecycle === "archive" || sv.status === "deprecated";
        // A file has no status dot and a third-party listing's uptime is not our
        // claim; an empty slot keeps the names aligned without asserting one.
        const dot = kind !== "service"
            ? `<span class="eco-dot none" title="${kind === "artifact" ? "a published file, not a service" : "an external destination"}"></span>`
            : health
                ? `<span class="eco-dot ${CONTRACT_STATUS.has(health.status) ? esc(health.status) : "offcontract"}" title="${esc(health.status)}${CONTRACT_STATUS.has(health.status) ? "" : " \u2014 not one of ok/degraded/down"}${health.latencyMs != null ? " \u00b7 " + esc(health.latencyMs) + "ms" : ""}"></span>`
                : `<span class="eco-dot unknown" title="not health-checked"></span>`;
        const life = sv.lifecycle
            ? `<span class="eco-life ${esc(sv.lifecycle)}">${esc(sv.lifecycle)}</span>`
            : `<span class="eco-life none" title="no MIP-1 lifecycle recorded">\u2014</span>`;
        return `<a class="eco-row${archived ? " archived" : ""}${instrumentation === "stream" ? " streaming" : ""}${kind !== "service" ? " reference" : ""}" href="${esc(sv.url)}" target="_blank" rel="noopener noreferrer">${dot}<span class="eco-name">${esc(sv.name)}</span>${life}</a>`;
    };

    const sections = [...groups.entries()].map(([key, list]) => `
    <div class="eco-group">
      <div class="eco-group-title">${esc(SECTION_LABELS[key] ?? key)}</div>
      ${list.map(row).join("")}
    </div>`).join("");

    renderEcosystem(`
    <h2>Ecosystem</h2>
    <div class="row"><span>Services</span><b>${services.length}</b></div>
    <div class="row"><span>Streaming here</span><b>${streaming}</b></div>
    <div class="row"><span>Health-checked</span><b>${checked}</b></div>
    <div class="row"><span>Listed only</span><b>${listed}</b></div>
    ${sections}
    `);
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
    // The same goes for a figure the service did send but not as a number. Each
    // of these comes from another service's JSON behind an unchecked cast, and a
    // renamed field used to render "undefined", a missing one "0", and a numeric
    // string as if it were a count. Only a finite number is a figure. As defence
    // in depth it also keeps anything but a number out of this innerHTML.
    const num = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;

    const a = up.algora ? ls.algora : null;
    const ao = up.ao ? ls.ao : null;
    const b = up.bridge ? ls.bridge : null;

    // Pipeline summary. These are the services' own totals, not the sizes of our
    // fetch caches — the issue list's length (no longer fetched) only ever
    // reported its 30-item cap, and the debate list's its own.
    setHTML(statsEl, `
    <div class="row"><span>Streaming</span><b>Algora (Sense) | AO (Plan) | Bridge (Execute)</b></div>
    <div class="row"><span>Signal Queue</span><b>${dataBridge.queueSize()}</b></div>
    <div class="row"><span>Open Issues</span><b>${num(a?.openIssues) ?? NA}</b></div>
    <div class="row"><span>Debates Today</span><b>${num(ao?.stats?.debates_today) ?? NA}</b></div>
    `);

    // Service I/O — live figures for the services that responded this poll. The
    // rest show NA and lose their LIVE badge, instead of borrowing another number.
    const aIn = a ? `${num(a.signalsToday) ?? NA}/today` : NA;
    const aOut = a ? `${num(a.openIssues) ?? NA} open` : NA;
    const aHint = a ? `sessions:${num(a.activeSessions) ?? NA} · agents:${num(a.totalAgents) ?? NA}` : "9-stage pipeline";

    const aoStats = ao?.stats;
    const aoIn = aoStats ? `${num(aoStats.signals_today) ?? NA}/today` : NA;
    const aoOut = aoStats
        ? `Ideas ${num(aoStats.ideas_generated) ?? NA} · Plans ${num(aoStats.plans_created) ?? NA}`
        : NA;
    const aoHint = aoStats
        ? `debates:${num(aoStats.debates_today) ?? NA} · agents:${num(aoStats.agents_active) ?? NA}`
        : "3-phase debate";

    const bIn = b ? `${num(b.signals?.total)?.toLocaleString() ?? NA} signals` : NA;
    const bOut = b
        ? `Issues ${num(b.issues?.total) ?? NA} · Proofs ${num(b.outcomes?.totalProofs) ?? NA}`
        : NA;
    // `?? 0` here used to turn "no proofs recorded yet" (null) into "0% success",
    // which reads as every outcome having failed.
    const successRate = num(b?.outcomes?.successRate);
    const bSuccess = successRate !== null ? `${successRate}%` : NA;
    const bHint = b ? `proposals:${num(b.proposals?.total) ?? NA} · success:${bSuccess}` : "L0-L4 pipeline";

    const badge = (ok: boolean) => ok ? ' <span class="live-badge">LIVE</span>' : '';

    setHTML(serviceEl, `
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
    `);

    // connection status update
    setHTML(connEl, connMarkup(conn, `queue: ${dataBridge.queueSize()}`));
}
