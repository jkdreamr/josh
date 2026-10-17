import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import {
  addMessages,
  CHANNELS,
  cleanLine,
  FRAME_MAX,
  HISTORY,
  IP_RATE,
  isRepeat,
  lineHash,
  loungeUrl,
  memberId,
  memberList,
  mentions,
  newestIds,
  rateCheck,
  readEvent,
  readFrame,
  readMessage,
  readPresence,
  readSay,
  REPEAT_MS,
  retryDelay,
  sameSecret,
  SOCKET_RATE,
  TEXT_MAX,
  TYPING_EVERY_MS,
  TYPING_SHOW_MS,
  typingLine,
  unreadCounts,
  validLine,
  type ChannelId,
  type LoungeMessage,
} from '../src/os/arcade/lounge-core.ts';
import { LoungeLink, type LoungeReject } from '../src/os/arcade/lounge.ts';

const msg = (id: number, text = `message ${id}`, name = 'Mina', t = 1_000 + id, ch: ChannelId = 'general'): LoungeMessage => ({ id, ch, name, text, t });
const inCh = (ch: ChannelId, id: number) => msg(id, `message ${id}`, 'Mina', 1_000 + id, ch);
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
  assert.deepEqual(readSay(say({ name: '  Jo\u0000sh ', text: 'room ABCD\n for chess', c: 'k1' })), { ch: 'general', name: 'Josh', text: 'room ABCD for chess', c: 'k1' });
  assert.deepEqual(readSay(say({ name: 'Josh', text: 'hi' })), { ch: 'general', name: 'Josh', text: 'hi' });
  assert.deepEqual(readSay(say({ name: 'Josh', text: 'hi', c: 'not a tag!' })), { ch: 'general', name: 'Josh', text: 'hi' });
  assert.deepEqual(readSay(say({ name: 'Josh', text: 'x'.repeat(TEXT_MAX) })), { ch: 'general', name: 'Josh', text: 'x'.repeat(TEXT_MAX) });
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

test('readSay takes a channel and a shared room, and turns down ones that are off', () => {
  assert.deepEqual(readSay(say({ ch: 'ideas', name: 'Josh', text: 'more chess', c: 'a' })), { ch: 'ideas', name: 'Josh', text: 'more chess', c: 'a' });
  assert.deepEqual(readSay(say({ ch: 'find-a-game', name: 'Josh', text: 'join me', invite: { game: 'lightcycles', code: 'ABCD' } })), {
    ch: 'find-a-game',
    name: 'Josh',
    text: 'join me',
    invite: { game: 'lightcycles', code: 'ABCD' },
  });
  for (const ch of ['random', '', 7, null]) assert.deepEqual(readSay(say({ ch, name: 'Josh', text: 'hi', c: 'b' })), { error: 'channel', c: 'b' }, String(ch));
  for (const invite of ['ABCD', { game: 'lightcycles' }, { game: 'Light Cycles', code: 'ABCD' }, { game: 'lightcycles', code: 'ABC1' }, { game: 'lightcycles', code: 'abcd' }, null]) {
    assert.deepEqual(readSay(say({ ch: 'find-a-game', name: 'Josh', text: 'hi', invite })), { error: 'invite' }, JSON.stringify(invite));
  }
  // A bad name is the first thing to fix, then the text, then the room.
  assert.deepEqual(readSay(say({ ch: 'general', name: '', text: '', invite: 'x' })), { error: 'name' });
});

test('readFrame reads says, changes to what someone shows, and typing; nothing else', () => {
  assert.deepEqual(readFrame(say({ name: 'Josh', text: 'hi' })), { t: 'say', said: { ch: 'general', name: 'Josh', text: 'hi' } });
  assert.deepEqual(readFrame(say({ name: '', text: 'hi' })), { t: 'say', said: { error: 'name' } });
  assert.deepEqual(readFrame(JSON.stringify({ t: 'me', name: ' Mina ', game: 'omok', room: 'WXYZ' })), { t: 'me', presence: { name: 'Mina', game: 'omok', room: 'WXYZ' } });
  assert.deepEqual(readFrame(JSON.stringify({ t: 'me' })), { t: 'me', presence: {} });
  assert.deepEqual(readFrame(JSON.stringify({ t: 'typing', ch: 'ideas' })), { t: 'typing', ch: 'ideas' });
  for (const raw of ['ping', JSON.stringify({ t: 'typing', ch: 'random' }), JSON.stringify({ t: 'typing' }), JSON.stringify({ t: 'msg' }), say({ name: 'Josh', text: 'z'.repeat(FRAME_MAX) }), 7]) {
    assert.equal(readFrame(raw), null, String(raw));
  }
});

