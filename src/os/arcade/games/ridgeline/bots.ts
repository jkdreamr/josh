// Computer players. Each one sees (field of view, line of sight, smoke), hears (shots and running footsteps), buys
// with its credits, plays its side in a breach (the attack pushes a site together, plants and guards the charge; the
// defense holds both sites, rotates on a call and retakes to defuse), and aims like a person: a reaction delay, an error that settles, a
// limited turn speed that has to fight the recoil, and (on harder levels) stopping before it shoots. In a royale they
// pick a landing spot, jump when the transport passes it, loot what they need, heal up, and keep ahead of the zone.
import {
  DEFUSE_TIME,
  DEG,
  HALF,
  PLANT_TIME,
  ROUND_TIME,
  buy,
  canDefuse,
  canShop,
  currentGun,
  eyeY,
  healPick,
  idleInput,
  isEnemy,
  owns,
  plantSite,
  priceOf,
  smokeBlocks,
  spareOf,
  spawnOf,
  spreadOf,
  viewDir,
  wants,
  type Actor,
  type Input,
  type Match,
  type ShopItem,
} from './match.ts';
import { clamp, mulberry32, type Rng } from './noise.ts';
import { canWalk, fieldDist, fieldStep, fieldTo, findPath } from './nav.ts';
import { blockedAt, clearLine } from './physics.ts';
import { floorAt, heightAt } from './terrain.ts';
import { planeAt } from './royale.ts';
import { WEAPONS, type WeaponId } from './weapons.ts';
import { SITE_R, type World } from './world.ts';

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
  /** The same over a longer stretch, which also catches pacing back and forth in one spot. */
  longX: number;
  longZ: number;
  longT: number;
  /** How long the waypoint has not been a straight walk away, and a spell of searching instead of following fields. */
  blockT: number;
  noFieldT: number;
  detourT: number;
  detourA: number;
  jump: boolean;
  nadeT: number;
  bought: boolean;
  wander: number;
  /** A random 0 to 1 per round: where on a site this bot likes to stand. */
  holdA: number;
  /** Breach defense: the site this bot holds (-1 the middle), and whether it stays put when the other site is hit. */
  post: number;
  anchor: boolean;
  /** Where to look once at the goal with nobody in sight. */
  faceX: number;
  faceZ: number;
  /** Push to the goal even while fighting (a defuse to stop or to make before the charge blows). */
  rush: boolean;
  /** Breach: keep to the goal in a fight instead of closing in (a spot to hold), and how far from the plan's spot it
   * goes after what it saw or heard. */
  hold: boolean;
  leash: number;
  /** Just threw a flashbang: looks away from it (that way) until it has gone off. */
  flashAway: number;
  awayYaw: number;
  /** How close counts as there: close for the charge (to pick it up or work on it), looser for a spot to hold. */
  arrive: number;
  /** Heading toward the last thing it heard, how long to keep facing it, and when it last stopped to listen. */
  listenA: number;
  waitT: number;
  heardT: number;
  /** Royale: where it means to land, the loot it is going for, when to look for more, and a wish to heal. */
  dropX: number;
  dropZ: number;
  loot: number;
  lootT: number;
  healNow: boolean;
};

