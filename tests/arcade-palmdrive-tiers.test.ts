import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COURSES, COURSE_IDS, TIER, tierOf, type CourseId, type Difficulty } from '../src/os/arcade/games/palmdrive/courses.ts';
import { CLASSES, GREEN_V, RIVALS, createRace, hitKart, spawn, step, type Ev, type Kart, type Race } from '../src/os/arcade/games/palmdrive/logic.ts';
import { awake, ballSince, headingOf, locate, pointAt } from '../src/os/arcade/games/palmdrive/track.ts';

const DT = 1 / 60;

function race(course: CourseId, n = 1, cc: '100cc' | '150cc' | '200cc' = '100cc', seed = 5): Race {
  return createRace({ cc, course, seed, countdown: 0, racers: Array.from({ length: n }, (_, i) => ({ name: `p${i}`, color: '#e53935', kind: 'player' as const })) });
}

function place(r: Race, k: Kart, s: number, d = 0, v = 0) {
  const p = pointAt(r.track, s, d);
  const at = locate(r.track, p.x, p.z);
  Object.assign(k, { x: p.x, z: p.z, h: headingOf(p.tx, p.tz), v, i: at.i, s: at.s, d: at.d, prog: s });
}

function run(r: Race, seconds: number, each?: () => void): Ev[] {
  const all: Ev[] = [];
  for (let n = Math.round(seconds / DT); n > 0; n--) {
    step(r, DT);
    all.push(...r.events.splice(0));
    each?.();
  }
  return all;
}

test('every course races at its difficulty\'s tier, and each tier up is harder than the last', () => {
  for (const id of COURSE_IDS) {
    const c = COURSES[id];
    assert.deepEqual(tierOf(id), { ...TIER[c.difficulty], ...c.tier }, id);
    assert.deepEqual(race(id).tier, tierOf(id), `${id} races at its tier`);
  }
  for (const d of [2, 3, 4] as Difficulty[]) {
    const [a, b] = [TIER[(d - 1) as Difficulty], TIER[d]];
    assert.ok(b.pace > a.pace, `pace ${d}`);
    assert.ok(b.band[0] >= a.band[0] && b.band[1] >= a.band[1] && b.band[2] <= a.band[2], `band ${d}`);
    assert.ok(b.harsh >= a.harsh && b.rocket >= a.rocket && b.fallT >= a.fallT && b.fallCoins >= a.fallCoins, `costs ${d}`);
  }
  // Expert's CPUs are quicker than the class's, within reason
  assert.ok(TIER[4].pace >= 0.99 && TIER[4].pace <= 1.04);
  // and the Red Barn, the trickier of the Medium courses, runs its CPUs a touch slower
  assert.ok(tierOf('barn').pace < TIER[2].pace && tierOf('lake').pace === TIER[2].pace);
});

test('CPUs top out at the tier\'s pace; your kart bringing itself home after the flag does not', () => {
  /** The best speed a kart reaches down the start straight at Palm Drive with the tier's pace set to `pace`. */
  const top = (kind: 'cpu' | 'player', pace: number) => {
    const r = createRace({ cc: '150cc', course: 'palm', seed: 3, countdown: 0, racers: [{ ...RIVALS[0], kind, skill: 0 }] });
    r.tier = { ...r.tier, pace };
    const [k] = r.karts;
    if (kind === 'player') {
      // after the flag the CPU driver takes the wheel
      k.auto = true;
      k.done = 1;
    } else k.ai!.skill = 0;
    place(r, k, 10, 0, 0);
    let best = 0;
    run(r, 6, () => (best = Math.max(best, k.v)));
    return best;
  };
  const C = CLASSES['150cc'];
  assert.ok(Math.abs(top('cpu', 1) - C.top * RIVALS[0].pace! * C.cpu) < 0.05, `${top('cpu', 1)}`);
  assert.ok(Math.abs(top('cpu', 1.04) / top('cpu', 1) - 1.04) < 0.002, 'the tier pace scales a CPU');
  assert.equal(top('player', 1.04), top('player', 1), 'but not your kart on autopilot');
});

