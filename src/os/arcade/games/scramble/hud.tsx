// Pictures and sheets for Scramble's interface: weapon and item icons, the island map, and How to Play.
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AMMO_BOX, BOOST, MELEE, MELEE_IDS, RARITY_COLORS, RARITY_NAMES, SCOPES, THROWS, THROW_IDS, USES, USE_IDS, WALL_COST, WEAPONS, WEAPON_IDS, type Ammo, type GunClass, type MeleeId, type ThrowId, type UseId, type WeaponId } from './items';
import { HALF, type Building, type GameMap } from './map';
import type { Held } from './logic';

const Svg = ({ children, size = 28, label }: { children: ReactNode; size?: number; label?: string }) => (
  <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden={label ? undefined : true} role={label ? 'img' : undefined} aria-label={label}>
    {children}
  </svg>
);

const INK = '#f4f5f7';
const WOOD = '#c8935a';
const STEEL = '#c9d0d8';

/** Side-on silhouettes of whatever an egg can hold, muzzle (or business end) to the right. Null is the spatula. */
export function WeaponIcon({ w, size }: { w: Held | null; size?: number }) {
  switch (w) {
    case null:
    case 'spatula':
      return (
        <Svg size={size}>
          <path d="M4 22.5l11-6.5" stroke={WOOD} strokeWidth="3" strokeLinecap="round" />
          <path d="M14 13.5l9-5.2 4 6.8-9 5.2z" fill={INK} />
          <path d="M17 14.5l5.2-3M18.4 16.9l5.2-3" stroke="#8e98a6" strokeWidth="1" />
        </Svg>
      );
    case 'whisk':
      return (
        <Svg size={size}>
          <path d="M3.5 24l9-6" stroke={STEEL} strokeWidth="3" strokeLinecap="round" />
          <ellipse cx="20" cy="12.5" rx="8.5" ry="4" transform="rotate(-33 20 12.5)" fill="none" stroke={INK} strokeWidth="1.4" />
          <ellipse cx="20" cy="12.5" rx="8.5" ry="2" transform="rotate(-33 20 12.5)" fill="none" stroke={INK} strokeWidth="1.4" />
          <path d="M13 17.2l14.2-9.4" stroke={INK} strokeWidth="1.4" />
        </Svg>
      );
    case 'knife':
      return (
        <Svg size={size}>
          <path d="M3.5 23l6.5-4" stroke="#3a3d45" strokeWidth="3.6" strokeLinecap="round" />
          <path d="M10.5 18.2L28 7.8c.9 2.2-.7 5-3.6 6.7L12.3 21.2z" fill={INK} />
        </Svg>
      );
    case 'cleaver':
      return (
        <Svg size={size}>
          <path d="M3.5 24l6.5-4" stroke={WOOD} strokeWidth="3.4" strokeLinecap="round" />
          <path d="M10 18.5l3-12 15 3.8-3.4 13.1z" fill={INK} />
          <circle cx="23.5" cy="11.5" r="1.3" fill="#8e98a6" />
        </Svg>
      );
    case 'pan':
      return (
        <Svg size={size}>
          <path d="M3 25l9-6" stroke="#3a3d45" strokeWidth="3" strokeLinecap="round" />
          <circle cx="20" cy="13" r="8.5" fill="#2b2d33" stroke="#7a808a" strokeWidth="1.5" />
          <circle cx="20" cy="13" r="5.5" fill="#3a3d45" />
        </Svg>
      );
    case 'pin':
      return (
        <Svg size={size}>
          <rect x="7" y="11.5" width="18" height="9" rx="4.5" fill="#d6b27c" />
          <path d="M2 16h5M25 16h5" stroke="#8a5a2b" strokeWidth="3" strokeLinecap="round" />
        </Svg>
      );
    case 'grenade':
      return (
        <Svg size={size}>
          <path d="M16 9c-4.2 0-6.8 5.2-6.8 9.3a6.8 6.8 0 0 0 13.6 0C22.8 14.2 20.2 9 16 9z" fill="#6f9f45" />
          <path d="M12 15.5h8M11 19.5h10" stroke="#4d7330" strokeWidth="1.3" />
          <rect x="13.5" y="5.5" width="5" height="3.8" rx="1" fill="#9aa3ad" />
          <circle cx="21.5" cy="6.5" r="2.4" fill="none" stroke="#9aa3ad" strokeWidth="1.3" />
        </Svg>
      );
    case 'flour':
      return (
        <Svg size={size}>
          <path d="M9.5 12.5c0-2.8 2.9-4 6.5-4s6.5 1.2 6.5 4l2 13.5H7.5z" fill="#f3eee2" />
          <path d="M12 9l1.5-3h5L20 9" fill="none" stroke="#b89a6a" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M16 15v7M16 17l-2.4-1.6M16 17l2.4-1.6M16 20l-2.4-1.6M16 20l2.4-1.6" stroke="#c9a85a" strokeWidth="1.2" strokeLinecap="round" />
        </Svg>
      );
    case 'sauce':
      return (
        <Svg size={size}>
          <path d="M14 8h4v4l3 3.5V26a2 2 0 0 1-2 2h-6a2 2 0 0 1-2-2V15.5l3-3.5z" fill="#d2321e" />
          <rect x="13.5" y="4" width="5" height="4.5" rx="1" fill="#3f9a4a" />
          <path d="M13.5 19.5c1-2.6 4-2.6 5 0-.6 2.4-4.4 2.4-5 0z" fill="#ffd23d" />
        </Svg>
      );
    case 'pistol':
      return (
        <Svg size={size}>
          <path d="M6 11h19v4.5H14l-1.4 7.5H8.2l1.5-7.5H6z" fill={INK} />
        </Svg>
      );
    case 'revolver':
      return (
        <Svg size={size}>
          <path d="M8 11h21v3.2H18.5v3.3h-4.6l-1.6 6.5H7.8l1.8-6.6H8z" fill={INK} />
          <rect x="12" y="12.3" width="6.5" height="5" rx="2" fill="#9aa3ad" />
          <path d="M9.5 18l2.5 2" stroke="#3a3d45" strokeWidth="1" />
        </Svg>
      );
    case 'smg':
      return (
        <Svg size={size}>
          <path d="M3 12h22v2h3v3h-3v1H15l-1 6h-4l1-6H8l-1 3H3z" fill={INK} />
          <path d="M16.5 18h3l-.6 6h-3z" fill={INK} />
        </Svg>
      );
    case 'micro':
      return (
        <Svg size={size}>
          <path d="M7 12h15v2h4v2.6h-4V18h-6.5l-1 2.2V24H11v-4l-.8-2H7z" fill={INK} />
          <path d="M16.6 18h2.8v8.5h-2.8z" fill="#9aa3ad" />
        </Svg>
      );
    case 'rifle':
      return (
        <Svg size={size}>
          <path d="M1.5 13h7l1.5-2h11v2h9.5v2.5H20v2.5h-6l-1.2 5.5H9.5l1.2-5.5H6.5l-2.5 3H1.5z" fill={INK} />
          <path d="M14.5 18h3.5l-1 5h-3.3z" fill={INK} />
        </Svg>
      );
    case 'burst':
      return (
        <Svg size={size}>
          <path d="M2 13h21v2.4h7V18h-9l-1.5 2.5h-3.6L17 24h-3.4l-1.3-6H2z" fill="#d9c49a" />
          <path d="M8 10.5h12v2.5H8z" fill={INK} />
          <path d="M5 18h4l-1 4.5H4.6z" fill="#d9c49a" />
        </Svg>
      );
    case 'scout':
      return (
        <Svg size={size}>
          <path d="M1.5 15.5l5-1.5h9v-1H30v2H17v2.5h-4.5l-1 3.5H8.6l.8-3.5H6l-3 2.5H1.5z" fill="#c7d39a" />
          <rect x="9" y="9.6" width="7" height="2.6" rx="1.3" fill={INK} />
        </Svg>
      );
    case 'lmg':
      return (
        <Svg size={size}>
          <path d="M1 12.5h23v1.5h7v2.6h-7V18H13v4.5H8.5V18H1z" fill={INK} />
          <rect x="13.5" y="18.5" width="6" height="5" rx="1" fill="#c7d39a" />
          <path d="M26 17l-2 7M26 17l2.5 7" stroke={INK} strokeWidth="1.3" strokeLinecap="round" />
        </Svg>
      );
    case 'shotgun':
      return (
        <Svg size={size}>
          <path d="M2 16.5l7-2.5h21v3H13l-2 2H8l-4 3.5H2z" fill={WOOD} />
          <path d="M10 12.5h20v1.6H10z" fill={INK} />
          <path d="M14 17h7v2h-7z" fill={INK} />
        </Svg>
      );
    case 'auto':
      return (
        <Svg size={size}>
          <path d="M2 15.5l6-2.2h22v3.4H16l-1.2 1.6h-3.4v-1.4H8l-3.6 3.2H2z" fill={INK} />
          <circle cx="14.5" cy="21" r="3.6" fill="#9aa3ad" />
        </Svg>
      );
    case 'double':
      return (
        <Svg size={size}>
          <path d="M2 18l7-2.7h4v3l-2 2H8l-4 3.3H2z" fill={WOOD} />
          <path d="M10 12.2h20v1.6H10zM10 14.6h20v1.6H10z" fill={INK} />
        </Svg>
      );
    case 'sniper':
      return (
        <Svg size={size}>
          <path d="M1 15.5l5-1.5h10v-1h15v2H18v2.5h-5l-1 4H9l.8-4H6l-3 2.5H1z" fill={INK} />
          <rect x="9" y="9.5" width="8" height="2.6" rx="1.3" fill={INK} />
          <path d="M11 12.1v1.4M15 12.1v1.4" stroke={INK} strokeWidth="1.2" />
        </Svg>
      );
    case 'crossbow':
      return (
        <Svg size={size}>
          <path d="M3 17.5h17" stroke={WOOD} strokeWidth="3.4" strokeLinecap="round" />
          <path d="M21 6.5c4 3.2 4 18 0 21" fill="none" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />
          <path d="M21 6.5L14.5 17 21 27.5" fill="none" stroke="#9aa3ad" strokeWidth="0.9" />
          <path d="M9 16h20" stroke={INK} strokeWidth="1.5" strokeLinecap="round" />
          <path d="M29 16l-3-2v4z" fill={INK} />
        </Svg>
      );
    case 'launcher':
      return (
        <Svg size={size}>
          <rect x="2" y="11" width="24" height="6.5" rx="2" fill="#8fb36a" />
          <ellipse cx="27.5" cy="14.2" rx="2.8" ry="3.6" fill="#fffaf0" />
          <path d="M10 17.5h4l-1 5.5H9.5z" fill={INK} />
        </Svg>
      );
  }
}

