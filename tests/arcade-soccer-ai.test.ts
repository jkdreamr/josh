import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeAI, keeperTarget, simulateCpuMatch, simulateCpuMatchStats } from '../src/os/arcade/games/soccer/ai.ts';
import { createWorld, distance, FIELD, stepWorld, teamDir, TEAM_SIZE, type Player } from '../src/os/arcade/games/soccer/logic.ts';

let measured: ReturnType<typeof simulateCpuMatchStats>[] | undefined;
const normalMatches = () => measured ??= [2, 17, 31, 47, 59, 71, 89, 103].map((seed) => simulateCpuMatchStats(seed, 'normal', 'normal', 480));
let additional: ReturnType<typeof simulateCpuMatchStats>[] | undefined;
const additionalMatches = () => additional ??= [127, 139, 151, 163, 179, 191, 211, 229].map((seed) => simulateCpuMatchStats(seed, 'normal', 'normal', 480));

function tacticalWorld() {
  const world = createWorld(47);
  world.phase = 'live'; world.restart = null;
  for (const [i, p] of world.players.entries()) {
    p.human = false; p.controlled = false;
    if (p.slot !== 'GK') { p.x = p.team === 0 ? -35 : 35; p.z = (i % TEAM_SIZE - 5) * 5; }
  }
  return world;
}

test('human players never receive AI movement', () => {
  const g = createWorld();
  const commands = computeAI(g, 'normal', 1 / 60, 1);
  assert.equal(commands.has(g.players[6]!.id), false);
  assert.ok([...commands.keys()].every((id) => !g.players[id]!.human));
});

test('players respect the sprint speed cap', () => {
  simulateCpuMatch(1234, 'hard', 'easy', 8, (world) => {
    for (const p of world.players) assert.ok(Math.hypot(p.vx, p.vz) <= 9.01);
  });
});

test('seeded four-minute halves have plausible average scoring', () => {
  let total = 0;
  for (const { world: g } of normalMatches()) {
    assert.equal(g.phase, 'full-time');
    assert.ok(g.score[0] + g.score[1] <= 8, `score: ${g.score.join('-')}`);
    total += g.score[0] + g.score[1];
  }
  assert.ok(total / 8 >= 1 && total / 8 <= 5, `average goals: ${total / 8}`);
});

test('scoring generalizes to eight additional seeds', () => {
  const goals = additionalMatches().map(({ world }) => {
    assert.equal(world.phase, 'full-time');
    return world.score[0] + world.score[1];
  });
  assert.ok(goals.every((n) => n <= 8), `goals: ${goals}`);
  const mean = goals.reduce((sum, n) => sum + n, 0) / goals.length;
  assert.ok(mean >= 1 && mean <= 5, `other-seed average goals: ${mean}`);
});

test('normal matches have realistic passing, shot conversion, possession and no strong home bias', () => {
  for (const matches of [normalMatches(), additionalMatches()]) {
    const sum = (key: 'shots' | 'goals' | 'passesAttempted' | 'passesCompleted' | 'possessionTicks', team?: number) => matches.reduce((n, m) => n + (team === undefined ? m.teams[0][key] + m.teams[1][key] : m.teams[team]![key]), 0);
    const completion = sum('passesCompleted') / sum('passesAttempted');
    const shotsPerGoal = sum('shots') / sum('goals');
    const homePossession = sum('possessionTicks', 0) / sum('possessionTicks');
    assert.ok(completion >= 0.65 && completion <= 0.9, `pass completion: ${completion}`);
    for (const team of [0, 1]) {
      const rate = sum('passesCompleted', team) / sum('passesAttempted', team);
      assert.ok(rate >= 0.65 && rate <= 0.9, `team ${team} pass completion: ${rate}`);
    }
    assert.ok(shotsPerGoal >= 3 && shotsPerGoal <= 10, `shots per goal: ${shotsPerGoal}`);
    assert.ok(homePossession >= 0.35 && homePossession <= 0.65, `home carried-time share: ${homePossession}`);
    const wins = matches.filter((m) => m.world.score[0] > m.world.score[1]).length;
    const losses = matches.filter((m) => m.world.score[0] < m.world.score[1]).length;
    if (matches === measured) assert.ok(Math.abs(wins - losses) <= 3, `home W/L: ${wins}/${losses}`);
  }
});

test('keeper shades toward the predicted ball crossing and steps out one-on-one', () => {
  const g = createWorld();
  const keeper = g.players[TEAM_SIZE]!;
  g.ball.x = FIELD.length / 2 - 11;
  g.ball.z = -1;
  g.ball.vx = 10;
  g.ball.vz = 3;
  const intercept = keeperTarget(g, keeper);
  assert.ok(intercept.z > 0);
  const normalX = intercept.x;
  g.ball.x = FIELD.length / 2 - 6;
  const oneOnOneX = keeperTarget(g, keeper).x;
  assert.ok(oneOnOneX < normalX);
});

