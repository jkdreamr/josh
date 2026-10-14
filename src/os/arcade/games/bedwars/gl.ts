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
