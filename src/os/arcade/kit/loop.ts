import { useContext, useEffect, useRef, useState } from 'react';
import { ShellContext } from './context';
import { ArcadeHost } from './host';
import { every } from './ticker';

export const MAX_DT = 1 / 20;

function useDocVisible() {
  const [v, setV] = useState(true);
  useEffect(() => {
    const f = () => setV(!document.hidden);
    f();
    document.addEventListener('visibilitychange', f);
    return () => document.removeEventListener('visibilitychange', f);
  }, []);
  return v;
}

/**
 * requestAnimationFrame loop. update(dt) gets seconds since the last frame, clamped to 1/20 s (and the frame's own time,
 * on performance.now()'s clock: when the frame began, which keeps in step with the screen where the moment the callback
 * happens to run does not); render() runs after it.
 * Inside <GameShell> it runs only while status is 'playing' (or always, with { always: true }) and the game is active
 * (tab visible, Chrome tab in front, game on screen). While stopped, render() still runs once after resizes and pauses.
 * In an online round the game keeps stepping (without drawing) about 30 times a second when the window gets no frames
 * (a hidden tab, a minimized or covered window): the host's game runs everyone's round, so it must never stall.
 */
export function useGameLoop(update: (dt: number, now: number) => void, render?: () => void, opts: { always?: boolean } = {}) {
  const shell = useContext(ShellContext);
  const host = useContext(ArcadeHost);
  const docVisible = useDocVisible();
  const u = useRef(update);
  const r = useRef(render);
  u.current = update;
  r.current = render;
  const running = shell ? shell.active && (!!opts.always || shell.status === 'playing') : host.active && docVisible;
  const online = !!shell?.online;

  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let last = -1;
    let lastFrame = performance.now();
    const step = (t: number) => {
      const dt = last < 0 ? 0 : Math.min(Math.max(0, (t - last) / 1000), MAX_DT);
      last = t;
      u.current(dt, t);
    };
    const frame = (t: number) => {
      lastFrame = performance.now();
      step(t);
      r.current?.();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    // Frames stop for a hidden or covered window; a worker-driven beat (not held back in the background) steps instead.
    const stop = online
      ? every(1000 / 30, () => {
          const now = performance.now();
          if (!document.hidden && now - lastFrame < 60) return;
          step(now);
        })
      : null;
    return () => {
      cancelAnimationFrame(raf);
      stop?.();
    };
  }, [running, online]);

  const onInvalidate = shell?.onInvalidate;
  useEffect(() => {
    if (running || !onInvalidate) return;
    let raf = requestAnimationFrame(() => r.current?.());
    const off = onInvalidate(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => r.current?.());
    });
    return () => {
      cancelAnimationFrame(raf);
      off();
    };
  }, [running, onInvalidate]);
}
