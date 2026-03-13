import "./style.css";
import Phaser from "phaser";
import { SpaceHubScene } from "./scenes/SpaceHubScene.ts";
import { initSidebar } from "./ui/Sidebar.ts";

initSidebar();

const mobile = window.innerWidth < 768;

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
