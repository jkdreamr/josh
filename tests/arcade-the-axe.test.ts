import assert from 'node:assert/strict';
import test from 'node:test';
import { assignRoles, makeMemory, think } from '../src/os/arcade/games/the-axe/bots.ts';
import {
  CAPS_TO_WIN, FIELD, MATCH_TIME, STEP, assignTeams, createWorld, jailRect, movePlayer,
  soloRoster, step, takeoverDeparted, type GameEvent, type Input, type Level, type Mode, type PlayerConfig, type World,
} from '../src/os/arcade/games/the-axe/logic.ts';
import {
  endPacket, eventsFromNet, eventsToNet, inputPacket, packPlayer, parsePacket,
  startPacket, statePacket, unpackPlayer,
} from '../src/os/arcade/games/the-axe/net.ts';

const names = ['palm', 'quad', 'bixby', 'scout', 'pepper', 'rally', 'sprout', 'nugget', 'zip', 'mocha'];
const idle: Input = { x: 0, y: 0, sprint: false };

function configs(size = 2): PlayerConfig[] {
  return Array.from({ length: size * 2 }, (_, seat) => ({
    seat, team: (seat % 2) as 0 | 1, name: names[seat], ai: null,
  }));
}

function playing(mode: Mode = 'classic', roster = configs(), seed = 17) {
  const world = createWorld(roster, mode, seed);
  world.phase = 'play';
  world.phaseT = 0;
  world.clock = mode === 'tree' ? 120 : MATCH_TIME;
  world.acc = 0;
  for (const player of world.players) player.immuneT = 0;
  return world;
}

function tick(world: World, inputs: Input[] = world.players.map(() => idle), count = 1) {
  const events: GameEvent[] = [];
  for (let i = 0; i < count; i++) events.push(...step(world, inputs, STEP));
  return events;
}

function near(world: World, a: number, ax: number, ay: number, b: number, bx: number, by: number) {
  Object.assign(world.players[a], { x: ax, y: ay, vx: 0, vy: 0 });
  Object.assign(world.players[b], { x: bx, y: by, vx: 0, vy: 0 });
}

test('tags only land on the tagger’s half, and immunity blocks them', () => {
  const world = playing();
  near(world, 0, 29.4, 5, 1, 30.1, 5);
  tick(world);
  assert.equal(world.players[1].jailed, false);

  near(world, 0, 24.2, 5, 1, 25.7, 5);
  world.players[1].immuneT = 0;
  tick(world);
  assert.equal(world.players[1].jailed, true);

  const immune = playing();
  near(immune, 0, 24.2, 5, 1, 25.7, 5);
  immune.players[1].immuneT = 1;
  tick(immune);
  assert.equal(immune.players[1].jailed, false);
});

test('jailbreak frees the whole team, then safe players can walk home', () => {
  const world = playing();
  const rescuer = world.players[0];
  const prisoner = world.players[2];
  const jail = jailRect(1);
  Object.assign(rescuer, { x: jail.x + 1, y: jail.y + 2, safe: false, carrying: -1 });
  Object.assign(prisoner, { x: jail.x + 2, y: jail.y + 2, jailed: true, jailSlot: 0, safe: false });
  const events = tick(world);
  assert.ok(events.some((event) => event.type === 'free' && event.count === 1 && event.by === rescuer.id));
  assert.equal(prisoner.jailed, false);
  assert.equal(prisoner.safe, true);
  assert.equal(rescuer.safe, true);
  assert.equal(prisoner.frees, 0);
  assert.equal(rescuer.frees, 1);

  prisoner.x = 30.5;
  prisoner.y = 5;
  const walking = world.players.map((player) => player.id === prisoner.id ? { x: -1, y: 0, sprint: false } : idle);
  tick(world, walking, 20);
  assert.ok(prisoner.x < FIELD.MID);
  assert.equal(prisoner.safe, false);
  assert.ok(prisoner.immuneT > 0);
});

test('jailed players use spaced 3x3 jail slots', () => {
  const world = playing('classic', configs(5));
  const captives = world.players.filter((player) => player.team === 1);
  captives.forEach((player, slot) => {
    player.jailed = true;
    player.jailSlot = slot;
  });

  tick(world);

  const jail = jailRect(0);
  assert.deepEqual(captives.map(({ x, y }) => [x, y]), [
    [jail.x + 1, jail.y + 1],
    [jail.x + 3, jail.y + 1],
    [jail.x + 5, jail.y + 1],
    [jail.x + 1, jail.y + 3],
    [jail.x + 3, jail.y + 3],
  ]);
});

