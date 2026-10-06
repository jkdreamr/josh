import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import Desktop from './Desktop';
import { LidStickers, PalmStickers } from './Stickers';
import type { OSApi } from './types';
import { useMedia } from './hooks';

type Phase = 'off' | 'opening' | 'hello' | 'on' | 'sleep';

const LID_MS = 1500;
const HELLO_MS = 2700;

const keyRows = [
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [1.5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.5],
  [1.8, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2.2],
  [2.3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2.7],
  [1, 1, 1, 1.3, 5.6, 1.3, 1, 1, 1, 1],
];

function Hello() {
  return (
    <svg className="hello" viewBox="0 0 640 260" aria-label="hello">
      <text x="50%" y="62%" textAnchor="middle">
        hello
      </text>
    </svg>
  );
}

export default function OS() {
  const mobile = useMedia('(max-width: 760px)');
  const [phase, setPhase] = useState<Phase>('off');
  const [mounted, setMounted] = useState(false);
  const [fs, setFs] = useState(false);
  const [gen, setGen] = useState(0);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const screenRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<OSApi | null>(null);
  const [zooming, setZooming] = useState(false);
  const timers = useRef<number[]>([]);
  const fsRef = useRef(fs);
  fsRef.current = fs;

  const clearTimers = () => {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
  };
  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  const boot = useCallback((fast: boolean) => {
    clearTimers();
    setPhase('off');
    later(() => setPhase('opening'), 300);
    if (fast) later(() => setPhase('on'), 300 + LID_MS);
    else {
      later(() => setPhase('hello'), 300 + LID_MS);
      later(() => setPhase('on'), 300 + LID_MS + HELLO_MS);
    }
  }, []);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let seen = false;
    try {
      seen = sessionStorage.getItem('jk-booted') === '1';
      sessionStorage.setItem('jk-booted', '1');
    } catch {
      /* storage can be unavailable in private modes */
    }
    if (reduced) setPhase('on');
    else boot(seen);
    return clearTimers;
  }, [boot]);

  useEffect(() => {
    if (phase === 'on') setMounted(true);
  }, [phase]);

  const skip = useCallback(() => {
    setPhase((p) => {
      if (p === 'off' || p === 'opening' || p === 'hello') {
        clearTimers();
        return 'on';
      }
      return p;
    });
  }, []);

  const busy = useRef(false);

  /** Zoom transform that makes the scene's screen fill (contain) the viewport. */
  const zoomFor = (scene: HTMLElement, screen: HTMLElement) => {
    const r = screen.getBoundingClientRect();
    const sr = scene.getBoundingClientRect();
    const s = Math.min(window.innerWidth / r.width, window.innerHeight / r.height);
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    return { origin: `${cx - sr.left}px ${cy - sr.top}px`, transform: `translate(${window.innerWidth / 2 - cx}px, ${window.innerHeight / 2 - cy}px) scale(${s})` };
  };

  const flip = (el: HTMLElement, first: DOMRect, ms: number) => {
    const last = el.getBoundingClientRect();
    const k = last.width / el.offsetWidth || 1;
    const sx = first.width / last.width;
    const sy = first.height / last.height;
    const dx = (first.left - last.left) / k;
    const dy = (first.top - last.top) / k;
    return el.animate(
      [
        { transformOrigin: '0 0', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
        { transformOrigin: '0 0', transform: 'none' },
      ],
      { duration: ms, easing: 'cubic-bezier(.3,.7,.2,1)' },
    ).finished;
  };

  const setFullscreen = useCallback(async (next: boolean) => {
    const el = screenRef.current;
    const scene = sceneRef.current;
    if (!el || !scene || busy.current || next === fsRef.current) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    busy.current = true;
    setTilt({ x: 0, y: 0 });
    try {
      if (next) {
        if (!reduced) {
          const z = zoomFor(scene, el);
          scene.style.transformOrigin = z.origin;
          scene.style.transition = 'transform .62s cubic-bezier(.55,0,.25,1)';
          setZooming(true);
          scene.style.transform = z.transform;
          await new Promise((r) => setTimeout(r, 640));
        }
        const first = el.getBoundingClientRect();
        flushSync(() => {
          setFs(true);
          setZooming(false);
        });
        scene.style.transition = 'none';
        scene.style.transform = '';
        if (!reduced) await flip(el, first, 340);
      } else {
        const first = el.getBoundingClientRect();
        flushSync(() => setFs(false));
        if (reduced) return;
        scene.style.transition = 'none';
        const z = zoomFor(scene, el);
        scene.style.transformOrigin = z.origin;
        scene.style.transform = z.transform;
        flushSync(() => setZooming(true));
        await flip(el, first, 320);
        scene.style.transition = 'transform .7s cubic-bezier(.3,.7,.2,1)';
        scene.style.transform = '';
        await new Promise((r) => setTimeout(r, 700));
        setZooming(false);
      }
    } finally {
      busy.current = false;
    }
  }, []);

  const toggleFullscreen = useCallback(() => setFullscreen(!fsRef.current), [setFullscreen]);

  // Phones get the desktop edge to edge as soon as it has booted.
  useEffect(() => {
    if (phase === 'on' && mobile && !fs) {
      const t = setTimeout(() => setFullscreen(true), 380);
      return () => clearTimeout(t);
    }
  }, [phase, mobile, fs, setFullscreen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (phase !== 'on' && phase !== 'sleep') {
        skip();
        return;
      }
      const typing = (e.target as HTMLElement)?.closest?.('input, textarea');
      if (e.key === 'Escape' && fsRef.current && !mobile && !document.querySelector('.launcher')) setFullscreen(false);
      if (!typing && e.key.toLowerCase() === 'f' && !e.metaKey && !e.ctrlKey && !e.altKey && !fsRef.current && phase === 'on') setFullscreen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, mobile, skip, setFullscreen]);

  const restart = useCallback(() => {
    clearTimers();
    setMounted(false);
    setGen((g) => g + 1);
    setPhase('opening');
    later(() => setPhase('hello'), 700);
    later(() => setPhase('on'), 700 + HELLO_MS);
  }, []);

  const sleep = useCallback(() => {
    clearTimers();
    const wasFs = fsRef.current;
    if (wasFs) setFullscreen(false);
    later(() => setPhase('sleep'), wasFs ? 1100 : 0);
  }, [setFullscreen]);

  const wake = () => {
    if (phase !== 'sleep') return;
    setPhase('opening');
    later(() => setPhase('on'), LID_MS);
  };

  const onMove = (e: React.PointerEvent) => {
    if (fs || busy.current || e.pointerType !== 'mouse') return;
    if ((e.target as HTMLElement).closest('.screen')) {
      if (tilt.x || tilt.y) setTilt({ x: 0, y: 0 });
      return;
    }
    const nx = (e.clientX / window.innerWidth) * 2 - 1;
    const ny = (e.clientY / window.innerHeight) * 2 - 1;
    setTilt({ x: ny, y: nx });
  };

  const lidOpen = phase !== 'off' && phase !== 'sleep';
  const laptopStyle = { '--tilt-x': `${(-tilt.x * 3).toFixed(2)}deg`, '--tilt-y': `${(tilt.y * 6).toFixed(2)}deg` } as CSSProperties;

  return (
    <div
      className={`stage phase-${phase} ${lidOpen ? 'lid-open' : 'lid-closed'} ${fs ? 'is-fs' : ''} ${zooming ? 'is-zooming' : ''} ${mobile ? 'is-mobile' : ''}`}
      onPointerMove={onMove}
      onPointerLeave={() => setTilt({ x: 0, y: 0 })}
    >
      <div className="stage-glow" aria-hidden="true" />
      <div className="scene" ref={sceneRef}>
        <div className="laptop" style={laptopStyle} onClick={phase === 'sleep' ? wake : undefined}>
          <div className="lid">
            <div className="lid-back" aria-hidden="true">
              <span className="lid-logo">jk</span>
              <LidStickers />
            </div>
            <div className="lid-front">
              <div className="bezel">
                <span className="notch" aria-hidden="true" />
                <div className="screen" ref={screenRef}>
                  {mounted && <Desktop key={gen} mobile={mobile && fs} fullscreen={fs} toggleFullscreen={toggleFullscreen} restart={restart} sleep={sleep} apiRef={apiRef} />}
                  <div className={`screen-boot ${phase === 'on' || phase === 'sleep' ? 'is-done' : ''}`} onClick={skip}>
                    {phase === 'hello' && <Hello />}
                  </div>
                  <div className="screen-glare" aria-hidden="true" />
                </div>
              </div>
            </div>
          </div>
          <div className="base">
            <div className="base-top">
              <div className="keyboard" aria-hidden="true">
                {keyRows.map((row, r) => (
                  <div className="krow" key={r}>
                    {row.map((w, i) => (
                      <i key={i} style={{ flexGrow: w }} />
                    ))}
                  </div>
                ))}
              </div>
              <div className="trackpad" aria-hidden="true" />
            </div>
            <PalmStickers onCrv={() => apiRef.current?.open('finder', { folder: 'work' })} onCognition={() => apiRef.current?.open('finder', { folder: 'work' })} />
            <div className="base-front" aria-hidden="true">
              <span />
            </div>
          </div>
        </div>
      </div>

      <div className="caption">
        {phase === 'sleep' ? (
          <button className="cap-btn cap-primary" onClick={wake}>
            open the lid
          </button>
        ) : phase === 'on' ? (
          <>
            <span className="cap-text">
              <b>joshua koo</b> — this is my computer. click around.
            </span>
            <button className="cap-btn cap-primary" onClick={() => setFullscreen(true)}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
              full screen
            </button>
            <span className="cap-hint">
              <kbd>⌘</kbd>
              <kbd>K</kbd> to search
            </span>
          </>
        ) : (
          <button className="cap-btn" onClick={skip}>
            skip intro
          </button>
        )}
      </div>
    </div>
  );
}
