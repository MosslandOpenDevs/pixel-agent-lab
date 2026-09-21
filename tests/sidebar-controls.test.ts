import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initSidebar, updateEcosystem } from "../src/ui/Sidebar.ts";
import type { EcosystemFeed, EcosystemNode, HealthFreshness } from "../src/services/ecosystem-feed.ts";
import type { RegistryService } from "../src/services/types.ts";

/**
 * The sidebar's controls from the keyboard: the phone drawer and the zone
 * tabs.
 *
 * The drawer could not be closed with Escape, and a keyboard user who opened
 * it had to Tab past everything behind it to get in. The tabs announced the
 * tabs pattern and answered none of its keys. What the stylesheet does — the
 * closed drawer out of the Tab order — is checked in the browser; this is the
 * part that is code.
 *
 * The DOM is a stub of the calls initSidebar makes, as in sidebar.test.ts,
 * with listeners, classes and focus that behave.
 */

type Handler = (e: Record<string, unknown>) => void;

let activeElement: StubEl | null = null;
const docListeners: Record<string, Handler[]> = {};
const dispatched: { type: string; detail: unknown }[] = [];

class StubEl {
    id = "";
    tabIndex = 0;
    inert?: boolean;
    scrollTop = 0;
    protected html = "";
    get innerHTML() { return this.html; }
    set innerHTML(v: string) { this.html = v; }
    dataset: Record<string, string> = {};
    attrs: Record<string, string> = {};
    classes = new Set<string>();
    kids: StubEl[] = [];
    private on: Record<string, Handler[]> = {};
    classList = {
        toggle: (c: string, force?: boolean) => {
            const want = force ?? !this.classes.has(c);
            if (want) this.classes.add(c); else this.classes.delete(c);
            return want;
        },
        contains: (c: string) => this.classes.has(c),
    };
    addEventListener(type: string, fn: Handler) { (this.on[type] ??= []).push(fn); }
    setAttribute(n: string, v: string) { this.attrs[n] = v; }
    focus() { activeElement = this; }
    contains(el: unknown): boolean { return el === this || this.kids.some(k => k.contains(el)); }
    querySelector(sel: string) { return sel === "h1" ? this.kids[0] ?? null : null; }
    querySelectorAll(_sel: string): StubEl[] { return []; }
    getAttribute(n: string) { return this.attrs[n] ?? null; }
    fire(type: string, e: Record<string, unknown> = {}) { (this.on[type] ?? []).forEach(fn => fn(e)); }
}

/** A panel whose links are rebuilt, as new nodes, on every innerHTML write. */
class PanelEl extends StubEl {
    links: StubEl[] = [];
    get innerHTML() { return this.html; }
    set innerHTML(v: string) {
        this.html = v;
        this.links = [...v.matchAll(/href="([^"]*)"/g)].map(m => {
            const a = new StubEl();
            a.attrs.href = m[1];
            return a;
        });
        this.kids = this.links;
    }
    querySelectorAll(_sel: string) { return this.links; }
}

let els: Record<string, StubEl>;
let tabs: StubEl[];

beforeEach(() => {
    activeElement = null;
    for (const k of Object.keys(docListeners)) delete docListeners[k];
    dispatched.length = 0;
    els = {};
    const panel = new StubEl();
    panel.kids.push(new StubEl());          // its h1
    els[".panel"] = panel;
    els["#stage"] = new StubEl();
    els["#ecosystem"] = new PanelEl();
    tabs = ["hub", "algora", "ao", "bridge"].map(zone => {
        const t = new StubEl();
        t.id = `tab-${zone}`;
        t.dataset.zone = zone;
        return t;
    });
    vi.stubGlobal("document", {
        get activeElement() { return activeElement; },
        querySelector: (sel: string) => (els[sel] ??= new StubEl()),
        getElementById: (id: string) => (els[`#${id}`] ??= new StubEl()),
        querySelectorAll: (sel: string) => (sel === ".zone-tab" ? tabs : []),
        addEventListener: (type: string, fn: Handler) => { (docListeners[type] ??= []).push(fn); },
        dispatchEvent: (e: CustomEvent) => { dispatched.push({ type: e.type, detail: e.detail }); return true; },
    });
    initSidebar();
});

afterEach(() => { vi.unstubAllGlobals(); });

const key = (k: string) => {
    const e = { key: k, defaultPrevented: false, preventDefault() { e.defaultPrevented = true; } };
    return e;
};
const pressOnDocument = (k: string) => (docListeners.keydown ?? []).forEach(fn => fn(key(k)));