test('classic and big spawns stay between y 9 and 25 outside team jails', () => {
  for (const mode of ['classic', 'big'] as const) {
    const world = createWorld(configs(5), mode, 17);
    for (const team of [0, 1] as const) {
      const teammates = world.players.filter((player) => player.team === team);
      assert.equal(teammates[0].y, 9);
      assert.equal(teammates.at(-1)?.y, 25);
      const jail = jailRect(team);
      for (const player of teammates) {
        assert.ok(player.y >= 9 && player.y <= 25);
        assert.ok(!(player.x >= jail.x && player.x <= jail.x + jail.w && player.y >= jail.y && player.y <= jail.y + jail.h));
      }
    }
  }
});

test('tagging a carrier returns its axe home immediately', () => {
  const world = playing();
  near(world, 0, 35, 5, 1, 36.3, 5);
  const axe = world.axes[1];
  axe.carrier = 0;
  axe.x = 35;
  axe.y = 5;
  world.players[0].carrying = 1;
  const events = tick(world);
  assert.ok(events.some((event) => event.type === 'drop' && event.axe === 1 && event.x === 35 && event.y === 5));
  assert.equal(world.players[0].jailed, true);
  assert.equal(world.players[0].carrying, -1);
  assert.equal(axe.carrier, -1);
  assert.deepEqual([axe.x, axe.y], [57, 17]);
});

test('stealing an axe grants 1.6 seconds of tag grace', () => {
  const world = playing('classic', configs(1));
  const thief = world.players[0];
  Object.assign(thief, { x: 55.5, y: 17, immuneT: 0 });
  Object.assign(world.players[1], { x: 20, y: 10 });
  const events = tick(world);
  assert.ok(events.some((event) => event.type === 'steal' && event.who === thief.id));
  assert.equal(thief.carrying, 1);
  assert.equal(thief.immuneT, 1.6);
});

test('capture scores, resets the count, and the third capture ends the match', () => {
  const world = playing();
  const carrier = world.players[0];
  carrier.x = 4.5;
  carrier.y = 8;
  carrier.carrying = 1;
  world.axes[1].carrier = carrier.id;
  world.axes[1].x = carrier.x;
  world.axes[1].y = carrier.y;
  const events = tick(world);
  assert.ok(events.some((event) => event.type === 'capture' && event.team === 0));
  assert.equal(world.score[0], 1);
  assert.equal(world.phase, 'scored');
  assert.equal(world.axes[1].carrier, -1);
  tick(world, world.players.map(() => idle), 180);
  assert.equal(world.phase, 'count');

  world.phase = 'play';
  world.score[0] = CAPS_TO_WIN - 1;
  const nextCarrier = world.players[0];
  nextCarrier.x = 4.5;
  nextCarrier.y = 8;
  nextCarrier.carrying = 1;
  world.axes[1].carrier = nextCarrier.id;
  world.axes[1].x = nextCarrier.x;
  world.axes[1].y = nextCarrier.y;
  tick(world);
  tick(world, world.players.map(() => idle), 180);
  assert.equal(world.phase, 'over');
  assert.equal(world.winner, 0);
});

test('a tied clock starts golden capture, which decides the match', () => {
  const world = playing();
  world.clock = STEP / 2;
  const events = tick(world);
  assert.ok(events.some((event) => event.type === 'overtime'));
  assert.equal(world.overtime, true);
  assert.equal(world.clock, 0);

  const carrier = world.players[0];
  carrier.x = 4;
  carrier.y = 8;
  carrier.carrying = 1;
  world.axes[1].carrier = carrier.id;
  world.axes[1].x = carrier.x;
  world.axes[1].y = carrier.y;
  tick(world);
  tick(world, world.players.map(() => idle), 180);
  assert.equal(world.phase, 'over');
  assert.equal(world.winner, 0);
});

