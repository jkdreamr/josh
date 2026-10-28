import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { computeAI } from '../src/os/arcade/games/soccer/ai.ts';
import { createWorld, distance, FIELD, findReceiver, groundPassSpeed, kick, setRestart, STEP, stepWorld, TEAM_SIZE, transferControl, type Command } from '../src/os/arcade/games/soccer/logic.ts';
import { faceLabels, haptic, phoneClockLabel } from '../src/os/arcade/games/soccer/pad.ts';
import { sendOff } from '../src/os/arcade/games/soccer/rules.ts';

const controlCss = readFileSync(new URL('../src/os/arcade/games/soccer/soccer.css', import.meta.url), 'utf8');
const controlSource = readFileSync(new URL('../src/os/arcade/games/soccer/index.tsx', import.meta.url), 'utf8');
const practiceSource = readFileSync(new URL('../src/os/arcade/games/soccer/practice-mode.tsx', import.meta.url), 'utf8');

function directionAt(angle: number, distance: number) {
  return { x: Math.cos(angle) * distance, z: Math.sin(angle) * distance };
}

function angularDifference(a: number, b: number) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

function worldWithSeats(seed: number, seats: (number | null)[]) {
  const count = Math.max(1, seats.filter((id) => id !== null).length) as 1 | 2;
  const world = createWorld(seed, 120, count);
  world.controlledSeats = [...seats];
  for (const player of world.players) {
    player.human = seats.includes(player.id);
    player.controlled = player.human;
  }
  world.controlled = [
    seats.find((id) => id !== null && world.players[id]?.team === 0) ?? 6,
    seats.find((id) => id !== null && world.players[id]?.team === 1) ?? TEAM_SIZE + 6,
  ];
  return world;
}

function worldWithHumanOnCM(seed: number, team: 0 | 1, seat: number) {
  const world = createWorld(seed, 120, 1);
  const cm = world.players.find((player) => player.team === team && player.slot === 'CM')!;
  world.controlledSeats = [null, null, null, null];
  world.controlledSeats[seat] = cm.id;
  for (const player of world.players) {
    player.human = player.id === cm.id;
    player.controlled = player.human;
  }
  world.controlled[team] = cm.id;
  return world;
}

function prepareLooseBall(world: ReturnType<typeof createWorld>, targetId: number, targetX = 0.5) {
  world.phase = 'live';
  world.restart = null;
  world.setPiece = null;
  world.carrierId = null;
  world.lastToucherId = null;
  world.passTarget = null;
  world.passFrom = null;
  world.passControl = false;
  world.passPoint = null;
  let humanIndex = 0;
  for (const player of world.players) {
    player.sentOff = player.id !== targetId && !player.human;
    player.vx = 0;
    player.vz = 0;
    player.touchCd = 0;
    player.cooldown = 0;
    if (player.id === targetId) {
      player.x = targetX;
      player.z = 0;
    } else if (player.human) {
      player.x = -10;
      player.z = humanIndex++ * 3;
    }
  }
  world.ball = { x: 0, y: 0.11, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, grounded: true, inNet: false };
}

function assertSeatInvariant(world: ReturnType<typeof createWorld>) {
  const seats = world.controlledSeats ?? [];
  for (const team of [0, 1] as const) {
    const expected = seats.filter((id) => id !== null && world.players[id]?.team === team).sort((a, b) => a! - b!);
    const actual = world.players.filter((player) => player.team === team && player.human).map((player) => player.id).sort((a, b) => a - b);
    assert.deepEqual(actual, expected);
    for (const id of expected) {
      assert.equal(world.players[id!]?.human, true);
      assert.equal(world.players[id!]?.controlled, true);
    }
    if (expected.length === 1) assert.equal(world.controlled[team], expected[0]);
  }
}

function aiCommands(world: ReturnType<typeof createWorld>, tick: number) {
  const commands = new Map<number, Command>();
  for (const team of [0, 1] as const) {
    for (const [id, command] of computeAI(world, 'normal', STEP, tick, team)) commands.set(id, command);
  }
  return commands;
}

