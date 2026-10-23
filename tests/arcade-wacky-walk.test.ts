import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCourse, checkpointAt, progressOf, respawnPoint, touchTile, tileFall, RACES } from '../src/os/arcade/games/wacky-walk/courses.ts';
import { createBrain, resetBrain, thinkBot } from '../src/os/arcade/games/wacky-walk/bots.ts';
import { COLORS, BOT_NAMES, botSkill, offlineEntrants } from '../src/os/arcade/games/wacky-walk/roster.ts';
import { hash, mulberry32 } from '../src/os/arcade/games/wacky-walk/rng.ts';
import { createBody, groundBelow, insideZone, poseOf, rayCast, respawn, setPose, STEP, stepBody, updateCourse, RADIUS, HEIGHT, BIG_HIT } from '../src/os/arcade/games/wacky-walk/physics.ts';
import { COUNT, courseOf, createShow, INTRO, markFall, markFinish, OUTRO, pickRace, placeOf, playTime, quotas, statusOf, stepShow } from '../src/os/arcade/games/wacky-walk/show.ts';
import { fallPacket, finishPacket, Interp, movePacket, packBody, parsePacket, playersPacket, showOf, showPacket, tilePacket, unpackBody } from '../src/os/arcade/games/wacky-walk/net.ts';
import { EV } from '../src/os/arcade/games/wacky-walk/types.ts';
import type { Course } from '../src/os/arcade/games/wacky-walk/types.ts';

function emptyCourse(colliders: Course['colliders'] = [], zones: Course['zones'] = []): Course {
  return {
    id: 'oval', name: 'test course', kind: 'race', seed: 1, colliders, zones, spawns: [], startYaw: 0,
    killY: -10, limit: 120, path: [], decor: [], palette: { ground: 0, skyTop: 0, skyBottom: 0, fog: 0 },
  };
}

function floorCourse(slip = false): Course {
  const p = poseOf(0, -0.25, 0);
  return emptyCourse([{
    id: 0, shape: { kind: 'box', hx: 20, hy: 0.25, hz: 20 }, look: slip ? 'wet' : 'grass',
    pose: p, prev: poseOf(0, -0.25, 0), on: true, ...(slip ? { slip: true } : {}),
  }]);
}

test('seeded helpers and roster are stable, bounded, and readable', () => {
  assert.equal(hash(1, 2, 3), hash(1, 2, 3));
  assert.notEqual(hash(1, 2, 3), hash(1, 2, 4));
  assert.equal(mulberry32(9)(), mulberry32(9)());
  assert.equal(COLORS.length, 20);
  assert.equal(new Set(COLORS).size, 20);
  assert.equal(BOT_NAMES.length, 20);
  assert.deepEqual(offlineEntrants(3, 4).map(({ id, seat, bot }) => [id, seat, bot]), [[0, -1, false], [1, -1, true], [2, -1, true]]);
  assert.ok(botSkill(5, 3) >= 0.3 && botSkill(5, 3) <= 0.95);
});

test('controller falls onto a box, jumps to the expected apex, and carries riders around a spinning disc', () => {
  const course = floorCourse();
  const body = createBody(0, 3, 0, 0);
  for (let i = 0; i < 180; i++) stepBody(body, { mx: 0, mz: 0, jump: false, dive: false }, course, i * STEP, STEP, []);
  assert.equal(body.ground, 0);
  assert.ok(Math.abs(body.y) < 0.02, `feet height ${body.y}`);

  body.ground = 0;
  let apex = body.y;
  for (let i = 0; i < 90; i++) {
    stepBody(body, { mx: 0, mz: 0, jump: i === 0, dive: false }, course, 3 + i * STEP, STEP, []);
    apex = Math.max(apex, body.y);
  }
  assert.ok(apex - 0 < 2.2 && apex > 1.7, `jump apex ${apex}`);

  const discPose = poseOf(0, -0.25, 0);
  const disc: Course['colliders'][number] = {
    id: 0, shape: { kind: 'box', hx: 4, hy: 0.25, hz: 4 }, look: 'stone',
    pose: discPose, prev: poseOf(0, -0.25, 0), on: true,
    at: (t, out) => setPose(out, 0, -0.25, 0, t * 5),
  };
  const moving = emptyCourse([disc]);
  const rider = createBody(2, 0, 0, 0);
  rider.ground = 0;
  updateCourse(moving, 0.15);
  stepBody(rider, { mx: 0, mz: 0, jump: false, dive: false }, moving, 0.15, STEP, []);
  assert.ok(Math.hypot(rider.x - 2, rider.z) > 0.8, `rider stayed at ${rider.x}, ${rider.z}`);
});

