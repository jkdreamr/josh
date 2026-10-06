import type { CSSProperties, ReactNode } from 'react';
import { siGithub, siInstagram, siSoundcloud, siSpotify, siX, siYoutube } from 'simple-icons';

type Glyph = { path: string };

function Brand({ icon, size = 56, color = '#fff' }: { icon: Glyph; size?: number; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill={color} aria-hidden="true">
      <path d={icon.path} />
    </svg>
  );
}

const linkedinPath =
  'M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.34V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45z';

export type IconKind =
  | 'finder'
  | 'chrome'
  | 'messages'
  | 'notes'
  | 'soundcloud'
  | 'spotify'
  | 'youtube'
  | 'instagram'
  | 'x'
  | 'linkedin'
  | 'github'
  | 'mail'
  | 'terminal'
  | 'coxbox'
  | 'baduk'
  | 'badminton'
  | 'beatpad'
  | 'photobooth'
  | 'trash'
  | 'about'
  | 'folder'
  | 'doc';

const tile = (background: string, extra?: CSSProperties): CSSProperties => ({ background, ...extra });

function Chrome() {
  return (
    <svg viewBox="0 0 48 48" width="72%" height="72%" aria-hidden="true">
      <circle cx="24" cy="24" r="22" fill="#db4437" />
      <path d="M24 2a22 22 0 0 1 19.05 11H24a11 11 0 0 0-9.53 5.5L4.95 13A22 22 0 0 1 24 2z" fill="#db4437" />
      <path d="M4.95 13l9.52 16.5A11 11 0 0 0 24 35l-9.53 16.5A22 22 0 0 1 4.95 13z" fill="#0f9d58" transform="translate(0 -5.5)" />
      <path d="M43.05 13A22 22 0 0 1 24 46L33.53 29.5A11 11 0 0 0 33.53 18.5z" fill="#ffcd40" />
      <path d="M4.95 13L14.47 29.5A11 11 0 0 0 24 35l-9.53 11A22 22 0 0 1 4.95 13z" fill="#0f9d58" />
      <circle cx="24" cy="24" r="10" fill="#fff" />
      <circle cx="24" cy="24" r="8" fill="#4285f4" />
    </svg>
  );
}

