// Every texture in the game, painted at runtime as 16px pixel art into one atlas canvas (no image downloads), plus
// hand-made mip levels per tile so distant blocks stay calm without bleeding into their neighbors, and the icons the
// HUD uses (isometric cubes for blocks, flat sprites for items).
import { ATLAS_TILES, BLOCKS, TEAMS, TILE, TILE_NAMES, type TileName } from './blocks.ts';

const T = 16;
export const ATLAS_PX = T * ATLAS_TILES;

type Ctx = CanvasRenderingContext2D;

function rng(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a ^= a << 13;
    a >>>= 0;
    a ^= a >>> 17;
    a ^= a << 5;
    a >>>= 0;
    return a / 4294967296;
  };
}

const hex = (h: string): [number, number, number] => {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
const rgb = (c: [number, number, number], a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mix = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shade = (c: [number, number, number], k: number): [number, number, number] => [Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)];

/** One tile being painted: pixel helpers in tile space. */
class Tile {
  constructor(
    readonly g: Ctx,
    readonly ox: number,
    readonly oy: number,
    readonly r: () => number,
  ) {}
  px(x: number, y: number, c: string) {
    if (x < 0 || y < 0 || x >= T || y >= T) return;
    this.g.fillStyle = c;
    this.g.fillRect(this.ox + x, this.oy + y, 1, 1);
  }
  rect(x: number, y: number, w: number, h: number, c: string) {
    this.g.fillStyle = c;
    this.g.fillRect(this.ox + x, this.oy + y, w, h);
  }
  clear() {
    this.g.clearRect(this.ox, this.oy, T, T);
  }
  /** Fills with a palette, picking a shade per pixel from noise. */
  noise(pal: string[], weights?: number[]) {
    const w = weights ?? pal.map(() => 1);
    const total = w.reduce((a, b) => a + b, 0);
    for (let y = 0; y < T; y++)
      for (let x = 0; x < T; x++) {
        let v = this.r() * total;
        let i = 0;
        while (v > w[i] && i < pal.length - 1) v -= w[i++];
        this.px(x, y, pal[i]);
      }
  }
  /** Draws a 16-row pixel map; '.' is transparent and other letters index the palette. */
  map(rows: string[], pal: Record<string, string>, dx = 0, dy = 0) {
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const c = pal[row[x]];
        if (c) this.px(x + dx, y + dy, c);
      }
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Item sprites (Minecraft-like 16px drawings). k is the dark outline.

const SWORD = [
  '.............kkk',
  '............kLMk',
  '...........kLMDk',
  '..........kLMDk.',
  '.........kLMDk..',
  '........kLMDk...',
  '.......kLMDk....',
  '..kk..kLMDk.....',
  '..kGk.kMDk......',
  '...kGkMDk.......',
  '....kGGk........',
  '....kwGGk.......',
  '...kWwk.kGk.....',
  '..kWwk...kk.....',
  '.kWwk...........',
  '.kkk............',
];
const PICK = [
  '................',
  '....kkkkkk......',
  '...kLLLMMMk.....',
  '....kkkkMMDk....',
  '........kWMDk...',
  '.......kWk.kDk..',
  '......kWk..kDk..',
  '.....kWk...kMk..',
  '....kWk.....kk..',
  '...kWk..........',
  '..kWk...........',
  '.kWk............',
  'kWk.............',
  'kk..............',
  '................',
  '................',
];
const AXE = [
  '................',
  '.......kkk......',
  '......kLMDk.....',
  '.....kLMMDDk....',
  '.....kLMkWDk....',
  '......kkWkDk....',
  '......kWk.kk....',
  '.....kWk........',
  '....kWk.........',
  '...kWk..........',
  '..kWk...........',
  '.kWk............',
  'kWk.............',
  'kk..............',
  '................',
  '................',
];
const STICK = [
  '................',
  '.............kk.',
  '............kWk.',
  '...........kWk..',
  '..........kWk...',
  '.........kWk....',
  '........kWk.....',
  '.......kWk......',
  '......kWk.......',
  '.....kWk........',
  '....kWk.........',
  '...kWk..........',
  '..kWk...........',
  '..kk............',
  '................',
  '................',
];
const SHEARS = [
  '................',
  '..........kk....',
  '.........kLLk...',
  '........kLMk....',
  '.......kLMk.....',
  '....kkkLMk......',
  '...kLLLMk.kk....',
  '...kkkkMkkLLk...',
  '......kMkLMk....',
  '.....kRRk.k.....',
  '....kRkkRk......',
  '...kRk..kRk.....',
  '...kRk..kRk.....',
  '....kRRRRk......',
  '.....kkkk.......',
  '................',
];
const BOW = [
  '................',
  '..........kkkk..',
  '.........kWWWSk.',
  '........kWkk.Sk.',
  '.......kWk..S.k.',
  '......kWk..S..k.',
  '.....kWk..S..kWk',
  '....kWk..S...kWk',
  '...kWk..S....kWk',
  '..kWk..S.....kWk',
  '.kWk..S.....kWk.',
  '.kWk.S.....kWk..',
  '.kSkS....kkWk...',
  '..kSk...kWWk....',
  '..kkkkkkkkk.....',
  '................',
];
const ARROW = [
  '................',
  '...........kkk..',
  '..........kLLk..',
  '..........kLMk..',
  '.........kWkk...',
  '........kWk.....',
  '.......kWk......',
  '......kWk.......',
  '.....kWk........',
  '....kWk.........',
  '..kFWk..........',
  '.kFFk...........',
  '.kFkF...........',
  '..k.............',
  '................',
  '................',
];
const INGOT = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '.....kkkkkkk....',
  '....kLLLLLLMk...',
  '...kLLMMMMMMDk..',
  '..kMMMMMMMMMDk..',
  '.kMMMMMMMMMDDk..',
  '.kDDDDDDDDDDk...',
  '..kkkkkkkkkk....',
  '................',
  '................',
  '................',
  '................',
];
const GEM = [
  '................',
  '................',
  '................',
  '.....kkkkkk.....',
  '....kLLMMLLk....',
  '...kLWLMMLLMk...',
  '..kLLLMMMMLMMk..',
  '..kMMMMMMMMMDk..',
  '...kMMMMMMMDk...',
  '....kMMMMMDk....',
  '.....kMMMDk.....',
  '......kMDk......',
  '.......kk.......',
  '................',
  '................',
  '................',
];
const EMERALD = [
  '................',
  '.......kk.......',
  '......kLMk......',
  '.....kLLMDk.....',
  '....kLLWMMDk....',
  '....kLWMMMDk....',
  '....kLMMMMDk....',
  '....kMMMMMDk....',
  '....kMMMMDDk....',
  '....kMMMDDDk....',
  '.....kMDDDk.....',
  '......kDDk......',
  '.......kk.......',
  '................',
  '................',
  '................',
];
const BALL = [
  '................',
  '................',
  '.....kkkkkk.....',
  '....kLLMMMMk....',
  '...kLWLMMMMDk...',
  '..kLLMMMMMMMDk..',
  '..kLMMMMMMMMDk..',
  '..kMMMMMMMMMDk..',
  '..kMMMMMMMMDDk..',
  '..kMMMMMMMDDDk..',
  '...kMMMMDDDDk...',
  '....kDDDDDDk....',
  '.....kkkkkk.....',
  '................',
  '................',
  '................',
];
const APPLE = [
  '................',
  '.......k........',
  '.......kSk......',
  '......kLkSk.....',
  '....kkkSkkkk....',
  '...kLLMMMMMMk...',
  '..kLWLMMMMMMDk..',
  '..kLLMMMMMMMDk..',
  '..kLMMMMMMMMDk..',
  '..kMMMMMMMMMDk..',
  '..kMMMMMMMMDDk..',
  '...kMMMMMMDDk...',
  '....kMDkkDDk....',
  '.....kk..kk.....',
  '................',
  '................',
];
const EGG = [
  '................',
  '................',
  '......kkkk......',
  '.....kLLMMk.....',
  '....kLWLMMMk....',
  '....kLLMMMMk....',
  '...kLMMMMMMMk...',
  '...kMMMMSMMMk...',
  '...kMMSMMMMDk...',
  '...kMMMMMMDDk...',
  '....kMMMMDDk....',
  '.....kDDDDk.....',
  '......kkkk......',
  '................',
  '................',
  '................',
];
const POTION = [
  '................',
  '......kkkk......',
  '......kCCk......',
  '.......kk.......',
  '......kGGk......',
  '......kGGk......',
  '.....kGLLGk.....',
  '....kLWLMMMk....',
  '...kLLMMMMMMk...',
  '...kLMMMMMMMk...',
  '...kMMMMMMMDk...',
  '...kMMMMMMDDk...',
  '....kMMMDDDk....',
  '.....kkkkkk.....',
  '................',
  '................',
];
const CHEST = [
  '................',
  '..kkkk....kkkk..',
  '.kLMMMkkkkMMMDk.',
  '.kLMMMMMMMMMMDk.',
  '.kLMMkMMMMkMMDk.',
  '..kkkLMMMMMDkk..',
  '....kLMMMMMDk...',
  '....kLMMMMMDk...',
  '....kLMMMMMDk...',
  '....kLMMMMMDk...',
  '....kLMMMMMDk...',
  '....kMMMMMMDk...',
  '....kkkkkkkkk...',
  '................',
  '................',
  '................',
];
const BOOTS = [
  '................',
  '................',
  '................',
  '................',
  '..kkkk....kkkk..',
  '..kLMk....kMDk..',
  '..kLMk....kMDk..',
  '..kLMk....kMDk..',
  '..kLMk....kMDk..',
  '.kLLMk....kMDDk.',
  'kLMMMk....kMMDDk',
  'kkkkkk....kkkkkk',
  '................',
  '................',
  '................',
  '................',
];
const HEART = [
  '................',
  '................',
  '................',
  '...kkk...kkk....',
  '..kWLLk.kLLLk...',
  '.kLWLLLkLLLLLk..',
  '.kLLLLLLLLLLMk..',
  '.kLLLLLLLLLLMk..',
  '..kLLLLLLLLMk...',
  '...kLLLLLLMk....',
  '....kLLLLMk.....',
  '.....kLLMk......',
  '......kMk.......',
  '.......k........',
  '................',
  '................',
];
const HOOK = [
  '................',
  '.....kkkk.......',
  '....kLLLLk......',
  '...kLkkkkLk.....',
  '...kLk..kLk.....',
  '....kkkkLk......',
  '.......kLk......',
  '.......kLk......',
  '.......kWk......',
  '.......kWk......',
  '......kWWWk.....',
  '.....kWkkkWk....',
  '.....kWk.kWk....',
  '......kk..kk....',
  '................',
  '................',
];
const FEATHER = [
  '................',
  '...........kk...',
  '..........kLLk..',
  '.........kLWLk..',
  '........kLWLk...',
  '.......kLWLMk...',
  '......kLWLMk....',
  '.....kLWLMk.....',
  '....kLWLMk......',
  '....kWLMk.......',
  '...kWkkk........',
  '..kWk...........',
  '.kWk............',
  '.kk.............',
  '................',
  '................',
];
const SPAWN_EGG = EGG;

type Shades = { k: string; L: string; M: string; D: string; W?: string };
const METALS: Record<string, Shades> = {
  wood: { k: '#2a1d10', L: '#c49a5c', M: '#9c7442', D: '#6b4d2a' },
  stone: { k: '#262626', L: '#b8b8b8', M: '#8f8f8f', D: '#5f5f5f' },
  iron: { k: '#2b2b2b', L: '#ffffff', M: '#d8d8d8', D: '#a3a3a3' },
  gold: { k: '#4a3200', L: '#fff59a', M: '#f5d23a', D: '#c9931a' },
  diamond: { k: '#0e3b3a', L: '#d9fffb', M: '#4fe0d6', D: '#21a49b' },
};
const HANDLE = { W: '#9c7442', w: '#6b4d2a', G: '#5b4430' };

// ---------------------------------------------------------------------------------------------------------------

/** Paints a single tile by name. */
function paint(t: Tile, name: TileName) {
  const r = t.r;
  switch (name) {
    case 'grass_top':
      t.noise(['#5f9e3d', '#6aac45', '#57923a', '#73b54d', '#4f8a34'], [3, 3, 2, 1.2, 1]);
      for (let i = 0; i < 6; i++) t.px((r() * 16) | 0, (r() * 16) | 0, '#86c45a');
      return;
    case 'grass_side':
      paint(t, 'dirt');
      for (let x = 0; x < 16; x++) {
        const h = 3 + ((r() * 2.2) | 0) + (x % 5 === 2 ? 1 : 0);
        for (let y = 0; y < h; y++) t.px(x, y, y === h - 1 ? '#4d8a33' : r() < 0.5 ? '#6aac45' : '#5f9e3d');
      }
      return;
    case 'dirt':
      t.noise(['#86603d', '#7a5534', '#946c45', '#6b4a2c', '#9c7a52'], [3, 3, 2, 1, 0.6]);
      return;
    case 'stone':
      t.noise(['#8a8a8a', '#7f7f7f', '#959595', '#727272'], [3, 3, 2, 1]);
      for (let i = 0; i < 4; i++) {
        const x = (r() * 14) | 0;
        const y = (r() * 15) | 0;
        t.rect(x, y, 2 + ((r() * 2) | 0), 1, '#6a6a6a');
      }
      return;
    case 'cobble': {
      t.noise(['#7a7a7a', '#858585', '#6d6d6d'], [2, 2, 1]);
      const stones = [
        [0, 0, 6, 5],
        [6, 0, 5, 4],
        [11, 0, 5, 6],
        [0, 5, 4, 5],
        [4, 4, 7, 6],
        [11, 6, 5, 5],
        [0, 10, 6, 6],
        [6, 10, 5, 6],
        [11, 11, 5, 5],
      ];
      for (const [x, y, w, h] of stones) {
        t.rect(x, y, w, 1, '#a0a0a0');
        t.rect(x, y + h - 1, w, 1, '#4e4e4e');
        t.rect(x + w - 1, y, 1, h, '#5a5a5a');
      }
      return;
    }
    case 'sandstone_top':
      t.noise(['#e8cf9f', '#e2c793', '#ecd6aa', '#dcc08b'], [3, 3, 2, 1]);
      return;
    case 'sandstone_side':
      t.noise(['#e4c995', '#dcbf89', '#e9d2a5', '#d4b47c'], [3, 3, 2, 1]);
      t.rect(0, 0, 16, 2, '#ecd6aa');
      t.rect(0, 2, 16, 1, '#c9a771');
      t.rect(0, 13, 16, 1, '#c9a771');
      t.rect(0, 14, 16, 2, '#d8bb85');
      return;
    case 'sandbrick': {
      // Stanford's rough cut sandstone: big blocks with deep joints
      t.noise(['#dcc08c', '#d4b783', '#e3c999', '#c9aa75'], [3, 3, 2, 1.2]);
      for (let x = 0; x < 16; x++) {
        t.px(x, 7, '#a9875a');
        t.px(x, 15, '#a9875a');
        t.px(x, 0, '#ecd8ad');
        t.px(x, 8, '#ecd8ad');
      }
      for (let y = 0; y < 7; y++) t.px(7, y, '#a9875a');
      for (let y = 8; y < 15; y++) t.px(15, y, '#a9875a');
      for (let y = 8; y < 15; y++) t.px(0, y, '#ecd8ad');
      for (let y = 0; y < 7; y++) t.px(8, y, '#ecd8ad');
      return;
    }
    case 'roof': {
      // barrel clay tiles in rows, the campus red
      for (let y = 0; y < 16; y++)
        for (let x = 0; x < 16; x++) {
          const row = y >> 2;
          const xx = (x + (row % 2) * 2) % 4;
          const yy = y % 4;
          const base = xx === 0 ? '#8e3220' : xx === 1 ? '#c4573a' : xx === 2 ? '#b34a30' : '#9e3d27';
          t.px(x, y, yy === 3 ? '#7a2918' : yy === 0 && xx === 1 ? '#d8714f' : base);
        }
      for (let i = 0; i < 10; i++) t.px((r() * 16) | 0, (r() * 16) | 0, '#a7442b');
      return;
    }
    case 'cream':
      t.noise(['#efe3c8', '#e9dcbe', '#f4ead4', '#e2d3b2'], [3, 3, 2, 1]);
      t.rect(0, 15, 16, 1, '#d4c39f');
      return;
    case 'cream_window':
      paint(t, 'cream');
      t.rect(5, 3, 6, 11, '#d4c39f');
      t.rect(6, 4, 4, 9, '#3a4a5c');
      t.rect(7, 3, 2, 1, '#3a4a5c');
      t.rect(6, 5, 1, 7, '#56708a');
      t.rect(6, 8, 4, 1, '#d4c39f');
      return;
    case 'palm_side':
      for (let y = 0; y < 16; y++)
        for (let x = 0; x < 16; x++) {
          const d = (x + y * 2) % 6;
          t.px(x, y, d === 0 ? '#5e4528' : d < 3 ? '#8a6a43' : '#9c7a50');
        }
      for (let i = 0; i < 12; i++) t.px((r() * 16) | 0, (r() * 16) | 0, '#6f5433');
      return;
    case 'palm_top':
      t.noise(['#b08a5a', '#a07a4c']);
      for (let a = 0; a < 3; a++) {
        const rad = 2 + a * 2.5;
        for (let i = 0; i < 40; i++) {
          const th = (i / 40) * Math.PI * 2;
          t.px(Math.round(7.5 + Math.cos(th) * rad), Math.round(7.5 + Math.sin(th) * rad), '#7a5c37');
        }
      }
      return;
    case 'leaves': {
      // palm fronds: a rib from corner to corner with leaflets combed off it, lots of sky between
      t.clear();
      const greens = ['#2f7a2c', '#3f8f3a', '#4fa246', '#2a6a28'];
      for (let i = 0; i < 16; i++) {
        t.px(i, 15 - i, '#4a7a2a');
        for (let k = 1; k < 7; k++) {
          if (r() < 0.18) continue;
          const c = greens[(r() * greens.length) | 0];
          if ((i + k) % 2 === 0) t.px(i - k, 15 - i - Math.ceil(k * 0.4), c);
          else t.px(i + Math.ceil(k * 0.4), 15 - i + k, c);
        }
      }
      for (let i = 0; i < 12; i++) t.px((r() * 16) | 0, (r() * 16) | 0, '#6cbd55');
      return;
    }
    case 'forge':
      t.noise(['#5b5b5f', '#535357', '#636367', '#4a4a4e']);
      for (let x = 0; x < 16; x++) {
        t.px(x, 0, '#3a3a3d');
        t.px(x, 8, '#3a3a3d');
      }
      for (let y = 0; y < 8; y++) t.px(y < 8 ? 4 : 0, y, '#3a3a3d');
      for (let y = 8; y < 16; y++) t.px(12, y, '#3a3a3d');
      return;
    case 'iron_block':
      metalBlock(t, '#e6e6e6', '#d0d0d0', '#bdbdbd', '#f8f8f8');
      return;
    case 'gold_block':
      metalBlock(t, '#f8d84a', '#efc532', '#d9a520', '#fff3a0');
      return;
    case 'diamond_block':
      metalBlock(t, '#6fe3df', '#57d3ce', '#3fbab5', '#c9fffb');
      return;
    case 'emerald_block':
      metalBlock(t, '#47d36b', '#36bd59', '#239146', '#b6ffc8');
      return;
    case 'glass':
      t.clear();
      t.rect(0, 0, 16, 1, '#d8eef4');
      t.rect(0, 15, 16, 1, '#9fc1cc');
      t.rect(0, 0, 1, 16, '#d8eef4');
      t.rect(15, 0, 1, 16, '#9fc1cc');
      t.px(3, 3, '#ffffff');
      t.px(4, 4, '#ffffff');
      t.px(5, 5, '#e8f6fa');
      t.px(10, 3, '#ffffff');
      t.px(11, 2, '#e8f6fa');
      return;
    case 'water':
      for (let y = 0; y < 16; y++)
        for (let x = 0; x < 16; x++) {
          const w = Math.sin((x + y * 0.5) * 0.8) + Math.sin(y * 1.3 - x * 0.4);
          t.px(x, y, w > 1.2 ? 'rgba(150,200,255,0.75)' : w > 0 ? 'rgba(52,104,206,0.7)' : 'rgba(40,86,184,0.72)');
        }
      return;
    case 'poppy':
      t.clear();
      t.map(
        [
          '................',
          '................',
          '................',
          '.....OO..OO.....',
          '....OYOOOOYO....',
          '....OOYooYOO....',
          '.....OoccoO.....',
          '....OOoccoOO....',
          '....OYOOOOYO....',
          '.....OO.OOO.....',
          '.......GG.......',
          '.......G........',
          '......GG..L.....',
          '.....L.G.LL.....',
          '.....LLGLL......',
          '.......G........',
        ],
        { O: '#f29b1d', Y: '#ffc14d', o: '#e0780e', c: '#7a3b06', G: '#4f8f34', L: '#6aac45' },
      );
      return;
    case 'tallgrass':
      t.clear();
      for (let i = 0; i < 9; i++) {
        let x = 1 + ((r() * 14) | 0);
        const h = 5 + ((r() * 9) | 0);
        for (let y = 0; y < h; y++) {
          t.px(x, 15 - y, y > h - 3 ? '#86c45a' : r() < 0.5 ? '#5f9e3d' : '#6aac45');
          if (r() < 0.15) x += r() < 0.5 ? -1 : 1;
        }
      }
      return;
    case 'planks':
      for (let y = 0; y < 16; y++)
        for (let x = 0; x < 16; x++) {
          const board = y >> 2;
          const seam = y % 4 === 3;
          const v = r();
          t.px(x, y, seam ? '#6b4d2a' : v < 0.1 ? '#a07a46' : v < 0.55 ? '#b48a52' : board % 2 ? '#bd955c' : '#ad8550');
        }
      for (let b = 0; b < 4; b++) t.px((b * 7 + 3) % 16, b * 4 + 3, '#6b4d2a');
      return;
    case 'end_stone':
      t.noise(['#e8e6b0', '#dedc9f', '#efeec0', '#d4d18f'], [3, 3, 2, 1.5]);
      for (let i = 0; i < 14; i++) t.px((r() * 16) | 0, (r() * 16) | 0, r() < 0.5 ? '#bdb77a' : '#c9c487');
      return;
    case 'obsidian':
      t.noise(['#140e22', '#1e1530', '#0e0a18', '#2a1d42'], [3, 3, 2, 1]);
      for (let i = 0; i < 8; i++) {
        const x = (r() * 15) | 0;
        const y = (r() * 15) | 0;
        t.px(x, y, '#4b3478');
        t.px(x + 1, y, '#38265a');
      }
      return;
    case 'ladder':
      t.clear();
      t.rect(2, 0, 2, 16, '#8a6a3c');
      t.rect(12, 0, 2, 16, '#8a6a3c');
      t.rect(2, 0, 1, 16, '#a6824c');
      t.rect(12, 0, 1, 16, '#a6824c');
      for (const y of [1, 5, 9, 13]) {
        t.rect(2, y, 12, 2, '#a07a46');
        t.rect(2, y + 1, 12, 1, '#7d5c31');
      }
      return;
    case 'bed_end':
      paint(t, 'planks');
      t.rect(0, 0, 16, 3, '#6b4d2a');
      return;
    case 'tnt_side':
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.px(x, y, x % 4 === 0 ? '#a3241a' : '#d63a2b');
      t.rect(0, 5, 16, 6, '#efe9dd');
      t.map(['kkk.k..k.kkk', '.k..kk.k..k.', '.k..k.kk..k.', '.k..k..k..k.'], { k: '#2a2a2a' }, 2, 6);
      return;
    case 'tnt_top':
      t.noise(['#d63a2b', '#c4321f']);
      t.rect(6, 6, 4, 4, '#efe9dd');
      t.rect(7, 7, 2, 2, '#2a2a2a');
      return;
    case 'tnt_bottom':
      t.noise(['#d63a2b', '#c4321f']);
      return;
    case 'lamp':
      t.rect(0, 0, 16, 16, '#3a3a3d');
      t.rect(2, 2, 12, 12, '#ffe9a6');
      t.rect(4, 4, 8, 8, '#fff6d6');
      t.rect(2, 7, 12, 1, '#c9b06a');
      t.rect(7, 2, 1, 12, '#c9b06a');
      return;
    case 'tile_floor': {
      paint(t, 'sandstone_top');
      for (let i = 0; i < 4; i++) {
        t.px(7 - i, 4 + i, '#b5492f');
        t.px(8 + i, 4 + i, '#b5492f');
        t.px(7 - i, 11 - i, '#b5492f');
        t.px(8 + i, 11 - i, '#b5492f');
      }
      t.rect(0, 0, 16, 1, '#cfb27e');
      t.rect(0, 0, 1, 16, '#cfb27e');
      return;
    }
    case 'skin':
    case 'blank':
      t.clear();
      return;
    case 'sword_wood':
      t.clear();
      t.map(SWORD, { ...METALS.wood, ...HANDLE, G: '#6b4d2a' });
      return;
    case 'sword_stone':
      t.clear();
      t.map(SWORD, { ...METALS.stone, ...HANDLE });
      return;
    case 'sword_iron':
      t.clear();
      t.map(SWORD, { ...METALS.iron, ...HANDLE });
      return;
    case 'sword_diamond':
      t.clear();
      t.map(SWORD, { ...METALS.diamond, ...HANDLE });
      return;
    case 'kb_stick':
      t.clear();
      t.map(STICK, { k: '#2a1d10', W: '#a7804a' });
      for (let i = 0; i < 5; i++) t.px(3 + i * 2, 12 - i * 2, '#e9a7ff');
      return;
    case 'pick_wood':
    case 'pick_iron':
    case 'pick_gold':
    case 'pick_diamond':
      t.clear();
      t.map(PICK, { ...METALS[name.slice(5)], W: '#9c7442' });
      return;
    case 'axe_wood':
    case 'axe_stone':
    case 'axe_iron':
    case 'axe_diamond':
      t.clear();
      t.map(AXE, { ...METALS[name.slice(4)], W: '#9c7442' });
      return;
    case 'shears':
      t.clear();
      t.map(SHEARS, { k: '#2b2b2b', L: '#ffffff', M: '#c8c8c8', R: '#c0392b' });
      return;
    case 'bow':
    case 'bow_pull_0':
    case 'bow_pull_1':
    case 'bow_pull_2':
      t.clear();
      t.map(BOW, { k: '#2a1d10', W: '#9c7442', S: name === 'bow' ? '#e0e0e0' : 'rgba(0,0,0,0)' });
      if (name !== 'bow') {
        const pull = Number(name.slice(-1));
        const d = 1 + pull;
        for (let i = 0; i < 10; i++) t.px(12 - i - d + 3, 2 + i + d - 1, '#e0e0e0');
        t.map(ARROW.slice(0, 8), { k: '#2a2a2a', L: '#ffffff', M: '#c8c8c8', W: '#9c7442', F: '#f0f0f0' }, -d, d);
      }
      return;
    case 'arrow':
      t.clear();
      t.map(ARROW, { k: '#2a2a2a', L: '#ffffff', M: '#a8a8a8', W: '#9c7442', F: '#f0f0f0' });
      return;
    case 'iron':
      t.clear();
      t.map(INGOT, METALS.iron);
      return;
    case 'gold':
      t.clear();
      t.map(INGOT, METALS.gold);
      return;
    case 'diamond':
      t.clear();
      t.map(GEM, { ...METALS.diamond, W: '#ffffff' });
      return;
    case 'emerald':
      t.clear();
      t.map(EMERALD, { k: '#0b3d1c', L: '#a8ffbf', M: '#3fd16a', D: '#1d8c43', W: '#ffffff' });
      return;
    case 'fireball':
      t.clear();
      t.map(BALL, { k: '#2a1206', L: '#ffd24a', M: '#e2581b', D: '#7a1e08', W: '#fff6c0' });
      for (let i = 0; i < 6; i++) t.px(4 + ((r() * 8) | 0), 4 + ((r() * 8) | 0), '#3a1608');
      return;
    case 'gapple':
      t.clear();
      t.map(APPLE, { k: '#4a3200', L: '#fff59a', M: '#f5d23a', D: '#c9931a', W: '#ffffff', S: '#5b4430' });
      return;
    case 'pearl':
      t.clear();
      t.map(BALL, { k: '#06302a', L: '#7cf2d4', M: '#1e9c84', D: '#0d5a4c', W: '#d9fff4' });
      t.rect(6, 6, 4, 4, '#073a32');
      return;
    case 'egg':
      t.clear();
      t.map(EGG, { k: '#5a4a32', L: '#ffffff', M: '#f2ecd8', D: '#d8ccaa', W: '#ffffff', S: '#c9b98f' });
      return;
    case 'potion_speed':
    case 'potion_jump':
    case 'potion_invis': {
      const c = name === 'potion_speed' ? ['#bff1ff', '#7cd3f0', '#3b9cc4'] : name === 'potion_jump' ? ['#c9ffb0', '#6fd84a', '#3a9a20'] : ['#e8e8f0', '#9aa0b8', '#6a7090'];
      t.clear();
      t.map(POTION, { k: '#2a2a33', C: '#9c7442', G: '#cfe6ee', L: c[0], M: c[1], D: c[2], W: '#ffffff' });
      return;
    }
    case 'snowball':
      t.clear();
      t.map(BALL, { k: '#5a6a78', L: '#ffffff', M: '#eef6fa', D: '#bfd2de', W: '#ffffff' });
      return;
    case 'golem_egg':
      t.clear();
      t.map(SPAWN_EGG, { k: '#4a4030', L: '#e8dcc0', M: '#d4c4a0', D: '#a8987a', W: '#ffffff', S: '#7a8a4a' });
      return;
    case 'chest_leather':
      t.clear();
      t.map(CHEST, { k: '#2a1d10', L: '#c08a5a', M: '#a06a3c', D: '#6b4424' });
      return;
    case 'chest_chain':
      t.clear();
      t.map(CHEST, { k: '#222', L: '#cfcfcf', M: '#8f8f8f', D: '#5f5f5f' });
      for (let y = 3; y < 12; y += 2) for (let x = 5; x < 12; x += 2) t.px(x, y, '#3a3a3a');
      return;
    case 'chest_iron':
      t.clear();
      t.map(CHEST, METALS.iron);
      return;
    case 'chest_diamond':
      t.clear();
      t.map(CHEST, METALS.diamond);
      return;
    case 'boots_chain':
      t.clear();
      t.map(BOOTS, { k: '#222', L: '#cfcfcf', M: '#8f8f8f', D: '#5f5f5f' });
      return;
    case 'boots_iron':
      t.clear();
      t.map(BOOTS, METALS.iron);
      return;
    case 'boots_diamond':
      t.clear();
      t.map(BOOTS, METALS.diamond);
      return;
    case 'furnace':
      paint(t, 'cobble');
      t.rect(3, 8, 10, 6, '#2a2a2a');
      t.rect(4, 10, 8, 3, '#e2581b');
      t.rect(5, 11, 6, 1, '#ffd24a');
      t.rect(3, 3, 10, 2, '#5a5a5a');
      return;
    case 'beacon':
      t.rect(0, 0, 16, 16, '#7fe8e0');
      t.rect(1, 1, 14, 14, '#bff8f2');
      t.rect(4, 4, 8, 8, '#e8fffd');
      t.rect(6, 6, 4, 4, '#ffffff');
      t.rect(0, 13, 16, 3, '#2a1d40');
      return;
    case 'tripwire':
      t.clear();
      t.map(HOOK, { k: '#2b2b2b', L: '#c8c8c8', W: '#9c7442' });
      return;
    case 'feather':
      t.clear();
      t.map(FEATHER, { k: '#4a4a4a', L: '#f4f4f4', W: '#ffffff', M: '#cfcfcf' });
      return;
    case 'heart':
      t.clear();
      t.map(HEART, { k: '#1a0505', L: '#e8352f', M: '#9e1d18', W: '#ffb0a8' });
      return;
    case 'heart_half':
      t.clear();
      t.map(HEART, { k: '#1a0505', L: '#3a1010', M: '#2a0a0a', W: '#3a1010' });
      t.map(
        HEART.map((row) => row.slice(0, 8)),
        { k: '#1a0505', L: '#e8352f', M: '#9e1d18', W: '#ffb0a8' },
      );
      return;
    case 'heart_empty':
      t.clear();
      t.map(HEART, { k: '#1a0505', L: '#3a1010', M: '#2a0a0a', W: '#3a1010' });
      return;
    case 'heart_gold':
      t.clear();
      t.map(HEART, { k: '#3a2600', L: '#f5d23a', M: '#c9931a', W: '#fff59a' });
      return;
  }
  // team tiles
  const m = /^(wool|clay|sglass|bedh|bedf|beds|crack)_(\d)$/.exec(name);
  if (!m) return;
  const kind = m[1];
  const n = Number(m[2]);
  if (kind === 'crack') {
    crack(t, n);
    return;
  }
  const team = TEAMS[n];
  const c = hex(team.wool);
  if (kind === 'wool') {
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const weave = ((x + y) % 4 === 0 ? 0.9 : 1) * ((x * 3 + y * 5) % 7 === 0 ? 1.08 : 1);
        t.px(x, y, rgb(shade(c, weave * (0.92 + r() * 0.12))));
      }
    return;
  }
  if (kind === 'clay') {
    const cc = mix(c, [150, 110, 90], 0.32);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.px(x, y, rgb(shade(cc, 0.94 + r() * 0.08)));
    return;
  }
  if (kind === 'sglass') {
    t.clear();
    const cc = hex(team.color);
    t.rect(0, 0, 16, 16, rgb(cc, 0.38));
    t.rect(0, 0, 16, 1, rgb(shade(cc, 1.2), 0.85));
    t.rect(0, 15, 16, 1, rgb(shade(cc, 0.8), 0.85));
    t.rect(0, 0, 1, 16, rgb(shade(cc, 1.2), 0.85));
    t.rect(15, 0, 1, 16, rgb(shade(cc, 0.8), 0.85));
    t.px(3, 3, 'rgba(255,255,255,0.8)');
    t.px(4, 4, 'rgba(255,255,255,0.7)');
    t.px(10, 3, 'rgba(255,255,255,0.7)');
    return;
  }
  // beds: blanket in the team color, a white pillow on the head end, wood frame on the sides
  const blanket = (y0: number, y1: number) => {
    for (let y = y0; y < y1; y++) for (let x = 0; x < 16; x++) t.px(x, y, rgb(shade(c, (x === 0 || x === 15 ? 0.78 : 1) * (0.95 + r() * 0.08))));
  };
  if (kind === 'bedh') {
    blanket(0, 16);
    t.rect(2, 1, 12, 6, '#f2f2f2');
    t.rect(2, 6, 12, 1, '#cfcfcf');
    t.rect(2, 1, 12, 1, '#ffffff');
    return;
  }
  if (kind === 'bedf') {
    blanket(0, 16);
    for (let x = 0; x < 16; x++) t.px(x, 15, rgb(shade(c, 0.7)));
    return;
  }
  // side: blanket on top 7px, frame below
  t.clear();
  for (let y = 7; y < 16; y++) for (let x = 0; x < 16; x++) t.px(x, y, y < 12 ? rgb(shade(c, y === 11 ? 0.75 : 0.95 + r() * 0.08)) : y < 14 ? '#9c7442' : '#6b4d2a');
}

