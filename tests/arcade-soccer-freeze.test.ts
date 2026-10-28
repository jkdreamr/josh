import assert from 'node:assert/strict';
import { test } from 'node:test';
import { acceptMovePacket, consumeCommand, InputFreshness, INPUT_STALE_MS, movePacket, neutralCommand, type RemoteSeat } from '../src/os/arcade/games/soccer/net.ts';
import { phoneControlledPlayer, reconcileControllers, syncControllerSeats } from '../src/os/arcade/games/soccer/input.ts';
import { createWorld, setRestart, stepWorld, STEP, transferControl } from '../src/os/arcade/games/soccer/logic.ts';
import { assignControllers } from '../src/os/arcade/games/soccer/seats.ts';
import { computeAI } from '../src/os/arcade/games/soccer/ai.ts';
import { setPieceLabels } from '../src/os/arcade/games/soccer/setpieces.ts';

const emptySeat = (): RemoteSeat => ({ seq: -1, edge: -1, held: null, pressUsed: false });

function transferredOnlineSeat() {
  const world = createWorld();
  world.phase = 'live';
  const preferred = assignControllers([{ seat: 1, role: 'phone', side: 0 }], 'versus', 'online');
  let assignments = new Map(preferred);
  transferControl(world, 0, 9);
  assignments = reconcileControllers(world, assignments);
  assert.equal(assignments.get(1), 9);
  assignments = syncControllerSeats(world, assignments, preferred);
  return { world, assignments };
}

test('online seat sync preserves transferred control rather than restoring its static player', () => {
  const { assignments } = transferredOnlineSeat();
  assert.equal(assignments.get(1), 9);
});

test('online seat sync leaves no orphan human excluded from both commands and AI', () => {
  const { world, assignments } = transferredOnlineSeat();
  const commands = new Map([...assignments.values()].map((id) => [id, neutralCommand()]));
  const ai = computeAI(world, 'normal', 1 / 60, 0);
  const orphan = world.players.find((player) => player.human && player.controlled && !commands.has(player.id) && !ai.has(player.id));
  assert.equal(orphan?.id, undefined);
});

test('seat sync honors changed teams and clears the previously controlled player', () => {
  const { world, assignments } = transferredOnlineSeat();
  const preferred = assignControllers([{ seat: 1, role: 'phone', side: 1 }], 'versus', 'online');
  const synced = syncControllerSeats(world, assignments, preferred);
  assert.equal(synced.get(1), 17);
  assert.equal(world.players[9]!.human, false);
  assert.equal(world.players[9]!.controlled, false);
  assert.equal(world.players[17]!.human, true);
  assert.equal(world.players[17]!.controlled, true);
});

test('seat sync handles absent players, sent-off defaults and empty seats', () => {
  const world = createWorld();
  world.players[6]!.sentOff = true;
  const synced = syncControllerSeats(world, new Map([[1, 999]]), new Map([[1, 6], [2, 9]]));
  assert.notEqual(synced.get(1), 6);
  assert.equal(new Set(synced.values()).size, 2);
  for (const id of synced.values()) assert.equal(!!world.players[id]!.sentOff, false);
  assert.deepEqual(syncControllerSeats(world, synced, new Map()), synced);
  for (const id of synced.values()) {
    assert.equal(world.players[id]!.human, true);
    assert.equal(world.players[id]!.controlled, true);
  }
  assert.equal(syncControllerSeats(world, new Map(), new Map()).size, 0);
});

test('quick and cup seat sync retain keyboard seat zero absent from phone assignments', () => {
  for (const competition of ['quick', 'cup'] as const) {
    const world = createWorld();
    const preferred = assignControllers([], 'cpu', competition);
    const synced = syncControllerSeats(world, new Map([[0, 6]]), preferred);
    assert.equal(synced.get(0), 6);
    assert.equal(world.players[6]!.human, true);
    assert.equal(world.players[6]!.controlled, true);
  }
});

