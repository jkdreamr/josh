// Computer players. Each one sees (field of view, line of sight, smoke), hears (shots and running footsteps), buys
// with its credits, plays its side in a breach (the attack pushes a site together, plants and guards the charge; the
// defense holds both sites, rotates on a call and retakes to defuse), and aims like a person: a reaction delay, an error that settles, a
// limited turn speed that has to fight the recoil, and (on harder levels) stopping before it shoots. In a royale they
// pick a landing spot, jump when the transport passes it, loot what they need, heal up, and keep ahead of the zone
// (when it is far, in a vehicle if one is parked near: they drive it toward the circle and get out to fight);
// the bolder ones go for a supply drop that comes down near them, and everyone gets out from under a bombardment.
import {
  DEFUSE_TIME,
  DEG,
  HALF,
  PLANT_TIME,
  ROUND_TIME,
  boostPick,
  buy,
  canDefuse,
  canShop,
  currentGun,
  eyeY,
  healPick,
  idleInput,
  inFire,
  isEnemy,
  isPerson,
  owns,
  partsOf,
  plantSite,
  priceOf,
  smokeBlocks,
  spareOf,
  spawnOf,
  spreadOf,
  supplyLeft,
  underRoof,
  viewDir,
  wants,
  type Actor,
  type Input,
  type Match,
  type ShopItem,
} from './match.ts';
import { CARS, carNear, type Car } from './cars.ts';
import { clamp, mulberry32, type Rng } from './noise.ts';
import { UP_LADDER, canWalk, fieldDist, fieldStep, fieldTo, findPath, navMark, walkable } from './nav.ts';
import { blockedAt, clearLine } from './physics.ts';
import { floorAt, heightAt } from './terrain.ts';
import { CALM_D, CALM_HP, CALM_T, CLAIM_R, HEAT_CAP, LAND_GRACE, PACE_CLOSE, PERSON_FLOOR, RED_WARN, TIERS, WARN_D, WARN_SHOT, magOf, paceAim, planeAt, scopeOf, tierOf } from './royale.ts';
import { WEAPONS, type WeaponId } from './weapons.ts';
import { SITE_R, type World } from './world.ts';
import { MAPS } from './maps.ts';

export type BotLevel = 'easy' | 'normal' | 'hard';
type Role = 'entry' | 'support' | 'flank';

export type Brain = {
  level: BotLevel;
  skill: number;
  react: number;
  turn: number;
  /** Royale: how good this bot is next to the rest of the lobby (0 recruit, 1 regular, 2 veteran, 3 ace). */
  tier: number;
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
  /** The goal's height when it is up on a floor over the ground (loot upstairs, on a roof), else NaN. */
  goalY: number;
  /** The planned route (flat x, z pairs), the leg being walked, and what it was planned for (and on a map with floors
   * over the ground, the height of each of its points). */
  path: number[] | null;
  pathY: number[];
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
  /** Royale: how much longer to lie still (sniping from far off, or hidden in the grass). */
  proneT: number;
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
  /** Royale: where it means to land, the loot it is going for, when to look for more, and a wish to heal or to take a
   * boost. */
  dropX: number;
  dropZ: number;
  loot: number;
  lootT: number;
  /** How long it has been after the same loot, and one it gave up on (out of reach, as it turned out). */
  lootAge: number;
  lootSkip: number;
  healNow: boolean;
  boostNow: boolean;
  /** Royale: the supply crate it is going for (-1 none), and a bit per crate it has already made up its mind on. */
  supply: number;
  supplySeen: number;
  /** Royale: the vehicle it is walking to or driving (-1 none), since when, and not another before `carCd` (match
   * time). Driving: the heading it steers for, backing up for `revT` more seconds (and how many times so far), time
   * spent barely moving, and slowing down to get out. */
  car: number;
  carT: number;
  carCd: number;
  driveYaw: number;
  revT: number;
  revs: number;
  carStuck: number;
  leaving: number;
  /** Carrying a shield: whether it wants it raised, and when it next thinks about that. */
  shieldUp: boolean;
  shieldT: number;
  /** Royale pacing: whether this bot picked its fight with the bot it is on (not answering a shot, not bumping into
   * it), one bot it has broken off from and leaves alone until `calmT` (match time), and whether the one it last lost
   * sight of was a bot, with a roll for whether to go after it. */
  started: boolean;
  calmOf: number;
  calmT: number;
  lostBot: boolean;
  chaseRoll: number;
  /** Royale, breaking to cover: the spot it runs to, until when it stays in cover (match time, 0 none), and not
   * again before `coverCd`. */
  coverX: number;
  coverZ: number;
  coverEnd: number;
  coverCd: number;
  /** Royale, holding a building late on: which (an index into roomsOf, -1 none), the loot spot it stands on, until
   * when, not another before `holdCd`, and the next time it looks for one. */
  holdI: number;
  holdSpot: number;
  holdEnd: number;
  holdCd: number;
  holdLook: number;
  /** Royale: the nearest one it saw close by last look and is leaving be (-1 none), to walk round rather than into,
   * and the one it has been walking round and on which side (1 or -1, kept so it does not dither). */
  avoid: number;
  avoidOf: number;
  avoidSide: number;
};

const LEVELS: Record<BotLevel, { skill: number; react: number; turn: number }> = {
  // (a person should win most fair fights at Normal: slower to react, slower to turn, and their first shots go wide)
  easy: { skill: 0.08, react: 1, turn: 2.2 },
  normal: { skill: 0.28, react: 0.66, turn: 4 },
  hard: { skill: 0.6, react: 0.38, turn: 7 },
};

export function newBrain(level: BotLevel, seed: number): Brain {
  const L = LEVELS[level];
  const rng = mulberry32(seed * 977 + 13);
  return {
    level,
    skill: clamp(L.skill + (rng() - 0.5) * 0.12, 0.05, 0.98),
    react: L.react * (0.85 + rng() * 0.3),
    turn: L.turn,
    tier: 1,
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
    goalY: NaN,
    path: null,
    pathY: [],
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
    proneT: 0,
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
    lootAge: 0,
    lootSkip: -1,
    healNow: false,
    boostNow: false,
    supply: -1,
    supplySeen: 0,
    car: -1,
    carT: 0,
    carCd: 0,
    driveYaw: 0,
    revT: 0,
    revs: 0,
    carStuck: 0,
    leaving: -1,
    shieldUp: false,
    shieldT: 0,
    started: false,
    calmOf: -1,
    calmT: 0,
    lostBot: false,
    chaseRoll: 0,
    coverX: 0,
    coverZ: 0,
    coverEnd: 0,
    coverCd: 0,
    holdI: -1,
    holdSpot: -1,
    holdEnd: 0,
    holdCd: 0,
    holdLook: 0,
    avoid: -1,
    avoidOf: -1,
    avoidSide: 0,
  };
}

/** Royale: a hundred bots at breach sharpness would end it in a minute, and a hundred alike all feel the same. Each
 * gets a tier from the match seed and its place (its own stream, so the match's draws stay as they were): mostly
 * recruits and regulars, a few veterans and aces, each slower or quicker to react and less or more sure of aim. */
