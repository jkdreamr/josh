import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ROOM_MESSAGE_MAX_BYTES } from '../worker/src/room-core.ts';
import { computeAI } from '../src/os/arcade/games/soccer/ai.ts';
import { createWorld, STEP, stepWorld, type Command, type World } from '../src/os/arcade/games/soccer/logic.ts';
import { acceptMovePacket, commandFromPacket, consumeCommand, InputFreshness, mergeRemoteCommand, movePacket, parsePacket, sameStick, stickSendDelay, trimSnapshot, type RemoteSeat } from '../src/os/arcade/games/soccer/net.ts';
import { chargePower } from '../src/os/arcade/games/soccer/input.ts';
import { startShootout } from '../src/os/arcade/games/soccer/setpieces.ts';

const remoteSeat = (): RemoteSeat => ({ seq: -1, edge: -1, held: null, pressUsed: false });

test('online move packets round-trip validated inputs', () => {
  const packet = movePacket(2, 42, 1, { move: { x: 0.32, z: -1 }, sprint: true, action: 'shoot', heldAction: 'shoot', pressed: true });
  assert.deepEqual(parsePacket(packet), packet);
  assert.equal(commandFromPacket(packet).action, 'shoot');
  assert.equal(commandFromPacket(packet).heldAction, 'shoot');
});

test('stick changes use move packet quantization and an 8ms minimum gap', () => {
  assert.equal(sameStick({ x: 0.004, z: 0 }, { x: 0, z: 0 }), true);
  assert.equal(sameStick({ x: 0.006, z: 0 }, { x: 0, z: 0 }), false);
  assert.equal(stickSendDelay(100, 93), 1);
  assert.equal(stickSendDelay(100, 92), 0);
  assert.equal(stickSendDelay(110, 100), 0);
});

