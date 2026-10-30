// The first person gun: one model per weapon built from parts (gunmetal, polymer, wood, glass and a glowing dot),
// held in two arms that follow the grips, with sway, walk bob, recoil, aiming down sights, reloads and swaps. It
// renders in its own pass after the world so it never clips into walls.
import type { WeaponId } from '../weapons.ts';
import { ADDITIVE, DOUBLE, canvas, lin, roundBox, type T, type Three } from './common.ts';

type Mat = 'metal' | 'poly' | 'tan' | 'wood' | 'glass' | 'dot' | 'olive';
type Part = { s: 'box' | 'cyl'; d: [number, number, number]; p: [number, number, number]; r?: [number, number, number]; m: Mat };

/** Each gun: its parts, where the sight line sits, the two hand points and the muzzle (all in gun space, -z forward). */
type Spec = { parts: Part[]; sight: number; grip: [number, number, number]; fore: [number, number, number]; muzzle: [number, number, number]; kick: number };

const B = (d: [number, number, number], p: [number, number, number], m: Mat, r?: [number, number, number]): Part => ({ s: 'box', d, p, m, r });
const C = (rad: number, len: number, p: [number, number, number], m: Mat, r?: [number, number, number]): Part => ({ s: 'cyl', d: [rad, len, rad], p, m, r: r ?? [Math.PI / 2, 0, 0] });

