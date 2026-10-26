import assert from 'node:assert/strict';
import { test } from 'node:test';
import { roomApp } from '../src/os/arcade/apps.ts';
import { advanceOnlineRound, botPlayers, canStartNext, MAX_SEATS, nextOnlineRound, RoundRouter, tagRound, openRoomAction, openRoomDetail, openRoomLine, OPEN_ROOMS_MAX, parseOpenRooms, parseRacePacket, raceSeats, raceStandings, type OpenRoom } from '../src/os/arcade/kit/online-core.ts';
import { createRoom, listRooms, quickRoom, RoomLink, ROOM_CODE_ALPHABET, makeRoomCode } from '../src/os/arcade/kit/room.ts';
import { agreedWinner, agreedWinners, isPool, beginRound, benchSeat, botSeats, canJoinRoom, canStartRoom, canWatchRoom, endRound, GATHER_FULL_MS, GATHER_MS, gatherFull, gathering, joinable, LISTING_REFRESH_MS, lowestFreeSeat, markRoundRecorded, nextAlarm, nextHost, parseRoomMessage, pickQuick, QUICK_LATE_MS, QUICK_PENDING_MS, roomListing, roundPlayable, roundSeats, seatsFor, sortListings, WATCHERS_MAX, type LobbyRow, type RoomState } from '../worker/src/room-core.ts';
import { ONLINE_SPECS } from '../worker/src/specs.gen.ts';

/** A stand-in for the browser's WebSocket: records what RoomLink sends and lets a test play the server's side. */
class FakeWebSocket {
  static OPEN = 1;
  static last: FakeWebSocket;
  readyState = 0;
  sent: string[] = [];
  closed = false;
  listeners = new Map<string, Set<(event: unknown) => void>>();
  readonly url: URL;
  constructor(url: URL) {
    this.url = url;
    FakeWebSocket.last = this;
  }
  addEventListener(type: string, listener: (event: unknown) => void) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.get(type)?.delete(listener);
  }
  send(message: string) {
    this.sent.push(message);
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  emit(type: string, event: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
  /** Opens the socket and delivers server messages, the way the room would. */
  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.emit('open', new Event('open'));
  }
  receive(message: unknown) {
    this.emit('message', { data: JSON.stringify(message) });
  }
}

/** Runs a test with FakeWebSocket installed and WebRTC missing, so RoomLink relays everything through the room. */
async function withFakeRoom(run: () => Promise<void> | void) {
  const originalWebSocket = globalThis.WebSocket;
  const originalPeerDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'RTCPeerConnection');
  try {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    Object.defineProperty(globalThis, 'RTCPeerConnection', { value: undefined, configurable: true });
    await run();
  } finally {
    globalThis.WebSocket = originalWebSocket;
    if (originalPeerDescriptor) Object.defineProperty(globalThis, 'RTCPeerConnection', originalPeerDescriptor);
    else Reflect.deleteProperty(globalThis, 'RTCPeerConnection');
  }
}

test('online rounds advance independently from local game rounds', () => {
  assert.equal(advanceOnlineRound(0), 1);
  assert.equal(advanceOnlineRound(1), 2);
  assert.equal(advanceOnlineRound(40), 41);
  assert.equal(nextOnlineRound(0, null), 1);
  assert.equal(nextOnlineRound(3, 7), 7, 'the server round wins so late joiners line up');
});

test('rooms lock after starting unless the game lets players join between rounds', () => {
  const locked: RoomState = { game: 'pong', seats: 2, started: false };
  assert.equal(canJoinRoom(locked), true);
  beginRound(locked, [0, 1]);
  assert.equal(canJoinRoom(locked), false);

  const open: RoomState = { game: 'coxbox', seats: 8, started: false, lateJoin: true };
  assert.equal(beginRound(open, [0, 1, 2]), 1);
  assert.equal(canJoinRoom(open), true);
  assert.deepEqual(open.roster, [0, 1, 2]);
  assert.equal(beginRound(open, [0, 1, 2, 3]), 2);
  assert.deepEqual(open.roster, [0, 1, 2, 3]);
});

test('a room takes people again once its round is over, whatever the game', () => {
  const room: RoomState = { game: 'pong', seats: 2, started: false };
  const round = beginRound(room, [0, 1]);
  assert.equal(canJoinRoom(room), false, 'not mid-match');
  assert.equal(endRound(room, round - 1), false, 'word about an older round changes nothing');
  assert.equal(canJoinRoom(room), false);
  assert.equal(endRound(room, round), true);
  assert.equal(canJoinRoom(room), true, 'someone can take the empty seat for the next match');
  assert.equal(endRound(room, round), false, 'and it ends once');
  assert.equal(beginRound(room, [0, 1]), round + 1);
  assert.equal(canJoinRoom(room), false);
  assert.deepEqual(parseRoomMessage('{"t":"over","round":3}', 2), { t: 'over', round: 3 });
  assert.equal(parseRoomMessage('{"t":"over","round":-1}', 2), null);
  assert.equal(parseRoomMessage('{"t":"over"}', 2), null);
});

test('a round goes on while there is someone to play against, and the lowest seat takes over from a host', () => {
  const room: RoomState = { game: 'lightcycles', seats: 4, started: false, allowBots: true, bots: 2 };
  beginRound(room, [0, 1], 2);
  assert.equal(room.roundBots, 2);
  assert.equal(roundPlayable(room, 1), true, 'one rider and two bots');
  const duel: RoomState = { game: 'pong', seats: 2, started: false };
  beginRound(duel, [0, 1]);
  assert.equal(roundPlayable(duel, 1), false);
  assert.equal(roundPlayable(duel, 2), true);
  assert.deepEqual(nextHost([{ seat: 3, name: 'C' }, { seat: 1, name: 'A' }, { seat: 2, name: 'B' }]), { seat: 1, name: 'A' });
  assert.equal(nextHost([]), null);
});

test('players who join mid-round sit out that round\'s result', () => {
  const room: RoomState = { game: 'coxbox', seats: 8, started: false, lateJoin: true };
  const round = beginRound(room, [0, 1, 2]);
  // Seat 2 leaves, and a newcomer takes it mid-race; seat 3 also arrives late.
  benchSeat(room, 2);
  assert.deepEqual(roundSeats(room, [0, 1, 2, 3], round), [0, 1]);
  const reports = { [String(round)]: { '0': 1, '1': 1 } };
  assert.equal(agreedWinner(reports, roundSeats(room, [0, 1, 2, 3], round), round), 1);
  assert.equal(agreedWinner(reports, [0, 1, 2, 3], round), null, 'without the roster the newcomers would block it');
  // Older rounds, and rooms that never recorded a roster, fall back to everyone connected.
  assert.deepEqual(roundSeats(room, [0, 1, 3], round - 1), [0, 1, 3]);
  assert.deepEqual(roundSeats({ game: 'pong', seats: 2, started: true }, [0, 1], 1), [0, 1]);
});

