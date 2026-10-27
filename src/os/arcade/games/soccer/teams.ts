import type { Slot } from './logic.ts';

export type Kit = { shirt: string; shorts: string; socks: string; trim: string; number: string };
export type Crest = {
  shape: 'shield' | 'round' | 'diamond' | 'hex' | 'pennant';
  pattern: 'plain' | 'stripes' | 'hoops' | 'sash' | 'halves' | 'chevron' | 'quarters';
  primary: string;
  secondary: string;
  accent: string;
  emblem: 'star' | 'ball' | 'wave' | 'crown' | 'bolt' | 'tree' | 'anchor' | 'bird' | 'mountain' | 'sun';
};
export type ClubPlayer = {
  name: string;
  pace: number;
  shooting: number;
  passing: number;
  dribbling: number;
  defending: number;
  physical: number;
  keeper?: { diving: number; reflexes: number; handling: number; positioning: number };
};
export type Club = {
  id: string;
  name: string;
  short: string;
  call: string;
  city: string;
  crest: Crest;
  home: Kit;
  away: Kit;
  keeper: [string, string];
  ratings: { attack: number; midfield: number; defense: number };
  players: readonly ClubPlayer[];
};

export const KIT_CLASH = 35;
export const DEFAULT_CLUBS = ['bay-city', 'northshore'] as const;

const firstNames = [
  'Ari', 'Bex', 'Cato', 'Deni', 'Elio', 'Fara', 'Galen', 'Hali', 'Ivo', 'Jori', 'Koa', 'Lumi', 'Miro', 'Neri', 'Orin',
  'Pavi', 'Quin', 'Rumi', 'Sela', 'Tavi', 'Uma', 'Vero', 'Wren', 'Yori', 'Zuri', 'Aven', 'Bryn', 'Ceri', 'Dara', 'Eris',
  'Fenn', 'Gio', 'Hollis', 'Indi', 'Jae', 'Kiri', 'Lio', 'Maren', 'Niko', 'Omi', 'Perrin', 'Rae', 'Soren', 'Tula',
  'Vale', 'Willa', 'Yuna', 'Zeno',
];
const surnames = [
  'Alder', 'Brindle', 'Coda', 'Dovet', 'Elsen', 'Fenn', 'Gable', 'Halden', 'Iver', 'Juno', 'Kest', 'Lark', 'Marlow',
  'Noll', 'Oriole', 'Perrin', 'Quill', 'Rook', 'Solvi', 'Tern', 'Umber', 'Vale', 'Wicket', 'Yarrow', 'Zephyr',
  'Bracken', 'Dune', 'Ember', 'Farrow', 'Grove', 'Hush', 'Inlet', 'Juniper', 'Kellan', 'Lumen', 'Moss', 'Night',
  'Oxbow', 'Pine', 'Quartz', 'Rill', 'Sable', 'Thorne', 'Voss', 'Waver', 'Yew', 'Zinn', 'Brook',
];

