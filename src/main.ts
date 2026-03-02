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
  decoG!: Phaser.GameObjects.Graphics
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

  cargoSlots: Phaser.Math.Vector2[] = []

  create() {
    this.makeTextures()
    this.drawBackground()

    this.beltG = this.add.graphics().setDepth(10)
    this.decoG = this.add.graphics().setDepth(14)
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

    // more box-like parcel texture
    this.textures.generate('parcel', {
      pixelWidth: 2,
      data: [
        '.......aaaaaa.......',
        '......abbbbbba......',
        '.....abccccccba.....',
        '....abccddddccba....',
        '...abccddddddccba...',
        '...abccddddddccba...',
        '...abccddddddccba...',
        '...abccddddddccba...',
        '...abccddddddccba...',
        '....abccddddccba....',
        '.....abccccccba.....',
        '......abbbbbba......',
        '.......aeeffeea.....',
        '........aaaaaa......',
      ],
      palette: {
        a: '#6b4f2f',
        b: '#b78955',
        c: '#d5a870',
        d: '#e8c693',
        e: '#f1e3be',
        f: '#8b5cf6',
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
      this.beltG.fillStyle(tone, 0.9)
      this.beltG.fillRoundedRect(BELT_LEFT, y - 32, BELT_RIGHT - BELT_LEFT, 64, 14)
      this.beltG.lineStyle(4, 0x475569, 0.7)
      this.beltG.strokeRoundedRect(BELT_LEFT, y - 32, BELT_RIGHT - BELT_LEFT, 64, 14)

      // wheel-like rollers
      for (let x = BELT_LEFT + 12; x < BELT_RIGHT - 12; x += 30) {
        this.beltG.fillStyle(0x64748b, 0.55)
        this.beltG.fillCircle(x, y, 6)
        this.beltG.fillStyle(0x334155, 0.85)
        this.beltG.fillCircle(x, y, 2)
      }

      // belt tread animation
      for (let x = BELT_LEFT - 34; x < BELT_RIGHT + 10; x += 54) {
        const sx = x + (this.beltOffset % 54)
        this.beltG.fillStyle(0xe2e8f0, 0.18)
        this.beltG.fillTriangle(sx, y - 10, sx + 22, y, sx, y + 10)
      }
    }

    this.beltG.fillStyle(0x0f172a, 0.85)
    this.beltG.fillRoundedRect(BELT_LEFT - 14, LANE_Y.P1 - 40, 58, 380, 8)
    this.beltG.fillRoundedRect(BELT_RIGHT - 45, LANE_Y.P1 - 40, 58, 380, 8)
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

    // 3 trucks for 3 routes
    const trucks = [
      { label: 'Express', y: 188 },
      { label: 'Monitor', y: 348 },
      { label: 'Defer', y: 508 },
    ]

    this.cargoSlots = []
    for (const t of trucks) {
      this.truckG.fillStyle(0x111827, 0.96)
      this.truckG.fillRoundedRect(1200, t.y - 54, 200, 100, 12)
      this.truckG.lineStyle(2, 0x60a5fa, 0.9)
      this.truckG.strokeRoundedRect(1200, t.y - 54, 200, 100, 12)
      this.truckG.fillStyle(0x1f2937, 1)
      this.truckG.fillRoundedRect(1212, t.y - 30, 112, 56, 8)
      this.add.text(1328, t.y - 40, t.label, { color: '#bfdbfe', fontSize: '11px', fontFamily: 'monospace' }).setDepth(36)

      for (let i = 0; i < 2; i++) {
        const slot = new Phaser.Math.Vector2(1238 + i * 38, t.y - 2)
        this.cargoSlots.push(slot)
        this.truckG.lineStyle(1, 0x475569, 0.6)
        this.truckG.strokeRoundedRect(slot.x - 16, slot.y - 12, 32, 24, 4)
      }
    }

    this.truckCount = this.add.text(1248, 610, 'Loaded: 0', { color: '#93c5fd', fontSize: '11px', fontFamily: 'monospace' }).setDepth(36)
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
    const y = 110
    const sprite = this.add.image(x, y, 'parcel').setDepth(30).setDisplaySize(56, 40)
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

    this.algoraCarrierMoveTo(b.x + 22, b.y, () => {
      b.status = 'on-belt'
      // carry motion onto correct lane
      this.tweens.add({
        targets: b,
        x: BELT_LEFT + 20,
        y: b.beltY,
        duration: 520,
        onUpdate: () => {
          b.sprite.setPosition(b.x, b.y)
          b.tag.setPosition(b.x, b.y - 26)
        },
        onComplete: () => {
          this.algoraCarrierMoveTo(150, 170, () => (this.busyAlgora = false))
        },
      })
    })
  }

  tryAODebateAndCarry() {
    if (this.busyAO) return
    const b = this.boxes.find((x) => x.phase === 'ao' && x.status === 'debating')
    if (!b) return
    this.busyAO = true

    const bubble = this.add
      .text(760, 130, '💬 route?', { fontFamily: 'monospace', fontSize: '11px', color: '#0f172a', backgroundColor: '#fde68a', padding: { x: 5, y: 2 } })
      .setOrigin(0.5)
      .setDepth(60)

    this.time.delayedCall(600, () => {
      bubble.destroy()
      b.route = this.decideRoute(b)
      b.status = 'rerouting'

      this.aoCarrierMoveTo(b.x, b.y, () => {
        this.tweens.add({
          targets: b,
          x: 820,
          y: ROUTE_Y[b.route],
          duration: 560,
          onUpdate: () => {
            b.sprite.setPosition(b.x, b.y)
            b.tag.setPosition(b.x, b.y - 26)
          },
          onComplete: () => {
            b.status = 'on-belt'
            b.y = ROUTE_Y[b.route]
            this.aoCarrierMoveTo(690, 168, () => (this.busyAO = false))
          },
        })
      })
    })
  }

  tryBridgeLoad() {
    if (this.busyBridge) return
    const b = this.boxes.find((x) => x.phase === 'bridge' && x.status === 'loading')
    if (!b) return
    this.busyBridge = true

    const slot = this.findNextSlot(b.route)
    this.bridgeCarrierMoveTo(b.x, b.y, () => {
      this.tweens.add({
        targets: b,
        x: slot.x,
        y: slot.y,
        duration: 680,
        onUpdate: () => {
          b.sprite.setPosition(b.x, b.y)
          b.tag.setPosition(b.x, b.y - 26)
        },
        onComplete: () => {
          b.status = 'loaded'
          b.phase = 'done'
          b.sprite.setDepth(34)
          b.tag.destroy()
          this.loaded += 1
          this.truckCount.setText(`Loaded: ${this.loaded}`)
          this.bridgeCarrierMoveTo(1185, 168, () => (this.busyBridge = false))
        },
      })
    })
  }

  findNextSlot(route: Route) {
    const groupIndex = route === 'Immediate Action' ? 0 : route === 'Monitor' ? 1 : 2
    const base = groupIndex * 2
    const idx = base + (this.loaded % 2)
    return this.cargoSlots[idx]
  }

  decideRoute(b: Box): Route {
    if (b.priority === 'P1') return 'Immediate Action'
    if (b.priority === 'P2') return Math.random() > 0.5 ? 'Monitor' : 'Immediate Action'
    return Math.random() > 0.55 ? 'Defer' : 'Monitor'
  }

  algoraCarrierMoveTo(x: number, y: number, onDone: () => void) {
    this.tweens.add({ targets: this.algoraCarrier, x, y, duration: 300, onComplete: onDone })
  }
  aoCarrierMoveTo(x: number, y: number, onDone: () => void) {
    this.tweens.add({ targets: this.aoCarrier, x, y, duration: 320, onComplete: onDone })
  }
  bridgeCarrierMoveTo(x: number, y: number, onDone: () => void) {
    this.tweens.add({ targets: this.bridgeCarrier, x, y, duration: 360, onComplete: onDone })
  }

  drawFlowFX() {
    this.decoG.clear()
    this.decoG.lineStyle(2, 0xf59e0b, 0.24)
    for (const b of this.boxes) {
      if (b.phase === 'ao' || b.phase === 'bridge') this.decoG.lineBetween(760, b.beltY, b.x, b.y)
    }
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
      <p class="hint">Algora 에이전트가 직접 벨트에 적재 → AO 토론 후 분기 이동 → Bridge 에이전트가 트럭에 직접 적재.</p>
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
