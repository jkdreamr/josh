import { COLUMNS, HOP_TIME, IDLE_GRACE, type Biome, type Car, type Float, type Lane, type State, type Train } from './logic';

export type FxKind = 'feather' | 'splash' | 'dust' | 'coin' | 'ring';
export type Fx = { kind: FxKind; x: number; y: number; t0: number; vx: number; vy: number; spin: number };
export type View = { bottom: number; time: number; death: number; sunset: boolean; fx: Fx[] };

const FX_LIFE: Record<FxKind, number> = { feather: 1, splash: 0.7, dust: 0.35, coin: 0.7, ring: 0.6 };

type Palette = {
  ground: [string, string]; edge: string; leaf: string; leaf2: string; trunk: string; dot: string; dot2: string;
  road: string; water: string; ripple: string; bank: string; log: string; logEnd: string; pad: string; padDark: string; bed: string; tie: string;
};
const palettes: Record<Biome, Palette> = {
  meadow: {
    ground: ['#a9c891', '#a1c088'], edge: '#8fae76', leaf: '#5b8a4d', leaf2: '#76a562', trunk: '#7b6550', dot: '#fff0b1', dot2: '#f3b3a6',
    road: '#596069', water: '#6db4d2', ripple: '#a8d9ea', bank: '#7c9f69', log: '#94653f', logEnd: '#c79d6d', pad: '#5f9e57', padDark: '#4a8445', bed: '#a39a8b', tie: '#6f5a48',
  },
  orchard: {
    ground: ['#cdc583', '#c4bc78'], edge: '#b0a868', leaf: '#d4843a', leaf2: '#e8a848', trunk: '#76583f', dot: '#c94b3b', dot2: '#f0d27a',
    road: '#5d5a63', water: '#5ea5c0', ripple: '#9fcfe0', bank: '#a19a5d', log: '#8a5a37', logEnd: '#c08f5f', pad: '#6d9a4f', padDark: '#577f3f', bed: '#a8977f', tie: '#6b5240',
  },
  dunes: {
    ground: ['#ebd5a2', '#e3cc95'], edge: '#d3b67e', leaf: '#679857', leaf2: '#82b06b', trunk: '#b48a62', dot: '#c69a6c', dot2: '#f2e4c0',
    road: '#686061', water: '#4fb6b4', ripple: '#97dcd6', bank: '#cdb17a', log: '#9b6c46', logEnd: '#d1a674', pad: '#5aa06a', padDark: '#468556', bed: '#c2a987', tie: '#7d6149',
  },
  tundra: {
    ground: ['#eef3f4', '#e5ecef'], edge: '#cfdbe1', leaf: '#4c7a69', leaf2: '#6a9785', trunk: '#6e5a4b', dot: '#ffffff', dot2: '#c9dce6',
    road: '#5a6370', water: '#77aecc', ripple: '#c2e1ef', bank: '#c5d6de', log: '#dcf0f8', logEnd: '#b5d9e8', pad: '#e8f5fa', padDark: '#b9dbe9', bed: '#b4b8bd', tie: '#6f6862',
  },
};
const paints = ['#db7759', '#e5bb62', '#71b4b5', '#eee5cc', '#8586b9'];

function rect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, color: string) {
  c.fillStyle = color;
  c.beginPath();
  c.roundRect(x, y, w, h, r);
  c.fill();
}

function ellipse(c: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, color: string, rot = 0) {
  c.fillStyle = color;
  c.beginPath();
  c.ellipse(x, y, Math.max(0, rx), Math.max(0, ry), rot, 0, Math.PI * 2);
  c.fill();
}

const hash = (n: number) => {
  let t = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b);
  t ^= t >>> 13;
  t = Math.imul(t, 0xc2b2ae35);
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
};

export function layout(w: number, h: number) {
  const cell = Math.max(8, Math.min(w / 10.2, h / 4.4, 66));
  return { cell, rows: h / cell, left: (w - COLUMNS * cell) / 2 };
}

export function createView(): View {
  return { bottom: -0.9, time: 0, death: -1, sunset: false, fx: [] };
}

export function chickenAir(s: State) {
  return s.hop ? Math.sin((s.hop.elapsed / HOP_TIME) * Math.PI) : 0;
}

