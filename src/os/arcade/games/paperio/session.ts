// Online rounds (filled in next).
import { localCtl, type Ctl, type Net } from './ctl.ts';
import { createMatch } from './match.ts';
import type { Level } from './bots.ts';

export function createOnline(net: Net, opts: { skin: number; fill: number; level: Level; length: number }): Ctl {
  const m = createMatch({ seed: 1, humans: [{ name: 'you', skin: opts.skin, kind: 'local', seat: net.seat }], bots: 4, level: opts.level, respawn: true, duration: opts.length * 60 });
  return localCtl(m, [0]);
}
