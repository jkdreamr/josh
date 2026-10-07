// Vector art for Dino Run. Every shape is drawn in local world units (y down inside the sprite box),
// then placed with a transform, so the art stays crisp at any scale.
import type { Obstacle } from './logic';

type C = CanvasRenderingContext2D;
export type Pose = { kind: 'stand' | 'run' | 'air' | 'duck' | 'dead'; phase: number; blink: boolean; tilt: number; squash: number };

const rr = (c: C, x: number, y: number, w: number, h: number, r: number) => {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
  c.fill();
};

function eye(c: C, x: number, y: number, bg: string, ink: string, pose: Pose) {
  c.fillStyle = bg;
  if (pose.kind === 'dead') {
    c.strokeStyle = bg;
    c.lineWidth = 1.4;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(x - 1.8, y - 1.8);
    c.lineTo(x + 1.8, y + 1.8);
    c.moveTo(x + 1.8, y - 1.8);
    c.lineTo(x - 1.8, y + 1.8);
    c.stroke();
    return;
  }
  if (pose.blink) {
    rr(c, x - 2.2, y - 0.5, 4.4, 1.2, 0.6);
    return;
  }
  c.beginPath();
  c.arc(x, y, 2.4, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = ink;
  c.beginPath();
  c.arc(x + 0.8, y + 0.2, 1.2, 0, Math.PI * 2);
  c.fill();
}

/** The dino, 40x44 standing or 54x26 ducking, with its feet at (0, 0) of the transform. */
export function dino(c: C, ink: string, bg: string, pose: Pose) {
  c.save();
  c.fillStyle = ink;
  if (pose.kind === 'duck') {
    c.translate(0, -26);
    // tail
    c.beginPath();
    c.moveTo(8, 6);
    c.quadraticCurveTo(2, 5, 0, 1);
    c.quadraticCurveTo(0, 10, 9, 15);
    c.closePath();
    c.fill();
    rr(c, 5, 3, 34, 16, 8);
    rr(c, 33, 1, 21, 15, 6);
    c.fillStyle = bg;
    rr(c, 44, 11, 10, 1.4, 0.7);
    eye(c, 39.5, 5.5, bg, ink, pose);
    c.fillStyle = ink;
    rr(c, 36, 15, 5, 3, 1.5);
    const a = Math.sin(pose.phase);
    legs(c, 26, [
      [12, 17, Math.max(0, a) * 4],
      [24, 17, Math.max(0, -a) * 4],
    ]);
    c.restore();
    return;
  }
  // squash on landing, pivoting at the feet; lean with vertical speed
  c.scale(1 + (1 - pose.squash) * 0.6, pose.squash);
  c.translate(20, -22);
  c.rotate(pose.tilt);
  c.translate(-20, -22);
  // tail
  c.beginPath();
  c.moveTo(9, 15);
  c.quadraticCurveTo(3, 15, 0, 9);
  c.quadraticCurveTo(-0.5, 22, 10, 28);
  c.closePath();
  c.fill();
  // body, neck, head
  rr(c, 6, 13, 25, 20, 9);
  rr(c, 18, 8, 11, 14, 4);
  rr(c, 18, 0, 22, 16, 6);
  c.fillStyle = bg;
  if (pose.kind === 'dead') rr(c, 30, 10, 10, 3, 1.5);
  else rr(c, 31, 11, 9, 1.4, 0.7);
  eye(c, 24.5, 5.5, bg, ink, pose);
  // arm
  c.fillStyle = ink;
  c.beginPath();
  c.roundRect(27, 21, 7, 3, 1.5);
  c.roundRect(31.5, 21, 2.6, 6, 1.3);
  c.fill();
  const run = pose.kind === 'run';
  const a = Math.sin(pose.phase);
  legs(c, 44, [
    [11, 31, run ? Math.max(0, a) * 5 : pose.kind === 'air' ? 2 : 0],
    [21, 31, run ? Math.max(0, -a) * 5 : 0],
  ]);
  c.restore();
}

function legs(c: C, ground: number, list: [number, number, number][]) {
  for (const [x, top, lift] of list) {
    const bottom = ground - lift;
    rr(c, x, top, 5, bottom - top, 2);
    rr(c, x, bottom - 3, 8, 3, 1.5);
  }
}

/** Cacti grow from (0, 0) upward. The seed picks arm heights so groups never look copy-pasted. */
export function cactus(c: C, o: Obstacle, ink: string, bg: string) {
  const unit = o.kind === 'small' ? 17 : 25;
  c.save();
  c.fillStyle = ink;
  c.strokeStyle = ink;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  for (let i = 0; i < o.count; i++) {
    const s = hash(o.seed + i * 97);
    const h = o.h - (s % 5);
    const stem = o.kind === 'small' ? 7 : 9;
    const cx = i * unit + unit / 2;
    rr(c, cx - stem / 2, -h, stem, h, stem / 2);
    const arm = o.kind === 'small' ? 3.2 : 4.4;
    c.lineWidth = arm;
    const ly = -h * (0.42 + ((s >> 3) % 20) / 100);
    const ry = -h * (0.5 + ((s >> 7) % 20) / 100);
    const reach = unit / 2 - arm / 2 - 0.5;
    c.beginPath();
    c.moveTo(cx, ly);
    c.lineTo(cx - reach, ly);
    c.lineTo(cx - reach, ly - h * 0.24);
    c.moveTo(cx, ry);
    c.lineTo(cx + reach, ry);
    c.lineTo(cx + reach, ry - h * 0.2);
    c.stroke();
    c.globalAlpha = 0.18;
    c.strokeStyle = bg;
    c.lineWidth = 0.8;
    c.beginPath();
    c.moveTo(cx - stem * 0.18, -h + stem * 0.6);
    c.lineTo(cx - stem * 0.18, -2);
    c.moveTo(cx + stem * 0.18, -h + stem * 0.6);
    c.lineTo(cx + stem * 0.18, -2);
    c.stroke();
    c.globalAlpha = 1;
    c.strokeStyle = ink;
  }
  c.restore();
}

/** A little crested flyer, 46x30, flapping with t. Origin at its bottom-left. */
export function flyer(c: C, t: number, ink: string, bg: string) {
  const f = Math.sin(t * 11);
  c.save();
  c.translate(0, -30);
  c.fillStyle = ink;
  // far wing
  wing(c, 20, 15, f * 0.85, 0.55);
  // body, tail, head, crest, beak
  c.beginPath();
  c.ellipse(22, 16, 13, 5, 0, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.moveTo(11, 14);
  c.lineTo(1, 12);
  c.lineTo(11, 18);
  c.fill();
  c.beginPath();
  c.arc(35, 13.5, 5, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.moveTo(33, 10);
  c.lineTo(26, 6);
  c.lineTo(35, 8.6);
  c.fill();
  c.beginPath();
  c.moveTo(38, 11.5);
  c.lineTo(46, 15);
  c.lineTo(38, 16.5);
  c.fill();
  c.fillStyle = bg;
  c.beginPath();
  c.arc(36, 12.4, 1.3, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = ink;
  wing(c, 22, 15, f, 1);
  c.restore();
}

function wing(c: C, x: number, y: number, f: number, alpha: number) {
  c.globalAlpha = alpha;
  const tipY = y - 14 * f;
  c.beginPath();
  c.moveTo(x - 6, y);
  c.quadraticCurveTo(x - 9, (y + tipY) / 2 - 2 * Math.sign(f || 1), x - 4, tipY);
  c.quadraticCurveTo(x + 3, (y + tipY) / 2, x + 6, y);
  c.closePath();
  c.fill();
  c.globalAlpha = 1;
}

export function cloud(c: C, x: number, y: number, s: number) {
  c.beginPath();
  c.arc(x, y, 9 * s, Math.PI * 0.5, Math.PI * 1.5);
  c.arc(x + 12 * s, y - 7 * s, 11 * s, Math.PI, Math.PI * 1.85);
  c.arc(x + 27 * s, y - 3 * s, 9 * s, Math.PI * 1.25, Math.PI * 0.5);
  c.closePath();
  c.fill();
}

export function moon(c: C, x: number, y: number, r: number, bg: string, glow: string) {
  c.save();
  c.shadowColor = glow;
  c.shadowBlur = r * 1.6;
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
  c.restore();
  c.save();
  c.fillStyle = bg;
  c.beginPath();
  c.arc(x - r * 0.45, y - r * 0.2, r * 0.86, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

export const hash = (n: number) => {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
};

/** Linear blend of two #rrggbb colors. */
export function mix(a: string, b: string, t: number) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}
