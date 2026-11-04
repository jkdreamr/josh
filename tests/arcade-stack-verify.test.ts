// Stack's ranked runs (games/stack/verify.ts): towers built the way the page builds them replay to the same score on
// the Worker at any frame rate, end to end through the real Boards object, and anything the page could not have sent
// is refused.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { create, drop, RANGE, STEP, tick, type State } from '../src/os/arcade/games/stack/logic.ts';
import { verifier } from '../src/os/arcade/games/stack/verify.ts';
import { VERIFIERS } from '../src/os/arcade/verify/registry.ts';
import { BOARD_OWNERS } from '../worker/src/specs.gen.ts';
import { chunked, rankedWorker, type Chunk } from './ranked-harness.ts';

let w: ReturnType<typeof rankedWorker>;
beforeEach(() => {
  w = rankedWorker();
});
afterEach(() => w.restore());

/** Where a player aims each slab, off the centre of the one below: mostly flush, now and then well off. */
const AIM = [0, 0, 0, 0.3, 0, -0.25, 0, 0, 0, 0.15];

/**
 * Builds a tower the way the page does at `hz` frames a second: each frame a drop (stamped with the ticks so far) if
 * the slab is about over the player's aim, then the slide on in fixed steps. After `slabs` drops the player lets the
 * slab reach the far edge and drops it there, which misses. The chunks as the page sends them.
 */
function build(opts: { hz?: number; slabs?: number } = {}) {
  const dt = 1 / (opts.hz ?? 60);
  const s: State = create();
  const log: { at: number; ms: number; e?: unknown }[] = [];
  let acc = 0;
  let t = 0;
  for (let frame = 0; !s.over && frame < 2_000_000; frame++) {
    const below = s.stack[s.stack.length - 1];
    const m = s.axis === 'x' ? s.moving.x : s.moving.z;
    const b = s.axis === 'x' ? below.x : below.z;
    const quit = s.score >= (opts.slabs ?? 40);
    const aim = quit ? s.dir * RANGE : b + AIM[s.score % AIM.length];
    if (Math.abs(m - aim) <= s.speed * dt * (quit ? 1 : 0.5)) {
      log.push({ at: s.ticks, ms: Math.round(t * 1000), e: s.ticks });
      drop(s);
    }
    t += dt;
    acc += dt;
    while (acc >= STEP && !s.over) {
      acc -= STEP;
      tick(s);
    }
    log.push({ at: s.ticks, ms: Math.round(t * 1000) });
  }
  return { chunks: chunked(log), score: s.score, ticks: s.ticks, ms: s.ticks * STEP * 1000 };
}

function replay(chunks: Chunk[], seed = 1, init: unknown = {}) {
  const begun = verifier.start(seed, init);
  if (typeof begun === 'string') return begun;
  for (const c of chunks) {
    const fed = verifier.feed(begun.state, c.e, c.t);
    if (typeof fed === 'string') return fed;
  }
  const ended = verifier.end(begun.state);
  return typeof ended === 'string' ? ended : ended.score;
}

const copy = (chunks: Chunk[]) => chunks.map((c) => ({ ...c, e: [...c.e] }));

test('stack is checked, on its own board', () => {
  assert.equal(VERIFIERS.stack, verifier);
  assert.equal(BOARD_OWNERS.stack, 'stack');
});

test('a tower replays to the same score at any frame rate, cuts, perfects and all', () => {
  for (const hz of [30, 60, 144, 240]) {
    for (const slabs of [12, 40]) {
      const tower = build({ hz, slabs });
      assert.equal(tower.score, slabs, `${hz} Hz: the tower stood ${slabs} high before the miss`);
      assert.equal(replay(tower.chunks), tower.score, `${hz} Hz, ${slabs} slabs`);
    }
  }
});

test('an honest tower, built chunk by chunk in real time, goes on the board once', async () => {
  const { run } = await w.open('stack');
  const tower = build();
  assert.equal((await w.call('/runs/start', { run, init: {} })).status, 200);
  const done = await w.play(run, tower.chunks, tower.score);
  assert.equal(done.status, 200, JSON.stringify(done));
  assert.ok(tower.chunks.length > 3, 'the tower should take several chunks');
  assert.equal((await w.submit('stack', tower.score + 1, run)).status, 403, 'a taller tower than built');
  assert.equal((await w.submit('stack', tower.score, run)).status, 200);
  assert.deepEqual((await w.board('stack')).map((e) => [e.name, e.score]), [['Tester', tower.score]]);
  assert.equal((await w.submit('stack', tower.score, run)).status, 403, 'a run counts once');
});

test('a typed-in score, or one the tower did not reach, is refused', async () => {
  assert.equal((await w.submit('stack', 500)).status, 403);
  assert.equal((await w.submit('stack', 500, 'run-i-made-up')).status, 403);
  const { run } = await w.open('stack');
  const tower = build();
  await w.call('/runs/start', { run, init: {} });
  const claimed = await w.play(run, tower.chunks, 500);
  assert.equal(claimed.status, 403);
  assert.equal(claimed.body.error, 'score does not replay');
  assert.deepEqual(await w.board('stack'), []);
});

