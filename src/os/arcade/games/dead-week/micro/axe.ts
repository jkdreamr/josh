import { BROWN, CARDINAL, GREY, INK, PINK, WHITE, YELLOW, circle, ellipse, eyes, line, rect, text, highlight } from '../draw.ts';
import { mulberry32, range } from '../rng.ts';
import { standardDuration, type MicroGame, type MicroInstance } from './types.ts';

// A tug of war over the axe against a big bear. Mash to pull it your way; win it outright or be ahead at time up.
export const axe: MicroGame = {
  id: 'axe',
  title: 'mash for the axe',
  command: 'mash!',
  input: 'mash',
  keys: 'direct',
  hint: { touch: 'tap tap tap', keys: 'mash space' },
  duration: standardDuration(4.5, 3),
  create(seed, difficulty): MicroInstance {
    const rng = mulberry32(seed);
    const pull = 0.1;
    const bear = 0.16 + difficulty * 0.26 + range(rng, 0, 0.04);
    // the bear surges now and then
    const surgeAt = range(rng, 1, 2.2);
    let p = 0;
    let shake = 0;
    let taps = 0;
    const tug = () => {
      if (self.outcome !== 'pending') return;
      p += pull;
      taps++;
      shake = 1;
      if (p >= 1) {
        p = 1;
        self.outcome = 'pass';
      }
    };
    const self: MicroInstance = {
      outcome: 'pending',
      update(dt, t) {
        shake = Math.max(0, shake - dt * 8);
        if (self.outcome !== 'pending') return;
        const surge = t > surgeAt && t < surgeAt + 0.5 ? 2.2 : 1;
        p -= bear * surge * dt;
        if (p <= -1) {
          p = -1;
          self.outcome = 'fail';
        }
      },
      render(c, t) {
        const cx = 50 + p * 22;
        // the midline
        line(c, 50, 30, 50, 80, 0.6, GREY);
        highlight(c, 70, 36, 26, 36, YELLOW, 0.35);
        highlight(c, 4, 36, 26, 36, PINK, 0.25);
        // rope
        line(c, 14, 56, 86, 56, 1.8, BROWN);
        // the axe hangs from the middle of the rope
        c.save();
        c.translate(cx, 56);
        c.rotate(Math.sin(t * 7) * 0.15);
        line(c, 0, 0, 0, 14, 1.6, BROWN);
        c.beginPath();
        c.moveTo(-1, 10);
        c.quadraticCurveTo(-9, 12, -8, 20);
        c.lineTo(-1, 16);
        c.closePath();
        c.fillStyle = WHITE;
        c.fill();
        c.lineWidth = 1;
        c.strokeStyle = INK;
        c.stroke();
        c.restore();
        // the bear (left)
        const bx = 14 - Math.max(0, -p) * 2;
        ellipse(c, bx, 60, 10, 14, BROWN);
        circle(c, bx - 6, 40, 3.5, BROWN);
        circle(c, bx + 6, 40, 3.5, BROWN);
        circle(c, bx, 46, 8, BROWN);
        eyes(c, bx, 44, 3, 1.8, 1, 0);
        ellipse(c, bx, 49.5, 3, 2, '#d8b48c', 0.6);
        // you (right)
        const yx = 86 + (shake > 0 ? Math.sin(t * 90) * shake : 0);
        rect(c, yx - 7, 52, 14, 20, CARDINAL, 4);
        circle(c, yx, 45, 7, '#ffd9b8');
        eyes(c, yx, 44, 2.6, 1.6, -1, 0);
        line(c, yx - 7, 56, yx - 12, 56, 1.4);
        text(c, `${taps}`, yx, 82, 5, { color: INK });
        text(c, 'you', 86, 30, 4.5, { color: CARDINAL });
        text(c, 'bear', 14, 30, 4.5, { color: INK });
        if (self.outcome === 'pending') text(c, 'mash!', 50, 92, 5 + shake * 1.5, { color: PINK });
      },
      down: () => tug(),
      press: (key) => {
        if (key === 'action' || key === 'up' || key === 'right') tug();
      },
      timeUp: () => (p > 0 ? 'pass' : 'fail'),
    };
    return self;
  },
};
