import './style.css'
import Phaser from 'phaser'

type TileType = 'floor' | 'wall' | 'desk' | 'chair'
type AgentState = 'idle' | 'moving' | 'working'

type Agent = {
  id: number
  color: number
  x: number
  y: number
  sprite: Phaser.GameObjects.Rectangle
  state: AgentState
  path: { x: number; y: number }[]
  speed: number
}

const TILE = 24
const MAP_W = 36
const MAP_H = 22

const COLORS: Record<TileType, number> = {
  floor: 0x1f2937,
  wall: 0x111827,
  desk: 0x8b5cf6,
  chair: 0x06b6d4,
}

const WALKABLE: Record<TileType, boolean> = {
  floor: true,
  wall: false,
  desk: false,
  chair: true,
}

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
  <div class="layout">
    <aside class="panel">
      <h1>Pixel Agent Lab</h1>
      <p class="sub">#1 맵 + 캐릭터 구현 데모 (테스트 기능 포함)</p>

      <div class="group">
        <h2>에디터</h2>
        <div class="tiles">
          <button data-tile="floor" class="active">Floor</button>
          <button data-tile="wall">Wall</button>
          <button data-tile="desk">Desk</button>
          <button data-tile="chair">Chair</button>
        </div>
        <button id="toggle-edit">에디트 모드: ON</button>
      </div>

      <div class="group">
        <h2>시뮬레이션</h2>
        <button id="spawn-agent">에이전트 추가</button>
        <button id="remove-agent">에이전트 제거</button>
        <label>속도
          <input id="speed" type="range" min="0.25" max="3" step="0.25" value="1" />
        </label>
      </div>

      <div class="group">
        <h2>뷰 옵션</h2>
        <label><input id="show-grid" type="checkbox" checked /> 그리드</label>
        <label><input id="show-path" type="checkbox" checked /> 경로</label>
        <label><input id="show-coll" type="checkbox" checked /> 충돌 타일 강조</label>
      </div>

      <div class="group">
        <h2>맵 데이터</h2>
        <button id="save-map">맵 저장(LocalStorage)</button>
        <button id="load-map">맵 불러오기</button>
        <button id="reset-map">초기화</button>
      </div>

      <div class="group">
        <h2>컨트롤</h2>
        <p>WASD 이동 / 클릭 이동 / 마우스휠 줌 / 드래그 팬</p>
      </div>

      <div id="stats" class="stats"></div>
      <div id="log" class="log"></div>
    </aside>

    <main class="stage-wrap">
      <div id="stage"></div>
    </main>
  </div>
