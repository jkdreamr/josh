// The contract between the scene and the circle modules under decor/: the scene builds the tower and its ledges,
// then hands each circle a Dress to add its own detail with. Modules never touch the scene or each other.
import type { Three, Tri } from './dress';
import type { T } from './gl';
import type { Level, Palette, Platform, Zone } from './level';
import type { Game } from './logic';

/** What a per frame hook sees: the game, the camera's height and angle, the lava level and whether the climb is won. */
export type Frame = { g: Game; dt: number; clock: number; camY: number; camA: number; lava: number; won: boolean };

/** The shared unit primitives, scaled per mesh. */
export type Geo = {
  box: T.BoxGeometry;
  ball: T.SphereGeometry;
  cone: T.ConeGeometry;
  rod: T.CylinderGeometry;
  ring: T.TorusGeometry;
  disc: T.CircleGeometry;
  plane: T.PlaneGeometry;
  link: T.TorusGeometry;
  /** a radial falloff (white centre to clear rim) for alphaMap on disc glows, so light pools have soft edges */
  soft: T.Texture;
};

/** The shared materials. stone is the vertex coloured flat lambert the static mesh uses. */
export type Mats = {
  iron: T.MeshLambertMaterial;
  darkIron: T.MeshLambertMaterial;
  bone: T.MeshLambertMaterial;
  wood: T.MeshLambertMaterial;
  ice: T.MeshLambertMaterial;
  gold: T.MeshLambertMaterial;
  stoneGrey: T.MeshLambertMaterial;
  /** plain flat stone for loose pieces that carry no vertex colours */
  debris: T.MeshLambertMaterial;
  flame: T.MeshBasicMaterial;
  flameCore: T.MeshBasicMaterial;
  ghost: T.MeshBasicMaterial;
  glass: T.MeshBasicMaterial[];
  vent: T.MeshBasicMaterial;
  cloud: T.MeshLambertMaterial;
  star: T.MeshBasicMaterial;
  chain: T.MeshLambertMaterial;
  stone: T.MeshLambertMaterial;
};

export type Dress = {
  THREE: Three;
  level: Level;
  zone: Zone;
  zi: number;
  palette: Palette;
  /** this circle's ledges, floor excluded, in route order */
  platforms: Platform[];
  /** seeded per circle, so a module's scatter never shifts another's */
  rng: () => number;
  lite: boolean;
  /** the merged static mesh: push flat shaded vertex coloured geometry here (no draw call of its own) */
  statics: Tri;
  /** everything else this circle adds goes in here */
  group: T.Group;
  geo: Geo;
  mats: Mats;
  /** a flat shaded lambert, disposed with the scene */
  flat(color: number | string, extra?: Partial<T.MeshLambertMaterialParameters>): T.MeshLambertMaterial;
  /** an unlit material, disposed with the scene */
  basic(color: number | string, extra?: Partial<T.MeshBasicMaterialParameters>): T.MeshBasicMaterial;
  /** registers anything else for disposal */
  track<X extends T.BufferGeometry | T.Material>(x: X): X;
  /** the core wall's surface radius at a height, and a point on it */
  coreR(y: number): number;
  onCore(a: number, y: number, out?: number): T.Vector3;
  /** a per frame hook, called from the scene after the ledges are synced */
  animate(fn: (f: Frame) => void): void;
};

export type Dresser = (d: Dress) => void;
