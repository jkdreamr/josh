// The rules. Uplink: two teams of five, one life a round, a buy phase, credits, and an uplink to hold. Deathmatch:
// everyone for themselves with quick respawns. Players and bots both act through the same Input, so the rules treat
// them alike. Pure TS: the renderer, the sound and the HUD read the state and the events after each step.
import { DM_HUBS, botInput, newBrain, type Brain, type BotLevel } from './bots.ts';
import { fieldTo, navOf } from './nav.ts';
import { clamp, lerp, mulberry32, smoothstep, type Rng } from './noise.ts';
import { CROUCH_H, GRAVITY, STAND_H, newHit, raySphere, rayWorld, stepBody, type Body } from './physics.ts';
import { floorAt } from './terrain.ts';
import { ARMOR, KILL_REWARD, LOSS_REWARD, LOSS_STREAK_BONUS, MAX_CREDITS, NADES, START_CREDITS, WEAPONS, WIN_REWARD, applyDamage, interval, kickOf, rangeMul, type WeaponId } from './weapons.ts';
import { ARENA, SITE_R, SPAWN_R, yawTo, type Surface, type World } from './world.ts';

export type Mode = 'uplink' | 'dm';
export type Level = BotLevel;
export type Zone = 'head' | 'body' | 'leg';
export type ShopItem = WeaponId | 'light' | 'heavy' | 'frag' | 'smoke';

export const DEG = Math.PI / 180;
export const RUN = 5.8;
export const WALK = 3;
export const CROUCH_SPEED = 2.1;
export const JUMP = 6.2;
export const BULLET_G = 9.81;
export const ROUNDS_TO_WIN = 7;
export const BUY_TIME = 15;
export const ROUND_TIME = 100;
export const END_TIME = 4.5;
export const CAPTURE = 10;
export const DM_KILLS = 25;
export const DM_TIME = 300;
export const RESPAWN = 3;

export type Input = {
  /** Strafe (+1 right) and forward (+1) axes, -1 to 1. */
  mx: number;
  mz: number;
  /** Where to look, radians. Positive pitch looks up. */
  yaw: number;
  pitch: number;
  fire: boolean;
  ads: boolean;
  crouch: boolean;
  walk: boolean;
  jump: boolean;
  reload: boolean;
  /** Switch to the primary (0) or the sidearm (1), or -1. */
  slot: number;
  throw: 'frag' | 'smoke' | null;
  buy: ShopItem | null;
};
export const idleInput = (yaw = 0, pitch = 0): Input => ({ mx: 0, mz: 0, yaw, pitch, fire: false, ads: false, crouch: false, walk: false, jump: false, reload: false, slot: -1, throw: null, buy: null });

export type Gun = { id: WeaponId; mag: number; reserve: number; fresh: boolean };

export type Actor = {
  id: number;
  name: string;
  team: number;
  bot: boolean;
  brain: Brain | null;
  /** Picks the outfit and skin tone. */
  look: number;
  body: Body;
  yaw: number;
  pitch: number;
  crouch: number;
  alive: boolean;
  hp: number;
  armor: number;
  /** Primary and sidearm. */
  guns: [Gun | null, Gun | null];
  slot: 0 | 1;
  frags: number;
  smokes: number;
  fireCd: number;
  fireHeld: boolean;
  reloadT: number;
  switchT: number;
  /** Aim down sights, 0 to 1. */
  ads: number;
  spray: number;
  lastShot: number;
  bloom: number;
  /** Recoil kick not yet recovered, degrees. */
  kickP: number;
  walking: boolean;
  credits: number;
  boughtArmor: number;
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  /** Combat score. */
  cs: number;
  dmgFrom: number[];
  hurtT: number;
  hurtFrom: number;
  deathT: number;
  killer: number;
  killedWith: WeaponId | 'frag' | null;
  killedHead: boolean;
  respawnT: number;
  shield: number;
  stepDist: number;
  /** Walk cycle phase for the animation. */
  phase: number;
  dmPick: WeaponId;
};

export type Bullet = { x: number; y: number; z: number; px: number; py: number; pz: number; vx: number; vy: number; vz: number; owner: number; w: WeaponId; life: number; dist: number; live: boolean };
export type Nade = { kind: 'frag' | 'smoke'; x: number; y: number; z: number; vx: number; vy: number; vz: number; fuse: number; owner: number; rest: boolean; spin: number };
export type Smoke = { x: number; y: number; z: number; age: number; life: number; r: number };
export type Sound = { x: number; z: number; t: number; team: number; range: number; who: number };
export type Kill = { t: number; killer: number; victim: number; w: WeaponId | 'frag'; head: boolean };

export type Ev =
  | { t: 'shot'; a: number; w: WeaponId; x: number; y: number; z: number; dx: number; dy: number; dz: number }
  | { t: 'impact'; x: number; y: number; z: number; nx: number; ny: number; nz: number; s: Surface }
  | { t: 'hit'; a: number; v: number; dmg: number; zone: Zone; armor: boolean; x: number; y: number; z: number; kill: boolean }
  | { t: 'kill'; k: Kill }
  | { t: 'boom'; x: number; y: number; z: number }
  | { t: 'smoke'; x: number; y: number; z: number }
  | { t: 'throw'; a: number; kind: 'frag' | 'smoke' }
  | { t: 'bounce'; x: number; y: number; z: number }
  | { t: 'reload'; a: number; w: WeaponId }
  | { t: 'empty'; a: number }
  | { t: 'step'; a: number; loud: boolean; s: Surface }
  | { t: 'jump'; a: number }
  | { t: 'land'; a: number }
  | { t: 'swap'; a: number }
  | { t: 'buy'; a: number; item: ShopItem }
  | { t: 'phase'; phase: Phase }
  | { t: 'round'; winner: number; why: 'elim' | 'cap' | 'time' }
  | { t: 'capture'; team: number }
  | { t: 'spawn'; a: number };

