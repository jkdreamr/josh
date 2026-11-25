// Royale pickup toasts: what you just took, a line each at the right edge for a moment, tinted by how good it is. The
// list's rules (merge, cap, expiry) and the reading of a frame's pickup events live here as pure TS, so the tests can
// run them; hud-loot.tsx draws the lines.
import { nadesOf, type Actor, type Match } from './match.ts';
import { AMMO_KINDS, AMMO_NAME, ATT_NAME, BOOST, HEAL, NADE_NAME, ROYALE_NADES, itemName, type AmmoKind, type AttKind, type BoostKind, type HealKind, type Item, type RoyaleNade } from './royale.ts';
import { WEAPONS, type WeaponId } from './weapons.ts';
import { lootTier, type LootTier } from './loot-tier.ts';

/** At most this many lines at once, each shown this many seconds. */
export const TOAST_MAX = 4;
export const TOAST_LIFE = 2.5;

/** One line: what was taken, its tier, how many came in (0 when not known), and when (seconds, any clock). */
export type Toast = { key: number; text: string; tier: LootTier; plus: number; at: number };

/** The lines still showing at `now`. */
export const liveToasts = (list: readonly Toast[], now: number) => list.filter((t) => now - t.at < TOAST_LIFE);

/** When the next line runs out (Infinity with none). */
export const nextExpiry = (list: readonly Toast[]) => list.reduce((s, t) => Math.min(s, t.at + TOAST_LIFE), Infinity);

/**
 * Adds a line (newest last). One with the same text still showing is folded into it: the counts add up and it shows
 * afresh at the bottom. Past TOAST_MAX the oldest goes, and run out ones are dropped. Returns a new array.
 */
export function addToast(list: readonly Toast[], t: Toast, now: number): Toast[] {
  const out = liveToasts(list, now);
  const same = out.findIndex((o) => o.text === t.text);
  let add = t;
  if (same >= 0) {
    add = { ...t, plus: out[same].plus + t.plus };
    out.splice(same, 1);
  }
  out.push(add);
  return out.slice(-TOAST_MAX);
}

/** What a toast says: the item's name, without the count left on the ground for the kinds that stack. */
export function toastText(it: Pick<Item, 'kind' | 'what' | 'n' | 'mods'>): string {
  switch (it.kind) {
    case 'ammo':
      return `${AMMO_NAME[it.what as AmmoKind] ?? 'Ammo'} ammo`;
    case 'heal':
      return HEAL[it.what as HealKind]?.name ?? 'Heal';
    case 'boost':
      return BOOST[it.what as BoostKind]?.name ?? 'Boost';
    case 'nade':
      return NADE_NAME[it.what as RoyaleNade] ?? 'Grenade';
    case 'att':
      return ATT_NAME[it.what as AttKind] ?? 'Attachment';
    case 'gun':
      if (!WEAPONS[it.what as WeaponId]) return 'Gun';
      break;
  }
  return itemName({ id: -1, x: 0, y: 0, z: 0, live: false, ...it }, (id) => WEAPONS[id].name);
}

/** The kinds you carry a count of, as "kind:what". */
const STACKS: string[] = [...AMMO_KINDS.map((k) => `ammo:${k}`), 'heal:bandage', 'heal:kit', 'boost:drink', 'boost:pills', ...ROYALE_NADES.map((k) => `nade:${k}`)];
const stackOf = (it: Pick<Item, 'kind' | 'what'>) => {
  const k = `${it.kind}:${it.what}`;
  return STACKS.includes(k) ? k : null;
};
/** How many of a stacking kind someone carries. */
export function carried(a: Actor, key: string): number {
  const [kind, what] = key.split(':');
  if (kind === 'ammo') return a.ammo[what as AmmoKind] ?? 0;
  if (kind === 'heal') return what === 'kit' ? a.kits : a.bandages;
  if (kind === 'boost') return what === 'pills' ? a.pills : a.drinks;
  return nadesOf(a, what as RoyaleNade);
}

/**
 * Turns each frame's pickup events for your own seat into toasts. How many of a stacking kind came in is known only
 * where the rules run (offline, or the online host): it is what you carry now against what you carried at the end of
 * the frame before. An online guest is told what it took (the host's pickup event) but not how many, so its lines
 * carry no count.
 */
export class PickupFeed {
  private of: Match | null = null;
  private last = new Map<string, number>();
  private n = 0;
  /** The new lines this frame (call once a frame, after the step). */
  take(m: Match, now: number): Toast[] {
    if (m !== this.of) {
      this.of = m;
      this.last.clear();
    }
    const you = m.actors[m.me];
    let out: Toast[] | null = null;
    for (const e of m.events) {
      if (e.t !== 'pickup' || e.a !== m.me) continue;
      const it = e.item;
      const key = stackOf(it);
      let plus = 0;
      if (key && m.authority) {
        const before = this.last.get(key);
        const have = carried(you, key);
        if (before !== undefined && have > before) plus = have - before;
        // (a second box of the same kind this frame: the first line already has the whole count)
        this.last.set(key, have);
      }
      (out ??= []).push({ key: ++this.n, text: toastText(it), tier: lootTier(it), plus, at: now });
    }
    for (const k of STACKS) this.last.set(k, carried(you, k));
    return out ?? [];
  }
}
