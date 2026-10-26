// Stanford Stadium on game day (scenery.ts lays out the bowl): the crowd in the stands, people in cardinal, white and
// gold, cheering in waves round the bowl; the stands' back wall and rail, aisles down them and the press box; light
// towers with their banks of lamps; the goalposts; the scoreboard; and the tunnel's portal with its name.
import type { T } from './gl';
import type { ModelKit } from './model';
import { canvas, scatter, texture } from './scenery';

type Three = typeof import('three');

const cheer = { value: 0 };
/** The crowd's clock (set once a frame). */
export function crowdTick(clock: number) {
  cheer.value = clock;
}

/**
 * The crowd: a fan at each spot (sitting forward on the rows), their shirts in `colors` by `pick`, skin tones and caps
 * varied, arms going up as a wave comes round the bowl. Two draws: the bodies and the heads.
 */
export function crowd(THREE: Three, scene: T.Scene, dummy: T.Object3D, fans: { x: number; y: number; z: number; ry: number; color: number }[]) {
  if (!fans.length) return;
  // a fan: torso and arms (the arms in their own vertex group, raised by the shader), unit-sized, feet at y = -0.45
  const body = (() => {
    const pos: number[] = [];
    const arm: number[] = [];
    const box = (x: number, y: number, z: number, sx: number, sy: number, sz: number, a: number) => {
      const g = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed();
      g.translate(x, y, z);
      const p = g.getAttribute('position');
      for (let k = 0; k < p.count; k++) {
        pos.push(p.getX(k), p.getY(k), p.getZ(k));
        arm.push(a);
      }
      g.dispose();
    };
    box(0, -0.05, 0, 0.5, 0.62, 0.32, 0);
    box(0, -0.38, 0.15, 0.46, 0.18, 0.4, 0);
    for (const sd of [-1, 1]) box(sd * 0.3, 0.05, 0.02, 0.13, 0.5, 0.13, sd);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('arm', new THREE.Float32BufferAttribute(arm, 1));
    g.computeVertexNormals();
    return g;
  })();
  const head = new THREE.IcosahedronGeometry(0.16, 0);
  head.translate(0, 0.42, 0);
  const wave = (key: string, armed: boolean) => {
    const m = new THREE.MeshLambertMaterial({ color: 0xffffff });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uCheer = cheer;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>\nuniform float uCheer;\n${armed ? 'attribute float arm;' : ''}`)
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           vec3 fp = instanceMatrix[3].xyz;
           // (the wave: a crest running round the bowl, everyone up as it passes; a little fidget the rest of the time)
           float ang = atan(fp.z, fp.x);
           float crest = pow(max(0.0, sin(ang * 2.0 - uCheer * 1.2)), 12.0);
           float jig = 0.5 + 0.5 * sin(uCheer * 3.0 + fp.x * 1.7 + fp.z * 2.3);
           transformed.y += crest * 0.35;
           ${armed ? 'if (abs(arm) > 0.5) { float up = max(crest, 0.25 * jig * step(0.8, fract(fp.x * 0.37 + fp.z * 0.21))); transformed.y += up * (position.y + 0.25) * 1.4; transformed.x += arm * up * 0.08; }' : ''}`,
        );
    };
    m.customProgramCacheKey = () => `pd-crowd-${key}`;
    return m;
  };
  const bodies = new THREE.InstancedMesh(body, wave('body', true), fans.length);
  const heads = new THREE.InstancedMesh(head, wave('head', false), fans.length);
  const r = scatter(71);
  const tint = new THREE.Color();
  const skins = [0xf2c7a0, 0xd9a47a, 0xa86e48, 0x6e4630, 0xf6d8b8];
  fans.forEach((f, i) => {
    dummy.position.set(f.x, f.y, f.z);
    dummy.rotation.set(0, f.ry, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    bodies.setMatrixAt(i, dummy.matrix);
    heads.setMatrixAt(i, dummy.matrix);
    bodies.setColorAt(i, tint.setHex(f.color).multiplyScalar(0.85 + r() * 0.3));
    heads.setColorAt(i, tint.setHex(r() < 0.2 ? [0x8c1515, 0xf6f4ef, 0x2a2a30][Math.floor(r() * 3)] : skins[Math.floor(r() * skins.length)]));
  });
  dummy.rotation.set(0, 0, 0);
  for (const m of [bodies, heads]) {
    m.computeBoundingSphere();
    m.userData.noCast = true;
    m.frustumCulled = true;
    scene.add(m);
  }
}

