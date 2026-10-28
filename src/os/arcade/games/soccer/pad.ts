export type PadPoint = { x: number; y: number };
export type PadButtonZone<Id extends string> = { id: Id; x: number; y: number; r: number };

/** Floating-stick tuning: inner and outer dead zones (fractions of knob travel), response exponent, knob travel as a fraction of the base size. */
export const STICK = { deadZone: 0.14, outerZone: 0.92, curve: 1.45, travel: 0.34 };
/** Face buttons register this far past their drawn radius, so a thumb that lands between buttons still hits the nearest one. */
export const FACE_SLOP = 1.3;
export type FaceLabels = { a: string; b: string; x: string; y: string };

export function faceLabels(attacking: boolean, overrides?: Partial<FaceLabels> | null): FaceLabels {
  const labels = {
    ...(attacking
      ? { a: 'Pass', b: 'Shoot', x: 'Lob · Cross', y: 'Through' }
      : { a: 'Contain', b: 'Tackle', x: 'Slide', y: 'Press' }),
    ...overrides,
  };
  return attacking ? labels : { ...labels, y: 'Press' };
}

/**
 * Turns a thumb offset (px from the stick origin, screen axes) into a knob offset clamped to `radius` and a move
 * vector (screen x/y as x/z, length 0..1) with a radial dead zone, an outer zone that reaches full speed early, and
 * a response curve for finer control at small deflections.
 */
export function stickVector(dx: number, dy: number, radius: number, tuning = STICK) {
  const length = Math.hypot(dx, dy);
  if (!(radius > 0) || !(length > 0)) return { knob: { x: 0, y: 0 }, move: { x: 0, z: 0 }, magnitude: 0 };
  const travel = Math.min(length, radius);
  const ux = dx / length;
  const uy = dy / length;
  const raw = travel / radius;
  const live = Math.max(0, Math.min(1, (raw - tuning.deadZone) / (tuning.outerZone - tuning.deadZone)));
  const magnitude = live ** tuning.curve;
  const clean = (value: number) => (value === 0 ? 0 : value);
  return {
    knob: { x: ux * travel, y: uy * travel },
    move: { x: clean(ux * magnitude), z: clean(uy * magnitude) },
    magnitude,
  };
}

/** Where a floating stick's base centers when the thumb lands at `point`: kept `margin` px inside a zone of `width`×`height`. */
export function clampOrigin(point: PadPoint, width: number, height: number, margin: number): PadPoint {
  const clampAxis = (value: number, size: number) => (size <= margin * 2 ? size / 2 : Math.max(margin, Math.min(size - margin, value)));
  return { x: clampAxis(point.x, width), y: clampAxis(point.y, height) };
}

/** Drags the base along once the thumb runs past `radius`, so the stick never "sticks" at its rim when the thumb drifts. */
export function followOrigin(origin: PadPoint, thumb: PadPoint, radius: number): PadPoint {
  const dx = thumb.x - origin.x;
  const dy = thumb.y - origin.y;
  const length = Math.hypot(dx, dy);
  if (length <= radius || length === 0) return origin;
  return { x: thumb.x - (dx / length) * radius, y: thumb.y - (dy / length) * radius };
}

/** The button under a touch: the nearest one whose centre is within its radius × `slop`, or null. */
export function hitButton<Id extends string>(point: PadPoint, buttons: readonly PadButtonZone<Id>[], slop = FACE_SLOP): Id | null {
  let best: Id | null = null;
  let bestScore = Infinity;
  for (const button of buttons) {
    const score = Math.hypot(point.x - button.x, point.y - button.y) / button.r;
    if (score <= slop && score < bestScore) {
      best = button.id;
      bestScore = score;
    }
  }
  return best;
}

let hapticLabel: HTMLLabelElement | null = null;

/**
 * A short haptic tick. Uses the Vibration API where it exists (Android). iOS Safari has no vibrate, but iOS 18+
 * plays the system haptic when a `<input type="checkbox" switch>` toggles, so tap a detached one there.
 */
export function haptic(ms = 12) {
  if (typeof navigator === 'undefined' || typeof document === 'undefined') return;
  if (typeof navigator.vibrate === 'function') {
    const activation = (navigator as Navigator & { userActivation?: { hasBeenActive?: boolean } }).userActivation;
    if (activation?.hasBeenActive !== false) navigator.vibrate(ms);
    return;
  }
  if (!/iP(hone|ad|od)/.test(navigator.userAgent) && !(navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent))) return;
  try {
    if (!hapticLabel) {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('switch', '');
      input.tabIndex = -1;
      input.setAttribute('aria-hidden', 'true');
      hapticLabel = document.createElement('label');
      hapticLabel.setAttribute('aria-hidden', 'true');
      hapticLabel.style.display = 'none';
      hapticLabel.append(input);
      document.head.append(hapticLabel);
    }
    hapticLabel.click();
  } catch {}
}
