import './style.css'
import Phaser from 'phaser'

type Service = 'Algora' | 'AO' | 'Bridge' | 'MossOps'
type AgentState = 'coding' | 'analyzing' | 'routing' | 'syncing' | 'resting' | 'meeting'

type Spot = { x: number; y: number; name: string; service?: Service }

type Agent = {
  id: number
  name: string
  service: Service
  state: AgentState
  sprite: Phaser.GameObjects.Sprite
  shadow: Phaser.GameObjects.Ellipse
  badge: Phaser.GameObjects.Text
  x: number
  y: number
  path: { x: number; y: number }[]
  speed: number
  waitMs: number
  moodSeed: number
  target?: Spot
}

const TILE = 24
const MAP_W = 44
const MAP_H = 24

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
<div class="layout">
  <aside class="panel">
    <h1>Mossland · Pixel Agent Convergence</h1>
    <p class="sub">각 서비스의 에이전트가 <b>Moss Core Exchange</b>로 모여 지식/이벤트를 교환하는 시각화 데모 (연동 없음)</p>

    <div class="group">
      <h2>World Controls</h2>
      <label>Agent Density <input id="density" type="range" min="16" max="120" value="48" /></label>
      <label>Simulation Speed <input id="speed" type="range" min="0.5" max="2.8" step="0.1" value="1.2" /></label>
      <label><input id="showRoute" type="checkbox" checked /> route preview</label>
      <label><input id="showName" type="checkbox" checked /> cute name badges</label>
      <label><input id="showZones" type="checkbox" checked /> service zone tint</label>
      <label><input id="festival" type="checkbox" /> Moss Festival Mode</label>
    </div>

    <div class="group">
      <h2>Why all agents gather here?</h2>
      <ul>
        <li><b>Moss Core Exchange</b>: 서비스별 인사이트를 15분 주기로 공유</li>
        <li><b>Bridge Recorder</b>: 크로스서비스 이벤트를 스냅샷으로 보관</li>
        <li><b>Signal Atrium</b>: 실시간 상태를 서로 확인하고 태스크를 넘김</li>
      </ul>
    </div>

    <div id="stats" class="stats"></div>
    <div id="feed" class="feed"></div>
  </aside>

  <main class="stage-wrap">
    <div id="stage"></div>
    <div id="overlay" class="overlay"></div>
  </main>
