import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createQualityGovernor } from '../src/os/arcade/games/soccer/quality.ts';

test('steady 60Hz frames never lower quality', () => {
  const governor = createQualityGovernor();
  const frameMs = 1000 / 60;
  assert.equal(governor.sample(0), false);
  for (let frame = 1; frame <= 3600; frame++) {
    assert.equal(governor.sample(frame * frameMs), false);
  }
  assert.ok(Math.abs(governor.avgMs - frameMs) < 0.01);
});

test('sustained slow frames lower quality only after the hold interval', () => {
  const governor = createQualityGovernor();
  governor.sample(0);
  let droppedAt: number | null = null;
  for (let now = 25; now <= 3000; now += 25) {
    if (governor.sample(now)) {
      droppedAt = now;
      break;
    }
  }
  assert.ok(droppedAt !== null && droppedAt >= 1500);
});

test('a long frame gap re-arms the hold without changing the average', () => {
  const governor = createQualityGovernor();
  governor.sample(0);
  for (let frame = 1; frame <= 60; frame++) governor.sample(frame * (1000 / 60));
  const average = governor.avgMs;
  assert.equal(governor.sample(6000), false);
  assert.equal(governor.avgMs, average);
  assert.ok(Math.abs(governor.avgMs - 16.7) < 0.1);
});

test('another full hold interval is required after a quality drop', () => {
  const governor = createQualityGovernor();
  governor.sample(0);
  const drops: number[] = [];
  for (let now = 25; now <= 5000; now += 25) {
    if (governor.sample(now)) drops.push(now);
  }
  assert.ok(drops.length >= 2);
  assert.ok(drops[1]! - drops[0]! >= 1500);
});
