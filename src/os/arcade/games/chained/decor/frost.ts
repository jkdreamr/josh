// The Frozen Lake: ice crystals on the core and icicles under the ice ledges.
import type { Dresser } from '../decor';

export const dressFrost: Dresser = (d) => {
  const { THREE, geo, mats, group, rng, onCore } = d;
  for (const p of d.platforms) {
    const r = rng();
    if (r < 0.4) {
      // a crystal on the core
      const crystal = new THREE.Mesh(geo.cone, mats.ice);
      const ca = p.a + (rng() - 0.5) * p.span * 1.5;
      crystal.position.copy(onCore(ca, p.y + 1 + rng() * 2, 0.25));
      crystal.rotation.z = Math.PI / 2 + (rng() - 0.5) * 0.8;
      crystal.rotation.y = -ca;
      crystal.scale.set(0.18, 0.7 + rng() * 0.6, 0.18);
      group.add(crystal);
    }
  }
  // icicles under the ice ledges, as one instanced mesh
  const icicles: { x: number; y: number; z: number; s: number }[] = [];
  for (const p of d.platforms) {
    if (p.kind !== 'ice') continue;
    const y0 = p.y - p.h;
    for (let i = 0; i < 2 + Math.floor(rng() * 3); i++) {
      const ia = p.a + (rng() - 0.5) * p.span * 1.8;
      icicles.push({ x: Math.cos(ia) * (p.r1 - 0.15), y: y0, z: Math.sin(ia) * (p.r1 - 0.15), s: 0.4 + rng() * 0.9 });
    }
  }
  const icicleMesh = new THREE.InstancedMesh(geo.cone, mats.ice, Math.max(1, icicles.length));
  const o = new THREE.Object3D();
  icicles.forEach((ic, i) => {
    o.position.set(ic.x, ic.y - ic.s / 2, ic.z);
    o.rotation.set(Math.PI, 0, 0);
    o.scale.set(0.08 + ic.s * 0.06, ic.s, 0.08 + ic.s * 0.06);
    o.updateMatrix();
    icicleMesh.setMatrixAt(i, o.matrix);
  });
  icicleMesh.count = icicles.length;
  icicleMesh.instanceMatrix.needsUpdate = true;
  group.add(icicleMesh);
};
