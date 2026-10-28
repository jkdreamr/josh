import { sfx } from '../../kit';
import type { ShotKind } from './logic.ts';

export type TennisAudio = ReturnType<typeof createAudio>;

export function createAudio() {
  let context: AudioContext | null = null;
  let noiseBuffer: AudioBuffer | null = null;
  const filteredNoise = (start: number, end: number, duration: number, volume: number, type: BiquadFilterType = 'bandpass') => {
    const AudioContextClass = window.AudioContext;
    if (!AudioContextClass) return;
    context ??= new AudioContextClass();
    if (context.state === 'suspended') void context.resume().catch(() => {});
    if (!noiseBuffer) {
      noiseBuffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
      const samples = noiseBuffer.getChannelData(0);
      for (let index = 0; index < samples.length; index++) samples[index] = Math.random() * 2 - 1;
    }
    const now = context.currentTime;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = noiseBuffer;
    filter.type = type;
    filter.frequency.setValueAtTime(start, now);
    filter.frequency.exponentialRampToValueAtTime(Math.max(30, end), now + duration);
    filter.Q.value = type === 'bandpass' ? 0.7 : 0.5;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(volume, now + Math.min(0.12, duration * 0.25));
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(context.destination);
    source.start(now);
    source.stop(now + duration);
  };
  const crowd = window.setInterval(() => sfx.noise(0.36, 0.012), 3200);
  return {
    hit(speed: number, kind: ShotKind, perfect = false) {
      const pitch = Math.max(0.72, Math.min(1.42, speed / 42));
      const frequency = kind === 'slice' ? 178
        : kind === 'lob' ? 142
          : kind === 'drop' ? 120
            : kind === 'flat' ? 305
              : kind === 'smash' ? 285
                : kind === 'volley' ? 245 : 235;
      sfx.tone({ freq: frequency, to: perfect ? 58 : 74, dur: (0.08 + pitch * 0.025) * (perfect ? 1.25 : 1), type: perfect ? 'sawtooth' : 'triangle', vol: Math.min(0.3, (perfect ? 0.16 : 0.09) + pitch * 0.09) });
      sfx.noise(perfect ? 0.045 : 0.018, perfect ? 0.095 : 0.055);
      if (perfect) filteredNoise(2200, 420, 0.12, 0.035, 'highpass');
    },
    ooh() {
      filteredNoise(820, 300, 1.3, 0.075, 'bandpass');
    },
    cheer() {
      filteredNoise(1600, 420, 1.05, 0.12, 'bandpass');
      sfx.tone({ freq: 430, to: 720, dur: 0.22, type: 'triangle', vol: 0.09 });
      sfx.noise(0.22, 0.18);
    },
    bounce(inCourt: boolean, line: boolean) {
      sfx.tone({ freq: line ? 970 : 620, to: 230, dur: 0.045, type: 'triangle', vol: inCourt ? 0.13 : 0.085 });
      sfx.noise(0.022, line ? 0.09 : 0.045);
    },
    net() {
      sfx.noise(0.085, 0.13);
      sfx.tone({ freq: 210, to: 90, dur: 0.1, type: 'triangle', vol: 0.12 });
    },
    call(name: string) {
      if (name === 'game' || name === 'set' || name === 'match') sfx.play('win');
      else if (name === 'double fault') sfx.play('lose');
      else sfx.play('tick');
    },
    dispose() {
      window.clearInterval(crowd);
      void context?.close();
    },
  };
}
