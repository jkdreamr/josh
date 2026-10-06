import assert from 'node:assert/strict';
import test from 'node:test';
import {
  awardPoint, chooseShot, contactAccuracy, cpuChooseShot, CPU_PROFILES, COURT_HALF_LENGTH, createFlight, directionOf, endOf, isNetFault, NET_HEIGHT,
  newMatch, newStats, planShot, pointSituation, recordRally, recordSmash, serveFault, serviceCourt, SHORT_SERVICE_LINE, simulateLanding, simulateNetClearance,
  solveLaunchVelocity, startNextGame, stepFlight, takeInterval, terminalSpeedAfter, tumbleHeading, type MatchState, type ShotType,
} from '../src/os/games/badminton.ts';

const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

test('shuttle drag approaches its 6.8 m/s terminal speed', () => {
  assert.ok(Math.abs(terminalSpeedAfter(5, { x: 4, y: 10 }) - 6.8) < 0.05);
});

test('shooting solver lands a clear inside the opponent back boundary', () => {
  const start = { x: -3.2, y: 2.4 };
  const target = { x: 6.15, y: 0 };
  const velocity = solveLaunchVelocity(start, target, 42);
  const landing = simulateLanding(start, velocity);
  assert.ok(Math.abs(landing.x - target.x) <= 0.15, `${landing.x} != ${target.x}`);
});

test('flags a net crossing below 1.524 m', () => {
  assert.equal(isNetFault({ x: -0.2, y: 1.2 }, { x: 0.2, y: 1.4 }), true);
});

test('a shuttle remains playable past the baseline and is out only when it lands', () => {
  let flight = createFlight({ x: 6.6, y: 1 }, { vx: 6, vy: 0 }, 'a', 1);
  flight = stepFlight(flight, 0.1);
  assert.ok(flight.shuttle.x > 6.7);
  assert.equal(flight.status, 'flying');

  while (flight.status === 'flying') flight = stepFlight(flight, 0.05);
  assert.equal(flight.status, 'fault');
  assert.equal(flight.fault, 'out');
  assert.equal(flight.shuttle.y, 0);
});

test('a shuttle that lands on the hitter side is an own-side fault from either end', () => {
  let flight = createFlight({ x: 3, y: 1 }, { vx: 2, vy: 1 }, 'b', -1);
  while (flight.status === 'flying') flight = stepFlight(flight, 0.05);
  assert.equal(flight.fault, 'own-side');
});

test('every stroke from a clean contact clears the net and lands in from both ends', () => {
  const random = seeded(7);
  const contacts: Array<{ type: ShotType; start: { x: number; y: number } }> = [
    { type: 'clear', start: { x: -5.4, y: 2.3 } },
    { type: 'clear', start: { x: -2.6, y: 1.9 } },
    { type: 'drop', start: { x: -4.8, y: 2.2 } },
    { type: 'drop', start: { x: -2.4, y: 1.9 } },
    { type: 'smash', start: { x: -3.2, y: 2.7 } },
    { type: 'smash', start: { x: -1.6, y: 2.5 } },
    { type: 'drive', start: { x: -3.8, y: 1.3 } },
    { type: 'drive', start: { x: -1.4, y: 1.4 } },
    { type: 'net', start: { x: -1, y: 0.5 } },
    { type: 'net', start: { x: -2.1, y: 0.9 } },
    { type: 'lift', start: { x: -1.2, y: 0.4 } },
    { type: 'lift', start: { x: -4.5, y: 0.8 } },
    { type: 'serve', start: { x: -2.9, y: 1.05 } },
    { type: 'high-serve', start: { x: -2.9, y: 1.05 } },
  ];
  for (const direction of [1, -1] as const) {
    for (const { type, start } of contacts) {
      for (let repeat = 0; repeat < 6; repeat += 1) {
        const mirrored = { x: start.x * direction, y: start.y };
        const plan = planShot(type, direction, mirrored, random);
        assert.equal(plan.fault, undefined, `${type} planned a fault`);
        const clearance = simulateNetClearance(mirrored, plan.velocity);
        assert.ok(clearance !== null && clearance >= NET_HEIGHT, `${type} from ${mirrored.x},${mirrored.y} crossed at ${clearance}`);
        const landing = simulateLanding(mirrored, plan.velocity);
        assert.ok(landing.x * direction > 0 && Math.abs(landing.x) <= COURT_HALF_LENGTH, `${type} landed at ${landing.x}`);
        if (type === 'serve' || type === 'high-serve') assert.ok(Math.abs(landing.x) >= SHORT_SERVICE_LINE, `${type} was short`);
      }
    }
  }
});

