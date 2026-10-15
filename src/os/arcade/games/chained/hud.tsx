// The HUD for Chained: the altimeter, the circle cards, the team strip, toasts and the How to Play sheet.
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CHAIN_L, TOP, ZONES, type Platform } from './level';
import { MODE_INFO, type Mode } from './logic';

export type SoulChip = { idx: number; name: string; color: string; y: number; state: 'climbing' | 'air' | 'hanging' | 'burned' | 'out'; me: boolean; rival?: boolean };

/**
 * A tall rail on the right: the six circles as bands with their numerals beside them, a tick for every beacon, a dot
 * for every soul (your chain in one lane and the rival chain in the other during a race), the lava creeping up from
 * the bottom in Lava mode and the way out at the very top.
 */
export function Altimeter({ souls, lava, lit, checkpoints, mode, zone }: { souls: SoulChip[]; lava: number; lit: boolean[]; checkpoints: Platform[]; mode: Mode; zone: number }) {
  const pct = (y: number) => `${(1 - Math.max(0, Math.min(1, y / TOP))) * 100}%`;
  const hpct = (y: number) => `${Math.max(0, Math.min(1, y / TOP)) * 100}%`;
  const lanes = souls.some((s) => s.rival);
  return (
    <div className="g-chained-alti" aria-hidden="true">
      {ZONES.map((z, i) => (
        <span key={z.id} className={`g-chained-alti-numeral${i === zone ? ' is-here' : ''}`} style={{ top: pct((z.from + z.to) / 2), ['--band' as string]: z.palette.ink }}>
          {z.numeral}
        </span>
      ))}
      <div className="g-chained-alti-track">
        {ZONES.map((z, i) => (
          <div key={z.id} className={`g-chained-alti-band${i === zone ? ' is-here' : ''}`} style={{ top: pct(z.to), height: `${((z.to - z.from) / TOP) * 100}%`, ['--band' as string]: z.palette.ink }} />
        ))}
        {mode === 'lava' && <div className="g-chained-alti-lava" style={{ height: hpct(lava) }} />}
        {checkpoints.map((p) => (
          <i key={p.id} className={`g-chained-alti-tick${lit[p.cp] ? ' is-lit' : ''}${p.kind === 'goal' ? ' is-goal' : ''}`} style={{ top: pct(p.y) }} />
        ))}
        {souls.map((s) => (
          <b
            key={s.idx}
            className={`g-chained-alti-soul${s.me ? ' is-me' : ''}${s.rival ? ' is-rival' : ''}${s.state === 'burned' ? ' is-burned' : ''}`}
            style={{ top: pct(s.y), left: lanes ? (s.rival ? '32%' : '68%') : '50%', ...(s.rival ? { ['--soul' as string]: s.color } : { background: s.color }) }}
          />
        ))}
      </div>
    </div>
  );
}

/** The card that slides in as the team enters a circle: its numeral, its name and a line about it. */
export function ZoneCard({ zone }: { zone: number }) {
  const z = ZONES[zone];
  if (!z) return null;
  return (
    <div className="g-chained-zonecard" style={{ ['--ink' as string]: z.palette.ink }}>
      <span className="g-chained-zonecard-numeral">
        <i />
        {z.numeral}
        <i />
      </span>
      <h3>{z.name}</h3>
      <p>{z.line}</p>
    </div>
  );
}

/** Who is on each chain, in chain order, with a link drawn between souls that share one, and what each soul is up to. In a race, the rival chain follows after a "vs". */
export function TeamStrip({ souls, rivals = [], active, solo, touch }: { souls: SoulChip[]; rivals?: SoulChip[]; active: number; solo: boolean; touch: boolean }) {
  // every word fits the same slot, so the chips never change width as souls jump and land
  const word = (s: SoulChip) => (s.state === 'burned' ? 'burned' : s.state === 'hanging' ? 'hanging' : s.state === 'out' ? 'out' : s.state === 'air' ? 'jumping' : 'climbing');
  const chain = (list: SoulChip[]) =>
    list.flatMap((s, i) => [
      i > 0 ? <em key={`link-${s.idx}`} className="g-chained-chip-link" style={{ ['--soul' as string]: s.color }} /> : null,
      <span key={s.idx} className={`g-chained-chip${solo && s.idx === active ? ' is-active' : ''}${s.rival ? ' is-rival' : ''}${s.state === 'burned' ? ' is-burned' : ''}`} style={{ ['--soul' as string]: s.color }}>
        <i />
        <b>{s.name}</b>
        <small>{solo && s.idx === active ? 'steering' : word(s)}</small>
      </span>,
    ]);
  return (
    <div className="g-chained-team" aria-label="The chains">
      {chain(souls)}
      {rivals.length > 0 && <span className="g-chained-vs">vs</span>}
      {chain(rivals)}
      {solo && <span className="g-chained-team-hint">{touch ? 'swap steers the other soul' : 'Shift swaps souls'}</span>}
    </div>
  );
}