test('hits, dives, jets, wet ground, and long random movement remain stable', () => {
  const barPose = poseOf(0, 0.75, 0);
  const bar = emptyCourse([{
    id: 0, shape: { kind: 'box', hx: 1, hy: 0.75, hz: 0.25 }, look: 'bar',
    pose: barPose, prev: poseOf(0, 0.75, 0), on: true, bounce: BIG_HIT + 2,
  }]);
  const struck = createBody(0, 0, -0.7, 0);
  struck.vz = 8;
  stepBody(struck, { mx: 0, mz: 1, jump: false, dive: false }, bar, 0, 0.05, []);
  assert.ok(struck.ev & EV.HIT);
  assert.ok(struck.ev & EV.BIG_HIT);
  assert.equal(struck.state, 'stun');

  const travel = (dive: boolean) => {
    const course = floorCourse();
    const body = createBody(0, 0, 0, 0);
    body.ground = 0;
    for (let i = 0; i < 54; i++) {
      stepBody(body, {
        mx: 0, mz: 1, jump: i === 0,
        dive: dive && i === 8,
      }, course, i * STEP, STEP, []);
    }
    return body.z;
  };
  assert.ok(travel(true) > travel(false) + 1, `dive ${travel(true)} vs jump ${travel(false)}`);

  const jet = emptyCourse([], [{
    kind: 'jet', x: 0, y: 0.7, z: 0, hx: 2, hy: 2, hz: 2,
    push: { x: 12, y: 0, z: 0 }, on: () => true,
  }]);
  const splashed = createBody(0, 0, 0, 0);
  stepBody(splashed, { mx: 0, mz: 0, jump: false, dive: false }, jet, 0, STEP, []);
  assert.ok(splashed.vx > 0.1);
  assert.ok(splashed.ev & EV.SPLASH);
  assert.ok(insideZone(jet.zones[0], 0, 0.7, 0));

  const normal = createBody(0, 0, 0, 0), wet = createBody(0, 0, 0, 0);
  normal.ground = 0; wet.ground = 0; normal.vx = 6; wet.vx = 6;
  for (let i = 0; i < 30; i++) {
    stepBody(normal, { mx: 0, mz: 0, jump: false, dive: false }, floorCourse(false), i * STEP, STEP, []);
    stepBody(wet, { mx: 0, mz: 0, jump: false, dive: false }, floorCourse(true), i * STEP, STEP, []);
  }
  assert.ok(Math.abs(wet.vx) > Math.abs(normal.vx));

  const random = mulberry32(771);
  const longCourse = floorCourse();
  longCourse.colliders.push({
    id: 1, shape: { kind: 'box', hx: 1, hy: 1, hz: 0.3 }, look: 'bar',
    pose: poseOf(0, 1, 5), prev: poseOf(0, 1, 5), on: true, bounce: 13,
  });
  const runner = createBody(0, 0, 0, 0);
  for (let i = 0; i < 6000; i++) {
    stepBody(runner, {
      mx: random() * 2 - 1, mz: random() * 2 - 1,
      jump: random() < 0.025, dive: random() < 0.01,
    }, longCourse, i * STEP, STEP, []);
    assert.ok([runner.x, runner.y, runner.z, runner.vx, runner.vy, runner.vz, runner.yaw].every(Number.isFinite));
  }
  assert.equal(RADIUS, 0.42);
  assert.equal(HEIGHT, 1.4);
});