test('a stretched contact scatters more than a clean one', () => {
  const landings = (accuracy: number) => {
    const random = seeded(3);
    const xs: number[] = [];
    for (let repeat = 0; repeat < 40; repeat += 1) {
      const plan = planShot('clear', 1, { x: -4, y: 2.2 }, random, accuracy);
      xs.push(simulateLanding({ x: -4, y: 2.2 }, plan.velocity).x);
    }
    const mean = xs.reduce((sum, x) => sum + x, 0) / xs.length;
    return Math.sqrt(xs.reduce((sum, x) => sum + (x - mean) ** 2, 0) / xs.length);
  };
  assert.ok(landings(0.2) > landings(1) * 2);
  assert.equal(contactAccuracy(0, 1), 1);
  assert.ok(contactAccuracy(1, 1) < 0.15);
});

test('smashes travel downward, faster than any other stroke, and a smash from low contact becomes a drive', () => {
  const random = seeded(11);
  const smash = planShot('smash', 1, { x: -3, y: 2.8 }, random);
  assert.equal(smash.type, 'smash');
  assert.ok(smash.velocity.vy < 0);
  assert.ok(Math.hypot(smash.velocity.vx, smash.velocity.vy) > 40);
  const drop = planShot('drop', 1, { x: -4.5, y: 2.2 }, random);
  assert.ok(Math.hypot(drop.velocity.vx, drop.velocity.vy) < 20);
  const low = planShot('smash', 1, { x: -3, y: 1.4 }, random);
  assert.equal(low.type, 'drive');
});

test('stroke choice follows contact height and intent', () => {
  assert.equal(chooseShot('normal', { x: -4, y: 2.2 }), 'clear');
  assert.equal(chooseShot('power', { x: -4, y: 2.6 }), 'smash');
  assert.equal(chooseShot('power', { x: -4, y: 1.8 }), 'drive');
  assert.equal(chooseShot('soft', { x: -4, y: 2.2 }), 'drop');
  assert.equal(chooseShot('normal', { x: -1.5, y: 1.2 }), 'net');
  assert.equal(chooseShot('normal', { x: -4, y: 1.2 }), 'drive');
  assert.equal(chooseShot('normal', { x: -1, y: 0.5 }), 'net');
  assert.equal(chooseShot('normal', { x: -4, y: 0.5 }), 'lift');
  assert.equal(chooseShot('power', { x: -1, y: 0.5 }), 'lift');
});

test('the shuttle nose tumbles round after a hit and settles on the flight direction', () => {
  let heading = 0;
  for (let step = 0; step < 240; step += 1) heading = tumbleHeading(heading, -8, 4, 1 / 240);
  const expected = Math.atan2(4, -8);
  assert.ok(Math.abs(Math.atan2(Math.sin(heading - expected), Math.cos(heading - expected))) < 0.02);
  const quick = tumbleHeading(0, -50, -20, 1 / 240);
  const slow = tumbleHeading(0, -4, -2, 1 / 240);
  assert.ok(Math.abs(quick) > Math.abs(slow));
});

test('serves alternate service courts by server score parity', () => {
  let match = newMatch('game');
  assert.equal(serviceCourt(match), 'right');
  match = awardPoint(match, 'a');
  assert.equal(serviceCourt(match), 'left');
  match = awardPoint(match, 'b');
  assert.equal(serviceCourt(match), 'left');
  match = awardPoint(match, 'a');
  assert.equal(serviceCourt(match), 'right');
});

test('rally scoring wins 22-20 from 20-all and the match in a best of three', () => {
  let match: MatchState = { ...newMatch('match'), game: 2, games: { a: 1, b: 0 }, points: { a: 20, b: 20 } };
  assert.deepEqual(pointSituation(match), []);
  match = awardPoint(match, 'a');
  assert.deepEqual(pointSituation(match), [{ side: 'a', kind: 'match' }]);
  assert.equal(match.matchWinner, null);
  match = awardPoint(match, 'a');
  assert.equal(match.matchWinner, 'a');
  assert.deepEqual(match.games, { a: 2, b: 0 });
  assert.deepEqual(match.points, { a: 22, b: 20 });
  assert.deepEqual(match.history.at(-1), { a: 22, b: 20 });
});

test('a 30-29 game ends at the cap and both players hold game point at 29-all', () => {
  const tied: MatchState = { ...newMatch('game'), points: { a: 29, b: 29 } };
  assert.deepEqual(pointSituation(tied).map((entry) => entry.side), ['a', 'b']);
  const match = awardPoint(tied, 'b');
  assert.equal(match.matchWinner, 'b');
  assert.deepEqual(match.points, { a: 29, b: 30 });
});

