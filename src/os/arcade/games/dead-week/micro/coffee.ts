import { BROWN, CARDINAL, GREEN, INK, PINK, WHITE, highlight, line, rect, text, circle } from '../draw.ts';
import { mulberry32, range } from '../rng.ts';
import { standardDuration, type MicroGame, type MicroInstance } from './types.ts';

// Hold to pour, let go inside the band. Overflow spills; stop short and you fail at time up.
export const coffee: MicroGame = {
  id: 'coffee',
  title: 'pour coffee',
  command: 'pour!',
  input: 'hold',
  keys: 'direct',
  hint: { touch: 'hold to pour, let go on the line', keys: 'hold space, let go on the line' },
  duration: standardDuration(5, 3.2),
  create(seed, difficulty): MicroInstance {
    const rng = mulberry32(seed);
    const mid = range(rng, 0.55, 0.82);
    const band = 0.14 - difficulty * 0.07;
    const lo = mid - band / 2;
    const hi = mid + band / 2;
    const rate = 0.32 + difficulty * 0.32 + range(rng, 0, 0.08);
    let fill = 0;
    let pouring = false;
    let poured = false;
    let now = 0;
    const settle = () => {
      if (self.outcome !== 'pending') return;
      if (fill > hi) self.outcome = 'fail';
      else if (fill >= lo) self.outcome = 'pass';
    };
    const self: MicroInstance = {
      outcome: 'pending',
      update(dt, t) {
        now = t;
        if (pouring && self.outcome === 'pending') {
          fill += rate * dt;
          poured = true;
          if (fill > 1) {
            fill = 1;
            self.outcome = 'fail';
          }
        }
      },
      render(c) {
        // the pot
        const tilt = pouring && self.outcome === 'pending' ? 0.7 : 0.15;
        c.save();
        c.translate(38, 18);
        c.rotate(tilt);
        rect(c, -10, -8, 20, 18, WHITE, 3);
        rect(c, -10, -8, 20, 5, CARDINAL, 2);
        line(c, 10, -4, 16, -7, 1.4);
        c.restore();
        if (pouring && self.outcome === 'pending') {
          c.beginPath();
          c.moveTo(51, 22);
          c.quadraticCurveTo(54, 40, 54, 86 - fill * 50);
          c.lineWidth = 2.6;
          c.strokeStyle = BROWN;
          c.stroke();
        }
        // the cup, 50 units tall from y 36 to 86
        const top = 36;
        const h = 50;
        c.save();
        c.beginPath();
        c.rect(36, top, 36, h);
        c.clip();
        c.fillStyle = BROWN;
        c.fillRect(36, top + h * (1 - fill), 36, h * fill + 1);
        c.restore();
        highlight(c, 33, top + h * (1 - hi), 42, h * (hi - lo), GREEN, 0.5);
        rect(c, 36, top, 36, h, null, 2, 1.4);
        line(c, 31, top + h * (1 - mid), 77, top + h * (1 - mid), 0.6, INK);
        c.beginPath();
        c.arc(76, top + 22, 7, -1.2, 1.2);
        c.lineWidth = 1.4;
        c.strokeStyle = INK;
        c.stroke();
        text(c, 'line', 86, top + h * (1 - mid), 3.6, { color: INK });
        if (fill >= 1 || self.outcome === 'fail') {
          for (let i = 0; i < 4; i++) circle(c, 30 + i * 14, 90 + (i % 2) * 2, 3, BROWN, 0.6);
          text(c, 'spilled', 54, 96, 5, { color: CARDINAL });
        } else if (!poured) text(c, 'hold', 54, 96, 4.5, { color: PINK });
        void now;
      },
      down() {
        if (self.outcome === 'pending') pouring = true;
      },
      up() {
        if (!pouring) return;
        pouring = false;
        settle();
      },
      press(key) {
        if (key === 'action') self.down?.(0, 0);
      },
      release(key) {
        if (key === 'action') self.up?.(0, 0);
      },
      timeUp() {
        pouring = false;
        return fill >= lo && fill <= hi ? 'pass' : 'fail';
      },
    };
    return self;
  },
};
