import './style.css'
import Phaser from 'phaser'

type Service = 'service1' | 'service2' | 'service3'
type TaskState = 'collecting' | 'reasoning' | 'shipping'

type Agent = {
  id: number
  service: Service
  state: TaskState
  x: number
  y: number
  path: { x: number; y: number }[]
  speed: number
  wait: number
  sprite: Phaser.GameObjects.Sprite
  label: Phaser.GameObjects.Text
  bubble?: Phaser.GameObjects.Text
}

type Zone = {
  service: Service
  x1: number
  y1: number
  x2: number
  y2: number
  title: string
  color: number
  tasks: TaskState[]
}

const TILE = 24
const MAP_W = 40
const MAP_H = 22

const SERVICE_META: Record<Service, { title: string; color: number; bg: string; emoji: string }> = {
  service1: { title: 'SERVICE1 · Data Radar', color: 0x34d399, bg: '#0f3f38', emoji: '📡' },
  service2: { title: 'SERVICE2 · Brain Core', color: 0x60a5fa, bg: '#10263f', emoji: '🧠' },
  service3: { title: 'SERVICE3 · Action Dock', color: 0xf59e0b, bg: '#3f2c12', emoji: '🚀' },
}

const STATE_KO: Record<TaskState, string> = {
  collecting: '신호 수집',
  reasoning: '추론 중',
  shipping: '실행 배포',
}

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
<div class="layout">
  <aside class="panel">
    <h1>🌌 Mossland Space Agents</h1>
    <p class="sub">직관형 데모: 3개 서비스에서 에이전트가 무엇을 하는지 한눈에 보기</p>

    <div class="group">
      <h2>컨트롤</h2>
      <label>에이전트 수 <input id="count" type="range" min="9" max="72" value="30" /></label>
      <label>속도 <input id="speed" type="range" min="0.6" max="2.4" step="0.1" value="1.2" /></label>
      <label><input id="showPath" type="checkbox" checked /> 이동 경로 보기</label>
      <label><input id="showBubble" type="checkbox" checked /> 상태 말풍선 보기</label>
    </div>

    <div class="group legend" id="legend"></div>
    <div class="group" id="summary"></div>
    <div class="group feed" id="feed"></div>
  </aside>

  <main class="stage-wrap">
    <div id="stage"></div>
    <div class="overlay" id="overlay"></div>
  </main>
