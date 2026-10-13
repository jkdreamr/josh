// Models built in code: the atlas texture, items as extruded pixel sprites (like Minecraft draws them in hand and
// on the ground), little block cubes, and blocky players with team colored leather, armor tiers and name tags.
import { ATLAS_TILES, BLOCKS, TEAMS } from './blocks.ts';
import { buildAtlas, ATLAS_PX } from './atlas.ts';
import { tileUV } from './mesher.ts';
import { NEAREST, NEAREST_MIP_LINEAR, type T, type Three } from './gl.ts';

const LIN = (v: number) => Math.pow(v, 2.2);

export function atlasTexture(THREE: Three): T.CanvasTexture {
  const { canvas, mips } = buildAtlas();
  const tex = new THREE.CanvasTexture(canvas);
  tex.mipmaps = mips as unknown as T.CanvasTexture['mipmaps'];
  tex.generateMipmaps = false;
  tex.magFilter = NEAREST;
  tex.minFilter = NEAREST_MIP_LINEAR;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 1;
  tex.needsUpdate = true;
  return tex;
}

let atlasData: ImageData | null = null;
function atlasPixels(): ImageData {
  if (atlasData) return atlasData;
  const { canvas } = buildAtlas();
  atlasData = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, ATLAS_PX, ATLAS_PX);
  return atlasData;
}

