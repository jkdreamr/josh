import { sfx } from '../../kit';

export type TennisAudio = ReturnType<typeof createAudio>;

export function createAudio() {
  const crowd = window.setInterval(() => sfx.noise(0.36, 0.012), 3200);
  return {
    hit(speed: number, kind: 'drive' | 'slice' | 'lob') {
      const pitch = Math.max(0.72, Math.min(1.42, speed / 42));
      sfx.tone({ freq: kind === 'slice' ? 178 : kind === 'lob' ? 142 : 235, to: 74, dur: 0.08 + pitch * 0.025, type: 'triangle', vol: Math.min(0.23, 0.09 + pitch * 0.08) });
      sfx.noise(0.018, 0.055);
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
    },
  };
}
