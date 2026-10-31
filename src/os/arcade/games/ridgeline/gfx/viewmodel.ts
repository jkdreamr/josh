// The first person view: the real gun models from guns.ts held in gloved hands (palm, fingers wrapped round the grip,
// the index finger along the trigger guard, armored knuckles, a cuff) in camouflage sleeves, with sway, walk bob,
// recoil, aiming down sights, reloads and swaps. It renders in its own pass after the world so it never clips into
// walls, lit by the same sky and darkened when you stand in shade.
import type { WeaponId } from '../weapons.ts';
import { WEAPONS } from '../weapons.ts';
import { ADDITIVE, DOUBLE, canvas, lin, roundBox, type T, type Three } from './common.ts';
import { OUTFITS, gunMaterials, outfitMaterials } from './gear.ts';
import { gunMesh, gunModel, type GunModel } from './guns.ts';

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
  /** The kit you wear (sleeves and gloves). */
  kit: string;
};

export type ViewModel = {
  scene: T.Scene;
  camera: T.PerspectiveCamera;
  update(st: ViewState, dt: number, main: T.Camera): void;
  fire(): void;
  /** Where the muzzle is, in the view's own space (add the camera position for the world). */
  muzzle(out: T.Vector3): T.Vector3;
  setEnv(tex: T.Texture | null, intensity: number): void;
  dispose(): void;
};

