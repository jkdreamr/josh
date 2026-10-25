import { BROWN, CARDINAL, GREEN, ORANGE, PINK, circle, ellipse, line, rect, text } from '../draw.ts';
import { int, mulberry32 } from '../rng.ts';
import { standardDuration, type MicroGame, type MicroInstance } from './types.ts';

export type SquirrelPop = { spot: number; at: number; life: number };
export const SQUIRREL_SPOTS = [{ x: 18, y: 55 }, { x: 43, y: 48 }, { x: 76, y: 56 }, { x: 27, y: 78 }, { x: 57, y: 75 }, { x: 84, y: 79 }];

export function squirrelSchedule(seed: number, difficulty: number): SquirrelPop[] {
  const rng = mulberry32(seed);
  const need = 2 + Math.floor(difficulty * 2.99);
  const count = need + 2;
  return Array.from({ length: count }, (_, i) => ({
    spot: int(rng, 0, SQUIRREL_SPOTS.length - 1),
    at: 0.25 + i * (0.72 - difficulty * 0.16),
    life: 0.5,
  }));
}

export const squirrel: MicroGame = {
  id: 'squirrel',
  title: 'squirrel swat',
  command: 'swat!',
  input: 'tap',
  keys: 'cursor',
  hint: { touch: 'tap the squirrels', keys: 'arrows + space' },
  duration: standardDuration(5.2, 3.2),
  create(seed, difficulty): MicroInstance {
    const pops = squirrelSchedule(seed, difficulty);
    const need = 2 + Math.floor(difficulty * 2.99);
    const hit = pops.map(() => false);
    let bonks = 0;
    let now = 0;
    const self: MicroInstance = {
      outcome: 'pending',
      update(_dt, t) {
        now = t;
      },
      render(c, t) {
        text(c, `bonk ${bonks} / ${need}`, 50, 11, 6);
        SQUIRREL_SPOTS.forEach((p, i) => {
          ellipse(c, p.x, p.y + 4, 9, 5, i < 3 ? GREEN : BROWN, 1);
          rect(c, p.x - 7, p.y + 1, 14, 8, i < 3 ? GREEN : ORANGE, 2, 0.8);
          line(c, p.x - 8, p.y + 1, p.x + 8, p.y + 1, 1.2, BROWN);
        });
        pops.forEach((pop, i) => {
          if (hit[i] || t < pop.at || t > pop.at + pop.life) return;
          const p = SQUIRREL_SPOTS[pop.spot];
          const rise = Math.sin(Math.PI * Math.max(0, Math.min(1, (t - pop.at) / pop.life))) * 8;
          drawSquirrel(c, p.x, p.y - rise);
        });
        for (let i = 0; i < need; i++) circle(c, 77 + i * 6, 11, 2.2, i < bonks ? GREEN : '#fff');
      },
      down(x, y) {
        if (self.outcome !== 'pending') return;
        for (let i = 0; i < pops.length; i++) {
          const pop = pops[i];
          if (hit[i] || now < pop.at || now > pop.at + pop.life) continue;
          const p = SQUIRREL_SPOTS[pop.spot];
          if (Math.hypot(x - p.x, y - (p.y - 3)) <= 11) {
            hit[i] = true;
            bonks++;
            if (bonks >= need) self.outcome = 'pass';
            break;
          }
        }
      },
      timeUp: () => (bonks >= need ? 'pass' : 'fail'),
    };
    return self;
  },
};

function drawSquirrel(c: CanvasRenderingContext2D, x: number, y: number) {
  ellipse(c, x, y + 3, 5.4, 6, BROWN);
  circle(c, x, y - 3, 4.8, ORANGE);
  circle(c, x - 3.5, y - 7, 2.2, ORANGE);
  circle(c, x + 3.5, y - 7, 2.2, ORANGE);
  circle(c, x, y + 1, 1.2, CARDINAL, 0.6);
  circle(c, x - 1.7, y - 4, 0.65, '#fff');
  circle(c, x + 1.7, y - 4, 0.65, '#fff');
  line(c, x - 2, y + 6, x + 2, y + 6, 0.8, PINK);
  ellipse(c, x + 6, y + 4, 3, 5, BROWN, 0.8);
}