test('ray casting and ground height find box tops without clipping through small spheres', () => {
  const course = floorCourse();
  course.colliders.push({
    id: 1, shape: { kind: 'sphere', r: 0.5 }, look: 'bumper',
    pose: poseOf(0, 2, 3), prev: poseOf(0, 2, 3), on: true,
  });
  assert.ok(rayCast(course, { x: 0, y: 4, z: 0 }, { x: 0, y: -3, z: 0 }) < 1);
  assert.equal(groundBelow(course, 0, 5, 0), 0);
  assert.equal(rayCast(course, { x: 0, y: 4, z: 3 }, { x: 0, y: 0, z: 3 }), 1);
  const pose = poseOf(1, 2, 3, 0.4, 0.2, -0.1);
  const local = { x: 1, y: -2, z: 0.5 };
  const world = { x: pose.x + pose.m[0] * local.x + pose.m[1] * local.y + pose.m[2] * local.z,
    y: pose.y + pose.m[3] * local.x + pose.m[4] * local.y + pose.m[5] * local.z,
    z: pose.z + pose.m[6] * local.x + pose.m[7] * local.y + pose.m[8] * local.z };
  assert.ok(Math.hypot(world.x, world.y, world.z) > 0);
});

test('camera raycasts ignore hidden and moving non-tile colliders but keep tiles', () => {
  const course = emptyCourse([{
    id: 0, shape: { kind: 'box', hx: 1, hy: 1, hz: 1 }, look: 'bar',
    pose: poseOf(0, 0, 0), prev: poseOf(0, 0, 0), on: true, at: () => {},
  }]);
  const from = { x: 0, y: 0, z: -2 }, to = { x: 0, y: 0, z: 2 };
  assert.equal(rayCast(course, from, to, true), 1);
  course.colliders[0].tile = { layer: 0, touchedAt: null, fallAt: null };
  assert.ok(rayCast(course, from, to, true) < 1);
  delete course.colliders[0].tile;
  course.colliders[0].look = 'hidden';
  assert.equal(rayCast(course, from, to, true), 1);
  assert.ok(rayCast(course, from, to) < 1);
});

test('courses are deterministic, complete, and expose timed tiles and checkpoint spawns', () => {
  for (const id of ['oval', 'fountain', 'palm', 'tiles', 'hoover'] as const) {
    const a = buildCourse(id, 13), b = buildCourse(id, 13);
    assert.equal(a.spawns.length, 20, `${id} spawn count`);
    assert.ok(a.zones.some((zone) => zone.kind === 'finish' || zone.kind === 'crown'), `${id} end zone`);
    for (const zone of a.zones.filter((item) => item.kind === 'checkpoint')) assert.ok(zone.spawn, `${id} checkpoint ${zone.index}`);
    if (a.kind !== 'survival') {
      assert.ok(a.path.length >= 2);
      assert.ok(progressOf(a, a.path.at(-1)!.x, a.path.at(-1)!.y, a.path.at(-1)!.z) > 0.99);
    } else {
      assert.equal(a.path.length, 0);
    }
    updateCourse(a, 3.25); updateCourse(b, 3.25);
    assert.deepEqual(a.colliders.map(({ pose, on }) => [pose.x, pose.y, pose.z, ...pose.m, on]),
      b.colliders.map(({ pose, on }) => [pose.x, pose.y, pose.z, ...pose.m, on]));
    assert.ok(checkpointAt(a, a.zones.find((zone) => zone.kind === 'checkpoint')!.x,
      a.zones.find((zone) => zone.kind === 'checkpoint')!.y,
      a.zones.find((zone) => zone.kind === 'checkpoint')!.z) >= 0);
    const spawn = respawnPoint(a, 0, 17);
    assert.ok(Number.isFinite(spawn.x) && Number.isFinite(spawn.z));
  }
  const one = buildCourse('palm', 1), two = buildCourse('palm', 2);
  updateCourse(one, 2.1); updateCourse(two, 2.1);
  assert.notDeepEqual(one.colliders.filter((item) => item.look === 'coconut').map((item) => [item.pose.x, item.pose.z, item.on]),
    two.colliders.filter((item) => item.look === 'coconut').map((item) => [item.pose.x, item.pose.z, item.on]));
  const tiles = buildCourse('tiles', 8);
  assert.equal(tiles.colliders.filter((item) => item.tile).length, 213);
  const tile = tiles.colliders.find((item) => item.tile)!;
  assert.equal(touchTile(tiles, tile.id, 1), true);
  assert.equal(tile.tile?.fallAt, 1.85);
  assert.equal(tileFall(tiles, tile.id, 1.8), true);
  updateCourse(tiles, 3.1);
  assert.equal(tile.on, false);
  assert.deepEqual(RACES, ['oval', 'fountain', 'palm']);
});