test('a quick game runs to 11 with a cap at 15 and no interval', () => {
  let match: MatchState = { ...newMatch('quick'), points: { a: 10, b: 9 } };
  assert.deepEqual(pointSituation(match), [{ side: 'a', kind: 'match' }]);
  match = awardPoint(match, 'a');
  assert.equal(match.matchWinner, 'a');
  assert.equal(awardPoint({ ...newMatch('quick'), points: { a: 10, b: 10 } }, 'a').intervalDue, false);
  assert.equal(awardPoint({ ...newMatch('quick'), points: { a: 14, b: 14 } }, 'b').matchWinner, 'b');
});

test('the interval comes once, when the leading score first reaches 11', () => {
  let match: MatchState = { ...newMatch('game'), points: { a: 10, b: 4 } };
  match = awardPoint(match, 'a');
  assert.equal(match.intervalDue, true);
  match = takeInterval(match);
  assert.equal(match.intervalDue, false);
  assert.equal(match.endsSwitched, false);
  match = awardPoint({ ...match, points: { a: 11, b: 10 } }, 'b');
  assert.equal(match.intervalDue, false);
});

test('best of three changes ends between games and at 11 in the decider', () => {
  let match = awardPoint({ ...newMatch('match'), points: { a: 20, b: 0 } }, 'a');
  assert.deepEqual(match.games, { a: 1, b: 0 });
  assert.equal(match.gameWinner, 'a');
  assert.equal(match.matchWinner, null);
  assert.equal(match.game, 1);
  match = startNextGame(match);
  assert.equal(match.game, 2);
  assert.equal(match.endsSwitched, true);
  assert.equal(match.server, 'a');
  assert.equal(endOf('a', match), 'right');
  assert.equal(directionOf('a', match), -1);
  assert.deepEqual(match.points, { a: 0, b: 0 });
  match = startNextGame(awardPoint({ ...match, points: { a: 0, b: 20 } }, 'b'));
  assert.equal(match.game, 3);
  assert.equal(match.endsSwitched, false);
  match = takeInterval(awardPoint({ ...match, points: { a: 10, b: 8 } }, 'a'));
  assert.equal(match.endsSwitched, true, 'ends change at 11 in the third game');
  match = awardPoint({ ...match, points: { a: 20, b: 8 } }, 'a');
  assert.equal(match.matchWinner, 'a');
});

test('serve contact above 1.15 m is a fault', () => {
  assert.equal(serveFault(1.151, 4, 1), 'serve-height');
  assert.equal(serveFault(1.15, 4, 1), undefined);
  assert.equal(serveFault(1.05, -1.2, -1), 'short-serve');
});

test('match stats count winners, errors, smashes and the longest rally', () => {
  let stats = newStats();
  stats = recordRally(stats, { winner: 'a', cause: 'in', shots: 9, seconds: 7.5 });
  stats = recordRally(stats, { winner: 'b', cause: 'out', shots: 3, seconds: 2 });
  stats = recordSmash(stats, 'a', 52);
  stats = recordSmash(stats, 'a', 48);
  assert.equal(stats.a.points, 1);
  assert.equal(stats.a.winners, 1);
  assert.equal(stats.a.errors, 1);
  assert.equal(stats.b.points, 1);
  assert.equal(stats.b.winners, 0);
  assert.equal(stats.a.smashes, 2);
  assert.equal(stats.a.fastestSmash, 52);
  assert.equal(stats.longestRally, 9);
  assert.equal(stats.rallies, 2);
});

test('the computer keeps its stroke habits and its difficulty ladder', () => {
  assert.equal(cpuChooseShot({ x: 3, y: 2.6 }, 4, CPU_PROFILES.normal), 'smash');
  assert.equal(cpuChooseShot({ x: 1, y: 0.6 }, 4, CPU_PROFILES.normal), 'net');
  assert.equal(cpuChooseShot({ x: 5.2, y: 1.3 }, 4, CPU_PROFILES.normal), 'clear');
  assert.equal(cpuChooseShot({ x: 3.5, y: 1.3 }, 4, CPU_PROFILES.normal), 'drive');
  assert.equal(cpuChooseShot({ x: 4, y: 2 }, 5, CPU_PROFILES.hard, () => 0.99), 'clear');
  assert.equal(cpuChooseShot({ x: 4, y: 2 }, 5, CPU_PROFILES.hard, () => 0.01), 'drop');
  assert.ok(CPU_PROFILES.easy.reactionMs > CPU_PROFILES.normal.reactionMs && CPU_PROFILES.normal.reactionMs > CPU_PROFILES.hard.reactionMs);
  assert.ok(CPU_PROFILES.easy.speed < CPU_PROFILES.normal.speed && CPU_PROFILES.normal.speed < CPU_PROFILES.hard.speed);
  assert.ok(CPU_PROFILES.easy.accuracy < CPU_PROFILES.hard.accuracy);
});
