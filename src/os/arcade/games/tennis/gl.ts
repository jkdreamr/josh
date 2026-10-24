import type * as T from 'three';

export type * as T from 'three';

type Three = typeof import('three');

export type GL = {
  renderer: T.WebGLRenderer;
  canvas: HTMLCanvasElement;
  lost: () => boolean;
  dispose: () => void;
};

export function createGL(THREE: Three, host: HTMLElement, lite: boolean): GL | null {
  let renderer: T.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: !lite, powerPreference: 'high-performance' });
  } catch (error) {
    if (import.meta.env.DEV) console.warn('Tennis WebGL context creation failed', error);
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lite ? 1.25 : 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const canvas = renderer.domElement;
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.touchAction = 'none';
  host.appendChild(canvas);

  let lost = false;
  const onLost = (event: Event) => {
    event.preventDefault();
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
  const geometries = new Set<T.BufferGeometry>();
  const materialsSeen = new Set<T.Material>();
  const textures = new Set<T.Texture>();
  root.traverse((object) => {
    const mesh = object as T.Mesh;
    if (mesh.geometry && !geometries.has(mesh.geometry)) {
      geometries.add(mesh.geometry);
      mesh.geometry.dispose();
    }
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) {
      if (materialsSeen.has(material)) continue;
      materialsSeen.add(material);
      for (const value of Object.values(material)) {
        if (value && typeof value === 'object' && (value as T.Texture).isTexture && !textures.has(value as T.Texture)) {
          textures.add(value as T.Texture);
          (value as T.Texture).dispose();
        }
      }
      material.dispose();
    }
  });
}

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
export const damp = (a: number, b: number, rate: number, dt: number) => a + (b - a) * (1 - Math.exp(-rate * dt));
