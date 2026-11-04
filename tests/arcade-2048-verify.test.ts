// 2048's ranked runs (games/2048/verify.ts): games played the way the page plays them replay to the same score on the
// Worker, end to end through the real Boards object, and anything the page could not have sent is refused.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { canMove, emptyGrid, move, MOVES, seeded, slide, spawn, UNDO, type Grid } from '../src/os/arcade/games/2048/logic.ts';
import { verifier } from '../src/os/arcade/games/2048/verify.ts';
import { VERIFIERS } from '../src/os/arcade/verify/registry.ts';
import { BOARD_OWNERS } from '../worker/src/specs.gen.ts';
import { chunked, rankedWorker, type Chunk } from './ranked-harness.ts';

let w: ReturnType<typeof rankedWorker>;
beforeEach(() => {
  w = rankedWorker();
});
afterEach(() => w.restore());

/** A slide that keeps the big tiles in a corner: down, left, right, then up, whichever moves first. */
const PREFER = [3, 0, 1, 2];

/**
 * Plays a game the way the page does: the two tiles dealt from the seed, a slide every `gap` ms (the clock ticking each
 * frame at `hz` in between), the undo once after `undoAt` slides, and the Game Over card 0.7 s after the board sticks.
 * The run's chunks as the page sends them, its score and its events.
 */
function playGame(seed: number, opts: { hz?: number; gap?: (i: number) => number; undoAt?: number } = {}) {
  const rand = seeded(seed);
  const first = spawn(emptyGrid(), rand);
  let grid: Grid = spawn(first.grid, rand).grid;
  let score = 0;
  let previous: { grid: Grid; score: number } | null = null;
  let undoUsed = false;
  const frame = 1000 / (opts.hz ?? 60);
  const gap = opts.gap ?? ((i: number) => 180 + ((i * 37) % 260));
  const log: { at: number; ms: number; e?: unknown }[] = [];
  const events: [number, number][] = [];
  let ms = 0;
  let next = 0;
  const tick = (to: number) => {
    // the page stamps its clock every frame, and on every slide
    while (next + frame <= to) {
      next += frame;
      const at = Math.round(next);
      log.push({ at, ms: at });
    }
  };
  for (let i = 0; canMove(grid) && i < 20_000; i++) {
    ms += gap(i);
    tick(ms);
    if (opts.undoAt !== undefined && i === opts.undoAt && !undoUsed && previous) {
      grid = previous.grid;
      score = previous.score;
      previous = null;
      undoUsed = true;
      events.push([ms, UNDO]);
      log.push({ at: ms, ms, e: [ms, UNDO] });
      continue;
    }
    const d = PREFER.find((m) => move(grid, MOVES[m]).moved)!;
    const slid = move(grid, MOVES[d]);
    if (!undoUsed) previous = { grid, score };
    grid = spawn(slid.grid, rand).grid;
    score += slid.gained;
    events.push([ms, d]);
    log.push({ at: ms, ms, e: [ms, d] });
  }
  tick(ms + 700);
  return { chunks: chunked(log), score, events, ms: ms + 700 };
}

/** Feeds a played game's chunks straight to the verifier. Its score, or why it was refused. */
function replay(seed: number, chunks: Chunk[], init: unknown = {}) {
  const begun = verifier.start(seed, init);
  if (typeof begun === 'string') return begun;
  for (const c of chunks) {
    const fed = verifier.feed(begun.state, c.e, c.t);
    if (typeof fed === 'string') return fed;
  }
  const ended = verifier.end(begun.state);
  return typeof ended === 'string' ? ended : ended.score;
}

async function opened() {
  const { run, seed } = await w.open('2048');
  return { run, seed, start: (init: unknown = {}) => w.call('/runs/start', { run, init }) };
}

test('2048 is checked, on its own board', () => {
  assert.equal(VERIFIERS['2048'], verifier);
  assert.equal(BOARD_OWNERS['2048'], '2048');
  const begun = verifier.start(1, {});
  assert.ok(typeof begun !== 'string' && begun.board === '2048');
});

