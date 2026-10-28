import assert from 'node:assert/strict';
import { test } from 'node:test';
import { acceptMovePacket, commandFromPacket, consumeCommand, mergeRemoteCommand, movePacket, parsePacket, type RemoteSeat } from '../src/os/arcade/games/soccer/net.ts';
import { chargePower } from '../src/os/arcade/games/soccer/input.ts';

const remoteSeat = (): RemoteSeat => ({ seq: -1, edge: -1, held: null, pressUsed: false });

test('online move packets round-trip validated inputs', () => {
  const packet = movePacket(2, 42, 1, { move: { x: 0.32, z: -1 }, sprint: true, action: 'shoot', heldAction: 'shoot', pressed: true });
  assert.deepEqual(parsePacket(packet), packet);
  assert.equal(commandFromPacket(packet).action, 'shoot');
  assert.equal(commandFromPacket(packet).heldAction, 'shoot');
});

test('neutral aim remains neutral in online move packets', () => {
  const packet = movePacket(1, 1, 0, { move: { x: 0, z: 0 }, aim: { x: 0, z: 0 } });
  assert.equal(packet.ax, 0);
  assert.equal(packet.az, 0);
  assert.deepEqual(commandFromPacket(packet).aim, { x: 0, z: 0 });
});

test('held action packets round-trip every supported charged action', () => {
  for (const heldAction of ['pass', 'shoot', 'through', 'lob', 'skill'] as const) {
    const packet = movePacket(1, 2, 0, { move: { x: 0, z: 0 }, heldAction });
    assert.deepEqual(parsePacket(packet), packet);
    assert.equal(commandFromPacket(packet).heldAction, heldAction);
  }
});

test('charge time maps to a clamped tenth-to-full power range', () => {
  assert.equal(chargePower(0), 0.1);
  assert.equal(chargePower(0.45), 0.45);
  assert.equal(chargePower(1.4), 1);
});

test('malformed, non-finite, and out-of-range packet fields are rejected', () => {
  const packet = movePacket(1, 1, 0, { move: { x: 0, z: 0 } });
  for (const bad of [
    { ...packet, x: Number.NaN }, { ...packet, z: 1.1 }, { ...packet, seq: -1 }, { ...packet, seat: 4 },
    { ...packet, buttons: 32768 }, { ...packet, buttons: 2 ** 32 }, { ...packet, held: 1024 },
    { ...packet, e: -1 }, { ...packet, e: 1.5 }, { ...packet, e: Number.MAX_SAFE_INTEGER + 1 },
    { ...packet, sx: 0.2 }, { ...packet, sx: 0.123, sz: 0 }, { ...packet, sx: 0, sz: Infinity },
    { ...packet, t: 'other' }, { ...packet, k: 'admin' },
  ]) assert.equal(parsePacket(bad), null);
});

test('all held control flags and directional switch round-trip, with legacy flick fields optional', () => {
  for (const flag of ['jockey', 'autoJockey', 'contain', 'switchNearest', 'finesse', 'finesseHeld', 'press'] as const) {
    const packet = movePacket(1, 1, 0, { move: { x: 0, z: 0 }, [flag]: true });
    assert.deepEqual(parsePacket(packet), packet);
    assert.equal(commandFromPacket(packet)[flag], true);
  }
  const packet = movePacket(1, 1, 0, { move: { x: 0, z: 0 }, switchDir: { x: 0.436, z: -0.901 } });
  assert.deepEqual(parsePacket(packet), packet);
  assert.deepEqual(commandFromPacket(packet).switchDir, { x: 0.44, z: -0.9 });
  const { sx, sz, ...legacy } = packet;
  assert.ok(parsePacket(legacy));
  assert.equal(commandFromPacket(legacy).switchDir, null);
});

test('remote updates retain pending one-shots but refresh held flags, then consume only once', () => {
  const initial = { move: { x: 0, z: 0 }, action: 'shoot' as const, pressed: true, power: 0.7, switchNearest: true, switchDir: { x: 1, z: 0 } };
  const held = { move: { x: 0.5, z: 0 }, heldAction: 'pass' as const, jockey: true, autoJockey: true, contain: true, press: true, finesseHeld: true, sprint: true };
  const merged = mergeRemoteCommand(initial, held);
  assert.equal(merged.action, 'shoot'); assert.equal(merged.power, 0.7);
  assert.equal(merged.switchNearest, true); assert.deepEqual(merged.switchDir, { x: 1, z: 0 });
  const consumed = consumeCommand(merged);
  assert.equal(consumed.action, null); assert.equal(consumed.pressed, false);
  assert.equal(consumed.switchNearest, false); assert.equal(consumed.switchDir, null);
  for (const flag of ['jockey', 'autoJockey', 'contain', 'press', 'finesseHeld', 'sprint'] as const) assert.equal(consumed[flag], true);
  assert.equal(consumed.heldAction, 'pass');
  const next = mergeRemoteCommand(consumed, { move: { x: 0, z: 0 } });
  assert.ok(!next.action && !next.switchNearest && !next.switchDir && !next.press);
  assert.equal(initial.pressed, true, 'helpers must not mutate their inputs');
});

