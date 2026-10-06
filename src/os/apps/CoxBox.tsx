import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppProps } from '../types';

const RACE_M = 500;
const DRAG = 0.35;
const PUNCH = 3.4;
const IDEAL = 34;

type Phase = 'ready' | 'race' | 'done';

const fmt = (s: number) => {
  if (!isFinite(s) || s <= 0) return '–:––.–';
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
};

function callFor(d: number, rate: number, strokes: number): string {
  if (strokes < 3) return 'attention… row!';
  if (d > RACE_M - 100) return 'last hundred — empty the tank!';
  if (d > 240 && d < 300) return 'halfway. power ten — in two… go!';
  if (rate > 42) return 'you’re rushing the slide. lengthen out.';
  if (rate < 26) return 'bring the rate up! we need more.';
  if (rate >= 31 && rate <= 37) return 'that’s it. hold this rhythm.';
  return 'settle… find the swing.';
}

export default function CoxBox(_: AppProps) {
  const [phase, setPhase] = useState<Phase>('ready');
  const [hud, setHud] = useState({ d: 0, t: 0, rate: 0, split: 0, v: 0 });
  const [strokes, setStrokes] = useState(0);
  const [best, setBest] = useState<number | null>(null);
  const [result, setResult] = useState<number | null>(null);
  const sim = useRef({ v: 0, d: 0, t: 0, last: 0, rate: 0, strokes: 0 });
  const raf = useRef(0);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const b = Number(localStorage.getItem('coxbox-best'));
      if (b > 0) setBest(b);
    } catch {
      /* ignore */
    }
    if (window.matchMedia('(pointer: fine)').matches) root.current?.focus();
    return () => cancelAnimationFrame(raf.current);
  }, []);

  const loop = useCallback((prev: number) => {
    raf.current = requestAnimationFrame((now) => {
      const s = sim.current;
      const dt = Math.min(0.05, (now - prev) / 1000);
      s.t += dt;
      s.v *= Math.exp(-DRAG * dt);
      s.d += s.v * dt;
      if (s.t - s.last > 3) s.rate = Math.max(0, s.rate - dt * 6);
      setHud({ d: s.d, t: s.t, rate: s.rate, split: s.v > 0.3 ? RACE_M / s.v : 0, v: s.v });
      if (s.d >= RACE_M) {
        const time = s.t - (s.d - RACE_M) / Math.max(s.v, 0.1);
        setResult(time);
        setPhase('done');
        setBest((b) => {
          const nb = b === null || time < b ? time : b;
          try {
            localStorage.setItem('coxbox-best', String(nb));
          } catch {
            /* ignore */
          }
          return nb;
        });
        return;
      }
      loop(now);
    });
  }, []);

  const stroke = useCallback(() => {
    const s = sim.current;
    if (phase === 'done') return;
    if (phase === 'ready') {
      sim.current = { v: 0, d: 0, t: 0, last: 0, rate: 0, strokes: 0 };
      setPhase('race');
      setResult(null);
      loop(performance.now());
    }
    const now = sim.current.t;
    const interval = now - sim.current.last;
    const rate = sim.current.strokes === 0 ? 0 : 60 / Math.max(interval, 0.2);
    const quality = sim.current.strokes === 0 ? 0.7 : Math.exp(-(((rate - IDEAL) / 10) ** 2));
    sim.current.v += PUNCH * quality;
    sim.current.rate = sim.current.strokes === 0 ? 0 : sim.current.rate ? sim.current.rate * 0.4 + rate * 0.6 : rate;
    sim.current.last = now;
    sim.current.strokes += 1;
    setStrokes(sim.current.strokes);
    void s;
  }, [phase, loop]);

  const reset = () => {
    cancelAnimationFrame(raf.current);
    sim.current = { v: 0, d: 0, t: 0, last: 0, rate: 0, strokes: 0 };
    setHud({ d: 0, t: 0, rate: 0, split: 0, v: 0 });
    setStrokes(0);
    setPhase('ready');
    root.current?.focus();
  };

  const progress = Math.min(1, hud.d / RACE_M);
  const rateClass = hud.rate === 0 ? '' : hud.rate >= 31 && hud.rate <= 37 ? 'is-good' : hud.rate > 42 || hud.rate < 24 ? 'is-bad' : 'is-ok';

  return (
    <div
      className={`cox phase-${phase}`}
      ref={root}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.code === 'Space' || e.key === ' ') {
          e.preventDefault();
          if (!e.repeat) stroke();
        } else if (e.key === 'r' && phase === 'done') reset();
      }}
    >
      <div className="cox-hud">
        <div>
          <small>TIME</small>
          <b>{fmt(hud.t)}</b>
        </div>
        <div className={rateClass}>
          <small>RATE</small>
          <b>{Math.round(hud.rate) || '––'}</b>
        </div>
        <div>
          <small>SPLIT /500</small>
          <b>{fmt(hud.split)}</b>
        </div>
        <div>
          <small>METERS</small>
          <b>{Math.min(RACE_M, Math.floor(hud.d))}</b>
        </div>
      </div>
      <div className="cox-river" style={{ '--off': `${-(hud.d * 18) % 1200}px` } as React.CSSProperties}>
        <div className="cox-water" />
        <div className="cox-lane" />
        <div className="cox-buoys" />
        <div className="cox-boat" style={{ left: `${2 + progress * 66}%` }}>
          <svg viewBox="0 0 220 60" width="220" height="60" aria-hidden="true">
            <g key={strokes} className={strokes ? 'oars pull' : 'oars'}>
              {Array.from({ length: 8 }, (_, i) => {
                const x = 34 + i * 19;
                const side = i % 2 ? 1 : -1;
                return <line key={i} x1={x} y1={30} x2={x - 10} y2={30 + side * 26} />;
              })}
            </g>
            <path d="M6 30 Q 20 22 110 22 Q 200 22 214 30 Q 200 38 110 38 Q 20 38 6 30 Z" fill="#f5f5f7" />
            <path d="M6 30 Q 20 22 110 22 Q 200 22 214 30" fill="none" stroke="#8c1515" strokeWidth="3" />
            {Array.from({ length: 8 }, (_, i) => (
              <circle key={i} cx={34 + i * 19} cy={30} r={4.4} fill="#8c1515" />
            ))}
            <circle cx={196} cy={30} r={4} fill="#ffcf4a" />
          </svg>
        </div>
        <div className="cox-finish" />
      </div>
      <div className="cox-progress">
        <i style={{ width: `${progress * 100}%` }} />
      </div>
      <div className="cox-bottom">
        <p className="cox-call">
          <span className="cox-mic" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg></span>
          {phase === 'ready' ? 'coxswain: tap space (or the button) to take a stroke. hold 32–36 strokes per minute.' : phase === 'race' ? callFor(hud.d, hud.rate, strokes) : 'weigh enough. nice piece.'}
        </p>
        {phase !== 'done' ? (
          <button
            className="cox-btn"
            onPointerDown={(e) => {
              e.preventDefault();
              stroke();
            }}
          >
            {phase === 'ready' ? 'start · row' : 'row'}
          </button>
        ) : (
          <div className="cox-result">
            <span>
              500m in <b>{fmt(result ?? 0)}</b>
              {best !== null && <small> · best {fmt(best)}</small>}
            </span>
            <button className="cox-btn" onClick={reset}>
              again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
