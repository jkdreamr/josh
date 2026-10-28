import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeAI } from '../src/os/arcade/games/soccer/ai.ts';
import { phoneControlledPlayer, reconcileControllers, syncControllerSeats, type ControlCommand } from '../src/os/arcade/games/soccer/input.ts';
import { createWorld, nearestCarrier, restartTaker, setRestart, STEP, stepWorld } from '../src/os/arcade/games/soccer/logic.ts';
import { acceptMovePacket, consumeCommand, InputFreshness, movePacket, neutralCommand, type RemoteSeat } from '../src/os/arcade/games/soccer/net.ts';
import { assignControllers } from '../src/os/arcade/games/soccer/seats.ts';
import { phoneStoppagePrompt } from '../src/os/arcade/games/soccer/setpieces.ts';
import { onFoul } from '../src/os/arcade/games/soccer/rules.ts';

test('phone stoppage prompts cover phases and slides but not unrestricted live play', () => {
  const world = createWorld();
  stepWorld(world, STEP);
  const taker = restartTaker(world);
  assert.equal(taker.human, true);
  assert.equal(phoneStoppagePrompt(world, taker.id), 'Kick off · aim with stick, press A to pass');
  const teammate = world.players.find((player) => player.team === taker.team && player.id !== taker.id)!;
  assert.equal(phoneStoppagePrompt(world, teammate.id), 'Kick off · waiting for the taker');

  const cpuWorld = createWorld();
  for (const player of cpuWorld.players.filter((player) => player.team === cpuWorld.restartTeam)) player.human = false;
  const cpuPlayer = cpuWorld.players.find((player) => player.team === cpuWorld.restartTeam)!;
  assert.equal(phoneStoppagePrompt(cpuWorld, cpuPlayer.id), 'kick off · move the stick or press to take');

  for (const phase of ['goal', 'half-time', 'full-time'] as const) {
    world.phase = phase;
    world.event = '';
    assert.equal(phoneStoppagePrompt(world, 6), phase);
  }
  world.phase = 'live';
  assert.equal(phoneStoppagePrompt(world, 6), null);
  assert.equal(phoneStoppagePrompt(world, 999), null);
});

const seeds = process.env.SOCCER_SOAK === '1'
  ? Array.from({ length: 20 }, (_, i) => 71423 + i * 7919)
  : [71423, 1234, 98765];

test('a mid-match human red card hands off control, prompts the free kick and restores stick response', () => {
  const world = createWorld(98765);
  const preferred = assignControllers([{ seat: 1, role: 'phone', side: 0 }], 'cpu', 'online');
  let assignments = new Map(preferred);
  const remote = new Map<number, ControlCommand>([[6, { move: { x: 1, z: 0 } }]]);
  let tick = 0;
  const step = () => {
    const commands = computeAI(world, 'normal', STEP, tick++);
    for (const [id, command] of remote) {
      commands.set(id, { ...command });
      remote.set(id, consumeCommand(command));
    }
    stepWorld(world, STEP, commands, 20);
    const next = reconcileControllers(world, assignments);
    for (const [seat, id] of next) {
      const old = assignments.get(seat)!;
      if (id === old) continue;
      const held = remote.get(old);
      remote.delete(old);
      if (held) remote.set(id, held);
    }
    assignments = syncControllerSeats(world, next, preferred);
  };
  while ((world.half !== 2 || world.phase !== 'live') && tick < 2400) step();
  assert.equal(world.half, 2);
  assert.equal(world.phase, 'live');
  const offender = world.players[assignments.get(1)!]!;
  const victim = world.players[17]!;
  Object.assign(victim, { x: 0, z: 0, facing: Math.PI / 2, vx: 0, vz: 0 });
  Object.assign(offender, { x: -0.8, z: 0, vx: 8, vz: 0 });
  Object.assign(world.ball, { x: victim.x, z: victim.z, y: 0.11 });
  const fouls = world.rules!.stats.fouls[0];
  assert.equal(onFoul(world, offender, victim, 'slide', false), 'stop');
  setRestart(world, victim.team, 'free-kick', victim);
  assert.equal(world.rules!.stats.fouls[0], fouls + 1);
  assert.equal(world.rules!.stats.reds[0], 1);
  assert.equal(offender.sentOff, true);
  step();
  const replacement = world.players[assignments.get(1)!]!;
  assert.notEqual(replacement.id, offender.id);
  assert.equal(replacement.team, offender.team);
  assert.equal(replacement.human && replacement.controlled && !replacement.sentOff, true);
  assert.equal(world.controlled[0], replacement.id);
  assert.equal(remote.has(offender.id), false);
  assert.ok(remote.has(replacement.id));
  assert.equal(world.setPiece?.kind, 'free-kick');
  assert.match(phoneStoppagePrompt(world, replacement.id)!, /FREE-KICK/);
  for (let wait = 0; world.phase !== 'live' && wait < 1500; wait++) {
    assert.ok(phoneStoppagePrompt(world, phoneControlledPlayer(world, 6)));
    step();
  }
  assert.equal(world.phase, 'live');
  let responded = false;
  for (let response = 0; response < 6; response++) {
    const player = world.players[assignments.get(1)!]!;
    const before = { vx: player.vx, facing: player.facing };
    remote.set(player.id, { move: { x: 1, z: 0 } });
    step();
    responded ||= player.vx > 0.2 || player.vx - before.vx > 1e-5
      || Math.sin(player.facing) - Math.sin(before.facing) > 1e-5;
    assert.equal(!!player.sentOff, false);
    assert.equal(world.players.filter((p) => p.human || p.controlled).length, 1);
  }
  assert.ok(responded, 'replacement responds to the stick within six steps');
});

