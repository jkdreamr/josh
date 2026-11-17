// The Setup's Sky choice: the time of day a royale plays at (see looks.ts).
import { Segmented, defineSetting, useSetting } from '../../kit';

/** Auto lets each royale pick (day half the time, dusk or overcast a quarter each); the others always play at that time
 * of day. Online the host's choice holds for everyone in the room. Breach and deathmatch always play by day. */
export const SKY = defineSetting('ridgeline:sky', ['auto', 'day', 'dusk', 'overcast'] as const, 'auto');

const skyOptions = [
  ['auto', 'Auto'],
  ['day', 'Day'],
  ['dusk', 'Dusk'],
  ['overcast', 'Overcast'],
] as const;

export function SkySetting() {
  const [sky, setSky] = useSetting(SKY);
  return <Segmented label="Sky" value={sky} options={skyOptions} onChange={setSky} />;
}
