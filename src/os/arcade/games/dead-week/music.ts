// The round's beat: a little boom-bap that gets faster with each speed tier. A scheduler over the arcade synth,
// queued a little ahead against the audio clock (like Palm Drive's soundtrack), so a pause or mute never bunches it up.
export const bpmOf = (tier: number) => 104 + Math.min(9, tier) * 9;

export type BeatVoice = { kind: 'kick' | 'snare' | 'hat' | 'bass' | 'blip'; freq: number };
const BASS = [55, 55, 65.4, 49];
const BLIPS = [523.3, 659.3, 784, 659.3];

/** What plays on a 16th step of a bar (0..15), bar counting up from 0. */
export function stepVoices(step: number, bar: number, tier: number): BeatVoice[] {
  const v: BeatVoice[] = [];
  if (step === 0 || step === 8 || step === 10) v.push({ kind: 'kick', freq: 0 });
  if (step === 4 || step === 12) v.push({ kind: 'snare', freq: 0 });
  if (step % 2 === 0 || tier >= 3) v.push({ kind: 'hat', freq: 0 });
  if (step === 0 || step === 6 || step === 8 || step === 14) v.push({ kind: 'bass', freq: BASS[bar % 4] });
  if (tier >= 1 && (step === 3 || step === 11)) v.push({ kind: 'blip', freq: BLIPS[(bar + (step > 8 ? 1 : 0)) % 4] * (tier >= 5 ? 2 : 1) });
  return v;
}

export class Beat {
  private next = -1;
  private step = 0;
  /** Queue up what falls in the next `ahead` seconds. play(voice, delay) sounds it `delay` seconds from now. */
  tick(now: number | null, tier: number, play: (voice: BeatVoice, delay: number, len: number) => void, ahead = 0.15) {
    if (now === null) {
      this.next = -1;
      return;
    }
    const len = 60 / bpmOf(tier) / 4;
    if (this.next < now - 0.1) this.next = now + 0.05;
    while (this.next < now + ahead) {
      for (const voice of stepVoices(this.step % 16, Math.floor(this.step / 16), tier)) play(voice, this.next - now, len);
      this.next += len;
      this.step++;
    }
  }
  reset() {
    this.next = -1;
    this.step = 0;
  }
}
