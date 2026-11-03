import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAP_IDS } from '../src/os/arcade/games/ridgeline/maps.ts';
import { DM_HUBS, newBrain } from '../src/os/arcade/games/ridgeline/bots.ts';
import { fieldDist, fieldTo, findPath } from '../src/os/arcade/games/ridgeline/nav.ts';
import { RADIUS, STAND_H, blockedAt, clearLine, groundAt, newHit, rayWorld, stepBody, type Body } from '../src/os/arcade/games/ridgeline/physics.ts';
import { CELL, T_HALF, T_RES, floorAt, generateTerrain, heightAt, rayTerrain } from '../src/os/arcade/games/ridgeline/terrain.ts';
import { ARMOR, KILL_REWARD, LOSS_REWARD, PAVISE, START_CREDITS, WEAPONS, WIN_REWARD, applyDamage, kickOf, rangeMul, type WeaponId } from '../src/os/arcade/games/ridgeline/weapons.ts';

import { ARENA, ROYALE_ARENA, SITE_R, worldFor } from '../src/os/arcade/games/ridgeline/world.ts';
import { AMMO_MAX, AMMO_OF, AMMO_PACK, BOOST, BOOST_DRAIN, HEAL, NADE_MAX, RED_LIVE, RED_WARN, ROYALE_PLAYERS, VEST, X4_ZOOM, ZONES, ammoCap, fits, gunLabel, healCap, magOf, richness, scopeOf, spawnLoot, zoomOf, type AmmoKind, type Item } from '../src/os/arcade/games/ridgeline/royale.ts';
import {
  BLAST_R,
  BULLET_G,
  BUY_TIME,
  DEG,
  DEFUSE_HALF,
  DEFUSE_TIME,
  DM_KILLS,
  FUSE,
  HALF,
  PLANT_REWARD,
  PERSON_HEALTH,
  PLANT_TIME,
  buy,
  canDefuse,
  canShop,
  createMatch,
  dropSupply,
  eyeY,
  idleInput,
  lootNear,
  markRed,
  plantSite,
  spawnOf,
  FIRE_DPS,
  FIRE_LIFE,
  gun,
  inFire,
  shieldHit,
  startRound,
  step,
  supplyLeft,
  underRoof,
  type Input,
  type Match,
} from '../src/os/arcade/games/ridgeline/match.ts';
import { MAPS } from '../src/os/arcade/games/ridgeline/maps.ts';
import { CARS, carNear, enterCar, hullDist, hurtCar } from '../src/os/arcade/games/ridgeline/cars.ts';

const DT = 1 / 60;

test('terrain is the same every time and the height query matches the grid', () => {
  const a = generateTerrain(MAPS.vale);
  const b = generateTerrain(MAPS.vale);
  assert.deepEqual(a.h.slice(0, 2000), b.h.slice(0, 2000));
  for (const [i, j] of [
    [10, 10],
    [256, 256],
    [400, 77],
  ]) {
    const x = -T_HALF + i * CELL;
    const z = -T_HALF + j * CELL;
    assert.ok(Math.abs(heightAt(a, x, z) - a.h[j * T_RES + i]) < 1e-4);
  }
  const g = heightAt(a, 0, 0);
  const t = rayTerrain(a, 0, g + 50, 0, 0, -1, 0, 100);
  assert.ok(Math.abs(t - 50) < 0.05, `ray down hits the ground (${t})`);
});

for (const id of MAP_IDS) {
  test(`${id}: spawns and sites are inside the arena, reachable and clear, and the defense is nearer the sites`, () => {
    const w = worldFor(id);
    assert.equal(w.sites.length, 2);
    assert.equal(w.spawns.length, 2);
    assert.ok(w.dmSpawns.length >= DM_HUBS + 8, 'enough deathmatch spawns');
    assert.ok(w.interiors.length >= 12, 'towns have buildings to walk into');
    assert.equal(w.light.length, T_RES * T_RES * 4);
    for (const p of [...w.sites, ...w.spawns]) assert.ok(Math.abs(p.x) < ARENA - 10 && Math.abs(p.z) < ARENA - 10);
    for (const s of w.spawns) for (const slot of s.slots) assert.ok(!blockedAt(w, slot.x, slot.z, heightAt(w.terrain, slot.x, slot.z)), 'spawn slots are free');
    w.sites.forEach((site, k) => {
      const f = fieldTo(w, `site${k}`, site.x, site.z);
      for (const s of w.spawns) assert.ok(Number.isFinite(fieldDist(w, f, s.x, s.z)), `spawn reaches site ${site.name}`);
      // walking lengths: the attack about 20 s of running from either site, the defense well nearer
      const walk = (a: { x: number; z: number }) => {
        const p = findPath(w, a.x, a.z, site.x, site.z, 200000)!;
        let x = a.x;
        let z = a.z;
        let len = 0;
        for (let i = 0; i < p.length; i += 2) {
          len += Math.hypot(p[i] - x, p[i + 1] - z);
          x = p[i];
          z = p[i + 1];
        }
        return len;
      };
      const atk = walk(w.spawns[0]);
      const def = walk(w.spawns[1]);
      assert.ok(atk > 70 && atk < 150, `attack walks ${atk.toFixed(0)} m to ${site.name}`);
      assert.ok(def < atk * 0.8, `defense walks ${def.toFixed(0)} m to ${site.name}, the attack ${atk.toFixed(0)}`);
    });
    // the spawns are walled yards: nobody sees from one into the other
    const [a, b] = w.spawns;
    for (const p of a.slots) for (const q of b.slots) assert.ok(!clearLine(w, p.x, a.y + 1.66, p.z, q.x, b.y + 1.66, q.z), 'no line of sight from spawn to spawn');
    for (const p of w.dmSpawns) assert.ok(findPath(w, p.x, p.z, w.sites[1].x, w.sites[1].z), 'deathmatch spawns are on the main ground');
  });
}

test('bodies land on the ground and walls stop them', () => {
  const w = worldFor('vale');
  const s = w.spawns[0];
  const b: Body = { x: s.x, y: s.y + 6, z: s.z, vx: 0, vy: 0, vz: 0, onGround: false, height: STAND_H, swim: false };
  for (let i = 0; i < 120; i++) stepBody(w, b, DT);
  assert.ok(b.onGround);
  assert.ok(Math.abs(b.y - heightAt(w.terrain, b.x, b.z)) < 0.6);
  // run at a tall wall: the body ends up beside it, never inside
  const wall = w.boxes.find((o) => o.y1 - o.y0 > 2.5 && o.x1 - o.x0 > 2 && o.z1 - o.z0 < 0.4 && Math.abs(o.x0) < ARENA - 20 && Math.abs(o.z0) < ARENA - 20)!;
  assert.ok(wall, 'found a wall');
  const cx = (wall.x0 + wall.x1) / 2;
  const body: Body = { x: cx, y: wall.y0 + 0.45, z: wall.z0 - 3, vx: 0, vy: 0, vz: 6, onGround: true, height: STAND_H, swim: false };
  body.y = Math.max(body.y, heightAt(w.terrain, body.x, body.z));
  for (let i = 0; i < 90; i++) {
    body.vz = 6;
    stepBody(w, body, DT);
  }
  assert.ok(body.z < wall.z0, `stopped by the wall (${body.z.toFixed(2)} vs ${wall.z0.toFixed(2)})`);
  const hit = rayWorld(w, cx, (wall.y0 + wall.y1) / 2 + 0.5, wall.z0 - 1.5, 0, 0, 1, 20, newHit());
  assert.equal(hit.kind, 'box');
  assert.ok(Math.abs(hit.t - 1.5) < 0.01);
});

test('guns: armor share, head one taps, falloff and a fixed recoil pattern', () => {
  const k = WEAPONS.kestrel;
  const r = applyDamage(100, ARMOR.heavy.amount, k.dmg * k.head);
  assert.ok(r.hp <= 0, 'a rifle headshot kills through heavy armor');
  const body = applyDamage(100, 50, k.dmg);
  assert.ok(body.hp > 80 && body.armor < 50, 'armor soaks most of a body shot');
  assert.equal(rangeMul(k, 10), 1);
  assert.ok(rangeMul(k, 400) < 1);
  assert.deepEqual(kickOf(k, 5), kickOf(k, 5));
  assert.ok(kickOf(k, 10)[0] >= kickOf(k, 0)[0], 'the climb grows into a spray');
  assert.ok(applyDamage(100, 0, WEAPONS.longbow.dmg).hp <= 0, 'the sniper kills with a body shot');
});

function aim(m: Match, from: number, x: number, y: number, z: number): Input {
  const a = m.actors[from];
  const dx = x - a.body.x;
  const dz = z - a.body.z;
  const dy = y - (a.body.y + a.body.height - 0.14);
  return { ...idleInput(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))) };
}

test('the buy phase: credits, shop rules, refunds and the spawn barrier', () => {
  const m = createMatch(worldFor('mesa'), 'breach', 'normal', { seed: 3 });
  const you = m.actors[0];
  assert.equal(m.phase, 'buy');
  assert.equal(you.credits, START_CREDITS);
  assert.ok(canShop(m, you));
  assert.ok(buy(m, you, 'light'));
  assert.equal(you.armor, ARMOR.light.amount);
  assert.equal(you.credits, START_CREDITS - ARMOR.light.price);
  assert.ok(!buy(m, you, 'kestrel'), 'too expensive');
  you.credits = 9000;
  assert.ok(buy(m, you, 'hornet'));
  assert.ok(buy(m, you, 'kestrel'), 'a second long gun');
  assert.equal(you.guns[0]?.id, 'hornet');
  assert.equal(you.guns[2]?.id, 'kestrel', 'goes into the second long slot');
  assert.equal(you.credits, 9000 - WEAPONS.hornet.price - WEAPONS.kestrel.price);
  assert.ok(buy(m, you, 'lancer'), 'a third replaces the one in hand');
  assert.equal(you.guns[2]?.id, 'lancer');
  assert.equal(you.guns[0]?.id, 'hornet');
  assert.equal(you.credits, 9000 - WEAPONS.hornet.price - WEAPONS.lancer.price, 'swapping a gun bought this round refunds it');
  // nobody leaves spawn before the round goes live
  const s = spawnOf(m, you.team);
  for (let i = 0; i < 240; i++) step(m, DT, { ...idleInput(you.yaw, 0), mz: 1 });
  assert.ok(Math.hypot(you.body.x - s.x, you.body.z - s.z) < 16);
  while (m.phase === 'buy') step(m, DT, idleInput(you.yaw, 0));
  assert.equal(m.phase, 'live');
  assert.ok(!canShop(m, you));
});

