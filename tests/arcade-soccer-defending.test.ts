import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorld, distance, FIELD, TEAM_SIZE, nearestCarrier, STEP, stepWorld, switchPlayer, type Command } from '../src/os/arcade/games/soccer/logic.ts';
import { cloneSnapshot, parsePacket } from '../src/os/arcade/games/soccer/net.ts';

function fixture(seed = 71423) {
  const world = createWorld(seed);
  world.phase = 'live'; world.restart = null; world.controlled = [1, TEAM_SIZE + 1];
  for (const p of world.players) { p.x = -16; p.z = 11; p.human = true; p.controlled = false; }
  const defender = world.players[1]!, carrier = world.players[TEAM_SIZE + 1]!;
  defender.x = -3; defender.z = 0; defender.controlled = true;
  carrier.x = carrier.z = 0; carrier.facing = Math.PI / 2;
  world.ball.x = 0.4; world.ball.z = 0;
  world.carrierId = world.lastToucherId = carrier.id; world.lastTouch = carrier.team;
  return { world, defender, carrier, tick: (command: Command = { move: { x: 0, z: 0 } }) => stepWorld(world, STEP, new Map([[defender.id, command]])) };
}

test('jockey caps speed immediately, strafes and faces the carrier', () => {
  for (const sprint of [false, true]) {
    const { defender, carrier, tick } = fixture(); defender.vz = 8;
    tick({ move: { x: 0, z: -1 }, jockey: true, sprint });
    assert.ok(Math.hypot(defender.vx, defender.vz) <= (sprint ? 5 : 3.2));
    assert.ok(defender.vz < 0);
    assert.ok(Math.abs(defender.facing - Math.atan2(carrier.x - defender.x, carrier.z - defender.z)) < 1e-9);
    assert.equal(defender.action, 'jockey');
  }
});

test('auto jockey requires a nearby opponent, movement and no sprint', () => {
  for (const [range, sprint, move, expected] of [[3, false, 1, true], [5, false, 1, false], [3, true, 1, false], [3, false, 0, false]] as const) {
    const { defender, tick } = fixture(); defender.x = -range;
    tick({ move: { x: 0, z: move }, sprint, autoJockey: true });
    assert.equal(defender.action === 'jockey', expected);
  }
  const { world, carrier, tick } = fixture(); carrier.team = 0; world.lastTouch = 0;
  tick({ move: { x: 0, z: 1 }, autoJockey: true });
  assert.notEqual(world.players[1]!.action, 'jockey');
});

test('held pass contains goal-side and teammate press moves before the loop without chasing the ball', () => {
  const { world, defender, carrier, tick } = fixture();
  const mate = world.players[2]!; mate.human = false; mate.x = -4; mate.z = 0;
  const before = mate.x;
  tick({ move: { x: 0, z: 0 }, heldAction: 'pass', press: true });
  assert.ok(mate.x > before, 'press movement must apply on the first step');
  for (let i = 0; i < 180; i++) tick({ move: { x: 0, z: 0 }, heldAction: 'pass', press: true });
  assert.ok(Math.abs(distance(defender, carrier) - 1.4) < 0.12);
  assert.ok(Math.abs(distance(mate, carrier) - 1.6) < 0.12);
  assert.ok(defender.x < carrier.x && mate.x < carrier.x);
  assert.ok(distance(mate, world.ball) > 1);
});

function tackle(seed: number, angle: number, exposed = false) {
  const f = fixture(Math.imul(seed, 2654435761) >>> 0);
  f.carrier.facing = 0;
  f.defender.x = Math.sin(angle); f.defender.z = Math.cos(angle);
  f.world.ball.x = exposed ? f.defender.x * 0.8 : 0;
  f.world.ball.z = exposed ? f.defender.z * 0.8 : 0;
  if (exposed) f.carrier.touchCd = 0.35;
  f.tick({ move: { x: 0, z: 0 }, action: 'tackle', pressed: true });
  return f;
}

test('exposed knock-on timing wins cleanly for every seed', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const { world, defender } = tackle(seed, Math.PI, true);
    assert.equal(world.lastToucherId, defender.id);
    assert.equal(world.phase, 'live');
  }
});

