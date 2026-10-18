// The field: ten made-up teams with two drivers each. Liveries are three colors (body, accent, detail).
export type Team = { name: string; short: string; body: string; accent: string; detail: string };

export const TEAMS: Team[] = [
  { name: 'Scarlet Corse', short: 'SCA', body: '#c8102e', accent: '#f4f4f4', detail: '#ffd200' },
  { name: 'Argent Motorsport', short: 'ARG', body: '#c9ced3', accent: '#00a19b', detail: '#101418' },
  { name: 'Volt Racing', short: 'VLT', body: '#16213f', accent: '#e8202a', detail: '#f5c400' },
  { name: 'Tangerine GP', short: 'TAN', body: '#ff8000', accent: '#1d6fd6', detail: '#111111' },
  { name: 'Verde Racing', short: 'VER', body: '#0b5c4c', accent: '#cedc00', detail: '#f0f0f0' },
  { name: 'Azure Motorsport', short: 'AZU', body: '#0a58c2', accent: '#ff5fa2', detail: '#ffffff' },
  { name: 'Hawk Racing', short: 'HWK', body: '#f2f2f2', accent: '#b6151d', detail: '#1b1b1b' },
  { name: 'Nordic Racing', short: 'NOR', body: '#1e7dd8', accent: '#ffffff', detail: '#ff3b30' },
  { name: 'Ventura Squadra', short: 'VEN', body: '#1a2c6b', accent: '#9cb6ff', detail: '#ffffff' },
  { name: 'Kestrel Racing', short: 'KES', body: '#2b2b2b', accent: '#52e252', detail: '#c9c9c9' },
];

export const DRIVERS: string[] = [
  'L. Ferrante', 'M. Kova',
  'A. Lindqvist', 'R. Sato',
  'J. Okafor', 'P. Duval',
  'O. Brandt', 'N. Rocha',
  'E. Marquez', 'T. Hale',
  'C. Moreau', 'I. Petrov',
  'K. Whitlock', 'D. Varga',
  'S. Nakamura', 'F. Albers',
  'G. Russo', 'H. Quinn',
  'B. Castell', 'V. Laine',
];

/** Short three letter code for a driver's name, like the timing tower shows. */
export const codeOf = (name: string) => {
  const words = name.trim().split(/\s+/);
  const last = words[words.length - 1] ?? '';
  // "Player 2" is P2; everyone else goes by the first three letters of their last name
  if (/^\d+$/.test(last)) return `P${last}`;
  const code = last.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();
  return code || name.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() || '---';
};