const LEVELS: Record<BotLevel, { skill: number; react: number; turn: number }> = {
  // (a person should win most fair fights at Normal: slower to react, slower to turn, and their first shots go wide)
  easy: { skill: 0.14, react: 0.85, turn: 2.6 },
  normal: { skill: 0.4, react: 0.52, turn: 4.8 },
  hard: { skill: 0.74, react: 0.3, turn: 8.5 },
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
    longX: 0,
    longZ: 0,
    longT: 0,
    blockT: 0,
    noFieldT: 0,
    detourT: 0,
    detourA: 0,
    jump: false,
    nadeT: 3,
    bought: false,
    wander: 0,
    holdA: 0,
    post: 0,
    anchor: false,
    faceX: 0,
    faceZ: 0,
    rush: false,
    hold: false,
    leash: 45,
    flashAway: 0,
    awayYaw: 0,
    arrive: 2.2,
    listenA: 0,
    waitT: 0,
    heardT: -9,
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
  if (m.round === 1 || m.round === HALF + 1) {
    if (r() < 0.45) want.push('bulwark');
    else want.push('light', r() < 0.4 ? 'frag' : r() < 0.5 ? 'smoke' : 'flash');
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
      want.push(gun, 'heavy', 'light', 'flash', 'frag', 'smoke');
    }
  } else want.push('heavy', 'light', 'flash', 'frag', 'smoke');
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
  // far from a goal near a point with a precomputed distance field (a site, a roaming hub): walk down the field
  // instead of searching, but only while still well further from that point than the goal is (else the field pulls
  // toward the point and the search back toward the goal, and the bot paces between the two)
  const fp = br.fieldKey && br.noFieldT <= 0 ? fieldPoint(m, br.fieldKey) : null;
  if (fp && Math.hypot(br.goalX - a.body.x, br.goalZ - a.body.z) > 14 && Math.hypot(fp.x - a.body.x, fp.z - a.body.z) > Math.hypot(fp.x - br.goalX, fp.z - br.goalZ) + 16) {
    const next = fieldStep(m.world, fieldTo(m.world, br.fieldKey, fp.x, fp.z), a.body.x, a.body.z);
    if (next) {
      br.wpX = next[0];
      br.wpZ = next[1];
      br.path = null;
      br.repath = true;
      return;
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
    // no way there: drop a flank or a chase that leads nowhere, and head for the objective instead
    br.via = false;
    br.hasLast = false;
    br.waitT = 0;
    if (m.mode === 'breach') {
      const k = siteFor(m, a, br);
      const s = m.world.sites[k];
      setGoal(m, br, s.x, s.z, `site${k}`);
    } else br.wander = 0;
    br.repath = true;
    br.wpX = br.goalX;
    br.wpZ = br.goalZ;
    return;
  }
  // on to the next leg once near this corner, and only if that next point is a straight walk from here (cutting
  // the corner short round the end of a wall walks into it)
  for (;;) {
    if (br.pathI >= p.length - 2) break;
    const d = Math.hypot(p[br.pathI] - a.body.x, p[br.pathI + 1] - a.body.z);
    if (d < 0.8 || (d < 2.4 && canWalk(m.world, a.body.x, a.body.z, p[br.pathI + 2], p[br.pathI + 3]))) br.pathI += 2;
    else break;
  }
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
  // flashed: sees nothing until it clears (it still remembers where they were)
  if (a.blindT > 0.35) {
    if (br.target >= 0) {
      br.lostAt = m.time;
      br.target = -1;
    }
    return;
  }
  // breach: enemy footsteps or shots heard near a site tell the team where the push is
  if (m.mode === 'breach')
    for (const s of m.sounds)
      if (s.team !== a.team && Math.hypot(s.x - ex, s.z - ez) < s.range) {
        callout(m, a.team, s.x, s.z);
        break;
      }
  // a royale bot still gearing up picks its fights: only close ones, or whoever shoots it
  const geared = m.mode !== 'royale' || ((!!a.guns[0] || !!a.guns[2]) && (a.vest > 0 || a.helmet > 0));
  // breach: a stranger further off than this is a few pixels across a field; nobody picks that out (a scope helps)
  const scoped = !!currentGun(a) && WEAPONS[currentGun(a)!.id].scope;
  const range = m.mode === 'breach' ? (scoped ? 95 : 55) : m.mode !== 'royale' ? 230 : geared ? 130 : a.guns[0] || a.guns[2] ? 45 : 28;
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
    // far, crouched or still targets take longer to notice: a chance per look that falls off with distance (about a
    // second to pick out someone running 100 m off, longer if they hold still)
    if (!known && d > 10) {
      const still = Math.hypot(o.body.vx, o.body.vz) < 1;
      // (in a breach, past 30 m it falls off faster still: the fights are meant to be won on angles, not by spotting)
      const far = m.mode === 'breach' && d > 30 ? (30 / d) ** 2 : 1;
      const rate = 7 * (40 / Math.max(d, 14)) ** 2 * far * (still ? 0.5 : 1) * (o.crouch > 0.5 ? 0.7 : 1) * (0.6 + br.skill * 0.6) * (m.mode === 'royale' ? 0.55 : 1);
      if (br.rng() > 1 - Math.exp(-rate * Math.max(0.1, br.think))) continue;
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
      // holding an angle (standing still, already looking where they appear) gives a quicker, truer first shot
      const off = Math.abs(angDiff(a.yaw, Math.atan2(-(o.body.x - ex), -(o.body.z - ez))));
      const holding = Math.hypot(a.body.vx, a.body.vz) < 0.8 && off < 0.35;
      const e = ((1 - br.skill) * 0.12 + 0.016 + d * 0.00026) * (m.mode === 'royale' ? 1.5 : 1) * (holding ? 0.5 : 1);
      br.errY = (br.rng() - 0.5) * 2 * e;
      br.errP = (br.rng() - 0.5) * e;
      br.seenFor = br.target >= 0 && m.time - br.lostAt < 0.8 ? br.react : holding ? br.react * 0.45 : 0;
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
    // tell the team where the push is, and who was seen where
    if (m.mode === 'breach') {
      callout(m, a.team, o.body.x, o.body.z);
      sightings(m, a.team).set(o.id, { x: o.body.x, z: o.body.z, t: m.time });
    }
  }
}

/** Breach: where each enemy was last seen by anyone on a team this round. */
const seenBy = new WeakMap<Match, { round: number; teams: Map<number, { x: number; z: number; t: number }>[] }>();
function sightings(m: Match, team: number) {
  let e = seenBy.get(m);
  if (!e || e.round !== m.round) seenBy.set(m, (e = { round: m.round, teams: [new Map(), new Map()] }));
  return e.teams[team];
}

/** Breach: an enemy seen (or a teammate lost) near a site marks it for the team, which the defense rotates on. */
export function callout(m: Match, team: number, x: number, z: number) {
  for (const s of m.world.sites)
    if (Math.hypot(s.x - x, s.z - z) < 42) {
      m.call[team] = { site: s.id, t: m.time };
      return;
    }
}

