// The Worker's Boards object taking scores only from runs it replays (verify/protocol.ts), end to end in one process:
// the real Boards class on node:sqlite standing in for the Durable Object's SQL storage, and Flappy Tree's verifier.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { autopilot, createState, hover, resize, rng32, step, STEP } from '../src/os/arcade/games/flappy/logic.ts';
import { verifier as flappy } from '../src/os/arcade/games/flappy/verify.ts';
import { AHEAD_MS, FEED_MS, paceError, WALL_CLOCK } from '../src/os/arcade/verify/protocol.ts';
import { VERIFIERS } from '../src/os/arcade/verify/registry.ts';
import { BOARD_OWNERS, LEADERBOARD_SPECS } from '../worker/src/specs.gen.ts';
import { rankedWorker } from './ranked-harness.ts';

let w: ReturnType<typeof rankedWorker>;
beforeEach(() => {
  w = rankedWorker();
});
afterEach(() => w.restore());
const call = (path: string, body: unknown, headers: Record<string, string> = {}) => w.call(path, body, headers);
const make = (env: Record<string, unknown> = {}) => w.restart(env);

type Chunk = { e: unknown[]; t: number; ms: number };
/** Flies a run the way the page does, cut into the chunks the page sends (every FEED_MS of play). */
function fly(seed: number, opts: { hz?: number; resizeAt?: number; flapEvery?: number } = {}) {
  const dt = 1 / (opts.hz ?? 60);
  const w = createState(462);
  const rng = rng32(seed);
  let t = 0;
  while (t < 0.5) {
    t += dt;
    w.y = hover(t);
  }
  const init = { w: w.w, y0: w.y };
  const chunks: Chunk[] = [];
  let events: unknown[] = [];
  let sinceFeed = 0;
  let first = true;
  for (let i = 0; i < 300_000 && !w.grounded; i++) {
    if (opts.resizeAt !== undefined && w.ticks >= opts.resizeAt && w.w === 462 && !w.dead) {
      resize(w, 700);
      events.push([w.ticks, 700]);
    }
    const flapIn = first || (opts.flapEvery ? i % opts.flapEvery === 0 : autopilot(w));
    first = false;
    if (flapIn && !w.dead) events.push(w.ticks);
    step(w, dt, { flap: flapIn }, rng);
    sinceFeed += dt * 1000;
    if (sinceFeed >= FEED_MS && !w.grounded) {
      chunks.push({ e: events, t: w.ticks, ms: w.ticks * STEP * 1000 });
      events = [];
      sinceFeed = 0;
    }
  }
  chunks.push({ e: events, t: w.ticks, ms: w.ticks * STEP * 1000 });
  return { init, chunks, score: w.score, ticks: w.ticks };
}

/** Opens and starts a run of Flappy Tree; its id and seed. */
async function open(init?: unknown) {
  const opened = await call('/runs', { game: 'flappy' });
  assert.equal(opened.status, 200);
  const run = opened.body.run as string;
  const seed = opened.body.seed as number;
  return { run, seed, start: (i: unknown = init) => call('/runs/start', { run, init: i }) };
}

/** Plays a flown run's chunks to the Worker, the clock moving on by each chunk's game time (times `pace`). */
async function play(run: string, flown: ReturnType<typeof fly>, opts: { pace?: number; score?: number } = {}) {
  const start = w.clock;
  let last: { status: number; body: Record<string, unknown> } = { status: 0, body: {} };
  for (let n = 0; n < flown.chunks.length; n++) {
    const c = flown.chunks[n];
    w.clock = start + Math.round(c.ms * (opts.pace ?? 1)) + 50;
    const finish = n === flown.chunks.length - 1;
    last = await call(finish ? '/runs/finish' : '/runs/feed', { run, n, e: c.e, t: c.t, ...(finish ? { score: opts.score ?? flown.score } : {}) });
    if (last.status !== 200) return { ...last, at: n };
  }
  return { ...last, at: flown.chunks.length };
}

const submit = (score: number, run?: string, game = 'flappy', name = 'Tester') => call('/leaderboard', run ? { game, name, score, run } : { game, name, score });
const board = async (game = 'flappy') => ({ entries: await w.board(game) });

