import { BLUE, GREEN, ORANGE, PINK, YELLOW, circle, ellipse, line, text } from '../draw.ts';
import { mulberry32, pick, range, shuffled } from '../rng.ts';
import { type MicroGame, type MicroInstance } from './types.ts';

export type StudentFigure = { x: number; y: number; color: string; phase: number; isTree: boolean; greenish: boolean };
const colors = [YELLOW, BLUE, ORANGE, PINK, '#f6a8a8', '#c6a7ff'];

export function treeLayout(seed: number, difficulty: number): StudentFigure[] {
  const rng = mulberry32(seed);
  const count = 10 + Math.floor(difficulty * 12);
  const cells = Array.from({ length: 24 }, (_, i) => ({
    x: 10 + (i % 6) * 16 + range(rng, -0.2, 0.2),
    y: 25 + Math.floor(i / 6) * 18 + range(rng, -0.2, 0.2),
  }));
  const selected = shuffled(rng, cells).slice(0, count);
  const treeIndex = Math.floor(rng() * selected.length);
  return selected.map((p, i) => ({
    ...p,
    color: pick(rng, colors),
    phase: range(rng, 0, Math.PI * 2),
    isTree: i === treeIndex,
    greenish: i !== treeIndex && difficulty > 0.62 && rng() < 0.28,
  }));
}

export const tree: MicroGame = {
  id: 'tree',
  title: 'spot the tree',
  command: 'find!',
  input: 'tap',
  keys: 'cursor',
  hint: { touch: 'tap the tree', keys: 'arrows + space' },
  duration: (tier) => Math.max(2.5, 5.2 - tier * 0.4),
  create(seed, difficulty): MicroInstance {
    const figures = treeLayout(seed, difficulty);
    const self: MicroInstance = {
      outcome: 'pending',
      update() {},
      render(c, t) {
        text(c, 'one tree, lots of students', 50, 10, 5.4);
        figures.forEach((person) => {
          const sway = difficulty > 0.35 ? Math.sin(t * (1 + difficulty) + person.phase) * difficulty * 0.75 : 0;
          if (person.isTree) drawTree(c, person.x + sway, person.y);
          else drawStudent(c, person.x + sway, person.y, person.greenish ? GREEN : person.color);
        });
      },
      down(x, y) {
        if (self.outcome !== 'pending') return;
        const figure = figures.find((f) => Math.hypot(x - f.x, y - f.y) <= 7.2);
        if (figure) self.outcome = figure.isTree ? 'pass' : 'fail';
      },
      timeUp: () => (self.outcome === 'pass' ? 'pass' : 'fail'),
    };
    return self;
  },
};

function drawStudent(c: CanvasRenderingContext2D, x: number, y: number, color: string) {
  ellipse(c, x, y + 3, 3.5, 4.5, color);
  circle(c, x, y - 3, 3.3, '#f4c9a5');
  circle(c, x - 1.1, y - 3.5, 0.45, '#1d1b22', 0.4);
  circle(c, x + 1.1, y - 3.5, 0.45, '#1d1b22', 0.4);
  line(c, x - 2.2, y + 2, x - 3.4, y + 6, 1);
  line(c, x + 2.2, y + 2, x + 3.4, y + 6, 1);
  line(c, x - 1.7, y + 7, x - 2.5, y + 9, 1);
  line(c, x + 1.7, y + 7, x + 2.5, y + 9, 1);
}

function drawTree(c: CanvasRenderingContext2D, x: number, y: number) {
  c.beginPath();
  c.moveTo(x, y - 9);
  c.lineTo(x - 3, y - 4.5);
  c.lineTo(x - 1.5, y - 4.5);
  c.lineTo(x - 5, y + 0.5);
  c.lineTo(x - 2.3, y + 0.5);
  c.lineTo(x - 6, y + 5);
  c.lineTo(x + 6, y + 5);
  c.lineTo(x + 2.3, y + 0.5);
  c.lineTo(x + 5, y + 0.5);
  c.lineTo(x + 1.5, y - 4.5);
  c.lineTo(x + 3, y - 4.5);
  c.closePath();
  c.fillStyle = GREEN;
  c.fill();
  c.lineWidth = 1.2;
  c.strokeStyle = '#1d1b22';
  c.lineJoin = 'round';
  c.stroke();
  line(c, x - 1.8, y + 5, x - 1.8, y + 8, 1.1);
  line(c, x + 1.8, y + 5, x + 1.8, y + 8, 1.1);
  circle(c, x - 1.7, y - 2.5, 1.1, '#fff');
  circle(c, x + 1.7, y - 2.5, 1.1, '#fff');
  circle(c, x - 1.5, y - 2.4, 0.42, '#1d1b22', 0.4);
  circle(c, x + 1.5, y - 2.4, 0.42, '#1d1b22', 0.4);
  circle(c, x, y + 0.4, 1.1, ORANGE, 0.6);
  line(c, x - 1.3, y + 2.3, x + 1.3, y + 2.3, 0.8, PINK);
  ellipse(c, x, y - 7.3, 1.2, 2, YELLOW, 0.6);
}
