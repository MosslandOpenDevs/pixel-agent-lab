import Phaser from "phaser";
import type { DataBridge } from "../services/data-bridge.ts";

const ARC_Y = 440;

type TrustParticle = {
    sprite: Phaser.GameObjects.Image;
    t: number; // 0-1 progress along curve
};

export class FeedbackArc {
    private scene: Phaser.Scene;
    private g!: Phaser.GameObjects.Graphics;
    private particles: TrustParticle[] = [];
    private spawnTimer = 0;
    private curvePoints: Phaser.Math.Vector2[] = [];

    // trust gauges
    private trustLabels: Phaser.GameObjects.Text[] = [];
    private outcomeLog?: Phaser.GameObjects.Text;

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
    }

    create(): void {
        this.g = this.scene.add.graphics().setDepth(4);

        // precompute bezier curve points: Bridge(960,420) -> bottom(700,650) -> Algora(100,200)
        const curve = new Phaser.Curves.CubicBezier(
            new Phaser.Math.Vector2(960, 420),
            new Phaser.Math.Vector2(960, 680),
            new Phaser.Math.Vector2(100, 680),
            new Phaser.Math.Vector2(100, 250),
        );
        this.curvePoints = curve.getPoints(80);

        // trust score panel
        this.scene.add.text(970, ARC_Y + 8, "FEEDBACK LOOP — Trust & Outcomes", {
            fontFamily: "monospace", fontSize: "11px", color: "#2dd4bf",
            backgroundColor: "#0b1226ee", padding: { x: 6, y: 3 },
        }).setDepth(10);

        const gaugeNames = ["Agent Trust", "Proposer Trust", "Success Rate"];
        const gaugeColors = ["#22c55e", "#3b82f6", "#a855f7"];
        gaugeNames.forEach((name, i) => {
            const x = 990 + i * 150;
            const label = this.scene.add.text(x, ARC_Y + 50, `${name}\n--`, {
                fontFamily: "monospace", fontSize: "9px", color: gaugeColors[i],
                backgroundColor: "#0a162866", padding: { x: 6, y: 4 },
                align: "center",
            }).setDepth(12);
            this.trustLabels.push(label);
        });

        // outcome log
        this.outcomeLog = this.scene.add.text(970, ARC_Y + 100, "Outcomes: waiting for data...", {
            fontFamily: "monospace", fontSize: "8px", color: "#94a3b8",
            backgroundColor: "#0a162866", padding: { x: 6, y: 3 },
            wordWrap: { width: 450 },
        }).setDepth(12);

        // feedback label on arc
        this.scene.add.text(500, 670, "← Outcomes feed back to Algora signals", {
            fontFamily: "monospace", fontSize: "8px", color: "#2dd4bf44",
        }).setDepth(10);
    }

    update(dt: number, dataBridge: DataBridge): void {
        this.spawnTimer += dt;

        // spawn trust token particles along feedback arc
        if (this.spawnTimer > 3000 && this.particles.length < 5) {
            const sprite = this.scene.add.image(960, 420, "trust-token")
                .setDepth(16).setDisplaySize(12, 12);
            this.particles.push({ sprite, t: 0 });
            this.spawnTimer = 0;
        }

        // move particles along curve
        for (const p of this.particles) {
            p.t += dt * 0.0002;
            if (p.t >= 1) {
                p.sprite.destroy();
                continue;
            }
            const idx = Math.min(Math.floor(p.t * this.curvePoints.length), this.curvePoints.length - 1);
            const pt = this.curvePoints[idx];
            p.sprite.setPosition(pt.x, pt.y);
            p.sprite.setAlpha(1 - p.t * 0.5);
        }
        this.particles = this.particles.filter(p => p.t < 1);

        // update trust data
        const trust = dataBridge.trustCache;
        if (trust.length > 0) {
            const avgScore = trust.reduce((sum, t) => sum + t.score, 0) / trust.length;
            this.trustLabels[0]?.setText(`Agent Trust\n${avgScore.toFixed(1)}`);
        }

        const bs = dataBridge.liveStats.bridge;
        if (bs) {
            this.trustLabels[1]?.setText(`Proposals\n${bs.proposals.total}`);
            this.trustLabels[2]?.setText(`Success Rate\n${bs.outcomes.successRate}%`);
        }

        // update outcome log
        const outcomes = dataBridge.outcomeCache;
        if (outcomes.length > 0) {
            const logText = outcomes.slice(0, 3).map(o =>
                `[${o.success ? "OK" : "FAIL"}] ${o.id.slice(0, 8)}... ${o.status}`
            ).join("\n");
            this.outcomeLog?.setText(`Recent Outcomes:\n${logText}`);
        } else {
            const issueCount = dataBridge.liveStats.bridge?.issues.total ?? 0;
            this.outcomeLog?.setText(`Signals: ${dataBridge.liveStats.bridge?.signals.total.toLocaleString() ?? "?"} | Issues: ${issueCount} | Awaiting proposals...`);
        }

        this.drawGraphics();
    }

    private drawGraphics(): void {
        this.g.clear();

        // feedback strip background
        this.g.fillStyle(0x0a1628, 0.5);
        this.g.fillRoundedRect(960, ARC_Y, 470, 180, 10);
        this.g.lineStyle(1, 0x2dd4bf, 0.25);
        this.g.strokeRoundedRect(960, ARC_Y, 470, 180, 10);

        // draw bezier arc
        this.g.lineStyle(1, 0x2dd4bf, 0.15);
        for (let i = 1; i < this.curvePoints.length; i++) {
            const a = this.curvePoints[i - 1];
            const b = this.curvePoints[i];
            // dashed effect
            if (i % 3 !== 0) {
                this.g.lineBetween(a.x, a.y, b.x, b.y);
            }
        }

        // trust gauge circles
        const gaugeColors = [0x22c55e, 0x3b82f6, 0xa855f7];
        gaugeColors.forEach((color, i) => {
            const x = 1020 + i * 150;
            const y = ARC_Y + 52;
            this.g.lineStyle(2, color, 0.3);
            this.g.strokeCircle(x - 22, y + 8, 14);
        });
    }
}
