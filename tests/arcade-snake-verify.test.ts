// Snake's ranked runs (games/snake/verify.ts): rounds played the way the page plays them replay to the same score on
// the Worker at any frame rate, end to end through the real Boards object, and anything the page could not have sent
// is refused.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import {
  advance, createSnake, DIRECTIONS, GRID, opposite, queueDirection, rng32, speedForLength, startSnake, wouldDie, type Direction, type Pacer, type SnakeState,
} from '../src/os/arcade/games/snake/logic.ts';
import { verifier } from '../src/os/arcade/games/snake/verify.ts';
import { VERIFIERS } from '../src/os/arcade/verify/registry.ts';
import { BOARD_OWNERS } from '../worker/src/specs.gen.ts';
import { chunked, rankedWorker, type Chunk } from './ranked-harness.ts';
import { replayedSource, UNSTABLE_MATH } from './replayed-math.ts';

let w: ReturnType<typeof rankedWorker>;
beforeEach(() => {
  w = rankedWorker();
});
afterEach(() => w.restore());

/**
 * A player for the tests: heads for the food along a safe way, and now and then turns late (only once the snake has
 * hesitated at the edge), so the grace comes up. Null when it leaves the snake be.
 */
function player(s: SnakeState, pacer: Pacer, late: boolean): Direction | null {
  if (s.queue.length || !s.food) return null;
  const safe = (d: Direction) => !wouldDie({ ...s, queue: [d] });
  const head = s.segments[0];
  const far = (d: Direction) => {
    const v = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[d];
    return Math.abs(head.x + v[0] - s.food!.x) + Math.abs(head.y + v[1] - s.food!.y);
  };
  if (late && !safe(s.direction) && !pacer.grace) return null;
  const ways = DIRECTIONS.filter((d) => !opposite(d, s.direction) && safe(d)).sort((a, b) => far(a) - far(b) || (a === s.direction ? -1 : b === s.direction ? 1 : 0));
  return ways[0] && ways[0] !== s.direction ? ways[0] : null;
}

/**
 * Plays a round the way the page does at `hz` frames a second: the food dropped from the seed, the first key `first`,
 * turns recorded with the steps taken, a hesitation recorded with the steps taken, the run's clock stamped every frame.
 * After `quit` steps the player stops steering (the snake runs into something). The chunks as the page sends them.
 */
function playRound(seed: number, opts: { hz?: number; first?: Direction; quit?: number; portrait?: boolean } = {}) {
  const dt = 1 / (opts.hz ?? 60);
  const grid = opts.portrait ? { cols: GRID.short, rows: GRID.long } : { cols: GRID.long, rows: GRID.short };
  const rng = rng32(seed);
  const s = createSnake(grid.cols, grid.rows, rng);
  const first = opts.first ?? 'up';
  startSnake(s, first);
  const pacer: Pacer = { accumulator: 1 / speedForLength(s.segments.length), grace: false, graceUsed: false, steps: 0 };
  const init = { ...grid, dir: DIRECTIONS.indexOf(first) };
  const log: { at: number; ms: number; e?: unknown }[] = [];
  const events: unknown[] = [];
  let t = 0;
  let graces = 0;
  for (let frame = 0; s.alive && !s.won && frame < 1_000_000; frame++) {
    const late = pacer.steps % 9 < 4;
    const d = pacer.steps < (opts.quit ?? 600) ? player(s, pacer, late) : null;
    if (d && queueDirection(s, d)) {
      const e = [pacer.steps, DIRECTIONS.indexOf(d)];
      events.push(e);
      log.push({ at: pacer.steps, ms: Math.round(t * 1000), e });
    }
    t += dt;
    pacer.accumulator += dt;
    for (;;) {
      const r = advance(s, pacer, rng);
      if (r === 'wait') break;
      if (r === 'grace') {
        graces++;
        events.push(pacer.steps);
        log.push({ at: pacer.steps, ms: Math.round(t * 1000), e: pacer.steps });
        continue;
      }
      if (r === 'dead' || r === 'won') break;
    }
    log.push({ at: pacer.steps, ms: Math.round(t * 1000) });
  }
  return { init, chunks: chunked(log), score: s.score, steps: pacer.steps, ms: t * 1000, graces, events };
}

