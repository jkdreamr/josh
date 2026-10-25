import { BLUE, CARDINAL, GREEN, INK, WHITE, YELLOW, circle, line, rect, text, highlight } from '../draw.ts';
import { mulberry32, range } from '../rng.ts';
import { standardDuration, type MicroGame, type MicroInstance } from './types.ts';

// The shuttle pulls up and its doors open for a moment. Tap while they're open to hop on. Too early bonks the door.
export type MargueriteSchedule = { arrive: number; open: number; window: number; twitch: number };

export function margueriteSchedule(seed: number, difficulty: number): MargueriteSchedule {
  const rng = mulberry32(seed);
  const arrive = 0.9 - difficulty * 0.3;
  const open = arrive + range(rng, 0.4, 1.6 - difficulty * 0.6);
  const window = 0.75 - difficulty * 0.4;
  const twitch = difficulty > 0.3 ? arrive + (open - arrive) * range(rng, 0.3, 0.6) : -1;
  return { arrive, open, window, twitch };
}

export const marguerite: MicroGame = {
  id: 'marguerite',
  title: 'marguerite',
  command: 'board!',
  input: 'tap',
  keys: 'direct',
  hint: { touch: 'tap when the doors open', keys: 'space when the doors open' },
  duration: standardDuration(5, 3.4),
  create(seed, difficulty): MicroInstance {
    const { arrive, open, window, twitch } = margueriteSchedule(seed, difficulty);
    let now = 0;
    let tapped = -1;
    const doorsOpen = (t: number) => t >= open && t <= open + window;
    const self: MicroInstance = {
      outcome: 'pending',
      update(_dt, t) {
        now = t;
        if (self.outcome === 'pending' && t > open + window) self.outcome = 'fail';
      },
      render(c, t) {
        // curb and stop sign
        line(c, 0, 80, 100, 80, 1.2);
        line(c, 88, 80, 88, 50, 1);
        rect(c, 82, 42, 14, 9, YELLOW, 2);
        text(c, 'stop', 89, 46.8, 3.4);
        const busX = t < arrive ? -70 + (t / arrive) * 78 : 8;
        const bob = t < arrive ? Math.sin(t * 30) * 0.5 : 0;
        c.save();
        c.translate(busX, bob);
        rect(c, 0, 40, 70, 34, WHITE, 5);
        c.fillStyle = CARDINAL;
        c.fillRect(1, 64, 68, 5);
        for (let i = 0; i < 3; i++) rect(c, 4 + i * 13, 46, 10, 10, BLUE, 1.5);
        // doors
        const tw = twitch > 0 && t > twitch && t < twitch + 0.15 ? 1.2 : 0;
        const k = doorsOpen(t) ? Math.min(1, (t - open) * 10) : t > open + window ? Math.max(0, 1 - (t - open - window) * 10) : 0;
        const gap = Math.max(k * 5, tw);
        rect(c, 46, 46, 8 - gap, 26, YELLOW, 1);
        rect(c, 54 + gap, 46, 8 - gap, 26, YELLOW, 1);
        if (k > 0.5) highlight(c, 45, 44, 18, 30, GREEN, 0.35);
        circle(c, 14, 76, 5, INK);
        circle(c, 56, 76, 5, INK);
        text(c, 'marguerite', 22, 61, 3.6, { color: INK });
        c.restore();
        // you, waiting
        const jump = tapped >= 0 && self.outcome === 'pass' ? Math.min(1, (now - tapped) * 4) : 0;
        const yx = 94 - jump * 12;
        circle(c, yx, 70 - jump * 4, 4, '#ffd9b8');
        circle(c, yx - 2, 69.5 - jump * 4, 0.55, INK);
        rect(c, yx - 3.5, 74 - jump * 4, 7, 6, GREEN, 2);
        if (self.outcome === 'fail' && tapped >= 0) text(c, 'bonk', yx, 60, 5, { color: CARDINAL });
      },
      down() {
        self.press?.('action');
      },
      press() {
        if (self.outcome !== 'pending') return;
        tapped = now;
        self.outcome = doorsOpen(now) ? 'pass' : 'fail';
      },
      timeUp: () => 'fail',
    };
    return self;
  },
};
