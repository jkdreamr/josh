// The four maps: how each one is generated (terrain shape, places, trees) and how it looks (light, sky, fog, ground
// colors, grade). Colors are sRGB hex; the renderer converts them to linear.

export type MapId = 'vale' | 'mesa' | 'frost' | 'isles';
export const MAP_IDS: readonly MapId[] = ['vale', 'mesa', 'frost', 'isles'];

export type TreeKind = 'oak' | 'pine' | 'birch' | 'snowpine' | 'palm' | 'cactus' | 'deadtree' | 'shrub';
export type Style = 'farm' | 'adobe' | 'cabin' | 'tropic';
export type Weather = 'none' | 'snow' | 'dust' | 'pollen';

export type TreeRule = { kind: TreeKind; weight: number; /** only this close to water (m above the water line) */ nearWater?: number; /** only above this height above water */ minUp?: number };

export type MapDef = {
  id: MapId;
  name: string;
  tag: string;
  seed: number;
  /** Water line in meters, or null for none. */
  water: number | null;
  /** The water is frozen: you walk on it. */
  ice: boolean;
  style: Style;
  pois: string[];
  trees: TreeRule[];
  /** Forest cover, 0 to 1. */
  forest: number;
  rocks: number;
  grass: { density: number; height: number; dry: number };
  sun: { az: number; el: number; color: number; intensity: number };
  sky: { zenith: number; horizon: number; ground: number; glow: number; clouds: number; cloudColor: number; cloudShade: number };
  fog: { color: number; density: number; falloff: number; sun: number };
  /** Strength of the sky light (image based lighting). */
  ambient: number;
  ground: {
    grassA: number;
    grassB: number;
    dirt: number;
    rock: number;
    sand: number;
    snow: number;
    /** Height where snow starts. */
    snowLine: number;
    /** Snow on any flat ground, 0 to 1. */
    snowCover: number;
    /** How far above the water the beach reaches. */
    sandLine: number;
    /** Layered rock bands, 0 to 1. */
    strata: number;
    /** Slope (1 - normal.y) where grass gives way to rock. */
    rockSlope: number;
    /** Bare dirt patches, 0 to 1. */
    dirtAmt: number;
    /** Sand drifts over flat ground (deserts), 0 to 1. */
    sandAmt: number;
  };
  waterColor: { shallow: number; deep: number };
  grade: { exposure: number; saturation: number; contrast: number; tint: [number, number, number]; vignette: number; bloom: number };
  weather: Weather;
};

