// Instanced repetition for the circle modules: one InstancedMesh per kind of piece, filled through an Instancer so no
// module writes matrices by hand, plus the shared flame and glow pools every circle lights itself with.
import type { Dress, Frame } from './decor';
import type { RGB, Three } from './dress';
import type { T } from './gl';

export type Rot = [number, number, number] | T.Quaternion;
export type Scale = number | [number, number, number];

/** An InstancedMesh with a cursor: push pieces, finish, add `mesh` to a group. One scratch Object3D, no per push garbage. */
export class Instancer {
  readonly THREE: Three;
  readonly mesh: T.InstancedMesh;
  readonly max: number;
  /** how many pieces were pushed */
  n = 0;
  private readonly o: T.Object3D;
  private readonly c: T.Color;
  private coloured = false;
  /** scratch vectors and quaternions for callers that place pieces along things */
  readonly v: T.Vector3;
  readonly v2: T.Vector3;
  readonly q: T.Quaternion;
  readonly q2: T.Quaternion;

  constructor(THREE: Three, geo: T.BufferGeometry, mat: T.Material, max: number) {
    this.THREE = THREE;
    this.max = Math.max(1, max | 0);
    this.mesh = new THREE.InstancedMesh(geo, mat, this.max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.o = new THREE.Object3D();
    this.c = new THREE.Color();
    this.v = new THREE.Vector3();
    this.v2 = new THREE.Vector3();
    this.q = new THREE.Quaternion();
    this.q2 = new THREE.Quaternion();
  }

  private write(i: number, x: number, y: number, z: number, rot: Rot, scale: Scale) {
    const o = this.o;
    o.position.set(x, y, z);
    if (Array.isArray(rot)) o.rotation.set(rot[0], rot[1], rot[2]);
    else o.quaternion.copy(rot);
    if (typeof scale === 'number') o.scale.setScalar(scale);
    else o.scale.set(scale[0], scale[1], scale[2]);
    o.updateMatrix();
    this.mesh.setMatrixAt(i, o.matrix);
  }

  /** places one piece and returns its index, or -1 when the mesh is full */
  push(x: number, y: number, z: number, rot: Rot = [0, 0, 0], scale: Scale = 1, colour?: string | RGB) {
    if (this.n >= this.max) return -1;
    const i = this.n++;
    this.write(i, x, y, z, rot, scale);
    if (colour !== undefined) {
      if (typeof colour === 'string') this.c.set(colour);
      else this.c.setRGB(colour[0], colour[1], colour[2]);
      this.mesh.setColorAt(i, this.c);
      this.coloured = true;
    }
    return i;
  }

  /** moves one piece later (for per frame hooks) */
  set(i: number, x: number, y: number, z: number, rot: Rot = [0, 0, 0], scale: Scale = 1) {
    if (i < 0 || i >= this.n) return;
    this.write(i, x, y, z, rot, scale);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** sets the count and uploads what was pushed */
  finish() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.coloured && this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.frustumCulled = false;
    return this.mesh;
  }
}

/** The factory spelling of the same thing. */
export const instancer = (THREE: Three, geo: T.BufferGeometry, mat: T.Material, max: number) => new Instancer(THREE, geo, mat, max);

/**
 * Chain links along a segment at that pitch, each lying along it and every other one turned a quarter about it, the
 * way a chain hangs. Returns how many were placed.
 */
export function chainOf(inst: Instancer, from: [number, number, number], to: [number, number, number], pitch = 0.2) {
  const dir = inst.v.set(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  const len = dir.length();
  if (len < 1e-6) return 0;
  dir.divideScalar(len);
  const n = Math.max(1, Math.round(len / pitch));
  // the link's local x along the segment, then the alternate quarter turn about it
  inst.q.setFromUnitVectors(inst.v2.set(1, 0, 0), dir);
  let placed = 0;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    inst.q2.setFromAxisAngle(dir, (i % 2) * Math.PI * 0.5).multiply(inst.q);
    if (inst.push(from[0] + dir.x * len * t, from[1] + dir.y * len * t, from[2] + dir.z * len * t, inst.q2, 1) < 0) break;
    placed++;
  }
  return placed;
}

export type Flames = { outer: Instancer; inner: Instancer; add(x: number, y: number, z: number, scale?: number): number; finish(): void };

/**
 * Every flame of a circle in two instanced cones that flicker together: (x, y, z) is the flame's base. Two draw calls
 * however many torches, candles and furnace mouths.
 */
export function flames(d: Dress, max = 96): Flames {
  const outer = new Instancer(d.THREE, d.geo.cone, d.basic('#ffa24a'), max);
  const inner = new Instancer(d.THREE, d.geo.cone, d.basic('#fff1c2'), max);
  d.group.add(outer.mesh, inner.mesh);
  const at: number[] = [];
  const seeds: number[] = [];
  const rot: [number, number, number] = [0, 0, 0];
  const sc: [number, number, number] = [1, 1, 1];
  const add = (x: number, y: number, z: number, scale = 1) => {
    const i = outer.push(x, y + 0.21 * scale, z, rot, [0.16 * scale, 0.42 * scale, 0.16 * scale]);
    inner.push(x, y + 0.15 * scale, z, rot, [0.08 * scale, 0.22 * scale, 0.08 * scale]);
    if (i >= 0) {
      at.push(x, y, z, scale);
      seeds.push(d.rng() * 10);
    }
    return i;
  };
  d.animate((f: Frame) => {
    const t = f.clock;
    for (let i = 0; i < seeds.length; i++) {
      const seed = seeds[i];
      const k = 1 + Math.sin(t * 11 + seed) * 0.18 + Math.sin(t * 23 + seed * 2) * 0.1;
      const lean = Math.sin(t * 7 + seed) * 0.12;
      const x = at[i * 4];
      const y = at[i * 4 + 1];
      const z = at[i * 4 + 2];
      const s = at[i * 4 + 3];
      rot[2] = lean;
      sc[0] = 0.16 * s;
      sc[1] = 0.42 * s * k;
      sc[2] = 0.16 * s;
      outer.set(i, x, y + 0.21 * s * k, z, rot, sc);
      sc[0] = 0.08 * s;
      sc[1] = 0.22 * s * k;
      sc[2] = 0.08 * s;
      inner.set(i, x, y + 0.15 * s * k, z, rot, sc);
    }
  });
  return {
    outer,
    inner,
    add,
    finish: () => {
      outer.finish();
      inner.finish();
    },
  };
}

export type Glows = Instancer & { add(x: number, y: number, z: number, normalYaw?: number, radius?: number, flat?: boolean): number };

/**
 * Light pools: unlit transparent discs that never write depth, laid flat on the ground (default) or stood against a
 * wall facing out at the given angle.
 */
export function glows(d: Dress, colour: string, opacity: number, max = 96): Glows {
  const inst = new Instancer(d.THREE, d.geo.disc, d.basic(colour, { transparent: true, opacity: Math.min(1, opacity * 2), depthWrite: false, alphaMap: d.geo.soft }), max) as Glows;
  d.group.add(inst.mesh);
  const rot: [number, number, number] = [0, 0, 0];
  inst.add = (x, y, z, normalYaw = 0, radius = 1, flat = true) => {
    if (flat) {
      rot[0] = -Math.PI / 2;
      rot[1] = 0;
    } else {
      // the disc faces +z at rest; turned to face out at the angle
      rot[0] = 0;
      rot[1] = -normalYaw + Math.PI / 2;
    }
    return inst.push(x, y, z, rot, radius);
  };
  return inst;
}
