// One client's side of an online Scramble match: what it does with each message from the room, what it sends on its
// regular tick, the events it queues and flushes, and when the match is over. Pure, so a whole room can be simulated
// in a test; index.tsx connects it to the real room.
import { WEAPONS, isMelee, isWeapon } from './items.ts';
import { DOOR_OPENING, FALL, FIGHTER_COLORS, MAX_FIGHTERS, MAX_TEAMS, TEAM_SIZE, VAULT_TIME, adoptBots, aliveCount, applyOut, applyState, botNames, createMatch, endMatch, forfeit, grantTake, ordinal, owned, step, teamCount, teamsLeft, viewAt, type Entrant, type Ev, type Fighter, type Level, type Match, type Mode } from './logic.ts';
import { BUS_Y, DROP_BASE, stormEnd } from './map.ts';
import { LEFT, SETTLED, actorOf, applyNet, applySettled, endOf, guestState, hostState, kitsOf, logOf, packEvents, parsePacket, pieceEv, placesOf, putKit, stateKey, stateOf, toNet, type Kit, type NetEv, type Packet, type State } from './net.ts';

/** How often queued events go out. State goes out on its own tick, about 15 times a second. */
export const FLUSH = 0.05;
export const TICK_MS = 66;
/** The host's last word: everyone sees the result this long after the last egg is left standing. */
export const END_PAUSE = 2.2;
/** Seconds without a report from a guest before the host takes its egg out (a closed laptop, a frozen tab). */
export const STALE = 15;
/**
 * Extra seconds a guest gets for its first report: a slow phone can take a while to build the island before it starts
 * sending (and one that never does is still put off the bus with everyone else).
 */
export const FIRST_GRACE = 30;
/**
 * Seconds past the bus leaving land by which every egg is down, and seconds after any glide began (from the bus or a
 * bounce pad) by which it has landed; one still in the air has stopped playing.
 */
const DOWN_BY = 4 + BUS_Y / FALL + 4;

/**
 * How far (along x and along z) from the egg a guest watches (its own, or the one it watches once its own is out) the
 * host reports each egg whenever it has changed: farther than anyone sees on the ground without a scope, and gliding
 * down, and at least as far as its screen may reach (see reachOf). Everything else, and eggs still on the bus, goes
 * every FAR_EVERY ticks; eggs that are out every OUT_EVERY (a guest takes one out on its own a moment after the news
 * of how never comes).
 */
export const NEAR = 100;
export const NEAR_GLIDE = 130;
/**
 * How far to the side a guest's screen may reach from the egg it follows: about three times what it shows up and down
 * on the widest screen (2.2 to 1), with room to spare, so no egg it can see moves in jerks of FAR_EVERY ticks.
 */
export const reachOf = (f: Fighter) => Math.max(f.phase === 'ground' ? NEAR : NEAR_GLIDE, viewAt(f) * 3 + 10);
export const FAR_EVERY = 6;
export const OUT_EVERY = 15;

/**
 * Taking the match over from a host that left (see takeOver). The host tells this many of the guests likeliest to be
 * next (the lowest seats playing, as the room picks) what KITS computer eggs carry with each reliable report, round and
 * round. Every guest keeps LOG_T seconds of what the host settled, for the next host. A new host holds pickups for
 * HOLD_TAKES seconds at most, until its guests have said what they saw the old one settle, so nothing is handed out
 * twice. A guest whose new host says nothing for HOST_GONE seconds (it couldn't take the match over) stops waiting.
 */
export const HEIRS = 3;
export const KITS = 6;
export const LOG_T = 2.5;
const LOG_MAX = 200;
export const HOLD_TAKES = 1.5;
export const HOST_GONE = 15;
/** A guest's own asks the old host may not have answered, from this many seconds back, go again to the new host. */
const REASK = 1.5;
/** A guest whose first report comes before this many of its ticks has only just synced, and hears what has been built. */
const FRESH_TICKS = 45;
/** What a client asks the host for: pickups, chests, doors and revives. */
const ASKS: ReadonlySet<NetEv['y']> = new Set(['tk', 'op', 'dq', 'rq']);

/** Who this client is in the room. */
export type Me = { seat: number; isHost: boolean; round: number };
export type Player = { seat: number; name: string };

const nameOf = (players: Player[], seat: number) => players.find((p) => p.seat === seat)?.name ?? `Player ${seat + 1}`;

/**
 * The teams of an online match in duos or squads, for `seats` (the people, in seat order) and then `bots` computer
 * eggs: each person on the team they picked (`picks`, by seat: -1 or nothing for wherever there's room) while it has
 * room, everyone else in seat order on the first team with room (so friends fill teams together), then the computer
 * eggs, on the teams people are on first. Teams are numbered from 0 in order. Each entrant's team, people first.
 */
