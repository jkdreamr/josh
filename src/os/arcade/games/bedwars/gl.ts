// Small WebGL host for Bed Wars: renderer creation, context loss handling, full disposal, and the few three.js
// constants the shared three chunk does not re-export (they are plain numbers in three.js).
import type * as T from 'three';

export type * as T from 'three';
export type Three = typeof import('three');

export const BACK_SIDE = 1 as T.Side;
export const NEAREST = 1003 as T.MagnificationTextureFilter;
export const NEAREST_MIP_LINEAR = 1005 as T.MinificationTextureFilter;
export const NEAREST_MIN = 1003 as T.MinificationTextureFilter;
export const CLAMP = 1001 as T.Wrapping;
export const ADDITIVE = 2 as T.Blending;

export type GL = {
  renderer: T.WebGLRenderer;
  canvas: HTMLCanvasElement;
  lost: () => boolean;
  dispose: () => void;
};

export function createGL(THREE: Three, host: HTMLElement): GL | null {
  let renderer: T.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const canvas = renderer.domElement;
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.touchAction = 'none';
  canvas.className = 'g-bedwars-canvas';
  host.appendChild(canvas);
  let lost = false;
  const onLost = (e: Event) => {
    e.preventDefault();
    lost = true;
  };
  const onRestored = () => {
    lost = false;
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);
  return {
    renderer,
    canvas,
    lost: () => lost,
    dispose() {
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}

/** Disposes every geometry, material and texture under an object. */
export function disposeTree(root: T.Object3D, keep?: Set<unknown>) {
  root.traverse((o) => {
    const m = o as T.Mesh;
    if (m.geometry && !keep?.has(m.geometry)) m.geometry.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) {
      if (keep?.has(mat)) continue;
      for (const v of Object.values(mat)) if (v && typeof v === 'object' && (v as T.Texture).isTexture && !keep?.has(v)) (v as T.Texture).dispose();
      mat.dispose();
    }
  });
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const damp = (a: number, b: number, k: number, dt: number) => lerp(a, b, 1 - Math.exp(-k * dt));
/** Shortest signed difference between two angles. */
export const angleDiff = (a: number, b: number) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

/**
 * Adaptive resolution from the frame interval, judged over windows of a second or two: slow frames lower the pixel
 * ratio, quick ones raise it again. A drop that does not make frames quicker means the browser is capping the frame
 * rate (an energy saver, low power mode, a 30 or 50 Hz screen) rather than running out of room: the ratio goes back
 * up, and that interval stops counting as slow until frames get clearly slower than it (or quicker: the cap lifted).
 */
export class DprGovernor {
  dpr: number;
  readonly max: number;
  readonly min = 0.75;
  /** Smoothed seconds per frame, for display. */
  avg = 1 / 60;
  private sum = 0;
  private n = 0;
  private win = 1;
  private trial: { from: number; mean: number } | null = null;
  private cap = 0;
  constructor(dpr: number, max = 2) {
    this.dpr = dpr;
    this.max = max;
  }
  /** Takes one frame's interval; returns the new ratio when it changes. */
  frame(dt: number): number | null {
    if (!(dt > 0)) return null;
    this.avg += (dt - this.avg) * 0.05;
    this.sum += dt;
    this.n++;
    if (this.sum < this.win) return null;
    const mean = this.sum / this.n;
    this.sum = 0;
    this.n = 0;
    this.win = 1;
    if (this.trial) {
      const t = this.trial;
      this.trial = null;
      if (mean > t.mean * 0.95) {
        this.cap = mean;
        return this.set(t.from, 3);
      }
    }
    if (this.cap && mean < this.cap * 0.8) this.cap = 0;
    const capped = this.cap > 0 && mean < this.cap * 1.15;
    if (mean > 1 / 50 && this.dpr > this.min && !capped) {
      this.trial = { from: this.dpr, mean };
      return this.set(Math.max(this.min, this.dpr - 0.15), 1.5);
    }
    if ((mean < 1 / 58 || capped) && this.dpr < this.max) return this.set(Math.min(this.max, this.dpr + 0.1), 3);
    return null;
  }
  private set(dpr: number, win: number) {
    this.dpr = Math.round(dpr * 100) / 100;
    this.win = win;
    return this.dpr;
  }
}
