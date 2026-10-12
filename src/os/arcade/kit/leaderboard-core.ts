import type { LeaderboardSpec } from '../types';

export type BoardEntry = { name: string; score: number; date: string };
export type Submission = { game: string; name: string; score: number };

export const TOP = 100;
export const NAME_MAX = 16;

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

export function isEntry(e: unknown): e is BoardEntry {
  const x = e as BoardEntry;
  return !!x && typeof x.name === 'string' && typeof x.score === 'number' && Number.isFinite(x.score) && typeof x.date === 'string';
}
