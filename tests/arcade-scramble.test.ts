import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { AMMO_BOX, AMMO_MAX, BANDAGE, SHIELD, WALL_COST, WEAPONS, WOOD_MAX, damageOf, parseLoot, rng32, rollLoot, type LootDef } from '../src/os/arcade/games/scramble/items.ts';
import {
  BUS_Y,
  DOOR,
  DROP_BASE,
  EDGE,
  HALF,
  STORM_PHASES,
  WALL_T,
  busAt,
  generateMap,
  pushBox,
  pushObb,
  rayBox,
  rayCircle,
  rayObb,
  raySolid,
  stormAt,
  stormEnd,
  walkCells,
} from '../src/os/arcade/games/scramble/map.ts';
import {
  CHEST_R,
  COUNTDOWN,
  CRATE_HP,
  FALL,
  INTERP,
  LEVELS,
  MAX_FIGHTERS,
  STORM_TICK,
  WALL_HP,
  aliveCount,
  applyState,
  autopilot,
  botNames,
  castRay,
  createMatch,
  dropId,
  hurt,
  noInput,
  prompt,
  scoreOf,
  soloMatch,
  step,
  type Entrant,
  type Ev,
  type Fighter,
  type Level,
  type Match,
} from '../src/os/arcade/games/scramble/logic.ts';
import { applyNet, configOf, endOf, guestState, hostState, packEvents, parsePacket, placesOf, stateOf, toNet, type NetEv } from '../src/os/arcade/games/scramble/net.ts';
import { FLUSH, TICK_MS, ending, flush, guestMatch, hostMatch, newSession, receive, share, tick, type Me, type Player, type Session } from '../src/os/arcade/games/scramble/session.ts';
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

