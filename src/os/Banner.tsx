import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { clamp } from './hooks';

type Props = {
  show: boolean;
  mobile: boolean;
  onDismiss: () => void;
  onOpen: () => void;
  autoHideMs?: number;
  children: ReactNode;
};

type Sample = { p: number; t: number };

const SPRING = 'transform 0.5s cubic-bezier(0.2, 0.9, 0.25, 1.08)';
const SETTLE = 'transform 0.36s cubic-bezier(0.2, 0.9, 0.25, 1.1)';

/**
 * A notification banner with native dismissal:
 * macOS shows a round close button on hover and slides out to the right (click, swipe right, or timeout);
 * iOS tracks a finger and flicks up off the screen, springing back from a small drag.
 */
export default function Banner({ show, mobile, onDismiss, onOpen, autoHideMs = 7000, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);
  const [held, setHeld] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [offset, setOffset] = useState<number | null>(null);
  const [transition, setTransition] = useState(SPRING);
  const drag = useRef<{ id: number; x0: number; y0: number; moved: boolean; samples: Sample[] } | null>(null);
  const dismissTimer = useRef<number | null>(null);

  const visible = show && !leaving;

  useEffect(() => {
    if (show) return;
    setLeaving(false);
    setOffset(null);
    setHover(false);
    setHeld(false);
  }, [show]);

  useEffect(() => {
    if (!visible || hover || held) return;
    const t = window.setTimeout(() => onDismiss(), autoHideMs);
    return () => clearTimeout(t);
  }, [visible, hover, held, autoHideMs, onDismiss]);

  useEffect(
    () => () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    },
    [],
  );

  const fling = useCallback(
    (velocity: number) => {
      const el = ref.current;
      const size = el ? (mobile ? el.offsetHeight + 90 : el.offsetWidth + 40) : 300;
      const ms = clamp(size / Math.max(Math.abs(velocity), 0.9), 140, 320);
      setTransition(`transform ${ms}ms cubic-bezier(0.4, 0, 0.9, 0.5)`);
      setOffset(null);
      setLeaving(true);
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
      dismissTimer.current = window.setTimeout(onDismiss, ms + 20);
    },
    [mobile, onDismiss],
  );

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (!visible || e.button !== 0 || (e.target as HTMLElement).closest('.banner-close')) return;
    drag.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, samples: [{ p: 0, t: e.timeStamp }] };
    e.currentTarget.setPointerCapture(e.pointerId);
    setHeld(true);
  };

  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const el = ref.current;
    const k = el ? el.offsetWidth / (el.getBoundingClientRect().width || 1) : 1;
    const dx = (e.clientX - d.x0) * k;
    const dy = (e.clientY - d.y0) * k;
    if (!d.moved && Math.hypot(dx, dy) < 6) return;
    d.moved = true;
    // Along the dismiss direction the banner follows the finger; against it, it only gives a little.
    const raw = mobile ? dy : dx;
    const free = mobile ? raw < 0 : raw > 0;
    const p = free ? raw : raw * 0.18;
    d.samples.push({ p, t: e.timeStamp });
    if (d.samples.length > 6) d.samples.shift();
    setOffset(p);
  };

  const onPointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    setHeld(false);
    if (!d.moved) {
      setOffset(null);
      onDismiss();
      onOpen();
      return;
    }
    const last = d.samples[d.samples.length - 1];
    const first = d.samples.find((s) => last.t - s.t < 120) ?? d.samples[0];
    const velocity = last.t > first.t ? (last.p - first.p) / (last.t - first.t) : 0;
    const el = ref.current;
    const extent = el ? (mobile ? el.offsetHeight : el.offsetWidth) : 200;
    const far = mobile ? last.p < -extent * 0.5 : last.p > extent * 0.3;
    const fast = mobile ? velocity < -0.45 : velocity > 0.45;
    if (far || fast) fling(velocity);
    else {
      setTransition(SETTLE);
      setOffset(null);
    }
  };

  const onPointerCancel = (e: RPointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== e.pointerId) return;
    drag.current = null;
    setHeld(false);
    setTransition(SETTLE);
    setOffset(null);
  };

  const hidden = mobile ? 'translateY(calc(-100% - var(--sat, 0px) - 80px))' : 'translateX(calc(100% + 40px))';
  const transform = offset !== null ? (mobile ? `translateY(${offset}px)` : `translateX(${offset}px)`) : visible ? 'none' : hidden;

  return (
    <div
      ref={ref}
      className={`banner ${visible ? 'is-on' : ''} ${offset !== null ? 'is-dragging' : ''}`}
      role="status"
      aria-hidden={!visible || undefined}
      style={{ transform, transition: offset !== null ? 'none' : transition }}
      onPointerEnter={(e) => e.pointerType === 'mouse' && setHover(true)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(false)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onTransitionEnd={() => {
        if (!leaving) setTransition(SPRING);
      }}
    >
      {!mobile && (
        <button
          className="banner-close"
          aria-label="Close"
          tabIndex={visible ? 0 : -1}
          onClick={(e) => {
            e.stopPropagation();
            fling(2);
          }}
        >
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2.5 2.5l5 5M7.5 2.5l-5 5" />
          </svg>
        </button>
      )}
      <div className="banner-body">{children}</div>
    </div>
  );
}