test('room seats use the lowest available seat and only the host starts with two players', () => {
  assert.equal(lowestFreeSeat(4, [0, 2]), 1);
  assert.equal(lowestFreeSeat(2, [0, 1]), null);
  assert.equal(canStartRoom(0, 1), false);
  assert.equal(canStartRoom(1, 2), false);
  assert.equal(canStartRoom(0, 2), true);
});

test('bots fill the lowest empty seats and step aside for people', () => {
  assert.deepEqual(botSeats(8, [0], 3), [1, 2, 3]);
  assert.deepEqual(botSeats(8, [0, 1], 3), [2, 3, 4], 'someone joining takes the seat a bot had');
  assert.deepEqual(botSeats(4, [0, 2], 2), [1, 3], 'bots fill the gaps people leave');
  assert.deepEqual(botSeats(4, [0, 1, 2], 3), [3], 'a full room keeps only the bots that fit');
  assert.deepEqual(botSeats(4, [0, 1, 2, 3], 3), []);
  assert.deepEqual(botSeats(4, [0], 0), []);
});

test('a host can start against bots, and only the host sets how many', () => {
  assert.equal(canStartRoom(0, 1, 1), true, 'one person and a bot');
  assert.equal(canStartRoom(0, 1, 0), false);
  assert.equal(canStartRoom(1, 1, 3), false, 'guests never start');
  assert.deepEqual(parseRoomMessage('{"t":"bots","n":3}', 8), { t: 'bots', n: 3 });
  assert.deepEqual(parseRoomMessage('{"t":"bots","n":0}', 8), { t: 'bots', n: 0 });
  assert.equal(parseRoomMessage('{"t":"bots","n":8}', 8), null, 'at most every seat but the host\'s');
  assert.equal(parseRoomMessage('{"t":"bots","n":-1}', 8), null);
  assert.equal(parseRoomMessage('{"t":"bots","n":1.5}', 8), null);
  assert.equal(parseRoomMessage('{"t":"bots"}', 8), null);
});

test('bots are named in seat order, from the game\'s list when it has one', () => {
  assert.deepEqual(botPlayers([2, 5]), [{ seat: 2, name: 'Bot 1' }, { seat: 5, name: 'Bot 2' }]);
  assert.deepEqual(botPlayers([1, 3, 4], ['Tree', 'Leland']), [{ seat: 1, name: 'Tree' }, { seat: 3, name: 'Leland' }, { seat: 4, name: 'Bot 3' }]);
  assert.deepEqual(botPlayers([]), []);
});

test('room messages validate protocol fields and enforce the 8 KB cap', () => {
  assert.deepEqual(parseRoomMessage('{"t":"msg","d":{"x":1}}', 2), { t: 'msg', d: { x: 1 } });
  assert.deepEqual(parseRoomMessage('{"t":"signal","to":1,"d":"candidate"}', 2), { t: 'signal', to: 1, d: 'candidate' });
  assert.deepEqual(parseRoomMessage('{"t":"result","round":2,"winner":null}', 2), { t: 'result', round: 2, winner: null });
  assert.equal(parseRoomMessage('{"t":"signal","to":2,"d":{}}', 2), null);
  assert.equal(parseRoomMessage('{"t":"result","round":-1,"winner":0}', 2), null);
  assert.equal(parseRoomMessage(`{"t":"msg","d":"${'x'.repeat(8 * 1024)}"}`, 2), null);
  assert.equal(parseRoomMessage('{', 2), null);
});

test('online results require agreement and a round is recorded once', () => {
  const reports = { '1': { '0': 0, '1': 0 }, '2': { '0': 1 } };
  assert.equal(agreedWinner(reports, [0], 1), null);
  assert.equal(agreedWinner(reports, [0, 1], 1), 0);
  assert.equal(agreedWinner(reports, [0, 1], 2), null);
  reports['1']['1'] = 1;
  assert.equal(agreedWinner(reports, [0, 1], 1), null);
  const recorded: number[] = [];
  assert.equal(markRoundRecorded(recorded, 1), true);
  assert.equal(markRoundRecorded(recorded, 1), false);
});

test('room codes contain four characters from the supported alphabet', () => {
  assert.equal(ROOM_CODE_ALPHABET, 'ABCDEFGHJKMNPQRSTUVWXYZ23456789');
  const code = makeRoomCode([0, 1, 2, 3]);
  assert.equal(code.length, 4);
  assert.ok([...code].every((character) => ROOM_CODE_ALPHABET.includes(character)));
});

test('RoomLink uses host-only relay fallback without WebRTC', async () => {
  await withFakeRoom(async () => {
    const link = new RoomLink('ABCD', 'Guest', 'https://arcade.test');
    const socket = FakeWebSocket.last;
    const events: unknown[] = [];
    link.on('welcome', (welcome) => events.push(['welcome', welcome.started]));
    link.on('start', (start) => events.push(['start', start.round, start.players.length]));
    assert.equal(socket.url.href, 'wss://arcade.test/rooms/ABCD/ws?name=Guest&v=3', 'names the protocol, so the room can hand it the host role');
    socket.readyState = FakeWebSocket.OPEN;
    socket.emit('open', new Event('open'));
    socket.emit('message', { data: JSON.stringify({ t: 'welcome', seat: 1, code: 'ABCD', game: 'pong', seats: 2, players: [{ seat: 0, name: 'Host' }, { seat: 1, name: 'Guest' }] }) });
    socket.emit('message', { data: JSON.stringify({ t: 'start', players: [{ seat: 0, name: 'Host' }, { seat: 1, name: 'Guest' }] }) });
    socket.emit('message', { data: JSON.stringify({ t: 'start', round: 4, players: [{ seat: 0, name: 'Host' }, { seat: 1, name: 'Guest' }] }) });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(events, [['welcome', false], ['start', null, 2], ['start', 4, 2]]);
    assert.equal(link.bots, null, 'a room for a game without bots offers none');
    link.send({ paddle: 0.5 }, { fast: true });
    assert.deepEqual(JSON.parse(socket.sent.at(-1)!), { t: 'msg', to: 0, d: { paddle: 0.5 } });
    assert.equal(link.transport, 'relay');
    link.close();
    assert.equal(socket.closed, true);
  });
});

