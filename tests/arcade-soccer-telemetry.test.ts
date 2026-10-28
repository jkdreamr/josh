import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CLIENT_EVENTS_PER_MINUTE,
  EventBudget,
  FrameStats,
  Latency,
  MAX_BODY_BYTES,
  MAX_EVENTS_PER_BATCH,
  MAX_MESSAGE,
  MAX_STACK,
  SeqLoss,
  SlidingLimiter,
  TelemetryQueue,
  deviceClass,
  parseBatch,
  percentile,
  scrub,
  summarizeTelemetry,
  topFrame,
  type PerfStat,
  type TelemetryBatch,
} from '../src/os/arcade/games/soccer/telemetry-core.ts';
import { parsePacket } from '../src/os/arcade/games/soccer/net.ts';

const errorEvent = (overrides: Record<string, unknown> = {}) => ({
  k: 'err',
  t: 10,
  src: 'error',
  msg: 'broken',
  stack: 'Error: broken\n    at play (https://site.test/_astro/a.js:1:234)',
  ph: 'live',
  n: 1,
  ...overrides,
});

const perfEvent = (overrides: Record<string, unknown> = {}) => ({
  k: 'perf',
  t: 30_000,
  ph: 'live',
  win: 30,
  frames: 1800,
  fps50: 60,
  fps5: 50,
  longMs: 34,
  tier: 2,
  dpr: 1.5,
  in50: 80,
  in95: 120,
  inN: 30,
  loss: 0.02,
  rx: 100,
  tr: 'direct',
  drops: 0,
  reconnects: 0,
  ...overrides,
});

const batch = (events: unknown[] = [errorEvent()], overrides: Record<string, unknown> = {}) => ({
  v: 1,
  c: 'abcdefgh1234',
  role: 'display',
  dev: 'desktop',
  ua: 'Macintosh',
  b: 'abcdef012345',
  ev: events,
  ...overrides,
});

function parse(value: unknown): ReturnType<typeof parseBatch> {
  return parseBatch(JSON.stringify(value));
}

test('valid batches round-trip while unknown keys are dropped', () => {
  const input = batch([errorEvent({ extra: true })], { ignored: 'value' });
  const parsed = parse(input);
  assert.ok('value' in parsed);
  assert.deepEqual(parsed.value, {
    v: 1,
    c: 'abcdefgh1234',
    role: 'display',
    dev: 'desktop',
    ua: 'Macintosh',
    b: 'abcdef012345',
    ev: [{
      k: 'err', t: 10, src: 'error', msg: 'broken',
      stack: 'Error: broken\n    at play (https://site.test/_astro/a.js:1:234)',
      ph: 'live', n: 1,
    }],
  });
});

test('rejects bodies over the byte limit and invalid JSON', () => {
  assert.deepEqual(parseBatch(' '.repeat(MAX_BODY_BYTES + 1)), { error: 'too large' });
  assert.deepEqual(parseBatch('{'), { error: 'invalid json' });
  assert.deepEqual(parseBatch('[]'), { error: 'invalid body' });
});

test('validates envelope version, client id, role and device class', () => {
  for (const [field, value, expected] of [
    ['v', 2, 'v'], ['c', 'UPPERCASE12', 'c'], ['role', 'phone', 'role'], ['dev', 'laptop', 'dev'],
  ] as const) {
    assert.deepEqual(parse(batch([errorEvent()], { [field]: value })), { error: expected });
  }
});

test('requires between one and twenty events per batch', () => {
  assert.deepEqual(parse(batch([])), { error: 'ev' });
  assert.deepEqual(parse(batch(Array.from({ length: MAX_EVENTS_PER_BATCH + 1 }, () => errorEvent()))), { error: 'ev' });
});

test('rejects oversized error messages and stacks', () => {
  assert.deepEqual(parse(batch([errorEvent({ msg: 'x'.repeat(MAX_MESSAGE + 1) })])), { error: 'ev[0].msg' });
  assert.deepEqual(parse(batch([errorEvent({ stack: 'x'.repeat(MAX_STACK + 1) })])), { error: 'ev[0].stack' });
});

test('rejects perf fields outside their type or range', () => {
  assert.deepEqual(parse(batch([perfEvent({ loss: 1.5 })])), { error: 'ev[0].loss' });
  assert.deepEqual(parse(batch([perfEvent({ fps50: 'NaN' })])), { error: 'ev[0].fps50' });
  assert.deepEqual(parse(batch([perfEvent({ tier: 9 })])), { error: 'ev[0].tier' });
});

