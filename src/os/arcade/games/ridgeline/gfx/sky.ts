// The sky dome (gradient, sun halo and disc, a drifting cloud layer) and the environment map baked from it once, which
// lights and reflects on every PBR surface.
import { BACK, COMMON, SKY, type Shared, type T, type Three } from './common.ts';

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