export function teamsFor(mode: Mode, seats: number[], picks: readonly number[], bots: number): number[] {
  const size = TEAM_SIZE[mode];
  const n = seats.length + bots;
  if (size <= 1) return Array.from({ length: n }, (_, i) => i);
  const count: number[] = [];
  const out: number[] = [];
  const put = (i: number, t: number) => {
    out[i] = t;
    count[t] = (count[t] ?? 0) + 1;
  };
  const room = (t: number) => (count[t] ?? 0) < size;
  seats.forEach((seat, i) => {
    const t = picks[seat] ?? -1;
    if (Number.isInteger(t) && t >= 0 && t < MAX_TEAMS && room(t)) put(i, t);
  });
  seats.forEach((_, i) => {
    if (out[i] !== undefined) return;
    let t = 0;
    while (!room(t)) t++;
    put(i, t);
  });
  const withPeople = [...new Set(out)].sort((a, b) => a - b);
  for (let b = seats.length; b < n; b++) {
    let t = withPeople.find(room) ?? 0;
    while (t < 0 || !room(t)) t++;
    put(b, t);
  }
  // numbered 0, 1, 2 and so on, in order
  const order = [...new Set(out)].sort((a, b) => a - b);
  return out.map((t) => order.indexOf(t));
}

/**
 * Where the room's team list moves person `i` next (`teams` as teamsFor numbers them): onto the next team of someone
 * else's with room, or a team of their own, round and round.
 */
export function nextTeam(mode: Mode, teams: number[], i: number): number {
  const size = TEAM_SIZE[mode];
  const others = teams.filter((_, k) => k !== i);
  const open = [...new Set(others)].filter((t) => others.filter((o) => o === t).length < size);
  // on their own already, or a new team at the end (while the island has room for one)
  const alone = !others.includes(teams[i]) ? teams[i] : new Set(teams).size < Math.ceil(MAX_FIGHTERS / size) ? Math.max(...teams) + 1 : -1;
  const ways = [...new Set([...open, ...(alone >= 0 ? [alone] : [])])].sort((a, b) => a - b);
  return ways.find((t) => t > teams[i]) ?? ways[0] ?? teams[i];
}

/**
 * The room's picks (by seat) once `seat` moves to `team`: everyone else stays on the team they're on now (so nobody
 * shuffles along to make room).
 */
export function pinTeam(mode: Mode, seats: number[], picks: readonly number[], seat: number, team: number): number[] {
  const now = teamsFor(mode, seats, picks, 0);
  const all: number[] = [];
  seats.forEach((s, k) => (all[s] = now[k]));
  all[seat] = team;
  return all;
}

/**
 * The host's match: everyone in the room by seat, then as many computer eggs as the host asks for (fifty eggs at most),
 * in duos and squads on the teams teamsFor gives them. `roster` is each fighter's seat (-1 for a computer egg) and
 * `teams` its team, which the host sends with every reliable state.
 */
export function hostMatch(players: Player[], mySeat: number, seed: number, level: Level, bots: number, countdown: number, mode: Mode = 'solo', picks: readonly number[] = []): { match: Match; roster: number[]; teams: number[] } {
  const seats = players.map((p) => p.seat).sort((a, b) => a - b).slice(0, MAX_FIGHTERS);
  const names = botNames(seed);
  const entrants: Entrant[] = seats.map((seat, i) => ({ name: nameOf(players, seat), color: FIGHTER_COLORS[i], kind: seat === mySeat ? 'player' : 'remote', seat }));
  for (let b = 0; b < bots && entrants.length < MAX_FIGHTERS; b++) entrants.push({ name: names[b], color: FIGHTER_COLORS[entrants.length], kind: 'bot', seat: -1 });
  const teams = teamsFor(mode, seats, picks, entrants.length - seats.length);
  entrants.forEach((e, i) => (e.team = teams[i]));
  const match = createMatch({ seed, role: 'host', level, entrants, me: entrants.findIndex((e) => e.seat === mySeat), countdown, mode });
  return { match, roster: entrants.map((e) => e.seat), teams: match.fighters.map((f) => f.team) };
}

/**
 * How many computer eggs the host asks hostMatch for: in a quick-play match always enough to fill the island (people
 * take seats from the room's bots, so a full room has none left), otherwise the room's, and with any of them more to
 * fill it when the host picked that. The level a quick-play match plays at is always normal.
 */
export const hostBots = (quick: boolean, roomBots: number, fill: boolean) => (quick || (roomBots > 0 && fill) ? MAX_FIGHTERS : roomBots);
export const QUICK_LEVEL: Level = 'normal';

/** A guest's match, laid out from the host's first state: the same eggs, names, colors and teams, ours to play. */
export function guestMatch(players: Player[], mySeat: number, seed: number, level: Level, time: number, roster: number[], mode: Mode = 'solo', teams: number[] | null = null): Match {
  const names = botNames(seed);
  let b = 0;
  // (someone who has left by the time we sync is nobody we know)
  const entrants: Entrant[] = roster.map((seat, i) => ({
    name: seat === -1 ? names[b++] : seat === LEFT ? 'Someone' : nameOf(players, seat),
    color: FIGHTER_COLORS[i],
    kind: seat === mySeat ? 'player' : 'remote',
    seat,
    ...(teams ? { team: teams[i] } : {}),
  }));
  return createMatch({ seed, role: 'guest', level, entrants, me: roster.indexOf(mySeat), countdown: -time, mode: teams ? mode : 'solo' });
}

