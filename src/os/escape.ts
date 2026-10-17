type KeyTarget = Pick<Window, 'addEventListener' | 'removeEventListener'>;

// Capture phase runs before OS.tsx's window listener, so Escape closes the overlay without leaving full screen.
export function onEscapeCapture(target: KeyTarget, handler: (e: KeyboardEvent) => void) {
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    handler(e);
  };
  target.addEventListener('keydown', onKey, true);
  return () => target.removeEventListener('keydown', onKey, true);
}