export const AMMO_FILL: Record<Ammo, string> = { light: '#f2c94c', heavy: '#6fcf97', shells: '#eb5757', rockets: '#bb6bd9' };

export function AmmoIcon({ a, size }: { a: Ammo; size?: number }) {
  const fill = AMMO_FILL[a];
  return (
    <Svg size={size}>
      {a === 'rockets' ? (
        <ellipse cx="16" cy="16" rx="6.5" ry="9" fill="#fffaf0" stroke={fill} strokeWidth="2.5" />
      ) : (
        [8, 14, 20].map((x) => <path key={x} d={`M${x} 25V12a2.5 3.5 0 0 1 5 0v13z`} fill={fill} stroke="rgba(0,0,0,0.35)" strokeWidth="1" />)
      )}
    </Svg>
  );
}

export function BandageIcon({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <rect x="4" y="10" width="24" height="12" rx="4" fill="#fff" stroke="#c9ced6" strokeWidth="1.2" />
      <path d="M16 12.5v7M12.5 16h7" stroke="#e53935" strokeWidth="2.6" strokeLinecap="round" />
    </Svg>
  );
}

export function ShieldIcon({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M13 4h6v4.5l4.5 6.5v10a3 3 0 0 1-3 3h-9a3 3 0 0 1-3-3V15L13 8.5z" fill="#3f8cff" stroke="#bcd7ff" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M11 17.5h10" stroke="#bcd7ff" strokeWidth="1.2" />
      <rect x="12.5" y="2.5" width="7" height="3" rx="1" fill="#f4f5f7" />
    </Svg>
  );
}