export type Session = {
  /** A guest is synced once the host's first state has built its match; the host always is. */
  synced: boolean;
  /** Room seat by fighter id (-1 for a computer egg), as the host laid out the match. */
  roster: number[];
  /** The host's copy of each guest's last report, passed on to everyone. */
  states: Map<number, State>;
  /** Events waiting to go out, each with the seat it came from, in the order they were applied. */
  queue: [number, NetEv][];
  flushT: number;
  ticks: number;
  end: { winner: number; places: [number, number, number][] } | null;
  endAt: number;
  endSends: number;
  reported: boolean;
  /** The result card is up. */
  over: boolean;
  /**
   * The card went up before the end (out, and done watching): the match goes on for everyone else, and this client
   * keeps the card up to date until it has the result. A host keeps running the match from its timer meanwhile.
   */
  early: boolean;
  /** The host's view of the room: seats that have left (for good, even if someone new sits there) and when each guest last reported. */
  left: Set<number>;
  heard: Map<number, number>;
  firstTick: number;
  /** The host's clock at its last tick: a host that froze (a phone off in another app) doesn't blame guests for the quiet. */
  lastTick: number;
  /** The egg this client watches once its own is out (-1 for its own); the host's record of each guest's, by egg. */
  watch: number;
  watching: Map<number, number>;
  /** The host's record of the state it last sent each guest for each egg (packed), by seat. */
  sent: Map<number, (string | undefined)[]>;
  /** Seats the host has just heard from for the first time: they hear what has been built so far. */
  fresh: Set<number>;
  /**
   * When each egg's last report was made, by egg: on the host a guest's count of its ticks, on a guest the host's
   * match time. Reports go on a channel that keeps no order, so one older than this has been overtaken and is let go
   * (it would put the egg back where it was, back up in the air or back on the other level for a moment). `newest` is
   * the host's time in the newest report a guest has had.
   */
  stamps: Map<number, number>;
  newest: number;
  /** This client runs the match: the host it started on, or one it took over when the host left (see takeOver). */
  host: boolean;
  /**
   * Host hand-offs the match has had that this client has followed (the roster is in the room's seats since the last),
   * and on a guest, the hand-offs the newest host report counted: one more means a new host, on a clock of its own.
   */
  handoffs: number;
  heardHandoffs: number;
  /** A guest's: wall time of the newest report from the host (-1 before any) and of the last hand-off it followed. */
  heardAt: number;
  handAt: number;
  /** A guest's: what each computer egg carries, as the host last said (to the guests likeliest to be next). */
  kits: Map<number, Kit>;
  /** A guest's: the last LOG_T seconds of what the host settled, with when (wall time), for a new host. */
  log: [number, NetEv][];
  /**
   * A host's: wall time it took the match over (-1 for the host it started on), and the seats whose logs it has; a
   * guest's: logs from the others that came before it took over (the room had made it the host a moment before).
   */
  tookAt: number;
  logs: Set<number>;
  heldLogs: [number, Extract<Packet, { k: 'L' }>][];
  /** A host's: seats it has had a report from, the next computer egg whose kit goes out, and a report owed to everyone of every egg. */
  told: Set<number>;
  kitAt: number;
  full: boolean;
};

/** How far back (ticks on the host, seconds on a guest) a report counts as overtaken; anything older is a fresh start. */
const OVERTAKEN = { ticks: 60, time: 4 };
/** Whether a report stamped `at` is older than the last one (`last`) from the same place. */
const overtaken = (at: number, last: number | undefined, window: number) => last !== undefined && at < last && last - at < window;

export function newSession(synced: boolean, roster: number[] = [], host = synced): Session {
  return {
    synced,
    roster: [...roster],
    states: new Map(),
    queue: [],
    flushT: 0,
    ticks: 0,
    end: null,
    endAt: -1,
    endSends: 0,
    reported: false,
    over: false,
    early: false,
    left: new Set(),
    heard: new Map(),
    firstTick: -1,
    lastTick: -1,
    watch: -1,
    watching: new Map(),
    sent: new Map(),
    fresh: new Set(),
    stamps: new Map(),
    newest: -Infinity,
    host,
    handoffs: 0,
    heardHandoffs: 0,
    heardAt: -1,
    handAt: -1,
    kits: new Map(),
    log: [],
    tookAt: -1,
    logs: new Set(),
    heldLogs: [],
    told: new Set(),
    kitAt: 0,
    full: false,
  };
}

/** Builds a guest's match from the host's first state. */
export type Join = (seed: number, level: Level, time: number, roster: number[], mode: Mode, teams: number[] | null) => Match;