`

class DemoScene extends Phaser.Scene {
  map: TileType[][] = []
  selectedTile: TileType = 'floor'
  editMode = true
  showGrid = true
  showPath = true
  showCollision = true
  simSpeed = 1

  mapLayer!: Phaser.GameObjects.Graphics
  pathLayer!: Phaser.GameObjects.Graphics
  cameraDragStart?: Phaser.Math.Vector2

  player = { x: 3, y: 3, path: [] as { x: number; y: number }[], sprite: null as unknown as Phaser.GameObjects.Rectangle }
  agents: Agent[] = []
  nextAgentId = 1

  cursors!: Phaser.Types.Input.Keyboard.CursorKeys
  wasd!: Record<string, Phaser.Input.Keyboard.Key>

  logEl = document.querySelector<HTMLDivElement>('#log')!
  statsEl = document.querySelector<HTMLDivElement>('#stats')!

  constructor() {
    super('demo')
  }

  create() {
    this.createDefaultMap()

    this.mapLayer = this.add.graphics()
    this.pathLayer = this.add.graphics()

    this.player.sprite = this.add.rectangle(0, 0, TILE * 0.75, TILE * 0.75, 0x22c55e)
    this.player.sprite.setDepth(10)

    for (let i = 0; i < 4; i++) this.spawnAgent()

    this.cursors = this.input.keyboard!.createCursorKeys()
    this.wasd = this.input.keyboard!.addKeys('W,A,S,D') as Record<string, Phaser.Input.Keyboard.Key>

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.rightButtonDown()) return
      const world = this.cameras.main.getWorldPoint(p.x, p.y)
      const tx = Math.floor(world.x / TILE)
      const ty = Math.floor(world.y / TILE)
      if (!this.inBounds(tx, ty)) return

      if (this.editMode) {
        this.paint(tx, ty, this.selectedTile)
        return
      }

      if (this.isWalkable(tx, ty)) {
        const path = findPath(this.map, { x: this.player.x, y: this.player.y }, { x: tx, y: ty })
        if (path.length) {
          this.player.path = path
          this.log(`플레이어 경로 설정: (${tx}, ${ty})`)
        }
      }
    })

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.editMode && p.isDown) {
        const world = this.cameras.main.getWorldPoint(p.x, p.y)
        const tx = Math.floor(world.x / TILE)
        const ty = Math.floor(world.y / TILE)
        if (this.inBounds(tx, ty)) this.paint(tx, ty, this.selectedTile)
      }

      if (!this.editMode && p.rightButtonDown()) {
        if (!this.cameraDragStart) this.cameraDragStart = new Phaser.Math.Vector2(p.x, p.y)
        const dx = p.x - this.cameraDragStart.x
        const dy = p.y - this.cameraDragStart.y
        this.cameras.main.scrollX -= dx / this.cameras.main.zoom
        this.cameras.main.scrollY -= dy / this.cameras.main.zoom
        this.cameraDragStart.set(p.x, p.y)
      }
    })

    this.input.on('pointerup', () => (this.cameraDragStart = undefined))
    this.input.on('wheel', (_: any, __: any, ___: number, dy: number) => {
      this.cameras.main.zoom = Phaser.Math.Clamp(this.cameras.main.zoom - dy * 0.001, 0.6, 2.2)
    })

    this.syncUI()
    this.redrawAll()
  }

  update(_: number, delta: number) {
    this.handleManualMove()

    const step = (delta / 1000) * this.simSpeed

    this.followPath(this.player, step * 5)
    for (const agent of this.agents) {
      if (agent.path.length === 0) this.assignAgentTask(agent)
      this.followPath(agent, step * agent.speed)
    }

    this.drawPaths()
    this.drawStats()
  }

  followPath(entity: { x: number; y: number; path: { x: number; y: number }[]; sprite: Phaser.GameObjects.Rectangle }, amount: number) {
    if (!entity.path.length) return
    const target = entity.path[0]
    const dx = target.x - entity.x
    const dy = target.y - entity.y

    if (Math.abs(dx) + Math.abs(dy) <= amount) {
      entity.x = target.x
      entity.y = target.y
      entity.path.shift()
    } else {
      const len = Math.hypot(dx, dy) || 1
      entity.x += (dx / len) * amount
      entity.y += (dy / len) * amount
    }

    entity.sprite.setPosition(entity.x * TILE + TILE / 2, entity.y * TILE + TILE / 2)
  }

  handleManualMove() {
    if (this.editMode) return
    const dirs: { x: number; y: number }[] = []
    if (this.wasd.W.isDown || this.cursors.up.isDown) dirs.push({ x: 0, y: -1 })
    if (this.wasd.S.isDown || this.cursors.down.isDown) dirs.push({ x: 0, y: 1 })
    if (this.wasd.A.isDown || this.cursors.left.isDown) dirs.push({ x: -1, y: 0 })
    if (this.wasd.D.isDown || this.cursors.right.isDown) dirs.push({ x: 1, y: 0 })
    if (!dirs.length || this.player.path.length) return

    const d = dirs[0]
    const tx = Math.round(this.player.x + d.x)
    const ty = Math.round(this.player.y + d.y)
    if (this.isWalkable(tx, ty)) this.player.path = [{ x: tx, y: ty }]
  }

  createDefaultMap() {
    this.map = Array.from({ length: MAP_H }, () => Array.from({ length: MAP_W }, () => 'floor' as TileType))

    for (let y = 0; y < MAP_H; y++) {
      this.map[y][0] = 'wall'
      this.map[y][MAP_W - 1] = 'wall'
    }
    for (let x = 0; x < MAP_W; x++) {
      this.map[0][x] = 'wall'
      this.map[MAP_H - 1][x] = 'wall'
    }

    for (let y = 4; y < MAP_H - 3; y += 5) {
      for (let x = 5; x < MAP_W - 5; x += 6) {
        this.map[y][x] = 'desk'
        this.map[y + 1]?.[x] && (this.map[y + 1][x] = 'chair')
      }
    }
  }

  redrawAll() {
    this.mapLayer.clear()

    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const tile = this.map[y][x]
        this.mapLayer.fillStyle(COLORS[tile], 1)
        this.mapLayer.fillRect(x * TILE, y * TILE, TILE, TILE)

        if (this.showCollision && !WALKABLE[tile]) {
          this.mapLayer.fillStyle(0xef4444, 0.2)
          this.mapLayer.fillRect(x * TILE, y * TILE, TILE, TILE)
        }

        if (this.showGrid) {
          this.mapLayer.lineStyle(1, 0x334155, 0.5)
          this.mapLayer.strokeRect(x * TILE, y * TILE, TILE, TILE)
        }
      }
    }

    this.player.sprite.setPosition(this.player.x * TILE + TILE / 2, this.player.y * TILE + TILE / 2)
    this.drawPaths()
  }

  drawPaths() {
    this.pathLayer.clear()
    if (!this.showPath) return

    const draw = (x: number, y: number, path: { x: number; y: number }[], color: number) => {
      if (!path.length) return
      this.pathLayer.lineStyle(2, color, 0.9)
      this.pathLayer.beginPath()
      this.pathLayer.moveTo(x * TILE + TILE / 2, y * TILE + TILE / 2)
      for (const p of path) this.pathLayer.lineTo(p.x * TILE + TILE / 2, p.y * TILE + TILE / 2)
      this.pathLayer.strokePath()
    }

    draw(this.player.x, this.player.y, this.player.path, 0x22c55e)
    for (const a of this.agents) draw(a.x, a.y, a.path, a.color)
  }

  paint(x: number, y: number, tile: TileType) {
    if (!this.inBounds(x, y)) return
    if (x === 0 || y === 0 || x === MAP_W - 1 || y === MAP_H - 1) return
    this.map[y][x] = tile
    this.redrawAll()
  }

  assignAgentTask(agent: Agent) {
    const target = this.findRandomWalkable()
    const path = findPath(this.map, { x: Math.round(agent.x), y: Math.round(agent.y) }, target)
    if (path.length) {
      agent.path = path
      agent.state = Math.random() > 0.5 ? 'moving' : 'working'
    } else {
      agent.state = 'idle'
    }
  }

  spawnAgent() {
    const pos = this.findRandomWalkable()
    const color = Phaser.Display.Color.RandomRGB(100, 255).color
    const sprite = this.add.rectangle(pos.x * TILE + TILE / 2, pos.y * TILE + TILE / 2, TILE * 0.7, TILE * 0.7, color)
    sprite.setDepth(9)

    this.agents.push({
      id: this.nextAgentId++,
      color,
      x: pos.x,
      y: pos.y,
      sprite,
      state: 'idle',
      path: [],
      speed: Phaser.Math.FloatBetween(1.8, 3.4),
    })

    this.log(`에이전트 생성 #${this.nextAgentId - 1}`)
  }

  removeAgent() {
    const last = this.agents.pop()
    if (!last) return
    last.sprite.destroy()
    this.log(`에이전트 제거 #${last.id}`)
  }

  findRandomWalkable() {
    for (let i = 0; i < 200; i++) {
      const x = Phaser.Math.Between(1, MAP_W - 2)
      const y = Phaser.Math.Between(1, MAP_H - 2)
      if (this.isWalkable(x, y)) return { x, y }
    }
    return { x: 1, y: 1 }
  }

  inBounds(x: number, y: number) {
    return x >= 0 && y >= 0 && x < MAP_W && y < MAP_H
  }

  isWalkable(x: number, y: number) {
    if (!this.inBounds(x, y)) return false
    return WALKABLE[this.map[y][x]]
  }

  log(msg: string) {
    const line = document.createElement('div')
    line.textContent = `${new Date().toLocaleTimeString()} · ${msg}`
    this.logEl.prepend(line)
    while (this.logEl.children.length > 20) this.logEl.lastElementChild?.remove()
  }

  drawStats() {
    const moving = this.agents.filter((a) => a.path.length > 0).length
    this.statsEl.innerHTML = `
      <div>Agents: <b>${this.agents.length}</b></div>
      <div>Moving: <b>${moving}</b></div>
      <div>Player: <b>${Math.round(this.player.x)}, ${Math.round(this.player.y)}</b></div>
      <div>Zoom: <b>${this.cameras.main.zoom.toFixed(2)}x</b></div>
    `
  }

  saveMap() {
    localStorage.setItem('pixel-agent-lab-map', JSON.stringify(this.map))
    this.log('맵 저장 완료')
  }

  loadMap() {
    const raw = localStorage.getItem('pixel-agent-lab-map')
    if (!raw) return this.log('저장된 맵 없음')
    const parsed = JSON.parse(raw) as TileType[][]
    if (parsed.length === MAP_H && parsed[0]?.length === MAP_W) {
      this.map = parsed
      this.redrawAll()
      this.log('맵 불러오기 완료')
    }
  }

  syncUI() {
    ;(window as any).sceneRef = this
  }
}