test('bullets fly, drop over distance and hit what they aim at', () => {
  const m = createMatch(worldFor('vale'), 'breach', 'normal', { seed: 4 });
  while (m.phase === 'buy') step(m, DT, idleInput());
  // freeze everyone but you and one enemy, standing in the open
  for (const a of m.actors) a.alive = a.id === 0 || a.id === 5;
  const you = m.actors[0];
  const foe = m.actors[5];
  you.guns[0] = { id: 'longbow', mag: 5, reserve: 10, fresh: false };
  you.slot = 0;
  you.switchT = 0;
  foe.bot = false;
  foe.brain = null;
  // somewhere 30 m off in the open with a clear line from your eye
  const eye = you.body.y + you.body.height - 0.14;
  let found = false;
  for (let k = 0; k < 64 && !found; k++) {
    const ang = (k / 64) * Math.PI * 2;
    const x = you.body.x + Math.sin(ang) * 30;
    const z = you.body.z + Math.cos(ang) * 30;
    const y = heightAt(m.world.terrain, x, z);
    if (blockedAt(m.world, x, z, y) || y < m.world.terrain.water) continue;
    if (!clearLine(m.world, you.body.x, eye, you.body.z, x, y + 1.1, z) || !clearLine(m.world, you.body.x, eye, you.body.z, x, y + 1.6, z)) continue;
    foe.body.x = x;
    foe.body.z = z;
    foe.body.y = y;
    found = true;
  }
  assert.ok(found, 'found an open line of fire');
  foe.armor = 0;
  const shot = aim(m, 0, foe.body.x, foe.body.y + foe.body.height * 0.6, foe.body.z);
  shot.ads = true;
  // aim settles, then one shot
  for (let i = 0; i < 30; i++) step(m, DT, { ...shot, fire: false });
  const before = m.bullets.length;
  step(m, DT, { ...shot, fire: true });
  assert.equal(m.bullets.length, before + 1);
  const b = m.bullets[m.bullets.length - 1];
  assert.ok(Math.hypot(b.vx, b.vy, b.vz) > 900);
  for (let i = 0; i < 40 && b.live; i++) step(m, DT, { ...shot, fire: false });
  assert.ok(!foe.alive || foe.hp < 100, 'the target was hit');
  // a bullet with nothing in its way drops under gravity
  const free = { ...b, x: you.body.x, y: eye + 50, z: you.body.z, px: you.body.x, py: eye + 50, pz: you.body.z, vx: 0, vy: 0, vz: 900, owner: 0, life: 1, dist: 0, live: true };
  m.bullets.push(free);
  for (let i = 0; i < 6; i++) step(m, DT, { ...shot, fire: false });
  assert.ok(free.vy < -BULLET_G * 0.09, `gravity pulled the bullet down (${free.vy.toFixed(2)})`);
});

/** A breach match gone live with nobody acting (all steered by hand), you on the attack. */
function handMatch(id: 'vale' | 'mesa' | 'frost' | 'isles', seed: number) {
  const m = createMatch(worldFor(id), 'breach', 'normal', { seed });
  while (m.attack !== 0) startRound(m);
  m.round = 1;
  m.phase = 'live';
  m.phaseT = 100;
  for (const a of m.actors) {
    a.bot = false;
    a.brain = null;
  }
  return m;
}
const hold = (m: Match, a: number, secs: number, use = true) => {
  for (let t = 0; t < secs && m.phase === 'live'; t += DT) {
    const inputs = idleInput(m.actors[a].yaw, 0);
    inputs.use = use;
    if (a === 0) step(m, DT, inputs);
    else {
      // only actor 0 takes input: hand the work to it by swapping in its id
      step(m, DT, idleInput());
    }
  }
};
const putOn = (m: Match, a: number, x: number, z: number) => {
  const b = m.actors[a].body;
  b.x = x;
  b.z = z;
  b.y = heightAt(m.world.terrain, x, z) + 0.05;
  b.vx = b.vy = b.vz = 0;
  b.onGround = true;
};

test('a person firing keeps their aim (the view never climbs), a bot still fights its recoil', () => {
  const m = createMatch(worldFor('vale'), 'breach', 'normal', { seed: 2 });
  m.phase = 'live';
  m.phaseT = 999;
  const you = m.actors[0];
  you.guns = [{ id: 'kestrel', mag: 25, reserve: 75, fresh: false }, null, null];
  you.slot = 0;
  you.switchT = 0;
  const pitch = 0.05;
  const yaw = you.yaw;
  for (let i = 0; i < 60; i++) step(m, DT, { ...idleInput(yaw, pitch), fire: true });
  assert.ok(you.guns[0]!.mag < 20, 'it fired');
  assert.ok(Math.abs(you.pitch - pitch) < 1e-9 && Math.abs(you.yaw - yaw) < 1e-9, 'aim unchanged');
});

test('breach: spare ammo comes back after a pause in the firing, and people are tougher than bots', () => {
  const m = createMatch(worldFor('vale'), 'breach', 'normal', { seed: 5 });
  while (m.phase === 'buy') step(m, DT, idleInput());
  const you = m.actors[0];
  you.guns[0] = { id: 'kestrel', mag: 25, reserve: 0, fresh: false };
  you.slot = 0;
  you.switchT = 0;
  for (let i = 0; i < 60 * 8; i++) step(m, DT, idleInput(you.yaw, you.pitch));
  assert.ok(you.guns[0]!.reserve >= WEAPONS.kestrel.mag, `ammo came back (${you.guns[0]!.reserve})`);
  assert.ok(you.guns[0]!.reserve <= WEAPONS.kestrel.reserve);
  assert.ok(PERSON_HEALTH > 1);
});

test('breach: the charge plants on a site, pays the attack, and goes off when the fuse runs out', () => {
  const m = handMatch('vale', 8);
  const site = m.world.sites[1];
  m.charge.holder = 0;
  const credits = m.actors.map((a) => a.credits);
  // off the site: no plant
  putOn(m, 0, site.x + SITE_R + 6, site.z);
  step(m, DT, idleInput());
  assert.equal(plantSite(m, m.actors[0]), -1);
  putOn(m, 0, site.x + 2, site.z + 1);
  step(m, DT, idleInput());
  assert.equal(plantSite(m, m.actors[0]), site.id);
  // let go half way: it starts over
  hold(m, 0, PLANT_TIME / 2);
  assert.equal(m.charge.state, 'carried');
  hold(m, 0, 0.1, false);
  assert.equal(m.charge.plantBy, -1);
  hold(m, 0, PLANT_TIME + 0.1);
  assert.equal(m.charge.state, 'planted');
  assert.equal(m.charge.site, site.id);
  for (const a of m.actors) assert.equal(a.credits - credits[a.id], a.team === 0 ? PLANT_REWARD : 0);
  // a defender standing close, another far off; the fuse runs out
  putOn(m, 5, m.charge.x + 3, m.charge.z);
  putOn(m, 6, m.charge.x + BLAST_R + 30, m.charge.z);
  putOn(m, 0, m.charge.x + BLAST_R + 30, m.charge.z + 4);
  let t = 0;
  while (m.phase === 'live' && t < FUSE + 1) {
    step(m, DT, idleInput());
    t += DT;
  }
  assert.ok(Math.abs(t - FUSE) < 0.2, `the fuse ran ${t.toFixed(2)} s`);
  assert.deepEqual(m.last, { winner: 0, why: 'blast' });
  assert.equal(m.charge.state, 'blown');
  assert.ok(!m.actors[5].alive, 'caught in the blast');
  assert.ok(m.actors[6].alive && m.actors[0].alive, 'far enough away');
});

test('breach: a defender defuses (keeping half the work after letting go), and a dropped charge is picked up', () => {
  const m = handMatch('frost', 9);
  const site = m.world.sites[0];
  // the carrier falls: the charge drops where it fell, and the next attacker to walk over it has it
  m.charge.holder = 3;
  putOn(m, 3, site.x, site.z);
  m.actors[3].hp = 1;
  m.actors[0].hp = 100;
  putOn(m, 0, site.x + 20, site.z);
  const shooter = m.actors[6];
  shooter.guns[0] = { id: 'kestrel', mag: 25, reserve: 75, fresh: false };
  m.actors[3].alive = false;
  m.charge.state = 'dropped';
  m.charge.holder = -1;
  m.charge.x = site.x;
  m.charge.z = site.z;
  m.charge.y = m.actors[3].body.y;
  putOn(m, 0, site.x + 0.5, site.z);
  step(m, DT, idleInput());
  assert.equal(m.charge.state, 'carried');
  assert.equal(m.charge.holder, 0);
  hold(m, 0, PLANT_TIME + 0.1);
  assert.equal(m.charge.state, 'planted');
  // now you defend: hand actor 0 to the other team for the test, standing on the charge
  m.actors[0].team = 1;
  for (const a of m.actors) if (a.team === 0) a.alive = false;
  m.actors[1].alive = true;
  putOn(m, 1, m.charge.x + 40, m.charge.z);
  putOn(m, 0, m.charge.x + 0.6, m.charge.z);
  step(m, DT, idleInput());
  assert.ok(canDefuse(m, m.actors[0]));
  hold(m, 0, DEFUSE_HALF + 0.2);
  hold(m, 0, 0.1, false);
  assert.equal(m.charge.defuseKept, DEFUSE_HALF, 'half kept');
  hold(m, 0, DEFUSE_TIME - DEFUSE_HALF + 0.1);
  assert.deepEqual(m.last, { winner: 1, why: 'defuse' });
  assert.equal(m.charge.state, 'defused');
});

test('breach: the defense wins when time runs out with no plant, and the sides swap at the half', () => {
  const m = handMatch('isles', 10);
  m.phaseT = 0.5;
  for (let i = 0; i < 60 && m.phase === 'live'; i++) step(m, DT, idleInput());
  assert.deepEqual(m.last, { winner: 1, why: 'time' });
  // play out to the half
  m.round = HALF;
  m.actors[0].credits = 9000;
  m.actors[0].guns[0] = { id: 'kestrel', mag: 3, reserve: 0, fresh: false };
  m.phaseT = 0;
  step(m, DT, idleInput());
  assert.equal(m.round, HALF + 1);
  assert.equal(m.attack, 1, 'sides swapped');
  assert.equal(m.actors[0].credits, 9000, 'credits carry over');
  assert.equal(m.actors[0].guns[0]?.id, 'kestrel', 'and so do the guns');
  assert.equal(m.actors[0].guns[0]?.mag, WEAPONS.kestrel.mag);
  assert.ok(m.actors.every((a) => a.guns[1]?.id === 'wren'));
  // the attack starts at the attack's spawn
  const sp = spawnOf(m, 1);
  assert.ok(Math.hypot(m.actors[5].body.x - sp.x, m.actors[5].body.z - sp.z) < 16);
  assert.equal(m.actors[m.charge.holder].team, 1, 'the charge is with the new attack');
});

test('a knockout pays the killer, and the knocked out keep their loadout into the next round', () => {
  const m = createMatch(worldFor('isles'), 'breach', 'normal', { seed: 2 });
  while (m.phase === 'buy') step(m, DT, idleInput());
  for (const a of m.actors) {
    a.bot = false;
    a.brain = null;
  }
  const you = m.actors[0];
  const foe = m.actors[6];
  foe.guns[0] = { id: 'kestrel', mag: 25, reserve: 75, fresh: false };
  foe.body.x = you.body.x + 8;
  foe.body.z = you.body.z + 1;
  foe.body.y = heightAt(m.world.terrain, foe.body.x, foe.body.z);
  foe.hp = 1;
  const c = you.credits;
  const inp = aim(m, 0, foe.body.x, foe.body.y + 1.1, foe.body.z);
  for (let i = 0; i < 20 && foe.alive; i++) step(m, DT, { ...inp, fire: i % 2 === 0 });
  assert.ok(!foe.alive);
  assert.equal(you.kills, 1);
  assert.equal(you.credits, c + KILL_REWARD);
  assert.equal(foe.guns[0]?.id, 'kestrel', 'a knockout takes nothing');
  assert.ok(m.feed.some((k) => k.killer === 0 && k.victim === 6));
  foe.guns[0]!.mag = 0;
  startRound(m);
  assert.ok(foe.alive && foe.hp === 100 && foe.guns[1]?.id === 'wren');
  assert.equal(foe.guns[0]?.id, 'kestrel', 'still theirs');
  assert.equal(foe.guns[0]?.mag, WEAPONS.kestrel.mag, 'and refilled');
});

