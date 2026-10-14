// A guest's copy of the game: built from the host's sync, then kept current by the host's events, position
// snapshots and score table. The guest never runs the rules; it only mirrors them (and moves its own player).
// Pure, so it runs under node.
import { AIR, BLOCKS, SX, SZ } from './blocks.ts';
import { applyKnock } from './combat.ts';
import { createGame, type Ev, type Game, type Player, type ProjKind } from './game.ts';
import { ITEMS, type Inventory, type UpgradeKey } from './items.ts';
import { newBody } from './physics.ts';
import { F_ALIVE, F_GROUND, F_INVIS, F_SNEAK, F_SPRINT, type PosEntry, type SyncState } from './net.ts';

/** Builds a guest's replica from a sync: the same map and roster, then every change the host has seen. */
export function buildReplica(s: SyncState, mySeat: number): { game: Game; me: number } {
  const entrants = s.roster.map((r) => ({ name: r.name, seat: r.seat, ctrl: (r.seat === mySeat && !r.bot ? 'local' : 'remote') as 'local' | 'remote', skin: r.skin, team: r.team }));
  const g = createGame({ mode: s.mode, pace: s.pace, level: s.level, entrants, seed: s.seed, authority: false });
  // createGame spreads entrants over teams itself; trust the host's assignment
  s.roster.forEach((r, i) => {
    const p = g.players[i];
    if (!p) return;
    p.team = r.team;
  });
  applySync(g, s);
  const me = s.roster.findIndex((r) => r.seat === mySeat && !r.bot);
  return { game: g, me };
}

/** Lays a sync state over a replica (also used to catch up after a gap). */
export function applySync(g: Game, s: SyncState) {
  const w = g.world;
  for (let i = 0; i < s.edits.length; i += 3) {
    const idx = s.edits[i];
    const id = s.edits[i + 1];
    const x = idx % SX;
    const z = Math.floor(idx / SX) % SZ;
    const y = Math.floor(idx / (SX * SZ));
    w.set(x, y, z, id, s.edits[i + 2] === 1);
  }
  g.tick = s.tick;
  g.phase = s.phase;
  g.over = s.over;
  g.winner = s.winner;
  const UP: UpgradeKey[] = ['sharp', 'prot', 'haste', 'forge', 'heal'];
  s.teams.forEach((t, i) => {
    const team = g.teams[i];
    if (!team) return;
    team.bed = t.bed;
    team.out = t.out;
    UP.forEach((k, j) => (team.ups[k] = t.ups[j] ?? 0));
    team.traps = [...t.traps];
  });
  s.players.forEach((sp, i) => {
    const p = g.players[i];
    if (!p) return;
    p.alive = sp.alive;
    p.out = sp.out;
    p.respawn = sp.respawn;
    p.hp = sp.hp;
    p.absorb = sp.absorb;
    [p.stats.kills, p.stats.finals, p.stats.beds, p.stats.deaths] = sp.stats;
    p.inv.armor = sp.armor;
    p.epoch = sp.epoch;
    if (p.ctrl !== 'local' || !p.alive) {
      p.body.x = sp.x;
      p.body.y = sp.y;
      p.body.z = sp.z;
    }
  });
  g.drops = s.drops
    .filter((d) => ITEMS[d[1]])
    .map(([id, item, n, x, y, z]) => ({ id, item: ITEMS[item], n, x, y, z, vx: 0, vy: 0, vz: 0, age: 0, pickDelay: 0, gen: 0, rest: false }));
  const KINDS: ProjKind[] = ['arrow', 'fireball', 'pearl', 'egg', 'tnt'];
  g.projs = s.projs
    .filter((p) => KINDS[p[1]])
    .map(([id, kind, owner, x, y, z, vx, vy, vz]) => ({ id, kind: KINDS[kind], owner, x, y, z, vx, vy, vz, age: 0, power: 0, punch: 0, full: false }));
  s.gens.forEach(([tier, timer], i) => {
    if (!g.gens[i]) return;
    g.gens[i].tier = tier;
    g.gens[i].timer = timer;
  });
}

