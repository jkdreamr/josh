// Invaders' ranked runs (verify/protocol.ts): runs recorded the way the page records them replay to the same score at
// any frame rate, and the Worker (the real Boards object, see ranked-harness.ts) takes only honest ones.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, test } from 'node:test';
import { alienWidth, firePlayerShot, newRound, play, rng32, STEP, stepIntervalForCount, type InvadersState, type Steer } from '../src/os/arcade/games/invaders/logic.ts';
import { MAX_CHUNK_EVENTS, verifier } from '../src/os/arcade/games/invaders/verify.ts';
import { FEED_MS, MAX_CHUNK_BYTES } from '../src/os/arcade/verify/protocol.ts';
import { VERIFIERS } from '../src/os/arcade/verify/registry.ts';
import { rankedWorker, type Chunk } from './ranked-harness.ts';
import { replayedSource, UNSTABLE_MATH } from './replayed-math.ts';

let w: ReturnType<typeof rankedWorker>;
beforeEach(() => {
  w = rankedWorker();
});
afterEach(() => w.restore());

type Run = { init: Record<string, never>; chunks: Chunk[]; score: number; ticks: number; game: InvadersState };

/**
 * Plays a round the way the page does at `hz` frames a second: a player who leads the cannon with the mouse under the
 * outermost invaders (and for a stretch steers with the arrow keys), holds fire (a shot every 0.3 s, as the page
 * repeats it) and taps it now and then, and with `dodge` steps out of the way of shots; recorded as the page records a
 * ranked run and cut into the chunks it sends.
 */
function playRound(seed: number, opts: { hz?: number; dodge?: boolean } = {}): Run {
  const dt = 1 / (opts.hz ?? 60);
  const rng = rng32(seed);
  const game = newRound(rng);
  const chunks: Chunk[] = [];
  let events: unknown[] = [];
  let since = 0;
  let last: Steer = { axis: 0, target: null };
  const hand = rng32(seed ^ 0x2f6b);
  let fireTimer = 0;
  let pointer: number | null = null;
  const note = (steer: Steer) => {
    if (steer.target !== null) {
      if (last.target !== steer.target) events.push([game.ticks, 'p', steer.target]);
    } else if (last.target !== null || last.axis !== steer.axis) events.push([game.ticks, 'k', steer.axis]);
    last = steer.target !== null ? { axis: 0, target: steer.target } : { axis: steer.axis, target: null };
  };
  const fire = () => {
    if (!firePlayerShot(game)) return;
    events.push([game.ticks, 'f']);
    fireTimer = 0.3;
  };
  for (let frame = 0; frame < 3_000_000 && !game.ended; frame++) {
    const t = game.ticks * STEP;
    fireTimer = Math.max(0, fireTimer - dt);
    // the outermost columns first (the formation then has further to march before it drops), unless they are about to
    // land; not from behind the cannon's own shields while there is a choice; aimed where the formation will be
    const low = Math.max(...game.aliens.map((a) => a.y));
    const minCol = Math.min(...game.aliens.map((a) => a.col));
    const maxCol = Math.max(...game.aliens.map((a) => a.col));
    const interval = stepIntervalForCount(game.aliens.length) / Math.sqrt(game.wave);
    const lead = (y: number) => Math.floor((game.stepTimer + (game.player.y - 14 - y) / 470) / interval) * 14 * game.direction;
    const open = (x: number) => !game.shields.some((sh) => x > sh.x - 4 && x < sh.x + sh.cols * sh.cell + 4 && sh.cells.some((row) => row.some(Boolean)));
    const cols = game.aliens.filter((a) => (low > 520 ? a.y >= low - 1 : a.col === minCol || a.col === maxCol)).map((a) => a.x + alienWidth / 2 + lead(a.y));
    const pool = cols.some(open) ? cols.filter(open) : cols;
    const near = pool.reduce<number | null>((best, x) => (best === null || Math.abs(x - game.player.x) < Math.abs(best - game.player.x) ? x : best), null);
    // (shots that reach the cannon's line within half a second, close enough to hit it)
    const danger = (x: number) => game.alienShots.some((s) => s.y < game.player.y + 8 && (game.player.y - 12 - s.y) / s.vy < 0.55 && Math.abs(s.x - x) < 26);
    let axis = 0;
    if (opts.dodge && danger(game.player.x)) {
      for (let d = 8; d < 200; d += 8) {
        if (!danger(game.player.x - d) && game.player.x - d > 22) pointer = game.player.x - d;
        else if (!danger(game.player.x + d) && game.player.x + d < 478) pointer = game.player.x + d;
        else continue;
        break;
      }
    } else if (t > 15 && t < 20) {
      pointer = null;
      const gap = (near ?? 250) - game.player.x;
      axis = Math.abs(gap) < 6 ? 0 : Math.sign(gap);
    } else if (near !== null) pointer = near + (hand() - 0.5) * 20;
    if (hand() < 0.15 || fireTimer <= 0) fire();
    const steer: Steer = { axis, target: pointer === null ? null : Math.round(pointer * 8) / 8 };
    play(game, dt, steer, rng, () => note(steer));
    since += dt * 1000;
    if (since >= FEED_MS && !game.ended) {
      chunks.push({ e: events, t: game.ticks, ms: game.ticks * STEP * 1000 });
      events = [];
      since = 0;
    }
  }
  chunks.push({ e: events, t: game.ticks, ms: game.ticks * STEP * 1000 });
  return { init: {}, chunks, score: game.score, ticks: game.ticks, game };
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
    const run = playRound(77, { hz });
    assert.ok(run.score > 0, `${hz} Hz: the round should score`);
    assert.ok(run.chunks.length > 3, `${hz} Hz: the round should take several chunks`);
    assert.deepEqual([...kinds(run)].sort(), ['f', 'k', 'p'], 'pointer, keys and shots were all used');
    assert.equal(replay(77, run), run.score, `${hz} Hz`);
    for (const c of run.chunks) assert.ok(JSON.stringify({ run: 'x'.repeat(36), n: 999, e: c.e, t: c.t }).length < MAX_CHUNK_BYTES, 'a chunk fits a request');
  }
});

