// Bubble Shooter's ranked runs (see games/bubble-shooter/verify.ts): Endless runs recorded the way the page records them,
// at several frame rates, replay to the same score on the Worker's verifier, and the Worker takes their scores once;
// scores the run didn't reach, runs played too fast or too slow, edited or borrowed shots, and Levels are refused.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { loopSteps } from '../src/os/arcade/kit/loop-core.ts';
import { advance, canShoot, createGame, findMatches, fire, MIN_ANGLE, rowLength, STEP, swap, traceAim, type Game } from '../src/os/arcade/games/bubble-shooter/logic.ts';
import { MAX_CHUNK_EVENTS, MAX_CHUNK_TICKS, verifier } from '../src/os/arcade/games/bubble-shooter/verify.ts';
import { FEED_MS, paceError } from '../src/os/arcade/verify/protocol.ts';
import { VERIFIERS } from '../src/os/arcade/verify/registry.ts';
import { BOARD_OWNERS } from '../worker/src/specs.gen.ts';
import { rankedWorker, type Chunk } from './ranked-harness.ts';

let w: ReturnType<typeof rankedWorker>;
beforeEach(() => {
  w = rankedWorker();
});
afterEach(() => w.restore());

/** How many bubbles a shot at `angle` would join (its own color's group where it lands). */
function joins(g: Game, angle: number): number {
  const { cell } = traceAim(g, angle);
  if (!cell) return -1;
  const added = cell.r >= g.grid.length;
  if (added) g.grid.push(new Array<number>(rowLength(cell.r, g.parity)).fill(-1));
  const before = g.grid[cell.r][cell.c];
  g.grid[cell.r][cell.c] = g.current;
  const n = findMatches(g, cell.r, cell.c).length;
  g.grid[cell.r][cell.c] = before;
  if (added) g.grid.pop();
  return n;
}

/** The bot's aim: the angle (of a fan of them, nudged by `wiggle`) that joins the biggest group. */
function bestAim(g: Game, wiggle: number): { angle: number; n: number } {
  let best = { angle: Math.PI / 2, n: -1 };
  for (let i = 0; i <= 40; i++) {
    const angle = Math.min(Math.PI - MIN_ANGLE, MIN_ANGLE + ((Math.PI - 2 * MIN_ANGLE) * (i + wiggle)) / 40);
    const n = joins(g, angle);
    if (n > best.n) best = { angle, n };
  }
  return best;
}

type Played = { init: unknown; chunks: Chunk[]; score: number; ticks: number; shots: number; swaps: number };

/**
 * Plays an Endless run the way the page does: shots (at the launcher's aim) and swaps recorded with the step they came
 * before, the rules run in fixed steps on a realtime loop, chunks cut every FEED_MS of play. A bot takes `good` aimed
 * shots (swapping now and then), thinking a moment between them, then fires straight up until the line is reached.
 * Frames come at about `hz` (jittered, with an occasional long one).
 */
function playBubbles(seed: number, opts: { hz?: number; good?: number } = {}): Played {
  const hz = opts.hz ?? 60;
  const good = opts.good ?? 110;
  const g = createGame({ mode: 'endless', seed });
  const chunks: Chunk[] = [];
  let events: unknown[] = [];
  const flush = () => {
    chunks.push({ e: events, t: g.ticks, ms: g.ticks * STEP * 1000 });
    events = [];
  };
  const record = (e: unknown) => {
    events.push(e);
    if (events.length >= 1_000) flush();
  };
  let shots = 0;
  let swaps = 0;
  let think = 0;
  let jitter = 4_242;
  let sinceFeed = 0;
  for (let frame = 0; frame < 2_000_000 && !g.ended; frame++) {
    jitter = (jitter * 1_103_515_245 + 12_345) >>> 0;
    const r = jitter / 2 ** 32;
    const elapsed = frame % 211 === 210 ? 0.3 : (1 / hz) * (0.8 + 0.4 * r);
    for (const dt of loopSteps(frame === 0 ? 0 : elapsed, true)) {
      if (g.ended) break;
      if (g.shot === null) think += dt;
      if (canShoot(g) && think >= 0.3 + 0.3 * r) {
        think = 0;
        if (shots % 6 === 5 && swap(g)) {
          swaps++;
          record(g.ticks);
          if (shots % 12 === 11 && swap(g)) {
            swaps++;
            record(g.ticks);
          }
        }
        const angle = shots < good ? bestAim(g, r).angle : Math.PI / 2;
        if (fire(g, angle)) {
          shots++;
          record([g.ticks, angle]);
        }
      }
      advance(g, dt);
      g.effects.length = 0;
    }
    sinceFeed += elapsed * 1000;
    if (sinceFeed >= FEED_MS && !g.ended) {
      flush();
      sinceFeed = 0;
    }
  }
  flush();
  return { init: { mode: 'endless' }, chunks, score: g.score, ticks: g.ticks, shots, swaps };
}

