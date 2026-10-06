import assert from 'node:assert/strict';
import test from 'node:test';
import { awardPoint, isNetFault, newMatch, serveFault, serviceCourt, simulateLanding, solveLaunchVelocity, terminalSpeedAfter } from '../src/os/games/badminton.ts';

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

test('serves alternate service courts by server score parity', () => {
  let match = newMatch('bwf');
  assert.equal(serviceCourt(match), 'right');
  match = awardPoint(match, 'player');
  assert.equal(serviceCourt(match), 'left');
  match = awardPoint(match, 'cpu');
  assert.equal(serviceCourt(match), 'left');
  match = awardPoint(match, 'player');
  assert.equal(serviceCourt(match), 'right');
});

test('rally scoring wins 22-20 from 20-all', () => {
  let match = { ...newMatch('bwf'), game: 2 as const, games: { player: 1, cpu: 0 }, points: { player: 20, cpu: 20 } };
  match = awardPoint(match, 'player');
  assert.equal(match.matchWinner, null);
  match = awardPoint(match, 'player');
  assert.equal(match.matchWinner, 'player');
  assert.deepEqual(match.games, { player: 2, cpu: 0 });
  assert.deepEqual(match.points, { player: 22, cpu: 20 });
});

test('a 30-29 game ends at the cap', () => {
  const match = awardPoint({ ...newMatch('bwf'), game: 2, games: { player: 1, cpu: 0 }, points: { player: 29, cpu: 29 } }, 'player');
  assert.equal(match.matchWinner, 'player');
  assert.deepEqual(match.points, { player: 30, cpu: 29 });
});

test('best-of-three switches ends between games and ends after two wins', () => {
  let match = awardPoint({ ...newMatch('bwf'), points: { player: 20, cpu: 0 } }, 'player');
  assert.deepEqual(match.games, { player: 1, cpu: 0 });
  assert.equal(match.endsSwitched, true);
  assert.equal(match.game, 2);
  match = awardPoint({ ...match, points: { player: 20, cpu: 0 } }, 'player');
  assert.equal(match.matchWinner, 'player');
});

test('serve contact above 1.15 m is a fault', () => {
  assert.equal(serveFault(1.151, 4, 'player'), 'serve-height');
  assert.equal(serveFault(1.15, 4, 'player'), undefined);
});
