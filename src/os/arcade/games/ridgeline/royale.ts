// Royale data: what lies around to pick up and how much of it, the ammo each gun takes, armor and helmets, heals, the
// shrinking zone's timetable, and the transport's flight line. Pure TS with no state of its own; match.ts runs it.
import { mulberry32, type Rng } from './noise.ts';
import { CELL, T_HALF, T_RES, heightAt } from './terrain.ts';
import { PAVISE, WEAPONS, type WeaponClass, type WeaponId } from './weapons.ts';
import type { World } from './world.ts';

export const ROYALE_PLAYERS = 100;

export type AmmoKind = 'light' | 'rifle' | 'shells' | 'magnum' | 'sniper' | 'bolts';
export const AMMO_KINDS: AmmoKind[] = ['light', 'rifle', 'shells', 'magnum', 'sniper', 'bolts'];
export const AMMO_OF: Record<WeaponId, AmmoKind> = { wren: 'light', hornet: 'light', bulwark: 'magnum', mauler: 'shells', kestrel: 'rifle', lancer: 'rifle', longbow: 'sniper', talon: 'rifle', rampart: 'rifle', marshal: 'magnum', wasp: 'light', thresher: 'shells', arbalest: 'bolts' };
export const AMMO_NAME: Record<AmmoKind, string> = { light: '9mm', rifle: '5.56', shells: '12 gauge', magnum: '.50 AE', sniper: '.338', bolts: 'Bolts' };
/** Rounds in a box on the ground, and the most you can carry. */
export const AMMO_PACK: Record<AmmoKind, number> = { light: 30, rifle: 30, shells: 10, magnum: 14, sniper: 10, bolts: 6 };
export const AMMO_MAX: Record<AmmoKind, number> = { light: 210, rifle: 210, shells: 60, magnum: 70, sniper: 50, bolts: 30 };

/** Armor points a vest of each level gives, and how much of a head hit a helmet lets through. */
export const VEST = [0, 40, 70, 100];
export const HELMET = [1, 0.72, 0.58, 0.46];

export type HealKind = 'bandage' | 'kit';
export const HEAL: Record<HealKind, { time: number; to: number; add: number; max: number; name: string }> = {
  bandage: { time: 2.6, to: 75, add: 15, max: 10, name: 'Bandage' },
  kit: { time: 5.5, to: 100, add: 100, max: 3, name: 'Med kit' },
};
/** The grenades a royale has (no flashbangs), and how many of each you carry without a backpack. */
export type RoyaleNade = 'frag' | 'smoke' | 'fire' | 'impact' | 'decoy';
export const ROYALE_NADES: RoyaleNade[] = ['frag', 'smoke', 'fire', 'impact', 'decoy'];
export const NADE_MAX: Record<RoyaleNade, number> = { frag: 3, smoke: 2, fire: 2, impact: 2, decoy: 1 };

/** Boosts: an energy drink or a bottle of painkillers fills the boost meter (0 to 100), which drains by BOOST_DRAIN
 * a second. While it is up you mend slowly (BOOST_HEAL a second at the bottom, BOOST_HEAL_TOP at the top, never past
 * 100), and from BOOST_FAST up you run a little faster. */
export type BoostKind = 'drink' | 'pills';
export const BOOST: Record<BoostKind, { time: number; add: number; max: number; name: string }> = {
  drink: { time: 2.2, add: 40, max: 4, name: 'Energy drink' },
  pills: { time: 3.6, add: 60, max: 2, name: 'Painkillers' },
};
export const BOOST_DRAIN = 1.1;
export const BOOST_HEAL = 0.4;
export const BOOST_HEAL_TOP = 1.2;
export const BOOST_FAST = 60;
export const BOOST_RUN = 1.06;
/** Anything used from the kit (a heal or a boost): how long it takes and what it is called. */
export type UseKind = HealKind | BoostKind;
export const USE: Record<UseKind, { time: number; name: string }> = { ...HEAL, ...BOOST };
/** Health a second the boost gives back at this level of the meter. */
export const boostHeal = (boost: number) => (boost > 0 ? BOOST_HEAL + (BOOST_HEAL_TOP - BOOST_HEAL) * Math.min(1, boost / 100) : 0);

