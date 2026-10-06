import { useSyncExternalStore } from 'react';

export type SfxName = 'blip' | 'select' | 'jump' | 'coin' | 'hit' | 'boom' | 'win' | 'lose' | 'tick';
export type Tone = { freq: number; to?: number; dur?: number; type?: OscillatorType; vol?: number; delay?: number };

const MUTE_KEY = 'arcade:muted';
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = (() => {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
})();
const subs = new Set<() => void>();

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  return ctx;
}

function tone({ freq, to, dur = 0.12, type = 'square', vol = 0.18, delay = 0 }: Tone) {
  if (muted) return;
  const ac = audio();
  if (!ac || !master) return;
  const t = ac.currentTime + delay;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur = 0.25, vol = 0.25) {
  if (muted) return;
  const ac = audio();
  if (!ac || !master) return;
  const len = Math.max(1, Math.floor(ac.sampleRate * dur));
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ac.createBufferSource();
  const g = ac.createGain();
  g.gain.value = vol;
  src.buffer = buf;
  src.connect(g).connect(master);
  src.start();
}

const presets: Record<SfxName, (p: number) => void> = {
  blip: (p) => tone({ freq: 660 * p, dur: 0.05, vol: 0.12 }),
  select: (p) => tone({ freq: 520 * p, to: 880 * p, dur: 0.08, type: 'triangle', vol: 0.2 }),
  tick: (p) => tone({ freq: 1200 * p, dur: 0.025, type: 'triangle', vol: 0.1 }),
  jump: (p) => tone({ freq: 300 * p, to: 720 * p, dur: 0.14, vol: 0.14 }),
  coin: (p) => {
    tone({ freq: 988 * p, dur: 0.06, vol: 0.14 });
    tone({ freq: 1319 * p, dur: 0.16, vol: 0.14, delay: 0.06 });
  },
  hit: (p) => tone({ freq: 220 * p, to: 90 * p, dur: 0.12, type: 'sawtooth', vol: 0.18 }),
  boom: () => noise(0.35, 0.3),
  win: (p) => [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f * p, dur: 0.14, type: 'triangle', vol: 0.18, delay: i * 0.09 })),
  lose: (p) => tone({ freq: 392 * p, to: 98 * p, dur: 0.5, type: 'triangle', vol: 0.2 }),
};

export const sfx = {
  /** Play a preset. pitch multiplies the frequencies (1 = default). */
  play(name: SfxName, pitch = 1) {
    presets[name](pitch);
  },
  tone,
  noise,
  /** Call from a user gesture (the shell's Play button already does) so iOS allows audio. */
  unlock() {
    if (!muted) audio();
  },
  isMuted: () => muted,
  setMuted(m: boolean) {
    muted = m;
    try {
      window.localStorage.setItem(MUTE_KEY, m ? '1' : '0');
    } catch {
      /* ignore */
    }
    subs.forEach((f) => f());
  },
  toggleMute() {
    sfx.setMuted(!muted);
  },
  subscribe(fn: () => void) {
    subs.add(fn);
    return () => {
      subs.delete(fn);
    };
  },
};

/** Reactive muted flag, shared by every game. */
export function useMuted(): [boolean, (m: boolean) => void] {
  const m = useSyncExternalStore(sfx.subscribe, sfx.isMuted, () => false);
  return [m, sfx.setMuted];
}