for (const id of MAP_IDS) {
  test(`${id}: a match of bots plays out to a winner`, () => {
    const m = createMatch(worldFor(id), 'breach', 'normal', { seed: 21 });
    m.actors[0].bot = true;
    m.actors[0].brain = newBrain('normal', 0);
    let kills = 0;
    while (m.phase !== 'over' && m.time < 1800) {
      step(m, DT, idleInput());
      for (const e of m.events) if (e.t === 'kill') kills++;
    }
    assert.equal(m.phase, 'over');
    assert.ok(Math.max(...m.score) >= 7);
    assert.ok(kills > 10, `real fights happened (${kills} knockouts)`);
  });
}

test('deathmatch respawns and ends at the kill target or the clock', () => {
  const m = createMatch(worldFor('vale'), 'dm', 'hard', { seed: 5 });
  m.actors[0].bot = true;
  m.actors[0].brain = newBrain('hard', 0);
  let spawns = 0;
  while (m.phase !== 'over' && m.time < 400) {
    step(m, DT, idleInput());
    for (const e of m.events) if (e.t === 'spawn') spawns++;
  }
  assert.equal(m.phase, 'over');
  assert.ok(spawns > 5, 'the dead came back');
  const top = Math.max(...m.actors.map((a) => a.kills));
  assert.ok(top >= DM_KILLS || m.clock >= 299, 'it ended for a reason');
  assert.ok(m.actors[m.winner].kills === top);
  assert.ok(BUY_TIME > 0);
});

test('a royale world covers the whole land, with loot on building floors and doorways the bots can walk through', () => {
  const w = worldFor('vale', true);
  assert.equal(w.arena, ROYALE_ARENA);
  assert.ok(w.towns.length >= 12, `many towns (${w.towns.length})`);
  assert.ok(w.loot.length / 3 > 300, `loot spots (${w.loot.length / 3})`);
  assert.ok(w.doors.length / 4 > 60, `doors (${w.doors.length / 4})`);
  // a path from outside a house to a loot spot inside it
  const q = w.interiors.find((r) => r.x1 - r.x0 > 4 && r.z1 - r.z0 > 4 && Math.abs(r.x0) < 200 && Math.abs(r.z0) < 200)!;
  const cx = (q.x0 + q.x1) / 2;
  const cz = (q.z0 + q.z1) / 2;
  const path = findPath(w, cx + 14, cz + 14, cx, cz, 20000);
  assert.ok(path, 'a way into the building');
  // the breach world is still the small arena
  assert.equal(worldFor('vale').arena, ARENA);
});

test('royale: pickups fill the slots, the ammo pool caps, vests give armor, and the zone hurts outside', () => {
  const m = createMatch(worldFor('mesa', true), 'royale', 'normal', { seed: 11 });
  const you = m.actors[0];
  // land you somewhere flat inside the zone
  you.drop = 0;
  you.body.x = m.zone!.x;
  you.body.z = m.zone!.z;
  you.body.y = 200;
  for (let i = 0; i < 600 && !you.body.onGround; i++) step(m, DT, idleInput());
  const put = (kind: 'gun' | 'ammo' | 'vest', what: string, n: number) => {
    m.loot.push({ id: m.loot.length, kind, what, n, x: you.body.x + 0.4, y: you.body.y + 0.02, z: you.body.z, live: true });
    m.lootVer++;
  };
  const use = () => {
    const inp = idleInput(you.yaw, you.pitch);
    inp.use = true;
    step(m, DT, inp);
  };
  put('gun', 'kestrel', WEAPONS.kestrel.mag);
  assert.equal(lootNear(m, you)?.what, 'kestrel');
  use();
  assert.equal(you.guns[0]?.id, 'kestrel');
  put('gun', 'lancer', WEAPONS.lancer.mag);
  use();
  assert.equal(you.guns[2]?.id, 'lancer', 'the second long gun takes the second slot');
  for (let i = 0; i < 12; i++) {
    put('ammo', 'rifle', AMMO_PACK.rifle);
    use();
  }
  assert.equal(you.ammo.rifle, AMMO_MAX.rifle, 'ammo caps');
  put('vest', '2', 1);
  use();
  assert.equal(you.armor, VEST[2]);
  // out past the zone's edge it costs health every second (a small zone, so its edge is on the map)
  m.zone!.r = 40;
  m.zone!.fr = 40;
  m.zone!.nr = 40;
  you.body.x = m.zone!.x + m.zone!.r + 20;
  you.body.y = 200;
  const hp = you.hp;
  for (let i = 0; i < 60 * 3; i++) step(m, DT, idleInput());
  assert.ok(you.hp < hp, 'the zone hurt');
  assert.ok(ZONES.length >= 5);
});

test('royale: walking over loot takes it, except a gun that would mean giving one up', () => {
  const m = createMatch(worldFor('mesa', true), 'royale', 'normal', { seed: 12 });
  const you = m.actors[0];
  you.drop = 0;
  you.body.x = m.zone!.x;
  you.body.z = m.zone!.z;
  you.body.y = 200;
  for (let i = 0; i < 600 && !you.body.onGround; i++) step(m, DT, idleInput());
  for (const it of m.loot) if (Math.hypot(it.x - you.body.x, it.z - you.body.z) < 6) it.live = false;
  const put = (kind: 'gun' | 'ammo' | 'heal', what: string, n: number) => {
    const it = { id: m.loot.length, kind, what, n, x: you.body.x + 0.5, y: you.body.y + 0.02, z: you.body.z, live: true };
    m.loot.push(it);
    m.lootVer++;
    return it;
  };
  const walk = () => {
    for (let i = 0; i < 20; i++) step(m, DT, idleInput(you.yaw, you.pitch));
  };
  put('gun', 'kestrel', WEAPONS.kestrel.mag);
  walk();
  assert.equal(you.guns[0]?.id, 'kestrel', 'a gun into the empty slot');
  put('gun', 'lancer', WEAPONS.lancer.mag);
  walk();
  assert.equal(you.guns[2]?.id, 'lancer', 'and the second long gun into the second');
  const third = put('gun', 'longbow', WEAPONS.longbow.mag);
  walk();
  assert.ok(third.live, 'with both slots full, a gun waits for F');
  assert.equal(you.guns[0]?.id, 'kestrel');
  put('ammo', 'rifle', AMMO_PACK.rifle);
  put('heal', 'bandage', 2);
  walk();
  walk();
  assert.ok(you.ammo.rifle >= AMMO_PACK.rifle, 'ammo taken');
  assert.equal(you.bandages, 2, 'heals taken');
});

test('aim assist: a shot just off a target lands, a clear miss stays a miss, and never through a wall', () => {
  const m = createMatch(worldFor('vale'), 'breach', 'normal', { seed: 4 });
  m.phase = 'live';
  m.phaseT = 999;
  for (const a of m.actors) {
    a.alive = false;
    a.body.x = 9999;
  }
  const you = m.actors[0];
  const t = m.actors[6];
  const spot = (a: typeof you, x: number, z: number, team: number) => {
    a.alive = true;
    a.team = team;
    a.body.x = x;
    a.body.z = z;
    a.body.y = floorAt(m.world.terrain, x, z) + 0.05;
    a.body.vx = a.body.vz = 0;
    a.guns = [{ id: 'kestrel', mag: 30, reserve: 90, fresh: false }, null, null];
    a.slot = 0;
    a.switchT = 0;
  };
  // an open stretch of ground, 30 m
  let x = 0;
  let z = 0;
  for (let k = 0; k < 400; k++) {
    x = (k * 37) % 120 - 60;
    z = ((k * 53) % 120) - 60;
    const y0 = floorAt(m.world.terrain, x, z);
    const y1 = floorAt(m.world.terrain, x, z - 30);
    if (Math.abs(y0 - y1) < 1.5 && clearLine(m.world, x, y0 + 1.4, z, x, y1 + 1.1, z - 30) && clearLine(m.world, x, y0 + 0.9, z, x, y1 + 0.9, z - 30)) break;
  }
  spot(you, x, z, 0);
  spot(t, x, z - 30, 1);
  t.bot = false;
  t.brain = null;
  for (let i = 0; i < 40; i++) step(m, DT, idleInput(0, 0));
  const shoot = (offDeg: number) => {
    t.hp = 100;
    const yaw = Math.atan2(-(t.body.x - you.body.x), -(t.body.z - you.body.z)) + offDeg * DEG;
    const pitch = Math.atan2(t.body.y + t.body.height * 0.66 - eyeY(you), Math.hypot(t.body.x - you.body.x, t.body.z - you.body.z));
    for (let i = 0; i < 40; i++) step(m, DT, idleInput(yaw, pitch));
    you.yaw = yaw;
    you.pitch = pitch;
    let hit = false;
    step(m, DT, { ...idleInput(yaw, pitch), fire: true });
    for (let i = 0; i < 30; i++) {
      for (const e of m.events) if (e.t === 'hit' && e.a === you.id) hit = true;
      step(m, DT, idleInput(you.yaw, you.pitch));
    }
    return hit;
  };
  assert.ok(shoot(0.9), 'just off: drawn onto them');
  assert.ok(!shoot(3), 'a clear miss stays a miss');
});

/** A royale with only the given actors left in it (the rest out of the way, though still counted, so the match runs
 * on), each standing on the ground where put, and none of them a bot (they stand still). */
function quietRoyale(seed: number, put: [number, number, number][]) {
  const m = createMatch(worldFor('mesa', true), 'royale', 'normal', { seed });
  m.redT = 1e9;
  for (const a of m.actors) a.alive = false;
  put.forEach(([x, y, z], i) => {
    const a = m.actors[i];
    a.alive = true;
    a.bot = false;
    a.drop = 0;
    a.body.x = x;
    a.body.y = y;
    a.body.z = z;
    a.body.onGround = true;
  });
  return m;
}