/** Backpacks, levels 1 to 3: ammo carried goes up by PACK_AMMO, and heals, boosts and grenades by PACK_MORE of each
 * kind (none for level 0, no pack). */
export const PACK_AMMO = [1, 1.4, 1.8, 2.2];
export const PACK_MORE: Record<HealKind | BoostKind | RoyaleNade, number[]> = {
  bandage: [0, 4, 8, 12],
  kit: [0, 1, 2, 3],
  drink: [0, 2, 4, 6],
  pills: [0, 1, 2, 3],
  frag: [0, 1, 2, 3],
  smoke: [0, 1, 2, 2],
  fire: [0, 1, 1, 2],
  impact: [0, 1, 2, 2],
  decoy: [0, 0, 1, 1],
};
/** The most of a kind someone with this pack can carry. */
export const ammoCap = (pack: number, k: AmmoKind) => Math.round(AMMO_MAX[k] * PACK_AMMO[pack]);
export const healCap = (pack: number, k: HealKind) => HEAL[k].max + PACK_MORE[k][pack];
export const boostCap = (pack: number, k: BoostKind) => BOOST[k].max + PACK_MORE[k][pack];
export const nadeCap = (pack: number, k: RoyaleNade) => NADE_MAX[k] + PACK_MORE[k][pack];

/** Attachments for long guns: a red dot (a cleaner sight picture and a little zoom), a 4x scope (zoom 4 and the
 * scope view), an extended magazine (half as many rounds again) and a compensator (less bloom and recoil). A gun
 * carries at most one sight, one magazine and one muzzle; they stay on it wherever it goes. */
export type AttKind = 'dot' | 'x4' | 'ext' | 'comp';
export const ATT_NAME: Record<AttKind, string> = { dot: 'Red dot sight', x4: '4x scope', ext: 'Extended magazine', comp: 'Compensator' };
export const ATT_SHORT: Record<AttKind, string> = { dot: 'dot', x4: '4x', ext: 'ext', comp: 'comp' };
/** Which classes each fits: a sight only on guns without a scope of their own, nothing on the muzzle of a shotgun. */
const ATT_FITS: Record<AttKind, WeaponClass[]> = { dot: ['smg', 'rifle', 'shotgun', 'lmg'], x4: ['rifle', 'dmr', 'lmg', 'crossbow'], ext: ['smg', 'rifle', 'dmr', 'sniper', 'lmg'], comp: ['smg', 'rifle', 'dmr', 'sniper', 'lmg'] };
export const DOT_ZOOM = 1.4;
export const X4_ZOOM = 4;
export const EXT_MAG = 1.5;
/** A compensator's share of the bloom and recoil left, and what each sight does to the aimed cone. */
export const COMP_BLOOM = 0.6;
export const COMP_KICK = 0.65;
export const DOT_ADS = 0.8;
export const X4_ADS = 0.72;
/** What is fitted to a gun (royale only; guns elsewhere have none). */
export type Mods = { sight: 'dot' | 'x4' | null; ext: boolean; comp: boolean };
/** Anything with a gun id and maybe attachments: a gun carried, or one lying on the ground. */
type Armed = { id: WeaponId; mods?: Mods | null };
export const fits = (id: WeaponId, k: AttKind) => WEAPONS[id].slot === 'primary' && ATT_FITS[k].includes(WEAPONS[id].cls);
/** Does this gun already have something in the place `k` goes? */
export const fitted = (g: Armed, k: AttKind) => (k === 'ext' ? !!g.mods?.ext : k === 'comp' ? !!g.mods?.comp : !!g.mods?.sight);
export const hasAtt = (g: Armed, k: AttKind) => (k === 'ext' ? !!g.mods?.ext : k === 'comp' ? !!g.mods?.comp : g.mods?.sight === k);
/** Rounds in a full magazine, aim zoom, whether aiming brings up the scope view, and the time it takes to aim. */
export const magOf = (g: Armed) => (g.mods?.ext ? Math.round(WEAPONS[g.id].mag * EXT_MAG) : WEAPONS[g.id].mag);
export const zoomOf = (g: Armed) => (g.mods?.sight === 'x4' ? X4_ZOOM : g.mods?.sight === 'dot' ? Math.max(DOT_ZOOM, WEAPONS[g.id].zoom) : WEAPONS[g.id].zoom);
export const scopeOf = (g: Armed) => (g.mods?.sight === 'x4' ? true : g.mods?.sight === 'dot' ? false : WEAPONS[g.id].scope);
export const adsTimeOf = (g: Armed) => (g.mods?.sight === 'x4' ? Math.max(WEAPONS[g.id].adsTime, 0.26) : WEAPONS[g.id].adsTime);
/** The aimed cone multiplier, with a sight's help. */
export const adsOf = (g: Armed) => WEAPONS[g.id].ads * (g.mods?.sight === 'dot' ? DOT_ADS : g.mods?.sight === 'x4' ? X4_ADS : 1);
/** A gun's name with what is fitted to it: "Kestrel · 4x · ext". */
export function gunLabel(g: Armed) {
  const md = g.mods;
  if (!md || (!md.sight && !md.ext && !md.comp)) return WEAPONS[g.id].name;
  let s = WEAPONS[g.id].name;
  if (md.sight) s += ` · ${ATT_SHORT[md.sight]}`;
  if (md.ext) s += ' · ext';
  if (md.comp) s += ' · comp';
  return s;
}
/** Fits one to a gun (replacing a sight already there); returns the sight taken off, if any. */
export function attach(g: { id: WeaponId; mods?: Mods | null }, k: AttKind): AttKind | null {
  const md = g.mods ?? (g.mods = { sight: null, ext: false, comp: false });
  if (k === 'ext') md.ext = true;
  else if (k === 'comp') md.comp = true;
  else {
    const old = md.sight;
    md.sight = k;
    return old && old !== k ? old : null;
  }
  return null;
}

