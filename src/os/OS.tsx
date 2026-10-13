import { forwardRef, lazy, Suspense, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import Desktop from './Desktop';
import Handheld from './Handheld';
import Hello, { HELLO_MS, HELLO_WRITTEN } from './Hello';
import type { Laptop3DHandle, Laptop3DProps } from './Laptop3D';
import { apps } from './registry';
import { takeResume, trackScreen, type Resume } from './reload';
import { LidStickers, PalmStickers } from './Stickers';
import type { OSApi } from './types';
import { keyRows } from './keys';
import { countView, watchVisits } from './stats';
import { getAppGame } from './arcade/apps';

type Phase = 'off' | 'opening' | 'hello' | 'on' | 'sleep';
type Device = 'laptop' | 'phone' | 'tablet';

/** Lid travel; slow and weighted like a real hinge. The display lights up just before it settles. */
const LID_MS = 2600;
const LIGHT_AT = LID_MS - 350;
/** The boot layer's fade to the desktop. */
const BOOT_FADE_MS = 750;
/** Phones and iPads have no lid: the glass stays dark for a beat, then the display powers on. */
const POWER_MS = 900;

const NoLaptop3D = forwardRef<Laptop3DHandle, Laptop3DProps>(function NoLaptop3D({ onFail }, _ref) {
  useEffect(() => onFail(), [onFail]);
  return null;
});
/** three.js is only downloaded on computers. */
const Laptop3D = lazy(() => import('./Laptop3D').catch(() => ({ default: NoLaptop3D })));

/** The physical device a visitor is most likely holding (or sitting at). */
function detectDevice(): Device {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const ipadOS = navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent);
  if (ipadOS || window.matchMedia('(hover: none) and (pointer: coarse)').matches) return Math.min(w, h) < 600 ? 'phone' : 'tablet';
  return w <= 760 ? 'phone' : 'laptop';
}

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