const SPECS: Record<WeaponId, Spec> = {
  wren: {
    parts: [B([0.03, 0.034, 0.19], [0, 0.05, -0.04], 'metal'), B([0.028, 0.026, 0.16], [0, 0.02, -0.03], 'poly'), B([0.028, 0.105, 0.045], [0, -0.035, 0.035], 'poly', [0.22, 0, 0]), B([0.006, 0.012, 0.006], [0, 0.072, -0.125], 'metal'), B([0.02, 0.012, 0.006], [0, 0.072, 0.045], 'metal'), B([0.004, 0.03, 0.05], [0, 0.0, -0.02], 'poly')],
    sight: 0.076,
    grip: [0, -0.05, 0.04],
    fore: [0, -0.06, 0.03],
    muzzle: [0, 0.05, -0.14],
    kick: 1,
  },
  bulwark: {
    parts: [B([0.036, 0.046, 0.24], [0, 0.055, -0.06], 'metal'), C(0.011, 0.04, [0, 0.055, -0.19], 'metal'), B([0.032, 0.03, 0.2], [0, 0.018, -0.05], 'metal'), B([0.032, 0.115, 0.05], [0, -0.04, 0.04], 'wood', [0.24, 0, 0]), B([0.006, 0.014, 0.008], [0, 0.084, -0.17], 'metal'), B([0.024, 0.014, 0.008], [0, 0.084, 0.05], 'metal')],
    sight: 0.088,
    grip: [0, -0.055, 0.045],
    fore: [0, -0.065, 0.035],
    muzzle: [0, 0.055, -0.21],
    kick: 1.8,
  },
  hornet: {
    parts: [
      B([0.046, 0.072, 0.32], [0, 0.03, -0.06], 'poly'),
      C(0.013, 0.13, [0, 0.04, -0.27], 'metal'),
      B([0.03, 0.17, 0.05], [0, -0.08, -0.08], 'metal', [0.12, 0, 0]),
      B([0.03, 0.1, 0.045], [0, -0.05, 0.06], 'poly', [0.25, 0, 0]),
      B([0.012, 0.012, 0.2], [0.018, 0.04, 0.2], 'metal'),
      B([0.012, 0.012, 0.2], [-0.018, 0.04, 0.2], 'metal'),
      B([0.05, 0.04, 0.012], [0, 0.035, 0.3], 'poly'),
      B([0.04, 0.012, 0.07], [0, 0.072, -0.05], 'metal'),
      B([0.004, 0.04, 0.04], [0.018, 0.098, -0.05], 'metal'),
      B([0.004, 0.04, 0.04], [-0.018, 0.098, -0.05], 'metal'),
      B([0.04, 0.004, 0.04], [0, 0.118, -0.05], 'metal'),
      B([0.006, 0.006, 0.002], [0, 0.098, -0.05], 'dot'),
    ],
    sight: 0.098,
    grip: [0, -0.07, 0.07],
    fore: [0, -0.02, -0.17],
    muzzle: [0, 0.04, -0.34],
    kick: 0.7,
  },
  mauler: {
    parts: [
      C(0.017, 0.62, [0, 0.05, -0.36], 'metal'),
      C(0.015, 0.48, [0, 0.015, -0.3], 'metal'),
      B([0.05, 0.05, 0.16], [0, 0.015, -0.24], 'wood'),
      B([0.05, 0.08, 0.2], [0, 0.03, 0], 'metal'),
      B([0.04, 0.08, 0.05], [0, -0.04, 0.09], 'wood', [0.3, 0, 0]),
      B([0.045, 0.09, 0.3], [0, -0.02, 0.27], 'wood', [-0.12, 0, 0]),
      B([0.006, 0.008, 0.006], [0, 0.072, -0.65], 'metal'),
    ],
    sight: 0.072,
    grip: [0, -0.05, 0.09],
    fore: [0, -0.01, -0.24],
    muzzle: [0, 0.05, -0.68],
    kick: 2.6,
  },
  kestrel: {
    parts: [
      B([0.05, 0.08, 0.36], [0, 0.03, -0.02], 'metal'),
      B([0.056, 0.062, 0.3], [0, 0.035, -0.33], 'tan'),
      C(0.012, 0.18, [0, 0.04, -0.55], 'metal'),
      B([0.03, 0.03, 0.06], [0, 0.04, -0.66], 'metal'),
      B([0.032, 0.17, 0.065], [0, -0.07, -0.08], 'metal', [-0.25, 0, 0]),
      B([0.032, 0.1, 0.045], [0, -0.05, 0.08], 'tan', [0.28, 0, 0]),
      B([0.048, 0.08, 0.26], [0, 0.0, 0.3], 'tan'),
      B([0.05, 0.014, 0.36], [0, 0.077, -0.14], 'metal'),
      B([0.046, 0.05, 0.075], [0, 0.11, -0.06], 'poly'),
      B([0.038, 0.034, 0.003], [0, 0.118, -0.06], 'glass'),
      B([0.005, 0.005, 0.002], [0, 0.118, -0.064], 'dot'),
    ],
    sight: 0.118,
    grip: [0, -0.07, 0.09],
    fore: [0, 0.0, -0.32],
    muzzle: [0, 0.04, -0.7],
    kick: 1,
  },
  lancer: {
    parts: [
      B([0.05, 0.08, 0.4], [0, 0.03, -0.04], 'metal'),
      B([0.054, 0.058, 0.32], [0, 0.035, -0.38], 'olive'),
      C(0.012, 0.28, [0, 0.04, -0.66], 'metal'),
      B([0.032, 0.12, 0.07], [0, -0.05, -0.1], 'metal'),
      B([0.032, 0.1, 0.045], [0, -0.05, 0.1], 'olive', [0.28, 0, 0]),
      B([0.05, 0.09, 0.3], [0, -0.005, 0.33], 'olive'),
      C(0.022, 0.32, [0, 0.115, -0.08], 'poly'),
      C(0.028, 0.05, [0, 0.115, -0.25], 'poly'),
      C(0.026, 0.05, [0, 0.115, 0.08], 'poly'),
      B([0.02, 0.03, 0.03], [0, 0.085, -0.16], 'metal'),
      B([0.02, 0.03, 0.03], [0, 0.085, 0.02], 'metal'),
      C(0.024, 0.004, [0, 0.115, -0.27], 'glass'),
    ],
    sight: 0.115,
    grip: [0, -0.07, 0.1],
    fore: [0, 0.0, -0.36],
    muzzle: [0, 0.04, -0.8],
    kick: 1.6,
  },
  longbow: {
    parts: [
      B([0.054, 0.08, 0.42], [0, 0.03, -0.04], 'metal'),
      C(0.016, 0.62, [0, 0.045, -0.55], 'metal'),
      B([0.03, 0.03, 0.08], [0, 0.045, -0.88], 'metal'),
      B([0.06, 0.06, 0.34], [0, 0.0, -0.36], 'olive'),
      B([0.05, 0.12, 0.3], [0, -0.01, 0.33], 'olive', [-0.08, 0, 0]),
      B([0.036, 0.1, 0.05], [0, -0.06, 0.12], 'olive', [0.3, 0, 0]),
      C(0.028, 0.38, [0, 0.122, -0.08], 'poly'),
      C(0.035, 0.07, [0, 0.122, -0.29], 'poly'),
      C(0.032, 0.06, [0, 0.122, 0.12], 'poly'),
      C(0.03, 0.004, [0, 0.122, -0.325], 'glass'),
      C(0.008, 0.07, [0.045, 0.05, 0.08], 'metal', [0, 0, Math.PI / 2]),
      B([0.02, 0.04, 0.03], [0, 0.088, -0.2], 'metal'),
      B([0.02, 0.04, 0.03], [0, 0.088, 0.04], 'metal'),
    ],
    sight: 0.122,
    grip: [0, -0.07, 0.12],
    fore: [0, -0.02, -0.34],
    muzzle: [0, 0.045, -0.92],
    kick: 3,
  },
};

