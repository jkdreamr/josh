import type { LeaderboardSpec } from '../types';
import { cleanName, isEntry, rankEntries, NAME_MAX, type BoardEntry } from './leaderboard-core.ts';

export {
  NAME_MAX,
  TOP,
  cleanName,
  isEntry,
  nameLength,
  plausible,
  qualifies,
  rankEntries,
  validateSubmission,
  type BoardEntry,
  type Submission,
} from './leaderboard-core.ts';

export type BoardScope = 'global' | 'device';
export type Board = { entries: BoardEntry[]; scope: BoardScope; error?: string };

const DEFAULT_ARCADE_API = '';
export const ARCADE_API = ((import.meta as any).env?.PUBLIC_ARCADE_API as string | undefined) || DEFAULT_ARCADE_API;
const DEVICE_KEY = 'arcade:boards';
const NAME_KEY = 'arcade:name';

export function formatBoardScore(n: number, spec: LeaderboardSpec): string {
  if (spec.format !== 'time') return n.toLocaleString('en-US');
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
