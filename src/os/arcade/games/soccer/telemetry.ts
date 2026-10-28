import { ARCADE_API } from '../../kit/leaderboard';
import {
  CLIENT_EVENTS_PER_MINUTE, EventBudget, FrameStats, Latency, MAX_BODY_BYTES, MAX_EVENTS_PER_BATCH,
  MAX_MESSAGE, MAX_STACK, MAX_UA, PERF_WINDOW_MS, SeqLoss, TelemetryQueue, deviceClass, scrub,
  type TelemetryError, type TelemetryRole,
} from './telemetry-core.ts';

declare const __BUILD_SHA__: string | undefined;

export type SoccerTelemetry = {
  setPhase: (phase: string) => void;
  match: (active: boolean) => void;
  frame: (ms: number) => void;
  quality: (tier: number, dpr: number) => void;
  sent: (seq: number) => void;
  ack: (seq: number) => void;
  seq: (seq: number, stream?: number) => void;
  transport: (transport: 'direct' | 'relay') => void;
  stop: () => void;
};

export type TelemetryHandle = SoccerTelemetry;

type Reporter = {
  references: number;
  role: TelemetryRole;
  client: string;
  ua: string;
  device: ReturnType<typeof deviceClass>;
  build: string;
  endpoint: string;
  startedAt: number;
  windowAt: number;
  matchActive: boolean;
  phase: string;
  queue: TelemetryQueue;
  pendingDrops: number;
  frames: FrameStats;
  latency: Latency;
  sequences: Map<number, SeqLoss>;
  tier: number;
  dpr: number;
  transport: 'direct' | 'relay' | '';
  previousTransport: 'direct' | 'relay' | '';
  dropped: number;
  reconnects: number;
  dropSinceReconnect: boolean;
  flushTimer: ReturnType<typeof setTimeout> | null;
  interval: ReturnType<typeof setInterval> | null;
  onError: (event: Event) => void;
  onRejection: (event: PromiseRejectionEvent) => void;
  onPageHide: () => void;
  onVisibility: () => void;
};

let activeReporter: Reporter | null = null;
const noop = () => {};
const NOOP_TELEMETRY: SoccerTelemetry = {
  setPhase: noop,
  match: noop,
  frame: noop,
  quality: noop,
  sent: noop,
  ack: noop,
  seq: noop,
  transport: noop,
  stop: noop,
};

function randomClientId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(12);
  try {
    crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]!).join('');
}

function errorFields(error: unknown): { msg: string; stack: string } {
  try {
    if (error && typeof error === 'object') {
      const value = error as { message?: unknown; stack?: unknown };
      const message = typeof value.message === 'string' ? value.message : String(error);
      const stack = typeof value.stack === 'string' ? value.stack : '';
      return {
        msg: scrub(message).slice(0, MAX_MESSAGE),
        stack: scrub(stack).slice(0, MAX_STACK),
      };
    }
    return { msg: scrub(String(error)).slice(0, MAX_MESSAGE), stack: '' };
  } catch {
    return { msg: 'Unknown error', stack: '' };
  }
}

function reportError(reporter: Reporter, error: unknown, src: TelemetryError['src'], immediate = false): void {
  try {
    const fields = errorFields(error);
    if (!fields.msg) return;
    reporter.queue.addError({
      k: 'err', t: Math.max(0, Math.floor(performance.now() - reporter.startedAt)),
      src, msg: fields.msg, stack: fields.stack, ph: reporter.phase,
    }, performance.now());
    flushSoon(reporter, immediate);
  } catch {
    // Telemetry must never interfere with gameplay.
  }
}

function makeBatch(reporter: Reporter): string | null {
  const drained = reporter.queue.drain();
  reporter.pendingDrops += drained.dropped;
  if (!drained.events.length) return null;
  const events = drained.events.slice(0, MAX_EVENTS_PER_BATCH);
  let dropped = reporter.pendingDrops + drained.events.length - events.length;
  const envelope = () => ({
    v: 1 as const, c: reporter.client, role: reporter.role, dev: reporter.device,
    ua: reporter.ua, b: reporter.build, ev: events, ...(dropped ? { drop: dropped } : {}),
  });
  let body = JSON.stringify(envelope());
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES - 512) {
    for (const event of events) if (event.k === 'err') event.stack = event.stack.slice(0, 512);
    body = JSON.stringify(envelope());
  }
  while (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES - 512 && events.length) {
    events.pop();
    dropped++;
    body = JSON.stringify(envelope());
  }
  reporter.pendingDrops = dropped;
  if (events.length) reporter.pendingDrops = 0;
  return events.length ? body : null;
}