test('a newer action edge survives packet reordering and repeated edge packets fire once', () => {
  const movement = movePacket(1, 2, 0, { move: { x: 0.5, z: 0 } }, 0);
  const moved = acceptMovePacket(remoteSeat(), undefined, movement, false);
  const release = movePacket(1, 1, 0, { move: { x: 0, z: 0 }, action: 'shoot', pressed: true, power: 0.8 }, 1);
  const accepted = acceptMovePacket(moved.seat, moved.command!, release, false);
  assert.equal(accepted.command?.action, 'shoot');
  assert.equal(accepted.command?.pressed, true);
  assert.deepEqual(accepted.command?.move, { x: 0.5, z: 0 }, 'stale packet only contributes its edge fields');
  const consumed = consumeCommand(accepted.command!);
  const repeat = movePacket(1, 3, 0, { move: { x: 0.6, z: 0 }, action: 'shoot', pressed: true, power: 0.8 }, 1);
  const deduplicated = acceptMovePacket(accepted.seat, consumed, repeat, false);
  assert.equal(deduplicated.command?.action, null);
  assert.equal(deduplicated.command?.pressed, false);
  assert.deepEqual(deduplicated.command?.move, { x: 0.6, z: 0 });
});

test('a repeated delivery recovers a lost action edge and is applied once', () => {
  const repeat = movePacket(1, 4, 0, { move: { x: 0, z: 0 }, action: 'through', pressed: true, power: 0.65 }, 7);
  const first = acceptMovePacket(remoteSeat(), undefined, repeat, false);
  assert.equal(first.command?.action, 'through');
  const consumed = consumeCommand(first.command!);
  const second = acceptMovePacket(first.seat, consumed, { ...repeat, seq: 5 }, false);
  assert.equal(second.command?.action, null);
  assert.equal(second.command?.pressed, false);
});

test('defensive held shot becomes an immediate action and its release is discarded', () => {
  const hold = movePacket(1, 1, 0, { move: { x: 0, z: 0 }, heldAction: 'shoot', power: 0.37 }, 1);
  const pressed = acceptMovePacket(remoteSeat(), undefined, hold, true);
  assert.equal(pressed.command?.action, 'shoot');
  assert.equal(pressed.command?.pressed, true);
  assert.equal(pressed.seat.pressUsed, true);
  const consumed = consumeCommand(pressed.command!);
  const release = movePacket(1, 2, 0, { move: { x: 0, z: 0 }, action: 'shoot', pressed: true, power: 0.9 }, 2);
  const dropped = acceptMovePacket(pressed.seat, consumed, release, true);
  assert.equal(dropped.command?.action, null);
  assert.equal(dropped.command?.pressed, false);
  assert.equal(dropped.seat.pressUsed, false);
});

test('attacking held shot charges until its release edge', () => {
  const hold = movePacket(1, 1, 0, { move: { x: 0, z: 0 }, heldAction: 'shoot', power: 0.37 }, 1);
  const charging = acceptMovePacket(remoteSeat(), undefined, hold, false);
  assert.equal(charging.command?.action, null);
  assert.equal(charging.command?.heldAction, 'shoot');
  const release = movePacket(1, 2, 0, { move: { x: 0, z: 0 }, action: 'shoot', pressed: true, power: 0.83 }, 2);
  const fired = acceptMovePacket(charging.seat, charging.command!, release, false);
  assert.equal(fired.command?.action, 'shoot');
  assert.equal(fired.command?.pressed, true);
  assert.equal(fired.command?.power, 0.83);
  assert.equal(fired.seat.pressUsed, false);
});

test('legacy packets without edge ids retain sequence-based behavior', () => {
  const packet = movePacket(1, 1, 0, { move: { x: 0, z: 0 }, action: 'shoot', pressed: true });
  const accepted = acceptMovePacket(remoteSeat(), undefined, packet, false);
  assert.equal(accepted.command?.action, 'shoot');
  assert.equal(acceptMovePacket(accepted.seat, accepted.command, { ...packet, seq: 1 }, false).command, null);
});

test('online configuration is constrained to supported match options', () => {
  assert.ok(parsePacket({ t: 'soccer', k: 'cfg', r: 1, seq: 0, half: 3, level: 1 }));
  assert.equal(parsePacket({ t: 'soccer', k: 'cfg', r: 1, seq: 0, half: 4, level: 2, displayOnly: true, mode: 'coop' })?.mode, 'coop');
  assert.equal(parsePacket({ t: 'soccer', k: 'cfg', r: 1, seq: 0, half: 7, level: 1 }), null);
  assert.equal(parsePacket({ t: 'soccer', k: 'cfg', r: 1, seq: 0, half: 3, level: 9 }), null);
  assert.equal(parsePacket({ t: 'soccer', k: 'cfg', r: 1, seq: 0, half: 3, level: 1, mode: 'duo' }), null);
});
