'use strict';

/* ============================================================
 * 坦克大战 Tank Battle
 * 经典红白机风格 · HTML5 Canvas · 无依赖 · 单文件逻辑
 * ============================================================ */

/* ---------------- 基础尺寸 ---------------- */
const TILE = 32;                 // 大格（坦克 = 1 大格）
const SUB = 16;                  // 小格（砖墙可被半格摧毁）
const GRID = 13;                 // 13 x 13 大格
const W = TILE * GRID;           // 逻辑尺寸 416
const SGRID = GRID * 2;          // 26 x 26 小格
const SCALE = 2;                 // 渲染倍率（画布 832）

const UP = 0, RIGHT = 1, DOWN = 2, LEFT = 3;
const DV = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/* ---------------- 地形 ---------------- */
const E_EMPTY = 0, E_BRICK = 1, E_STEEL = 2, E_TREE = 3, E_WATER = 4;
const CHAR2E = { '.': E_EMPTY, 'B': E_BRICK, 'S': E_STEEL, 'T': E_TREE, 'W': E_WATER, 'E': E_EMPTY };

/* ---------------- 关卡地图 ---------------- */
const LEVELS = [
  {
    map: [
      '.............',
      '.BB.BB.BB.BB.',
      '.BB.BB.BB.BB.',
      '.BB.BBSTB.BB.',
      '.BB.BB.BB.BB.',
      '.....S...S...',
      'BB.BB.BB.BB.B',
      '.....S...S...',
      '.BB.BB.BB.BB.',
      '.BB.BB.BB.BB.',
      '.BB.BB.BB.BB.',
      '.....BBB.....',
      '.....B.B.....',
    ],
    total: 10, maxAlive: 4, spawnGap: 2.2,
    mix: { basic: 6, fast: 2, power: 1, armor: 1 },
  },
  {
    map: [
      '.............',
      '.SS.BBBBB.SS.',
      '.SS.BBBBB.SS.',
      '....BB.BB....',
      'BB..BB.BB..BB',
      'BB..B...B..BB',
      '....B.W.B....',
      'BB..B...B..BB',
      'BB..BB.BB..BB',
      '....BB.BB....',
      '.SS.BBBBB.SS.',
      '.....BBB.....',
      '.....B.B.....',
    ],
    total: 15, maxAlive: 4, spawnGap: 1.8,
    mix: { basic: 4, fast: 4, power: 4, armor: 3 },
  },
  {
    map: [
      '....T...T....',
      '.TT.TTTTT.TT.',
      '.TT.T...T.TT.',
      '.TT.T.W.T.TT.',
      '....T.W.T....',
      'BBBBT.W.TBBBB',
      '....T.W.T....',
      '.TT.T.W.T.TT.',
      '.TT.T.W.T.TT.',
      '.TT.TTTTT.TT.',
      '.TT.......TT.',
      '.....BBB.....',
      '.....B.B.....',
    ],
    total: 20, maxAlive: 5, spawnGap: 1.4,
    mix: { basic: 4, fast: 6, power: 5, armor: 5 },
  },
];

/* ---------------- 坦克属性 ---------------- */
const TANK_TYPES = {
  player: { speed: 106, hp: 1, bulletSpeed: 330, score: 0 },
  basic:  { speed: 72,  hp: 1, bulletSpeed: 205, score: 100 },
  fast:   { speed: 134, hp: 1, bulletSpeed: 205, score: 200 },
  power:  { speed: 88,  hp: 1, bulletSpeed: 350, score: 300 },
  armor:  { speed: 80,  hp: 4, bulletSpeed: 215, score: 400 },
};

const SPAWN_TIME = 1.1;          // 出生动画时长
const PLAYER_SPAWN = { x: 4 * TILE, y: 12 * TILE };
const ENEMY_SPAWNS = [
  { x: 0 * TILE, y: 0 },
  { x: 6 * TILE, y: 0 },
  { x: 12 * TILE, y: 0 },
];
const BASE = { x: 6 * TILE, y: 12 * TILE, w: TILE, h: TILE, alive: true };

// 老巢周围的墙（铲子道具会临时变成钢墙）
const WALL_TILES = [[5, 11], [6, 11], [7, 11], [5, 12], [7, 12]];
const WALL_SUBCELLS = new Set();
for (const [tx, ty] of WALL_TILES) {
  for (let dr = 0; dr < 2; dr++) for (let dc = 0; dc < 2; dc++) {
    WALL_SUBCELLS.add((ty * 2 + dr) * 64 + (tx * 2 + dc));
  }
}

const PU_TYPES = ['star', 'grenade', 'helmet', 'shovel', 'clock', 'tank'];

/* ---------------- 工具函数 ---------------- */
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const aabb = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const pad = (n, len) => String(n).padStart(len, '0');

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp((n >> 16) + amt, 0, 255);
  const g = clamp(((n >> 8) & 255) + amt, 0, 255);
  const b = clamp((n & 255) + amt, 0, 255);
  return `rgb(${r},${g},${b})`;
}

/* ============================================================
 *  音效（WebAudio，无外部资源）
 * ============================================================ */
const Sfx = (() => {
  let ac = null;
  function ctxAudio() {
    if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }
  function beep(f0, f1, dur, type = 'square', vol = 0.05, delay = 0) {
    if (G.muted) return;
    try {
      const a = ctxAudio(), t0 = a.currentTime + delay;
      const o = a.createOscillator(), g = a.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, t0);
      if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(a.destination);
      o.start(t0); o.stop(t0 + dur + 0.03);
    } catch (e) { /* 忽略音频错误 */ }
  }
  function noise(dur, vol = 0.1, cutoff = 900) {
    if (G.muted) return;
    try {
      const a = ctxAudio(), t0 = a.currentTime;
      const len = Math.max(1, Math.floor(a.sampleRate * dur));
      const buf = a.createBuffer(1, len, a.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = a.createBufferSource(); src.buffer = buf;
      const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff;
      const g = a.createGain(); g.gain.value = vol;
      src.connect(f).connect(g).connect(a.destination);
      src.start(t0);
    } catch (e) { /* 忽略音频错误 */ }
  }
  return {
    unlock()   { try { ctxAudio(); } catch (e) { /* 忽略 */ } },
    shoot()    { beep(560, 190, 0.08, 'square', 0.035); },
    brick()    { noise(0.06, 0.05, 1400); },
    steel()    { beep(1500, 950, 0.05, 'triangle', 0.03); },
    clank()    { beep(900, 480, 0.06, 'sawtooth', 0.03); },
    explSmall(){ noise(0.16, 0.08, 1000); },
    explBig()  { noise(0.5, 0.16, 520); beep(130, 40, 0.42, 'sawtooth', 0.05); },
    powerup()  { beep(660, 0, .09, 'square', .05); beep(880, 0, .09, 'square', .05, .09); beep(1320, 0, .13, 'square', .05, .18); },
    life()     { [523, 659, 784, 1046].forEach((f, i) => beep(f, 0, i === 3 ? 0.2 : 0.1, 'square', 0.05, i * 0.09)); },
    stageStart(){ beep(523, 0, .1, 'square', .05); beep(784, 0, .16, 'square', .05, .12); },
    stageClear(){ [659, 784, 988, 1319].forEach((f, i) => beep(f, 0, 0.14, 'square', 0.05, i * 0.12)); },
    gameover() { beep(420, 90, 0.55, 'sawtooth', 0.06); beep(300, 60, 0.8, 'sawtooth', 0.05, 0.32); },
    win()      { [523, 659, 784, 1046, 1319].forEach((f, i) => beep(f, 0, 0.16, 'square', 0.05, i * 0.13)); },
  };
})();

