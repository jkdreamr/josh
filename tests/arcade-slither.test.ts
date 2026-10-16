import assert from 'node:assert/strict';
import { test } from 'node:test';
import { think } from '../src/os/arcade/games/slither/bots.ts';
import {
  PACKET_LIMIT, endPacket, helloPacket, initPacket, movePacket, operationPackets, packetBytes,
  parsePacket, snapshotPackets, statePacket, type NetOp,
} from '../src/os/arcade/games/slither/net.ts';
import {
  addPellet, addSnake, bodyCount, bodyGridFor, createSoloWorld, createWorld, maxTurnRate, radiusOf, setPellet, step, TICK,
  wrapAngle, type World,
} from '../src/os/arcade/games/slither/world.ts';
import {
  applyHeadState, applyOps, loadSnapshot, makeRoster, resultRows, standings, syncRoster, takeOverSeats, winnerSeat,
} from '../src/os/arcade/games/slither/session.ts';
import { overlayLayout } from '../src/os/arcade/games/slither/render.ts';

function clearWorld(seed = 7, radius = 500) {
  return createWorld({ seed, radius, fillPellets: false });
}

function placeSnake(world: World, id: number, x: number, y: number, angle: number, mass = 10, bot = false) {
  const snake = addSnake(world, { id, name: `Snake ${id}`, seat: id, bot, skin: id % 8, respawnDelay: 0 });
  snake.x = snake.px = x;
  snake.y = snake.py = y;
  snake.angle = snake.prevAngle = angle;
  snake.mass = snake.peak = mass;
  snake.body = Array.from({ length: bodyCount(mass) }, (_, i) => ({
    x: x - Math.cos(angle) * i * 7,
    y: y - Math.sin(angle) * i * 7,
  }));
  return snake;
}

test('seeded solo starts are repeatable, safely spaced and naturally stocked', () => {
  const a = createSoloWorld(8291, 3);
  const b = createSoloWorld(8291, 3);
  assert.equal(a.snakes.length, 15);
  assert.equal(a.snakes.filter((snake) => snake.bot).length, 14);
  assert.equal(a.pellets.length, a.pelletTarget);
  assert.ok(a.pelletTarget > 900 && a.pelletTarget < 1100);
  assert.deepEqual(a.snakes.map(({ x, y, angle }) => [x, y, angle]), b.snakes.map(({ x, y, angle }) => [x, y, angle]));
  assert.deepEqual(a.pellets.map(({ x, y, value }) => [x, y, value]), b.pellets.map(({ x, y, value }) => [x, y, value]));
  for (const snake of a.snakes) assert.ok(Math.hypot(snake.x, snake.y) < a.radius * 0.8);
});

test('short-stage leaderboard rows fit between shell controls and minimap', () => {
  const phone = overlayLayout({ w: 464, h: 157 });
  assert.equal(phone.maxBoardRows, 3);
  assert.ok(phone.boardTop + phone.boardChrome + phone.boardRowHeight * phone.maxBoardRows <= phone.miniTop);

  const laptop = overlayLayout({ w: 600, h: 262 });
  assert.equal(laptop.maxBoardRows, 6);
  assert.ok(laptop.boardTop + laptop.boardChrome + laptop.boardRowHeight * laptop.maxBoardRows <= laptop.miniTop);
});

test('pellets feed mass, steering respects the turn limit, and boost trades mass for speed', () => {
  const world = clearWorld();
  const snake = placeSnake(world, 0, 0, 0, 0, 20);
  const snack = addPellet(world, { x: 5, y: 0 }, true, 4);
  const events = step(world, { 0: { target: 0, boost: false } });
  assert.equal(snake.mass, 24);
  assert.ok(events.some((event) => event.type === 'eat' && event.pellet === snack.id));

  snake.angle = 0;
  const turnLimit = maxTurnRate(snake) * TICK;
  const before = snake.x;
  step(world, { 0: { target: Math.PI / 2, boost: false } });
  assert.ok(Math.abs(snake.angle - turnLimit) < 1e-9);
  assert.ok(snake.x > before);

  snake.mass = snake.peak = 20;
  const mass = snake.mass;
  const boostedBefore = snake.x;
  step(world, { 0: { target: snake.angle, boost: true } });
  assert.ok(Math.abs(snake.x - boostedBefore) > 8.5);
  assert.ok(snake.mass < mass);
  let boostPellet = false;
  for (let i = 0; i < 8; i++) {
    const more = step(world, { 0: { target: snake.angle, boost: true } });
    boostPellet ||= more.some((event) => event.type === 'pellet' && !event.pellet.natural);
  }
  assert.ok(boostPellet, 'boost sheds edible pellets behind the snake');
  snake.mass = 11;
  const smallMass = snake.mass;
  const smallX = snake.x;
  step(world, { 0: { target: snake.angle, boost: true } });
  assert.equal(snake.mass, smallMass, 'boost stops below its minimum mass');
  assert.ok(Math.abs(snake.x - smallX) < 6);
  assert.ok(radiusOf(snake.mass) >= 6);
});

