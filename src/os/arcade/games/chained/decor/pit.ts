// The Pit: torches on the core wall, chains hung from it and a skull or two on the ledges.
import type { Dresser, Frame } from '../decor';
import type { T } from '../gl';

export const dressPit: Dresser = (d) => {
  const { THREE, geo, mats, group, rng, onCore } = d;
  const flames: { mesh: T.Mesh; seed: number }[] = [];
  const addTorch = (a: number, y: number) => {
    const bracket = new THREE.Mesh(geo.box, mats.iron);
    bracket.position.copy(onCore(a, y, 0.3));
    bracket.rotation.y = -a;
    bracket.scale.set(0.5, 0.08, 0.08);
    const stick = new THREE.Mesh(geo.rod, mats.wood);
    stick.position.copy(onCore(a, y + 0.22, 0.5));
    stick.scale.set(0.05, 0.5, 0.05);
    const flame = new THREE.Mesh(geo.cone, mats.flame);
    flame.position.copy(onCore(a, y + 0.62, 0.5));
    flame.scale.set(0.16, 0.42, 0.16);
    const coreF = new THREE.Mesh(geo.cone, mats.flameCore);
    coreF.position.copy(onCore(a, y + 0.56, 0.5));
    coreF.scale.set(0.08, 0.22, 0.08);
    group.add(bracket, stick, flame, coreF);
    flames.push({ mesh: flame, seed: rng() * 10 });
  };
  const addHangingChain = (a: number, y: number, len: number, out = 0.4) => {
    const n = Math.max(2, Math.round(len / 0.2));
    const im = new THREE.InstancedMesh(geo.link, mats.chain, n);
    const o = new THREE.Object3D();
    for (let i = 0; i < n; i++) {
      o.position.copy(onCore(a, y - i * 0.2, out));
      o.rotation.set(0, -a + (i % 2) * Math.PI * 0.5, 0);
      o.updateMatrix();
      im.setMatrixAt(i, o.matrix);
    }
    im.instanceMatrix.needsUpdate = true;
    group.add(im);
  };
  for (const p of d.platforms) {
    const r = rng();
    if (r < 0.45) addTorch(p.a + (rng() - 0.5) * p.span, p.y + 1.6);
    if (r > 0.7) addHangingChain(p.a + p.span * 0.9, p.y + 3 + rng() * 2, 1.5 + rng() * 3);
    if (rng() < 0.25) {
      // a skull or two on the ledge
      const skull = new THREE.Mesh(geo.ball, mats.bone);
      const sa = p.a + (rng() - 0.5) * p.span * 1.4;
      const sr = p.r0 + 0.5 + rng() * 0.8;
      skull.position.set(Math.cos(sa) * sr, p.y + 0.14, Math.sin(sa) * sr);
      skull.scale.set(0.16, 0.14, 0.17);
      group.add(skull);
    }
  }
  // the flames flicker
  d.animate((f: Frame) => {
    for (const fl of flames) {
      const k = 1 + Math.sin(f.clock * 11 + fl.seed) * 0.18 + Math.sin(f.clock * 23 + fl.seed * 2) * 0.1;
      fl.mesh.scale.y = 0.42 * k;
      fl.mesh.rotation.z = Math.sin(f.clock * 7 + fl.seed) * 0.12;
    }
  });
};
