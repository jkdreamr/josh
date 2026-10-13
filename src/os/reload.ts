import type { AppId, OpenArgs } from './types';

/**
 * Every deploy renames the files it changed. Each production build keeps a week of older files alongside its own
 * (scripts/keep-old-assets.ts), so a page left open across a deploy keeps working. A page older than that can
 * still ask for a file that is gone, and browsers remember a failed import for the life of the page, so the fix is
 * a reload. This module offers that reload and brings the visitor straight back to what they were opening.
 */

/** Where to land after the reload: the app, and what it was showing. */
export type Resume = { app: AppId; args?: OpenArgs; fullscreen?: boolean };

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const RESUME_KEY = 'os:resume';
const RELOADED_KEY = 'os:reloaded';
/** A resume older than this (a reload that never finished, a tab restored the next day) is ignored. */
export const RESUME_MS = 60_000;
/** A file still missing this soon after a reload is missing from the live site too, so another reload won't help. */
export const RECENT_MS = 30_000;

/** Thrown in place of whatever a lazy import rejected with, so a failed load is never mistaken for a crash. */
export class LoadError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = 'LoadError';
  }
}

/** Wraps a lazy import so its failure arrives as a LoadError. */
export const tagLoad = <T>(load: () => Promise<T>) => () =>
  load().catch((e: unknown) => {
    throw e instanceof LoadError ? e : new LoadError(e);
  });

// What each engine says when a lazily loaded file fails to download, for imports that were not wrapped.
const CHUNK_ERRORS = [
  'failed to fetch dynamically imported module', // Chrome, Edge
  'error loading dynamically imported module', // Firefox
  'importing a module script failed', // Safari
  'unable to preload css', // Vite, when a chunk's stylesheet is missing
];

/** True when `error` means code failed to load, rather than code that ran and threw. */
export function isLoadError(error: unknown): boolean {
  if (error instanceof LoadError || (error instanceof Error && error.name === 'LoadError')) return true;
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

/** The build a page runs: the URL of its app script, which changes whenever any of its code does. */
export const buildOf = (html: string) => html.match(/component-url="([^"]+)"/)?.[1] ?? null;

/**
 * What the site looks like from here: unreachable, answering with an error, serving the same build this page
 * runs, or serving a newer one.
 */
export async function siteState(): Promise<'offline' | 'down' | 'current' | 'updated'> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  try {
    const res = await fetch('/', { cache: 'no-store', signal: AbortSignal.timeout?.(8000) });
    if (!res.ok) return 'down';
    const ours = document.querySelector('astro-island[component-url]')?.getAttribute('component-url');
    return ours && ours === buildOf(await res.text()) ? 'current' : 'updated';
  } catch {
    return 'offline';
  }
}

let screen = () => ({ fullscreen: false });
/** The OS reports whether it is in full screen, so a reload comes back the same way. */
export function trackScreen(get: () => { fullscreen: boolean }) {
  screen = get;
}

/** True when this tab reloaded through reloadInto moments ago. */
export function reloadedRecently(store = session(), now = Date.now()): boolean {
  try {
    const last = store?.getItem(RELOADED_KEY);
    return !!last && now - Number(last) < RECENT_MS;
  } catch {
    return false;
  }
}

/** Reloads onto the live site and reopens `resume` once it boots. Only ever called from a button press. */
export function reloadInto(
  resume?: Resume,
  { store = session(), now = Date.now(), reload = () => window.location.reload() }: { store?: Store | null; now?: number; reload?: () => void } = {},
) {
  try {
    store?.setItem(RELOADED_KEY, String(now));
    if (resume) store?.setItem(RESUME_KEY, JSON.stringify({ ...resume, ...screen(), at: now }));
    else store?.removeItem(RESUME_KEY);
  } catch {
    // Storage can be full or blocked: still reload, just without coming back to the same place.
  }
  reload();
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
