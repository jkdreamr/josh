/**
 * Calls `fn` every `ms` milliseconds until the returned function is called, and keeps doing so in a background tab.
 * A hidden page's own timers are held to once a second (and in Chrome to once a minute after a few minutes), and
 * requestAnimationFrame stops altogether; a dedicated worker's timers are not held back that way, so the beat comes
 * from a tiny worker when the browser will start one, else from setInterval. An online game's network loop runs on it,
 * so a player who switches tabs keeps talking to the room (iOS, which stops a background page outright, is the
 * exception: there the room holds the seat until they come back; see RoomLink).
 */
export function every(ms: number, fn: () => void): () => void {
  const period = Math.max(1, Math.round(ms));
  if (typeof Worker !== 'undefined' && typeof Blob !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    try {
      const url = URL.createObjectURL(new Blob([`setInterval(function(){postMessage(0)},${period})`], { type: 'text/javascript' }));
      const worker = new Worker(url);
      let alive = true;
      worker.onmessage = () => {
        if (alive) fn();
      };
      // (a browser that would not run it after all: back to the page's own timer)
      let fallback: ReturnType<typeof setInterval> | null = null;
      worker.onerror = () => {
        worker.terminate();
        if (alive && fallback === null) fallback = setInterval(fn, period);
      };
      return () => {
        alive = false;
        worker.terminate();
        URL.revokeObjectURL(url);
        if (fallback !== null) clearInterval(fallback);
      };
    } catch {
      /* no workers here: the page's own timer */
    }
  }
  const timer = setInterval(fn, period);
  return () => clearInterval(timer);
}
