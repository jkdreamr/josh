import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeAI } from '../src/os/arcade/games/soccer/ai.ts';
import { createWorld, distance, STEP, stepWorld } from '../src/os/arcade/games/soccer/logic.ts';

function trackingRun() {
  const world = createWorld(254);
  world.phase = 'live'; world.restart = null;
  for (const p of world.players) { p.human = true; p.controlled = false; }
  const backs = world.players.filter((p) => p.team === 0 && ['LB', 'CB', 'LCB', 'RCB', 'RB'].includes(p.slot));
  for (const p of backs) p.human = false;
  const carrier = world.players[12]!;
  carrier.x = 35; carrier.z = 23; carrier.vx = carrier.vz = 0;
  for (const [i, id] of [6, 7].entries()) {
    world.players[id]!.x = carrier.x - 2 - i * 2; world.players[id]!.z = carrier.z;
  }
  world.carrierId = world.lastToucherId = carrier.id; world.lastTouch = 1;
  world.ball.x = carrier.x + 0.4; world.ball.z = carrier.z;
  const still = new Map(backs.map((p) => [p.id, 0]));
  let longest = 0;
  const samples: number[] = [];
  for (let tick = 0; tick < 2400; tick++) {
    const before = backs.map((p) => ({ x: p.x, z: p.z }));
    stepWorld(world, STEP, computeAI(world, 'normal', STEP, tick, 0));
    for (let i = 0; i < backs.length; i++) {
      const p = backs[i]!;
      const seconds = distance(p, before[i]!) < 0.0005 ? still.get(p.id)! + STEP : 0;
      still.set(p.id, seconds); longest = Math.max(longest, seconds);
    }
    if (tick % 120 === 0) samples.push(...backs.flatMap((p) => [p.x, p.z]));
  }
  return { longest, samples };
}

test('distant back-line players track and shuffle deterministically without long stationary stretches', () => {
  const first = trackingRun();
  assert.deepEqual(first, trackingRun());
  console.log(`longest back-line stationary stretch: ${first.longest.toFixed(3)} s`);
  assert.ok(first.samples.length > 0);
  assert.ok(first.longest < 3);
});
