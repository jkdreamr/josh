import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { AMMO_BOX, AMMO_TYPES, BOOST, MAX_PACK, MELEE, THROWS, THROW_IDS, USES, USE_IDS, WALL_COST, WEAPONS, WEAPON_IDS, WOOD_MAX, ammoCap, damageOf, parseLoot, rng32, rollLoot, throwCap, useCap, type LootDef } from '../src/os/arcade/games/scramble/items.ts';
import {
  BEACH,
  BUS_Y,
  DOOR,
  DROP_BASE,
  EDGE,
  HALF,
  PEEK,
  POND_SLOW,
  STORM_PHASES,
  STORM_R0,
  SUPPLY_FALL,
  WALL_T,
  buildingAt,
  busAt,
  coverAt,
  generateMap,
  peekAt,
  pushBox,
  pushCircle,
  pushObb,
  rayBox,
  rayCircle,
  rayObb,
  raySolid,
  solidsNear,
  stormAt,
  stormEnd,
  walkCells,
  type Building,
  type Door,
  type GameMap,
} from '../src/os/arcade/games/scramble/map.ts';
import {
  BARREL,
  CHEST_R,
  COUNTDOWN,
  CRATE_HP,
  FALL,
  FIGHTER_COLORS,
  FIGHTER_R,
  F_PAN,
  INTERP,
  LEVELS,
  MAX_FIGHTERS,
  PICK_R,
  SLOT_MELEE,
  SLOT_THROW,
  SPEED,
  STORM_TICK,
  WALL_HP,
  aliveCount,
  applyState,
  autopilot,
  bestUse,
  botNames,
  canSee,
  castRay,
  clearLine,
  concealed,
  createMatch,
  damageCrate,
  dropId,
  held,
  hurt,
  makeWall,
  noInput,
  panBlocks,
  prompt,
  scoreOf,
  soloMatch,
  standing,
  step,
  viewOf,
  type Entrant,
  type Ev,
  type Fighter,
  type Level,
  type Match,
} from '../src/os/arcade/games/scramble/logic.ts';
import { applyNet, configOf, endOf, guestState, hostState, packEvents, parsePacket, placesOf, stateOf, toNet, type NetEv } from '../src/os/arcade/games/scramble/net.ts';
import { END_PAUSE, FIRST_GRACE, FLUSH, STALE, TICK_MS, ending, flush, guestMatch, hostMatch, newSession, receive, share, tick, type Me, type Player, type Session } from '../src/os/arcade/games/scramble/session.ts';
import { meta } from '../src/os/arcade/games/scramble/meta.ts';

const DT = 1 / 60;

function run(m: Match, seconds: number, each?: (evs: Ev[]) => void) {
  const all: Ev[] = [];
  for (let t = 0; t < seconds; t += DT) {
    step(m, DT);
    const evs = m.events.splice(0);
    all.push(...evs);
    each?.(evs);
  }
  return all;
}

/** Clears the island down to bare grass (no trees, rocks, buildings, bushes, crates, barrels or loot) and returns its middle. */
function openSpot(m: Match) {
  m.map.solids = [];
  m.map.grid = m.map.grid.map(() => []);
  m.map.bushes = [];
  m.map.buildings = [];
  m.map.containers = [];
  m.map.drops = [];
  m.opened = [];
  m.crateHp = [];
  m.loot.clear();
  return { x: 0, z: 0 };
}

/** Puts an egg on the ground at a point, standing still. */
function land(f: Fighter, x: number, z: number) {
  f.phase = 'ground';
  f.y = 0;
  f.x = x;
  f.z = z;
  f.vx = 0;
  f.vz = 0;
}

/** A solo match a few seconds past the countdown, with the computer players switched off. */
function quiet(seed = 7, n = 2): Match {
  const entrants: Entrant[] = Array.from({ length: n }, (_, i) => ({ name: `p${i}`, color: '#fff', kind: 'player', seat: -1 }));
  const m = createMatch({ seed, role: 'solo', level: 'normal', entrants, me: 0, countdown: 0 });
  m.time = 5;
  return m;
}

// ---------------------------------------------------------------------------------------------------------------------
// The island.

test('the island is the same for a seed and different between seeds', () => {
  const strip = (s: number) => {
    const m = generateMap(s);
    return JSON.stringify({ ...m, grid: undefined, stamp: undefined, mark: undefined });
  };
  assert.equal(strip(42), strip(42));
  assert.notEqual(strip(42), strip(43));
});

const KIND_COUNTS: Partial<Record<Building['kind'], number>> = { coop: 1, warehouse: 2, farm: 2, house: 9, shed: 7, ruin: 4 };
const DOOR_COUNTS: Partial<Record<Building['kind'], number>> = { coop: 1, warehouse: 3, farm: 3, house: 2, shed: 1, container: 1 };
/** Total wall length a building would have with no gaps at all (corners counted once), as its walls are laid out. */
const fullWalls = (b: Building) => 2 * (b.w + WALL_T) + 2 * (b.d - WALL_T);
const wallLength = (b: Building) => b.walls.reduce((s, w) => s + 2 * Math.max(w.hw, w.hd), 0);

test('every island has all its buildings, each with the doorways it should have, and nothing outdoors inside them', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const m = generateMap(seed);
    for (const [kind, n] of Object.entries(KIND_COUNTS)) assert.equal(m.buildings.filter((b) => b.kind === kind).length, n, `seed ${seed}: ${kind}`);
    assert.ok(m.buildings.filter((b) => b.kind === 'container').length >= 6, `seed ${seed}: two yards of containers`);
    assert.equal(m.buildings[m.coop]?.kind, 'coop');
    assert.equal(m.fields.length, 2, 'a cornfield beside each farm');
    assert.equal(m.ponds.length, 3);
    for (const b of m.buildings) {
      assert.ok(Math.abs(b.x) + b.w / 2 < HALF - BEACH && Math.abs(b.z) + b.d / 2 < HALF - BEACH, 'buildings stand on grass');
      assert.equal(b.roof, b.kind !== 'ruin', 'everything but ruins has a roof');
      const gaps = fullWalls(b) - wallLength(b);
      if (b.kind === 'house') assert.ok(Math.abs(gaps - 2 * DOOR) < 0.31, `seed ${seed}: a house has two doorways`);
      if (b.kind === 'shed' || b.kind === 'coop') assert.ok(Math.abs(gaps - DOOR) < 0.31, `seed ${seed}: one way into a ${b.kind}`);
      if (b.kind === 'warehouse') assert.ok(Math.abs(gaps - 2 * 6 - DOOR) < 0.31, `seed ${seed}: two loading doors and a side door`);
      if (b.kind === 'farm') assert.ok(Math.abs(gaps + (b.d - WALL_T - DOOR) - 3 * DOOR) < 0.31, `seed ${seed}: three doors and a door between the rooms`);
      if (b.kind === 'container') assert.ok(Math.abs(gaps - (b.w > b.d ? b.d - WALL_T : b.w + WALL_T)) < 0.31, 'open at one end');
      if (b.kind !== 'ruin') assert.equal(b.doors.length, DOOR_COUNTS[b.kind], `seed ${seed}: the ways out of a ${b.kind} are on record`);
    }
    const roofed = m.buildings.filter((b) => b.kind !== 'container');
    for (const [i, a] of roofed.entries()) for (const b of roofed.slice(i + 1)) assert.ok(Math.abs(a.x - b.x) >= (a.w + b.w) / 2 + 7 || Math.abs(a.z - b.z) >= (a.d + b.d) / 2 + 7, 'buildings keep apart');
    const inside = (x: number, z: number) => m.buildings.some((b) => Math.abs(x - b.x) < b.w / 2 + 1 && Math.abs(z - b.z) < b.d / 2 + 1) || m.fields.some((f) => Math.abs(x - f.x) < f.hw + 1 && Math.abs(z - f.z) < f.hd + 1);
    const wet = (x: number, z: number, r: number) => m.ponds.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + r);
    for (const t of [...m.trees, ...m.rocks, ...m.bushes]) {
      assert.ok(!inside(t.x, t.z), `seed ${seed}: nothing grows indoors or in the corn`);
      assert.ok(!wet(t.x, t.z, 0), 'nor in a pond');
    }
    for (const l of m.floor) assert.ok(!wet(l.x, l.z, 0), 'no loot lies in a pond');
    assert.ok(m.trees.length >= 220 && m.rocks.length >= 60 && m.bushes.length >= 100, `seed ${seed} scenery`);
    const kinds = (k: string) => m.containers.filter((c) => c.kind === k);
    assert.ok(kinds('chest').length >= 20, 'a chest in every house and farm, and more besides');
    assert.equal(kinds('chest').filter((c) => c.gold).length, 1, 'one golden chest, in the Golden Coop');
    assert.ok(kinds('barrel').length >= 16, 'barrels about');
    assert.equal(kinds('supply').length, 3);
  }
});

test('standing at a doorway, or lined up with one a few steps out, peeks into that building, and nowhere else does', () => {
  const out = (d: Door, k: number, side = 0) => ({ x: d.x + d.ox * k + Math.abs(d.oz) * side, z: d.z + d.oz * k + Math.abs(d.ox) * side });
  for (let seed = 1; seed <= 25; seed++) {
    const m = generateMap(seed);
    m.buildings.forEach((b, i) => {
      for (const d of b.doors) {
        if (!b.roof) {
          const p = out(d, 1);
          assert.notEqual(peekAt(m, p.x, p.z), i, 'a ruin has no roof to peek under');
          continue;
        }
        for (const [k, side] of [[0, 0], [1.2, 0], [1.5, d.w / 2 + 0.8], [4, d.w / 2 + 1.5]]) {
          const p = out(d, k, side);
          const at = peekAt(m, p.x, p.z);
          // in a yard of containers, the next one's open end can be nearer
          if (b.kind === 'container') assert.ok(at >= 0 && m.buildings[at].kind === 'container', `seed ${seed}: peeking into a container`);
          else assert.equal(at, i, `seed ${seed}: ${k} m out from a ${b.kind}'s door`);
        }
        const far = out(d, 6);
        assert.ok(peekAt(m, far.x, far.z) >= 0, `seed ${seed}: lined up with a door from six meters`);
        const beyond = out(d, PEEK + 1);
        assert.notEqual(peekAt(m, beyond.x, beyond.z), i, 'too far to peek in');
      }
      // three meters out from the middle of a wall with no door in it, you can't see in
      if (!b.roof || b.kind === 'container') return;
      for (const [ox, oz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        if (b.doors.some((d) => d.ox === ox && d.oz === oz)) continue;
        const x = b.x + ox * (b.w / 2 + 3);
        const z = b.z + oz * (b.d / 2 + 3);
        assert.notEqual(peekAt(m, x, z), i, `seed ${seed}: no peeking into a ${b.kind} through a blank wall`);
      }
    });
  }
});

/**
 * Every spot an egg could stand on a 0.4 m grid over a window of the island, then which ones can be walked to from
 * the window's edge. Loot is in reach when an egg standing somewhere it can walk to could pick it up.
 */
function walkable(m: GameMap, x0: number, z0: number, x1: number, z1: number) {
  const step = 0.4;
  const nx = Math.ceil((x1 - x0) / step);
  const nz = Math.ceil((z1 - z0) / step);
  const free = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * step;
      const z = z0 + j * step;
      let ok = Math.abs(x) <= EDGE && Math.abs(z) <= EDGE;
      if (ok)
        solidsNear(m, x, z, 3, (_k, s) => {
          if (ok && (s.shape === 'circle' ? pushCircle(x, z, FIGHTER_R, s.x, s.z, s.r) : pushBox(x, z, FIGHTER_R, s.x, s.z, s.hw, s.hd))) ok = false;
        });
      free[i + j * nx] = ok ? 1 : 0;
    }
  const seen = new Uint8Array(nx * nz);
  const queue: number[] = [];
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++)
      if ((i === 0 || j === 0 || i === nx - 1 || j === nz - 1) && free[i + j * nx]) {
        seen[i + j * nx] = 1;
        queue.push(i + j * nx);
      }
  while (queue.length) {
    const c = queue.pop()!;
    const i = c % nx;
    const j = (c - i) / nx;
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const a = i + di;
      const b = j + dj;
      if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
      const k = a + b * nx;
      if (free[k] && !seen[k]) {
        seen[k] = 1;
        queue.push(k);
      }
    }
  }
  return (x: number, z: number, reach: number) => {
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) if (seen[i + j * nx] && Math.hypot(x0 + i * step - x, z0 + j * step - z) < reach) return true;
    return false;
  };
}