function matchAICommands(world: ReturnType<typeof createWorld>, tick: number) {
  const byTeam = [
    computeAI(world, 'normal', STEP, tick, 0, new Map<number, Command>()),
    computeAI(world, 'normal', STEP, tick, 1, new Map<number, Command>()),
  ] as const;
  const commands = new Map<number, Command>();
  for (const teamCommands of byTeam) {
    for (const [id, command] of teamCommands) commands.set(id, command);
  }
  return { commands, byTeam };
}

function preparePhonePass(world: ReturnType<typeof createWorld>, seat: number, commands: Map<number, Command>) {
  const originalSentOff = world.players.map((player) => player.sentOff);
  const id = world.controlledSeats?.[seat];
  assert.notEqual(id, null);
  assert.notEqual(id, undefined);
  const passer = world.players[id!]!;
  const receiver = world.players.find((player) => player.team === passer.team && player.id !== passer.id && !player.human)!;
  for (const teammate of world.players.filter((player) => player.team === passer.team)) {
    teammate.sentOff = teammate.id !== receiver.id && teammate.id !== passer.id && !teammate.human;
    if (teammate.id === receiver.id) Object.assign(teammate, { x: 15, z: 0, vx: 0, vz: 0 });
    else if (teammate.human && teammate.id !== passer.id) Object.assign(teammate, { x: -20, z: 0, vx: 0, vz: 0 });
  }
  for (const opponent of world.players.filter((player) => player.team !== passer.team)) opponent.sentOff = true;
  world.phase = 'live';
  world.restart = null;
  world.setPiece = null;
  Object.assign(passer, { x: 0, z: 0, vx: 0, vz: 0, cooldown: 0, touchCd: 0 });
  world.ball = { x: 0.3, y: 0.11, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, grounded: true, inNet: false };
  world.carrierId = passer.id;
  world.lastToucherId = passer.id;
  commands.set(passer.id, { move: { x: 0, z: 0 }, action: 'pass', pressed: true, aim: { x: 1, z: 0 }, power: 0.5 });
  return { passer, receiver, originalSentOff };
}

function restorePlayers(world: ReturnType<typeof createWorld>, originalSentOff: boolean[]) {
  world.players.forEach((player, index) => { player.sentOff = originalSentOff[index]!; });
}

test('through balls without a cone receiver launch along all eight stick directions', () => {
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4;
    const aim = { x: Math.cos(angle), z: Math.sin(angle) };
    const world = createWorld(100 + i);
    const passer = world.players[6]!;
    passer.x = 0;
    passer.z = 0;
    passer.human = true;
    passer.controlled = true;
    passer.stamina = 1;
    world.controlled[0] = passer.id;
    world.ball.x = 0;
    world.ball.z = 0;
    for (const mate of world.players.filter((player) => player.team === passer.team && player.id !== passer.id)) {
      const behind = directionAt(angle + Math.PI, 20);
      mate.x = behind.x;
      mate.z = behind.z;
      mate.sentOff = false;
    }
    for (const opponent of world.players.filter((player) => player.team !== passer.team)) opponent.sentOff = true;

    kick(world, passer, 'through', { move: { x: 0, z: 0 }, aim, power: 0.5, pressed: true });

    const launch = Math.atan2(world.ball.vz, world.ball.vx);
    assert.ok(angularDifference(launch, angle) <= 3 * Math.PI / 180, `direction ${i}: ${launch} vs ${angle}`);
    assert.ok(world.passPoint);
    assert.ok(Math.abs(world.passPoint.x - aim.x * 19) < 1e-6);
    assert.ok(Math.abs(world.passPoint.z - aim.z * 19) < 1e-6);
    assert.ok(world.passTarget !== null && world.players[world.passTarget]?.slot !== 'GK');
  }
});

test('through receiver selection excludes the own goalkeeper for human and AI passes', () => {
  const world = createWorld(202);
  const passer = world.players[6]!;
  passer.x = 0;
  passer.z = 0;
  passer.human = true;
  world.players[0]!.x = 15;
  world.players[0]!.z = 0;
  for (const mate of world.players.filter((player) => player.team === 0 && player.id !== passer.id && player.id !== 0)) {
    mate.x = -20;
    mate.z = 15;
  }
  assert.notEqual(findReceiver(world, passer, { x: 1, z: 0 }, true)?.id, 0);
  assert.notEqual(findReceiver(world, passer, { x: 1, z: 0 }, true, false, false, 0.45, 'ai')?.id, 0);
  world.ball.x = 0;
  world.ball.z = 0;
  kick(world, passer, 'through', { move: { x: 0, z: 0 }, aim: { x: 1, z: 0 }, power: 0.5, pressed: true });
  assert.notEqual(world.passTarget, 0);
});

