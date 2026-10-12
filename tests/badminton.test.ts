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

const inclusiveRange = (start: number, end: number, step: number) => {
  const values: number[] = [];
  for (let value = start; value <= end + 1e-9; value += step) values.push(value);
  if (values.at(-1) !== end) values.push(end);
  return values;
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

test('every stroke clears the net and lands in from every legal contact', () => {
  const sweeps: Array<{ type: ShotType; minY: number; maxY: number }> = [
    { type: 'clear', minY: 0.95, maxY: 3.2 },
    { type: 'drop', minY: 1, maxY: 3.2 },
    { type: 'smash', minY: 2, maxY: 3.2 },
    { type: 'drive', minY: 0.95, maxY: 2.4 },
    { type: 'net', minY: 0.25, maxY: 1.75 },
    { type: 'lift', minY: 0.25, maxY: 1 },
  ];
  const directions = [1, -1] as const;
  const xs = inclusiveRange(-6.7, -0.3, 0.4);
  let sample = 0;
  const checkPlan = (type: ShotType, x: number, y: number, seed: number) => {
    for (const direction of directions) {
      const start = { x: x * direction, y };
      const plan = planShot(type, direction, start, seeded(seed * 7919 + 12345));
      const context = `${type} from (${start.x},${y}), direction ${direction}, seed ${seed}`;
      assert.equal(plan.fault, undefined, `${context} planned ${plan.fault}`);
      const clearance = simulateNetClearance(start, plan.velocity);
      assert.ok(clearance !== null && clearance >= NET_HEIGHT, `${context} crossed at ${clearance}`);
      const landing = simulateLanding(start, plan.velocity);
      assert.ok(landing.x * direction > 0 && Math.abs(landing.x) <= COURT_HALF_LENGTH, `${context} landed at ${landing.x}`);
      if (type !== 'smash') {
        if (Math.abs(start.x) >= 0.65) assert.ok(Math.abs(landing.x - plan.targetX) <= 0.3, `${context} landed at ${landing.x}, target ${plan.targetX}`);
      } else {
        assert.ok(plan.type === 'smash' || plan.type === 'drive', `${context} planned ${plan.type}`);
        if (y >= 2.4) assert.equal(plan.type, 'smash', `${context} fell back to drive`);
        if (plan.type === 'smash') {
          const speed = Math.hypot(plan.velocity.vx, plan.velocity.vy);
          assert.ok(plan.velocity.vy < 0, `${context} had vy ${plan.velocity.vy}`);
          assert.ok(speed >= 42, `${context} had speed ${speed}`);
          assert.ok(clearance >= NET_HEIGHT + 0.1, `${context} cleared at ${clearance}`);
        }
      }
      if (type === 'serve' || type === 'high-serve') {
        assert.ok(Math.abs(landing.x) >= SHORT_SERVICE_LINE, `${context} landed short at ${landing.x}`);
      }
    }
  };

  for (const { type, minY, maxY } of sweeps) {
    for (const x of xs) {
      for (const y of inclusiveRange(minY, maxY, 0.15)) {
        for (let repeat = 0; repeat < 4; repeat += 1) checkPlan(type, x, y, ++sample);
      }
    }
  }
  for (const type of ['serve', 'high-serve'] as const) {
    for (const x of inclusiveRange(-6.2, -2, 0.4)) {
      for (let repeat = 0; repeat < 4; repeat += 1) checkPlan(type, x, 1.05, ++sample);
    }
  }
});

test('smashes are steep from the front and flatter from the back', () => {
  const smashProfile = (start: { x: number; y: number }) => {
    const depths: number[] = [];
    const angles: number[] = [];
    for (let seed = 1; seed <= 20; seed += 1) {
      const plan = planShot('smash', 1, start, seeded(seed * 7919 + 12345));
      assert.equal(plan.type, 'smash', `smash from (${start.x},${start.y}) fell back to ${plan.type}`);
      const landing = simulateLanding(start, plan.velocity);
      depths.push(landing.x);
      angles.push(Math.atan2(-plan.velocity.vy, Math.abs(plan.velocity.vx)) * 180 / Math.PI);
    }
    return {
      meanDepth: depths.reduce((sum, depth) => sum + depth, 0) / depths.length,
      meanAngle: angles.reduce((sum, angle) => sum + angle, 0) / angles.length,
      depths,
    };
  };
  const back = smashProfile({ x: -6.2, y: 2.8 });
  for (const depth of back.depths) assert.ok(depth >= 3 && depth <= 5.6, `back-court smash landed ${depth} m past the net`);
  assert.ok(back.meanAngle < 12, `back-court mean downward angle was ${back.meanAngle}°`);

  const front = smashProfile({ x: -1, y: 3 });
  assert.ok(front.meanAngle > 30, `front-court mean downward angle was ${front.meanAngle}°`);
  assert.ok(front.meanDepth < 3.5, `front-court mean depth was ${front.meanDepth} m`);
  assert.ok(front.meanAngle > back.meanAngle, `front angle ${front.meanAngle}° did not exceed back angle ${back.meanAngle}°`);
});

test('a stretched smash can still find the net', () => {
  const start = { x: -5.5, y: 2.8 };
  const sweep = (accuracy: number) => {
    const depths: number[] = [];
    let failsNet = 0;
    let landedIn = 0;
    for (let seed = 1; seed <= 400; seed += 1) {
      const plan = planShot('smash', 1, start, seeded(seed * 7919 + 12345), accuracy);
      const clearance = simulateNetClearance(start, plan.velocity);
      if (clearance === null || clearance < NET_HEIGHT) failsNet += 1;
      const landing = simulateLanding(start, plan.velocity);
      depths.push(landing.x);
      if (landing.x > 0 && Math.abs(landing.x) <= COURT_HALF_LENGTH) landedIn += 1;
    }
    const meanDepth = depths.reduce((sum, depth) => sum + depth, 0) / depths.length;
    const depthDeviation = Math.sqrt(depths.reduce((sum, depth) => sum + (depth - meanDepth) ** 2, 0) / depths.length);
    return { failsNet, landedIn, depthDeviation };
  };
  const stretched = sweep(0.2);
  const clean = sweep(1);
  assert.ok(stretched.failsNet > 0, `no stretched smash crossed low or missed the net; count ${stretched.failsNet}/400`);
  assert.ok(stretched.landedIn >= 360, `only ${stretched.landedIn}/400 stretched smashes landed in`);
  assert.ok(
    stretched.depthDeviation >= clean.depthDeviation * 1.25,
    `stretched landing-depth deviation ${stretched.depthDeviation} was less than 1.25x clean deviation ${clean.depthDeviation}`,
  );
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
