import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeAI, simulateCpuMatchStats } from '../src/os/arcade/games/soccer/ai.ts';
import { createWorld, FIELD, findReceiver, nearestCarrier, restartTaker, setRestart, stepWorld, STEP, TEAM_SIZE, type World } from '../src/os/arcade/games/soccer/logic.ts';
import { parsePacket } from '../src/os/arcade/games/soccer/net.ts';
import {
  applyStoppageCard, checkOffside, clockLabel, cpuMayTackle, gradeFoul, indirectBlocksGoal,
  noteGoal, noteIndirectKick, noteKick, noteRestart, noteTouch, offsidePosition, onFoul,
  onsideProgress, rulesStep, sendOff, stepUpLine,
} from '../src/os/arcade/games/soccer/rules.ts';

function liveWorld(halfLength = 120) {
  const world = createWorld(12, halfLength);
  world.phase = 'live';
  world.restart = null;
  return world;
}

function separateTeams(world: World) {
  for (const player of world.players) {
    player.x = player.team === 0 ? -30 : 30;
    player.z = player.id % TEAM_SIZE * 2;
  }
}

test('offside uses the kick-time ball and second-last defender line with strict tolerance', () => {
  const world = liveWorld();
  separateTeams(world);
  const passer = world.players[6]!;
  const receiver = world.players[9]!;
  world.ball.x = 0;
  for (const defender of world.players.filter((player) => player.team === 1)) defender.x = 12;
  receiver.x = 12.1;
  assert.equal(offsidePosition(world, receiver), false);
  receiver.x = 12.12;
  assert.equal(offsidePosition(world, receiver), true);
  noteKick(world, passer, 'pass');
  assert.ok(world.rules!.snapshot?.flagged.includes(receiver.id));
  world.lastToucherId = passer.id;
  checkOffside(world, receiver);
  assert.equal(world.phase, 'restart');
  assert.equal(world.restart, 'free-kick');
  assert.equal(world.restartTeam, 1);
  assert.equal(world.event, 'offside');
  assert.equal(world.rules!.stats.offsides[0], 1);
  assert.equal(world.rules!.indirect?.team, 1);
});

test('offside snapshots respect restart exceptions and clear on onside or opponent receptions', () => {
  const world = liveWorld();
  separateTeams(world);
  const passer = world.players[6]!;
  const runner = world.players[9]!;
  world.ball.x = 0;
  runner.x = 30;
  for (const defender of world.players.filter((player) => player.team === 1)) defender.x = 10;
  for (const restart of ['kick-in', 'goal-kick', 'corner', 'penalty', 'kickoff'] as const) {
    world.restart = restart;
    noteKick(world, passer, 'pass');
    assert.equal(world.rules!.snapshot, null);
  }
  world.restart = 'free-kick';
  noteKick(world, passer, 'pass');
  assert.ok(world.rules!.snapshot);
  world.lastToucherId = passer.id;
  checkOffside(world, passer);
  assert.equal(world.rules!.snapshot, null);
  world.restart = null;
  noteKick(world, passer, 'pass');
  world.lastToucherId = TEAM_SIZE;
  checkOffside(world, world.players[TEAM_SIZE]!);
  assert.ok(world.rules!.snapshot);
  world.lastToucherId = TEAM_SIZE + 3;
  checkOffside(world, runner);
  assert.equal(world.rules!.snapshot, null);
});

test('offside depends on position at the kick, the halfway line, and the ball', () => {
  const onside = liveWorld();
  separateTeams(onside);
  const passer = onside.players[6]!;
  const runner = onside.players[9]!;
  for (const defender of onside.players.filter((player) => player.team === 1)) defender.x = 10;
  runner.x = 5; onside.ball.x = 0;
  noteKick(onside, passer, 'pass');
  runner.x = 30;
  onside.lastToucherId = passer.id;
  checkOffside(onside, runner);
  assert.equal(onside.phase, 'live');
  assert.equal(onside.rules!.stats.offsides[0], 0);
  assert.equal(onside.rules!.snapshot, null);

  const flagged = liveWorld();
  separateTeams(flagged);
  const flaggedPasser = flagged.players[6]!;
  const flaggedRunner = flagged.players[9]!;
  for (const defender of flagged.players.filter((player) => player.team === 1)) defender.x = 10;
  flaggedRunner.x = 30; flagged.ball.x = 0;
  noteKick(flagged, flaggedPasser, 'pass');
  flaggedRunner.x = 5;
  flagged.lastToucherId = flaggedPasser.id;
  checkOffside(flagged, flaggedRunner);
  assert.equal(flagged.event, 'offside');

  const ownHalf = liveWorld();
  separateTeams(ownHalf);
  const ownHalfRunner = ownHalf.players[9]!;
  for (const defender of ownHalf.players.filter((player) => player.team === 1)) defender.x = -10;
  ownHalfRunner.x = -5; ownHalf.ball.x = -20;
  assert.equal(offsidePosition(ownHalf, ownHalfRunner), false);
  ownHalfRunner.x = 10; ownHalf.ball.x = 20;
  assert.equal(offsidePosition(ownHalf, ownHalfRunner), false);
  ownHalf.rules!.offside = false;
  ownHalfRunner.x = 30; ownHalf.ball.x = 0;
  assert.equal(offsidePosition(ownHalf, ownHalfRunner), false);
  noteKick(ownHalf, ownHalf.players[6]!, 'pass');
  assert.equal(ownHalf.rules!.snapshot, null);
});

