// Pictures and sheets for Scramble's interface: weapon and item icons, the island map, and How to Play.
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AMMO_BOX, ARMOR_CUT, ARMOR_NAMES, BOOST, FLARE_WAIT, MELEE, MELEE_IDS, RARITY_COLORS, RARITY_NAMES, SCOPES, SIP, THROWS, THROW_IDS, USES, USE_IDS, MAT_SPECS, PIECE_COST, WEAPONS, WEAPON_IDS, type Ammo, type ArmorKind, type GunClass, type Mat, type MeleeId, type ThrowId, type UseId, type WeaponId } from './items';
import { BLEED_T, EMOTE_T, LEADER_MIN, MAT_DROP, REVIVE_HP, REVIVE_T, VAULT_TIME, type EmoteId } from './logic';
import { CAMP, DEEP, HALF, PAD, RIVER_HALF, ROAD_HALF, containerHalf, furnitureSolid, isDeep, type Building, type Door, type GameMap } from './map';
import type { Held, Plan } from './logic';

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
    case 'impulse':
      // an egg with a bolt on it, and the shove rippling out either side
      return (
        <Svg size={size}>
          <path d="M5.5 11.5a11 11 0 0 0 0 10M26.5 11.5a11 11 0 0 1 0 10M2.2 9a15 15 0 0 0 0 15M29.8 9a15 15 0 0 1 0 15" fill="none" stroke="#bcd7ff" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M16 6.5c-4 0-6.6 5.4-6.6 9.6a6.6 6.6 0 0 0 13.2 0C22.6 11.9 20 6.5 16 6.5z" fill="#4aa8ff" />
          <path d="M17.2 9.5l-4.2 7h3.2l-1.4 6 4.6-7.6h-3.2z" fill="#fff" />
        </Svg>
      );
    case 'jam':
      // a jar of jam with a checked lid and a label
      return (
        <Svg size={size}>
          <rect x="8" y="10" width="16" height="18" rx="3.5" fill="#a3214a" />
          <rect x="7" y="5.5" width="18" height="5" rx="1.3" fill="#fff3df" stroke="#c9a85a" strokeWidth="1" />
          <path d="M10 5.5v5M14 5.5v5M18 5.5v5M22 5.5v5" stroke="#e53935" strokeWidth="1.2" />
          <rect x="11" y="15" width="10" height="7.5" rx="1.5" fill="#fff3df" />
          <circle cx="16" cy="18.7" r="2" fill="#a3214a" />
        </Svg>
      );
    case 'mirv':
      // a red canister with a black band and three bomblets on top, and the scatter they make
      return (
        <Svg size={size}>
          <rect x="10.5" y="12" width="11" height="15" rx="3" fill="#c0392b" />
          <rect x="10.5" y="17.5" width="11" height="3" fill="#2b2d33" />
          <circle cx="11.5" cy="9.5" r="2.6" fill="#6f9f45" />
          <circle cx="16" cy="7.5" r="2.6" fill="#6f9f45" />
          <circle cx="20.5" cy="9.5" r="2.6" fill="#6f9f45" />
          <path d="M4 6l2 1.5M28 6l-2 1.5M3.5 12.5h2.4M28.5 12.5h-2.4" stroke="#ffb07a" strokeWidth="1.4" strokeLinecap="round" />
        </Svg>
      );
    case 'stun':
      // a pale blue can with white bands, a ring pull, and the flash bursting off it
      return (
        <Svg size={size}>
          <path d="M16 2.5v3.5M8 5.5l2 3M24 5.5l-2 3M4.5 12.5h3M27.5 12.5h-3" stroke="#fff6c9" strokeWidth="1.6" strokeLinecap="round" />
          <rect x="11" y="11" width="10" height="17" rx="2.5" fill="#9fb8d6" />
          <rect x="11" y="14" width="10" height="2.2" fill="#fff" />
          <rect x="11" y="23" width="10" height="2.2" fill="#fff" />
          <rect x="14" y="8" width="4" height="3.5" rx="1" fill="#9aa3ad" />
          <circle cx="20" cy="8.5" r="2.2" fill="none" stroke="#c9d0d8" strokeWidth="1.3" />
        </Svg>
      );
    case 'bush':
      // a tin can with a bush bursting out of the top
      return (
        <Svg size={size}>
          <rect x="10" y="16" width="12" height="12" rx="1.5" fill="#c9d0d8" stroke="#8e98a6" strokeWidth="1" />
          <rect x="10" y="19.5" width="12" height="5" fill="#3f9a4a" />
          <circle cx="11.5" cy="12" r="4.5" fill="#3f8f3a" />
          <circle cx="20.5" cy="12" r="4.5" fill="#3f8f3a" />
          <circle cx="16" cy="8.5" r="5" fill="#56a648" />
        </Svg>
      );
    case 'pistol':
      return (
        <Svg size={size}>
          <path d="M6 11h19v4.5H14l-1.4 7.5H8.2l1.5-7.5H6z" fill={INK} />
        </Svg>
      );
    case 'flare':
      // a stubby orange pistol with a wide mouth and the flare glowing in it
      return (
        <Svg size={size}>
          <path d="M4.5 11h17.5a2.5 2.5 0 0 1 2.5 2.5v2.5H14.5l-1.5 7.5H8.4l1.5-7.5H4.5z" fill="#ff7a2f" />
          <circle cx="26" cy="13.5" r="3.6" fill="#ffd23d" stroke="#e5531f" strokeWidth="1.3" />
          <path d="M27.5 7l1.4-3M30 9.5l1.6-1.4" stroke="#ffd23d" strokeWidth="1.4" strokeLinecap="round" />
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
    case 'hsmg':
      // a chunky SMG with a fat box of heavy rounds and a front grip
      return (
        <Svg size={size}>
          <path d="M2 11h21v2.5h5v3h-5V18H15.5l-1.2 6h-4.2l1-6H8l-1.5 3.2H2z" fill={INK} />
          <rect x="15.5" y="17.5" width="4.4" height="9" rx="1" fill="#6fcf97" />
          <path d="M22 18.5l-1.2 4.5" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
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
    case 'marksman':
      // a long tan rifle with a scope and a short magazine
      return (
        <Svg size={size}>
          <path d="M1.5 14.2l4.5-1.4h11v-1H31v2.3H19.5v2.4h-5.2l-1.2 4.6H9.7l.9-4.6H6.5l-3 2.2h-2z" fill="#d9c49a" />
          <rect x="8.5" y="8.4" width="8.5" height="2.8" rx="1.4" fill={INK} />
          <path d="M10.5 11.2v1.6M15 11.2v1.6" stroke={INK} strokeWidth="1.2" />
          <rect x="15" y="16.5" width="3.2" height="5.5" rx="0.8" fill={INK} />
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
    case 'minigun':
      // a drum of a body, a bundle of barrels, and a belt of light rounds over the top
      return (
        <Svg size={size}>
          <path d="M5 7.5c3-2 7-2 9.5 0" fill="none" stroke="#f2c94c" strokeWidth="2.4" strokeLinecap="round" />
          <rect x="2.5" y="9.5" width="12" height="12" rx="3" fill={INK} />
          <path d="M14.5 12h15M14.5 15.5h15M14.5 19h15" stroke="#9aa3ad" strokeWidth="2.3" strokeLinecap="round" />
          <rect x="25.5" y="10" width="2.4" height="11" rx="1" fill={INK} />
          <path d="M6.5 21.5l-1.5 5h4.2l1-5z" fill={INK} />
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
    case 'smoothie':
      // a pink smoothie with berries in it, a lid and a straw
      return (
        <Svg size={size}>
          <path d="M9 11h14l-1.9 15.4a2 2 0 0 1-2 1.8h-6.2a2 2 0 0 1-2-1.8z" fill="#ff6fa8" />
          <path d="M9.6 16h12.8" stroke="#bcd7ff" strokeWidth="1.6" />
          <circle cx="13.5" cy="20" r="1.7" fill="#a3214a" />
          <circle cx="18.2" cy="23" r="1.5" fill="#a3214a" />
          <rect x="8" y="8.5" width="16" height="3" rx="1.2" fill="#fff3df" />
          <path d="M17.5 8.5l2.6-6.5h3.4" fill="none" stroke="#4aa8ff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      );
    case 'tart':
      // a golden egg tart, crimped round the edge, with a sparkle
      return (
        <Svg size={size}>
          <path d="M3.5 17.5h25l-2.6 7.4a2 2 0 0 1-1.9 1.3H8a2 2 0 0 1-1.9-1.3z" fill="#d9952b" />
          <path d="M8.5 21.5v3M12.5 21.5v3.5M16 21.5v3.5M19.5 21.5v3.5M23.5 21.5v3" stroke="#a8691c" strokeWidth="1.2" />
          <ellipse cx="16" cy="17.5" rx="12.5" ry="4.2" fill="#ffd23d" stroke="#d9952b" strokeWidth="1.8" />
          <ellipse cx="13" cy="16.6" rx="4" ry="1.2" fill="#fff3a8" />
          <path d="M24 4l1.1 2.6 2.7.3-2 1.8.6 2.7-2.4-1.4-2.4 1.4.6-2.7-2-1.8 2.7-.3z" fill="#fff6c9" />
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

/** A helmet (a colander, saucepan or stockpot upside down) or a vest (an apron), in its level's color. */
export function ArmorIcon({ kind, size, lv = 1 }: { kind: ArmorKind; size?: number; lv?: number }) {
  const fill = RARITY_COLORS[Math.min(4, lv + 1)];
  const edge = 'rgba(0,0,0,0.35)';
  if (kind === 'vest')
    // an apron on its neck loop: a pocket at level 1, quilted at 2, steel plates at 3
    return (
      <Svg size={size}>
        <path d="M12 6.5c0-4.5 8-4.5 8 0M6.5 15.5l-3.5 2M25.5 15.5l3.5 2" fill="none" stroke={INK} strokeWidth="1.6" strokeLinecap="round" />
        <path d="M11 6h10v6l5 2.5V26a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V14.5l5-2.5z" fill={fill} stroke={edge} strokeWidth="1.2" strokeLinejoin="round" />
        {lv <= 1 && <rect x="11" y="18" width="10" height="6" rx="1.2" fill={edge} />}
        {lv === 2 && <path d="M7 18.5h18M7 23.5h18M13.5 7v20.5M18.5 7v20.5" stroke={edge} strokeWidth="1.1" />}
        {lv >= 3 && (
          <g fill={STEEL} stroke={edge} strokeWidth="0.8">
            <rect x="12.5" y="8" width="7" height="4" rx="0.8" />
            <rect x="8.5" y="15" width="15" height="5" rx="0.8" />
            <rect x="8.5" y="21.5" width="15" height="5" rx="0.8" />
          </g>
        )}
      </Svg>
    );
  // level 1 a colander dotted with holes, 2 a saucepan with its long handle, 3 a tall stockpot with a lid
  if (lv <= 1)
    return (
      <Svg size={size}>
        <path d="M5 20a11 11 0 0 1 22 0z" fill={fill} stroke={edge} strokeWidth="1.2" />
        <rect x="2.5" y="19.5" width="27" height="3.5" rx="1.75" fill={STEEL} stroke={edge} strokeWidth="1" />
        <path d="M11 13.5h.1M16 11.5h.1M21 13.5h.1M8.5 17.5h.1M13.5 16.5h.1M18.5 16.5h.1M23.5 17.5h.1" stroke={edge} strokeWidth="2.2" strokeLinecap="round" />
      </Svg>
    );
  if (lv === 2)
    return (
      <Svg size={size}>
        <path d="M21 16h8.5" stroke={INK} strokeWidth="3.4" strokeLinecap="round" />
        <rect x="4" y="12" width="18" height="12" rx="2.5" fill={fill} stroke={edge} strokeWidth="1.2" />
        <rect x="3" y="10" width="20" height="3.5" rx="1.75" fill={STEEL} stroke={edge} strokeWidth="1" />
      </Svg>
    );
  return (
    <Svg size={size}>
      <path d="M3.5 15h4M24.5 15h4" stroke={INK} strokeWidth="3" strokeLinecap="round" />
      <rect x="7" y="9" width="18" height="19" rx="2.5" fill={fill} stroke={edge} strokeWidth="1.2" />
      <path d="M6 9a10 3 0 0 1 20 0z" fill={STEEL} stroke={edge} strokeWidth="1" />
      <circle cx="16" cy="5" r="1.8" fill={STEEL} stroke={edge} strokeWidth="1" />
      <path d="M10 19h12" stroke={edge} strokeWidth="1.2" />
    </Svg>
  );
}

/** A ghillie suit: an egg shape covered in leafy tufts. */
export function GhillieIcon({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M16 4c-5 0-8.5 7.6-8.5 13.2a8.5 8.5 0 0 0 17 0C24.5 11.6 21 4 16 4z" fill="#4c7a2c" />
      {[
        [10, 15],
        [14, 10],
        [19, 9.5],
        [22, 15],
        [12, 21],
        [17, 18],
        [21, 22],
        [15, 25],
      ].map(([x, y]) => (
        <path key={`${x},${y}`} d={`M${x - 2.5} ${y + 1.5}q2.5-4 5 0q-2.5 1.6-5 0z`} fill={(x + y) % 3 ? '#7a9a3a' : '#3d6624'} />
      ))}
      <path d="M13 4.5l1-3M16 4l0-3.2M19 4.5l-1-3" stroke="#6b7f3a" strokeWidth="1.3" strokeLinecap="round" />
    </Svg>
  );
}

/** The kill leader's crown. */
export function CrownIcon({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M5 23l-1.5-12 6.5 5 6-9 6 9 6.5-5L27 23z" fill="#ffc83d" stroke="#a8691c" strokeWidth="1.2" strokeLinejoin="round" />
      <rect x="5" y="23" width="22" height="4" rx="1" fill="#ffd23d" stroke="#a8691c" strokeWidth="1.2" />
      <circle cx="16" cy="18.5" r="1.8" fill="#e53935" />
      <circle cx="10" cy="20" r="1.3" fill="#3f8cff" />
      <circle cx="22" cy="20" r="1.3" fill="#3f8cff" />
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

export function StoneIcon({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <rect x="3" y="17" width="12" height="9" rx="1.5" fill="#a7adb4" stroke="#5b6168" strokeWidth="1" />
      <rect x="16" y="17" width="13" height="9" rx="1.5" fill="#959ba3" stroke="#5b6168" strokeWidth="1" />
      <rect x="8" y="7" width="15" height="9" rx="1.5" fill="#b9bfc6" stroke="#5b6168" strokeWidth="1" />
    </Svg>
  );
}

export function MetalIcon({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <rect x="4" y="8" width="24" height="17" rx="2" fill="#b3bdc7" stroke="#4a5560" strokeWidth="1.2" />
      <path d="M16 8v17M4 16.5h24" stroke="#4a5560" strokeWidth="1.2" />
      {[7, 13, 19, 25].map((x) => (
        <circle key={x} cx={x} cy="11" r="1" fill="#eef3f7" />
      ))}
    </Svg>
  );
}

/** Wood, stone or metal. */
export function MatIcon({ mat, size }: { mat: Mat; size?: number }) {
  return mat === 'wood' ? <WoodIcon size={size} /> : mat === 'stone' ? <StoneIcon size={size} /> : <MetalIcon size={size} />;
}

/** The pieces on the build bar, seen at an angle: a wall, a ramp, a floor on its posts, a roof, and a box round an egg. */
export function PieceIcon({ k, size }: { k: Plan; size?: number }) {
  const face = '#ffd9a6';
  const edge = '#7a4f22';
  switch (k) {
    case 'wall':
      return (
        <Svg size={size}>
          <path d="M5 10l17-4v18l-17 4z" fill={face} stroke={edge} strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M5 16l17-4M5 22l17-4" stroke={edge} strokeWidth="1" opacity="0.6" />
          <path d="M22 6l5 2v18l-5-2" fill="#d9a46a" stroke={edge} strokeWidth="1.4" strokeLinejoin="round" />
        </Svg>
      );
    case 'ramp':
      return (
        <Svg size={size}>
          <path d="M3 27h24V7z" fill={face} stroke={edge} strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M9 22l3 0M14 18l3 0M19 14l3 0M24 10l3 0" stroke={edge} strokeWidth="1.6" strokeLinecap="round" />
        </Svg>
      );
    case 'floor':
      return (
        <Svg size={size}>
          <path d="M4 12l12-5 12 5-12 5z" fill={face} stroke={edge} strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M4 12v2l12 5 12-5v-2" fill="#d9a46a" stroke={edge} strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M6 15v12M26 15v12M16 19v9" stroke={edge} strokeWidth="1.8" strokeLinecap="round" />
        </Svg>
      );
    case 'roof':
      return (
        <Svg size={size}>
          <path d="M16 4L3 22l13 6 13-6z" fill={face} stroke={edge} strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M16 4v24" stroke={edge} strokeWidth="1.2" />
        </Svg>
      );
    default:
      return (
        <Svg size={size}>
          <path d="M5 9l11-4 11 4v14l-11 5-11-5z" fill="none" stroke={edge} strokeWidth="5" strokeLinejoin="round" />
          <path d="M5 9l11-4 11 4v14l-11 5-11-5z" fill="none" stroke={face} strokeWidth="2.6" strokeLinejoin="round" />
          <path d="M16 13.5c-1.6 0-2.8 2.6-2.8 4.6a2.8 2.8 0 0 0 5.6 0c0-2-1.2-4.6-2.8-4.6z" fill="#fff6e8" />
        </Svg>
      );
  }
}

/** The edit key: a wall with a doorway cut in it. */
export function EditIcon({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M4 7h24v20H19v-9h-6v9H4z" fill="#ffd9a6" stroke="#7a4f22" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M22 3l5 5-9 9-6 1 1-6z" fill="#ffd75e" stroke="#3a2a10" strokeWidth="1.2" strokeLinejoin="round" />
    </Svg>
  );
}

/** A ping: a pin stuck in the ground, in the pinger's color. */
export function PingIcon({ size = 16, color = '#2ee6c9' }: { size?: number; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <ellipse cx="12" cy="20.5" rx="5" ry="1.6" fill="rgba(0, 0, 0, 0.3)" />
      <path d="M12 2.5a6 6 0 0 0-6 6c0 4.4 6 11.5 6 11.5s6-7.1 6-11.5a6 6 0 0 0-6-6z" fill={color} stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="12" cy="8.5" r="2.2" fill="#fff" />
    </svg>
  );
}

/** An egg's face for an emote: happy, sad or angry. */
function EggFace({ size, mood }: { size?: number; mood: 'happy' | 'sad' | 'angry' }) {
  return (
    <Svg size={size}>
      <path d="M16 2.5c-5.6 0-9.8 8.6-9.8 15.2a9.8 9.8 0 0 0 19.6 0C25.8 11.1 21.6 2.5 16 2.5z" fill={mood === 'angry' ? '#ffb4a2' : '#fff6e8'} stroke="rgba(0, 0, 0, 0.35)" strokeWidth="1.2" />
      {mood === 'happy' && (
        <>
          <path d="M10.5 16.2q1.6-2.2 3.2 0M18.3 16.2q1.6-2.2 3.2 0" fill="none" stroke="#3a2a1a" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M11 20.5q5 5.2 10 0z" fill="#c2412d" stroke="#3a2a1a" strokeWidth="1.4" strokeLinejoin="round" />
          <circle cx="10" cy="20" r="1.4" fill="#ff8f8f" opacity="0.7" />
          <circle cx="22" cy="20" r="1.4" fill="#ff8f8f" opacity="0.7" />
        </>
      )}
      {mood === 'sad' && (
        <>
          <circle cx="12.3" cy="16.5" r="1.4" fill="#3a2a1a" />
          <circle cx="19.7" cy="16.5" r="1.4" fill="#3a2a1a" />
          <path d="M10.5 13.8l3.4-1.2M21.5 13.8l-3.4-1.2" stroke="#3a2a1a" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M12.5 23.6q3.5-3.2 7 0" fill="none" stroke="#3a2a1a" strokeWidth="1.7" strokeLinecap="round" />
          <path d="M21 18.6q1.4 2.4 0 3.2q-1.4-.8 0-3.2z" fill="#5fb8ff" />
        </>
      )}
      {mood === 'angry' && (
        <>
          <path d="M9.8 13l4.4 2M22.2 13l-4.4 2" stroke="#3a2a1a" strokeWidth="2" strokeLinecap="round" />
          <circle cx="12.6" cy="17.4" r="1.4" fill="#3a2a1a" />
          <circle cx="19.4" cy="17.4" r="1.4" fill="#3a2a1a" />
          <path d="M12.5 23.4q3.5-2.4 7 0" fill="none" stroke="#3a2a1a" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M22.5 5.5l1 2.4M26 8l-2.2 1.2M25.4 4.6l-1.2 2.2" stroke="#e53935" strokeWidth="1.6" strokeLinecap="round" />
        </>
      )}
    </Svg>
  );
}

/** The picture for an emote or a team call (an ask for ammo shows the kind asked for). */
export function EmoteIcon({ k, a, size }: { k: EmoteId; a?: Ammo | null; size?: number }) {
  switch (k) {
    case 'happy':
    case 'sad':
    case 'angry':
      return <EggFace size={size} mood={k} />;
    case 'thumbs':
      return (
        <Svg size={size}>
          <path d="M10.5 14.5h-4v12h4zM10.5 15l4.3-7.6c.7-1.3 2.9-.9 2.9.9v4.7h6.6a2.3 2.3 0 0 1 2.2 2.8l-1.9 8.6a2.3 2.3 0 0 1-2.2 1.8H10.5z" fill="#ffc83d" stroke="#8a5a00" strokeWidth="1.4" strokeLinejoin="round" />
        </Svg>
      );
    case 'gg':
      return (
        <Svg size={size}>
          <rect x="3" y="7" width="26" height="18" rx="5" fill="#7b3fd1" stroke="#e7d8ff" strokeWidth="1.4" />
          <text x="16" y="21" textAnchor="middle" fontSize="12.5" fontWeight="900" fontFamily="system-ui, sans-serif" fill="#fff">
            GG
          </text>
        </Svg>
      );
    case 'meds':
      return <UseIcon w="medkit" size={size} />;
    case 'shield':
      return <ShieldIcon size={size} />;
    case 'ammo':
      return <AmmoIcon a={a ?? 'light'} size={size} />;
    case 'gun':
      return <WeaponIcon w="rifle" size={size} />;
    case 'help':
      return (
        <Svg size={size}>
          <circle cx="16" cy="16" r="12" fill="#e53935" stroke="#ffd0cc" strokeWidth="1.6" />
          <path d="M16 8.5v9" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" />
          <circle cx="16" cy="22.6" r="2" fill="#fff" />
        </Svg>
      );
    case 'follow':
      return (
        <Svg size={size}>
          <path d="M6 9l7 7-7 7M15 9l7 7-7 7" fill="none" stroke="#2ee6c9" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="26" cy="16" r="2.4" fill="#2ee6c9" />
        </Svg>
      );
    case 'enemy':
      return (
        <Svg size={size}>
          <circle cx="16" cy="16" r="9" fill="none" stroke="#ff4d4d" strokeWidth="2.6" />
          <path d="M16 3.5v7M16 21.5v7M3.5 16h7M21.5 16h7" stroke="#ff4d4d" strokeWidth="2.6" strokeLinecap="round" />
          <circle cx="16" cy="16" r="2.2" fill="#ff4d4d" />
        </Svg>
      );
    case 'omw':
      return (
        <Svg size={size}>
          <path d="M4 16h17" stroke="#6fcf97" strokeWidth="3.4" strokeLinecap="round" />
          <path d="M16 8.5l8 7.5-8 7.5" fill="none" stroke="#6fcf97" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4 10h6M4 22h6" stroke="#6fcf97" strokeWidth="2" strokeLinecap="round" opacity="0.6" />
        </Svg>
      );
  }
}

/** What an emote or a call says: "Need heavy ammo" for an ask for ammo the asker's guns take. */
export function emoteText(k: EmoteId, a?: Ammo | null) {
  if (k === 'ammo') return a ? `Need ${a === 'rockets' ? 'launcher eggs' : a === 'shells' ? 'shells' : `${a} ammo`}` : 'Need ammo';
  return EMOTE_TEXT[k];
}
const EMOTE_TEXT: Record<EmoteId, string> = { happy: 'Happy', sad: 'Sad', thumbs: 'Thumbs up', angry: 'Angry', gg: 'GG', meds: 'Need meds', shield: 'Need shield', ammo: 'Need ammo', gun: 'Need a gun', help: 'Help!', follow: 'Follow me', enemy: 'Enemy here', omw: 'On my way' };

export function EggIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d="M12 2.5c-4 0-7 6.3-7 11a7 7 0 0 0 14 0c0-4.7-3-11-7-11z" fill="#fff6e8" />
    </svg>
  );
}

const MAP_ROOF: Record<Building['kind'], string> = { house: '#b5523b', farm: '#8b2f23', shed: '#7a5534', warehouse: '#6f7c88', container: '#4f6d8f', ruin: '#a39e93', coop: '#f5b301', diner: '#d64545', mill: '#7a4a2a', police: '#2b3f66', bank: '#4f7d5c', cellar: '#3a3530', bunker: '#3a3f45' };

/**
 * A doorway on the map: a light tab through the wall that pokes out the way in, or a dark band across a shipping
 * container's open end.
 */
function DoorMark({ b, d }: { b: Building; d: Door }) {
  const open = b.kind === 'container';
  // from `lo` inside the wall line to `hi` outside it, and this wide along the wall
  const lo = open ? -1.6 : -1;
  const hi = open ? 0.3 : 3.2;
  const wide = open ? d.w + 0.5 : Math.max(3, d.w + 0.4);
  const mid = (lo + hi) / 2;
  const x = d.x + d.ox * mid;
  const z = d.z + d.oz * mid;
  const hw = d.ox ? (hi - lo) / 2 : wide / 2;
  const hd = d.ox ? wide / 2 : (hi - lo) / 2;
  return <rect x={x - hw} y={z - hd} width={hw * 2} height={hd * 2} fill={open ? '#1d2025' : b.kind === 'ruin' ? '#e4dccb' : '#fff6d6'} />;
}

/** Every window as a light blue mark along its wall, a little wider and thicker than the opening, as one path. */
const windowMarks = (map: GameMap) =>
  map.windows
    .map((p) => {
      const hw = p.hw + (p.ox ? 0.6 : 0.2);
      const hd = p.hd + (p.ox ? 0.2 : 0.6);
      return `M${(p.x - hw).toFixed(1)} ${(p.z - hd).toFixed(1)}h${(hw * 2).toFixed(1)}v${(hd * 2).toFixed(1)}h${(-hw * 2).toFixed(1)}Z`;
    })
    .join('');

/** Many round dots as one path (hundreds of trees in one element, not hundreds of elements). */
const dots = <P extends { x: number; z: number }>(list: P[], r: (p: P) => number) =>
  list.map((p) => `M${(p.x - r(p)).toFixed(1)} ${p.z.toFixed(1)}a${r(p)} ${r(p)} 0 1 0 ${2 * r(p)} 0a${r(p)} ${r(p)} 0 1 0 ${-2 * r(p)} 0Z`).join('');

/** The river's middle line as SVG points. */
const riverPoints = (map: GameMap) => map.river.map((p) => `${p.x},${p.z}`).join(' ');

/**
 * The island drawn in map coordinates (x right, north up), for the minimap and the big map: the river and its bridges,
 * roads, farm fences, cars, campfires and bounce pads too.
 */
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
      {map.river.length > 1 && (
        <>
          <polyline points={riverPoints(map)} fill="none" stroke="#d8c690" strokeWidth={RIVER_HALF * 2 + 3} strokeLinejoin="round" />
          <polyline points={riverPoints(map)} fill="none" stroke="#4cb3dc" strokeWidth={RIVER_HALF * 2} strokeLinejoin="round" />
        </>
      )}
      {map.roads.map((r, i) => (
        <line key={`rd${i}`} x1={r.x0} y1={r.z0} x2={r.x1} y2={r.z1} stroke="#cdb07a" strokeWidth={ROAD_HALF * 2} strokeLinecap="round" />
      ))}
      {map.bridges.map((b, i) => (
        <rect key={`br${i}`} x={b.x - b.hw} y={b.z - b.hd} width={b.hw * 2} height={b.hd * 2} fill="#a57846" stroke="#5a3e24" strokeWidth="0.6" />
      ))}
      {map.fields.map((f, i) => (
        <rect key={`f${i}`} x={f.x - f.hw} y={f.z - f.hd} width={f.hw * 2} height={f.hd * 2} fill="#b8a640" />
      ))}
      {map.yards.map((y, i) => (
        <rect key={`y${i}`} x={y.x - y.hw} y={y.z - y.hd} width={y.hw * 2} height={y.hd * 2} fill="none" stroke="#c49a5c" strokeWidth="1.2" strokeDasharray="5 3" />
      ))}
      <path d={dots(map.trees, () => 2)} fill="#3f8f3a" />
      <path d={dots(map.rocks, (r) => r.r)} fill="#9aa0a6" />
      {map.buildings.map((b, i) =>
        isDeep(b.x) ? null : <rect key={`b${i}`} x={b.x - b.w / 2} y={b.z - b.d / 2} width={b.w} height={b.d} fill={MAP_ROOF[b.kind]} stroke={b.kind === 'ruin' ? 'none' : '#f1e6d2'} strokeWidth="1" />,
      )}
      {map.buildings.map((b, i) => b.doors.map((d, k) => <DoorMark key={`d${i}-${k}`} b={b} d={d} />))}
      {map.windows.length > 0 && <path d={windowMarks(map)} fill="#bfe6f5" />}
      {map.cars.map((c, i) => (
        <rect key={`c${i}`} x={c.x - c.hw} y={c.z - c.hd} width={c.hw * 2} height={c.hd * 2} rx="0.6" fill={c.truck ? '#4a4e55' : '#e4e7ec'} stroke="#2b2d33" strokeWidth="0.5" />
      ))}
      {map.fires.map((f, i) => (
        <circle key={`fi${i}`} cx={f.x} cy={f.z} r={CAMP.r * 0.7} fill="#ff8a2a" stroke="#ffd36a" strokeWidth="1" />
      ))}
      {map.pads.map((p, i) => (
        <g key={`pd${i}`}>
          <circle cx={p.x} cy={p.z} r={PAD.r + 1} fill="#2ee6a6" stroke="#0c6b4a" strokeWidth="0.8" />
          <line x1={p.x} y1={p.z} x2={p.x + p.dx * 6} y2={p.z + p.dz * 6} stroke="#0c6b4a" strokeWidth="1.4" strokeLinecap="round" />
        </g>
      ))}
      {coop && <path d={star(coop.x, coop.z, 9)} fill="#ffd23d" stroke="#7a4a00" strokeWidth="1.4" strokeLinejoin="round" />}
      {map.stairs.map((st, i) => (
        <HatchMark key={`h${i}`} x={st.x} z={st.z} r={4} wild={st.b < 0} />
      ))}
    </>
  );
}

/** A stairway down on the map: a dark square with steps going down, ringed yellow (out in the open, striped). */
function HatchMark({ x, z, r, wild }: { x: number; z: number; r: number; wild: boolean }) {
  return (
    <g transform={`translate(${x.toFixed(1)} ${z.toFixed(1)})`}>
      <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={r * 0.2} fill="#1d2025" stroke="#f2c230" strokeWidth={r * 0.32} strokeDasharray={wild ? `${(r * 0.5).toFixed(1)} ${(r * 0.35).toFixed(1)}` : undefined} />
      <path d={`M${-r * 0.55} ${-r * 0.5}h${r * 0.5}v${r * 0.5}h${r * 0.5}v${r * 0.5}h${r * 0.1}`} fill="none" stroke="#f2c230" strokeWidth={r * 0.2} strokeLinejoin="round" />
    </g>
  );
}

/** What each kind of container shows as on a basement's map. */
const BOX_MARK: Record<string, string> = { chest: '#ffc83d', fridge: '#e8f4ff', crate: '#c08a4a', locker: '#7f9bb8', safe: '#e2b33c', deposit: '#c9a24a', drawer: '#9a6a3a', books: '#8e5a3a' };

/**
 * The basement `b` (a cellar or a bunker) drawn in the island's coordinates, over the ground above it: its floor, walls,
 * furniture, what there is to open (dimmed once opened) and its stairs, for the maps while you're down there.
 */
export function BasementArt({ map, b, opened }: { map: GameMap; b: Building; opened: boolean[] }) {
  const ox = b.x - DEEP;
  const inside = (x: number, z: number) => Math.abs(x - b.x) < b.w / 2 && Math.abs(z - b.z) < b.d / 2;
  const bi = map.buildings.indexOf(b);
  const st = map.stairs.find((s) => s.u === bi);
  return (
    <>
      <rect x={ox - b.w / 2} y={b.z - b.d / 2} width={b.w} height={b.d} fill={b.kind === 'cellar' ? '#5e5346' : '#4c545b'} />
      {b.rooms.map((r, i) => (
        <circle key={`l${i}`} cx={r.x - DEEP} cy={r.z} r={Math.min(r.hw, r.hd) * 0.9} fill="rgba(255, 190, 110, 0.18)" />
      ))}
      {map.furniture.map((f, i) =>
        f.b === bi && furnitureSolid(f.kind) ? <rect key={`f${i}`} x={f.x - DEEP - f.hw} y={f.z - f.hd} width={f.hw * 2} height={f.hd * 2} fill="#7a6a58" /> : null,
      )}
      {map.containers.map((c) => {
        if (!inside(c.x, c.z)) return null;
        const [hw, hd] = containerHalf(c);
        return <rect key={`c${c.id}`} x={c.x - DEEP - hw} y={c.z - hd} width={hw * 2} height={hd * 2} rx="0.15" fill={BOX_MARK[c.kind] ?? '#c08a4a'} opacity={opened[c.id] ? 0.3 : 1} />;
      })}
      {b.walls.map((w, i) => (
        <rect key={`w${i}`} x={w.x - DEEP - w.hw} y={w.z - w.hd} width={w.hw * 2} height={w.hd * 2} fill="#d9d2c4" />
      ))}
      {st && (
        <g>
          <rect x={st.x - st.hw} y={st.z - st.hd} width={st.hw * 2} height={st.hd * 2} fill="#bfb7a8" />
          {[0, 1, 2, 3, 4, 5].map((k) => {
            const u = (k + 0.5) / 6;
            const run = st.dx ? st.hw : st.hd;
            const a = run - u * 2 * run;
            return <rect key={k} x={st.x + st.dx * a - (st.dx ? 0.12 : st.hw - 0.2)} y={st.z + st.dz * a - (st.dx ? st.hd - 0.2 : 0.12)} width={st.dx ? 0.24 : st.hw * 2 - 0.4} height={st.dx ? st.hd * 2 - 0.4 : 0.24} fill="#5e574c" />;
          })}
        </g>
      )}
    </>
  );
}

/**
 * Where each place's name goes on the big map: above its middle, or below it, or on it, whichever first clears the
 * names already placed (sizes in island meters, for the map's 9 m type).
 */
function labelSpots(map: GameMap) {
  const placed: { x: number; y: number; hw: number }[] = [];
  return map.places.map((p) => {
    const hw = p.name.length * 2.7 + 2;
    const x = Math.max(-HALF + hw, Math.min(HALF - hw, p.x));
    const up = Math.min(p.r * 0.5, 16);
    const tries = [p.z - up, p.z + up + 8, p.z + 3, p.z - up - 11, p.z + up + 19].map((y) => Math.max(-HALF + 12, Math.min(HALF - 4, y)));
    const y = tries.find((t) => placed.every((o) => Math.abs(o.x - x) > o.hw + hw || Math.abs(o.y - t) > 10)) ?? tries[0];
    placed.push({ x, y, hw });
    return { x, y };
  });
}

/** The name of every town and site, for the big map (the minimap names only the place you're in, under it). */
export function PlaceNames({ map }: { map: GameMap }) {
  const spots = useMemo(() => labelSpots(map), [map]);
  return (
    <>
      {map.places.map((p, i) => (
        <text key={i} className="g-scramble-place" x={spots[i].x} y={spots[i].y} textAnchor="middle">
          {p.name}
        </text>
      ))}
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
  flare: `Rare, always legendary. One flare straight up, and a supply drop floats down near you about ${FLARE_WAIT} seconds later. Everyone sees it coming.`,
  smg: 'Sprays fast up close.',
  micro: 'The quickest trigger on the island. Shreds at short range.',
  hsmg: 'Hits harder than an SMG, but climbs: every shot goes wider until you let off the trigger.',
  rifle: 'The all-rounder: quick, accurate, long reach.',
  burst: 'Three rounds a pull, dead on target.',
  marksman: 'One careful shot at a time, between a rifle and a scout.',
  scout: 'A light long rifle: quicker than a sniper, but each shot hits softer.',
  lmg: 'An 80-round belt. You walk slower carrying it.',
  minigun: `Hold the trigger: it spins up for ${WEAPONS.minigun.spin?.up} seconds, then pours out ${WEAPONS.minigun.mag} rounds. You walk slowly with it, and slower still while it spins.`,
  shotgun: 'Nine pellets. Huge up close, weak far off.',
  auto: 'Fires as fast as you pull, a little weaker a shot.',
  double: 'Two barrels, then a reload. Brutal at arm’s length.',
  sniper: 'Two hits crack an egg with no shield, from far off: a big scope lets you see that far.',
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
  spatula: 'Everyone starts with one. Gathers wood, stone and metal, and smacks crates.',
  whisk: 'Twice as quick, half the bite.',
  knife: 'Long reach, and you run fastest holding it.',
  cleaver: 'The hardest hitter in the drawer.',
  pan: 'Stops bullets: from the front while you hold it, from behind while it hangs on your back.',
  pin: 'Gathers building material twice as fast and knocks walls and crates flat.',
};
const THROW_HELP: Record<ThrowId, string> = {
  grenade: `Goes off ${THROWS.grenade.fuse} seconds after you throw it.`,
  impulse: 'Goes off a moment after it lands and shoves every egg and everything on the ground away from it (not you). Barely scratches.',
  flour: 'Bursts into a cloud. Nobody outside it can see in, or through it.',
  sauce: 'Splashes a burning puddle that hurts anyone standing in it, you too.',
  jam: `A sticky puddle that lasts ${THROWS.jam.time} seconds: anyone wading through it slows to a crawl.`,
  bush: `Grows a bush where it lands for ${THROWS.bush.time} seconds. Stand in it a moment and nobody sees you from a distance until you fire.`,
  mirv: `Goes off ${THROWS.mirv.fuse} seconds after you throw it, then scatters ${THROWS.mirv.split?.n} bomblets that each go off a moment later. Clears a room.`,
  stun: `A blinding flash ${THROWS.stun.fuse} seconds after you throw it. Every egg that can see it (not you) is dazed for up to ${THROWS.stun.time} seconds: slowed, and its screen washed out.`,
};
const USE_HELP: Record<UseId, string> = {
  bandage: `+${USES.bandage.hp} health, up to ${USES.bandage.hpCap}.`,
  medkit: 'Back to full health, but it takes a while.',
  mini: `+${USES.mini.shield} shield, up to ${USES.mini.shieldCap}.`,
  shield: `+${USES.shield.shield} shield, all the way to 100.`,
  coffee: `Boost: heals a little at a time and puts a spring in your step for ${Math.round((USES.coffee.boost ?? 0) / BOOST.drain)} seconds.`,
  smoothie: `+${USES.smoothie.sip} shield, a little at a time over ${Math.round((USES.smoothie.sip ?? 0) / SIP)} seconds, all the way to 100.`,
  tart: 'Legendary. Full health and a full boost on top.',
};
/** "Colander, saucepan, stockpot: 8%, 12% and 16% off every hit." */
const armorLine = (kind: ArmorKind) => `${cap(ARMOR_NAMES[kind].slice(1).join(', '))}: ${ARMOR_CUT[kind].slice(1).map((c, i, a) => `${Math.round(c * 100)}%${i === a.length - 2 ? ' and' : i < a.length - 1 ? ',' : ''}`).join(' ')} off every hit.`;
/** The number keys that use each consumable. */
export const USE_KEYS: Record<UseId, string> = { bandage: '5', medkit: '6', mini: '7', shield: '8', coffee: '9', smoothie: '0', tart: 'T' };
/** The keyboard code for a key above. */
export const keyCode = (k: string) => (/^\d$/.test(k) ? `Digit${k}` : `Key${k}`);
/** The keys that build each piece (and pick it for Space), the material key and the edit key. */
export const PIECE_KEYS: Record<Plan, string> = { wall: 'Z', ramp: 'X', floor: 'C', roof: 'V', box: 'B' };
export const MAT_KEY = 'N';
export const EDIT_KEY = 'F';
/**
 * In duos and squads: the key that pings a spot for the team (so does the middle mouse button), and the one that puts
 * down what's in hand.
 */
export const PING_KEY = 'Y';
export const DROP_KEY = 'U';
/** The key that looks through the next scope carried (so does the wheel with Shift held). */
export const SCOPE_KEY = 'O';
/** Held down, the key that opens the emote wheel (as the right mouse button does). */
export const EMOTE_KEY = 'J';
export const PIECE_NAMES: Record<Plan, string> = { wall: 'wall', ramp: 'ramp', floor: 'floor', roof: 'roof', box: 'box up' };
const [WOOD_SPEC, STONE_SPEC, METAL_SPEC] = [MAT_SPECS.wood, MAT_SPECS.stone, MAT_SPECS.metal];

export function HowToPlay({ root, touch, onClose }: { root: HTMLElement | null; touch: boolean; onClose: () => void }) {
  return (
    <Sheet root={root} title="How to Play" onClose={onClose}>
      <p className="g-scramble-lede">Fifty eggs drop onto the island. Grab guns, crack the others, and stay inside the circle as the storm closes in. The last egg standing wins.</p>
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
              <dt>build</dt>
              <dd>Build the piece you picked; tap it twice quickly to box yourself in. The button beside it opens the build menu: pick a wall, ramp, floor, roof or box (it goes up at once), pick wood, stone or metal, and edit a wall of yours</dd>
              <dt>reload</dt>
              <dd>Reload (it also happens on its own when you run dry)</dd>
              <dt>+, shield, coffee</dt>
              <dd>Heal, top up your shield, or drink a coffee. The right item is picked for you (a golden egg tart when you're nearly cracked, a smoothie after the minis)</dd>
              <dt>pick up</dt>
              <dd>Shows up when you stand on something or next to a chest, a fridge, a locker or a door: tap it to pick up, open, or open and shut the door. By a knocked teammate it says revive: hold it down</dd>
              <dt>ping</dt>
              <dd>In duos and squads, the pin by the little map marks where you aim for your team, and so does a tap on the big map</dd>
              <dt>scopes</dt>
              <dd>Every scope you pick up stays with you: tap one in the scope badge at the top to look through it</dd>
              <dt>emotes</dt>
              <dd>The smiling egg by the little map opens the emote wheel: tap a face, or in duos and squads a call for your team round the outside (or slide your thumb onto one and lift it). Tap anywhere else to put it away</dd>
              <dt>hold a slot</dt>
              <dd>Hold a weapon, an item, the scope you look through or a material in the build menu a moment to put one down for a teammate</dd>
            </>
          ) : (
            <>
              <dt>W A S D</dt>
              <dd>Walk (the arrow keys work too)</dd>
              <dt>mouse</dt>
              <dd>Aim; click to shoot, hold for automatic fire. Throwables land where you point</dd>
              <dt>Space</dt>
              <dd>Jump from the bus, then build the piece you picked where you aim. Twice quickly boxes you in</dd>
              <dt>Z X C V B</dt>
              <dd>Build a wall, a ramp, a floor, a roof or a box at once (and pick it for Space). The build bar at the bottom left shows them</dd>
              <dt>{MAT_KEY}</dt>
              <dd>Switch material: wood, stone or metal</dd>
              <dt>{EDIT_KEY}</dt>
              <dd>Edit the wall of yours you face: a doorway, then a window, then solid again</dd>
              <dt>E</dt>
              <dd>Pick up, swap, open chests, fridges, lockers and supply drops, and open and shut doors. Hold it by a knocked teammate to revive them</dd>
              <dt>{PING_KEY}, middle click</dt>
              <dd>In duos and squads, ping where the mouse points for your team (a click on the big map pings there too)</dd>
              <dt>{DROP_KEY}</dt>
              <dd>Put down what's in your hand for a teammate, or right click a weapon, an item, the ammo, the scope you look through or a material to put one down</dd>
              <dt>right click, {EMOTE_KEY}</dt>
              <dd>Hold for the emote wheel, move the mouse onto a slice and let go to say it: a face round the middle, and in duos and squads a call for your team round the outside</dd>
              <dt>R</dt>
              <dd>Reload</dd>
              <dt>1 2 3 4</dt>
              <dd>Your two guns, your melee weapon and your throwables (4 again switches kinds). Q or the wheel cycles</dd>
              <dt>5 to 0, T</dt>
              <dd>Bandage, medkit, mini shield, shield potion, coffee, smoothie, and T for a golden egg tart</dd>
              <dt>H, G</dt>
              <dd>Heal or top up your shield, picking the right item for you</dd>
              <dt>{SCOPE_KEY}, Shift + wheel</dt>
              <dd>Look through the next scope you carry (every one you pick up stays with you). A click on one in the scope badge at the top picks it</dd>
              <dt>M</dt>
              <dd>The island map</dd>
              <dt>← → and Enter</dt>
              <dd>Once you're cracked: watch another egg, or done watching</dd>
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
            <b>Loot.</b> Guns, ammo, healing and more lie in buildings and around the island. Smash crates (most hold a box of ammo too), toilets and hay bales, raid the fridges and open the golden chests for better ones. Walking over ammo, healing and throwables picks them up.
          </li>
          <li>
            <b>Legendary loot.</b> Legendary guns, flare guns and golden egg tarts glow gold on the ground, with a beam of light you can spot from far off.
          </li>
          <li>
            <b>Health and shield.</b> You have 100 health and up to 100 shield, which takes hits first. An egg's shell cracks as its health runs low, and its shield shimmers blue when a hit lands on it.
          </li>
          <li>
            <b>Armor.</b> A helmet and a vest from the kitchen, three levels each, take a cut of every bullet, swing and blast (not the storm, not hot sauce). Walk over a better one to put it on; your old one drops. {touch ? 'Tap pick up' : 'Press E'} to swap for a worse one if you really want it.
          </li>
          <li>
            <b>The storm.</b> The white ring shows where the safe circle is heading. Outside the circle the storm eats your health (shields don't help), and it bites harder each time it closes.
          </li>
          <li>
            <b>Supply drops.</b> Before the storm moves each of the first three times, two crates float down under balloons inside the circle it will close to (one more before the fourth time), each with a beam of light over it. They're full of epic and legendary gear. Fire a flare gun to call one more down near you.
          </li>
          <li>
            <b>The kill leader.</b> The egg with the most eliminations ({LEADER_MIN} at least) wears a gold crown everyone can see, and shows on the big map. Everyone hears when it changes hands.
          </li>
          <li>
            <b>Emotes.</b> {touch ? 'The smiling egg button' : `Hold right click (or ${EMOTE_KEY})`} for the emote wheel: a happy, sad or angry egg, a thumbs up or a GG goes up in a bubble over your egg for {EMOTE_T} seconds, for anyone close by to see. A few at a time, then wait a moment.
          </li>
          <li>
            <b>Listen.</b> You hear the footsteps of eggs walking nearby, even ones you can't see. When your shots land you hear a soft tick and see a hit mark, red when it cracks the egg. Hover over loot (or stand by it) to see what it is.
          </li>
        </ul>
      </section>
      <section>
        <h3>Building</h3>
        <ul>
          <li>
            <b>Materials.</b> Swing your melee weapon at trees and fallen logs for wood, at rocks for stone, and at cars and lamp posts for metal. Every piece takes {PIECE_COST} of one; when the one you picked runs out, the next you have goes in.
          </li>
          <li>
            <b>Building up.</b> A piece goes up at once as a pale blue blueprint and builds up to full strength: wood in {WOOD_SPEC.time} seconds ({WOOD_SPEC.hp} health), stone in {STONE_SPEC.time} ({STONE_SPEC.hp}), metal in {METAL_SPEC.time} ({METAL_SPEC.hp}). It can be shot down while it does.
          </li>
          <li>
            <b>Pieces.</b> Everything snaps to a grid of squares. A wall goes on the side of your square you face, a ramp or a floor on the square in front, a roof over your own square. Box up for four walls round you{touch ? '' : ' (B, or Space twice)'}.
          </li>
          <li>
            <b>Towers.</b> A ramp leads up a storey, and a floor stands on posts of its own. Build a ramp, walk up it, then a floor in front at the top, or another ramp to go up again: two storeys at most. Walls you build up there stand on that level.
          </li>
          <li>
            <b>High ground.</b> Up high you see farther, and your shots go over crates, rocks, cars and walls lower than you. Anyone who can see you can shoot back, and shots from below chip at the floor or ramp you stand on. Walk off the edge, or lose what you stand on, and you drop back down.
          </li>
          <li>
            <b>Editing.</b> {touch ? 'Edit' : `Press ${EDIT_KEY}`} facing a wall of yours to cut a doorway in it (walk and shoot through), again for a window (shoot and look through, but not walk), and again to make it solid.
          </li>
          <li>
            <b>Roofs.</b> Nobody outside sees under your roof until you fire, and anything thrown at it bounces off. Whatever stood on a piece that breaks (a wall on a wall, a roof on a box) comes down with it.
          </li>
        </ul>
      </section>
      <section>
        <h3>Around the island</h3>
        <ul>
          <li>
            <b>Towns and sites.</b> Every town, farm, camp and yard has a name. They're all on the big map, the little map shows the one you're in, and the name comes up when you walk or land in. Dirt roads link the places near each other, and you walk a little quicker on them.
          </li>
          <li>
            <b>Houses, farmhouses and sheds.</b> Loot inside, often a chest, and a chest of drawers and a bookshelf to go through (a bookshelf mostly holds books). The roof lifts off while you're in, and nobody outside can see you unless they look in through an open door or a window.
          </li>
          <li>
            <b>Windows.</b> Houses, farmhouses, sheds, diners and warehouses have windows (light blue marks along the walls on the map). You can see through the glass, but it stops bullets and throws: the first shot, a swing or a blast nearby breaks it, and then bullets and throws fly through. Nobody climbs through a window, broken or not. Stand by one and the roof thins so you can look in.
          </li>
          <li>
            <b>Furniture.</b> Tables, beds and diner booths only stop your feet; kitchen counters, shelves and flour sacks stop bullets too. Rugs and chairs are just there to look at.
          </li>
          <li>
            <b>Kitchens.</b> Houses and farmhouses have a fridge, which opens like a chest and holds things to eat and patch up with, and a toilet, which breaks like a crate and might hold anything.
          </li>
          <li>
            <b>Campfires.</b> By some houses and out at the camps (orange dots on the map). Stand within a few steps of one and it heals you {CAMP.hps} health a second, all the way to full, as long as nobody chases you off.
          </li>
          <li>
            <b>Bounce pads.</b> The glowing green discs with arrows on (green dots on the map). Step on one and up you go, gliding off the way the arrows point: steer as you did from the bus, or let go and it carries you on, and land somewhere new. Nothing can hit you up there, but you can't shoot or heal either.
          </li>
          <li>
            <b>Farms.</b> A wooden fence rings the farmhouse and its field, with a gate in the middle of every side. Fences stop you walking, not bullets. The hay bales are cover that breaks when shot or smacked, and sometimes something falls out.
          </li>
          <li>
            <b>Cars and trucks.</b> Parked in driveways, by the warehouses and the container yards. Solid cover: nothing gets through one.
          </li>
          <li>
            <b>Doors.</b> Every way in has a bright frame, a lamp, a porch and an awning sticking out from the roof, and shows as a light tab on the map. Most have a door, shut to begin with: {touch ? 'tap' : 'press E by'} it to open it (it swings away from you) or shut it again. A shut door stops eggs, bullets and the view; shoot or smash one enough and it comes off its hinges. Walk up to an open door, or line up with one, and the roof thins so you can peek in.
          </li>
          <li>
            <b>The police station.</b> A lobby with a desk and a row of lockers, a jail cell behind bars (bullets and the eye go through bars, eggs don't) and a stash room with a chest of good guns and armor. The lockers hold guns, armor, ammo and stun grenades. It goes by its own name on the map.
          </li>
          <li>
            <b>The bank.</b> The vault across the back has a heavy steel door: open it and it takes {VAULT_TIME} seconds to grind open (everyone nearby sees the lamp flashing), and it never breaks or shuts. Inside are two safes full of legendary loot and deposit boxes with smaller things. It goes by its own name on the map.
          </li>
          <li>
            <b>Lockers.</b> In the police station, the warehouses and some sheds. Open one like a chest for what's inside.
          </li>
          <li>
            <b>Cellars and bunkers.</b> A few houses have a cellar, the police station an armory and the bank (now and then) a strongroom underneath, and a couple of hatches out in the open lead down to bunkers: a dark square ringed yellow on the map. Walk onto the stairs to go down, and back onto them to come up. It's dark down there but for the lamps, and the loot is better than up top: a cellar keeps a chest, an old fridge, drawers and shelves, a bunker rows of lockers, and the one under a hatch a chest as good as a supply drop. Nothing gets between the two levels but eggs on the stairs: nobody up top can see, shoot, throw at or hurt anyone below, or the other way round. The storm still reaches you underground, no scope sees farther than 2x in the gloom, so the scope badge dims the bigger ones, and nothing can be built there. While you're below, both maps show its rooms.
          </li>
          <li>
            <b>Warehouses.</b> Full of crates, with a chest in a corner, a pair of lockers and barrels outside.
          </li>
          <li>
            <b>Shipping containers.</b> Rows of them, each open at one end, where the doors swing wide and it's dark inside (a dark band on the map). Good cover, and sometimes something inside.
          </li>
          <li>
            <b>The Golden Coop.</b> The gold-roofed building with a star on the map. One way in, and a golden chest at the back full of legendary gear.
          </li>
          <li>
            <b>The diner and the windmill.</b> Every island has one of each, now and then a second of one, each going by its own name. The diner has booths, a counter and, in the kitchen at the back, two fridges and a chest. The windmill has one way in, flour sacks and a millstone, and a chest across from the door as good as a supply drop.
          </li>
          <li>
            <b>Bushes and cornfields.</b> Stand in one a moment and nobody sees you from a distance until you fire.
          </li>
          <li>
            <b>Barrels.</b> Shoot or smack one and it blows up, hurting everyone nearby and setting off other barrels.
          </li>
          <li>
            <b>Ponds and the river.</b> You can wade through, but slowly, and the water hides nobody. The river winds right across the island; cross it dry and at a walk on a wooden bridge (brown on the map), whose rails stop your feet but not bullets.
          </li>
          <li>
            <b>Ruins.</b> Broken walls and no roof: cover, but nowhere to hide.
          </li>
          <li>
            <b>Odds and ends.</b> Lamp posts along the roads, mailboxes by the doors, picnic tables in the yards, and fallen logs and stumps in the woods. Posts stop bullets; a table, a log or a stump only stops your feet.
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
          ))}{' '}
          No gun cracks an egg at full health with one shot.
        </p>
        {GUN_GROUPS.map(([cls, title]) => (
          <div key={cls}>
            <h4 className="g-scramble-sub">{title}</h4>
            <ul className="g-scramble-guns">
              {WEAPON_IDS.filter((w) => WEAPONS[w].cls === cls).map((w) => (
                <li key={w}>
                  <WeaponIcon w={w} size={34} />
                  <span>
                    <b>{cap(WEAPONS[w].name)}.</b> {GUN_HELP[w]} <small>{WEAPONS[w].call ? 'No ammo needed' : AMMO_NAME[WEAPONS[w].ammo]}.</small>
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
              <b>Scopes.</b> {SCOPES.slice(1).join(', ')}: each lets you see farther around you, and only the scope does (no gun zooms in, so a sniper wants a big one). You keep every one you find and look through whichever you like, whatever you hold (the best one yet goes up to your eye as you pick it up, once), since a big one makes everything small up close. The {SCOPES[SCOPES.length - 1]} is rare: supply drops and the bank's deposit boxes.
            </span>
          </li>
          <li>
            <PackIcon size={30} lv={2} />
            <span>
              <b>Backpacks.</b> Three levels, each carrying more ammo, healing and throwables.
            </span>
          </li>
          <li>
            <ArmorIcon kind="helmet" size={30} lv={2} />
            <span>
              <b>Helmets.</b> {armorLine('helmet')}
            </span>
          </li>
          <li>
            <ArmorIcon kind="vest" size={30} lv={2} />
            <span>
              <b>Vests.</b> {armorLine('vest')} The two cuts multiply.
            </span>
          </li>
          <li>
            <GhillieIcon size={30} />
            <span>
              <b>Ghillie suit.</b> Rare. Stand still out on the grass and nobody sees you from more than a few steps away until you move or fire. Bullets still hit you.
            </span>
          </li>
        </ul>
      </section>
      <section>
        <h3>Duos and squads</h3>
        <ul>
          <li>
            <b>Teams.</b> In duos you play in teams of two (twenty five teams), in squads teams of four (twelve of four and one of two). Pick the mode by Play, on the Play with Bots card, or as host of a room. Everyone on a team has a number and a color of their own (teal, amber, pink or violet): a ring under them, an outline you see through walls and roofs, their name tag with their number on it pointing down at them, their pings, the team panel and their dot on both maps all wear it, and yours is on the teams pill. Everyone else's name tag is dark with a red edge. A teammate off the screen (or up or down a stairway from you) shows as their number at the edge with an arrow their way and how far, and what they say goes up by it. Nobody can hurt a teammate: shots go past them, and swings, blasts, barrels, hot sauce, stun grenades and impulse eggs leave them be. The storm hurts everyone.
          </li>
          <li>
            <b>Knocked down.</b> Run out of health while a teammate still stands and you're knocked down, not out: you crawl, can't shoot or use anything, and bleed out over {BLEED_T} seconds. Anyone who hits you meanwhile finishes you off sooner. A knocked teammate turns red on their name tag, marker, team panel row and map dot, and while nobody is reviving them a call for help up top says who and how far.
          </li>
          <li>
            <b>Reviving.</b> {touch ? 'Hold the pick up button' : 'Hold E'} by a knocked teammate for {REVIVE_T} seconds to get them back up with {REVIVE_HP} health (you stand still while you do, and they stop bleeding). The team panel under the pills shows how everyone is doing.
          </li>
          <li>
            <b>Out.</b> Once nobody on a team is left standing, its knocked eggs are out too. The last team with anyone standing wins, and places go by team. Cracked? You watch your teammates first.
          </li>
          <li>
            <b>Pings and sharing.</b> Ping a spot to mark it for your team on the island and both maps for a few seconds. Put a weapon, one throwable or item, a box of ammo or {MAT_DROP} of a material down at your feet for a teammate: you never pick back up what you put down unless you ask for it.
          </li>
          <li>
            <b>Calls.</b> The outside of the emote wheel speaks to your team only: need meds, need shield, need ammo (it asks for the kind your guns take that you're lowest on), need a gun, help, follow me, enemy here (with a ping where you point) and on my way. Each goes up over your egg in your color and in your team's feed. In duos and squads a face over a teammate is ringed in their color too, and one over anyone else in red.
          </li>
          <li>
            <b>Computer teammates.</b> In Play with Bots your teammates are computer eggs. They jump with you, stay near you, ping eggs they spot, revive you when it's safe, share what you're short of and finish knocked eggs only when nothing else is shooting at them. They answer your calls too: ask for meds, a shield, ammo or a gun and the nearest one with some to spare comes over and puts it down for you (or looks sad if nobody has any; knocked down, any ask brings them to pick you up), say follow me and they keep close for a minute, help and they come running, enemy here and they look that way. They call for help when knocked down and say GG when they win. Only solo matches go on the boards.
          </li>
        </ul>
      </section>
      <section>
        <h3>Online</h3>
        <p>Play joins a match with whoever else is starting one in the mode you pick beside it (solo, duos or squads), like an .io game: it starts on its own about twenty seconds after the first egg comes in (sooner once twenty people are in), people go on teams together first, and computer eggs fill the teams and the island up to fifty. Arrive once one is under way and you go into the next. Play with Bots is you against forty-nine computer eggs (some of them your teammates in duos and squads), as sharp as you pick.</p>
        <p>Play with Friends makes a room of your own for up to twenty: the host picks the mode, and in duos and squads friends fill teams together in seat order until someone moves (the host can move anyone, everyone else themselves). The host adds computer eggs with Bots, then picks whether more fill the island up to fifty and how sharp they are. A team's win counts for everyone on it.</p>
        <p>Easy computer eggs are slow to spot you and miss most shots past thirty meters. Normal ones, the kind Play always brings, fight fair. Hard ones see farther, react quicker and aim well up close, but are never dead on far off. At every level they pace their fire and a pack of them takes turns, so none cracks you from full health in a second.</p>
        <p>Cracked? Watch the rest, or press done watching for your result while the match plays on for everyone else. Whoever hosts runs the match, so they can play again (or start the next one, in a room of your own) once it is over; if the host leaves first, the match ends for everyone.</p>
      </section>
    </Sheet>
  );
}
