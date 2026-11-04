// Math that comes out the same, to the last bit, in every browser and in the Worker.
//
// A ranked run is replayed by the Worker (V8), and its score must come out exactly as it did on the player's screen
// (V8 in Chrome, JavaScriptCore on every iPhone, SpiderMonkey in Firefox). +, -, *, / and Math.sqrt are exact IEEE 754
// everywhere, but Math.sin, cos, atan2, hypot, exp and pow are only "implementation-approximated": engines can differ
// in the last bit, and in a simulation that steps thousands of times a last bit can grow into a different outcome.
// These are fdlibm's algorithms (the ones V8 itself ports), written with arithmetic alone, so every engine computes the
// same bits. Use them in any logic a verifier replays; drawing can keep Math. (A constant worked out with Math.exp or
// Math.pow at load time should be a literal instead, for the same reason.)

const PIO2_HI = 1.57079632673412561417e0;
const PIO2_LO = 6.07710050650619224932e-11;
const TWO_OVER_PI = 6.36619772367581382433e-1;

const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;
const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.08757232129817482790e-9;
const C6 = -1.13596475577881948265e-11;

/** sin on [-π/4, π/4]. */
function kSin(x: number) {
  const z = x * x;
  const v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  return x + v * (S1 + z * r);
}

/** cos on [-π/4, π/4]. */
function kCos(x: number) {
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  const hz = 0.5 * z;
  const w = 1 - hz;
  return w + (1 - w - hz + z * r);
}

/** x reduced by a whole number of quarter turns (accurate for |x| up to about a million), and which quarter. */
function reduce(x: number): [number, number] {
  const n = Math.round(x * TWO_OVER_PI);
  return [x - n * PIO2_HI - n * PIO2_LO, ((n % 4) + 4) % 4];
}

export function sin(x: number): number {
  if (!Number.isFinite(x)) return Number.NaN;
  if (x > -0.7853981633974483 && x < 0.7853981633974483) return kSin(x);
  const [y, q] = reduce(x);
  return q === 0 ? kSin(y) : q === 1 ? kCos(y) : q === 2 ? -kSin(y) : -kCos(y);
}

export function cos(x: number): number {
  if (!Number.isFinite(x)) return Number.NaN;
  if (x > -0.7853981633974483 && x < 0.7853981633974483) return kCos(x);
  const [y, q] = reduce(x);
  return q === 0 ? kCos(y) : q === 1 ? -kSin(y) : q === 2 ? -kCos(y) : kSin(y);
}

const ATAN_HI = [4.63647609000806093515e-1, 7.85398163397448278999e-1, 9.82793723247329054082e-1, 1.57079632679489655800e0];
const ATAN_LO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT = [
  3.33333333333329318027e-1, -1.99999999998764832476e-1, 1.42857142725034663711e-1, -1.11111104054623557880e-1,
  9.09088713343650656196e-2, -7.69187620504482999495e-2, 6.66107313738753120669e-2, -5.83357013379057348645e-2,
  4.97687799461593236017e-2, -3.65315727442169155270e-2, 1.62858201153657823623e-2,
];

export function atan(x: number): number {
  if (Number.isNaN(x)) return Number.NaN;
  const neg = x < 0;
  let a = neg ? -x : x;
  if (a >= 6.8e15) return neg ? -ATAN_HI[3] - ATAN_LO[3] : ATAN_HI[3] + ATAN_LO[3];
  let id = -1;
  if (a >= 0.4375) {
    if (a < 1.1875) {
      if (a < 0.6875) {
        id = 0;
        a = (2 * a - 1) / (2 + a);
      } else {
        id = 1;
        a = (a - 1) / (a + 1);
      }
    } else if (a < 2.4375) {
      id = 2;
      a = (a - 1.5) / (1 + 1.5 * a);
    } else {
      id = 3;
      a = -1 / a;
    }
  }
  const z = a * a;
  const w = z * z;
  const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
  const r = id < 0 ? a - a * (s1 + s2) : ATAN_HI[id] - (a * (s1 + s2) - ATAN_LO[id] - a);
  return neg ? -r : r;
}

const PI = 3.1415926535897931160e0;
const PI_LO = 1.2246467991473531772e-16;

export function atan2(y: number, x: number): number {
  if (Number.isNaN(x) || Number.isNaN(y)) return Number.NaN;
  if (x === 1) return atan(y);
  if (y === 0) {
    if (x > 0 || Object.is(x, 0)) return y;
    return Object.is(y, -0) ? -PI : PI;
  }
  if (x === 0) return y > 0 ? PI / 2 : -PI / 2;
  const z = atan(Math.abs(y / x));
  if (x > 0) return y > 0 ? z : -z;
  return y > 0 ? PI - (z - PI_LO) : (z - PI_LO) - PI;
}

/** sqrt(x² + y²), with sqrt (which every engine rounds exactly) rather than Math.hypot (which they need not). */
export const hypot = (x: number, y: number) => Math.sqrt(x * x + y * y);

/** 2 to the power k/12 for k = 0..11: the twelve equal-tempered semitones in an octave. */
const SEMITONES = [1, 1.0594630943592953, 1.122462048309373, 1.189207115002721, 1.2599210498948732, 1.3348398541700344, 1.4142135623730951, 1.4983070768766815, 1.5874010519681994, 1.681792830507429, 1.7817974362806785, 1.8877486253633868];

/** The frequency ratio of a whole number of semitones, 2^(semis/12). */
export function semitone(semis: number): number {
  if (!Number.isInteger(semis)) return Number.NaN;
  const octave = Math.floor(semis / 12);
  return powi(2, octave) * SEMITONES[semis - octave * 12];
}

/** x to a whole power n, by repeated squaring (Math.pow need not be exact). */
export function powi(x: number, n: number): number {
  if (!Number.isInteger(n)) return Number.NaN;
  let result = 1;
  let base = x;
  let k = Math.abs(n);
  while (k > 0) {
    if (k & 1) result *= base;
    base *= base;
    k = Math.floor(k / 2);
  }
  return n < 0 ? 1 / result : result;
}
