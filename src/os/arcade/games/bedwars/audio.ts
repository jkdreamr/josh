// Sound design on the arcade synth: block sounds by material, hits and hurts, the bow, pickups, bed alarms,
// explosions and the shop. Quieter with distance from the listener.
import { sfx } from '../../kit';
import type { BlockSound } from './blocks.ts';

let lx = 0;
let ly = 0;
let lz = 0;
export function setListener(x: number, y: number, z: number) {
  lx = x;
  ly = y;
  lz = z;
}
/** 0..1 loudness for a sound at a point. */
export function near(x: number, y: number, z: number, range = 28) {
  const d = Math.hypot(x - lx, y - ly, z - lz);
  return Math.max(0, 1 - d / range);
}

const jitter = () => 0.92 + Math.random() * 0.16;

export function blockSound(kind: BlockSound, what: 'place' | 'break' | 'step' | 'dig', vol = 1) {
  if (vol <= 0.02) return;
  const v = vol * (what === 'step' ? 0.35 : what === 'dig' ? 0.5 : 1);
  const p = jitter() * (what === 'place' ? 1 : what === 'break' ? 0.85 : 1.1);
  switch (kind) {
    case 'wool':
      sfx.noise(what === 'break' ? 0.12 : 0.07, 0.05 * v);
      sfx.tone({ freq: 160 * p, to: 110 * p, dur: 0.06, type: 'sine', vol: 0.06 * v });
      break;
    case 'stone':
      sfx.noise(what === 'break' ? 0.1 : 0.05, 0.1 * v);
      sfx.tone({ freq: 120 * p, to: 70 * p, dur: 0.06, type: 'square', vol: 0.05 * v });
      break;
    case 'wood':
    case 'ladder':
      sfx.tone({ freq: 240 * p, to: 150 * p, dur: 0.07, type: 'triangle', vol: 0.14 * v });
      sfx.noise(0.03, 0.04 * v);
      break;
    case 'glass':
      if (what === 'break') {
        for (const [f, d] of [
          [1900, 0],
          [2600, 0.03],
          [3200, 0.06],
          [2300, 0.09],
        ])
          sfx.tone({ freq: f * p, dur: 0.08, type: 'triangle', vol: 0.06 * v, delay: d });
        sfx.noise(0.12, 0.06 * v);
      } else sfx.tone({ freq: 1100 * p, dur: 0.04, type: 'triangle', vol: 0.06 * v });
      break;
    case 'grass':
      sfx.noise(0.07, 0.06 * v);
      break;
    case 'bed':
      sfx.tone({ freq: 300 * p, to: 140 * p, dur: 0.12, type: 'sawtooth', vol: 0.08 * v });
      break;
  }
}

/** Your hit landed. */
export function hitSound(crit: boolean, vol = 1) {
  sfx.tone({ freq: 380 * jitter(), to: 170, dur: 0.1, type: 'sawtooth', vol: 0.12 * vol });
  sfx.noise(0.05, 0.08 * vol);
  if (crit) sfx.tone({ freq: 1600, to: 2400, dur: 0.08, type: 'triangle', vol: 0.05 * vol, delay: 0.02 });
}

/** You got hurt. */
export function hurtSound() {
  sfx.tone({ freq: 300 * jitter(), to: 130, dur: 0.16, type: 'square', vol: 0.12 });
  sfx.noise(0.06, 0.1);
}

export function swingSound() {
  sfx.noise(0.04, 0.025);
}

export function bowSound(vol = 1) {
  sfx.tone({ freq: 500, to: 950, dur: 0.1, type: 'triangle', vol: 0.1 * vol });
  sfx.noise(0.06, 0.05 * vol);
}

/** Minecraft's ding when your arrow hits someone. */
export function dingSound() {
  sfx.tone({ freq: 1568, dur: 0.22, type: 'sine', vol: 0.12 });
  sfx.tone({ freq: 2093, dur: 0.18, type: 'sine', vol: 0.05, delay: 0.02 });
}