test('three-round quotas, show flow, elimination, timeout progress, and small fields', () => {
  assert.deepEqual(quotas(8), [5, 3]);
  assert.deepEqual(quotas(20), [12, 6]);
  assert.deepEqual([1, 2, 3, 4, 6, 8, 12, 20].map(quotas), [[1, 1], [2, 2], [3, 2], [3, 2], [4, 2], [5, 3], [7, 4], [12, 6]]);
  for (const [field, raceQuota, survivalQuota] of [[8, 5, 3], [20, 12, 6]]) {
    const sized = createShow(offlineEntrants(field, field), field, 'oval');
    assert.equal(sized.quota, raceQuota);
    sized.phase = 'outro';
    sized.qualified = Array.from({ length: raceQuota }, (_, i) => i);
    for (let i = 0; i < OUTRO; i++) stepShow(sized, 1, () => 0);
    assert.equal(sized.round, 1);
    assert.equal(sized.quota, survivalQuota);
  }
  assert.equal(pickRace(9, 'random'), pickRace(9, 'random'));
  assert.equal(pickRace(9, 'palm'), 'palm');

  const show = createShow(offlineEntrants(4, 5), 5, 'oval');
  assert.equal(playTime(show), 0);
  assert.equal(stepShow(show, INTRO, () => 0), true);
  assert.equal(show.phase, 'count');
  assert.equal(stepShow(show, COUNT, () => 0), true);
  assert.equal(show.phase, 'play');
  for (const id of [0, 1, 2]) assert.equal(markFinish(show, id), true);
  assert.equal(markFinish(show, 0), false);
  stepShow(show, STEP, () => 0.2);
  assert.equal(show.phase, 'outro');
  assert.deepEqual(show.qualified, [0, 1, 2]);
  assert.equal(statusOf(show, 3), 'eliminated');
  for (let i = 0; i < OUTRO; i++) stepShow(show, 1, () => 0);
  assert.equal(show.round, 1);
  assert.equal(show.phase, 'intro');
  assert.deepEqual(show.inRound, [0, 1, 2]);
  for (let i = 0; i < INTRO + COUNT; i++) stepShow(show, 1, () => 0);
  assert.equal(show.phase, 'play');
  assert.equal(markFall(show, 0), true);
  assert.equal(markFall(show, 0), false);
  stepShow(show, STEP, () => 0.4);
  assert.deepEqual(show.qualified, [1, 2]);
  for (let i = 0; i < OUTRO; i++) stepShow(show, 1, () => 0);
  assert.equal(show.round, 2);
  for (let i = 0; i < INTRO + COUNT; i++) stepShow(show, 1, () => 0);
  assert.equal(markFinish(show, 1), true);
  stepShow(show, STEP, () => 0);
  assert.equal(show.winner, 1);
  for (let i = 0; i < OUTRO; i++) stepShow(show, 1, () => 0);
  assert.equal(show.phase, 'done');
  assert.equal(statusOf(show, 1), 'winner');
  assert.equal(placeOf(show, 1), 1);

  const timeout = createShow(offlineEntrants(4, 2), 2, 'oval');
  timeout.phase = 'play'; timeout.clock = INTRO + COUNT + 120;
  stepShow(timeout, STEP, (id) => id / 10);
  assert.equal(timeout.phase, 'outro');
  assert.deepEqual(timeout.qualified, [3, 2, 1, 0]);

  const twoBots = createShow(offlineEntrants(2, 1), 1, 'oval');
  twoBots.phase = 'play';
  assert.equal(markFinish(twoBots, 0), true);
  assert.equal(markFinish(twoBots, 1), true);
  stepShow(twoBots, STEP, () => 0);
  assert.deepEqual(twoBots.qualified, [0, 1]);
  for (let i = 0; i < OUTRO; i++) stepShow(twoBots, 1, () => 0);
  assert.equal(twoBots.round, 2);
  assert.equal(twoBots.phase, 'intro');
  assert.deepEqual(twoBots.inRound, [0, 1]);
  assert.equal(twoBots.quota, 1);
  assert.equal(courseOf(twoBots), 'hoover');

  const single = createShow(offlineEntrants(1, 2), 2, 'oval');
  single.phase = 'play';
  markFinish(single, 0);
  stepShow(single, STEP, () => 0);
  for (let i = 0; i < OUTRO; i++) stepShow(single, 1, () => 0);
  assert.equal(single.phase, 'done');
  assert.equal(single.winner, 0);

});

