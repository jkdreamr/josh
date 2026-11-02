// Computer players. Each one sees (field of view, line of sight, smoke), hears (shots and running footsteps), buys
// with its credits, plays a role on the uplink, and aims like a person: a reaction delay, an error that settles, a
// limited turn speed that has to fight the recoil, and (on harder levels) stopping before it shoots. In a royale they
// pick a landing spot, jump when the transport passes it, loot what they need, heal up, and keep ahead of the zone.
import {
  DEG,
  buy,
  canShop,
  currentGun,
  eyeY,
  healPick,
  idleInput,
  isEnemy,
  owns,
  priceOf,
  smokeBlocks,
  spareOf,
  spreadOf,
  viewDir,
  wants,
  type Actor,
  type Input,
  type Match,
  type ShopItem,
} from './match.ts';
import { clamp, mulberry32, type Rng } from './noise.ts';
import { fieldDist, fieldStep, fieldTo, findPath } from './nav.ts';
import { blockedAt, clearLine } from './physics.ts';
import { floorAt, heightAt } from './terrain.ts';
import { planeAt } from './royale.ts';
import { WEAPONS, type WeaponId } from './weapons.ts';
import { SITE_R } from './world.ts';

export type BotLevel = 'easy' | 'normal' | 'hard';
type Role = 'entry' | 'support' | 'flank';

export type Brain = {
  level: BotLevel;
  skill: number;
  react: number;
  turn: number;
  rng: Rng;
  reset: boolean;
  think: number;
  target: number;
  seenFor: number;
  lostAt: number;
  lastX: number;
  lastY: number;
  lastZ: number;
  hasLast: boolean;
  errY: number;
  errP: number;
  errT: number;
  head: boolean;
  role: Role;
  viaX: number;
  viaZ: number;
  via: boolean;
  goalX: number;
  goalZ: number;
  /** The planned route (flat x, z pairs), the leg being walked, and what it was planned for. */
  path: number[] | null;
  pathI: number;
  pathGX: number;
  pathGZ: number;
  pathAge: number;
  repath: boolean;
  /** The precomputed distance field that leads to the goal ('' when the goal has none), and a search cooldown. */
  fieldKey: string;
  failT: number;
  wpX: number;
  wpZ: number;
  heading: number;
  moving: boolean;
  strafe: number;
  strafeT: number;
  crouchT: number;
  burst: number;
  restT: number;
  posX: number;
  posZ: number;
  stuckT: number;
  detourT: number;
  detourA: number;
  jump: boolean;
  nadeT: number;
  bought: boolean;
  wander: number;
  /** A random 0 to 1 per round: where on the uplink this bot likes to stand. */
  holdA: number;
  /** Heading toward the last thing it heard, and how long to keep facing it. */
  listenA: number;
  waitT: number;
  /** Royale: where it means to land, the loot it is going for, when to look for more, and a wish to heal. */
  dropX: number;
  dropZ: number;
  loot: number;
  lootT: number;
  healNow: boolean;
};

const LEVELS: Record<BotLevel, { skill: number; react: number; turn: number }> = {
  easy: { skill: 0.22, react: 0.62, turn: 3.2 },
  normal: { skill: 0.55, react: 0.36, turn: 6.5 },
  hard: { skill: 0.86, react: 0.2, turn: 11 },
};

export function newBrain(level: BotLevel, seed: number): Brain {
  const L = LEVELS[level];
  const rng = mulberry32(seed * 977 + 13);
  return {
    level,
    skill: clamp(L.skill + (rng() - 0.5) * 0.12, 0.05, 0.98),
    react: L.react * (0.85 + rng() * 0.3),
    turn: L.turn,
    rng,
    reset: true,
    think: 0,
    target: -1,
    seenFor: 0,
    lostAt: -9,
    lastX: 0,
    lastY: 0,
    lastZ: 0,
    hasLast: false,
    errY: 0,
    errP: 0,
    errT: 0,
    head: false,
    role: 'entry',
    viaX: 0,
    viaZ: 0,
    via: false,
    goalX: 0,
    goalZ: 0,
    path: null,
    pathI: 0,
    pathGX: 0,
    pathGZ: 0,
    pathAge: 0,
    repath: true,
    fieldKey: '',
    failT: 0,
    wpX: 0,
    wpZ: 0,
    heading: 0,
    moving: false,
    strafe: 1,
    strafeT: 0,
    crouchT: 0,
    burst: 0,
    restT: 0,
    posX: 0,
    posZ: 0,
    stuckT: 0,
    detourT: 0,
    detourA: 0,
    jump: false,
    nadeT: 3,
    bought: false,
    wander: 0,
    holdA: 0,
    listenA: 0,
    waitT: 0,
    dropX: 0,
    dropZ: 0,
    loot: -1,
    lootT: 0,
    healNow: false,
  };
}

const angDiff = (a: number, b: number) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

/** The yaw that faces along a world heading (sin a, cos a). */
const yawOf = (a: number) => Math.atan2(-Math.sin(a), -Math.cos(a));