test('big game uses a neutral midfield axe and scores in the enemy end zone', () => {
  const world = playing('big');
  const neutral = world.axes[0];
  assert.equal(neutral.owner, -1);
  assert.deepEqual([neutral.x, neutral.y], [30, 17]);
  world.players[0].x = 31;
  world.players[0].y = 17;
  world.players[1].x = 50;
  world.players[1].y = 30;
  tick(world);
  assert.equal(neutral.carrier, 0);
  world.players[0].x = FIELD.L - FIELD.END + 1;
  world.players[0].y = 8;
  tick(world);
  assert.equal(world.score[0], 1);
  assert.ok(!world.axes.some((axe) => axe.owner === 0));
});

test('tree swaps on touch, accrues tree time, and chooses the lowest-id tied winner', () => {
  const world = playing('tree', configs(2));
  const oldTree = world.tree;
  const newTree = oldTree === 0 ? 1 : 0;
  near(world, oldTree, 12, 12, newTree, 13.5, 12);
  world.players[oldTree].immuneT = 0;
  world.players[newTree].immuneT = 0;
  const events = tick(world);
  assert.ok(events.some((event) => event.type === 'tree' && event.who === newTree));
  assert.equal(world.tree, newTree);
  assert.ok(world.treeScore[oldTree] > 0);
  tick(world);
  assert.ok(world.treeScore[newTree] > 0);

  world.treeScore.fill(0);
  world.treeScore[0] = 5;
  world.treeScore[1] = 5;
  world.clock = STEP / 2;
  tick(world);
  assert.equal(world.phase, 'over');
  assert.equal(world.winnerId, 0);
});

test('drums stun nearby enemies and tree costumes grant speed boosts', () => {
  const drum = playing();
  near(drum, 0, 10, 10, 1, 16, 10);
  drum.pickups = [{ id: 1, kind: 'drum', x: 10, y: 10 }];
  const drumEvents = tick(drum);
  assert.ok(drumEvents.some((event) => event.type === 'stun' && event.who === 1));
  assert.ok(drum.players[1].stunT > 0);

  const costume = playing();
  costume.players[0].x = 10;
  costume.players[0].y = 10;
  costume.pickups = [{ id: 1, kind: 'costume', x: 10, y: 10 }];
  const costumeEvents = tick(costume);
  assert.ok(costumeEvents.some((event) => event.type === 'pickup' && event.kind === 'costume'));
  assert.ok(costume.players[0].boostT > 0);
});

test('carriers cannot sprint and move slower; stamina drains and regenerates', () => {
  const world = playing();
  const carrier = world.players[0];
  const runner = world.players[1];
  carrier.carrying = 0;
  Object.assign(carrier, { x: 10, y: 10, stamina: 1 });
  Object.assign(runner, { x: 10, y: 20, stamina: 1 });
  movePlayer(carrier, { x: 1, y: 0, sprint: true }, 0.1, world);
  movePlayer(runner, { x: 1, y: 0, sprint: true }, 0.1, world);
  assert.equal(carrier.sprinting, false);
  assert.ok(carrier.x - 10 < runner.x - 10);
  assert.ok(Math.abs(runner.stamina - 0.945) < 1e-9);
  const afterSprint = runner.stamina;
  movePlayer(runner, idle, 0.1, world);
  assert.ok(runner.restT > 0);
  assert.equal(runner.stamina, afterSprint);
  for (let i = 0; i < 150; i++) movePlayer(runner, idle, STEP, world);
  assert.ok(runner.stamina > afterSprint);
});

test('team assignments balance bots and solo rosters fill the requested sizes', () => {
  const teams = assignTeams([
    { seat: 4, bot: true }, { seat: 2, bot: false }, { seat: 5, bot: true },
    { seat: 0, bot: false }, { seat: 1, bot: true }, { seat: 3, bot: false },
  ]);
  assert.deepEqual([...teams.entries()].sort((a, b) => a[0] - b[0]), [[0, 0], [1, 1], [2, 1], [3, 0], [4, 0], [5, 1]]);
  for (let size = 1; size <= 5; size++) {
    const solo = soloRoster(size, 1, false, names);
    const local = soloRoster(size, 1, true, names);
    assert.equal(solo.length, size * 2);
    assert.equal(local.length, size * 2);
    assert.equal(solo.filter((p) => p.ai === null).length, 1);
    assert.equal(local.filter((p) => p.ai === null).length, 2);
  }
});