/** Feeds a round's chunks straight to the verifier. Its score, or why it was refused. */
function replay(seed: number, init: unknown, chunks: Chunk[]) {
  const begun = verifier.start(seed, init);
  if (typeof begun === 'string') return begun;
  let ms = 0;
  for (const c of chunks) {
    const fed = verifier.feed(begun.state, c.e, c.t);
    if (typeof fed === 'string') return fed;
    ms = fed.ms;
  }
  const ended = verifier.end(begun.state);
  return typeof ended === 'string' ? ended : { score: ended.score, ms };
}

const copy = (chunks: Chunk[]) => chunks.map((c) => ({ ...c, e: c.e.map((e) => (Array.isArray(e) ? [...e] : e)) }));

test('the rules the replay walks through use only math every browser computes to the same bit', () => {
  // (the Worker replays in V8, players' pages run in JavaScriptCore and SpiderMonkey too: see verify/dmath.ts)
  const src = replayedSource(new URL('../src/os/arcade/games/snake/verify.ts', import.meta.url));
  assert.match(src, /function stepSnake\b|const stepSnake\b/, 'the walk reaches stepSnake');
  assert.match(src, /function spawnFood\b|const spawnFood\b/, 'the walk reaches spawnFood');
  assert.match(src, /function speedForLength\b|const speedForLength\b/, 'the walk reaches speedForLength');
  assert.match(src, /function powi\b|const powi\b/, 'the walk reaches powi');
  assert.doesNotMatch(src, UNSTABLE_MATH);
});

test('snake is checked, on its own board', () => {
  assert.equal(VERIFIERS.snake, verifier);
  assert.equal(BOARD_OWNERS.snake, 'snake');
});

test('a round replays to the same score at any frame rate, either way up, hesitations and all', () => {
  for (const hz of [30, 60, 144, 240]) {
    for (const [seed, first, portrait] of [[1, 'up', false], [77, 'left', true], [3_000_000_000, 'right', false], [12, 'down', true]] as const) {
      const round = playRound(seed, { hz, first, portrait });
      assert.ok(round.score >= 100, `seed ${seed} at ${hz} Hz scored only ${round.score}`);
      assert.ok(round.graces > 0, 'the snake hesitated at the edge');
      const r = replay(seed, round.init, round.chunks);
      assert.ok(typeof r !== 'string', `${hz} Hz, seed ${seed}: ${r}`);
      assert.equal(r.score, round.score, `${hz} Hz, seed ${seed}`);
      // the replay's clock is the page's, never ahead of it, and short of it by under a step and a frame
      assert.ok(r.ms <= round.ms + 1e-6 && r.ms > round.ms - 250, `${hz} Hz: replay ${r.ms} ms, page ${round.ms} ms`);
    }
  }
});

test('an honest round, played chunk by chunk in real time, goes on the board once', async () => {
  const { run, seed } = await w.open('snake');
  const round = playRound(seed);
  assert.equal((await w.call('/runs/start', { run, init: round.init })).status, 200);
  const done = await w.play(run, round.chunks, round.score);
  assert.equal(done.status, 200, JSON.stringify(done));
  assert.ok(round.chunks.length > 2, 'the round should take several chunks');
  assert.equal((await w.submit('snake', round.score + 10, run)).status, 403, 'a bigger score than played');
  assert.equal((await w.submit('snake', round.score, run)).status, 200);
  assert.deepEqual((await w.board('snake')).map((e) => [e.name, e.score]), [['Tester', round.score]]);
  assert.equal((await w.submit('snake', round.score, run)).status, 403, 'a run counts once');
});

