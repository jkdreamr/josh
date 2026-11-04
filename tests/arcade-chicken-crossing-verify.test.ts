// Chicken Crossing's ranked runs (verify/protocol.ts): runs recorded the way the page records them replay to the same
// score at any frame rate, and the Worker (the real Boards object, see ranked-harness.ts) takes only honest ones.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, test } from 'node:test';
import { createState, HOP_TIME, noEvents, step, STEP, tick, type Direction, type State } from '../src/os/arcade/games/chicken-crossing/logic.ts';
import { MAX_CHUNK_EVENTS, verifier } from '../src/os/arcade/games/chicken-crossing/verify.ts';
import { FEED_MS, MAX_CHUNK_BYTES } from '../src/os/arcade/verify/protocol.ts';
import { VERIFIERS } from '../src/os/arcade/verify/registry.ts';
import { rankedWorker, type Chunk } from './ranked-harness.ts';
import { replayedSource, UNSTABLE_MATH } from './replayed-math.ts';

let w: ReturnType<typeof rankedWorker>;
beforeEach(() => {
  w = rankedWorker();
});
afterEach(() => w.restore());

type Run = { init: Record<string, never>; chunks: Chunk[]; score: number; ticks: number; world: State };

const MOVES = ['up', null, 'left', 'right', 'down'] as const;

/** Whether asking for `action` now (null: waiting a moment) leaves the chicken a way to stay alive `depth` moves on. */
function safe(s: State, action: Direction | null, depth: number): boolean {
  const trial = structuredClone(s);
  trial.queued = action;
  const ev = noEvents();
  const steps = Math.round((action ? HOP_TIME + 0.1 : 0.2) / STEP);
  for (let i = 0; i < steps && !trial.dead; i++) tick(trial, null, ev);
  if (trial.dead) return false;
  if (depth === 0) {
    for (let i = 0; i < Math.round(0.3 / STEP) && !trial.dead; i++) tick(trial, null, ev);
    return !trial.dead;
  }
  return MOVES.some((b) => safe(trial, b, depth - 1));
}

/**
 * Plays a round the way the page does at `hz` frames a second: a player who looks a couple of moves ahead and taps
 * (forward when it is safe, waiting, or sideways), holds the up key for a stretch, and pauses once with a hop waiting;
 * recorded as the page records a ranked run and cut into the chunks it sends (every FEED_MS of play).
 */
function playRound(seed: number, opts: { hz?: number } = {}): Run {
  const dt = 1 / (opts.hz ?? 60);
  const s = createState(seed);
  const chunks: Chunk[] = [];
  let events: unknown[] = [];
  let since = 0;
  let lastHeld: Direction | null = null;
  let paused = false;
  let next = 0;
  for (let frame = 0; frame < 2_000_000 && !s.dead; frame++) {
    const t = s.ticks * STEP;
    // the page pausing (or going on) drops a hop waiting its turn, and the key repeat's wait
    if (!paused && t > 12 && (s.queued !== null || s.repeat > 0)) {
      paused = true;
      events.push([s.ticks, 'r']);
      s.queued = null;
      s.repeat = 0;
    }
    let press: Direction | null = null;
    let held: Direction | null = null;
    if (t > 20 && t < 26) held = !s.hop && safe(s, 'up', 1) ? 'up' : null;
    else if (!s.hop && s.queued === null && t >= next) {
      press = 'up';
      for (const a of MOVES) {
        if (!safe(s, a, 1)) continue;
        press = a;
        break;
      }
      // (a person decides every twentieth of a second or so, whatever the frame rate)
      next = t + 0.05;
    }
    if (!s.dead) {
      if (held !== lastHeld) events.push([s.ticks, 'h', held]);
      lastHeld = held;
      if (press) events.push([s.ticks, 'p', press]);
    }
    step(s, dt, { held, press });
    since += dt * 1000;
    if (since >= FEED_MS && !s.dead) {
      chunks.push({ e: events, t: s.ticks, ms: s.ticks * STEP * 1000 });
      events = [];
      since = 0;
    }
  }
  chunks.push({ e: events, t: s.ticks, ms: s.ticks * STEP * 1000 });
  return { init: {}, chunks, score: s.score, ticks: s.ticks, world: s };
}