async function send(reporter: Reporter, body: string): Promise<void> {
  try {
    if (navigator.sendBeacon) {
      const accepted = navigator.sendBeacon(reporter.endpoint, new Blob([body], { type: 'text/plain;charset=UTF-8' }));
      if (accepted) return;
    }
  } catch {
    // Fall back to a keepalive request when the beacon API is unavailable.
  }
  try {
    await fetch(reporter.endpoint, {
      method: 'POST', headers: { 'content-type': 'text/plain' }, body, keepalive: true,
    });
  } catch {
    // Network errors are intentionally silent.
  }
}

function flush(reporter: Reporter): void {
  if (reporter.flushTimer) {
    clearTimeout(reporter.flushTimer);
    reporter.flushTimer = null;
  }
  try {
    const bodies: string[] = [];
    let body = makeBatch(reporter);
    if (body) bodies.push(body);
    while (reporter.queue.pending() && bodies.length < 2) {
      body = makeBatch(reporter);
      if (!body) break;
      bodies.push(body);
    }
    for (const next of bodies) void send(reporter, next);
  } catch {
    // Telemetry must never interfere with gameplay.
  }
}

function flushSoon(reporter: Reporter, immediate = false): void {
  if (immediate) {
    flush(reporter);
    return;
  }
  if (!reporter.flushTimer) reporter.flushTimer = setTimeout(() => flush(reporter), 5000);
}

function resetWindow(reporter: Reporter, now: number): void {
  reporter.frames.reset();
  for (const loss of reporter.sequences.values()) loss.reset();
  reporter.latency.reset();
  reporter.dropped = 0;
  reporter.reconnects = 0;
  reporter.dropSinceReconnect = false;
  reporter.windowAt = now;
}

function emitPerformance(reporter: Reporter, now: number): void {
  if (!reporter.matchActive) {
    resetWindow(reporter, now);
    return;
  }
  const frame = reporter.frames.summary();
  const latency = reporter.latency.summary();
  let rx = 0;
  let missing = 0;
  for (const loss of reporter.sequences.values()) {
    const summary = loss.summary();
    rx += summary.rx;
    if (summary.loss !== undefined && summary.loss < 1) {
      missing += Math.round(summary.rx * summary.loss / (1 - summary.loss));
    }
  }
  const elapsed = now - reporter.windowAt;
  const hasActivity = reporter.role === 'display'
    ? frame.frames > 0
    : rx > 0 || (latency.inN ?? 0) > 0;
  if (hasActivity) {
    const seconds = Math.max(1, Math.min(120, elapsed / 1000));
    reporter.queue.addPerf({
      k: 'perf', t: Math.max(0, Math.floor(now - reporter.startedAt)), ph: reporter.phase,
      win: seconds, frames: frame.frames,
      ...(reporter.role === 'display' ? {
        fps50: frame.fps50, fps5: frame.fps5, longMs: frame.longMs,
        tier: reporter.tier, dpr: reporter.dpr,
      } : {
        ...(latency.inN && latency.in50 !== undefined && latency.in95 !== undefined
          ? { in50: latency.in50, in95: latency.in95, inN: latency.inN }
          : {}),
        loss: rx + missing ? missing / (rx + missing) : 0, rx,
      }),
      tr: reporter.transport, drops: reporter.dropped, reconnects: reporter.reconnects,
    }, now);
    flushSoon(reporter);
  }
  resetWindow(reporter, now);
}

function stopReporter(reporter: Reporter): void {
  if (reporter.matchActive) emitPerformance(reporter, performance.now());
  if (reporter.interval) clearInterval(reporter.interval);
  if (reporter.flushTimer) clearTimeout(reporter.flushTimer);
  window.removeEventListener('error', reporter.onError);
  window.removeEventListener('unhandledrejection', reporter.onRejection);
  window.removeEventListener('pagehide', reporter.onPageHide);
  document.removeEventListener('visibilitychange', reporter.onVisibility);
  flush(reporter);
  activeReporter = null;
}

