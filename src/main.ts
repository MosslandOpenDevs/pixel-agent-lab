import './style.css'
import Phaser from 'phaser'

type Service = 'algora' | 'ao' | 'bridge'
type State = 'scan' | 'synthesize' | 'handoff' | 'plan' | 'orchestrate' | 'dispatch' | 'execute' | 'monitor' | 'report'

type Hub = { x: number; y: number; name: string; service?: Service; state?: State }

type Agent = {
  id: number
  service: Service
  state: State
  x: number
  y: number
  path: { x: number; y: number }[]
  speed: number
  waitMs: number
  sprite: Phaser.GameObjects.Sprite
  tag: Phaser.GameObjects.Text
  stateIcon: Phaser.GameObjects.Text
  target?: Hub
}

const TILE = 32
const MAP_W = 30
const MAP_H = 17

const SERVICE = {
  algora: {
    title: 'ALGORA',
    subtitle: '신호 탐색 · 트렌드 감지 · 인사이트 생성',
    color: 0x34d399,
    emoji: '🛰️',
    states: ['scan', 'synthesize', 'handoff'] as State[],
  },
  ao: {
    title: 'AGENTIC ORCHESTRATOR',
    subtitle: '목표 분해 · 작업 배치 · 흐름 조율',
    color: 0x60a5fa,
    emoji: '🧠',
    states: ['plan', 'orchestrate', 'dispatch'] as State[],
  },
  bridge: {
    title: 'BRIDGE',
    subtitle: '현실 실행 · 상태 모니터링 · 결과 리포트',
    color: 0xf59e0b,
    emoji: '🚀',
    states: ['execute', 'monitor', 'report'] as State[],
  },
} as const

const STATE_LABEL: Record<State, string> = {
  scan: '스캔',
  synthesize: '요약',
  handoff: '전달',
  plan: '계획',
  orchestrate: '조율',
  dispatch: '배치',
  execute: '실행',
  monitor: '감시',
  report: '보고',
}

const STATE_ICON: Record<State, string> = {
  scan: '🔭',
  synthesize: '✨',
  handoff: '📦',
  plan: '🗺️',
  orchestrate: '🎛️',
  dispatch: '📨',
  execute: '⚙️',
  monitor: '📡',
  report: '📊',
}

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
<div class="layout">
  <aside class="panel">
    <h1>🌌 Mossland Celestial Agentverse</h1>
    <p class="sub">천상계 우주 허브에서 Algora → AO → Bridge가 이어지는 흐름을 직관적으로 보여주는 데모 (연동 없음)</p>

    <div class="group">
      <h2>실행 컨트롤</h2>
      <label>에이전트 수 <input id="count" type="range" min="12" max="72" value="30"/></label>
      <label>속도 <input id="speed" type="range" min="0.6" max="2.2" step="0.1" value="1.1"/></label>
      <label><input id="showRoute" type="checkbox" checked/> 흐름 라인</label>
      <label><input id="showState" type="checkbox" checked/> 상태 아이콘</label>
    </div>

    <div class="group" id="serviceCards"></div>
    <div class="group" id="summary"></div>
    <div class="group feed" id="feed"></div>
  </aside>

  <main class="stage-wrap">
    <div id="stage"></div>
    <div id="overlay" class="overlay"></div>
  </main>
