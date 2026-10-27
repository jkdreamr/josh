import type * as T from 'three';

export function damp(from: number, to: number, rate: number, dt: number) {
  return from + (to - from) * (1 - Math.exp(-rate * dt));
}

export function disposeTree(root: T.Object3D) {
  const geometries = new Set<T.BufferGeometry>();
  const materials = new Set<T.Material>();
  const textures = new Set<T.Texture>();
  root.traverse((object) => {
    const mesh = object as T.Mesh;
    if (mesh.geometry && !geometries.has(mesh.geometry)) {
      geometries.add(mesh.geometry);
      mesh.geometry.dispose();
    }
    const list = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of list) {
      if (materials.has(material)) continue;
      materials.add(material);
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