test('every building can be walked into, and everything in it reached', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const m = generateMap(seed);
    for (const b of m.buildings) {
      const reach = walkable(m, b.x - b.w / 2 - 4, b.z - b.d / 2 - 4, b.x + b.w / 2 + 4, b.z + b.d / 2 + 4);
      const inBuilding = (x: number, z: number) => Math.abs(x - b.x) < b.w / 2 && Math.abs(z - b.z) < b.d / 2;
      for (const l of m.floor) if (inBuilding(l.x, l.z)) assert.ok(reach(l.x, l.z, PICK_R - 0.1), `seed ${seed}: loot at ${l.x},${l.z} in a ${b.kind}`);
      for (const c of m.containers) {
        if (!inBuilding(c.x, c.z)) continue;
        if (c.kind === 'chest') assert.ok(reach(c.x, c.z, CHEST_R - 0.1), `seed ${seed}: the chest in a ${b.kind}`);
        // a crate is broken from wherever a gun can see it; its loot spills where it stood
        if (c.kind === 'crate') assert.ok(reach(c.x, c.z, PICK_R + 0.7), `seed ${seed}: the crate in a ${b.kind}`);
      }
    }
  }
});

test('loot ids never collide, stay below the dropped range, and every item lies on the island', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const m = generateMap(seed);
    const items = [...m.floor, ...m.containers.flatMap((c) => c.loot)];
    const ids = items.map((l) => l.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const l of items) {
      assert.ok(l.id >= 0 && l.id < DROP_BASE);
      assert.ok(Math.abs(l.x) < EDGE && Math.abs(l.z) < EDGE);
      assert.ok(parseLoot(l.def), `valid loot ${JSON.stringify(l.def)}`);
    }
    assert.ok(m.floor.some((l) => l.def.kind === 'gun'), 'guns on the floor');
  }
});

test('the storm closes in nested circles that end on land, biting harder each time', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const s = generateMap(seed).storm;
    assert.equal(s.circles.length, STORM_PHASES.length + 1);
    for (let i = 1; i < s.circles.length; i++) {
      const a = s.circles[i - 1];
      const b = s.circles[i];
      assert.ok(Math.hypot(a.x - b.x, a.z - b.z) + b.r <= a.r + 1e-6, `seed ${seed}: circle ${i} inside the last`);
      assert.ok(Math.abs(b.x) + Math.max(b.r * 0.6, 4) <= HALF - 7 + 1e-6 && Math.abs(b.z) + Math.max(b.r * 0.6, 4) <= HALF - 7 + 1e-6, 'on land');
      assert.ok(s.starts[i - 1] < s.ends[i - 1] && (i === 1 || s.ends[i - 2] < s.starts[i - 1]), 'phases in order');
    }
    // continuous at every boundary
    for (let i = 0; i < s.starts.length; i++) {
      for (const t of [s.starts[i], s.ends[i]]) {
        const before = stormAt(s, t - 1e-6);
        const after = stormAt(s, t + 1e-6);
        assert.ok(Math.abs(before.r - after.r) < 1e-3 && Math.abs(before.x - after.x) < 1e-3, `seed ${seed}: no jump at ${t}`);
      }
    }
  }
  const s = generateMap(3).storm;
  assert.equal(stormAt(s, 0).dps, 0, 'no bite before the first circle');
  assert.equal(stormAt(s, 0).r, STORM_R0, 'the first circle takes in the whole island');
  assert.ok(STORM_R0 > HALF * Math.SQRT2, 'corners and all');
  let dps = 0;
  for (let t = 0; t < stormEnd(s) + 5; t += 1) {
    const now = stormAt(s, t);
    assert.ok(now.dps >= dps, 'the bite never eases');
    dps = now.dps;
  }
  assert.equal(stormAt(s, stormEnd(s) + 10).r, 0);
  assert.ok(stormEnd(s) > 300 && stormEnd(s) < 400, 'a match lasts six minutes at most');
});

test('the bus flies across the island, near the middle, from sea to sea', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const b = generateMap(seed).bus;
    assert.ok(Math.max(Math.abs(b.x0), Math.abs(b.z0)) > HALF && Math.max(Math.abs(b.x1), Math.abs(b.z1)) > HALF, 'starts and ends at sea');
    let near = Infinity;
    for (let t = 0; t <= b.dur; t += 0.25) {
      const p = busAt(b, t);
      near = Math.min(near, Math.hypot(p.x, p.z));
    }
    assert.ok(near < 55, `seed ${seed}: passes within ${near.toFixed(0)} m of the middle`);
    assert.ok(b.dur > 12 && b.dur < 24);
    assert.ok(b.on > 0 && b.on < b.off && b.off < b.dur && b.off - b.on > 4, 'over land for a good while');
    for (const t of [b.on + 0.01, (b.on + b.off) / 2, b.off - 0.01]) {
      const p = busAt(b, t);
      assert.ok(Math.abs(p.x) <= EDGE && Math.abs(p.z) <= EDGE, 'the door opens over land');
    }
    assert.deepEqual(busAt(b, -3), { x: b.x0, z: b.z0 }, 'waits at the start through the countdown');
  }
});

test('rays and pushes', () => {
  assert.equal(rayCircle(0, 0, 1, 0, 10, 5, 0, 1), 4);
  assert.equal(rayCircle(0, 0, -1, 0, 10, 5, 0, 1), Infinity, 'behind');
  assert.equal(rayCircle(0, 0, 1, 0, 3, 5, 0, 1), Infinity, 'out of reach');
  assert.equal(rayCircle(5, 0, 1, 0, 3, 5, 0, 1), 0, 'starts inside');
  assert.equal(rayBox(0, 0, 1, 0, 10, 5, 0, 1, 1), 4);
  assert.equal(rayBox(0, 3, 1, 0, 10, 5, 0, 1, 1), Infinity);
  assert.equal(rayBox(0, 0, 0, 1, 10, 0, 5, 1, 1), 4, 'straight along an axis');
  // a wall facing +x (a = PI / 2): its length runs along z, so a ray along x meets its thin side
  const wall = { x: 5, z: 0, sa: 1, ca: 0, hw: 1.7, hd: 0.2 };
  assert.ok(Math.abs(rayObb(0, 0, 1, 0, 10, wall) - 4.8) < 1e-9);
  assert.ok(Math.abs(rayObb(0, 1.5, 1, 0, 10, wall) - 4.8) < 1e-9, 'anywhere along its length');
  assert.equal(rayObb(0, 2, 1, 0, 10, wall), Infinity, 'past its end');
  const p = pushBox(0, 1.3, 0.6, 0, 0, 1, 1)!;
  assert.ok(Math.abs(p.z - 0.3) < 1e-9 && p.x === 0);
  const q = pushObb(5.5, 0, 0.6, wall)!;
  assert.ok(Math.abs(q.x - 0.3) < 1e-9 && Math.abs(q.z) < 1e-9, 'pushed straight out of the wall');
  assert.equal(pushBox(5, 5, 0.6, 0, 0, 1, 1), null);
});