test('AI ground passes retain the main-branch target and launch-speed formulas', () => {
  const world = createWorld(212);
  const passer = world.players[6]!;
  const receiver = world.players[7]!;
  passer.x = 0;
  passer.z = 0;
  passer.human = false;
  world.ball.x = 0;
  world.ball.z = 0;
  world.rules!.offside = false;
  receiver.x = 15;
  receiver.z = 0;
  receiver.vx = 1.4;
  receiver.vz = 0.6;
  receiver.sentOff = false;
  for (const mate of world.players.filter((player) => player.team === passer.team && player.id !== passer.id && player.id !== receiver.id)) mate.sentOff = true;
  for (const opponent of world.players.filter((player) => player.team !== passer.team)) opponent.sentOff = true;
  const charge = 0.45;
  const initialRange = distance(world.ball, receiver);
  const leadTime = initialRange / groundPassSpeed(initialRange);
  const target = { x: receiver.x + receiver.vx * leadTime, z: receiver.z + receiver.vz * leadTime };
  const expectedSpeed = Math.max(8, Math.min(25,
    groundPassSpeed(distance(world.ball, target)) * (0.82 + 0.4 * charge)));

  kick(world, passer, 'pass', { move: { x: 0, z: 0 }, aim: { x: 1, z: 0 }, power: charge, pressed: true });

  assert.equal(world.passTarget, receiver.id);
  assert.ok(Math.abs(Math.hypot(world.ball.vx, world.ball.vz) - expectedSpeed) < 1e-9);
});

test('a 16-degree through lane beats a 40-degree lane, including when the near lane is blocked', () => {
  const aimAngle = -3 * Math.PI / 4;
  for (const blocked of [false, true]) {
    const world = createWorld(blocked ? 304 : 303);
    const passer = world.players[6]!;
    passer.x = 0;
    passer.z = 0;
    const near = world.players[7]!;
    const wide = world.players[8]!;
    const nearPoint = directionAt(aimAngle + 16 * Math.PI / 180, 18);
    const widePoint = directionAt(aimAngle + 40 * Math.PI / 180, 18);
    Object.assign(near, nearPoint);
    Object.assign(wide, widePoint);
    for (const mate of world.players.filter((player) => player.team === passer.team && ![passer.id, near.id, wide.id].includes(player.id))) {
      mate.x = 30;
      mate.z = 30;
    }
    for (const opponent of world.players.filter((player) => player.team !== passer.team)) opponent.sentOff = true;
    if (blocked) {
      const defender = world.players[11]!;
      defender.sentOff = false;
      defender.x = nearPoint.x / 2;
      defender.z = nearPoint.z / 2;
    }
    const selected = findReceiver(world, passer, { x: Math.cos(aimAngle), z: Math.sin(aimAngle) }, true);
    assert.equal(selected?.id, near.id);
  }
});

test('co-op LB switching preserves independent assignments for both human seats', () => {
  const world = createWorld(405);
  world.phase = 'live';
  world.restart = null;
  world.controlled[0] = 6;
  world.controlledSeats = [6, 9, null, null];
  world.ball.x = 0;
  world.ball.z = 0;
  for (const player of world.players) {
    player.x = player.team === 0 ? -28 : 28;
    player.z = (player.id % 11 - 5) * 2;
    player.vx = 0;
    player.vz = 0;
    player.human = false;
    player.controlled = false;
  }
  for (const id of [6, 9]) {
    world.players[id]!.human = true;
    world.players[id]!.controlled = true;
  }
  const switchFrom = (id: number) => stepWorld(world, STEP, new Map([[id, { move: { x: 0, z: 0 }, switchNearest: true }]]));
  switchFrom(9);
  const p2 = world.controlledSeats[1]!;
  assert.notEqual(p2, 9);
  assert.equal(world.controlledSeats[0], 6);
  assert.equal(world.players[6]!.human, true);
  assert.equal(world.players[p2]!.human, true);
  assert.equal(world.players[9]!.human, false);

  switchFrom(6);
  const p1 = world.controlledSeats[0]!;
  assert.notEqual(p1, 6);
  assert.equal(world.controlledSeats[1], p2);
  assert.equal(world.players[p1]!.human, true);
  assert.equal(world.players[p2]!.human, true);
});

