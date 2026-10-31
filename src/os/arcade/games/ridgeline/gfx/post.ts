// The frame after the scene: HDR scene buffer (multisampled where the GPU can), a dual filter bloom at low
// resolutions, then one composite pass: filmic tone mapping, per map color grading, contrast adaptive sharpening (so a
// lower render scale still looks crisp), FXAA when there is no MSAA, vignette, grain and the damage and smoke washes.
import { CLAMP, HALF_FLOAT, NO_SPACE, type T, type Three } from './common.ts';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const PREFILTER = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uThreshold;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv + uTexel * vec2(-0.5, -0.5)).rgb + texture2D(tSrc, vUv + uTexel * vec2(0.5, -0.5)).rgb
         + texture2D(tSrc, vUv + uTexel * vec2(-0.5, 0.5)).rgb + texture2D(tSrc, vUv + uTexel * vec2(0.5, 0.5)).rgb;
  c *= 0.25;
  float l = max(c.r, max(c.g, c.b));
  float knee = uThreshold * 0.5;
  float soft = clamp(l - uThreshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-4);
  float w = max(soft, l - uThreshold) / max(l, 1e-4);
  gl_FragColor = vec4(min(c * w, vec3(40.0)), 1.0);
}
`;

const DOWN = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb * 4.0;
  c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  gl_FragColor = vec4(c / 8.0, 1.0);
}
`;

const UP = /* glsl */ `
uniform sampler2D tSrc;
uniform sampler2D tLow;
uniform vec2 uTexel;
uniform float uMix;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tLow, vUv + uTexel * vec2(-1.0, 0.0)).rgb * 2.0;
  c += texture2D(tLow, vUv + uTexel * vec2(1.0, 0.0)).rgb * 2.0;
  c += texture2D(tLow, vUv + uTexel * vec2(0.0, -1.0)).rgb * 2.0;
  c += texture2D(tLow, vUv + uTexel * vec2(0.0, 1.0)).rgb * 2.0;
  c += texture2D(tLow, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  c += texture2D(tLow, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  c += texture2D(tLow, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
  c += texture2D(tLow, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  c += texture2D(tLow, vUv).rgb * 4.0;
  c /= 16.0;
  gl_FragColor = vec4(texture2D(tSrc, vUv).rgb + c * uMix, 1.0);
}
`;

const COMPOSITE = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform vec2 uTexel;
uniform float uExposure;
uniform float uBloom;
uniform float uSat;
uniform float uContrast;
uniform vec3 uTint;
uniform float uVignette;
uniform float uSharp;
uniform float uFxaa;
uniform float uGrain;
uniform float uTime;
uniform float uDamage;
uniform float uLow;
uniform float uSmoke;
uniform vec3 uSmokeColor;
uniform float uFlash;
varying vec2 vUv;