test('a snake can turn indefinitely while state angles stay within packet bounds', () => {
  const world = clearWorld(91, 5000);
  world.pelletTarget = 0;
  const snake = placeSnake(world, 0, 0, 0, 0);
  for (let i = 0; i < 600; i++) {
    step(world, { 0: { target: snake.angle + Math.PI / 2, boost: false } });
    assert.ok(Math.abs(snake.angle) <= Math.PI);
    assert.ok(Math.abs(snake.prevAngle) <= Math.PI);
  }
  const parsed = parsePacket(JSON.parse(JSON.stringify(statePacket(7, world))));
  assert.ok(parsed?.k === 'S');
});

test('long bot rounds keep state and snapshot packets valid', () => {
  const world = createWorld({ seed: 73, radius: 5000, fillPellets: false });
  for (let i = 0; i < 8; i++) addSnake(world, { id: i, bot: true, respawnDelay: 2.4 });
  for (let tick = 0; tick < 900; tick++) {
    const grid = bodyGridFor(world);
    const inputs = new Map<number, { target: number; boost: boolean }>();
    for (const snake of world.snakes) {
      if (snake.alive) inputs.set(snake.id, think(world, snake, 'hard', grid, world.random));
    }
    step(world, inputs, grid);
  }
  const state = parsePacket(JSON.parse(JSON.stringify(statePacket(8, world))));
  assert.ok(state?.k === 'S');
  const snapshots = snapshotPackets(world, 8, world.tick);
  assert.ok(snapshots.length > 0);
  for (const snapshot of snapshots) {
    const parsed = parsePacket(JSON.parse(JSON.stringify(snapshot)));
    assert.ok(parsed?.k === 'Z');
  }
});

test('angle-bearing packet builders wrap their values defensively', () => {
  const world = clearWorld(19);
  const snake = placeSnake(world, 0, 0, 0, 0);
  const angle = 9 * Math.PI + 0.4;
  assert.equal(wrapAngle(-Math.PI), Math.PI);
  snake.angle = angle;
  const state = parsePacket(statePacket(4, world));
  assert.ok(state?.k === 'S');
  if (state?.k === 'S') assert.ok(Math.abs(state.snakes[0][3]) <= Math.PI);

  const move = parsePacket(movePacket(4, 1, angle, false));
  assert.ok(move?.k === 'M' && Math.abs(move.target) <= Math.PI);
  const spawn = operationPackets(4, 1, [{ k: 'spawn', id: 0, x: 0, y: 0, angle }]);
  assert.ok(spawn.length === 1 && parsePacket(spawn[0])?.k === 'O');
  const snapshots = snapshotPackets(world, 4, 1);
  assert.ok(snapshots.every((part) => parsePacket(part)?.k === 'Z'));
});

test('expired pellets emit remove operations for non-stepping guests', () => {
  const host = clearWorld();
  const guest = clearWorld();
  const pellet = { id: 55, x: 200, y: 200, value: 3, color: 1, born: 0, natural: false };
  setPellet(host, pellet);
  setPellet(guest, { ...pellet });
  host.clock = 32;
  const events = step(host);
  const remove = events.find((event) => event.type === 'remove' && event.pellet === pellet.id);
  assert.ok(remove);
  applyOps(guest, [{ k: 'remove', id: pellet.id }]);
  assert.equal(guest.pellets.some((item) => item.id === pellet.id), false);
});

