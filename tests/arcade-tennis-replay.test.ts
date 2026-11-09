import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorld, scorePoint, type World } from '../src/os/arcade/games/tennis/logic.ts';
import { appendReplayFrame, rallyCounterLabel, REPLAY_DURATION, REPLAY_FALLBACK_SLOW_SOURCE_SECONDS, REPLAY_FAST_SPEED, REPLAY_HIT_SLOW_SOURCE_SECONDS, REPLAY_HOLD_SECONDS, REPLAY_POINT_CLOCK, REPLAY_SLOW_SPEED, REPLAY_SOURCE_SECONDS, replayProgress, replaySourceTime, sampleReplay, selectReplay, type ReplayFrame, type ReplaySelection } from '../src/os/arcade/games/tennis/replay.ts';

function frameAt(at: number): World {
  const world = createWorld({ seed: 7 });
  world.clock = at;
  world.ball.p = { x: at, y: 1 + at, z: -at };
  world.ball.v = { x: at * 2, y: 0, z: 1 };
  world.players[0]!.x = at;
  world.players[0]!.swing = at / 10;
  return world;
}

test('replay buffer retains four seconds and snapshots render state immutably', () => {
  let buffer: ReplayFrame[] = [];
  for (let at = 0; at <= 4; at += 0.25) buffer = appendReplayFrame(buffer, frameAt(at));
  assert.ok(buffer.length > 1);
  assert.ok(buffer[0]!.at >= 0);
  const savedX = buffer.at(-1)!.world.ball.p.x;
  const source = frameAt(4);
  source.ball.p.x = 90;
  assert.equal(buffer.at(-1)!.world.ball.p.x, savedX);
});

