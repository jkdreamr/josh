import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { autopilot, STEP } from '../src/os/arcade/games/flappy/logic.ts';
import { createReplay, tickReplay, MAX_RUN_TICKS, RUN_VERSION } from '../src/os/arcade/games/flappy/replay.ts';

const args = process.argv.slice(2);
const readOnly = args.includes('--read-only');
const index = args.indexOf('--api');
assert.ok(index < 0 || args[index + 1], '--api requires a URL');
const api = new URL(index < 0 ? 'http://127.0.0.1:8787' : args[index + 1]);
assert.ok(['http:', 'https:'].includes(api.protocol) && !api.username && !api.password, 'Use an HTTP API URL without credentials');
const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(api.hostname);
assert.ok(readOnly || loopback, 'Write tests are local-only. Use --read-only for production.');

async function call(path, body) {
  const response = await fetch(new URL(path, api), {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    redirect: 'error', signal: AbortSignal.timeout(30_000),
  });
  return { status: response.status, body: await response.json() };
}

const status = await call('/flappy/status');
assert.equal(status.status, 200, 'Verification status is missing: deploy the patched Worker first');
assert.deepEqual(status.body, { version: RUN_VERSION, ranking: 'verified-replay' });
const board = await call('/leaderboard?game=flappy');
assert.equal(board.status, 200);
assert.ok(Array.isArray(board.body.entries));
const tops = await call('/leaderboard/top?n=3');
assert.equal(tops.status, 200);
assert.deepEqual(tops.body.boards.flappy, board.body.entries.slice(0, 3));
assert.deepEqual(tops.body.wins.flappy, []);
console.log('PASS: verified-ranking version and both leaderboard reads');
if (readOnly) {
  console.log('Read-only check complete. No tickets, submissions or forged data sent.');
} else {
  const name = `ReleaseQA${Date.now() % 1_000_000}`;
  for (const path of ['/leaderboard', '/flappy/submit']) {
    const forged = await call(path, { game: 'flappy', name, score: 508 });
    assert.equal(forged.status, 400, `${path} must reject a fabricated 508`);
  }
  assert.deepEqual((await call('/leaderboard?game=flappy')).body.entries, board.body.entries);
  console.log('PASS: fabricated 508 rejected through both routes; board unchanged');

  const ticket = await call('/flappy/run', {});
  assert.equal(ticket.status, 200);
  const received = performance.now();
  const run = createReplay(ticket.body.seed);
  while (!run.world.dead && run.tick < MAX_RUN_TICKS) {
    tickReplay(run, run.tick === 0 || (run.world.score < 3 && autopilot(run.world)));
  }
  assert.ok(run.world.dead && run.world.score > 0);
  const submission = {
    name, score: run.world.score,
    proof: { ...ticket.body, ticks: run.tick, flaps: run.flaps },
  };
  await delay(Math.max(0, run.tick * STEP * 1000 + 100 - (performance.now() - received)));
  const accepted = await call('/flappy/submit', submission);
  assert.equal(accepted.status, 200, 'A legal local replay must be accepted');
  assert.ok(accepted.body.entries.some((entry) => entry.name === name && entry.score === run.world.score));
  assert.equal((await call('/flappy/submit', submission)).status, 409, 'A consumed ticket must not work twice');
  console.log('PASS: legal local replay accepted; captured submission rejected on reuse');
}
