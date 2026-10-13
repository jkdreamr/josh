// Pictures and sheets for Scramble's interface: weapon and item icons, the island map, and How to Play.
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AMMO_BOX, BANDAGE, RARITY_COLORS, RARITY_NAMES, SHIELD, WALL_COST, type Ammo, type WeaponId } from './items';
import { HALF, type GameMap } from './map';

const Svg = ({ children, size = 28, label }: { children: ReactNode; size?: number; label?: string }) => (
  <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden={label ? undefined : true} role={label ? 'img' : undefined} aria-label={label}>
    {children}
  </svg>
);

/** Side-on gun silhouettes, muzzle to the right. */
export function WeaponIcon({ w, size }: { w: WeaponId | null; size?: number }) {
  const ink = '#f4f5f7';
  switch (w) {
    case null:
      return (
        <Svg size={size}>
          <path d="M4 22.5l11-6.5" stroke="#c8935a" strokeWidth="3" strokeLinecap="round" />
          <path d="M14 13.5l9-5.2 4 6.8-9 5.2z" fill={ink} />
          <path d="M17 14.5l5.2-3M18.4 16.9l5.2-3" stroke="#8e98a6" strokeWidth="1" />
        </Svg>
      );
    case 'pistol':
      return (
        <Svg size={size}>
          <path d="M6 11h19v4.5H14l-1.4 7.5H8.2l1.5-7.5H6z" fill={ink} />
        </Svg>
      );
    case 'smg':
      return (
        <Svg size={size}>
          <path d="M3 12h22v2h3v3h-3v1H15l-1 6h-4l1-6H8l-1 3H3z" fill={ink} />
          <path d="M16.5 18h3l-.6 6h-3z" fill={ink} />
        </Svg>
      );
    case 'rifle':
      return (
        <Svg size={size}>
          <path d="M1.5 13h7l1.5-2h11v2h9.5v2.5H20v2.5h-6l-1.2 5.5H9.5l1.2-5.5H6.5l-2.5 3H1.5z" fill={ink} />
          <path d="M14.5 18h3.5l-1 5h-3.3z" fill={ink} />
        </Svg>
      );
    case 'shotgun':
      return (
        <Svg size={size}>
          <path d="M2 16.5l7-2.5h21v3H13l-2 2H8l-4 3.5H2z" fill="#c8935a" />
          <path d="M10 12.5h20v1.6H10z" fill={ink} />
          <path d="M14 17h7v2h-7z" fill={ink} />
        </Svg>
      );
    case 'sniper':
      return (
        <Svg size={size}>
          <path d="M1 15.5l5-1.5h10v-1h15v2H18v2.5h-5l-1 4H9l.8-4H6l-3 2.5H1z" fill={ink} />
          <rect x="9" y="9.5" width="8" height="2.6" rx="1.3" fill={ink} />
          <path d="M11 12.1v1.4M15 12.1v1.4" stroke={ink} strokeWidth="1.2" />
        </Svg>
      );
    case 'launcher':
      return (
        <Svg size={size}>
          <rect x="2" y="11" width="24" height="6.5" rx="2" fill="#8fb36a" />
          <ellipse cx="27.5" cy="14.2" rx="2.8" ry="3.6" fill="#fffaf0" />
          <path d="M10 17.5h4l-1 5.5H9.5z" fill={ink} />
        </Svg>
      );
  }
}

