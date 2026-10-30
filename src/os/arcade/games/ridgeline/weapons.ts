// The guns and gear: damage, fire rate, accuracy, recoil and bullet speed, plus the shop prices. Angles are degrees.

export type WeaponId = 'wren' | 'bulwark' | 'hornet' | 'mauler' | 'kestrel' | 'lancer' | 'longbow';
export type WeaponClass = 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'dmr' | 'sniper';

export type WeaponDef = {
  id: WeaponId;
  name: string;
  cls: WeaponClass;
  slot: 'primary' | 'secondary';
  price: number;
  /** Damage per bullet (per pellet for shotguns). */
  dmg: number;
  head: number;
  leg: number;
  /** Full damage up to start meters, falling to min (a multiplier) at end. */
  falloff: [number, number, number];
  pellets: number;
  rpm: number;
  auto: boolean;
  mag: number;
  /** Spare ammo you buy it with. */
  reserve: number;
  reload: number;
  /** Muzzle velocity, m/s. Bullets fly and drop under gravity. */
  speed: number;
  /** Cone half angle standing still, hip fire. */
  base: number;
  /** Extra at a full run. */
  move: number;
  /** Extra in the air. */
  air: number;
  /** Multiplier on everything while aiming down sights. */
  ads: number;
  /** Extra per shot while spraying, and its cap. */
  bloom: number;
  bloomMax: number;
  /** Pellet cone for shotguns. */
  pelletSpread: number;
  /** Recoil: first kick, growth per shot, the most per shot, side sway size and rhythm, and the shot it starts on. */
  kick: { up: number; grow: number; max: number; side: number; rate: number; from: number };
  /** Aim zoom (fov divisor) and how long aiming takes. */
  zoom: number;
  adsTime: number;
  /** Scoped: a full screen scope while aiming. */
  scope: boolean;
  /** Walk speed multiplier while holding it. */
  weight: number;
  equip: number;
  /** Penetrates armor better? multiplies the share armor takes (1 = normal). */
  armorPen: number;
};