type ClubSeed = Omit<Club, 'players'> & { ratings: Club['ratings']; profiles?: never };
const rawClubs: ClubSeed[] = [
  {
    id: 'bay-city', name: 'Bay City FC', short: 'BAY', call: 'bay city', city: 'Bay City',
    crest: { shape: 'shield', pattern: 'sash', primary: '#d52f43', secondary: '#faf6ed', accent: '#f0c45b', emblem: 'wave' },
    home: { shirt: '#d52f43', shorts: '#faf6ed', socks: '#f7f4ec', trim: '#fff3e5', number: '#fef3e6' },
    away: { shirt: '#172b38', shorts: '#e4bd6c', socks: '#172b38', trim: '#f5dda0', number: '#fff4cf' },
    keeper: ['#f6c945', '#243e69'], ratings: { attack: 84, midfield: 81, defense: 79 },
  },
  {
    id: 'northshore', name: 'Northshore United', short: 'NSU', call: 'northshore', city: 'Northshore',
    crest: { shape: 'round', pattern: 'hoops', primary: '#112744', secondary: '#7bc9ee', accent: '#c7efff', emblem: 'anchor' },
    home: { shirt: '#112744', shorts: '#7bc9ee', socks: '#10243a', trim: '#c7efff', number: '#17293e' },
    away: { shirt: '#f1efe8', shorts: '#19344b', socks: '#f1efe8', trim: '#8bc7de', number: '#132c43' },
    keeper: ['#f18548', '#c4e75b'], ratings: { attack: 77, midfield: 84, defense: 83 },
  },
  {
    id: 'harbor-lights', name: 'Harbor Lights', short: 'HBL', call: 'harbor lights', city: 'Harbor Point',
    crest: { shape: 'pennant', pattern: 'stripes', primary: '#176d69', secondary: '#e9c86b', accent: '#fff0b8', emblem: 'sun' },
    home: { shirt: '#176d69', shorts: '#f0d77e', socks: '#125650', trim: '#f7e7a6', number: '#fff4c7' },
    away: { shirt: '#3a253b', shorts: '#c9b2cc', socks: '#3a253b', trim: '#e5d0e5', number: '#fff5ff' },
    keeper: ['#d95c83', '#e7ef58'], ratings: { attack: 80, midfield: 86, defense: 78 },
  },
  {
    id: 'redwood-rangers', name: 'Redwood Rangers', short: 'RWR', call: 'redwood', city: 'Redwood Vale',
    crest: { shape: 'shield', pattern: 'halves', primary: '#315c3d', secondary: '#c87748', accent: '#ead3a2', emblem: 'tree' },
    home: { shirt: '#315c3d', shorts: '#cf8052', socks: '#254a32', trim: '#edc496', number: '#fff0d8' },
    away: { shirt: '#e8eee2', shorts: '#314534', socks: '#314534', trim: '#9db58f', number: '#1a3425' },
    keeper: ['#6c55c7', '#f4c94b'], ratings: { attack: 86, midfield: 80, defense: 75 },
  },
  {
    id: 'cobalt-athletic', name: 'Cobalt Athletic', short: 'CBT', call: 'cobalt', city: 'Cobalt Reach',
    crest: { shape: 'hex', pattern: 'chevron', primary: '#285aa3', secondary: '#d3e65b', accent: '#bee4f4', emblem: 'bolt' },
    home: { shirt: '#285aa3', shorts: '#d4e85c', socks: '#204880', trim: '#ddec9b', number: '#f6ffd3' },
    away: { shirt: '#792d48', shorts: '#efbdc6', socks: '#792d48', trim: '#f4d0d4', number: '#fff0f3' },
    keeper: ['#f28449', '#e8e7ee'], ratings: { attack: 78, midfield: 81, defense: 87 },
  },
  {
    id: 'ember-town', name: 'Ember Town', short: 'EMB', call: 'ember town', city: 'Ember Hollow',
    crest: { shape: 'diamond', pattern: 'quarters', primary: '#c34e2b', secondary: '#ffd47c', accent: '#743440', emblem: 'crown' },
    home: { shirt: '#c34e2b', shorts: '#ffe2a6', socks: '#ab3e2d', trim: '#ffe3a7', number: '#fff3d0' },
    away: { shirt: '#245b71', shorts: '#b8dce3', socks: '#245b71', trim: '#d1eef0', number: '#edfaff' },
    keeper: ['#4f59bd', '#65d39c'], ratings: { attack: 88, midfield: 76, defense: 72 },
  },
  {
    id: 'glacier-point', name: 'Glacier Point', short: 'GLP', call: 'glacier point', city: 'Glacier Point',
    crest: { shape: 'round', pattern: 'plain', primary: '#6176a9', secondary: '#e5f5f2', accent: '#b9d2e9', emblem: 'mountain' },
    home: { shirt: '#6176a9', shorts: '#f0f6ed', socks: '#586990', trim: '#dce8f4', number: '#f8ffff' },
    away: { shirt: '#823a52', shorts: '#e8b8bd', socks: '#823a52', trim: '#f0d4cf', number: '#fff4eb' },
    keeper: ['#d9a431', '#59b8a8'], ratings: { attack: 72, midfield: 82, defense: 86 },
  },
  {
    id: 'saltmarsh', name: 'Saltmarsh', short: 'SLM', call: 'saltmarsh', city: 'Saltmarsh Cove',
    crest: { shape: 'pennant', pattern: 'sash', primary: '#78834b', secondary: '#e2dcc3', accent: '#b3cecc', emblem: 'bird' },
    home: { shirt: '#78834b', shorts: '#e9e2c8', socks: '#636f40', trim: '#d9d3b1', number: '#faf6e5' },
    away: { shirt: '#3b5263', shorts: '#c3d3d8', socks: '#3b5263', trim: '#d5e5e5', number: '#f1ffff' },
    keeper: ['#a34884', '#edb846'], ratings: { attack: 74, midfield: 73, defense: 71 },
  },
  {
    id: 'copper-hill', name: 'Copper Hill', short: 'CPH', call: 'copper hill', city: 'Copper Hill',
    crest: { shape: 'hex', pattern: 'hoops', primary: '#753e4b', secondary: '#d48454', accent: '#f2d3a1', emblem: 'star' },
    home: { shirt: '#753e4b', shorts: '#d48454', socks: '#663845', trim: '#edbb8e', number: '#fff1d7' },
    away: { shirt: '#e9eee7', shorts: '#35545b', socks: '#35545b', trim: '#b5d3cd', number: '#173b43' },
    keeper: ['#5985ce', '#d5df52'], ratings: { attack: 82, midfield: 78, defense: 76 },
  },
  {
    id: 'lantern-bay', name: 'Lantern Bay', short: 'LTB', call: 'lantern bay', city: 'Lantern Bay',
    crest: { shape: 'shield', pattern: 'halves', primary: '#267e88', secondary: '#e96f63', accent: '#f6d698', emblem: 'sun' },
    home: { shirt: '#267e88', shorts: '#ef7666', socks: '#216a76', trim: '#ffb19a', number: '#fff5d9' },
    away: { shirt: '#513a7b', shorts: '#d5c6ec', socks: '#513a7b', trim: '#e8dcff', number: '#fff5ff' },
    keeper: ['#d5a12c', '#5bcc79'], ratings: { attack: 76, midfield: 87, defense: 80 },
  },
  {
    id: 'ironvale', name: 'Ironvale', short: 'IRV', call: 'ironvale', city: 'Ironvale',
    crest: { shape: 'diamond', pattern: 'stripes', primary: '#414c55', secondary: '#c3c9c7', accent: '#efbd63', emblem: 'anchor' },
    home: { shirt: '#414c55', shorts: '#c3c9c7', socks: '#343e46', trim: '#e4d399', number: '#f6f6ee' },
    away: { shirt: '#a64a34', shorts: '#f0d2a3', socks: '#a64a34', trim: '#f2cf9a', number: '#fff3d8' },
    keeper: ['#5495d0', '#b460c0'], ratings: { attack: 80, midfield: 75, defense: 86 },
  },
  {
    id: 'meadowbrook', name: 'Meadowbrook', short: 'MDB', call: 'meadowbrook', city: 'Meadowbrook',
    crest: { shape: 'round', pattern: 'chevron', primary: '#47734e', secondary: '#dd9aab', accent: '#f0dda8', emblem: 'tree' },
    home: { shirt: '#47734e', shorts: '#e4a0b0', socks: '#3b6445', trim: '#f3c6c7', number: '#fff4e6' },
    away: { shirt: '#6a457c', shorts: '#e2d4e5', socks: '#6a457c', trim: '#f0e5f3', number: '#fff8ff' },
    keeper: ['#dfad30', '#4b99d3'], ratings: { attack: 73, midfield: 79, defense: 82 },
  },
  {
    id: 'sunspire', name: 'Sunspire', short: 'SNS', call: 'sunspire', city: 'Sunspire',
    crest: { shape: 'pennant', pattern: 'quarters', primary: '#d6aa42', secondary: '#743b49', accent: '#f5e1a5', emblem: 'crown' },
    home: { shirt: '#d6aa42', shorts: '#743b49', socks: '#b88c31', trim: '#f1d786', number: '#fff4cc' },
    away: { shirt: '#255365', shorts: '#add7db', socks: '#255365', trim: '#d3eef0', number: '#f3ffff' },
    keeper: ['#588d6b', '#7352b9'], ratings: { attack: 88, midfield: 87, defense: 84 },
  },
  {
    id: 'riverside-rovers', name: 'Riverside Rovers', short: 'RSR', call: 'riverside', city: 'Riverside',
    crest: { shape: 'shield', pattern: 'hoops', primary: '#337f9a', secondary: '#26333d', accent: '#9fd5d6', emblem: 'wave' },
    home: { shirt: '#337f9a', shorts: '#26333d', socks: '#286b86', trim: '#a9e2df', number: '#edffff' },
    away: { shirt: '#8e4a36', shorts: '#e5c594', socks: '#8e4a36', trim: '#f1d8ac', number: '#fff7e7' },
    keeper: ['#d1a236', '#9b53b5'], ratings: { attack: 79, midfield: 82, defense: 77 },
  },
  {
    id: 'kestrel-fc', name: 'Kestrel FC', short: 'KST', call: 'kestrel', city: 'Kestrel Ridge',
    crest: { shape: 'hex', pattern: 'sash', primary: '#6752a1', secondary: '#e5d65c', accent: '#d9d0f3', emblem: 'bird' },
    home: { shirt: '#6752a1', shorts: '#e5d65c', socks: '#57458e', trim: '#f0e796', number: '#fffbe1' },
    away: { shirt: '#28716c', shorts: '#c3ddd1', socks: '#28716c', trim: '#d5eee1', number: '#f1fff6' },
    keeper: ['#e0704e', '#4b9bdd'], ratings: { attack: 85, midfield: 78, defense: 82 },
  },
  {
    id: 'old-quarry', name: 'Old Quarry', short: 'OQR', call: 'old quarry', city: 'Quarry End',
    crest: { shape: 'diamond', pattern: 'stripes', primary: '#765641', secondary: '#d6c09c', accent: '#8da2a2', emblem: 'mountain' },
    home: { shirt: '#765641', shorts: '#d6c09c', socks: '#634735', trim: '#eddbb9', number: '#fff4dc' },
    away: { shirt: '#3e6170', shorts: '#c3d9d9', socks: '#3e6170', trim: '#dcebed', number: '#f3ffff' },
    keeper: ['#b45683', '#cfad39'], ratings: { attack: 69, midfield: 72, defense: 75 },
  },
];

