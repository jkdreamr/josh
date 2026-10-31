// Online packets for Scramble. Pure, so it can be tested.
//
// Rooms are a star around the host. Every client reports the egg it owns about 15 times a second; the host owns the
// computer players and sends everyone the whole match. Things that happen (shots, hits, drops, built pieces and edits,
// pickups) travel as events: a guest sends its own to the host, and the host applies them and passes them on to
// everyone else, in the order it applied them, together with its own. Guests ask the host for pickups and chests
// (fridges and supply drops too) and hear back who got them, and ask the host to open or shut doors, which it does and
// tells everyone. Broken windows travel as news too, and every reliable report from the host lists them all, and every
// door that isn't shut, so a guest who missed the news (or synced late) still has them. Bounce pads and campfires need
// no packets: a glide and a heal are an owner's own business, and show in its state, as does how high an egg stands
// on what's been built. Nor does the kill leader: everyone counts the kills. Nor do the stairs down to the basements:
// which level an egg is on goes with where it is (underground lies far off east of the ground over it), and so does
// where each thing it drops lands.
//
// In duos and squads, the host's reliable reports carry the mode and everyone's team. A knocked egg's owner says so
// (its state says it too, for anyone who missed the news), a reviver says when it starts and stops, a guest asks the
// host to stand the teammate up once it's done, and the host says when it stands. Pings go to everyone (only the team
// shows them), and so do emotes and the team's calls (only the team shows a call): the host turns away an egg's that
// come too quickly (see emoteReady) and passes on no more of them.
//
// Cars (see logic.ts Ride) move with their drivers' reports: a driver's egg sits at the wheel facing the way its car
// does. An egg asks the host to get in ('vq'), and says when it got out (where it left its car, if it drove); the host
// says who sits where ('vs') and when a car goes up ('vx'), and hits on cars go to it like hits on walls. Every
// reliable report from the host lists the cars that aren't as they started (where, which way, their health and who
// sits where), so a guest who missed the news (or synced late) has them too.
//
// When the host leaves mid-match the room makes someone else in it the host, and their game takes the match over (see
// session.ts takeOver). So that it can, the host tells the guests likeliest to be next what each computer egg carries
// (its kit), every guest keeps the last few seconds of what the host settled and hands it to the new host (who settles
// whatever it hadn't heard of), and the host's reliable reports say how many hand-offs the match has had.
import { AMMO_TYPES, BOOST, MATS, MAT_MAX, MAT_SPECS, MAX_ARMOR, MAX_PACK, MAX_RARITY, MAX_SCOPE, MELEE, MELEE_IDS, THROWS, THROW_IDS, USE_IDS, WEAPONS, WEAPON_IDS, damageOf, isMelee, isThrow, isWeapon, parseLoot, type LootDef, type ThrowId, type WeaponId } from './items.ts';
import { DROP_BASE, HALF, opens, topX } from './map.ts';
import { meta } from './meta.ts';
import {
  CAUSES,
  CELL_B,
  CRASH,
  DOOR_OPENING,
  DOOR_R,
  DOOR_STATES,
  EMOTE_IDS,
  F_ALL,
  HELD,
  LEVEL_H,
  MAX_FIGHTERS,
  MAX_LEVEL,
  MAX_SEATS,
  MAX_TEAMS,
  PHASES,
  PIECE_KINDS,
  RAM,
  SLOT_THROW,
  TEAM_SIZE,
  VAULT_TIME,
  addLoot,
  addWall,
  applyCalled,
  applyEdit,
  applyEmote,
  applyKnock,
  applyOut,
  applyPing,
  applyRevive,
  applyRevived,
  applySeat,
  applyTook,
  breakGlass,
  callDrop,
  damageCrate,
  damageDoor,
  damageRide,
  damageWall,
  fire,
  flagsOf,
  freeSeat,
  grantTake,
  hasScope,
  held,
  hurt,
  isLevel,
  isMode,
  launch,
  makePiece,
  moveLoot,
  openContainer,
  owned,
  removeWall,
  reviveEgg,
  seatEgg,
  setDoor,
  slabGap,
  toggleDoor,
  wreckRide,
  type Cause,
  type Ev,
  type Fighter,
  type Gun,
  type Held,
  type Level,
  type Match,
  type Mode,
  type Phase,
  type PieceKind,
  type Ride,
  type Wall,
} from './logic.ts';

/** Whether the host fills empty places with computer players. */
export type Bots = 'fill' | 'none';
export const isBots = (v: unknown): v is Bots => v === 'fill' || v === 'none';

/**
 * An egg as its owner reports it, down to the helmet and vest it wears and its scopes: the one it looks through
 * (`scope`) and the ones it carries (`scopes`, a bit each for 2x, 4x, 8x and 15x).
 */
export type State = { x: number; z: number; y: number; aim: number; vx: number; vz: number; phase: Phase; hp: number; shield: number; w: Held | null; r: number; flags: number; helmet: number; vest: number; scope: number; scopes: number };

/**
 * `h` is the level a shot was fired from, `y0` and `ly` how high a throw starts and comes down (left out when 0). A
 * built piece goes as its id, its builder, where and what it is in one number (`p`, see packPiece), its health and the
 * tenths of a second it has still to build up (`t`); an edit as the wall and its edit. An emote goes as its place in
 * EMOTE_IDS (`k`), the ammo asked for as its place in AMMO_TYPES (`a`), and the spot an enemy was seen.
 */
export type NetEv =
  | { y: 's'; f: number; w: WeaponId; r: number; x: number; z: number; a: number; s: number; k: number; h?: number }
  | { y: 'sw'; f: number }
  | { y: 'th'; f: number; k: ThrowId; x: number; z: number; lx: number; lz: number; ft: number; y0?: number; ly?: number }
  | { y: 'd'; f: number; to: number; d: number; w: Cause; x: number; z: number }
  | { y: 'm'; f: number; k: 'wall' | 'crate' | 'door' | 'car'; id: number; d: number }
  | { y: 'gl'; f: number; i: number }
  | { y: 'dq'; f: number; i: number }
  | { y: 'ds'; f: number; i: number; s: number }
  | { y: 'b'; f: number; x: number; z: number; h?: number; r?: number }
  | { y: 'o'; f: number; by: number; w: Cause }
  | { y: 'dr'; id: number; x: number; z: number; by: number; it: LootDef }
  | { y: 'tk'; f: number; id: number }
  | { y: 'tko'; f: number; id: number; it: LootDef }
  | { y: 'op'; f: number; c: number }
  | { y: 'opd'; c: number; f: number }
  | { y: 'wl'; id: number; f: number; p: number; hp: number; t: number }
  | { y: 'we'; f: number; id: number; e: number }
  | { y: 'wg'; id: number }
  | { y: 'lv'; id: number; x: number; z: number }
  | { y: 'fd'; f: number; c: number; x: number; z: number; at: number }
  | { y: 'kn'; f: number; by: number; w: Cause }
  | { y: 'rv'; f: number; to: number }
  | { y: 'rq'; f: number; to: number }
  | { y: 'rvd'; f: number; by: number }
  | { y: 'pg'; f: number; x: number; z: number }
  | { y: 'em'; f: number; k: number; a?: number; x?: number; z?: number }
  | { y: 'vq'; f: number; v: number; x?: number; z?: number; a?: number }
  | { y: 'vs'; f: number; v: number; s: number; x: number; z: number; a: number }
  | { y: 'vx'; v: number; f: number; x: number; z: number; a: number };

