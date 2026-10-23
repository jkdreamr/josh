import { CARDINAL, GREEN, PINK, YELLOW, circle, line, rect, text } from '../draw.ts';
import { mulberry32, range } from '../rng.ts';
import { standardDuration, type MicroGame, type MicroInstance } from './types.ts';

export type SignPoint = { x: number; y: number };
export type SignPath = { checkpoints: SignPoint[]; stroke: SignPoint[] };

export function signPath(seed: number, difficulty: number): SignPath {
  const rng = mulberry32(seed);
  const left = 18 - difficulty * 7;
  const span = 64 + difficulty * 14;
  const amp = 7 + difficulty * 8;
  const anchors = Array.from({ length: 5 }, (_, i) => ({
    x: left + (span * i) / 4,
    y: 50 + range(rng, -amp, amp),
  }));
  const dense: SignPoint[] = [];
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i];
    const b = anchors[i + 1];
    const dy = b.y - a.y;
    const bend = range(rng, -amp * 0.8, amp * 0.8);
    const p1 = { x: a.x + span / 18, y: a.y + dy * 0.3 + bend };
    const p2 = { x: b.x - span / 18, y: b.y - dy * 0.3 - bend };
    for (let j = 0; j <= 24; j++) {
      if (i && j === 0) continue;
      const u = j / 24;
      const v = 1 - u;
      dense.push({
        x: v ** 3 * a.x + 3 * v ** 2 * u * p1.x + 3 * v * u ** 2 * p2.x + u ** 3 * b.x,
        y: v ** 3 * a.y + 3 * v ** 2 * u * p1.y + 3 * v * u ** 2 * p2.y + u ** 3 * b.y,
      });
    }
  }
  const checkpoints: SignPoint[] = [];
  let distance = 0;
  let next = 0;
  for (let i = 1; i < dense.length; i++) {
    const a = dense[i - 1];
    const b = dense[i];
    const segment = Math.hypot(b.x - a.x, b.y - a.y);
    while (next <= distance + segment && checkpoints.length < 40) {
      const f = segment ? (next - distance) / segment : 0;
      checkpoints.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
      next += 6;
    }
    distance += segment;
  }
  checkpoints.push(dense[dense.length - 1]);
  return { checkpoints, stroke: dense };
}

export const signHere: MicroGame = {
  id: 'sign-here',
  title: 'sign here',
  command: 'trace!',
  input: 'drag',
  keys: 'cursor',
  hint: { touch: 'trace the dotted line', keys: 'arrows + space' },
  duration: standardDuration(5.5, 4),
  create(seed, difficulty): MicroInstance {
    const path = signPath(seed, difficulty);
    let next = 0;
    let drawing = false;
    const trail: SignPoint[] = [];
    const self: MicroInstance = {
      outcome: 'pending',
      update() {},
      render(c) {
        rect(c, 6, 15, 88, 68, '#fffdf6', 2, 0.9);
        text(c, 'student signature', 16, 25, 5.5, { align: 'left' });
        line(c, 14, 67, 86, 67, 0.8, '#b9d3ee');
        text(c, 'sign here  x____', 16, 74, 5, { align: 'left', color: CARDINAL });
        for (const p of path.checkpoints) circle(c, p.x, p.y, 0.72, '#8c1515', 0.4);
        for (let i = 1; i < trail.length; i++) line(c, trail[i - 1].x, trail[i - 1].y, trail[i].x, trail[i].y, 1.5, CARDINAL);
        const target = path.checkpoints[next];
        if (target) {
          circle(c, target.x, target.y, 3.2 + Math.sin(trail.length) * 0.3, YELLOW, 1.1);
          circle(c, target.x, target.y, 1.1, GREEN, 0.6);
        }
        if (!drawing) text(c, 'start at the x', 50, 91, 4.4, { color: PINK });
      },
      down(x, y) {
        if (self.outcome !== 'pending') return;
        drawing = true;
        record(x, y);
      },
      move(x, y) {
        if (self.outcome !== 'pending' || !drawing) return;
        record(x, y);
      },
      up() {
        drawing = false;
      },
      timeUp: () => (next >= path.checkpoints.length ? 'pass' : 'fail'),
    };
    function record(x: number, y: number) {
      trail.push({ x, y });
      if (trail.length > 180) trail.shift();
      while (next < path.checkpoints.length && Math.hypot(x - path.checkpoints[next].x, y - path.checkpoints[next].y) <= 7) {
        next++;
      }
      if (next >= path.checkpoints.length) self.outcome = 'pass';
    }
    return self;
  },
};