test('control-seat ownership stays exact through kickoff, AI play, passes, restarts and defensive auto-switches', () => {
  const scenarios = [
    { seed: 510, seats: [null, 6, null, null], phoneSeat: 1 },
    { seed: 511, seats: [6, 9, null, null], phoneSeat: 0 },
  ];
  for (const { seed, seats, phoneSeat } of scenarios) {
    const world = worldWithSeats(seed, seats);
    assertSeatInvariant(world);

    stepWorld(world, STEP);
    assertSeatInvariant(world);
    const kickoffOwner = world.controlledSeats?.[phoneSeat]!;
    const taker = world.players.find((player) => player.team === world.restartTeam && player.slot === 'ST')!;
    assert.equal(taker.human, true);
    assert.ok(world.controlledSeats?.includes(taker.id));
    stepWorld(world, STEP, new Map([[taker.id, {
      move: { x: 0, z: 0 }, action: 'pass', pressed: true, aim: { x: 1, z: 0 }, power: 0.45,
    }]]));
    assert.equal(world.phase, 'live');
    assert.equal(world.kickEvent?.playerId, taker.id);
    assert.equal(world.kickEvent?.action, 'pass');
    assertSeatInvariant(world);
    assert.equal(world.controlledSeats?.[phoneSeat], kickoffOwner);

    for (let frame = 0; frame < 600; frame++) {
      const commands = aiCommands(world, frame);
      if (frame % 120 === 0) {
        const { passer, receiver, originalSentOff } = preparePhonePass(world, phoneSeat, commands);
        stepWorld(world, STEP, commands);
        assert.equal(world.kickEvent?.playerId, passer.id);
        assertSeatInvariant(world);
        if (!receiver.human) assert.equal(world.controlledSeats?.[phoneSeat], receiver.id);
        restorePlayers(world, originalSentOff);
      } else {
        stepWorld(world, STEP, commands);
        assertSeatInvariant(world);
      }
    }

    setRestart(world, 0, 'kick-in', { x: 8, z: FIELD.width / 2 - 0.2 });
    assertSeatInvariant(world);
    for (let frame = 0; frame < 20; frame++) {
      stepWorld(world, STEP, aiCommands(world, 700 + frame));
      assertSeatInvariant(world);
    }

    const seatId = world.controlledSeats?.[phoneSeat]!;
    const current = world.players[seatId]!;
    const replacement = world.players.find((player) => player.team === current.team && !player.human && !player.sentOff)!;
    world.phase = 'live';
    world.restart = null;
    world.setPiece = null;
    world.passTarget = null;
    world.carrierId = null;
    world.lastToucherId = null;
    world.lastTouch = current.team === 0 ? 1 : 0;
    world.dribbleAt[0] = world.halfLength * world.half - world.clock - 1;
    world.switchAt[0] = world.halfLength * world.half - world.clock - 1;
    world.switchWait[0] = 0;
    world.switchCandidate[0] = -1;
    Object.assign(current, { x: -15, z: 0, vx: 0, vz: 0, touchCd: 0, cooldown: 0 });
    Object.assign(replacement, { x: 3, z: 0, vx: 0, vz: 0, touchCd: 0, cooldown: 0 });
    for (const player of world.players) {
      if (player.id !== current.id && player.id !== replacement.id) Object.assign(player, { x: 35, z: 25, vx: 0, vz: 0 });
      player.sentOff = false;
    }
    world.ball = { x: 0, y: 0.11, z: 0, vx: 5, vy: 0, vz: 0, spin: 0, grounded: true, inNet: false };
    let autoSwitched = false;
    for (let frame = 0; frame < 30; frame++) {
      stepWorld(world, STEP);
      assertSeatInvariant(world);
      if (world.controlledSeats?.[phoneSeat] !== seatId) { autoSwitched = true; break; }
    }
    assert.equal(autoSwitched, true);
    assert.equal(world.controlledSeats?.[phoneSeat], replacement.id);
    assertSeatInvariant(world);
  }
});

