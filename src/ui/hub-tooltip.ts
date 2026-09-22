import type { EcosystemNode, HealthFreshness } from "../services/ecosystem-feed.ts";
import { esc } from "./html.ts";
import { ageText, clockTime } from "./ecosystem-status.ts";

/**
 * The Space Hub map's hover card — on a touch screen, the card a first tap
 * pins to a body (see map-selection.ts) — as markup.
 *
 * It lives here rather than in HubMap because HubMap imports Phaser, which
 * cannot load where the tests run, and this is the map's one innerHTML sink
 * for other services' data: registry rows and city's aggregate both reach it.
 * As a pure function it is tested like the sidebar is. The helper it used to
 * carry was typed for strings and threw — inside the hover handler — on the
 * first registry row whose name or lifecycle was not one.
 */
export function hubTooltipHtml(
    node: EcosystemNode,
    opts: { isSelf: boolean; archived: boolean; freshness?: HealthFreshness | null; now?: number; touch?: boolean },
): string {
    const { service: sv, health, instrumentation, kind } = node;
    // The class comes from a fixed set, never from the status string itself:
    // an off-contract status is shown, escaped, in the unmeasured colour.
    const healthClass = health?.status === "ok" || health?.status === "degraded" || health?.status === "down"
        ? health.status : "unknown";
    // A file is either served or missing; a link's uptime belongs to whoever
    // runs it. Neither has a health line, because neither has health.
    const measured = kind === "artifact"
        ? `<span class="dim">a published file, not a service</span>`
        : kind === "link"
            ? `<span class="dim">an external destination — not ours to measure</span>`
            : health
                ? `<b class="${healthClass}">health ${esc(health.status)}</b>${health.latencyMs != null ? ` · ${esc(health.latencyMs)}ms` : ""}`
                : `<span class="dim">not measured by this monitor</span>`;
    // How old that reading is, by our own sweep clock — never the entry's
    // `checkedAt`, which is the service's own timestamp: for a static artifact
    // the build time, for city's reports city's clock. One age fits every
    // reading, because a sweep that lands replaces them all.
    const f = opts.freshness;
    const age = kind === "service" && health && f && f.checkedAt !== null
        ? f.state === "stale"
            ? `<div class="m stale">stale — last reading ${clockTime(f.checkedAt)}, ${ageText((opts.now ?? Date.now()) - f.checkedAt)}</div>`
            : `<div class="m dim">checked ${clockTime(f.checkedAt)} · ${ageText((opts.now ?? Date.now()) - f.checkedAt)}${f.state === "refreshing" ? " · refreshing…" : ""}</div>`
        : "";
    // What the next click — or, on a touch screen, the next tap on this same
    // body — does. Our own star opens nothing: the viewer is already here,
    // and the camera is already where it would go (see HubMap.activate). A
    // file and a link are not services, and the line above says so, so this
    // one does not call them one: each gets its own words.
    const verb = opts.touch ? "tap again" : "click";
    const action = opts.isSelf ? "you are here — this monitor"
        : instrumentation === "stream" ? `${verb} to open its belt`
            : kind === "artifact" ? `${verb} to open the file`
                : kind === "link" ? `${verb} to open the link`
                    : `${verb} to open the service`;
    return `<div class="t">${esc(sv.name)}</div>`
        + `<div class="m">${esc(sv.lifecycle ?? "lifecycle unspecified")} · ${esc(kind === "service" ? instrumentation : kind)}</div>`
        + `<div class="m">${measured}</div>`
        + age
        + (opts.archived ? `<div class="m dim">archived — preserved read-only</div>` : "")
        + `<div class="a">${action}</div>`;
}
