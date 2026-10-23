import { BLUE, CARDINAL, GREEN, GREY, INK, PINK, WHITE, YELLOW, clamp, highlight, line, rect, text } from '../draw.ts';
import { mulberry32, range } from '../rng.ts';
import { standardDuration, type MicroGame, type MicroInstance } from './types.ts';

// Swipe the student card through the reader, not too fast and not too slow. A bad swipe can be tried again.
// The reader times the card from x 30 to x 70. On keys, space swipes at the speed the meter shows.
const FROM = 30;
const TO = 70;

export const cardSwipe: MicroGame = {
  id: 'card-swipe',
  title: 'card swipe',
  command: 'swipe!',
  input: 'swipe',
  keys: 'direct',
  hint: { touch: 'drag the card through, steady', keys: 'space when the needle is green' },
  duration: standardDuration(5, 3.5),
  create(seed, difficulty): MicroInstance {
    const rng = mulberry32(seed);
    // seconds the card should take to cross the reader
    const mid = range(rng, 0.32, 0.5);
    const spread = 0.2 - difficulty * 0.1;
    const lo = mid - spread / 2;
    const hi = mid + spread / 2;
    const meterSpeed = 2.2 + difficulty * 2.5;
    const phase = range(rng, 0, Math.PI * 2);
    let x = 14;
    let grab = -1;
    let crossAt = -1;
    let now = 0;
    let msg = '';
    let msgAt = -9;
    let auto = 0;
    let pass = false;
    const meter = (t: number) => 0.5 + 0.5 * Math.sin(t * meterSpeed + phase);
    // meter 0..1 maps to a crossing time from 0.1 s to 0.9 s
    const meterTime = (m: number) => 0.1 + m * 0.8;
    const judge = (dur: number) => {
      if (dur < lo) {
        msg = 'too fast';
        msgAt = now;
      } else if (dur > hi) {
        msg = 'too slow';
        msgAt = now;
      } else {
        msg = 'approved';
        msgAt = now;
        pass = true;
        self.outcome = 'pass';
      }
    };
    const reset = () => {
      x = 14;
      crossAt = -1;
      grab = -1;
      auto = 0;
    };
    const advance = (nx: number) => {
      const before = x;
      x = clamp(nx, 8, 92);
      if (before < FROM && x >= FROM) crossAt = now;
      if (crossAt >= 0 && before < TO && x >= TO) {
        judge(now - crossAt);
        if (!pass) reset();
      }
      if (x < FROM) crossAt = -1;
    };
    const self: MicroInstance = {
      outcome: 'pending',
      update(dt, t) {
        now = t;
        if (auto > 0 && self.outcome === 'pending') advance(x + auto * dt);
      },
      render(c, t) {
        // the reader
        rect(c, 24, 44, 52, 22, GREY, 3);
        rect(c, 26, 52, 48, 4, INK, 1);
        rect(c, 66, 36, 10, 6, pass ? GREEN : msg && t - msgAt < 0.8 ? PINK : YELLOW, 2);
        // the card rides the slot
        c.save();
        c.translate(x, 50);
        rect(c, -11, -14, 22, 14, WHITE, 2);
        c.fillStyle = CARDINAL;
        c.fillRect(-10.4, -13.4, 20.8, 4);
        rect(c, -8, -7, 6, 5, BLUE, 1, 0.6);
        line(c, 0, -6, 8, -6, 0.6);
        line(c, 0, -3.5, 6, -3.5, 0.6);
        c.restore();
        if (msg && t - msgAt < 1) text(c, msg, 50, 30, 7, { color: pass ? INK : CARDINAL });
        else if (!pass) text(c, '>>>', 50, 30, 6, { color: PINK });
        // the speed meter: green band is the right speed
        const mx = 18;
        const my = 80;
        const mw = 64;
        rect(c, mx, my, mw, 6, WHITE, 3);
        const toM = (s: number) => clamp((s - 0.1) / 0.8, 0, 1);
        highlight(c, mx + toM(lo) * mw, my - 1, (toM(hi) - toM(lo)) * mw, 8, GREEN, 0.75);
        const m = meter(t);
        line(c, mx + m * mw, my - 3, mx + m * mw, my + 9, 1.2, CARDINAL);
        text(c, 'fast', mx - 1, my + 12, 3.4, { align: 'left', color: INK });
        text(c, 'slow', mx + mw + 1, my + 12, 3.4, { align: 'right', color: INK });
      },
      down(px, py) {
        if (self.outcome !== 'pending' || auto > 0) return;
        if (Math.abs(px - x) < 18 && Math.abs(py - 44) < 22) grab = px - x;
      },
      move(px) {
        if (grab === -1 || self.outcome !== 'pending') return;
        advance(px - grab);
      },
      up() {
        if (grab !== -1 && self.outcome === 'pending') reset();
      },
      press(key) {
        if (key !== 'action' || self.outcome !== 'pending' || auto > 0) return;
        x = FROM - 1;
        crossAt = -1;
        auto = (TO - FROM) / meterTime(meter(now));
      },
      timeUp: () => (pass ? 'pass' : 'fail'),
    };
    return self;
  },
};
