import type { EcosystemNode, HealthFreshness } from "../services/ecosystem-feed.ts";
import type { HealthEntry, RegistryService } from "../services/types.ts";
import { esc } from "./html.ts";

/**
 * What the services report, counted — shared by the map's HUD, the sidebar's
 * Ecosystem panel and the page title, so the three can never disagree.
 *
 * The map used to summarise only how much it could see (streaming, health-
 * checked, listed), never what it saw. A service declaring itself down stayed
 * "health-checked", so every count held still while one 6px dot turned red —
 * which is all a red-green colour-blind viewer had, and on a phone, with the
 * legend hidden, all anyone had. These put the verdicts into words.
 *
 * Phaser-free and DOM-free, so it is tested like the tooltip is.
 */

/**
 * The five things a service's reading can be, as far as this monitor is
 * entitled to say. Each is its own bucket, and none is folded into another:
 *
 *   offcontract — it answered, with a status outside ok/degraded/down
 *                 (algora says "running"). Not translated, so not ok.
 *   unmeasured  — no reading: no statusUrl, nothing we could read, or a fetch
 *                 that threw. Not down: we could not see it, which is a
 *                 different claim from it telling us it is unwell.
 */
export type HealthBucket = "ok" | "offcontract" | "degraded" | "down" | "unmeasured";

/** Display order: the verdicts, then the absence of one. */
export const BUCKETS: readonly HealthBucket[] = ["ok", "offcontract", "degraded", "down", "unmeasured"];

export const BUCKET_LABEL: Record<HealthBucket, string> = {
    ok: "ok", offcontract: "off-contract", degraded: "degraded", down: "down", unmeasured: "unmeasured",
};

/** Buckets whose members are named, not just counted: every reading that is
 *  not ok. Unmeasured is left out — it is the absence of a claim, and on a
 *  map that probes few services it would be most of the list. */
const NAMED: readonly HealthBucket[] = ["down", "degraded", "offcontract"];

export function healthBucket(health: HealthEntry | null): HealthBucket {
    if (!health) return "unmeasured";
    const s = health.status;
    return s === "ok" || s === "degraded" || s === "down" ? s : "offcontract";
}

/** Archived or deprecated: kept on the map, drawn in the archived colour. */
export function isArchived(s: RegistryService): boolean {
    return s.lifecycle === "archive" || s.status === "deprecated";
}

export type ServiceTally = {
    counts: Record<HealthBucket, number>;
    /** Each bucket's members, in registry order. */
    names: Record<HealthBucket, { name: string; archived: boolean }[]>;
    /** How many services were counted: every node of kind "service". */
    services: number;
    /** How many of those are archived. They are counted by their reading like
     *  any other service — an archived service we still read can still go
     *  down — and flagged where they are named. */
    archived: number;
};

/**
 * Counts services only. A file cannot be degraded and an exchange listing's
 * uptime is not ours to report, so neither is in any bucket — the same rule
 * that keeps them out of the health sweep.
 */
export function tallyServices(nodes: readonly EcosystemNode[]): ServiceTally {
    const counts = { ok: 0, offcontract: 0, degraded: 0, down: 0, unmeasured: 0 };
    const names: ServiceTally["names"] = { ok: [], offcontract: [], degraded: [], down: [], unmeasured: [] };
    let services = 0;
    let archived = 0;
    for (const n of nodes) {
        if (n.kind !== "service") continue;
        services++;
        const a = isArchived(n.service);
        if (a) archived++;
        const b = healthBucket(n.health);
        counts[b]++;
        names[b].push({ name: String(n.service.name ?? n.service.id), archived: a });
    }
    return { counts, names, services, archived };
}

/**
 * "12 ok · 1 off-contract · 0 degraded · 1 down · 1 unmeasured", as markup.
 * Every bucket is always shown, zeros included: a "0 down" is itself the
 * reassurance, and a line that grew and shrank would read as motion.
 */
