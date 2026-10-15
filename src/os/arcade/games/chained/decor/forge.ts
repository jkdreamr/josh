// The Forge: girders out from the core, turning gears and glowing vents on the wall.
import type { Dresser, Frame } from '../decor';
import type { T } from '../gl';

export const dressForge: Dresser = (d) => {
  const { THREE, geo, mats, group, rng, onCore } = d;
  const gears: T.Group[] = [];
  for (const p of d.platforms) {
    const r = rng();
    if (r < 0.35) {
      // a girder out from the core above the ledge
      const girder = new THREE.Mesh(geo.box, mats.iron);
      const ga = p.a + (rng() - 0.5) * p.span;
      const gl2 = 2.5 + rng() * 2;
      const mid = onCore(ga, p.y + 3.2 + rng(), gl2 / 2);
      girder.position.copy(mid);
      girder.rotation.y = -ga;
      girder.scale.set(gl2, 0.18, 0.18);
      group.add(girder);
    } else if (r < 0.6) {
      const gear = new THREE.Group();
      const ring = new THREE.Mesh(geo.ring, mats.iron);
      ring.scale.setScalar(0.6);
      gear.add(ring);
      for (let i = 0; i < 4; i++) {
        const spoke = new THREE.Mesh(geo.box, mats.iron);
        spoke.rotation.z = (i * Math.PI) / 4;
        spoke.scale.set(1.3, 0.1, 0.08);
        gear.add(spoke);
      }
      const ga = p.a + (rng() - 0.5) * p.span;
      gear.position.copy(onCore(ga, p.y + 2 + rng() * 1.5, 0.12));
      gear.rotation.y = -ga + Math.PI / 2;
      group.add(gear);
      gears.push(gear);
    } else if (r < 0.8) {
      const vent = new THREE.Mesh(geo.plane, mats.vent);
      const va = p.a + (rng() - 0.5) * p.span;
      vent.position.copy(onCore(va, p.y + 0.9 + rng(), 0.08));
      vent.rotation.y = -va + Math.PI / 2;
      vent.scale.set(0.5, 0.18, 1);
      group.add(vent);
    }
  }
  // the gears turn
  d.animate((f: Frame) => {
    for (const gear of gears) gear.rotation.z += f.dt * 0.6;
  });
};
