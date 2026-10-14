import type { LeaderboardSpec } from '../types';
import { cleanName, isEntry, parseBoardTops, rankEntries, topsOf, NAME_MAX, type BoardEntry } from './leaderboard-core.ts';

export {
  NAME_MAX,
  TOP,
  boardFor,
  boardsOf,
  cleanName,
  isEntry,
  nameLength,
  plausible,
  qualifies,
  rankEntries,
  validateSubmission,
  type BoardEntry,
  type BoardInfo,
  type BoardOwner,
  type Submission,
} from './leaderboard-core.ts';

export type BoardScope = 'global' | 'device';
export type Board = { entries: BoardEntry[]; scope: BoardScope; error?: string };

const DEFAULT_ARCADE_API = 'https://josh-arcade.joshuakoo.workers.dev';
export const ARCADE_API = ((import.meta as any).env?.PUBLIC_ARCADE_API as string | undefined) || DEFAULT_ARCADE_API;
const DEVICE_KEY = 'arcade:boards';
const NAME_KEY = 'arcade:name';

export function formatBoardScore(n: number, spec: LeaderboardSpec): string {
  if (spec.format !== 'time') return spec.unit ? `${n.toLocaleString('en-US')} ${spec.unit}` : n.toLocaleString('en-US');
  const s = Math.floor(n / 1000);
  const m = Math.floor(s / 60);
  const cs = String(Math.floor((n % 1000) / 10)).padStart(2, '0');
  return m > 0 ? `${m}:${String(s % 60).padStart(2, '0')}.${cs}s` : `${s}.${cs}s`;
}

function readDevice(): Record<string, BoardEntry[]> {
  try {
    const v = JSON.parse(localStorage.getItem(DEVICE_KEY) ?? '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

export function deviceBoard(game: string, spec: LeaderboardSpec): BoardEntry[] {
  const list = readDevice()[game];
  return rankEntries(Array.isArray(list) ? list.filter(isEntry) : [], spec.order);
}

function saveDevice(game: string, entry: BoardEntry, spec: LeaderboardSpec): BoardEntry[] {
  const boards = readDevice();
  const next = rankEntries([...deviceBoard(game, spec), entry], spec.order);
  boards[game] = next;
  try {
    localStorage.setItem(DEVICE_KEY, JSON.stringify(boards));
  } catch {
    /* private mode: the board lives for this page only */
  }
  return next;
}

async function readEntries(res: Response): Promise<BoardEntry[]> {
  const body = (await res.json()) as { entries?: unknown };
  if (!Array.isArray(body.entries)) throw new Error('bad response');
  return body.entries.filter(isEntry);
}

export async function getBoard(game: string, spec: LeaderboardSpec, api = ARCADE_API): Promise<Board> {
  if (!api) return { entries: deviceBoard(game, spec), scope: 'device' };
  try {
    const res = await fetch(`${api}/leaderboard?game=${encodeURIComponent(game)}`);
    if (!res.ok) throw new Error('unavailable');
    return { entries: rankEntries(await readEntries(res), spec.order), scope: 'global' };
  } catch {
    return { entries: deviceBoard(game, spec), scope: 'device' };
  }
}

export const WINS_UNAVAILABLE = 'Online wins are unavailable right now.';

/** A game's Online Wins board (`score` is the number of wins). Wins only exist on the Worker, so there is no device board. */
export async function getWins(game: string, api = ARCADE_API): Promise<Board> {
  if (!api) return { entries: [], scope: 'global', error: WINS_UNAVAILABLE };
  try {
    const res = await fetch(`${api}/wins?game=${encodeURIComponent(game)}`);
    if (!res.ok) throw new Error('unavailable');
    return { entries: await readEntries(res), scope: 'global' };
  } catch {
    return { entries: [], scope: 'global', error: WINS_UNAVAILABLE };
  }
}

/** The best few of every board for the Leaderboards cards. `wins` is null when Online Wins are unavailable. */
export type BoardTopsResult = { scope: BoardScope; boards: Record<string, BoardEntry[]>; wins: Record<string, BoardEntry[]> | null };

/**
 * The best few entries of every score board in `specs` and every Online Wins board in `online`, in one request.
 * If the API is unavailable, or the deployed Worker predates GET /leaderboard/top, the score boards come from this device.
 */
export async function getBoardTops(specs: Record<string, LeaderboardSpec>, online: readonly string[], api = ARCADE_API): Promise<BoardTopsResult> {
  const orders = Object.fromEntries(Object.entries(specs).map(([id, spec]) => [id, spec.order]));
  const device = (): BoardTopsResult => ({ scope: 'device', boards: topsOf(readDevice(), orders), wins: null });
  if (!api) return device();
  try {
    const res = await fetch(`${api}/leaderboard/top`);
    if (!res.ok) throw new Error('unavailable');
    const tops = parseBoardTops(await res.json(), orders, online);
    if (!tops) throw new Error('bad response');
    return { scope: 'global', ...tops };
  } catch {
    return device();
  }
}

const errorText: Record<number, string> = {
  400: 'That score could not be saved globally.',
  429: 'Too many scores at once. Try again in a minute.',
};

/** Saves on this device, then globally. Returns the global board, or this device's board if that fails. */
export async function submitScore(game: string, spec: LeaderboardSpec, rawName: string, score: number, api = ARCADE_API): Promise<Board & { entry: BoardEntry }> {
  const name = Array.from(cleanName(rawName)).slice(0, NAME_MAX).join('');
  const entry: BoardEntry = { name, score, date: new Date().toISOString() };
  const local = saveDevice(game, entry, spec);
  if (!api) return { entries: local, scope: 'device', entry };
  try {
    const res = await fetch(`${api}/leaderboard`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ game, name, score }) });
    if (!res.ok) return { entries: local, scope: 'device', entry, error: errorText[res.status] };
    const entries = rankEntries(await readEntries(res), spec.order);
    const mine = entries.find((e) => e.name === name && e.score === score);
    return { entries, scope: 'global', entry: mine ?? entry };
  } catch {
    return { entries: local, scope: 'device', entry };
  }
}

export function savedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* ignore */
  }
}