/** A gloved hand gripping an upright handle at its origin (the handle runs down -y, the gun points -z). */
function gloveGeometry(THREE: Three, side: number, glove: number, knuckle: number, cuff: number) {
  const parts: [T.BufferGeometry, number][] = [];
  const add = (g: T.BufferGeometry, x: number, y: number, z: number, color: number, rx = 0, ry = 0, rz = 0) => {
    if (rx) g.rotateX(rx);
    if (ry) g.rotateY(ry);
    if (rz) g.rotateZ(rz);
    g.translate(x * side, y, z);
    parts.push([g, color]);
  };
  // the back of the hand on the outer side of the handle, knuckle armor along its front edge
  add(roundBox(THREE, 0.03, 0.095, 0.075, 0.35), 0.031, -0.005, 0.008, glove);
  add(roundBox(THREE, 0.016, 0.082, 0.024, 0.35), 0.043, -0.012, -0.03, knuckle);
  for (let k = 0; k < 4; k++) add(roundBox(THREE, 0.012, 0.016, 0.012, 0.4), 0.05, 0.02 - k * 0.022, -0.032, knuckle);
  // fingers: the index along the trigger guard, the rest wrapped round the front of the handle
  add(roundBox(THREE, 0.019, 0.019, 0.052, 0.45), 0.012, 0.03, -0.055, glove);
  for (let k = 0; k < 3; k++) {
    const y = 0.006 - k * 0.022;
    add(roundBox(THREE, 0.036, 0.02, 0.021, 0.45), 0.012, y, -0.034, glove);
    add(roundBox(THREE, 0.02, 0.019, 0.03, 0.45), -0.016, y, -0.018, glove);
    add(roundBox(THREE, 0.017, 0.017, 0.018, 0.45), -0.02, y, 0.004, glove);
  }
  // thumb over the far side, and the cuff
  add(roundBox(THREE, 0.021, 0.021, 0.052, 0.45), -0.014, 0.035, -0.012, glove, 0, 0.35 * side, 0);
  add(new THREE.CylinderGeometry(0.041, 0.039, 0.05, 14), 0.03, 0.052, 0.04, cuff, 0.6);
  // one geometry with vertex colors
  const flat = parts.map(([g, c]) => {
    const f = g.index ? g.toNonIndexed() : g;
    if (f !== g) g.dispose();
    const col = lin(c);
    const n = f.attributes.position.count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) colors.set(col, i * 3);
    f.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return f;
  });
  const total = flat.reduce((s, g) => s + g.attributes.position.count, 0);
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let o = 0;
  for (const g of flat) {
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    nor.set(g.attributes.normal.array as Float32Array, o * 3);
    col.set(g.attributes.color.array as Float32Array, o * 3);
    o += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

/** A sleeve: a tapered tube one meter long along +z (scaled to length), with a rolled cuff ring at the wrist end. */
function sleeveGeometry(THREE: Three) {
  const g = new THREE.CylinderGeometry(0.043, 0.052, 1, 16, 4, true);
  g.translate(0, 0.5, 0);
  g.rotateX(Math.PI / 2);
  const n = g.attributes.position.count;
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  g.setAttribute('aKind', new THREE.BufferAttribute(new Float32Array(n), 1));
  return g;
}

export function viewModel(THREE: Three, sunDir: [number, number, number], sunColor: number, sunIntensity: number): ViewModel {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.01, 20);
  scene.add(camera);
  const sun = new THREE.DirectionalLight(new THREE.Color(...lin(sunColor)), sunIntensity);
  sun.position.set(sunDir[0], sunDir[1], sunDir[2]);
  scene.add(sun);
  scene.add(sun.target);
  const rig = new THREE.Group();
  camera.add(rig);
  const gunMats = gunMaterials(THREE, null);
  const guns = new Map<WeaponId, { group: T.Group; model: GunModel }>();
  const gunFor = (id: WeaponId) => {
    let g = guns.get(id);
    if (!g) {
      const model = gunModel(THREE, id);
      const group = gunMesh(THREE, model, gunMats, false);
      group.visible = false;
      rig.add(group);
      g = { group, model };
      guns.set(id, g);
    }
    return g;
  };

  // arms in the kit you wear: built per kit, swapped when it changes
  const sleeveGeo = sleeveGeometry(THREE);
  type Arms = { fabric: T.Material; hard: T.Material; camo: T.Texture; gloves: T.BufferGeometry[]; meshes: { sleeve: T.Mesh; glove: T.Mesh }[] };
  let arms: Arms | null = null;
  let armsKit = '';
  const buildArms = (kit: string) => {
    if (arms) {
      for (const a of arms.meshes) {
        camera.remove(a.sleeve);
        rig.remove(a.glove);
      }
      arms.fabric.dispose();
      arms.hard.dispose();
      arms.camo.dispose();
      for (const g of arms.gloves) g.dispose();
    }
    const o = OUTFITS[kit] ?? OUTFITS.multicam;
    const mats = outfitMaterials(THREE, null, o.uniform, 77);
    const gloves = [1, -1].map((s) => gloveGeometry(THREE, s, o.gloves, o.knuckles, o.balaclava));
    const meshes = [0, 1].map((i) => {
      const sleeve = new THREE.Mesh(sleeveGeo, mats.fabric);
      const glove = new THREE.Mesh(gloves[i], mats.hard);
      camera.add(sleeve);
      rig.add(glove);
      return { sleeve, glove };
    });
    mats.lens.dispose();
    arms = { fabric: mats.fabric, hard: mats.hard, camo: mats.camo, gloves, meshes };
    armsKit = kit;
  };

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
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), flashMat);
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
  /** Where each elbow sits relative to its wrist, in camera space: below and back, off the bottom of the screen. */
  const elbowOff = [new THREE.Vector3(0.07, -0.2, 0.16), new THREE.Vector3(-0.09, -0.21, 0.14)];
  const elbowOffPistol = [new THREE.Vector3(0.06, -0.19, 0.15), new THREE.Vector3(-0.07, -0.19, 0.15)];
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
      if (st.kit !== armsKit) buildArms(st.kit);
      if (st.gun !== cur) {
        if (cur) gunFor(cur).group.visible = false;
        cur = st.gun;
        if (cur) gunFor(cur).group.visible = true;
      }
      const entry = cur ? gunFor(cur) : null;
      const visible = !!entry && !st.scoped;
      rig.visible = visible;
      if (arms) for (const a of arms.meshes) a.sleeve.visible = visible;
      if (!entry || !cur) return;
      const spec = entry.model;
      const pistol = WEAPONS[cur].cls === 'pistol';
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
      const hip = pistol ? [0.13, -0.11 - spec.sight, -0.36] : [0.165, -0.15 - spec.sight, -0.34];
      const aim = pistol ? [0, -spec.sight, -0.33] : [0, -spec.sight, -0.21];
      const bobX = Math.sin(st.phase * 2.2) * 0.012 * st.speed * still;
      const bobY = -Math.abs(Math.cos(st.phase * 2.2)) * 0.012 * st.speed * still + Math.sin(bobT * 0.9) * 0.002 * still;
      const drop = Math.sin(Math.min(1, st.reload) * Math.PI);
      const sw = st.switching;
      rig.position.set(
        hip[0] + (aim[0] - hip[0]) * ads + bobX + swayX * 0.05 * still,
        hip[1] + (aim[1] - hip[1]) * ads + bobY + swayY * 0.05 * still - drop * 0.07 - sw * 0.32 - (st.air ? 0.012 : 0) - st.crouch * 0.01 * still,
        hip[2] + (aim[2] - hip[2]) * ads + kick * 0.6,
      );
      const recoilK = pistol ? 1.6 : WEAPONS[cur].cls === 'sniper' ? 2.2 : WEAPONS[cur].cls === 'shotgun' ? 2 : 1;
      rig.rotation.set(-kick * 1.4 * recoilK * 0.6 + drop * 0.55 + swayY * 0.4 * still + sw * 0.5, swayX * 0.5 * still + (pistol ? 0.06 : 0.11) * (1 - ads), drop * 0.75 + bobX * 2 + (1 - ads) * 0.05);
      rig.updateMatrix();
      rig.updateMatrixWorld(true);
      flashT -= dt;
      flash.visible = flashT > 0;
      if (flash.visible) {
        flash.position.set(spec.muzzle[0], spec.muzzle[1], spec.muzzle[2] - 0.05);
        flash.rotation.set(0, 0, Math.random() * Math.PI);
        flash.scale.setScalar(0.7 + Math.random() * 0.6);
      }
      if (!arms) return;
      // gloves sit on the grip and the handguard (both on the grip for a pistol), sleeves reach back off screen
      // the support hand: on a vertical grip as on the firing grip, else clamped round the side of the handguard
      const vertical = cur === 'kestrel';
      const hands = [spec.grip, pistol ? [spec.grip[0] - 0.008, spec.grip[1] - 0.008, spec.grip[2] + 0.004] : vertical ? spec.fore : [spec.fore[0] - 0.006, spec.fore[1] + 0.022, spec.fore[2]]];
      const tilt = [pistol || WEAPONS[cur].cls !== 'shotgun' ? -0.3 : -0.1, pistol ? -0.25 : vertical ? 0 : -Math.PI / 2];
      arms.meshes.forEach((a, i) => {
        const h = hands[i];
        a.glove.position.set(h[0], h[1], h[2]);
        a.glove.rotation.set(tilt[i], 0, 0);
        a.glove.updateMatrix();
        // the wrist end of the sleeve, in camera space
        v.set(0.03 * (i === 0 ? 1 : -1), 0.07, 0.07).applyEuler(a.glove.rotation).add(a.glove.position);
        rig.localToWorld(v);
        camera.worldToLocal(v);
        v2.copy((pistol ? elbowOffPistol : elbowOff)[i]);
        const len = v2.length();
        a.sleeve.position.copy(v);
        q.setFromUnitVectors(zAxis, v2.normalize());
        a.sleeve.quaternion.copy(q);
        a.sleeve.scale.set(1, 1, len);
      });
    },
    fire() {
      kick = Math.min(0.06, kick + 0.018);
      kickV += 0.6;
      flashT = 0.045;
    },
    muzzle(out) {
      if (!cur) return out.set(0, 0, 0);
      const m = gunFor(cur).model.muzzle;
      out.set(m[0], m[1], m[2]);
      rig.localToWorld(out);
      return out;
    },
    setEnv(tex, intensity) {
      scene.environment = tex;
      scene.environmentIntensity = intensity;
    },
    dispose() {
      sleeveGeo.dispose();
      if (arms) {
        arms.fabric.dispose();
        arms.hard.dispose();
        arms.camo.dispose();
        for (const g of arms.gloves) g.dispose();
      }
      flashTex.dispose();
      flash.geometry.dispose();
      flashMat.dispose();
      for (const m of Object.values(gunMats)) m.dispose();
    },
  };
}
