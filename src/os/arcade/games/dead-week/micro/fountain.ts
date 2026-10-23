import { BLUE, CARDINAL, GREEN, PINK, YELLOW, circle, ellipse, line, rect, text } from '../draw.ts';
import { mulberry32, range } from '../rng.ts';
import { standardDuration, type MicroGame, type MicroInstance } from './types.ts';

const JUMP_TIME = 0.92;
const TELEGRAPH = 0.5;

export type FountainJet = { x: number; at: number; active: number };

export function fountainSchedule(seed: number, difficulty: number): FountainJet[] {
  const rng = mulberry32(seed);
  const count = 2 + Math.round(difficulty * 2);
  const start = 0.58 + range(rng, 0, 0.1);
  const gap = 1.2 + range(rng, 0, 0.05);
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
        const airborne = now >= jumpAt && now <= jumpAt + JUMP_TIME;
        if (jets.some((jet) => now >= jet.at && now <= jet.at + jet.active && Math.abs(jet.x - 50) < 10) && !airborne) {
          self.outcome = 'fail';
        }
      },
      render(c, t) {
        line(c, 4, 77, 96, 77, 1.4, CARDINAL);
        rect(c, 7, 65, 86, 12, '#fffdf6', 2, 0.8);
        ellipse(c, 50, 73, 34, 9, BLUE, 1);
        for (const jet of jets) {
          const warn = t >= jet.at - TELEGRAPH && t < jet.at;
          const active = t >= jet.at && t <= jet.at + jet.active;
          if (warn) {
            const progress = (t - (jet.at - TELEGRAPH)) / TELEGRAPH;
            const wobble = Math.sin(t * 24) * (0.8 + progress * 1.2);
            circle(c, jet.x + wobble, 74 - progress * 5, 2.2 + progress * 0.7, YELLOW, 0.8);
            for (let i = 0; i < 2; i++) {
              const rise = (progress * 2.5 + i * 0.55) % 1;
              circle(c, jet.x + Math.sin(t * 18 + i) * 1.8, 75 - rise * 8, 1.2, '#fff', 0.7);
            }
            line(c, jet.x - 4, 68, jet.x + 4, 68, 1, BLUE);
          }
          if (active) {
            line(c, jet.x, 76, jet.x, 48, 2.3, BLUE);
            circle(c, jet.x, 47, 3, BLUE, 0.8);
            for (let d = 0; d < 3; d++) circle(c, jet.x + (d - 1) * 3, 58 - d * 4, 1.1, '#fff');
          }
        }
        const phase = Math.max(0, Math.min(1, (t - jumpAt) / JUMP_TIME));
        const lift = t <= jumpAt + JUMP_TIME ? Math.sin(Math.PI * phase) * 16 : 0;
        drawStudent(c, 50, 72 - lift);
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
      if (now >= jumpAt && now <= jumpAt + JUMP_TIME) return;
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
