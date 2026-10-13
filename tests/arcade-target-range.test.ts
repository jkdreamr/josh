import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  accuracy, CLEAR_SECONDS, createRange, hitTest, INTRO_SECONDS, localAim, motionAt, multiplier,
  patternPoint, RESPAWN_SECONDS, shootRange, stepRange, targetPosition, targetsFor, waveAt, WAVES,
  type Pattern, type RangeState,
} from '../src/os/arcade/games/target-range/logic.ts';

function live() {
  const g = createRange();
  stepRange(g, INTRO_SECONDS);
  assert.equal(g.phase, 'live');
  return g;
}

function hit(g: RangeState, center = true) {
  const targets = targetsFor(g, 600, 360);
  const t = targets[0];
  assert.ok(t);
  return shootRange(g, { x: t.x + (center ? 0 : t.radius * 0.7), y: t.y }, targets)!;
}

test('local aim preserves fractional canvas offsets at every device size, not viewport bounding boxes', () => {
  for (const [w, h] of [[540, 280], [1180, 620], [350, 500], [760, 820]]) {
    assert.deepEqual(localAim(w * 0.2 + 0.125, h * 0.6, w, h), { x: w * 0.2 + 0.125, y: h * 0.6 });
    assert.equal(localAim(-1, 4, w, h), null);
    assert.equal(localAim(w + 1, 4, w, h), null);
    assert.equal(localAim(4, h + 1, w, h), null);
  }
  assert.equal(localAim(1, 2, 0, 200), null);
  assert.equal(localAim(NaN, 2, 400, 200), null);
});

test('circular hitboxes include the visible rim but exclude the corners of the bounding square', () => {
  const target = { id: 0, x: 100, y: 100, radius: 30 };
  assert.ok(hitTest({ x: 130, y: 100 }, [target]));
  assert.equal(hitTest({ x: 130.01, y: 100 }, [target]), null);
  assert.equal(hitTest({ x: 129, y: 129 }, [target]), null);
  assert.ok(hitTest({ x: 100, y: 109 }, [target])?.bullseye);
  assert.equal(hitTest({ x: 100, y: 109.01 }, [target])?.bullseye, false);
  assert.equal(hitTest({ x: Infinity, y: 100 }, [target]), null);
});

test('when moving targets overlap, the frontmost painted target is the one hit', () => {
  const targets = [{ id: 0, x: 100, y: 100, radius: 30 }, { id: 1, x: 100, y: 100, radius: 30 }];
  assert.equal(hitTest({ x: 100, y: 100 }, targets)?.target.id, 1);
});

test('center hits, rim hits, streak multipliers, and accuracy have explicit deterministic scores', () => {
  const g = live();
  assert.equal(hit(g).points, 150);
  assert.equal(hit(g, false).points, 100);
  assert.equal(hit(g).points, 300, 'third consecutive hit starts the 2x combo');
  assert.equal(g.score, 550);
  assert.equal(g.bullseyes, 2);
  assert.equal(g.combo, 3);
  assert.equal(accuracy(g), 100);
  assert.deepEqual([0, 2, 3, 6, 9, 100].map(multiplier), [1, 1, 2, 3, 4, 4]);
});

test('misses reset the combo, never subtract score, and preserve the best streak', () => {
  const g = live();
  hit(g); hit(g);
  const before = g.score;
  const result = shootRange(g, { x: 0, y: 0 }, targetsFor(g, 600, 360));
  assert.equal(result?.kind, 'miss');
  assert.equal(g.combo, 0);
  assert.equal(g.bestCombo, 2);
  assert.equal(g.score, before);
  assert.equal(g.misses, 1);
  assert.equal(accuracy(g), 67);
  assert.equal(hit(g).points, 150);
});

test('a target disappears immediately and respawns only after its cooldown', () => {
  const g = live();
  const initial = targetsFor(g, 600, 360);
  const t = initial[0];
  shootRange(g, t, initial);
  assert.ok(!targetsFor(g, 600, 360).some((p) => p.id === t.id));
  assert.equal(shootRange(g, t, initial)?.kind, 'miss', 'stale drawn geometry cannot double-score');
  assert.equal(g.hits, 1);
  stepRange(g, RESPAWN_SECONDS - 0.001);
  assert.ok(!targetsFor(g, 600, 360).some((p) => p.id === t.id));
  stepRange(g, 0.002);
  assert.ok(targetsFor(g, 600, 360).some((p) => p.id === t.id));
});