export type Phase = 'buy' | 'live' | 'end' | 'over';

export type Match = {
  mode: Mode;
  level: Level;
  world: World;
  rng: Rng;
  actors: Actor[];
  time: number;
  phase: Phase;
  phaseT: number;
  round: number;
  score: [number, number];
  site: number;
  cap: [number, number];
  /** Who stands on the uplink right now, per team. */
  onSite: [number, number];
  lossStreak: [number, number];
  last: { winner: number; why: 'elim' | 'cap' | 'time' } | null;
  bullets: Bullet[];
  nades: Nade[];
  smokes: Smoke[];
  sounds: Sound[];
  events: Ev[];
  feed: Kill[];
  /** Last time each actor was seen by your team. */
  spotted: number[];
  spotT: number;
  winner: number;
  /** Deathmatch clock. */
  clock: number;
};

const BOT_NAMES = ['Vega', 'Rook', 'Sable', 'Juno', 'Kite', 'Onyx', 'Mako', 'Pike', 'Wren', 'Ash', 'Bishop', 'Cobalt', 'Drift', 'Ember', 'Flint', 'Haze', 'Ivy', 'Jett', 'Lark', 'Moss', 'Nova', 'Quill', 'Reed', 'Slate'];

function newActor(id: number, name: string, team: number, bot: boolean, level: Level, look: number): Actor {
  return {
    id,
    name,
    team,
    bot,
    brain: bot ? newBrain(level, id) : null,
    look,
    body: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, onGround: true, height: STAND_H, swim: false },
    yaw: 0,
    pitch: 0,
    crouch: 0,
    alive: true,
    hp: 100,
    armor: 0,
    guns: [null, gun('wren')],
    slot: 1,
    frags: 0,
    smokes: 0,
    fireCd: 0,
    fireHeld: false,
    reloadT: 0,
    switchT: 0,
    ads: 0,
    spray: 0,
    lastShot: -9,
    bloom: 0,
    kickP: 0,
    walking: false,
    credits: START_CREDITS,
    boughtArmor: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    damage: 0,
    cs: 0,
    dmgFrom: [],
    hurtT: -9,
    hurtFrom: -1,
    deathT: -9,
    killer: -1,
    killedWith: null,
    killedHead: false,
    respawnT: 0,
    shield: 0,
    stepDist: 0,
    phase: 0,
    dmPick: 'kestrel',
  };
}

export const gun = (id: WeaponId): Gun => ({ id, mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve, fresh: false });

export function createMatch(world: World, mode: Mode, level: Level, opts: { name?: string; seed?: number; dmPick?: WeaponId } = {}): Match {
  const rng = mulberry32(opts.seed ?? Math.floor(Math.random() * 2 ** 31));
  const names = [...BOT_NAMES].sort(() => rng() - 0.5);
  const count = mode === 'uplink' ? 10 : 8;
  const actors: Actor[] = [];
  for (let i = 0; i < count; i++) {
    const team = mode === 'uplink' ? (i < 5 ? 0 : 1) : i;
    const a = newActor(i, i === 0 ? (opts.name ?? 'You') : names[i % names.length], team, i > 0, level, Math.floor(rng() * 1e6));
    a.dmgFrom = new Array(count).fill(0);
    actors.push(a);
  }
  if (opts.dmPick) actors[0].dmPick = opts.dmPick;
  // the bots' map knowledge, built now so no frame pays for it mid round
  navOf(world);
  if (mode === 'uplink') world.sites.forEach((s, k) => fieldTo(world, `site${k}`, s.x, s.z));
  else world.dmSpawns.slice(0, DM_HUBS).forEach((p, k) => fieldTo(world, `dm${k}`, p.x, p.z));
  const m: Match = {
    mode,
    level,
    world,
    rng,
    actors,
    time: 0,
    phase: 'buy',
    phaseT: BUY_TIME,
    round: 0,
    score: [0, 0],
    site: 0,
    cap: [0, 0],
    onSite: [0, 0],
    lossStreak: [0, 0],
    last: null,
    bullets: [],
    nades: [],
    smokes: [],
    sounds: [],
    events: [],
    feed: [],
    spotted: new Array(count).fill(-9),
    spotT: 0,
    winner: -1,
    clock: 0,
  };
  if (mode === 'uplink') startRound(m);
  else {
    m.phase = 'live';
    m.phaseT = DM_TIME;
    for (const a of actors) {
      if (a.bot) a.dmPick = (['kestrel', 'kestrel', 'hornet', 'lancer', 'mauler', 'kestrel', 'longbow', 'hornet'] as WeaponId[])[Math.floor(rng() * 8)];
      respawn(m, a);
    }
  }
  return m;
}

export const eyeY = (a: Actor) => a.body.y + a.body.height - 0.14;
export const currentGun = (a: Actor) => a.guns[a.slot] ?? a.guns[1] ?? a.guns[0];
export const isEnemy = (a: Actor, b: Actor) => a.team !== b.team;
export const me = (m: Match) => m.actors[0];

export function viewDir(yaw: number, pitch: number) {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}

/** Hitbox spheres: [height above the feet as a share of body height, radius, zone]. */
const HITBOX: [number, number, Zone][] = [
  [0.72, 0.25, 'body'],
  [0.54, 0.23, 'body'],
  [0.34, 0.19, 'leg'],
  [0.13, 0.17, 'leg'],
];
export const HEAD_R = 0.14;

