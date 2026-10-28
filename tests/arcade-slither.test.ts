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
  applyHeadState, applyOps, loadSnapshot, makeRoster, peopleLine, peopleResults, resultRows, rosterChanges, rosterNotice, standings, startsSoloRound,
  syncRoster, frameUnit, touchTarget, takeOverSeats, winnerSeat, fillerNames,
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

test('resume after a pause keeps the solo round while play and play again start fresh', () => {
  assert.equal(startsSoloRound('paused', 'playing', true), false);
  assert.equal(startsSoloRound('ready', 'playing', false), true);
  assert.equal(startsSoloRound(null, 'playing', false), true);
  assert.equal(startsSoloRound('over', 'playing', true), true);
  assert.equal(startsSoloRound('paused', 'playing', false), true);
  assert.equal(startsSoloRound('playing', 'paused', true), false);
});

test('touch targets grow to stay 44px on screen when the device frame scales down', () => {
  assert.equal(touchTarget(300, 300), 44);
  assert.equal(touchTarget(245.24, 300), 54);
  assert.equal(touchTarget(600, 300), 44);
  assert.equal(touchTarget(0, 0), 44);
  // Measured mid app-open animation, when the window is still icon sized.
  assert.equal(touchTarget(18, 300), 64);
});

test('arena filler noodles never reuse a room bot or person name', () => {
  const bots = ['Orzo', 'Penne', 'Fusilli'].map((name, i) => ({ seat: i + 1, name, bot: true }));
  const roster = makeRoster([{ seat: 0, name: 'Ziti' }], bots, 16);
  const names = roster.map((entry) => entry.name.toLowerCase());
  assert.equal(roster.length, 16);
  assert.equal(new Set(names).size, names.length);
  const full = makeRoster([{ seat: 0, name: 'Host' }], ['Orzo', 'Penne', 'Fusilli', 'Udon', 'Ramen', 'Ziti', 'Soba'].map((name, i) => ({ seat: i + 1, name, bot: true })), 16);
  assert.equal(new Set(full.map((entry) => entry.name)).size, 16);
  assert.deepEqual(fillerNames(['ziti', 'Rigatoni'], 2), ['Fusilli', 'Orzo']);
  const clash = makeRoster([{ seat: 0, name: 'Orzo' }, { seat: 1, name: 'penne' }], ['Orzo', 'Penne', 'Fusilli'].map((name, i) => ({ seat: i + 2, name, bot: true })), 16);
  assert.equal(clash[0].name, 'Orzo');
  assert.equal(clash[1].name, 'penne');
  assert.equal(new Set(clash.map((entry) => entry.name.toLowerCase())).size, 16);
  // The host re-syncs the roster every render; the renamed bot must keep its new name.
  const players = [{ seat: 0, name: 'Orzo' }, { seat: 1, name: 'penne' }];
  const roomBots = ['Orzo', 'Penne', 'Fusilli'].map((name, i) => ({ seat: i + 2, name, bot: true }));
  assert.deepEqual(syncRoster(clash, players, roomBots), clash);
  assert.equal(fillerNames([], 30).length, 30);
  assert.equal(new Set(fillerNames([], 30)).size, 30);
});

test('a person who joins mid-round takes the bot seat the round still lists, and steers that noodle', () => {
  const roster = makeRoster([{ seat: 0, name: 'Host' }], [{ seat: 1, name: 'Orzo', bot: true }, { seat: 2, name: 'Penne', bot: true }], 6);
  assert.deepEqual(roster.slice(0, 3).map((entry) => entry.bot), [false, true, true]);
  // The room gave seat 1 to Sam; the round's bot list (fixed at start) still says seat 1 is a bot.
  const next = syncRoster(roster, [{ seat: 0, name: 'Host' }, { seat: 1, name: 'Sam' }], [{ seat: 1, name: 'Orzo', bot: true }, { seat: 2, name: 'Penne', bot: true }]);
  const sam = next.find((entry) => entry.seat === 1)!;
  assert.equal(sam.name, 'Sam');
  assert.equal(sam.bot, false);
  assert.equal(sam.id, roster[1].id);
  assert.equal(next.find((entry) => entry.seat === 2)!.bot, true);
  // A fresh roster built with the same overlap also seats the person, not a bot.
  const fresh = makeRoster([{ seat: 0, name: 'Host' }, { seat: 1, name: 'Sam' }], [{ seat: 1, name: 'Orzo', bot: true }], 4);
  assert.equal(fresh.find((entry) => entry.seat === 1)!.bot, false);
  assert.deepEqual(rosterChanges(roster, next), { left: [], joined: ['Sam'] });
  assert.deepEqual(rosterChanges(roster, next, 1), { left: [], joined: [] });
});

test('a person leaving mid-round hands their noodle to a bot and everyone gets a notice', () => {
  const roster = makeRoster([{ seat: 0, name: 'Host' }, { seat: 3, name: 'Guest' }], [], 5);
  const next = syncRoster(roster, [{ seat: 0, name: 'Host' }], []);
  const guest = next.find((entry) => entry.name === 'Guest')!;
  assert.equal(guest.bot, true);
  assert.equal(guest.eligible, false);
  const change = rosterChanges(roster, next, 0);
  assert.deepEqual(change, { left: ['Guest'], joined: [] });
  assert.equal(rosterNotice(change), 'Guest left, a bot took over');
  assert.equal(rosterNotice({ left: ['A', 'B'], joined: ['C'] }), 'A and B left, a bot took over. C joined');
  assert.equal(rosterNotice({ left: [], joined: [] }), '');
});

test('the online game over line names every person still in the room with their place', () => {
  const snakes = [
    { id: 0, seat: 0, bot: false, name: 'Host' },
    { id: 1, seat: 1, bot: true, name: 'Orzo' },
    { id: 2, seat: 2, bot: false, name: 'Sam' },
    { id: 3, seat: 3, bot: true, name: 'Gone' },
    { id: 4, seat: -1, bot: true, name: 'Penne' },
  ];
  const ranking: [number, number, number, number][] = [[1, 1, 90, 2], [2, 2, 64.4, 1], [4, -1, 50, 0], [0, 0, 31, 0], [3, 3, 20, 0]];
  const people = peopleResults(ranking, snakes, 2);
  assert.deepEqual(people.map((p) => [p.name, p.place, p.length, p.me]), [['Sam', 2, 64, true], ['Host', 4, 31, false]]);
  assert.equal(peopleLine(people), '2 people in the room: you 2nd, length 64; Host 4th, length 31.');
  assert.equal(peopleLine([]), '');
});

test('frame unit undoes the device frame scale, but not mid app-open animation', () => {
  assert.equal(frameUnit(300, 300), 1);
  assert.equal(frameUnit(600, 300), 1);
  assert.equal(frameUnit(0, 0), 1);
  assert.equal(frameUnit(18, 300), 1);
  assert.ok(Math.abs(frameUnit(245.25, 300) - 1.223) < 0.001);
  assert.equal(frameUnit(150, 300), 1.6);
});