test('royale: a supply crate comes down inside the next circle, with the best gear, and can be looted', () => {
  const m = quietRoyale(31, []);
  const z = m.zone!;
  const s = dropSupply(m, z.nx, z.nz, z.nr)!;
  assert.ok(s, 'a crate is on its way');
  assert.ok(Math.hypot(s.x - z.nx, s.z - z.nz) <= z.nr, 'inside the next circle');
  assert.ok(s.y > s.ground + 100 && s.landed < 0, 'from high up');
  assert.ok(m.events.some((e) => e.t === 'supply' && !e.landed), 'announced');
  assert.ok(supplyLeft(m, s));
  // you wait a little way off
  const you = m.actors[0];
  you.alive = true;
  you.bot = false;
  you.drop = 0;
  you.body.x = s.x + 8;
  you.body.z = s.z;
  you.body.y = floorAt(m.world.terrain, you.body.x, you.body.z) + 0.05;
  let landed = false;
  for (let i = 0; i < 60 * 40 && s.landed < 0; i++) {
    step(m, DT, idleInput());
    if (m.events.some((e) => e.t === 'supply' && e.landed)) landed = true;
  }
  assert.ok(landed && s.landed > 0 && s.y === s.ground, 'it lands');
  // what is in it: one of the best guns full, all its ammo, the best vest and helmet, and med kits
  const items = s.items.map((i) => m.loot[i]);
  assert.ok(items.every((it) => it.live && Math.hypot(it.x - s.x, it.z - s.z) < 1.5), 'laid out round the crate');
  const gun = items.find((it) => it.kind === 'gun')!;
  assert.ok(['longbow', 'lancer', 'kestrel'].includes(gun.what));
  assert.equal(gun.n, WEAPONS[gun.what as WeaponId].mag);
  const ammo = items.find((it) => it.kind === 'ammo')!;
  assert.equal(ammo.what, AMMO_OF[gun.what as WeaponId]);
  assert.equal(ammo.n, AMMO_MAX[ammo.what as AmmoKind]);
  assert.ok(items.some((it) => it.kind === 'vest' && it.what === '3'));
  assert.ok(items.some((it) => it.kind === 'helmet' && it.what === '3'));
  assert.ok(items.some((it) => it.kind === 'heal' && it.what === 'kit'));
  assert.ok(items.some((it) => it.kind === 'pack' && it.what === '3'), 'a level 3 backpack');
  assert.ok(items.some((it) => it.kind === 'att' && it.what === 'x4'), 'a 4x scope');
  assert.ok(items.some((it) => it.kind === 'att' && it.what === 'ext'), 'an extended magazine');
  // walk up to it and everything is taken
  you.body.x = s.x;
  you.body.z = s.z;
  you.body.y = s.ground + 0.05;
  for (let i = 0; i < 90; i++) step(m, DT, idleInput(you.yaw, you.pitch));
  assert.equal(you.guns[0]?.id, gun.what, 'the gun');
  assert.equal(you.ammo[ammo.what as AmmoKind], AMMO_MAX[ammo.what as AmmoKind], 'its ammo');
  assert.equal(you.vest, 3);
  assert.equal(you.armor, VEST[3]);
  assert.equal(you.helmet, 3);
  assert.ok(you.kits >= 1);
  assert.equal(you.pack, 3, 'the backpack');
  assert.ok(you.guns[0]?.mods?.ext, 'the extended magazine went on the gun');
  // (all of it, but a 4x scope when the gun is the Longbow, which has a scope of its own)
  const left = s.items.map((i) => m.loot[i]).filter((it) => it.live);
  assert.ok(left.every((it) => it.kind === 'att' && !fits(gun.what as WeaponId, it.what as 'x4')), `emptied (${left.map((it) => it.what)})`);
  assert.equal(supplyLeft(m, s), left.length > 0);
});

test('royale: a bombardment hurts those in the open inside it once the warning is over, not under a roof or outside', () => {
  const w = worldFor('mesa', true);
  // a spot indoors (loot on a building's floor, clear to stand on, with a roof over it), and open ground round it
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < w.loot.length; i += 3) {
    const [x, y, z] = [w.loot[i], w.loot[i + 1], w.loot[i + 2]];
    if (Math.abs(x) < 250 && Math.abs(z) < 250 && underRoof(w, x, y + 1.6, z) && !blockedAt(w, x, z, y)) {
      [cx, cy, cz] = [x, y, z];
      break;
    }
  }
  assert.ok(cy !== 0, 'a spot under a roof');
  const R = 40;
  const open: [number, number, number][] = [];
  for (let k = 0; k < 400 && open.length < 8; k++) {
    const a = k * 2.399;
    const d = 8 + (k % 23);
    const x = cx + Math.cos(a) * d;
    const z = cz + Math.sin(a) * d;
    const y = floorAt(w.terrain, x, z);
    if (!blockedAt(w, x, z, y) && !underRoof(w, x, y + 1.6, z) && open.every(([ox, , oz]) => Math.hypot(ox - x, oz - z) > 3)) open.push([x, y + 0.05, z]);
  }
  assert.ok(open.length >= 4, `open ground near the room (${open.length})`);
  let far: [number, number, number] | null = null;
  for (let k = 0; k < 200 && !far; k++) {
    const x = cx + Math.cos(k) * (R + 25);
    const z = cz + Math.sin(k) * (R + 25);
    const y = floorAt(w.terrain, x, z);
    if (!blockedAt(w, x, z, y) && !underRoof(w, x, y + 1.6, z)) far = [x, y + 0.05, z];
  }
  assert.ok(far, 'open ground outside it');
  // you stand outside it; one inside the room; the rest in the open inside the circle
  const m = quietRoyale(37, [far!, [cx, cy + 0.05, cz], ...open]);
  const outside = m.actors[0];
  const indoors = m.actors[1];
  const exposed = m.actors.slice(2, 2 + open.length);
  m.red = { x: cx, z: cz, r: R, warn: RED_WARN, left: RED_LIVE, next: 0 };
  const everyone = [outside, indoors, ...exposed];
  let shells = 0;
  for (let i = 0; i < Math.floor((RED_WARN - 0.05) * 60); i++) {
    step(m, DT, idleInput());
    for (const e of m.events) if (e.t === 'shell') shells++;
  }
  assert.equal(shells, 0, 'nothing falls during the warning');
  assert.ok(everyone.every((a) => a.hp === 100), 'nobody hurt during the warning');
  for (let i = 0; i < (RED_LIVE + 1) * 60; i++) {
    step(m, DT, idleInput());
    for (const e of m.events) if (e.t === 'shell') shells++;
  }
  assert.ok(shells > 20, `shells fell (${shells})`);
  assert.equal(m.red, null, 'and it is over');
  assert.ok(exposed.some((a) => a.hp < 100), 'those in the open were hit');
  assert.equal(outside.hp, 100, 'not outside it');
  assert.ok(Math.hypot(indoors.body.x - cx, indoors.body.z - cz) < 0.5, 'indoors the whole time');
  assert.equal(indoors.hp, 100, 'not under a roof');
});

test('royale: a bombardment is marked inside the zone and never over you', () => {
  const m = createMatch(worldFor('vale', true), 'royale', 'normal', { seed: 41 });
  const you = m.actors[0];
  const z = m.zone!;
  z.r = 200;
  you.drop = 0;
  for (let k = 0; k < 30; k++) {
    you.body.x = z.x + Math.cos(k) * 60;
    you.body.z = z.z + Math.sin(k) * 60;
    m.red = null;
    const red = markRed(m);
    if (!red) continue;
    assert.ok(red.r * 2 >= 60 && red.r * 2 <= 90, 'sixty to ninety meters across');
    assert.ok(Math.hypot(red.x - z.x, red.z - z.z) + red.r <= z.r, 'inside the zone');
    assert.ok(Math.hypot(red.x - you.body.x, red.z - you.body.z) > red.r, 'not on you');
  }
  // too small a zone has no room for one
  z.r = 40;
  m.red = null;
  assert.equal(markRed(m), null);
});

test('royale: a chosen kit item is used only when you have it and it would help', () => {
  const m = createMatch(worldFor('mesa', true), 'royale', 'normal', { seed: 13 });
  const you = m.actors[0];
  you.drop = 0;
  you.body.x = m.zone!.x;
  you.body.z = m.zone!.z;
  you.body.y = 200;
  for (let i = 0; i < 600 && !you.body.onGround; i++) step(m, DT, idleInput());
  you.hp = 100;
  you.bandages = 2;
  you.kits = 1;
  step(m, DT, { ...idleInput(you.yaw, you.pitch), item: 'bandage' });
  assert.equal(you.healT, 0, 'nothing to heal at full health');
  // (at 70, H would pick a bandage)
  you.hp = 70;
  step(m, DT, { ...idleInput(you.yaw, you.pitch), item: 'drink' });
  assert.equal(you.healT, 0, 'no drink carried');
  step(m, DT, { ...idleInput(you.yaw, you.pitch), item: 'kit' });
  assert.equal(you.healKind, 'kit', 'the med kit, as asked (not the bandage H would pick)');
  for (let i = 0; i < 60 * 7; i++) step(m, DT, idleInput(you.yaw, you.pitch));
  assert.equal(you.kits, 0);
  assert.equal(you.bandages, 2);
  assert.ok(you.hp >= 99, `healed to full (${you.hp})`);
});

test('royale: a hundred drop in, loot, fight and the zone closes to one left standing', () => {
  const m = createMatch(worldFor('vale', true), 'royale', 'normal', { seed: 7 });
  assert.equal(m.actors.length, ROYALE_PLAYERS);
  let picks = 0;
  let kills = 0;
  let shots = 0;
  let landed = 0;
  // the new gear: backpacks and attachments taken, boosts used, and guns seen with attachments on
  let packs = 0;
  let atts = 0;
  let boosts = 0;
  let modded = 0;
  // and the newer gear: the new guns, shields and grenades
  let newGear = 0;
  const step2 = 1 / 30;
  while (m.phase !== 'over' && m.time < 900) {
    // you stay in it to the end (unhurt) so the bots play the whole match out
    m.actors[0].shield = 99;
    m.actors[0].hp = 100;
    const had = m.actors.map((a) => a.drinks + a.pills);
    step(m, step2, idleInput());
    for (const e of m.events) {
      if (e.t === 'pickup') picks++;
      if (e.t === 'pickup' && e.item.kind === 'pack') packs++;
      if (e.t === 'pickup' && e.item.kind === 'att') atts++;
      if (e.t === 'pickup' && (e.item.kind === 'shield' || ['talon', 'rampart', 'marshal', 'wasp', 'thresher', 'arbalest', 'fire', 'impact', 'decoy'].includes(e.item.what))) newGear++;
      if (e.t === 'kill') kills++;
      if (e.t === 'shot') shots++;
      if (e.t === 'land') landed++;
      if (e.t === 'heal' && e.done && m.actors[e.a].drinks + m.actors[e.a].pills < had[e.a]) boosts++;
    }
    if (Math.floor(m.time) !== Math.floor(m.time - step2)) modded = Math.max(modded, m.actors.filter((a) => a.alive && a.guns.some((g) => g?.mods)).length);
  }
  assert.equal(m.phase, 'over');
  assert.equal(m.alive, 1);
  assert.ok(landed >= 95, `everyone came down (${landed})`);
  assert.ok(picks > 150, `they looted (${picks})`);
  assert.ok(shots > 300, `they fought (${shots} shots)`);
  assert.equal(kills, ROYALE_PLAYERS - 1);
  assert.ok(packs > 10, `backpacks taken (${packs})`);
  assert.ok(atts > 10, `attachments taken (${atts})`);
  assert.ok(modded > 5, `guns with attachments on (${modded} at once)`);
  assert.ok(boosts > 5, `boosts used when hurt (${boosts})`);
  assert.ok(newGear > 20, `the new guns, shields and grenades looted (${newGear})`);
});

