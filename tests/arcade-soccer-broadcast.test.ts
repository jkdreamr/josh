import assert from 'node:assert/strict';
import { test } from 'node:test';
import { simulateCpuMatch } from '../src/os/arcade/games/soccer/ai.ts';
import { broadcastClock, CLUBS, createMatchStats, createStatsObserver, passAccuracy, playerName, possessionShare, REGULAR, xgFor } from '../src/os/arcade/games/soccer/broadcast.ts';
import { createWorld, FIELD, STEP, teamDir, TEAM_SIZE, type Team } from '../src/os/arcade/games/soccer/logic.ts';
import { applyStoppageCard, checkOffside, noteKick, onFoul } from '../src/os/arcade/games/soccer/rules.ts';

function observeMatch(seed: number, seconds: number) {
  const observer = createStatsObserver();
  const world = simulateCpuMatch(seed, 'normal', 'normal', seconds, (state) => observer.observe(state, STEP));
  return { world, stats: observer.stats };
}

test('broadcast statistics do not alter seeded simulations', () => {
  for (const seed of [47, 89]) {
    const measured = observeMatch(seed, 30);
    assert.deepEqual(measured.world, simulateCpuMatch(seed, 'normal', 'normal', 30));
  }
});

test('broadcast statistics preserve match invariants over several seeds', () => {
  for (const seed of [17, 47, 89]) {
    const { world, stats } = observeMatch(seed, 30);
    assert.ok(stats.teams.every((team) => team.onTarget <= team.shots), `seed ${seed}: on target exceeds shots`);
    assert.ok(stats.teams.every((team) => team.completed <= team.passes));
    assert.deepEqual(stats.teams.map((team) => team.goals), world.score);
    assert.equal(stats.goals.length, world.score[0] + world.score[1]);
    assert.ok(stats.goals.every((goal) => goal.scorer !== undefined && goal.scorer >= 0 && goal.scorer < 22));
    const livePossession = stats.teams[0].possession + stats.teams[1].possession;
    assert.ok(livePossession <= 30 + STEP);
    assert.ok(livePossession > 0);
    assert.ok(stats.teams.every((team) => team.xg >= 0.01 * team.shots));
    assert.ok(stats.ticker.length <= 24);
  }
});

test('expected goals reward central close shots and reject impossible values', () => {
  const world = createWorld();
  const team: Team = 0;
  const goalX = teamDir(team, world.endsSwapped) * FIELD.length / 2;
  const penaltySpot = { x: goalX - teamDir(team, world.endsSwapped) * 11, z: 0 };
  const central25 = { x: goalX - teamDir(team, world.endsSwapped) * 25, z: 0 };
  const tightAngle = { x: goalX - teamDir(team, world.endsSwapped) * 2, z: FIELD.width / 2 - 1 };
  const penaltyXg = xgFor(world, penaltySpot, team);
  assert.ok(penaltyXg > xgFor(world, central25, team));
  assert.ok(xgFor(world, central25, team) > xgFor(world, tightAngle, team));
  for (const value of [penaltyXg, xgFor(world, central25, team), xgFor(world, tightAngle, team)]) {
    assert.ok(value >= 0.01 && value <= 0.95);
  }
  const swapped = { ...world, endsSwapped: true };
  const swappedGoalX = teamDir(team, swapped.endsSwapped) * FIELD.length / 2;
  assert.equal(xgFor(swapped, { x: swappedGoalX - teamDir(team, true) * 11, z: 0 }, team), penaltyXg);
});

test('rules clock maps the whole half to regulation and rules stoppage to added time', () => {
  const world = createWorld(1, 90);
  const stats = createMatchStats();
  world.clock = world.halfLength * 0.5;
  assert.equal(broadcastClock(world, stats).label, '22:30');
  assert.equal(broadcastClock(world, stats).minute, "23'");
  world.clock = 0;
  assert.equal(broadcastClock(world, stats).label, '45:00');
  assert.equal(broadcastClock(world, stats).minute, "45'");

  world.rules!.stoppage = {
    minutes: 3, left: world.halfLength / 45 * 3, elapsed: world.halfLength / 45 * 1.5, hold: 0,
  };
  stats.added[0] = 3;
  assert.equal(broadcastClock(world, stats).label, '46:30');
  assert.equal(broadcastClock(world, stats).minute, "45+2'");
  assert.equal(broadcastClock(world, stats).added, 3);
  world.half = 2;
  stats.added[1] = 3;
  assert.equal(broadcastClock(world, stats).minute, "90+2'");
});

