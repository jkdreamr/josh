import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { appGames } from '../src/os/arcade/apps.ts';
import { PREVIEW, PREVIEW_MAX, parseBoardTops, previewSize, topsOf, type BoardEntry } from '../src/os/arcade/kit/leaderboard-core.ts';
import { getBoardTops, getWins, WINS_UNAVAILABLE } from '../src/os/arcade/kit/leaderboard.ts';
import { boardCards, defaultBoard, measureOf, type CardBoard } from '../src/os/arcade/leaderboard-cards.ts';
import type { GameMeta, LeaderboardSpec } from '../src/os/arcade/types.ts';
import { LEADERBOARD_SPECS, ONLINE_SPECS } from '../worker/src/specs.gen.ts';

const entry = (name: string, score: number, date = '2026-01-01T00:00:00.000Z'): BoardEntry => ({ name, score, date });
const names = (list: BoardEntry[] | undefined) => (list ?? []).map((e) => e.name);
const desc: LeaderboardSpec = { order: 'desc', max: 1000 };
const asc: LeaderboardSpec = { order: 'asc', min: 3000, max: 60000, format: 'time' };

test('the preview size defaults to three and stays between one and ten', () => {
  assert.equal(PREVIEW, 3);
  assert.equal(PREVIEW_MAX, 10);
  for (const [raw, n] of [[null, 3], [undefined, 3], ['', 3], ['abc', 3], ['2.5', 3], ['5', 5], ['10', 10], ['50', 10], ['0', 1], ['-4', 1]] as const) {
    assert.equal(previewSize(raw), n, String(raw));
  }
});

test('tops pick the best few of each board by its order and drop bad entries', () => {
  const lists = {
    snake: [entry('c', 10), entry('a', 90), { name: 'bad' }, entry('b', 50), entry('d', 5)],
    cube: [entry('slow', 9000), entry('fast', 4000), entry('tie-late', 6000, '2026-02-01'), entry('tie-early', 6000, '2026-01-02')],
    stray: [entry('x', 1)],
  };
  const tops = topsOf(lists, { snake: 'desc', cube: 'asc', empty: 'desc' });
  assert.deepEqual(names(tops.snake), ['a', 'b', 'c']);
  assert.deepEqual(names(tops.cube), ['fast', 'tie-early', 'tie-late']);
  assert.deepEqual(tops.empty, [], 'boards missing from the lists come back empty');
  assert.equal(tops.stray, undefined, 'boards the page does not know are left out');
  assert.deepEqual(names(topsOf(lists, { snake: 'desc' }, 1).snake), ['a']);
  assert.deepEqual(topsOf({ snake: 'not a list' }, { snake: 'desc' }).snake, []);
  assert.deepEqual(names(topsOf(Object.create({ snake: [entry('inherited', 1)] }), { snake: 'desc' }).snake), []);
});

test('a /leaderboard/top body parses into score boards and Online Wins', () => {
  const body = {
    boards: { snake: [entry('Ana', 40), entry('Josh', 80)], cube: [] },
    wins: { chess: [entry('Kim', 2), entry('Lee', 7), { name: 'bad', score: 'x' }], pong: 'nope' },
  };
  const tops = parseBoardTops(body, { snake: 'desc', cube: 'asc', dino: 'desc' }, ['chess', 'pong']);
  assert.ok(tops);
  assert.deepEqual(names(tops.boards.snake), ['Josh', 'Ana']);
  assert.deepEqual(tops.boards.cube, []);
  assert.deepEqual(tops.boards.dino, [], 'a board the deployed Worker does not have yet is empty');
  assert.deepEqual(names(tops.wins.chess), ['Lee', 'Kim'], 'most wins first');
  assert.deepEqual(tops.wins.pong, []);
  for (const bad of [null, [], 'x', {}, { boards: {} }, { boards: [], wins: {} }, { boards: {}, wins: [] }, { entries: [] }]) {
    assert.equal(parseBoardTops(bad, { snake: 'desc' }, ['chess']), null, JSON.stringify(bad));
  }
});

const realFetch = globalThis.fetch;
let store: Map<string, string>;
beforeEach(() => {
  store = new Map();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

const specs = { snake: desc, cube: asc };
const device = { snake: [entry('Mine', 12), entry('Best', 99)], cube: [entry('Quick', 5000)], unknown: [entry('x', 1)] };

test('the overview falls back to this device without calling an empty API', async () => {
  store.set('arcade:boards', JSON.stringify(device));
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({ boards: {}, wins: {} });
  };
  const tops = await getBoardTops(specs, ['chess'], '');
  assert.equal(calls, 0);
  assert.equal(tops.scope, 'device');
  assert.deepEqual(names(tops.boards.snake), ['Best', 'Mine']);
  assert.deepEqual(names(tops.boards.cube), ['Quick']);
  assert.equal(tops.boards.unknown, undefined);
  assert.equal(tops.wins, null, 'Online Wins only exist on the Worker');
});

test('the overview falls back to this device when the Worker is offline, old or answers nonsense', async () => {
  store.set('arcade:boards', JSON.stringify(device));
  const answers: (() => Promise<Response>)[] = [
    async () => {
      throw new TypeError('offline');
    },
    async () => Response.json({ error: 'not found' }, { status: 404 }),
    async () => Response.json({ error: 'unavailable' }, { status: 503 }),
    async () => Response.json({ entries: [] }),
    async () => new Response('<html>', { status: 200 }),
  ];
  for (const answer of answers) {
    globalThis.fetch = answer;
    const tops = await getBoardTops(specs, ['chess'], 'https://arcade.test');
    assert.equal(tops.scope, 'device');
    assert.deepEqual(names(tops.boards.snake), ['Best', 'Mine']);
    assert.equal(tops.wins, null);
  }
});

test('the overview reads every board from the Worker in one request', async () => {
  store.set('arcade:boards', JSON.stringify(device));
  const urls: string[] = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return Response.json({ boards: { snake: [entry('Ana', 40)], cube: [entry('Kim', 7000), entry('Lee', 4100)] }, wins: { chess: [entry('Josh', 3)] } });
  };
  const tops = await getBoardTops(specs, ['chess', 'pong'], 'https://arcade.test');
  assert.deepEqual(urls, ['https://arcade.test/leaderboard/top']);
  assert.equal(tops.scope, 'global');
  assert.deepEqual(names(tops.boards.snake), ['Ana'], 'global boards, not this device');
  assert.deepEqual(names(tops.boards.cube), ['Lee', 'Kim']);
  assert.deepEqual(names(tops.wins?.chess), ['Josh']);
  assert.deepEqual(tops.wins?.pong, []);
});

