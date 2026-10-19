// Pictures and sheets for Palm Drive's interface: item and hat icons, the How to Play guide and the Garage.
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { HATS, type Hat, type Item } from './logic';
import { HAT_NAMES, HAT_PRICES, PAINTS, choosePaint, chooseHat, paintColor, type Garage } from './garage';

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

function Mushroom({ cap = '#e53935', edge = '#7a1512' }: { cap?: string; edge?: string }) {
  return (
    <>
      <path d="M2.5 12.5a9.5 8.5 0 0 1 19 0z" fill={cap} stroke={edge} strokeWidth="1" />
      <circle cx="8" cy="8.2" r="2" fill="#fff" />
      <circle cx="15.5" cy="7.6" r="2.4" fill="#fff" />
      <circle cx="12" cy="11" r="1.3" fill="#fff" />
      <rect x="7.5" y="12.5" width="9" height="8" rx="2.5" fill="#f6e7cf" stroke="#9a7f5c" strokeWidth="1" />
      <rect x="10" y="14.5" width="1.2" height="2.6" rx="0.6" fill="#222" />
      <rect x="12.8" y="14.5" width="1.2" height="2.6" rx="0.6" fill="#222" />
    </>
  );
}

const Banana = () => (
  <>
    <path d="M5 6c-1 6 2 12 9 13 3 .4 5-.6 6-2-4 1-9-1-11-5-1-2-1.4-4-1-6z" fill="#ffd640" stroke="#b98a00" strokeWidth="1.1" strokeLinejoin="round" />
    <path d="M5 6l-1-2.2M20 17l1.3.8" stroke="#5b3b1c" strokeWidth="1.6" strokeLinecap="round" />
  </>
);

/** Three of something, arranged like the triple mushroom. */
const Three = ({ children }: { children: ReactNode }) => (
  <>
    <g transform="translate(-4 3) scale(0.6)">{children}</g>
    <g transform="translate(13.6 3) scale(0.6)">{children}</g>
    <g transform="translate(4.8 -2) scale(0.6)">{children}</g>
  </>
);

