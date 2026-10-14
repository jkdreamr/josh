import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advanceOnlineRound, botPlayers, nextOnlineRound, parseRacePacket, raceStandings } from '../src/os/arcade/kit/online-core.ts';
import { RoomLink, ROOM_CODE_ALPHABET, makeRoomCode } from '../src/os/arcade/kit/room.ts';
import { agreedWinner, beginRound, benchSeat, botSeats, canJoinRoom, canStartRoom, lowestFreeSeat, markRoundRecorded, parseRoomMessage, roundSeats, type RoomState } from '../worker/src/room-core.ts';

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
    assert.equal(socket.url.href, 'wss://arcade.test/rooms/ABCD/ws?name=Guest');
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