/** An item sprite pushed out to 1/16 thick: front and back quads plus a side wall around every opaque pixel. */
export function spriteGeometry(THREE: Three, tile: number): T.BufferGeometry {
  const img = atlasPixels();
  const tx = (tile % ATLAS_TILES) * 16;
  const ty = Math.floor(tile / ATLAS_TILES) * 16;
  const alpha = (x: number, y: number) => (x < 0 || y < 0 || x > 15 || y > 15 ? 0 : img.data[((ty + y) * ATLAS_PX + tx + x) * 4 + 3]);
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const [u0, v0, u1, v1] = tileUV(tile);
  const th = 1 / 32;
  const quad = (p: number[][], uvs: number[][], c: number) => {
    const b = pos.length / 3;
    for (let k = 0; k < 4; k++) {
      pos.push(p[k][0], p[k][1], p[k][2]);
      uv.push(uvs[k][0], uvs[k][1]);
      const l = LIN(c);
      col.push(l, l, l);
    }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  quad(
    [
      [-0.5, -0.5, th],
      [0.5, -0.5, th],
      [0.5, 0.5, th],
      [-0.5, 0.5, th],
    ],
    [
      [u0, v0],
      [u1, v0],
      [u1, v1],
      [u0, v1],
    ],
    1,
  );
  quad(
    [
      [0.5, -0.5, -th],
      [-0.5, -0.5, -th],
      [-0.5, 0.5, -th],
      [0.5, 0.5, -th],
    ],
    [
      [u1, v0],
      [u0, v0],
      [u0, v1],
      [u1, v1],
    ],
    0.8,
  );
  const du = (u1 - u0) / 16;
  const dv = (v1 - v0) / 16;
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      if (alpha(x, y) < 128) continue;
      const x0 = -0.5 + x / 16;
      const x1 = x0 + 1 / 16;
      const y1 = 0.5 - y / 16;
      const y0 = y1 - 1 / 16;
      const cu = u0 + (x + 0.5) * du;
      const cv = v1 - (y + 0.5) * dv;
      const flat = [
        [cu, cv],
        [cu, cv],
        [cu, cv],
        [cu, cv],
      ];
      if (alpha(x - 1, y) < 128)
        quad(
          [
            [x0, y0, -th],
            [x0, y0, th],
            [x0, y1, th],
            [x0, y1, -th],
          ],
          flat,
          0.65,
        );
      if (alpha(x + 1, y) < 128)
        quad(
          [
            [x1, y0, th],
            [x1, y0, -th],
            [x1, y1, -th],
            [x1, y1, th],
          ],
          flat,
          0.75,
        );
      if (alpha(x, y - 1) < 128)
        quad(
          [
            [x0, y1, th],
            [x1, y1, th],
            [x1, y1, -th],
            [x0, y1, -th],
          ],
          flat,
          0.95,
        );
      if (alpha(x, y + 1) < 128)
        quad(
          [
            [x0, y0, -th],
            [x1, y0, -th],
            [x1, y0, th],
            [x0, y0, th],
          ],
          flat,
          0.55,
        );
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** A unit block cube centered on the origin with its atlas tiles and Minecraft face shading. */
export function cubeGeometry(THREE: Three, block: number, tiles?: [number, number, number]): T.BufferGeometry {
  const b = BLOCKS[block];
  const [top, bottom, side] = tiles ?? b.tex;
  const g = new THREE.BoxGeometry(1, 1, 1);
  const uv = g.getAttribute('uv') as T.BufferAttribute;
  const faceTiles = [side, side, top, bottom, side, side];
  const shade = [0.8, 0.6, 1, 0.5, 0.86, 0.66];
  const col: number[] = [];
  for (let f = 0; f < 6; f++) {
    const [u0, v0, u1, v1] = tileUV(faceTiles[f]);
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      const u = uv.getX(i);
      const v = uv.getY(i);
      uv.setXY(i, u0 + (u1 - u0) * u, v0 + (v1 - v0) * v);
      const l = LIN(shade[f]);
      col.push(l, l, l);
    }
  }
  uv.needsUpdate = true;
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

// ---------------------------------------------------------------------------------------------------------------
// Players

/** Skins: the default hoodie, then the ones you unlock. */
export const SKINS = ['Hoodie', 'Coxswain', 'Lab Coat', 'The Tree', 'Marching Band', 'Founder'] as const;

const shadeHex = (hex: string, k: number) => {
  const v = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((v >> 16) & 255) * k);
  const g = Math.min(255, ((v >> 8) & 255) * k);
  const b = Math.min(255, (v & 255) * k);
  return `rgb(${r | 0},${g | 0},${b | 0})`;
};

/** Paints a 64x64 Minecraft-layout skin. */
export function paintSkin(skin: number, team: number, seed: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  let s = (seed * 2654435761) >>> 0 || 7;
  const r = () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
  const tones = ['#f1c7a3', '#e0ac85', '#c68a62', '#a5704a', '#7c5236', '#f4d3b8'];
  const hairs = ['#2b1d14', '#5a3b22', '#1a1a1a', '#8a5a2b', '#d6b26a', '#3a2a20'];
  const skinC = tones[Math.floor(r() * tones.length)];
  const hair = hairs[Math.floor(r() * hairs.length)];
  const team0 = TEAMS[team].color;
  const rect = (x: number, y: number, w: number, h: number, col: string) => {
    g.fillStyle = col;
    g.fillRect(x, y, w, h);
  };
  const noise = (x: number, y: number, w: number, h: number, col: string, k = 0.08) => {
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++) {
        rect(xx, yy, 1, 1, shadeHex(col, 1 - k + r() * k * 2));
      }
  };
  // head: all six faces in skin, then hair and a face
  noise(0, 0, 32, 16, skinC, 0.04);
  rect(8, 0, 8, 8, hair);
  rect(0, 8, 8, 3, hair);
  rect(16, 8, 8, 3, hair);
  rect(24, 8, 8, 8, hair);
  rect(8, 8, 8, 2, hair);
  rect(8, 10, 1, 1, hair);
  rect(15, 10, 1, 1, hair);
  // eyes and mouth on the front (8..16, 8..16)
  rect(9, 12, 2, 1, '#ffffff');
  rect(13, 12, 2, 1, '#ffffff');
  rect(10, 12, 1, 1, '#2d4a7a');
  rect(13, 12, 1, 1, '#2d4a7a');
  rect(11, 14, 2, 1, shadeHex(skinC, 0.75));
  // body, arms, legs
  const shirt = skin === 1 ? team0 : skin === 2 ? '#f4f4f4' : skin === 3 ? '#2f7a2c' : skin === 4 ? '#8c1515' : skin === 5 ? '#23262b' : team0;
  const pants = skin === 1 ? team0 : skin === 2 ? '#3a4a5c' : skin === 3 ? '#2f7a2c' : skin === 4 ? '#f4f4f4' : skin === 5 ? '#23262b' : '#3b4a6b';
  const shoe = skin === 3 ? '#5e4528' : '#2a2a2a';
  noise(16, 16, 24, 16, shirt);
  noise(40, 16, 16, 16, shirt);
  noise(32, 48, 16, 16, shirt);
  noise(0, 16, 16, 16, pants);
  noise(16, 48, 16, 16, pants);
  // hands
  rect(44, 28, 8, 4, skinC);
  rect(40, 28, 4, 4, skinC);
  rect(52, 28, 4, 4, skinC);
  rect(36, 60, 8, 4, skinC);
  rect(32, 60, 4, 4, skinC);
  rect(44, 60, 4, 4, skinC);
  // shoes
  rect(0, 29, 16, 3, shoe);
  rect(16, 61, 16, 3, shoe);
  if (skin === 0) {
    // hoodie: a lighter front pocket and drawstrings
    rect(21, 26, 6, 3, shadeHex(team0, 0.82));
    rect(22, 20, 1, 3, '#f4f4f4');
    rect(25, 20, 1, 3, '#f4f4f4');
  } else if (skin === 1) {
    // the coxswain: a unisuit with a white stripe and a cap
    rect(20, 20, 8, 1, '#ffffff');
    rect(20, 24, 8, 1, '#ffffff');
    rect(8, 0, 8, 8, team0);
    rect(0, 8, 32, 2, team0);
    rect(9, 13, 6, 1, '#333');
  } else if (skin === 2) {
    // lab coat over a cardinal tie
    rect(23, 20, 2, 8, '#8c1515');
    rect(20, 20, 1, 12, '#d8d8d8');
    rect(27, 20, 1, 12, '#d8d8d8');
  } else if (skin === 3) {
    // the Tree: branches all over
    for (let i = 0; i < 40; i++) rect(Math.floor(r() * 64), 16 + Math.floor(r() * 48), 1, 1, r() < 0.5 ? '#4fa246' : '#1f5a1d');
    rect(8, 0, 8, 8, '#2f7a2c');
    rect(0, 8, 32, 3, '#2f7a2c');
  } else if (skin === 4) {
    // band: white trousers, a cardinal jacket with gold buttons
    for (const y of [21, 24, 27]) rect(23, y, 2, 1, '#f5d23a');
  } else if (skin === 5) {
    // founder: black turtleneck and round glasses
    rect(9, 12, 2, 1, '#111');
    rect(13, 12, 2, 1, '#111');
    rect(11, 12, 2, 1, '#555');
  }
  return c;
}