test('a long round, past a wave and an extra life, replays to the same score', () => {
  for (const hz of [30, 144]) {
    const run = playRound(7, { hz, dodge: true });
    assert.ok(run.game.wave >= 2, `${hz} Hz: a wave should fall (reached ${run.game.wave})`);
    assert.ok(run.score >= 1_500, `${hz} Hz: an extra life should be earned (${run.score})`);
    assert.equal(replay(7, run), run.score, `${hz} Hz`);
  }
});

test('an honest round, played chunk by chunk in real time, goes on the board once', async () => {
  const { run, seed } = await w.open('invaders');
  const round = playRound(seed);
  assert.ok(round.ticks * STEP > 45, `a long enough round to test pace with (${round.ticks * STEP} s)`);
  assert.equal((await w.call('/runs/start', { run, init: round.init })).status, 200);
  const played = await w.play(run, round.chunks, round.score);
  assert.equal(played.status, 200, JSON.stringify(played));
  assert.equal((await w.submit('invaders', round.score + 10, run)).status, 403, 'a bigger score than played');
  assert.equal((await w.submit('invaders', round.score, run)).status, 200);
  assert.deepEqual((await w.board('invaders')).map((e) => [e.name, e.score]), [['Tester', round.score]]);
  assert.equal((await w.submit('invaders', round.score, run)).status, 403, 'a run counts once');
});

test('a typed-in score, or one the run did not reach, is refused', async () => {
  assert.equal((await w.submit('invaders', 9_990)).status, 403);
  assert.equal((await w.submit('invaders', 9_990, 'not-a-run')).status, 403);
  const { run, seed } = await w.open('invaders');
  const round = playRound(seed);
  await w.call('/runs/start', { run, init: round.init });
  const played = await w.play(run, round.chunks, round.score + 30);
  assert.equal(played.status, 403);
  assert.equal(played.body.error, 'score does not replay');
  assert.equal((await w.submit('invaders', round.score + 30, run)).status, 403);
  assert.equal((await w.submit('invaders', round.score, run)).status, 403);
  assert.deepEqual(await w.board('invaders'), []);
});

