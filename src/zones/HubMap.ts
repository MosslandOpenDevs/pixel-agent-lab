import Phaser from "phaser";
import type { EcosystemNode, Instrumentation } from "../services/ecosystem-feed.ts";

/**
 * The Space Hub map: every registered Mossland service as a body in orbit.
 *
 * The whole point of this view is that **a body may only look as alive as the
 * data behind it**. The ecosystem is mostly dark — 20 of 28 services expose
 * nothing but a registry entry — and drawing 28 busy conveyor belts would be a
 * lie. So instrumentation drives the rendering:
 *
 *   listed  → hollow outline, no motion. We know it exists. Nothing more.
 *   health  → filled and pulsing, coloured by the aggregator's verdict.
 *   stream  → bright, ringed, and clickable through to its own belt zone.
 *
 * Archived services stay in orbit, ashen. Algora is already `archive` in the
 * registry, so it dims itself here with no special-casing.
 */

const RING_ORDER = ["official", "participation", "developers", "markets", "ecosystem"];
const RING_RADII: Record<string, number> = {
    official: 62,
    participation: 106,
    developers: 150,
    markets: 194,
    ecosystem: 246,
};
const RING_FALLBACK = 246;

const COLOR = {
    ok: 0x22c55e,
    degraded: 0xf59e0b,
    down: 0xef4444,
    unknown: 0x475569,
    archived: 0x8a6a55,
    ring: 0x1e293b,
    hub: 0x38bdf8,
};

type Body = {
    node: EcosystemNode;
    dot: Phaser.GameObjects.Arc;
    halo?: Phaser.GameObjects.Arc;
    label: Phaser.GameObjects.Text;
    /** Phase offset so pulses do not beat in lockstep. */
    phase: number;
    instrumentation: Instrumentation;
    archived: boolean;
};

export class HubMap {
    private scene: Phaser.Scene;
    private cx: number;
    private cy: number;

    private rings?: Phaser.GameObjects.Graphics;
    private summary?: Phaser.GameObjects.Text;
    private bodies: Body[] = [];
    private container?: Phaser.GameObjects.Container;

    /** Rebuild only when the registry actually changes, not every frame. */
    private signature = "";
    private elapsed = 0;
    private reducedMotion = false;

    constructor(scene: Phaser.Scene, cx: number, cy: number) {
        this.scene = scene;
        this.cx = cx;
        this.cy = cy;
    }

    create(): void {
        this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        this.rings = this.scene.add.graphics().setDepth(4);
        this.rings.lineStyle(1, COLOR.ring, 0.55);
        for (const section of RING_ORDER) {
            this.rings.strokeCircle(this.cx, this.cy, RING_RADII[section]);
        }

        // Central hub — the registry itself.
        this.scene.add.circle(this.cx, this.cy, 13, 0x0b1226).setStrokeStyle(1, COLOR.hub, 0.9).setDepth(6);
        this.scene.add.circle(this.cx, this.cy, 4, COLOR.hub).setDepth(7);
        this.scene.add.text(this.cx, this.cy + 22, "MOSSLAND", {
            fontFamily: "monospace", fontSize: "8px", color: "#7dd3fc",
        }).setOrigin(0.5).setDepth(7);

        this.scene.add.text(this.cx, this.cy - RING_RADII.ecosystem - 34, "ECOSYSTEM MAP", {
            fontFamily: "monospace", fontSize: "10px", color: "#94a3b8",
            backgroundColor: "#0b1226cc", padding: { x: 8, y: 3 },
        }).setOrigin(0.5).setDepth(8);

        this.summary = this.scene.add.text(this.cx, this.cy + RING_RADII.ecosystem + 26, "Loading registry…", {
            fontFamily: "monospace", fontSize: "9px", color: "#64748b",
        }).setOrigin(0.5).setDepth(8);

        this.container = this.scene.add.container(0, 0).setDepth(9);
    }

