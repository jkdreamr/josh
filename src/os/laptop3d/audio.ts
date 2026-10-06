/** Tiny synthesized sounds for the laptop: key clicks and the lid thud. The AudioContext is created on the first user gesture. */
export function createSounds() {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let noiseBuf: AudioBuffer | null = null;

  const ensure = () => {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.42;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => undefined);
    return ctx;
  };
  const noise = (c: AudioContext) => {
    if (!noiseBuf) {
      noiseBuf = c.createBuffer(1, Math.round(c.sampleRate * 0.25), c.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return noiseBuf;
  };
  const burst = (c: AudioContext, t: number, type: BiquadFilterType, freq: number, q: number, gain: number, dur: number) => {
    const src = c.createBufferSource();
    src.buffer = noise(c);
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    src.connect(f).connect(g).connect(master!);
    src.start(t);
    src.stop(t + dur + 0.02);
  };
  const tone = (c: AudioContext, t: number, f0: number, f1: number, gain: number, dur: number) => {
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.6);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(g).connect(master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  };

  return {
    /** Soft low-profile key: a bright transient plus a short "thock". Wide keys sound a little deeper. */
    key(down: boolean, wide = false) {
      const c = ensure();
      if (!c) return;
      const t = c.currentTime + 0.001;
      const jitter = 0.9 + Math.random() * 0.2;
      if (down) {
        burst(c, t, 'bandpass', (wide ? 1900 : 2700) * jitter, 1.1, 0.5, 0.03);
        tone(c, t, (wide ? 150 : 210) * jitter, wide ? 70 : 105, 0.32, 0.055);
      } else {
        burst(c, t, 'bandpass', (wide ? 2300 : 3300) * jitter, 1.4, 0.22, 0.022);
      }
    },
    /** Lid meeting the deck: a dull, mostly sub-200Hz bump. */
    thud() {
      const c = ensure();
      if (!c) return;
      const t = c.currentTime + 0.001;
      tone(c, t, 95, 42, 0.7, 0.22);
      burst(c, t, 'lowpass', 420, 0.7, 0.45, 0.09);
    },
    dispose() {
      ctx?.close().catch(() => undefined);
      ctx = null;
    },
  };
}
