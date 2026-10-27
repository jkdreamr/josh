import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commandFromPacket, movePacket, parsePacket } from '../src/os/arcade/games/soccer/net.ts';

test('online move packets round-trip validated inputs', () => {
  const packet = movePacket(2, 42, 1, { move: { x: 0.32, z: -1 }, sprint: true, action: 'shoot', pressed: true });
  assert.deepEqual(parsePacket(packet), packet);
  assert.equal(commandFromPacket(packet).action, 'shoot');
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
  assert.equal(parsePacket({ t: 'soccer', k: 'cfg', r: 1, seq: 0, half: 7, level: 1 }), null);
  assert.equal(parsePacket({ t: 'soccer', k: 'cfg', r: 1, seq: 0, half: 3, level: 9 }), null);
});
