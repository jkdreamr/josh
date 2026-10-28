import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeAI } from '../src/os/arcade/games/soccer/ai.ts';
import { createWorld, distance, STEP, stepWorld, TEAM_SIZE, type Player } from '../src/os/arcade/games/soccer/logic.ts';
import { LUNGE_COMMIT, observe, PERCEPTION_DELAY, perceive } from '../src/os/arcade/games/soccer/perception.ts';
import type { Level } from '../src/os/arcade/games/soccer/ai.ts';

function setupRun(seed = 254, presserOffset = 6) {
  const world = createWorld(seed);
  world.phase = 'live';
  world.restart = null;
  const attacker = world.players[6]!;
  attacker.human = true;
  attacker.controlled = true;
  attacker.x = -10;
  attacker.z = 0;
  attacker.vx = attacker.vz = 0;
  attacker.facing = Math.PI / 2;
  attacker.stamina = 0;
  const presser = world.players[16]!;
  for (const player of world.players) {
    if (player.id === attacker.id) continue;
    player.human = false;
    player.controlled = false;
    if (player.slot === 'GK') continue;
    if (player.team === 0) {
      player.x = -35;
      player.z = (player.id % TEAM_SIZE - 5) * 4;
    } else {
      player.x = 35;
      player.z = (player.id % TEAM_SIZE - 5) * 4;
    }
  }
  presser.x = attacker.x + presserOffset;
  presser.z = 0;
  world.ball.x = attacker.x + 0.4;
  world.ball.y = 0.11;
  world.ball.z = attacker.z;
  world.ball.vx = world.ball.vz = world.ball.vy = 0;
  world.carrierId = attacker.id;
  world.lastToucherId = attacker.id;
  world.lastTouch = attacker.team;
  world.passTarget = null;
  world.stealProtect = 0;
  return { world, attacker, presser };
}

function nearestDefender(world: ReturnType<typeof createWorld>, attacker: Player) {
  return Math.min(...world.players.filter((player) => player.team !== attacker.team && player.slot !== 'GK' && !player.sentOff)
    .map((player) => distance(attacker, player)));
}

function cutRun(level: Level, cut: boolean, seed = 254) {
  const { world, attacker, presser } = setupRun(seed);
  const cutFrame = 54;
  const afterCut = 30;
  let cutDistance = 0;
  let afterDistance = 0;
  for (let frame = 0; frame < cutFrame + afterCut; frame++) {
    if (frame === cutFrame) {
      cutDistance = nearestDefender(world, attacker);
      assert.equal(world.carrierId, attacker.id, `${level} attacker lost the ball before the cut`);
    }
    const commands = computeAI(world, level, STEP, frame + 1, 1);
    commands.set(attacker.id, {
      move: cut && frame >= cutFrame ? { x: 0, z: 1 } : { x: 1, z: 0 },
      sprint: true,
    });
    stepWorld(world, STEP, commands);
    if (frame === cutFrame + afterCut - 1) afterDistance = nearestDefender(world, attacker);
  }
  return { gain: afterDistance - cutDistance, presser, cutDistance, afterDistance, world, attacker };
}

function cutLag(level: Level) {
  const cut = setupRun(812, 20), straight = setupRun(812, 20);
  const cutFrame = 54;
  let lag: number | undefined;
  const differences: boolean[] = [];
  let tick = 1;
  for (let frame = 0; frame < cutFrame + 45; frame++, tick++) {
    const cutCommands = computeAI(cut.world, level, STEP, tick, 1);
    const straightCommands = computeAI(straight.world, level, STEP, tick, 1);
    const a = cutCommands.get(cut.presser.id)!.move;
    const b = straightCommands.get(straight.presser.id)!.move;
    const changed = Math.hypot(a.x - b.x, a.z - b.z) > 1e-6;
    differences.push(changed);
    if (changed && lag === undefined) lag = frame - cutFrame;
    const cutCommandsWithHuman = new Map(cutCommands);
    cutCommandsWithHuman.set(cut.attacker.id, {
      move: frame >= cutFrame ? { x: 0, z: 1 } : { x: 1, z: 0 }, sprint: true,
    });
    const straightCommandsWithHuman = new Map(straightCommands);
    straightCommandsWithHuman.set(straight.attacker.id, { move: { x: 1, z: 0 }, sprint: true });
    stepWorld(cut.world, STEP, cutCommandsWithHuman);
    stepWorld(straight.world, STEP, straightCommandsWithHuman);
  }
  assert.notEqual(lag, undefined, `${level} presser command never responded to the cut`);
  for (let frame = 0; frame < cutFrame + lag!; frame++) {
    if (frame >= cutFrame) assert.equal(differences[frame], false, `${level} command changed before measured lag`);
  }
  return lag!;
}