/** Plays a recorded run through the verifier alone: its score, or why it was refused. */
function replay(seed: number, played: Pick<Played, 'init' | 'chunks'>): number | string {
  const begun = verifier.start(seed, played.init);
  if (typeof begun === 'string') return begun;
  for (const c of played.chunks) {
    const fed = verifier.feed(begun.state, c.e, c.t);
    if (typeof fed === 'string') return fed;
  }
  const ended = verifier.end(begun.state);
  return typeof ended === 'string' ? ended : ended.score;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

test('bubble shooter is checked, on its own board', () => {
  assert.equal(VERIFIERS['bubble-shooter'], verifier);
  assert.equal(BOARD_OWNERS['bubble-shooter'], 'bubble-shooter');
  assert.equal(verifier.partial, undefined);
});

test('an Endless run recorded at any frame rate replays to the score the page showed', () => {
  for (const hz of [30, 60, 144]) {
    for (const seed of [11, 3_000_000_019]) {
      const played = playBubbles(seed, { hz });
      assert.ok(played.score > 2_000, `${hz} Hz: the bot only made ${played.score}`);
      assert.ok(played.chunks.length > 3 && played.swaps > 5, `${hz} Hz: ${played.chunks.length} chunks, ${played.swaps} swaps`);
      assert.equal(replay(seed, played), played.score, `${hz} Hz, seed ${seed}`);
    }
  }
});

test('an honest run, played chunk by chunk in real time, goes on the board once', async () => {
  const { run, seed } = await w.open('bubble-shooter');
  const played = playBubbles(seed);
  assert.equal((await w.call('/runs/start', { run, init: played.init })).status, 200);
  const done = await w.play(run, played.chunks, played.score);
  assert.equal(done.status, 200, JSON.stringify(done));
  assert.equal((await w.submit('bubble-shooter', played.score + 10, run)).status, 403, 'a bigger score than played');
  assert.equal((await w.submit('bubble-shooter', played.score, run)).status, 200);
  assert.deepEqual((await w.board('bubble-shooter')).map((e) => [e.name, e.score]), [['Tester', played.score]]);
  assert.equal((await w.submit('bubble-shooter', played.score, run)).status, 403, 'a run counts once');
});

test('a typed-in score, a score the run did not reach, or an unfinished run is refused', async () => {
  assert.equal((await w.submit('bubble-shooter', 99_999)).status, 403);
  assert.equal((await w.submit('bubble-shooter', 99_999, 'not-a-run')).status, 403);
  const { run, seed } = await w.open('bubble-shooter');
  const played = playBubbles(seed);
  await w.call('/runs/start', { run, init: played.init });
  const claimed = await w.play(run, played.chunks, played.score * 2);
  assert.equal(claimed.status, 403);
  assert.equal(claimed.body.error, 'score does not replay');
  assert.equal((await w.submit('bubble-shooter', played.score, run)).status, 403);

  const cut = await w.open('bubble-shooter');
  const partway = playBubbles(cut.seed);
  await w.call('/runs/start', { run: cut.run, init: partway.init });
  const unfinished = await w.play(cut.run, partway.chunks.slice(0, 3), partway.score);
  assert.equal(unfinished.status, 403);
  assert.equal(unfinished.body.error, 'still playing');
  assert.deepEqual(await w.board('bubble-shooter'), []);
});

test('a run played faster than real time, or slowed right down, is refused', async () => {
  const fast = await w.open('bubble-shooter');
  const quick = playBubbles(fast.seed);
  await w.call('/runs/start', { run: fast.run, init: quick.init });
  const raced = await w.play(fast.run, quick.chunks, quick.score, { pace: 0.5 });
  assert.equal(raced.status, 403);
  assert.equal(raced.body.error, 'too fast');

  const slow = await w.open('bubble-shooter');
  const played = playBubbles(slow.seed);
  const ms = played.ticks * STEP * 1000;
  assert.ok(ms * 3 > ms * 1.15 + 90_000, `this run lasts only ${ms / 1000} s`);
  await w.call('/runs/start', { run: slow.run, init: played.init });
  const dragged = await w.play(slow.run, played.chunks, played.score, { pace: 3 });
  assert.equal(dragged.status, 403);
  assert.equal(dragged.body.error, 'too slow');
  assert.equal(paceError(ms, ms * 1.1 + 60_000, verifier.pace), null, 'a frame dropped and a pause or two is fine');
});

test("another seed's shots don't play this seed's board", async () => {
  const { run, seed } = await w.open('bubble-shooter');
  const other = playBubbles(seed + 1);
  await w.call('/runs/start', { run, init: other.init });
  assert.equal((await w.play(run, other.chunks, other.score)).status, 403);
  assert.notEqual(replay(seed, other), other.score);
});

test('edited shots and swaps are refused', () => {
  const seed = 77;
  const played = playBubbles(seed);
  assert.equal(replay(seed, played), played.score);
  const shotsIn = (c: Chunk) => c.e.filter((e) => Array.isArray(e)) as number[][];
  const edits: [string, (p: Played) => void][] = [
    ['a shot aimed elsewhere', (p) => {
      const s = shotsIn(p.chunks[1])[2];
      s[1] = s[1] > 1.6 ? s[1] - 0.9 : s[1] + 0.9;
    }],
    ['a shot fired again while the last one flies', (p) => {
      const c = p.chunks[1];
      const i = c.e.findIndex((e) => Array.isArray(e));
      c.e.splice(i + 1, 0, [(c.e[i] as number[])[0] + 1, Math.PI / 2]);
    }],
    ['a shot taken out', (p) => {
      const c = p.chunks[2];
      c.e.splice(c.e.findIndex((e) => Array.isArray(e)), 1);
    }],
    ['a shot put off', (p) => {
      for (const s of shotsIn(p.chunks[1])) s[0] += 100;
    }],
    ['an extra swap', (p) => {
      const c = p.chunks[1];
      const i = c.e.findIndex((e) => Array.isArray(e));
      c.e.splice(i, 0, (c.e[i] as number[])[0]);
    }],
    ['the clock run on past the end', (p) => {
      p.chunks[p.chunks.length - 1].t = (p.chunks[p.chunks.length - 1].t as number) + 50;
    }],
    ['a shot after the end', (p) => {
      const c = p.chunks[p.chunks.length - 1];
      c.e.push([c.t, Math.PI / 2]);
    }],
  ];
  for (const [what, edit] of edits) {
    const p = clone(played);
    edit(p);
    const got = replay(seed, p);
    assert.ok(typeof got === 'string' || got !== played.score, `${what}: replayed to ${got}`);
  }
});

test('Levels, other starts and chunks that are not from the game are refused', async () => {
  for (const init of [undefined, null, {}, { mode: 'levels' }, { mode: 'levels', level: 3 }, { mode: 'endless', level: 2 }, { board: 'bubble-shooter' }, ['endless'], 'endless']) {
    assert.equal(typeof verifier.start(1, init), 'string', JSON.stringify(init));
  }
  const fresh = () => verifier.start(5, { mode: 'endless' }) as { state: Parameters<typeof verifier.feed>[0] };
  const bad: [unknown, unknown][] = [
    ['shots', 10],
    [[], -1],
    [[], 2.5],
    [[], MAX_CHUNK_TICKS + 1],
    [[11], 10],
    [[6, 3], 10],
    [[[3, Math.PI / 2], [3, Math.PI / 2]], 10],
    [[[3, 0]], 10],
    [[[3, Math.PI]], 10],
    [[[3, Number.NaN]], 10],
    [[[3, '1.5']], 10],
    [[[3]], 10],
    [[[3, 1.5, 0]], 10],
    [[{ t: 3, a: 1.5 }], 10],
    [Array.from({ length: MAX_CHUNK_EVENTS + 1 }, () => 0), 10],
    [Array.from({ length: 30 }, (_, i) => [i * 2, Math.PI / 2]), 60],
  ];
  for (const [e, t] of bad) assert.equal(typeof verifier.feed(fresh().state, e, t), 'string', JSON.stringify([e, t]).slice(0, 80));
  // (a swap, then a shot, at the right steps is fine)
  assert.deepEqual(verifier.feed(fresh().state, [2, [3, Math.PI / 2]], 10), { ms: 10 * STEP * 1000 });

  const levels = await w.open('bubble-shooter');
  const refused = await w.call('/runs/start', { run: levels.run, init: { mode: 'levels' } });
  assert.equal(refused.status, 403);
  const ok = await w.open('bubble-shooter');
  await w.call('/runs/start', { run: ok.run, init: { mode: 'endless' } });
  w.clock += 1_000;
  assert.equal((await w.call('/runs/feed', { run: ok.run, n: 0, e: [[0, 9]], t: 10 })).status, 403);
});

test('a bubble shooter run only counts on its own board', async () => {
  const { run, seed } = await w.open('bubble-shooter');
  const played = playBubbles(seed);
  await w.call('/runs/start', { run, init: played.init });
  assert.equal((await w.play(run, played.chunks, played.score)).status, 200);
  assert.notEqual((await w.submit('flappy', played.score, run)).status, 200);
  assert.notEqual((await w.submit('blocks', played.score, run)).status, 200);
  assert.equal((await w.submit('bubble-shooter', played.score, run)).status, 200);
  // and another game's checked run doesn't count here
  w.db.prepare('INSERT INTO ranked_runs (id, game, seed, issued, started, finished, board, score, used) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)').run('flown', 'flappy', 1, w.clock, w.clock, w.clock, 'flappy', 42);
  assert.equal((await w.submit('bubble-shooter', 42, 'flown')).status, 403);
});