export function follow(view: View, s: State, w: number, h: number, dt: number) {
  if (!w || !h) return;
  const { rows } = layout(w, h);
  const ahead = Math.min(4.6, Math.max(1.15, rows * 0.32));
  const target = Math.max(-0.9, s.y - ahead);
  view.bottom += (target - view.bottom) * Math.min(1, dt * 6);
}

export function burst(view: View, kind: FxKind, x: number, y: number, count: number, spread = 1) {
  for (let i = 0; i < count; i++) {
    const a = (i / Math.max(1, count)) * Math.PI * 2 + hash(view.fx.length * 7 + i + Math.floor(view.time * 997)) * 0.8;
    const v = (0.6 + hash(i * 13 + Math.floor(view.time * 331)) * 1.4) * spread;
    view.fx.push({ kind, x, y, t0: view.time, vx: Math.cos(a) * v, vy: Math.sin(a) * v, spin: (hash(i + 3) - 0.5) * 12 });
  }
}

function chicken(c: CanvasRenderingContext2D, s: State, squash: number) {
  const air = chickenAir(s);
  ellipse(c, 0.03, 0.2, 0.31 - air * 0.1, 0.12 - air * 0.03, '#22312c38');
  c.translate(0, -air * 0.34 + 0.2);
  const sx = 1 + squash * 0.22 - air * 0.06;
  const sy = 1 - squash * 0.24 + air * 0.08;
  c.scale(sx, sy);
  c.translate(0, -0.2);
  const face = s.facing;
  const side = face === 'left' ? -1 : 1;
  const sideways = face === 'left' || face === 'right';
  const tuck = air * 0.07;
  rect(c, -0.18, 0.19, 0.11, 0.18 - tuck, 0.045, '#dc9c37');
  rect(c, 0.07, 0.19, 0.11, 0.18 - tuck, 0.045, '#dc9c37');
  ellipse(c, -0.13, 0.34 - tuck, 0.11, 0.045, '#edb348');
  ellipse(c, 0.13, 0.34 - tuck, 0.11, 0.045, '#edb348');
  ellipse(c, 0, 0.02, 0.3, 0.32, '#d8dccc');
  ellipse(c, -0.025, -0.03, 0.28, 0.29, '#fffdf1');
  const flap = air * 0.12;
  ellipse(c, -0.25 - flap * 0.4, 0.04 - flap, 0.1, 0.2 - air * 0.04, '#ecebd9', -flap * 2);
  ellipse(c, 0.25 + flap * 0.4, 0.04 - flap, 0.1, 0.2 - air * 0.04, '#ecebd9', flap * 2);
  const headX = sideways ? side * 0.14 : 0;
  if (face === 'up') {
    ellipse(c, 0, -0.2, 0.22, 0.21, '#fffdf1');
    for (let i = 0; i < 3; i++) ellipse(c, -0.1 + i * 0.1, -0.36 - (i === 1 ? 0.035 : 0), 0.07, 0.095, '#d65445');
    ellipse(c, 0, 0.27, 0.14, 0.08, '#ecebd9');
    return;
  }
  ellipse(c, headX, -0.22, 0.22, 0.21, '#fffdf1');
  for (let i = 0; i < 3; i++) ellipse(c, headX - 0.12 + i * 0.1, -0.39 - (i === 1 ? 0.035 : 0), 0.07, 0.095, '#d65445');
  const beakX = sideways ? side * 0.37 : 0;
  const beakY = sideways ? -0.18 : -0.1;
  c.fillStyle = '#edb348';
  c.beginPath();
  if (sideways) {
    c.moveTo(beakX - side * 0.09, beakY - 0.065);
    c.lineTo(beakX + side * 0.075, beakY);
    c.lineTo(beakX - side * 0.09, beakY + 0.065);
  } else {
    c.moveTo(-0.085, beakY - 0.03);
    c.lineTo(0, beakY + 0.08);
    c.lineTo(0.085, beakY - 0.03);
  }
  c.fill();
  ellipse(c, sideways ? side * 0.18 : -0.095, -0.24, 0.035, 0.04, '#30352e');
  if (!sideways) ellipse(c, 0.095, -0.24, 0.035, 0.04, '#30352e');
  ellipse(c, headX + (sideways ? side * 0.08 : 0), sideways ? -0.06 : 0.02, 0.045, 0.07, '#d65445');
}