function metalBlock(t: Tile, a: string, b: string, c: string, hi: string) {
  t.noise([a, b], [3, 1]);
  t.rect(0, 0, 16, 1, hi);
  t.rect(0, 0, 1, 16, hi);
  t.rect(0, 15, 16, 1, c);
  t.rect(15, 0, 1, 16, c);
  t.rect(2, 2, 3, 1, hi);
  t.rect(2, 2, 1, 3, hi);
  t.rect(11, 13, 3, 1, c);
  t.rect(13, 11, 1, 3, c);
}

/** Crack overlay stage n of 10: one fixed set of fissures, revealed from the middle out. */
function crack(t: Tile, n: number) {
  t.clear();
  const r = rng(12345);
  const pts: [number, number, number][] = [];
  for (let s = 0; s < 7; s++) {
    let x = 7.5;
    let y = 7.5;
    const a0 = (s / 7) * Math.PI * 2 + r() * 0.6;
    for (let k = 0; k < 9; k++) {
      const a = a0 + (r() - 0.5) * 1.2;
      x += Math.cos(a) * 1.2;
      y += Math.sin(a) * 1.2;
      pts.push([Math.round(x), Math.round(y), Math.hypot(x - 7.5, y - 7.5)]);
    }
  }
  const reach = ((n + 1) / 10) * 11;
  for (const [x, y, d] of pts) if (d <= reach) t.px(x, y, 'rgba(20,12,8,0.82)');
}