/** Replays a recorded run straight through the verifier: the score it ends on, or why it can't. */
function replay(seed: number, run: Pick<Run, 'init' | 'chunks'>) {
  const begun = verifier.start(seed, run.init);
  if (typeof begun === 'string') return begun;
  for (const c of run.chunks) {
    const fed = verifier.feed(begun.state, c.e, c.t);
    if (typeof fed === 'string') return fed;
  }
  const ended = verifier.end(begun.state);
  return typeof ended === 'string' ? ended : ended.score;
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const kinds = (run: Run) => new Set(run.chunks.flatMap((c) => c.e.map((e) => (e as unknown[])[1])));

test('a round replays to the same score at any frame rate', () => {
  for (const hz of [30, 50, 60, 75, 120, 144, 240]) {
    const run = playRound(1, { hz });
    assert.ok(run.score > 20, `${hz} Hz: the round should score`);
    assert.ok(run.chunks.length > 3, `${hz} Hz: the round should take several chunks`);
    assert.deepEqual([...kinds(run)].sort(), ['h', 'p', 'r'], 'taps, a held key and a pause were all recorded');
    assert.equal(replay(1, run), run.score, `${hz} Hz`);
    for (const c of run.chunks) assert.ok(JSON.stringify({ run: 'x'.repeat(36), n: 999, e: c.e, t: c.t }).length < MAX_CHUNK_BYTES, 'a chunk fits a request');
  }
});

test('a long round, across rivers and rails and into the next biome, replays to the same score', () => {
  for (const hz of [30, 144]) {
    const run = playRound(2, { hz });
    assert.ok(run.world.maxRow > 120, `${hz} Hz: the round should go far (${run.world.maxRow} rows)`);
    assert.ok(run.world.coins > 0, `${hz} Hz: coins should be picked up`);
    assert.equal(replay(2, run), run.score, `${hz} Hz`);
  }
});

test('an honest round, played chunk by chunk in real time, goes on the board once', async () => {
  const { run, seed } = await w.open('chicken-crossing');
  const round = playRound(seed);
  assert.equal((await w.call('/runs/start', { run, init: round.init })).status, 200);
  const played = await w.play(run, round.chunks, round.score);
  assert.equal(played.status, 200, JSON.stringify(played));
  assert.equal((await w.submit('chicken-crossing', round.score + 3, run)).status, 403, 'a bigger score than played');
  assert.equal((await w.submit('chicken-crossing', round.score, run)).status, 200);
  assert.deepEqual((await w.board('chicken-crossing')).map((e) => [e.name, e.score]), [['Tester', round.score]]);
  assert.equal((await w.submit('chicken-crossing', round.score, run)).status, 403, 'a run counts once');
});

test('a typed-in score, or one the run did not reach, is refused', async () => {
  assert.equal((await w.submit('chicken-crossing', 999)).status, 403);
  assert.equal((await w.submit('chicken-crossing', 999, 'not-a-run')).status, 403);
  const { run, seed } = await w.open('chicken-crossing');
  const round = playRound(seed);
  await w.call('/runs/start', { run, init: round.init });
  const played = await w.play(run, round.chunks, round.score + 1);
  assert.equal(played.status, 403);
  assert.equal(played.body.error, 'score does not replay');
  assert.equal((await w.submit('chicken-crossing', round.score + 1, run)).status, 403);
  assert.equal((await w.submit('chicken-crossing', round.score, run)).status, 403);
  assert.deepEqual(await w.board('chicken-crossing'), []);
});

test('a round played faster than real time, or slowed right down, is refused', async () => {
  const fast = await w.open('chicken-crossing');
  const quick = playRound(fast.seed);
  await w.call('/runs/start', { run: fast.run, init: quick.init });
  const raced = await w.play(fast.run, quick.chunks, quick.score, { pace: 0.5 });
  assert.equal(raced.status, 403);
  assert.equal(raced.body.error, 'too fast');

  const slow = await w.open('chicken-crossing');
  const dragged = playRound(slow.seed);
  const ms = dragged.ticks * STEP * 1000;
  const pace = 8;
  assert.ok(ms * pace > ms * 1.15 + 120_000, `this round lasts only ${ms / 1000} s`);
  await w.call('/runs/start', { run: slow.run, init: dragged.init });
  const late = await w.play(slow.run, dragged.chunks, dragged.score, { pace });
  assert.equal(late.status, 403);
  assert.equal(late.body.error, 'too slow');

  // a minute's pause, and play a little slow, still counts
  const paused = await w.open('chicken-crossing');
  const honest = playRound(paused.seed);
  await w.call('/runs/start', { run: paused.run, init: honest.init });
  assert.equal((await w.play(paused.run, honest.chunks, honest.score, { pace: 1.1, lag: 60_000 })).status, 200);
});

test("another seed's round, and edited ones, are refused", async () => {
  const mine = await w.open('chicken-crossing');
  const other = playRound(mine.seed + 1);
  await w.call('/runs/start', { run: mine.run, init: other.init });
  const wrong = await w.play(mine.run, other.chunks, other.score);
  assert.equal(wrong.status, 403, "the same hops on another seed's course end elsewhere");

  const round = playRound(2);
  assert.equal(replay(2, round), round.score);
  const taps = (r: Run) => r.chunks.flatMap((c) => c.e.filter((e) => (e as unknown[])[1] === 'p').map((e) => ({ c, e: e as unknown[] })));
  const edits: [string, (r: Run) => void][] = [
    ['a tap turned the other way', (r) => {
      const ups = taps(r).filter(({ e }) => e[2] === 'up');
      for (const { e } of ups.slice(10, 14)) e[2] = 'down';
    }],
    ['taps dropped', (r) => {
      for (const { c, e } of taps(r).slice(20, 24)) c.e.splice(c.e.indexOf(e), 1);
    }],
    ['a tap that is not a direction', (r) => {
      taps(r)[3].e[2] = 'jump';
    }],
    ['a held key that is not one', (r) => r.chunks[0].e.push([r.chunks[0].t, 'h', 'sideways'])],
    ['events out of order', (r) => {
      const c = r.chunks.find((k) => k.e.length > 3)!;
      [c.e[0], c.e[2]] = [c.e[2], c.e[0]];
    }],
    ['an event past the chunk', (r) => r.chunks[0].e.push([(r.chunks[0].t as number) + 1, 'p', 'up'])],
    ['an event after the end', (r) => {
      const c = r.chunks[r.chunks.length - 1];
      c.e.push([c.t, 'p', 'up']);
    }],
    ['a clock run on past the end', (r) => {
      r.chunks[r.chunks.length - 1].t = (r.chunks[r.chunks.length - 1].t as number) + 10;
    }],
    ['a pause that says more', (r) => r.chunks[0].e.push([r.chunks[0].t, 'r', 'up'])],
    ['an unknown event', (r) => r.chunks[0].e.push([r.chunks[0].t, 'x'])],
    ['an event that is not a list', (r) => r.chunks[0].e.push('up')],
    ['a clock that runs backwards', (r) => {
      r.chunks[1].t = (r.chunks[0].t as number) - 1;
    }],
    ['a chunk cut short', (r) => {
      r.chunks.pop();
    }],
  ];
  for (const [what, edit] of edits) {
    const r = clone({ init: round.init, chunks: round.chunks }) as Run;
    edit(r);
    assert.notEqual(replay(2, r), round.score, what);
  }
});

test('starts and chunks that are not from the game are refused', () => {
  for (const init of [null, 7, [], 'x', { seed: 5 }, { row: 100 }]) assert.equal(typeof verifier.start(1, init), 'string', JSON.stringify(init));
  const begun = verifier.start(1, {});
  assert.ok(typeof begun !== 'string');
  assert.equal(begun.board, 'chicken-crossing');
  const s = begun.state;
  assert.equal(verifier.feed(s, 'events', 0), 'bad chunk');
  assert.equal(verifier.feed(s, [], -1), 'bad chunk');
  assert.equal(verifier.feed(s, [], 2.5), 'bad chunk');
  assert.equal(verifier.feed(s, [], Math.round(61 / STEP)), 'bad chunk', 'a minute in one chunk');
  assert.equal(verifier.feed(s, Array.from({ length: MAX_CHUNK_EVENTS + 1 }, () => [0, 'r']), 0), 'bad chunk');
  assert.deepEqual(verifier.feed(s, [[10, 'h', null], [10, 'r']], 240), { ms: 2000 });
  assert.equal(verifier.feed(s, [[100, 'p', 'up']], 300), 'bad chunk', 'a step already played');
  assert.equal(verifier.end(s), 'still hopping');
});

test('a run only counts for its own board', async () => {
  const { run, seed } = await w.open('chicken-crossing');
  const round = playRound(seed);
  await w.call('/runs/start', { run, init: round.init });
  assert.equal((await w.play(run, round.chunks, round.score)).status, 200);
  // (each from its own address, clear of the board's rate limit)
  const others = Object.keys(VERIFIERS).filter((g) => g !== 'chicken-crossing');
  for (const [i, other] of others.entries()) {
    const tried = await w.call('/leaderboard', { game: other, name: 'Tester', score: round.score, run }, { 'CF-Connecting-IP': `198.51.100.${i + 1}` });
    assert.equal(tried.status, 403, other);
  }
  assert.equal((await w.submit('chicken-crossing', round.score, run)).status, 200);
});

test('the replayed rules use only math that comes out the same in every browser', () => {
  // (the Worker replays in V8, players' pages run in JavaScriptCore and SpiderMonkey too: see verify/dmath.ts)
  const src = replayedSource(new URL('../src/os/arcade/games/chicken-crossing/verify.ts', import.meta.url));
  for (const fn of ['createState', 'extendCourse', 'makeLane', 'makeCars', 'tick', 'startHop', 'substep', 'carVelocities', 'sweptHit', 'updateTrain', 'wrapX', 'modSpan']) {
    assert.match(src, new RegExp(`function ${fn}\\b|const ${fn}\\b`), `the walk reaches ${fn}`);
  }
  assert.doesNotMatch(src, UNSTABLE_MATH);
  // and all of the rules the page plays by, which never draw on Math.random themselves (the course comes from a seed)
  const logic = readFileSync(new URL('../src/os/arcade/games/chicken-crossing/logic.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.doesNotMatch(logic, UNSTABLE_MATH);
  assert.doesNotMatch(logic, /Math\.random\(/);
});