test('network packets round trip and reject malformed numeric fields and roster data', () => {
  const body = createBody(1.234, 0.5, -2.75, 2.9);
  body.vx = 3.14; body.vy = 1.25; body.vz = -4.3; body.state = 'dive'; body.squash = -0.1;
  const packed = packBody(body);
  assert.deepEqual(unpackBody(packed), { x: 1.23, y: 0.5, z: -2.75, vx: 3.14, vy: 1.25, vz: -4.3, yaw: 2.9, state: 'dive', squash: -0.1 });
  assert.equal(parsePacket(movePacket(8, 1, body))?.k, 'm');
  assert.equal(parsePacket(finishPacket(8, 1))?.k, 'fin');
  assert.equal(parsePacket(fallPacket(8, 1))?.k, 'fall');
  assert.equal(parsePacket(tilePacket(8, 1, 3, 2.5))?.k, 'tile');
  assert.equal(parsePacket(playersPacket(8, 1, 4, [{ id: 0, body }]))?.k, 'P');

  const rotated = { ...body, yaw: 9.34 };
  assert.equal(parsePacket(movePacket(8, 1, rotated))?.k, 'm');
  assert.equal(parsePacket(playersPacket(8, 1, 4, [{ id: 0, body: rotated }]))?.k, 'P');

  const show = createShow(offlineEntrants(6, 44), 44, 'fountain');
  const packet = showPacket(5, show, [[10, 2.25]]);
  const parsed = parsePacket(packet);
  assert.ok(parsed && parsed.k === 'S');
  if (!parsed || parsed.k !== 'S') throw new Error('show packet did not parse');
  const restored = showOf(parsed);
  assert.equal(restored.seed, show.seed);
  assert.equal(restored.race, show.race);
  assert.deepEqual(restored.entrants, show.entrants);
  assert.deepEqual(restored.inRound, show.inRound);
  assert.deepEqual(parsed.tiles, [[10, 2.25]]);

  const fullField = createShow(offlineEntrants(20, 45), 45, 'oval');
  fullField.entrants.forEach((entrant, seat) => { entrant.seat = seat; });
  assert.equal(parsePacket(showPacket(5, fullField))?.k, 'S');

  assert.equal(parsePacket({ t: 'wacky-walk', k: 'm', r: 0, rd: 0, b: [NaN, 0, 0, 0, 0, 0, 0, 0, 0] }), null);
  assert.equal(parsePacket({ t: 'wacky-walk', k: 'm', r: 0, rd: 3, b: packed }), null);
  assert.equal(parsePacket({ t: 'wacky-walk', k: 'P', r: 0, rd: 0, c: 0, b: [[0, ...packed], [0, ...packed]] }), null);
  assert.equal(parsePacket({ ...packet, ent: [[0, -2, 'bad', 1, 0, 0.5]] }), null);
  assert.equal(parsePacket({ ...packet, c: Infinity }), null);
});

test('interpolation wraps yaw, lerps position, extrapolates briefly, and trims history', () => {
  const interp = new Interp();
  const base = { x: 0, y: 0, z: 0, vx: 2, vy: 0, vz: 0, yaw: Math.PI - 0.1, state: 'run' as const, squash: 0 };
  interp.push(1, base);
  interp.push(2, { ...base, x: 2, yaw: -Math.PI + 0.1, state: 'air' });
  const out = { ...base };
  assert.equal(interp.sample(1.5, out), true);
  assert.ok(Math.abs(out.x - 1) < 0.01);
  assert.ok(Math.abs(Math.abs(out.yaw) - Math.PI) < 0.01);
  assert.equal(out.state, 'air');
  interp.sample(2.1, out);
  assert.ok(Math.abs(out.x - 2.2) < 0.01);
  for (let i = 3; i < 10; i++) interp.push(i, { ...base, x: i });
  assert.equal(interp.sample(9.1, out), true);
  assert.ok(out.x > 9);
});