    /** Rebuilds the orbit when the registry snapshot changes. */
    setNodes(nodes: EcosystemNode[]): void {
        const signature = nodes
            .map(n => `${n.service.id}:${n.instrumentation}:${n.health?.status ?? "-"}:${n.service.lifecycle ?? "-"}`)
            .join("|");
        if (signature === this.signature) return;
        this.signature = signature;

        this.bodies.forEach(b => { b.dot.destroy(); b.halo?.destroy(); b.label.destroy(); });
        this.bodies = [];

        // Group by ring, preserving registry order within each.
        const groups = new Map<string, EcosystemNode[]>();
        for (const n of nodes) {
            const key = RING_RADII[n.service.section] ? n.service.section : "ecosystem";
            const list = groups.get(key);
            if (list) list.push(n); else groups.set(key, [n]);
        }

        for (const [section, list] of groups) {
            const radius = RING_RADII[section] ?? RING_FALLBACK;
            list.forEach((node, i) => {
                // Start each ring at 12 o'clock and space evenly.
                const angle = -Math.PI / 2 + (i / list.length) * Math.PI * 2;
                this.bodies.push(this.makeBody(node, this.cx + Math.cos(angle) * radius, this.cy + Math.sin(angle) * radius, i));
            });
        }

        const streaming = nodes.filter(n => n.instrumentation === "stream").length;
        const health = nodes.filter(n => n.instrumentation === "health").length;
        const listed = nodes.filter(n => n.instrumentation === "listed").length;
        this.summary?.setText(
            `${nodes.length} registered   ·   ${streaming} streaming   ·   ${health} health-checked   ·   ${listed} listed only`,
        );
    }

    private makeBody(node: EcosystemNode, x: number, y: number, index: number): Body {
        const { service, health, instrumentation } = node;
        const archived = service.lifecycle === "archive" || service.status === "deprecated";

        const statusColor = health
            ? (COLOR[health.status as keyof typeof COLOR] as number) ?? COLOR.unknown
            : COLOR.unknown;
        const color = archived ? COLOR.archived : statusColor;

        let dot: Phaser.GameObjects.Arc;
        let halo: Phaser.GameObjects.Arc | undefined;

        if (instrumentation === "listed") {
            // Hollow: we have no observation to report, and a filled dot would
            // imply one.
            dot = this.scene.add.circle(x, y, 3.5).setStrokeStyle(1, color, 0.85);
        } else {
            dot = this.scene.add.circle(x, y, instrumentation === "stream" ? 5 : 4, color);
            if (instrumentation === "stream") {
                halo = this.scene.add.circle(x, y, 9).setStrokeStyle(1, color, 0.55);
            }
        }
        dot.setDepth(10).setAlpha(archived ? 0.45 : 1);
        halo?.setDepth(9);

        const label = this.scene.add.text(x, y + 9, service.name, {
            fontFamily: "monospace",
            fontSize: instrumentation === "stream" ? "8px" : "7px",
            color: archived ? "#8a6a55" : instrumentation === "listed" ? "#64748b" : "#cbd5e1",
        }).setOrigin(0.5, 0).setDepth(10);

        if (archived) label.setAlpha(0.75);

        return { node, dot, halo, label, phase: index * 0.7, instrumentation, archived };
    }

    update(dt: number): void {
        if (this.reducedMotion || this.bodies.length === 0) return;
        this.elapsed += dt;
        const t = this.elapsed / 1000;

        for (const b of this.bodies) {
            // Only bodies we can actually observe are allowed to move. A listed
            // service sitting perfectly still is the honest rendering.
            if (b.instrumentation === "listed" || b.archived) continue;
            const pulse = 0.72 + 0.28 * Math.sin(t * 1.8 + b.phase);
            b.dot.setAlpha(pulse);
            if (b.halo) b.halo.setScale(0.9 + 0.16 * Math.sin(t * 1.8 + b.phase));
        }
    }

    destroy(): void {
        this.bodies.forEach(b => { b.dot.destroy(); b.halo?.destroy(); b.label.destroy(); });
        this.bodies = [];
        this.rings?.destroy();
        this.summary?.destroy();
        this.container?.destroy();
    }
}
