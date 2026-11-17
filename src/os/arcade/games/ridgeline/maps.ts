// The four maps: how each one is generated (terrain shape, places, trees) and how it looks (light, sky, fog, ground
// colors, grade). Colors are sRGB hex; the renderer converts them to linear. Each sun stands about where the sun is in
// its map's sky photo (gfx/sky.ts), and has that photo's color.

export type MapId = 'vale' | 'mesa' | 'frost' | 'isles';
export const MAP_IDS: readonly MapId[] = ['vale', 'mesa', 'frost', 'isles'];

export type TreeKind = 'oak' | 'pine' | 'birch' | 'snowpine' | 'palm' | 'cactus' | 'deadtree' | 'shrub';
export type Style = 'farm' | 'adobe' | 'cabin' | 'tropic';
export type Weather = 'none' | 'snow' | 'dust' | 'pollen';

/** A time of day a royale can play at besides the map's own (see looks.ts): the light, sky, haze and grade it swaps in.
 * Its sky photo is in gfx/sky.ts. */
export type Look = Pick<MapDef, 'sun' | 'sky' | 'fog' | 'ambient' | 'grade'>;

export type TreeRule = { kind: TreeKind; weight: number; /** only this close to water (m above the water line) */ nearWater?: number; /** only above this height above water */ minUp?: number };

export type MapDef = {
  id: MapId;
  name: string;
  /** Royale: the names of the places out over the land, one for each kind in the order world.ts builds them (OUTER:
   * the military compound, a depot, a farm, the hilltop outpost, a village, a farm, a village, a depot, a village),
   * then three more for the hamlets. Each different from every other name on the map. */
  royalePois: string[];
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
  /** Royale only: the dusk and overcast versions of the map (looks.ts picks one per match). */
  looks?: Partial<Record<'dusk' | 'overcast', Look>>;
};