const W = (d: Partial<WeaponDef> & Pick<WeaponDef, 'id' | 'name' | 'cls' | 'price' | 'dmg' | 'rpm' | 'mag' | 'speed'>): WeaponDef => ({
  slot: d.cls === 'pistol' ? 'secondary' : 'primary',
  head: 3,
  leg: 0.85,
  falloff: [30, 80, 0.8],
  pellets: 1,
  auto: false,
  reserve: d.mag * 3,
  reload: 2.2,
  base: 0.25,
  move: 4,
  air: 8,
  ads: 0.6,
  bloom: 0.4,
  bloomMax: 3,
  pelletSpread: 0,
  kick: { up: 1, grow: 0, max: 1, side: 0.2, rate: 1, from: 3 },
  zoom: 1.25,
  adsTime: 0.18,
  scope: false,
  weight: 1,
  equip: 0.6,
  armorPen: 1,
  ...d,
});

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  wren: W({ id: 'wren', name: 'Wren', cls: 'pistol', price: 0, dmg: 26, head: 3, rpm: 380, mag: 12, reserve: 36, speed: 360, reload: 1.5, base: 0.3, move: 2.6, air: 6, bloom: 0.55, bloomMax: 3, falloff: [20, 50, 0.75], kick: { up: 1.1, grow: 0.15, max: 1.8, side: 0.25, rate: 1.3, from: 2 }, weight: 1.06, equip: 0.45, zoom: 1.15 }),
  bulwark: W({ id: 'bulwark', name: 'Bulwark', cls: 'pistol', price: 800, dmg: 55, head: 3, rpm: 150, mag: 7, reserve: 21, speed: 420, reload: 2, base: 0.22, move: 3.6, air: 7, bloom: 1.5, bloomMax: 4, falloff: [25, 60, 0.8], kick: { up: 3.4, grow: 0, max: 3.4, side: 0.5, rate: 1, from: 1 }, weight: 1.05, equip: 0.55, zoom: 1.2 }),
  hornet: W({ id: 'hornet', name: 'Hornet', cls: 'smg', price: 1600, dmg: 24, head: 2.5, rpm: 860, auto: true, mag: 30, reserve: 90, speed: 420, reload: 2, base: 0.75, move: 1.5, air: 5, ads: 0.7, bloom: 0.22, bloomMax: 2.8, falloff: [15, 45, 0.72], kick: { up: 0.42, grow: 0.03, max: 0.7, side: 0.45, rate: 0.9, from: 4 }, weight: 1.04, zoom: 1.2 }),
  mauler: W({ id: 'mauler', name: 'Mauler', cls: 'shotgun', price: 1800, dmg: 16, head: 2, pellets: 9, rpm: 72, mag: 6, reserve: 24, speed: 380, reload: 2.6, base: 0.4, move: 1.4, air: 3, ads: 0.85, bloom: 0, bloomMax: 0, pelletSpread: 3.4, falloff: [8, 24, 0.3], kick: { up: 4.5, grow: 0, max: 4.5, side: 0.8, rate: 1, from: 1 }, weight: 1, zoom: 1.1 }),
  kestrel: W({ id: 'kestrel', name: 'Kestrel', cls: 'rifle', price: 2900, dmg: 38, head: 4, rpm: 600, auto: true, mag: 25, reserve: 75, speed: 820, reload: 2.4, base: 0.18, move: 5, air: 9, ads: 0.55, bloom: 0.26, bloomMax: 3.2, falloff: [60, 160, 0.86], kick: { up: 0.52, grow: 0.06, max: 0.9, side: 0.5, rate: 0.55, from: 7 }, weight: 0.96, zoom: 1.6, adsTime: 0.2 }),
  lancer: W({ id: 'lancer', name: 'Lancer', cls: 'dmr', price: 2400, dmg: 62, head: 2.8, rpm: 250, mag: 12, reserve: 36, speed: 900, reload: 2.5, base: 0.1, move: 6, air: 10, ads: 0.35, bloom: 1.1, bloomMax: 3, falloff: [90, 250, 0.9], kick: { up: 2.1, grow: 0, max: 2.1, side: 0.35, rate: 1, from: 1 }, weight: 0.95, zoom: 3.5, adsTime: 0.24, scope: true }),
  longbow: W({ id: 'longbow', name: 'Longbow', cls: 'sniper', price: 4600, dmg: 150, head: 2, leg: 0.9, rpm: 42, mag: 5, reserve: 15, speed: 950, reload: 3.4, base: 3.5, move: 7, air: 12, ads: 0.006, bloom: 0, bloomMax: 0, falloff: [400, 600, 1], kick: { up: 6, grow: 0, max: 6, side: 0.6, rate: 1, from: 1 }, weight: 0.86, zoom: 6, adsTime: 0.3, scope: true, equip: 0.8 }),
};

export const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[];
export const PRIMARIES = WEAPON_IDS.filter((id) => WEAPONS[id].slot === 'primary');

export const ARMOR = { light: { amount: 25, price: 400 }, heavy: { amount: 50, price: 1000 } } as const;
export const NADES = { frag: { price: 300, max: 1 }, smoke: { price: 200, max: 2 } } as const;

/** Share of each hit armor takes while it lasts. */
export const ARMOR_SHARE = 0.66;
export const START_CREDITS = 800;
export const MAX_CREDITS = 9000;
export const KILL_REWARD = 200;
export const WIN_REWARD = 3000;
export const LOSS_REWARD = 1900;
export const LOSS_STREAK_BONUS = 500;

/** Seconds between shots. */
export const interval = (w: WeaponDef) => 60 / w.rpm;

/** Damage multiplier for range. */
export function rangeMul(w: WeaponDef, dist: number) {
  const [a, b, min] = w.falloff;
  if (dist <= a) return 1;
  if (dist >= b) return min;
  return 1 + ((dist - a) / (b - a)) * (min - 1);
}

/** The recoil kick for the nth shot of a spray (0 based): [up, side] in degrees. A fixed pattern you can learn. */
export function kickOf(w: WeaponDef, n: number): [number, number] {
  const k = w.kick;
  const up = Math.min(k.max, k.up + k.grow * n);
  const side = n < k.from ? Math.sin(n * 2.1) * k.side * 0.25 : Math.sin((n - k.from) * k.rate + 0.6) * k.side + Math.sin(n * 0.37) * k.side * 0.3;
  return [up, side];
}

/** Hit points and armor after a hit: armor takes its share until it runs out. */
export function applyDamage(hp: number, armor: number, dmg: number, pen = 1) {
  const share = Math.min(1, ARMOR_SHARE * pen);
  const soak = Math.min(armor, dmg * share);
  return { hp: hp - (dmg - soak), armor: armor - soak };
}