test('replay selection includes aces, clean winners, and long rallies only', () => {
  const frames = Array.from({ length: 81 }, (_, index) => {
    const world = frameAt(index * 0.05);
    return { at: world.clock, world };
  });
  assert.equal(selectReplay(frames, { call: 'point', rallyShots: 1, pointWinner: 0, lastHitter: 0 })?.frames.length, 49);
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

test('replay samples use the fast-to-slow time warp', () => {
  const frames = [0, REPLAY_SOURCE_SECONDS].map((at) => {
    const world = frameAt(at);
    return { at, world };
  });
  const selection = selectReplay(frames, { call: 'point', rallyShots: 1, pointWinner: 0, lastHitter: 0 });
  assert.ok(selection);
  const middle = sampleReplay(selection!, 1);
  assert.ok(Math.abs(middle.clock - REPLAY_FAST_SPEED) < 1e-9);
  assert.ok(Math.abs(middle.ball.p.x - REPLAY_FAST_SPEED) < 1e-9);
  assert.ok(Math.abs(middle.players[0]!.x - REPLAY_FAST_SPEED) < 1e-9);
});

test('replay source warp is monotonic, continuous, clamped, and holds its endpoint', () => {
  const frames = Array.from({ length: 49 }, (_, index) => {
    const at = index * 0.05;
    const world = frameAt(at);
    if (at >= 1.2) {
      world.ball.inPlay = true;
      world.ball.rallyShot = 2;
      world.ball.hitByTeam = 1;
    }
    return { at, world };
  });
  const selection = selectReplay(frames, { call: 'point', rallyShots: 6, pointWinner: 0, lastHitter: 1 })!;
  assert.ok(Math.abs(selection.hitAt! - 1.2) < 1e-9);
  assert.equal(selection.hitTeam, 1);
  assert.ok(Math.abs(selection.slowSourceStart - (selection.hitAt! - 0.25)) < 1e-9);
  assert.ok(Math.abs(selection.slowSourceEnd - (selection.hitAt! + 0.45)) < 1e-9);
  const slowStart = selection.fastBeforeDuration;
  const slowEnd = slowStart + selection.slowDuration;
  for (const [boundary, speed] of [[slowStart, REPLAY_FAST_SPEED], [slowEnd, REPLAY_SLOW_SPEED]] as const) {
    const before = replaySourceTime(selection, boundary - 1e-7);
    const after = replaySourceTime(selection, boundary);
    assert.ok(before <= after);
    assert.ok(Math.abs(after - before - speed * 1e-7) < 1e-9);
  }
  assert.equal(replaySourceTime(selection, slowStart), selection.slowSourceStart);
  assert.equal(replaySourceTime(selection, slowEnd), selection.slowSourceEnd);
  assert.equal(replayProgress(selection, slowStart - 1e-6).slow, false);
  assert.equal(replayProgress(selection, slowStart).slow, true);
  assert.equal(replayProgress(selection, slowEnd - 1e-6).slow, true);
  assert.equal(replayProgress(selection, slowEnd).slow, false);
  let previous = selection.sourceStart;
  for (let elapsed = 0; elapsed <= selection.duration + 0.1; elapsed += 0.01) {
    const current = replaySourceTime(selection, elapsed);
    assert.ok(current >= previous, `warp moved backwards at ${elapsed}`);
    assert.ok(current >= selection.sourceStart && current <= selection.sourceEnd);
    previous = current;
  }
  const sourceEndAt = slowEnd + selection.fastAfterDuration;
  assert.equal(replaySourceTime(selection, sourceEndAt), selection.sourceEnd);
  assert.equal(replaySourceTime(selection, sourceEndAt + REPLAY_HOLD_SECONDS), selection.sourceEnd);
  assert.ok(selection.duration <= REPLAY_DURATION);
  assert.equal(
    REPLAY_DURATION,
    (REPLAY_SOURCE_SECONDS - REPLAY_HIT_SLOW_SOURCE_SECONDS) / REPLAY_FAST_SPEED
      + REPLAY_HIT_SLOW_SOURCE_SECONDS / REPLAY_SLOW_SPEED
      + REPLAY_HOLD_SECONDS,
  );
  assert.equal(REPLAY_POINT_CLOCK, REPLAY_DURATION + 1.1);
});

test('no-hit replay falls back to slow motion over the final 0.6 seconds', () => {
  const frames = [0, 2.4].map((at) => ({ at, world: frameAt(at) }));
  const selection = selectReplay(frames, { call: 'point', rallyShots: 6, pointWinner: 0, lastHitter: 1 })!;
  assert.equal(selection.hitAt, null);
  assert.equal(selection.hitTeam, 1);
  assert.equal(selection.slowSourceStart, selection.sourceEnd - REPLAY_FALLBACK_SLOW_SOURCE_SECONDS);
  assert.equal(selection.slowSourceEnd, selection.sourceEnd);
  assert.equal(selection.fastBeforeDuration, (REPLAY_SOURCE_SECONDS - REPLAY_FALLBACK_SLOW_SOURCE_SECONDS) / REPLAY_FAST_SPEED);
  assert.equal(selection.fastAfterDuration, 0);
  assert.ok(selection.duration <= REPLAY_DURATION);
});

test('short replay buffers clamp the slow segment to the available source', () => {
  const frames = [0, 0.2, 0.4].map((at) => ({ at, world: frameAt(at) }));
  const selection: ReplaySelection | null = selectReplay(frames, { call: 'point', rallyShots: 1, pointWinner: 0, lastHitter: 0 });
  assert.ok(selection);
  assert.equal(selection.sourceEnd - selection.sourceStart, 0.4);
  assert.equal(selection.slowSourceStart, selection.sourceStart);
  assert.equal(selection.slowSourceEnd, selection.sourceEnd);
  assert.equal(selection.fastBeforeDuration, 0);
  assert.equal(selection.fastAfterDuration, 0);
  assert.equal(selection.slowDuration, 0.4 / REPLAY_SLOW_SPEED);
  assert.equal(replaySourceTime(selection, selection.fastBeforeDuration), selection.slowSourceStart);
  assert.equal(replaySourceTime(selection, selection.fastBeforeDuration + selection.slowDuration), selection.sourceEnd);
  assert.ok(selection.duration <= REPLAY_DURATION);
});

test('rally counter appears at four shots and formats the current rally', () => {
  assert.equal(rallyCounterLabel(3), '');
  assert.equal(rallyCounterLabel(4), 'Rally 4');
  assert.equal(rallyCounterLabel(8), 'Rally 8');
});
