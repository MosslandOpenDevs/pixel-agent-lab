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
 * the step callback returns, with no try/finally around it
 * (dom/RequestAnimationFrame.js). So a single throw inside any frame does not
 * just skip that frame — it ends the loop permanently: animation stops, camera
 * pans never complete, and the page sits frozen on its last painted frame while
 * still looking alive. Nothing revives it either; start() and wake() both
 * early-return while `isRunning` is still true, and the visibility handlers only
 * touch timestamps.
 *
 * The wrapper works because the step closure re-reads `callback` every frame, so
 * replacing it is enough. The timing is the subtle part: Phaser emits READY and
 * only *then* calls start(), which assigns the real callback — so installing on
 * READY wraps the constructor's NOOP and is overwritten moments later. (That is
 * exactly the bug this replaces: a guard that looked installed and never ran.)
 *
 * Patching `start` instead has no timing dependency: whatever callback Phaser
 * eventually installs gets wrapped on its way in.
 */
{
    const raf = (game.loop as unknown as {
        raf?: { start?: (cb: (t: number) => void, force: boolean, target: number) => void };
    }).raf;

    if (raf && typeof raf.start === "function") {
        const originalStart = raf.start.bind(raf);
        let reported = false;
        raf.start = (cb, force, target) =>
            originalStart(
                (time: number) => {
                    try {
                        cb(time);
                    } catch (err) {
                        if (!reported) {
                            reported = true;   // one report, not one per frame
                            console.error("[loop] a frame threw; continuing", err);
                        }
                    }
                },
                force,
                target,
            );
    }
}