// ---------------------------------------------------------------------------------------------------------------

export type Atlas = {
  canvas: HTMLCanvasElement;
  /** Mip levels for three.js: 256, 128, 64, 32 and 16 px, each tile downsampled on its own. */
  mips: HTMLCanvasElement[];
};

let cached: Atlas | null = null;

/** Paints the atlas once per page. */
export function buildAtlas(): Atlas {
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_PX;
  canvas.height = ATLAS_PX;
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  TILE_NAMES.forEach((name, i) => {
    const t = new Tile(g, (i % ATLAS_TILES) * T, Math.floor(i / ATLAS_TILES) * T, rng(i * 7919 + 17));
    paint(t, name);
  });
  // per-tile box filter mips, alpha weighted so cutout edges do not go dark
  const mips: HTMLCanvasElement[] = [canvas];
  let prev = g.getImageData(0, 0, ATLAS_PX, ATLAS_PX);
  let size = ATLAS_PX;
  for (let level = 1; level <= 4; level++) {
    const half = size / 2;
    const c = document.createElement('canvas');
    c.width = half;
    c.height = half;
    const cg = c.getContext('2d')!;
    const out = cg.createImageData(half, half);
    const src = prev.data;
    const dst = out.data;
    for (let y = 0; y < half; y++)
      for (let x = 0; x < half; x++) {
        let r = 0;
        let gg = 0;
        let b = 0;
        let a = 0;
        let n = 0;
        for (let oy = 0; oy < 2; oy++)
          for (let ox = 0; ox < 2; ox++) {
            const i = ((y * 2 + oy) * size + (x * 2 + ox)) * 4;
            const al = src[i + 3];
            r += src[i] * al;
            gg += src[i + 1] * al;
            b += src[i + 2] * al;
            a += al;
            n++;
          }
        const o = (y * half + x) * 4;
        if (a > 0) {
          dst[o] = r / a;
          dst[o + 1] = gg / a;
          dst[o + 2] = b / a;
        }
        // keep cutouts (leaves, ladders) solid enough to survive the alpha test at a distance
        dst[o + 3] = Math.min(255, (a / n) * (level === 1 ? 1.15 : 1.3));
      }
    cg.putImageData(out, 0, 0);
    mips.push(c);
    prev = out;
    size = half;
  }
  cached = { canvas, mips };
  return cached;
}

