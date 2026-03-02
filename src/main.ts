import './style.css'
import Phaser from 'phaser'

type Priority = 'P1' | 'P2' | 'P3'
type Route = 'Immediate Action' | 'Monitor' | 'Defer'
type Phase = 'algora' | 'ao' | 'bridge' | 'done'
type BoxStatus = 'inbound' | 'on-belt' | 'debating' | 'rerouting' | 'loading' | 'loaded'

type Box = {
  id: string
  source: string
  category: string
  risk: 'high' | 'medium' | 'low'
  priority: Priority
  route: Route
  phase: Phase
  status: BoxStatus
  x: number
  y: number
  beltY: number
  sprite: Phaser.GameObjects.Image
  tag: Phaser.GameObjects.Text
}

const W = 1440
const H = 760
const BELT_LEFT = 180
const BELT_RIGHT = 1140
const LANE_Y: Record<Priority, number> = { P1: 230, P2: 380, P3: 530 }
const ROUTE_Y: Record<Route, number> = { 'Immediate Action': 220, Monitor: 380, Defer: 540 }

const app = document.querySelector<HTMLDivElement>('#app')!
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
    <div id="detail" class="detail"><h2>상세 정보</h2><p>박스를 클릭하면 상세 정보가 표시됩니다.</p></div>
  </aside>
  <main class="stage-wrap">
    <div id="stage"></div>
    <div id="titleBar" class="titleBar">🚚 Orbital Conveyor Operations</div>
  </main>