test('RoomLink follows the bots a room offers and the ones each round starts with', async () => {
  await withFakeRoom(async () => {
    const link = new RoomLink('WXYZ', 'Host', 'https://arcade.test');
    const socket = FakeWebSocket.last;
    const seen: unknown[] = [];
    link.on('welcome', (welcome) => seen.push(['welcome', welcome.bots]));
    link.on('bots', (bots) => seen.push(['bots', bots]));
    link.on('start', (start) => seen.push(['start', start.bots]));
    socket.open();
    socket.receive({ t: 'welcome', seat: 0, code: 'WXYZ', game: 'lightcycles', seats: 4, players: [{ seat: 0, name: 'Host' }], bots: [], started: false });
    link.setBots(2);
    assert.deepEqual(JSON.parse(socket.sent.at(-1)!), { t: 'bots', n: 2 });
    socket.receive({ t: 'players', players: [{ seat: 0, name: 'Host' }], bots: [1, 2] });
    // A guest takes seat 1, so the bots move up; seats a person holds, or outside the room, are dropped.
    socket.receive({ t: 'players', players: [{ seat: 0, name: 'Host' }, { seat: 1, name: 'Guest' }], bots: [2, 3, 1, 9, 'x'] });
    socket.receive({ t: 'start', round: 1, players: [{ seat: 0, name: 'Host' }, { seat: 1, name: 'Guest' }], bots: [3, 2] });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(seen, [['welcome', []], ['bots', []], ['bots', [1, 2]], ['bots', [2, 3]], ['start', [2, 3]]]);
    assert.deepEqual(link.bots, [2, 3]);
    link.close();
  });
});

test('RoomLink follows a host hand-off, round ends and the round a latecomer walks into', async () => {
  await withFakeRoom(async () => {
    const link = new RoomLink('HOST', 'Bea', 'https://arcade.test');
    const socket = FakeWebSocket.last;
    const seen: unknown[] = [];
    link.on('welcome', (welcome) => seen.push(['welcome', welcome.round, welcome.started]));
    link.on('host', (host) => seen.push(['host', host.from, host.seat]));
    link.on('started', (started) => seen.push(['started', started]));
    link.on('players', (players) => seen.push(['players', players.map((p) => p.seat)]));
    socket.open();
    socket.receive({ t: 'welcome', seat: 2, code: 'HOST', game: 'coxbox', seats: 8, players: [{ seat: 0, name: 'Ann' }, { seat: 1, name: 'Cy' }, { seat: 2, name: 'Bea' }], started: true, round: 3 });
    socket.receive({ t: 'players', players: [{ seat: 0, name: 'Ann' }, { seat: 1, name: 'Cy' }, { seat: 2, name: 'Bea' }], started: false });
    // Ann leaves: Cy, in the lowest seat, hosts now.
    socket.receive({ t: 'host', from: 1, players: [{ seat: 0, name: 'Cy' }, { seat: 2, name: 'Bea' }], started: false });
    assert.equal(link.seat, 2);
    // Then Cy leaves too: Bea takes over.
    socket.receive({ t: 'host', from: 2, players: [{ seat: 0, name: 'Bea' }], started: false });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(link.seat, 0);
    assert.deepEqual(seen, [
      ['welcome', 3, true], ['players', [0, 1, 2]],
      ['players', [0, 1, 2]], ['started', false],
      ['host', 1, 2], ['players', [0, 2]], ['started', false],
      ['host', 2, 0], ['players', [0]], ['started', false],
    ]);
    link.endRound(4);
    assert.deepEqual(JSON.parse(socket.sent.at(-1)!), { t: 'over', round: 4 });
    link.close();
  });
});

test('score races rank the best score and wait for every seat', () => {
  const partial = raceStandings({ 0: 120 }, [0, 1]);
  assert.equal(partial.done, false);
  assert.equal(partial.winner, null);
  assert.deepEqual(partial.standings.map((s) => [s.seat, s.place]), [[0, 1], [1, null]]);

  const done = raceStandings({ 0: 120, 1: 300, 2: null }, [0, 1, 2]);
  assert.equal(done.done, true);
  assert.equal(done.winner, 1);
  assert.deepEqual(done.standings.map((s) => [s.seat, s.place]), [[1, 1], [0, 2], [2, null]]);

  assert.equal(raceStandings({ 0: 50, 1: 50 }, [0, 1]).winner, null, 'a tie has no winner');
  assert.equal(raceStandings({ 0: null, 1: null }, [0, 1]).winner, null, 'nobody scored');
  assert.equal(raceStandings({ 0: 9000, 1: 7000 }, [0, 1], true).winner, 1, 'times: lower wins');
  assert.equal(raceStandings({ 0: 10, 1: 5 }, [0]).done, false, 'a race needs two players');
  assert.equal(raceStandings({ 0: 10, 1: 5, 2: 1 }, [0, 1]).winner, 0, 'players who left do not count');
});

test('a settled race keeps its result after someone leaves', () => {
  const settled = { round: 3, seats: [0, 1], names: { 0: 'Ann', 1: 'Ben' } };
  assert.deepEqual(raceSeats([0], settled, 3), [0, 1], 'the finished lineup stays');
  assert.deepEqual(raceSeats([0], settled, 4), [0], 'a new round goes back to who is here');
  assert.deepEqual(raceSeats([0, 1], null, 3), [0, 1]);
  const after = raceStandings({ 0: 6, 1: 6 }, raceSeats([0], settled, 3));
  assert.equal(after.done, true);
  assert.equal(after.winner, null, 'still a tie');
  assert.deepEqual(after.standings.map((s) => [s.seat, s.score]), [[0, 6], [1, 6]]);
});

test('the last racer still here settles a race the others left before finishing', () => {
  assert.equal(raceStandings({ 0: 12 }, [0]).done, false, 'by default a race needs two players');
  const alone = raceStandings({ 0: 12 }, [0], false, 1);
  assert.equal(alone.done, true);
  assert.equal(alone.winner, 0);
  assert.deepEqual(alone.standings.map((s) => [s.seat, s.score, s.place]), [[0, 12, 1]]);
  assert.equal(raceStandings({}, [0], false, 1).done, false, 'still playing');
  assert.equal(raceStandings({ 0: null }, [0], false, 1).winner, null, 'cut short without a score');
  assert.equal(raceStandings({}, [], false, 1).done, false, 'nobody to settle');
});

test('the host starts the next round only once it is over for everyone', () => {
  const free = { ready: true, waiting: false, racing: false };
  assert.equal(canStartNext(free), true);
  assert.equal(canStartNext({ ...free, ready: false }), false, 'nobody to play');
  assert.equal(canStartNext({ ...free, racing: true }), false, 'someone still racing');
  assert.equal(canStartNext({ ...free, racing: true }, true), true, 'unless the host insists');
  assert.equal(canStartNext({ ...free, waiting: true }), false, 'the host is out early and its game still runs the round');
  assert.equal(canStartNext({ ...free, waiting: true, racing: true }, true), false, 'which no insisting skips');
});

