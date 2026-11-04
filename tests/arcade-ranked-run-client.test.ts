// The page's side of a ranked run (kit/run.ts): what it sends the Worker, and when.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import { RankedRun } from '../src/os/arcade/kit/run.ts';
import { FEED_MS, FIRST_FEED_MS, isDeviceKey } from '../src/os/arcade/verify/protocol.ts';

type Sent = { path: string; body: any };
let sent: Sent[];
let wall: number;
let status: (path: string) => number;
let finishScore: unknown;
const realFetch = globalThis.fetch;
const realNow = performance.now;

beforeEach(() => {
  sent = [];
  wall = 1_000;
  status = () => 200;
  finishScore = undefined;
  mock.timers.enable({ apis: ['setTimeout'] });
  performance.now = () => wall;
  globalThis.fetch = (async (url: string, init: { body: string }) => {
    const path = url.replace('http://arcade.test', '');
    sent.push({ path, body: JSON.parse(init.body) });
    const code = status(path);
    const json = path === '/runs' ? { run: 'run-1', seed: 7 } : path === '/runs/finish' && finishScore !== undefined ? { ok: true, score: finishScore } : { ok: true };
    return new Response(JSON.stringify(json), { status: code, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
});
afterEach(() => {
  mock.timers.reset();
  globalThis.fetch = realFetch;
  performance.now = realNow;
});

/** Lets the fetches and promise chains in flight settle. */
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise<void>((r) => queueMicrotask(r));
  await new Promise((r) => setImmediate(r));
};
/** Moves the clock on, timers and all. */
const pass = async (ms: number) => {
  wall += ms;
  mock.timers.tick(ms);
  await settle();
};
const feeds = () => sent.filter((s) => s.path === '/runs/feed').map((s) => s.body);

async function begun() {
  const run = new RankedRun('flappy', 'http://arcade.test');
  assert.equal(run.pending, true);
  await settle();
  assert.equal(run.pending, false);
  assert.equal(run.seed, 7);
  assert.equal(run.begin({ w: 400 }), true);
  await settle();
  assert.deepEqual(sent.map((s) => s.path), ['/runs', '/runs/start']);
  assert.deepEqual(sent[1].body, { run: 'run-1', init: { w: 400 } });
  return run;
}

test('chunks go soon after the start, then every FEED_MS, in order, with the clock they reached', async () => {
  const run = await begun();
  run.record(3);
  run.clock(40);
  await pass(FIRST_FEED_MS - 1);
  assert.equal(feeds().length, 0);
  await pass(1);
  assert.deepEqual(feeds(), [{ run: 'run-1', n: 0, e: [3], t: 40 }]);
  run.record(50);
  run.record(61);
  run.clock(900);
  await pass(FEED_MS);
  assert.deepEqual(feeds()[1], { run: 'run-1', n: 1, e: [50, 61], t: 900 });
  // the score goes with the last of them
  run.record(905);
  run.clock(910);
  assert.equal(run.end(12), 'run-1');
  await settle();
  assert.deepEqual(sent.at(-1), { path: '/runs/finish', body: { run: 'run-1', n: 2, e: [905], t: 910, score: 12 } });
  // and nothing after it
  run.record(1);
  run.clock(2_000);
  await pass(FEED_MS * 3);
  assert.equal(sent.length, 5);
  assert.equal(run.end(99), undefined);
});

test('a paused game (no moves, the clock standing still) sends nothing', async () => {
  const run = await begun();
  run.clock(10);
  await pass(FIRST_FEED_MS);
  assert.equal(feeds().length, 1);
  await pass(FEED_MS * 10);
  assert.equal(feeds().length, 1, 'no requests while paused');
  run.clock(11);
  await pass(FEED_MS);
  assert.deepEqual(feeds()[1], { run: 'run-1', n: 1, e: [], t: 11 });
});

test('a timer that comes late does not let a chunk grow: the next frame sends it', async () => {
  const run = await begun();
  run.clock(5);
  await pass(FIRST_FEED_MS);
  assert.equal(feeds().length, 1);
  // the page's frames carry on while its timer is held up
  wall += FEED_MS + 1_000;
  run.clock(6);
  await settle();
  assert.equal(feeds().length, 1, 'not yet: the timer may still come');
  wall += 1_001;
  run.clock(7);
  await settle();
  assert.deepEqual(feeds()[1], { run: 'run-1', n: 1, e: [], t: 7 });
  // and the timer that was late, when it comes, finds nothing new to send
  mock.timers.tick(FEED_MS);
  await settle();
  assert.equal(feeds().length, 2);
});

test('a run with a thousand moves sends them early', async () => {
  const run = await begun();
  for (let i = 0; i < 1_000; i++) run.record(i);
  run.clock(1_000);
  await settle();
  assert.equal(feeds().length, 1);
  assert.equal(feeds()[0].e.length, 1_000);
  assert.equal(feeds()[0].t, 0, 'the clock as it stood when the thousandth move came');
});

test('a refused chunk ends the ranking: nothing more is sent, and the score is not tied to the run', async () => {
  const run = await begun();
  status = (path) => (path === '/runs/feed' ? 403 : 200);
  run.record(1);
  run.clock(4);
  await pass(FIRST_FEED_MS);
  assert.equal(feeds().length, 1);
  assert.equal(run.id, undefined);
  run.record(2);
  run.clock(8);
  await pass(FEED_MS * 2);
  assert.equal(feeds().length, 1);
  assert.equal(run.end(3), undefined);
  await settle();
  assert.equal(sent.filter((s) => s.path === '/runs/finish').length, 0);
});

test('a dropped connection is tried again, a few times', async () => {
  const run = await begun();
  let fails = 2;
  status = (path) => (path === '/runs/feed' && fails-- > 0 ? 503 : 200);
  run.record(1);
  run.clock(4);
  await pass(FIRST_FEED_MS);
  await pass(400);
  await pass(800);
  assert.equal(feeds().length, 3, 'two failures, then through');
  assert.equal(run.id, 'run-1');
});

test('no ticket (offline, or a Worker that does not check the game): the run never begins', async () => {
  status = (path) => (path === '/runs' ? 404 : 200);
  const run = new RankedRun('flappy', 'http://arcade.test');
  await settle();
  assert.equal(run.pending, false);
  assert.equal(run.seed, null);
  assert.equal(run.begin({}), false);
  run.record(1);
  assert.equal(run.end(5), undefined);
  await pass(FEED_MS);
  assert.deepEqual(sent.map((s) => s.path), ['/runs']);
});

test('a run left mid-game stops sending', async () => {
  const run = await begun();
  run.clock(3);
  await pass(FIRST_FEED_MS);
  run.stop();
  run.clock(9);
  wall += FEED_MS * 3;
  run.clock(10);
  await pass(FEED_MS * 3);
  assert.equal(feeds().length, 1);
});

test('ready() says whether the ticket came', async () => {
  const run = new RankedRun('flappy', 'http://arcade.test');
  assert.equal(await run.ready(), true);
  status = (path) => (path === '/runs' ? 503 : 200);
  assert.equal(await new RankedRun('flappy', 'http://arcade.test').ready(), false);
  assert.equal(await new RankedRun('flappy', '').ready(), false, 'no Worker to ask');
});

test("verified() is the score the Worker found (a daily board's streak), or null when it turned the run down", async () => {
  const run = await begun();
  finishScore = 12;
  run.record(1);
  run.clock(2);
  assert.equal(run.end(1), 'run-1');
  assert.equal(await run.verified(), 12);

  sent = [];
  const refused = await begun();
  status = (path) => (path === '/runs/finish' ? 403 : 200);
  refused.clock(3);
  refused.end(1);
  assert.equal(await refused.verified(), null);
  assert.equal(await new RankedRun('flappy', 'http://arcade.test').verified(), null, 'not ended');
});

test("a daily board's run goes with this device's key, the same key every time", async () => {
  const keys: unknown[] = [];
  for (let i = 0; i < 2; i++) {
    const run = new RankedRun('wordguess', 'http://arcade.test');
    await run.ready();
    assert.equal(run.begin({ day: 1, rows: [] }, { daily: true }), true);
    await settle();
    keys.push(sent.filter((s) => s.path === '/runs/start').at(-1)!.body.device);
  }
  assert.ok(isDeviceKey(keys[0]), String(keys[0]));
  assert.equal(keys[1], keys[0]);
  // and other games' runs go without it
  sent = [];
  const plain = await begun();
  plain.stop();
  assert.equal(sent.filter((s) => s.path === '/runs/start').at(-1)!.body.device, undefined);
});
