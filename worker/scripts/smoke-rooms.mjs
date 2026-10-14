import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';

const api = process.env.ARCADE_API ?? 'http://127.0.0.1:8787';
const checks = [];
const pass = (message) => checks.push(`PASS ${message}`);

async function createRoom(game, listed = false) {
  const response = await fetch(`${api}/rooms?game=${encodeURIComponent(game)}${listed ? '&public=1' : ''}`, { method: 'POST' });
  assert.equal(response.status, 200, `create ${game} room`);
  const { code } = await response.json();
  assert.match(code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/);
  return code;
}

function connect(code, name) {
  return new Promise((resolve, reject) => {
    const url = new URL(`/rooms/${code}/ws`, api);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('name', name);
    const socket = new WebSocket(url);
    const messages = [];
    const waiters = new Set();
    const client = {
      socket,
      messages,
      send(value) {
        socket.send(JSON.stringify(value));
      },
      wait(type, predicate = () => true, timeout = 5000) {
        const found = messages.find((message) => message.t === type && predicate(message));
        if (found) return Promise.resolve(found);
        return new Promise((resolveMessage, rejectMessage) => {
          const waiter = { type, predicate, resolve: resolveMessage, reject: rejectMessage };
          waiters.add(waiter);
          const timer = setTimeout(() => {
            waiters.delete(waiter);
            rejectMessage(new Error(`timed out waiting for ${type}`));
          }, timeout);
          waiter.finish = (message) => {
            clearTimeout(timer);
            waiters.delete(waiter);
            resolveMessage(message);
          };
        });
      },
    };
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      messages.push(message);
      for (const waiter of [...waiters]) {
        if (message.t === waiter.type && waiter.predicate(message)) waiter.finish(message);
      }
    });
    socket.addEventListener('open', () => resolve(client), { once: true });
    socket.addEventListener('error', (event) => reject(new Error(event.message || 'WebSocket handshake failed')), { once: true });
  });
}