/** The first hitbox a segment crosses on any live actor other than the shooter's team. */
function hitActors(m: Match, b: Bullet, dx: number, dy: number, dz: number, len: number): { a: Actor; t: number; zone: Zone } | null {
  let best: { a: Actor; t: number; zone: Zone } | null = null;
  const shooter = m.actors[b.owner];
  for (const a of m.actors) {
    if (!a.alive || a.id === b.owner || (shooter && !isEnemy(shooter, a))) continue;
    const cx = a.body.x;
    const cz = a.body.z;
    const h = a.body.height;
    // broad phase: the segment must pass within two meters of the actor's middle
    const mx = cx - b.px;
    const my = a.body.y + h / 2 - b.py;
    const mz = cz - b.pz;
    const along = clamp(mx * dx + my * dy + mz * dz, 0, len);
    if ((mx - dx * along) ** 2 + (my - dy * along) ** 2 + (mz - dz * along) ** 2 > 4) continue;
    const limit = best ? best.t : len;
    // the head leans forward with the pitch a little
    const f = viewDir(a.yaw, 0);
    const ht = raySphere(b.px, b.py, b.pz, dx, dy, dz, cx + f.x * 0.04, a.body.y + h - 0.13, cz + f.z * 0.04, HEAD_R, limit);
    if (ht >= 0) best = { a, t: ht, zone: 'head' };
    for (const [k, r, zone] of HITBOX) {
      const tt = raySphere(b.px, b.py, b.pz, dx, dy, dz, cx, a.body.y + h * k, cz, r, best ? best.t : len);
      if (tt >= 0) best = { a, t: tt, zone };
    }
  }
  return best;
}

const hit = newHit();

function stepBullets(m: Match, dt: number) {
  const w = m.world;
  for (const b of m.bullets) {
    if (!b.live) continue;
    b.px = b.x;
    b.py = b.y;
    b.pz = b.z;
    b.vy -= BULLET_G * dt;
    const nx = b.x + b.vx * dt;
    const ny = b.y + b.vy * dt;
    const nz = b.z + b.vz * dt;
    let dx = nx - b.x;
    let dy = ny - b.y;
    let dz = nz - b.z;
    const len = Math.hypot(dx, dy, dz);
    b.life -= dt;
    if (len < 1e-6) continue;
    dx /= len;
    dy /= len;
    dz /= len;
    rayWorld(w, b.x, b.y, b.z, dx, dy, dz, len, hit);
    const wallT = hit.kind === 'none' ? len : hit.t;
    const who = hitActors(m, b, dx, dy, dz, wallT);
    if (who) {
      const def = WEAPONS[b.w];
      const travelled = b.dist + who.t;
      const mul = who.zone === 'head' ? def.head : who.zone === 'leg' ? def.leg : 1;
      const hx = b.x + dx * who.t;
      const hy = b.y + dy * who.t;
      const hz = b.z + dz * who.t;
      damage(m, who.a, def.dmg * mul * rangeMul(def, travelled), b.owner, b.w, who.zone, hx, hy, hz);
      b.x = hx;
      b.y = hy;
      b.z = hz;
      b.live = false;
      continue;
    }
    if (hit.kind !== 'none') {
      b.x += dx * hit.t;
      b.y += dy * hit.t;
      b.z += dz * hit.t;
      b.live = false;
      m.events.push({ t: 'impact', x: b.x, y: b.y, z: b.z, nx: hit.nx, ny: hit.ny, nz: hit.nz, s: hit.s });
      continue;
    }
    b.x = nx;
    b.y = ny;
    b.z = nz;
    b.dist += len;
    if (b.life <= 0 || b.dist > 900 || Math.abs(b.x) > 520 || Math.abs(b.z) > 520) b.live = false;
  }
  // keep the list short: the renderer still sees a bullet on the frame it stops
  if (m.bullets.length > 64) m.bullets = m.bullets.filter((b) => b.live);
}

function damage(m: Match, v: Actor, raw: number, from: number, w: WeaponId | 'frag', zone: Zone, x: number, y: number, z: number) {
  if (!v.alive || raw <= 0) return;
  if (v.shield > 0) return;
  const before = v.hp + v.armor;
  const res = applyDamage(v.hp, v.armor, raw, w === 'frag' ? 1 : WEAPONS[w].armorPen);
  const hadArmor = v.armor > 0;
  v.hp = res.hp;
  v.armor = Math.max(0, res.armor);
  const dealt = Math.min(before, raw);
  const att = m.actors[from];
  if (att && att !== v) {
    att.damage += dealt;
    att.cs += Math.round(dealt);
    v.dmgFrom[from] = (v.dmgFrom[from] ?? 0) + dealt;
  }
  v.hurtT = m.time;
  v.hurtFrom = from;
  const kill = v.hp <= 0;
  m.events.push({ t: 'hit', a: from, v: v.id, dmg: Math.round(dealt), zone, armor: hadArmor, x, y, z, kill });
  if (kill) die(m, v, from, w, zone === 'head');
}

function die(m: Match, v: Actor, from: number, w: WeaponId | 'frag', head: boolean) {
  v.alive = false;
  v.hp = 0;
  v.deathT = m.time;
  v.killer = from;
  v.killedWith = w;
  v.killedHead = head;
  v.deaths++;
  v.reloadT = 0;
  v.ads = 0;
  const att = m.actors[from];
  if (att && att !== v && isEnemy(att, v)) {
    att.kills++;
    att.cs += 150 + (head ? 30 : 0);
    if (m.mode === 'uplink') att.credits = Math.min(MAX_CREDITS, att.credits + KILL_REWARD);
  }
  for (const o of m.actors)
    if (o !== att && o !== v && isEnemy(o, v) && (v.dmgFrom[o.id] ?? 0) >= 40) {
      o.assists++;
      o.cs += 50;
    }
  v.dmgFrom.fill(0);
  const k: Kill = { t: m.time, killer: from, victim: v.id, w, head };
  m.feed.push(k);
  if (m.feed.length > 8) m.feed.shift();
  m.events.push({ t: 'kill', k });
  if (m.mode === 'uplink') {
    v.guns[0] = null;
    v.armor = 0;
    v.frags = 0;
    v.smokes = 0;
  } else v.respawnT = RESPAWN;
}

