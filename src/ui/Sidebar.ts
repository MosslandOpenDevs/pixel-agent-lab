import type { ConnState, DataBridge } from "../services/data-bridge.ts";
import type { EcosystemFeed, EcosystemNode } from "../services/ecosystem-feed.ts";
import { esc } from "./html.ts";
import { syncZoneTabs, tabKeyTarget } from "./zone-tabs.ts";
import { liveBadge } from "./live-badge.ts";
import {
    BUCKET_LABEL, clockTime, freshnessText, healthBucket, isArchived, namesHtml, shortClock,
    tallyHtml, tallyServices,
} from "./ecosystem-status.ts";

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
 * When it has changed, a link that had keyboard focus gets it back. The
 * Ecosystem panel carries its sweep clock, so it does change, every sweep —
 * and each time, someone tabbing through its links was dropped back to the
 * top of the page.
 *
 * Every writer of a panel has to come through here. One that wrote around it
 * would leave the memo holding markup the panel no longer shows, and the next
 * identical write would be skipped over it.
 */
function setHTML(el: Element, markup: string): void {
    if (written.get(el) === markup) return;
    written.set(el, markup);
    const active = typeof document !== "undefined" ? document.activeElement : null;
    const href = active && el.contains?.(active) ? active.getAttribute?.("href") : null;
    el.innerHTML = markup;
    if (href) {
        Array.from(el.querySelectorAll?.<HTMLAnchorElement>("a[href]") ?? [])
            .find(a => a.getAttribute("href") === href)?.focus({ preventScroll: true });
    }
}

