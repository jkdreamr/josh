// Arcade leaderboards: validation and ranking shared by the API route and the client, plus a
// client that falls back to a board kept on this device when the global one is unavailable.
import type { LeaderboardSpec } from '../types';

export type BoardScope = 'global' | 'device';
export type BoardEntry = { name: string; score: number; date: string };
export type Board = { entries: BoardEntry[]; scope: BoardScope; error?: string };
export type Submission = { game: string; name: string; score: number };

export const TOP = 100;
export const NAME_MAX = 16;
export const API = '/api/arcade-leaderboard';
const DEVICE_KEY = 'arcade:boards';
const NAME_KEY = 'arcade:name';

/** Strips control, zero width and bidi characters, collapses spaces and trims. */
export function cleanName(raw: string): string {
  return raw
    .replace(/[\t\n\v\f\r]/g, ' ')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export const nameLength = (name: string) => Array.from(name).length;

/** Within the spec's range. A zero on a higher-wins board is not worth listing. */
export const plausible = (score: number, spec: LeaderboardSpec) =>
  Number.isFinite(score) && score >= (spec.min ?? 0) && score <= spec.max && !(spec.order === 'desc' && score <= 0);

export function validateSubmission(value: unknown, specs: Record<string, LeaderboardSpec | undefined>): { value?: Submission; error?: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'invalid body' };
  const body = value as Record<string, unknown>;
  if (typeof body.game !== 'string' || !Object.hasOwn(specs, body.game) || !specs[body.game]) return { error: 'unknown game' };
  const spec = specs[body.game]!;
  if (typeof body.name !== 'string') return { error: 'invalid name' };
  const name = cleanName(body.name);
  if (nameLength(name) < 1 || nameLength(name) > NAME_MAX) return { error: 'invalid name' };
  const score = body.score;
  if (typeof score !== 'number' || !plausible(score, spec)) return { error: 'invalid score' };
  return { value: { game: body.game, name, score } };
}

/** Best first; ties go to whoever got there first. */
export function rankEntries(entries: BoardEntry[], order: LeaderboardSpec['order']): BoardEntry[] {
  return [...entries]
    .sort((a, b) => (order === 'asc' ? a.score - b.score : b.score - a.score) || a.date.localeCompare(b.date))
    .slice(0, TOP);
}

/** True when the score would land on a top 100 board. */
export function qualifies(score: number, entries: BoardEntry[], spec: LeaderboardSpec): boolean {
  if (!plausible(score, spec)) return false;
  if (entries.length < TOP) return true;
  const last = rankEntries(entries, spec.order)[TOP - 1];
  return spec.order === 'asc' ? score < last.score : score > last.score;
}

/** Sorted set score: Redis ranks ascending, so higher-wins boards store the negated score. */
export const redisScore = (score: number, order: LeaderboardSpec['order']) => (order === 'desc' ? -score : score);

export function isEntry(e: unknown): e is BoardEntry {
  const x = e as BoardEntry;
  return !!x && typeof x.name === 'string' && typeof x.score === 'number' && Number.isFinite(x.score) && typeof x.date === 'string';
}

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

export async function getBoard(game: string, spec: LeaderboardSpec): Promise<Board> {
  try {
    const res = await fetch(`${API}?game=${encodeURIComponent(game)}`);
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
export async function submitScore(game: string, spec: LeaderboardSpec, rawName: string, score: number): Promise<Board & { entry: BoardEntry }> {
  const name = Array.from(cleanName(rawName)).slice(0, NAME_MAX).join('');
  const entry: BoardEntry = { name, score, date: new Date().toISOString() };
  const local = saveDevice(game, entry, spec);
  try {
    const res = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ game, name, score }) });
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