// ---------------------------------------------------------------------------------------------------------------
// rounds

function place(m: Match, a: Actor, x: number, z: number, yaw: number) {
  const y = floorAt(m.world.terrain, x, z) + 0.05;
  a.body.x = x;
  a.body.z = z;
  a.body.y = y;
  a.body.vx = a.body.vy = a.body.vz = 0;
  a.body.onGround = true;
  a.body.height = STAND_H;
  a.crouch = 0;
  a.yaw = yaw;
  a.pitch = 0;
}

function resetCombat(a: Actor) {
  a.fireCd = 0;
  a.reloadT = 0;
  a.switchT = 0;
  a.ads = 0;
  a.spray = 0;
  a.bloom = 0;
  a.kickP = 0;
  a.fireHeld = false;
}

export function startRound(m: Match) {
  m.round++;
  m.phase = 'buy';
  m.phaseT = BUY_TIME + (m.round === 1 ? 5 : 0);
  m.cap = [0, 0];
  m.onSite = [0, 0];
  m.site = Math.floor(m.rng() * 3);
  m.bullets = [];
  m.nades = [];
  m.smokes = [];
  m.sounds = [];
  m.last = null;
  const w = m.world;
  const seen = [0, 0];
  for (const a of m.actors) {
    const s = w.spawns[a.team];
    const slot = s.slots[seen[a.team]++ % s.slots.length];
    if (!a.alive) {
      a.guns = [null, gun('wren')];
      a.armor = 0;
    }
    for (const g of a.guns) if (g) {
      g.mag = WEAPONS[g.id].mag;
      g.reserve = WEAPONS[g.id].reserve;
      g.fresh = false;
    }
    a.boughtArmor = 0;
    a.alive = true;
    a.hp = 100;
    a.slot = a.guns[0] ? 0 : 1;
    a.dmgFrom.fill(0);
    resetCombat(a);
    place(m, a, slot.x, slot.z, slot.yaw);
    if (a.brain) a.brain.reset = true;
  }
  m.events.push({ t: 'phase', phase: 'buy' });
}

function endRound(m: Match, winner: number, why: 'elim' | 'cap' | 'time') {
  m.phase = 'end';
  m.phaseT = END_TIME;
  m.last = { winner, why };
  if (winner >= 0) {
    m.score[winner]++;
    m.lossStreak[winner] = 0;
    m.lossStreak[1 - winner]++;
  }
  for (const a of m.actors) {
    const won = winner === a.team;
    const pay = won ? WIN_REWARD : LOSS_REWARD + (winner >= 0 ? LOSS_STREAK_BONUS * Math.min(2, m.lossStreak[a.team] - 1) : 0);
    a.credits = Math.min(MAX_CREDITS, a.credits + pay);
    if (won) a.cs += 60;
  }
  m.events.push({ t: 'round', winner, why });
  if (winner === 0 && why === 'cap') m.events.push({ t: 'capture', team: 0 });
  if (winner === 1 && why === 'cap') m.events.push({ t: 'capture', team: 1 });
}

function respawn(m: Match, a: Actor) {
  const pts = m.world.dmSpawns;
  let best = pts[0];
  let bestD = -1;
  for (const p of pts) {
    let near = Infinity;
    for (const o of m.actors) if (o !== a && o.alive) near = Math.min(near, Math.hypot(o.body.x - p.x, o.body.z - p.z));
    const d = near + m.rng() * 25;
    if (d > bestD) {
      bestD = d;
      best = p;
    }
  }
  a.alive = true;
  a.hp = 100;
  a.armor = 25;
  a.guns = [gun(a.dmPick), gun('wren')];
  a.slot = 0;
  a.frags = 1;
  a.smokes = 0;
  a.shield = 1.5;
  a.dmgFrom.fill(0);
  resetCombat(a);
  place(m, a, best.x, best.z, best.yaw);
  m.events.push({ t: 'spawn', a: a.id });
}

const teamAlive = (m: Match, team: number) => m.actors.reduce((n, a) => n + (a.alive && a.team === team ? 1 : 0), 0);
export const aliveOf = teamAlive;