function flatChicken(c: CanvasRenderingContext2D) {
  ellipse(c, 0, 0.05, 0.44, 0.14, '#22312c30');
  ellipse(c, 0, 0, 0.42, 0.12, '#fffdf1');
  ellipse(c, 0.28, -0.02, 0.1, 0.05, '#d65445');
  ellipse(c, -0.36, 0.02, 0.09, 0.04, '#edb348');
  ellipse(c, 0.4, 0.04, 0.09, 0.04, '#edb348');
}

function vehicle(c: CanvasRenderingContext2D, car: Car, direction: number) {
  c.scale(direction, 1);
  const x = -car.width / 2;
  const w = car.width;
  ellipse(c, 0.05, 0.12, w / 2 + 0.06, 0.32, '#28333938');
  for (const wheelX of [x + 0.14, -x - 0.36]) {
    rect(c, wheelX, -0.34, 0.22, 0.12, 0.03, '#2d343b');
    rect(c, wheelX, 0.22, 0.22, 0.12, 0.03, '#2d343b');
  }
  const paint = paints[car.color % paints.length];
  rect(c, x, -0.24, w, 0.53, 0.12, '#00000030');
  rect(c, x, -0.29, w, 0.53, 0.12, paint);
  if (car.kind === 'truck') {
    rect(c, x + 0.06, -0.25, w - 0.68, 0.46, 0.05, '#e3d4b2');
    for (let t = 0.28; t < w - 0.68; t += 0.24) rect(c, x + t, -0.23, 0.03, 0.42, 0, '#bfae88');
    rect(c, -x - 0.56, -0.22, 0.24, 0.4, 0.05, '#3f5862');
    rect(c, -x - 0.6, -0.26, 0.05, 0.48, 0.02, '#00000025');
  } else if (car.kind === 'racer') {
    rect(c, x + 0.04, -0.06, w - 0.08, 0.07, 0.02, '#fffaf0cc');
    rect(c, x + 0.3, -0.2, 0.44, 0.36, 0.1, '#33424b');
    rect(c, x + 0.42, -0.2, 0.2, 0.36, 0.07, paint);
    rect(c, x - 0.02, -0.3, 0.12, 0.56, 0.03, '#2d343b');
  } else {
    rect(c, x + 0.27, -0.24, 0.6, 0.44, 0.08, '#435763');
    rect(c, x + 0.4, -0.245, 0.31, 0.45, 0.07, paint);
    rect(c, x + 0.78, -0.17, 0.05, 0.3, 0.02, '#c8e4e3');
  }
  for (const y of [-0.21, 0.08]) {
    rect(c, -x - 0.08, y, 0.06, 0.09, 0.02, '#fff2c4');
    rect(c, x + 0.02, y, 0.045, 0.09, 0.02, '#b4463f');
  }
}

function train(c: CanvasRenderingContext2D, t: Train, direction: number) {
  c.save();
  c.translate(t.x, 0);
  c.scale(direction, 1);
  const half = t.length / 2;
  ellipse(c, 0.08, 0.14, half + 0.1, 0.36, '#1d262c40');
  const loco = Math.min(2.6, t.length * 0.32);
  const carriages = Math.max(1, Math.round((t.length - loco) / 2.1));
  const carW = (t.length - loco) / carriages;
  for (let i = 0; i < carriages; i++) {
    const x0 = -half + i * carW;
    rect(c, x0 + 0.04, -0.27, carW - 0.08, 0.6, 0.08, '#00000030');
    rect(c, x0 + 0.04, -0.32, carW - 0.08, 0.6, 0.08, '#41718c');
    rect(c, x0 + 0.1, -0.27, carW - 0.2, 0.08, 0.03, '#5c8fab');
    for (let wx = x0 + 0.24; wx < x0 + carW - 0.3; wx += 0.42) rect(c, wx, -0.16, 0.26, 0.2, 0.04, '#d5ecf0');
    rect(c, x0 + carW - 0.06, -0.06, 0.1, 0.1, 0, '#2d343b');
  }
  const lx = half - loco;
  rect(c, lx + 0.02, -0.27, loco - 0.02, 0.6, 0.14, '#00000030');
  rect(c, lx + 0.02, -0.33, loco - 0.02, 0.6, 0.14, '#c8473d');
  rect(c, lx + 0.1, -0.03, loco - 0.2, 0.08, 0.02, '#f2e3c4');
  rect(c, lx + loco - 0.62, -0.26, 0.42, 0.46, 0.08, '#2f3d45');
  rect(c, lx + loco - 0.56, -0.2, 0.3, 0.16, 0.04, '#cfe8ee');
  rect(c, half - 0.08, -0.27, 0.07, 0.1, 0.02, '#fff2c4');
  rect(c, half - 0.08, 0.1, 0.07, 0.1, 0.02, '#fff2c4');
  c.restore();
}