export type ItemKind = 'gun' | 'ammo' | 'vest' | 'helmet' | 'heal' | 'nade' | 'pack' | 'boost' | 'att' | 'shield';
/** Something lying on the ground. `what` is a gun id, an ammo kind, a level ('1' to '3'), a heal, boost, grenade or
 * attachment kind. A gun keeps what is fitted to it (`mods`); `by` is whoever put it down (walking over it again
 * never takes it back by itself). A shield's count is what it has left before it breaks. */
export type Item = { id: number; kind: ItemKind; what: string; n: number; x: number; y: number; z: number; live: boolean; mods?: Mods | null; by?: number };

/** One phase of the zone: it holds for `wait` seconds, then closes to radius `r` over `shrink`; outside costs `dps`. */
export type ZonePhase = { wait: number; shrink: number; r: number; dps: number };
// (about ten minutes in all; every close is slow enough that someone at the far side of the old circle can keep
// ahead of it on foot, with the next centre as far off as nextCircle ever puts it)
export const ZONES: ZonePhase[] = [
  { wait: 120, shrink: 75, r: 250, dps: 1 },
  { wait: 65, shrink: 45, r: 165, dps: 2 },
  { wait: 50, shrink: 40, r: 105, dps: 3 },
  { wait: 45, shrink: 35, r: 62, dps: 5 },
  { wait: 40, shrink: 30, r: 34, dps: 8 },
  { wait: 30, shrink: 25, r: 16, dps: 11 },
  { wait: 20, shrink: 25, r: 0, dps: 14 },
];

/** Pacing: how many should be left at each point of a match ([match seconds, alive] knots, read in between). Fitted
 * to what the bots really do on these maps: a hot drop loses about a quarter of the lobby in the first minute and a
 * half, then the curve bends gently, with a knockout in most half minutes, the last ten around the seventh minute
 * and the last two near the end of the zone. */
