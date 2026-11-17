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
export type SkyPhoto = { src: string; sunU: number; ambient: [number, number, number]; horizon: [number, number, number]; zenith: [number, number, number] };
export const SKIES: Record<MapId, SkyPhoto> = {
  vale: { src: 'sunflowers_puresky', sunU: 0.60046, ambient: [0.4919, 0.5347, 0.5338], horizon: [0.5464, 0.585, 0.5225], zenith: [0.1426, 0.1951, 0.2447] },
  mesa: { src: 'kloofendal_38d_partly_cloudy_puresky', sunU: 0.59988, ambient: [0.5208, 0.5535, 0.6238], horizon: [0.46, 0.4955, 0.5229], zenith: [0.1073, 0.1495, 0.2288] },
  frost: { src: 'table_mountain_1_puresky', sunU: 0.63751, ambient: [0.3793, 0.43, 0.5748], horizon: [1.0654, 1.2609, 1.3211], zenith: [0.1868, 0.2121, 0.3006] },
  isles: { src: 'qwantani_sunset_puresky', sunU: 0.60007, ambient: [0.3509, 0.4651, 0.6663], horizon: [1.5858, 1.1671, 0.781], zenith: [0.1365, 0.2209, 0.3795] },
};

/** The same for the royale's other times of day (see looks.ts), measured the same way. */
export const LOOK_SKIES: Record<MapId, Record<'dusk' | 'overcast', SkyPhoto>> = {
  vale: {
    dusk: { src: 'kloppenheim_06_puresky', sunU: 0.6073, ambient: [0.3688, 0.4689, 0.6233], horizon: [0.5993, 0.5246, 0.4736], zenith: [0.1286, 0.2011, 0.3408] },
    overcast: { src: 'kloofendal_overcast_puresky', sunU: 0.58191, ambient: [0.3621, 0.3948, 0.4631], horizon: [0.2178, 0.2345, 0.2622], zenith: [0.2839, 0.3307, 0.4146] },
  },
  mesa: {
    dusk: { src: 'rocky_ridge_puresky', sunU: 0.63904, ambient: [0.4594, 0.5253, 0.7213], horizon: [1.3856, 1.127, 0.8505], zenith: [0.1739, 0.2271, 0.3892] },
    overcast: { src: 'overcast_soil_puresky', sunU: 0.4679, ambient: [0.3215, 0.3209, 0.3203], horizon: [0.1685, 0.1597, 0.1485], zenith: [0.3983, 0.3976, 0.3976] },
  },
  frost: {
    dusk: { src: 'drackenstein_quarry_puresky', sunU: 0.60022, ambient: [0.4171, 0.4265, 0.4393], horizon: [1.0062, 0.7501, 0.4863], zenith: [0.1829, 0.2102, 0.2582] },
    overcast: { src: 'snow_field_puresky', sunU: 0.61975, ambient: [0.3625, 0.3662, 0.3565], horizon: [0.2824, 0.2794, 0.2643], zenith: [0.324, 0.3262, 0.3201] },
  },
  isles: {
    dusk: { src: 'qwantani_dusk_2_puresky', sunU: 0.59021, ambient: [0.4782, 0.4335, 0.6407], horizon: [0.5964, 0.361, 0.402], zenith: [0.2305, 0.2663, 0.4692] },
    overcast: { src: 'mud_road_puresky', sunU: 0.25476, ambient: [0.3003, 0.3089, 0.3515], horizon: [0.1761, 0.1769, 0.1884], zenith: [0.3673, 0.3769, 0.4439] },
  },
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
 * `photo` is another time of day's (LOOK_SKIES). Returns the texture (the caller owns it).
 */
export function applySky(THREE: Three, shared: Shared, id: MapId, def: { sky: { zenith: number; horizon: number }; ambient: number }, sun: [number, number, number], img: ImageBitmap, ambientK: number, photo: SkyPhoto = SKIES[id]) {
  const s = photo;
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