test('bots receive attack, defense, jailbreak, carry, and tree roles', () => {
  const roster = configs(2).map((player) => ({ ...player, ai: 1 as Level }));
  const world = playing('classic', roster);
  let roles = assignRoles(world);
  assert.equal([...roles.values()].filter((role) => role === 'defend').length, 2);
  assert.equal([...roles.values()].filter((role) => role === 'attack').length, 2);

  world.players[0].jailed = true;
  roles = assignRoles(world, 0);
  assert.ok([...roles.values()].includes('jailbreak'));

  world.players[1].carrying = 1;
  roles = assignRoles(world);
  assert.equal(roles.get(1), 'carry');

  const tree = playing('tree', roster);
  assert.deepEqual(tree.players.map((player) => player.team), [0, 1, 0, 1]);
  roles = assignRoles(tree);
  assert.equal(roles.get(tree.tree), 'tree-run');
  assert.equal([...roles.values()].filter((role) => role === 'tree-chase').length, 3);
  const takeover = playing();
  assert.deepEqual(takeoverDeparted(takeover, [1, 2, 3], 2), [0]);
  assert.equal(takeover.players[0].ai, 2);
});

test('defenders guard, attackers screen, and other attackers use decoy lanes', () => {
  const roster = configs(5).map((player) => ({ ...player, ai: 1 as Level }));
  const defense = playing('classic', roster);
  Object.assign(defense.players[0], { x: 9, y: 12 });
  Object.assign(defense.players[2], { x: 9, y: 23 });
  Object.assign(defense.players[4], { x: 25, y: 6 });
  Object.assign(defense.players[6], { x: 25, y: 17 });
  Object.assign(defense.players[8], { x: 25, y: 28 });
  Object.assign(defense.players[1], { x: 20, y: 12, vx: -4, vy: 0, carrying: 0 });
  defense.axes[0].carrier = 1;
  defense.axes[0].x = 20;
  defense.axes[0].y = 12;
  const chaserMemory = makeMemory();
  const guardMemory = makeMemory();
  think(defense, 0, chaserMemory, () => 0.2, STEP);
  think(defense, 2, guardMemory, () => 0.2, STEP);
  assert.ok(Math.abs(chaserMemory.target.x - 20.48) < 1e-9);
  assert.equal(guardMemory.target.x, 11);
  assert.ok(guardMemory.target.y > 19 && guardMemory.target.y < 22);

  const escort = playing('classic', roster);
  Object.assign(escort.players[0], { x: 40, y: 17, carrying: 1 });
  Object.assign(escort.players[1], { x: 42, y: 17 });
  escort.axes[1].carrier = 0;
  escort.axes[1].x = 40;
  escort.axes[1].y = 17;
  const escortRole = assignRoles(escort, 0);
  const escortId = [...escortRole].find(([, role]) => role === 'attack')![0];
  const escortMemory = makeMemory();
  think(escort, escortId, escortMemory, () => 0.2, STEP);
  assert.ok(Math.abs(escortMemory.target.x - 41.5) < 1e-9);
  assert.ok(Math.abs(escortMemory.target.y - 17) < 1e-9);

  const decoys = playing('classic', roster);
  Object.assign(decoys.players[0], { x: 40, y: 17 });
  Object.assign(decoys.players[2], { x: 40, y: 6 });
  Object.assign(decoys.players[4], { x: 9, y: 17 });
  Object.assign(decoys.players[6], { x: 9, y: 6 });
  Object.assign(decoys.players[8], { x: 9, y: 28 });
  const attackRoles = assignRoles(decoys, 0);
  const attackIds = [...attackRoles].filter(([, role]) => role === 'attack').map(([id]) => id);
  const memories = new Map(attackIds.map((id) => [id, makeMemory()]));
  for (const id of attackIds) think(decoys, id, memories.get(id)!, () => 0.2, STEP);
  assert.ok(attackIds.some((id) => memories.get(id)!.target.x === 57 && memories.get(id)!.target.y === 17));
  const decoyTargets = attackIds.map((id) => memories.get(id)!.target).filter((target) => target.x === 35);
  assert.ok(decoyTargets.some((target) => target.y === 17 || target.y === 28));

  const carrierWorld = playing('classic', roster);
  Object.assign(carrierWorld.players[0], { x: 40, y: 17, carrying: 1 });
  Object.assign(carrierWorld.players[1], { x: 20, y: 17 });
  for (const enemy of carrierWorld.players.filter((player) => player.team === 1 && player.id !== 1)) {
    Object.assign(enemy, { x: 55, y: enemy.id % 2 ? 6 : 28 });
  }
  carrierWorld.axes[1].carrier = 0;
  carrierWorld.axes[1].x = 40;
  carrierWorld.axes[1].y = 17;
  const carrierMemory = makeMemory();
  think(carrierWorld, 0, carrierMemory, () => 0.2, STEP);
  assert.ok([6, 28].includes(carrierMemory.carryLane));
  assert.equal(carrierMemory.target.x, 3);
  assert.equal(carrierMemory.target.y, carrierMemory.carryLane);
});

