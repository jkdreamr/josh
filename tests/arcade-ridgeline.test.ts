import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAP_IDS } from '../src/os/arcade/games/ridgeline/maps.ts';
import { DM_HUBS, newBrain } from '../src/os/arcade/games/ridgeline/bots.ts';
import { fieldDist, fieldTo, findPath } from '../src/os/arcade/games/ridgeline/nav.ts';
import { STAND_H, blockedAt, clearLine, newHit, rayWorld, stepBody, type Body } from '../src/os/arcade/games/ridgeline/physics.ts';
import { CELL, T_HALF, T_RES, generateTerrain, heightAt, rayTerrain } from '../src/os/arcade/games/ridgeline/terrain.ts';
import { ARMOR, KILL_REWARD, LOSS_REWARD, START_CREDITS, WEAPONS, WIN_REWARD, applyDamage, kickOf, rangeMul } from '../src/os/arcade/games/ridgeline/weapons.ts';
import { ARENA, ROYALE_ARENA, SITE_R, worldFor } from '../src/os/arcade/games/ridgeline/world.ts';
import { AMMO_MAX, AMMO_PACK, ROYALE_PLAYERS, VEST, ZONES } from '../src/os/arcade/games/ridgeline/royale.ts';
import {
  BLAST_R,
  BULLET_G,
  BUY_TIME,
  DEFUSE_HALF,
  DEFUSE_TIME,
  DM_KILLS,
  FUSE,
  HALF,
  PLANT_REWARD,
  PLANT_TIME,
  buy,
  canDefuse,
  canShop,
  createMatch,
  idleInput,
  lootNear,
  plantSite,
  spawnOf,
  startRound,
  step,
  type Input,
  type Match,
} from '../src/os/arcade/games/ridgeline/match.ts';
import { MAPS } from '../src/os/arcade/games/ridgeline/maps.ts';

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
  you.credits = 5000;
  assert.ok(buy(m, you, 'hornet'));
  assert.ok(buy(m, you, 'kestrel'), 'swapping a gun bought this round refunds it');
  assert.equal(you.credits, 5000 - WEAPONS.kestrel.price);
  assert.equal(you.guns[0]?.id, 'kestrel');
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
  m.phaseT = 0;
  step(m, DT, idleInput());
  assert.equal(m.round, HALF + 1);
  assert.equal(m.attack, 1, 'sides swapped');
  assert.equal(m.actors[0].credits, START_CREDITS, 'everyone starts over');
  assert.ok(m.actors.every((a) => !a.guns[0] && a.guns[1]?.id === 'wren'));
  // the attack starts at the attack's spawn
  const sp = spawnOf(m, 1);
  assert.ok(Math.hypot(m.actors[5].body.x - sp.x, m.actors[5].body.z - sp.z) < 16);
  assert.equal(m.actors[m.charge.holder].team, 1, 'the charge is with the new attack');
});

test('a knockout pays the killer, and the dead lose their primary', () => {
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
  assert.equal(foe.guns[0], null);
  assert.ok(m.feed.some((k) => k.killer === 0 && k.victim === 6));
  startRound(m);
  assert.ok(foe.alive && foe.hp === 100 && foe.guns[1]?.id === 'wren');
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

test('royale: a hundred drop in, loot, fight and the zone closes to one left standing', () => {
  const m = createMatch(worldFor('vale', true), 'royale', 'normal', { seed: 7 });
  assert.equal(m.actors.length, ROYALE_PLAYERS);
  let picks = 0;
  let kills = 0;
  let shots = 0;
  let landed = 0;
  const step2 = 1 / 30;
  while (m.phase !== 'over' && m.time < 900) {
    // you stay in it to the end (unhurt) so the bots play the whole match out
    m.actors[0].shield = 99;
    m.actors[0].hp = 100;
    step(m, step2, idleInput());
    for (const e of m.events) {
      if (e.t === 'pickup') picks++;
      if (e.t === 'kill') kills++;
      if (e.t === 'shot') shots++;
      if (e.t === 'land') landed++;
    }
  }
  assert.equal(m.phase, 'over');
  assert.equal(m.alive, 1);
  assert.ok(landed >= 95, `everyone came down (${landed})`);
  assert.ok(picks > 150, `they looted (${picks})`);
  assert.ok(shots > 300, `they fought (${shots} shots)`);
  assert.equal(kills, ROYALE_PLAYERS - 1);
});
