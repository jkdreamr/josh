import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorld, scorePoint, type World } from '../src/os/arcade/games/tennis/logic.ts';
import { appendReplayFrame, rallyCounterLabel, REPLAY_POINT_CLOCK, REPLAY_SOURCE_SECONDS, sampleReplay, selectReplay, type ReplayFrame } from '../src/os/arcade/games/tennis/replay.ts';

function frameAt(at: number): World {
  const world = createWorld({ seed: 7 });
  world.clock = at;
  world.ball.p = { x: at, y: 1 + at, z: -at };
  world.ball.v = { x: at * 2, y: 0, z: 1 };
  world.players[0]!.x = at;
  world.players[0]!.swing = at / 10;
  return world;
}

test('replay buffer retains three seconds and snapshots render state immutably', () => {
  let buffer: ReplayFrame[] = [];
  for (let at = 0; at <= 4; at += 0.25) buffer = appendReplayFrame(buffer, frameAt(at));
  assert.ok(buffer.length > 1);
  assert.ok(buffer[0]!.at >= 1);
  const savedX = buffer.at(-1)!.world.ball.p.x;
  const source = frameAt(4);
  source.ball.p.x = 90;
  assert.equal(buffer.at(-1)!.world.ball.p.x, savedX);
});

test('replay selection includes aces, clean winners, and long rallies only', () => {
  const frames = Array.from({ length: 41 }, (_, index) => {
    const world = frameAt(index * 0.05);
    return { at: world.clock, world };
  });
  assert.equal(selectReplay(frames, { call: 'point', rallyShots: 1, pointWinner: 0, lastHitter: 0 })?.frames.length, 18);
  assert.equal(selectReplay(frames, { call: 'point', rallyShots: 4, pointWinner: 0, lastHitter: 1 }), null);
  assert.ok(selectReplay(frames, { call: 'point', rallyShots: 4, pointWinner: 1, lastHitter: 1 }));
  assert.ok(selectReplay(frames, { call: 'out', rallyShots: 6, pointWinner: 1, lastHitter: 0 }));
});

test('only replay-eligible points extend the authoritative point clock', () => {
  const ordinary = createWorld({ seed: 11 });
  ordinary.rallyShot = 4;
  ordinary.ball.hitByTeam = 1;
  scorePoint(ordinary, 0, 'out');
  assert.equal(ordinary.pointClock, 1.35);

  const longRally = createWorld({ seed: 12 });
  longRally.rallyShot = 6;
  longRally.ball.hitByTeam = 0;
  scorePoint(longRally, 1, 'out');
  assert.equal(longRally.pointClock, REPLAY_POINT_CLOCK);

  const cleanWinner = createWorld({ seed: 13 });
  cleanWinner.rallyShot = 3;
  cleanWinner.ball.hitByTeam = 0;
  scorePoint(cleanWinner, 0, 'point');
  assert.equal(cleanWinner.pointClock, REPLAY_POINT_CLOCK);
});

test('replay samples interpolate player and ball state at 0.35x', () => {
  const frames = [0, REPLAY_SOURCE_SECONDS].map((at) => {
    const world = frameAt(at);
    return { at, world };
  });
  const selection = selectReplay(frames, { call: 'point', rallyShots: 1, pointWinner: 0, lastHitter: 0 });
  assert.ok(selection);
  const middle = sampleReplay(selection!, 1.25);
  assert.ok(Math.abs(middle.clock - REPLAY_SOURCE_SECONDS / 2) < 1e-9);
  assert.ok(Math.abs(middle.ball.p.x - REPLAY_SOURCE_SECONDS / 2) < 1e-9);
  assert.ok(Math.abs(middle.players[0]!.x - REPLAY_SOURCE_SECONDS / 2) < 1e-9);
});

test('rally counter appears at four shots and formats the current rally', () => {
  assert.equal(rallyCounterLabel(3), '');
  assert.equal(rallyCounterLabel(4), 'Rally 4');
  assert.equal(rallyCounterLabel(8), 'Rally 8');
});
