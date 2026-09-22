/**
 * Tap to inspect, tap again to open: what a touch on the map's bodies does.
 *
 * A touch has no hover. Phaser runs a tap as over → up → out inside one
 * gesture (TOUCH_START fires over, TOUCH_END fires up and then out), so with
 * the mouse's handlers a tap showed the tooltip, opened the body — a new tab
 * for most of them — and hid the tooltip again, all at once. The tooltip is
 * the only place the map says what a body reports and how old that is, so a
 * phone could never read it, and every exploratory tap left the monitor.
 *
 * On a touch the first tap selects a body and shows its tooltip; a second tap
 * on the same body opens it; a tap on another body moves the selection; a tap
 * on empty space clears it. The mouse is untouched: hover shows, click opens.
 *
 * Kept by id, not by body: a registry rebuild replaces every body, and the
 * selection should survive one when its service is still there.
 *
 * Phaser-free so that it can be tested; HubMap wires it to the pointer events.
 */
export class TouchSelection {
    private id: string | null = null;

    /** The selected body's id, or null. */
    get selected(): string | null {
        return this.id;
    }

    /**
     * A touch released over a body. "select" when this tap picked it (show
     * its tooltip), "activate" when it was already selected (open it — and the
     * selection ends, since whatever it opens replaces what the tooltip said).
     */
    tapBody(id: string): "select" | "activate" {
        if (this.id === id) {
            this.id = null;
            return "activate";
        }
        this.id = id;
        return "select";
    }

    /** A touch released over nothing. True when that cleared a selection. */
    tapEmpty(): boolean {
        return this.clear();
    }

    /** Drops the selection: the map was hidden or destroyed, or a mouse took
     *  over. True when there was one. */
    clear(): boolean {
        const had = this.id !== null;
        this.id = null;
        return had;
    }

    /** After a rebuild: keeps the selection only while its body still exists.
     *  True when a selection survives. */
    retain(exists: (id: string) => boolean): boolean {
        if (this.id !== null && !exists(this.id)) this.id = null;
        return this.id !== null;
    }
}
