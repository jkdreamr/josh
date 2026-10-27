import { hash, mulberry32 } from './rng.ts';
import type { Entrant } from './types.ts';

export const COLORS: readonly number[] = [
  0x24b6a2, 0xf4c542, 0xf16f78, 0x7d8ee8, 0xff914d,
  0x42bde0, 0xd56cc4, 0x81c96b, 0xeaa8cc, 0x8aafcf,
  0xe98958, 0xc7a64a, 0x43a982, 0xa487dc, 0xef7770,
  0x6fb8a6, 0xd89b4c, 0x7199d1, 0xb0bd56, 0xc87c9d,
];

export const BOT_NAMES: readonly string[] = [
  'tassel', 'jelly jo', 'quad dot', 'palmer', 'wobbles',
  'sprout', 'gummy', 'noodle', 'pip', 'marsh',
  'dinky', 'pudding', 'fizz', 'tree top', 'oval al',
  'bean lee', 'mo', 'rally', 'sunny', 'hoot',
];

export function botSkill(seed: number, i: number): number {
  const random = mulberry32(hash(seed, i, 0x51f15e));
  const roll = random();
  const spread = roll < 0.18 ? random() * 0.22 : roll > 0.84 ? 0.78 + random() * 0.22 : 0.26 + random() * 0.48;
  return Math.round((0.78 + spread * 0.22) * 1000) / 1000;
}

export function offlineEntrants(field: number, seed: number, you = 'you'): Entrant[] {
  const count = Math.max(0, Math.min(20, Math.floor(field)));
  return Array.from({ length: count }, (_, id) => ({
    id,
    seat: -1,
    name: id === 0 ? you : BOT_NAMES[(id - 1) % BOT_NAMES.length],
    bot: id !== 0,
    color: COLORS[id % COLORS.length],
    skill: id === 0 ? 1 : botSkill(seed, id),
  }));
}
