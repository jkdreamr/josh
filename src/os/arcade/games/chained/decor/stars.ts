// The Stars: shards of the tower floating round the ledges, and the gate at the top with its bell.
import type { Dresser, Frame } from '../decor';
import type { T } from '../gl';

export const dressStars: Dresser = (d) => {
  const { THREE, geo, mats, group, rng } = d;
  const shards: { mesh: T.Mesh; a: number; r: number; y: number; seed: number }[] = [];
  for (const p of d.platforms) {
    const r = rng();
    if (r < 0.6) {
      const shard = new THREE.Mesh(geo.box, d.flat(d.palette.stone[1]));
      const sa = p.a + (rng() - 0.5) * 1.2;
      const sr = p.r1 + 2 + rng() * 5;
      shard.scale.set(0.4 + rng() * 0.8, 0.3 + rng() * 0.4, 0.4 + rng() * 0.8);
      shard.rotation.set(rng(), rng(), rng());
      group.add(shard);
      shards.push({ mesh: shard, a: sa, r: sr, y: p.y + (rng() - 0.5) * 4, seed: rng() * 10 });
    }
  }
  // the gate at the top: an arch over the way out, and a bell under it
  const goal = d.level.goal;
  const ga = goal.a;
  const gr = goal.r0 + 2.3;
  {
    const archGeo = d.track(new THREE.TorusGeometry(2.4, 0.22, 8, 24, Math.PI));
    const arch = new THREE.Mesh(archGeo, d.flat('#cfd6ee'));
    arch.position.set(Math.cos(ga) * gr, goal.y + 0.2, Math.sin(ga) * gr);
    arch.rotation.y = -ga + Math.PI / 2;
    group.add(arch);
    for (const side of [-1, 1]) {
      const col = new THREE.Mesh(geo.rod, d.flat('#b9c2e3'));
      const ca = ga + (side * 2.4) / gr;
      col.position.set(Math.cos(ca) * gr, goal.y + 1.2, Math.sin(ca) * gr);
      col.scale.set(0.24, 2.4, 0.24);
      group.add(col);
    }
  }
  const bell = new THREE.Group();
  {
    const cup = new THREE.Mesh(geo.cone, mats.gold);
    cup.scale.set(0.55, 0.8, 0.55);
    cup.position.y = -0.5;
    const lip = new THREE.Mesh(geo.ring, mats.gold);
    lip.rotation.x = Math.PI / 2;
    lip.scale.setScalar(0.5);
    lip.position.y = -0.88;
    bell.add(cup, lip);
    bell.position.set(Math.cos(ga) * gr, goal.y + 2.5, Math.sin(ga) * gr);
    group.add(bell);
  }
  // the shards orbit slowly, and the bell swings once the climb is won
  let bellSwing = 0;
  let rang = false;
  d.animate((f: Frame) => {
    for (const sh of shards) {
      const a = sh.a + f.clock * 0.03;
      sh.mesh.position.set(Math.cos(a) * sh.r, sh.y + Math.sin(f.clock * 0.5 + sh.seed) * 0.4, Math.sin(a) * sh.r);
      sh.mesh.rotation.y += f.dt * 0.2;
    }
    if (f.won && !rang) {
      rang = true;
      bellSwing = 1;
    }
    if (bellSwing > 0) {
      bellSwing = Math.max(0, bellSwing - f.dt * 0.25);
      bell.rotation.z = Math.sin(f.clock * 6) * 0.5 * bellSwing;
    }
  });
};