/* ============================================================
 *  全局状态
 * ============================================================ */
const G = {
  state: 'title',        // title | playing | paused | clear | over | win
  level: 0,
  score: 0,
  hi: +(localStorage.getItem('tankbattle.hi') || 0),
  lives: 3,
  playerStar: 0,
  muted: localStorage.getItem('tankbattle.muted') === '1',

  world: [],
  tanks: [],
  bullets: [],
  explosions: [],
  popups: [],
  powerups: [],
  spawns: [],
  player: null,

  queue: [],
  spawnedCount: 0,
  spawnTimer: 1,
  spawnPoint: 0,

  freeze: 0,
  shovel: 0,
  respawnTimer: 0,
  clearTimer: 0,
  overTimer: 0,
  stateTimer: 0,
  time: 0,
};

/* ============================================================
 *  画布与离屏图块
 * ============================================================ */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

function makeTile(draw) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = SUB;
  draw(cv.getContext('2d'));
  return cv;
}

// 砖墙
const TILE_BRICK = makeTile(g => {
  g.fillStyle = '#572a0b'; g.fillRect(0, 0, SUB, SUB);
  g.fillStyle = '#c2662c';
  for (let ry = 0; ry < 4; ry++) {
    const off = (ry % 2) * 4;
    for (let bx = -1; bx < 3; bx++) g.fillRect(bx * 8 + off, ry * 4, 7, 3);
  }
});

// 钢墙
const TILE_STEEL = makeTile(g => {
  g.fillStyle = '#6f7883'; g.fillRect(0, 0, SUB, SUB);
  g.fillStyle = '#c8d0d9'; g.fillRect(0, 0, SUB, 2); g.fillRect(0, 0, 2, SUB);
  g.fillStyle = '#aeb6c0'; g.fillRect(2, 2, SUB - 4, SUB - 4);
  g.fillStyle = '#7d8791'; g.fillRect(2, SUB - 4, SUB - 4, 2); g.fillRect(SUB - 4, 2, 2, SUB - 4);
});

// 水（两帧）
function makeWater(flip) {
  return makeTile(g => {
    g.fillStyle = '#12406e'; g.fillRect(0, 0, SUB, SUB);
    g.fillStyle = '#2f7ec4';
    const y0 = flip ? 4 : 0;
    g.fillRect(1, 2 + y0, 6, 2); g.fillRect(9, 8 - y0, 6, 2);
    g.fillStyle = '#7fc4f2';
    g.fillRect(6, 11 + (flip ? -6 : 0), 5, 1); g.fillRect(1, 5 - (flip ? 4 : 0), 5, 1);
  });
}
const TILE_WATER = [makeWater(false), makeWater(true)];

// 树丛
const TILE_TREE = makeTile(g => {
  g.fillStyle = '#1d6b1d'; g.fillRect(0, 0, SUB, SUB);
  g.fillStyle = '#2f9e2f';
  const pts = [[1, 2], [7, 1], [11, 5], [3, 8], [9, 10], [5, 13], [13, 13], [13, 1]];
  for (const [x, y] of pts) { g.beginPath(); g.arc(x, y, 3.4, 0, 7); g.fill(); }
  g.fillStyle = '#56c456';
  for (const [x, y] of pts) { g.beginPath(); g.arc(x - 1, y - 1, 1.6, 0, 7); g.fill(); }
});

// 静态层（砖 + 钢）烘焙缓存
const staticCanvas = document.createElement('canvas');
staticCanvas.width = staticCanvas.height = W * SCALE;
const sctx = staticCanvas.getContext('2d');
sctx.imageSmoothingEnabled = false;
let staticDirty = true;

/* 铲子道具最后 3 秒：老巢围墙在砖 / 钢之间闪烁 */
function shovelBlinkPhase() {
  return G.shovel > 0 && G.shovel <= 3 && ((G.time * 6) | 0) % 2 === 0;
}

function bakeStatic() {
  const blink = shovelBlinkPhase();
  sctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  sctx.clearRect(0, 0, W, W);
  for (let r = 0; r < SGRID; r++) {
    for (let c = 0; c < SGRID; c++) {
      const e = G.world[r][c];
      if (e === E_BRICK) sctx.drawImage(TILE_BRICK, c * SUB, r * SUB);
      else if (e === E_STEEL) {
        const img = (blink && WALL_SUBCELLS.has(r * 64 + c)) ? TILE_BRICK : TILE_STEEL;
        sctx.drawImage(img, c * SUB, r * SUB);
      }
    }
  }
  staticDirty = false;
}

/* ============================================================
 *  世界 / 关卡
 * ============================================================ */
function loadWorld(map) {
  G.world = [];
  for (let r = 0; r < SGRID; r++) {
    const row = [];
    for (let c = 0; c < SGRID; c++) {
      row.push(CHAR2E[map[(r / 2) | 0][(c / 2) | 0]] ?? E_EMPTY);
    }
    G.world.push(row);
  }
  staticDirty = true;
}

function setBaseWalls(type) {
  for (const [tx, ty] of WALL_TILES) {
    for (let dr = 0; dr < 2; dr++) for (let dc = 0; dc < 2; dc++) {
      G.world[ty * 2 + dr][tx * 2 + dc] = type;
    }
  }
  staticDirty = true;
}

function buildQueue(cfg) {
  const q = [];
  for (const [type, count] of Object.entries(cfg.mix)) {
    for (let i = 0; i < count; i++) q.push(type);
  }
  for (let i = q.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [q[i], q[j]] = [q[j], q[i]];
  }
  return q;
}

function startGame() {
  G.score = 0;
  G.lives = 3;
  G.playerStar = 0;
  startLevel(0);
}