/** A consumable's picture. */
export function UseIcon({ w, size }: { w: UseId; size?: number }) {
  switch (w) {
    case 'bandage':
      return <BandageIcon size={size} />;
    case 'shield':
      return <ShieldIcon size={size} />;
    case 'medkit':
      return (
        <Svg size={size}>
          <rect x="4" y="9" width="24" height="17" rx="3" fill="#fff" stroke="#c9ced6" strokeWidth="1.2" />
          <path d="M12 9V6.5h8V9" fill="none" stroke="#9aa3ad" strokeWidth="2" />
          <path d="M16 12.5v10M11 17.5h10" stroke="#e53935" strokeWidth="3.2" strokeLinecap="round" />
        </Svg>
      );
    case 'mini':
      return (
        <Svg size={size}>
          <circle cx="16" cy="19" r="8" fill="#6fb6ff" stroke="#d6eaff" strokeWidth="1.2" />
          <rect x="13" y="6" width="6" height="6" rx="1" fill="#f4f5f7" />
          <path d="M11.5 18h9" stroke="#d6eaff" strokeWidth="1.2" />
        </Svg>
      );
    case 'coffee':
      return (
        <Svg size={size}>
          <path d="M8 11h15l-1.8 15a2 2 0 0 1-2 1.8H11.8a2 2 0 0 1-2-1.8z" fill="#fff3df" />
          <path d="M8.6 16h13.8l-.7 5.5H9.3z" fill="#8a5a2b" />
          <rect x="7" y="8.5" width="17" height="3" rx="1.2" fill="#7a4a2a" />
          <path d="M13 6c-1-1.5 1-2.2 0-3.7M17.5 6c-1-1.5 1-2.2 0-3.7" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" fill="none" opacity="0.8" />
        </Svg>
      );
  }
}

