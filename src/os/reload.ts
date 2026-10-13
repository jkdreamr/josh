import type { AppId, OpenArgs } from './types';

/**
 * Every deploy renames the files it changed, and the old names stop existing. A page that was open across a
 * deploy still asks for the old names the first time it lazily loads something (opening a game, say), and gets a
 * 404. Browsers remember a failed import for the life of the page, so the only fix is a reload onto the new
 * deploy. This module does that reload and brings the visitor straight back to what they were opening.
 */

/** Where to land after the reload: the app, and what it was showing. */
export type Resume = { app: AppId; args?: OpenArgs; fullscreen?: boolean };

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const RESUME_KEY = 'os:resume';
const RELOADED_KEY = 'os:reloaded';
/** A resume older than this (a reload that never finished, a tab restored the next day) is ignored. */
export const RESUME_MS = 60_000;
/** At most one automatic reload in this window, so a file missing from the live deploy too can never loop. */
export const GUARD_MS = 30_000;

// What each engine says when a lazily loaded file fails to download.
const CHUNK_ERRORS = [
  'failed to fetch dynamically imported module', // Chrome, Edge
  'error loading dynamically imported module', // Firefox
  'importing a module script failed', // Safari
  'unable to preload css', // Vite, when the chunk's stylesheet is missing
];

/** True when `error` means a file failed to download, rather than code that ran and threw. */
export function isChunkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const m = message.toLowerCase();
  return CHUNK_ERRORS.some((s) => m.includes(s));
}

function session(): Store | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** True when the site answers right now, so a reload lands on the site rather than the browser's offline page. */
export async function siteReachable(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  try {
    const res = await fetch('/', { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout?.(8000) });
    return res.ok;
  } catch {
    return false;
  }
}

let screen = () => ({ fullscreen: false });
/** The OS reports whether it is in full screen, so a reload comes back the same way. */
export function trackScreen(get: () => { fullscreen: boolean }) {
  screen = get;
}

/**
 * Reloads onto the live deploy and reopens `resume` once it boots. Returns false, without reloading, when an
 * automatic reload already happened moments ago; `force` (the visitor pressed Try Again) skips that check.
 */
export function reloadInto(
  resume?: Resume,
  { force = false, store = session(), now = Date.now(), reload = () => window.location.reload() }: { force?: boolean; store?: Store | null; now?: number; reload?: () => void } = {},
): boolean {
  try {
    const last = store?.getItem(RELOADED_KEY);
    if (!force && (!store || (last && now - Number(last) < GUARD_MS))) return false;
    store?.setItem(RELOADED_KEY, String(now));
    if (resume) store?.setItem(RESUME_KEY, JSON.stringify({ ...resume, ...screen(), at: now }));
    else store?.removeItem(RESUME_KEY);
  } catch {
    // Storage can be full or blocked. Without it there is no loop guard, so only a press of Try Again reloads.
    if (!force) return false;
  }
  reload();
  return true;
}

/** The resume a recent reloadInto left for this boot, if any. Read once: a later reload starts fresh. */
export function takeResume(store = session(), now = Date.now()): Resume | null {
  try {
    const raw = store?.getItem(RESUME_KEY);
    if (!raw) return null;
    store?.removeItem(RESUME_KEY);
    const saved = JSON.parse(raw) as Resume & { at?: unknown };
    if (typeof saved?.app !== 'string' || typeof saved.at !== 'number' || now - saved.at > RESUME_MS || saved.at > now) return null;
    return { app: saved.app, args: saved.args && typeof saved.args === 'object' ? saved.args : undefined, fullscreen: saved.fullscreen === true };
  } catch {
    return null;
  }
}
