export const TELEMETRY_VERSION = 1;
export const MAX_BODY_BYTES = 16_384;
export const MAX_EVENTS_PER_BATCH = 20;
export const MAX_MESSAGE = 500;
export const MAX_STACK = 2048;
export const MAX_UA = 256;
export const CLIENT_EVENTS_PER_MINUTE = 20;
export const PERF_WINDOW_MS = 30_000;
export const RETENTION_DAYS = 14;

export type TelemetryRole = 'display' | 'controller';
export type DeviceClass = 'desktop' | 'phone' | 'tablet';
export type TelemetryError = { k: 'err'; t: number; src: 'error' | 'rejection' | 'react'; msg: string; stack: string; ph: string; n: number };
export type PerfStat = {
  k: 'perf'; t: number; ph: string; win: number; frames: number;
  fps50?: number; fps5?: number; longMs?: number;
  tier?: number; dpr?: number;
  in50?: number; in95?: number; inN?: number;
  loss?: number; rx?: number;
  tr: 'direct' | 'relay' | ''; drops: number; reconnects: number;
};
export type TelemetryEvent = TelemetryError | PerfStat;
export type TelemetryBatch = { v: 1; c: string; role: TelemetryRole; dev: DeviceClass; ua: string; b: string; ev: TelemetryEvent[]; drop?: number };

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

const safeInt = (value: unknown, min: number, max: number) =>
  Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;

