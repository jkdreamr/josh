// Breakout's ranked runs (verify/protocol.ts): runs recorded the way the page records them replay to the same score at
// any frame rate, and the Worker (the real Boards object, see ranked-harness.ts) takes only honest ones.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, test } from 'node:test';
import { createBreakout, fieldFor, play, resizeBreakout, rng32, serve, STEP, type BreakoutState, type Field, type Pad } from '../src/os/arcade/games/breakout/logic.ts';
import { fieldOf, MAX_CHUNK_EVENTS, verifier } from '../src/os/arcade/games/breakout/verify.ts';
import { FEED_MS, MAX_CHUNK_BYTES } from '../src/os/arcade/verify/protocol.ts';
import { VERIFIERS } from '../src/os/arcade/verify/registry.ts';
import { rankedWorker, type Chunk } from './ranked-harness.ts';
import { replayedSource, UNSTABLE_MATH } from './replayed-math.ts';

let w: ReturnType<typeof rankedWorker>;
beforeEach(() => {
  w = rankedWorker();
});
afterEach(() => w.restore());

/** The page's layout (index.tsx): the field for a canvas, with the HUD over the top or under the paddle. */
function layout(cw: number, ch: number, hudBottom = false): Field {
  const fit = fieldFor(cw, ch);
  const s = fit.scale || 1;
  const top = Math.max(fit.height * 0.1, (44 - fit.y) / s + 4);
  const bottom = hudBottom ? Math.max(fit.height * 0.06, (30 - fit.y) / s + 7) : Math.max(22, fit.height * 0.05);
  return { width: fit.width, height: fit.height, top, bottom };
}

type Run = { init: { f: number[] }; chunks: Chunk[]; score: number; ticks: number; game: BreakoutState; powers: number };

/**
 * Plays a round the way the page does at `hz` frames a second, with a player who follows the ball with the mouse (and
 * for a stretch with the arrow keys), resizes the window once, and gives up after `giveUp` seconds; recorded as the
 * page records a ranked run and cut into the chunks it sends (every FEED_MS of play).
 */
