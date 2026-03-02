import './style.css'
import Phaser from 'phaser'

type Priority = 'P1' | 'P2' | 'P3'
type Route = 'Immediate Action' | 'Monitor' | 'Defer'
type Phase = 'algora' | 'ao' | 'bridge'

type Box = {
  id: string
  title: string
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
  sprite: Phaser.GameObjects.Rectangle
  tag: Phaser.GameObjects.Text
}

const W = 1440
const H = 760
const LANE_Y = { P1: 230, P2: 380, P3: 530 }
const ROUTE_Y: Record<Route, number> = {
  'Immediate Action': 220,
  Monitor: 380,
  Defer: 540,
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
    <div id="detail" class="detail">
      <h2>상세 정보</h2>
      <p>박스를 클릭하면 상세 내용이 표시됩니다.</p>
    </div>
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

  beltLayer!: Phaser.GameObjects.Graphics
  fxLayer!: Phaser.GameObjects.Graphics

  algoraBots: Phaser.GameObjects.Sprite[] = []
  aoBots: Phaser.GameObjects.Sprite[] = []
  bridgeBots: Phaser.GameObjects.Sprite[] = []

  create() {
    this.createTextures()
    this.drawBackground()

    this.beltLayer = this.add.graphics().setDepth(10)
    this.fxLayer = this.add.graphics().setDepth(50)

    this.drawBelts()
    this.drawServiceZones()
    this.spawnAgents()

    this.input.on('gameobjectdown', (_: any, go: any) => {
      const box = this.boxes.find((b) => b.sprite === go)
      if (box) this.showDetail(box)
    })

    this.time.addEvent({
      delay: 400,
      loop: true,
      callback: () => this.updateAgentAnim(),
    })
  }

  update(_: number, dt: number) {
    const speedMul = Number((document.querySelector('#speed') as HTMLInputElement).value)
    const maxBoxes = Number((document.querySelector('#maxBoxes') as HTMLInputElement).value)

    if (this.time.now - this.lastSpawn > 1700 && this.boxes.length < maxBoxes) {
      this.spawnBox()
      this.lastSpawn = this.time.now
    }

    for (const b of this.boxes) {
      if (b.waitMs > 0) {
        b.waitMs -= dt
      } else {
        this.moveBox(b, (dt / 1000) * b.speed * speedMul)
      }
      b.tag.setPosition(b.x, b.y - 24)
      b.sprite.setPosition(b.x, b.y)
    }

    this.boxes = this.boxes.filter((b) => {
      if (b.x > W - 60) {
        b.sprite.destroy()
        b.tag.destroy()
        return false
      }
      return true
    })

    this.drawStats()
    this.drawFlowFX()
  }

  createTextures() {
    this.textures.generate('star', {
      pixelWidth: 2,
      data: ['..a..', '.aaa.', 'aaaaa', '.aaa.', '..a..'],
      palette: { a: '#ffffff', '.': '#00000000' } as any,
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
    makeBot('ao-bot', '#60a5fa')
    makeBot('bridge-bot', '#f59e0b')
  }

  drawBackground() {
    this.add.rectangle(W / 2, H / 2, W, H, 0x060b1b)

    for (let i = 0; i < 130; i++) {
      const s = this.add.image(Phaser.Math.Between(0, W), Phaser.Math.Between(0, H), 'star').setDepth(2)
      s.setScale(Phaser.Math.FloatBetween(0.2, 0.6))
      s.setAlpha(Phaser.Math.FloatBetween(0.2, 0.9))
    }

    this.add.rectangle(180, H / 2, 320, H - 80, 0x0f2d2a, 0.18).setStrokeStyle(2, 0x34d399, 0.35)
    this.add.rectangle(W / 2, H / 2, 460, H - 80, 0x122745, 0.16).setStrokeStyle(2, 0x60a5fa, 0.35)
    this.add.rectangle(W - 190, H / 2, 340, H - 80, 0x3f2a12, 0.16).setStrokeStyle(2, 0xf59e0b, 0.35)
  }

  drawBelts() {
    this.beltLayer.clear()

    const lanes: [Priority, number][] = [
      ['P1', LANE_Y.P1],
      ['P2', LANE_Y.P2],
      ['P3', LANE_Y.P3],
    ]

    lanes.forEach(([p, y]) => {
      const tone = p === 'P1' ? 0x7f1d1d : p === 'P2' ? 0x1e293b : 0x111827
      this.beltLayer.fillStyle(tone, 0.65)
      this.beltLayer.fillRoundedRect(80, y - 26, W - 160, 52, 12)
      this.beltLayer.lineStyle(2, 0x334155, 0.8)
      this.beltLayer.strokeRoundedRect(80, y - 26, W - 160, 52, 12)

      for (let x = 100; x < W - 100; x += 48) {
        this.beltLayer.fillStyle(0x94a3b8, 0.25)
        this.beltLayer.fillRect(x, y - 2, 24, 4)
      }
    })

    this.add.text(92, LANE_Y.P1 - 47, 'P1 URGENT', { fontSize: '11px', color: '#fca5a5', fontFamily: 'monospace' })
    this.add.text(92, LANE_Y.P2 - 47, 'P2 NORMAL', { fontSize: '11px', color: '#93c5fd', fontFamily: 'monospace' })
    this.add.text(92, LANE_Y.P3 - 47, 'P3 LOW', { fontSize: '11px', color: '#cbd5e1', fontFamily: 'monospace' })

    this.add.text(115, 120, 'ALGORA · Inbound Tagging', { fontSize: '14px', color: '#86efac', fontFamily: 'monospace' })
    this.add.text(W / 2 - 140, 120, 'AO · Routing Discussion', { fontSize: '14px', color: '#93c5fd', fontFamily: 'monospace' })
    this.add.text(W - 355, 120, 'BRIDGE · Dispatch Bay', { fontSize: '14px', color: '#fcd34d', fontFamily: 'monospace' })
  }

  drawServiceZones() {
    // AO branch hints
    this.add.line(0, 760, LANE_Y.P1, 980, ROUTE_Y['Immediate Action'], 0x60a5fa, 0.35).setOrigin(0, 0).setLineWidth(2, 2)
    this.add.line(0, 760, LANE_Y.P2, 980, ROUTE_Y.Monitor, 0x60a5fa, 0.35).setOrigin(0, 0).setLineWidth(2, 2)
    this.add.line(0, 760, LANE_Y.P3, 980, ROUTE_Y.Defer, 0x60a5fa, 0.35).setOrigin(0, 0).setLineWidth(2, 2)

    this.add.text(1010, 187, 'Immediate Action', { color: '#bfdbfe', fontSize: '11px', fontFamily: 'monospace' })
    this.add.text(1010, 347, 'Monitor', { color: '#bfdbfe', fontSize: '11px', fontFamily: 'monospace' })
    this.add.text(1010, 507, 'Defer', { color: '#bfdbfe', fontSize: '11px', fontFamily: 'monospace' })
  }

  spawnAgents() {
    const make = (key: string, x: number, y: number) => {
      const s = this.add.sprite(x, y, `${key}-0`).setDepth(40)
      s.setDisplaySize(42, 42)
      return s
    }

    this.algoraBots.push(make('algora-bot', 150, 170), make('algora-bot', 220, 170))
    this.aoBots.push(make('ao-bot', 650, 165), make('ao-bot', 720, 165), make('ao-bot', 790, 165))
    this.bridgeBots.push(make('bridge-bot', 1210, 170), make('bridge-bot', 1280, 170))

    // shuttle
    this.add.rectangle(1320, 380, 170, 120, 0x1f2937, 0.9).setStrokeStyle(2, 0xf59e0b, 0.8)
    this.add.text(1272, 365, 'DISPATCH', { color: '#fbbf24', fontSize: '12px', fontFamily: 'monospace' })
    this.add.text(1262, 388, 'Express / Monitor / Defer', { color: '#cbd5e1', fontSize: '10px', fontFamily: 'monospace' })
  }

  updateAgentAnim() {
    const frame = Math.floor(this.time.now / 400) % 2
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
    const color = priority === 'P1' ? 0xfca5a5 : priority === 'P2' ? 0x93c5fd : 0xcbd5e1

    const sprite = this.add.rectangle(x, y, 46, 30, color, 0.95).setDepth(30).setStrokeStyle(2, 0x0f172a, 0.8)
    sprite.setInteractive({ cursor: 'pointer' })

    const tag = this.add
      .text(x, y - 24, id, {
        color: '#e2e8f0',
        fontFamily: 'monospace',
        fontSize: '10px',
        backgroundColor: '#0f172acc',
        padding: { x: 4, y: 2 },
      })
      .setOrigin(0.5)
      .setDepth(31)

    const box: Box = {
      id,
      title: `Signal event ${id}`,
      source: sourcePool[Phaser.Math.Between(0, sourcePool.length - 1)],
      category: categoryPool[Phaser.Math.Between(0, categoryPool.length - 1)],
      risk,
      priority,
      phase: 'algora',
      status: 'tagged',
      x,
      y,
      speed: Phaser.Math.FloatBetween(60, 85),
      waitMs: Phaser.Math.Between(300, 900),
      sprite,
      tag,
    }

    this.boxes.push(box)
  }

  moveBox(b: Box, amount: number) {
    if (b.phase === 'algora') {
      b.x += amount
      if (b.x >= 690) {
        b.phase = 'ao'
        b.status = 'under debate'
        b.waitMs = Phaser.Math.Between(700, 1400)
      }
    } else if (b.phase === 'ao') {
      if (!b.route) {
        b.route = this.decideRoute(b)
        b.status = `routed: ${b.route}`
      }

      const targetY = ROUTE_Y[b.route]
      b.y = Phaser.Math.Linear(b.y, targetY, 0.08)
      b.x += amount * 1.1

      if (b.x >= 1110) {
        b.phase = 'bridge'
        b.status = 'loading'
      }
    } else {
      b.x += amount * 1.25
      b.status = b.x > 1280 ? 'dispatched' : 'executing'
    }
  }

  decideRoute(b: Box): Route {
    if (b.priority === 'P1') return 'Immediate Action'
    if (b.priority === 'P2') return Math.random() > 0.5 ? 'Monitor' : 'Immediate Action'
    return Math.random() > 0.55 ? 'Defer' : 'Monitor'
  }

  drawFlowFX() {
    this.fxLayer.clear()
    this.fxLayer.lineStyle(2, 0x38bdf8, 0.24)

    for (const b of this.boxes) {
      if (b.phase === 'ao' || b.phase === 'bridge') {
        this.fxLayer.lineBetween(760, LANE_Y[b.priority], b.x, b.y)
      }
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
      <div class="row"><span>총 박스</span><b>${this.boxes.length}</b></div>
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
      <p class="hint">Algora가 태그를 붙이고, AO가 라우팅을 결정하며, Bridge가 출고합니다.</p>
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
