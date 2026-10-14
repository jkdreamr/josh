import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import {
  addMessages,
  cleanLine,
  FRAME_MAX,
  HISTORY,
  IP_RATE,
  isRepeat,
  lineHash,
  loungeUrl,
  rateCheck,
  readEvent,
  readSay,
  REPEAT_MS,
  retryDelay,
  sameSecret,
  SOCKET_RATE,
  TEXT_MAX,
  validLine,
  type LoungeMessage,
} from '../src/os/arcade/lounge-core.ts';
import { LoungeLink, type LoungeReject } from '../src/os/arcade/lounge.ts';

const msg = (id: number, text = `message ${id}`, name = 'Mina', t = 1_000 + id): LoungeMessage => ({ id, name, text, t });
const say = (body: Record<string, unknown>) => JSON.stringify({ t: 'say', ...body });

test('cleanLine strips control, zero width and bidi characters and squeezes whitespace', () => {
  assert.equal(cleanLine('  anyone\tup for\n\nchess?  '), 'anyone up for chess?');
  assert.equal(cleanLine('hi\u0000\u0007 there\u200b\u202e!'), 'hi there!');
  assert.equal(cleanLine('room\u3164 \u2800ABCD\u00ad'), 'room ABCD');
  assert.equal(cleanLine('gg 👍🏽 🇰🇷'), 'gg 👍🏽 🇰🇷');
  assert.equal(cleanLine('정말 재밌다'), '정말 재밌다');
  assert.equal(cleanLine('\u3164 \u2800 '), '');
});

test('cleanLine keeps accents but cuts stacked combining marks to three', () => {
  assert.equal(cleanLine('cafe\u0301 tie\u0302\u0301'), 'cafe\u0301 tie\u0302\u0301');
  assert.equal(cleanLine(`z${'\u0336\u0337\u0338'.repeat(20)}alg`), 'z\u0336\u0337\u0338alg');
});

test('validLine counts characters, not UTF-16 units', () => {
  assert.ok(validLine('a', 16));
  assert.ok(validLine('🏆'.repeat(16), 16));
  assert.ok(!validLine('🏆'.repeat(17), 16));
  assert.ok(!validLine(' \u0007 ', 16));
  assert.ok(validLine('x'.repeat(TEXT_MAX), TEXT_MAX));
  assert.ok(!validLine('x'.repeat(TEXT_MAX + 1), TEXT_MAX));
});

test('readSay cleans a good message and keeps its tag', () => {
  assert.deepEqual(readSay(say({ name: '  Jo\u0000sh ', text: 'room ABCD\n for chess', c: 'k1' })), { name: 'Josh', text: 'room ABCD for chess', c: 'k1' });
  assert.deepEqual(readSay(say({ name: 'Josh', text: 'hi' })), { name: 'Josh', text: 'hi' });
  assert.deepEqual(readSay(say({ name: 'Josh', text: 'hi', c: 'not a tag!' })), { name: 'Josh', text: 'hi' });
  assert.deepEqual(readSay(say({ name: 'Josh', text: 'x'.repeat(TEXT_MAX) })), { name: 'Josh', text: 'x'.repeat(TEXT_MAX) });
});

test('readSay turns down bad names and text', () => {
  for (const name of ['', '   ', '\u200b\u0007', 'x'.repeat(17), 42, null, undefined]) {
    assert.deepEqual(readSay(say({ name, text: 'hi', c: 'a' })), { error: 'name', c: 'a' }, String(name));
  }
  for (const text of ['', '  \n ', '\u0000', 'y'.repeat(TEXT_MAX + 1), ['hi'], 7]) {
    assert.deepEqual(readSay(say({ name: 'Josh', text, c: 'b' })), { error: 'text', c: 'b' }, String(text));
  }
  assert.deepEqual(readSay(say({ name: 'Josh', text: '' })), { error: 'text' });
});

test('readSay ignores anything that is not a say', () => {
  for (const raw of ['ping', '{', '[]', 'null', '"say"', JSON.stringify({ t: 'msg', name: 'a', text: 'b' }), 42, null, new ArrayBuffer(4)]) {
    assert.equal(readSay(raw), null, String(raw));
  }
  assert.equal(readSay(say({ name: 'Josh', text: 'z'.repeat(FRAME_MAX) })), null);
});

