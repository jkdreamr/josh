import { useContext, type PointerEvent as RPointerEvent } from 'react';
import { ShellContext } from './context';

export type TouchButton = { key: string; label: string };
export type TouchControlsProps = {
  /** true for a 4-way pad, 'x' for left/right only, 'y' for up/down only. Sends ArrowLeft/ArrowRight/ArrowUp/ArrowDown. */
  dpad?: boolean | 'x' | 'y';
  /** Round buttons on the right, each sends a KeyboardEvent.code such as 'Space' or 'KeyX'. */
  buttons?: TouchButton[];
  /** Show on every device (default: touch devices only). */
  always?: boolean;
};

const arrow = { ArrowUp: 'M6 15l6-6 6 6', ArrowDown: 'M6 9l6 6 6-6', ArrowLeft: 'M15 6l-6 6 6 6', ArrowRight: 'M9 6l6 6-6 6' } as const;
type Dir = keyof typeof arrow;

/** On-screen controls that feed the same key state useKeys() reads. Only visible while playing. */
export function TouchControls({ dpad, buttons = [], always }: TouchControlsProps) {
  const shell = useContext(ShellContext);
  if (!shell || (!shell.touch && !always) || shell.status !== 'playing') return null;
  const { keys } = shell;
  const bind = (code: string) => ({
    onPointerDown: (e: RPointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      keys.press(code);
    },
    onPointerUp: () => keys.release(code),
    onPointerCancel: () => keys.release(code),
    onLostPointerCapture: () => keys.release(code),
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
  });
  const dirs: Dir[] = dpad === 'x' ? ['ArrowLeft', 'ArrowRight'] : dpad === 'y' ? ['ArrowUp', 'ArrowDown'] : dpad ? ['ArrowUp', 'ArrowLeft', 'ArrowRight', 'ArrowDown'] : [];
  return (
    <div className="arcade-touch" aria-hidden="true">
      {dirs.length > 0 && (
        <div className={`arcade-dpad dpad-${dpad === true ? 'all' : dpad}`}>
          {dirs.map((d) => (
            <button key={d} type="button" tabIndex={-1} className={`arcade-pad ${d}`} {...bind(d)}>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <path d={arrow[d]} />
              </svg>
            </button>
          ))}
        </div>
      )}
      {buttons.length > 0 && (
        <div className="arcade-btns">
          {buttons.map((b) => (
            <button key={b.key} type="button" tabIndex={-1} className="arcade-tbtn" {...bind(b.key)}>
              {b.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
