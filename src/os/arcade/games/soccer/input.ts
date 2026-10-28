import type { KeyState } from '../../kit/keys.ts';
import type { Command, Point, World } from './logic.ts';

export type ViewBasis = { right: Point; forward: Point };
export const IDENTITY_BASIS: ViewBasis = { right: { x: 1, z: 0 }, forward: { x: 0, z: -1 } };

export function slewViewBasis(current: ViewBasis, desired: ViewBasis, dt: number): ViewBasis {
  const from = Math.atan2(current.forward.x, current.forward.z);
  const to = Math.atan2(desired.forward.x, desired.forward.z);
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  const cap = Math.PI / 2 * Math.max(0, Math.min(0.1, dt));
  const angle = from + Math.max(-cap, Math.min(cap, delta));
  const forward = { x: Math.sin(angle), z: Math.cos(angle) };
  return { forward, right: { x: -forward.z, z: forward.x } };
}

export function screenToWorld(move: Point, basis: ViewBasis): Point {
  const x = basis.right.x * move.x - basis.forward.x * move.z;
  const z = basis.right.z * move.x - basis.forward.z * move.z;
  return {
    x: x === 0 ? 0 : x,
    z: z === 0 ? 0 : z,
  };
}


export type ControlCommand = Command & { finesseHeld?: boolean };
export type InputState = ControlCommand & {
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
            : null
    : keys.down('KeyK') ? 'shoot'
      : keys.down('KeyJ') ? 'pass'
        : keys.down('KeyL') ? 'through'
          : keys.down('KeyI') ? 'lob'
            : null;
  return {
    move: { x: Math.max(-1, Math.min(1, x)), z: Math.max(-1, Math.min(1, z)) },
    sprint: p2 ? keys.down('ShiftRight') : keys.down('ShiftLeft', 'Shift'),
    action,
    heldAction,
    pressed,
    switchNearest: !p2 && keys.pressed('KeyQ'),
    press: !p2 && keys.down('KeyE'),
    jockey: !p2 && keys.down('Space'),
    autoJockey: p2,
    finesseHeld: keys.down(p2 ? 'Comma' : 'KeyU'),
    aim: { x: x || 1, z: z || 0 },
  };
}

export function touchInput(move: Point, action: Command['action'], pressed: boolean, sprint: boolean, _power = 0.65): InputState {
  return { move, action, heldAction: pressed ? action : null, pressed, sprint, autoJockey: true, aim: { x: move.x || 1, z: move.z } };
}

export type GamepadHistory = { buttons?: boolean[]; flick?: boolean };
type Pad = { buttons: readonly { pressed: boolean; value: number }[]; axes: readonly number[] };

export function gamepadInput(pad: Pad, previous: GamepadHistory = {}, defending = false) {
  const buttons = pad.buttons.map((b) => b.pressed || b.value > 0.3);
  const down = (i: number) => !!buttons[i];
  const edge = (i: number) => down(i) && !previous.buttons?.[i];
  const axis = (i: number) => {
    const value = Math.max(-1, Math.min(1, pad.axes[i] ?? 0));
    if (i >= 2) return Math.abs(value) > 0.14 ? value : 0;
    const t = Math.max(0, Math.min(1, (Math.abs(value) - 0.14) / 0.16));
    return value * t * t * (3 - 2 * t) || 0;
  };
  const move = { x: axis(0), z: axis(1) };
  const flick = Math.hypot(axis(2), axis(3)) > (previous.flick ? 0.65 : 0.8);
  const flickEdge = flick && !previous.flick;
  const action = edge(0) ? 'pass' : edge(1) ? 'shoot' : edge(2) ? 'lob' : edge(3) ? 'through' : null;
  const state: InputState = {
    move, aim: move, sprint: down(7), jockey: down(6), finesseHeld: down(5), press: down(5),
    action: flickEdge && !defending ? 'skill' : action,
    pressed: !!action || flickEdge && !defending,
    heldAction: down(0) ? 'pass' : down(1) ? 'shoot' : down(2) ? 'lob' : down(3) ? 'through' : null,
    contain: defending && down(0), switchNearest: edge(4),
    switchDir: flickEdge && defending ? { x: axis(2), z: axis(3) } : null,
  };
  return { state, previous: { buttons, flick } };
}

export function carryEdge(pending: Partial<Command> | null | undefined, next: Command): Command {
  if (!pending || next.action && next.pressed || next.switchNearest || next.switchDir) return next;
  if (!(pending.action && pending.pressed || pending.switchNearest || pending.switchDir)) return next;
  return {
    ...next,
    action: pending.action,
    pressed: pending.pressed,
    power: pending.power,
    aim: pending.aim,
    switchNearest: pending.switchNearest,
    switchDir: pending.switchDir,
  };
}

export function reconcileControllers(world: World, assignments: Map<number, number>) {
  const next = new Map(assignments);
  for (const [seat, id] of assignments) {
    const old = world.players.find((p) => p.id === id);
    if (!old || old.human && !old.sentOff) continue;
    const assigned = new Set([...next.entries()].filter(([otherSeat]) => otherSeat !== seat).map(([, playerId]) => playerId));
    const replacement = world.players.find((p) => p.team === old.team && !p.sentOff && p.human && !assigned.has(p.id))
      ?? world.players.find((p) => p.team === old.team && !p.sentOff && p.id === world.controlled[old.team] && !assigned.has(p.id));
    if (replacement) next.set(seat, replacement.id);
    else next.delete(seat);
  }
  return next;
}
