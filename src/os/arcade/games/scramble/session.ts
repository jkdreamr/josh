// One client's side of an online Scramble match: what it does with each message from the room, what it sends on its
// regular tick, the events it queues and flushes, and when the match is over. Pure, so a whole room can be simulated
// in a test; index.tsx connects it to the real room.
import { FALL, FIGHTER_COLORS, MAX_FIGHTERS, applyOut, applyState, botNames, createMatch, endMatch, forfeit, owned, type Entrant, type Ev, type Level, type Match } from './logic.ts';
import { BUS_Y, stormEnd } from './map.ts';
import { actorOf, applyNet, endOf, guestState, hostState, packEvents, parsePacket, placesOf, stateOf, toNet, type NetEv, type State } from './net.ts';

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

/** Who this client is in the room. */
export type Me = { seat: number; isHost: boolean; round: number };
export type Player = { seat: number; name: string };

const nameOf = (players: Player[], seat: number) => players.find((p) => p.seat === seat)?.name ?? `Player ${seat + 1}`;

/**
 * The host's match: everyone in the room by seat, then as many computer eggs as the host asks for (twenty eggs at most).
 * `roster` is each fighter's seat (-1 for a computer egg), which the host sends with every state.
 */
export function hostMatch(players: Player[], mySeat: number, seed: number, level: Level, bots: number, countdown: number): { match: Match; roster: number[] } {
  const seats = players.map((p) => p.seat).sort((a, b) => a - b).slice(0, MAX_FIGHTERS);
  const names = botNames(seed);
  const entrants: Entrant[] = seats.map((seat, i) => ({ name: nameOf(players, seat), color: FIGHTER_COLORS[i], kind: seat === mySeat ? 'player' : 'remote', seat }));
  for (let b = 0; b < bots && entrants.length < MAX_FIGHTERS; b++) entrants.push({ name: names[b], color: FIGHTER_COLORS[entrants.length], kind: 'bot', seat: -1 });
  const match = createMatch({ seed, role: 'host', level, entrants, me: entrants.findIndex((e) => e.seat === mySeat), countdown });
  return { match, roster: entrants.map((e) => e.seat) };
}

/** A guest's match, laid out from the host's first state: the same eggs, names and colors, ours to play. */
export function guestMatch(players: Player[], mySeat: number, seed: number, level: Level, time: number, roster: number[]): Match {
  const names = botNames(seed);
  let b = 0;
  const entrants: Entrant[] = roster.map((seat, i) => ({
    name: seat >= 0 ? nameOf(players, seat) : names[b++],
    color: FIGHTER_COLORS[i],
    kind: seat === mySeat ? 'player' : 'remote',
    seat,
  }));
  return createMatch({ seed, role: 'guest', level, entrants, me: roster.indexOf(mySeat), countdown: -time });
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
  over: boolean;
  /** The host's view of the room: seats that have left (for good, even if someone new sits there) and when each guest last reported. */
  left: Set<number>;
  heard: Map<number, number>;
  firstTick: number;
};

export function newSession(synced: boolean, roster: number[] = []): Session {
  return { synced, roster, states: new Map(), queue: [], flushT: 0, ticks: 0, end: null, endAt: -1, endSends: 0, reported: false, over: false, left: new Set(), heard: new Map(), firstTick: -1 };
}

/** Builds a guest's match from the host's first state. */
export type Join = (seed: number, level: Level, time: number, roster: number[]) => Match;

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
    s.states.set(fid, p.state);
    s.heard.set(fid, clock);
    applyState(m, f, p.state);
  } else if (p.k === 'S') {
    if (me.isHost || from !== 0) return m;
    if (!s.synced) {
      if (!p.roster.includes(me.seat)) return m;
      m = join(p.seed, p.level, p.time, p.roster);
      s.roster = p.roster;
      s.synced = true;
    }
    // keep our clock on the host's: the storm and the bus run on it
    const diff = p.time - m.time;
    if (Math.abs(diff) > 1) m.time = p.time;
    else m.time += diff * 0.1;
    for (const [fid, st] of p.states) {
      const f = m.fighters[fid];
      if (f && f.kind === 'remote') applyState(m, f, st);
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
        if (applyNet(m, ev) && me.isHost) s.queue.push([from, ev]);
      }
    }
  } else if (p.k === 'end') {
    if (me.isHost || from !== 0 || s.end || !s.synced) return m;
    endMatch(m, p.winner, p.places);
    s.end = { winner: p.winner, places: p.places };
    s.endAt = clock;
  }
  return m;
}

/**
 * What goes out on the regular tick: a guest's own egg, or from the host everyone's (and the result once there is
 * one). The host also takes out the eggs of people who have left (`present` is the seats in the room now) or who
 * have stopped playing: gone quiet, or still up in the air long after everyone else has landed. `clock` is wall time.
 */
export function tick(s: Session, m: Match, me: Me, present: number[], clock: number): { d: object; fast: boolean }[] {
  if (!s.synced) return [];
  s.ticks++;
  // most go on the fast channel, which may drop one; every fifth on the reliable one
  const fast = s.ticks % 5 !== 0;
  if (!me.isHost) {
    const f = m.fighters[m.me];
    return f ? [{ d: guestState(me.round, stateOf(f)), fast }] : [];
  }
  if (s.firstTick < 0) s.firstTick = clock;
  for (const seat of s.roster) if (seat >= 0 && !present.includes(seat)) s.left.add(seat);
  for (const f of m.fighters) {
    if (f.seat < 0 || f.kind !== 'remote' || f.phase === 'out' || m.ended) continue;
    const quiet = clock - (s.heard.get(f.id) ?? s.firstTick + FIRST_GRACE) > STALE;
    const aloft = f.phase === 'bus' ? m.time > m.map.bus.off + DOWN_BY : f.phase === 'drop' && m.time > Math.max(f.dropAt, m.map.bus.off) + DOWN_BY;
    if (s.left.has(f.seat) || quiet || aloft) forfeit(m, f.id);
  }
  const states: [number, State][] = [];
  for (const f of m.fighters) {
    const st = owned(f) ? stateOf(f) : s.states.get(f.id);
    if (st) states.push([f.id, st]);
  }
  const out: { d: object; fast: boolean }[] = [{ d: hostState(me.round, m.seed, m.time, m.level, s.roster, states), fast }];
  if (s.end && s.endSends < 4) {
    s.endSends++;
    // whatever happened last (the final crack) goes out ahead of the result
    for (const d of packEvents(me.round, s.queue.splice(0))) out.push({ d, fast: false });
    out.push({ d: endOf(me.round, s.end.winner, s.end.places), fast: false });
  }
  return out;
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
 * 'quiet' if the host never did long after the storm closed (show what we know, report nothing), else null.
 */
export function ending(s: Session, m: Match, me: Me, clock: number): 'report' | 'quiet' | null {
  if (s.over) return null;
  if (me.isHost && m.ended && !s.end) {
    s.end = { winner: m.winner, places: placesOf(m) };
    s.endAt = clock;
  }
  if (s.end) return clock - s.endAt > END_PAUSE ? 'report' : null;
  return m.time > stormEnd(m.map.storm) + 45 ? 'quiet' : null;
}