test('every motion pattern, opening or generated, is deterministic, stays in bounds, and remains finger-sized', () => {
  for (const wave of [...Array(WAVES.length + 40).keys(), 400, 401, 402, 403]) {
    for (const [w, h] of [[540, 230], [350, 500], [760, 850], [1120, 700]]) {
      const g = live();
      g.wave = wave;
      for (let i = 0; i < 100; i++) {
        g.motionTime = i * 0.73;
        const targets = targetsFor(g, w, h);
        assert.equal(targets.length, 3);
        for (const t of targets) {
          assert.ok(t.radius * 2 >= 48);
          assert.ok(t.x - t.radius >= 0 && t.x + t.radius <= w);
          assert.ok(t.y - t.radius >= 0 && t.y + t.radius <= h);
          assert.deepEqual(targetPosition(wave, t.id, g.motionTime), targetPosition(wave, t.id, g.motionTime));
          assert.equal(hitTest(t, [t])?.bullseye, true);
        }
      }
    }
  }
  assert.deepEqual(targetPosition(0, 0, 0), targetPosition(0, 0, 9));
  for (let wave = 1; wave < WAVES.length; wave++) assert.notDeepEqual(targetPosition(wave, 0, 0), targetPosition(wave, 0, 1));
  for (let wave = WAVES.length; wave < WAVES.length + 40; wave++) {
    const seen = new Set(Array.from({ length: 20 }, (_, i) => JSON.stringify(targetPosition(wave, 0, i * 0.25))));
    assert.ok(seen.size > 1, `${waveAt(wave).name} targets move`);
    const columns = Array.from({ length: 80 }, (_, i) => [0, 1, 2].map((slot) => targetPosition(wave, slot, i * 0.1).x.toFixed(6)));
    assert.ok(columns.some((xs) => new Set(xs).size > 1), `${waveAt(wave).name} targets do not travel as one stacked column`);
  }
  assert.equal(targetsFor(live(), 0, 100).length, 0);
});

test('later waves shrink targets toward a floor, never below a fingertip', () => {
  const g = live();
  const full = targetsFor(g, 600, 360)[0].radius;
  g.wave = 12;
  const smaller = targetsFor(g, 600, 360)[0].radius;
  g.wave = 10_000;
  const smallest = targetsFor(g, 600, 360)[0].radius;
  assert.ok(full > smaller && smaller > smallest);
  assert.ok(smallest >= 24);
  g.wave = 10_000;
  assert.ok(targetsFor(g, 260, 180).every((t) => t.radius >= 24));
});

test('after the five opening waves, new waves are generated forever, each a little harder', () => {
  for (let i = 0; i < WAVES.length; i++) assert.equal(waveAt(i), WAVES[i]);
  assert.deepEqual(waveAt(37), waveAt(37));
  assert.deepEqual(Array.from({ length: 12 }, (_, i) => waveAt(WAVES.length + i).name), [
    'Pendulum', 'Pretzel', 'Trampoline', 'Counterspin', 'Bloom', 'Ricochet',
    'Moons', 'Whirlpool', 'Pop Up', 'Shell Game', 'Darts', 'Hornets',
  ]);
  assert.deepEqual([17, 18, 19, 20, 21, 24, 38].map((n) => waveAt(n).name), [
    'On Rails II', 'Pendulum II', 'Bounce II', 'Mayhem', 'Pretzel II', 'Mayhem II', 'On Rails III',
  ]);
  assert.equal(waveAt(17 + 4 * 39 + 3).name, 'Mayhem XL');
  const seen = new Set<Pattern>();
  for (let n = 0; n < 17; n++) seen.add(waveAt(n).patterns[0]);
  assert.equal(seen.size, 17, 'every pattern has had a wave of its own by wave 17');

  const names = new Set<string>();
  for (let n = 0; n < 500; n++) {
    const w = waveAt(n);
    assert.ok(!names.has(w.name), `${w.name} repeats`);
    names.add(w.name);
    assert.ok([w.goal, w.seconds, w.speed, w.size, w.surge].every(Number.isFinite));
    if (n === 0) continue;
    const prev = waveAt(n - 1);
    // Strictly harder while the ramp is live; once it settles at its ceiling, never easier.
    const harder = n < 40 ? (a: number, b: number) => a > b : (a: number, b: number) => a >= b;
    assert.ok(w.goal >= prev.goal && w.goal <= 18, `goal at wave ${n + 1}`);
    assert.ok(harder(w.speed, prev.speed) && w.speed <= 2.7, `speed at wave ${n + 1}`);
    assert.ok(harder(prev.seconds / prev.goal, w.seconds / w.goal) && w.seconds / w.goal >= 1.7, `time per target at wave ${n + 1}`);
    assert.ok((n < WAVES.length ? prev.size === w.size : harder(prev.size, w.size)) && w.size >= 0.62, `size at wave ${n + 1}`);
    assert.ok(w.surge >= prev.surge && w.surge <= 1.6, `surge at wave ${n + 1}`);
  }
  assert.equal(waveAt(12).goal, 12);
  assert.ok(waveAt(12).seconds < 12 * 2.4, 'about two seconds a target by wave 13');
});

