import { useContext, useEffect, useRef, useState } from 'react';
import { ShellContext } from './context';
import { ArcadeHost } from './host';

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
 * requestAnimationFrame loop. update(dt) gets seconds since the last frame, clamped to 1/20 s; render() runs after it.
 * Inside <GameShell> it runs only while status is 'playing' (or always, with { always: true }) and the game is active
 * (tab visible, Chrome tab in front, game on screen). While stopped, render() still runs once after resizes and pauses.
 */
export function useGameLoop(update: (dt: number) => void, render?: () => void, opts: { always?: boolean } = {}) {
  const shell = useContext(ShellContext);
  const host = useContext(ArcadeHost);
  const docVisible = useDocVisible();
  const u = useRef(update);
  const r = useRef(render);
  u.current = update;
  r.current = render;
  const running = shell ? shell.active && (!!opts.always || shell.status === 'playing') : host.active && docVisible;

  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let last = -1;
    const frame = (t: number) => {
      const dt = last < 0 ? 0 : Math.min(Math.max(0, (t - last) / 1000), MAX_DT);
      last = t;
      u.current(dt);
      r.current?.();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [running]);

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