/** The six faces of a box get the Minecraft skin regions for a box at (u, v) of size w x h x d pixels. */
function skinBox(THREE: Three, w: number, h: number, d: number, u: number, v: number, inflate = 0, texW = 64, texH = 64): T.BoxGeometry {
  const px = 1 / 16;
  const g = new THREE.BoxGeometry((w + inflate * 2) * px, (h + inflate * 2) * px, (d + inflate * 2) * px);
  const uv = g.getAttribute('uv') as T.BufferAttribute;
  // three.js order: +x, -x, +y, -y, +z, -z. For a model facing +z: +x is its left side, -x its right.
  const rects: [number, number, number, number][] = [
    [u + d + w, v + d, d, h],
    [u, v + d, d, h],
    [u + d, v, w, d],
    [u + d + w, v, w, d],
    [u + d, v + d, w, h],
    [u + d + w + d, v + d, w, h],
  ];
  const shade = [0.78, 0.78, 1, 0.55, 0.92, 0.7];
  const col: number[] = [];
  for (let f = 0; f < 6; f++) {
    const [rx, ry, rw, rh] = rects[f];
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      const fu = uv.getX(i);
      const fv = uv.getY(i);
      uv.setXY(i, (rx + fu * rw) / texW, 1 - (ry + (1 - fv) * rh) / texH);
      const l = LIN(shade[f]);
      col.push(l, l, l);
    }
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/**
 * Armor textures in Minecraft's armor layout (64x32): dyed leather, chainmail, iron, diamond. The helmet leaves the
 * face open and the sleeves stop above the elbow, so skins still show.
 */
function armorCanvas(kind: number, team: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 32;
  const g = c.getContext('2d')!;
  const base = kind === 0 ? TEAMS[team].color : kind === 1 ? '#8f8f8f' : kind === 2 ? '#d8d8d8' : '#4fe0d6';
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 64; x++) {
      let k = 0.88 + (((x * 7 + y * 13) % 5) / 5) * 0.16;
      if (kind === 1 && (x + y) % 2 === 0) k = 0.55;
      if (kind === 0 && (x % 8 === 0 || y % 8 === 0)) k *= 0.82;
      if (kind >= 2 && (x % 4 === 0 || y % 6 === 0)) k *= 0.85;
      g.fillStyle = shadeHex(base, k);
      g.fillRect(x, y, 1, 1);
    }
  // the helmet's face opening (front face is x 8..16, y 8..16)
  g.clearRect(9, 11, 6, 5);
  // sleeves end above the elbow (arm faces are y 20..32 from x 40)
  g.clearRect(40, 26, 16, 6);
  return c;
}

