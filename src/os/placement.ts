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
