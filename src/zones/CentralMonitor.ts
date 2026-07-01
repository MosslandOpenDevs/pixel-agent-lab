import Phaser from "phaser";
import type { DataBridge } from "../services/data-bridge.ts";

const STRIP_X = 10;
const STRIP_Y = 438;
const STRIP_W = 1420;
const STRIP_H = 42;

export class CentralMonitor {
    private scene: Phaser.Scene;
    private g!: Phaser.GameObjects.Graphics;
    private statusText?: Phaser.GameObjects.Text;

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
    }

    create(): void {
        this.g = this.scene.add.graphics().setDepth(5);

        // title
        this.scene.add.text(STRIP_X + 14, STRIP_Y + 12, "MOSSLAND HUB  \u00b7  DataBridge", {
            fontFamily: "monospace", fontSize: "10px", color: "#2dd4bf",
            backgroundColor: "#0b1226ee", padding: { x: 6, y: 3 },
        }).setDepth(10);

        // independent service indicators
        const services = [
            { name: "Algora :3201", color: "#34d399", x: STRIP_X + 380 },
            { name: "AO :3001", color: "#f59e0b", x: STRIP_X + 580 },
            { name: "Bridge :3101", color: "#60a5fa", x: STRIP_X + 760 },
        ];

        services.forEach(svc => {
            this.scene.add.text(svc.x, STRIP_Y + 12, `\u25cf ${svc.name}`, {
                fontFamily: "monospace", fontSize: "10px", color: svc.color,
                backgroundColor: "#0a162866", padding: { x: 6, y: 3 },
            }).setDepth(12);
        });

        // aggregation note
        this.scene.add.text(STRIP_X + 960, STRIP_Y + 14, "Aggregating 3 independent services", {
            fontFamily: "monospace", fontSize: "8px", color: "#2dd4bf44",
        }).setDepth(10);

        // right side: queue/status
        this.statusText = this.scene.add.text(STRIP_X + STRIP_W - 10, STRIP_Y + 12, "Connecting...", {
            fontFamily: "monospace", fontSize: "10px", color: "#94a3b8",
            backgroundColor: "#0a162866", padding: { x: 6, y: 3 },
        }).setOrigin(1, 0).setDepth(12);
    }

    update(_dt: number, dataBridge: DataBridge): void {
        const queueSize = dataBridge.queueSize();
        const connected = dataBridge.isConnected();
        const label = connected ? "LIVE" : "OFFLINE";
        this.statusText?.setText(`${label} | Queue: ${queueSize} | Polling: 15s`);

        this.drawGraphics();
    }

    private drawGraphics(): void {
        this.g.clear();
        this.g.fillStyle(0x0a1628, 0.7);
        this.g.fillRoundedRect(STRIP_X, STRIP_Y, STRIP_W, STRIP_H, 6);
        this.g.lineStyle(1, 0x2dd4bf, 0.3);
        this.g.strokeRoundedRect(STRIP_X, STRIP_Y, STRIP_W, STRIP_H, 6);
    }
}
