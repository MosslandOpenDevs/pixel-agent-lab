/**
 * Whether the viewer has asked for less motion, kept current.
 *
 * Each reader used to call matchMedia for itself, at different times: the
 * camera on every tab switch, the map once at create(), and the belt zones
 * never. So the belts moved for everyone, and turning the OS setting on while
 * the page was open stopped the tab-switch pans but left the galaxy turning
 * until a reload. Everything now asks here, on every frame if it likes.
 *
 * The value is read from the query once and then taken from its `change`
 * events — never by reading `matches` again. Chromium updates the list's
 * cached state whenever `matches` is read, and compares against that cache
 * when it decides whether to fire `change`: read every frame, as the belts
 * do, the read landed between the setting changing and the event being
 * dispatched, and the event never came. Only the subscribers noticed, since
 * the reads themselves were right — the map kept turning.
 *
 * What needs to hear about a change subscribes: the map has motion in flight
 * (motes, the sweep) that must be cleared when the setting turns on, rather
 * than frozen where it happened to be.
 *
 * DOM-free where there is no DOM: without matchMedia (the test runner) motion
 * is simply not reduced.
 */

const QUERY = "(prefers-reduced-motion: reduce)";

type Listener = (reduced: boolean) => void;

/** undefined until first asked; null where matchMedia does not exist. */
let mq: MediaQueryList | null | undefined;
let reduced = false;
const listeners = new Set<Listener>();

function query(): MediaQueryList | null {
    if (mq !== undefined) return mq;
    mq = typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia(QUERY) : null;
    if (mq) {
        reduced = mq.matches;
        mq.addEventListener("change", (e: MediaQueryListEvent) => {
            reduced = e.matches;
            listeners.forEach(fn => fn(reduced));
        });
    }
    return mq;
}

/** True while the viewer prefers reduced motion. Cheap: read it every frame. */
export function reducedMotion(): boolean {
    query();
    return reduced;
}

/** Calls `fn` whenever the preference changes; returns the unsubscribe. */
export function onReducedMotionChange(fn: Listener): () => void {
    query();
    listeners.add(fn);
    return () => { listeners.delete(fn); };
}

/** Forgets the query and every listener, so each test starts from nothing. */
export function resetMotionForTests(): void {
    mq = undefined;
    reduced = false;
    listeners.clear();
}