test('one connection sends at most five messages in ten seconds', () => {
  let times: number[] = [];
  for (let i = 0; i < 5; i++) {
    const next = rateCheck(times, 1000 + i * 100, SOCKET_RATE);
    assert.ok(next);
    times = next;
  }
  assert.equal(rateCheck(times, 1500, SOCKET_RATE), null);
  assert.equal(rateCheck(times, 10_999, SOCKET_RATE), null);
  const later = rateCheck(times, 11_000, SOCKET_RATE);
  assert.deepEqual(later, [1100, 1200, 1300, 1400, 11_000]);
});

test('one IP gets ten messages in ten seconds and thirty a minute across its connections', () => {
  let times: number[] = [];
  let sent = 0;
  for (let t = 0; t < 60_000; t += 250) {
    const next = rateCheck(times, t, IP_RATE);
    if (!next) continue;
    times = next;
    sent++;
  }
  assert.equal(sent, 30);
  assert.equal(rateCheck(times, 59_999, IP_RATE), null);
  let burst: number[] = [];
  for (let i = 0; i < 12; i++) burst = rateCheck(burst, 100 + i, IP_RATE) ?? burst;
  assert.equal(burst.length, 10);
  // Only times still inside the longest window are kept.
  assert.deepEqual(rateCheck([1_000, 30_000, 59_000], 61_000, IP_RATE), [30_000, 59_000, 61_000]);
});

test('repeats are the same line from the same connection within a minute', () => {
  const last = { hash: lineHash('gg'), at: 5000 };
  assert.ok(isRepeat(last, 'gg', 5000 + REPEAT_MS - 1));
  assert.ok(!isRepeat(last, 'gg', 5000 + REPEAT_MS));
  assert.ok(!isRepeat(last, 'gg!', 6000));
  assert.ok(!isRepeat(undefined, 'gg', 6000));
  assert.equal(lineHash('gg'), lineHash('gg'));
  assert.notEqual(lineHash('room ABCD'), lineHash('room ABCE'));
  assert.ok(Number.isInteger(lineHash('🏆')) && lineHash('🏆') >= 0);
});

test('addMessages orders by id, drops duplicates and keeps the newest', () => {
  assert.deepEqual(addMessages([msg(2), msg(1)], [msg(3), msg(2, 'edited')]).map((m) => [m.id, m.text]), [[1, 'message 1'], [2, 'edited'], [3, 'message 3']]);
  const many = Array.from({ length: HISTORY + 20 }, (_, i) => msg(i + 1));
  const kept = addMessages([], many);
  assert.equal(kept.length, HISTORY);
  assert.equal(kept[0].id, 21);
  assert.equal(kept.at(-1)!.id, HISTORY + 20);
  assert.deepEqual(addMessages(kept, [msg(500)], 3).map((m) => m.id), [HISTORY + 19, HISTORY + 20, 500]);
});

test('readEvent reads what the Worker sends and nothing else', () => {
  assert.deepEqual(readEvent(JSON.stringify({ t: 'welcome', messages: [msg(1), { id: 2 }, msg(3)], online: 2 })), { t: 'welcome', messages: [msg(1), msg(3)], online: 2 });
  assert.deepEqual(readEvent(JSON.stringify({ t: 'msg', m: msg(4), c: 'k9' })), { t: 'msg', m: msg(4), c: 'k9' });
  assert.deepEqual(readEvent(JSON.stringify({ t: 'msg', m: msg(4) })), { t: 'msg', m: msg(4) });
  assert.deepEqual(readEvent(JSON.stringify({ t: 'online', n: 7 })), { t: 'online', n: 7 });
  assert.deepEqual(readEvent(JSON.stringify({ t: 'cleared' })), { t: 'cleared' });
  assert.deepEqual(readEvent(JSON.stringify({ t: 'error', error: 'slow', c: 'k2' })), { t: 'error', error: 'slow', c: 'k2' });
  for (const raw of [
    'pong',
    '{',
    JSON.stringify({ t: 'welcome', messages: 'none', online: 1 }),
    JSON.stringify({ t: 'welcome', messages: [], online: -1 }),
    JSON.stringify({ t: 'msg', m: { ...msg(1), id: 0 } }),
    JSON.stringify({ t: 'msg', m: { ...msg(1), name: '' } }),
    JSON.stringify({ t: 'msg', m: { ...msg(1), text: 'x'.repeat(TEXT_MAX + 1) } }),
    JSON.stringify({ t: 'online', n: 1.5 }),
    JSON.stringify({ t: 'error', error: 'boom' }),
    JSON.stringify({ t: 'start' }),
    null,
  ]) {
    assert.equal(readEvent(raw), null, String(raw));
  }
});

