// End-to-end check of Messages live chat against `wrangler dev`, with a fake Telegram API.
//
//   npx wrangler dev --port 8787 --var TELEGRAM_BOT_TOKEN:test-token --var TELEGRAM_API:http://127.0.0.1:8788
//   node scripts/smoke-chat.mjs
//
// Uses a fresh local state, so start wrangler with --persist-to pointing at an empty folder if it ran before.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

const api = process.env.ARCADE_API ?? 'http://127.0.0.1:8787';
const token = 'test-token';
const owner = 4242;
const calls = [];
let nextMessage = 1000;

const telegram = createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => {
    const method = req.url.split('/').pop();
    assert.equal(req.url, `/bot${token}/${method}`);
    const body = raw ? JSON.parse(raw) : {};
    calls.push({ method, body });
    const result = method === 'getMe' ? { id: 1, username: 'josh_test_bot' } : method === 'sendMessage' ? { message_id: nextMessage++ } : true;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true, result }));
  });
});
await new Promise((resolve) => telegram.listen(8788, '127.0.0.1', resolve));

const secret = createHash('sha256').update(`josh-site-telegram:${token}`).digest('hex');
const session = () => randomBytes(18).toString('base64url');
const checks = [];
const pass = (message) => checks.push(`PASS ${message}`);
const since = (n) => calls.slice(n);

const read = async (s, after = 0) => (await fetch(`${api}/chat?${new URLSearchParams(s ? { s, after: String(after) } : { after: String(after) })}`)).json();
const send = (s, text, after = 0) => fetch(`${api}/chat`, { method: 'POST', body: JSON.stringify({ s, text, after }) });
const update = (message, withSecret = true) =>
  fetch(`${api}/telegram`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(withSecret ? { 'X-Telegram-Bot-Api-Secret-Token': secret } : {}) },
    body: JSON.stringify({ update_id: nextMessage, message }),
  });
const fromOwner = (text, extra = {}) => ({ message_id: nextMessage++, text, chat: { id: owner, type: 'private' }, from: { id: owner, username: 'temporary_jk' }, ...extra });

try {
  assert.equal((await read(null)).live, false);
  const early = await send(session(), 'hello?');
  assert.equal(early.status, 503);
  assert.equal((await early.json()).error, 'offline');
  pass('chat is offline until Josh connects, so the site falls back to email');

  let mark = calls.length;
  const setup = await (await fetch(`${api}/telegram`)).text();
  assert.match(setup, /Bot @josh_test_bot is connected to http:\/\/127\.0\.0\.1:8787\/telegram/);
  assert.match(setup, /Last step: from your @temporary_jk Telegram account, open https:\/\/t\.me\/josh_test_bot/);
  const hook = since(mark).find((c) => c.method === 'setWebhook');
  assert.equal(hook.body.url, `${api}/telegram`);
  assert.equal(hook.body.secret_token, secret);
  pass('opening /telegram registers the webhook with its secret and says what is left');

  assert.equal((await update(fromOwner('/start'), false)).status, 401);
  pass('webhook calls without the secret are refused');

  mark = calls.length;
  assert.equal((await update({ message_id: 1, text: '/start', chat: { id: 77, type: 'private' }, from: { id: 77, username: 'rando' } })).status, 200);
  assert.equal((await read(null)).live, false);
  assert.match(since(mark).find((c) => c.method === 'sendMessage' && c.body.chat_id === 77).body.text, /passes along messages/);
  pass('a stranger pressing Start gets a note and does not claim the bot');

  mark = calls.length;
  await update(fromOwner('/start'));
  assert.equal((await read(null)).live, true);
  assert.match(since(mark).find((c) => c.body.chat_id === owner).body.text, /You're connected/);
  assert.match(await (await fetch(`${api}/telegram`)).text(), /All set\./);
  pass('@temporary_jk pressing Start connects the bot');

  const alice = session();
  mark = calls.length;
  const sent = await send(alice, '  hi josh!  ');
  assert.equal(sent.status, 200);
  const page = await sent.json();
  assert.deepEqual(page.messages.map((m) => [m.from, m.text]), [['visitor', 'hi josh!']]);
  assert.equal(page.next, 1);
  const note = since(mark).find((c) => c.method === 'sendMessage');
  assert.equal(note.body.chat_id, owner);
  assert.match(note.body.text, /^New chat #/);
  assert.match(note.body.text, /hi josh!/);
  const aliceNote = nextMessage - 1;
  pass('a visitor message reaches Josh on Telegram and is stored');

  mark = calls.length;
  assert.equal((await update(fromOwner('hey! thanks for stopping by', { reply_to_message: { message_id: aliceNote } }))).status, 200);
  assert.ok(since(mark).some((c) => c.method === 'setMessageReaction'));
  const reply = await read(alice, 1);
  assert.deepEqual(reply.messages.map((m) => [m.from, m.text]), [['josh', 'hey! thanks for stopping by']]);
  assert.equal(reply.from, 1);
  assert.equal(reply.next, 2);
  pass("Josh's reply comes back to that visitor, and Telegram shows a thumbs up");

  const bob = session();
  await send(bob, 'second visitor here');
  mark = calls.length;
  await update(fromOwner('hi bob'));
  assert.deepEqual((await read(bob)).messages.map((m) => m.text), ['second visitor here', 'hi bob']);
  assert.equal((await read(alice)).messages.length, 2);
  pass('a plain message (not a reply) goes to whoever wrote last');

  await update(fromOwner('back to you', { reply_to_message: { message_id: aliceNote } }));
  assert.deepEqual((await read(alice, 2)).messages.map((m) => m.text), ['back to you']);
  assert.equal((await read(bob)).messages.length, 2);
  pass('replying to an older message picks that conversation');

  mark = calls.length;
  await update(fromOwner('who?', { reply_to_message: { message_id: 1 } }));
  assert.match(since(mark).find((c) => c.method === 'sendMessage').body.text, /isn't from a visitor/);
  await update({ ...fromOwner(undefined), photo: [{}] });
  assert.match(calls.at(-1).body.text, /Only text/);
  pass('replies Josh cannot route, and non-text, get an explanation');

  const followUp = await (await send(alice, 'cool', 1)).json();
  assert.equal(followUp.from, 1);
  assert.deepEqual(followUp.messages.map((m) => m.text), ['hey! thanks for stopping by', 'back to you', 'cool']);
  assert.match(calls.findLast((c) => c.method === 'sendMessage').body.text, /^#\w{4}\ncool$/);
  assert.equal((await read(alice, 99)).from, 4);
  pass('sending returns everything since the last message on screen, and later notes are short');

  assert.equal((await send('bad', 'hi')).status, 400);
  assert.equal((await send(session(), '   ')).status, 400);
  assert.equal((await fetch(`${api}/chat`, { method: 'POST', body: 'nope' })).status, 400);
  pass('bad sessions, empty text and bad bodies are rejected');

  let limited = 0;
  for (let i = 0; i < 25; i++) if ((await send(session(), `spam ${i}`)).status === 429) limited++;
  assert.ok(limited > 0);
  pass('one IP sending too fast is rate limited');

  console.log(checks.join('\n'));
} finally {
  telegram.close();
}
