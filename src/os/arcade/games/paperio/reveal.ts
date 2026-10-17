// The board's reveal clock. Each grid texel stores its owner (r), the owner it showed before (g) and when the new
// owner appears (b), on an 8-bit clock of 1/60 s units that wraps every 256 units (about 4.3 s). The shader shows the
// new owner once its time has come, with a short glow, and the old one before that. Because the clock wraps, a
// finished change must be settled (g = r) before its age comes round again: the glow only plays while g != r, so a
// settled texel never glows again, and the old owner never comes back.

/** Ages below this show the new owner; at or above it the change is still waiting (or stale, if never settled). */
export const SHOW = 192;
/** The glow lasts this many units after the new owner appears. */
export const GLOW = 20;
/** From this age on a change is long finished and gets settled. */
export const SETTLE = 90;
/** The longest a change may wait before it appears (sweeps, deaths, spawns). */
export const MAX_DELAY = 60;
/** The janitor visits every row at least once per this many units, so each change is seen while it can be settled. */
export const PASS = 48;

/** Units since stamp on the wrapping clock (0-255). */
export const age = (now: number, stamp: number) => (((now - stamp) % 256) + 256) % 256;

/** When a change made at `now` appears, after `delay` units. */
export const stampFor = (now: number, delay: number) => (Math.floor(now) + 1 + Math.min(MAX_DELAY, delay)) & 255;

/**
 * Writes a new owner into texel i of an RGBA grid: the old owner becomes whatever the texel shows right now, and the
 * new one appears `delay` units from now. The caller has checked that the owner really changed.
 */
export function restamp(data: Uint8Array, i: number, owner: number, now: number, delay: number) {
  if (age(now, data[i + 2]) < SHOW) data[i + 1] = data[i];
  data[i] = owner;
  data[i + 2] = stampFor(now, delay);
}

/** Settles texel i once its change is long finished. True when it changed (it needs uploading). */
export function settle(data: Uint8Array, i: number, now: number) {
  if (data[i + 1] === data[i]) return false;
  const a = age(now, data[i + 2]);
  if (a < SETTLE || a >= SHOW) return false;
  data[i + 1] = data[i];
  return true;
}

/** Rows the janitor visits this frame, for a grid of n rows after the clock moved du units. */
export const janitorRows = (n: number, du: number) => Math.min(n, Math.max(24, Math.ceil((n * Math.max(0, du)) / PASS)));

/** What the board shader shows for a texel (r, g, b) at clock uNow (0-256): the owner and its glow (0-1). */
export function shown(r: number, g: number, b: number, uNow: number): { owner: number; glow: number } {
  const a = (((uNow - b + 256) % 256) + 256) % 256;
  if (a < SHOW) return { owner: r, glow: r > 0 && g !== r ? Math.max(0, 1 - a / GLOW) : 0 };
  return { owner: g, glow: 0 };
}