test('loungeUrl swaps http for ws and keeps a base path', () => {
  assert.equal(loungeUrl('https://josh-arcade.example.workers.dev').href, 'wss://josh-arcade.example.workers.dev/lounge');
  assert.equal(loungeUrl('http://127.0.0.1:8787/').href, 'ws://127.0.0.1:8787/lounge');
  assert.equal(loungeUrl('https://example.com/api/?x=1').href, 'wss://example.com/api/lounge');
});

test('retryDelay doubles from a second up to thirty, give or take a quarter', () => {
  assert.equal(retryDelay(0, 0.5), 1000);
  assert.equal(retryDelay(1, 0.5), 1000);
  assert.equal(retryDelay(2, 0.5), 2000);
  assert.equal(retryDelay(4, 0.5), 8000);
  assert.equal(retryDelay(9, 0.5), 30_000);
  assert.equal(retryDelay(3, 0), 3000);
  assert.equal(retryDelay(3, 1), 5000);
});

test('sameSecret matches only the configured secret', async () => {
  assert.equal(await sameSecret('s3cret-token', 's3cret-token'), true);
  assert.equal(await sameSecret('s3cret-tokem', 's3cret-token'), false);
  assert.equal(await sameSecret('', 's3cret-token'), false);
  assert.equal(await sameSecret('', ''), false);
  assert.equal(await sameSecret('anything', undefined), false);
});

class FakeWebSocket {
  static OPEN = 1;
  static all: FakeWebSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  closed = false;
  listeners = new Map<string, Set<(event: unknown) => void>>();
  readonly url: URL;
  constructor(url: URL) {
    this.url = url;
    FakeWebSocket.all.push(this);
  }
  addEventListener(type: string, listener: (event: unknown) => void) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }
  send(message: string) {
    this.sent.push(message);
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  emit(type: string, event: unknown = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.emit('open');
  }
  receive(data: unknown) {
    this.emit('message', { data: typeof data === 'string' ? data : JSON.stringify(data) });
  }
  drop() {
    this.readyState = 3;
    this.emit('close');
  }
}

function withFakes(run: () => void) {
  const original = globalThis.WebSocket;
  FakeWebSocket.all = [];
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_000_000 });
  try {
    run();
  } finally {
    mock.timers.reset();
    globalThis.WebSocket = original;
  }
}

