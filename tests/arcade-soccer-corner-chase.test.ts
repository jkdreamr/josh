import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeAI } from '../src/os/arcade/games/soccer/ai.ts';
import { createWorld, distance, FIELD, nearestCarrier, STEP, stepWorld } from '../src/os/arcade/games/soccer/logic.ts';

test('nearest CPU collects a stationary loose ball beside every corner flag', () => {
  for (const x of [-1, 1]) for (const z of [-1, 1]) {
    const world = createWorld(254);
    world.phase = 'live'; world.restart = null;
    for (const p of world.players) { p.human = true; p.controlled = false; p.x = 0; p.z = 0; }
    const player = world.players[1]!;
    player.human = false; player.x = x * (FIELD.length / 2 - 3); player.z = z * (FIELD.width / 2 - 3);
    world.ball.x = x * (FIELD.length / 2 - 0.25); world.ball.z = z * (FIELD.width / 2 - 0.35);
    world.lastTouch = 1;
    let tick = 0;
    while (nearestCarrier(world)?.id !== player.id && tick < 180) {
      stepWorld(world, STEP, computeAI(world, 'normal', STEP, tick++, 0));
    }
    assert.equal(nearestCarrier(world)?.id, player.id, `corner ${x}/${z}, remaining gap ${distance(player, world.ball)}`);
  }
});
