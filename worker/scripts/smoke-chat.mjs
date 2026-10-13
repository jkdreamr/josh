// End-to-end check of Messages live chat against `wrangler dev`, with a fake Telegram API and a stand-in for Workers AI.
// From worker/:
//
//   npx wrangler dev --port 8787 -c scripts/smoke/wrangler.jsonc -c scripts/smoke/ai-stub.jsonc --persist-to <empty folder>
//   node scripts/smoke-chat.mjs
//
// Needs fresh local state each run; auto-replies come after 3.6 seconds instead of a day.
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
    const result = method === 'getMe' ? { id: 1, username: 'josh_test_bot' } : method === 'sendMessage' ? { message_id: nextMessage++ } : true;
    calls.push({ method, body, result });
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

  const carol = session();
  assert.equal((await send(carol, 'is josh free to meet next week? #retired')).status, 200);

  mark = calls.length;
  const bobNote = calls.findLast((c) => c.method === 'sendMessage' && c.body.text.includes('second visitor here'));
  const ai = fromOwner('/ai', { reply_to_message: { message_id: bobNote.result.message_id } });
  await update(ai);
  const bobThread = (await read(bob)).messages;
  assert.equal(bobThread.at(-1).from, 'auto');
  assert.match(bobThread.at(-1).text, /automatic reply.*gemma-4-26b-a4b-it, \d+ messages, system first: true/);
  assert.ok(since(mark).some((c) => c.method === 'sendMessage' && c.body.chat_id === owner && c.body.text.startsWith('🤖 Auto-replied to #')));
  assert.ok(since(mark).some((c) => c.method === 'setMessageReaction' && c.body.message_id === ai.message_id));
  pass('/ai on a visitor message has the AI answer them now, and Josh sees what it said');

  const spam = [];
  let limited = 0;
  for (let i = 0; i < 25; i++) {
    const s = session();
    const status = (await send(s, `spam ${i}`)).status;
    if (status === 429) limited++;
    else spam.push(s);
  }
  assert.ok(limited > 0);
  pass('one IP sending too fast is rate limited');

  // Everyone still waiting comes due 3.6 seconds after writing; give the alarms time to run.
  await new Promise((resolve) => setTimeout(resolve, 9000));
  const autoCount = async (s) => (await read(s)).messages.filter((m) => m.from === 'auto').length;
  const aliceThread = (await read(alice)).messages;
  assert.equal(aliceThread.at(-1).from, 'auto');
  assert.equal(aliceThread.at(-2).text, 'cool');
  assert.equal(await autoCount(bob), 1);
  const carolThread = (await read(carol)).messages;
  assert.match(carolThread.at(-1).text, /llama-3\.3-70b-instruct-fp8-fast/);
  pass('after the wait, unanswered visitors get an auto-reply, falling back to the next model if one is gone');

  const answered = (await Promise.all(spam.map(autoCount))).reduce((a, b) => a + b, 0);
  // 15 attempts a day: /ai for bob, alice, carol's two (one failed), then the rest go to the earliest spam.
  assert.equal(answered, 15 - 4);
  assert.equal(calls.filter((c) => c.method === 'sendMessage' && c.body.text?.startsWith('🤖 Auto-replied')).length, 14);
  const unanswered = (await Promise.all(spam.map(autoCount))).filter((n) => n === 0).length;
  assert.equal(unanswered, spam.length - answered);
  mark = calls.length;
  await update(fromOwner('/ai', { reply_to_message: { message_id: 1 } }));
  await update(fromOwner('/ai'));
  assert.match(since(mark).findLast((c) => c.method === 'sendMessage').body.text, /all 15 auto-replies for today/);
  await new Promise((resolve) => setTimeout(resolve, 4000));
  assert.equal((await Promise.all(spam.map(autoCount))).reduce((a, b) => a + b, 0), answered);
  pass("auto-replies stop at today's limit and the rest wait for tomorrow");

  console.log(checks.join('\n'));
} finally {
  telegram.close();
}
