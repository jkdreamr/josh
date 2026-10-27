import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commandFromPacket, movePacket, parsePacket } from '../src/os/arcade/games/soccer/net.ts';
import { chargePower } from '../src/os/arcade/games/soccer/input.ts';

test('online move packets round-trip validated inputs', () => {
  const packet = movePacket(2, 42, 1, { move: { x: 0.32, z: -1 }, sprint: true, action: 'shoot', heldAction: 'shoot', pressed: true });
  assert.deepEqual(parsePacket(packet), packet);
  assert.equal(commandFromPacket(packet).action, 'shoot');
  assert.equal(commandFromPacket(packet).heldAction, 'shoot');
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
    { ...packet, buttons: 1024 }, { ...packet, t: 'other' }, { ...packet, k: 'admin' },
  ]) assert.equal(parsePacket(bad), null);
});

test('online configuration is constrained to supported match options', () => {
  assert.ok(parsePacket({ t: 'soccer', k: 'cfg', r: 1, seq: 0, half: 3, level: 1 }));
  assert.equal(parsePacket({ t: 'soccer', k: 'cfg', r: 1, seq: 0, half: 4, level: 2, displayOnly: true, mode: 'coop' })?.mode, 'coop');
  assert.equal(parsePacket({ t: 'soccer', k: 'cfg', r: 1, seq: 0, half: 7, level: 1 }), null);
  assert.equal(parsePacket({ t: 'soccer', k: 'cfg', r: 1, seq: 0, half: 3, level: 9 }), null);
  assert.equal(parsePacket({ t: 'soccer', k: 'cfg', r: 1, seq: 0, half: 3, level: 1, mode: 'duo' }), null);
});
