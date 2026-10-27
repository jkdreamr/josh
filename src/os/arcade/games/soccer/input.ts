import type { KeyState } from '../../kit/keys.ts';
import type { Command, Point } from './logic.ts';

export type InputState = {
  move: Point;
  sprint: boolean;
  action: Command['action'];
  pressed: boolean;
  power: number;
  aim: Point;
};

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
  return {
    move: { x: Math.max(-1, Math.min(1, x)), z: Math.max(-1, Math.min(1, z)) },
    sprint: p2 ? keys.down('ShiftRight') : keys.down('ShiftLeft', 'Shift'),
    action,
    pressed,
    power: keys.down(p2 ? 'Slash' : 'KeyK') ? 0.76 : 0.52,
    aim: { x: x || 1, z: z || 0 },
  };
}

export function touchInput(move: Point, action: Command['action'], pressed: boolean, sprint: boolean, power = 0.65): InputState {
  return { move, action, pressed, sprint, power, aim: { x: move.x || 1, z: move.z } };
}