function startLevel(n) {
  G.level = n;
  const cfg = LEVELS[n];
  loadWorld(cfg.map);
  G.tanks = [];
  G.bullets = [];
  G.explosions = [];
  G.popups = [];
  G.powerups = [];
  G.spawns = [];
  G.player = null;
  G.queue = buildQueue(cfg);
  G.spawnedCount = 0;
  G.spawnTimer = 1.2;
  G.spawnPoint = 0;
  G.freeze = 0;
  G.shovel = 0;
  G.respawnTimer = 0;
  G.clearTimer = 0;
  G.overTimer = 0;
  G.stateTimer = 0;
  BASE.alive = true;
  spawnPlayer();
  G.state = 'playing';
  hideOverlay();
  Sfx.stageStart();
  updateHud();
}

function nextLevel() {
  if (G.level + 1 < LEVELS.length) startLevel(G.level + 1);
  else victory();
}

function victory() {
  G.state = 'win';
  G.stateTimer = 0;
  Sfx.win();
  showOverlay(`
    <div class="card">
      <h1 class="big-win">胜 利 !</h1>
      <div class="sub">ALL STAGES CLEARED</div>
      <div class="score">最终得分 ${pad(G.score, 6)}</div>
      <div class="hint blink">按 Enter 重新开始</div>
    </div>`);
}

function gameOver() {
  G.state = 'over';
  G.stateTimer = 0;
  saveHi();
  Sfx.gameover();
  showOverlay(`
    <div class="card">
      <h1 class="big-over">GAME OVER</h1>
      <div class="sub">老巢陷落</div>
      <div class="score">本次得分 ${pad(G.score, 6)}　最高 ${pad(G.hi, 6)}</div>
      <div class="hint blink">按 Enter 重新开始</div>
    </div>`);
}

function saveHi() {
  if (G.score > G.hi) {
    G.hi = G.score;
    localStorage.setItem('tankbattle.hi', String(G.hi));
  }
}

/* ============================================================
 *  碰撞
 * ============================================================ */
function tileBlocks(e) { return e === E_BRICK || e === E_STEEL || e === E_WATER; }

function rectBlocked(x, y, w, h, ignore) {
  if (x < 0 || y < 0 || x + w > W || y + h > W) return true;
  if (BASE.alive && aabb({ x, y, w, h }, BASE)) return true;

  const c0 = Math.floor(x / SUB), c1 = Math.floor((x + w - 0.001) / SUB);
  const r0 = Math.floor(y / SUB), r1 = Math.floor((y + h - 0.001) / SUB);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (tileBlocks(G.world[r][c])) return true;
    }
  }

  for (const t of G.tanks) {
    if (t === ignore || t.dead || t.spawn > 0) continue;
    if (aabb({ x, y, w, h }, t)) return true;
  }
  return false;
}

/* ============================================================
 *  坦克
 * ============================================================ */
class Tank {
  constructor(type, x, y, dir, isPlayer) {
    const spec = TANK_TYPES[type];
    this.type = type;
    this.spec = spec;
    this.isPlayer = !!isPlayer;

    this.x = x; this.y = y;
    this.w = TILE; this.h = TILE;
    this.dir = dir;
    this.hp = spec.hp;

    this.speed = spec.speed;
    this.bulletSpeed = spec.bulletSpeed;
    this.maxBullets = 1;

    this.star = 0;
    this.shield = 0;
    this.spawn = SPAWN_TIME;
    this.dead = false;

    this.moving = false;
    this.anim = 0;
    this.hitFlash = 0;
    this.hasPowerup = false;

    this.decideTimer = rand(0.4, 1.2);
    this.shootTimer = rand(0.5, 1.6);
    this.blockedTime = 0;
    this.fireCd = 0;
  }

  get cx() { return this.x + TILE / 2; }
  get cy() { return this.y + TILE / 2; }

  /* --- 移动（带转向对齐） --- */
  move(dt, dir) {
    if (this.dir !== dir) {
      this.dir = dir;
      this.snapAxis(dir);
    }
    const [dx, dy] = DV[dir];
    const step = this.speed * dt;
    const nx = this.x + dx * step, ny = this.y + dy * step;
    if (!rectBlocked(nx, ny, this.w, this.h, this)) {
      this.x = nx; this.y = ny;
      this.moving = true;
      this.anim += dt * this.speed / 26;
      this.blockedTime = 0;
    } else {
      this.moving = false;
      this.blockedTime += dt;
      // 被挡住时向对齐线微调，避免贴墙卡位
      const vertical = dir === UP || dir === DOWN;
      const v = vertical ? this.x : this.y;
      const target = Math.round(v / SUB) * SUB;
      const diff = target - v;
      if (Math.abs(diff) > 0.5) {
        const s = Math.sign(diff) * Math.min(Math.abs(diff), 70 * dt);
        const nx2 = vertical ? this.x + s : this.x;
        const ny2 = vertical ? this.y : this.y + s;
        if (!rectBlocked(nx2, ny2, this.w, this.h, this)) { this.x = nx2; this.y = ny2; }
      }
    }
  }

  /* 转向时把垂直轴对齐到 16 网格（经典手感的关键） */
  snapAxis(dir) {
    const vertical = dir === UP || dir === DOWN;
    const v = vertical ? this.x : this.y;
    const cands = [Math.round(v / SUB) * SUB, Math.floor(v / SUB) * SUB, Math.ceil(v / SUB) * SUB];
    for (const nv of cands) {
      if (nv === v) return;
      const nx = vertical ? nv : this.x;
      const ny = vertical ? this.y : nv;
      if (!rectBlocked(nx, ny, this.w, this.h, this)) {
        this.x = nx; this.y = ny;
        return;
      }
    }
  }

  update(dt) {
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    if (this.spawn > 0) {
      this.spawn -= dt;
      if (this.spawn <= 0 && this.isPlayer && this.shield <= 0) this.shield = 3;
      return;
    }
    if (this.isPlayer) this.updatePlayer(dt);
    else this.updateEnemy(dt);
  }

  updatePlayer(dt) {
    this.shield = Math.max(0, this.shield - dt);
    this.fireCd -= dt;

    let dir = -1;
    for (const d of INPUT.dirOrder()) {
      if (INPUT.keys[d]) { dir = INPUT.dirs[d]; break; }
    }
    if (dir >= 0) this.move(dt, dir);
    else this.moving = false;

    if (INPUT.keys.fire && this.fireCd <= 0) {
      this.fireCd = 0.3;
      tryFire(this);
    }
  }

  updateEnemy(dt) {
    if (G.freeze > 0) { this.moving = false; return; }

    this.shootTimer -= dt;
    if (this.shootTimer <= 0) {
      this.shootTimer = rand(0.5, 1.7);
      const aligned = this.alignedWithTarget();
      if (Math.random() < (aligned ? 0.85 : 0.28)) tryFire(this);
    }

    this.decideTimer -= dt;
    if (this.decideTimer <= 0 || this.blockedTime > 0.35) this.pickDir();
    this.move(dt, this.dir);
  }

