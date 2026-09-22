import type { ConnState } from "../services/data-bridge.ts";
import { esc, str } from "./html.ts";
import { lapsed, liveBadge } from "./live-badge.ts";

/**
 * The phone's text for a belt view: what the Algora, AO and Bridge canvases
 * say, at a size a phone can read.
 *
 * On a portrait phone each belt zone is fitted to the screen's width, which
 * puts its canvas text at 3–6 CSS px, point-sampled (`pixelArt: true`) on a
 * 1x backing store — no resolution or filter setting recovers that, because
 * the problem is display size. The map fixed the same thing by moving its
 * text into the DOM; the belts never did, so on a phone the debate topic, the
 * idea titles and scores, the signal titles, the trust average and the
 * outcome log could not be read at all.
 *
 * Only that text is here. The figures the sidebar already shows in legible
 * DOM — queue, open issues, signals today, AO's ideas and plans, Bridge's
 * proposals and success rate — are left to it, and the card says where they
 * are. AO's project total is in no sidebar row, so it is here.
 *
 * Each card also says whether its service answered this poll, with the
 * sidebar's own badge (live-badge.ts): on a phone the sidebar is a closed
 * drawer and the map's heading is hidden on a belt view, so nothing else on
 * screen would. The AO and Bridge lists are what the service last sent, and a
 * failed read keeps them, so once a poll goes unanswered they are called what
 * they then are — the last received, not the latest. The Algora belt holds
 * all three services' signals, so its card only says Algora did not answer
 * (see algoraHeadHtml). The caches carry no times of their own, so the card
 * gives no ages it would have to invent.
 *
 * Every string comes from another service's JSON behind an unchecked cast,
 * so each is checked for its type and escaped here, the sink.
 */

/** Placeholder for a figure we do not have, as everywhere else. */
const NA = "—";
const IDEAS_SHOWN = 5;
const OUTCOMES_SHOWN = 5;

// The same thresholds the AO belt promotes at (AOZone). README states them.
const PLAN_SCORE = 7;
const PROJECT_SCORE = 8;

/** The ☰ button's name is "Toggle info panel": the words point at it, and the
 *  glyph, which a screen reader reads as "trigram for heaven", is for the eye. */
const PANEL = `the info panel (<span aria-hidden="true">☰</span>)`;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
/** Cut to `n` characters, with an ellipsis when something was cut. */
const cut = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

/** The mean of the finite trust scores, or null when there are none. What the
 *  Bridge canvas gauge shows, and what this card shows in its place. */
export function trustAverage(entries: readonly unknown[]): number | null {
    const scores = entries.map(e => (isObj(e) ? num(e.score) : null)).filter((n): n is number => n !== null);
    return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
}

/** A signal on the Algora belt. `id` is the belt's own, unique for the life
 *  of the page: what the card keeps each row by (see BeltCard.updateAlgora). */
export type BeltItem = { id: string; title: string; severity: string; origin: string; stage: string };

/** Whether the card's service answered this poll: DataBridge's
 *  connectionState() and that service's serviceUp flag. */
export type BeltState = { conn: ConnState; up: boolean };

export type BeltCardInput =
    | { zone: "algora"; state: BeltState; items: readonly BeltItem[] }
    | {
        zone: "ao"; state: BeltState; debates: readonly unknown[]; debatesErrored: boolean;
        ideas: readonly unknown[]; projects: number | null;
    }
    | { zone: "bridge"; state: BeltState; trust: readonly unknown[]; outcomes: readonly unknown[] };

const SEVERITIES = new Set(["critical", "high", "medium", "low"]);
const ORIGINS: Record<string, string> = { algora: "Algora", ao: "AO", bridge: "Bridge" };
const figure = (n: number | null): string => (n === null ? NA : String(n));

/**
 * A card's heading: its title and the service's badge, and, once a poll has
 * gone unanswered, a line that says so — with what that makes of the lists
 * below, when they are the service's own.
 */
function headHtml(title: string, service: string, s: BeltState, ownLists: boolean): string {
    return `<h2 class="bc-h">${title} ${liveBadge(s.conn, s.up)}</h2>`
        + (lapsed(s.conn, s.up)
            ? `<p class="bc-stale">No response from ${service} this poll${ownLists ? " — showing the last data received" : ""}.</p>`
            : "");
}

/** A signal's stage and origin, as plain text: the one part of its row that
 *  changes while it is on the belt. */
function algoraMeta(it: BeltItem): string {
    const from = ORIGINS[it.origin] ?? "";
    return `${str(it.stage)}${from ? ` · from ${from}` : ""}`;
}

function algoraRowHtml(it: BeltItem): string {
    const sev = SEVERITIES.has(it.severity) ? it.severity : "low";
    return `<li data-id="${esc(str(it.id))}"><span class="bc-sev ${sev}">${sev}</span> `
        + `<span class="bc-t">${esc(cut(str(it.title), 120)) || NA}</span>`
        + `<span class="bc-m">${esc(algoraMeta(it))}</span></li>`;
}

