// The local side of a game: your own movement (stepped here at 20 Hz, so it never waits on anyone), mouse look,
// breaking and placing, combat clicks, the shop, the camera feel (bob, sprint FOV, hurt tilt), interpolated
// puppets for everyone else, and effects and sounds driven by the rules' events. Solo and the online host run the
// rules here too; a guest applies the host's events to a replica instead.
import { AIR, BLOCKS, TEAMS, breakTicks, isBed, bedTeam } from './blocks.ts';
import { HURT_TICKS, isCrit } from './combat.ts';
import {
  REACH_BLOCK,
  REACH_HIT,
  TPS,
  applyAction,
  eyeY,
  heldItem,
  lookDir,
  nearNpc,
  nextPhase,
  stepDrop,
  stepProj,
  tickGame,
  type Action,
  type Ev,
  type Game,
  type MsgKind,
  type Player,
} from './game.ts';
import { ITEM_DEFS, blockFor, isBlockItem, isBow, type Item, type Res } from './items.ts';
import { EYE, EYE_SNEAK, HEIGHT, TICK, WIDTH, bodyOverlapsCell, stepBody, type MoveInput } from './physics.ts';
import { canBreak, raycast, rayBox, type RayHit } from './world.ts';
import { Track, type Pose } from './interp.ts';
import type { KeyState } from '../../kit';
import type { Puppet, View } from './scene.ts';
import { thinkBots } from './bots.ts';
import * as snd from './audio.ts';
import { damp } from './gl.ts';

export type Role = 'solo' | 'host' | 'guest';
export type UiPanel = 'none' | 'shop' | 'upgrades' | 'board';

export type ClientSettings = { sens: number; autoSprint: boolean; touch: boolean };

export type FeedLine = { id: number; k: MsgKind; text: string; at: number; team?: number };
export type Title = { id: number; title: string; sub: string; color: string; until: number };

export type HudSlot = { item: Item; n: number; team: number; tier: number } | null;
export type Hud = {
  hp: number;
  absorb: number;
  slots: HudSlot[];
  sel: number;
  wallet: Record<Res, number>;
  armor: number;
  team: number;
  teams: { id: number; bed: boolean; alive: number; out: boolean; used: boolean; me: boolean }[];
  phase: { label: string; secs: number } | null;
  clock: number;
  stats: { kills: number; finals: number; beds: number };
  dead: number;
  out: boolean;
  near: 'shop' | 'upgrades' | null;
  ui: UiPanel;
  fx: { speed: number; jump: number; invis: number; blind: number; regen: number };
  over: boolean;
  winner: number;
  locked: boolean;
};

/** Things the client hands to its host component: sounds are played here, everything else goes up. */
export type ClientHooks = {
  /** Guests send actions to the host. */
  send?: (act: Action, seq: number) => void;
  /** The host broadcasts the rules' events. */
  broadcast?: (evs: Ev[]) => void;
  /** Something the HUD should show right away. */
  ping?: () => void;
  /** A kill, bed or win worth a celebration (stats and cosmetics). */
  moment?: (ev: Ev) => void;
};

const scratch: Pose = { t: 0, x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };

type PuppetState = { track: Track; walk: number; amount: number; lx: number; lz: number; swings: number; swingT: number; hurtUntil: number; delay: number };

export class Client {
  readonly game: Game;
  readonly me: number;
  readonly role: Role;
  view: View | null = null;
  settings: ClientSettings;
  hooks: ClientHooks;
  time = 0;
  private acc = 0;
  // look and buttons
  private lookX = 0;
  private lookY = 0;
  private left = false;
  private right = false;
  private leftEdge = false;
  private rightEdge = false;
  private rightUp = false;
  ctrl = false;
  /** Touch: the stick (-1..1) and sticky crouch. */
  stick = { x: 0, y: 0 };
  touchSneak = false;
  touchJump = false;
  // camera
  private prev = { x: 0, y: 0, z: 0 };
  private fov = 70;
  private bobPhase = 0;
  private bobAmt = 0;
  private prevBob = 0;
  private hurtTilt = 0;
  private hurtDir = 0;
  private eyeH = EYE;
  // hand
  private swingT = -1;
  private equip = 0;
  private lastSel = 0;
  private lastHeldKey = '';
  // interaction
  dig: { x: number; y: number; z: number; ticks: number; need: number } | null = null;
  private digDelay = 0;
  private placeDelay = 0;
  private throwDelay = 0;
  /** Ticks right click has been held with something usable (bow, apple, potion). */
  private useTicks = 0;
  private useItemKey: Item | null = null;
  target: RayHit | null = null;
  private seq = 0;
  private wDown = false;
  private wLastTap = -1;
  private sprintLatch = false;
  // state shown in the HUD
  ui: UiPanel = 'none';
  feed: FeedLine[] = [];
  title: Title | null = null;
  locked = false;
  private feedId = 0;
  private puppets = new Map<number, PuppetState>();
  private stepDist = 0;
  /** Spectator camera (dead or out). */
  private spec = { x: 0, y: 0, z: 0, active: false };
  private lastDeadSecs = -1;
  /** Frame time tracking for adaptive resolution. */
  private frameAvg = 1 / 60;
  private dpr = 1;
  private dprCooldown = 0;
  maxDpr = 2;

