// The nine holes. Pure data: x runs from the tee toward the cup, z across. Units are roughly feet.
export type V = { x: number; z: number };
export type Ground =
  | { k: 'tilt'; gx: number; gz: number }
  | { k: 'hill'; x: number; z: number; r: number; h: number }
  | { k: 'ramp'; axis: 'x' | 'z'; u0: number; u1: number; h0: number; h1: number; l0: number; l1: number };
export type Pond = { x: number; z: number; rx: number; rz: number; depth: number };
export type Post = { x: number; z: number; r: number; kind?: 'fountain' | 'planter' | 'hay' | 'bollard' | 'hub' };
export type Mover =
  | { k: 'sweep'; x: number; z: number; len: number; arms: number; w: number; ph: number; look: 'dish' | 'claw' }
  | { k: 'slide'; ax: number; az: number; bx: number; bz: number; hx: number; hz: number; period: number; ph: number; look: 'stadium' | 'barn' };
export type Loop = { x: number; z: number; a: number; r: number; w: number };
export type DecorKind = 'palm' | 'tower' | 'dish' | 'arches' | 'church' | 'stands' | 'goal' | 'barn' | 'reeds' | 'boathouse' | 'tree' | 'boat';
export type Decor = { k: DecorKind; x: number; z: number; a?: number; s?: number };
export type Theme = { turf: string; rail: string; ground: string; sky: [string, string] };
export type Hole = {
  name: string;
  par: number;
  tee: V;
  cup: V;
  outline: V[];
  walls: V[][];
  posts: Post[];
  ground: Ground[];
  ponds: Pond[];
  movers: Mover[];
  loop?: Loop;
  decor: Decor[];
  theme: Theme;
};

const p = (x: number, z: number): V => ({ x, z });
const ellipse = (cx: number, cz: number, rx: number, rz: number, n: number) => Array.from({ length: n }, (_, i) => p(cx - Math.cos((i / n) * Math.PI * 2) * rx, cz + Math.sin((i / n) * Math.PI * 2) * rz));
const arc = (cx: number, cz: number, r: number, a0: number, a1: number, n: number) => Array.from({ length: n + 1 }, (_, i) => p(cx + Math.cos(a0 + ((a1 - a0) * i) / n) * r, cz + Math.sin(a0 + ((a1 - a0) * i) / n) * r));
const row = (k: DecorKind, x0: number, x1: number, step: number, z: number, s = 1) => {
  const out: Decor[] = [];
  for (let x = x0; x <= x1 + 1e-6; x += step) out.push({ k, x, z, s, a: (x * 1.7) % 6.28 });
  return out;
};

const DAY: Theme = { turf: '#3f9b4f', rail: '#c9a06a', ground: '#7fa95a', sky: ['#9fd3f2', '#e9f4ea'] };
const SAND: Theme = { turf: '#43a057', rail: '#d8b98a', ground: '#cdb48d', sky: ['#a8d6f0', '#f4ead8'] };