/** Clears the island down to bare grass (no trees, rocks, houses, bushes, crates or loot) and returns its middle. */
function openSpot(m: Match) {
  m.map.solids = [];
  m.map.grid = m.map.grid.map(() => []);
  m.map.bushes = [];
  m.map.buildings = [];
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

test('every island has seven houses with two doorways each, and nothing outdoors inside them', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const m = generateMap(seed);
    assert.equal(m.buildings.length, 7, `seed ${seed}`);
    for (const b of m.buildings) {
      assert.ok(Math.abs(b.x) + b.w / 2 < HALF - 7 && Math.abs(b.z) + b.d / 2 < HALF - 7, 'houses stand on grass');
      // the walls run all the way round except two doorways
      const length = b.walls.reduce((s, w) => s + 2 * Math.max(w.hw, w.hd), 0);
      const full = 2 * (b.w + WALL_T) + 2 * (b.d - WALL_T);
      assert.ok(Math.abs(full - length - 2 * DOOR) < 0.31, `seed ${seed} doorways`);
    }
    for (const [i, a] of m.buildings.entries())
      for (const b of m.buildings.slice(i + 1)) assert.ok(Math.abs(a.x - b.x) >= (a.w + b.w) / 2 + 12 || Math.abs(a.z - b.z) >= (a.d + b.d) / 2 + 12, 'houses keep apart');
    const inside = (x: number, z: number) => m.buildings.some((b) => Math.abs(x - b.x) < b.w / 2 + 1 && Math.abs(z - b.z) < b.d / 2 + 1);
    for (const t of [...m.trees, ...m.rocks, ...m.bushes]) assert.ok(!inside(t.x, t.z), `seed ${seed}: nothing grows indoors`);
    for (const c of m.containers) if (c.kind === 'crate') assert.ok(!inside(c.x, c.z), 'crates stand outside');
    assert.ok(m.trees.length >= 100 && m.rocks.length >= 20 && m.bushes.length >= 30, `seed ${seed} scenery`);
    assert.ok(m.containers.filter((c) => c.kind === 'chest').length >= 7, 'a chest in every house at least');
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
  assert.equal(stormAt(s, 0).r, 150, 'the first circle takes in the whole island');
  let dps = 0;
  for (let t = 0; t < stormEnd(s) + 5; t += 1) {
    const now = stormAt(s, t);
    assert.ok(now.dps >= dps, 'the bite never eases');
    dps = now.dps;
  }
  assert.equal(stormAt(s, stormEnd(s) + 10).r, 0);
  assert.ok(stormEnd(s) > 200 && stormEnd(s) < 300, 'a match lasts four or five minutes at most');
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
    assert.ok(b.dur > 8 && b.dur < 20);
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
    const x = (rng() * 2 - 1) * 95;
    const z = (rng() * 2 - 1) * 95;
    const a = rng() * Math.PI * 2;
    const len = 1 + rng() * 60;
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    const grid = castRay(m, x, z, dx, dz, len, -1, false);
    let brute = Infinity;
    for (const s of m.map.solids) brute = Math.min(brute, raySolid(s, x, z, dx, dz, len));
    assert.equal(grid?.t ?? Infinity, brute, `ray ${i}`);
  }
  // cells along a diagonal come in order, each next to the last
  const cells: number[] = [];
  walkCells(-90, -90, 90, 85, (c) => {
    cells.push(c);
  });
  for (let i = 1; i < cells.length; i++) {
    const d = Math.abs(cells[i] - cells[i - 1]);
    assert.ok(d === 1 || d === 25, 'neighbors');
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

test('walking over ammo, bandages and potions picks them up; guns need a free hand or the key', () => {
  const m = quiet();
  const me = m.fighters[0];
  const spot = openSpot(m);
  land(me, spot.x, spot.z);
  const put = (id: number, def: LootDef, dx = 0) => m.loot.set(id, { id, def, x: spot.x + dx, z: spot.z, by: -1, at: 0 });
  put(1, { kind: 'ammo', a: 'light', n: 30 });
  put(2, { kind: 'bandage', n: 2 });
  put(3, { kind: 'gun', w: 'smg', r: 2 });
  put(4, { kind: 'gun', w: 'rifle', r: 1 });
  put(5, { kind: 'gun', w: 'sniper', r: 4 }, 1.4);
  run(m, 0.1);
  assert.equal(me.ammo.light, 30);
  assert.equal(me.bandages, 2);
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
  me.ammo.light = AMMO_MAX.light;
  put(9, { kind: 'ammo', a: 'light', n: 30 });
  run(m, 0.1);
  assert.ok(m.loot.has(9), 'a full pouch leaves the box');
  assert.equal(AMMO_BOX.light, 30);
});

test('bandages and potions take time, and firing cuts them short', () => {
  const m = quiet();
  const me = m.fighters[0];
  const spot = openSpot(m);
  land(me, spot.x, spot.z);
  me.hp = 40;
  me.bandages = 2;
  me.shields = 1;
  me.input.heal = true;
  run(m, BANDAGE.time - 0.1);
  assert.equal(me.hp, 40, 'not yet');
  run(m, 0.2);
  assert.equal(me.hp, 40 + BANDAGE.heal);
  assert.equal(me.bandages, 1);
  me.input.heal = true;
  run(m, 0.5);
  me.input.fire = true;
  run(m, 0.05);
  me.input.fire = false;
  run(m, BANDAGE.time);
  assert.equal(me.hp, 40 + BANDAGE.heal, 'the swing broke it off');
  assert.equal(me.bandages, 1);
  me.input.shield = true;
  run(m, SHIELD.time + 0.1);
  assert.equal(me.shield, SHIELD.gain);
  me.hp = 100;
  me.input.heal = true;
  run(m, 0.1);
  assert.equal(me.using, null, 'no bandaging at full health');
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
  b.bandages = 3;
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
  assert.deepEqual(spilled.sort(), ['ammo', 'bandage', 'gun', 'wood']);
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
      const entrants: Entrant[] = names.slice(0, 8).map((name, i) => ({ name, color: '#fff', kind: 'bot', seat: -1 }));
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
      assert.ok(outs.length >= 6, 'everyone but the winner (or all) went out');
      assert.ok(shots > 20, `${level} seed ${seed}: they fought (${shots} shots)`);
      const places = m.fighters.map((f) => f.place).sort((a, b) => a - b);
      if (m.winner >= 0) assert.deepEqual(places, [1, 2, 3, 4, 5, 6, 7, 8], 'one of each place');
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
  for (const bad of [null, 1, 'x', {}, { t: 'pk', r: 1.5, k: 's', c: [] }, { t: 'pk', r: 1, k: 's', c: [1, 2] }, { t: 'pk', r: 1, k: 'S', sd: 1, tm: 0, lv: 'brutal', ro: [0], c: [] }, { t: 'pk', r: 1, k: 'S', sd: 1, tm: 0, lv: 'easy', ro: [0, 0], c: [] }, { t: 'pk', r: 1, k: 'end', w: 9, pl: [] }, { t: 'pk', r: 1, k: 'cfg', b: 'lots', lv: 'easy' }])
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
  const host = hostMatch(players, 0, opts.seed, opts.level, opts.bots ? 'fill' : 'none', COUNTDOWN + 1.2);
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
    const places = live[0].s.end!.places.map(([, place]) => place).sort((a, b) => a - b);
    if (live[0].s.end!.winner >= 0) assert.deepEqual(places, [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(live[0].s.end!.places, placesOf(host));
    for (const c of live) {
      const m = c.m!;
      assert.equal(m.fighters.length, 8);
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

test('the host sends what happened last before it sends the result', () => {
  const host = hostMatch([{ seat: 0, name: 'h' }, { seat: 1, name: 'g' }], 0, 3, 'normal', 'none', 0);
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
  const host = hostMatch(players, 0, 4, 'normal', 'fill', 4.2);
  const s = newSession(true, host.roster);
  const me: Me = { seat: 0, isHost: true, round: 1 };
  tick(s, host.match, me, [0, 1, 2], 0);
  tick(s, host.match, me, [0, 1], 0.1);
  assert.equal(host.match.fighters[2].phase, 'out', 'out as soon as they go, countdown or not');
  tick(s, host.match, me, [0, 1, 2], 0.2);
  assert.equal(host.match.fighters[2].phase, 'out');
  assert.equal(host.match.fighters[2].outCause, 'left');
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

// ---------------------------------------------------------------------------------------------------------------------
// Odds and ends.

test('loot tables only roll real things, and launchers are never common', () => {
  const rng = rng32(1);
  for (let i = 0; i < 3000; i++) {
    for (const tier of ['floor', 'crate', 'chest'] as const) {
      for (const def of rollLoot(rng, tier)) {
        assert.ok(parseLoot(def));
        if (def.kind === 'gun' && def.w === 'launcher') assert.ok(def.r >= 2);
        if (def.kind === 'gun' && tier === 'chest') assert.ok(def.r >= 1, 'chest guns are better than common');
        if (def.kind === 'wood') assert.ok(def.n <= WOOD_MAX);
      }
    }
  }
});

test('the scene only uses three.js classes the shared chunk exports', () => {
  const lib = readFileSync(join(import.meta.dirname, '..', 'src', 'os', 'arcade', 'kit', 'three-lib.ts'), 'utf8');
  const exported = new Set(/export \{([^}]+)\} from 'three'/.exec(lib)![1].split(',').map((s) => s.trim()));
  for (const file of ['scene.ts', 'gl.ts']) {
    const src = readFileSync(join(import.meta.dirname, '..', 'src', 'os', 'arcade', 'games', 'scramble', file), 'utf8');
    for (const [, name] of src.matchAll(/\bTHREE\.([A-Za-z0-9_]+)/g)) assert.ok(exported.has(name), `${file} uses THREE.${name}, which three-lib.ts doesn't export`);
  }
});

test('meta: eight seats with late joining, and a board per level', () => {
  assert.deepEqual(meta.online, { seats: 8, lateJoin: true });
  assert.deepEqual(Object.keys(meta.leaderboard!.variants!), [...LEVELS]);
  assert.equal(noInput().slot, -1);
});