export const MAPS: Record<MapId, MapDef> = {
  vale: {
    id: 'vale',
    name: 'Verdant Vale',
    royalePois: ['Ashcombe Barracks', 'Wickham Sidings', 'Bramble Farm', 'Beacon Knoll', 'Little Hatherley', 'Larkspur Farm', 'Fernley Green', 'Coldharbour Yard', 'Nettlecombe', 'Elmstead', 'Wren Cross', 'Saddler Row'],
    tag: 'rolling farmland, oak woods and a lake under a summer sky',
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
    sun: { az: 118, el: 43, color: 0xffe2b4, intensity: 3.4 },
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
    looks: {
      dusk: {
        sun: { az: 286, el: 7, color: 0xffb46c, intensity: 5 },
        sky: { zenith: 0x5b708f, horizon: 0xb9aea6, ground: 0x5e5448, glow: 1.2, clouds: 0.36, cloudColor: 0xffd0a4, cloudShade: 0x6c6478 },
        fog: { color: 0xd4b49c, density: 0.0024, falloff: 0.032, sun: 0xffb070 },
        ambient: 2.9,
        grade: { exposure: 2, saturation: 1.12, contrast: 1.06, tint: [1.1, 1, 0.86], vignette: 0.32, bloom: 0.8 },
      },
      overcast: {
        sun: { az: 118, el: 43, color: 0xe6eaf0, intensity: 0.9 },
        sky: { zenith: 0xacb8cb, horizon: 0x989ea6, ground: 0x5c625a, glow: 0.2, clouds: 0.95, cloudColor: 0xe2e6ea, cloudShade: 0x7c828a },
        fog: { color: 0xaab2ba, density: 0.0034, falloff: 0.03, sun: 0xc8ccd2 },
        ambient: 3.5,
        grade: { exposure: 1.3, saturation: 0.86, contrast: 1.1, tint: [0.98, 1, 1.03], vignette: 0.3, bloom: 0.3 },
      },
    },
  },
  mesa: {
    id: 'mesa',
    name: 'Red Mesa',
    royalePois: ['Fort Caliche', 'Ocotillo Depot', 'Juniper Ranch', 'Buzzard Butte', 'Gila Flats', 'Mesquite Ranch', 'Sandstone Bend', 'Borax Siding', 'Lizard Springs', 'Cholla Corners', 'Painted Wash', 'Coyote Wells'],
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
    sun: { az: 232, el: 38, color: 0xfff0dc, intensity: 3.8 },
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
    looks: {
      dusk: {
        sun: { az: 262, el: 6, color: 0xffa852, intensity: 5.5 },
        sky: { zenith: 0x515c77, horizon: 0xd4c1aa, ground: 0x8a5a40, glow: 1.3, clouds: 0.2, cloudColor: 0xffd2a8, cloudShade: 0x8a6a6a },
        fog: { color: 0xe0a880, density: 0.0012, falloff: 0.02, sun: 0xffa060 },
        ambient: 3.2,
        grade: { exposure: 2.2, saturation: 1.12, contrast: 1.1, tint: [1.1, 0.98, 0.85], vignette: 0.32, bloom: 0.5 },
      },
      overcast: {
        sun: { az: 232, el: 38, color: 0xeee6dc, intensity: 0.9 },
        sky: { zenith: 0xcacaca, horizon: 0x898681, ground: 0x7a5e4a, glow: 0.2, clouds: 0.95, cloudColor: 0xe0dcd6, cloudShade: 0x807a74 },
        fog: { color: 0xb8a48c, density: 0.0032, falloff: 0.02, sun: 0xd0c4b4 },
        ambient: 4.2,
        grade: { exposure: 1.3, saturation: 0.86, contrast: 1.1, tint: [1.02, 1, 0.97], vignette: 0.3, bloom: 0.3 },
      },
    },
  },
  frost: {
    id: 'frost',
    name: 'Frostpeak',
    royalePois: ['Fort Hoarfrost', 'Snowplow Depot', 'Larch Homestead', 'Cornice Watch', 'Birchwood', 'Ptarmigan Farm', 'Hearthstead', 'Sawtooth Yard', 'Wolfsbane', 'Kettle Pond', 'Snowmelt', 'Timberline'],
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
    sun: { az: 158, el: 13, color: 0xfaf0dc, intensity: 2.1 },
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
    looks: {
      dusk: {
        sun: { az: 204, el: 6, color: 0xffb070, intensity: 4.5 },
        sky: { zenith: 0x51565f, horizon: 0xb39c80, ground: 0x9a96a4, glow: 1.0, clouds: 0.5, cloudColor: 0xffd8c0, cloudShade: 0x6c6880 },
        fog: { color: 0xc8b8c0, density: 0.0036, falloff: 0.018, sun: 0xffc090 },
        ambient: 1.1,
        grade: { exposure: 1.4, saturation: 1, contrast: 1.05, tint: [1.05, 0.99, 0.96], vignette: 0.28, bloom: 0.6 },
      },
      overcast: {
        sun: { az: 158, el: 13, color: 0xe8ecf4, intensity: 0.8 },
        sky: { zenith: 0x9d9d9c, horizon: 0x93938f, ground: 0x9aa4b0, glow: 0.2, clouds: 0.95, cloudColor: 0xeef0f4, cloudShade: 0x868e98 },
        fog: { color: 0xc0c8d2, density: 0.0048, falloff: 0.018, sun: 0xdde2ea },
        ambient: 2,
        grade: { exposure: 1, saturation: 0.85, contrast: 1.08, tint: [0.97, 1, 1.04], vignette: 0.26, bloom: 0.3 },
      },
    },
  },
  isles: {
    id: 'isles',
    name: 'Coral Isles',
    royalePois: ['Fort Breakwater', 'Copra Depot', 'Breadfruit Farm', 'Frigate Point', 'Seagrape', 'Hibiscus Farm', 'Driftwood', 'Saltworks', 'Pelican Rest', 'Mangrove', 'Tidewater', 'Starfish Bay'],
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
    sun: { az: 282, el: 8, color: 0xffa24a, intensity: 3.1 },
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
    looks: {
      dusk: {
        sun: { az: 290, el: 2, color: 0xff9a80, intensity: 1.6 },
        sky: { zenith: 0x5b617f, horizon: 0x8e7076, ground: 0x5a5068, glow: 1.0, clouds: 0.3, cloudColor: 0xffc0b0, cloudShade: 0x6a5a80 },
        fog: { color: 0xb898a8, density: 0.0017, falloff: 0.03, sun: 0xff9a90 },
        ambient: 1.8,
        grade: { exposure: 1.55, saturation: 1.05, contrast: 1.04, tint: [1.04, 0.97, 1.02], vignette: 0.3, bloom: 0.6 },
      },
      overcast: {
        sun: { az: 282, el: 8, color: 0xe8eef8, intensity: 0.9 },
        sky: { zenith: 0xb2b4c2, horizon: 0x808084, ground: 0x5a6068, glow: 0.2, clouds: 0.95, cloudColor: 0xe2e6ea, cloudShade: 0x7c828a },
        fog: { color: 0xa8b4bc, density: 0.0026, falloff: 0.03, sun: 0xc8d0d8 },
        ambient: 2,
        grade: { exposure: 1.1, saturation: 0.9, contrast: 1.08, tint: [0.98, 1, 1.02], vignette: 0.3, bloom: 0.3 },
      },
    },
  },
};