function playRound(seed: number, opts: { hz?: number; giveUp?: number; canvas?: [number, number]; wobble?: number } = {}): Run {
  const dt = 1 / (opts.hz ?? 60);
  const [cw, ch] = opts.canvas ?? [800, 600];
  let field = layout(cw, ch);
  const game = createBreakout(1, field);
  const rng = rng32(seed);
  const init = { f: [field.width, field.height, field.top, field.bottom] };
  const chunks: Chunk[] = [];
  let events: unknown[] = [];
  let since = 0;
  let last: Pad = { axis: 0, x: null };
  const aim = rng32(seed ^ 0x5bd1e995);
  let pointer: number | null = null;
  let attachedFor = 0;
  let powers = 0;
  const note = (pad: Pad) => {
    if (pad.x !== null) {
      if (last.x !== pad.x) events.push([game.ticks, 'p', pad.x]);
    } else if (last.x !== null || last.axis !== pad.axis) events.push([game.ticks, 'k', pad.axis]);
    last = pad.x !== null ? { axis: 0, x: pad.x } : { axis: pad.axis, x: null };
  };
  for (let frame = 0; frame < 2_000_000 && !game.ended; frame++) {
    const t = game.ticks * STEP;
    if (t > 20 && field.width === layout(cw, ch).width) {
      field = layout(cw + 200, ch + 100, true);
      // (the page's view() hands each new field to the game, and records it)
      events.push([game.ticks, 'f', field.width, field.height, field.top, field.bottom]);
      resizeBreakout(game, field);
    }
    const keys = t > 8 && t < 12;
    const ball = [...game.balls].filter((b) => !b.attached).sort((a, b) => b.y - a.y)[0];
    let axis = 0;
    if (t > (opts.giveUp ?? 50)) pointer = -400;
    else if (keys) {
      pointer = null;
      const gap = (ball?.x ?? game.width / 2) - game.paddle.x;
      axis = Math.abs(gap) < 12 ? 0 : Math.sign(gap);
    } else if (ball) pointer = ball.x + (aim() - 0.5) * game.paddle.width * (opts.wobble ?? 0.6);
    if (game.balls.some((b) => b.attached)) {
      attachedFor += dt;
      if (attachedFor > 0.4 && serve(game, rng)) {
        events.push([game.ticks, 's']);
        attachedFor = 0;
      }
    }
    const pad: Pad = { axis, x: pointer === null ? null : Math.round(pointer * 8) / 8 };
    powers += play(game, dt, pad, rng, () => note(pad)).filter((e) => e.type === 'power').length;
    since += dt * 1000;
    if (since >= FEED_MS && !game.ended) {
      chunks.push({ e: events, t: game.ticks, ms: game.ticks * STEP * 1000 });
      events = [];
      since = 0;
    }
  }
  chunks.push({ e: events, t: game.ticks, ms: game.ticks * STEP * 1000 });
  return { init, chunks, score: game.score, ticks: game.ticks, game, powers };
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

test('a round replays to the same score at any frame rate', () => {
  for (const hz of [30, 50, 60, 75, 120, 144, 240]) {
    const run = playRound(1234, { hz });
    assert.ok(run.score > 0, `${hz} Hz: the round should score`);
    assert.ok(run.chunks.length > 3, `${hz} Hz: the round should take several chunks`);
    assert.ok(run.chunks.some((c) => c.e.some((e) => (e as unknown[])[1] === 'k')), 'the keys were used');
    assert.ok(run.chunks.some((c) => c.e.some((e) => (e as unknown[])[1] === 'f')), 'the window was resized');
    assert.equal(replay(1234, run), run.score, `${hz} Hz`);
    for (const c of run.chunks) assert.ok(JSON.stringify({ run: 'x'.repeat(36), n: 999, e: c.e, t: c.t }).length < MAX_CHUNK_BYTES, 'a chunk fits a request');
  }
});

test('a long round, with power-ups caught and walls cleared, replays to the same score', () => {
  for (const hz of [30, 144]) {
    const run = playRound(2, { hz, wobble: 0.3, giveUp: 400 });
    assert.ok(run.game.level >= 2, `${hz} Hz: a wall should come down`);
    assert.ok(run.powers >= 2, `${hz} Hz: power-ups should be caught`);
    assert.equal(replay(2, run), run.score, `${hz} Hz`);
  }
});

test('the fields real windows give are all accepted', () => {
  for (const [cw, ch] of [[320, 480], [390, 700], [800, 600], [1280, 720], [2560, 1080], [3840, 2160], [600, 120], [200, 60], [40, 30], [1, 1], [5000, 200]]) {
    for (const hudBottom of [false, true]) {
      const f = layout(cw, ch, hudBottom);
      assert.ok(fieldOf([f.width, f.height, f.top, f.bottom]), `${cw}x${ch}${hudBottom ? ' (HUD under the paddle)' : ''}`);
    }
  }
  assert.equal(fieldOf([2000, 600, 60, 30]), null);
  assert.equal(fieldOf([800, 600, 10, 30]), null, 'bricks above where the page puts them');
  assert.equal(fieldOf([800, 600, 60, 5]), null, 'the paddle below where the page puts it');
  assert.equal(fieldOf([800, 600, 60]), null);
  assert.equal(fieldOf([800, 600, 60, Number.NaN]), null);
});

test('an honest round, played chunk by chunk in real time, goes on the board once', async () => {
  const { run, seed } = await w.open('breakout');
  const round = playRound(seed);
  assert.ok(round.ticks * STEP > 45, 'a long enough round to test pace with');
  assert.equal((await w.call('/runs/start', { run, init: round.init })).status, 200);
  const played = await w.play(run, round.chunks, round.score);
  assert.equal(played.status, 200, JSON.stringify(played));
  assert.equal((await w.submit('breakout', round.score + 5, run)).status, 403, 'a bigger score than played');
  assert.equal((await w.submit('breakout', round.score, run)).status, 200);
  assert.deepEqual((await w.board('breakout')).map((e) => [e.name, e.score]), [['Tester', round.score]]);
  assert.equal((await w.submit('breakout', round.score, run)).status, 403, 'a run counts once');
});

test('a typed-in score, or one the run did not reach, is refused', async () => {
  assert.equal((await w.submit('breakout', 4_000)).status, 403);
  assert.equal((await w.submit('breakout', 4_000, 'not-a-run')).status, 403);
  const { run, seed } = await w.open('breakout');
  const round = playRound(seed);
  await w.call('/runs/start', { run, init: round.init });
  const played = await w.play(run, round.chunks, round.score + 100);
  assert.equal(played.status, 403);
  assert.equal(played.body.error, 'score does not replay');
  assert.equal((await w.submit('breakout', round.score + 100, run)).status, 403);
  assert.equal((await w.submit('breakout', round.score, run)).status, 403);
  assert.deepEqual(await w.board('breakout'), []);
});

test('a round played faster than real time, or slowed right down, is refused', async () => {
  const fast = await w.open('breakout');
  const quick = playRound(fast.seed);
  await w.call('/runs/start', { run: fast.run, init: quick.init });
  const raced = await w.play(fast.run, quick.chunks, quick.score, { pace: 0.5 });
  assert.equal(raced.status, 403);
  assert.equal(raced.body.error, 'too fast');

  const slow = await w.open('breakout');
  const dragged = playRound(slow.seed);
  const ms = dragged.ticks * STEP * 1000;
  assert.ok(ms * 4 > ms * 1.15 + 120_000, `this round lasts only ${ms / 1000} s`);
  await w.call('/runs/start', { run: slow.run, init: dragged.init });
  const late = await w.play(slow.run, dragged.chunks, dragged.score, { pace: 4 });
  assert.equal(late.status, 403);
  assert.equal(late.body.error, 'too slow');

  // a minute's pause, and play a little slow, still counts
  const paused = await w.open('breakout');
  const honest = playRound(paused.seed);
  await w.call('/runs/start', { run: paused.run, init: honest.init });
  assert.equal((await w.play(paused.run, honest.chunks, honest.score, { pace: 1.1, lag: 60_000 })).status, 200);
});

test("another seed's round, and edited ones, are refused", async () => {
  const mine = await w.open('breakout');
  const other = playRound(mine.seed + 1);
  await w.call('/runs/start', { run: mine.run, init: other.init });
  const wrong = await w.play(mine.run, other.chunks, other.score);
  assert.equal(wrong.status, 403, 'the same inputs on another seed end elsewhere');

  const base = await w.open('breakout');
  const round = playRound(base.seed);
  assert.equal(replay(base.seed, round), round.score);
  const edits: [string, (r: Run) => void][] = [
    ['a pointer moved off the eighths', (r) => {
      const c = r.chunks.find((k) => k.e.some((e) => (e as unknown[])[1] === 'p'))!;
      const e = c.e.find((x) => (x as unknown[])[1] === 'p') as unknown[];
      e[2] = (e[2] as number) + 0.01;
    }],
    ['a serve with no ball on the paddle', (r) => {
      const c = r.chunks[1];
      c.e.push([c.t, 's']);
    }],
    ['events out of order', (r) => {
      const c = r.chunks.find((k) => k.e.length > 3)!;
      [c.e[0], c.e[2]] = [c.e[2], c.e[0]];
    }],
    ['an event past the chunk', (r) => {
      r.chunks[0].e.push([(r.chunks[0].t as number) + 1, 'k', 1]);
    }],
    ['an event after the last ball', (r) => {
      const c = r.chunks[r.chunks.length - 1];
      c.e.push([c.t, 'k', -1]);
    }],
    ['a clock run on past the last ball', (r) => {
      r.chunks[r.chunks.length - 1].t = (r.chunks[r.chunks.length - 1].t as number) + 10;
    }],
    ['a key that is not one', (r) => r.chunks[0].e.push([r.chunks[0].t, 'k', 2])],
    ['a field no window gives', (r) => r.chunks[0].e.push([r.chunks[0].t, 'f', 5000, 600, 60, 30])],
    ['an unknown event', (r) => r.chunks[0].e.push([r.chunks[0].t, 'x'])],
    ['an event that is not a list', (r) => r.chunks[0].e.push(r.chunks[0].t)],
    ['a clock that runs backwards', (r) => {
      r.chunks[1].t = (r.chunks[0].t as number) - 1;
    }],
  ];
  for (const [what, edit] of edits) {
    const r = clone({ init: round.init, chunks: round.chunks }) as Run;
    edit(r);
    assert.notEqual(replay(base.seed, r), round.score, what);
  }
  // and through the Worker, an edit ends the run
  const edited = clone({ init: round.init, chunks: round.chunks }) as Run;
  edited.chunks[1].e.push([edited.chunks[1].t, 's']);
  await w.call('/runs/start', { run: base.run, init: edited.init });
  const refused = await w.play(base.run, edited.chunks, round.score);
  assert.equal(refused.status, 403);
  assert.equal(refused.at, 1);
});

test('starts and chunks that are not from the game are refused', () => {
  for (const init of [null, 7, [], {}, { f: [800, 600, 60] }, { f: [100, 600, 60, 30] }, { f: '800,600,60,30' }]) assert.equal(typeof verifier.start(1, init), 'string', JSON.stringify(init));
  const f = layout(800, 600);
  const begun = verifier.start(1, { f: [f.width, f.height, f.top, f.bottom] });
  assert.ok(typeof begun !== 'string');
  const s = begun.state;
  assert.equal(verifier.feed(s, 'events', 0), 'bad chunk');
  assert.equal(verifier.feed(s, [], -1), 'bad chunk');
  assert.equal(verifier.feed(s, [], 1.5), 'bad chunk');
  assert.equal(verifier.feed(s, [], 999_999_999), 'bad chunk');
  assert.equal(verifier.feed(s, [], Math.round(61 / STEP)), 'bad chunk', 'a minute in one chunk');
  assert.equal(verifier.feed(s, Array.from({ length: MAX_CHUNK_EVENTS + 1 }, () => [0, 'k', 0]), 0), 'bad chunk');
  assert.deepEqual(verifier.feed(s, [[0, 's'], [10, 'p', 300]], 120), { ms: 1000 });
  assert.equal(verifier.feed(s, [[100, 'k', 0]], 200), 'bad chunk', 'a step already played');
  assert.equal(verifier.end(s), 'still playing');
  assert.equal(verifier.feed(s, [[200, 's']], 240), 'no ball to serve');
});

test('a run only counts for its own board', async () => {
  const { run, seed } = await w.open('breakout');
  const round = playRound(seed);
  await w.call('/runs/start', { run, init: round.init });
  assert.equal((await w.play(run, round.chunks, round.score)).status, 200);
  // (each from its own address, clear of the board's rate limit)
  const others = Object.keys(VERIFIERS).filter((g) => g !== 'breakout');
  for (const [i, other] of others.entries()) {
    const tried = await w.call('/leaderboard', { game: other, name: 'Tester', score: round.score, run }, { 'CF-Connecting-IP': `198.51.100.${i + 1}` });
    assert.equal(tried.status, 403, other);
  }
  assert.equal((await w.submit('breakout', round.score, run)).status, 200);
});

test('the replayed rules use only math that comes out the same in every browser', () => {
  // (the Worker replays in V8, players' pages run in JavaScriptCore and SpiderMonkey too: see verify/dmath.ts)
  const src = replayedSource(new URL('../src/os/arcade/games/breakout/verify.ts', import.meta.url));
  for (const fn of ['stepBreakout', 'serve', 'paddleBounce', 'applyPowerup', 'damageBrick', 'hitBrick', 'resizeBreakout', 'decay', 'atan2', 'sin', 'cos']) {
    assert.match(src, new RegExp(`function ${fn}\\b|const ${fn}\\b`), `the walk reaches ${fn}`);
  }
  assert.doesNotMatch(src, UNSTABLE_MATH);
  // and all of the rules the page plays by, which never draw on Math.random themselves (a run's rng comes from its seed)
  const logic = readFileSync(new URL('../src/os/arcade/games/breakout/logic.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.doesNotMatch(logic, UNSTABLE_MATH);
  assert.doesNotMatch(logic, /Math\.random\(/);
});