/**
 * Applies one message from the room. Returns the match to carry on with: a new one when a guest has just synced.
 * `clock` is wall time in seconds (it keeps going in a hidden tab), for timing the end and noticing silent guests.
 */
export function receive(s: Session, m: Match, me: Me, from: number, d: unknown, join: Join, clock: number): Match {
  const p = parsePacket(d);
  if (!p || p.round !== me.round) return m;
  if (p.k === 's') {
    if (!me.isHost) return m;
    const fid = s.roster.indexOf(from);
    const f = m.fighters[fid];
    if (!f || f.seat !== from || f.kind !== 'remote') return m;
    if (p.seq !== undefined) {
      if (p.seq === s.stamps.get(fid) || overtaken(p.seq, s.stamps.get(fid), OVERTAKEN.ticks)) return m;
      s.stamps.set(fid, p.seq);
    }
    // its first report to us, when it has only just synced: it may have missed pieces built before it was ready
    if (!s.told.has(from)) {
      s.told.add(from);
      if ((p.seq ?? 0) < FRESH_TICKS) s.fresh.add(from);
    }
    s.states.set(fid, p.state);
    s.heard.set(fid, clock);
    s.watching.set(fid, p.watch);
    applyState(m, f, p.state);
  } else if (p.k === 'S') {
    if (me.isHost || from !== 0) return m;
    if (!s.synced) {
      if (!p.roster || !p.roster.includes(me.seat)) return m;
      m = join(p.seed, p.level, p.time, p.roster, p.mode, p.teams);
      s.roster = [...p.roster];
      s.synced = true;
      s.handoffs = p.handoffs;
    }
    s.heardAt = clock;
    // a new host: its clock is its own, so nothing it says has been overtaken by what the last one said
    if (p.handoffs !== s.heardHandoffs) {
      s.heardHandoffs = p.handoffs;
      s.newest = -Infinity;
      s.stamps.clear();
    }
    // the eggs of people who have left the match are nobody's (in the room's seats as we have them)
    if (p.roster && p.handoffs === s.handoffs && p.roster.length === s.roster.length)
      for (let i = 0; i < p.roster.length; i++)
        if (p.roster[i] === LEFT && s.roster[i] !== LEFT) {
          s.roster[i] = LEFT;
          if (m.fighters[i]) m.fighters[i].seat = LEFT;
        }
    // keep our clock on the host's: the storm and the bus run on it (by the newest report, not one overtaken)
    const late = overtaken(p.time, s.newest, OVERTAKEN.time);
    if (!late) {
      s.newest = p.time;
      const diff = p.time - m.time;
      if (Math.abs(diff) > 1) m.time = p.time;
      else m.time += diff * 0.1;
    }
    for (const [fid, st] of p.states) {
      const f = m.fighters[fid];
      if (!f || f.kind !== 'remote' || overtaken(p.time, s.stamps.get(fid), OVERTAKEN.time)) continue;
      s.stamps.set(fid, p.time);
      // (kept, for passing on should we end up running the match)
      s.states.set(fid, st);
      applyState(m, f, st);
    }
    // the windows the host has broken: quietly, since any news of them has come and gone
    for (const i of p.glass ?? []) if (i < m.broken.length) m.broken[i] = true;
    // and its doors, all of them (shut past the end of the list), but not one whose news came in just now: this
    // report may have set out before it
    if (p.doors && !late)
      for (let i = 0; i < m.doors.length; i++) {
        const st = p.doors[i] ?? 0;
        if (m.doors[i] !== st && m.clock - m.doorAt[i] > 1) m.doors[i] = st;
      }
  } else if (p.k === 'e') {
    if (!s.synced || (!me.isHost && from !== 0)) return m;
    for (const [origin, evs] of p.groups) {
      if (origin === me.seat) continue;
      // the host only takes a guest's own events, about the egg that guest plays
      if (me.isHost && origin !== from) continue;
      for (const ev of evs) {
        if (me.isHost) {
          const actor = actorOf(ev);
          const f = m.fighters[actor];
          if (actor < 0 || f?.seat !== from) continue;
          // an egg we took out for leaving or going quiet plays no more, whatever its owner still sends
          if (f.phase === 'out' && f.outCause === 'left') continue;
        } else if (origin === 0 && ev.y === 'o' && ev.f === m.me && ev.w === 'left') {
          // the host has taken our egg out (we went quiet, or never landed): it is out here too
          applyOut(m, m.me, -1, 'left');
        }
        if (!applyNet(m, ev)) continue;
        if (me.isHost) s.queue.push([from, ev]);
        else if (SETTLED.has(ev.y)) keep(s, ev, clock);
      }
    }
  } else if (p.k === 'end') {
    if (me.isHost || from !== 0 || s.end || !s.synced) return m;
    endMatch(m, p.winner, p.places);
    s.end = { winner: p.winner, places: p.places };
    s.endAt = clock;
  } else if (p.k === 'K') {
    // what the computer eggs carry, for the guests likeliest to run the match next
    if (me.isHost || from !== 0 || !s.synced) return m;
    for (const [fid, kit] of p.kits) if (m.fighters[fid]?.seat === -1) s.kits.set(fid, kit);
  } else if (p.k === 'L') {
    // a guest's word on what the host before us settled (one that comes just before we take over waits for it)
    if (s.host) heardLog(s, m, me, from, p, clock);
    else if (from !== 0 && s.synced && s.heldLogs.length < MAX_FIGHTERS) s.heldLogs.push([from, p]);
  }
  return m;
}

