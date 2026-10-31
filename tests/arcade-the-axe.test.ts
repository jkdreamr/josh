import assert from 'node:assert/strict';
import test from 'node:test';
import { assignRoles, makeMemory, think } from '../src/os/arcade/games/the-axe/bots.ts';
import {
  CAPS_TO_WIN, FIELD, JAILBREAK_GRACE, JAILBREAK_TIME, MATCH_TIME, STEP, assignTeams, createWorld, jailRect, movePlayer,
  soloRoster, step, takeoverDeparted, type GameEvent, type Input, type Level, type Mode, type PlayerConfig, type World,
} from '../src/os/arcade/games/the-axe/logic.ts';
import {
  endPacket, eventsFromNet, eventsToNet, inputPacket, ownMoveOf, packPlayer, parsePacket,
  startPacket, statePacket, unpackPlayer, type InputPacket,
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

test('defenders lead a fleeing carrier and stay on their own half', () => {
  const roster = configs(3).map((player) => ({ ...player, ai: 1 as Level }));
  const world = playing('classic', roster);
  // a cal player has stanford's axe at x 20, running for home
  Object.assign(world.players[1], { x: 20, y: 12, vx: 7, vy: 0, carrying: 0 });
  world.axes[0].carrier = 1;
  Object.assign(world.axes[0], { x: 20, y: 12 });
  for (const id of [0, 2, 4]) Object.assign(world.players[id], { x: 10 + id, y: 12 + id });
  const chasers = [0, 2, 4].map((id) => {
    const memory = makeMemory();
    think(world, id, memory, () => 0.5, STEP);
    return memory;
  });
  const after = chasers.filter((memory) => memory.targetId === 1);
  assert.ok(after.length >= 2, 'the carrier gets more than one chaser');
  for (const memory of after) {
    assert.ok(memory.target.x > 20, 'aims ahead of the carrier, not behind it');
    assert.ok(memory.target.x < FIELD.MID, 'never chases past the midline');
  }
});

test('an escort steps between the carrier and the nearest chaser', () => {
  const roster = configs(3).map((player) => ({ ...player, ai: 1 as Level }));
  const world = playing('classic', roster);
  Object.assign(world.players[0], { x: 40, y: 17, carrying: 1 });
  world.axes[1].carrier = 0;
  Object.assign(world.axes[1], { x: 40, y: 17 });
  Object.assign(world.players[1], { x: 46, y: 17 });
  Object.assign(world.players[3], { x: 55, y: 4 });
  Object.assign(world.players[5], { x: 55, y: 30 });
  Object.assign(world.players[2], { x: 38, y: 20 });
  Object.assign(world.players[4], { x: 20, y: 30 });
  const roles = assignRoles(world, 0);
  const escort = [...roles].find(([, role]) => role === 'attack')![0];
  const memory = makeMemory();
  think(world, escort, memory, () => 0.5, STEP);
  assert.ok(memory.target.x > 40 && memory.target.x < 46, `escort target ${memory.target.x}`);
  assert.ok(Math.abs(memory.target.y - 17) < 1);
});

test('attackers wait on their own side until there is an opening, then run for the axe', () => {
  const roster = configs(1).map((player) => ({ ...player, ai: 2 as Level }));
  const guarded = playing('classic', roster);
  Object.assign(guarded.players[0], { x: 28, y: 17, stamina: 1 });
  Object.assign(guarded.players[1], { x: 52, y: 17 });
  const waiting = makeMemory();
  think(guarded, 0, waiting, () => 0.5, STEP);
  assert.ok(waiting.target.x < FIELD.MID, `waits at x ${waiting.target.x}`);

  const open = playing('classic', roster);
  Object.assign(open.players[0], { x: 28, y: 17, stamina: 1 });
  // (their only player is in jail: the way is clear)
  Object.assign(open.players[1], { jailed: true, jailSlot: 0 });
  const running = makeMemory();
  think(open, 0, running, () => 0.5, STEP);
  assert.equal(running.committed, true);
  assert.ok(running.target.x > FIELD.MID);
});

test('a carrier takes the lane furthest from the chasers', () => {
  const roster = configs(5).map((player) => ({ ...player, ai: 1 as Level }));
  const world = playing('classic', roster);
  Object.assign(world.players[0], { x: 48, y: 17, carrying: 1 });
  world.axes[1].carrier = 0;
  Object.assign(world.axes[1], { x: 48, y: 17 });
  Object.assign(world.players[1], { x: 36, y: 17 });
  for (const enemy of world.players.filter((player) => player.team === 1 && player.id !== 1)) {
    Object.assign(enemy, { x: 55, y: enemy.id % 4 === 1 ? 6 : 28 });
  }
  const memory = makeMemory();
  think(world, 0, memory, () => 0.5, STEP);
  assert.equal(memory.role, 'carry');
  assert.notEqual(memory.lane, 17);
  // dodging: it heads homeward, away from the chaser in the middle lane
  assert.ok(memory.dir.x < 0.2);
});

test('the jails open every 15 seconds, and escapees can be tagged after a short head start', () => {
  const world = playing();
  const prisoner = world.players[1];
  Object.assign(prisoner, { jailed: true, jailSlot: 0 });
  world.jailT = STEP * 1.5;
  const events = tick(world, world.players.map(() => idle), 2);
  assert.ok(events.some((event) => event.type === 'jailbreak' && event.count === 1));
  assert.equal(prisoner.jailed, false);
  assert.equal(prisoner.safe, false, 'not walked home safely: they have to run');
  assert.ok(prisoner.immuneT > 0 && prisoner.immuneT <= JAILBREAK_GRACE);
  assert.ok(world.jailT > JAILBREAK_TIME - 0.1);

  // a stanford defender right next to them: nothing during the head start, a tag after it
  Object.assign(world.players[0], { x: prisoner.x + 1.2, y: prisoner.y, vx: 0, vy: 0 });
  tick(world, world.players.map(() => idle), 10);
  assert.equal(prisoner.jailed, false);
  tick(world, world.players.map(() => idle), Math.ceil(JAILBREAK_GRACE / STEP));
  assert.equal(prisoner.jailed, true);

  // the clock runs down whether or not anyone is inside, and resets each point
  const empty = playing();
  empty.jailT = STEP / 2;
  assert.ok(!tick(empty).some((event) => event.type === 'jailbreak'));
  assert.ok(empty.jailT > JAILBREAK_TIME - 0.1);
  const tree = playing('tree');
  tick(tree, tree.players.map(() => idle), 60);
  assert.equal(tree.jailT, JAILBREAK_TIME);
});

test('a player warps when the game moves them: tagged into jail, or lined up for a point', () => {
  const world = playing();
  const before = world.players[1].warp;
  near(world, 0, 24.2, 5, 1, 25.7, 5);
  tick(world);
  assert.equal(world.players[1].jailed, true);
  assert.equal(world.players[1].warp, before + 1);
  const lined = createWorld(configs(), 'classic', 3);
  assert.ok(lined.players.every((player) => player.warp === 1));
});

test('guests send their own moves, and old and new packets both parse', () => {
  const world = playing('classic', configs(2));
  const own = { x: 12.34, y: 5.67, vx: -3.2, vy: 1.1, warp: 4 };
  const input = inputPacket(3, { x: 1, y: 0, sprint: true }, 9, own);
  const parsed = parsePacket(input);
  assert.ok(parsed && parsed.k === 'i');
  assert.deepEqual(ownMoveOf(parsed), own);
  const old = inputPacket(3, { x: 1, y: 0, sprint: true }, 9);
  assert.equal(ownMoveOf(parsePacket(old) as InputPacket), null);
  assert.equal(parsePacket({ ...input, px: undefined }), null, 'half an own move is no own move');
  assert.equal(parsePacket({ ...input, py: 9000 }), null);

  world.jailT = 7.25;
  world.players[2].warp = 6;
  const state = statePacket(3, 100, world, []);
  const back = parsePacket(state);
  assert.ok(back && back.k === 'S');
  assert.equal(back.jb, 725);
  assert.equal(back.wp?.[2], 6);
  const { wp: _wp, jb: _jb, ...older } = state;
  assert.ok(parsePacket(older), 'a host a version behind still parses');
  assert.equal(parsePacket({ ...state, wp: [1] }), null);
  assert.equal(parsePacket({ ...state, jb: JAILBREAK_TIME * 100 + 1 }), null);
  // the timed jailbreak never goes on the wire, and the ids stay in a row around it
  const rows = eventsToNet([{ type: 'jailbreak', count: 2 }, { type: 'overtime' }], 5);
  assert.deepEqual(rows, [[5, 9, 0, 0, 0]]);
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