export const PACE_KNOTS: [number, number][] = [
  [0, 100],
  [50, 100],
  [100, 70],
  [160, 49],
  [230, 35],
  [305, 24],
  [395, 14],
  [475, 9],
  [545, 5],
  [600, 3],
  [645, 2],
];
/** The fewest left the curve wants at this match time. */
export function aliveTarget(t: number) {
  const K = PACE_KNOTS;
  if (t <= K[0][0]) return K[0][1];
  for (let i = 1; i < K.length; i++)
    if (t <= K[i][0]) {
      const [t0, a0] = K[i - 1];
      const [t1, a1] = K[i];
      return a0 + ((a1 - a0) * (t - t0)) / (t1 - t0);
    }
  return K[K.length - 1][1];
}
/** The lowest pace there is: ahead of the curve, bots leave each other be unless they bump into each other or are
 * shot at. */
export const PACE_FLOOR = 0;
/** How readily bots pick fights with other bots, 0 to 1 (the chance a second that a bot sets about another it has
 * seen): full when the match is well behind the curve (more left than it wants), down to the floor once the knockouts
 * have run a few ahead of it. */
export const paceOf = (alive: number, t: number) => Math.min(1, Math.max(PACE_FLOOR, (alive - aliveTarget(t) + 3) / 9));
/** Bots within this of each other always notice (they have bumped into each other), whatever the pace. */
export const PACE_CLOSE = 2.5;
/** A bot hurt in a fight with a bot it did not pick, that bot over CALM_D away, may break off and leave it alone
 * for CALM_T seconds (the further ahead of the curve, the more often). */
export const CALM_HP = 95;
export const CALM_D = 10;
export const CALM_T = 5;
/** Loot within this of another bot, or of what a nearer bot is going for, is left to that bot (on a pace roll). */
export const CLAIM_R = 25;
/** One bot on another aims worse while the match runs ahead of its pace: its aim error is multiplied by this, so
 * its chance to hit goes roughly with 0.4 + 0.6 * pace (never on people). */
export const paceAim = (pace: number) => 1 / (0.4 + 0.6 * pace);
/** The most bots that pick out the same person on their own at once, per level (whoever that person shoots at, or
 * who is close, still notices them; on easy none go looking for you from afar at all). */
export const HEAT_CAP: Record<'easy' | 'normal' | 'hard', number> = { easy: 0, normal: 1, hard: 3 };
/** A person who landed under this many seconds ago with no gun yet is left alone unless close. */
export const LAND_GRACE = 40;
/** Bots set about a person they see (past PACE_CLOSE, not yet fighting them) on a roll of max(pace, PERSON_FLOOR) a
 * second, by level: a person meets fights all match long, but is never the one thing the bots go for. */
export const PERSON_FLOOR: Record<'easy' | 'normal' | 'hard', number> = { easy: 0.1, normal: 0.1, hard: 0.25 };
/** Warning shots: on a new target that is a person past WARN_D, a bot's first aim error is this many times its
 * usual, by tier (recruit to ace). */
export const WARN_D = 25;
export const WARN_SHOT = [1.8, 1.5, 1.2, 1];
/** Skill tiers for a royale's bots: their share of the lobby, and what each does to the level's skill and reaction
 * time (recruits, regulars, veterans, aces). */
export const TIERS: { share: number; skill: number; react: number }[] = [
  { share: 0.5, skill: 0.55, react: 1.9 },
  { share: 0.32, skill: 0.88, react: 1.45 },
  { share: 0.14, skill: 1.2, react: 1.15 },
  { share: 0.04, skill: 1.5, react: 0.95 },
];
/** The tier a roll of 0 to 1 lands on. */
export function tierOf(roll: number) {
  let acc = 0;
  for (let i = 0; i < TIERS.length; i++) {
    acc += TIERS[i].share;
    if (roll < acc) return i;
  }
  return TIERS.length - 1;
}

