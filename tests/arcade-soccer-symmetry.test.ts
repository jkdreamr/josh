import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeAI, cpuShotChoice, keeperShotCoverage, LEVEL_NAMES } from '../src/os/arcade/games/soccer/ai.ts';
import { createWorld, FIELD, resolveKeeperContact, separatePlayers, STEP, stepWorld, TEAM_SIZE, type World } from '../src/os/arcade/games/soccer/logic.ts';

const swapId = (id: number) => (id + TEAM_SIZE) % (TEAM_SIZE * 2);
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);

function mirror(world: World) {
  const next = structuredClone(world);
  for (const p of next.players) {
    p.id = swapId(p.id); p.team = p.team === 0 ? 1 : 0;
    p.x = -p.x; p.vx = -p.vx; p.facing = -p.facing;
    if (p.slide) p.slide.x = -p.slide.x;
    if (p.buffer) p.buffer.aim.x = -p.buffer.aim.x;
  }
  next.players.sort((a, b) => a.id - b.id);
  next.ball.x = -next.ball.x; next.ball.vx = -next.ball.vx; next.ball.spin = -next.ball.spin;
  next.lastTouch = next.lastTouch === 0 ? 1 : 0;
  next.restartTeam = next.restartTeam === 0 ? 1 : 0;
  next.restartAt.x = -next.restartAt.x;
  next.score = [next.score[1], next.score[0]];
  next.controlled = [swapId(world.controlled[1]), swapId(world.controlled[0])];
  next.switchAt.reverse(); next.switchWait.reverse(); next.dribbleAt.reverse();
  for (const key of ['carrierId', 'lastToucherId', 'passTarget', 'passFrom', 'stealWinnerId'] as const) {
    const value = next[key];
    if (value != null) next[key] = swapId(value);
  }
  if (next.passPoint) next.passPoint.x = -next.passPoint.x;
  if (next.kickEvent) next.kickEvent.playerId = swapId(next.kickEvent.playerId);
  return next;
}

function fixture() {
  const world = createWorld(47);
  world.phase = 'live'; world.restart = null;
  for (const p of world.players) { p.human = false; p.controlled = false; }
  world.players[6]!.x = 10; world.players[6]!.z = 6;
  world.ball.x = 10.4; world.ball.z = 6;
  world.carrierId = 6; world.lastToucherId = 6; world.lastTouch = 0;
  return world;
}

test('separation is independent of player iteration order, including dense and coincident groups', () => {
  for (const swapped of [false, true]) {
    const players = fixture().players.filter((p) => [1, 2, 3, 12, 13].includes(p.id));
    for (const [i, p] of players.entries()) { p.x = i < 2 ? 0 : i * 0.08; p.z = i < 2 ? 0 : 0.1; }
    for (const ordering of [players, [...players].reverse(), [...players.slice(2), ...players.slice(0, 2)]]) {
      const actual = structuredClone(ordering), expected = structuredClone(players);
      separatePlayers(actual, STEP, undefined, swapped);
      separatePlayers(expected, STEP, undefined, swapped);
      assert.deepEqual(actual.sort((a, b) => a.id - b.id), expected);
    }
  }
});

test('separation mirrors across teams for overlaps, coincidence, boundaries and contain pairs', () => {
  for (const swapped of [false, true]) for (const coincident of [false, true]) {
    const world = fixture(); world.endsSwapped = swapped;
    const ids = [1, 2, 12, 13];
    world.players = world.players.filter((p) => ids.includes(p.id));
    for (const [i, p] of world.players.entries()) { p.x = FIELD.length / 2 - 0.3 - (coincident ? 0 : i * 0.08); p.z = 1; }
    const other = mirror(world);
    separatePlayers(world.players, STEP, world.players[0], swapped);
    separatePlayers(other.players, STEP, other.players.find((p) => p.id === swapId(world.players[0]!.id)), swapped);
    for (const p of world.players) {
      const q = other.players.find((p2) => p2.id === swapId(p.id))!;
      close(p.x, -q.x); close(p.z, q.z);
    }
  }
});

