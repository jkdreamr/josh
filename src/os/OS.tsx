import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import Desktop from './Desktop';
import Laptop3D, { type Laptop3DHandle } from './Laptop3D';
import { LidStickers, PalmStickers } from './Stickers';
import type { OSApi } from './types';
import { useMedia } from './hooks';
import { keyRows } from './keys';

type Phase = 'off' | 'opening' | 'hello' | 'on' | 'sleep';

/** Lid travel; slow and weighted like a real hinge. The display lights up just before it settles. */
const LID_MS = 2600;
const LIGHT_AT = LID_MS - 350;
const HELLO_MS = 2700;

function Keyboard() {
  return (
    <div className="keyboard" aria-hidden="true">
      {keyRows.map((row, r) => (
        <div className="krow" key={r}>
          {row.map((key, i) => (
            <i key={i} className={`key k-${key.k ?? 'c'}`} style={{ flexGrow: key.w ?? 1 }}>
              {key.a && <span className="ka">{key.a}</span>}
              {key.b && <span className="kb">{key.b}</span>}
            </i>
          ))}
          {r === keyRows.length - 1 && (
            <span className="arrows">
              <i className="key k-c half">◀</i>
              <span className="updown">
                <i className="key k-c">▲</i>
                <i className="key k-c">▼</i>
              </span>
              <i className="key k-c half">▶</i>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

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
  const [mode, setMode] = useState<'pending' | '3d' | 'css'>('pending');
  const [ready, setReady] = useState(false);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const l3d = useRef<Laptop3DHandle>(null);
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
      later(() => setPhase('hello'), 300 + LIGHT_AT);
      later(() => setPhase('on'), 300 + LIGHT_AT + HELLO_MS);
    }
  }, []);

  useEffect(() => {
    let gl = false;
    try {
      const c = document.createElement('canvas');
      gl = !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch {
      gl = false;
    }
    setMode(gl ? '3d' : 'css');
  }, []);

  useEffect(() => {
    if (mode !== '3d' || ready) return;
    const t = setTimeout(() => setReady(true), 5000);
    return () => clearTimeout(t);
  }, [mode, ready]);

  useEffect(() => clearTimers, []);

  // Boot once the laptop is actually on screen (the WebGL model needs its shaders compiled first).
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current || mode === 'pending' || (mode === '3d' && !ready)) return;
    booted.current = true;
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
  }, [boot, mode, ready]);

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
    if (modeRef.current === '3d') {
      const lap = l3d.current;
      if (!lap || busy.current || next === fsRef.current) return;
      busy.current = true;
      try {
        if (next) {
          setZooming(true);
          await lap.enterFs(() => flushSync(() => (setFs(true), setZooming(false))));
        } else {
          await lap.exitFs(() => flushSync(() => (setFs(false), setZooming(true))));
          setZooming(false);
        }
      } finally {
        busy.current = false;
      }
      return;
    }
    const el = screenRef.current;
    const scene = sceneRef.current;
    if (!el || !scene || busy.current || next === fsRef.current) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    busy.current = true;
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
    later(() => setPhase('on'), LIGHT_AT);
  };

  const lidOpen = phase !== 'off' && phase !== 'sleep';
  const openWork = () => apiRef.current?.open('finder', { folder: 'work' });
  const screenContent = (
    <>
      {mode === '3d' && <span className="notch" aria-hidden="true" />}
      {mounted && <Desktop key={gen} mobile={mobile && fs} fullscreen={fs} toggleFullscreen={toggleFullscreen} restart={restart} sleep={sleep} apiRef={apiRef} />}
      <div className={`screen-boot ${phase === 'on' || phase === 'sleep' ? 'is-done' : ''}`} onClick={skip}>
        {phase === 'hello' && <Hello />}
      </div>
      <div className="screen-glare" aria-hidden="true" />
    </>
  );

  return (
    <div
      className={`stage stage-${mode} phase-${phase} ${lidOpen ? 'lid-open' : 'lid-closed'} ${fs ? 'is-fs' : ''} ${zooming ? 'is-zooming' : ''} ${mobile ? 'is-mobile' : ''}`}
    >
      <div className="stage-glow" aria-hidden="true" />
      {mode === '3d' && (
        <Laptop3D
          ref={l3d}
          open={lidOpen}
          screenOn={phase === 'hello' || phase === 'on'}
          lidMs={LID_MS}
          onPalm={openWork}
          onBody={wake}
          onFail={() => setMode('css')}
          onReady={() => setReady(true)}
        >
          {screenContent}
        </Laptop3D>
      )}
      {mode === 'css' && (
      <div className="scene" ref={sceneRef}>
        <div className="laptop" onClick={phase === 'sleep' ? wake : undefined}>
          <div className="lid">
            <div className="lid-edge" aria-hidden="true" />
            <div className="lid-back" aria-hidden="true">
              <span className="lid-logo">jk</span>
              <LidStickers />
            </div>
            <div className="lid-front">
              <div className="bezel">
                <span className="notch" aria-hidden="true" />
                <div className="screen" ref={screenRef}>
                  {screenContent}
                </div>
              </div>
            </div>
          </div>
          <div className="base">
            <div className="base-shadow" aria-hidden="true" />
            <div className="hinge" aria-hidden="true" />
            <div className="base-top">
              <div className="deck">
                <span className="grille" aria-hidden="true" />
                <Keyboard />
                <span className="grille" aria-hidden="true" />
              </div>
              <div className="trackpad" aria-hidden="true" />
            </div>
            <PalmStickers onCrv={openWork} onCognition={openWork} />
            <div className="base-front" aria-hidden="true">
              <span />
            </div>
          </div>
        </div>
      </div>
      )}

      <div className="caption">
        {phase === 'sleep' ? (
          <button className="cap-btn cap-primary" onClick={wake}>
            open the lid
          </button>
        ) : phase === 'on' ? (
          <>
            <span className="cap-text">
              <b>joshua koo</b>. this is my computer. click around.
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