test('race packets are validated', () => {
  assert.deepEqual(parseRacePacket({ t: 'race', round: 2, score: 40 }), { t: 'race', round: 2, score: 40 });
  assert.deepEqual(parseRacePacket({ t: 'race', round: 2, score: null }), { t: 'race', round: 2, score: null });
  assert.equal(parseRacePacket({ t: 'race', round: 2, score: 'x' }), null);
  assert.equal(parseRacePacket({ t: 'race', round: 1.5, score: 1 }), null);
  assert.equal(parseRacePacket({ t: 'race', round: 1, score: Infinity }), null);
  assert.deepEqual(parseRacePacket({ t: 'race-all', round: 3, scores: { 0: 5, 1: null, x: 2, 99: 1, 2: 'no' } }), { t: 'race-all', round: 3, scores: { 0: 5, 1: null } });
  assert.equal(parseRacePacket(null), null);
  assert.equal(parseRacePacket({ t: 'move', round: 1 }), null);
});

test('a public room is listed while its host is in and someone can still join', () => {
  const room: RoomState = { code: 'ABCD', game: 'palmdrive', seats: 8, started: false, lateJoin: true, listed: true };
  const host = { seat: 0, name: 'Josh' };
  assert.deepEqual(roomListing(room, [host], 3), { code: 'ABCD', game: 'palmdrive', host: 'Josh', players: 1, bots: 3, seats: 8, started: false, lateJoin: true });
  assert.equal(roomListing({ ...room, listed: false }, [host], 0), null, 'private rooms stay off the list');
  assert.equal(roomListing(room, [{ seat: 1, name: 'Sam' }], 0), null, 'not without its host');
  const full = Array.from({ length: 8 }, (_, seat) => ({ seat, name: `P${seat}` }));
  assert.equal(roomListing(room, full, 0), null, 'not when people fill every seat');
  assert.equal(roomListing({ ...room, started: true }, [host], 0)?.started, true, 'a race people can join late stays listed');
  assert.equal(roomListing({ code: 'WXYZ', game: 'chess', seats: 2, started: true, listed: true }, [host], 0), null, 'a match under way locks the room');
  assert.equal(roomListing({ ...room, code: undefined }, [host], 0), null, 'rooms from before codes were kept');
});

test('open rooms list the ones still gathering first, then the busiest', () => {
  const base = { game: 'snake', host: 'h', bots: 0, seats: 4, lateJoin: false };
  const rooms: OpenRoom[] = [
    { ...base, code: 'AAAA', players: 1, started: true, lateJoin: true },
    { ...base, code: 'BBBB', players: 1, started: false },
    { ...base, code: 'CCCC', players: 3, started: false },
  ];
  assert.deepEqual(sortListings(rooms).map((r) => r.code), ['CCCC', 'BBBB', 'AAAA']);
});

test('only the host makes a room public, and the message is checked', () => {
  assert.deepEqual(parseRoomMessage('{"t":"listed","on":true}', 4), { t: 'listed', on: true });
  assert.deepEqual(parseRoomMessage('{"t":"listed","on":false}', 4), { t: 'listed', on: false });
  assert.equal(parseRoomMessage('{"t":"listed","on":1}', 4), null);
  assert.equal(parseRoomMessage('{"t":"listed"}', 4), null);
});

test('rooms hold up to twenty seats: each game keeps its own count, and nothing past the cap gets through', () => {
  assert.equal(MAX_SEATS, 20);
  for (const [game, spec] of Object.entries(ONLINE_SPECS)) assert.ok(spec.seats >= 2 && spec.seats <= MAX_SEATS, `${game}: ${spec.seats} seats`);
  assert.equal(ONLINE_SPECS.scramble.seats, 20);
  assert.equal(ONLINE_SPECS.pong.seats, 2, 'other games keep their own seats');
  assert.equal(seatsFor({ seats: 20 }), 20);
  assert.equal(seatsFor({ seats: 8 }), 8);
  assert.equal(seatsFor({ seats: 64 }), MAX_SEATS);
  assert.equal(seatsFor({ seats: 0 }), 2);
  // a full room of twenty: the lowest free seat, then none; bots fill the rest of the seats and step aside
  const people = Array.from({ length: 19 }, (_, i) => i);
  assert.equal(lowestFreeSeat(20, people), 19);
  assert.equal(lowestFreeSeat(20, [...people, 19]), null);
  assert.deepEqual(botSeats(20, [0, 3], 19), Array.from({ length: 20 }, (_, i) => i).filter((i) => i !== 0 && i !== 3).slice(0, 18));
  assert.deepEqual(parseRoomMessage('{"t":"msg","to":19,"d":1}', 20), { t: 'msg', to: 19, d: 1 });
  assert.equal(parseRoomMessage('{"t":"msg","to":20,"d":1}', 20), null);
  assert.deepEqual(parseRoomMessage('{"t":"bots","n":19}', 20), { t: 'bots', n: 19 });
  assert.equal(parseRoomMessage('{"t":"bots","n":20}', 20), null);
  const room = { code: 'ABCD', game: 'scramble', host: 'Josh', players: 12, bots: 8, seats: 20, started: true, lateJoin: true };
  assert.deepEqual(parseOpenRooms({ rooms: [room, { ...room, seats: 21 }] }), [room]);
  assert.equal(openRoomLine(room), '12/20 · 8 Bots · Playing');
  const race = parseRacePacket({ t: 'race-all', round: 1, scores: { 0: 5, 19: 7, 20: 9 } });
  assert.deepEqual(race, { t: 'race-all', round: 1, scores: { 0: 5, 19: 7 } });
});

test('open rooms from the Worker are checked before the arcade shows them', () => {
  const good = { code: 'ABCD', game: 'lightcycles', host: 'Josh', players: 2, bots: 1, seats: 4, started: false, lateJoin: false };
  assert.deepEqual(parseOpenRooms({ rooms: [good] }), [good]);
  assert.deepEqual(parseOpenRooms({ rooms: [{ ...good, code: 'abcd' }, { ...good, game: '../x' }, { ...good, players: 5 }, { ...good, seats: 1 }, { ...good, host: 3 }, null] }), []);
  assert.deepEqual(parseOpenRooms({ rooms: [{ ...good, started: 'yes', lateJoin: 1 }] }), [{ ...good, started: false, lateJoin: false }]);
  assert.equal(parseOpenRooms({ rooms: Array.from({ length: OPEN_ROOMS_MAX + 5 }, () => good) }).length, OPEN_ROOMS_MAX);
  assert.deepEqual(parseOpenRooms(null), []);
  assert.deepEqual(parseOpenRooms({ rooms: 'none' }), []);
  assert.equal(openRoomLine(good), '2/4 · 1 Bot');
  assert.equal(openRoomLine({ ...good, bots: 0, started: true }), '2/4 · Playing');
  assert.equal(openRoomDetail(good), '2/4 · 1 Bot · Waiting for players');
  assert.equal(openRoomDetail({ ...good, bots: 3, started: true }), '2/4 · 3 Bots · Playing, join for the next round');
});