test('keeper steering brakes outward momentum between positioning decisions', () => {
  const world = tacticalWorld();
  const keeper = world.players[0]!;
  keeper.z = 3; keeper.vz = 4;
  world.ball.x = 0; world.ball.z = 0;
  for (let tick = 1; tick <= 180; tick++) {
    const commands = computeAI(world, 'normal', 1 / 60, tick, 0);
    if (tick === 1) assert.ok(commands.get(keeper.id)!.move.z < 0);
    stepWorld(world, 1 / 60, commands);
    assert.ok(Math.abs(keeper.z) <= FIELD.goalWidth / 2 + 1);
  }
  assert.ok(Math.abs(keeper.z) < 0.5);
});

test('a keeper in possession holds position while waiting for a distribution decision', () => {
  const world = tacticalWorld();
  const keeper = world.players[0]!;
  world.ball.x = keeper.x; world.ball.z = keeper.z;
  world.lastTouch = keeper.team;
  const command = computeAI(world, 'normal', 1 / 60, 1, keeper.team).get(keeper.id)!;
  assert.deepEqual(command.move, { x: 0, z: 0 });
});

test('keepers stay near their own goal through seeded matches and the change of ends', () => {
  for (const seed of [17, 47]) {
    const live = [0, 0], confined = [0, 0];
    simulateCpuMatch(seed, 'normal', 'normal', 480, (world) => {
      if (world.phase !== 'live') return;
      for (const keeper of world.players.filter((p) => p.slot === 'GK')) {
        const goalX = -teamDir(keeper.team, world.endsSwapped) * FIELD.length / 2;
        const target = keeperTarget(world, keeper);
        assert.ok(Math.abs(target.z) <= FIELD.goalWidth / 2 + 1);
        assert.ok(Math.abs(target.x - goalX) <= FIELD.penaltyDepth);
        live[keeper.team]++;
        if (Math.abs(keeper.z) <= FIELD.goalWidth / 2 + 2
          && Math.abs(keeper.x - goalX) <= FIELD.penaltyDepth) confined[keeper.team]++;
      }
    });
    for (const team of [0, 1]) assert.ok(live[team]! > 0 && confined[team]! / live[team]! >= 0.95,
      `seed ${seed} team ${team}: ${confined[team]}/${live[team]} live ticks near goal`);
  }
});

for (const [home, away] of [['hard', 'easy'], ['hard', 'normal'], ['normal', 'easy']] as const) test(`${home} CPU beats ${away} across seeded four-minute halves`, () => {
  let wins = 0;
  let losses = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const game = simulateCpuMatch(seed * 113, home, away, 480);
    if (game.score[0] > game.score[1]) wins++;
    if (game.score[0] < game.score[1]) losses++;
  }
  assert.ok(wins > losses + 2, `${home} wins ${wins}, loses ${losses}`);
  if (home === 'hard' && away === 'easy') assert.ok(wins >= 7 && losses <= 1, `hard/easy W/L: ${wins}/${losses}`);
});

test('CPU teams hold shape without sustained teammate clumping', () => {
  let nearestDistanceTotal = 0;
  let playerSamples = 0;
  let clumpedSamples = 0;
  let samples = 0;
  const shape = [{ samples: 0, length: 0, width: 0 }, { samples: 0, length: 0, width: 0 }];
  for (const seed of [17, 47, 89]) {
    let tick = 0;
    simulateCpuMatch(seed, 'normal', 'normal', 120, (world) => {
      tick++;
      if (world.phase !== 'live' || tick % 30 !== 0) return;
      samples++;
      for (const team of [0, 1] as const) {
        const players = world.players.filter((player) => player.team === team && player.slot !== 'GK');
        for (const player of players) {
          const nearest = Math.min(...players.filter((mate) => mate.id !== player.id).map((mate) => distance(player, mate)));
          nearestDistanceTotal += nearest;
          playerSamples++;
        }
        let grouped = false;
        for (let a = 0; a < players.length && !grouped; a++) {
          for (let b = a + 1; b < players.length && !grouped; b++) {
            for (let c = b + 1; c < players.length; c++) {
              if (distance(players[a]!, players[b]!) < 5
                && distance(players[a]!, players[c]!) < 5
                && distance(players[b]!, players[c]!) < 5) {
                grouped = true;
                break;
              }
            }
          }
        }
        if (grouped) clumpedSamples++;
        const carrier = world.players.find((p) => distance(p, world.ball) < 0.64);
        if (carrier) {
          const measurement = shape[carrier.team === team ? 0 : 1]!;
          measurement.samples++;
          measurement.length += Math.max(...players.map((p) => p.x)) - Math.min(...players.map((p) => p.x));
          measurement.width += Math.max(...players.map((p) => p.z)) - Math.min(...players.map((p) => p.z));
        }
      }
    });
  }
  assert.ok(samples > 0, 'expected live-phase samples');
  const meanNearestDistance = nearestDistanceTotal / playerSamples;
  const clumpFraction = clumpedSamples / (samples * 2);
  assert.ok(meanNearestDistance >= 8, `mean nearest teammate distance: ${meanNearestDistance.toFixed(2)}m`);
  assert.ok(clumpFraction < 0.05, `three-player clump fraction: ${(clumpFraction * 100).toFixed(1)}%`);
  const [attack, defence] = shape.map((s) => ({ length: s.length / s.samples, width: s.width / s.samples }));
  assert.ok(attack!.width > defence!.width + 2, `width in/out: ${attack!.width}/${defence!.width}`);
  assert.ok(defence!.length >= 25 && defence!.length <= 40, `defensive block length: ${defence!.length}`);
  assert.ok(defence!.width >= 30 && defence!.width <= 45, `defensive block width: ${defence!.width}`);
});

