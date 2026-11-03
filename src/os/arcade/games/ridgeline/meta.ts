import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'ridgeline',
  title: 'Ridgeline',
  blurb: 'Tactical 5v5 on realistic outdoor maps: attack with the charge and plant it on a site, or hold the sites and defuse it. Buy rounds, one life, sides swap at the half. Also a 100 player Royale and Deathmatch. Real bullet drop, no powers, just aim.',
  category: '3d',
  players: '1-10P',
  controls: 'Click to capture the mouse. WASD move, Shift walk quietly, Space jump, C crouch, left click fire, right click (or hold Z) aim and scope, R reload, hold F (or E) to plant or defuse, B buy, 1 2 long guns and 3 sidearm (or the wheel), 4 or G frag, 5 or Q smoke, 6 or X flash, M map, Tab scores. Royale: walk over loot to take it (attachments go onto a gun they fit), F swaps the gun in hand, a backpack or a sight, H heal (a boost when no heal helps), X boost, 6 7 8 9 a bandage, med kit, drink or painkillers (or click them on the item bar), I your kit, 1 2 3 guns, Space jumps out and opens the canopy, F gets into a vehicle and out again (W S drive, A D steer, Space handbrake, the mouse looks round). On touch, drag the left side to move and the right side to look.',
  howTo: [
    'Breach: two teams of five. Play with bots, or online with friends (bots fill the empty seats, and take over for anyone who leaves). One life a round, first to 7 rounds wins, and the sides swap after round 6.',
    'Attacking, your team carries the charge. Get it onto site A or B and hold F on the site for 4 seconds to plant it. Once planted it goes off in 40 seconds: guard it. If its carrier falls, any attacker picks it up by walking over it.',
    'Defending, hold the two sites. Stop the plant, or get to the planted charge and hold F for 7 seconds to defuse it (half way, the progress is kept). Knocking out the whole other team also wins the round.',
    'Every round opens with a buy phase in your spawn. Spend credits on guns, armor, frags, smokes and flashbangs (turn away from a flash, or be blinded). Kills, plants and rounds earn more. Everything you buy stays yours for the whole match, even when you are knocked out, so you only buy once: carry two long guns and a sidearm.',
    'Your shots go where the crosshair is: the view never climbs when you fire. Holding the trigger opens the spread a little, and running throws shots wider, so for long shots walk (Shift) or stop, crouch and aim down sights.',
    'Bullets take time to fly and drop over distance: aim a touch high and lead moving targets far away. Headshots hit hardest, and armor soaks up part of every hit until it breaks.',
    'Royale: a hundred players, you and 99 bots. Jump out of the transport where you like, walk over guns, attachments, ammo, armor, backpacks, heals and boosts to take them (F swaps a gun once both slots are full), and stay inside the closing zone. The last one standing wins.',
    'Supply drops: after the zone closes, a crate comes down under a parachute and a blue smoke column marks it. Its gear lies on the ground round it once it lands: walk over it to take it. Your heals and boosts sit on the item bar at the bottom (6 to 9 or click), and I opens your kit.',
    'Jeeps and motorbikes stand parked by the roads and towns: F at a door gets in (the wheel if it is free), F again gets out. W and S drive and brake, A and D steer, Space is the handbrake. They drive over the land but not up cliffs, slow in water and stall in deep water, and a crash hurts. Bullets and grenades wear one down until it blows up, hurting everyone in and around it, and anyone in the way of a fast one is knocked down.',
    'Deathmatch: everyone for themselves, any gun you like, quick respawns. First to 25 knockouts wins.',
    '3D models from Sketchfab, CC BY 4.0: soldier by ItsKrish7; M4A1, AK-47 and M67 by Nneako; MP5 by Rotuma; Desert Eagle by ELIZION; XD-MOD2 by Orshia 3D; Px4 Storm by Vlasov Daniil; RGD-5 by _Alexandr; Ural 4320 by Brout; BTR-80 and frying pan by GameDev Nick; barricade by Arthur.Zim; crate pile by Blender3D; barbed wire by Mehdi Shahsavan; dumpsters by bazz4r; fences by Erroratten; jerry cans by Liam3D; gas bottles by Gamefruit; propane tank by Oliver Triplett; helmet by Sergeydesign09; shield by sanyaork; cup by Kozlov Maksim; first person M4 and Kriss Vector arms by BarcodeGames. AWP by MKoegler3D, CC BY-NC 4.0. First person Mark 23 arms by BarcodeGames, Sketchfab Standard license.',
  ],
  accent: '#c8473b',
  glyph: 'M2 19l6-8 4 5 3-4 7 7zM17 2v5M14.5 4.5h5',
  order: 0,
  online: { seats: 10, lateJoin: true, migrate: true },
  music: 'own',
  leaderboard: {
    order: 'desc',
    max: 60_000,
    measure: 'Combat Score',
    variants: { 'royale-easy': 'Royale, Easy', 'royale-normal': 'Royale, Normal', 'royale-hard': 'Royale, Hard', 'breach-easy': 'Breach, Easy', 'breach-normal': 'Breach, Normal', 'breach-hard': 'Breach, Hard', 'dm-easy': 'Deathmatch, Easy', 'dm-normal': 'Deathmatch, Normal', 'dm-hard': 'Deathmatch, Hard' },
  },
};
