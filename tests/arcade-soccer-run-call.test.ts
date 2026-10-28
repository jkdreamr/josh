import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeAI } from '../src/os/arcade/games/soccer/ai.ts';
import { carryEdge, phoneViewKey } from '../src/os/arcade/games/soccer/input.ts';
import { callRun, createWorld, possessionTeam, setRestart, STEP, stepWorld, type World } from '../src/os/arcade/games/soccer/logic.ts';
import { acceptMovePacket, commandFromPacket, movePacket, neutralCommand, parsePacket, type RemoteSeat } from '../src/os/arcade/games/soccer/net.ts';
import { LT_TAP_MS, ltTapSkill, shoulderLabels, stickSprint, stickVector } from '../src/os/arcade/games/soccer/pad.ts';
import { offsideLine } from '../src/os/arcade/games/soccer/rules.ts';
import { setPieceLabels } from '../src/os/arcade/games/soccer/setpieces.ts';

function liveWorld(): World {
  const world = createWorld(1841, 120, 1);
  world.phase = 'live';
  world.restart = null;
  world.setPiece = null;
  world.eventTime = 0;
  world.controlled = [6, 17];
  for (const player of world.players) {
    player.human = player.id === 6;
    player.controlled = player.id === 6;
    player.vx = 0;
    player.vz = 0;
    player.cooldown = 0;
    player.touchCd = 0;
    player.slide = null;
    if (player.team === 0) {
      player.x = -22;
      player.z = (player.id % 11 - 5) * 4;
    } else {
      player.x = player.slot === 'GK' ? 50 : 25;
      player.z = (player.id % 11 - 5) * 2;
    }
  }
  const carrier = world.players[6]!;
  carrier.x = 20;
  carrier.z = 0;
  world.players[0]!.x = -45;
  world.players[8]!.x = 10;
  world.players[8]!.z = -10;
  world.players[9]!.x = 15;
  world.players[9]!.z = 0;
  world.players[10]!.x = 10;
  world.players[10]!.z = 10;
  world.ball = { x: carrier.x, y: 0.11, z: carrier.z, vx: 0, vy: 0, vz: 0, spin: 0, grounded: true, inNet: false };
  world.carrierId = carrier.id;
  world.lastToucherId = carrier.id;
  world.lastTouch = 0;
  world.passTarget = null;
  return world;
}

const remoteSeat = (): RemoteSeat => ({ seq: -1, edge: -1, held: null, pressUsed: false });

test('run-call selection follows the stick cone and safely falls back to an advanced forward', () => {
  const world = liveWorld();
  const carrier = world.players[6]!;
  carrier.x = 0;
  world.ball.x = 0;
  world.players[8]!.x = 10;
  world.players[8]!.z = -10;
  world.players[9]!.x = 12;
  world.players[9]!.z = 0;
  world.players[10]!.x = 10;
  world.players[10]!.z = 10;
  world.players[0]!.x = -10;

  assert.equal(callRun(world, 0, { x: 1, z: -1 }), true);
  assert.equal(world.runCall?.playerId, 8, 'left-cone input selects the LW');
  assert.equal(callRun(world, 0, { x: 1, z: 1 }), true);
  assert.equal(world.runCall?.playerId, 10, 'right-cone input selects the RW');
  assert.equal(callRun(world, 0, { x: 0, z: 0 }), true);
  assert.equal(world.runCall?.playerId, 9, 'neutral input prefers the most advanced forward');
  assert.equal(callRun(world, 0, { x: -1, z: 0 }), true);
  assert.notEqual(world.runCall?.playerId, 0, 'a stick aimed at the goalkeeper never selects him');
  assert.notEqual(world.runCall?.playerId, carrier.id, 'the carrier is never selected');
});

test('a called runner holds onside before the pass and advances to the full target after the strike', () => {
  const world = liveWorld();
  const carrier = world.players[6]!;
  const runner = world.players[9]!;
  const initialX = runner.x;
  assert.equal(callRun(world, 0, { x: 0, z: 0 }), true);
  assert.equal(world.runCall?.playerId, runner.id);
  assert.equal(world.runCall?.until, 3);
  assert.ok(world.runCall!.target.x > offsideLine(world, 0) - 0.5);

  for (let frame = 0; frame < 80; frame++) {
    stepWorld(world, STEP, new Map([[carrier.id, { move: { x: 0, z: 0 } }]]));
    assert.ok(runner.x <= offsideLine(world, 0) - 0.5 + 0.3);
  }
  assert.ok(runner.x > initialX, 'the runner advances toward the onside hold point');
  const heldProgress = offsideLine(world, 0) - 0.5;
  world.passTarget = world.players[8]!.id;
  stepWorld(world, STEP, new Map([[carrier.id, { move: { x: 0, z: 0 } }]]));
  assert.equal(world.runCall?.struck, true);
  for (let frame = 0; frame < 55; frame++) {
    stepWorld(world, STEP, new Map([[carrier.id, { move: { x: 0, z: 0 } }]]));
  }
  assert.ok(runner.x > heldProgress + 0.3, 'the runner is released beyond the pre-strike offside hold');
});

