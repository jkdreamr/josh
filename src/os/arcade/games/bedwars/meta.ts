import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'bedwars',
  title: 'Bed Wars',
  blurb: 'Minecraft Bed Wars over a floating Stanford campus. Bridge out, buy gear, guard your bed and break everyone else’s. Solo or doubles, bots or friends.',
  category: '3d',
  players: '1-8P',
  controls: 'Click to aim with the mouse. WASD move, Space jump, Shift crouch. Left click hits and breaks, right click places and uses. 1 to 9 pick items, E or B shops by the keeper, Tab shows players.',
  accent: '#8c1515',
  glyph: 'M3 6v13M3 13h18v6M3 16.5h18M6 13v-1.5a1.5 1.5 0 0 1 1.5-1.5h3a1.5 1.5 0 0 1 1.5 1.5V13M21 19v-6',
  order: 1,
  online: { seats: 8, lateJoin: true },
};