export const HOLES: Hole[] = [
  {
    name: 'Palm Drive',
    par: 2,
    tee: p(0, 0),
    cup: p(11.4, 0.25),
    outline: [p(-0.8, -1.2), p(12.6, -1.2), p(12.6, 1.2), p(-0.8, 1.2)],
    walls: [],
    posts: [{ x: 6.2, z: 0, r: 0.42, kind: 'planter' }],
    ground: [{ k: 'tilt', gx: 0, gz: 0.025 }],
    ponds: [],
    movers: [],
    decor: [...row('palm', 0, 12, 2.2, -2.3), ...row('palm', 1.1, 12, 2.2, 2.3), { k: 'palm', x: 6.2, z: 0, s: 0.8 }],
    theme: DAY,
  },
  {
    name: 'Main Quad Fountain',
    par: 3,
    tee: p(0.4, 0),
    cup: p(9.6, 0),
    outline: [p(-0.6, -1.5), p(1.5, -3), p(8.5, -3), p(10.6, -1.5), p(10.6, 1.5), p(8.5, 3), p(1.5, 3), p(-0.6, 1.5)],
    walls: [],
    posts: [
      { x: 5, z: 0, r: 1.25, kind: 'fountain' },
      { x: 2.8, z: 2.0, r: 0.35, kind: 'planter' },
      { x: 2.8, z: -2.0, r: 0.35, kind: 'planter' },
      { x: 7.2, z: 2.0, r: 0.35, kind: 'planter' },
      { x: 7.2, z: -2.0, r: 0.35, kind: 'planter' },
    ],
    ground: [{ k: 'hill', x: 5, z: 0, r: 3.0, h: 0.1 }],
    ponds: [],
    movers: [],
    decor: [{ k: 'arches', x: 5, z: -4.2, s: 1 }, { k: 'church', x: 5, z: -7.2, s: 1 }, { k: 'palm', x: -1.6, z: -2.6 }, { k: 'palm', x: 11.6, z: -2.6 }],
    theme: SAND,
  },
  {
    name: 'Hoover Tower',
    par: 3,
    tee: p(0, 0),
    cup: p(12, 0),
    outline: [p(-0.6, -1.1), p(13.2, -1.1), p(13.2, 1.1), p(-0.6, 1.1)],
    walls: [[p(3.4, 1.1), p(3.4, 0.35)], [p(5.2, -1.1), p(5.2, -0.35)]],
    posts: [],
    ground: [{ k: 'ramp', axis: 'x', u0: 7, u1: 10, h0: 0, h1: 0.45, l0: -1.1, l1: 1.1 }, { k: 'hill', x: 12, z: 0, r: 0.9, h: -0.05 }],
    ponds: [],
    movers: [],
    decor: [{ k: 'tower', x: 14.8, z: -0.4, s: 1 }, ...row('tree', 0.5, 10, 3.2, -2.4), ...row('tree', 2, 10, 3.6, 2.4, 0.8)],
    theme: SAND,
  },
  {
    name: 'The Dish',
    par: 3,
    tee: p(0, 0),
    cup: p(11.7, -1.3),
    outline: [p(-0.6, -1.3), p(3.4, -1.3), p(4.6, -0.7), p(5.8, -0.7), p(7, -2.2), p(12.4, -2.2), p(12.4, 2.2), p(7, 2.2), p(5.8, 0.7), p(4.6, 0.7), p(3.4, 1.3), p(-0.6, 1.3)],
    walls: [],
    posts: [{ x: 9.4, z: 0, r: 0.3, kind: 'hub' }],
    ground: [{ k: 'hill', x: 9.4, z: 0, r: 2.0, h: 0.1 }],
    ponds: [],
    movers: [{ k: 'sweep', x: 9.4, z: 0, len: 1.5, arms: 2, w: 1.0, ph: 0, look: 'dish' }],
    loop: { x: 5.2, z: 0, a: 0, r: 0.5, w: 0.7 },
    decor: [{ k: 'dish', x: 9.2, z: -5.2, s: 1 }, ...row('tree', -0.4, 4, 2.2, -2.6, 0.7)],
    theme: { turf: '#4a9a48', rail: '#e7e2d6', ground: '#b5a36a', sky: ['#9cc9ec', '#f1ecdc'] },
  },
  {
    name: 'Lake Lagunita',
    par: 3,
    tee: p(0.4, 0),
    cup: p(11.6, 0),
    outline: [p(-0.6, -1.8), p(0.6, -2.6), p(11.4, -2.6), p(12.6, -1.8), p(12.6, 1.8), p(11.4, 2.6), p(0.6, 2.6), p(-0.6, 1.8)],
    walls: [],
    posts: [],
    ground: [],
    ponds: [{ x: 6, z: 0.25, rx: 3.4, rz: 1.35, depth: 0.14 }],
    movers: [],
    decor: [{ k: 'boathouse', x: 6, z: -4.4, s: 1 }, { k: 'boat', x: 5.2, z: 0.4 }, { k: 'reeds', x: 3.1, z: 0.9 }, { k: 'reeds', x: 8.9, z: -0.3 }, { k: 'reeds', x: 7.4, z: 1.3 }, ...row('tree', 0, 12, 3, -3.4)],
    theme: { turf: '#3f9652', rail: '#a77c52', ground: '#8db06a', sky: ['#f4b98a', '#f9e3c4'] },
  },
  {
    name: 'The Oval',
    par: 2,
    tee: p(0.2, 0),
    cup: p(10.2, 0.3),
    outline: ellipse(5.2, 0, 6.0, 2.9, 24),
    walls: [],
    posts: [],
    ground: [{ k: 'hill', x: 5.2, z: 0, r: 2.3, h: 0.32 }],
    ponds: [],
    movers: [],
    decor: [...ellipse(5.2, 0, 7.2, 4.0, 12).map((v) => ({ k: 'palm' as const, x: v.x, z: v.z })), { k: 'arches', x: 5.2, z: -5.6, s: 1.2 }],
    theme: DAY,
  },
  {
    name: 'White Plaza',
    par: 3,
    tee: p(0.5, 1.8),
    cup: p(9.2, -1.9),
    outline: [p(-0.6, 0.2), p(0.8, -2.9), p(10.4, -2.9), p(10.4, 2.9), p(-0.6, 2.9)],
    walls: [],
    posts: [{ x: 5.2, z: 0, r: 0.38, kind: 'hub' }, { x: 8.2, z: 0.6, r: 0.32, kind: 'bollard' }],
    ground: [{ k: 'hill', x: 5.2, z: 0, r: 2.5, h: 0.12 }],
    ponds: [],
    movers: [{ k: 'sweep', x: 5.2, z: 0, len: 1.9, arms: 3, w: 0.85, ph: 0.4, look: 'claw' }],
    decor: [...row('tree', 0, 10, 2.5, -3.8), { k: 'tree', x: -1.6, z: 2.2 }, { k: 'tree', x: 11.4, z: 1.6 }],
    theme: { ...SAND, turf: '#3e9a55' },
  },
  {
    name: 'Stanford Stadium',
    par: 3,
    tee: p(0, 0),
    cup: p(11.4, 0),
    outline: [...arc(12, 0, 1.5, -Math.PI / 2, Math.PI / 2, 8), ...arc(0, 0, 1.5, Math.PI / 2, Math.PI * 1.5, 8)],
    walls: [],
    posts: [],
    ground: [{ k: 'hill', x: 11.4, z: 0, r: 1.4, h: -0.07 }],
    ponds: [],
    movers: [
      { k: 'slide', ax: 4.6, az: -0.6, bx: 4.6, bz: 0.6, hx: 0.25, hz: 0.5, period: 3.0, ph: 0, look: 'stadium' },
      { k: 'slide', ax: 8.2, az: -0.6, bx: 8.2, bz: 0.6, hx: 0.25, hz: 0.5, period: 3.0, ph: Math.PI, look: 'stadium' },
    ],
    decor: [{ k: 'stands', x: 6, z: -3.2, s: 1 }, { k: 'stands', x: 6, z: 3.4, a: Math.PI, s: 1 }, { k: 'goal', x: -2.2, z: 0 }, { k: 'goal', x: 14.2, z: 0 }],
    theme: { turf: '#3d9c4c', rail: '#e9e6df', ground: '#6f9b55', sky: ['#8fc6ee', '#e6f1f6'] },
  },
  {
    name: 'Red Barn',
    par: 4,
    tee: p(0, 0),
    cup: p(10.5, -5.3),
    outline: [p(-0.6, -1.2), p(8.8, -1.2), p(8.8, -6.2), p(12.2, -6.2), p(12.2, 1.2), p(-0.6, 1.2)],
    walls: [[p(11.2, 1.2), p(12.2, 0.2)]],
    posts: [{ x: 4.4, z: 0.45, r: 0.38, kind: 'hay' }, { x: 6.4, z: -0.5, r: 0.38, kind: 'hay' }],
    ground: [{ k: 'ramp', axis: 'z', u0: -1.2, u1: -3.6, h0: 0, h1: 0.25, l0: 8.8, l1: 12.2 }],
    ponds: [],
    movers: [{ k: 'slide', ax: 9.95, az: -3.9, bx: 11.05, bz: -3.9, hx: 0.55, hz: 0.22, period: 3.6, ph: 0, look: 'barn' }],
    decor: [{ k: 'barn', x: 10.5, z: -7.6, s: 1 }, ...row('tree', 0, 7, 2.4, -2.6), { k: 'tree', x: 14, z: -3 }],
    theme: { turf: '#4b9a45', rail: '#9b3b2c', ground: '#9aa85e', sky: ['#f2c58f', '#f7ead2'] },
  },
];

export const TOTAL_PAR = HOLES.reduce((s, h) => s + h.par, 0);
