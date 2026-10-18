// One client's side of an online Scramble match: what it does with each message from the room, what it sends on its
// regular tick, the events it queues and flushes, and when the match is over. Pure, so a whole room can be simulated
// in a test; index.tsx connects it to the real room.
import { FALL, FIGHTER_COLORS, MAX_FIGHTERS, aliveCount, applyOut, applyState, botNames, createMatch, endMatch, forfeit, ordinal, owned, step, type Entrant, type Ev, type Fighter, type Level, type Match } from './logic.ts';
import { BUS_Y, stormEnd } from './map.ts';
import { actorOf, applyNet, endOf, guestState, hostState, packEvents, parsePacket, placesOf, stateKey, stateOf, toNet, type NetEv, type State } from './net.ts';

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
 * host reports each egg whenever it has changed: farther than anyone sees on the ground, and gliding down. Everything
 * else, and eggs still on the bus, goes every FAR_EVERY ticks; eggs that are out every OUT_EVERY (a guest takes one out
 * on its own a moment after the news of how never comes).
 */
export const NEAR = 100;
export const NEAR_GLIDE = 130;
export const FAR_EVERY = 6;
export const OUT_EVERY = 15;

/** Who this client is in the room. */
export type Me = { seat: number; isHost: boolean; round: number };
export type Player = { seat: number; name: string };

const nameOf = (players: Player[], seat: number) => players.find((p) => p.seat === seat)?.name ?? `Player ${seat + 1}`;

/**
 * The host's match: everyone in the room by seat, then as many computer eggs as the host asks for (fifty eggs at most).
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

/**
 * How many computer eggs the host asks hostMatch for: in a quick-play match always enough to fill the island (people
 * take seats from the room's bots, so a full room has none left), otherwise the room's, and with any of them more to
 * fill it when the host picked that. The level a quick-play match plays at is always normal.
 */
export const hostBots = (quick: boolean, roomBots: number, fill: boolean) => (quick || (roomBots > 0 && fill) ? MAX_FIGHTERS : roomBots);
export const QUICK_LEVEL: Level = 'normal';

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
  /** The egg this client watches once its own is out (-1 for its own); the host's record of each guest's, by egg. */
  watch: number;
  watching: Map<number, number>;
  /** The host's record of the state it last sent each guest for each egg (packed), by seat. */
  sent: Map<number, (string | undefined)[]>;
};