function timingFixture(seed: number, ballAhead: number) {
  const world = createWorld(seed);
  world.phase = 'live';
  world.restart = null;
  const attacker = world.players[6]!;
  const presser = world.players[16]!;
  for (const player of world.players) {
    if (player.slot === 'GK') continue;
    if (player.team === 0 && player.id !== attacker.id) {
      player.human = true;
      player.controlled = false;
      player.x = -35;
      player.z = (player.id % TEAM_SIZE - 5) * 4;
    } else if (player.team === 1 && player.id !== presser.id) {
      player.human = false;
      player.controlled = false;
      player.x = 35;
      player.z = (player.id % TEAM_SIZE - 5) * 4;
    }
  }
  attacker.human = true;
  attacker.controlled = true;
  attacker.x = attacker.z = 0;
  attacker.vx = attacker.vz = 0;
  attacker.facing = Math.PI / 2;
  presser.human = false;
  presser.controlled = false;
  presser.x = 0.4;
  presser.z = 0;
  presser.vx = presser.vz = 0;
  presser.cooldown = 0;
  presser.touchCd = 0;
  presser.facing = -Math.PI / 2;
  world.ball.x = ballAhead;
  world.ball.y = 0.11;
  world.ball.z = 0;
  world.ball.vx = world.ball.vz = world.ball.vy = 0;
  world.carrierId = attacker.id;
  world.lastToucherId = attacker.id;
  world.lastTouch = attacker.team;
  world.stealProtect = 0;
  return { world, attacker, presser };
}

function buildBallHistory(world: ReturnType<typeof createWorld>, presser: Player, level: Level, ahead: number) {
  const delay = Math.round(PERCEPTION_DELAY[level] * 60);
  const period = { easy: 36, normal: 18, hard: 11 }[level];
  const rosterIndex = world.players.filter((player) => player.team === presser.team).indexOf(presser);
  let samples = delay + 2;
  while ((samples + 1 + rosterIndex * 2) % period !== 0) samples++;
  for (let tick = 1; tick <= samples; tick++) {
    world.ball.x = world.players[6]!.x + ahead;
    observe(world, tick);
  }
  return samples + 1;
}

function distanceDirection(a: { x: number; z: number }, b: { x: number; z: number }) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

test('perception delays cuts, preserving a distance advantage over an omniscient presser', () => {
  const gains = {} as Record<Level, number>;
  for (const level of ['easy', 'normal', 'hard'] as const) gains[level] = cutRun(level, true).gain;
  const originalDelay = PERCEPTION_DELAY.normal;
  let omniscient: number;
  try {
    PERCEPTION_DELAY.normal = 0;
    omniscient = cutRun('normal', true).gain;
  } finally {
    PERCEPTION_DELAY.normal = originalDelay;
  }
  console.log(`perception cut gains: easy=${gains.easy.toFixed(3)}m normal=${gains.normal.toFixed(3)}m hard=${gains.hard.toFixed(3)}m omniscient=${omniscient!.toFixed(3)}m`);
  assert.ok(gains.normal >= 1.5, `normal cut gain: ${gains.normal}`);
  assert.ok(gains.normal > omniscient! + 0.25, `normal ${gains.normal}m vs omniscient ${omniscient}m`);
  assert.ok(gains.easy >= gains.normal, `easy/normal gains: ${gains.easy}/${gains.normal}`);
  assert.ok(gains.normal >= gains.hard, `normal/hard gains: ${gains.normal}/${gains.hard}`);
});

test('presser command lag matches the reaction-delay ticks by difficulty', () => {
  const lags = {} as Record<Level, number>;
  for (const level of ['easy', 'normal', 'hard'] as const) lags[level] = cutLag(level);
  console.log(`perception cut lags: easy=${lags.easy}t/${(lags.easy * STEP * 1000).toFixed(1)}ms normal=${lags.normal}t/${(lags.normal * STEP * 1000).toFixed(1)}ms hard=${lags.hard}t/${(lags.hard * STEP * 1000).toFixed(1)}ms`);
  for (const level of ['easy', 'normal', 'hard'] as const) {
    assert.ok(Math.abs(lags[level] - Math.round(PERCEPTION_DELAY[level] * 60)) <= 2,
      `${level} measured ${lags[level]} ticks, expected ${Math.round(PERCEPTION_DELAY[level] * 60)}`);
  }
  assert.ok(lags.easy > lags.normal && lags.normal > lags.hard, `lags: ${JSON.stringify(lags)}`);
});