test('ping packets validate ids and timestamps', () => {
  const ping = { t: 'soccer', k: 'pg', id: 3, at: 125.5 };
  assert.deepEqual(parsePacket(ping), ping);
  for (const bad of [
    { ...ping, id: -1 }, { ...ping, id: 1.5 }, { ...ping, at: Number.NaN },
    { ...ping, at: -1 }, { t: 'soccer', k: 'pg', id: 1 }, { t: 'soccer', k: 'pg', at: 1 },
  ]) assert.equal(parsePacket(bad), null);
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

test('a duplicate move delivery with the same sequence and edge is applied only once', () => {
  const packet = movePacket(1, 4, 0, { move: { x: 0.5, z: 0 }, action: 'shoot', pressed: true, power: 0.8 }, 7);
  const first = acceptMovePacket(remoteSeat(), undefined, packet, false);
  assert.equal(first.command?.action, 'shoot');
  const consumed = consumeCommand(first.command!);
  const duplicate = acceptMovePacket(first.seat, consumed, packet, false);
  assert.equal(duplicate.command, null);
  assert.equal(duplicate.seat.seq, packet.seq);
  assert.equal(duplicate.seat.edge, packet.e);
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

test('trimmed full-match and worst-case snapshots fit the worker relay', () => {
  const encoder = new TextEncoder();
  const relayMessage = (state: World) => ({
    t: 'msg', to: 3, d: { '~r': 999, d: { t: 'soccer', k: 's', r: 1, seq: 99999999, state } },
  });
  const frame = (state: World) => JSON.stringify(relayMessage(state));
  const frameAtPrecision = (state: World, decimals: number) => JSON.stringify(relayMessage(state), (_key, value) =>
    typeof value === 'number' && Number.isFinite(value) && !Number.isInteger(value)
      ? Math.round(value * 10 ** decimals) / 10 ** decimals
      : value);
  const world = createWorld(71423, 120);
  const homeCommands = new Map<number, Command>();
  const awayCommands = new Map<number, Command>();
  const commands = new Map<number, Command>();
  const largestValues = new Map<string, { bytes: number; value: unknown }>();
  let largestWorld: World | undefined;
  let largestWorldBytes = -1;
  let samples = 0;
  const keepLargest = (key: string, value: unknown) => {
    const json = JSON.stringify(value);
    if (json === undefined) return;
    const bytes = encoder.encode(json).byteLength;
    if (bytes > (largestValues.get(key)?.bytes ?? -1)) largestValues.set(key, { bytes, value: structuredClone(value) });
  };

  for (let tick = 0; tick < 30000 && world.phase !== 'full-time'; tick++) {
    computeAI(world, 'hard', STEP, tick, 0, homeCommands);
    computeAI(world, 'hard', STEP, tick, 1, awayCommands);
    commands.clear();
    for (const [id, command] of homeCommands) commands.set(id, command);
    for (const [id, command] of awayCommands) commands.set(id, command);
    stepWorld(world, STEP, commands);
    if (tick % 3 !== 0) continue;

    samples++;
    const state = trimSnapshot(world);
    const packet = { t: 'soccer', k: 's', r: 1, seq: 99999999, state };
    assert.ok(parsePacket(packet), `trimmed snapshot at tick ${tick} must parse`);
    const relayBytes = encoder.encode(frame(state)).byteLength;
    assert.ok(relayBytes <= ROOM_MESSAGE_MAX_BYTES, `relay frame at tick ${tick} is ${relayBytes} bytes`);

    for (const key of ['setPiece', 'setPieceRun', 'shootout', 'rules', 'kickEvent', 'passPoint']) {
      keepLargest(key, world[key as keyof World]);
    }
    const json = JSON.stringify(world)!;
    const worldBytes = encoder.encode(json).byteLength;
    if (worldBytes > largestWorldBytes) {
      largestWorldBytes = worldBytes;
      largestWorld = structuredClone(world);
    }
  }
  assert.equal(world.phase, 'full-time', 'the simulated match should reach full time');
  assert.ok(samples > 1000, 'the full match should provide many samples');
  assert.ok(largestWorld);

  const shootoutWorld = structuredClone(largestWorld);
  startShootout(shootoutWorld);
  keepLargest('shootout', shootoutWorld.shootout);

  const worstCase = structuredClone(largestWorld);
  worstCase.setPiece = largestValues.get('setPiece')?.value as World['setPiece'];
  worstCase.setPieceRun = largestValues.get('setPieceRun')?.value as World['setPieceRun'];
  worstCase.shootout = largestValues.get('shootout')?.value as World['shootout'];
  worstCase.rules = structuredClone(largestValues.get('rules')?.value as World['rules']);
  worstCase.kickEvent = largestValues.get('kickEvent')?.value as World['kickEvent'];
  worstCase.passPoint = largestValues.get('passPoint')?.value as World['passPoint'];
  worstCase.rules!.yellows = Array.from({ length: 22 }, (_, id) => id);
  for (const player of worstCase.players) {
    player.buffer = { action: 'finesse', power: 0.123456789, aim: { x: 12.3456789, z: -23.456789 }, t: 0.98765432 };
    player.slide = { x: 0.70710678, z: -0.70710678, t: 0.5432198, won: true };
    player.touchCd = 0.123456789;
    player.planting = true;
    player.formation = 10;
    player.action = 'x'.repeat(24);
  }
  worstCase.event = 'e'.repeat(80);

  const rawPacket = { t: 'soccer', k: 's', r: 1, seq: 99999999, state: worstCase };
  const rawPacketIsValid = parsePacket(rawPacket) !== null;
  const beforeTrim = structuredClone(worstCase);
  const trimmedWorstCase = trimSnapshot(worstCase);
  assert.deepEqual(worstCase, beforeTrim, 'trimming must not mutate the host world');
  if (rawPacketIsValid) {
    assert.ok(parsePacket({ ...rawPacket, state: trimmedWorstCase }), 'trimmed worst case must remain parseable');
    console.log('Worst-case composite was parse-valid before and after trimming.');
  } else {
    console.log('Worst-case composite was not parse-valid before trimming; skipped trimmed parse assertion.');
  }
  const rawBytes = encoder.encode(frame(worstCase)).byteLength;
  const threeDecimalBytes = encoder.encode(frameAtPrecision(worstCase, 3)).byteLength;
  const twoDecimalBytes = encoder.encode(frameAtPrecision(worstCase, 2)).byteLength;
  const tierThreeBytes = encoder.encode(frame(trimmedWorstCase)).byteLength;
  console.log(`Snapshot worst-case relay bytes: raw=${rawBytes}, 3dp=${threeDecimalBytes}, 2dp=${twoDecimalBytes}, tier-3=${tierThreeBytes}`);
  assert.ok(rawBytes > ROOM_MESSAGE_MAX_BYTES, `raw worst-case frame is only ${rawBytes} bytes`);
  assert.ok(tierThreeBytes <= ROOM_MESSAGE_MAX_BYTES, `tier-3 worst-case frame is ${tierThreeBytes} bytes`);
});

test('trimSnapshot rounds fractions and preserves integers', () => {
  const world = createWorld(71423, 120);
  world.ball.x = 1.23456;
  const snapshot = trimSnapshot(world);
  assert.notEqual(snapshot, world);
  assert.equal(snapshot.ball.x, 1.235);
  assert.equal(world.ball.x, 1.23456);
  assert.equal(snapshot.seed, world.seed);
  assert.equal(snapshot.players[0].id, world.players[0].id);
  assert.deepEqual(snapshot.score, world.score);
});

test('a held-still stick stays fresh through the 30 Hz keepalive despite change-only stick sends', () => {
  const tracker = new InputFreshness();
  tracker.sync(0, [1]);
  let lastSent = { x: 0.6, z: 0 };
  let lastSentAt = 0;
  for (let now = 0; now <= 5000; now += 1) {
    const stick = { x: 0.6, z: 0 };
    if (!sameStick(stick, lastSent) && stickSendDelay(now, lastSentAt) === 0) { lastSent = stick; lastSentAt = now; tracker.record(now, 1); }
    if (now % 33 === 0) { lastSentAt = now; tracker.record(now, 1); }
    assert.deepEqual(tracker.staleSeats(now, [1]), []);
  }
});

test('after a stale reset the reliable copy of an edge packet is applied only once', () => {
  const tracker = new InputFreshness();
  tracker.sync(0, [1]);
  const edge = movePacket(1, 0, 1, { move: { x: 0, z: 0 }, action: 'shoot', pressed: true }, 4);
  assert.equal(tracker.record(2000, 1), true);
  const first = acceptMovePacket(remoteSeat(), undefined, edge, false);
  assert.equal(first.command?.action, 'shoot');
  assert.equal(tracker.record(2001, 1), false);
  assert.equal(acceptMovePacket(first.seat, first.command!, edge, false).command, null);
});
