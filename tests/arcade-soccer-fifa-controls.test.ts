import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createWorld, distance, FIELD, findReceiver, groundPassSpeed, kick, STEP, stepWorld } from '../src/os/arcade/games/soccer/logic.ts';
import { faceLabels, haptic } from '../src/os/arcade/games/soccer/pad.ts';

const controlCss = readFileSync(new URL('../src/os/arcade/games/soccer/soccer.css', import.meta.url), 'utf8');
const practiceSource = readFileSync(new URL('../src/os/arcade/games/soccer/practice-mode.tsx', import.meta.url), 'utf8');

function directionAt(angle: number, distance: number) {
  return { x: Math.cos(angle) * distance, z: Math.sin(angle) * distance };
}

function angularDifference(a: number, b: number) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
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

test('phone face labels switch between attacking and defending actions', () => {
  assert.deepEqual(faceLabels(true), { a: 'Pass', b: 'Shoot', x: 'Lob · Cross', y: 'Through' });
  assert.deepEqual(faceLabels(false), { a: 'Contain', b: 'Tackle', x: 'Slide', y: 'Press' });
  assert.deepEqual(faceLabels(false, { a: 'Restart', y: 'Through' }), { a: 'Restart', b: 'Tackle', x: 'Slide', y: 'Press' });
});

test('phone practice strip is one ellipsized line, below the score and hidden in portrait', () => {
  assert.match(controlCss, /\.g-soccer-pad-strip\s*\{[^}]*width:\s*min\(44vw,\s*460px\)[^}]*max-width:\s*44vw/s);
  assert.match(controlCss, /\.g-soccer-pad \.g-soccer-phone-practice-row p\s*\{[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/s);
  assert.match(controlCss, /\.g-soccer-pad \.g-soccer-phone-practice-row\s*\{[^}]*flex-wrap:\s*nowrap/s);
  assert.match(controlCss, /@media \(orientation: portrait\)[\s\S]*?\.g-soccer-pad-strip,[\s\S]*?\.g-soccer-pad-rotate\s*\{[\s\S]*?display:\s*flex !important/s);
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
