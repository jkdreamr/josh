import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  accuracy, CLEAR_SECONDS, createRange, hitTest, INTRO_SECONDS, localAim,
  multiplier, RESPAWN_SECONDS, shootRange, stepRange, targetPosition, targetsFor, WAVES,
  type RangeState,
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

test('five distinct motion patterns are deterministic, stay in bounds, and remain finger-sized', () => {
  for (let wave = 0; wave < WAVES.length; wave++) {
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
  assert.equal(targetsFor(live(), 0, 100).length, 0);
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

test('progression clears all five waves and ends exactly once, without another playable target', () => {
  const g = live();
  for (let wave = 0; wave < WAVES.length; wave++) {
    assert.equal(g.wave, wave);
    for (let i = 0; i < WAVES[wave].goal; i++) {
      if (!targetsFor(g, 600, 360).length) stepRange(g, RESPAWN_SECONDS);
      assert.notEqual(hit(g).kind, 'miss');
    }
    assert.equal(g.phase, 'clear');
    if (wave < WAVES.length - 1) {
      assert.equal(stepRange(g, CLEAR_SECONDS), 'wave');
      stepRange(g, INTRO_SECONDS);
    }
  }
  assert.equal(stepRange(g, CLEAR_SECONDS), 'over');
  assert.ok(g.won);
  assert.equal(g.hits, 30);
  assert.equal(g.phase, 'over');
  assert.equal(stepRange(g, 10), undefined);
  assert.equal(shootRange(g, { x: 100, y: 100 }, []), null);
});

test('timeout ends a failed round with stable totals and no late scoring', () => {
  const g = live();
  hit(g);
  assert.equal(stepRange(g, g.timeLeft), 'over');
  assert.equal(g.timeLeft, 0);
  assert.equal(g.phase, 'over');
  assert.equal(g.won, false);
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