test('Online Wins boards load from /wins and report when they are unavailable', async () => {
  assert.deepEqual(await getWins('chess', ''), { entries: [], scope: 'global', error: WINS_UNAVAILABLE });
  const urls: string[] = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return Response.json({ entries: [entry('Josh', 3), { name: 'bad' }] });
  };
  const board = await getWins('connect4', 'https://arcade.test');
  assert.deepEqual(urls, ['https://arcade.test/wins?game=connect4']);
  assert.deepEqual(board, { entries: [entry('Josh', 3)], scope: 'global' });
  globalThis.fetch = async () => new Response('{"error":"unknown game"}', { status: 404 });
  assert.equal((await getWins('connect4', 'https://arcade.test')).error, WINS_UNAVAILABLE);
});

const gamesDir = join(import.meta.dirname, '..', 'src', 'os', 'arcade', 'games');
const metas: GameMeta[] = [];
for (const id of readdirSync(gamesDir).filter((d) => !d.startsWith('_'))) metas.push((await import(pathToFileURL(join(gamesDir, id, 'meta.ts')).href)).meta);
const cards = boardCards([...metas, ...appGames]);
const scoreCards = cards.filter((card) => card.kind === 'score');
const winsCards = cards.filter((card) => card.kind === 'wins');

test('every board the Worker knows is on exactly one card', () => {
  const scoreIds = scoreCards.flatMap((card) => card.boards.map((board) => board.id));
  assert.deepEqual([...scoreIds].sort(), Object.keys(LEADERBOARD_SPECS).sort());
  assert.deepEqual(winsCards.flatMap((card) => card.boards.map((board) => board.id)).sort(), Object.keys(ONLINE_SPECS).sort());
  for (const list of [scoreCards, winsCards]) assert.equal(new Set(list.map((card) => card.key)).size, list.length, 'card keys are unique per kind');
  for (const card of scoreCards) for (const board of card.boards) assert.deepEqual(board.spec, LEADERBOARD_SPECS[board.id], board.id);
  for (const card of winsCards) assert.deepEqual(card.boards.map((board) => board.spec), [undefined]);
  for (const card of cards) {
    assert.match(card.accent, /^#[0-9a-f]{6}$/i, card.title);
    assert.ok(card.glyph.startsWith('M'), card.title);
    assert.ok(['arcade', 'puzzle', '3d', 'multiplayer', 'party', 'drinking'].includes(card.category), card.title);
  }
});

test('a game is one card, with its variants as boards', () => {
  const go = scoreCards.filter((card) => card.title === 'Go');
  assert.equal(go.length, 1, "Go's three board sizes share a card");
  assert.equal(go[0].boards.length, 18);
  assert.deepEqual(go[0].boards.slice(0, 2).map((b) => [b.id, b.label]), [['go-beginner', '9×9 Beginner'], ['go-novice', '9×9 Novice']]);
  assert.deepEqual(go[0].boards.at(-1), { id: 'go19-strong', label: '19×19 Master', spec: LEADERBOARD_SPECS['go19-strong'] });
  assert.equal(go[0].category, 'multiplayer');
  const sudoku = scoreCards.find((card) => card.key === 'sudoku')!;
  assert.deepEqual(sudoku.boards.map((b) => b.label), ['Easy', 'Medium', 'Hard']);
  assert.equal(sudoku.measure, 'Fastest Solve');
  assert.deepEqual(scoreCards.find((card) => card.key === 'snake')!.boards.map((b) => [b.id, b.label]), [['snake', 'Snake']]);
  assert.equal(scoreCards.find((card) => card.key === 'cube')!.measure, 'Best Time');
  assert.equal(measureOf(desc), 'Top Score');
  assert.ok(winsCards.every((card) => card.measure === 'Online Wins'));
});

test('a card opens on the variant with the most entries, else the first', () => {
  const boards: CardBoard[] = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }];
  assert.equal(defaultBoard(boards, null).id, 'a');
  assert.equal(defaultBoard(boards, {}).id, 'a');
  assert.equal(defaultBoard(boards, { a: [], b: [], c: [] }).id, 'a');
  assert.equal(defaultBoard(boards, { b: [entry('x', 1)], c: [entry('y', 1)] }).id, 'b');
  assert.equal(defaultBoard(boards, { a: [entry('x', 1)], c: [entry('y', 1), entry('z', 2)] }).id, 'c');
});
