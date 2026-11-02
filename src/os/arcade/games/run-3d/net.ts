// Void Run's online racers as seen from here: where each report goes on our clock, and where a racer is drawn
// between them. Pure (no React, no three), so tests can run a delayed, jittery room.
//
// Every racer runs on its own and sends where it is 12 times a second; others are drawn INTERP_MS in the past, between
// two reports. A report says when its sender sampled it (`at`, ms on the sender's own clock), so it is placed on our
// clock by when it was sampled, not by when it happened to arrive: the least delayed report from a sender sets the
// gap between its clock and ours (SenderClock), so jitter in the link no longer bunches reports up or spreads them out
// (which drew racers speeding up and stopping). Older clients send no `at`; their reports go in as they arrive.

/** Others are drawn this far in the past, so there is nearly always a report either side. */
export const INTERP_MS = 120;
/** Reports go out this often (seconds of race time). */
export const SEND_EVERY = 1 / 12;

/** One report as drawn: when it is taken to be current (ms, our clock), how far, round and high, flags and finish ms. */
export type Sample = { at: number; d: number; u: number; h: number; f: number; t: number };
export type Remote = { samples: Sample[]; ms: number; dist: number; gone: boolean };
export const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** One racer as [seat, dist, u, h, flags, finish ms or -1]; flags: 1 falling, 2 finished. */
export type Wire = [number, number, number, number, number, number];
export const isWire = (w: unknown): w is Wire => Array.isArray(w) && w.length === 6 && w.every(num);

export const newRemote = (): Remote => ({ samples: [], ms: -1, dist: 0, gone: false });

/**
 * Adds a report taken to be current at `at` (true when it is drawn); one older than the newest is late (fast packets
 * can pass each other) and only its finish counts.
 */
export function push(r: Remote, w: Wire, at: number): boolean {
  const [, d, u, h, f, t] = w;
  if (t >= 0) r.ms = t;
  r.dist = Math.max(r.dist, d);
  const last = r.samples[r.samples.length - 1];
  if (last && at < last.at) return false;
  if (last && at === last.at) r.samples.pop();
  r.samples.push({ at, d, u, h, f, t });
  if (r.samples.length > 12) r.samples.shift();
  return true;
}

/** Where a remote racer was INTERP_MS ago, between the two samples around that moment. */
export function sampleAt(r: Remote, now: number): Sample | null {
  const list = r.samples;
  if (!list.length) return null;
  const at = now - INTERP_MS;
  for (let i = list.length - 1; i > 0; i--) {
    const a = list[i - 1];
    const b = list[i];
    if (a.at <= at && at <= b.at) {
      const k = (at - a.at) / Math.max(1, b.at - a.at);
      const jump = Math.abs(b.d - a.d) > 30 || Math.abs(b.u - a.u) > 6;
      if (jump) return b;
      return { at, d: a.d + (b.d - a.d) * k, u: a.u + (b.u - a.u) * k, h: a.h + (b.h - a.h) * k, f: b.f, t: b.t };
    }
  }
  const last = list[list.length - 1];
  const prev = list[list.length - 2];
  if (!prev || at < list[0].at) return last;
  // a little past the last sample: keep running at the last speed for up to a quarter second
  const ahead = Math.min(250, at - last.at) / 1000;
  const v = (last.d - prev.d) / Math.max(0.001, (last.at - prev.at) / 1000);
  return { ...last, d: last.d + (last.f & 2 ? 0 : Math.max(0, v) * ahead) };
}

/** A gap this much wider than the least delayed one is the sender's clock having stopped (a page in the background), not the link. */
const CLOCK_JUMP = 500;
/** How fast the gap follows a link that has got slower for good: this share of the difference each report. */
const DRIFT = 0.02;

/**
 * One sender's clock against ours. `at` takes when a report arrived (our ms) and when its sender sampled it (its ms),
 * and gives when it is taken to be current here: its sample time plus the least delayed gap seen lately (which drifts
 * up slowly, so a link that got slower is followed too). Never later than it arrived.
 */
export class SenderClock {
  private gap: number | null = null;
  at(arrived: number, sent: number): number {
    const gap = arrived - sent;
    if (this.gap === null || gap < this.gap || gap - this.gap > CLOCK_JUMP) this.gap = gap;
    else this.gap += (gap - this.gap) * DRIFT;
    return Math.min(arrived, sent + this.gap);
  }
}

/** What a client keeps of everyone else: each racer's reports, and each sender's clock. */
export type Field = { remotes: Map<number, Remote>; clocks: Map<number, SenderClock> };
export const newField = (): Field => ({ remotes: new Map(), clocks: new Map() });

/**
 * A racer packet: the sender's own racer (`me`), and from the host its bots or a guest it passes on (`b`), when the
 * sender sampled them (`at`, ms on its clock) and how much older than that each of `b` is (`ag`, ms). `at` and `ag`
 * are new and optional, so older clients still read these packets and are still read.
 */
export type RacePacket = { game: 'run-3d'; k: 'p'; me?: Wire; b?: Wire[]; at?: number; ag?: number[] };

/**
 * Takes in a racer packet from seat `from` that arrived at `arrived` (our ms). `mine` is our own seat (never drawn
 * from afar). True when it brought news of its sender's own racer (which a host passes on, see passOn).
 */
export function receive(f: Field, mine: number, from: number, p: { me?: unknown; b?: unknown; at?: unknown; ag?: unknown }, arrived: number): boolean {
  let base = arrived;
  if (num(p.at)) {
    let clock = f.clocks.get(from);
    if (!clock) f.clocks.set(from, (clock = new SenderClock()));
    base = clock.at(arrived, p.at);
  }
  let news = false;
  // only the host speaks for anyone but itself
  const more = from === 0 && Array.isArray(p.b) ? p.b : [];
  const ages = Array.isArray(p.ag) ? p.ag : [];
  for (let i = -1; i < more.length; i++) {
    const w = i < 0 ? p.me : more[i];
    if (!isWire(w)) continue;
    const who = w[0];
    if (who === mine || (i < 0 && who !== from)) continue;
    const age = i >= 0 && num(ages[i]) ? Math.max(0, Math.min(1000, ages[i])) : 0;
    let r = f.remotes.get(who);
    if (!r) f.remotes.set(who, (r = newRemote()));
    if (push(r, w, base - age) && i < 0) news = true;
  }
  return news;
}

/**
 * On the host, the moment a guest's report comes in: the same report for everyone (guests only talk to the host, so
 * without it they would never see each other), as of now on the host's clock with how long before now it was current.
 * Passed on straight away, rather than with the host's own reports, so it is no staler than the link makes it.
 */
export function passOn(f: Field, seat: number, now: number): RacePacket | null {
  const last = f.remotes.get(seat)?.samples.at(-1);
  if (!last) return null;
  return { game: 'run-3d', k: 'p', b: [[seat, last.d, last.u, last.h, last.f, last.t]], at: Math.round(now), ag: [Math.max(0, Math.round(now - last.at))] };
}