test('active human teams take kickoff at the start, after goals, and in the second half', () => {
  const cases = [
    { seed: 530, team: 0 as const, seat: 1, phase: 'kickoff' as const },
    { seed: 531, team: 0 as const, seat: 1, phase: 'goal' as const },
    { seed: 532, team: 1 as const, seat: 2, phase: 'half-time' as const },
  ];
  for (const { seed, team, seat, phase } of cases) {
    const world = worldWithHumanOnCM(seed, team, seat);
    if (phase === 'goal') {
      world.phase = 'goal';
      world.eventTime = 0;
      world.restartTeam = team;
      stepWorld(world, STEP);
    } else if (phase === 'half-time') {
      world.phase = 'half-time';
      world.eventTime = 0;
      stepWorld(world, STEP);
    }
    stepWorld(world, STEP);
    const taker = world.players.find((player) => player.team === world.restartTeam && player.slot === 'ST')!;
    assert.equal(world.restart, 'kickoff');
    assert.equal(taker.human, true);
    assert.equal(world.players.filter((player) => player.team === world.restartTeam && player.human).length, 1);
    assert.equal(world.controlledSeats?.[seat], taker.id);
    assertSeatInvariant(world);
  }
});

test('kickoff skips stale AI commands until the human acts or the timeout expires', () => {
  const world = worldWithSeats(537, [null, 6, null, null]);
  const taker = world.players.find((player) => player.team === 0 && player.slot === 'ST')!;
  const runFrame = (frame: number) => {
    const { commands, byTeam } = matchAICommands(world, frame);
    if (frame === 0) assert.equal(byTeam[0].get(taker.id)?.action, 'pass');
    else assert.equal(byTeam[0].has(taker.id), false, 'computeAI must skip the human taker');
    const humanId = world.controlledSeats?.[1];
    assert.notEqual(humanId, null);
    assert.notEqual(humanId, undefined);
    commands.set(humanId!, { move: { x: 0, z: 0 } });
    stepWorld(world, STEP, commands);
    assert.equal(world.kickEvent, null, `no AI kick on frame ${frame}`);
    assert.equal(world.players.filter((player) => player.team === 0 && player.human).length, 1);
    assert.equal(taker.human, true);
    assert.equal(world.controlledSeats?.[1], taker.id);
    assertSeatInvariant(world);
  };

  for (let frame = 0; frame < 400; frame++) runFrame(frame);
  assert.equal(world.restart, 'kickoff');
  assert.ok(world.restartClock < 10);
  for (let frame = 400; world.restart !== null && frame < 700; frame++) runFrame(frame);
  assert.equal(world.restart, null);
  assert.equal(world.phase, 'live');
  assert.ok(world.restartClock >= 10);
  assert.equal(world.kickEvent, null);
});

test('the human kickoff taker can pass with the requested aim and release once', () => {
  const world = worldWithSeats(538, [null, 6, null, null]);
  const taker = world.players.find((player) => player.team === 0 && player.slot === 'ST')!;
  const first = matchAICommands(world, 0);
  assert.equal(first.byTeam[0].get(taker.id)?.action, 'pass');
  first.commands.set(world.controlledSeats![1]!, { move: { x: 0, z: 0 } });
  stepWorld(world, STEP, first.commands);
  assert.equal(world.kickEvent, null);
  assert.equal(world.controlledSeats?.[1], taker.id);

  for (const player of world.players) player.sentOff = player.id !== taker.id;
  const next = matchAICommands(world, 1);
  assert.equal(next.byTeam[0].has(taker.id), false);
  const aim = { x: 1, z: 0 };
  next.commands.set(taker.id, { move: { x: 0, z: 0 }, action: 'pass', pressed: true, aim, power: 0.45 });
  stepWorld(world, STEP, next.commands);
  assert.equal(world.kickEvent?.playerId, taker.id);
  assert.equal(world.kickEvent?.action, 'pass');
  assert.ok(world.ball.vx > 0);
  assert.ok(Math.abs(world.ball.vz) < world.ball.vx * 0.1, 'pass travels along the +x aim');

  const release = matchAICommands(world, 2);
  release.commands.set(taker.id, { move: { x: 0, z: 0 }, action: null, pressed: false });
  stepWorld(world, STEP, release.commands);
  assert.equal(world.kickEvent, null);
});

