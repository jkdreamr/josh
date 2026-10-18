import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import {
  TOP,
  cleanName,
  deviceBoard,
  formatBoardScore,
  getBoard,
  qualifies,
  rankEntries,
  submitScore,
  validateSubmission,
  type BoardEntry,
} from '../src/os/arcade/kit/leaderboard.ts';
import { boardOwners, generateArcadeSpecs } from '../scripts/arcade-specs.ts';
import { appGames } from '../src/os/arcade/apps.ts';
import { boardFor, boardsOf } from '../src/os/arcade/kit/leaderboard-core.ts';
import { MAX_SEATS } from '../src/os/arcade/kit/online-core.ts';
import type { GameMeta, LeaderboardSpec } from '../src/os/arcade/types.ts';
import { LEADERBOARD_SPECS, ONLINE_SPECS } from '../worker/src/specs.gen.ts';

const desc: LeaderboardSpec = { order: 'desc', max: 1000 };
const asc: LeaderboardSpec = { order: 'asc', min: 3000, max: 60000, format: 'time' };
const specs = { snake: desc, cube: asc };
const entry = (name: string, score: number, date = '2026-01-01T00:00:00.000Z'): BoardEntry => ({ name, score, date });

test('validation accepts a clean submission and sanitizes the name', () => {
  assert.deepEqual(validateSubmission({ game: 'snake', name: '  Jo\u0000sh \u200b  K  ', score: 120 }, specs).value, { game: 'snake', name: 'Josh K', score: 120 });
});

test('validation rejects unknown games, bad bodies and inherited keys', () => {
  for (const body of [null, [], 'x', { game: 'chess', name: 'a', score: 1 }, { game: 'toString', name: 'a', score: 1 }, { name: 'a', score: 1 }]) {
    assert.ok(validateSubmission(body, specs).error, JSON.stringify(body));
  }
});

test('validation rejects non-finite and implausible scores', () => {
  for (const score of [NaN, Infinity, -1, 0, 1001, '10', null]) assert.equal(validateSubmission({ game: 'snake', name: 'a', score }, specs).error, 'invalid score');
  assert.equal(validateSubmission({ game: 'cube', name: 'a', score: 1200 }, specs).error, 'invalid score');
  assert.ok(validateSubmission({ game: 'cube', name: 'a', score: 3000 }, specs).value);
  assert.ok(validateSubmission({ game: 'snake', name: 'a', score: 1000 }, specs).value);
});

test('names must be 1 to 16 characters after cleaning', () => {
  assert.equal(validateSubmission({ game: 'snake', name: ' \u0007 ', score: 1 }, specs).error, 'invalid name');
  assert.equal(validateSubmission({ game: 'snake', name: 'a'.repeat(17), score: 1 }, specs).error, 'invalid name');
  assert.equal(validateSubmission({ game: 'snake', name: 42, score: 1 }, specs).error, 'invalid name');
  assert.ok(validateSubmission({ game: 'snake', name: '🏆'.repeat(16), score: 1 }, specs).value);
  assert.equal(cleanName('a\u202eb\nc'), 'ab c');
});

test('ranking orders by score, breaks ties by earliest date and keeps the top 100', () => {
  const list = [entry('late', 50, '2026-02-01'), entry('early', 50, '2026-01-01'), entry('top', 90), ...Array.from({ length: TOP + 2 }, (_, i) => entry(`p${i}`, i % 40))];
  const ranked = rankEntries(list, 'desc');
  assert.equal(ranked.length, TOP);
  assert.deepEqual(ranked.slice(0, 3).map((e) => e.name), ['top', 'early', 'late']);
  assert.deepEqual(rankEntries([entry('slow', 9000), entry('fast', 4000)], 'asc').map((e) => e.name), ['fast', 'slow']);
});

test('qualifies only when the score beats the last place or the board has room', () => {
  const full = Array.from({ length: TOP }, (_, i) => entry(`p${i}`, (i + 1) * 10));
  assert.equal(qualifies(5, [], desc), true);
  assert.equal(qualifies(0, [], desc), false);
  assert.equal(qualifies(10, full, desc), false);
  assert.equal(qualifies(11, full, desc), true);
  assert.equal(qualifies(5000, full, desc), false);
  const times = Array.from({ length: TOP }, (_, i) => entry(`p${i}`, 4000 + i * 500));
  assert.equal(qualifies(4000 + (TOP - 1) * 500, times, asc), false);
  assert.equal(qualifies(4000 + (TOP - 1) * 500 - 1, times, asc), true);
});