test('standing tackle front beats side beats behind, with behind fouls and miss penalty', () => {
  const stats = [0, Math.PI / 2, Math.PI].map((angle) => {
    let wins = 0, fouls = 0;
    for (let seed = 1; seed <= 1000; seed++) {
      const { world, defender } = tackle(seed, angle);
      wins += Number(world.lastToucherId === defender.id);
      fouls += Number(world.phase === 'restart');
    }
    return { wins, fouls };
  });
  console.log(`tackles per 1000 front/side/behind: ${stats.map((s) => `${s.wins} wins ${s.fouls} fouls`).join('; ')}`);
  assert.ok(stats[0]!.wins > stats[1]!.wins && stats[1]!.wins > stats[2]!.wins);
  assert.ok(stats[2]!.fouls > 250);
  let missed = false;
  for (let seed = 1; seed <= 20 && !missed; seed++) {
    const { world, defender, tick } = tackle(seed, 0);
    if (defender.action !== 'tackle-miss') continue;
    missed = true; assert.equal(defender.cooldown, 0.6);
    defender.vx = 8;
    tick({ move: { x: 1, z: 0 }, sprint: true });
    assert.ok(Math.hypot(defender.vx, defender.vz) <= 2);
    assert.equal(world.phase, 'live');
  }
  assert.ok(missed);
});

function sliding(seed: number, kind: 'front' | 'body' | 'behind', x = 0, z = 0) {
  const f = fixture(seed);
  f.carrier.x = x; f.carrier.z = z;
  f.world.ball.x = x + 0.45; f.world.ball.z = z;
  f.defender.x = x + (kind === 'front' ? 1.2 : kind === 'behind' ? -0.8 : 0);
  f.defender.z = z + (kind === 'body' ? 0.75 : 0);
  f.defender.facing = kind === 'front' ? -Math.PI / 2 : kind === 'behind' ? Math.PI / 2 : Math.PI;
  if (kind === 'front') f.carrier.touchCd = 0.35;
  f.tick({ move: { x: 0, z: 0 }, action: 'slide', pressed: true });
  for (let i = 0; i < 10 && f.world.phase === 'live' && !f.defender.slide?.won; i++) f.tick();
  return f;
}

test('progressive slide ball-first is clean; body-first and behind foul with FIELD box geometry', () => {
  let frontFouls = 0, behindFouls = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const front = sliding(seed, 'front');
    assert.equal(front.defender.slide?.won, true);
    assert.equal(front.world.lastToucherId, front.defender.id);
    frontFouls += Number(front.world.phase === 'restart');
    const behind = sliding(seed, 'behind');
    behindFouls += Number(behind.world.restart === 'free-kick');
  }
  console.log(`slide fouls front ${frontFouls}/100; behind ${behindFouls}/100`);
  assert.equal(frontFouls, 0); assert.equal(behindFouls, 100);
  assert.equal(sliding(1, 'body').world.restart, 'free-kick');
  assert.equal(sliding(1, 'body', -FIELD.length / 2 + FIELD.penaltyDepth / 2).world.restart, 'penalty');
  assert.equal(sliding(1, 'body', -FIELD.length / 2 + 2, FIELD.penaltyWidth / 2 + 1).world.restart, 'free-kick');
  assert.equal(sliding(1, 'body', FIELD.length / 2 - 2).world.restart, 'free-kick');
});

test('slide direction is locked through sliding and immobile get-up', () => {
  const { world, defender, carrier, tick } = fixture();
  world.ball.x = carrier.x = 15; defender.x = defender.z = 0; defender.facing = Math.PI / 2;
  tick({ move: { x: 0, z: 0 }, action: 'slide', pressed: true });
  for (let i = 0; i < 31; i++) tick({ move: { x: 0, z: 1 }, sprint: true });
  assert.ok(defender.x > 2); assert.ok(Math.abs(defender.z) < 1e-9);
  assert.equal(defender.action, 'get-up');
  const x = defender.x, z = defender.z;
  for (let i = 0; i < 20; i++) tick({ move: { x: 0, z: 1 } });
  assert.equal(defender.x, x); assert.equal(defender.z, z);
  for (let i = 0; i < 8; i++) tick();
  assert.equal(defender.slide, null);
});

