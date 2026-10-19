import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { AMMO_BOX, AMMO_TYPES, ARMOR_CUT, ARMOR_KINDS, BOOST, FLARE_WAIT, HP_MAX, SIP, legendary, type ThrowId, MAX_ARMOR, MAX_PACK, MAX_RARITY, MELEE, MELEE_IDS, SHIELD_MAX, THROW, THROWS, THROW_IDS, USES, USE_IDS, WALL_COST, WEAPONS, WEAPON_IDS, WOOD_MAX, ammoCap, armorMult, damageOf, lootName, parseLoot, rng32, rollLoot, throwCap, useCap, type LootDef, type WeaponId } from '../src/os/arcade/games/scramble/items.ts';
import {
  BEACH,
  BRIDGE_HALF,
  BUS_Y,
  CAMP,
  DINER_NAMES,
  DOOR,
  DROP_BASE,
  EDGE,
  FENCE_T,
  FLARE_DROPS,
  GATE,
  HALF,
  HAY_HW,
  LOG_R,
  MILL_NAMES,
  PAD,
  PEEK,
  PEEK_GLASS,
  POND_SLOW,
  RIVER_HALF,
  ROAD_HALF,
  ROAD_SPEED,
  STORM_PHASES,
  STORM_R0,
  SUPPLY_FALL,
  SUPPLY_HALF,
  TOILET_R,
  WALL_T,
  bridgeAt,
  buildingAt,
  busAt,
  bushAt,
  coverAt,
  dropFits,
  fieldAt,
  fireAt,
  furnitureSolid,
  generateMap,
  low,
  padAt,
  peekAt,
  placeAt,
  pondAt,
  pushBox,
  pushCircle,
  pushObb,
  rayBox,
  rayCircle,
  rayObb,
  raySolid,
  reindex,
  riverAt,
  riverCrossings,
  riverDist2,
  roadAt,
  roomAt,
  STASH,
  grassAt,
  isStash,
  opens,
  solidsNear,
  stormAt,
  stormEnd,
  walkCells,
  waterAt,
  yardAt,
  type Building,
  type Door,
  type GameMap,
  type Pane,
  type Slab,
} from '../src/os/arcade/games/scramble/map.ts';
import {
  BARREL,
  CHEST_R,
  COUNTDOWN,
  DOOR_GONE,
  DOOR_HP,
  DOOR_IN,
  DOOR_OPENING,
  DOOR_OUT,
  DOOR_SHUT,
  F_GHILLIE,
  F_STUN,
  GHILLIE,
  LEADER_MIN,
  VAULT_TIME,
  camouflaged,
  damageDoor,
  doorNear,
  launch,
  lockedIn,
  nearestChest,
  requestDoor,
  CRATE_HP,
  FALL,
  FIGHTER_COLORS,
  FIGHTER_R,
  F_ALL,
  F_HEALING,
  F_PAN,
  F_SMOOTHIE,
  F_SPIN,
  F_TART,
  GROWN,
  INTERP,
  LEVELS,
  LEVEL_SPECS,
  MAX_FIGHTERS,
  PAD_FLY,
  PICK_R,
  SLOT_MELEE,
  SLOT_THROW,
  SPEED,
  STORM_TICK,
  TOILET_HP,
  WALL_HP,
  aliveCount,
  applyState,
  armored,
  autopilot,
  bestUse,
  breakGlass,
  botNames,
  callDrop,
  canUse,
  canSee,
  castRay,
  clearLine,
  concealed,
  createMatch,
  damageCrate,
  dropId,
  dropSpot,
  flagsOf,
  held,
  hurt,
  makeWall,
  moveLoot,
  noInput,
  openable,
  panBlocks,
  prompt,
  scoreOf,
  soloMatch,
  standing,
  step,
  viewOf,
  wants,
  type Entrant,
  type Ev,
  type Fighter,
  type Level,
  type Match,
} from '../src/os/arcade/games/scramble/logic.ts';
import { MAX_KICK, applyNet, configOf, endOf, guestState, hitCap, hostState, packDoors, packEvents, packGlass, parsePacket, placesOf, stateOf, toNet, unpackDoors, unpackGlass, type NetEv } from '../src/os/arcade/games/scramble/net.ts';
import { END_PAUSE, FAR_EVERY, FIRST_GRACE, FLUSH, NEAR, OUT_EVERY, QUICK_LEVEL, STALE, TICK_MS, catchUp, ending, flush, guestMatch, hostBots, hostMatch, newSession, offscreen, receive, resultCard, share, tick, type Me, type Player, type Session } from '../src/os/arcade/games/scramble/session.ts';
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

/**
 * Clears the island down to bare grass (no trees, rocks, buildings, bushes, crates, barrels, loot, fences, cars,
 * roads, river, campfires or bounce pads) and returns its middle.
 */
function openSpot(m: Match) {
  m.map.solids = [];
  m.map.grid = m.map.grid.map(() => []);
  m.map.bushes = [];
  m.map.buildings = [];
  m.map.yards = [];
  m.map.cars = [];
  m.map.roads = [];
  m.map.river = [];
  m.map.bridges = [];
  m.map.fires = [];
  m.map.pads = [];
  m.map.containers = [];
  m.map.drops = [];
  m.map.flares = [];
  m.map.slabs = [];
  m.opened = [];
  m.crateHp = [];
  m.locked = [];
  m.doors = [];
  m.doorHp = [];
  m.doorAt = [];
  m.doorT = [];
  m.vaults = [];
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

const KIND_COUNTS: Partial<Record<Building['kind'], number>> = { coop: 1, warehouse: 4, farm: 4, house: 22, shed: 16, ruin: 9, police: 1, bank: 1 };
const DOOR_COUNTS: Partial<Record<Building['kind'], number>> = { coop: 1, warehouse: 3, farm: 3, house: 2, shed: 1, container: 1, diner: 2, mill: 1, police: 2, bank: 2 };
/** Total wall length a building would have with no gaps at all (corners counted once), as its walls are laid out. */
const fullWalls = (b: Building) => 2 * (b.w + WALL_T) + 2 * (b.d - WALL_T);
/** Its walls and the windows in them: a window is no way in. */
const wallLength = (b: Building) => [...b.walls, ...b.windows].reduce((s, w) => s + 2 * Math.max(w.hw, w.hd), 0);
/** The same, for its outer walls alone. */
const outerLength = (b: Building) => [...b.walls, ...b.windows].filter((w) => Math.abs(Math.abs(w.x - b.x) - b.w / 2) < 0.01 || Math.abs(Math.abs(w.z - b.z) - b.d / 2) < 0.01).reduce((s, w) => s + 2 * Math.max(w.hw, w.hd), 0);

test('every island has all its buildings, each with the doorways it should have, and nothing outdoors inside them', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const m = generateMap(seed);
    for (const [kind, n] of Object.entries(KIND_COUNTS)) assert.equal(m.buildings.filter((b) => b.kind === kind).length, n, `seed ${seed}: ${kind}`);
    assert.ok(m.buildings.filter((b) => b.kind === 'container').length >= 12, `seed ${seed}: four yards of containers`);
    assert.equal(m.buildings[m.coop]?.kind, 'coop');
    const special = m.buildings.filter((b) => b.kind === 'diner' || b.kind === 'mill');
    assert.ok(special.length >= 2 && special.length <= 3 && new Set(special.map((b) => b.kind)).size === 2, `seed ${seed}: a diner and a windmill, now and then a second of one`);
    assert.equal(m.fields.length, 4, 'a cornfield beside each farm');
    assert.equal(m.ponds.length, 7);
    for (const b of m.buildings) {
      assert.ok(Math.abs(b.x) + b.w / 2 < HALF - BEACH && Math.abs(b.z) + b.d / 2 < HALF - BEACH, 'buildings stand on grass');
      assert.equal(b.roof, b.kind !== 'ruin', 'everything but ruins has a roof');
      const gaps = fullWalls(b) - wallLength(b);
      if (b.kind === 'house') assert.ok(Math.abs(gaps - 2 * DOOR) < 0.31, `seed ${seed}: a house has two doorways`);
      if (b.kind === 'shed' || b.kind === 'coop' || b.kind === 'mill') assert.ok(Math.abs(gaps - DOOR) < 0.31, `seed ${seed}: one way into a ${b.kind}`);
      if (b.kind === 'diner') assert.ok(Math.abs(gaps - 2 * DOOR) < 0.31, `seed ${seed}: a front door and a back door`);
      if (b.kind === 'warehouse') assert.ok(Math.abs(gaps - 2 * 6 - DOOR) < 0.31, `seed ${seed}: two loading doors and a side door`);
      if (b.kind === 'farm') assert.ok(Math.abs(gaps + (b.d - WALL_T - DOOR) - 3 * DOOR) < 0.31, `seed ${seed}: three doors and a door between the rooms`);
      if (b.kind === 'container') assert.ok(Math.abs(gaps - (b.w > b.d ? b.d - WALL_T : b.w + WALL_T)) < 0.31, 'open at one end');
      if (b.kind === 'police' || b.kind === 'bank') {
        assert.ok(Math.abs(fullWalls(b) - outerLength(b) - 2 * DOOR) < 0.31, `seed ${seed}: a front door and a side door into a ${b.kind}`);
        assert.equal(b.rooms.length, b.kind === 'police' ? 3 : 2, `seed ${seed}: the rooms of a ${b.kind}`);
        assert.equal(b.inner.length, b.rooms.length - 1, 'a doorway into each back room');
      }
      if (b.kind === 'police') assert.ok(b.inner.some((d) => d.kind === 'bars') && b.bars.length >= 2, `seed ${seed}: a jail cell behind bars`);
      if (b.kind === 'bank') assert.ok(b.inner.some((d) => d.kind === 'vault'), `seed ${seed}: a vault`);
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
    assert.ok(m.trees.length >= 540 && m.rocks.length >= 150 && m.bushes.length >= 240, `seed ${seed} scenery`);
    const kinds = (k: string) => m.containers.filter((c) => c.kind === k);
    assert.ok(kinds('chest').length >= 48, 'a chest in every house and farm, and more besides');
    assert.equal(kinds('chest').filter((c) => c.gold).length, 1, 'one golden chest, in the Golden Coop');
    assert.ok(kinds('barrel').length >= 40, 'barrels about');
    assert.equal(kinds('supply').filter((c) => !c.flare).length, 7, 'two drops for each of the first three circles and one for the fourth');
    assert.equal(m.flares.length, FLARE_DROPS, 'and the ones flare guns call, waiting');
    for (const id of m.flares) assert.ok(m.containers[id].flare && m.containers[id].at === Infinity && m.containers[id].kind === 'supply');
    // the kitchens, the farmyards, the camps and everything round the houses
    const diners = m.buildings.filter((b) => b.kind === 'diner').length;
    assert.equal(kinds('fridge').length, 26 + 2 * diners, 'a fridge in every house and farmhouse, and two in a diner');
    assert.equal(kinds('toilet').length, 27, 'and a toilet (one more in the jail cell)');
    assert.ok(kinds('hay').length >= 12 && kinds('hay').length <= 20, 'three to five hay bales a farm');
    assert.equal(m.yards.length, 4, 'a fence round each farm');
    for (const y of m.yards) {
      assert.equal(y.gates.length, 4, 'a gate in every side');
      for (const g of y.gates) assert.ok(Math.abs(g.w - GATE) < 0.01);
      const farm = m.buildings.find((b) => b.kind === 'farm' && Math.abs(b.x - y.x) < y.hw && Math.abs(b.z - y.z) < y.hd)!;
      assert.ok(farm && m.fields.some((f) => Math.abs(f.x - y.x) < y.hw && Math.abs(f.z - y.z) < y.hd), 'the farmhouse and its field inside it');
      for (const c of kinds('hay')) if (Math.abs(c.x - y.x) < y.hw && Math.abs(c.z - y.z) < y.hd) assert.ok(Math.abs(c.x - farm.x) > farm.w / 2 + 1 || Math.abs(c.z - farm.z) > farm.d / 2 + 1, 'hay outdoors');
    }
    assert.ok(m.fires.length >= 7 && m.fires.length <= 24, `seed ${seed}: seven camps and a few house fires (${m.fires.length})`);
    assert.equal(m.pads.length, 12, 'twelve bounce pads');
    for (const p of m.pads) assert.ok(Math.abs(Math.hypot(p.dx, p.dz) - 1) < 0.01 && p.x * p.dx + p.z * p.dz < 0, 'each pointing in toward the island');
    assert.ok(m.cars.length >= 8 && m.lamps.length >= 90 && m.mailboxes.length >= 35 && m.tables.length >= 7 && m.roads.length >= 60, `seed ${seed}: props and roads`);
    assert.ok(m.places.length >= 18, `seed ${seed}: named places`);
    assert.equal(new Set(m.places.map((p) => p.name)).size, m.places.length, 'no two places share a name');
    for (const b of m.buildings) if (b.kind === 'farm' || b.kind === 'warehouse' || b.kind === 'coop') assert.ok(placeAt(m, b.x, b.z) >= 0, `seed ${seed}: a ${b.kind} is somewhere with a name`);
    for (const f of m.fires) assert.ok(placeAt(m, f.x, f.z) >= 0 || m.buildings.some((b) => Math.hypot(b.x - f.x, b.z - f.z) < 20), 'a fire is at a camp or by a house');
  }
});

test('roads run edge to edge between places, never through a building, a pond or a fence; lamp posts stand beside them', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const m = generateMap(seed);
    for (const r of m.roads) {
      const len = Math.hypot(r.x1 - r.x0, r.z1 - r.z0);
      const ux = (r.x1 - r.x0) / len;
      const uz = (r.z1 - r.z0) / len;
      assert.ok(len >= 6, 'long enough to be a road');
      for (const b of m.buildings) assert.equal(rayBox(r.x0, r.z0, ux, uz, len, b.x, b.z, b.w / 2, b.d / 2), Infinity, `seed ${seed}: a road through a ${b.kind}`);
      for (const p of m.ponds) assert.equal(rayCircle(r.x0, r.z0, ux, uz, len, p.x, p.z, p.r), Infinity, 'a road through a pond');
      for (const y of m.yards) for (const f of y.fences) assert.equal(rayBox(r.x0, r.z0, ux, uz, len, f.x, f.z, f.hw, f.hd), Infinity, 'a road through a fence (the gate is the way in)');
      assert.ok(roadAt(m, (r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2), 'you can stand on it');
      assert.ok(Math.abs(r.x0) < EDGE && Math.abs(r.z0) < EDGE && Math.abs(r.x1) < EDGE && Math.abs(r.z1) < EDGE);
    }
    for (const l of m.lamps) {
      assert.ok(!roadAt(m, l.x, l.z), 'a lamp post stands beside the road, not on it');
      assert.ok(m.roads.some((r) => Math.hypot(l.x - (r.x0 + r.x1) / 2, l.z - (r.z0 + r.z1) / 2) < Math.hypot(r.x1 - r.x0, r.z1 - r.z0) / 2 + 4), 'near one');
    }
    for (const t of m.trees) assert.ok(!roadAt(m, t.x, t.z), 'no tree grows in the road');
  }
});

test('campfires, bounce pads, cars and tables stand in the open where an egg can walk up to them, and never indoors', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const m = generateMap(seed);
    const indoors = (x: number, z: number) => m.buildings.some((b) => Math.abs(x - b.x) < b.w / 2 + 0.5 && Math.abs(z - b.z) < b.d / 2 + 0.5);
    const wet = (x: number, z: number) => m.ponds.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + 1);
    const check = (x: number, z: number, reach: number, what: string) => {
      assert.ok(!indoors(x, z) && !wet(x, z), `seed ${seed}: a ${what} indoors or in a pond`);
      const walk = walkable(m, x - 9, z - 9, x + 9, z + 9);
      assert.ok(walk(x, z, reach), `seed ${seed}: no way up to the ${what} at ${x},${z}`);
    };
    for (const f of m.fires) check(f.x, f.z, CAMP.r - 0.3, 'campfire');
    for (const p of m.pads) check(p.x, p.z, PAD.r - 0.2, 'bounce pad');
    for (const c of m.cars) check(c.x, c.z, Math.max(c.hw, c.hd) + 1.4, 'car');
    for (const t of m.tables) check(t.x, t.z, 2.6, 'picnic table');
    for (const l of [...m.lamps, ...m.mailboxes]) check(l.x, l.z, 1.4, 'post');
    for (const p of m.pads) {
      assert.ok(yardAt(m, p.x, p.z) < 0, 'no pad inside a farmyard');
      // and nowhere near a door, so nobody gets thrown about leaving a house
      for (const b of m.buildings) for (const d of b.doors) assert.ok(Math.hypot(p.x - d.x, p.z - d.z) > 5, `seed ${seed}: a pad by a doorway`);
    }
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
          // in a yard of containers, the next one's open end can be nearer; so can a shed's door facing this one
          if (b.kind === 'container') assert.ok(at >= 0 && m.buildings[at].kind === 'container', `seed ${seed}: peeking into a container`);
          else if (at !== i) {
            const other = m.buildings[at];
            const nearer = other?.doors.some((o) => (p.x - o.x) * o.ox + (p.z - o.z) * o.oz < k - 0.5);
            assert.ok(nearer, `seed ${seed}: ${k} m out from a ${b.kind}'s door`);
          }
        }
        const far = out(d, 6);
        assert.ok(peekAt(m, far.x, far.z) >= 0, `seed ${seed}: lined up with a door from six meters`);
        const beyond = out(d, PEEK + 1);
        assert.notEqual(peekAt(m, beyond.x, beyond.z), i, 'too far to peek in');
      }
      // three meters out from the middle of a wall with no door or window in it, you can't see in
      if (!b.roof || b.kind === 'container') return;
      for (const [ox, oz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        if (b.doors.some((d) => d.ox === ox && d.oz === oz) || b.windows.some((p) => p.ox === ox && p.oz === oz)) continue;
        const x = b.x + ox * (b.w / 2 + 3);
        const z = b.z + oz * (b.d / 2 + 3);
        assert.notEqual(peekAt(m, x, z), i, `seed ${seed}: no peeking into a ${b.kind} through a blank wall`);
      }
    });
  }
});

/**
 * Every spot an egg could stand on a 0.4 m grid over a window of the island, then which ones can be walked to from
 * the window's edge (or from one spot, `from`). Loot is in reach when an egg standing somewhere it can walk to could
 * pick it up. With `dry`, the river counts as a wall: the only way over is a bridge. Every door is open, unless
 * `shut`.
 */
function walkable(m: GameMap, x0: number, z0: number, x1: number, z1: number, opts: { from?: { x: number; z: number }; dry?: boolean; shut?: boolean } = {}) {
  const step = 0.4;
  const nx = Math.ceil((x1 - x0) / step);
  const nz = Math.ceil((z1 - z0) / step);
  const free = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * step;
      const z = z0 + j * step;
      let ok = Math.abs(x) <= EDGE && Math.abs(z) <= EDGE && !(opts.dry && riverAt(m, x, z));
      if (ok)
        solidsNear(m, x, z, 3, (_k, s) => {
          if (s.what === 'door' && !opts.shut) return;
          if (ok && (s.shape === 'circle' ? pushCircle(x, z, FIGHTER_R, s.x, s.z, s.r) : pushBox(x, z, FIGHTER_R, s.x, s.z, s.hw, s.hd))) ok = false;
        });
      free[i + j * nx] = ok ? 1 : 0;
    }
  const seen = new Uint8Array(nx * nz);
  const queue: number[] = [];
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++) {
      const start = opts.from ? Math.hypot(x0 + i * step - opts.from.x, z0 + j * step - opts.from.z) < 0.3 : i === 0 || j === 0 || i === nx - 1 || j === nz - 1;
      if (start && free[i + j * nx]) {
        seen[i + j * nx] = 1;
        queue.push(i + j * nx);
      }
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

test('every building and farmyard can be walked into, furniture and all, and everything in it reached', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const m = generateMap(seed);
    // a farm's lot is its whole fenced yard: the way in is through a gate
    const lots = [...m.buildings.map((b) => ({ kind: b.kind, x: b.x, z: b.z, hw: b.w / 2, hd: b.d / 2, b })), ...m.yards.map((y) => ({ kind: 'yard', x: y.x, z: y.z, hw: y.hw, hd: y.hd, b: null }))];
    for (const b of lots) {
      const reach = walkable(m, b.x - b.hw - 4, b.z - b.hd - 4, b.x + b.hw + 4, b.z + b.hd + 4);
      // every doorway stays open from the inside too, both sides of a doorway between rooms (a ruin's gaps are just
      // where its walls fell)
      if (b.b && b.kind !== 'ruin')
        for (const [d, ks] of [...b.b.doors.map((d) => [d, [-1]] as const), ...b.b.inner.map((d) => [d, [-1, 1]] as const)])
          for (const k of ks) assert.ok(reach(d.x + d.ox * k * 1.1, d.z + d.oz * k * 1.1, 0.45), `seed ${seed}: in through a ${b.kind}'s doorway at ${d.x},${d.z}`);
      const inLot = (x: number, z: number) => Math.abs(x - b.x) < b.hw && Math.abs(z - b.z) < b.hd;
      for (const l of m.floor) if (inLot(l.x, l.z)) assert.ok(reach(l.x, l.z, PICK_R - 0.1), `seed ${seed}: loot at ${l.x},${l.z} in a ${b.kind}`);
      for (const c of m.containers) {
        if (!inLot(c.x, c.z)) continue;
        if (c.kind === 'chest' || c.kind === 'fridge' || isStash(c.kind)) assert.ok(reach(c.x, c.z, CHEST_R - 0.1), `seed ${seed}: the ${c.kind} in a ${b.kind}`);
        // a crate, toilet or hay bale is broken from wherever a gun can see it; its loot spills where it stood
        if (c.kind === 'crate' || c.kind === 'toilet') assert.ok(reach(c.x, c.z, PICK_R + 0.7), `seed ${seed}: the ${c.kind} in a ${b.kind}`);
        if (c.kind === 'hay') assert.ok(reach(c.x, c.z, PICK_R + 1), `seed ${seed}: the hay in a ${b.kind}`);
      }
      if (b.kind === 'yard') for (const g of m.yards.find((y) => y.x === b.x && y.z === b.z)!.gates) assert.ok(reach(g.x, g.z, 0.5), `seed ${seed}: a gate is open`);
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
    const grid = castRay(m, x, z, dx, dz, len, -1, false, true);
    let brute = Infinity;
    for (const s of m.map.solids) if (standing(m, s)) brute = Math.min(brute, raySolid(s, x, z, dx, dz, len));
    assert.equal(grid?.t ?? Infinity, brute, `ray ${i}`);
    // bullets and eyes go over fences, tables and fire pits
    const high = castRay(m, x, z, dx, dz, len, -1, false);
    let tall = Infinity;
    for (const s of m.map.solids) if (standing(m, s) && !low(s)) tall = Math.min(tall, raySolid(s, x, z, dx, dz, len));
    assert.equal(high?.t ?? Infinity, tall, `high ray ${i}`);
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

test('what stands at a point is found by its grid cell, the same as looking at everything, and a list swapped is seen', () => {
  const seg2 = (x: number, z: number, x0: number, z0: number, x1: number, z1: number) => {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const l2 = dx * dx + dz * dz;
    const u = l2 > 0 ? Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / l2)) : 0;
    return (x0 + dx * u - x) ** 2 + (z0 + dz * u - z) ** 2;
  };
  for (const seed of [3, 8]) {
    const map = generateMap(seed);
    const brute = (x: number, z: number) => ({
      bush: map.bushes.findIndex((b) => (x - b.x) ** 2 + (z - b.z) ** 2 < b.r * b.r * 0.72),
      field: map.fields.findIndex((f) => Math.abs(x - f.x) < f.hw - 0.3 && Math.abs(z - f.z) < f.hd - 0.3),
      pond: map.ponds.findIndex((p) => (x - p.x) ** 2 + (z - p.z) ** 2 < p.r * p.r),
      fire: map.fires.findIndex((f) => (x - f.x) ** 2 + (z - f.z) ** 2 < CAMP.r * CAMP.r),
      pad: map.pads.findIndex((p) => (x - p.x) ** 2 + (z - p.z) ** 2 < PAD.r * PAD.r),
      yard: map.yards.findIndex((y) => Math.abs(x - y.x) < y.hw - FENCE_T / 2 && Math.abs(z - y.z) < y.hd - FENCE_T / 2),
      building: map.buildings.findIndex((b) => b.roof && Math.abs(x - b.x) < b.w / 2 - WALL_T / 2 && Math.abs(z - b.z) < b.d / 2 - WALL_T / 2),
      room: map.buildings.findIndex((b) => b.roof && Math.abs(x - b.x) < (b.w + WALL_T) / 2 && Math.abs(z - b.z) < (b.d + WALL_T) / 2),
      bridge: map.bridges.findIndex((b) => Math.abs(x - b.x) < b.hw && Math.abs(z - b.z) < b.hd),
      road: map.roads.some((r) => seg2(x, z, r.x0, r.z0, r.x1, r.z1) < ROAD_HALF * ROAD_HALF),
      river: riverDist2(map, x, z) < RIVER_HALF * RIVER_HALF && !map.bridges.some((b) => Math.abs(x - b.x) < b.hw && Math.abs(z - b.z) < b.hd),
    });
    const fast = (x: number, z: number) => ({
      bush: bushAt(map, x, z),
      field: fieldAt(map, x, z),
      pond: pondAt(map, x, z),
      fire: fireAt(map, x, z),
      pad: padAt(map, x, z),
      yard: yardAt(map, x, z),
      building: buildingAt(map, x, z),
      room: roomAt(map, x, z),
      bridge: bridgeAt(map, x, z),
      road: roadAt(map, x, z),
      river: riverAt(map, x, z),
    });
    // all over the island and just off it, then right at things, where the edges are
    const rng = rng32(seed);
    const points: [number, number][] = Array.from({ length: 4000 }, () => [(rng() * 2 - 1) * (HALF + 30), (rng() * 2 - 1) * (HALF + 30)]);
    for (const t of [...map.bushes, ...map.ponds, ...map.fires, ...map.pads, ...map.yards, ...map.buildings, ...map.bridges, ...map.river]) for (let k = 0; k < 6; k++) points.push([t.x + (rng() * 2 - 1) * 12, t.z + (rng() * 2 - 1) * 12]);
    for (const r of map.roads) for (let k = 0; k < 4; k++) points.push([r.x0 + (r.x1 - r.x0) * rng() + (rng() * 2 - 1) * 3, r.z0 + (r.z1 - r.z0) * rng() + (rng() * 2 - 1) * 3]);
    let hits = 0;
    for (const [x, z] of points) {
      const want = brute(x, z);
      assert.deepEqual(fast(x, z), want, `seed ${seed} at ${x.toFixed(2)},${z.toFixed(2)}`);
      if (Object.values(want).some((v) => v !== -1 && v !== false)) hits++;
    }
    assert.ok(hits > 1000, `most points were at something (${hits})`);
    // a list swapped for another (as tests do) or grown is seen at once
    const p = map.pads[0];
    assert.equal(padAt(map, p.x, p.z), 0);
    map.pads = [];
    assert.equal(padAt(map, p.x, p.z), -1);
    map.pads.push({ ...p });
    assert.equal(padAt(map, p.x, p.z), 0);
  }
});

test('loot is found where it lies however it got there: spilled, dropped, shoved, or set down by hand', () => {
  const m = quiet(9, 2);
  const [a, b] = m.fighters;
  openSpot(m);
  land(a, 0, 0);
  land(b, 40, 40);
  // set down by hand while nobody was looking, then again in place of something else with the same count
  m.loot.set(1, { id: 1, def: { kind: 'ammo', a: 'light', n: 10 }, x: 0.3, z: 0, by: -1, at: 0 });
  run(m, 0.05);
  assert.equal(a.ammo.light, 10);
  m.loot.set(2, { id: 2, def: { kind: 'ammo', a: 'heavy', n: 5 }, x: 30, z: 30, by: -1, at: 0 });
  run(m, 0.05);
  m.loot.delete(2);
  m.loot.set(3, { id: 3, def: { kind: 'ammo', a: 'shells', n: 4 }, x: 0, z: 0.4, by: -1, at: 0 });
  run(m, 0.05);
  assert.equal(a.ammo.shells, 4, 'the new one, not the one taken away');
  // shoved from far off to right under b: picked up where it ended
  m.loot.set(4, { id: 4, def: { kind: 'ammo', a: 'heavy', n: 6 }, x: -100, z: -100, by: -1, at: 0 });
  run(m, 0.05);
  moveLoot(m, 4, 40.2, 40, true);
  run(m, 0.05);
  assert.equal(b.ammo.heavy, 6);
  assert.ok(!m.loot.has(4));
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
    // a flare gun hurts nobody, at any rarity
    if (WEAPONS[w].call) for (let r = 0; r <= 4; r++) assert.equal(damageOf(w, r), 0);
    else for (let r = 1; r <= 4; r++) assert.ok(damageOf(w, r) > damageOf(w, r - 1));
  }
});

