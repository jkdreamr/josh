// Small WebGL host shared by this game: renderer creation, context loss handling and full disposal.
// (The kit has no three.js host helper yet, so each 3D game carries this file.)
import type * as T from 'three';

/** three.js types for this game's index.tsx (type only, erased at build time). */
export type * as T from 'three';

type Three = typeof import('three');

export type GL = {
  renderer: T.WebGLRenderer;
  canvas: HTMLCanvasElement;
  /** True between webglcontextlost and webglcontextrestored; skip rendering while lost. */
  lost: () => boolean;
  dispose: () => void;
};

export function createGL(THREE: Three, host: HTMLElement, opts: { alpha?: boolean; maxDpr?: number } = {}): GL | null {
  let renderer: T.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: !!opts.alpha, powerPreference: 'high-performance' });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.maxDpr ?? 2));
  const canvas = renderer.domElement;
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.touchAction = 'none';
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
export function disposeTree(root: T.Object3D) {
  root.traverse((o) => {
    const m = o as T.Mesh;
    m.geometry?.dispose?.();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) {
      for (const v of Object.values(mat)) if (v && typeof v === 'object' && (v as T.Texture).isTexture) (v as T.Texture).dispose();
      mat.dispose();
    }
  });
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Frame-rate independent exponential approach. */
export const damp = (a: number, b: number, k: number, dt: number) => lerp(a, b, 1 - Math.exp(-k * dt));
