import type { Slot, World } from './logic.ts';
import { TEAM_SIZE } from './logic.ts';
import { clubById, type ClubPlayer } from './teams.ts';

export const BASELINE = 75;
export type Multipliers = {
  speed: number;
  shotPower: number;
  shotSpread: number;
  passError: number;
  dribble: number;
  tackle: number;
  stamina: number;
  keeperReach: number;
  keeperReaction: number;
};
export const NEUTRAL_MULTIPLIERS: Multipliers = {
  speed: 1, shotPower: 1, shotSpread: 1, passError: 1, dribble: 1, tackle: 1, stamina: 1, keeperReach: 1, keeperReaction: 1,
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const deviation = (value: number) => clamp((value - BASELINE) / 20, -1, 1);

export function multipliersFor(player: ClubPlayer, slot: Slot): Multipliers {
  const d = (value: number) => deviation(value);
  const keeper = slot === 'GK' ? player.keeper : undefined;
  return {
    speed: 1 + 0.04 * d(player.pace),
    shotPower: 1 + 0.06 * d(player.shooting),
    shotSpread: 1 - 0.2 * d(player.shooting),
    passError: 1 - 0.2 * d(player.passing),
    dribble: 1 + 0.08 * d(player.dribbling),
    tackle: 1 + 0.15 * d(player.defending),
    stamina: 1 - 0.1 * d(player.physical),
    keeperReach: keeper ? 1 + 0.1 * d((keeper.diving + keeper.positioning) / 2) : 1,
    keeperReaction: keeper ? 1 - 0.15 * d(keeper.reflexes) : 1,
  };
}

type CachedWorld = { clubs: [string, string]; values: Multipliers[] };
const cache = new WeakMap<World, CachedWorld>();

export function worldMultipliers(world: World, playerId: number): Multipliers {
  if (!world.clubs) return NEUTRAL_MULTIPLIERS;
  let cached = cache.get(world);
  if (!cached || cached.clubs[0] !== world.clubs[0] || cached.clubs[1] !== world.clubs[1]) {
    cached = {
      clubs: [...world.clubs],
      values: world.players.map((player) => {
        const club = clubById(world.clubs![player.team]);
        return multipliersFor(club.players[player.id % TEAM_SIZE]!, player.slot);
      }),
    };
    cache.set(world, cached);
  }
  return cached.values[playerId] ?? NEUTRAL_MULTIPLIERS;
}