/** A light tower: a tapering steel mast with a ladder, a catwalk and a bank of lamps (three rows of five) facing `ry`. */
export function lightTower(mk: ModelKit, x: number, z: number, ry: number) {
  mk.place(x, 0, z, ry);
  mk.cyl(0x8a8f96, 0, 1, 0, 1.2, 2, 1.2);
  mk.cyl(0x6a7076, 0, 15, 0, 0.45, 28, 0.55);
  for (let y = 2; y < 28; y += 0.5) mk.box(0x55585c, 0, y, -0.55, 0.4, 0.04, 0.04);
  mk.box(0x55585c, 0, 28.6, 0.4, 7, 0.15, 1.6);
  for (const sd of [-1, 1]) mk.box(0x55585c, sd * 3.4, 29.1, 1.1, 0.05, 1, 0.05);
  mk.box(0x3a3d42, 0, 31, 0, 7, 4.2, 0.5);
  for (let row = 0; row < 3; row++) {
    for (let k = -2; k <= 2; k++) {
      mk.cyl(0x2a2c30, k * 1.3, 29.7 + row * 1.3, 0.35, 0.5, 0.35, 0.5, Math.PI / 2, 0, 0);
      mk.glow(0xfff6d8, k * 1.3, 29.7 + row * 1.3, 0.54, 0.38, 0.38, 0.04);
    }
  }
  mk.place();
}

/** A goalpost: the gooseneck curving up from its padded base, the crossbar, two uprights and their streamers, in gold. */
export function goalpost(mk: ModelKit, x: number, z: number, ry: number) {
  const gold = 0xf2c230;
  mk.place(x, 0, z, ry);
  mk.cyl(0x8c1515, 0, 1, 0, 0.32, 2, 0.32);
  mk.cyl(gold, 0, 2.4, 0, 0.15, 1.0, 0.15);
  mk.cyl(gold, 0, 2.95, -0.35, 0.14, 0.9, 0.14, -0.9, 0, 0);
  mk.cyl(gold, 0, 3.05, -0.75, 0.14, 0.3, 0.14);
  mk.cyl(gold, 0, 3.15, -0.75, 0.12, 5.6, 0.12, 0, 0, Math.PI / 2);
  for (const sd of [-1, 1]) {
    mk.cyl(gold, sd * 2.8, 6.3, -0.75, 0.09, 6.3, 0.09);
    mk.box(0x8c1515, sd * 2.8, 9.6, -0.75, 0.04, 0.6, 0.18);
  }
  mk.place();
}

/** The scoreboard: twin legs, the cardinal frame with a white rim, the screen's frame and the clocks under it. */
export function scoreboard(mk: ModelKit, x: number, z: number, ry: number) {
  mk.place(x, 0, z, ry);
  for (const sd of [-1, 1]) {
    mk.box(0x3a3d42, sd * 8, 8, -0.4, 1.4, 16, 1.4);
    mk.box(0x2a2c30, sd * 8, 0.3, -0.4, 2.4, 0.6, 2.4);
  }
  mk.box(0x8c1515, 0, 21, 0, 26, 11, 1.4);
  mk.box(0xf3f1ec, 0, 26.6, 0.1, 26.4, 0.4, 1.5);
  mk.box(0xf3f1ec, 0, 15.4, 0.1, 26.4, 0.4, 1.5);
  mk.box(0x1a1a1e, 0, 13.9, 0.2, 20, 2.4, 0.8);
  for (const sd of [-1, 1]) for (let k = 0; k < 4; k++) mk.glow(0xff3a2a, sd * 6 + (k - 1.5) * 1.1, 13.9, 0.62, 0.7, 1.2, 0.04);
  mk.box(0x2a2c30, 0, 21, -0.9, 25, 10, 0.4);
  mk.place();
}

/** The tunnel's portal: concrete piers either side of the road, the lintel across with the stadium's name on it. */
export function portal(THREE: Three, scene: T.Scene, mk: ModelKit, x: number, z: number, ry: number, span: number) {
  mk.place(x, 0, z, ry);
  for (const sd of [-1, 1]) {
    mk.box(0xbdb6aa, sd * (span / 2 + 1), 4.8, 0, 2.2, 9.6, 2.6);
    mk.box(0xa8a194, sd * (span / 2 + 1), 0.4, 0, 2.6, 0.8, 3);
    for (let y = 1.6; y < 9; y += 1.6) mk.box(0xa8a194, sd * (span / 2 + 1), y, 0, 2.24, 0.06, 2.64);
  }
  mk.box(0x8c1515, 0, 10, 0, span + 4.6, 2.4, 1.8);
  mk.box(0xf3f1ec, 0, 11.3, 0, span + 4.8, 0.2, 2);
  mk.box(0xf3f1ec, 0, 8.75, 0, span + 4.8, 0.12, 2);
  mk.place();
  const name = texture(
    THREE,
    canvas(512, 64, (g) => {
      g.fillStyle = '#8c1515';
      g.fillRect(0, 0, 512, 64);
      g.fillStyle = '#ffffff';
      g.font = 'bold 34px Georgia, serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('STANFORD STADIUM', 256, 34);
    }),
  );
  const mat = new THREE.MeshLambertMaterial({ map: name });
  for (const sd of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(span + 3, 1.9), mat);
    m.position.set(x + Math.sin(ry) * sd * 0.92, 10, z + Math.cos(ry) * sd * 0.92);
    m.rotation.y = ry + (sd < 0 ? Math.PI : 0);
    scene.add(m);
  }
}