test('readPresence keeps a clean name, a game id, and a room only with its game', () => {
  assert.deepEqual(readPresence({ name: ' Mina\u200b ', game: 'lightcycles', room: 'ABCD' }), { name: 'Mina', game: 'lightcycles', room: 'ABCD' });
  assert.deepEqual(readPresence({ room: 'ABCD' }), {});
  assert.deepEqual(readPresence({ name: 'x'.repeat(17), game: 'Light Cycles', room: 'ABCD' }), {});
  assert.deepEqual(readPresence({ name: 'Mina', game: 'go', room: 'abcd' }), { name: 'Mina', game: 'go' });
  assert.deepEqual(readPresence({ name: 42, game: ['go'] }), {});
  assert.deepEqual(readPresence({ game: `a${'b'.repeat(31)}` }), { game: `a${'b'.repeat(31)}` });
  assert.deepEqual(readPresence({ game: `a${'b'.repeat(32)}` }), {});
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

test('addMessages keeps the newest in each channel on its own', () => {
  const general = Array.from({ length: 5 }, (_, i) => inCh('general', i * 2 + 1));
  const ideas = [inCh('ideas', 2), inCh('ideas', 4)];
  const kept = addMessages([], [...general, ...ideas], 3);
  assert.deepEqual(kept.map((m) => `${m.ch}:${m.id}`), ['ideas:2', 'ideas:4', 'general:5', 'general:7', 'general:9']);
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

test('readMessage puts a message from before channels in #general and drops a malformed room', () => {
  const { ch: _ch, ...old } = msg(5);
  assert.deepEqual(readMessage(old), msg(5));
  assert.deepEqual(readMessage({ ...msg(6), ch: 'ideas' }), inCh('ideas', 6));
  assert.deepEqual(readMessage({ ...msg(7), invite: { game: 'chess', code: 'QRST' } }), { ...msg(7), invite: { game: 'chess', code: 'QRST' } });
  assert.deepEqual(readMessage({ ...msg(8), invite: { game: 'chess', code: 'no' } }), msg(8));
  assert.equal(readMessage({ ...msg(9), ch: 'random' }), null);
  assert.equal(readMessage({ ...msg(9), id: 0 }), null);
});

test('readEvent reads a current welcome with who is here, and an older Worker without', () => {
  const members = [{ id: 'abcd1234', name: 'Mina', game: 'omok', room: 'WXYZ' }, { id: 'zz99zz99' }, { id: 'BAD!', name: 'x' }, { id: 'qqqq1111', name: 'Bo', room: 'ABCD' }];
  assert.deepEqual(readEvent(JSON.stringify({ t: 'welcome', v: 2, you: 'zz99zz99', messages: [inCh('ideas', 1)], members, online: 3 })), {
    t: 'welcome',
    v: 2,
    you: 'zz99zz99',
    messages: [inCh('ideas', 1)],
    members: [{ id: 'abcd1234', name: 'Mina', game: 'omok', room: 'WXYZ' }, { id: 'zz99zz99' }, { id: 'qqqq1111', name: 'Bo' }],
    online: 3,
  });
  assert.equal(readEvent(JSON.stringify({ t: 'welcome', v: 2, messages: [], members: [], online: 1 })), null);
  assert.equal(readEvent(JSON.stringify({ t: 'welcome', v: 2, you: 'zz99zz99', messages: [], online: 1 })), null);
  const { ch: _ch, ...old } = msg(1);
  assert.deepEqual(readEvent(JSON.stringify({ t: 'welcome', messages: [old], online: 2 })), { t: 'welcome', messages: [msg(1)], online: 2 });
});

test('readEvent reads arrivals, changes, departures, typing and clearing a channel', () => {
  assert.deepEqual(readEvent(JSON.stringify({ t: 'join', m: { id: 'abcd1234' } })), { t: 'join', m: { id: 'abcd1234' } });
  assert.deepEqual(readEvent(JSON.stringify({ t: 'member', m: { id: 'abcd1234', name: 'Mina', game: 'go' } })), { t: 'member', m: { id: 'abcd1234', name: 'Mina', game: 'go' } });
  assert.deepEqual(readEvent(JSON.stringify({ t: 'leave', id: 'abcd1234' })), { t: 'leave', id: 'abcd1234' });
  assert.deepEqual(readEvent(JSON.stringify({ t: 'typing', ch: 'ideas', id: 'abcd1234' })), { t: 'typing', ch: 'ideas', id: 'abcd1234' });
  assert.deepEqual(readEvent(JSON.stringify({ t: 'cleared', ch: 'ideas' })), { t: 'cleared', ch: 'ideas' });
  assert.deepEqual(readEvent(JSON.stringify({ t: 'cleared', ch: 'random' })), { t: 'cleared' });
  assert.deepEqual(readEvent(JSON.stringify({ t: 'msg', m: msg(4), by: 'abcd1234' })), { t: 'msg', m: msg(4), by: 'abcd1234' });
  assert.deepEqual(readEvent(JSON.stringify({ t: 'msg', m: msg(4), by: 'NO' })), { t: 'msg', m: msg(4) });
  assert.deepEqual(readEvent(JSON.stringify({ t: 'error', error: 'invite', c: 'k1' })), { t: 'error', error: 'invite', c: 'k1' });
  for (const raw of [
    JSON.stringify({ t: 'join', m: { name: 'Mina' } }),
    JSON.stringify({ t: 'leave', id: 7 }),
    JSON.stringify({ t: 'typing', ch: 'random', id: 'abcd1234' }),
    JSON.stringify({ t: 'typing', ch: 'ideas' }),
  ]) {
    assert.equal(readEvent(raw), null, raw);
  }
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

test('loungeUrl swaps http for ws, keeps a base path, and says who is connecting', () => {
  assert.equal(loungeUrl('https://josh-arcade.example.workers.dev').href, 'wss://josh-arcade.example.workers.dev/lounge?v=2');
  assert.equal(loungeUrl('http://127.0.0.1:8787/').href, 'ws://127.0.0.1:8787/lounge?v=2');
  assert.equal(loungeUrl('https://example.com/api/?x=1').href, 'wss://example.com/api/lounge?v=2');
  assert.equal(loungeUrl('https://arcade.test', { name: 'Mina K', game: 'omok', room: 'WXYZ' }).href, 'wss://arcade.test/lounge?v=2&name=Mina+K&game=omok&room=WXYZ');
});

test('memberId makes short lowercase ids', () => {
  assert.equal(memberId(new Uint8Array([0, 35, 36, 255])), '0z03');
  assert.match(memberId(crypto.getRandomValues(new Uint8Array(8))), /^[a-z0-9]{8}$/);
});

test('unreadCounts counts past each channel read mark, and newestIds marks everything read', () => {
  const messages = [inCh('general', 1), inCh('ideas', 2), inCh('general', 3), inCh('find-a-game', 4), inCh('general', 5)];
  assert.deepEqual(unreadCounts(messages, {}), { general: 3, 'find-a-game': 1, ideas: 1 });
  assert.deepEqual(unreadCounts(messages, { general: 3, ideas: 2 }), { general: 1, 'find-a-game': 1, ideas: 0 });
  assert.deepEqual(newestIds(messages), { general: 5, ideas: 2, 'find-a-game': 4 });
  assert.deepEqual(unreadCounts(messages, newestIds(messages)), { general: 0, 'find-a-game': 0, ideas: 0 });
  assert.deepEqual(Object.keys(unreadCounts([], {})), CHANNELS.map((channel) => channel.id));
});

test('typingLine names up to three people', () => {
  assert.equal(typingLine([]), '');
  assert.equal(typingLine(['Mina']), 'Mina is typing…');
  assert.equal(typingLine(['Mina', 'Bo', 'Mina']), 'Mina and Bo are typing…');
  assert.equal(typingLine(['Mina', 'Bo', 'Cy']), 'Mina, Bo and Cy are typing…');
  assert.equal(typingLine(['Mina', 'Bo', 'Cy', 'Dee']), 'Several people are typing…');
});

test('mentions finds @name in any case, but not inside a longer word or an email address', () => {
  assert.ok(mentions('@mina want to play?', 'Mina'));
  assert.ok(mentions('gg @Mina!', 'Mina'));
  assert.ok(mentions('hey @Josh K, rematch', 'Josh K'));
  assert.ok(!mentions('@minami want to play?', 'Mina'));
  assert.ok(!mentions('mail mina@example.com', 'mina'));
  assert.ok(!mentions('hi mina', 'Mina'));
  assert.ok(!mentions('@', ''));
});

test('memberList lists joinable rooms first, then players, by name, once each, and counts guests', () => {
  const list = memberList(
    [
      { id: 'a1111111', name: 'zed' },
      { id: 'b1111111' },
      { id: 'c1111111', name: 'Mina', game: 'omok' },
      { id: 'd1111111', name: 'bo', game: 'lightcycles', room: 'ABCD' },
      { id: 'e1111111', name: 'Mina', game: 'omok' },
      { id: 'f1111111' },
      { id: 'g1111111', name: 'Al' },
    ],
    'e1111111',
  );
  assert.deepEqual(
    list.named.map((m) => [m.name, m.you]),
    [['bo', false], ['Mina', true], ['Al', false], ['zed', false]],
  );
  assert.equal(list.guests, 2);
  assert.equal(list.named[1].id, 'e1111111');
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

test('LoungeLink joins an older Worker, posts, and hands back what it turns down', () => {
  withFakes(() => {
    const link = new LoungeLink('https://arcade.test');
    const rejects: LoungeReject[] = [];
    const statuses: string[] = [];
    link.onChange((state) => statuses.push(state.status));
    link.onReject((reject) => rejects.push(reject));
    const socket = FakeWebSocket.all[0];
    assert.equal(socket.url.href, 'wss://arcade.test/lounge?v=2');
    assert.equal(link.state.status, 'connecting');
    assert.equal(link.say('general', 'Mina', 'too early'), false);

    // A Worker from before channels: no members, just a count.
    socket.open();
    socket.receive({ t: 'welcome', messages: [msg(1), msg(2)], online: 3 });
    assert.equal(link.state.status, 'live');
    assert.equal(link.state.online, 3);
    assert.equal(link.state.members, null);
    assert.equal(link.state.you, null);
    assert.deepEqual(link.state.messages.map((m) => m.id), [1, 2]);

    assert.equal(link.say('general', 'Mina', 'anyone up for chess?'), true);
    const sent = JSON.parse(socket.sent.at(-1)!);
    assert.deepEqual({ ...sent, c: undefined }, { t: 'say', ch: 'general', name: 'Mina', text: 'anyone up for chess?', c: undefined });
    socket.receive({ t: 'msg', m: msg(3, 'anyone up for chess?'), c: sent.c });
    socket.receive({ t: 'msg', m: msg(3, 'anyone up for chess?') });
    assert.deepEqual(link.state.messages.map((m) => m.id), [1, 2, 3]);

    link.say('find-a-game', 'Mina', 'again', { game: 'chess', code: 'QRST' });
    const again = JSON.parse(socket.sent.at(-1)!);
    assert.deepEqual(again.invite, { game: 'chess', code: 'QRST' });
    socket.receive({ t: 'error', error: 'slow', c: again.c });
    assert.deepEqual(rejects, [{ text: 'again', invite: { game: 'chess', code: 'QRST' }, error: 'slow' }]);

    // An older Worker hears nothing about presence or typing.
    const before = socket.sent.length;
    link.presence({ name: 'Mina', game: 'chess' });
    link.typing('general');
    assert.equal(socket.sent.length, before);

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

test('LoungeLink says who is connecting, keeps who is here, and tells the Worker when that changes', () => {
  withFakes(() => {
    const link = new LoungeLink('https://arcade.test', { name: 'Mina', game: 'omok' });
    const socket = FakeWebSocket.all[0];
    assert.equal(socket.url.href, 'wss://arcade.test/lounge?v=2&name=Mina&game=omok');
    // It changed while connecting: the Worker hears once the welcome is in.
    link.presence({ name: 'Mina', game: 'omok', room: 'WXYZ' });
    socket.open();
    assert.equal(socket.sent.length, 0);
    socket.receive({ t: 'welcome', v: 2, you: 'mina0001', messages: [inCh('ideas', 1)], members: [{ id: 'mina0001', name: 'Mina', game: 'omok' }, { id: 'bobo0001' }], online: 2 });
    assert.deepEqual(JSON.parse(socket.sent.at(-1)!), { t: 'me', name: 'Mina', game: 'omok', room: 'WXYZ' });
    assert.equal(link.state.you, 'mina0001');
    assert.equal(link.state.online, 2);

    const sentBefore = socket.sent.length;
    link.presence({ name: 'Mina', game: 'omok', room: 'WXYZ' });
    assert.equal(socket.sent.length, sentBefore);
    link.presence({ name: 'Mina' });
    assert.deepEqual(JSON.parse(socket.sent.at(-1)!), { t: 'me', name: 'Mina' });

    socket.receive({ t: 'join', m: { id: 'cycy0001' } });
    socket.receive({ t: 'member', m: { id: 'cycy0001', name: 'Cy', game: 'chess' } });
    socket.receive({ t: 'member', m: { id: 'bobo0001', name: 'Bo' } });
    assert.deepEqual(link.state.members, [
      { id: 'mina0001', name: 'Mina', game: 'omok' },
      { id: 'bobo0001', name: 'Bo' },
      { id: 'cycy0001', name: 'Cy', game: 'chess' },
    ]);
    assert.equal(link.state.online, 3);
    socket.receive({ t: 'leave', id: 'bobo0001' });
    assert.deepEqual(link.state.members?.map((m) => m.id), ['mina0001', 'cycy0001']);
    assert.equal(link.state.online, 2);

    socket.receive({ t: 'msg', m: inCh('ideas', 2) });
    socket.receive({ t: 'msg', m: inCh('general', 3) });
    socket.receive({ t: 'cleared', ch: 'ideas' });
    assert.deepEqual(link.state.messages.map((m) => m.id), [3]);

    // A new connection says who we are now.
    socket.drop();
    mock.timers.tick(1250);
    assert.equal(FakeWebSocket.all[1].url.href, 'wss://arcade.test/lounge?v=2&name=Mina');
    link.close();
  });
});

test('LoungeLink sends typing every few seconds at most, and shows others typing until they post or go quiet', () => {
  withFakes(() => {
    const link = new LoungeLink('https://arcade.test', { name: 'Mina' });
    const socket = FakeWebSocket.all[0];
    socket.open();
    socket.receive({ t: 'welcome', v: 2, you: 'mina0001', messages: [], members: [{ id: 'mina0001', name: 'Mina' }], online: 1 });
    const typed = () => socket.sent.filter((frame) => frame.includes('"typing"')).map((frame) => JSON.parse(frame).ch);
    link.typing('general');
    link.typing('general');
    mock.timers.tick(TYPING_EVERY_MS - 1);
    link.typing('general');
    link.typing('ideas');
    mock.timers.tick(1);
    link.typing('ideas');
    assert.deepEqual(typed(), ['general', 'ideas']);
    mock.timers.tick(TYPING_EVERY_MS);
    link.typing('ideas');
    assert.deepEqual(typed(), ['general', 'ideas', 'ideas']);
    // Posting ends the typing, so the next key says so again.
    link.say('ideas', 'Mina', 'more chess please');
    link.typing('ideas');
    assert.deepEqual(typed(), ['general', 'ideas', 'ideas', 'ideas']);

    socket.receive({ t: 'typing', ch: 'general', id: 'bobo0001' });
    socket.receive({ t: 'typing', ch: 'ideas', id: 'cycy0001' });
    socket.receive({ t: 'typing', ch: 'ideas', id: 'mina0001' });
    assert.deepEqual(Object.keys(link.state.typing).sort(), ['bobo0001', 'cycy0001']);
    socket.receive({ t: 'msg', m: inCh('general', 1), by: 'bobo0001' });
    assert.deepEqual(Object.keys(link.state.typing), ['cycy0001']);
    mock.timers.tick(TYPING_SHOW_MS - 1);
    assert.deepEqual(Object.keys(link.state.typing), ['cycy0001']);
    mock.timers.tick(1);
    assert.deepEqual(link.state.typing, {});
    link.close();
  });
});

test('LoungeLink without a name never says it is typing', () => {
  withFakes(() => {
    const link = new LoungeLink('https://arcade.test');
    const socket = FakeWebSocket.all[0];
    socket.open();
    socket.receive({ t: 'welcome', v: 2, you: 'anon0001', messages: [], members: [{ id: 'anon0001' }], online: 1 });
    link.typing('general');
    assert.deepEqual(socket.sent, []);
    link.close();
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
    link.say('general', 'Mina', 'still there?');
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
    assert.equal(link.say('general', 'Mina', 'hi'), false);
    link.retry();
    assert.equal(FakeWebSocket.all.length, 0);
    link.close();
  });
});
