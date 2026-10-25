// Turning keys, gamepads and touch buttons into driver inputs. Keyboards are digital, so their steering is eased
// in and out and its lock shrinks with speed (a fast car needs only a few degrees); pedals ramp in the car itself.
// Gamepads are read raw: analog stick and triggers, with a small deadzone.
import { SPEC, type Input } from './car.ts';

export type Binding = { left: string[]; right: string[]; throttle: string[]; brake: string[]; up: string[]; down: string[]; drs: string[]; cam: string[]; back: string[]; reset: string[] };

/** One player alone: arrows or WASD, gears on E and Q (or left Shift for up), DRS on Space. */
export const SOLO: Binding = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  throttle: ['ArrowUp', 'KeyW'],
  brake: ['ArrowDown', 'KeyS'],
  up: ['KeyE', 'ShiftLeft'],
  down: ['KeyQ'],
  drs: ['Space'],
  cam: ['KeyC'],
  back: ['KeyV'],
  reset: ['KeyR'],
};
/** Split screen, player 1 on the left of the keyboard. */
export const P1: Binding = { left: ['KeyA'], right: ['KeyD'], throttle: ['KeyW'], brake: ['KeyS'], up: ['KeyE'], down: ['KeyQ'], drs: ['Space'], cam: ['KeyC'], back: ['KeyV'], reset: ['KeyR'] };
/** Split screen, player 2 on the arrows with the keys around them. */
export const P2: Binding = {
  left: ['ArrowLeft'],
  right: ['ArrowRight'],
  throttle: ['ArrowUp'],
  brake: ['ArrowDown'],
  up: ['Period'],
  down: ['Comma'],
  drs: ['ShiftRight', 'Slash'],
  cam: ['KeyL'],
  back: ['KeyK'],
  reset: ['KeyO'],
};

export type Keys = { down: (...names: string[]) => boolean; pressed: (...names: string[]) => boolean };

/** throttle and brake are the analog triggers; the A and X buttons are digital pedals, handled like keys. */
export type Pad = { steer: number; throttle: number; brake: number; thrButton: boolean; brkButton: boolean; up: boolean; down: boolean; drs: boolean; cam: boolean; back: boolean; reset: boolean };

/** Reads one connected gamepad (standard mapping), or null. Edge-triggered buttons need the previous state. */
export function readPad(index: number, prev: Pad | null): { pad: Pad; raw: Pad } | null {
  if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
  let gp: Gamepad | null = null;
  try {
    const pads = navigator.getGamepads();
    let n = 0;
    for (const p of pads) {
      if (!p || !p.connected) continue;
      if (n === index) {
        gp = p;
        break;
      }
      n++;
    }
  } catch {
    return null;
  }
  if (!gp) return null;
  const b = (i: number) => gp!.buttons[i]?.pressed ?? false;
  const v = (i: number) => gp!.buttons[i]?.value ?? 0;
  const x = gp.axes[0] ?? 0;
  const dead = 0.06;
  const steer = Math.abs(x) < dead ? 0 : Math.sign(x) * ((Math.abs(x) - dead) / (1 - dead));
  const raw: Pad = {
    steer,
    throttle: v(7),
    brake: v(6),
    thrButton: b(0),
    brkButton: b(2),
    up: b(5),
    down: b(4),
    drs: b(1) || b(10),
    cam: b(3),
    back: b(11),
    reset: b(8),
  };
  const edge = (k: 'up' | 'down' | 'cam' | 'reset' | 'drs') => raw[k] && !(prev?.[k] ?? false);
  return { raw, pad: { ...raw, up: edge('up'), down: edge('down'), cam: edge('cam'), reset: edge('reset'), drs: raw.drs } };
}

/**
 * Largest steering input (share of full lock) a keyboard gets at a given speed: the angle that asks the tyres for
 * about their full cornering grip (wheelbase times lateral grip over speed squared, plus a little slip angle), so a
 * held key turns as hard as the car can and no harder.
 */
export function keyLock(v: number) {
  const grip = 1.6 * (9.81 + 0.0028 * v * v);
  const angle = (SPEC.wheelbase * grip) / Math.max(1, v * v) + 0.035;
  return Math.min(1, angle / SPEC.maxSteer);
}

export type Driver = { steer: number; pad: Pad | null; thr: number; brk: number };
export const newDriver = (): Driver => ({ steer: 0, pad: null, thr: 0, brk: 0 });

/**
 * The most brake pedal the tyres take at a speed before the fronts lock, measured from the car's physics: downforce
 * presses the tyres down harder the faster the car goes (from 38% pedal at 60 km/h to all of it at 340).
 */
export const lockPedal = (v: number) => {
  const k = v * 3.6;
  return Math.min(1, 0.36 + 0.0006 * k + 0.0000039 * k * k);
};

