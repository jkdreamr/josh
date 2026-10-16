import type { Game } from './logic.ts';

/** What a guest does with a table the host sent. */
export type GuestSync = 'adopt' | 'apply' | 'queue' | 'ignore';

/**
 * The host deals and owns every table. A guest that hasn't had this round's table yet takes the host's as is, and a
 * fresh deal (same shot count, another rack) replaces whatever it had; otherwise it only moves forward.
 */
export function guestSync(local: Game, next: Game, synced: boolean, rolling: boolean): GuestSync {
  if (!synced) return 'adopt';
  if (next.shots < local.shots) return 'ignore';
  if (rolling) return next.shots > local.shots ? 'queue' : 'ignore';
  if (next.shots === local.shots && next.seed !== local.seed) return 'adopt';
  if (next.shots > local.shots || next.phase !== local.phase) return 'apply';
  return 'ignore';
}

/**
 * Reads the shoot key once a frame. The press is always used up, so a tap while the balls roll or the other player is
 * up is dropped instead of firing the next shot on its own.
 */
export function shootPressed(keys: { pressed(...names: string[]): boolean }, canShoot: boolean): boolean {
  return keys.pressed('action') && canShoot;
}