test('time boards format milliseconds as seconds', () => {
  assert.equal(formatBoardScore(45321, asc), '45.32s');
  assert.equal(formatBoardScore(65400, asc), '1:05.40s');
  assert.equal(formatBoardScore(12345, desc), '12,345');
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

test('an empty API URL never calls fetch and keeps the device board', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response('{"entries":[]}');
  };
  assert.deepEqual(await getBoard('snake', desc, ''), { entries: [], scope: 'device' });
  const saved = await submitScore('snake', desc, ' Josh ', 40, '');
  assert.equal(saved.scope, 'device');
  assert.deepEqual(saved.entries.map((e) => [e.name, e.score]), [['Josh', 40]]);
  assert.equal(calls, 0);
});

test('falls back to the device board when the API is offline', async () => {
  globalThis.fetch = async () => {
    throw new TypeError('offline');
  };
  const saved = await submitScore('snake', desc, ' Josh ', 40, 'https://arcade.test');
  assert.equal(saved.scope, 'device');
  assert.deepEqual(saved.entries.map((e) => [e.name, e.score]), [['Josh', 40]]);
  await submitScore('snake', desc, 'Ana', 70, 'https://arcade.test');
  const board = await getBoard('snake', desc, 'https://arcade.test');
  assert.equal(board.scope, 'device');
  assert.deepEqual(board.entries.map((e) => e.name), ['Ana', 'Josh']);
  assert.deepEqual(deviceBoard('cube', asc), []);
});

test('uses the global board when the API answers', async () => {
  const calls: { url: string; body?: string }[] = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: init?.body as string | undefined });
    return Response.json({ entries: [entry('Josh', 80), { name: 'bad' }, entry('Ana', 120)] });
  };
  const api = 'https://arcade.test';
  const board = await getBoard('snake', desc, api);
  assert.equal(board.scope, 'global');
  assert.deepEqual(board.entries.map((e) => e.name), ['Ana', 'Josh']);
  assert.equal(calls[0].url, `${api}/leaderboard?game=snake`);
  const saved = await submitScore('snake', desc, 'Josh', 80, api);
  assert.equal(saved.scope, 'global');
  assert.equal(calls[1].url, `${api}/leaderboard`);
  assert.deepEqual(JSON.parse(calls[1].body!), { game: 'snake', name: 'Josh', score: 80 });
  assert.equal(deviceBoard('snake', desc).length, 1, 'also kept on this device');
});

test('a rejected global submission reports why and shows the device board', async () => {
  globalThis.fetch = async (url) => {
    assert.equal(String(url), 'https://arcade.test/leaderboard');
    return new Response('{"error":"rate limited"}', { status: 429 });
  };
  const saved = await submitScore('snake', desc, 'Josh', 10, 'https://arcade.test');
  assert.equal(saved.scope, 'device');
  assert.match(saved.error ?? '', /Try again in a minute/);
});

const games = join(import.meta.dirname, '..', 'src', 'os', 'arcade', 'games');
const metas: GameMeta[] = [];
for (const id of readdirSync(games).filter((d) => !d.startsWith('_'))) metas.push((await import(pathToFileURL(join(games, id, 'meta.ts')).href)).meta);

test('opted in games have sane specs that match their shells', () => {
  const ranked = metas.filter((m) => m.leaderboard);
  assert.ok(ranked.length >= 10);
  for (const m of ranked) {
    const spec = m.leaderboard!;
    assert.ok(spec.order === 'asc' || spec.order === 'desc', m.id);
    assert.ok(Number.isFinite(spec.max) && spec.max > (spec.min ?? 0), m.id);
    // Cox Box ranks typing speed, which is the same score whoever you race.
    // Paper.io ranks solo rounds at a fixed field and level; Noodle ranks solo rounds against 14 computer noodles per difficulty.
    if (m.id !== 'coxbox' && m.id !== 'paperio' && m.id !== 'slither') assert.notEqual(m.category, 'multiplayer', `${m.id} scores depend on the opponent`);
    const src = readFileSync(join(games, m.id, 'index.tsx'), 'utf8');
    // Games that rank with gameOver(undefined, { rank }) keep their own bests and never show the score through the shell.
    if (!/\brank: /.test(src)) assert.equal(/<GameShell[^>]*\blowerIsBetter\b/.test(src), spec.order === 'asc', `${m.id} lowerIsBetter must match order`);
    if (spec.variants) {
      assert.ok(Object.keys(spec.variants).length >= 2, `${m.id} variants need at least two boards`);
      assert.match(src, /\bboard: /, `${m.id} has variant boards, so gameOver must name one with { board }`);
    }
  }
});

