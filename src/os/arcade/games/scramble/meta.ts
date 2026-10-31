import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'scramble',
  title: 'Scramble',
  blurb: 'An egg battle royale for fifty eggs, solo, in duos or in squads: press Play to drop in with whoever is online, computer eggs filling the rest, or bring up to twenty friends. Jump from the bus, raid the kitchen drawer for guns (miniguns and flare guns too), throwables, frying pans and pots and aprons to wear, build Fortnite style (walls, ramps, floors and roofs in wood, stone and metal, boxed up or ramped up for the high ground), drive off in cars and pickups (run eggs over, and get out before yours blows up) and be the last egg (or team) standing as the storm closes in, reviving teammates who get knocked down.',
  category: '3d',
  players: '1-20P',
  controls: 'Pick solo, duos or squads, then Play joins the next match with whoever is online, Play with Bots is just you and computer eggs (your teammates too). WASD walks, the mouse aims, click shoots or throws. Space jumps from the bus and builds (twice quickly boxes you in), Z X C V B build a wall, ramp, floor, roof or box, N switches material, F edits your wall, E picks up, opens chests, fridges and lockers, opens and shuts doors, and gets you into a car or a pickup and out again (WASD drives the way you want to go, Space is the handbrake, and passengers can shoot), R reloads, 1 to 4 switch weapons, 5 to 0 and T use items, H heals, G shields, O (or Shift with the wheel) switches between the scopes you carry (only the scope sets how far you see), M shows the map, holding the right button (or J) brings up the emote wheel, and walking onto a stairway takes you down to a cellar or bunker (and back up). In duos and squads, the wheel calls to your team (need meds, ammo or a gun, help, follow me, enemy here), hold E to revive a knocked teammate, Y or the middle button pings, U puts down what you hold. On touch, How to Play shows the buttons.',
  accent: '#7b3fd1',
  glyph: 'M12 2.5c-4 0-7 6.3-7 11a7 7 0 0 0 14 0c0-4.7-3-11-7-11zM8.5 12.5l2 1.6 1.6-2.2 1.9 1.7 1.6-1.4',
  order: 2,
  music: 'tension',
  // solo matches against forty-nine computer eggs, one board per difficulty: damage dealt, 100 an elimination, 500 a win
  leaderboard: { order: 'desc', max: 10_000, unit: 'pts', measure: 'Best Match vs Computer', variants: { easy: 'Easy', normal: 'Normal', hard: 'Hard' } },
  online: { seats: 20, lateJoin: true, bots: true, quick: true },
};