for (const seed of seeds) test(`full-match phone pipeline soak seed ${seed}`, () => {
  const started = performance.now();
  const world = createWorld(seed);
  assert.ok(world.rules);
  const preferred = assignControllers([{ seat: 1, role: 'phone', side: 0 }], 'cpu', 'online');
  let assignments = new Map(preferred);
  const remote = new Map<number, ControlCommand>();
  const freshness = new InputFreshness();
  let state: RemoteSeat = { seq: -1, edge: -1, held: null, pressUsed: false };
  let randomState = seed;
  const random = () => ((randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  let direction = { x: 1, z: 0 };
  let nextDirection = 0;
  let seq = 0, edge = 0, simTicks = 0, pausedTicks = 0, lossTicks = 0;
  let blackout = -1, resumed = false, resumeResponses = 0, resumeWindow = 0;
  let previousId = 6, previousDirection = direction, unresponsive = 0, stopped = 0;
  let maxStopped = 0, transfers = 0, halfTime = false, restarts = 0;
  let plantingTicks = 0, maxPlantingTicks = 0;
  const violations = new Map<string, unknown>();
  const record = (kind: string, detail: unknown) => {
    if (!violations.has(kind)) violations.set(kind, { seed, simSeconds: simTicks * STEP, ...Object(detail) });
  };
  for (let tick = 0; tick < 60 * 900 && world.phase !== 'full-time'; tick++) {
    const now = tick * STEP * 1000;
    freshness.sync(now, [1]);
    const id = assignments.get(1)!;
    if (world.half === 2 && world.clock < world.halfLength - 15 && world.phase === 'live' && blackout < 0) blackout = tick;
    const blackedOut = blackout >= 0 && tick >= blackout && tick < blackout + 180;
    const shortLoss = tick % 1200 >= 400 && tick % 1200 < 448;
    if (tick >= nextDirection) {
      const angle = random() * Math.PI * 2;
      direction = { x: Math.sin(angle), z: Math.cos(angle) };
      nextDirection = tick + 30 + Math.floor(random() * 91);
    }
    if (tick % 2 === 0 && !blackedOut && !shortLoss) {
      if (freshness.record(now, 1)) {
        state = { seq: -1, edge: -1, held: null, pressUsed: false };
        remote.set(id, neutralCommand());
      }
      const action = tick % 180 === 0 ? (['pass', 'shoot', 'through'] as const)[Math.floor(random() * 3)] : null;
      const switching = tick % 420 === 0;
      if (action || switching) edge++;
      const packet = movePacket(1, seq++, 1, {
        move: direction, aim: direction, sprint: tick % 300 < 80,
        action, pressed: !!action, heldAction: null, power: 0.65, switchNearest: switching,
      }, edge);
      const accepted = acceptMovePacket(state, remote.get(id), packet, nearestCarrier(world)?.team === 1);
      state = accepted.seat;
      if (accepted.command) remote.set(id, accepted.command);
    } else if (shortLoss && !blackedOut) lossTicks++;
    if (freshness.staleSeats(now, [1]).length) {
      remote.set(id, neutralCommand());
      state = { seq: -1, edge: -1, held: null, pressUsed: false };
      assert.deepEqual(remote.get(id)!.move, { x: 0, z: 0 });
      assert.equal(remote.get(id)!.heldAction, null);
      pausedTicks++;
      unresponsive = 0;
      continue;
    }
    if (blackout >= 0 && tick >= blackout + 180 && !resumed) {
      resumed = true;
      unresponsive = 0;
    }
    const commands = computeAI(world, 'normal', STEP, simTicks);
    for (const [playerId, command] of remote) {
      commands.set(playerId, { ...command });
      remote.set(playerId, consumeCommand(command));
    }
    const player = world.players[id]!;
    const command = commands.get(id);
    const before = { vx: player.vx, vz: player.vz, facing: player.facing, planting: player.planting };
    const ownershipBefore = { controlled: world.controlled[0], humans: world.players.filter((p) => p.human).map((p) => p.id), passFrom: world.passFrom, passTarget: world.passTarget, passControl: world.passControl, phase: world.phase };
    const eligible = world.phase === 'live' && !player.slide && !world.setPiece && !!command && Math.hypot(command.move.x, command.move.z) > 0.15;
    if (world.phase !== 'live') {
      assert.ok(phoneStoppagePrompt(world, phoneControlledPlayer(world, 6)), `missing prompt seed=${seed} tick=${tick}`);
      stopped++;
      maxStopped = Math.max(maxStopped, stopped);
      if (stopped * STEP > 25) record('stoppage exceeds 25 seconds', { phase: world.phase, restart: world.restart, stopped });
    } else stopped = 0;
    if (player.slide) assert.ok(phoneStoppagePrompt(world, id));
    const previousPhase = world.phase;
    stepWorld(world, STEP, commands);
    simTicks++;
    if (world.phase === 'half-time') halfTime = true;
    if (world.phase === 'restart' && previousPhase !== 'restart') restarts++;
    const reconciled = reconcileControllers(world, assignments);
    for (const [seat, nextId] of reconciled) {
      const old = assignments.get(seat);
      if (old === undefined || old === nextId) continue;
      transfers++;
      const held = remote.get(old);
      remote.delete(old);
      if (held) remote.set(nextId, held);
    }
    assignments = syncControllerSeats(world, reconciled, preferred);
    const nextId = assignments.get(1)!;
    const current = world.players[nextId]!;
    assert.equal(!!current.sentOff, false, `sent-off controller seed=${seed}`);
    assert.equal(current.team, 0);
    assert.equal(current.human && current.controlled, true);
    const humans = world.players.filter((p) => p.team === 0 && (p.human || p.controlled)).map((p) => p.id);
    if (humans.length !== 1 || humans[0] !== nextId) record('seat does not own exactly one human', { ownershipBefore, humans, nextId, controlled: world.controlled[0] });
    for (const p of world.players) if (p.human && !remote.has(p.id) && !violations.has('orphan human without command')) {
      const nextAI = computeAI(structuredClone(world), 'normal', STEP, simTicks);
      record('orphan human without command', { ownershipBefore, orphanId: p.id, nextId, aiExcluded: !nextAI.has(p.id), phase: world.phase });
    }
    if (current.slot === 'GK' && world.phase !== 'live') assert.ok(phoneStoppagePrompt(world, nextId));
    const sameDirection = previousDirection.x === command?.move.x && previousDirection.z === command?.move.z;
    const projection = command ? player.vx * command.move.x + player.vz * command.move.z : 0;
    const previousProjection = command ? before.vx * command.move.x + before.vz * command.move.z : 0;
    const facingProjection = (angle: number) => command ? Math.sin(angle) * command.move.x + Math.cos(angle) * command.move.z : 0;
    const responded = !!command && (projection > 0.2 || projection - previousProjection > 1e-5
      || facingProjection(player.facing) - facingProjection(before.facing) > 1e-5);
    if (process.env.SOCCER_PLANT_TRACE === '1' && seed === 98765 && simTicks >= 292 && simTicks <= 330) {
      console.log(JSON.stringify({ plantingTrace: { step: simTicks, time: simTicks * STEP, id, move: command?.move, before, after: { vx: player.vx, vz: player.vz, planting: player.planting }, projectionChange: projection - previousProjection, responded } }));
    }
    if (eligible && world.phase === 'live' && !player.slide && nextId === id) {
      if (player.planting || before.planting) {
        plantingTicks = previousId === id ? plantingTicks + 1 : 1;
        maxPlantingTicks = Math.max(maxPlantingTicks, plantingTicks);
        assert.ok(plantingTicks * STEP <= 0.5, `planting exceeds 0.5s seed=${seed} id=${id} steps=${plantingTicks}`);
      }
      if (!player.planting) plantingTicks = 0;
    } else plantingTicks = 0;
    if (eligible && world.phase === 'live' && !player.slide && !player.planting && nextId === id && previousId === id && sameDirection) {
      unresponsive = responded ? 0 : unresponsive + 1;
      if (resumed && resumeWindow < 6) {
        resumeWindow++;
        if (responded) resumeResponses++;
        if (resumeWindow === 6 && resumeResponses === 0) record('resume unresponsive for 100ms', { id, before, move: command!.move });
      }
      if (unresponsive >= 6) record('stick unresponsive for 100ms', { id, move: command!.move, before, after: { vx: player.vx, vz: player.vz, planting: player.planting }, unresponsive });
    } else unresponsive = 0;
    previousId = nextId;
    previousDirection = command?.move ?? direction;
  }
  assert.equal(world.phase, 'full-time', `match failed to finish seed=${seed}`);
  assert.ok(halfTime, 'half-time was exercised');
  assert.ok(transfers > 0, 'control transfer was exercised');
  assert.ok(lossTicks > 0, 'short loss bursts were exercised');
  assert.ok(pausedTicks > 0 && resumed, 'blackout paused and resumed the host');
  assert.ok(resumeResponses > 0, 'resumed controller responded');
  console.log(JSON.stringify({ seed, seconds: simTicks * STEP, wallSeconds: (performance.now() - started) / 1000, transfers, restarts, maxStoppageSeconds: maxStopped * STEP, maxPlantingSeconds: maxPlantingTicks * STEP, pausedTicks, rules: world.rules!.stats, violations: [...violations] }));
  assert.deepEqual([...violations], [], 'soak violations (first evidence per category)');
});
