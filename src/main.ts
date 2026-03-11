import "./style.css";
import Phaser from "phaser";
import { SpaceHubScene } from "./scenes/SpaceHubScene.ts";
import { initSidebar } from "./ui/Sidebar.ts";

// setup HTML layout before Phaser takes over #stage
initSidebar();

new Phaser.Game({
    type: Phaser.AUTO,
    parent: "stage",
    width: 1440,
    height: 760,
    pixelArt: true,
    backgroundColor: "#050b19",
    scene: [SpaceHubScene],
});