/** Preferred fighting distance for a gun, and the farthest it is worth shooting. */
const PREF: Record<WeaponId, number> = { wren: 14, bulwark: 18, hornet: 14, mauler: 6, kestrel: 30, lancer: 45, longbow: 60 };
const REACH: Record<WeaponId, number> = { wren: 45, bulwark: 60, hornet: 55, mauler: 22, kestrel: 150, lancer: 210, longbow: 260 };

function shop(m: Match, a: Actor, br: Brain) {
  br.bought = true;
  if (!canShop(m, a)) return;
  const r = br.rng;
  const team = m.actors.filter((o) => o.team === a.team);
  const avg = team.reduce((s, o) => s + o.credits, 0) / team.length;
  const want: ShopItem[] = [];
  if (m.round === 1) {
    if (r() < 0.45) want.push('bulwark');
    else want.push('light', r() < 0.5 ? 'frag' : 'smoke');
  } else if (!a.guns[0]) {
    const eco = avg < 2500 && a.credits < 3900;
    if (eco) {
      if (a.credits >= 1200 && r() < 0.4) want.push('bulwark');
      else if (a.credits >= 2000 && r() < 0.5) want.push(r() < 0.6 ? 'hornet' : 'mauler', 'light');
    } else {
      let gun: WeaponId;
      const roll = r();
      if (a.credits >= 5600 && roll < (br.level === 'hard' ? 0.2 : 0.1)) gun = 'longbow';
      else if (a.credits >= 3900) gun = roll < 0.72 ? 'kestrel' : 'lancer';
      else if (a.credits >= 2400) gun = roll < 0.4 ? 'lancer' : roll < 0.75 ? 'hornet' : 'mauler';
      else gun = roll < 0.6 ? 'hornet' : 'mauler';
      want.push(gun, 'heavy', 'light', 'frag', 'smoke');
    }
  } else want.push('heavy', 'light', 'frag', 'smoke');
  for (const item of want) {
    if (owns(a, item)) continue;
    if (item === 'light' && owns(a, 'heavy')) continue;
    if (a.credits >= priceOf(item)) buy(m, a, item);
  }
}

/** Is a short step in this world direction walkable? */
function free(m: Match, a: Actor, ang: number, dist: number) {
  const w = m.world;
  const t = w.terrain;
  const sx = Math.sin(ang);
  const sz = Math.cos(ang);
  let y = a.body.y;
  for (const d of [dist * 0.5, dist]) {
    const x = a.body.x + sx * d;
    const z = a.body.z + sz * d;
    if (Math.abs(x) > w.arena - 1 || Math.abs(z) > w.arena - 1) return false;
    const g = floorAt(t, x, z);
    if (g - y > 1.1 * (d / (dist * 0.5))) return false;
    // deep water is out, except in a royale where swimming beats waiting for the zone
    if (t.hasWater && !t.ice && heightAt(t, x, z) < t.water - 1.05 && m.mode !== 'royale') return false;
    if (blockedAt(w, x, z, Math.max(g, y))) return false;
    y = Math.max(g, y - 1);
  }
  return true;
}

/** Path searches this frame, across all bots: long ones are spread over frames so none of them stalls one. */
let searchFrame = -1;
let searches = 0;

/** Keeps a route to the goal and points the next waypoint. */
function route(m: Match, a: Actor, br: Brain) {
  br.pathAge += br.think;
  // far from a goal with a precomputed distance field (an uplink, a roaming hub): walk down it instead of searching
  if (br.fieldKey && Math.hypot(br.goalX - a.body.x, br.goalZ - a.body.z) > 14) {
    const p = fieldPoint(m, br.fieldKey);
    if (p) {
      const next = fieldStep(m.world, fieldTo(m.world, br.fieldKey, p.x, p.z), a.body.x, a.body.z);
      if (next) {
        br.wpX = next[0];
        br.wpZ = next[1];
        br.path = null;
        br.repath = true;
        return;
      }
    }
  }
  const moved = Math.hypot(br.goalX - br.pathGX, br.goalZ - br.pathGZ) > 4;
  br.failT -= br.think;
  if ((!br.path || moved || br.repath || br.pathAge > 9) && br.failT <= 0) {
    if (searchFrame !== m.time) {
      searchFrame = m.time;
      searches = 0;
    }
    if (searches >= 1 && br.path) {
      // someone else searched this frame: keep walking the old route a little longer
    } else if (searches >= 1) {
      br.wpX = br.goalX;
      br.wpZ = br.goalZ;
      return;
    } else {
      searches++;
      br.path = findPath(m.world, a.body.x, a.body.z, br.goalX, br.goalZ, m.mode === 'royale' ? 2200 : 3500);
      if (!br.path) br.failT = 2;
      br.pathI = 0;
      br.pathGX = br.goalX;
      br.pathGZ = br.goalZ;
      br.pathAge = 0;
      br.repath = false;
    }
  }
  const p = br.path;
  if (!p) {
    // no way there: drop a flank or a chase that leads nowhere, and head for the uplink instead
    br.via = false;
    br.hasLast = false;
    br.waitT = 0;
    if (m.mode === 'uplink') {
      const s = m.world.sites[m.site];
      setGoal(m, br, s.x, s.z, `site${m.site}`);
    } else br.wander = 0;
    br.repath = true;
    br.wpX = br.goalX;
    br.wpZ = br.goalZ;
    return;
  }
  while (br.pathI < p.length - 2 && Math.hypot(p[br.pathI] - a.body.x, p[br.pathI + 1] - a.body.z) < 2.4) br.pathI += 2;
  br.wpX = p[br.pathI];
  br.wpZ = p[br.pathI + 1];
  if (Math.hypot(br.wpX - a.body.x, br.wpZ - a.body.z) > 36) br.repath = true;
}