const mat3 ACESIn = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
const mat3 ACESOut = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
vec3 rrt(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 aces(vec3 c) {
  c = ACESIn * c;
  c = rrt(c);
  c = ACESOut * c;
  return clamp(c, 0.0, 1.0);
}
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec2 uv = vUv;
  vec3 c = texture2D(tScene, uv).rgb;
  vec3 n = texture2D(tScene, uv + vec2(0.0, -uTexel.y)).rgb;
  vec3 s = texture2D(tScene, uv + vec2(0.0, uTexel.y)).rgb;
  vec3 e = texture2D(tScene, uv + vec2(uTexel.x, 0.0)).rgb;
  vec3 w = texture2D(tScene, uv + vec2(-uTexel.x, 0.0)).rgb;
  if (uFxaa > 0.5) {
    // a light FXAA: blend across the edge where luma changes sharply
    float lc = luma(c), ln = luma(n), ls = luma(s), le = luma(e), lw = luma(w);
    float lmin = min(lc, min(min(ln, ls), min(le, lw)));
    float lmax = max(lc, max(max(ln, ls), max(le, lw)));
    float range = lmax - lmin;
    if (range > max(0.04, lmax * 0.12)) {
      // blur along the edge: perpendicular to the luma gradient (le - lw, ls - ln)
      vec2 dir = vec2(ln - ls, le - lw);
      float red = max((ln + ls + le + lw) * 0.03125, 0.0078125);
      float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + red);
      dir = clamp(dir * rcp, vec2(-8.0), vec2(8.0)) * uTexel;
      vec3 a = 0.5 * (texture2D(tScene, uv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tScene, uv + dir * (2.0 / 3.0 - 0.5)).rgb);
      vec3 b = a * 0.5 + 0.25 * (texture2D(tScene, uv - dir * 0.5).rgb + texture2D(tScene, uv + dir * 0.5).rgb);
      float lb = luma(b);
      c = (lb < lmin || lb > lmax) ? a : b;
    }
  }
  // contrast adaptive sharpening
  vec3 mn = min(c, min(min(n, s), min(e, w)));
  vec3 mx = max(c, max(max(n, s), max(e, w)));
  vec3 amp = clamp(min(mn, 2.0 - mx) / max(mx, vec3(1e-4)), 0.0, 1.0);
  vec3 wgt = -sqrt(amp) * uSharp * 0.2;
  c = max(vec3(0.0), (c + (n + s + e + w) * wgt) / (1.0 + 4.0 * wgt));
  c += texture2D(tBloom, uv).rgb * uBloom;
  c = mix(c, uSmokeColor, uSmoke);
  c *= uExposure / 0.6;
  c = aces(c * uTint);
  c = toSRGB(c);
  float l = luma(c);
  c = mix(vec3(l), c, uSat * (1.0 - uLow * 0.6));
  c = (c - 0.5) * uContrast + 0.5;
  vec2 d = uv - 0.5;
  float vig = 1.0 - dot(d, d) * uVignette * 2.2;
  c *= vig;
  float edge = smoothstep(0.25, 0.75, length(d));
  c = mix(c, vec3(0.55, 0.02, 0.02), uDamage * edge * 0.75);
  c = mix(c, c * vec3(1.0, 0.75, 0.75), uLow * edge);
  c += uFlash;
  c += (hash(uv * 1000.0 + uTime) - 0.5) * uGrain;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;

export type PostParams = { exposure: number; bloom: number; sat: number; contrast: number; tint: [number, number, number]; vignette: number; damage: number; low: number; smoke: number; smokeColor: [number, number, number]; flash: number; time: number };

export class Post {
  rt: T.WebGLRenderTarget;
  private down: T.WebGLRenderTarget[] = [];
  private up: T.WebGLRenderTarget[] = [];
  private scene: T.Scene;
  private cam: T.OrthographicCamera;
  private quad: T.Mesh;
  private pre: T.ShaderMaterial;
  private dn: T.ShaderMaterial;
  private upM: T.ShaderMaterial;
  private comp: T.ShaderMaterial;
  private bloomOn: boolean;
  private msaa: number;
  w = 1;
  h = 1;