const MATS: Record<Mat, { color: number; rough: number; metal: number; emissive?: number }> = {
  metal: { color: 0x6a6e75, rough: 0.34, metal: 0.8 },
  poly: { color: 0x2e3034, rough: 0.55, metal: 0.05 },
  tan: { color: 0x9a8566, rough: 0.7, metal: 0 },
  olive: { color: 0x4f5440, rough: 0.7, metal: 0 },
  wood: { color: 0x6e4a2e, rough: 0.55, metal: 0 },
  glass: { color: 0x0c1a24, rough: 0.05, metal: 0.9 },
  dot: { color: 0x000000, rough: 1, metal: 0, emissive: 0xff2a20 },
};

export type ViewState = {
  gun: WeaponId | null;
  ads: number;
  scoped: boolean;
  reload: number;
  switching: number;
  speed: number;
  phase: number;
  air: boolean;
  crouch: number;
  /** Look change this frame (radians), for sway. */
  dYaw: number;
  dPitch: number;
  sun: number;
  ambient: number;
  sleeve: number;
};

export type ViewModel = {
  scene: T.Scene;
  camera: T.PerspectiveCamera;
  update(st: ViewState, dt: number, main: T.Camera): void;
  fire(): void;
  /** Where the muzzle is, in world space (for tracers). */
  muzzle(out: T.Vector3): T.Vector3;
  setEnv(tex: T.Texture | null, intensity: number): void;
  dispose(): void;
};