test('an offside snapshot survives a goalkeeper save but penalizes a flagged rebound receiver', () => {
  const world = liveWorld();
  separateTeams(world);
  const passer = world.players[6]!;
  const runner = world.players[9]!;
  const keeper = world.players[TEAM_SIZE]!;
  for (const defender of world.players.filter((player) => player.team === 1)) defender.x = 10;
  runner.x = 30; world.ball.x = 0;
  noteKick(world, passer, 'through');
  world.lastToucherId = keeper.id;
  checkOffside(world, keeper);
  assert.ok(world.rules!.snapshot);
  checkOffside(world, runner);
  assert.equal(world.event, 'offside');
});

test('indirect free kicks block a direct goal until another player touches the ball', () => {
  const world = liveWorld();
  world.rules!.indirect = { team: 0, takerId: null };
  noteIndirectKick(world, 'free-kick', 0, 6);
  world.lastToucherId = 6;
  assert.equal(indirectBlocksGoal(world), true);
  noteTouch(world, 6);
  assert.equal(indirectBlocksGoal(world), true);
  noteTouch(world, 8);
  assert.equal(indirectBlocksGoal(world), false);
});

test('attacking AI receiver selection excludes offside teammates', () => {
  const world = liveWorld();
  separateTeams(world);
  const passer = world.players[6]!;
  const legal = world.players[8]!;
  const offside = world.players[9]!;
  for (const defender of world.players.filter((player) => player.team === 1)) defender.x = 10;
  passer.x = 0; passer.z = 0; world.ball.x = 0;
  legal.x = 5; legal.z = 0;
  offside.x = 30; offside.z = 0;
  assert.equal(offsidePosition(world, offside), true);
  assert.equal(findReceiver(world, passer, { x: 1, z: 0 }, false, false, true)?.id, legal.id);
});

test('a direct goal from an indirect free kick is disallowed, but a second touch permits it', () => {
  const shoot = (secondTouch: boolean) => {
    const world = liveWorld();
    for (const player of world.players) { player.x = 0; player.z = 20; }
    world.ball = { x: FIELD.length / 2 - 0.2, y: 0.11, z: 0, vx: 30, vy: 0, vz: 0, spin: 0, grounded: true, inNet: false };
    world.rules!.indirect = { team: 0, takerId: 6 };
    world.lastToucherId = 6;
    if (secondTouch) noteTouch(world, 8);
    stepWorld(world, STEP);
    return world;
  };
  const direct = shoot(false);
  assert.deepEqual(direct.score, [0, 0]);
  assert.equal(direct.restart, 'goal-kick');
  const touched = shoot(true);
  assert.deepEqual(touched.score, [1, 0]);
});