export type Zone = {
  /** Phase index (ZONES.length once it has closed). */
  i: number;
  /** Seconds left in this phase's wait, then its shrink. */
  t: number;
  shrinking: boolean;
  /** The circle now, where it started this phase, and where it is going. */
  x: number;
  z: number;
  r: number;
  fx: number;
  fz: number;
  fr: number;
  nx: number;
  nz: number;
  nr: number;
  dps: number;
};

/** The transport: a straight line across the land at a fixed height. */
export type Plane = { ax: number; az: number; bx: number; bz: number; y: number; speed: number; len: number };
export const PLANE_SPEED = 24;
/** Freefall and parachute: fall speeds, glide speeds, and the height above ground the canopy opens by itself. */
export const FALL_VY = -42;
export const FALL_FAST = 34;
export const FALL_SLOW = 14;
export const CHUTE_VY = -5.6;
export const CHUTE_GLIDE = 10;
export const CHUTE_OPEN = 90;

export function planePath(w: World, r: Rng): Plane {
  const a = r() * Math.PI * 2;
  const off = (r() - 0.5) * 2 * w.arena * 0.45;
  const dx = Math.cos(a);
  const dz = Math.sin(a);
  const reach = w.arena + 70;
  const cx = -dz * off;
  const cz = dx * off;
  let top = 0;
  for (let x = -w.arena; x <= w.arena; x += 30) for (let z = -w.arena; z <= w.arena; z += 30) top = Math.max(top, heightAt(w.terrain, x, z));
  return { ax: cx - dx * reach, az: cz - dz * reach, bx: cx + dx * reach, bz: cz + dz * reach, y: top + 190, speed: PLANE_SPEED, len: reach * 2 };
}

export function planeAt(p: Plane, t: number) {
  const k = Math.min(1, (t * p.speed) / p.len);
  return { x: p.ax + (p.bx - p.ax) * k, z: p.az + (p.bz - p.az) * k, k };
}

/** On the walkable ground (the world's region)? */
export const onLand = (w: World, x: number, z: number) => {
  const i = Math.round((x + T_HALF) / CELL);
  const j = Math.round((z + T_HALF) / CELL);
  return i >= 0 && j >= 0 && i < T_RES && j < T_RES && w.region[j * T_RES + i] === 1;
};

/** The next circle: inside the current one, on walkable land. */
export function nextCircle(w: World, r: Rng, x: number, z: number, cur: number, next: number): [number, number] {
  if (next <= 0) return [x, z];
  for (let k = 0; k < 60; k++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * Math.max(0, cur - next) * 0.92;
    const nx = Math.max(-w.arena + next * 0.5, Math.min(w.arena - next * 0.5, x + Math.cos(a) * d));
    const nz = Math.max(-w.arena + next * 0.5, Math.min(w.arena - next * 0.5, z + Math.sin(a) * d));
    if (Math.hypot(nx - x, nz - z) + next > cur + 0.01) continue;
    if (onLand(w, nx, nz)) return [nx, nz];
  }
  return [x, z];
}

/** Supply drops: one after each of the first zones closes, at most SUPPLY_MAX a match. A crate drops under its
 * canopy from SUPPLY_HIGH above the ground at SUPPLY_FALL m/s, somewhere inside the next circle, and once down its
 * smoke burns for SUPPLY_SMOKE seconds so everyone can see where it is. */
export const SUPPLY_MAX = 4;
export const SUPPLY_HIGH = 140;
export const SUPPLY_FALL = 7;
export const SUPPLY_SMOKE = 90;
/** A crate on its way down or landed: where, the ground under it, when it landed (-1 still falling), and the loot
 * it put out (ids into the match's loot). */
export type Supply = { id: number; x: number; y: number; z: number; ground: number; landed: number; items: number[] };

/** What a crate holds: one of the best guns and all the ammo it can carry, the best vest, helmet and backpack, a 4x
 * scope and an extended magazine, a med kit or two, painkillers, and sometimes a pair of frags. A gun's count is
 * filled in by the match (its magazine). */
