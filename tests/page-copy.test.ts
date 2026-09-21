import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * What the page says about itself before anyone has opened it: the search and
 * link-preview text in index.html, the install description in the manifest,
 * and the words on the preview image.
 *
 * Previews show public/og-image.png, and no test reads it: what is checked is
 * its source, public/og-image.svg. After changing that text, re-render the PNG
 * from the repository root at 1200x630, e.g.
 *
 *     "<Chrome>" --headless=new --hide-scrollbars --window-size=1200,630 \
 *         --screenshot=public/og-image.png public/og-image.svg
 *
 * (Chrome may not exit on its own once the file is written), and look at the
 * result before committing. A render is not byte-for-byte reproducible, so
 * nothing here can tell a stale PNG from a fresh one.
 *
 * These are the most-read words the monitor has, and the one place nothing
 * at runtime keeps honest. They called the belts "real-time" for months after
 * the README and the in-app About text said the data is polled and the belts
 * only illustrate workflows. The rule is the map's own: say no more than is
 * measured. Reads that repeat every 15 s to 10 min are not a stream, and a
 * Bridge proposal drawn on a timer is not a live one.
 */

const read = (rel: string): string =>
    readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");

/** Claims the data behind the page does not back. */
const OVERCLAIM = /real[\s-]?time|\bstream/i;

/** A <meta> tag's content, by its name or property; the tags span lines. */
function meta(html: string, key: string): string {
    const m = new RegExp(`<meta\\s+(?:name|property)="${key}"\\s+content="([^"]*)"`).exec(html);
    expect(m, `index.html has no ${key}`).not.toBeNull();
    return m![1];
}

describe("the page's own copy", () => {
    const html = read("index.html");

    it.each(["description", "og:description", "twitter:description", "og:image:alt"])(
        "index.html %s claims no real-time stream", key => {
            const text = meta(html, key);
            expect(text.length).toBeGreaterThan(0);
            expect(text).not.toMatch(OVERCLAIM);
        });

    it("the manifest's description claims none either", () => {
        const { description } = JSON.parse(read("public/manifest.webmanifest")) as { description: string };
        expect(description.length).toBeGreaterThan(0);
        expect(description).not.toMatch(OVERCLAIM);
    });

    it("nor does the preview image's source, og-image.svg", () => {
        const words = [...read("public/og-image.svg").matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map(m => m[1]);
        expect(words.length).toBeGreaterThan(0);
        for (const w of words) expect(w).not.toMatch(OVERCLAIM);
    });
});