test('a round played faster than real time, or slowed right down, is refused', async () => {
  const fast = await w.open('invaders');
  const quick = playRound(fast.seed);
  await w.call('/runs/start', { run: fast.run, init: quick.init });
  const raced = await w.play(fast.run, quick.chunks, quick.score, { pace: 0.5 });
  assert.equal(raced.status, 403);
  assert.equal(raced.body.error, 'too fast');

  const slow = await w.open('invaders');
  const dragged = playRound(slow.seed);
  const ms = dragged.ticks * STEP * 1000;
  assert.ok(ms * 4 > ms * 1.15 + 120_000, `this round lasts only ${ms / 1000} s`);
  await w.call('/runs/start', { run: slow.run, init: dragged.init });
  const late = await w.play(slow.run, dragged.chunks, dragged.score, { pace: 4 });
  assert.equal(late.status, 403);
  assert.equal(late.body.error, 'too slow');

  // a minute's pause, and play a little slow, still counts
  const paused = await w.open('invaders');
  const honest = playRound(paused.seed);
  await w.call('/runs/start', { run: paused.run, init: honest.init });
  assert.equal((await w.play(paused.run, honest.chunks, honest.score, { pace: 1.1, lag: 60_000 })).status, 200);
});

test("another seed's round, and edited ones, are refused", async () => {
  const mine = await w.open('invaders');
  const other = playRound(mine.seed + 1);
  await w.call('/runs/start', { run: mine.run, init: other.init });
  const wrong = await w.play(mine.run, other.chunks, other.score);
  assert.equal(wrong.status, 403, 'the same inputs on another seed end elsewhere');

  const base = await w.open('invaders');
  const round = playRound(base.seed);
  assert.equal(replay(base.seed, round), round.score);
  const shots = (r: Run) => r.chunks.flatMap((c) => c.e.filter((e) => (e as unknown[])[1] === 'f').map((e) => ({ c, e: e as unknown[] })));
  const edits: [string, (r: Run) => void][] = [
    ['a pointer moved off the eighths', (r) => {
      const c = r.chunks.find((k) => k.e.some((e) => (e as unknown[])[1] === 'p'))!;
      const e = c.e.find((x) => (x as unknown[])[1] === 'p') as unknown[];
      e[2] = (e[2] as number) + 0.01;
    }],
    ['a third shot in the air', (r) => {
      const { c, e } = shots(r)[3];
      c.e.splice(c.e.indexOf(e), 0, [e[0], 'f'], [e[0], 'f']);
    }],
    ['a shot during the first banner', (r) => r.chunks[0].e.unshift([0, 'f'])],
    ['a shot moved earlier', (r) => {
      const { c, e } = shots(r)[5];
      const i = c.e.indexOf(e);
      const before = c.e[i - 1] as unknown[] | undefined;
      e[0] = Math.max((before?.[0] as number) ?? 0, (e[0] as number) - 30);
    }],
    ['events out of order', (r) => {
      const c = r.chunks.find((k) => k.e.length > 3)!;
      [c.e[0], c.e[2]] = [c.e[2], c.e[0]];
    }],
    ['an event past the chunk', (r) => r.chunks[0].e.push([(r.chunks[0].t as number) + 1, 'k', 1])],
    ['an event after the end', (r) => {
      const c = r.chunks[r.chunks.length - 1];
      c.e.push([c.t, 'k', -1]);
    }],
    ['a clock run on past the end', (r) => {
      r.chunks[r.chunks.length - 1].t = (r.chunks[r.chunks.length - 1].t as number) + 10;
    }],
    ['a key that is not one', (r) => r.chunks[0].e.push([r.chunks[0].t, 'k', 0.5])],
    ['an unknown event', (r) => r.chunks[0].e.push([r.chunks[0].t, 'x'])],
    ['an event that is not a list', (r) => r.chunks[0].e.push('f')],
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
    assert.notEqual(replay(base.seed, r), round.score, what);
  }
  // and through the Worker, an edit ends the run
  const edited = clone({ init: round.init, chunks: round.chunks }) as Run;
  edited.chunks[0].e.unshift([0, 'f']);
  await w.call('/runs/start', { run: base.run, init: edited.init });
  const refused = await w.play(base.run, edited.chunks, round.score);
  assert.equal(refused.status, 403);
  assert.equal(refused.at, 0);
  assert.equal(refused.body.error, 'cannot fire');
});

