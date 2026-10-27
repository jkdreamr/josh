import type { KeyState } from '../../kit/keys.ts';
import type { Command, Point } from './logic.ts';

export type ViewBasis = { right: Point; forward: Point };
export const IDENTITY_BASIS: ViewBasis = { right: { x: 1, z: 0 }, forward: { x: 0, z: -1 } };

export function screenToWorld(move: Point, basis: ViewBasis): Point {
  const x = basis.right.x * move.x - basis.forward.x * move.z;
  const z = basis.right.z * move.x - basis.forward.z * move.z;
  return {
    x: x === 0 ? 0 : x,
    z: z === 0 ? 0 : z,
  };
}

export type InputState = {
  move: Point;
  sprint: boolean;
  action: Command['action'];
  heldAction: Command['action'];
  pressed: boolean;
  aim: Point;
};

export function chargePower(seconds: number) {
  return Math.max(0.1, Math.min(1, seconds));
}

export function keyboardInput(keys: KeyState, p2 = false, arrows = false): InputState {
  const x = p2
    ? Number(keys.down('ArrowRight')) - Number(keys.down('ArrowLeft'))
    : Number(keys.down('KeyD')) - Number(keys.down('KeyA')) + (arrows ? Number(keys.down('ArrowRight')) - Number(keys.down('ArrowLeft')) : 0);
  const z = p2
    ? Number(keys.down('ArrowDown')) - Number(keys.down('ArrowUp'))
    : Number(keys.down('KeyS')) - Number(keys.down('KeyW')) + (arrows ? Number(keys.down('ArrowDown')) - Number(keys.down('ArrowUp')) : 0);
  let action: Command['action'] = null;
  let pressed = false;
  if (p2) {
    if (keys.pressed('Period')) { action = 'pass'; pressed = true; }
    else if (keys.pressed('Slash')) { action = 'shoot'; pressed = true; }
    else if (keys.pressed('Semicolon')) { action = 'through'; pressed = true; }
    else if (keys.pressed('Quote')) { action = 'lob'; pressed = true; }
    else if (keys.pressed('Comma')) { action = 'skill'; pressed = true; }
  } else {
    if (keys.pressed('KeyJ')) { action = 'pass'; pressed = true; }
    else if (keys.pressed('KeyK')) { action = 'shoot'; pressed = true; }
    else if (keys.pressed('KeyL')) { action = 'through'; pressed = true; }
    else if (keys.pressed('KeyI')) { action = 'lob'; pressed = true; }
    else if (keys.pressed('KeyU')) { action = 'skill'; pressed = true; }
  }
  const heldAction: Command['action'] = p2
    ? keys.down('Slash') ? 'shoot'
      : keys.down('Period') ? 'pass'
        : keys.down('Semicolon') ? 'through'
          : keys.down('Quote') ? 'lob'
            : keys.down('Comma') ? 'skill' : null
    : keys.down('KeyK') ? 'shoot'
      : keys.down('KeyJ') ? 'pass'
        : keys.down('KeyL') ? 'through'
          : keys.down('KeyI') ? 'lob'
            : keys.down('KeyU') ? 'skill' : null;
  return {
    move: { x: Math.max(-1, Math.min(1, x)), z: Math.max(-1, Math.min(1, z)) },
    sprint: p2 ? keys.down('ShiftRight') : keys.down('ShiftLeft', 'Shift'),
    action,
    heldAction,
    pressed,
    aim: { x: x || 1, z: z || 0 },
  };
}

export function touchInput(move: Point, action: Command['action'], pressed: boolean, sprint: boolean, _power = 0.65): InputState {
  return { move, action, heldAction: pressed ? action : null, pressed, sprint, aim: { x: move.x || 1, z: move.z } };
}