/** A car as the host's reliable report has it (see rideNotes): which, where, which way, its health (0 gone up) and who sits where. */
export type RideNote = { i: number; x: number; z: number; a: number; hp: number; seats: number[] };

/** Events grouped by the seat they came from, in the order the host applied them. */
export type Group = [origin: number, events: NetEv[]];

export type Packet =
  | { k: 's'; round: number; state: State; watch: number; seq?: number }
  | { k: 'S'; round: number; seed: number; time: number; level: Level; roster: number[] | null; states: [number, State][]; glass: number[] | null; doors: number[] | null; mode: Mode; teams: number[] | null; rides: RideNote[] | null; handoffs: number }
  | { k: 'K'; round: number; kits: [number, Kit][] }
  | { k: 'L'; round: number; events: NetEv[]; end: { winner: number; places: [number, number, number][] } | null }
  | { k: 'e'; round: number; groups: Group[] }
  | { k: 'end'; round: number; winner: number; places: [number, number, number][] }
  | { k: 'cfg'; round: number; bots: Bots; level: Level; mode: Mode; picks: number[] }
  | { k: 'tm'; round: number; team: number };

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const int = (v: unknown): v is number => Number.isInteger(v);
const fid = (v: unknown): v is number => int(v) && (v as number) >= 0 && (v as number) < MAX_FIGHTERS;
/** Room seats: -1 for a computer egg, LEFT for someone who has left the match. */
const SEATS = meta.online?.seats ?? 1;
export const LEFT = -2;
const seat = (v: unknown): v is number => int(v) && (v as number) >= LEFT && (v as number) < SEATS;
const isCause = (v: unknown): v is Cause => CAUSES.includes(v as Cause);
/**
 * The most one hit from another client can do: a legendary bullet or pellet, a swing, a grenade right on top, or a car
 * running an egg over flat out. The rest (the storm, hot sauce, barrels, impulse eggs, a car going up) each client
 * works out for its own egg, so never arrives as a hit.
 */
export function hitCap(w: Cause) {
  if (isWeapon(w)) return Math.round(damageOf(w, MAX_RARITY));
  if (isMelee(w)) return MELEE[w].dmg;
  if (w === 'mirv') return Math.max(THROWS.mirv.dmg ?? 0, THROWS.mirv.split?.dmg ?? 0);
  if (w === 'car') return RAM.max;
  return w === 'grenade' ? (THROWS.grenade.dmg ?? 0) : 0;
}
/** Cars by their place in the match's list: well past what an island has. */
const MAX_RIDES = 64;
const ride = (v: unknown): v is number => int(v) && (v as number) >= 0 && (v as number) < MAX_RIDES;
/** A way to face, in radians (a little round the circle either way). */
const angle = (v: unknown): v is number => num(v) && Math.abs(v) <= 7;
/** Loot and wall ids: whole numbers well inside what JSON carries exactly. */
const id = (v: unknown): v is number => int(v) && (v as number) >= 0 && (v as number) < 1e9;
/** A point on the island. */
const onLand = (x: unknown, z: unknown) => num(x) && num(z) && Math.abs(x) <= HALF && Math.abs(z) <= HALF;
/** A point on the island or under it (see map.ts DEEP), or up to `pad` past its shore. */
const onLevel = (x: unknown, z: unknown, pad = 0): x is number => num(x) && num(z) && Math.abs(topX(x)) <= HALF + pad && Math.abs(z) <= HALF + pad;
/** How far past the shore a shot, a throw, a hit or a blast may be (an egg a guest sees is let run on a little). */
const SLACK = 32;
/** The most a shot's spread can be widened: on the move, with a heavy SMG climbing as far as it goes. */
export const MAX_KICK = r2(1.6 + Math.max(...Object.values(WEAPONS).map((w) => w.kick?.max ?? 0)));
/** The highest anything thrown starts or comes down: the top level. */
const MAX_Y = MAX_LEVEL * LEVEL_H + 1;
const height = (v: unknown) => v === undefined || (num(v) && v >= 0 && v <= MAX_Y);
const tossH = (v: unknown) => (num(v) ? v : 0);
/** Every scope bit set: 2x, 4x, 8x and 15x. */
const SCOPE_BITS = (1 << MAX_SCOPE) - 1;

// -------------------------------------------------------------------------------------------------------------------
// Built pieces.

/** Grid squares are numbered from -GRID_OFF along each side, GRID_N of them: the whole island and a little more. */
const GRID_OFF = 80;
const GRID_N = 160;
const PIECE_CODES = 4 * 4 * 4 * MATS.length * 3 * GRID_N * GRID_N;

/** Where a piece is, what it is and its edit in one whole number: kind, way, level, material, edit and grid square. */
export function packPiece(w: Wall) {
  const cell = w.cx + GRID_OFF + GRID_N * (w.cz + GRID_OFF);
  return PIECE_KINDS.indexOf(w.k) + 4 * (w.dir + 4 * (w.lv + 4 * (MATS.indexOf(w.mat) + MATS.length * (w.e + 3 * cell))));
}

/** A packed piece back, or null for anything no piece could be: off the island, on no level, a way or edit it can't have. */
export function unpackPiece(p: unknown): { k: PieceKind; dir: number; lv: number; mat: (typeof MATS)[number]; e: number; cx: number; cz: number } | null {
  if (!int(p) || p < 0 || p >= PIECE_CODES) return null;
  let v = p;
  const take = (n: number) => {
    const out = v % n;
    v = Math.floor(v / n);
    return out;
  };
  const k = PIECE_KINDS[take(4)];
  const dir = take(4);
  const lv = take(4);
  const mat = MATS[take(MATS.length)];
  const e = take(3);
  const cx = take(GRID_N) - GRID_OFF;
  const cz = v - GRID_OFF;
  if (Math.abs((cx + 0.5) * CELL_B) > HALF || Math.abs((cz + 0.5) * CELL_B) > HALF) return null;
  if (k === 'wall') return dir >= 2 && lv <= MAX_LEVEL ? { k, dir, lv, mat, e, cx, cz } : null;
  if (e) return null;
  if (k === 'ramp') return lv < MAX_LEVEL ? { k, dir, lv, mat, e, cx, cz } : null;
  if (dir) return null;
  return lv >= 1 && lv <= (k === 'roof' ? MAX_LEVEL + 1 : MAX_LEVEL) ? { k, dir, lv, mat, e, cx, cz } : null;
}

/** A piece as news: how it is now, for someone who hasn't seen it (just built, or for a guest that joins late). */
export const pieceEv = (w: Wall): NetEv => ({ y: 'wl', id: w.id, f: w.f, p: packPiece(w), hp: Math.max(1, Math.round(w.hp)), t: Math.round(w.left * 10) });

// -------------------------------------------------------------------------------------------------------------------
// States.

/** Positions travel in twentieths of a meter. */
const r20 = (n: number) => Math.round(n * 20) / 20;

export function stateOf(f: Fighter): State {
  const h = held(f);
  return { x: r20(f.x), z: r20(f.z), y: r1(f.y), aim: r2(f.aim), vx: r1(f.vx + f.kx), vz: r1(f.vz + f.kz), phase: f.phase, hp: r1(f.hp), shield: r1(f.shield), w: h.w, r: h.r, flags: flagsOf(f), helmet: f.helmet, vest: f.vest, scope: f.scope, scopes: f.scopes };
}