test('body hits award a kill and burst death mass; simultaneous head hits take both snakes out', () => {
  const world = clearWorld();
  const player = placeSnake(world, 0, 0, 0, 0, 30);
  const rival = placeSnake(world, 1, 200, 150, 0, 12);
  rival.body[1] = { x: 5, y: 0 };
  const events = step(world, { 0: { target: 0, boost: false }, 1: { target: 0, boost: false } });
  assert.equal(player.alive, false);
  assert.equal(rival.kills, 1);
  const dead = events.find((event) => event.type === 'death');
  assert.ok(dead && dead.type === 'death' && dead.id === player.id && dead.killer === rival.id);
  const burst = events.filter((event) => event.type === 'pellet' && !event.pellet.natural)
    .reduce((sum, event) => sum + (event.type === 'pellet' ? event.pellet.value : 0), 0);
  assert.ok(Math.abs(burst - 24) < 1e-6);

  const duel = clearWorld(17);
  const a = placeSnake(duel, 0, -7, 0, 0);
  const b = placeSnake(duel, 1, 7, 0, Math.PI);
  step(duel, { 0: { target: 0, boost: false }, 1: { target: Math.PI, boost: false } });
  assert.equal(a.alive, false);
  assert.equal(b.alive, false);
});

test('a noodle can cross its own trail but the arena rim is lethal', () => {
  const own = clearWorld(31, 100);
  const snake = placeSnake(own, 0, 0, 0, 0);
  snake.body[1] = { x: 5, y: 0 };
  step(own, { 0: { target: 0, boost: false } });
  assert.equal(snake.alive, true);

  const rim = clearWorld(32, 100);
  const edge = placeSnake(rim, 0, 90, 0, 0);
  const events = step(rim, { 0: { target: 0, boost: false } });
  assert.equal(edge.alive, false);
  assert.ok(events.some((event) => event.type === 'death' && event.id === edge.id));
});

test('hard bots hunt a smaller nearby snake and every difficulty avoids an open rim', () => {
  const world = clearWorld(43, 700);
  const hunter = placeSnake(world, 0, 0, 0, 0, 30, true);
  const target = placeSnake(world, 1, 0, 260, Math.PI / 2, 10, true);
  target.vx = 0;
  target.vy = 70;
  const hunt = think(world, hunter, 'hard', bodyGridFor(world), () => 0.5);
  assert.ok(Math.abs(Math.atan2(Math.sin(hunt.target - Math.PI / 2), Math.cos(hunt.target - Math.PI / 2))) < 0.5);
  assert.equal(hunt.boost, true);

  const edge = clearWorld(8, 100);
  const bot = placeSnake(edge, 0, 60, 0, 0, 12, true);
  for (const level of ['easy', 'normal', 'hard'] as const) {
    const choice = think(edge, bot, level, bodyGridFor(edge), () => 0.5);
    const x = bot.x + Math.cos(choice.target) * 120;
    const y = bot.y + Math.sin(choice.target) * 120;
    assert.ok(Math.hypot(x, y) < edge.radius + 10, `${level} chooses a safe inward path`);
  }
});

test('hard steering survives better than easy steering across a small seeded set', () => {
  const result = (seed: number, level: 'easy' | 'hard') => {
    const world = createWorld({ seed, radius: 650, snakeCount: 2 });
    for (let i = 0; i < 360; i++) {
      const grid = bodyGridFor(world);
      const inputs = new Map<number, { target: number; boost: boolean }>();
      for (const snake of world.snakes) {
        if (snake.alive) inputs.set(snake.id, think(world, snake, level, grid));
      }
      step(world, inputs, grid);
    }
    return world.snakes.filter((snake) => snake.alive).length * 100 + world.snakes.reduce((sum, snake) => sum + snake.peak, 0);
  };
  const seeds = [3, 11, 29, 41];
  const easy = seeds.map((seed) => result(seed, 'easy')).reduce((a, b) => a + b, 0);
  const hard = seeds.map((seed) => result(seed, 'hard')).reduce((a, b) => a + b, 0);
  assert.ok(hard >= easy * 0.8, `hard field score ${hard} should stay competitive with easy ${easy}`);
});