export function newSession(synced: boolean, roster: number[] = []): Session {
  return { synced, roster, states: new Map(), queue: [], flushT: 0, ticks: 0, end: null, endAt: -1, endSends: 0, reported: false, over: false, early: false, left: new Set(), heard: new Map(), firstTick: -1, watch: -1, watching: new Map(), sent: new Map() };
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
    s.watching.set(fid, p.watch);
    applyState(m, f, p.state);
  } else if (p.k === 'S') {
    if (me.isHost || from !== 0) return m;
    if (!s.synced) {
      if (!p.roster || !p.roster.includes(me.seat)) return m;
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
    // the windows the host has broken: quietly, since any news of them has come and gone
    for (const i of p.glass ?? []) if (i < m.broken.length) m.broken[i] = true;
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
export function tick(s: Session, m: Match, me: Me, present: number[], clock: number): { d: object; fast: boolean; to?: number }[] {
  if (!s.synced) return [];
  s.ticks++;
  // most go on the fast channel, which may drop one; every fifth on the reliable one
  const fast = s.ticks % 5 !== 0;
  if (!me.isHost) {
    const f = m.fighters[m.me];
    return f ? [{ d: guestState(me.round, stateOf(f), f.phase === 'out' ? s.watch : -1), fast }] : [];
  }
  if (s.firstTick < 0) s.firstTick = clock;
  for (const seat of s.roster) if (seat >= 0 && !present.includes(seat)) s.left.add(seat);
  for (const f of m.fighters) {
    if (f.seat < 0 || f.kind !== 'remote' || f.phase === 'out' || m.ended) continue;
    const quiet = clock - (s.heard.get(f.id) ?? s.firstTick + FIRST_GRACE) > STALE;
    const aloft = f.phase === 'bus' ? m.time > m.map.bus.off + DOWN_BY : f.phase === 'drop' && m.time > Math.max(f.dropAt, m.map.bus.off) + DOWN_BY;
    if (s.left.has(f.seat) || quiet || aloft) forfeit(m, f.id);
  }
  const states: (State | undefined)[] = m.fighters.map((f) => (owned(f) ? stateOf(f) : s.states.get(f.id)));
  const keys = states.map((st) => (st ? stateKey(st) : undefined));
  // each guest its own report (every reliable one with the roster); someone in the room but not in this match only
  // hears the roster, to know to sit it out
  const out: { d: object; fast: boolean; to?: number }[] = [];
  for (const seat of present) {
    if (seat === me.seat) continue;
    const g = m.fighters[s.roster.indexOf(seat)];
    if (!g && fast) continue;
    let sent = s.sent.get(seat);
    if (!sent) s.sent.set(seat, (sent = []));
    const list = g ? statesFor(m, g, states, keys, sent, s.ticks, s.watching.get(g.id) ?? -1) : [];
    out.push({ d: hostState(me.round, m.seed, m.time, m.level, fast ? null : s.roster, list, m.broken), fast, to: seat });
  }
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
export function statesFor(m: Match, g: Fighter, states: (State | undefined)[], keys: (string | undefined)[], sent: (string | undefined)[], tick: number, watch: number): [number, State][] {
  // whoever its own egg is out, the egg it watches (or, until it says, everyone)
  const at = g.phase === 'out' ? m.fighters[watch] : g;
  const near = at?.phase === 'ground' ? NEAR : NEAR_GLIDE;
  const list: [number, State][] = [];
  for (const f of m.fighters) {
    const st = states[f.id];
    if (!st || f === g) continue;
    const close = !at || (st.phase !== 'bus' && Math.abs(f.x - at.x) < near && Math.abs(f.z - at.z) < near);
    const due = (tick + f.id) % (st.phase === 'out' ? OUT_EVERY : FAR_EVERY) === 0;
    if (!due && !(close && st.phase !== 'out' && sent[f.id] !== keys[f.id])) continue;
    list.push([f.id, st]);
    sent[f.id] = keys[f.id];
  }
  return list;
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
  return m.time > stormEnd(m.map.storm) + 45 ? 'quiet' : null;
}

/** The longest step the match takes without frames, the same as a frame's. */
const STEP_MAX = 1 / 20;

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

/**
 * The result card for our egg online: where it placed and what it did, then who won. One that goes up while the match
 * is still going (`early`) says how many eggs are left: a guest's in the detail, the host's in the note under its Play
 * Again, which waits for the end.
 */
export function resultCard(m: Match, early: boolean, host: boolean): { title: string; detail: string; wait?: string; won: boolean } {
  const me = m.fighters[m.me];
  const winner = m.ended ? m.fighters[m.winner] : undefined;
  const won = !!me && !!winner && winner.id === me.id;
  const title = won ? 'Last Egg Standing' : me ? `${ordinal(me.place || m.fighters.length)} of ${m.fighters.length}` : 'Match Over';
  const stats = me ? `${me.kills} ${me.kills === 1 ? 'elimination' : 'eliminations'}, ${Math.round(me.dealt)} damage.` : '';
  const left = aliveCount(m);
  const going = early && !m.ended;
  let how = '';
  if (winner && !won) how = `${winner.name} won.`;
  else if (m.ended && !winner) how = 'Nobody survived the storm.';
  else if (going && !host) how = `${left} ${left === 1 ? 'egg' : 'eggs'} still going.`;
  const detail = `${stats} ${how}`.trim();
  if (!early || !host) return { title, detail, won };
  return { title, detail, wait: going ? `${left} ${left === 1 ? 'Egg' : 'Eggs'} Still Going. Play Again Once the Match Ends.` : 'The Match Is Over. Play Again in a Moment.', won };
}
