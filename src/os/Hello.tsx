import { useState, type CSSProperties } from 'react';
import { pacificHour } from './hooks';
import { phaseFor } from './Wallpaper';

/** The backlight comes up, the pen lands and writes the word, and the finished word holds for a beat. */
const PEN_DELAY = 250;
const PEN_MS = 2100;
/** The word is written: the desktop can mount underneath while it holds. */
export const HELLO_WRITTEN = PEN_DELAY + PEN_MS;
/** Time on the hello screen before it fades to the desktop. */
export const HELLO_MS = HELLO_WRITTEN + 550;

type Pt = readonly [number, number];

/**
 * The cursive "hello" as one continuous pen stroke, drawn upright (y up, baseline 0, x-height 100)
 * and slanted afterwards. Each run is one smooth movement; consecutive runs meet where the pen
 * doubles back on itself (the h's stem, the top of the o).
 */
const RUNS: Pt[][] = [
  // lead-in rising into the h loop, over the top and down the stem
  [[-36, 4], [-8, 24], [22, 66], [46, 126], [60, 186], [62, 232], [51, 256], [36, 244], [32, 204], [31, 136], [31, 60], [31, 0]],
  [
    // h: back up the stem, over the arch, down the leg and out
    [31, 0], [33, 46], [44, 84], [64, 100], [82, 92], [90, 66], [90, 30], [93, 8], [106, 1], [124, 10],
    // e: up into the eye, round it and out along the baseline
    [146, 40], [162, 72], [160, 96], [144, 100], [130, 80], [129, 44], [138, 14], [156, 1], [178, 6],
    // l
    [204, 34], [227, 94], [242, 164], [248, 224], [240, 254], [225, 252], [217, 218], [215, 156], [215, 80], [217, 26], [227, 4], [245, 2],
    // l
    [269, 34], [291, 94], [305, 164], [311, 224], [303, 254], [288, 252], [280, 218], [278, 156], [278, 80], [280, 26], [290, 4], [306, 4],
    // o: climb the left side of the bowl to its top
    [320, 18], [329, 50], [334, 80], [343, 96], [355, 101],
  ],
  // o: back down the same side, round the bowl, an eyelet at the top and away
  [[355, 101], [343, 96], [334, 80], [329, 50], [334, 16], [352, 0], [372, 11], [382, 46], [377, 82], [364, 99], [350, 98], [341, 86], [346, 71], [362, 66], [380, 70], [402, 80], [424, 86]],
];
const SLANT = Math.tan((13 * Math.PI) / 180);
const STROKE = 13;

const gap = (a: Pt, b: Pt) => Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]) ** 0.5, 1e-6);

/** Bézier handles for the span p1→p2 of a centripetal Catmull-Rom spline, which keeps tight loops free of kinks and overshoot. */
function handles(p0: Pt, p1: Pt, p2: Pt, p3: Pt): [Pt, Pt] {
  const a = gap(p0, p1);
  const b = gap(p1, p2);
  const c = gap(p2, p3);
  const h1 = (k: 0 | 1) => (a * a * p2[k] - b * b * p0[k] + (2 * a * a + 3 * a * b + b * b) * p1[k]) / (3 * a * (a + b));
  const h2 = (k: 0 | 1) => (c * c * p1[k] - b * b * p3[k] + (2 * c * c + 3 * c * b + b * b) * p2[k]) / (3 * c * (c + b));
  return [
    [h1(0), h1(1)],
    [h2(0), h2(1)],
  ];
}

function bezierAt(a: Pt, b: Pt, c: Pt, d: Pt, t: number): Pt {
  const u = 1 - t;
  const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return [w[0] * a[0] + w[1] * b[0] + w[2] * c[0] + w[3] * d[0], w[0] * a[1] + w[1] * b[1] + w[2] * c[1] + w[3] * d[1]];
}

/** The runs as one SVG path, with its length (for the dash that reveals it) and a viewBox that fits the stroke. */
function penPath(runs: Pt[][]) {
  const slant = ([x, y]: Pt): Pt => [x + y * SLANT, -y];
  const segs: Pt[][] = [];
  for (const run of runs) {
    const first = run[0];
    const last = run[run.length - 1];
    const p: Pt[] = [[2 * first[0] - run[1][0], 2 * first[1] - run[1][1]], ...run, [2 * last[0] - run[run.length - 2][0], 2 * last[1] - run[run.length - 2][1]]];
    for (let i = 1; i < p.length - 2; i++) segs.push([p[i], ...handles(p[i - 1], p[i], p[i + 1], p[i + 2]), p[i + 1]].map(slant));
  }
  const n = (v: number) => +v.toFixed(1);
  let d = `M${n(segs[0][0][0])} ${n(segs[0][0][1])}`;
  let length = 0;
  for (const [a, b, c, e] of segs) {
    d += `C${n(b[0])} ${n(b[1])} ${n(c[0])} ${n(c[1])} ${n(e[0])} ${n(e[1])}`;
    for (let i = 1, prev = a; i <= 24; i++) {
      const q = bezierAt(a, b, c, e, i / 24);
      length += Math.hypot(q[0] - prev[0], q[1] - prev[1]);
      prev = q;
    }
  }
  const xs = segs.flat().map((p) => p[0]);
  const ys = segs.flat().map((p) => p[1]);
  const x0 = Math.floor(Math.min(...xs) - STROKE);
  const y0 = Math.floor(Math.min(...ys) - STROKE);
  return { d, length: Math.ceil(length) + 2, viewBox: `${x0} ${y0} ${Math.ceil(Math.max(...xs) + STROKE - x0)} ${Math.ceil(Math.max(...ys) + STROKE - y0)}` };
}

const PEN = penPath(RUNS);
/**
 * One dash as long as the word, then a gap long enough that nothing repeats. The reveal starts a
 * stroke-width before the path so the round cap can't leave a dot where the pen is about to land.
 */
const DASH = `${PEN.length} ${PEN.length + 2 * STROKE}`;

/** The Mac's first-boot greeting, written in one stroke on a sky graded to the same hour as the wallpaper. */
export default function Hello() {
  const [sky] = useState(() => phaseFor(pacificHour(new Date())));
  const vars = { '--pen-from': PEN.length + STROKE, '--pen-delay': `${PEN_DELAY}ms`, '--pen-ms': `${PEN_MS}ms` } as CSSProperties;
  return (
    <div className={`hello sky-${sky}`} style={vars}>
      <i className="hello-glow hello-glow-a" />
      <i className="hello-glow hello-glow-b" />
      <i className="hello-glow hello-glow-c" />
      <svg className="hello-word" viewBox={PEN.viewBox} role="img" aria-label="hello">
        <path className="hello-pen" d={PEN.d} strokeWidth={STROKE} strokeDasharray={DASH} />
      </svg>
    </div>
  );
}