export function initSidebar(): void {
    const app = document.querySelector<HTMLDivElement>("#app")!;
    app.innerHTML = `
<div class="layout">
  <button id="panelToggle" class="panel-toggle" aria-label="Toggle info panel" aria-controls="panelAside" aria-expanded="false">☰</button>
  <aside id="panelAside" class="panel">
    <h1 tabindex="-1">Mossland Space Hub</h1>
    <p class="sub">Governance Monitor · live map of the Mossland ecosystem</p>
    <div id="connStatus" class="conn-status"><span class="dot connecting"></span> Connecting...</div>
    <div id="stats" class="stats"></div>
    <div id="serviceStatus" class="stats"></div>
    <div id="ecosystem" class="stats eco"></div>
    <div class="detail">
      <h2>About</h2>
      <div class="detail-desc">Explore the Mossland service registry and governance activity. Map colours show reported health, and a down or degraded body is also named on its label; rings mark services whose data is read here. Links and files are references. Archived services are drawn in their own dimmed colour instead of a health colour; their health is in the tooltip and this panel. A health reading no sweep has refreshed for about 150 s is marked stale and stops pulsing. Map particles follow newly received signals, while a sweep marks a health refresh. Detail belts illustrate workflows, not confirmed execution. LIVE means a data API responded, OFFLINE that it did not; cached details can remain visible when a later request fails.</div>
    </div>
  </aside>
  <div class="panel-backdrop"></div>
  <!-- Before the stage it controls, so Tab reaches the selected tab and then
       the panel, as the tabs pattern expects. It is position: fixed, so where
       it sits in the markup does not move it on screen. -->
  <nav class="zone-tabs" aria-label="Views">
    <div class="zone-tablist" role="tablist" aria-label="Service zone">
      <button id="tab-hub" class="zone-tab active" data-zone="hub" role="tab" aria-selected="true" aria-controls="stage" tabindex="0">Map</button>
      <button id="tab-algora" class="zone-tab" data-zone="algora" role="tab" aria-selected="false" aria-controls="stage" tabindex="-1">Algora</button>
      <button id="tab-ao" class="zone-tab" data-zone="ao" role="tab" aria-selected="false" aria-controls="stage" tabindex="-1">AO</button>
      <button id="tab-bridge" class="zone-tab" data-zone="bridge" role="tab" aria-selected="false" aria-controls="stage" tabindex="-1">Bridge</button>
    </div>
  </nav>
  <main class="stage-wrap">
    <div id="stage" role="tabpanel" aria-labelledby="tab-hub" aria-describedby="stageNote" tabindex="0">
      <p id="stageNote" class="sr-only">Drawn on a canvas. Every body on the map is also a link in the Ecosystem list of the information panel, with its reported health; the belts' figures are in its Service I/O section.</p>
    </div>
  </main>
</div>
`;
    statsEl = document.querySelector<HTMLDivElement>("#stats")!;
    serviceEl = document.querySelector<HTMLDivElement>("#serviceStatus")!;
    ecoEl = document.querySelector<HTMLDivElement>("#ecosystem")!;
    connEl = document.querySelector<HTMLDivElement>("#connStatus")!;
    written = new WeakMap();

    // The phone's drawer (below 768px; above it the panel is always shown and
    // the toggle is not). Closed, the stylesheet makes it visibility:hidden
    // after it slides out, which takes its 28 links out of the Tab order and
    // the accessibility tree: they used to take focus off-screen, one Tab
    // press each, before the zone tabs. Opening it moves focus in, so the next
    // Tab is its first link, and scrolls it back to the top, where that focus
    // is: it keeps its scroll while hidden, and reopened after tabbing down
    // its list it showed its lower rows with focus far above them, unseen.
    // Escape closes it and puts focus on ☰; closing it from the backdrop or
    // ☰ does the same when focus was inside it, where focus would otherwise
    // be lost as the drawer is hidden.
    //
    // While it is open, what it covers is inert: the tabs and the stage come
    // after it in the Tab order, and on a phone the Map, Algora and AO tabs
    // sit wholly under it, so Tab past its last link put focus where it could
    // not be seen, and the arrow keys switched the view behind it. Inert, they
    // leave the Tab order and the accessibility tree, and Tab cycles through
    // the drawer and ☰ — which stays outside the set, because it closes it.
    const toggle = document.getElementById("panelToggle")!;
    const panel = document.querySelector<HTMLElement>(".panel")!;
    const backdrop = document.querySelector<HTMLElement>(".panel-backdrop")!;
    const behind = [".zone-tabs", ".stage-wrap"]
        .map(sel => document.querySelector<HTMLElement>(sel))
        .filter((el): el is HTMLElement => el !== null);
    const setPanelOpen = (open: boolean, hadFocus = panel.contains?.(document.activeElement) ?? false) => {
        panel.classList.toggle("open", open);
        backdrop.classList.toggle("open", open);
        toggle.setAttribute("aria-expanded", String(open));
        for (const el of behind) el.inert = open;
        if (open) {
            panel.scrollTop = 0;
            panel.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
        } else if (hadFocus) toggle.focus();
        // The map listens: the drawer covers it, so a tooltip pinned to a
        // body before it opened must not stay drawn over it (HubMap).
        document.dispatchEvent(new CustomEvent("panel-toggle", { detail: { open } }));
    };
    toggle.addEventListener("click", () => setPanelOpen(!panel.classList.contains("open")));
    // The backdrop is not focusable, so pressing it — a mouse button, or the
    // mousedown that follows a tap — blurs whatever had focus before its
    // click arrives, and focus inside the drawer was then dropped to <body>.
    // Whether focus was inside is read on the press, which comes first.
    let pressedFromInside = false;
    backdrop.addEventListener("pointerdown", () => {
        pressedFromInside = panel.contains?.(document.activeElement) ?? false;
    });
    backdrop.addEventListener("click", () => {
        setPanelOpen(false, pressedFromInside);
        pressedFromInside = false;
    });
    document.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key !== "Escape" || !panel.classList.contains("open")) return;
        setPanelOpen(false);
        toggle.focus();
    });

    // The zone tabs, at every width. A click and the arrow keys take the same
    // path; the scene answers the event and re-syncs the tabs itself, since
    // the map can switch zone too (see zone-tabs.ts).
    const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>(".zone-tab"));
    const select = (btn: HTMLButtonElement) => {
        syncZoneTabs(btn.dataset.zone ?? "");
        document.dispatchEvent(new CustomEvent("zone-switch", {
            detail: { zone: btn.dataset.zone },
        }));
    };
    tabs.forEach((btn, i) => {
        btn.addEventListener("click", () => select(btn));
        btn.addEventListener("keydown", (e: KeyboardEvent) => {
            const j = tabKeyTarget(e.key, i, tabs.length);
            if (j === null) return;
            e.preventDefault();
            tabs[j].focus();
            select(tabs[j]);
        });
    });
}