export function supplyContents(r: Rng): [ItemKind, string, number][] {
  const g = (['longbow', 'lancer', 'kestrel', 'rampart'] as WeaponId[])[Math.floor(r() * 4)];
  const out: [ItemKind, string, number][] = [
    ['gun', g, 0],
    ['ammo', AMMO_OF[g], AMMO_MAX[AMMO_OF[g]]],
    ['vest', '3', 1],
    ['helmet', '3', 1],
    ['pack', '3', 1],
    ['att', 'x4', 1],
    ['att', 'ext', 1],
    ['heal', 'kit', r() < 0.5 ? 1 : 2],
    ['boost', 'pills', 1],
  ];
  if (r() < 0.5) out.push(['nade', 'frag', 2]);
  return out;
}

/** The bombardment ("red zone"): now and then a circle RED_R wide (radius, from and to) inside the zone is marked,
 * RED_WARN seconds later it is shelled for RED_LIVE seconds, a shell every RED_EVERY seconds or so, each hurting
 * anyone in the open within SHELL_R (a roof over your head keeps you safe). The first comes RED_FIRST seconds in,
 * then one every RED_GAP. */
export const RED_R: [number, number] = [30, 45];
export const RED_WARN = 8;
export const RED_LIVE = 15;
export const RED_EVERY: [number, number] = [0.16, 0.38];
export const RED_FIRST: [number, number] = [110, 150];
export const RED_GAP: [number, number] = [75, 110];
export const SHELL_R = 9;
export const SHELL_DMG = 125;
/** A bombardment: its circle, the warning left, the shelling left, and the time to the next shell. */
export type Red = { x: number; z: number; r: number; warn: number; left: number; next: number };

const pick = <T,>(r: Rng, table: [T, number][]): T => {
  let roll = r() * table.reduce((s, [, p]) => s + p, 0);
  for (const [v, p] of table) {
    roll -= p;
    if (roll <= 0) return v;
  }
  return table[0][0];
};

const GUNS: [WeaponId, number][] = [
  ['wren', 18],
  ['hornet', 14],
  ['kestrel', 14],
  ['mauler', 10],
  ['bulwark', 9],
  ['lancer', 8],
  ['longbow', 3],
  ['wasp', 10],
  ['marshal', 7],
  ['talon', 9],
  ['thresher', 6],
  ['arbalest', 5],
  ['rampart', 3],
];
/** The better guns, a little more often where loot is rich. */
const RICH_GUNS: [WeaponId, number][] = [
  ['wren', 6],
  ['hornet', 13],
  ['kestrel', 17],
  ['mauler', 9],
  ['bulwark', 7],
  ['lancer', 12],
  ['longbow', 6],
  ['wasp', 9],
  ['marshal', 6],
  ['talon', 12],
  ['thresher', 8],
  ['arbalest', 6],
  ['rampart', 7],
];

/**
 * How rich the loot is round each spot, 0 to 1: the more other spots within 30 m (a town, a big building of several
 * floors), the richer. The bigger places get the better gear more often.
 */
export function richness(L: Float32Array) {
  const n = L.length / 3;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let c = 0;
    for (let j = 0; j < n; j++) {
      const dx = L[i * 3] - L[j * 3];
      const dz = L[i * 3 + 2] - L[j * 3 + 2];
      if (dx * dx + dz * dz < 900) c++;
    }
    out[i] = Math.min(1, Math.max(0, (c - 10) / 14));
  }
  return out;
}