test('LoungeLink joins, posts, and hands back what the Worker turns down', () => {
  withFakes(() => {
    const link = new LoungeLink('https://arcade.test');
    const rejects: LoungeReject[] = [];
    const statuses: string[] = [];
    link.onChange((state) => statuses.push(state.status));
    link.onReject((reject) => rejects.push(reject));
    const socket = FakeWebSocket.all[0];
    assert.equal(socket.url.href, 'wss://arcade.test/lounge');
    assert.equal(link.state.status, 'connecting');
    assert.equal(link.say('Mina', 'too early'), false);

    socket.open();
    socket.receive({ t: 'welcome', messages: [msg(1), msg(2)], online: 3 });
    assert.equal(link.state.status, 'live');
    assert.equal(link.state.online, 3);
    assert.deepEqual(link.state.messages.map((m) => m.id), [1, 2]);

    assert.equal(link.say('Mina', 'anyone up for chess?'), true);
    const sent = JSON.parse(socket.sent.at(-1)!);
    assert.deepEqual({ ...sent, c: undefined }, { t: 'say', name: 'Mina', text: 'anyone up for chess?', c: undefined });
    socket.receive({ t: 'msg', m: msg(3, 'anyone up for chess?'), c: sent.c });
    socket.receive({ t: 'msg', m: msg(3, 'anyone up for chess?') });
    assert.deepEqual(link.state.messages.map((m) => m.id), [1, 2, 3]);

    link.say('Mina', 'again');
    const again = JSON.parse(socket.sent.at(-1)!);
    socket.receive({ t: 'error', error: 'slow', c: again.c });
    assert.deepEqual(rejects, [{ text: 'again', error: 'slow' }]);

    socket.receive({ t: 'online', n: 4 });
    socket.receive('pong');
    socket.receive({ t: 'cleared' });
    assert.equal(link.state.online, 4);
    assert.deepEqual(link.state.messages, []);
    assert.ok(statuses.length > 0 && statuses.every((status) => status === 'live'));
    link.close();
    assert.equal(socket.closed, true);
  });
});

test('LoungeLink reconnects with backoff and says when chat is unavailable', () => {
  withFakes(() => {
    const link = new LoungeLink('http://127.0.0.1:8787');
    const rejects: LoungeReject[] = [];
    link.onReject((reject) => rejects.push(reject));
    // An old Worker without /lounge: every attempt closes before it opens.
    FakeWebSocket.all[0].drop();
    assert.equal(link.state.status, 'connecting');
    mock.timers.tick(1250);
    assert.equal(FakeWebSocket.all.length, 2);
    FakeWebSocket.all[1].drop();
    assert.equal(link.state.status, 'unavailable');
    mock.timers.tick(2500);
    assert.equal(FakeWebSocket.all.length, 3);

    // The Worker is back: in, then dropped mid-message.
    const third = FakeWebSocket.all[2];
    third.open();
    third.receive({ t: 'welcome', messages: [msg(1)], online: 1 });
    assert.equal(link.state.status, 'live');
    link.say('Mina', 'still there?');
    third.drop();
    assert.equal(link.state.status, 'reconnecting');
    assert.deepEqual(rejects, [{ text: 'still there?', error: 'offline' }]);
    assert.deepEqual(link.state.messages.map((m) => m.id), [1]);
    mock.timers.tick(1250);
    assert.equal(FakeWebSocket.all.length, 4);
    FakeWebSocket.all[3].open();
    FakeWebSocket.all[3].receive({ t: 'welcome', messages: [msg(1), msg(2)], online: 2 });
    assert.equal(link.state.status, 'live');
    assert.deepEqual(link.state.messages.map((m) => m.id), [1, 2]);

    link.close();
    mock.timers.tick(60_000);
    assert.equal(FakeWebSocket.all.length, 4);
  });
});

test('LoungeLink pings to stay open and gives up on a socket that stops answering', () => {
  withFakes(() => {
    const link = new LoungeLink('https://arcade.test');
    const socket = FakeWebSocket.all[0];
    socket.open();
    socket.receive({ t: 'welcome', messages: [], online: 1 });
    mock.timers.tick(25_000);
    assert.equal(socket.sent.at(-1), 'ping');
    socket.receive('pong');
    mock.timers.tick(10_000);
    assert.equal(link.state.status, 'live');
    mock.timers.tick(15_000);
    assert.equal(socket.sent.filter((s) => s === 'ping').length, 2);
    // No pong this time.
    mock.timers.tick(10_000);
    assert.equal(socket.closed, true);
    assert.equal(link.state.status, 'reconnecting');
    mock.timers.tick(1250);
    assert.equal(FakeWebSocket.all.length, 2);
    link.close();
  });
});

test('LoungeLink without an API stays unavailable and never connects', () => {
  withFakes(() => {
    const link = new LoungeLink('');
    assert.equal(link.state.status, 'unavailable');
    assert.equal(link.say('Mina', 'hi'), false);
    link.retry();
    assert.equal(FakeWebSocket.all.length, 0);
    link.close();
  });
});
