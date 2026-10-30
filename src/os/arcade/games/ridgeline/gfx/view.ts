// Puts the whole picture together: renderer, scene, sky light, sun shadows that follow you (snapped to the shadow
// map's texels so their edges never crawl), the soldiers, effects and viewmodel, and the post chain. A governor watches
// the frame time and trims the render scale before frames drop, then raises it again when there is room.
import type { Match } from '../match.ts';
import { me } from '../match.ts';
import { clamp } from '../noise.ts';
import { newHit, rayWorld } from '../physics.ts';
import { T_HALF, T_RES } from '../terrain.ts';
import { ARENA, type World } from '../world.ts';
import { AMBIENT_K, SUN_K, disposeTree, lin, makeShared, type T, type Three } from './common.ts';
import { effects, type Fx } from './fx.ts';
import { Post } from './post.ts';
import { buildings, markers } from './props.ts';
import { skyDome, skyEnv } from './sky.ts';
import { paletteOf, soldiers } from './soldiers.ts';
import { terrainMesh, terrainTextures, waterMesh } from './terrain.ts';
import { vegetation } from './veg.ts';
import { viewModel, type ViewState } from './viewmodel.ts';

export type Quality = 'low' | 'medium' | 'high' | 'ultra';
export const QUALITY: Record<Quality, { dpr: number; scale: number; shadows: number; extent: number; grass: number; trees: number; bloom: boolean; msaa: number; step: number; clouds: number }> = {
  low: { dpr: 1, scale: 0.8, shadows: 0, extent: 0, grass: 0, trees: 0.5, bloom: false, msaa: 0, step: 2, clouds: 2 },
  medium: { dpr: 1.25, scale: 0.9, shadows: 1024, extent: 36, grass: 30000, trees: 0.75, bloom: true, msaa: 0, step: 1, clouds: 3 },
  high: { dpr: 1.5, scale: 1, shadows: 2048, extent: 52, grass: 64000, trees: 1, bloom: true, msaa: 4, step: 1, clouds: 4 },
  ultra: { dpr: 2, scale: 1, shadows: 4096, extent: 70, grass: 110000, trees: 1, bloom: true, msaa: 4, step: 1, clouds: 5 },
};

/** A starting tier from the device; the governor fine tunes from there. */
export function autoQuality(touch: boolean): Quality {
  if (typeof window === 'undefined') return 'medium';
  const small = Math.min(window.screen?.width ?? 1024, window.screen?.height ?? 768) < 600;
  if (touch && small) return 'low';
  if (touch) return 'medium';
  const cores = navigator.hardwareConcurrency ?? 4;
  return cores <= 4 ? 'medium' : 'high';
}

/** Render scale from frame times: slow windows step it down, quick ones step it back up (see Bed Wars' governor). */
class Governor {
  scale: number;
  max: number;
  min = 0.55;
  avg = 1 / 60;
  private sum = 0;
  private n = 0;
  private win = 1.5;
  private trial: { from: number; mean: number } | null = null;
  private cap = 0;
  constructor(max: number) {
    this.max = max;
    this.scale = max;
  }
  frame(dt: number): boolean {
    if (!(dt > 0) || dt > 0.25) return false;
    this.avg += (dt - this.avg) * 0.05;
    this.sum += dt;
    this.n++;
    if (this.sum < this.win) return false;
    const mean = this.sum / this.n;
    this.sum = 0;
    this.n = 0;
    this.win = 1.5;
    if (this.trial) {
      const t = this.trial;
      this.trial = null;
      // dropping the scale did not help: the browser caps the frame rate, so give the pixels back
      if (mean > t.mean * 0.95) {
        this.cap = mean;
        return this.set(t.from, 4);
      }
    }
    if (this.cap && mean < this.cap * 0.8) this.cap = 0;
    const capped = this.cap > 0 && mean < this.cap * 1.15;
    if (mean > 1 / 52 && this.scale > this.min && !capped) {
      this.trial = { from: this.scale, mean };
      return this.set(Math.max(this.min, this.scale - 0.1), 1.2);
    }
    if ((mean < 1 / 58 || capped) && this.scale < this.max) return this.set(Math.min(this.max, this.scale + 0.05), 3);
    return false;
  }
  private set(s: number, win: number) {
    const changed = Math.abs(s - this.scale) > 1e-3;
    this.scale = Math.round(s * 100) / 100;
    this.win = win;
    return changed;
  }
}

