import { BROWN, CARDINAL, GREEN, ORANGE, PINK, YELLOW, clamp, ellipse, eyes, rect, text, circle, line } from '../draw.ts';
import { mulberry32, range } from '../rng.ts';
import { standardDuration, type MicroGame, type MicroInstance } from './types.ts';

// Burritos drop from the dining hall ceiling; slide the tray under them. Catch the number on the order slip.
type Drop = { x: number; y: number; v: number; at: number; got: boolean; gone: boolean; spin: number };

export type BurritoDropSchedule = Pick<Drop, 'x' | 'v' | 'at' | 'spin'>;

export function burritoSchedule(seed: number, difficulty: number): BurritoDropSchedule[] {
  const rng = mulberry32(seed);
  const need = difficulty < 0.35 ? 2 : 3;
  const count = need + 1 + (difficulty > 0.7 ? 1 : 0);
  const span = 2.6 - difficulty * 0.8;
  return Array.from({ length: count }, (_, i) => ({
    x: range(rng, 12, 88),
    v: 38 + difficulty * 40 + range(rng, 0, 10),
    at: 0.25 + (i * span) / count + range(rng, 0, 0.2),
    spin: range(rng, -2, 2),
  }));
}

export const burrito: MicroGame = {
  id: 'burrito',
  title: 'burrito catch',
  command: 'catch!',
  input: 'drag',
  keys: 'cursor',
  hint: { touch: 'drag the tray', keys: 'arrows slide the tray' },
  duration: standardDuration(5, 3.4),
  create(seed, difficulty): MicroInstance {
    const need = difficulty < 0.35 ? 2 : 3;
    const drops: Drop[] = burritoSchedule(seed, difficulty).map((drop) => ({
      ...drop,
      y: -10,
      got: false,
      gone: false,
    }));
    const trayW = 24 - difficulty * 6;
    let tray = 50;
    let target = 50;
    let caught = 0;
    let grabbed = false;
    let pop = 0;
    const self: MicroInstance = {
      outcome: 'pending',
      update(dt, t) {
        tray += (target - tray) * Math.min(1, dt * 18);
        pop = Math.max(0, pop - dt * 3);
        for (const d of drops) {
          if (t < d.at || d.gone) continue;
          d.y += d.v * dt;
          if (!d.got && d.y >= 80 && d.y <= 86 && Math.abs(d.x - tray) < trayW / 2 + 3) {
            d.got = true;
            d.gone = true;
            caught++;
            pop = 1;
            if (caught >= need) self.outcome = 'pass';
          }
          if (d.y > 110) d.gone = true;
        }
        const left = drops.filter((d) => !d.gone).length;
        if (self.outcome === 'pending' && caught + left < need) self.outcome = 'fail';
      },
      render(c, t) {
        // the order slip
        rect(c, 4, 4, 30, 13, YELLOW, 1.5);
        text(c, `catch ${need}`, 19, 10.5, 6);
        for (let i = 0; i < need; i++) circle(c, 70 + i * 8, 10, 3, i < caught ? GREEN : '#fff', 0.8);
        for (const d of drops) {
          if (d.gone || t < d.at) continue;
          c.save();
          c.translate(d.x, d.y);
          c.rotate(d.spin * t);
          ellipse(c, 0, 0, 7, 4, ORANGE);
          line(c, -3, -3, -3, 3, 0.8);
          line(c, 2, -3.5, 2, 3.5, 0.8);
          c.restore();
        }
        c.save();
        c.translate(tray, 86);
        c.scale(1 + pop * 0.12, 1 - pop * 0.1);
        rect(c, -trayW / 2, -3, trayW, 6, CARDINAL, 2);
        rect(c, -trayW / 2 + 3, 3, trayW - 6, 2.5, BROWN, 1);
        eyes(c, 0, -0.2, 3.2, 1.8, 0, -1);
        c.restore();
        if (!grabbed) text(c, '< drag >', tray, 95, 4, { color: PINK, weight: 700 });
      },
      down(x) {
        grabbed = true;
        target = clamp(x, 8, 92);
      },
      move(x) {
        grabbed = true;
        target = clamp(x, 8, 92);
      },
      up() {
        grabbed = false;
      },
      timeUp: () => (caught >= need ? 'pass' : 'fail'),
    };
    return self;
  },
};
