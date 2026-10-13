// The three.js view: chunk meshes from the mesher (rebuilt a few per frame when blocks change), a golden hour sky
// over the void, clouds, players, NPCs, item drops, projectiles, particles, generator holograms, the block outline
// and crack, and the first-person hand. It reads the game every frame and never changes it.
import { AIR, BLOCKS, CS, CX, CY, CZ, DIAMOND_BLOCK, EMERALD_BLOCK, TEAMS, TILE, type TileName } from './blocks.ts';
import { ADDITIVE, BACK_SIDE, NEAREST, clamp, createGL, disposeTree, lerp, type GL, type T, type Three } from './gl.ts';
import { meshChunk, type Geo } from './mesher.ts';
import { Avatar, atlasTexture, cubeGeometry, spriteGeometry, type PuppetPose } from './models.ts';
import type { Game } from './game.ts';
import { ITEM_DEFS, itemTile, isBlockItem, blockFor, type Item } from './items.ts';
import { chunkKey } from './world.ts';

export type HeldView = { item: Item | null; team: number; tier: number };

export type CamState = { x: number; y: number; z: number; yaw: number; pitch: number; roll: number; fov: number };

export type HandState = {
  held: HeldView;
  /** 0..1 progress of a swing, negative when idle. */
  swing: number;
  /** 0 up, 1 fully lowered (switching items). */
  equip: number;
  /** Bow draw 0..1. */
  draw: number;
  /** Eating progress 0..1, or 0. */
  eat: number;
  /** View bob phase and amount. */
  bob: number;
  bobAmt: number;
  visible: boolean;
  skin: number;
  team: number;
};

export type Puppet = PuppetPose & { id: number; visible: boolean; held: HeldView; armor: number; team: number; name: string; hp: number; skin: number };

export type ViewFrame = {
  game: Game;
  cam: CamState;
  puppets: Puppet[];
  target: { x: number; y: number; z: number } | null;
  crack: { x: number; y: number; z: number; stage: number } | null;
  hand: HandState;
  /** Seconds since start, for animation. */
  time: number;
  /** Seconds until each generator spawns next. */
  genIn: number[];
  /** Drop and projectile render positions come straight from the game. */
  dt: number;
};

export type Particle = { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number; size: number; r: number; g: number; b: number; grav: number };

const SKY = {
  top: 0x4f86d4,
  mid: 0x9cc2ec,
  horizon: 0xf3d7b5,
  below: 0x7b8fb4,
  void: 0x141a2e,
  fog: 0xd9d9d6,
};

export type View = {
  gl: GL;
  camera: T.PerspectiveCamera;
  resize(w: number, h: number): void;
  setPixelRatio(r: number): void;
  /** Meshes dirty chunks for up to `budget` milliseconds, nearest first. Returns how many are left. */
  syncChunks(budget: number): number;
  frame(f: ViewFrame): void;
  render(): void;
  /** Blocky puffs: a block breaking, a hit, an explosion, a kill effect. */
  burst(kind: 'block' | 'crit' | 'hit' | 'boom' | 'smoke' | 'kill' | 'bed' | 'spark', x: number, y: number, z: number, opt?: { block?: number; color?: number | string; count?: number }): void;
  /** Screen position of a world point in CSS pixels, or null behind the camera. */
  project(x: number, y: number, z: number): { x: number; y: number } | null;
  dispose(): void;
};

