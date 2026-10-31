import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'ridgeline',
  title: 'Ridgeline',
  blurb: 'Tactical 5v5 on big, realistic outdoor maps. Buy your loadout, take the uplink and win the round on one life. Real bullet drop, no powers, just aim.',
  category: '3d',
  players: '1P',
  controls: 'Click to capture the mouse. WASD move, Shift walk quietly, Space jump, C crouch, left click fire, right click aim, R reload, 1 2 guns, 3 frag, 4 smoke, B buy, Tab scores. On touch, drag the left side to move and the right side to look.',
  howTo: [
    'Uplink: your team of five against five bots. One life per round. The first team to win 7 rounds takes the match.',
    'Every round opens with a buy phase in your spawn. Spend credits on guns, armor, frags and smokes. Kills and rounds earn more, and a gun you survive with stays yours.',
    'One of three uplinks (A, B or C) goes live each round. Stand in it with no enemy inside to fill your bar. Fill it or knock out the other team to win the round.',
    'Guns are only accurate when you stand still. Running throws your shots wide, so stop, then shoot. Crouch and aim down sights for tighter groups, and pull down against the recoil when you spray.',
    'Bullets take time to fly and drop over distance: aim a touch high and lead moving targets far away. Headshots hit hardest, and armor soaks up part of every hit until it breaks.',
    'Deathmatch: everyone for themselves, any gun you like, quick respawns. First to 25 knockouts wins.',
    '3D models from Sketchfab, CC BY 4.0: soldier by ItsKrish7; M4A1, AK-47 and M67 by Nneako; MP5 by Rotuma; Desert Eagle by ELIZION; XD-MOD2 by Orshia 3D; Px4 Storm by Vlasov Daniil; RGD-5 by _Alexandr; Ural 4320 by Brout; BTR-80 and frying pan by GameDev Nick; barricade by Arthur.Zim; crate pile by Blender3D; barbed wire by Mehdi Shahsavan; dumpsters by bazz4r; fences by Erroratten; jerry cans by Liam3D; gas bottles by Gamefruit; propane tank by Oliver Triplett; helmet by Sergeydesign09; shield by sanyaork; cup by Kozlov Maksim. AWP by MKoegler3D, CC BY-NC 4.0.',
  ],
  accent: '#c8473b',
  glyph: 'M2 19l6-8 4 5 3-4 7 7zM17 2v5M14.5 4.5h5',
  order: 0,
  music: 'tension',
  leaderboard: {
    order: 'desc',
    max: 60_000,
    measure: 'Combat Score',
    variants: { 'uplink-easy': 'Uplink, Easy', 'uplink-normal': 'Uplink, Normal', 'uplink-hard': 'Uplink, Hard', 'dm-easy': 'Deathmatch, Easy', 'dm-normal': 'Deathmatch, Normal', 'dm-hard': 'Deathmatch, Hard' },
  },
};
