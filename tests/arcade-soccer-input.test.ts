import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { KeyState } from '../src/os/arcade/kit/keys.ts';
import { IDENTITY_BASIS, screenToWorld, type ViewBasis, gamepadInput, keyboardInput, reconcileControllers, touchInput } from '../src/os/arcade/games/soccer/input.ts';
import { createWorld, switchPlayer } from '../src/os/arcade/games/soccer/logic.ts';

function pad(index = -1, value = 1) {
  return { buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: i === index, value: i === index ? value : 0 })), axes: [0, 0, 0, 0] };
}

function keyState(): KeyState {
  const held = new Set<string>(), hits = new Set<string>();
  return {
    press(key: string) { if (!held.has(key)) hits.add(key); held.add(key); },
    down(...keys: string[]) { return keys.some((key) => held.has(key)); },
    pressed(...keys: string[]) { return keys.reduce((hit, key) => hits.delete(key) || hit, false); },
  } as unknown as KeyState;
}

test('standard gamepad face buttons map A pass, B shoot, X lob and Y through with held charging', () => {
  for (const [i, action] of ['pass', 'shoot', 'lob', 'through'].entries()) {
    const input = pad(i);
    const first = gamepadInput(input);
    assert.equal(first.state.action, action); assert.equal(first.state.heldAction, action); assert.equal(first.state.pressed, true);
    const holding = gamepadInput(input, first.previous);
    assert.equal(holding.state.action, null); assert.equal(holding.state.pressed, false); assert.equal(holding.state.heldAction, action);
    assert.equal(gamepadInput(pad(), holding.previous).state.heldAction, null);
  }
});

test('gamepad dead-zone output approaches zero continuously and flick noise cannot retrigger a switch', () => {
  const input = pad();
  input.axes[0] = 0.14;
  assert.equal(gamepadInput(input).state.move.x, 0);
  input.axes[0] = 0.14001;
  assert.ok(gamepadInput(input).state.move.x < 1e-7);
  let last = 0;
  for (let axis = 0.14; axis <= 1; axis += 0.001) {
    input.axes[0] = axis;
    const move = gamepadInput(input).state.move.x;
    assert.ok(move >= last && move - last < 0.01);
    last = move;
  }
  input.axes[2] = 0.81;
  let history = gamepadInput(input, {}, true).previous;
  for (const noise of [0.79, 0.81, 0.78, 0.83, 0.7, 0.81]) {
    input.axes[2] = noise;
    const sample = gamepadInput(input, history, true);
    assert.equal(sample.state.switchDir, null);
    history = sample.previous;
  }
});

test('analog-only triggers use 0.3 threshold, LB is edged and RB holds finesse/press', () => {
  for (const [index, flag] of [[6, 'jockey'], [7, 'sprint']] as const) {
    const input = pad(index, 0.31); input.buttons[index]!.pressed = false;
    assert.equal(gamepadInput(input).state[flag], true);
    input.buttons[index]!.value = 0.3;
    assert.equal(gamepadInput(input).state[flag], false);
  }
  const first = gamepadInput(pad(4));
  assert.equal(first.state.switchNearest, true);
  assert.equal(first.state.action, null);
  assert.equal(gamepadInput(pad(4), first.previous).state.switchNearest, false);
  const rb = gamepadInput(pad(5)).state;
  assert.equal(rb.finesseHeld, true); assert.equal(rb.press, true);
  assert.equal(gamepadInput(pad(0), {}, true).state.contain, true);
  assert.equal(gamepadInput(pad(0), {}, false).state.contain, false);
});

test('right stick flick is skill in attack and directional switch in defense, once until neutral', () => {
  const input = pad(); input.axes = [0.05, -0.5, 0.9, -0.4];
  const attack = gamepadInput(input);
  assert.equal(attack.state.action, 'skill'); assert.equal(attack.state.pressed, true);
  assert.deepEqual(attack.state.move, { x: 0, z: -0.5 });
  const defense = gamepadInput(input, {}, true);
  assert.equal(defense.state.action, null);
  assert.deepEqual(defense.state.switchDir, { x: 0.9, z: -0.4 });
  assert.equal(gamepadInput(input, defense.previous, true).state.switchDir, null);
  const released = gamepadInput(pad(), defense.previous, true);
  assert.ok(gamepadInput(input, released.previous, true).state.switchDir);
  assert.deepEqual(gamepadInput({ axes: [], buttons: [] }).state.move, { x: 0, z: 0 });
});

test('P1 keyboard has chargeable J/K/L/I, instant U, Q switch, E press, Space jockey and Shift sprint', () => {
  for (const [key, action] of [['KeyJ', 'pass'], ['KeyK', 'shoot'], ['KeyL', 'through'], ['KeyI', 'lob']] as const) {
    const keys = keyState(); keys.press(key);
    const state = keyboardInput(keys);
    assert.equal(state.action, action); assert.equal(state.heldAction, action);
    assert.equal(keyboardInput(keys).pressed, false);
  }
  const keys = keyState();
  for (const key of ['KeyU', 'KeyQ', 'KeyE', 'Space', 'ShiftLeft']) keys.press(key);
  const state = keyboardInput(keys);
  assert.equal(state.action, 'skill'); assert.equal(state.heldAction, null);
  for (const flag of ['switchNearest', 'press', 'jockey', 'sprint', 'finesseHeld'] as const) assert.equal(state[flag], true);
  assert.equal(keyboardInput(keys).switchNearest, false);
  keys.press('KeyK'); assert.equal(keyboardInput(keys).heldAction, 'shoot');
});

test('P2 and touch default to auto jockey without changing P2 keys', () => {
  const keys = keyState(); keys.press('Period');
  const state = keyboardInput(keys, true);
  assert.equal(state.heldAction, 'pass'); assert.equal(state.autoJockey, true);
  assert.equal(touchInput({ x: 0, z: 0 }, null, false, false).autoJockey, true);
});

test('controller ownership follows switching without stealing another co-op human', () => {
  const world = createWorld(1, 120, 2);
  world.players[9]!.controlled = true;
  const assignments = new Map([[1, 6], [2, 9]]);
  const nextId = switchPlayer(world, 0);
  const next = reconcileControllers(world, assignments);
  assert.equal(next.get(1), nextId); assert.equal(next.get(2), 9);
  assert.equal(assignments.get(1), 6);
  assert.equal(reconcileControllers(world, new Map()).size, 0);
});
test('identity view basis leaves input unchanged', () => {
  assert.deepEqual(screenToWorld({ x: 0.35, z: -0.8 }, IDENTITY_BASIS), { x: 0.35, z: -0.8 });
});

test('broadcast basis maps screen directions onto the field', () => {
  const basis: ViewBasis = { right: { x: -1, z: 0 }, forward: { x: 0, z: 1 } };
  assert.deepEqual(screenToWorld({ x: 1, z: 0 }, basis), { x: -1, z: 0 });
  assert.deepEqual(screenToWorld({ x: 0, z: -1 }, basis), { x: 0, z: 1 });
  assert.deepEqual(screenToWorld({ x: 0, z: 1 }, basis), { x: 0, z: -1 });
});

test('portrait basis maps screen directions onto the field', () => {
  const basis: ViewBasis = { right: { x: 0, z: 1 }, forward: { x: 1, z: 0 } };
  assert.deepEqual(screenToWorld({ x: 0, z: -1 }, basis), { x: 1, z: 0 });
  assert.deepEqual(screenToWorld({ x: 1, z: 0 }, basis), { x: 0, z: 1 });
});