/** Breach: the site this bot works toward right now. */
function siteFor(m: Match, a: Actor, br: Brain) {
  const c = m.charge;
  if (c.state === 'planted') return c.site;
  if (a.team === m.attack) {
    // a carrier the bots can't steer (you): go where it goes, once it heads for a site
    const h = c.state === 'carried' ? m.actors[c.holder] : null;
    if (h && !h.bot && h.alive) {
      let near = stageOf(m).site;
      let nd = Infinity;
      for (const s of m.world.sites) {
        const d = Math.hypot(s.x - h.body.x, s.z - h.body.z);
        if (d < nd) {
          nd = d;
          near = s.id;
        }
      }
      if (nd < 55) return near;
    }
    return stageOf(m).site;
  }
  const call = m.call[a.team];
  if (call.site >= 0 && m.time - call.t < 9 && !br.anchor) return call.site;
  if (br.post >= 0) return br.post;
  // the middle: whichever site is nearer
  const [A, B] = m.world.sites;
  return Math.hypot(A.x - a.body.x, A.z - a.body.z) <= Math.hypot(B.x - a.body.x, B.z - a.body.z) ? 0 : 1;
}

/** Breach: where the attack's way in reaches each site (the first point of its route within 24 m), worked out once a
 * round. The defense watches these. */
const entries = new WeakMap<Match, { round: number; attack: number; pts: { x: number; z: number }[] }>();
function entryOf(m: Match, k: number) {
  let e = entries.get(m);
  if (!e || e.round !== m.round || e.attack !== m.attack) {
    const sp = spawnOf(m, m.attack);
    const pts = m.world.sites.map((s) => {
      const f = fieldTo(m.world, `site${s.id}`, s.x, s.z);
      let x = sp.x;
      let z = sp.z;
      for (let i = 0; i < 80 && Math.hypot(x - s.x, z - s.z) > 24; i++) {
        const n = fieldStep(m.world, f, x, z);
        if (!n) break;
        x = n[0];
        z = n[1];
      }
      return { x, z };
    });
    e = { round: m.round, attack: m.attack, pts };
    entries.set(m, e);
  }
  return e.pts[k];
}

/** Breach: the middle, between the sites and `toward` meters toward the attack. */
function midPoint(m: Match, toward = 12) {
  const [A, B] = m.world.sites;
  const sp = spawnOf(m, m.attack);
  const x = (A.x + B.x) / 2;
  const z = (A.z + B.z) / 2;
  const d = Math.hypot(sp.x - x, sp.z - z) || 1;
  return { x: x + ((sp.x - x) / d) * toward, z: z + ((sp.z - z) / d) * toward };
}

/** Where to stand on a site: off to one side of the center toward `from`, `out` meters out. */
function siteSpot(m: Match, k: number, fromX: number, fromZ: number, spread: number, out: number) {
  const s = m.world.sites[k];
  const ang = Math.atan2(fromX - s.x, fromZ - s.z) + spread;
  return { x: s.x + Math.sin(ang) * out, z: s.z + Math.cos(ang) * out };
}