function upgradeStatus(code, name) {
  const url = new URL(`/rooms/${code}/ws`, api);
  url.searchParams.set('name', name);
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, {
      headers: {
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-key': randomBytes(16).toString('base64'),
        'sec-websocket-version': '13',
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

async function waitForWins(name, expected) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const response = await fetch(`${api}/wins?game=pong`);
    assert.equal(response.status, 200);
    const { entries } = await response.json();
    const winner = entries.find((entry) => entry.name === name);
    if ((winner?.score ?? 0) === expected) return winner;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`online win did not reach ${expected}`);
}

const code = await createRoom('pong');
const hostName = `Smoke${Date.now().toString().slice(-8)}`;
const host = await connect(code, hostName);
const hostWelcome = await host.wait('welcome');
assert.equal(hostWelcome.seat, 0);
assert.equal(hostWelcome.bots, undefined, 'Pong rooms offer no bots');
const guest = await connect(code, 'Guest');
const guestWelcome = await guest.wait('welcome');
assert.equal(guestWelcome.seat, 1);
assert.deepEqual([hostWelcome.seat, guestWelcome.seat], [0, 1]);
pass('Pong room assigns seats 0 and 1');

assert.equal(await upgradeStatus(code, 'Third'), 409);
pass('Third Pong player receives HTTP 409');

host.send({ t: 'bots', n: 1 });
guest.send({ t: 'start' });
await new Promise((resolve) => setTimeout(resolve, 100));
assert.equal(host.messages.some((message) => message.t === 'start'), false);
assert.equal(host.messages.filter((message) => message.t === 'players').length, 2, 'bots are ignored in a game without them');
host.send({ t: 'start' });
await Promise.all([host.wait('start'), guest.wait('start')]);
pass('Guest start is ignored and host start is broadcast');

host.send({ t: 'msg', d: { text: 'host-to-guest' } });
assert.equal((await guest.wait('msg', (message) => message.d?.text === 'host-to-guest')).from, 0);
guest.send({ t: 'msg', d: { text: 'guest-to-host' } });
assert.equal((await host.wait('msg', (message) => message.d?.text === 'guest-to-host')).from, 1);
pass('Room WebSocket relay works in both directions');

const initialWinsResponse = await fetch(`${api}/wins?game=pong`);
const initialWins = await initialWinsResponse.json();
const initialCount = initialWins.entries.find((entry) => entry.name === hostName)?.score ?? 0;
host.send({ t: 'result', round: 1, winner: 0 });
host.send({ t: 'result', round: 1, winner: 0 });
guest.send({ t: 'result', round: 1, winner: 0 });
await waitForWins(hostName, initialCount + 1);
guest.send({ t: 'result', round: 1, winner: 0 });
host.send({ t: 'result', round: 1, winner: 0 });
await new Promise((resolve) => setTimeout(resolve, 150));
const winEntries = (await (await fetch(`${api}/wins?game=pong`)).json()).entries;
assert.equal(winEntries.find((entry) => entry.name === hostName)?.score, initialCount + 1);
pass('Agreed online win records once despite repeated reports');

host.socket.close();
await guest.wait('closed');
pass('Host disconnect notifies the guest');
guest.socket.close();

const lightCode = await createRoom('lightcycles');
const riders = [];
for (let seat = 0; seat < 4; seat++) {
  const rider = await connect(lightCode, `Rider${seat}`);
  const welcome = await rider.wait('welcome');
  assert.equal(welcome.seat, seat);
  riders.push(rider);
}
assert.equal(riders[3].messages.find((message) => message.t === 'welcome').seats, 4);
pass('Light Cycles room accepts four players');
for (const rider of riders) rider.socket.close();

const raceCode = await createRoom('coxbox');
const crews = [];
for (let seat = 0; seat < 3; seat++) {
  const crew = await connect(raceCode, `Crew${seat}${Date.now().toString().slice(-6)}`);
  assert.equal((await crew.wait('welcome')).seat, seat);
  crews.push(crew);
}
crews[0].send({ t: 'start' });
const firstStart = await Promise.all(crews.map((crew) => crew.wait('start')));
assert.deepEqual(firstStart.map((message) => message.round), [1, 1, 1]);
pass('Cox Box start carries the shared round number');

const late = await connect(raceCode, 'Latecomer');
const lateWelcome = await late.wait('welcome');
assert.equal(lateWelcome.seat, 3);
assert.equal(lateWelcome.started, true);
pass('Cox Box lets a player join while a race is under way');

const raceWinner = crews[1].messages.find((message) => message.t === 'welcome').players.find((player) => player.seat === 1).name;
const raceWins = async () => (await (await fetch(`${api}/wins?game=coxbox`)).json()).entries.find((entry) => entry.name === raceWinner)?.score ?? 0;
for (const crew of crews) crew.send({ t: 'result', round: 1, winner: 1 });
const deadline = Date.now() + 5000;
while ((await raceWins()) !== 1 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
assert.equal(await raceWins(), 1);
pass('A latecomer does not block the round they sat out');

crews[0].send({ t: 'start' });
const secondStart = await Promise.all([...crews, late].map((crew) => crew.wait('start', (message) => message.round === 2)));
assert.ok(secondStart.every((message) => message.players.length === 4));
pass('The latecomer races the next round');

const fill = [];
for (let seat = 4; seat < 8; seat++) fill.push(await connect(raceCode, `Fill${seat}`));
await Promise.all(fill.map((crew) => crew.wait('welcome')));
assert.equal(await upgradeStatus(raceCode, 'Ninth'), 409);
pass('Cox Box rooms hold eight crews');
for (const crew of [...fill, late, ...crews.slice(1), crews[0]]) crew.socket.close();

const botCode = await createRoom('lightcycles');
const botHost = await connect(botCode, `BotHost${Date.now().toString().slice(-6)}`);
assert.deepEqual((await botHost.wait('welcome')).bots, []);
botHost.send({ t: 'bots', n: 2 });
assert.deepEqual((await botHost.wait('players', (message) => message.bots?.length === 2)).bots, [1, 2]);
pass('Light Cycles host adds two bots in the lowest empty seats');

const botGuest = await connect(botCode, 'BotGuest');
const botGuestWelcome = await botGuest.wait('welcome');
assert.equal(botGuestWelcome.seat, 1);
assert.deepEqual(botGuestWelcome.bots, [2, 3]);
pass('A guest takes the seat a bot had, and the bot moves along');

botGuest.send({ t: 'bots', n: 0 });
botGuest.send({ t: 'bots', n: 9 });
await new Promise((resolve) => setTimeout(resolve, 100));
assert.equal(botHost.messages.filter((message) => message.t === 'players').at(-1).bots.length, 2);
pass('Only the host sets the bots, within the room');

botHost.send({ t: 'start' });
const botStarts = await Promise.all([botHost, botGuest].map((client) => client.wait('start')));
assert.deepEqual(botStarts.map((message) => message.bots), [[2, 3], [2, 3]]);
pass('The start names the seats the bots play');

for (const client of [botHost, botGuest]) client.send({ t: 'result', round: 1, winner: 3 });
await new Promise((resolve) => setTimeout(resolve, 150));
const lightWins = (await (await fetch(`${api}/wins?game=lightcycles`)).json()).entries;
assert.equal(lightWins.some((entry) => entry.name === 'BotGuest'), false);
pass('A round a bot wins counts for nobody');
for (const client of [botGuest, botHost]) client.socket.close();

const soloCode = await createRoom('palmdrive');
const soloHost = await connect(soloCode, 'SoloHost');
await soloHost.wait('welcome');
soloHost.send({ t: 'start' });
await new Promise((resolve) => setTimeout(resolve, 100));
assert.equal(soloHost.messages.some((message) => message.t === 'start'), false);
soloHost.send({ t: 'bots', n: 7 });
await soloHost.wait('players', (message) => message.bots?.length === 7);
soloHost.send({ t: 'start' });
assert.deepEqual((await soloHost.wait('start')).bots, [1, 2, 3, 4, 5, 6, 7]);
const latecomer = await connect(soloCode, 'Latecomer');
const latecomerWelcome = await latecomer.wait('welcome');
assert.equal(latecomerWelcome.seat, 1);
assert.equal(latecomerWelcome.started, true);
assert.deepEqual(latecomerWelcome.bots, [2, 3, 4, 5, 6, 7]);
pass('A host alone races seven bots, and someone can still join for the next race');
for (const client of [latecomer, soloHost]) client.socket.close();

const openRooms = async (game) => {
  const response = await fetch(`${api}/rooms${game ? `?game=${game}` : ''}`);
  assert.equal(response.status, 200);
  return (await response.json()).rooms;
};
const listedCode = await createRoom('lightcycles', true);
const privateCode = await createRoom('lightcycles');
assert.equal((await openRooms('lightcycles')).some((room) => room.code === listedCode), false, 'not before its host is in');
const publicHost = await connect(listedCode, 'PublicHost');
assert.equal((await publicHost.wait('welcome')).listed, true);
const privateHost = await connect(privateCode, 'PrivateHost');
assert.equal((await privateHost.wait('welcome')).listed, false);
const listedNow = (await openRooms('lightcycles')).find((room) => room.code === listedCode);
assert.deepEqual(listedNow, { code: listedCode, game: 'lightcycles', host: 'PublicHost', players: 1, bots: 0, seats: 4, started: false, lateJoin: false });
assert.ok((await openRooms()).some((room) => room.code === listedCode), 'and on the list of every game');
assert.equal((await openRooms('lightcycles')).some((room) => room.code === privateCode), false);
assert.equal((await fetch(`${api}/rooms?game=nope`)).status, 404);
pass('A public room is listed once its host is in; a private one never is');

publicHost.send({ t: 'listed', on: false });
await publicHost.wait('players', (message) => message.listed === false);
assert.equal((await openRooms('lightcycles')).some((room) => room.code === listedCode), false);
privateHost.send({ t: 'listed', on: true });
await privateHost.wait('players', (message) => message.listed === true);
assert.ok((await openRooms('lightcycles')).some((room) => room.code === privateCode));
pass('The host can make a room public or private at any time');

const stranger = await connect(privateCode, 'Stranger');
await stranger.wait('welcome');
stranger.send({ t: 'listed', on: false });
privateHost.send({ t: 'bots', n: 1 });
await privateHost.wait('players', (message) => message.bots?.length === 1);
const busy = (await openRooms('lightcycles')).find((room) => room.code === privateCode);
assert.equal(busy.players, 2);
assert.equal(busy.bots, 1);
pass('Only the host changes it, and the list follows who is in');

privateHost.send({ t: 'start' });
await stranger.wait('start');
await new Promise((resolve) => setTimeout(resolve, 100));
assert.equal((await openRooms('lightcycles')).some((room) => room.code === privateCode), false);
pass('A match that locks its room leaves the list when it starts');

const lateCode = await createRoom('coxbox', true);
const lateHost = await connect(lateCode, 'LateHost');
await lateHost.wait('welcome');
lateHost.send({ t: 'bots', n: 2 });
await lateHost.wait('players', (message) => message.bots?.length === 2);
lateHost.send({ t: 'start' });
await lateHost.wait('start');
await new Promise((resolve) => setTimeout(resolve, 100));
const lateListing = (await openRooms('coxbox')).find((room) => room.code === lateCode);
assert.equal(lateListing?.started, true, 'a race people can join between rounds stays listed');
lateHost.socket.close();
await new Promise((resolve) => setTimeout(resolve, 200));
assert.equal((await openRooms('coxbox')).some((room) => room.code === lateCode), false);
pass('A room that people can join late stays listed, and leaves when its host does');
for (const client of [stranger, privateHost, publicHost]) client.socket.close();

console.log(checks.join('\n'));