function stepRules(m: Match, dt: number) {
  if (m.mode === 'dm') {
    m.clock += dt;
    m.phaseT = Math.max(0, DM_TIME - m.clock);
    if (m.phase !== 'live') return;
    for (const a of m.actors) {
      if (!a.alive) {
        a.respawnT -= dt;
        if (a.respawnT <= 0) respawn(m, a);
      } else if (m.time - a.hurtT > 5 && a.hp < 100) a.hp = Math.min(100, a.hp + 25 * dt);
    }
    let top = m.actors[0];
    for (const a of m.actors) if (a.kills > top.kills) top = a;
    if (top.kills >= DM_KILLS || m.clock >= DM_TIME) {
      m.phase = 'over';
      m.winner = top.id;
      top.cs += 300;
      m.events.push({ t: 'phase', phase: 'over' });
    }
    return;
  }
  m.phaseT -= dt;
  if (m.phase === 'buy') {
    if (m.phaseT <= 0) {
      m.phase = 'live';
      m.phaseT = ROUND_TIME;
      m.events.push({ t: 'phase', phase: 'live' });
    }
    return;
  }
  if (m.phase === 'end') {
    if (m.phaseT <= 0) {
      if (m.score[0] >= ROUNDS_TO_WIN || m.score[1] >= ROUNDS_TO_WIN || m.round >= 24) {
        m.phase = 'over';
        m.winner = m.score[0] > m.score[1] ? 0 : m.score[1] > m.score[0] ? 1 : -1;
        if (m.winner >= 0) for (const a of m.actors) if (a.team === m.winner) a.cs += 400;
        m.events.push({ t: 'phase', phase: 'over' });
      } else startRound(m);
    }
    return;
  }
  if (m.phase !== 'live') return;
  const s = m.world.sites[m.site];
  m.onSite = [0, 0];
  for (const a of m.actors)
    if (a.alive && Math.hypot(a.body.x - s.x, a.body.z - s.z) < SITE_R && Math.abs(a.body.y - s.y) < 4) m.onSite[a.team]++;
  if (m.onSite[0] > 0 && m.onSite[1] === 0) m.cap[0] += dt;
  if (m.onSite[1] > 0 && m.onSite[0] === 0) m.cap[1] += dt;
  const a0 = teamAlive(m, 0);
  const a1 = teamAlive(m, 1);
  if (a0 === 0 && a1 === 0) endRound(m, -1, 'elim');
  else if (a1 === 0) endRound(m, 0, 'elim');
  else if (a0 === 0) endRound(m, 1, 'elim');
  else if (m.cap[0] >= CAPTURE) endRound(m, 0, 'cap');
  else if (m.cap[1] >= CAPTURE) endRound(m, 1, 'cap');
  else if (m.phaseT <= 0) {
    const w = m.cap[0] > m.cap[1] + 0.05 ? 0 : m.cap[1] > m.cap[0] + 0.05 ? 1 : a0 > a1 ? 0 : a1 > a0 ? 1 : -1;
    endRound(m, w, 'time');
  }
}

// ---------------------------------------------------------------------------------------------------------------
// buying

/** Whether an actor can buy right now (buy phase, inside its spawn). */
export function canShop(m: Match, a: Actor) {
  if (m.mode !== 'uplink' || m.phase !== 'buy' || !a.alive) return false;
  const s = m.world.spawns[a.team];
  return Math.hypot(a.body.x - s.x, a.body.z - s.z) < SPAWN_R + 2;
}

export function priceOf(item: ShopItem) {
  if (item === 'light' || item === 'heavy') return ARMOR[item].price;
  if (item === 'frag' || item === 'smoke') return NADES[item].price;
  return WEAPONS[item].price;
}

/** Owned already (nothing to buy)? */
export function owns(a: Actor, item: ShopItem) {
  if (item === 'light') return a.armor >= ARMOR.light.amount;
  if (item === 'heavy') return a.armor >= ARMOR.heavy.amount;
  if (item === 'frag') return a.frags >= NADES.frag.max;
  if (item === 'smoke') return a.smokes >= NADES.smoke.max;
  return a.guns[0]?.id === item || a.guns[1]?.id === item;
}

/** Buys one thing; a gun or armor bought this round is refunded when swapped for another. */
export function buy(m: Match, a: Actor, item: ShopItem) {
  if (!canShop(m, a) || owns(a, item)) return false;
  let refund = 0;
  if (item === 'light' || item === 'heavy') {
    refund = a.boughtArmor;
    const cost = ARMOR[item].price - refund;
    if (a.credits < cost) return false;
    a.credits -= cost;
    a.armor = ARMOR[item].amount;
    a.boughtArmor = ARMOR[item].price;
  } else if (item === 'frag' || item === 'smoke') {
    if (a.credits < NADES[item].price) return false;
    a.credits -= NADES[item].price;
    if (item === 'frag') a.frags++;
    else a.smokes++;
  } else {
    const def = WEAPONS[item];
    const k = def.slot === 'primary' ? 0 : 1;
    const old = a.guns[k];
    if (old?.fresh) refund = WEAPONS[old.id].price;
    const cost = def.price - refund;
    if (a.credits < cost) return false;
    a.credits -= cost;
    a.guns[k] = { ...gun(item), fresh: true };
    a.slot = k as 0 | 1;
    a.switchT = def.equip;
    a.reloadT = 0;
  }
  m.events.push({ t: 'buy', a: a.id, item });
  return true;
}

// ---------------------------------------------------------------------------------------------------------------
// actions

/** Current cone half angle in degrees for an actor's next shot. */
export function spreadOf(a: Actor) {
  const g = currentGun(a);
  if (!g) return 0;
  const w = WEAPONS[g.id];
  const sp = Math.hypot(a.body.vx, a.body.vz) / RUN;
  let s = (w.base + a.bloom) * lerp(1, w.ads, a.ads);
  s += w.move * smoothstep(0.2, 1, sp) * lerp(1, Math.max(w.ads, 0.6), a.ads);
  if (!a.body.onGround && !a.body.swim) s += w.air;
  if (a.crouch > 0.5 && a.body.onGround) s *= 0.8;
  return s;
}