/** What an egg holds, as a number: 0 for nothing reported yet, then guns, melee weapons and throwables. */
const HELD_CODES: (Held | null)[] = [null, ...HELD];
/**
 * An egg's state as ten whole numbers, the fewest bytes for fifty eggs at a time: where it is (in twentieths of a
 * meter), how high and how fast (tenths), its aim (hundredths of a radian), what it is up to in one number (its
 * phase, what it holds and how rare, its helmet and vest, its scopes, each in bits of its own), health and shield
 * (tenths) and its flags.
 */
const packState = (s: State) => [
  Math.round(s.x * 20),
  Math.round(s.z * 20),
  Math.round(s.y * 10),
  Math.round(s.aim * 100),
  Math.round(s.vx * 10),
  Math.round(s.vz * 10),
  codeOf(s),
  Math.round(s.hp * 10),
  Math.round(s.shield * 10),
  s.flags,
];

/**
 * Phase, what's in hand and how rare, helmet and vest, and the scopes in one number; -1 (which no report gets past)
 * for nonsense, a scope it doesn't carry among it.
 */
function codeOf(s: State) {
  const fields = [s.r, s.helmet, s.vest, s.scope, s.scopes];
  if (!fields.every((v) => Number.isInteger(v) && v >= 0) || s.r > MAX_RARITY || s.helmet > MAX_ARMOR || s.vest > MAX_ARMOR || s.scope > MAX_SCOPE || s.scopes > SCOPE_BITS || !hasScope(s, s.scope)) return -1;
  return PHASES.indexOf(s.phase) + 4 * HELD_CODES.indexOf(s.w) + 256 * s.r + 2048 * s.helmet + 16384 * s.vest + 65536 * (s.scope + 8 * s.scopes);
}

function unpackState(a: unknown): State | null {
  if (!Array.isArray(a) || a.length < 10 || !a.slice(0, 10).every(int)) return null;
  const [x, z, y, aim, vx, vz, code, hp, shield, flags] = a as number[];
  if (code < 0 || code >= 65536 * 8 * (SCOPE_BITS + 1) || flags < 0 || flags > F_ALL) return null;
  const phase = PHASES[code % 4];
  const w = Math.floor(code / 4) % 64;
  const r = Math.floor(code / 256) % 8;
  const helmet = Math.floor(code / 2048) % 8;
  const vest = Math.floor(code / 16384) % 4;
  const scope = Math.floor(code / 65536) % 8;
  const scopes = Math.floor(code / 524288);
  if (w >= HELD_CODES.length || r > MAX_RARITY || helmet > MAX_ARMOR || vest > MAX_ARMOR || !hasScope({ scopes }, scope)) return null;
  if (Math.abs(topX(x / 20)) > 400 || Math.abs(z) > 8000 || y < -10 || y > 1000 || Math.abs(aim) > 10_000 || hp < 0 || hp > 1000 || shield < 0 || shield > 1000) return null;
  const clampV = (v: number) => Math.max(-40, Math.min(40, v / 10));
  return { x: x / 20, z: z / 20, y: y / 10, aim: aim / 100, vx: clampV(vx), vz: clampV(vz), phase, hp: hp / 10, shield: shield / 10, w: HELD_CODES[w], r, flags, helmet, vest, scope, scopes };
}

/**
 * A guest's report of its egg, and the egg it watches once its own is out (so the host knows what it needs to see),
 * numbered (`seq`, counting up) so one that comes in behind a newer one is let go.
 */
export const guestState = (round: number, s: State, watch = -1, seq = -1) => ({ t: 'pk', r: round, k: 's', c: packState(s), ...(watch >= 0 ? { v: watch } : {}), ...(seq >= 0 ? { n: seq } : {}) });

/** A state as a string, to tell whether it has changed since it was last sent. */
export const stateKey = (s: State) => packState(s).join();

/**
 * The host's report of the eggs: the roster goes with every reliable one (null for the rest), which a guest needs to
 * join, and so do the broken windows (`broken`, by window) and the doors (`doors`, their states by door) once any
 * have changed, in duos and squads the mode and everyone's team (`teams`, by fighter), and the cars that aren't as
 * they started (`rides`, see rideNotes).
 */
export const hostState = (round: number, seed: number, time: number, level: Level, roster: number[] | null, states: [number, State][], broken: boolean[] = [], doors: number[] = [], mode: Mode = 'solo', teams: number[] = [], rides: Ride[] = [], handoffs = 0) => {
  const gl = roster ? packGlass(broken) : '';
  const dz = roster ? packDoors(doors) : '';
  const vh = roster ? rideNotes(rides) : [];
  return {
    t: 'pk',
    r: round,
    k: 'S',
    sd: seed,
    tm: r2(time),
    lv: level,
    // (once the match has changed hands, every report says how often: the roster is in the room's seats since then)
    ...(handoffs ? { ho: handoffs } : {}),
    ...(roster ? { ro: roster } : {}),
    ...(roster && mode !== 'solo' ? { md: mode, te: teams } : {}),
    ...(gl ? { gl } : {}),
    ...(dz ? { dz } : {}),
    ...(vh.length ? { vh } : {}),
    c: states.map(([f, s]) => [f, ...packState(s)]),
  };
};

/** Who sits in a car's seats as one whole number: each seat's fighter plus one (0 for nobody), a place each. */
const SEAT_BASE = MAX_FIGHTERS + 1;
export const packSeats = (seats: number[]) => seats.reduce((n, id, k) => n + (id + 1) * SEAT_BASE ** k, 0);
export function unpackSeats(v: number) {
  const out: number[] = [];
  for (let k = 0, n = v; k < MAX_SEATS; k++, n = Math.floor(n / SEAT_BASE)) out.push((n % SEAT_BASE) - 1);
  return out;
}

/**
 * The cars that aren't as they started (someone has been in one, it's hurt or it has gone up), each as six whole
 * numbers: its place in the list, where it is (tenths of a meter), the way it faces (hundredths of a radian), its
 * health (0 once it's gone up) and who sits where (see packSeats).
 */
export const rideNotes = (rides: Ride[]) => rides.filter((c) => c.dead || c.at > -99 || c.hp < c.max).map((c) => [c.i, Math.round(c.x * 10), Math.round(c.z * 10), Math.round(c.a * 100), c.dead ? 0 : Math.max(1, Math.ceil(c.hp)), packSeats(c.seats)]);

/** The cars a report lists, or null when the list isn't one. */
export function parseRides(v: unknown): RideNote[] | null {
  if (!Array.isArray(v) || v.length > MAX_RIDES) return null;
  const out: RideNote[] = [];
  for (const raw of v) {
    if (!Array.isArray(raw) || raw.length !== 6 || !raw.every(int)) return null;
    const [i, x, z, a, hp, seats] = raw as number[];
    if (!ride(i) || !onLand(x / 10, z / 10) || !angle(a / 100) || hp < 0 || hp > 1000 || seats < 0 || seats >= SEAT_BASE ** MAX_SEATS) return null;
    out.push({ i, x: x / 10, z: z / 10, a: a / 100, hp, seats: unpackSeats(seats) });
  }
  return out;
}

/** Each fighter's team as a roster's report has it, or null when it isn't one for this many fighters in this mode. */
export function parseTeams(v: unknown, mode: Mode, n: number): number[] | null {
  if (!Array.isArray(v) || v.length !== n || !v.every((t) => int(t) && t >= 0 && t < MAX_TEAMS)) return null;
  const size = new Map<number, number>();
  for (const t of v as number[]) size.set(t, (size.get(t) ?? 0) + 1);
  return [...size.values()].every((k) => k <= TEAM_SIZE[mode]) ? (v as number[]) : null;
}

