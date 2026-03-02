import './style.css'
import Phaser from 'phaser'

type Priority = 'P1' | 'P2' | 'P3'
type Route = 'Immediate Action' | 'Monitor' | 'Defer'
type Phase = 'algora' | 'ao' | 'bridge'

type Box = {
  id: string
  source: string
  category: string
  risk: 'high' | 'medium' | 'low'
  priority: Priority
  route?: Route
  phase: Phase
  status: string
  x: number
  y: number
  speed: number
  waitMs: number
  sprite: Phaser.GameObjects.Image
  tag: Phaser.GameObjects.Text
}

const W = 1440
const H = 760
const BELT_LEFT = 80
const BELT_RIGHT = 1170
const LANE_Y = { P1: 230, P2: 380, P3: 530 }
const ROUTE_Y: Record<Route, number> = { 'Immediate Action': 220, Monitor: 380, Defer: 540 }

const COLOR = {
  algora: 0x34d399,
  ao: 0xf59e0b, // swapped (was bridge)
  bridge: 0x60a5fa, // swapped (was ao)
}

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
  loadedCount = 0

  beltLayer!: Phaser.GameObjects.Graphics
  fxLayer!: Phaser.GameObjects.Graphics
  truckLayer!: Phaser.GameObjects.Graphics
  truckCountText!: Phaser.GameObjects.Text
  cargoSlots: Phaser.Math.Vector2[] = []

  algoraBots: Phaser.GameObjects.Sprite[] = []
  aoBots: Phaser.GameObjects.Sprite[] = []
  bridgeBots: Phaser.GameObjects.Sprite[] = []

  create() {
    this.createTextures()
    this.drawBackground()

    this.beltLayer = this.add.graphics().setDepth(10)
    this.fxLayer = this.add.graphics().setDepth(50)
    this.truckLayer = this.add.graphics().setDepth(35)

    this.drawServiceLabels()
    this.drawAOBranchHints()
    this.spawnAgents()
    this.buildTruck()

    this.input.on('gameobjectdown', (_: any, go: any) => {
      const box = this.boxes.find((b) => b.sprite === go)
      if (box) this.showDetail(box)
    })

    this.time.addEvent({ delay: 420, loop: true, callback: () => this.updateAgentAnim() })
  }

  update(_: number, dt: number) {
    const speedMul = Number((document.querySelector('#speed') as HTMLInputElement).value)
    const maxBoxes = Number((document.querySelector('#maxBoxes') as HTMLInputElement).value)

    this.beltOffset += dt * 0.06
    this.drawBelts()

    if (this.time.now - this.lastSpawn > 1600 && this.boxes.length < maxBoxes) {
      this.spawnBox()
      this.lastSpawn = this.time.now
    }

    for (const b of this.boxes) {
      if (b.waitMs > 0) b.waitMs -= dt
      else this.moveBox(b, (dt / 1000) * b.speed * speedMul)

      b.tag.setPosition(b.x, b.y - 25)
      b.sprite.setPosition(b.x, b.y)
    }

    this.drawFlowFX()
    this.drawStats()
  }

  createTextures() {
    this.textures.generate('star', {
      pixelWidth: 2,
      data: ['..a..', '.aaa.', 'aaaaa', '.aaa.', '..a..'],
      palette: { a: '#ffffff', '.': '#00000000' } as any,
    })

    this.textures.generate('parcel', {
      pixelWidth: 2,
      data: [
        '.....aaaaaa.....',
        '....abbbbbba....',
        '...abccccccba...',
        '..abccddddd cba..',
        '..abccddddd cba..',
        '..abccddddd cba..',
        '..abccccccba....',
        '...abbbbbba.....',
        '....aeeffeea....',
        '.....aaaaaa.....',
      ],
      palette: {
        a: '#6b4f2f',
        b: '#b68a58',
        c: '#d1a671',
        d: '#e8c38f',
        e: '#f5e6b4',
        f: '#8b5cf6',
        ' ': '#00000000',
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
    for (let i = 0; i < 130; i++) {
      const s = this.add.image(Phaser.Math.Between(0, W), Phaser.Math.Between(0, H), 'star').setDepth(2)
      s.setScale(Phaser.Math.FloatBetween(0.2, 0.6))
      s.setAlpha(Phaser.Math.FloatBetween(0.2, 0.9))
    }

    this.add.rectangle(180, H / 2, 320, H - 80, 0x0f2d2a, 0.18).setStrokeStyle(2, COLOR.algora, 0.35)
    this.add.rectangle(W / 2, H / 2, 460, H - 80, 0x3f2a12, 0.16).setStrokeStyle(2, COLOR.ao, 0.35)
    this.add.rectangle(W - 190, H / 2, 340, H - 80, 0x10263f, 0.16).setStrokeStyle(2, COLOR.bridge, 0.35)
  }

  drawBelts() {
    this.beltLayer.clear()

    const lanes: [Priority, number][] = [
      ['P1', LANE_Y.P1],
      ['P2', LANE_Y.P2],
      ['P3', LANE_Y.P3],
    ]

    for (const [p, y] of lanes) {
      const tone = p === 'P1' ? 0x4b1a1a : p === 'P2' ? 0x1e293b : 0x131925
      this.beltLayer.fillStyle(tone, 0.86)
      this.beltLayer.fillRoundedRect(BELT_LEFT, y - 30, BELT_RIGHT - BELT_LEFT, 60, 14)

      this.beltLayer.lineStyle(4, 0x475569, 0.7)
      this.beltLayer.strokeRoundedRect(BELT_LEFT, y - 30, BELT_RIGHT - BELT_LEFT, 60, 14)

      // rollers
      for (let x = BELT_LEFT + 16; x < BELT_RIGHT - 16; x += 28) {
        this.beltLayer.fillStyle(0x94a3b8, 0.35)
        this.beltLayer.fillCircle(x, y, 4)
      }

      // moving chevrons
      for (let x = BELT_LEFT - 30; x < BELT_RIGHT; x += 54) {
        const sx = x + (this.beltOffset % 54)
        this.beltLayer.fillStyle(0xe2e8f0, 0.16)
        this.beltLayer.fillTriangle(sx, y - 10, sx + 18, y, sx, y + 10)
      }
    }

    this.add.text(94, LANE_Y.P1 - 50, 'P1 URGENT', { fontSize: '11px', color: '#fca5a5', fontFamily: 'monospace' }).setDepth(12)
    this.add.text(94, LANE_Y.P2 - 50, 'P2 NORMAL', { fontSize: '11px', color: '#93c5fd', fontFamily: 'monospace' }).setDepth(12)
    this.add.text(94, LANE_Y.P3 - 50, 'P3 LOW', { fontSize: '11px', color: '#cbd5e1', fontFamily: 'monospace' }).setDepth(12)
  }

  drawServiceLabels() {
    this.add.text(115, 120, 'ALGORA · Inbound Tagging', { fontSize: '14px', color: '#86efac', fontFamily: 'monospace' })
    this.add.text(W / 2 - 120, 120, 'AO · Routing Discussion', { fontSize: '14px', color: '#fcd34d', fontFamily: 'monospace' })
    this.add.text(W - 350, 120, 'BRIDGE · Dispatch Bay', { fontSize: '14px', color: '#93c5fd', fontFamily: 'monospace' })
  }

  drawAOBranchHints() {
    this.add.line(0, 760, LANE_Y.P1, 980, ROUTE_Y['Immediate Action'], COLOR.ao, 0.35).setOrigin(0, 0).setLineWidth(2, 2)
    this.add.line(0, 760, LANE_Y.P2, 980, ROUTE_Y.Monitor, COLOR.ao, 0.35).setOrigin(0, 0).setLineWidth(2, 2)
    this.add.line(0, 760, LANE_Y.P3, 980, ROUTE_Y.Defer, COLOR.ao, 0.35).setOrigin(0, 0).setLineWidth(2, 2)

    this.add.text(1010, 187, 'Immediate Action', { color: '#fde68a', fontSize: '11px', fontFamily: 'monospace' })
    this.add.text(1010, 347, 'Monitor', { color: '#fde68a', fontSize: '11px', fontFamily: 'monospace' })
    this.add.text(1010, 507, 'Defer', { color: '#fde68a', fontSize: '11px', fontFamily: 'monospace' })
  }

  spawnAgents() {
    const make = (key: string, x: number, y: number) => this.add.sprite(x, y, `${key}-0`).setDepth(40).setDisplaySize(44, 44)

    this.algoraBots.push(make('algora-bot', 150, 170), make('algora-bot', 220, 170))
    this.aoBots.push(make('ao-bot', 650, 165), make('ao-bot', 720, 165), make('ao-bot', 790, 165))
    this.bridgeBots.push(make('bridge-bot', 1210, 170), make('bridge-bot', 1280, 170))
  }

  buildTruck() {
    this.truckLayer.clear()
    this.truckLayer.fillStyle(0x111827, 0.95)
    this.truckLayer.fillRoundedRect(1210, 300, 190, 170, 14)
    this.truckLayer.lineStyle(3, COLOR.bridge, 0.9)
    this.truckLayer.strokeRoundedRect(1210, 300, 190, 170, 14)

    this.truckLayer.fillStyle(0x1f2937, 1)
    this.truckLayer.fillRoundedRect(1222, 335, 166, 100, 8)
    this.add.text(1260, 313, 'DISPATCH SHUTTLE', { color: '#bfdbfe', fontSize: '11px', fontFamily: 'monospace' }).setDepth(36)

    this.cargoSlots = []
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 3; c++) {
        const x = 1248 + c * 46
        const y = 360 + r * 44
        this.cargoSlots.push(new Phaser.Math.Vector2(x, y))
        this.truckLayer.lineStyle(1, 0x475569, 0.6)
        this.truckLayer.strokeRoundedRect(x - 16, y - 12, 32, 24, 4)
      }
    }

    this.truckCountText = this.add.text(1258, 448, 'Loaded: 0', { color: '#93c5fd', fontSize: '11px', fontFamily: 'monospace' }).setDepth(36)
  }

  updateAgentAnim() {
    const frame = Math.floor(this.time.now / 420) % 2
    const set = (arr: Phaser.GameObjects.Sprite[], key: string) => arr.forEach((s) => s.setTexture(`${key}-${frame}`))
    set(this.algoraBots, 'algora-bot')
    set(this.aoBots, 'ao-bot')
    set(this.bridgeBots, 'bridge-bot')
  }

  spawnBox() {
    const riskPool: Array<Box['risk']> = ['high', 'medium', 'low']
    const sourcePool = ['github', 'rss', 'social', 'chain']
    const categoryPool = ['ai', 'dev', 'security', 'crypto']

    const risk = riskPool[Phaser.Math.Between(0, riskPool.length - 1)]
    const priority: Priority = risk === 'high' ? 'P1' : risk === 'medium' ? 'P2' : 'P3'

    const id = `BX-${String(this.nextId++).padStart(4, '0')}`
    const x = 120
    const y = LANE_Y[priority]

    const sprite = this.add.image(x, y, 'parcel').setDepth(30).setDisplaySize(54, 38)
    sprite.setInteractive({ cursor: 'pointer' })

    const tag = this.add
      .text(x, y - 25, id, {
        color: '#e2e8f0',
        fontFamily: 'monospace',
        fontSize: '10px',
        backgroundColor: '#0f172acc',
        padding: { x: 4, y: 2 },
      })
      .setOrigin(0.5)
      .setDepth(31)

    this.boxes.push({
      id,
      source: sourcePool[Phaser.Math.Between(0, sourcePool.length - 1)],
      category: categoryPool[Phaser.Math.Between(0, categoryPool.length - 1)],
      risk,
      priority,
      phase: 'algora',
      status: 'tagged',
      x,
      y,
      speed: Phaser.Math.FloatBetween(62, 85),
      waitMs: Phaser.Math.Between(280, 900),
      sprite,
      tag,
    })
  }

  moveBox(b: Box, amount: number) {
    if (b.phase === 'algora') {
      b.x += amount
      if (b.x >= 690) {
        b.phase = 'ao'
        b.status = 'under debate'
        b.waitMs = Phaser.Math.Between(700, 1300)
      }
      return
    }

    if (b.phase === 'ao') {
      if (!b.route) {
        b.route = this.decideRoute(b)
        b.status = `routed: ${b.route}`
      }
      b.y = Phaser.Math.Linear(b.y, ROUTE_Y[b.route], 0.08)
      b.x += amount * 1.08

      if (b.x >= 1110) {
        b.phase = 'bridge'
        b.status = 'loading'
      }
      return
    }

    // bridge
    const slot = this.cargoSlots[this.loadedCount % this.cargoSlots.length]
    if (b.x < slot.x - 4) {
      b.x += amount * 1.1
      b.status = 'loading'
    } else {
      b.y = Phaser.Math.Linear(b.y, slot.y, 0.22)
      b.x = Phaser.Math.Linear(b.x, slot.x, 0.22)
      b.status = 'loaded'
      if (Phaser.Math.Distance.Between(b.x, b.y, slot.x, slot.y) < 2) {
        this.loadedCount += 1
        this.truckCountText.setText(`Loaded: ${this.loadedCount}`)
        b.sprite.destroy()
        b.tag.destroy()
        this.boxes = this.boxes.filter((x) => x !== b)
      }
    }
  }

  decideRoute(b: Box): Route {
    if (b.priority === 'P1') return 'Immediate Action'
    if (b.priority === 'P2') return Math.random() > 0.52 ? 'Monitor' : 'Immediate Action'
    return Math.random() > 0.56 ? 'Defer' : 'Monitor'
  }

  drawFlowFX() {
    this.fxLayer.clear()
    this.fxLayer.lineStyle(2, COLOR.ao, 0.25)
    for (const b of this.boxes) {
      if (b.phase === 'ao' || b.phase === 'bridge') this.fxLayer.lineBetween(760, LANE_Y[b.priority], b.x, b.y)
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
      <div class="row"><span>적재 완료</span><b>${this.loadedCount}</b></div>
      <div class="row"><span>활성 박스</span><b>${this.boxes.length}</b></div>
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
      <div class="drow"><span>AO route</span><b>${b.route ?? '-'}</b></div>
      <p class="hint">Algora가 태그 부착 → AO가 분기 라우팅 → Bridge가 셔틀에 적재하여 출고합니다.</p>
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