// The belt carries signals from all three services, so Algora not answering
// does not make them old: its heading says only that Algora did not answer.
const algoraHeadHtml = (s: BeltState): string => headHtml("Algora · signals on the belt", "Algora", s, false);

/** Newest first: the one the loader just put on the belt leads. */
const newestFirst = (items: readonly BeltItem[]): BeltItem[] => [...items].reverse();

function algoraHtml(items: readonly BeltItem[], s: BeltState): string {
    const rows = newestFirst(items).map(algoraRowHtml).join("");
    // The list and the empty line are both always there, one of them hidden,
    // so that BeltCard.updateAlgora can switch between them in place.
    return `<div class="bc-head">${algoraHeadHtml(s)}</div>`
        + `<ol class="bc-list"${rows ? "" : " hidden"}>${rows}</ol>`
        + `<p class="bc-empty"${rows ? " hidden" : ""}>No signals on the belt right now.</p>`
        + `<p class="bc-note">The belt takes signals from all three services. Queue, issues and signal counts are in ${PANEL}.</p>`;
}

function aoHtml(i: Extract<BeltCardInput, { zone: "ao" }>): string {
    const old = lapsed(i.state.conn, i.state.up);
    const debates = i.debates.filter(isObj).map(d => ({ topic: str(d.topic), context: str(d.context) }))
        .filter(d => d.topic);
    // The debates are read on a schedule of their own, and one that failed
    // keeps the list before it — which is then not the latest either.
    const debatesOld = old || (i.debatesErrored && debates.length > 0);
    const debateHtml = debates.length
        ? `<ul class="bc-list">${debates.map(d => `<li><span class="bc-t">${esc(cut(d.topic, 120))}</span>`
            + (d.context ? `<span class="bc-m">${esc(cut(d.context, 160))}</span>` : "") + `</li>`).join("")}</ul>`
        // The canvas card's own words for the same two states.
        : `<p class="bc-empty">${i.debatesErrored ? "AO debates unavailable" : "Awaiting debate data…"}</p>`;

    const ideas = i.ideas.filter(isObj).slice(0, IDEAS_SHOWN).map(o => {
        const score = num(o.score);
        // A score that is not a number is not a score: a dash, never a 0.
        const cls = score === null ? "none" : score >= PROJECT_SCORE ? "project" : score >= PLAN_SCORE ? "plan" : "idea";
        // The belt's own choice of title: AO's Korean one first. The page is
        // lang="en", and a screen reader picks its voice by lang, so a Korean
        // title is marked as one — and only then: the English fallback is not.
        const ko = str(o.title_ko);
        const title = ko || str(o.title) || "Idea";
        return `<li><span class="bc-score ${cls}">${score === null ? NA : score.toFixed(1)}</span> `
            + `<span class="bc-t"${ko ? ` lang="ko"` : ""}>${esc(cut(title, 120))}</span></li>`;
    }).join("");
    return `<div class="bc-head">${headHtml(`AO · ${debatesOld ? "debates last received" : "latest debates"}`, "AO", i.state, true)}</div>`
        + debateHtml
        + `<h3 class="bc-h2">${old ? "Ideas last received" : "Latest ideas"} <span class="bc-dim">score ≥${PLAN_SCORE} plan · ≥${PROJECT_SCORE} project</span></h3>`
        + (ideas ? `<ol class="bc-list">${ideas}</ol>` : `<p class="bc-empty">No ideas to show yet.</p>`)
        + `<p class="bc-total">Total projects: ${figure(i.projects)}${old ? " (last received)" : ""}</p>`
        + `<p class="bc-note">Idea and plan totals are in ${PANEL}.</p>`;
}

function bridgeHtml(i: Extract<BeltCardInput, { zone: "bridge" }>): string {
    const old = lapsed(i.state.conn, i.state.up);
    const avg = trustAverage(i.trust);
    const outcomes = i.outcomes.filter(isObj).slice(0, OUTCOMES_SHOWN).map(o => {
        // Only a boolean says which way it went; anything else claims neither.
        const verdict = o.success === true ? `<span class="bc-out ok">OK</span>`
            : o.success === false ? `<span class="bc-out fail">FAIL</span>` : `<span class="bc-out">${NA}</span>`;
        const id = str(o.id);
        return `<li>${verdict} <span class="bc-t">${esc(id ? cut(id, 12) : NA)}</span>`
            + (str(o.status) ? ` <span class="bc-m bc-inline">${esc(cut(str(o.status), 40))}</span>` : "") + `</li>`;
    }).join("");
    return `<div class="bc-head">${headHtml("Bridge · trust &amp; outcomes", "Bridge", i.state, true)}</div>`
        + `<p class="bc-row"><span>Agent trust${old ? " (last received)" : ""}</span><b>${avg === null ? NA : avg.toFixed(1)}</b></p>`
        + `<h3 class="bc-h2">${old ? "Outcomes last received" : "Recent outcomes"}</h3>`
        + (outcomes ? `<ul class="bc-list">${outcomes}</ul>` : `<p class="bc-empty">No outcomes to show.</p>`)
        + `<p class="bc-note">Proposal and success figures are in ${PANEL}.</p>`;
}

