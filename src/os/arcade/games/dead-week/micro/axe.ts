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
        const axeX = cx + (shake > 0 ? Math.sin(t * 90) * shake * 1.2 : 0);
        const handleLeft = axeX - 26;
        const handleRight = axeX + 26;
        // the midline
        line(c, 50, 30, 50, 80, 0.6, GREY);
        highlight(c, 70, 36, 26, 36, YELLOW, 0.35);
        highlight(c, 4, 36, 26, 36, PINK, 0.25);
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
        line(c, bx + 6, 58, handleLeft, 56, 2.2, BROWN);
        line(c, yx - 7, 58, handleRight, 56, 2.2, CARDINAL);
        c.save();
        c.translate(axeX, 56);
        c.rotate(shake > 0 ? Math.sin(t * 110) * shake * 0.035 : 0);
        rect(c, -27, -2.8, 54, 5.6, BROWN, 2.5, 1.3);
        line(c, -25, -1.3, 25, -1.3, 0.8, '#d8b48c');
        c.beginPath();
        c.moveTo(-4, 0);
        c.lineTo(-5, -9);
        c.lineTo(-13, -13);
        c.quadraticCurveTo(-21, -18, -14, -25);
        c.quadraticCurveTo(-7, -30, 1, -27);
        c.lineTo(12, -23);
        c.lineTo(16, -16);
        c.lineTo(8, -10);
        c.lineTo(4, 0);
        c.closePath();
        c.fillStyle = GREY;
        c.fill();
        c.lineWidth = 1.8;
        c.strokeStyle = INK;
        c.stroke();
        line(c, -14, -25, -21, -18, 2.2, CARDINAL);
        line(c, -5, -18, 7, -21, 0.9, WHITE);
        c.restore();
        circle(c, handleLeft, 56, 2.8, BROWN, 0.8);
        circle(c, handleRight, 56, 2.8, '#ffd9b8', 0.8);
        text(c, `mash ${taps}`, 86, 82, 4.6, { color: INK });
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