export default function OS() {
  const [device, setDevice] = useState<Device | null>(null);
  const [landscape, setLandscape] = useState(false);
  const devRef = useRef(device);
  devRef.current = device;
  const mobile = device === 'phone' || device === 'tablet';
  const [phase, setPhase] = useState<Phase>('off');
  const [mounted, setMounted] = useState(false);
  const [fs, setFs] = useState(false);
  const [gen, setGen] = useState(0);
  const [mode, setMode] = useState<'pending' | '3d' | 'css'>('pending');
  const [ready, setReady] = useState(false);
  const beatLink = useRef<string | null>(null);
  const roomInvite = useRef<{ game: string; code: string } | null>(null);
  const resume = useRef<Resume | null>(null);
  const use3d = device === 'laptop' && mode === '3d';
  const use3dRef = useRef(use3d);
  use3dRef.current = use3d;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const l3d = useRef<Laptop3DHandle>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<OSApi | null>(null);
  const [zooming, setZooming] = useState(false);
  const [camera, setCamera] = useState(false);
  const [rotated, setRotated] = useState(false);
  const timers = useRef<number[]>([]);
  const fsRef = useRef(fs);
  fsRef.current = fs;

  // The page load is a visit, and so is every restart or wake after it. A reload that picked up a new deploy
  // mid-visit (see reload.ts) is the same visit, and comes straight back to the app it was opening.
  useEffect(() => {
    const back = takeResume();
    resume.current = back && apps[back.app] ? back : null;
    watchVisits(!resume.current);
    trackScreen(() => ({ fullscreen: fsRef.current }));
  }, []);

  useEffect(() => {
    beatLink.current = new URLSearchParams(window.location.search).get('beat');
    const params = new URLSearchParams(window.location.search);
    const game = params.get('game') ?? '';
    const code = params.get('room') ?? '';
    if (/^[a-z0-9-]+$/.test(game) && /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/.test(code)) roomInvite.current = { game, code };
  }, []);

  useEffect(() => {
    if (phase !== 'on' || !mounted || !beatLink.current) return;
    const beat = beatLink.current;
    beatLink.current = null;
    const timer = window.setTimeout(() => apiRef.current?.open('beatpad', { beat }), 0);
    return () => window.clearTimeout(timer);
  }, [phase, mounted]);

  useEffect(() => {
    if (phase !== 'on' || !mounted || !roomInvite.current) return;
    const invite = roomInvite.current;
    roomInvite.current = null;
    const app = getAppGame(invite.game);
    const timer = window.setTimeout(() => {
      if (invite.game === 'coxbox') apiRef.current?.open('coxbox', { room: invite.code });
      else if (app?.app === 'baduk') apiRef.current?.open('baduk', { game: app.id === 'omok' ? 'omok' : 'go', room: invite.code });
      else if (app?.app === 'badminton') apiRef.current?.open('badminton', { room: invite.code });
      else apiRef.current?.open('chrome', { url: `chrome://games/${encodeURIComponent(invite.game)}?room=${encodeURIComponent(invite.code)}` });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [phase, mounted]);

  const clearTimers = () => {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
  };
  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };
  /** Hello at `at`; the desktop mounts under the finished word so it is painted before the hello fades. */
  const greet = (at: number) => {
    later(() => setPhase('hello'), at);
    later(() => setMounted(true), at + HELLO_WRITTEN);
    later(() => setPhase('on'), at + HELLO_MS);
  };

  const boot = useCallback((fast: boolean) => {
    clearTimers();
    setPhase('off');
    const lap = devRef.current === 'laptop';
    const light = lap ? LIGHT_AT : POWER_MS;
    later(() => setPhase('opening'), 300);
    if (fast) later(() => setPhase('on'), 300 + (lap ? LID_MS : POWER_MS));
    else greet(300 + light);
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
    let t = 0;
    const update = () => {
      setDevice(detectDevice());
      setLandscape(window.innerWidth > window.innerHeight);
    };
    const onResize = () => {
      clearTimeout(t);
      t = window.setTimeout(update, 150);
    };
    update();
    window.addEventListener('resize', onResize);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  useEffect(() => {
    if (!use3d || ready) return;
    const t = setTimeout(() => setReady(true), 5000);
    return () => clearTimeout(t);
  }, [use3d, ready]);

  useEffect(() => clearTimers, []);

  // Boot once the laptop is actually on screen (the WebGL model needs its shaders compiled first).
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current || !device) return;
    if (device === 'laptop' && (mode === 'pending' || (mode === '3d' && !ready))) return;
    booted.current = true;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Coming back from a reload skips the intro. Full screen waits for the lid, since it zooms from the open screen.
    if (resume.current && (reduced || !resume.current.fullscreen)) {
      clearTimers();
      setPhase('on');
    } else if (resume.current) boot(true);
    else if (reduced) {
      clearTimers();
      greet(0);
    } else boot(false);
  }, [boot, device, mode, ready]);

  useEffect(() => {
    if (phase === 'on') setMounted(true);
  }, [phase]);

  // The hello stays on the boot layer while it fades, so the desktop comes up through it rather than through black.
  const [greeting, setGreeting] = useState(false);
  useEffect(() => {
    if (phase === 'hello') setGreeting(true);
    else if (phase !== 'on') setGreeting(false);
    else {
      const t = window.setTimeout(() => setGreeting(false), BOOT_FADE_MS + 100);
      return () => clearTimeout(t);
    }
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

  // Switching device mid-visit (resizing a window, rotating) swaps the hardware, so drop out of full screen.
  const lastDevice = useRef(device);
  useEffect(() => {
    if (lastDevice.current && lastDevice.current !== device) {
      busy.current = false;
      setFs(false);
      setZooming(false);
    }
    lastDevice.current = device;
  }, [device]);

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
    if (use3dRef.current) {
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

  // Phones show the home screen in the hand for a moment, then go edge to edge so taps are full size.
  useEffect(() => {
    if (phase === 'on' && device === 'phone' && !fs) {
      const t = setTimeout(() => setFullscreen(true), 1100);
      return () => clearTimeout(t);
    }
  }, [phase, device, fs, setFullscreen]);

  // Back from a reload onto a new deploy: full screen again if it was, then reopen what was being opened.
  useEffect(() => {
    if (phase !== 'on' || !mounted || !resume.current) return;
    const { app, args, fullscreen } = resume.current;
    resume.current = null;
    const reopen = () => apiRef.current?.open(app, args);
    const timer = window.setTimeout(() => (fullscreen ? setFullscreen(true).then(reopen, reopen) : reopen()), 0);
    return () => window.clearTimeout(timer);
  }, [phase, mounted, setFullscreen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (phase !== 'on' && phase !== 'sleep') {
        skip();
        return;
      }
      const typing = (e.target as HTMLElement)?.closest?.('input, textarea');
      if (e.key === 'Escape' && fsRef.current && devRef.current !== 'phone' && !document.querySelector('.launcher')) setFullscreen(false);
      if (!typing && e.key.toLowerCase() === 'f' && !e.metaKey && !e.ctrlKey && !e.altKey && !fsRef.current && phase === 'on') setFullscreen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, skip, setFullscreen]);

  const restart = useCallback(() => {
    countView();
    clearTimers();
    setMounted(false);
    setGen((g) => g + 1);
    setPhase('opening');
    greet(700);
  }, []);

  const sleep = useCallback(() => {
    clearTimers();
    const wasFs = fsRef.current;
    if (wasFs) setFullscreen(false);
    later(() => setPhase('sleep'), wasFs ? 1100 : 0);
  }, [setFullscreen]);

  const wake = () => {
    if (phase !== 'sleep') return;
    countView();
    setPhase('opening');
    later(() => setPhase('on'), devRef.current === 'laptop' ? LIGHT_AT : POWER_MS);
  };

  /** Shut the lid by hand: the 3D hinge swings closed, then the OS sleeps. Other devices just sleep. */
  const closeLid = useCallback(async () => {
    if (!use3dRef.current || !l3d.current) return sleep();
    if (busy.current) return;
    clearTimers();
    if (fsRef.current) {
      await setFullscreen(false);
      await new Promise((r) => setTimeout(r, 200));
    }
    busy.current = true;
    try {
      await l3d.current.closeLid();
    } finally {
      busy.current = false;
    }
    setPhase('sleep');
  }, [sleep, setFullscreen]);

  /** The visitor dragged the lid: shut puts the Mac to sleep, lifting it wakes the display once the remaining travel is done. */
  const onLid = (open: boolean, remaining: number) => {
    if (!open) {
      clearTimers();
      setPhase('sleep');
      return;
    }
    if (phase !== 'sleep') return;
    countView();
    setPhase('opening');
    later(() => setPhase('on'), Math.max(120, LID_MS * remaining - 350));
  };

  /** A 3D key click during the intro skips it; otherwise the key types. */
  const onKey = () => {
    if (phase === 'on') return false;
    skip();
    return true;
  };

  const lidOpen = phase !== 'off' && phase !== 'sleep';
  const openWork = () => apiRef.current?.open('finder', { folder: 'work' });
  const screenContent = (
    <>
      {use3d && (
        <span className="notch" aria-hidden="true">
          <i className={`cam-led ${camera ? 'is-on' : ''}`} />
        </span>
      )}
      {mounted && (
        <Desktop
          key={gen}
          mobile={mobile}
          tablet={device === 'tablet'}
          fullscreen={fs}
          toggleFullscreen={toggleFullscreen}
          restart={restart}
          sleep={sleep}
          closeLid={closeLid}
          camera={camera}
          setCamera={setCamera}
          apiRef={apiRef}
        />
      )}
      <div
        className={`screen-boot ${phase === 'on' || phase === 'sleep' ? 'is-done' : ''}`}
        style={{ '--boot-fade': `${BOOT_FADE_MS}ms` } as CSSProperties}
        onClick={skip}
      >
        {(phase === 'hello' || greeting) && <Hello />}
      </div>
      <div className="screen-glare" aria-hidden="true" />
    </>
  );

  return (
    <div
      className={`stage stage-${use3d ? '3d' : 'css'} device-${device ?? 'pending'} phase-${phase} ${lidOpen ? 'lid-open' : 'lid-closed'} ${fs ? 'is-fs' : ''} ${zooming ? 'is-zooming' : ''} ${mobile ? 'is-mobile' : ''}`}
    >
      <div className="stage-glow" aria-hidden="true" />
      {use3d && (
        <Suspense fallback={null}>
        <Laptop3D
          ref={l3d}
          open={lidOpen}
          screenOn={phase === 'hello' || phase === 'on'}
          interactive={phase === 'on' || phase === 'sleep'}
          lidMs={LID_MS}
          onPalm={openWork}
          onBody={wake}
          onKey={onKey}
          onLid={onLid}
          onOrbit={setRotated}
          onFail={() => setMode('css')}
          onReady={() => setReady(true)}
        >
          {screenContent}
        </Laptop3D>
        </Suspense>
      )}
      {(device === 'phone' || device === 'tablet') && (
        <Handheld kind={device} landscape={landscape} onWake={wake} sceneRef={sceneRef} screenRef={screenRef}>
          {screenContent}
        </Handheld>
      )}
      {device === 'laptop' && mode === 'css' && (
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
                <span className="notch" aria-hidden="true">
                  <i className={`cam-led ${camera ? 'is-on' : ''}`} />
                </span>
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

      {device && <div className="caption">
        {phase === 'sleep' ? (
          <button className="cap-btn cap-primary" onClick={wake}>
            {mobile ? 'wake up' : 'open the lid'}
          </button>
        ) : phase === 'on' ? (
          <>
            <span className="cap-text">
              <b>joshua koo</b>. this is my {device === 'tablet' ? 'ipad. tap' : device === 'phone' ? 'phone. tap' : 'computer. click'} around.
            </span>
            <button className="cap-btn cap-primary" onClick={() => setFullscreen(true)}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
              full screen
            </button>
            {!mobile && (
              <span className="cap-hint">press ⌘K to search</span>
            )}
            {use3d && rotated && (
              <button className="cap-btn cap-reset" onClick={() => l3d.current?.resetView()}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></svg>
                reset view
              </button>
            )}
          </>
        ) : (
          <button className="cap-btn" onClick={skip}>
            skip intro
          </button>
        )}
      </div>}
    </div>
  );
}
