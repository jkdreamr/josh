import assert from 'node:assert/strict';
import { test } from 'node:test';
import { acceptMovePacket, consumeCommand, InputFreshness, INPUT_STALE_MS, movePacket, neutralCommand, type RemoteSeat } from '../src/os/arcade/games/soccer/net.ts';

const emptySeat = (): RemoteSeat => ({ seq: -1, edge: -1, held: null, pressUsed: false });

test('held input persists until the freshness watchdog neutralizes it', () => {
  const tracker = new InputFreshness();
  tracker.sync(0, [1]);
  const packet = movePacket(1, 100, 1, { move: { x: 1, z: -1 }, sprint: true, contain: true, jockey: true, heldAction: 'pass' });
  tracker.record(0, 1);
  const accepted = acceptMovePacket(emptySeat(), undefined, packet, false);
  let command = accepted.command!;
  for (let tick = 0; tick < 600; tick++) command = consumeCommand(command);
  assert.deepEqual(command.move, { x: 1, z: -1 });
  assert.deepEqual(tracker.staleSeats(1400, [1]), []);
  assert.deepEqual(tracker.staleSeats(INPUT_STALE_MS, [1]), []);
  assert.deepEqual(tracker.staleSeats(INPUT_STALE_MS + 1, [1]), [1]);
  command = neutralCommand();
  assert.deepEqual(command.move, { x: 0, z: 0 });
  for (const key of ['sprint', 'contain', 'jockey', 'autoJockey', 'pressed', 'press', 'finesseHeld', 'switchNearest'] as const) assert.equal(command[key], false);
  assert.equal(command.heldAction, null);
  assert.equal(command.action, null);
  assert.equal(command.switchDir, null);
});

test('a restarted sequence is accepted only after a stale session reset', () => {
  const tracker = new InputFreshness();
  tracker.sync(0, [1]);
  const first = acceptMovePacket(emptySeat(), undefined, movePacket(1, 100, 1, { move: { x: 1, z: 0 } }), false);
  const restarted = movePacket(1, 0, 1, { move: { x: 0, z: 1 } });
  assert.equal(tracker.record(1400, 1), false);
  assert.equal(acceptMovePacket(first.seat, first.command!, restarted, false).command, null);
  assert.equal(tracker.record(3001, 1), true);
  const resumed = acceptMovePacket(emptySeat(), neutralCommand(), restarted, false);
  assert.equal(resumed.seat.seq, 0);
  assert.deepEqual(resumed.command?.move, { x: 0, z: 1 });
  assert.deepEqual(tracker.staleSeats(3001, [1]), []);
});

test('never-sending seats get kickoff grace and suspended hosts get fresh grace', () => {
  const tracker = new InputFreshness();
  assert.deepEqual(tracker.staleSeats(10000, []), []);
  tracker.sync(100, [1, 2]);
  assert.deepEqual(tracker.staleSeats(1500, [1, 2]), []);
  assert.deepEqual(tracker.staleSeats(1601, [1, 2]), [1, 2]);
  tracker.sync(10000, [1, 2], true);
  assert.deepEqual(tracker.staleSeats(10000, [1, 2]), []);
  assert.deepEqual(tracker.staleSeats(11400, [1, 2]), []);
  tracker.sync(11400, [2]);
  assert.deepEqual(tracker.staleSeats(12000, [1, 2]), [2]);
  tracker.sync(12000, [1, 2]);
  assert.deepEqual(tracker.staleSeats(12000, [1, 2]), [2]);
});

test('rejected sequence packets still keep the controller link fresh', () => {
  const tracker = new InputFreshness();
  tracker.sync(0, [1]);
  const accepted = acceptMovePacket(emptySeat(), undefined, movePacket(1, 100, 1, neutralCommand()), false);
  for (const now of [1000, 2000, 3000]) {
    assert.equal(tracker.record(now, 1), false);
    assert.equal(acceptMovePacket(accepted.seat, accepted.command!, movePacket(1, 99, 1, neutralCommand()), false).command, null);
    assert.deepEqual(tracker.staleSeats(now + 1400, [1]), []);
  }
});
