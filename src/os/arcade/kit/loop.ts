import { useContext, useEffect, useRef, useState } from 'react';
import { ShellContext } from './context';
import { ArcadeHost } from './host';
import { loopSteps } from './loop-core.ts';

export { loopSteps, MAX_CATCH_UP, MAX_DT } from './loop-core.ts';

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
 * With { realtime: true }, a frame slower than 1/20 s calls update several times instead (steps of at most 1/20 s,
 * catching up on at most 1/4 s, each with the time it ends at), so the game keeps to the wall clock on a slow device
 * rather than slowing down: what an online game needs, where everyone else's game runs at full speed. A game that
 * catches up on its own (from performance.now(), say) must not ask for it, or it would run the time twice.
 * Inside <GameShell> it runs only while status is 'playing' (or always, with { always: true }) and the game is active
 * (tab visible, Chrome tab in front, game on screen). While stopped, render() still runs once after resizes and pauses.
 */
export function useGameLoop(update: (dt: number, now: number) => void, render?: () => void, opts: { always?: boolean; realtime?: boolean } = {}) {
  const shell = useContext(ShellContext);
  const host = useContext(ArcadeHost);
  const docVisible = useDocVisible();
  const u = useRef(update);
  const r = useRef(render);
  u.current = update;
  r.current = render;
  const running = shell ? shell.active && (!!opts.always || shell.status === 'playing') : host.active && docVisible;
  const realtime = useRef(!!opts.realtime);
  realtime.current = !!opts.realtime;

  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let last = -1;
    const frame = (t: number) => {
      const steps = loopSteps(last < 0 ? 0 : (t - last) / 1000, realtime.current);
      last = t;
      // (each step with the moment it ends at: the last one ends now)
      let left = steps.reduce((sum, dt) => sum + dt, 0);
      for (const dt of steps) {
        left -= dt;
        u.current(dt, t - left * 1000);
      }
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