test('CPU carrier completes a progressive pass to a teammate', () => {
  const g = createWorld(47);
  g.phase = 'live';
  g.restart = null;
  const carrier = g.players[1]!;
  const receiver = g.players[2]!;
  carrier.human = false;
  carrier.controlled = false;
  carrier.x = -5; carrier.z = 0;
  g.ball.x = -4.7; g.ball.z = 0;
  receiver.x = 0; receiver.z = 0; receiver.slot = 'CB';
  for (const p of g.players.filter((player) => player.team === 1)) {
    p.x = 14 + p.id * 0.2;
    p.z = 10;
  }
  const command = computeAI(g, 'hard', 1 / 60, 11, 0).get(carrier.id)!;
  assert.ok(command.action === 'pass' || command.action === 'through');
  stepWorld(g, 1 / 60, new Map([[carrier.id, command]]));
  assert.ok(g.kickEvent);
  let completed = false;
  for (let i = 0; i < 180; i++) {
    stepWorld(g, 1 / 60);
    if (g.players.some((p) => p.team === carrier.team && p.id !== carrier.id && distance(p, g.ball) < 0.64)) {
      completed = true;
      break;
    }
  }
  assert.ok(completed, 'expected a teammate to control the pass');
});

test('presser jockeys goal-side instead of diving onto the carrier', () => {
  const world = tacticalWorld();
  world.lastTouch = 1;
  const opponent = world.players[TEAM_SIZE + 6]!;
  opponent.x = 0; opponent.z = 0;
  world.ball.x = -0.4; world.ball.z = 0;
  const presser = world.players[1]!;
  presser.x = 0; presser.z = -3;
  const command = computeAI(world, 'normal', 1 / 60, 1, 0).get(presser.id)!;
  assert.ok(command.move.x < -0.3, 'jockey target must be toward own goal');
  assert.notEqual(command.action, 'tackle');
});

test('covering defender marks the dangerous runner goal-side', () => {
  const world = tacticalWorld();
  world.lastTouch = 1;
  const carrier = world.players[TEAM_SIZE + 6]!;
  carrier.x = 0; carrier.z = 0;
  world.ball.x = -0.4; world.ball.z = 0;
  world.players[2]!.x = -1; world.players[2]!.z = -1;
  world.players[3]!.x = -5; world.players[3]!.z = 3;
  const defender = world.players[1]!;
  defender.x = -27; defender.z = -15;
  const attacker = world.players[TEAM_SIZE + 9]!;
  attacker.x = -26; attacker.z = -14;
  const command = computeAI(world, 'normal', 1 / 60, 1, 0).get(defender.id)!;
  assert.ok(command.move.x < 0);
  assert.ok(command.move.z > 0);
});

test('CPU teammates cover when the nearest presser is human or controlled', () => {
  for (const control of ['human', 'controlled'] as const) {
    const world = tacticalWorld();
    world.lastTouch = 1;
    const carrier = world.players[TEAM_SIZE + 6]!;
    carrier.x = 0; carrier.z = 0;
    world.ball.x = -0.4; world.ball.z = 0;
    const human = world.players[1]!;
    human[control] = true; human.x = -1.8; human.z = 0;
    const cover = world.players[2]!;
    cover.x = -5; cover.z = 2;
    world.players[4]!.x = -14; world.players[4]!.z = 8;
    const commands = computeAI(world, 'normal', 1 / 60, 1, 0);
    assert.equal(commands.has(human.id), false);
    assert.ok(commands.get(cover.id)!.move.x < 0, 'cover must retreat goal-side, not chase the ball');
  }
});

