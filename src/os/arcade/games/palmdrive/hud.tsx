// Pictures and sheets for Palm Drive's interface: item icons and the How to Play guide.
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Item } from './logic';

const Svg = ({ children, size = 40 }: { children: ReactNode; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
    {children}
  </svg>
);

function Shell({ fill, edge }: { fill: string; edge: string }) {
  return (
    <>
      <ellipse cx="12" cy="16.5" rx="9.5" ry="3.6" fill="#fff" stroke="#9aa" strokeWidth="1" />
      <path d="M3.5 15.5a8.5 9 0 0 1 17 0z" fill={fill} stroke={edge} strokeWidth="1" />
      <path d="M8 15l1.2-5.2h5.6L16 15M12 6.6v3.2" fill="none" stroke="rgba(255,255,255,0.65)" strokeWidth="1.3" strokeLinejoin="round" />
    </>
  );
}

function Mushroom() {
  return (
    <>
      <path d="M2.5 12.5a9.5 8.5 0 0 1 19 0z" fill="#e53935" stroke="#7a1512" strokeWidth="1" />
      <circle cx="8" cy="8.2" r="2" fill="#fff" />
      <circle cx="15.5" cy="7.6" r="2.4" fill="#fff" />
      <circle cx="12" cy="11" r="1.3" fill="#fff" />
      <rect x="7.5" y="12.5" width="9" height="8" rx="2.5" fill="#f6e7cf" stroke="#9a7f5c" strokeWidth="1" />
      <rect x="10" y="14.5" width="1.2" height="2.6" rx="0.6" fill="#222" />
      <rect x="12.8" y="14.5" width="1.2" height="2.6" rx="0.6" fill="#222" />
    </>
  );
}

export function ItemIcon({ item, size }: { item: Item; size?: number }) {
  switch (item) {
    case 'mushroom':
      return (
        <Svg size={size}>
          <Mushroom />
        </Svg>
      );
    case 'triple':
      return (
        <Svg size={size}>
          <g transform="translate(-4 3) scale(0.6)">
            <Mushroom />
          </g>
          <g transform="translate(13.6 3) scale(0.6)">
            <Mushroom />
          </g>
          <g transform="translate(4.8 -2) scale(0.6)">
            <Mushroom />
          </g>
        </Svg>
      );
    case 'star':
      return (
        <Svg size={size}>
          <path d="M12 2l2.9 6.6 7.1.7-5.4 4.7 1.6 7L12 17.3 5.8 21l1.6-7L2 9.3l7.1-.7z" fill="#ffd23f" stroke="#c98a00" strokeWidth="1.2" strokeLinejoin="round" />
          <rect x="9.6" y="9.5" width="1.3" height="3" rx="0.6" fill="#222" />
          <rect x="13.1" y="9.5" width="1.3" height="3" rx="0.6" fill="#222" />
        </Svg>
      );
    case 'banana':
      return (
        <Svg size={size}>
          <path d="M5 6c-1 6 2 12 9 13 3 .4 5-.6 6-2-4 1-9-1-11-5-1-2-1.4-4-1-6z" fill="#ffd640" stroke="#b98a00" strokeWidth="1.1" strokeLinejoin="round" />
          <path d="M5 6l-1-2.2M20 17l1.3.8" stroke="#5b3b1c" strokeWidth="1.6" strokeLinecap="round" />
        </Svg>
      );
    case 'green':
      return (
        <Svg size={size}>
          <Shell fill="#2fae4e" edge="#16632a" />
        </Svg>
      );
    case 'red':
      return (
        <Svg size={size}>
          <Shell fill="#d8312a" edge="#7a1512" />
        </Svg>
      );
    case 'blue':
      return (
        <Svg size={size}>
          <path d="M1.5 12.5l4-2.5M22.5 12.5l-4-2.5" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
          <Shell fill="#2f6fe4" edge="#183f8c" />
          <path d="M8 7.5l1-2.4 1 2.4M11 6.5l1-2.6 1 2.6M14 7.5l1-2.4 1 2.4" fill="#fff" stroke="#fff" strokeWidth="0.8" strokeLinejoin="round" />
        </Svg>
      );
    case 'bolt':
      return (
        <Svg size={size}>
          <path d="M13.5 2L5 13.5h6L9.5 22 19 9.5h-6.2z" fill="#ffe14d" stroke="#c98a00" strokeWidth="1.2" strokeLinejoin="round" />
        </Svg>
      );
  }
}

export const CoinIcon = ({ size = 18 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
    <circle cx="12" cy="12" r="9" fill="#f7c948" stroke="#b9860f" strokeWidth="1.6" />
    <rect x="10.4" y="6.5" width="3.2" height="11" rx="1.6" fill="#fff3c4" stroke="#b9860f" strokeWidth="1" />
  </svg>
);

/** A sheet over the whole game (portaled into the shell so it covers the Start and Pause cards). */
function Sheet({ root, title, onClose, children }: { root: HTMLElement | null; title: string; onClose: () => void; children: ReactNode }) {
  const close = useRef<HTMLButtonElement>(null);
  const done = useRef(onClose);
  done.current = onClose;
  useEffect(() => {
    close.current?.focus({ preventScroll: true });
    // While the sheet is open its keys stay in it: Escape closes it, and nothing reaches the game behind (Space would
    // start a race, Escape would resume one). Buttons inside still work, their clicks are not key listeners.
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
      className="g-palmdrive-sheet"
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
      <div className="g-palmdrive-sheet-card">
        <header>
          <h2>{title}</h2>
          <button type="button" ref={close} className="arcade-btn" onClick={onClose}>
            Done
          </button>
        </header>
        <div className="g-palmdrive-sheet-body">{children}</div>
      </div>
    </div>,
    root,
  );
}

const itemHelp = (touch: boolean): [Item, string][] => [
  ['banana', touch ? 'Drops behind you. Anyone who runs over it spins out.' : 'Drops behind you. Anyone who runs over it spins out. Hold Up as you use it to throw it ahead instead.'],
  ['green', `Flies straight and bounces off walls. Fire it ahead, or back with ${touch ? '▼' : 'Z'}.`],
  ['red', 'Chases the kart one place ahead of you.'],
  ['mushroom', 'A burst of speed. Great for cutting across the grass.'],
  ['triple', 'Three mushrooms, one per press.'],
  ['star', 'Invincible and faster for a few seconds. Anyone you touch goes flying.'],
  ['bolt', 'Lightning shrinks every other kart and knocks their items away. Run them over while they are tiny.'],
  ['blue', 'Flies over the course and blows up whoever is in first.'],
];

export function HowToPlay({ root, touch, onClose }: { root: HTMLElement | null; touch: boolean; onClose: () => void }) {
  return (
    <Sheet root={root} title="How to Play" onClose={onClose}>
      <p className="g-palmdrive-lede">Five laps around campus against seven rivals, or your friends online. Your kart drives itself forward: you steer, drift, use items and get to the line first.</p>
      <section>
        <h3>Controls</h3>
        <dl className="g-palmdrive-keys">
          {touch ? (
            <>
              <dt>◀ ▶</dt>
              <dd>Steer</dd>
              <dt>drift</dt>
              <dd>Hold while turning to drift</dd>
              <dt>item</dt>
              <dd>Tap to use, hold to keep it behind you</dd>
              <dt>▼</dt>
              <dd>Throw your item backwards</dd>
              <dt>bump</dt>
              <dd>Slam the kart beside you</dd>
              <dt>coins</dt>
              <dd>Tap your coin counter to cash 5 for a boost</dd>
            </>
          ) : (
            <>
              <dt>← → or A D</dt>
              <dd>Steer</dd>
              <dt>Space</dt>
              <dd>Hold while turning to drift; tap in the air off a ramp for a trick</dd>
              <dt>X</dt>
              <dd>Use your item; hold it to keep a banana or shell behind you</dd>
              <dt>Z</dt>
              <dd>Throw your item backwards</dd>
              <dt>C</dt>
              <dd>Slam the kart beside you</dd>
              <dt>B</dt>
              <dd>Cash 5 coins for a boost</dd>
              <dt>↓</dt>
              <dd>Brake and reverse</dd>
              <dt>V</dt>
              <dd>Look behind</dd>
              <dt>Esc</dt>
              <dd>Pause</dd>
            </>
          )}
        </dl>
      </section>
      <section>
        <h3>Go faster</h3>
        <ul>
          <li>
            <b>Rocket start.</b> {touch ? 'Tap the screen' : 'Press Up'} just before the lights turn green.
          </li>
          <li>
            <b>Drift.</b> Hold {touch ? 'drift' : 'Space'} while turning to hop into a slide. The sparks go <span className="g-palmdrive-blue">blue</span>, <span className="g-palmdrive-orange">orange</span>, then{' '}
            <span className="g-palmdrive-purple">purple</span>; let go for a mini-turbo. The longer the drift, the bigger the boost.
          </li>
          <li>
            <b>Slipstream.</b> Tuck in right behind another kart and you get slung past it.
          </li>
          <li>
            <b>Dash panels and ramps.</b> The orange arrows boost you. Press {touch ? 'drift' : 'Space'} as you fly off a ramp for a trick and land with a boost.
          </li>
          <li>
            <b>Coins.</b> Every coin adds a little top speed (up to 50). {touch ? 'Tap your coins' : 'Press B'} to cash in 5 for a quick boost. Getting hit drops coins.
          </li>
        </ul>
      </section>
      <section>
        <h3>Items</h3>
        <p>Drive through the rainbow boxes. The further back you are, the better the items.</p>
        <ul className="g-palmdrive-items">
          {itemHelp(touch).map(([item, text]) => (
            <li key={item}>
              <ItemIcon item={item} size={30} />
              <span>{text}</span>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3>Rough stuff</h3>
        <ul>
          <li>
            <b>Slam.</b> {touch ? 'Tap bump' : 'Press C'} with a kart right beside you: it wobbles, slows down and, if it has any, drops a coin into your pocket.
          </li>
          <li>
            <b>Shield.</b> Hold your banana or shell out behind you and it soaks one hit from behind.
          </li>
        </ul>
      </section>
    </Sheet>
  );
}