test('starts and chunks that are not from the game are refused', () => {
  for (const init of [null, 7, [], 'x', { wave: 5 }, { lives: 9 }]) assert.equal(typeof verifier.start(1, init), 'string', JSON.stringify(init));
  const begun = verifier.start(1, {});
  assert.ok(typeof begun !== 'string');
  assert.equal(begun.board, 'invaders');
  const s = begun.state;
  assert.equal(verifier.feed(s, 'events', 0), 'bad chunk');
  assert.equal(verifier.feed(s, [], -1), 'bad chunk');
  assert.equal(verifier.feed(s, [], 2.5), 'bad chunk');
  assert.equal(verifier.feed(s, [], Math.round(61 / STEP)), 'bad chunk', 'a minute in one chunk');
  assert.equal(verifier.feed(s, Array.from({ length: MAX_CHUNK_EVENTS + 1 }, () => [0, 'k', 0]), 0), 'bad chunk');
  assert.equal(verifier.feed(s, [[0, 'p', Number.MAX_VALUE]], 0), 'bad chunk');
  assert.deepEqual(verifier.feed(s, [[10, 'p', 300]], 240), { ms: 2000 });
  assert.equal(verifier.feed(s, [[100, 'k', 0]], 300), 'bad chunk', 'a step already played');
  assert.equal(verifier.end(s), 'still playing');
  assert.deepEqual(verifier.feed(s, [[240, 'f'], [241, 'f']], 241), { ms: 241 * STEP * 1000 });
  assert.equal(verifier.feed(s, [[242, 'f']], 242), 'cannot fire', 'two shots are already out');
});

test('a run only counts for its own board', async () => {
  const { run, seed } = await w.open('invaders');
  const round = playRound(seed);
  await w.call('/runs/start', { run, init: round.init });
  assert.equal((await w.play(run, round.chunks, round.score)).status, 200);
  // (each from its own address, clear of the board's rate limit)
  const others = Object.keys(VERIFIERS).filter((g) => g !== 'invaders');
  for (const [i, other] of others.entries()) {
    const tried = await w.call('/leaderboard', { game: other, name: 'Tester', score: round.score, run }, { 'CF-Connecting-IP': `198.51.100.${i + 1}` });
    assert.equal(tried.status, 403, other);
  }
  assert.equal((await w.submit('invaders', round.score, run)).status, 200);
});

test('the replayed rules use only math that comes out the same in every browser', () => {
  // (the Worker replays in V8, players' pages run in JavaScriptCore and SpiderMonkey too: see verify/dmath.ts)
  const src = replayedSource(new URL('../src/os/arcade/games/invaders/verify.ts', import.meta.url));
  for (const fn of ['stepInvaders', 'stepFormation', 'fireAlienShot', 'firePlayerShot', 'erodeShield', 'advanceWave', 'steerToward', 'newRound', 'createInvaders']) {
    assert.match(src, new RegExp(`function ${fn}\\b|const ${fn}\\b`), `the walk reaches ${fn}`);
  }
  assert.doesNotMatch(src, UNSTABLE_MATH);
  // and all of the rules the page plays by, which never draw on Math.random themselves (a run's rng comes from its seed)
  const logic = readFileSync(new URL('../src/os/arcade/games/invaders/logic.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.doesNotMatch(logic, UNSTABLE_MATH);
  assert.doesNotMatch(logic, /Math\.random\(/);
});