test('a typed-in score, or one the round did not reach, is refused', async () => {
  assert.equal((await w.submit('snake', 2_700)).status, 403);
  assert.equal((await w.submit('snake', 2_700, '00000000-0000-4000-8000-000000000000')).status, 403);
  const { run, seed } = await w.open('snake');
  const round = playRound(seed);
  await w.call('/runs/start', { run, init: round.init });
  const claimed = await w.play(run, round.chunks, round.score + 10);
  assert.equal(claimed.status, 403);
  assert.equal(claimed.body.error, 'score does not replay');
  assert.deepEqual(await w.board('snake'), []);
});

test('a round played faster than real time, or slowed right down, is refused', async () => {
  const fast = await w.open('snake');
  const quick = playRound(fast.seed);
  await w.call('/runs/start', { run: fast.run, init: quick.init });
  const raced = await w.play(fast.run, quick.chunks, quick.score, { pace: 0.5 });
  assert.equal(raced.status, 403);
  assert.equal(raced.body.error, 'too fast');

  const slow = await w.open('snake');
  const round = playRound(slow.seed);
  // (long enough that four times its length is past the 15% and 90 s allowed)
  assert.ok(round.ms * 4 > round.ms * 1.15 + 90_000, `this round lasts only ${round.ms / 1000} s`);
  await w.call('/runs/start', { run: slow.run, init: round.init });
  const dragged = await w.play(slow.run, round.chunks, round.score, { pace: 4 });
  assert.equal(dragged.status, 403);
  assert.equal(dragged.body.error, 'too slow');

  // a minute's pause along the way is fine
  const paused = await w.open('snake');
  const kept = playRound(paused.seed);
  await w.call('/runs/start', { run: paused.run, init: kept.init });
  assert.equal((await w.play(paused.run, kept.chunks, kept.score, { lag: 60_000 })).status, 200);
});

test("another seed's turns do not replay here", async () => {
  const { run, seed } = await w.open('snake');
  const other = playRound(seed + 1);
  await w.call('/runs/start', { run, init: other.init });
  assert.equal((await w.play(run, other.chunks, other.score)).status, 403);
  for (const s of [4, 5, 6, 7]) {
    const round = playRound(s);
    const r = replay(s + 1, round.init, round.chunks);
    assert.ok(typeof r === 'string' || r.score !== round.score, `seed ${s}`);
  }
});

