// The race announcer: a commentator calling the moments that matter to the local drivers (lights out, places won and
// lost, fastest laps, penalties, the last lap and the flag), spoken by the browser's speech synthesis. The calls are a
// pure module, testable under node; the voice keeps to one line at a time and drops lines that have gone stale.
import type { Race, RaceEvent, Runner } from './race.ts';

/** 1 colour, 2 news, 3 the big moments (they cut in over anything less). */
export type Say = (text: string, priority: 1 | 2 | 3) => void;

/** A lap time the way a commentator reads it: "1 31 point 4". */
export function spokenTime(t: number) {
  const all = Math.round(t * 10);
  const m = Math.floor(all / 600);
  const tenths = all - m * 600;
  const s = Math.floor(tenths / 10);
  const sec = m > 0 && s < 10 ? `oh ${s}` : `${s}`;
  return `${m > 0 ? `${m} ` : ''}${sec} point ${tenths % 10}`;
}

const surname = (name: string) => name.split(/\.\s*/).pop() ?? name;

export type Commentary = {
  /** One race event. */
  event: (r: Race, e: RaceEvent) => void;
  /** Every frame: follows the local drivers' places. */
  update: (r: Race, dt: number) => void;
};

/**
 * Calls for the local drivers `locals` (one alone is "you"; in split screen they are called by name). Places are
 * called once they have held for a moment, so a swap back and forth through a corner is not called twice.
 */
export function createCommentary(locals: () => Runner[], say: Say): Commentary {
  const called = new Map<number, number>();
  const seen = new Map<number, { pos: number; since: number }>();
  let lastHit = -Infinity;
  const who = (rn: Runner, solo: string, named: string) => (locals().length > 1 ? named.replace('$', rn.entry.name) : solo);
  const local = (idx: number) => locals().find((p) => p.idx === idx) ?? null;

  return {
    event(r, e) {
      switch (e.t) {
        case 'go':
          if (r.mode === 'race') say(r.laps === 1 ? 'Lights out, and away we go!' : `Lights out, and away we go! ${r.laps} laps of Monza.`, 3);
          break;
        case 'lap': {
          const rn = r.runners[e.idx];
          const me = local(e.idx);
          if (r.mode === 'trial') {
            if (me && e.best) say(`${who(me, 'Personal best', '$, personal best')}. ${spokenTime(e.lap.time)}.`, 2);
            else if (me && !e.lap.valid) say('That lap will not count.', 1);
            break;
          }
          // fastest laps from the second lap on (the first is from a standing start)
          if (e.overall && rn.laps.length >= 2 && rn.fin === null && rn.lap < r.laps) {
            say(me ? `${who(me, 'Fastest lap for you', 'Fastest lap for $')}! ${spokenTime(e.lap.time)}.` : `Fastest lap goes to ${surname(rn.entry.name)}. ${spokenTime(e.lap.time)}.`, me ? 2 : 1);
          }
          if (me && rn.lap === r.laps - 1 && r.laps > 1 && rn.fin === null) {
            const pos = r.order.indexOf(e.idx) + 1;
            say(`${who(me, 'Final lap', '$, final lap')}. ${pos === 1 ? 'Leading the race.' : `Running P${pos}.`}`, 2);
          }
          break;
        }
        case 'limits': {
          const me = local(e.idx);
          if (!me || r.mode !== 'race' || e.reset) break;
          if (e.penalty) say(`${who(me, 'That is a five second penalty', 'Five second penalty for $')}. Track limits.`, 2);
          else if (e.warnings === 3) say(`${who(me, 'Final warning', 'Final warning for $')} for track limits.`, 1);
          break;
        }
        case 'wall':
        case 'contact': {
          const hit = e.t === 'wall' ? local(e.idx) : (local(e.idx) ?? local(e.other));
          if (!hit || e.speed < 12 || r.time - lastHit < 20) break;
          lastHit = r.time;
          say(e.t === 'wall' ? 'Oh, a big hit on the barrier!' : 'Contact! They touched there.', 1);
          break;
        }
        case 'finish': {
          const me = local(e.idx);
          const rn = r.runners[e.idx];
          if (me) {
            if (e.place === 1 && e.penalty === 0) say(`Chequered flag, and ${who(me, 'you win it', '$ wins it')}! What a drive.`, 3);
            else if (e.penalty) say(`Chequered flag. P${e.place} on the road, with a ${e.penalty} second penalty to come.`, 3);
            else say(`Chequered flag. ${who(me, 'You finish', '$ finishes')} P${e.place}.`, 3);
          } else if (e.place === 1) say(`${surname(rn.entry.name)} takes the chequered flag.`, 2);
          break;
        }
      }
    },
    update(r, dt) {
      if (r.mode !== 'race' || r.time < 4) return;
      for (const me of locals()) {
        if (me.fin !== null || me.out) continue;
        const pos = r.order.indexOf(me.idx) + 1;
        const s = seen.get(me.idx);
        if (!s || s.pos !== pos) {
          seen.set(me.idx, { pos, since: 0 });
          continue;
        }
        s.since += dt;
        const was = called.get(me.idx);
        if (was === undefined) {
          called.set(me.idx, pos);
          continue;
        }
        if (s.since < 1.5 || was === pos) continue;
        called.set(me.idx, pos);
        const n = r.order.length;
        if (pos === 1) say(`${who(me, 'And you take the lead', '$ takes the lead')}!`, 2);
        else if (was === 1) say(`${who(me, 'You lose the lead', '$ loses the lead')}. Down to P${pos}.`, 2);
        else if (pos < was) say(`${who(me, 'Up to', '$ up to')} P${pos}${pos <= 3 && was > 3 ? ', into the podium places' : ''}.`, 1);
        else if (pos === n) say(`${who(me, 'Down to the back', '$ drops to the back')}.`, 1);
        else say(`${who(me, 'Down to', '$ down to')} P${pos}.`, 1);
      }
    },
  };
}