  alignedWithTarget() {
    const targets = [];
    if (BASE.alive) targets.push(BASE);
    if (G.player && !G.player.dead && G.player.spawn <= 0) targets.push(G.player);
    for (const t of targets) {
      const ex = t.x, ey = t.y;
      if (this.dir === UP || this.dir === DOWN) {
        if (Math.abs((ex + TILE / 2) - this.cx) < 14) return true;
      } else {
        if (Math.abs((ey + TILE / 2) - this.cy) < 14) return true;
      }
    }
    return false;
  }

  pickDir() {
    const target = BASE.alive ? BASE : (G.player || BASE);
    const tx = (target.x + TILE / 2) - this.cx;
    const ty = (target.y + TILE / 2) - this.cy;
    const opts = [];
    if (Math.random() < 0.62) {
      if (Math.abs(tx) > Math.abs(ty)) opts.push(tx > 0 ? RIGHT : LEFT, ty > 0 ? DOWN : UP);
      else opts.push(ty > 0 ? DOWN : UP, tx > 0 ? RIGHT : LEFT);
    }
    opts.push((Math.random() * 4) | 0, (Math.random() * 4) | 0);
    const step = 6;
    for (const d of opts) {
      const [dx, dy] = DV[d];
      if (!rectBlocked(this.x + dx * step, this.y + dy * step, this.w, this.h, this)) {
        this.dir = d;
        this.snapAxis(d);
        this.decideTimer = rand(0.8, 2.4);
        this.blockedTime = 0;
        return;
      }
    }
    this.decideTimer = rand(0.4, 0.9);
  }
}

/* ============================================================
 *  子弹
 * ============================================================ */
class Bullet {
  constructor(owner) {
    const [dx, dy] = DV[owner.dir];
    this.owner = owner;
    this.dir = owner.dir;
    this.w = 6; this.h = 6;
    this.x = owner.cx + dx * (TILE / 2) - 3;
    this.y = owner.cy + dy * (TILE / 2) - 3;
    this.speed = owner.bulletSpeed;
    this.vx = dx * this.speed;
    this.vy = dy * this.speed;
    this.fromPlayer = owner.isPlayer;
    this.power = owner.isPlayer && owner.star >= 3;   // 三星子弹可破钢墙
    this.dead = false;
  }

  update(dt) {
    const dist = this.speed * dt;
    const steps = Math.max(1, Math.ceil(dist / 8));
    for (let i = 0; i < steps && !this.dead; i++) {
      this.x += this.vx * dt / steps;
      this.y += this.vy * dt / steps;
      this.collide();
    }
  }

  /* 命中判定用的矩形：垂直方向扩到 16（坦克宽度），打出经典的正齐缺口 */
  damageRect() {
    if (this.dir === UP || this.dir === DOWN) {
      return { x: this.x + 3 - 8, y: this.y - 4, w: 16, h: this.h + 8 };
    }
    return { x: this.x - 4, y: this.y + 3 - 8, w: this.w + 8, h: 16 };
  }

  collide() {
    // 边界
    if (this.x < 0 || this.y < 0 || this.x + this.w > W || this.y + this.h > W) {
      this.dead = true;
      spawnSpark(this.cx(), this.cy());
      return;
    }

    // 老巢
    if (BASE.alive && aabb(this, BASE)) {
      this.dead = true;
      destroyBase();
      return;
    }

    // 地形（判定矩形可能在场地边缘外，索引需钳制）
    const dmg = this.damageRect();
    const c0 = clamp(Math.floor(dmg.x / SUB), 0, SGRID - 1);
    const c1 = clamp(Math.floor((dmg.x + dmg.w - 0.001) / SUB), 0, SGRID - 1);
    const r0 = clamp(Math.floor(dmg.y / SUB), 0, SGRID - 1);
    const r1 = clamp(Math.floor((dmg.y + dmg.h - 0.001) / SUB), 0, SGRID - 1);
    let hitBrick = false, hitSteel = false;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const e = G.world[r][c];
        if (e === E_BRICK) { G.world[r][c] = E_EMPTY; hitBrick = true; }
        else if (e === E_STEEL) {
          hitSteel = true;
          if (this.power) G.world[r][c] = E_EMPTY;
        }
      }
    }
    if (hitBrick || hitSteel) {
      staticDirty = true;
      this.dead = true;
      if (hitSteel) { Sfx.steel(); spawnSpark(this.cx(), this.cy()); }
      else Sfx.brick();
      return;
    }

    // 坦克
    for (const t of G.tanks) {
      if (t.dead || t.spawn > 0 || t === this.owner) continue;
      if (t.isPlayer === this.fromPlayer) continue;      // 不打自己人
      if (!aabb(this, t)) continue;

      this.dead = true;
      if (t.isPlayer) {
        if (t.shield > 0) { spawnSpark(this.cx(), this.cy()); }
        else killPlayer(t);
      } else {
        damageEnemy(t);
      }
      return;
    }
  }

  cx() { return this.x + this.w / 2; }
  cy() { return this.y + this.h / 2; }
}

function tryFire(t) {
  let active = 0;
  for (const b of G.bullets) if (b.owner === t && !b.dead) active++;
  if (active >= t.maxBullets) return;
  G.bullets.push(new Bullet(t));
  Sfx.shoot();
}

/* ============================================================
 *  伤害 / 死亡
 * ============================================================ */
function damageEnemy(t) {
  t.hp--;
  if (t.hp <= 0) {
    killEnemy(t);
  } else {
    t.hitFlash = 0.16;
    Sfx.clank();
  }
}

function killEnemy(t) {
  t.dead = true;
  addExplosion(t.cx, t.cy, true);
  Sfx.explBig();
  G.score += t.spec.score;
  addPopup(t.cx, t.cy, '+' + t.spec.score);
  if (t.hasPowerup) dropPowerup(t.x, t.y);
}

function killPlayer(t) {
  t.dead = true;
  G.player = null;
  addExplosion(t.cx, t.cy, true);
  Sfx.explBig();
  G.lives--;
  G.playerStar = 0;
  if (G.lives <= 0) {
    G.overTimer = Math.max(G.overTimer, 1.2);
  } else {
    G.respawnTimer = 1.4;
  }
  updateHud();
}

function destroyBase() {
  BASE.alive = false;
  addExplosion(BASE.x + TILE / 2, BASE.y + TILE / 2, true);
  addExplosion(BASE.x + 8, BASE.y + 10, true);
  Sfx.explBig();
  G.overTimer = Math.max(G.overTimer, 1.4);
}