</div>
`

const legendEl = document.querySelector<HTMLDivElement>('#legend')!
const summaryEl = document.querySelector<HTMLDivElement>('#summary')!
const feedEl = document.querySelector<HTMLDivElement>('#feed')!
const overlayEl = document.querySelector<HTMLDivElement>('#overlay')!

legendEl.innerHTML = `
<h2>서비스 역할</h2>
<div class="legend-item"><span class="dot s1"></span><b>SERVICE1</b> 실시간 신호/로그 수집</div>
<div class="legend-item"><span class="dot s2"></span><b>SERVICE2</b> 수집 데이터 추론/판단</div>
<div class="legend-item"><span class="dot s3"></span><b>SERVICE3</b> 액션 실행/배포/알림</div>
`

class SpaceScene extends Phaser.Scene {
  blocked: boolean[][] = []
  zones: Zone[] = []
  hubs: { x: number; y: number; name: string; service?: Service }[] = []
  agents: Agent[] = []
  nextId = 1

  zoneLayer!: Phaser.GameObjects.Graphics
  routeLayer!: Phaser.GameObjects.Graphics

  get desiredCount() {
    return Number((document.querySelector('#count') as HTMLInputElement).value)
  }
  get speedFactor() {
    return Number((document.querySelector('#speed') as HTMLInputElement).value)
  }
  get showPath() {
    return (document.querySelector('#showPath') as HTMLInputElement).checked
  }
  get showBubble() {
    return (document.querySelector('#showBubble') as HTMLInputElement).checked
  }

  create() {
    this.blocked = Array.from({ length: MAP_H }, () => Array.from({ length: MAP_W }, () => false))

    this.buildTextures()
    this.drawBackground()
    this.buildZones()
    this.buildSpaceProps()

    this.zoneLayer = this.add.graphics().setDepth(800)
    this.routeLayer = this.add.graphics().setDepth(2400)

    this.drawZoneTint()

    for (let i = 0; i < this.desiredCount; i++) this.spawnAgent()

    this.time.addEvent({
      delay: 1700,
      loop: true,
      callback: () => this.showRandomBubble(),
    })

    this.input.on('wheel', (_: any, __: any, ___: any, dy: number) => {
      this.cameras.main.zoom = Phaser.Math.Clamp(this.cameras.main.zoom - dy * 0.001, 0.7, 1.8)
    })

    this.drawOverlay()
  }

  update(_t: number, dt: number) {
    this.balanceCount()

    const step = (dt / 1000) * this.speedFactor

    for (const a of this.agents) {
      if (a.wait > 0) {
        a.wait -= dt
      } else {
        if (!a.path.length) this.assignWork(a)
        this.stepAgent(a, step * a.speed)
      }

      a.label.setPosition(a.sprite.x, a.sprite.y - 17)
      if (a.bubble) a.bubble.setVisible(this.showBubble)
    }

    this.drawPaths()
    this.drawSummary()
  }

  buildTextures() {
    const t = this.textures

    // Space tile
    t.generate('space-tile', {
      pixelWidth: 2,
      data: ['aaaaaaaaaaaa', 'abbbbbbbbbaa', 'abcccccccbba', 'abcccccccbba', 'abbbbbbbbbaa', 'aaaaaaaaaaaa'],
      palette: { a: '#0b1021', b: '#141c34', c: '#0f172a' } as any,
    })

    t.generate('star', {
      pixelWidth: 2,
      data: ['..a..', '.aaa.', 'aaaaa', '.aaa.', '..a..'],
      palette: { a: '#f8fafc', '.': '#00000000' } as any,
    })

    t.generate('panel', {
      pixelWidth: 2,
      data: ['aaaaaaaa', 'abbbbbba', 'abccccba', 'abbbbbba', 'addddd a'],
      palette: { a: '#334155', b: '#94a3b8', c: '#1e293b', d: '#0f172a', ' ': '#00000000' } as any,
    })

    t.generate('antenna', {
      pixelWidth: 2,
      data: ['...a...', '..aba..', '...a...', '...a...', '..ccc..'],
      palette: { a: '#38bdf8', b: '#f8fafc', c: '#475569', '.': '#00000000' } as any,
    })

    // Cute astronaut sprites
    const serviceColors: Record<Service, { accent: string }> = {
      service1: { accent: '#34d399' },
      service2: { accent: '#60a5fa' },
      service3: { accent: '#f59e0b' },
    }

    for (const s of Object.keys(serviceColors) as Service[]) {
      const accent = serviceColors[s].accent

      for (let f = 0; f < 4; f++) {
        const leg1 = f % 2 === 0 ? '..dd..dd..' : '...dddd...'
        const leg2 = f % 2 === 0 ? '...dddd...' : '..dd..dd..'

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
            leg1,
            leg2,
          ],
          palette: {
            w: '#e2e8f0', // suit
            v: '#0f172a', // visor
            a: accent, // chest light
            d: '#94a3b8',
            '.': '#00000000',
          } as any,
        })
      }
    }
  }

  drawBackground() {
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const tile = this.add.image(x * TILE + TILE / 2, y * TILE + TILE / 2, 'space-tile')
        tile.setDisplaySize(TILE, TILE)
        tile.setDepth(0)
      }
    }

    for (let i = 0; i < 60; i++) {
      const sx = Phaser.Math.Between(0, MAP_W * TILE)
      const sy = Phaser.Math.Between(0, MAP_H * TILE)
      const star = this.add.image(sx, sy, 'star').setDepth(2)
      star.setScale(Phaser.Math.FloatBetween(0.35, 0.8))
      star.setAlpha(Phaser.Math.FloatBetween(0.3, 0.9))
    }
  }

  buildZones() {
    this.zones = [
      {
        service: 'service1',
        x1: 2,
        y1: 2,
        x2: 12,
        y2: 18,
        title: 'SERVICE1 · Data Radar',
        color: SERVICE_META.service1.color,
        tasks: ['collecting'],
      },
      {
        service: 'service2',
        x1: 14,
        y1: 2,
        x2: 25,
        y2: 18,
        title: 'SERVICE2 · Brain Core',
        color: SERVICE_META.service2.color,
        tasks: ['reasoning'],
      },
      {
        service: 'service3',
        x1: 27,
        y1: 2,
        x2: 37,
        y2: 18,
        title: 'SERVICE3 · Action Dock',
        color: SERVICE_META.service3.color,
        tasks: ['shipping'],
      },
    ]

    for (const z of this.zones) {
      // title panel
      const panel = this.add.image((z.x1 + 2) * TILE, (z.y1 + 1) * TILE, 'panel').setDepth(900)
      panel.setDisplaySize(120, 24)
      const tx = this.add
        .text((z.x1 + 2) * TILE, (z.y1 + 1) * TILE, z.title, {
          fontFamily: 'monospace',
          fontSize: '11px',
          color: '#e2e8f0',
        })
        .setOrigin(0.5)
        .setDepth(901)

      panel.setAlpha(0.9)
      tx.setAlpha(0.95)
    }
  }

  buildSpaceProps() {
    // simple props + hubs
    const props: Array<{ x: number; y: number; key: string; block?: boolean }> = []

    for (let x = 4; x <= 10; x += 3) props.push({ x, y: 6, key: 'antenna', block: true })
    for (let x = 17; x <= 23; x += 3) props.push({ x, y: 8, key: 'panel', block: true })
    for (let x = 30; x <= 35; x += 2) props.push({ x, y: 10, key: 'panel', block: true })

    for (const p of props) {
      const img = this.add.image(p.x * TILE, p.y * TILE, p.key).setDepth(700)
      img.setDisplaySize(26, 26)
      if (p.block) this.blocked[p.y][p.x] = true
    }

    // Hub spots
    this.hubs.push(
      { x: 5, y: 14, name: 'Raw Signal Pool', service: 'service1' },
      { x: 9, y: 12, name: 'Data Radar', service: 'service1' },
      { x: 18, y: 14, name: 'Context Forge', service: 'service2' },
      { x: 22, y: 12, name: 'Reasoning Chamber', service: 'service2' },
      { x: 31, y: 14, name: 'Action Queue', service: 'service3' },
      { x: 35, y: 12, name: 'Launch Dock', service: 'service3' },
      { x: 20, y: 20, name: 'Orbit Exchange' }
    )
  }

  spawnAgent() {
    const services: Service[] = ['service1', 'service2', 'service3']
    const service = services[Phaser.Math.Between(0, services.length - 1)]

    const pos = this.randomWalkable()

    const sprite = this.add.sprite(0, 0, `astro-${service}-0`).setDepth(2000)
    sprite.setDisplaySize(20, 20)

    const label = this.add
      .text(0, 0, `${SERVICE_META[service].emoji}${this.nextId}`, {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: '#e2e8f0',
        backgroundColor: '#0f172acc',
        padding: { x: 4, y: 2 },
      })
      .setOrigin(0.5)
      .setDepth(2100)

    const agent: Agent = {
      id: this.nextId++,
      service,
      state: 'collecting',
      x: pos.x,
      y: pos.y,
      path: [],
      speed: Phaser.Math.FloatBetween(2.2, 3.5),
      wait: Phaser.Math.Between(300, 1600),
      sprite,
      label,
    }

    this.placeAgent(agent)
    this.assignWork(agent)
    this.agents.push(agent)
    this.feed(`${SERVICE_META[service].title} 에이전트 투입`) 
  }

  assignWork(agent: Agent) {
    const own = this.hubs.filter((h) => h.service === agent.service)
    const cross = this.hubs.filter((h) => !h.service)
    const targetPool = Math.random() > 0.74 ? cross : own
    const target = targetPool[Phaser.Math.Between(0, targetPool.length - 1)]

    const path = findPath(this.blocked, { x: Math.round(agent.x), y: Math.round(agent.y) }, { x: target.x, y: target.y })
    if (!path.length) {
      agent.wait = 500
      return
    }

    agent.path = path

    if (target.service === 'service1') agent.state = 'collecting'
    else if (target.service === 'service2') agent.state = 'reasoning'
    else if (target.service === 'service3') agent.state = 'shipping'
    else {
      // Orbit Exchange means cross-service sync
      agent.state = agent.service === 'service1' ? 'collecting' : agent.service === 'service2' ? 'reasoning' : 'shipping'
      this.feed(`🌠 Orbit Exchange: ${SERVICE_META[agent.service].title} 상태 공유`)
    }
  }

  stepAgent(agent: Agent, amount: number) {
    if (!agent.path.length) return

    const next = agent.path[0]
    const dx = next.x - agent.x
    const dy = next.y - agent.y
    const dist = Math.hypot(dx, dy) || 1

    if (dist <= amount) {
      agent.x = next.x
      agent.y = next.y
      agent.path.shift()
      if (!agent.path.length) agent.wait = Phaser.Math.Between(300, 1800)
    } else {
      agent.x += (dx / dist) * amount
      agent.y += (dy / dist) * amount
    }

    const frame = Math.floor(this.time.now / 130 + agent.id) % 4
    agent.sprite.setTexture(`astro-${agent.service}-${frame}`)
    this.placeAgent(agent)
  }

  placeAgent(agent: Agent) {
    agent.sprite.setPosition(agent.x * TILE, agent.y * TILE)
    agent.label.setPosition(agent.sprite.x, agent.sprite.y - 17)
  }

  showRandomBubble() {
    if (!this.showBubble || !this.agents.length) return

    const a = this.agents[Phaser.Math.Between(0, this.agents.length - 1)]
    a.bubble?.destroy()

    const bubble = this.add
      .text(a.sprite.x, a.sprite.y - 32, `${SERVICE_META[a.service].emoji} ${STATE_KO[a.state]}`, {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: '#0f172a',
        backgroundColor: '#ffffff',
        padding: { x: 4, y: 2 },
      })
      .setOrigin(0.5)
      .setDepth(2200)

    a.bubble = bubble
    this.tweens.add({
      targets: bubble,
      y: bubble.y - 10,
      alpha: 0,
      duration: 1200,
      onComplete: () => {
        bubble.destroy()
        if (a.bubble === bubble) a.bubble = undefined
      },
    })
  }

  drawZoneTint() {
    this.zoneLayer.clear()

    for (const z of this.zones) {
      this.zoneLayer.fillStyle(z.color, 0.12)
      this.zoneLayer.fillRect(z.x1 * TILE, z.y1 * TILE, (z.x2 - z.x1 + 1) * TILE, (z.y2 - z.y1 + 1) * TILE)
      this.zoneLayer.lineStyle(2, z.color, 0.5)
      this.zoneLayer.strokeRect(z.x1 * TILE, z.y1 * TILE, (z.x2 - z.x1 + 1) * TILE, (z.y2 - z.y1 + 1) * TILE)
    }
  }

  drawPaths() {
    this.routeLayer.clear()
    if (!this.showPath) return

    this.routeLayer.lineStyle(1, 0x93c5fd, 0.35)
    for (const a of this.agents) {
      if (!a.path.length) continue
      this.routeLayer.beginPath()
      this.routeLayer.moveTo(a.sprite.x, a.sprite.y)
      for (const p of a.path) this.routeLayer.lineTo(p.x * TILE, p.y * TILE)
      this.routeLayer.strokePath()
    }
  }

  drawSummary() {
    const byService: Record<Service, number> = { service1: 0, service2: 0, service3: 0 }
    const byState: Record<TaskState, number> = { collecting: 0, reasoning: 0, shipping: 0 }

    for (const a of this.agents) {
      byService[a.service] += 1
      byState[a.state] += 1
    }

    summaryEl.innerHTML = `
      <h2>지금 뭐가 이뤄지고 있나</h2>
      <div class="kv"><span>📡 수집(collecting)</span><b>${byState.collecting}</b></div>
      <div class="kv"><span>🧠 추론(reasoning)</span><b>${byState.reasoning}</b></div>
      <div class="kv"><span>🚀 실행(shipping)</span><b>${byState.shipping}</b></div>
      <hr />
      <div class="kv"><span>SERVICE1</span><b>${byService.service1}</b></div>
      <div class="kv"><span>SERVICE2</span><b>${byService.service2}</b></div>
      <div class="kv"><span>SERVICE3</span><b>${byService.service3}</b></div>
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
    a.label.destroy()
    a.bubble?.destroy()
  }

  randomWalkable() {
    for (let i = 0; i < 300; i++) {
      const x = Phaser.Math.Between(1, MAP_W - 2)
      const y = Phaser.Math.Between(1, MAP_H - 2)
      if (!this.blocked[y][x]) return { x, y }
    }
    return { x: 2, y: 2 }
  }

  feed(msg: string) {
    const d = document.createElement('div')
    d.textContent = `${new Date().toLocaleTimeString()} · ${msg}`
    feedEl.prepend(d)
    while (feedEl.children.length > 10) feedEl.lastElementChild?.remove()
  }

  drawOverlay() {
    overlayEl.innerHTML = `
      <div class="badge">Mossland Spaceverse · visual prototype</div>
      <div class="badge dim">연동 없음 · 상태 이해용 데모</div>
    `
  }
}