test('every checked game has a verifier for boards that exist, and pace rules hold', () => {
  for (const game of Object.keys(VERIFIERS)) assert.ok(Object.values(BOARD_OWNERS).includes(game), `${game} has no boards`);
  assert.equal(paceError(10_000, 10_000, flappy.pace), null);
  assert.equal(paceError(10_000 + AHEAD_MS + 1, 10_000, flappy.pace), 'too fast');
  assert.equal(paceError(10_000, 10_000 * 1.15 + 90_000 + 1, flappy.pace), 'too slow');
  assert.equal(paceError(1_000, 10_000_000, WALL_CLOCK), null);
  assert.equal(paceError(Number.NaN, 1, WALL_CLOCK), 'bad clock');
});

test('a typed-in score, or one with a made-up run, is refused', async () => {
  assert.equal((await submit(507)).status, 403);
  assert.equal((await submit(507, 'not-a-run')).status, 403);
  assert.equal((await submit(507, '00000000-0000-4000-8000-000000000000')).status, 403);
  assert.deepEqual((await board()).entries, []);
});

test('an honest run, played chunk by chunk in real time, goes on the board once', async () => {
  const { run, seed, start } = await open();
  const flown = fly(seed);
  assert.equal((await start(flown.init)).status, 200);
  const played = await play(run, flown);
  assert.equal(played.status, 200, JSON.stringify(played));
  assert.ok(flown.chunks.length > 1, 'the run should take more than one chunk');
  assert.equal((await submit(flown.score + 1, run)).status, 403, 'a bigger score than flown');
  const ok = await submit(flown.score, run);
  assert.equal(ok.status, 200);
  assert.deepEqual((await board()).entries.map((e) => [e.name, e.score]), [['Tester', flown.score]]);
  assert.equal((await submit(flown.score, run)).status, 403, 'a run counts once');
  assert.equal((await call('/runs/finish', { run, n: 99, e: [], t: flown.ticks, score: flown.score })).status, 409);
});

test('a finished score must be what the replay flew', async () => {
  const { run, seed, start } = await open();
  const flown = fly(seed);
  await start(flown.init);
  const played = await play(run, flown, { score: 507 });
  assert.equal(played.status, 403);
  assert.equal(played.body.error, 'score does not replay');
  assert.equal((await submit(507, run)).status, 403);
});

test('a run played faster than real time, or slowed right down, is refused', async () => {
  const fast = await open();
  const quick = fly(fast.seed);
  await fast.start(quick.init);
  const raced = await play(fast.run, quick, { pace: 0.5 });
  assert.equal(raced.status, 403);
  assert.equal(raced.body.error, 'too fast');
  // (once refused, the run is over)
  assert.equal((await call('/runs/feed', { run: fast.run, n: raced.at + 1, e: [], t: quick.ticks })).status, 409);

  const slow = await open();
  const flown = fly(slow.seed);
  const ms = flown.ticks * STEP * 1000;
  // (long enough that four times its length is past the 15% and 90 s allowed)
  assert.ok(ms * 4 > ms * 1.15 + 90_000, `this course flies only ${ms / 1000} s`);
  await slow.start(flown.init);
  const dragged = await play(slow.run, flown, { pace: 4 });
  assert.equal(dragged.status, 403);
  assert.equal(dragged.body.error, 'too slow');
});

test('the flaps only fly the course of their own seed, and edits are refused', async () => {
  const mine = await open();
  const other = fly(mine.seed + 1);
  await mine.start(other.init);
  const wrong = await play(mine.run, other);
  // another seed's flaps either crash early here (a flap after the crash) or end on a different score
  assert.equal(wrong.status, 403);

  const edited = await open();
  const flown = fly(edited.seed);
  await edited.start(flown.init);
  const last = flown.chunks[flown.chunks.length - 1];
  last.e.push(flown.ticks + 5);
  last.t = flown.ticks + 10;
  assert.equal((await play(edited.run, flown)).status, 403);
});

test('starts and chunks that are not from the game are refused', async () => {
  const bad = await open();
  assert.equal((await bad.start({ w: 462, y0: 100 })).status, 403, 'started outside the hover');
  assert.equal((await bad.start({ w: 462, y0: 252 })).status, 409, 'a run starts once');

  const chunky = await open();
  const flown = fly(chunky.seed);
  await chunky.start(flown.init);
  w.clock += 1_000;
  assert.equal((await call('/runs/feed', { run: chunky.run, n: 1, e: [], t: 10 })).status, 409, 'chunk out of order');

  for (const [e, t] of [[[5, 3], 10], ['flaps', 10], [[-1], 10], [[0], 999_999_999], [[[0, 50]], 10]] as const) {
    const r = await open();
    await r.start(flown.init);
    w.clock += 1_000;
    assert.equal((await call('/runs/feed', { run: r.run, n: 0, e, t })).status, 403, JSON.stringify([e, t]));
  }
  assert.equal((await call('/runs/feed', { run: 'nope', n: 0, e: [], t: 1 })).status, 404);
  assert.equal((await call('/runs', { game: 'snake-not-checked' })).status, 404);
});