export function tallyHtml(t: ServiceTally): string {
    return BUCKETS.map(b =>
        `<span class="tally-${b}${t.counts[b] ? "" : " zero"}"><b>${t.counts[b]}</b> ${BUCKET_LABEL[b]}</span>`,
    ).join(" <i>·</i> ");
}

/**
 * "down: Signal Map · off-contract: Algora (archived)", as markup — empty when
 * every reading is ok or absent. `limit` caps the names per bucket for the
 * HUD, which sits over the map; the rest become "+N more".
 *
 * Each name is its own unit (`.nm`, kept on one line by the stylesheet), with
 * the bucket's label joined to the first and each comma — or the "+N more" —
 * to the name before it. Left to wrap at any space, "Mossland Signal" broke
 * into "Mossland" / "Signal", and a line ending "down: …, Mossland" named a
 * different registry service as down; "off-contract" broke at its hyphen. The
 * text is unchanged, so it still reads, copies and searches the same.
 */
export function namesHtml(t: ServiceTally, limit = Infinity): string {
    return NAMED.filter(b => t.names[b].length > 0).map(b => {
        const list = t.names[b];
        const shown = list.slice(0, limit).map(n => esc(n.name) + (n.archived ? " (archived)" : ""));
        const more = list.length > limit ? ` +${list.length - limit} more` : "";
        const units = shown.map((name, i) =>
            `<span class="nm">${i === 0 ? `${BUCKET_LABEL[b]}: ` : ""}${name}${i < shown.length - 1 ? "," : more}</span>`);
        return `<span class="names-${b}">${units.join(" ")}</span>`;
    }).join(" <i>·</i> ");
}

/**
 * The page title, prefixed while anything is down or degraded, or while the
 * readings behind it are stale — so a tab in the strip says so without being
 * looked at. Stale is part of it because a clear title over a reading nobody
 * has been able to refresh would be the same overstatement as a green body.
 *
 * A tab in the strip is a hidden tab, and a hidden tab does not poll: its
 * counts are the last reading taken before it was hidden, and cannot pick up
 * a service that goes down afterwards. The stale prefix is what keeps that
 * reading from passing as current, so the scene keeps re-checking the title
 * while hidden (SpaceHubScene.refreshTitle), on the same clock as every other
 * surface.
 */
export function documentTitle(base: string, t: ServiceTally | null, freshness: HealthFreshness | null): string {
    const parts: string[] = [];
    if (t?.counts.down) parts.push(`${t.counts.down} down`);
    if (t?.counts.degraded) parts.push(`${t.counts.degraded} degraded`);
    if (freshness?.state === "stale") parts.push(parts.length ? "stale" : "health stale");
    return parts.length ? `(${parts.join(", ")}) ${base}` : base;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 14:32:05, in the viewer's local time. */
export function clockTime(ms: number): string {
    const d = new Date(ms);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 14:32 — for "stale since", where the seconds would only be noise. */
export function shortClock(ms: number): string {
    return clockTime(ms).slice(0, 5);
}

/** "12 s ago", "3 min ago", "2 h ago". */
export function ageText(ms: number): string {
    const s = Math.max(0, Math.floor(ms / 1000));
    if (s < 60) return `${s} s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} min ago`;
    return `${Math.floor(m / 60)} h ago`;
}

/**
 * The one line every surface uses to date the readings.
 *
 *   health checked 14:32:05
 *   health checked 11:02:40 · refreshing…     (a sweep is replacing it)
 *   health stale since 14:32                  (nothing is)
 *   checking health…  /  no health reading yet
 */
export function freshnessText(f: HealthFreshness): string {
    if (f.checkedAt === null) return f.sweeping ? "checking health…" : "no health reading yet";
    if (f.state === "stale") return `health stale since ${shortClock(f.checkedAt)}`;
    return `health checked ${clockTime(f.checkedAt)}${f.state === "refreshing" ? " · refreshing…" : ""}`;
}