const slots: readonly Slot[] = ['GK', 'LB', 'CB', 'CB', 'RB', 'CM', 'CM', 'CM', 'LW', 'ST', 'RW'];
const roleProfile: Record<Slot, Partial<Record<keyof Omit<ClubPlayer, 'name' | 'keeper'>, number>>> = {
  GK: { pace: -8, shooting: -18, passing: -8, dribbling: -14, defending: 2, physical: 3 },
  LB: { pace: 3, shooting: -8, passing: -1, dribbling: 0, defending: 0, physical: 2 },
  CB: { pace: -5, shooting: -12, passing: -2, dribbling: -7, defending: 2, physical: 5 },
  RB: { pace: 3, shooting: -8, passing: -1, dribbling: 0, defending: 0, physical: 2 },
  CM: { pace: 0, shooting: -1, passing: 0, dribbling: 2, defending: -1, physical: 0 },
  LW: { pace: 5, shooting: -2, passing: 0, dribbling: 5, defending: -8, physical: -2 },
  ST: { pace: 1, shooting: 4, passing: -2, dribbling: 2, defending: -12, physical: 3 },
  RW: { pace: 5, shooting: -2, passing: 0, dribbling: 5, defending: -8, physical: -2 },
};
const statKeys = ['pace', 'shooting', 'passing', 'dribbling', 'defending', 'physical'] as const;
type StatKey = (typeof statKeys)[number];