/** A guest's word on what the host before us settled: once from each, while we still wait to hear it. */
function heardLog(s: Session, m: Match, me: Me, from: number, p: Extract<Packet, { k: 'L' }>, clock: number) {
  if (s.tookAt < 0 || clock - s.tookAt > LOG_T * 2 || from === me.seat || s.logs.has(from) || !s.roster.includes(from)) return;
  s.logs.add(from);
  if (p.end && !s.end && !m.ended) {
    endMatch(m, p.end.winner, p.end.places);
    s.end = p.end;
    s.endAt = clock;
    s.endSends = 0;
  }
  for (const ev of p.events) if (applySettled(m, ev)) s.queue.push([me.seat, ev]);
}

/** Keeps something the host settled for a few seconds (see LOG_T), in case it leaves and someone here runs the match next. */
function keep(s: Session, ev: NetEv, clock: number) {
  s.log.push([clock, ev]);
  let drop = 0;
  while (drop < s.log.length && (s.log[drop][0] < clock - LOG_T || s.log.length - drop > LOG_MAX)) drop++;
  if (drop) s.log.splice(0, drop);
}

/**
 * What goes out on the regular tick: a guest's own egg, or from the host everyone's (and the result once there is
 * one). The host also takes out the eggs of people who have left (`present` is the seats in the room now) or who
 * have stopped playing: gone quiet, or still up in the air long after everyone else has landed. `clock` is wall time.
 */
export function tick(s: Session, m: Match, me: Me, present: number[], clock: number): { d: object; fast: boolean; to?: number }[] {
  if (!s.synced) return [];
  s.ticks++;
  // most go on the fast channel, which may drop one; every fifth on the reliable one
  const fast = s.ticks % 5 !== 0;
  if (!me.isHost) {
    const f = m.fighters[m.me];
    return f ? [{ d: guestState(me.round, stateOf(f), f.phase === 'out' ? s.watch : -1, s.ticks), fast }] : [];
  }
  if (s.firstTick < 0) s.firstTick = clock;
  // the host itself was frozen a while: what it hadn't read of the guests' reports while it was counts as heard
  const away = s.lastTick < 0 ? 0 : clock - s.lastTick - 1;
  if (away > 0) {
    for (const [id, at] of s.heard) s.heard.set(id, Math.min(clock, at + away));
    s.firstTick = Math.min(clock, s.firstTick + away);
  }
  s.lastTick = clock;
  for (const seat of s.roster) if (seat >= 0 && !present.includes(seat)) s.left.add(seat);
  for (const f of m.fighters) {
    // someone who has left: their egg is nobody's from now on (in the roster everyone hears, so whoever takes their
    // seat sits the match out) and out, the old host's too after a hand-off
    if (f.seat >= 0 && s.left.has(f.seat)) s.roster[f.id] = f.seat = LEFT;
    if (f.seat === LEFT) {
      if (f.phase !== 'out' && !m.ended) forfeit(m, f.id);
      continue;
    }
    if (f.seat < 0 || f.kind !== 'remote' || f.phase === 'out' || m.ended) continue;
    const quiet = clock - (s.heard.get(f.id) ?? s.firstTick + FIRST_GRACE) > STALE;
    const aloft = f.phase === 'bus' ? m.time > m.map.bus.off + DOWN_BY : f.phase === 'drop' && m.time > Math.max(f.dropAt, m.map.bus.off) + DOWN_BY;
    if (quiet || aloft) forfeit(m, f.id);
  }
  // pickups held since taking over go to whoever asked first, once every guest has said what it saw settled
  if (m.held && (clock - s.tookAt > HOLD_TAKES || present.every((seat) => seat === me.seat || s.logs.has(seat) || !s.roster.includes(seat)))) {
    const held = m.held;
    m.held = null;
    for (const [fid, id] of held) grantTake(m, fid, id, true);
  }
  // (an egg out that its owner never got to say so of, having left, is out in what everyone hears)
  const states: (State | undefined)[] = m.fighters.map((f) => (owned(f) ? stateOf(f) : outOf(f, s.states.get(f.id))));
  const teams = m.mode === 'solo' ? [] : m.fighters.map((f) => f.team);
  const keys = states.map((st) => (st ? stateKey(st) : undefined));
  // each guest its own report (every reliable one with the roster); someone in the room but not in this match only
  // hears the roster, to know to sit it out. Just after taking over, everyone hears of every egg.
  const out: { d: object; fast: boolean; to?: number }[] = [];
  const all = s.full && !fast;
  for (const seat of present) {
    if (seat === me.seat) continue;
    const g = m.fighters[s.roster.indexOf(seat)];
    if (!g && fast) continue;
    let sent = s.sent.get(seat);
    if (!sent) s.sent.set(seat, (sent = []));
    const list = g ? statesFor(m, g, states, keys, sent, s.ticks, s.watching.get(g.id) ?? -1, all) : [];
    out.push({ d: hostState(me.round, m.seed, m.time, m.level, fast ? null : s.roster, list, m.broken, m.doors, m.mode, teams, s.handoffs), fast, to: seat });
  }
  if (all) s.full = false;
  // what the computer eggs carry, a few at a time, for the guests likeliest to run the match should we leave
  if (!fast) {
    const heirs = present.filter((seat) => seat !== me.seat && s.roster.includes(seat)).sort((a, b) => a - b).slice(0, HEIRS);
    const bots = m.fighters.filter((f) => f.seat === -1 && f.kind === 'bot' && f.phase !== 'out');
    if (heirs.length && bots.length) {
      const from = s.kitAt % bots.length;
      const some = [...bots.slice(from, from + KITS), ...bots.slice(0, Math.max(0, from + KITS - bots.length))].slice(0, KITS);
      s.kitAt = from + KITS;
      for (const seat of heirs) out.push({ d: kitsOf(me.round, some), fast: false, to: seat });
    }
  }
  // a guest that has only now started reporting may have missed pieces built before it was ready: here they all are
  for (const seat of s.fresh) if (present.includes(seat) && m.walls.size) for (const d of packEvents(me.round, [...m.walls.values()].filter((w) => w.dir >= 0).map((w): [number, NetEv] => [me.seat, pieceEv(w)]))) out.push({ d, fast: false, to: seat });
  s.fresh.clear();
  if (s.end && s.endSends < 4) {
    s.endSends++;
    // whatever happened last (the final crack) goes out ahead of the result
    for (const d of packEvents(me.round, s.queue.splice(0))) out.push({ d, fast: false });
    out.push({ d: endOf(me.round, s.end.winner, s.end.places), fast: false });
  }
  return out;
}

