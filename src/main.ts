import "./style.css";
import Phaser from "phaser";

type Priority = "P1" | "P2" | "P3";
type Route = "Immediate Action" | "Monitor" | "Defer";
type Phase = "algora" | "ao" | "bridge" | "done";
type BoxStatus = "inbound" | "on-belt" | "debating" | "rerouting" | "loading" | "loaded";

type Box = {
    id: string;
    source: string;
    category: string;
    risk: "high" | "medium" | "low";
    priority: Priority;
    route: Route;
    phase: Phase;
    status: BoxStatus;
    algoraStep: "new" | "at-filter" | "approved" | "loading" | "rejected";
    x: number;
    y: number;
    beltY: number;
    sprite: Phaser.GameObjects.Image;
    tag: Phaser.GameObjects.Text;
    badge: Phaser.GameObjects.Text;
};

const W = 1440;
const H = 760;
const BELT_LEFT = 220;
const BELT_RIGHT = 1080;
const LANE_Y: Record<Priority, number> = { P1: 270, P2: 420, P3: 570 };
const ROUTE_Y: Record<Route, number> = { "Immediate Action": 260, Monitor: 420, Defer: 580 };

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
<div class="layout">
  <aside class="panel">
    <h1>Mossland Space Hub</h1>
    <p class="sub">우주 물류 센터 · Algora → AO → Bridge</p>
    <div class="mini">
      <label>속도 <input id="speed" type="range" min="0.7" max="1.8" step="0.1" value="1" /></label>
      <label>박스 수 <input id="maxBoxes" type="range" min="4" max="10" value="8" /></label>
    </div>
    <div id="stats" class="stats"></div>
    <div id="serviceStatus" class="stats"></div>
    <div id="detail" class="detail"><h2>상세 정보</h2><p>박스를 클릭하면 상세 정보가 표시됩니다.</p></div>
  </aside>
  <main class="stage-wrap">
    <div id="stage">
      <div id="hud" class="hud" aria-hidden="true">
        <div class="hud-label lane p1" style="left:92px; top:261px;">P1 URGENT</div>
        <div class="hud-label lane p2" style="left:92px; top:411px;">P2 NORMAL</div>
        <div class="hud-label lane p3" style="left:92px; top:561px;">P3 LOW</div>

        <div class="hud-label zone algora" style="left:112px; top:88px;">ALGORA · Inbound Tagging</div>
        <div class="hud-label zone ao" style="left:620px; top:88px;">AO · Routing Discussion</div>
        <div class="hud-label zone bridge" style="left:1160px; top:88px;">BRIDGE · Dispatch Bay</div>

        <div class="hud-label route" style="left:1070px; top:262px;">Immediate Action</div>
        <div class="hud-label route" style="left:1070px; top:413px;">Monitor</div>
        <div class="hud-label route" style="left:1070px; top:561px;">Defer</div>

        <div class="hud-label truck" style="left:1238px; top:205px;">Express</div>
        <div class="hud-label truck" style="left:1238px; top:355px;">Monitor</div>
        <div class="hud-label truck" style="left:1238px; top:505px;">Defer</div>
        <div class="hud-label loaded" id="loadedHud" style="left:1226px; top:660px;">Loaded: 0</div>
      </div>
    </div>
    <div id="titleBar" class="titleBar">🚚 Mossland Space Hub</div>
  </main>
