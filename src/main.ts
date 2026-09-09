import "./style.css";
import Phaser from "phaser";
import { SpaceHubScene } from "./scenes/SpaceHubScene.ts";
import { initSidebar } from "./ui/Sidebar.ts";

initSidebar();

const mobile = window.innerWidth < 768;

// The game is configured for mobile vs desktop at load (scale mode + canvas
// size). Crossing the 768px breakpoint (rotate / window resize) needs the
// opposite configuration, so the cleanest correct response is a fresh boot.
window.matchMedia("(max-width: 767px)").addEventListener("change", () => {
    window.location.reload();
});

const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: "stage",
    width: mobile ? window.innerWidth : 1440,
    height: mobile ? window.innerHeight : 760,
    pixelArt: true,
    backgroundColor: "#050b19",
    scene: [SpaceHubScene],
    // This app draws no filtered effects, and leaving these on makes Phaser
    // preallocate a large bank of render targets at boot for features nothing
    // uses — pure GPU memory, and more zero-sized targets to get wrong while the
    // parent is still being laid out.
    disablePreFX: true,
    disablePostFX: true,
    scale: mobile
        ? { mode: Phaser.Scale.RESIZE }
        : { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
});

/**
 * Keep one bad frame from killing the page.
 *
 * Phaser drives its loop from a requestAnimationFrame chain that re-arms *after*
 * the step callback returns, with no try/finally around it. So a single throw
 * inside any frame — a WebGL hiccup, a bug in one zone — does not just skip that
 * frame, it ends the loop permanently: animation stops, camera pans never
 * complete, and the page sits frozen on its last painted frame while still
 * looking alive. That failure is invisible and unrecoverable without a reload.
 *
 * Wrapping the callback costs nothing and turns it into a logged, survivable
 * glitch. Guarded because it reaches into Phaser's internals.
 */
game.events.once(Phaser.Core.Events.READY, () => {
    const raf = (game.loop as unknown as { raf?: { callback?: (t: number) => void } }).raf;
    if (!raf || typeof raf.callback !== "function") return;
    const step = raf.callback;
    let reported = false;
    raf.callback = function (this: unknown, time: number) {
        try {
            step.call(this, time);
        } catch (err) {
            if (!reported) {
                reported = true;   // one report, not one per frame
                console.error("[loop] a frame threw; continuing", err);
            }
        }
    };
});
