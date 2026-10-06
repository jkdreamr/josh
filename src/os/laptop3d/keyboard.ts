import { keyRows, type KeyDef, type KeyKind } from '../keys';

/** Keyboard footprint in cm (MacBook Pro 14"). */
export const KW = 27.0;
export const KD = 11.0;
const U = KW / 14.5;
const RP = KD / 6;
const GAP = 0.3;

export type Key3 = { x: number; z: number; w: number; d: number; a?: string; b?: string; k: KeyKind | 'arrow' | 'space'; icon?: string; code: string };

const SYMBOL_CODES: Record<string, string> = {
  '`': 'Backquote',
  '-': 'Minus',
  '=': 'Equal',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '\\': 'Backslash',
  ';': 'Semicolon',
  "'": 'Quote',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
};
const LABEL_CODES: Record<string, string> = { esc: 'Escape', delete: 'Backspace', tab: 'Tab', 'caps lock': 'CapsLock', return: 'Enter', fn: 'Fn', control: 'Control', option: 'Alt', command: 'Meta', shift: 'Shift' };

/** KeyboardEvent.code for a key definition, so real key presses can light up the matching 3D key. */
function keyCode(k: KeyDef): string {
  if (!k.a && !k.b && !k.k) return 'Space';
  if (k.k === 'touch') return 'Power';
  if (k.k === 'fn') return k.b!;
  if (k.k === 'c') return `Key${k.b}`;
  if (k.k === '2') return /\d/.test(k.b!) ? `Digit${k.b}` : SYMBOL_CODES[k.b!] ?? k.b!;
  const base = LABEL_CODES[k.b!] ?? k.b!;
  return ['Control', 'Alt', 'Meta', 'Shift'].includes(base) ? `${base}${k.k === 'r' ? 'Right' : 'Left'}` : base;
}

/** Key rectangles in keyboard-local cm: x from the left edge, z from the back edge. */
export function layoutKeys(): Key3[] {
  const keys: Key3[] = [];
  keyRows.forEach((row, r) => {
    let cx = 0;
    const z = r * RP + RP / 2;
    for (const k of row) {
      const w = (k.w ?? 1) * U;
      keys.push({ x: cx + w / 2, z, w: w - GAP, d: RP - GAP, a: k.a, b: k.b, k: k.b || k.a || k.k ? (k.k ?? 'c') : 'space', code: keyCode(k) });
      cx += w;
    }
    if (r === keyRows.length - 1) {
      const half = (RP - GAP - 0.08) / 2;
      const top = r * RP + GAP / 2;
      const lowZ = top + (RP - GAP) - half / 2;
      const hw = U - GAP;
      keys.push({ x: cx + U / 2, z: lowZ, w: hw, d: half, k: 'arrow', icon: 'left', code: 'ArrowLeft' });
      keys.push({ x: cx + 1.5 * U, z: top + half / 2, w: hw, d: half, k: 'arrow', icon: 'up', code: 'ArrowUp' });
      keys.push({ x: cx + 1.5 * U, z: lowZ, w: hw, d: half, k: 'arrow', icon: 'down', code: 'ArrowDown' });
      keys.push({ x: cx + 2.5 * U, z: lowZ, w: hw, d: half, k: 'arrow', icon: 'right', code: 'ArrowRight' });
    }
  });
  return keys;
}

const FN_ICONS = ['sun-s', 'sun-l', 'mission', 'search', 'mic', 'moon', 'rew', 'play', 'ff', 'mute', 'vol1', 'vol3'];

/** Paints every key legend onto a transparent canvas covering the keyboard (px per cm = `px`). */
export function drawLegends(keys: Key3[], px: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.round(KW * px);
  c.height = Math.round(KD * px);
  const g = c.getContext('2d')!;
  g.scale(px, px);
  const ink = 'rgba(244, 244, 248, 0.96)';
  g.fillStyle = ink;
  g.strokeStyle = ink;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const font = (size: number, weight = 400) => `${weight} ${size}px Inter, -apple-system, "Helvetica Neue", Arial, sans-serif`;
  // canvas fonts are specified in px, so draw at 100x and scale down
  const text = (s: string, x: number, y: number, size: number, align: CanvasTextAlign = 'center', weight = 400) => {
    g.save();
    g.translate(x, y);
    g.scale(0.01, 0.01);
    g.font = font(size * 100, weight);
    g.textAlign = align;
    g.textBaseline = 'middle';
    g.fillText(s, 0, 0);
    g.restore();
  };
  let fn = 0;
  for (const k of keys) {
    const l = k.x - k.w / 2;
    const r = k.x + k.w / 2;
    const t = k.z - k.d / 2;
    const b = k.z + k.d / 2;
    switch (k.k) {
      case 'c':
        text(k.b!, k.x, k.z, 0.42, 'center', 500);
        break;
      case '2':
        text(k.a!, k.x, k.z - 0.24, 0.3);
        text(k.b!, k.x, k.z + 0.25, 0.3);
        break;
      case 'l':
        if (k.b === 'fn') {
          text('fn', r - 0.2, t + 0.3, 0.2, 'right');
          globe(g, l + 0.33, b - 0.33, 0.15);
        } else {
          text(k.b!, l + 0.18, b - 0.28, 0.19, 'left');
          if (k.a) text(k.a, r - 0.2, t + 0.32, 0.3, 'right');
        }
        break;
      case 'r':
        text(k.b!, r - 0.18, b - 0.28, 0.19, 'right');
        if (k.a) text(k.a, l + 0.2, t + 0.32, 0.3, 'left');
        break;
      case 'fn':
        fnIcon(g, FN_ICONS[fn++], k.x, k.z - 0.12);
        text(k.b!, k.x, b - 0.24, 0.15);
        break;
      case 'touch':
        g.save();
        g.lineWidth = 0.025;
        g.globalAlpha = 0.35;
        g.beginPath();
        g.arc(k.x, k.z, Math.min(k.w, k.d) / 2 - 0.12, 0, Math.PI * 2);
        g.stroke();
        g.restore();
        break;
      case 'arrow':
        tri(g, k.x, k.z, 0.11, k.icon!);
        break;
    }
  }
  return c;
}