/** The most doors a report can list (an island has about a hundred). */
const MAX_DOORS = 2000;

/** Door states as one digit a door (its place in DOOR_STATES), trailing shut ones left off. */
export const packDoors = (doors: number[]) => doors.map((s) => Math.max(0, DOOR_STATES.indexOf(s as (typeof DOOR_STATES)[number]))).join('').replace(/0+$/, '');

/** The door states a list of digits says (shut past its end), or null when it isn't one. */
export function unpackDoors(v: unknown): number[] | null {
  if (typeof v !== 'string' || v.length > MAX_DOORS || !new RegExp(`^[0-${DOOR_STATES.length - 1}]*$`).test(v)) return null;
  return [...v].map((c) => DOOR_STATES[Number(c)]);
}

/** The most windows a report can list (an island has a couple of hundred). */
const MAX_GLASS = 4000;

/** Broken windows as hex digits, four windows a digit (the first in the lowest bit), trailing zeros left off. */
export function packGlass(broken: boolean[]) {
  let out = '';
  for (let k = 0; k * 4 < broken.length; k++) out += ((broken[k * 4] ? 1 : 0) | (broken[k * 4 + 1] ? 2 : 0) | (broken[k * 4 + 2] ? 4 : 0) | (broken[k * 4 + 3] ? 8 : 0)).toString(16);
  return out.replace(/0+$/, '');
}

/** The windows a hex list says are broken, or null when it isn't one. */
export function unpackGlass(v: unknown): number[] | null {
  if (typeof v !== 'string' || v.length > MAX_GLASS / 4 || !/^[0-9a-f]*$/.test(v)) return null;
  const out: number[] = [];
  for (let k = 0; k < v.length; k++) {
    const n = parseInt(v[k], 16);
    for (let j = 0; j < 4; j++) if (n & (1 << j)) out.push(k * 4 + j);
  }
  return out;
}

export const endOf = (round: number, winner: number, places: [number, number, number][]) => ({ t: 'pk', r: round, k: 'end', w: winner, pl: places });

// -------------------------------------------------------------------------------------------------------------------
// Hand-offs: what a guest needs to take the match over.

/** The most hand-offs a match can have: everyone in a full room leaving in turn. */
const MAX_HANDOFFS = SEATS;

/** What a computer egg carries: all a new host needs, with what it reports, to run it (see adoptBots). */
export type Kit = Pick<Fighter, 'guns' | 'melee' | 'slot' | 'pick' | 'throws' | 'ammo' | 'items' | 'boost' | 'pack' | 'wood' | 'stone' | 'metal' | 'mat' | 'dropSeq' | 'wallSeq'>;

/**
 * A kit as whole numbers: each gun (its place in WEAPON_IDS from 1, 0 for none, how rare, what's in its mag), the
 * melee weapon, the slot in hand and the throwable picked, so many of each throwable, ammo and consumable, then the
 * boost, the backpack, wood, stone and metal, the material picked, and how many drops and pieces it has numbered.
 */
export function kitOf(f: Fighter): number[] {
  const gun = (g: Gun | null) => (g ? [WEAPON_IDS.indexOf(g.w) + 1, g.r, g.mag] : [0, 0, 0]);
  return [
    ...gun(f.guns[0]),
    ...gun(f.guns[1]),
    MELEE_IDS.indexOf(f.melee),
    f.slot,
    THROW_IDS.indexOf(f.pick),
    ...THROW_IDS.map((k) => f.throws[k]),
    ...AMMO_TYPES.map((a) => f.ammo[a]),
    ...USE_IDS.map((u) => f.items[u]),
    Math.round(f.boost),
    f.pack,
    f.wood,
    f.stone,
    f.metal,
    f.mat,
    f.dropSeq,
    f.wallSeq,
  ];
}
const KIT_LEN = 6 + 3 + THROW_IDS.length + AMMO_TYPES.length + USE_IDS.length + 8;

/** A kit back, or null for anything no egg could carry. */
export function parseKit(a: unknown): Kit | null {
  if (!Array.isArray(a) || a.length !== KIT_LEN || !a.every((v) => int(v) && v >= 0 && v <= 1e6)) return null;
  const v = a as number[];
  let at = 0;
  const take = () => v[at++];
  const gun = (): Gun | null | undefined => {
    const [w, r, mag] = [take(), take(), take()];
    if (!w) return null;
    return w <= WEAPON_IDS.length && r <= MAX_RARITY && mag <= 1000 ? { w: WEAPON_IDS[w - 1], r, mag } : undefined;
  };
  const guns = [gun(), gun()];
  const [melee, slot, pick] = [take(), take(), take()];
  const counts = <K extends string>(keys: readonly K[], max: number) => {
    const out = {} as Record<K, number>;
    for (const k of keys) out[k] = Math.min(max, take());
    return out;
  };
  const throws = counts(THROW_IDS, 99);
  const ammo = counts(AMMO_TYPES, 999);
  const items = counts(USE_IDS, 99);
  const [boost, pack, wood, stone, metal, mat, dropSeq, wallSeq] = v.slice(at);
  if (guns[0] === undefined || guns[1] === undefined || melee >= MELEE_IDS.length || slot > SLOT_THROW || pick >= THROW_IDS.length || pack > MAX_PACK || mat >= MATS.length) return null;
  return { guns: [guns[0], guns[1]], melee: MELEE_IDS[melee], slot, pick: THROW_IDS[pick], throws, ammo, items, boost: Math.min(BOOST.max, boost), pack, wood: Math.min(MAT_MAX, wood), stone: Math.min(MAT_MAX, stone), metal: Math.min(MAT_MAX, metal), mat, dropSeq, wallSeq };
}

/**
 * Puts what a computer egg carried on it, as the host last said. Its drops and pieces number on a little past the last
 * the host said (some may be on their way still), so none takes an id already used.
 */
export function putKit(f: Fighter, k: Kit) {
  f.guns = [k.guns[0] && { ...k.guns[0] }, k.guns[1] && { ...k.guns[1] }];
  f.melee = k.melee;
  f.slot = k.slot;
  f.pick = k.pick;
  f.throws = { ...k.throws };
  f.ammo = { ...k.ammo };
  f.items = { ...k.items };
  f.boost = k.boost;
  f.pack = k.pack;
  f.wood = k.wood;
  f.stone = k.stone;
  f.metal = k.metal;
  f.mat = k.mat;
  f.dropSeq = Math.max(f.dropSeq, k.dropSeq + 200);
  f.wallSeq = Math.max(f.wallSeq, k.wallSeq + 200);
}

/** The host's word on what some computer eggs carry, for a guest who may be next to run the match. */
export const kitsOf = (round: number, bots: Fighter[]) => ({ t: 'pk', r: round, k: 'K', b: bots.map((f) => [f.id, ...kitOf(f)]) });

/** What the host settles (and every guest keeps a few seconds of, for a new host): see applySettled. */
export const SETTLED: ReadonlySet<NetEv['y']> = new Set(['dr', 'tko', 'opd', 'wg', 'ds', 'fd', 'rvd', 'o', 'lv', 'gl', 'wl', 'we']);

/**
 * A guest's last few seconds of what the host settled (the result too, if it came), for a new host: as much of the
 * newest as fits one packet.
 */
export function logOf(round: number, events: NetEv[], end: { winner: number; places: [number, number, number][] } | null, max = 6000) {
  const e = end ? { e: { w: end.winner, pl: end.places } } : {};
  let size = JSON.stringify(e).length + 40;
  let from = events.length;
  while (from > 0 && from > events.length - 400) {
    const bytes = JSON.stringify(events[from - 1]).length + 1;
    if (size + bytes > max) break;
    size += bytes;
    from--;
  }
  return { t: 'pk', r: round, k: 'L', g: events.slice(from), ...e };
}

