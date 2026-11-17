// The time of day a match plays at. Breach and deathmatch always look the way their map was made (its day); a royale
// picks day, a golden dusk or an overcast sky from its seed, which every machine in an online match shares, so the
// host and the guests see the same sky without anything new on the wire. The Setup's Sky choice can force one: the
// online host forces it by picking a seed that makes it (seedFor).
import type { MapDef } from './maps.ts';

export type LookId = 'day' | 'dusk' | 'overcast';
export const LOOK_IDS: readonly LookId[] = ['day', 'dusk', 'overcast'];
/** The Setup's Sky setting: let each match pick, or always one look. */
export type SkyChoice = 'auto' | LookId;

/** How often each look comes up when the match picks: half the matches by day, a quarter each at dusk and overcast. */
export const LOOK_WEIGHTS: Record<LookId, number> = { day: 0.5, dusk: 0.25, overcast: 0.25 };

/** A number in [0, 1) from the seed alone, apart from the streams the seed also drives (loot, cars, bots). */
export function lookRoll(seed: number) {
  let h = (seed ^ 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x297a2d39) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x58f1d1b5) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

/** The look the seed picks, before the map has its say. */
function rolled(seed: number): LookId {
  const r = lookRoll(seed);
  return r < LOOK_WEIGHTS.day ? 'day' : r < LOOK_WEIGHTS.day + LOOK_WEIGHTS.dusk ? 'dusk' : 'overcast';
}

/**
 * The look a match plays at: day outside a royale, else the Sky choice if one is forced, else the seed's pick. A look
 * the map has no recipe for is its day.
 */
export function lookOf(mode: string, seed: number | undefined, choice: SkyChoice, def: Pick<MapDef, 'looks'>): LookId {
  if (mode !== 'royale') return 'day';
  const id = choice !== 'auto' ? choice : seed === undefined ? 'day' : rolled(seed);
  return id === 'day' || def.looks?.[id] ? id : 'day';
}

/**
 * A seed for an online royale whose pick is the Sky choice (the guests derive the look from the seed alone). Steps
 * from the given seed to the next one that rolls it, so the seed stays as random as it was. Auto keeps the seed.
 */
export function seedFor(seed: number, choice: SkyChoice) {
  if (choice === 'auto') return seed >>> 0;
  let s = seed >>> 0;
  for (let k = 0; k < 4096 && rolled(s) !== choice; k++) s = (s + 1) >>> 0;
  return s;
}

/** The map as it looks at that time of day: its sun, sky, haze, sky light and grade swapped for the look's. */
export function withLook(def: MapDef, id: LookId): MapDef {
  const l = id === 'day' ? undefined : def.looks?.[id];
  return l ? { ...def, sun: l.sun, sky: l.sky, fog: l.fog, ambient: l.ambient, grade: l.grade } : def;
}