/** The point a field key leads to. */
function fieldPoint(m: Match, key: string) {
  const k = Number(key.slice(key.startsWith('site') ? 4 : 2));
  return key.startsWith('site') ? m.world.sites[k] : m.world.dmSpawns[k];
}

/** Picks a heading toward the next waypoint that is not blocked. */
function steer(m: Match, a: Actor, br: Brain) {
  const dx = br.wpX - a.body.x;
  const dz = br.wpZ - a.body.z;
  const want = Math.atan2(dx, dz);
  // look only as far as the waypoint, so a doorway right ahead doesn't read as the wall beside it
  const look = clamp(Math.hypot(dx, dz) - 0.2, 0.8, 2.6);
  for (const off of [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4, 2, -2]) {
    const ang = want + off * (br.strafe > 0 ? 1 : -1);
    if (free(m, a, ang, look)) {
      br.heading = ang;
      return;
    }
  }
  br.heading = want + Math.PI * (br.rng() < 0.5 ? 0.6 : -0.6);
}

function setGoal(m: Match, br: Brain, x: number, z: number, fieldKey = '') {
  const A = m.world.arena;
  br.goalX = clamp(x, -A + 3, A - 3);
  br.goalZ = clamp(z, -A + 3, A - 3);
  br.fieldKey = fieldKey;
}

/** Deathmatch roaming points that have distance fields. */
export const DM_HUBS = 8;

/** Looks for the best enemy in view. */
function perceive(m: Match, a: Actor, br: Brain) {
  const w = m.world;
  const ex = a.body.x;
  const ey = eyeY(a);
  const ez = a.body.z;
  const fw = viewDir(a.yaw, 0);
  let best = -1;
  let bestScore = Infinity;
  // a royale bot still gearing up picks its fights: only close ones, or whoever shoots it
  const geared = m.mode !== 'royale' || ((!!a.guns[0] || !!a.guns[2]) && (a.vest > 0 || a.helmet > 0));
  const range = m.mode !== 'royale' ? 230 : geared ? 130 : a.guns[0] || a.guns[2] ? 45 : 28;
  for (const o of m.actors) {
    if (!o.alive || !isEnemy(a, o) || o.drop === 1) continue;
    const dx = o.body.x - ex;
    const dz = o.body.z - ez;
    const d = Math.hypot(dx, dz);
    const known = o.id === br.target || (a.hurtFrom === o.id && m.time - a.hurtT < 2);
    if (d > (known ? 230 : range)) continue;
    // the first while after landing goes on looting, not on picking fights
    if (!known && m.mode === 'royale' && m.time - a.dropT < 22 && d > 7) continue;
    const facing = (dx * fw.x + dz * fw.z) / (d || 1);
    if (!known && facing < 0.34 && d > 5) continue;
    // far, crouched or still targets take longer to notice
    if (!known && d > 40) {
      const still = Math.hypot(o.body.vx, o.body.vz) < 1;
      const p = (1.6 - d / 200) * (still ? 0.55 : 1) * (o.crouch > 0.5 ? 0.7 : 1) * (0.6 + br.skill * 0.6) * (m.mode === 'royale' ? 0.55 : 1);
      if (br.rng() > p) continue;
    } else if (!known && m.mode === 'royale' && d > 6 && br.rng() > 0.3 + br.skill * 0.3) continue; // busy looting: takes a moment to notice
    const chest = o.body.y + o.body.height * 0.68;
    const head = o.body.y + o.body.height - 0.13;
    if (smokeBlocks(m, ex, ey, ez, o.body.x, chest, o.body.z)) continue;
    const seeChest = clearLine(w, ex, ey, ez, o.body.x, chest, o.body.z);
    if (!seeChest && !clearLine(w, ex, ey, ez, o.body.x, head, o.body.z)) continue;
    let score = d * (o.id === br.target ? 0.55 : 1) * (o.bot ? 1 : 0.9);
    if (!seeChest) score *= 1.4;
    if (score < bestScore) {
      bestScore = score;
      best = o.id;
    }
  }
  if (best !== br.target) {
    if (best >= 0) {
      // a new target: the aim starts off by an error that shrinks as the bot settles
      const o = m.actors[best];
      const d = Math.hypot(o.body.x - ex, o.body.z - ez);
      const e = ((1 - br.skill) * 0.09 + 0.012 + d * 0.0002) * (m.mode === 'royale' ? 1.5 : 1);
      br.errY = (br.rng() - 0.5) * 2 * e;
      br.errP = (br.rng() - 0.5) * e;
      br.seenFor = br.target >= 0 && m.time - br.lostAt < 0.8 ? br.react : 0;
      br.head = br.rng() < br.skill * 0.6;
    }
    if (br.target >= 0 && best < 0) {
      br.lostAt = m.time;
      br.repath = true;
    }
    br.target = best;
  }
  if (best >= 0) {
    const o = m.actors[best];
    br.lastX = o.body.x;
    br.lastY = o.body.y;
    br.lastZ = o.body.z;
    br.hasLast = true;
  }
}