/**
 * What a host that has since left settled, as a guest heard it, applied by the new host (see takeOver) as a guest
 * would have, once: whatever it hadn't heard of comes true here too. Only what was the old host's to say counts: a
 * computer egg's drops and outs (everyone else's come from them), pickups (a computer egg keeps what its kit says it
 * carried), chests and crates opened, pieces up and down, doors, called drops, revives, loot moved and glass. True
 * when it was news here, to pass on to everyone.
 */
export function applySettled(m: Match, e: NetEv): boolean {
  const f = 'f' in e && e.f >= 0 ? m.fighters[e.f] : undefined;
  switch (e.y) {
    case 'dr':
      if (m.fighters[e.by]?.seat !== -1 || Math.floor((e.id - DROP_BASE) / 100_000) !== e.by || m.loot.has(e.id) || m.gone.has(e.id)) return false;
      addLoot(m, { id: e.id, def: e.it, x: e.x, z: e.z, by: e.by, at: m.time });
      return true;
    case 'tko':
      if (!f || (m.gone.has(e.id) && !m.loot.has(e.id))) return false;
      applyTook(m, e.f, e.id, e.it, f.kind === 'player');
      return true;
    case 'opd':
      if (!m.map.containers[e.c] || m.opened[e.c]) return false;
      openContainer(m, e.c, e.f, false);
      return true;
    case 'wg':
      if (!m.walls.has(e.id)) return false;
      removeWall(m, e.id, false);
      return true;
    case 'ds':
      if (e.i >= m.doors.length || m.doors[e.i] === e.s) return false;
      setDoor(m, e.i, e.s, e.f, false);
      if (e.s === DOOR_OPENING) m.doorT[e.i] = Math.min(m.doorT[e.i], m.time + VAULT_TIME);
      return true;
    case 'fd':
      return applyCalled(m, e.f, e.c, e.x, e.z, e.at, true);
    case 'rvd':
      return applyRevived(m, e.f, e.by, true);
    case 'o':
      if (!f || f.seat !== -1 || f.phase === 'out' || m.ended) return false;
      applyOut(m, e.f, e.by, e.w);
      return true;
    case 'lv': {
      const l = m.loot.get(e.id);
      if (!l || (l.x === e.x && l.z === e.z)) return false;
      moveLoot(m, e.id, e.x, e.z, false);
      return true;
    }
    case 'gl':
      return breakGlass(m, e.i, e.f, false);
    case 'wl':
      return applyNet(m, e);
    case 'we': {
      const w = m.walls.get(e.id);
      return !!w && w.e !== e.e && applyEdit(m, e.f, e.id, e.e);
    }
    default:
      return false;
  }
}

/**
 * The host's picks for the next match, sent while the room waits so guests can see them: the bots, the mode, and in
 * duos and squads the team each seat is on (-1 for wherever there's room, see teamsFor).
 */
export const configOf = (round: number, bots: Bots, level: Level, mode: Mode = 'solo', picks: number[] = []) => ({ t: 'pk', r: round, k: 'cfg', b: bots, lv: level, ...(mode !== 'solo' ? { md: mode, tp: picks } : {}) });

/** A guest asking the host, while the room waits, to be put on a team (-1 for wherever there's room). */
export const teamAsk = (round: number, team: number) => ({ t: 'pk', r: round, k: 'tm', te: team });

// -------------------------------------------------------------------------------------------------------------------
// Events.

/** The network form of something that happened here, or null when nobody else needs to hear it. */
export function toNet(e: Ev): NetEv | null {
  if (e.net) return null;
  switch (e.t) {
    case 'shot':
      return { y: 's', f: e.f, w: e.w, r: e.r, x: e.x, z: e.z, a: e.a, s: e.s, k: e.k, ...(e.h ? { h: e.h } : {}) };
    case 'swing':
      return { y: 'sw', f: e.f };
    case 'throw':
      return { y: 'th', f: e.f, k: e.k, x: e.x, z: e.z, lx: e.lx, lz: e.lz, ft: e.ft, ...(e.y0 ? { y0: e.y0 } : {}), ...(e.ly ? { ly: e.ly } : {}) };
    case 'hit':
      return e.local ? null : { y: 'd', f: e.f, to: e.to, d: e.d, w: e.w, x: e.x, z: e.z };
    case 'smash':
      return { y: 'm', f: e.f, k: e.kind, id: e.id, d: e.d };
    case 'glass':
      return { y: 'gl', f: e.f, i: e.i };
    case 'latch':
      return { y: 'dq', f: e.f, i: e.i };
    case 'door':
      return { y: 'ds', f: e.f, i: e.i, s: e.s };
    case 'boom':
      return { y: 'b', f: e.f, x: e.x, z: e.z, ...(e.y ? { h: e.y } : {}), ...(e.r === undefined ? {} : { r: e.r }) };
    case 'out':
      return { y: 'o', f: e.f, by: e.by, w: e.w };
    case 'drop':
      return { y: 'dr', id: e.item.id, x: e.item.x, z: e.item.z, by: e.item.by, it: e.item.def };
    case 'take':
      return { y: 'tk', f: e.f, id: e.id };
    case 'took':
      return { y: 'tko', f: e.f, id: e.id, it: e.def };
    case 'open':
      return { y: 'op', f: e.f, c: e.c };
    case 'opened':
      return { y: 'opd', c: e.c, f: e.f };
    case 'wall':
      // a wall put down by hand (in a test) is nowhere on the grid, so nobody else hears of it
      return e.wall.dir >= 0 ? pieceEv(e.wall) : null;
    case 'edit':
      return { y: 'we', f: e.f, id: e.id, e: e.e };
    case 'wallgone':
      return { y: 'wg', id: e.id };
    case 'moved':
      return { y: 'lv', id: e.id, x: e.x, z: e.z };
    case 'called':
      return { y: 'fd', f: e.f, c: e.c, x: e.x, z: e.z, at: e.at };
    case 'knock':
      return { y: 'kn', f: e.f, by: e.by, w: e.w };
    case 'revive':
      return { y: 'rv', f: e.f, to: e.to };
    case 'ask':
      return { y: 'rq', f: e.f, to: e.to };
    case 'revived':
      return { y: 'rvd', f: e.f, by: e.by };
    case 'ping':
      return { y: 'pg', f: e.f, x: e.x, z: e.z };
    case 'emote':
      return { y: 'em', f: e.f, k: EMOTE_IDS.indexOf(e.k), ...(e.a ? { a: AMMO_TYPES.indexOf(e.a) } : {}), ...(e.k === 'enemy' ? { x: e.x, z: e.z } : {}) };
    case 'hop':
      // getting out says where the car is left
      return e.v >= 0 ? { y: 'vq', f: e.f, v: e.v } : { y: 'vq', f: e.f, v: -1, x: e.x, z: e.z, a: e.a };
    case 'seat':
      return { y: 'vs', f: e.f, v: e.v, s: e.s, x: e.x, z: e.z, a: e.a };
    case 'wreck':
      return { y: 'vx', v: e.v, f: e.f, x: e.x, z: e.z, a: e.a };
    default:
      return null;
  }
}