test('clock and restart heuristic retain legacy behavior without rules', () => {
  const world = createWorld(1, 90);
  delete world.rules;
  const stats = createMatchStats();
  world.clock = 0;
  stats.added[0] = 3;
  assert.equal(broadcastClock(world, stats).label, '48:00');
  assert.equal(broadcastClock(world, stats).minute, "45+3'");
  world.half = 2;
  world.clock = world.halfLength;
  assert.equal(broadcastClock(world, stats).label, '45:00');

  world.half = 1;
  world.halfLength = 48;
  world.phase = 'live';
  world.clock = world.halfLength * (1 - (REGULAR - 1 / 48));
  const observer = createStatsObserver();
  observer.observe(world, STEP);
  world.phase = 'restart';
  world.restart = 'free-kick';
  world.restartTeam = 1;
  observer.observe(world, STEP);
  assert.equal(observer.stats.teams[0].fouls, 1);
  assert.equal(observer.stats.ticker.at(-1)?.kind, 'foul');
  assert.equal(observer.stats.added[0], 1);
});

test('rules stoppage sets the scoreboard tab while frequent restarts do not invent added time', () => {
  const world = createWorld(1, 90);
  world.phase = 'live';
  const observer = createStatsObserver();
  observer.observe(world, STEP);
  const version = observer.stats.version;
  world.rules!.stoppage = { minutes: 3, left: 6, elapsed: 0, hold: 0 };
  observer.observe(world, STEP);
  assert.equal(observer.stats.added[0], 3);
  assert.equal(observer.stats.version, version + 1);
  assert.equal(broadcastClock(world, observer.stats).added, 3);

  const restarted = createWorld(2, 90);
  restarted.phase = 'live';
  restarted.clock = 0;
  const restartObserver = createStatsObserver();
  restartObserver.observe(restarted, STEP);
  for (let count = 0; count < 8; count++) {
    restarted.phase = 'restart';
    restarted.restart = 'free-kick';
    restarted.restartTeam = 1;
    restartObserver.observe(restarted, STEP);
    restarted.phase = 'live';
    restarted.restart = null;
    restartObserver.observe(restarted, STEP);
  }
  assert.equal(restartObserver.stats.added[0], null);
});

test('offside restarts use the rules event and do not count as fouls', () => {
  const world = createWorld(3, 90);
  world.phase = 'live';
  world.restart = null;
  const observer = createStatsObserver();
  observer.observe(world, STEP);
  const passer = world.players[6]!;
  const runner = world.players[9]!;
  for (const player of world.players) {
    player.z = 0;
    if (player.team === 1) player.x = 10;
  }
  passer.x = 0;
  runner.x = 30;
  world.ball.x = 0;
  noteKick(world, passer, 'pass');
  world.lastToucherId = passer.id;
  checkOffside(world, runner);
  observer.observe(world, STEP);
  assert.equal(world.restart, 'free-kick');
  assert.equal(observer.stats.teams[0].fouls, 0);
  assert.equal(world.rules!.stats.fouls[0], 0);
  assert.deepEqual(observer.stats.ticker.at(-1), {
    id: 1,
    minute: "1'",
    team: 0,
    kind: 'offside',
    text: `offside, ${CLUBS[0].short.toLowerCase()}`,
  });
});

test('foul totals mirror the rules state without double-counting restart events', () => {
  const world = createWorld(4, 90);
  world.phase = 'live';
  const observer = createStatsObserver();
  observer.observe(world, STEP);
  const offender = world.players[TEAM_SIZE + 6]!;
  const victim = world.players[6]!;
  offender.x = -1; offender.z = 0; offender.vx = 0;
  victim.x = 0; victim.z = 0; victim.facing = Math.PI / 2;
  onFoul(world, offender, victim, 'tackle', false);
  observer.observe(world, STEP);
  assert.equal(world.rules!.stats.fouls[offender.team], 1);
  assert.equal(observer.stats.teams[offender.team].fouls, 1);

  world.phase = 'restart';
  world.restart = 'free-kick';
  world.restartTeam = victim.team;
  world.event = 'foul';
  observer.observe(world, STEP);
  assert.equal(observer.stats.teams[offender.team].fouls, 1);
});

test('card changes produce yellow, second-yellow and straight-red ticker entries', () => {
  const world = createWorld(5, 90);
  world.phase = 'live';
  const observer = createStatsObserver();
  observer.observe(world, STEP);
  const player = world.players[6]!;
  world.rules!.pendingCard = { playerId: player.id, card: 'yellow' };
  applyStoppageCard(world);
  observer.observe(world, STEP);
  assert.equal(observer.stats.ticker.at(-1)?.kind, 'yellow');
  assert.equal(observer.stats.ticker.at(-1)?.text, `yellow card, ${playerName(player.id, world)}`);

  world.rules!.pendingCard = { playerId: player.id, card: 'second-yellow' };
  applyStoppageCard(world);
  observer.observe(world, STEP);
  assert.equal(observer.stats.ticker.at(-1)?.kind, 'red');
  assert.ok(observer.stats.ticker.at(-1)?.text.startsWith('second yellow'));
  assert.deepEqual(observer.stats.ticker.map((item) => item.kind), ['yellow', 'red']);

  const sentOff = createWorld(6, 90);
  sentOff.phase = 'live';
  const redObserver = createStatsObserver();
  redObserver.observe(sentOff, STEP);
  const redPlayer = sentOff.players[TEAM_SIZE + 6]!;
  sentOff.rules!.pendingCard = { playerId: redPlayer.id, card: 'red' };
  applyStoppageCard(sentOff);
  redObserver.observe(sentOff, STEP);
  assert.equal(redObserver.stats.ticker.at(-1)?.kind, 'red');
  assert.ok(redObserver.stats.ticker.at(-1)?.text.startsWith('red card'));
});