function hash(value: string) {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++) result = Math.imul(result ^ value.charCodeAt(i), 16777619);
  return result >>> 0;
}

function clampRating(value: number) {
  return Math.max(50, Math.min(95, Math.round(value)));
}

function lineFor(ratings: Club['ratings'], slot: Slot) {
  if (slot === 'GK' || slot === 'LB' || slot === 'CB' || slot === 'RB') return ratings.defense;
  if (slot === 'CM') return ratings.midfield;
  return ratings.attack;
}

function fullName(index: number, playerIndex: number) {
  const first = firstNames[(index * 3 + playerIndex) % firstNames.length]!;
  const last = surnames[(index * 7 + playerIndex * 5) % surnames.length]!;
  return `${first[0]}. ${last}`;
}

function makePlayers(index: number, ratings: Club['ratings']): ClubPlayer[] {
  const players = slots.map((slot, playerIndex) => {
    const name = fullName(index, playerIndex);
    const line = lineFor(ratings, slot);
    const profile = roleProfile[slot];
    const values = Object.fromEntries(statKeys.map((key) => [
      key,
      clampRating(line + (profile[key] ?? 0) + (hash(`${name}:${key}`) % 9) - 4),
    ])) as Record<StatKey, number>;
    if (slot === 'ST') values.shooting = clampRating(line + (hash(`${name}:shooting`) % 9) - 4);
    if (slot === 'CM') values.passing = clampRating(line + (hash(`${name}:passing`) % 9) - 4);
    if (slot === 'GK' || slot === 'LB' || slot === 'CB' || slot === 'RB') {
      values.defending = clampRating(line + (slot === 'GK' ? 2 : slot === 'CB' ? -1 : 0) + (hash(`${name}:defending`) % 9) - 4);
    }
    const player: ClubPlayer = { name, ...values };
    if (slot === 'GK') {
      player.keeper = {
        diving: clampRating(line + 1 + (hash(`${name}:diving`) % 9) - 4),
        reflexes: clampRating(line + 1 + (hash(`${name}:reflexes`) % 9) - 4),
        handling: clampRating(line + (hash(`${name}:handling`) % 9) - 4),
        positioning: clampRating(line + 1 + (hash(`${name}:positioning`) % 9) - 4),
      };
    }
    return player;
  });
  const groups: [number[], StatKey, number][] = [
    [[8, 9, 10], 'shooting', ratings.attack],
    [[5, 6, 7], 'passing', ratings.midfield],
    [[0, 1, 2, 3, 4], 'defending', ratings.defense],
  ];
  for (const [indices, key, target] of groups) {
    const average = indices.reduce((sum, i) => sum + players[i]![key], 0) / indices.length;
    const correction = target - average;
    for (const i of indices) players[i]![key] = clampRating(players[i]![key] + correction);
  }
  return players;
}