test('edited or made-up turns and hesitations are refused', () => {
  const seed = 21;
  const round = playRound(seed);
  const where = (chunks: Chunk[], pick: (e: unknown) => boolean) => {
    for (const c of chunks) {
      const i = c.e.findIndex(pick);
      if (i >= 0) return { c, i };
    }
    throw new Error('no such event');
  };
  // the hesitation before the crash left out (one followed by a turn in time can go unsaid: the round then only claims
  // to have taken a little less time, which helps no one)
  const noGrace = copy(round.chunks);
  const lastChunk = [...noGrace].reverse().find((c) => c.e.some((e) => typeof e === 'number'))!;
  const lastGrace = lastChunk.e.findLastIndex((e) => typeof e === 'number');
  assert.equal(lastChunk.e[lastGrace], round.steps - 1, 'the snake hesitated before the step that killed it');
  lastChunk.e.splice(lastGrace, 1);
  assert.equal(replay(seed, round.init, noGrace), 'no grace');
  // a hesitation where nothing was in the way, or two before one step
  const extraGrace = copy(round.chunks);
  extraGrace[0].e.unshift(0);
  assert.equal(replay(seed, round.init, extraGrace), 'bad grace');
  const twice = copy(round.chunks);
  const g2 = where(twice, (e) => typeof e === 'number');
  g2.c.e.splice(g2.i, 0, g2.c.e[g2.i]);
  assert.equal(replay(seed, round.init, twice), 'bad grace');
  // a turn straight back on itself, or the same way twice
  const back = copy(round.chunks);
  const t = where(back, (e) => Array.isArray(e));
  const turn = t.c.e[t.i] as number[];
  t.c.e.splice(t.i + 1, 0, [turn[0], (turn[1] + 2) % 4]);
  assert.equal(replay(seed, round.init, back), 'impossible turn');
  const again = copy(round.chunks);
  const t2 = where(again, (e) => Array.isArray(e));
  t2.c.e.splice(t2.i + 1, 0, [...(t2.c.e[t2.i] as number[])]);
  assert.equal(replay(seed, round.init, again), 'impossible turn');
  // turns moved a step later, or a turn the other way: the snake goes elsewhere
  for (const k of [2, 10, 30]) {
    const moved = copy(round.chunks);
    let n = 0;
    for (const c of moved) {
      for (const e of c.e) if (Array.isArray(e) && n++ === k) e[1] = (e[1] + 1) % 4;
    }
    const r = replay(seed, round.init, moved);
    assert.ok(typeof r === 'string' || r.score !== round.score, `turn ${k}`);
  }
  // a turn after the snake hit something
  const late = copy(round.chunks);
  const last = late[late.length - 1];
  last.e.push([round.steps, 0]);
  assert.equal(typeof replay(seed, round.init, late), 'string');
  // a round said to have gone on past the crash
  const longer = copy(round.chunks);
  longer[longer.length - 1].t = round.steps + 5;
  assert.equal(replay(seed, round.init, longer), 'step after the end');
  // a round cut short is still going
  assert.equal(replay(seed, round.init, round.chunks.slice(0, 1)), 'still playing');
  // stamps out of order, past the chunk's clock, or a chunk claiming minutes of steps
  const order = verifier.start(seed, round.init);
  assert.ok(typeof order !== 'string');
  assert.equal(verifier.feed(order.state, [[5, 1], [3, 3]], 10), 'bad chunk');
  const past = copy(round.chunks);
  past[0].e.push([(past[0].t as number) + 1, 0]);
  assert.equal(replay(seed, round.init, past), 'bad chunk');
  const begun = verifier.start(seed, round.init);
  assert.ok(typeof begun !== 'string');
  assert.equal(verifier.feed(begun.state, [], 5_000), 'bad chunk');
  // shapes the page never sends
  for (const bad of [[[0, 4]], [[0, -1]], [[0, 1.5]], [[0, '1']], [['0', 1]], [[-1, 1]], [[0]], [[0, 1, 2]], [{ step: 0 }], ['0'], [0.5], 'turns', null]) {
    const r = verifier.start(seed, round.init);
    assert.ok(typeof r !== 'string');
    assert.equal(typeof verifier.feed(r.state, bad, 10), 'string', JSON.stringify(bad));
  }
  for (const at of [-1, 0.5, '3', null]) {
    const r = verifier.start(seed, round.init);
    assert.ok(typeof r !== 'string');
    assert.equal(verifier.feed(r.state, [], at), 'bad chunk', String(at));
  }
  const crowd = verifier.start(seed, round.init);
  assert.ok(typeof crowd !== 'string');
  assert.equal(verifier.feed(crowd.state, Array.from({ length: 4_001 }, () => 0), 1), 'bad chunk', 'an oversized chunk');
  // starts that are not from the game
  for (const init of [null, {}, { cols: 21, rows: 21, dir: 0 }, { cols: 13, rows: 13, dir: 0 }, { cols: 21, rows: 13, dir: 4 }, { cols: 21, rows: 13, dir: -1 }, { cols: 21, rows: 13 }, { cols: '21', rows: 13, dir: 0 }]) {
    assert.equal(verifier.start(seed, init), 'bad start', JSON.stringify(init));
  }
});

test('a snake run counts only for the snake board', async () => {
  const { run, seed } = await w.open('snake');
  const round = playRound(seed);
  await w.call('/runs/start', { run, init: round.init });
  assert.equal((await w.play(run, round.chunks, round.score)).status, 200);
  assert.equal((await w.submit('flappy', round.score, run)).status, 403);
  assert.equal((await w.submit('2048', round.score, run)).status, 403);
  assert.equal((await w.submit('snake', round.score, run)).status, 200);
});