test("the replay's quick slide is the page's move, for every line and every way", () => {
  // every line of 0, 2, 4, 8 and 16 (each pattern of equal and empty neighbours there is), in every row and column
  const values = [0, 2, 4, 8, 16];
  for (let n = 0; n < 5 ** 4; n++) {
    const line = [0, 1, 2, 3].map((k) => values[Math.floor(n / 5 ** k) % 5]);
    for (let at = 0; at < 4; at++) {
      for (const across of [true, false]) {
        const grid = emptyGrid();
        for (let k = 0; k < 4; k++) {
          if (across) grid[at][k] = line[k];
          else grid[k][at] = line[k];
        }
        for (const d of MOVES) {
          const a = move(grid, d);
          assert.deepEqual(slide(grid, d), { grid: a.grid, moved: a.moved, gained: a.gained }, `${JSON.stringify(grid)} ${d}`);
        }
      }
    }
  }
  // and whole boards from real games
  const rand = seeded(3);
  for (let g = 0; g < 40; g++) {
    let grid: Grid = spawn(spawn(emptyGrid(), rand).grid, rand).grid;
    while (canMove(grid)) {
      for (const d of MOVES) {
        const a = move(grid, d);
        assert.deepEqual(slide(grid, d), { grid: a.grid, moved: a.moved, gained: a.gained });
      }
      const d = MOVES.find((m) => move(grid, m).moved && rand() < 0.6) ?? MOVES.find((m) => move(grid, m).moved)!;
      grid = spawn(move(grid, d).grid, rand).grid;
    }
  }
});

test('a game replays to the same score however fast its frames came, with the undo used', () => {
  for (const hz of [30, 60, 144]) {
    for (const seed of [1, 99, 4_000_000_000]) {
      const played = playGame(seed, { hz, undoAt: 40 });
      assert.ok(played.score > 500, `seed ${seed} scored only ${played.score}`);
      assert.ok(played.events.some((e) => e[1] === UNDO), 'the undo was used');
      assert.equal(replay(seed, played.chunks), played.score, `${hz} Hz, seed ${seed}`);
    }
  }
});

test('an honest game, played chunk by chunk in real time, goes on the board once', async () => {
  const { run, seed, start } = await opened();
  const played = playGame(seed, { undoAt: 25 });
  assert.equal((await start()).status, 200);
  const done = await w.play(run, played.chunks, played.score);
  assert.equal(done.status, 200, JSON.stringify(done));
  assert.ok(played.chunks.length > 3, 'the game should take several chunks');
  assert.equal((await w.submit('2048', played.score + 4, run)).status, 403, 'a bigger score than played');
  assert.equal((await w.submit('2048', played.score, run)).status, 200);
  assert.deepEqual((await w.board('2048')).map((e) => [e.name, e.score]), [['Tester', played.score]]);
  assert.equal((await w.submit('2048', played.score, run)).status, 403, 'a run counts once');
});

test('a game left alone for hours between slides still counts (its time is the wall clock)', async () => {
  const { run, seed, start } = await opened();
  const played = playGame(seed, { gap: (i) => (i === 10 ? 3_600_000 : 250) });
  await start();
  const done = await w.play(run, played.chunks, played.score, { pace: 3 });
  assert.equal(done.status, 200, JSON.stringify(done));
  assert.equal((await w.submit('2048', played.score, run)).status, 200);
});

test('a typed-in score, or a score the game did not reach, is refused', async () => {
  assert.equal((await w.submit('2048', 20_000)).status, 403);
  assert.equal((await w.submit('2048', 20_000, 'not-a-run')).status, 403);
  const { run, seed, start } = await opened();
  const played = playGame(seed);
  await start();
  const claimed = await w.play(run, played.chunks, played.score + 1_000);
  assert.equal(claimed.status, 403);
  assert.equal(claimed.body.error, 'score does not replay');
  assert.equal((await w.submit('2048', played.score + 1_000, run)).status, 403);
  assert.equal((await w.submit('2048', played.score, run)).status, 403, 'a refused run counts for nothing');
  assert.deepEqual(await w.board('2048'), []);
});

test('a game played faster than the clock is refused', async () => {
  const { run, seed, start } = await opened();
  const played = playGame(seed);
  await start();
  const raced = await w.play(run, played.chunks, played.score, { pace: 0.5 });
  assert.equal(raced.status, 403);
  assert.equal(raced.body.error, 'too fast');
});

test('a game that ends before the board is stuck has no score', async () => {
  const { run, seed, start } = await opened();
  const played = playGame(seed);
  await start();
  // the game's second half dropped: the board was still open when the run claims to have ended
  const cut = played.chunks.slice(0, Math.ceil(played.chunks.length / 2));
  const r = await w.play(run, cut, played.score);
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'still playing');
});