/** The card's markup for one belt view. */
export function beltCardHtml(input: BeltCardInput): string {
    return input.zone === "algora" ? algoraHtml(input.items, input.state)
        : input.zone === "ao" ? aoHtml(input) : bridgeHtml(input);
}

/** The Algora card's live parts, once it has been written in full. */
type AlgoraParts = {
    head: HTMLElement;
    /** The markup `head` was last given, as generated: the browser's own
     *  serialisation of it would never compare equal. */
    headHtml: string;
    list: HTMLElement;
    empty: HTMLElement;
    rows: Map<string, HTMLElement>;
};

/**
 * The card itself: one element in #stage, the tabpanel, so that it is part of
 * the view it describes. The stylesheet shows it at phone widths only, and
 * the scene only fills it there, because only the phone layout frames a belt
 * with room under it. Wider screens fit the whole canvas into the stage,
 * which leaves a tablet's belt text about as small as a phone's (see
 * style.css).
 */
export class BeltCard {
    private el: HTMLElement;
    private written = "";
    private zone: string | null = null;
    private algora: AlgoraParts | null = null;

    constructor(host: HTMLElement) {
        this.el = document.createElement("section");
        this.el.className = "belt-card";
        this.el.hidden = true;
        host.appendChild(this.el);
    }

    /** Which belt the card is for (null on the map), and where it starts: just
     *  under the belt, which the scene frames at the top of a phone screen. */
    show(zone: string | null, top: number): void {
        if (zone !== this.zone) {
            // Another belt: its card is written afresh.
            this.written = "";
            this.algora = null;
        }
        this.zone = zone;
        this.el.hidden = zone === null;
        if (zone === null) return;
        this.el.className = `belt-card ${zone}`;
        this.el.style.setProperty("--card-top", `${Math.round(top)}px`);
    }

    get shownZone(): string | null {
        return this.zone;
    }

    /**
     * Writes the whole card when its markup changed: it is refreshed twice a
     * second. AO's and Bridge's change only when a poll brings new data, so
     * a rewrite is rare there. Algora's is patched instead (updateAlgora).
     */
    update(markup: string): void {
        if (markup === this.written) return;
        this.written = markup;
        this.algora = null;
        this.el.innerHTML = markup;
    }

    /**
     * The Algora card, kept row by row. Its markup names each signal's
     * stage, and with five signals a stage apart one of them moves on about
     * every 0.6 s — so rewritten whenever it changed, every node in the card
     * was replaced about once a second, and a screen reader's place in the
     * list or a selection in it was gone as soon as it was made (the problem
     * Sidebar.setHTML describes for the panels). Written in full once, then:
     * a signal's row lives from when it lands on the belt until it leaves,
     * only the text of its stage changing, and the heading and note are
     * rewritten only when what they say changed. Nothing here is a live
     * region, on purpose: a stage tick is not news to announce.
     */
    updateAlgora(items: readonly BeltItem[], state: BeltState): void {
        const a = this.algora;
        if (!a) {
            this.update(beltCardHtml({ zone: "algora", items, state }));
            const head = this.el.querySelector<HTMLElement>(".bc-head");
            const list = this.el.querySelector<HTMLElement>(".bc-list");
            const empty = this.el.querySelector<HTMLElement>(".bc-empty");
            if (!head || !list || !empty) return;
            const rows = new Map<string, HTMLElement>();
            for (const li of Array.from(list.children) as HTMLElement[]) {
                if (li.dataset.id) rows.set(li.dataset.id, li);
            }
            this.algora = { head, headHtml: algoraHeadHtml(state), list, empty, rows };
            return;
        }
        // What is on screen is no longer that markup.
        this.written = "";

        const head = algoraHeadHtml(state);
        if (head !== a.headHtml) {
            a.head.innerHTML = head;
            a.headHtml = head;
        }

        const want = newestFirst(items);
        const ids = new Set(want.map(it => it.id));
        for (const [id, li] of a.rows) {
            if (!ids.has(id)) { li.remove(); a.rows.delete(id); }
        }
        want.forEach((it, i) => {
            let li = a.rows.get(it.id);
            if (li) {
                const meta = li.querySelector(".bc-m");
                const text = algoraMeta(it);
                if (meta && meta.textContent !== text) {
                    // The text node itself where there is one, so that even
                    // it survives the change.
                    const t = meta.firstChild;
                    if (t && t.nodeType === 3 && !t.nextSibling) (t as Text).data = text;
                    else meta.textContent = text;
                }
            } else {
                const tpl = document.createElement("template");
                tpl.innerHTML = algoraRowHtml(it);
                const made = tpl.content.firstElementChild as HTMLElement | null;
                if (!made) return;
                li = made;
                a.rows.set(it.id, li);
            }
            // New rows go in at their place; the rest keep theirs, since the
            // belt lists its signals in the order they landed on it.
            if (a.list.children[i] !== li) a.list.insertBefore(li, a.list.children[i] ?? null);
        });
        a.list.hidden = want.length === 0;
        a.empty.hidden = want.length > 0;
    }

    destroy(): void {
        this.el.remove();
    }
}