export function ScopeIcon({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <circle cx="16" cy="16" r="10" fill="none" stroke={INK} strokeWidth="2.4" />
      <path d="M16 4v8M16 20v8M4 16h8M20 16h8" stroke={INK} strokeWidth="1.6" />
      <circle cx="16" cy="16" r="1.6" fill="#e53935" />
    </Svg>
  );
}

export function PackIcon({ size, lv = 1 }: { size?: number; lv?: number }) {
  const fill = RARITY_COLORS[Math.min(4, lv + 1)];
  return (
    <Svg size={size}>
      <path d="M8 13a8 8 0 0 1 16 0v13a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2z" fill={fill} />
      <path d="M12 8.5V6a4 4 0 0 1 8 0v2.5" fill="none" stroke={fill} strokeWidth="2" />
      <rect x="11" y="18" width="10" height="6" rx="1.5" fill="rgba(0,0,0,0.25)" />
    </Svg>
  );
}

export function WoodIcon({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <rect x="3" y="18" width="26" height="6" rx="2" fill="#c8935a" stroke="#7a4f22" strokeWidth="1" />
      <rect x="5" y="11" width="22" height="6" rx="2" fill="#d9a46a" stroke="#7a4f22" strokeWidth="1" transform="rotate(-8 16 14)" />
    </Svg>
  );
}

export function EggIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d="M12 2.5c-4 0-7 6.3-7 11a7 7 0 0 0 14 0c0-4.7-3-11-7-11z" fill="#fff6e8" />
    </svg>
  );
}

const MAP_ROOF: Record<Building['kind'], string> = { house: '#b5523b', farm: '#8b2f23', shed: '#7a5534', warehouse: '#6f7c88', container: '#4f6d8f', ruin: '#a39e93', coop: '#f5b301' };

/** The island drawn in map coordinates (x right, north up), for the minimap and the big map. */
export function IslandArt({ map }: { map: GameMap }) {
  const coop = map.buildings[map.coop];
  return (
    <>
      <rect x={-HALF - 14} y={-HALF - 14} width={2 * HALF + 28} height={2 * HALF + 28} fill="#3aa6d4" />
      <rect x={-HALF} y={-HALF} width={2 * HALF} height={2 * HALF} rx="4" fill="#e9d7a6" />
      <rect x={-HALF + 8} y={-HALF + 8} width={2 * HALF - 16} height={2 * HALF - 16} fill="#6dab4f" />
      {map.ponds.map((p, i) => (
        <circle key={`p${i}`} cx={p.x} cy={p.z} r={p.r} fill="#4cb3dc" stroke="#d8c690" strokeWidth="1.5" />
      ))}
      {map.fields.map((f, i) => (
        <rect key={`f${i}`} x={f.x - f.hw} y={f.z - f.hd} width={f.hw * 2} height={f.hd * 2} fill="#b8a640" />
      ))}
      {map.trees.map((t, i) => (
        <circle key={`t${i}`} cx={t.x} cy={t.z} r="2" fill="#3f8f3a" />
      ))}
      {map.rocks.map((r, i) => (
        <circle key={`r${i}`} cx={r.x} cy={r.z} r={r.r} fill="#9aa0a6" />
      ))}
      {map.buildings.map((b, i) => (
        <rect key={`b${i}`} x={b.x - b.w / 2} y={b.z - b.d / 2} width={b.w} height={b.d} fill={MAP_ROOF[b.kind]} stroke={b.kind === 'ruin' ? 'none' : '#f1e6d2'} strokeWidth="1" />
      ))}
      {coop && <path d={star(coop.x, coop.z, 9)} fill="#ffd23d" stroke="#7a4a00" strokeWidth="1.4" strokeLinejoin="round" />}
    </>
  );
}

