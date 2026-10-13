// The Bed Wars rules: teams, beds, forges and generators, item drops, projectiles and explosions, damage, deaths,
// respawns, final kills, upgrades, traps and the game clock. The host (or the solo player) runs this at 20 ticks a
// second; everything that happens comes out as events, which drive sounds and effects locally and travel to
// guests online. Pure, so it runs under node.
import { AIR, BLOCKS, LADDER, LADDER_DIRS, POPPY, TALLGRASS, TEAMS, WATER, WOOL, bedTeam, isBed, isLadder } from './blocks.ts';
import { HURT_TICKS, applyKnock, arrowDamage, fallDamage, hurtFilter, isCrit, knockbackLevel, meleeKnock, reduceDamage, weaponDamage, type DamageCause, type Knock } from './combat.ts';
import {
  FORGE_CAP,
  GEN_CAP,
  GEN_INTERVAL,
  ITEM_DEFS,
  MAX_TRAPS,
  TRAPS,
  UPGRADES,
  addItem,
  blockFor,
  buy,
  forgeInterval,
  freshInventory,
  freshUpgrades,
  inventoryAfterDeath,
  isBlockItem,
  isBow,
  isRes,
  takeItem,
  trapCost,
  upgradeCost,
  type Inventory,
  type Item,
  type Res,
  type TrapKind,
  type UpgradeKey,
  type Upgrades,
} from './items.ts';
import { BUILD_MAX, VOID_Y, generate, inBox, perTeam, teamsFor, type MapInfo, type Mode } from './map.ts';
import { EYE, EYE_SNEAK, HEIGHT, WIDTH, bodyOverlapsCell, newBody, stepBody, type Body, type MoveInput } from './physics.ts';
import { canBreak, clearLine, rayBox, raycast, type World } from './world.ts';

export const TPS = 20;
export const RESPAWN_TICKS = 5 * TPS;
export const REACH_BLOCK = 4.5;
export const REACH_HIT = 3;
export const SHOP_RANGE = 4.5;

export type Pace = 'quick' | 'classic';
export type Level = 'easy' | 'normal' | 'hard';

export type PhaseKind = 'diamond2' | 'emerald2' | 'diamond3' | 'emerald3' | 'bedgone' | 'sudden' | 'end';
export type Phase = { kind: PhaseKind; at: number; label: string };

/** The game clock: generator tiers, then every bed goes, then sudden death, then a draw. Hypixel's timings on classic. */
export function timeline(pace: Pace): Phase[] {
  const m = (min: number) => Math.round(min * 60 * TPS);
  const t = pace === 'classic' ? [6, 12, 18, 24, 30, 40, 50] : [2, 4, 6, 8, 10, 13, 16];
  return [
    { kind: 'diamond2', at: m(t[0]), label: 'Diamond II' },
    { kind: 'emerald2', at: m(t[1]), label: 'Emerald II' },
    { kind: 'diamond3', at: m(t[2]), label: 'Diamond III' },
    { kind: 'emerald3', at: m(t[3]), label: 'Emerald III' },
    { kind: 'bedgone', at: m(t[4]), label: 'Bed Gone' },
    { kind: 'sudden', at: m(t[5]), label: 'Sudden Death' },
    { kind: 'end', at: m(t[6]), label: 'Game End' },
  ];
}

export type Ctrl = 'local' | 'remote' | 'bot';

export type Effects = {
  speed: number;
  speedLvl: number;
  jump: number;
  jumpLvl: number;
  invis: number;
  regen: number;
  regenLvl: number;
  absorb: number;
  blind: number;
  slow: number;
  fatigue: number;
};
const noEffects = (): Effects => ({ speed: 0, speedLvl: 0, jump: 0, jumpLvl: 0, invis: 0, regen: 0, regenLvl: 0, absorb: 0, blind: 0, slow: 0, fatigue: 0 });

export type Stats = { kills: number; finals: number; beds: number; deaths: number };

export type Player = {
  id: number;
  /** Online seat, or -1 for a bot. */
  seat: number;
  name: string;
  team: number;
  ctrl: Ctrl;
  /** Cosmetic look (skin index). */
  skin: number;
  body: Body;
  input: MoveInput;
  hp: number;
  absorb: number;
  alive: boolean;
  /** Ticks until respawn while dead with a bed. */
  respawn: number;
  /** Out for good (final kill or bed gone). */
  out: boolean;
  hurtTicks: number;
  lastDamage: number;
  lastHitBy: number;
  lastHitTick: number;
  regenTick: number;
  inv: Inventory;
  sel: number;
  fx: Effects;
  stats: Stats;
  /** Bumps whenever the inventory changes (online guests get a fresh copy). */
  invVersion: number;
  /** Last action sequence number handled for this player (online). */
  ack: number;
  /** Counts swings, so remote views animate each one. */
  swings: number;
  /** Something is in use: eating a golden apple or drawing a bow (ticks so far). */
  using: number;
  /** Where the player died (for the spectator camera). */
  diedAt: [number, number, number];
  /** Bot brain state, owned by bots.ts. */
  brain?: unknown;
  /** Joined the room after this game began, or left it (shown dimmed). */
  gone: boolean;
  /** Bumps on every respawn or teleport, so stale position reports from before it are ignored. */
  epoch: number;
  /** What others see in hand (kept current by the host, sent to guests). */
  show: { item: Item | null; tier: number };
  /** Ticks the bow has been drawn or the apple eaten, as others see it. */
  drawing: number;
};

export type Team = {
  id: number;
  bed: boolean;
  out: boolean;
  /** Had players when the game began. */
  used: boolean;
  ups: Upgrades;
  traps: TrapKind[];
  trapCooldown: number;
  forge: { iron: number; gold: number; emerald: number };
};

export type Drop = { id: number; item: Item; n: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number; pickDelay: number; gen: number; rest: boolean };
export type ProjKind = 'arrow' | 'fireball' | 'pearl' | 'egg' | 'tnt';
export type Proj = { id: number; kind: ProjKind; owner: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number; power: number; punch: number; full: boolean; last?: [number, number, number] };
export type Gen = { kind: 'diamond' | 'emerald'; x: number; y: number; z: number; tier: number; timer: number };

export type DeathCause = 'melee' | 'arrow' | 'explosion' | 'fall' | 'void' | 'pearl' | 'magic';

export type MsgKind = 'kill' | 'final' | 'bed' | 'elim' | 'tier' | 'phase' | 'info' | 'trap' | 'buy' | 'deny' | 'res' | 'join';