test('a spin, a squash or a tumble keeps you down for longer on the harder courses, whatever caused it', () => {
  for (const id of ['palm', 'quad', 'hoover'] as const) {
    const harsh = tierOf(id).harsh;
    for (const [how, base] of [['spin', 1.05], ['squash', 0.8], ['tumble', 1.3], ['boom', 1.8]] as const) {
      const r = race(id);
      const k = r.karts[0];
      assert.ok(hitKart(r, k, how, -1));
      const down = how === 'tumble' || how === 'boom' ? k.tumble : k.spin;
      assert.ok(Math.abs(down - base * harsh) < 1e-9, `${id} ${how} ${down}`);
      assert.ok(Math.abs(k.safe - (base * harsh + 0.7)) < 1e-9, `${id} ${how} grace`);
    }
  }
  assert.equal(tierOf('palm').harsh, 1);
  assert.ok(Math.abs(tierOf('hoover').harsh * 1.05 - 1.365) < 1e-9);
});

test('the CPUs ease off less when well ahead of you, and push harder from behind, on the harder courses', () => {
  for (const id of ['palm', 'dish', 'golf'] as const) {
    const [slow, fast] = tierOf(id).band;
    for (const [gap, want] of [[2000, fast], [-2000, slow], [0, 1]] as const) {
      const r = createRace({ cc: '150cc', course: id, seed: 4, countdown: 0, racers: [RIVALS[0], { name: 'you', color: '#e53935', kind: 'player' }] });
      const [cpu, you] = r.karts;
      you.prog = cpu.prog + gap;
      step(r, DT);
      assert.ok(Math.abs(cpu.ai!.band - want) < 0.01, `${id} ${gap}: ${cpu.ai!.band}`);
    }
  }
});

test('the CPUs nail more rocket starts on the harder courses', () => {
  const count = (course: CourseId) => {
    let n = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const r = createRace({ cc: '150cc', course, seed, racers: RIVALS });
      while (r.time < 0.1) {
        step(r, DT);
        n += r.events.splice(0).filter((e) => e.t === 'rocket').length;
      }
    }
    return n / (30 * RIVALS.length);
  };
  const skill = RIVALS.reduce((s, k) => s + k.skill!, 0) / RIVALS.length;
  const easy = count('palm');
  const expert = count('hoover');
  assert.ok(Math.abs(easy - skill * TIER[1].rocket) < 0.08, `easy ${easy}`);
  assert.ok(Math.abs(expert - skill * TIER[4].rocket) < 0.08, `expert ${expert}`);
  assert.ok(expert > easy);
});

test('every lap something joins in on has a line for the lap banner, and only those laps', () => {
  for (const id of COURSE_IDS) {
    const t = createRace({ cc: '150cc', course: id, racers: [RIVALS[0]] }).track;
    const laps = new Set(COURSES[id].layout(t).hazards.filter((h) => h.lap && h.lap > 1).map((h) => h.lap!));
    assert.deepEqual(Object.keys(COURSES[id].laps ?? {}).map(Number).sort(), [...laps].sort(), id);
    for (const note of Object.values(COURSES[id].laps ?? {})) assert.ok(note.length > 4 && note.length <= 28, `${id}: "${note}" fits on a phone`);
  }
});

test('the golf course gets busier: the whole range is hitting from the third lap, and the gallery crosses the 18th on the last', () => {
  const r = race('golf');
  const t = r.track;
  const lap3 = r.hazards.filter((h) => h.lap === 3);
  const lap5 = r.hazards.filter((h) => h.lap === 5);
  assert.equal(lap3.length, 4);
  assert.ok(lap3.every((h) => h.kind === 'ball' && h.s > 150 && h.s < 260 && h.tee![1] > 0), 'four more balls across the first-tee straight, from the range');
  assert.deepEqual(lap5.map((h) => h.kind).sort(), ['ball', 'ball', 'golfer', 'golfer', 'golfer', 'golfer']);
  assert.ok(lap5.every((h) => h.s > 950 && h.s < t.length - 30), 'all on the approach to the 18th green');
  const four = lap5.filter((h) => h.kind === 'golfer');
  assert.ok(four.every((h) => h.phase === four[0].phase && h.speed === four[0].speed), 'the gallery walks in step');
  assert.equal(r.hazards.filter((h) => !h.lap || h.lap === 1).length + lap3.length + lap5.length, r.hazards.length);
});

