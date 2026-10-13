/** Site-wide counters: page visits, games played and visitors. Shared by the menu bar Stats panel and the arcade Worker. */

/** Days roll over at midnight in Palo Alto, like the menu bar clock. */
export const STATS_TIME_ZONE = 'America/Los_Angeles';

export const PERIODS = ['today', 'week', 'month', 'all'] as const;
export type StatsPeriod = (typeof PERIODS)[number];
export type PeriodCounts = Record<StatsPeriod, number>;
export type TopGame = { game: string; plays: number };
export type StatsSummary = {
  /** People with the site open right now. Missing from Workers deployed before it existed. */
  online?: number;
  views: PeriodCounts;
  plays: PeriodCounts;
  visitors: PeriodCounts;
  top: Record<StatsPeriod, TopGame[]>;
  /** First day anything was counted, YYYY-MM-DD. */
  since: string | null;
};

/** Days in each rolling window, today included. */
export const PERIOD_DAYS = { today: 1, week: 7, month: 30 } as const;
/** Daily rows older than this are dropped; all time totals live in their own table. */
export const KEEP_DAYS = 31;
export const TOP_GAMES = 5;
/** Caps how many distinct game ids the Worker will store. */
export const MAX_GAMES = 200;
const HIT_MAX_BYTES = 512;

export function dayKey(date: Date, timeZone = STATS_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Moves a YYYY-MM-DD day key by whole days. */
export function shiftDay(day: string, by: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10);
}

/** The first day of each rolling window that ends today. */
export function periodStarts(today: string): Record<Exclude<StatsPeriod, 'all'>, string> {
  return {
    today,
    week: shiftDay(today, 1 - PERIOD_DAYS.week),
    month: shiftDay(today, 1 - PERIOD_DAYS.month),
  };
}

export const isVisitorId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(v);
export const isGameId = (v: unknown): v is string => typeof v === 'string' && v.length <= 32 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(v);

export type StatsHit = { kind: 'view'; visitor: string } | { kind: 'play'; visitor: string; game: string };

/** Validates a hit body (JSON text, sent as text/plain so the browser skips the CORS preflight). */
export function parseHit(kind: string, raw: string): StatsHit | null {
  if (raw.length > HIT_MAX_BYTES) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (!isVisitorId(body.visitor)) return null;
  if (kind === 'view') return { kind, visitor: body.visitor };
  if (kind === 'play' && isGameId(body.game)) return { kind, visitor: body.visitor, game: body.game };
  return null;
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isCounts = (v: unknown): v is PeriodCounts => !!v && typeof v === 'object' && PERIODS.every((p) => isCount((v as PeriodCounts)[p]));
const isTop = (v: unknown): v is TopGame[] =>
  Array.isArray(v) && v.every((g) => !!g && typeof g === 'object' && isGameId((g as TopGame).game) && isCount((g as TopGame).plays));

export function isStatsSummary(v: unknown): v is StatsSummary {
  if (!v || typeof v !== 'object') return false;
  const s = v as StatsSummary;
  return (
    (s.online === undefined || isCount(s.online)) &&
    isCounts(s.views) &&
    isCounts(s.plays) &&
    isCounts(s.visitors) &&
    !!s.top &&
    typeof s.top === 'object' &&
    PERIODS.every((p) => isTop(s.top[p])) &&
    (s.since === null || (typeof s.since === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.since)))
  );
}

/** Exact up to a million, then compact (1.2M). */
export function formatCount(n: number): string {
  if (n < 1_000_000) return Math.round(n).toLocaleString('en-US');
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}