export function setConnectionStatus(state: ConnState): void {
    // What LIVE means, in the About text's words. It used to say "Real-time
    // service data", which this is not: the data is polled, and the belts
    // only illustrate workflows. The next 500 ms refresh replaces the suffix
    // with the queue size (updateSidebar).
    setHTML(connEl, connMarkup(state, "a data API responded"));
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
 * first-hand from their own registry `statusUrl`, or city.moss.land's aggregate
 * as the fallback — and `listed` ones we know nothing about beyond their registry
 * entry, so those get a neutral dot, never a reassuring green.
 *
 * First, above the instrumentation counts, what the services report: the same
 * tally the map's HUD shows (see ecosystem-status.ts), dated by the sweep
 * clock, and a text chip on every row whose reading is not ok — the dot's
 * colour alone is what a red-green colour-blind viewer cannot read. Every
 * row's reading is announced as well as shown: it is part of the link's
 * name, since this list is where the map sends keyboard and screen-reader
 * users (#stageNote).
 */
export function updateEcosystem(feed: EcosystemFeed): void {
    if (!ecoEl) return;
    const registry = feed.registryState();
    if (registry !== "loaded") {
        // "loading" only while the first read is in flight. A read that
        // failed used to say "loading…" too, for the ten minutes until the
        // next attempt; it is retried within seconds now, and says so.
        renderEcosystem(registry === "failed"
            ? `<h2>Ecosystem</h2><div class="row"><span>Registry</span><b class="eco-warn">unreachable \u2014 retrying</b></div>`
            : `<h2>Ecosystem</h2><div class="row"><span>Registry</span><b>loading\u2026</b></div>`);
        return;
    }

    const nodes = feed.nodes();
    if (nodes.length === 0) {
        renderEcosystem(`<h2>Ecosystem</h2><div class="row"><span>Registry</span><b>unavailable</b></div>`);
        return;
    }
    const freshness = feed.healthFreshness();
    const stale = freshness.state === "stale";

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
        const archived = isArchived(sv);
        // What the dot says, escaped once: its title for a pointer, and read
        // out after the name. The dot is an empty span, and a title on one is
        // not part of the link's name \u2014 so a screen reader, sent here from
        // the map, heard "Signal Map beta" for "ok \u00b7 55ms", for "not
        // health-checked" and for "an external destination" alike. The raw
        // status stays untranslated, as everywhere: "running" is not "ok".
        const reading = kind !== "service"
            ? (kind === "artifact" ? "a published file, not a service" : "an external destination")
            : health
                ? `${esc(health.status)}${CONTRACT_STATUS.has(health.status) ? "" : " \u2014 not one of ok/degraded/down"}${health.latencyMs != null ? " \u00b7 " + esc(health.latencyMs) + "ms" : ""}`
                : "not health-checked";
        // A file has no status dot and a third-party listing's uptime is not our
        // claim; an empty slot keeps the names aligned without asserting one.
        const dot = kind !== "service"
            ? `<span class="eco-dot none" title="${reading}"></span>`
            : health
                ? `<span class="eco-dot ${CONTRACT_STATUS.has(health.status) ? esc(health.status) : "offcontract"}" title="${reading}"></span>`
                : `<span class="eco-dot unknown" title="${reading}"></span>`;
        // Announced, it says "health" first and, while the reading is stale,
        // says so: the list is only dimmed for that, which nobody hears.
        const heard = kind === "service" && health ? `health ${reading}${stale ? ", stale" : ""}` : reading;
        // The same verdict in words, for every reading that is not ok. The
        // class comes from the fixed bucket, never from the status string.
        // Hidden from screen readers, which hear the verdict in the reading
        // above, so that they do not hear it twice.
        const bucket = kind === "service" ? healthBucket(health) : null;
        const chip = bucket === "down" || bucket === "degraded" || bucket === "offcontract"
            ? `<span class="eco-chip ${bucket}" aria-hidden="true">${BUCKET_LABEL[bucket]}</span>`
            : "";
        const life = sv.lifecycle
            ? `<span class="eco-life ${esc(sv.lifecycle)}">${esc(sv.lifecycle)}</span>`
            : `<span class="eco-life none" title="no MIP-1 lifecycle recorded">\u2014</span>`;
        return `<a class="eco-row${archived ? " archived" : ""}${instrumentation === "stream" ? " streaming" : ""}${kind !== "service" ? " reference" : ""}" href="${esc(sv.url)}" target="_blank" rel="noopener noreferrer">${dot}<span class="eco-name">${esc(sv.name)}</span><span class="sr-only">, ${heard},</span>${chip}${life}</a>`;
    };

    const sections = [...groups.entries()].map(([key, list]) => `
    <div class="eco-group">
      <div class="eco-group-title">${esc(SECTION_LABELS[key] ?? key)}</div>
      ${list.map(row).join("")}
    </div>`).join("");

    // Nothing to count until the first sweep of the registry's services has
    // settled: "15 unmeasured" for the second it takes would claim a result
    // the sweep has not given. A first sweep that got nothing does show it —
    // that is the result — and so do the sweeps after it, rather than the
    // block vanishing for as long as each is in flight.
    // While stale the counts are dated rather than hidden — they are the last
    // thing known — but never presented as now.
    const tally = tallyServices(nodes);
    const names = namesHtml(tally);
    const at = freshness.checkedAt;
    const clock = at === null ? freshnessText(freshness)
        : stale ? `stale \u00b7 as of ${shortClock(at)}`
            : `checked ${clockTime(at)}${freshness.state === "refreshing" ? " \u00b7 refreshing\u2026" : ""}`;
    const reported = freshness.state === "none" && freshness.sweeping && !freshness.settled
        ? ""
        : `
    <div class="eco-health${stale ? " stale" : ""}">
      <div class="row"><span>Reported health</span><b class="eco-clock">${clock}</b></div>
      <div class="eco-tally">${tallyHtml(tally)}</div>
      ${names ? `<div class="eco-names">${names}</div>` : ""}
      ${tally.archived ? `<div class="eco-note">${tally.archived} archived, counted by ${tally.archived === 1 ? "its" : "their"} reading like any other service</div>` : ""}
    </div>`;

    // The verdicts lead, ahead of how much is instrumented. Between 768 and
    // 1100px this panel is a 35vh strip over the map, and in landscape the
    // map's heading leaves the tally and names to it: after the four count
    // rows they sat below the strip's fold, visible nowhere without scrolling.
    renderEcosystem(`
    <h2>Ecosystem</h2>
    ${reported}
    <div class="row"><span>Services</span><b>${services.length}</b></div>
    <div class="row"><span>Streaming here</span><b>${streaming}</b></div>
    <div class="row"><span>Health-checked</span><b>${checked}</b></div>
    <div class="row"><span>Listed only</span><b>${listed}</b></div>
    <div class="eco-list${stale ? " stale" : ""}">${sections}</div>
    `);
}

export function updateSidebar(dataBridge: DataBridge): void {
    const ls = dataBridge.liveStats;
    const up = dataBridge.serviceUp;
    const statsUp = dataBridge.statsUp;
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

    // This poll's stats, or nothing. A service is LIVE when its signals *or*
    // its stats answered, and `liveStats` keeps the last stats that ever
    // arrived — so gating on LIVE put hours-old figures beside a LIVE badge
    // whenever /stats failed and /signals did not. They show a dash instead,
    // and the card says the stats did not answer (see `note` below).
    const a = statsUp.algora ? ls.algora : null;
    const ao = statsUp.ao ? ls.ao : null;
    const b = statsUp.bridge ? ls.bridge : null;

    // Pipeline summary. These are the services' own totals, not the sizes of our
    // fetch caches — the issue list's length (no longer fetched) only ever
    // reported its 30-item cap, and the debate list's its own.
    setHTML(statsEl, `
    <div class="row"><span>Streaming</span><b class="row-list"><span>Algora (Sense)</span><span>AO (Plan)</span><span>Bridge (Execute)</span></b></div>
    <div class="row"><span>Signal Queue</span><b>${dataBridge.queueSize()}</b></div>
    <div class="row"><span>Open Issues</span><b>${num(a?.openIssues) ?? NA}</b></div>
    <div class="row"><span>Debates Today</span><b>${num(ao?.stats?.debates_today) ?? NA}</b></div>
    `);

    // Service I/O — figures from the stats each service returned this poll.
    // The rest show NA instead of borrowing another number, and the card says
    // why: OFFLINE when neither its signals nor its stats answered, LIVE with
    // "no stats this poll" when only the signals did. Before the first verdict
    // every card reads CONNECTING, as the status line does — a missing badge
    // used to look the same before the first poll as after an outage.
    // The badge's words are shared with the phone's belt card (live-badge.ts).
    type Svc = "algora" | "ao" | "bridge";
    const verdict = conn !== "connecting";
    const badge = (s: Svc) => " " + liveBadge(conn, up[s]);
    const note = (s: Svc): string | null => {
        if (!verdict) return null;
        if (!up[s]) return "no response this poll";
        if (statsUp[s]) return null;
        const at = dataBridge.statsAt[s];
        return at !== null ? `no stats this poll \u00b7 last read ${clockTime(at)}` : "no stats answer yet";
    };
    const cls = (s: Svc) => `svc ${s}${verdict && !up[s] ? " offline" : ""}`;

    const aIn = a ? `${num(a.signalsToday) ?? NA}/today` : NA;
    const aOut = a ? `${num(a.openIssues) ?? NA} open` : NA;
    const aHint = a ? `sessions:${num(a.activeSessions) ?? NA} · agents:${num(a.totalAgents) ?? NA}` : note("algora") ?? "9-stage pipeline";

    const aoStats = ao?.stats;
    const aoIn = aoStats ? `${num(aoStats.signals_today) ?? NA}/today` : NA;
    const aoOut = aoStats
        ? `Ideas ${num(aoStats.ideas_generated) ?? NA} · Plans ${num(aoStats.plans_created) ?? NA}`
        : NA;
    const aoHint = aoStats
        ? `debates:${num(aoStats.debates_today) ?? NA} · agents:${num(aoStats.agents_active) ?? NA}`
        : note("ao") ?? "3-phase debate";

    const bIn = b ? `${num(b.signals?.total)?.toLocaleString() ?? NA} signals` : NA;
    const bOut = b
        ? `Issues ${num(b.issues?.total) ?? NA} · Proofs ${num(b.outcomes?.totalProofs) ?? NA}`
        : NA;
    // `?? 0` here used to turn "no proofs recorded yet" (null) into "0% success",
    // which reads as every outcome having failed.
    const successRate = num(b?.outcomes?.successRate);
    const bSuccess = successRate !== null ? `${successRate}%` : NA;
    const bNote = b ? null : note("bridge");
    const bHint = b
        ? `proposals:${num(b.proposals?.total) ?? NA} · success:${bSuccess} · 5 specialist agents`
        : bNote ?? "L0-L4 pipeline · 5 specialist agents";

    setHTML(serviceEl, `
    <h2>Service I/O</h2>
    <div class="${cls("algora")}">
      <div class="svc-title">ALGORA${badge("algora")}</div>
      <div class="drow"><span>Input</span><b>Signals ${aIn}</b></div>
      <div class="drow"><span>Output</span><b>Issues ${aOut}</b></div>
      <div class="hint">${aHint}</div>
    </div>
    <div class="${cls("ao")}">
      <div class="svc-title">AO${badge("ao")}</div>
      <div class="drow"><span>Input</span><b>Signals ${aoIn}</b></div>
      <div class="drow"><span>Output</span><b>${aoOut}</b></div>
      <div class="hint">${aoHint}</div>
    </div>
    <div class="${cls("bridge")}">
      <div class="svc-title">BRIDGE${badge("bridge")}</div>
      <div class="drow"><span>Input</span><b>${bIn}</b></div>
      <div class="drow"><span>Output</span><b>${bOut}</b></div>
      <div class="hint">${bHint}</div>
    </div>
    `);

    // connection status update
    setHTML(connEl, connMarkup(conn, `queue: ${dataBridge.queueSize()}`));
}