function log(c: CanvasRenderingContext2D, f: Float, p: Palette, ice: boolean, bob: number) {
  const x = f.x - f.width / 2 + 0.06;
  const w = f.width - 0.12;
  c.save();
  c.translate(0, bob);
  if (ice) {
    rect(c, x, -0.3, w, 0.64, 0.16, '#5b93ad55');
    rect(c, x, -0.36, w, 0.64, 0.16, p.log);
    rect(c, x + 0.12, -0.3, w * 0.45, 0.07, 0.03, '#ffffffcc');
    rect(c, x + w * 0.55, 0.12, w * 0.3, 0.05, 0.02, p.logEnd);
  } else {
    rect(c, x, -0.27, w, 0.6, 0.28, '#3b2a1c55');
    rect(c, x, -0.33, w, 0.6, 0.28, p.log);
    for (let i = 0; i < f.width; i++) {
      const lx = x + 0.35 + i * 0.95;
      if (lx > x + w - 0.3) break;
      rect(c, lx, -0.2 + (i % 2) * 0.24, 0.42, 0.045, 0.02, '#6f4a2c');
    }
    ellipse(c, x + w - 0.14, -0.03, 0.14, 0.28, p.logEnd);
    ellipse(c, x + w - 0.14, -0.03, 0.07, 0.15, '#9b7148');
  }
  c.restore();
}

function pad(c: CanvasRenderingContext2D, f: Float, p: Palette, ice: boolean, seed: number, t: number) {
  const r = 0.44;
  const turn = Math.sin(t * 0.8 + seed) * 0.2 + seed;
  ellipse(c, f.x + 0.03, 0.06, r, r * 0.86, ice ? '#5b93ad44' : '#1f4f5a44');
  c.fillStyle = p.pad;
  c.beginPath();
  if (ice) c.ellipse(f.x, 0, r, r * 0.86, 0, 0, Math.PI * 2);
  else {
    c.moveTo(f.x, 0);
    c.ellipse(f.x, 0, r, r * 0.86, 0, turn + 0.35, turn + Math.PI * 2 - 0.35);
    c.closePath();
  }
  c.fill();
  if (ice) {
    rect(c, f.x - 0.2, -0.2, 0.22, 0.05, 0.02, '#ffffffcc');
  } else {
    c.strokeStyle = p.padDark;
    c.lineWidth = 0.025;
    c.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = turn + 1 + i * 1.3;
      c.moveTo(f.x, 0);
      c.lineTo(f.x + Math.cos(a) * r * 0.75, Math.sin(a) * r * 0.65);
    }
    c.stroke();
    if (hash(seed * 31 + Math.round(f.x * 0)) < 0.35) {
      for (let i = 0; i < 5; i++) ellipse(c, f.x + Math.cos(i * 1.256) * 0.08, Math.sin(i * 1.256) * 0.07 - 0.04, 0.06, 0.035, '#f6c3cf', i * 1.256);
      ellipse(c, f.x, -0.04, 0.035, 0.035, '#f4d36b');
    }
  }
}

