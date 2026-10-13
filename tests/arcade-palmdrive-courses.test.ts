import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COURSES, COURSE_IDS, isCourse, trackOf } from '../src/os/arcade/games/palmdrive/courses.ts';
import { CCS, RIVALS, createRace, soloRace, step } from '../src/os/arcade/games/palmdrive/logic.ts';
import { meta } from '../src/os/arcade/games/palmdrive/meta.ts';
import { configOf, hostState, parsePacket } from '../src/os/arcade/games/palmdrive/net.ts';
import { EDGE, ROAD_HALF, gridSpot, locate, pointAt } from '../src/os/arcade/games/palmdrive/track.ts';

test('the course list and its ids agree', () => {
  assert.deepEqual(Object.keys(COURSES).sort(), [...COURSE_IDS].sort());
  for (const id of COURSE_IDS) {
    assert.equal(COURSES[id].id, id);
    assert.ok(isCourse(id));
    assert.ok(COURSES[id].name && COURSES[id].blurb && COURSES[id].sky.startsWith('linear-gradient('));
  }
  for (const junk of ['', 'moon', null, 3]) assert.equal(isCourse(junk), false);
});

for (const id of COURSE_IDS) {
  test(`${id}: a closed loop of sensible length that never runs into itself or bends too tight`, () => {
    const t = trackOf(id);
    assert.equal(trackOf(id), t, 'built once');
    assert.ok(t.length > 850 && t.length < 1150, `length ${t.length}`);
    // stretches far apart along the lap stay clear of each other's walls
    let closest = Infinity;
    for (let i = 0; i < t.n; i++) {
      for (let j = i + 1; j < t.n; j++) {
        if (Math.min(j - i, t.n - (j - i)) * t.step < 70) continue;
        closest = Math.min(closest, Math.hypot(t.x[i] - t.x[j], t.z[i] - t.z[j]));
      }
    }
    assert.ok(closest > 2 * EDGE + 4, `closest stretches ${closest}`);
    // any tighter and the inside wall would fold over itself
    let tightest = Infinity;
    for (let i = 0; i < t.n; i++) tightest = Math.min(tightest, 1 / Math.max(1e-9, Math.abs(t.curv[i])));
    assert.ok(tightest > 18, `tightest bend ${tightest}`);
    // index 0 is the start line
    const start = COURSES[id].start;
    const sp = { x: -start[0] * 0.8, z: start[1] * 0.8 };
    assert.ok(Math.hypot(t.x[0] - sp.x, t.z[0] - sp.z) < 3);
  });

  test(`${id}: item boxes, coins, dash panels and ramps all sit on the road, and the boosts on straights`, () => {
    const t = trackOf(id);
    const lay = COURSES[id].layout(t);
    assert.equal(lay.boxes.length, 12);
    assert.ok(lay.coins.length >= 25);
    assert.ok(lay.dashes.length >= 2 && lay.ramps.length >= 1);
    for (const p of [...lay.boxes, ...lay.coins, ...lay.dashes]) assert.ok(Math.abs(p.d) <= ROAD_HALF - 1.5, `${id} pickup at s=${p.s} d=${p.d}`);
    for (const ramp of lay.ramps) assert.ok(Math.abs(ramp.d) + ramp.w / 2 <= ROAD_HALF + 0.5, `${id} ramp at s=${ramp.s}`);
    const curv = (s: number) => Math.abs(t.curv[Math.floor(s / t.step) % t.n]);
    for (const p of [...lay.dashes, ...lay.ramps]) {
      for (const ds of [-6, 0, 6]) assert.ok(curv(p.s + ds) < 0.03, `${id} boost at s=${p.s} on a bend (${curv(p.s + ds)})`);
    }
    // nothing on top of the start line or another pickup row's coins piled into the walls
    for (const c of lay.coins) {
      const p = pointAt(t, c.s, c.d);
      assert.ok(Math.abs(locate(t, p.x, p.z).d) < ROAD_HALF, `${id} coin at s=${c.s} is on the road`);
    }
  });

  test(`${id}: the grid lines up on the road behind the start line`, () => {
    const t = trackOf(id);
    for (let slot = 0; slot < 8; slot++) {
      const g = gridSpot(t, slot);
      const at = locate(t, g.x, g.z);
      assert.ok(Math.abs(at.d) < ROAD_HALF - 1, `slot ${slot} d=${at.d}`);
      assert.ok(at.s > t.length - 40, `slot ${slot} is behind the line (s=${at.s})`);
    }
  });

  test(`${id}: a full field of CPU drivers races five laps at 150cc and 200cc inside the walls`, () => {
    for (const cc of ['150cc', '200cc'] as const) {
      const r = createRace({ cc, course: id, seed: 21, racers: [...RIVALS, { ...RIVALS[3], name: 'extra' }] });
      assert.equal(r.course, id);
      assert.equal(r.track, trackOf(id));
      let widest = 0;
      let rescues = 0;
      while (r.time < 600 && r.karts.some((k) => k.done === null)) {
        step(r, 1 / 60);
        r.events.length = 0;
        for (const k of r.karts) {
          widest = Math.max(widest, Math.abs(k.d));
          if (k.stuck > 2) rescues++;
        }
      }
      assert.ok(r.karts.every((k) => k.done !== null), `${id} ${cc}: everyone finished by ${r.time}`);
      assert.ok(widest <= EDGE, `${id} ${cc}: a kart got ${widest} from the line`);
      assert.equal(rescues, 0, `${id} ${cc}: nobody got stuck`);
      const fastest = Math.min(...r.karts.map((k) => k.done!));
      assert.ok(fastest > meta.leaderboard!.min! / 1000, `${id} ${cc}: ${fastest}s beats the board's floor`);
    }
  });
}

test('solo races and online state carry the course; old packets mean Palm Drive', () => {
  assert.equal(soloRace('100cc', 3).course, 'palm');
  const lake = soloRace('100cc', 3, undefined, 'lake');
  assert.equal(lake.course, 'lake');
  assert.equal(lake.track, trackOf('lake'));
  const S = parsePacket(JSON.parse(JSON.stringify(hostState(2, 1, '150cc', [0], [], 'lake'))));
  assert.ok(S && S.k === 'S' && S.course === 'lake');
  const cfg = parsePacket(JSON.parse(JSON.stringify(configOf(2, '200cc', 'lake'))));
  assert.deepEqual(cfg, { k: 'cfg', round: 2, cc: '200cc', course: 'lake' });
  const old = parsePacket({ t: 'pk', r: 2, k: 'cfg', cc: '50cc' });
  assert.ok(old && old.k === 'cfg' && old.course === 'palm');
  const oldS = parsePacket({ t: 'pk', r: 2, k: 'S', go: 1, cc: '50cc', ro: [0], cars: [] });
  assert.ok(oldS && oldS.k === 'S' && oldS.course === 'palm');
});

test('every course has a leaderboard at every class', () => {
  const variants = meta.leaderboard?.variants ?? {};
  for (const id of COURSE_IDS) for (const cc of CCS) assert.ok(variants[`${id}-${cc}`]?.includes(COURSES[id].name), `${id}-${cc}`);
  assert.equal(Object.keys(variants).length, COURSE_IDS.length * CCS.length);
});