export function viewModel(THREE: Three, sunDir: [number, number, number], sunColor: number, sunIntensity: number): ViewModel {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(54, 1, 0.01, 20);
  scene.add(camera);
  const sun = new THREE.DirectionalLight(new THREE.Color(...lin(sunColor)), sunIntensity);
  sun.position.set(sunDir[0], sunDir[1], sunDir[2]);
  scene.add(sun);
  scene.add(sun.target);
  const rig = new THREE.Group();
  camera.add(rig);
  const mats = {} as Record<Mat, T.MeshStandardMaterial>;
  for (const k of Object.keys(MATS) as Mat[]) {
    const d = MATS[k];
    mats[k] = new THREE.MeshStandardMaterial({ color: new THREE.Color(...lin(d.color)), roughness: d.rough, metalness: d.metal });
    if (d.emissive) mats[k].emissive.setRGB(...lin(d.emissive, 6));
  }
  const box = new THREE.BoxGeometry(1, 1, 1);
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 14);
  const rounded = new Map<string, T.BufferGeometry>();
  /** Rounded boxes built at their real size, so the rounding is even. */
  const roundedBox = (w: number, h: number, d: number) => {
    const key = `${w.toFixed(4)}:${h.toFixed(4)}:${d.toFixed(4)}`;
    let g = rounded.get(key);
    if (!g) rounded.set(key, (g = roundBox(THREE, w, h, d)));
    return g;
  };
  const guns = new Map<WeaponId, T.Group>();
  for (const [id, spec] of Object.entries(SPECS) as [WeaponId, Spec][]) {
    const g = new THREE.Group();
    for (const p of spec.parts) {
      const tiny = Math.min(p.d[0], p.d[1], p.d[2]) < 0.008;
      const mesh = new THREE.Mesh(p.s === 'cyl' ? cyl : tiny ? box : roundedBox(p.d[0], p.d[1], p.d[2]), mats[p.m]);
      if (p.s === 'cyl') mesh.scale.set(p.d[0], p.d[1], p.d[0]);
      else if (tiny) mesh.scale.set(p.d[0], p.d[1], p.d[2]);
      mesh.position.set(...p.p);
      if (p.r) mesh.rotation.set(...p.r);
      g.add(mesh);
    }
    g.visible = false;
    rig.add(g);
    guns.set(id, g);
  }
  // arms: sleeves stretched from a shoulder to each hand, gloves at the hands
  const sleeveMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(...lin(0x3d4c5e)), roughness: 0.9 });
  const gloveMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(...lin(0x1e1f22)), roughness: 0.75 });
  const sleeveGeo = new THREE.CylinderGeometry(0.042, 0.05, 1, 10);
  sleeveGeo.translate(0, 0.5, 0);
  sleeveGeo.rotateX(Math.PI / 2);
  const gloveGeo = new THREE.BoxGeometry(0.055, 0.075, 0.1);
  const arms = [0, 1].map(() => {
    const s = new THREE.Mesh(sleeveGeo, sleeveMat);
    const g = new THREE.Mesh(gloveGeo, gloveMat);
    camera.add(s);
    camera.add(g);
    return { s, g };
  });
  // muzzle flash: a bright star card
  const fc = canvas(128, 128);
  const fg = fc.getContext('2d')!;
  const grad = fg.createRadialGradient(64, 64, 2, 64, 64, 60);
  grad.addColorStop(0, 'rgba(255,250,230,1)');
  grad.addColorStop(0.25, 'rgba(255,190,90,0.9)');
  grad.addColorStop(1, 'rgba(255,120,20,0)');
  fg.fillStyle = grad;
  fg.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    const rr = k % 2 ? 22 : 62;
    fg.lineTo(64 + Math.cos(a) * rr, 64 + Math.sin(a) * rr);
  }
  fg.fill();
  const flashTex = new THREE.CanvasTexture(fc);
  flashTex.colorSpace = THREE.SRGBColorSpace;
  const flashMat = new THREE.MeshBasicMaterial({ map: flashTex, transparent: true, blending: ADDITIVE, depthWrite: false, side: DOUBLE, color: new THREE.Color(4, 3.2, 2.2) });
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), flashMat);
  flash.visible = false;
  rig.add(flash);

  let cur: WeaponId | null = null;
  let swayX = 0;
  let swayY = 0;
  let svx = 0;
  let svy = 0;
  let kick = 0;
  let kickV = 0;
  let flashT = 0;
  let bobT = 0;
  const v = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const shoulder = [new THREE.Vector3(0.26, -0.38, 0.04), new THREE.Vector3(-0.2, -0.4, 0)];
  const q = new THREE.Quaternion();
  const zAxis = new THREE.Vector3(0, 0, 1);

  return {
    scene,
    camera,
    update(st, dt, main) {
      camera.quaternion.copy(main.quaternion);
      camera.position.set(0, 0, 0);
      camera.updateMatrixWorld();
      sun.intensity = sunIntensity * st.sun;
      scene.environmentIntensity = st.ambient;
      sleeveMat.color.setRGB(...lin(st.sleeve));
      if (st.gun !== cur) {
        if (cur) guns.get(cur)!.visible = false;
        cur = st.gun;
        if (cur) guns.get(cur)!.visible = true;
      }
      const spec = cur ? SPECS[cur] : null;
      const visible = !!spec && !st.scoped;
      rig.visible = visible;
      for (const a of arms) a.s.visible = a.g.visible = visible;
      if (!spec) return;
      // sway: springs pulled by how the view turned
      const k = 1 - Math.exp(-dt * 9);
      svx += (-st.dYaw * 0.9 - swayX) * k;
      svy += (st.dPitch * 0.9 - swayY) * k;
      swayX += svx * k * 2;
      swayY += svy * k * 2;
      swayX *= 1 - Math.min(1, dt * 6);
      swayY *= 1 - Math.min(1, dt * 6);
      // recoil spring
      kickV += (-kick * 260 - kickV * 22) * dt;
      kick += kickV * dt;
      bobT += dt * (1 + st.speed * 7);
      const ads = st.ads * st.ads * (3 - 2 * st.ads);
      const still = 1 - ads * 0.85;
      const hip = spec.sight < 0.09 ? [0.15, -0.16, -0.43] : [0.16, -0.17, -0.38];
      const aim = [0, -spec.sight, -0.3];
      const bobX = Math.sin(st.phase * 2.2) * 0.012 * st.speed * still;
      const bobY = -Math.abs(Math.cos(st.phase * 2.2)) * 0.012 * st.speed * still + Math.sin(bobT * 0.9) * 0.002 * still;
      const drop = Math.sin(Math.min(1, st.reload) * Math.PI);
      const sw = st.switching;
      rig.position.set(
        hip[0] + (aim[0] - hip[0]) * ads + bobX + swayX * 0.05 * still,
        hip[1] + (aim[1] - hip[1]) * ads + bobY + swayY * 0.05 * still - drop * 0.07 - sw * 0.32 - (st.air ? 0.012 : 0) - st.crouch * 0.01 * still,
        hip[2] + (aim[2] - hip[2]) * ads + kick * 0.6,
      );
      rig.rotation.set(-kick * 1.4 * spec.kick * 0.6 + drop * 0.55 + swayY * 0.4 * still + sw * 0.5, swayX * 0.5 * still + 0.03 * (1 - ads), drop * 0.75 + bobX * 2);
      rig.updateMatrix();
      rig.updateMatrixWorld(true);
      flashT -= dt;
      flash.visible = flashT > 0;
      if (flash.visible) {
        flash.position.set(spec.muzzle[0], spec.muzzle[1], spec.muzzle[2] - 0.05);
        flash.rotation.set(0, 0, Math.random() * Math.PI);
        flash.scale.setScalar(0.7 + Math.random() * 0.6);
      }
      // arms reach from the shoulders to the grips (pistols: both hands on the grip)
      const hands = [spec.grip, spec.fore];
      arms.forEach((a, i) => {
        v.set(...hands[i]);
        rig.localToWorld(v);
        camera.worldToLocal(v);
        a.g.position.copy(v);
        a.g.quaternion.copy(rig.quaternion);
        v2.copy(v).sub(shoulder[i]);
        const len = v2.length();
        a.s.position.copy(shoulder[i]);
        q.setFromUnitVectors(zAxis, v2.normalize());
        a.s.quaternion.copy(q);
        a.s.scale.set(1, 1, len);
      });
    },
    fire() {
      kick = Math.min(0.06, kick + 0.018);
      kickV += 0.6;
      flashT = 0.045;
    },
    muzzle(out) {
      if (!cur) return out.set(0, 0, 0);
      const spec = SPECS[cur];
      out.set(...spec.muzzle);
      rig.localToWorld(out);
      return out;
    },
    setEnv(tex, intensity) {
      scene.environment = tex;
      scene.environmentIntensity = intensity;
    },
    dispose() {
      box.dispose();
      cyl.dispose();
      for (const g of rounded.values()) g.dispose();
      sleeveGeo.dispose();
      gloveGeo.dispose();
      flashTex.dispose();
      flash.geometry.dispose();
      flashMat.dispose();
      sleeveMat.dispose();
      gloveMat.dispose();
      for (const m of Object.values(mats)) m.dispose();
    },
  };
}