export function AmmoIcon({ a, size }: { a: Ammo; size?: number }) {
  const fill = { light: '#f2c94c', heavy: '#6fcf97', shells: '#eb5757', rockets: '#bb6bd9' }[a];
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

/** The island drawn in map coordinates (x right, north up), for the minimap and the big map. */
export function IslandArt({ map }: { map: GameMap }) {
  return (
    <>
      <rect x={-HALF - 12} y={-HALF - 12} width={2 * HALF + 24} height={2 * HALF + 24} fill="#3aa6d4" />
      <rect x={-HALF} y={-HALF} width={2 * HALF} height={2 * HALF} rx="3" fill="#e9d7a6" />
      <rect x={-HALF + 7} y={-HALF + 7} width={2 * HALF - 14} height={2 * HALF - 14} fill="#6dab4f" />
      {map.trees.map((t, i) => (
        <circle key={`t${i}`} cx={t.x} cy={t.z} r="1.8" fill="#3f8f3a" />
      ))}
      {map.rocks.map((r, i) => (
        <circle key={`r${i}`} cx={r.x} cy={r.z} r={r.r} fill="#9aa0a6" />
      ))}
      {map.buildings.map((b, i) => (
        <rect key={`b${i}`} x={b.x - b.w / 2} y={b.z - b.d / 2} width={b.w} height={b.d} fill="#b5523b" stroke="#f1e6d2" strokeWidth="1" />
      ))}
    </>
  );
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

const GUN_HELP: [WeaponId, string][] = [
  ['pistol', 'Steady and accurate. Light ammo.'],
  ['smg', 'Sprays fast up close. Light ammo.'],
  ['rifle', 'The all-rounder: quick, accurate, long reach. Heavy ammo.'],
  ['shotgun', 'Nine pellets. Huge up close, weak far off. Shells.'],
  ['sniper', 'A hundred a hit and you see farther while you hold it. Heavy ammo.'],
  ['launcher', 'Lobs an egg that bursts on impact and flattens walls. Eggs.'],
];

export function HowToPlay({ root, touch, onClose }: { root: HTMLElement | null; touch: boolean; onClose: () => void }) {
  return (
    <Sheet root={root} title="How to Play" onClose={onClose}>
      <p className="g-scramble-lede">Eight eggs drop onto the island. Grab guns, crack the others, and stay inside the circle as the storm closes in. The last egg standing wins.</p>
      <section>
        <h3>Controls</h3>
        <dl className="g-scramble-keys">
          {touch ? (
            <>
              <dt>left thumb</dt>
              <dd>Drag anywhere on the left to walk</dd>
              <dt>right thumb</dt>
              <dd>Drag on the right to aim; push it out to shoot</dd>
              <dt>jump</dt>
              <dd>Leave the bus</dd>
              <dt>slots</dt>
              <dd>Tap a weapon at the bottom to hold it</dd>
              <dt>wall</dt>
              <dd>Build a wall in front of you ({WALL_COST} wood)</dd>
              <dt>reload</dt>
              <dd>Reload (it also happens on its own when you run dry)</dd>
              <dt>+ and shield</dt>
              <dd>Use a bandage or drink a shield potion</dd>
              <dt>pick up</dt>
              <dd>Shows up when you stand on a gun or next to a chest</dd>
            </>
          ) : (
            <>
              <dt>W A S D</dt>
              <dd>Walk (the arrow keys work too)</dd>
              <dt>mouse</dt>
              <dd>Aim; click to shoot, hold for automatic fire</dd>
              <dt>Space</dt>
              <dd>Jump from the bus, then build a wall where you aim ({WALL_COST} wood). Right click builds too</dd>
              <dt>E</dt>
              <dd>Pick up, swap guns, open chests</dd>
              <dt>R</dt>
              <dd>Reload</dd>
              <dt>1 2 3</dt>
              <dd>Your two guns and the spatula. Q or the wheel cycles</dd>
              <dt>H and G</dt>
              <dd>Use a bandage, drink a shield potion</dd>
              <dt>F</dt>
              <dd>Shoot at the nearest egg you can see (no mouse needed)</dd>
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
            <b>Loot.</b> Guns, ammo and potions lie in houses and around the island. Smash crates and open the golden chests for better ones. Walking over ammo, bandages and potions picks them up.
          </li>
          <li>
            <b>Health and shield.</b> You have 100 health and up to 100 shield, which takes hits first. A bandage heals {BANDAGE.heal}; a shield potion adds {SHIELD.gain}.
          </li>
          <li>
            <b>The storm.</b> The white ring shows where the safe circle is heading. Outside the circle the storm eats your health (shields don't help), and it bites harder each time it closes.
          </li>
          <li>
            <b>Walls.</b> Swing your spatula at trees for wood, then throw up walls for cover. They take a beating before they break.
          </li>
          <li>
            <b>Bushes.</b> Crouch in a bush and nobody sees you from a distance until you fire.
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
        <ul className="g-scramble-guns">
          {GUN_HELP.map(([w, text]) => (
            <li key={w}>
              <WeaponIcon w={w} size={34} />
              <span>{text}</span>
            </li>
          ))}
        </ul>
        <p className="g-scramble-small">An ammo box holds {AMMO_BOX.light} light, {AMMO_BOX.heavy} heavy, {AMMO_BOX.shells} shells or {AMMO_BOX.rockets} eggs.</p>
      </section>
      <section>
        <h3>Online</h3>
        <p>Up to eight friends in one room. The host picks whether computer eggs fill the empty places and how sharp they are.</p>
      </section>
    </Sheet>
  );
}