/** The egg an event speaks for, which must belong to the seat that sent it. -1 for events that speak for none. */
export function actorOf(e: NetEv) {
  switch (e.y) {
    case 'dr':
      return e.by;
    case 'opd':
    case 'wg':
    case 'lv':
    case 'fd':
    case 'ds':
    case 'rvd':
    case 'vs':
    case 'vx':
      return -1;
    default:
      return e.f;
  }
}

function parseEv(v: unknown): NetEv | null {
  if (!v || typeof v !== 'object') return null;
  const e = v as Record<string, unknown>;
  switch (e.y) {
    case 's': {
      const h = e.h === undefined ? 0 : e.h;
      return fid(e.f) && isWeapon(e.w) && int(e.r) && onLevel(e.x, e.z, SLACK) && num(e.z) && num(e.a) && int(e.s) && num(e.k) && e.k >= 1 && e.k <= MAX_KICK && int(h) && h >= 0 && h <= MAX_LEVEL
        ? { y: 's', f: e.f, w: e.w, r: Math.max(0, Math.min(4, e.r)), x: e.x, z: e.z, a: e.a, s: e.s, k: e.k, ...(h ? { h } : {}) }
        : null;
    }
    case 'sw':
      return fid(e.f) ? { y: 'sw', f: e.f } : null;
    case 'th':
      return fid(e.f) && isThrow(e.k) && onLevel(e.x, e.z, SLACK) && num(e.z) && onLevel(e.lx, e.lz, SLACK) && num(e.lz) && num(e.ft) && e.ft > 0 && e.ft <= 3 && Math.hypot(e.lx - e.x, e.lz - e.z) <= 25 && height(e.y0) && height(e.ly)
        ? { y: 'th', f: e.f, k: e.k, x: e.x, z: e.z, lx: e.lx, lz: e.lz, ft: e.ft, ...(tossH(e.y0) ? { y0: tossH(e.y0) } : {}), ...(tossH(e.ly) ? { ly: tossH(e.ly) } : {}) }
        : null;
    case 'd':
      return fid(e.f) && fid(e.to) && num(e.d) && isCause(e.w) && e.d > 0 && e.d <= hitCap(e.w) && onLevel(e.x, e.z, SLACK) && num(e.z) ? { y: 'd', f: e.f, to: e.to, d: e.d, w: e.w, x: e.x, z: e.z } : null;
    case 'm':
      return fid(e.f) && (e.k === 'wall' || e.k === 'crate' || e.k === 'door' || e.k === 'car') && id(e.id) && (e.k !== 'car' || ride(e.id)) && num(e.d) && e.d > 0 && e.d <= 1000 ? { y: 'm', f: e.f, k: e.k, id: e.id, d: e.d } : null;
    case 'gl':
      return int(e.f) && e.f >= -1 && e.f < MAX_FIGHTERS && int(e.i) && e.i >= 0 && e.i < MAX_GLASS ? { y: 'gl', f: e.f, i: e.i } : null;
    case 'dq':
      return fid(e.f) && int(e.i) && e.i >= 0 && e.i < MAX_DOORS ? { y: 'dq', f: e.f, i: e.i } : null;
    case 'ds':
      return int(e.f) && e.f >= -1 && e.f < MAX_FIGHTERS && int(e.i) && e.i >= 0 && e.i < MAX_DOORS && DOOR_STATES.includes(e.s as (typeof DOOR_STATES)[number]) ? { y: 'ds', f: e.f, i: e.i, s: e.s as number } : null;
    case 'b':
      if (!fid(e.f) || !onLevel(e.x, e.z, SLACK) || !num(e.z) || !height(e.h)) return null;
      if (e.r !== undefined && !(num(e.r) && e.r > 0 && e.r <= 8)) return null;
      return { y: 'b', f: e.f, x: e.x, z: e.z, ...(tossH(e.h) ? { h: tossH(e.h) } : {}), ...(e.r === undefined ? {} : { r: e.r as number }) };
    case 'o':
      return fid(e.f) && int(e.by) && (e.by === -1 || fid(e.by)) && isCause(e.w) ? { y: 'o', f: e.f, by: e.by, w: e.w } : null;
    case 'dr': {
      const it = parseLoot(e.it);
      return it && id(e.id) && onLevel(e.x, e.z) && fid(e.by) ? { y: 'dr', id: e.id, x: e.x as number, z: e.z as number, by: e.by, it } : null;
    }
    case 'tk':
      return fid(e.f) && id(e.id) ? { y: 'tk', f: e.f, id: e.id } : null;
    case 'tko': {
      const it = parseLoot(e.it);
      return it && fid(e.f) && id(e.id) ? { y: 'tko', f: e.f, id: e.id, it } : null;
    }
    case 'op':
      return fid(e.f) && int(e.c) && e.c >= 0 ? { y: 'op', f: e.f, c: e.c } : null;
    case 'opd':
      return int(e.c) && e.c >= 0 && int(e.f) && e.f >= -1 && e.f < MAX_FIGHTERS ? { y: 'opd', c: e.c, f: e.f } : null;
    case 'wl': {
      const at = unpackPiece(e.p);
      // a piece's id is its builder's (see wallId), so nobody can take the ids another egg's pieces will have
      return at && id(e.id) && fid(e.f) && Math.floor(e.id / 100_000) === e.f && int(e.hp) && e.hp > 0 && e.hp <= MAT_SPECS[at.mat].hp && int(e.t) && e.t >= 0 && e.t <= MAT_SPECS[at.mat].time * 10 + 1 ? { y: 'wl', id: e.id, f: e.f, p: e.p as number, hp: e.hp, t: e.t } : null;
    }
    case 'we':
      return fid(e.f) && id(e.id) && int(e.e) && e.e >= 0 && e.e <= 2 ? { y: 'we', f: e.f, id: e.id, e: e.e } : null;
    case 'wg':
      return id(e.id) ? { y: 'wg', id: e.id } : null;
    case 'lv':
      return id(e.id) && onLevel(e.x, e.z) ? { y: 'lv', id: e.id, x: e.x as number, z: e.z as number } : null;
    case 'fd':
      return fid(e.f) && int(e.c) && e.c >= 0 && e.c < 10_000 && onLand(e.x, e.z) && num(e.at) && e.at >= 0 && e.at <= 3600 ? { y: 'fd', f: e.f, c: e.c, x: e.x as number, z: e.z as number, at: e.at } : null;
    case 'kn':
      return fid(e.f) && int(e.by) && (e.by === -1 || fid(e.by)) && e.by !== e.f && isCause(e.w) ? { y: 'kn', f: e.f, by: e.by, w: e.w } : null;
    case 'rv':
      return fid(e.f) && int(e.to) && (e.to === -1 || fid(e.to)) && e.to !== e.f ? { y: 'rv', f: e.f, to: e.to } : null;
    case 'rq':
      return fid(e.f) && fid(e.to) && e.to !== e.f ? { y: 'rq', f: e.f, to: e.to } : null;
    case 'rvd':
      return fid(e.f) && fid(e.by) && e.by !== e.f ? { y: 'rvd', f: e.f, by: e.by } : null;
    case 'pg':
      return fid(e.f) && onLand(e.x, e.z) ? { y: 'pg', f: e.f, x: e.x as number, z: e.z as number } : null;
    case 'em': {
      // ammo only with an ask for it, and a spot only with an enemy (and always then)
      if (!fid(e.f) || !int(e.k) || e.k < 0 || e.k >= EMOTE_IDS.length) return null;
      const k = EMOTE_IDS[e.k];
      if (e.a !== undefined && !(k === 'ammo' && int(e.a) && e.a >= 0 && e.a < AMMO_TYPES.length)) return null;
      if (k === 'enemy' ? !onLand(e.x, e.z) : e.x !== undefined || e.z !== undefined) return null;
      return { y: 'em', f: e.f, k: e.k, ...(e.a !== undefined ? { a: e.a as number } : {}), ...(k === 'enemy' ? { x: e.x as number, z: e.z as number } : {}) };
    }
    case 'vq':
      // in (a car), or out (with where its car is left, if it drove: all of it or none)
      if (!fid(e.f) || !(e.v === -1 || ride(e.v))) return null;
      if (e.x === undefined && e.z === undefined && e.a === undefined) return { y: 'vq', f: e.f, v: e.v };
      return e.v === -1 && onLand(e.x, e.z) && angle(e.a) ? { y: 'vq', f: e.f, v: -1, x: e.x as number, z: e.z as number, a: e.a } : null;
    case 'vs':
      return fid(e.f) && (e.v === -1 ? e.s === -1 : ride(e.v) && int(e.s) && e.s >= 0 && e.s < MAX_SEATS) && onLand(e.x, e.z) && angle(e.a) ? { y: 'vs', f: e.f, v: e.v as number, s: e.s as number, x: e.x as number, z: e.z as number, a: e.a } : null;
    case 'vx':
      return ride(e.v) && int(e.f) && e.f >= -1 && e.f < MAX_FIGHTERS && onLand(e.x, e.z) && angle(e.a) ? { y: 'vx', v: e.v, f: e.f, x: e.x as number, z: e.z as number, a: e.a } : null;
    default:
      return null;
  }
}