/** What one bullet or pellet does to an egg, rounded the way a hit is. */
const perHit = (w: WeaponId, r: number) => Math.max(1, Math.round(damageOf(w, r)));

test('no gun cracks a full-health egg with one pull of the trigger at any rarity, and no swing does either', () => {
  for (const w of WEAPON_IDS) {
    const spec = WEAPONS[w];
    for (let r = 0; r <= MAX_RARITY; r++) {
      // every pellet at point blank, every shot of a burst, a launcher egg right on target
      const pull = perHit(w, r) * spec.pellets * (spec.burst?.n ?? 1);
      assert.ok(pull < HP_MAX, `${w} r${r}: ${pull}`);
    }
  }
  for (const w of MELEE_IDS) assert.ok(MELEE[w].dmg < HP_MAX, w);

  // and for real, a legendary of each fired once from two steps away (but a flare, which only calls a drop)
  for (const w of WEAPON_IDS) {
    if (WEAPONS[w].call) continue;
    const m = quiet();
    const [a, b] = m.fighters;
    openSpot(m);
    land(a, 0, 0);
    land(b, 0, 2);
    a.guns[0] = { w, r: MAX_RARITY, mag: WEAPONS[w].mag };
    a.slot = 0;
    // a minigun already spun up
    if (WEAPONS[w].spin) a.spin = 1;
    a.input.aim = 0;
    a.input.fire = true;
    run(m, DT);
    a.input.fire = false;
    run(m, 1);
    assert.ok(b.hp > 0 && b.hp < HP_MAX, `${w} left ${b.hp}`);
  }
});

test('a sniper takes two hits to crack a bare egg even at legendary, and three through a shield at common', () => {
  const hits = (w: WeaponId, r: number, total: number) => Math.ceil(total / perHit(w, r));
  assert.equal(hits('sniper', MAX_RARITY, HP_MAX), 2);
  assert.equal(hits('sniper', 0, HP_MAX), 2);
  assert.equal(hits('sniper', 0, HP_MAX + 50), 3);
  assert.equal(hits('sniper', 0, HP_MAX + SHIELD_MAX), 3);
  // the other long guns never take fewer
  for (const w of ['scout', 'crossbow'] as const) for (let r = 0; r <= MAX_RARITY; r++) assert.ok(hits(w, r, HP_MAX) >= 2, w);
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
  b.helmet = 2;
  b.vest = 1;
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
  assert.deepEqual(spilled.sort(), ['ammo', 'gun', 'helmet', 'melee', 'scope', 'throw', 'use', 'vest', 'wood']);
  assert.equal(b.melee, 'spatula');
  assert.equal(b.helmet + b.vest, 0);
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
  assert.deepEqual(back, { k: 's', round: 4, state: s, watch: -1 });
  // once its egg is out, a guest says which egg it watches
  assert.deepEqual(parsePacket(JSON.parse(JSON.stringify(guestState(4, s, 7)))), { k: 's', round: 4, state: s, watch: 7 });
  assert.equal(parsePacket({ ...guestState(4, s), v: MAX_FIGHTERS }), null);
  const host = parsePacket(JSON.parse(JSON.stringify(hostState(4, 99, -2.5, 'hard', [0, 1, -1], [[0, s], [2, s]]))));
  assert.deepEqual(host, { k: 'S', round: 4, seed: 99, time: -2.5, level: 'hard', roster: [0, 1, -1], states: [[0, s], [2, s]], glass: null, doors: [] });
  // the roster only goes with some of the host's reports
  assert.deepEqual(parsePacket(JSON.parse(JSON.stringify(hostState(4, 99, 3, 'hard', null, [[2, s]])))), { k: 'S', round: 4, seed: 99, time: 3, level: 'hard', roster: null, states: [[2, s]], glass: null, doors: null });
  assert.equal(parsePacket({ ...hostState(4, 99, 3, 'hard', null, []), ro: 'all' }), null);
  assert.deepEqual(parsePacket(endOf(4, 2, [[2, 1, 3], [0, 2, 1]])), { k: 'end', round: 4, winner: 2, places: [[2, 1, 3], [0, 2, 1]] });
  assert.deepEqual(parsePacket(configOf(4, 'none', 'easy')), { k: 'cfg', round: 4, bots: 'none', level: 'easy' });
  for (const bad of [null, 1, 'x', {}, { t: 'pk', r: 1.5, k: 's', c: [] }, { t: 'pk', r: 1, k: 's', c: [1, 2] }, { t: 'pk', r: 1, k: 'S', sd: 1, tm: 0, lv: 'brutal', ro: [0], c: [] }, { t: 'pk', r: 1, k: 'S', sd: 1, tm: 0, lv: 'easy', ro: [0, 0], c: [] }, { t: 'pk', r: 1, k: 'end', w: MAX_FIGHTERS, pl: [] }, { t: 'pk', r: 1, k: 'cfg', b: 'lots', lv: 'easy' }])
    assert.equal(parsePacket(bad), null, JSON.stringify(bad));
  // states out of any sane range
  const wild = guestState(1, { ...s, hp: 500 });
  assert.equal(parsePacket(wild), null);
  // bad events drop out one by one, good ones stay
  const e = parsePacket({ t: 'pk', r: 1, k: 'e', g: [[1, [{ y: 'd', f: 1, to: 0, d: 12, w: 'smg', x: 0, z: 0 }, { y: 'd', f: 1, to: 0, d: 9999, w: 'smg', x: 0, z: 0 }, { y: 'dr', id: 5, x: 0, z: 0, by: 1, it: { kind: 'gun', w: 'bazooka', r: 1 } }, { y: 'zz' }]]] });
  assert.ok(e && e.k === 'e');
  assert.equal(e.groups[0][1].length, 1);
});

test('a hit from another client can do no more than that weapon ever could', () => {
  const hit = (d: number, w: string) => {
    const p = parsePacket({ t: 'pk', r: 1, k: 'e', g: [[1, [{ y: 'd', f: 1, to: 0, d, w, x: 0, z: 0 }]]] });
    return !!p && p.k === 'e' && p.groups[0]?.[1].length === 1;
  };
  for (const w of WEAPON_IDS) {
    if (WEAPONS[w].call) {
      assert.equal(hitCap(w), 0);
      assert.ok(!hit(1, w), 'a flare hits nobody');
      continue;
    }
    const most = perHit(w, MAX_RARITY);
    assert.equal(hitCap(w), most);
    assert.ok(hit(most, w), w);
    assert.ok(!hit(most + 1, w), w);
    assert.ok(most < HP_MAX, `${w}: no single hit cracks a full egg`);
  }
  assert.ok(hit(MELEE.cleaver.dmg, 'cleaver') && !hit(MELEE.cleaver.dmg + 1, 'cleaver'));
  assert.ok(hit(THROWS.grenade.dmg!, 'grenade') && !hit(THROWS.grenade.dmg! + 1, 'grenade'));
  // each client works these out for its own egg, so they never come as hits
  for (const w of ['storm', 'sauce', 'barrel', 'impulse', 'left']) assert.ok(!hit(1, w), w);
});