function Finder() {
  return (
    <svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true">
      <defs>
        <linearGradient id="fl" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6fd3ff" />
          <stop offset="1" stopColor="#1a7bf2" />
        </linearGradient>
        <linearGradient id="fr" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f4f8fc" />
          <stop offset="1" stopColor="#cfdcec" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" fill="url(#fr)" />
      <path d="M0 0h36c-4 10-6 20-6 32 0 12 2 22 6 32H0z" fill="url(#fl)" />
      <path d="M20 20v6M44 20v6" stroke="#10213a" strokeWidth="3.4" strokeLinecap="round" />
      <path d="M16 42c9 7 23 7 32 0" stroke="#10213a" strokeWidth="3.4" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function Folder() {
  return (
    <svg viewBox="0 0 64 52" width="100%" height="100%" aria-hidden="true">
      <defs>
        <linearGradient id="fd" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8ed3ff" />
          <stop offset="1" stopColor="#3ea6f5" />
        </linearGradient>
      </defs>
      <path d="M4 6a4 4 0 0 1 4-4h14l6 6h28a4 4 0 0 1 4 4v4H4z" fill="#3b9de8" />
      <rect x="2" y="12" width="60" height="38" rx="5" fill="url(#fd)" />
      <rect x="2" y="12" width="60" height="3" rx="1.5" fill="#fff" opacity=".35" />
    </svg>
  );
}

function Doc() {
  return (
    <svg viewBox="0 0 48 60" width="100%" height="100%" aria-hidden="true">
      <path d="M4 2h28l12 12v42a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="#fff" stroke="#d5d9e0" />
      <path d="M32 2v10a2 2 0 0 0 2 2h10" fill="#eef1f5" stroke="#d5d9e0" />
      {[22, 28, 34, 40, 46].map((y) => (
        <rect key={y} x="9" y={y} width={y === 46 ? 18 : 30} height="2.4" rx="1.2" fill="#b9c0cc" />
      ))}
    </svg>
  );
}

export function Glyph({ kind }: { kind: IconKind }): ReactNode {
  switch (kind) {
    case 'finder':
      return <Finder />;
    case 'folder':
      return <Folder />;
    case 'doc':
      return <Doc />;
    case 'chrome':
      return <Chrome />;
    case 'soundcloud':
      return <Brand icon={siSoundcloud} size={40} />;
    case 'spotify':
      return <Brand icon={siSpotify} size={38} color="#1ed760" />;
    case 'youtube':
      return <Brand icon={siYoutube} size={38} />;
    case 'instagram':
      return <Brand icon={siInstagram} size={34} />;
    case 'x':
      return <Brand icon={siX} size={30} />;
    case 'github':
      return <Brand icon={siGithub} size={36} />;
    case 'linkedin':
      return <Brand icon={{ path: linkedinPath }} size={32} />;
    case 'messages':
      return (
        <svg viewBox="0 0 48 48" width="70%" height="70%" aria-hidden="true">
          <path d="M24 7C13.5 7 5 14.2 5 23c0 5 2.7 9.4 7 12.4-.4 2.6-1.7 4.8-3.6 6.6 4 0 7.5-1.5 10-3.6 1.8.4 3.6.6 5.6.6 10.5 0 19-7.2 19-16S34.5 7 24 7z" fill="#fff" />
        </svg>
      );
    case 'mail':
      return (
        <svg viewBox="0 0 48 48" width="68%" height="68%" aria-hidden="true">
          <rect x="4" y="10" width="40" height="28" rx="4" fill="#fff" />
          <path d="M6 13l18 13 18-13" stroke="#2b7cf6" strokeWidth="3" fill="none" strokeLinejoin="round" />
        </svg>
      );
    case 'notes':
      return (
        <svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true">
          <rect width="48" height="48" fill="#fffdf6" />
          <rect width="48" height="13" fill="#ffd54a" />
          {[20, 26, 32, 38].map((y) => (
            <rect key={y} x="8" y={y} width="32" height="1.4" fill="#d9d4c3" />
          ))}
        </svg>
      );
    case 'terminal':
      return (
        <svg viewBox="0 0 48 48" width="62%" height="62%" aria-hidden="true">
          <path d="M8 14l10 9-10 9" stroke="#e6e6e6" strokeWidth="3.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="22" y="31" width="16" height="3.6" rx="1.8" fill="#e6e6e6" />
        </svg>
      );
    case 'coxbox':
      return (
        <svg viewBox="0 0 48 48" width="74%" height="74%" aria-hidden="true">
          <path d="M3 27c8 3 34 3 42 0-1 3-4 5-8 5H11c-4 0-7-2-8-5z" fill="#fff" />
          {[11, 17, 23, 29, 35].map((x) => (
            <path key={x} d={`M${x} 27l-5 9`} stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
          ))}
          <path d="M2 40c5-2 9 2 14 0s9 2 14 0 9 2 14 0" stroke="#bfe6ff" strokeWidth="2" fill="none" strokeLinecap="round" />
          <circle cx="36" cy="16" r="4" fill="#fff" />
        </svg>
      );
    case 'baduk':
      return (
        <svg viewBox="0 0 48 48" width="74%" height="74%" aria-hidden="true">
          {[12, 24, 36].map((p) => <g key={p}><path d={`M${p} 8v32M8 ${p}h32`} stroke="#4f351e" strokeWidth="1.2" /></g>)}
          <circle cx="17" cy="17" r="6.3" fill="#101111" stroke="#555" strokeWidth="1" />
          <circle cx="31" cy="24" r="6.3" fill="#f5f0e6" stroke="#bcb4a7" strokeWidth="1" />
        </svg>
      );
    case 'badminton':
      return (
        <svg viewBox="0 0 48 48" width="74%" height="74%" aria-hidden="true">
          <path d="M13 11l15 15m-14-19L31 21m-21-5 16 16M27 28l12 12" fill="none" stroke="#fff3dd" strokeLinecap="round" strokeWidth="2.4" />
          <path d="M10 5l5 5m-8 3 5 5m-4-11 4 4m-2 7 4 4" fill="none" stroke="#d7e0cf" strokeLinecap="round" strokeWidth="1.2" />
          <ellipse cx="35" cy="37" rx="5" ry="2.3" transform="rotate(45 35 37)" fill="none" stroke="#ffd27a" strokeWidth="1.8" />
        </svg>
      );
    case 'beatpad':
      return (
        <svg viewBox="0 0 48 48" width="74%" height="74%" aria-hidden="true">
          {[0, 1, 2, 3].map((row) => (
            <g key={row}>
              {[0, 1, 2, 3].map((column) => (
                <rect key={column} x={7 + column * 9} y={8 + row * 9} width="6" height="6" rx="1.5" fill={(row + column) % 3 === 0 ? '#f0c47f' : '#e9eee2'} opacity={(row + column) % 3 === 0 ? 1 : .56} />
              ))}
            </g>
          ))}
          <path d="M9 43h30" stroke="#a8d1bb" strokeLinecap="round" strokeWidth="2" />
        </svg>
      );
    case 'photobooth':
      return (
        <svg viewBox="0 0 48 48" width="70%" height="70%" aria-hidden="true">
          <rect x="5" y="13" width="38" height="26" rx="5" fill="#fff" />
          <rect x="16" y="8" width="16" height="7" rx="2" fill="#fff" />
          <circle cx="24" cy="26" r="9" fill="#c0262d" />
          <circle cx="24" cy="26" r="5.5" fill="#2a0b0d" />
          <circle cx="22" cy="24" r="1.6" fill="#fff" opacity=".8" />
        </svg>
      );
    case 'trash':
      return (
        <svg viewBox="0 0 48 56" width="70%" height="70%" aria-hidden="true">
          <path d="M6 12h36l-3 40a3 3 0 0 1-3 3H12a3 3 0 0 1-3-3z" fill="rgba(255,255,255,.75)" stroke="rgba(255,255,255,.95)" />
          {[15, 22, 29, 36].map((x) => (
            <path key={x} d={`M${x - 0.5} 18v30`} stroke="rgba(120,130,150,.55)" strokeWidth="1.6" />
          ))}
          <rect x="3" y="6" width="42" height="7" rx="3" fill="rgba(255,255,255,.9)" />
        </svg>
      );
    case 'about':
      return (
        <span className="glyph-jk" aria-hidden="true">
          jk
        </span>
      );
  }
}

const tiles: Partial<Record<IconKind, CSSProperties>> = {
  finder: tile('#fff'),
  chrome: tile('linear-gradient(180deg,#ffffff,#e9edf3)'),
  messages: tile('linear-gradient(180deg,#6af07b,#16c03d)'),
  notes: tile('#fff'),
  soundcloud: tile('linear-gradient(180deg,#ff8a2b,#ff4d00)'),
  spotify: tile('linear-gradient(180deg,#232323,#060606)'),
  youtube: tile('linear-gradient(180deg,#ff3b3b,#d40000)'),
  instagram: tile('radial-gradient(circle at 30% 107%,#fdf497 0%,#fdf497 5%,#fd5949 45%,#d6249f 60%,#285aeb 90%)'),
  x: tile('linear-gradient(180deg,#1e1e1e,#000)'),
  linkedin: tile('linear-gradient(180deg,#1a8cd8,#0a66c2)'),
  github: tile('linear-gradient(180deg,#30363d,#0d1117)'),
  mail: tile('linear-gradient(180deg,#5ab8ff,#1d6ff2)'),
  terminal: tile('linear-gradient(180deg,#3a3a3c,#121214)', { boxShadow: 'inset 0 0 0 1.5px rgba(255,255,255,.18)' }),
  coxbox: tile('linear-gradient(180deg,#d63b45,#8c1515)'),
  baduk: tile('linear-gradient(145deg,#cfaa70,#8f6338)'),
  badminton: tile('linear-gradient(145deg,#417c73,#224844)'),
  beatpad: tile('linear-gradient(145deg,#67584a,#322b27)'),
  photobooth: tile('linear-gradient(180deg,#ff5f6d,#b3152a)'),
  trash: tile('transparent', { boxShadow: 'none' }),
  about: tile('linear-gradient(135deg,#ff9a8b,#a18cd1 50%,#5b8cff)'),
};

export function AppIcon({ kind, size = 48 }: { kind: IconKind; size?: number }) {
  if (kind === 'folder' || kind === 'doc') {
    return (
      <span className="icon-bare" style={{ width: size, height: size }}>
        <Glyph kind={kind} />
      </span>
    );
  }
  return (
    <span className={`icon-tile icon-${kind}`} style={{ width: size, height: size, ...tiles[kind] }}>
      <Glyph kind={kind} />
    </span>
  );
}