test('until its lap comes round, something that joins in later is not there for that kart: no bonk, no golfer, shells fly on', () => {
  // a ball from the range that starts on lap 3: parked under it as it lands
  for (const lap of [1, 2, 3, 4]) {
    const r = race('golf');
    const k = r.karts[0];
    const ball = r.hazards.find((h) => h.kind === 'ball' && h.lap === 3)!;
    const due = 2 + ((ball.every! - ballSince(ball, 2)) % ball.every!);
    r.time = due - 0.4;
    place(r, k, ball.s, ball.d, 0);
    k.lap = lap;
    k.input.brake = true;
    const bonked = run(r, 0.8).some((e) => e.t === 'plink' && e.k === k.idx);
    assert.equal(bonked, lap >= 3, `lap ${lap}`);
    assert.equal(awake(ball, lap), lap >= 3);
  }
  // the gallery at the 18th: drive into one of them
  for (const lap of [4, 5]) {
    const r = race('golf');
    const k = r.karts[0];
    const g = r.hazards.find((h) => h.kind === 'golfer' && h.lap === 5)!;
    k.lap = lap;
    place(r, k, g.s - 4, g.at, 18);
    const fore = run(r, 0.5).some((e) => e.t === 'fore' && e.k === k.idx);
    assert.equal(fore, lap === 5, `lap ${lap}`);
  }
  // a shell thrown at one goes by its thrower's lap
  for (const lap of [1, 5]) {
    const r = race('golf');
    const k = r.karts[0];
    k.lap = lap;
    const g = r.hazards.find((h) => h.kind === 'golfer' && h.lap === 5)!;
    const from = pointAt(r.track, g.along - 12, g.at);
    const shell = spawn(r, { kind: 'green', owner: 0, x: from.x, z: from.z, y: 0.35, vx: from.tx * GREEN_V, vz: from.tz * GREEN_V, vy: 0, grace: 9, target: -1, prog: 0 });
    place(r, k, g.along - 60, -5, 0);
    run(r, 0.4);
    const gone = !r.things.some((th) => th.id === shell.id);
    assert.equal(gone, lap === 5, `thrower on lap ${lap}`);
  }
});

test('a kart in the water is out of everyone\'s way: nobody bumps it and it picks nothing up', () => {
  const r = race('golf', 2);
  const [a, b] = r.karts;
  place(r, a, 470, -7.2, 14);
  a.h = headingOf(pointAt(r.track, 470).tx, pointAt(r.track, 470).tz) + 0.6;
  run(r, 0.6);
  assert.ok(a.sunk > 0);
  const at = { x: a.x, z: a.z };
  const coins = a.coins;
  // another kart pulls up right beside it on the dry side, and there is a coin just past it in the water
  const here = locate(r.track, a.x, a.z);
  const dry = pointAt(r.track, here.s, here.d + 1.5);
  place(r, b, here.s, here.d + 1.5, 0);
  const wet = pointAt(r.track, here.s, here.d - 1);
  const coin = { x: wet.x, z: wet.z, t: 0 };
  r.coins.push(coin);
  step(r, DT);
  assert.ok(b.sunk === 0 && Math.hypot(b.x - dry.x, b.z - dry.z) < 0.5, 'the other kart is dry, beside it');
  assert.ok(Math.hypot(a.x - at.x, a.z - at.z) < 1e-6, 'not bumped');
  assert.equal(a.coins, coins, 'no coin');
  assert.equal(coin.t, 0, 'the coin is still there');
});