/** A unit vector within a cone of `deg` half angle around (dx, dy, dz), denser toward the middle. */
function inCone(r: Rng, dx: number, dy: number, dz: number, deg: number) {
  if (deg <= 0) return { x: dx, y: dy, z: dz };
  const ang = deg * DEG * Math.sqrt(r()) * (0.35 + 0.65 * r());
  const rot = r() * Math.PI * 2;
  // a basis around the direction
  let ux = -dz;
  let uy = 0;
  let uz = dx;
  let ul = Math.hypot(ux, uy, uz);
  if (ul < 1e-5) {
    ux = 1;
    uy = 0;
    uz = 0;
    ul = 1;
  }
  ux /= ul;
  uy /= ul;
  uz /= ul;
  const vx = dy * uz - dz * uy;
  const vy = dz * ux - dx * uz;
  const vz = dx * uy - dy * ux;
  const s = Math.sin(ang);
  const c = Math.cos(ang);
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  return { x: dx * c + (ux * cr + vx * sr) * s, y: dy * c + (uy * cr + vy * sr) * s, z: dz * c + (uz * cr + vz * sr) * s };
}

function fire(m: Match, a: Actor) {
  const g = currentGun(a);
  if (!g) return;
  const w = WEAPONS[g.id];
  if (g.mag <= 0) {
    if (!a.fireHeld) m.events.push({ t: 'empty', a: a.id });
    startReload(m, a);
    return;
  }
  if (m.time - a.lastShot > Math.max(0.3, interval(w) * 1.6)) a.spray = 0;
  g.mag--;
  a.fireCd += interval(w);
  a.shield = 0;
  const spread = spreadOf(a);
  const d = viewDir(a.yaw, a.pitch);
  const ex = a.body.x;
  const ey = eyeY(a);
  const ez = a.body.z;
  const zero = w.cls === 'pistol' || w.cls === 'smg' || w.cls === 'shotgun' ? 40 : 100;
  const lift = (BULLET_G * (zero / w.speed)) / 2;
  for (let p = 0; p < w.pellets; p++) {
    let dir = inCone(m.rng, d.x, d.y, d.z, spread);
    if (w.pellets > 1) dir = inCone(m.rng, dir.x, dir.y, dir.z, w.pelletSpread);
    m.bullets.push({ x: ex, y: ey, z: ez, px: ex, py: ey, pz: ez, vx: dir.x * w.speed, vy: dir.y * w.speed + lift, vz: dir.z * w.speed, owner: a.id, w: g.id, life: 1.6, dist: 0, live: true });
  }
  const [up, side] = kickOf(w, a.spray);
  const k = (a.crouch > 0.5 ? 0.85 : 1) * (1 - a.ads * 0.15);
  a.pitch = clamp(a.pitch + up * k * DEG, -1.5, 1.5);
  a.yaw += side * k * DEG;
  a.kickP += up * k;
  a.bloom = Math.min(w.bloomMax, a.bloom + w.bloom);
  a.spray++;
  a.lastShot = m.time;
  m.events.push({ t: 'shot', a: a.id, w: g.id, x: ex, y: ey, z: ez, dx: d.x, dy: d.y, dz: d.z });
  m.sounds.push({ x: ex, z: ez, t: m.time, team: a.team, range: w.cls === 'sniper' ? 160 : 90, who: a.id });
}

function startReload(m: Match, a: Actor) {
  const g = currentGun(a);
  if (!g || a.reloadT > 0 || a.switchT > 0) return;
  const w = WEAPONS[g.id];
  const spare = m.mode === 'dm' ? Infinity : g.reserve;
  if (g.mag >= w.mag || spare <= 0) return;
  a.reloadT = w.reload;
  a.ads = Math.min(a.ads, 0.3);
  m.events.push({ t: 'reload', a: a.id, w: g.id });
}

function throwNade(m: Match, a: Actor, kind: 'frag' | 'smoke') {
  if (kind === 'frag' ? a.frags <= 0 : a.smokes <= 0) return;
  if (a.switchT > 0.2) return;
  if (kind === 'frag') a.frags--;
  else a.smokes--;
  const d = viewDir(a.yaw, a.pitch + 0.12);
  const sp = 17;
  m.nades.push({ kind, x: a.body.x + d.x * 0.5, y: eyeY(a) - 0.1, z: a.body.z + d.z * 0.5, vx: d.x * sp + a.body.vx * 0.5, vy: d.y * sp + 1.5, vz: d.z * sp + a.body.vz * 0.5, fuse: kind === 'frag' ? 2.3 : 1.5, owner: a.id, rest: false, spin: 0 });
  a.switchT = Math.max(a.switchT, 0.4);
  a.reloadT = 0;
  a.ads = 0;
  m.events.push({ t: 'throw', a: a.id, kind });
}