export function royaleTier(br: Brain, seed: number, id: number) {
  br.tier = tierOf(mulberry32(seed * 53 + id)());
  const t = TIERS[br.tier];
  br.react *= t.react;
  br.skill = clamp(br.skill * t.skill, 0.05, 0.9);
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
const PREF: Record<WeaponId, number> = { wren: 14, bulwark: 18, hornet: 14, mauler: 6, kestrel: 30, lancer: 45, longbow: 60, talon: 32, rampart: 28, marshal: 16, wasp: 10, thresher: 7, arbalest: 38 };
const REACH: Record<WeaponId, number> = { wren: 45, bulwark: 60, hornet: 55, mauler: 22, kestrel: 150, lancer: 210, longbow: 260, talon: 160, rampart: 140, marshal: 60, wasp: 40, thresher: 22, arbalest: 110 };

/** A pick from a table of [thing, weight]. */
function roll<T>(r: Rng, table: [T, number][]): T {
  let v = r() * table.reduce((s, [, p]) => s + p, 0);
  for (const [t, p] of table) {
    v -= p;
    if (v <= 0) return t;
  }
  return table[0][0];
}

/** What else a bot buys once it has its guns and armor: the usual grenades, now and then one of the others (an
 * incendiary is the attack's, to burn a held corner or the defuse; the defense takes an impact grenade instead). */
function utility(r: Rng, attack: boolean): ShopItem[] {
  const out: ShopItem[] = ['flash', 'frag', 'smoke'];
  if (attack && r() < 0.3) out.push('decoy');
  if (!attack && r() < 0.3) out.push('impact');
  if (attack && r() < 0.35) out.unshift('fire');
  return out;
}

function shop(m: Match, a: Actor, br: Brain) {
  br.bought = true;
  if (!canShop(m, a)) return;
  const r = br.rng;
  const team = m.actors.filter((o) => o.team === a.team);
  const avg = team.reduce((s, o) => s + o.credits, 0) / team.length;
  const attack = a.team === m.attack;
  const want: ShopItem[] = [];
  if (m.round === 1 || m.round === HALF + 1) {
    if (r() < 0.45) want.push('bulwark');
    else want.push('light', r() < 0.4 ? 'frag' : r() < 0.5 ? 'smoke' : 'flash');
  } else if (!a.guns[0]) {
    const eco = avg < 2500 && a.credits < 3900;
    if (eco) {
      if (a.credits >= 2300 && attack && br.role === 'entry' && r() < 0.25) want.push('pavise', 'marshal');
      else if (a.credits >= 1200 && r() < 0.4) want.push(r() < 0.6 ? 'bulwark' : 'marshal');
      else if (a.credits >= 2000 && r() < 0.5) want.push(roll<WeaponId>(r, [['hornet', 4], ['wasp', 3], ['mauler', 3]]), 'light');
    } else {
      let gun: WeaponId;
      if (a.credits >= 5600 && r() < (br.level === 'hard' ? 0.2 : 0.1)) gun = 'longbow';
      else if (a.credits >= 4800 && r() < 0.15) gun = 'rampart';
      else if (a.credits >= 3900) gun = roll<WeaponId>(r, [['kestrel', 56], ['talon', 18], ['lancer', 16], ['arbalest', 10]]);
      else if (a.credits >= 2400) gun = roll<WeaponId>(r, [['lancer', 25], ['talon', 20], ['hornet', 20], ['thresher', 13], ['mauler', 11], ['wasp', 11]]);
      else gun = roll<WeaponId>(r, [['hornet', 4], ['wasp', 3], ['mauler', 3]]);
      want.push(gun, 'heavy', 'light');
      // a shield for the first one in, now and then, with the money to spare
      if (attack && br.role === 'entry' && a.credits >= WEAPONS[gun].price + 2600 && r() < 0.3) want.push('pavise');
      want.push(...utility(r, attack));
    }
  } else want.push('heavy', 'light', ...utility(r, attack));
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
    const next = fieldStep(m.world, fieldTo(m.world, br.fieldKey, fp.x, fp.z), a.body.x, a.body.z, 8, a.body.y);
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
      br.path = findPath(m.world, a.body.x, a.body.z, br.goalX, br.goalZ, m.mode === 'royale' ? 2200 : 3500, a.body.y, br.goalY, br.pathY);
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
  // (a ladder's point is reached only right at it: the bot lines up with the ladder before it steps on or off; and on a
  // map with floors over the ground a point counts only on its own level, an upstairs one never from the floor below)
  const ys = br.pathY.length * 2 === p.length ? br.pathY : null;
  for (;;) {
    if (br.pathI >= p.length - 2) break;
    const d = Math.hypot(p[br.pathI] - a.body.x, p[br.pathI + 1] - a.body.z);
    const rung = navMark(m.world, p[br.pathI], p[br.pathI + 1]) === UP_LADDER;
    const here = !ys || rung || Math.abs(ys[br.pathI / 2] - a.body.y) < 1.3;
    const next = !ys || Math.abs(ys[br.pathI / 2 + 1] - a.body.y) < 1.3;
    if ((here && d < (rung ? 0.3 : 0.8)) || (!rung && here && next && d < 2.4 && canWalk(m.world, a.body.x, a.body.z, p[br.pathI + 2], p[br.pathI + 3], a.body.y))) br.pathI += 2;
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
  const want0 = Math.atan2(dx, dz);
  // a point up a flight of stairs or a ladder: straight at it (the steps ahead, or the wall the ladder is on, are not
  // in the way)
  if (navMark(m.world, br.wpX, br.wpZ) || a.ladder >= 0 || a.climb) {
    br.heading = want0;
    return;
  }
  // look only as far as the waypoint, so a doorway right ahead doesn't read as the wall beside it
  const look = clamp(Math.hypot(dx, dz) - 0.2, 0.8, 2.6);
  // royale: a bot it leaves be right in the way, nearer than where it is going: round them, the side it already leans
  let want = want0;
  if (m.mode === 'royale' && br.avoid >= 0 && br.target < 0) {
    const o = m.actors[br.avoid];
    const ox = o.body.x - a.body.x;
    const oz = o.body.z - a.body.z;
    const d = Math.hypot(ox, oz);
    const to = Math.atan2(ox, oz);
    const off = angDiff(to, want0);
    if (br.avoidOf !== o.id) {
      br.avoidOf = o.id;
      br.avoidSide = off >= 0 ? 1 : -1;
    }
    if (o.alive && d < AVOID_R && d < Math.hypot(br.goalX - a.body.x, br.goalZ - a.body.z) && Math.abs(off) < AVOID_ARC) want = to + br.avoidSide * AVOID_TURN;
  }
  for (const off of [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4, 2, -2]) {
    const ang = want + off * (br.strafe > 0 ? 1 : -1);
    if (free(m, a, ang, look)) {
      br.heading = ang;
      return;
    }
  }
  br.heading = want + Math.PI * (br.rng() < 0.5 ? 0.6 : -0.6);
}

function setGoal(m: Match, br: Brain, x: number, z: number, fieldKey = '', y = NaN) {
  const A = m.world.arena;
  br.goalX = clamp(x, -A + 3, A - 3);
  br.goalZ = clamp(z, -A + 3, A - 3);
  br.goalY = y;
  br.fieldKey = fieldKey;
}

/** Deathmatch roaming points that have distance fields. */
export const DM_HUBS = 8;

// (PARTS spheres of four numbers: written out, since match.ts and this file import each other and either may load first)
const seen = new Float64Array(5 * 4);

/** Out on open ground on a map with long grass (where lying down hides you). */
function grassy(m: Match, a: Actor) {
  const b = a.body;
  return MAPS[m.world.id].grass.density >= 0.5 && b.y < floorAt(m.world.terrain, b.x, b.z) + 0.15 && b.y > m.world.terrain.water;
}

/** How far off the nearest person still in it is (played here or on another machine online), Infinity with none. */
function nearestPerson(m: Match, a: Actor) {
  let best = Infinity;
  for (const o of m.actors) if (o.alive && isPerson(m, o)) best = Math.min(best, Math.hypot(a.body.x - o.body.x, a.body.z - o.body.z));
  return best;
}

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
  // a decoy's gunfire with nobody in sight: taken for an enemy there (looked at, gone after, a frag thrown at it)
  if (br.target < 0)
    for (const s of m.sounds) {
      if (!s.fake || s.team === a.team || m.time - s.t > 0.3) continue;
      const d = Math.hypot(s.x - ex, s.z - ez);
      if (d > s.range * 0.8 || d < 3 || br.rng() > 0.4) continue;
      br.lastX = s.x;
      br.lastY = a.body.y;
      br.lastZ = s.z;
      br.hasLast = true;
      br.lostAt = m.time - 0.9;
      if (m.mode === 'breach') callout(m, a.team, s.x, s.z);
      break;
    }
  // a royale bot still gearing up picks its fights: only close ones, or whoever shoots it
  const geared = m.mode !== 'royale' || ((!!a.guns[0] || !!a.guns[2]) && (a.vest > 0 || a.helmet > 0));
  // breach: a stranger further off than this is a few pixels across a field; nobody picks that out (a scope helps)
  const scoped = !!currentGun(a) && scopeOf(currentGun(a)!);
  const range = m.mode === 'breach' ? (scoped ? 95 : 55) : m.mode !== 'royale' ? 230 : geared ? 130 : a.guns[0] || a.guns[2] ? 45 : 28;
  // royale pacing: m.pace is the chance a second that a bot sets about another bot it has seen (one roll a look, however
  // many are in view)
  const paceOk = m.mode === 'royale' && a.bot ? br.rng() < 1 - (1 - m.pace) ** Math.max(0.1, br.think) : true;
  // (and a person the same way, though never less readily than PERSON_FLOOR a second: met in fights, not the only one)
  const personOk = m.mode === 'royale' && a.bot ? br.rng() < 1 - (1 - Math.max(m.pace, PERSON_FLOOR[m.level])) ** Math.max(0.1, br.think) : true;
  let avoid = -1;
  let avoidD = Infinity;
  for (const o of m.actors) {
    if (!o.alive || !isEnemy(a, o) || o.drop === 1) continue;
    const dx = o.body.x - ex;
    const dz = o.body.z - ez;
    const d = Math.hypot(dx, dz);
    const known = o.id === br.target || (a.hurtFrom === o.id && m.time - a.hurtT < 2);
    if (d > (known ? 230 : range)) continue;
    // the first while after landing goes on looting, not on picking fights
    if (!known && m.mode === 'royale' && m.time - a.dropT < 22 && d > 7) continue;
    // royale pacing, for someone not yet fought (whoever this bot fights or was shot by always counts): another bot
    // only on a pace roll, a person only on its own roll (either always when bumped into, within PACE_CLOSE), and not
    // one it broke off from a moment ago; a person also only while few enough bots are on them already, and not while
    // just down with no gun yet (or still coming down)
    const paced = !known && m.mode === 'royale' && a.bot && o.bot;
    if (m.mode === 'royale' && br.calmOf === o.id && m.time < br.calmT && d > PACE_CLOSE) continue;
    // (one close by that it leaves be, a bot or a person: it walks round them instead of into a fight)
    const leave = (paced && d > PACE_CLOSE && !paceOk) || (!known && m.mode === 'royale' && a.bot && !o.bot && ((d > PACE_CLOSE && !personOk) || (d > 12 && m.heat[o.id] >= HEAT_CAP[m.level]) || (d > 8 && !currentGun(o) && (o.drop > 0 || m.time - o.dropT < LAND_GRACE))));
    if (leave) {
      if (d < AVOID_R && d < avoidD && m.zone!.i >= LATE_PHASE) {
        avoidD = d;
        avoid = o.id;
      }
      continue;
    }
    if (!known && m.mode === 'royale' && !o.bot) {
      if (d > 12 && m.heat[o.id] >= HEAT_CAP[m.level]) continue;
      if (d > 8 && !currentGun(o) && (o.drop > 0 || m.time - o.dropT < LAND_GRACE)) continue;
    }
    const facing = (dx * fw.x + dz * fw.z) / (d || 1);
    if (!known && facing < 0.34 && d > 5) continue;
    // far, crouched or still targets take longer to notice: a chance per look that falls off with distance (about a
    // second to pick out someone running 100 m off, longer if they hold still)
    if (!known && d > 10) {
      const still = Math.hypot(o.body.vx, o.body.vz) < 1;
      // (in a breach, past 30 m it falls off faster still: the fights are meant to be won on angles, not by spotting)
      const far = m.mode === 'breach' && d > 30 ? (30 / d) ** 2 : 1;
      // (lying down is harder to pick out still, and in long grass a good deal harder)
      const low = o.prone > 0.5 ? (grassy(m, o) ? 0.25 : 0.45) : o.crouch > 0.5 ? 0.7 : 1;
      const rate = 7 * (40 / Math.max(d, 14)) ** 2 * far * (still ? 0.5 : 1) * low * (0.6 + br.skill * 0.6) * (m.mode === 'royale' ? 0.55 : 1);
      if (br.rng() > 1 - Math.exp(-rate * Math.max(0.1, br.think))) continue;
    } else if (!known && m.mode === 'royale' && d > 6 && br.rng() > 0.3 + br.skill * 0.3) continue; // busy looting: takes a moment to notice
    // the chest and the head where they are (lying down, or a head leant out past a corner)
    partsOf(o, seen);
    const low = o.prone > 0.5;
    const cx = low ? seen[4] : o.body.x;
    const chest = low ? seen[5] : o.body.y + o.body.height * 0.68;
    const cz = low ? seen[6] : o.body.z;
    if (smokeBlocks(m, ex, ey, ez, cx, chest, cz)) continue;
    const seeChest = clearLine(w, ex, ey, ez, cx, chest, cz);
    if (!seeChest && !clearLine(w, ex, ey, ez, seen[0], seen[1], seen[2])) continue;
    let score = d * (o.id === br.target ? 0.55 : 1) * (o.bot ? 1 : 0.9);
    if (!seeChest) score *= 1.4;
    if (score < bestScore) {
      bestScore = score;
      best = o.id;
    }
  }
  br.avoid = avoid;
  if (best !== br.target) {
    if (best >= 0) {
      // a new target: the aim starts off by an error that shrinks as the bot settles
      const o = m.actors[best];
      const d = Math.hypot(o.body.x - ex, o.body.z - ez);
      // holding an angle (standing still, already looking where they appear) gives a quicker, truer first shot
      const off = Math.abs(angDiff(a.yaw, Math.atan2(-(o.body.x - ex), -(o.body.z - ez))));
      const holding = Math.hypot(a.body.vx, a.body.vz) < 0.8 && off < 0.35;
      // (royale: one bot on another aims worse while the match runs ahead of its pace; on a person far off the first
      // shots go wide, the more so the weaker the bot, so they have a moment to react)
      const vsBot = m.mode === 'royale' && a.bot && o.bot;
      const warn = m.mode === 'royale' && a.bot && !o.bot && d > WARN_D ? WARN_SHOT[br.tier] : 1;
      const e = ((1 - br.skill) * 0.15 + 0.02 + d * 0.0003) * (m.mode === 'royale' ? 1.5 : 1) * (holding ? 0.5 : 1) * (vsBot ? paceAim(m.pace) : 1) * warn;
      if (m.mode === 'royale') br.started = d > PACE_CLOSE && !(a.hurtFrom === o.id && m.time - a.hurtT < 2);
      br.errY = (br.rng() - 0.5) * 2 * e;
      br.errP = (br.rng() - 0.5) * e;
      br.seenFor = br.target >= 0 && m.time - br.lostAt < 0.8 ? br.react : holding ? br.react * 0.45 : 0;
      br.head = br.rng() < br.skill * 0.6;
    }
    if (br.target >= 0 && best < 0) {
      br.lostAt = m.time;
      br.repath = true;
      if (m.mode === 'royale') {
        br.lostBot = m.actors[br.target].bot;
        br.chaseRoll = br.rng();
      }
    }
    // (keep the count of bots on each actor right within the step, so a crowd can't all pick the same person at once)
    if (m.mode === 'royale' && a.bot) {
      if (br.target >= 0 && m.heat[br.target] > 0) m.heat[br.target]--;
      if (best >= 0) m.heat[best]++;
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

/** Royale: inside (or at the edge of) a bombardment? */
const inRed = (m: Match, a: Actor) => !!m.red && Math.hypot(a.body.x - m.red.x, a.body.z - m.red.z) < m.red.r + 4;

/** Royale, breaking to cover: hurt by someone it cannot see in the last COVER_HURT seconds, or under COVER_HP in a
 * fight with someone over COVER_D off (an ace already under COVER_HP_ACE), a bot runs for a spot out of their sight
 * and patches up there. Recruits often forget to. */
export const COVER_HURT = 1.5;
export const COVER_HP = 50;
export const COVER_HP_ACE = 65;
export const COVER_D = 15;
/** How long a bot stays in cover at most (getting there and healing), and how soon it may break again. */
export const COVER_T = 9;
export const COVER_CD = 3;
/** Royale, holding: from this zone phase on (counting from 0), a regular or a veteran inside the next circle with a
 * building within HOLD_R (also inside it) goes in, stands on a spot there facing a door and stays, until the next
 * circle leaves the building out, someone hurts it from within HOLD_NEAR, or HOLD_T seconds have gone by. No more
 * than HOLD_SHARE of the bots left hold at once. */
export const HOLD_PHASE = 2;
export const HOLD_R = 30;
export const HOLD_T = 60;
export const HOLD_NEAR = 8;
export const HOLD_SHARE = 0.35;
/** Royale: from this zone phase on (counting from 0, so once the first circle has closed) the late game's habits
 * hold: bots walk round the ones they leave be and come into the next circle at its edge. Before it, a hot drop's
 * scramble plays out as it always has. */
export const LATE_PHASE = 1;
/** Royale: a bot it leaves be (the pace) within AVOID_R, and within AVOID_ARC of the way it walks, it steps round,
 * heading AVOID_TURN off the line to them: bots that let each other be do not walk into a fight at arm's length. */
export const AVOID_R = 28;
export const AVOID_ARC = 1.2;
export const AVOID_TURN = 1.9;

/** Royale: a spot to hide from someone with their eye at (fx, fy, fz): of twelve tried round the bot (COVER_RING
 * meters off, the nearer ring first, each ring away from them first, then to the sides, then back toward them), the
 * first out of their sight (no clear line to where a chest would be) on ground a bot can walk, dry, inside the zone
 * and not much nearer to them; null when there is none. */
export const COVER_RING = [7, 15];
const COVER_DIRS = [0, 50, -50, 100, -100, 180].map((d) => (d * Math.PI) / 180);
export function coverFrom(m: Match, a: Actor, fx: number, fy: number, fz: number) {
  const w = m.world;
  const t = w.terrain;
  const z = m.zone!;
  const b = a.body;
  const near = Math.hypot(b.x - fx, b.z - fz);
  const away = Math.atan2(b.x - fx, b.z - fz);
  for (const d of COVER_RING)
    for (const off of COVER_DIRS) {
      const x = b.x + Math.sin(away + off) * d;
      const zz = b.z + Math.cos(away + off) * d;
      if (Math.abs(x) > w.arena - 4 || Math.abs(zz) > w.arena - 4) continue;
      if (Math.hypot(x - z.x, zz - z.z) > z.r - 5) continue;
      if (Math.hypot(x - fx, zz - fz) < Math.max(8, near - 8)) continue;
      const g = floorAt(t, x, zz);
      if (t.hasWater && !t.ice && heightAt(t, x, zz) < t.water - 0.3) continue;
      if (Math.abs(g - b.y) > 4 || !walkable(w, x, zz) || blockedAt(w, x, zz, g)) continue;
      if (clearLine(w, fx, fy, fz, x, g + 1.25, zz)) continue;
      return { x, z: zz };
    }
  return null;
}

/** Royale, after a look round: whether to break to cover now (and from whom), and starts it. */
function takeCover(m: Match, a: Actor, br: Brain) {
  if (m.time < br.coverCd || m.time < br.coverEnd || br.holdI >= 0 || a.ladder >= 0 || a.climb) return;
  const z = m.zone!;
  if (Math.hypot(a.body.x - z.x, a.body.z - z.z) > z.r - 6) return;
  let from: Actor | null = null;
  if (br.target >= 0) {
    const o = m.actors[br.target];
    if (a.hp < (br.tier === 3 ? COVER_HP_ACE : COVER_HP) && Math.hypot(o.body.x - a.body.x, o.body.z - a.body.z) > COVER_D) from = o;
  } else if (m.time - a.hurtT < COVER_HURT && a.hurtFrom >= 0 && a.hurtFrom !== a.id) {
    // (the zone only hurts outside it, so inside it this was someone)
    const o = m.actors[a.hurtFrom];
    if (o?.alive) from = o;
  }
  if (!from) return;
  br.coverCd = m.time + COVER_CD;
  // (a recruit only thinks of it half the time)
  if (br.tier === 0 && br.rng() < 0.5) return;
  const c = coverFrom(m, a, from.body.x, eyeY(from), from.body.z);
  if (!c) return;
  br.coverX = c.x;
  br.coverZ = c.z;
  br.coverEnd = m.time + COVER_T;
  br.loot = -1;
  br.supply = -1;
  br.repath = true;
}

/** Royale, in cover: keeps the goal on it (rushing there, shooting on the way if it must), then heals or boosts
 * there; done once patched up or when the time is up. */
function inCover(m: Match, a: Actor, br: Brain) {
  if (m.time >= br.coverEnd) return false;
  const z = m.zone!;
  if (Math.hypot(a.body.x - z.x, a.body.z - z.z) > z.r - 6) {
    br.coverEnd = 0;
    return false;
  }
  setGoal(m, br, br.coverX, br.coverZ);
  br.loot = -1;
  const d = Math.hypot(br.coverX - a.body.x, br.coverZ - a.body.z);
  const there = d < 1.2;
  br.rush = !there;
  // (patching up from the moment it is nearly there with nobody in sight)
  const safe = there || (d < 6 && br.target < 0);
  br.healNow = safe && a.hp < 90 && !!healPick(a);
  br.boostNow = safe && !br.healNow && a.hp < 95 && a.boost < 30 && !!boostPick(a);
  if (there && !br.healNow && !br.boostNow && a.healT <= 0) {
    br.coverEnd = 0;
    return false;
  }
  return true;
}

/** Royale: the buildings a bot may hold, per world: the middle, the loot spots on the lowest floor that has any, and
 * the doorway nearest the middle to face. */
type Room = { x: number; z: number; spots: number[]; doorX: number; doorZ: number };
const roomsCache = new WeakMap<World, Room[]>();
export function roomsOf(w: World) {
  let out = roomsCache.get(w);
  if (out) return out;
  out = [];
  for (const q of w.interiors) {
    let low = Infinity;
    const at: number[] = [];
    for (let i = 0; i < w.loot.length; i += 3) {
      const x = w.loot[i];
      const z = w.loot[i + 2];
      const y = w.loot[i + 1];
      if (x < q.x0 || x > q.x1 || z < q.z0 || z > q.z1 || y < q.y0 || y > q.y1) continue;
      at.push(i / 3);
      low = Math.min(low, y);
    }
    const spots = at.filter((k) => w.loot[k * 3 + 1] < low + 1);
    if (!spots.length) continue;
    const x = (q.x0 + q.x1) / 2;
    const z = (q.z0 + q.z1) / 2;
    let doorX = x;
    let doorZ = z;
    let dd = 25;
    for (let i = 0; i < w.doors.length; i += 4) {
      const d = Math.hypot(w.doors[i] - x, w.doors[i + 1] - z);
      if (d < dd) {
        dd = d;
        doorX = w.doors[i];
        doorZ = w.doors[i + 1];
      }
    }
    out.push({ x, z, spots, doorX, doorZ });
  }
  roomsCache.set(w, out);
  return out;
}

/** Royale: bots alive and down on the land (the ones the holding share counts). */
function landed(m: Match) {
  let n = 0;
  for (const o of m.actors) if (o.alive && o.bot && !o.drop) n++;
  return n;
}

/** Royale, once a step on the machine that runs the rules: how many bots hold a building now, and if more than
 * HOLD_SHARE of those left do (some of the rest knocked out), the last ones in the list give it up. */
export function countHolds(m: Match) {
  const cap = Math.floor(HOLD_SHARE * landed(m));
  let n = 0;
  for (const o of m.actors) {
    const br = o.brain;
    if (!br || br.holdI < 0) continue;
    if (!o.alive || !o.bot || n >= cap) {
      endHold(m, br);
      continue;
    }
    n++;
  }
  m.holders = n;
}

function endHold(m: Match, br: Brain) {
  br.holdI = -1;
  br.holdSpot = -1;
  br.holdCd = m.time + 15;
  br.repath = true;
}

/** Royale, after a look round: a holder leaves when its time is up, the next circle leaves its building out, the zone
 * is on it, or someone hurts it from close by. */
function keepHold(m: Match, a: Actor, br: Brain) {
  if (br.holdI < 0) return;
  const z = m.zone!;
  const q = roomsOf(m.world)[br.holdI];
  const o = a.hurtFrom >= 0 ? m.actors[a.hurtFrom] : null;
  const close = !!o && o.alive && m.time - a.hurtT < 1 && Math.hypot(o.body.x - a.body.x, o.body.z - a.body.z) < HOLD_NEAR;
  const out = z.nr <= 0 || Math.hypot(q.x - z.nx, q.z - z.nz) > z.nr - 2 || Math.hypot(a.body.x - z.x, a.body.z - z.z) > z.r - 6;
  if (close || out || m.time > br.holdEnd) {
    endHold(m, br);
    if (m.holders > 0) m.holders--;
  }
}

/** Royale, nobody in sight: whether to go and hold a building now (a regular or a veteran, late on, with room in the
 * share), and starts it. */
function startHold(m: Match, a: Actor, br: Brain) {
  const z = m.zone!;
  if (br.holdI >= 0 || m.time < br.holdLook || m.time < br.holdCd) return;
  br.holdLook = m.time + 2.5;
  if (z.i < HOLD_PHASE || z.nr <= 0 || (br.tier !== 1 && br.tier !== 2) || !currentGun(a) || a.hp < COVER_HP) return;
  const b = a.body;
  if (Math.hypot(b.x - z.nx, b.z - z.nz) > z.nr - 3) return;
  if (m.holders + 1 > HOLD_SHARE * landed(m)) return;
  const rooms = roomsOf(m.world);
  let best = -1;
  let bestD = HOLD_R;
  for (let i = 0; i < rooms.length; i++) {
    const q = rooms[i];
    if (Math.abs(q.x - b.x) > bestD || Math.abs(q.z - b.z) > bestD) continue;
    const d = Math.hypot(q.x - b.x, q.z - b.z);
    if (d >= bestD || Math.hypot(q.x - z.nx, q.z - z.nz) > z.nr - 3) continue;
    // (one to a building)
    if (m.actors.some((o) => o.alive && o.brain?.holdI === i)) continue;
    best = i;
    bestD = d;
  }
  if (best < 0) return;
  const q = rooms[best];
  br.holdI = best;
  br.holdSpot = q.spots[Math.floor(br.rng() * q.spots.length)];
  br.holdEnd = m.time + HOLD_T;
  br.faceX = q.doorX;
  br.faceZ = q.doorZ;
  br.loot = -1;
  m.holders++;
}

/** Royale: where to run to get into the next circle (center tx, tz, radius R): in along its own bearing from the
 * middle (give or take 25 degrees), to a spot 10 to 35% of R in from the edge (at least a few meters in a small one),
 * on dry land if one of a few tries finds it. The bots spread round the edge instead of all piling into the middle. */
export function edgeGoal(m: Match, a: Actor, tx: number, tz: number, R: number) {
  const t = m.world.terrain;
  const r = a.brain!.rng;
  const A = m.world.arena;
  const bear = Math.atan2(a.body.x - tx, a.body.z - tz);
  const inset = (f: number) => edgeInset(R, f);
  let x = 0;
  let z = 0;
  for (let k = 0; k < 4; k++) {
    // (the last try straight along the bearing, as deep in as it goes)
    const ang = k < 3 ? bear + (r() - 0.5) * 2 * EDGE_JITTER : bear;
    const d = R - inset(k < 3 ? EDGE_IN[0] + r() * (EDGE_IN[1] - EDGE_IN[0]) : EDGE_IN[1]);
    x = tx + Math.sin(ang) * d;
    z = tz + Math.cos(ang) * d;
    const wet = t.hasWater && !t.ice && heightAt(t, x, z) < t.water - 0.3;
    if (!wet && Math.abs(x) < A - 4 && Math.abs(z) < A - 4) break;
  }
  return { x, z };
}
/** How far in from the edge of a circle of radius R a bot aims for a share f: f of R, but never under 10 m (or 0.6 R
 * in a small one), so it ends up well enough in not to be heading in again at once. */
export const edgeInset = (R: number, f: number) => Math.max(f * R, Math.min(0.6 * R, 10));
/** How far in from the edge of the next circle the bots aim (shares of its radius), and the spread of bearings. */
export const EDGE_IN = [0.1, 0.35];
export const EDGE_JITTER = (25 * Math.PI) / 180;

/** Where the bot wants to go when nobody is in sight (or, in a royale, when it has to get out from under shells). */
function plan(m: Match, a: Actor, br: Brain) {
  if (m.mode !== 'royale') {
    planAny(m, a, br);
    return;
  }
  br.rush = false;
  if (fleeRed(m, a, br)) return;
  if (inCover(m, a, br)) return;
  planAny(m, a, br);
  // whatever it planned, not into a bombardment (one already inside it gets out once it reacts, above)
  const red = m.red;
  if (red && !inRed(m, a)) {
    const dx = br.goalX - red.x;
    const dz = br.goalZ - red.z;
    const d = Math.hypot(dx, dz);
    if (d < red.r + 6) {
      const k = (red.r + 8) / (d || 1);
      setGoal(m, br, red.x + (d ? dx : 1) * k, red.z + dz * k);
      br.loot = -1;
    }
  }
}

/** A bombardment marked over it: stay put under a roof, else run for the nearest edge (shooting on the way if it
 * must). The sharper ones react sooner after the warning. */
function fleeRed(m: Match, a: Actor, br: Brain) {
  const red = m.red;
  if (!red || !inRed(m, a) || red.warn > RED_WARN - 0.6 - (1 - br.skill) * 2.5) return false;
  const b = a.body;
  if (underRoof(m.world, b.x, eyeY(a), b.z)) {
    setGoal(m, br, b.x, b.z);
    br.loot = -1;
    return true;
  }
  const dx = b.x - red.x;
  const dz = b.z - red.z;
  const d = Math.hypot(dx, dz) || 1;
  const k = (red.r + 10) / d;
  setGoal(m, br, red.x + (d > 0.5 ? dx : 1) * k, red.z + (d > 0.5 ? dz : 0) * k);
  br.loot = -1;
  br.supply = -1;
  br.rush = true;
  return true;
}

/** Where the bot wants to go when nobody is in sight, in any mode. */
function planAny(m: Match, a: Actor, br: Brain) {
  const r = br.rng;
  if (m.mode === 'breach') {
    planBreach(m, a, br);
    return;
  }
  // chase what we lost, for a while (royale: a bot lost sight of is gone after only as often as the pace allows)
  const chase = m.mode !== 'royale' || !a.bot || !br.lostBot || br.chaseRoll < m.pace;
  if (chase && br.hasLast && m.time - br.lostAt < 5 && Math.hypot(br.lastX - a.body.x, br.lastZ - a.body.z) < 45) {
    setGoal(m, br, br.lastX, br.lastZ);
    return;
  }
  // a loud sound from an enemy: close, go and see; far, a quick look that way and on with the plan (and not again
  // for a few seconds, or a fight going on somewhere would keep it standing there listening)
  if (m.time - br.heardT > 3)
    for (const s of m.sounds) {
      if (s.team === a.team || s.who === a.id) continue;
      const d = Math.hypot(s.x - a.body.x, s.z - a.body.z);
      // (royale: a bot heard by a bot is gone after less often while the match runs ahead of its pace)
      if (d < s.range && d > 4 && r() < (m.mode === 'royale' ? (a.vest > 0 && (a.guns[0] || a.guns[2]) ? 0.3 * (a.bot && m.actors[s.who]?.bot ? m.pace : 1) : 0) : 0.5)) {
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
    // (some hold from the far side of the site instead, back toward their own spawn, so a push onto it has open
    // ground to cross under their guns)
    const deep = Math.abs(br.holdA - 0.5) < 0.3;
    const spot = deep ? siteSpot(m, k, e.x, e.z, Math.PI + side * 0.6, 7 + br.holdA * 6) : siteSpot(m, k, e.x, e.z, side, 4 + br.holdA * 6);
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
  // a boost once hurt and out of the fight for a moment (or to top the meter up after a heal)
  br.boostNow = !br.healNow && a.hp < 95 && a.boost < 30 && m.time - a.hurtT > 3 && !!boostPick(a) && dz < z.r - 4;
  // a long way from where the zone is going: a vehicle parked near gets there sooner
  if (seekCar(m, a, br)) return;
  // out of the zone (or soon to be): head in
  if (dz > z.r - 6 || (late && dn > z.nr - 8 && z.nr > 0)) {
    if (z.nr > 0 && a.bot && z.i >= LATE_PHASE) {
      // (in at the near side of the next circle, a little way past its edge, unless already going somewhere well in)
      const g = Math.hypot(br.goalX - z.nx, br.goalZ - z.nz);
      if (g > z.nr - edgeInset(z.nr, EDGE_IN[0]) + 1 || br.loot >= 0) {
        const p = edgeGoal(m, a, z.nx, z.nz, z.nr);
        setGoal(m, br, p.x, p.z);
      }
    } else {
      // (the first circle and the last, which closes to nothing: into the middle; and a person's own seat run by a
      // bot, as before)
      const tx = z.nr > 0 ? z.nx : z.x;
      const tz = z.nr > 0 ? z.nz : z.z;
      const rad = Math.max(0, (z.nr > 0 ? z.nr : z.r) * 0.45);
      if (Math.hypot(br.goalX - tx, br.goalZ - tz) > rad + 4 || br.loot >= 0) {
        const ang = r() * Math.PI * 2;
        const k = Math.sqrt(r()) * rad;
        setGoal(m, br, tx + Math.cos(ang) * k, tz + Math.sin(ang) * k);
      }
    }
    br.loot = -1;
    return;
  }
  if (br.healNow || br.boostNow) {
    setGoal(m, br, b.x, b.z);
    return;
  }
  // holding a building: back to its spot (and once there, facing the door)
  if (a.bot) startHold(m, a, br);
  if (br.holdI >= 0) {
    const i = br.holdSpot * 3;
    const L = m.world.loot;
    setGoal(m, br, L[i], L[i + 2], '', L[i + 1]);
    br.loot = -1;
    br.supply = -1;
    return;
  }
  // a supply crate coming down near it: the bolder ones with a gun go for it (and the fight that comes with it)
  for (const s of m.supplies) {
    const bit = 1 << s.id;
    if (br.supplySeen & bit) continue;
    br.supplySeen |= bit;
    const d = Math.hypot(s.x - b.x, s.z - b.z);
    if (br.supply < 0 && d < 170 && (a.guns[0] || a.guns[2]) && r() < (0.2 + br.skill * 0.5) * (1 - d / 220)) br.supply = s.id;
  }
  if (br.supply >= 0) {
    const s = m.supplies[br.supply];
    const d = Math.hypot(s.x - b.x, s.z - b.z);
    // there (the loot below takes it from here), emptied, or the zone has left it outside
    if ((d < 3 && s.landed >= 0) || !supplyLeft(m, s) || Math.hypot(s.x - z.x, s.z - z.z) > z.r - 4) br.supply = -1;
    else {
      // still coming down: wait near where it will land
      if (s.landed < 0 && d < 7) setGoal(m, br, b.x, b.z);
      else setGoal(m, br, s.x, s.z);
      return;
    }
  }
  // the loot it is after still there and still wanted?
  const cur = br.loot >= 0 ? m.loot[br.loot] : null;
  if (cur && (!cur.live || !wants(a, cur))) br.loot = -1;
  // after the same thing for long without getting it (out of reach after all): another
  br.lootAge = br.loot >= 0 ? br.lootAge + br.think : 0;
  if (br.lootAge > 30) {
    br.lootSkip = br.loot;
    br.loot = -1;
    br.lootAge = 0;
  }
  br.lootT -= br.think;
  if (br.loot < 0 && br.lootT <= 0) {
    br.lootT = 1.2 + r() * 0.8;
    let best = -1;
    let bestD = Infinity;
    // guns count as much nearer while empty handed
    const need = !a.guns[0] && !a.guns[2] ? 0.35 : 1;
    // (pacing: loot near another bot, or near what a bot nearer to it is going for, is left to that bot, more often the
    // further the match runs ahead of its pace; held as x, z and how near the other is to it, -1 for a bot itself)
    const claims: number[] = [];
    if (a.bot && r() > m.pace)
      for (const o of m.actors) {
        if (o === a || !o.alive || !o.bot || !o.brain || Math.abs(o.body.x - b.x) + Math.abs(o.body.z - b.z) > 100) continue;
        claims.push(o.body.x, o.body.z, -1);
        const it = o.brain.loot >= 0 ? m.loot[o.brain.loot] : null;
        if (it) claims.push(it.x, it.z, Math.hypot(it.x - o.body.x, it.z - o.body.z));
      }
    for (const it of m.loot) {
      if (!it.live || it.id === br.lootSkip) continue;
      const d = Math.abs(it.x - b.x) + Math.abs(it.z - b.z);
      if (d > 90) continue;
      const dd = d * (it.kind === 'gun' ? need : 1);
      if (dd >= bestD) continue;
      if (Math.hypot(it.x - z.x, it.z - z.z) > z.r - 4 || !wants(a, it)) continue;
      if (m.red && Math.hypot(it.x - m.red.x, it.z - m.red.z) < m.red.r + 4) continue;
      if (claims.length && claimed(claims, it.x, it.z, Math.hypot(it.x - b.x, it.z - b.z))) continue;
      bestD = dd;
      best = it.id;
    }
    br.loot = best;
  }
  if (br.loot >= 0) {
    const it = m.loot[br.loot];
    setGoal(m, br, it.x, it.z, '', it.y);
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

/** Is loot here left to another bot (one within CLAIM_R of it, or going for something within CLAIM_R of it from
 * nearer than `mine`)? */
function claimed(claims: number[], x: number, z: number, mine: number) {
  for (let c = 0; c < claims.length; c += 3) {
    const dx = claims[c] - x;
    const dz = claims[c + 1] - z;
    if (Math.abs(dx) < CLAIM_R && Math.abs(dz) < CLAIM_R && dx * dx + dz * dz < CLAIM_R * CLAIM_R && claims[c + 2] < mine) return true;
  }
  return false;
}

/** Royale: whether to walk to a vehicle (and on the way to one, keeps the goal on it). */
function seekCar(m: Match, a: Actor, br: Brain) {
  if (!m.cars.length || a.car >= 0) return false;
  const b = a.body;
  if (br.car >= 0) {
    const c = m.cars[br.car];
    // gone, taken, or too long getting to it: forget it for a while
    if (!c.alive || c.seats[0] >= 0 || claimedBy(m, c, a) || m.time - br.carT > 20) {
      if (c.claim === a.id) c.claim = -1;
      br.car = -1;
      br.carCd = m.time + 25;
      return false;
    }
    setGoal(m, br, c.x, c.z);
    return true;
  }
  if (br.carCd > m.time || br.healNow || !currentGun(a)) return false;
  const z = m.zone!;
  const tx = z.nr > 0 ? z.nx : z.x;
  const tz = z.nr > 0 ? z.nz : z.z;
  const R = z.nr > 0 ? z.nr : z.r;
  if (Math.hypot(b.x - tx, b.z - tz) - R * 0.5 < 120) return false;
  let best: Car | null = null;
  let bestD = 50;
  for (const c of m.cars) {
    if (!c.alive || c.seats[0] >= 0 || c.flooded || c.hp < CARS[c.kind].hp * 0.4 || claimedBy(m, c, a)) continue;
    const d = Math.hypot(c.x - b.x, c.z - b.z);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  if (!best) {
    br.carCd = m.time + 6;
    return false;
  }
  best.claim = a.id;
  br.car = best.id;
  br.carT = m.time;
  setGoal(m, br, best.x, best.z);
  return true;
}

/** Is a car spoken for by another bot still on its way to it? */
function claimedBy(m: Match, c: Car, a: Actor) {
  if (c.claim < 0 || c.claim === a.id) return false;
  const o = m.actors[c.claim];
  return !!o && o.alive && o.car < 0 && o.brain?.car === c.id;
}

/** Could a car drive this way for `dist` meters: nothing in the way, no cliff, no deep water? */
function roadClear(m: Match, c: Car, yaw: number, dist: number) {
  const w = m.world;
  const t = w.terrain;
  const S = CARS[c.kind];
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  let y = c.y;
  for (let d = S.hl + 1.5; d <= dist; d += 2.5) {
    const x = c.x + fx * d;
    const z = c.z + fz * d;
    if (Math.abs(x) > w.arena - 4 || Math.abs(z) > w.arena - 4) return false;
    const g = floorAt(t, x, z);
    if (Math.abs(g - y) > 1.6) return false;
    if (t.hasWater && !t.ice && heightAt(t, x, z) < t.water - S.wade * 0.6) return false;
    if (blockedAt(w, x, z, g, S.hw + 0.25)) return false;
    for (const o of m.cars) if (o !== c && Math.abs(o.x - x) < 3.5 && Math.abs(o.z - z) < 3.5) return false;
    y = g;
  }
  return true;
}

/** Royale, at the wheel: drive toward the circle, round what is in the way, back up when stuck, and get out once
 * there, when someone is near enough to fight, when the car is nearly done for, or after a while regardless. */
function driveInput(m: Match, a: Actor, br: Brain, inp: Input, dt: number) {
  const c = m.cars[a.car];
  const leave = () => {
    inp.ride = true;
    br.car = -1;
    br.carCd = m.time + 30;
    br.leaving = -1;
    br.revs = 0;
    br.path = null;
    br.repath = true;
    br.posX = br.longX = a.body.x;
    br.posZ = br.longZ = a.body.z;
    br.stuckT = br.longT = 0;
    return inp;
  };
  // (a passenger seat is no place for a bot)
  if (a.carSeat !== 0 || !c) return leave();
  const S = CARS[c.kind];
  const b = a.body;
  br.think -= dt;
  br.revT -= dt;
  if (br.think <= 0) {
    br.think = 0.25;
    perceive(m, a, br);
    const z = m.zone!;
    const tx = z.nr > 0 ? z.nx : z.x;
    const tz = z.nr > 0 ? z.nz : z.z;
    const R = z.nr > 0 ? z.nr : z.r;
    // where to: the near side of the circle, well inside it
    const dc = Math.hypot(b.x - tx, b.z - tz) || 1;
    const gx = tx + ((b.x - tx) / dc) * Math.min(dc, R * 0.45);
    const gz = tz + ((b.z - tz) / dc) * Math.min(dc, R * 0.45);
    const d = Math.hypot(gx - b.x, gz - b.z);
    // barely moving while trying to: back up a little, off to one side
    if (Math.abs(c.speed) < 1.2 && br.revT <= 0 && br.leaving < 0) br.carStuck += 0.25;
    else br.carStuck = Math.max(0, br.carStuck - 0.1);
    if (br.carStuck > 1.25) {
      br.carStuck = 0;
      br.revT = 1.2 + br.rng() * 0.6;
      br.revs++;
    }
    const tgt = br.target >= 0 ? m.actors[br.target] : null;
    const done = d < 22 || dc < R * 0.55 || (!!tgt && Math.hypot(tgt.body.x - b.x, tgt.body.z - b.z) < 75) || c.hp < S.hp * 0.3 || c.flooded || br.revs >= 4 || m.time - br.carT > 60;
    if (done && br.leaving < 0) br.leaving = m.time;
    // the heading: straight there unless something is in the way within a few seconds' drive
    const want = Math.atan2(-(gx - b.x), -(gz - b.z));
    const look = 9 + Math.abs(c.speed) * 1.1;
    br.driveYaw = want;
    for (const off of [0, 0.3, -0.3, 0.6, -0.6, 1, -1, 1.5, -1.5]) {
      const yaw = want + off * (br.strafe > 0 ? 1 : -1);
      if (roadClear(m, c, yaw, look)) {
        br.driveYaw = yaw;
        break;
      }
    }
  }
  // getting out: slow down first (but never wait on it long)
  if (br.leaving >= 0) {
    if (Math.abs(c.speed) < 5 || m.time - br.leaving > 3) return leave();
    inp.mz = c.speed > 0 ? -1 : 1;
    inp.jump = true;
  } else {
    const diff = angDiff(c.yaw, br.driveYaw);
    if (br.revT > 0) {
      inp.mz = -1;
      inp.mx = diff > 0 ? 1 : -1;
    } else {
      inp.mx = clamp(-diff * 2.2, -1, 1);
      inp.mz = Math.abs(diff) > 1.2 && c.speed > 7 ? -0.4 : Math.abs(diff) > 0.7 ? 0.45 : 1;
    }
  }
  // looking where it goes
  inp.yaw = a.yaw + clamp(angDiff(a.yaw, c.yaw), -dt * 4, dt * 4);
  inp.pitch = a.pitch * (1 - Math.min(1, dt * 3));
  return inp;
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
  if (a.car >= 0) return driveInput(m, a, br, inp, dt);
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
    // far from every person in a royale nobody sees the difference: think half as often
    if (m.mode === 'royale' && br.target < 0 && nearestPerson(m, a) > 160) br.think *= 2;
    perceive(m, a, br);
    // royale pacing: hurt in a fight it did not pick, the other (a bot or a person) past CALM_D, and the match ahead of
    // its pace: it may break off (and heal, loot or move on) instead of fighting it out
    if (m.mode === 'royale' && a.bot && br.target >= 0 && !br.started && a.hp < CALM_HP) {
      const o = m.actors[br.target];
      if (Math.hypot(o.body.x - a.body.x, o.body.z - a.body.z) > CALM_D && r() > m.pace) {
        br.calmOf = o.id;
        br.calmT = m.time + CALM_T;
        br.target = -1;
        br.lostAt = m.time;
        br.hasLast = false;
        br.repath = true;
      }
    }
    // royale: a holder may have to leave its building, and a hurt bot may break to cover
    if (m.mode === 'royale' && a.bot) {
      keepHold(m, a, br);
      takeCover(m, a, br);
    }
    // empty handed in a royale: keep looking for a gun even with someone in sight; under a bombardment, get out; on
    // the way to cover, keep to it
    if (br.target < 0 || (m.mode === 'royale' && (!currentGun(a) || inRed(m, a) || br.rush || m.time < br.coverEnd))) plan(m, a, br);
    route(m, a, br);
    if (br.detourT <= 0) steer(m, a, br);
    // stuck: walked under a second's worth less than half a meter while trying to move
    br.stuckT += br.think;
    const climbing = !!a.climb || a.ladder >= 0;
    if (climbing) br.stuckT = br.blockT = br.longT = 0;
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
    if (br.moving && br.detourT <= 0 && !climbing && navMark(m.world, br.wpX, br.wpZ) !== UP_LADDER && !canWalk(m.world, a.body.x, a.body.z, br.wpX, br.wpZ, a.body.y)) br.blockT += br.think;
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
    if (br.longT > 4 && !climbing) {
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
  // with a shield: up, the sidearm out, going in and in a fight up close (or with no long gun left to fight with);
  // down for a fight at range with a long gun (it thinks about it now and then, not every frame); in a royale, with
  // nobody in sight, down with the long gun out, as a person walks about
  br.shieldT -= dt;
  if (a.pavise > 0 && loaded(1) && br.shieldT <= 0) {
    br.shieldT = 1.2 + r() * 0.8;
    const t = br.target >= 0 ? m.actors[br.target] : null;
    const long = loaded(0) || loaded(2);
    const d = t ? Math.hypot(t.body.x - a.body.x, t.body.z - a.body.z) : 0;
    const pushing = m.mode === 'breach' && a.team === m.attack && m.charge.state !== 'planted';
    br.shieldUp = !long || (t ? d < 12 : pushing || (m.mode !== 'royale' && br.holdA < 0.5));
  }
  if (a.pavise <= 0 || !loaded(1)) br.shieldUp = false;
  if (br.shieldUp) {
    if (!a.paviseUp) inp.shield = true;
  } else {
    if (a.paviseUp) inp.shield = true;
    if (a.slot === 1 || !loaded(a.slot)) {
      const k = loaded(0) ? 0 : loaded(2) ? 2 : loaded(1) ? 1 : -1;
      if (k >= 0 && k !== a.slot) inp.slot = k;
    }
  }
  // standing in fire: out of it first
  const burning = m.fires.length ? inFire(m, a.body.x, a.body.y, a.body.z, 0.6) : null;
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
    else if (!tgt && br.boostNow && a.healT <= 0) inp.boost = true;
    // at the door of the vehicle it came for: in
    if (br.car >= 0 && carNear(m, a)?.id === br.car) inp.ride = true;
  }
  // breach: plant once on the spot with nobody in sight (or the clock about to run out); defuse when clear, or
  // regardless once the fuse is too short to wait
  let busy = false;
  if (m.mode === 'breach' && m.phase === 'live') {
    const c = m.charge;
    const gd = Math.hypot(br.goalX - a.body.x, br.goalZ - a.body.z);
    if (plantSite(m, a) >= 0 && (c.plantBy === a.id || ((!tgt || m.phaseT < PLANT_TIME + 2) && (gd < 2.6 || m.phaseT < PLANT_TIME + 6)))) busy = true;
    else if (canDefuse(m, a) && (c.defuseBy === a.id || !tgt || c.fuse < DEFUSE_TIME - c.defuseKept + 2)) busy = true;
    // (on fire it gets out first, unless the fuse can't wait)
    if (busy && burning && !(canDefuse(m, a) && c.fuse < DEFUSE_TIME - c.defuseKept + 1.5)) busy = false;
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
    // a raised shield facing it: shoot under it at the feet (crouched behind it there's nothing to hit: flank)
    const tf = viewDir(tgt.yaw, 0);
    const shielded = tgt.paviseUp && (-dx * tf.x - dz * tf.z) / (d || 1) > 0.3;
    // (a crossbow bolt's arc, from where it was zeroed)
    const drop = w.cls === 'crossbow' ? 4.9 * tof * Math.max(0, tof - 30 / w.speed) * (0.5 + br.skill * 0.5) : br.skill * 4.9 * tof * tof;
    // (lying down: the head, or the back just behind it; a head leant out: where it is)
    partsOf(tgt, seen);
    const low = tgt.prone > 0.5;
    const part = br.head ? 0 : low ? 1 : -1;
    const ty = (shielded ? tgt.body.y + 0.16 : part >= 0 ? seen[part * 4 + 1] : tgt.body.y + tgt.body.height * 0.66) + drop;
    const ax = tx + (part >= 0 && !shielded ? seen[part * 4] - tgt.body.x : 0) - a.body.x;
    const az = tz + (part >= 0 && !shielded ? seen[part * 4 + 2] - tgt.body.z : 0) - a.body.z;
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
      const j = ((1 - br.skill) * 0.01 + tv * 0.0015 * (1 - br.skill * 0.6)) * (m.mode === 'royale' ? 1.8 : 1) * (m.mode === 'royale' && a.bot && tgt.bot ? paceAim(m.pace) : 1);
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
      // royale, a long shot through a scope or with a marksman's gun: some get down for it
      // (never a recruit)
      if (m.mode === 'royale' && br.tier > 0 && br.proneT <= 0 && d > 55 && g && (scopeOf(g) || w.cls === 'sniper' || w.cls === 'dmr') && r() < 0.15 + br.skill * 0.25) br.proneT = 4 + r() * 6;
    }
    const toward = Math.atan2(dx, dz);
    const reach = REACH[g?.id ?? 'wren'];
    moveAng = toward + (Math.PI / 2) * br.strafe;
    if (!g) moveAng = toward + Math.PI + 0.5 * br.strafe;
    else if (d > pref + 12) moveAng = toward + (d > reach ? 0.15 : 0.5) * br.strafe;
    else if (d < pref * 0.5) moveAng = toward + Math.PI - 0.6 * br.strafe;
    // round the side of a shield
    if (shielded) moveAng = toward + (Math.PI / 2 - 0.25) * br.strafe;
    if (!free(m, a, moveAng, 1.6)) moveAng = toward - (Math.PI / 2) * br.strafe;
    // breach, a spot to hold (or royale, a building held): no closing in, only a step to either side, and back onto
    // it if off it
    if (((m.mode === 'breach' && br.hold) || (m.mode === 'royale' && br.holdI >= 0)) && g) {
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
    const sc = !!g && scopeOf(g);
    const scoped = sc || w.cls === 'rifle' || w.cls === 'lmg' || w.cls === 'crossbow';
    inp.ads = scoped && d > 22 && br.skill > 0.3;
    if (w.cls === 'sniper') inp.ads = d > 8;
    const aligned = errNow < tol && (!sc || a.ads > 0.9 || !inp.ads);
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
      // the good ones stop dead to shoot; the rest at least slow to a walk (not on the run to cover)
      if (!(m.mode === 'royale' && br.rush && m.time < br.coverEnd)) {
        if (br.skill > 0.45) moveAng = NaN;
        walk = true;
      }
    }
    if (br.crouchT > 0) {
      br.crouchT -= dt;
      inp.crouch = d > 6;
    }
    if (g && g.mag === 0) inp.reload = true;
    // a frag at a target behind cover (sooner at one behind a shield), or an impact grenade right at them (a royale's
    // recruits throw none)
    if (m.mode !== 'dm' && !(m.mode === 'royale' && br.tier === 0) && (a.frags > 0 || a.impacts > 0) && br.nadeT <= 0 && br.seenFor > 1 && d > 10 && d < 32 && br.skill > 0.3 && r() < (shielded ? 0.08 : 0.02)) {
      const impact = a.impacts > 0 && (a.frags <= 0 || d < 22);
      wantPitch += impact ? 0.12 + d * 0.006 : 0.25 + d * 0.004;
      inp.throw = impact ? 'impact' : 'frag';
      br.nadeT = 8;
    }
  } else {
    br.seenFor = 0;
    br.burst = 0;
    // reload in a quiet moment
    if (g && g.mag < magOf(g) * 0.5 && spareOf(m, a, g) > 0) inp.reload = true;
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
      // (an incendiary does it best: it keeps them out of there for a while)
      if (!(m.mode === 'royale' && br.tier === 0) && (a.frags > 0 || a.fires > 0) && br.nadeT <= 0 && d > 9 && d < 30 && m.time - br.lostAt > 0.8 && br.skill > 0.3) {
        wantPitch += 0.3 + d * 0.004;
        inp.throw = a.fires > 0 ? 'fire' : 'frag';
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
      // (there: right over or under it is not there, for a goal up on a floor)
      if (gd < (m.mode === 'royale' ? 0.9 : br.arrive) && !(Math.abs(a.body.y - br.goalY) > 1.2)) {
        moveAng = NaN;
        if (m.mode === 'breach') {
          wantYaw = Math.atan2(-(br.faceX - a.body.x), -(br.faceZ - a.body.z)) + (br.holdA - 0.5) * 0.35;
          // some hold crouched, a smaller and quieter shape
          inp.crouch = br.holdA > 0.45;
        } else if (m.mode === 'royale' && br.holdI >= 0) wantYaw = Math.atan2(-(br.faceX - a.body.x), -(br.faceZ - a.body.z));
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
      // the charge planted and a defender on it: an incendiary on the charge (the attack)
      const c = m.charge;
      if (m.mode === 'breach' && a.team === m.attack && a.fires > 0 && br.nadeT <= 0 && c.state === 'planted' && (c.defuseBy >= 0 || (br.hasLast && Math.hypot(br.lastX - c.x, br.lastZ - c.z) < 6 && m.time - br.lostAt < 3))) {
        const d = Math.hypot(c.x - a.body.x, c.z - a.body.z);
        if (d > 8 && d < 26) {
          const yaw = Math.atan2(-(c.x - a.body.x), -(c.z - a.body.z));
          wantYaw = yaw;
          wantPitch = Math.acos(clamp(d / 25, 0.3, 1)) - 0.1;
          moveAng = NaN;
          if (Math.abs(angDiff(a.yaw, yaw)) < 0.15 && Math.abs(a.pitch - wantPitch) < 0.1) {
            inp.throw = 'fire';
            br.nadeT = 6;
          }
        }
      }
      // gathering to go in: a decoy thrown out ahead, to pull the defense's eyes (and ears) that way
      if (m.mode === 'breach' && a.team === m.attack && a.decoys > 0 && br.nadeT <= 0 && c.state === 'carried' && !stageOf(m).go && br.role !== 'entry') {
        wantPitch = 0.5;
        if (Math.abs(a.pitch - 0.5) < 0.1) {
          inp.throw = 'decoy';
          br.nadeT = 5;
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
  // royale: lying still for a long shot (until it runs out, they come close or it gets hurt), or down in long grass
  // while patching up, well inside the zone
  if (m.mode === 'royale' && !burning) {
    if (br.proneT > 0) {
      br.proneT -= dt;
      const near = !!tgt && Math.hypot(tgt.body.x - a.body.x, tgt.body.z - a.body.z) < 25;
      if (near || (m.time - a.hurtT < 0.25 && a.hp < 70)) br.proneT = 0;
    }
    const z = m.zone;
    const hide = !tgt && a.healT > 0 && !!z && Math.hypot(a.body.x - z.x, a.body.z - z.z) < z.r - 15 && grassy(m, a);
    if (br.proneT > 0 || hide) {
      inp.prone = true;
      moveAng = NaN;
    }
  }
  // on fire: straight out of it, the way away from its middle
  if (burning) {
    moveAng = Math.atan2(a.body.x - burning.x, a.body.z - burning.z);
    walk = false;
    br.moving = true;
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
  // on a ladder or in a climb: on along the route (up or down it), fight or no fight
  if (a.ladder >= 0 || a.climb) {
    moveAng = Math.atan2(br.wpX - a.body.x, br.wpZ - a.body.z);
    br.moving = true;
  }
  // move along the chosen world heading, expressed in the bot's own frame
  if (Number.isNaN(moveAng)) {
    br.moving = false;
  } else {
    const gd = Math.hypot(br.goalX - a.body.x, br.goalZ - a.body.z);
    if (!tgt && !burning && gd < (m.mode === 'royale' ? 0.9 : Math.min(1.6, br.arrive)) && br.detourT <= 0 && a.ladder < 0 && !(Math.abs(a.body.y - br.goalY) > 1.2)) br.moving = false;
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