test('invite links and Open Rooms open each game where it lives', () => {
  assert.deepEqual(roomApp('chess', 'ABCD'), { app: 'chrome', args: { url: 'chrome://games/chess?room=ABCD' } });
  assert.deepEqual(roomApp('coxbox', 'ABCD'), { app: 'coxbox', args: { room: 'ABCD' } });
  assert.deepEqual(roomApp('omok', 'ABCD'), { app: 'baduk', args: { game: 'omok', room: 'ABCD' } });
  assert.deepEqual(roomApp('go', 'ABCD'), { app: 'baduk', args: { game: 'go', room: 'ABCD' } });
  assert.deepEqual(roomApp('badminton', 'ABCD'), { app: 'badminton', args: { room: 'ABCD' } });
});

test('rooms are made public on request, and Open Rooms are read from the Worker', async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  try {
    globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${String(input)}`);
      if (String(input).includes('/rooms?game=pong&public=1') || String(input).endsWith('/rooms?game=pong')) {
        if (init?.method === 'POST') return new Response(JSON.stringify({ code: 'QRST' }));
      }
      return new Response(JSON.stringify({ rooms: [{ code: 'QRST', game: 'pong', host: 'Josh', players: 1, bots: 0, seats: 2, started: false, lateJoin: false }] }));
    }) as typeof fetch;
    assert.equal(await createRoom('pong', { listed: true }, 'https://arcade.test'), 'QRST');
    assert.equal(await createRoom('pong', {}, 'https://arcade.test/'), 'QRST');
    assert.equal((await listRooms('pong', 'https://arcade.test'))[0].host, 'Josh');
    await listRooms(undefined, 'https://arcade.test');
    assert.deepEqual(calls, [
      'POST https://arcade.test/rooms?game=pong&public=1',
      'POST https://arcade.test/rooms?game=pong',
      'GET https://arcade.test/rooms?game=pong',
      'GET https://arcade.test/rooms',
    ]);
    globalThis.fetch = (async () => new Response('{}', { status: 404 })) as typeof fetch;
    await assert.rejects(listRooms('pong', 'https://arcade.test'), 'a Worker from before Open Rooms');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('RoomLink follows whether the room is public, and the host can change it', async () => {
  await withFakeRoom(async () => {
    const link = new RoomLink('LMNP', 'Host', 'https://arcade.test');
    const socket = FakeWebSocket.last;
    const seen: boolean[] = [];
    link.on('listed', (on) => seen.push(on));
    socket.open();
    socket.receive({ t: 'welcome', seat: 0, code: 'LMNP', game: 'pong', seats: 2, players: [{ seat: 0, name: 'Host' }], listed: false, started: false });
    link.setListed(true);
    assert.deepEqual(JSON.parse(socket.sent.at(-1)!), { t: 'listed', on: true });
    socket.receive({ t: 'players', players: [{ seat: 0, name: 'Host' }], listed: true });
    socket.receive({ t: 'players', players: [{ seat: 0, name: 'Host' }, { seat: 1, name: 'Guest' }], listed: true });
    assert.deepEqual(seen, [false, true], 'only changes are announced');
    assert.equal(link.listed, true);
    link.close();
  });
});

test('game messages land in the round they were sent for', async () => {
  const router = new RoundRouter();
  const got: string[] = [];
  const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
  let stop = router.listen((from, d) => got.push(`old:${from}:${d}`));
  router.join(0);
  router.receive(0, tagRound(0, 'lobby'), false);
  router.begin(1);
  router.release();
  router.receive(0, tagRound(1, 'r1'), true);
  router.receive(0, 'untagged', true);
  // The host's next round overtakes this player's own start: it waits for the next game instead of hitting this one.
  router.receive(0, tagRound(2, 'early'), true);
  assert.deepEqual(got, ['old:0:lobby', 'old:0:r1', 'old:0:untagged']);
  router.begin(2);
  router.receive(0, tagRound(2, 'while mounting'), true);
  router.receive(0, tagRound(1, 'stale'), true);
  stop();
  stop = router.listen((from, d) => got.push(`new:${from}:${d}`));
  router.release();
  router.receive(0, tagRound(2, 'live'), true);
  assert.deepEqual(got.slice(3), ['new:0:early', 'new:0:while mounting', 'new:0:live']);
  // Someone sitting a round out sees it as it comes.
  router.receive(0, tagRound(5, 'spectating'), false);
  assert.equal(got.at(-1), 'new:0:spectating');
  // A game that subscribes late still gets what waited for it.
  stop();
  router.receive(1, tagRound(2, 'nobody listening'), true);
  router.listen((from, d) => got.push(`late:${from}:${d}`));
  await tick();
  assert.equal(got.at(-1), 'late:1:nobody listening');
});

test('a quick-play room gathers people until it starts on its own, sooner once people fill it, and plays one round', () => {
  const now = 1_000_000;
  const room: RoomState = { code: 'QQQQ', game: 'scramble', seats: 20, started: false, lateJoin: true, allowBots: true, bots: 19, listed: true, quick: true, startAt: now + GATHER_MS };
  assert.equal(gathering(room), true);
  assert.equal(gathering({ ...room, quick: false }), false, 'only quick rooms gather');
  // listed while it gathers, with when it starts
  const host = { seat: 0, name: 'Josh' };
  assert.deepEqual(roomListing(room, [host], 19), { code: 'QQQQ', game: 'scramble', host: 'Josh', players: 1, bots: 19, seats: 20, started: false, lateJoin: true, quick: true, startAt: now + GATHER_MS });
  // nineteen people: no change; twenty: it starts in a moment, and never later than it would have
  assert.equal(gatherFull(room, 19, now), false);
  assert.equal(room.startAt, now + GATHER_MS);
  assert.equal(gatherFull(room, 20, now), true);
  assert.equal(room.startAt, now + GATHER_FULL_MS);
  assert.equal(gatherFull(room, 20, now + 2000), false, 'a start already that close stays');
  // the alarm: its start, or the listing refresh when that comes first
  assert.equal(nextAlarm(room, false, null, now), now + GATHER_FULL_MS);
  assert.equal(nextAlarm(room, true, null, now), now + GATHER_FULL_MS);
  assert.equal(nextAlarm({ ...room, startAt: now + 90_000 }, true, null, now), now + LISTING_REFRESH_MS);
  assert.equal(nextAlarm({ ...room, startAt: now + 90_000 }, true, now + 5000, now), now + 5000, 'a refresh already due sooner is kept');
  // once its round begins it no longer gathers and comes off Open Rooms, and stays off once it is over
  beginRound(room, [0, 1], 18);
  assert.equal(gathering(room), false);
  assert.equal(roomListing(room, [host], 18), null);
  assert.equal(nextAlarm(room, false, null, now), null);
  endRound(room);
  assert.equal(gathering(room), false);
  assert.equal(roomListing(room, [host], 18), null, 'a finished quick room is nobody else\'s next match');
  // rooms of your own alarm only to refresh while listed
  const plain: RoomState = { code: 'PPPP', game: 'scramble', seats: 20, started: false, listed: true };
  assert.equal(nextAlarm(plain, true, null, now), now + LISTING_REFRESH_MS);
  assert.equal(nextAlarm(plain, false, now + 5000, now), null);
  assert.equal(roomListing(plain, [host], 0)?.quick, undefined, 'only quick rooms say they are');
});

test('quick play sends people to the fullest quick room still gathering, never one about to start, under way or full', () => {
  const now = 5_000_000;
  const line = (code: string, more: Partial<OpenRoom> = {}): LobbyRow => ({ listing: { code, game: 'scramble', host: 'H', players: 2, bots: 18, seats: 20, started: false, lateJoin: true, quick: true, startAt: now + 15_000, ...more }, updated: now - 1000 });
  assert.equal(pickQuick([], now), null);
  assert.equal(pickQuick([line('AAAA'), line('BBBB', { players: 5 }), line('CCCC', { players: 3 })], now)?.code, 'BBBB', 'the fullest, so rooms fill rather than split');
  assert.equal(pickQuick([line('AAAA', { startAt: now + 9000 }), line('BBBB')], now)?.code, 'AAAA', 'then the one starting soonest');
  const skipped = [
    line('DDDD', { quick: undefined }),
    line('EEEE', { started: true }),
    line('FFFF', { players: 20 }),
    line('GGGG', { startAt: now + QUICK_LATE_MS - 1 }),
    { ...line('HHHH', { host: '' }), updated: now - QUICK_PENDING_MS - 1 },
  ];
  assert.equal(pickQuick(skipped, now), null, 'a room of your own, under way, full, about to start, or handed out and never come to');
  // a room just handed out, before its first person is in, is where the next person goes too
  assert.equal(pickQuick([...skipped, { ...line('JJJJ', { host: '', players: 1 }), updated: now - 2000 }], now)?.code, 'JJJJ');
  // open rooms say which are quick play, and the line says so
  const listed = parseOpenRooms({ rooms: [line('KKKK').listing, { ...line('MMMM').listing, quick: 'yes' }] });
  assert.deepEqual(listed.map((r) => r.quick), [true, undefined]);
  assert.equal(openRoomLine(listed[0]), 'Quick Play · 2/20 · 18 Bots');
  assert.equal(openRoomDetail(listed[0]), 'Quick Play · 2/20 · 18 Bots · Starting soon');
  assert.deepEqual(ONLINE_SPECS.scramble, { seats: 20, lateJoin: true, bots: true, quick: true });
  for (const [game, spec] of Object.entries(ONLINE_SPECS)) if (spec.quick) assert.ok(spec.bots, `${game}: quick play fills seats with bots`);
});

test('RoomLink follows a quick-play room gathering and starting, and quick play asks the Worker for a room', async () => {
  await withFakeRoom(async () => {
    const link = new RoomLink('QWKR', 'Bea', 'https://arcade.test');
    const socket = FakeWebSocket.last;
    const seen: unknown[] = [];
    link.on('welcome', (w) => seen.push(['welcome', w.quick, w.startIn]));
    link.on('gather', (ms) => seen.push(['gather', ms]));
    socket.open();
    socket.receive({ t: 'welcome', seat: 1, code: 'QWKR', game: 'scramble', seats: 20, players: [{ seat: 0, name: 'Ann' }, { seat: 1, name: 'Bea' }], bots: [2], started: false, round: 0, quick: true, startIn: 14_000 });
    socket.receive({ t: 'players', players: [{ seat: 0, name: 'Ann' }, { seat: 1, name: 'Bea' }, { seat: 2, name: 'Cy' }], bots: [3], quick: true, startIn: 9_000 });
    // a nonsense time is held to a minute; once it starts there is none
    socket.receive({ t: 'players', players: [{ seat: 0, name: 'Ann' }, { seat: 1, name: 'Bea' }], quick: true, startIn: 1e12 });
    socket.receive({ t: 'start', round: 1, players: [{ seat: 0, name: 'Ann' }, { seat: 1, name: 'Bea' }], bots: [2, 3], quick: true });
    socket.receive({ t: 'players', players: [{ seat: 0, name: 'Ann' }, { seat: 1, name: 'Bea' }], quick: true, started: true });
    assert.equal(link.quick, true);
    assert.deepEqual(seen, [['welcome', true, 14_000], ['gather', 14_000], ['gather', 9_000], ['gather', 60_000], ['gather', null]]);
    link.close();
    // a room of your own never says it gathers
    const own = new RoomLink('WWNN', 'Bea', 'https://arcade.test');
    const ownSocket = FakeWebSocket.last;
    const ownSeen: unknown[] = [];
    own.on('welcome', (w) => ownSeen.push([w.quick, w.startIn]));
    own.on('gather', (ms) => ownSeen.push(['gather', ms]));
    ownSocket.open();
    ownSocket.receive({ t: 'welcome', seat: 0, code: 'WWNN', game: 'scramble', seats: 20, players: [{ seat: 0, name: 'Bea' }], started: false, startIn: 5000 });
    assert.deepEqual(ownSeen, [[false, null]]);
    own.close();
  });
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  try {
    globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${String(input)}`);
      return new Response(JSON.stringify({ code: 'QWKR' }));
    }) as typeof fetch;
    assert.equal(await quickRoom('scramble', 'https://arcade.test/'), 'QWKR');
    assert.deepEqual(calls, ['POST https://arcade.test/rooms/quick?game=scramble']);
    globalThis.fetch = (async () => new Response(JSON.stringify({ code: 'nope' }))) as typeof fetch;
    await assert.rejects(quickRoom('scramble', 'https://arcade.test'), /Invalid Room Code/);
    globalThis.fetch = (async () => new Response('{}', { status: 404 })) as typeof fetch;
    await assert.rejects(quickRoom('scramble', 'https://arcade.test'), /Could Not Find A Match/, 'a Worker from before quick play');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('people can watch a room when its game allows it and its host lets them, up to a limit', () => {
  const room: RoomState = { code: 'ABCD', game: 'pong', seats: 2, started: true, listed: true, watch: true, watchable: true };
  assert.equal(canWatchRoom(room, 0), true);
  assert.equal(canWatchRoom(room, WATCHERS_MAX), false, 'a room takes so many spectators at most');
  assert.equal(canWatchRoom({ ...room, watchable: false }, 0), false, 'the host turned it off');
  assert.equal(canWatchRoom({ ...room, watch: undefined, watchable: undefined }, 0), false, 'a game nobody can watch');
  assert.equal(canWatchRoom({ ...room, watchable: undefined }, 0), true, 'on unless the host says otherwise');
});