function tree(c: CanvasRenderingContext2D, biome: Biome, x: number, p: Palette, v: number) {
  if (biome === 'dunes') {
    if (v < 0.5) {
      ellipse(c, x + 0.05, 0.22, 0.34, 0.14, '#5b462d30');
      rect(c, x - 0.13, -0.55, 0.26, 0.8, 0.13, p.leaf);
      rect(c, x - 0.38, -0.3, 0.14, 0.32, 0.07, p.leaf);
      rect(c, x - 0.38, -0.02, 0.3, 0.13, 0.06, p.leaf);
      rect(c, x + 0.24, -0.42, 0.14, 0.3, 0.07, p.leaf2);
      rect(c, x + 0.08, -0.17, 0.3, 0.13, 0.06, p.leaf2);
      rect(c, x - 0.06, -0.5, 0.06, 0.66, 0.03, p.leaf2);
      ellipse(c, x, -0.56, 0.06, 0.05, '#f2a7b5');
    } else {
      ellipse(c, x + 0.05, 0.22, 0.42, 0.15, '#5b462d30');
      ellipse(c, x, 0.02, 0.42, 0.3, '#a9805a');
      ellipse(c, x - 0.06, -0.06, 0.36, 0.24, p.dot);
      ellipse(c, x - 0.14, -0.14, 0.14, 0.07, '#e2c39a');
    }
    return;
  }
  ellipse(c, x + 0.08, 0.22, 0.42, 0.17, '#2f3d2a30');
  if (biome === 'tundra') {
    rect(c, x - 0.06, 0.02, 0.12, 0.25, 0.03, p.trunk);
    for (let i = 0; i < 3; i++) {
      const y = 0.08 - i * 0.26;
      const r = 0.42 - i * 0.1;
      c.fillStyle = i % 2 ? p.leaf2 : p.leaf;
      c.beginPath();
      c.moveTo(x - r, y);
      c.lineTo(x, y - 0.42);
      c.lineTo(x + r, y);
      c.closePath();
      c.fill();
      c.fillStyle = '#ffffff';
      c.beginPath();
      c.moveTo(x - r * 0.42, y - 0.24);
      c.lineTo(x, y - 0.42);
      c.lineTo(x + r * 0.42, y - 0.24);
      c.closePath();
      c.fill();
    }
    return;
  }
  rect(c, x - 0.06, -0.05, 0.12, 0.33, 0.03, p.trunk);
  ellipse(c, x - 0.12, -0.18, 0.3, 0.27, p.leaf);
  ellipse(c, x + 0.13, -0.27, 0.29, 0.28, p.leaf);
  ellipse(c, x - 0.02, -0.4, 0.27, 0.24, p.leaf2);
  ellipse(c, x - 0.1, -0.46, 0.1, 0.07, '#ffffff30');
  if (biome === 'orchard') {
    ellipse(c, x - 0.2, -0.16, 0.05, 0.05, p.dot);
    ellipse(c, x + 0.18, -0.32, 0.05, 0.05, p.dot);
    ellipse(c, x + 0.04, -0.1, 0.05, 0.05, p.dot);
  }
}

function coin(c: CanvasRenderingContext2D, x: number, t: number) {
  const spin = Math.abs(Math.cos(t * 2.6));
  const lift = Math.sin(t * 3) * 0.04;
  ellipse(c, x + 0.02, 0.2, 0.2, 0.065, '#29442b2a');
  ellipse(c, x, -0.08 + lift, 0.2 * Math.max(0.12, spin), 0.21, '#c98b23');
  ellipse(c, x - 0.01 * spin, -0.09 + lift, 0.17 * Math.max(0.1, spin), 0.18, '#f4c84a');
  ellipse(c, x, -0.09 + lift, 0.09 * Math.max(0.08, spin), 0.1, '#e2a935');
  ellipse(c, x - 0.06 * spin, -0.17 + lift, 0.04 * spin, 0.03, '#fff3c0');
}

function signal(c: CanvasRenderingContext2D, x: number, lane: Lane, t: number) {
  const tr = lane.train;
  const on = !!tr && (tr.warning || tr.running);
  const flip = Math.floor(t * 5) % 2 === 0;
  rect(c, x - 0.03, -0.62, 0.06, 0.82, 0.02, '#4b5157');
  ellipse(c, x + 0.04, 0.22, 0.16, 0.06, '#1d262c30');
  rect(c, x - 0.24, -0.66, 0.48, 0.2, 0.1, '#2d3338');
  for (const [dx, lit] of [[-0.12, on && flip], [0.12, on && !flip]] as const) {
    if (lit) ellipse(c, x + dx, -0.56, 0.16, 0.16, '#ff5a4a40');
    ellipse(c, x + dx, -0.56, 0.065, 0.065, lit ? '#ff6a55' : '#6b3a37');
  }
}