function spawnPlayer() {
  const p = new Tank('player', PLAYER_SPAWN.x, PLAYER_SPAWN.y, UP, true);
  p.star = G.playerStar;
  p.bulletSpeed = p.star >= 1 ? 480 : TANK_TYPES.player.bulletSpeed;
  p.maxBullets = p.star >= 2 ? 2 : 1;
  G.player = p;
  G.tanks.push(p);
}

function applyStar(p) {
  G.playerStar = Math.min(3, p.star + 1);
  p.star = G.playerStar;
  p.bulletSpeed = p.star >= 1 ? 480 : 330;
  p.maxBullets = p.star >= 2 ? 2 : 1;
}

/* ============================================================
 *  敌人生成
 * ============================================================ */
function updateSpawner(dt) {
  const cfg = LEVELS[G.level];
  const aliveEnemies = G.tanks.filter(t => !t.isPlayer && !t.dead).length;
  if (G.queue.length === 0) return;
  if (aliveEnemies + G.spawns.length >= cfg.maxAlive) return;

  G.spawnTimer -= dt;
  if (G.spawnTimer > 0) return;

  // 找一个没被占用的出生点
  for (let i = 0; i < ENEMY_SPAWNS.length; i++) {
    const idx = (G.spawnPoint + i) % ENEMY_SPAWNS.length;
    const sp = ENEMY_SPAWNS[idx];
    const rect = { x: sp.x, y: sp.y, w: TILE, h: TILE };
    const occupied = G.tanks.some(t => !t.dead && aabb(rect, t)) ||
                     G.spawns.some(s => s.x === sp.x && s.y === sp.y);
    if (occupied) continue;
    G.spawnPoint = (idx + 1) % ENEMY_SPAWNS.length;
    spawnEnemy(sp);
    G.spawnTimer = cfg.spawnGap;
    return;
  }
  G.spawnTimer = 0.4;
}

function spawnEnemy(sp) {
  const type = G.queue.shift();
  G.spawnedCount++;
  // 每第 4 辆携带道具（经典设定）
  const hasPowerup = G.spawnedCount % 4 === 0;
  G.spawns.push({ x: sp.x, y: sp.y, t: SPAWN_TIME, type, hasPowerup });
}

function updateSpawns(dt) {
  for (const s of G.spawns) {
    s.t -= dt;
    if (s.t <= 0) {
      const e = new Tank(s.type, s.x, s.y, DOWN, false);
      e.hasPowerup = s.hasPowerup;
      G.tanks.push(e);
    }
  }
  G.spawns = G.spawns.filter(s => s.t > 0);
}

/* ============================================================
 *  道具
 * ============================================================ */
function dropPowerup(x, y) {
  const type = PU_TYPES[(Math.random() * PU_TYPES.length) | 0];
  G.powerups = [{ x: Math.round(x / SUB) * SUB, y: Math.round(y / SUB) * SUB, w: TILE, h: TILE, type, t: 0 }];
}

function applyPowerup(pu) {
  const p = G.player;
  Sfx.powerup();
  G.score += 500;
  addPopup(pu.x + TILE / 2, pu.y, '+500');

  switch (pu.type) {
    case 'star':
      if (p) applyStar(p);
      break;
    case 'grenade':
      for (const t of G.tanks) {
        if (!t.isPlayer && !t.dead && t.spawn <= 0) killEnemy(t);
      }
      break;
    case 'helmet':
      if (p) p.shield = 10;
      break;
    case 'shovel':
      G.shovel = 15;
      setBaseWalls(E_STEEL);
      break;
    case 'clock':
      G.freeze = 8;
      break;
    case 'tank':
      G.lives++;
      Sfx.life();
      break;
  }
  updateHud();
}

/* ============================================================
 *  特效
 * ============================================================ */
function addExplosion(x, y, big) {
  G.explosions.push({ x, y, t: 0, dur: big ? 0.55 : 0.22, big: !!big, seed: Math.random() * 1000 });
}

function spawnSpark(x, y) {
  addExplosion(x, y, false);
  Sfx.explSmall();
}

function addPopup(x, y, text) {
  G.popups.push({ x, y, t: 0, dur: 0.9, text });
}

function updateEffects(dt) {
  for (const e of G.explosions) e.t += dt;
  G.explosions = G.explosions.filter(e => e.t < e.dur);
  for (const p of G.popups) { p.t += dt; p.y -= 18 * dt; }
  G.popups = G.popups.filter(p => p.t < p.dur);
}

/* ============================================================
 *  输入
 * ============================================================ */
const INPUT = {
  keys: { up: false, down: false, left: false, right: false, fire: false },
  dirs: { up: UP, down: DOWN, left: LEFT, right: RIGHT },
  lastDir: 'up',
  order: ['up', 'down', 'left', 'right'],
  dirOrder() {
    // 最后按下的方向优先
    const rest = this.order.filter(k => k !== this.lastDir);
    return [this.lastDir, ...rest];
  },
};

const KEYMAP = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  Space: 'fire', KeyJ: 'fire',
};

window.addEventListener('keydown', e => {
  if (e.code in KEYMAP) {
    e.preventDefault();
    const k = KEYMAP[e.code];
    if (k === 'fire') INPUT.keys.fire = true;
    else { INPUT.keys[k] = true; INPUT.lastDir = k; }
    Sfx.unlock();
    return;
  }
  if (e.code === 'Enter') { e.preventDefault(); onConfirm(); }
  else if (e.code === 'KeyP' || e.code === 'Escape') { e.preventDefault(); togglePause(); }
  else if (e.code === 'KeyM') { toggleMute(); }
});

window.addEventListener('keyup', e => {
  if (e.code in KEYMAP) {
    const k = KEYMAP[e.code];
    INPUT.keys[k] = false;
  }
});

window.addEventListener('blur', () => {
  for (const k in INPUT.keys) INPUT.keys[k] = false;
  if (G.state === 'playing') togglePause();
});

function onConfirm() {
  if (G.state === 'title' || G.state === 'over' || G.state === 'win') startGame();
  else if (G.state === 'clear') nextLevel();
}

function togglePause() {
  if (G.state === 'playing') {
    G.state = 'paused';
    showOverlay(`
      <div class="card">
        <h1>暂 停</h1>
        <div class="sub">PAUSED</div>
        <div class="hint blink">按 P 继续</div>
      </div>`);
  } else if (G.state === 'paused') {
    G.state = 'playing';
    hideOverlay();
  }
}