/** How long after one line starts before the next one may, unless it matters more. */
const GAP = 5;
/** A line that has waited this long is old news. */
const STALE = 4;

export type Voice = { say: Say; tick: () => void; setMuted: (m: boolean) => void; silence: () => void; dispose: () => void };

/** Speaks lines through speechSynthesis, one at a time; null where the browser has no speech. */
export function createVoice(): Voice | null {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
  if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return null;
  let voice: SpeechSynthesisVoice | null = null;
  const pick = () => {
    const all = synth.getVoices().filter((v) => v.lang.toLowerCase().startsWith('en'));
    const gb = all.filter((v) => v.lang.toLowerCase().replace('_', '-') === 'en-gb');
    // a British male voice where there is one: the sound of a race broadcast
    voice = gb.find((v) => /daniel|arthur|male|george|oliver/i.test(v.name)) ?? gb[0] ?? all.find((v) => v.default) ?? all[0] ?? null;
  };
  pick();
  synth.addEventListener?.('voiceschanged', pick);
  const now = () => performance.now() / 1000;
  let muted = false;
  let current: { priority: number; at: number } | null = null;
  let pending: { text: string; priority: number; at: number } | null = null;
  let lastStart = -Infinity;

  const speak = (text: string, priority: number) => {
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.lang = voice?.lang ?? 'en-GB';
    u.rate = 1.08;
    u.pitch = 0.95;
    u.volume = 0.9;
    const mine = { priority, at: now() };
    u.onend = u.onerror = () => {
      if (current === mine) current = null;
    };
    current = mine;
    lastStart = mine.at;
    synth.speak(u);
  };
  const busy = () => (current !== null && now() - current.at < 12) || now() - lastStart < GAP;

  return {
    say(text, priority) {
      if (muted) return;
      if (priority === 3 && (current?.priority ?? 0) < 3) {
        synth.cancel();
        current = null;
        pending = null;
        speak(text, priority);
        return;
      }
      if (!busy()) speak(text, priority);
      else if (!pending || priority >= pending.priority) pending = { text, priority, at: now() };
    },
    tick() {
      if (!pending) return;
      if (now() - pending.at > STALE) pending = null;
      else if (!busy()) {
        const p = pending;
        pending = null;
        speak(p.text, p.priority);
      }
    },
    setMuted(m) {
      muted = m;
      if (m) this.silence();
    },
    silence() {
      pending = null;
      current = null;
      synth.cancel();
    },
    dispose() {
      this.silence();
      synth.removeEventListener?.('voiceschanged', pick);
    },
  };
}