function Sheet({ root, title, onClose, children }: { root: HTMLElement | null; title: string; onClose: () => void; children: ReactNode }) {
  const close = useRef<HTMLButtonElement>(null);
  const done = useRef(onClose);
  done.current = onClose;
  useEffect(() => {
    close.current?.focus({ preventScroll: true });
    // while the sheet is open its keys stay in it: Escape closes it and nothing reaches the game behind
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
      className="g-chained-sheet"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onPointerDown={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="g-chained-sheet-card">
        <header>
          <h2>{title}</h2>
          <button type="button" ref={close} className="arcade-btn" onClick={onClose}>
            Done
          </button>
        </header>
        <div className="g-chained-sheet-body">{children}</div>
      </div>
    </div>,
    root,
  );
}

const CIRCLE_NOTES: Record<string, string> = {
  pit: 'Wide ledges and torchlight. Learn the jump, learn the chain.',
  catacombs: 'Cracked ledges give way half a second after you land. Keep moving, and never leave a friend standing on one.',
  forge: 'Iron lifts rise and fall on pistons. Springs throw you two ledges at once.',
  frost: 'Ice. You will keep sliding after you let go, so brake early and jump from further back.',
  cathedral: 'Slabs swing on rails under the broken arches. Wait for them to come to you.',
  stars: 'The shaft opens. Gusts of wind push you sideways in cycles: cross the long gaps in the calm.',
};

export function HowToPlay({ root, touch, onClose }: { root: HTMLElement | null; touch: boolean; onClose: () => void }) {
  return (
    <Sheet root={root} title="How to Play" onClose={onClose}>
      <p className="g-chained-lede">You start at the bottom of the inferno, chained to another soul, and climb six circles of ledges to the stars at the top. The chain is {CHAIN_L} metres long and never stretches. What one of you does, the other feels.</p>
      <section>
        <h3>The chain</h3>
        <ul>
          <li>
            <b>Hold.</b> Walk off a ledge and whoever is still standing holds you. You hang on the chain under the edge.
          </li>
          <li>
            <b>Haul.</b> Walk away from the edge and the chain drags your friend up the wall. Near the top they pull themselves over.
          </li>
          <li>
            <b>Yank.</b> A fast fall snaps the chain tight and drags a standing soul toward the edge. Stand well back when someone jumps.
          </li>
          <li>
            <b>Weight.</b> One standing soul can hold one hanging soul for as long as it likes. With two hanging off it, it slides toward the edge unless it keeps walking.
          </li>
          <li>
            <b>Jumping loaded.</b> A friend hanging under you halves your jump. Get them up first.
          </li>
        </ul>
      </section>
      <section>
        <h3>Controls</h3>
        <dl className="g-chained-keys">
          {touch ? (
            <>
              <dt>◀ ▲ ▼ ▶</dt>
              <dd>Move: left and right go round the tower, up goes toward it</dd>
              <dt>jump</dt>
              <dd>Jump. Let go early for a short hop</dd>
              <dt>swap</dt>
              <dd>On your own, steer the other soul</dd>
            </>
          ) : (
            <>
              <dt>← → or A D</dt>
              <dd>Round the tower. Right is onward and up</dd>
              <dt>↑ ↓ or W S</dt>
              <dd>Toward the tower and away from it</dd>
              <dt>Space</dt>
              <dd>Jump. Let go early for a short hop; hold it for the full height</dd>
              <dt>Shift, Q or E</dt>
              <dd>On your own, swap to the other soul</dd>
              <dt>Esc</dt>
              <dd>Pause</dd>
            </>
          )}
        </dl>
        {!touch && (
          <p>
            <b>Two on one keyboard.</b> Pick it on the Start card. The first soul takes W A S D and Space, the second the arrows and Enter.
          </p>
        )}
        <p>
          <b>Online.</b> Up to four souls on one chain, in seat order. The host picks the mode; everyone climbs their own soul.
        </p>
      </section>
      <section>
        <h3>Racing</h3>
        <p>In a race two chains climb the same tower and the first team with both souls on the way out wins. On your own, or two on one keyboard, you race the shades: a pair of souls the game climbs for itself. The Start card sets how quick they are.</p>
        <p>Online, seats 1 and 2 are one team and seats 3 and 4 the other. A seat alone on its team climbs both of its souls, swapping like a solo climber, and a team with nobody on it is the shades. Crumbling ledges are shared, so a stepping stone one team breaks is gone for the other until it grows back.</p>
      </section>
      <section>
        <h3>On your own</h3>
        <p>You climb two souls, one at a time. Take one up a ledge or two, swap, and bring the other along. Or walk on and let the chain haul the second one up behind you. A soul you leave standing stays put, unless something pulls it.</p>
      </section>
      <section>
        <h3>Modes</h3>
        <ul>
          {(Object.keys(MODE_INFO) as Mode[]).map((m) => (
            <li key={m}>
              <b>{MODE_INFO[m].label}.</b> {MODE_INFO[m].blurb}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3>The six circles</h3>
        <ol className="g-chained-circles">
          {ZONES.map((z) => (
            <li key={z.id} style={{ ['--ink' as string]: z.palette.ink }}>
              <span>{z.numeral}</span>
              <div>
                <b>{z.name}</b>
                <p>{CIRCLE_NOTES[z.id]}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
      <section>
        <h3>Times</h3>
        <p>The clock runs from the start to the moment every soul stands on the top ledge. There is a board for each mode, for solo climbs and for teams. Races keep no board: a race is only ever against who you raced.</p>
      </section>
    </Sheet>
  );
}