type Part = { pivot: T.Group; mesh: T.Mesh };

export type PuppetPose = {
  x: number;
  y: number;
  z: number;
  /** Body yaw. */
  yaw: number;
  /** Head yaw (relative to the world) and pitch. */
  head: number;
  pitch: number;
  /** Walk cycle distance and amount (0..1). */
  walk: number;
  amount: number;
  /** Arm swing progress 0..1, or negative for none. */
  swing: number;
  sneak: boolean;
  /** Seconds left of the red hurt tint. */
  hurt: number;
  invisible: boolean;
  /** Holding a bow drawn (0..1). */
  draw: number;
};

/** A blocky player: Minecraft proportions, team leather armor on top, a held item and a name tag. */
export class Avatar {
  readonly root: T.Group;
  private readonly model: T.Group;
  private readonly head: Part;
  private readonly body: Part;
  private readonly armL: Part;
  private readonly armR: Part;
  private readonly legL: Part;
  private readonly legR: Part;
  private readonly skinMat: T.MeshBasicMaterial;
  private readonly skinTex: T.CanvasTexture;
  private readonly armorMats: T.MeshBasicMaterial[] = [];
  private readonly armorTex: T.CanvasTexture[] = [];
  private readonly armorMeshes: T.Mesh[] = [];
  private readonly lowerArmor: T.Mesh[] = [];
  private readonly geos: T.BufferGeometry[] = [];
  readonly hand: T.Group;
  private heldKey = '';
  private heldObj: T.Object3D | null = null;
  readonly tag: T.Mesh;
  private readonly tagTex: T.CanvasTexture;
  private readonly tagCanvas: HTMLCanvasElement;
  private tagText = '';
  private armorKey = '';

  private readonly THREE: Three;
  constructor(THREE: Three, skin: number, team: number, seed: number) {
    this.THREE = THREE;
    this.root = new THREE.Group();
    this.model = new THREE.Group();
    this.root.add(this.model);
    this.skinTex = new THREE.CanvasTexture(paintSkin(skin, team, seed));
    this.skinTex.magFilter = NEAREST;
    this.skinTex.minFilter = NEAREST as unknown as T.MinificationTextureFilter;
    this.skinTex.colorSpace = THREE.SRGBColorSpace;
    this.skinMat = new THREE.MeshBasicMaterial({ map: this.skinTex, vertexColors: true });
    const px = 1 / 16;
    const S = 1.8 / 32 / px;
    this.model.scale.setScalar(S);
    const part = (w: number, h: number, d: number, u: number, v: number, pivot: [number, number, number], offset: [number, number, number]): Part => {
      const geo = skinBox(THREE, w, h, d, u, v);
      this.geos.push(geo);
      const mesh = new THREE.Mesh(geo, this.skinMat);
      mesh.position.set(offset[0] * px, offset[1] * px, offset[2] * px);
      const p = new THREE.Group();
      p.position.set(pivot[0] * px, pivot[1] * px, pivot[2] * px);
      p.add(mesh);
      this.model.add(p);
      return { pivot: p, mesh };
    };
    this.head = part(8, 8, 8, 0, 0, [0, 24, 0], [0, 4, 0]);
    this.body = part(8, 12, 4, 16, 16, [0, 12, 0], [0, 6, 0]);
    // the model faces +z: its right arm is at -x
    this.armR = part(4, 12, 4, 40, 16, [-6, 22, 0], [0, -4, 0]);
    this.armL = part(4, 12, 4, 32, 48, [6, 22, 0], [0, -4, 0]);
    this.legR = part(4, 12, 4, 0, 16, [-2, 12, 0], [0, -6, 0]);
    this.legL = part(4, 12, 4, 16, 48, [2, 12, 0], [0, -6, 0]);
    this.hand = new THREE.Group();
    this.hand.position.set(0, -10 * px, 1.5 * px);
    this.armR.pivot.add(this.hand);
    // name tag
    this.tagCanvas = document.createElement('canvas');
    this.tagCanvas.width = 256;
    this.tagCanvas.height = 64;
    this.tagTex = new THREE.CanvasTexture(this.tagCanvas);
    this.tagTex.colorSpace = THREE.SRGBColorSpace;
    const tagGeo = new THREE.PlaneGeometry(1.6, 0.4);
    this.geos.push(tagGeo);
    this.tag = new THREE.Mesh(tagGeo, new THREE.MeshBasicMaterial({ map: this.tagTex, transparent: true, depthWrite: false, fog: false }));
    this.tag.renderOrder = 10;
  }

