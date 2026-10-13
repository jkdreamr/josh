import { useEffect, useSyncExternalStore } from 'react';
import { ARCADE_API } from './arcade/kit/leaderboard';
import { isGameId, isStatsSummary, isVisitorId, type StatsSummary } from './stats-core';

export { formatCount, PERIODS, type StatsPeriod, type StatsSummary, type TopGame } from './stats-core';

const VISITOR_KEY = 'stats:visitor';
/** Coming back to the tab after this long away is a new visit. */
const RETURN_MS = 30 * 60 * 1000;
/** Keeps the online socket from idling out, like the arcade rooms do. */
const KEEPALIVE_MS = 25_000;
const RETRY_MAX_MS = 5 * 60 * 1000;

let visitor: string | null = null;

/** An anonymous id kept on this device, so a visitor is counted once per day however often they come back. */
function visitorId(): string {
  if (visitor) return visitor;
  try {
    const saved = localStorage.getItem(VISITOR_KEY);
    if (isVisitorId(saved)) return (visitor = saved);
  } catch {
    /* private mode: a fresh id for this page */
  }
  const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  try {
    localStorage.setItem(VISITOR_KEY, id);
  } catch {
    /* ignore */
  }
  return (visitor = id);
}

/** Fire and forget. A plain text body keeps it a simple CORS request, so there is no preflight. */
function send(path: string, body: Record<string, string>) {
  if (!ARCADE_API || typeof window === 'undefined') return;
  try {
    void fetch(`${ARCADE_API}${path}`, { method: 'POST', body: JSON.stringify(body), keepalive: true }).catch(() => {});
  } catch {
    /* ignore */
  }
}

export function countView() {
  send('/stats/view', { visitor: visitorId() });
}

/** One game played: a round started, a match begun, or a game app opened. */
export function countPlay(game: string) {
  if (isGameId(game)) send('/stats/play', { game, visitor: visitorId() });
}

/** Holds one socket open to the Worker while the site is open, so this visitor counts as online. Reconnects after drops. */
function stayOnline() {
  if (!ARCADE_API || typeof WebSocket === 'undefined') return;
  let socket: WebSocket | null = null;
  let retries = 0;
  let retryTimer = 0;
  const connect = () => {
    window.clearTimeout(retryTimer);
    if (socket) return;
    let url: URL;
    try {
      url = new URL(ARCADE_API);
    } catch {
      return;
    }
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/stats/live`;
    url.search = new URLSearchParams({ visitor: visitorId() }).toString();
    const ws = new WebSocket(url);
    let keepAlive = 0;
    socket = ws;
    ws.addEventListener('open', () => {
      retries = 0;
      keepAlive = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send('ping');
      }, KEEPALIVE_MS);
    });
    ws.addEventListener('close', () => {
      window.clearInterval(keepAlive);
      socket = null;
      retryTimer = window.setTimeout(connect, Math.min(RETRY_MAX_MS, 2000 * 2 ** retries++));
    });
  };
  connect();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) connect();
  });
}

let watching = false;

/**
 * Counts this page load (a refresh is a new load), a back/forward restore, and a return to the tab after half an hour away,
 * and keeps the visitor counted as online while the site is open in any tab.
 */
export function watchVisits(countNow = true) {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  if (countNow) countView();
  stayOnline();
  let hiddenAt = document.hidden ? Date.now() : 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      return;
    }
    if (hiddenAt && Date.now() - hiddenAt >= RETURN_MS) countView();
    hiddenAt = 0;
  });
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) countView();
  });
}

export type StatsStatus = 'loading' | 'ready' | 'failed';
type StatsStore = { status: StatsStatus; summary: StatsSummary | null };

const initialStore: StatsStore = { status: 'loading', summary: null };
let store = initialStore;
let inFlight = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(next: StatsStore) {
  store = next;
  listeners.forEach((listener) => listener());
}

function refreshStats() {
  if (inFlight) return;
  if (!ARCADE_API) {
    publish({ status: 'failed', summary: null });
    return;
  }
  inFlight = true;
  publish({ ...store, status: store.summary ? 'ready' : 'loading' });
  void fetch(`${ARCADE_API}/stats`, { cache: 'no-store' })
    .then((res) => {
      if (!res.ok) throw new Error(`Stats request failed: ${res.status}`);
      return res.json();
    })
    .then((data: unknown) => {
      if (!isStatsSummary(data)) throw new Error('Stats response was invalid');
      publish({ status: 'ready', summary: data });
    })
    .catch(() => publish({ ...store, status: store.summary ? 'ready' : 'failed' }))
    .finally(() => {
      inFlight = false;
    });
}

/** Site-wide totals. Fetches when mounted and every `pollMs` while mounted. */
export function useStats(pollMs = 10_000): StatsStore & { refresh: () => void } {
  const snapshot = useSyncExternalStore(subscribe, () => store, () => initialStore);
  useEffect(() => {
    refreshStats();
    const t = window.setInterval(() => {
      if (!document.hidden) refreshStats();
    }, pollMs);
    return () => window.clearInterval(t);
  }, [pollMs]);
  return { ...snapshot, refresh: refreshStats };
}