test('foul grading applies approach, speed, ball-contact, DOGSO and second-yellow rules', () => {
  const world = liveWorld();
  const offender = world.players[TEAM_SIZE + 6]!;
  const victim = world.players[6]!;
  victim.x = 0; victim.z = 0; victim.facing = Math.PI / 2;
  offender.x = -1; offender.z = 0; offender.vx = 8;
  assert.equal(gradeFoul(world, offender, victim, 'tackle', false).card, 'yellow');
  assert.equal(gradeFoul(world, offender, victim, 'slide', false).card, 'red');
  offender.x = -1; offender.z = 0; offender.vx = 0;
  assert.equal(gradeFoul(world, offender, victim, 'tackle', false).card, null);
  offender.x = 0; offender.z = 1;
  assert.equal(gradeFoul(world, offender, victim, 'slide', true).card, null);
  offender.x = -1; offender.z = 0; offender.vx = 8;
  world.rules!.yellows.push(offender.id);
  assert.equal(gradeFoul(world, offender, victim, 'tackle', false).card, 'second-yellow');

  separateTeams(world);
  world.rules!.yellows = [];
  victim.x = FIELD.length / 2 - 6; victim.z = 0; victim.facing = Math.PI / 2; victim.vx = 4;
  offender.x = -30; offender.z = 20;
  for (const player of world.players.filter((candidate) => candidate.team === offender.team && candidate.slot !== 'GK')) {
    player.x = -30; player.z = 20;
  }
  world.ball.x = victim.x; world.ball.z = victim.z; world.lastTouch = victim.team;
  assert.equal(gradeFoul(world, offender, victim, 'tackle', false).dogso, true);
  assert.equal(gradeFoul(world, offender, victim, 'tackle', false).card, 'yellow');
  assert.equal(onFoul(world, offender, victim, 'tackle', false), 'stop');
  setRestart(world, victim.team, 'penalty', victim);
  assert.equal(world.restart, 'penalty');
  assert.equal(world.rules!.stats.yellows[offender.team], 1);
  victim.x = FIELD.length / 2 - 20;
  world.ball.x = victim.x;
  assert.equal(gradeFoul(world, offender, victim, 'tackle', false).card, 'red');
  world.phase = 'live'; world.restart = null; world.lastTouch = victim.team;
  assert.equal(onFoul(world, offender, victim, 'tackle', false), 'stop');
  setRestart(world, victim.team, 'free-kick', victim);
  assert.equal(offender.sentOff, true);
  assert.equal(world.players.filter((player) => player.team === offender.team && !player.sentOff).length, 10);
});

test('sending off removes a player from control, carrier and CPU command selection', () => {
  const world = liveWorld();
  const dismissed = world.players[6]!;
  sendOff(world, dismissed);
  assert.equal(dismissed.sentOff, true);
  assert.equal(dismissed.human, false);
  assert.equal(world.controlled[0] === dismissed.id, false);
  assert.ok(world.players[world.controlled[0]!]!.human);
  assert.ok(Math.abs(dismissed.z) > FIELD.width / 2);
  world.phase = 'goal'; world.eventTime = 0; world.restart = 'kickoff'; world.restartTeam = 1;
  stepWorld(world, STEP);
  assert.equal(world.players.filter((player) => player.team === 0 && !player.sentOff
    && Math.abs(player.x) <= FIELD.length / 2 && Math.abs(player.z) <= FIELD.width / 2).length, 10);
  const kickoff = liveWorld();
  kickoff.restart = 'kickoff';
  kickoff.players[9]!.sentOff = true;
  assert.equal(restartTaker(kickoff).id, 8);
  const goalKick = liveWorld();
  goalKick.restart = 'goal-kick';
  assert.equal(restartTaker(goalKick).id, 0);
  world.ball.x = dismissed.x; world.ball.z = dismissed.z;
  assert.notEqual(nearestCarrier(world)?.id, dismissed.id);
  const commands = computeAI(world, 'normal', STEP, 1, 0);
  assert.equal(commands.has(dismissed.id), false);
  const defenderDismissal = liveWorld();
  sendOff(defenderDismissal, defenderDismissal.players[1]!);
  assert.equal(defenderDismissal.players[8]!.slot, 'LB');
  assert.equal(defenderDismissal.players[8]!.formation, 1);
  const keeperDismissal = liveWorld();
  sendOff(keeperDismissal, keeperDismissal.players[0]!);
  assert.equal(keeperDismissal.players[9]!.slot, 'GK');
  assert.equal(keeperDismissal.players[9]!.formation, 0);
});

test('advantage is played only with possession and space, then whistles at the foul spot if lost', () => {
  const world = liveWorld();
  separateTeams(world);
  const victim = world.players[6]!;
  const offender = world.players[TEAM_SIZE + 6]!;
  victim.x = 0.2; victim.z = 0; world.ball.x = victim.x; world.ball.z = victim.z;
  offender.x = -2; offender.z = 0; offender.vx = 8; victim.facing = Math.PI / 2;
  world.lastTouch = victim.team;
  assert.equal(onFoul(world, offender, victim, 'tackle', false), 'advantage');
  assert.ok(world.rules!.advantage);
  world.lastTouch = offender.team;
  rulesStep(world, STEP);
  assert.equal(world.phase, 'restart');
  assert.equal(world.restartTeam, victim.team);
  assert.deepEqual(world.restartAt, { x: victim.x, z: victim.z });
  assert.equal(world.event, 'foul');

  const crowded = liveWorld();
  separateTeams(crowded);
  const carrier = crowded.players[6]!;
  const tackler = crowded.players[TEAM_SIZE + 6]!;
  const cover = crowded.players[TEAM_SIZE + 5]!;
  carrier.x = 0; carrier.z = 0; crowded.ball.x = 0; crowded.ball.z = 0;
  tackler.x = -0.6; tackler.z = 0;
  cover.x = 0.5; cover.z = 0;
  assert.equal(onFoul(crowded, tackler, carrier, 'tackle', false), 'stop');
  assert.equal(crowded.rules!.advantage, null);
});