test('a tower built faster than real time, or slowed right down, is refused', async () => {
  const fast = await w.open('stack');
  const quick = build();
  await w.call('/runs/start', { run: fast.run, init: {} });
  const raced = await w.play(fast.run, quick.chunks, quick.score, { pace: 0.5 });
  assert.equal(raced.status, 403);
  assert.equal(raced.body.error, 'too fast');

  const slow = await w.open('stack');
  const tower = build();
  // (long enough that four times its length is past the 15% and 90 s allowed)
  assert.ok(tower.ms * 4 > tower.ms * 1.15 + 90_000, `this tower takes only ${tower.ms / 1000} s`);
  await w.call('/runs/start', { run: slow.run, init: {} });
  const dragged = await w.play(slow.run, tower.chunks, tower.score, { pace: 4 });
  assert.equal(dragged.status, 403);
  assert.equal(dragged.body.error, 'too slow');
});

test('edited or made-up drops are refused', () => {
  const tower = build({ slabs: 20 });
  const drops = tower.chunks.flatMap((c) => c.e as number[]);
  assert.equal(drops.length, 21);
  // the miss left out: the tower is still standing
  const standing = copy(tower.chunks);
  standing[standing.length - 1].e.pop();
  assert.equal(replay(standing), 'still stacking');
  // a drop after the miss
  const after = copy(tower.chunks);
  after[after.length - 1].e.push(tower.ticks);
  assert.equal(replay(after), 'drop after the miss');
  // a drop moved to where the slab was out over nothing: the tower ends there, and the drops after it can't come
  const missed = copy(tower.chunks);
  const first = missed.find((c) => c.e.length)!;
  first.e[0] = 0;
  assert.equal(replay(missed), 'drop after the miss');
  // more drops than were made: a different score
  const more = copy(tower.chunks);
  const c = more.find((x) => x.e.length >= 2)!;
  c.e.splice(1, 0, ((c.e[0] as number) + (c.e[1] as number)) >> 1);
  assert.notEqual(replay(more), tower.score);
  // a clock said to run on past the miss
  const longer = copy(tower.chunks);
  longer[longer.length - 1].t = tower.ticks + 10;
  assert.equal(replay(longer), 'clock past the miss');
  // stamps out of order, or past the chunk's clock
  const swapped = copy(tower.chunks);
  const d = swapped.find((x) => x.e.length >= 2)!;
  [d.e[0], d.e[1]] = [d.e[1], d.e[0]];
  assert.equal(replay(swapped), 'bad chunk');
  const past = copy(tower.chunks);
  const p = past.find((x) => x.e.length)!;
  p.e[p.e.length - 1] = (p.t as number) + 1;
  assert.equal(replay(past), 'bad chunk');
  // shapes the page never sends, a chunk claiming minutes of sliding, an oversized chunk
  for (const bad of [[-1], [0.5], ['3'], [[3]], [null], 'drops', null]) {
    const r = verifier.start(1, {});
    assert.ok(typeof r !== 'string');
    assert.equal(verifier.feed(r.state, bad, 100), 'bad chunk', JSON.stringify(bad));
  }
  for (const at of [-1, 0.5, '9', null, Math.round(61 / STEP)]) {
    const r = verifier.start(1, {});
    assert.ok(typeof r !== 'string');
    assert.equal(verifier.feed(r.state, [], at), 'bad chunk', String(at));
  }
  const crowd = verifier.start(1, {});
  assert.ok(typeof crowd !== 'string');
  assert.equal(verifier.feed(crowd.state, Array.from({ length: 4_001 }, () => 5), 10), 'bad chunk');
  for (const init of [null, [], 'tower', { board: 'flappy' }, { slabs: 3 }]) assert.equal(verifier.start(1, init), 'bad start', JSON.stringify(init));
});

test("a tower's drops replay under any seed (nothing in Stack is random), but each run counts once", async () => {
  // a seed has nothing to decide in Stack, so the same drops build the same tower under any run: what keeps a recorded
  // tower from being sent again and again is that every run is played out at the pace of the Worker's clock, and
  // counts once
  const tower = build();
  for (const seed of [1, 2, 3_000_000_000]) assert.equal(replay(tower.chunks, seed), tower.score);
  const first = await w.open('stack');
  await w.call('/runs/start', { run: first.run, init: {} });
  assert.equal((await w.play(first.run, tower.chunks, tower.score)).status, 200);
  assert.equal((await w.submit('stack', tower.score, first.run)).status, 200);
  assert.equal((await w.submit('stack', tower.score, first.run)).status, 403);
  assert.equal((await w.call('/runs/finish', { run: first.run, n: tower.chunks.length, e: [], t: tower.ticks, score: tower.score })).status, 409);
});

test('a stack run counts only for the stack board', async () => {
  const { run } = await w.open('stack');
  const tower = build();
  await w.call('/runs/start', { run, init: {} });
  assert.equal((await w.play(run, tower.chunks, tower.score)).status, 200);
  assert.equal((await w.submit('flappy', tower.score, run)).status, 403);
  assert.equal((await w.submit('snake', tower.score, run)).status, 403);
  assert.equal((await w.submit('stack', tower.score, run)).status, 200);
});
