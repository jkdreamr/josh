import { sfx } from '../../kit';

export function startCrowd() {
  const timer = window.setInterval(() => sfx.noise(0.32, 0.012), 2800);
  return () => window.clearInterval(timer);
}

export function kickThump(power: number) {
  sfx.tone({ freq: 180, to: 70, dur: 0.08, type: 'triangle', vol: Math.min(0.2, 0.06 + power * 0.12) });
}

export function whistle() {
  sfx.tone({ freq: 1400, to: 880, dur: 0.24, type: 'sine', vol: 0.12 });
}

export function netSwish() {
  sfx.noise(0.055, 0.11);
}

export function goalRoar() {
  sfx.noise(0.42, 0.2);
  sfx.tone({ freq: 220, to: 460, dur: 0.32, type: 'sawtooth', vol: 0.08 });
}
