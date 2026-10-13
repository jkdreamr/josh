import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cleanText,
  dayLabel,
  isChatPage,
  isSession,
  MAX_TEXT,
  mergePage,
  ownerNote,
  pollDelay,
  readIndex,
  readUpdate,
  webhookSecret,
  type ChatPage,
  type ThreadItem,
  type TgUpdate,
} from '../src/os/chat-core.ts';

const SESSION = 'AbCdEfGhIjKlMnOpQrStUvWx';
const OWNER = 4242;

const message = (text: string | undefined, chat = OWNER, extra: Partial<NonNullable<TgUpdate['message']>> = {}): TgUpdate => ({
  message: { message_id: 7, text, chat: { id: chat, type: 'private' }, from: { id: chat, username: 'temporary_jk' }, ...extra },
});

test('sessions are long url-safe ids', () => {
  assert.equal(isSession(SESSION), true);
  assert.equal(isSession('short'), false);
  assert.equal(isSession(`${SESSION}/../x`), false);
  assert.equal(isSession('a'.repeat(65)), false);
  assert.equal(isSession(null), false);
});

test('cleanText trims, strips control characters and rejects empty or long text', () => {
  assert.equal(cleanText('  hi josh \r\n'), 'hi josh');
  assert.equal(cleanText('a\u0000b\u0007c'), 'abc');
  assert.equal(cleanText('one\n\n\n\n\ntwo'), 'one\n\ntwo');
  assert.equal(cleanText('tab\there'), 'tab\there');
  assert.equal(cleanText('   '), null);
  assert.equal(cleanText(42), null);
  assert.equal(cleanText('x'.repeat(MAX_TEXT)), 'x'.repeat(MAX_TEXT));
  assert.equal(cleanText('x'.repeat(MAX_TEXT + 1)), null);
});

test('readIndex only accepts non-negative integers', () => {
  assert.equal(readIndex('12'), 12);
  assert.equal(readIndex(null), 0);
  assert.equal(readIndex('-3'), 0);
  assert.equal(readIndex('1.5'), 0);
  assert.equal(readIndex('abc'), 0);
});

test('the owner username claims the bot before an owner is known, from any first message', () => {
  assert.deepEqual(readUpdate(message('/start'), null, 'temporary_jk'), { kind: 'claim', chat: OWNER });
  assert.deepEqual(readUpdate(message('hello'), null, '@Temporary_JK'), { kind: 'claim', chat: OWNER });
});

test('nobody else can claim the bot, and group chats never do', () => {
  const other = message('/start', 99, { from: { id: 99, username: 'someone' } });
  assert.deepEqual(readUpdate(other, null, 'temporary_jk'), { kind: 'stranger', chat: 99, start: true });
  const group = message('/start', -100, { chat: { id: -100, type: 'group' } });
  assert.deepEqual(readUpdate(group, null, 'temporary_jk'), { kind: 'stranger', chat: -100, start: true });
});

test('once claimed, only the owner chat counts, whatever username writes', () => {
  const impostor = message('hi', 99, { from: { id: 99, username: 'temporary_jk' } });
  assert.deepEqual(readUpdate(impostor, OWNER, 'temporary_jk'), { kind: 'stranger', chat: 99, start: false });
  assert.deepEqual(readUpdate(message('/start'), OWNER, 'temporary_jk'), { kind: 'claim', chat: OWNER });
});

test("the owner's messages become answers, with the message they reply to", () => {
  assert.deepEqual(readUpdate(message('  hey there  ', OWNER, { reply_to_message: { message_id: 3 } }), OWNER, 'temporary_jk'), {
    kind: 'answer',
    chat: OWNER,
    message: 7,
    text: 'hey there',
    replyTo: 3,
  });
  assert.deepEqual(readUpdate(message('plain'), OWNER, 'x'), { kind: 'answer', chat: OWNER, message: 7, text: 'plain', replyTo: undefined });
  assert.deepEqual(readUpdate(message(undefined), OWNER, 'x'), { kind: 'not-text', chat: OWNER, message: 7 });
});

test('updates without a message are ignored', () => {
  assert.deepEqual(readUpdate({}, OWNER, 'x'), { kind: 'ignore' });
  assert.deepEqual(readUpdate(null, OWNER, 'x'), { kind: 'ignore' });
});

