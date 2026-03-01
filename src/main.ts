import './style.css'
import Phaser from 'phaser'

type Role = 'AO' | 'Bridge' | 'Algora' | 'Ops'
type Mood = 'focus' | 'chat' | 'debug' | 'shipping'

type Agent = {
  id: number
  role: Role
  mood: Mood
  sprite: Phaser.GameObjects.Sprite
  shadow: Phaser.GameObjects.Ellipse
  label: Phaser.GameObjects.Text
  x: number
  y: number
  path: { x: number; y: number }[]
  speed: number
  pause: number
  targetName: string
}

const TILE = 28
const W = 34
const H = 20

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
  <div class="layout">
    <aside class="panel">
      <h1>Pixel Agent Lab · Art Demo</h1>
      <p class="sub">pixel-agents 스타일 참고 · 맵/오브젝트/캐릭터 비주얼 중심</p>

      <div class="group">
        <h2>Scene Direction</h2>
        <label>에이전트 밀도 <input id="density" type="range" min="8" max="80" value="32" /></label>
        <label>시뮬레이션 속도 <input id="speed" type="range" min="0.5" max="2.5" value="1.1" step="0.1" /></label>
        <label><input id="showLabels" type="checkbox" checked /> 에이전트 라벨</label>
        <label><input id="showRoutes" type="checkbox" checked /> 이동 라우트 미리보기</label>
        <label><input id="chaos" type="checkbox" /> Rush Hour 모드</label>
      </div>

      <div class="group">
        <h2>Creative UI / UX</h2>
        <ul>
          <li>역할별 에이전트 색상 + 아이콘 라벨</li>
          <li>커피머신/화이트보드/박스존으로 목적지 흐름</li>
          <li>가끔 뜨는 "상태 버블"로 살아있는 느낌</li>
          <li>우측 라이브 패널: 지금 가장 바쁜 팀 + 분위기</li>
        </ul>
      </div>

      <div id="stats" class="stats"></div>
      <div id="feed" class="feed"></div>
    </aside>

    <main class="stage-wrap">
      <div id="stage"></div>
      <div class="overlay" id="overlay"></div>
    </main>
  </div>