test('a room nobody can join stays in Open Rooms to watch while it plays a round people can watch', () => {
  const host = { seat: 0, name: 'Josh' };
  const guest = { seat: 1, name: 'Sam' };
  const pong: RoomState = { code: 'PPPP', game: 'pong', seats: 2, started: false, listed: true, watch: true, watchable: true };
  assert.equal(joinable(pong, 1), true);
  assert.equal(roomListing(pong, [host], 0)?.watchOnly, undefined, 'a seat free and waiting: join it');
  assert.equal(roomListing(pong, [host], 0)?.watch, true, 'and say it can be watched');
  assert.equal(roomListing(pong, [host, guest], 0), null, 'full and waiting to start: nothing to see yet');
  const playing = { ...pong, started: true };
  assert.equal(joinable(playing, 2), false);
  assert.deepEqual(roomListing(playing, [host, guest], 0), { code: 'PPPP', game: 'pong', host: 'Josh', players: 2, bots: 0, seats: 2, started: true, lateJoin: false, watch: true, watchOnly: true });
  assert.equal(roomListing({ ...playing, watchable: false }, [host, guest], 0), null, 'not once the host turns watching off');
  assert.equal(roomListing(playing, [host, guest], 0, WATCHERS_MAX), null, 'nor once it holds every spectator it can');
  assert.equal(roomListing({ ...playing, listed: false }, [host, guest], 0), null, 'private rooms stay off the list');
  // a quick match under way: not to join, but to watch
  const quick: RoomState = { code: 'QQQQ', game: 'sumo', seats: 8, started: true, lateJoin: true, listed: true, quick: true, round: 1, watch: true, watchable: true };
  assert.equal(joinable(quick, 1), false);
  assert.equal(roomListing(quick, [host], 7)?.watchOnly, true);
  assert.equal(roomListing({ ...quick, watch: undefined }, [host], 7), null);
  assert.equal(openRoomAction(roomListing(playing, [host, guest], 0)!), 'Watch');
  assert.equal(openRoomAction(roomListing(pong, [host], 0)!), 'Join');
  assert.match(openRoomDetail(roomListing(playing, [host, guest], 0)!), /watch it live/);
});