/**
 * Applies an event from another client. The host also settles requests (pickups, chests) here; what it decides comes
 * out as new events of its own. Returns false for an event the receiver should not pass on.
 */
export function applyNet(m: Match, e: NetEv): boolean {
  const f = 'f' in e && e.f >= 0 ? m.fighters[e.f] : undefined;
  switch (e.y) {
    case 's':
      if (!f || owned(f)) return false;
      // a silent shot keeps the shooter hidden here too, as it does on the shooter's own screen
      if (!WEAPONS[e.w].silent) f.firedAt = m.clock;
      fire(m, e.f, e.w, e.r, e.x, e.z, e.a, e.s, e.k, false, e.h ?? 0);
      m.events.push({ t: 'shot', f: e.f, w: e.w, r: e.r, x: e.x, z: e.z, a: e.a, s: e.s, k: e.k, h: e.h ?? 0, net: true });
      // a flare: the host sends a supply drop to where it sees that egg, whatever the shot says
      if (WEAPONS[e.w].call && m.world) callDrop(m, e.f, f.x, f.z);
      return true;
    case 'sw':
      if (!f || owned(f)) return false;
      f.firedAt = m.clock;
      m.events.push({ t: 'swing', f: e.f, net: true });
      return true;
    case 'th':
      if (!f || owned(f)) return false;
      f.firedAt = m.clock;
      launch(m, e.f, e.k, e.x, e.z, e.lx, e.lz, e.ft, false, e.y0 ?? 0, e.ly ?? 0);
      m.events.push({ t: 'throw', f: e.f, k: e.k, x: e.x, z: e.z, lx: e.lx, lz: e.lz, ft: e.ft, y0: e.y0 ?? 0, ly: e.ly ?? 0, net: true });
      return true;
    case 'd': {
      const to = m.fighters[e.to];
      if (to && owned(to)) hurt(m, to, e.d, e.f, e.w, false);
      return true;
    }
    case 'm':
      if (e.k === 'wall') damageWall(m, e.id, e.d, true);
      else if (e.k === 'door') damageDoor(m, e.id, e.d, e.f, true);
      else if (e.k === 'car') {
        // a car's own driver hurting it: it crashed into something (the dust flies here too)
        const c = m.rides[e.id];
        if (c && !c.dead && c.seats[0] === e.f) m.events.push({ t: 'crash', v: e.id, x: c.x, z: c.z, d: CRASH.speed + e.d / CRASH.k, net: true });
        damageRide(m, e.id, e.d, e.f, true);
      } else damageCrate(m, e.id, e.d, e.f, true);
      return true;
    case 'gl':
      // passed on only the first time: glass that is already broken is old news
      return breakGlass(m, e.i, e.f, false);
    case 'dq': {
      // only the host opens and shuts doors, for an egg near the doorway as it sees it; it tells everyone itself
      const s = m.map.slabs[e.i];
      if (m.world && f && s && f.phase === 'ground' && slabGap(s, f.x, f.z) <= DOOR_R + 3) toggleDoor(m, e.i, e.f, f.x, f.z, true);
      return false;
    }
    case 'ds':
      if (!m.world && e.i < m.doors.length) setDoor(m, e.i, e.s, e.f, false);
      return true;
    case 'b':
      m.events.push(e.r === undefined ? { t: 'boom', f: e.f, x: e.x, z: e.z, y: e.h ?? 0, net: true } : { t: 'boom', f: e.f, x: e.x, z: e.z, y: e.h ?? 0, r: e.r, net: true });
      return true;
    case 'o':
      if (!f || owned(f)) return false;
      applyOut(m, e.f, e.by, e.w);
      return true;
    case 'dr':
      addLoot(m, { id: e.id, def: e.it, x: e.x, z: e.z, by: e.by, at: m.time });
      return true;
    case 'tk':
      // only the host hands out pickups; what it decides goes out as its own 'took'
      if (m.world) grantTake(m, e.f, e.id, true);
      return false;
    case 'tko':
      if (!m.world) applyTook(m, e.f, e.id, e.it);
      return true;
    case 'op': {
      // a chest, a fridge or a locker and the like, or a supply drop that has landed (give or take the second a guest's
      // clock may be ahead)
      const c = m.map.containers[e.c];
      if (m.world && c && opens(c.kind) && (c.kind !== 'supply' || m.time >= c.at - 1)) openContainer(m, e.c, e.f, true);
      return false;
    }
    case 'opd':
      if (!m.world && m.map.containers[e.c]) openContainer(m, e.c, e.f, false);
      return true;
    case 'wl': {
      // a piece already here (a packet heard twice) isn't news, nor one the host turns down for standing where another does
      const at = unpackPiece(e.p);
      return !!at && addWall(m, makePiece(e.id, e.f, at.k, at.mat, at.cx, at.cz, at.lv, at.dir, e.hp, e.t / 10, at.e));
    }
    case 'we':
      return applyEdit(m, e.f, e.id, e.e);
    case 'wg':
      if (!m.world) removeWall(m, e.id, false);
      return true;
    case 'lv':
      if (!m.world) moveLoot(m, e.id, e.x, e.z, false);
      return true;
    case 'fd':
      if (!m.world) applyCalled(m, e.f, e.c, e.x, e.z, e.at);
      return true;
    case 'kn':
      return applyKnock(m, e.f, e.by, e.w);
    case 'rv':
      return applyRevive(m, e.f, e.to);
    case 'rq':
      // only the host stands an egg up; it tells everyone itself
      if (m.world) reviveEgg(m, e.to, e.f, true);
      return false;
    case 'rvd':
      if (!m.world) applyRevived(m, e.f, e.by);
      return true;
    case 'pg':
      return applyPing(m, e.f, e.x, e.z);
    case 'em':
      return applyEmote(m, e.f, EMOTE_IDS[e.k], e.a === undefined ? null : AMMO_TYPES[e.a], e.x ?? 0, e.z ?? 0);
    case 'vq':
      // only the host says who sits where (a guest's egg it sees a moment late, so a little farther off); it tells
      // everyone itself
      if (m.world && f && !owned(f)) {
        if (e.v >= 0) seatEgg(m, e.f, e.v, 3);
        else freeSeat(m, e.f, e.x, e.z, e.a);
      }
      return false;
    case 'vs':
      if (!m.world) applySeat(m, e.f, e.v, e.s, e.x, e.z, e.a);
      return true;
    case 'vx':
      if (!m.world) wreckRide(m, e.v, e.f, false, e.x, e.z, e.a);
      return true;
  }
}