export type Ev =
  | { t: 'block'; x: number; y: number; z: number; id: number; by: number; placed: boolean; was: number }
  | { t: 'hurt'; p: number; hp: number; abs: number; by: number; crit: boolean; cause: DamageCause }
  | { t: 'kb'; p: number; k: Knock }
  | { t: 'die'; p: number; by: number; cause: DeathCause; final: boolean }
  | { t: 'spawn'; p: number; x: number; y: number; z: number; yaw: number; ep: number }
  | { t: 'bed'; team: number; by: number }
  | { t: 'elim'; team: number }
  | { t: 'drop'; id: number; item: Item; n: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; gen: number }
  | { t: 'dropn'; id: number; n: number }
  | { t: 'pick'; id: number; p: number; item: Item; n: number }
  | { t: 'proj'; id: number; kind: ProjKind; owner: number; x: number; y: number; z: number; vx: number; vy: number; vz: number }
  | { t: 'pgone'; id: number; x: number; y: number; z: number; hit: number }
  | { t: 'boom'; x: number; y: number; z: number; power: number }
  | { t: 'upg'; team: number; key: UpgradeKey; level: number; by: number }
  | { t: 'traps'; team: number; traps: TrapKind[] }
  | { t: 'trap'; team: number; kind: TrapKind; p: number }
  | { t: 'tier'; kind: 'diamond' | 'emerald'; tier: number }
  | { t: 'phase'; kind: PhaseKind }
  | { t: 'msg'; k: MsgKind; text: string; team?: number; to?: number }
  | { t: 'win'; team: number }
  | { t: 'fx'; p: number; fx: Effects; absorb: number }
  | { t: 'tp'; p: number; x: number; y: number; z: number; ep: number }
  | { t: 'use'; p: number; item: Item }
  | { t: 'swing'; p: number }
  | { t: 'inv'; p: number }
  | { t: 'ack'; p: number; seq: number; ok: boolean };

export type Game = {
  mode: Mode;
  pace: Pace;
  level: Level;
  tick: number;
  world: World;
  info: MapInfo;
  players: Player[];
  teams: Team[];
  drops: Drop[];
  projs: Proj[];
  gens: Gen[];
  phases: Phase[];
  /** Index of the next phase on the clock. */
  phase: number;
  events: Ev[];
  nextId: number;
  winner: number;
  over: boolean;
  seed: number;
  /** True on the machine that runs the rules (solo or the online host). */
  authority: boolean;
};

export type Entrant = { name: string; seat: number; ctrl: Ctrl; skin: number; team?: number };