test('rooms only to watch come last in Open Rooms, and quick play never sends anyone to one', () => {
  const base = { game: 'sumo', host: 'h', bots: 0, seats: 8, lateJoin: true };
  const rooms: OpenRoom[] = [
    { ...base, code: 'AAAA', players: 5, started: true, watch: true, watchOnly: true },
    { ...base, code: 'BBBB', players: 1, started: false },
  ];
  assert.deepEqual(sortListings(rooms).map((r) => r.code), ['BBBB', 'AAAA']);
  const now = 1_000_000;
  const row = { listing: { ...base, code: 'CCCC', players: 2, started: false, quick: true as const, startAt: now + 10_000, watch: true as const, watchOnly: true as const }, updated: now };
  assert.equal(pickQuick([row], now), null);
  assert.equal(pickQuick([{ ...row, listing: { ...row.listing, watchOnly: undefined } }], now)?.code, 'CCCC');
  // what the Worker sends is checked: watchOnly only means something for a room people can watch
  const parsed = parseOpenRooms({ rooms: [{ ...base, code: 'DDDD', players: 2, started: true, watch: true, watchOnly: true }, { ...base, code: 'EEEE', players: 2, started: true, watchOnly: true }] });
  assert.deepEqual(parsed.map((r) => [r.code, r.watch, r.watchOnly]), [['DDDD', true, true], ['EEEE', undefined, undefined]]);
});

test('only the host turns watching on or off and shares with spectators, and both messages are checked', () => {
  assert.deepEqual(parseRoomMessage('{"t":"watchable","on":false}', 2), { t: 'watchable', on: false });
  assert.equal(parseRoomMessage('{"t":"watchable","on":"no"}', 2), null);
  assert.deepEqual(parseRoomMessage('{"t":"watch","d":{"k":"S"}}', 2), { t: 'watch', d: { k: 'S' } });
  assert.equal(parseRoomMessage('{"t":"watch"}', 2), null);
});

test('RoomLink watches as a spectator: no seat, nothing sent, and the room round it walks into', async () => {
  await withFakeRoom(async () => {
    const link = new RoomLink('PPPP', 'Ana', 'https://arcade.test', { watch: true });
    const socket = FakeWebSocket.last;
    assert.equal(socket.url.href, 'wss://arcade.test/rooms/PPPP/ws?name=Ana&v=3&watch=1');
    const seen: unknown[] = [];
    link.on('welcome', (w) => seen.push(['welcome', w.seat, w.watching, w.started, w.round]));
    link.on('watchers', (w) => seen.push(['watchers', w.names, w.on]));
    link.on('host', (h) => seen.push(['host', h.seat]));
    socket.open();
    socket.receive({ t: 'welcome', seat: -1, watch: true, code: 'PPPP', game: 'pong', seats: 2, players: [{ seat: 0, name: 'Josh' }, { seat: 1, name: 'Sam' }], started: true, round: 3, watchers: ['Ana'], watchable: true });
    assert.equal(link.seat, null, 'a spectator holds no seat');
    link.send({ paddle: 1 });
    link.reportResult(3, 0);
    link.start();
    assert.deepEqual(socket.sent, [], 'and sends nothing');
    socket.receive({ t: 'host', from: 1, players: [{ seat: 0, name: 'Sam' }], watchers: ['Ana', 'Bo'], watchable: true });
    assert.deepEqual(seen, [['welcome', -1, true, true, 3], ['watchers', ['Ana'], true], ['host', -1], ['watchers', ['Ana', 'Bo'], true]]);
    link.close();
  });
});

test('RoomLink shares what the host broadcasts with spectators, fast snapshots a few times a second', async () => {
  await withFakeRoom(async () => {
    const link = new RoomLink('PPPP', 'Josh', 'https://arcade.test');
    const socket = FakeWebSocket.last;
    socket.open();
    socket.receive({ t: 'welcome', seat: 0, code: 'PPPP', game: 'pong', seats: 2, players: [{ seat: 0, name: 'Josh' }], watchers: [], watchable: true });
    link.send(tagRound(1, { type: 'snapshot' }), { fast: true });
    assert.deepEqual(socket.sent, [], 'nobody watching, nothing extra');
    socket.receive({ t: 'players', players: [{ seat: 0, name: 'Josh' }], watchers: ['Ana'], watchable: true });
    link.send(tagRound(1, { type: 'snapshot' }), { fast: true });
    link.send(tagRound(1, { type: 'snapshot' }), { fast: true });
    link.send(tagRound(1, { type: 'events' }), { fast: true });
    link.send(tagRound(1, { type: 'score' }));
    link.send(tagRound(1, { type: 'private' }), { to: 1 });
    const watch = socket.sent.map((m) => JSON.parse(m)).filter((m) => m.t === 'watch').map((m) => m.d.d.type);
    assert.deepEqual(watch, ['snapshot', 'events', 'score'], 'one snapshot of each kind per moment, every reliable one, never one meant for a seat');
    link.setWatchable(false);
    assert.deepEqual(JSON.parse(socket.sent.at(-1)!), { t: 'watchable', on: false });
    link.close();
  });
});