`

const statsEl = document.querySelector<HTMLDivElement>('#stats')!
const feedEl = document.querySelector<HTMLDivElement>('#feed')!
const overlayEl = document.querySelector<HTMLDivElement>('#overlay')!

class OfficeScene extends Phaser.Scene {
  blocked: boolean[][] = []
  floorSpots: { x: number; y: number; name: string }[] = []
  agents: Agent[] = []
  nextId = 1

  routesLayer!: Phaser.GameObjects.Graphics
  worldLayer!: Phaser.GameObjects.Container

  simSpeed = 1.1
  showLabels = true
  showRoutes = true
  chaos = false

  get desiredAgents() {
    return Number((document.querySelector('#density') as HTMLInputElement).value)
  }

  create() {
    this.blocked = Array.from({ length: H }, () => Array.from({ length: W }, () => false))
    this.worldLayer = this.add.container(0, 0)
    this.routesLayer = this.add.graphics().setDepth(2000)

    this.buildTextures()
    this.buildFloorAndWalls()
    this.buildOfficeProps()

    for (let i = 0; i < this.desiredAgents; i++) this.spawnAgent()

    this.input.on('wheel', (_p: Phaser.Input.Pointer, _go: any, _dx: number, dy: number) => {
      this.cameras.main.zoom = Phaser.Math.Clamp(this.cameras.main.zoom - dy * 0.001, 0.7, 2)
    })

    this.time.addEvent({
      delay: 1500,
      loop: true,
      callback: () => this.randomBubble(),
    })

    this.refreshOverlay()
  }

  update(_t: number, dt: number) {
    this.simSpeed = Number((document.querySelector('#speed') as HTMLInputElement).value)
    this.showLabels = (document.querySelector('#showLabels') as HTMLInputElement).checked
    this.showRoutes = (document.querySelector('#showRoutes') as HTMLInputElement).checked
    this.chaos = (document.querySelector('#chaos') as HTMLInputElement).checked

    this.balanceAgentCount()

    const stepBase = (dt / 1000) * this.simSpeed * (this.chaos ? 1.8 : 1)
    for (const a of this.agents) {
      a.label.setVisible(this.showLabels)

      if (a.pause > 0) {
        a.pause -= dt
      } else {
        if (a.path.length === 0) this.pickNextPath(a)
        this.stepAgent(a, stepBase)
      }

      a.label.setPosition(a.sprite.x, a.sprite.y - 22)
      a.shadow.setPosition(a.sprite.x, a.sprite.y + 10)
    }

    this.drawRoutes()
    this.drawStats()
    this.refreshOverlay()
  }

  buildTextures() {
    const p = this.textures

    p.generate('tile-floor', {
      pixelWidth: 2,
      data: ['aaaaaaaaaaaaaa', 'abbbbbbbbbbbba', 'abccccccccccba', 'abccccccccccba', 'abccccccccccba', 'abccccccccccba', 'abbbbbbbbbbbba', 'aaaaaaaaaaaaaa'],
      palette: { a: '#d6dee7', b: '#c7d0da', c: '#e3eaf1' } as any,
    })

    p.generate('tile-wall', {
      pixelWidth: 2,
      data: ['aaaaaaaaaaaaaa', 'abbbbbbbbbbbba', 'abccccccccccba', 'abccccccccccba', 'abccccccccccba', 'abbbbbbbbbbbba', 'adddddddddddda', 'aaaaaaaaaaaaaa'],
      palette: { a: '#4b5563', b: '#374151', c: '#6b7280', d: '#1f2937' } as any,
    })

    p.generate('desk', {
      pixelWidth: 2,
      data: ['................', '.aaaaaaaaaaaaaa.', '.abbbbbbbbbbbb a', '.abccccccccccba.', '.abccccccccccba.', '.abbbbbbbbbbbb a', '.d............d.', '.d............d.'],
      palette: { a: '#8b6b45', b: '#c49b63', c: '#e2bf86', d: '#4a3322', '.': '#00000000' } as any,
    })

    p.generate('chair', {
      pixelWidth: 2,
      data: ['......', '.aaaa.', '.abca.', '.abca.', '.dddd.', '..ee..'],
      palette: { a: '#8b6b45', b: '#d6b07d', c: '#c59a61', d: '#6b4a2c', e: '#3b2a1c', '.': '#00000000' } as any,
    })

    p.generate('plant', {
      pixelWidth: 2,
      data: ['....aa....', '...abca...', '..abccca..', '..abccca..', '....dd....', '...deed...'],
      palette: { a: '#3f9f4a', b: '#62c65e', c: '#2f7f39', d: '#8b6b45', e: '#a77f55', '.': '#00000000' } as any,
    })

    p.generate('box', {
      pixelWidth: 2,
      data: ['aaaaaaaa', 'abbbbbba', 'abccccba', 'abbbbbba', 'adddddd a'],
      palette: { a: '#7c5630', b: '#d9af76', c: '#c9995e', d: '#5a3c22', ' ': '#00000000' } as any,
    })

    p.generate('monitor', {
      pixelWidth: 2,
      data: ['aaaaaaaa', 'abbbbbba', 'abccccba', 'abbbbbba', '..dddd..'],
      palette: { a: '#475569', b: '#cbd5e1', c: '#60a5fa', d: '#334155', '.': '#00000000' } as any,
    })

    p.generate('coffee', {
      pixelWidth: 2,
      data: ['..aa..', '.abca.', '.abca.', '..dd..'],
      palette: { a: '#ffffff', b: '#d6d3d1', c: '#8b5e34', d: '#64748b', '.': '#00000000' } as any,
    })

    const rolePalettes: Record<Role, { skin: string; hair: string; cloth: string; cloth2: string }> = {
      AO: { skin: '#f4c08f', hair: '#2b2a29', cloth: '#4f46e5', cloth2: '#312e81' },
      Bridge: { skin: '#f1bb86', hair: '#5b351e', cloth: '#059669', cloth2: '#065f46' },
      Algora: { skin: '#f4c59c', hair: '#3f3f46', cloth: '#dc2626', cloth2: '#7f1d1d' },
      Ops: { skin: '#f0b888', hair: '#1f2937', cloth: '#0284c7', cloth2: '#0c4a6e' },
    }

    for (const role of Object.keys(rolePalettes) as Role[]) {
      const pal = rolePalettes[role]
      for (let f = 0; f < 3; f++) {
        const legs = f === 1 ? ['...gg...', '..g..g..'] : ['..g..g..', '...gg...']
        p.generate(`agent-${role}-${f}`, {
          pixelWidth: 2,
          data: ['..hhhh..', '.hshshh.', '.hssssh.', '..cccc..', '..cccc..', legs[0], legs[1]],
          palette: { h: pal.hair, s: pal.skin, c: pal.cloth, g: pal.cloth2, '.': '#00000000' } as any,
        })
      }
    }
  }

  buildFloorAndWalls() {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const floor = this.add.image(x * TILE + TILE / 2, y * TILE + TILE / 2, 'tile-floor').setOrigin(0.5)
        floor.setDisplaySize(TILE, TILE)
        floor.setDepth(y * 10)
        this.worldLayer.add(floor)

        if (x === 0 || y === 0 || x === W - 1 || y === H - 1) {
          const wall = this.add.image(x * TILE + TILE / 2, y * TILE + TILE / 2, 'tile-wall').setOrigin(0.5)
          wall.setDisplaySize(TILE, TILE)
          wall.setDepth(y * 10 + 2)
          this.worldLayer.add(wall)
          this.blocked[y][x] = true
        }
      }
    }
  }

  placeProp(key: string, tx: number, ty: number, w = 1, h = 1, block = true) {
    const image = this.add.image(tx * TILE + TILE / 2, ty * TILE + TILE / 2, key)
    image.setDisplaySize(w * TILE, h * TILE)
    image.setDepth(ty * 10 + 6)
    this.worldLayer.add(image)

    if (block) {
      for (let y = ty; y < ty + h; y++) for (let x = tx; x < tx + w; x++) if (this.blocked[y]?.[x] !== undefined) this.blocked[y][x] = true
    }
  }

  buildOfficeProps() {
    const deskRows = [4, 8, 12]
    const deskCols = [5, 12, 19, 26]

    for (const y of deskRows) {
      for (const x of deskCols) {
        this.placeProp('desk', x, y, 2, 1, true)
        this.placeProp('monitor', x, y, 1, 1, false)
        this.placeProp('coffee', x + 1, y, 1, 1, false)
        this.placeProp('chair', x, y + 1, 1, 1, false)
        this.floorSpots.push({ x, y: y + 2, name: 'Seat' })
      }
    }

    this.placeProp('plant', 30, 3, 1, 1, false)
    this.placeProp('plant', 30, 14, 1, 1, false)

    const boxSpot = [
      [28, 15],
      [29, 15],
      [30, 16],
      [27, 16],
      [28, 17],
    ]
    boxSpot.forEach(([x, y]) => this.placeProp('box', x, y, 1, 1, true))

    this.floorSpots.push(
      { x: 3, y: 3, name: 'Meeting Board' },
      { x: 16, y: 2, name: 'Signal Analyzer' },
      { x: 31, y: 6, name: 'Coffee Machine' },
      { x: 25, y: 17, name: 'Bridge Recorder' },
      { x: 7, y: 17, name: 'Ops Review' },
    )
  }

  spawnAgent() {
    const rolePool: Role[] = ['AO', 'Bridge', 'Algora', 'Ops']
    const moods: Mood[] = ['focus', 'chat', 'debug', 'shipping']
    const role = rolePool[Phaser.Math.Between(0, rolePool.length - 1)]
    const mood = moods[Phaser.Math.Between(0, moods.length - 1)]
    const start = this.randomWalkable()

    const shadow = this.add.ellipse(0, 0, 14, 6, 0x000000, 0.25).setDepth(900)
    const sprite = this.add.sprite(0, 0, `agent-${role}-0`).setDepth(910)
    sprite.setDisplaySize(20, 20)

    const label = this.add
      .text(0, 0, role, {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#e2e8f0',
        backgroundColor: '#0f172acc',
        padding: { x: 4, y: 2 },
      })
      .setOrigin(0.5)
      .setDepth(1000)

    const a: Agent = {
      id: this.nextId++,
      role,
      mood,
      sprite,
      shadow,
      label,
      x: start.x,
      y: start.y,
      path: [],
      speed: Phaser.Math.FloatBetween(2.3, 3.5),
      pause: Phaser.Math.Between(200, 1500),
      targetName: 'Idle',
    }

    this.placeAgent(a)
    this.pickNextPath(a)
    this.agents.push(a)
    this.feed(`${role} #${a.id} joined`) 
  }

  removeAgent() {
    const a = this.agents.pop()
    if (!a) return
    a.sprite.destroy()
    a.label.destroy()
    a.shadow.destroy()
    this.feed(`${a.role} #${a.id} left`)
  }

  placeAgent(a: Agent) {
    a.sprite.x = a.x * TILE + TILE / 2
    a.sprite.y = a.y * TILE + TILE / 2
    a.shadow.x = a.sprite.x
    a.shadow.y = a.sprite.y + 10
    a.label.x = a.sprite.x
    a.label.y = a.sprite.y - 22
  }

  stepAgent(a: Agent, amount: number) {
    if (!a.path.length) return
    const next = a.path[0]
    const dx = next.x - a.x
    const dy = next.y - a.y
    const len = Math.hypot(dx, dy) || 1

    if (len <= amount) {
      a.x = next.x
      a.y = next.y
      a.path.shift()
      if (a.path.length === 0) a.pause = Phaser.Math.Between(300, 2200)
    } else {
      a.x += (dx / len) * amount
      a.y += (dy / len) * amount
    }

    const frame = Math.floor(this.time.now / 150) % 3
    a.sprite.setTexture(`agent-${a.role}-${frame}`)
    this.placeAgent(a)
  }

  pickNextPath(a: Agent) {
    const t = this.floorSpots[Phaser.Math.Between(0, this.floorSpots.length - 1)]
    const from = { x: Math.round(a.x), y: Math.round(a.y) }
    const path = findPath(this.blocked, from, { x: t.x, y: t.y })
    if (path.length) {
      a.path = path
      a.targetName = t.name
    }
  }

  randomWalkable() {
    for (let i = 0; i < 300; i++) {
      const x = Phaser.Math.Between(1, W - 2)
      const y = Phaser.Math.Between(1, H - 2)
      if (!this.blocked[y][x]) return { x, y }
    }
    return { x: 2, y: 2 }
  }

  drawRoutes() {
    this.routesLayer.clear()
    if (!this.showRoutes) return

    this.routesLayer.lineStyle(1, 0x38bdf8, 0.45)
    for (const a of this.agents) {
      if (!a.path.length) continue
      this.routesLayer.beginPath()
      this.routesLayer.moveTo(a.sprite.x, a.sprite.y)
      for (const p of a.path) this.routesLayer.lineTo(p.x * TILE + TILE / 2, p.y * TILE + TILE / 2)
      this.routesLayer.strokePath()
    }
  }

  drawStats() {
    const countByRole: Record<Role, number> = { AO: 0, Bridge: 0, Algora: 0, Ops: 0 }
    this.agents.forEach((a) => (countByRole[a.role] += 1))

    const busiest = Object.entries(countByRole).sort((a, b) => b[1] - a[1])[0]
    const moving = this.agents.filter((a) => a.path.length > 0).length

    statsEl.innerHTML = `
      <div>Agents: <b>${this.agents.length}</b></div>
      <div>Moving: <b>${moving}</b></div>
      <div>Busiest team: <b>${busiest[0]} (${busiest[1]})</b></div>
      <div>Rush Hour: <b>${this.chaos ? 'ON' : 'OFF'}</b></div>
      <div>Zoom: <b>${this.cameras.main.zoom.toFixed(2)}x</b></div>
    `
  }

  randomBubble() {
    if (!this.agents.length) return
    const words = ['sync', 'compile', 'route', 'ship', 'monitor', 'debug', 'meeting']
    const a = this.agents[Phaser.Math.Between(0, this.agents.length - 1)]
    const text = this.add
      .text(a.sprite.x, a.sprite.y - 34, words[Phaser.Math.Between(0, words.length - 1)], {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: '#0f172a',
        backgroundColor: '#f8fafc',
        padding: { x: 4, y: 2 },
      })
      .setOrigin(0.5)
      .setDepth(1200)

    this.tweens.add({
      targets: text,
      y: text.y - 8,
      alpha: 0,
      duration: 1300,
      onComplete: () => text.destroy(),
    })
  }

  feed(msg: string) {
    const row = document.createElement('div')
    row.textContent = `${new Date().toLocaleTimeString()} · ${msg}`
    feedEl.prepend(row)
    while (feedEl.children.length > 12) feedEl.lastElementChild?.remove()
  }

  balanceAgentCount() {
    while (this.agents.length < this.desiredAgents) this.spawnAgent()
    while (this.agents.length > this.desiredAgents) this.removeAgent()
  }

  refreshOverlay() {
    overlayEl.innerHTML = `
      <div class="badge">Mossland Vision Prototype</div>
      <div class="badge dim">No backend link · Visual only</div>
    `
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

    const neighbors = [
      { x: cur.x + 1, y: cur.y },
      { x: cur.x - 1, y: cur.y },
      { x: cur.x, y: cur.y + 1 },
      { x: cur.x, y: cur.y - 1 },
    ]

    for (const nb of neighbors) {
      if (nb.x < 0 || nb.y < 0 || nb.x >= W || nb.y >= H) continue
      if (blocked[nb.y][nb.x]) continue

      const nk = key(nb.x, nb.y)
      const tentative = (g.get(ck) ?? Infinity) + 1
      if (tentative < (g.get(nk) ?? Infinity)) {
        came.set(nk, ck)
        g.set(nk, tentative)
        open.push({ x: nb.x, y: nb.y, f: tentative + h(nb, goal) })
      }
    }
  }

  return []
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'stage',
  width: W * TILE,
  height: H * TILE,
  pixelArt: true,
  backgroundColor: '#111827',
  scene: [OfficeScene],
})
