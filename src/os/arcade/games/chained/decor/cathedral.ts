// The Cathedral: coloured glass in the core, candles on the ledges and small arches against the wall.
import type { Dresser, Frame } from '../decor';
import type { T } from '../gl';
import { R_CORE } from '../level';

export const dressCathedral: Dresser = (d) => {
  const { THREE, geo, mats, group, rng, onCore } = d;
  const flames: { mesh: T.Mesh; seed: number }[] = [];
  for (const p of d.platforms) {
    const r = rng();
    if (r < 0.5) {
      // a window of coloured glass in the core
      const pane = new THREE.Mesh(geo.plane, mats.glass[Math.floor(rng() * mats.glass.length)]);
      const wa = p.a + (rng() - 0.5) * p.span;
      pane.position.copy(onCore(wa, p.y + 2.2 + rng() * 1.5, 0.07));
      pane.rotation.y = -wa + Math.PI / 2;
      pane.scale.set(0.5, 1.4, 1);
      const top = new THREE.Mesh(geo.disc, pane.material);
      top.position.copy(onCore(wa, p.y + 2.9 + (pane.position.y - p.y - 2.2), 0.07));
      top.rotation.y = -wa + Math.PI / 2;
      top.scale.setScalar(0.25);
      group.add(pane, top);
    } else if (r < 0.8) {
      const candle = new THREE.Mesh(geo.rod, mats.bone);
      const ca = p.a + (rng() - 0.5) * p.span * 1.6;
      const cr = p.r0 + 0.4 + rng() * 0.5;
      candle.position.set(Math.cos(ca) * cr, p.y + 0.14, Math.sin(ca) * cr);
      candle.scale.set(0.05, 0.28, 0.05);
      const flame = new THREE.Mesh(geo.cone, mats.flame);
      flame.position.set(Math.cos(ca) * cr, p.y + 0.36, Math.sin(ca) * cr);
      flame.scale.set(0.05, 0.12, 0.05);
      group.add(candle, flame);
      flames.push({ mesh: flame, seed: rng() * 10 });
    }
    if (rng() < 0.3) {
      // an arch and a column against the core
      const archGeo = d.track(new THREE.TorusGeometry(0.9, 0.1, 6, 16, Math.PI));
      const arch = new THREE.Mesh(archGeo, mats.stoneGrey);
      const aa = p.a + (rng() - 0.5) * p.span;
      arch.position.copy(onCore(aa, p.y + 2.4, 0.12));
      arch.rotation.y = -aa + Math.PI / 2;
      group.add(arch);
      for (const side of [-1, 1]) {
        const col = new THREE.Mesh(geo.rod, mats.stoneGrey);
        col.position.copy(onCore(aa + (side * 0.9) / R_CORE, p.y + 1.2, 0.12));
        col.scale.set(0.1, 2.4, 0.1);
        group.add(col);
      }
    }
  }
  // the candle flames flicker
  d.animate((f: Frame) => {
    for (const fl of flames) {
      const k = 1 + Math.sin(f.clock * 11 + fl.seed) * 0.18 + Math.sin(f.clock * 23 + fl.seed * 2) * 0.1;
      fl.mesh.scale.y = 0.12 * k;
      fl.mesh.rotation.z = Math.sin(f.clock * 7 + fl.seed) * 0.12;
    }
  });
};