export function pickupSound(item: string) {
  const f = item === 'iron' ? 1 : item === 'gold' ? 1.2 : item === 'diamond' ? 1.45 : item === 'emerald' ? 1.6 : 1.1;
  sfx.tone({ freq: 700 * f * jitter(), to: 1100 * f, dur: 0.05, type: 'sine', vol: 0.09 });
  if (item === 'diamond' || item === 'emerald') sfx.tone({ freq: 1400 * f, dur: 0.12, type: 'triangle', vol: 0.06, delay: 0.06 });
}

export function buySound() {
  sfx.tone({ freq: 880, dur: 0.07, type: 'square', vol: 0.08 });
  sfx.tone({ freq: 1320, dur: 0.12, type: 'square', vol: 0.08, delay: 0.07 });
}

export function denySound() {
  sfx.tone({ freq: 180, dur: 0.18, type: 'square', vol: 0.08 });
  sfx.tone({ freq: 140, dur: 0.18, type: 'square', vol: 0.08, delay: 0.1 });
}

export function upgradeSound() {
  [523, 659, 784, 1047].forEach((f, i) => sfx.tone({ freq: f, dur: 0.12, type: 'triangle', vol: 0.1, delay: i * 0.07 }));
}

/** Somebody's bed went: a dragon-like growl. Yours gets an alarm on top. */
export function bedSound(mine: boolean) {
  sfx.tone({ freq: 160, to: 55, dur: 1.1, type: 'sawtooth', vol: 0.14 });
  sfx.tone({ freq: 240, to: 80, dur: 0.9, type: 'sawtooth', vol: 0.08, delay: 0.05 });
  sfx.noise(0.6, 0.12);
  if (mine) for (let i = 0; i < 4; i++) sfx.tone({ freq: i % 2 ? 660 : 880, dur: 0.16, type: 'square', vol: 0.08, delay: 0.5 + i * 0.18 });
}

export function boomSound(vol = 1) {
  if (vol <= 0.02) return;
  sfx.noise(0.6, 0.3 * vol);
  sfx.tone({ freq: 90, to: 30, dur: 0.5, type: 'sine', vol: 0.25 * vol });
}

export function fireballSound() {
  sfx.noise(0.25, 0.08);
  sfx.tone({ freq: 140, to: 260, dur: 0.25, type: 'sawtooth', vol: 0.06 });
}

export function killSound(final: boolean) {
  sfx.tone({ freq: 1047, dur: 0.1, type: 'triangle', vol: 0.12 });
  sfx.tone({ freq: 1568, dur: 0.18, type: 'triangle', vol: 0.12, delay: 0.08 });
  if (final) sfx.tone({ freq: 2093, dur: 0.3, type: 'triangle', vol: 0.1, delay: 0.18 });
}

export function deathSound() {
  sfx.tone({ freq: 330, to: 90, dur: 0.6, type: 'square', vol: 0.12 });
}

export function trapSound() {
  for (let i = 0; i < 6; i++) sfx.tone({ freq: i % 2 ? 740 : 988, dur: 0.12, type: 'square', vol: 0.07, delay: i * 0.13 });
}

export function eatSound() {
  sfx.noise(0.05, 0.06);
  sfx.tone({ freq: 180 * jitter(), dur: 0.05, type: 'square', vol: 0.03 });
}

export function drinkSound() {
  sfx.tone({ freq: 320 * jitter(), to: 240, dur: 0.08, type: 'sine', vol: 0.08 });
}

export function teleportSound() {
  sfx.tone({ freq: 200, to: 1200, dur: 0.25, type: 'sine', vol: 0.1 });
  sfx.noise(0.2, 0.05);
}

export function tickSound(p = 1) {
  sfx.play('tick', p);
}

export function tierSound() {
  sfx.tone({ freq: 659, dur: 0.1, type: 'triangle', vol: 0.1 });
  sfx.tone({ freq: 988, dur: 0.18, type: 'triangle', vol: 0.1, delay: 0.1 });
}

export function levelUpSound() {
  [392, 523, 659, 784, 1047].forEach((f, i) => sfx.tone({ freq: f, dur: 0.16, type: 'triangle', vol: 0.12, delay: i * 0.09 }));
}
