// The Catacombs: niches with skulls cut into the core, and ghosts drifting off the ledges.
import type { Dresser, Frame } from '../decor';
import type { T } from '../gl';

export const dressCatacombs: Dresser = (d) => {
  const { THREE, geo, mats, group, rng, onCore } = d;
  const ghosts: { mesh: T.Mesh; x: number; y: number; z: number; seed: number }[] = [];
  for (const p of d.platforms) {
    const r = rng();
    if (r < 0.5) {
      // a niche with a skull in it
      const niche = new THREE.Mesh(geo.box, mats.darkIron);
      const na = p.a + (rng() - 0.5) * p.span;
      niche.position.copy(onCore(na, p.y + 1.4, 0.05));
      niche.rotation.y = -na;
      niche.scale.set(0.12, 0.6, 0.5);
      const skull = new THREE.Mesh(geo.ball, mats.bone);
      skull.position.copy(onCore(na, p.y + 1.3, 0.2));
      skull.scale.set(0.16, 0.15, 0.17);
      group.add(niche, skull);
    }
    if (r > 0.6) {
      const ghost = new THREE.Mesh(geo.ball, mats.ghost);
      const gaz = p.a + (rng() - 0.5) * p.span * 2;
      const gr = p.r1 + 0.8 + rng() * 1.5;
      ghost.scale.setScalar(0.14);
      group.add(ghost);
      ghosts.push({ mesh: ghost, x: Math.cos(gaz) * gr, y: p.y + 1.2 + rng() * 2, z: Math.sin(gaz) * gr, seed: rng() * 10 });
    }
  }
  // the ghosts drift and breathe (they share one material, so the last one sets its opacity)
  d.animate((f: Frame) => {
    for (const gh of ghosts) {
      gh.mesh.position.set(gh.x + Math.sin(f.clock * 0.7 + gh.seed) * 0.6, gh.y + Math.sin(f.clock * 1.1 + gh.seed) * 0.4, gh.z + Math.cos(f.clock * 0.5 + gh.seed) * 0.6);
      (gh.mesh.material as T.MeshBasicMaterial).opacity = 0.45 + Math.sin(f.clock * 2 + gh.seed) * 0.25;
    }
  });
};