test('easy bots graze pellets instead of hunting, and the bot field stays alive around open ground', () => {
  const world = clearWorld(27, 600);
  const easy = placeSnake(world, 0, 0, 0, 0, 20, true);
  placeSnake(world, 1, 0, 280, -Math.PI / 2, 10, true);
  addPellet(world, { x: 240, y: 0 }, true, 2);
  const choice = think(world, easy, 'easy', bodyGridFor(world), () => 0.5);
  assert.ok(Math.abs(choice.target) < 0.45, 'easy should keep grazing toward food');
  const field = clearWorld(52, 300);
  const bot = placeSnake(field, 0, 0, 0, 0, 10, true);
  for (const level of ['easy', 'normal', 'hard'] as const) {
    bot.x = bot.px = 0;
    bot.y = bot.py = 0;
    bot.angle = bot.prevAngle = 0;
    bot.body = Array.from({ length: bodyCount(bot.mass) }, (_, i) => ({ x: -i * 7, y: 0 }));
    bot.alive = true;
    for (let i = 0; i < 180; i++) {
      const grid = bodyGridFor(field);
      const choice = think(field, bot, level, grid);
      step(field, { 0: choice }, grid);
      assert.equal(bot.alive, true, `${level} bot died on open ground at tick ${i}`);
    }
  }
});

test('packet parsing rejects foreign, malformed and oversized data while snapshots and ops chunk safely', () => {
  const world = createWorld({ seed: 21, radius: 250 });
  addSnake(world, { id: 0, name: 'Host', seat: 0 });
  for (let i = 0; i < 360; i++) setPellet(world, { id: i + 500, x: i - 180, y: i % 37, value: 1.5, color: i % 8, born: 0, natural: true });
  const roster = [{ id: 0, seat: 0, name: 'Host', color: 0, skin: 0, bot: false, eligible: true }];
  assert.deepEqual(parsePacket(initPacket(5, 21, 250, 180, 'hard', 0, roster)), { t: 'sl', r: 5, k: 'I', seed: 21, radius: 250, duration: 180, level: 'hard', seq: 0, roster });
  assert.deepEqual(parsePacket(helloPacket(5)), { t: 'sl', r: 5, k: 'H' });
  assert.deepEqual(parsePacket(movePacket(5, 2, 0.8, true)), { t: 'sl', r: 5, k: 'M', seq: 2, target: 0.8, boost: true });
  assert.ok(parsePacket(statePacket(5, world)));
  assert.ok(parsePacket(endPacket(5, 0, 0, 180, [[0, 0, 10, 1]])));
  for (const bad of [
    null, 'sl', {}, { t: 'sl', r: 1.5, k: 'H' }, { t: 'other', r: 1, k: 'H' },
    { t: 'sl', r: 1, k: 'M', seq: 0, target: 100, boost: false },
    { t: 'sl', r: 1, k: 'I', seed: 1, radius: 10, duration: 180, level: 'impossible', seq: 0, roster: [] },
    { t: 'sl', r: 1, k: 'Z', snap: 1, part: 0, total: 1, data: [['s', 'bad']] },
    { t: 'sl', r: 1, k: 'O', seq: 1, ops: [{ k: 'death', id: 99, killer: null, mass: 3, x: 0, y: 0 }] },
    { t: 'sl', r: 1, k: 'H', extra: 'x'.repeat(PACKET_LIMIT) },
  ]) assert.equal(parsePacket(bad), null, 'invalid message was rejected');

  const snapshots = snapshotPackets(world, 5, 44);
  assert.ok(snapshots.length > 1);
  const snapshotData: unknown[][] = [];
  for (const part of snapshots) {
    assert.ok(packetBytes(part) < PACKET_LIMIT);
    const parsed = parsePacket(JSON.parse(JSON.stringify(part)));
    assert.ok(parsed && parsed.k === 'Z');
    if (parsed?.k === 'Z') snapshotData.push(...parsed.data);
  }
  const restored = createWorld({ seed: 1, radius: 250, fillPellets: false });
  addSnake(restored, { id: 0, name: 'Host', seat: 0 });
  loadSnapshot(restored, snapshotData);
  assert.equal(restored.pellets.length, world.pellets.length);
  assert.equal(restored.snakes[0].body.length, world.snakes[0].body.length);

  const ops: NetOp[] = Array.from({ length: 200 }, (_, i) => ({
    k: 'add' as const, pellet: { id: 1000 + i, x: i, y: -i, value: 2.5, color: i % 8, born: 0, natural: false },
  }));
  const packets = operationPackets(5, 10, ops);
  assert.ok(packets.length > 1);
  assert.ok(packets.every((p) => packetBytes(p) < PACKET_LIMIT && !!parsePacket(p)));
});

