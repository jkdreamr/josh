/** The part of the 500x700 field that is drawn: everything below the empty strip above the saucer lane. */
export const viewTop = 44;
export const viewHeight = 700 - viewTop;
/** The field may be squashed down to this vertical/horizontal ratio when the window is very short. */
const minSquash = 0.5;
/** Horizontal scale worth squashing for: below it the invaders are too small to read. */
const readable = 0.6;
const scoreLane = 90;

export type Fit = {
  ox: number;
  oy: number;
  sx: number;
  sy: number;
  /** Uniform scale for sprites, so squashed fields keep round invaders. */
  k: number;
  hud: { x: number; y: number; align: 'left' | 'center'; stack: boolean };
};

export type Obstacles = { touch: boolean; ctrlLeft: number; ctrlBottom: number };

function scaleFor(aw: number, ah: number) {
  const sx = Math.max(0.05, Math.min(aw / 500, Math.max(ah / viewHeight, Math.min(readable, ah / (viewHeight * minSquash)))));
  return { sx, sy: Math.min(sx, ah / viewHeight) };
}

/**
 * Fits the field into the canvas. Tall layouts put it under the shell's score and control pills with the
 * wave and lives below; short wide ones (the framed laptop window) run it full height between the pills,
 * with the wave and lives under the score pill.
 */
export function fitCourt(w: number, h: number, { touch, ctrlLeft, ctrlBottom }: Obstacles): Fit {
  const pad = touch ? 150 : 0;
  const top = Math.max(50, ctrlBottom + 6);
  const tallW = Math.max(1, w - 20);
  const tallH = Math.max(1, h - top - (touch ? pad : 34));
  const tall = scaleFor(tallW, tallH);
  const laneRight = Math.min(w - 10, ctrlLeft - 10);
  const laneW = laneRight - scoreLane;
  const laneH = Math.max(1, h - 16 - pad);
  const lane = laneW > 120 ? scaleFor(laneW, laneH) : null;
  if (lane && lane.sx > tall.sx * 1.15) {
    const k = Math.min(lane.sx, lane.sy * 1.5);
    return {
      ...lane,
      k,
      ox: scoreLane + (laneW - 500 * lane.sx) / 2,
      oy: 8 + (laneH - viewHeight * lane.sy) / 2,
      hud: { x: 12, y: Math.max(56, ctrlBottom + 18), align: 'left', stack: true },
    };
  }
  const k = Math.min(tall.sx, tall.sy * 1.5);
  const oy = top + Math.max(0, (tallH - viewHeight * tall.sy) / 2);
  return {
    ...tall,
    k,
    ox: (w - 500 * tall.sx) / 2,
    oy,
    hud: { x: w / 2, y: oy + viewHeight * tall.sy + 22, align: 'center', stack: false },
  };
}
