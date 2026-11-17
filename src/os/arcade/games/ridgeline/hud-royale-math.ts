// The royale HUD's arithmetic, kept apart from the drawing so the node tests can load it: compass bearings, the big
// map's picture to the land and back, town names that keep out of each other's way, how far the next circle is and
// whether you will make it, the players left worth announcing, and the tally of your knockouts for the result panel.
import type { Kill } from './match.ts';
import type { Zone, ZonePhase } from './royale.ts';
import { WEAPONS, type WeaponId } from './weapons.ts';

const DEG = 180 / Math.PI;
/** An angle in degrees put in 0 to 360. */
export const norm360 = (d: number) => ((d % 360) + 360) % 360;

/** Which way a view faces, in compass degrees: 0 north (-z, up on the map), 90 east (+x). A yaw faces along
 * (-sin yaw, -cos yaw) (see yawTo in world.ts), so turning right lowers it. */
export const headingOf = (yaw: number) => norm360(-yaw * DEG);

/** The compass bearing from one place to another, in degrees (0 north, 90 east). */
export const bearingTo = (fx: number, fz: number, tx: number, tz: number) => norm360(Math.atan2(tx - fx, -(tz - fz)) * DEG);

/** How far a bearing sits from the heading, -180 (just under) to 180: negative to the left, positive to the right. */
export const compassOffset = (bearing: number, heading: number) => {
  const d = norm360(bearing - heading);
  return d > 180 ? d - 360 : d;
};

/** The big map shows the square of half side `span` round the middle of the land, -z up. A point on it (from its
 * top left corner, in the size it is shown at) to the land. */
export function mapToWorld(px: number, py: number, w: number, h: number, span: number) {
  return { x: (px / w) * 2 * span - span, z: (py / h) * 2 * span - span };
}
/** And a point of the land to the big map. */
export function worldToMap(x: number, z: number, w: number, h: number, span: number) {
  return { x: ((x + span) / (2 * span)) * w, y: ((z + span) / (2 * span)) * h };
}

/** The point of a circle nearest to (x, z) (its middle when it has closed to nothing, or you stand right on it). */
export function nearestOnCircle(x: number, z: number, cx: number, cz: number, r: number) {
  const d = Math.hypot(x - cx, z - cz);
  if (r <= 0 || d < 1e-6) return { x: cx, z: cz };
  return { x: cx + ((x - cx) / d) * r, z: cz + ((z - cz) / d) * r };
}

/** Town names on the big map: each label (its middle and size) is put where it is, or a line above or below,
 * whichever first clears the ones already placed; a label with no room is left off (null). */
export function placeLabels(items: { x: number; y: number; w: number; h: number }[], pad = 2): ({ x: number; y: number } | null)[] {
  const taken: { x0: number; y0: number; x1: number; y1: number }[] = [];
  return items.map((it) => {
    for (const dy of [0, it.h, -it.h, 2 * it.h, -2 * it.h]) {
      const box = { x0: it.x - it.w / 2 - pad, y0: it.y + dy - it.h / 2 - pad, x1: it.x + it.w / 2 + pad, y1: it.y + dy + it.h / 2 + pad };
      if (taken.some((t) => box.x0 < t.x1 && box.x1 > t.x0 && box.y0 < t.y1 && box.y1 > t.y0)) continue;
      taken.push(box);
      return { x: it.x, y: it.y + dy };
    }
    return null;
  });
}

/** Where you stand against the zone: its phase (1 based) of how many, meters to go to be inside the next circle (0
 * inside, or once the zone has closed), the seconds until this phase's closing ends, and whether at `speed` (meters
 * a second) you would still be outside when it does. */
export type ZoneGuide = { phase: number; phases: number; toNext: number; left: number; late: boolean };
export function zoneGuide(z: Pick<Zone, 'i' | 't' | 'shrinking' | 'nx' | 'nz' | 'nr'>, table: readonly ZonePhase[], x: number, zz: number, speed: number): ZoneGuide {
  const phases = table.length;
  if (z.i >= phases) return { phase: phases, phases, toNext: 0, left: 0, late: false };
  const toNext = Math.max(0, Math.hypot(x - z.nx, zz - z.nz) - z.nr);
  const left = Math.max(0, z.t) + (z.shrinking ? 0 : table[z.i].shrink);
  return { phase: z.i + 1, phases, toNext, left, late: toNext > 0 && toNext / speed > left };
}

