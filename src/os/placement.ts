export type Rect = { x: number; y: number; w: number; h: number };

/** Space kept between a side panel and the screen edge, and between it and the windows it moves. */
export const PANEL_GAP = 8;

/**
 * A panel down the right edge of the screen, from `top` to `bottom`, `width` wide (or as wide as fits), and where each
 * window it would cover moves to make room: left, as far as it needs and the screen allows. A window too wide to clear
 * it entirely ends up at the left edge, still partly under the panel.
 */
export function sidePanel(screen: { w: number; top: number; bottom: number }, width: number, wins: readonly (Rect & { id: string })[]): { panel: Rect; moves: Map<string, number> } {
  const w = Math.max(0, Math.min(width, screen.w - 2 * PANEL_GAP));
  const panel = { x: screen.w - w - PANEL_GAP, y: screen.top, w, h: Math.max(0, screen.bottom - screen.top) };
  const moves = new Map<string, number>();
  for (const win of wins) {
    if (win.x + win.w <= panel.x - PANEL_GAP) continue;
    const x = Math.max(PANEL_GAP, panel.x - PANEL_GAP - win.w);
    if (x < win.x) moves.set(win.id, x);
  }
  return { panel, moves };
}

/**
 * Where a window goes when the screen changes size, from `prev` to `next`. A window that sat fully on screen and clear of
 * the dock stays that way (shrinking if it must, like a freshly opened one); one the visitor dragged partly off screen
 * only stays reachable.
 */
export function refit(win: Rect, prev: { w: number; h: number }, next: { w: number; h: number }, top: number, dockSpace: number): Rect {
  const inside = win.x >= 0 && win.x + win.w <= prev.w + 1 && win.y + win.h <= prev.h + 1;
  const clearOfDock = inside && win.y + win.h <= prev.h - dockSpace + 1;
  const w = Math.min(win.w, next.w - 16);
  let h = Math.min(win.h, next.h - top - 12);
  if (clearOfDock) h = Math.min(h, Math.max(next.h - top - dockSpace - 10, Math.min(h, 160)));
  const x = inside
    ? Math.max(Math.min(win.x, PANEL_GAP), Math.min(win.x, next.w - w - PANEL_GAP))
    : Math.min(Math.max(win.x, PANEL_GAP - w / 2), next.w - w / 2);
  const bottom = clearOfDock ? next.h - dockSpace : inside ? next.h - 4 : next.h - 60 + h;
  const y = Math.max(top + 4, Math.min(win.y, bottom - h));
  return { x, y, w, h };
}