test('keeper bisects the angle, shades the near post and mirrors across ends', () => {
  const world = tacticalWorld();
  const keeper = world.players.find((p) => p.team === 1 && p.slot === 'GK')!;
  world.ball.x = 10; world.ball.z = 5;
  const target = keeperTarget(world, keeper);
  assert.ok(target.z > 0 && target.z < world.ball.z);
  assert.ok(target.x < FIELD.length / 2 && target.x > 15);
  world.endsSwapped = true; world.ball.x = -10;
  const mirrored = keeperTarget(world, keeper);
  assert.equal(mirrored.x, -target.x);
  assert.equal(mirrored.z, target.z);
});

test('carrier does not shoot from 28 metres through a defensive lane', () => {
  const world = tacticalWorld();
  const carrier = world.players[1]!;
  carrier.x = FIELD.length / 2 - 28; carrier.z = 0;
  world.ball.x = carrier.x + 0.3; world.ball.z = 0;
  for (const [i, p] of world.players.filter((p) => p.team === 1).entries()) { p.x = -3 + i * 3; p.z = 0; }
  const command = computeAI(world, 'normal', 1 / 60, 15, 0).get(carrier.id)!;
  assert.notEqual(command.action, 'shoot');
  assert.notEqual(command.action, 'finesse');
});

test('role-based commands support 4-3-3 rosters and non-contiguous ids', () => {
  const world = tacticalWorld();
  const template = world.players[1]!;
  const slots = ['GK', 'LB', 'CB', 'CB', 'RB', 'CM', 'CM', 'CM', 'LW', 'ST', 'RW'];
  world.players = ([0, 1] as const).flatMap((team) => slots.map((slot, i) => ({ ...template, id: 100 + team * 30 + i,
    team, slot, x: (team ? -1 : 1) * (-15 + i * 2), z: (i % 3 - 1) * 5 })) as Player[]);
  world.ball.x = 0; world.ball.z = 0;
  const commands = computeAI(world, 'normal', 1 / 60, 1);
  assert.equal(commands.size, 22);
  assert.ok([...commands.values()].every((command) => Number.isFinite(command.move.x) && Number.isFinite(command.move.z)));
});

test('keepers commit after elapsed reaction time regardless of the shot tick modulo', () => {
  for (const start of [17, 23]) {
    const world = tacticalWorld();
    const keeper = world.players.find((p) => p.team === 1 && p.slot === 'GK')!;
    keeper.z = 0;
    world.ball.x = FIELD.length / 2 - 14; world.ball.z = 1.8; world.ball.vx = 20; world.ball.vz = 0;
    world.kickEvent = { playerId: 1, action: 'shoot', power: 0.75, time: world.clock };
    computeAI(world, 'hard', 1 / 60, start, 1);
    world.kickEvent = null;
    computeAI(world, 'hard', 1 / 60, start + 9, 1);
    assert.equal(keeper.action, 'ready');
    computeAI(world, 'hard', 1 / 60, start + 10, 1);
    assert.equal(keeper.action, 'dive');
    world.ball.z = 0.4;
    computeAI(world, 'hard', 1 / 60, start + 11, 1);
    assert.equal(keeper.action, 'dive', 'a read remains committed for the incoming flight');
    world.ball.vx = -20;
    computeAI(world, 'hard', 1 / 60, start + 12, 1);
    assert.equal(keeper.action, 'ready', 'a rebound releases the commitment');
  }
});

test('keeper reads recognize fast shots without an event, delay by level, and ignore wide balls', () => {
  for (const level of ['easy', 'normal', 'hard'] as const) {
    const world = tacticalWorld();
    const keeper = world.players.find((p) => p.team === 1 && p.slot === 'GK')!;
    keeper.z = 0;
    world.ball.x = FIELD.length / 2 - 14; world.ball.z = 1.8; world.ball.vx = 20; world.ball.vz = 0;
    computeAI(world, level, 1 / 60, 17, 1);
    computeAI(world, level, 1 / 60, 27, 1);
    assert.equal(keeper.action, level === 'hard' ? 'dive' : 'ready');
    world.ball.z = 8;
    computeAI(world, level, 1 / 60, 57, 1);
    assert.equal(keeper.action, 'ready');
  }
});

test('a human keeper is not given a dive decision', () => {
  const world = tacticalWorld();
  const keeper = world.players.find((p) => p.team === 1 && p.slot === 'GK')!;
  keeper.human = true; keeper.action = 'human';
  world.ball.x = FIELD.length / 2 - 14; world.ball.z = 1.8; world.ball.vx = 20;
  computeAI(world, 'hard', 1 / 60, 17, 1);
  const commands = computeAI(world, 'hard', 1 / 60, 40, 1);
  assert.equal(commands.has(keeper.id), false);
  assert.equal(keeper.action, 'human');
});