  constructor(THREE: Three, opts: { msaa: number; bloom: boolean }) {
    this.bloomOn = opts.bloom;
    this.msaa = opts.msaa;
    const mk = () => {
      const t = new THREE.WebGLRenderTarget(4, 4, { type: HALF_FLOAT, depthBuffer: false });
      t.texture.minFilter = THREE.LinearFilter;
      t.texture.magFilter = THREE.LinearFilter;
      t.texture.wrapS = t.texture.wrapT = CLAMP;
      t.texture.generateMipmaps = false;
      t.texture.colorSpace = NO_SPACE;
      return t;
    };
    this.rt = new THREE.WebGLRenderTarget(4, 4, { type: HALF_FLOAT, depthBuffer: true, samples: opts.msaa });
    this.rt.texture.minFilter = THREE.LinearFilter;
    this.rt.texture.magFilter = THREE.LinearFilter;
    this.rt.texture.generateMipmaps = false;
    this.rt.texture.colorSpace = NO_SPACE;
    if (opts.bloom) {
      for (let i = 0; i < 5; i++) this.down.push(mk());
      for (let i = 0; i < 4; i++) this.up.push(mk());
    }
    const sm = (frag: string, uniforms: Record<string, T.IUniform>) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
    this.pre = sm(PREFILTER, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.6 } });
    this.dn = sm(DOWN, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.upM = sm(UP, { tSrc: { value: null }, tLow: { value: null }, uTexel: { value: new THREE.Vector2() }, uMix: { value: 1 } });
    this.comp = sm(COMPOSITE, {
      tScene: { value: this.rt.texture },
      tBloom: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uExposure: { value: 1 },
      uBloom: { value: 0.6 },
      uSat: { value: 1 },
      uContrast: { value: 1 },
      uTint: { value: new THREE.Vector3(1, 1, 1) },
      uVignette: { value: 0.3 },
      uSharp: { value: 0.5 },
      uFxaa: { value: opts.msaa > 0 ? 0 : 1 },
      uGrain: { value: 0.012 },
      uTime: { value: 0 },
      uDamage: { value: 0 },
      uLow: { value: 0 },
      uSmoke: { value: 0 },
      uSmokeColor: { value: new THREE.Vector3(0.6, 0.6, 0.6) },
      uFlash: { value: 0 },
    });
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.comp);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  get samples() {
    return this.msaa;
  }

  /** Render size in device pixels. */
  /** Turns the bloom off (to save its passes) or back on, where it was built at all. */
  setBloom(on: boolean) {
    this.bloomOn = on && this.down.length > 0;
  }
  setSize(w: number, h: number) {
    w = Math.max(2, Math.round(w));
    h = Math.max(2, Math.round(h));
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.rt.setSize(w, h);
    let bw = Math.max(1, w >> 1);
    let bh = Math.max(1, h >> 1);
    for (let i = 0; i < this.down.length; i++) {
      this.down[i].setSize(bw, bh);
      if (i < this.up.length) this.up[i].setSize(bw, bh);
      bw = Math.max(1, bw >> 1);
      bh = Math.max(1, bh >> 1);
    }
  }

  private pass(r: T.WebGLRenderer, mat: T.ShaderMaterial, target: T.WebGLRenderTarget | null) {
    this.quad.material = mat;
    r.setRenderTarget(target);
    r.render(this.scene, this.cam);
  }

  render(r: T.WebGLRenderer, scene: T.Scene, camera: T.Camera, vm: { scene: T.Scene; camera: T.Camera } | null, p: PostParams, sharp: number) {
    r.setRenderTarget(this.rt);
    r.clear(true, true, false);
    r.render(scene, camera);
    if (vm) {
      const auto = r.autoClear;
      r.autoClear = false;
      r.clearDepth();
      r.render(vm.scene, vm.camera);
      r.autoClear = auto;
    }
    const c = this.comp.uniforms;
    if (this.bloomOn && this.down.length) {
      const pu = this.pre.uniforms;
      pu.tSrc.value = this.rt.texture;
      (pu.uTexel.value as T.Vector2).set(1 / this.w, 1 / this.h);
      this.pass(r, this.pre, this.down[0]);
      for (let i = 1; i < this.down.length; i++) {
        const src = this.down[i - 1];
        this.dn.uniforms.tSrc.value = src.texture;
        (this.dn.uniforms.uTexel.value as T.Vector2).set(1 / src.width, 1 / src.height);
        this.pass(r, this.dn, this.down[i]);
      }
      let low = this.down[this.down.length - 1];
      for (let i = this.up.length - 1; i >= 0; i--) {
        const u = this.upM.uniforms;
        u.tSrc.value = this.down[i].texture;
        u.tLow.value = low.texture;
        (u.uTexel.value as T.Vector2).set(1 / low.width, 1 / low.height);
        this.pass(r, this.upM, this.up[i]);
        low = this.up[i];
      }
      c.tBloom.value = this.up[0].texture;
      c.uBloom.value = p.bloom * 0.12;
    } else {
      c.tBloom.value = this.rt.texture;
      c.uBloom.value = 0;
    }
    (c.uTexel.value as T.Vector2).set(1 / this.w, 1 / this.h);
    c.uExposure.value = p.exposure;
    c.uSat.value = p.sat;
    c.uContrast.value = p.contrast;
    (c.uTint.value as T.Vector3).set(...p.tint);
    c.uVignette.value = p.vignette;
    c.uSharp.value = sharp;
    c.uTime.value = p.time % 100;
    c.uDamage.value = p.damage;
    c.uLow.value = p.low;
    c.uSmoke.value = p.smoke;
    (c.uSmokeColor.value as T.Vector3).set(...p.smokeColor);
    c.uFlash.value = p.flash;
    this.pass(r, this.comp, null);
  }

  dispose() {
    this.rt.dispose();
    for (const t of [...this.down, ...this.up]) t.dispose();
    for (const m of [this.pre, this.dn, this.upM, this.comp]) m.dispose();
    this.quad.geometry.dispose();
  }
}