  /** Puts on armor: the helmet and chestplate are always dyed leather, leggings and boots show the tier. */
  setArmor(tier: number, team: number) {
    const key = `${tier}:${team}`;
    if (key === this.armorKey) return;
    this.armorKey = key;
    for (const m of this.armorMeshes) m.removeFromParent();
    this.armorMeshes.length = 0;
    this.lowerArmor.length = 0;
    for (const m of this.armorMats) m.dispose();
    for (const t of this.armorTex) t.dispose();
    this.armorMats.length = 0;
    this.armorTex.length = 0;
    const THREE = this.THREE;
    const px = 1 / 16;
    const mat = (kind: number) => {
      const tex = new THREE.CanvasTexture(armorCanvas(kind, team));
      tex.magFilter = NEAREST;
      tex.minFilter = NEAREST as unknown as T.MinificationTextureFilter;
      tex.colorSpace = THREE.SRGBColorSpace;
      this.armorTex.push(tex);
      const m = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, alphaTest: 0.5 });
      this.armorMats.push(m);
      return m;
    };
    const leather = mat(0);
    const lower = tier === 0 ? leather : mat(tier);
    const add = (parent: T.Group, w: number, h: number, d: number, u: number, v: number, inflate: number, m: T.Material, y: number, isLower = false) => {
      const geo = skinBox(THREE, w, h, d, u, v, inflate, 64, 32);
      this.geos.push(geo);
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.y = y * px;
      parent.add(mesh);
      this.armorMeshes.push(mesh);
      if (isLower) this.lowerArmor.push(mesh);
    };
    add(this.head.pivot, 8, 8, 8, 0, 0, 1, leather, 4);
    add(this.body.pivot, 8, 12, 4, 16, 16, 1, leather, 6);
    add(this.armR.pivot, 4, 12, 4, 40, 16, 1, leather, -4);
    add(this.armL.pivot, 4, 12, 4, 40, 16, 1, leather, -4);
    add(this.legR.pivot, 4, 8, 4, 0, 16, 0.5, lower, -4, true);
    add(this.legL.pivot, 4, 8, 4, 0, 16, 0.5, lower, -4, true);
    add(this.legR.pivot, 4, 4, 4, 0, 16, 1, lower, -10, true);
    add(this.legL.pivot, 4, 4, 4, 0, 16, 1, lower, -10, true);
  }

  /** What's in hand: a block, an item sprite, or nothing. Geometry and material come from a shared cache. */
  setHeld(key: string, make: () => T.Object3D | null) {
    if (key === this.heldKey) return;
    this.heldKey = key;
    if (this.heldObj) this.hand.remove(this.heldObj);
    this.heldObj = make();
    if (this.heldObj) this.hand.add(this.heldObj);
  }

  setTag(text: string, color: string, hp: number) {
    const full = `${text}|${color}|${Math.ceil(hp)}`;
    if (full === this.tagText) return;
    this.tagText = full;
    const g = this.tagCanvas.getContext('2d')!;
    g.clearRect(0, 0, 256, 64);
    g.font = '600 30px Inter, system-ui, sans-serif';
    const label = text;
    const hpText = hp > 0 ? ` ${Math.ceil(hp)}` : '';
    const w = g.measureText(label).width + (hpText ? g.measureText(hpText).width + 20 : 0) + 24;
    const x0 = (256 - w) / 2;
    g.fillStyle = 'rgba(0,0,0,0.42)';
    g.fillRect(x0, 10, w, 44);
    g.fillStyle = color;
    g.textBaseline = 'middle';
    g.fillText(label, x0 + 12, 33);
    if (hpText) {
      const lw = g.measureText(label).width;
      g.fillStyle = '#ff5b5b';
      g.fillText(`${hpText}`, x0 + 12 + lw, 33);
      g.fillText('♥', x0 + 12 + lw + g.measureText(hpText).width + 2, 33);
    }
    this.tagTex.needsUpdate = true;
  }

  /** The bare right arm (the first-person hand reuses its skin). */
  rightArm(): T.Mesh {
    return this.armR.mesh;
  }

  /** Poses the model for a frame. */
  pose(p: PuppetPose, camera: T.Camera, showTag: boolean) {
    this.root.position.set(p.x, p.y, p.z);
    // the model faces +z at rotation 0; Body.yaw 0 faces -z
    this.root.rotation.y = p.yaw + Math.PI;
    const sneak = p.sneak ? 1 : 0;
    this.model.visible = !p.invisible;
    const swingLeg = Math.cos(p.walk * 0.6662) * 1.4 * p.amount;
    this.legR.pivot.rotation.x = swingLeg;
    this.legL.pivot.rotation.x = -swingLeg;
    this.armR.pivot.rotation.x = -Math.cos(p.walk * 0.6662 + Math.PI) * 1.4 * p.amount * 0.5;
    this.armL.pivot.rotation.x = -Math.cos(p.walk * 0.6662) * 1.4 * p.amount * 0.5;
    this.armR.pivot.rotation.z = 0;
    this.armR.pivot.rotation.y = 0;
    if (this.heldObj) this.armR.pivot.rotation.x = this.armR.pivot.rotation.x * 0.5 - 0.31;
    if (p.swing >= 0) {
      // Minecraft's swing: a chop down and across
      const s = p.swing;
      const f = Math.sin(Math.sqrt(s) * Math.PI);
      this.body.pivot.rotation.y = Math.sin(Math.sqrt(s) * Math.PI * 2) * 0.2;
      this.armR.pivot.rotation.x -= f * 1.2 + Math.sin(s * Math.PI) * 0.7;
      this.armR.pivot.rotation.y = this.body.pivot.rotation.y * 2;
      this.armR.pivot.rotation.z = Math.sin(s * Math.PI) * -0.4;
    } else this.body.pivot.rotation.y = 0;
    if (p.draw > 0) {
      // aiming a bow: both arms out toward the target
      this.armR.pivot.rotation.x = -Math.PI / 2 - p.pitch;
      this.armL.pivot.rotation.x = -Math.PI / 2 - p.pitch;
      this.armR.pivot.rotation.y = -0.1;
      this.armL.pivot.rotation.y = 0.5;
    }
    // sneaking: lean forward from the hips, shoulders and head follow, a little lower
    this.body.pivot.rotation.x = sneak * 0.5;
    this.model.position.y = -sneak * 0.1;
    const lean = (sneak * 5.5) / 16;
    this.head.pivot.position.set(0, (24 - sneak * 1.5) / 16, lean);
    this.armR.pivot.position.set(-6 / 16, (22 - sneak * 1.5) / 16, lean);
    this.armL.pivot.position.set(6 / 16, (22 - sneak * 1.5) / 16, lean);
    if (sneak) {
      this.armR.pivot.rotation.x += 0.4;
      this.armL.pivot.rotation.x += 0.4;
    }
    let hy = p.head - p.yaw;
    while (hy > Math.PI) hy -= Math.PI * 2;
    while (hy < -Math.PI) hy += Math.PI * 2;
    this.head.pivot.rotation.y = Math.max(-1.2, Math.min(1.2, hy));
    this.head.pivot.rotation.x = -p.pitch;
    const red = p.hurt > 0;
    const c = red ? 0.55 : 1;
    this.skinMat.color.setRGB(1, c, c);
    for (const m of this.armorMats) m.color.setRGB(1, c, c);
    // the tag lives in the scene (not under the root) so it can face the camera directly
    this.tag.visible = showTag && !p.invisible;
    if (this.tag.visible) {
      this.tag.quaternion.copy(camera.quaternion);
      this.tag.position.set(p.x, p.y + (p.sneak ? 2.05 : 2.3), p.z);
    }
  }

  dispose() {
    this.root.removeFromParent();
    this.tag.removeFromParent();
    if (this.heldObj) this.hand.remove(this.heldObj);
    for (const g of this.geos) g.dispose();
    this.skinMat.dispose();
    this.skinTex.dispose();
    for (const m of this.armorMats) m.dispose();
    for (const t of this.armorTex) t.dispose();
    (this.tag.material as T.Material).dispose();
    this.tagTex.dispose();
  }
}