/** Where the bot wants to go when nobody is in sight. */
function plan(m: Match, a: Actor, br: Brain) {
  const r = br.rng;
  if (m.mode === 'breach') {
    planBreach(m, a, br);
    return;
  }
  // chase what we lost, for a while
  if (br.hasLast && m.time - br.lostAt < 5 && Math.hypot(br.lastX - a.body.x, br.lastZ - a.body.z) < 45) {
    setGoal(m, br, br.lastX, br.lastZ);
    return;
  }
  // a loud sound from an enemy: close, go and see; far, a quick look that way and on with the plan (and not again
  // for a few seconds, or a fight going on somewhere would keep it standing there listening)
  if (m.time - br.heardT > 3)
    for (const s of m.sounds) {
      if (s.team === a.team || s.who === a.id) continue;
      const d = Math.hypot(s.x - a.body.x, s.z - a.body.z);
      if (d < s.range && d > 4 && r() < (m.mode === 'royale' ? (a.vest > 0 && (a.guns[0] || a.guns[2]) ? 0.3 : 0) : 0.5)) {
        br.heardT = m.time;
        br.listenA = Math.atan2(s.x - a.body.x, s.z - a.body.z);
        if (m.mode === 'dm' || d < 55) {
          setGoal(m, br, s.x, s.z);
          br.waitT = 0.5;
          return;
        }
        br.waitT = 0.35;
        break;
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
}

/** Breach, nobody in sight: the side's plan first, then a look after what was lost or heard, but only as far from the
 * plan's spot as its leash lets it go (a defender doesn't leave the site to run after a shadow). */
function planBreach(m: Match, a: Actor, br: Brain) {
  if (m.phase !== 'live') return;
  br.hold = false;
  br.leash = 45;
  if (a.team === m.attack) planAttack(m, a, br);
  else planDefense(m, a, br);
  if (br.rush) return;
  const hx = br.goalX;
  const hz = br.goalZ;
  const near = (x: number, z: number) => Math.hypot(x - hx, z - hz) < br.leash;
  if (br.hasLast && m.time - br.lostAt < 5 && Math.hypot(br.lastX - a.body.x, br.lastZ - a.body.z) < 45) {
    if (near(br.lastX, br.lastZ)) {
      setGoal(m, br, br.lastX, br.lastZ);
      return;
    }
    // too far to go after: keep the angle on where it went
    br.faceX = br.lastX;
    br.faceZ = br.lastZ;
  }
  if (m.time - br.heardT > 3)
    for (const s of m.sounds) {
      if (s.team === a.team || s.who === a.id) continue;
      const d = Math.hypot(s.x - a.body.x, s.z - a.body.z);
      if (d < s.range && d > 4 && br.rng() < 0.5) {
        br.heardT = m.time;
        br.listenA = Math.atan2(s.x - a.body.x, s.z - a.body.z);
        // the charge comes first: its carrier, and everyone once it is down, only turn to look
        const busy = m.charge.holder === a.id || m.charge.state === 'planted';
        if (!busy && d < 22 && near(s.x, s.z)) {
          setGoal(m, br, s.x, s.z);
          br.waitT = 0.5;
          return;
        }
        br.waitT = 0.35;
        break;
      }
    }
}

/** Breach: the attack's ways in from one spawn: where it gathers before going onto each site (a spot on its way in,
 * short of the site and out of sight of both sites if the way allows), and whether that way leads close past the
 * other site. Worked out once per map and spawn. */
type Ways = { pts: { x: number; z: number }[]; past: boolean[] };
const ways = new WeakMap<World, Map<number, Ways>>();
function waysIn(m: Match): Ways {
  const w = m.world;
  let byTeam = ways.get(w);
  if (!byTeam) ways.set(w, (byTeam = new Map()));
  const known = byTeam.get(m.attack);
  if (known) return known;
  const sp = spawnOf(m, m.attack);
  const past: boolean[] = [];
  const pts = w.sites.map((s) => {
    const o = w.sites[1 - s.id] ?? s;
    const f = fieldTo(w, `site${s.id}`, s.x, s.z);
    let x = sp.x;
    let z = sp.z;
    let hid: { x: number; z: number } | null = null;
    let fall: { x: number; z: number } | null = null;
    let close = Infinity;
    for (let i = 0; i < 120; i++) {
      const d = fieldDist(w, f, x, z);
      if (d < STAGE_NEAR) break;
      const od = Math.hypot(x - o.x, z - o.z);
      close = Math.min(close, od);
      if (d < STAGE_FAR) {
        if (!fall && d < 50) fall = { x, z };
        // out of sight of the site's middle and of where its holders stand toward here, and the same for the other
        // site when it is near
        const eye = floorAt(w.terrain, x, z) + 1.5;
        let seen = od < 30;
        for (const q of od < 70 && o !== s ? [s, o] : [s]) {
          const ang = Math.atan2(x - q.x, z - q.z);
          for (const [off, r] of [[0, 0], [0, 8], [0.7, 8], [-0.7, 8], [1.4, 9], [-1.4, 9]])
            if (!seen && clearLine(w, q.x + Math.sin(ang + off) * r, q.y + 1.5, q.z + Math.cos(ang + off) * r, x, eye, z)) seen = true;
        }
        if (!seen) hid = { x, z };
      }
      const n = fieldStep(w, f, x, z, 3);
      if (!n) break;
      x = n[0];
      z = n[1];
    }
    past.push(close < 30);
    return hid ?? fall ?? { x, z };
  });
  const out = { pts, past };
  byTeam.set(m.attack, out);
  return out;
}

/** Breach: the attack's call this round: the site it goes for (the one the round drew, but a way in that leads past
 * the other site's guns gets traded for the other most of the time), and whether it has gone in yet. */
const stages = new WeakMap<Match, { round: number; attack: number; pts: { x: number; z: number }[]; site: number; go: boolean; smokes: number; wait: number }>();
function stageOf(m: Match) {
  let e = stages.get(m);
  if (!e || e.round !== m.round || e.attack !== m.attack) {
    const wy = waysIn(m);
    let site = m.aim;
    const other = 1 - site;
    const roll = mulberry32(m.round * 7919 + m.attack * 31 + Math.floor(m.time * 7));
    if (wy.past[site] && other < wy.pts.length && !wy.past[other] && roll() < 0.75) site = other;
    e = { round: m.round, attack: m.attack, pts: wy.pts, site, go: false, smokes: 0, wait: GO_AFTER + roll() * GO_SPREAD };
    stages.set(m, e);
  }
  return e;
}
/** The soonest the attack goes in, in seconds into the round, and how much later it may be. */
const GO_AFTER = 16;
const GO_SPREAD = 14;
/** How far short of a site (walking) the attack gathers, at the nearest and the farthest. */
const STAGE_NEAR = 24;
const STAGE_FAR = 64;

/** Breach: is the attack going in? Once all but one are gathered (or the clock says so, or you have already gone on
 * ahead), and from then on for the round. */
function attackGo(m: Match, team: number, k: number, st: { pts: { x: number; z: number }[]; go: boolean; wait: number }) {
  if (st.go) return true;
  const p = st.pts[k];
  const s = m.world.sites[k];
  const ps = Math.hypot(p.x - s.x, p.z - s.z);
  let alive = 0;
  let there = 0;
  for (const o of m.actors) {
    if (!o.alive || o.team !== team) continue;
    alive++;
    const ds = Math.hypot(o.body.x - s.x, o.body.z - s.z);
    if (Math.hypot(o.body.x - p.x, o.body.z - p.z) < 10 || ds < ps - 4) there++;
    // you, gone in on your own: the team follows
    if (!o.bot && ds < 30) st.go = true;
  }
  // (never before the round's own moment to go, a while in: the defense has to be set before a push means anything,
  // and it shouldn't be able to set its watch by it)
  const t = ROUND_TIME - m.phaseT;
  if ((there >= Math.max(1, alive - 1) && t > st.wait) || t > 45) st.go = true;
  return st.go;
}

/** Breach attack, nobody in sight. */
function planAttack(m: Match, a: Actor, br: Brain) {
  const c = m.charge;
  br.rush = false;
  br.arrive = 2.2;
  if (c.state === 'planted') {
    // someone is on the charge: stop it now
    if (c.defuseBy >= 0) {
      br.rush = true;
      br.via = false;
      setGoal(m, br, c.x, c.z, `site${c.site}`);
      br.faceX = c.x;
      br.faceZ = c.z;
      return;
    }
    // after the plant: hold an angle on the charge from a little way off
    const ang = br.holdA * Math.PI * 2;
    const out = 7 + br.holdA * 7;
    setGoal(m, br, c.x + Math.sin(ang) * out, c.z + Math.cos(ang) * out, `site${c.site}`);
    br.faceX = c.x;
    br.faceZ = c.z;
    br.via = false;
    br.hold = true;
    br.leash = 10;
    return;
  }
  // the charge on the ground: the nearest attacker bot goes to get it
  if (c.state === 'dropped') {
    let near: Actor | null = null;
    let nd = Infinity;
    for (const o of m.actors)
      if (o.alive && o.bot && o.team === a.team) {
        const d = Math.hypot(o.body.x - c.x, o.body.z - c.z);
        if (d < nd) {
          nd = d;
          near = o;
        }
      }
    if (near === a) {
      setGoal(m, br, c.x, c.z);
      br.arrive = 0.5;
      br.via = false;
      return;
    }
  }
  const k = siteFor(m, a, br);
  const s = m.world.sites[k];
  const def = spawnOf(m, 1 - a.team);
  const own = spawnOf(m, a.team);
  // late in the round: everyone in
  const late = m.phaseT < 35;
  br.leash = 20;
  // first the team gathers short of the site, then goes in together, trading as a group instead of one at a time
  const st = stageOf(m);
  const go = late || attackGo(m, a.team, k, st);
  if (!go && !(br.role === 'flank' && br.via)) {
    const p = st.pts[k];
    const ang = br.holdA * Math.PI * 2;
    setGoal(m, br, p.x + Math.sin(ang) * 2.5, p.z + Math.cos(ang) * 2.5, `site${k}`);
    br.faceX = s.x;
    br.faceZ = s.z;
    br.hold = Math.hypot(p.x - a.body.x, p.z - a.body.z) < 8;
    br.leash = 10;
    return;
  }
  // the carrier: to the plant spot, just on the attack's side of the mast (cover from the defense)
  if (c.state === 'carried' && c.holder === a.id) {
    const d = Math.hypot(own.x - s.x, own.z - s.z) || 1;
    setGoal(m, br, s.x + ((own.x - s.x) / d) * 2.2, s.z + ((own.z - s.z) / d) * 2.2, `site${k}`);
    br.faceX = def.x;
    br.faceZ = def.z;
    br.via = false;
    return;
  }
  br.faceX = def.x;
  br.faceZ = def.z;
  if (br.role === 'flank' && br.via && !late) {
    // the lurk: out to the middle, and wait there until the rest go in, then hit the site from the side
    if (go) br.via = false;
    else {
      setGoal(m, br, br.viaX, br.viaZ);
      br.faceX = s.x;
      br.faceZ = s.z;
      br.hold = Math.hypot(br.viaX - a.body.x, br.viaZ - a.body.z) < 8;
      br.leash = 10;
      return;
    }
  }
  const dSite = Math.hypot(s.x - a.body.x, s.z - a.body.z);
  if (br.role === 'support' && !late) {
    // trail the entry players in, a few meters back
    const lead = m.actors.filter((o) => o.alive && o.team === a.team && o.brain?.role === 'entry');
    const o = lead.find((e) => Math.hypot(s.x - e.body.x, s.z - e.body.z) < dSite - 6);
    if (o) {
      const d = Math.hypot(s.x - o.body.x, s.z - o.body.z) || 1;
      setGoal(m, br, o.body.x - ((s.x - o.body.x) / d) * 6, o.body.z - ((s.z - o.body.z) / d) * 6);
      return;
    }
  }
  // clear the site: spread over its far half, toward the defense
  const spot = siteSpot(m, k, def.x, def.z, (br.holdA - 0.5) * 2.2, 3 + br.holdA * 5);
  setGoal(m, br, spot.x, spot.z, `site${k}`);
}

/** Breach defense: a spot `r` meters from (x, z) toward the defense's spawn, spread to either side by the bot. (Walked
 * to by search, not by the site's field: that field pulls toward the site and the search back out to here, and the
 * bot would pace between the two.) */
function behind(m: Match, a: Actor, br: Brain, x: number, z: number, r: number) {
  const own = spawnOf(m, a.team);
  const ang = Math.atan2(own.x - x, own.z - z) + (br.holdA - 0.5) * 1.4;
  return { x: x + Math.sin(ang) * r, z: z + Math.cos(ang) * r };
}
/** How far from the charge the defense gathers for a retake. */
const RETAKE_R = 22;

/** Breach: is the defense's retake on? Once every defender left is gathered near the charge, or the fuse says go now,
 * and from then on for the round. */
const retakes = new WeakMap<Match, { round: number; go: boolean }>();
function retakeGo(m: Match, team: number) {
  let e = retakes.get(m);
  if (!e || e.round !== m.round) retakes.set(m, (e = { round: m.round, go: false }));
  if (e.go) return true;
  const c = m.charge;
  let alive = 0;
  let there = 0;
  for (const o of m.actors)
    if (o.alive && o.team === team) {
      alive++;
      if (Math.hypot(o.body.x - c.x, o.body.z - c.z) < RETAKE_R + 7) there++;
    }
  if (there >= alive || c.fuse < DEFUSE_TIME + 15) e.go = true;
  return e.go;
}

/** Breach defense, nobody in sight. */
function planDefense(m: Match, a: Actor, br: Brain) {
  const c = m.charge;
  const atk = spawnOf(m, m.attack);
  br.rush = false;
  br.via = false;
  br.arrive = 2.2;
  if (c.state === 'planted') {
    // the retake: gather a way off on the defense's side first, then go in together once everyone who is coming is
    // there or the time says so (or straight away if someone is already on the charge); whoever gets there first
    // defuses, the rest cover
    const go = retakeGo(m, a.team) || c.defuseBy >= 0 || Math.hypot(c.x - a.body.x, c.z - a.body.z) < 9;
    br.faceX = c.x;
    br.faceZ = c.z;
    if (!go) {
      const p = behind(m, a, br, c.x, c.z, RETAKE_R);
      setGoal(m, br, p.x, p.z);
      br.hold = true;
      br.leash = 10;
      return;
    }
    br.rush = c.fuse < DEFUSE_TIME - c.defuseKept + 6;
    // the nearest goes for the charge; the rest clear round it first, toward where the attack was last seen, to
    // cover whoever is on it
    let near: Actor | null = null;
    let nd = Infinity;
    for (const o of m.actors)
      if (o.alive && o.team === a.team) {
        const d = c.defuseBy === o.id ? -1 : Math.hypot(o.body.x - c.x, o.body.z - c.z);
        if (d < nd) {
          nd = d;
          near = o;
        }
      }
    if (near === a || br.rush || !near?.bot) {
      br.arrive = 0.7;
      setGoal(m, br, c.x, c.z, `site${c.site}`);
      return;
    }
    let tx = 0;
    let tz = 0;
    let n = 0;
    for (const [id, p] of sightings(m, a.team))
      if (m.actors[id].alive && m.time - p.t < 12 && Math.hypot(p.x - c.x, p.z - c.z) < 30) {
        tx += p.x;
        tz += p.z;
        n++;
      }
    const ang = (n ? Math.atan2(tx / n - c.x, tz / n - c.z) : Math.atan2(atk.x - c.x, atk.z - c.z)) + (br.holdA - 0.5) * 1.6;
    setGoal(m, br, c.x + Math.sin(ang) * 7, c.z + Math.cos(ang) * 7, `site${c.site}`);
    br.faceX = c.x + Math.sin(ang) * 20;
    br.faceZ = c.z + Math.cos(ang) * 20;
    br.leash = 14;
    return;
  }
  // the charge going down (you hear it): everyone near goes for the one planting, now, before it is too late
  const planter = c.plantBy >= 0 ? m.actors[c.plantBy] : null;
  if (planter && Math.hypot(planter.body.x - a.body.x, planter.body.z - a.body.z) < 32) {
    setGoal(m, br, planter.body.x, planter.body.z);
    br.faceX = planter.body.x;
    br.faceZ = planter.body.z;
    br.rush = true;
    return;
  }
  const call = m.call[a.team];
  const fresh = call.site >= 0 && m.time - call.t < 9;
  // a spot to hold: it keeps to it in a fight, and goes after what it saw or heard only a few steps
  br.hold = true;
  br.leash = 10;
  if (br.post < 0 && !fresh) {
    // the middle, watching the lanes between the sites from a little back on the defense's side
    const p = midPoint(m, -6);
    setGoal(m, br, p.x + (br.holdA - 0.5) * 8, p.z + (br.holdA - 0.5) * 8);
  } else {
    // hold a site (its own, or the one called) from off to one side of where the attack comes in, crossing it
    const k = siteFor(m, a, br);
    const e = entryOf(m, k);
    const side = (br.holdA < 0.5 ? -1 : 1) * (0.55 + Math.abs(br.holdA - 0.5) * 1.6);
    const spot = siteSpot(m, k, e.x, e.z, side, 4 + br.holdA * 6);
    setGoal(m, br, spot.x, spot.z, `site${k}`);
    br.faceX = e.x;
    br.faceZ = e.z;
    return;
  }
  br.faceX = atk.x;
  br.faceZ = atk.z;
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
  br.longT = 0;
  br.longX = a.body.x;
  br.longZ = a.body.z;
  br.path = null;
  br.repath = true;
  br.nadeT = 4 + br.rng() * 6;
  br.holdA = br.rng();
  const mates = m.actors.filter((o) => o.team === a.team);
  const k = mates.indexOf(a);
  br.role = k % 5 === 1 || k % 5 === 2 ? 'entry' : k % 5 === 3 ? 'flank' : 'support';
  br.rush = false;
  br.arrive = 2.2;
  br.flashAway = 0;
  if (m.mode === 'breach') {
    if (a.team === m.attack) {
      // one flanks through the middle, unless that is a long way round
      const aim = stageOf(m).site;
      const s = m.world.sites[aim];
      const sp = spawnOf(m, a.team);
      const mid = midPoint(m);
      br.viaX = mid.x;
      br.viaZ = mid.z;
      const field = fieldTo(m.world, `site${aim}`, s.x, s.z);
      const direct = fieldDist(m.world, field, sp.x, sp.z);
      const around = Math.hypot(br.viaX - sp.x, br.viaZ - sp.z) + fieldDist(m.world, field, br.viaX, br.viaZ);
      // (and not where the middle lies under either site's guns: the sites close together, it would only feed them)
      const covered = m.world.sites.some((q) => Math.hypot(q.x - mid.x, q.z - mid.z) < 33);
      br.via = br.role === 'flank' && m.charge.holder !== a.id && !covered && Number.isFinite(around) && around < direct * 1.45;
      setGoal(m, br, s.x, s.z, `site${aim}`);
    } else {
      // two on each site and one in the middle, or (some rounds) three stacked on one site; the first on each site
      // anchors it and stays when the other is hit
      const defs = m.actors.filter((o) => o.team === a.team);
      const i = defs.indexOf(a);
      const stack = m.round % 3 === 0 ? (m.round % 2) : -1;
      const posts = stack < 0 ? [0, 1, 0, 1, -1] : [stack, 1 - stack, stack, 1 - stack, stack];
      br.post = posts[i % 5];
      br.anchor = i < 2;
      const s = m.world.sites[Math.max(0, br.post)];
      setGoal(m, br, s.x, s.z, br.post >= 0 ? `site${br.post}` : '');
    }
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
  if (m.mode === 'breach' && m.phase === 'buy') {
    if (!br.bought && m.phaseT < 13) shop(m, a, br);
    // face out toward where this bot is headed
    const s = m.world.sites[siteFor(m, a, br)];
    const ang = Math.atan2(s.x - a.body.x, s.z - a.body.z);
    inp.yaw = a.yaw + angDiff(a.yaw, yawOf(ang)) * Math.min(1, dt * 3);
    inp.pitch = a.pitch * (1 - Math.min(1, dt * 3));
    if (a.guns[0] && a.slot !== 0) inp.slot = 0;
    return inp;
  }
  if (m.mode === 'breach' && m.phase !== 'live') {
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
    // a waypoint that is not a straight walk from here for over a second: plan afresh, by search
    br.noFieldT -= br.think;
    if (br.moving && br.detourT <= 0 && !canWalk(m.world, a.body.x, a.body.z, br.wpX, br.wpZ)) br.blockT += br.think;
    else br.blockT = 0;
    if (br.blockT > 1) {
      br.blockT = 0;
      br.path = null;
      br.repath = true;
      br.failT = 0;
      br.noFieldT = 4;
    }
    // over four seconds of trying to go somewhere with nobody in sight, hardly any closer: the route is wrong (a
    // corner it keeps walking into, a waypoint across a wall). Plan again from scratch, and step off to one side
    br.longT += br.think;
    if (br.longT > 4) {
      const gd = Math.hypot(br.goalX - a.body.x, br.goalZ - a.body.z);
      const moved = Math.hypot(a.body.x - br.longX, a.body.z - br.longZ);
      if (br.target < 0 && br.waitT <= 0 && gd > Math.max(3, br.arrive + 1) && moved < 2.5) {
        br.path = null;
        br.repath = true;
        br.failT = 0;
        br.noFieldT = 6;
        br.detourT = 1 + r() * 0.8;
        br.detourA = Math.atan2(br.goalX - a.body.x, br.goalZ - a.body.z) + (r() < 0.5 ? 1 : -1) * (1.2 + r() * 0.9);
        br.jump = true;
      }
      br.longT = 0;
      br.longX = a.body.x;
      br.longZ = a.body.z;
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
  // breach: plant once on the spot with nobody in sight (or the clock about to run out); defuse when clear, or
  // regardless once the fuse is too short to wait
  let busy = false;
  if (m.mode === 'breach' && m.phase === 'live') {
    const c = m.charge;
    const gd = Math.hypot(br.goalX - a.body.x, br.goalZ - a.body.z);
    if (plantSite(m, a) >= 0 && (c.plantBy === a.id || ((!tgt || m.phaseT < PLANT_TIME + 2) && (gd < 2.6 || m.phaseT < PLANT_TIME + 6)))) busy = true;
    else if (canDefuse(m, a) && (c.defuseBy === a.id || !tgt || c.fuse < DEFUSE_TIME - c.defuseKept + 2)) busy = true;
    if (busy) {
      inp.use = true;
      br.moving = false;
      // keep looking about while the hands are busy
      if (tgt) {
        const dx = tgt.body.x - a.body.x;
        const dz = tgt.body.z - a.body.z;
        inp.yaw = a.yaw + clamp(angDiff(a.yaw, Math.atan2(-dx, -dz)), -br.turn * dt, br.turn * dt);
      }
      return inp;
    }
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
    // breach, a spot to hold: no closing in, only a step to either side, and back onto it if off it
    if (m.mode === 'breach' && br.hold && g) {
      if (Math.hypot(br.goalX - a.body.x, br.goalZ - a.body.z) > 3.5) moveAng = br.detourT > 0 ? br.detourA : br.heading;
      else if (d > pref * 0.5) moveAng = toward + (Math.PI / 2) * (free(m, a, toward + (Math.PI / 2) * br.strafe, 1.6) ? br.strafe : -br.strafe);
    } else if (m.mode === 'breach' && g && d > pref + 12 && Math.abs(angDiff(toward, br.heading)) > 0.8 && Math.hypot(br.goalX - a.body.x, br.goalZ - a.body.z) > 4) {
      // breach, on the way somewhere: a far one off to the side is no reason to leave the way
      moveAng = br.detourT > 0 ? br.detourA : br.heading;
    }
    // a charge to reach in time: keep heading for it while shooting
    if (br.rush && Math.hypot(br.goalX - a.body.x, br.goalZ - a.body.z) > 1.2) moveAng = br.detourT > 0 ? br.detourA : br.heading;
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
      // look where we go; once there, out at what this spot watches
      wantYaw = yawOf(moveAng);
      wantPitch = -0.04;
      const gd = Math.hypot(br.goalX - a.body.x, br.goalZ - a.body.z);
      if (gd < (m.mode === 'royale' ? 0.9 : br.arrive)) {
        moveAng = NaN;
        if (m.mode === 'breach') {
          wantYaw = Math.atan2(-(br.faceX - a.body.x), -(br.faceZ - a.body.z)) + (br.holdA - 0.5) * 0.35;
          // some hold crouched, a smaller and quieter shape
          inp.crouch = br.holdA > 0.45;
        }
      }
      // going in: a smoke as a wall between the gathering spot and the site, then one onto the far side of the site,
      // which blinds whoever holds it from the back
      if (m.mode === 'breach' && a.team === m.attack && a.smokes > 0 && br.nadeT <= 0 && m.charge.state !== 'planted') {
        const st = stageOf(m);
        const k = siteFor(m, a, br);
        const s = m.world.sites[k];
        const own = spawnOf(m, 1 - a.team);
        const p = st.pts[k];
        const sd = Math.hypot(own.x - s.x, own.z - s.z) || 1;
        const tx = st.smokes === 0 ? p.x + (s.x - p.x) * 0.45 : s.x + ((own.x - s.x) / sd) * 7;
        const tz = st.smokes === 0 ? p.z + (s.z - p.z) * 0.45 : s.z + ((own.z - s.z) / sd) * 7;
        const d = Math.hypot(tx - a.body.x, tz - a.body.z);
        if (st.go && st.smokes < 2 && d > 9 && d < 27) {
          const yaw = Math.atan2(-(tx - a.body.x), -(tz - a.body.z));
          wantYaw = yaw;
          // (it pops a second and a half after leaving the hand, wherever it has got to)
          wantPitch = Math.acos(clamp(d / 25, 0.3, 1)) - 0.1;
          moveAng = NaN;
          if (Math.abs(angDiff(a.yaw, yaw)) < 0.15 && Math.abs(a.pitch - wantPitch) < 0.08) {
            inp.throw = 'smoke';
            st.smokes++;
            br.nadeT = 5;
          }
        }
      }
      // a flashbang over the site before going in (the attack), or onto the charge before a retake (the defense)
      if (m.mode === 'breach' && m.phase === 'live' && a.flashes > 0 && br.nadeT <= 0 && br.skill > 0.25) {
        const c = m.charge;
        // (the defense also flashes the way in on a site being hit, as the push comes)
        const call = m.call[a.team];
        const pushed = a.team !== m.attack && c.state !== 'planted' && br.hold && call.site >= 0 && call.site === siteFor(m, a, br) && m.time - call.t < 3;
        const at = a.team === m.attack ? (c.state === 'planted' || !stageOf(m).go ? null : m.world.sites[siteFor(m, a, br)]) : c.state === 'planted' ? { x: c.x, z: c.z } : pushed ? entryOf(m, call.site) : null;
        if (at) {
          const d = Math.hypot(at.x - a.body.x, at.z - a.body.z);
          if (d > 14 && d < 34 && (a.team === m.attack ? br.role !== 'flank' : pushed || br.rush || c.fuse < 25 || retakeGo(m, a.team))) {
            const yaw = Math.atan2(-(at.x - a.body.x), -(at.z - a.body.z));
            wantYaw = yaw;
            wantPitch = 0.22 + d * 0.004;
            // throw once facing it, then turn away until it has gone off
            if (Math.abs(angDiff(a.yaw, yaw)) < 0.25 && r() < 0.5) {
              inp.throw = 'flash';
              br.nadeT = 7 + r() * 4;
              br.flashAway = 1.5;
              br.awayYaw = yaw + Math.PI;
            }
          }
        }
      }
    }
  }
  // a flashbang of its own in the air: look the other way
  if (br.flashAway > 0) {
    br.flashAway -= dt;
    if (!tgt) {
      wantYaw = br.awayYaw;
      wantPitch = -0.6;
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
    if (!tgt && gd < (m.mode === 'royale' ? 0.9 : Math.min(1.6, br.arrive)) && br.detourT <= 0) br.moving = false;
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
