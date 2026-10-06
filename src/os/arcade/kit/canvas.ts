import { useCallback, useContext, useLayoutEffect, useRef, useState } from 'react';
import { ShellContext } from './context';

export type CanvasSize = { w: number; h: number; dpr: number };

/**
 * Tracks an element's CSS size with ResizeObserver. For a <canvas>, the backing store is scaled by devicePixelRatio
 * (capped at maxDpr, default 2) and ctx() returns a 2D context already transformed so you draw in CSS pixels.
 * Style the element to fill its box (e.g. width: 100%; height: 100%).
 */
export function useCanvas<T extends HTMLElement = HTMLCanvasElement>(opts: { maxDpr?: number } = {}) {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState<CanvasSize>({ w: 0, h: 0, dpr: 1 });
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const dprRef = useRef(1);
  const shell = useContext(ShellContext);
  const invalidate = shell?.invalidate;
  const maxDpr = opts.maxDpr ?? 2;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
      dprRef.current = dpr;
      if (el instanceof HTMLCanvasElement) {
        const bw = Math.max(1, Math.round(w * dpr));
        const bh = Math.max(1, Math.round(h * dpr));
        if (el.width !== bw || el.height !== bh) {
          el.width = bw;
          el.height = bh;
        }
        ctxRef.current?.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      setSize((s) => (s.w === w && s.h === h && s.dpr === dpr ? s : { w, h, dpr }));
      invalidate?.();
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [maxDpr, invalidate]);

  const ctx = useCallback(() => {
    const el = ref.current;
    if (!(el instanceof HTMLCanvasElement)) return null;
    if (!ctxRef.current) {
      ctxRef.current = el.getContext('2d');
      ctxRef.current?.setTransform(dprRef.current, 0, 0, dprRef.current, 0, 0);
    }
    return ctxRef.current;
  }, []);

  return { ref, size, ctx };
}
