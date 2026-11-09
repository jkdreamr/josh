export type StatName = 'speed' | 'power' | 'control' | 'spin' | 'serve';
export type Stats = Record<StatName, number>;
export type Accessory = 'headband' | 'cap' | 'visor' | 'headphones' | 'beanie' | 'toque';

export type Character = {
  id: string;
  name: string;
  style: string;
  blurb: string;
  model: 'male' | 'female';
  shirt: string;
  shorts: string;
  skin: string;
  hair: string;
  acc: Accessory;
  accColor: string;
  stats: Stats;
};

export const STAT_NAMES: readonly StatName[] = ['speed', 'power', 'control', 'spin', 'serve'];
export const TEMPO_MAX = 5;

export const ROSTER = [
  {
    id: 'josh', name: 'Josh', style: 'All-around', blurb: 'Stanford alum and the home crowd favourite. Good at everything.',
    model: 'male', shirt: '#8c1515', shorts: '#f5f1e6', skin: '#d9a77f', hair: '#1b1512', acc: 'headband', accColor: '#f5f1e6',
    stats: { speed: 4, power: 4, control: 4, spin: 3, serve: 3 },
  },
  {
    id: 'cox', name: 'Cox', style: 'Speedy', blurb: 'Calls the stroke rate from the stern. Gets to every ball.',
    model: 'female', shirt: '#f5a524', shorts: '#1b1b1f', skin: '#e8be98', hair: '#3a2618', acc: 'cap', accColor: '#8c1515',
    stats: { speed: 5, power: 2, control: 4, spin: 3, serve: 2 },
  },
  {
    id: 'stroke', name: 'Stroke', style: 'Big server', blurb: 'Stroke seat in the eight. Pure leg drive on every serve.',
    model: 'male', shirt: '#f5f1e6', shorts: '#8c1515', skin: '#b98260', hair: '#2b1d14', acc: 'visor', accColor: '#8c1515',
    stats: { speed: 3, power: 5, control: 2, spin: 3, serve: 5 },
  },
  {
    id: 'beat', name: 'Beatmaker', style: 'Spin', blurb: 'Makes tracks at 2am. Every shot has a little groove on it.',
    model: 'female', shirt: '#6d3df2', shorts: '#1b1b1f', skin: '#8a5a3e', hair: '#141012', acc: 'headphones', accColor: '#d9f542',
    stats: { speed: 3, power: 3, control: 3, spin: 5, serve: 3 },
  },
  {
    id: 'go', name: '9-Dan', style: 'Control', blurb: 'Go player. Reads three shots ahead and puts it on the line.',
    model: 'male', shirt: '#1b1b1f', shorts: '#f5f1e6', skin: '#e2b994', hair: '#0f0d0c', acc: 'beanie', accColor: '#f5f1e6',
    stats: { speed: 4, power: 2, control: 5, spin: 3, serve: 2 },
  },
  {
    id: 'chef', name: 'Chef', style: 'Tricky', blurb: 'Cooks between sets. Serves up slices and soft drop shots.',
    model: 'male', shirt: '#00a558', shorts: '#f5f1e6', skin: '#c48d69', hair: '#4a3324', acc: 'toque', accColor: '#ffffff',
    stats: { speed: 3, power: 3, control: 4, spin: 4, serve: 3 },
  },
] as const satisfies readonly Character[];

export type CharacterId = (typeof ROSTER)[number]['id'];
export const CHARACTER_IDS = ROSTER.map((character) => character.id) as CharacterId[];
export const DEFAULT_CHARACTER: CharacterId = 'josh';

const byId = new Map<string, Character>(ROSTER.map((character) => [character.id, character]));
export const isCharacterId = (value: unknown): value is CharacterId => typeof value === 'string' && byId.has(value);
export const characterOf = (id: string | undefined): Character => byId.get(id ?? '') ?? ROSTER[0];

const NEUTRAL = 3;
const statOf = (id: string | undefined, stat: StatName) => (byId.get(id ?? '')?.stats[stat] ?? NEUTRAL) - NEUTRAL;
export const speedFactor = (id?: string) => 1 + statOf(id, 'speed') * 0.04;
export const powerFactor = (id?: string) => 1 + statOf(id, 'power') * 0.03;
export const spinFactor = (id?: string) => 1 + statOf(id, 'spin') * 0.12;
export const controlFactor = (id?: string) => 1 - statOf(id, 'control') * 0.15;
export const serveBonus = (id?: string) => statOf(id, 'serve') * 2.2;
export const tempoFactor = (tempo: number) => 1 + Math.max(0, Math.min(TEMPO_MAX, tempo)) * 0.02;

/** Picks the other seats' characters: the rival first, then partners, never repeating. */
export function lineup(mine: CharacterId, rival: CharacterId | 'random', count: number, random: () => number): CharacterId[] {
  const pool = CHARACTER_IDS.filter((id) => id !== mine);
  const take = (id?: CharacterId) => {
    const index = id && pool.includes(id) ? pool.indexOf(id) : Math.floor(random() * pool.length);
    return pool.splice(index, 1)[0] ?? DEFAULT_CHARACTER;
  };
  const picks: CharacterId[] = [mine, take(rival === 'random' ? undefined : rival)];
  while (picks.length < count) picks.push(take());
  return picks;
}

export const seatCharacter = (seat: number, round: number): CharacterId => CHARACTER_IDS[(seat + Math.max(0, round)) % CHARACTER_IDS.length]!;
