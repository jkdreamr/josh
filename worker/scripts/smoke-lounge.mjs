// End-to-end check of the arcade chat (the Lounge object) against `wrangler dev`. From worker/:
//
//   npx wrangler dev --port 8787 -c scripts/smoke/wrangler.jsonc -c scripts/smoke/ai-stub.jsonc --persist-to <empty folder>
//   node scripts/smoke-lounge.mjs
//
// The smoke config sets LOUNGE_ADMIN_TOKEN, which this uses to start from an empty chat. Takes about 25 seconds:
// it waits out the rate limit window once. wrangler dev passes CF-Connecting-IP through, so a client can stand in
// for someone on another network (Cloudflare sets that header itself in production).
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';

const api = process.env.ARCADE_API ?? 'http://127.0.0.1:8787';
const token = process.env.LOUNGE_ADMIN_TOKEN ?? 'test-admin-token';
const checks = [];
const pass = (message) => checks.push(`PASS ${message}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const welcome = (event) => event.t === 'welcome';
const people = [];
let tags = 0;

function connect(ip) {
  return new Promise((resolve, reject) => {
    const url = new URL('/lounge', api);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url, ip ? { headers: { 'CF-Connecting-IP': ip } } : undefined);
    const events = [];
    const raw = [];
    const waiters = new Set();
    const client = {
      socket,
      events,
      raw,
      closed: null,
      send(value) {
        socket.send(typeof value === 'string' || value instanceof Uint8Array ? value : JSON.stringify(value));
      },
      /** Sends a message and resolves with what the Worker says about it: the message, or an error. */
      say(name, text) {
        const c = `s${++tags}`;
        client.send({ t: 'say', name, text, c });
        return client.wait((event) => event.c === c && (event.t === 'msg' || event.t === 'error'));
      },
      /** The first event from index `from` on that matches. */
      wait(predicate, { from = 0, timeout = 5000 } = {}) {
        const found = events.slice(from).find(predicate);
        if (found) return Promise.resolve(found);
        return new Promise((resolveEvent, rejectEvent) => {
          const waiter = { predicate };
          const timer = setTimeout(() => {
            waiters.delete(waiter);
            rejectEvent(new Error(`timed out waiting for ${predicate}`));
          }, timeout);
          waiter.finish = (event) => {
            clearTimeout(timer);
            waiters.delete(waiter);
            resolveEvent(event);
          };
          waiters.add(waiter);
        });
      },
      /** How many are here, as this client last heard. */
      online() {
        const last = events.findLast((event) => event.t === 'online' || event.t === 'welcome');
        return last?.t === 'online' ? last.n : last?.online;
      },
      waitClose(timeout = 5000) {
        if (client.closed) return Promise.resolve(client.closed);
        return new Promise((resolveClose, rejectClose) => {
          const timer = setTimeout(() => rejectClose(new Error('timed out waiting for close')), timeout);
          socket.addEventListener('close', () => {
            clearTimeout(timer);
            resolveClose(client.closed);
          });
        });
      },
    };
    socket.addEventListener('message', (event) => {
      const data = String(event.data);
      raw.push(data);
      let parsed;
      try {
        parsed = JSON.parse(data);
      } catch {
        return;
      }
      events.push(parsed);
      for (const waiter of [...waiters]) if (waiter.predicate(parsed)) waiter.finish(parsed);
    });
    socket.addEventListener('close', (event) => {
      client.closed = { code: event.code, reason: event.reason };
    });
    socket.addEventListener('open', () => {
      people.push(client);
      resolve(client);
    }, { once: true });
    socket.addEventListener('error', () => reject(new Error('WebSocket handshake failed')), { once: true });
  });
}

function upgradeStatus(ip) {
  const url = new URL('/lounge', api);
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, {
      headers: {
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-key': randomBytes(16).toString('base64'),
        'sec-websocket-version': '13',
        'cf-connecting-ip': ip,
      },
    });
    request.once('response', (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    request.once('upgrade', (response, socket) => {
      socket.destroy();
      resolve(response.statusCode);
    });
    request.once('error', reject);
    request.end();
  });
}

const clear = (authorization) => fetch(`${api}/lounge/clear`, { method: 'POST', headers: authorization ? { authorization } : {} });

try {
  assert.equal((await clear(`Bearer ${token}`)).status, 200, 'clearing with the smoke token (is LOUNGE_ADMIN_TOKEN set?)');

  const ann = await connect();
  const annWelcome = await ann.wait(welcome);
  assert.deepEqual(annWelcome.messages, []);
  const here = annWelcome.online;
  const bo = await connect();
  assert.equal((await bo.wait(welcome)).online, here + 1);
  await ann.wait((event) => event.t === 'online' && event.n === here + 1);
  pass('joining says how many are here, and tells everyone else');

  const first = await ann.say('Ann', 'anyone up for chess? room ABCD');
  assert.equal(first.t, 'msg');
  assert.deepEqual([first.m.name, first.m.text], ['Ann', 'anyone up for chess? room ABCD']);
  assert.ok(Number.isSafeInteger(first.m.id) && Math.abs(first.m.t - Date.now()) < 60_000);
  const seen = await bo.wait((event) => event.t === 'msg' && event.m.id === first.m.id);
  assert.deepEqual(seen, { t: 'msg', m: first.m });
  const reply = await bo.say('Bo', 'me! joining');
  await ann.wait((event) => event.t === 'msg' && event.m.id === reply.m.id);
  assert.ok(reply.m.id > first.m.id);
  pass("two people see each other's messages, and only the sender gets its tag back");

  const cy = await connect();
  assert.deepEqual((await cy.wait(welcome)).messages.map((m) => [m.name, m.text]), [['Ann', 'anyone up for chess? room ABCD'], ['Bo', 'me! joining']]);
  pass('someone joining later gets the history');

  const cleaned = await cy.say('  C\u0000y \u200b', 'hi\u0007   there\n\nfriends\u202e');
  assert.deepEqual([cleaned.m.name, cleaned.m.text], ['Cy', 'hi there friends']);
  for (const name of ['', '   ', '\u200b', 'x'.repeat(17), 42]) assert.equal((await cy.say(name, 'hello')).error, 'name', JSON.stringify(name));
  for (const text of ['', ' \u0007 ', 'y'.repeat(281), null]) assert.equal((await cy.say('Cy', text)).error, 'text', JSON.stringify(text));
  assert.equal((await cy.say('Cy', 'z'.repeat(280))).t, 'msg');
  pass('names and text are cleaned, and bad ones are turned down');

  assert.equal((await cy.say('Cy', 'gg')).t, 'msg');
  assert.equal((await cy.say('Cy', 'gg')).error, 'repeat');
  pass('the same line twice in a row is dropped');

  // Let the ten second window from the messages above pass, then go over the limits on purpose.
  await sleep(10_500);
  const dee = await connect();
  await dee.wait(welcome);
  const burst = [];
  for (let i = 0; i < 6; i++) burst.push(await dee.say('Dee', `burst ${i}`));
  assert.deepEqual(burst.map((event) => event.error ?? event.t), ['msg', 'msg', 'msg', 'msg', 'msg', 'slow']);
  pass('one connection gets five messages in ten seconds');

  const eve = await connect();
  await eve.wait(welcome);
  for (let i = 0; i < 5; i++) assert.equal((await eve.say('Eve', `eve ${i}`)).t, 'msg');
  const fay = await connect();
  await fay.wait(welcome);
  assert.equal((await fay.say('Fay', 'my first message')).error, 'slow');
  const elsewhere = await connect('198.51.100.7');
  await elsewhere.wait(welcome);
  assert.equal((await elsewhere.say('Gus', 'hi from another network')).t, 'msg');
  pass('one IP gets ten messages in ten seconds across its connections, and other networks are not held up');

  const crowd = [];
  for (let i = 0; i < 21; i++) crowd.push(await connect(`198.51.100.${10 + i}`));
  for (const [i, person] of crowd.entries()) {
    await person.wait(welcome);
    for (let j = 0; j < 5; j++) assert.equal((await person.say(`Crowd ${i}`, `crowd ${i}.${j}`)).t, 'msg');
  }
  const late = await connect();
  const history = (await late.wait(welcome)).messages;
  assert.equal(history.length, 100);
  assert.deepEqual([history[0].text, history.at(-1).text], ['crowd 1.0', 'crowd 20.4']);
  assert.ok(history.every((m, i) => i === 0 || m.id > history[i - 1].id));
  pass('only the newest 100 messages are kept, oldest first');

  const busyIp = '203.0.113.50';
  const fills = [];
  for (let i = 0; i < 20; i++) fills.push(await connect(busyIp));
  assert.equal(await upgradeStatus(busyIp), 429);
  fills.pop().socket.close();
  await sleep(300);
  assert.equal(await upgradeStatus(busyIp), 101);
  for (const fill of fills) fill.socket.close();
  pass('one IP holds at most 20 chat sockets');

  const big = await connect('203.0.113.60');
  await big.wait(welcome);
  big.send('x'.repeat(3000));
  assert.equal((await big.waitClose()).code, 1009);
  const binary = await connect('203.0.113.61');
  await binary.wait(welcome);
  binary.send(new Uint8Array([1, 2, 3]));
  assert.equal((await binary.waitClose()).code, 1003);
  pass('frames over 2 KB and binary frames close the socket');

  const flood = await connect('203.0.113.62');
  await flood.wait(welcome);
  for (let i = 0; i < 50; i++) flood.send('ping');
  assert.equal((await flood.say('Flo', 'pings are free')).t, 'msg');
  for (let i = 0; i < 25; i++) flood.send({ t: 'nope' });
  assert.equal((await flood.waitClose()).code, 1008);
  pass('pings never count, but a flood of other frames closes the socket');

  const churnIp = '203.0.113.70';
  for (let i = 0; i < 40; i++) {
    assert.equal(await upgradeStatus(churnIp), 101);
    await sleep(20);
  }
  assert.equal(await upgradeStatus(churnIp), 429);
  pass('one IP can join 40 times a minute');

  const mark = ann.raw.length;
  ann.send('ping');
  await sleep(300);
  assert.ok(ann.raw.slice(mark).includes('pong'));
  pass('ping is answered with pong');

  assert.equal((await clear()).status, 401);
  assert.equal((await clear('Bearer not-the-token')).status, 401);
  assert.equal((await clear(token)).status, 401);
  const from = ann.events.length;
  const wiped = await clear(`Bearer ${token}`);
  assert.equal(wiped.status, 200);
  assert.deepEqual(await wiped.json(), { ok: true, removed: 100 });
  await ann.wait((event) => event.t === 'cleared', { from });
  await late.wait((event) => event.t === 'cleared');
  const fresh = await connect();
  assert.deepEqual((await fresh.wait(welcome)).messages, []);
  pass('clearing needs the admin token, and empties the chat on every screen');

  await sleep(300);
  const before = ann.online();
  const leaving = ann.events.length;
  bo.socket.close();
  await ann.wait((event) => event.t === 'online' && event.n === before - 1, { from: leaving });
  pass('leaving updates how many are here');

  console.log(checks.join('\n'));
} finally {
  for (const person of people) person.socket.close();
}
