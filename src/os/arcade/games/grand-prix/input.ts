// Turning keys, gamepads and touch buttons into driver inputs. Keyboards are digital, so their steering is eased
// in and out and its lock shrinks with speed (a fast car needs only a few degrees); pedals ramp in the car itself.
// Gamepads are read raw: analog stick and triggers, with a small deadzone.
import { SPEC, type Input } from './car.ts';

export type Binding = { left: string[]; right: string[]; throttle: string[]; brake: string[]; up: string[]; down: string[]; drs: string[]; cam: string[]; back: string[]; reset: string[] };

/** One player alone: arrows or WASD, gears on E and Q (or Shift and Ctrl), DRS on Space. */
export const SOLO: Binding = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  throttle: ['ArrowUp', 'KeyW'],
  brake: ['ArrowDown', 'KeyS'],
  up: ['KeyE', 'ShiftLeft'],
  down: ['KeyQ', 'ControlLeft'],
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
  reset: ['KeyP'],
};

export type Keys = { down: (...names: string[]) => boolean; pressed: (...names: string[]) => boolean };

export type Pad = { steer: number; throttle: number; brake: number; up: boolean; down: boolean; drs: boolean; cam: boolean; back: boolean; reset: boolean };

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
    throttle: Math.max(v(7), b(0) ? 1 : 0),
    brake: Math.max(v(6), b(2) ? 1 : 0),
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

export type Driver = { steer: number; pad: Pad | null };
export const newDriver = (): Driver => ({ steer: 0, pad: null });

export type Extra = { cam: boolean; back: boolean; reset: boolean };

/** This frame's input for one local driver from keys (and a gamepad if one is connected for them). */
export function readInput(st: Driver, keys: Keys, bind: Binding, padIndex: number, speed: number, dt: number): { input: Input; extra: Extra } {
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
  const kThr = keys.down(...bind.throttle) ? 1 : 0;
  const kBrk = keys.down(...bind.brake) ? 1 : 0;
  const input: Input = {
    steer,
    throttle: Math.max(kThr, pad?.pad.throttle ?? 0),
    brake: Math.max(kBrk, pad?.pad.brake ?? 0),
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