test('the kickoff taker stays selected through stick and A holds, then passes once in the stick direction', () => {
  const world = worldWithSeats(539, [null, 6, null, null]);
  stepWorld(world, STEP);
  const taker = world.players.find((player) => player.team === 0 && player.slot === 'ST')!;
  assert.equal(taker.human, true);
  assert.equal(world.controlledSeats?.[1], taker.id);
  const start = { x: taker.x, z: taker.z };
  const stick = { x: 1, z: 0 };
  let passes = 0;

  const frame = (tick: number, command: Command) => {
    const { commands, byTeam } = matchAICommands(world, tick);
    assert.equal(byTeam[0].has(taker.id), false, 'AI must not command the human taker');
    commands.set(taker.id, command);
    stepWorld(world, STEP, commands);
    passes += Number(world.kickEvent?.playerId === taker.id && world.kickEvent.action === 'pass');
    assert.equal(world.controlledSeats?.[1], taker.id, 'the phone seat stays on the taker');
    assert.equal(world.controlled[0], taker.id);
    assertSeatInvariant(world);
  };

  for (let tick = 0; tick < 20; tick++) {
    frame(tick, { move: stick, aim: stick });
    assert.equal(world.phase, 'restart');
    assert.equal(world.kickEvent, null);
    assert.deepEqual({ x: taker.x, z: taker.z }, start);
  }
  for (let tick = 20; tick < 30; tick++) {
    frame(tick, { move: stick, aim: stick, action: null, heldAction: 'pass', pressed: false });
    assert.equal(world.phase, 'restart');
    assert.equal(world.kickEvent, null);
    assert.deepEqual({ x: taker.x, z: taker.z }, start);
  }

  frame(30, { move: stick, aim: stick, action: 'pass', heldAction: null, pressed: true, power: 0.45 });
  assert.equal(world.phase, 'live');
  assert.equal(world.kickEvent?.playerId, taker.id);
  assert.equal(world.kickEvent?.action, 'pass');
  assert.ok(world.ball.vx > 0);
  assert.ok(Math.abs(world.ball.vz) < world.ball.vx * 0.1);
  assert.equal(passes, 1);
});

test('a teammate who collects a loose ball receives the single human seat', () => {
  const world = worldWithSeats(533, [null, 6, null, null]);
  const teammate = world.players[7]!;
  prepareLooseBall(world, teammate.id, 1.2);
  assert.ok(distance(teammate, world.ball) > 0.64);
  for (let frame = 0; frame < 120 && world.controlledSeats?.[1] !== teammate.id; frame++) {
    stepWorld(world, STEP, new Map([[teammate.id, { move: { x: -1, z: 0 } }]]));
  }
  assert.ok(distance(teammate, world.ball) < 0.64);
  assert.equal(world.controlledSeats?.[1], teammate.id);
  assert.equal(teammate.human, true);
  assert.equal(world.players.filter((player) => player.team === 0 && player.human).length, 1);
  assertSeatInvariant(world);
});

test('a loose-ball auto-switch changes only the controlled co-op seat', () => {
  const world = worldWithSeats(534, [6, 9, null, null]);
  const teammate = world.players[7]!;
  prepareLooseBall(world, teammate.id);
  stepWorld(world, STEP);
  assert.equal(world.controlledSeats?.[0], teammate.id);
  assert.equal(world.controlledSeats?.[1], 9);
  assert.equal(world.controlled[0], teammate.id);
  assert.equal(world.players[9]?.human, true);
  assert.equal(world.players[6]?.human, false);
  assertSeatInvariant(world);
});