/** Mirrors one host event in the replica (the client also plays its sound and effects). */
export function applyEvent(g: Game, e: Ev, me: number) {
  const w = g.world;
  const P = (id: number): Player | undefined => g.players[id];
  switch (e.t) {
    case 'block':
      w.set(e.x, e.y, e.z, e.id, e.placed);
      break;
    case 'hurt': {
      const p = P(e.p);
      if (!p) break;
      p.hp = e.hp;
      p.absorb = e.abs;
      if (e.by >= -1 && e.cause !== 'magic') p.hurtTicks = 10;
      break;
    }
    case 'kb': {
      const p = P(e.p);
      if (p && e.p === me) applyKnock(p.body, e.k);
      break;
    }
    case 'die': {
      const p = P(e.p);
      if (!p) break;
      p.alive = false;
      p.hp = 0;
      p.diedAt = [p.body.x, Math.max(p.body.y, 10), p.body.z];
      p.stats.deaths++;
      const k = e.by >= 0 ? P(e.by) : undefined;
      if (k) {
        if (e.final) k.stats.finals++;
        else k.stats.kills++;
      }
      if (e.final) p.out = true;
      else p.respawn = 100;
      break;
    }
    case 'spawn': {
      const p = P(e.p);
      if (!p) break;
      p.alive = true;
      p.hp = 20;
      p.absorb = 0;
      p.respawn = 0;
      p.epoch = e.ep;
      const yaw = e.yaw;
      p.body = newBody(e.x, e.y, e.z, yaw);
      break;
    }
    case 'tp': {
      const p = P(e.p);
      if (!p) break;
      p.epoch = e.ep;
      p.body.x = e.x;
      p.body.y = e.y;
      p.body.z = e.z;
      p.body.vx = p.body.vy = p.body.vz = 0;
      p.body.fallDistance = 0;
      break;
    }
    case 'bed': {
      const t = g.teams[e.team];
      if (t) t.bed = false;
      const k = e.by >= 0 ? P(e.by) : undefined;
      if (k) k.stats.beds++;
      break;
    }
    case 'elim': {
      const t = g.teams[e.team];
      if (!t) break;
      t.out = true;
      for (const p of g.players) if (p.team === e.team) p.out = true;
      break;
    }
    case 'drop':
      if (!g.drops.some((d) => d.id === e.id)) g.drops.push({ id: e.id, item: e.item, n: e.n, x: e.x, y: e.y, z: e.z, vx: e.vx, vy: e.vy, vz: e.vz, age: 0, pickDelay: 0, gen: e.gen, rest: false });
      break;
    case 'dropn': {
      const d = g.drops.find((x) => x.id === e.id);
      if (d) d.n = e.n;
      break;
    }
    case 'pick':
      g.drops = g.drops.filter((d) => d.id !== e.id);
      break;
    case 'proj':
      if (!g.projs.some((p) => p.id === e.id)) g.projs.push({ id: e.id, kind: e.kind, owner: e.owner, x: e.x, y: e.y, z: e.z, vx: e.vx, vy: e.vy, vz: e.vz, age: 0, power: 0, punch: 0, full: false });
      break;
    case 'pgone':
      g.projs = g.projs.filter((p) => p.id !== e.id);
      break;
    case 'upg': {
      const t = g.teams[e.team];
      if (t) t.ups[e.key] = e.level;
      break;
    }
    case 'traps': {
      const t = g.teams[e.team];
      if (t) t.traps = [...e.traps];
      break;
    }
    case 'tier':
      for (const gen of g.gens) if (gen.kind === e.kind) gen.tier = e.tier;
      break;
    case 'phase':
      g.phase = Math.max(g.phase, g.phases.findIndex((p) => p.kind === e.kind) + 1);
      break;
    case 'win':
      g.over = true;
      g.winner = e.team;
      break;
    case 'fx': {
      const p = P(e.p);
      if (!p) break;
      p.fx = { ...e.fx };
      p.absorb = e.absorb;
      break;
    }
    case 'swing': {
      const p = P(e.p);
      if (p && e.p !== me) p.swings++;
      break;
    }
    case 'boom':
    case 'msg':
    case 'trap':
    case 'use':
    case 'inv':
    case 'ack':
      break;
  }
}

/** Moves everyone but me to where the host says they are. */
export function applyPositions(g: Game, list: PosEntry[], me: number) {
  for (const [id, x, y, z, yaw, pitch, flags, held, tier, armor, hp, swings, drawing] of list) {
    const p = g.players[id];
    if (!p) continue;
    p.inv.armor = armor;
    p.show.item = ITEMS[held] ?? null;
    p.show.tier = tier;
    p.fx.invis = flags & F_INVIS ? Math.max(p.fx.invis, 2) : 0;
    if (id === me) continue;
    p.hp = hp;
    const b = p.body;
    b.x = x;
    b.y = y;
    b.z = z;
    b.yaw = yaw;
    b.pitch = pitch;
    b.sneaking = !!(flags & F_SNEAK);
    b.sprinting = !!(flags & F_SPRINT);
    b.onGround = !!(flags & F_GROUND);
    if (!!(flags & F_ALIVE) !== p.alive && p.alive) p.alive = false;
    p.swings = swings;
    p.drawing = drawing;
  }
}

/** Applies the host's once-a-second table: the clock, generator timers, and everyone's score and state. */
export function applyTable(g: Game, tick: number, phase: number, gens: [number, number][], stats: [number, number, number, number, number, number, number][]) {
  g.tick = tick;
  g.phase = Math.max(g.phase, phase);
  gens.forEach(([tier, timer], i) => {
    if (!g.gens[i]) return;
    g.gens[i].tier = tier;
    g.gens[i].timer = timer;
  });
  stats.forEach(([kills, finals, beds, deaths, alive, out, respawn], i) => {
    const p = g.players[i];
    if (!p) return;
    p.stats.kills = kills;
    p.stats.finals = finals;
    p.stats.beds = beds;
    p.stats.deaths = deaths;
    p.out = out === 1;
    p.respawn = respawn;
    if (!alive && p.alive) p.alive = false;
  });
}

/** A fresh inventory from the host, with our own placements it has not seen yet taken off again. */
export function applyInventory(p: Player, inv: Inventory, sel: number, pending: { seq: number; slot: number }[], ack: number) {
  const keep = pending.filter((x) => x.seq > ack);
  pending.length = 0;
  pending.push(...keep);
  p.inv = inv;
  for (const x of keep) {
    const s = p.inv.slots[x.slot];
    if (!s) continue;
    s.n--;
    if (s.n <= 0) p.inv.slots[x.slot] = null;
  }
  void sel;
}

/** Is there something solid right here (used to keep a guest's predicted blocks honest)? */
export const solidAt = (g: Game, x: number, y: number, z: number) => {
  const id = g.world.get(x, y, z);
  return id !== AIR && BLOCKS[id].solid;
};