function ground(c: CanvasRenderingContext2D, lane: Lane, above: Lane | undefined, below: Lane | undefined, xl: number, xr: number, t: number) {
  const p = palettes[lane.biome];
  const span = xr - xl;
  if (lane.kind === 'grass') {
    rect(c, xl, -0.5, span, 1.01, 0, p.ground[lane.row & 1]);
    for (let i = 0; i < 6; i++) {
      const hx = xl + hash(lane.seed + i * 17) * span;
      const hy = -0.38 + hash(lane.seed + i * 29) * 0.76;
      if (lane.biome === 'tundra') ellipse(c, hx, hy, 0.09, 0.035, p.dot2);
      else if (lane.biome === 'dunes') ellipse(c, hx, hy, 0.05, 0.035, p.dot);
      else {
        rect(c, hx, hy, 0.022, 0.09, 0, p.edge);
        rect(c, hx + 0.05, hy + 0.02, 0.022, 0.07, 0, p.edge);
        if (i % 3 === 0) ellipse(c, hx + 0.01, hy, 0.045, 0.045, i % 2 ? p.dot2 : p.dot);
      }
    }
    if (below && below.kind === 'river') rect(c, xl, 0.42, span, 0.09, 0, p.bank);
    if (lane.row === 0) {
      for (let col = -0.4; col < COLUMNS; col += 0.45) rect(c, col, 0.43, 0.07, 0.17, 0.02, '#e9e5c5');
      rect(c, -0.4, 0.48, COLUMNS - 0.15, 0.04, 0, '#e9e5c5');
    }
    return;
  }
  if (lane.kind === 'road') {
    rect(c, xl, -0.5, span, 1.01, 0, p.road);
    if (!above || above.kind !== 'road') rect(c, xl, -0.5, span, 0.05, 0, lane.biome === 'tundra' ? '#f4f8f9' : '#c9c5b2');
    else for (let x = Math.floor(xl); x < xr; x += 1.3) rect(c, x, -0.52, 0.62, 0.04, 0, '#e3e4d277');
    if (!below || below.kind !== 'road') rect(c, xl, 0.45, span, 0.05, 0, '#2e353d');
    return;
  }
  if (lane.kind === 'rail') {
    rect(c, xl, -0.5, span, 1.01, 0, p.bed);
    for (let i = 0; i < 10; i++) ellipse(c, xl + hash(lane.seed + i * 11) * span, -0.4 + hash(lane.seed + i * 5) * 0.8, 0.04, 0.03, '#00000018');
    for (let x = Math.floor(xl); x < xr; x += 0.5) rect(c, x, -0.36, 0.17, 0.72, 0.02, p.tie);
    rect(c, xl, -0.24, span, 0.06, 0, '#c7ccd1');
    rect(c, xl, 0.18, span, 0.06, 0, '#c7ccd1');
    rect(c, xl, -0.19, span, 0.02, 0, '#7d848b');
    rect(c, xl, 0.23, span, 0.02, 0, '#7d848b');
    const tr = lane.train;
    if (tr && (tr.warning || tr.running) && Math.floor(t * 5) % 2 === 0) rect(c, xl, -0.5, span, 1.01, 0, '#ff4a3a1c');
    return;
  }
  rect(c, xl, -0.5, span, 1.01, 0, p.water);
  const dir = lane.direction;
  for (let i = 0; i < 7; i++) {
    const base = hash(lane.seed + i * 23) * (span + 2);
    const x = xl - 1 + ((((base + dir * t * lane.speed * 0.5) % (span + 2)) + span + 2) % (span + 2));
    const y = -0.36 + hash(lane.seed + i * 41) * 0.72;
    rect(c, x, y, 0.5 + hash(i + lane.seed) * 0.5, 0.035, 0.02, p.ripple + '99');
  }
  if (!above || above.kind !== 'river') rect(c, xl, -0.5, span, 0.08, 0, '#2c55663a');
}

function objects(c: CanvasRenderingContext2D, lane: Lane, xl: number, xr: number, t: number, signalX: number) {
  const p = palettes[lane.biome];
  if (lane.kind === 'grass') {
    for (const col of lane.trees) tree(c, lane.biome, col, p, hash(lane.seed + col * 7));
    for (const x of [-1.25, -2.35, COLUMNS + 0.25, COLUMNS + 1.35]) {
      if (x < xl - 0.6 || x > xr + 0.6) continue;
      if (hash(lane.seed + Math.round(x * 10)) < 0.55) tree(c, lane.biome, x + (hash(lane.seed + x) - 0.5) * 0.3, p, hash(lane.seed + x * 3));
    }
  } else if (lane.kind === 'road') {
    for (const car of lane.cars) {
      if (car.x + car.width < xl - 1 || car.x - car.width > xr + 1) continue;
      c.save();
      c.translate(car.x, 0);
      vehicle(c, car, lane.direction);
      c.restore();
    }
  } else if (lane.kind === 'rail') {
    if (lane.train?.running) train(c, lane.train, lane.direction);
    signal(c, signalX, lane, t);
  }
  if (lane.coin !== null && !lane.collected) coin(c, lane.coin, t + lane.row * 0.7);
}

