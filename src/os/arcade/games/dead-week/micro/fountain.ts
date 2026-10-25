import { BLUE, CARDINAL, GREEN, PINK, YELLOW, circle, ellipse, line, rect, text } from '../draw.ts';
import { mulberry32, range } from '../rng.ts';
import { standardDuration, type MicroGame, type MicroInstance } from './types.ts';

export const FOUNTAIN_JUMP_TIME = 1.1;
export const FOUNTAIN_TELEGRAPH = 0.5;

export type FountainJet = { x: number; at: number; active: number };

export function fountainSchedule(seed: number, difficulty: number): FountainJet[] {
  const rng = mulberry32(seed);
  const count = 2 + Math.round(difficulty * 2);
  const start = 0.58 + range(rng, 0, 0.1);
  const gap = 1.4 + range(rng, 0, 0.05);
  return Array.from({ length: count }, (_, i) => ({
    x: 50 + range(rng, -8, 8),
    at: start + i * gap,
    active: 0.36,
  }));
}

export const fountain: MicroGame = {
  id: 'fountain',
  title: 'fountain hop',
  command: 'hop!',
  input: 'tap',
  keys: 'direct',
  hint: { touch: 'tap as bubbles rise', keys: 'space as bubbles rise' },
  duration: standardDuration(5.8, 4.8),
  create(seed, difficulty): MicroInstance {
    const jets = fountainSchedule(seed, difficulty);
    let jumpAt = -Infinity;
    let now = 0;
    let jumpCount = 0;
    const self: MicroInstance = {
      outcome: 'pending',
      update(_dt, t) {
        now = t;
        const airborne = now >= jumpAt && now <= jumpAt + FOUNTAIN_JUMP_TIME;
        if (jets.some((jet) => now >= jet.at && now <= jet.at + jet.active && Math.abs(jet.x - 50) < 10) && !airborne) {
          self.outcome = 'fail';
        }
      },
      render(c, t) {
        ellipse(c, 50, 54, 36, 14, '#fffdf6', 2.8);
        ellipse(c, 50, 53, 32, 10, BLUE, 1.2);
        c.save();
        c.globalAlpha = 0.75;
        c.beginPath();
        c.ellipse(50, 49, 25, 3.5, 0, Math.PI, Math.PI * 2);
        c.strokeStyle = '#fff';
        c.lineWidth = 1.4;
        c.stroke();
        c.restore();
        rect(c, 4, 68, 92, 18, '#fffdf6', 3, 0.8);
        line(c, 6, 68, 94, 68, 1.3, CARDINAL);
        for (const jet of jets) {
          const warn = t >= jet.at - FOUNTAIN_TELEGRAPH && t < jet.at;
          const active = t >= jet.at && t <= jet.at + jet.active;
          if (warn) {
            const progress = (t - (jet.at - FOUNTAIN_TELEGRAPH)) / FOUNTAIN_TELEGRAPH;
            c.beginPath();
            c.ellipse(jet.x, 68, 3 + progress * 5, 1.1 + progress * 0.7, 0, 0, Math.PI * 2);
            c.strokeStyle = BLUE;
            c.lineWidth = 0.9;
            c.stroke();
            for (let i = 0; i < 3; i++) {
              const rise = (progress * 1.3 + i * 0.29) % 1;
              const radius = 0.9 + rise * 1.2;
              circle(c, jet.x + Math.sin(t * 18 + i) * (1.4 + i), 66 - rise * 10, radius, '#fff', 0.7);
            }
            text(c, '!', jet.x, 43, 5.2, { color: CARDINAL, weight: 900 });
          }
          if (active) {
            const rise = Math.min(1, (t - jet.at) / 0.12);
            const height = 27 * rise;
            const top = 68 - height;
            rect(c, jet.x - 3.5, top, 7, height, BLUE, 3.5, 0.7);
            line(c, jet.x - 1, top + 1, jet.x - 1, 67, 1.2, '#fff');
            circle(c, jet.x - 4.4, top - 1, 1.5, '#fff', 0.6);
            circle(c, jet.x, top - 2, 1.8, BLUE, 0.7);
            circle(c, jet.x + 4.2, top - 1.2, 1.35, '#fff', 0.6);
          }
        }
        const phase = Math.max(0, Math.min(1, (t - jumpAt) / FOUNTAIN_JUMP_TIME));
        const lift = t <= jumpAt + FOUNTAIN_JUMP_TIME ? Math.sin(Math.PI * phase) * 16 : 0;
        drawStudent(c, 50, 68 - lift);
        text(c, 'tap when it bubbles', 50, 12, 5.2, { color: PINK });
        if (jumpCount) text(c, 'boing!', 50, 28, 5, { color: GREEN });
      },
      down() {
        jump();
      },
      press(key) {
        if (key === 'action') jump();
      },
      timeUp: () => (self.outcome === 'fail' ? 'fail' : 'pass'),
    };
    function jump() {
      if (self.outcome !== 'pending' && self.outcome !== 'pass') return;
      if (now >= jumpAt && now <= jumpAt + FOUNTAIN_JUMP_TIME) return;
      jumpAt = now;
      jumpCount++;
    }
    return self;
  },
};

function drawStudent(c: CanvasRenderingContext2D, x: number, y: number) {
  ellipse(c, x, y + 5, 4.5, 6, YELLOW);
  circle(c, x, y - 2.5, 3.5, '#f2c6a2');
  circle(c, x - 1, y - 3, 0.45, '#1d1b22', 0.4);
  circle(c, x + 1, y - 3, 0.45, '#1d1b22', 0.4);
  line(c, x - 3, y + 3, x - 5, y + 7, 1);
  line(c, x + 3, y + 3, x + 5, y + 7, 1);
  line(c, x - 2, y + 10, x - 3, y + 13, 1);
  line(c, x + 2, y + 10, x + 3, y + 13, 1);
}
