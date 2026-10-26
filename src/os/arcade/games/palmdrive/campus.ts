// More of campus round Palm Drive (the course's palms, oaks and landmarks are in scenery.ts): the Main Quad's ring of
// sandstone buildings behind Memorial Church, the eucalyptus in the Arboretum, the old lamp posts down Palm Drive, the
// sandstone gateway at its foot, and flower beds round the Oval.
import { modelKit } from './model';
import { canvas, texture, type Scenery } from './scenery';
import { LANDMARKS, headingOf, pointAt } from './track';
import { gumTrees, shrubs } from './flora';
import { SANDSTONE, SANDSTONE_DARK, TILE, hall, vcMats } from './landmarks';

/** A campus lamp post: a dark green fluted pole and a lantern; its glass lit when lit. */
export function lampPost(mk: ReturnType<typeof modelKit>, x: number, z: number, lit = false) {
  mk.cyl(0x23302a, x, 0.25, z, 0.22, 0.5, 0.22);
  mk.cyl(0x2c3b33, x, 2.2, z, 0.08, 3.9, 0.08);
  mk.cyl(0x23302a, x, 4.2, z, 0.16, 0.15, 0.16);
  if (lit) mk.glow(0xfff0c8, x, 4.55, z, 0.32, 0.55, 0.32);
  else mk.box(0xe8e4d4, x, 4.55, z, 0.32, 0.55, 0.32);
  mk.cone(0x23302a, x, 4.98, z, 0.3, 0.3, 0.3);
}

export function campusExtras(c: Scenery) {
  const { THREE, scene, t, r, rand, clear, dummy } = c;
  const m = vcMats(THREE);
  // the Main Quad: its ring of arcaded buildings round the court behind the church
  {
    const mk = modelKit(THREE);
    const ch = LANDMARKS.church;
    const spots: [number, number, number, number, number, number][] = [
      // (x, z from the church; w, d, h; turned)
      [-62, -14, 30, 14, 11, Math.PI / 2],
      [62, -14, 30, 14, 11, -Math.PI / 2],
      [-62, 26, 30, 14, 11, Math.PI / 2],
      [62, 26, 30, 14, 11, -Math.PI / 2],
      [-32, 52, 34, 14, 12, Math.PI],
      [32, 52, 34, 14, 12, Math.PI],
    ];
    for (const [dx, dz, w, d, h, ry] of spots) {
      const x = ch.x + dx;
      const z = ch.z + dz;
      if (!clear(x, z, Math.max(w, d) / 2 + 4)) continue;
      mk.place(x, 0, z, ry);
      hall(THREE, mk, w, d, h, true);
    }
    mk.place();
    if (mk.count()) scene.add(mk.build(m.vc, m.lit));
  }
  // the old lamp posts down Palm Drive, between the palms, and round the Oval
  {
    const mk = modelKit(THREE);
    const [pd0, pd1] = r.lay.palmDrive ?? [0, 0];
    const len = (pd1 - pd0 + t.length) % t.length;
    for (let a = 5.5; a < len; a += 22) {
      for (const side of [-1, 1]) {
        const p = pointAt(t, pd0 + a, side * (t.edge + 1.6));
        if (clear(p.x, p.z, 0.6)) lampPost(mk, p.x, p.z);
      }
    }
    const oval = LANDMARKS.oval;
    for (let a = Math.PI / 18; a < Math.PI * 2; a += Math.PI / 9) {
      const x = oval.x + Math.cos(a) * (oval.rx + 1.2);
      const z = oval.z + Math.sin(a) * (oval.rz + 1.2);
      if (clear(x, z, 0.6)) lampPost(mk, x, z);
    }
    // the gateway at the foot of Palm Drive: low curved sandstone walls either side, the name on them
    const p = pointAt(t, pd0 + 2, 0);
    const h = headingOf(p.tx, p.tz);
    for (const side of [-1, 1]) {
      const q = pointAt(t, pd0 + 2, side * (t.edge + 5));
      if (!clear(q.x, q.z, 3)) continue;
      mk.place(q.x, 0, q.z, h);
      mk.box(SANDSTONE_DARK, 0, 0.3, 0, 7.4, 0.6, 1.6);
      mk.box(SANDSTONE, 0, 1.2, 0, 7, 1.8, 1.2);
      mk.box(0xe8d2a8, 0, 2.2, 0, 7.3, 0.25, 1.4);
      for (const sx of [-1, 1]) {
        mk.box(SANDSTONE, sx * 3.7, 1.5, 0, 1.2, 3, 1.5);
        mk.box(TILE, sx * 3.7, 3.15, 0, 1.4, 0.3, 1.7);
      }
    }
    mk.place();
    if (mk.count()) scene.add(mk.build(m.vc, m.lit));
    const name = texture(
      THREE,
      canvas(512, 96, (g) => {
        g.fillStyle = '#cdb084';
        g.fillRect(0, 0, 512, 96);
        g.fillStyle = '#5a3a22';
        g.font = 'bold 54px Georgia, serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('STANFORD', 256, 52);
      }),
    );
    const plaque = new THREE.MeshLambertMaterial({ map: name });
    for (const side of [-1, 1]) {
      const q = pointAt(t, pd0 + 2, side * (t.edge + 5));
      if (!clear(q.x, q.z, 3)) continue;
      // (on the face toward the road)
      const face = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 1.1), plaque);
      const nx = -p.tz * -side;
      const nz = p.tx * -side;
      face.position.set(q.x + nx * 0.61, 1.25, q.z + nz * 0.61);
      face.rotation.y = headingOf(nx, nz);
      scene.add(face);
    }
  }
  // blue gums in the Arboretum, among its oaks, and a hedge of shrubs along the Oval
  const gums: { x: number; z: number; h: number }[] = [];
  for (let n = 0; gums.length < 38 && n < 1500; n++) {
    const x = -40 - rand() * 150;
    const z = -240 + rand() * 260;
    if (clear(x, z, 4) && [LANDMARKS.cantor, LANDMARKS.hoover].every((b) => Math.hypot(b.x - x, b.z - z) > 26)) gums.push({ x, z, h: 18 + rand() * 10 });
  }
  gumTrees(THREE, scene, dummy, gums);
  const bush: { x: number; z: number; r: number }[] = [];
  const oval = LANDMARKS.oval;
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 40) {
    const x = oval.x + Math.cos(a) * (oval.rx - 1.5);
    const z = oval.z + Math.sin(a) * (oval.rz - 1.5);
    if (clear(x, z, 0.8)) bush.push({ x, z, r: 0.9 + rand() * 0.4 });
  }
  shrubs(THREE, scene, dummy, bush);
  // the S on the Oval in red flowers, and beds of them either side
  const bed = texture(
    THREE,
    canvas(128, 128, (g) => {
      g.fillStyle = '#7a3b1e';
      g.fillRect(0, 0, 128, 128);
      for (let k = 0; k < 900; k++) {
        g.fillStyle = ['#d8261e', '#f2c230', '#e8e8e0', '#b81e3a'][k % 4];
        g.beginPath();
        g.arc(Math.random() * 128, Math.random() * 128, 1.5 + Math.random() * 2, 0, Math.PI * 2);
        g.fill();
      }
    }),
  );
  const bedMat = new THREE.MeshLambertMaterial({ map: bed });
  for (const side of [-1, 1]) {
    const g = new THREE.CircleGeometry(1, 28);
    g.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(g, bedMat);
    mesh.scale.set(5, 1, 9);
    mesh.position.set(oval.x + side * (oval.rx * 0.55), 0.045, oval.z + oval.rz * 0.55);
    scene.add(mesh);
  }
}