export function createView(THREE: Three, host: HTMLElement, game: Game): View | null {
  const gl = createGL(THREE, host);
  if (!gl) return null;
  const { renderer } = gl;
  renderer.autoClear = false;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY.fog);
  scene.fog = new THREE.Fog(SKY.fog, 70, 230);
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 700);
  camera.rotation.order = 'YXZ';
  let size = { w: 1, h: 1 };

  const atlas = atlasTexture(THREE);
  const opaqueMat = new THREE.MeshBasicMaterial({ map: atlas, vertexColors: true });
  const cutoutMat = new THREE.MeshBasicMaterial({ map: atlas, vertexColors: true, alphaTest: 0.5 });
  const glassMat = new THREE.MeshBasicMaterial({ map: atlas, vertexColors: true, transparent: true, depthWrite: false });
  const spriteMat = new THREE.MeshBasicMaterial({ map: atlas, vertexColors: true, alphaTest: 0.5 });
  const blockMat = new THREE.MeshBasicMaterial({ map: atlas, vertexColors: true, alphaTest: 0.5 });
  const shared = new Set<unknown>([atlas, opaqueMat, cutoutMat, glassMat, spriteMat, blockMat]);

  // ---------------------------------------------------------------------------------------------------------------
  // sky: a gradient dome, a square sun, flat blocky clouds, and the dark void below

  const skyGeo = new THREE.SphereGeometry(500, 32, 24);
  {
    const pos = skyGeo.getAttribute('position') as T.BufferAttribute;
    const col: number[] = [];
    const c = new THREE.Color();
    const a = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 500;
      if (y > 0.25) c.setHex(SKY.top).lerp(a.setHex(SKY.mid), clamp((0.7 - y) / 0.45, 0, 1));
      else if (y > 0) c.setHex(SKY.mid).lerp(a.setHex(SKY.horizon), clamp((0.25 - y) / 0.25, 0, 1));
      else if (y > -0.2) c.setHex(SKY.horizon).lerp(a.setHex(SKY.below), clamp(-y / 0.2, 0, 1));
      else c.setHex(SKY.below).lerp(a.setHex(SKY.void), clamp((-y - 0.2) / 0.5, 0, 1));
      col.push(c.r, c.g, c.b);
    }
    skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  }
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: BACK_SIDE, fog: false, depthWrite: false }));
  sky.renderOrder = -10;
  scene.add(sky);

  const sunCanvas = document.createElement('canvas');
  sunCanvas.width = 64;
  sunCanvas.height = 64;
  {
    const g = sunCanvas.getContext('2d')!;
    const grd = g.createRadialGradient(32, 32, 4, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,240,200,0.9)');
    grd.addColorStop(0.4, 'rgba(255,214,150,0.35)');
    grd.addColorStop(1, 'rgba(255,200,140,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#fff6dc';
    g.fillRect(22, 22, 20, 20);
    g.fillStyle = '#fffbea';
    g.fillRect(25, 25, 14, 14);
  }
  const sunTex = new THREE.CanvasTexture(sunCanvas);
  sunTex.magFilter = NEAREST;
  sunTex.colorSpace = THREE.SRGBColorSpace;
  const sun = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), new THREE.MeshBasicMaterial({ map: sunTex, transparent: true, fog: false, depthWrite: false, blending: ADDITIVE }));
  sun.renderOrder = -9;
  scene.add(sun);
  const sunDir = new THREE.Vector3(0.55, 0.32, -0.77).normalize();

  const cloudCanvas = document.createElement('canvas');
  cloudCanvas.width = 64;
  cloudCanvas.height = 64;
  {
    const g = cloudCanvas.getContext('2d')!;
    let s = 99;
    const r = () => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
    for (let i = 0; i < 26; i++) {
      const x = Math.floor(r() * 64);
      const y = Math.floor(r() * 64);
      const w = 3 + Math.floor(r() * 9);
      const h = 2 + Math.floor(r() * 6);
      g.fillStyle = 'rgba(255,255,255,0.92)';
      for (const [ox, oy] of [
        [0, 0],
        [-64, 0],
        [0, -64],
        [-64, -64],
      ])
        g.fillRect(x + ox, y + oy, w, h);
    }
  }
  const cloudTex = new THREE.CanvasTexture(cloudCanvas);
  cloudTex.magFilter = NEAREST;
  cloudTex.minFilter = NEAREST as unknown as T.MinificationTextureFilter;
  cloudTex.wrapS = THREE.RepeatWrapping;
  cloudTex.wrapT = THREE.RepeatWrapping;
  cloudTex.repeat.set(3, 3);
  cloudTex.colorSpace = THREE.SRGBColorSpace;
  const clouds = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
  clouds.rotation.x = -Math.PI / 2;
  clouds.position.set(88, 92, 88);
  clouds.renderOrder = -5;
  scene.add(clouds);

  // ---------------------------------------------------------------------------------------------------------------
  // chunks

  type ChunkMeshes = { opaque: T.Mesh | null; cutout: T.Mesh | null; glass: T.Mesh | null };
  // every chunk mesh shares the same bounding sphere (16 cubed), so frustum culling needs no per-mesh pass
  const chunkSphere = (() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, CS, CS, CS], 3));
    g.computeBoundingSphere();
    const s = g.boundingSphere!;
    g.dispose();
    return s;
  })();
  const chunks = new Map<number, ChunkMeshes>();
  const chunkGroup = new THREE.Group();
  scene.add(chunkGroup);

  const toMesh = (geo: Geo | null, mat: T.Material, cx: number, cy: number, cz: number, old: T.Mesh | null): T.Mesh | null => {
    if (old) {
      old.geometry.dispose();
      chunkGroup.remove(old);
    }
    if (!geo) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(geo.pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(geo.uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(geo.col, 3));
    g.setIndex(new THREE.BufferAttribute(geo.idx, 1));
    g.boundingSphere = chunkSphere.clone();
    const m = new THREE.Mesh(g, mat);
    m.position.set(cx * CS, cy * CS, cz * CS);
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    chunkGroup.add(m);
    return m;
  };

  const syncChunks = (budget: number) => {
    const w = game.world;
    if (!w.dirty.size) return 0;
    const t0 = performance.now();
    const keys = [...w.dirty];
    const camX = camera.position.x / CS;
    const camY = camera.position.y / CS;
    const camZ = camera.position.z / CS;
    const pos = (k: number) => [k % CX, Math.floor(k / (CX * CZ)), Math.floor(k / CX) % CZ];
    keys.sort((a, b) => {
      const [ax, ay, az] = pos(a);
      const [bx, by, bz] = pos(b);
      return (ax + 0.5 - camX) ** 2 + (ay + 0.5 - camY) ** 2 + (az + 0.5 - camZ) ** 2 - ((bx + 0.5 - camX) ** 2 + (by + 0.5 - camY) ** 2 + (bz + 0.5 - camZ) ** 2);
    });
    for (const k of keys) {
      if (performance.now() - t0 > budget) break;
      w.dirty.delete(k);
      const [cx, cy, cz] = pos(k);
      const m = meshChunk(w, cx, cy, cz);
      const old = chunks.get(k) ?? { opaque: null, cutout: null, glass: null };
      const next: ChunkMeshes = {
        opaque: toMesh(m.opaque, opaqueMat, cx, cy, cz, old.opaque),
        cutout: toMesh(m.cutout, cutoutMat, cx, cy, cz, old.cutout),
        glass: toMesh(m.glass, glassMat, cx, cy, cz, old.glass),
      };
      if (next.glass) next.glass.renderOrder = 2;
      if (next.opaque || next.cutout || next.glass) chunks.set(k, next);
      else chunks.delete(k);
    }
    return w.dirty.size;
  };
  void chunkKey;
  void CY;

  // ---------------------------------------------------------------------------------------------------------------
  // shared item geometry: sprites and block cubes, built on first use

  const spriteGeos = new Map<number, T.BufferGeometry>();
  const cubeGeos = new Map<number, T.BufferGeometry>();
  const spriteGeo = (tile: number) => {
    let g = spriteGeos.get(tile);
    if (!g) spriteGeos.set(tile, (g = spriteGeometry(THREE, tile)));
    return g;
  };
  const cubeGeo = (block: number) => {
    let g = cubeGeos.get(block);
    if (!g) cubeGeos.set(block, (g = cubeGeometry(THREE, block)));
    return g;
  };
  /** A mesh for a held or dropped item: blocks as cubes, everything else as a sprite. */
  const itemMesh = (h: HeldView): T.Mesh | null => {
    if (!h.item) return null;
    if (isBlockItem(h.item) && h.item !== 'ladder') {
      const block = blockFor(h.item, h.team);
      return new THREE.Mesh(cubeGeo(block), BLOCKS[block].pass === 'glass' ? glassMat : blockMat);
    }
    const tile = h.item === 'tnt' ? -1 : itemTile(h.item, h.team, h.tier);
    if (tile < 0) return new THREE.Mesh(cubeGeo(0), blockMat);
    return new THREE.Mesh(spriteGeo(tile), spriteMat);
  };
  const tntGeo = cubeGeometry(THREE, 0, [TILE.tnt_top, TILE.tnt_bottom, TILE.tnt_side]);
  const heldKey = (h: HeldView) => (h.item ? `${h.item}:${h.team}:${h.tier}` : '');

  // ---------------------------------------------------------------------------------------------------------------
  // players and NPCs

  const avatars = new Map<number, Avatar>();
  const avatarGroup = new THREE.Group();
  scene.add(avatarGroup);
  const makeHeld = (h: HeldView) => () => {
    if (h.item === 'tnt') {
      const m = new THREE.Mesh(tntGeo, blockMat);
      m.scale.setScalar(0.32);
      m.position.set(0, -0.05, 0.05);
      return m;
    }
    const m = itemMesh(h);
    if (!m) return null;
    if (isBlockItem(h.item!) && h.item !== 'ladder') {
      m.scale.setScalar(0.3);
      m.rotation.set(0.3, 0.8, 0);
      m.position.set(0, -0.06, 0.08);
    } else {
      // sprites are drawn blade up and to the right: turn the plane to face sideways so the blade points out of the fist
      m.scale.setScalar(0.62);
      m.rotation.order = 'YXZ';
      m.rotation.set(-0.9, -Math.PI / 2, 0);
      m.position.set(0, -0.02, 0.2);
    }
    return m;
  };

  // NPCs: an item shop keeper and a team upgrades steward on every used island
  const npcs: { av: Avatar; x: number; y: number; z: number; yaw: number; label: T.Mesh }[] = [];
  const labelCanvas = (lines: [string, string][]) => {
    const c = document.createElement('canvas');
    c.width = 384;
    c.height = 96;
    const g = c.getContext('2d')!;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    lines.forEach(([text, color], i) => {
      g.font = i === 0 ? '800 34px Inter, system-ui, sans-serif' : '700 24px Inter, system-ui, sans-serif';
      g.lineWidth = 6;
      g.strokeStyle = 'rgba(0,0,0,0.55)';
      g.strokeText(text, 192, 28 + i * 40);
      g.fillStyle = color;
      g.fillText(text, 192, 28 + i * 40);
    });
    return c;
  };
  const labelTextures: T.Texture[] = [];
  const labelGeo = new THREE.PlaneGeometry(2.6, 0.65);
  const makeLabel = (lines: [string, string][]) => {
    const tex = new THREE.CanvasTexture(labelCanvas(lines));
    tex.colorSpace = THREE.SRGBColorSpace;
    labelTextures.push(tex);
    const m = new THREE.Mesh(labelGeo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    m.renderOrder = 9;
    scene.add(m);
    return m;
  };
  game.info.teams.forEach((site, t) => {
    if (!game.teams[t]?.used) return;
    for (const which of ['shop', 'upgrades'] as const) {
      const at = which === 'shop' ? site.shop : site.upgrades;
      const av = new Avatar(THREE, which === 'shop' ? 4 : 2, t, 1000 + t * 2 + (which === 'shop' ? 0 : 1));
      av.tag.visible = false;
      avatarGroup.add(av.root);
      const label = makeLabel(which === 'shop' ? [['ITEM SHOP', '#ffd23f'], ['RIGHT CLICK', '#ffffff']] : [['TEAM UPGRADES', '#7fe3ff'], ['RIGHT CLICK', '#ffffff']]);
      label.position.set(at[0], at[1] + 2.45, at[2]);
      // face the spawn
      const yaw = Math.atan2(-(site.spawn[0] - at[0]), -(site.spawn[2] - at[2]));
      npcs.push({ av, x: at[0], y: at[1], z: at[2], yaw, label });
    }
  });

  // ---------------------------------------------------------------------------------------------------------------
  // drops, projectiles

  const RES_ITEMS: Item[] = ['iron', 'gold', 'diamond', 'emerald'];
  const resMeshes = new Map<Item, T.InstancedMesh>();
  for (const item of RES_ITEMS) {
    const im = new THREE.InstancedMesh(spriteGeo(TILE[ITEM_DEFS[item].tile]), spriteMat, 256);
    im.count = 0;
    im.frustumCulled = false;
    scene.add(im);
    resMeshes.set(item, im);
  }
  const otherDrops = new Map<number, T.Mesh>();
  const projMeshes = new Map<number, T.Object3D>();
  const projGroup = new THREE.Group();
  scene.add(projGroup);
  const arrowGeo = new THREE.BoxGeometry(0.06, 0.06, 0.6);
  const arrowMat = new THREE.MeshBasicMaterial({ color: 0x9c7442 });
  const fireMat = new THREE.MeshBasicMaterial({ color: 0xff8a2a, fog: false });
  const glowGeo = new THREE.SphereGeometry(0.42, 10, 8);
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.35, blending: ADDITIVE, depthWrite: false });
  const tmpM = new THREE.Matrix4();
  const tmpQ = new THREE.Quaternion();
  const tmpV = new THREE.Vector3();
  const tmpS = new THREE.Vector3();
  const tmpE = new THREE.Vector3(0, 1, 0);

  // ---------------------------------------------------------------------------------------------------------------
  // generator holograms: a spinning block and three lines of text

  const holos = game.gens.map((gen) => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 128;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    labelTextures.push(tex);
    const text = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    text.position.set(gen.x, gen.y + 3.6, gen.z);
    text.renderOrder = 9;
    scene.add(text);
    const cube = new THREE.Mesh(cubeGeo(gen.kind === 'diamond' ? DIAMOND_BLOCK : EMERALD_BLOCK), blockMat);
    cube.scale.setScalar(0.62);
    cube.position.set(gen.x, gen.y + 2.5, gen.z);
    scene.add(cube);
    return { c, tex, text, cube, last: '' };
  });
  const drawHolo = (i: number, tier: number, secs: number) => {
    const h = holos[i];
    const gen = game.gens[i];
    const key = `${tier}:${secs}`;
    if (key === h.last) return;
    h.last = key;
    const g = h.c.getContext('2d')!;
    g.clearRect(0, 0, 256, 128);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const lines: [string, string, string][] = [
      [`Tier ${['I', 'II', 'III'][tier - 1]}`, '#ffd23f', '700 24px Inter, system-ui, sans-serif'],
      [gen.kind === 'diamond' ? 'Diamond' : 'Emerald', gen.kind === 'diamond' ? '#55ffff' : '#55ff55', '800 32px Inter, system-ui, sans-serif'],
      [`Spawns in ${secs} seconds`, '#ffd23f', '600 22px Inter, system-ui, sans-serif'],
    ];
    lines.forEach(([t, col, font], k) => {
      g.font = font;
      g.lineWidth = 5;
      g.strokeStyle = 'rgba(0,0,0,0.55)';
      g.strokeText(t, 128, 22 + k * 40);
      g.fillStyle = col;
      g.fillText(t, 128, 22 + k * 40);
    });
    h.tex.needsUpdate = true;
  };

  // ---------------------------------------------------------------------------------------------------------------
  // particles: one instanced mesh of little cubes

  const MAXP = 900;
  const parts: Particle[] = [];
  const free: Particle[] = [];
  const partMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }), MAXP);
  partMesh.count = 0;
  partMesh.frustumCulled = false;
  partMesh.setColorAt(0, new THREE.Color(1, 1, 1));
  scene.add(partMesh);
  const pc = new THREE.Color();
  const spawnPart = (x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, color: string | number, grav = 18) => {
    if (parts.length >= MAXP) return;
    const p = free.pop() ?? ({} as Particle);
    pc.set(color as T.ColorRepresentation);
    Object.assign(p, { x, y, z, vx, vy, vz, life, max: life, size, r: pc.r, g: pc.g, b: pc.b, grav });
    parts.push(p);
  };

  const burst: View['burst'] = (kind, x, y, z, opt = {}) => {
    const R = Math.random;
    if (kind === 'block') {
      const b = BLOCKS[opt.block ?? 0];
      const cols = b.colors.length ? b.colors : ['#888'];
      for (let i = 0; i < (opt.count ?? 22); i++) spawnPart(x + 0.15 + R() * 0.7, y + 0.15 + R() * 0.7, z + 0.15 + R() * 0.7, (R() - 0.5) * 3, R() * 3, (R() - 0.5) * 3, 0.5 + R() * 0.5, 0.06 + R() * 0.07, cols[(R() * cols.length) | 0]);
    } else if (kind === 'crit') {
      for (let i = 0; i < 14; i++) spawnPart(x + (R() - 0.5) * 0.6, y + R() * 1.6, z + (R() - 0.5) * 0.6, (R() - 0.5) * 5, R() * 4, (R() - 0.5) * 5, 0.5, 0.07, R() < 0.5 ? '#f6f2c4' : '#c9c39a', 6);
    } else if (kind === 'hit') {
      for (let i = 0; i < 6; i++) spawnPart(x + (R() - 0.5) * 0.5, y + 0.8 + R() * 0.8, z + (R() - 0.5) * 0.5, (R() - 0.5) * 2, R() * 2, (R() - 0.5) * 2, 0.35, 0.06, '#7a0d0d', 10);
    } else if (kind === 'boom') {
      for (let i = 0; i < 46; i++) {
        const a = R() * Math.PI * 2;
        const e = R() * Math.PI - Math.PI / 2;
        const s = 3 + R() * 7;
        spawnPart(x, y, z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s + 2, Math.sin(a) * Math.cos(e) * s, 0.6 + R() * 0.8, 0.25 + R() * 0.35, R() < 0.3 ? '#ffd27a' : R() < 0.6 ? '#9a9a9a' : '#d8d8d8', 2);
      }
    } else if (kind === 'smoke') {
      for (let i = 0; i < (opt.count ?? 3); i++) spawnPart(x + (R() - 0.5) * 0.3, y, z + (R() - 0.5) * 0.3, (R() - 0.5) * 0.3, 0.6 + R() * 0.5, (R() - 0.5) * 0.3, 0.6 + R() * 0.4, 0.08 + R() * 0.06, opt.color ?? '#cfcfcf', -0.5);
    } else if (kind === 'kill') {
      const c = opt.color ?? 0x8c1515;
      for (let i = 0; i < 60; i++) {
        const a = R() * Math.PI * 2;
        const s = 2 + R() * 5;
        spawnPart(x, y + 0.9 + R() * 0.6, z, Math.cos(a) * s, 2 + R() * 6, Math.sin(a) * s, 0.8 + R() * 0.8, 0.1 + R() * 0.1, R() < 0.7 ? c : 0xffffff, 9);
      }
    } else if (kind === 'bed') {
      for (let i = 0; i < 70; i++) {
        const a = R() * Math.PI * 2;
        const s = 1 + R() * 4;
        spawnPart(x + 0.5, y + 0.5, z + 0.5, Math.cos(a) * s, 3 + R() * 7, Math.sin(a) * s, 1 + R() * 1.2, 0.08 + R() * 0.1, R() < 0.5 ? (opt.color ?? 0xffffff) : R() < 0.5 ? '#ffd23f' : '#ffffff', 8);
      }
    } else if (kind === 'spark') {
      for (let i = 0; i < (opt.count ?? 8); i++) spawnPart(x + (R() - 0.5) * 0.4, y + (R() - 0.5) * 0.4, z + (R() - 0.5) * 0.4, (R() - 0.5) * 2, R() * 2, (R() - 0.5) * 2, 0.4 + R() * 0.3, 0.05, opt.color ?? '#ffffff', 2);
    }
  };

  // ---------------------------------------------------------------------------------------------------------------
  // block outline and crack overlay

  const outlinePts: number[] = [];
  {
    const e = 0.002;
    const a = -e;
    const b = 1 + e;
    const path = [
      [a, a, a],
      [b, a, a],
      [b, a, b],
      [a, a, b],
      [a, a, a],
      [a, b, a],
      [b, b, a],
      [b, a, a],
      [b, b, a],
      [b, b, b],
      [b, a, b],
      [b, b, b],
      [a, b, b],
      [a, a, b],
      [a, b, b],
      [a, b, a],
    ];
    for (const p of path) outlinePts.push(...p);
  }
  const outlineGeo = new THREE.BufferGeometry();
  outlineGeo.setAttribute('position', new THREE.Float32BufferAttribute(outlinePts, 3));
  const outline = new THREE.Line(outlineGeo, new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.6 }));
  outline.visible = false;
  scene.add(outline);
  const crackMats = Array.from({ length: 10 }, (_, i) => {
    const g = cubeGeometry(THREE, 0, [TILE[`crack_${i}` as TileName], TILE[`crack_${i}` as TileName], TILE[`crack_${i}` as TileName]]);
    return g;
  });
  const crackMat = new THREE.MeshBasicMaterial({ map: atlas, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const crack = new THREE.Mesh(crackMats[0], crackMat);
  crack.visible = false;
  crack.renderOrder = 3;
  scene.add(crack);

  // ---------------------------------------------------------------------------------------------------------------
  // first-person hand: its own little scene drawn over the world

  const vmScene = new THREE.Scene();
  const vmCam = new THREE.PerspectiveCamera(70, 1, 0.01, 10);
  const vmRoot = new THREE.Group();
  vmScene.add(vmRoot);
  let vmAvatar: Avatar | null = null;
  let vmKey = '';
  let vmHeld: T.Object3D | null = null;
  let vmHeldKey = '';
  // Minecraft's first-person chain: swing offset, then the base pose (with the swing's turns), then the item's own display transform
  const vmBase = new THREE.Group();
  vmBase.rotation.order = 'YZX';
  vmRoot.add(vmBase);
  const vmItem = new THREE.Group();
  vmItem.rotation.order = 'YXZ';
  vmBase.add(vmItem);

  // ---------------------------------------------------------------------------------------------------------------

  const frame = (f: ViewFrame) => {
    const { cam } = f;
    camera.position.set(cam.x, cam.y, cam.z);
    camera.rotation.set(cam.pitch, cam.yaw, cam.roll);
    if (Math.abs(camera.fov - cam.fov) > 0.01) {
      camera.fov = cam.fov;
      camera.updateProjectionMatrix();
    }
    sky.position.copy(camera.position);
    sun.position.copy(camera.position).addScaledVector(sunDir, 400);
    sun.lookAt(camera.position);
    clouds.position.x = 88 + ((f.time * 0.6) % 400);
    cloudTex.offset.set(0, 0);

    // players
    const seen = new Set<number>();
    for (const p of f.puppets) {
      if (!p.visible) continue;
      seen.add(p.id);
      let av = avatars.get(p.id);
      if (!av) {
        av = new Avatar(THREE, p.skin, p.team, p.id * 31 + 7);
        avatars.set(p.id, av);
        avatarGroup.add(av.root);
        scene.add(av.tag);
      }
      av.setArmor(p.armor, p.team);
      av.setHeld(heldKey(p.held), makeHeld(p.held));
      av.setTag(p.name, TEAMS[p.team].color, p.hp);
      const d = Math.hypot(p.x - cam.x, p.z - cam.z);
      av.pose(p, camera, d < 48);
    }
    for (const [id, av] of avatars)
      if (!seen.has(id)) {
        av.dispose();
        avatars.delete(id);
      }
    // NPCs look at whoever is closest
    for (const n of npcs) {
      const dx = cam.x - n.x;
      const dz = cam.z - n.z;
      const close = Math.hypot(dx, dz) < 8;
      const head = close ? Math.atan2(-dx, -dz) : n.yaw;
      n.av.pose({ x: n.x, y: n.y, z: n.z, yaw: n.yaw, head, pitch: 0, walk: 0, amount: 0, swing: -1, sneak: false, hurt: 0, invisible: false, draw: 0 }, camera, false);
      n.label.quaternion.copy(camera.quaternion);
    }

    // generator holograms
    game.gens.forEach((gen, i) => {
      const h = holos[i];
      drawHolo(i, gen.tier, Math.max(0, Math.ceil(f.genIn[i] ?? 0)));
      h.text.quaternion.copy(camera.quaternion);
      h.cube.rotation.y = f.time * 1.6;
      h.cube.position.y = gen.y + 2.4 + Math.sin(f.time * 2) * 0.12;
    });

    // resource drops: instanced and spinning; anything else gets its own mesh
    const counts = new Map<Item, number>();
    const others = new Set<number>();
    for (const d of game.drops) {
      const im = resMeshes.get(d.item);
      const bob = Math.sin(f.time * 2.4 + d.id) * 0.06 + 0.28;
      if (im) {
        const shown = Math.min(3, d.n);
        for (let k = 0; k < shown; k++) {
          const n = counts.get(d.item) ?? 0;
          if (n >= 256) break;
          tmpQ.setFromAxisAngle(tmpE, f.time * 1.8 + d.id + k * 0.7);
          tmpV.set(d.x + (k ? Math.sin(k * 2.1) * 0.12 : 0), d.y + bob + k * 0.06, d.z + (k ? Math.cos(k * 2.1) * 0.12 : 0));
          tmpS.setScalar(0.42);
          tmpM.compose(tmpV, tmpQ, tmpS);
          im.setMatrixAt(n, tmpM);
          counts.set(d.item, n + 1);
        }
      } else {
        others.add(d.id);
        let m = otherDrops.get(d.id);
        if (!m) {
          m = itemMesh({ item: d.item, team: 0, tier: 1 }) ?? new THREE.Mesh(cubeGeo(0), blockMat);
          m.scale.setScalar(isBlockItem(d.item) ? 0.25 : 0.42);
          scene.add(m);
          otherDrops.set(d.id, m);
        }
        m.position.set(d.x, d.y + bob, d.z);
        m.rotation.y = f.time * 1.8 + d.id;
      }
    }
    for (const [item, im] of resMeshes) {
      im.count = counts.get(item) ?? 0;
      im.instanceMatrix.needsUpdate = true;
    }
    for (const [id, m] of otherDrops)
      if (!others.has(id)) {
        m.removeFromParent();
        otherDrops.delete(id);
      }

    // projectiles
    const live = new Set<number>();
    for (const pr of game.projs) {
      live.add(pr.id);
      let o = projMeshes.get(pr.id);
      if (!o) {
        if (pr.kind === 'arrow') o = new THREE.Mesh(arrowGeo, arrowMat);
        else if (pr.kind === 'fireball') {
          const grp = new THREE.Group();
          const core = new THREE.Mesh(cubeGeo(0), fireMat);
          core.scale.setScalar(0.42);
          grp.add(core);
          grp.add(new THREE.Mesh(glowGeo, glowMat));
          o = grp;
        } else if (pr.kind === 'tnt') {
          o = new THREE.Mesh(tntGeo, new THREE.MeshBasicMaterial({ map: atlas, vertexColors: true }));
          o.scale.setScalar(0.98);
        } else {
          o = new THREE.Mesh(spriteGeo(TILE[pr.kind === 'pearl' ? 'pearl' : 'egg']), spriteMat);
          o.scale.setScalar(0.35);
        }
        projGroup.add(o);
        projMeshes.set(pr.id, o);
      }
      o.position.set(pr.x, pr.y + (pr.kind === 'tnt' ? 0.5 : 0), pr.z);
      if (pr.kind === 'arrow') {
        tmpV.set(pr.x + pr.vx, pr.y + pr.vy, pr.z + pr.vz);
        o.lookAt(tmpV);
      } else if (pr.kind === 'tnt') {
        const flash = Math.floor(pr.age / 4) % 2 === 0 && pr.age > 10;
        ((o as T.Mesh).material as T.MeshBasicMaterial).color.setRGB(flash ? 2.2 : 1, flash ? 2.2 : 1, flash ? 2.2 : 1);
      } else {
        o.quaternion.copy(camera.quaternion);
        if (pr.kind === 'fireball' && Math.random() < 0.6) burst('smoke', pr.x, pr.y, pr.z, { count: 1, color: '#555' });
      }
    }
    for (const [id, o] of projMeshes)
      if (!live.has(id)) {
        o.removeFromParent();
        if (o instanceof THREE.Mesh && o.geometry === tntGeo) (o.material as T.Material).dispose();
        projMeshes.delete(id);
      }

    // particles
    const dt = f.dt;
    let n = 0;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) {
        parts[i] = parts[parts.length - 1];
        parts.pop();
        free.push(p);
        continue;
      }
      p.vy -= p.grav * dt;
      p.vx *= 1 - 1.5 * dt;
      p.vz *= 1 - 1.5 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const id = game.world.get(p.x, p.y, p.z);
      if (id !== AIR && BLOCKS[id].solid) {
        p.y = Math.floor(p.y) + 1.001;
        p.vy = 0;
        p.vx *= 0.5;
        p.vz *= 0.5;
      }
    }
    for (const p of parts) {
      const s = p.size * Math.min(1, (p.life / p.max) * 2.5);
      tmpV.set(p.x, p.y, p.z);
      tmpS.setScalar(s);
      tmpQ.identity();
      tmpM.compose(tmpV, tmpQ, tmpS);
      partMesh.setMatrixAt(n, tmpM);
      pc.setRGB(p.r, p.g, p.b);
      partMesh.setColorAt(n, pc);
      n++;
    }
    partMesh.count = n;
    partMesh.instanceMatrix.needsUpdate = true;
    if (partMesh.instanceColor) partMesh.instanceColor.needsUpdate = true;

    // outline and crack
    if (f.target) {
      outline.visible = true;
      outline.position.set(f.target.x, f.target.y, f.target.z);
      const id = game.world.get(f.target.x, f.target.y, f.target.z);
      const b = BLOCKS[id];
      outline.scale.set(1, b.shape === 'bed' ? 0.5625 : 1, 1);
    } else outline.visible = false;
    if (f.crack && f.crack.stage >= 0) {
      crack.visible = true;
      crack.geometry = crackMats[clamp(f.crack.stage, 0, 9)];
      crack.position.set(f.crack.x + 0.5, f.crack.y + 0.5, f.crack.z + 0.5);
      crack.scale.setScalar(1.004);
    } else crack.visible = false;

    // the hand
    const h = f.hand;
    vmRoot.visible = h.visible;
    if (h.visible) {
      const key = `${h.skin}:${h.team}`;
      if (key !== vmKey) {
        vmKey = key;
        if (vmAvatar) vmAvatar.dispose();
        vmAvatar = new Avatar(THREE, h.skin, h.team, 7);
      }
      const hk = heldKey(h.held);
      if (hk !== vmHeldKey) {
        vmHeldKey = hk;
        if (vmHeld) vmItem.remove(vmHeld);
        vmHeld = h.held.item === 'tnt' ? new THREE.Mesh(tntGeo, blockMat) : itemMesh(h.held);
        if (vmHeld) vmItem.add(vmHeld);
      }
      layoutHand(h);
    }
  };

  // the bare arm for the first-person view, built from the avatar's right arm skin
  const armGroup = new THREE.Group();
  vmRoot.add(armGroup);
  let armMesh: T.Mesh | null = null;
  let armForKey = '';

  const D = Math.PI / 180;
  const layoutHand = (h: HandState) => {
    const empty = !h.held.item;
    // build the arm on demand from the avatar's materials
    if (vmAvatar && armForKey !== vmKey) {
      armForKey = vmKey;
      if (armMesh) armGroup.remove(armMesh);
      const src = vmAvatar.rightArm();
      armMesh = new THREE.Mesh(src.geometry, src.material);
      armMesh.position.set(0, -0.24, 0);
      armGroup.add(armMesh);
    }
    const s = h.swing >= 0 ? h.swing : 0;
    const sq = Math.sqrt(s);
    const f = Math.sin(s * s * Math.PI);
    const f1 = Math.sin(sq * Math.PI);
    const bobX = Math.sin(h.bob * Math.PI) * h.bobAmt * 0.05;
    const bobY = -Math.abs(Math.cos(h.bob * Math.PI)) * h.bobAmt * 0.06;
    armGroup.visible = empty;
    vmItem.visible = !empty;
    if (empty) {
      // the bare arm reaches in from the lower right and punches forward
      vmRoot.position.set(-0.3 * f1 + bobX, 0.4 * Math.sin(sq * Math.PI * 2) + bobY, -0.4 * Math.sin(s * Math.PI));
      vmBase.position.set(0.5, -0.52 - h.equip * 0.6, -0.62);
      vmBase.rotation.set(0, 45 * D + f1 * 70 * D, f * -20 * D);
      armGroup.position.set(0, 0, 0);
      armGroup.rotation.set(-62 * D, -38 * D, 18 * D);
      armGroup.scale.setScalar(1);
      return;
    }
    const item = h.held.item!;
    const block = (isBlockItem(item) && item !== 'ladder') || item === 'tnt';
    const bow = item.startsWith('bow');
    vmRoot.position.set(-0.4 * f1 + bobX, 0.2 * Math.sin(sq * Math.PI * 2) + bobY, -0.2 * Math.sin(s * Math.PI));
    vmBase.position.set(0.56, -0.52 - h.equip * 0.6, -0.72);
    vmBase.rotation.set(f1 * -80 * D, 45 * D + f * -20 * D, f1 * -20 * D);
    if (h.eat > 0) {
      // bring it up to the mouth and bob
      const k = Math.min(1, h.eat * 4);
      vmBase.position.x -= 0.28 * k;
      vmBase.position.y += 0.18 * k + Math.abs(Math.cos(h.eat * 40)) * 0.05 * k;
      vmBase.rotation.y -= 0.6 * k;
    }
    if (block) {
      vmItem.position.set(0, 0, 0);
      vmItem.rotation.set(0, 45 * D, 0);
      vmItem.scale.setScalar(0.4);
    } else {
      // item/handheld firstperson: rotation [0, -135, 25], translation [0, 4, 2] px, scale 1.7, inside a 0.4 scale
      const k = 0.4;
      vmItem.position.set(0, (4 / 16) * k, (2 / 16) * k);
      vmItem.rotation.set(0, -135 * D, 25 * D);
      vmItem.scale.setScalar(1.7 * k * 0.8);
      if (bow) {
        // drawn bows come in toward the middle of the screen
        const d = h.draw;
        vmItem.rotation.set(-8 * D * d, -135 * D - 12 * D * d, 25 * D - 18 * D * d);
        vmItem.position.x -= 0.25 * d;
        vmItem.position.z += 0.08 * d;
        vmItem.position.y += Math.sin(h.draw * 60) * 0.004 * d;
      }
    }
  };

  const proj = new THREE.Vector3();
  return {
    gl,
    camera,
    resize(w, h) {
      size = { w, h };
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
      vmCam.aspect = camera.aspect;
      vmCam.updateProjectionMatrix();
    },
    setPixelRatio(r) {
      renderer.setPixelRatio(r);
      renderer.setSize(size.w, size.h, false);
    },
    syncChunks,
    frame,
    burst,
    render() {
      if (gl.lost()) return;
      renderer.clear();
      renderer.render(scene, camera);
      if (vmRoot.visible) {
        renderer.clearDepth();
        renderer.render(vmScene, vmCam);
      }
    },
    project(x, y, z) {
      proj.set(x, y, z).project(camera);
      if (proj.z > 1) return null;
      return { x: ((proj.x + 1) / 2) * size.w, y: ((1 - proj.y) / 2) * size.h };
    },
    dispose() {
      for (const av of avatars.values()) av.dispose();
      for (const n of npcs) n.av.dispose();
      if (vmAvatar) vmAvatar.dispose();
      for (const g of spriteGeos.values()) g.dispose();
      for (const g of cubeGeos.values()) g.dispose();
      for (const g of crackMats) g.dispose();
      for (const t of labelTextures) t.dispose();
      tntGeo.dispose();
      disposeTree(scene, shared);
      disposeTree(vmScene, shared);
      for (const m of [opaqueMat, cutoutMat, glassMat, spriteMat, blockMat]) m.dispose();
      atlas.dispose();
      sunTex.dispose();
      cloudTex.dispose();
      gl.dispose();
    },
  };
}

export { lerp };