export const CLUBS: readonly Club[] = rawClubs.map((club, index) => ({
  ...club,
  players: makePlayers(index, club.ratings),
}));
export const CLUB_IDS: readonly string[] = CLUBS.map((club) => club.id);

export function clubById(id?: string | null): Club {
  return CLUBS.find((club) => club.id === id) ?? CLUBS[0]!;
}

export const clubOverall = (club: Club) =>
  Math.round(club.ratings.attack * 0.3 + club.ratings.midfield * 0.35 + club.ratings.defense * 0.35);

function lab(color: string): [number, number, number] {
  const hex = color.startsWith('#') ? color.slice(1) : color;
  const rgb = hex.length === 3 ? [...hex].map((part) => parseInt(part + part, 16)) : [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const linear = rgb.map((component) => {
    const channel = component / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const x = (linear[0]! * 0.4124564 + linear[1]! * 0.3575761 + linear[2]! * 0.1804375) / 0.95047;
  const y = linear[0]! * 0.2126729 + linear[1]! * 0.7151522 + linear[2]! * 0.072175;
  const z = (linear[0]! * 0.0193339 + linear[1]! * 0.119192 + linear[2]! * 0.9503041) / 1.08883;
  const f = (value: number) => value > 216 / 24389 ? Math.cbrt(value) : value * (24389 / 27) / 116 + 16 / 116;
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function colorDistance(a: string, b: string) {
  const first = lab(a), second = lab(b);
  return Math.hypot(first[0] - second[0], first[1] - second[1], first[2] - second[2]);
}

function clashKit(home: Kit): Kit {
  const white = '#f4f4f0';
  const dark = '#15181d';
  const shirt = colorDistance(home.shirt, white) >= colorDistance(home.shirt, dark) ? white : dark;
  return {
    shirt,
    shorts: shirt,
    socks: shirt,
    trim: shirt === white ? '#26313a' : '#f4f4f0',
    number: shirt === white ? '#17232c' : '#f9f6ed',
  };
}

const keeperFallbacks = ['#f6c945', '#f18548', '#3fd17a', '#b04fe0', '#ff7ab8', '#9a9a9a'];

function keeperColor(club: Club, shirts: [string, string], other?: string) {
  const options = [...club.keeper, ...keeperFallbacks];
  const valid = (color: string) => color !== other
    && shirts.every((shirt) => colorDistance(color, shirt) >= KIT_CLASH)
    && (other === undefined || colorDistance(color, other) >= KIT_CLASH);
  const preferred = options.find(valid);
  if (preferred) return preferred;
  let best = options[options.length - 1]!;
  let bestDistance = -Infinity;
  for (let red = 24; red <= 232; red += 26) {
    for (let green = 24; green <= 232; green += 26) {
      for (let blue = 24; blue <= 232; blue += 26) {
        const color = `#${[red, green, blue].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
        if (valid(color)) return color;
        const references = [...shirts, ...(other ? [other] : [])];
        const distance = Math.min(...references.map((reference) => colorDistance(color, reference)));
        if (distance > bestDistance) {
          best = color;
          bestDistance = distance;
        }
      }
    }
  }
  return best;
}

export function matchKits(home: Club, away: Club): { home: Kit; away: Kit; keepers: [string, string] } {
  const homeKit = home.home;
  let awayKit = colorDistance(homeKit.shirt, away.home.shirt) >= KIT_CLASH ? away.home : away.away;
  if (colorDistance(homeKit.shirt, awayKit.shirt) < KIT_CLASH) awayKit = clashKit(homeKit);
  const homeKeeper = keeperColor(home, [homeKit.shirt, awayKit.shirt]);
  const keepers: [string, string] = [homeKeeper, keeperColor(away, [homeKit.shirt, awayKit.shirt], homeKeeper)];
  return { home: homeKit, away: awayKit, keepers };
}

export function rosterName(club: Club, playerIndex: number) {
  return club.players[playerIndex]?.name ?? club.players[0]!.name;
}