test('a run only counts for its own game and board', async () => {
  const { run, seed, start } = await open();
  const flown = fly(seed);
  await start(flown.init);
  assert.equal((await play(run, flown)).status, 200);
  assert.equal((await submit(flown.score, run, 'dino')).status, Object.hasOwn(VERIFIERS, BOARD_OWNERS.dino) ? 403 : 200);
  assert.equal((await submit(flown.score, run)).status, 200);
});

test('a run whose replay was lost (the object restarted) cannot finish', async () => {
  const { run, seed, start } = await open();
  const flown = fly(seed);
  await start(flown.init);
  make();
  w.clock += 9_000;
  const lost = await call('/runs/feed', { run, n: 0, e: flown.chunks[0].e, t: flown.chunks[0].t });
  assert.equal(lost.status, 410);
});

test('while a run is live an alarm keeps the object in, so a paused run survives; a run left for good is let go', async () => {
  const { run, seed, start } = await open();
  const flown = fly(seed);
  assert.equal(w.alarm, null);
  await start(flown.init);
  assert.equal(w.alarm, w.clock + 30_000, 'set as the run starts');
  // paused for a minute: nothing comes from the page, and the alarm goes off twice
  await w.ring();
  await w.ring();
  assert.notEqual(w.alarm, null, 'set again while the run is live');
  const played = await play(run, flown);
  assert.equal(played.status, 200, JSON.stringify(played));
  // nothing live: the next alarm lets the object go
  await w.ring();
  assert.equal(w.alarm, null);
  assert.equal((await submit(flown.score, run)).status, 200);

  // a run started and then left: three hours on, it is let go, and the alarms stop
  const left = await open();
  await left.start(fly(left.seed).init);
  let rings = 0;
  while (w.alarm !== null && rings < 1_000) {
    await w.ring();
    rings++;
  }
  assert.equal(w.alarm, null);
  assert.ok(rings >= (3 * 3600) / 30 && rings <= (3 * 3600) / 30 + 2, `${rings} alarms`);
  assert.equal((await call('/runs/feed', { run: left.run, n: 0, e: [], t: 10 })).status, 410);
});

test('runs replay the same at any frame rate, with the window resized mid-flight', async () => {
  for (const hz of [30, 60, 144]) {
    const { run, seed, start } = await open();
    const flown = fly(seed, { hz, resizeAt: 1500 });
    await start(flown.init);
    const played = await play(run, flown);
    assert.equal(played.status, 200, `${hz} Hz: ${JSON.stringify(played.body)}`);
  }
});

test('opening runs is rate limited per address', async () => {
  let limited = 0;
  for (let i = 0; i < 45; i++) if ((await call('/runs', { game: 'flappy' })).status === 429) limited++;
  assert.equal(limited, 5);
});

test('entries come off a board only with the admin token', async () => {
  w.db.prepare('INSERT INTO scores (game, name, score, date) VALUES (?, ?, ?, ?)').run('flappy', 'KingVaan', 507, '2026-11-01T00:00:00.000Z');
  w.db.prepare('INSERT INTO scores (game, name, score, date) VALUES (?, ?, ?, ?)').run('flappy', 'Honest', 12, '2026-11-01T00:00:00.000Z');
  assert.equal((await call('/leaderboard/remove', { game: 'flappy', name: 'KingVaan' })).status, 403, 'off without the secret');
  make({ BOARDS_ADMIN_TOKEN: 'a-long-test-secret' });
  assert.equal((await call('/leaderboard/remove', { game: 'flappy', name: 'KingVaan' }, { authorization: 'Bearer wrong' })).status, 401);
  const removed = await call('/leaderboard/remove', { game: 'flappy', name: 'KingVaan', score: 507 }, { authorization: 'Bearer a-long-test-secret' });
  assert.equal(removed.status, 200);
  assert.equal(removed.body.removed, 1);
  assert.deepEqual((await board()).entries.map((e) => e.name), ['Honest']);
  assert.equal((await call('/leaderboard/remove', { game: 'nope', name: 'x' }, { authorization: 'Bearer a-long-test-secret' })).status, 400);
});

test('boards are generated for every board owner the Worker knows', () => {
  for (const id of Object.keys(LEADERBOARD_SPECS)) assert.ok(BOARD_OWNERS[id], `${id} has no owner`);
});