test('scrubs URL query strings and fragments and emails', () => {
  assert.equal(scrub('at https://site.test/a.js?room=ABCD#x and person@example.com'), 'at https://site.test/a.js and [email]');
});

test('normalizes top stack frames for V8 and Safari and skips message-only stacks', () => {
  assert.equal(topFrame('TypeError: broken\n    at play (https://site.test/_astro/a.js?x=1:1:234)'), 'play (/_astro/a.js:1:234)');
  assert.equal(topFrame('TypeError: broken\nplay@https://site.test/_astro/a.js?x=1:1:234'), 'play@/_astro/a.js:1:234');
  assert.equal(topFrame('TypeError: broken'), '');
});

test('classifies common phone, tablet and desktop user agents', () => {
  assert.equal(deviceClass('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', 0), 'phone');
  assert.equal(deviceClass('Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/605.1.15', 5), 'tablet');
  assert.equal(deviceClass('Mozilla/5.0 (Linux; Android 14; Pixel) Mobile', 5), 'phone');
  assert.equal(deviceClass('Mozilla/5.0 (Linux; Android 14; Tablet)', 5), 'tablet');
  assert.equal(deviceClass('Mozilla/5.0 (Macintosh; Intel Mac OS X)', 0), 'desktop');
});

test('event budget accepts twenty events per minute and expires the oldest timestamp', () => {
  const budget = new EventBudget();
  for (let i = 0; i < CLIENT_EVENTS_PER_MINUTE; i++) assert.equal(budget.take(i), true);
  assert.equal(budget.take(100), false);
  assert.equal(budget.take(60_000), true);
});

test('queue deduplicates errors without spending budget and accounts for rejected events', () => {
  const queue = new TelemetryQueue(new EventBudget(1));
  queue.addError({ k: 'err', t: 0, src: 'error', msg: 'same', stack: '    at play (https://one.test/a.js:1:2)', ph: 'live' }, 0);
  queue.addError({ k: 'err', t: 1, src: 'error', msg: 'same', stack: '    at play (https://two.test/a.js:1:2)', ph: 'restart' }, 1);
  queue.addError({ k: 'err', t: 2, src: 'error', msg: 'other', stack: '', ph: 'live' }, 2);
  assert.equal(queue.pending(), 1);
  assert.deepEqual(queue.drain(), {
    events: [{ k: 'err', t: 0, src: 'error', msg: 'same', stack: '    at play (https://one.test/a.js:1:2)', ph: 'live', n: 2 }],
    dropped: 1,
  });
});

test('queue drains batches of twenty while retaining pending events', () => {
  const queue = new TelemetryQueue(new EventBudget(30));
  for (let i = 0; i < 21; i++) queue.addPerf(perfEvent({ t: i }) as PerfStat, i);
  const drained = queue.drain();
  assert.equal(drained.events.length, MAX_EVENTS_PER_BATCH);
  assert.equal(drained.dropped, 0);
  assert.equal(queue.pending(), 1);
  assert.equal(queue.drain().events.length, 1);
});

test('queue caps pending events at forty and counts overflow as dropped', () => {
  const queue = new TelemetryQueue(new EventBudget(50));
  for (let i = 0; i < 41; i++) queue.addPerf(perfEvent({ t: i }) as PerfStat, i);
  assert.equal(queue.pending(), 40);
  assert.equal(queue.drain().dropped, 1);
});

test('sliding server limiter accounts for cost, expiry and independent keys', () => {
  const limiter = new SlidingLimiter(5, 1000);
  assert.equal(limiter.take('a', 3, 0), true);
  assert.equal(limiter.take('a', 3, 1), false);
  assert.equal(limiter.take('a', 2, 2), true);
  assert.equal(limiter.take('b', 5, 2), true);
  assert.equal(limiter.take('a', 1, 1000), true);
});

test('frame stats ignore long stalls and summarize frame rate and longest frame', () => {
  const stats = new FrameStats();
  for (const ms of [10, 20, 40, 2500]) stats.frame(ms);
  assert.deepEqual(stats.summary(), { fps50: 50, fps5: 25, longMs: 40, frames: 3 });
  assert.deepEqual(new FrameStats().summary(), { fps50: 0, fps5: 0, longMs: 0, frames: 0 });
  const capped = new FrameStats();
  for (let index = 0; index < 4001; index++) capped.frame(16);
  assert.equal(capped.summary().frames, 4000);
  assert.equal(percentile([], 0.5), 0);
});

test('sequence loss counts gaps without counting duplicates', () => {
  const loss = new SeqLoss();
  loss.see(3);
  loss.see(5);
  loss.see(5);
  assert.deepEqual(loss.summary(), { rx: 2, loss: 1 / 3 });
  loss.reset();
  assert.deepEqual(loss.summary(), { rx: 0, loss: undefined });
});

