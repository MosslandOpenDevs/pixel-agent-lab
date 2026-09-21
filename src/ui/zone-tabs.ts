/**
 * The Map / Algora / AO / Bridge tab bar, as the WAI-ARIA tabs pattern.
 *
 * It already said role="tab" and role="tablist", and a screen reader takes
 * that as a promise: "tab, 1 of 4", with arrow keys to move. Nothing answered
 * the arrow keys, all four tabs sat in the Tab order, and nothing said which
 * region the tabs controlled. Now the selected tab is the one Tab stop (a
 * roving tabindex), Left/Right/Home/End move between tabs and select as they
 * go — switching a view is a camera move, cheap enough to follow focus — and
 * #stage is the tabpanel, labelled by whichever tab is selected.
 *
 * Both writers of the selection come through syncZoneTabs: the tab bar itself,
 * and the scene, since clicking a streaming body on the map switches zone too.
 *
 * DOM, but Phaser-free and given only what it touches, so it can be tested
 * with stubs.
 */

type TabEl = {
    dataset: DOMStringMap;
    id: string;
    tabIndex: number;
    classList: { toggle(token: string, force?: boolean): boolean };
    setAttribute(name: string, value: string): void;
};
type Doc = {
    querySelectorAll(sel: string): ArrayLike<TabEl> & Iterable<TabEl>;
    getElementById(id: string): { setAttribute(name: string, value: string): void } | null;
};

/** The index a key moves the selection to, or null for a key tabs ignore. */
export function tabKeyTarget(key: string, index: number, count: number): number | null {
    if (count <= 0 || index < 0) return null;
    switch (key) {
        case "ArrowRight": return (index + 1) % count;
        case "ArrowLeft": return (index - 1 + count) % count;
        case "Home": return 0;
        case "End": return count - 1;
        default: return null;
    }
}

/** Marks `zone`'s tab selected — class, aria-selected, the one tabindex of 0
 *  — and labels the stage by it. */
export function syncZoneTabs(zone: string, doc: Doc = document as unknown as Doc): void {
    let selected = "";
    for (const tab of Array.from(doc.querySelectorAll(".zone-tab"))) {
        const active = tab.dataset.zone === zone;
        tab.classList.toggle("active", active);
        tab.setAttribute("aria-selected", String(active));
        tab.tabIndex = active ? 0 : -1;
        if (active) selected = tab.id;
    }
    if (selected) doc.getElementById("stage")?.setAttribute("aria-labelledby", selected);
}
