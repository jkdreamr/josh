import { CARDINAL, GREY, INK, PINK, WHITE, YELLOW, circle, eyes, line, rect, text } from '../draw.ts';
import { mulberry32, pick, range } from '../rng.ts';
import { standardDuration, type MicroGame, type MicroInstance } from './types.ts';

// The alarm rings, wiggles and begs. Touch nothing until time runs out: any tap or key wakes you up.
const BAIT = ['tap me', 'snooze?', 'press it', 'just once', 'free pizza', 'tap = A+'];

export const snooze: MicroGame = {
  id: 'snooze',
  title: 'snooze',
  command: "don't tap!",
  input: 'none',
  keys: 'direct',
  hint: { touch: 'hands off', keys: 'hands off' },
  duration: standardDuration(4.5, 3),
  create(seed, difficulty): MicroInstance {
    const rng = mulberry32(seed);
    const baits = Array.from({ length: 2 + Math.round(difficulty * 3) }, (_, i) => ({
      at: 0.3 + i * range(rng, 0.5, 0.8),
      x: range(rng, 18, 82),
      y: range(rng, 62, 88),
      word: pick(rng, BAIT),
    }));
    let woke = -1;
    const self: MicroInstance = {
      outcome: 'pending',
      update() {},
      render(c, t) {
        const ring = Math.sin(t * 40) * (woke >= 0 ? 0 : 1);
        // the bed and the sleeper
        rect(c, 10, 46, 80, 16, WHITE, 4);
        rect(c, 10, 40, 22, 10, YELLOW, 4);
        circle(c, 22, 38, 7, '#ffd9b8');
        if (woke >= 0) eyes(c, 22, 37, 2.6, 2, 0, 0);
        else {
          line(c, 18, 37, 21, 37, 0.8);
          line(c, 23, 37, 26, 37, 0.8);
          text(c, 'z', 32 + Math.sin(t * 3) * 2, 28 - (t % 1) * 6, 6, { color: INK });
          text(c, 'z', 37, 22 - ((t + 0.5) % 1) * 6, 4.5, { color: INK });
        }
        // the alarm clock
        c.save();
        c.translate(70 + ring * 1.2, 24);
        c.rotate(ring * 0.08);
        line(c, -6, 9, -8, 12);
        line(c, 6, 9, 8, 12);
        circle(c, -7, -9, 4, YELLOW);
        circle(c, 7, -9, 4, YELLOW);
        circle(c, 0, 0, 11, CARDINAL);
        circle(c, 0, 0, 8, WHITE);
        line(c, 0, 0, 0, -5.5, 1);
        line(c, 0, 0, 4, 1.5, 1);
        c.restore();
        if (woke < 0 && Math.floor(t * 6) % 2 === 0) {
          line(c, 54, 14, 50, 10, 0.9);
          line(c, 86, 14, 90, 10, 0.9);
        }
        for (const b of baits) {
          if (t < b.at) continue;
          const k = Math.min(1, (t - b.at) * 5);
          c.save();
          c.translate(b.x, b.y);
          c.scale(k, k);
          c.rotate(Math.sin(t * 6 + b.x) * 0.08);
          rect(c, -12, -5, 24, 10, PINK, 5);
          text(c, b.word, 0, 0.3, 4.2, { color: INK });
          c.restore();
        }
        if (woke >= 0) text(c, 'you woke up', 50, 96, 5, { color: CARDINAL });
        else text(c, 'shh', 50, 96, 4, { color: GREY });
      },
      down() {
        if (self.outcome === 'pending') {
          woke = 1;
          self.outcome = 'fail';
        }
      },
      press() {
        if (self.outcome === 'pending') {
          woke = 1;
          self.outcome = 'fail';
        }
      },
      timeUp: () => 'pass',
    };
    return self;
  },
};