/* 触屏 */
(function setupTouch() {
  const map = { up: 'up', down: 'down', left: 'left', right: 'right' };
  document.querySelectorAll('.dbtn').forEach(btn => {
    const k = map[btn.dataset.k];
    const on = e => { e.preventDefault(); INPUT.keys[k] = true; INPUT.lastDir = k; };
    const off = e => { e.preventDefault(); INPUT.keys[k] = false; };
    btn.addEventListener('pointerdown', on);
    btn.addEventListener('pointerup', off);
    btn.addEventListener('pointercancel', off);
    btn.addEventListener('pointerleave', off);
  });
  const fire = document.getElementById('fireBtn');
  fire.addEventListener('pointerdown', e => { e.preventDefault(); Sfx.unlock(); INPUT.keys.fire = true; });
  fire.addEventListener('pointerup', e => { e.preventDefault(); INPUT.keys.fire = false; });
  fire.addEventListener('pointercancel', () => { INPUT.keys.fire = false; });
})();

/* 静音按钮 */
const muteBtn = document.getElementById('muteBtn');
function toggleMute() {
  G.muted = !G.muted;
  localStorage.setItem('tankbattle.muted', G.muted ? '1' : '0');
  muteBtn.textContent = G.muted ? '🔇 音效关' : '🔊 音效开';
}
muteBtn.addEventListener('click', toggleMute);
if (G.muted) muteBtn.textContent = '🔇 音效关';

/* 点击画布 / 覆盖层 */
document.getElementById('stage').addEventListener('pointerdown', () => {
  Sfx.unlock();
  if (G.state === 'title' || G.state === 'over' || G.state === 'win' || G.state === 'clear') onConfirm();
});

/* ============================================================
 *  主循环
 * ============================================================ */
function updatePlaying(dt) {
  G.freeze = Math.max(0, G.freeze - dt);
  if (G.shovel > 0) {
    G.shovel -= dt;
    if (G.shovel <= 0) setBaseWalls(E_BRICK);
  }

  for (const t of G.tanks) t.update(dt);
  for (const b of G.bullets) b.update(dt);

  // 子弹对撞抵消
  for (let i = 0; i < G.bullets.length; i++) {
    const a = G.bullets[i];
    if (a.dead) continue;
    for (let j = i + 1; j < G.bullets.length; j++) {
      const b = G.bullets[j];
      if (b.dead || a.fromPlayer === b.fromPlayer) continue;
      if (aabb(a, b)) { a.dead = b.dead = true; spawnSpark((a.x + b.x) / 2 + 3, (a.y + b.y) / 2 + 3); }
    }
  }

  G.bullets = G.bullets.filter(b => !b.dead);
  G.tanks = G.tanks.filter(t => !t.dead);

  updateSpawner(dt);
  updateSpawns(dt);
  updateEffects(dt);

  // 道具拾取
  if (G.player && !G.player.dead) {
    for (const pu of G.powerups) {
      if (aabb(G.player, pu)) { applyPowerup(pu); pu.t = -1; }
    }
    G.powerups = G.powerups.filter(pu => pu.t >= 0);
  }

  // 玩家复活
  if (!G.player && G.respawnTimer > 0) {
    G.respawnTimer -= dt;
    if (G.respawnTimer <= 0 && G.lives > 0) spawnPlayer();
  }

  // 过关判定
  const enemiesLeft = G.tanks.some(t => !t.isPlayer) || G.spawns.length || G.queue.length;
  if (!enemiesLeft && G.overTimer <= 0) {
    G.clearTimer += dt;
    if (G.clearTimer > 0.9 && G.state === 'playing') {
      G.state = 'clear';
      G.stateTimer = 0;
      Sfx.stageClear();
      saveHi();
      showOverlay(`
        <div class="card">
          <h1>STAGE ${G.level + 1}</h1>
          <div class="sub">CLEAR !</div>
          <div class="score">当前得分 ${pad(G.score, 6)}</div>
          <div class="hint blink">按 Enter 继续</div>
        </div>`);
    }
  }

  // 老巢被毁 / 生命耗尽
  if (G.overTimer > 0) {
    G.overTimer -= dt;
    if (G.overTimer <= 0 && G.state === 'playing') gameOver();
  }

  updateHud();
}

function update(dt) {
  G.time += dt;
  if (G.state === 'playing') {
    updatePlaying(dt);
  } else {
    updateEffects(dt);
    if (G.state === 'clear' || G.state === 'over' || G.state === 'win') {
      G.stateTimer += dt;
      if (G.state === 'clear' && G.stateTimer > 3.4) nextLevel();   // 自动进入下一关
    }
  }
}

/* ============================================================
 *  渲染
 * ============================================================ */
function render() {
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  ctx.fillStyle = '#0f0f14';
  ctx.fillRect(0, 0, W, W);

  if (G.shovel > 0 && G.shovel <= 3) staticDirty = true;   // 闪烁期间每帧重烘焙
  if (staticDirty) bakeStatic();
  ctx.drawImage(staticCanvas, 0, 0, W, W);

  drawWater();
  drawBase();
  drawPowerups();
  drawGhostSpawns();
  for (const t of G.tanks) drawTank(t);
  drawBullets();
  drawTrees();
  drawExplosions();
  drawPopups();

  if (G.freeze > 0) {
    ctx.fillStyle = 'rgba(120,200,255,0.07)';
    ctx.fillRect(0, 0, W, W);
  }
}

function drawWater() {
  const frame = ((G.time * 3) | 0) % 2;
  const img = TILE_WATER[frame];
  for (let r = 0; r < SGRID; r++) {
    for (let c = 0; c < SGRID; c++) {
      if (G.world[r][c] === E_WATER) ctx.drawImage(img, c * SUB, r * SUB);
    }
  }
}

function drawTrees() {
  for (let r = 0; r < SGRID; r++) {
    for (let c = 0; c < SGRID; c++) {
      if (G.world[r][c] === E_TREE) ctx.drawImage(TILE_TREE, c * SUB, r * SUB);
    }
  }
}

function drawBase() {
  const { x, y } = BASE;
  const alive = BASE.alive;
  // 底座
  ctx.fillStyle = alive ? '#3a3f47' : '#25282d';
  ctx.fillRect(x, y + 26, TILE, 6);
  ctx.fillStyle = alive ? '#585f6a' : '#33373c';
  ctx.fillRect(x, y + 24, TILE, 3);

  if (alive) {
    ctx.fillStyle = '#e9edf2';
    // 身体
    ctx.fillRect(x + 13, y + 9, 6, 16);
    // 翅膀
    ctx.beginPath();
    ctx.moveTo(x + 15, y + 11); ctx.lineTo(x + 4, y + 19); ctx.lineTo(x + 14, y + 21); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + 17, y + 11); ctx.lineTo(x + 28, y + 19); ctx.lineTo(x + 18, y + 21); ctx.closePath(); ctx.fill();
    // 头
    ctx.beginPath(); ctx.arc(x + 16, y + 8, 4.5, 0, 7); ctx.fill();
    ctx.fillStyle = '#ffc650';
    ctx.fillRect(x + 13, y + 5, 6, 2);
    // 光晕
    ctx.fillStyle = 'rgba(255,198,80,.14)';
    ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 8);
  } else {
    ctx.fillStyle = '#4a4f56';
    ctx.fillRect(x + 8, y + 16, 16, 10);
    ctx.fillRect(x + 12, y + 8, 8, 8);
    ctx.fillStyle = '#22252a';
    ctx.fillRect(x + 13, y + 12, 6, 4);
  }
}