/** Where the bot wants to go when nobody is in sight. */
function plan(m: Match, a: Actor, br: Brain) {
  const r = br.rng;
  // chase what we lost, for a while
  if (br.hasLast && m.time - br.lostAt < 5 && Math.hypot(br.lastX - a.body.x, br.lastZ - a.body.z) < 45) {
    setGoal(m, br, br.lastX, br.lastZ);
    return;
  }
  // a loud sound from an enemy
  for (const s of m.sounds) {
    if (s.team === a.team || s.who === a.id) continue;
    const d = Math.hypot(s.x - a.body.x, s.z - a.body.z);
    if (d < s.range && d > 4 && r() < (m.mode === 'royale' ? (a.vest > 0 && (a.guns[0] || a.guns[2]) ? 0.3 : 0) : 0.5)) {
      br.listenA = Math.atan2(s.x - a.body.x, s.z - a.body.z);
      if (m.mode === 'dm' || d < (m.mode === 'royale' ? 55 : 30)) setGoal(m, br, s.x, s.z);
      br.waitT = 0.6;
      return;
    }
  }
  if (m.mode === 'royale') {
    planRoyale(m, a, br);
    return;
  }
  if (m.mode === 'dm') {
    br.wander -= 0.25;
    if (br.wander <= 0 || Math.hypot(br.goalX - a.body.x, br.goalZ - a.body.z) < 4) {
      br.wander = 12 + r() * 10;
      const k = Math.floor(r() * Math.min(DM_HUBS, m.world.dmSpawns.length));
      const p = m.world.dmSpawns[k];
      setGoal(m, br, p.x, p.z, `dm${k}`);
    }
    return;
  }
  if (m.phase !== 'live') return;
  const s = m.world.sites[m.site];
  const enemy = 1 - a.team;
  const theyCap = m.onSite[enemy] > 0;
  const weHold = m.onSite[a.team] > 0;
  const dSite = Math.hypot(s.x - a.body.x, s.z - a.body.z);
  if (theyCap || br.role === 'entry' || dSite < SITE_R * 2.2) {
    if (weHold && !theyCap && br.role !== 'entry') {
      // guard the uplink from its edge, facing out toward the other spawn
      const sp = m.world.spawns[enemy];
      const out = Math.atan2(sp.x - s.x, sp.z - s.z) + (br.holdA - 0.5) * 1.6;
      setGoal(m, br, s.x + Math.sin(out) * SITE_R * 0.75, s.z + Math.cos(out) * SITE_R * 0.75, `site${m.site}`);
    } else setGoal(m, br, s.x + (br.holdA - 0.5) * SITE_R, s.z + (r() - 0.5) * SITE_R * 0.6, `site${m.site}`);
    br.via = false;
    return;
  }
  if (br.role === 'flank' && br.via) {
    if (Math.hypot(br.viaX - a.body.x, br.viaZ - a.body.z) < 6) br.via = false;
    else {
      setGoal(m, br, br.viaX, br.viaZ);
      return;
    }
  }
  if (br.role === 'support') {
    // trail the entry players until they reach the uplink, or the clock runs down
    const lead = m.actors.filter((o) => o.alive && o.team === a.team && o.brain?.role === 'entry');
    const ahead = lead.some((o) => Math.hypot(s.x - o.body.x, s.z - o.body.z) < dSite - 12);
    if (!ahead && m.phaseT < 75) {
      setGoal(m, br, s.x, s.z, `site${m.site}`);
      return;
    }
    if (lead.length && ahead) {
      const o = lead[0];
      setGoal(m, br, o.body.x - (s.x - o.body.x) * 0.2, o.body.z - (s.z - o.body.z) * 0.2);
      return;
    }
  }
  setGoal(m, br, s.x, s.z, `site${m.site}`);
}