test('latency matches acknowledged input sequence numbers', () => {
  const latency = new Latency();
  latency.sent(1, 100);
  latency.sent(2, 120);
  latency.ack(99, 130);
  latency.ack(1, 140);
  latency.ack(2, 150);
  assert.deepEqual(latency.summary(), { in50: 30, in95: 30, inN: 2 });
});

test('latency retains only 128 pending sends and reset preserves ack state', () => {
  const latency = new Latency();
  assert.deepEqual(latency.summary(), {});
  for (let seq = 0; seq <= 128; seq++) latency.sent(seq, seq);
  latency.ack(0, 200);
  assert.deepEqual(latency.summary(), {});
  latency.ack(128, 256);
  assert.deepEqual(latency.summary(), { in50: 128, in95: 128, inN: 1 });
  latency.reset();
  latency.ack(128, 300);
  assert.deepEqual(latency.summary(), {});
});

test('summary deduplicates errors by message and frame and aggregates perf percentiles', () => {
  const from = Date.UTC(2026, 0, 1);
  const errors = [
    { at: from + 1000, client: 'client001', role: 'display', device: 'desktop', build: 'new', ua: 'mac', phase: 'live', src: 'error', msg: 'broken', frame: '/a.js:1:2', stack: 'stack1', n: 2 },
    { at: from + 2000, client: 'client002', role: 'controller', device: 'phone', build: 'old', ua: 'phone', phase: 'restart', src: 'rejection', msg: 'broken', frame: '/a.js:1:2', stack: 'stack2', n: 1 },
  ];
  const perf = [
    { at: from + 1000, client: 'client001', role: 'display', device: 'desktop', build: 'new', phase: 'live', frames: 100, fps50: 60, fps5: 40, long_ms: 40, tier: 2, dpr: 2, in50: null, in95: null, loss: 0.1, drops: 1, reconnects: 0, tr: 'relay' },
    { at: from + 2000, client: 'client003', role: 'display', device: 'desktop', build: 'new', phase: 'live', frames: 100, fps50: 30, fps5: 20, long_ms: 80, tier: 1, dpr: 1, in50: null, in95: null, loss: 0.2, drops: 0, reconnects: 1, tr: 'direct' },
  ];
  const summary = summarizeTelemetry(errors, perf, { from, to: from + 3600_000, hours: 1 });
  assert.deepEqual(summary.totals, { errors: 3, errorEvents: 2, perf: 2, clients: 3 });
  assert.equal(summary.errors.length, 1);
  assert.deepEqual(summary.errors[0], {
    message: 'broken', frame: '/a.js:1:2', count: 3, events: 2, clients: 2,
    first: new Date(from + 1000).toISOString(), last: new Date(from + 2000).toISOString(),
    roles: { display: 2, controller: 1 }, devices: { desktop: 2, phone: 1 }, phases: { live: 2, restart: 1 },
    builds: ['old', 'new'], sample: { stack: 'stack2', ua: 'phone', src: 'rejection' },
  });
  assert.deepEqual(summary.perf[0]?.fps50, { n: 2, p5: 30, p50: 30, p95: 30, max: 60 });
  assert.equal(summary.perf[0]?.longMs?.p95, 40);
});

test('snapshot parser accepts valid ack arrays and omits invalid arrays', () => {
  const state = {
    players: Array.from({ length: 22 }, (_, id) => ({
      id, team: id < 11 ? 0 : 1, slot: 'GK', x: 0, z: 0, vx: 0, vz: 0, facing: 0,
      stamina: 1, human: false, controlled: false, cooldown: 0, action: '',
    })),
    ball: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, grounded: true, inNet: false },
    score: [0, 0], clock: 0, halfLength: 120, half: 1, endsSwapped: false, phase: 'live',
    restart: null, restartTeam: 0, restartAt: { x: 0, z: 0 }, lastTouch: 0, seed: 1, event: '', eventTime: 0,
    restartClock: 0, controlled: [0, 11], kickEvent: null, passTarget: null, passControl: false,
  };
  const valid = parsePacket({ t: 'soccer', k: 's', r: 1, seq: 3, state, ack: [-1, 0, 3, 8] });
  assert.deepEqual(valid && 'ack' in valid ? valid.ack : undefined, [-1, 0, 3, 8]);
  const invalid = parsePacket({ t: 'soccer', k: 's', r: 1, seq: 3, state, ack: [0, -2] });
  assert.ok(invalid);
  assert.equal('ack' in invalid, false);
});