test('opponent possession does not switch a human seat', () => {
  const world = worldWithSeats(535, [null, 6, null, null]);
  const opponent = world.players[TEAM_SIZE + 6]!;
  prepareLooseBall(world, opponent.id);
  stepWorld(world, STEP);
  assert.equal(world.controlledSeats?.[1], 6);
  assert.equal(world.players[6]?.human, true);
  assert.equal(opponent.human, false);
  assert.equal(world.players.filter((player) => player.team === 1 && player.human).length, 0);
  assertSeatInvariant(world);
});

test('practice mode does not auto-switch to an AI teammate on possession', () => {
  const world = worldWithSeats(536, [null, 6, null, null]);
  const teammate = world.players[7]!;
  prepareLooseBall(world, teammate.id);
  world.practice = true;
  stepWorld(world, STEP);
  assert.equal(world.controlledSeats?.[1], 6);
  assert.equal(world.players[6]?.human, true);
  assert.equal(teammate.human, false);
  assertSeatInvariant(world);
});

test('red-card send-off transfers the seated controller to a replacement', () => {
  const world = worldWithSeats(512, [null, 6, null, null]);
  const sentOff = world.players[6]!;
  sendOff(world, sentOff);

  const replacementId = world.controlledSeats?.[1];
  assert.notEqual(replacementId, null);
  assert.notEqual(replacementId, undefined);
  assert.notEqual(replacementId, sentOff.id);
  assert.equal(sentOff.sentOff, true);
  assert.equal(world.players[replacementId!]?.human, true);
  assert.equal(world.players[replacementId!]?.controlled, true);
  assert.equal(world.players.filter((player) => player.team === 0 && player.human).length, 1);
  assert.equal(world.controlled[0], replacementId);
  assertSeatInvariant(world);
});

test('same-player transfer restores a seated player as human and controlled', () => {
  const world = worldWithSeats(513, [null, 6, null, null]);
  const player = world.players[6]!;
  player.human = false;
  player.controlled = false;
  transferControl(world, 0, player.id, player.id);
  assert.equal(player.human, true);
  assert.equal(player.controlled, true);
  assert.equal(world.controlledSeats?.[1], player.id);
});

test('phone A press and release on the kickoff carrier produces one kick event', () => {
  const world = worldWithSeats(520, [null, 6, null, null]);
  stepWorld(world, STEP);
  const kickoffOwner = world.controlledSeats![1]!;
  stepWorld(world, STEP, new Map([[kickoffOwner, { move: { x: 0.2, z: 0 } }]]));
  assert.equal(world.phase, 'restart');
  assert.equal(world.players[kickoffOwner]?.slot, 'ST');
  const carrierId = kickoffOwner;

  let kickEvents = 0;
  stepWorld(world, STEP, new Map([[carrierId, { move: { x: 0, z: 0 }, action: null, heldAction: 'pass', pressed: false }]]));
  assert.equal(world.phase, 'restart');
  assert.equal(world.kickEvent, null);
  assertSeatInvariant(world);
  stepWorld(world, STEP, new Map([[carrierId, { move: { x: 0, z: 0 }, action: 'pass', pressed: true, aim: { x: 1, z: 0 }, power: 0.45 }]]));
  assert.equal(world.kickEvent?.playerId, carrierId);
  assert.equal(world.kickEvent?.action, 'pass');
  kickEvents += Number(world.kickEvent !== null);
  assertSeatInvariant(world);
  const releaseId = world.controlledSeats![1]!;
  stepWorld(world, STEP, new Map([[releaseId, { move: { x: 0, z: 0 }, action: null, pressed: false }]]));
  kickEvents += Number(world.kickEvent !== null);
  assert.equal(world.kickEvent, null);
  assert.equal(kickEvents, 1);
});

test('phone face labels switch between attacking and defending actions', () => {
  assert.deepEqual(faceLabels(true), { a: 'Pass', b: 'Shoot', x: 'Lob', y: 'Through' });
  assert.deepEqual(faceLabels(true, null, true), { a: 'Pass', b: 'Shoot', x: 'Cross', y: 'Through' });
  assert.deepEqual(faceLabels(false), { a: 'Contain', b: 'Tackle', x: 'Slide', y: 'Press' });
  assert.deepEqual(faceLabels(false, { a: 'Restart', y: 'Through' }), { a: 'Restart', b: 'Tackle', x: 'Slide', y: 'Press' });
});