</div>
`

const statsEl = document.querySelector<HTMLDivElement>('#stats')!
const detailEl = document.querySelector<HTMLDivElement>('#detail')!

class SpaceHubScene extends Phaser.Scene {
  boxes: Box[] = []
  nextId = 1
  lastSpawn = 0
  beltOffset = 0
  loaded = 0

  beltG!: Phaser.GameObjects.Graphics
  truckG!: Phaser.GameObjects.Graphics
  truckCount!: Phaser.GameObjects.Text

  algoraCarrier!: Phaser.GameObjects.Sprite
  aoCarrier!: Phaser.GameObjects.Sprite
  bridgeCarrier!: Phaser.GameObjects.Sprite
  aoDiscussA!: Phaser.GameObjects.Sprite
  aoDiscussB!: Phaser.GameObjects.Sprite

  busyAlgora = false
  busyAO = false
  busyBridge = false

  cargoSlots: Record<Route, Phaser.Math.Vector2[]> = {
    'Immediate Action': [],
    Monitor: [],
    Defer: [],
  }
  loadIndex: Record<Route, number> = {
    'Immediate Action': 0,
    Monitor: 0,
    Defer: 0,
  }

  create() {
    this.makeTextures()
    this.drawBackground()

    this.beltG = this.add.graphics().setDepth(10)
    this.truckG = this.add.graphics().setDepth(30)

    this.drawBelts()
    this.drawLabels()
    this.spawnAgents()
    this.buildTrucks()

    this.input.on('gameobjectdown', (_: any, go: any) => {
      const box = this.boxes.find((b) => b.sprite === go)
      if (box) this.showDetail(box)
    })

    this.time.addEvent({ delay: 420, loop: true, callback: () => this.animateAgents() })
  }

  update(_: number, dt: number) {
    const speed = Number((document.querySelector('#speed') as HTMLInputElement).value)
    const maxBoxes = Number((document.querySelector('#maxBoxes') as HTMLInputElement).value)

    this.beltOffset += dt * 0.07 * speed
    this.drawBelts()

    if (this.time.now - this.lastSpawn > 1700 && this.boxes.filter((b) => b.phase !== 'done').length < maxBoxes) {
      this.spawnInboundBox()
      this.lastSpawn = this.time.now
    }

    this.tryAlgoraCarry()
    this.tryAODebateAndCarry()
    this.tryBridgeLoad()

    for (const b of this.boxes) {
      if (b.status === 'on-belt') {
        b.x += 0.8 * speed
        if (b.phase === 'algora' && b.x >= 650) {
          b.phase = 'ao'
          b.status = 'debating'
        }
        if (b.phase === 'ao' && b.x >= 980) {
          b.phase = 'bridge'
          b.status = 'loading'
        }
      }

      b.sprite.setPosition(b.x, b.y)
      b.tag.setPosition(b.x, b.y - 26)
    }

    this.drawStats()
  }

  makeTextures() {
    this.textures.generate('star', {
      pixelWidth: 2,
      data: ['..a..', '.aaa.', 'aaaaa', '.aaa.', '..a..'],
      palette: { a: '#ffffff', '.': '#00000000' } as any,
    })

    // square parcel + tape detail
    this.textures.generate('parcel', {
      pixelWidth: 2,
      data: [
        '....................',
        '..aaaaaaaaaaaaaaaa..',
        '..abbbbbbbbbbbbbba..',
        '..abccccccddccccba..',
        '..abccccccddccccba..',
        '..abccccccddccccba..',
        '..abccccccddccccba..',
        '..abccccccddccccba..',
        '..abccccccddccccba..',
        '..abccccccddccccba..',
        '..abccccccddccccba..',
        '..abeeeeeeeeeeeeba..',
        '..abbbbbbbbbbbbbba..',
        '..aaaaaaaaaaaaaaaa..',
        '....................',
      ],
      palette: {
        a: '#6b4f2f',
        b: '#b78955',
        c: '#d4a86f',
        d: '#f3df9c',
        e: '#e9c68d',
        '.': '#00000000',
      } as any,
    })

    const makeBot = (key: string, accent: string) => {
      this.textures.generate(`${key}-0`, {
        pixelWidth: 2,
        data: ['...wwww...', '..wvvvvw..', '..wvvvvw..', '.wwwwwwww.', '.wwwaawww.', '.wwwwwwww.', '..dd..dd..', '...dddd...'],
        palette: { w: '#e5e7eb', v: '#0f172a', a: accent, d: '#9ca3af', '.': '#00000000' } as any,
      })
      this.textures.generate(`${key}-1`, {
        pixelWidth: 2,
        data: ['...wwww...', '..wvvvvw..', '..wvvvvw..', '.wwwwwwww.', '.wwwaawww.', '.wwwwwwww.', '...dddd...', '..dd..dd..'],
        palette: { w: '#e5e7eb', v: '#0f172a', a: accent, d: '#9ca3af', '.': '#00000000' } as any,
      })
    }

    makeBot('algora-bot', '#34d399')
    makeBot('ao-bot', '#f59e0b')
    makeBot('bridge-bot', '#60a5fa')
  }

  drawBackground() {
    this.add.rectangle(W / 2, H / 2, W, H, 0x060b1b)
    for (let i = 0; i < 120; i++) {
      const s = this.add.image(Phaser.Math.Between(0, W), Phaser.Math.Between(0, H), 'star').setDepth(2)
      s.setScale(Phaser.Math.FloatBetween(0.2, 0.6))
      s.setAlpha(Phaser.Math.FloatBetween(0.2, 0.9))
    }
    this.add.rectangle(220, H / 2, 320, H - 80, 0x0f2d2a, 0.18).setStrokeStyle(2, 0x34d399, 0.35)
    this.add.rectangle(W / 2, H / 2, 420, H - 80, 0x3f2a12, 0.16).setStrokeStyle(2, 0xf59e0b, 0.35)
    this.add.rectangle(W - 190, H / 2, 330, H - 80, 0x10263f, 0.16).setStrokeStyle(2, 0x60a5fa, 0.35)
  }

  drawBelts() {
    this.beltG.clear()

    const lanes: [Priority, number][] = [['P1', LANE_Y.P1], ['P2', LANE_Y.P2], ['P3', LANE_Y.P3]]
    for (const [p, y] of lanes) {
      const tone = p === 'P1' ? 0x4b1a1a : p === 'P2' ? 0x1e293b : 0x131925
      this.beltG.fillStyle(tone, 0.92)
      this.beltG.fillRoundedRect(BELT_LEFT, y - 32, BELT_RIGHT - BELT_LEFT, 64, 12)
      this.beltG.lineStyle(4, 0x475569, 0.74)
      this.beltG.strokeRoundedRect(BELT_LEFT, y - 32, BELT_RIGHT - BELT_LEFT, 64, 12)

      // conveyor side wheels (tire-like)
      for (let x = BELT_LEFT + 10; x < BELT_RIGHT - 10; x += 30) {
        this.beltG.fillStyle(0x64748b, 0.58)
        this.beltG.fillCircle(x, y - 22, 5)
        this.beltG.fillCircle(x, y + 22, 5)
        this.beltG.fillStyle(0x1f2937, 0.9)
        this.beltG.fillCircle(x, y - 22, 2)
        this.beltG.fillCircle(x, y + 22, 2)
      }

      // center treads
      for (let x = BELT_LEFT - 34; x < BELT_RIGHT + 10; x += 50) {
        const sx = x + (this.beltOffset % 50)
        this.beltG.fillStyle(0xe2e8f0, 0.2)
        this.beltG.fillRect(sx, y - 7, 20, 14)
      }
    }

    this.beltG.fillStyle(0x0f172a, 0.86)
    this.beltG.fillRoundedRect(BELT_LEFT - 18, LANE_Y.P1 - 42, 58, 384, 8)
    this.beltG.fillRoundedRect(BELT_RIGHT - 42, LANE_Y.P1 - 42, 58, 384, 8)
  }

  drawLabels() {
    this.add.text(90, LANE_Y.P1 - 52, 'P1 URGENT', { fontSize: '11px', color: '#fca5a5', fontFamily: 'monospace' })
    this.add.text(90, LANE_Y.P2 - 52, 'P2 NORMAL', { fontSize: '11px', color: '#93c5fd', fontFamily: 'monospace' })
    this.add.text(90, LANE_Y.P3 - 52, 'P3 LOW', { fontSize: '11px', color: '#cbd5e1', fontFamily: 'monospace' })

    this.add.text(130, 120, 'ALGORA · Inbound Tagging', { fontSize: '14px', color: '#86efac', fontFamily: 'monospace' })
    this.add.text(W / 2 - 110, 120, 'AO · Routing Discussion', { fontSize: '14px', color: '#fcd34d', fontFamily: 'monospace' })
    this.add.text(W - 350, 120, 'BRIDGE · Dispatch Bay', { fontSize: '14px', color: '#93c5fd', fontFamily: 'monospace' })

    this.add.text(990, 188, 'Immediate Action', { color: '#fde68a', fontSize: '11px', fontFamily: 'monospace' })
    this.add.text(990, 348, 'Monitor', { color: '#fde68a', fontSize: '11px', fontFamily: 'monospace' })
    this.add.text(990, 508, 'Defer', { color: '#fde68a', fontSize: '11px', fontFamily: 'monospace' })
  }

  spawnAgents() {
    const m = (key: string, x: number, y: number) => this.add.sprite(x, y, `${key}-0`).setDepth(40).setDisplaySize(44, 44)
    this.algoraCarrier = m('algora-bot', 150, 170)
    this.aoCarrier = m('ao-bot', 690, 168)
    this.bridgeCarrier = m('bridge-bot', 1185, 168)
    this.aoDiscussA = m('ao-bot', 760, 168)
    this.aoDiscussB = m('ao-bot', 830, 168)
  }

  buildTrucks() {
    this.truckG.clear()

    const trucks: Array<{ route: Route; y: number; label: string }> = [
      { route: 'Immediate Action', y: 188, label: 'Express' },
      { route: 'Monitor', y: 348, label: 'Monitor' },
      { route: 'Defer', y: 508, label: 'Defer' },
    ]

    for (const t of trucks) {
      // cargo bed
      this.truckG.fillStyle(0x111827, 0.96)
      this.truckG.fillRoundedRect(1220, t.y - 44, 140, 72, 8)
      this.truckG.lineStyle(2, 0x60a5fa, 0.9)
      this.truckG.strokeRoundedRect(1220, t.y - 44, 140, 72, 8)

      // cab
      this.truckG.fillStyle(0x1e293b, 1)
      this.truckG.fillRoundedRect(1362, t.y - 30, 36, 56, 6)
      this.truckG.fillStyle(0x93c5fd, 0.75)
      this.truckG.fillRect(1368, t.y - 22, 20, 14)

      // wheels
      this.truckG.fillStyle(0x0b1220, 1)
      this.truckG.fillCircle(1245, t.y + 30, 10)
      this.truckG.fillCircle(1338, t.y + 30, 10)
      this.truckG.fillStyle(0x94a3b8, 0.8)
      this.truckG.fillCircle(1245, t.y + 30, 4)
      this.truckG.fillCircle(1338, t.y + 30, 4)

      this.add.text(1228, t.y - 58, t.label, { color: '#bfdbfe', fontSize: '11px', fontFamily: 'monospace' }).setDepth(36)

      // 4 slots (2x2) for stacking feel
      const slots: Phaser.Math.Vector2[] = []
      for (let r = 0; r < 2; r++) {
        for (let c = 0; c < 2; c++) {
          const sx = 1244 + c * 36
          const sy = t.y - 10 + r * 24
          slots.push(new Phaser.Math.Vector2(sx, sy))
          this.truckG.lineStyle(1, 0x475569, 0.6)
          this.truckG.strokeRoundedRect(sx - 14, sy - 10, 28, 20, 4)
        }
      }
      this.cargoSlots[t.route] = slots
    }

    this.truckCount = this.add.text(1248, 620, 'Loaded: 0', { color: '#93c5fd', fontSize: '11px', fontFamily: 'monospace' }).setDepth(36)
  }

  animateAgents() {
    const frame = Math.floor(this.time.now / 420) % 2
    const set = (s: Phaser.GameObjects.Sprite, key: string) => s.setTexture(`${key}-${frame}`)
    set(this.algoraCarrier, 'algora-bot')
    set(this.aoCarrier, 'ao-bot')
    set(this.bridgeCarrier, 'bridge-bot')
    set(this.aoDiscussA, 'ao-bot')
    set(this.aoDiscussB, 'ao-bot')
  }

  spawnInboundBox() {
    const riskPool: Array<Box['risk']> = ['high', 'medium', 'low']
    const sourcePool = ['github', 'rss', 'social', 'chain']
    const categoryPool = ['ai', 'dev', 'security', 'crypto']

    const risk = riskPool[Phaser.Math.Between(0, 2)]
    const priority: Priority = risk === 'high' ? 'P1' : risk === 'medium' ? 'P2' : 'P3'
    const id = `BX-${String(this.nextId++).padStart(4, '0')}`

    const x = 120
    const y = 108
    const sprite = this.add.image(x, y, 'parcel').setDepth(30).setDisplaySize(58, 42)
    sprite.setInteractive({ cursor: 'pointer' })
    const tag = this.add
      .text(x, y - 26, id, {
        color: '#e2e8f0', fontFamily: 'monospace', fontSize: '10px', backgroundColor: '#0f172acc', padding: { x: 4, y: 2 },
      })
      .setOrigin(0.5)
      .setDepth(31)

    this.boxes.push({
      id,
      source: sourcePool[Phaser.Math.Between(0, 3)],
      category: categoryPool[Phaser.Math.Between(0, 3)],
      risk,
      priority,
      route: 'Monitor',
      phase: 'algora',
      status: 'inbound',
      x,
      y,
      beltY: LANE_Y[priority],
      sprite,
      tag,
    })
  }

  tryAlgoraCarry() {
    if (this.busyAlgora) return
    const b = this.boxes.find((x) => x.status === 'inbound')
    if (!b) return
    this.busyAlgora = true

    this.carrierPickAndCarry(this.algoraCarrier, b, BELT_LEFT + 20, b.beltY, 640, () => {
      b.status = 'on-belt'
      this.algoraCarrierMoveTo(150, 170, () => (this.busyAlgora = false))
    })
  }

  tryAODebateAndCarry() {
    if (this.busyAO) return
    const b = this.boxes.find((x) => x.phase === 'ao' && x.status === 'debating')
    if (!b) return
    this.busyAO = true

    const bubble = this.add
      .text(760, 130, '💬 debate → route', { fontFamily: 'monospace', fontSize: '11px', color: '#0f172a', backgroundColor: '#fde68a', padding: { x: 5, y: 2 } })
      .setOrigin(0.5)
      .setDepth(60)

    this.time.delayedCall(620, () => {
      bubble.destroy()
      b.route = this.decideRoute(b)
      b.status = 'rerouting'
      this.carrierPickAndCarry(this.aoCarrier, b, 820, ROUTE_Y[b.route], 620, () => {
        b.status = 'on-belt'
        b.y = ROUTE_Y[b.route]
        this.aoCarrierMoveTo(690, 168, () => (this.busyAO = false))
      })
    })
  }

  tryBridgeLoad() {
    if (this.busyBridge) return
    const b = this.boxes.find((x) => x.phase === 'bridge' && x.status === 'loading')
    if (!b) return
    this.busyBridge = true

    const slot = this.findNextSlot(b.route)
    this.carrierPickAndCarry(this.bridgeCarrier, b, slot.x, slot.y, 740, () => {
      b.status = 'loaded'
      b.phase = 'done'
      b.sprite.setDepth(34)
      b.tag.destroy()
      this.loaded += 1
      this.truckCount.setText(`Loaded: ${this.loaded}`)
      this.bridgeCarrierMoveTo(1185, 168, () => (this.busyBridge = false))
    })
  }

  // box follows carrier head while moving
  carrierPickAndCarry(carrier: Phaser.GameObjects.Sprite, b: Box, targetX: number, targetY: number, duration: number, onDone: () => void) {
    const startX = b.x
    const startY = b.y
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
            b.x = carrier.x
            b.y = carrier.y - 26
            b.sprite.setPosition(b.x, b.y)
            b.tag.setPosition(b.x, b.y - 26)
          },
          onComplete: onDone,
        })
      },
    })
  }

  findNextSlot(route: Route) {
    const slots = this.cargoSlots[route]
    const idx = this.loadIndex[route] % slots.length
    this.loadIndex[route] += 1
    return slots[idx]
  }

  decideRoute(b: Box): Route {
    if (b.priority === 'P1') return 'Immediate Action'
    if (b.priority === 'P2') return Math.random() > 0.5 ? 'Monitor' : 'Immediate Action'
    return Math.random() > 0.55 ? 'Defer' : 'Monitor'
  }

  algoraCarrierMoveTo(x: number, y: number, onDone: () => void) {
    this.tweens.add({ targets: this.algoraCarrier, x, y, duration: 280, onComplete: onDone })
  }
  aoCarrierMoveTo(x: number, y: number, onDone: () => void) {
    this.tweens.add({ targets: this.aoCarrier, x, y, duration: 300, onComplete: onDone })
  }
  bridgeCarrierMoveTo(x: number, y: number, onDone: () => void) {
    this.tweens.add({ targets: this.bridgeCarrier, x, y, duration: 320, onComplete: onDone })
  }

  drawStats() {
    const algora = this.boxes.filter((b) => b.phase === 'algora').length
    const ao = this.boxes.filter((b) => b.phase === 'ao').length
    const bridge = this.boxes.filter((b) => b.phase === 'bridge').length

    statsEl.innerHTML = `
      <div class="row"><span>Algora</span><b>${algora}</b></div>
      <div class="row"><span>AO</span><b>${ao}</b></div>
      <div class="row"><span>Bridge</span><b>${bridge}</b></div>
      <div class="row"><span>적재 완료</span><b>${this.loaded}</b></div>
      <div class="row"><span>활성 박스</span><b>${this.boxes.filter((b) => b.phase !== 'done').length}</b></div>
    `
  }

  showDetail(b: Box) {
    detailEl.innerHTML = `
      <h2>${b.id}</h2>
      <div class="drow"><span>단계</span><b>${b.phase.toUpperCase()}</b></div>
      <div class="drow"><span>상태</span><b>${b.status}</b></div>
      <div class="drow"><span>source</span><b>${b.source}</b></div>
      <div class="drow"><span>category</span><b>${b.category}</b></div>
      <div class="drow"><span>risk</span><b>${b.risk}</b></div>
      <div class="drow"><span>priority</span><b>${b.priority}</b></div>
      <div class="drow"><span>AO route</span><b>${b.route}</b></div>
      <p class="hint">Algora가 박스를 직접 들어 벨트에 올리고, AO가 토론 후 직접 분기 라인으로 옮기고, Bridge가 트럭 칸에 하나씩 적재합니다.</p>
    `
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'stage',
  width: W,
  height: H,
  pixelArt: true,
  backgroundColor: '#050b19',
  scene: [SpaceHubScene],
})