test('pop up targets hold still, then jump somewhere new in their own column', () => {
  const wave = [...Array(40).keys()].find((n) => waveAt(n).patterns[0] === 'hop')!;
  assert.equal(waveAt(wave).name, 'Pop Up');
  for (let slot = 0; slot < 3; slot++) {
    const spots = new Set<string>();
    let still = 0;
    for (let i = 0; i < 400; i++) {
      const p = targetPosition(wave, slot, i * 0.05);
      const q = targetPosition(wave, slot, i * 0.05 + 0.01);
      if (p.x === q.x && p.y === q.y) still++;
      spots.add(JSON.stringify(p));
      assert.ok(p.x >= 0.2 + slot * 0.2 && p.x <= 0.4 + slot * 0.2);
      assert.ok(p.y >= 0.22 && p.y <= 0.78);
    }
    assert.ok(still > 380, 'targets rest between hops');
    assert.ok(spots.size >= 6, 'and keep moving to new spots');
  }
});

test('warm-up and wave-cleared intermissions do not consume the wave clock or count shots', () => {
  const g = createRange();
  const before = structuredClone(g);
  assert.equal(shootRange(g, { x: 100, y: 100 }, targetsFor(g, 600, 360)), null);
  assert.deepEqual(g, before);
  stepRange(g, INTRO_SECONDS / 2);
  assert.equal(g.timeLeft, WAVES[0].seconds);
  stepRange(g, INTRO_SECONDS / 2);
  assert.equal(g.phase, 'live');
  stepRange(g, 0.38);
  assert.equal(g.timeLeft, WAVES[0].seconds - 0.38);
});

test('every fourth wave after the debuts is Mayhem: three different patterns at once, all named in the hint', () => {
  let mayhems = 0;
  for (let n = 0; n < 300; n++) {
    const w = waveAt(n);
    const mixed = new Set(w.patterns).size > 1;
    assert.equal(mixed, w.name.startsWith('Mayhem'), w.name);
    assert.equal(mixed, n >= 17 && (n - 17) % 4 === 3, `wave ${n + 1}`);
    if (!mixed) continue;
    mayhems++;
    assert.equal(new Set(w.patterns).size, 3, `${w.name} never doubles up a pattern`);
    assert.ok(!w.patterns.includes('fixed'));
    assert.equal(w.hint.split(' + ').length, 3);
  }
  assert.equal(mayhems, 70);
  assert.deepEqual(waveAt(20).patterns, waveAt(20).patterns);
  assert.notDeepEqual(waveAt(20).patterns, waveAt(24).patterns);
});

test('the pace lurches on later waves, then doubles back, but every wave still moves forward overall', () => {
  const sample = (n: number) => Array.from({ length: 600 }, (_, i) => motionAt(waveAt(n), i * 0.05));
  const reverses = (xs: number[]) => xs.some((x, i) => i > 0 && x < xs[i - 1]);
  for (let n = 0; n < 17; n++) {
    assert.equal(waveAt(n).surge, 0);
    assert.ok(!reverses(sample(n)), `${waveAt(n).name} glides steadily`);
  }
  const lurch = sample(19);
  assert.ok(waveAt(19).surge > 0 && waveAt(19).surge < 1);
  assert.ok(!reverses(lurch), 'a mild surge speeds up and slows down without reversing');
  const steps = lurch.slice(1).map((x, i) => x - lurch[i]);
  assert.ok(Math.max(...steps) > 2 * Math.min(...steps), 'but the pace clearly changes');
  for (const n of [30, 60, 400]) {
    const xs = sample(n);
    assert.ok(waveAt(n).surge > 1);
    assert.ok(reverses(xs), `${waveAt(n).name} doubles back`);
    assert.ok(xs.at(-1)! > 20, 'and still covers ground');
  }
});

test('shell game cups always rest on three different spots, and trade places one pair at a time', () => {
  const arrangements = new Set<string>();
  for (let i = 0; i < 2000; i++) {
    const t = i * 0.07;
    const cups = [0, 1, 2].map((slot) => patternPoint('shell', slot, t));
    const moving = cups.filter((p) => p.y !== 0.5);
    if (moving.length === 0) {
      const xs = cups.map((p) => Math.round(p.x * 10) / 10);
      assert.deepEqual([...xs].sort(), [0.2, 0.5, 0.8], `at ${t}`);
      arrangements.add(xs.join());
    } else {
      assert.equal(moving.length, 2, `at ${t}`);
      assert.ok(moving.some((p) => p.y < 0.5) && moving.some((p) => p.y > 0.5), 'one passes over, the other under');
    }
  }
  assert.ok(arrangements.size >= 4, 'the cups really get shuffled');
});