/** Royale, nobody in sight: stay ahead of the zone, heal when hurt, gear up, else drift toward the middle of the zone. */
function planRoyale(m: Match, a: Actor, br: Brain) {
  const z = m.zone!;
  const r = br.rng;
  const b = a.body;
  const dz = Math.hypot(b.x - z.x, b.z - z.z);
  const dn = Math.hypot(b.x - z.nx, b.z - z.nz);
  const late = z.shrinking || z.t < 22;
  br.healNow = a.hp < 72 && !!healPick(a) && dz < z.r - 4;
  // out of the zone (or soon to be): head in
  if (dz > z.r - 6 || (late && dn > z.nr - 8 && z.nr > 0)) {
    const tx = z.nr > 0 ? z.nx : z.x;
    const tz = z.nr > 0 ? z.nz : z.z;
    const rad = Math.max(0, (z.nr > 0 ? z.nr : z.r) * 0.45);
    if (Math.hypot(br.goalX - tx, br.goalZ - tz) > rad + 4 || br.loot >= 0) {
      const ang = r() * Math.PI * 2;
      const k = Math.sqrt(r()) * rad;
      setGoal(m, br, tx + Math.cos(ang) * k, tz + Math.sin(ang) * k);
    }
    br.loot = -1;
    return;
  }
  if (br.healNow) {
    setGoal(m, br, b.x, b.z);
    return;
  }
  // the loot it is after still there and still wanted?
  const cur = br.loot >= 0 ? m.loot[br.loot] : null;
  if (cur && (!cur.live || !wants(a, cur))) br.loot = -1;
  br.lootT -= br.think;
  if (br.loot < 0 && br.lootT <= 0) {
    br.lootT = 1.2 + r() * 0.8;
    let best = -1;
    let bestD = Infinity;
    // guns count as much nearer while empty handed
    const need = !a.guns[0] && !a.guns[2] ? 0.35 : 1;
    for (const it of m.loot) {
      if (!it.live) continue;
      const d = Math.abs(it.x - b.x) + Math.abs(it.z - b.z);
      if (d > 90) continue;
      const dd = d * (it.kind === 'gun' ? need : 1);
      if (dd >= bestD) continue;
      if (Math.hypot(it.x - z.x, it.z - z.z) > z.r - 4 || !wants(a, it)) continue;
      bestD = dd;
      best = it.id;
    }
    br.loot = best;
  }
  if (br.loot >= 0) {
    const it = m.loot[br.loot];
    setGoal(m, br, it.x, it.z);
    return;
  }
  // nothing to do: drift toward somewhere inside the next circle, a little at a time
  br.wander -= 0.25;
  if (br.wander <= 0 || Math.hypot(br.goalX - b.x, br.goalZ - b.z) < 4) {
    br.wander = 8 + r() * 10;
    const tx = z.nr > 0 ? z.nx : z.x;
    const tz = z.nr > 0 ? z.nz : z.z;
    const ang = r() * Math.PI * 2;
    const k = Math.sqrt(r()) * Math.max(10, (z.nr > 0 ? z.nr : z.r) * 0.7);
    const gx = tx + Math.cos(ang) * k;
    const gz = tz + Math.sin(ang) * k;
    const l = Math.hypot(gx - b.x, gz - b.z) || 1;
    const step = Math.min(l, 50 + r() * 30);
    setGoal(m, br, b.x + ((gx - b.x) / l) * step, b.z + ((gz - b.z) / l) * step);
  }
}

/** Landing spots already picked in a match, counted per grid cell. */
const dropClaims = new WeakMap<Match, Uint8Array>();

/** Royale, still in the air: pick a spot, jump when the transport passes it, then dive and glide to it. */
function dropInput(m: Match, a: Actor, br: Brain, inp: Input, dt: number) {
  const r = br.rng;
  if (br.reset) {
    br.reset = false;
    // a loot spot, the least crowded of a few: everyone spreads out instead of piling onto one roof
    const L = m.world.loot;
    const spots = L.length / 3;
    // landings so far, counted on a coarse grid
    const G = 24;
    const gn = Math.ceil((2 * m.world.arena) / G) + 1;
    let claims = dropClaims.get(m);
    if (!claims) dropClaims.set(m, (claims = new Uint8Array(gn * gn)));
    const cell = (x: number, z: number) => clamp(Math.floor((z + m.world.arena) / G), 0, gn - 1) * gn + clamp(Math.floor((x + m.world.arena) / G), 0, gn - 1);
    const crowd = (x: number, z: number) => {
      const c = cell(x, z);
      const ci = c % gn;
      const cj = (c - ci) / gn;
      let n = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const i = ci + di;
        const j = cj + dj;
        if (i >= 0 && j >= 0 && i < gn && j < gn) n += claims![j * gn + i] * (di || dj ? 1 : 3);
      }
      return n;
    };
    let bx = (r() - 0.5) * m.world.arena;
    let bz = (r() - 0.5) * m.world.arena;
    let bestScore = -Infinity;
    // only spots within gliding reach of the flight line
    const p = m.plane;
    const reach = (x: number, z: number) => (p ? Math.abs((x - p.ax) * -(p.bz - p.az) + (z - p.az) * (p.bx - p.ax)) / p.len : 0);
    for (let tries = 0; tries < (spots ? 40 : 0); tries++) {
      const k = Math.floor(r() * spots) * 3;
      if (reach(L[k], L[k + 2]) > 220 || L[k + 1] < m.world.terrain.water + 0.3) continue;
      const score = -crowd(L[k], L[k + 2]) + r() * 1.5;
      if (score > bestScore) {
        bestScore = score;
        bx = L[k];
        bz = L[k + 2];
      }
    }
    claims[cell(bx, bz)]++;
    br.dropX = bx + (r() - 0.5) * 12;
    br.dropZ = bz + (r() - 0.5) * 12;
    br.loot = -1;
    br.lootT = 0;
  }
  if (a.drop === 1) {
    const p = m.plane;
    if (!p) return inp;
    // jump once the transport is about abeam of the spot; a spot too far off the line moves nearer it
    const at = planeAt(p, m.time);
    const ux = (p.bx - p.ax) / p.len;
    const uz = (p.bz - p.az) / p.len;
    const ahead = (br.dropX - at.x) * ux + (br.dropZ - at.z) * uz;
    const side = Math.abs((br.dropX - at.x) * -uz + (br.dropZ - at.z) * ux);
    if (ahead < 30 + side * 0.15) inp.jump = r() < dt * 4;
    return inp;
  }
  // in the air: face the spot, dive at it, then glide down
  const dx = br.dropX - a.body.x;
  const dz = br.dropZ - a.body.z;
  const d = Math.hypot(dx, dz);
  const want = Math.atan2(-dx, -dz);
  inp.yaw = a.yaw + clamp(angDiff(a.yaw, want), -dt * 3, dt * 3);
  inp.pitch = a.drop === 2 ? -1.1 : -0.3;
  inp.mz = d > 8 ? 1 : 0;
  return inp;
}