  constructor(game: Game, me: number, role: Role, settings: ClientSettings, hooks: ClientHooks = {}) {
    this.game = game;
    this.me = me;
    this.role = role;
    this.settings = settings;
    this.hooks = hooks;
    const p = this.player;
    this.prev = { x: p.body.x, y: p.body.y, z: p.body.z };
    this.dpr = Math.min(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1, 2);
  }

  get player(): Player {
    return this.game.players[this.me];
  }
  get authority() {
    return this.role !== 'guest';
  }

  attach(view: View) {
    this.view = view;
    view.setPixelRatio(this.dpr);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // input from the host component

  look(dx: number, dy: number) {
    // clamp the odd spike some browsers send right after locking
    if (Math.abs(dx) > 400 || Math.abs(dy) > 400) return;
    this.lookX += dx;
    this.lookY += dy;
  }
  button(which: 'left' | 'right', down: boolean) {
    if (which === 'left') {
      if (down && !this.left) this.leftEdge = true;
      this.left = down;
    } else {
      if (down && !this.right) this.rightEdge = true;
      if (!down && this.right) this.rightUp = true;
      this.right = down;
    }
  }
  /** One tap of the attack button on touch: a swing now. */
  tapAttack() {
    this.leftEdge = true;
  }
  wheel(dir: number) {
    const p = this.player;
    this.select((p.sel + (dir > 0 ? 1 : 8)) % 9);
  }
  select(slot: number) {
    const p = this.player;
    if (slot === p.sel || slot < 0 || slot > 8) return;
    p.sel = slot;
    this.useTicks = 0;
    this.act({ a: 'sel', slot });
    this.hooks.ping?.();
  }
  releaseAll() {
    this.left = this.right = false;
    this.leftEdge = this.rightEdge = false;
    if (this.useTicks > 0) this.rightUp = true;
    this.stick.x = this.stick.y = 0;
    this.touchJump = false;
  }

  /** Sends or applies an action. Guests apply what they can right away and let the host confirm. */
  act(a: Action): boolean {
    const g = this.game;
    const p = this.player;
    if (this.authority) return applyAction(g, p, a, false);
    const seq = ++this.seq;
    if (a.a === 'place' || a.a === 'break') a.seq = seq;
    this.hooks.send?.(a, seq);
    return true;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // the frame

  update(dt: number, keys: KeyState) {
    this.time += dt;
    this.trackFrameTime(dt);
    const p = this.player;
    // mouse look happens every frame, straight onto the body
    const sens = (0.15 * Math.PI) / 180 * this.settings.sens;
    if (this.lookX || this.lookY) {
      const b = p.body;
      b.yaw -= this.lookX * sens;
      b.pitch = Math.max(-1.5697, Math.min(1.5697, b.pitch - this.lookY * sens));
      this.lookX = this.lookY = 0;
    }
    if (this.spec.active) this.flySpectator(dt, keys);
    this.handleKeys(keys);
    if (this.leftEdge) this.clickAttack();
    this.acc += dt;
    let n = 0;
    while (this.acc >= TICK && n < 4) {
      this.acc -= TICK;
      this.tick(keys);
      n++;
    }
    if (n === 4) this.acc = 0;
    this.leftEdge = false;
    this.renderFrame(dt);
  }

  /** Advances time and draws without running the game (the start card's orbit). */
  preview(dt: number) {
    this.time += dt;
    const b = this.player.body;
    this.prev.x = b.x;
    this.prev.y = b.y;
    this.prev.z = b.z;
    this.renderFrame(dt);
  }

  private handleKeys(keys: KeyState) {
    for (let i = 0; i < 9; i++) if (keys.pressed(`Digit${i + 1}`)) this.select(i);
    if (this.ui !== 'none') return;
    if (keys.pressed('KeyQ')) {
      const p = this.player;
      if (p.inv.slots[p.sel]) this.act({ a: 'drop', slot: p.sel, all: false });
    }
  }

  /** Opens the shop or upgrades when near the right NPC (E or B, or a right click on it). */
  openNear(): boolean {
    const p = this.player;
    if (!p.alive) return false;
    const g = this.game;
    if (nearNpc(g, p, 'shop')) {
      this.setUi('shop');
      return true;
    }
    if (nearNpc(g, p, 'upgrades')) {
      this.setUi('upgrades');
      return true;
    }
    return false;
  }

  setUi(ui: UiPanel) {
    this.ui = ui;
    if (ui !== 'none') this.releaseAll();
    this.hooks.ping?.();
  }

  /** Which NPC is in reach, if any. */
  nearWhich(): 'shop' | 'upgrades' | null {
    const p = this.player;
    if (!p.alive) return null;
    return nearNpc(this.game, p, 'shop') ? 'shop' : nearNpc(this.game, p, 'upgrades') ? 'upgrades' : null;
  }

  private moveInput(keys: KeyState): MoveInput {
    if (this.ui !== 'none' || !this.player.alive) return { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false };
    let forward = (keys.down('KeyW', 'ArrowUp') ? 1 : 0) - (keys.down('KeyS', 'ArrowDown') ? 1 : 0);
    let strafe = (keys.down('KeyD', 'ArrowRight') ? 1 : 0) - (keys.down('KeyA', 'ArrowLeft') ? 1 : 0);
    const stick = Math.hypot(this.stick.x, this.stick.y);
    if (stick > 0.12) {
      forward = -this.stick.y;
      strafe = this.stick.x;
      if (stick > 1) {
        forward /= stick;
        strafe /= stick;
      }
    }
    const sneak = keys.down('ShiftLeft', 'ShiftRight') || this.touchSneak;
    // sprint: always on (the default, like a toggle-sprint mod), or double tap W, or hold Ctrl
    const w = keys.down('KeyW', 'ArrowUp');
    if (w && !this.wDown) {
      if (this.time - this.wLastTap < 0.3) this.sprintLatch = true;
      this.wLastTap = this.time;
    }
    this.wDown = w;
    if (forward <= 0) this.sprintLatch = false;
    const sprint = this.settings.autoSprint || this.settings.touch || this.ctrl || this.sprintLatch;
    return { forward, strafe, jump: keys.down('Space') || this.touchJump, sneak, sprint: sprint && forward > 0.8 };
  }

  private tick(keys: KeyState) {
    const g = this.game;
    const p = this.player;
    const b = p.body;
    this.prev.x = b.x;
    this.prev.y = b.y;
    this.prev.z = b.z;
    this.prevBob = this.bobPhase;
    if (p.alive && !g.over) {
      const inp = this.moveInput(keys);
      const fx = p.fx;
      stepBody(g.world, b, inp, { speed: fx.speed > 0 ? fx.speedLvl : 0, jump: fx.jump > 0 ? fx.jumpLvl : 0, slow: (fx.slow > 0 ? 2 : 0) + (this.useTicks > 0 ? 4 : 0) });
      p.input = inp;
      if (!this.authority && b.landed > 0) {
        this.act({ a: 'fall', d: b.landed });
        b.landed = 0;
      }
      // view bob and footsteps
      const moved = Math.hypot(b.x - this.prev.x, b.z - this.prev.z);
      this.bobPhase += moved * 0.6;
      this.bobAmt += ((b.onGround ? Math.min(0.1, moved) : 0) - this.bobAmt) * 0.4;
      if (b.onGround && !b.sneaking) {
        this.stepDist += moved;
        if (this.stepDist > 1.7) {
          this.stepDist = 0;
          const under = g.world.get(b.x, b.y - 0.2, b.z);
          if (under !== AIR) snd.blockSound(BLOCKS[under].sound, 'step', 0.8);
        }
      }
      this.interact();
    } else {
      this.dig = null;
      this.useTicks = 0;
    }
    // walking away from the keeper closes the shop, like Hypixel
    if ((this.ui === 'shop' || this.ui === 'upgrades') && (!p.alive || !nearNpc(g, p, this.ui, 1.5))) this.setUi('none');
    if (this.hurtTilt > 0) this.hurtTilt--;
    if (this.throwDelay > 0) this.throwDelay--;

    if (this.authority) {
      thinkBots(g);
      tickGame(g);
    } else this.replicaTick();
    const evs = g.events.splice(0);
    if (evs.length) {
      for (const e of evs) this.onEvent(e);
      if (this.role === 'host') this.hooks.broadcast?.(evs);
    }
    // samples for the puppets
    for (const o of g.players) {
      if (o.id === this.me) continue;
      let ps = this.puppets.get(o.id);
      if (!ps) {
        ps = { track: new Track(), walk: 0, amount: 0, lx: o.body.x, lz: o.body.z, swings: o.swings, swingT: -1, hurtUntil: 0, delay: o.ctrl === 'bot' && this.authority ? 0.06 : 0.1 };
        this.puppets.set(o.id, ps);
      }
      ps.track.push(this.time, o.body.x, o.body.y, o.body.z, o.body.yaw, o.body.pitch);
      if (o.swings !== ps.swings) {
        ps.swings = o.swings;
        ps.swingT = 0;
      }
    }
    // the death camera and respawn countdown
    if (!p.alive) {
      if (!this.spec.active) {
        this.spec = { x: p.diedAt[0], y: p.diedAt[1] + 6, z: p.diedAt[2] + 4, active: true };
      }
      if (!p.out) {
        const secs = Math.ceil(p.respawn / TPS);
        if (secs !== this.lastDeadSecs && secs > 0) {
          this.lastDeadSecs = secs;
          this.showTitle('YOU DIED!', `you will respawn in ${secs} ${secs === 1 ? 'second' : 'seconds'}!`, '#ff5b5b', 1.2);
          snd.tickSound(1.2);
        }
      }
    } else if (this.spec.active) this.spec.active = false;
  }

  /** Guests move drops and projectiles between the host's word on them. */
  private replicaTick() {
    const g = this.game;
    g.tick++;
    for (const d of g.drops) stepDrop(g.world, d);
    for (const pr of g.projs) if (pr.kind === 'tnt' || pr.age < 400) stepProj(g, pr);
  }

  private eye() {
    const p = this.player;
    return { x: p.body.x, y: eyeY(p), z: p.body.z };
  }

  /** The player under the crosshair within reach, using what we see (interpolated puppets). */
  private aimedPlayer(reach: number): { id: number; dist: number } | null {
    const p = this.player;
    const e = this.eye();
    const [dx, dy, dz] = lookDir(p.body.yaw, p.body.pitch);
    let best: { id: number; dist: number } | null = null;
    for (const o of this.game.players) {
      if (o.id === this.me || !o.alive) continue;
      const ps = this.puppets.get(o.id);
      if (!ps || !ps.track.sample(this.time - ps.delay, scratch)) continue;
      const pad = 0.1;
      const hit = rayBox(e.x, e.y, e.z, dx, dy, dz, scratch.x - WIDTH / 2 - pad, scratch.y - pad, scratch.z - WIDTH / 2 - pad, scratch.x + WIDTH / 2 + pad, scratch.y + HEIGHT + pad, scratch.z + WIDTH / 2 + pad);
      if (hit && hit.t <= reach && (!best || hit.t < best.dist)) best = { id: o.id, dist: hit.t };
    }
    return best;
  }

  /** A left click: swing, and hit whoever is under the crosshair. */
  private clickAttack() {
    const p = this.player;
    if (!p.alive || this.ui !== 'none') return;
    this.swing();
    const block = this.target;
    const aim = this.aimedPlayer(REACH_HIT);
    if (aim && (!block || aim.dist < block.dist)) {
      const v = this.game.players[aim.id];
      if (v.team !== p.team) {
        const crit = isCrit(p.body);
        this.act({ a: 'hit', target: aim.id, crit });
        // the client side of a sprint hit: the attacker slows and stops sprinting
        if (p.body.sprinting) {
          p.body.vx *= 0.6;
          p.body.vz *= 0.6;
          p.body.sprinting = false;
        }
        if (!this.authority) {
          snd.hitSound(crit);
          if (crit) this.view?.burst('crit', v.body.x, v.body.y, v.body.z);
        }
      }
      this.dig = null;
    } else snd.swingSound();
  }

  swing() {
    if (this.swingT < 0 || this.swingT > 0.5) this.swingT = 0;
    if (!this.authority) return;
    this.player.swings++;
  }

  /** Breaking, placing and using items, once a tick. */
  private interact() {
    const g = this.game;
    const p = this.player;
    const b = p.body;
    const e = this.eye();
    const [dx, dy, dz] = lookDir(b.yaw, b.pitch);
    this.target = this.ui === 'none' ? raycast(g.world, e.x, e.y, e.z, dx, dy, dz, REACH_BLOCK) : null;
    const t = this.target;
    const held = heldItem(p);
    if (this.digDelay > 0) this.digDelay--;
    if (this.placeDelay > 0) this.placeDelay--;

    // mining: hold left on a breakable block
    if (this.left && t && this.ui === 'none' && canBreak(g.world, t.x, t.y, t.z) && !this.aimedPlayer(Math.min(REACH_HIT, t.dist))) {
      if (!this.dig || this.dig.x !== t.x || this.dig.y !== t.y || this.dig.z !== t.z) {
        const kind = held === 'pick' ? 'pick' : held === 'axe' ? 'axe' : held === 'shears' ? 'shears' : held && ITEM_DEFS[held].kind === 'sword' ? 'sword' : 'none';
        const haste = g.teams[p.team].ups.haste;
        let need = breakTicks(t.id, kind, { pick: p.inv.pick, axe: p.inv.axe, shears: p.inv.shears }, haste, b.onGround);
        if (p.fx.fatigue > 0) need *= 3.3;
        this.dig = { x: t.x, y: t.y, z: t.z, ticks: 0, need };
      }
      if (this.digDelay === 0) {
        this.dig.ticks++;
        if (this.dig.ticks % 4 === 1) {
          this.swing();
          snd.blockSound(BLOCKS[t.id].sound, 'dig', 0.7);
          this.view?.burst('block', t.x, t.y, t.z, { block: t.id, count: 2 });
        }
        if (this.dig.ticks >= this.dig.need) this.finishDig(t);
      }
    } else this.dig = null;

    // right click
    const usable = held && (isBow(held) || held === 'gapple' || held === 'speed' || held === 'jump' || held === 'invis');
    if (this.right && this.ui === 'none') {
      if (this.rightEdge) {
        // talk to a shop keeper first
        if (this.npcInSight()) {
          this.rightEdge = false;
          this.openNear();
          return;
        }
      }
      if (usable) {
        if (isBow(held!) && !p.inv.slots.some((s) => s?.item === 'arrow')) {
          if (this.rightEdge) this.notice("you don't have any arrows!");
        } else {
          if (this.useItemKey !== held) this.useTicks = 0;
          this.useItemKey = held;
          this.useTicks++;
          if (held === 'gapple' && this.useTicks % 4 === 0) snd.eatSound();
          if ((held === 'speed' || held === 'jump' || held === 'invis') && this.useTicks % 5 === 0) snd.drinkSound();
          if (!isBow(held!) && this.useTicks >= 32) {
            this.act({ a: 'use', slot: p.sel, yaw: b.yaw, pitch: b.pitch });
            this.useTicks = 0;
            this.right = false;
          }
        }
      } else if (held === 'fireball' || held === 'pearl' || held === 'egg') {
        if (this.rightEdge && this.throwDelay === 0) {
          this.throwDelay = held === 'fireball' ? 10 : 6;
          this.swing();
          this.act({ a: 'use', slot: p.sel, yaw: b.yaw, pitch: b.pitch });
          if (held === 'fireball') snd.fireballSound();
          else snd.bowSound(0.5);
        }
      } else if (held && (isBlockItem(held) || held === 'tnt') && t) {
        if (this.rightEdge || this.placeDelay === 0) {
          this.placeDelay = 4;
          this.tryPlace(t, held);
        }
      }
    } else if (this.rightUp || !this.right) {
      if (this.useTicks > 0 && held && isBow(held)) {
        if (this.useTicks >= 3) {
          this.act({ a: 'shoot', charge: this.useTicks, yaw: b.yaw, pitch: b.pitch });
          snd.bowSound();
        }
      }
      this.useTicks = 0;
      this.useItemKey = null;
    }
    this.rightEdge = false;
    this.rightUp = false;
    p.using = this.useTicks;
    p.drawing = held && isBow(held) ? this.useTicks : 0;
  }

  private npcInSight(): boolean {
    const near = this.nearWhich();
    if (!near) return false;
    const p = this.player;
    const g = this.game;
    const e = this.eye();
    const [dx, dy, dz] = lookDir(p.body.yaw, p.body.pitch);
    for (const site of g.info.teams) {
      for (const at of [site.shop, site.upgrades]) {
        const hit = rayBox(e.x, e.y, e.z, dx, dy, dz, at[0] - 0.5, at[1], at[2] - 0.5, at[0] + 0.5, at[1] + 2, at[2] + 0.5);
        if (hit && hit.t < 5) return true;
      }
    }
    return false;
  }

  private finishDig(t: RayHit) {
    const g = this.game;
    const id = g.world.get(t.x, t.y, t.z);
    this.dig = null;
    this.digDelay = 5;
    if (isBed(id) && bedTeam(id) === this.player.team) {
      this.notice("you can't break your own bed!");
      return;
    }
    if (!this.authority) {
      // break it here now; the host confirms or puts it back
      g.world.set(t.x, t.y, t.z, AIR);
      snd.blockSound(BLOCKS[id].sound, 'break');
      this.view?.burst('block', t.x, t.y, t.z, { block: id });
    }
    this.act({ a: 'break', x: t.x, y: t.y, z: t.z, seq: 0 });
  }

  private tryPlace(t: RayHit, held: Item) {
    const g = this.game;
    const p = this.player;
    const [nx, ny, nz] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]][t.face] ?? [0, 1, 0];
    let x = t.x + nx;
    let y = t.y + ny;
    let z = t.z + nz;
    // clicking a tuft of grass replaces it
    const here = g.world.get(t.x, t.y, t.z);
    if (BLOCKS[here].shape === 'cross') {
      x = t.x;
      y = t.y;
      z = t.z;
    }
    if (held !== 'tnt' && bodyOverlapsCell(p.body.x, p.body.y, p.body.z, x, y, z)) return;
    const block = held === 'tnt' ? 1 : blockFor(held, p.team);
    if (!this.authority) {
      if (held === 'tnt') {
        this.act({ a: 'place', x, y, z, slot: p.sel, face: t.face, seq: 0 });
        this.swing();
        return;
      }
      // put it down now; the host confirms or takes it back
      const placeId = this.ladderId(block, t.face);
      if (placeId < 0 || g.world.get(x, y, z) !== AIR) return;
      g.world.set(x, y, z, placeId, true);
      const s = p.inv.slots[p.sel];
      if (s) {
        s.n--;
        if (s.n <= 0) p.inv.slots[p.sel] = null;
      }
      snd.blockSound(BLOCKS[placeId].sound, 'place');
      this.act({ a: 'place', x, y, z, slot: p.sel, face: t.face, seq: 0 });
      this.swing();
      return;
    }
    if (this.act({ a: 'place', x, y, z, slot: p.sel, face: t.face, seq: 0 })) this.swing();
    else if (held !== 'tnt') {
      for (const b of g.info.noBuild)
        if (x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1 && z >= b.z0 && z < b.z1) {
          this.notice("you can't place blocks here!");
          break;
        }
    }
  }