test('same seed and same inputs produce identical worlds', () => {
  const a = playing('classic', soloRoster(3, 1, false, names));
  const b = playing('classic', soloRoster(3, 1, false, names));
  const inputs = a.players.map((_, id) => ({ x: id % 2 ? -0.4 : 0.7, y: id % 3 ? 0.2 : -0.6, sprint: id === 2 }));
  for (let i = 0; i < 300; i++) {
    tick(a, inputs);
    tick(b, inputs);
  }
  const stable = (world: World) => ({
    players: world.players.map(({ x, y, vx, vy, stamina, jailed, safe }) => ({ x, y, vx, vy, stamina, jailed, safe })),
    axes: world.axes, score: world.score, clock: world.clock, phase: world.phase, rngNext: world.rng(),
  });
  assert.deepEqual(stable(a), stable(b));
});

function runBots(seed: number, levels: [Level, Level] = [1, 1], playersPerTeam = 5) {
  const roster = Array.from({ length: playersPerTeam * 2 }, (_, seat) => ({
    seat, team: (seat % 2) as 0 | 1, name: names[seat], ai: levels[seat % 2],
  }));
  const world = playing('classic', roster, seed);
  const memories = world.players.map(() => makeMemory());
  const travel = world.players.map(() => 0);
  let windowTravel = world.players.map(() => 0);
  let windowFree = world.players.map(() => 0);
  let captures = 0;
  let regulationCaptures = 0;
  for (let frame = 0; frame < 360 * 60 && world.phase !== 'over'; frame++) {
    const inputs = world.players.map((p) => p.ai === null ? idle : think(world, p.id, memories[p.id], world.rng, STEP));
    const before = world.players.map((p) => ({ x: p.x, y: p.y, jailed: p.jailed }));
    const overtime = world.overtime;
    const events = tick(world, inputs);
    const scored = events.filter((event) => event.type === 'capture').length;
    captures += scored;
    if (!overtime) regulationCaptures += scored;
    for (const p of world.players) {
      const prior = before[p.id];
      const moved = Math.hypot(p.x - prior.x, p.y - prior.y);
      travel[p.id] += moved;
      windowTravel[p.id] += moved;
      if (!prior.jailed && !p.jailed) windowFree[p.id]++;
      assert.ok([p.x, p.y, p.vx, p.vy, p.stamina].every(Number.isFinite));
    }
    if ((frame + 1) % 600 === 0) {
      for (const p of world.players) {
        if (windowFree[p.id] > 300) assert.ok(windowTravel[p.id] > 1, `${p.name} was stuck for ten seconds`);
      }
      windowTravel = world.players.map(() => 0);
      windowFree = world.players.map(() => 0);
    }
  }
  return { world, captures, regulationCaptures, travel };
}

test('normal 5v5 bot matches capture, finish, stay finite, and keep moving', { timeout: 120_000 }, () => {
  for (const seed of [3, 11, 29]) {
    const { world, captures } = runBots(seed);
    assert.equal(world.phase, 'over', `seed ${seed} did not finish`);
    assert.ok(captures > 0, `seed ${seed} never captured`);
  }
});