function roundReset(m: Match, a: Actor, br: Brain) {
  br.reset = false;
  br.bought = false;
  br.target = -1;
  br.hasLast = false;
  br.burst = 0;
  br.restT = 0;
  br.detourT = 0;
  br.stuckT = 0;
  br.posX = a.body.x;
  br.posZ = a.body.z;
  br.path = null;
  br.repath = true;
  br.nadeT = 4 + br.rng() * 6;
  br.holdA = br.rng();
  const mates = m.actors.filter((o) => o.team === a.team);
  const k = mates.indexOf(a);
  br.role = k % 5 === 1 || k % 5 === 2 ? 'entry' : k % 5 === 3 ? 'flank' : 'support';
  if (m.mode === 'uplink') {
    const s = m.world.sites[m.site];
    const sp = m.world.spawns[a.team];
    const mx = (s.x + sp.x) / 2;
    const mz = (s.z + sp.z) / 2;
    const l = Math.hypot(s.x - sp.x, s.z - sp.z) || 1;
    const side = br.rng() < 0.5 ? 1 : -1;
    const A = m.world.arena;
    br.viaX = clamp(mx + (-(s.z - sp.z) / l) * 42 * side, -A + 8, A - 8);
    br.viaZ = clamp(mz + ((s.x - sp.x) / l) * 42 * side, -A + 8, A - 8);
    // a flank point is only worth it when it is reachable and not much of a detour
    const field = fieldTo(m.world, `site${m.site}`, s.x, s.z);
    const direct = fieldDist(m.world, field, sp.x, sp.z);
    const around = Math.hypot(br.viaX - sp.x, br.viaZ - sp.z) + fieldDist(m.world, field, br.viaX, br.viaZ);
    br.via = br.role === 'flank' && Number.isFinite(around) && around < direct * 1.5;
    setGoal(m, br, s.x, s.z, `site${m.site}`);
  } else setGoal(m, br, a.body.x, a.body.z);
}

