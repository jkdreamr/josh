// Dino Run's ranked runs (games/dino/verify.ts): runs played the way the page plays them replay to the same score on
// the Worker at any frame rate, end to end through the real Boards object, and anything the page could not have sent
// is refused.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import {
  advance, autopilot, clampView, collides, createState, DINO_X, dinoBoxes, DUCK_W, FLYER_Y, hop, obstacleBoxes, overlaps, rng32, STEP, VIEW_MAX, VIEW_MIN, type Obstacle,
} from '../src/os/arcade/games/dino/logic.ts';
import { verifier } from '../src/os/arcade/games/dino/verify.ts';
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
 * Runs a course the way the page does at `hz` frames a second: the course from the seed, the hop, then each frame the
 * keys (an autopilot's, until `quit` seconds in, when it lets go and the next obstacle ends the run) recorded when
 * they change, the view's width recorded when it changes (to `resize` at `resizeAt` seconds), and the world on in
 * whole steps. The chunks as the page sends them.
 */
function runCourse(seed: number, opts: { hz?: number; view?: number; resize?: number; resizeAt?: number; quit?: number } = {}) {
  const dt = 1 / (opts.hz ?? 60);
  const s = createState(600);
  s.viewW = clampView(opts.view ?? 850);
  const init = { w: s.viewW };
  hop(s);
  const rng = rng32(seed);
  const log: { at: number; ms: number; e?: unknown }[] = [];
  let held = 0;
  let t = 0;
  let presses = 0;
  for (let frame = 0; !s.dead && frame < 1_000_000; frame++) {
    if (opts.resize !== undefined && t >= (opts.resizeAt ?? 5) && s.viewW !== clampView(opts.resize)) {
      s.viewW = clampView(opts.resize);
      log.push({ at: s.ticks, ms: Math.round(t * 1000), e: [s.ticks, 'w', s.viewW] });
    }
    const input = t < (opts.quit ?? 40) ? autopilot(s) : { jump: false, duck: false };
    const keys = (input.jump ? 1 : 0) | (input.duck ? 2 : 0);
    if (keys !== held) {
      if (keys & 1) presses++;
      log.push({ at: s.ticks, ms: Math.round(t * 1000), e: [s.ticks, keys] });
      held = keys;
    }
    advance(s, dt, input, rng);
    t += dt;
    log.push({ at: s.ticks, ms: Math.round(t * 1000) });
  }
  return { init, chunks: chunked(log), score: Math.floor(s.score), ticks: s.ticks, ms: s.ticks * STEP * 1000, presses };
}

function replay(seed: number, init: unknown, chunks: Chunk[]) {
  const begun = verifier.start(seed, init);
  if (typeof begun === 'string') return begun;
  for (const c of chunks) {
    const fed = verifier.feed(begun.state, c.e, c.t);
    if (typeof fed === 'string') return fed;
  }
  const ended = verifier.end(begun.state);
  return typeof ended === 'string' ? ended : ended.score;
}

const copy = (chunks: Chunk[]) => chunks.map((c) => ({ ...c, e: c.e.map((e) => [...(e as unknown[])]) }));
/** The nth event of a run's chunks (and the chunk it is in). */
function nth(chunks: Chunk[], n: number) {
  for (const c of chunks) {
    if (n < c.e.length) return { c, i: n, e: c.e[n] as unknown[] };
    n -= c.e.length;
  }
  throw new Error('no such event');
}

test('dino is checked, on its own board', () => {
  assert.equal(VERIFIERS.dino, verifier);
  assert.equal(BOARD_OWNERS.dino, 'dino');
});

test('the rules the replay walks through use only math every browser computes to the same bit', () => {
  // (the Worker replays in V8, players' pages run in JavaScriptCore and SpiderMonkey too: see verify/dmath.ts)
  const src = replayedSource(new URL('../src/os/arcade/games/dino/verify.ts', import.meta.url));
  for (const n of ['substep', 'pickObstacle', 'collides', 'speedAt', 'gapFor']) assert.match(src, new RegExp(`function ${n}\\b|const ${n}\\b`), `the walk reaches ${n}`);
  assert.doesNotMatch(src, UNSTABLE_MATH);
});

test('a run replays to the same score at any frame rate, the window resized along the way', () => {
  for (const hz of [30, 60, 144, 240]) {
    for (const [seed, view, resize] of [[1, 850, undefined], [42, 520, 1_400], [3_500_000_000, 640, 3_000], [5, 1_000, 999.5]] as const) {
      const run = runCourse(seed, { hz, view, resize, quit: 25 });
      assert.ok(run.score > 200, `seed ${seed} at ${hz} Hz scored only ${run.score}`);
      assert.ok(run.presses > 5, 'the dino jumped');
      assert.equal(replay(seed, run.init, run.chunks), run.score, `${hz} Hz, seed ${seed}`);
    }
  }
});

test('an honest run, played chunk by chunk in real time, goes on the board once', async () => {
  const { run, seed } = await w.open('dino');
  const course = runCourse(seed);
  assert.equal((await w.call('/runs/start', { run, init: course.init })).status, 200);
  const done = await w.play(run, course.chunks, course.score);
  assert.equal(done.status, 200, JSON.stringify(done));
  assert.ok(course.chunks.length > 1, 'the run should take more than one chunk');
  assert.equal((await w.submit('dino', course.score + 1, run)).status, 403, 'a bigger score than run');
  assert.equal((await w.submit('dino', course.score, run)).status, 200);
  assert.deepEqual((await w.board('dino')).map((e) => [e.name, e.score]), [['Tester', course.score]]);
  assert.equal((await w.submit('dino', course.score, run)).status, 403, 'a run counts once');
});

test('a typed-in score, or one the run did not reach, is refused', async () => {
  assert.equal((await w.submit('dino', 99_999)).status, 403);
  assert.equal((await w.submit('dino', 99_999, 'not-a-run')).status, 403);
  const { run, seed } = await w.open('dino');
  const course = runCourse(seed);
  await w.call('/runs/start', { run, init: course.init });
  const claimed = await w.play(run, course.chunks, course.score + 500);
  assert.equal(claimed.status, 403);
  assert.equal(claimed.body.error, 'score does not replay');
  assert.deepEqual(await w.board('dino'), []);
});

test('a run played faster than real time, or slowed right down, is refused', async () => {
  const fast = await w.open('dino');
  const quick = runCourse(fast.seed);
  await w.call('/runs/start', { run: fast.run, init: quick.init });
  const raced = await w.play(fast.run, quick.chunks, quick.score, { pace: 0.5 });
  assert.equal(raced.status, 403);
  assert.equal(raced.body.error, 'too fast');

  const slow = await w.open('dino');
  const course = runCourse(slow.seed);
  // (long enough that four times its length is past the 15% and 90 s allowed)
  assert.ok(course.ms * 4 > course.ms * 1.15 + 90_000, `this run lasts only ${course.ms / 1000} s`);
  await w.call('/runs/start', { run: slow.run, init: course.init });
  const dragged = await w.play(slow.run, course.chunks, course.score, { pace: 4 });
  assert.equal(dragged.status, 403);
  assert.equal(dragged.body.error, 'too slow');
});

test("another seed's keys do not replay here", async () => {
  const { run, seed } = await w.open('dino');
  const other = runCourse(seed + 1);
  await w.call('/runs/start', { run, init: other.init });
  assert.equal((await w.play(run, other.chunks, other.score)).status, 403);
  for (const s of [2, 3, 4, 5]) assert.notEqual(replay(s + 10, runCourse(s).init, runCourse(s).chunks), runCourse(s).score, `seed ${s}`);
});

test('edited or made-up keys and widths are refused', () => {
  const seed = 9;
  const run = runCourse(seed, { quit: 20 });
  const events = run.chunks.flatMap((c) => c.e as unknown[][]);
  // a jump pressed later: the dino meets the obstacle it cleared
  for (const k of [0, 6, 14]) {
    const late = copy(run.chunks);
    const jumps = events.flatMap((e, i) => (e[1] === 1 ? [i] : []));
    const at = nth(late, jumps[k]);
    const next = nth(late, jumps[k] + 1);
    // (pressed as late as it can be, just before it is let go)
    at.e[0] = (next.e[0] as number) - 1;
    assert.notEqual(replay(seed, run.init, late), run.score, `jump ${k}`);
  }
  // a key held after the crash
  const after = copy(run.chunks);
  after[after.length - 1].e.push([run.ticks, 1]);
  assert.equal(replay(seed, run.init, after), 'event after the crash');
  // a run said to have gone on past the crash
  const longer = copy(run.chunks);
  longer[longer.length - 1].t = run.ticks + 10;
  assert.equal(replay(seed, run.init, longer), 'clock past the crash');
  // a run cut short is still going
  assert.equal(replay(seed, run.init, run.chunks.slice(0, -1)), 'still running');
  // keys that are already held, or not keys at all
  const same = copy(run.chunks);
  const first = nth(same, 0);
  first.c.e.splice(first.i + 1, 0, [first.e[0], first.e[1]]);
  assert.equal(replay(seed, run.init, same), 'bad chunk');
  // stamps out of order, or past the chunk's clock
  const swapped = copy(run.chunks);
  const c = swapped.find((x) => x.e.length >= 2 && (x.e[0] as number[])[0] !== (x.e[1] as number[])[0])!;
  [c.e[0], c.e[1]] = [c.e[1], c.e[0]];
  assert.equal(replay(seed, run.init, swapped), 'bad chunk');
  const past = copy(run.chunks);
  const p = past.find((x) => x.e.length)!;
  (p.e[p.e.length - 1] as number[])[0] = (p.t as number) + 1;
  assert.equal(replay(seed, run.init, past), 'bad chunk');
  // shapes the page never sends, widths no window has, a chunk claiming minutes, an oversized chunk
  for (const bad of [[[0, 4]], [[0, -1]], [[0, 0]], [[0, 1.5]], [[0, '1']], [[-1, 1]], [[0.5, 1]], [[0]], [1], [[0, 'w']], [[0, 'w', 50]], [[0, 'w', VIEW_MAX + 1]], [[0, 'w', Number.NaN]], [[0, 'h', 900]], [[0, 'w', run.init.w]], 'keys', null]) {
    const r = verifier.start(seed, run.init);
    assert.ok(typeof r !== 'string');
    assert.equal(verifier.feed(r.state, bad, 10), 'bad chunk', JSON.stringify(bad));
  }
  for (const at of [-1, 0.5, '9', null, Math.round(61 / STEP)]) {
    const r = verifier.start(seed, run.init);
    assert.ok(typeof r !== 'string');
    assert.equal(verifier.feed(r.state, [], at), 'bad chunk', String(at));
  }
  const crowd = verifier.start(seed, run.init);
  assert.ok(typeof crowd !== 'string');
  assert.equal(verifier.feed(crowd.state, Array.from({ length: 4_001 }, (_, i) => [0, i % 2 ? 0 : 1]), 10), 'bad chunk');
  // starts from no window the game has
  for (const init of [null, {}, { w: 0 }, { w: VIEW_MIN - 1 }, { w: VIEW_MAX + 1 }, { w: '850' }, { w: Number.POSITIVE_INFINITY }]) assert.equal(verifier.start(seed, init), 'bad start', JSON.stringify(init));
});

test("collides' shortcut for obstacles out of reach agrees with every hit box", () => {
  const rng = rng32(5);
  const s = createState(600);
  for (let i = 0; i < 200_000; i++) {
    s.y = rng() < 0.5 ? 0 : rng() * 120;
    s.ducking = rng() < 0.4;
    const kind = (['small', 'large', 'flyer'] as const)[Math.floor(rng() * 3)];
    const count = kind === 'flyer' ? 1 : 1 + Math.floor(rng() * 3);
    const w = kind === 'flyer' ? 46 : (kind === 'small' ? 17 : 25) * count;
    const o: Obstacle = { kind, x: DINO_X - 80 + rng() * 200, y: kind === 'flyer' ? FLYER_Y[Math.floor(rng() * 3)] : 0, w, h: kind === 'large' ? 50 : kind === 'small' ? 35 : 30, count, seed: 1 };
    let every = false;
    for (const d of dinoBoxes(s.ducking)) {
      for (const b of obstacleBoxes(o)) if (overlaps({ x: DINO_X + d.x, y: s.y + d.y, w: d.w, h: d.h }, { x: o.x + b.x, y: o.y + b.y, w: b.w, h: b.h })) every = true;
    }
    assert.equal(collides(s, o), every, JSON.stringify({ o, y: s.y, ducking: s.ducking }));
  }
});

test('the narrowest view still brings every obstacle in ahead of the dino', () => {
  // (a view narrower than any window would bring them in on top of the dino or behind it, past it unhurt: the page holds
  // the view to VIEW_MIN, and a ranked run can't say less)
  assert.ok(VIEW_MIN + 20 > DINO_X + DUCK_W + 20);
  assert.equal(clampView(0), VIEW_MIN);
  assert.equal(clampView(Number.NaN), VIEW_MIN);
  assert.equal(clampView(1e9), VIEW_MAX);
  assert.equal(clampView(850), 850);
});

test('a dino run counts only for the dino board', async () => {
  const { run, seed } = await w.open('dino');
  const course = runCourse(seed);
  await w.call('/runs/start', { run, init: course.init });
  assert.equal((await w.play(run, course.chunks, course.score)).status, 200);
  assert.equal((await w.submit('flappy', course.score, run)).status, 403);
  assert.equal((await w.submit('stack', course.score, run)).status, 403);
  assert.equal((await w.submit('dino', course.score, run)).status, 200);
});