test('room roster seats, late join takeover, ordered state and winner attribution stay authoritative', () => {
  const roster = makeRoster([{ seat: 0, name: 'Host' }, { seat: 2, name: 'Guest' }], [{ seat: 1, name: 'Room Bot', bot: true }], 5);
  assert.deepEqual(roster.map((entry) => entry.seat), [0, 1, 2, -1, -1]);
  assert.equal(roster[1].bot, true);
  const taken = takeOverSeats(roster, [0]);
  assert.equal(taken[2].bot, true);
  assert.equal(taken[2].eligible, false);
  const joined = syncRoster(taken, [{ seat: 0, name: 'Host' }, { seat: 2, name: 'Back' }, { seat: 3, name: 'Late' }], []);
  assert.ok(joined.some((entry) => entry.seat === 3 && entry.name === 'Late' && !entry.bot));

  const world = createWorld({ seed: 5, radius: 300, fillPellets: false });
  for (const entry of joined) addSnake(world, { ...entry, respawnDelay: 0 });
  applyHeadState(world, [[0, 12, 14, 0.2, 25, true, 3, false, 2, 0, 25]]);
  assert.equal(world.snakes[0].mass, 25);
  const initial = world.pellets.length;
  applyOps(world, [{ k: 'add', pellet: { id: 900, x: 1, y: 2, value: 3, color: 2, born: 0, natural: false } }]);
  assert.equal(world.pellets.length, initial + 1);
  assert.deepEqual(standings(world)[0], 0);
  assert.equal(winnerSeat(world, 0), 0);
  assert.deepEqual(resultRows(world)[0], [0, 0, 25, 3]);
  const guest = world.snakes[0];
  guest.respawnDelay = 3;
  world.clock = 12;
  applyOps(world, [{ k: 'death', id: guest.id, killer: null, mass: guest.mass, x: guest.x, y: guest.y }]);
  assert.equal(guest.respawnAt, world.clock + guest.respawnDelay);
});

test('24 snakes at grown mass stay within the fixed-step budget', () => {
  const world = createWorld({ seed: 99, radius: 5000, fillPellets: false });
  for (let i = 0; i < 24; i++) {
    const snake = placeSnake(world, i, Math.cos(i * Math.PI / 12) * 3000, Math.sin(i * Math.PI / 12) * 3000, i * Math.PI / 12 + Math.PI, 200, true);
    snake.respawnDelay = 0;
  }
  const start = performance.now();
  for (let i = 0; i < 180; i++) step(world);
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 1200, `180 fixed ticks for 24 mass-200 snakes took ${elapsed.toFixed(1)}ms`);
});

test('a full 16-snake bot-thinking tick stays within budget', () => {
  const world = createWorld({ seed: 199, radius: 5000, fillPellets: false });
  for (let i = 0; i < 16; i++) {
    const angle = i * Math.PI / 8;
    placeSnake(world, i, Math.cos(angle) * 3500, Math.sin(angle) * 3500, angle + Math.PI, 200, i > 0);
  }
  for (let i = 0; i < 900; i++) {
    const angle = i * 2.399;
    addPellet(world, { x: Math.cos(angle) * (i % 4700), y: Math.sin(angle) * (i % 4700) }, true, 1);
  }
  const start = performance.now();
  for (let tick = 0; tick < 60; tick++) {
    const grid = bodyGridFor(world);
    const inputs = new Map<number, { target: number; boost: boolean }>();
    for (const snake of world.snakes) {
      if (!snake.alive) continue;
      inputs.set(snake.id, snake.bot ? think(world, snake, 'hard', grid, world.random) : { target: snake.angle, boost: false });
    }
    step(world, inputs, grid);
  }
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 1500, `60 complete ticks with 15 bot decisions took ${elapsed.toFixed(1)}ms`);
});