test('owner notes tag the visitor and explain replying on the first message only', () => {
  const first = ownerNote(SESSION, 'hi!', true);
  assert.match(first, /#abcd/);
  assert.match(first, /hi!/);
  assert.match(first, /Swipe left/);
  assert.equal(ownerNote(SESSION, 'again', false), '#abcd\nagain');
  assert.equal(ownerNote(SESSION, 'again', false).includes(SESSION), false);
});

test('the webhook secret is stable per token and fits Telegram\'s secret_token rules', async () => {
  const a = await webhookSecret('123:abc');
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(await webhookSecret('123:abc'), a);
  assert.notEqual(await webhookSecret('123:abd'), a);
});

test('polling slows down as the conversation goes quiet, then stops', () => {
  assert.equal(pollDelay(0), 3000);
  assert.equal(pollDelay(5 * 60 * 1000), 8000);
  assert.equal(pollDelay(60 * 60 * 1000), 30_000);
  assert.equal(pollDelay(3 * 60 * 60 * 1000), null);
});

test('isChatPage checks next lines up with the messages', () => {
  const page: ChatPage = { live: true, from: 2, messages: [{ from: 'josh', text: 'hi', t: 1 }], next: 3 };
  assert.equal(isChatPage(page), true);
  assert.equal(isChatPage({ ...page, next: 4 }), false);
  assert.equal(isChatPage({ ...page, messages: [{ from: 'bot', text: 'x', t: 1 }] }), false);
  assert.equal(isChatPage({ error: 'offline' }), false);
});

type Item = ThreadItem & { id: number };
let ids = 100;
const make = (m: { from: 'visitor' | 'josh'; text: string; t: number }, idx: number): Item => ({
  id: ids++,
  from: m.from === 'visitor' ? 'me' : 'josh',
  text: m.text,
  t: m.t,
  idx,
});

test('mergePage settles the sent bubble and appends replies', () => {
  const items: Item[] = [
    { id: 1, from: 'josh', text: 'hey!', t: 1 },
    { id: 2, from: 'me', text: 'yo', t: 2, status: 'sending' },
  ];
  const page: ChatPage = { live: true, from: 0, messages: [{ from: 'visitor', text: 'yo', t: 5 }, { from: 'josh', text: 'sup', t: 6 }], next: 2 };
  const merged = mergePage(items, page, 0, make);
  assert.equal(merged.length, 3);
  assert.deepEqual(merged[1], { id: 2, from: 'me', text: 'yo', t: 5, status: undefined, idx: 0 });
  assert.equal(merged[2].text, 'sup');
  assert.equal(merged[2].idx, 1);
});

test('mergePage skips what is already on screen', () => {
  const items: Item[] = [{ id: 1, from: 'me', text: 'a', t: 1, idx: 0 }];
  const page: ChatPage = { live: true, from: 0, messages: [{ from: 'visitor', text: 'a', t: 1 }, { from: 'josh', text: 'b', t: 2 }], next: 2 };
  const merged = mergePage(items, page, 1, make);
  assert.deepEqual(merged.map((m) => m.text), ['a', 'b']);
});

test('mergePage prefers a bubble still sending over an earlier failed one with the same text', () => {
  const items: Item[] = [
    { id: 1, from: 'me', text: 'hi', t: 1, status: 'failed' },
    { id: 2, from: 'me', text: 'hi', t: 2, status: 'sending' },
  ];
  const merged = mergePage(items, { live: true, from: 0, messages: [{ from: 'visitor', text: 'hi', t: 3 }], next: 1 }, 0, make);
  assert.equal(merged[0].status, 'failed');
  assert.equal(merged[1].status, undefined);
  assert.equal(merged[1].idx, 0);
});

test('mergePage puts history before the greeting', () => {
  const items: Item[] = [{ id: 1, from: 'josh', text: "hey! i'm josh", t: 10 }];
  const page: ChatPage = { live: true, from: 0, messages: [{ from: 'visitor', text: 'earlier', t: 1 }, { from: 'josh', text: 'reply', t: 2 }], next: 2 };
  assert.deepEqual(mergePage(items, page, 0, make, true).map((m) => m.text), ['earlier', 'reply', "hey! i'm josh"]);
});

test('day labels read like iMessage', () => {
  const now = new Date(2026, 9, 13, 15, 0).getTime();
  assert.equal(dayLabel(new Date(2026, 9, 13, 0, 5).getTime(), now), 'Today');
  assert.equal(dayLabel(new Date(2026, 9, 12, 23, 59).getTime(), now), 'Yesterday');
  assert.equal(dayLabel(new Date(2026, 9, 9, 12).getTime(), now), 'Friday');
  assert.equal(dayLabel(new Date(2026, 8, 1, 12).getTime(), now), 'Sep 1');
  assert.equal(dayLabel(new Date(2025, 11, 31, 12).getTime(), now), 'Dec 31, 2025');
});