test('AI decisions mirror for corresponding teams, including defensive tracking and corner chasing', () => {
  for (const level of LEVEL_NAMES) for (const swapped of [false, true]) for (const corner of [false, true]) {
    const world = fixture(); world.endsSwapped = swapped;
    if (corner) { world.ball.x = FIELD.length / 2 - 0.2; world.ball.z = FIELD.width / 2 - 0.2; world.carrierId = null; }
    const other = mirror(world);
    for (const tick of [0, 17, 91]) {
      const a = computeAI(world, level, STEP, tick), b = computeAI(other, level, STEP, tick);
      assert.equal(a.size, b.size);
      for (const [id, command] of a) {
        const reflected = b.get(swapId(id))!;
        assert.ok(reflected, `missing reflected command for ${id}`);
        close(command.move.x, -reflected.move.x); close(command.move.z, reflected.move.z);
        assert.equal(command.action, reflected.action); assert.equal(command.pressed, reflected.pressed);
        assert.equal(command.sprint, reflected.sprint);
        close(command.power ?? 0, reflected.power ?? 0);
        if (command.aim) { close(command.aim.x, -reflected.aim!.x); close(command.aim.z, reflected.aim!.z); }
      }
    }
  }
});

test('shot choice and keeper coverage mirror with the attack direction', () => {
  for (const level of LEVEL_NAMES) for (const swapped of [false, true]) {
    const world = fixture(); world.endsSwapped = swapped;
    const player = world.players[6]!;
    player.x = 42; player.z = -2; player.facing = Math.PI / 2;
    world.ball.x = 42.4; world.ball.z = -2;
    const other = mirror(world), otherPlayer = other.players.find((p) => p.id === swapId(player.id))!;
    const a = cpuShotChoice(world, player, level, 37), b = cpuShotChoice(other, otherPlayer, level, 37);
    close(a.targetZ, b.targetZ); close(a.power, b.power); close(a.onTarget, b.onTarget); close(a.probability, b.probability);
    const keeper = world.players.find((p) => p.team === 1 && p.slot === 'GK')!;
    const ca = keeperShotCoverage(world, keeper, 2, 0.4);
    const cb = keeperShotCoverage(other, other.players.find((p) => p.id === swapId(keeper.id))!, 2, 0.4);
    close(ca.z, cb.z); assert.equal(ca.reach, cb.reach);
  }
});

test('nearby keeper claims and fast opponent block deflections mirror', () => {
  for (const claim of [false, true]) {
    const world = fixture();
    for (const p of world.players) { p.x = -25 - p.id * 0.8; p.z = 20; }
    world.carrierId = null;
    const keeper = world.players[TEAM_SIZE]!;
    if (claim) {
      keeper.x = 50; keeper.z = 0;
      world.ball.x = 49.5; world.ball.z = 0; world.ball.vx = 2;
    } else {
      world.ball.x = 0; world.ball.z = 0; world.ball.y = 1; world.ball.grounded = false; world.ball.vx = 30;
      world.players[TEAM_SIZE + 1]!.x = 0.5; world.players[TEAM_SIZE + 1]!.z = 0.1;
    }
    const other = mirror(world);
    if (claim) {
      assert.equal(resolveKeeperContact(world, world.ball.x), true);
      assert.equal(resolveKeeperContact(other, other.ball.x), true);
      assert.equal(other.carrierId, swapId(world.carrierId!));
    } else { stepWorld(world, STEP); stepWorld(other, STEP); }
    close(world.ball.x, -other.ball.x); close(world.ball.vx, -other.ball.vx);
    close(world.ball.z, other.ball.z); close(world.ball.vz, other.ball.vz);
    close(world.ball.y, other.ball.y); close(world.ball.vy, other.ball.vy);
    assert.equal(other.lastTouch, world.lastTouch === 0 ? 1 : 0);
  }
});