function k(x: number, y: number) {
  return `${x},${y}`
}

function h(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
}

function findPath(blocked: boolean[][], start: { x: number; y: number }, goal: { x: number; y: number }) {
  if (start.x === goal.x && start.y === goal.y) return []

  const open: { x: number; y: number; f: number }[] = [{ ...start, f: h(start, goal) }]
  const came = new Map<string, string>()
  const g = new Map<string, number>([[k(start.x, start.y), 0]])
  const close = new Set<string>()

  while (open.length) {
    open.sort((a, b) => a.f - b.f)
    const cur = open.shift()!
    const ck = k(cur.x, cur.y)
    if (close.has(ck)) continue
    close.add(ck)

    if (cur.x === goal.x && cur.y === goal.y) {
      const path: { x: number; y: number }[] = []
      let p = k(goal.x, goal.y)
      while (p !== k(start.x, start.y)) {
        const [x, y] = p.split(',').map(Number)
        path.unshift({ x, y })
        p = came.get(p)!
      }
      return path
    }

    const nb = [
      { x: cur.x + 1, y: cur.y },
      { x: cur.x - 1, y: cur.y },
      { x: cur.x, y: cur.y + 1 },
      { x: cur.x, y: cur.y - 1 },
    ]

    for (const n of nb) {
      if (n.x < 0 || n.y < 0 || n.x >= MAP_W || n.y >= MAP_H) continue
      if (blocked[n.y][n.x]) continue

      const nk = k(n.x, n.y)
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
  backgroundColor: '#050a19',
  scene: [SpaceScene],
})