test('diagonal slide pokes along its locked direction and out-of-reach tackle is a short lunge', () => {
  const { world, defender, carrier, tick } = fixture();
  defender.x = defender.z = 0; carrier.x = carrier.z = 3;
  world.ball.x = world.ball.z = 0.45;
  defender.slide = { x: Math.SQRT1_2, z: Math.SQRT1_2, t: 0, won: false };
  tick();
  assert.equal(defender.slide.won, true);
  assert.ok(Math.abs(world.ball.vx - world.ball.vz) < 1e-9);
  assert.ok(Math.hypot(world.ball.vx, world.ball.vz) >= 5.8 && Math.hypot(world.ball.vx, world.ball.vz) <= 9);
  const far = fixture();
  far.tick({ move: { x: 0, z: 0 }, action: 'tackle', pressed: true });
  assert.equal(far.defender.cooldown, 0.35);
  assert.equal(far.defender.action, 'tackle-miss');
  assert.ok(Math.hypot(far.defender.vx, far.defender.vz) <= 2);
});

test('manual switch weights goal-side, excludes current/other humans and flick uses current-player direction', () => {
  const { world, defender } = fixture();
  world.ball.x = world.ball.z = 0;
  const goalSide = world.players[2]!, closer = world.players[3]!;
  goalSide.human = closer.human = false;
  goalSide.x = -2; goalSide.z = 0; closer.x = 1; closer.z = 0;
  assert.equal(switchPlayer(world, 0), goalSide.id);
  defender.human = false; defender.x = -2; defender.z = 5;
  assert.equal(switchPlayer(world, 0, { x: 0, z: 1 }), defender.id);
  assert.equal(switchPlayer(world, 0, { x: 0, z: 1 }), defender.id, 'no candidate in cone');
});

test('command switch flags and defending raw context actions share the logic path', () => {
  for (const command of [{ switchNearest: true }, { switchDir: { x: 1, z: 0 } }] as Partial<Command>[]) {
    const { world, defender, tick } = fixture(); const mate = world.players[2]!;
    mate.human = false; mate.x = -1; mate.z = 0;
    tick({ move: { x: 0, z: 0 }, ...command });
    assert.equal(world.controlled[0], mate.id); assert.equal(defender.human, false);
  }
  const tap = fixture();
  tap.tick({ move: { x: 0, z: 0 }, action: 'pass', pressed: true, power: 0.1 });
  assert.equal(tap.world.controlled[0], tap.defender.id, 'tap A contains instead of switching');
  for (const [action, expected] of [['shoot', 'tackle'], ['lob', 'slide'], ['through', 'idle']] as const) {
    const { defender, tick } = fixture(); defender.x = 1.2;
    tick({ move: { x: 0, z: 0 }, action, pressed: true });
    assert.ok(expected === 'tackle' ? ['tackle', 'tackle-miss'].includes(defender.action) : defender.action === expected);
  }
});

test('auto switch waits 0.25s, requires 2.5m margin and respects 0.6s hysteresis', () => {
  const { world, defender, carrier, tick } = fixture(); carrier.x = 15;
  defender.x = -12; world.ball.x = world.ball.z = 0; world.ball.vx = 8;
  const mate = world.players[2]!; mate.human = false; mate.x = -2; mate.z = 0;
  for (let i = 0; i < 14; i++) tick();
  assert.equal(world.controlled[0], defender.id);
  tick(); assert.equal(world.controlled[0], mate.id);
  const stamp = world.switchAt![0];
  mate.x = -12; defender.x = -2; world.ball.x = 0; world.ball.vx = 8;
  for (let i = 0; i < 30; i++) stepWorld(world, STEP);
  assert.equal(world.controlled[0], mate.id); assert.equal(world.switchAt![0], stamp);
  world.ball.vx = 8;
  for (let i = 0; i < 8; i++) stepWorld(world, STEP);
  assert.equal(world.controlled[0], defender.id);
  const margin = fixture(); margin.carrier.x = 15; margin.defender.x = -3;
  margin.world.ball.x = margin.world.ball.z = 0; margin.world.ball.vx = 8;
  const close = margin.world.players[2]!; close.human = false; close.x = -1; close.z = 0;
  for (let i = 0; i < 30; i++) margin.tick();
  assert.equal(margin.world.controlled[0], margin.defender.id);
});