/** A five-pointed star centered on (x, y). */
export function star(x: number, y: number, r: number) {
  let d = '';
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    const k = i % 2 ? r * 0.45 : r;
    d += `${i ? 'L' : 'M'}${(x + Math.cos(a) * k).toFixed(1)} ${(y + Math.sin(a) * k).toFixed(1)}`;
  }
  return `${d}Z`;
}

/** A sheet over the whole game (portaled into the shell so it covers the Start and Pause cards). */
function Sheet({ root, title, onClose, children }: { root: HTMLElement | null; title: string; onClose: () => void; children: ReactNode }) {
  const close = useRef<HTMLButtonElement>(null);
  const done = useRef(onClose);
  done.current = onClose;
  useEffect(() => {
    close.current?.focus({ preventScroll: true });
    // While the sheet is open its keys stay in it: Escape closes it, and nothing reaches the game behind (Space would
    // start a match, Escape would resume one). Buttons inside still work, their clicks are not key listeners.
    const onKey = (e: KeyboardEvent) => {
      if (!root?.contains(e.target as Node)) return;
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        done.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [root]);
  if (!root) return null;
  return createPortal(
    <div
      className="g-scramble-sheet"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onPointerDown={(e) => {
        // keep the shell from taking focus back to the game
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="g-scramble-sheet-card">
        <header>
          <h2>{title}</h2>
          <button type="button" ref={close} className="arcade-btn" onClick={onClose}>
            Done
          </button>
        </header>
        <div className="g-scramble-sheet-body">{children}</div>
      </div>
    </div>,
    root,
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const AMMO_NAME: Record<Ammo, string> = { light: 'Light ammo', heavy: 'Heavy ammo', shells: 'Shells', rockets: 'Eggs' };
const GUN_HELP: Record<WeaponId, string> = {
  pistol: 'Steady and accurate.',
  revolver: 'Slow, but each shot hits like a truck.',
  smg: 'Sprays fast up close.',
  micro: 'The quickest trigger on the island. Shreds at short range.',
  rifle: 'The all-rounder: quick, accurate, long reach.',
  burst: 'Three rounds a pull, dead on target.',
  scout: 'A marksman rifle with a scope built in.',
  lmg: 'An 80-round belt. You walk slower carrying it.',
  shotgun: 'Nine pellets. Huge up close, weak far off.',
  auto: 'Fires as fast as you pull, a little weaker a shot.',
  double: 'Two barrels, then a reload. Brutal at arm’s length.',
  sniper: 'A hundred a hit, and you see much farther holding it.',
  crossbow: 'Silent: firing it doesn’t give away your bush.',
  launcher: 'Lobs an egg that bursts on impact and flattens walls.',
};
const GUN_GROUPS: [GunClass, string][] = [
  ['pistol', 'Pistols'],
  ['smg', 'SMGs'],
  ['rifle', 'Rifles'],
  ['shotgun', 'Shotguns'],
  ['sniper', 'Long range'],
  ['heavy', 'Heavy'],
];
const MELEE_HELP: Record<MeleeId, string> = {
  spatula: 'Everyone starts with one. Chops wood from trees and smacks crates.',
  whisk: 'Twice as quick, half the bite.',
  knife: 'Long reach, and you run fastest holding it.',
  cleaver: 'The hardest hitter in the drawer.',
  pan: 'Stops bullets: from the front while you hold it, from behind while it hangs on your back.',
  pin: 'Chops wood twice as fast and knocks walls and crates flat.',
};
const THROW_HELP: Record<ThrowId, string> = {
  grenade: `Goes off ${THROWS.grenade.fuse} seconds after you throw it.`,
  flour: 'Bursts into a cloud. Nobody outside it can see in, or through it.',
  sauce: 'Splashes a burning puddle that hurts anyone standing in it, you too.',
};
const USE_HELP: Record<UseId, string> = {
  bandage: `+${USES.bandage.hp} health, up to ${USES.bandage.hpCap}.`,
  medkit: 'Back to full health, but it takes a while.',
  mini: `+${USES.mini.shield} shield, up to ${USES.mini.shieldCap}.`,
  shield: `+${USES.shield.shield} shield, all the way to 100.`,
  coffee: `Boost: heals a little at a time and puts a spring in your step for ${Math.round((USES.coffee.boost ?? 0) / BOOST.drain)} seconds.`,
};
/** The number keys that use each consumable. */
export const USE_KEYS: Record<UseId, string> = { bandage: '5', medkit: '6', mini: '7', shield: '8', coffee: '9' };

export function HowToPlay({ root, touch, onClose }: { root: HTMLElement | null; touch: boolean; onClose: () => void }) {
  return (
    <Sheet root={root} title="How to Play" onClose={onClose}>
      <p className="g-scramble-lede">Twenty eggs drop onto the island. Grab guns, crack the others, and stay inside the circle as the storm closes in. The last egg standing wins.</p>
      <section>
        <h3>Controls</h3>
        <dl className="g-scramble-keys">
          {touch ? (
            <>
              <dt>left thumb</dt>
              <dd>Drag anywhere on the left to walk</dd>
              <dt>right thumb</dt>
              <dd>Drag on the right to aim; push it out to shoot. With a throwable out, let go to throw: the farther you push, the farther it goes</dd>
              <dt>jump</dt>
              <dd>Leave the bus</dd>
              <dt>slots</dt>
              <dd>Tap a weapon at the bottom to hold it. Tap the throwable again to switch kinds</dd>
              <dt>wall</dt>
              <dd>Build a wall in front of you ({WALL_COST} wood)</dd>
              <dt>reload</dt>
              <dd>Reload (it also happens on its own when you run dry)</dd>
              <dt>+, shield, coffee</dt>
              <dd>Heal, top up your shield, or drink a coffee. The right item is picked for you</dd>
              <dt>pick up</dt>
              <dd>Shows up when you stand on something or next to a chest</dd>
            </>
          ) : (
            <>
              <dt>W A S D</dt>
              <dd>Walk (the arrow keys work too)</dd>
              <dt>mouse</dt>
              <dd>Aim; click to shoot, hold for automatic fire. Throwables land where you point</dd>
              <dt>Space</dt>
              <dd>Jump from the bus, then build a wall where you aim ({WALL_COST} wood). Right click builds too</dd>
              <dt>E or F</dt>
              <dd>Pick up, swap, open chests and supply drops</dd>
              <dt>R</dt>
              <dd>Reload</dd>
              <dt>1 2 3 4</dt>
              <dd>Your two guns, your melee weapon and your throwables (4 again switches kinds). Q or the wheel cycles</dd>
              <dt>5 to 9</dt>
              <dd>Bandage, medkit, mini shield, shield potion, coffee</dd>
              <dt>H, G, C</dt>
              <dd>Heal, top up your shield, or drink a coffee, picking the right item for you</dd>
              <dt>M</dt>
              <dd>The island map</dd>
            </>
          )}
        </dl>
      </section>
      <section>
        <h3>The match</h3>
        <ul>
          <li>
            <b>The bus.</b> It flies across the island. Jump any time while it's over land, then glide down and steer to where you want to land.
          </li>
          <li>
            <b>Loot.</b> Guns, ammo, healing and more lie in buildings and around the island. Smash crates and open the golden chests for better ones. Walking over ammo, healing and throwables picks them up.
          </li>
          <li>
            <b>Health and shield.</b> You have 100 health and up to 100 shield, which takes hits first.
          </li>
          <li>
            <b>The storm.</b> The white ring shows where the safe circle is heading. Outside the circle the storm eats your health (shields don't help), and it bites harder each time it closes.
          </li>
          <li>
            <b>Supply drops.</b> Three times a match a crate floats down under a balloon inside the next circle, with a beam of light over it. They're full of epic and legendary gear.
          </li>
          <li>
            <b>Walls.</b> Swing at trees for wood, then throw up walls for cover. They take a beating before they break.
          </li>
        </ul>
      </section>
      <section>
        <h3>Around the island</h3>
        <ul>
          <li>
            <b>Houses, farmhouses and sheds.</b> Loot inside, often a chest. The roof lifts off while you're in, and nobody outside can see you.
          </li>
          <li>
            <b>Warehouses.</b> Full of crates, with a chest in a corner and barrels outside.
          </li>
          <li>
            <b>Shipping containers.</b> Rows of them, each open at one end. Good cover, and sometimes something inside.
          </li>
          <li>
            <b>The Golden Coop.</b> The gold-roofed building with a star on the map. One way in, and a golden chest at the back full of legendary gear.
          </li>
          <li>
            <b>Bushes and cornfields.</b> Stand in one and nobody sees you from a distance until you fire.
          </li>
          <li>
            <b>Barrels.</b> Shoot or smack one and it blows up, hurting everyone nearby and setting off other barrels.
          </li>
          <li>
            <b>Ponds.</b> You can wade through, but slowly.
          </li>
          <li>
            <b>Ruins.</b> Broken walls and no roof: cover, but nowhere to hide.
          </li>
        </ul>
      </section>
      <section>
        <h3>Guns</h3>
        <p>
          Better guns hit harder and reload faster:{' '}
          {RARITY_NAMES.map((name, i) => (
            <span key={name}>
              <b style={{ color: RARITY_COLORS[i] }}>{name}</b>
              {i < RARITY_NAMES.length - 1 ? ', ' : '.'}
            </span>
          ))}
        </p>
        {GUN_GROUPS.map(([cls, title]) => (
          <div key={cls}>
            <h4 className="g-scramble-sub">{title}</h4>
            <ul className="g-scramble-guns">
              {WEAPON_IDS.filter((w) => WEAPONS[w].cls === cls).map((w) => (
                <li key={w}>
                  <WeaponIcon w={w} size={34} />
                  <span>
                    <b>{cap(WEAPONS[w].name)}.</b> {GUN_HELP[w]} <small>{AMMO_NAME[WEAPONS[w].ammo]}.</small>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <p className="g-scramble-small">
          An ammo box holds {AMMO_BOX.light} light, {AMMO_BOX.heavy} heavy, {AMMO_BOX.shells} shells or {AMMO_BOX.rockets} eggs.
        </p>
      </section>
      <section>
        <h3>Melee</h3>
        <p>Everyone carries one. Find a better one and {touch ? 'tap pick up' : 'press E'} to swap.</p>
        <ul className="g-scramble-guns">
          {MELEE_IDS.map((w) => (
            <li key={w}>
              <WeaponIcon w={w} size={34} />
              <span>
                <b>{cap(MELEE[w].name)}.</b> {MELEE_HELP[w]}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3>Throwables</h3>
        <ul className="g-scramble-guns">
          {THROW_IDS.map((w) => (
            <li key={w}>
              <WeaponIcon w={w} size={34} />
              <span>
                <b>{cap(THROWS[w].name)}.</b> {THROW_HELP[w]}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3>Items</h3>
        <ul className="g-scramble-guns">
          {USE_IDS.map((w) => (
            <li key={w}>
              <UseIcon w={w} size={30} />
              <span>
                <b>
                  {cap(USES[w].name)}
                  {touch ? '' : ` (${USE_KEYS[w]})`}.
                </b>{' '}
                {USE_HELP[w]}
              </span>
            </li>
          ))}
          <li>
            <ScopeIcon size={30} />
            <span>
              <b>Scopes.</b> {SCOPES.slice(1).join(', ')}: each lets you see farther around you.
            </span>
          </li>
          <li>
            <PackIcon size={30} lv={2} />
            <span>
              <b>Backpacks.</b> Three levels, each carrying more ammo, healing and throwables.
            </span>
          </li>
        </ul>
      </section>
      <section>
        <h3>Online</h3>
        <p>Up to eight friends in one room. The host adds computer eggs with Bots, then picks whether more fill the island up to twenty and how sharp they are.</p>
      </section>
    </Sheet>
  );
}