describe("the phone drawer", () => {
    const toggle = () => els["#panelToggle"];
    const panel = () => els[".panel"];
    const backdrop = () => els[".panel-backdrop"];

    it("moves focus into the panel when it opens", () => {
        toggle().focus();
        toggle().fire("click");
        expect(panel().classes.has("open")).toBe(true);
        expect(toggle().attrs["aria-expanded"]).toBe("true");
        expect(activeElement).toBe(panel().kids[0]);
    });

    it("closes on Escape and puts focus back on ☰", () => {
        toggle().fire("click");
        pressOnDocument("Escape");
        expect(panel().classes.has("open")).toBe(false);
        expect(backdrop().classes.has("open")).toBe(false);
        expect(toggle().attrs["aria-expanded"]).toBe("false");
        expect(activeElement).toBe(toggle());
    });

    it("leaves focus alone on Escape while it is closed", () => {
        tabs[2].focus();
        pressOnDocument("Escape");
        expect(activeElement).toBe(tabs[2]);
        expect(toggle().attrs["aria-expanded"]).toBeUndefined();
    });

    // A browser blurs the focused element on the press, before the click:
    // the backdrop is not focusable, so focus goes to <body>.
    const pressBackdrop = () => {
        backdrop().fire("pointerdown");
        activeElement = null;
        backdrop().fire("click");
    };

    it("closes from the backdrop, and brings focus that was inside it back to ☰", () => {
        toggle().fire("click");
        pressBackdrop();
        expect(panel().classes.has("open")).toBe(false);
        expect(activeElement).toBe(toggle());
    });

    it("takes no focus to ☰ from the backdrop when focus was outside the drawer", () => {
        toggle().fire("click");
        tabs[1].focus();
        pressBackdrop();
        expect(panel().classes.has("open")).toBe(false);
        expect(activeElement).toBeNull();
    });

    it("opens at the top, where it puts focus, however far it was scrolled", () => {
        // Reopened after tabbing down its list, it showed its lower rows with
        // focus on the h1 far above them.
        panel().scrollTop = 900;
        toggle().fire("click");
        expect(panel().scrollTop).toBe(0);
        expect(activeElement).toBe(panel().kids[0]);
    });

    it("makes what it covers inert while it is open, and never ☰", () => {
        const behind = [els[".zone-tabs"], els[".stage-wrap"]];
        toggle().fire("click");
        expect(behind.map(el => el.inert)).toEqual([true, true]);
        pressOnDocument("Escape");
        expect(behind.map(el => el.inert)).toEqual([false, false]);
        toggle().fire("click");
        pressBackdrop();
        expect(behind.map(el => el.inert)).toEqual([false, false]);
        expect(toggle().inert).toBeUndefined();
    });

    it("tells the map when it opens and closes", () => {
        toggle().fire("click");
        pressOnDocument("Escape");
        expect(dispatched).toEqual([
            { type: "panel-toggle", detail: { open: true } },
            { type: "panel-toggle", detail: { open: false } },
        ]);
    });
});

describe("the zone tabs", () => {
    it("move and select with the arrow keys, and switch the view as they go", () => {
        const e = key("ArrowRight");
        tabs[0].fire("keydown", e);
        expect(e.defaultPrevented).toBe(true);
        expect(activeElement).toBe(tabs[1]);
        expect(tabs.map(t => t.attrs["aria-selected"])).toEqual(["false", "true", "false", "false"]);
        expect(tabs.map(t => t.tabIndex)).toEqual([-1, 0, -1, -1]);
        expect(els["#stage"].attrs["aria-labelledby"]).toBe("tab-algora");
        expect(dispatched).toEqual([{ type: "zone-switch", detail: { zone: "algora" } }]);
    });

    it("wrap with the arrows and jump with Home and End", () => {
        tabs[0].fire("keydown", key("ArrowLeft"));
        expect(activeElement).toBe(tabs[3]);
        tabs[3].fire("keydown", key("Home"));
        expect(activeElement).toBe(tabs[0]);
        tabs[0].fire("keydown", key("End"));
        expect(activeElement).toBe(tabs[3]);
        expect(dispatched.map(d => (d.detail as { zone: string }).zone)).toEqual(["bridge", "hub", "bridge"]);
    });

    it("leave other keys to the browser — Enter and Space still click", () => {
        const e = key("Enter");
        tabs[1].fire("keydown", e);
        expect(e.defaultPrevented).toBe(false);
        expect(dispatched).toEqual([]);
        tabs[2].fire("click");
        expect(tabs.map(t => t.tabIndex)).toEqual([-1, -1, 0, -1]);
        expect(dispatched).toEqual([{ type: "zone-switch", detail: { zone: "ao" } }]);
    });
});

describe("a panel rewrite", () => {
    const node = (id: string): EcosystemNode => ({
        service: { id, name: id, url: `https://${id}.moss.land`, section: "ecosystem", tier: "labs", owner: "mossland" } as RegistryService,
        health: { service: id, status: "ok" }, instrumentation: "health", kind: "service",
    });
    const feedAt = (checkedAt: number) => ({
        registryState: () => "loaded", nodes: () => [node("npc"), node("city")],
        healthFreshness: (): HealthFreshness => ({ state: "fresh", checkedAt, sweeping: false, settled: true }),
    }) as unknown as EcosystemFeed;

    it("gives keyboard focus back to the same link when the markup changed around it", () => {
        const eco = els["#ecosystem"] as PanelEl;
        updateEcosystem(feedAt(1_000));
        const city = eco.links.find(a => a.attrs.href === "https://city.moss.land")!;
        city.focus();
        // The next sweep changes the clock, which rewrites the whole panel.
        updateEcosystem(feedAt(61_000));
        expect(eco.links).not.toContain(city);
        expect(activeElement).not.toBe(city);
        expect(activeElement?.attrs.href).toBe("https://city.moss.land");
        expect(eco.links).toContain(activeElement);
    });

    it("takes no focus that was somewhere else", () => {
        updateEcosystem(feedAt(1_000));
        tabs[1].focus();
        updateEcosystem(feedAt(61_000));
        expect(activeElement).toBe(tabs[1]);
    });
});