test('broadcast clock advances monotonically through a regular half', () => {
  const world = createWorld(1, 90);
  const stats = createMatchStats();
  let previous = 0;
  for (let step = 0; step <= 60; step++) {
    world.clock = world.halfLength - step * 1.2;
    const label = broadcastClock(world, stats).label;
    const [minutes, seconds] = label.split(':').map(Number);
    const current = minutes! * 60 + seconds!;
    assert.ok(current >= previous, `${label} followed ${previous}`);
    previous = current;
  }
});

test('player names are unique and follow formation order', () => {
  const names = Array.from({ length: 22 }, (_, id) => playerName(id));
  assert.equal(new Set(names).size, 22);
  assert.equal(playerName(0), 'A. MORGAN');
  assert.equal(playerName(6), 'J. KIM');
  assert.equal(playerName(9), 'M. RIVERA');
  assert.equal(CLUBS[0].roster.length, 11);
  assert.equal(CLUBS[1].roster.length, 11);
});

test('possession and pass accuracy are presented as integer percentages', () => {
  const stats = createMatchStats();
  assert.deepEqual(possessionShare(stats), [50, 50]);
  stats.teams[0].possession = 3;
  stats.teams[1].possession = 1;
  assert.deepEqual(possessionShare(stats), [75, 25]);
  stats.teams[0].passes = 3;
  stats.teams[0].completed = 2;
  assert.equal(passAccuracy(stats.teams[0]), 67);
  assert.equal(passAccuracy(stats.teams[1]), 0);
});

test('stats observer reads rather than mutates the world', () => {
  const world = createWorld(3, 20);
  for (const player of world.players) { player.human = false; player.controlled = false; }
  const observer = createStatsObserver();
  const state = structuredClone(world);
  observer.observe(world, STEP);
  assert.deepEqual(world, state);
});

test('shots on target always equal goals from attempts plus the opposing keeper saves', () => {
  for (const seed of [17, 47, 89, 113, 226, 339, 452, 565]) {
    const { stats } = observeMatch(seed, 240);
    for (const team of [0, 1] as const) {
      const own = stats.teams[team], other = stats.teams[team === 0 ? 1 : 0];
      const scored = stats.goals.filter((goal) => goal.team === team && goal.kind === 'goal').length;
      assert.equal(own.onTarget, scored + other.saves, `seed ${seed} team ${team}: ${own.onTarget} on target, ${scored} goals, ${other.saves} saves`);
      assert.ok(own.onTarget <= own.shots && other.saves >= 0);
    }
  }
});

test('a parried shot that rolls in is a goal, not a save, and a headed goal is an attempt on target', () => {
  const observer = createStatsObserver();
  const world = createWorld(5);
  world.phase = 'live';
  world.carrierId = null;
  observer.observe(world, STEP);
  const shooter = world.players[9]!;
  const keeper = world.players.find((p) => p.team === 1 && p.slot === 'GK')!;
  world.kickEvent = { playerId: shooter.id, action: 'shoot', power: 0.8, time: world.clock };
  observer.observe(world, STEP);
  world.kickEvent = null;
  world.event = 'keeper parries';
  world.eventTime = 1.1;
  world.lastTouch = 1;
  world.lastToucherId = keeper.id;
  observer.observe(world, STEP);
  world.eventTime = 1;
  observer.observe(world, STEP);
  world.score = [1, 0];
  observer.observe(world, STEP);
  const [home, away] = observer.stats.teams;
  assert.deepEqual([home.shots, home.onTarget, home.goals, away.saves], [1, 1, 1, 0]);

  world.phase = 'live';
  world.kickEvent = { playerId: shooter.id, action: 'lob', power: 0.5, time: world.clock };
  observer.observe(world, STEP);
  world.kickEvent = null;
  world.score = [2, 0];
  observer.observe(world, STEP);
  assert.deepEqual([home.shots, home.onTarget, home.goals, away.saves], [2, 2, 2, 0]);
  assert.equal(home.onTarget, home.goals + away.saves);
});

test('a headed clearance is not counted as a shot', () => {
  const observer = createStatsObserver();
  const world = createWorld(5);
  world.phase = 'live';
  world.carrierId = null;
  observer.observe(world, STEP);
  world.kickEvent = { playerId: 3, action: 'shoot', power: 0.7, time: world.clock };
  world.event = 'headed clear';
  observer.observe(world, STEP);
  assert.equal(observer.stats.teams[0].shots, 0);
  world.kickEvent = { playerId: 9, action: 'shoot', power: 0.7, time: world.clock - 1 };
  world.event = 'header!';
  observer.observe(world, STEP);
  assert.equal(observer.stats.teams[0].shots, 1);
});