test('phone match clock uses broadcast minutes and hides a missing pre-kickoff value', () => {
  assert.equal(phoneClockLabel(null), null);
  assert.equal(phoneClockLabel(0), "0'");
  assert.equal(phoneClockLabel(12), "12'");
});

test('phone practice strip is one ellipsized line, below the score and hidden in portrait', () => {
  assert.match(controlCss, /\.g-soccer-pad-strip\s*\{[^}]*width:\s*min\(44vw,\s*460px\)[^}]*max-width:\s*44vw/s);
  assert.match(controlCss, /\.g-soccer-pad \.g-soccer-phone-practice-row p\s*\{[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/s);
  assert.match(controlCss, /\.g-soccer-pad \.g-soccer-phone-practice-row\s*\{[^}]*flex-wrap:\s*nowrap/s);
  assert.match(controlCss, /@media \(orientation: portrait\)[\s\S]*?\.g-soccer-pad-strip,[\s\S]*?\.g-soccer-pad-rotate\s*\{[\s\S]*?display:\s*flex !important/s);
  assert.match(controlCss, /\.g-soccer-pad-rotate\s*\{\s*display:\s*none;/);
  assert.match(controlCss, /--diamond-width:\s*calc\(var\(--btn\)\s*\*\s*3\.2\)/);
  assert.match(controlCss, /--diamond-height:\s*calc\(var\(--btn\)\s*\*\s*3\.1\)/);
  assert.match(controlCss, /\.g-soccer-pad-diamond\s*\{[^}]*right:\s*calc\(var\(--sa-r\)\s*\+\s*24px\)[^}]*bottom:\s*calc\(var\(--sa-b\)\s*\+\s*25px\)[^}]*width:\s*var\(--diamond-width\)[^}]*height:\s*var\(--diamond-height\)/s);
  assert.match(controlCss, /\.g-soccer-pad-stick\s*\{[^}]*position:\s*absolute/s);
  assert.match(controlCss, /\.g-soccer-pad-stick\s*>\s*i\s*\{[^}]*display:\s*block[^}]*position:\s*absolute[^}]*left:\s*50%[^}]*top:\s*50%[^}]*border-radius:\s*50%/s);
  assert.match(controlCss, /\.g-soccer-pad-stick\s*>\s*i::after\s*\{[^}]*content:\s*""[^}]*position:\s*absolute[^}]*inset:\s*0[^}]*margin:\s*auto[^}]*border-radius:\s*50%/s);
  assert.match(controlCss, /\.g-soccer-pad \.g-soccer-setpiece-hint\s*\{[^}]*max-width:\s*44vw[^}]*overflow:\s*hidden[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/s);
  assert.match(controlCss, /\.g-soccer-pad \.g-soccer-stick::after\s*\{\s*display:\s*none;/);
  assert.match(controlCss, /\.g-soccer-pad-rotate svg\s*\{[^}]*width:\s*48px[^}]*height:\s*48px[^}]*fill:\s*none[^}]*stroke:\s*currentColor/s);
  assert.match(controlSource, /<svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor"/);
  const strip = practiceSource.slice(practiceSource.indexOf('export function PhonePracticeStrip'));
  assert.equal((strip.match(/className="g-soccer-phone-practice-row"/g) ?? []).length, 2);
  assert.match(strip, /<button type="button" onClick=\{\(\) => onPick\('skip'\)\}>Skip<\/button>/);
  assert.doesNotMatch(strip, /DrillPicker/);
});

test('haptics suppress vibration before user activation but allow missing activation metadata', () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const calls: number[] = [];
  const restore = (key: string, descriptor?: PropertyDescriptor) => {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  };
  try {
    Object.defineProperty(globalThis, 'document', { configurable: true, value: {} });
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { vibrate: (ms: number) => calls.push(ms), userActivation: { hasBeenActive: false } },
    });
    haptic(20);
    assert.deepEqual(calls, []);

    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { vibrate: (ms: number) => calls.push(ms) },
    });
    haptic(12);
    assert.deepEqual(calls, [12]);
  } finally {
    restore('navigator', originalNavigator);
    restore('document', originalDocument);
  }
});