test('retained advantage defers the card to the next stoppage', () => {
  const world = liveWorld();
  separateTeams(world);
  const victim = world.players[6]!;
  const offender = world.players[TEAM_SIZE + 6]!;
  victim.x = 0.2; victim.z = 0; victim.facing = Math.PI / 2;
  world.ball.x = victim.x; world.ball.z = victim.z; world.lastTouch = victim.team;
  offender.x = -2; offender.z = 0; offender.vx = 8;
  assert.equal(onFoul(world, offender, victim, 'tackle', false), 'advantage');
  rulesStep(world, 3);
  assert.equal(world.rules!.advantage, null);
  assert.equal(world.rules!.pendingCard?.playerId, offender.id);
  setRestart(world, victim.team, 'free-kick', victim);
  assert.equal(offender.sentOff, undefined);
  assert.equal(world.rules!.stats.yellows[offender.team], 1);
  assert.equal(world.rules!.pendingCard, null);
});

test('AI holds the onside line and steps its defensive line up on a back pass', () => {
  const world = liveWorld();
  separateTeams(world);
  const defender = world.players[1]!;
  const midfielder = world.players[6]!;
  const opponent = world.players[TEAM_SIZE + 6]!;
  for (const player of world.players.filter((candidate) => candidate.team === 1)) player.x = 15;
  defender.x = 30;
  world.ball.x = 0;
  assert.equal(onsideProgress(world, defender, 40), 14.85);

  defender.x = -45; defender.z = 0;
  opponent.x = -29; opponent.z = 0; opponent.facing = Math.PI / 2;
  world.ball.x = -29; world.ball.vx = 4;
  for (const player of world.players.filter((candidate) => candidate.team === 0 && candidate.id !== defender.id)) {
    player.x = -45; player.z = 20;
  }
  for (const player of world.players.filter((candidate) => candidate.team === 1 && candidate.id !== opponent.id)) {
    player.x = -29; player.z = 20;
  }
  assert.ok(stepUpLine(world, defender, -45) > -45);
  assert.ok(stepUpLine(world, defender, -45) <= world.ball.x - 3);
  defender.x = -11; defender.z = 0; opponent.x = -10; opponent.z = 0; opponent.facing = Math.PI / 2;
  assert.notEqual(defender.slot, 'CM');
  assert.equal(cpuMayTackle(world, defender, opponent), false);
  midfielder.x = -21; opponent.x = -20;
  assert.equal(cpuMayTackle(world, midfielder, opponent), true);
});

test('normal CPU passes never snapshot an attacker in an offside position', () => {
  const world = liveWorld();
  for (const player of world.players) { player.human = false; player.controlled = false; }
  for (const player of world.players.filter((candidate) => candidate.team === 0)) {
    player.x = 10; player.z = player.id % TEAM_SIZE * 3;
  }
  for (const player of world.players.filter((candidate) => candidate.team === 1)) {
    player.x = 20; player.z = player.id % TEAM_SIZE * 3;
  }
  const carrier = world.players[6]!;
  const receiver = world.players[9]!;
  world.players[0]!.x = -FIELD.length / 2;
  world.players[0]!.z = 0;
  carrier.x = 10; carrier.z = 0; carrier.facing = Math.PI / 2;
  receiver.x = 15; receiver.z = 0;
  world.ball.x = carrier.x; world.ball.z = carrier.z; world.carrierId = carrier.id; world.lastTouch = 0;
  let cpuPasses = 0;
  for (let tick = 1; tick <= 300; tick++) {
    const commands = computeAI(world, 'normal', STEP, tick, 0);
    stepWorld(world, STEP, commands);
    if (world.kickEvent && world.kickEvent.playerId < TEAM_SIZE
      && ['pass', 'through', 'lob'].includes(world.kickEvent.action)) {
      cpuPasses++;
      assert.equal(world.rules!.snapshot?.flagged.length, 0);
    }
  }
  assert.ok(cpuPasses > 0);
});

