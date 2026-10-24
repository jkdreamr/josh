import { BLUE, GREEN, ORANGE, PINK, YELLOW, circle, line, text } from '../draw.ts';
import { mulberry32, range } from '../rng.ts';
import { standardDuration, type MicroGame, type MicroInstance } from './types.ts';

export type HooverLayout = { phase: number; speed: number; zoneCenter: number; zoneWidth: number; markerAt: (t: number) => number };

export function hooverLayout(seed: number, difficulty: number): HooverLayout {
  const rng = mulberry32(seed);
  const phase = range(rng, 0, Math.PI * 2);
  const speed = 2.5 + difficulty * 3.4;
  const zoneCenter = -Math.PI / 2 + range(rng, -0.4, 0.4);
  const zoneWidth = 0.32 - difficulty * 0.16;
  return {
    phase,
    speed,
    zoneCenter,
    zoneWidth,
    markerAt: (t) => -Math.PI / 2 + Math.sin(t * speed + phase) * 0.76,
  };
}

export const hoover: MicroGame = {
  id: 'hoover',
  title: 'hoover bell',
  command: 'stop!',
  input: 'tap',
  keys: 'direct',
  hint: { touch: 'tap in the green', keys: 'space to stop' },
  duration: standardDuration(5.2, 3.2),
  create(seed, difficulty): MicroInstance {
    const layout = hooverLayout(seed, difficulty);
    let now = 0;
    let stopped = false;
    let won = false;
    const self: MicroInstance = {
      outcome: 'pending',
      update(_dt, t) {
        now = t;
      },
      render(c, t) {
        drawTower(c, 24, 68);
        line(c, 28, 67, 40, 67, 1.3);
        const cx = 68;
        const cy = 60;
        const radius = 26;
        const arcStart = -Math.PI * 0.94;
        const arcEnd = -Math.PI * 0.06;
        c.beginPath();
        c.arc(cx, cy, radius, arcStart, arcEnd);
        c.lineWidth = 4;
        c.strokeStyle = '#c9c4ba';
        c.lineCap = 'round';
        c.stroke();
        c.beginPath();
        c.arc(cx, cy, radius, layout.zoneCenter - layout.zoneWidth / 2, layout.zoneCenter + layout.zoneWidth / 2);
        c.lineWidth = 5;
        c.strokeStyle = GREEN;
        c.stroke();
        const angle = stopped ? layout.markerAt(now) : layout.markerAt(t);
        const mx = cx + Math.cos(angle) * radius;
        const my = cy + Math.sin(angle) * radius;
        line(c, cx, cy, mx, my, 1.3, ORANGE);
        circle(c, mx, my, 2.8, stopped && won ? GREEN : PINK);
        circle(c, cx, cy, 3.4, YELLOW);
        if (!stopped) text(c, 'tap to stop', 68, 94, 4.8, { color: PINK });
        else if (won) {
          circle(c, mx, my, 6 + Math.sin(t * 18) * 1.2, null, 1);
          text(c, 'ding!', 68, 18, 6, { color: GREEN });
        } else text(c, 'too soon!', 68, 18, 5.2, { color: PINK });
      },
      down() {
        stop();
      },
      press(key) {
        if (key === 'action') stop();
      },
      timeUp: () => (self.outcome === 'pass' ? 'pass' : 'fail'),
    };
    function stop() {
      if (self.outcome !== 'pending' || stopped) return;
      stopped = true;
      const angle = layout.markerAt(now);
      won = Math.abs(angle - layout.zoneCenter) <= layout.zoneWidth / 2;
      self.outcome = won ? 'pass' : 'fail';
    }
    return self;
  },
};

function drawTower(c: CanvasRenderingContext2D, x: number, y: number) {
  line(c, x - 9, y, x - 6, y - 32, 1.7);
  line(c, x + 9, y, x + 6, y - 32, 1.7);
  line(c, x - 6, y - 32, x + 6, y - 32, 1.7);
  line(c, x - 8, y - 20, x + 8, y - 20, 1.2);
  line(c, x - 7, y - 9, x + 7, y - 9, 1.2);
  c.beginPath();
  c.arc(x, y - 32, 6, Math.PI, Math.PI * 2);
  c.lineWidth = 1.7;
  c.strokeStyle = '#1d1b22';
  c.stroke();
  circle(c, x, y - 31, 2, BLUE);
  line(c, x - 13, y, x + 13, y, 1.7);
  text(c, 'hoover-ish', x, y + 8, 4.5, { color: PINK });
}