/** Scatters loot over the world's loot spots (the same seed gives the same loot). */
export function spawnLoot(w: World, seed: number): Item[] {
  const r = mulberry32(seed * 31 + 7);
  const out: Item[] = [];
  const add = (kind: ItemKind, what: string, n: number, x: number, y: number, z: number) => out.push({ id: out.length, kind, what, n, x, y, z, live: true });
  const L = w.loot;
  const rich = richness(L);
  for (let i = 0; i < L.length; i += 3) {
    const x = L[i];
    const y = L[i + 1];
    const z = L[i + 2];
    if (Math.abs(x) > w.arena - 2 || Math.abs(z) > w.arena - 2 || r() > 0.9) continue;
    const k = rich[i / 3];
    const kind = pick<ItemKind>(r, [
      ['gun', 36],
      ['ammo', 20],
      ['vest', 10],
      ['helmet', 9],
      ['heal', 12],
      ['nade', 8],
      ['boost', 8],
      ['att', 8 + k * 4],
      ['pack', 5 + k * 3],
      ['shield', 1.2 + k * 1.2],
    ]);
    // levels: the third more often (and the first less) the richer the spot
    const level = (): string =>
      pick(r, [
        ['1', 55 - k * 25],
        ['2', 33 + k * 5],
        ['3', 12 + k * 14],
      ]);
    if (kind === 'gun') {
      const g = pick(r, r() < k ? RICH_GUNS : GUNS);
      add('gun', g, 1, x, y, z);
      // with a box or two of its ammo beside it
      const a = r() * Math.PI * 2;
      const ak = AMMO_OF[g];
      add('ammo', ak, AMMO_PACK[ak] * (r() < 0.4 ? 2 : 1), x + Math.cos(a) * 0.55, y, z + Math.sin(a) * 0.55);
    } else if (kind === 'ammo') add('ammo', pick(r, AMMO_KINDS.map((k): [AmmoKind, number] => [k, k === 'light' || k === 'rifle' ? 3 : 1])), 0, x, y, z);
    else if (kind === 'vest' || kind === 'helmet' || kind === 'pack') add(kind, level(), 1, x, y, z);
    else if (kind === 'heal') add('heal', r() < 0.72 ? 'bandage' : 'kit', 1, x, y, z);
    else if (kind === 'boost') add('boost', r() < 0.68 - k * 0.2 ? 'drink' : 'pills', 1, x, y, z);
    else if (kind === 'att')
      add(
        'att',
        pick<AttKind>(r, [
          ['dot', 32],
          ['ext', 26],
          ['comp', 24],
          ['x4', 10 + k * 14],
        ]),
        1,
        x,
        y,
        z,
      );
    else if (kind === 'shield') add('shield', '1', PAVISE.hp, x, y, z);
    else
      add(
        'nade',
        pick<RoyaleNade>(r, [
          ['frag', 40],
          ['smoke', 20],
          ['fire', 15],
          ['impact', 15],
          ['decoy', 10],
        ]),
        1,
        x,
        y,
        z,
      );
  }
  for (const it of out) if (it.kind === 'ammo' && it.n === 0) it.n = AMMO_PACK[it.what as AmmoKind];
  for (const it of out) if (it.kind === 'heal' && it.what === 'bandage') it.n = 3;
  return out;
}

/** What an item is called on screen. */
export function itemName(it: Item, gunName: (id: WeaponId) => string) {
  switch (it.kind) {
    case 'gun':
      return it.mods ? gunLabel({ id: it.what as WeaponId, mods: it.mods }) : gunName(it.what as WeaponId);
    case 'ammo':
      return `${AMMO_NAME[it.what as AmmoKind]} ammo (${it.n})`;
    case 'vest':
      return `Vest, level ${it.what}`;
    case 'helmet':
      return `Helmet, level ${it.what}`;
    case 'heal':
      return it.n > 1 ? `${HEAL[it.what as HealKind].name} x${it.n}` : HEAL[it.what as HealKind].name;
    case 'boost':
      return it.n > 1 ? `${BOOST[it.what as BoostKind].name} x${it.n}` : BOOST[it.what as BoostKind].name;
    case 'pack':
      return `Backpack, level ${it.what}`;
    case 'att':
      return ATT_NAME[it.what as AttKind];
    case 'shield':
      return `Ballistic shield (${Math.round((it.n / PAVISE.hp) * 100)}%)`;
    default:
      return it.n > 1 ? `${NADE_NAME[it.what as RoyaleNade]} x${it.n}` : NADE_NAME[it.what as RoyaleNade];
  }
}

export const NADE_NAME: Record<RoyaleNade, string> = { frag: 'Frag grenade', smoke: 'Smoke grenade', fire: 'Incendiary', impact: 'Impact grenade', decoy: 'Decoy' };
