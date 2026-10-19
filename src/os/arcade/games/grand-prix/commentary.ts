// The race commentator. It watches the race the way a broadcaster does (the build-up, the start and the first
// chicane, overtakes, battles and DRS attacks, spins, lock-ups and trips over the kerbs, the race up front, laps to go
// and the flag), and between the big moments fills the quiet with talk about Monza and the corner coming up. Its
// lines are recorded clips (lines.ts) strung together and played one at a time. The director is a pure module,
// testable under node; the voice plays the clips with WebAudio.
import type { Race, RaceEvent, Runner } from './race.ts';
import { CLIP_DIR, CORNERS, LINES, clipFile, nameKey } from './lines.ts';

/** 0 filler, 1 news, 2 the big moments, 3 cuts in over anything less (lights out, the flag). */
export type Priority = 0 | 1 | 2 | 3;
/** Line keys to say back to back, how much it matters, and how long it stays worth saying (seconds). */
export type Speak = (clips: string[], priority: Priority, stale?: number) => void;

export type Commentary = {
  event: (r: Race, e: RaceEvent) => void;
  update: (r: Race, dt: number) => void;
};

type Local = {
  pos: number;
  since: number;
  called: number;
  grid: number;
  start: boolean;
  /** Recent gaps to the car ahead, and which car that is (a new car ahead starts the history again). */
  gapAhead: number[];
  ahead: number;
  close: number;
  defended: boolean;
  tow: number;
  wasSpun: boolean;
};

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Commentary for the local drivers `locals` (one alone is talked about without a name, two in split screen are
 * called Player one and Player two). `quiet` says how long the voice has been silent (0 while it talks), so the
 * colour fills gaps instead of talking over the action.
 */