test('the grid finds everything a ray could hit, the same as checking every solid', () => {
  const m = quiet(11);
  const rng = rng32(5);
  for (let i = 0; i < 3000; i++) {
    const x = (rng() * 2 - 1) * (HALF - 5);
    const z = (rng() * 2 - 1) * (HALF - 5);
    const a = rng() * Math.PI * 2;
    const len = 1 + rng() * 60;
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    const grid = castRay(m, x, z, dx, dz, len, -1, false);
    let brute = Infinity;
    for (const s of m.map.solids) if (standing(m, s)) brute = Math.min(brute, raySolid(s, x, z, dx, dz, len));
    assert.equal(grid?.t ?? Infinity, brute, `ray ${i}`);
  }
  // cells along a diagonal come in order, each next to the last
  const cells: number[] = [];
  walkCells(-150, -150, 150, 140, (c) => {
    cells.push(c);
  });
  const cols = (2 * HALF) / 8;
  for (let i = 1; i < cells.length; i++) {
    const d = Math.abs(cells[i] - cells[i - 1]);
    assert.ok(d === 1 || d === cols, 'neighbors');
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// The match.

test('the countdown, the bus, the jump and the landing', () => {
  const m = soloMatch(12, 'normal');
  assert.equal(m.fighters.length, MAX_FIGHTERS);
  assert.equal(m.me, 0);
  assert.ok(m.fighters.every((f) => f.phase === 'bus' && f.y === BUS_Y));
  const me = m.fighters[0];
  const evs = run(m, COUNTDOWN - 0.01);
  assert.equal(evs.filter((e) => e.t === 'beep').length, 3);
  me.input.jump = true;
  run(m, 0.05);
  assert.equal(me.phase, 'bus', 'nobody leaves before the bus gets going');
  assert.ok(m.map.bus.on > 0.3, 'the bus starts out at sea');
  run(m, m.map.bus.on + 0.1, () => (me.input.jump = false));
  me.input.jump = true;
  const jumped = run(m, 0.05);
  assert.ok(jumped.some((e) => e.t === 'jump' && e.f === 0));
  assert.equal(me.phase, 'drop');
  const fall = (BUS_Y - 1.5) / FALL;
  run(m, fall - 0.3);
  assert.equal(me.phase, 'drop');
  const landed = run(m, 0.6);
  assert.ok(landed.some((e) => e.t === 'land' && e.f === 0));
  assert.equal(me.phase, 'ground');
  // anyone still on board is put off before the bus leaves the island, over land
  const late = soloMatch(12, 'normal');
  for (const f of late.fighters) f.ai = null;
  run(late, COUNTDOWN + late.map.bus.off + 0.1);
  assert.ok(late.fighters.every((f) => f.phase === 'drop'));
  assert.ok(late.fighters.every((f) => Math.abs(f.x) <= EDGE && Math.abs(f.z) <= EDGE));
});

test('a bullet hits shields first, the storm goes straight for health', () => {
  const m = quiet();
  const [a, b] = m.fighters;
  const spot = openSpot(m);
  land(a, spot.x, spot.z);
  land(b, spot.x, spot.z + 6);
  a.guns[0] = { w: 'pistol', r: 0, mag: 14 };
  a.slot = 0;
  b.shield = 10;
  a.input.aim = 0;
  a.input.fire = true;
  const evs = run(m, 0.15);
  const hit = evs.find((e) => e.t === 'hit');
  assert.ok(hit && hit.t === 'hit' && hit.to === b.id && hit.local && hit.shield);
  assert.equal(b.shield, 0);
  assert.equal(b.hp, 100 - (damageOf('pistol', 0) - 10));
  assert.equal(a.dealt, damageOf('pistol', 0));
  b.shield = 50;
  hurt(m, b, 7, -1, 'storm', true);
  assert.equal(b.shield, 50, 'shields are no help in the storm');
  assert.equal(b.hp, 100 - (damageOf('pistol', 0) - 10) - 7);
});

test('rarer guns hit harder and reload faster', () => {
  for (const w of Object.keys(WEAPONS) as (keyof typeof WEAPONS)[]) {
    for (let r = 1; r <= 4; r++) assert.ok(damageOf(w, r) > damageOf(w, r - 1));
  }
});

test('the same shot gives the same pellets on every client, and shotgun pellets lose bite with distance', () => {
  const a = quiet();
  const b = quiet();
  for (const m of [a, b]) {
    const spot = openSpot(m);
    land(m.fighters[0], spot.x, spot.z);
    m.fighters[1].phase = 'out';
  }
  const fired = (m: Match, local: boolean) => {
    m.bullets = [];
    m.fighters[0].firedAt = -9;
    // the network shot the shooter's client announced
    const s = 12345;
    const f = m.fighters[0];
    applyNet(m, { y: 's', f: 0, w: 'shotgun', r: 2, x: f.x, z: f.z, a: 0.3, s, k: 1.2 });
    return m.bullets.map((x) => [x.dx, x.dz, x.speed, x.local === local]);
  };
  a.fighters[0].kind = 'remote';
  b.fighters[0].kind = 'remote';
  assert.deepEqual(fired(a, false), fired(b, false));
  assert.equal(a.bullets.length, WEAPONS.shotgun.pellets);

  // up close all nine pellets land, from across the field only some do and each for less
  const total = (dist: number) => {
    const m = quiet();
    const [s, t] = m.fighters;
    const spot = openSpot(m);
    land(s, spot.x, spot.z);
    land(t, spot.x, spot.z + dist);
    t.hp = 100;
    t.shield = 100;
    s.guns[0] = { w: 'shotgun', r: 0, mag: 6 };
    s.slot = 0;
    s.input.aim = 0;
    s.input.fire = true;
    run(m, 0.05);
    s.input.fire = false;
    run(m, 1);
    return 200 - t.hp - t.shield;
  };
  const near = total(3);
  const far = total(18);
  assert.equal(near, WEAPONS.shotgun.pellets * damageOf('shotgun', 0));
  assert.ok(far > 0 && far < near * 0.5, `far ${far} vs near ${near}`);
});

test('walls cost wood, face the way you aim, stop bullets and break', () => {
  const m = quiet();
  const [a, b] = m.fighters;
  const spot = openSpot(m);
  land(a, spot.x, spot.z);
  land(b, spot.x, spot.z + 9);
  a.wood = WALL_COST + 1;
  a.input.aim = 0.1;
  a.input.build = true;
  const evs = run(m, 0.05);
  const built = evs.find((e) => e.t === 'wall');
  assert.ok(built && built.t === 'wall');
  assert.equal(a.wood, 1);
  assert.equal(built.wall.a, 0, 'squared to the nearest eighth of a turn');
  assert.ok(Math.abs(built.wall.z - (a.z + 2.1)) < 0.05);
  a.input.build = true;
  run(m, 0.5);
  assert.equal(m.walls.size, 1, 'no wood, no wall');
  // b shoots at a through the wall: the wall soaks it
  b.guns[0] = { w: 'rifle', r: 0, mag: 30 };
  b.ammo.heavy = 200;
  b.slot = 0;
  b.input.aim = Math.PI;
  b.input.fire = true;
  run(m, 0.6);
  assert.equal(a.hp, 100, 'the wall took the bullets');
  assert.ok(m.walls.get(built.wall.id)!.hp < WALL_HP);
  const gone = run(m, 6);
  assert.ok(gone.some((e) => e.t === 'wallgone'), 'and gave way');
  assert.equal(m.walls.size, 0);
  assert.ok(a.hp < 100, 'then the shots got through');
});

test('only the host knocks walls down and breaks crates; a guest waits to hear it', () => {
  const g = createMatch({ seed: 5, role: 'guest', level: 'normal', entrants: [{ name: 'g', color: '#fff', kind: 'player', seat: 1 }], me: 0, countdown: 0 });
  const crate = g.map.containers.find((c) => c.kind === 'crate')!;
  applyNet(g, { y: 'wl', id: 7, f: 0, x: 0, z: 0, a: 0, hp: 50 });
  applyNet(g, { y: 'm', f: 0, k: 'wall', id: 7, d: 80 });
  applyNet(g, { y: 'm', f: 0, k: 'crate', id: crate.id, d: CRATE_HP * 2 });
  assert.ok(g.walls.has(7) && !g.opened[crate.id], 'still standing until the host says');
  applyNet(g, { y: 'wg', id: 7 });
  applyNet(g, { y: 'opd', c: crate.id, f: 0 });
  assert.ok(!g.walls.has(7) && g.opened[crate.id]);
  for (const l of crate.loot) assert.ok(g.loot.has(l.id), 'the crate spilled its own loot ids');
  applyNet(g, { y: 'wl', id: 7, f: 0, x: 0, z: 0, a: 0, hp: 50 });
  assert.ok(!g.walls.has(7), 'a late echo never brings a fallen wall back');

  const h = quiet(5);
  const box = h.map.containers.find((c) => c.kind === 'crate')!;
  applyNet(h, { y: 'm', f: 1, k: 'crate', id: box.id, d: CRATE_HP });
  assert.ok(h.opened[box.id]);
  assert.ok(h.events.some((e) => e.t === 'opened' && !e.net), 'and tells everyone');
});

test('chests open with the interact key; a guest asks the host', () => {
  const m = quiet(9);
  const me = m.fighters[0];
  const chest = m.map.containers.find((c) => c.kind === 'chest')!;
  land(me, chest.x, chest.z + chest.face * 1.4);
  const p = prompt(m, me);
  assert.ok(p && 'chest' in p && p.chest === chest.id);
  me.input.interact = true;
  run(m, 0.05);
  assert.ok(m.opened[chest.id]);
  assert.ok(chest.loot.some((l) => l.def.kind === 'gun'), 'chests always hold a gun');

  const g = createMatch({ seed: 9, role: 'guest', level: 'normal', entrants: [{ name: 'g', color: '#fff', kind: 'player', seat: 1 }], me: 0, countdown: 0 });
  g.time = 5;
  land(g.fighters[0], chest.x, chest.z + chest.face * 1.4);
  g.fighters[0].input.interact = true;
  const evs = run(g, 0.05);
  assert.ok(!g.opened[chest.id]);
  assert.ok(evs.some((e) => e.t === 'open' && e.c === chest.id));
  assert.ok(Math.hypot(chest.x - g.fighters[0].x, chest.z - g.fighters[0].z) < CHEST_R);
});

test('walking over ammo, healing and throwables picks them up; guns need a free hand or the key', () => {
  const m = quiet();
  const me = m.fighters[0];
  const spot = openSpot(m);
  land(me, spot.x, spot.z);
  const put = (id: number, def: LootDef, dx = 0) => m.loot.set(id, { id, def, x: spot.x + dx, z: spot.z, by: -1, at: 0 });
  put(1, { kind: 'ammo', a: 'light', n: 30 });
  put(2, { kind: 'use', w: 'bandage', n: 2 });
  put(3, { kind: 'gun', w: 'smg', r: 2 });
  put(4, { kind: 'gun', w: 'rifle', r: 1 });
  put(5, { kind: 'gun', w: 'sniper', r: 4 }, 1.4);
  run(m, 0.1);
  assert.equal(me.ammo.light, 30);
  assert.equal(me.items.bandage, 2);
  assert.deepEqual(me.guns.map((g) => g?.w).sort(), ['rifle', 'smg'], 'both hands filled by walking over them');
  assert.equal(me.guns[0]!.mag, WEAPONS[me.guns[0]!.w].mag, 'a gun from the floor comes loaded');
  assert.ok(m.loot.has(5), 'a third gun waits for the key');
  // swap: the gun in hand goes down with an id from this egg's own range
  me.slot = me.guns.findIndex((g) => g?.w === 'smg');
  me.input.interact = true;
  const evs = run(m, 0.05);
  const drop = evs.find((e) => e.t === 'drop');
  assert.ok(drop && drop.t === 'drop' && drop.item.def.kind === 'gun' && drop.item.def.w === 'smg');
  assert.equal(drop.item.id, dropId(0, 0));
  assert.ok(me.guns.some((g) => g?.w === 'sniper'));
  run(m, 1);
  assert.ok(m.loot.has(drop.item.id), 'and stays down: no grabbing it straight back');
  // caps
  me.ammo.light = ammoCap('light', 0);
  put(9, { kind: 'ammo', a: 'light', n: 30 });
  run(m, 0.1);
  assert.ok(m.loot.has(9), 'a full pouch leaves the box');
  assert.equal(AMMO_BOX.light, 30);
});

test('healing and shields take time, stop at their caps, and firing cuts them short', () => {
  const m = quiet();
  const me = m.fighters[0];
  const spot = openSpot(m);
  land(me, spot.x, spot.z);
  me.hp = 40;
  me.items.bandage = 3;
  me.items.shield = 1;
  me.input.use = 'bandage';
  run(m, USES.bandage.time - 0.1);
  assert.equal(me.hp, 40, 'not yet');
  run(m, 0.2);
  assert.equal(me.hp, 40 + USES.bandage.hp!);
  assert.equal(me.items.bandage, 2);
  me.input.use = 'bandage';
  run(m, 0.5);
  me.input.fire = true;
  run(m, 0.05);
  me.input.fire = false;
  run(m, USES.bandage.time);
  assert.equal(me.hp, 40 + USES.bandage.hp!, 'the swing broke it off');
  assert.equal(me.items.bandage, 2);
  // a bandage only goes so far
  me.hp = 70;
  me.input.use = 'bandage';
  run(m, USES.bandage.time + 0.1);
  assert.equal(me.hp, USES.bandage.hpCap);
  me.input.use = 'bandage';
  run(m, 0.1);
  assert.equal(me.using, null, 'no bandaging past its cap');
  me.input.use = 'shield';
  run(m, USES.shield.time + 0.1);
  assert.equal(me.shield, USES.shield.shield);
  // the heal and shield keys pick the right thing
  me.items.medkit = 1;
  me.items.mini = 2;
  me.hp = 30;
  assert.equal(bestUse(me, 'heal'), 'medkit', 'badly hurt: the medkit');
  me.hp = 65;
  assert.equal(bestUse(me, 'heal'), 'bandage');
  me.hp = 90;
  assert.equal(bestUse(me, 'heal'), 'medkit', 'past what a bandage does');
  me.shield = 30;
  assert.equal(bestUse(me, 'shield'), 'mini');
  me.shield = 60;
  assert.equal(bestUse(me, 'shield'), null, 'minis stop at 50 and the potion is gone');
  me.hp = 30;
  me.input.use = 'bestHeal';
  run(m, USES.medkit.time + 0.1);
  assert.equal(me.hp, 100);
  assert.equal(me.items.medkit, 0);
});

test('coffee heals a little at a time and puts a spring in your step', () => {
  const m = quiet();
  const me = m.fighters[0];
  const spot = openSpot(m);
  land(me, spot.x, spot.z);
  me.hp = 50;
  me.items.coffee = 1;
  me.input.use = 'coffee';
  run(m, USES.coffee.time + 0.05);
  assert.ok(me.boost > USES.coffee.boost! - 1);
  const hp = me.hp;
  run(m, 4);
  assert.ok(me.hp > hp + 4 && me.hp < hp + 6, `healed over time: ${me.hp - hp}`);
  me.input.mx = 1;
  run(m, 1, () => (me.input.mx = 1));
  assert.ok(Math.abs(Math.hypot(me.vx, me.vz) - SPEED * MELEE.spatula.move * BOOST.speed) < 0.05, 'quicker on its feet');
  run(m, 30, () => (me.input.mx = 0));
  assert.equal(me.boost, 0, 'it wears off');
});

test('a cracked egg spills what it carried, its killer is credited, and the last egg wins', () => {
  const m = quiet(3, 3);
  const [a, b, c] = m.fighters;
  const spot = openSpot(m);
  land(a, spot.x, spot.z);
  land(b, spot.x, spot.z + 5);
  land(c, spot.x + 30, spot.z);
  b.guns[0] = { w: 'shotgun', r: 3, mag: 2 };
  b.ammo.shells = 20;
  b.items.bandage = 3;
  b.melee = 'cleaver';
  b.throws.grenade = 2;
  b.scope = 2;
  b.wood = 40;
  b.hp = 10;
  a.guns[0] = { w: 'pistol', r: 0, mag: 14 };
  a.slot = 0;
  a.input.aim = 0;
  a.input.fire = true;
  const evs = run(m, 0.3);
  a.input.fire = false;
  const out = evs.find((e) => e.t === 'out');
  assert.ok(out && out.t === 'out' && out.f === b.id && out.by === a.id && out.w === 'pistol');
  assert.equal(out.place, 3);
  assert.equal(a.kills, 1);
  const spilled = evs.filter((e) => e.t === 'drop').map((e) => (e.t === 'drop' ? e.item.def.kind : ''));
  assert.deepEqual(spilled.sort(), ['ammo', 'gun', 'melee', 'scope', 'throw', 'use', 'wood']);
  assert.equal(b.melee, 'spatula');
  assert.equal(aliveCount(m), 2);
  hurt(m, c, 500, a.id, 'pistol', false);
  const end = run(m, 0.05).find((e) => e.t === 'end');
  assert.ok(end && end.t === 'end' && end.winner === a.id);
  assert.ok(m.ended);
  assert.equal(a.place, 1);
  assert.equal(c.place, 2);
  assert.equal(scoreOf(a, true), Math.round(a.dealt) + 200 + 500);
});

test('the storm wears down whoever is outside it, and only them', () => {
  const m = quiet(4, 3);
  const [a, b] = m.fighters;
  m.time = m.map.storm.starts[1] + 1;
  run(m, DT);
  const s = m.storm;
  land(a, s.x, s.z);
  const away = Math.max(-EDGE, Math.min(EDGE, s.x + (s.x > 0 ? -1 : 1) * (s.r + 15)));
  land(b, away, s.z);
  assert.ok(Math.hypot(b.x - s.x, b.z - s.z) > s.r);
  run(m, 2);
  assert.equal(a.hp, 100);
  assert.ok(Math.abs(b.hp - (100 - 4 * STORM_TICK * s.dps)) < 1e-6, `${b.hp}`);
});

test('computer eggs play whole matches to the end at every level, and never leave the island', () => {
  for (const level of LEVELS) {
    for (const seed of [1, 2, 3]) {
      const names = botNames(seed);
      const entrants: Entrant[] = names.slice(0, MAX_FIGHTERS).map((name) => ({ name, color: '#fff', kind: 'bot', seat: -1 }));
      const m = createMatch({ seed, role: 'solo', level, entrants, me: -1 });
      let shots = 0;
      const outs: number[] = [];
      while (!m.ended && m.time < stormEnd(m.map.storm) + 30) {
        step(m, 1 / 30);
        for (const e of m.events.splice(0)) {
          if (e.t === 'shot') shots++;
          if (e.t === 'out') outs.push(e.f);
        }
        for (const f of m.fighters) if (f.phase === 'ground' || f.phase === 'drop') assert.ok(Math.abs(f.x) <= EDGE + 1e-9 && Math.abs(f.z) <= EDGE + 1e-9, 'on the island');
      }
      assert.ok(m.ended, `${level} seed ${seed} ended`);
      assert.equal(new Set(outs).size, outs.length, 'nobody cracks twice');
      assert.ok(outs.length >= MAX_FIGHTERS - 2, 'everyone but the winner (or all) went out');
      assert.ok(shots > 20, `${level} seed ${seed}: they fought (${shots} shots)`);
      const places = m.fighters.map((f) => f.place).sort((a, b) => a - b);
      if (m.winner >= 0) assert.deepEqual(places, Array.from({ length: MAX_FIGHTERS }, (_, i) => i + 1), 'one of each place');
    }
  }
});

test('eggs from another client glide between the reports that arrive for them', () => {
  const m = createMatch({ seed: 1, role: 'guest', level: 'normal', entrants: [{ name: 'a', color: '#fff', kind: 'player', seat: 1 }, { name: 'b', color: '#fff', kind: 'remote', seat: 0 }], me: 0, countdown: 0 });
  const r = m.fighters[1];
  const at = (x: number) => ({ x, z: 0, y: 0, aim: 0, vx: 6, vz: 0, phase: 'ground' as const, hp: 90, shield: 20, w: 'smg' as const, r: 1, flags: 0 });
  applyState(m, r, at(0));
  run(m, 0.1);
  applyState(m, r, at(1));
  run(m, INTERP / 2);
  assert.ok(r.x > 0 && r.x < 1, `between reports: ${r.x}`);
  assert.equal(r.hp, 90);
  assert.equal(r.show.w, 'smg');
  run(m, 1);
  assert.ok(r.x <= 1 + 6 * 0.25 + 1e-9, 'carries on a moment, then waits');
});

// ---------------------------------------------------------------------------------------------------------------------
// The network.

test('packets survive the trip and anything malformed is turned away', () => {
  const m = quiet();
  const f = m.fighters[0];
  land(f, 12.345, -6.789);
  f.guns[0] = { w: 'rifle', r: 3, mag: 20 };
  f.slot = 0;
  f.shield = 33.33;
  const s = stateOf(f);
  const back = parsePacket(JSON.parse(JSON.stringify(guestState(4, s))));
  assert.deepEqual(back, { k: 's', round: 4, state: s });
  const host = parsePacket(JSON.parse(JSON.stringify(hostState(4, 99, -2.5, 'hard', [0, 1, -1], [[0, s], [2, s]]))));
  assert.deepEqual(host, { k: 'S', round: 4, seed: 99, time: -2.5, level: 'hard', roster: [0, 1, -1], states: [[0, s], [2, s]] });
  assert.deepEqual(parsePacket(endOf(4, 2, [[2, 1, 3], [0, 2, 1]])), { k: 'end', round: 4, winner: 2, places: [[2, 1, 3], [0, 2, 1]] });
  assert.deepEqual(parsePacket(configOf(4, 'none', 'easy')), { k: 'cfg', round: 4, bots: 'none', level: 'easy' });
  for (const bad of [null, 1, 'x', {}, { t: 'pk', r: 1.5, k: 's', c: [] }, { t: 'pk', r: 1, k: 's', c: [1, 2] }, { t: 'pk', r: 1, k: 'S', sd: 1, tm: 0, lv: 'brutal', ro: [0], c: [] }, { t: 'pk', r: 1, k: 'S', sd: 1, tm: 0, lv: 'easy', ro: [0, 0], c: [] }, { t: 'pk', r: 1, k: 'end', w: MAX_FIGHTERS, pl: [] }, { t: 'pk', r: 1, k: 'cfg', b: 'lots', lv: 'easy' }])
    assert.equal(parsePacket(bad), null, JSON.stringify(bad));
  // states out of any sane range
  const wild = guestState(1, { ...s, hp: 500 });
  assert.equal(parsePacket(wild), null);
  // bad events drop out one by one, good ones stay
  const e = parsePacket({ t: 'pk', r: 1, k: 'e', g: [[1, [{ y: 'd', f: 1, to: 0, d: 20, w: 'smg', x: 0, z: 0 }, { y: 'd', f: 1, to: 0, d: 9999, w: 'smg', x: 0, z: 0 }, { y: 'dr', id: 5, x: 0, z: 0, by: 1, it: { kind: 'gun', w: 'bazooka', r: 1 } }, { y: 'zz' }]]] });
  assert.ok(e && e.k === 'e');
  assert.equal(e.groups[0][1].length, 1);
});

test('what happens here becomes network news only when someone else needs it', () => {
  assert.equal(toNet({ t: 'hit', f: 0, to: 1, d: 5, w: 'smg', x: 0, z: 0, shield: false, local: true }), null, 'a hit on an egg we own is already applied');
  assert.deepEqual(toNet({ t: 'hit', f: 0, to: 1, d: 5, w: 'smg', x: 1, z: 2, shield: false, local: false }), { y: 'd', f: 0, to: 1, d: 5, w: 'smg', x: 1, z: 2 });
  assert.equal(toNet({ t: 'out', f: 1, by: 0, w: 'smg', place: 3, net: true }), null, 'news from the network is not sent back');
  assert.equal(toNet({ t: 'beep' }), null);
  assert.equal(toNet({ t: 'thud', x: 0, z: 0, what: 'tree' }), null);
});

test('the host hands each pickup to the first to ask', () => {
  const h = createMatch({ seed: 2, role: 'host', level: 'normal', entrants: [{ name: 'h', color: '#fff', kind: 'player', seat: 0 }, { name: 'a', color: '#fff', kind: 'remote', seat: 1 }, { name: 'b', color: '#fff', kind: 'remote', seat: 2 }], me: 0, countdown: 0 });
  h.fighters[1].phase = 'ground';
  h.fighters[2].phase = 'ground';
  const id = [...h.loot.keys()][0];
  assert.equal(applyNet(h, { y: 'tk', f: 1, id }), false, 'the request itself goes no further');
  applyNet(h, { y: 'tk', f: 2, id });
  const took = h.events.filter((e) => e.t === 'took');
  assert.equal(took.length, 1);
  assert.ok(took[0].t === 'took' && took[0].f === 1 && !took[0].net, 'the first asker, announced by the host');
  assert.ok(!h.loot.has(id));

  // the guest who got it puts it in its pockets; another guest just sees it go
  const g = createMatch({ seed: 2, role: 'guest', level: 'normal', entrants: [{ name: 'h', color: '#fff', kind: 'remote', seat: 0 }, { name: 'a', color: '#fff', kind: 'player', seat: 1 }], me: 1, countdown: 0 });
  g.fighters[1].phase = 'ground';
  const t = took[0];
  assert.ok(t.t === 'took');
  applyNet(g, { y: 'tko', f: t.f, id: t.id, it: t.def });
  assert.ok(!g.loot.has(id));
  applyNet(g, { y: 'tk', f: 1, id: 12345 });
  assert.equal(g.events.filter((e) => e.t === 'took' && !e.net).length, 0, 'guests hand nothing out');
});

test('damage from the network lands only on eggs owned here', () => {
  const g = createMatch({ seed: 2, role: 'guest', level: 'normal', entrants: [{ name: 'h', color: '#fff', kind: 'remote', seat: 0 }, { name: 'a', color: '#fff', kind: 'player', seat: 1 }], me: 1, countdown: 0 });
  for (const f of g.fighters) f.phase = 'ground';
  applyNet(g, { y: 'd', f: 1, to: 0, d: 30, w: 'smg', x: 0, z: 0 });
  assert.equal(g.fighters[0].hp, 100, "not ours to hurt");
  applyNet(g, { y: 'd', f: 0, to: 1, d: 30, w: 'smg', x: 0, z: 0 });
  assert.equal(g.fighters[1].hp, 70);
  // a shot from someone else's gun flies here but never hurts anyone here
  applyNet(g, { y: 's', f: 0, w: 'rifle', r: 0, x: g.fighters[0].x, z: g.fighters[0].z, a: 0, s: 1, k: 1 });
  assert.ok(g.bullets.length === 1 && !g.bullets[0].local);
});

test('events pack into packets well under the room limit, in order', () => {
  const queue: [number, NetEv][] = [];
  for (let i = 0; i < 500; i++) queue.push([i % 3, i % 2 ? { y: 's', f: i % 8, w: 'smg', r: 2, x: 12.34, z: -56.78, a: 1.23, s: 123456789 + i, k: 1.6 } : { y: 'dr', id: 1_234_567 + i, x: 1.5, z: 2.5, by: 3, it: { kind: 'gun', w: 'sniper', r: 4, mag: 3 } }]);
  const packets = packEvents(9, queue);
  assert.ok(packets.length > 3);
  const back: [number, NetEv][] = [];
  for (const p of packets) {
    const text = JSON.stringify({ t: 'msg', to: 1, d: p });
    assert.ok(new TextEncoder().encode(text).byteLength < 7000, `packet of ${text.length} bytes`);
    const parsed = parsePacket(JSON.parse(text).d);
    assert.ok(parsed && parsed.k === 'e');
    for (const [origin, evs] of parsed.groups) for (const ev of evs) back.push([origin, ev]);
  }
  assert.deepEqual(back, queue);
});

// ---------------------------------------------------------------------------------------------------------------------
// A whole room, simulated: the host and its guests passing real packets through a pretend network, with delay and
// a share of the fast packets lost.

type Client = { seat: number; me: Me; s: Session; m: Match | null; inbox: { at: number; from: number; d: unknown }[]; gone: boolean; call: 'report' | 'quiet' | null; hurtBy: number; heard: number };

function simulate(opts: { humans: number; bots: boolean; seed: number; level: Level; delay: number; loss: number; leave?: { seat: number; at: number }; stall?: { seat: number; at: number; silent: boolean } }) {
  const players: Player[] = Array.from({ length: opts.humans }, (_, seat) => ({ seat, name: `P${seat + 1}` }));
  const rng = rng32(opts.seed * 7 + 1);
  const host = hostMatch(players, 0, opts.seed, opts.level, opts.bots ? MAX_FIGHTERS : 0, COUNTDOWN + 1.2);
  const clients: Client[] = players.map((p) => ({ seat: p.seat, me: { seat: p.seat, isHost: p.seat === 0, round: 1 }, s: newSession(p.seat === 0, p.seat === 0 ? host.roster : []), m: p.seat === 0 ? host.match : null, inbox: [], gone: false, call: null, hurtBy: 0, heard: 0 }));
  autopilot(host.match, host.match.fighters[host.match.me]);
  let now = 0;
  const post = (from: Client, d: object, fast: boolean) => {
    const to = from.me.isHost ? clients.filter((c) => c !== from && !c.gone) : [clients[0]];
    for (const c of to) {
      if (fast && rng() < opts.loss) continue;
      c.inbox.push({ at: now + opts.delay, from: from.seat, d: JSON.parse(JSON.stringify(d)) });
    }
  };
  const join = (c: Client) => (seed: number, level: Level, time: number, roster: number[]) => {
    const m = guestMatch(players, c.seat, seed, level, time, roster);
    autopilot(m, m.fighters[m.me]);
    return m;
  };
  let tickAt = 0;
  const limit = stormEnd(host.match.map.storm) + 40;
  while (now < limit + 10) {
    now += DT;
    if (opts.leave && !clients[opts.leave.seat].gone && now > opts.leave.at) clients[opts.leave.seat].gone = true;
    const live = clients.filter((c) => !c.gone);
    // a stalled client is still in the room but its game has stopped (a frozen tab); a silent one sends nothing either
    const stalled = (c: Client) => !!opts.stall && opts.stall.seat === c.seat && now > opts.stall.at;
    for (const c of live) {
      if (stalled(c)) continue;
      while (c.inbox.length && c.inbox[0].at <= now) {
        const msg = c.inbox.shift()!;
        c.m = receive(c.s, c.m ?? createMatch({ seed: 1, role: 'guest', level: 'normal', entrants: [], me: -1 }), c.me, msg.from, msg.d, join(c), now);
      }
      if (!c.s.synced || !c.m) continue;
      step(c.m, DT);
      for (const e of c.m.events.splice(0)) {
        if (e.t === 'hurt' && e.f === c.m.me && e.by >= 0 && e.by !== c.m.me) c.hurtBy++;
        if (e.t === 'shot' && e.net) c.heard++;
        share(c.s, e, c.seat);
      }
      for (const p of flush(c.s, 1, DT)) post(c, p, false);
      c.call ??= ending(c.s, c.m, c.me, now);
    }
    if (now >= tickAt) {
      tickAt += TICK_MS / 1000;
      for (const c of live) if (c.m && !(stalled(c) && opts.stall!.silent)) for (const out of tick(c.s, c.m, c.me, live.map((x) => x.seat), now)) post(c, out.d, out.fast);
    }
    if (live.every((c) => c.call || stalled(c))) break;
  }
  // let everything in flight land
  for (let i = 0; i < 40; i++) {
    now += DT;
    for (const c of clients.filter((x) => !x.gone && !(opts.stall && opts.stall.seat === x.seat))) {
      while (c.inbox.length && c.inbox[0].at <= now) {
        const msg = c.inbox.shift()!;
        c.m = receive(c.s, c.m!, c.me, msg.from, msg.d, join(c), now);
      }
      for (const e of c.m!.events.splice(0)) share(c.s, e, c.seat);
      for (const p of flush(c.s, 1, FLUSH)) post(c, p, false);
    }
  }
  return clients;
}

for (const [label, opts] of [
  ['a host, three guests and four computer eggs, with lag and lost packets', { humans: 4, bots: true, seed: 21, level: 'hard' as Level, delay: 0.08, loss: 0.15 }],
  ['eight people and no computer eggs, one of whom leaves halfway', { humans: 8, bots: false, seed: 34, level: 'normal' as Level, delay: 0.05, loss: 0.05, leave: { seat: 5, at: 40 } }],
  ['a guest whose tab freezes on the bus (still in the room, still reporting)', { humans: 3, bots: true, seed: 8, level: 'normal' as Level, delay: 0.05, loss: 0.05, stall: { seat: 2, at: 2, silent: false } }],
  ['a guest who goes silent mid-match', { humans: 3, bots: true, seed: 13, level: 'normal' as Level, delay: 0.05, loss: 0.05, stall: { seat: 1, at: 30, silent: true } }],
] as const) {
  test(`online: ${label}, all agree on what happened`, () => {
    const clients = simulate(opts);
    const live = clients.filter((c) => !c.gone && !('stall' in opts && opts.stall.seat === c.seat));
    for (const c of live) {
      assert.ok(c.s.synced && c.m, `seat ${c.seat} synced`);
      assert.equal(c.call, 'report', `seat ${c.seat} heard the host call it`);
    }
    const host = live[0].m!;
    assert.ok(host.ended);
    const ends = live.map((c) => JSON.stringify(c.s.end));
    assert.ok(ends.every((e) => e === ends[0]), 'one result for everyone');
    const total = opts.bots ? MAX_FIGHTERS : opts.humans;
    const places = live[0].s.end!.places.map(([, place]) => place).sort((a, b) => a - b);
    if (live[0].s.end!.winner >= 0) assert.deepEqual(places, Array.from({ length: total }, (_, i) => i + 1));
    assert.deepEqual(live[0].s.end!.places, placesOf(host));
    for (const c of live) {
      const m = c.m!;
      assert.equal(m.fighters.length, total);
      assert.equal(m.seed, host.seed);
      assert.deepEqual(m.fighters.map((f) => f.name), host.fighters.map((f) => f.name));
      assert.deepEqual(m.fighters.map((f) => f.phase === 'out'), host.fighters.map((f) => f.phase === 'out'), `seat ${c.seat}: the same eggs are out`);
      assert.deepEqual([...m.loot.keys()].sort((a, b) => a - b), [...host.loot.keys()].sort((a, b) => a - b), `seat ${c.seat}: the same loot on the ground`);
      assert.deepEqual(m.opened, host.opened, `seat ${c.seat}: the same chests and crates open`);
      assert.deepEqual([...m.walls.keys()].sort(), [...host.walls.keys()].sort(), `seat ${c.seat}: the same walls standing`);
    }
    if (!('stall' in opts)) assert.ok(live.slice(1).some((c) => c.hurtBy > 0), 'guests took hits decided on other clients');
    assert.ok(host.time > 25, `a real match (${host.time.toFixed(0)} s)`);
    if (!('stall' in opts)) for (const c of live) assert.ok(c.heard > 10, `seat ${c.seat} heard ${c.heard} shots from other clients`);
    const gone = 'leave' in opts ? opts.leave.seat : 'stall' in opts ? opts.stall.seat : -1;
    if (gone >= 0) {
      const egg = host.fighters.find((f) => f.seat === gone)!;
      assert.equal(egg.phase, 'out', 'the host took out the egg of someone who stopped playing');
      assert.equal(egg.outCause, 'left');
      assert.notEqual(live[0].s.end!.winner, egg.id);
    }
  });
}

test('a pickup the host turned down shows up in the prompt again a moment later', () => {
  const g = createMatch({ seed: 2, role: 'guest', level: 'normal', entrants: [{ name: 'g', color: '#fff', kind: 'player', seat: 1 }], me: 0, countdown: 0 });
  g.time = 5;
  const me = g.fighters[0];
  openSpot(g);
  land(me, 0, 0);
  me.guns = [{ w: 'pistol', r: 0, mag: 14 }, { w: 'smg', r: 0, mag: 30 }];
  g.loot.set(77, { id: 77, def: { kind: 'gun', w: 'rifle', r: 3 }, x: 1.4, z: 0, by: -1, at: 0 });
  me.input.interact = true;
  const evs = run(g, 0.05);
  assert.ok(evs.some((e) => e.t === 'take' && e.id === 77));
  assert.equal(prompt(g, me), null, 'asked: waiting for the host');
  run(g, 1.1);
  const p = prompt(g, me);
  assert.ok(p && 'item' in p && p.item.id === 77 && p.swap, 'no answer came, so it is offered again');
});

test('the host\'s result is final: an elimination that arrives after it changes nothing', () => {
  const g = createMatch({ seed: 2, role: 'guest', level: 'normal', entrants: [{ name: 'a', color: '#fff', kind: 'remote', seat: 0 }, { name: 'b', color: '#fff', kind: 'player', seat: 1 }, { name: 'c', color: '#fff', kind: 'remote', seat: 2 }], me: 1, countdown: 0 });
  for (const f of g.fighters) f.phase = 'ground';
  applyNet(g, { y: 'o', f: 2, by: 1, w: 'smg' });
  assert.equal(g.fighters[1].kills, 1);
  // the result says b won with one elimination and c went out; then the news of a's crack (by b) shows up late
  receive(newSession(true), g, { seat: 1, isHost: false, round: 1 }, 0, endOf(1, 1, [[1, 1, 2], [0, 2, 0], [2, 3, 0]]), () => g, 0);
  assert.equal(g.fighters[0].phase, 'out', 'everyone the result places below the winner is out');
  assert.equal(g.fighters[1].kills, 2);
  applyNet(g, { y: 'o', f: 0, by: 1, w: 'smg' });
  assert.equal(g.fighters[1].kills, 2, 'not counted twice');
  assert.equal(g.fighters[0].place, 2);
});

test('the host adds as many computer eggs as it asks for, twenty eggs at most', () => {
  const two = [{ seat: 0, name: 'h' }, { seat: 1, name: 'g' }];
  assert.deepEqual(hostMatch(two, 0, 5, 'normal', 3, 0).roster, [0, 1, -1, -1, -1]);
  assert.deepEqual(hostMatch(two, 0, 5, 'normal', 0, 0).roster, [0, 1]);
  const five = [0, 1, 2, 3, 4].map((seat) => ({ seat, name: `p${seat}` }));
  assert.deepEqual(hostMatch(five, 0, 5, 'normal', 3, 0).roster, [0, 1, 2, 3, 4, -1, -1, -1], 'just the room\'s bots');
  // Fill to 20 asks for as many as there are places
  const full = hostMatch(five, 0, 5, 'normal', MAX_FIGHTERS, 0);
  assert.equal(full.match.fighters.length, MAX_FIGHTERS, 'bots fill the places left, no more');
  assert.deepEqual(full.roster, [0, 1, 2, 3, 4, ...Array(MAX_FIGHTERS - 5).fill(-1)]);
  assert.ok(full.match.fighters.slice(5).every((f) => f.kind === 'bot'));
  assert.equal(new Set(full.match.fighters.map((f) => f.color)).size, MAX_FIGHTERS, 'every egg its own color');
  assert.equal(new Set(full.match.fighters.map((f) => f.name)).size, MAX_FIGHTERS, 'and its own name');
});

test('the host sends what happened last before it sends the result', () => {
  const host = hostMatch([{ seat: 0, name: 'h' }, { seat: 1, name: 'g' }], 0, 3, 'normal', 0, 0);
  const s = newSession(true, host.roster);
  s.queue.push([0, { y: 'o', f: 1, by: 0, w: 'smg' }]);
  s.end = { winner: 0, places: [[0, 1, 1], [1, 2, 0]] };
  s.endAt = 0;
  const out = tick(s, host.match, { seat: 0, isHost: true, round: 1 }, [0, 1], 0).map((o) => parsePacket(o.d)!.k);
  assert.deepEqual(out, ['S', 'e', 'end']);
  assert.equal(s.queue.length, 0);
});

test('someone who leaves stays out, even if a newcomer takes their seat before the bus goes', () => {
  const players = [0, 1, 2].map((seat) => ({ seat, name: `p${seat}` }));
  const host = hostMatch(players, 0, 4, 'normal', 5, 4.2);
  const s = newSession(true, host.roster);
  const me: Me = { seat: 0, isHost: true, round: 1 };
  tick(s, host.match, me, [0, 1, 2], 0);
  tick(s, host.match, me, [0, 1], 0.1);
  assert.equal(host.match.fighters[2].phase, 'out', 'out as soon as they go, countdown or not');
  tick(s, host.match, me, [0, 1, 2], 0.2);
  assert.equal(host.match.fighters[2].phase, 'out');
  assert.equal(host.match.fighters[2].outCause, 'left');
});

test('a guest slow to load gets a while to send its first report; one that reports and then goes quiet does not', () => {
  const players = [0, 1, 2].map((seat) => ({ seat, name: `p${seat}` }));
  const host = hostMatch(players, 0, 4, 'normal', MAX_FIGHTERS, 4.2);
  const s = newSession(true, host.roster);
  const me: Me = { seat: 0, isHost: true, round: 1 };
  const present = [0, 1, 2];
  tick(s, host.match, me, present, 100);
  // seat 1 reports straight away, then stops; seat 2 is still building the island
  const state = guestState(1, stateOf(host.match.fighters[1]));
  receive(s, host.match, me, 1, JSON.parse(JSON.stringify(state)), () => host.match, 100.1);
  tick(s, host.match, me, present, 100 + STALE + 1);
  assert.equal(host.match.fighters[1].phase, 'out', 'quiet for longer than STALE after reporting');
  assert.notEqual(host.match.fighters[2].phase, 'out', 'still loading: not counted out yet');
  tick(s, host.match, me, present, 100 + STALE + FIRST_GRACE + 1);
  assert.equal(host.match.fighters[2].phase, 'out', 'but not forever');
});

/**
 * A host and one guest on bare grass a few seconds in: the host's egg 8 m east of the guest's. `toHost` and
 * `toGuest` pass on whatever has happened on that side since, through the room.
 */
function pair() {
  const players: Player[] = [{ seat: 0, name: 'h' }, { seat: 1, name: 'g' }];
  const host = hostMatch(players, 0, 4, 'normal', 0, 0);
  const h = host.match;
  const g = guestMatch(players, 1, 4, 'normal', 0, host.roster);
  const hs = newSession(true, host.roster);
  const gs = newSession(true, host.roster);
  const hMe: Me = { seat: 0, isHost: true, round: 1 };
  const gMe: Me = { seat: 1, isHost: false, round: 1 };
  for (const m of [h, g]) {
    m.time = 5;
    openSpot(m);
    land(m.fighters[0], 8, 0);
    land(m.fighters[1], 0, 0);
  }
  const send = (s: Session, m: Match, seat: number) => {
    for (const e of m.events.splice(0)) share(s, e, seat);
    return flush(s, 1, FLUSH).map((p) => JSON.parse(JSON.stringify(p)));
  };
  const toHost = (clock = 0) => send(gs, g, 1).forEach((p) => receive(hs, h, hMe, 1, p, () => h, clock));
  const toGuest = (clock = 0) => send(hs, h, 0).forEach((p) => receive(gs, g, gMe, 0, p, () => g, clock));
  return { h, g, hs, gs, hMe, gMe, toHost, toGuest };
}

/** Puts a gun in an egg's hand, aimed east, trigger held. */
function aimEast(f: Fighter, w: 'rifle' | 'crossbow') {
  f.guns[0] = { w, r: 0, mag: WEAPONS[w].mag };
  f.slot = 0;
  f.fireT = 0;
  f.reloadT = 0;
  f.input.aim = Math.PI / 2;
  f.input.fire = true;
}

test('a guest the host takes out for going quiet hears it is out, and nothing it sent after that counts', () => {
  const { h, g, hs, gs, hMe, gMe, toHost, toGuest } = pair();
  const mine = g.fighters[1];
  tick(hs, h, hMe, [0, 1], 0);
  receive(hs, h, hMe, 1, JSON.parse(JSON.stringify(guestState(1, stateOf(mine)))), () => h, 0.1);
  // the guest's phone locks for longer than STALE; when it wakes it fires before the news reaches it
  tick(hs, h, hMe, [0, 1], STALE + 1);
  assert.equal(h.fighters[1].outCause, 'left');
  aimEast(mine, 'rifle');
  for (let i = 0; i < 30 && !g.events.some((e) => e.t === 'hit'); i++) step(g, DT);
  assert.ok(g.events.some((e) => e.t === 'hit' && e.to === 0), 'it hit the host on its own screen');
  toHost(STALE + 2);
  assert.equal(h.fighters[0].hp, 100, 'but not on the host');
  assert.equal(hs.queue.length, 0, 'and nobody else hears of it');
  toGuest(STALE + 2);
  assert.equal(mine.phase, 'out', 'the host told it it is out');
  assert.equal(mine.outCause, 'left');
  for (const e of g.events.splice(0)) share(gs, e, 1);
  assert.equal(gs.queue.length, 0, 'news it does not send back');
  // it still hears the result like everyone else
  step(h, DT);
  ending(hs, h, hMe, STALE + 3);
  for (const out of tick(hs, h, hMe, [0, 1], STALE + 3)) receive(gs, g, gMe, 0, JSON.parse(JSON.stringify(out.d)), () => g, STALE + 3);
  assert.equal(ending(gs, g, gMe, STALE + 3 + END_PAUSE + 0.1), 'report');
  assert.equal(gs.end?.winner, 0);
  assert.equal(mine.place, 2);

  // an egg that cracked the ordinary way still lands the shot it fired just before
  const b = pair();
  aimEast(b.g.fighters[1], 'rifle');
  step(b.g, DT);
  b.g.fighters[1].input.fire = false;
  hurt(b.g, b.g.fighters[1], 500, 0, 'smg', false);
  for (let i = 0; i < 30 && !b.g.events.some((e) => e.t === 'hit'); i++) step(b.g, DT);
  b.toHost();
  assert.equal(b.h.fighters[1].phase, 'out');
  assert.ok(b.h.fighters[0].hp < 100, 'the bullet in flight still counts');
});

test('a pickup the host hands to a guest whose egg has just cracked goes back on the ground for everyone', () => {
  const { h, g, toHost, toGuest } = pair();
  const mine = g.fighters[1];
  for (const m of [h, g]) m.loot.set(5, { id: 5, def: { kind: 'gun', w: 'sniper', r: 4 }, x: 0, z: 0.5, by: -1, at: 0 });
  step(g, DT);
  assert.ok(g.events.some((e) => e.t === 'take' && e.id === 5));
  // shot dead before the host's answer comes back; the host still sees it standing when the ask arrives
  hurt(g, mine, 500, 0, 'rifle', false);
  toHost();
  assert.ok(!h.loot.has(5), 'the host said yes');
  toGuest();
  toHost();
  const snipers = (m: Match) => [...m.loot.values()].filter((l) => l.def.kind === 'gun' && l.def.w === 'sniper').map((l) => l.id);
  assert.equal(snipers(h).length, 1, 'the sniper is on the ground again');
  assert.deepEqual(snipers(g), snipers(h));
  assert.deepEqual([...g.loot.keys()].sort(), [...h.loot.keys()].sort(), 'the same loot on both');
});

test('online, a crossbow shot keeps its shooter hidden on everyone else’s screen too', () => {
  const { h, g, toHost } = pair();
  const mine = g.fighters[1];
  const copy = h.fighters[1];
  // the host's copy of the guest stands in a bush
  copy.bush = 0;
  assert.ok(concealed(h, copy, h.fighters[0]));
  aimEast(mine, 'crossbow');
  step(g, DT);
  assert.ok(g.events.some((e) => e.t === 'shot' && e.w === 'crossbow'));
  toHost();
  assert.ok(h.bullets.length > 0, 'the bolt flies on the host');
  assert.ok(concealed(h, copy, h.fighters[0]), 'and the shooter stays hidden');
  aimEast(mine, 'rifle');
  step(g, DT);
  toHost();
  assert.ok(!concealed(h, copy, h.fighters[0]), 'a rifle gives it away');
});

test('a wall goes out with the health it was built with, whatever hits it the same frame', () => {
  const m = quiet();
  const [a, b] = m.fighters;
  openSpot(m);
  land(a, 0, 0);
  land(b, 0, 2);
  // b fires into the spot where a builds, in the same frame
  b.guns[0] = { w: 'sniper', r: 4, mag: 4 };
  b.slot = 0;
  b.input.aim = 0;
  b.input.fire = true;
  b.x = 0;
  b.z = -3;
  a.input.aim = Math.PI;
  a.input.build = true;
  const evs = run(m, DT);
  const built = evs.find((e) => e.t === 'wall');
  assert.ok(built && built.t === 'wall');
  assert.equal(built.wall.hp, WALL_HP);
  assert.equal(toNet(built)?.y === 'wl' && (toNet(built) as { hp: number }).hp, WALL_HP);
});

test('a computer egg never picks straight back up the gun it just swapped away', () => {
  const m = quiet();
  const me = m.fighters[0];
  openSpot(m);
  land(me, 0, 0);
  me.guns = [{ w: 'pistol', r: 0, mag: 14 }, { w: 'smg', r: 0, mag: 30 }];
  me.slot = 0;
  m.loot.set(50, { id: 50, def: { kind: 'gun', w: 'rifle', r: 2 }, x: 0.5, z: 0, by: -1, at: 0 });
  me.input.interact = true;
  const first = run(m, DT).filter((e) => e.t === 'drop').length;
  assert.equal(first, 1);
  for (let i = 0; i < 30; i++) me.input.interact = true, run(m, DT);
  assert.equal(m.loot.size, 1, 'the pistol stays on the ground');
  assert.equal(me.guns[0]!.w, 'rifle');
});

test('a computer egg sent for a gun takes that gun, not whatever lies nearer', () => {
  const m = quiet();
  const [a, b] = m.fighters;
  openSpot(m);
  land(a, 0, 0);
  land(b, 100, 100);
  autopilot(m, a);
  a.melee = 'pan';
  a.guns = [{ w: 'smg', r: 1, mag: 30 }, { w: 'rifle', r: 1, mag: 30 }];
  a.slot = 1;
  m.loot.set(1, { id: 1, def: { kind: 'gun', w: 'sniper', r: 4 }, x: 0, z: 5, by: -1, at: 0 });
  // a whisk on the way, in reach of the sniper
  m.loot.set(2, { id: 2, def: { kind: 'melee', w: 'whisk' }, x: 0, z: 3.6, by: -1, at: 0 });
  run(m, 5);
  assert.equal(a.melee, 'pan');
  assert.deepEqual(a.guns.map((g) => g?.w), ['sniper', 'rifle'], 'the sniper in place of the weaker SMG');
});

/** The first building of a kind (whose doorway passes `ok`), and that doorway. */
function doorOf(m: Match, kind: Building['kind'], ok: (d: Door) => boolean = () => true) {
  const i = m.map.buildings.findIndex((b) => b.kind === kind && ok(b.doors[0]));
  assert.ok(i >= 0, `a ${kind}`);
  return { b: m.map.buildings[i], i, door: m.map.buildings[i].doors[0] };
}
/** The spot `k` meters out through a doorway (in, for less than 0). */
const through = (d: Door, k: number) => ({ x: d.x + d.ox * k, z: d.z + d.oz * k });

test('a computer egg under fire builds a wall in the open, but never indoors', () => {
  const m = quiet(3);
  const [a, b] = m.fighters;
  autopilot(m, a);
  a.guns[0] = { w: 'rifle', r: 0, mag: 30 };
  a.ammo.heavy = 90;
  // inside a shipping container, with someone shooting in through its open end
  const c = doorOf(m, 'container', (d) => {
    const [p, q] = [through(d, -2), through(d, 10)];
    return clearLine(m, p.x, p.z, q.x, q.z) && coverAt(m.map, q.x, q.z) < 0;
  });
  land(a, through(c.door, -2).x, through(c.door, -2).z);
  land(b, through(c.door, 10).x, through(c.door, 10).z);
  const hot = (seconds: number) =>
    run(m, seconds, () => {
      a.hitT = 0.25;
      a.hp = 60;
      b.hp = 100;
    });
  assert.ok(!hot(2).some((e) => e.t === 'wall'), 'no wall shuts it in');
  assert.equal(a.ai!.target, b.id, 'it was fighting');
  assert.equal(buildingAt(m.map, a.x, a.z), c.i, 'still inside');
  openSpot(m);
  land(a, 0, 0);
  land(b, 0, 12);
  assert.ok(hot(2).some((e) => e.t === 'wall' && e.wall.f === a.id), 'out in the open it builds');
});

test('a computer egg walled into a shipping container breaks out, and leaves a shed by its doorway', () => {
  const m = quiet(3);
  const [a, b] = m.fighters;
  land(b, 0, 0);
  autopilot(m, a);
  const ai = a.ai!;
  // keep it set on a goal outside
  const goTo = (x: number, z: number) => {
    ai.think = 1e9;
    ai.goal = 'roam';
    ai.gx = x;
    ai.gz = z;
  };
  const c = doorOf(m, 'container');
  land(a, through(c.door, -2).x, through(c.door, -2).z);
  const id = 999;
  m.walls.set(id, makeWall(id, b.id, through(c.door, 0.4).x, through(c.door, 0.4).z, Math.atan2(c.door.ox, c.door.oz), WALL_HP));
  goTo(through(c.door, 6).x, through(c.door, 6).z);
  run(m, 8);
  assert.ok(!m.walls.has(id), 'the wall is down');
  assert.notEqual(buildingAt(m.map, a.x, a.z), c.i, 'and the egg is out');
  // a shed with the way it wants to go behind its back wall
  const s = doorOf(m, 'shed');
  const back = { x: s.b.x - s.door.ox * (s.b.w / 2 + 8), z: s.b.z - s.door.oz * (s.b.d / 2 + 8) };
  land(a, s.b.x - s.door.ox * 1.5, s.b.z - s.door.oz * 1.5);
  goTo(back.x, back.z);
  run(m, 15);
  assert.ok(Math.hypot(a.x - back.x, a.z - back.z) < 2.5, `got round to (${back.x}, ${back.z}), at (${a.x.toFixed(1)}, ${a.z.toFixed(1)})`);
});

// ---------------------------------------------------------------------------------------------------------------------
// The kitchen drawer: guns, melee, throwables, barrels, supply drops, scopes and backpacks.

test('a solo match is you and nineteen computer eggs, each with its own name and color', () => {
  const m = soloMatch(5, 'hard');
  assert.equal(m.fighters.length, 20);
  assert.equal(MAX_FIGHTERS, 20);
  assert.equal(new Set(m.fighters.map((f) => f.name)).size, 20);
  assert.equal(new Set(m.fighters.map((f) => f.color)).size, 20);
  assert.ok(m.fighters.slice(1).every((f) => f.kind === 'bot' && f.ai));
  assert.equal(new Set(FIGHTER_COLORS).size, FIGHTER_COLORS.length);
});

test('a burst rifle fires three shots a pull; a crossbow fires without giving away a bush', () => {
  const m = quiet();
  const [a, b] = m.fighters;
  openSpot(m);
  land(a, 0, 0);
  b.phase = 'out';
  a.guns[0] = { w: 'burst', r: 0, mag: 30 };
  a.slot = 0;
  a.input.aim = 0;
  a.input.fire = true;
  const first = run(m, 0.05);
  a.input.fire = false;
  const shots = [...first, ...run(m, 0.4)].filter((e) => e.t === 'shot');
  assert.equal(shots.length, 3);
  assert.equal(a.guns[0].mag, 27);
  // a crossbow bolt flies without the flash that gives a bush away
  a.guns[1] = { w: 'crossbow', r: 0, mag: 1 };
  a.slot = 1;
  a.fireT = 0;
  a.firedAt = -99;
  a.input.fire = true;
  const bolt = run(m, 0.05);
  a.input.fire = false;
  assert.ok(bolt.some((e) => e.t === 'shot' && e.w === 'crossbow'));
  assert.equal(a.firedAt, -99, 'still hidden');
  assert.ok(WEAPONS.crossbow.silent && !WEAPONS.rifle.silent);
});

test('melee: the spatula goes for anything better on its own, a swap after that takes the key, and each hits as hard as it says', () => {
  const m = quiet();
  const [a, b] = m.fighters;
  openSpot(m);
  land(a, 0, 0);
  land(b, 0, 1.7);
  m.loot.set(1, { id: 1, def: { kind: 'melee', w: 'cleaver' }, x: 0, z: 0, by: -1, at: 0 });
  const took = run(m, 0.05);
  assert.equal(a.melee, 'cleaver');
  assert.equal(took.filter((e) => e.t === 'drop').length, 0, 'the spatula is nobody else’s business');
  m.loot.set(2, { id: 2, def: { kind: 'melee', w: 'pan' }, x: a.x, z: a.z, by: -1, at: 0 });
  run(m, 0.1);
  assert.equal(a.melee, 'cleaver', 'no swapping by walking over it');
  const p = prompt(m, a);
  assert.ok(p && 'item' in p && p.swap);
  a.input.interact = true;
  const swapped = run(m, 0.05);
  assert.equal(a.melee, 'pan');
  assert.ok(swapped.some((e) => e.t === 'drop' && e.item.def.kind === 'melee' && e.item.def.w === 'cleaver'), 'the cleaver goes down');
  assert.equal(held(a).w, 'pan');
  a.fireT = 0;
  a.input.aim = 0;
  a.input.fire = true;
  run(m, 0.02);
  a.input.fire = false;
  assert.equal(b.hp, 100 - MELEE.pan.dmg);
});

test('a frying pan stops bullets from the front while held and from behind while slung, and never from the side', () => {
  const m = quiet();
  const [a, b] = m.fighters;
  openSpot(m);
  land(a, 0, 0);
  land(b, 0, 8);
  a.guns[0] = { w: 'pistol', r: 0, mag: 200 };
  a.slot = 0;
  a.input.aim = 0;
  b.melee = 'pan';
  const shot = (slot: number, aim: number) => {
    b.slot = slot;
    b.input.aim = aim;
    b.hp = 100;
    b.shield = 0;
    a.fireT = 0;
    a.input.fire = true;
    const evs = run(m, 0.15);
    a.input.fire = false;
    run(m, 0.2);
    return { hurt: b.hp < 100, clang: evs.some((e) => e.t === 'thud' && e.what === 'pan') };
  };
  b.guns[0] = { w: 'smg', r: 0, mag: 30 };
  // a's bullets fly toward +z; facing -z is facing a
  assert.deepEqual(shot(SLOT_MELEE, Math.PI), { hurt: false, clang: true }, 'held, facing the shooter');
  assert.deepEqual(shot(SLOT_MELEE, 0), { hurt: true, clang: false }, 'held, back turned');
  assert.deepEqual(shot(0, 0), { hurt: false, clang: true }, 'slung, back turned');
  assert.deepEqual(shot(0, Math.PI), { hurt: true, clang: false }, 'slung, facing the shooter');
  assert.deepEqual(shot(SLOT_MELEE, Math.PI / 2), { hurt: true, clang: false }, 'side on');
  // an egg on another client: what its owner reports
  const r = { ...b, kind: 'remote' as const, aim: Math.PI, show: { w: 'pan' as const, r: 0, flags: F_PAN } };
  assert.ok(panBlocks(r, 0, 1));
  assert.ok(!panBlocks({ ...r, show: { w: 'pan', r: 0, flags: 0 } }, 0, 1), 'no pan reported, no block');
});

test('a grenade lands where it is thrown or short of a wall, goes off on its fuse, and only the thrower’s client deals the damage', () => {
  const m = quiet();
  const [a, b] = m.fighters;
  openSpot(m);
  land(a, 0, 0);
  land(b, 0, 10);
  a.throws.grenade = 2;
  a.input.pick = 'grenade';
  run(m, 0.25);
  assert.equal(a.slot, SLOT_THROW);
  assert.equal(held(a).w, 'grenade');
  a.input.aim = 0;
  a.input.reach = 10;
  a.input.fire = true;
  const evs = run(m, 0.02);
  a.input.fire = false;
  const th = evs.find((e) => e.t === 'throw');
  assert.ok(th && th.t === 'throw' && Math.abs(th.lz - 10) < 0.05 && Math.abs(th.lx) < 0.05);
  assert.equal(a.throws.grenade, 1);
  run(m, THROWS.grenade.fuse! - 0.15);
  assert.equal(b.hp, 100, 'not yet');
  const bang = run(m, 0.3);
  assert.ok(bang.some((e) => e.t === 'boom'));
  assert.equal(b.hp, 100 - THROWS.grenade.dmg!, 'right on top of it');
  assert.equal(a.hp, 100);
  // a wall in the way stops it short
  m.walls.set(1, { id: 1, f: 0, x: 0, z: 5, a: 0, sa: 0, ca: 1, hw: 1.7, hd: 0.2, hp: 150 });
  a.fireT = 0;
  a.input.pick = 'grenade';
  a.input.fire = true;
  const short = run(m, 0.02).find((e) => e.t === 'throw');
  a.input.fire = false;
  assert.ok(short && short.t === 'throw' && short.lz < 4.5 && short.lz > 3.5, `${short && short.t === 'throw' && short.lz}`);
  // on another client the grenade flies and lands just the same, but hurts nobody there
  const g = createMatch({ seed: 7, role: 'guest', level: 'normal', entrants: [{ name: 'a', color: '#fff', kind: 'remote', seat: 0 }, { name: 'b', color: '#fff', kind: 'player', seat: 1 }], me: 1, countdown: 0 });
  g.time = 5;
  openSpot(g);
  land(g.fighters[0], 0, 0);
  land(g.fighters[1], 0, 10);
  assert.equal(applyNet(g, { y: 'th', f: 0, k: 'grenade', x: 0, z: 0, lx: 0, lz: 10, ft: 0.6 }), true);
  assert.equal(g.tosses.length, 1);
  run(g, 3);
  assert.equal(g.fighters[1].hp, 100);
  assert.equal(g.tosses.length, 0);
  assert.equal(applyNet(g, { y: 'th', f: 1, k: 'grenade', x: 0, z: 0, lx: 0, lz: 10, ft: 0.6 }), false, 'news about our own egg is ignored');
});

test('flour hides whoever is in it and blocks the view through it; hot sauce burns whoever stands in it; both wear off', () => {
  const m = quiet(7, 3);
  const [a, b, c] = m.fighters;
  openSpot(m);
  land(a, 0, 0);
  land(b, 0, 10);
  land(c, 0, 22);
  const toss = (k: 'flour' | 'sauce', reach: number) => {
    a.throws[k] = 1;
    a.input.pick = k;
    run(m, 0.25);
    a.fireT = 0;
    a.input.aim = 0;
    a.input.reach = reach;
    a.input.fire = true;
    run(m, 0.02);
    a.input.fire = false;
  };
  assert.ok(canSee(m, a, b, 60) && canSee(m, a, c, 60));
  toss('flour', 10);
  run(m, 1);
  assert.equal(m.zones.length, 1);
  assert.ok(concealed(m, b, a), 'in the cloud, hidden from outside');
  assert.ok(!canSee(m, a, b, 60) && !canSee(m, a, c, 60) && !canSee(m, b, a, 60), 'and nobody sees through it');
  run(m, THROWS.flour.time!);
  assert.equal(m.zones.length, 0);
  assert.ok(canSee(m, a, b, 60), 'it clears');
  toss('sauce', 10);
  run(m, 0.75);
  const before = b.hp;
  run(m, 2);
  assert.ok(Math.abs(before - b.hp - THROWS.sauce.dps! * 2) < 1e-6, `burned ${before - b.hp}`);
  assert.equal(b.lastBy, a.id, 'credited to whoever threw it');
  assert.equal(a.hp, 100);
  run(m, THROWS.sauce.time!);
  const after = b.hp;
  run(m, 1);
  assert.equal(b.hp, after, 'the puddle has burned out');
});

test('a barrel blows up when broken, hurting everyone near it and setting off the next; a guest only hurts its own eggs, on the host’s word', () => {
  const m = quiet(8, 3);
  const [a, b] = m.fighters;
  const barrels = m.map.containers.filter((c) => c.kind === 'barrel');
  const [one, two] = barrels;
  // stand the second barrel right next to the first
  two.x = one.x + 3;
  two.z = one.z;
  land(b, one.x + 2, one.z);
  land(a, Math.max(-EDGE, Math.min(EDGE, one.x - 40)), one.z);
  damageCrate(m, one.id, BARREL.hp - 1, a.id, true);
  assert.ok(!m.opened[one.id]);
  damageCrate(m, one.id, 1, a.id, true);
  const evs = m.events.splice(0);
  assert.ok(m.opened[one.id] && m.opened[two.id], 'both went up');
  assert.equal(evs.filter((e) => e.t === 'boom').length, 2);
  const out = evs.find((e) => e.t === 'out');
  assert.ok(out && out.t === 'out' && out.f === b.id && out.by === a.id && out.w === 'barrel', 'b was caught in both');
  assert.equal(a.hp, 100, 'well clear');

  const g = createMatch({ seed: 8, role: 'guest', level: 'normal', entrants: [{ name: 'a', color: '#fff', kind: 'remote', seat: 0 }, { name: 'b', color: '#fff', kind: 'player', seat: 1 }, { name: 'c', color: '#fff', kind: 'remote', seat: 2 }], me: 1, countdown: 0 });
  g.time = 5;
  const bar = g.map.containers.find((c) => c.kind === 'barrel')!;
  land(g.fighters[1], bar.x + 2, bar.z);
  land(g.fighters[2], bar.x - 2, bar.z);
  applyNet(g, { y: 'm', f: 0, k: 'crate', id: bar.id, d: 500 });
  assert.ok(!g.opened[bar.id], 'only the host breaks it');
  assert.equal(g.fighters[1].hp, 100);
  applyNet(g, { y: 'opd', c: bar.id, f: 0 });
  assert.ok(g.opened[bar.id]);
  assert.ok(g.fighters[1].hp < 100, 'our egg felt it');
  assert.equal(g.fighters[2].hp, 100, 'someone else’s egg is theirs to hurt');
  assert.ok(g.events.some((e) => e.t === 'boom' && e.net), 'everyone draws their own bang');
});

test('supply drops float down inside the next circle, open only once they land, and hold the good stuff', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const map = generateMap(seed);
    assert.equal(map.drops.length, 3);
    map.drops.forEach((id, k) => {
      const c = map.containers[id];
      const circle = map.storm.circles[k + 1];
      assert.equal(c.kind, 'supply');
      assert.ok(Math.hypot(c.x - circle.x, c.z - circle.z) <= circle.r * 0.75 + 4, `seed ${seed}: drop ${k} lands in the next circle`);
      assert.ok(c.at < map.storm.starts[k] && c.at - SUPPLY_FALL > 0, 'before the storm moves, after the match starts');
      assert.ok(Math.abs(c.x) < HALF - BEACH && Math.abs(c.z) < HALF - BEACH, 'on grass');
      assert.ok(c.loot.some((l) => l.def.kind === 'gun' && l.def.r >= 2));
    });
  }
  const m = quiet(6);
  const me = m.fighters[0];
  const c = m.map.containers[m.map.drops[0]];
  m.time = c.at - SUPPLY_FALL - 0.01;
  assert.ok(run(m, 0.05).some((e) => e.t === 'supply' && e.c === c.id), 'everyone hears it coming');
  land(me, c.x, c.z + 1.8);
  m.time = c.at - 1;
  assert.equal(prompt(m, me), null, 'still in the air');
  me.input.interact = true;
  run(m, 0.05);
  assert.ok(!m.opened[c.id]);
  m.time = c.at + 0.1;
  const p = prompt(m, me);
  assert.ok(p && 'chest' in p && p.chest === c.id);
  me.input.interact = true;
  run(m, 0.05);
  assert.ok(m.opened[c.id]);
  // spilled out, and what we were standing on already in our pockets
  for (const l of c.loot) assert.ok(m.loot.has(l.id) || m.gone.has(l.id));
});

test('scopes let you see farther, backpacks carry more, and whatever doesn’t fit stays on the ground', () => {
  const m = quiet();
  const me = m.fighters[0];
  openSpot(m);
  land(me, 0, 0);
  const put = (id: number, def: LootDef) => m.loot.set(id, { id, def, x: me.x, z: me.z, by: -1, at: 0 });
  assert.equal(viewOf(me), 0);
  put(1, { kind: 'scope', lv: 2 });
  run(m, 0.05);
  assert.equal(me.scope, 2);
  assert.equal(viewOf(me), 11);
  put(2, { kind: 'scope', lv: 1 });
  run(m, 0.1);
  assert.ok(m.loot.has(2), 'a worse scope stays where it is');
  me.guns[0] = { w: 'sniper', r: 0, mag: 4 };
  me.slot = 0;
  assert.equal(viewOf(me), WEAPONS.sniper.zoom, 'the better of the scope and the gun');
  m.loot.delete(2);
  me.ammo.light = ammoCap('light', 0) - 10;
  put(3, { kind: 'ammo', a: 'light', n: 30 });
  const evs = run(m, 0.05);
  assert.equal(me.ammo.light, ammoCap('light', 0));
  const left = evs.find((e) => e.t === 'drop');
  assert.ok(left && left.t === 'drop' && left.item.def.kind === 'ammo' && left.item.def.n === 20 && left.item.by === me.id, 'the rest goes back down');
  m.loot.delete(left.item.id);
  put(4, { kind: 'pack', lv: 2 });
  run(m, 0.05);
  assert.equal(me.pack, 2);
  assert.ok(ammoCap('light', 2) > ammoCap('light', 0) && useCap('bandage', 2) > useCap('bandage', 0));
});

test('every backpack level carries more of everything than the one below it', () => {
  const caps: [string, (pack: number) => number][] = [
    ...AMMO_TYPES.map((a): [string, (pack: number) => number] => [a, (p) => ammoCap(a, p)]),
    ...USE_IDS.map((u): [string, (pack: number) => number] => [u, (p) => useCap(u, p)]),
    ...THROW_IDS.map((k): [string, (pack: number) => number] => [k, (p) => throwCap(k, p)]),
  ];
  for (const [name, cap] of caps) for (let p = 1; p <= MAX_PACK; p++) assert.ok(cap(p) > cap(p - 1), `${name}: ${cap(p - 1)} at level ${p - 1}, ${cap(p)} at level ${p}`);
  // 40% more a level, worked in whole numbers
  assert.deepEqual([0, 1, 2, 3].map((p) => ammoCap('heavy', p)), [90, 126, 162, 198]);
  assert.deepEqual([0, 1, 2, 3].map((p) => useCap('medkit', p)), [2, 3, 4, 5]);
});

test('ponds slow you down and cornfields hide you', () => {
  const m = quiet();
  const [a, b] = m.fighters;
  const pond = m.map.ponds[0];
  const field = m.map.fields[0];
  openSpot(m);
  land(a, pond.x, pond.z);
  a.input.mx = 1;
  run(m, 0.4);
  assert.ok(a.wet);
  assert.ok(Math.abs(Math.hypot(a.vx, a.vz) - SPEED * MELEE.spatula.move * POND_SLOW) < 0.05, 'wading');
  a.input.mx = 0;
  land(b, field.x, field.z);
  land(a, field.x - Math.sign(field.x) * (field.hw + 8), field.z);
  run(m, DT);
  assert.ok(b.bush >= 0 && coverAt(m.map, b.x, b.z) >= 0);
  assert.ok(concealed(m, b, a), 'hidden in the corn');
  assert.ok(!concealed(m, a, b));
});

test('a host’s report of twenty eggs fits well inside one room message, and new holdings travel', () => {
  const players = Array.from({ length: 8 }, (_, seat) => ({ seat, name: `P${seat}` }));
  const h = hostMatch(players, 0, 3, 'normal', MAX_FIGHTERS, 3);
  assert.equal(h.roster.length, 20);
  assert.equal(h.roster.filter((s) => s < 0).length, 12);
  const big = { x: -158.88, z: 157.77, y: 54.9, aim: -3.14, vx: -12.5, vz: 12.5, phase: 'ground' as const, hp: 99.9, shield: 99.9, w: 'pan' as const, r: 4, flags: 255 };
  const packet = hostState(9, 123456789, 345.67, 'hard', h.roster, h.roster.map((_, i): [number, typeof big] => [i, big]));
  const text = JSON.stringify({ t: 'msg', to: 1, d: packet });
  assert.ok(text.length < 4000, `${text.length} bytes`);
  const back = parsePacket(JSON.parse(text).d);
  assert.ok(back && back.k === 'S' && back.states.length === 20 && back.states[19][1].w === 'pan' && back.states[0][1].flags === 255);
  for (const w of ['grenade', 'cleaver', 'lmg'] as const) {
    const s = { ...big, w };
    assert.deepEqual(parsePacket(guestState(1, s)), { k: 's', round: 1, state: s });
  }
  const ok = { y: 'th', f: 3, k: 'sauce', x: 1, z: 2, lx: 10, lz: 12, ft: 0.8 };
  const e = parsePacket({ t: 'pk', r: 1, k: 'e', g: [[3, [ok, { ...ok, ft: 9 }, { ...ok, lx: 300 }, { ...ok, k: 'nuke' }, { ...ok, f: 20 }]]] });
  assert.ok(e && e.k === 'e');
  assert.deepEqual(e.groups[0][1], [ok], 'only the sane throw gets through');
  assert.deepEqual(toNet({ t: 'throw', f: 3, k: 'sauce', x: 1, z: 2, lx: 10, lz: 12, ft: 0.8 }), ok);
});

// ---------------------------------------------------------------------------------------------------------------------
// Odds and ends.

test('loot tables only roll real things, launchers are never common, and the best places hold the best guns', () => {
  const rng = rng32(1);
  const kinds = new Set<string>();
  for (let i = 0; i < 3000; i++) {
    for (const tier of ['floor', 'crate', 'chest', 'gold', 'supply'] as const) {
      const defs = rollLoot(rng, tier);
      assert.ok(defs.length >= 1 && defs.length <= 5);
      for (const def of defs) {
        kinds.add(def.kind);
        assert.ok(parseLoot(def), JSON.stringify(def));
        if (def.kind === 'gun' && def.w === 'launcher') assert.ok(def.r >= 2);
        if (def.kind === 'gun' && tier === 'chest') assert.ok(def.r >= 1, 'chest guns are better than common');
        if (def.kind === 'gun' && tier === 'supply') assert.ok(def.r >= 2, 'supply drops hold rare or better');
        if (def.kind === 'gun' && tier === 'gold') assert.ok(def.r >= 3, 'the golden chest holds epic or legendary');
        if (def.kind === 'wood') assert.ok(def.n <= WOOD_MAX);
      }
      if (tier === 'gold' || tier === 'supply') assert.ok(defs.some((d) => d.kind === 'gun') && defs.some((d) => d.kind === 'throw'));
    }
  }
  assert.deepEqual([...kinds].sort(), ['ammo', 'gun', 'melee', 'pack', 'scope', 'throw', 'use', 'wood'], 'every kind of loot turns up');
  const guns = new Set<string>();
  for (let i = 0; i < 4000; i++) for (const def of rollLoot(rng, 'floor')) if (def.kind === 'gun') guns.add(def.w);
  assert.deepEqual([...guns].sort(), [...WEAPON_IDS].sort(), 'every gun turns up on the floor');
});

test('the scene only uses three.js classes the shared chunk exports', () => {
  const lib = readFileSync(join(import.meta.dirname, '..', 'src', 'os', 'arcade', 'kit', 'three-lib.ts'), 'utf8');
  const exported = new Set(/export \{([^}]+)\} from 'three'/.exec(lib)![1].split(',').map((s) => s.trim()));
  for (const file of ['scene.ts', 'gl.ts']) {
    const src = readFileSync(join(import.meta.dirname, '..', 'src', 'os', 'arcade', 'games', 'scramble', file), 'utf8');
    for (const [, name] of src.matchAll(/\bTHREE\.([A-Za-z0-9_]+)/g)) assert.ok(exported.has(name), `${file} uses THREE.${name}, which three-lib.ts doesn't export`);
  }
});

test('meta: eight seats with late joining and bots, and a board per level', () => {
  assert.deepEqual(meta.online, { seats: 8, lateJoin: true, bots: true });
  assert.deepEqual(Object.keys(meta.leaderboard!.variants!), [...LEVELS]);
  assert.equal(noInput().slot, -1);
});