test('RoomLink says why a room turned it away, and whether it could watch instead', async () => {
  await withFakeRoom(async () => {
    const link = new RoomLink('PPPP', 'Ana', 'https://arcade.test');
    const socket = FakeWebSocket.last;
    const closed: unknown[] = [];
    link.on('closed', (c) => closed.push(c));
    socket.open();
    socket.receive({ t: 'closed', reason: 'started', watch: true });
    socket.emit('close', {});
    assert.deepEqual(closed, [{ reason: 'started', watch: true }], 'said once, not again as a lost connection');
    assert.equal(socket.closed, true);
  });
});

test('quick play keeps a game’s pools apart (its modes, say): each person goes to a room gathering for theirs, and the room says which it is', async () => {
  const now = 5_000_000;
  const line = (code: string, more: Partial<OpenRoom> = {}): LobbyRow => ({ listing: { code, game: 'scramble', host: 'H', players: 2, bots: 18, seats: 20, started: false, lateJoin: true, quick: true, startAt: now + 15_000, ...more }, updated: now - 1000 });
  const rows = [line('SOLO', { players: 9 }), line('DUOS', { pool: 'duos', players: 3 }), line('SQAD', { pool: 'squads' }), line('DUO2', { pool: 'duos', players: 6 })];
  assert.equal(pickQuick(rows, now)?.code, 'SOLO', 'no pool: the rooms without one (as before pools)');
  assert.equal(pickQuick(rows, now, 'duos')?.code, 'DUO2', 'the fullest of the pool');
  assert.equal(pickQuick(rows, now, 'squads')?.code, 'SQAD');
  assert.equal(pickQuick(rows, now, 'trios'), null, 'a pool nobody gathers for: a new room');
  assert.ok(isPool('duos') && isPool('a-b-1') && !isPool('') && !isPool('Duos') && !isPool('x'.repeat(17)) && !isPool(3));
  // a quick room's line says its pool, and Open Rooms shows it
  const host = { seat: 0, name: 'Ann' };
  const room: RoomState = { code: 'QQQQ', game: 'scramble', seats: 20, started: false, lateJoin: true, allowBots: true, bots: 19, listed: true, quick: true, startAt: now + GATHER_MS, pool: 'duos' };
  assert.equal(roomListing(room, [host], 19)?.pool, 'duos');
  assert.equal(roomListing({ ...room, pool: undefined }, [host], 19)?.pool, undefined);
  const listed = parseOpenRooms({ rooms: [roomListing(room, [host], 19), { ...roomListing(room, [host], 19), pool: 'BAD POOL' }] });
  assert.deepEqual(listed.map((r) => r.pool), ['duos', undefined]);
  assert.equal(openRoomLine(listed[0]), 'Quick Play Duos · 1/20 · 19 Bots');
  // RoomLink hears the pool of the room it's in, and quick play asks the Worker for a room in a pool
  await withFakeRoom(async () => {
    const link = new RoomLink('QDUO', 'Bea', 'https://arcade.test');
    const socket = FakeWebSocket.last;
    socket.open();
    socket.receive({ t: 'welcome', seat: 1, code: 'QDUO', game: 'scramble', seats: 20, players: [{ seat: 0, name: 'Ann' }, { seat: 1, name: 'Bea' }], started: false, round: 0, quick: true, startIn: 14_000, pool: 'duos' });
    assert.equal(link.pool, 'duos');
    link.close();
    const own = new RoomLink('WWNN', 'Bea', 'https://arcade.test');
    FakeWebSocket.last.open();
    FakeWebSocket.last.receive({ t: 'welcome', seat: 0, code: 'WWNN', game: 'scramble', seats: 20, players: [{ seat: 0, name: 'Bea' }], started: false, pool: 'duos' });
    assert.equal(own.pool, '', 'only a quick room has a pool');
    own.close();
  });
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  try {
    globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${String(input)}`);
      return new Response(JSON.stringify({ code: 'QWKR' }));
    }) as typeof fetch;
    assert.equal(await quickRoom('scramble', 'https://arcade.test/', 'squads'), 'QWKR');
    assert.equal(await quickRoom('scramble', 'https://arcade.test/'), 'QWKR');
    assert.deepEqual(calls, ['POST https://arcade.test/rooms/quick?game=scramble&pool=squads', 'POST https://arcade.test/rooms/quick?game=scramble']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a team’s win: every seat on it is reported, and once everyone agrees each person on it is recorded', async () => {
  assert.deepEqual(parseRoomMessage('{"t":"result","round":2,"winner":1,"team":[3,1]}', 4), { t: 'result', round: 2, winner: 1, team: [1, 3] });
  for (const bad of ['{"t":"result","round":2,"winner":1,"team":[3]}', '{"t":"result","round":2,"winner":1,"team":[1,1]}', '{"t":"result","round":2,"winner":1,"team":[1,9]}', '{"t":"result","round":2,"winner":null,"team":[1]}', '{"t":"result","round":2,"winner":1,"team":[]}', '{"t":"result","round":2,"winner":1,"team":"1"}'])
    assert.equal(parseRoomMessage(bad, 4), null, bad);
  const reports = { '1': { '0': [1, 3], '1': [1, 3], '3': [1, 3] } };
  assert.deepEqual(agreedWinners(reports, [0, 1, 3], 1), [1, 3]);
  assert.equal(agreedWinner(reports, [0, 1, 3], 1), 1);
  assert.equal(agreedWinners({ '1': { '0': [1, 3], '1': [1] } }, [0, 1], 1), null, 'they must agree on the whole team');
  assert.deepEqual(agreedWinners({ '1': { '0': 2, '2': 2 } }, [0, 2], 1), [2], 'one winner, as before');
  await withFakeRoom(async () => {
    const link = new RoomLink('TEAM', 'Bea', 'https://arcade.test');
    const socket = FakeWebSocket.last;
    socket.open();
    socket.receive({ t: 'welcome', seat: 1, code: 'TEAM', game: 'scramble', seats: 20, players: [{ seat: 0, name: 'Ann' }, { seat: 1, name: 'Bea' }], started: true, round: 1 });
    link.reportResult(1, 1, [0, 1]);
    assert.deepEqual(JSON.parse(socket.sent.at(-1)!), { t: 'result', round: 1, winner: 1, team: [0, 1] });
    link.reportResult(1, 1);
    assert.deepEqual(JSON.parse(socket.sent.at(-1)!), { t: 'result', round: 1, winner: 1 });
    link.close();
  });
});