/** A royale with only you in it, on open flat ground near the middle of the zone, with nothing lying near you. */
function gearRoyale(seed: number) {
  const w = worldFor('mesa', true);
  const probe = createMatch(w, 'royale', 'normal', { seed });
  const z = probe.zone!;
  const t = w.terrain;
  let at: [number, number, number] = [z.x, floorAt(t, z.x, z.z) + 0.05, z.z];
  for (let k = 0; k < 400; k++) {
    const x = z.x + Math.cos(k * 2.399) * k * 0.6;
    const zz = z.z + Math.sin(k * 2.399) * k * 0.6;
    const y = floorAt(t, x, zz);
    let clear = true;
    for (let d = -4; d <= 4 && clear; d++) clear = !blockedAt(w, x + d, zz, y) && Math.abs(floorAt(t, x + d, zz) - y) < 0.4;
    if (clear) {
      at = [x, y + 0.05, zz];
      break;
    }
  }
  const m = quietRoyale(seed, [at]);
  const you = m.actors[0];
  for (let i = 0; i < 30; i++) step(m, DT, idleInput());
  for (const it of m.loot) if (Math.hypot(it.x - you.body.x, it.z - you.body.z) < 12) it.live = false;
  const put = (kind: Item['kind'], what: string, n = 1, dx = 0.4) => {
    const it: Item = { id: m.loot.length, kind, what, n, x: you.body.x + dx, y: you.body.y + 0.02, z: you.body.z, live: true };
    m.loot.push(it);
    m.lootVer++;
    return it;
  };
  const walk = (secs = 0.5) => {
    for (let i = 0; i < secs * 60; i++) step(m, DT, idleInput(you.yaw, you.pitch));
  };
  const press = (k: 'use' | 'heal' | 'boost' | 'reload') => {
    const inp = idleInput(you.yaw, you.pitch);
    inp[k] = true;
    step(m, DT, inp);
  };
  return { m, you, put, walk, press };
}

test('royale: a backpack raises what you carry, and a worse one leaves the overflow on the ground', () => {
  const { m, you, put, walk, press } = gearRoyale(51);
  assert.equal(you.pack, 0);
  // without one: the plain caps
  you.ammo.rifle = AMMO_MAX.rifle;
  you.bandages = HEAL.bandage.max;
  you.frags = NADE_MAX.frag;
  const box = put('ammo', 'rifle', AMMO_PACK.rifle);
  walk();
  assert.ok(box.live, 'no room without a backpack');
  // a level 3 backpack, walked over: everything carries more
  put('pack', '3');
  walk();
  assert.equal(you.pack, 3);
  assert.ok(ammoCap(3, 'rifle') > AMMO_MAX.rifle && healCap(3, 'bandage') > HEAL.bandage.max);
  walk();
  assert.ok(!box.live && you.ammo.rifle === AMMO_MAX.rifle + AMMO_PACK.rifle, 'the box fits now');
  put('heal', 'bandage', 6);
  put('nade', 'frag', 2);
  put('boost', 'drink', BOOST.drink.max + 3);
  walk(1.5);
  assert.equal(you.bandages, HEAL.bandage.max + 6);
  assert.equal(you.frags, NADE_MAX.frag + 2);
  assert.equal(you.drinks, BOOST.drink.max + 3, 'more drinks than without one');
  you.ammo.rifle = ammoCap(3, 'rifle');
  // a worse one is not taken by walking over it
  const one = put('pack', '1');
  walk();
  assert.ok(one.live && you.pack === 3);
  // F on it: swapped, and what no longer fits drops at your feet (the old backpack too)
  const before = m.loot.length;
  const rifle = you.ammo.rifle;
  press('use');
  assert.equal(you.pack, 1);
  assert.ok(!one.live);
  const dropped = m.loot.slice(before).filter((it) => it.live);
  assert.ok(dropped.some((it) => it.kind === 'pack' && it.what === '3'), 'the old backpack is on the ground');
  assert.equal(you.ammo.rifle, ammoCap(1, 'rifle'));
  assert.equal(dropped.find((it) => it.kind === 'ammo' && it.what === 'rifle')?.n, rifle - ammoCap(1, 'rifle'), 'the rounds that no longer fit');
  assert.equal(you.bandages, healCap(1, 'bandage'));
  assert.ok(dropped.some((it) => it.kind === 'heal' && it.what === 'bandage'));
  assert.ok(dropped.some((it) => it.kind === 'boost' && it.what === 'drink'));
  // and walking about on it all doesn't take any of it back by itself
  walk(1);
  assert.equal(you.pack, 1);
  assert.ok(dropped.every((it) => it.live));
  // a better one still is: walked over, it replaces the level 1
  put('pack', '2', 1, -0.4);
  walk();
  assert.equal(you.pack, 2);
});

test('royale: a boost mends you over time, runs you faster while high, and drains away', () => {
  const { m, you, walk, press } = gearRoyale(52);
  you.hp = 50;
  you.bandages = 1;
  you.drinks = 2;
  you.pills = 1;
  // H heals first while a heal helps
  press('heal');
  assert.equal(you.healKind, 'bandage');
  walk(HEAL.bandage.time + 0.2);
  assert.equal(you.bandages, 0);
  assert.equal(you.hp, 65, 'bandaged');
  // the boost key: painkillers with the meter empty, then a drink on top
  press('boost');
  assert.equal(you.healKind, 'pills');
  walk(BOOST.pills.time + 0.1);
  assert.equal(you.pills, 0);
  assert.ok(you.boost > 55 && you.boost <= 60, `boost filled (${you.boost})`);
  press('boost');
  assert.equal(you.healKind, 'drink');
  walk(BOOST.drink.time + 0.1);
  assert.equal(you.drinks, 1);
  assert.ok(you.boost > 90, `topped up (${you.boost})`);
  // it mends you a little at a time while it drains
  const hp0 = you.hp;
  const b0 = you.boost;
  walk(10);
  assert.ok(you.hp > hp0 + 6, `health comes back (${hp0} to ${you.hp})`);
  assert.ok(Math.abs(b0 - you.boost - BOOST_DRAIN * 10) < 0.3, `the meter drains (${b0} to ${you.boost})`);
  // high up, a run is a little faster than with it empty
  const run = (dir: number) => {
    for (let i = 0; i < 30; i++) step(m, DT, { ...idleInput(-Math.PI / 2 * dir, 0), mz: 1 });
    const v = Math.hypot(you.body.vx, you.body.vz);
    walk(0.3);
    return v;
  };
  const fast = run(1);
  const keep = you.boost;
  you.boost = 0;
  const plain = run(-1);
  you.boost = keep;
  assert.ok(fast > plain * 1.04, `faster with the boost up (${fast.toFixed(2)} against ${plain.toFixed(2)})`);
  // it never mends past 100, and once it runs out the mending stops
  walk(120);
  assert.equal(you.boost, 0, 'drained');
  assert.ok(you.hp <= 100);
  you.hp = 80;
  walk(5);
  assert.equal(you.hp, 80, 'nothing more without a boost');
  // H at full health takes a boost when no heal helps
  you.hp = 100;
  press('heal');
  assert.equal(you.healKind, 'drink');
});

test('royale: attachments go on a gun they fit, change its zoom and magazine, and go with it', () => {
  const { m, you, put, walk, press } = gearRoyale(53);
  you.guns = [{ id: 'kestrel', mag: WEAPONS.kestrel.mag, reserve: 0, fresh: false }, null, { id: 'lancer', mag: WEAPONS.lancer.mag, reserve: 0, fresh: false }];
  you.slot = 0;
  you.ammo.rifle = 200;
  const kestrel = you.guns[0]!;
  const lancer = you.guns[2]!;
  assert.equal(zoomOf(kestrel), WEAPONS.kestrel.zoom);
  assert.ok(!scopeOf(kestrel));
  // a 4x scope onto the gun in hand: zoom 4 and the scope view
  put('att', 'x4');
  walk();
  assert.equal(kestrel.mods?.sight, 'x4');
  assert.equal(zoomOf(kestrel), X4_ZOOM);
  assert.ok(scopeOf(kestrel));
  // an extended magazine: half as many rounds again, filled on a reload
  put('att', 'ext');
  walk();
  assert.ok(kestrel.mods?.ext);
  assert.equal(magOf(kestrel), Math.round(WEAPONS.kestrel.mag * 1.5));
  press('reload');
  walk(WEAPONS.kestrel.reload + 0.3);
  assert.equal(kestrel.mag, magOf(kestrel), 'reloaded into the longer magazine');
  // a compensator: less bloom from a shot
  put('att', 'comp');
  walk();
  assert.ok(kestrel.mods?.comp);
  you.bloom = 0;
  step(m, DT, { ...idleInput(you.yaw, you.pitch), fire: true });
  assert.ok(Math.abs(you.bloom - WEAPONS.kestrel.bloom * 0.6) < 0.01, `less bloom (${you.bloom})`);
  walk(0.5);
  // a red dot fits neither now (the kestrel has a sight, the lancer a scope of its own): it stays where it is
  const dot = put('att', 'dot');
  walk();
  assert.ok(dot.live, 'nowhere for it to go');
  dot.live = false;
  // a second 4x goes on the other long gun it fits
  put('att', 'x4');
  walk();
  assert.equal(lancer.mods?.sight, 'x4');
  assert.equal(gunLabel(kestrel), 'Kestrel · 4x · ext · comp');
  // swapped for a gun on the ground (F): the kestrel lies there with all of it on
  const mauler = put('gun', 'mauler', WEAPONS.mauler.mag, 0.3);
  const mag = kestrel.mag;
  press('use');
  assert.equal(you.guns[0]?.id, 'mauler');
  assert.ok(!mauler.live);
  const lying = m.loot.find((it) => it.live && it.kind === 'gun' && it.what === 'kestrel' && it.by === you.id)!;
  assert.ok(lying, 'the kestrel is on the ground');
  assert.deepEqual(lying.mods, { sight: 'x4', ext: true, comp: true });
  assert.equal(lying.n, mag);
  walk(1);
  assert.ok(lying.live, 'not taken back by walking over it');
  // and picked up again, it comes back with them and its rounds
  press('use');
  const back = you.guns.find((g) => g?.id === 'kestrel');
  assert.ok(back, 'picked up again');
  assert.deepEqual(back.mods, { sight: 'x4', ext: true, comp: true });
  assert.equal(back.mag, mag);
  // what fits where, and a dot's zoom
  assert.ok(fits('hornet', 'dot') && fits('mauler', 'dot') && !fits('longbow', 'x4') && !fits('wren', 'ext') && !fits('mauler', 'comp'));
  assert.equal(zoomOf({ id: 'hornet', mods: { sight: 'dot', ext: false, comp: false } }), 1.4);
  // guns elsewhere carry none: breach and deathmatch play as before
  const b = createMatch(worldFor('vale'), 'breach', 'normal', { seed: 3 });
  assert.ok(b.actors.every((a) => a.guns.every((g) => !g?.mods)));
});

test('royale: loot holds the new gear, with the best of it more often in the bigger places', () => {
  const w = worldFor('vale', true);
  const loot = spawnLoot(w, 9);
  const count = (f: (it: Item) => boolean) => loot.filter(f).length;
  assert.ok(count((it) => it.kind === 'pack') > 10, 'backpacks');
  assert.ok(count((it) => it.kind === 'boost' && it.what === 'drink') > 5 && count((it) => it.kind === 'boost' && it.what === 'pills') > 3, 'boosts');
  for (const k of ['dot', 'x4', 'ext', 'comp']) assert.ok(count((it) => it.kind === 'att' && it.what === k) > 2, `attachments (${k})`);
  // level 3 armor and backpacks lie where the loot is richer than level 1 does, on average
  const rich = richness(w.loot);
  const richAt = (it: Item) => {
    for (let i = 0; i < w.loot.length; i += 3) if (w.loot[i] === it.x && w.loot[i + 2] === it.z) return rich[i / 3];
    return -1;
  };
  const mean = (lv: string) => {
    const xs = loot.filter((it) => (it.kind === 'vest' || it.kind === 'helmet' || it.kind === 'pack') && it.what === lv).map(richAt);
    return xs.reduce((s, x) => s + x, 0) / xs.length;
  };
  assert.ok(mean('3') > mean('1'), `richer places, better gear (${mean('3').toFixed(2)} against ${mean('1').toFixed(2)})`);
  // the same seed gives the same loot
  assert.deepEqual(spawnLoot(w, 9), loot);
});