/**
 * The states a guest whose egg is `g` (watching `watch`) hears about this tick, see NEAR: staggered so each tick
 * carries a share, and noted in `sent` (the guest's record of what it was last sent, which `keys` are compared with).
 */
export function statesFor(m: Match, g: Fighter, states: (State | undefined)[], keys: (string | undefined)[], sent: (string | undefined)[], tick: number, watch: number, all = false): [number, State][] {
  // whoever its own egg is out, the egg it watches (or, until it says, everyone)
  const at = g.phase === 'out' ? m.fighters[watch] : g;
  const near = at ? reachOf(at) : NEAR;
  const list: [number, State][] = [];
  for (const f of m.fighters) {
    const st = states[f.id];
    if (!st || f === g) continue;
    const close = !at || (st.phase !== 'bus' && Math.abs(f.x - at.x) < near && Math.abs(f.z - at.z) < near);
    const due = (tick + f.id) % (st.phase === 'out' ? OUT_EVERY : FAR_EVERY) === 0;
    if (!all && !due && !(close && st.phase !== 'out' && sent[f.id] !== keys[f.id])) continue;
    list.push([f.id, st]);
    sent[f.id] = keys[f.id];
  }
  return list;
}

/** A report of someone else's egg that is out here (taken out for leaving or going quiet), saying so. */
const outOf = (f: Fighter, st: State | undefined) => (st && f.phase === 'out' && st.phase !== 'out' ? { ...st, phase: 'out' as const } : st);

/**
 * The room has handed the host on to the person in seat `from`, seat 0 from now on: the roster and every egg's seat
 * follow, and the old host's egg is nobody's (LEFT), for whoever runs the match next to take out.
 */
export function handOff(s: Session, m: Match, from: number, clock: number) {
  const seat = (v: number) => (v === 0 ? LEFT : v === from ? 0 : v);
  s.roster = s.roster.map(seat);
  for (const f of m.fighters) f.seat = s.roster[f.id] ?? f.seat;
  s.handoffs++;
  s.handAt = clock;
}

/**
 * What a guest tells a new host once it has followed a hand-off: the last few seconds of what the old host settled
 * (and the result, if it came), and again its own asks the old host may never have answered.
 */
export function toNewHost(s: Session, m: Match, me: Me, clock: number): object[] {
  if (!s.synced || s.host) return [];
  const f = m.fighters[m.me];
  if (f && f.phase === 'ground')
    for (const [key, at] of f.pending) {
      if (m.clock - at > REASK) continue;
      // a pickup, or a chest (doors aren't asked again: one asked twice would shut again)
      const ev: NetEv | null = key >= 0 ? { y: 'tk', f: f.id, id: key } : key > -1_000_000 ? { y: 'op', f: f.id, c: -1 - key } : null;
      if (!ev) continue;
      s.queue.push([me.seat, ev]);
      f.pending.set(key, m.clock);
    }
  return [logOf(me.round, s.log.filter(([at]) => at >= clock - LOG_T).map(([, ev]) => ev), s.end)];
}

