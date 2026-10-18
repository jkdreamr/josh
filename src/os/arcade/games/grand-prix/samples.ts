// Recorded engine loops. Each is a seamless loop of a real engine held at one rpm, either on the throttle (under
// load) or off it (overrun). The engine sound crossfades between the two loops nearest the simulated rpm and
// pitches them to it exactly, blending the on and off sets with the throttle. Files live in
// public/sounds/grand-prix/ with their license and source in CREDITS.md there. Pure module, testable under node.

export type EngineSample = {
  /** Path under the site root. */
  url: string;
  /** The engine speed the loop was recorded at. */
  rpm: number;
  /** On the throttle, or lifted off it. */
  load: 'on' | 'off';
  /** Relative loudness correction, 1 by default. */
  gain?: number;
};

/** The loops in use. Empty until recordings are added, and the synthesized engine plays instead. */
export const ENGINE_SAMPLES: EngineSample[] = [];

/** How far loops may be pitched from the rpm they were recorded at before they sound unnatural. */
const MIN_RATE = 0.4;
const MAX_RATE = 2.5;

export type Layer = { index: number; gain: number; rate: number };

/**
 * The gain and playback rate of every loop for an engine at `rpm` with `load` (0 off the throttle, 1 flat out).
 * Within each set the two loops either side of the rpm crossfade at equal power; beyond the ends the nearest loop
 * carries on alone. The on and off sets crossfade with the load the same way.
 */
export function layersFor(samples: readonly EngineSample[], rpm: number, load: number): Layer[] {
  const out: Layer[] = samples.map((s, index) => ({ index, gain: 0, rate: clampRate(rpm / s.rpm) }));
  const sets = { on: [] as number[], off: [] as number[] };
  samples.forEach((s, i) => sets[s.load].push(i));
  const l = Math.max(0, Math.min(1, load));
  const hasOff = sets.off.length > 0;
  const hasOn = sets.on.length > 0;
  // a missing set is covered by the other one
  const share = { on: hasOff ? Math.sin((l * Math.PI) / 2) : 1, off: hasOn ? Math.cos((l * Math.PI) / 2) : 1 };
  for (const key of ['on', 'off'] as const) {
    const idx = sets[key].slice().sort((a, b) => samples[a].rpm - samples[b].rpm);
    if (!idx.length) continue;
    const w = share[key];
    if (rpm <= samples[idx[0]].rpm) {
      out[idx[0]].gain += w;
      continue;
    }
    if (rpm >= samples[idx[idx.length - 1]].rpm) {
      out[idx[idx.length - 1]].gain += w;
      continue;
    }
    for (let k = 0; k < idx.length - 1; k++) {
      const a = samples[idx[k]];
      const b = samples[idx[k + 1]];
      if (rpm >= a.rpm && rpm <= b.rpm) {
        const t = (rpm - a.rpm) / (b.rpm - a.rpm);
        out[idx[k]].gain += w * Math.cos((t * Math.PI) / 2);
        out[idx[k + 1]].gain += w * Math.sin((t * Math.PI) / 2);
        break;
      }
    }
  }
  for (const layer of out) layer.gain *= samples[layer.index].gain ?? 1;
  return out;
}

const clampRate = (r: number) => Math.max(MIN_RATE, Math.min(MAX_RATE, r));