/** Splits events into packets that each stay well under the room's 8 KB message limit. */
export function packEvents(round: number, queue: [number, NetEv][], max = 6000): object[] {
  const packets: object[] = [];
  let groups: Group[] = [];
  let size = 40;
  const flush = () => {
    if (groups.length) packets.push({ t: 'pk', r: round, k: 'e', g: groups });
    groups = [];
    size = 40;
  };
  for (const [origin, ev] of queue) {
    const bytes = JSON.stringify(ev).length + 1;
    const last = groups[groups.length - 1];
    const extra = last && last[0] === origin ? bytes : bytes + 12;
    if (size + extra > max && groups.length) flush();
    const tail = groups[groups.length - 1];
    if (tail && tail[0] === origin) tail[1].push(ev);
    else groups.push([origin, [ev]]);
    size += tail && tail[0] === origin ? bytes : bytes + 12;
  }
  flush();
  return packets;
}

// -------------------------------------------------------------------------------------------------------------------
// Reading packets.

/** Reads a Scramble packet from the room, or null for anything else. */
export function parsePacket(value: unknown): Packet | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as Record<string, unknown>;
  if (p.t !== 'pk' || !Number.isSafeInteger(p.r)) return null;
  const round = p.r as number;
  if (p.k === 's') {
    const state = unpackState(p.c);
    if (!state || (p.v !== undefined && !fid(p.v)) || (p.n !== undefined && !(Number.isSafeInteger(p.n) && (p.n as number) >= 0))) return null;
    return { k: 's', round, state, watch: p.v === undefined ? -1 : (p.v as number), ...(p.n !== undefined ? { seq: p.n as number } : {}) };
  }
  if (p.k === 'S') {
    if (!int(p.sd) || !num(p.tm) || !isLevel(p.lv) || !Array.isArray(p.c) || (p.ro !== undefined && !Array.isArray(p.ro))) return null;
    const glass = p.gl === undefined ? null : unpackGlass(p.gl);
    if (p.gl !== undefined && !glass) return null;
    // a reliable report with no doors listed has them all shut
    const doors = p.dz === undefined ? (p.ro !== undefined ? [] : null) : unpackDoors(p.dz);
    if (p.dz !== undefined && !doors) return null;
    let roster: number[] | null = null;
    let teams: number[] | null = null;
    const mode: Mode = p.md === undefined ? 'solo' : isMode(p.md) ? p.md : 'solo';
    if (p.md !== undefined && (!isMode(p.md) || p.md === 'solo' || !Array.isArray(p.ro))) return null;
    if (Array.isArray(p.ro)) {
      if (p.ro.length < 1 || p.ro.length > MAX_FIGHTERS || !p.ro.every(seat)) return null;
      roster = p.ro as number[];
      const humans = roster.filter((s) => s >= 0);
      if (new Set(humans).size !== humans.length) return null;
      if (mode !== 'solo' && !(teams = parseTeams(p.te, mode, roster.length))) return null;
    }
    const states: [number, State][] = [];
    for (const raw of p.c.slice(0, MAX_FIGHTERS)) {
      if (!Array.isArray(raw) || !fid(raw[0]) || (roster && raw[0] >= roster.length)) continue;
      const s = unpackState(raw.slice(1));
      if (s) states.push([raw[0], s]);
    }
    // a reliable report with no cars listed has them all as they started
    const rides = p.vh === undefined ? (p.ro !== undefined ? [] : null) : parseRides(p.vh);
    if (p.vh !== undefined && !rides) return null;
    if (p.ho !== undefined && !(int(p.ho) && p.ho >= 0 && p.ho < MAX_HANDOFFS)) return null;
    return { k: 'S', round, seed: p.sd, time: p.tm, level: p.lv, roster, states, glass, doors, mode, teams, rides, handoffs: (p.ho as number | undefined) ?? 0 };
  }
  if (p.k === 'K') {
    if (!Array.isArray(p.b)) return null;
    const kits: [number, Kit][] = [];
    for (const raw of p.b.slice(0, MAX_FIGHTERS)) {
      const kit = Array.isArray(raw) && fid(raw[0]) ? parseKit(raw.slice(1)) : null;
      if (kit) kits.push([raw[0], kit]);
    }
    return { k: 'K', round, kits };
  }
  if (p.k === 'L') {
    if (!Array.isArray(p.g)) return null;
    const events = p.g.slice(0, 400).map(parseEv).filter((e): e is NetEv => !!e && SETTLED.has(e.y));
    const end = p.e && typeof p.e === 'object' ? parsePacket({ ...p.e, t: 'pk', r: round, k: 'end' }) : null;
    if (p.e !== undefined && end?.k !== 'end') return null;
    return { k: 'L', round, events, end: end?.k === 'end' ? { winner: end.winner, places: end.places } : null };
  }
  if (p.k === 'e') {
    if (!Array.isArray(p.g)) return null;
    const groups: Group[] = [];
    let count = 0;
    for (const raw of p.g) {
      if (!Array.isArray(raw) || !int(raw[0]) || raw[0] < 0 || raw[0] >= SEATS || !Array.isArray(raw[1])) continue;
      const evs: NetEv[] = [];
      for (const ev of raw[1]) {
        if (++count > 400) break;
        const parsed = parseEv(ev);
        if (parsed) evs.push(parsed);
      }
      if (evs.length) groups.push([raw[0], evs]);
    }
    return { k: 'e', round, groups };
  }
  if (p.k === 'end') {
    if (!int(p.w) || p.w < -1 || p.w >= MAX_FIGHTERS || !Array.isArray(p.pl)) return null;
    const places = p.pl.filter((o): o is [number, number, number] => Array.isArray(o) && fid(o[0]) && int(o[1]) && o[1] >= 1 && o[1] <= MAX_FIGHTERS && int(o[2]) && o[2] >= 0).slice(0, MAX_FIGHTERS);
    return { k: 'end', round, winner: p.w, places };
  }
  if (p.k === 'cfg') {
    if (!isBots(p.b) || !isLevel(p.lv) || (p.md !== undefined && !isMode(p.md))) return null;
    const mode: Mode = isMode(p.md) ? p.md : 'solo';
    if (p.tp !== undefined && !(Array.isArray(p.tp) && p.tp.length <= SEATS && p.tp.every((t) => int(t) && t >= -1 && t < MAX_TEAMS))) return null;
    return { k: 'cfg', round, bots: p.b, level: p.lv, mode, picks: mode === 'solo' ? [] : ((p.tp as number[] | undefined) ?? []) };
  }
  if (p.k === 'tm') return int(p.te) && p.te >= -1 && p.te < MAX_TEAMS ? { k: 'tm', round, team: p.te } : null;
  return null;
}

/**
 * Final places by fighter: the winner (in duos and squads, the winning team) first, then everyone else by when they
 * (their team) went out.
 */
export function placesOf(m: Match): [number, number, number][] {
  return m.fighters
    .map((f): [number, number, number] => [f.id, f.place || 1, f.kills])
    .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}