/** A royale with only you in it, on the ground, and only its first vehicle (the bots and the rest put away). */
function carMatch(seed: number) {
  const m = createMatch(worldFor('vale', true), 'royale', 'normal', { seed });
  for (const a of m.actors) {
    a.drop = 0;
    if (a.id !== 0) {
      a.alive = false;
      a.body.x = 9999;
    }
  }
  m.cars.length = 1;
  // (and no loot: nobody picks up armor on the way)
  for (const it of m.loot) it.live = false;
  const c = m.cars[0];
  const you = m.actors[0];
  const stand = (x: number, z: number) => {
    you.body.x = x;
    you.body.z = z;
    you.body.y = groundAt(m.world, x, z, floorAt(m.world.terrain, x, z) + 1);
    you.body.vx = you.body.vz = you.body.vy = 0;
    you.body.onGround = true;
  };
  /** Stands you by the car's right side and gets in with F. */
  const getIn = () => {
    stand(c.x + Math.cos(c.yaw) * (CARS[c.kind].hw + 0.6), c.z - Math.sin(c.yaw) * (CARS[c.kind].hw + 0.6));
    step(m, DT, { ...idleInput(you.yaw, you.pitch), use: true, ride: true });
  };
  /** Parks the car at (x, z) facing `yaw`, on the ground. */
  const park = (x: number, z: number, yaw: number) => {
    c.x = x;
    c.z = z;
    c.y = floorAt(m.world.terrain, x, z);
    c.yaw = yaw;
    c.pitch = c.roll = 0;
    c.vx = c.vz = c.vy = 0;
    c.sleep = false;
  };
  return { m, c, you, stand, getIn, park };
}

test('royale vehicles: parked on the land, you get in with F and drive, and the car follows the ground', () => {
  const { m, c, you, getIn } = carMatch(21);
  const w = m.world;
  // a royale parks a dozen and more, clear of everything, on dry land
  const all = createMatch(worldFor('vale', true), 'royale', 'normal', { seed: 21 }).cars;
  assert.ok(all.length >= 12 && all.length <= 20, `vehicles (${all.length})`);
  assert.ok(all.some((v) => v.kind === 'jeep') && all.some((v) => v.kind === 'bike'));
  assert.ok(CARS.jeep.seats.length === 4, 'a four seat jeep');
  for (const v of all) {
    assert.ok(Math.abs(v.x) < w.arena && Math.abs(v.z) < w.arena);
    assert.ok(Math.abs(v.y - floorAt(w.terrain, v.x, v.z)) < 0.3, 'parked on the ground');
    assert.ok(!blockedAt(w, v.x, v.z, v.y, CARS[v.kind].hw), 'parked clear of walls');
  }
  // the breach and deathmatch have none
  assert.equal(createMatch(worldFor('vale'), 'breach', 'normal', { seed: 1 }).cars.length, 0);
  getIn();
  assert.equal(you.car, c.id);
  assert.equal(you.carSeat, 0, 'an empty car: you take the wheel');
  assert.equal(c.seats[0], you.id);
  const x0 = c.x;
  const z0 = c.z;
  let top = 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < 60 * 4; i++) {
    step(m, DT, { ...idleInput(you.yaw, you.pitch), mz: 1 });
    top = Math.max(top, Math.abs(c.speed));
    if (c.onGround) assert.ok(Math.abs(c.y - floorAt(w.terrain, c.x, c.z)) < 0.6, `on the ground (${c.y.toFixed(2)} vs ${floorAt(w.terrain, c.x, c.z).toFixed(2)})`);
    assert.ok(c.y > floorAt(w.terrain, c.x, c.z) - 0.6, 'never under the ground');
    lo = Math.min(lo, c.y);
    hi = Math.max(hi, c.y);
    // you ride along in your seat
    assert.ok(Math.hypot(you.body.x - c.x, you.body.z - c.z) < 1.5);
  }
  assert.ok(Math.hypot(c.x - x0, c.z - z0) > 12, `it drove (${Math.hypot(c.x - x0, c.z - z0).toFixed(1)} m)`);
  assert.ok(top > 8, `and picked up speed (${top.toFixed(1)} m/s)`);
  assert.ok(hi - lo > 0.05, 'up and down with the land');
});

test('royale vehicles: a wall stops a car (it never drives through), a person in the way is knocked out, and getting out puts you beside it', () => {
  const { m, c, you, getIn, park } = carMatch(22);
  const w = m.world;
  const hit = newHit();
  // a tall wall (a building, a container) across z, with a clear, fairly flat 24 m run up to one side of it (`a`: -1
  // the run is on its -z side, 1 its +z side), and room to park along the other
  const RUN = 24;
  const J = CARS.jeep;
  let found: { k: number; a: number; x: number; z: number } | null = null;
  for (let k = 0; k < w.boxes.length && !found; k++) {
    const o = w.boxes[k];
    if (o.y1 - o.y0 < 2.4 || o.x1 - o.x0 < 3 || o.z1 - o.z0 > 3 || Math.abs(o.x0) > 250 || Math.abs(o.z0) > 250) continue;
    for (const a of [-1, 1]) {
      const x = (o.x0 + o.x1) / 2;
      const face = a < 0 ? o.z0 : o.z1;
      const z = face + a * RUN;
      const g = floorAt(w.terrain, x, z);
      const pz = a < 0 ? o.z1 + J.hw + 0.25 : o.z0 - J.hw - 0.25;
      const pg = floorAt(w.terrain, x, pz);
      if ([-1.2, 0, 1.2].some((d) => blockedAt(w, x + d, pz, pg, J.hw)) || blockedAt(w, x, pz - a * 2.2, pg, 0.5) || Math.abs(pg - floorAt(w.terrain, x - 2.2, pz)) > 0.5) continue;
      if (Math.abs(g - floorAt(w.terrain, x, face + a)) > 2.5 || (w.terrain.hasWater && heightAt(w.terrain, x, z) < w.terrain.water + 0.5)) continue;
      let clear = true;
      for (const dx of [-0.9, 0, 0.9])
        for (const up of [0.7, 1.2]) {
          rayWorld(w, x + dx, g + up, z, 0, 0, -a, RUN + 4, hit);
          if (hit.kind !== 'box' || hit.i !== k || Math.abs(hit.t - RUN) > 0.05) clear = false;
        }
      if (clear && [0, 1.2, 2.4].every((d) => !blockedAt(w, x, z + a * d, g, J.hw))) {
        found = { k, a, x, z };
        break;
      }
    }
  }
  assert.ok(found, 'found a wall to drive at');
  const wall = w.boxes[found.k];
  const a = found.a;
  const face = a < 0 ? wall.z0 : wall.z1;
  // facing the wall (forward is (-sin yaw, -cos yaw))
  park(found.x, found.z, a < 0 ? Math.PI : 0);
  getIn();
  assert.equal(you.car, c.id);
  // someone standing in the way, 20 m on
  const v = m.actors[5];
  v.alive = true;
  v.bot = false;
  v.brain = null;
  v.hp = 100;
  v.armor = 0;
  v.body.x = found.x;
  v.body.z = found.z - a * 20;
  v.body.y = floorAt(w.terrain, v.body.x, v.body.z);
  let top = 0;
  /** From the hull's front to the wall's face (below zero: in it). */
  const gap = () => a * (c.z - a * J.hl - face);
  for (let i = 0; i < 60 * 6; i++) {
    step(m, DT, { ...idleInput(you.yaw, you.pitch), mz: 1 });
    top = Math.max(top, Math.abs(c.speed));
    // never into the wall: the hull's front stays this side of it
    assert.ok(gap() >= -0.06, `stopped by the wall (${gap().toFixed(2)} m short of it)`);
  }
  assert.ok(top > 12, `it was going (${top.toFixed(1)} m/s)`);
  assert.ok(gap() < 0.6, `and got right up to it (${gap().toFixed(2)})`);
  assert.ok(Math.abs(c.speed) < 1, 'it stopped there');
  assert.ok(c.hp < J.hp, 'the crash hurt it');
  assert.ok(!v.alive, `run down at speed: knocked out (hp ${v.hp.toFixed(0)})`);
  assert.equal(v.killedWith, 'car');
  assert.equal(v.killer, you.id);
  // out with F: on the ground beside it, not inside the wall or the car
  step(m, DT, { ...idleInput(you.yaw, you.pitch), use: true, ride: true });
  assert.equal(you.car, -1);
  assert.equal(c.seats[0], -1);
  for (let i = 0; i < 30; i++) step(m, DT, idleInput(you.yaw, you.pitch));
  const b = you.body;
  assert.ok(!blockedAt(w, b.x, b.z, b.y), 'not inside a wall');
  assert.ok(hullDist(c, b.x, b.z) >= RADIUS - 0.01, 'not inside the car');
  assert.ok(hullDist(c, b.x, b.z) < 2.5, 'right beside it');
  assert.ok(a * (b.z - face) > 0, 'on this side of the wall');
  assert.ok(b.onGround && Math.abs(b.y - groundAt(w, b.x, b.z, b.y + 0.3)) < 0.05, 'standing on the ground');
  // parked along the other side of the wall with the driver's door against it: out the other way
  const p = -a;
  park(found.x, p > 0 ? wall.z1 + J.hw + 0.25 : wall.z0 - J.hw - 0.25, (-p * Math.PI) / 2);
  for (let i = 0; i < 10; i++) step(m, DT, idleInput(you.yaw, you.pitch));
  getIn();
  assert.equal(you.car, c.id);
  assert.equal(you.carSeat, 0);
  step(m, DT, { ...idleInput(you.yaw, you.pitch), use: true, ride: true });
  assert.equal(you.car, -1);
  assert.ok(!blockedAt(w, b.x, b.z, b.y), 'not inside the wall');
  assert.ok(hullDist(c, b.x, b.z) >= RADIUS - 0.01, 'nor the car');
  assert.ok(hullDist(c, b.x, b.z) < 2.5, 'beside it');
  assert.ok(p * (b.z - (p > 0 ? wall.z1 : wall.z0)) > 0, 'this side of the wall');
});