function neighbors(x: number, y: number) {
  return [
    { x: x + 1, y },
    { x: x - 1, y },
    { x, y: y + 1 },
    { x, y: y - 1 },
  ]
}

function keyOf(x: number, y: number) {
  return `${x},${y}`
}

function heuristic(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
}

function findPath(map: TileType[][], start: { x: number; y: number }, goal: { x: number; y: number }) {
  if (start.x === goal.x && start.y === goal.y) return []

  const open: { x: number; y: number; f: number }[] = [{ ...start, f: heuristic(start, goal) }]
  const came = new Map<string, string>()
  const g = new Map<string, number>([[keyOf(start.x, start.y), 0]])
  const closed = new Set<string>()

  while (open.length) {
    open.sort((a, b) => a.f - b.f)
    const current = open.shift()!
    const ck = keyOf(current.x, current.y)
    if (closed.has(ck)) continue
    closed.add(ck)

    if (current.x === goal.x && current.y === goal.y) {
      const path: { x: number; y: number }[] = []
      let cur = keyOf(goal.x, goal.y)
      while (cur !== keyOf(start.x, start.y)) {
        const [x, y] = cur.split(',').map(Number)
        path.unshift({ x, y })
        cur = came.get(cur)!
      }
      return path
    }

    for (const nb of neighbors(current.x, current.y)) {
      if (!map[nb.y]?.[nb.x]) continue
      if (!WALKABLE[map[nb.y][nb.x]]) continue

      const nk = keyOf(nb.x, nb.y)
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

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'stage',
  width: MAP_W * TILE,
  height: MAP_H * TILE,
  backgroundColor: '#0b1220',
  pixelArt: true,
  scene: [DemoScene],
})

const bindUI = () => {
  const scene = () => ((window as any).sceneRef as DemoScene)

  document.querySelectorAll<HTMLButtonElement>('[data-tile]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-tile]').forEach((b) => b.classList.remove('active'))
      btn.classList.add('active')
      scene().selectedTile = btn.dataset.tile as TileType
    })
  })

  document.querySelector<HTMLButtonElement>('#toggle-edit')!.addEventListener('click', (e) => {
    scene().editMode = !scene().editMode
    ;(e.currentTarget as HTMLButtonElement).textContent = `에디트 모드: ${scene().editMode ? 'ON' : 'OFF'}`
    scene().log(`에디트 모드 ${scene().editMode ? '활성' : '비활성'}`)
  })

  document.querySelector<HTMLButtonElement>('#spawn-agent')!.addEventListener('click', () => scene().spawnAgent())
  document.querySelector<HTMLButtonElement>('#remove-agent')!.addEventListener('click', () => scene().removeAgent())
  document.querySelector<HTMLInputElement>('#speed')!.addEventListener('input', (e) => {
    scene().simSpeed = Number((e.currentTarget as HTMLInputElement).value)
  })

  document.querySelector<HTMLInputElement>('#show-grid')!.addEventListener('change', (e) => {
    scene().showGrid = (e.currentTarget as HTMLInputElement).checked
    scene().redrawAll()
  })

  document.querySelector<HTMLInputElement>('#show-path')!.addEventListener('change', (e) => {
    scene().showPath = (e.currentTarget as HTMLInputElement).checked
    scene().drawPaths()
  })

  document.querySelector<HTMLInputElement>('#show-coll')!.addEventListener('change', (e) => {
    scene().showCollision = (e.currentTarget as HTMLInputElement).checked
    scene().redrawAll()
  })

  document.querySelector<HTMLButtonElement>('#save-map')!.addEventListener('click', () => scene().saveMap())
  document.querySelector<HTMLButtonElement>('#load-map')!.addEventListener('click', () => scene().loadMap())
  document.querySelector<HTMLButtonElement>('#reset-map')!.addEventListener('click', () => {
    scene().createDefaultMap()
    scene().redrawAll()
    scene().log('맵 초기화 완료')
  })
}

bindUI()

window.addEventListener('beforeunload', () => game.destroy(true))
