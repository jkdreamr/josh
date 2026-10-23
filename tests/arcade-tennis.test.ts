import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BALL_RADIUS,
  COURT_LENGTH,
  DOUBLES_WIDTH,
  SINGLES_WIDTH,
  STEP,
  createWorld,
  hitServe,
  isInCourt,
  isInServiceBox,
  predictLanding,
  scorePoint,
  serveSide,
  solveShot,
  stepWorld,
  timingQuality,
  tossServe,
  type Level,
  type Spin3,
} from '../src/os/arcade/games/tennis/logic.ts';
import { configOf, parsePacket, stateOf, swingOf } from '../src/os/arcade/games/tennis/net.ts';

test('the court uses ITF dimensions and touching a line is in', () => {
  assert.equal(COURT_LENGTH, 23.77);
  assert.equal(SINGLES_WIDTH, 8.23);
  assert.equal(DOUBLES_WIDTH, 10.97);
  assert.equal(isInCourt(SINGLES_WIDTH / 2 + BALL_RADIUS, 0, 'singles'), true);
  assert.equal(isInCourt(SINGLES_WIDTH / 2 + BALL_RADIUS + 0.01, 0, 'singles'), false);
  assert.equal(isInCourt(0, COURT_LENGTH / 2 + BALL_RADIUS, 'singles'), true);
});

test('deuce, advantage, and match lengths score the full game', () => {
  const world = createWorld({ length: 'game' });
  world.match.points = [3, 3];
  scorePoint(world, 0);
  assert.deepEqual(world.match.points, [4, 3]);
  world.phase = 'rally';
  scorePoint(world, 1);
  assert.deepEqual(world.match.points, [4, 4]);
  world.phase = 'rally';
  scorePoint(world, 0);
  assert.deepEqual(world.match.points, [5, 4]);
  world.phase = 'rally';
  scorePoint(world, 0);
  assert.equal(world.match.games[0], 1);
  assert.equal(world.match.winner, 0);
  assert.equal(world.phase, 'done');

  const three = createWorld({ length: 'three' });
  three.match.games = [1, 1];
  three.match.points = [3, 0];
  scorePoint(three, 0);
  assert.equal(three.match.winner, 0);

  const set = createWorld({ length: 'set' });
  set.match.games = [6, 6];
  set.match.tiebreak = true;
  set.match.tbPoints = [6, 6];
  scorePoint(set, 0);
  assert.deepEqual(set.match.tbPoints, [7, 6]);
  assert.equal(set.match.winner, null);
  set.phase = 'rally';
  scorePoint(set, 0);
  assert.equal(set.match.winner, 0);
  assert.deepEqual(set.match.completedSets, [[7, 6]]);
});

test('server rotation covers every doubles player and boxes alternate', () => {
  const doubles = createWorld({ format: 'doubles', length: 'set' });
  const order = [0, 1, 2, 3, 0];
  for (let game = 0; game < 4; game++) {
    assert.equal(doubles.serverSeat, order[game]);
    doubles.match.points = [3, 0];
    scorePoint(doubles, 0);
    if (game < 3) doubles.phase = 'rally';
  }
  assert.equal(doubles.serverSeat, order[4]);

  const singles = createWorld();
  assert.equal(serveSide(singles), 0);
  singles.match.points = [1, 0];
  assert.equal(serveSide(singles), 1);
  singles.match.points = [2, 1];
  assert.equal(serveSide(singles), 1);
});

test('serve boxes, faults, double faults, and a net let behave correctly', () => {
  const world = createWorld();
  assert.equal(isInServiceBox(1.5, -8, 1, 0, 'singles'), true);
  assert.equal(isInServiceBox(-1.5, -8, 1, 0, 'singles'), false);
  assert.equal(tossServe(world, 0), true);
  assert.equal(world.phase, 'serve-toss');
  assert.equal(hitServe(world, 0, -0.02), true);
  assert.equal(world.phase, 'serve-flight');

  const fault = createWorld();
  fault.phase = 'serve-flight';
  fault.ball.inPlay = true;
  fault.ball.p = { x: 6, y: BALL_RADIUS + 0.001, z: -8 };
  fault.ball.v = { x: 0, y: -1, z: 0 };
  const first = stepWorld(fault, [], STEP);
  assert.equal(fault.serveNumber, 2);
  assert.ok(first.some((event) => event.type === 'call' && event.call === 'fault'));
  fault.phase = 'serve-flight';
  fault.ball.inPlay = true;
  fault.ball.p = { x: 6, y: BALL_RADIUS + 0.001, z: -8 };
  fault.ball.v = { x: 0, y: -1, z: 0 };
  const second = stepWorld(fault, [], STEP);
  assert.equal(fault.match.points[1], 1);
  assert.ok(second.some((event) => event.type === 'call' && event.call === 'double fault'));

  const letBall = createWorld();
  letBall.phase = 'serve-flight';
  letBall.ball.inPlay = true;
  letBall.ball.hitByTeam = 0;
  letBall.ball.netCord = true;
  letBall.ball.p = { x: 1.4, y: BALL_RADIUS + 0.001, z: -8 };
  letBall.ball.v = { x: 0, y: -1, z: 0 };
  const letEvents = stepWorld(letBall, [], STEP);
  assert.equal(letBall.phase, 'serve-ready');
  assert.equal(letBall.serveNumber, 1);
  assert.ok(letEvents.some((event) => event.type === 'call' && event.call === 'let'));
});