test('run calls clear on possession loss, restart, and simulation-time expiry', () => {
  const lost = liveWorld();
  assert.equal(callRun(lost, 0, { x: 0, z: 0 }), true);
  const opponent = lost.players[17]!;
  lost.carrierId = opponent.id;
  lost.ball.x = opponent.x;
  lost.ball.z = opponent.z;
  lost.lastTouch = 1;
  lost.lastToucherId = opponent.id;
  stepWorld(lost, STEP);
  assert.equal(possessionTeam(lost), 1);
  assert.equal(lost.runCall, null);

  const restarted = liveWorld();
  assert.equal(callRun(restarted, 0, { x: 0, z: 0 }), true);
  setRestart(restarted, 1, 'goal-kick', { x: 45, z: 0 });
  stepWorld(restarted, STEP);
  assert.equal(restarted.runCall, null);

  const expired = liveWorld();
  assert.equal(callRun(expired, 0, { x: 0, z: 0 }), true);
  expired.runCall!.until = STEP;
  stepWorld(expired, STEP);
  assert.equal(expired.runCall, null);
});

test('CPU commands never create run calls', () => {
  const world = liveWorld();
  for (const player of world.players) {
    player.human = false;
    player.controlled = false;
  }
  world.controlled = [-1, -1];
  const commands = computeAI(world, 'normal', STEP, 0);
  assert.ok([...commands.values()].every((command) => !command.callRun));
  stepWorld(world, STEP, commands);
  assert.equal(world.runCall, undefined);
});

test('LT tap helper and packet action preserve skill versus jockey semantics', () => {
  assert.equal(LT_TAP_MS, 180);
  assert.equal(ltTapSkill(true, 100, 220), true);
  assert.equal(ltTapSkill(true, 100, 350), false);
  assert.equal(ltTapSkill(false, 100, 220), false);
  const skill = commandFromPacket(movePacket(1, 1, 0, { move: { x: 0, z: 0 }, action: 'skill', pressed: true }));
  assert.equal(skill.action, 'skill');
  const hold = commandFromPacket(movePacket(1, 2, 0, { move: { x: 0, z: 0 }, jockey: true }));
  assert.equal(hold.jockey, true);
  assert.equal(hold.action, null);
});

test('stick sprint uses post-curve magnitude and hysteresis thresholds', () => {
  assert.equal(stickSprint(0.96, false), false);
  assert.equal(stickSprint(0.97, false), true);
  assert.equal(stickSprint(0.9, true), true);
  assert.equal(stickSprint(0.84, true), false);
  assert.ok(stickVector(1000, 0, 100).magnitude >= 0.97);
});

test('phone shoulder labels, set-piece overrides, packet edges, and carried edges stay aligned', () => {
  assert.deepEqual(shoulderLabels(true), { lt: 'Protect', lb: 'Run', rb: 'Finesse', rt: 'Sprint' });
  assert.deepEqual(shoulderLabels(false), { lt: 'Jockey', lb: 'Switch', rb: 'Press', rt: 'Sprint' });
  const attacking = liveWorld();
  const attackKey = phoneViewKey(attacking, 0, 6);
  assert.match(attackKey, /Run/);
  assert.match(attackKey, /Protect/);
  const opponent = attacking.players[17]!;
  attacking.carrierId = opponent.id;
  attacking.ball.x = opponent.x;
  attacking.ball.z = opponent.z;
  attacking.lastTouch = 1;
  attacking.lastToucherId = opponent.id;
  const defenseKey = phoneViewKey(attacking, 0, 6);
  assert.match(defenseKey, /Switch/);
  assert.match(defenseKey, /Jockey/);

  const setPiece = liveWorld();
  setRestart(setPiece, 0, 'corner', { x: 48, z: 20 });
  const taker = setPiece.setPiece!.takerId;
  const overrides = setPieceLabels(setPiece, 0, taker)!;
  assert.equal(shoulderLabels(true, overrides).lb, overrides.lb);
  assert.match(phoneViewKey(setPiece, 0, taker), new RegExp(overrides.lb.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const packet = movePacket(1, 1, 0, { move: { x: 0.5, z: 0 }, callRun: true }, 1);
  assert.ok(packet.buttons & 32768);
  assert.deepEqual(parsePacket(packet), packet);
  assert.equal(commandFromPacket(packet).callRun, true);
  const accepted = acceptMovePacket(remoteSeat(), undefined, packet, false);
  assert.equal(accepted.command?.callRun, true);
  const staleEdge = acceptMovePacket(accepted.seat, accepted.command, { ...packet, seq: 2 }, false);
  assert.equal(staleEdge.command?.callRun, false);
  const { e: _edge, ...moveWithoutEdge } = packet;
  const noEdge = acceptMovePacket(accepted.seat, accepted.command, { ...moveWithoutEdge, seq: 3 }, false);
  assert.equal(noEdge.command?.callRun, false);
  assert.equal(neutralCommand().callRun, false);
  assert.equal(carryEdge({ callRun: true }, neutralCommand()).callRun, true);
});