test('added time extends full time and holds for an attack in the penalty area', () => {
  const world = liveWorld(45);
  world.clock = STEP;
  world.rules!.added = 2;
  world.ball.x = FIELD.length / 2 - FIELD.penaltyDepth / 2;
  world.ball.z = 0;
  world.lastTouch = 0;
  stepWorld(world, STEP);
  assert.equal(world.phase, 'live');
  assert.equal(world.rules!.stoppage?.minutes, 2);
  assert.equal(world.rules!.board?.minutes, 2);
  assert.equal(clockLabel(world), '45+1');
  for (let tick = 0; tick < 61; tick++) stepWorld(world, STEP);
  assert.equal(world.phase, 'live');
  assert.equal(clockLabel(world), '45+2');
  for (let tick = 0; tick < 61; tick++) stepWorld(world, STEP);
  assert.ok(world.rules!.stoppage!.hold > 0);
  for (let tick = 0; tick < 120; tick++) stepWorld(world, STEP);
  assert.equal(world.rules!.board, null);
  for (let tick = 0; tick < 8 * 60 + 30 && world.phase === 'live'; tick++) stepWorld(world, STEP);
  assert.equal(world.phase, 'half-time');
  assert.ok(world.rules!.stoppage === null);
  world.eventTime = 0;
  stepWorld(world, STEP);
  assert.equal(world.half, 2);
  assert.equal(world.rules!.added, 0);
});

test('goal, restart and card delays accumulate into added time', () => {
  const world = liveWorld();
  noteRestart(world, 'free-kick');
  noteRestart(world, 'corner');
  noteGoal(world, 0);
  world.rules!.pendingCard = { playerId: 6, card: 'yellow' };
  applyStoppageCard(world);
  assert.ok(Math.abs(world.rules!.added - 1.33) < 1e-9);
  assert.equal(world.rules!.stats.yellows[0], 1);
});

test('network snapshots strictly validate law state and player dismissal metadata', () => {
  const base = createWorld();
  const packet = (state: unknown) => parsePacket({ t: 'soccer', k: 's', r: 1, seq: 0, state });
  assert.ok(packet(base));
  const badPlayer = structuredClone(base);
  (badPlayer.players[0] as unknown as Record<string, unknown>).sentOff = 'yes';
  assert.equal(packet(badPlayer), null);
  const badFormation = structuredClone(base);
  badFormation.players[0]!.formation = 11;
  assert.equal(packet(badFormation), null);
  const badRules = structuredClone(base);
  badRules.rules!.stats.fouls = [-1, 0];
  assert.equal(packet(badRules), null);
  const badSnapshot = structuredClone(base);
  badSnapshot.rules!.snapshot = { team: 0, passerId: 6, flagged: [99] };
  assert.equal(packet(badSnapshot), null);
  assert.equal(parsePacket({ t: 'soccer', k: 'cfg', r: 1, seq: 0, half: 4, level: 1, offside: 'on' }), null);
});

test('CPU match averages stay within the foul and offside limits and reach full time', () => {
  const matches = [17, 47, 89, 103].map((seed) => simulateCpuMatchStats(seed, 'normal', 'normal', 240));
  for (const match of matches) assert.equal(match.world.phase, 'full-time');
  const fouls = matches.reduce((total, match) => total + match.world.rules!.stats.fouls[0] + match.world.rules!.stats.fouls[1], 0)
    / (matches.length * 2);
  const offsides = matches.reduce((total, match) => total + match.world.rules!.stats.offsides[0] + match.world.rules!.stats.offsides[1], 0)
    / (matches.length * 2);
  const yellows = matches.reduce((total, match) => total + match.world.rules!.stats.yellows[0] + match.world.rules!.stats.yellows[1], 0)
    / matches.length;
  const reds = matches.reduce((total, match) => total + match.world.rules!.stats.reds[0] + match.world.rules!.stats.reds[1], 0)
    / matches.length;
  console.info(`soccer law CPU averages (${matches.length} matches): fouls/team ${fouls.toFixed(2)}, offsides/team ${offsides.toFixed(2)}, yellow/match ${yellows.toFixed(2)}, red/match ${reds.toFixed(2)}`);
  assert.ok(fouls <= 2, `fouls per team per match: ${fouls}`);
  assert.ok(offsides <= 2.5, `offsides per team per match: ${offsides}`);
  assert.equal(reds, 0, `red cards per match: ${reds}`);
});
