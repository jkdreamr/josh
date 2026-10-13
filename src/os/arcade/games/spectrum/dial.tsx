// The Spectrum dial: an SVG half circle from 0 (left extreme) to 180 degrees (right extreme), with the scoring
// bands around the hidden target and a needle the group drags, taps or nudges with the arrow keys.
import { useId, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Card } from './cards';
import { DIAL, bandsAround, clampDial, type Points } from './logic';

const W = 220;
const H = 124;
const CX = 110;
const CY = 110;
const R = 100;
const NEEDLE = R - 14;

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

const TICKS = Array.from({ length: DIAL / 5 + 1 }, (_, i) => i * 5);

export type BandMode = 'hidden' | 'shown' | 'reveal';

export function Dial({
  card,
  needle,
  target,
  bands = 'hidden',
  points,
  onChange,
}: {
  card: Card;
  /** Where the needle points, or null to hide it. */
  needle: number | null;
  target?: number;
  bands?: BandMode;
  /** The points the needle earned, to outline the band it landed in. */
  points?: Points;
  /** Makes the dial draggable. */
  onChange?: (v: number) => void;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const svg = useRef<SVGSVGElement | null>(null);
  const drag = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const live = !!onChange;
  const showBands = bands !== 'hidden' && target !== undefined;

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

  const list = showBands ? bandsAround(target) : [];
  const hit = points && needle !== null ? list.findIndex((b) => b.points === points && needle >= b.from - 0.001 && needle <= b.to + 0.001) : -1;
  const pct = needle === null ? 50 : Math.round((needle / DIAL) * 100);
  const lean = pct === 50 ? 'Dead center' : pct < 50 ? `${100 - pct}% toward ${card[0]}` : `${pct}% toward ${card[1]}`;

  return (
    <div className={`g-spectrum-dial ${live ? 'is-live' : ''} ${dragging ? 'is-dragging' : ''} is-${bands}`}>
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        role={live ? 'slider' : 'img'}
        tabIndex={live ? 0 : undefined}
        aria-label={live ? 'Dial' : `Dial from ${card[0]} to ${card[1]}`}
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
          <linearGradient id={`${uid}-rim`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2b3a3a" />
            <stop offset="1" stopColor="#0d1414" />
          </linearGradient>
          <radialGradient id={`${uid}-face`} cx={CX} cy={CY} r={R} gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#1d4f4a" />
            <stop offset="0.75" stopColor="#123633" />
            <stop offset="1" stopColor="#0b2422" />
          </radialGradient>
          <radialGradient id={`${uid}-knob`} cx="0.38" cy="0.32" r="0.8">
            <stop offset="0" stopColor="#5eead4" />
            <stop offset="0.55" stopColor="#14b8a6" />
            <stop offset="1" stopColor="#0b5f57" />
          </radialGradient>
          <filter id={`${uid}-shadow`} x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="1.2" stdDeviation="1.4" floodColor="#000" floodOpacity="0.55" />
          </filter>
        </defs>

        <path d={half(R + 7)} fill={`url(#${uid}-rim)`} />
        <path d={half(R + 7)} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="0.6" />
        <path d={half(R)} fill={`url(#${uid}-face)`} />
        <path d={`M${CX - R * 0.62} ${CY}A${R * 0.62} ${R * 0.62} 0 0 1 ${CX + R * 0.62} ${CY}`} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="0.8" />

        <g className="g-spectrum-ticks">
          {TICKS.map((v) => {
            const major = v % 45 === 0;
            const [x1, y1] = at(v, R - (major ? 7 : 3.5));
            const [x2, y2] = at(v, R - 0.8);
            return <line key={v} x1={x1} y1={y1} x2={x2} y2={y2} className={major ? 'is-major' : undefined} />;
          })}
        </g>

        {showBands && (
          <g key={`${target}-${bands}`} className="g-spectrum-bands">
            {list.map((b, i) => {
              const [tx, ty] = at((b.from + b.to) / 2, R - 6.5);
              const ring = Math.abs(i - 2);
              return (
                <g key={i} className={`g-spectrum-band is-p${b.points} ${i === hit ? 'is-hit' : ''}`} style={{ animationDelay: `${(2 - ring) * 0.09}s` }}>
                  <path d={wedge(b.from, b.to, R - 0.5)} />
                  <text x={tx} y={ty} transform={`rotate(${round((b.from + b.to) / 2 - 90)} ${tx} ${ty})`}>
                    {b.points}
                  </text>
                </g>
              );
            })}
          </g>
        )}

        <path d={half(R)} fill="none" stroke="rgba(0,0,0,0.45)" strokeWidth="1.6" />

        <rect x={CX - R - 9} y={CY - 1} width={2 * R + 18} height="9" rx="4.5" fill={`url(#${uid}-rim)`} />
        <rect x={CX - R - 9} y={CY - 1} width={2 * R + 18} height="9" rx="4.5" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="0.5" />

        {needle !== null && (
          <g filter={`url(#${uid}-shadow)`}>
            <g className="g-spectrum-needle" style={{ transform: `rotate(${round(needle - 90)}deg)` }}>
              <path d={`M${CX - 3.2} ${CY}L${CX - 0.9} ${CY - NEEDLE}Q${CX} ${CY - NEEDLE - 1.6} ${CX + 0.9} ${CY - NEEDLE}L${CX + 3.2} ${CY}Z`} fill="#fdfcf8" />
              {live && <circle className="g-spectrum-grip" cx={CX} cy={CY - NEEDLE + 5} r="3.6" />}
            </g>
          </g>
        )}
        <g filter={`url(#${uid}-shadow)`}>
          <circle cx={CX} cy={CY} r="11" fill={`url(#${uid}-knob)`} />
        </g>
        <circle cx={CX} cy={CY} r="11" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="0.8" />
        <circle cx={CX} cy={CY} r="3.4" fill="#f0fdfa" opacity="0.9" />
      </svg>
      <div className="g-spectrum-ends" aria-hidden="true">
        <span>
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M6.5 1.5L3 5l3.5 3.5" />
          </svg>
          {card[0]}
        </span>
        <span>
          {card[1]}
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M3.5 1.5L7 5 3.5 8.5" />
          </svg>
        </span>
      </div>
    </div>
  );
}

/** The card's two extremes, big, above the dial. */
export function CardLabels({ card }: { card: Card }) {
  return (
    <div className="g-spectrum-card" role="group" aria-label={`${card[0]} to ${card[1]}`}>
      <span className="is-left">{card[0]}</span>
      <span className="is-right">{card[1]}</span>
    </div>
  );
}