export function createCommentary(opts: { locals: () => Runner[]; speak: Speak; quiet: () => number; random?: () => number }): Commentary {
  const { locals, speak, quiet } = opts;
  const random = opts.random ?? Math.random;
  const state = new Map<number, Local>();
  const cool = new Map<string, number>();
  const order = new Map<string, number[]>();
  let introduced = false;
  let contactsAtStart = 0;
  let firstChicaneSaid = false;
  let leader = { idx: -1, since: 0, called: -1 };
  let fillAfter = 9;
  const aiSpun = new Set<number>();
  let fastestBy = -1;

  /** A variant of a line, working through them all in a shuffled order before repeating any. */
  const pick = (key: string) => {
    const n = LINES[key]?.length ?? 0;
    if (n <= 1) return `${key}-0`;
    let left = order.get(key);
    if (!left || !left.length) {
      left = Array.from({ length: n }, (_, k) => k);
      for (let k = n - 1; k > 0; k--) {
        const j = Math.floor(random() * (k + 1));
        [left[k], left[j]] = [left[j], left[k]];
      }
      order.set(key, left);
    }
    return `${key}-${left.pop()}`;
  };
  const say = (keys: (string | null)[], priority: Priority, stale?: number) => {
    if (keys.some((k) => k === null || !LINES[k])) return;
    speak((keys as string[]).map(pick), priority, stale);
  };
  /** True, and starts the cooldown, when `key` has not been said in the last `secs` of race time. */
  const ready = (r: Race, key: string, secs: number) => {
    const at = cool.get(key);
    if (at !== undefined && r.time < at) return false;
    cool.set(key, r.time + secs);
    return true;
  };
  const solo = () => locals().length < 2;
  /** In split screen the line opens with which player it is about. */
  const about = (me: Runner, keys: (string | null)[]) => (solo() ? keys : [`name-player${me.entry.pad + 1}`, ...keys]);
  const local = (idx: number) => locals().find((p) => p.idx === idx) ?? null;
  const nameOf = (rn: Runner | undefined) => (rn && LINES[nameKey(rn.entry.name)] ? nameKey(rn.entry.name) : null);
  const posOf = (r: Race, rn: Runner) => r.order.indexOf(rn.idx) + 1;
  const stateOf = (r: Race, rn: Runner) => {
    let s = state.get(rn.idx);
    if (!s) {
      const pos = posOf(r, rn);
      s = { pos, since: 0, called: pos, grid: pos, start: false, gapAhead: [], ahead: -1, close: 0, defended: false, tow: 0, wasSpun: false };
      state.set(rn.idx, s);
    }
    return s;
  };
  /** Seconds from `b` back to `a` on the road (positive when `a` is ahead). */
  const gap = (a: Runner, b: Runner) => (a.dist - b.dist) / Math.max(15, Math.abs(b.car.vx));
  /** The corner a car is at: within 120 m before its apex to 250 m after. */
  const cornerAt = (r: Race, s: number) => {
    for (const c of r.c.corners) {
      let d = s - c.s;
      if (d < -r.c.length / 2) d += r.c.length;
      if (d > r.c.length / 2) d -= r.c.length;
      if (d > -120 && d < 250 && CORNERS[c.name]) return CORNERS[c.name];
    }
    return null;
  };
  /** The corner coming up, 150 to 350 m ahead. */
  const cornerAhead = (r: Race, s: number) => {
    for (const c of r.c.corners) {
      let d = c.s - s;
      if (d < 0) d += r.c.length;
      if (d > 150 && d < 350 && CORNERS[c.name]) return CORNERS[c.name];
    }
    return null;
  };
  const spun = (r: Race, rn: Runner) => {
    const car = rn.car;
    const i = Math.max(0, Math.min(r.c.n - 1, car.i));
    const heading = Math.atan2(r.c.ty[i], r.c.tx[i]);
    return Math.abs(wrapAngle(car.yaw - heading)) > 1.7 && Math.hypot(car.vx, car.vy) > 2;
  };

  return {
    event(r, e) {
      switch (e.t) {
        case 'light':
          if (e.n === 1) say(['lights'], 1, 1.2);
          break;
        case 'go':
          if (r.mode !== 'race') break;
          for (const me of locals()) stateOf(r, me).grid = posOf(r, me);
          say(['go'], 3);
          break;
        case 'contact': {
          if (r.time < 15) contactsAtStart++;
          const me = local(e.idx) ?? local(e.other);
          if (me && e.speed > 6 && r.time > 15 && ready(r, 'contact', 20)) say(about(me, ['contact']), 1, 2);
          break;
        }
        case 'wall': {
          const me = local(e.idx);
          if (me && e.speed > 8 && ready(r, 'wall', 12)) say(about(me, ['wall']), 2, 2);
          break;
        }
        case 'limits': {
          const me = local(e.idx);
          if (!me) break;
          if (e.reset) {
            if (ready(r, 'reset', 10)) say(about(me, ['reset']), 1, 3);
          } else if (e.penalty) say(about(me, ['penalty']), 2, 4);
          else if (r.mode === 'race' && e.warnings === 3) say(about(me, ['final-warning']), 1, 3);
          else if (e.invalid && ready(r, 'wide', 12)) {
            const corner = cornerAt(r, me.car.s);
            say(about(me, [corner && LINES[`wide-${corner}`] ? `wide-${corner}` : 'wide']), 1, 2);
          }
          break;
        }
        case 'lap': {
          const rn = r.runners[e.idx];
          const me = local(e.idx);
          if (r.mode === 'trial') {
            if (!me) break;
            if (!e.lap.valid) say(['invalid'], 1, 3);
            else if (e.best && rn.laps.length >= 2) say(['pb'], 2, 4);
            break;
          }
          if (rn.fin !== null) break;
          if (!me) {
            // a new holder of the fastest lap is news; the same driver going quicker again is not
            if (e.overall && rn.laps.length >= 2 && rn.idx !== fastestBy && ready(r, 'ai-fastest', 45)) {
              fastestBy = rn.idx;
              say(['fastest-to', nameOf(rn)], 1, 3);
            }
            break;
          }
          if (e.overall && rn.laps.length >= 2 && (rn.idx !== fastestBy || ready(r, 'fastest-again', 150))) {
            fastestBy = rn.idx;
            say(about(me, ['fastest-mine']), 2, 4);
          }
          const left = r.laps - rn.lap;
          const pos = `running-${posOf(r, me)}`;
          if (left === 1) say(about(me, ['final-lap', pos]), 2, 4);
          else if (left >= 2 && left <= 9) {
            if (r.laps >= 6 && left === Math.floor(r.laps / 2)) say(['halfway', ...about(me, [pos])], 1, 4);
            else say([`to-go-${left}`, ...(random() < 0.5 ? about(me, [pos]) : [])], 1, 4);
          }
          break;
        }
        case 'sector': {
          const me = local(e.idx);
          const rn = r.runners[e.idx];
          if (!me || e.sector > 1 || rn.laps.length < 1) break;
          if (e.overall && ready(r, 'purple', 30)) say(about(me, ['purple']), 1, 2);
          else if (r.mode === 'trial' && ready(r, 'trial-delta', 30)) {
            const best = rn.bestSectors[e.sector];
            if (e.best) say(['trial-up'], 1, 2);
            else if (best !== undefined && e.time - best > 0.3) say(['trial-down'], 1, 2);
            else cool.delete('trial-delta');
          }
          break;
        }
        case 'drs': {
          const me = local(e.idx);
          if (!me || !e.open || r.mode !== 'race') break;
          const ahead = r.runners[r.order[posOf(r, me) - 2]];
          if (ahead && gap(ahead, me) < 1 && ready(r, 'drs', 40)) say(about(me, ['drs-attack']), 1, 2);
          break;
        }
        case 'finish': {
          const me = local(e.idx);
          if (me) {
            if (e.place === 1 && e.penalty === 0) say(about(me, ['win']), 3);
            else if (e.penalty) say(about(me, ['flag-penalty']), 3);
            else say(about(me, [`finish-${e.place}`]), 3);
          } else if (e.place === 1 && locals().every((p) => p.fin === null)) say([nameOf(r.runners[e.idx]), 'takes-flag'], 2, 4);
          break;
        }
      }
    },

    update(r, dt) {
      const t = r.time;
      if (!introduced) {
        introduced = true;
        if (r.mode === 'race' && t < r.lightsFrom - 1) say(['intro-race'], 2, 3);
        else if (r.mode === 'trial') say(['intro-trial'], 2, 3);
      }
      if (r.mode === 'race' && t < 0) return;
      const mine = locals();

      for (const me of mine) {
        if (me.out) continue;
        const s = stateOf(r, me);
        const car = me.car;
        const speed = Math.hypot(car.vx, car.vy);
        const pos = posOf(r, me);

        // spins and lock-ups
        const isSpun = spun(r, me);
        if (isSpun && !s.wasSpun && ready(r, 'spin', 8)) say(about(me, ['spin']), 2, 1.5);
        s.wasSpun = isSpun;
        if (car.brake > 0.4 && car.vx > 25 && (car.wheels[0].slipX < -0.5 || car.wheels[1].slipX < -0.5) && ready(r, 'lockup', 25)) say(about(me, ['lockup']), 1, 1.5);
        if (car.vx * 3.6 > 330 && ready(r, 'top-speed', 240)) say(['top-speed'], 0, 2);
        s.tow = car.tow > 0.5 && car.vx > 65 ? s.tow + dt : 0;
        if (s.tow > 1.5 && ready(r, 'tow', 90)) say(about(me, ['tow']), 0, 2);
        if (r.mode !== 'race' || me.fin !== null) continue;

        // the start and the first chicane
        if (!s.start && me.lap === 0 && car.s > 700 && car.s < 1500) {
          s.start = true;
          s.called = pos;
          const gained = s.grid - pos;
          say(about(me, [pos === 1 && s.grid === 1 ? 'start-lead' : gained >= 1 ? 'start-good' : gained <= -2 ? 'start-bad' : 'start-hold']), 1, 3);
        }
        if (s.start && !firstChicaneSaid && solo() && car.s > 950 && car.s < 1800 && quiet() > 0.4) {
          firstChicaneSaid = true;
          say([contactsAtStart > 0 ? 'turn1-contact' : 'turn1-clean'], 0, 2);
        }

        // places won and lost, once they have held for a moment
        if (pos !== s.pos) {
          s.pos = pos;
          s.since = 0;
        } else s.since += dt;
        if (s.start && s.since > 1.2 && pos !== s.called && !isSpun) {
          const was = s.called;
          s.called = pos;
          const behind = r.runners[r.order[pos]];
          const ahead = r.runners[r.order[pos - 2]];
          if (pos === 1) say(about(me, ['lead']), 2, 2.5);
          else if (was === 1) say(about(me, ['lost-lead', `down-${pos}`]), 2, 2.5);
          else if (pos < was) say(about(me, random() < 0.5 && was - pos === 1 && nameOf(behind) ? ['past', nameOf(behind), `up-${pos}`] : ['pass', `up-${pos}`]), 1, 2.5);
          else if (pos - was <= 2) say(random() < 0.5 && pos - was === 1 && nameOf(ahead) ? [nameOf(ahead), 'gets-by', ...about(me, [`down-${pos}`])] : about(me, ['passed-by', `down-${pos}`]), 1, 2.5);
        }

        // battles: catching the car ahead, defending from the one behind (once the pack has spread out after the start)
        if (!s.start) continue;
        const ahead = r.runners[r.order[pos - 2]];
        const behind = r.runners[r.order[pos]];
        const gapAhead = ahead ? gap(ahead, me) : Infinity;
        const gapBehind = behind ? gap(me, behind) : Infinity;
        if ((ahead?.idx ?? -1) !== s.ahead) {
          s.ahead = ahead?.idx ?? -1;
          s.gapAhead.length = 0;
        }
        s.gapAhead.push(gapAhead);
        if (s.gapAhead.length > 600) s.gapAhead.shift();
        const earlier = s.gapAhead[0];
        if (ahead && gapAhead < 0.9 && earlier > 1.5 && ready(r, 'closing', 35)) {
          say(random() < 0.5 && nameOf(ahead) ? [nameOf(ahead), 'pressure'] : about(me, ['closing-in']), 1, 2);
          s.gapAhead.length = 0;
        }
        s.close = gapBehind < 0.5 ? s.close + dt : 0;
        if (s.close > 3 && ready(r, 'defending', 40)) {
          s.defended = true;
          say(about(me, ['defending']), 1, 2);
        }
        if (s.defended && gapBehind > 2) {
          s.defended = false;
          say(about(me, ['breathing-space']), 0, 2);
        }
      }

      if (r.mode === 'race') {
        // the race up front: a new leader, and a spin for someone near the front
        const lead = r.runners[r.order[0]];
        if (lead && lead.idx !== leader.idx) leader = { idx: lead.idx, since: 0, called: leader.called };
        else leader.since += dt;
        if (lead && leader.since > 2 && leader.called !== lead.idx) {
          if (leader.called !== -1 && t > 15 && !local(lead.idx)) say([nameOf(lead), 'takes-lead'], 1, 3);
          leader.called = lead.idx;
        }
        for (const rn of r.runners) {
          if (local(rn.idx) || rn.out || rn.entry.kind === 'remote') continue;
          const isSpun = spun(r, rn);
          if (isSpun && !aiSpun.has(rn.idx) && posOf(r, rn) <= 10 && t > 10 && ready(r, 'ai-spin', 40)) say([nameOf(rn), 'has-spun'], 1, 2);
          if (isSpun) aiSpun.add(rn.idx);
          else aiSpun.delete(rn.idx);
        }
      }

      // the quiet moments: talk about the circuit, the corner coming up, the race up front
      if (quiet() < fillAfter || (r.mode === 'race' && t < 25)) return;
      fillAfter = 9 + random() * 8;
      const me = mine[0];
      if (!me) return;
      const corner = cornerAhead(r, me.car.s);
      const pos = posOf(r, me);
      const lead = r.runners[r.order[0]];
      const hot = Math.max(me.car.wheels[2].temp, me.car.wheels[3].temp) > 118;
      const cold = me.car.wheels.some((w) => w.temp < 70);
      if (corner && LINES[`corner-${corner}`] && ready(r, `corner-${corner}`, 150)) return say([`corner-${corner}`], 0, 1.5);
      if (hot && ready(r, 'tyres-hot', 120)) return say(about(me, ['tyres-hot']), 0, 2);
      if (cold && me.laps.length === 0 && ready(r, 'tyres-cold', 600)) return say(about(me, ['tyres-cold']), 0, 2);
      if (r.mode === 'race') {
        if (me.lap > 0 && ready(r, 'status', 110)) {
          const n = r.order.length;
          const status = pos === 1 ? 'status-lead' : pos <= 3 ? 'status-podium' : pos <= 10 ? 'status-points' : pos <= 13 && n > 12 ? 'status-close' : 'status-back';
          return say(about(me, [status]), 0, 2);
        }
        if (pos > 1 && lead && nameOf(lead) && ready(r, 'leads', 80)) return say([nameOf(lead), 'leads'], 0, 2);
        for (let k = 0; k + 1 < Math.min(10, r.order.length); k++) {
          const a = r.runners[r.order[k]];
          const b = r.runners[r.order[k + 1]];
          if (local(a.idx) || local(b.idx) || !nameOf(a) || !nameOf(b) || gap(a, b) > 0.5) continue;
          if (ready(r, 'battle', 90)) return say(['battle', nameOf(a), 'and', nameOf(b)], 0, 2);
        }
        const ahead = r.runners[r.order[pos - 2]];
        const behind = r.runners[r.order[pos]];
        if ((!ahead || gap(ahead, me) > 3) && (!behind || gap(me, behind) > 3) && ready(r, 'lonely', 150)) return say(about(me, ['lonely']), 0, 2);
      }
      say([r.mode === 'trial' && random() < 0.5 ? 'colour-trial' : 'colour'], 0, 2);
    },
  };
}