/** Deterministic random numbers for the rules (drop scatter), so tests and replays agree. */
export function rand(g: Game) {
  g.seed = (Math.imul(g.seed ^ (g.seed >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
  return g.seed / 4294967296;
}

/** A fresh game: the map for the mode, entrants spread over the teams (in seat order), bots taking the rest. */
export function createGame(opts: { mode: Mode; pace: Pace; level: Level; entrants: Entrant[]; seed?: number; authority?: boolean }): Game {
  const { world, info } = generate(opts.mode);
  const nTeams = teamsFor(opts.mode);
  const per = perTeam(opts.mode);
  const teams: Team[] = Array.from({ length: nTeams }, (_, id) => ({
    id,
    bed: true,
    out: false,
    used: false,
    ups: freshUpgrades(),
    traps: [],
    trapCooldown: 0,
    forge: { iron: 10, gold: 40, emerald: 600 },
  }));
  const g: Game = {
    mode: opts.mode,
    pace: opts.pace,
    level: opts.level,
    tick: 0,
    world,
    info,
    players: [],
    teams,
    drops: [],
    projs: [],
    gens: info.gens.map((s) => ({ kind: s.kind, x: s.x, y: s.y, z: s.z, tier: 1, timer: s.kind === 'diamond' ? GEN_INTERVAL.diamond[0] : GEN_INTERVAL.emerald[0] })),
    phases: timeline(opts.pace),
    phase: 0,
    events: [],
    nextId: 1,
    winner: -1,
    over: false,
    seed: (opts.seed ?? 1234567) >>> 0,
    authority: opts.authority ?? true,
  };
  const seats = new Array(nTeams).fill(0);
  for (const e of opts.entrants) {
    let team = e.team ?? -1;
    if (team < 0 || team >= nTeams || seats[team] >= per) team = seats.findIndex((n) => n < per);
    if (team < 0) continue;
    seats[team]++;
    addPlayer(g, e.name, e.seat, e.ctrl, team, e.skin);
  }
  for (const t of teams) {
    t.used = g.players.some((p) => p.team === t.id);
    if (!t.used) {
      // islands nobody plays start without a bed
      t.bed = false;
      t.out = true;
      const site = info.teams[t.id];
      world.set(site.bedFoot[0], site.bedFoot[1], site.bedFoot[2], AIR);
      world.set(site.bedHead[0], site.bedHead[1], site.bedHead[2], AIR);
      world.edits.clear();
    }
  }
  return g;
}

export function addPlayer(g: Game, name: string, seat: number, ctrl: Ctrl, team: number, skin = 0): Player {
  const site = g.info.teams[team];
  const p: Player = {
    id: g.players.length,
    seat,
    name,
    team,
    ctrl,
    skin,
    body: newBody(site.spawn[0], site.spawn[1], site.spawn[2], site.yaw),
    input: { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false },
    hp: 20,
    absorb: 0,
    alive: true,
    respawn: 0,
    out: false,
    hurtTicks: 0,
    lastDamage: 0,
    lastHitBy: -1,
    lastHitTick: -9999,
    regenTick: 0,
    inv: freshInventory(),
    sel: 0,
    fx: noEffects(),
    stats: { kills: 0, finals: 0, beds: 0, deaths: 0 },
    invVersion: 1,
    ack: 0,
    swings: 0,
    using: 0,
    diedAt: [site.spawn[0], site.spawn[1], site.spawn[2]],
    gone: false,
    epoch: 0,
    show: { item: 'sword_wood', tier: 0 },
    drawing: 0,
  };
  // spread teammates a little at spawn
  const mates = g.players.filter((o) => o.team === team).length;
  p.body.x += mates * 0.8;
  g.players.push(p);
  return p;
}

const emit = (g: Game, e: Ev) => g.events.push(e);
const teamName = (t: number) => TEAMS[t].name;
const invChanged = (g: Game, p: Player) => {
  p.invVersion++;
  emit(g, { t: 'inv', p: p.id });
};

export const heldItem = (p: Player): Item | null => p.inv.slots[p.sel]?.item ?? null;
export const eyeY = (p: Player) => p.body.y + (p.body.sneaking ? EYE_SNEAK : EYE);
export const lookDir = (yaw: number, pitch: number): [number, number, number] => {
  const c = Math.cos(pitch);
  return [-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c];
};
export const sameTeam = (g: Game, a: number, b: number) => g.players[a]?.team === g.players[b]?.team;
export const teamAlive = (g: Game, t: number) => g.teams[t] && !g.teams[t].out;
export const hasteOf = (g: Game, p: Player) => g.teams[p.team].ups.haste;

// ---------------------------------------------------------------------------------------------------------------
// Actions: what a player (local, remote or bot) asks the rules to do. Each validates and returns whether it happened.

/** Can a block go here? Map-wise only: bounds, height, protected spots and something to stand it against. */
export function placeAllowed(g: Game, x: number, y: number, z: number, block: number, by = -1): boolean {
  const w = g.world;
  if (x < 0 || z < 0 || x >= 176 || z >= 176 || y < 1 || y > BUILD_MAX) return false;
  const here = w.get(x, y, z);
  if (here !== AIR && here !== TALLGRASS && here !== POPPY && here !== WATER) return false;
  for (const b of g.info.noBuild) if (inBox(b, x, y, z)) return false;
  for (const p of g.players) {
    if (!p.alive || p.id === by) continue;
    if (bodyOverlapsCell(p.body.x, p.body.y, p.body.z, x, y, z)) return false;
  }
  if (isLadder(block)) {
    const [dx, dz] = LADDER_DIRS[block - LADDER];
    const wall = w.get(x + dx, y, z + dz);
    return wall !== AIR && BLOCKS[wall].opaque;
  }
  for (const [dx, dy, dz] of [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ]) {
    const n = w.get(x + dx, y + dy, z + dz);
    if (n !== AIR && n !== WATER && BLOCKS[n].shape !== 'cross') return true;
  }
  return false;
}

/** Places the held block (or lights TNT) at a cell. face is the side clicked (for ladders). */
export function placeBlock(g: Game, p: Player, x: number, y: number, z: number, slot: number, face = -1, slack = 0): boolean {
  if (!p.alive || p.out) return false;
  const stack = p.inv.slots[slot];
  if (!stack) return false;
  const ex = p.body.x;
  const ey = eyeY(p);
  const ez = p.body.z;
  if (Math.hypot(x + 0.5 - ex, y + 0.5 - ey, z + 0.5 - ez) > REACH_BLOCK + 1 + slack) return false;
  if (stack.item === 'tnt') {
    if (!placeAllowed(g, x, y, z, 1, p.id)) return false;
    takeItem(p.inv, 'tnt', 1, slot);
    invChanged(g, p);
    spawnProj(g, 'tnt', p.id, x + 0.5, y, z + 0.5, 0, 0.2, 0);
    return true;
  }
  if (!isBlockItem(stack.item)) return false;
  let block = blockFor(stack.item, p.team);
  if (block === LADDER) {
    // the ladder hangs on the wall that was clicked
    const dir = face === 0 ? 1 : face === 1 ? 0 : face === 4 ? 3 : face === 5 ? 2 : -1;
    if (dir < 0) return false;
    block = LADDER + dir;
  }
  if (!placeAllowed(g, x, y, z, block, p.id)) return false;
  takeItem(p.inv, stack.item, 1, slot);
  invChanged(g, p);
  const was = g.world.get(x, y, z);
  g.world.set(x, y, z, block, true);
  emit(g, { t: 'block', x, y, z, id: block, by: p.id, placed: true, was });
  return true;
}

/** Breaks a placed block or an enemy bed. */
export function breakBlock(g: Game, p: Player, x: number, y: number, z: number, slack = 0): boolean {
  if (!p.alive || p.out) return false;
  if (Math.hypot(x + 0.5 - p.body.x, y + 0.5 - eyeY(p), z + 0.5 - p.body.z) > REACH_BLOCK + 1 + slack) return false;
  if (!canBreak(g.world, x, y, z)) return false;
  const id = g.world.get(x, y, z);
  if (isBed(id)) {
    const t = bedTeam(id);
    if (t === p.team) {
      emit(g, { t: 'msg', k: 'deny', text: "you can't break your own bed!", to: p.id });
      return false;
    }
    destroyBed(g, t, p.id);
    return true;
  }
  g.world.set(x, y, z, AIR);
  emit(g, { t: 'block', x, y, z, id: AIR, by: p.id, placed: false, was: id });
  return true;
}

const BED_LINES = ['was destroyed by', 'was dismantled by', 'got sent to the Farm by', 'was torn up by', 'pulled an all-nighter thanks to', 'was sacked by'];

export function destroyBed(g: Game, t: number, by: number) {
  const team = g.teams[t];
  if (!team || !team.bed) return;
  team.bed = false;
  const site = g.info.teams[t];
  for (const c of [site.bedFoot, site.bedHead]) {
    const was = g.world.get(c[0], c[1], c[2]);
    if (isBed(was)) {
      g.world.set(c[0], c[1], c[2], AIR);
      emit(g, { t: 'block', x: c[0], y: c[1], z: c[2], id: AIR, by, placed: false, was });
    }
  }
  const breaker = g.players[by];
  if (breaker) breaker.stats.beds++;
  emit(g, { t: 'bed', team: t, by });
  const line = BED_LINES[(g.tick + t) % BED_LINES.length];
  emit(g, { t: 'msg', k: 'bed', team: t, text: breaker ? `BED DESTRUCTION > ${teamName(t)} Bed ${line} ${breaker.name}!` : `BED DESTRUCTION > ${teamName(t)} Bed was destroyed!` });
  checkTeams(g);
}

/** A melee swing that the attacker says landed on target. Validated for reach, sight and teams. */
export function attack(g: Game, p: Player, targetId: number, crit = isCrit(p.body), slack = 0): boolean {
  const v = g.players[targetId];
  if (!p.alive || p.out || !v || !v.alive || v.id === p.id || v.team === p.team) return false;
  // reach from the eye to the nearest point of the target's box
  const ey = eyeY(p);
  const nx = Math.max(v.body.x - WIDTH / 2, Math.min(p.body.x, v.body.x + WIDTH / 2));
  const ny = Math.max(v.body.y, Math.min(ey, v.body.y + HEIGHT));
  const nz = Math.max(v.body.z - WIDTH / 2, Math.min(p.body.z, v.body.z + WIDTH / 2));
  if (Math.hypot(nx - p.body.x, ny - ey, nz - p.body.z) > REACH_HIT + 0.35 + slack) return false;
  if (!clearLine(g.world, p.body.x, ey, p.body.z, v.body.x, v.body.y + 1.2, v.body.z)) return false;
  p.swings++;
  const item = heldItem(p);
  let dmg = weaponDamage(item, p.inv.pick, p.inv.axe, g.teams[p.team].ups.sharp);
  if (crit) dmg *= 1.5;
  const level = knockbackLevel(item) + (p.body.sprinting ? 1 : 0);
  const knock = meleeKnock(v.body, p.body, level);
  if (p.body.sprinting && p.ctrl !== 'remote') {
    p.body.vx *= 0.6;
    p.body.vz *= 0.6;
    p.body.sprinting = false;
  }
  // invisibility ends when you hit someone? (Hypixel keeps it; we keep it too)
  damage(g, v, dmg, p.id, 'melee', knock, crit);
  return true;
}

/** Damage with armor, protection, absorption and hurt immunity; knockback goes to the body's owner. */
export function damage(g: Game, v: Player, amount: number, by: number, cause: DamageCause, knock: Knock | null, crit = false): number {
  if (!v.alive || v.out || g.over) return 0;
  if (by >= 0 && by !== v.id && g.players[by]?.team === v.team) return 0;
  if (cause === 'void') {
    kill(g, v, by >= 0 ? by : recentAttacker(g, v), 'void');
    return 0;
  }
  const team = g.teams[v.team];
  if (suddenDeath(g) && (cause === 'melee' || cause === 'arrow')) amount *= 1.5;
  let d = reduceDamage(amount, cause, v.inv.armor, team.ups.prot);
  const hf = hurtFilter(v, d);
  d = hf.dealt;
  if (d <= 0) return 0;
  if (by >= 0 && by !== v.id) {
    v.lastHitBy = by;
    v.lastHitTick = g.tick;
  }
  if (v.absorb > 0) {
    const a = Math.min(v.absorb, d);
    v.absorb -= a;
    d -= a;
  }
  v.hp = Math.max(0, v.hp - d);
  v.regenTick = 0;
  emit(g, { t: 'hurt', p: v.id, hp: Math.round(v.hp * 10) / 10, abs: v.absorb, by, crit, cause });
  if (knock && hf.knock) {
    if (v.ctrl !== 'remote') applyKnock(v.body, knock);
    emit(g, { t: 'kb', p: v.id, k: knock });
  }
  if (v.hp <= 0) kill(g, v, by >= 0 && by !== v.id ? by : recentAttacker(g, v), cause);
  return d;
}

/** Whoever hit this player in the last 15 seconds gets the credit for a fall or void death. */
function recentAttacker(g: Game, v: Player) {
  return v.lastHitBy >= 0 && g.tick - v.lastHitTick < 15 * TPS ? v.lastHitBy : -1;
}

const KILL_LINES: Record<DeathCause, [string, string]> = {
  melee: ['was slain by', 'died'],
  arrow: ['was shot by', 'was shot'],
  explosion: ['was blown up by', 'blew up'],
  fall: ['was knocked off a ledge by', 'fell from a high place'],
  void: ['was knocked into the void by', 'fell into the void'],
  pearl: ['was knocked off a ledge by', 'took a bad pearl'],
  magic: ['was killed by', 'died'],
};

export function kill(g: Game, v: Player, by: number, cause: DeathCause) {
  if (!v.alive) return;
  v.alive = false;
  v.hp = 0;
  v.absorb = 0;
  v.using = 0;
  v.diedAt = [v.body.x, Math.max(v.body.y, 10), v.body.z];
  v.stats.deaths++;
  const team = g.teams[v.team];
  const final = !team.bed;
  const killer = by >= 0 && by !== v.id ? g.players[by] : undefined;
  if (killer) {
    if (final) killer.stats.finals++;
    else killer.stats.kills++;
    // the killer takes the victim's resources
    const got: string[] = [];
    for (const r of ['iron', 'gold', 'diamond', 'emerald'] as Res[]) {
      const n = v.inv.wallet[r];
      if (n > 0 && killer.alive) {
        killer.inv.wallet[r] += n;
        got.push(`+${n} ${r[0].toUpperCase()}${r.slice(1)}`);
      }
    }
    if (got.length) {
      invChanged(g, killer);
      emit(g, { t: 'msg', k: 'res', text: got.join('  '), to: killer.id });
    }
  }
  v.inv = inventoryAfterDeath(v.inv);
  v.sel = 0;
  v.fx = noEffects();
  invChanged(g, v);
  emit(g, { t: 'fx', p: v.id, fx: v.fx, absorb: 0 });
  const [withKiller, alone] = KILL_LINES[cause];
  const text = killer ? `${v.name} ${withKiller} ${killer.name}.` : `${v.name} ${alone}.`;
  emit(g, { t: 'die', p: v.id, by: killer ? killer.id : -1, cause, final });
  emit(g, { t: 'msg', k: final ? 'final' : 'kill', team: v.team, text: final ? `${text} FINAL KILL!` : text });
  if (final) {
    v.out = true;
    v.respawn = 0;
  } else v.respawn = RESPAWN_TICKS;
  checkTeams(g);
}

/** Teams with no bed and nobody standing (or about to respawn) are eliminated; the last one standing wins. */
function checkTeams(g: Game) {
  for (const t of g.teams) {
    if (t.out || !t.used) continue;
    const members = g.players.filter((p) => p.team === t.id);
    if (!t.bed && !members.some((p) => p.alive || (!p.out && p.respawn > 0))) {
      t.out = true;
      for (const p of members) p.out = true;
      emit(g, { t: 'elim', team: t.id });
      emit(g, { t: 'msg', k: 'elim', team: t.id, text: `TEAM ELIMINATED > ${teamName(t.id)} Team has been eliminated!` });
    }
  }
  const left = g.teams.filter((t) => t.used && !t.out);
  if (!g.over && left.length <= 1 && g.teams.some((t) => t.used)) {
    g.over = true;
    g.winner = left.length === 1 ? left[0].id : -1;
    emit(g, { t: 'win', team: g.winner });
  }
}

/** Bow shot: charge in ticks held (Minecraft: full at 20). */
export function shoot(g: Game, p: Player, charge: number, yaw: number, pitch: number): boolean {
  if (!p.alive || p.out) return false;
  const item = heldItem(p);
  if (!item || !isBow(item)) return false;
  if (!takeItem(p.inv, 'arrow', 1)) return false;
  invChanged(g, p);
  let f = charge / 20;
  f = (f * f + f * 2) / 3;
  if (f < 0.1) f = 0.1;
  if (f > 1) f = 1;
  const [dx, dy, dz] = lookDir(yaw, pitch);
  const speed = f * 3;
  const pr = spawnProj(g, 'arrow', p.id, p.body.x + dx * 0.3, eyeY(p) - 0.1, p.body.z + dz * 0.3, dx * speed, dy * speed, dz * speed);
  pr.power = item === 'bow_power' || item === 'bow_punch' ? 1 : 0;
  pr.punch = item === 'bow_punch' ? 1 : 0;
  pr.full = f >= 1;
  p.swings++;
  return true;
}

/** Throws or uses the held item: fireballs, pearls, bridge eggs, golden apples and potions. */
export function useItem(g: Game, p: Player, slot: number, yaw: number, pitch: number): boolean {
  if (!p.alive || p.out) return false;
  const stack = p.inv.slots[slot];
  if (!stack) return false;
  const item = stack.item;
  const [dx, dy, dz] = lookDir(yaw, pitch);
  const ex = p.body.x + dx * 0.6;
  const ey = eyeY(p) - 0.1 + dy * 0.6;
  const ez = p.body.z + dz * 0.6;
  switch (item) {
    case 'fireball':
      spawnProj(g, 'fireball', p.id, ex, ey, ez, dx * 0.95, dy * 0.95, dz * 0.95);
      break;
    case 'pearl':
      spawnProj(g, 'pearl', p.id, ex, ey, ez, dx * 1.5, dy * 1.5 + 0.1, dz * 1.5);
      break;
    case 'egg':
      spawnProj(g, 'egg', p.id, ex, ey, ez, dx * 1.5, dy * 1.5 + 0.1, dz * 1.5);
      break;
    case 'gapple':
      p.absorb = 4;
      p.fx.absorb = 120 * TPS;
      p.fx.regen = 5 * TPS;
      p.fx.regenLvl = 2;
      break;
    case 'speed':
      p.fx.speed = 45 * TPS;
      p.fx.speedLvl = 2;
      break;
    case 'jump':
      p.fx.jump = 45 * TPS;
      p.fx.jumpLvl = 5;
      break;
    case 'invis':
      p.fx.invis = 30 * TPS;
      break;
    default:
      return false;
  }
  takeItem(p.inv, item, 1, slot);
  invChanged(g, p);
  p.swings++;
  if (item === 'gapple' || item === 'speed' || item === 'jump' || item === 'invis') {
    emit(g, { t: 'fx', p: p.id, fx: { ...p.fx }, absorb: p.absorb });
    emit(g, { t: 'use', p: p.id, item });
  }
  return true;
}

/** Is a player close enough to a shop (or upgrades NPC)? Any island's will do, like Hypixel's villagers. */
export function nearNpc(g: Game, p: Player, which: 'shop' | 'upgrades', slack = 0) {
  return g.info.teams.some((site, t) => {
    if (!g.teams[t]?.used) return false;
    const at = which === 'shop' ? site.shop : site.upgrades;
    return Math.hypot(p.body.x - at[0], p.body.y + 1 - at[1] - 1, p.body.z - at[2]) <= SHOP_RANGE + slack;
  });
}

export function buyOffer(g: Game, p: Player, offerId: string, slack = 0): boolean {
  if (!p.alive || p.out) return false;
  if (!nearNpc(g, p, 'shop', slack)) return false;
  const r = buy(p.inv, offerId);
  if (!r.ok) {
    emit(g, { t: 'msg', k: 'deny', text: r.why === 'poor' ? "you don't have enough resources!" : r.why === 'owned' ? 'you already have that!' : r.why === 'full' ? 'your inventory is full!' : "that's not for sale.", to: p.id });
    return false;
  }
  invChanged(g, p);
  emit(g, { t: 'msg', k: 'buy', text: `you purchased ${r.name}`, to: p.id });
  return true;
}

export function buyUpgrade(g: Game, p: Player, key: UpgradeKey, slack = 0): boolean {
  if (!p.alive || p.out || !nearNpc(g, p, 'upgrades', slack)) return false;
  const team = g.teams[p.team];
  const cost = upgradeCost(team.ups, key);
  if (cost === null) return false;
  if (p.inv.wallet.diamond < cost) {
    emit(g, { t: 'msg', k: 'deny', text: "you don't have enough diamonds!", to: p.id });
    return false;
  }
  p.inv.wallet.diamond -= cost;
  team.ups[key]++;
  invChanged(g, p);
  const u = UPGRADES.find((x) => x.key === key)!;
  emit(g, { t: 'upg', team: p.team, key, level: team.ups[key], by: p.id });
  emit(g, { t: 'msg', k: 'buy', team: p.team, text: `${p.name} purchased ${u.name} (${u.levels[team.ups[key] - 1]})` });
  return true;
}

export function buyTrap(g: Game, p: Player, kind: TrapKind, slack = 0): boolean {
  if (!p.alive || p.out || !nearNpc(g, p, 'upgrades', slack)) return false;
  const team = g.teams[p.team];
  if (team.traps.length >= MAX_TRAPS) return false;
  const cost = trapCost(team.traps.length);
  if (p.inv.wallet.diamond < cost) {
    emit(g, { t: 'msg', k: 'deny', text: "you don't have enough diamonds!", to: p.id });
    return false;
  }
  p.inv.wallet.diamond -= cost;
  team.traps.push(kind);
  invChanged(g, p);
  emit(g, { t: 'traps', team: p.team, traps: [...team.traps] });
  emit(g, { t: 'msg', k: 'buy', team: p.team, text: `${p.name} purchased ${TRAPS.find((x) => x.kind === kind)!.name}` });
  return true;
}

/** Drops the held stack (Q) a little in front of the player. */
export function dropHeld(g: Game, p: Player, slot: number, all: boolean): boolean {
  if (!p.alive || p.out) return false;
  const s = p.inv.slots[slot];
  if (!s || s.item === 'sword_wood' || s.item === 'pick' || s.item === 'axe' || s.item === 'shears') return false;
  const n = all ? s.n : 1;
  takeItem(p.inv, s.item, n, slot);
  invChanged(g, p);
  const [dx, dy, dz] = lookDir(p.body.yaw, p.body.pitch);
  spawnDrop(g, s.item, n, p.body.x, eyeY(p) - 0.3, p.body.z, dx * 0.3, dy * 0.3 + 0.1, dz * 0.3, -1, 40);
  return true;
}

/** Fall damage the body's owner reports on landing. */
export function landed(g: Game, p: Player, distance: number) {
  const d = fallDamage(distance, p.fx.jump > 0 ? p.fx.jumpLvl : 0);
  if (d > 0) damage(g, p, d, -1, 'fall', null);
}

// ---------------------------------------------------------------------------------------------------------------
// Entities

export function spawnDrop(g: Game, item: Item, n: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, gen: number, pickDelay = 0): Drop {
  const d: Drop = { id: g.nextId++, item, n, x, y, z, vx, vy, vz, age: 0, pickDelay, gen, rest: false };
  g.drops.push(d);
  emit(g, { t: 'drop', id: d.id, item, n, x: r2(x), y: r2(y), z: r2(z), vx: r3(vx), vy: r3(vy), vz: r3(vz), gen });
  return d;
}

export function spawnProj(g: Game, kind: ProjKind, owner: number, x: number, y: number, z: number, vx: number, vy: number, vz: number): Proj {
  const pr: Proj = { id: g.nextId++, kind, owner, x, y, z, vx, vy, vz, age: 0, power: 0, punch: 0, full: false };
  g.projs.push(pr);
  emit(g, { t: 'proj', id: pr.id, kind, owner, x: r2(x), y: r2(y), z: r2(z), vx: r3(vx), vy: r3(vy), vz: r3(vz) });
  return pr;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Item drop physics: fall, land on whatever is below, settle. Shared by the host and the guests' replicas. */
export function stepDrop(w: World, d: Drop) {
  d.age++;
  if (d.pickDelay > 0) d.pickDelay--;
  if (d.rest) {
    // something removed under it: fall again
    const below = w.get(d.x, d.y - 0.05, d.z);
    if (below !== AIR && BLOCKS[below].solid) return;
    d.rest = false;
  }
  d.vy -= 0.04;
  d.vx *= 0.98;
  d.vy *= 0.98;
  d.vz *= 0.98;
  const nx = d.x + d.vx;
  const nz = d.z + d.vz;
  const blockedX = BLOCKS[w.get(nx, d.y + 0.1, d.z)].solid;
  const blockedZ = BLOCKS[w.get(d.x, d.y + 0.1, nz)].solid;
  if (!blockedX) d.x = nx;
  else d.vx = 0;
  if (!blockedZ) d.z = nz;
  else d.vz = 0;
  const ny = d.y + d.vy;
  const below = w.get(d.x, ny, d.z);
  if (d.vy < 0 && below !== AIR && BLOCKS[below].solid) {
    d.y = Math.floor(ny) + (BLOCKS[below].shape === 'bed' ? 0.5625 : 1);
    d.vy = 0;
    d.vx *= 0.5;
    d.vz *= 0.5;
    if (Math.abs(d.vx) < 0.01 && Math.abs(d.vz) < 0.01) d.rest = true;
  } else d.y = ny;
}

/** Projectile flight for one tick (shared by host and guests). Returns what it hit, if anything. */
export function stepProj(g: Game, pr: Proj): { block?: [number, number, number, number]; player?: Player } | null {
  pr.age++;
  const grav = pr.kind === 'arrow' ? 0.05 : pr.kind === 'fireball' ? 0 : pr.kind === 'tnt' ? 0.04 : 0.03;
  const drag = pr.kind === 'fireball' ? 1 : pr.kind === 'tnt' ? 0.98 : 0.99;
  if (pr.kind === 'tnt') {
    pr.vy -= grav;
    pr.vx *= drag;
    pr.vy *= drag;
    pr.vz *= drag;
    const ny = pr.y + pr.vy;
    const below = g.world.get(pr.x, ny, pr.z);
    if (pr.vy < 0 && below !== AIR && BLOCKS[below].solid) {
      pr.y = Math.floor(ny) + 1;
      pr.vy = 0;
    } else pr.y = ny;
    return null;
  }
  const len = Math.hypot(pr.vx, pr.vy, pr.vz);
  let hit: { block?: [number, number, number, number]; player?: Player } | null = null;
  let best = len;
  if (len > 1e-6) {
    const dx = pr.vx / len;
    const dy = pr.vy / len;
    const dz = pr.vz / len;
    const rb = raycast(g.world, pr.x, pr.y, pr.z, dx, dy, dz, len);
    if (rb) {
      best = rb.dist;
      hit = { block: [rb.x, rb.y, rb.z, rb.face] };
    }
    if (pr.kind !== 'egg') {
      for (const p of g.players) {
        if (!p.alive || (p.id === pr.owner && pr.age < 5)) continue;
        if (pr.kind !== 'pearl' && p.team === g.players[pr.owner]?.team && p.id !== pr.owner) continue;
        const pad = pr.kind === 'fireball' ? 0.5 : 0.3;
        const hb = rayBox(pr.x, pr.y, pr.z, dx, dy, dz, p.body.x - WIDTH / 2 - pad, p.body.y - pad, p.body.z - WIDTH / 2 - pad, p.body.x + WIDTH / 2 + pad, p.body.y + HEIGHT + pad, p.body.z + WIDTH / 2 + pad);
        if (hb && hb.t <= best) {
          best = hb.t;
          hit = { player: p };
        }
      }
    }
    pr.x += dx * best;
    pr.y += dy * best;
    pr.z += dz * best;
  }
  if (!hit) {
    pr.vy -= grav;
    pr.vx *= drag;
    pr.vy *= drag;
    pr.vz *= drag;
  }
  return hit;
}

function explode(g: Game, x: number, y: number, z: number, kind: 'fireball' | 'tnt', owner: number) {
  const blockR = kind === 'tnt' ? 4 : 2.6;
  const entR = kind === 'tnt' ? 5 : 4.2;
  const maxDmg = kind === 'tnt' ? 12 : 5;
  const kbMax = kind === 'tnt' ? 1.1 : 1.45;
  const w = g.world;
  // blocks: only placed ones, and blast-proof glass, obsidian, beds and the map stop the blast behind them
  const R = Math.ceil(blockR);
  const broken: [number, number, number][] = [];
  for (let bx = Math.floor(x) - R; bx <= Math.floor(x) + R; bx++)
    for (let by = Math.floor(y) - R; by <= Math.floor(y) + R; by++)
      for (let bz = Math.floor(z) - R; bz <= Math.floor(z) + R; bz++) {
        const id = w.get(bx, by, bz);
        if (id === AIR) continue;
        const d = Math.hypot(bx + 0.5 - x, by + 0.5 - y, bz + 0.5 - z);
        if (d > blockR) continue;
        if (!canBreak(w, bx, by, bz) || isBed(id)) continue;
        const blast = BLOCKS[id].blast;
        if (blast >= 2 || (blast === 1 && kind !== 'tnt')) continue;
        // walk the line from the center: anything sturdy in the way shields it
        const steps = Math.ceil(d * 3);
        let shielded = false;
        for (let s = 1; s < steps; s++) {
          const t = s / steps;
          const cx = Math.floor(x + (bx + 0.5 - x) * t);
          const cy = Math.floor(y + (by + 0.5 - y) * t);
          const cz = Math.floor(z + (bz + 0.5 - z) * t);
          if (cx === bx && cy === by && cz === bz) continue;
          const c = w.get(cx, cy, cz);
          if (c === AIR || BLOCKS[c].shape === 'cross') continue;
          const cb = BLOCKS[c].blast;
          if (!canBreak(w, cx, cy, cz) || cb >= 2 || (cb === 1 && kind !== 'tnt')) {
            shielded = true;
            break;
          }
        }
        if (!shielded) broken.push([bx, by, bz]);
      }
  for (const [bx, by, bz] of broken) {
    const was = w.get(bx, by, bz);
    w.set(bx, by, bz, AIR);
    emit(g, { t: 'block', x: bx, y: by, z: bz, id: AIR, by: owner, placed: false, was });
  }
  emit(g, { t: 'boom', x: r2(x), y: r2(y), z: r2(z), power: kind === 'tnt' ? 4 : 2 });
  for (const p of g.players) {
    if (!p.alive) continue;
    const cx = p.body.x;
    const cy = p.body.y + 0.9;
    const cz = p.body.z;
    const d = Math.hypot(cx - x, cy - y, cz - z);
    if (d >= entR) continue;
    const f = 1 - d / entR;
    const seen = clearLine(w, x, y, z, cx, cy, cz) ? 1 : 0.4;
    const self = p.id === owner;
    if (!self && owner >= 0 && g.players[owner]?.team === p.team) continue;
    const len = d || 1;
    const k = kbMax * f * seen;
    const knock: Knock = { dx: 0, dz: 0, ex: ((cx - x) / len) * k, ey: Math.max(0.25 * f, ((cy - y) / len) * k + 0.35 * f), ez: ((cz - z) / len) * k, base: false };
    if (p.ctrl !== 'remote') applyKnock(p.body, knock);
    emit(g, { t: 'kb', p: p.id, k: knock });
    const dmg = maxDmg * f * seen * (self ? (kind === 'fireball' ? 0.2 : 0.5) : 1);
    if (dmg >= 0.5) damage(g, p, dmg, self ? -1 : owner, 'explosion', null);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The tick

/** Steps a body that the rules own (bots), with its effects. */
function moveOwned(g: Game, p: Player) {
  stepBody(g.world, p.body, p.input, { speed: p.fx.speed > 0 ? p.fx.speedLvl : 0, jump: p.fx.jump > 0 ? p.fx.jumpLvl : 0, slow: (p.fx.slow > 0 ? 2 : 0) + (p.using > 0 ? 4 : 0) });
}

export function respawn(g: Game, p: Player) {
  const site = g.info.teams[p.team];
  p.alive = true;
  p.hp = 20;
  p.absorb = 0;
  p.hurtTicks = 0;
  p.lastDamage = 0;
  p.lastHitBy = -1;
  p.respawn = 0;
  const mates = g.players.filter((o) => o.team === p.team && o.id < p.id).length;
  p.body = newBody(site.spawn[0] + mates * 0.6, site.spawn[1], site.spawn[2], site.yaw);
  p.epoch++;
  emit(g, { t: 'spawn', p: p.id, x: p.body.x, y: p.body.y, z: p.body.z, yaw: site.yaw, ep: p.epoch });
}

/** One tick of the rules (authority only). Bots have already chosen their input. */
export function tickGame(g: Game) {
  if (g.over) return;
  g.tick++;
  const w = g.world;

  for (const p of g.players) {
    if (p.hurtTicks > 0) p.hurtTicks--;
    if (!p.alive) {
      // you died with a bed: you come back even if it breaks during the countdown
      if (!p.out && p.respawn > 0 && --p.respawn === 0) respawn(g, p);
      continue;
    }
    if (p.ctrl === 'bot') moveOwned(g, p);
    if (p.ctrl !== 'remote') {
      const it = heldItem(p);
      p.show.item = it;
      p.show.tier = it === 'pick' ? p.inv.pick : it === 'axe' ? p.inv.axe : 0;
    }
    // owners report their own falls; bots and the local player land here
    if (p.ctrl !== 'remote' && p.body.landed > 0) {
      landed(g, p, p.body.landed);
      p.body.landed = 0;
    }
    if (!p.alive) continue;
    if (p.body.y < VOID_Y) {
      damage(g, p, 1000, -1, 'void', null);
      continue;
    }
    tickEffects(g, p);
  }

  // forges
  for (const t of g.teams) {
    if (!t.used) continue;
    const site = g.info.teams[t.id];
    for (const res of ['iron', 'gold', 'emerald'] as const) {
      const iv = forgeInterval(res, t.ups.forge);
      if (!isFinite(iv)) continue;
      if (--t.forge[res] > 0) continue;
      t.forge[res] = Math.round(iv);
      feed(g, res, site.forge[0], site.forge[1] + 0.2, site.forge[2], FORGE_CAP[res], -10 - t.id);
    }
  }
  // diamond and emerald generators
  g.gens.forEach((gen, i) => {
    if (--gen.timer > 0) return;
    gen.timer = GEN_INTERVAL[gen.kind][gen.tier - 1];
    feed(g, gen.kind, gen.x, gen.y + 0.2, gen.z, GEN_CAP[gen.kind], i);
  });

  // drops and pickups
  for (let i = g.drops.length - 1; i >= 0; i--) {
    const d = g.drops[i];
    stepDrop(w, d);
    if (d.y < VOID_Y - 10 || (d.gen < 0 && d.age > 5 * 60 * TPS)) {
      g.drops.splice(i, 1);
      emit(g, { t: 'pick', id: d.id, p: -1, item: d.item, n: 0 });
      continue;
    }
    if (d.pickDelay > 0) continue;
    for (const p of g.players) {
      if (!p.alive) continue;
      if (Math.abs(p.body.x - d.x) > 1.3 || Math.abs(p.body.z - d.z) > 1.3 || d.y < p.body.y - 0.6 || d.y > p.body.y + 2.3) continue;
      if (isRes(d.item)) p.inv.wallet[d.item] += d.n;
      else if (addItem(p.inv, d.item, d.n) > 0) continue;
      invChanged(g, p);
      g.drops.splice(i, 1);
      emit(g, { t: 'pick', id: d.id, p: p.id, item: d.item, n: d.n });
      break;
    }
  }

  // projectiles
  for (let i = g.projs.length - 1; i >= 0; i--) {
    const pr = g.projs[i];
    const hit = stepProj(g, pr);
    const gone = (h: number) => {
      g.projs.splice(i, 1);
      emit(g, { t: 'pgone', id: pr.id, x: r2(pr.x), y: r2(pr.y), z: r2(pr.z), hit: h });
    };
    if (pr.kind === 'tnt') {
      if (pr.age >= 52) {
        gone(0);
        explode(g, pr.x, pr.y + 0.5, pr.z, 'tnt', pr.owner);
      }
      continue;
    }
    if (pr.kind === 'egg') {
      layEgg(g, pr);
      if (hit?.block || pr.age > 32) gone(1);
      else if (pr.y < VOID_Y) gone(0);
      continue;
    }
    if (hit) {
      gone(hit.player ? 2 : 1);
      if (pr.kind === 'fireball') explode(g, pr.x, pr.y, pr.z, 'fireball', pr.owner);
      else if (pr.kind === 'pearl') {
        const o = g.players[pr.owner];
        if (o && o.alive) {
          let ty = pr.y;
          if (hit.block) {
            const [bx, by, bz, face] = hit.block;
            ty = face === 2 ? by + 1 : Math.max(by, pr.y - 0.5);
            pr.x = Math.max(bx - 0.7, Math.min(bx + 1.7, pr.x));
            pr.z = Math.max(bz - 0.7, Math.min(bz + 1.7, pr.z));
          }
          o.body.x = pr.x;
          o.body.y = ty;
          o.body.z = pr.z;
          o.body.vx = o.body.vy = o.body.vz = 0;
          o.body.fallDistance = 0;
          o.epoch++;
          emit(g, { t: 'tp', p: o.id, x: r2(o.body.x), y: r2(o.body.y), z: r2(o.body.z), ep: o.epoch });
          damage(g, o, 5, -1, 'pearl', null);
        }
      } else if (pr.kind === 'arrow' && hit.player) {
        const v = hit.player;
        const speed = Math.hypot(pr.vx, pr.vy, pr.vz);
        const dmg = arrowDamage(speed, pr.power, pr.full);
        const h = Math.hypot(pr.vx, pr.vz) || 1;
        const punch = pr.punch * 0.6;
        const knock: Knock = { dx: -pr.vx / h, dz: -pr.vz / h, ex: (pr.vx / h) * punch, ey: punch ? 0.1 : 0, ez: (pr.vz / h) * punch, base: true };
        if (v.id !== pr.owner) {
          damage(g, v, dmg, pr.owner, 'arrow', knock);
          const o = g.players[pr.owner];
          if (o && v.alive) emit(g, { t: 'msg', k: 'info', text: `${v.name} is on ${Math.ceil(v.hp)} HP!`, to: o.id });
        }
      }
      continue;
    }
    if (pr.y < VOID_Y || pr.age > (pr.kind === 'fireball' ? 120 : 400)) gone(0);
  }

  tickTraps(g);
  tickClock(g);
}

/** A forge or generator adds one resource, stacking onto the pile it already made. */
function feed(g: Game, item: Item, x: number, y: number, z: number, cap: number, gen: number) {
  const pile = g.drops.find((d) => d.gen === gen && d.item === item && Math.abs(d.x - x) < 1.5 && Math.abs(d.z - z) < 1.5);
  if (pile) {
    if (pile.n >= cap) return;
    pile.n++;
    emit(g, { t: 'dropn', id: pile.id, n: pile.n });
    return;
  }
  spawnDrop(g, item, 1, x + (rand(g) - 0.5) * 0.3, y, z + (rand(g) - 0.5) * 0.3, 0, 0.1, 0, gen);
}

/** A flying bridge egg lays wool under its path. */
function layEgg(g: Game, pr: Proj) {
  const owner = g.players[pr.owner];
  if (!owner) return;
  const block = WOOL + owner.team;
  const cx = Math.floor(pr.x);
  const cy = Math.floor(pr.y) - 2;
  const cz = Math.floor(pr.z);
  const put = (x: number, y: number, z: number) => {
    if (pr.age < 3) return;
    if (g.world.get(x, y, z) !== AIR || y < 1 || y > BUILD_MAX) return;
    for (const b of g.info.noBuild) if (inBox(b, x, y, z)) return;
    for (const p of g.players) if (p.alive && bodyOverlapsCell(p.body.x, p.body.y, p.body.z, x, y, z)) return;
    g.world.set(x, y, z, block, true);
    emit(g, { t: 'block', x, y, z, id: block, by: owner.id, placed: true, was: AIR });
  };
  const last = pr.last;
  if (last && (last[0] !== cx || last[2] !== cz)) {
    // keep the bridge walkable: fill the corner when it steps diagonally
    if (last[0] !== cx && last[2] !== cz) put(cx, Math.min(cy, last[1]), last[2]);
  }
  put(cx, cy, cz);
  pr.last = [cx, cy, cz];
}

function tickEffects(g: Game, p: Player) {
  const f = p.fx;
  let changed = false;
  for (const k of ['speed', 'jump', 'invis', 'regen', 'absorb', 'blind', 'slow', 'fatigue'] as const) {
    if (f[k] > 0) {
      f[k]--;
      if (f[k] === 0) changed = true;
    }
  }
  if (f.absorb === 0 && p.absorb > 0) {
    p.absorb = 0;
    changed = true;
  }
  if (changed) emit(g, { t: 'fx', p: p.id, fx: { ...f }, absorb: p.absorb });
  // healing: natural regeneration, golden apple regen II, the heal pool
  const team = g.teams[p.team];
  const site = g.info.teams[p.team];
  let every = 80;
  if (f.regen > 0) every = f.regenLvl >= 2 ? 25 : 50;
  else if (team.ups.heal > 0 && inBox(site.base, p.body.x, p.body.y, p.body.z)) every = 50;
  if (p.hp < 20 && p.hp > 0) {
    if (++p.regenTick >= every) {
      p.regenTick = 0;
      p.hp = Math.min(20, p.hp + 1);
      emit(g, { t: 'hurt', p: p.id, hp: p.hp, abs: p.absorb, by: -2, crit: false, cause: 'magic' });
    }
  } else p.regenTick = 0;
}

function tickTraps(g: Game) {
  for (const t of g.teams) {
    if (t.trapCooldown > 0) t.trapCooldown--;
    if (!t.used || t.out || !t.traps.length || t.trapCooldown > 0) continue;
    const site = g.info.teams[t.id];
    const intruder = g.players.find((p) => p.alive && p.team !== t.id && inBox(site.base, p.body.x, p.body.y, p.body.z));
    if (!intruder) continue;
    const kind = t.traps.shift()!;
    t.trapCooldown = 15 * TPS;
    if (kind === 'trap') {
      intruder.fx.blind = 8 * TPS;
      intruder.fx.slow = 8 * TPS;
      emit(g, { t: 'fx', p: intruder.id, fx: { ...intruder.fx }, absorb: intruder.absorb });
    } else if (kind === 'fatigue') {
      intruder.fx.fatigue = 10 * TPS;
      emit(g, { t: 'fx', p: intruder.id, fx: { ...intruder.fx }, absorb: intruder.absorb });
    } else if (kind === 'counter') {
      for (const p of g.players)
        if (p.alive && p.team === t.id && inBox(site.base, p.body.x, p.body.y, p.body.z)) {
          p.fx.speed = 15 * TPS;
          p.fx.speedLvl = Math.max(p.fx.speedLvl, 1);
          p.fx.jump = 15 * TPS;
          p.fx.jumpLvl = Math.max(p.fx.jumpLvl, 2);
          emit(g, { t: 'fx', p: p.id, fx: { ...p.fx }, absorb: p.absorb });
        }
    } else if (kind === 'alarm') {
      intruder.fx.invis = 0;
      emit(g, { t: 'fx', p: intruder.id, fx: { ...intruder.fx }, absorb: intruder.absorb });
    }
    emit(g, { t: 'trap', team: t.id, kind, p: intruder.id });
    emit(g, { t: 'traps', team: t.id, traps: [...t.traps] });
    emit(g, { t: 'msg', k: 'trap', team: t.id, text: `${TRAPS.find((x) => x.kind === kind)!.name} was set off by ${intruder.name}!` });
  }
}

function tickClock(g: Game) {
  const next = g.phases[g.phase];
  if (!next || g.tick < next.at) return;
  g.phase++;
  emit(g, { t: 'phase', kind: next.kind });
  if (next.kind === 'diamond2' || next.kind === 'diamond3' || next.kind === 'emerald2' || next.kind === 'emerald3') {
    const kind = next.kind.startsWith('diamond') ? 'diamond' : 'emerald';
    const tier = next.kind.endsWith('2') ? 2 : 3;
    for (const gen of g.gens) if (gen.kind === kind) gen.tier = tier;
    emit(g, { t: 'tier', kind, tier });
    emit(g, { t: 'msg', k: 'tier', text: `${kind === 'diamond' ? 'Diamond' : 'Emerald'} Generators have been upgraded to Tier ${tier === 2 ? 'II' : 'III'}` });
  } else if (next.kind === 'bedgone') {
    emit(g, { t: 'msg', k: 'phase', text: 'BED DESTRUCTION > All beds have been destroyed!' });
    for (const t of g.teams) if (t.bed) destroyBed(g, t.id, -1);
  } else if (next.kind === 'sudden') {
    emit(g, { t: 'msg', k: 'phase', text: 'SUDDEN DEATH > swords and arrows hit harder. finish it!' });
  } else if (next.kind === 'end') {
    emit(g, { t: 'msg', k: 'phase', text: 'GAME OVER > time is up. nobody wins this one.' });
    g.over = true;
    g.winner = -1;
    emit(g, { t: 'win', team: -1 });
  }
}

/** The phase coming next and the ticks until it, for the scoreboard. */
export function nextPhase(g: Game): { label: string; ticks: number } | null {
  const p = g.phases[g.phase];
  return p ? { label: p.label, ticks: Math.max(0, p.at - g.tick) } : null;
}

/** Sudden death doubles damage (applied by callers that want it). */
export const suddenDeath = (g: Game) => g.phases.findIndex((p) => p.kind === 'sudden') < g.phase;

export { HURT_TICKS, ITEM_DEFS };

// ---------------------------------------------------------------------------------------------------------------
// Actions: one shape for everything a player can ask for, applied directly on the host and sent over the wire by guests.

export type Action =
  | { a: 'place'; x: number; y: number; z: number; slot: number; face: number; seq: number }
  | { a: 'break'; x: number; y: number; z: number; seq: number }
  | { a: 'hit'; target: number; crit: boolean }
  | { a: 'shoot'; charge: number; yaw: number; pitch: number }
  | { a: 'use'; slot: number; yaw: number; pitch: number }
  | { a: 'buy'; id: string }
  | { a: 'upg'; key: UpgradeKey }
  | { a: 'trap'; kind: TrapKind }
  | { a: 'drop'; slot: number; all: boolean }
  | { a: 'sel'; slot: number }
  | { a: 'fall'; d: number };

/** Applies an action for a player. remote widens the reach checks a little for network lag. */
export function applyAction(g: Game, p: Player, act: Action, remote = false): boolean {
  if (g.over) return false;
  const slack = remote ? 1.5 : 0;
  switch (act.a) {
    case 'place': {
      const ok = placeBlock(g, p, act.x, act.y, act.z, act.slot, act.face, slack);
      if (remote) emit(g, { t: 'ack', p: p.id, seq: act.seq, ok });
      if (!ok && remote) emit(g, { t: 'block', x: act.x, y: act.y, z: act.z, id: g.world.get(act.x, act.y, act.z), by: -1, placed: g.world.isPlaced(act.x, act.y, act.z), was: AIR });
      return ok;
    }
    case 'break': {
      const ok = breakBlock(g, p, act.x, act.y, act.z, slack);
      if (remote) emit(g, { t: 'ack', p: p.id, seq: act.seq, ok });
      if (!ok && remote) emit(g, { t: 'block', x: act.x, y: act.y, z: act.z, id: g.world.get(act.x, act.y, act.z), by: -1, placed: g.world.isPlaced(act.x, act.y, act.z), was: AIR });
      return ok;
    }
    case 'hit':
      return attack(g, p, act.target, act.crit, slack);
    case 'shoot':
      return shoot(g, p, act.charge, act.yaw, act.pitch);
    case 'use':
      return useItem(g, p, act.slot, act.yaw, act.pitch);
    case 'buy':
      return buyOffer(g, p, act.id, slack);
    case 'upg':
      return buyUpgrade(g, p, act.key, slack);
    case 'trap':
      return buyTrap(g, p, act.kind, slack);
    case 'drop':
      return dropHeld(g, p, act.slot, act.all);
    case 'sel':
      if (act.slot >= 0 && act.slot < 9) p.sel = act.slot;
      return true;
    case 'fall':
      if (act.d > 0 && act.d < 300) landed(g, p, act.d);
      return true;
  }
}