function hawk(c: CanvasRenderingContext2D, x: number, y: number, scale: number, flap: number, color = '#5a4130') {
  c.save();
  c.translate(x, y);
  c.scale(scale, scale);
  const lift = Math.sin(flap) * 0.25;
  c.fillStyle = color;
  c.beginPath();
  c.moveTo(0, -0.1);
  c.quadraticCurveTo(-0.6, -0.5 - lift, -1.25, -0.15 - lift * 1.6);
  c.quadraticCurveTo(-0.7, -0.05, -0.2, 0.15);
  c.lineTo(0.2, 0.15);
  c.quadraticCurveTo(0.7, -0.05, 1.25, -0.15 - lift * 1.6);
  c.quadraticCurveTo(0.6, -0.5 - lift, 0, -0.1);
  c.fill();
  ellipse(c, 0, 0.12, 0.2, 0.42, color);
  c.beginPath();
  c.moveTo(-0.17, 0.45);
  c.lineTo(0, 0.72);
  c.lineTo(0.17, 0.45);
  c.fill();
  if (color !== '#00000033') {
    ellipse(c, 0, -0.26, 0.15, 0.15, '#efe6d6');
    c.fillStyle = '#e8b34a';
    c.beginPath();
    c.moveTo(-0.05, -0.36);
    c.lineTo(0, -0.47);
    c.lineTo(0.05, -0.36);
    c.fill();
  }
  c.restore();
}

function effects(c: CanvasRenderingContext2D, view: View, bottom: number) {
  view.fx = view.fx.filter((f) => view.time - f.t0 < FX_LIFE[f.kind]);
  for (const f of view.fx) {
    const a = view.time - f.t0;
    const k = a / FX_LIFE[f.kind];
    const x = f.x + f.vx * a;
    const y = -(f.y - bottom) - f.vy * a + (f.kind === 'feather' ? 0.9 * a * a : 0);
    c.save();
    c.globalAlpha = Math.max(0, 1 - k);
    if (f.kind === 'feather') ellipse(c, x, y, 0.11, 0.04, '#fffdf1', f.spin * a);
    else if (f.kind === 'dust') ellipse(c, x, y + 0.25, 0.08 + k * 0.1, 0.04 + k * 0.04, '#ffffff99');
    else if (f.kind === 'splash') ellipse(c, x, y, 0.06, 0.06, '#e6f6fb');
    else if (f.kind === 'ring') {
      c.strokeStyle = '#e6f6fb';
      c.lineWidth = 0.05;
      c.beginPath();
      c.ellipse(f.x, -(f.y - bottom), 0.15 + k * 0.5, 0.1 + k * 0.32, 0, 0, Math.PI * 2);
      c.stroke();
    } else if (f.kind === 'coin') {
      c.fillStyle = '#fff3c0';
      c.font = '600 0.36px system-ui, -apple-system, sans-serif';
      c.textAlign = 'center';
      c.fillText('+3', f.x, -(f.y - bottom) - 0.5 - k * 0.6);
    }
    c.restore();
  }
}

