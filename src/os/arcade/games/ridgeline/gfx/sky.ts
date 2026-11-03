// The sky dome and the environment map baked from it, which lights and reflects on every PBR surface. The sky is a
// photographed one (a Poly Haven sky, turned so its sun stands where the map's sun does) once its image has arrived,
// and until then (or if it never does) the painted gradient, sun halo and drifting cloud layer.
import type { MapId } from '../maps.ts';
import { BACK, COMMON, SKY, lin, type Shared, type T, type Three } from './common.ts';

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

const FRAG = /* glsl */ `
${COMMON}
${SKY}
uniform int uOctaves;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  gl_FragColor = vec4(dzSky(d, cameraPosition, uOctaves), 1.0);
}
`;

/**
 * Each map's sky photo, measured offline from its HDR: the image's column (0 to 1 from the left) where the sun stands,
 * and in units of the image's scale the light the sky alone throws on flat ground (over pi), and the mean colors of
 * the band just above the horizon and of the zenith. The images store x / (1 + x) for x the radiance over that scale,
 * rows from the zenith down to the horizon.
 */
export const SKIES: Record<MapId, { src: string; sunU: number; ambient: [number, number, number]; horizon: [number, number, number]; zenith: [number, number, number] }> = {
  vale: { src: 'sunflowers_puresky', sunU: 0.60046, ambient: [0.4919, 0.5347, 0.5338], horizon: [0.5464, 0.585, 0.5225], zenith: [0.1426, 0.1951, 0.2447] },
  mesa: { src: 'kloofendal_38d_partly_cloudy_puresky', sunU: 0.59988, ambient: [0.5208, 0.5535, 0.6238], horizon: [0.46, 0.4955, 0.5229], zenith: [0.1073, 0.1495, 0.2288] },
  frost: { src: 'table_mountain_1_puresky', sunU: 0.63751, ambient: [0.3793, 0.43, 0.5748], horizon: [1.0654, 1.2609, 1.3211], zenith: [0.1868, 0.2121, 0.3006] },
  isles: { src: 'qwantani_sunset_puresky', sunU: 0.60007, ambient: [0.3509, 0.4651, 0.6663], horizon: [1.5858, 1.1671, 0.781], zenith: [0.1365, 0.2209, 0.3795] },
};

const luma = (c: [number, number, number]) => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;

export function skyDome(THREE: Three, shared: Shared, octaves: number) {
  const mat = new THREE.ShaderMaterial({ uniforms: { ...shared, uOctaves: { value: octaves } }, vertexShader: VERT, fragmentShader: FRAG, side: BACK, depthWrite: false });
  const m = new THREE.Mesh(new THREE.SphereGeometry(1500, 48, 24), mat);
  m.frustumCulled = false;
  m.renderOrder = -10;
  return m;
}

/** Bakes the sky (without the sun disc, which the sun light already covers) into a prefiltered env map. */
export function skyEnv(THREE: Three, renderer: T.WebGLRenderer, shared: Shared) {
  const scene = new THREE.Scene();
  const dome = skyDome(THREE, shared, 4);
  const mat = dome.material as T.ShaderMaterial;
  mat.uniforms = { ...mat.uniforms, uDisc: { value: 0 } };
  scene.add(dome);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(scene, 0, 0.5, 4000);
  pm.dispose();
  dome.geometry.dispose();
  mat.dispose();
  return rt;
}

/**
 * Puts a map's sky photo up: the texture into the shared uniforms, turned so the photo's sun sits at the map's sun
 * azimuth, and scaled to about the brightness of the painted sky it replaces (so the map's sun to sky balance stays
 * close to how it was tuned). The sky colors the custom shaders use for their ambient term follow the photo.
 * Returns the texture (the caller owns it).
 */
export function applySky(THREE: Three, shared: Shared, id: MapId, def: { sky: { zenith: number; horizon: number }; ambient: number }, sun: [number, number, number], img: ImageBitmap, ambientK: number) {
  const s = SKIES[id];
  const tex = new THREE.CanvasTexture(img as unknown as HTMLCanvasElement);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.wrapS = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  // matched to the painted sky's mean light, but where the photo's horizon is far brighter than the painted one (a
  // sunset, a hazy winter sky) only halfway (geometrically) toward that, or the haze washes the far land out
  const skyK = 1.55;
  const zen = lin(def.sky.zenith, skyK);
  const hor = lin(def.sky.horizon, skyK);
  const old: [number, number, number] = [(zen[0] + hor[0] * 2) / 3, (zen[1] + hor[1] * 2) / 3, (zen[2] + hor[2] * 2) / 3];
  const byLight = luma(old) / Math.max(1e-4, luma(s.ambient));
  const k = Math.min(byLight, Math.sqrt(byLight * (luma(hor) / Math.max(1e-4, luma(s.horizon)))));
  shared.uSkyTex.value = tex;
  shared.uSkyScale.value = k;
  (shared.uSkyRot.value as T.Vector2).set(s.sunU, Math.atan2(sun[0], sun[2]));
  shared.uSkyOn.value = 1;
  (shared.uZenith.value as T.Color).setRGB(s.zenith[0] * k, s.zenith[1] * k, s.zenith[2] * k);
  (shared.uHorizon.value as T.Color).setRGB(s.horizon[0] * k, s.horizon[1] * k, s.horizon[2] * k);
  const a = def.ambient * ambientK * k;
  (shared.uAmbient.value as T.Color).setRGB(s.ambient[0] * a, s.ambient[1] * a, s.ambient[2] * a);
  return tex;
}