function simulateBots(id: 'oval' | 'fountain' | 'palm' | 'tiles' | 'hoover', count: number, seed: number, frameDt = STEP) {
  const course = buildCourse(id, seed);
  const bodies = course.spawns.slice(0, count).map((spot) => createBody(spot.x, spot.y, spot.z, course.startYaw));
  const brains = bodies.map((_, i) => createBrain(i + 1, botSkill(seed, i + 1), seed));
  brains.forEach((brain) => resetBrain(brain, course));
  const finished = new Set<number>(), fallen = new Set<number>();
  let ended = false, accumulator = 0, stepsDone = 0;
  const maxSteps = Math.ceil(course.limit / STEP);
  while (stepsDone < maxSteps && !ended) {
    accumulator += Math.max(0, Math.min(0.25, frameDt));
    let frameSteps = 0;
    while (accumulator >= STEP && frameSteps < 15 && stepsDone < maxSteps) {
      const time = (stepsDone + 1) * STEP;
      updateCourse(course, time);
      for (let i = 0; i < bodies.length; i++) {
        const body = bodies[i];
        if (finished.has(i) || fallen.has(i)) continue;
        const input = thinkBot(brains[i], body, course, time, STEP);
        stepBody(body, input, course, time, STEP, []);
        if (body.y < course.killY) fallen.add(i);
        if (course.zones.some((zone) => (zone.kind === 'finish' || zone.kind === 'crown') && insideZone(zone, body.x, body.y + HEIGHT / 2, body.z))) {
          finished.add(i);
        }
      }
      accumulator -= STEP;
      stepsDone++;
      frameSteps++;
      if (id === 'tiles' && fallen.size >= Math.max(1, count - 4)) ended = true;
      if (finished.size > 0 && id === 'hoover') ended = true;
      if (id !== 'tiles' && id !== 'hoover' && finished.size >= Math.ceil(count * 0.6)) ended = true;
      if (ended) break;
    }
  }
  return { course, bodies, finished, fallen, ended, stepsDone };
}

test('headless bots complete courses through normal and low-FPS catch-up steps', { timeout: 40_000 }, () => {
  const rates: Record<string, { normal: string; lowFps: string }> = {};
  for (const id of RACES) {
    const normal = simulateBots(id, 12, 31);
    const lowFps = simulateBots(id, 12, 31, 0.18);
    rates[id] = { normal: `${normal.finished.size}/12`, lowFps: `${lowFps.finished.size}/12` };
    assert.ok(normal.finished.size >= 8, `${id} bot finish rate ${rates[id].normal}`);
    assert.deepEqual([...lowFps.finished], [...normal.finished], `${id} low-FPS finishers`);
    assert.equal(lowFps.stepsDone, normal.stepsDone, `${id} low-FPS simulation steps`);
  }
  const tiles = simulateBots('tiles', 12, 43);
  const lowFpsTiles = simulateBots('tiles', 12, 43, 0.18);
  assert.ok(tiles.fallen.size > 0, `tile field falls: ${tiles.fallen.size}`);
  const hoover = simulateBots('hoover', 6, 54);
  const lowFpsHoover = simulateBots('hoover', 6, 54, 0.18);
  assert.ok(hoover.finished.size > 0, 'at least one bot should reach the crown');
  assert.deepEqual([...lowFpsTiles.fallen], [...tiles.fallen], 'low-FPS tile fallers');
  assert.deepEqual([...lowFpsHoover.finished], [...hoover.finished], 'low-FPS crown finishers');
  assert.equal(lowFpsTiles.stepsDone, tiles.stepsDone, 'low-FPS tile simulation steps');
  assert.equal(lowFpsHoover.stepsDone, hoover.stepsDone, 'low-FPS hoover simulation steps');
  console.log(`wacky walk bot counts ${JSON.stringify(rates)}; tiles ${tiles.fallen.size}/${lowFpsTiles.fallen.size} fallen (12); hoover ${hoover.finished.size}/${lowFpsHoover.finished.size} crowned (6), normal/0.18`);
});