  private ladderId(block: number, face: number) {
    if (block < 72 || block > 75) return block;
    const dir = face === 0 ? 1 : face === 1 ? 0 : face === 4 ? 3 : face === 5 ? 2 : -1;
    return dir < 0 ? -1 : 72 + dir;
  }

  notice(text: string) {
    this.pushFeed('deny', text);
    snd.denySound();
  }

  showTitle(title: string, sub: string, color: string, secs: number) {
    this.title = { id: (this.title?.id ?? 0) + 1, title, sub, color, until: this.time + secs };
    this.hooks.ping?.();
  }

  private pushFeed(k: FeedLine['k'], text: string, team?: number) {
    this.feed.push({ id: ++this.feedId, k, text, at: this.time, team });
    if (this.feed.length > 8) this.feed.shift();
    this.hooks.ping?.();
  }

  // ---------------------------------------------------------------------------------------------------------------
  // events: sounds, particles, titles, the feed

  onEvent(e: Ev) {
    const g = this.game;
    const v = this.view;
    const me = this.me;
    const p = this.player;
    switch (e.t) {
      case 'block': {
        const vol = snd.near(e.x, e.y, e.z);
        if (e.id === AIR) {
          // our own breaks already made their noise
          if (e.by !== me || this.authority) {
            const was = e.was;
            if (was !== AIR) {
              snd.blockSound(BLOCKS[was].sound, 'break', vol);
              v?.burst('block', e.x, e.y, e.z, { block: was });
            }
          }
        } else if (e.by !== me || this.authority) snd.blockSound(BLOCKS[e.id].sound, 'place', vol);
        break;
      }
      case 'hurt': {
        const ps = this.puppets.get(e.p);
        if (e.by >= -1 && e.cause !== 'magic') {
          if (ps) ps.hurtUntil = this.time + 0.45;
          const o = g.players[e.p];
          if (e.p === me) {
            snd.hurtSound();
            this.hurtTilt = 10;
            const a = e.by >= 0 ? g.players[e.by] : null;
            this.hurtDir = a ? Math.atan2(a.body.z - o.body.z, a.body.x - o.body.x) * (180 / Math.PI) - (o.body.yaw * 180) / Math.PI : 0;
            this.hooks.ping?.();
          } else if (e.by === me) {
            if (this.authority) snd.hitSound(e.crit);
            if (e.cause === 'arrow') snd.dingSound();
            if (e.crit) v?.burst('crit', o.body.x, o.body.y, o.body.z);
          } else {
            const vol = snd.near(o.body.x, o.body.y, o.body.z, 20);
            if (vol > 0.05) snd.hitSound(false, vol * 0.6);
          }
          v?.burst('hit', o.body.x, o.body.y, o.body.z);
        }
        if (e.p === me) this.hooks.ping?.();
        break;
      }
      case 'kb':
        // the host already pushed bodies it owns; a guest pushes its own
        break;
      case 'die': {
        const o = g.players[e.p];
        v?.burst('kill', o.body.x, o.body.y, o.body.z, { color: parseInt(TEAMS[o.team].color.slice(1), 16) });
        if (e.p === me) {
          snd.deathSound();
          this.dig = null;
          this.setUi('none');
          this.lastDeadSecs = -1;
          if (e.final) this.showTitle('YOU DIED!', 'you are now a spectator!', '#ff5b5b', 4);
        } else if (e.by === me) {
          snd.killSound(e.final);
          this.hooks.moment?.(e);
        }
        this.hooks.ping?.();
        break;
      }
      case 'spawn':
        if (e.p === me) {
          this.prev = { x: e.x, y: e.y, z: e.z };
          this.spec.active = false;
          this.showTitle('RESPAWNED!', '', '#55ff55', 1.4);
          snd.teleportSound();
        } else this.puppets.get(e.p)?.track.snap(this.time, e.x, e.y, e.z, e.yaw, 0);
        this.hooks.ping?.();
        break;
      case 'tp':
        if (e.p === me) {
          this.prev = { x: e.x, y: e.y, z: e.z };
          snd.teleportSound();
        } else this.puppets.get(e.p)?.track.snap(this.time, e.x, e.y, e.z, g.players[e.p].body.yaw, 0);
        break;
      case 'bed': {
        const site = g.info.teams[e.team];
        v?.burst('bed', site.bedFoot[0], site.bedFoot[1], site.bedFoot[2], { color: parseInt(TEAMS[e.team].color.slice(1), 16) });
        snd.bedSound(e.team === p.team);
        if (e.team === p.team) this.showTitle('BED DESTROYED!', 'you will no longer respawn!', '#ff5b5b', 3.5);
        if (e.by === me) this.hooks.moment?.(e);
        this.hooks.ping?.();
        break;
      }
      case 'elim':
        this.hooks.ping?.();
        break;
      case 'pick':
        if (e.p === me && e.n > 0) snd.pickupSound(e.item);
        break;
      case 'proj':
        if (e.owner !== me) {
          const vol = snd.near(e.x, e.y, e.z, 30);
          if (e.kind === 'arrow') snd.bowSound(vol * 0.7);
          else if (e.kind === 'fireball' && vol > 0.05) snd.fireballSound();
        }
        break;
      case 'pgone':
        break;
      case 'boom':
        v?.burst('boom', e.x, e.y, e.z);
        snd.boomSound(snd.near(e.x, e.y, e.z, 48));
        break;
      case 'upg':
        if (e.team === p.team) snd.upgradeSound();
        this.hooks.ping?.();
        break;
      case 'trap':
        if (e.team === p.team) {
          snd.trapSound();
          this.showTitle('TRAP TRIGGERED!', 'someone is in your base!', '#ff5b5b', 2.5);
        }
        break;
      case 'tier':
        snd.tierSound();
        break;
      case 'msg':
        if (e.to !== undefined && e.to !== me) break;
        if (e.k === 'buy' && e.to === me) snd.buySound();
        if (e.k === 'deny' && e.to === me) snd.denySound();
        if (e.k === 'buy' && e.team !== undefined && e.team !== p.team) break;
        if (e.k === 'trap' && e.team !== p.team) break;
        this.pushFeed(e.k, e.text, e.team);
        break;
      case 'win':
        this.hooks.moment?.(e);
        this.hooks.ping?.();
        break;
      case 'fx':
      case 'inv':
        if (e.p === me) this.hooks.ping?.();
        break;
      case 'use':
        if (e.p === me && e.item === 'gapple') snd.eatSound();
        break;
      case 'phase':
      case 'traps':
      case 'swing':
      case 'drop':
      case 'dropn':
      case 'ack':
        break;
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // rendering

  private trackFrameTime(dt: number) {
    if (dt <= 0) return;
    this.frameAvg += (dt - this.frameAvg) * 0.05;
    if (this.dprCooldown > 0) {
      this.dprCooldown -= dt;
      return;
    }
    // adaptive resolution: drop when frames run long, climb back when there is room
    if (this.frameAvg > 1 / 50 && this.dpr > 0.6) {
      this.dpr = Math.max(0.6, this.dpr - 0.15);
      this.view?.setPixelRatio(this.dpr);
      this.dprCooldown = 1.5;
    } else if (this.frameAvg < 1 / 58 && this.dpr < this.maxDpr) {
      this.dpr = Math.min(this.maxDpr, this.dpr + 0.1);
      this.view?.setPixelRatio(this.dpr);
      this.dprCooldown = 4;
    }
  }

  get pixelRatio() {
    return this.dpr;
  }
  get frameMs() {
    return this.frameAvg * 1000;
  }

  private flySpectator(dt: number, keys: KeyState) {
    const p = this.player;
    const s = this.spec;
    const sp = 12 * dt;
    const f = (keys.down('KeyW') ? 1 : 0) - (keys.down('KeyS') ? 1 : 0) - this.stick.y;
    const r = (keys.down('KeyD') ? 1 : 0) - (keys.down('KeyA') ? 1 : 0) + this.stick.x;
    const u = (keys.down('Space') || this.touchJump ? 1 : 0) - (keys.down('ShiftLeft', 'ShiftRight') || this.touchSneak ? 1 : 0);
    const yaw = p.body.yaw;
    s.x += (-Math.sin(yaw) * f + Math.cos(yaw) * r) * sp;
    s.z += (-Math.cos(yaw) * f - Math.sin(yaw) * r) * sp;
    s.y = Math.max(2, Math.min(90, s.y + u * sp));
    s.x = Math.max(-20, Math.min(196, s.x));
    s.z = Math.max(-20, Math.min(196, s.z));
  }

  private renderFrame(dt: number) {
    const v = this.view;
    if (!v) return;
    const g = this.game;
    const p = this.player;
    const b = p.body;
    const a = Math.min(1, this.acc / TICK);
    // camera at the interpolated eye
    this.eyeH = damp(this.eyeH, b.sneaking ? EYE_SNEAK : EYE, 18, dt);
    let cx = this.prev.x + (b.x - this.prev.x) * a;
    let cy = this.prev.y + (b.y - this.prev.y) * a + this.eyeH;
    let cz = this.prev.z + (b.z - this.prev.z) * a;
    let roll = 0;
    let pitch = b.pitch;
    const yaw = b.yaw;
    const bob = this.prevBob + (this.bobPhase - this.prevBob) * a;
    if (this.spec.active) {
      cx = this.spec.x;
      cy = this.spec.y;
      cz = this.spec.z;
    } else {
      // Minecraft's view bob: a little side to side, a little up and down, a touch of roll
      const amt = this.bobAmt;
      const sx = Math.sin(bob * Math.PI) * amt * 0.5;
      const sy = -Math.abs(Math.cos(bob * Math.PI) * amt);
      cx += Math.cos(yaw) * sx;
      cz -= Math.sin(yaw) * sx;
      cy += sy;
      roll += Math.sin(bob * Math.PI) * amt * 0.05;
      pitch += Math.abs(Math.cos(bob * Math.PI - 0.2) * amt) * 0.08;
      if (this.hurtTilt > 0) {
        const h = (this.hurtTilt - a) / 10;
        roll += -Math.sin(h * h * h * h * Math.PI) * 0.24 * Math.sign(Math.sin((this.hurtDir * Math.PI) / 180) || 1);
      }
    }
    // FOV: wider when sprinting or sped up, narrower when drawing a bow
    let fovT = 70;
    if (b.sprinting) fovT *= 1.15;
    if (p.fx.speed > 0) fovT *= 1 + 0.1 * p.fx.speedLvl;
    if (this.useTicks > 0 && heldItem(p) && isBow(heldItem(p)!)) fovT *= 1 - Math.min(1, this.useTicks / 20) * 0.15;
    this.fov = damp(this.fov, fovT, 10, dt);
    snd.setListener(cx, cy, cz);

    // the hand: lower it briefly when switching items
    const held = heldItem(p);
    const tier = held === 'pick' ? p.inv.pick : held === 'axe' ? p.inv.axe : 0;
    const key = `${held}:${tier}`;
    if (p.sel !== this.lastSel || key !== this.lastHeldKey) {
      if (p.sel !== this.lastSel) this.equip = 1;
      this.lastSel = p.sel;
      this.lastHeldKey = key;
    }
    this.equip = Math.max(0, this.equip - dt * 6);
    if (this.swingT >= 0) {
      this.swingT += dt / 0.3;
      if (this.swingT >= 1) this.swingT = -1;
    }

    // puppets
    const puppets: Puppet[] = [];
    for (const o of g.players) {
      if (o.id === this.me) continue;
      const ps = this.puppets.get(o.id);
      if (!ps || !o.alive || !ps.track.sample(this.time - ps.delay, scratch)) continue;
      const moved = Math.hypot(scratch.x - ps.lx, scratch.z - ps.lz);
      ps.lx = scratch.x;
      ps.lz = scratch.z;
      const speed = dt > 0 ? moved / dt : 0;
      ps.amount = damp(ps.amount, Math.min(1, speed / 4.3), 12, dt);
      ps.walk += ps.amount * dt * 20 * 0.95;
      if (ps.swingT >= 0) {
        ps.swingT += dt / 0.3;
        if (ps.swingT >= 1) ps.swingT = -1;
      }
      puppets.push({
        id: o.id,
        visible: true,
        x: scratch.x,
        y: scratch.y,
        z: scratch.z,
        yaw: scratch.yaw,
        head: scratch.yaw,
        pitch: scratch.pitch,
        walk: ps.walk,
        amount: ps.amount,
        swing: ps.swingT,
        sneak: o.body.sneaking,
        hurt: ps.hurtUntil > this.time ? 1 : 0,
        invisible: o.fx.invis > 0,
        draw: o.drawing > 0 ? Math.min(1, o.drawing / 20) : 0,
        held: { item: o.show.item, team: o.team, tier: o.show.tier },
        armor: o.inv.armor,
        team: o.team,
        name: o.name,
        hp: o.hp,
        skin: o.skin,
      });
    }

    const crack = this.dig && this.dig.need > 0 && isFinite(this.dig.need) ? { x: this.dig.x, y: this.dig.y, z: this.dig.z, stage: Math.floor((this.dig.ticks / this.dig.need) * 10) } : null;
    const genIn = g.gens.map((gen) => gen.timer / TPS);
    v.frame({
      game: g,
      cam: { x: cx, y: cy, z: cz, yaw, pitch, roll, fov: this.fov },
      puppets,
      target: this.target && p.alive && this.ui === 'none' ? this.target : null,
      crack,
      hand: {
        held: { item: held, team: p.team, tier },
        swing: this.swingT,
        equip: this.equip,
        draw: held && isBow(held) ? Math.min(1, this.useTicks / 20) : 0,
        eat: held && !isBow(held) && this.useTicks > 0 ? this.useTicks / 32 : 0,
        bob,
        bobAmt: this.bobAmt * 10,
        visible: p.alive && !this.spec.active,
        skin: p.skin,
        team: p.team,
      },
      time: this.time,
      genIn,
      dt,
    });
  }

  render() {
    this.view?.render();
  }

  // ---------------------------------------------------------------------------------------------------------------
  // the HUD's view of things

  hud(): Hud {
    const g = this.game;
    const p = this.player;
    const ph = nextPhase(g);
    return {
      hp: p.hp,
      absorb: p.absorb,
      slots: p.inv.slots.slice(0, 9).map((s) => (s ? { item: s.item, n: s.n, team: p.team, tier: s.item === 'pick' ? p.inv.pick : s.item === 'axe' ? p.inv.axe : 0 } : null)),
      sel: p.sel,
      wallet: { ...p.inv.wallet },
      armor: p.inv.armor,
      team: p.team,
      teams: g.teams.map((t) => ({
        id: t.id,
        bed: t.bed,
        alive: g.players.filter((o) => o.team === t.id && !o.out && (o.alive || o.respawn > 0)).length,
        out: t.out,
        used: t.used,
        me: t.id === p.team,
      })),
      phase: ph ? { label: ph.label, secs: Math.ceil(ph.ticks / TPS) } : null,
      clock: Math.floor(g.tick / TPS),
      stats: { kills: p.stats.kills, finals: p.stats.finals, beds: p.stats.beds },
      dead: p.alive ? 0 : Math.ceil(p.respawn / TPS),
      out: p.out,
      near: this.nearWhich(),
      ui: this.ui,
      fx: { speed: p.fx.speed, jump: p.fx.jump, invis: p.fx.invis, blind: p.fx.blind, regen: p.fx.regen },
      over: g.over,
      winner: g.winner,
      locked: this.locked,
    };
  }

  /** How far the hurt flash has to go (0..1), for the red vignette. */
  get hurtFlash() {
    return this.hurtTilt / 10;
  }

  dispose() {
    this.view?.dispose();
    this.view = null;
  }
}

export { HURT_TICKS, REACH_BLOCK };