export type Frame = {
  m: Match | null;
  dt: number;
  time: number;
  eye: { x: number; y: number; z: number; yaw: number; pitch: number };
  fov: number;
  /** Actor not to draw (the one we look out of), or -1. */
  hide: number;
  vm: ViewState | null;
  fired: boolean;
  damage: number;
  low: number;
  flash: number;
};

export type View = {
  canvas: HTMLCanvasElement;
  camera: T.PerspectiveCamera;
  resize(w: number, h: number): void;
  render(f: Frame): void;
  /** Projects a world point to the canvas (CSS px); z > 1 means behind. */
  project(x: number, y: number, z: number, out: { x: number; y: number; z: number }): void;
  lost(): boolean;
  /** Draw calls and triangles in the last frame, all passes. */
  info(): { calls: number; triangles: number };
  scale(): number;
  fps(): number;
  dispose(): void;
};

export function createView(THREE: Three, host: HTMLElement, w: World, quality: Quality): View | null {
  const Q = QUALITY[quality];
  let renderer: T.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false });
  } catch {
    return null;
  }
  const dpr = Math.min(window.devicePixelRatio || 1, Q.dpr);
  renderer.setPixelRatio(1);
  renderer.toneMapping = 0 as T.ToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = Q.shadows > 0;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.info.autoReset = false;
  const canvas = renderer.domElement;
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.touchAction = 'none';
  canvas.className = 'g-ridgeline-canvas';
  host.appendChild(canvas);
  let isLost = false;
  const onLost = (e: Event) => {
    e.preventDefault();
    isLost = true;
  };
  const onRestored = () => {
    isLost = false;
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  const def = w.def;
  const shared = makeShared(THREE, def, w.sun);
  const tex = terrainTextures(THREE, w);
  shared.uTerrainData.value = tex.data;
  shared.uLight.value = tex.light;
  shared.uShadowRange.value = Q.shadows ? Q.extent * 0.8 : 0;

  const scene = new THREE.Scene();
  const env = skyEnv(THREE, renderer, shared);
  scene.environment = env.texture;
  scene.environmentIntensity = def.ambient * AMBIENT_K;
  const dome = skyDome(THREE, shared, Q.clouds);
  scene.add(dome);
  scene.add(terrainMesh(THREE, w, shared, Q.step));
  if (w.terrain.hasWater) scene.add(waterMesh(THREE, w, shared));
  const veg = vegetation(THREE, w, shared, { grass: Q.grass, treeFrac: Q.trees, shadows: Q.shadows > 0 });
  scene.add(veg.group);
  scene.add(buildings(THREE, w, shared, Q.shadows > 0));
  const mark = markers(THREE, w);
  scene.add(mark.group);
  const troops = soldiers(THREE, shared, 10, Q.shadows > 0);
  scene.add(troops.group);

  // baked sun visibility and occlusion on the CPU, for the gun's lighting and the particles
  const bakedAt = (x: number, z: number, ch: number) => {
    const i = clamp(Math.round((x + T_HALF) / 2), 0, T_RES - 1);
    const j = clamp(Math.round((z + T_HALF) / 2), 0, T_RES - 1);
    return w.light[(j * T_RES + i) * 4 + ch] / 255;
  };
  const fx: Fx = effects(THREE, w, shared, (x, z) => bakedAt(x, z, 0) * bakedAt(x, z, 2));
  scene.add(fx.group);

  const sunDir = new THREE.Vector3(...w.sun);
  const sun = new THREE.DirectionalLight(new THREE.Color(...lin(def.sun.color)), def.sun.intensity * SUN_K);
  sun.castShadow = Q.shadows > 0;
  if (Q.shadows) {
    sun.shadow.mapSize.set(Q.shadows, Q.shadows);
    const c = sun.shadow.camera;
    c.left = -Q.extent;
    c.right = Q.extent;
    c.top = Q.extent;
    c.bottom = -Q.extent;
    c.near = 1;
    c.far = 700;
    c.updateProjectionMatrix();
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.035 * (Q.extent / 50) * (2048 / Q.shadows);
  }
  scene.add(sun);
  scene.add(sun.target);

  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 2600);
  camera.rotation.order = 'YXZ';
  const vm = viewModel(THREE, w.sun, def.sun.color, def.sun.intensity * SUN_K);
  vm.setEnv(env.texture, def.ambient * AMBIENT_K * 1.3);

  const gl = renderer.getContext();
  const floatRT = !!renderer.extensions.has('EXT_color_buffer_float') || !!renderer.extensions.has('EXT_color_buffer_half_float');
  const msaa = Q.msaa && typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext && floatRT ? Q.msaa : 0;
  const post = new Post(THREE, { msaa, bloom: Q.bloom });
  const gov = new Governor(Q.scale);

  let cssW = 1;
  let cssH = 1;
  const applySize = () => {
    renderer.setSize(Math.max(1, Math.round(cssW * dpr)), Math.max(1, Math.round(cssH * dpr)), false);
    post.setSize(cssW * dpr * gov.scale, cssH * dpr * gov.scale);
    camera.aspect = cssW / Math.max(1, cssH);
    camera.updateProjectionMatrix();
    vm.camera.aspect = camera.aspect;
    vm.camera.updateProjectionMatrix();
    fx.setWeather((cssH * dpr * gov.scale) / 900);
  };

  // shadow box basis (fixed with the sun), for snapping
  const sRight = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), sunDir).normalize();
  const sUp = new THREE.Vector3().crossVectors(sunDir, sRight).normalize();
  const focus = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const tmpV = new THREE.Vector3();
  const hit = newHit();
  let occl = 1;
  let occlT = 0;
  let lastHide = -2;

  const muzzleOf = (id: number, out: T.Vector3) => {
    if (id === lastHide) return vm.muzzle(out).add(camera.position);
    return troops.muzzle(id, out);
  };

  /** Warms every shader up so the first frames of a round do not stall on compiles. */
  const warm = () => {
    try {
      renderer.compile(scene, camera);
      renderer.compile(vm.scene, vm.camera);
    } catch {
      /* compile errors show up on the first render instead */
    }
  };
  warm();

  let fpsAvg = 60;
  const lastInfo = { calls: 0, triangles: 0 };
  return {
    canvas,
    camera,
    resize(wpx, hpx) {
      cssW = Math.max(1, wpx);
      cssH = Math.max(1, hpx);
      applySize();
    },
    project(x, y, z, out) {
      tmpV.set(x, y, z).project(camera);
      out.x = (tmpV.x * 0.5 + 0.5) * cssW;
      out.y = (-tmpV.y * 0.5 + 0.5) * cssH;
      out.z = tmpV.z;
    },
    lost: () => isLost,
    info: () => ({ calls: lastInfo.calls, triangles: lastInfo.triangles }),
    scale: () => gov.scale,
    fps: () => fpsAvg,
    render(f) {
      if (isLost) return;
      lastInfo.calls = renderer.info.render.calls;
      lastInfo.triangles = renderer.info.render.triangles;
      renderer.info.reset();
      if (f.dt > 0) fpsAvg += (1 / Math.max(f.dt, 1 / 240) - fpsAvg) * 0.05;
      const pinned = import.meta.env.DEV && typeof window !== 'undefined' && (window as unknown as { __rlPin?: boolean }).__rlPin;
      if (!pinned && gov.frame(f.dt)) applySize();
      shared.uTime.value = f.time;
      lastHide = f.hide;
      camera.position.set(f.eye.x, f.eye.y, f.eye.z);
      camera.rotation.set(f.eye.pitch, f.eye.yaw, 0, 'YXZ');
      if (Math.abs(camera.fov - f.fov) > 1e-3) {
        camera.fov = f.fov;
        camera.updateProjectionMatrix();
      }
      camera.updateMatrixWorld();
      dome.position.copy(camera.position);
      // the shadow box sits a little ahead of where you look, snapped to its texels
      if (Q.shadows) {
        veg.casters(camera.position.x, camera.position.z);
        camera.getWorldDirection(fwd);
        fwd.y = 0;
        fwd.normalize();
        focus.copy(camera.position).addScaledVector(fwd, Q.extent * 0.4);
        const texel = (2 * Q.extent) / Q.shadows;
        const u = Math.round(focus.dot(sRight) / texel) * texel;
        const v = Math.round(focus.dot(sUp) / texel) * texel;
        const d = focus.dot(sunDir);
        focus.copy(sRight).multiplyScalar(u).addScaledVector(sUp, v).addScaledVector(sunDir, d);
        sun.target.position.copy(focus);
        sun.position.copy(focus).addScaledVector(sunDir, 350);
        sun.target.updateMatrixWorld();
        sun.updateMatrixWorld();
      }
      const m = f.m;
      if (m) {
        troops.update(m, f.hide, m.time);
        const you = me(m);
        mark.update({ site: m.site, live: m.mode === 'uplink' && (m.phase === 'live' || m.phase === 'buy'), barrier: m.mode === 'uplink' && m.phase === 'buy', fill: m.cap, team: you.team, time: f.time });
        fx.update(m, f.dt, camera, muzzleOf, f.hide);
      } else mark.update({ site: 0, live: false, barrier: false, fill: [0, 0], team: 0, time: f.time });
      // the gun's light: in the open sun or under cover, how much sky it sees
      occlT -= f.dt;
      if (occlT <= 0) {
        occlT = 0.12;
        rayWorld(w, camera.position.x, camera.position.y, camera.position.z, sunDir.x, sunDir.y, sunDir.z, 200, hit);
        const inside = w.interiors.some((q) => camera.position.x > q.x0 && camera.position.x < q.x1 && camera.position.z > q.z0 && camera.position.z < q.z1 && camera.position.y < q.y1);
        occl = hit.kind === 'none' ? 1 : 0;
        if (inside) occl = 0;
      }
      const sunVis = bakedAt(camera.position.x, camera.position.z, 0) * occl;
      const ao = bakedAt(camera.position.x, camera.position.z, 1);
      let vmPair: { scene: T.Scene; camera: T.Camera } | null = null;
      if (f.vm && f.vm.gun) {
        vm.update({ ...f.vm, sun: sunVis, ambient: def.ambient * AMBIENT_K * 1.3 * (0.45 + 0.55 * ao) * (occl > 0 ? 1 : 0.7) }, f.dt, camera);
        if (f.fired) vm.fire();
        vmPair = { scene: vm.scene, camera: vm.camera };
      }
      const smoke = m ? fx.smokeAt(camera.position.x, camera.position.y, camera.position.z, m) : 0;
      const g = def.grade;
      const smokeTint = lin(0xd0d2d4, 0.9);
      post.render(
        renderer,
        scene,
        camera,
        vmPair,
        {
          exposure: g.exposure,
          bloom: g.bloom,
          sat: g.saturation,
          contrast: g.contrast,
          tint: g.tint,
          vignette: g.vignette,
          damage: f.damage,
          low: f.low,
          smoke: Math.min(0.92, smoke * 1.3),
          smokeColor: smokeTint,
          flash: f.flash,
          time: f.time,
        },
        0.35 + (1 - gov.scale) * 1.4,
      );
    },
    dispose() {
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      veg.dispose();
      vm.dispose();
      post.dispose();
      env.dispose();
      disposeTree(scene);
      tex.data.dispose();
      tex.light.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}

/** The flyover behind the start card: a slow circle high over the arena, looking in. */
export function flyover(t: number, w: World) {
  const a = t * 0.045;
  const r = ARENA * 0.95;
  const x = Math.sin(a) * r;
  const z = Math.cos(a) * r;
  const c = w.sites[1];
  const y = Math.max(c.y, 10) + 42 + Math.sin(t * 0.13) * 6;
  const dx = c.x - x;
  const dz = c.z - z;
  return { x, y, z, yaw: Math.atan2(-dx, -dz), pitch: -0.2 };
}

export { paletteOf };
