// Shared shapes for Wacky Walk. Pure data, no three.js, so every logic module runs under node.

export type Vec3 = { x: number; y: number; z: number };

/** A rigid pose: position plus a row-major 3x3 rotation matrix (local to world). */
export type Pose = { x: number; y: number; z: number; m: number[] };

/** Collision shapes in their own local frame, centered on the pose. Cylinders run along local Y. */
export type Shape =
  | { kind: 'box'; hx: number; hy: number; hz: number }
  | { kind: 'cyl'; r: number; hy: number }
  | { kind: 'sphere'; r: number };

/** What a collider looks like; the scene picks geometry from the shape and a material from this. */
export type Look =
  | 'grass' | 'path' | 'sand' | 'stone' | 'roof' | 'wood' | 'tube' | 'bar' | 'bumper'
  | 'water' | 'wet' | 'hex' | 'gold' | 'coconut' | 'frond' | 'pad' | 'start' | 'finish' | 'hidden';

/** A survival tile: touched once, it cracks, then drops at fallAt and is gone a moment later. */
export type TileState = { layer: number; touchedAt: number | null; fallAt: number | null };

export type Collider = {
  id: number;
  shape: Shape;
  look: Look;
  /** Pose at the current course time (updateCourse writes it), and at the previous step (for carrying riders). */
  pose: Pose;
  prev: Pose;
  /** Moving colliders: writes the pose at course time t into out. Must be a pure function of t (and the build seed). */
  at?: (t: number, out: Pose) => void;
  /** Off colliders neither collide nor draw (a fallen tile, a coconut not yet rolling). */
  on: boolean;
  /** Knockback speed (m/s) when it hits a player; strong hits (>= BIG_HIT) flop them. */
  bounce?: number;
  /** Wet and slippery underfoot. */
  slip?: boolean;
  /** Bounce pad: launches a player that lands on it straight up at this speed. */
  spring?: number;
  tile?: TileState;
  /** Optional per-collider color override for the scene (hex number). */
  tint?: number;
};

export type ZoneKind = 'jet' | 'finish' | 'checkpoint' | 'crown';
/** Trigger volumes (axis aligned boxes). Jets push while on(t); checkpoints carry their index and respawn point. */
export type Zone = {
  kind: ZoneKind;
  x: number; y: number; z: number; hx: number; hy: number; hz: number;
  /** jets: push velocity added per second while inside */
  push?: Vec3;
  on?: (t: number) => boolean;
  /** checkpoints: order along the course (0 is the start), and where to respawn */
  index?: number;
  spawn?: Vec3;
};

/** Bot path node. r: how close counts as reached. jump/dive: do it on the way to this node. lane: half width bots spread across. */
export type Waypoint = { x: number; y: number; z: number; r: number; jump?: boolean; jumpDistance?: number; dive?: boolean; lane?: number; waitFor?: (t: number) => boolean };

/** Render-only scenery. */
export type DecorKind = 'palm' | 'arch' | 'arcade' | 'roof' | 'tower' | 'fountain' | 'tree' | 'lamp' | 'flag' | 'bush' | 'banner' | 'stands' | 'hedge';
export type Decor = { kind: DecorKind; x: number; y: number; z: number; s: number; yaw: number; color?: number };

export type CourseKind = 'race' | 'survival' | 'final';
export type RaceId = 'oval' | 'fountain' | 'palm';
export type CourseId = RaceId | 'tiles' | 'hoover';

export type Course = {
  id: CourseId;
  name: string;
  kind: CourseKind;
  seed: number;
  colliders: Collider[];
  zones: Zone[];
  /** Twenty start spots, best first. */
  spawns: Vec3[];
  /** Facing at the start (yaw, 0 looks down +z). */
  startYaw: number;
  /** Below this you fell off. */
  killY: number;
  /** Seconds before the round is called. */
  limit: number;
  /** Bot route from start to goal (race and final). Survival leaves it empty. */
  path: Waypoint[];
  decor: Decor[];
  /** Ground color under everything far away, and sky top/bottom (hex numbers) for the scene. */
  palette: { ground: number; skyTop: number; skyBottom: number; fog: number };
};

export type BodyState = 'run' | 'air' | 'dive' | 'flop' | 'stun';

/** Step events, bit flags, set during one stepBody call. */
export const EV = { JUMP: 1, LAND: 2, DIVE: 4, HIT: 8, BIG_HIT: 16, GET_UP: 32, SPRING: 64, SPLASH: 128 } as const;

export type Body = {
  /** Feet position. */
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  /** Facing; 0 looks down +z, yaw = atan2(dx, dz). */
  yaw: number;
  state: BodyState;
  stateT: number;
  /** Collider id underfoot, or -1. */
  ground: number;
  coyote: number;
  buffer: number;
  /** 0 to 1, how slippery the ground is this step. */
  slip: number;
  /** Visual spring: > 0 squashed, < 0 stretched; squashV its velocity. */
  squash: number;
  squashV: number;
  /** EV flags from the last step. */
  ev: number;
};

/** One frame of control. mx, mz: wanted move direction in world space, length up to 1. jump and dive: pressed this frame. */
export type Input = { mx: number; mz: number; jump: boolean; dive: boolean };

/** Someone else's capsule, for soft bumps. */
export type Bump = { x: number; y: number; z: number; vx: number; vz: number };

export type Entrant = { id: number; seat: number; name: string; bot: boolean; color: number; skill: number };

export type Phase = 'intro' | 'count' | 'play' | 'outro' | 'done';