export function draw(c: CanvasRenderingContext2D, w: number, h: number, s: State, view: View) {
  if (!w || !h) return;
  const { cell, rows, left } = layout(w, h);
  const bottom = view.bottom;
  const t = view.time;
  const margin = left / cell;
  const xl = -0.5 - margin - 0.1;
  const xr = COLUMNS - 0.5 + margin + 0.1;
  const signalX = margin > 0.45 ? -0.5 - margin / 2 : -0.28;
  c.save();
  c.fillStyle = palettes[s.lanes[0]?.biome ?? 'meadow'].edge;
  c.fillRect(0, 0, w, h);
  c.translate(left + cell / 2, h - cell / 2);
  c.scale(cell, cell);
  const visible = s.lanes.filter((l) => l.row >= bottom - 1.6 && l.row <= bottom + rows + 1.2);
  const byRow = new Map(s.lanes.map((l) => [l.row, l]));
  for (const lane of visible) {
    c.save();
    c.translate(0, -(lane.row - bottom));
    ground(c, lane, byRow.get(lane.row + 1), byRow.get(lane.row - 1), xl, xr, t);
    if (lane.kind === 'river') {
      const ice = lane.biome === 'tundra';
      lane.floats.forEach((f, i) => {
        if (f.x + f.width < xl - 1 || f.x - f.width > xr + 1) return;
        const ridden = s.ride === i && Math.round(s.y) === lane.row && !s.hop;
        const bob = ridden ? Math.max(0, 0.05 - (s.time - s.landedAt) * 0.3) : Math.sin(t * 2 + i + lane.row) * 0.012;
        if (f.kind === 'pad') pad(c, f, palettes[lane.biome], ice, lane.seed + i, t);
        else log(c, f, palettes[lane.biome], ice, bob);
      });
    }
    c.restore();
  }
  const chickenRow = Math.floor(s.y + 0.5);
  let drawn = false;
  const drawChicken = () => {
    drawn = true;
    const d = view.death;
    c.save();
    c.translate(s.x, -(s.y - bottom));
    if (d < 0) chicken(c, s, s.landedAt >= 0 && s.time - s.landedAt < 0.13 ? Math.sin(((s.time - s.landedAt) / 0.13) * Math.PI) : 0);
    else if (s.death === 'car') flatChicken(c);
    else if (s.death === 'water' || s.death === 'drift') {
      if (d < 0.35) {
        c.globalAlpha = 1 - d / 0.35;
        c.translate(0, d * 0.5);
        c.scale(1 - d, 1 - d * 1.6);
        chicken(c, s, 0);
      }
    } else if (s.death === 'hawk') {
      if (d < 0.32) chicken(c, s, 0);
    }
    c.restore();
  };
  for (let i = visible.length - 1; i >= 0; i--) {
    const lane = visible[i];
    c.save();
    c.translate(0, -(lane.row - bottom));
    objects(c, lane, xl, xr, t, signalX);
    c.restore();
    if (lane.row === chickenRow && !drawn) drawChicken();
  }
  if (!drawn) drawChicken();
  effects(c, view, bottom);
  const lineY = -(s.scroll - bottom);
  if (s.started && lineY < 1) {
    const danger = s.idle > IDLE_GRACE ? 1 : Math.max(0, (s.idle - IDLE_GRACE + 2) / 2);
    const g = c.createLinearGradient(0, lineY - 1.2, 0, lineY + 0.6);
    g.addColorStop(0, '#1b222000');
    g.addColorStop(1, `rgba(27, 34, 32, ${0.12 + danger * 0.22})`);
    c.fillStyle = g;
    c.fillRect(xl, lineY - 1.2, xr - xl, Math.max(1.8, 1.2 + (h / cell)));
    if (danger > 0.2 && view.death < 0) hawk(c, s.x + Math.sin(t * 1.3) * 1.6, lineY + 0.15, 0.85, t * 7, '#00000033');
  }
  if (view.death >= 0 && s.death === 'hawk') {
    const d = view.death;
    const sy = -(s.y - bottom);
    const top = -(rows + 1);
    const hy = d < 0.32 ? top + (sy - 0.25 - top) * (d / 0.32) : sy - 0.25 + (top - sy) * Math.min(1, (d - 0.32) / 0.6);
    const hx = s.x + (d < 0.32 ? (0.32 - d) * 4 : 0);
    if (d >= 0.32) {
      c.save();
      c.translate(hx, hy + 0.45);
      c.scale(0.8, 0.8);
      chicken(c, s, 0);
      c.restore();
    }
    hawk(c, hx, hy, 1, d * 18);
  }
  c.fillStyle = '#18231c1f';
  c.fillRect(xl - 1, -(rows + 2), -0.5 - (xl - 1), rows + 4);
  c.fillRect(COLUMNS - 0.5, -(rows + 2), xr + 1 - (COLUMNS - 0.5), rows + 4);
  c.restore();
  if (view.sunset) {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#e0784a30');
    g.addColorStop(1, '#6a3b6a26');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  }
}
