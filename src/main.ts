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

new Phaser.Game({
    type: Phaser.AUTO,
    parent: "stage",
    width: mobile ? window.innerWidth : 1440,
    height: mobile ? window.innerHeight : 760,
    pixelArt: true,
    backgroundColor: "#050b19",
    scene: [SpaceHubScene],
    scale: mobile
        ? { mode: Phaser.Scale.RESIZE }
        : { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
});