</div>
`

const serviceCardsEl = document.querySelector<HTMLDivElement>('#serviceCards')!
const summaryEl = document.querySelector<HTMLDivElement>('#summary')!
const feedEl = document.querySelector<HTMLDivElement>('#feed')!
const overlayEl = document.querySelector<HTMLDivElement>('#overlay')!

serviceCardsEl.innerHTML = `
<h2>서비스별 핵심 역할</h2>
<div class="card algora"><b>ALGORA</b><small>외부 신호를 모아 의미 있는 인사이트 생성</small></div>
<div class="card ao"><b>AGENTIC ORCHESTRATOR</b><small>인사이트를 목표로 변환하고 에이전트 작업 분배</small></div>
<div class="card bridge"><b>BRIDGE</b><small>실행 후 결과를 측정하고 다시 피드백 전달</small></div>
`

class CelestialScene extends Phaser.Scene {
  blocked: boolean[][] = []
  hubs: Hub[] = []
  agents: Agent[] = []
  nextId = 1

  zoneLayer!: Phaser.GameObjects.Graphics
  routeLayer!: Phaser.GameObjects.Graphics
  packetLayer!: Phaser.GameObjects.Graphics

  get desiredCount() {
    return Number((document.querySelector('#count') as HTMLInputElement).value)
  }
  get speed() {
    return Number((document.querySelector('#speed') as HTMLInputElement).value)
  }
  get showRoute() {
    return (document.querySelector('#showRoute') as HTMLInputElement).checked
  }
  get showState() {
    return (document.querySelector('#showState') as HTMLInputElement).checked
  }

  create() {
    this.blocked = Array.from({ length: MAP_H }, () => Array.from({ length: MAP_W }, () => false))
    this.buildTextures()
    this.drawCosmosBackground()
    this.buildStations()

    this.zoneLayer = this.add.graphics().setDepth(500)
    this.routeLayer = this.add.graphics().setDepth(3000)
    this.packetLayer = this.add.graphics().setDepth(2900)

    this.drawZoneTint()

    for (let i = 0; i < this.desiredCount; i++) this.spawnAgent()

    this.time.addEvent({ delay: 900, loop: true, callback: () => this.spawnPacket() })

    this.input.on('wheel', (_: any, __: any, ___: any, dy: number) => {
      this.cameras.main.zoom = Phaser.Math.Clamp(this.cameras.main.zoom - dy * 0.001, 0.7, 1.4)
    })

    this.updateOverlay()
  }

  update(_t: number, dt: number) {
    this.balanceCount()

    for (const a of this.agents) {
      if (a.waitMs > 0) {
        a.waitMs -= dt
      } else {
        if (a.path.length === 0) this.assignTask(a)
        this.move(a, (dt / 1000) * this.speed * a.speed)
      }

      a.tag.setPosition(a.sprite.x, a.sprite.y + 24)
      a.stateIcon.setVisible(this.showState)
      a.stateIcon.setPosition(a.sprite.x, a.sprite.y - 26)
    }

    this.drawRoutes()
    this.drawSummary()
  }

  buildTextures() {
    const t = this.textures

    t.generate('tile-space', {
      pixelWidth: 2,
      data: ['aaaaaaaaaaaaaa', 'abbbbbbbbbbbba', 'abccccccccccba', 'abccccccccccba', 'abbbbbbbbbbbba', 'aaaaaaaaaaaaaa'],
      palette: { a: '#0a1024', b: '#101a36', c: '#0c1430' } as any,
    })

    t.generate('star', {
      pixelWidth: 2,
      data: ['..a..', '.aaa.', 'aaaaa', '.aaa.', '..a..'],
      palette: { a: '#f8fafc', '.': '#00000000' } as any,
    })

    t.generate('cloud', {
      pixelWidth: 2,
      data: ['....aaaa....', '..aabbbbaa..', '.aabbbbbbaa.', '.aabbbbbbaa.', '..aabbbbaa..', '....aaaa....'],
      palette: { a: '#dbeafe', b: '#bfdbfe', '.': '#00000000' } as any,
    })

    t.generate('console', {
      pixelWidth: 2,
      data: ['aaaaaaaaaa', 'abbbbbbbba', 'abccddccba', 'abbbbbbbba', 'aeeeeeeeea'],
      palette: { a: '#334155', b: '#94a3b8', c: '#0f172a', d: '#38bdf8', e: '#1e293b' } as any,
    })

    // Cute astronaut sprites (bigger and clearer)
    const accents: Record<Service, string> = {
      algora: '#34d399',
      ao: '#60a5fa',
      bridge: '#f59e0b',
    }

    for (const s of Object.keys(accents) as Service[]) {
      for (let f = 0; f < 4; f++) {
        const legA = f % 2 === 0 ? '..dd..dd..' : '...dddd...'
        const legB = f % 2 === 0 ? '...dddd...' : '..dd..dd..'

        t.generate(`astro-${s}-${f}`, {
          pixelWidth: 2,
          data: [
            '...wwww...',
            '..wvvvvw..',
            '..wvvvvw..',
            '..wvvvvw..',
            '.wwwwwwww.',
            '.wwwaawww.',
            '.wwwwwwww.',
            legA,
            legB,
          ],
          palette: {
            w: '#e2e8f0',
            v: '#0f172a',
            a: accents[s],
            d: '#94a3b8',
            '.': '#00000000',
          } as any,
        })
      }
    }
  }

  drawCosmosBackground() {
    // base tiles
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const tile = this.add.image(x * TILE + TILE / 2, y * TILE + TILE / 2, 'tile-space')
        tile.setDisplaySize(TILE, TILE)
        tile.setDepth(0)
      }
    }

    // stars
    for (let i = 0; i < 180; i++) {
      const s = this.add.image(Phaser.Math.Between(0, MAP_W * TILE), Phaser.Math.Between(0, MAP_H * TILE), 'star')
      s.setScale(Phaser.Math.FloatBetween(0.2, 0.8))
      s.setAlpha(Phaser.Math.FloatBetween(0.2, 0.9))
      s.setDepth(5)
      this.tweens.add({ targets: s, alpha: Phaser.Math.FloatBetween(0.3, 1), duration: Phaser.Math.Between(800, 1800), yoyo: true, repeat: -1 })
    }

    // heavenly clouds
    for (let i = 0; i < 12; i++) {
      const c = this.add.image(Phaser.Math.Between(40, MAP_W * TILE - 40), Phaser.Math.Between(30, MAP_H * TILE - 30), 'cloud')
      c.setDisplaySize(90, 48)
      c.setAlpha(0.08)
      c.setDepth(8)
    }
  }

  buildStations() {
    const zones = [
      { service: 'algora' as Service, x1: 1, y1: 2, x2: 9, y2: 14, icon: '🛰️' },
      { service: 'ao' as Service, x1: 10, y1: 2, x2: 19, y2: 14, icon: '🧠' },
      { service: 'bridge' as Service, x1: 20, y1: 2, x2: 28, y2: 14, icon: '🚀' },
    ]

    for (const z of zones) {
      const cx = Math.floor((z.x1 + z.x2) / 2)
      const cy = z.y1 + 1
      const title = this.add
        .text(cx * TILE, cy * TILE, `${z.icon} ${SERVICE[z.service].title}`, {
          fontFamily: 'monospace',
          fontSize: '14px',
          color: '#f8fafc',
          backgroundColor: '#0f172acc',
          padding: { x: 8, y: 4 },
        })
        .setOrigin(0.5)
        .setDepth(900)
      title.setShadow(0, 2, '#000000', 3)

      for (let x = z.x1 + 2; x < z.x2 - 1; x += 3) {
        this.placeConsole(x, z.y1 + 4)
        this.placeConsole(x, z.y1 + 8)
      }

      // hubs by state for each service
      const states = SERVICE[z.service].states
      this.hubs.push(
        { x: z.x1 + 2, y: z.y2 - 1, name: `${SERVICE[z.service].title} ${STATE_LABEL[states[0]]}`, service: z.service, state: states[0] },
        { x: z.x1 + 4, y: z.y2 - 1, name: `${SERVICE[z.service].title} ${STATE_LABEL[states[1]]}`, service: z.service, state: states[1] },
        { x: z.x1 + 6, y: z.y2 - 1, name: `${SERVICE[z.service].title} ${STATE_LABEL[states[2]]}`, service: z.service, state: states[2] },
      )
    }

    // central celestial exchange
    const midX = Math.floor(MAP_W / 2)
    const forum = this.add
      .text(midX * TILE, (MAP_H - 1.5) * TILE, '☁️ CELESTIAL EXCHANGE · 서비스 간 핸드오프 허브', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#e2e8f0',
        backgroundColor: '#1e293bcc',
        padding: { x: 8, y: 4 },
      })
      .setOrigin(0.5)
      .setDepth(1000)

    forum.setShadow(0, 2, '#000', 3)
    this.hubs.push({ x: midX, y: MAP_H - 2, name: 'Celestial Exchange' })
  }

  placeConsole(tx: number, ty: number) {
    const img = this.add.image(tx * TILE, ty * TILE, 'console').setDepth(700)
    img.setDisplaySize(32, 24)
    this.blocked[ty][tx] = true
  }

  drawZoneTint() {
    this.zoneLayer.clear()
    const defs = [
      { x1: 1, y1: 2, x2: 9, y2: 14, color: SERVICE.algora.color },
      { x1: 10, y1: 2, x2: 19, y2: 14, color: SERVICE.ao.color },
      { x1: 20, y1: 2, x2: 28, y2: 14, color: SERVICE.bridge.color },
    ]

    for (const z of defs) {
      this.zoneLayer.fillStyle(z.color, 0.12)
      this.zoneLayer.fillRect(z.x1 * TILE, z.y1 * TILE, (z.x2 - z.x1 + 1) * TILE, (z.y2 - z.y1 + 1) * TILE)
      this.zoneLayer.lineStyle(2, z.color, 0.5)
      this.zoneLayer.strokeRect(z.x1 * TILE, z.y1 * TILE, (z.x2 - z.x1 + 1) * TILE, (z.y2 - z.y1 + 1) * TILE)
    }
  }

  spawnAgent() {
    const services: Service[] = ['algora', 'ao', 'bridge']
    const service = services[Phaser.Math.Between(0, services.length - 1)]
    const start = this.randomWalkable()

    const sprite = this.add.sprite(start.x * TILE, start.y * TILE, `astro-${service}-0`).setDepth(2000)
    sprite.setDisplaySize(34, 34)

    const tag = this.add
      .text(sprite.x, sprite.y + 24, `${SERVICE[service].emoji}A${this.nextId}`, {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#e2e8f0',
        backgroundColor: '#0f172acc',
        padding: { x: 5, y: 2 },
      })
      .setOrigin(0.5)
      .setDepth(2100)

    const stateIcon = this.add
      .text(sprite.x, sprite.y - 26, '🔭', {
        fontFamily: 'sans-serif',
        fontSize: '16px',
      })
      .setOrigin(0.5)
      .setDepth(2101)

    const a: Agent = {
      id: this.nextId++,
      service,
      state: SERVICE[service].states[0],
      x: start.x,
      y: start.y,
      path: [],
      speed: Phaser.Math.FloatBetween(1.9, 3.2),
      waitMs: Phaser.Math.Between(200, 1200),
      sprite,
      tag,
      stateIcon,
    }

    this.agents.push(a)
    this.assignTask(a)
    this.feed(`${SERVICE[a.service].title} 에이전트 활성화`)
  }

  assignTask(a: Agent) {
    const own = this.hubs.filter((h) => h.service === a.service)
    const exchange = this.hubs.filter((h) => !h.service)

    const target = (Math.random() > 0.72 ? exchange : own)[Phaser.Math.Between(0, (Math.random() > 0.72 ? exchange : own).length - 1)]
    a.target = target

    const path = findPath(this.blocked, { x: Math.round(a.x), y: Math.round(a.y) }, { x: target.x, y: target.y })
    if (!path.length) {
      a.waitMs = 500
      return
    }

    a.path = path
    if (target.state) a.state = target.state
    a.stateIcon.setText(STATE_ICON[a.state])
  }

  move(a: Agent, amount: number) {
    if (!a.path.length) return
    const next = a.path[0]
    const dx = next.x - a.x
    const dy = next.y - a.y
    const dist = Math.hypot(dx, dy) || 1

    if (dist <= amount) {
      a.x = next.x
      a.y = next.y
      a.path.shift()
      if (a.path.length === 0) {
        a.waitMs = Phaser.Math.Between(300, 1400)
        if (a.target?.name === 'Celestial Exchange') {
          this.feed(`☁️ ${SERVICE[a.service].title}가 교환 허브에서 핸드오프 완료`)
        }
      }
    } else {
      a.x += (dx / dist) * amount
      a.y += (dy / dist) * amount
    }

    const frame = Math.floor(this.time.now / 140 + a.id) % 4
    a.sprite.setTexture(`astro-${a.service}-${frame}`)
    a.sprite.setPosition(a.x * TILE, a.y * TILE)
  }

  drawRoutes() {
    this.routeLayer.clear()
    if (!this.showRoute) return

    for (const a of this.agents) {
      if (!a.path.length) continue
      const c = SERVICE[a.service].color
      this.routeLayer.lineStyle(2, c, 0.35)
      this.routeLayer.beginPath()
      this.routeLayer.moveTo(a.sprite.x, a.sprite.y)
      for (const p of a.path) this.routeLayer.lineTo(p.x * TILE, p.y * TILE)
      this.routeLayer.strokePath()
    }
  }

  spawnPacket() {
    this.packetLayer.clear()
    const lanes = [
      { from: { x: 8, y: MAP_H - 2 }, to: { x: 14, y: MAP_H - 2 }, color: SERVICE.algora.color },
      { from: { x: 14, y: MAP_H - 2 }, to: { x: 22, y: MAP_H - 2 }, color: SERVICE.ao.color },
      { from: { x: 22, y: MAP_H - 2 }, to: { x: 26, y: MAP_H - 2 }, color: SERVICE.bridge.color },
    ]

    lanes.forEach((l) => {
      this.packetLayer.lineStyle(3, l.color, 0.35)
      this.packetLayer.lineBetween(l.from.x * TILE, l.from.y * TILE, l.to.x * TILE, l.to.y * TILE)

      const dot = this.add.circle(l.from.x * TILE, l.from.y * TILE, 4, l.color, 0.9).setDepth(2950)
      this.tweens.add({
        targets: dot,
        x: l.to.x * TILE,
        duration: 900,
        onComplete: () => dot.destroy(),
      })
    })
  }

  drawSummary() {
    const byService: Record<Service, number> = { algora: 0, ao: 0, bridge: 0 }
    const byState: Record<State, number> = {
      scan: 0,
      synthesize: 0,
      handoff: 0,
      plan: 0,
      orchestrate: 0,
      dispatch: 0,
      execute: 0,
      monitor: 0,
      report: 0,
    }

    for (const a of this.agents) {
      byService[a.service]++
      byState[a.state]++
    }

    summaryEl.innerHTML = `
      <h2>지금 에이전트가 하는 일</h2>
      <div class="kv">🛰️ Algora <b>${byService.algora}</b></div>
      <div class="kv">🧠 AO <b>${byService.ao}</b></div>
      <div class="kv">🚀 Bridge <b>${byService.bridge}</b></div>
      <hr/>
      <div class="kv">🔭 scan <b>${byState.scan}</b></div>
      <div class="kv">✨ synthesize <b>${byState.synthesize}</b></div>
      <div class="kv">🎛️ orchestrate <b>${byState.orchestrate}</b></div>
      <div class="kv">⚙️ execute <b>${byState.execute}</b></div>
      <div class="kv">📊 report <b>${byState.report}</b></div>
    `

    this.updateOverlay()
  }

  updateOverlay() {
    overlayEl.innerHTML = `
      <div class="badge">천상계 플로우: Algora → AO → Bridge</div>
      <div class="badge dim">연동 없음 · 시각화 프로토타입</div>
    `
  }

  balanceCount() {
    while (this.agents.length < this.desiredCount) this.spawnAgent()
    while (this.agents.length > this.desiredCount) this.removeAgent()
  }

  removeAgent() {
    const a = this.agents.pop()
    if (!a) return
    a.sprite.destroy()
    a.tag.destroy()
    a.stateIcon.destroy()
  }

  randomWalkable() {
    for (let i = 0; i < 300; i++) {
      const x = Phaser.Math.Between(1, MAP_W - 2)
      const y = Phaser.Math.Between(2, MAP_H - 2)
      if (!this.blocked[y][x]) return { x, y }
    }
    return { x: 2, y: 2 }
  }

  feed(msg: string) {
    const row = document.createElement('div')
    row.textContent = `${new Date().toLocaleTimeString()} · ${msg}`
    feedEl.prepend(row)
    while (feedEl.children.length > 10) feedEl.lastElementChild?.remove()
  }
}

function key(x: number, y: number) {
  return `${x},${y}`
}

function h(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
}

function findPath(blocked: boolean[][], start: { x: number; y: number }, goal: { x: number; y: number }) {
  if (start.x === goal.x && start.y === goal.y) return []

  const open: { x: number; y: number; f: number }[] = [{ ...start, f: h(start, goal) }]
  const came = new Map<string, string>()
  const g = new Map<string, number>([[key(start.x, start.y), 0]])
  const closed = new Set<string>()

  while (open.length) {
    open.sort((a, b) => a.f - b.f)
    const cur = open.shift()!
    const ck = key(cur.x, cur.y)
    if (closed.has(ck)) continue
    closed.add(ck)

    if (cur.x === goal.x && cur.y === goal.y) {
      const path: { x: number; y: number }[] = []
      let p = key(goal.x, goal.y)
      while (p !== key(start.x, start.y)) {
        const [x, y] = p.split(',').map(Number)
        path.unshift({ x, y })
        p = came.get(p)!
      }
      return path
    }

    const nbs = [
      { x: cur.x + 1, y: cur.y },
      { x: cur.x - 1, y: cur.y },
      { x: cur.x, y: cur.y + 1 },
      { x: cur.x, y: cur.y - 1 },
    ]

    for (const n of nbs) {
      if (n.x < 0 || n.y < 0 || n.x >= MAP_W || n.y >= MAP_H) continue
      if (blocked[n.y][n.x]) continue

      const nk = key(n.x, n.y)
      const tentative = (g.get(ck) ?? Infinity) + 1
      if (tentative < (g.get(nk) ?? Infinity)) {
        came.set(nk, ck)
        g.set(nk, tentative)
        open.push({ x: n.x, y: n.y, f: tentative + h(n, goal) })
      }
    }
  }

  return []
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'stage',
  width: MAP_W * TILE,
  height: MAP_H * TILE,
  pixelArt: true,
  backgroundColor: '#050b1f',
  scene: [CelestialScene],
})