const nadeHit = newHit();
function stepNades(m: Match, dt: number) {
  const w = m.world;
  for (const n of m.nades) {
    n.fuse -= dt;
    if (!n.rest) {
      n.vy -= GRAVITY * 0.7 * dt;
      const dx = n.vx * dt;
      const dy = n.vy * dt;
      const dz = n.vz * dt;
      const len = Math.hypot(dx, dy, dz);
      n.spin += len * 4;
      if (len > 1e-6) {
        rayWorld(w, n.x, n.y, n.z, dx / len, dy / len, dz / len, len + 0.08, nadeHit);
        if (nadeHit.kind !== 'none') {
          const t = Math.max(0, nadeHit.t - 0.08);
          n.x += (dx / len) * t;
          n.y += (dy / len) * t;
          n.z += (dz / len) * t;
          const vn = n.vx * nadeHit.nx + n.vy * nadeHit.ny + n.vz * nadeHit.nz;
          n.vx = (n.vx - 1.45 * vn * nadeHit.nx) * 0.6;
          n.vy = (n.vy - 1.45 * vn * nadeHit.ny) * 0.6;
          n.vz = (n.vz - 1.45 * vn * nadeHit.nz) * 0.6;
          if (Math.abs(vn) > 2) m.events.push({ t: 'bounce', x: n.x, y: n.y, z: n.z });
          if (nadeHit.ny > 0.6 && Math.hypot(n.vx, n.vy, n.vz) < 1.2) n.rest = true;
          if (nadeHit.kind === 'water' && !w.terrain.ice) n.rest = true;
        } else {
          n.x += dx;
          n.y += dy;
          n.z += dz;
        }
      }
      const fl = floorAt(w.terrain, n.x, n.z);
      if (n.y < fl + 0.06) {
        n.y = fl + 0.06;
        if (n.vy < 0) n.vy = -n.vy * 0.35;
        n.vx *= 0.7;
        n.vz *= 0.7;
        if (Math.hypot(n.vx, n.vy, n.vz) < 1.2) n.rest = true;
      }
    }
    if (n.fuse <= 0) {
      if (n.kind === 'frag') explode(m, n);
      else {
        m.smokes.push({ x: n.x, y: n.y, z: n.z, age: 0, life: 15, r: 0 });
        m.events.push({ t: 'smoke', x: n.x, y: n.y, z: n.z });
      }
    }
  }
  m.nades = m.nades.filter((n) => n.fuse > 0);
  for (const s of m.smokes) {
    s.age += dt;
    s.r = 5.6 * smoothstep(0, 1.6, s.age) * (1 - smoothstep(s.life - 1.5, s.life, s.age) * 0.6);
  }
  m.smokes = m.smokes.filter((s) => s.age < s.life);
}

function explode(m: Match, n: Nade) {
  m.events.push({ t: 'boom', x: n.x, y: n.y, z: n.z });
  m.sounds.push({ x: n.x, z: n.z, t: m.time, team: m.actors[n.owner]?.team ?? -1, range: 120, who: n.owner });
  const R = 7.5;
  for (const a of m.actors) {
    if (!a.alive) continue;
    const owner = m.actors[n.owner];
    if (owner && a !== owner && !isEnemy(owner, a)) continue;
    const cy = a.body.y + a.body.height * 0.55;
    const d = Math.hypot(a.body.x - n.x, cy - n.y, a.body.z - n.z);
    if (d > R) continue;
    const dx = a.body.x - n.x;
    const dy = cy - (n.y + 0.3);
    const dz = a.body.z - n.z;
    const l = Math.hypot(dx, dy, dz) || 1;
    rayWorld(m.world, n.x, n.y + 0.3, n.z, dx / l, dy / l, dz / l, l, nadeHit);
    const cover = nadeHit.kind === 'none' ? 1 : 0.2;
    damage(m, a, 125 * Math.pow(1 - d / R, 1.25) * cover, n.owner, 'frag', 'body', a.body.x, cy, a.body.z);
  }
}

/** Does any smoke cloud cut the line between two points? */
export function smokeBlocks(m: Match, ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
  for (const s of m.smokes) {
    if (s.r < 1) continue;
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const l2 = dx * dx + dy * dy + dz * dz || 1;
    const k = clamp(((s.x - ax) * dx + (s.y + 1.2 - ay) * dy + (s.z - az) * dz) / l2, 0, 1);
    const d = Math.hypot(ax + dx * k - s.x, ay + dy * k - s.y - 1.2, az + dz * k - s.z);
    if (d < s.r * 0.88) return true;
  }
  return false;
}