test('normal 5v5 bots meet regulation capture and six-minute finish rates', { timeout: 120_000 }, () => {
  const runs = Array.from({ length: 20 }, (_, index) => runBots(index + 1));
  const captureCounts = runs.map((run) => run.regulationCaptures).sort((a, b) => a - b);
  const medianCaptures = (captureCounts[9] + captureCounts[10]) / 2;
  const finished = runs.filter((run) => run.world.phase === 'over').length;
  console.log(`The Axe 20-seed metrics: regulation captures ${captureCounts.join(',')}; median ${medianCaptures}; finished ${finished}/20`);
  assert.ok(medianCaptures >= 2, `median regulation captures ${medianCaptures}`);
  assert.ok(finished >= 16, `matches finished ${finished}/20`);
});

test('normal 1v1 bot matches produce captures', { timeout: 120_000 }, () => {
  const runs = [3, 11, 29].map((seed) => runBots(seed, [1, 1], 1));
  const captures = runs.reduce((sum, run) => sum + run.captures, 0);
  console.log(`The Axe normal 1v1 captures over three seeds: ${runs.map((run) => run.captures).join(',')}`);
  assert.ok(captures > 0, '1v1 bots never captured');
});

test('hard bots win more often than easy bots across several seeds', { timeout: 120_000 }, () => {
  let hardWins = 0;
  let easyWins = 0;
  for (const seed of [5, 13, 37, 71]) {
    const { world } = runBots(seed, [2, 0]);
    if (world.winner === 0) hardWins++;
    if (world.winner === 1) easyWins++;
  }
  assert.ok(hardWins > easyWins, `hard wins ${hardWins}, easy wins ${easyWins}`);
});

test('net packets, packed players, and all game events round-trip', () => {
  const world = playing('classic', configs(5));
  const input = inputPacket(4, { x: 0.6, y: 0.8, sprint: true }, 21);
  const start = startPacket(4, 'classic', 17, 2, world.players.map((p) => ({ seat: p.seat, team: p.team, ai: p.ai !== null })));
  const eventList: GameEvent[] = [
    { type: 'tag', by: 1, who: 2, x: 12.34, y: 9.87 },
    { type: 'free', by: 2, count: 2, team: 0 },
    { type: 'steal', who: 1, axe: 0 },
    { type: 'drop', axe: 1, x: 23.5, y: 8.25 },
    { type: 'capture', who: 2, team: 1 },
    { type: 'pickup', who: 3, kind: 'costume', x: 30.2, y: 17.8 },
    { type: 'stun', who: 4, by: 3 },
    { type: 'tree', who: 1, by: 0 },
    { type: 'phase', phase: 'scored' },
    { type: 'overtime' },
  ];
  const rows = eventsToNet(eventList, 10);
  assert.deepEqual(eventsFromNet(rows), eventList);
  const state = statePacket(4, 12, world, rows);
  const end = endPacket(4, world, null);
  for (const packet of [input, start, state, end]) assert.ok(parsePacket(packet));
  assert.equal(parsePacket(input)?.k, 'i');
  assert.equal(parsePacket(state)?.k, 'S');
  assert.deepEqual(unpackPlayer(packPlayer(world.players[0]))?.x, world.players[0].x);
});

test('net parser rejects malformed packets and out-of-range values', () => {
  const valid = inputPacket(2, { x: 0, y: 0, sprint: false }, 1);
  assert.equal(parsePacket({ ...valid, t: 'other' }), null);
  assert.equal(parsePacket({ ...valid, x: 101 }), null);
  assert.equal(parsePacket({ ...valid, x: Number.NaN }), null);
  assert.equal(parsePacket({ ...valid, s: 1 }), null);
  assert.equal(parsePacket({ t: 'the-axe', r: 1, k: 'start', mode: 'forest', seed: 0, lv: 1, roster: [] }), null);
  assert.equal(parsePacket({ t: 'the-axe', r: 1, k: 'S', n: 0, ph: 'missing', pt: 0, ck: 1, ot: 0, sc: [0, 0], tr: -1, ts: [], ax: [], pk: [], p: [], ev: [] }), null);
  assert.equal(parsePacket({ t: 'the-axe', r: 1, k: 'end', mode: 'classic', sc: [0, 0], w: 4, wid: -1, win: null }), null);
  assert.equal(parsePacket({ t: 'the-axe', r: 1, k: 'S', n: 0, ph: 'play', pt: 0, ck: 1, ot: 0, sc: [0, 0], tr: -1, ts: [], ax: [], pk: [], p: Array.from({ length: 11 }, () => [0, 0, 0, 0, 0, 100, 0]), ev: [] }), null);
});