/** How long after one line ends before the next may start, so the commentator breathes between them. */
const BREATH = 0.35;

export type Voice = { speak: Speak; quiet: () => number; silence: () => void; dispose: () => void };

/**
 * Plays the recorded lines through `out`, one at a time: a new line waits for the current one (or replaces a waiting
 * line that matters less), a big moment cuts in, and a line that has waited past its moment is dropped. `duck` dips
 * the race sound while the commentator talks.
 */
export function createVoice(io: { ctx: BaseAudioContext; out: AudioNode; duck: (on: boolean) => void }): Voice {
  const { ctx, out, duck } = io;
  const files = new Map<string, Promise<ArrayBuffer>>();
  const load = (clip: string) => {
    let f = files.get(clip);
    if (!f) {
      const [, key, n] = /^(.*)-(\d+)$/.exec(clip) ?? [];
      f = fetch(CLIP_DIR + clipFile(key, Number(n))).then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(clip))));
      f.catch(() => files.delete(clip));
      files.set(clip, f);
    }
    return f.then((b) => ctx.decodeAudioData(b.slice(0)));
  };
  type Req = { clips: string[]; priority: Priority; at: number; stale: number };
  const now = () => performance.now() / 1000;
  let current: { priority: Priority; sources: AudioBufferSourceNode[] } | null = null;
  let loading: Req | null = null;
  let pending: Req | null = null;
  let lastEnd = now();
  let disposed = false;
  let timer = 0;

  const next = () => {
    window.clearTimeout(timer);
    if (disposed || current || loading || !pending) return;
    const wait = BREATH - (now() - lastEnd);
    if (wait > 0) {
      timer = window.setTimeout(next, wait * 1000);
      return;
    }
    const p = pending;
    pending = null;
    if (now() - p.at <= p.stale) start(p);
    else next();
  };
  const start = (req: Req) => {
    loading = req;
    Promise.all(req.clips.map(load))
      .then((bufs) => {
        if (loading !== req || disposed) return;
        loading = null;
        if (now() - req.at > req.stale + 0.5) return next();
        let t = ctx.currentTime + 0.03;
        const sources = bufs.map((buf) => {
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.connect(out);
          src.start(t);
          t += buf.duration + 0.06;
          return src;
        });
        const mine = { priority: req.priority, sources };
        current = mine;
        duck(true);
        sources[sources.length - 1].onended = () => {
          if (current !== mine) return;
          current = null;
          lastEnd = now();
          duck(false);
          next();
        };
      })
      .catch(() => {
        if (loading === req) loading = null;
        next();
      });
  };
  const stop = () => {
    for (const s of current?.sources ?? []) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        /* not started yet */
      }
    }
    current = null;
    loading = null;
    duck(false);
  };

  // the start of a race is said straight away, so have those lines ready before it begins
  for (const key of ['intro-race', 'intro-trial', 'lights', 'go', 'start-lead', 'start-good', 'start-bad', 'start-hold', 'turn1-clean', 'turn1-contact']) {
    LINES[key]?.forEach((_, n) => void load(`${key}-${n}`).catch(() => {}));
  }

  return {
    speak(clips, priority, stale = 2.5) {
      if (disposed) return;
      const req = { clips, priority, at: now(), stale };
      if (priority === 3 && (current?.priority ?? loading?.priority ?? 0) < 3) {
        stop();
        pending = null;
        lastEnd = 0;
        start(req);
        return;
      }
      if (current || loading || now() - lastEnd < BREATH) {
        if (!pending || priority >= pending.priority) pending = req;
        next();
        return;
      }
      start(req);
    },
    quiet: () => (current || loading ? 0 : now() - lastEnd),
    silence() {
      pending = null;
      stop();
      lastEnd = now();
    },
    dispose() {
      disposed = true;
      window.clearTimeout(timer);
      pending = null;
      stop();
    },
  };
}