/** Applies one actor's input for a frame. */
function act(m: Match, a: Actor, inp: Input, dt: number) {
  const b = a.body;
  a.yaw = inp.yaw;
  a.pitch = clamp(inp.pitch, -1.45, 1.45);
  if (!a.alive) return;
  // buying
  if (inp.buy) buy(m, a, inp.buy);
  // weapon switch
  if ((inp.slot === 0 || inp.slot === 1) && inp.slot !== a.slot && a.guns[inp.slot]) {
    a.slot = inp.slot;
    const nw = WEAPONS[a.guns[inp.slot]!.id];
    a.switchT = nw.equip;
    a.reloadT = 0;
    a.ads = 0;
    a.spray = 0;
    m.events.push({ t: 'swap', a: a.id });
  }
  const g = currentGun(a);
  const w = g ? WEAPONS[g.id] : WEAPONS.wren;
  // timers
  a.fireCd = Math.max(-dt, a.fireCd - dt);
  a.shield = Math.max(0, a.shield - dt);
  if (a.switchT > 0) a.switchT = Math.max(0, a.switchT - dt);
  if (a.reloadT > 0) {
    a.reloadT -= dt;
    if (a.reloadT <= 0) {
      a.reloadT = 0;
      const cg = currentGun(a);
      if (cg) {
        const need = WEAPONS[cg.id].mag - cg.mag;
        const take = m.mode === 'dm' ? need : Math.min(need, cg.reserve);
        cg.mag += take;
        if (m.mode !== 'dm') cg.reserve -= take;
      }
    }
  }
  if (m.time - a.lastShot > interval(w) * 1.2) a.bloom = Math.max(0, a.bloom - dt * (w.bloomMax * 2.5 + 2));
  // recoil comes back down once you stop firing
  if (a.kickP > 0 && m.time - a.lastShot > Math.min(0.2, interval(w) * 1.5)) {
    const back = Math.min(a.kickP, dt * (8 + a.kickP * 6)) * 0.75;
    a.pitch -= back * DEG;
    a.kickP = Math.max(0, a.kickP - back / 0.75);
  }
  // aiming
  const canAds = a.reloadT <= 0 && a.switchT <= 0 && !b.swim;
  const adsTarget = inp.ads && canAds ? 1 : 0;
  a.ads = clamp(a.ads + (adsTarget ? 1 : -1.6) * (dt / w.adsTime), 0, 1);
  // crouch
  const wantCrouch = inp.crouch && !b.swim;
  a.crouch = clamp(a.crouch + (wantCrouch ? 1 : -1) * dt * 7, 0, 1);
  b.height = lerp(STAND_H, CROUCH_H, a.crouch);
  // movement
  a.walking = inp.walk;
  let mx = inp.mx;
  let mz = inp.mz;
  const ml = Math.hypot(mx, mz);
  if (ml > 1) {
    mx /= ml;
    mz /= ml;
  }
  let speed = b.swim ? 2.4 : a.crouch > 0.5 ? CROUCH_SPEED : inp.walk ? WALK : RUN;
  speed *= w.weight * (a.ads > 0.5 ? 0.78 : 1);
  const sy = Math.sin(a.yaw);
  const cy = Math.cos(a.yaw);
  // forward (-sin, -cos), right (cos, -sin)
  const tx = (cy * mx - sy * mz) * speed;
  const tz = (-sy * mx - cy * mz) * speed;
  if (b.onGround) {
    const k = 1 - Math.exp(-(ml > 0.05 ? 13 : 17) * dt);
    b.vx += (tx - b.vx) * k;
    b.vz += (tz - b.vz) * k;
    if (inp.jump && !b.swim && a.crouch < 0.5) {
      b.vy = JUMP;
      b.onGround = false;
      m.events.push({ t: 'jump', a: a.id });
    }
  } else {
    const k = 1 - Math.exp(-2.2 * dt);
    b.vx += (tx - b.vx) * k;
    b.vz += (tz - b.vz) * k;
  }
  const airborne = !b.onGround;
  const ox = b.x;
  const oz = b.z;
  stepBody(m.world, b, dt);
  // the buy phase keeps everyone in their spawn
  if (m.mode === 'uplink' && m.phase === 'buy') {
    const s = m.world.spawns[a.team];
    const dx = b.x - s.x;
    const dz = b.z - s.z;
    const d = Math.hypot(dx, dz);
    if (d > SPAWN_R) {
      b.x = s.x + (dx / d) * SPAWN_R;
      b.z = s.z + (dz / d) * SPAWN_R;
    }
  }
  if (airborne && b.onGround) m.events.push({ t: 'land', a: a.id });
  // footsteps: running is loud, walking and crouching are silent
  const moved = Math.hypot(b.x - ox, b.z - oz);
  a.phase += moved * 1.15;
  if (b.onGround) {
    a.stepDist += moved;
    if (a.stepDist > 2.1) {
      a.stepDist = 0;
      const loud = !inp.walk && a.crouch < 0.5 && Math.hypot(b.vx, b.vz) > WALK + 0.4;
      m.events.push({ t: 'step', a: a.id, loud, s: b.swim ? 'water' : 'dirt' });
      if (loud) m.sounds.push({ x: b.x, z: b.z, t: m.time, team: a.team, range: 24, who: a.id });
    }
  }
  // fighting is off until the round goes live
  const armed = m.mode === 'dm' || m.phase === 'live';
  if (!armed) {
    a.fireHeld = inp.fire;
    return;
  }
  if (inp.throw) throwNade(m, a, inp.throw);
  if (inp.reload) startReload(m, a);
  if (inp.fire && a.switchT <= 0 && a.reloadT <= 0 && a.fireCd <= 0 && g && (w.auto || !a.fireHeld)) fire(m, a);
  else if (inp.fire && g && g.mag <= 0 && a.reloadT <= 0 && !a.fireHeld) fire(m, a);
  if (a.fireCd < 0) a.fireCd = 0;
  a.fireHeld = inp.fire;
}

function spot(m: Match) {
  for (const e of m.actors) {
    if (!e.alive || e.team === 0) continue;
    for (const f of m.actors) {
      if (!f.alive || f.team !== 0) continue;
      const dx = e.body.x - f.body.x;
      const dz = e.body.z - f.body.z;
      const d = Math.hypot(dx, dz);
      if (d > 170) continue;
      const fw = viewDir(f.yaw, 0);
      if ((dx * fw.x + dz * fw.z) / (d || 1) < 0.5 && d > 6) continue;
      const ey = eyeY(f);
      const ty = e.body.y + e.body.height * 0.7;
      if (smokeBlocks(m, f.body.x, ey, f.body.z, e.body.x, ty, e.body.z)) continue;
      const l = Math.hypot(dx, ty - ey, dz) || 1;
      rayWorld(m.world, f.body.x, ey, f.body.z, dx / l, (ty - ey) / l, dz / l, l, hit);
      if (hit.kind === 'none') {
        m.spotted[e.id] = m.time;
        break;
      }
    }
  }
}

/** Advances the match by dt seconds. `you` is the local player's input (ignored once you are out). */
export function step(m: Match, dt: number, you: Input) {
  m.events = [];
  if (m.phase === 'over') return;
  m.time += dt;
  for (const a of m.actors) {
    const inp = a.bot ? botInput(m, a, dt) : a.id === 0 ? you : idleInput(a.yaw, a.pitch);
    act(m, a, inp, dt);
  }
  stepBullets(m, dt);
  stepNades(m, dt);
  m.sounds = m.sounds.filter((s) => m.time - s.t < 1.5);
  m.spotT -= dt;
  if (m.spotT <= 0 && m.mode === 'uplink') {
    m.spotT = 0.25;
    spot(m);
  }
  stepRules(m, dt);
}

/** The final score for the local player: combat score, with the match bonus already in. */
export const finalScore = (m: Match) => Math.max(1, Math.round(me(m).cs));

/** Places in a deathmatch, best first. */
export const standings = (m: Match) => [...m.actors].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || b.cs - a.cs);

export { ARENA, yawTo };