test('seat sync retains an unlisted Mac without assigning its player to a phone too', () => {
  const world = createWorld();
  const synced = syncControllerSeats(world, new Map([[0, 6]]), new Map([[1, 6]]));
  assert.equal(synced.get(0), 6);
  assert.notEqual(synced.get(1), 6);
  assert.equal(synced.size, 2);
  assert.equal(world.players[6]!.human, true);
  assert.equal(world.players[6]!.controlled, true);
});

test('phone identity follows a transferred goal-kick taker and shows taking labels', () => {
  const world = createWorld();
  setRestart(world, 0, 'goal-kick', { x: -47, z: 0 });
  const player = phoneControlledPlayer(world, 6);
  assert.equal(player, 0);
  assert.equal(world.controlled[0], player);
  assert.equal(world.phase === 'restart' && world.setPiece?.takerId === player, true);
  const labels = setPieceLabels(world, 0, player);
  assert.match(labels!.hint, /aim delivery/);
  assert.doesNotMatch(labels!.hint, /Find space/);
});

test('phone identity follows receivers and red-card replacements, retaining other human seats', () => {
  const world = createWorld();
  assert.equal(phoneControlledPlayer(null, 6), 6);
  assert.equal(phoneControlledPlayer(world, 6), 6);
  transferControl(world, 0, 9);
  assert.equal(phoneControlledPlayer(world, 6), 9);
  world.players[6]!.sentOff = true;
  assert.equal(phoneControlledPlayer(world, 6), 9);
  world.players[7]!.human = world.players[7]!.controlled = true;
  assert.equal(phoneControlledPlayer(world, 7), 7);
});

test('human corner aim, target and curl inputs cannot extend the 20-second timeout', () => {
  for (const clockScale of [0, 1, 20]) {
    const world = createWorld(1234);
    setRestart(world, 0, 'corner', { x: 52.35, z: 33.85 });
    const taker = world.setPiece!.takerId;
    assert.equal(world.players[taker]!.human, true);
    let ticks = 0;
    while (world.phase === 'restart' && ticks < 1201) {
      const previousClock = world.restartClock;
      const action = ticks % 2 ? 'through' : 'skill';
      stepWorld(world, STEP, new Map([[taker, {
        move: { x: Math.sin(ticks / 7), z: Math.cos(ticks / 11) }, action, pressed: true,
      }]]), clockScale);
      assert.ok(world.restartClock > previousClock);
      if (world.setPiece) assert.equal(world.setPiece.takerId, taker);
      ticks++;
    }
    assert.equal(world.phase, 'live');
    assert.ok(ticks * STEP <= 20 + 1e-9, `corner took ${ticks * STEP}s at clockScale ${clockScale}`);
  }
});

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

test('pass reception transfers the current human after switching away from the passer', () => {
  for (const missingPrimary of [false, true]) {
    const world = createWorld(1234);
    world.phase = 'live';
    for (const player of world.players) { player.x = -30 + player.id * 2; player.z = 20; }
    Object.assign(world.players[10]!, { x: 0, z: 0 });
    Object.assign(world.ball, { x: 0, z: 0, y: 0.11, vx: 0, vy: 0, vz: 0 });
    world.passFrom = 6;
    world.passTarget = 10;
    world.passControl = true;
    transferControl(world, 0, 7);
    if (missingPrimary) world.controlled[0] = 6;
    assert.deepEqual(world.players.filter((p) => p.human).map((p) => p.id), [7]);
    stepWorld(world, STEP, new Map([[7, { move: { x: 0, z: 1 } }]]));
    assert.deepEqual(world.players.filter((p) => p.human || p.controlled).map((p) => p.id), [10]);
    assert.equal(world.controlled[0], 10);
    assert.equal(reconcileControllers(world, new Map([[1, 7]])).get(1), 10);
  }
});
