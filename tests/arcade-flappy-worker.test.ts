import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { FlappyRuns } from '../worker/src/flappy.ts';
import { autopilot, STEP } from '../src/os/arcade/games/flappy/logic.ts';
import { createReplay, tickReplay, RUN_TTL_MS, type RunTicket } from '../src/os/arcade/games/flappy/replay.ts';

// Durable Object SQL executes eagerly; Node's SQL adapter must do the same.
function eagerStorage() {
  const db = new DatabaseSync(':memory:');
  return { exec(query: string, ...bindings: any[]) {
    const rows = db.prepare(query).all(...bindings);
    return { toArray: () => rows };
  } };
}
const request = (path: string, body?: unknown, ip = '127.0.0.1') => new Request(`http://local${path}`, {
  method: 'POST', headers: { 'CF-Connecting-IP': ip }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const setup = () => {
  const sql = eagerStorage();
  return { sql, routes: new FlappyRuns(sql as any) };
};
function flight(ticket: RunTicket) {
  const run = createReplay(ticket.seed);
  while (!run.world.dead && run.tick < 10_000) tickReplay(run, run.tick === 0 || (run.world.score < 3 && autopilot(run.world)));
  assert.ok(run.world.dead && run.world.score > 0);
  return { body: { name: 'Player', score: run.world.score, proof: { ...ticket, ticks: run.tick, flaps: run.flaps } }, duration: run.tick * STEP * 1000 };
}
const NOW = 1_800_000_000_000;

test('read-only status exposes the verification version without issuing tickets', async () => {
  const { sql, routes } = setup();
  for (let i = 0; i < 35; i++) {
    const response = await routes.fetch(new Request('http://local/flappy/status'));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { version: 1, ranking: 'verified-replay' });
  }
  assert.equal(sql.exec('SELECT COUNT(*) AS n FROM flappy_runs_v1').toArray()[0].n, 0);
  assert.equal(sql.exec('SELECT COUNT(*) AS n FROM flappy_limits').toArray()[0].n, 0);
});

test('a token expiring while the body streams cannot write a score', async () => {
  const sql = eagerStorage();
  let now = NOW;
  const routes = new FlappyRuns(sql as any, () => now);
  const ticket = await (await routes.fetch(request('/flappy/run'))).json();
  const { body, duration } = flight(ticket);
  now += duration + 1000;
  const streamed = new Request('http://local/flappy/submit', {
    method: 'POST', headers: { 'CF-Connecting-IP': '127.0.0.1' },
    body: new ReadableStream({
      pull(controller) {
        now = NOW + RUN_TTL_MS + 1;
        controller.enqueue(new TextEncoder().encode(JSON.stringify(body)));
        controller.close();
      },
    }, { highWaterMark: 0 }), duplex: 'half',
  } as any);
  const response = await routes.fetch(streamed);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'invalid run token' });
  assert.deepEqual(routes.entries(), []);
});

test('worker accepts a real replay, computes the score, and durably rejects reused tokens', async () => {
  const { sql, routes } = setup();
  const ticket = await (await routes.fetch(request('/flappy/run'), NOW)).json();
  const { body, duration } = flight(ticket);
  const response = await routes.fetch(request('/flappy/submit', body), NOW + duration + 1000);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).entries[0].score, body.score);
  const restarted = new FlappyRuns(sql as any);
  assert.equal((await restarted.fetch(request('/flappy/submit', body), NOW + duration + 2000)).status, 409);
  assert.equal(restarted.entries().length, 1);
});

test('forged score, signature, seed, inputs, expired token and wrong IP never write a score', async () => {
  for (const attack of ['missing', 'score', 'signature', 'seed', 'inputs', 'expiry', 'ip', 'speed']) {
    const { routes } = setup();
    const ticket = await (await routes.fetch(request('/flappy/run'), NOW)).json();
    const { body, duration } = flight(ticket);
    if (attack === 'missing') delete (body as any).proof;
    if (attack === 'score') body.score += 100;
    if (attack === 'signature') body.proof.token = `x${body.proof.token}`;
    if (attack === 'seed') body.proof.seed ^= 1;
    if (attack === 'inputs') body.proof.flaps = [0, 1];
    const now = attack === 'expiry' ? NOW + RUN_TTL_MS + 1 : attack === 'speed' ? NOW : NOW + duration + 1000;
    assert.equal((await routes.fetch(request('/flappy/submit', body, attack === 'ip' ? 'other' : undefined), now)).status, 400, attack);
    assert.deepEqual(routes.entries(), [], attack);
    if (['score', 'seed', 'inputs', 'speed'].includes(attack)) {
      assert.equal((await routes.fetch(request('/flappy/submit', body), now)).status, 409, 'invalid replay consumes its valid token');
    }
  }
});

test('concurrent use of one ticket writes at most once', async () => {
  const { routes } = setup();
  const ticket = await (await routes.fetch(request('/flappy/run'), NOW)).json();
  const { body, duration } = flight(ticket);
  const results = await Promise.all([1, 2].map(() => routes.fetch(request('/flappy/submit', body), NOW + duration + 1000)));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(routes.entries().length, 1);
});

test('IP start/submit limits survive object restart and expire', async () => {
  const { sql, routes } = setup();
  for (let i = 0; i < 30; i++) assert.equal((await routes.fetch(request('/flappy/run'), NOW)).status, 200);
  const restarted = new FlappyRuns(sql as any);
  assert.equal((await restarted.fetch(request('/flappy/run'), NOW)).status, 429);
  for (let i = 0; i < 12; i++) assert.equal((await restarted.fetch(request('/flappy/submit', {}), NOW)).status, 400);
  assert.equal((await restarted.fetch(request('/flappy/submit', {}), NOW)).status, 429);
  assert.equal((await restarted.fetch(request('/flappy/run', undefined, 'different'), NOW)).status, 200);
  assert.equal((await restarted.fetch(request('/flappy/run'), NOW + 120_000)).status, 200);
});

test('oversized chunked bodies are bounded and legacy rows are not verified scores', async () => {
  const { sql, routes } = setup();
  sql.exec('CREATE TABLE scores (game TEXT, name TEXT, score INTEGER, date TEXT)');
  sql.exec("INSERT INTO scores VALUES ('flappy', 'Fake', 9999, '2026-01-01')");
  assert.deepEqual(routes.entries(), []);
  const large = new Request('http://local/flappy/submit', { method: 'POST', body: new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(64_001)); controller.close(); },
  }), duplex: 'half' } as any);
  assert.equal((await routes.fetch(large, NOW)).status, 400);
  assert.equal((await routes.fetch(new Request('http://local/flappy/run'), NOW)).status, 404);
});