test('darts rest, then streak somewhere new', () => {
  for (let slot = 0; slot < 3; slot++) {
    let still = 0;
    const spots = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const p = patternPoint('darts', slot, i * 0.1);
      const q = patternPoint('darts', slot, i * 0.1 + 0.01);
      if (p.x === q.x && p.y === q.y) {
        still++;
        spots.add(JSON.stringify(p));
      }
    }
    assert.ok(still > 180 && still < 300, `slot ${slot} rests about half the time (${still})`);
    assert.ok(spots.size >= 10);
  }
});

test('clearing a wave awards an exact time bonus and advances the goal and pattern without losing totals', () => {
  const g = live();
  hit(g); hit(g); hit(g);
  stepRange(g, RESPAWN_SECONDS);
  const shot = hit(g);
  assert.ok(shot.cleared);
  assert.equal(g.phase, 'clear');
  assert.equal(g.bonus, Math.ceil(g.timeLeft) * 10);
  const score = g.score;
  const remaining = g.timeLeft;
  assert.equal(shootRange(g, { x: 10, y: 10 }, []), null);
  assert.equal(targetsFor(g, 600, 360).length, 0);
  assert.equal(stepRange(g, CLEAR_SECONDS), 'wave');
  assert.equal(g.wave, 1);
  assert.equal(g.waveHits, 0);
  assert.equal(g.phase, 'intro');
  assert.equal(g.score, score);
  assert.equal(g.hits, 4);
  assert.equal(g.combo, 4);
  assert.equal(g.timeLeft, WAVES[1].seconds);
  assert.ok(g.timeLeft > remaining);
});

test('clearing waves never ends the round: play runs past the opening into generated waves until time runs out', () => {
  for (const pace of ['standard', 'relaxed'] as const) {
    const g = createRange(pace);
    stepRange(g, INTRO_SECONDS);
    let hits = 0;
    for (let wave = 0; wave < 30; wave++) {
      assert.equal(g.wave, wave);
      assert.equal(g.timeLeft, waveAt(wave).seconds * (pace === 'relaxed' ? 1.4 : 1));
      assert.equal(g.phase, 'live');
      for (let i = 0; i < waveAt(wave).goal; i++) {
        if (!targetsFor(g, 600, 360).length) assert.equal(stepRange(g, RESPAWN_SECONDS), undefined);
        assert.notEqual(hit(g).kind, 'miss');
        hits++;
      }
      assert.equal(g.phase, 'clear');
      assert.equal(stepRange(g, CLEAR_SECONDS), 'wave');
      stepRange(g, INTRO_SECONDS);
    }
    assert.equal(g.hits, hits);
    assert.equal(g.misses, 0);
    assert.equal(g.wave, 30);
    assert.equal(stepRange(g, g.timeLeft), 'over');
    assert.equal(g.phase, 'over');
    assert.equal(stepRange(g, 10), undefined);
    assert.equal(shootRange(g, { x: 100, y: 100 }, []), null);
  }
});

test('timeout ends a failed round with stable totals and no late scoring', () => {
  const g = live();
  hit(g);
  assert.equal(stepRange(g, g.timeLeft), 'over');
  assert.equal(g.timeLeft, 0);
  assert.equal(g.phase, 'over');
  const result = structuredClone(g);
  assert.equal(shootRange(g, { x: 120, y: 200 }, []), null);
  stepRange(g, 0.1);
  assert.deepEqual(g, result);
});

test('restart creates fully independent clean state, including motion, feedback inputs, and difficulty', () => {
  const old = live();
  hit(old);
  stepRange(old, 2);
  const next = createRange('relaxed');
  assert.equal(next.wave, 0);
  assert.equal(next.score, 0);
  assert.equal(next.hits, 0);
  assert.equal(next.misses, 0);
  assert.equal(next.combo, 0);
  assert.equal(next.motionTime, 0);
  assert.deepEqual(next.cooldowns, [0, 0, 0]);
  assert.notEqual(next.cooldowns, old.cooldowns);
  assert.equal(next.timeLeft, WAVES[0].seconds * 1.4);
  stepRange(next, INTRO_SECONDS);
  stepRange(next, 1);
  assert.equal(next.motionTime, 0.65);
  assert.equal(old.hits, 1);
});

test('not stepping while paused preserves the round; invalid steps cannot advance it', () => {
  const g = live();
  hit(g);
  const paused = structuredClone(g);
  for (const dt of [0, -1, NaN, Infinity]) stepRange(g, dt);
  assert.deepEqual(g, paused);
  stepRange(g, 0.05);
  assert.equal(g.timeLeft, paused.timeLeft - 0.05);
  assert.ok(g.cooldowns[0] < paused.cooldowns[0]);
});
