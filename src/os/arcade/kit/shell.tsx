import { useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { OSContext } from '../../types';
import type { GameMeta } from '../types';
import { ShellContext, type GameOverInfo, type GameStatus, type ShellApi } from './context';
import { ArcadeHost } from './host';
import { KeyState, scrollKeys } from './keys';
import { useHighScore } from './score';
import { sfx, useMuted } from './sfx';
import './kit.css';

export type GameShellProps = {
  meta: GameMeta;
  compact?: boolean;
  onExit?: () => void;
  children: ReactNode;
  /** Skip the Start overlay and begin playing immediately. */
  autoStart?: boolean;
  /** For time-based scores where smaller wins. */
  lowerIsBetter?: boolean;
  formatScore?: (score: number) => string;
  /** Remount children on restart so every round starts from fresh state (default true). */
  remount?: boolean;
  /** Mode and difficulty controls, shown on the Start card above Play and again on the Pause card. */
  setup?: ReactNode;
  className?: string;
  style?: CSSProperties;
};

type Result = { score?: number; best: number | null; isBest: boolean; title?: string; detail?: string };

const Icon = ({ d, size = 14 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
const ic = {
  pause: 'M9 5v14M15 5v14',
  play: 'M7 4.5v15l12-7.5z',
  restart: 'M4 12a8 8 0 1 0 2.4-5.7M4 4v5h5',
  sound: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4zM16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11',
  muted: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4zM16.5 9.5l5 5M21.5 9.5l-5 5',
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
};

/** Focus without scrolling: the laptop screen is projected HTML and must never scroll. */
const autoFocus = (b: HTMLButtonElement | null) => b?.focus({ preventScroll: true });

const isTouchDevice = () =>
  typeof window !== 'undefined' && (window.matchMedia?.('(hover: none) and (pointer: coarse)').matches || navigator.maxTouchPoints > 1);

/**
 * Frame every game renders into: Start, Pause and Game Over overlays, a top-right control row
 * (pause, restart, mute, back to arcade), live score, key capture and auto-pause.
 * Put the game's logic in a child component and read the shell with useShell().
 */
export function GameShell({ meta, compact = false, onExit, children, autoStart, lowerIsBetter, formatScore, remount = true, setup, className, style }: GameShellProps) {
  const host = useContext(ArcadeHost);
  const os = useContext(OSContext);
  const root = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<GameStatus>(autoStart ? 'playing' : 'ready');
  const [round, setRound] = useState(0);
  const [score, setScoreState] = useState<number | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [docVisible, setDocVisible] = useState(true);
  const [seen, setSeen] = useState(true);
  const [touch, setTouch] = useState(false);
  const { best, submit } = useHighScore(meta.id, { lowerIsBetter });
  const [muted, setMuted] = useMuted();
  const keys = useMemo(() => new KeyState(), []);
  const statusRef = useRef(status);
  statusRef.current = status;
  const active = host.active && docVisible && seen;
  const fmt = useCallback((n: number) => (formatScore ? formatScore(n) : n.toLocaleString('en-US')), [formatScore]);

  useEffect(() => setTouch(!!os?.mobile || isTouchDevice()), [os?.mobile]);
  useEffect(() => sfx.retain(), []);

  const focusRoot = useCallback(() => root.current?.focus({ preventScroll: true }), []);
  const start = useCallback(() => {
    sfx.unlock();
    keys.clear();
    setResult(null);
    setStatus('playing');
    focusRoot();
  }, [keys, focusRoot]);
  const restart = useCallback(() => {
    sfx.unlock();
    keys.clear();
    setResult(null);
    setScoreState(null);
    setRound((r) => r + 1);
    setStatus('playing');
    focusRoot();
  }, [keys, focusRoot]);
  const pause = useCallback(() => {
    keys.clear();
    setStatus((s) => (s === 'playing' ? 'paused' : s));
  }, [keys]);
  const resume = useCallback(() => {
    sfx.unlock();
    setStatus((s) => (s === 'paused' ? 'playing' : s));
    focusRoot();
  }, [focusRoot]);
  const gameOver = useCallback(
    (final?: number, info: GameOverInfo = {}) => {
      if (statusRef.current === 'over') return;
      keys.clear();
      const isBest = final !== undefined && submit(final);
      setResult({ score: final, best: null, isBest, ...info });
      setStatus('over');
    },
    [keys, submit],
  );
  const setScore = useCallback((n: number | null) => setScoreState(n), []);

  const listeners = useRef(new Set<() => void>());
  const invalidate = useCallback(() => listeners.current.forEach((f) => f()), []);
  const onInvalidate = useCallback((fn: () => void) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  // Auto-pause when the game stops being visible.
  useEffect(() => {
    if (!active && status === 'playing') pause();
  }, [active, status, pause]);
  useEffect(() => {
    if (status !== 'playing') invalidate();
  }, [status, invalidate]);

  // Visibility: page hidden, element scrolled away, or hidden/minimized by the window manager.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const check = () => {
      const r = el.getBoundingClientRect();
      const inView = r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
      const shown = el.checkVisibility ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) : el.offsetParent !== null;
      setSeen(inView && shown);
    };
    const io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(check) : null;
    io?.observe(el);
    const t = window.setInterval(check, 400);
    const onVis = () => setDocVisible(!document.hidden);
    onVis();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      io?.disconnect();
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  // Key capture: only while focus is inside the game; never swallow Cmd/Ctrl/Alt combos.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const onDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      const st = statusRef.current;
      const onButton = t !== el && !!t.closest?.('button, a');
      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (st === 'playing' || st === 'paused') {
          e.preventDefault();
          e.stopPropagation();
          if (!e.repeat) (st === 'playing' ? pause : resume)();
        }
        return;
      }
      if (onButton && (e.code === 'Enter' || e.code === 'Space')) {
        e.stopPropagation();
        return;
      }
      e.stopPropagation();
      if (scrollKeys.has(e.code)) e.preventDefault();
      if (st === 'ready' || st === 'over' || st === 'paused') {
        if ((e.code === 'Enter' || e.code === 'Space') && !e.repeat) (st === 'ready' ? start : st === 'over' ? restart : resume)();
        return;
      }
      if (st === 'playing') keys.press(e.code, e);
    };
    const onUp = (e: KeyboardEvent) => {
      keys.release(e.code);
      if (!e.metaKey && !e.ctrlKey && !e.altKey) e.stopPropagation();
    };
    const onOut = (e: FocusEvent) => {
      if (!el.contains(e.relatedTarget as Node | null)) keys.clear();
    };
    const onBlur = () => keys.clear();
    el.addEventListener('keydown', onDown);
    el.addEventListener('keyup', onUp);
    el.addEventListener('focusout', onOut);
    window.addEventListener('blur', onBlur);
    return () => {
      el.removeEventListener('keydown', onDown);
      el.removeEventListener('keyup', onUp);
      el.removeEventListener('focusout', onOut);
      window.removeEventListener('blur', onBlur);
    };
  }, [keys, pause, resume, start, restart]);

  const api = useMemo<ShellApi>(
    () => ({ meta, status, round, active, compact, touch, keys, root, start, pause, resume, restart, gameOver, setScore, invalidate, onInvalidate }),
    [meta, status, round, active, compact, touch, keys, start, pause, resume, restart, gameOver, setScore, invalidate, onInvalidate],
  );

  const ctl = (fn: () => void) => () => {
    fn();
    focusRoot();
  };
  const bestNow = result?.isBest ? result.score : best;
  const glyph = (
    <span className="arcade-glyph" style={{ background: meta.accent }}>
      <Icon d={meta.glyph} size={compact ? 16 : 26} />
    </span>
  );

  return (
    <ShellContext.Provider value={api}>
      <div
        ref={root}
        className={['arcade-shell', `g-${meta.id}`, compact ? 'is-compact' : '', `st-${status}`, className ?? ''].join(' ')}
        style={{ ['--accent' as string]: meta.accent, ...style }}
        tabIndex={0}
        role="application"
        aria-label={meta.title}
        onPointerDown={(e) => {
          sfx.unlock();
          if (!(e.target as HTMLElement).closest('button, a, input, textarea, select')) focusRoot();
        }}
        onKeyDown={() => sfx.unlock()}
        onMouseDown={(e) => {
          if (!(e.target as HTMLElement).closest('button, a, input, textarea, select')) e.preventDefault();
        }}
      >
        <div className="arcade-stage" key={remount ? round : 0}>
          {children}
        </div>

        {score !== null && status !== 'ready' && <div className="arcade-score">{fmt(score)}</div>}

        {!compact && (
          <div className="arcade-ctrl">
            {(status === 'playing' || status === 'paused') && (
              <button type="button" aria-label={status === 'paused' ? 'Resume' : 'Pause'} title={status === 'paused' ? 'Resume' : 'Pause'} onClick={status === 'paused' ? resume : pause}>
                <Icon d={status === 'paused' ? ic.play : ic.pause} />
              </button>
            )}
            {status !== 'ready' && (
              <button type="button" aria-label="Restart" title="Restart" onClick={restart}>
                <Icon d={ic.restart} />
              </button>
            )}
            <button type="button" aria-label={muted ? 'Unmute' : 'Mute'} title={muted ? 'Unmute' : 'Mute'} onClick={ctl(() => setMuted(!muted))}>
              <Icon d={muted ? ic.muted : ic.sound} />
            </button>
            {onExit && (
              <button type="button" aria-label="Arcade" title="Arcade" onClick={onExit}>
                <Icon d={ic.grid} />
              </button>
            )}
          </div>
        )}

        {status === 'ready' &&
          (compact ? (
            <button type="button" className="arcade-ov arcade-ov-compact" onClick={start}>
              {glyph}
              <span>
                <b>{meta.title}</b> {touch ? 'Tap to Play' : 'Press Space to Play'}
                {best !== null && <em> · Best {fmt(best)}</em>}
              </span>
            </button>
          ) : (
            <div className="arcade-ov">
              <div className="arcade-card">
                {glyph}
                <h2>{meta.title}</h2>
                <p>{meta.controls}</p>
                {setup && <div className="arcade-setup">{setup}</div>}
                <button type="button" className="arcade-btn arcade-btn-primary arcade-btn-lg" onClick={start} ref={autoFocus}>
                  Play
                </button>
                {best !== null && <small>Best {fmt(best)}</small>}
              </div>
            </div>
          ))}

        {status === 'paused' &&
          (compact ? (
            <button type="button" className="arcade-ov arcade-ov-compact" onClick={resume}>
              <Icon d={ic.play} />
              <span>
                <b>Paused</b> {touch ? 'Tap to Resume' : 'Press Space to Resume'}
              </span>
            </button>
          ) : (
            <div className="arcade-ov">
              <div className="arcade-card">
                <h2>Paused</h2>
                <p>{meta.controls}</p>
                {setup && <div className="arcade-setup">{setup}</div>}
                <button type="button" className="arcade-btn arcade-btn-primary arcade-btn-lg" onClick={resume} ref={autoFocus}>
                  Resume
                </button>
                <div className="arcade-row">
                  <button type="button" className="arcade-btn" onClick={restart}>
                    {setup ? 'New Game' : 'Restart'}
                  </button>
                  {onExit && (
                    <button type="button" className="arcade-btn" onClick={onExit}>
                      Arcade
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}

        {status === 'over' &&
          (compact ? (
            <button type="button" className="arcade-ov arcade-ov-compact" onClick={restart}>
              <Icon d={ic.restart} />
              <span>
                <b>{result?.title ?? 'Game Over'}</b>
                {result?.score !== undefined && ` ${fmt(result.score)}`}
                {bestNow != null && <em> · Best {fmt(bestNow)}</em>} · {touch ? 'Tap to Play Again' : 'Press Space to Play Again'}
              </span>
            </button>
          ) : (
            <div className="arcade-ov">
              <div className="arcade-card">
                <h2>{result?.title ?? 'Game Over'}</h2>
                {result?.score !== undefined && (
                  <div className="arcade-final">
                    <b>{fmt(result.score)}</b>
                    {result.isBest ? <span className="arcade-new">New Best</span> : bestNow != null && <span>Best {fmt(bestNow)}</span>}
                  </div>
                )}
                {result?.detail && <p>{result.detail}</p>}
                {setup && <div className="arcade-setup">{setup}</div>}
                <button type="button" className="arcade-btn arcade-btn-primary arcade-btn-lg" onClick={restart} ref={autoFocus}>
                  Play Again
                </button>
                {onExit && (
                  <div className="arcade-row">
                    <button type="button" className="arcade-btn" onClick={onExit}>
                      Arcade
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
      </div>
    </ShellContext.Provider>
  );
}

/** The surrounding <GameShell>'s state and controls. Throws if used outside one. */
export function useShell(): ShellApi {
  const s = useContext(ShellContext);
  if (!s) throw new Error('useShell must be used inside <GameShell>');
  return s;
}