/**
 * The host left and the room made this client the host: its game takes the match over from here, as seamlessly as it
 * can. It runs the computer eggs (each with what the host last said it carries, else what it was seen holding), settles
 * what the old host settled and the storm's end, and takes out the old host's egg. Everyone hears of every egg at once,
 * and what it last heard the old host settle, in case they missed it. Asks of its own the old host never answered it
 * answers itself, and pickups wait a moment (HOLD_TAKES) for every guest to say what it saw the old host settle, so
 * nothing anyone already got goes to someone else too.
 */
export function takeOver(s: Session, m: Match, me: Me, present: number[], clock: number) {
  if (!s.synced || s.host) return;
  s.host = true;
  m.role = 'host';
  m.world = true;
  // the old host's clock, as far as we heard it, carries on
  if (s.newest > m.time) m.time = s.newest;
  for (const f of m.fighters) {
    if (f.seat !== -1 || f.kind !== 'remote' || f.phase === 'out') continue;
    const kit = s.kits.get(f.id);
    if (kit) putKit(f, kit);
    else guessKit(f);
    seqsPast(m, f);
    s.states.delete(f.id);
  }
  adoptBots(m);
  // a vault door grinding open that we only heard of in a report
  for (const i of m.vaults) if (m.doors[i] === DOOR_OPENING && m.doorT[i] === Infinity) m.doorT[i] = m.time + VAULT_TIME;
  // the guests, afresh: they report to us now
  s.stamps.clear();
  s.sent.clear();
  s.left.clear();
  s.watching.clear();
  s.told.clear();
  s.heard.clear();
  for (const f of m.fighters) if (f.kind === 'remote' && f.seat >= 0) s.heard.set(f.id, clock);
  s.firstTick = -1;
  s.lastTick = -1;
  s.full = true;
  s.tookAt = clock;
  s.logs.clear();
  m.held = [];
  if (s.end) s.endSends = 0;
  // what we heard the old host settle goes to everyone, then whatever of ours was still to go; our own asks we answer
  const asks = s.queue.filter(([, ev]) => ASKS.has(ev.y)).map(([, ev]) => ev);
  s.queue = [...s.log.map(([, ev]): [number, NetEv] => [me.seat, ev]), ...s.queue.filter(([, ev]) => !ASKS.has(ev.y)).map(([, ev]): [number, NetEv] => [me.seat, ev])];
  s.log = [];
  const mine = m.fighters[m.me];
  if (mine && mine.phase === 'ground')
    for (const [key, at] of mine.pending) {
      if (m.clock - at > REASK) continue;
      if (key >= 0) asks.push({ y: 'tk', f: mine.id, id: key });
      else if (key > -1_000_000) asks.push({ y: 'op', f: mine.id, c: -1 - key });
    }
  if (mine) mine.pending.clear();
  for (const ev of asks) applyNet(m, ev);
  for (const [from, p] of s.heldLogs.splice(0)) heardLog(s, m, me, from, p, clock);
}

/** What a computer egg nobody told us the kit of carries: what it was seen holding, with a little ammo for it. */
function guessKit(f: Fighter) {
  const w = f.show.w;
  if (w && isWeapon(w)) {
    f.guns = [{ w, r: f.show.r, mag: WEAPONS[w].mag }, null];
    f.slot = 0;
    f.ammo[WEAPONS[w].ammo] = Math.max(f.ammo[WEAPONS[w].ammo], WEAPONS[w].mag * 3);
  } else if (w && isMelee(w)) f.melee = w;
}

/** A computer egg's drops and pieces number on past every id of its we have seen, so none is used twice. */
function seqsPast(m: Match, f: Fighter) {
  const base = DROP_BASE + f.id * 100_000;
  let drop = f.dropSeq;
  for (const id of [...m.loot.keys(), ...m.gone]) if (id >= base && id < base + 100_000) drop = Math.max(drop, id - base + 1);
  let wall = f.wallSeq;
  for (const id of [...m.walls.keys(), ...m.goneWalls]) if (id >= f.id * 100_000 && id < (f.id + 1) * 100_000) wall = Math.max(wall, id - f.id * 100_000 + 1);
  f.dropSeq = Math.max(f.dropSeq, drop + 50);
  f.wallSeq = Math.max(f.wallSeq, wall + 50);
}

/** Queues something that happened here for the room, when anyone else needs to hear it. */
export function share(s: Session, e: Ev, seat: number) {
  const ne = toNet(e);
  if (ne) s.queue.push([seat, ne]);
}

/** Packets of queued events, at most every FLUSH seconds. */
export function flush(s: Session, round: number, dt: number): object[] {
  s.flushT += dt;
  if (s.flushT < FLUSH || !s.queue.length) return [];
  s.flushT = 0;
  return packEvents(round, s.queue.splice(0));
}