</div>
`

const statsEl = document.querySelector<HTMLDivElement>('#stats')!
const feedEl = document.querySelector<HTMLDivElement>('#feed')!
const overlayEl = document.querySelector<HTMLDivElement>('#overlay')!

const NAMES = ['Momo', 'Lumi', 'Pico', 'Nori', 'Mossy', 'Bibi', 'Dori', 'Toto', 'Rami', 'Kkiri']

class MossScene extends Phaser.Scene {
  blocked: boolean[][] = []
  serviceZones: { service: Service; x1: number; y1: number; x2: number; y2: number; color: number }[] = []
  spots: Spot[] = []
  agents: Agent[] = []
  nextId = 1

  world!: Phaser.GameObjects.Container
  routeLayer!: Phaser.GameObjects.Graphics
  zoneLayer!: Phaser.GameObjects.Graphics
  fxLayer!: Phaser.GameObjects.Graphics

  interactions = new Map<string, { ttl: number; text: Phaser.GameObjects.Text; line: Phaser.GameObjects.Graphics }>()

  get desiredCount() {
    return Number((document.querySelector('#density') as HTMLInputElement).value)
  }
  get simSpeed() {
    return Number((document.querySelector('#speed') as HTMLInputElement).value)
  }
  get showRoute() {
    return (document.querySelector('#showRoute') as HTMLInputElement).checked
  }
  get showName() {
    return (document.querySelector('#showName') as HTMLInputElement).checked
  }
  get showZones() {
    return (document.querySelector('#showZones') as HTMLInputElement).checked
  }
  get festivalMode() {
    return (document.querySelector('#festival') as HTMLInputElement).checked
  }

  create() {
    this.blocked = Array.from({ length: MAP_H }, () => Array.from({ length: MAP_W }, () => false))

    this.world = this.add.container(0, 0)
    this.zoneLayer = this.add.graphics().setDepth(200)
    this.routeLayer = this.add.graphics().setDepth(3000)
    this.fxLayer = this.add.graphics().setDepth(3200)

    this.buildTextures()
    this.buildMap()
    this.spawnInitialAgents()

    this.time.addEvent({ delay: 1800, loop: true, callback: () => this.tryInteraction() })
    this.time.addEvent({ delay: 2300, loop: true, callback: () => this.spawnThoughtBubble() })

    this.input.on('wheel', (_: any, __: any, ___: any, dy: number) => {
      this.cameras.main.zoom = Phaser.Math.Clamp(this.cameras.main.zoom - dy * 0.0011, 0.65, 2.2)
    })

    this.refreshOverlay()
  }

  update(_time: number, dt: number) {
    this.balanceAgents()

    const step = (dt / 1000) * this.simSpeed * (this.festivalMode ? 1.5 : 1)

    for (const agent of this.agents) {
      agent.badge.setVisible(this.showName)

      if (agent.waitMs > 0) {
        agent.waitMs -= dt
        agent.state = 'resting'
      } else {
        if (agent.path.length === 0) this.assignTask(agent)
        this.stepAgent(agent, step * agent.speed)
      }

      agent.badge.setPosition(agent.sprite.x, agent.sprite.y - 18)
      agent.shadow.setPosition(agent.sprite.x, agent.sprite.y + 8)
    }

    this.updateInteractions(dt)
    this.drawRoutes()
    this.drawZones()
    this.drawStats()
  }

  buildTextures() {
    const t = this.textures

    t.generate('floor-a', {
      pixelWidth: 2,
      data: ['aaaaaaaaaaaa', 'abbbbbbbbbaa', 'abcccccccbba', 'abcccccccbba', 'abbbbbbbbbaa', 'aaaaaaaaaaaa'],
      palette: { a: '#dce5ef', b: '#c9d5e2', c: '#edf3f9' } as any,
    })
    t.generate('floor-b', {
      pixelWidth: 2,
      data: ['aaaaaaaaaaaa', 'abbbbbbbbbaa', 'abcccccccbba', 'abccbbcccbba', 'abbbbbbbbbaa', 'aaaaaaaaaaaa'],
      palette: { a: '#d8e1ea', b: '#c1cdd9', c: '#e8eef5' } as any,
    })
    t.generate('wall', {
      pixelWidth: 2,
      data: ['aaaaaaaaaaaa', 'abbbbbbbbbba', 'abccccccccba', 'abbbbbbbbbba', 'adddddddddd a', 'aaaaaaaaaaaa'],
      palette: { a: '#4b5563', b: '#374151', c: '#6b7280', d: '#1f2937', ' ': '#00000000' } as any,
    })

    t.generate('desk-wide', {
      pixelWidth: 2,
      data: ['................', '.aaaaaaaaaaaaaa.', '.abbbbbbbbbbbb a', '.abccccccccccba.', '.abccccccccccba.', '.abbbbbbbbbbbb a', '.d............d.', '.d............d.'],
      palette: { a: '#8b6b45', b: '#cda06a', c: '#e5c08b', d: '#4a3322', '.': '#00000000' } as any,
    })

    t.generate('chair-cute', {
      pixelWidth: 2,
      data: ['........', '.aaaaaa.', '.abbcba.', '.abbcba.', '.dddddd.', '..e..e..'],
      palette: { a: '#a67c52', b: '#d2a66d', c: '#be8d58', d: '#6b4a2c', e: '#3a2818', '.': '#00000000' } as any,
    })

    t.generate('monitor', {
      pixelWidth: 2,
      data: ['aaaaaaaa', 'abbbbbba', 'abccccba', 'abbbbbba', '..dddd..'],
      palette: { a: '#334155', b: '#e2e8f0', c: '#60a5fa', d: '#1f2937', '.': '#00000000' } as any,
    })

    t.generate('bookcase', {
      pixelWidth: 2,
      data: ['aaaaaaaaaa', 'abbbbbbbba', 'acddedddca', 'acdeedddca', 'acddddedca', 'abbbbbbbba', 'affffffffa'],
      palette: { a: '#4a3322', b: '#5d3f2a', c: '#7a5234', d: '#a2d2ff', e: '#fca5a5', f: '#2e2117' } as any,
    })

    t.generate('plant', {
      pixelWidth: 2,
      data: ['....aa....', '..aabbba..', '.aabccbaa.', '..aabbba..', '....dd....', '...deed...'],
      palette: { a: '#3a8f46', b: '#55b85d', c: '#2d6f34', d: '#8b6b45', e: '#ab855b', '.': '#00000000' } as any,
    })

    t.generate('server', {
      pixelWidth: 2,
      data: ['aaaaaaaa', 'abbbbbba', 'abcccdba', 'abbbbbba', 'abdddcba', 'abbbbbba'],
      palette: { a: '#111827', b: '#374151', c: '#10b981', d: '#60a5fa' } as any,
    })

    t.generate('coffee', {
      pixelWidth: 2,
      data: ['..aa..', '.abca.', '.abca.', '..dd..'],
      palette: { a: '#ffffff', b: '#d6d3d1', c: '#8b5e34', d: '#64748b', '.': '#00000000' } as any,
    })

    const servicePalette: Record<Service, { hair: string; body: string; trim: string; skin: string }> = {
      Algora: { hair: '#2f2f2f', body: '#dc2626', trim: '#7f1d1d', skin: '#f7c39c' },
      AO: { hair: '#1f2937', body: '#4f46e5', trim: '#312e81', skin: '#f6bf94' },
      Bridge: { hair: '#6b3f22', body: '#059669', trim: '#065f46', skin: '#efb98f' },
      MossOps: { hair: '#334155', body: '#0284c7', trim: '#0c4a6e', skin: '#f2be92' },
    }

    for (const svc of Object.keys(servicePalette) as Service[]) {
      const p = servicePalette[svc]
      for (let frame = 0; frame < 4; frame++) {
        const legA = frame % 2 ? '..tt..tt..' : '...tttt...'
        const legB = frame % 2 ? '...tttt...' : '..tt..tt..'
        const eye = frame === 3 ? '.ee..ee...' : '.ee..ee..'

        t.generate(`chibi-${svc}-${frame}`, {
          pixelWidth: 2,
          data: ['...hhhh...', '..hssss h.', '..hsssssh.', '..hsssssh.', '.bbbbbbbb.', '.bbbbbbbb.', eye, legA, legB],
          palette: { h: p.hair, s: p.skin, b: p.body, t: p.trim, e: '#0f172a', ' ': '#00000000', '.': '#00000000' } as any,
        })
      }
    }
  }

  buildMap() {
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const key = (x + y) % 4 === 0 ? 'floor-b' : 'floor-a'
        const tile = this.add.image(x * TILE + TILE / 2, y * TILE + TILE / 2, key).setDisplaySize(TILE, TILE)
        tile.setDepth(y * 10)
        this.world.add(tile)

        if (x === 0 || y === 0 || x === MAP_W - 1 || y === MAP_H - 1) {
          this.placeProp('wall', x, y, 1, 1, true, y * 10 + 2)
        }
      }
    }

    this.serviceZones = [
      { service: 'Algora', x1: 2, y1: 2, x2: 14, y2: 10, color: 0xef4444 },
      { service: 'AO', x1: 15, y1: 2, x2: 28, y2: 10, color: 0x6366f1 },
      { service: 'Bridge', x1: 29, y1: 2, x2: 41, y2: 10, color: 0x10b981 },
      { service: 'MossOps', x1: 2, y1: 11, x2: 41, y2: 22, color: 0x0ea5e9 },
    ]

    // Decorative upper bookcases
    for (let x = 3; x < 40; x += 6) this.placeProp('bookcase', x, 1, 2, 1, true, 24)

    // Service work islands
    this.createDeskIsland(4, 4, 'Algora')
    this.createDeskIsland(17, 4, 'AO')
    this.createDeskIsland(31, 4, 'Bridge')

    // Shared Exchange area (reason of gathering)
    this.createExchangeHub(19, 14)

    this.placeProp('server', 38, 15, 1, 1, true)
    this.placeProp('server', 39, 15, 1, 1, true)
    this.placeProp('plant', 36, 13, 1, 1, false)
    this.placeProp('plant', 5, 18, 1, 1, false)

    this.spots.push(
      { x: 8, y: 8, name: 'Algora Pattern Desk', service: 'Algora' },
      { x: 21, y: 8, name: 'AO Orchestrator Board', service: 'AO' },
      { x: 34, y: 8, name: 'Bridge Log Terminal', service: 'Bridge' },
      { x: 21, y: 14, name: 'Moss Core Exchange' },
      { x: 24, y: 14, name: 'Signal Atrium' },
      { x: 18, y: 18, name: 'Bridge Recorder' },
      { x: 12, y: 16, name: 'Coffee Sync Point' },
      { x: 30, y: 17, name: 'Ops Coordination Board', service: 'MossOps' },
    )
  }

  createDeskIsland(x: number, y: number, service: Service) {
    this.placeProp('desk-wide', x, y, 2, 1, true)
    this.placeProp('monitor', x, y, 1, 1, false)
    this.placeProp('monitor', x + 1, y, 1, 1, false)
    this.placeProp('chair-cute', x, y + 1, 1, 1, false)
    this.placeProp('chair-cute', x + 1, y + 1, 1, 1, false)
    this.placeProp('coffee', x + 1, y, 1, 1, false)

    this.spots.push({ x, y: y + 2, name: `${service} Seat-A`, service })
    this.spots.push({ x: x + 1, y: y + 2, name: `${service} Seat-B`, service })
  }

  createExchangeHub(cx: number, cy: number) {
    for (let x = cx - 3; x <= cx + 4; x++) {
      this.placeProp('desk-wide', x, cy, 1, 1, false)
    }
    this.placeProp('chair-cute', cx - 1, cy + 1, 1, 1, false)
    this.placeProp('chair-cute', cx + 1, cy + 1, 1, 1, false)
    this.placeProp('chair-cute', cx + 3, cy + 1, 1, 1, false)
    this.placeProp('coffee', cx + 2, cy, 1, 1, false)
    this.placeProp('coffee', cx + 4, cy, 1, 1, false)
  }

  placeProp(key: string, tx: number, ty: number, tw = 1, th = 1, blocked = true, depth?: number) {
    const sprite = this.add.image(tx * TILE + TILE / 2, ty * TILE + TILE / 2, key)
    sprite.setDisplaySize(tw * TILE, th * TILE)
    sprite.setDepth(depth ?? ty * 10 + 6)
    this.world.add(sprite)

    if (blocked) {
      for (let y = ty; y < ty + th; y++) {
        for (let x = tx; x < tx + tw; x++) {
          if (this.blocked[y]?.[x] !== undefined) this.blocked[y][x] = true
        }
      }
    }
  }

  spawnInitialAgents() {
    for (let i = 0; i < this.desiredCount; i++) this.spawnAgent()
  }

  spawnAgent() {
    const services: Service[] = ['Algora', 'AO', 'Bridge', 'MossOps']
    const service = services[Phaser.Math.Between(0, services.length - 1)]
    const start = this.findWalkable()

    const shadow = this.add.ellipse(0, 0, 12, 5, 0x000000, 0.26).setDepth(2200)
    const sprite = this.add.sprite(0, 0, `chibi-${service}-0`).setDepth(2300)
    sprite.setDisplaySize(20, 20)

    const badge = this.add
      .text(0, 0, `${NAMES[Phaser.Math.Between(0, NAMES.length - 1)]}-${this.nextId}`, {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: '#e2e8f0',
        backgroundColor: '#0f172acc',
        padding: { x: 4, y: 2 },
      })
      .setOrigin(0.5)
      .setDepth(2600)

    const agent: Agent = {
      id: this.nextId++,
      name: badge.text,
      service,
      state: 'resting',
      sprite,
      shadow,
      badge,
      x: start.x,
      y: start.y,
      path: [],
      speed: Phaser.Math.FloatBetween(2.2, 3.7),
      waitMs: Phaser.Math.Between(300, 2000),
      moodSeed: Math.random(),
    }

    this.placeAgent(agent)
    this.assignTask(agent)
    this.agents.push(agent)
    this.feed(`${agent.name} joined from ${agent.service}`)
  }

  removeAgent() {
    const a = this.agents.pop()
    if (!a) return
    a.sprite.destroy()
    a.shadow.destroy()
    a.badge.destroy()
    this.feed(`${a.name} signed out`)
  }

  placeAgent(a: Agent) {
    a.sprite.x = a.x * TILE + TILE / 2
    a.sprite.y = a.y * TILE + TILE / 2
    a.shadow.x = a.sprite.x
    a.shadow.y = a.sprite.y + 8
    a.badge.x = a.sprite.x
    a.badge.y = a.sprite.y - 18
  }

  assignTask(a: Agent) {
    const options = this.spots.filter((s) => !s.service || s.service === a.service || Math.random() > 0.6)
    const target = options[Phaser.Math.Between(0, options.length - 1)]
    a.target = target

    const from = { x: Math.round(a.x), y: Math.round(a.y) }
    const path = findPath(this.blocked, from, { x: target.x, y: target.y })
    if (!path.length) {
      a.state = 'resting'
      a.waitMs = 600
      return
    }

    a.path = path
    a.state = inferState(a.service, target.name)
  }

  stepAgent(a: Agent, amount: number) {
    if (!a.path.length) return

    const next = a.path[0]
    const dx = next.x - a.x
    const dy = next.y - a.y
    const dist = Math.hypot(dx, dy) || 1

    if (dist <= amount) {
      a.x = next.x
      a.y = next.y
      a.path.shift()
      if (a.path.length === 0) a.waitMs = Phaser.Math.Between(500, 2400)
    } else {
      a.x += (dx / dist) * amount
      a.y += (dy / dist) * amount
    }

    const frame = Math.floor(this.time.now / 130 + a.moodSeed * 10) % 4
    a.sprite.setTexture(`chibi-${a.service}-${frame}`)
    this.placeAgent(a)
  }

  drawRoutes() {
    this.routeLayer.clear()
    if (!this.showRoute) return

    this.routeLayer.lineStyle(1, this.festivalMode ? 0xf59e0b : 0x38bdf8, 0.45)
    for (const a of this.agents) {
      if (!a.path.length) continue
      this.routeLayer.beginPath()
      this.routeLayer.moveTo(a.sprite.x, a.sprite.y)
      for (const p of a.path) this.routeLayer.lineTo(p.x * TILE + TILE / 2, p.y * TILE + TILE / 2)
      this.routeLayer.strokePath()
    }
  }

  drawZones() {
    this.zoneLayer.clear()
    if (!this.showZones) return

    for (const z of this.serviceZones) {
      this.zoneLayer.fillStyle(z.color, 0.07)
      this.zoneLayer.fillRect(z.x1 * TILE, z.y1 * TILE, (z.x2 - z.x1 + 1) * TILE, (z.y2 - z.y1 + 1) * TILE)
      this.zoneLayer.lineStyle(2, z.color, 0.28)
      this.zoneLayer.strokeRect(z.x1 * TILE, z.y1 * TILE, (z.x2 - z.x1 + 1) * TILE, (z.y2 - z.y1 + 1) * TILE)
    }
  }

  tryInteraction() {
    if (this.agents.length < 2) return

    const a = this.agents[Phaser.Math.Between(0, this.agents.length - 1)]
    const others = this.agents.filter((o) => o.id !== a.id)
    const b = others[Phaser.Math.Between(0, others.length - 1)]

    const d = Phaser.Math.Distance.Between(a.sprite.x, a.sprite.y, b.sprite.x, b.sprite.y)
    if (d > 80) return

    a.waitMs = 850
    b.waitMs = 850
    a.state = 'meeting'
    b.state = 'meeting'

    const k = `${Math.min(a.id, b.id)}-${Math.max(a.id, b.id)}`
    if (this.interactions.has(k)) return

    const line = this.add.graphics().setDepth(3100)
    const text = this.add
      .text((a.sprite.x + b.sprite.x) / 2, (a.sprite.y + b.sprite.y) / 2 - 12, interactionText(a.service, b.service), {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: '#0f172a',
        backgroundColor: '#f8fafc',
        padding: { x: 5, y: 2 },
      })
      .setOrigin(0.5)
      .setDepth(3150)

    this.interactions.set(k, { ttl: 1200, text, line })
    this.feed(`${a.service} ↔ ${b.service} synced at Moss Core Exchange`)
  }

  updateInteractions(dt: number) {
    for (const [k, it] of this.interactions.entries()) {
      const [aId, bId] = k.split('-').map(Number)
      const a = this.agents.find((x) => x.id === aId)
      const b = this.agents.find((x) => x.id === bId)
      if (!a || !b) {
        it.text.destroy()
        it.line.destroy()
        this.interactions.delete(k)
        continue
      }

      it.ttl -= dt
      it.line.clear()
      it.line.lineStyle(2, 0xf59e0b, 0.5)
      it.line.lineBetween(a.sprite.x, a.sprite.y, b.sprite.x, b.sprite.y)
      it.text.setPosition((a.sprite.x + b.sprite.x) / 2, (a.sprite.y + b.sprite.y) / 2 - 12)

      if (it.ttl <= 0) {
        it.text.destroy()
        it.line.destroy()
        this.interactions.delete(k)
      }
    }
  }

  spawnThoughtBubble() {
    if (!this.agents.length) return
    const a = this.agents[Phaser.Math.Between(0, this.agents.length - 1)]
    const msg = stateEmoji(a.state) + ' ' + a.state

    const bubble = this.add
      .text(a.sprite.x, a.sprite.y - 30, msg, {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: '#0f172a',
        backgroundColor: '#ffffff',
        padding: { x: 4, y: 2 },
      })
      .setOrigin(0.5)
      .setDepth(3160)

    this.tweens.add({
      targets: bubble,
      y: bubble.y - 10,
      alpha: 0,
      duration: 1200,
      onComplete: () => bubble.destroy(),
    })
  }

  balanceAgents() {
    while (this.agents.length < this.desiredCount) this.spawnAgent()
    while (this.agents.length > this.desiredCount) this.removeAgent()
  }

  findWalkable() {
    for (let i = 0; i < 400; i++) {
      const x = Phaser.Math.Between(1, MAP_W - 2)
      const y = Phaser.Math.Between(2, MAP_H - 2)
      if (!this.blocked[y][x]) return { x, y }
    }
    return { x: 2, y: 2 }
  }

  drawStats() {
    const byService: Record<Service, number> = { Algora: 0, AO: 0, Bridge: 0, MossOps: 0 }
    const byState: Record<AgentState, number> = {
      coding: 0,
      analyzing: 0,
      routing: 0,
      syncing: 0,
      resting: 0,
      meeting: 0,
    }

    for (const a of this.agents) {
      byService[a.service] += 1
      byState[a.state] += 1
    }

    const busiestService = Object.entries(byService).sort((a, b) => b[1] - a[1])[0]
    const activeInteractions = this.interactions.size

    statsEl.innerHTML = `
      <div>Total agents: <b>${this.agents.length}</b></div>
      <div>Most active service: <b>${busiestService[0]} (${busiestService[1]})</b></div>
      <div>Interactions now: <b>${activeInteractions}</b></div>
      <div>States → coding:${byState.coding}, analyzing:${byState.analyzing}, routing:${byState.routing}, syncing:${byState.syncing}, meeting:${byState.meeting}</div>
      <div>Festival mode: <b>${this.festivalMode ? 'ON' : 'OFF'}</b></div>
    `

    this.refreshOverlay()
  }

  refreshOverlay() {
    overlayEl.innerHTML = `
      <div class="badge">Moss Core Exchange · visual prototype</div>
      <div class="badge dim">No backend connection · scenario only</div>
    `
  }

  feed(msg: string) {
    const row = document.createElement('div')
    row.textContent = `${new Date().toLocaleTimeString()} · ${msg}`
    feedEl.prepend(row)
    while (feedEl.children.length > 14) feedEl.lastElementChild?.remove()
  }
}

function inferState(service: Service, target: string): AgentState {
  if (target.includes('Exchange') || target.includes('Atrium') || target.includes('Recorder')) return 'syncing'
  if (target.includes('Bridge')) return 'routing'
  if (target.includes('AO')) return 'analyzing'
  if (target.includes('Algora')) return 'coding'
  if (service === 'Bridge') return 'routing'
  if (service === 'AO') return 'analyzing'
  if (service === 'Algora') return 'coding'
  return 'syncing'
}

function stateEmoji(state: AgentState) {
  switch (state) {
    case 'coding':
      return '💻'
    case 'analyzing':
      return '🔬'
    case 'routing':
      return '🛰️'
    case 'syncing':
      return '🔁'
    case 'resting':
      return '☕'
    case 'meeting':
      return '🤝'
  }
}

function interactionText(a: Service, b: Service) {
  const combos = [
    `${a} handoff → ${b}`,
    `cross-check: ${a} + ${b}`,
    `${a} insight shared`,
    `${b} route updated`,
  ]
  return combos[Phaser.Math.Between(0, combos.length - 1)]
}

function pkey(x: number, y: number) {
  return `${x},${y}`
}

function heuristic(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
}

function findPath(blocked: boolean[][], start: { x: number; y: number }, goal: { x: number; y: number }) {
  if (start.x === goal.x && start.y === goal.y) return []

  const open: { x: number; y: number; f: number }[] = [{ ...start, f: heuristic(start, goal) }]
  const came = new Map<string, string>()
  const g = new Map<string, number>([[pkey(start.x, start.y), 0]])
  const closed = new Set<string>()

  while (open.length) {
    open.sort((a, b) => a.f - b.f)
    const cur = open.shift()!
    const ck = pkey(cur.x, cur.y)
    if (closed.has(ck)) continue
    closed.add(ck)

    if (cur.x === goal.x && cur.y === goal.y) {
      const path: { x: number; y: number }[] = []
      let c = pkey(goal.x, goal.y)
      while (c !== pkey(start.x, start.y)) {
        const [x, y] = c.split(',').map(Number)
        path.unshift({ x, y })
        c = came.get(c)!
      }
      return path
    }

    const next = [
      { x: cur.x + 1, y: cur.y },
      { x: cur.x - 1, y: cur.y },
      { x: cur.x, y: cur.y + 1 },
      { x: cur.x, y: cur.y - 1 },
    ]

    for (const nb of next) {
      if (nb.x < 0 || nb.y < 0 || nb.x >= MAP_W || nb.y >= MAP_H) continue
      if (blocked[nb.y][nb.x]) continue

      const nk = pkey(nb.x, nb.y)
      const tentative = (g.get(ck) ?? Infinity) + 1
      if (tentative < (g.get(nk) ?? Infinity)) {
        came.set(nk, ck)
        g.set(nk, tentative)
        open.push({ x: nb.x, y: nb.y, f: tentative + heuristic(nb, goal) })
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
  backgroundColor: '#0f172a',
  scene: [MossScene],
})
