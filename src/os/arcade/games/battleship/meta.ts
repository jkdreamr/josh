import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'battleship',
  title: 'Broadside',
  blurb: 'Hide your fleet, then trade shots until one navy is gone. Three computer captains, pass and play, or online.',
  category: 'multiplayer',
  players: '1-2P',
  controls: 'Drag ships to place them, tap one to turn it. Then tap a square to fire. Arrows and Enter work too.',
  howTo: [
    "Place five ships on your grid: a Flagship of 5, a Frigate of 4, a Corvette and a Sub of 3, and a Patrol Boat of 2. Random lays them out for you.",
    "Take turns firing one shot at a time at the enemy grid, hit or miss.",
    "A ship sinks once every one of its squares is hit, and you're told which ship went down.",
    "Sink the whole enemy fleet first to win.",
    "Pick Easy, Normal or Hard against the computer. In pass and play, hand over the device when the cover screen asks.",
    "On touch, tap a square once to aim and tap it again to fire.",
  ],
  accent: '#0a84ff',
  glyph: 'M2 15h20l-3 4H5zM6 15v-3h9l3 3M9 12V8h4v4M11 8V5',
  order: 6,
  online: { seats: 2 },
};