/**
 * Whether it's time to show the result: 'report' once the host has called it (then everyone reports the winner),
 * 'quiet' if the host never did long after the storm closed (show what we know, report nothing), else null. A card
 * that went up early still hears it.
 */
export function ending(s: Session, m: Match, me: Me, clock: number): 'report' | 'quiet' | null {
  if (s.reported || (s.over && !s.early)) return null;
  if (me.isHost && m.ended && !s.end) {
    s.end = { winner: m.winner, places: placesOf(m) };
    s.endAt = clock;
  }
  if (s.end) return clock - s.endAt > END_PAUSE ? 'report' : null;
  // a new host that has said nothing since it took over couldn't take the match over
  if (!me.isHost && s.handAt >= 0 && clock - Math.max(s.heardAt, s.handAt) > HOST_GONE) return 'quiet';
  return m.time > stormEnd(m.map.storm) + 45 ? 'quiet' : null;
}

/** The longest step the match takes without frames, the same as a frame's. */
const STEP_MAX = 1 / 20;
/** The most of a slow frame made up online (a longer stall is let go, as any frame longer than a step is solo). */
export const LATE_MAX = 0.2;

/**
 * How far a frame moves an online match on: the loop's `dt`, or, when the loop cut the frame short (it took longer
 * than a step may), all the time `since` the last one, up to LATE_MAX. The match keeps the room's time on a slow
 * phone, rather than our egg and the ones we see falling behind everyone else's.
 */
export const frameTime = (dt: number, since: number) => (dt >= STEP_MAX - 1e-6 ? Math.max(dt, Math.min(LATE_MAX, since)) : dt);

/** Moves the match on by `seconds` in steps no longer than a frame's. */
export function stepIn(m: Match, seconds: number) {
  let left = seconds;
  do {
    const d = Math.min(STEP_MAX, left);
    step(m, d);
    left -= d;
  } while (left > 1e-4);
}

/**
 * Whether the timer moves the match on instead of the frame loop: a hidden tab gets no frames, and a host who is done
 * watching draws none, but the computer eggs, the storm and everyone's pickups still run on the host.
 */
export const offscreen = (s: Session, me: Me, hidden: boolean, playing: boolean) => s.synced && ((hidden && playing) || (me.isHost && s.early));

/** Moves the match on by `seconds` (two at most) in short steps, sharing whatever happens with the room. */
export function catchUp(s: Session, m: Match, seat: number, seconds: number) {
  let left = Math.min(2, Math.max(0, seconds));
  while (left > 1e-4) {
    const d = Math.min(STEP_MAX, left);
    step(m, d);
    left -= d;
    for (const e of m.events.splice(0)) share(s, e, seat);
  }
}

/** The names on a team, as a list: "Ann", "Ann and Bo", "Ann, Bo and Cy". */
export function namesOf(fs: Fighter[]) {
  const names = fs.map((f) => f.name);
  return names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The fighters on the team that won (empty when nobody did). */
export const winnersOf = (m: Match) => (m.ended && m.fighters[m.winner] ? m.fighters.filter((f) => f.team === m.fighters[m.winner].team) : []);

/**
 * The result card for our egg online: where it (in duos and squads, its team) placed and what it did, then who won.
 * One that goes up while the match is still going (`early`) says how many eggs (teams) are left: a guest's in the
 * detail, the host's in the note under its Play Again, which waits for the end.
 */
export function resultCard(m: Match, early: boolean, host: boolean): { title: string; detail: string; wait?: string; won: boolean } {
  const me = m.fighters[m.me];
  const teams = m.mode !== 'solo';
  const winners = winnersOf(m);
  const won = !!me && winners.includes(me);
  const total = teams ? teamCount(m) : m.fighters.length;
  // out while the rest of our team is still in: no place yet
  const title = won ? (teams ? 'Last Team Standing' : 'Last Egg Standing') : me && teams && !me.place ? 'Your Team Is Still In' : me ? `${ordinal(me.place || total)} of ${total}` : 'Match Over';
  const stats = me ? `${me.kills} ${me.kills === 1 ? 'elimination' : 'eliminations'}, ${Math.round(me.dealt)} damage.` : '';
  const left = teams ? teamsLeft(m) : aliveCount(m);
  const what = teams ? (left === 1 ? 'team' : 'teams') : left === 1 ? 'egg' : 'eggs';
  const going = early && !m.ended;
  let how = '';
  if (winners.length && !won) how = `${namesOf(winners)} won.`;
  else if (m.ended && !winners.length) how = 'Nobody survived the storm.';
  else if (going && !host) how = `${left} ${what} still going.`;
  const detail = `${stats} ${how}`.trim();
  if (!early || !host) return { title, detail, won };
  const What = what[0].toUpperCase() + what.slice(1);
  return { title, detail, wait: going ? `${left} ${What} Still Going. Play Again Once the Match Ends.` : 'The Match Is Over. Play Again in a Moment.', won };
}