/** One frame of a bot's decisions, as the same input a player would give. */
export function botInput(m: Match, a: Actor, dt: number): Input {
  const br = a.brain!;
  const inp = idleInput(a.yaw, a.pitch);
  if (!a.alive) {
    br.reset = m.mode === 'dm' ? true : br.reset;
    return inp;
  }
  if (m.mode === 'royale' && a.drop) return dropInput(m, a, br, inp, dt);
  if (br.reset) roundReset(m, a, br);
  const r = br.rng;
  if (m.mode === 'uplink' && m.phase === 'buy') {
    if (!br.bought && m.phaseT < 13) shop(m, a, br);
    // mill about and face the field
    const s = m.world.sites[m.site];
    const ang = Math.atan2(s.x - a.body.x, s.z - a.body.z);
    inp.yaw = a.yaw + angDiff(a.yaw, yawOf(ang)) * Math.min(1, dt * 3);
    inp.pitch = a.pitch * (1 - Math.min(1, dt * 3));
    if (a.guns[0] && a.slot !== 0) inp.slot = 0;
    return inp;
  }
  if (m.mode === 'uplink' && m.phase !== 'live') {
    inp.yaw = a.yaw;
    return inp;
  }
  br.think -= dt;
  br.nadeT -= dt;
  br.strafeT -= dt;
  br.detourT -= dt;
  br.restT -= dt;
  br.waitT -= dt;
  if (br.think <= 0) {
    br.think = 0.32 - br.skill * 0.2 + r() * 0.05;
    // far from you in a royale nobody sees the difference: think half as often
    if (m.mode === 'royale' && br.target < 0 && Math.hypot(a.body.x - m.actors[0].body.x, a.body.z - m.actors[0].body.z) > 160) br.think *= 2;
    perceive(m, a, br);
    // empty handed in a royale: keep looking for a gun even with someone in sight
    if (br.target < 0 || (m.mode === 'royale' && !currentGun(a))) plan(m, a, br);
    route(m, a, br);
    if (br.detourT <= 0) steer(m, a, br);
    // stuck: walked under a second's worth less than half a meter while trying to move
    br.stuckT += br.think;
    if (br.stuckT > 1.1) {
      const moved = Math.hypot(a.body.x - br.posX, a.body.z - br.posZ);
      if (br.moving && moved < 0.6) {
        br.detourT = 0.9 + r() * 0.8;
        br.detourA = br.heading + (r() < 0.5 ? 1 : -1) * (1.6 + r() * 1.2);
        br.jump = true;
        br.repath = true;
      }
      br.stuckT = 0;
      br.posX = a.body.x;
      br.posZ = a.body.z;
    }
  }
  // a long gun with rounds beats the sidearm; a gun with nothing left gets swapped for one that has some
  const loaded = (k: number) => !!a.guns[k] && (a.guns[k]!.mag > 0 || spareOf(m, a, a.guns[k]!) > 0);
  if (a.slot === 1 || !loaded(a.slot)) {
    const k = loaded(0) ? 0 : loaded(2) ? 2 : loaded(1) ? 1 : -1;
    if (k >= 0 && k !== a.slot) inp.slot = k;
  }
  const g = currentGun(a);
  const w = g ? WEAPONS[g.id] : WEAPONS.wren;

  const tgt = br.target >= 0 ? m.actors[br.target] : null;
  // royale: pick up what it came for (or anything wanted at its feet), and heal in a quiet moment
  if (m.mode === 'royale') {
    const it = br.loot >= 0 ? m.loot[br.loot] : null;
    if (it && it.live && Math.hypot(it.x - a.body.x, it.z - a.body.z) < 1.9) inp.use = true;
    else if (!tgt)
      for (const o of m.loot)
        if (o.live && Math.abs(o.x - a.body.x) < 1.3 && Math.abs(o.z - a.body.z) < 1.3 && wants(a, o)) {
          inp.use = true;
          break;
        }
    if (!tgt && br.healNow && a.healT <= 0) inp.heal = true;
  }
  let wantYaw = a.yaw;
  let wantPitch = 0;
  let moveAng = br.detourT > 0 ? br.detourA : br.heading;
  br.moving = true;
  let walk = false;
  if (tgt && tgt.alive && g) {
    br.seenFor += dt;
    const dx = tgt.body.x - a.body.x;
    const dz = tgt.body.z - a.body.z;
    const d = Math.hypot(dx, dz);
    // aim point: chest, or the head for the good ones; lead and drop by skill
    const tof = d / w.speed;
    const lead = br.skill * tof;
    const tx = tgt.body.x + tgt.body.vx * lead;
    const tz = tgt.body.z + tgt.body.vz * lead;
    const ty = (br.head ? tgt.body.y + tgt.body.height - 0.13 : tgt.body.y + tgt.body.height * 0.66) + br.skill * 4.9 * tof * tof;
    const ax = tx - a.body.x;
    const az = tz - a.body.z;
    const ay = ty - eyeY(a);
    wantYaw = Math.atan2(-ax, -az);
    wantPitch = Math.atan2(ay, Math.hypot(ax, az));
    // error settles, with a little jitter for the worse bots
    const settle = (1.2 + br.skill * 4.5) * (m.mode === 'royale' ? 0.55 : 1);
    br.errY *= Math.exp(-settle * dt);
    br.errP *= Math.exp(-settle * dt);
    br.errT -= dt;
    if (br.errT <= 0) {
      br.errT = 0.25 + r() * 0.3;
      const tv = Math.hypot(tgt.body.vx, tgt.body.vz);
      const j = ((1 - br.skill) * 0.01 + tv * 0.0015 * (1 - br.skill * 0.6)) * (m.mode === 'royale' ? 1.8 : 1);
      br.errY += (r() - 0.5) * 2 * j;
      br.errP += (r() - 0.5) * j;
    }
    wantYaw += br.errY;
    wantPitch += br.errP;
    // fighting movement: hold range, strafe between bursts, stop to shoot when good enough
    const pref = PREF[g?.id ?? 'wren'];
    if (br.strafeT <= 0) {
      br.strafeT = 0.35 + r() * 0.9;
      br.strafe = r() < 0.5 ? -1 : 1;
      br.crouchT = r() < br.skill * 0.35 ? 0.6 + r() * 1.2 : 0;
    }
    const toward = Math.atan2(dx, dz);
    const reach = REACH[g?.id ?? 'wren'];
    moveAng = toward + (Math.PI / 2) * br.strafe;
    if (!g) moveAng = toward + Math.PI + 0.5 * br.strafe;
    else if (d > pref + 12) moveAng = toward + (d > reach ? 0.15 : 0.5) * br.strafe;
    else if (d < pref * 0.5) moveAng = toward + Math.PI - 0.6 * br.strafe;
    if (!free(m, a, moveAng, 1.6)) moveAng = toward - (Math.PI / 2) * br.strafe;
    // ready to shoot?
    const ready = br.seenFor >= br.react;
    const errNow = Math.hypot(angDiff(a.yaw, wantYaw - br.errY), (a.pitch - (wantPitch - br.errP)) * 1.2);
    const tol = Math.atan2(0.32, Math.max(1, d)) + spreadOf(a) * DEG * 0.35 + (1 - br.skill) * 0.03;
    const scoped = w.scope || w.cls === 'rifle';
    inp.ads = scoped && d > 22 && br.skill > 0.3;
    if (w.cls === 'sniper') inp.ads = d > 8;
    const aligned = errNow < tol && (!w.scope || a.ads > 0.9 || !inp.ads);
    // only in range, and (unless panicking up close) only once the cone is tight enough to land at this distance
    const cone = spreadOf(a) * DEG * d;
    const patience = d > 12 && br.skill > 0.3 && cone > 0.42 + (1 - br.skill) * 0.9;
    let shoot = ready && aligned && !!g && g.mag > 0 && a.reloadT <= 0 && d < reach * (0.75 + br.skill * 0.25) && !patience;
    if (shoot && w.auto && d > 26) {
      // bursts at range
      if (br.restT > 0) shoot = false;
      else if (br.burst <= 0) br.burst = 3 + Math.floor(r() * (3 + br.skill * 3));
    }
    if (shoot) {
      if (w.auto) {
        inp.fire = true;
        if (a.fireCd <= 0 && a.switchT <= 0) {
          br.burst--;
          if (br.burst <= 0 && d > 26) br.restT = 0.18 + (1 - br.skill) * 0.35;
        }
      } else inp.fire = !a.fireHeld && a.fireCd <= 0;
      // the good ones stop dead to shoot; the rest at least slow to a walk
      if (br.skill > 0.45) moveAng = NaN;
      walk = true;
    }
    if (br.crouchT > 0) {
      br.crouchT -= dt;
      inp.crouch = d > 6;
    }
    if (g && g.mag === 0) inp.reload = true;
    // a frag at a target behind cover
    if (m.mode !== 'dm' && a.frags > 0 && br.nadeT <= 0 && br.seenFor > 1 && d > 10 && d < 32 && br.skill > 0.3 && r() < 0.02) {
      wantPitch += 0.25 + d * 0.004;
      inp.throw = 'frag';
      br.nadeT = 8;
    }
  } else {
    br.seenFor = 0;
    br.burst = 0;
    // reload in a quiet moment
    if (g && g.mag < WEAPONS[g.id].mag * 0.5 && spareOf(m, a, g) > 0) inp.reload = true;
    // (empty handed there's nothing to hunt them with: keep running to the loot)
    const lostRecently = br.hasLast && m.time - br.lostAt < 4 && !!g;
    if (lostRecently) {
      const ax = br.lastX - a.body.x;
      const az = br.lastZ - a.body.z;
      wantYaw = Math.atan2(-ax, -az);
      wantPitch = Math.atan2(br.lastY + 1.2 - eyeY(a), Math.hypot(ax, az));
      walk = br.skill > 0.5;
      // flush them out of cover
      const d = Math.hypot(ax, az);
      if (a.frags > 0 && br.nadeT <= 0 && d > 9 && d < 30 && m.time - br.lostAt > 0.8 && br.skill > 0.3) {
        wantPitch += 0.3 + d * 0.004;
        inp.throw = 'frag';
        br.nadeT = 9;
      }
    } else if (br.waitT > 0) {
      wantYaw = yawOf(br.listenA);
      moveAng = NaN;
    } else {
      // look where we go, and walk the last stretch into the uplink quietly
      wantYaw = yawOf(moveAng);
      wantPitch = -0.04;
      const gd = Math.hypot(br.goalX - a.body.x, br.goalZ - a.body.z);
      if (gd < (m.mode === 'royale' ? 0.9 : 2.2)) {
        moveAng = NaN;
        const sp = m.mode === 'uplink' ? m.world.spawns[1 - a.team] : null;
        if (sp) wantYaw = Math.atan2(-(sp.x - a.body.x), -(sp.z - a.body.z)) + (br.holdA - 0.5) * 1.4;
      }
      if (m.mode === 'uplink' && gd < 30 && br.skill > 0.5 && m.onSite[1 - a.team] === 0) walk = true;
      // a smoke on the way in
      if (m.mode === 'uplink' && a.smokes > 0 && br.role === 'entry' && gd < 45 && gd > 25 && br.nadeT <= 0 && r() < 0.05) {
        inp.throw = 'smoke';
        wantPitch = 0.35;
        br.nadeT = 6;
      }
    }
  }
  // turn toward the wanted view at a limited speed
  const dy = angDiff(a.yaw, wantYaw);
  const dp = wantPitch - a.pitch;
  const k = 1 - Math.exp(-dt * (6 + br.skill * 10));
  const lim = br.turn * dt;
  inp.yaw = a.yaw + clamp(dy * k * 1.4, -lim, lim);
  inp.pitch = a.pitch + clamp(dp * k * 1.4, -lim, lim);
  // move along the chosen world heading, expressed in the bot's own frame
  if (Number.isNaN(moveAng)) {
    br.moving = false;
  } else {
    const gd = Math.hypot(br.goalX - a.body.x, br.goalZ - a.body.z);
    if (!tgt && gd < (m.mode === 'royale' ? 0.9 : 1.6) && br.detourT <= 0) br.moving = false;
    else {
      const wx = Math.sin(moveAng);
      const wz = Math.cos(moveAng);
      const sy = Math.sin(inp.yaw);
      const cy = Math.cos(inp.yaw);
      inp.mz = wx * -sy + wz * -cy;
      inp.mx = wx * cy + wz * -sy;
    }
  }
  inp.walk = walk;
  if (br.jump) {
    inp.jump = true;
    br.jump = false;
  }
  return inp;
}