/**
 * The most throttle the rear tyres take in a straight line at a speed (in the gear the auto box would pick), measured
 * from the car's physics. Above about 130 km/h there is grip for all of it.
 */
const TRACTION: [number, number][] = [
  [0, 0.8],
  [30, 0.8],
  [50, 0.72],
  [70, 0.8],
  [90, 0.88],
  [110, 0.9],
  [130, 1],
];
export const tractionPedal = (v: number) => {
  const k = v * 3.6;
  for (let i = 1; i < TRACTION.length; i++) {
    const [k1, p1] = TRACTION[i];
    if (k <= k1) {
      const [k0, p0] = TRACTION[i - 1];
      return p0 + ((p1 - p0) * (k - k0)) / (k1 - k0);
    }
  }
  return 1;
};

/** Which aids are on, and the gear, for shaping digital pedals. */
export type Aids = { tc: boolean; abs: boolean; gear: number };

export type Extra = { cam: boolean; back: boolean; reset: boolean };

/** This frame's input for one local driver from keys (and a gamepad if one is connected for them). */
/**
 * This frame's input for one local driver from keys (and a gamepad if one is connected for them).
 *
 * Keys are all or nothing, but a real driver squeezes the pedals. So without traction control a held throttle key
 * presses as far as the rear tyres can take in a straight line at that speed, and without ABS a held brake key
 * presses as hard as the fronts can take, easing off as the car slows, the way a driver trails the pedal. These are
 * fixed foot positions, not aids that watch the tyres: full throttle while still turning hard will still spin the car,
 * and braking while turning can still lock a wheel. Analog triggers are never shaped.
 */
export function readInput(st: Driver, keys: Keys, bind: Binding, padIndex: number, speed: number, dt: number, aids: Aids = { tc: true, abs: true, gear: 4 }): { input: Input; extra: Extra } {
  const pad = padIndex >= 0 ? readPad(padIndex, st.pad) : null;
  if (pad) st.pad = pad.raw;
  const axis = (keys.down(...bind.right) ? 1 : 0) - (keys.down(...bind.left) ? 1 : 0);
  let steer: number;
  if (pad && Math.abs(pad.pad.steer) > 0.02 && axis === 0) {
    // stick: a gentle curve for precision around center, a little less lock at speed
    const s = pad.pad.steer;
    const curved = Math.sign(s) * Math.abs(s) ** 1.6;
    steer = curved * (keyLock(speed) + (1 - keyLock(speed)) * 0.3);
    st.steer = steer;
  } else {
    const target = axis * keyLock(speed);
    // in quickly toward the target, back to center even quicker
    const reversing = st.steer !== 0 && Math.sign(target) !== Math.sign(st.steer);
    const rate = (axis === 0 || reversing ? 6 : 3.2) * dt;
    st.steer += Math.max(-rate, Math.min(rate, target - st.steer));
    steer = st.steer;
  }
  const kThr = keys.down(...bind.throttle) || !!pad?.raw.thrButton;
  const kBrk = keys.down(...bind.brake) || !!pad?.raw.brkButton;
  if (!kThr) st.thr = 0;
  else if (aids.tc) st.thr = 1;
  else {
    // the foot squeezes down to what the rears can take at this speed, and less while the wheel is turned (cornering
    // uses up part of the rears' grip), following it up as the car gathers pace and straightens
    const turning = Math.min(1, Math.abs(st.steer) / keyLock(speed));
    const thrMax = tractionPedal(speed) * 0.97 * (1 - 0.6 * turning);
    st.thr = Math.min(thrMax, st.thr + 3 * dt);
  }
  const brkMax = aids.abs ? 1 : Math.min(1, lockPedal(speed) * 0.97);
  // the foot goes down fast, and the pedal follows the speed down from there
  st.brk = kBrk ? Math.min(brkMax, st.brk + 9 * dt) : 0;
  if (kBrk && st.brk > brkMax) st.brk = brkMax;
  const input: Input = {
    steer,
    throttle: Math.max(st.thr, pad?.pad.throttle ?? 0),
    brake: Math.max(st.brk, pad?.pad.brake ?? 0),
    shiftUp: keys.pressed(...bind.up) || !!pad?.pad.up,
    shiftDown: keys.pressed(...bind.down) || !!pad?.pad.down,
    drs: keys.down(...bind.drs) || !!pad?.pad.drs,
  };
  const extra: Extra = {
    cam: keys.pressed(...bind.cam) || !!pad?.pad.cam,
    back: keys.down(...bind.back) || !!pad?.raw.back,
    reset: keys.pressed(...bind.reset) || !!pad?.pad.reset,
  };
  return { input, extra };
}