function createReporter(role: TelemetryRole): Reporter | null {
  if (typeof window === 'undefined' || !ARCADE_API) return null;
  let preference = '';
  try {
    preference = window.localStorage.getItem('soccer:telemetry') ?? '';
  } catch {
    // Storage can be unavailable in private browsing.
  }
  if (preference === 'off') return null;
  if (import.meta.env.DEV && !new URLSearchParams(window.location.search).has('soccertelemetry')) return null;

  const now = performance.now();
  const rawBuild = typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__.slice(0, 12).toLowerCase() : '';
  const reporter = {} as Reporter;
  Object.assign(reporter, {
    references: 0,
    role,
    client: randomClientId(),
    ua: (navigator.userAgent ?? '').slice(0, MAX_UA),
    device: deviceClass(navigator.userAgent ?? '', navigator.maxTouchPoints ?? 0),
    build: /^[0-9a-f]{0,40}$/.test(rawBuild) ? rawBuild : '',
    endpoint: `${ARCADE_API.replace(/\/+$/, '')}/telemetry`,
    startedAt: now,
    windowAt: now,
    matchActive: false,
    phase: '',
    queue: new TelemetryQueue(new EventBudget(CLIENT_EVENTS_PER_MINUTE)),
    pendingDrops: 0,
    frames: new FrameStats(),
    latency: new Latency(),
    sequences: new Map<number, SeqLoss>(),
    tier: 0,
    dpr: 1,
    transport: '',
    previousTransport: '',
    dropped: 0,
    reconnects: 0,
    dropSinceReconnect: false,
    flushTimer: null,
    interval: null,
    onError: (event: Event) => {
      try {
        if (event.target !== window) return;
        const error = event as ErrorEvent;
        reportError(reporter, error.error ?? error.message, 'error');
      } catch {
        return;
      }
    },
    onRejection: (event: PromiseRejectionEvent) => {
      try {
        reportError(reporter, event.reason, 'rejection');
      } catch {
        return;
      }
    },
    onPageHide: () => {
      try {
        emitPerformance(reporter, performance.now());
        flush(reporter);
      } catch {
        return;
      }
    },
    onVisibility: () => {
      try {
        if (document.visibilityState === 'hidden') {
          emitPerformance(reporter, performance.now());
          flush(reporter);
        }
      } catch {
        return;
      }
    },
  });
  activeReporter = reporter;
  window.addEventListener('error', reporter.onError);
  window.addEventListener('unhandledrejection', reporter.onRejection);
  window.addEventListener('pagehide', reporter.onPageHide);
  document.addEventListener('visibilitychange', reporter.onVisibility);
  reporter.interval = setInterval(() => {
    try {
      emitPerformance(reporter, performance.now());
    } catch {
      return;
    }
  }, PERF_WINDOW_MS);
  return reporter;
}

export function startSoccerTelemetry(role: TelemetryRole): SoccerTelemetry {
  try {
    const reporter = activeReporter ?? createReporter(role);
    if (!reporter) return NOOP_TELEMETRY;
    reporter.references++;
    reporter.role = role;
    let stopped = false;
    const guard = (action: () => void) => {
      try {
        action();
      } catch {
        // Telemetry must never interfere with gameplay.
      }
    };
    return {
      setPhase: (phase) => guard(() => {
        reporter.phase = phase.toLowerCase().replace(/[^a-z-]/g, '').slice(0, 24);
      }),
      match: (active) => guard(() => {
        if (reporter.matchActive !== active) {
          reporter.matchActive = active;
          resetWindow(reporter, performance.now());
        }
      }),
      frame: (ms) => guard(() => reporter.frames.frame(ms)),
      quality: (tier, dpr) => guard(() => {
        reporter.tier = tier;
        reporter.dpr = dpr;
      }),
      sent: (seq) => guard(() => reporter.latency.sent(seq, performance.now())),
      ack: (seq) => guard(() => reporter.latency.ack(seq, performance.now())),
      seq: (seq, stream = 0) => guard(() => {
        let loss = reporter.sequences.get(stream);
        if (!loss) reporter.sequences.set(stream, loss = new SeqLoss());
        loss.see(seq);
      }),
      transport: (transport) => guard(() => {
        if (transport === reporter.previousTransport) return;
        if (reporter.previousTransport === 'direct' && transport === 'relay') {
          reporter.dropped++;
          reporter.dropSinceReconnect = true;
        } else if (reporter.previousTransport === 'relay' && transport === 'direct' && reporter.dropSinceReconnect) {
          reporter.reconnects++;
          reporter.dropSinceReconnect = false;
        }
        reporter.previousTransport = transport;
        reporter.transport = transport;
      }),
      stop: () => guard(() => {
        if (stopped) return;
        stopped = true;
        reporter.references = Math.max(0, reporter.references - 1);
        if (!reporter.references) stopReporter(reporter);
      }),
    };
  } catch {
    return NOOP_TELEMETRY;
  }
}

export function reportSoccerError(error: unknown, source: 'react'): void {
  if (activeReporter) reportError(activeReporter, error, source, true);
}