test('edited or made-up slides are refused', () => {
  const seed = 7;
  const played = playGame(seed, { undoAt: 30 });
  const copy = () => played.chunks.map((c) => ({ ...c, e: c.e.map((e) => [...(e as number[])]) }));
  const at = (chunks: Chunk[], i: number) => {
    let n = i;
    for (const c of chunks) {
      if (n < c.e.length) return c.e[n] as number[];
      n -= c.e.length;
    }
    throw new Error('no such event');
  };
  // a slide turned round: either it moves nothing (the board was packed that way) or the game goes elsewhere
  for (const i of [3, 50, played.events.length - 1]) {
    const edited = copy();
    const e = at(edited, i);
    e[1] = e[1] === UNDO ? 0 : (e[1] + 1) % 4;
    assert.notEqual(replay(seed, edited), played.score, `slide ${i}`);
  }
  // a slide after the board is stuck
  const extra = copy();
  const last = extra[extra.length - 1];
  const end = last.t as number;
  last.e.push([end, 0], [end, 1], [end, 2], [end, 3]);
  assert.equal(replay(seed, extra), 'impossible move');
  // a second undo
  const twice = copy();
  const ms1 = (twice[0].e[1] as number[])[0];
  twice[0].e.splice(2, 0, [ms1, UNDO], [ms1, UNDO]);
  assert.equal(replay(seed, twice), 'no undo');
  // an undo before any slide
  const early = copy();
  early[0].e.unshift([0, UNDO]);
  assert.equal(replay(seed, early), 'no undo');
  // stamps out of order, or past the chunk's own clock
  const swapped = copy();
  const [a, b] = [swapped[0].e[0] as number[], swapped[0].e[1] as number[]];
  [a[0], b[0]] = [b[0] + 1, a[0]];
  assert.equal(replay(seed, swapped), 'bad chunk');
  const late = copy();
  (late[0].e[0] as number[])[0] = (late[0].t as number) + 1;
  assert.equal(replay(seed, late), 'bad chunk');
  // a chunk whose clock goes back
  const back = copy();
  back[1].t = (back[0].t as number) - 1;
  back[1].e = [];
  assert.equal(replay(seed, back), 'bad chunk');
  // shapes the page never sends
  for (const bad of [[[0, 5]], [[0, -1]], [[0, 1.5]], [[0, '1']], [[-5, 0]], [[0.5, 0]], [{ ms: 0, d: 0 }], [[0]], [[0, 0, 0]], 'slides', null]) {
    const r = verifier.start(seed, {});
    assert.ok(typeof r !== 'string');
    assert.equal(typeof verifier.feed(r.state, bad, 1_000), 'string', JSON.stringify(bad));
  }
  for (const t of [-1, 0.5, '9', Number.MAX_SAFE_INTEGER, null]) {
    const r = verifier.start(seed, {});
    assert.ok(typeof r !== 'string');
    assert.equal(verifier.feed(r.state, [], t), 'bad chunk', String(t));
  }
  const crowd = verifier.start(seed, {});
  assert.ok(typeof crowd !== 'string');
  assert.equal(verifier.feed(crowd.state, Array.from({ length: 1_001 }, () => [0, 0]), 10), 'bad chunk', 'an oversized chunk');
  for (const init of [null, [], 'go', { board: 'flappy' }, { seed: 1 }]) assert.equal(verifier.start(seed, init), 'bad start', JSON.stringify(init));
});

test("another seed's slides do not replay here", async () => {
  const { run, seed, start } = await opened();
  const other = playGame(seed + 1);
  await start();
  const r = await w.play(run, other.chunks, other.score);
  assert.equal(r.status, 403);
  // offline, a handful of other deals: none comes out on the score its own deal made
  for (const s of [2, 3, 5, 8, 13]) assert.notEqual(replay(s + 100, playGame(s).chunks), playGame(s).score);
});

test("a 2048 run counts only for 2048's board", async () => {
  const { run, seed, start } = await opened();
  const played = playGame(seed);
  await start();
  assert.equal((await w.play(run, played.chunks, played.score)).status, 200);
  assert.equal((await w.submit('flappy', played.score, run)).status, 403);
  assert.equal((await w.submit('2048', played.score, run)).status, 200);
});
