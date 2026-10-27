import type * as T from 'three';
import type { MarkerColor, PracticeMarker } from './practice.ts';

type Three = typeof import('three');

const COLORS: Record<MarkerColor, string> = { lit: '#ffd23f', idle: '#ff7a1a', done: '#58d68d', warn: '#ff4d5a' };

export type PracticeMarkers = { set(markers: readonly PracticeMarker[], time: number): void; dispose(): void };

export function createPracticeMarkers(THREE: Three, scene: T.Scene): PracticeMarkers {
  const group = new THREE.Group();
  group.name = 'practice-markers';
  scene.add(group);
  const geometry = {
    cone: new THREE.ConeGeometry(0.34, 0.78, 14),
    post: new THREE.CylinderGeometry(0.07, 0.07, 1.5, 10),
    disc: new THREE.RingGeometry(0.62, 0.95, 28),
    line: new THREE.PlaneGeometry(1, 0.16),
  };
  geometry.disc.rotateX(-Math.PI / 2);
  geometry.line.rotateX(-Math.PI / 2);
  const materials = Object.fromEntries(Object.entries(COLORS).map(([key, color]) => [key, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.92, depthWrite: false })])) as Record<MarkerColor, T.MeshBasicMaterial>;
  let signature = '';
  let pulsing: T.Object3D[] = [];
  return {
    set(markers, time) {
      const next = markers.map((m) => `${m.kind}${m.color}${m.x.toFixed(2)},${m.z.toFixed(2)},${m.x2 ?? ''},${m.z2 ?? ''}`).join('|');
      if (next !== signature) {
        signature = next;
        group.clear();
        pulsing = [];
        for (const marker of markers) {
          const mesh = new THREE.Mesh(geometry[marker.kind], materials[marker.color]);
          mesh.renderOrder = 2;
          if (marker.kind === 'line') {
            const dx = (marker.x2 ?? marker.x) - marker.x, dz = (marker.z2 ?? marker.z) - marker.z;
            mesh.position.set(marker.x + dx / 2, 0.035, marker.z + dz / 2);
            mesh.scale.x = Math.max(0.1, Math.hypot(dx, dz));
            mesh.rotation.y = -Math.atan2(dz, dx);
          } else {
            const y = marker.kind === 'cone' ? 0.39 : marker.kind === 'post' ? 0.75 : 0.04;
            mesh.position.set(marker.x, y, marker.z);
            if (marker.color === 'lit') pulsing.push(mesh);
          }
          group.add(mesh);
        }
      }
      const pulse = 1 + Math.sin(time * 6) * 0.12;
      for (const mesh of pulsing) mesh.scale.setScalar(pulse);
    },
    dispose() {
      scene.remove(group);
      group.clear();
      Object.values(geometry).forEach((item) => item.dispose());
      Object.values(materials).forEach((item) => item.dispose());
    },
  };
}