test('every board id is unique across arcade games, variants and app games', async () => {
  const owners = await boardOwners();
  const ownerIds = owners.map((o) => o.id);
  assert.equal(new Set(ownerIds).size, ownerIds.length, 'owner ids must be unique');
  const boardIds = owners.flatMap((o) => boardsOf(o).map((b) => b.id));
  assert.equal(new Set(boardIds).size, boardIds.length, 'board ids must be unique');
  for (const id of boardIds) assert.match(id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.deepEqual(Object.keys(LEADERBOARD_SPECS).sort(), [...boardIds].sort());
  for (const spec of Object.values(LEADERBOARD_SPECS)) assert.equal(spec.variants, undefined, 'Worker specs are per board');
});

test('variant boards resolve only for their listed variants', () => {
  const owner = { id: 'mines', title: 'Mines', leaderboard: { order: 'asc' as const, min: 1, max: 9, variants: { easy: 'Easy', hard: 'Hard' } } };
  assert.deepEqual(boardsOf(owner).map((b) => [b.id, b.title]), [['mines-easy', 'Mines · Easy'], ['mines-hard', 'Mines · Hard']]);
  assert.equal(boardFor(owner, 'hard')?.id, 'mines-hard');
  assert.equal(boardFor(owner, 'hard')?.spec.variants, undefined);
  assert.equal(boardFor(owner), null);
  assert.equal(boardFor(owner, 'toString'), null);
  const single = { id: 'snake', title: 'Snake', leaderboard: desc };
  assert.equal(boardFor(single)?.id, 'snake');
  assert.equal(boardFor(single, 'easy'), null);
  assert.equal(boardFor({ id: 'x', title: 'X' }), null);
});

test('units show on number boards only', () => {
  assert.equal(formatBoardScore(1234, { order: 'desc', max: 1e6, unit: 'm' }), '1,234 m');
  assert.equal(formatBoardScore(61_500, { order: 'asc', max: 1e6, format: 'time', unit: 'm' }), '1:01.50s');
});

test('committed Worker specs match the generated game metadata', async () => {
  const committed = readFileSync(join(import.meta.dirname, '..', 'worker', 'src', 'specs.gen.ts'), 'utf8');
  assert.equal(committed, await generateArcadeSpecs());
  const online = [...metas, ...appGames].filter((m) => m.online);
  assert.deepEqual(ONLINE_SPECS, Object.fromEntries(online.map((m) => [m.id, { seats: m.online!.seats, ...(m.online!.lateJoin ? { lateJoin: true } : {}), ...(m.online!.bots ? { bots: true } : {}), ...(m.online!.quick ? { quick: true } : {}), ...(m.online!.watch ? { watch: true } : {}) }])));
  // Spectators: the games that draw the host's broadcasts for someone without a seat.
  assert.deepEqual(online.filter((m) => m.online!.watch).map((m) => m.id).sort(), ['airhockey', 'badminton', 'coxbox', 'pong', 'sumo', 'tank-maze']);
  for (const m of online) assert.ok(m.online!.seats >= 2 && m.online!.seats <= MAX_SEATS, `${m.id} seats`);
  // Bots fill empty seats beside people, so they need a room with more than two seats, and a game that plays them.
  for (const m of online.filter((game) => game.online!.bots)) assert.ok(m.online!.seats > 2 && !m.online!.race, `${m.id} bots`);
  // Quick play starts with bots in every seat nobody takes.
  for (const m of online.filter((game) => game.online!.quick)) assert.ok(m.online!.bots, `${m.id} quick play`);
  for (const m of metas.filter((game) => game.online?.race)) assert.ok(m.leaderboard && !m.leaderboard.variants, `${m.id} races need one comparable score`);
});

test('Go has a board for every level on every size, and 9x9 keeps the original ids', async () => {
  const { GO_LEVELS, GO_SIZES } = await import('../src/os/games/go-levels.ts');
  const { getAppGame, goBoardOwner } = await import('../src/os/arcade/apps.ts');
  for (const size of GO_SIZES) {
    const owner = getAppGame(goBoardOwner(size))!;
    assert.ok(owner, `${size}x${size} owner`);
    for (const level of GO_LEVELS) {
      const board = boardFor(owner, level.id)!;
      assert.equal(board.title, `Go · ${size}×${size} ${level.label}`);
      assert.equal(board.spec.max, size * size);
      assert.ok(LEADERBOARD_SPECS[board.id], `${board.id} is in the Worker specs`);
    }
  }
  assert.equal(boardFor(getAppGame('go')!, 'fast')!.id, 'go-fast');
  assert.equal(boardFor(getAppGame('go')!, 'strong')!.id, 'go-strong');
  assert.equal(getAppGame('go13')!.online, undefined, 'online Go rooms stay on the go id for every size');
});