function tri(g: CanvasRenderingContext2D, x: number, y: number, s: number, dir: string) {
  const a = { up: -Math.PI / 2, down: Math.PI / 2, left: Math.PI, right: 0 }[dir] ?? 0;
  g.save();
  g.translate(x, y);
  g.rotate(a);
  g.beginPath();
  g.moveTo(s * 0.8, 0);
  g.lineTo(-s * 0.5, -s * 0.75);
  g.lineTo(-s * 0.5, s * 0.75);
  g.closePath();
  g.fill();
  g.restore();
}

function globe(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.save();
  g.lineWidth = 0.022;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.moveTo(x - r, y);
  g.lineTo(x + r, y);
  g.moveTo(x, y - r);
  g.ellipse(x, y, r * 0.45, r, 0, -Math.PI / 2, Math.PI * 1.5);
  g.stroke();
  g.restore();
}

/** Small line icons for the function row (brightness, Mission Control, Spotlight, media, volume …). */
function fnIcon(g: CanvasRenderingContext2D, kind: string, x: number, y: number) {
  g.save();
  g.translate(x, y);
  g.lineWidth = 0.028;
  const s = 0.13;
  g.beginPath();
  switch (kind) {
    case 'sun-s':
    case 'sun-l': {
      const big = kind === 'sun-l';
      const rr = big ? s * 0.5 : s * 0.38;
      g.arc(0, 0, rr, 0, Math.PI * 2);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const r0 = rr + 0.04;
        const r1 = rr + (big ? 0.11 : 0.07);
        g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
        g.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
      }
      g.stroke();
      break;
    }
    case 'mission':
      g.rect(-s, -s * 0.7, s * 0.9, s * 0.6);
      g.rect(s * 0.1, -s * 0.7, s * 0.9, s * 0.6);
      g.rect(-s * 0.45, s * 0.1, s * 0.9, s * 0.6);
      g.stroke();
      break;
    case 'search':
      g.arc(-s * 0.15, -s * 0.15, s * 0.55, 0, Math.PI * 2);
      g.moveTo(s * 0.25, s * 0.25);
      g.lineTo(s * 0.8, s * 0.8);
      g.stroke();
      break;
    case 'mic':
      g.roundRect(-s * 0.28, -s, s * 0.56, s * 1.2, s * 0.28);
      g.moveTo(-s * 0.6, -s * 0.1);
      g.arc(0, -s * 0.1, s * 0.6, Math.PI, 0, true);
      g.moveTo(0, s * 0.5);
      g.lineTo(0, s * 0.85);
      g.stroke();
      break;
    case 'moon':
      g.arc(0, 0, s * 0.75, Math.PI * 0.35, Math.PI * 1.65);
      g.arc(s * 0.45, 0, s * 0.62, Math.PI * 1.25, Math.PI * 0.75, true);
      g.fill();
      break;
    case 'rew':
    case 'ff': {
      g.scale(kind === 'rew' ? -1 : 1, 1);
      for (const ox of [-s * 0.55, s * 0.25]) {
        g.moveTo(ox, -s * 0.5);
        g.lineTo(ox + s * 0.7, 0);
        g.lineTo(ox, s * 0.5);
        g.closePath();
      }
      g.fill();
      break;
    }
    case 'play':
      g.moveTo(-s * 0.9, -s * 0.5);
      g.lineTo(-s * 0.15, 0);
      g.lineTo(-s * 0.9, s * 0.5);
      g.closePath();
      g.fill();
      g.fillRect(s * 0.15, -s * 0.5, s * 0.22, s);
      g.fillRect(s * 0.55, -s * 0.5, s * 0.22, s);
      break;
    case 'mute':
    case 'vol1':
    case 'vol3': {
      g.moveTo(-s * 0.95, -s * 0.28);
      g.lineTo(-s * 0.55, -s * 0.28);
      g.lineTo(-s * 0.1, -s * 0.7);
      g.lineTo(-s * 0.1, s * 0.7);
      g.lineTo(-s * 0.55, s * 0.28);
      g.lineTo(-s * 0.95, s * 0.28);
      g.closePath();
      g.fill();
      g.beginPath();
      const waves = kind === 'vol3' ? 3 : kind === 'vol1' ? 1 : 0;
      for (let i = 0; i < waves; i++) {
        const rr = s * (0.35 + i * 0.3);
        g.moveTo(Math.cos(-0.8) * rr + s * 0.05, Math.sin(-0.8) * rr);
        g.arc(s * 0.05, 0, rr, -0.8, 0.8);
      }
      g.stroke();
      break;
    }
  }
  g.restore();
}

/** Dark perforation pattern for the speaker grilles. */
export function drawGrille(w: number, h: number, px: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.round(w * px);
  c.height = Math.round(h * px);
  const g = c.getContext('2d')!;
  const pitch = 0.085 * px;
  const r = 0.022 * px;
  g.fillStyle = 'rgba(28, 29, 33, 0.92)';
  for (let row = 0, y = r + 1; y < c.height - r; row++, y += pitch * 0.866) {
    for (let x = r + 1 + (row % 2 ? pitch / 2 : 0); x < c.width - r; x += pitch) {
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
  }
  return c;
}
