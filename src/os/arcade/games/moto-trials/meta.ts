import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'moto-trials',
  title: 'Moto Trials',
  blurb: 'Ride a dirt bike over ramps, gaps and loops. Flip in the air to shave time off and land on your wheels.',
  category: 'arcade',
  players: '1P',
  controls: 'Up or W for gas, Down or S to brake, Left and Right lean back and forward. Flip in the air for time bonuses. On touch, use the buttons.',
  howTo: [
    "Ride from the start to the finish line as fast as you can.",
    "Lean back and forward to keep the bike balanced over ramps, gaps and loops.",
    "Bump your head, hit a saw, a mine or a TNT barrel, or fall off the track and you crash, then respawn at the last checkpoint you passed while the clock keeps running.",
    "Wooden bridges crumble right behind you, so keep the gas on and never stop on one.",
    "Hold gas and lean back on the ground for a wheelie. Some saws swing up and down, so time your run.",
    "Land a full flip on your wheels to knock a second off your time for each flip.",
    "Beat the bronze, silver and gold times to earn stars. Clearing a level unlocks the next one, across five worlds of six levels.",
  ],
  accent: '#ff6a2b',
  glyph: 'M4 17a3.5 3.5 0 1 0 7 0 3.5 3.5 0 0 0-7 0zm10 0a3.5 3.5 0 1 0 7 0 3.5 3.5 0 0 0-7 0zM7.5 17l3-5h4l3.5 5M10.5 12L8 7h3M17.5 17L14 9l-1.5-2.5',
  order: 8,
  music: 'drive',
  // race games may not use variant boards, so the one board ranks the Full Tour:
  // the sum of a rider's best time on every level. Online races post under a board
  // name the game does not have, so they never reach it; min also sits far above
  // any single level time.
  leaderboard: { order: 'asc', min: 600_000, max: 7_200_000, format: 'time', measure: 'Full Tour, Sum of Best Times' },
  online: { seats: 4, race: true },
};