test('what happens here becomes network news only when someone else needs it', () => {
  assert.equal(toNet({ t: 'hit', f: 0, to: 1, d: 5, took: 5, w: 'smg', x: 0, z: 0, shield: false, local: true }), null, 'a hit on an egg we own is already applied');
  assert.deepEqual(toNet({ t: 'hit', f: 0, to: 1, d: 5, took: 4, w: 'smg', x: 1, z: 2, shield: false, local: false }), { y: 'd', f: 0, to: 1, d: 5, w: 'smg', x: 1, z: 2 }, 'the hit as fired: the owner takes the armor off it');
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

type Client = { seat: number; me: Me; s: Session; m: Match | null; inbox: { at: number; from: number; d: unknown }[]; gone: boolean; call: 'report' | 'quiet' | null; hurtBy: number; heard: number; doneAt: number };

/**
 * `hostDone`: past this time, the host's egg cracks (once it has landed) and the host is done watching: from then on
 * its game draws no frames, and only its timer moves the match on, as index.tsx does.
 */
function simulate(opts: { humans: number; bots: boolean; seed: number; level: Level; delay: number; loss: number; leave?: { seat: number; at: number }; stall?: { seat: number; at: number; silent: boolean }; hostDone?: number }) {
  const players: Player[] = Array.from({ length: opts.humans }, (_, seat) => ({ seat, name: `P${seat + 1}` }));
  const rng = rng32(opts.seed * 7 + 1);
  const host = hostMatch(players, 0, opts.seed, opts.level, opts.bots ? MAX_FIGHTERS : 0, COUNTDOWN + 1.2);
  const clients: Client[] = players.map((p) => ({ seat: p.seat, me: { seat: p.seat, isHost: p.seat === 0, round: 1 }, s: newSession(p.seat === 0, p.seat === 0 ? host.roster : []), m: p.seat === 0 ? host.match : null, inbox: [], gone: false, call: null, hurtBy: 0, heard: 0, doneAt: -1 }));
  autopilot(host.match, host.match.fighters[host.match.me]);
  let now = 0;
  const post = (from: Client, d: object, fast: boolean, only?: number) => {
    const to = from.me.isHost ? clients.filter((c) => c !== from && !c.gone && (only === undefined || c.seat === only)) : [clients[0]];
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
      if (opts.hostDone !== undefined && c.me.isHost && !c.s.over && now > opts.hostDone) {
        const egg = c.m.fighters[c.m.me];
        if (egg.phase === 'ground') hurt(c.m, egg, 999, -1, 'storm', true);
        if (egg.phase === 'out') {
          c.s.over = true;
          c.s.early = true;
          c.doneAt = c.m.time;
        }
      }
      if (c.s.over) {
        // nothing draws the match here any more: it moves on with the timer
        const call = ending(c.s, c.m, c.me, now);
        if (call) {
          c.call ??= call;
          c.s.reported = true;
          c.s.early = false;
        }
        continue;
      }
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
      for (const c of live) {
        if (!c.m || (stalled(c) && opts.stall!.silent)) continue;
        if (offscreen(c.s, c.me, false, !c.s.over)) {
          catchUp(c.s, c.m, c.seat, TICK_MS / 1000);
          for (const p of flush(c.s, 1, FLUSH)) post(c, p, false);
        }
        // a guest that is out watches the egg that cracked it, or the first one still going
        const mine = c.m.fighters[c.m.me];
        if (mine?.phase === 'out') c.s.watch = c.m.fighters[mine.by]?.phase === 'ground' ? mine.by : (c.m.fighters.find((f) => f.phase !== 'out')?.id ?? c.m.me);
        for (const out of tick(c.s, c.m, c.me, live.map((x) => x.seat), now)) post(c, out.d, out.fast, out.to);
      }
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
  ['a host, three guests and computer eggs to fifty, with lag and lost packets', { humans: 4, bots: true, seed: 23, level: 'hard' as Level, delay: 0.08, loss: 0.15 }],
  ['eight people and no computer eggs, one of whom leaves halfway', { humans: 8, bots: false, seed: 34, level: 'normal' as Level, delay: 0.05, loss: 0.05, leave: { seat: 5, at: 30 } }],
  ['a guest whose tab freezes on the bus (still in the room, still reporting)', { humans: 3, bots: true, seed: 8, level: 'normal' as Level, delay: 0.05, loss: 0.05, stall: { seat: 2, at: 2, silent: false } }],
  ['a guest who goes silent mid-match', { humans: 3, bots: true, seed: 15, level: 'normal' as Level, delay: 0.05, loss: 0.05, stall: { seat: 1, at: 30, silent: true } }],
  ['a host who is cracked early and done watching (its timer runs the match from then on)', { humans: 3, bots: true, seed: 5, level: 'normal' as Level, delay: 0.05, loss: 0.05, hostDone: 80 }],
  ['twenty people and computer eggs to fifty, with lag and lost packets', { humans: 20, bots: true, seed: 41, level: 'normal' as Level, delay: 0.06, loss: 0.08 }],
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
    // with fifty eggs about, the host's guests may crack early: then it hears only a few of their shots
    if (!('stall' in opts)) for (const c of live) assert.ok(c.heard > (c.me.isHost ? 0 : 10), `seat ${c.seat} heard ${c.heard} shots from other clients`);
    if ('hostDone' in opts) {
      const done = live[0];
      assert.ok(done.doneAt > 0, 'the host was done watching');
      assert.equal(host.fighters[host.me].phase, 'out');
      assert.ok(host.time > done.doneAt + 30, `the match ran on long after (${(host.time - done.doneAt).toFixed(0)} s)`);
      assert.ok(host.fighters.some((f) => f.kind === 'bot' && f.phase === 'out' && f.outAt > done.doneAt), 'computer eggs kept fighting');
      assert.ok(done.s.reported && !done.s.early, 'the host reported the result');
      assert.equal(offscreen(done.s, done.me, false, false), false, 'and stopped running the match');
    }
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

  // a trade at the end: a last hit cracks our egg here, but the host had already called it for us
  const t = createMatch({ seed: 2, role: 'guest', level: 'normal', entrants: [{ name: 'a', color: '#fff', kind: 'remote', seat: 0 }, { name: 'b', color: '#fff', kind: 'player', seat: 1 }], me: 1, countdown: 0 });
  for (const f of t.fighters) f.phase = 'ground';
  applyNet(t, { y: 'o', f: 0, by: 1, w: 'smg' });
  applyNet(t, { y: 'd', f: 0, to: 1, d: 300, w: 'grenade', x: 0, z: 0 });
  assert.equal(t.fighters[1].phase, 'out');
  receive(newSession(true), t, { seat: 1, isHost: false, round: 1 }, 0, endOf(1, 1, [[1, 1, 1], [0, 2, 0]]), () => t, 0);
  assert.notEqual(t.fighters[1].phase, 'out', 'the host says we won, so we stand');
  assert.equal(t.fighters[1].place, 1);
  hurt(t, t.fighters[1], 50, -1, 'storm', true);
  assert.notEqual(t.fighters[1].phase, 'out', 'and nothing hurts once it is over');
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

test('done watching early: the card keeps count and holds the next match, the host keeps running the match, and the result still comes', () => {
  const host = hostMatch([{ seat: 0, name: 'p0' }], 0, 6, 'normal', 4, 0);
  const m = host.match;
  const s = newSession(true, host.roster);
  const me: Me = { seat: 0, isHost: true, round: 1 };
  for (const f of m.fighters) land(f, f.id * 6, 0);
  m.time = 5;
  hurt(m, m.fighters[0], 999, -1, 'storm', true);
  m.events.length = 0;
  // pressing done watching
  s.over = true;
  s.early = true;
  let card = resultCard(m, true, true);
  assert.equal(card.title, '5th of 5');
  assert.equal(card.detail, '0 eliminations, 0 damage.');
  assert.equal(card.wait, '4 Eggs Still Going. Play Again Once the Match Ends.', 'the host waits for the end before the next match');
  // a guest's card counts in the detail, and has no next match to hold
  const guest = resultCard(m, true, false);
  assert.equal(guest.detail, '0 eliminations, 0 damage. 4 eggs still going.');
  assert.equal(guest.wait, undefined);
  assert.equal(offscreen(s, me, false, false), true, 'the host runs the match without frames');
  assert.equal(offscreen(s, { ...me, isHost: false, seat: 1 }, false, false), false, 'a guest has nothing to run');
  assert.equal(offscreen(newSession(true), me, true, true), true, 'a hidden tab still runs it too');
  assert.equal(offscreen(newSession(true), me, false, true), false, 'frames do it in a tab on screen');
  const before = m.time;
  catchUp(s, m, 0, 0.5);
  assert.ok(Math.abs(m.time - before - 0.5) < 1e-6);
  catchUp(s, m, 0, 30);
  assert.ok(Math.abs(m.time - before - 2.5) < 1e-6, 'two seconds at most at a time');
  assert.equal(m.events.length, 0, 'whatever happened went to the room');
  // a computer egg cracks: the card counts it
  hurt(m, m.fighters[1], 999, 2, 'smg', false);
  assert.ok(s.queue.length > 0 || m.events.length > 0);
  assert.equal(resultCard(m, true, true).wait, '3 Eggs Still Going. Play Again Once the Match Ends.');
  assert.equal(ending(s, m, me, 10), null);
  // the last egg standing: the host calls it, and after the pause reports it
  for (const f of m.fighters.slice(1, 4)) if (f.phase !== 'out') hurt(m, f, 999, 4, 'smg', false);
  catchUp(s, m, 0, 0.05);
  assert.ok(m.ended && m.winner === 4);
  assert.ok(resultCard(m, true, true).wait, 'still held until the result goes out');
  assert.equal(ending(s, m, me, 20), null);
  assert.equal(ending(s, m, me, 20 + END_PAUSE + 0.1), 'report');
  card = resultCard(m, false, true);
  assert.equal(card.detail, `0 eliminations, 0 damage. ${m.fighters[4].name} won.`);
  assert.equal(card.wait, undefined, 'the next match can start');
  s.reported = true;
  s.early = false;
  assert.equal(ending(s, m, me, 30), null, 'said once');
  assert.equal(offscreen(s, me, false, false), false, 'and the host stops running it');
  // a card that went up normally hears nothing more
  const plain = newSession(true);
  plain.over = true;
  assert.equal(ending(plain, m, me, 40), null);
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
function pair(open = true) {
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
    if (open) openSpot(m);
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

/**
 * A computer egg at the middle of bare grass holding `guns`, and a still egg `dist` meters north that never cracks.
 * `go(seconds, true)` keeps the computer egg where it is too.
 */
function range(level: Level, dist: number, guns: Fighter['guns']) {
  const m = quiet();
  m.level = level;
  const [a, b] = m.fighters;
  openSpot(m);
  land(a, 0, 0);
  land(b, 0, dist);
  autopilot(m, a);
  a.guns = guns;
  a.slot = 0;
  a.ammo.heavy = 400;
  a.ammo.light = 400;
  const shots: number[] = [];
  let hits = 0;
  const go = (seconds: number, pin = false) =>
    run(m, seconds, (evs) => {
      b.hp = 100;
      b.x = 0;
      b.z = dist;
      if (pin) land(a, 0, 0);
      for (const e of evs) {
        if (e.t === 'shot' && e.f === a.id) shots.push(m.time);
        if (e.t === 'hit' && e.f === a.id) hits++;
      }
    });
  return { m, a, b, shots, go, hits: () => hits };
}

test('a computer egg steadies its aim before a scoped shot, and again before the next', () => {
  for (const level of LEVELS) {
    const { shots, go } = range(level, 30, [{ w: 'sniper', r: 0, mag: 4 }, null]);
    go(8);
    assert.ok(shots.length >= 2, `${level}: it fired (${shots.length})`);
    const settle = LEVEL_SPECS[level].settle;
    for (let i = 1; i < shots.length; i++) assert.ok(shots[i] - shots[i - 1] >= 1 / WEAPONS.sniper.rate + settle - 0.02, `${level}: ${shots[i] - shots[i - 1]}`);
  }
});

test('computer eggs miss more the farther off the target is, the easy ones far more than the hard ones', () => {
  const rate = (level: Level, dist: number) => {
    const t = range(level, dist, [{ w: 'scout', r: 0, mag: 10 }, null]);
    t.go(30, true);
    assert.ok(t.shots.length > 10, `${level} at ${dist}: ${t.shots.length} shots`);
    return t.hits() / t.shots.length;
  };
  const hardNear = rate('hard', 12);
  const hardFar = rate('hard', 45);
  const easyFar = rate('easy', 45);
  assert.ok(hardNear > 0.8, `hard up close ${hardNear}`);
  assert.ok(hardFar < hardNear * 0.7, `hard far ${hardFar}`);
  assert.ok(hardFar > 0.15, `hard is still sharp ${hardFar}`);
  assert.ok(easyFar < hardFar * 0.6, `easy far ${easyFar}`);
});

test('a computer egg with a scope and a rifle closes in and fights with the rifle, keeping the scope for far off', () => {
  const guns = (): Fighter['guns'] => [{ w: 'sniper', r: 0, mag: 4 }, { w: 'rifle', r: 0, mag: 30 }];
  const near = range('hard', 25, guns());
  near.go(2);
  assert.equal(near.a.slot, 1, 'the rifle at 25 meters');
  const far = range('hard', 55, guns());
  far.go(1.2);
  assert.equal(far.a.slot, 0, 'the sniper at 55 meters');
  far.go(3);
  assert.ok(Math.hypot(far.a.x, far.a.z - 55) < 50, `it walked in (${Math.hypot(far.a.x, far.a.z - 55)})`);

  // and it won't trade that rifle for a second scope, though it would trade the scope for a better one
  const m = quiet();
  const [a, b] = m.fighters;
  openSpot(m);
  land(a, 0, 0);
  land(b, 100, 100);
  autopilot(m, a);
  a.guns = [{ w: 'scout', r: 2, mag: 10 }, { w: 'rifle', r: 0, mag: 30 }];
  m.loot.set(1, { id: 1, def: { kind: 'gun', w: 'sniper', r: 4 }, x: 0, z: 5, by: -1, at: 0 });
  run(m, 4);
  assert.deepEqual(a.guns.map((g) => g?.w), ['scout', 'rifle']);
  a.guns = [{ w: 'scout', r: 0, mag: 10 }, { w: 'rifle', r: 3, mag: 30 }];
  run(m, 4);
  assert.deepEqual(a.guns.map((g) => g?.w), ['sniper', 'rifle']);
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
  // cornered inside a shipping container, with someone shooting in through its open end
  const c = doorOf(m, 'container', (d) => {
    const [p, q] = [through(d, -2), through(d, 10)];
    return clearLine(m, p.x, p.z, q.x, q.z) && coverAt(m.map, q.x, q.z) < 0;
  });
  const corner = through(c.door, -2);
  land(a, corner.x, corner.z);
  land(b, through(c.door, 10).x, through(c.door, 10).z);
  let pinned = true;
  const hot = (seconds: number) =>
    run(m, seconds, () => {
      a.hitT = 0.25;
      a.hp = 60;
      b.hp = 100;
      if (pinned) land(a, corner.x, corner.z);
    });
  assert.ok(!hot(2).some((e) => e.t === 'wall'), 'no wall shuts it in');
  assert.equal(a.ai!.target, b.id, 'it was fighting');
  assert.equal(buildingAt(m.map, a.x, a.z), c.i, 'still inside');
  pinned = false;
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

test('a computer egg in a farmyard breaks down a wall someone built across its way to the gate', () => {
  const m = quiet(4, 3);
  const [a, b] = m.fighters;
  land(b, 0, 0);
  autopilot(m, a);
  const ai = a.ai!;
  // a farm whose south gate has nothing else round it inside the fence
  const clearAt = (x: number, z: number) => {
    let ok = true;
    solidsNear(m.map, x, z, 3, (_i, s) => {
      if (s.what !== 'fence' && (s.shape === 'circle' ? pushCircle(x, z, 2, s.x, s.z, s.r) : pushBox(x, z, 2, s.x, s.z, s.hw, s.hd))) ok = false;
    });
    return ok;
  };
  const y = m.map.yards.findIndex((yd) => clearAt(yd.x - 1, yd.z + yd.hd - 1.6));
  assert.ok(y >= 0, 'a farm on seed 4');
  const g = m.map.yards[y].gates.find((gt) => gt.oz > 0)!;
  // between the farmhouse and the south fence, with a wall in front of the gate (where one came up in a match)
  land(a, g.x - 2, g.z - 1.8);
  const id = 999;
  m.walls.set(id, makeWall(id, b.id, g.x - 0.74, g.z - 1.4, 0.79, WALL_HP));
  ai.think = 1e9;
  ai.goal = 'roam';
  ai.gx = g.x + 3.5;
  ai.gz = g.z + 28;
  run(m, 12);
  assert.ok(yardAt(m.map, a.x, a.z) !== y, `out of the yard, at (${a.x.toFixed(1)}, ${a.z.toFixed(1)})`);
  assert.ok(!m.walls.has(id), 'through the wall');
});

test('an egg cracked against a wall spills nothing through it, nor under a bed out of reach', () => {
  const m = quiet(3, 2);
  const [, b] = m.fighters;
  openSpot(m);
  // a wall just east of the egg, a bed just west
  const wall = { x: 1, z: 0, hw: 0.25, hd: 5 };
  const bed = { x: -1.8, z: 0, hw: 0.9, hd: 1.1 };
  m.map.solids.push({ shape: 'box', ...wall, what: 'wall', ref: 0 }, { shape: 'box', ...bed, what: 'seat', ref: 0 });
  reindex(m.map);
  land(b, 0.1, 0);
  b.guns = [{ w: 'rifle', r: 2, mag: 10 }, { w: 'shotgun', r: 1, mag: 2 }];
  b.ammo.heavy = 30;
  b.ammo.shells = 10;
  b.items.bandage = 3;
  b.items.medkit = 1;
  b.items.smoothie = 1;
  b.throws.grenade = 2;
  b.throws.jam = 1;
  b.melee = 'pan';
  b.helmet = 2;
  b.vest = 3;
  b.wood = 40;
  hurt(m, b, 500, -1, 'storm', true);
  const drops = m.events.filter((e) => e.t === 'drop').map((e) => (e.t === 'drop' ? e.item : null)!);
  assert.ok(drops.length >= 12, `everything spilled (${drops.length})`);
  for (const l of drops) {
    assert.ok(l.x < wall.x - wall.hw, `nothing through the wall (${l.x}, ${l.z})`);
    assert.ok(Math.abs(l.x - bed.x) >= bed.hw || Math.abs(l.z - bed.z) >= bed.hd, `nothing under the bed (${l.x}, ${l.z})`);
  }
});

test('a computer egg gives up on loot lying where it cannot reach, and goes for the next thing', () => {
  const m = quiet(3, 2);
  const [a] = m.fighters;
  openSpot(m);
  // a legendary gun stuck in the middle of a big rock, and a plain one out on the grass
  m.map.solids.push({ shape: 'circle', x: 0, z: 0, r: 1.6, what: 'rock', ref: 0 });
  reindex(m.map);
  m.loot.set(1, { id: 1, def: { kind: 'gun', w: 'rifle', r: 4 }, x: 0, z: 0, by: -1, at: 0 });
  m.loot.set(2, { id: 2, def: { kind: 'gun', w: 'pistol', r: 0 }, x: -30, z: 0, by: -1, at: 0 });
  land(a, 8, 0);
  autopilot(m, a);
  let lost = -1;
  run(m, 40, () => {
    if (lost < 0 && a.ai!.lost === 1) lost = m.time;
  });
  assert.ok(lost > 0, 'it gave up on the gun in the rock');
  assert.ok(m.loot.has(1), 'which is still there');
  assert.ok(!m.loot.has(2) && a.guns.some((g) => g?.w === 'pistol'), 'and picked up the other one');
});

// ---------------------------------------------------------------------------------------------------------------------
// The kitchen drawer: guns, melee, throwables, barrels, supply drops, scopes and backpacks.

test('a solo match is you and forty-nine computer eggs, each with its own name and color', () => {
  const m = soloMatch(5, 'hard');
  assert.equal(m.fighters.length, 50);
  assert.equal(MAX_FIGHTERS, 50);
  assert.equal(new Set(m.fighters.map((f) => f.name)).size, 50);
  assert.equal(new Set(m.fighters.map((f) => f.color)).size, 50);
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
    // two for each of the first three circles, one for the fourth, apart from each other
    const phases = [0, 0, 1, 1, 2, 2, 3];
    assert.equal(map.drops.length, phases.length);
    for (const [i, a] of map.drops.entries()) for (const b of map.drops.slice(i + 1)) assert.ok(Math.hypot(map.containers[a].x - map.containers[b].x, map.containers[a].z - map.containers[b].z) > 4, `seed ${seed}: drops apart`);
    map.drops.forEach((id, j) => {
      const c = map.containers[id];
      const k = phases[j];
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

test('a helmet and a vest take their cut of bullets, swings and blasts, but not of the storm or hot sauce', () => {
  assert.equal(armorMult(0, 0), 1);
  for (const k of ARMOR_KINDS) for (let lv = 1; lv <= MAX_ARMOR; lv++) assert.ok(ARMOR_CUT[k][lv] > ARMOR_CUT[k][lv - 1] && ARMOR_CUT[k][lv] < 0.5, `${k} ${lv}`);
  assert.ok(Math.abs(armorMult(3, 3) - (1 - ARMOR_CUT.helmet[3]) * (1 - ARMOR_CUT.vest[3])) < 1e-9, 'the two multiply');
  assert.ok(armorMult(3, 3) > 0.5, 'the best of both still lets more than half through');
  assert.equal(armorMult(9, -1), armorMult(3, 0), 'levels are clamped');
  const m = quiet();
  const [a, b] = m.fighters;
  openSpot(m);
  land(a, 0, 0);
  land(b, 0, 6);
  b.helmet = 2;
  b.vest = 3;
  const cut = (d: number) => Math.round(d * armorMult(2, 3) * 10) / 10;
  for (const [d, w] of [[40, 'rifle'], [50, 'cleaver'], [80, 'grenade'], [60, 'barrel'], [52, 'launcher']] as const) {
    b.hp = 100;
    assert.equal(hurt(m, b, d, a.id, w, false), cut(d), w);
    assert.ok(Math.abs(b.hp - (100 - cut(d))) < 1e-9);
  }
  b.hp = 100;
  assert.equal(hurt(m, b, 7, -1, 'storm', true), 7, 'the storm goes straight through');
  assert.equal(hurt(m, b, 6, a.id, 'sauce', false), 6, 'so does hot sauce');
  // the shield soaks what the armor lets through
  b.hp = 100;
  b.shield = 10;
  hurt(m, b, 40, a.id, 'rifle', false);
  assert.equal(b.shield, 0);
  assert.ok(Math.abs(b.hp - (100 - (cut(40) - 10))) < 1e-9);
  // a real shot reports what was fired and what landed
  b.hp = 100;
  b.shield = 0;
  a.guns[0] = { w: 'pistol', r: 0, mag: 14 };
  a.slot = 0;
  a.input.aim = 0;
  a.input.fire = true;
  const hit = run(m, 0.15).find((e) => e.t === 'hit');
  a.input.fire = false;
  assert.ok(hit && hit.t === 'hit' && hit.to === b.id);
  assert.equal(hit.d, Math.round(damageOf('pistol', 0)));
  assert.equal(hit.took, armored(hit.d, 'pistol', false, b));
  assert.ok(hit.took < hit.d);
  assert.equal(a.dealt, hit.took, 'credit for what landed');
  assert.ok(Math.abs(b.hp - (100 - hit.took)) < 1e-9);
});

test('a better helmet or vest goes on as you walk over it and the old one drops; a worse one waits for the key', () => {
  const m = quiet();
  const me = m.fighters[0];
  openSpot(m);
  land(me, 0, 0);
  const put = (id: number, def: LootDef) => m.loot.set(id, { id, def, x: me.x, z: me.z, by: -1, at: 0 });
  put(1, { kind: 'helmet', lv: 1 });
  put(2, { kind: 'vest', lv: 2 });
  run(m, 0.05);
  assert.equal(me.helmet, 1);
  assert.equal(me.vest, 2);
  assert.equal(m.loot.size, 0);
  put(3, { kind: 'helmet', lv: 3 });
  const evs = run(m, 0.05);
  assert.equal(me.helmet, 3);
  const old = evs.find((e) => e.t === 'drop');
  assert.ok(old && old.t === 'drop' && old.item.def.kind === 'helmet' && old.item.def.lv === 1 && old.item.by === me.id, 'the colander comes off');
  run(m, 3.5);
  assert.equal(me.helmet, 3, 'and stays off');
  m.loot.clear();
  put(4, { kind: 'vest', lv: 1 });
  run(m, 0.2);
  assert.equal(me.vest, 2, 'a worse apron stays where it is');
  assert.ok(m.loot.has(4));
  assert.ok(!wants(me, { kind: 'vest', lv: 1 }, false) && wants(me, { kind: 'vest', lv: 1 }, true) && !wants(me, { kind: 'vest', lv: 2 }, true) && wants(me, { kind: 'vest', lv: 3 }, false));
  const p = prompt(m, me);
  assert.ok(p && 'item' in p && p.item.id === 4 && p.swap, 'the key offers a swap');
  assert.equal(lootName(p.item.def), 'apron (level 1 vest)');
  me.input.interact = true;
  const swapped = run(m, DT);
  assert.equal(me.vest, 1);
  assert.ok(swapped.some((e) => e.t === 'drop' && e.item.def.kind === 'vest' && e.item.def.lv === 2 && e.item.by === me.id), 'the quilted apron goes down');
  assert.ok(!m.loot.has(4));
  run(m, 3.5);
  assert.equal(me.vest, 1, 'what we took off is not put straight back on');
  const back = prompt(m, me);
  assert.ok(back && 'item' in back && back.item.def.kind === 'vest' && back.swap, 'but the key will');
});

test('a computer egg goes for better armor and puts it on, and leaves what is no better than its own', () => {
  const m = quiet();
  const [a, b] = m.fighters;
  openSpot(m);
  land(a, 0, 0);
  land(b, 100, 100);
  autopilot(m, a);
  a.guns = [{ w: 'rifle', r: 1, mag: 30 }, null];
  a.slot = 0;
  a.helmet = 1;
  m.loot.set(1, { id: 1, def: { kind: 'helmet', lv: 1 }, x: 0, z: 5, by: -1, at: 0 });
  m.loot.set(2, { id: 2, def: { kind: 'vest', lv: 2 }, x: 0, z: 11, by: -1, at: 0 });
  m.loot.set(3, { id: 3, def: { kind: 'helmet', lv: 3 }, x: 6, z: 11, by: -1, at: 0 });
  run(m, 12);
  assert.equal(a.vest, 2);
  assert.equal(a.helmet, 3);
  assert.ok(m.loot.has(1), 'the spare colander is left where it lies');
  assert.ok(!m.loot.has(2) && !m.loot.has(3));
});

test('an egg’s helmet and vest travel with its state, within bounds, and show on everyone else’s screen', () => {
  const m = quiet();
  const f = m.fighters[0];
  land(f, 1, 2);
  f.helmet = 2;
  f.vest = 3;
  const s = stateOf(f);
  assert.equal(s.helmet, 2);
  assert.equal(s.vest, 3);
  assert.deepEqual(parsePacket(JSON.parse(JSON.stringify(guestState(1, s)))), { k: 's', round: 1, state: s, watch: -1 });
  for (const bad of [{ ...s, helmet: MAX_ARMOR + 1 }, { ...s, vest: -1 }, { ...s, helmet: 1.5 }, { ...s, vest: MAX_ARMOR + 1 }, { ...s, r: MAX_RARITY + 1 }]) assert.equal(parsePacket(guestState(1, bad)), null, JSON.stringify(bad));
  const packed = guestState(1, s);
  assert.equal(parsePacket({ ...packed, c: packed.c.slice(0, 9) }), null, 'a report cut short is no report');
  const g = createMatch({ seed: 2, role: 'guest', level: 'normal', entrants: [{ name: 'h', color: '#fff', kind: 'remote', seat: 0 }, { name: 'a', color: '#fff', kind: 'player', seat: 1 }], me: 1, countdown: 0 });
  applyState(g, g.fighters[0], s);
  assert.equal(g.fighters[0].helmet, 2);
  assert.equal(g.fighters[0].vest, 3);
  for (const bad of [{ kind: 'helmet', lv: 4 }, { kind: 'vest', lv: 0 }, { kind: 'helmet' }]) assert.equal(parseLoot(bad), null, JSON.stringify(bad));
  assert.deepEqual(parseLoot({ kind: 'vest', lv: 3 }), { kind: 'vest', lv: 3 });
});

test('online, a guest that walks over two better helmets ends up in the best, and keeps a worse one off unless it asks', () => {
  const { h, g, toHost, toGuest } = pair();
  const mine = g.fighters[1];
  mine.helmet = 1;
  for (const m of [h, g]) {
    m.loot.set(1, { id: 1, def: { kind: 'helmet', lv: 3 }, x: 0, z: 0, by: -1, at: 0 });
    m.loot.set(2, { id: 2, def: { kind: 'helmet', lv: 2 }, x: 0.4, z: 0, by: -1, at: 0 });
  }
  // both asked for before the host answers either: the stockpot goes on, the saucepan goes back down
  step(g, DT);
  assert.deepEqual([...mine.pending.keys()].sort(), [1, 2]);
  toHost();
  toGuest();
  assert.equal(mine.helmet, 3);
  const down = [...g.loot.values()].map((l) => l.def.kind === 'helmet' && l.def.lv).sort();
  assert.deepEqual(down, [1, 2], 'the colander came off and the saucepan stayed off');
  toHost();
  assert.deepEqual([...h.loot.values()].map((l) => l.def.kind === 'helmet' && l.def.lv).sort(), [1, 2], 'and the host sees both on the ground');
  // asked for with the key, a worse one goes on
  for (let i = 0; i < 3.2 / DT; i++) step(g, DT);
  g.events.length = 0;
  const pan = [...g.loot.values()].find((l) => l.def.kind === 'helmet' && l.def.lv === 2)!;
  pan.x = mine.x;
  pan.z = mine.z;
  mine.input.interact = true;
  step(g, DT);
  mine.input.interact = false;
  assert.ok(mine.pending.has(pan.id) && mine.keyAsk === pan.id);
  toHost();
  toGuest();
  assert.equal(mine.helmet, 2);
});

test('online, a guest’s armor takes its cut of the host’s shots on the guest’s own screen, and the host’s numbers allow for it', () => {
  const { h, g, hs, hMe, toGuest } = pair();
  const mine = g.fighters[1];
  mine.helmet = 3;
  mine.vest = 3;
  // the host hears what the guest wears
  receive(hs, h, hMe, 1, JSON.parse(JSON.stringify(guestState(1, stateOf(mine)))), () => h, 0.1);
  assert.equal(h.fighters[1].helmet, 3);
  assert.equal(h.fighters[1].vest, 3);
  // and shoots west at it
  const host = h.fighters[0];
  host.guns[0] = { w: 'rifle', r: 0, mag: 30 };
  host.slot = 0;
  host.input.aim = -Math.PI / 2;
  host.input.fire = true;
  let hit: Ev | undefined;
  for (let i = 0; i < 30 && !hit; i++) {
    step(h, DT);
    hit = h.events.find((e) => e.t === 'hit');
  }
  host.input.fire = false;
  assert.ok(hit && hit.t === 'hit' && !hit.local && hit.to === 1);
  assert.equal(hit.d, Math.round(damageOf('rifle', 0)), 'sent as fired');
  assert.equal(hit.took, armored(hit.d, 'rifle', false, h.fighters[1]));
  assert.ok(hit.took < hit.d);
  assert.equal(host.dealt, hit.took);
  toGuest();
  assert.ok(Math.abs(mine.hp - (100 - hit.took)) < 1e-9, `the guest took the cut hit (${mine.hp})`);
  // the same hit on a bare egg lands in full
  const bare = pair();
  bare.h.events.length = 0;
  applyNet(bare.g, { y: 'd', f: 0, to: 1, d: hit.d, w: 'rifle', x: 0, z: 0 });
  assert.equal(bare.g.fighters[1].hp, 100 - hit.d);
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

test('dirt roads put a spring in your step', () => {
  const m = quiet();
  const a = m.fighters[0];
  openSpot(m);
  m.map.roads = [{ x0: -30, z0: 0, x1: 30, z1: 0 }];
  land(a, -20, 0);
  a.input.mx = 1;
  run(m, 0.5);
  assert.ok(roadAt(m.map, a.x, a.z));
  assert.ok(Math.abs(Math.hypot(a.vx, a.vz) - SPEED * MELEE.spatula.move * ROAD_SPEED) < 0.05, 'on the road');
  land(a, -20, 6);
  run(m, 0.5);
  assert.ok(Math.abs(Math.hypot(a.vx, a.vz) - SPEED * MELEE.spatula.move) < 0.05, 'beside it');
});

test('a campfire heals whoever stands by it a little at a time, up to full, on its owner’s client', () => {
  const m = quiet();
  const [a, b] = m.fighters;
  openSpot(m);
  m.map.fires = [{ x: 0, z: 0, r: CAMP.pit }];
  land(a, 1.8, 0);
  land(b, CAMP.r + 1, 0);
  a.hp = 50;
  b.hp = 50;
  run(m, 2);
  assert.ok(a.warm && !b.warm);
  assert.ok(Math.abs(a.hp - (50 + CAMP.hps * 2)) < 0.2, `${a.hp}`);
  assert.equal(b.hp, 50, 'a step too far');
  run(m, 30);
  assert.equal(a.hp, HP_MAX, 'all the way to full');
  // nobody walks into the fire itself
  a.input.mx = -1;
  run(m, 1);
  assert.ok(Math.hypot(a.x, a.z) >= CAMP.pit + FIGHTER_R - 0.01, 'stopped at the fire pit');

  // someone else's egg is healed by its owner, and only shows as warming up here
  const g = createMatch({ seed: 7, role: 'guest', level: 'normal', entrants: [{ name: 'g', color: '#fff', kind: 'player', seat: 1 }, { name: 'h', color: '#fff', kind: 'remote', seat: 0 }], me: 0, countdown: 0 });
  g.time = 5;
  openSpot(g);
  g.map.fires = [{ x: 0, z: 0, r: CAMP.pit }];
  const r = g.fighters[1];
  applyState(g, r, { x: 1.8, z: 0, y: 0, aim: 0, vx: 0, vz: 0, phase: 'ground', hp: 40, shield: 0, w: null, r: 0, flags: 0 });
  run(g, 2);
  assert.ok(r.warm);
  assert.equal(r.hp, 40, 'until its owner says otherwise');
});

test('a bounce pad throws an egg up for a glide the way its arrow points, out of reach of everything until it lands', () => {
  const m = quiet();
  const [a, b] = m.fighters;
  openSpot(m);
  m.map.pads = [{ x: 0, z: 0, dx: 1, dz: 0 }];
  land(a, -3, 0);
  land(b, -3, 6);
  a.hp = 60;
  a.items.bandage = 3;
  a.input.mx = 1;
  let evs = run(m, 0.6);
  assert.ok(evs.some((e) => e.t === 'bounce' && e.f === a.id));
  assert.equal(a.phase, 'drop');
  assert.ok(a.y > PAD.y - FALL * 0.6 - 0.5, `up high: ${a.y}`);
  assert.equal(hurt(m, a, 50, b.id, 'smg', false), 0, 'nothing hits an egg in the air');
  a.input.use = 'bandage';
  run(m, 0.1);
  assert.equal(a.using, null, 'nor does it patch up up there');
  // let go of the stick: the glide carries on along the arrow
  a.input.mx = 0;
  evs = [];
  for (let t = 0; t < 6 && a.phase !== 'ground'; t += DT) evs.push(...run(m, DT));
  assert.equal(a.phase, 'ground');
  assert.ok(evs.some((e) => e.t === 'land' && e.f === a.id));
  assert.ok(Math.abs(a.x - PAD_FLY) < PAD_FLY * 0.2 && Math.abs(a.z) < 0.5, `landed ${a.x.toFixed(1)}, ${a.z.toFixed(1)} (about ${PAD_FLY} m on)`);
  // steering takes it wherever you like, as off the bus
  land(a, -3, 0);
  a.input.mx = 1;
  for (let t = 0; t < 2 && a.phase === 'ground'; t += DT) run(m, DT);
  a.input.mx = 0;
  a.input.mz = 1;
  for (let t = 0; t < 6 && a.phase !== 'ground'; t += DT) run(m, DT);
  assert.ok(a.z > 25 && a.x < 15, `steered off to ${a.x.toFixed(1)}, ${a.z.toFixed(1)}`);
});

test('a guest gliding off a bounce pad long after the bus is not taken for one that stopped playing', () => {
  const { h, g, hs, hMe } = pair();
  for (const m of [h, g]) {
    m.time = m.map.bus.off + 60;
    m.map.pads = [{ x: 0, z: 0, dx: 0, dz: 1 }];
  }
  const mine = g.fighters[1];
  land(mine, 0, -3);
  mine.input.mz = 1;
  const evs = run(g, 0.6);
  assert.ok(evs.some((e) => e.t === 'bounce' && e.f === 1) && mine.phase === 'drop');
  receive(hs, h, hMe, 1, JSON.parse(JSON.stringify(guestState(1, stateOf(mine)))), () => h, 0.1);
  const r = h.fighters[1];
  assert.equal(r.phase, 'drop');
  assert.ok(h.events.some((e) => e.t === 'bounce' && e.f === 1 && e.net), 'the host sees it go up');
  tick(hs, h, hMe, [0, 1], 0.2);
  assert.notEqual(r.phase, 'out');
  // one that hangs up there far longer than a glide takes has stopped playing
  h.time += BUS_Y / FALL + 9;
  receive(hs, h, hMe, 1, JSON.parse(JSON.stringify(guestState(1, stateOf(mine)))), () => h, 0.3);
  tick(hs, h, hMe, [0, 1], 0.4);
  assert.equal(r.phase, 'out');
});

test('fridges open like chests and hold food and healing; toilets and hay bales break like crates', () => {
  const m = quiet(9);
  const me = m.fighters[0];
  for (const seed of [1, 2, 3]) {
    for (const c of generateMap(seed).containers) {
      if (c.kind !== 'fridge') continue;
      assert.equal(c.loot.length, 2);
      assert.ok(c.loot.every((l) => l.def.kind === 'use') && c.loot[0].def.kind === 'use' && c.loot[1].def.kind === 'use' && c.loot[0].def.w !== c.loot[1].def.w, 'two different things to eat or patch up with');
    }
  }
  const fridge = m.map.containers.find((c) => c.kind === 'fridge')!;
  land(me, fridge.x, fridge.z + fridge.face * 1.4);
  m.loot.clear();
  const p = prompt(m, me);
  assert.ok(p && 'chest' in p && p.chest === fridge.id);
  me.input.aim = fridge.face > 0 ? Math.PI : 0;
  me.input.fire = true;
  run(m, 1);
  assert.ok(!m.opened[fridge.id], 'it opens, it does not break');
  me.input.fire = false;
  me.input.interact = true;
  run(m, 0.05);
  assert.ok(m.opened[fridge.id]);
  assert.ok(fridge.loot.every((l) => m.loot.has(l.id) || m.gone.has(l.id)), 'out it comes');

  // a guest asks the host to open one, as with a chest
  const h = quiet(9);
  assert.equal(applyNet(h, { y: 'op', f: 1, c: fridge.id }), false);
  assert.ok(h.opened[fridge.id]);
  assert.ok(h.events.some((e) => e.t === 'opened' && e.c === fridge.id && !e.net));
  // but a toilet or a hay bale only breaks
  const toilet = h.map.containers.find((c) => c.kind === 'toilet')!;
  const hay = h.map.containers.find((c) => c.kind === 'hay')!;
  applyNet(h, { y: 'op', f: 1, c: toilet.id });
  applyNet(h, { y: 'op', f: 1, c: hay.id });
  assert.ok(!h.opened[toilet.id] && !h.opened[hay.id]);
  applyNet(h, { y: 'm', f: 1, k: 'crate', id: toilet.id, d: TOILET_HP - 1 });
  assert.ok(!h.opened[toilet.id]);
  applyNet(h, { y: 'm', f: 1, k: 'crate', id: toilet.id, d: 1 });
  assert.ok(h.opened[toilet.id], 'flushed');
  assert.ok(toilet.loot.length >= 1 && toilet.loot.every((l) => h.loot.has(l.id)), 'and whatever was in it spills out');

  // two smacks of the spatula break a hay bale
  const a = m.fighters[0];
  land(a, hay.x - (HAY_HW + 1.2), hay.z);
  a.slot = SLOT_MELEE;
  a.fireT = 0;
  a.input.aim = Math.PI / 2;
  a.input.fire = true;
  run(m, 0.1);
  assert.ok(!m.opened[hay.id]);
  run(m, 0.6);
  assert.ok(m.opened[hay.id], 'the bale comes apart');
});

test('cars and lamp posts stop bullets; fences, picnic tables and fire pits only stop your feet', () => {
  const m = quiet();
  const [a] = m.fighters;
  openSpot(m);
  m.map.solids = [
    { shape: 'box', x: 6, z: 0, hw: 0.55, hd: 1.1, what: 'car', ref: 0 },
    { shape: 'circle', x: -6, z: 0, r: 0.18, what: 'post', ref: 0 },
    { shape: 'box', x: 0, z: 6, hw: 3, hd: FENCE_T / 2, what: 'fence', ref: 0 },
    { shape: 'box', x: 0, z: -6, hw: 1.1, hd: 0.8, what: 'table', ref: 0 },
    { shape: 'circle', x: 6, z: 6, r: CAMP.pit, what: 'fire', ref: 0 },
  ];
  reindex(m.map);
  assert.equal(castRay(m, 0, 0, 1, 0, 20, -1, true)?.what, 'car');
  assert.equal(castRay(m, 0, 0, -1, 0, 20, -1, true)?.what, 'post');
  for (const [dx, dz] of [[0, 1], [0, -1], [Math.SQRT1_2, Math.SQRT1_2]]) {
    assert.equal(castRay(m, 0, 0, dx, dz, 20, -1, true), null, 'bullets fly over');
    assert.ok(castRay(m, 0, 0, dx, dz, 20, -1, true, true), 'feet and swings do not');
  }
  assert.ok(clearLine(m, 0, 0, 0, 12) && !clearLine(m, 0, 0, 12, 0), 'you can see over a fence, not through a car');
  // walking into each stops you at it
  for (const [x, z, mx, mz] of [[0, 3, 0, 1], [0, -3, 0, -1], [3, 0, 1, 0], [3.5, 3.5, 1, 1]]) {
    land(a, x, z);
    a.input.mx = mx;
    a.input.mz = mz;
    run(m, 1.2);
    let inside = false;
    for (const s of m.map.solids) if (s.shape === 'circle' ? pushCircle(a.x, a.z, FIGHTER_R - 0.02, s.x, s.z, s.r) : pushBox(a.x, a.z, FIGHTER_R - 0.02, s.x, s.z, s.hw, s.hd)) inside = true;
    assert.ok(!inside && Math.hypot(a.x - x, a.z - z) < 5, `stopped walking from ${x},${z}: at ${a.x.toFixed(2)},${a.z.toFixed(2)}`);
  }
  a.input.mx = 0;
  a.input.mz = 0;
  // and a bullet from one side of a fence finds an egg on the other
  const b = m.fighters[1];
  land(a, 0, 3);
  land(b, 0, 10);
  a.guns[0] = { w: 'rifle', r: 0, mag: 30 };
  a.slot = 0;
  a.input.aim = 0;
  a.input.fire = true;
  run(m, 0.3);
  assert.ok(b.hp < HP_MAX, 'shot over the fence');
});

/** A bridge's two ends, a little in from each end of its deck (or out past them, when `inset` is below zero). */
function deckEnds(br: { x: number; z: number; hw: number; hd: number; alongX: boolean }, inset: number) {
  const ax = br.alongX ? 1 : 0;
  const az = 1 - ax;
  const h = (br.alongX ? br.hw : br.hd) - inset;
  return [
    { x: br.x - ax * h, z: br.z - az * h },
    { x: br.x + ax * h, z: br.z + az * h },
  ];
}

test('a river winds from shore to shore with three to five bridges over it, and nothing but a bridge stands in the water', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const m = generateMap(seed);
    const [a, b] = [m.river[0], m.river[m.river.length - 1]];
    const onEdge = (p: { x: number; z: number }) => Math.abs(Math.abs(p.x) - HALF) < 0.2 || Math.abs(Math.abs(p.z) - HALF) < 0.2;
    assert.ok(onEdge(a) && onEdge(b) && Math.hypot(a.x - b.x, a.z - b.z) > 2 * HALF - 1, `seed ${seed}: shore to shore across the island`);
    let len = 0;
    for (let i = 1; i < m.river.length; i++) len += Math.hypot(m.river[i].x - m.river[i - 1].x, m.river[i].z - m.river[i - 1].z);
    assert.ok(len > 2 * HALF * 1.05, `seed ${seed}: it winds (${len.toFixed(0)} m)`);
    assert.ok(m.bridges.length >= 3 && m.bridges.length <= 5, `seed ${seed}: ${m.bridges.length} bridges`);
    const dry = (x: number, z: number, r = 0) => riverDist2(m, x, z) >= (RIVER_HALF + r) * (RIVER_HALF + r);
    for (const br of m.bridges) {
      const [e0, e1] = deckEnds(br, 0.3);
      assert.ok(dry(e0.x, e0.z) && dry(e1.x, e1.z), `seed ${seed}: both ends of a bridge on the bank`);
      assert.equal(riverCrossings(m, e0.x, e0.z, e1.x, e1.z) % 2, 1, 'and the river in between');
      assert.equal(Math.min(br.hw, br.hd), BRIDGE_HALF);
      assert.ok(!waterAt(m, br.x, br.z) && bridgeAt(m, br.x, br.z) >= 0, 'nobody wades on the deck');
      // two bridges on one bend would be one too many
      for (const o of m.bridges) if (o !== br) assert.ok(Math.hypot(o.x - br.x, o.z - br.z) >= 45);
    }
    // everything built or grown stays out of the water
    const boxDry = (x: number, z: number, hw: number, hd: number) => {
      for (let u = -1; u <= 1; u += 0.25) for (let v = -1; v <= 1; v += 0.25) if (!dry(x + u * hw, z + v * hd)) return false;
      return true;
    };
    for (const bd of m.buildings) assert.ok(boxDry(bd.x, bd.z, bd.w / 2, bd.d / 2), `seed ${seed}: a ${bd.kind} in the river`);
    for (const y of [...m.yards, ...m.fields]) assert.ok(boxDry(y.x, y.z, y.hw, y.hd), `seed ${seed}: a farm in the river`);
    for (const p of m.ponds) assert.ok(dry(p.x, p.z, p.r), 'a pond runs into it');
    const things = [...m.trees, ...m.rocks, ...m.bushes, ...m.containers.filter((c) => !c.flare), ...m.floor, ...m.cars, ...m.lamps, ...m.mailboxes, ...m.tables, ...m.fires, ...m.pads, ...m.logs, ...m.stumps];
    for (const t of things) assert.ok(dry(t.x, t.z, 0.4), `seed ${seed}: something at ${t.x},${t.z} in the river`);
    // roads come down to a bridge, never into the water
    for (const r of m.roads) {
      const l = Math.hypot(r.x1 - r.x0, r.z1 - r.z0);
      for (let k = 0; k <= l; k += 1) {
        const x = r.x0 + ((r.x1 - r.x0) * k) / l;
        const z = r.z0 + ((r.z1 - r.z0) * k) / l;
        assert.ok(dry(x, z, 0.5) || bridgeAt(m, x, z) >= 0, `seed ${seed}: a road into the river at ${x.toFixed(1)},${z.toFixed(1)}`);
      }
    }
    assert.ok(m.roads.some((r) => m.bridges.some((br) => deckEnds(br, 0).some((e) => Math.hypot(e.x - r.x0, e.z - r.z0) < 0.2))), `seed ${seed}: a road leads to a bridge`);
    // and with no wading, a bridge takes you from one bank to the other
    for (const br of m.bridges) {
      const [e0, e1] = deckEnds(br, -2);
      const w = walkable(m, Math.min(e0.x, e1.x) - 6, Math.min(e0.z, e1.z) - 6, Math.max(e0.x, e1.x) + 6, Math.max(e0.z, e1.z) + 6, { from: e0, dry: true });
      assert.ok(w(e1.x, e1.z, 0.5), `seed ${seed}: over the bridge at ${br.x},${br.z}`);
    }
  }
});

test('wading the river is as slow as a pond, a bridge is no slower than grass, and its rails only stop your feet', () => {
  const m = quiet();
  const [a, b] = m.fighters;
  openSpot(m);
  // a river along x, and a bridge over it along z
  m.map.river = [
    { x: -HALF, z: 0 },
    { x: HALF, z: 0 },
  ];
  m.map.bridges = [{ x: 0, z: 0, hw: BRIDGE_HALF, hd: RIVER_HALF + 2, alongX: false }];
  m.map.solids = [-1, 1].map((k) => ({ shape: 'box' as const, x: k * (BRIDGE_HALF - FENCE_T / 2), z: 0, hw: FENCE_T / 2, hd: RIVER_HALF + 2, what: 'fence' as const, ref: 0 }));
  reindex(m.map);
  land(a, 20, -RIVER_HALF - 1);
  a.input.mz = 1;
  run(m, 0.5);
  assert.ok(a.wet && riverAt(m.map, a.x, a.z));
  assert.ok(Math.abs(Math.hypot(a.vx, a.vz) - SPEED * MELEE.spatula.move * POND_SLOW) < 0.05, 'wading');
  land(a, 0, -RIVER_HALF - 3);
  run(m, 0.6);
  assert.ok(!a.wet && bridgeAt(m.map, a.x, a.z) >= 0, 'up on the deck');
  assert.ok(Math.abs(Math.hypot(a.vx, a.vz) - SPEED * MELEE.spatula.move) < 0.05, 'at a walk');
  // the rails keep you on the deck, but a shot goes over them
  a.input.mz = 0;
  a.input.mx = 1;
  run(m, 1);
  assert.ok(a.x < BRIDGE_HALF - FENCE_T, `held by the rail (${a.x.toFixed(2)})`);
  a.input.mx = 0;
  land(a, 0, 0);
  land(b, 8, 0);
  a.guns[0] = { w: 'rifle', r: 0, mag: 30 };
  a.slot = 0;
  a.input.aim = Math.PI / 2;
  a.input.fire = true;
  run(m, 0.3);
  assert.ok(b.hp < HP_MAX, 'shot over the rail at an egg in the water');
  // water hides nobody
  assert.ok(b.wet && !concealed(m, b, a));
});

test('furniture: counters, shelves and sacks stop eggs and bullets, beds, tables and booths only feet, rugs and chairs nothing', () => {
  for (let seed = 1; seed <= 10; seed++) {
    const m = generateMap(seed);
    const kinds = new Set(m.furniture.map((f) => f.kind));
    for (const k of ['rug', 'chair', 'table', 'bed', 'counter', 'shelf'] as const) assert.ok(kinds.has(k), `seed ${seed}: a ${k} somewhere`);
    for (const [i, f] of m.furniture.entries()) {
      const b = m.buildings[f.b];
      assert.ok(Math.abs(f.x - b.x) + f.hw <= b.w / 2 && Math.abs(f.z - b.z) + f.hd <= b.d / 2, `seed ${seed}: a ${f.kind} sticks out of its ${b.kind}`);
      const solid = m.solids.find((s) => (s.what === 'shelf' || s.what === 'seat') && s.ref === i);
      assert.equal(solid?.what ?? null, furnitureSolid(f.kind), `a ${f.kind}`);
    }
    // every house and farmhouse is furnished; a warehouse has racks
    for (const b of m.buildings) {
      const mine = m.furniture.filter((f) => m.buildings[f.b] === b);
      const has = (k: string) => mine.some((f) => f.kind === k);
      if (b.kind === 'house' || b.kind === 'farm') assert.ok(has('table') && has('rug') && has('counter'), `seed ${seed}: a ${b.kind} with a table and a kitchen counter`);
      if (b.kind === 'warehouse') assert.ok(has('shelf'), `seed ${seed}: racks in a warehouse`);
      if (b.kind === 'diner') assert.ok(mine.filter((f) => f.kind === 'booth').length === 4 && has('counter') && has('stool'), `seed ${seed}: booths and a counter in a diner`);
      if (b.kind === 'mill') assert.ok(has('millstone') && has('sacks'), `seed ${seed}: a millstone and flour sacks`);
    }
  }
  const m = quiet();
  openSpot(m);
  m.map.solids = [
    { shape: 'box', x: 4, z: 0, hw: 0.3, hd: 1.5, what: 'shelf', ref: 0 },
    { shape: 'box', x: -4, z: 0, hw: 1, hd: 0.75, what: 'seat', ref: 1 },
  ];
  reindex(m.map);
  assert.equal(castRay(m, 0, 0, 1, 0, 10, -1, true)?.what, 'shelf', 'a shelf stops a bullet');
  assert.equal(castRay(m, 0, 0, -1, 0, 10, -1, true), null, 'it flies over a bed');
  assert.ok(castRay(m, 0, 0, -1, 0, 10, -1, true, true), 'but feet stop at it');
  assert.ok(!clearLine(m, 0, 0, 8, 0) && clearLine(m, 0, 0, -8, 0), 'nobody sees through a shelf');
});

test('every island has a diner and a windmill (now and then a second of one), each going by its own name, with good loot', () => {
  let diners = 0;
  let mills = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const m = generateMap(seed);
    const own = m.buildings.filter((b) => b.kind === 'diner' || b.kind === 'mill').map((b) => m.places[placeAt(m, b.x, b.z)]?.name);
    assert.equal(new Set(own).size, own.length, `seed ${seed}: never two of one name`);
    for (const b of m.buildings) {
      if (b.kind !== 'diner' && b.kind !== 'mill') continue;
      const p = placeAt(m, b.x, b.z);
      assert.ok(p >= 0, `seed ${seed}: a ${b.kind} is somewhere with a name`);
      assert.ok((b.kind === 'diner' ? DINER_NAMES : MILL_NAMES).includes(m.places[p].name), `seed ${seed}: the ${b.kind} is called ${m.places[p].name}`);
      const inside = m.containers.filter((c) => Math.abs(c.x - b.x) < b.w / 2 && Math.abs(c.z - b.z) < b.d / 2);
      if (b.kind === 'diner') {
        diners++;
        assert.equal(inside.filter((c) => c.kind === 'fridge').length, 2, 'a fridge stash');
        assert.equal(inside.filter((c) => c.kind === 'chest').length, 1);
      } else {
        mills++;
        const chest = inside.find((c) => c.kind === 'chest');
        assert.ok(chest && chest.loot.some((l) => l.def.kind === 'gun' && l.def.r >= 2), 'a chest of rare or better');
      }
    }
  }
  assert.ok(diners >= 40 && mills >= 40 && diners + mills > 90 && diners + mills < 120, `${diners} diners and ${mills} windmills in 40 islands`);
});

test('fallen logs and stumps lie out in the open, stop feet but not bullets, and give wood like a tree; trees come in four kinds', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const m = generateMap(seed);
    assert.ok(m.logs.length >= 8 && m.stumps.length >= 12, `seed ${seed}: ${m.logs.length} logs, ${m.stumps.length} stumps`);
    const indoors = (x: number, z: number, r: number) => m.buildings.some((b) => Math.abs(x - b.x) < b.w / 2 + r && Math.abs(z - b.z) < b.d / 2 + r) || m.yards.some((y) => Math.abs(x - y.x) < y.hw + r && Math.abs(z - y.z) < y.hd + r);
    for (const l of m.logs) {
      assert.ok(!indoors(l.x, l.z, Math.max(l.hw, l.hd)) && !roadAt(m, l.x, l.z) && !roadAt(m, l.x + l.hw, l.z + l.hd) && !roadAt(m, l.x - l.hw, l.z - l.hd), `seed ${seed}: a log in the way at ${l.x},${l.z}`);
      assert.ok(walkable(m, l.x - 8, l.z - 8, l.x + 8, l.z + 8)(l.x, l.z, Math.max(l.hw, l.hd) + 1.2), 'and you can walk up to it');
    }
    for (const t of m.stumps) assert.ok(!indoors(t.x, t.z, 1) && !roadAt(m, t.x, t.z));
    const kinds = new Set(m.trees.map((t) => t.kind));
    assert.deepEqual([...kinds].sort(), ['birch', 'fruit', 'oak', 'pine'], `seed ${seed}: oaks, pines, birches and fruit trees`);
    // the fruit trees stand in orchards beside the farms
    for (const t of m.trees) if (t.kind === 'fruit') assert.ok(m.yards.some((y) => Math.abs(t.x - y.x) < y.hw + 16 && Math.abs(t.z - y.z) < y.hd + 16), 'an orchard by a farm');
  }
  const m = quiet();
  const a = m.fighters[0];
  openSpot(m);
  m.map.solids = [{ shape: 'box', x: 2, z: 0, hw: LOG_R, hd: 2, what: 'log', ref: 0 }];
  reindex(m.map);
  assert.equal(castRay(m, 0, 0, 1, 0, 10, -1, true), null, 'bullets fly over a log');
  land(a, 0.5, 0);
  a.slot = SLOT_MELEE;
  a.wood = 0;
  a.input.aim = Math.PI / 2;
  a.input.fire = true;
  run(m, 0.2);
  assert.ok(a.wood > 0, 'wood from a fallen log');
  a.input.fire = false;
  a.input.mx = 1;
  run(m, 1);
  assert.ok(a.x < 2 - LOG_R - FIGHTER_R + 0.02, 'and it stops your feet');
});

/** A computer egg alone on the island with everything else put out of the way: the other egg hangs in the sky. */
function alone(m: Match) {
  const [a, b] = m.fighters;
  b.phase = 'drop';
  b.y = 1e9;
  autopilot(m, a);
  a.ai!.goal = 'roam';
  return a;
}

/** A spot `d` meters from (x, z) on open, dry ground, outside every building and farmyard, or null. */
function startNear(m: Match, x: number, z: number, d: number) {
  for (let k = 0; k < 16; k++) {
    const a = (k * Math.PI) / 8;
    const sx = x + Math.sin(a) * d;
    const sz = z + Math.cos(a) * d;
    if (Math.abs(sx) > EDGE - 3 || Math.abs(sz) > EDGE - 3) continue;
    if (m.map.buildings.some((b) => Math.abs(sx - b.x) < b.w / 2 + 2 && Math.abs(sz - b.z) < b.d / 2 + 2)) continue;
    if (m.map.yards.some((y) => Math.abs(sx - y.x) < y.hw + 1.5 && Math.abs(sz - y.z) < y.hd + 1.5)) continue;
    if (m.map.ponds.some((p) => Math.hypot(sx - p.x, sz - p.z) < p.r + 1) || riverDist2(m.map, sx, sz) < (RIVER_HALF + 1) * (RIVER_HALF + 1)) continue;
    let hit = false;
    solidsNear(m.map, sx, sz, 3, (_i, s) => {
      if (s.shape === 'circle' ? pushCircle(sx, sz, FIGHTER_R + 0.5, s.x, s.z, s.r) : pushBox(sx, sz, FIGHTER_R + 0.5, s.x, s.z, s.hw, s.hd)) hit = true;
    });
    if (!hit) return { x: sx, z: sz };
  }
  return null;
}

test('computer eggs raid the fridges, break the toilets and hay bales, loot the diners and windmills, and warm up at campfires when hurt, never stuck on a fence, a car or the furniture', () => {
  let tried = 0;
  for (const seed of [1, 2, 3, 4]) {
    const base = generateMap(seed);
    const special = (c: { x: number; z: number }) => base.buildings.some((b) => (b.kind === 'diner' || b.kind === 'mill') && Math.abs(c.x - b.x) < b.w / 2 && Math.abs(c.z - b.z) < b.d / 2);
    const jobs = [...base.containers.filter((c) => c.kind === 'fridge' || c.kind === 'toilet' || c.kind === 'hay' || (c.kind === 'chest' && special(c))).map((c) => ({ kind: c.kind, x: c.x, z: c.z, c: c.id })), ...base.fires.map((f) => ({ kind: 'fire', x: f.x, z: f.z, c: -1 }))];
    for (const job of jobs) {
      const m = quiet(seed);
      const a = alone(m);
      m.loot.clear();
      // everything else already opened, so this is the one worth going to
      m.opened = m.opened.map((_, i) => i !== job.c);
      const at = startNear(m, job.x, job.z, 14) ?? startNear(m, job.x, job.z, 20);
      assert.ok(at, `seed ${seed}: somewhere to start from near the ${job.kind}`);
      land(a, at.x, at.z);
      if (job.kind === 'fire') a.hp = 30;
      let done = false;
      for (let t = 0; t < 30 && !done; t += 1 / 30) {
        step(m, 1 / 30);
        m.events.length = 0;
        done = job.kind === 'fire' ? a.warm : m.opened[job.c];
      }
      assert.ok(done, `seed ${seed}: a computer egg from ${at.x.toFixed(1)},${at.z.toFixed(1)} got to the ${job.kind} at ${job.x},${job.z} (stuck at ${a.x.toFixed(1)},${a.z.toFixed(1)})`);
      if (job.kind === 'fire') {
        const hp = a.hp;
        run(m, 8);
        assert.ok(a.hp > hp + 10, `seed ${seed}: and stayed by the fire to heal (${hp.toFixed(0)} to ${a.hp.toFixed(0)})`);
      }
      tried++;
    }
  }
  assert.ok(tried > 100);
});

test('a computer egg on the booth side of a diner counter walks round it to the kitchen stash', () => {
  let trips = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const base = generateMap(seed);
    const bi = base.buildings.findIndex((b) => b.kind === 'diner');
    if (bi < 0) continue;
    const b = base.buildings[bi];
    const counter = base.furniture.find((f) => f.b === bi && f.kind === 'counter')!;
    const stash = base.containers.filter((c) => (c.kind === 'fridge' || c.kind === 'chest') && Math.abs(c.x - b.x) < b.w / 2 && Math.abs(c.z - b.z) < b.d / 2);
    // the booths are on the far side of the counter from the stash
    const front = Math.sign(counter.z - stash[0].z);
    for (const c of stash)
      for (const u of [-4, 0, 4]) {
        const m = quiet(seed);
        const a = alone(m);
        m.loot.clear();
        m.opened = m.opened.map((_, i) => i !== c.id);
        land(a, counter.x + u, counter.z + front * 1.1);
        let t = 0;
        for (; t < 20 && !m.opened[c.id]; t += 1 / 30) {
          step(m, 1 / 30);
          m.events.length = 0;
        }
        assert.ok(m.opened[c.id], `seed ${seed}: from ${a.x.toFixed(1)},${a.z.toFixed(1)} round the counter to the ${c.kind} at ${c.x},${c.z}`);
        assert.ok(t < 12, `seed ${seed}: and quickly (${t.toFixed(1)} s)`);
        trips++;
      }
  }
  assert.ok(trips >= 30, `${trips} trips`);
});

test('a computer egg crosses the river by a bridge near its way, and wades across where there is none', () => {
  let bridged = 0;
  let waded = 0;
  for (const seed of [1, 2, 3, 4, 5]) {
    const base = generateMap(seed);
    const open = (x: number, z: number) => {
      const m = quiet(seed);
      for (const d of [0, 2, 4, 6]) {
        const p = startNear(m, x, z, d);
        if (p) return p;
      }
      return null;
    };
    /** A computer egg with nothing to do but get from one spot to another, and whether it got wet on the way. */
    const trip = (from: { x: number; z: number }, to: { x: number; z: number }) => {
      const m = quiet(seed);
      const a = alone(m);
      m.loot.clear();
      m.opened = m.opened.map(() => true);
      land(a, from.x, from.z);
      a.ai!.gx = to.x;
      a.ai!.gz = to.z;
      let wet = false;
      let deck = false;
      for (let t = 0; t < 40 && Math.hypot(a.x - to.x, a.z - to.z) > 3; t += 1 / 30) {
        step(m, 1 / 30);
        m.events.length = 0;
        wet ||= a.wet;
        deck ||= bridgeAt(m.map, a.x, a.z) >= 0;
      }
      return { there: Math.hypot(a.x - to.x, a.z - to.z) <= 3, wet, deck, at: a };
    };
    // from beside a bridge's end to well past its far end: over the deck, dry
    for (const br of base.bridges) {
      const ax = br.alongX ? 1 : 0;
      const az = 1 - ax;
      const h = br.alongX ? br.hw : br.hd;
      for (const k of [-1, 1]) {
        const from = open(br.x - ax * k * (h + 7) + az * 3, br.z - az * k * (h + 7) + ax * 3);
        const to = open(br.x + ax * k * (h + 9) - az * 2, br.z + az * k * (h + 9) - ax * 2);
        if (!from || !to || riverCrossings(base, from.x, from.z, to.x, to.z) % 2 === 0) continue;
        const r = trip(from, to);
        assert.ok(r.there, `seed ${seed}: from ${from.x.toFixed(1)},${from.z.toFixed(1)} over the bridge at ${br.x},${br.z} to ${to.x.toFixed(1)},${to.z.toFixed(1)} (stuck at ${r.at.x.toFixed(1)},${r.at.z.toFixed(1)})`);
        assert.ok(r.deck && !r.wet, `seed ${seed}: kept dry over the bridge at ${br.x},${br.z}`);
        bridged++;
      }
    }
    // straight across, far from any bridge: wading
    const r = base.river;
    for (let i = 4; i < r.length - 4; i += 4) {
      const p = r[i];
      if (Math.abs(p.x) > HALF - 30 || Math.abs(p.z) > HALF - 30 || base.bridges.some((b) => Math.hypot(b.x - p.x, b.z - p.z) < 50)) continue;
      const dx = r[i + 1].x - r[i - 1].x;
      const dz = r[i + 1].z - r[i - 1].z;
      const l = Math.hypot(dx, dz);
      const nx = -dz / l;
      const nz = dx / l;
      const from = open(p.x + nx * (RIVER_HALF + 7), p.z + nz * (RIVER_HALF + 7));
      const to = open(p.x - nx * (RIVER_HALF + 7), p.z - nz * (RIVER_HALF + 7));
      if (!from || !to || riverCrossings(base, from.x, from.z, to.x, to.z) !== 1) continue;
      const t = trip(from, to);
      assert.ok(t.there && t.wet && !t.deck, `seed ${seed}: waded across at ${p.x},${p.z} (at ${t.at.x.toFixed(1)},${t.at.z.toFixed(1)})`);
      waded++;
    }
  }
  assert.ok(bridged >= 12 && waded >= 10, `${bridged} trips over bridges, ${waded} wading`);
});

test('a computer egg off somewhere far takes a bounce pad that points the right way', () => {
  const m = quiet(3);
  const a = alone(m);
  openSpot(m);
  m.map.pads = [{ x: 0, z: 0, dx: 1, dz: 0 }];
  land(a, -8, 2);
  // somewhere far east, inside the circle
  a.ai!.goal = 'roam';
  a.ai!.gx = 90;
  a.ai!.gz = 0;
  const evs: Ev[] = [];
  for (let t = 0; t < 4 && a.phase === 'ground'; t += DT) evs.push(...run(m, DT));
  assert.ok(evs.some((e) => e.t === 'bounce' && e.f === a.id), 'up it goes');
  for (let t = 0; t < 6 && a.phase !== 'ground'; t += DT) run(m, DT);
  assert.ok(a.phase === 'ground' && a.x > 35, `and down far along the way (${a.x.toFixed(1)})`);
  // one pointing the wrong way is walked past
  const w = quiet(3);
  const b = alone(w);
  openSpot(w);
  w.map.pads = [{ x: 0, z: 0, dx: -1, dz: 0 }];
  land(b, -8, 0.4);
  b.ai!.gx = 90;
  b.ai!.gz = 0;
  const more = run(w, 4);
  assert.ok(!more.some((e) => e.t === 'bounce'), 'round it, not over it');
  assert.ok(b.x > 10, 'and on its way on foot');
});

test('a host’s report of fifty eggs fits well inside one room message, and new holdings travel', () => {
  const players = Array.from({ length: 20 }, (_, seat) => ({ seat, name: `P${seat}` }));
  const h = hostMatch(players, 0, 3, 'normal', MAX_FIGHTERS, 3);
  assert.equal(h.roster.length, 50);
  assert.equal(h.roster.filter((s) => s < 0).length, 30);
  const big = { x: -238.85, z: 237.75, y: 67.9, aim: -3.14, vx: -12.5, vz: 12.5, phase: 'ground' as const, hp: 99.9, shield: 99.9, w: 'pan' as const, r: 4, flags: F_ALL, helmet: 3, vest: 3 };
  const packet = hostState(9, 123456789, 345.67, 'hard', h.roster, h.roster.map((_, i): [number, typeof big] => [i, big]));
  const text = JSON.stringify({ t: 'msg', to: 19, d: packet });
  assert.ok(text.length < 3200, `${text.length} bytes`);
  const back = parsePacket(JSON.parse(text).d);
  assert.ok(back && back.k === 'S' && back.states.length === 50 && back.states[49][1].w === 'pan' && back.states[0][1].flags === F_ALL && back.states[7][1].vest === 3);
  assert.deepEqual(back.states[3][1], big, 'every number comes back as it went');
  for (const w of ['grenade', 'cleaver', 'lmg'] as const) {
    const s = { ...big, w };
    assert.deepEqual(parsePacket(guestState(1, s)), { k: 's', round: 1, state: s, watch: -1 });
  }
  const ok = { y: 'th', f: 3, k: 'sauce', x: 1, z: 2, lx: 10, lz: 12, ft: 0.8 };
  const e = parsePacket({ t: 'pk', r: 1, k: 'e', g: [[3, [ok, { ...ok, ft: 9 }, { ...ok, lx: 300 }, { ...ok, k: 'nuke' }, { ...ok, f: MAX_FIGHTERS }]]] });
  assert.ok(e && e.k === 'e');
  assert.deepEqual(e.groups[0][1], [ok], 'only the sane throw gets through');
  assert.deepEqual(toNet({ t: 'throw', f: 3, k: 'sauce', x: 1, z: 2, lx: 10, lz: 12, ft: 0.8 }), ok);
});

test('the host tells each guest about the eggs near the one it watches whenever they change, and the rest now and then', () => {
  const players = Array.from({ length: 3 }, (_, seat) => ({ seat, name: `P${seat}` }));
  const h = hostMatch(players, 0, 4, 'normal', MAX_FIGHTERS, 0);
  const m = h.match;
  m.time = 30;
  const s = newSession(true, h.roster);
  const me: Me = { seat: 0, isHost: true, round: 1 };
  for (const f of m.fighters) {
    land(f, -200 + (f.id % 10) * 40, -200 + Math.floor(f.id / 10) * 40);
    f.ai = null;
  }
  // guest 1's egg at the middle; egg 10 walks round it, egg 11 stands by it, egg 12 is far off and egg 13 is out
  const g = m.fighters[1];
  const st = (x: number, z: number, phase: 'ground' | 'out' = 'ground') => ({ x, z, y: 0, aim: 0, vx: 0, vz: 0, phase, hp: 100, shield: 0, w: null, r: 0, flags: 0, helmet: 0, vest: 0 });
  for (const f of [m.fighters[1], m.fighters[2]]) s.states.set(f.id, st(f.x, f.z));
  land(g, 0, 0);
  s.states.set(1, st(0, 0));
  land(m.fighters[10], 5, 5);
  land(m.fighters[11], -8, 3);
  land(m.fighters[12], 0, NEAR + 30);
  m.fighters[13].phase = 'out';
  const heard = new Map<number, number[]>();
  const rosters: number[] = [];
  const other: unknown[] = [];
  for (let t = 0; t < 30; t++) {
    m.fighters[10].x += 0.5;
    for (const f of m.fighters) s.heard.set(f.id, 0);
    for (const out of tick(s, m, me, [0, 1, 2, 7], 1 + t * 0.066)) {
      const p = parsePacket(JSON.parse(JSON.stringify(out.d)));
      assert.ok(p && p.k === 'S');
      if (out.to === 7) {
        other.push(p);
        continue;
      }
      if (out.to !== 1) continue;
      if (p.roster) rosters.push(t);
      for (const [fid] of p.states) heard.set(fid, [...(heard.get(fid) ?? []), t]);
    }
  }
  const n = (fid: number) => heard.get(fid)?.length ?? 0;
  assert.equal(n(1), 0, 'never its own egg');
  assert.equal(n(10), 30, 'one on the move nearby, every tick');
  assert.ok(n(11) >= 30 / FAR_EVERY && n(11) <= 30 / FAR_EVERY + 1, `one standing still nearby, now and then (${n(11)})`);
  assert.equal(n(12), 30 / FAR_EVERY, 'one far off, now and then');
  assert.equal(n(13), 30 / OUT_EVERY, 'one that is out, seldom');
  for (const f of m.fighters) if (f.id !== 1) assert.ok(n(f.id) >= 2, `every egg is heard of (${f.id})`);
  assert.deepEqual(rosters, [4, 9, 14, 19, 24, 29], 'the roster with every reliable report');
  assert.ok(other.length === 6 && other.every((p) => (p as { states: unknown[]; roster: number[] }).states.length === 0 && (p as { roster: number[] }).roster.length === MAX_FIGHTERS), 'someone not in the match only hears the roster');
  // once its egg is out, the eggs near the one it watches
  g.phase = 'out';
  s.states.set(1, st(0, 0, 'out'));
  receive(s, m, me, 1, guestState(1, st(0, 0, 'out'), 12), () => m, 2);
  heard.clear();
  for (let t = 0; t < 12; t++) {
    m.fighters[12].x += 0.5;
    for (const out of tick(s, m, me, [0, 1, 2], 3 + t * 0.066)) {
      const p = parsePacket(JSON.parse(JSON.stringify(out.d)));
      if (out.to === 1 && p && p.k === 'S') for (const [fid] of p.states) heard.set(fid, [...(heard.get(fid) ?? []), t]);
    }
  }
  assert.equal(n(12), 12, 'the one it watches, every tick');
  assert.equal(n(10), 12 / FAR_EVERY, 'and its own neighbors no more than any');
});

// ---------------------------------------------------------------------------------------------------------------------
// More loot: the marksman rifle, heavy SMG, minigun and flare gun, impulse eggs, jam and bushes in a can, smoothies
// and golden egg tarts.

/** A spot on the open grass of a match's island where a supply drop could come down, well away from `not`. */
function grass(m: Match, not?: { x: number; z: number }) {
  for (let x = -120; x <= 120; x += 7)
    for (let z = -120; z <= 120; z += 7) if (dropFits(m.map, x, z) && (!not || Math.hypot(x - not.x, z - not.z) > 90)) return { x, z };
  throw new Error('no open grass');
}

/** Clears the island right down, ponds and cornfields too. */
function bare(m: Match) {
  openSpot(m);
  m.map.ponds = [];
  m.map.fields = [];
}

test('a marksman rifle sits between a rifle and a scout; a heavy SMG and a minigun hit hard but never in one pull', () => {
  const [mk, rf, sc] = [WEAPONS.marksman, WEAPONS.rifle, WEAPONS.scout];
  for (const k of ['dmg', 'range', 'zoom', 'speed'] as const) assert.ok(mk[k] > rf[k] && mk[k] < sc[k], k);
  assert.ok(mk.rate < rf.rate && mk.rate > sc.rate, 'one careful shot at a time');
  assert.ok(WEAPONS.hsmg.dmg > WEAPONS.smg.dmg && WEAPONS.hsmg.ammo === 'heavy' && WEAPONS.hsmg.kick, 'a heavy SMG climbs');
  assert.ok(WEAPONS.minigun.mag >= 100 && WEAPONS.minigun.move < WEAPONS.lmg.move && WEAPONS.minigun.spin, 'a minigun spins and slows you');
  for (const w of ['marksman', 'hsmg', 'minigun'] as const) assert.ok(perHit(w, MAX_RARITY) < HP_MAX / 2, w);
});

test('a heavy SMG climbs with every shot and settles when you let go, and the network carries how far it climbed', () => {
  const m = quiet();
  const [a] = m.fighters;
  bare(m);
  land(a, 0, 0);
  a.guns[0] = { w: 'hsmg', r: 0, mag: WEAPONS.hsmg.mag };
  a.slot = 0;
  a.input.aim = 0;
  a.input.fire = true;
  const ks = run(m, 1.2).flatMap((e) => (e.t === 'shot' ? [e.k] : []));
  assert.ok(ks.length > 8, `${ks.length} shots`);
  assert.equal(ks[0], 1, 'the first shot goes where you aim');
  for (let i = 1; i < ks.length; i++) assert.ok(ks[i] >= ks[i - 1], 'each one wider');
  assert.ok(ks[ks.length - 1] >= 1.9 && ks[ks.length - 1] <= MAX_KICK, `climbed to ${ks[ks.length - 1]}`);
  a.input.fire = false;
  run(m, 0.6);
  assert.equal(a.heat, 0, 'settled');
  // the widest a shot can be gets through; anything wider doesn't
  const shot = (k: number) => parsePacket({ t: 'pk', r: 1, k: 'e', g: [[1, [{ y: 's', f: 1, w: 'hsmg', r: 0, x: 0, z: 0, a: 0, s: 5, k }]]] });
  const got = (k: number) => {
    const p = shot(k);
    return !!p && p.k === 'e' && p.groups.length === 1;
  };
  assert.ok(got(MAX_KICK) && !got(MAX_KICK + 0.1) && !got(0.9));
});

test('a minigun spins up before it fires, slows you while it spins, and spins down when you let go', () => {
  const m = quiet();
  const [a] = m.fighters;
  bare(m);
  land(a, 0, 0);
  a.guns[0] = { w: 'minigun', r: 0, mag: WEAPONS.minigun.mag };
  a.slot = 0;
  a.input.fire = true;
  assert.ok(!run(m, WEAPONS.minigun.spin!.up - 0.1).some((e) => e.t === 'shot'), 'not while it spins up');
  assert.ok(a.spin > 0.8 && (flagsOf(a) & F_SPIN) !== 0, 'and everyone sees it spin');
  assert.ok(run(m, 1).filter((e) => e.t === 'shot').length >= 12, 'then a stream');
  a.input.mz = 1;
  run(m, 0.5);
  const spinning = Math.hypot(a.vx, a.vz);
  a.input.fire = false;
  run(m, 1.5);
  assert.equal(a.spin, 0, 'spun down');
  const idle = Math.hypot(a.vx, a.vz);
  assert.ok(Math.abs(idle - SPEED * WEAPONS.minigun.move) < 0.05, `${idle}`);
  assert.ok(Math.abs(spinning / idle - WEAPONS.minigun.spin!.slow) < 0.02, `${spinning} vs ${idle}`);
  // switching away stops it at once
  a.input.fire = true;
  run(m, 0.5);
  a.input.slot = SLOT_MELEE;
  run(m, DT);
  assert.equal(a.spin, 0);
});

test('a flare gun fires once, straight up, and the host sends a supply drop down near it a while later', () => {
  const m = quiet(5);
  const [a, b] = m.fighters;
  const p = grass(m);
  land(a, p.x, p.z);
  const q = grass(m, p);
  land(b, q.x, q.z);
  a.guns[0] = { w: 'flare', r: MAX_RARITY, mag: 1 };
  a.slot = 0;
  a.input.fire = true;
  const evs = run(m, DT);
  a.input.fire = false;
  assert.ok(evs.some((e) => e.t === 'shot' && e.w === 'flare'));
  assert.equal(m.bullets.length, 0, 'no bullet flies');
  assert.equal(a.guns[0], null, 'the gun is spent');
  assert.equal(a.slot, SLOT_MELEE);
  const call = evs.find((e) => e.t === 'called');
  assert.ok(call && call.t === 'called' && call.f === a.id);
  const c = m.map.containers[call.c];
  assert.ok(c.flare && c.kind === 'supply' && m.map.flares.includes(c.id));
  assert.ok(Math.abs(c.at - (m.time + FLARE_WAIT)) < 0.1, `lands at ${c.at}`);
  assert.ok(Math.hypot(c.x - p.x, c.z - p.z) < 0.2, 'right where it was fired, with room there');
  for (const l of c.loot) assert.ok(Math.hypot(l.x - c.x, l.z - c.z) < 3, 'its loot comes with it');
  assert.ok(!openable(m, c), 'still up in the sky');
  assert.equal(callDrop(m, a.id, p.x, p.z), -1, 'one flare an egg every ten seconds');
  // it floats down like any supply drop, and everyone hears it coming
  assert.ok(run(m, FLARE_WAIT - SUPPLY_FALL + 0.1).some((e) => e.t === 'supply' && e.c === c.id));
  run(m, SUPPLY_FALL);
  assert.ok(openable(m, c), 'down, and ready to open');
  assert.equal(castRay(m, c.x - 2, c.z, 1, 0, 4, -1, false)?.what, 'chest', 'and in the way like one');
  // and only so many drops a match
  const more: number[] = [];
  while (more.length <= FLARE_DROPS) {
    m.time += 11;
    more.push(callDrop(m, a.id, p.x, p.z), callDrop(m, b.id, q.x, q.z));
  }
  assert.equal(more.filter((id) => id >= 0).length, FLARE_DROPS - 1, 'the rest of them, and no more');
  assert.ok(more.slice(0, FLARE_DROPS - 1).every((id, i) => id >= 0 && id !== c.id && more.indexOf(id) === i));
});

test('a called supply drop always comes down on open grass, clear of buildings and anything solid, where an egg can get to it', () => {
  for (let seed = 1; seed <= 10; seed++) {
    const m = createMatch({ seed, role: 'solo', level: 'normal', entrants: [{ name: 'a', color: '#fff', kind: 'player', seat: -1 }], me: 0, countdown: 0 });
    // fired from inside every building, from the middle of the ponds and the cornfields, and from the very corner
    const from = [...m.map.buildings, ...m.map.ponds, ...m.map.fields, { x: EDGE, z: -EDGE }];
    for (const p of from) {
      const s = dropSpot(m, p.x, p.z);
      assert.ok(s, `seed ${seed}: room near ${p.x},${p.z}`);
      assert.ok(Math.hypot(s.x - p.x, s.z - p.z) < 45, 'not far off');
      assert.ok(dropFits(m.map, s.x, s.z));
      assert.ok(m.map.buildings.every((b) => Math.abs(s.x - b.x) >= b.w / 2 + 3 || Math.abs(s.z - b.z) >= b.d / 2 + 3), 'nowhere near a roof');
      assert.ok(pondAt(m.map, s.x, s.z) < 0 && coverAt(m.map, s.x, s.z) < 0 && Math.abs(s.x) < HALF - BEACH && Math.abs(s.z) < HALF - BEACH, 'on the grass');
      const reach = walkable(m.map, s.x - 8, s.z - 8, s.x + 8, s.z + 8);
      assert.ok(reach(s.x, s.z, SUPPLY_HALF + 0.6), `seed ${seed}: open ground round it`);
    }
    assert.ok(!dropFits(m.map, m.map.buildings[0].x, m.map.buildings[0].z), 'never on a building');
  }
});

test('online, a guest’s flare calls a drop the host places, and every client has it in the same place at the same time', () => {
  const { h, g, hs, hMe, toHost, toGuest } = pair(false);
  const p = grass(h);
  for (const m of [h, g]) land(m.fighters[1], p.x, p.z);
  const mine = g.fighters[1];
  mine.guns[0] = { w: 'flare', r: MAX_RARITY, mag: 1 };
  mine.slot = 0;
  mine.input.fire = true;
  step(g, DT);
  mine.input.fire = false;
  const id = g.map.flares[0];
  assert.equal(g.map.containers[id].at, Infinity, 'only the host calls a drop');
  toHost();
  const hc = h.map.containers[id];
  assert.ok(hc.at < Infinity && Math.hypot(hc.x - p.x, hc.z - p.z) < 0.2, 'the host placed it where it sees the guest');
  toGuest();
  const gc = g.map.containers[id];
  assert.deepEqual([gc.x, gc.z, gc.at], [hc.x, hc.z, hc.at]);
  assert.deepEqual(gc.loot, hc.loot);
  assert.ok(g.events.some((e) => e.t === 'called' && e.net));
  // a guest can't place one itself, and nobody can move one that has been called
  const fake: NetEv = { y: 'fd', f: 1, c: h.map.flares[1], x: 0, z: 0, at: 1 };
  receive(hs, h, hMe, 1, JSON.parse(JSON.stringify({ t: 'pk', r: 1, k: 'e', g: [[1, [fake]]] })), () => h, 0);
  assert.equal(h.map.containers[h.map.flares[1]].at, Infinity, 'the host ignores a guest that says it called one');
  applyNet(g, { y: 'fd', f: 0, c: id, x: 10, z: 10, at: 99 });
  assert.deepEqual([gc.x, gc.z, gc.at], [hc.x, hc.z, hc.at], 'a drop on its way stays put');
  applyNet(g, { y: 'fd', f: 0, c: 0, x: 10, z: 10, at: 99 });
  assert.equal(g.map.containers[0].at, 0, 'and only a drop kept for flares can be called');
  // the news is checked on the way in
  const ok = { y: 'fd', f: 0, c: 70, x: 12.5, z: -40, at: 60 };
  const e = parsePacket({ t: 'pk', r: 1, k: 'e', g: [[0, [ok, { ...ok, x: HALF + 1 }, { ...ok, at: -1 }, { ...ok, at: 9999 }, { ...ok, c: -1 }, { ...ok, c: 1.5 }, { ...ok, f: MAX_FIGHTERS }, { ...ok, z: 'x' }]]] });
  assert.ok(e && e.k === 'e');
  assert.deepEqual(e.groups[0][1], [ok], 'only the sane one gets through');
  assert.deepEqual(toNet({ t: 'called', f: 0, c: 70, x: 12.5, z: -40, at: 60 }), ok);
  assert.equal(toNet({ t: 'called', f: 0, c: 70, x: 12.5, z: -40, at: 60, net: true }), null);
});

/** Has egg `a` throw what it has of a kind straight north, `reach` meters. */
function throwNorth(m: Match, a: Fighter, k: ThrowId, reach: number) {
  a.throws[k] = Math.max(1, a.throws[k]);
  a.input.pick = k;
  run(m, 0.25);
  a.fireT = 0;
  a.input.aim = 0;
  a.input.reach = reach;
  a.input.fire = true;
  const evs = run(m, 0.02);
  a.input.fire = false;
  return evs.find((e) => e.t === 'throw');
}

test('a bush in a can grows where it lands and hides whoever stands in it until they fire, for half a minute', () => {
  const m = quiet(7, 2);
  const [a, b] = m.fighters;
  bare(m);
  land(a, 0, 0);
  land(b, 0, 10);
  assert.ok(canSee(m, a, b, 60));
  assert.ok(throwNorth(m, a, 'bush', 10));
  run(m, 1);
  assert.equal(m.zones.length, 1);
  assert.equal(m.zones[0].k, 'bush');
  assert.equal(b.bush, GROWN, 'in the bush');
  assert.ok(concealed(m, b, a) && !canSee(m, a, b, 60), 'and out of sight');
  b.firedAt = m.clock;
  assert.ok(!concealed(m, b, a), 'firing gives it away');
  b.firedAt = -99;
  // on another client the bush grows from the same throw, and hides the egg there too
  const g = createMatch({ seed: 7, role: 'guest', level: 'normal', entrants: [{ name: 'a', color: '#fff', kind: 'remote', seat: 0 }, { name: 'b', color: '#fff', kind: 'player', seat: 1 }], me: 1, countdown: 0 });
  g.time = 5;
  bare(g);
  land(g.fighters[0], 0, 0);
  land(g.fighters[1], 0, 10);
  applyNet(g, { y: 'th', f: 0, k: 'bush', x: 0, z: 0, lx: 0, lz: 10, ft: 0.6 });
  run(g, 1);
  assert.equal(g.fighters[1].bush, GROWN);
  run(m, THROWS.bush.time!);
  assert.equal(m.zones.length, 0, 'it dies back');
  assert.equal(b.bush, -1);
  assert.ok(canSee(m, a, b, 60));
});

test('an impulse egg shoves eggs and loot away and barely scratches; each client shoves only its own eggs, the host the loot', () => {
  const m = quiet(7, 3);
  const [a, b, c] = m.fighters;
  bare(m);
  land(a, 0, 0);
  land(b, 0, 8.6);
  land(c, -2.6, 10.6);
  m.loot.set(77, { id: 77, def: { kind: 'wood', n: 10 }, x: 2.5, z: 9.5, by: -1, at: 0 });
  assert.ok(throwNorth(m, a, 'impulse', 9.5));
  const evs = run(m, 2);
  const pulse = evs.find((e) => e.t === 'pulse');
  assert.ok(pulse && pulse.t === 'pulse' && pulse.net, 'every client sets off its own');
  assert.ok(b.z < 8.6 - 1.5, `b was shoved back toward the thrower (${b.z})`);
  assert.ok(Math.hypot(c.x + 2.6, c.z - 10.6) > 1, 'c was shoved too');
  assert.ok(Math.hypot(c.x, c.z - 9.5) > Math.hypot(-2.6, 1.1), 'away from where it went off');
  assert.ok(b.hp < 100 && b.hp >= 100 - THROWS.impulse.dmg!, `a scratch (${b.hp})`);
  assert.equal(b.lastBy, a.id);
  assert.equal(a.hp, 100);
  assert.ok(Math.hypot(a.x, a.z) < 0.01, 'never the thrower');
  const l = m.loot.get(77)!;
  assert.ok(l.x > 3, `the wood slid away (${l.x})`);
  const moved = evs.find((e) => e.t === 'moved');
  assert.ok(moved && moved.t === 'moved' && moved.id === 77 && !moved.net);
  assert.deepEqual(toNet(moved), { y: 'lv', id: 77, x: l.x, z: l.z });
  assert.equal(toNet(pulse), null, 'nobody needs telling');
  // the shove wears off
  run(m, 1.5);
  assert.ok(Math.hypot(b.kx, b.kz) === 0 && Math.hypot(b.vx, b.vz) < 0.1);

  // on a guest: our own egg is shoved, someone else's is theirs to shove, and the loot waits for the host
  const g = createMatch({ seed: 7, role: 'guest', level: 'normal', entrants: [{ name: 'a', color: '#fff', kind: 'remote', seat: 0 }, { name: 'b', color: '#fff', kind: 'player', seat: 1 }, { name: 'c', color: '#fff', kind: 'remote', seat: 2 }], me: 1, countdown: 0 });
  g.time = 5;
  bare(g);
  land(g.fighters[0], 0, 0);
  land(g.fighters[1], 0, 8.6);
  land(g.fighters[2], -2.6, 10.6);
  g.loot.set(77, { id: 77, def: { kind: 'wood', n: 10 }, x: 2.5, z: 9.5, by: -1, at: 0 });
  applyNet(g, { y: 'th', f: 0, k: 'impulse', x: 0, z: 0, lx: 0, lz: 9.5, ft: 0.56 });
  const gevs = run(g, 2);
  assert.ok(g.fighters[1].z < 8.6 - 1.5, 'ours flew');
  assert.ok(Math.hypot(g.fighters[2].x + 2.6, g.fighters[2].z - 10.6) < 1e-9, 'theirs waits for its owner');
  assert.deepEqual([g.loot.get(77)!.x, g.loot.get(77)!.z], [2.5, 9.5], 'the loot waits for the host');
  assert.ok(!gevs.some((e) => e.t === 'moved'));
  applyNet(g, { y: 'lv', id: 77, x: l.x, z: l.z });
  assert.deepEqual([g.loot.get(77)!.x, g.loot.get(77)!.z], [l.x, l.z], 'and moves on its word');
  // someone shoved reports how fast it's really going
  b.kx = 6;
  b.vx = 1;
  assert.equal(stateOf(b).vx, 7);
  const e = parsePacket({ t: 'pk', r: 1, k: 'e', g: [[0, [{ y: 'lv', id: 77, x: 1, z: 2 }, { y: 'lv', id: -1, x: 1, z: 2 }, { y: 'lv', id: 77, x: HALF + 1, z: 2 }, { y: 'lv', id: 77, x: 1 }]]] });
  assert.ok(e && e.k === 'e' && e.groups[0][1].length === 1, 'loot moves only to the island');
  // an egg cracked by one says so, but nobody can claim to have hit someone else with one
  const o = parsePacket({ t: 'pk', r: 1, k: 'e', g: [[1, [{ y: 'o', f: 1, by: 0, w: 'impulse' }]]] });
  assert.ok(o && o.k === 'e' && o.groups[0][1].length === 1);
  assert.equal(hitCap('impulse'), 0);
});

test('jam slows anyone wading through it to a crawl until it dries up', () => {
  const m = quiet(7, 2);
  const [a, b] = m.fighters;
  bare(m);
  land(a, 0, 0);
  land(b, 0, 10);
  assert.ok(throwNorth(m, a, 'jam', 10));
  run(m, 1);
  assert.equal(m.zones[0]?.k, 'jam');
  b.input.mx = 1;
  run(m, 0.5);
  const pace = SPEED * MELEE.spatula.move;
  assert.ok(Math.abs(Math.hypot(b.vx, b.vz) - pace * THROWS.jam.slow!) < 0.05, `stuck at ${Math.hypot(b.vx, b.vz)}`);
  b.input.mx = 0;
  run(m, THROWS.jam.time!);
  assert.equal(m.zones.length, 0);
  b.input.mx = -1;
  run(m, 0.5);
  assert.ok(Math.abs(Math.hypot(b.vx, b.vz) - pace) < 0.05, 'dried up');
});

test('a smoothie tops up the shield a little at a time; a golden egg tart fills health and boost', () => {
  const m = quiet();
  const [a] = m.fighters;
  bare(m);
  land(a, 0, 0);
  a.items.smoothie = 1;
  a.input.use = 'smoothie';
  run(m, USES.smoothie.time + 0.05);
  assert.equal(a.items.smoothie, 0);
  assert.ok(a.shield < 2, 'not all at once');
  run(m, 5);
  assert.ok(Math.abs(a.shield - 5 * SIP) < 1, `${a.shield}`);
  run(m, 10);
  assert.ok(Math.abs(a.shield - USES.smoothie.sip!) < 0.01, 'and no more than it holds');
  // never past the cap, and a full shield has no use for one
  a.shield = 80;
  a.sip = USES.smoothie.sip!;
  run(m, 12);
  assert.equal(a.shield, SHIELD_MAX);
  assert.ok(!canUse(a, 'smoothie'));
  // the tart
  a.hp = 20;
  a.boost = 0;
  a.items.tart = 1;
  a.input.use = 'tart';
  run(m, USES.tart.time + 0.05);
  assert.equal(a.hp, HP_MAX);
  assert.ok(a.boost > BOOST.max - 1);
  assert.ok(!canUse(a, 'tart'), 'nothing left for one to do');
  // which one the heal and shield keys reach for
  a.items = { ...a.items, bandage: 3, medkit: 1, tart: 1, mini: 1, smoothie: 1, shield: 1 };
  a.shield = 0;
  a.hp = 30;
  assert.equal(bestUse(a, 'heal'), 'tart', 'nearly cracked');
  a.hp = 50;
  assert.equal(bestUse(a, 'heal'), 'medkit');
  assert.equal(bestUse(a, 'shield'), 'mini');
  a.items.mini = 0;
  assert.equal(bestUse(a, 'shield'), 'smoothie');
});

test('crates mostly hold a box of ammo besides; a flare gun is rare, always legendary, and legendary loot is marked to glow', () => {
  const rng = rng32(3);
  let crates = 0;
  let boxed = 0;
  let flares = 0;
  let guns = 0;
  for (let i = 0; i < 3000; i++) {
    const defs = rollLoot(rng, 'crate');
    crates++;
    if (defs.some((d) => d.kind === 'ammo')) boxed++;
    for (const tier of ['floor', 'crate', 'chest', 'gold', 'supply'] as const)
      for (const d of tier === 'crate' ? defs : rollLoot(rng, tier)) {
        if (d.kind !== 'gun') continue;
        guns++;
        if (d.w !== 'flare') continue;
        flares++;
        assert.equal(d.r, MAX_RARITY);
        assert.ok(tier !== 'gold' && tier !== 'supply', 'a supply drop never holds what calls one');
      }
  }
  assert.ok(boxed / crates > 0.6, `${boxed} of ${crates} crates`);
  assert.ok(flares > 0 && flares / guns < 0.02, `${flares} flare guns of ${guns}`);
  assert.ok(legendary({ kind: 'gun', w: 'rifle', r: MAX_RARITY }) && legendary({ kind: 'gun', w: 'flare', r: MAX_RARITY }) && legendary({ kind: 'use', w: 'tart', n: 1 }));
  assert.ok(!legendary({ kind: 'gun', w: 'rifle', r: 3 }) && !legendary({ kind: 'use', w: 'medkit', n: 1 }) && !legendary({ kind: 'helmet', lv: 3 }));
  // the new things travel
  for (const def of [{ kind: 'gun', w: 'minigun', r: 2, mag: 50 }, { kind: 'throw', w: 'bush', n: 2 }, { kind: 'use', w: 'tart', n: 1 }, { kind: 'use', w: 'smoothie', n: 2 }] as LootDef[]) assert.deepEqual(parseLoot(JSON.parse(JSON.stringify(def))), def);
  assert.equal(parseLoot({ kind: 'gun', w: 'minigun', r: 2, mag: WEAPONS.minigun.mag + 1 }), null);
});

test('a computer egg fires a flare gun it finds once nobody is about, then opens the drop it called', () => {
  const m = quiet(5);
  const [a, b] = m.fighters;
  const p = grass(m);
  land(a, p.x, p.z);
  const q = grass(m, p);
  land(b, q.x, q.z);
  autopilot(m, a);
  a.guns[1] = { w: 'flare', r: MAX_RARITY, mag: 1 };
  a.guns[0] = { w: 'rifle', r: 0, mag: 30 };
  a.slot = 0;
  const evs = run(m, 3);
  const call = evs.find((e) => e.t === 'called');
  assert.ok(call && call.t === 'called' && call.f === a.id, 'it called one');
  assert.ok(!a.guns.some((g) => g?.w === 'flare'), 'and the flare gun is spent');
  let opened = false;
  run(m, FLARE_WAIT + 25, () => (opened ||= m.opened[call.c]));
  assert.ok(opened, 'and went and opened it');
});

test('a hurt computer egg backs off into a bush of its own to patch up; one with an egg up close shoves it off', () => {
  const m = quiet(3);
  const [a, b] = m.fighters;
  bare(m);
  land(a, 0, 0);
  land(b, 0, 16);
  autopilot(m, a);
  a.ai!.tossCool = 0;
  a.guns[0] = { w: 'rifle', r: 0, mag: 30 };
  a.ammo.heavy = 90;
  a.slot = 0;
  a.hp = 30;
  a.throws.bush = 1;
  a.items.bandage = 5;
  let threw: Ev | undefined;
  let hid = false;
  let healed = false;
  run(m, 8, (evs) => {
    threw ??= evs.find((e) => e.t === 'throw' && e.f === a.id && e.k === 'bush');
    hid ||= a.bush === GROWN;
    healed ||= evs.some((e) => e.t === 'use' && e.f === a.id);
    b.hp = 100;
  });
  assert.ok(threw && threw.t === 'throw' && threw.lz < 0, 'thrown away from the egg it fights');
  assert.ok(hid, 'and hid in it');
  assert.ok(healed, 'and patched up');

  const n = quiet(3);
  const [c, d] = n.fighters;
  bare(n);
  land(c, 0, 0);
  land(d, 0, 4.5);
  autopilot(n, c);
  c.ai!.tossCool = 0;
  c.guns[0] = { w: 'smg', r: 0, mag: 30 };
  c.ammo.light = 90;
  c.slot = 0;
  c.throws.impulse = 1;
  let pushed = false;
  run(n, 4, (evs) => {
    pushed ||= evs.some((e) => e.t === 'pulse' && e.f === c.id);
    d.hp = 100;
  });
  assert.ok(pushed, 'an impulse egg at close range');
  assert.ok(Math.hypot(d.x, d.z - 4.5) > 2.5, 'and the other egg went flying');
});

test('a computer egg with a minigun keeps it spinning in a fight, and walks out of jam', () => {
  const m = quiet(3);
  const [a, b] = m.fighters;
  bare(m);
  land(a, 0, 0);
  land(b, 0, 12);
  autopilot(m, a);
  a.guns[0] = { w: 'minigun', r: 0, mag: WEAPONS.minigun.mag };
  a.ammo.light = 150;
  a.slot = 0;
  let shots = 0;
  run(m, 5, (evs) => {
    shots += evs.filter((e) => e.t === 'shot' && e.w === 'minigun').length;
    b.hp = 100;
  });
  assert.ok(shots > 20, `${shots} rounds`);

  const n = quiet(3);
  const [c] = n.fighters;
  bare(n);
  land(c, 0, 0);
  autopilot(n, c);
  n.zones.push({ k: 'jam', x: 0, z: 0, r: THROWS.jam.radius, from: n.time, until: n.time + 8, by: 1 });
  let out = false;
  run(n, 4, () => (out ||= Math.hypot(c.x, c.z) > THROWS.jam.radius));
  assert.ok(out, 'out of it');
});

test('the new flags travel with an egg’s state, and nothing past them', () => {
  const m = quiet();
  const f = m.fighters[0];
  land(f, 1, 2);
  const s = { ...stateOf(f), flags: F_ALL };
  assert.deepEqual(parsePacket(guestState(1, s)), { k: 's', round: 1, state: s, watch: -1 });
  assert.equal(parsePacket(guestState(1, { ...s, flags: F_ALL + 1 })), null);
  assert.ok((F_SPIN | F_SMOOTHIE | F_TART) <= F_ALL && F_TART > 255);
  f.using = 'smoothie';
  assert.equal(flagsOf(f) & F_SMOOTHIE, F_SMOOTHIE);
  f.using = 'tart';
  assert.equal(flagsOf(f) & (F_TART | F_HEALING), F_TART);
});

// ---------------------------------------------------------------------------------------------------------------------
// Odds and ends.

test('loot tables only roll real things, launchers are never common, and the best places hold the best guns', () => {
  const rng = rng32(1);
  const kinds = new Set<string>();
  const armor = Object.fromEntries(['floor', 'crate', 'chest', 'gold', 'supply'].map((t) => [t, [0, 0, 0, 0]]));
  for (let i = 0; i < 3000; i++) {
    for (const tier of ['floor', 'crate', 'chest', 'gold', 'supply'] as const) {
      const defs = rollLoot(rng, tier);
      assert.ok(defs.length >= 1 && defs.length <= 6);
      for (const def of defs) {
        kinds.add(def.kind);
        assert.ok(parseLoot(def), JSON.stringify(def));
        if (def.kind === 'helmet' || def.kind === 'vest') {
          armor[tier][def.lv]++;
          if (tier === 'gold') assert.equal(def.lv, 3, 'the golden chest holds the best armor');
          if (tier === 'supply') assert.ok(def.lv >= 2, 'supply drops hold good armor');
        }
        if (def.kind === 'gun' && def.w === 'launcher') assert.ok(def.r >= 2);
        if (def.kind === 'gun' && tier === 'chest') assert.ok(def.r >= 1, 'chest guns are better than common');
        if (def.kind === 'gun' && tier === 'supply') assert.ok(def.r >= 2, 'supply drops hold rare or better');
        if (def.kind === 'gun' && tier === 'gold') assert.ok(def.r >= 3, 'the golden chest holds epic or legendary');
        if (def.kind === 'wood') assert.ok(def.n <= WOOD_MAX);
      }
      if (tier === 'gold' || tier === 'supply') assert.ok(defs.some((d) => d.kind === 'gun') && defs.some((d) => d.kind === 'throw') && defs.some((d) => d.kind === 'helmet' || d.kind === 'vest'));
    }
  }
  assert.deepEqual([...kinds].sort(), ['ammo', 'ghillie', 'gun', 'helmet', 'melee', 'pack', 'scope', 'throw', 'use', 'vest', 'wood'], 'every kind of loot turns up');
  // the better the place, the better the armor: level 3 is rare on the floor and the usual thing in a supply drop
  assert.ok(armor.floor[1] > armor.floor[2] && armor.floor[2] > armor.floor[3] && armor.floor[3] > 0, JSON.stringify(armor.floor));
  assert.ok(armor.chest[2] > armor.chest[1] && armor.chest[3] > armor.chest[1], JSON.stringify(armor.chest));
  assert.ok(armor.supply[3] > armor.supply[2], JSON.stringify(armor.supply));
  assert.ok(armor.floor[1] + armor.floor[2] + armor.floor[3] > 200, 'armor turns up on the floor often enough');
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

test('quick play always fills the island to fifty at normal, whoever hosts and however full the room is', () => {
  assert.equal(QUICK_LEVEL, 'normal');
  // a full room of twenty people has no room bots left, and quick play still fills the rest
  assert.equal(hostBots(true, 0, false), MAX_FIGHTERS);
  assert.equal(hostBots(true, 19, false), MAX_FIGHTERS);
  // a room of your own: its bots, and more to fifty only with Fill to 50
  assert.equal(hostBots(false, 5, true), MAX_FIGHTERS);
  assert.equal(hostBots(false, 5, false), 5);
  assert.equal(hostBots(false, 0, true), 0);
  const people = Array.from({ length: 20 }, (_, seat) => ({ seat, name: `P${seat}` }));
  for (const n of [1, 3, 20]) {
    const { match, roster } = hostMatch(people.slice(0, n), 0, 4242, QUICK_LEVEL, hostBots(true, 0, true), 3);
    assert.equal(match.fighters.length, MAX_FIGHTERS, `${n} people`);
    assert.equal(roster.filter((seat) => seat >= 0).length, n);
    assert.equal(match.fighters.filter((f) => f.kind === 'bot').length, MAX_FIGHTERS - n);
    assert.equal(match.level, 'normal');
  }
});

test('meta: twenty seats with late joining, bots and quick play, and a board per level', () => {
  assert.deepEqual(meta.online, { seats: 20, lateJoin: true, bots: true, quick: true });
  assert.match(meta.controls, /Play joins the next match/);
  assert.match(meta.controls, /Play with Bots/);
  assert.deepEqual(Object.keys(meta.leaderboard!.variants!), [...LEVELS]);
  assert.equal(noInput().slot, -1);
});

// ---------------------------------------------------------------------------------------------------------------------
// Windows.

const GLAZED: Building['kind'][] = ['house', 'farm', 'shed', 'diner', 'warehouse', 'police', 'bank'];

test('windows sit in the outer walls of houses, farms, sheds, diners, warehouses, the police station and the bank, filling their openings, clear of doors and corners', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const m = generateMap(seed);
    m.windows.forEach((p, i) => assert.equal(p.i, i, 'numbered in order'));
    assert.ok(m.windows.length >= 150, `seed ${seed}: windows about (${m.windows.length})`);
    m.buildings.forEach((b, bi) => {
      if (!GLAZED.includes(b.kind)) return assert.equal(b.windows.length, 0, `seed ${seed}: no window in a ${b.kind}`);
      assert.ok(b.windows.length >= 1, `seed ${seed}: a ${b.kind} with no window`);
      for (const p of b.windows) {
        assert.equal(m.windows[p.i], p);
        assert.equal(p.b, bi);
        const alongX = p.ox === 0;
        // on the wall line, facing out
        if (alongX) assert.ok(Math.abs(p.z - (b.z + p.oz * (b.d / 2))) < 1e-9 && Math.abs(p.hd - WALL_T / 2) < 1e-9);
        else assert.ok(Math.abs(p.x - (b.x + p.ox * (b.w / 2))) < 1e-9 && Math.abs(p.hw - WALL_T / 2) < 1e-9);
        const half = alongX ? p.hw : p.hd;
        const u = alongX ? p.x : p.z;
        // wall right up to both ends: no gap either side
        for (const end of [u - half, u + half]) {
          const meets = b.walls.some((w) =>
            alongX
              ? Math.abs(w.z - p.z) < 1e-9 && (Math.abs(w.x - w.hw - end) < 0.01 || Math.abs(w.x + w.hw - end) < 0.01)
              : Math.abs(w.x - p.x) < 1e-9 && (Math.abs(w.z - w.hd - end) < 0.01 || Math.abs(w.z + w.hd - end) < 0.01),
          );
          assert.ok(meets, `seed ${seed}: a window in a ${b.kind} at ${p.x},${p.z} with no wall at its end`);
        }
        // and well clear of the corners and the doorways in the same wall
        const room = ((alongX ? b.w : b.d) - WALL_T) / 2;
        assert.ok(Math.abs(u - (alongX ? b.x : b.z)) + half <= room - 0.85, `seed ${seed}: a window too near a corner`);
        for (const d of b.doors) if (d.ox === p.ox && d.oz === p.oz) assert.ok(Math.abs((alongX ? d.x : d.z) - u) >= half + d.w / 2 + 0.85, `seed ${seed}: a window crowding a door`);
        // a solid of its own
        assert.ok(m.solids.some((s) => s.what === 'window' && s.ref === p.i && s.x === p.x && s.z === p.z), 'a solid for every window');
      }
    });
    // warehouse windows run along the long sides only, a shed's across from its door
    for (const b of m.buildings) {
      if (b.kind === 'warehouse') for (const p of b.windows) assert.equal(p.ox === 0, b.w > b.d, 'along the long sides');
      if (b.kind === 'shed') for (const p of b.windows) assert.ok(b.doors.every((d) => d.ox === -p.ox && d.oz === -p.oz), 'across from the door');
    }
  }
});

test('nobody walks into a building through a window: with its doors shut, a house or a shed is out of reach', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const m = generateMap(seed);
    const shut = m.buildings.filter((b) => b.kind === 'house' || b.kind === 'shed').slice(0, 8);
    for (const b of shut) for (const d of b.doors) m.solids.push({ shape: 'box', x: d.x, z: d.z, hw: d.ox ? WALL_T / 2 : d.w / 2 + 0.1, hd: d.ox ? d.w / 2 + 0.1 : WALL_T / 2, what: 'wall', ref: 0 });
    reindex(m);
    for (const b of shut) {
      assert.ok(b.windows.length > 0);
      const reach = walkable(m, b.x - b.w / 2 - 3, b.z - b.d / 2 - 3, b.x + b.w / 2 + 3, b.z + b.d / 2 + 3);
      assert.ok(!reach(b.x, b.z, Math.min(b.w, b.d) / 2 - 0.8), `seed ${seed}: walked into a ${b.kind} at ${b.x},${b.z} with its doors shut`);
    }
  }
});

test('standing a few steps out from a window peeks in under the roof, glass or no glass', () => {
  for (let seed = 1; seed <= 10; seed++) {
    const m = generateMap(seed);
    m.buildings.forEach((b, i) => {
      for (const p of b.windows)
        for (const k of [0.8, 2.5, PEEK_GLASS - 0.3]) {
          const x = p.x + p.ox * k;
          const z = p.z + p.oz * k;
          const at = peekAt(m, x, z);
          // a doorway in view wins
          if (at !== i) assert.ok(at >= 0 && m.buildings[at].doors.some((d) => Math.hypot(x - d.x, z - d.z) < PEEK + 3), `seed ${seed}: ${k} m out from a ${b.kind}'s window`);
        }
    });
  }
});

/** A wall across the way at z = 5 with a window in the middle of it, on open ground. */
function windowSpot(m: Match): Pane {
  openSpot(m);
  const pane: Pane = { x: 0, z: 5, hw: 0.8, hd: WALL_T / 2, i: 0, b: -1, ox: 0, oz: 1 };
  m.map.windows = [pane];
  m.broken = [false];
  m.map.solids = [
    { shape: 'box', x: -5.8, z: 5, hw: 5, hd: WALL_T / 2, what: 'wall', ref: 0 },
    { shape: 'box', x: 5.8, z: 5, hw: 5, hd: WALL_T / 2, what: 'wall', ref: 0 },
    { shape: 'box', x: 0, z: 5, hw: 0.8, hd: WALL_T / 2, what: 'window', ref: 0 },
  ];
  reindex(m.map);
  return pane;
}

/** One pull of the trigger (or swing), then let go. */
function oneShot(m: Match, f: Fighter) {
  f.fireT = 0;
  f.input.fire = true;
  const evs = run(m, 1 / 60);
  f.input.fire = false;
  return [...evs, ...run(m, 0.6)];
}

test('window glass lets the eye through, stops the first bullet and breaks; then bullets and throws go through, but never feet', () => {
  const m = quiet();
  const [a, b] = m.fighters;
  windowSpot(m);
  land(a, 0, 0);
  land(b, 0, 12);
  assert.ok(canSee(m, a, b, 40) && clearLine(m, 0, 0, 0, 12), 'seen through the glass');
  assert.equal(castRay(m, 0, 0, 0, 1, 20, a.id, true)?.what, 'window', 'a bullet meets it');
  // a grenade lobbed at it lands short, and the bang breaks the glass
  a.throws.grenade = 2;
  a.input.pick = 'grenade';
  run(m, 0.25);
  a.input.aim = 0;
  a.input.reach = 10;
  a.input.fire = true;
  const thrown = run(m, 0.02).find((e) => e.t === 'throw');
  a.input.fire = false;
  assert.ok(thrown && thrown.t === 'throw' && thrown.lz < 4.6, 'short of the glass');
  const bang = run(m, THROWS.grenade.fuse! + 0.2);
  assert.ok(m.broken[0] && bang.some((e) => e.t === 'glass' && e.i === 0 && e.f === a.id && !e.net), 'the blast broke it');
  assert.equal(b.hp, 100);
  // glass again: the first bullet breaks it and stops there, the next goes through
  m.broken[0] = false;
  a.guns[0] = { w: 'rifle', r: 0, mag: 30 };
  a.ammo.heavy = 90;
  a.input.slot = 0;
  run(m, 0.3);
  const first = oneShot(m, a);
  assert.ok(m.broken[0] && first.some((e) => e.t === 'glass' && e.i === 0), 'the first bullet broke it');
  assert.equal(b.hp, 100, 'and stopped there');
  assert.equal(castRay(m, 0, 0, 0, 1, 20, a.id, true)?.what, 'egg', 'nothing in the way now');
  oneShot(m, a);
  assert.ok(b.hp < 100, 'the next one got through');
  // a throw sails through the opening
  a.input.pick = 'grenade';
  run(m, 0.25);
  a.fireT = 0;
  a.input.fire = true;
  const through = run(m, 0.02).find((e) => e.t === 'throw');
  a.input.fire = false;
  assert.ok(through && through.t === 'throw' && Math.abs(through.lz - 10) < 0.05, 'through the broken window');
  run(m, THROWS.grenade.fuse! + 0.2);
  // but nobody walks through, broken or not
  assert.equal(castRay(m, 0, 0, 0, 1, 20, a.id, false, true)?.what, 'window', 'feet still meet it');
  land(a, 0, 3);
  a.input.mz = 1;
  run(m, 1.5);
  a.input.mz = 0;
  assert.ok(a.z < 5 - WALL_T / 2 - FIGHTER_R + 0.05, `stopped at the sill (${a.z.toFixed(2)})`);
});

test('a swing breaks window glass, and a barrel going up breaks every window near it (on the host)', () => {
  const m = quiet();
  const [a] = m.fighters;
  windowSpot(m);
  land(a, 0, 5 - WALL_T / 2 - FIGHTER_R - 0.1);
  a.input.slot = SLOT_MELEE;
  a.input.aim = 0;
  run(m, 0.2);
  const evs = oneShot(m, a);
  assert.ok(m.broken[0] && evs.some((e) => e.t === 'glass'), 'smashed');
  // swinging again only bonks the sill
  const again = oneShot(m, a);
  assert.ok(again.some((e) => e.t === 'thud' && e.what === 'window') && !again.some((e) => e.t === 'glass'));

  // a barrel by a real window, broken on the host: the glass goes too; a guest leaves it to the host's word
  const h = quiet(5);
  const g = createMatch({ seed: 5, role: 'guest', level: 'normal', entrants: [{ name: 'g', color: '#fff', kind: 'player', seat: 1 }], me: 0, countdown: 0 });
  const p = h.map.windows[0];
  const barrel = h.map.containers.find((c) => c.kind === 'barrel')!;
  for (const m2 of [h, g]) {
    const c = m2.map.containers[barrel.id];
    c.x = p.x + p.ox * 2;
    c.z = p.z + p.oz * 2;
  }
  damageCrate(h, barrel.id, BARREL.hp, 1, true);
  assert.ok(h.opened[barrel.id] && h.broken[p.i] && h.events.some((e) => e.t === 'glass' && e.i === p.i && !e.net));
  applyNet(g, { y: 'opd', c: barrel.id, f: 1 });
  assert.ok(g.opened[barrel.id] && !g.broken[p.i], 'a guest waits to hear');
  assert.equal(applyNet(g, { y: 'gl', f: 1, i: p.i }), true);
  assert.ok(g.broken[p.i]);
});

test('broken windows reach every client: the breaker tells the host, the host passes it on once, and its reports list them for anyone who missed it', () => {
  const { h, g, hs, hMe, toHost } = pair(false);
  const shooter = g.fighters[1];
  const p = g.map.windows.find((w) => w.oz === 1 && g.map.buildings[w.b].kind === 'house')!;
  for (const m of [h, g]) {
    land(m.fighters[1], p.x, p.z + 3);
    land(m.fighters[0], p.x + 60, p.z + 60);
    m.events.length = 0;
  }
  shooter.guns[0] = { w: 'rifle', r: 0, mag: 30 };
  shooter.slot = 0;
  shooter.input.aim = Math.PI;
  shooter.input.fire = true;
  for (let i = 0; i < 6 && !g.broken[p.i]; i++) step(g, DT);
  shooter.input.fire = false;
  assert.ok(g.broken[p.i], 'broken on the shooter’s own screen at once');
  const news = g.events.filter((e) => e.t === 'glass');
  assert.equal(news.length, 1);
  assert.deepEqual(toNet(news[0]), { y: 'gl', f: 1, i: p.i });
  assert.ok(!h.broken[p.i]);
  toHost();
  assert.ok(h.broken[p.i], 'the host has it');
  assert.ok(hs.queue.some(([seat, e]) => seat === 1 && e.y === 'gl' && e.i === p.i), 'and passes it on');
  hs.queue.length = 0;
  assert.equal(applyNet(h, { y: 'gl', f: 1, i: p.i }), false, 'old news is not passed on again');
  // someone who missed it hears it from the host's next full report, quietly
  const late = guestMatch([{ seat: 0, name: 'h' }, { seat: 1, name: 'g' }, { seat: 2, name: 'l' }], 2, 4, 'normal', 0, [0, 1, 2]);
  const ls = newSession(true, [0, 1, 2]);
  let full: { d: object; fast: boolean; to?: number } | undefined;
  for (let i = 0; i < 6 && !full; i++) full = tick(hs, h, hMe, [0, 1, 2], 1).find((o) => !o.fast && o.to === 2);
  assert.ok(full);
  const wire = JSON.parse(JSON.stringify(full.d));
  assert.equal(typeof wire.gl, 'string');
  late.events.length = 0;
  receive(ls, late, { seat: 2, isHost: false, round: 1 }, 0, wire, () => late, 1);
  assert.ok(late.broken[p.i] && late.broken.filter(Boolean).length === 1, 'the late one has the same broken window, and only that');
  assert.ok(!late.events.some((e) => e.t === 'glass'));
});

test('broken window lists pack small and anything malformed is turned away', () => {
  const broken = Array.from({ length: 230 }, (_, i) => i % 7 === 3 || i === 229);
  const packed = packGlass(broken);
  assert.ok(packed.length <= 58);
  assert.deepEqual(unpackGlass(packed), broken.flatMap((b, i) => (b ? [i] : [])));
  assert.equal(packGlass(broken.map(() => false)), '', 'none broken, nothing to send');
  assert.equal(packGlass([false, false, false, false, true]), '01');
  for (const bad of ['xyz', 'A1', 7, '0'.repeat(5000)]) assert.equal(unpackGlass(bad), null, String(bad).slice(0, 10));
  const s = stateOf(quiet().fighters[0]);
  assert.equal(parsePacket({ ...hostState(1, 1, 0, 'easy', [0], [[0, s]]), gl: 'zz' }), null);
  const ok = parsePacket(JSON.parse(JSON.stringify(hostState(1, 1, 0, 'easy', [0], [[0, s]], [false, true]))));
  assert.ok(ok && ok.k === 'S' && ok.glass?.join() === '1');
  assert.ok(!('gl' in hostState(1, 1, 0, 'easy', null, [], [true])), 'only the full reports list them');
  const e = parsePacket({ t: 'pk', r: 1, k: 'e', g: [[1, [{ y: 'gl', f: 1, i: 3 }, { y: 'gl', f: -1, i: 0 }, { y: 'gl', f: 1, i: -1 }, { y: 'gl', f: 1, i: 1e7 }, { y: 'gl', f: MAX_FIGHTERS, i: 2 }, { y: 'gl', f: 1, i: 2.5 }]]] });
  assert.ok(e && e.k === 'e');
  assert.deepEqual(e.groups[0][1], [{ y: 'gl', f: 1, i: 3 }, { y: 'gl', f: -1, i: 0 }]);
  // a window past the island's list breaks nothing
  const m = quiet();
  assert.equal(breakGlass(m, m.broken.length + 3, 0, false), false);
});

test('a computer egg indoors shoots out through a window at an egg it sees, breaking the glass to do it', () => {
  let tried = 0;
  for (const seed of [3, 4, 6]) {
    const m = quiet(seed);
    const [a, b] = m.fighters;
    // a house window on a south wall, with room to stand inside it and out in front of it
    const free = (x: number, z: number) => {
      let ok = true;
      solidsNear(m.map, x, z, 2, (_i, s) => {
        if (s.shape === 'circle' ? pushCircle(x, z, FIGHTER_R + 0.2, s.x, s.z, s.r) : pushBox(x, z, FIGHTER_R + 0.2, s.x, s.z, s.hw, s.hd)) ok = false;
      });
      return ok;
    };
    const p = m.map.windows.find((w) => w.oz === 1 && m.map.buildings[w.b].kind === 'house' && free(w.x, w.z - 1.4) && free(w.x, w.z + 7));
    if (!p) continue;
    tried++;
    autopilot(m, a);
    land(a, p.x, p.z - 1.4);
    land(b, p.x, p.z + 7);
    a.guns[0] = { w: 'smg', r: 1, mag: 30 };
    a.ammo.light = 120;
    a.slot = 0;
    let saw = false;
    for (let t = 0; t < 6 && b.hp >= 100; t += DT) {
      step(m, DT);
      m.events.length = 0;
      saw ||= a.ai!.target === b.id;
    }
    assert.ok(saw, `seed ${seed}: spotted through the glass`);
    assert.ok(m.broken[p.i], `seed ${seed}: broke the window`);
    assert.ok(b.hp < 100, `seed ${seed}: and hit the egg outside`);
  }
  assert.ok(tried >= 2);
});

// ---------------------------------------------------------------------------------------------------------------------
// Doors, the police station and the bank, furniture that opens, MIRV and stun grenades, ghillie suits, the kill leader.

const DOORED: Building['kind'][] = ['house', 'farm', 'shed', 'diner', 'mill', 'coop', 'police', 'bank', 'warehouse'];

test('a door hangs in every doorway of a house, farm, shed, diner, windmill, warehouse side, the Golden Coop, the police station and the bank, filling it', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const m = generateMap(seed);
    m.slabs.forEach((s, i) => assert.equal(s.i, i, 'numbered in order'));
    assert.ok(m.slabs.length >= 80, `seed ${seed}: doors about (${m.slabs.length})`);
    m.buildings.forEach((b, bi) => {
      for (const d of [...b.doors, ...b.inner]) {
        const has = DOORED.includes(b.kind) && d.w <= DOOR + 0.01;
        assert.equal(d.slab !== undefined, has, `seed ${seed}: a ${b.kind}'s ${d.w} m doorway ${has ? 'has' : 'has no'} door`);
        if (d.slab === undefined) continue;
        const s = m.slabs[d.slab];
        assert.equal(s.b, bi);
        assert.ok(s.x === d.x && s.z === d.z && s.ox === d.ox && s.oz === d.oz, 'in its doorway');
        // the width of the opening, wall thick, and wall right up to both of its sides
        assert.ok(Math.abs(2 * (d.ox ? s.hd : s.hw) - d.w) < 1e-9 && Math.abs(2 * (d.ox ? s.hw : s.hd) - WALL_T) < 1e-9);
        const ends = d.ox ? [s.z - s.hd, s.z + s.hd] : [s.x - s.hw, s.x + s.hw];
        const wall = [...b.walls, ...b.bars];
        for (const end of ends)
          assert.ok(
            wall.some((w) => (d.ox ? Math.abs(w.x - s.x) < 0.2 && (Math.abs(w.z - w.hd - end) < 0.01 || Math.abs(w.z + w.hd - end) < 0.01) : Math.abs(w.z - s.z) < 0.2 && (Math.abs(w.x - w.hw - end) < 0.01 || Math.abs(w.x + w.hw - end) < 0.01))),
            `seed ${seed}: a ${b.kind}'s door with no wall at its side`,
          );
        assert.ok(m.solids.some((x) => x.what === 'door' && x.ref === s.i), 'a solid for every door');
        assert.equal(s.bars, d.kind === 'bars');
        assert.equal(s.vault, d.kind === 'vault');
      }
    });
    assert.equal(m.slabs.filter((s) => s.vault).length, 1, 'one vault door, in the bank');
    assert.equal(m.slabs.filter((s) => s.bars).length, 1, 'one barred door, the jail cell');
  }
});

/** Clears the island down to grass and puts up a wall along z = 5 with a shut door in the middle (its way out +z). */
function doorSpot(m: Match, kind: 'plain' | 'vault' | 'bars' = 'plain'): Slab {
  openSpot(m);
  const slab: Slab = { x: 0, z: 5, hw: DOOR / 2, hd: WALL_T / 2, i: 0, b: -1, ox: 0, oz: 1, bars: kind === 'bars', vault: kind === 'vault' };
  m.map.slabs = [slab];
  m.doors = [DOOR_SHUT];
  m.doorHp = [DOOR_HP];
  m.doorAt = [-99];
  m.doorT = [Infinity];
  m.vaults = kind === 'vault' ? [0] : [];
  m.map.solids = [
    { shape: 'box', x: -DOOR / 2 - 5, z: 5, hw: 5, hd: WALL_T / 2, what: 'wall', ref: 0 },
    { shape: 'box', x: DOOR / 2 + 5, z: 5, hw: 5, hd: WALL_T / 2, what: 'wall', ref: 0 },
    { shape: 'box', x: 0, z: 5, hw: DOOR / 2, hd: WALL_T / 2, what: 'door', ref: 0 },
  ];
  reindex(m.map);
  return slab;
}

test('a shut door stops eggs, bullets and the eye; opened, it swings away from whoever opens it and lets everything through', () => {
  const m = quiet();
  const [a, b] = m.fighters;
  doorSpot(m);
  land(a, 0, 3.6);
  land(b, 0, 12);
  assert.ok(!canSee(m, a, b, 40) && !clearLine(m, 0, 3.6, 0, 12), 'no seeing through it');
  assert.equal(castRay(m, 0, 3.6, 0, 1, 20, a.id, true)?.what, 'door', 'a bullet meets it');
  assert.deepEqual(prompt(m, a), { door: 0 });
  a.input.mz = 1;
  run(m, 1);
  a.input.mz = 0;
  assert.ok(a.z < 5 - WALL_T / 2 - FIGHTER_R + 0.05, `stopped at it (${a.z.toFixed(2)})`);
  // opened from inside (the -z side), it swings out
  a.input.interact = true;
  const evs = run(m, 0.05);
  assert.equal(m.doors[0], DOOR_OUT);
  assert.ok(evs.some((e) => e.t === 'door' && e.i === 0 && e.s === DOOR_OUT && e.f === a.id && !e.net), 'news of it');
  assert.ok(canSee(m, a, b, 40) && castRay(m, a.x, a.z, 0, 1, 20, a.id, true)?.what === 'egg', 'open: the eye and bullets go through');
  a.input.mz = 1;
  run(m, 0.6);
  a.input.mz = 0;
  assert.ok(a.z > 6, `and so do feet (${a.z.toFixed(2)})`);
  // shut from outside, then opened again from there: it swings in, away from the egg
  land(a, 0, 6.2);
  a.input.interact = true;
  run(m, 0.4);
  assert.equal(m.doors[0], DOOR_SHUT);
  a.input.interact = true;
  run(m, 0.05);
  a.input.interact = true;
  run(m, 0.05);
  assert.equal(m.doors[0], DOOR_IN, 'swung in, and a door just moved waits a moment');
  // a door shut on an egg in the doorway pushes it out of the way
  land(b, 0, 5);
  m.doorAt[0] = -99;
  a.input.interact = true;
  run(m, 0.3);
  assert.equal(m.doors[0], DOOR_SHUT);
  assert.ok(Math.abs(b.z - 5) >= WALL_T / 2 + FIGHTER_R - 0.05, 'out of the doorway');
});

test('a door takes a beating before it comes off its hinges, which only the host decides; a vault door never comes off', () => {
  const m = quiet();
  const [a] = m.fighters;
  doorSpot(m);
  land(a, 0, 0);
  a.guns[0] = { w: 'rifle', r: 0, mag: 30 };
  a.ammo.heavy = 90;
  a.slot = 0;
  a.input.aim = 0;
  run(m, 0.3);
  let shots = 0;
  const smashed: Ev[] = [];
  while (m.doors[0] === DOOR_SHUT && shots < 20) {
    smashed.push(...oneShot(m, a));
    shots++;
  }
  assert.equal(m.doors[0], DOOR_GONE);
  assert.ok(shots >= 4 && shots <= 9, `${shots} shots`);
  assert.ok(smashed.some((e) => e.t === 'smash' && e.kind === 'door' && e.id === 0) && smashed.some((e) => e.t === 'door' && e.s === DOOR_GONE));
  assert.equal(castRay(m, 0, 0, 0, 1, 20, a.id, false), null, 'nothing in the way now');
  assert.equal(doorNear(m, a, 9), -1, 'and nothing to open or shut');
  // a guest's own hits count, but only the host's word takes the door off
  const g = createMatch({ seed: 7, role: 'guest', level: 'normal', entrants: [{ name: 'g', color: '#fff', kind: 'player', seat: 1 }], me: 0, countdown: 0 });
  doorSpot(g);
  damageDoor(g, 0, DOOR_HP * 3, 0, true);
  assert.equal(g.doors[0], DOOR_SHUT);
  assert.equal(applyNet(g, { y: 'ds', f: 0, i: 0, s: DOOR_GONE }), true);
  assert.equal(g.doors[0], DOOR_GONE);
  // a vault door: dented, never broken
  const v = quiet();
  doorSpot(v, 'vault');
  damageDoor(v, 0, 99_999, 0, true);
  assert.equal(v.doors[0], DOOR_SHUT);
});

test('a bank vault door grinds open slowly and stays open, and the safes behind it hold the best loot', () => {
  const m = quiet();
  const [a] = m.fighters;
  doorSpot(m, 'vault');
  land(a, 0, 6.2);
  a.input.interact = true;
  const start = run(m, 0.05);
  assert.equal(m.doors[0], DOOR_OPENING);
  assert.ok(start.some((e) => e.t === 'door' && e.s === DOOR_OPENING), 'news it is opening');
  assert.equal(castRay(m, 0, 6.2, 0, -1, 4, a.id, false, true)?.what, 'door', 'still in the way while it opens');
  assert.equal(prompt(m, a), null, 'nothing to do but wait');
  run(m, VAULT_TIME - 0.6);
  assert.equal(m.doors[0], DOOR_OPENING);
  run(m, 1);
  assert.equal(m.doors[0], DOOR_OUT, 'open');
  assert.equal(castRay(m, 0, 6.2, 0, -1, 4, a.id, false, true), null);
  a.input.interact = true;
  run(m, 0.5);
  assert.equal(m.doors[0], DOOR_OUT, 'and it stays open');
  // every bank's safes and deposit boxes are shut in its vault until it opens; the safes hold legendary things
  for (let seed = 1; seed <= 10; seed++) {
    const r = quiet(seed);
    const vault = r.vaults[0];
    assert.ok(vault >= 0 && r.map.slabs[vault].vault, `seed ${seed}: a vault`);
    const safes = r.map.containers.filter((c) => c.kind === 'safe');
    const boxes = r.map.containers.filter((c) => c.kind === 'deposit');
    assert.equal(safes.length, 2, `seed ${seed}: two safes`);
    assert.equal(boxes.length, 4, `seed ${seed}: four deposit boxes`);
    for (const c of [...safes, ...boxes]) {
      assert.equal(r.locked[c.id], vault, 'behind the vault door');
      assert.ok(lockedIn(r, c));
    }
    r.doors[vault] = DOOR_OUT;
    for (const c of safes) assert.ok(!lockedIn(r, c) && openable(r, c));
    assert.equal(r.locked.filter((v) => v >= 0).length, 6, 'and nothing else is');
  }
  const rng = rng32(3);
  let legend = 0;
  let guns = 0;
  for (let i = 0; i < 400; i++)
    for (const def of rollLoot(rng, 'safe')) {
      if (def.kind !== 'gun') continue;
      guns++;
      assert.ok(def.r >= 3 && def.w !== 'flare', 'epic or legendary, and never a flare gun');
      if (def.r === 4) legend++;
    }
  assert.ok(guns === 400 && legend > 250, `${legend} of ${guns} legendary`);
});

test('a guest asks the host to open a door; the host decides, tells everyone, and lists the open doors for anyone who missed it', () => {
  const { h, g, hs, hMe, toHost, toGuest } = pair(false);
  const s = g.map.slabs.find((x) => g.map.buildings[x.b].kind === 'house' && x.oz === 1)!;
  for (const m of [h, g]) {
    land(m.fighters[1], s.x, s.z + 1.2);
    land(m.fighters[0], s.x + 60, s.z + 60);
    m.events.length = 0;
  }
  const egg = g.fighters[1];
  assert.deepEqual(prompt(g, egg), { door: s.i });
  egg.input.interact = true;
  step(g, DT);
  assert.equal(g.doors[s.i], DOOR_SHUT, 'not until the host says');
  const ask = g.events.filter((e) => e.t === 'latch');
  assert.equal(ask.length, 1);
  assert.deepEqual(toNet(ask[0]), { y: 'dq', f: 1, i: s.i });
  assert.equal(prompt(g, egg), null, 'asked: no asking again straight away');
  toHost();
  assert.equal(h.doors[s.i], DOOR_IN, 'the host opens it, away from the guest outside');
  assert.ok(!hs.queue.some(([, e]) => e.y === 'dq'), 'the ask itself goes no further');
  toGuest();
  assert.equal(g.doors[s.i], DOOR_IN, 'and the guest hears');
  // the host turns down a guest far from the door it asks about
  const far = h.map.slabs.find((x) => Math.hypot(x.x - s.x, x.z - s.z) > 30)!;
  applyNet(h, { y: 'dq', f: 1, i: far.i });
  assert.equal(h.doors[far.i], DOOR_SHUT);
  // someone who missed it hears it from the host's next full report, quietly
  const late = guestMatch([{ seat: 0, name: 'h' }, { seat: 1, name: 'g' }, { seat: 2, name: 'l' }], 2, 4, 'normal', 0, [0, 1, 2]);
  const ls = newSession(true, [0, 1, 2]);
  h.doors[far.i] = DOOR_GONE;
  let full: { d: object; fast: boolean; to?: number } | undefined;
  for (let i = 0; i < 6 && !full; i++) full = tick(hs, h, hMe, [0, 1, 2], 1).find((o) => !o.fast && o.to === 2);
  assert.ok(full);
  const wire = JSON.parse(JSON.stringify(full.d));
  assert.equal(typeof wire.dz, 'string');
  late.events.length = 0;
  late.clock = 10;
  receive(ls, late, { seat: 2, isHost: false, round: 1 }, 0, wire, () => late, 1);
  assert.deepEqual(late.doors, h.doors, 'the late one has the same doors');
  assert.ok(!late.events.some((e) => e.t === 'door'));
  // but a report that set out before news that just came in doesn't undo it
  setDoorNews(late, far.i);
  receive(ls, late, { seat: 2, isHost: false, round: 1 }, 0, wire, () => late, 1);
  assert.equal(late.doors[far.i], DOOR_OUT);
  // and once every door is shut again, a full report lists none, which shuts any the guest still has open
  const shutAll = parsePacket(JSON.parse(JSON.stringify(hostState(1, h.seed, 0, 'normal', [0, 1, 2], [], [], h.doors.map(() => DOOR_SHUT)))));
  assert.ok(shutAll && shutAll.k === 'S' && shutAll.doors?.length === 0);
  late.clock += 5;
  receive(ls, late, { seat: 2, isHost: false, round: 1 }, 0, JSON.parse(JSON.stringify(hostState(1, h.seed, 0, 'normal', [0, 1, 2], [], [], []))), () => late, 1);
  assert.ok(late.doors.every((d) => d === DOOR_SHUT));
});

/** News from the host that a door is open, just now. */
function setDoorNews(m: Match, i: number) {
  applyNet(m, { y: 'ds', f: -1, i, s: DOOR_OUT });
}

test('door news packs small and anything malformed is turned away', () => {
  const doors = Array.from({ length: 95 }, (_, i) => (i % 9 === 2 ? DOOR_OUT : i % 13 === 5 ? DOOR_IN : i === 60 ? DOOR_GONE : i === 70 ? DOOR_OPENING : DOOR_SHUT));
  const packed = packDoors(doors);
  assert.ok(packed.length <= 95 && /^[0-4]+$/.test(packed));
  const back = unpackDoors(packed)!;
  assert.deepEqual([...back, ...Array(95 - back.length).fill(DOOR_SHUT)], doors);
  assert.equal(packDoors(doors.map(() => DOOR_SHUT)), '', 'all shut, nothing to send');
  for (const bad of ['5', 'a1', 7, '1'.repeat(5000)]) assert.equal(unpackDoors(bad), null, String(bad).slice(0, 10));
  const s = stateOf(quiet().fighters[0]);
  assert.equal(parsePacket({ ...hostState(1, 1, 0, 'easy', [0], [[0, s]]), dz: '9' }), null);
  const ok = parsePacket(JSON.parse(JSON.stringify(hostState(1, 1, 0, 'easy', [0], [[0, s]], [], [DOOR_SHUT, DOOR_IN]))));
  assert.ok(ok && ok.k === 'S' && ok.doors?.join() === `${DOOR_SHUT},${DOOR_IN}`);
  assert.ok(!('dz' in hostState(1, 1, 0, 'easy', null, [], [], [DOOR_OUT])), 'only the full reports list them');
  const e = parsePacket({
    t: 'pk',
    r: 1,
    k: 'e',
    g: [[1, [{ y: 'dq', f: 1, i: 3 }, { y: 'ds', f: -1, i: 4, s: DOOR_GONE }, { y: 'dq', f: 1, i: -1 }, { y: 'dq', f: MAX_FIGHTERS, i: 2 }, { y: 'ds', f: 1, i: 2, s: 7 }, { y: 'ds', f: 1, i: 1e7, s: 0 }, { y: 'm', f: 1, k: 'door', id: 3, d: 20 }, { y: 'b', f: 1, x: 0, z: 0, r: 2.8 }, { y: 'b', f: 1, x: 0, z: 0, r: 99 }]]],
  });
  assert.ok(e && e.k === 'e');
  assert.deepEqual(e.groups[0][1], [{ y: 'dq', f: 1, i: 3 }, { y: 'ds', f: -1, i: 4, s: DOOR_GONE }, { y: 'm', f: 1, k: 'door', id: 3, d: 20 }, { y: 'b', f: 1, x: 0, z: 0, r: 2.8 }]);
  // the host only takes door news from itself
  const { h, hs, hMe } = pair(false);
  receive(hs, h, hMe, 1, { t: 'pk', r: 1, k: 'e', g: [[1, [{ y: 'ds', f: 1, i: 0, s: DOOR_OUT }]]] }, () => h, 0);
  assert.ok(h.doors.every((d) => d === DOOR_SHUT));
});

test('the police station has a lobby of lockers, a jail cell behind bars and a stash; its bars stop feet, not bullets or the eye', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const m = quiet(seed);
    const bi = m.map.buildings.findIndex((b) => b.kind === 'police');
    const b = m.map.buildings[bi];
    const inside = (c: { x: number; z: number }) => Math.abs(c.x - b.x) < b.w / 2 && Math.abs(c.z - b.z) < b.d / 2;
    const lockers = m.map.containers.filter((c) => c.kind === 'locker' && inside(c));
    assert.ok(lockers.length >= 4, `seed ${seed}: lockers (${lockers.length})`);
    const stash = m.map.containers.find((c) => c.kind === 'chest' && inside(c));
    assert.ok(stash, `seed ${seed}: the stash's chest`);
    assert.ok(stash.loot.some((l) => l.def.kind === 'gun') && stash.loot.some((l) => l.def.kind === 'helmet' || l.def.kind === 'vest'), 'a gun and armor in it');
    assert.ok(m.map.containers.some((c) => c.kind === 'toilet' && inside(c)), 'a toilet in the cell');
    const cell = b.inner.find((d) => d.kind === 'bars')!;
    // through the bars beside the cell door: bullets and the eye, not feet
    const x = cell.x + 1.6 * (Math.abs(cell.oz) ? 1 : 0);
    const z = cell.z + 1.6 * (Math.abs(cell.ox) ? 1 : 0);
    const from = { x: x + cell.ox * 2, z: z + cell.oz * 2 };
    const ray = (lows: boolean) => castRay(m, from.x, from.z, -cell.ox, -cell.oz, 3, -1, false, lows);
    assert.equal(ray(true)?.what, 'bars', `seed ${seed}: bars stop feet`);
    assert.equal(ray(false), null, 'but not bullets');
    assert.ok(clearLine(m, from.x, from.z, from.x - cell.ox * 3, from.z - cell.oz * 3), 'nor the eye');
    // its barred door too
    assert.equal(castRay(m, cell.x + cell.ox * 2, cell.z + cell.oz * 2, -cell.ox, -cell.oz, 3, -1, false, true)?.what, 'door');
    assert.equal(castRay(m, cell.x + cell.ox * 2, cell.z + cell.oz * 2, -cell.ox, -cell.oz, 3, -1, false), null);
    assert.ok(placeAt(m.map, b.x, b.z) >= 0 && /Precinct|Patrol|Station|Police/.test(m.map.places[placeAt(m.map, b.x, b.z)].name), `seed ${seed}: named on the map`);
    const bank = m.map.buildings.find((x) => x.kind === 'bank')!;
    assert.ok(/Bank|Savings|Trust/.test(m.map.places[placeAt(m.map, bank.x, bank.z)]?.name ?? ''), `seed ${seed}: the bank too`);
  }
});

test('chests of drawers, bookshelves and lockers open for small things, and nobody reaches into one through a wall', () => {
  for (let seed = 1; seed <= 10; seed++) {
    const m = generateMap(seed);
    const k = (s: string) => m.containers.filter((c) => c.kind === s);
    assert.ok(k('drawer').length >= 20 && k('books').length >= 20 && k('locker').length >= 6, `seed ${seed}: drawers, bookshelves and lockers`);
    for (const c of m.containers) {
      if (!isStash(c.kind)) continue;
      assert.ok(opens(c.kind));
      const b = m.buildings.find((x) => Math.abs(c.x - x.x) < x.w / 2 && Math.abs(c.z - x.z) < x.d / 2);
      assert.ok(b && b.roof, `seed ${seed}: a ${c.kind} indoors`);
      const s = m.solids[c.solid];
      assert.ok(s && s.what === 'chest' && s.shape === 'box' && s.hw === (c.ax ? STASH[c.kind].deep : STASH[c.kind].along), 'a solid of its size');
      assert.ok(c.loot.length <= (c.kind === 'safe' ? 4 : 3), `${c.kind}: ${c.loot.length} things`);
      // what it holds spills out in front, inside
      for (const l of c.loot) assert.ok(Math.abs(l.x - b!.x) < b!.w / 2 - 0.3 && Math.abs(l.z - b!.z) < b!.d / 2 - 0.3, `seed ${seed}: a ${c.kind}'s loot indoors`);
    }
    assert.ok(k('books').filter((c) => !c.loot.length).length >= 4, 'plenty of bookshelves hold only books');
  }
  // standing outside the bank's back wall, a safe right through it is out of reach; inside the vault, it opens
  const m = quiet(2);
  const [a] = m.fighters;
  const safe = m.map.containers.find((c) => c.kind === 'safe')!;
  m.doors[m.vaults[0]] = DOOR_OUT;
  land(a, safe.x, safe.z - safe.face * (STASH.safe.deep + WALL_T + FIGHTER_R + 0.15));
  assert.ok(Math.hypot(a.x - safe.x, a.z - safe.z) < CHEST_R);
  assert.equal(nearestChest(m, a), -1, 'not through the wall');
  land(a, safe.x, safe.z + safe.face * 1.1);
  assert.equal(nearestChest(m, a), safe.id);
  a.input.interact = true;
  run(m, 0.05);
  assert.ok(m.opened[safe.id], 'opened');
  assert.ok(safe.loot.length > 0 && safe.loot.every((s) => m.loot.has(s.id) || m.gone.has(s.id)), 'and out came what was in it');
  for (const tier of ['drawer', 'books', 'locker', 'deposit', 'police'] as const) {
    const rng = rng32(9);
    for (let i = 0; i < 300; i++) for (const def of rollLoot(rng, tier)) assert.ok(parseLoot(def), `${tier}: ${JSON.stringify(def)}`);
  }
});

test('a MIRV grenade bursts into bomblets that land the same on every client; only the thrower’s client deals the damage', () => {
  const m = quiet();
  const [a, b] = m.fighters;
  openSpot(m);
  land(a, 0, 0);
  land(b, 1.5, 12);
  a.throws.mirv = 1;
  throwNorth(m, a, 'mirv', 12);
  run(m, THROWS.mirv.fuse! - 0.3);
  const bomblets = () => m.tosses.filter((t) => t.small);
  assert.equal(bomblets().length, 0);
  const split = run(m, 0.4);
  assert.ok(split.some((e) => e.t === 'boom' && e.f === a.id), 'it goes off');
  assert.equal(bomblets().length, THROWS.mirv.split!.n, 'and splits');
  const spots = bomblets().map((t) => [t.lx, t.lz]);
  for (const [x, z] of spots) {
    const d = Math.hypot(x - 0, z - 12);
    assert.ok(d > 0.5 && d <= THROWS.mirv.split!.reach + 0.01, `a bomblet ${d.toFixed(1)} m out`);
  }
  const booms = run(m, 1.5).filter((e) => e.t === 'boom');
  assert.equal(booms.length, THROWS.mirv.split!.n, 'each bomblet goes off');
  assert.ok(booms.every((e) => e.t === 'boom' && e.r !== undefined && e.r < 4), 'small bangs');
  assert.ok(b.hp < 70, `it hurt (${b.hp})`);
  // another client flies the same bomblets from the same throw, and hurts nobody with them
  const g = quiet();
  openSpot(g);
  land(g.fighters[1], 1.5, 12);
  launch(g, a.id, 'mirv', 0, 0, 0, 12, 12 / THROW.speed, false);
  const seen = run(g, THROWS.mirv.fuse! + 0.1);
  assert.deepEqual(g.tosses.filter((t) => t.small).map((t) => [t.lx, t.lz]), spots, 'the same scatter');
  run(g, 1.5, (evs) => seen.push(...evs));
  assert.ok(!seen.some((e) => e.t === 'hit' || e.t === 'boom'), 'their bangs come from the thrower');
  assert.equal(g.fighters[1].hp, 100);
  assert.equal(hitCap('mirv'), Math.max(THROWS.mirv.dmg!, THROWS.mirv.split!.dmg));
});

test('a stun grenade dazes the eggs that see its flash, slowing them; a wall hides it, and each client dazes only its own', () => {
  const m = quiet(7, 4);
  const [a, b, c, r] = m.fighters;
  doorSpot(m);
  r.kind = 'remote';
  land(a, 0, 14);
  land(b, 3, 9);
  land(c, 0, 1);
  land(r, -3, 9);
  launch(m, a.id, 'stun', 0, 12, 0, 8.5, 0.3, true);
  const evs = run(m, THROWS.stun.fuse! + 0.05);
  assert.ok(evs.some((e) => e.t === 'stun' && e.net), 'everyone sees the flash for themselves');
  assert.ok(b.stunT > 1, `dazed (${b.stunT.toFixed(1)} s)`);
  assert.equal(c.stunT, 0, 'not behind the wall');
  assert.equal(a.stunT, 0, 'nor the thrower');
  assert.equal(r.stunT, 0, 'nor someone else’s egg: its own client dazes it');
  assert.ok(flagsOf(b) & F_STUN, 'and it shows');
  // dazed, it walks slower
  const walk = (f: Fighter) => {
    land(f, 6, 12);
    f.input.mx = 1;
    run(m, 0.5);
    f.input.mx = 0;
    return f.x - 6;
  };
  const dazed = walk(b);
  b.stunT = 0;
  const fresh = walk(b);
  assert.ok(dazed < fresh * 0.75, `slowed (${dazed.toFixed(2)} m against ${fresh.toFixed(2)} m)`);
  const g = createMatch({ seed: 7, role: 'guest', level: 'normal', entrants: [{ name: 'g', color: '#fff', kind: 'player', seat: 1 }, { name: 'h', color: '#fff', kind: 'remote', seat: 0 }], me: 0, countdown: 0 });
  g.time = 5;
  applyState(g, g.fighters[1], stateOf(b.stunT > 0 ? b : { ...b, stunT: 2 }));
  assert.ok(g.fighters[1].show.flags & F_STUN);
});

test('a ghillie suit hides an egg keeping still on the grass from all but those close by, until it moves or fires; bullets still find it', () => {
  const m = quiet();
  const [a, b] = m.fighters;
  openSpot(m);
  land(a, 0, 0);
  land(b, 0, 12);
  b.ghillie = true;
  run(m, 0.2);
  assert.ok(!concealed(m, b, a), 'not yet still long enough');
  run(m, GHILLIE.still);
  assert.ok(concealed(m, b, a) && camouflaged(m, b) && !canSee(m, a, b, 40), 'still: hidden');
  assert.equal(castRay(m, 0, 0, 0, 1, 20, a.id, true)?.what, 'egg', 'but a bullet still finds it');
  land(a, 0, 12 - GHILLIE.near + 0.5);
  assert.ok(!concealed(m, b, a), 'up close it shows');
  land(a, 0, 0);
  b.input.mx = 1;
  run(m, 0.3);
  b.input.mx = 0;
  assert.ok(!concealed(m, b, a), 'moving, it shows');
  run(m, 1);
  assert.ok(concealed(m, b, a), 'still again, gone');
  b.firedAt = m.clock;
  assert.ok(!concealed(m, b, a), 'firing gives it away');
  b.firedAt = -99;
  // indoors there's no grass to hide in
  assert.ok(grassAt(m.map, b.x, b.z));
  const home = quiet(3);
  const house = home.map.buildings.find((x) => x.kind === 'house')!;
  assert.ok(!grassAt(home.map, house.x, house.z) && !grassAt(home.map, home.map.roads[0].x0, home.map.roads[0].z0), 'nor on a road');
  // picked up like armor, worn by its egg, shown on others' screens, and dropped when it cracks
  const c = quiet();
  const [p] = c.fighters;
  openSpot(c);
  land(p, 0, 0);
  assert.ok(wants(p, { kind: 'ghillie' }, false));
  c.loot.set(5, { id: 5, def: { kind: 'ghillie' }, x: 0.3, z: 0, by: -1, at: 0 });
  run(c, 0.1);
  assert.ok(p.ghillie && !wants(p, { kind: 'ghillie' }, false));
  assert.ok(flagsOf(p) & F_GHILLIE);
  const g = createMatch({ seed: 7, role: 'guest', level: 'normal', entrants: [{ name: 'g', color: '#fff', kind: 'player', seat: 1 }, { name: 'h', color: '#fff', kind: 'remote', seat: 0 }], me: 0, countdown: 0 });
  applyState(g, g.fighters[1], stateOf(p));
  assert.ok(g.fighters[1].ghillie, 'others know it wears one');
  hurt(c, p, 999, -1, 'storm', true);
  assert.ok([...c.loot.values()].some((l) => l.def.kind === 'ghillie'), 'it drops');
  assert.equal(lootName({ kind: 'ghillie' }), 'ghillie suit');
});

test('the egg with the most kills, three at least, is the kill leader until someone has more or it is out', () => {
  const m = quiet(7, 4);
  const [a, b, c] = m.fighters;
  for (const f of m.fighters) land(f, f.id * 30, 0);
  a.kills = LEADER_MIN - 1;
  run(m, 0.05);
  assert.equal(m.leader, -1, 'not enough kills yet');
  a.kills = LEADER_MIN;
  const crowned = run(m, 0.05).filter((e) => e.t === 'leader');
  assert.equal(m.leader, a.id);
  assert.deepEqual(crowned.map((e) => e.t === 'leader' && [e.f, e.kills, e.net]), [[a.id, LEADER_MIN, true]], 'said once, by every client for itself');
  b.kills = LEADER_MIN;
  run(m, 0.05);
  assert.equal(m.leader, a.id, 'a tie keeps the crown where it is');
  b.kills = LEADER_MIN + 2;
  run(m, 0.05);
  assert.equal(m.leader, b.id, 'more kills take it');
  hurt(m, b, 999, c.id, 'pistol', false);
  run(m, 0.05);
  assert.equal(m.leader, a.id, 'out, it passes to the next');
  assert.equal(c.kills, 1);
});

test('a computer egg opens the doors in its way, into a house shut tight and back out again', () => {
  let trips = 0;
  for (const seed of [1, 2, 3, 5]) {
    const m = quiet(seed);
    const a = alone(m);
    m.loot.clear();
    const bi = m.map.buildings.findIndex((b) => b.kind === 'house' && m.map.containers.some((c) => c.kind === 'chest' && Math.abs(c.x - b.x) < b.w / 2 && Math.abs(c.z - b.z) < b.d / 2));
    const b = m.map.buildings[bi];
    const chest = m.map.containers.find((c) => c.kind === 'chest' && Math.abs(c.x - b.x) < b.w / 2 && Math.abs(c.z - b.z) < b.d / 2)!;
    m.opened = m.opened.map((_, i) => i !== chest.id);
    assert.ok(b.doors.every((d) => m.doors[d.slab!] === DOOR_SHUT), 'shut tight');
    const at = startNear(m, b.x, b.z, Math.max(b.w, b.d) / 2 + 5) ?? startNear(m, b.x, b.z, Math.max(b.w, b.d) / 2 + 8);
    assert.ok(at);
    land(a, at.x, at.z);
    let t = 0;
    for (; t < 30 && !m.opened[chest.id]; t += 1 / 30) {
      step(m, 1 / 30);
      m.events.length = 0;
    }
    assert.ok(m.opened[chest.id], `seed ${seed}: in through a door to the chest at ${chest.x},${chest.z} (stuck at ${a.x.toFixed(1)},${a.z.toFixed(1)})`);
    assert.ok(b.doors.some((d) => m.doors[d.slab!] !== DOOR_SHUT), `seed ${seed}: it opened one (${b.doors.map((d) => [d.slab, m.doors[d.slab!]]).join(' ')}, ${t.toFixed(1)} s, from ${at.x},${at.z}, house ${b.x},${b.z})`);
    // shut them all again and send it off somewhere outside: out it goes
    for (const d of b.doors) m.doors[d.slab!] = DOOR_SHUT;
    m.loot.clear();
    a.ai!.goal = 'roam';
    a.ai!.gx = at.x;
    a.ai!.gz = at.z;
    for (t = 0; t < 20 && buildingAt(m.map, a.x, a.z) === bi; t += 1 / 30) {
      step(m, 1 / 30);
      m.events.length = 0;
    }
    assert.notEqual(buildingAt(m.map, a.x, a.z), bi, `seed ${seed}: back out (stuck at ${a.x.toFixed(1)},${a.z.toFixed(1)})`);
    trips++;
  }
  assert.equal(trips, 4);
});

test('computer eggs open drawers, bookshelves and lockers, raid the police station, and at the bank wait out the vault door to loot a safe', () => {
  let tried = 0;
  for (const seed of [1, 2, 3]) {
    const base = generateMap(seed);
    const police = base.buildings.find((b) => b.kind === 'police')!;
    const bank = base.buildings.find((b) => b.kind === 'bank')!;
    const inB = (b: Building) => (c: { x: number; z: number }) => Math.abs(c.x - b.x) < b.w / 2 && Math.abs(c.z - b.z) < b.d / 2;
    const jobs = [
      ...base.containers.filter((c) => c.kind === 'drawer').slice(0, 3),
      ...base.containers.filter((c) => c.kind === 'books').slice(0, 3),
      ...base.containers.filter((c) => (c.kind === 'locker' || c.kind === 'chest') && inB(police)(c)),
      ...base.containers.filter((c) => c.kind === 'safe' && inB(bank)(c)),
    ];
    for (const job of jobs) {
      const m = quiet(seed);
      const a = alone(m);
      m.loot.clear();
      m.opened = m.opened.map((_, i) => i !== job.id);
      const b = m.map.buildings.find((x) => inB(x)(job))!;
      const at = startNear(m, b.x, b.z, Math.max(b.w, b.d) / 2 + 4) ?? startNear(m, b.x, b.z, Math.max(b.w, b.d) / 2 + 8);
      assert.ok(at);
      land(a, at.x, at.z);
      a.guns[0] = { w: 'rifle', r: 0, mag: 30 };
      a.ammo.heavy = 60;
      let t = 0;
      let waited = false;
      for (; t < 45 && !m.opened[job.id]; t += 1 / 30) {
        step(m, 1 / 30);
        m.events.length = 0;
        waited ||= m.doors.some((d) => d === DOOR_OPENING);
      }
      assert.ok(m.opened[job.id], `seed ${seed}: a computer egg from ${at.x.toFixed(1)},${at.z.toFixed(1)} got to the ${job.kind} at ${job.x},${job.z} in a ${b.kind} (stuck at ${a.x.toFixed(1)},${a.z.toFixed(1)}, goal ${a.ai!.goal})`);
      if (job.kind === 'safe') assert.ok(waited, 'it opened the vault first');
      tried++;
    }
  }
  assert.ok(tried >= 30, `${tried} trips`);
});

test('a computer egg throws stun grenades and MIRVs at a target, and fights on dazed', () => {
  for (const k of ['stun', 'mirv'] as const) {
    let threw = false;
    for (let attempt = 0; attempt < 3 && !threw; attempt++) {
      const m = quiet(7 + attempt);
      const [a, b] = m.fighters;
      openSpot(m);
      autopilot(m, a);
      land(a, 0, 0);
      land(b, 0, 14);
      a.guns[0] = { w: 'pistol', r: 0, mag: 14 };
      a.ammo.light = 60;
      a.throws[k] = 2;
      for (let t = 0; t < 12 && !threw; t += DT) {
        step(m, DT);
        for (const e of m.events.splice(0)) if (e.t === 'throw' && e.f === a.id && e.k === k) threw = true;
        b.hp = 100;
        land(b, 0, 14);
      }
    }
    assert.ok(threw, `it threw a ${k}`);
  }
  // dazed, it still fights, just worse
  const m = quiet();
  const [a, b] = m.fighters;
  openSpot(m);
  autopilot(m, a);
  land(a, 0, 0);
  land(b, 0, 10);
  a.guns[0] = { w: 'smg', r: 0, mag: 30 };
  a.ammo.light = 120;
  a.stunT = 3;
  let shots = 0;
  run(m, 3, (evs) => (shots += evs.filter((e) => e.t === 'shot' && e.f === a.id).length));
  assert.ok(shots > 3, `shots dazed: ${shots}`);
});

test('a computer egg in a ghillie suit keeps still out on the grass and shoots from there', () => {
  const m = quiet();
  const [a, b] = m.fighters;
  openSpot(m);
  autopilot(m, a);
  land(a, 0, 0);
  land(b, 0, 28);
  a.guns[0] = { w: 'scout', r: 2, mag: 10 };
  a.ammo.heavy = 60;
  a.ghillie = true;
  let moved = 0;
  let shots = 0;
  let px = a.x;
  let pz = a.z;
  run(m, 6, (evs) => {
    moved += Math.hypot(a.x - px, a.z - pz);
    px = a.x;
    pz = a.z;
    shots += evs.filter((e) => e.t === 'shot' && e.f === a.id).length;
    b.hp = 100;
  });
  assert.ok(shots >= 3, `it shot (${shots})`);
  assert.ok(moved < 1.5, `and kept still (${moved.toFixed(2)} m)`);
});