/** The line under the zone clock: "zone 3 of 7, closing" (or "holds"), and "zone closed" at the end. */
export const zoneLabel = (phase: number, phases: number, closing: boolean, closed: boolean) => (closed ? 'zone closed' : `zone ${phase} of ${phases}, ${closing ? 'closing' : 'holds'}`);

/** How many left gets a banner, each once. */
export const MILESTONES = [50, 25, 10, 5, 2] as const;
/** The milestone just reached going from `prev` players left to `now` (the smallest when several go at once), or
 * null. */
export function milestone(prev: number, now: number): number | null {
  let hit: number | null = null;
  for (const n of MILESTONES) if (now <= n && prev > n) hit = n;
  return hit;
}
export function milestoneText(n: number): { title: string; sub: string } {
  if (n === 2) return { title: 'Final two', sub: 'one more and it is yours' };
  if (n <= 10) return { title: `Top ${n}`, sub: `${n} players left. keep inside the zone` };
  return { title: `${n} left`, sub: n === 50 ? 'half the field is out' : 'a quarter of the field still in' };
}

/** Your knockouts as they happen: how many were headshots, the longest (meters between the two of you), and how many
 * each gun made. */
export type Tally = { kills: number; heads: number; longest: number; guns: Map<WeaponId, number> };
export const newTally = (): Tally => ({ kills: 0, heads: 0, longest: 0, guns: new Map() });
/** Counts a knockout if it is yours (not of yourself). True when it counted. */
export function tallyKill(t: Tally, k: Pick<Kill, 'killer' | 'victim' | 'w' | 'head'>, me: number, dist: number): boolean {
  if (k.killer !== me || k.victim === me) return false;
  t.kills++;
  if (k.head) t.heads++;
  if (Number.isFinite(dist)) t.longest = Math.max(t.longest, dist);
  if (k.w in WEAPONS) t.guns.set(k.w as WeaponId, (t.guns.get(k.w as WeaponId) ?? 0) + 1);
  return true;
}
/** The gun with the most of your knockouts (the first to get there, on a tie), or null. */
export function topGun(t: Tally): WeaponId | null {
  let best: WeaponId | null = null;
  let n = 0;
  for (const [w, c] of t.guns)
    if (c > n) {
      best = w;
      n = c;
    }
  return best;
}

/** What a royale adds to a person's score at the end for their place (as stepRoyale in match.ts does). */
export const placeBonus = (place: number, players: number) => Math.round((players - place + 1) * 12) + (place === 1 ? 600 : 0);

/** How long the result panel shows before the game over card (or, online while others play on, before it goes). */
export const RESULT_SECS = 4;

/** The result panel's numbers. */
export type RoyaleResult = {
  won: boolean;
  place: number;
  total: number;
  kills: number;
  damage: number;
  heads: number;
  longest: number;
  /** Seconds from the start to your knockout (or to the end, still in). */
  time: number;
  gun: string | null;
  /** The score (as the game over card has it), what the fighting made of it and what the place added. */
  score: number;
  combat: number;
  bonus: number;
};
type Me = { alive: boolean; place: number; kills: number; damage: number; cs: number; deathT: number };
/** The result for the player on this machine. Once the match is over the place bonus is already in the score; before
 * that (online, out while others play on) it is what it will add. */
export function royaleResult(m: { me: number; time: number; phase: string; actors: readonly Me[] }, t: Tally, players: number): RoyaleResult {
  const you = m.actors[m.me];
  const over = m.phase === 'over';
  // (still in at the end is the win, as the game over card has it)
  const won = over && you.alive;
  const place = won ? 1 : you.alive ? Math.max(1, m.actors.reduce((n, a) => n + (a.alive ? 1 : 0), 0)) : you.place;
  const bonus = placeBonus(place, players);
  const cs = Math.round(you.cs);
  const score = over ? Math.max(1, cs) : Math.max(1, cs + bonus);
  const g = topGun(t);
  return {
    won,
    place,
    total: m.actors.length,
    kills: you.kills,
    damage: Math.round(you.damage),
    heads: t.heads,
    longest: Math.round(t.longest),
    time: you.alive ? m.time : you.deathT,
    gun: g ? WEAPONS[g].name : null,
    score,
    combat: Math.max(0, score - bonus),
    bonus,
  };
}