</div>
`;

const statsEl = document.querySelector<HTMLDivElement>("#stats")!;
const detailEl = document.querySelector<HTMLDivElement>("#detail")!;
const loadedHudEl = document.querySelector<HTMLDivElement>("#loadedHud")!;
const serviceStatusEl = document.querySelector<HTMLDivElement>("#serviceStatus")!;

class SpaceHubScene extends Phaser.Scene {
    boxes: Box[] = [];
    nextId = 1;
    lastSpawn = 0;
    beltOffset = 0;
    loaded = 0;

    // service-level demo telemetry
    totalSignals = 0;
    taggedIssues = 0;
    debatesRun = 0;
    plansCreated = 0;
    delegatedToBridge = 0;
    verifiedOutcomes = 0;

    beltG!: Phaser.GameObjects.Graphics;
    truckG!: Phaser.GameObjects.Graphics;

    algoraAgents: Phaser.GameObjects.Sprite[] = [];
    aoAgents: Phaser.GameObjects.Sprite[] = [];
    bridgeAgents: Phaser.GameObjects.Sprite[] = [];

    algoraAgentBadges: Phaser.GameObjects.Text[] = [];
    aoAgentBadges: Phaser.GameObjects.Text[] = [];
    bridgeAgentBadges: Phaser.GameObjects.Text[] = [];

    activeAlgoraScan?: Phaser.GameObjects.Sprite;
    activeAlgoraFilter?: Phaser.GameObjects.Sprite;
    activeAlgoraLoad?: Phaser.GameObjects.Sprite;
    activeAOCarrier?: Phaser.GameObjects.Sprite;
    activeBridgeCarrier?: Phaser.GameObjects.Sprite;

    aoDebateCard?: Phaser.GameObjects.Text;
    selectedBoxId?: string;

    roleFxG!: Phaser.GameObjects.Graphics;
    aoPlanChip?: Phaser.GameObjects.Text;
    aoRouteFlash?: { route: Route; until: number };
    bridgeVerifyPing?: { x: number; y: number; until: number };

    busyAlgoraScan = false;
    busyAlgoraFilter = false;
    busyAlgoraLoad = false;
    busyAO = false;
    busyBridge = false;

    cargoSlots: Record<Route, Phaser.Math.Vector2[]> = {
        "Immediate Action": [],
        Monitor: [],
        Defer: [],
    };
    loadIndex: Record<Route, number> = {
        "Immediate Action": 0,
        Monitor: 0,
        Defer: 0,
    };

    create() {
        this.makeTextures();
        this.drawBackground();

        this.beltG = this.add.graphics().setDepth(10);
        this.truckG = this.add.graphics().setDepth(30);
        this.roleFxG = this.add.graphics().setDepth(88);

        this.drawBelts();
        this.spawnAgents();
        this.buildTrucks();

        this.input.on("gameobjectdown", (_: any, go: any) => {
            const box = this.boxes.find((b) => b.sprite === go);
            if (box) {
                this.selectedBoxId = box.id;
                this.showDetail(box);
            }
        });

        this.time.addEvent({ delay: 500, loop: true, callback: () => this.animateAgents() });
    }

    update(_: number, dt: number) {
        const speed = Number((document.querySelector("#speed") as HTMLInputElement).value);
        const maxBoxes = Number((document.querySelector("#maxBoxes") as HTMLInputElement).value);

        this.beltOffset += dt * 0.07 * speed;
        this.drawBelts();

        if (
            this.time.now - this.lastSpawn > 1700 &&
            this.boxes.filter((b) => b.phase !== "done").length < maxBoxes
        ) {
            this.spawnInboundBox();
            this.lastSpawn = this.time.now;
        }

        this.tryAlgoraScan();
        this.tryAlgoraFilter();
        this.tryAlgoraLoad();
        this.tryAODebateAndCarry();
        this.tryBridgeLoad();

        for (const b of this.boxes) {
            if (b.status === "on-belt") {
                b.x += 0.52 * speed;
                if (b.phase === "algora" && b.x >= 650) {
                    b.phase = "ao";
                    b.status = "debating";
                }
                if (b.phase === "ao" && b.x >= 980) {
                    b.phase = "bridge";
                    b.status = "loading";
                    this.delegatedToBridge += 1;
                }
            }

            b.sprite.setPosition(b.x, b.y);
            if (b.phase !== "done") {
                b.tag.setPosition(b.x, this.getTagY(b));
                b.badge.setPosition(b.x, this.getTagY(b) - 14);
                b.badge.setText(this.getBoxBadgeText(b));
            }
        }

        this.updateAgentBadges();
        this.drawRoleEffects();
        this.updateSelectedDetail();
        this.drawStats();
    }

    makeTextures() {
        this.textures.generate("star", {
            pixelWidth: 2,
            data: ["..a..", ".aaa.", "aaaaa", ".aaa.", "..a.."],
            palette: { a: "#ffffff", ".": "#00000000" } as any,
        });

        // square parcel + tape detail
        this.textures.generate("parcel", {
            pixelWidth: 2,
            data: [
                "....................",
                "..aaaaaaaaaaaaaaaa..",
                "..abbbbbbbbbbbbbba..",
                "..abccccccddccccba..",
                "..abccccccddccccba..",
                "..abccccccddccccba..",
                "..abccccccddccccba..",
                "..abccccccddccccba..",
                "..abccccccddccccba..",
                "..abccccccddccccba..",
                "..abccccccddccccba..",
                "..abeeeeeeeeeeeeba..",
                "..abbbbbbbbbbbbbba..",
                "..aaaaaaaaaaaaaaaa..",
                "....................",
            ],
            palette: {
                a: "#6b4f2f",
                b: "#b78955",
                c: "#d4a86f",
                d: "#f3df9c",
                e: "#e9c68d",
                ".": "#00000000",
            } as any,
        });

        const makeBot = (key: string, accent: string) => {
            this.textures.generate(`${key}-0`, {
                pixelWidth: 2,
                data: [
                    "...wwww...",
                    "..wvvvvw..",
                    "..wvvvvw..",
                    ".wwwwwwww.",
                    ".wwwaawww.",
                    ".wwwwwwww.",
                    "..dd..dd..",
                    "...dddd...",
                ],
                palette: {
                    w: "#e5e7eb",
                    v: "#0f172a",
                    a: accent,
                    d: "#9ca3af",
                    ".": "#00000000",
                } as any,
            });
            this.textures.generate(`${key}-1`, {
                pixelWidth: 2,
                data: [
                    "...wwww...",
                    "..wvvvvw..",
                    "..wvvvvw..",
                    ".wwwwwwww.",
                    ".wwwaawww.",
                    ".wwwwwwww.",
                    "...dddd...",
                    "..dd..dd..",
                ],
                palette: {
                    w: "#e5e7eb",
                    v: "#0f172a",
                    a: accent,
                    d: "#9ca3af",
                    ".": "#00000000",
                } as any,
            });
        };

        makeBot("algora-bot", "#34d399");
        makeBot("ao-bot", "#f59e0b");
        makeBot("bridge-bot", "#60a5fa");
    }

    drawBackground() {
        this.add.rectangle(W / 2, H / 2, W, H, 0x060b1b);
        for (let i = 0; i < 120; i++) {
            const s = this.add
                .image(Phaser.Math.Between(0, W), Phaser.Math.Between(0, H), "star")
                .setDepth(2);
            s.setScale(Phaser.Math.FloatBetween(0.2, 0.6));
            s.setAlpha(Phaser.Math.FloatBetween(0.2, 0.9));
        }

        const zoneGap = 18;
        const wA = 430;
        const wB = 430;
        const wC = 430;
        const total = wA + wB + wC + zoneGap * 2;
        const left = (W - total) / 2;

        const zones = [
            { x: left + wA / 2, w: wA, fill: 0x0f2d2a, stroke: 0x34d399 },
            { x: left + wA + zoneGap + wB / 2, w: wB, fill: 0x3f2a12, stroke: 0xf59e0b },
            { x: left + wA + zoneGap + wB + zoneGap + wC / 2, w: wC, fill: 0x10263f, stroke: 0x60a5fa },
        ];

        zones.forEach((z) => {
            const panel = this.add.rectangle(z.x, H / 2, z.w, H - 80, z.fill, 0.16).setDepth(3);
            panel.setStrokeStyle(2, z.stroke, 0.42);

            // inner frame for richer zone detail
            const inner = this.add.rectangle(z.x, H / 2, z.w - 18, H - 98, 0x000000, 0).setDepth(3);
            inner.setStrokeStyle(1, z.stroke, 0.24);

            // corner beacons
            const halfW = z.w / 2;
            const top = 42;
            const bottom = H - 42;
            const left = z.x - halfW + 10;
            const right = z.x + halfW - 10;
            [
                [left, top],
                [right, top],
                [left, bottom],
                [right, bottom],
            ].forEach(([cx, cy]) => {
                this.add.circle(cx, cy, 2.6, z.stroke, 0.85).setDepth(4);
                this.add.circle(cx, cy, 6.5, z.stroke, 0.16).setDepth(3);
            });
        });
    }

    drawBelts() {
        this.beltG.clear();

        const lanes: [Priority, number][] = [
            ["P1", LANE_Y.P1],
            ["P2", LANE_Y.P2],
            ["P3", LANE_Y.P3],
        ];
        for (const [p, y] of lanes) {
            const tone = p === "P1" ? 0x4b1a1a : p === "P2" ? 0x1e293b : 0x131925;
            this.beltG.fillStyle(tone, 0.92);
            this.beltG.fillRoundedRect(BELT_LEFT, y - 32, BELT_RIGHT - BELT_LEFT, 64, 12);
            this.beltG.lineStyle(4, 0x475569, 0.74);
            this.beltG.strokeRoundedRect(BELT_LEFT, y - 32, BELT_RIGHT - BELT_LEFT, 64, 12);

            // conveyor side wheels (tire-like)
            for (let x = BELT_LEFT + 10; x < BELT_RIGHT - 10; x += 30) {
                this.beltG.fillStyle(0x64748b, 0.58);
                this.beltG.fillCircle(x, y - 22, 5);
                this.beltG.fillCircle(x, y + 22, 5);
                this.beltG.fillStyle(0x1f2937, 0.9);
                this.beltG.fillCircle(x, y - 22, 2);
                this.beltG.fillCircle(x, y + 22, 2);
            }

            // center treads (no clipped/stuck segment at the left edge)
            const phase = this.beltOffset % 50;
            for (let x = BELT_LEFT + phase; x < BELT_RIGHT - 20; x += 50) {
                this.beltG.fillStyle(0xe2e8f0, 0.2);
                this.beltG.fillRect(x, y - 7, 20, 14);
            }
        }
    }

    spawnAgents() {
        const m = (key: string, x: number, y: number) =>
            this.add.sprite(x, y, `${key}-0`).setDepth(40).setDisplaySize(44, 44);
        const badge = (x: number, y: number, text: string, color = "#e2e8f0") =>
            this.add
                .text(x, y, text, {
                    fontFamily: "monospace",
                    fontSize: "10px",
                    color,
                    backgroundColor: "#0b1226f0",
                    padding: { x: 5, y: 2 },
                })
                .setOrigin(0.5)
                .setDepth(95)
                .setShadow(0, 1, "#000000", 2);

        this.algoraAgents = [m("algora-bot", 104, 170), m("algora-bot", 188, 170), m("algora-bot", 272, 170)];
        this.aoAgents = [m("ao-bot", 670, 168), m("ao-bot", 760, 168), m("ao-bot", 850, 168)];
        this.bridgeAgents = [m("bridge-bot", 1160, 168), m("bridge-bot", 1240, 168)];

        this.algoraAgentBadges = [
            badge(104, 142, "SCAN", "#86efac"),
            badge(188, 142, "FILTER", "#86efac"),
            badge(272, 142, "LOAD", "#86efac"),
        ];
        this.aoAgentBadges = [badge(670, 140, "DEBATE", "#fcd34d"), badge(760, 140, "PLAN", "#fcd34d"), badge(850, 140, "ROUTE", "#fcd34d")];
        this.bridgeAgentBadges = [badge(1160, 140, "EXECUTE", "#93c5fd"), badge(1240, 140, "VERIFY", "#93c5fd")];
    }

    buildTrucks() {
        this.truckG.clear();

        const trucks: Array<{ route: Route; y: number; label: string }> = [
            { route: "Immediate Action", y: LANE_Y.P1, label: "Express" },
            { route: "Monitor", y: LANE_Y.P2, label: "Monitor" },
            { route: "Defer", y: LANE_Y.P3, label: "Defer" },
        ];

        for (const t of trucks) {
            // cargo bed shell
            this.truckG.fillStyle(0x131925, 0.98);
            this.truckG.fillRoundedRect(1196, t.y - 46, 154, 78, 10);
            this.truckG.lineStyle(2, 0x60a5fa, 0.95);
            this.truckG.strokeRoundedRect(1196, t.y - 46, 154, 78, 10);

            // cab
            this.truckG.fillStyle(0x243244, 1);
            this.truckG.fillRoundedRect(1352, t.y - 32, 30, 60, 6);
            this.truckG.fillStyle(0x93c5fd, 0.8);
            this.truckG.fillRect(1357, t.y - 22, 18, 13);

            // bumper + light
            this.truckG.fillStyle(0x0f172a, 1);
            this.truckG.fillRect(1188, t.y + 12, 10, 8);
            this.truckG.fillStyle(0xfef08a, 0.9);
            this.truckG.fillRect(1189, t.y + 14, 4, 4);

            // wheels with hub detail
            this.truckG.fillStyle(0x0b1220, 1);
            this.truckG.fillCircle(1226, t.y + 34, 11);
            this.truckG.fillCircle(1322, t.y + 34, 11);
            this.truckG.fillStyle(0x94a3b8, 0.85);
            this.truckG.fillCircle(1226, t.y + 34, 4);
            this.truckG.fillCircle(1322, t.y + 34, 4);
            this.truckG.fillStyle(0x1e293b, 0.9);
            this.truckG.fillCircle(1226, t.y + 34, 2);
            this.truckG.fillCircle(1322, t.y + 34, 2);

            // 6 hidden slots (3x2) centered in cargo bay with slight spread
            const slots: Phaser.Math.Vector2[] = [];
            for (let r = 0; r < 2; r++) {
                for (let c = 0; c < 3; c++) {
                    const sx = 1232 + c * 26;
                    const sy = t.y - 2 + r * 20;
                    slots.push(new Phaser.Math.Vector2(sx, sy));
                }
            }
            this.cargoSlots[t.route] = slots;
        }
    }

    animateAgents() {
        const frame = Math.floor(this.time.now / 420) % 2;
        this.algoraAgents.forEach((s) => s.setTexture(`algora-bot-${frame}`));
        this.aoAgents.forEach((s) => s.setTexture(`ao-bot-${frame}`));
        this.bridgeAgents.forEach((s) => s.setTexture(`bridge-bot-${frame}`));
    }

    spawnInboundBox() {
        const riskPool: Array<Box["risk"]> = ["high", "medium", "low"];
        const sourcePool = ["github", "rss", "social", "chain"];
        const categoryPool = ["ai", "dev", "security", "crypto"];

        const risk = riskPool[Phaser.Math.Between(0, 2)];
        const priority: Priority = risk === "high" ? "P1" : risk === "medium" ? "P2" : "P3";
        const id = `BX-${String(this.nextId++).padStart(4, "0")}`;

        const x = 120;
        const y = 108;
        const sprite = this.add.image(x, y, "parcel").setDepth(30).setDisplaySize(58, 42);
        sprite.setInteractive({ cursor: "pointer" });
        const tag = this.add
            .text(x, y - 26, id, {
                color: "#e2e8f0",
                fontFamily: "monospace",
                fontSize: "10px",
                backgroundColor: "#0f172acc",
                padding: { x: 4, y: 2 },
            })
            .setOrigin(0.5)
            .setDepth(31);

        this.totalSignals += 1;

        const source = sourcePool[Phaser.Math.Between(0, 3)];
        const category = categoryPool[Phaser.Math.Between(0, 3)];
        const badge = this.add
            .text(x, y - 40, `${source.toUpperCase()} · ${risk.toUpperCase()}`, {
                color: "#e2e8f0",
                fontFamily: "monospace",
                fontSize: "9px",
                backgroundColor: "#0b1226f0",
                padding: { x: 4, y: 2 },
            })
            .setOrigin(0.5)
            .setDepth(32)
            .setShadow(0, 1, "#000000", 2);

        this.boxes.push({
            id,
            source,
            category,
            risk,
            priority,
            route: "Monitor",
            phase: "algora",
            status: "inbound",
            algoraStep: "new",
            x,
            y,
            beltY: LANE_Y[priority],
            sprite,
            tag,
            badge,
        });
    }

    tryAlgoraScan() {
        if (this.busyAlgoraScan) return;
        const b = this.boxes.find((x) => x.phase === "algora" && x.algoraStep === "new");
        if (!b) return;
        this.busyAlgoraScan = true;

        const scanner = this.algoraAgents[0];
        this.activeAlgoraScan = scanner;
        const home = new Phaser.Math.Vector2(scanner.x, scanner.y);
        const target = this.getAlgoraStackPoint();

        this.carrierPickAndCarry(scanner, b, target.x, target.y, 860, () => {
            b.algoraStep = "at-filter";
            b.status = "debating";
            this.moveCarrierHome(scanner, home, () => {
                this.activeAlgoraScan = undefined;
                this.busyAlgoraScan = false;
            });
        });
    }

    tryAlgoraFilter() {
        if (this.busyAlgoraFilter) return;
        const b = this.boxes.find((x) => x.phase === "algora" && x.algoraStep === "at-filter");
        if (!b) return;
        this.busyAlgoraFilter = true;

        const filter = this.algoraAgents[1];
        this.activeAlgoraFilter = filter;
        const home = new Phaser.Math.Vector2(filter.x, filter.y);

        const reject = b.risk === "low";
        this.time.delayedCall(560, () => {
            if (reject) {
                this.carrierPickAndCarry(filter, b, 42, 650, 740, () => {
                    b.algoraStep = "rejected";
                    b.phase = "done";
                    b.status = "loaded";
                    b.sprite.setVisible(false);
                    b.tag.setVisible(false);
                    b.badge.setVisible(false);
                    this.moveCarrierHome(filter, home, () => {
                        this.activeAlgoraFilter = undefined;
                        this.busyAlgoraFilter = false;
                    });
                });
                return;
            }

            b.algoraStep = "approved";
            b.status = "rerouting";
            this.activeAlgoraFilter = undefined;
            this.busyAlgoraFilter = false;
        });
    }

    tryAlgoraLoad() {
        if (this.busyAlgoraLoad) return;
        const b = this.boxes.find(
            (x) => x.phase === "algora" && x.algoraStep === "approved" && x.status === "rerouting"
        );
        if (!b) return;
        this.busyAlgoraLoad = true;

        b.algoraStep = "loading";
        b.status = "loading";

        const loader = this.algoraAgents[2];
        this.activeAlgoraLoad = loader;
        const home = new Phaser.Math.Vector2(loader.x, loader.y);

        this.carrierPickAndCarry(loader, b, BELT_LEFT + 24, b.beltY, 940, () => {
            b.status = "on-belt";
            this.taggedIssues += 1;
            this.moveCarrierHome(loader, home, () => {
                this.activeAlgoraLoad = undefined;
                this.busyAlgoraLoad = false;
            });
        });
    }

    tryAODebateAndCarry() {
        if (this.busyAO) return;
        const b = this.boxes.find((x) => x.phase === "ao" && x.status === "debating");
        if (!b) return;
        this.busyAO = true;

        this.aoDebateCard?.destroy();
        this.aoDebateCard = this.add
            .text(
                840,
                132,
                `AO DISCUSSION  |  ${b.id} ${b.source.toUpperCase()} ${b.risk.toUpperCase()}\nDEBATE: propose/challenge · PLAN: execution draft · ROUTE: A/B/C`,
                {
                    fontFamily: "monospace",
                    fontSize: "12px",
                    color: "#0b1220",
                    backgroundColor: "#fde68a",
                    padding: { x: 10, y: 6 },
                    lineSpacing: 2,
                }
            )
            .setOrigin(0.5)
            .setDepth(94);

        this.aoPlanChip?.destroy();
        this.aoPlanChip = this.add
            .text(760, 206, `PLAN: ${b.id} review`, {
                fontFamily: "monospace",
                fontSize: "9px",
                color: "#111827",
                backgroundColor: "#fcd34d",
                padding: { x: 5, y: 2 },
            })
            .setOrigin(0.5)
            .setDepth(89);

        const carrier = this.aoAgents[2];
        this.activeAOCarrier = carrier;
        const home = new Phaser.Math.Vector2(carrier.x, carrier.y);

        this.time.delayedCall(980, () => {
            this.debatesRun += 1;
            b.route = this.decideRoute(b);
            this.plansCreated += 1;
            b.status = "rerouting";
            this.aoRouteFlash = { route: b.route, until: this.time.now + 1100 };

            this.aoDebateCard?.setText(
                `AO RESULT  |  ${b.id}\nROUTE: ${b.route}  ·  based on ${b.risk.toUpperCase()} + ${b.priority}`
            );
            this.aoPlanChip?.setText(`PLAN: route=${b.route} → execute+verify`);

            this.time.delayedCall(850, () => {
                this.aoDebateCard?.destroy();
                this.aoDebateCard = undefined;
                this.aoPlanChip?.destroy();
                this.aoPlanChip = undefined;
            });

            this.carrierPickAndCarry(carrier, b, 820, ROUTE_Y[b.route], 980, () => {
                b.status = "on-belt";
                b.y = ROUTE_Y[b.route];
                this.moveCarrierHome(carrier, home, () => {
                    this.activeAOCarrier = undefined;
                    this.busyAO = false;
                });
            });
        });
    }

    tryBridgeLoad() {
        if (this.busyBridge) return;
        const b = this.boxes.find((x) => x.phase === "bridge" && x.status === "loading");
        if (!b) return;
        this.busyBridge = true;

        const carrier = this.bridgeAgents[0];
        this.activeBridgeCarrier = carrier;
        const home = new Phaser.Math.Vector2(carrier.x, carrier.y);

        const slot = this.findNextSlot(b.route);
        this.carrierPickAndCarry(carrier, b, slot.x, slot.y, 1100, () => {
            b.status = "loaded";
            b.phase = "done";
            b.sprite.setDepth(34);
            b.tag.setVisible(false);
            b.badge.setVisible(false);
            this.loaded += 1;
            this.verifiedOutcomes += 1;
            this.bridgeVerifyPing = { x: slot.x, y: slot.y, until: this.time.now + 500 };
            loadedHudEl.textContent = `Loaded: ${this.loaded}`;
            this.moveCarrierHome(carrier, home, () => {
                this.activeBridgeCarrier = undefined;
                this.busyBridge = false;
            });
        });
    }

    // box follows carrier head while moving
    carrierPickAndCarry(
        carrier: Phaser.GameObjects.Sprite,
        b: Box,
        targetX: number,
        targetY: number,
        duration: number,
        onDone: () => void
    ) {
        const startX = b.x;
        const startY = b.y;
        this.tweens.add({
            targets: carrier,
            x: startX,
            y: startY,
            duration: 260,
            onComplete: () => {
                this.tweens.add({
                    targets: carrier,
                    x: targetX,
                    y: targetY,
                    duration,
                    onUpdate: () => {
                        b.x = carrier.x;
                        b.y = carrier.y - 26;
                        b.sprite.setPosition(b.x, b.y);
                        b.tag.setPosition(b.x, this.getTagY(b));
                        b.badge.setPosition(b.x, this.getTagY(b) - 14);
                    },
                    onComplete: onDone,
                });
            },
        });
    }

    findNextSlot(route: Route) {
        const slots = this.cargoSlots[route];
        const idx = this.loadIndex[route] % slots.length;
        this.loadIndex[route] += 1;
        return slots[idx];
    }

    getAlgoraStackPoint() {
        const waiting = this.boxes.filter(
            (b) => b.phase === "algora" && (b.algoraStep === "at-filter" || b.algoraStep === "approved")
        ).length;
        const col = waiting % 2;
        const row = Math.floor(waiting / 2);
        return new Phaser.Math.Vector2(96 + col * 34, LANE_Y.P2 + 8 - row * 24);
    }

    decideRoute(b: Box): Route {
        if (b.priority === "P1") return "Immediate Action";
        if (b.priority === "P2") return Math.random() > 0.5 ? "Monitor" : "Immediate Action";
        return Math.random() > 0.55 ? "Defer" : "Monitor";
    }

    moveCarrierHome(
        carrier: Phaser.GameObjects.Sprite,
        home: Phaser.Math.Vector2,
        onDone: () => void
    ) {
        this.tweens.add({
            targets: carrier,
            x: home.x,
            y: home.y,
            duration: 300,
            onComplete: onDone,
        });
    }

    getTagY(b: Box) {
        const laneBias = b.priority === "P1" ? -34 : b.priority === "P2" ? -30 : -28;
        const jitter = Number(b.id.slice(-1)) % 2 === 0 ? -4 : 0;
        return b.y + laneBias + jitter;
    }

    getBoxBadgeText(b: Box) {
        const src = b.source.slice(0, 2).toUpperCase();
        const phase =
            b.phase === "algora"
                ? b.algoraStep === "at-filter"
                    ? "FILTER"
                    : b.algoraStep === "approved" || b.algoraStep === "loading"
                      ? "LOAD"
                      : "SCAN"
                : b.phase === "ao"
                  ? "PLAN"
                  : b.phase === "bridge"
                    ? "EXEC"
                    : "DONE";
        return `${src} · ${b.risk.toUpperCase()} · ${phase}`;
    }

    updateAgentBadges() {
        this.algoraAgentBadges.forEach((t, i) => {
            const active =
                (i === 0 && this.activeAlgoraScan === this.algoraAgents[i]) ||
                (i === 1 && this.activeAlgoraFilter === this.algoraAgents[i]) ||
                (i === 2 && this.activeAlgoraLoad === this.algoraAgents[i]);
            const base = i === 0 ? "SCAN" : i === 1 ? "FILTER" : "LOAD";
            const working = i === 0 ? "PICK" : i === 1 ? "DECIDE" : "BELT-IN";
            t.setText(active ? working : base);
            t.setPosition(this.algoraAgents[i].x, this.algoraAgents[i].y - 30);
        });
        this.aoAgentBadges.forEach((t, i) => {
            const active = this.activeAOCarrier === this.aoAgents[i];
            const base = i === 0 ? "DEBATE" : i === 1 ? "PLAN" : "ROUTE";
            const duringDebate = this.busyAO ? (i === 0 ? "PROPOSE" : i === 1 ? "SYNTH" : active ? "SEND" : "DECIDE") : base;
            t.setText(duringDebate);
            t.setPosition(this.aoAgents[i].x, this.aoAgents[i].y - 30);
        });
        this.bridgeAgentBadges.forEach((t, i) => {
            const active = this.activeBridgeCarrier === this.bridgeAgents[i];
            t.setText(active ? "EXECUTE" : i === 0 ? "EXECUTE" : "VERIFY");
            t.setPosition(this.bridgeAgents[i].x, this.bridgeAgents[i].y - 30);
        });
    }

    drawRoleEffects() {
        this.roleFxG.clear();

        const t = this.time.now * 0.012;

        const scan = this.algoraAgents[0];
        if (scan) {
            const r = 10 + Math.sin(t) * 3;
            this.roleFxG.lineStyle(2, 0x34d399, 0.65).strokeCircle(scan.x + 24, scan.y + 8, r);
        }

        const filter = this.algoraAgents[1];
        if (filter) {
            this.roleFxG.lineStyle(2, 0x86efac, 0.55).strokeRect(filter.x - 16, filter.y + 2, 32, 12);
        }

        const debate = this.aoAgents[0];
        const planner = this.aoAgents[1];
        const router = this.aoAgents[2];
        if (debate) this.roleFxG.lineStyle(2, 0xf59e0b, 0.55).strokeCircle(debate.x, debate.y + 10, 11 + Math.sin(t) * 2);
        if (planner) this.roleFxG.fillStyle(0xfcd34d, 0.22).fillRoundedRect(planner.x - 18, planner.y + 2, 36, 12, 4);
        if (router) this.roleFxG.lineStyle(2, 0xfbbf24, 0.6).strokeTriangle(router.x - 8, router.y + 12, router.x + 8, router.y + 12, router.x, router.y + 2);

        if (this.aoRouteFlash && this.time.now < this.aoRouteFlash.until) {
            const y = ROUTE_Y[this.aoRouteFlash.route];
            const pulse = 10 + Math.sin(t * 1.2) * 3;
            this.roleFxG.lineStyle(2, 0xfbbf24, 0.7).strokeCircle(1038, y, pulse);
            this.roleFxG.lineStyle(2, 0xfbbf24, 0.35).strokeCircle(1038, y, pulse + 6);
        }

        const loading = this.boxes.find((b) => b.phase === "bridge" && b.status === "loading");
        if (loading) {
            const y = ROUTE_Y[loading.route];
            this.roleFxG.fillStyle(0x60a5fa, 0.2).fillCircle(1188, y + 16, 8 + Math.sin(t) * 2);
        }

        if (this.bridgeVerifyPing && this.time.now < this.bridgeVerifyPing.until) {
            const age = (this.bridgeVerifyPing.until - this.time.now) / 500;
            this.roleFxG.lineStyle(2, 0x93c5fd, 0.9 * age).strokeCircle(this.bridgeVerifyPing.x, this.bridgeVerifyPing.y, 8 + (1 - age) * 16);
            const verifier = this.bridgeAgents[1];
            if (verifier) this.roleFxG.fillStyle(0x93c5fd, 0.6 * age).fillCircle(verifier.x, verifier.y + 8, 5);
        }
    }

    updateSelectedDetail() {
        if (!this.selectedBoxId) return;
        const b = this.boxes.find((x) => x.id === this.selectedBoxId);
        if (!b) {
            this.selectedBoxId = undefined;
            detailEl.innerHTML = `<h2>상세 정보</h2><p>선택한 박스가 처리 완료되어 목록에서 제거되었습니다.</p>`;
            return;
        }
        this.showDetail(b);
    }

    drawStats() {
        const algora = this.boxes.filter((b) => b.phase === "algora").length;
        const ao = this.boxes.filter((b) => b.phase === "ao").length;
        const bridge = this.boxes.filter((b) => b.phase === "bridge").length;
        const active = this.boxes.filter((b) => b.phase !== "done").length;

        const sourceCount = {
            github: this.boxes.filter((b) => b.source === "github").length,
            rss: this.boxes.filter((b) => b.source === "rss").length,
            social: this.boxes.filter((b) => b.source === "social").length,
            chain: this.boxes.filter((b) => b.source === "chain").length,
        };

        const routeCount = {
            immediate: this.boxes.filter((b) => b.route === "Immediate Action" && b.phase !== "done").length,
            monitor: this.boxes.filter((b) => b.route === "Monitor" && b.phase !== "done").length,
            defer: this.boxes.filter((b) => b.route === "Defer" && b.phase !== "done").length,
        };

        statsEl.innerHTML = `
      <div class="row"><span>Algora 단계</span><b>${algora}</b></div>
      <div class="row"><span>AO 단계</span><b>${ao}</b></div>
      <div class="row"><span>Bridge 단계</span><b>${bridge}</b></div>
      <div class="row"><span>적재 완료(Outcome)</span><b>${this.loaded}</b></div>
      <div class="row"><span>활성 박스</span><b>${active}</b></div>
    `;

        serviceStatusEl.innerHTML = `
      <h2>서비스 I/O 상태</h2>
      <div class="drow"><span>Algora Input</span><b>Signals ${this.totalSignals}</b></div>
      <div class="drow"><span>Algora Output</span><b>Tagged Issues ${this.taggedIssues}</b></div>
      <div class="hint">github:${sourceCount.github} · rss:${sourceCount.rss} · social:${sourceCount.social} · chain:${sourceCount.chain}</div>
      <div class="hint">agents: scan · filter · tag+load</div>
      <hr/>
      <div class="drow"><span>AO Input</span><b>Issue Queue ${ao}</b></div>
      <div class="drow"><span>AO Output</span><b>Plans ${this.plansCreated}</b></div>
      <div class="hint">debates:${this.debatesRun} · immediate:${routeCount.immediate} · monitor:${routeCount.monitor} · defer:${routeCount.defer}</div>
      <hr/>
      <div class="drow"><span>Bridge Input</span><b>Delegated ${this.delegatedToBridge}</b></div>
      <div class="drow"><span>Bridge Output</span><b>Verified ${this.verifiedOutcomes}</b></div>
      <div class="hint">agents: execute · verify · log outcome</div>
    `;
    }

    showDetail(b: Box) {
        const phaseAction =
            b.phase === "algora"
                ? "신호 수집 후 이슈 태깅 중"
                : b.phase === "ao"
                  ? "멀티 에이전트 토론 후 라우팅 결정 중"
                  : b.phase === "bridge"
                    ? "트럭 적재 + 실행 검증 중"
                    : "Outcome 로그 완료";

        const ioSummary =
            b.phase === "algora"
                ? `Input: ${b.source} signal / Output: tagged issue(${b.priority})`
                : b.phase === "ao"
                  ? `Input: issue context / Output: route=${b.route}`
                  : b.phase === "bridge"
                    ? `Input: delegated plan / Output: execution record`
                    : `Input: execution result / Output: feedback event`;

        detailEl.innerHTML = `
      <h2>${b.id}</h2>
      <div class="drow"><span>단계</span><b>${b.phase.toUpperCase()}</b></div>
      <div class="drow"><span>상태</span><b>${b.status}</b></div>
      <div class="drow"><span>현재 작업</span><b>${phaseAction}</b></div>
      <div class="drow"><span>source</span><b>${b.source}</b></div>
      <div class="drow"><span>category</span><b>${b.category}</b></div>
      <div class="drow"><span>risk</span><b>${b.risk}</b></div>
      <div class="drow"><span>priority</span><b>${b.priority}</b></div>
      <div class="drow"><span>AO route</span><b>${b.route}</b></div>
      <p class="hint">${ioSummary}</p>
    `;
    }
}

new Phaser.Game({
    type: Phaser.AUTO,
    parent: "stage",
    width: W,
    height: H,
    pixelArt: true,
    backgroundColor: "#050b19",
    scene: [SpaceHubScene],
});