export function ItemIcon({ item, size }: { item: Item; size?: number }) {
  switch (item) {
    case 'bananas':
      return (
        <Svg size={size}>
          <Three>
            <Banana />
          </Three>
        </Svg>
      );
    case 'greens':
      return (
        <Svg size={size}>
          <Three>
            <Shell fill="#2fae4e" edge="#16632a" />
          </Three>
        </Svg>
      );
    case 'golden':
      return (
        <Svg size={size}>
          <Mushroom cap="#f7c948" edge="#a26b00" />
          <path d="M20 2.5l.8 1.8 1.8.8-1.8.8-.8 1.8-.8-1.8-1.8-.8 1.8-.8z" fill="#fff6c8" />
        </Svg>
      );
    case 'mega':
      return (
        <Svg size={size}>
          <g transform="translate(-1.2 -1.6) scale(1.1)">
            <Mushroom cap="#d81b60" edge="#6d0f31" />
          </g>
          <path d="M19.5 15.5v-6m-2.4 2.4l2.4-2.4 2.4 2.4" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      );
    case 'coin':
      return (
        <Svg size={size}>
          <circle cx="12" cy="12" r="9" fill="#f7c948" stroke="#b9860f" strokeWidth="1.6" />
          <rect x="10.4" y="6.5" width="3.2" height="11" rx="1.6" fill="#fff3c4" stroke="#b9860f" strokeWidth="1" />
        </Svg>
      );
    case 'bomb':
      return (
        <Svg size={size}>
          <circle cx="11" cy="14" r="7.5" fill="#24242c" stroke="#000" strokeWidth="0.8" />
          <circle cx="8.5" cy="11.5" r="2" fill="rgba(255,255,255,0.35)" />
          <rect x="9.5" y="5" width="3" height="2.4" rx="0.6" fill="#ddd" />
          <path d="M12 5c1-2.5 3-3 4.5-2" fill="none" stroke="#9a7f5c" strokeWidth="1.2" />
          <path d="M17.5 1.2l.7 1.5 1.5.7-1.5.7-.7 1.5-.7-1.5-1.5-.7 1.5-.7z" fill="#ffb02e" />
          <path d="M18.5 14h3.5m-1.7-1.8v3.6" stroke="#ddd" strokeWidth="1.4" strokeLinecap="round" />
        </Svg>
      );
    case 'bullet':
      return (
        <Svg size={size}>
          <path d="M3 7h10a6 5 0 0 1 0 10H3z" fill="#24242c" stroke="#000" strokeWidth="0.8" />
          <path d="M3 7L1 4.5h4zM3 17L1 19.5h4z" fill="#24242c" />
          <ellipse cx="14" cy="10.5" rx="1.5" ry="2.1" fill="#fff" />
          <ellipse cx="17.5" cy="10.5" rx="1.3" ry="1.9" fill="#fff" />
          <circle cx="14.6" cy="10.8" r="0.7" fill="#000" />
          <circle cx="18" cy="10.8" r="0.6" fill="#000" />
          <path d="M12 14.5h6" stroke="#c62828" strokeWidth="1.2" strokeLinecap="round" />
        </Svg>
      );
    case 'ink':
      return (
        <Svg size={size}>
          <path d="M12 2c3.5 0 6 2.6 6 6.4 0 2.4-1 3.7-2 4.6l1.4 6.5-2.8-2.6-.6 3.6-2-3-2 3-.6-3.6-2.8 2.6L8 13c-1-.9-2-2.2-2-4.6C6 4.6 8.5 2 12 2z" fill="#f4f4f8" stroke="#555" strokeWidth="0.9" strokeLinejoin="round" />
          <ellipse cx="10" cy="9.5" rx="1.2" ry="1.8" fill="#222" />
          <ellipse cx="14" cy="9.5" rx="1.2" ry="1.8" fill="#222" />
          <circle cx="20" cy="18" r="2" fill="#2b2233" />
          <circle cx="3.5" cy="16.5" r="1.4" fill="#2b2233" />
        </Svg>
      );
    case 'horn':
      return (
        <Svg size={size}>
          <path d="M3 9.5h4l9-6v17l-9-6H3z" fill="#f7c948" stroke="#a26b00" strokeWidth="1" strokeLinejoin="round" />
          <path d="M18.5 8.5a5 5 0 0 1 0 7M20.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
        </Svg>
      );
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

/** A hat drawn on its own, about where it sits on a 24 unit tall head. */
function HatShape({ hat, paint }: { hat: Hat; paint: string }) {
  switch (hat) {
    case 'cap':
      return (
        <>
          <path d="M6 13a6 5.5 0 0 1 12 0z" fill={paint} stroke="rgba(0,0,0,0.3)" />
          <path d="M14 12.5h7.5a1 1 0 0 1 0 2H14z" fill={paint} stroke="rgba(0,0,0,0.3)" />
        </>
      );
    case 'tree':
      return <path d="M12 1.5l3.6 5h-2l3.4 4.5h-2.3l3.3 3.5H6l3.3-3.5H7l3.4-4.5h-2z" fill="#2f8a3c" stroke="#1b5524" strokeLinejoin="round" />;
    case 'top':
      return (
        <>
          <rect x="8" y="3" width="8" height="9" rx="1" fill="#1b1c22" />
          <rect x="8" y="9.5" width="8" height="1.6" fill={paint} />
          <rect x="5" y="11.5" width="14" height="2" rx="1" fill="#1b1c22" />
        </>
      );
    case 'bow':
      return (
        <>
          <path d="M12 11L6 7.5v7zM12 11l6-3.5v7z" fill={paint} stroke="rgba(0,0,0,0.3)" strokeLinejoin="round" />
          <circle cx="12" cy="11" r="1.6" fill="#fff" />
        </>
      );
    case 'tower':
      return (
        <>
          <rect x="10" y="5" width="4" height="9" fill="#e0c49a" stroke="#9c7b58" strokeWidth="0.6" />
          <rect x="9.6" y="6.5" width="4.8" height="1.4" fill="#4a3a2c" />
          <path d="M10 5a2 2 0 0 1 4 0z" fill="#b4553a" />
        </>
      );
    case 'axe':
      return (
        <>
          <rect x="11.3" y="3" width="1.4" height="11" fill="#8c1515" />
          <path d="M12.7 3.5h3.5a2.5 2.5 0 0 1 0 5h-3.5z" fill="#d7dde2" stroke="#7d8790" strokeWidth="0.6" />
        </>
      );
    case 'dish':
      return (
        <>
          <rect x="11.4" y="8" width="1.2" height="6" fill="#ccd" />
          <path d="M6 5.5a6 3 0 0 0 12 0z" fill="#f2f2f0" stroke="#9aa" strokeWidth="0.7" />
        </>
      );
    case 'claw':
      return <path d="M8.5 13C6 10 6.5 6 8 4.5c0 3 1.5 5 3 6.5zM15.5 13c2.5-3 2-7 .5-8.5 0 3-1.5 5-3 6.5z" fill="#c62828" stroke="#7a1512" strokeWidth="0.6" strokeLinejoin="round" />;
  }
}

export const HatIcon = ({ hat, paint = '#e53935', size = 34 }: { hat: Hat; paint?: string; size?: number }) => (
  <Svg size={size}>
    <circle cx="12" cy="17" r="5" fill="#f6f6f8" stroke="rgba(0,0,0,0.25)" />
    <HatShape hat={hat} paint={paint} />
  </Svg>
);

/** Your kart as the Garage shows it: paint and hat. */
export function KartPreview({ paint, hat }: { paint: string; hat: Hat }) {
  return (
    <svg viewBox="0 -8 64 48" width="168" height="126" aria-hidden="true">
      <ellipse cx="32" cy="36" rx="25" ry="3" fill="rgba(0,0,0,0.25)" />
      <path d="M8 29h48l-3-6H35l-3-5h-9l-3 5H11z" fill={paint} stroke="rgba(0,0,0,0.35)" strokeLinejoin="round" />
      <rect x="22" y="15" width="7" height="9" rx="2" fill="#1b1c22" />
      <circle cx="26" cy="12" r="5" fill="#f6f6f8" stroke="rgba(0,0,0,0.25)" />
      {/* the hats are drawn for a head at (12, 17); this one is at (26, 12) */}
      <g transform="translate(14 -5)">
        <HatShape hat={hat} paint={paint} />
      </g>
      <circle cx="16" cy="30" r="5.5" fill="#1b1c22" />
      <circle cx="16" cy="30" r="2" fill="#ddd" />
      <circle cx="48" cy="30" r="5.5" fill="#1b1c22" />
      <circle cx="48" cy="30" r="2" fill="#ddd" />
    </svg>
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
  ['bananas', 'Three bananas, one per press. Hold them out behind you as a shield.'],
  ['green', `Flies straight and bounces off walls. Fire it ahead, or back with ${touch ? '▼' : 'Z'}.`],
  ['greens', 'Three green shells, one per press.'],
  ['red', 'Chases the kart one place ahead of you.'],
  ['bomb', `Lobbed up the road (or dropped back with ${touch ? '▼' : 'Z'}). It blows up when someone comes near, or when its fuse runs out.`],
  ['mushroom', 'A burst of speed. Great for cutting across the grass.'],
  ['triple', 'Three mushrooms, one per press.'],
  ['golden', 'Boost as often as you like for a few seconds.'],
  ['coin', 'Two coins straight into your pocket.'],
  ['star', 'Invincible and faster for a few seconds. Anyone you touch goes flying.'],
  ['mega', 'Grow huge for a few seconds: faster, shrug off bananas and shells, and flatten anyone you touch.'],
  ['bullet', 'Turn into a bullet that flies down the road on its own, sending karts flying.'],
  ['ink', 'Splatters ink over everyone ahead of you.'],
  ['horn', 'A shockwave that knocks over karts close by and wipes out items, blue shells included.'],
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
              <dt>Z or J</dt>
              <dd>Throw your item backwards</dd>
              <dt>C</dt>
              <dd>Slam the kart beside you</dd>
              <dt>B or H</dt>
              <dd>Cash 5 coins for a boost</dd>
              <dt>↓ or S</dt>
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
            <b>Rocket start.</b> {touch ? 'Tap the screen' : 'Press Up or W'} just before the lights turn green.
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
            <b>Coins.</b> Every coin adds a little top speed (up to 10). {touch ? 'Tap your coins' : 'Press B or H'} to cash in 5 for a quick boost. Getting hit drops coins.
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
      <section>
        <h3>Courses</h3>
        <p>
          Each course has its own difficulty: the harder ones are narrower, twistier and have more in the way, and the CPUs drive harder too. On Expert they hardly ever ease off, and a spin or a tumble keeps you down for longer.
          Some courses get busier as the race goes on: the lap banner says what has joined in.
        </p>
        <ul>
          <li>
            <b>Mud</b> slows you down like the grass. A boost or a jump gets you through.
          </li>
          <li>
            <b>Hay bales, boulders, planters and cows</b> are solid. Bump a cow and it spins you out. Shells break on them.
          </li>
          <li>
            <b>Cyclists</b> ride across the road and back. Hit one and you spin out, so time your way past.
          </li>
          <li>
            <b>Oil slicks</b> spin you out. Steer round them: they sit right on the best line.
          </li>
          <li>
            <b>No wall means a drop.</b> Where a striped lip with amber studs takes the place of the wall, run wide and you go over, into water or a pit, and the night
            crew&apos;s crane fishes you out: about three seconds and three coins on Expert, though you keep your item. Tap drift as you touch down for a boost.
          </li>
          <li>
            <b>The trench</b> across the causeway at Hoover Nights: jump it off the ramp at speed, or take a steel plate either side of the hole.
          </li>
          <li>
            <b>Insane: no walls.</b> The Cardinal Skyway is a ribbon of glass in the sky. Glass is slick and frost is slicker, so drift through the corners. Gusts shove you sideways: watch
            the streamers on the lip. Pink pads kick you toward the edge. The panels blink out under you: they flicker first. Fall and the drone fishes you out: about three and a half
            seconds and three coins.
          </li>
          <li>
            <b>Insane, on the water: Redwood Slough.</b> You race a single scull. The water is slick, so carve (drift) through the bends. Tap hop just as the ring closes for a clean
            catch; ten in a row is a Power Ten. The channel is narrow: leave it and you run aground in the marsh, and the coach&apos;s launch tows you off (about four seconds and
            four coins). Whirlpools spin up right on the line out of the bends: when the foam turns, steer round and keep your speed. Wakes, the Bay swell and the wind shove you
            sideways; hop the crest. Mind the rocks in the rapids and the crane&apos;s load swinging across the Port. The current helps
            downstream and fights you upstream, so hug the bank going up. On the last lap the tide turns and the fog comes in.
          </li>
          <li>
            <b>The Marguerite buses</b> drive their rounds slower than you, both in the right-hand lane. Pass on the left: run into one and you spin out. Shells break on them too.
            And they have right of way: the pile drivers, bollards, sprinklers, wrecking balls, fountain jets and the Tree stand aside as a bus comes through, and the crossing waits for one to pass.
          </li>
          <li>
            <b>Pile drivers</b> slam down on the corners every few seconds and sit a moment: the beacon strobes and the head shakes just before it drops. Go under it while it is up, or take the long way round. It flattens you on the way down, it is solid on the ground, and shells break on it there.
          </li>
          <li>
            <b>Bollards</b> rise across the road in four banks from lap 2, one gap rippling across: green lamps down, amber about to rise, red up. Hit a raised bank and you are squashed and stopped behind it. Shells break on a raised bank.
          </li>
          <li>
            <b>Sprinklers</b> on the sweeper spin a jet round from lap 2: the spray spins you (a hop does not clear it), the hub is solid. Pass on the side the arm has just left.
          </li>
          <li>
            <b>Wet road</b> from lap 3: there is no grip through the sweeper, so you turn less. Drift through it, or ease off.
          </li>
          <li>
            <b>Wrecking balls</b> swing across the road on the clock. A hit tumbles you and throws you aside, and beside the Dig that means the drop. Go through fast on the side the ball is leaving.
          </li>
          <li>
            <b>Oncoming traffic</b> down Memorial Church&apos;s straight: cars come at you in the left lane, headlights blazing, and later a delivery van with them. Keep right. Hit one head on and you
            tumble, and the item in your hand goes flying.
          </li>
          <li>
            <b>The Marguerite crossing</b> on the west straight: the bells ring, the lights flash and the gates come down, then a bendy bus crosses the road. Go behind it, beat it across, or wait.
            Later in the race one comes the other way too.
          </li>
          <li>
            <b>The Stanford Tree</b> is on a bungee on the inside of the bend after the church. It crouches, its eyes go red, then it lunges across the inside line and bowls you over. The
            outside, by the ditch, is always clear.
          </li>
          <li>
            <b>Fountain jets</b> blow on the inside of the Claw from lap 4. The water ripples just before one goes up, and it spins you.
          </li>
          <li>
            <b>Lap 5 at Hoover Nights: lights out.</b> Half the street lamps go out and the night closes in. Watch for headlights.
          </li>
          <li>
            <b>Golf carts</b> drive their rounds like the buses, and more cross the road on the cart paths. Run into one and you spin out.
          </li>
          <li>
            <b>Golfers</b> walk across the road with their bags, sometimes four at a time. Hit one and you spin out.
          </li>
          <li>
            <b>Golf balls</b> come down on the road. Watch for a shadow growing under a <b>!</b> and steer clear: one on your head spins you out.
          </li>
          <li>
            <b>Bunkers</b> slow you down like mud. A jump carries you over the one on the 18th.
          </li>
          <li>
            <b>Water</b> on the golf course comes right up to the road behind its red stakes: the same as a drop, and a giant ball retriever fishes you out.
          </li>
          <li>A star, a Mega Mushroom or a Bullet ploughs straight through all of it.</li>
        </ul>
      </section>
      <section>
        <h3>Your garage</h3>
        <p>Coins you pick up (and steal) go in your bank, plus a bonus for a podium finish. Spend them in the Garage on new paint and hats. Online, everyone sees your kart.</p>
      </section>
    </Sheet>
  );
}

export function GarageSheet({ root, garage, onChange, onClose }: { root: HTMLElement | null; garage: Garage; onChange: (g: Garage) => void; onClose: () => void }) {
  const paint = paintColor(garage.paint);
  return (
    <Sheet root={root} title="Garage" onClose={onClose}>
      <div className="g-palmdrive-garage-top">
        <KartPreview paint={paint} hat={garage.hat} />
        <div className="g-palmdrive-bank" aria-label={`${garage.bank} coins in your bank`}>
          <CoinIcon size={22} />
          <b>{garage.bank}</b>
          <small>coins to spend</small>
        </div>
      </div>
      <section>
        <h3>Paint</h3>
        <div className="g-palmdrive-swatches">
          {PAINTS.map((p) => {
            const owned = garage.paints.includes(p.id);
            const next = choosePaint(garage, p.id);
            return (
              <button
                key={p.id}
                type="button"
                className={`g-palmdrive-swatch${garage.paint === p.id ? ' is-on' : ''}`}
                disabled={!next}
                aria-pressed={garage.paint === p.id}
                aria-label={owned ? `${p.id} paint` : `Buy ${p.id} paint for ${p.price} coins`}
                onClick={() => next && onChange(next)}
              >
                <i style={{ background: p.color }} />
                {!owned && (
                  <small>
                    <CoinIcon size={11} />
                    {p.price}
                  </small>
                )}
              </button>
            );
          })}
        </div>
      </section>
      <section>
        <h3>Hats</h3>
        <div className="g-palmdrive-hats">
          {HATS.map((h) => {
            const owned = garage.hats.includes(h);
            const next = chooseHat(garage, h);
            return (
              <button
                key={h}
                type="button"
                className={`g-palmdrive-hat${garage.hat === h ? ' is-on' : ''}`}
                disabled={!next}
                aria-pressed={garage.hat === h}
                aria-label={owned ? HAT_NAMES[h] : `Buy the ${HAT_NAMES[h]} for ${HAT_PRICES[h]} coins`}
                onClick={() => next && onChange(next)}
              >
                <HatIcon hat={h} paint={paint} />
                <span>{HAT_NAMES[h]}</span>
                {!owned && (
                  <small>
                    <CoinIcon size={11} />
                    {HAT_PRICES[h]}
                  </small>
                )}
              </button>
            );
          })}
        </div>
      </section>
    </Sheet>
  );
}