const finiteIn = (value: unknown, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

const has = (value: Record<string, unknown>, key: string) => Object.hasOwn(value, key);

export function scrub(text: string): string {
  return text
    .replace(/https?:\/\/[^\s"'<>]+/gi, (url) => url.split(/[?#]/, 1)[0]!)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]');
}

function parseError(value: Record<string, unknown>, index: number): TelemetryError | { error: string } {
  const field = (name: string) => `ev[${index}].${name}`;
  if (!safeInt(value.t, 0, 86_400_000)) return { error: field('t') };
  if (typeof value.ph !== 'string' || !/^[a-z-]{0,24}$/.test(value.ph)) return { error: field('ph') };
  if (!['error', 'rejection', 'react'].includes(value.src as string)) return { error: field('src') };
  if (typeof value.msg !== 'string' || value.msg.length < 1 || value.msg.length > MAX_MESSAGE) return { error: field('msg') };
  if (typeof value.stack !== 'string' || value.stack.length > MAX_STACK) return { error: field('stack') };
  if (!safeInt(value.n, 1, 1000)) return { error: field('n') };
  return {
    k: 'err',
    t: value.t as number,
    src: value.src as TelemetryError['src'],
    msg: scrub(value.msg).slice(0, MAX_MESSAGE),
    stack: scrub(value.stack).slice(0, MAX_STACK),
    ph: value.ph,
    n: value.n as number,
  };
}

function parsePerf(value: Record<string, unknown>, index: number): PerfStat | { error: string } {
  const field = (name: string) => `ev[${index}].${name}`;
  if (!safeInt(value.t, 0, 86_400_000)) return { error: field('t') };
  if (typeof value.ph !== 'string' || !/^[a-z-]{0,24}$/.test(value.ph)) return { error: field('ph') };
  if (!finiteIn(value.win, 1, 120)) return { error: field('win') };
  if (!safeInt(value.frames, 0, 100_000)) return { error: field('frames') };
  const ranges: Record<string, [number, number, boolean?]> = {
    fps50: [0, 1000], fps5: [0, 1000], longMs: [0, 600_000], tier: [0, 8, true], dpr: [0.25, 8],
    in50: [0, 60_000], in95: [0, 60_000], inN: [0, 100_000, true], loss: [0, 1], rx: [0, 1_000_000, true],
  };
  for (const [name, [min, max, integer]] of Object.entries(ranges)) {
    if (!has(value, name)) continue;
    const valid = integer ? safeInt(value[name], min, max) : finiteIn(value[name], min, max);
    if (!valid) return { error: field(name) };
  }
  if (!['direct', 'relay', ''].includes(value.tr as string)) return { error: field('tr') };
  if (!safeInt(value.drops, 0, 10_000)) return { error: field('drops') };
  if (!safeInt(value.reconnects, 0, 10_000)) return { error: field('reconnects') };

  const result: PerfStat = {
    k: 'perf',
    t: value.t as number,
    ph: value.ph,
    win: value.win as number,
    frames: value.frames as number,
    tr: value.tr as PerfStat['tr'],
    drops: value.drops as number,
    reconnects: value.reconnects as number,
  };
  for (const name of Object.keys(ranges) as (keyof PerfStat)[]) {
    if (has(value, name)) (result as unknown as Record<string, unknown>)[name] = value[name];
  }
  return result;
}

export function parseBatch(text: string): { value: TelemetryBatch } | { error: string } {
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return { error: 'too large' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: 'invalid json' };
  }
  if (!isObject(parsed)) return { error: 'invalid body' };
  if (parsed.v !== TELEMETRY_VERSION) return { error: 'v' };
  if (typeof parsed.c !== 'string' || !/^[a-z0-9]{8,24}$/.test(parsed.c)) return { error: 'c' };
  if (parsed.role !== 'display' && parsed.role !== 'controller') return { error: 'role' };
  if (parsed.dev !== 'desktop' && parsed.dev !== 'phone' && parsed.dev !== 'tablet') return { error: 'dev' };
  if (typeof parsed.ua !== 'string' || parsed.ua.length > MAX_UA) return { error: 'ua' };
  if (typeof parsed.b !== 'string' || !/^[0-9a-f]{0,40}$/.test(parsed.b)) return { error: 'b' };
  if (has(parsed, 'drop') && !safeInt(parsed.drop, 0, 100_000)) return { error: 'drop' };
  if (!Array.isArray(parsed.ev) || parsed.ev.length < 1 || parsed.ev.length > MAX_EVENTS_PER_BATCH) return { error: 'ev' };

  const events: TelemetryEvent[] = [];
  for (let i = 0; i < parsed.ev.length; i++) {
    const event = parsed.ev[i];
    if (!isObject(event)) return { error: `ev[${i}]` };
    if (event.k === 'err') {
      const result = parseError(event, i);
      if ('error' in result) return result;
      events.push(result);
    } else if (event.k === 'perf') {
      const result = parsePerf(event, i);
      if ('error' in result) return result;
      events.push(result);
    } else {
      return { error: `ev[${i}].k` };
    }
  }

  return {
    value: {
      v: TELEMETRY_VERSION,
      c: parsed.c,
      role: parsed.role,
      dev: parsed.dev,
      ua: parsed.ua,
      b: parsed.b,
      ev: events,
      ...(has(parsed, 'drop') ? { drop: parsed.drop as number } : {}),
    },
  };
}

function normalizedLocation(value: string): string {
  const match = /^(.*):(\d+):(\d+)$/.exec(value);
  if (!match) return '';
  let path = match[1]!.split(/[?#]/, 1)[0]!;
  path = path.replace(/^https?:\/\/[^/]+/i, '').replace(/^file:\/\/[^/]*/i, '');
  if (!path.startsWith('/')) path = `/${path}`;
  return `${path}:${match[2]}:${match[3]}`;
}

export function topFrame(stack: string): string {
  for (const line of stack.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let frame = '';
    if (/^at\s+/.test(trimmed)) {
      const body = trimmed.replace(/^at\s+/, '');
      const named = /^(.*?)\s+\((.*)\)$/.exec(body);
      const location = named?.[2] ?? body;
      const path = normalizedLocation(location);
      if (!path) continue;
      const fn = named?.[1] ?? '';
      frame = fn && !/^(?:https?:|file:|blob:|webpack-internal:)/i.test(fn) ? `${fn} (${path})` : path;
    } else if (trimmed.includes('@')) {
      const at = trimmed.lastIndexOf('@');
      const fn = trimmed.slice(0, at);
      const path = normalizedLocation(trimmed.slice(at + 1));
      if (!path) continue;
      frame = `${fn}@${path}`;
    }
    if (frame) return frame.slice(0, 200);
  }
  return '';
}

export function deviceClass(ua: string, maxTouchPoints: number): DeviceClass {
  if (/iPhone|iPod/i.test(ua) || /Android/i.test(ua) && /Mobile/i.test(ua) || /Mobile/i.test(ua) && !/iPad/i.test(ua)) return 'phone';
  if (/iPad|Android/i.test(ua) || /Macintosh/i.test(ua) && maxTouchPoints > 1) return 'tablet';
  return 'desktop';
}

export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] ?? 0;
}

export class EventBudget {
  private readonly accepted: number[] = [];

  private readonly limit: number;
  private readonly windowMs: number;

  constructor(limit = CLIENT_EVENTS_PER_MINUTE, windowMs = 60_000) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  take(now: number): boolean {
    while (this.accepted.length && now - this.accepted[0]! >= this.windowMs) this.accepted.shift();
    if (this.accepted.length >= this.limit) return false;
    this.accepted.push(now);
    return true;
  }
}

export class TelemetryQueue {
  private events: TelemetryEvent[] = [];
  private dropped = 0;
  private readonly budget: EventBudget;

  constructor(budget: EventBudget) {
    this.budget = budget;
  }

  addError(error: Omit<TelemetryError, 'n'>, now: number): void {
    const frame = topFrame(error.stack);
    const duplicate = this.events.find((event): event is TelemetryError =>
      event.k === 'err' && event.src === error.src && event.msg === error.msg && topFrame(event.stack) === frame);
    if (duplicate) {
      duplicate.n = Math.min(1000, duplicate.n + 1);
      return;
    }
    if (this.events.length >= 40 || !this.budget.take(now)) {
      this.dropped++;
      return;
    }
    this.events.push({ ...error, k: 'err', n: 1 });
  }

  addPerf(perf: PerfStat, now: number): void {
    if (this.events.length >= 40 || !this.budget.take(now)) {
      this.dropped++;
      return;
    }
    this.events.push(perf);
  }

  drain(): { events: TelemetryEvent[]; dropped: number } {
    const events = this.events.splice(0, MAX_EVENTS_PER_BATCH);
    const dropped = this.dropped;
    this.dropped = 0;
    return { events, dropped };
  }

  pending(): number {
    return this.events.length;
  }
}

export class SlidingLimiter {
  private readonly hits = new Map<string, { at: number; cost: number }[]>();

  private readonly limit: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;

  constructor(limit: number, windowMs: number, maxKeys = 10_000) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
  }

  take(key: string, cost: number, now: number): boolean {
    const recent = (this.hits.get(key) ?? []).filter((hit) => now - hit.at < this.windowMs);
    const total = recent.reduce((sum, hit) => sum + hit.cost, 0);
    if (!Number.isFinite(cost) || cost <= 0 || total + cost > this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push({ at: now, cost });
    this.hits.set(key, recent);
    if (this.hits.size > this.maxKeys) this.hits.clear();
    return true;
  }
}

export type FrameSummary = { fps50: number; fps5: number; longMs: number; frames: number };

export class FrameStats {
  private frames: number[] = [];

  frame(ms: number): void {
    if (!Number.isFinite(ms) || ms <= 0 || ms > 2000) return;
    this.frames.push(ms);
    if (this.frames.length > 4000) this.frames.shift();
  }

  summary(): FrameSummary {
    if (!this.frames.length) return { fps50: 0, fps5: 0, longMs: 0, frames: 0 };
    const sorted = [...this.frames].sort((a, b) => a - b);
    const p50 = percentile(sorted, 0.5);
    const p95 = sorted[Math.ceil((sorted.length - 1) * 0.95)] ?? 0;
    const round = (value: number) => Math.round(value * 10) / 10;
    return {
      fps50: round(1000 / p50),
      fps5: round(1000 / p95),
      longMs: round(sorted.at(-1)!),
      frames: this.frames.length,
    };
  }

  reset(): void {
    this.frames = [];
  }
}

export class SeqLoss {
  private last = -1;
  private received = 0;
  private missing = 0;

  see(seq: number): void {
    if (!Number.isSafeInteger(seq) || seq < 0 || seq <= this.last) return;
    if (this.last >= 0) this.missing += Math.max(0, seq - this.last - 1);
    this.last = seq;
    this.received++;
  }

  summary(): { rx: number; loss: number | undefined } {
    const total = this.received + this.missing;
    return { rx: this.received, loss: this.received ? this.missing / total : undefined };
  }

  reset(): void {
    this.received = 0;
    this.missing = 0;
  }
}

export class Latency {
  private pending = new Map<number, number>();
  private samples: number[] = [];
  private lastAck = -1;

  sent(seq: number, now: number): void {
    if (!Number.isSafeInteger(seq) || seq < 0 || !Number.isFinite(now)) return;
    this.pending.set(seq, now);
    if (this.pending.size > 128) this.pending.delete(this.pending.keys().next().value!);
  }

  ack(seq: number, now: number): void {
    if (!Number.isSafeInteger(seq) || seq <= this.lastAck || !Number.isFinite(now)) return;
    const sentAt = this.pending.get(seq);
    if (sentAt === undefined) return;
    const elapsed = now - sentAt;
    if (!Number.isFinite(elapsed) || elapsed < 0) return;
    this.samples.push(elapsed);
    this.lastAck = seq;
    for (const pending of this.pending.keys()) if (pending <= seq) this.pending.delete(pending);
  }

  summary(): { in50?: number; in95?: number; inN?: number } {
    if (!this.samples.length) return {};
    const sorted = [...this.samples].sort((a, b) => a - b);
    return { in50: percentile(sorted, 0.5), in95: percentile(sorted, 0.95), inN: sorted.length };
  }

  reset(): void {
    this.samples = [];
  }
}

export type ErrorRow = {
  at: number; client: string; role: string; device: string; build: string; ua: string; phase: string;
  src: string | null; msg: string; frame: string; stack: string; n: number;
};
export type PerfRow = {
  at: number; client: string; role: string; device: string; build: string; phase: string; frames: number;
  fps50: number | null; fps5: number | null; long_ms: number | null; tier: number | null; dpr: number | null;
  in50: number | null; in95: number | null; loss: number | null; drops: number; reconnects: number; tr: string | null;
};
type PercentileSummary = { n: number; p5: number; p50: number; p95: number; max: number } | null;
type SummaryWindow = { from: number; to: number; hours: number };

function percentiles(values: (number | null)[]): PercentileSummary {
  const sorted = values.filter((value): value is number => value !== null && Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return {
    n: sorted.length,
    p5: percentile(sorted, 0.05),
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted.at(-1)!,
  };
}

export function summarizeTelemetry(errorRows: ErrorRow[], perfRows: PerfRow[], window: SummaryWindow) {
  const errors = new Map<string, {
    message: string; frame: string; count: number; events: number; clients: Set<string>; firstAt: number; lastAt: number;
    roles: Record<string, number>; devices: Record<string, number>; phases: Record<string, number>;
    builds: Map<string, number>; sample: { stack: string; ua: string; src: string | null }; sampleAt: number;
  }>();
  const clients = new Set<string>();
  for (const row of errorRows) {
    clients.add(row.client);
    const key = `${row.msg}\n${row.frame}`;
    let entry = errors.get(key);
    if (!entry) {
      entry = {
        message: row.msg, frame: row.frame, count: 0, events: 0, clients: new Set(),
        firstAt: row.at, lastAt: row.at, roles: {}, devices: {}, phases: {}, builds: new Map(),
        sample: { stack: row.stack, ua: row.ua, src: row.src }, sampleAt: row.at,
      };
      errors.set(key, entry);
    }
    entry.count += row.n;
    entry.events++;
    entry.clients.add(row.client);
    entry.firstAt = Math.min(entry.firstAt, row.at);
    entry.lastAt = Math.max(entry.lastAt, row.at);
    entry.roles[row.role] = (entry.roles[row.role] ?? 0) + row.n;
    entry.devices[row.device] = (entry.devices[row.device] ?? 0) + row.n;
    entry.phases[row.phase] = (entry.phases[row.phase] ?? 0) + row.n;
    entry.builds.set(row.build, Math.max(entry.builds.get(row.build) ?? 0, row.at));
    if (row.at >= entry.sampleAt) {
      entry.sample = { stack: row.stack, ua: row.ua, src: row.src };
      entry.sampleAt = row.at;
    }
  }

  const groupedPerf = new Map<string, PerfRow[]>();
  for (const row of perfRows) {
    clients.add(row.client);
    const group = `${row.role}/${row.device}`;
    const rows = groupedPerf.get(group) ?? [];
    rows.push(row);
    groupedPerf.set(group, rows);
  }
  const errorSummary = [...errors.values()]
    .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt)
    .slice(0, 50)
    .map((entry) => ({
      message: entry.message,
      frame: entry.frame,
      count: entry.count,
      events: entry.events,
      clients: entry.clients.size,
      first: new Date(entry.firstAt).toISOString(),
      last: new Date(entry.lastAt).toISOString(),
      roles: entry.roles,
      devices: entry.devices,
      phases: entry.phases,
      builds: [...entry.builds].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([build]) => build),
      sample: entry.sample,
    }));
  const perf = [...groupedPerf]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, rows]) => ({
      group,
      samples: rows.length,
      clients: new Set(rows.map((row) => row.client)).size,
      fps50: percentiles(rows.map((row) => row.fps50)),
      fps5: percentiles(rows.map((row) => row.fps5)),
      longMs: percentiles(rows.map((row) => row.long_ms)),
      in50: percentiles(rows.map((row) => row.in50)),
      in95: percentiles(rows.map((row) => row.in95)),
      loss: percentiles(rows.map((row) => row.loss)),
      tiers: rows.reduce<Record<string, number>>((counts, row) => {
        if (row.tier !== null) counts[String(row.tier)] = (counts[String(row.tier)] ?? 0) + 1;
        return counts;
      }, {}),
      transports: rows.reduce<Record<string, number>>((counts, row) => {
        if (row.tr) counts[row.tr] = (counts[row.tr] ?? 0) + 1;
        return counts;
      }, {}),
      drops: rows.reduce((sum, row) => sum + row.drops, 0),
      reconnects: rows.reduce((sum, row) => sum + row.reconnects, 0),
    }));

  return {
    window: { from: new Date(window.from).toISOString(), to: new Date(window.to).toISOString(), hours: window.hours },
    totals: {
      errors: errorRows.reduce((sum, row) => sum + row.n, 0),
      errorEvents: errorRows.length,
      perf: perfRows.length,
      clients: clients.size,
    },
    errors: errorSummary,
    perf,
  };
}
