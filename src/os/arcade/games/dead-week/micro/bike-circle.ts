import { BLUE, BROWN, CARDINAL, GREEN, ORANGE, PINK, YELLOW, circle, clamp, ellipse, line, rect, text } from '../draw.ts';
import { mulberry32, range } from '../rng.ts';
import { standardDuration, type MicroGame, type MicroInstance } from './types.ts';

type Rider = { x: number; at: number; speed: number; lean: number; color: string; passed: boolean };
export type BikeRiderSchedule = Pick<Rider, 'x' | 'at' | 'speed' | 'lean'>;

export function bikeCircleSchedule(seed: number, difficulty: number): BikeRiderSchedule[] {
  const rng = mulberry32(seed);
  const count = 4 + Math.floor(difficulty * 4);
  return Array.from({ length: count }, (_, i) => ({
    x: range(rng, 12, 88),
    at: 0.18 + i * (0.42 - difficulty * 0.12),
    speed: 37 + difficulty * 20 + range(rng, 0, 8),
    lean: range(rng, -0.8, 0.8),
  }));
}

export const bikeCircle: MicroGame = {
  id: 'bike-circle',
  title: 'bike circle',
  command: 'swerve!',
  input: 'drag',
  keys: 'cursor',
  hint: { touch: 'dodge the bikes', keys: 'arrows to swerve' },
  duration: standardDuration(5.4, 3.2),
  create(seed, difficulty): MicroInstance {
    const riders: Rider[] = bikeCircleSchedule(seed, difficulty).map((rider, i) => ({
      ...rider,
      color: [BLUE, ORANGE, PINK][i % 3],
      passed: false,
    }));
    let x = 50;
    let target = 50;
    let grabbed = false;
    const self: MicroInstance = {
      outcome: 'pending',
      update(dt, t, held) {
        if (held.left) target -= 42 * dt;
        if (held.right) target += 42 * dt;
        target = clamp(target, 8, 92);
        x += (target - x) * Math.min(1, dt * 15);
        for (const rider of riders) {
          const y = -8 + Math.max(0, t - rider.at) * rider.speed;
          if (!rider.passed && y >= 77 && y <= 88) {
            if (Math.abs(rider.x + rider.lean * (y - 77) - x) < 9) self.outcome = 'fail';
            rider.passed = true;
          }
        }
      },
      render(c, t) {
        ellipse(c, 50, 38, 36, 22, '#e8e4d9', 1.8);
        ellipse(c, 50, 38, 24, 13, GREEN, 1.1);
        circle(c, 50, 30, 1.8, YELLOW);
        text(c, 'roundabout', 50, 41, 4.2, { color: BROWN });
        rect(c, 4, 76, 92, 17, '#fffdf6', 3, 0.8);
        line(c, 6, 75, 94, 75, 1.2, CARDINAL);
        c.save();
        c.globalAlpha = 0.15;
        c.fillStyle = PINK;
        for (const rider of riders) {
          const crossingAt = rider.at + 85 / rider.speed;
          if (!rider.passed && crossingAt >= t && crossingAt <= t + 0.6) {
            c.fillRect(rider.x - 7, 75, 14, 18);
          }
        }
        c.restore();
        for (const rider of riders) {
          const y = -8 + Math.max(0, t - rider.at) * rider.speed;
          if (rider.passed || y < -12 || y > 94) continue;
          const rx = rider.x + rider.lean * Math.max(0, y - 77);
          c.save();
          c.globalAlpha = 0.16;
          ellipse(c, rx, y + 7, 7, 2.2, '#1d1b22', 0.5);
          c.restore();
          line(c, rx - 3, y - 15, rx - 2, y - 11, 1.1, PINK);
          line(c, rx + 3, y - 14, rx + 4, y - 10, 0.9, BLUE);
          drawBike(c, rx, y, rider.color, rider.lean * 0.18);
        }
        drawBike(c, x, 84, CARDINAL, 0);
        if (!grabbed) text(c, '< dodge >', 50, 97, 4.2, { color: PINK });
      },
      down(px) {
        if (self.outcome !== 'pending') return;
        grabbed = true;
        target = clamp(px, 8, 92);
      },
      move(px) {
        if (self.outcome !== 'pending') return;
        grabbed = true;
        target = clamp(px, 8, 92);
      },
      up() {
        grabbed = false;
      },
      timeUp: () => (self.outcome === 'fail' ? 'fail' : 'pass'),
    };
    return self;
  },
};

function drawBike(c: CanvasRenderingContext2D, x: number, y: number, color: string, lean: number) {
  c.save();
  c.translate(x, y);
  c.rotate(lean);
  circle(c, -4.5, 2, 3.3, null, 1);
  circle(c, 4.5, 2, 3.3, null, 1);
  line(c, -4.5, 2, -1, -2, 0.9);
  line(c, -1, -2, 2, 2, 0.9);
  line(c, 2, 2, -4.5, 2, 0.9);
  line(c, 2, 2, 4.5, -2, 0.9);
  line(c, 4.5, -2, 5.8, -2, 0.9);
  line(c, -1, -2, -2.4, -3, 0.9);
  circle(c, 0, -7, 2.2, color);
  line(c, 0, -4.5, 1, -1, 1.2);
  line(c, 1, -1, -2, 1, 1.2);
  c.restore();
}
