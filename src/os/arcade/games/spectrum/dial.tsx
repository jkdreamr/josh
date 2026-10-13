// The Spectrum board: a printed half dial from 0 (left extreme) to 180 degrees (right extreme) with the card
// slotted underneath. The scoring bands sit around the hidden target under a shutter that swings open for the
// psychic and again for the reveal. The group drags, taps or nudges the needle with the arrow keys.
import { useId, useRef, useState, type AnimationEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { stockOf, type Card } from './cards';
import { DIAL, bandsAround, clampDial, type Points } from './logic';

const W = 220;
const H = 126;
const CX = 110;
const CY = 112;
/** The printed face, the plate around it, and how far the needle reaches. */
const R = 96;
const RIM = 108;
const NEEDLE = R - 19;

const round = (n: number) => Math.round(n * 100) / 100;

/** A point on the dial at value v (0 left, 180 right) and radius r, in viewBox units. */
function at(v: number, r: number): [number, number] {
  const a = ((DIAL - v) * Math.PI) / 180;
  return [round(CX + r * Math.cos(a)), round(CY - r * Math.sin(a))];
}

function wedge(from: number, to: number, r: number) {
  const [x1, y1] = at(from, r);
  const [x2, y2] = at(to, r);
  return `M${CX} ${CY}L${x1} ${y1}A${r} ${r} 0 0 1 ${x2} ${y2}Z`;
}

const half = (r: number) => `M${CX - r} ${CY}A${r} ${r} 0 0 1 ${CX + r} ${CY}Z`;
const arc = (r: number) => `M${CX - r} ${CY}A${r} ${r} 0 0 1 ${CX + r} ${CY}`;
/** The plate: a half disc with a bar under it, rounded at the bottom corners. */
const PLATE = `M${CX - RIM} ${CY}A${RIM} ${RIM} 0 0 1 ${CX + RIM} ${CY}V${CY + 6}a4 4 0 0 1 -4 4H${CX - RIM + 4}a4 4 0 0 1 -4 -4Z`;

const TICKS = Array.from({ length: DIAL / 5 + 1 }, (_, i) => i * 5);
const SHUTTER_RINGS = [22, 38, 54, 70];

/**
 * The shutter over the target: `open` (the psychic's view, opens on arrival), `close` (swings shut on arrival),
 * `closed`, or `reveal` (swings open after a beat, then calls onOpen). `shown` skips straight to open.
 */
export type Cover = 'open' | 'close' | 'closed' | 'reveal' | 'shown';

export function Dial({
  card,
  needle,
  target,
  cover,
  points,
  onChange,
  onOpen,
}: {
  card: Card;
  /** Where the needle points, or null to hide it. */
  needle: number | null;
  /** The hidden target. Leave it out while the group guesses, so the bands aren't on the page at all. */
  target?: number;
  cover: Cover;
  /** The points the needle earned, to outline the band it landed in. */
  points?: Points;
  /** Makes the dial draggable. */
  onChange?: (v: number) => void;
  /** Called once the reveal has swung open. */
  onOpen?: () => void;
}) {
  const clip = `g-spectrum-face-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const svg = useRef<SVGSVGElement | null>(null);
  const drag = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const live = !!onChange;

  const valueAt = (e: ReactPointerEvent) => {
    const el = svg.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const x = ((e.clientX - r.left) * W) / r.width - CX;
    const y = CY - ((e.clientY - r.top) * H) / r.height;
    if (Math.hypot(x, Math.max(0, y)) < 4) return null;
    return clampDial(DIAL - (Math.atan2(Math.max(0, y), x) * 180) / Math.PI);
  };

  const down = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!onChange || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    drag.current = e.pointerId;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* the pointer is already gone */
    }
    const v = valueAt(e);
    if (v !== null) onChange(v);
  };
  const move = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (drag.current !== e.pointerId || !onChange) return;
    if (!dragging) setDragging(true);
    const v = valueAt(e);
    if (v !== null) onChange(v);
  };
  const up = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (drag.current !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
  };
  const opened = (e: AnimationEvent<SVGGElement>) => {
    if (e.target === e.currentTarget && cover === 'reveal') onOpen?.();
  };

  const list = target === undefined ? [] : bandsAround(target);
  const hit = points && needle !== null ? list.findIndex((b) => b.points === points && needle >= b.from - 0.001 && needle <= b.to + 0.001) : -1;
  const pct = needle === null ? 50 : Math.round((needle / DIAL) * 100);
  const lean = pct === 50 ? 'Dead center' : pct < 50 ? `${100 - pct}% toward ${card[0]}` : `${pct}% toward ${card[1]}`;

  return (
    <div className={`g-spectrum-dial ${live ? 'is-live' : ''} ${dragging ? 'is-dragging' : ''}`}>
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        role={live ? 'slider' : 'img'}
        tabIndex={live ? 0 : undefined}
        aria-label={`Dial from ${card[0]} to ${card[1]}`}
        aria-valuemin={live ? 0 : undefined}
        aria-valuemax={live ? DIAL : undefined}
        aria-valuenow={live && needle !== null ? Math.round(needle) : undefined}
        aria-valuetext={live ? lean : undefined}
        onPointerDown={live ? down : undefined}
        onPointerMove={live ? move : undefined}
        onPointerUp={live ? up : undefined}
        onPointerCancel={live ? up : undefined}
        onLostPointerCapture={live ? up : undefined}
      >
        <defs>
          <clipPath id={clip}>
            <path d={half(R)} />
          </clipPath>
        </defs>

        <path d={PLATE} className="g-spectrum-plate-edge" transform="translate(0 3)" />
        <path d={PLATE} className="g-spectrum-plate" />
        <g className="g-spectrum-ticks">
          {TICKS.map((v) => {
            const major = v % 45 === 0;
            const [x1, y1] = at(v, R + 3);
            const [x2, y2] = at(v, R + (major ? 9 : 6));
            return <line key={v} x1={x1} y1={y1} x2={x2} y2={y2} className={major ? 'is-major' : undefined} />;
          })}
        </g>
        <path d={half(R)} className="g-spectrum-face" />

        {list.length > 0 && (
          <g className="g-spectrum-bands" clipPath={`url(#${clip})`}>
            {list.map((b, i) => {
              const [tx, ty] = at((b.from + b.to) / 2, R - 9.5);
              return (
                <g key={i} className={`g-spectrum-band is-p${b.points} ${i === hit ? 'is-hit' : ''}`}>
                  <path d={wedge(b.from, b.to, R)} />
                  <text x={tx} y={ty} transform={`rotate(${round((b.from + b.to) / 2 - 90)} ${tx} ${ty})`}>
                    {b.points}
                  </text>
                </g>
              );
            })}
          </g>
        )}
        <path d={arc(R - 4.5)} className="g-spectrum-inset" />

        <g clipPath={`url(#${clip})`}>
          <g className={`g-spectrum-shutter is-${cover}`} onAnimationEnd={opened}>
            <path d={half(R + 1)} className="g-spectrum-shutter-fill" />
            {SHUTTER_RINGS.map((r) => (
              <path key={r} d={arc(r)} className="g-spectrum-shutter-ring" />
            ))}
            <path d={arc(R - 4.5)} className="g-spectrum-shutter-inset" />
          </g>
        </g>

        {needle !== null && (
          <g className="g-spectrum-needle" style={{ transform: `rotate(${round(needle - 90)}deg)` }}>
            <path d={`M${CX - 3.4} ${CY}L${CX - 1} ${CY - NEEDLE}Q${CX} ${CY - NEEDLE - 1.8} ${CX + 1} ${CY - NEEDLE}L${CX + 3.4} ${CY}Z`} />
            {live && <circle className="g-spectrum-grip" cx={CX} cy={CY - NEEDLE + 5} r="4.2" />}
          </g>
        )}
        <circle cx={CX} cy={CY} r="11" className="g-spectrum-cap" />
        <circle cx={CX} cy={CY} r="3.6" className="g-spectrum-cap-dot" />
      </svg>
      <CardFace card={card} />
    </div>
  );
}

/** The card slotted under the board: the two extremes, big enough to read across the table. */
function CardFace({ card }: { card: Card }) {
  // The type shrinks so the longest word on the card still fits its half. A hyphen is a line break too, so
  // "Life-changing" is sized as "Life-" over "changing", not as one long word.
  const longest = Math.max(6, ...card.flatMap((label) => label.split(/\s+|(?<=-)/).map((w) => w.length)));
  return (
    <div className={`g-spectrum-card is-stock${stockOf(card)}`} role="group" aria-label={`${card[0]} to ${card[1]}`} style={{ ['--g-spectrum-long' as string]: longest }}>
      <span className="is-left">
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M7.5 2L3.5 6l4 4" />
        </svg>
        {card[0]}
      </span>
      <span className="is-right">
        {card[1]}
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M4.5 2l4 4-4 4" />
        </svg>
      </span>
    </div>
  );
}
