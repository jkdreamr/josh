import { useId } from 'react';
import type { Club } from './teams.ts';

const shapePaths = {
  shield: 'M8 5H56V34C54 46 44 55 32 60C20 55 10 46 8 34Z',
  round: 'M32 4A28 28 0 1 1 32 60A28 28 0 1 1 32 4Z',
  diamond: 'M32 3 59 32 32 61 5 32Z',
  hex: 'M19 5H45L59 32 45 59H19L5 32Z',
  pennant: 'M8 5H56L48 32 56 59H8Z',
} as const;

function Pattern({ club }: { club: Club }) {
  const { pattern, primary, secondary } = club.crest;
  if (pattern === 'plain') return <rect width="64" height="64" fill={primary} />;
  if (pattern === 'stripes') return <><rect width="64" height="64" fill={primary} />{[0, 20, 40, 60].map((x) => <rect key={x} x={x} width="9" height="64" fill={secondary} />)}</>;
  if (pattern === 'hoops') return <><rect width="64" height="64" fill={primary} />{[10, 27, 44].map((y) => <rect key={y} y={y} width="64" height="8" fill={secondary} />)}</>;
  if (pattern === 'sash') return <><rect width="64" height="64" fill={primary} /><path d="M-5 54 8 64 70 7 56-3Z" fill={secondary} /></>;
  if (pattern === 'halves') return <><rect width="32" height="64" fill={primary} /><rect x="32" width="32" height="64" fill={secondary} /></>;
  if (pattern === 'chevron') return <><rect width="64" height="64" fill={primary} /><path d="m0 14 32 20 32-20v14L32 49 0 28Z" fill={secondary} /></>;
  return <><rect width="32" height="32" fill={primary} /><rect x="32" width="32" height="32" fill={secondary} /><rect y="32" width="32" height="32" fill={secondary} /><rect x="32" y="32" width="32" height="32" fill={primary} /></>;
}

function Emblem({ club }: { club: Club }) {
  const color = club.crest.accent;
  const common = { stroke: color, strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (club.crest.emblem) {
    case 'star': return <path d="m32 12 5.2 12.2 13.2 1.1-10 8.5 3 12.9L32 39.8 20.6 46.7l3-12.9-10-8.5 13.2-1.1Z" fill={color} {...common} />;
    case 'ball': return <><circle cx="32" cy="29" r="14" fill="none" {...common} /><path d="m32 20 7 5-3 9h-8l-3-9Zm-14 7 10-7m8 14 9 6m-17-2-2 10m-8-18-5 9" fill="none" {...common} /></>;
    case 'wave': return <path d="M13 28c7-9 13 9 20 0s13 9 20 0M13 38c7-9 13 9 20 0s13 9 20 0" fill="none" {...common} strokeWidth="4" />;
    case 'crown': return <path d="m14 23 11 8 7-15 7 15 11-8-4 20H18Z" fill={color} {...common} />;
    case 'bolt': return <path d="M36 12 19 34h11l-2 18 18-25H34Z" fill={color} {...common} />;
    case 'tree': return <><path d="m32 12-12 17h8L17 43h30L36 29h8Z" fill={color} {...common} /><path d="M30 43h4v8h-4Z" fill={color} {...common} /></>;
    case 'anchor': return <><circle cx="32" cy="15" r="4" fill="none" {...common} /><path d="M32 20v29m-17-15c0 11 7 17 17 17s17-6 17-17M25 27l7-7 7 7m-22 7h10m10 0h10" fill="none" {...common} strokeWidth="3" /></>;
    case 'bird': return <path d="M13 38c8-3 12-10 16-19 3 9 8 13 22 14-7 2-11 5-15 12-7-3-13-4-23-7Z" fill={color} {...common} />;
    case 'mountain': return <path d="m12 44 15-22 7 10 6-8 12 20Zm15-22 4-6 4 6" fill={color} {...common} />;
    case 'sun': return <><circle cx="32" cy="31" r="10" fill={color} {...common} />{[0, 45, 90, 135].map((angle) => <path key={angle} d="M32 10v-5" stroke={color} strokeWidth="3" transform={`rotate(${angle} 32 31)`} />)}</>;
  }
}

export function Crest({ club, size = 48 }: { club: Club; size?: number }) {
  const id = useId();
  const clip = `soccer-crest-${id}`;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={club.name}>
      <defs>
        <clipPath id={clip}><path d={shapePaths[club.crest.shape]} /></clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <Pattern club={club} />
        <g transform="translate(0 -3)"><Emblem club={club} /></g>
        <path d="M4 44h56v11H4Z" fill="#101820" opacity=".85" />
        <text x="32" y="52.5" textAnchor="middle" fill="#fff" fontSize="9" fontWeight="900" fontFamily="system-ui, sans-serif" letterSpacing=".7">{club.short}</text>
      </g>
      <path d={shapePaths[club.crest.shape]} fill="none" stroke={club.crest.accent} strokeWidth="2.5" />
    </svg>
  );
}
