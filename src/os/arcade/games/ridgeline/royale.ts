// Royale data: what lies around to pick up and how much of it, the ammo each gun takes, armor and helmets, heals, the
// shrinking zone's timetable, and the transport's flight line. Pure TS with no state of its own; match.ts runs it.
import { mulberry32, type Rng } from './noise.ts';
import { CELL, T_HALF, T_RES, heightAt } from './terrain.ts';
import type { WeaponId } from './weapons.ts';
import type { World } from './world.ts';

export const ROYALE_PLAYERS = 100;

export type AmmoKind = 'light' | 'rifle' | 'shells' | 'magnum' | 'sniper';
export const AMMO_KINDS: AmmoKind[] = ['light', 'rifle', 'shells', 'magnum', 'sniper'];
export const AMMO_OF: Record<WeaponId, AmmoKind> = { wren: 'light', hornet: 'light', bulwark: 'magnum', mauler: 'shells', kestrel: 'rifle', lancer: 'rifle', longbow: 'sniper' };
export const AMMO_NAME: Record<AmmoKind, string> = { light: '9mm', rifle: '5.56', shells: '12 gauge', magnum: '.50 AE', sniper: '.338' };
/** Rounds in a box on the ground, and the most you can carry. */
export const AMMO_PACK: Record<AmmoKind, number> = { light: 30, rifle: 30, shells: 10, magnum: 14, sniper: 10 };
export const AMMO_MAX: Record<AmmoKind, number> = { light: 210, rifle: 210, shells: 60, magnum: 70, sniper: 50 };

/** Armor points a vest of each level gives, and how much of a head hit a helmet lets through. */
export const VEST = [0, 40, 70, 100];
export const HELMET = [1, 0.72, 0.58, 0.46];

export type HealKind = 'bandage' | 'kit';
export const HEAL: Record<HealKind, { time: number; to: number; add: number; max: number; name: string }> = {
  bandage: { time: 2.6, to: 75, add: 15, max: 10, name: 'Bandage' },
  kit: { time: 5.5, to: 100, add: 100, max: 3, name: 'Med kit' },
};
export const NADE_MAX = { frag: 3, smoke: 2 };

export type ItemKind = 'gun' | 'ammo' | 'vest' | 'helmet' | 'heal' | 'nade';
/** Something lying on the ground. `what` is a gun id, an ammo kind, a level ('1' to '3'), a heal or a grenade kind. */
export type Item = { id: number; kind: ItemKind; what: string; n: number; x: number; y: number; z: number; live: boolean };

/** One phase of the zone: it holds for `wait` seconds, then closes to radius `r` over `shrink`; outside costs `dps`. */
export type ZonePhase = { wait: number; shrink: number; r: number; dps: number };
export const ZONES: ZonePhase[] = [
  { wait: 90, shrink: 40, r: 220, dps: 1 },
  { wait: 40, shrink: 30, r: 140, dps: 2 },
  { wait: 35, shrink: 25, r: 85, dps: 4 },
  { wait: 25, shrink: 22, r: 48, dps: 6 },
  { wait: 20, shrink: 20, r: 22, dps: 9 },
  { wait: 15, shrink: 22, r: 0, dps: 14 },
];

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

const pick = <T,>(r: Rng, table: [T, number][]): T => {
  let roll = r() * table.reduce((s, [, p]) => s + p, 0);
  for (const [v, p] of table) {
    roll -= p;
    if (roll <= 0) return v;
  }
  return table[0][0];
};

const GUNS: [WeaponId, number][] = [
  ['wren', 20],
  ['hornet', 18],
  ['kestrel', 17],
  ['mauler', 12],
  ['bulwark', 11],
  ['lancer', 10],
  ['longbow', 4],
];
const LEVELS: [string, number][] = [
  ['1', 55],
  ['2', 33],
  ['3', 12],
];

/** Scatters loot over the world's loot spots (the same seed gives the same loot). */
export function spawnLoot(w: World, seed: number): Item[] {
  const r = mulberry32(seed * 31 + 7);
  const out: Item[] = [];
  const add = (kind: ItemKind, what: string, n: number, x: number, y: number, z: number) => out.push({ id: out.length, kind, what, n, x, y, z, live: true });
  const L = w.loot;
  for (let i = 0; i < L.length; i += 3) {
    const x = L[i];
    const y = L[i + 1];
    const z = L[i + 2];
    if (Math.abs(x) > w.arena - 2 || Math.abs(z) > w.arena - 2 || r() > 0.9) continue;
    const kind = pick<ItemKind>(r, [
      ['gun', 40],
      ['ammo', 22],
      ['vest', 11],
      ['helmet', 10],
      ['heal', 14],
      ['nade', 9],
    ]);
    if (kind === 'gun') {
      const g = pick(r, GUNS);
      add('gun', g, 1, x, y, z);
      // with a box or two of its ammo beside it
      const a = r() * Math.PI * 2;
      const ak = AMMO_OF[g];
      add('ammo', ak, AMMO_PACK[ak] * (r() < 0.4 ? 2 : 1), x + Math.cos(a) * 0.55, y, z + Math.sin(a) * 0.55);
    } else if (kind === 'ammo') add('ammo', pick(r, AMMO_KINDS.map((k): [AmmoKind, number] => [k, k === 'light' || k === 'rifle' ? 3 : 1])), 0, x, y, z);
    else if (kind === 'vest' || kind === 'helmet') add(kind, pick(r, LEVELS), 1, x, y, z);
    else if (kind === 'heal') add('heal', r() < 0.72 ? 'bandage' : 'kit', 1, x, y, z);
    else add('nade', r() < 0.65 ? 'frag' : 'smoke', 1, x, y, z);
  }
  for (const it of out) if (it.kind === 'ammo' && it.n === 0) it.n = AMMO_PACK[it.what as AmmoKind];
  for (const it of out) if (it.kind === 'heal' && it.what === 'bandage') it.n = 3;
  return out;
}

/** What an item is called on screen. */
export function itemName(it: Item, gunName: (id: WeaponId) => string) {
  switch (it.kind) {
    case 'gun':
      return gunName(it.what as WeaponId);
    case 'ammo':
      return `${AMMO_NAME[it.what as AmmoKind]} ammo (${it.n})`;
    case 'vest':
      return `Vest, level ${it.what}`;
    case 'helmet':
      return `Helmet, level ${it.what}`;
    case 'heal':
      return it.n > 1 ? `${HEAL[it.what as HealKind].name} x${it.n}` : HEAL[it.what as HealKind].name;
    default:
      return it.what === 'frag' ? 'Frag grenade' : 'Smoke grenade';
  }
}