test('human dribble and recent knock-on prevent auto switching, own reception transfers control', () => {
  const { world, defender, carrier, tick } = fixture(); carrier.x = 15;
  world.ball.x = defender.x + 0.4; world.ball.z = 0; world.ball.vx = 8;
  world.lastToucherId = world.carrierId = defender.id;
  const mate = world.players[2]!; mate.human = false; mate.x = 0; mate.z = 0;
  for (let i = 0; i < 30; i++) tick({ move: { x: 0.2, z: 0 } });
  assert.equal(world.controlled[0], defender.id); assert.equal(nearestCarrier(world)?.id, defender.id);
  defender.touchCd = 0.35; world.ball.x = 2; world.ball.vx = 8;
  for (let i = 0; i < 18; i++) tick();
  assert.equal(world.controlled[0], defender.id);
  world.ball.x = mate.x; world.ball.z = mate.z; world.ball.vx = 0;
  world.passTarget = mate.id; world.passControl = true;
  tick(); assert.equal(world.controlled[0], mate.id);
});

test('auto switching needs the same better candidate for 15 steps and never flips back within 36 steps', () => {
  const { world, defender, carrier, tick } = fixture();
  const a = world.players[2]!, b = world.players[3]!;
  a.human = b.human = false;
  const reset = (nearA: boolean) => {
    carrier.x = 25; carrier.z = 20; defender.x = -18; defender.z = 0;
    a.x = nearA ? -3 : -7; a.z = 0; b.x = nearA ? -7 : -3; b.z = 0;
    world.ball.x = world.ball.z = 0; world.ball.vx = 8; world.ball.vz = 0;
    world.carrierId = null;
  };
  for (let frame = 0; frame < 120; frame++) {
    reset(frame % 12 < 6); tick();
    assert.equal(world.controlled[0], defender.id, 'changing candidates must reset the dwell');
  }
  for (let frame = 0; frame < 15; frame++) { reset(true); tick(); }
  assert.equal(world.controlled[0], a.id);
  for (let frame = 1; frame < 36; frame++) {
    reset(false); a.x = -18;
    tick(); assert.equal(world.controlled[0], a.id, `no flip at step ${frame}`);
  }
  for (let frame = 0; frame < 3; frame++) { reset(false); a.x = -18; tick(); }
  assert.equal(world.controlled[0], b.id);
});

test('manual switches start the auto-switch cooldown and candidate state is validated in snapshots', () => {
  const { world, defender, carrier, tick } = fixture();
  const mate = world.players[2]!; mate.human = false; mate.x = -2; mate.z = 0;
  defender.x = -15; carrier.x = 25;
  switchPlayer(world, 0);
  assert.equal(world.controlled[0], mate.id);
  for (let frame = 0; frame < 35; frame++) {
    defender.x = -2; mate.x = -15; world.ball.x = world.ball.z = 0; world.ball.vx = 8;
    tick(); assert.equal(world.controlled[0], mate.id);
  }
  const packet = () => ({ t: 'soccer', k: 's', r: 1, seq: 1, state: cloneSnapshot(world) });
  assert.ok(parsePacket(packet()));
  world.switchCandidate = [-1, 11]; assert.ok(parsePacket(packet()));
  world.switchCandidate = [11, -1]; assert.equal(parsePacket(packet()), null);
  delete world.switchCandidate; assert.ok(parsePacket(packet()));
});

test('opponent passes permit delayed auto switching but our pass target suppresses it', () => {
  for (const ownPass of [false, true]) {
    const { world, defender, carrier, tick } = fixture();
    carrier.x = 15; defender.x = -12;
    const mate = world.players[2]!; mate.human = false; mate.x = -2; mate.z = 0;
    world.ball.x = world.ball.z = 0; world.ball.vx = 8;
    world.passTarget = ownPass ? mate.id : carrier.id;
    for (let i = 0; i < 14; i++) tick();
    assert.equal(world.controlled[0], defender.id);
    tick(); assert.equal(world.controlled[0], ownPass ? defender.id : mate.id);
  }
});

test('new defending state snapshots validate and old optional-free snapshots remain accepted', () => {
  const { world, defender } = fixture();
  const packet = () => ({ t: 'soccer', k: 's', r: 1, seq: 1, state: cloneSnapshot(world) });
  defender.slide = { x: 1, z: 0, t: 0.2, won: false };
  assert.ok(parsePacket(packet()));
  defender.slide.t = -1; assert.equal(parsePacket(packet()), null);
  delete defender.slide; delete world.switchAt; delete world.switchWait; delete world.dribbleAt;
  assert.ok(parsePacket(packet()));
  world.switchAt = [NaN, 0]; assert.equal(parsePacket(packet()), null);
});