test('presser commits to a lunge without retargeting or tackling again', () => {
  const { world, attacker, presser } = setupRun(956);
  attacker.x = attacker.z = 0;
  attacker.vx = attacker.vz = 0;
  attacker.facing = 0;
  presser.x = 0.2;
  presser.z = 0;
  presser.facing = Math.PI / 2;
  world.ball.x = 0;
  world.ball.z = 0.6;
  world.carrierId = attacker.id;
  world.lastToucherId = attacker.id;
  world.stealProtect = 0;
  let launchTick = 1;
  let launch: ReturnType<typeof computeAI> extends Map<number, infer C> ? C | undefined : never;
  for (let tick = 1; tick <= 40; tick++) {
    const commands = computeAI(world, 'hard', STEP, tick, 1);
    const command = commands.get(presser.id);
    if (command?.action === 'tackle') {
      launchTick = tick;
      launch = command;
      break;
    }
  }
  assert.equal(launch?.action, 'tackle', 'fixture must trigger a lunge');
  const committed = launch!.move;
  attacker.z = -2;
  world.ball.z = -1.6;
  for (let tick = launchTick + 1; tick < launchTick + Math.round(LUNGE_COMMIT * 60); tick++) {
    const command = computeAI(world, 'hard', STEP, tick, 1).get(presser.id)!;
    const dot = (command.move.x * committed.x + command.move.z * committed.z)
      / (distanceDirection(command.move, { x: 0, z: 0 }) * distanceDirection(committed, { x: 0, z: 0 }));
    assert.ok(dot > 0.999, `lunge direction changed at tick ${tick}: dot ${dot}`);
    assert.notEqual(command.action, 'tackle', `second tackle during commitment at tick ${tick}`);
  }
  const expiry = launchTick + Math.round(LUNGE_COMMIT * 60);
  const retargeted = computeAI(world, 'hard', STEP, expiry, 1).get(presser.id)!;
  const dot = (retargeted.move.x * committed.x + retargeted.move.z * committed.z)
    / (distanceDirection(retargeted.move, { x: 0, z: 0 }) * distanceDirection(committed, { x: 0, z: 0 }));
  assert.ok(dot < 0.5, `presser did not retarget after expiry: dot ${dot}`);
});

test('tackle outcomes use remembered ball exposure rather than the live frame', () => {
  let wins = 0;
  const seeds = Array.from({ length: 16 }, (_, index) => 100 + index);
  for (const seed of seeds) {
    const { world, attacker, presser } = timingFixture(seed, 0.8);
    const tick = buildBallHistory(world, presser, 'hard', 0.8);
    world.ball.x = attacker.x + 0.35;
    const commands = computeAI(world, 'hard', STEP, tick, 1);
    assert.equal(commands.get(presser.id)?.action, 'tackle', `stale exposed ball should prompt a tackle for seed ${seed}`);
    commands.set(attacker.id, { move: { x: 0, z: 0 }, sprint: false });
    stepWorld(world, STEP, commands);
    if (world.stealWinnerId === presser.id) wins++;
  }
  console.log(`stale-exposure tackle outcomes: ${wins}/${seeds.length} wins`);
  assert.ok(wins > 0 && wins < seeds.length, `expected mixed stale-exposure outcomes, got ${wins}/${seeds.length}`);

  for (const level of ['normal', 'hard'] as const) {
    const { world, attacker, presser } = timingFixture(331, 0.35);
    attacker.action = 'shield';
    const tick = buildBallHistory(world, presser, level, 0.35);
    world.ball.x = 0.6;
    attacker.action = 'idle';
    const command = computeAI(world, level, STEP, tick, 1).get(presser.id)!;
    assert.notEqual(command.action, 'tackle', `${level} must not tackle a ball that only now looks exposed`);
  }
});

test('perception without recorded history falls back to current object state', () => {
  const { world, attacker } = setupRun(774);
  assert.deepEqual(perceive(world, attacker.id, 'normal', 8), {
    x: attacker.x, y: 0, z: attacker.z, vx: attacker.vx, vz: attacker.vz,
    facing: attacker.facing, action: attacker.action,
  });
});