export const MAPS: Record<MapId, MapDef> = {
  vale: {
    id: 'vale',
    name: 'Verdant Vale',
    tag: 'rolling farmland, oak woods and a misty lake at sunrise',
    seed: 1207,
    water: 1.5,
    ice: false,
    style: 'farm',
    pois: ['Millbrook', 'Stonebridge', 'Old Quarry', 'Radio Hill', 'Hollow Farm', 'Lakeside', 'Pine Rest', 'Cobb Mill'],
    trees: [
      { kind: 'oak', weight: 0.5, minUp: 1.5 },
      { kind: 'pine', weight: 0.25, minUp: 6 },
      { kind: 'birch', weight: 0.25, minUp: 1.5 },
    ],
    forest: 0.55,
    rocks: 0.5,
    grass: { density: 1, height: 0.55, dry: 0.15 },
    sun: { az: 118, el: 21, color: 0xffd6a6, intensity: 3.4 },
    sky: { zenith: 0x3d74c4, horizon: 0xc4d6e6, ground: 0x6b7a6a, glow: 0.9, clouds: 0.42, cloudColor: 0xfff4e8, cloudShade: 0x8592a8 },
    fog: { color: 0xb8cadc, density: 0.0021, falloff: 0.035, sun: 0xffd2a0 },
    ambient: 1,
    ground: {
      grassA: 0x4d6e2a,
      grassB: 0x7a8c38,
      dirt: 0x6b5f50,
      rock: 0x7b7870,
      sand: 0xb5a47c,
      snow: 0xf0f4f8,
      snowLine: 999,
      snowCover: 0,
      sandLine: 1.1,
      strata: 0.15,
      rockSlope: 0.42,
      dirtAmt: 0.3,
      sandAmt: 0,
    },
    waterColor: { shallow: 0x5a9486, deep: 0x17323f },
    grade: { exposure: 1, saturation: 1.08, contrast: 1.05, tint: [1.03, 1, 0.96], vignette: 0.28, bloom: 0.55 },
    weather: 'pollen',
  },
  mesa: {
    id: 'mesa',
    name: 'Red Mesa',
    tag: 'desert canyons, layered mesas and a lone oasis in the afternoon heat',
    seed: 4451,
    water: 0,
    ice: false,
    style: 'adobe',
    pois: ['Dust Bowl', 'Oasis', 'Copper Town', 'Pump Station', 'Red Gate', 'Sunken Ranch', 'Mesa Top', 'Rattler'],
    trees: [
      { kind: 'cactus', weight: 0.5, minUp: 2 },
      { kind: 'deadtree', weight: 0.2, minUp: 2 },
      { kind: 'shrub', weight: 0.3, minUp: 1 },
      { kind: 'palm', weight: 3, nearWater: 6 },
    ],
    forest: 0.18,
    rocks: 1,
    grass: { density: 0.35, height: 0.42, dry: 1 },
    sun: { az: 232, el: 38, color: 0xffe0ba, intensity: 3.8 },
    sky: { zenith: 0x4a82c4, horizon: 0xe3ccad, ground: 0x9a6b4a, glow: 0.6, clouds: 0.14, cloudColor: 0xfff6ea, cloudShade: 0xb09a8a },
    fog: { color: 0xd9bc98, density: 0.0017, falloff: 0.02, sun: 0xffd8ac },
    ambient: 0.9,
    ground: {
      grassA: 0x8a7a44,
      grassB: 0x9e8a50,
      dirt: 0xa0633e,
      rock: 0xa65b36,
      sand: 0xd4a46c,
      snow: 0xf0f4f8,
      snowLine: 999,
      snowCover: 0,
      sandLine: 1.2,
      strata: 1,
      rockSlope: 0.3,
      dirtAmt: 0.55,
      sandAmt: 0.6,
    },
    waterColor: { shallow: 0x4f9a88, deep: 0x1e4a48 },
    grade: { exposure: 0.95, saturation: 1.06, contrast: 1.08, tint: [1.05, 0.99, 0.92], vignette: 0.3, bloom: 0.5 },
    weather: 'dust',
  },
  frost: {
    id: 'frost',
    name: 'Frostpeak',
    tag: 'snowbound pines under jagged peaks, around a frozen lake',
    seed: 9083,
    water: 3,
    ice: true,
    style: 'cabin',
    pois: ['Pine Lodge', 'Ridge Station', 'Ice Camp', 'Whiteout', 'Lumber Yard', 'Summit Post', 'Frozen Dock', 'Elk Hollow'],
    trees: [
      { kind: 'snowpine', weight: 0.85, minUp: 1 },
      { kind: 'deadtree', weight: 0.15, minUp: 1 },
    ],
    forest: 0.62,
    rocks: 0.8,
    grass: { density: 0.18, height: 0.38, dry: 0.8 },
    sun: { az: 158, el: 15, color: 0xe2eaff, intensity: 2.1 },
    sky: { zenith: 0x5a7896, horizon: 0xc8d4e0, ground: 0x9aa6b4, glow: 0.45, clouds: 0.72, cloudColor: 0xf2f5fa, cloudShade: 0x7c8898 },
    fog: { color: 0xc3cfdc, density: 0.0036, falloff: 0.018, sun: 0xeaf0fa },
    ambient: 1.25,
    ground: {
      grassA: 0x58623f,
      grassB: 0x6c6c49,
      dirt: 0x5a5048,
      rock: 0x6a6e76,
      sand: 0x8a8578,
      snow: 0xf3f7fc,
      snowLine: -60,
      snowCover: 0.85,
      sandLine: 0.6,
      strata: 0.25,
      rockSlope: 0.5,
      dirtAmt: 0.15,
      sandAmt: 0,
    },
    waterColor: { shallow: 0xb8d4e4, deep: 0x7fa6c4 },
    grade: { exposure: 0.92, saturation: 0.92, contrast: 1.04, tint: [0.96, 1, 1.06], vignette: 0.26, bloom: 0.45 },
    weather: 'snow',
  },
  isles: {
    id: 'isles',
    name: 'Coral Isles',
    tag: 'palm islands, sandbars and turquoise shallows at sunset',
    seed: 3319,
    water: 0,
    ice: false,
    style: 'tropic',
    pois: ['Harbor', 'Lighthouse', 'Palm Bay', 'Coral Village', 'Shipwreck', 'Turtle Cove', 'Sandbar', 'Mango Hill'],
    trees: [
      { kind: 'palm', weight: 0.6, minUp: 0.8 },
      { kind: 'oak', weight: 0.2, minUp: 6 },
      { kind: 'shrub', weight: 0.2, minUp: 1 },
    ],
    forest: 0.42,
    rocks: 0.45,
    grass: { density: 0.85, height: 0.5, dry: 0.1 },
    sun: { az: 282, el: 9, color: 0xffad6a, intensity: 3.1 },
    sky: { zenith: 0x34558f, horizon: 0xf1b388, ground: 0x6a6070, glow: 1.25, clouds: 0.34, cloudColor: 0xffd2b0, cloudShade: 0x7a6a8a },
    fog: { color: 0xe2b694, density: 0.0015, falloff: 0.03, sun: 0xffa060 },
    ambient: 0.95,
    ground: {
      grassA: 0x4a7a26,
      grassB: 0x6d9232,
      dirt: 0x7a5e44,
      rock: 0x6f6a62,
      sand: 0xe2cd9c,
      snow: 0xf0f4f8,
      snowLine: 999,
      snowCover: 0,
      sandLine: 2.6,
      strata: 0.1,
      rockSlope: 0.45,
      dirtAmt: 0.2,
      sandAmt: 0,
    },
    waterColor: { shallow: 0x3cc4bc, deep: 0x0d4466 },
    grade: { exposure: 1, saturation: 1.1, contrast: 1.06, tint: [1.05, 0.99, 0.95], vignette: 0.3, bloom: 0.7 },
    weather: 'none',
  },
};