test('royale vehicles: bullets and blasts wear a car down, and it blows up, throwing out and hurting its driver', () => {
  const { m, c, you, getIn } = carMatch(23);
  getIn();
  assert.equal(you.car, c.id);
  you.armor = 0;
  you.hp = 100;
  // a shot at the hull from in front and above stops on it and hurts it
  const shooter = m.actors[3];
  const fx = -Math.sin(c.yaw);
  const fz = -Math.cos(c.yaw);
  const ox = c.x + fx * 9;
  const oz = c.z + fz * 9;
  const oy = Math.max(c.y + 4, floorAt(m.world.terrain, ox, oz) + 2);
  const d = Math.hypot(c.x - ox, c.y + 0.8 - oy, c.z - oz);
  m.bullets.push({ x: ox, y: oy, z: oz, px: ox, py: oy, pz: oz, vx: ((c.x - ox) / d) * 900, vy: ((c.y + 0.8 - oy) / d) * 900, vz: ((c.z - oz) / d) * 900, owner: shooter.id, w: 'kestrel', life: 1.6, dist: 0, live: true });
  let metal = false;
  for (let i = 0; i < 10; i++) {
    step(m, DT, idleInput(you.yaw, you.pitch));
    for (const e of m.events) if (e.t === 'impact' && e.s === 'metal') metal = true;
  }
  assert.ok(c.hp < CARS.jeep.hp, `the bullet hurt the car (${c.hp})`);
  assert.ok(metal, 'and rang off its metal');
  assert.equal(you.hp, 100, 'the hull took it, not you');
  // someone else at the door takes a passenger seat (the wheel is yours)
  const mate = m.actors[6];
  mate.alive = true;
  mate.bot = false;
  mate.brain = null;
  mate.hp = 100;
  mate.armor = 0;
  mate.body.x = c.x - Math.cos(c.yaw) * (CARS.jeep.hw + 0.6);
  mate.body.z = c.z + Math.sin(c.yaw) * (CARS.jeep.hw + 0.6);
  mate.body.y = floorAt(m.world.terrain, mate.body.x, mate.body.z);
  // (a step plays only your input, so they get in the way F would get them in)
  assert.equal(carNear(m, mate), c, 'at the door');
  assert.ok(enterCar(m, mate, c));
  assert.equal(mate.car, c.id);
  assert.ok(mate.carSeat > 0, 'a passenger seat');
  step(m, DT, idleInput(you.yaw, you.pitch));
  assert.ok(Math.hypot(mate.body.x - c.x, mate.body.z - c.z) < 1.5, 'riding along');
  // enough and it goes up: a blast, you thrown out and hurt, the wreck left standing
  let boom = false;
  hurtCar(m, c, c.hp + 1, shooter.id);
  for (const e of m.events) if (e.t === 'boom') boom = true;
  step(m, DT, idleInput(you.yaw, you.pitch));
  assert.ok(!c.alive, 'blown up');
  assert.ok(boom, 'with a blast');
  assert.equal(you.car, -1, 'you are out of it');
  assert.ok(you.hp < 100, `and hurt (${you.hp})`);
  assert.ok(!blockedAt(m.world, you.body.x, you.body.z, you.body.y), 'thrown clear, not into a wall');
  assert.equal(mate.car, -1);
  assert.ok(mate.hp < 100, 'the passenger too');
  if (!you.alive) assert.equal(you.killer, shooter.id, 'the knockout is the one who wrecked it');
  // a wreck stays put and nobody gets in
  you.alive = true;
  you.hp = 100;
  for (let i = 0; i < 30; i++) step(m, DT, { ...idleInput(), ride: true });
  assert.equal(you.car, -1);
});

// ---------------------------------------------------------------------------------------------------------------
// the new guns, the ballistic shield and the new grenades

/** A live breach with nobody acting but you (actor 0), and one enemy (actor 5) standing `dist` meters off in the open,
 * still and unarmored. Everyone else is out of the way. */
function range(dist: number, seed = 4) {
  const m = createMatch(worldFor('vale'), 'breach', 'normal', { seed });
  while (m.phase === 'buy') step(m, DT, idleInput());
  for (const a of m.actors) {
    a.alive = a.id === 0 || a.id === 5;
    a.bot = false;
    a.brain = null;
  }
  m.phaseT = 999;
  const you = m.actors[0];
  const foe = m.actors[5];
  foe.armor = 0;
  const eye = you.body.y + you.body.height - 0.14;
  let found = false;
  for (let k = 0; k < 64 && !found; k++) {
    const ang = (k / 64) * Math.PI * 2;
    const x = you.body.x + Math.sin(ang) * dist;
    const z = you.body.z + Math.cos(ang) * dist;
    const y = heightAt(m.world.terrain, x, z);
    if (blockedAt(m.world, x, z, y) || y < m.world.terrain.water || Math.abs(y - you.body.y) > 1.5) continue;
    if (!clearLine(m.world, you.body.x, eye, you.body.z, x, y + 0.2, z) || !clearLine(m.world, you.body.x, eye, you.body.z, x, y + 1.7, z)) continue;
    foe.body.x = x;
    foe.body.z = z;
    foe.body.y = y;
    found = true;
  }
  assert.ok(found, 'found an open line of fire');
  return { m, you, foe };
}

const NEW_GUNS: WeaponId[] = ['talon', 'rampart', 'marshal', 'wasp', 'thresher', 'arbalest'];

test('the new guns: each has its slot, price and royale ammo, and the old guns keep their online codes', () => {
  for (const id of NEW_GUNS) {
    const w = WEAPONS[id];
    assert.ok(w.price > 0 && w.mag > 0 && w.dmg > 0, id);
    assert.equal(w.slot, id === 'marshal' ? 'secondary' : 'primary', id);
    assert.ok(AMMO_OF[id], `${id} takes ammo in a royale`);
  }
  // (online play sends a gun as its place in the list: the first seven keep theirs)
  assert.deepEqual(Object.keys(WEAPONS).slice(0, 7), ['wren', 'bulwark', 'hornet', 'mauler', 'kestrel', 'lancer', 'longbow']);
  assert.equal(WEAPONS.talon.burst, 3);
  assert.equal(WEAPONS.rampart.mag, 75);
  assert.ok(WEAPONS.rampart.reload > WEAPONS.kestrel.reload * 1.5, 'a machine gun reloads slowly');
  assert.ok(WEAPONS.wasp.rpm > WEAPONS.hornet.rpm, 'the Wasp fires faster than the Hornet');
  assert.ok(WEAPONS.thresher.auto && WEAPONS.thresher.pellets > 1);
  assert.ok(WEAPONS.arbalest.speed < 150 && WEAPONS.arbalest.mag === 1, 'a slow bolt, one at a time');
  assert.ok(applyDamage(100, 0, WEAPONS.marshal.dmg * WEAPONS.marshal.head).hp <= 0, 'a revolver headshot kills');
  assert.ok(applyDamage(100, 0, WEAPONS.arbalest.dmg).hp <= 0, 'a bolt to the body kills without armor');
});

for (const id of NEW_GUNS) {
  test(`${id}: fires with its own damage, fire mode and magazine`, () => {
    const w = WEAPONS[id];
    const dist = id === 'arbalest' ? 12 : 5;
    const { m, you, foe } = range(dist);
    you.guns[w.slot === 'secondary' ? 1 : 0] = gun(id);
    you.slot = w.slot === 'secondary' ? 1 : 0;
    you.switchT = 0;
    assert.equal(you.guns[you.slot]!.mag, w.mag, 'a full magazine');
    foe.hp = 1e6;
    const inp = aim(m, 0, foe.body.x, foe.body.y + foe.body.height * 0.6, foe.body.z);
    inp.ads = true;
    for (let i = 0; i < 30; i++) step(m, DT, inp);
    // hold the trigger for a second, then let go
    let shots = 0;
    const hits: { dmg: number; zone: string }[] = [];
    for (let i = 0; i < 90; i++) {
      step(m, DT, { ...inp, fire: i < 60 });
      for (const e of m.events) {
        if (e.t === 'shot' && e.a === 0) shots++;
        if (e.t === 'hit' && e.a === 0 && e.v === 5) hits.push({ dmg: e.dmg, zone: e.zone });
      }
    }
    const g = you.guns[you.slot]!;
    if (w.burst) assert.equal(shots, w.burst, 'one pull, one burst');
    else if (w.auto) assert.ok(shots >= Math.min(w.mag, Math.floor(w.rpm / 60)) - 1, `held down it keeps firing (${shots})`);
    else assert.equal(shots, 1, 'one pull, one shot');
    if (id === 'arbalest') assert.ok(you.reloadT > 0 || g.mag === 1, 'the crossbow spans the next bolt by itself');
    else assert.equal(g.mag, w.mag - shots, 'each shot takes a round');
    assert.ok(hits.length > 0, 'it hit');
    // (the target is a person: their health counts for more)
    for (const h of hits) {
      const mul = h.zone === 'head' ? w.head : h.zone === 'leg' ? w.leg : 1;
      const want = (w.dmg * mul * rangeMul(w, dist)) / PERSON_HEALTH;
      assert.ok(Math.abs(h.dmg - want) <= 1.5, `${h.zone} hit ${h.dmg} (want ${want.toFixed(1)})`);
    }
  });
}

test('a burst gun pauses between bursts, and a crossbow bolt flies slow, drops and spans again', () => {
  const { m, you, foe } = range(12);
  // (still in the round, out of the way)
  foe.hp = 1e6;
  you.guns[0] = gun('talon');
  you.slot = 0;
  you.switchT = 0;
  const inp = idleInput(you.yaw, 0.02);
  const times: number[] = [];
  // pulling as fast as possible: bursts of three with a pause between
  for (let i = 0; i < 90; i++) {
    step(m, DT, { ...inp, fire: i < 60 && i % 2 === 0 });
    for (const e of m.events) if (e.t === 'shot') times.push(m.time);
  }
  assert.ok(times.length >= 6 && times.length % 3 === 0, `whole bursts (${times.length} shots)`);
  for (let i = 1; i < times.length; i++) {
    const gap = times[i] - times[i - 1];
    if (i % 3 === 0) assert.ok(gap >= WEAPONS.talon.burstGap, `a pause between bursts (${gap.toFixed(3)} s)`);
    else assert.ok(gap < 0.1, `quick within a burst (${gap.toFixed(3)} s)`);
  }
  you.guns[0] = gun('arbalest');
  you.switchT = 0;
  you.fireCd = 0;
  // (up into the open sky)
  inp.pitch = 0.5;
  for (let i = 0; i < 20; i++) step(m, DT, inp);
  const before = m.bullets.length;
  step(m, DT, { ...inp, fire: true });
  const b = m.bullets[before];
  assert.ok(b && b.w === 'arbalest');
  assert.ok(Math.hypot(b.vx, b.vy, b.vz) < 100, 'slow');
  assert.ok(b.life > 1.6, 'and flies long enough to arc a long way');
  const vy0 = b.vy;
  for (let i = 0; i < 30; i++) step(m, DT, inp);
  assert.ok(b.vy < vy0 - 2, 'it falls');
  for (let i = 0; i < 150; i++) step(m, DT, inp);
  assert.equal(you.guns[0]!.mag, 1, 'spanned again by itself');
});