// ---------------------------------------------------------------------------------------------------------------
// HUD icons

const iconCache = new Map<string, string>();

/** A data URL for an item or block icon, drawn at 32px. Blocks get Minecraft's little isometric cube. */
export function iconURL(kind: { tile: number } | { block: number }): string {
  const key = 'tile' in kind ? `t${kind.tile}` : `b${kind.block}`;
  const hit = iconCache.get(key);
  if (hit) return hit;
  const { canvas } = buildAtlas();
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 32;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  const src = (tile: number): [number, number] => [(tile % ATLAS_TILES) * T, Math.floor(tile / ATLAS_TILES) * T];
  if ('tile' in kind) {
    const [sx, sy] = src(kind.tile);
    g.drawImage(canvas, sx, sy, T, T, 0, 0, 32, 32);
  } else {
    const b = BLOCKS[kind.block];
    if (b.shape === 'ladder' || b.shape === 'cross') {
      const [sx, sy] = src(b.tex[2]);
      g.drawImage(canvas, sx, sy, T, T, 0, 0, 32, 32);
    } else {
      // three faces of an isometric cube: top, left, right
      const [tx, ty] = src(b.tex[0]);
      const [lx, ly] = src(b.tex[2]);
      const s = 13;
      const cx = 16;
      const top = 3;
      const face = (sx: number, sy: number, m: [number, number, number, number, number, number], dark: number) => {
        g.save();
        g.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
        g.drawImage(canvas, sx, sy, T, T, 0, 0, T, T);
        if (dark > 0) {
          g.fillStyle = `rgba(0,0,0,${dark})`;
          g.globalCompositeOperation = 'source-atop';
          g.fillRect(0, 0, T, T);
        }
        g.restore();
      };
      const k = s / T;
      // top: maps the tile's x to down-right and y to down-left
      face(tx, ty, [k, k * 0.5, -k, k * 0.5, cx, top], 0);
      face(lx, ly, [k, k * 0.5, 0, k * 1.1, cx - s, top + s * 0.5], 0.28);
      face(lx, ly, [k, -k * 0.5, 0, k * 1.1, cx, top + s], 0.44);
    }
  }
  const url = c.toDataURL();
  iconCache.set(key, url);
  return url;
}

export const tileOf = (name: TileName) => TILE[name];