test('net collision blocks the ball and timing maps direction and quality', () => {
  const world = createWorld();
  world.phase = 'rally';
  world.ball.inPlay = true;
  world.ball.hitByTeam = 0;
  world.ball.p = { x: 0, y: 0.7, z: 0.01 };
  world.ball.v = { x: 0, y: -1, z: -8 };
  const events = stepWorld(world, [], STEP);
  assert.ok(events.some((event) => event.type === 'net'));
  assert.equal(world.match.points[0], 1);

  assert.deepEqual(timingQuality(-0.2).hit, false);
  assert.equal(timingQuality(-0.08).direction, -1);
  assert.equal(timingQuality(0.08).direction, 1);
  assert.equal(timingQuality(0).quality, 1);
  assert.equal(timingQuality(0.16).hit, true);
});

test('shot solving lands flat, topspin, slice, and lob shots near their target', () => {
  const from = { x: 0.8, y: 1.05, z: 8.6 };
  const target = { x: -1.3, z: -8.8 };
  const spins: Array<[Spin3, number]> = [
    [{ x: 0, y: 0, z: 0 }, 2.1],
    [{ x: 0.8, y: 0.2, z: 42 }, 2.1],
    [{ x: -0.4, y: 0.3, z: -28 }, 2.2],
    [{ x: 0.2, y: 0, z: 12 }, 7.1],
  ];
  for (const [spin, apex] of spins) {
    const velocity = solveShot(from, target, spin, apex);
    const landing = predictLanding(from, velocity, spin, 4);
    assert.ok(Math.hypot(landing.x - target.x, landing.z - target.z) <= 0.15,
      `landing was ${landing.x.toFixed(3)}, ${landing.z.toFixed(3)} with ${Math.hypot(landing.x - target.x, landing.z - target.z).toFixed(3)}m error`);
    assert.equal(landing.clearsNet, true);
  }
});

test('AI matches complete at every level with live rallies', () => {
  for (const level of [0, 1, 2] as const satisfies readonly Level[]) {
    const world = createWorld({
      level,
      length: 'game',
      players: [{ name: 'Player A', ai: level }, { name: 'Player B', ai: level }],
      seed: 22 + level,
    });
    let hits = 0;
    let rallyHits = 0;
    let maxRally = 0;
    let elapsed = 0;
    for (let i = 0; i < 180_000 && world.match.winner === null; i++) {
      const events = stepWorld(world, [], STEP);
      for (const event of events) {
        if (event.type === 'hit') {
          hits++;
          rallyHits++;
        }
        if (event.type === 'point') {
          maxRally = Math.max(maxRally, rallyHits);
          rallyHits = 0;
        }
      }
      elapsed += STEP;
    }
    assert.notEqual(world.match.winner, null, `level ${level} did not finish`);
    assert.ok(elapsed < 600, `level ${level} stalled for ${elapsed}s`);
    assert.ok(hits >= 4, `level ${level} had only ${hits} total hits`);
    if (level === 2) assert.ok(maxRally >= 3, `hard rallies peaked at only ${maxRally} hits`);
  }
});

test('packets round-trip valid settings, swings, and host snapshots and reject bad ranges', () => {
  const config = configOf(4, 'doubles', 'three', 2);
  assert.deepEqual(parsePacket(config), { k: 'cfg', r: 4, format: 'doubles', length: 'three', level: 2 });
  const swing = swingOf(4, 7, { kind: 'slice', aim: -1, delta: -0.1, swipe: 400 });
  assert.equal(parsePacket(swing)?.k, 'sw');
  assert.equal(parsePacket({ ...swing, delta: 3 }), null);
  assert.equal(parsePacket({ ...swing, shot: -1 }), null);
  assert.equal(parsePacket({ t: 'tennis', k: 'cfg', r: 1, format: 'trios', length: 'game', level: 1 }), null);
  assert.equal(parsePacket({ t: 'tennis', k: 'sw', r: 1, shot: 1, delta: 0, kind: 'smash', aim: 0, swipe: 0 }), null);
  const snapshot = JSON.parse(JSON.stringify(stateOf(4, createWorld({ format: 'doubles' }))));
  const parsed = parsePacket(snapshot);
  assert.equal(parsed?.k, 'S');
  if (parsed?.k === 'S') assert.equal(parsed.state.players.length, 4);
  assert.equal(parsePacket({ ...snapshot, state: { ...snapshot.state, ball: { ...snapshot.state.ball, p: { x: 100, y: 1, z: 0 } } } }), null);
  assert.equal(parsePacket({ t: 'tennis', k: 'ev', r: 1, event: { type: 'call', call: 'match-ish' } }), null);
});
