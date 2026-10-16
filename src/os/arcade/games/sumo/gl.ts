import type * as T from 'three';

export type * as T from 'three';

type Three = typeof import('three');

export type GL = {
  renderer: T.WebGLRenderer;
  canvas: HTMLCanvasElement;
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

export function disposeTree(root: T.Object3D) {
  root.traverse((o) => {
    const mesh = o as T.Mesh;
    mesh.geometry?.dispose?.();
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) {
      for (const value of Object.values(material)) if (value && typeof value === 'object' && (value as T.Texture).isTexture) (value as T.Texture).dispose();
      material.dispose();
    }
  });
}

export const damp = (a: number, b: number, rate: number, dt: number) => a + (b - a) * (1 - Math.exp(-rate * dt));
