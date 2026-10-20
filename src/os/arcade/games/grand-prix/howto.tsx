// How to Play: a sheet over the Start, Pause and Game Over cards.
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

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
      className="g-grand-prix-sheet"
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
      <div className="g-grand-prix-sheet-card">
        <header>
          <h2>{title}</h2>
          <button type="button" ref={close} className="arcade-btn" onClick={onClose}>
            Done
          </button>
        </header>
        <div className="g-grand-prix-sheet-body">{children}</div>
      </div>
    </div>,
    root,
  );
}

const Keys = ({ rows }: { rows: [string, string][] }) => (
  <dl className="g-grand-prix-keys">
    {rows.map(([k, v]) => (
      <div key={k} className="g-grand-prix-keyrow">
        <dt>{k}</dt>
        <dd>{v}</dd>
      </div>
    ))}
  </dl>
);

export function HowToPlay({ root, touch, onClose }: { root: HTMLElement | null; touch: boolean; onClose: () => void }) {
  return (
    <Sheet root={root} title="How to Play" onClose={onClose}>
      <p className="g-grand-prix-lede">
        You drive a 1000 horsepower hybrid race car around Monza. Nothing is scripted: grip comes from the tyres and the air over the car, so braking points, smooth inputs and tyre temperature decide your lap time.
      </p>

      <section>
        <h3>Controls</h3>
        {touch ? (
          <Keys
            rows={[
              ['◀ ▶', 'Steer'],
              ['Gas', 'Throttle'],
              ['Brake', 'Brake (and reverse when stopped)'],
              ['DRS', 'Open the rear wing flap in a DRS zone'],
              ['Cam', 'Change camera'],
              ['Reset', 'Put the car back on the track (costs you the lap)'],
            ]}
          />
        ) : (
          <Keys
            rows={[
              ['↑ or W', 'Throttle'],
              ['↓ or S', 'Brake. Held at a standstill with auto gears, it reverses'],
              ['← → or A D', 'Steer'],
              ['E or Shift', 'Shift up (manual gears)'],
              ['Q', 'Shift down (manual gears)'],
              ['Space', 'Open DRS in a DRS zone'],
              ['C', 'Change camera: chase, T-cam, cockpit, nose'],
              ['V', 'Look behind'],
              ['R', 'Reset to the track (costs you the lap)'],
              ['Esc', 'Pause'],
            ]}
          />
        )}
      </section>

      {!touch && (
        <section>
          <h3>Gamepad</h3>
          <Keys
            rows={[
              ['Left stick', 'Steer'],
              ['RT / LT', 'Throttle and brake, analog'],
              ['RB / LB', 'Shift up and down'],
              ['B', 'DRS'],
              ['Y', 'Camera'],
              ['Back', 'Reset to the track'],
            ]}
          />
          <p className="g-grand-prix-small">A gamepad gives you analog throttle and brake, which makes driving without assists far easier than keys.</p>
        </section>
      )}

      {!touch && (
        <section>
          <h3>2P Split</h3>
          <p>
            Player 1 drives with <b>WASD</b>, <b>Q/E</b> to shift, <b>Space</b> for DRS, <b>C</b> for camera and <b>R</b> to reset. Player 2 uses the <b>arrows</b>, <b>comma/period</b> to shift, <b>right Shift</b> for DRS, <b>L</b> for camera and <b>O</b> to reset. Two
            gamepads work too.
          </p>
        </section>
      )}

      <section>
        <h3>Setup options</h3>
        <h4>Mode</h4>
        <Keys
          rows={[
            ['Time Trial', 'Just you, against the clock and your ghost. Laps count for the leaderboard.'],
            ['Race', 'You against 19 computer drivers from a standing start.'],
            ...(touch ? [] : ([['2P Split', 'Two players on one screen, racing each other and 8 computer drivers.']] as [string, string][])),
          ]}
        />
        <h4>Laps</h4>
        <p>How long the race is: 3, 5 or 10 laps. In Time Trial it is how many timed laps you get before the session ends (your fastest one counts).</p>
        <h4>Rivals</h4>
        <p>How fast the computer drivers are. They all drive the same car as you; the level sets how hard they push in the corners. The times are a clean lap for the fastest car in the field, the rest are up to about 3% slower.</p>
        <Keys
          rows={[
            ['Easy', 'About 1:38 a lap. Brakes early and takes corners gently.'],
            ['Medium', 'About 1:30. A good target for a tidy lap with assists on.'],
            ['Hard', 'About 1:28. Needs late braking and clean exits.'],
            ['Legend', 'About 1:27, right on the limit of grip.'],
          ]}
        />
        <h4>Start</h4>
        <Keys
          rows={[
            ['Pole', 'First on the grid. Defend from the start.'],
            ['Midfield', 'Eleventh, in the middle of the pack.'],
            ['Back', 'Last of twenty. Every place is an overtake.'],
          ]}
        />
        <h4>Assists</h4>
        <Keys
          rows={[
            ['None', `No help: the real race car. ${touch ? 'Holding Gas or Brake' : 'On a keyboard, holding a pedal key'} presses that pedal as far as the tyres take in a straight line, the way a driver squeezes it. You still have to wait for the car to straighten before full power, and ease off if you brake while turning.${touch ? '' : ' A gamepad gives you the raw pedals.'}`],
            ['TC', 'Traction control: cuts power when the rear tyres start to spin, so you can floor it out of corners. Brakes can still lock.'],
            ['TC + ABS', 'Traction control plus anti-lock brakes: you can stamp on the brake and the wheels keep turning. Best for keyboards and beginners.'],
          ]}
        />
        <p className="g-grand-prix-small">Time Trial keeps two leaderboards: No Assists (None) and With Assists (TC or TC + ABS).</p>
        <h4>Commentary</h4>
        <p>A two-person commentary booth talks you through the race like a TV broadcast. James calls the action: the start, overtakes and battles, spins and trips over the kerbs, the fight up front, laps to go and the flag. Sophie, a former racer, explains what just happened, and the two of them chat about Monza and the corner ahead when things are quiet. Turn it off here, or mute the game to silence it along with everything else.</p>
        {touch ? (
          <>
            <h4>Gears</h4>
            <p>On a touch screen the gearbox always shifts for you. With a keyboard or gamepad you can choose Manual and shift yourself.</p>
          </>
        ) : (
          <>
            <h4>Gears</h4>
            <Keys
              rows={[
                ['Auto', 'The gearbox shifts for you.'],
                ['Manual', 'You shift with E and Q (or the bumpers on a gamepad). Shift up when the rev lights turn blue, and down as you brake.'],
              ]}
            />
          </>
        )}
        {!touch && (
          <>
            <h4>Online rooms</h4>
            <p>
              The host picks <b>Laps</b> for everyone and <b>Bots</b>, how fast the computer drivers filling empty seats are (the same levels as Rivals). Assists and gears are each driver&apos;s own choice.
            </p>
          </>
        )}
      </section>

      <section>
        <h3>Modes</h3>
        <ul>
          <li>
            <b>Time Trial.</b> You start rolling down the main straight. Set your fastest lap; your best lap comes back as a see-through ghost car, and the delta box shows if you are ahead (green) or behind (red).
          </li>
          <li>
            <b>Race.</b> Twenty cars from a standing start. Five red lights come on one by one; go when they all go out. Pick how many laps, how fast your rivals are, and where you start on the grid.
          </li>
          <li>
            <b>Online.</b> Race friends in a room. The host picks the laps, and bots can fill the empty seats.
          </li>
        </ul>
      </section>

      <section>
        <h3>Driving fast</h3>
        <ul>
          <li>
            <b>Brake in a straight line, hard and early.</b> From 340 km/h the car needs about 160 m to slow to corner speed, and only while it runs straight. The boards beside the track count down 150, 100 and 50 meters to the big stops.
          </li>
          <li>
            <b>Ease off the brake as you slow down.</b> Downforce presses the car into the road at speed, so it can take full brake at 300 km/h but locks its wheels at 100. Without ABS, feather it as you get to the corner.
          </li>
          <li>
            <b>Be patient on the throttle.</b> Out of slow corners there is far more power than grip. Wait until the steering straightens before going full throttle, or the rear steps out.
          </li>
          <li>
            <b>Smooth beats quick.</b> Sliding costs time and cooks the tyres. Turn in once and let the car settle.
          </li>
          <li>
            <b>Use the whole track.</b> Start the corner from the outside, clip the inside kerb at the apex, and let the car run out to the edge on the exit. But keep at least one wheel inside the white line.
          </li>
        </ul>
      </section>

      <section>
        <h3>The car</h3>
        <ul>
          <li>
            <b>Tyres.</b> The four boxes on the dash are tyre temperatures. Blue is cold with less grip, green (about 90 to 110 C) is the sweet spot, red is overheating. Sliding, spinning the wheels and locking up heat them fast.
          </li>
          <li>
            <b>DRS.</b> In the two DRS zones (the main straight and the back straight) press Space to open the rear wing flap for about 10 km/h more top speed. It shuts the moment you brake. In a race you only get it when you are within a second of the car ahead at the detection point, from lap 3.
          </li>
          <li>
            <b>ERS.</b> The yellow bar is the hybrid battery. It adds power at full throttle and recharges under braking, but it can only give so much each lap, so it runs out near the end of long straights.
          </li>
          <li>
            <b>Slipstream.</b> Right behind another car you have less drag and gain on the straights, but you also lose downforce in corners in its dirty air.
          </li>
          <li>
            <b>Rev lights.</b> Green, red, then blue across the top of the dash: shift up at blue if you use manual gears.
          </li>
        </ul>
      </section>

      <section>
        <h3>Assists</h3>
        <ul>
          <li>
            <b>TC</b> (traction control) trims power when the rear tyres start to spin. <b>ABS</b> stops the wheels locking under braking. <b>Auto</b> gears shift for you.
          </li>
          <li>Turn them off for the real thing, and for more speed once you are consistent. Time Trial keeps separate leaderboards with and without assists.</li>
        </ul>
      </section>

      <section>
        <h3>Rules</h3>
        <ul>
          <li>
            <b>Track limits.</b> Put all four wheels past the white line and the lap is invalid (in red on the timer). In a race you get three warnings, then a 5 second penalty each time.
          </li>
          <li>
            <b>Sectors.</b> The lap is split in three. Purple is the fastest anyone has gone, green is your personal best, yellow is slower.
          </li>
          <li>
            <b>Spun off?</b> Reverse out, or press {touch ? 'Reset' : 'R'} to be put back on the track (the lap will not count).
          </li>
        </ul>
      </section>
    </Sheet>
  );
}