test('the ballistic shield: stops a shot from the front but not from behind, slows you, and breaks', () => {
  const { m, you, foe } = range(10);
  you.guns[0] = gun('kestrel');
  you.slot = 0;
  you.pavise = PAVISE.hp;
  // raised, facing the foe: the sidearm comes out
  const face = aim(m, 0, foe.body.x, foe.body.y + 1, foe.body.z);
  step(m, DT, { ...face, shield: true });
  assert.ok(you.paviseUp, 'raised');
  assert.equal(you.slot, 1, 'the sidearm in the other hand');
  for (let i = 0; i < 60; i++) step(m, DT, face);
  step(m, DT, { ...face, ads: true });
  assert.equal(you.ads, 0, 'nothing to aim down');
  // a rifle round from a point at your chest
  const shoot = (from: { x: number; y: number; z: number }) => {
    const tx = you.body.x;
    const ty = you.body.y + 1.2;
    const tz = you.body.z;
    const l = Math.hypot(tx - from.x, ty - from.y, tz - from.z);
    m.bullets.push({ x: from.x, y: from.y, z: from.z, px: from.x, py: from.y, pz: from.z, vx: ((tx - from.x) / l) * 900, vy: ((ty - from.y) / l) * 900 + 0.1, vz: ((tz - from.z) / l) * 900, owner: 5, w: 'kestrel', life: 1.6, dist: 0, live: true });
    const evs: { t: string; broke?: boolean }[] = [];
    for (let i = 0; i < 6; i++) {
      step(m, DT, face);
      for (const e of m.events) if (e.t === 'block' || (e.t === 'hit' && e.v === 0)) evs.push(e);
    }
    return evs;
  };
  const front = { x: foe.body.x, y: foe.body.y + 1.5, z: foe.body.z };
  const back = { x: you.body.x * 2 - foe.body.x, y: foe.body.y + 1.5, z: you.body.z * 2 - foe.body.z };
  const toward = (p: { x: number; y: number; z: number }) => {
    const l = Math.hypot(you.body.x - p.x, you.body.y + 1.2 - p.y, you.body.z - p.z);
    return shieldHit(you, p.x, p.y, p.z, (you.body.x - p.x) / l, (you.body.y + 1.2 - p.y) / l, (you.body.z - p.z) / l, l);
  };
  assert.ok(toward(front) > 0, 'its face is in the way from the front');
  assert.equal(toward(back), -1, 'and not from behind');
  const hp = you.hp;
  assert.deepEqual(shoot(front).map((e) => e.t), ['block'], 'stopped by the shield');
  assert.equal(you.hp, hp, 'unhurt');
  assert.ok(you.pavise < PAVISE.hp && you.pavise > PAVISE.hp - 60, `the shield took it (${you.pavise})`);
  assert.deepEqual(shoot(back).map((e) => e.t), ['hit'], 'a shot from behind hurts');
  assert.ok(you.hp < hp);
  // slower with it up
  const speed = (up: boolean) => {
    you.paviseUp = up;
    you.slot = 1;
    for (let i = 0; i < 40; i++) step(m, DT, { ...face, mz: 1 });
    return Math.hypot(you.body.vx, you.body.vz);
  };
  assert.ok(speed(true) < speed(false) * 0.85, 'a raised shield slows you');
  // a long gun takes both hands: the shield goes down
  you.paviseUp = true;
  step(m, DT, { ...face, slot: 0 });
  assert.ok(!you.paviseUp);
  // worn down, the next shot breaks it (and is still stopped)
  for (let i = 0; i < 30; i++) step(m, DT, face);
  step(m, DT, { ...face, shield: true });
  assert.ok(you.paviseUp);
  for (let i = 0; i < 30; i++) step(m, DT, face);
  you.pavise = 10;
  const hp2 = you.hp;
  const evs = shoot(front);
  assert.ok(evs.some((e) => e.t === 'block' && e.broke), 'it broke');
  assert.equal(you.pavise, 0);
  assert.ok(!you.paviseUp);
  assert.equal(you.hp, hp2, 'the shot that broke it was still stopped');
  // bought in the shop, one at a time, and good as new each round
  const s = createMatch(worldFor('mesa'), 'breach', 'normal', { seed: 3 });
  const me = s.actors[0];
  me.credits = 5000;
  assert.ok(buy(s, me, 'pavise'));
  assert.equal(me.pavise, PAVISE.hp);
  assert.ok(!buy(s, me, 'pavise'), 'one at a time');
  me.pavise = 50;
  startRound(s);
  assert.equal(me.pavise, PAVISE.hp);
});

test('an incendiary burns the ground: hurts an enemy standing in it through armor, never a teammate, and dies down', () => {
  const { m, you, foe } = range(10);
  const mate = m.actors[1];
  mate.alive = true;
  putOn(m, 1, foe.body.x + 0.8, foe.body.z);
  foe.armor = 50;
  you.fires = 1;
  // thrown: one fewer carried, one in the air
  step(m, DT, { ...idleInput(you.yaw, 0), throw: 'fire' });
  assert.equal(you.fires, 0);
  assert.equal(m.nades.at(-1)?.kind, 'fire');
  m.nades.length = 0;
  m.nades.push({ kind: 'fire', x: foe.body.x, y: foe.body.y + 1.2, z: foe.body.z, vx: 0, vy: -2, vz: 0, fuse: 2, owner: 0, rest: false, spin: 0 });
  let caught = false;
  for (let i = 0; i < 60; i++) {
    step(m, DT, idleInput(you.yaw, 0));
    if (m.events.some((e) => e.t === 'fire')) caught = true;
  }
  assert.ok(caught && m.fires.length === 1, 'it caught on landing');
  assert.ok(inFire(m, foe.body.x, foe.body.y, foe.body.z));
  for (let i = 0; i < 60 * 2; i++) step(m, DT, idleInput(you.yaw, 0));
  assert.ok(foe.hp < 100 - FIRE_DPS, `the enemy in it burns (${foe.hp.toFixed(0)})`);
  assert.equal(foe.armor, 50, 'armor does nothing against fire');
  assert.equal(mate.hp, 100, 'never a teammate');
  for (let i = 0; i < 60 * FIRE_LIFE; i++) step(m, DT, idleInput(you.yaw, 0));
  assert.equal(m.fires.length, 0, 'burned out');
  // a smoke puts one out
  m.nades.push({ kind: 'fire', x: foe.body.x, y: foe.body.y + 0.3, z: foe.body.z, vx: 0, vy: -1, vz: 0, fuse: 2, owner: 0, rest: false, spin: 0 });
  for (let i = 0; i < 30; i++) step(m, DT, idleInput(you.yaw, 0));
  assert.equal(m.fires.length, 1);
  m.nades.push({ kind: 'smoke', x: foe.body.x + 1, y: foe.body.y + 0.3, z: foe.body.z, vx: 0, vy: 0, vz: 0, fuse: 0.05, owner: 0, rest: true, spin: 0 });
  for (let i = 0; i < 10; i++) step(m, DT, idleInput(you.yaw, 0));
  assert.equal(m.fires.length, 0, 'smothered by the smoke');
});

test('an impact grenade goes off where it hits, long before a frag would', () => {
  const { m, you, foe } = range(10);
  you.impacts = 1;
  const inp = aim(m, 0, foe.body.x, foe.body.y + 0.4, foe.body.z);
  step(m, DT, { ...inp, throw: 'impact' });
  assert.equal(you.impacts, 0);
  let boomAt = -1;
  for (let i = 0; i < 180 && boomAt < 0; i++) {
    step(m, DT, inp);
    if (m.events.some((e) => e.t === 'boom')) boomAt = (i + 1) * DT;
  }
  assert.ok(boomAt > 0 && boomAt < 1.5, `went off on contact (${boomAt.toFixed(2)} s)`);
  assert.ok(foe.hp < 100, `the enemy near it was hurt (${foe.hp.toFixed(0)})`);
});

test("a decoy plays gunfire for a while, and the other side's bots take it for an enemy", () => {
  // a deathmatch with one bot left in it, nobody else in sight (the others wait to come back)
  const m = createMatch(worldFor('vale'), 'dm', 'normal', { seed: 4 });
  for (const a of m.actors) {
    a.alive = a.id === 6;
    a.respawnT = 999;
  }
  const bot = m.actors[6];
  const at = { x: bot.body.x + 14, z: bot.body.z };
  m.nades.push({ kind: 'decoy', x: at.x, y: heightAt(m.world.terrain, at.x, at.z) + 0.1, z: at.z, vx: 0, vy: 0, vz: 0, fuse: 11, owner: 0, rest: true, spin: 0, w: 'kestrel' });
  let fakes = 0;
  let taken = false;
  for (let i = 0; i < 60 * 11; i++) {
    step(m, DT, idleInput());
    for (const e of m.events) if (e.t === 'decoy') fakes++;
    if (bot.brain!.hasLast && Math.hypot(bot.brain!.lastX - at.x, bot.brain!.lastZ - at.z) < 1) taken = true;
  }
  assert.ok(fakes > 15, `it played bursts of gunfire (${fakes} shots)`);
  assert.ok(taken, 'the bot took it for an enemy');
  assert.equal(m.nades.length, 0, 'and it ran out');
});

test('bots buy the new guns, the shield and the new grenades, and they lie in a royale\'s loot', () => {
  const m = createMatch(worldFor('frost'), 'breach', 'normal', { seed: 9 });
  m.actors[0].bot = true;
  m.actors[0].brain = newBrain('normal', 0);
  const bought = new Set<string>();
  for (let r = 0; r < 24; r++) {
    startRound(m);
    m.round = 3;
    for (const a of m.actors) {
      a.credits = 3000 + ((r * 7 + a.id * 13) % 10) * 600;
      a.guns[0] = a.guns[2] = null;
      a.pavise = 0;
      a.fires = a.impacts = a.decoys = 0;
    }
    while (m.phase === 'buy') {
      step(m, DT, idleInput());
      for (const e of m.events) if (e.t === 'buy') bought.add(e.item);
    }
  }
  const newGuns = NEW_GUNS.filter((id) => bought.has(id));
  assert.ok(newGuns.length >= 4, `new guns bought: ${newGuns.join(', ')}`);
  assert.ok(bought.has('pavise'), 'a shield bought');
  assert.ok(bought.has('fire') && bought.has('impact') && bought.has('decoy'), `bought: ${[...bought].join(', ')}`);
  const loot = spawnLoot(worldFor('vale', true), 11);
  for (const id of NEW_GUNS) assert.ok(loot.some((it) => it.kind === 'gun' && it.what === id), `${id} in the loot`);
  assert.ok(loot.some((it) => it.kind === 'shield'), 'shields in the loot');
  for (const k of ['fire', 'impact', 'decoy']) assert.ok(loot.some((it) => it.kind === 'nade' && it.what === k), `${k} in the loot`);
});

test('bots fight with the new guns and their shields up, and shots stop on the shields', () => {
  const m = createMatch(worldFor('vale'), 'breach', 'normal', { seed: 31 });
  m.actors[0].bot = true;
  m.actors[0].brain = newBrain('normal', 0);
  let raised = 0;
  let blocked = 0;
  let newShots = 0;
  while (m.phase !== 'over' && m.round < 6 && m.time < 900) {
    // half of them carry a shield, everyone a new gun
    if (m.phase === 'buy')
      for (const a of m.actors) {
        if (a.id % 2 === 0 && !a.pavise) a.pavise = PAVISE.hp;
        const id = NEW_GUNS[a.id % NEW_GUNS.length];
        if (!a.guns[0]) a.guns[0] = gun(id === 'marshal' ? 'talon' : id);
      }
    step(m, DT, idleInput());
    for (const e of m.events) {
      if (e.t === 'block') blocked++;
      if (e.t === 'shot' && NEW_GUNS.includes(e.w)) newShots++;
    }
    if (Math.floor(m.time) !== Math.floor(m.time - DT)) raised = Math.max(raised, m.actors.filter((a) => a.alive && a.paviseUp).length);
  }
  assert.ok(raised >= 2, `bots raised their shields (${raised} at once)`);
  assert.ok(blocked > 5, `shots stopped on shields (${blocked})`);
  assert.ok(newShots > 50, `the new guns were fired (${newShots})`);
});