function tankColor(t) {
  if (t.isPlayer) return '#e8c341';
  if (t.type === 'armor') return ['#c9ced6', '#5ad06a', '#e0c341', '#e07a3a'][clamp(4 - t.hp, 0, 3)];
  if (t.type === 'fast') return '#79d0f0';
  if (t.type === 'power') return '#a6e05a';
  return '#c9ced6';
}

function drawTank(t) {
  if (t.spawn > 0) return;   // 出生动画由 drawGhostSpawns 处理

  const col = tankColor(t);
  const dark = shade(col, -55);
  const light = shade(col, 40);
  const { x, y, w, h } = t;
  const vertical = t.dir === UP || t.dir === DOWN;

  // 履带
  ctx.fillStyle = dark;
  if (vertical) {
    ctx.fillRect(x, y + 1, 8, h - 2);
    ctx.fillRect(x + w - 8, y + 1, 8, h - 2);
  } else {
    ctx.fillRect(x + 1, y, w - 2, 8);
    ctx.fillRect(x + 1, y + h - 8, w - 2, 8);
  }
  // 履带纹（随移动滚动）
  ctx.fillStyle = light;
  const shift = (t.anim * 9) % 7;
  for (let k = -1; k < 5; k++) {
    const o = k * 7 + shift;
    if (o < 1 || o > (vertical ? h : w) - 4) continue;
    if (vertical) {
      ctx.fillRect(x + 1, y + o, 6, 2);
      ctx.fillRect(x + w - 7, y + o, 6, 2);
    } else {
      ctx.fillRect(x + o, y + 1, 2, 6);
      ctx.fillRect(x + o, y + h - 7, 2, 6);
    }
  }

  // 车身
  ctx.fillStyle = col;
  ctx.fillRect(x + 8, y + 8, w - 16, h - 16);
  ctx.fillStyle = light;
  ctx.fillRect(x + 8, y + 8, w - 16, 3);

  // 炮塔 + 炮管
  const cx = t.cx, cy = t.cy;
  const [dx, dy] = DV[t.dir];
  ctx.fillStyle = '#f2f4f7';
  if (dx) ctx.fillRect(dx > 0 ? cx : cx - 17, cy - 2.5, 17, 5);
  else ctx.fillRect(cx - 2.5, dy > 0 ? cy : cy - 17, 5, 17);
  ctx.fillStyle = dark;
  ctx.beginPath(); ctx.arc(cx, cy, 6, 0, 7); ctx.fill();
  ctx.fillStyle = light;
  ctx.beginPath(); ctx.arc(cx - 1, cy - 1, 3, 0, 7); ctx.fill();

  // 受击闪白
  if (t.hitFlash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${t.hitFlash * 3})`;
    ctx.fillRect(x, y, w, h);
  }

  // 无敌护盾
  if (t.isPlayer && t.shield > 0) {
    const pulse = 0.55 + 0.45 * Math.sin(G.time * 22);
    ctx.strokeStyle = `rgba(120,220,255,${0.35 + pulse * 0.5})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, 19 + pulse * 2, 0, 7); ctx.stroke();
    ctx.strokeStyle = `rgba(255,255,255,${pulse * 0.55})`;
    ctx.beginPath(); ctx.arc(cx, cy, 15 + pulse * 2, 0, 7); ctx.stroke();
    ctx.lineWidth = 1;
  }

  // 携带道具的敌人闪烁
  if (t.hasPowerup && ((G.time * 8) | 0) % 2 === 0) {
    ctx.fillStyle = 'rgba(255,80,80,.35)';
    ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
  }

  // 冻结提示
  if (!t.isPlayer && G.freeze > 0) {
    ctx.fillStyle = 'rgba(140,220,255,.35)';
    ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
  }
}

function drawBullets() {
  for (const b of G.bullets) {
    ctx.fillStyle = '#f6f8fb';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = b.fromPlayer ? 'rgba(255,214,120,.85)' : 'rgba(150,200,255,.85)';
    ctx.fillRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2);
  }
}

function drawGhostSpawns() {
  const cx = G.time;
  for (const s of G.spawns) {
    const r = 5 + 13 * Math.abs(Math.sin(s.t * 11));
    const col = ((cx * 9) | 0) % 2 ? '#ffffff' : '#ff5a5a';
    ctx.save();
    ctx.translate(s.x + TILE / 2, s.y + TILE / 2);
    ctx.rotate(cx * 5);
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(0, -r); ctx.lineTo(r * 0.36, 0); ctx.lineTo(0, r); ctx.lineTo(-r * 0.36, 0); ctx.closePath();
    ctx.moveTo(-r, 0); ctx.lineTo(0, -r * 0.36); ctx.lineTo(r, 0); ctx.lineTo(0, r * 0.36); ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

function drawPowerups() {
  for (const pu of G.powerups) {
    pu.t += 0.016;
    const blink = 0.72 + 0.28 * Math.sin(pu.t * 9);
    const x = pu.x, y = pu.y;
    ctx.globalAlpha = blink;
    ctx.fillStyle = '#101820';
    ctx.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
    ctx.strokeStyle = '#ffc650';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 2, y + 2, TILE - 4, TILE - 4);
    ctx.globalAlpha = 1;
    drawPowerupIcon(x, y, pu.type);
  }
}

function drawPowerupIcon(x, y, type) {
  const cx = x + TILE / 2, cy = y + TILE / 2;
  switch (type) {
    case 'star': {
      ctx.fillStyle = '#ffc650';
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 5 : 11;
        const a = -Math.PI / 2 + i * Math.PI / 5;
        const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.closePath(); ctx.fill();
      break;
    }
    case 'grenade': {
      ctx.fillStyle = '#2c3138';
      ctx.beginPath(); ctx.arc(cx, cy + 2, 9, 0, 7); ctx.fill();
      ctx.fillStyle = '#c9ced6';
      ctx.fillRect(cx - 2, cy - 9, 4, 5);
      ctx.fillStyle = '#ff8a1e';
      ctx.beginPath(); ctx.arc(cx + 4, cy - 9, 3, 0, 7); ctx.fill();
      break;
    }
    case 'helmet': {
      ctx.fillStyle = '#6fd6ff';
      ctx.beginPath();
      ctx.arc(cx, cy + 2, 10, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(cx - 10, cy + 2, 20, 3);
      ctx.fillStyle = '#dff6ff';
      ctx.fillRect(cx - 1, cy - 10, 2, 8);
      break;
    }
    case 'shovel': {
      ctx.fillStyle = '#8a5a2b';
      ctx.fillRect(cx - 2, cy - 11, 4, 12);
      ctx.fillStyle = '#c9ced6';
      ctx.beginPath();
      ctx.moveTo(cx - 7, cy + 1); ctx.lineTo(cx + 7, cy + 1);
      ctx.lineTo(cx + 5, cy + 11); ctx.lineTo(cx - 5, cy + 11);
      ctx.closePath(); ctx.fill();
      break;
    }
    case 'clock': {
      ctx.fillStyle = '#e9edf2';
      ctx.beginPath(); ctx.arc(cx, cy, 10, 0, 7); ctx.fill();
      ctx.strokeStyle = '#2c3138'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy - 6); ctx.moveTo(cx, cy); ctx.lineTo(cx + 5, cy + 3); ctx.stroke();
      ctx.lineWidth = 1;
      break;
    }
    case 'tank': {
      ctx.fillStyle = '#e8c341';
      ctx.fillRect(cx - 10, cy - 3, 20, 11);
      ctx.fillRect(cx - 4, cy - 11, 8, 9);
      ctx.fillStyle = '#2c3138';
      ctx.fillRect(cx - 11, cy + 6, 22, 4);
      break;
    }
  }
}

function drawExplosions() {
  for (const e of G.explosions) {
    const p = e.t / e.dur;
    const cx = e.x, cy = e.y;
    ctx.save();
    if (e.big) {
      const r = 8 + 40 * p;
      ctx.globalAlpha = 1 - p * 0.75;
      circle(cx, cy, r * 0.9, '#c92e12');
      circle(cx, cy, r * 0.66, '#f4772e');
      circle(cx, cy, r * 0.42, '#ffd75e');
      circle(cx, cy, r * 0.2, '#fff8e0');
      // 碎片
      ctx.fillStyle = '#ffd75e';
      for (let i = 0; i < 8; i++) {
        const a = e.seed + i * 0.785 + p * 0.6;
        const d = r * (1.15 + 0.3 * Math.sin(e.seed + i));
        const s = 4 * (1 - p);
        ctx.fillRect(cx + Math.cos(a) * d - s / 2, cy + Math.sin(a) * d - s / 2, s, s);
      }
    } else {
      ctx.globalAlpha = 1 - p;
      circle(cx, cy, 3 + 9 * p, '#ffd75e');
      circle(cx, cy, 2 + 5 * p, '#ffffff');
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

function circle(x, y, r, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath(); ctx.arc(x, y, Math.max(0.5, r), 0, 7); ctx.fill();
}

function drawPopups() {
  ctx.font = 'bold 13px "Courier New", monospace';
  ctx.textAlign = 'center';
  for (const p of G.popups) {
    const a = 1 - p.t / p.dur;
    ctx.globalAlpha = a;
    ctx.fillStyle = '#ffd75e';
    ctx.fillText(p.text, p.x, p.y);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
}

/* ============================================================
 *  HUD
 * ============================================================ */
const scoreEl = document.getElementById('scoreEl');
const hiEl = document.getElementById('hiEl');
const stageEl = document.getElementById('stageEl');
const statusEl = document.getElementById('statusEl');
const statusVal = document.getElementById('statusVal');
const enemyIcons = document.getElementById('enemyIcons');
const lifeIcons = document.getElementById('lifeIcons');
const ectx = enemyIcons.getContext('2d');
const lctx = lifeIcons.getContext('2d');

function drawMiniTank(g, x, y, s, color) {
  g.fillStyle = color;
  g.fillRect(x + s * 0.08, y + s * 0.12, s * 0.22, s * 0.76);
  g.fillRect(x + s * 0.70, y + s * 0.12, s * 0.22, s * 0.76);
  g.fillRect(x + s * 0.30, y + s * 0.30, s * 0.40, s * 0.48);
  g.fillRect(x + s * 0.44, y + s * 0.02, s * 0.12, s * 0.30);
}

function updateHud() {
  scoreEl.textContent = pad(G.score, 6);
  hiEl.textContent = pad(Math.max(G.hi, G.score), 6);
  stageEl.textContent = G.level + 1;

  // 剩余敌人图标
  const remaining = G.queue.length + G.spawns.length + G.tanks.filter(t => !t.isPlayer).length;
  const rows = Math.max(1, Math.min(10, Math.ceil(remaining / 2)));
  enemyIcons.width = 80;
  enemyIcons.height = rows * 19;
  ectx.clearRect(0, 0, enemyIcons.width, enemyIcons.height);
  for (let i = 0; i < Math.min(remaining, 20); i++) {
    const col = i % 2, row = (i / 2) | 0;
    drawMiniTank(ectx, 12 + col * 34, 3 + row * 19, 16, '#c9ced6');
  }

  // 生命图标
  lifeIcons.width = 150; lifeIcons.height = 24;
  lctx.clearRect(0, 0, 150, 24);
  for (let i = 0; i < Math.min(G.lives, 8); i++) drawMiniTank(lctx, 3 + i * 19, 4, 16, '#e8c341');

  // 状态效果
  const st = [];
  if (G.player && G.player.shield > 0) st.push('🛡 ' + G.player.shield.toFixed(0) + 's');
  if (G.freeze > 0) st.push('❄ ' + G.freeze.toFixed(0) + 's');
  if (G.shovel > 0) st.push('⛏ ' + G.shovel.toFixed(0) + 's');
  if (st.length) { statusEl.style.display = ''; statusVal.textContent = st.join('  '); }
  else statusEl.style.display = 'none';
}

/* ============================================================
 *  覆盖层
 * ============================================================ */
const overlay = document.getElementById('overlay');
function showOverlay(html) { overlay.innerHTML = html; overlay.classList.add('show'); }
function hideOverlay() { overlay.classList.remove('show'); overlay.innerHTML = ''; }

function showTitle() {
  showOverlay(`
    <div class="card">
      <h1>坦克大战</h1>
      <div class="sub">TANK BATTLE</div>
      <div class="keys">
        <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / <kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> 移动<br>
        <kbd>空格</kbd> / <kbd>J</kbd> 开炮 &nbsp; <kbd>P</kbd> 暂停<br>
        消灭所有敌人，守住老巢 🦅
      </div>
      <div class="hint blink">按 Enter 或点击开始</div>
    </div>`);
}

/* ============================================================
 *  启动
 * ============================================================ */
loadWorld(LEVELS[0].map);
updateHud();
if (location.hash.startsWith('#play')) startGame();   // 直接开玩（可嵌入 iframe）
else showTitle();

let lastT = performance.now();
function loop(t) {
  const dt = Math.min(0.05, (t - lastT) / 1000);
  lastT = t;
  update(dt);
  render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
