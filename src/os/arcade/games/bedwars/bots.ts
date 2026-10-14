// Bots that play like people: they collect at their forge, shop, wrap their bed in wool and end stone, bridge out to
// diamonds, mid and enemy islands, mine through bed defenses, and fight with turn-rate limited, wobbly aim, a
// reaction delay and a click rate, so they miss and get knocked off bridges too. They only chase who they can see.
// Pure, so it runs under node.
import { AIR, BLOCKS, SX, SZ, breakTicks, isBed } from './blocks.ts';
import { isCrit } from './combat.ts';
import { REACH_HIT, TPS, applyAction, eyeY, heldItem, lookDir, nearNpc, placeAllowed, type Game, type Player } from './game.ts';
import { ITEM_DEFS, OFFERS, blockFor, buy as dryBuy, priceOf, type Inventory, type Item } from './items.ts';
import { BUILD_MAX, inBox } from './map.ts';
import { HEIGHT, WIDTH, bodyOverlapsCell } from './physics.ts';
import { canBreak, clearLine, rayBox, raycast } from './world.ts';

export type Skill = { reaction: number; turn: number; noise: number; cps: number; bridge: number; rushAt: number; bow: boolean; smart: boolean };
export const SKILLS: Record<'easy' | 'normal' | 'hard', Skill> = {
  easy: { reaction: 14, turn: 9, noise: 7, cps: 5, bridge: 10, rushAt: 240, bow: false, smart: false },
  normal: { reaction: 8, turn: 16, noise: 3.8, cps: 8, bridge: 7, rushAt: 120, bow: true, smart: false },
  hard: { reaction: 4, turn: 26, noise: 2.2, cps: 11, bridge: 5, rushAt: 50, bow: true, smart: true },
};

type Role = 'rusher' | 'collector' | 'defender';
type GoalKind = 'collect' | 'shop' | 'upgrades' | 'defend' | 'rush' | 'hunt' | 'diamonds' | 'mid' | 'home' | 'fight';
type Node = { x: number; z: number; y: number; kind: 0 | 1 | 2 };

export type Brain = {
  role: Role;
  goal: GoalKind;
  goalUntil: number;
  /** Where the goal is (x, y, z) and, for rushes, which team. */
  dest: [number, number, number] | null;
  victim: number;
  path: Node[];
  pathAt: number;
  pathFor: string;
  enemy: number;
  seenSince: number;
  lastSeen: { x: number; y: number; z: number; t: number } | null;
  clickIn: number;
  strafe: number;
  strafeIn: number;
  wtap: number;
  aimNoiseX: number;
  aimNoiseY: number;
  dig: { x: number; y: number; z: number; t: number; need: number } | null;
  placeIn: number;
  defense: number;
  stuck: number;
  lastX: number;
  lastZ: number;
  jumpHold: number;
  useHold: number;
  think: number;
  rng: number;
  /** Enemies we gave up on (out of reach across the void) until this tick. */
  ignore: Map<number, number>;
};

const skillOf = (g: Game) => SKILLS[g.level] ?? SKILLS.normal;

function rnd(b: Brain) {
  b.rng = (Math.imul(b.rng ^ (b.rng >>> 15), 2246822507) + 0x6d2b79f5) >>> 0;
  return b.rng / 4294967296;
}

function brainOf(g: Game, p: Player): Brain {
  if (p.brain) return p.brain as Brain;
  const roles: Role[] = ['rusher', 'collector', 'defender', 'collector', 'rusher', 'defender', 'collector', 'defender'];
  const b: Brain = {
    role: roles[(p.id + (g.seed % 8)) % roles.length],
    goal: 'collect',
    goalUntil: g.tick + TPS * (12 + (p.id % 4) * 3),
    dest: null,
    victim: -1,
    path: [],
    pathAt: -999,
    pathFor: '',
    enemy: -1,
    seenSince: 0,
    lastSeen: null,
    clickIn: 0,
    strafe: 1,
    strafeIn: 0,
    wtap: 0,
    aimNoiseX: 0,
    aimNoiseY: 0,
    dig: null,
    placeIn: 0,
    defense: 0,
    stuck: 0,
    lastX: p.body.x,
    lastZ: p.body.z,
    jumpHold: 0,
    useHold: 0,
    think: p.id % 10,
    rng: (p.id * 2654435761 + g.seed) >>> 0 || 1,
    ignore: new Map(),
  };
  p.brain = b;
  return b;
}

/** Every bot decides its input for this tick (the rules then move it like anyone else). */
export function thinkBots(g: Game) {
  if (g.over) return;
  for (const p of g.players) {
    if (p.ctrl !== 'bot') continue;
    if (!p.alive) {
      if (p.brain) {
        const b = p.brain as Brain;
        b.path = [];
        b.dig = null;
        b.enemy = -1;
        b.goal = 'shop';
        b.goalUntil = 0;
        b.defense = Math.min(b.defense, 1);
      }
      continue;
    }
    think(g, p, brainOf(g, p));
  }
}

// ---------------------------------------------------------------------------------------------------------------
// senses

/** Who this bot can see: in front of it (or very close), in range and in the clear. Invisible players only up close. */
function visibleEnemies(g: Game, p: Player): Player[] {
  const out: Player[] = [];
  const ey = eyeY(p);
  const fx = -Math.sin(p.body.yaw);
  const fz = -Math.cos(p.body.yaw);
  for (const o of g.players) {
    if (!o.alive || o.team === p.team) continue;
    const dx = o.body.x - p.body.x;
    const dz = o.body.z - p.body.z;
    const dy = o.body.y - p.body.y;
    const d = Math.hypot(dx, dy, dz);
    if (d > 40) continue;
    if (o.fx.invis > 0 && d > 2.5) continue;
    const ahead = (dx * fx + dz * fz) / Math.max(0.01, Math.hypot(dx, dz));
    if (d > 5 && ahead < -0.2) continue;
    if (!clearLine(g.world, p.body.x, ey, p.body.z, o.body.x, o.body.y + 1.4, o.body.z)) continue;
    out.push(o);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// the brain

function think(g: Game, p: Player, b: Brain) {
  const sk = skillOf(g);
  const inp = p.input;
  inp.forward = 0;
  inp.strafe = 0;
  inp.jump = false;
  inp.sneak = false;
  inp.sprint = false;
  if (b.placeIn > 0) b.placeIn--;
  if (b.clickIn > 0) b.clickIn--;
  if (b.jumpHold > 0) b.jumpHold--;

  // eat or drink when it helps
  if (b.useHold > 0) {
    b.useHold--;
    if (b.useHold === 0) {
      const slot = p.inv.slots.findIndex((s) => s?.item === 'gapple');
      if (slot >= 0) {
        p.sel = slot;
        applyAction(g, p, { a: 'use', slot, yaw: p.body.yaw, pitch: p.body.pitch });
      }
    }
    p.using = b.useHold > 0 ? 32 - b.useHold : 0;
    return;
  }
  if (p.hp < 9 && p.absorb === 0 && sk.reaction < 12) {
    const slot = p.inv.slots.findIndex((s) => s?.item === 'gapple');
    if (slot >= 0) {
      p.sel = slot;
      b.useHold = 32;
      return;
    }
  }

  // look for trouble every few ticks
  if (--b.think <= 0) {
    b.think = 4;
    const seen = visibleEnemies(g, p);
    let best: Player | null = null;
    let bestD = Infinity;
    for (const o of seen) {
      if ((b.ignore.get(o.id) ?? 0) > g.tick) continue;
      const d = Math.hypot(o.body.x - p.body.x, o.body.y - p.body.y, o.body.z - p.body.z);
      // stay focused: chase the current enemy unless someone is much closer
      const bias = o.id === b.enemy ? 4 : 0;
      if (d - bias < bestD) {
        bestD = d - bias;
        best = o;
      }
    }
    const engage = best && (bestD < 14 || (b.goal === 'defend' && bestD < 20) || (sk.bow && bestD < 26 && hasBow(p)));
    if (best && engage) {
      if (b.enemy !== best.id) {
        b.enemy = best.id;
        b.seenSince = g.tick;
      }
      b.lastSeen = { x: best.body.x, y: best.body.y, z: best.body.z, t: g.tick };
    } else if (b.enemy >= 0 && (!b.lastSeen || g.tick - b.lastSeen.t > TPS * 4)) b.enemy = -1;
  }
  const foe = b.enemy >= 0 ? g.players[b.enemy] : null;
  if (foe && foe.alive && g.tick - b.seenSince >= sk.reaction) {
    fight(g, p, b, foe, sk);
    return;
  }
  if (foe && !foe.alive) b.enemy = -1;
  pursueGoal(g, p, b, sk);
}

/** Picks what to do next: collect, shop, defend, then go out on the bot's errand. */
function chooseGoal(g: Game, p: Player, b: Brain, sk: Skill) {
  const site = g.info.teams[p.team];
  const t = g.tick;
  const blocks = blockCount(p.inv);
  const team = g.teams[p.team];
  const secs = t / TPS;
  const set = (goal: GoalKind, dest: [number, number, number] | null, ticks: number, victim = -1) => {
    b.goal = goal;
    b.dest = dest;
    b.goalUntil = t + ticks;
    b.victim = victim;
    b.path = [];
    b.pathFor = '';
  };
  // something worth buying and enough to pay for it
  const want = nextPurchase(g, p);
  if (want) return set('shop', [site.shop[0], site.shop[1], site.shop[2]], TPS * 20);
  if (p.inv.wallet.diamond >= 1 && nextUpgrade(g, p)) return set('upgrades', [site.upgrades[0], site.upgrades[1], site.upgrades[2]], TPS * 20);
  if (team.bed && b.defense < 2 && blocks >= 10 && (b.defense === 0 || hasItem(p.inv, 'endstone'))) return set('defend', [site.bedFoot[0] + 0.5, site.bedFoot[1], site.bedFoot[2] + 0.5], TPS * 25);
  if (blocks < 12 || secs < 25) return set('collect', [site.forge[0], site.forge[1], site.forge[2]], TPS * (8 + rnd(b) * 8));
  // out on an errand
  const rushReady = secs > sk.rushAt * (b.role === 'rusher' ? 1 : b.role === 'collector' ? 1.6 : 2.4);
  if (rushReady && blocks >= 20) {
    const victim = rushTarget(g, p, b);
    if (victim >= 0) {
      const vs = g.info.teams[victim];
      return set('rush', [vs.bedFoot[0] + 0.5, vs.bedFoot[1], vs.bedFoot[2] + 0.5], TPS * 70, victim);
    }
  }
  // no beds left to take: go find whoever is still standing (the scoreboard says which islands)
  const anyBed = g.teams.some((t) => t.id !== p.team && t.used && t.bed);
  if (!anyBed && blocks >= 16 && (b.role !== 'defender' || !team.bed || secs > 300)) {
    const prey = huntTarget(g, p, b);
    if (prey >= 0) {
      const vs = g.info.teams[prey];
      return set('hunt', [vs.spawn[0], vs.spawn[1], vs.spawn[2]], TPS * 60, prey);
    }
  }
  if (b.role !== 'defender' && blocks >= 16 && secs > 40) {
    const r = rnd(b);
    if (r < 0.55) {
      const gen = nearestGen(g, p, 'diamond');
      if (gen) return set('diamonds', [gen.x, gen.y, gen.z], TPS * 35);
    } else if (secs > 120 && r < 0.85) {
      const gen = nearestGen(g, p, 'emerald');
      if (gen) return set('mid', [gen.x, gen.y, gen.z], TPS * 35);
    }
  }
  return set('collect', [site.forge[0], site.forge[1], site.forge[2]], TPS * 10);
}

function nearestGen(g: Game, p: Player, kind: 'diamond' | 'emerald') {
  let best = null;
  let bd = Infinity;
  for (const gen of g.gens) {
    if (gen.kind !== kind) continue;
    const d = Math.hypot(gen.x - p.body.x, gen.z - p.body.z);
    if (d < bd) {
      bd = d;
      best = gen;
    }
  }
  return best;
}

/** The closest island that still has a bed (bots go for their neighbors). */
function rushTarget(g: Game, p: Player, b: Brain): number {
  const home = g.info.teams[p.team];
  let best = -1;
  let bd = Infinity;
  for (let t = 0; t < g.teams.length; t++) {
    if (t === p.team || !g.teams[t].used || !g.teams[t].bed) continue;
    const s = g.info.teams[t];
    const d = Math.hypot(s.cx - home.cx, s.cz - home.cz) + rnd(b) * 18;
    if (d < bd) {
      bd = d;
      best = t;
    }
  }
  return best;
}

/** The nearest island with someone alive on it. */
function huntTarget(g: Game, p: Player, b: Brain): number {
  const home = g.info.teams[p.team];
  let best = -1;
  let bd = Infinity;
  for (let t = 0; t < g.teams.length; t++) {
    if (t === p.team || !g.teams[t].used || g.teams[t].out) continue;
    if (!g.players.some((o) => o.team === t && o.alive)) continue;
    const s = g.info.teams[t];
    const d = Math.hypot(s.cx - home.cx, s.cz - home.cz) + rnd(b) * 12;
    if (d < bd) {
      bd = d;
      best = t;
    }
  }
  return best;
}

const PLAN: { id: string; keep?: (inv: Inventory) => boolean; when?: (secs: number) => boolean }[] = [
  { id: 'wool', keep: (inv) => count(inv, 'wool') < 24 },
  { id: 'sword_stone', keep: (inv) => !hasAnySword(inv, ['sword_stone', 'sword_iron', 'sword_diamond']) },
  { id: 'armor_chain' },
  { id: 'wool', keep: (inv) => count(inv, 'wool') < 48 },
  { id: 'pick', keep: (inv) => inv.pick < 1 },
  { id: 'shears' },
  { id: 'endstone', keep: (inv) => count(inv, 'endstone') < 12 },
  { id: 'sword_iron', keep: (inv) => !hasAnySword(inv, ['sword_iron', 'sword_diamond']) },
  { id: 'armor_iron' },
  { id: 'gapple', keep: (inv) => count(inv, 'gapple') < 2 },
  { id: 'pick', keep: (inv) => inv.pick < 3 },
  { id: 'wool', keep: (inv) => count(inv, 'wool') < 64 && inv.wallet.iron >= 30 },
  { id: 'endstone', keep: (inv) => count(inv, 'endstone') < 24 && inv.wallet.iron >= 40 },
  { id: 'bow', keep: (inv) => !hasBowInv(inv) },
  { id: 'arrow', keep: (inv) => hasBowInv(inv) && count(inv, 'arrow') < 16 },
  { id: 'fireball', keep: (inv) => count(inv, 'fireball') < 2 && inv.wallet.iron >= 60 },
  { id: 'sword_diamond', keep: (inv) => !hasAnySword(inv, ['sword_diamond']) },
  { id: 'armor_diamond' },
  { id: 'obsidian', keep: (inv) => count(inv, 'obsidian') < 4 },
];

/** The first thing on the shopping list the bot can afford right now. */
export function nextPurchase(g: Game, p: Player): string | null {
  const sk = skillOf(g);
  for (const step of PLAN) {
    if (step.keep && !step.keep(p.inv)) continue;
    if ((step.id === 'bow' || step.id === 'arrow') && !sk.bow) continue;
    if (step.id === 'fireball' && !sk.smart) continue;
    const offer = OFFERS.find((o) => o.id === step.id);
    if (!offer) continue;
    const price = priceOf(p.inv, offer);
    if (!price) continue;
    if (p.inv.wallet[price.res] >= price.cost) {
      // check it would fit
      const trial: Inventory = { ...p.inv, slots: p.inv.slots.map((s) => (s ? { ...s } : null)), wallet: { ...p.inv.wallet } };
      if (dryBuy(trial, step.id).ok) return step.id;
    }
  }
  return null;
}

function nextUpgrade(g: Game, p: Player): 'sharp' | 'prot' | 'forge' | 'heal' | 'haste' | null {
  const ups = g.teams[p.team].ups;
  const d = p.inv.wallet.diamond;
  const order: ['sharp' | 'prot' | 'forge' | 'heal' | 'haste', number][] = [
    ['prot', [2, 4, 8, 16][ups.prot] ?? 99],
    ['sharp', ups.sharp ? 99 : 4],
    ['forge', [2, 4, 6, 8][ups.forge] ?? 99],
    ['heal', ups.heal ? 99 : 1],
    ['haste', [2, 4][ups.haste] ?? 99],
  ];
  for (const [k, cost] of order) if (d >= cost) return k;
  return null;
}

const count = (inv: Inventory, item: Item) => inv.slots.reduce((n, s) => n + (s?.item === item ? s.n : 0), 0);
const hasItem = (inv: Inventory, item: Item) => inv.slots.some((s) => s?.item === item);
const hasAnySword = (inv: Inventory, items: Item[]) => inv.slots.some((s) => s && items.includes(s.item));
const hasBowInv = (inv: Inventory) => inv.slots.some((s) => s && ITEM_DEFS[s.item].kind === 'bow');
const hasBow = (p: Player) => hasBowInv(p.inv) && count(p.inv, 'arrow') > 0;
const BRIDGE_ITEMS: Item[] = ['wool', 'clay', 'wood', 'endstone'];
function blockCount(inv: Inventory) {
  return inv.slots.reduce((n, s) => n + (s && BRIDGE_ITEMS.includes(s.item) ? s.n : 0), 0);
}
/** Selects the best block for the job (wool to bridge, end stone to defend). */
function selectBlock(p: Player, prefer: Item[]): boolean {
  for (const item of prefer) {
    const slot = p.inv.slots.findIndex((s, i) => i < 9 && s?.item === item);
    if (slot >= 0) {
      p.sel = slot;
      return true;
    }
  }
  // blocks in the back row come forward
  for (const item of prefer) {
    const slot = p.inv.slots.findIndex((s) => s?.item === item);
    if (slot >= 9) {
      const free = p.inv.slots.findIndex((s, i) => i < 9 && !s);
      const to = free >= 0 ? free : 8;
      const tmp = p.inv.slots[to];
      p.inv.slots[to] = p.inv.slots[slot];
      p.inv.slots[slot] = tmp;
      p.sel = to;
      return true;
    }
  }
  return false;
}
function selectWeapon(p: Player) {
  const order: Item[] = ['sword_diamond', 'sword_iron', 'sword_stone', 'sword_wood', 'axe', 'kb_stick'];
  for (const item of order) {
    const slot = p.inv.slots.findIndex((s, i) => i < 9 && s?.item === item);
    if (slot >= 0) {
      p.sel = slot;
      return;
    }
  }
}

function pursueGoal(g: Game, p: Player, b: Brain, sk: Skill) {
  const site = g.info.teams[p.team];
  if (g.tick >= b.goalUntil || !b.dest) chooseGoal(g, p, b, sk);
  const dest = b.dest!;
  const d = Math.hypot(dest[0] - p.body.x, dest[2] - p.body.z);
  switch (b.goal) {
    case 'collect':
      if (d < 1.2) {
        idleLook(g, p, b);
        return;
      }
      break;
    case 'shop':
      if (nearNpc(g, p, 'shop') && d < 3.5) {
        // buy a couple of things, a beat apart, like a person clicking through the shop
        if (g.tick % 6 === 0) {
          const want = nextPurchase(g, p);
          if (want) applyAction(g, p, { a: 'buy', id: want });
          else b.goalUntil = g.tick;
        }
        faceToward(p, dest[0], dest[1] + 1.4, dest[2], 10);
        return;
      }
      break;
    case 'upgrades':
      if (nearNpc(g, p, 'upgrades') && d < 3.5) {
        if (g.tick % 8 === 0) {
          const up = nextUpgrade(g, p);
          if (up) applyAction(g, p, { a: 'upg', key: up });
          else if (p.inv.wallet.diamond >= 1 && g.teams[p.team].traps.length === 0) applyAction(g, p, { a: 'trap', kind: 'trap' });
          else b.goalUntil = g.tick;
        }
        faceToward(p, dest[0], dest[1] + 1.4, dest[2], 10);
        return;
      }
      break;
    case 'defend':
      if (d < 7) {
        if (defendBed(g, p, b, sk)) return;
        b.defense++;
        b.goalUntil = g.tick;
        return;
      }
      break;
    case 'hunt':
      if (d < 3 || g.teams[b.victim]?.out) b.goalUntil = g.tick;
      break;
    case 'diamonds':
    case 'mid':
      if (d < 1.0) {
        idleLook(g, p, b);
        // head home to spend once there is something to spend
        if (p.inv.wallet.diamond >= 4 || p.inv.wallet.emerald >= 4) b.goalUntil = Math.min(b.goalUntil, g.tick + TPS * 2);
        return;
      }
      break;
    case 'rush': {
      const vt = g.teams[b.victim];
      if (!vt || !vt.bed) {
        b.goalUntil = g.tick;
        break;
      }
      if (d < 4.2) {
        if (attackBed(g, p, b, sk)) return;
      }
      break;
    }
    case 'home':
      if (d < 2) b.goalUntil = g.tick;
      break;
    case 'fight':
      break;
  }
  walkTo(g, p, b, dest[0], dest[1], dest[2], sk, b.goal === 'rush' ? 1.6 : 0.6);
  void site;
}

function idleLook(g: Game, p: Player, b: Brain) {
  // glance around now and then
  if (g.tick % 40 === 0) b.aimNoiseX = (rnd(b) - 0.5) * 2.4;
  p.body.yaw += (b.aimNoiseX - 0) * 0.02;
  p.body.pitch += (-0.15 - p.body.pitch) * 0.1;
}

/** Turns toward a point at the bot's limited turn rate. */
function faceToward(p: Player, x: number, y: number, z: number, maxDeg: number) {
  const dx = x - p.body.x;
  const dz = z - p.body.z;
  const dy = y - eyeY(p);
  const yaw = Math.atan2(-dx, -dz);
  const pitch = Math.atan2(dy, Math.hypot(dx, dz));
  turn(p, yaw, pitch, maxDeg);
}
function turn(p: Player, yaw: number, pitch: number, maxDeg: number) {
  const m = (maxDeg * Math.PI) / 180;
  let dy = yaw - p.body.yaw;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  p.body.yaw += Math.max(-m, Math.min(m, dy));
  p.body.pitch += Math.max(-m, Math.min(m, pitch - p.body.pitch));
  p.body.pitch = Math.max(-1.55, Math.min(1.55, p.body.pitch));
}

// ---------------------------------------------------------------------------------------------------------------
// combat

function fight(g: Game, p: Player, b: Brain, foe: Player, sk: Skill) {
  const dx = foe.body.x - p.body.x;
  const dz = foe.body.z - p.body.z;
  const dist = Math.hypot(dx, dz);
  const dy = foe.body.y - p.body.y;
  // out of reach across the void: shoot if we can, otherwise leave them be for a while
  const reachable = dist < 3.2 || walkable(g, p, foe);
  const ranged = sk.bow && hasBow(p) && dist > 6 && dist < 30;
  if ((!reachable && !ranged) || (dist > 16 && !ranged)) {
    b.ignore.set(foe.id, g.tick + TPS * (reachable ? 3 : 6));
    b.enemy = -1;
    pursueGoal(g, p, b, sk);
    return;
  }
  // aim: lead a moving target a little, wobble like a hand on a mouse
  if (g.tick % 3 === 0) {
    b.aimNoiseX += ((rnd(b) - 0.5) * sk.noise - b.aimNoiseX) * 0.5;
    b.aimNoiseY += ((rnd(b) - 0.5) * sk.noise * 0.6 - b.aimNoiseY) * 0.5;
  }
  const lead = ranged ? dist / 3 : 2;
  const tx = foe.body.x + foe.body.vx * lead;
  const tz = foe.body.z + foe.body.vz * lead;
  const ty = foe.body.y + (ranged ? 1.5 + dist * dist * 0.0016 : 1.3);
  const yaw = Math.atan2(-(tx - p.body.x), -(tz - p.body.z)) + (b.aimNoiseX * Math.PI) / 180;
  const pitch = Math.atan2(ty - eyeY(p), Math.hypot(tx - p.body.x, tz - p.body.z)) + (b.aimNoiseY * Math.PI) / 180;
  turn(p, yaw, pitch, sk.turn);

  if (ranged) {
    // draw, hold, loose
    const slot = p.inv.slots.findIndex((s, i) => i < 9 && s && ITEM_DEFS[s.item].kind === 'bow');
    if (slot >= 0) {
      p.sel = slot;
      p.drawing++;
      if (p.drawing >= 22) {
        applyAction(g, p, { a: 'shoot', charge: p.drawing, yaw: p.body.yaw, pitch: p.body.pitch });
        p.drawing = 0;
      }
      p.input.sneak = false;
      return;
    }
  }
  p.drawing = 0;
  selectWeapon(p);
  // a fireball at someone out on a bridge
  if (sk.smart && dist > 6 && dist < 16 && hasItem(p.inv, 'fireball') && g.tick % 40 === 0 && rnd(b) < 0.4) {
    const slot = p.inv.slots.findIndex((s) => s?.item === 'fireball');
    if (slot >= 0 && slot < 9) {
      applyAction(g, p, { a: 'use', slot, yaw: p.body.yaw, pitch: p.body.pitch });
      return;
    }
  }
  // footwork: close in, strafe, w-tap after a hit
  if (--b.strafeIn <= 0) {
    b.strafe = rnd(b) < 0.5 ? -1 : 1;
    b.strafeIn = 10 + Math.floor(rnd(b) * 22);
  }
  const close = dist < 2.6;
  const inp = p.input;
  inp.forward = b.wtap > 0 ? 0 : dist > 1.9 ? 1 : 0;
  inp.strafe = dist < 5 ? b.strafe * (close ? 1 : 0.6) : 0;
  inp.sprint = inp.forward > 0;
  if (b.wtap > 0) b.wtap--;
  // never walk into the void after them
  if (inp.forward > 0 && !groundAhead(g, p, -Math.sin(p.body.yaw), -Math.cos(p.body.yaw))) {
    inp.forward = 0;
    inp.sneak = true;
  }
  if (inp.strafe !== 0) {
    const rx = Math.cos(p.body.yaw) * inp.strafe;
    const rz = -Math.sin(p.body.yaw) * inp.strafe;
    if (!groundAhead(g, p, rx, rz)) {
      inp.strafe = 0;
      b.strafe = -b.strafe;
    }
  }
  // jump for crits now and then when close, or up a step
  if (close && p.body.onGround && rnd(b) < (sk.smart ? 0.12 : 0.05) && b.jumpHold === 0) {
    inp.jump = true;
    b.jumpHold = 12;
  }
  if (dy > 0.6 && dist < 4) inp.jump = true;
  // click: at the bot's rate, landing only when the crosshair is really on them
  if (b.clickIn <= 0 && dist < 4.2) {
    b.clickIn = Math.max(1, Math.round(TPS / (sk.cps * (0.8 + rnd(b) * 0.4))));
    p.swings++;
    if (onTarget(g, p, foe)) {
      const crit = isCrit(p.body);
      const hit = applyAction(g, p, { a: 'hit', target: foe.id, crit });
      if (hit && sk.smart) b.wtap = 3;
    }
  }
}

/** Is the bot's crosshair on the target's hitbox within reach? */
function onTarget(g: Game, p: Player, o: Player) {
  const [dx, dy, dz] = lookDir(p.body.yaw, p.body.pitch);
  const ey = eyeY(p);
  const hit = rayBox(p.body.x, ey, p.body.z, dx, dy, dz, o.body.x - WIDTH / 2 - 0.1, o.body.y - 0.1, o.body.z - WIDTH / 2 - 0.1, o.body.x + WIDTH / 2 + 0.1, o.body.y + HEIGHT + 0.1, o.body.z + WIDTH / 2 + 0.1);
  if (!hit || hit.t > REACH_HIT) return false;
  const block = raycast(g.world, p.body.x, ey, p.body.z, dx, dy, dz, hit.t);
  return !block;
}

/** Is there ground to walk on all the way to someone (no void gaps, no walls)? */
function walkable(g: Game, p: Player, o: Player) {
  const dx = o.body.x - p.body.x;
  const dz = o.body.z - p.body.z;
  const d = Math.hypot(dx, dz);
  if (Math.abs(o.body.y - p.body.y) > 3.5) return false;
  let y = Math.round(p.body.y);
  for (let s = 0.7; s < d; s += 0.7) {
    const x = Math.floor(p.body.x + (dx / d) * s);
    const z = Math.floor(p.body.z + (dz / d) * s);
    const ny = standY(g, x, z, y);
    if (ny < 0 || Math.abs(ny - y) > 1) return false;
    y = ny;
  }
  return true;
}

function groundAhead(g: Game, p: Player, dx: number, dz: number) {
  const len = Math.hypot(dx, dz) || 1;
  const x = p.body.x + (dx / len) * 0.9;
  const z = p.body.z + (dz / len) * 0.9;
  for (let k = 1; k <= 4; k++) {
    const id = g.world.get(x, p.body.y - k, z);
    if (id !== AIR && BLOCKS[id].solid) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------------------------
// beds: wrapping your own, digging into theirs

/** The cells around a bed, layer by layer (1: touching it, 2: around that). */
export function defenseCells(g: Game, team: number, layer: number): [number, number, number][] {
  const site = g.info.teams[team];
  const bed = [site.bedFoot, site.bedHead];
  const inBed = (x: number, y: number, z: number) => bed.some((c) => c[0] === x && c[1] === y && c[2] === z);
  const ring = new Map<string, [number, number, number]>();
  let shell: [number, number, number][] = bed.map((c) => [c[0], c[1], c[2]]);
  const seen = new Set(shell.map((c) => c.join(',')));
  for (let l = 1; l <= layer; l++) {
    const next: [number, number, number][] = [];
    for (const [x, y, z] of shell)
      for (const [dx, dy, dz] of [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
        [0, 0, -1],
      ]) {
        const c: [number, number, number] = [x + dx, y + dy, z + dz];
        const k = c.join(',');
        if (seen.has(k) || inBed(...c)) continue;
        seen.add(k);
        next.push(c);
        if (l === layer) ring.set(k, c);
      }
    shell = next;
  }
  // nothing below the island top
  return [...ring.values()].filter(([, y]) => y >= site.bedFoot[1]);
}

/** Places the next defense block around the bed, walking around it as needed. Returns false once the layer is done. */
function defendBed(g: Game, p: Player, b: Brain, sk: Skill): boolean {
  const layer = b.defense + 1;
  const prefer: Item[] = layer === 1 ? ['wool', 'clay', 'wood', 'endstone'] : ['endstone', 'wood', 'clay', 'wool'];
  if (!selectBlock(p, prefer)) return false;
  const site = g.info.teams[p.team];
  const bcx = (site.bedFoot[0] + site.bedHead[0]) / 2 + 0.5;
  const bcz = (site.bedFoot[2] + site.bedHead[2]) / 2 + 0.5;
  const ring = defenseCells(g, p.team, layer);
  // standing inside the ring: step outward first
  if (ring.some(([x, y, z]) => bodyOverlapsCell(p.body.x, p.body.y, p.body.z, x, y, z))) {
    faceToward(p, p.body.x + (p.body.x - bcx) * 3, p.body.y + 1.4, p.body.z + (p.body.z - bcz) * 3, sk.turn * 2);
    p.input.forward = 1;
    p.input.sneak = true;
    return true;
  }
  const block = blockFor(heldItem(p)!, p.team);
  const todo = ring.filter(([x, y, z]) => g.world.get(x, y, z) === AIR && placeAllowed(g, x, y, z, block, p.id));
  if (!todo.length) return false;
  const ey = eyeY(p);
  const reach = (c: [number, number, number]) => Math.hypot(c[0] + 0.5 - p.body.x, c[1] + 0.5 - ey, c[2] + 0.5 - p.body.z);
  todo.sort((a, c) => reach(a) - reach(c));
  const cell = todo[0];
  if (reach(cell) > 4.3) {
    // walk to a spot just outside the ring next to it
    let ox = cell[0] + 0.5 - bcx;
    let oz = cell[2] + 0.5 - bcz;
    const len = Math.hypot(ox, oz) || 1;
    ox /= len;
    oz /= len;
    const sx = cell[0] + 0.5 + ox * 1.6;
    const sz = cell[2] + 0.5 + oz * 1.6;
    faceToward(p, sx, p.body.y + 1.4, sz, sk.turn * 1.5);
    p.input.forward = 1;
    p.input.sneak = !groundAhead(g, p, sx - p.body.x, sz - p.body.z);
    if (p.input.sneak) p.input.forward = 0.3;
    return true;
  }
  faceToward(p, cell[0] + 0.5, cell[1] + 0.5, cell[2] + 0.5, sk.turn * 1.5);
  if (b.placeIn > 0) return true;
  b.placeIn = sk.bridge;
  applyAction(g, p, { a: 'place', x: cell[0], y: cell[1], z: cell[2], slot: p.sel, face: 2, seq: 0 });
  p.swings++;
  return true;
}

/** Mines through whatever covers an enemy bed, then the bed. */
function attackBed(g: Game, p: Player, b: Brain, sk: Skill): boolean {
  const vs = g.info.teams[b.victim];
  const ey = eyeY(p);
  const targets = [vs.bedFoot, vs.bedHead];
  let best: { x: number; y: number; z: number } | null = null;
  for (const c of targets) {
    const id = g.world.get(c[0], c[1], c[2]);
    if (!isBed(id)) continue;
    // first breakable block on the line from the eye to the bed
    const dx = c[0] + 0.5 - p.body.x;
    const dy = c[1] + 0.3 - ey;
    const dz = c[2] + 0.5 - p.body.z;
    const len = Math.hypot(dx, dy, dz);
    const hit = raycast(g.world, p.body.x, ey, p.body.z, dx / len, dy / len, dz / len, 5);
    if (!hit) continue;
    if (canBreak(g.world, hit.x, hit.y, hit.z)) {
      best = { x: hit.x, y: hit.y, z: hit.z };
      break;
    }
  }
  if (!best) return false;
  return mine(g, p, b, sk, best.x, best.y, best.z);
}

/** Digs a block with the right tool at Minecraft speed. Returns true while busy. */
function mine(g: Game, p: Player, b: Brain, sk: Skill, x: number, y: number, z: number): boolean {
  const id = g.world.get(x, y, z);
  if (id === AIR) {
    b.dig = null;
    return false;
  }
  faceToward(p, x + 0.5, y + 0.5, z + 0.5, sk.turn * 1.4);
  const tool = BLOCKS[id].tool;
  const want: Item | null = tool === 'shears' && p.inv.shears ? 'shears' : tool === 'pick' && p.inv.pick ? 'pick' : tool === 'axe' && p.inv.axe ? 'axe' : null;
  if (want) {
    const slot = p.inv.slots.findIndex((s, i) => i < 9 && s?.item === want);
    if (slot >= 0) p.sel = slot;
  }
  const held = heldItem(p);
  const kind = held === 'pick' ? 'pick' : held === 'axe' ? 'axe' : held === 'shears' ? 'shears' : 'none';
  if (!b.dig || b.dig.x !== x || b.dig.y !== y || b.dig.z !== z) {
    const need = breakTicks(id, kind, { pick: p.inv.pick, axe: p.inv.axe, shears: p.inv.shears }, g.teams[p.team].ups.haste, p.body.onGround);
    b.dig = { x, y, z, t: 0, need: Math.max(1, need) };
  }
  b.dig.t++;
  if (b.dig.t % 4 === 1) p.swings++;
  if (b.dig.t >= b.dig.need) {
    applyAction(g, p, { a: 'break', x, y, z, seq: 0 });
    b.dig = null;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------------------------
// getting around: paths over the islands, bridges over the void, digging through placed blocks

const free = (id: number) => id === AIR || !BLOCKS[id].solid || BLOCKS[id].shape === 'cross';
const solidGround = (id: number) => id !== AIR && BLOCKS[id].solid && BLOCKS[id].shape === 'cube';

/** Where a bot would stand in a column, searching near a reference height. */
export function standY(g: Game, x: number, z: number, ref: number): number {
  const w = g.world;
  for (let y = ref + 1; y >= ref - 5; y--) {
    if (y < 1) break;
    if (solidGround(w.get(x, y - 1, z)) && free(w.get(x, y, z)) && free(w.get(x, y + 1, z))) return y;
  }
  return -1;
}

const N = SX * SZ;
const gScore = new Float32Array(N);
const from = new Int32Array(N);
const heightAt = new Int16Array(N);
const kindAt = new Uint8Array(N);
const stamp = new Uint32Array(N);
const closed = new Uint32Array(N);
let gen = 1;

/** A* over columns: walk on ground (stepping up one, dropping a few), bridge across air, dig through placed blocks. */
export function findPath(g: Game, sx: number, sy: number, sz: number, tx: number, tz: number, canBridge: boolean, limit = 7000): Node[] {
  gen++;
  const start = sx + sz * SX;
  const goal = tx + tz * SX;
  const heap: number[] = [];
  const fs: number[] = [];
  const push = (i: number, f: number) => {
    heap.push(i);
    fs.push(f);
    let k = heap.length - 1;
    while (k > 0) {
      const pk = (k - 1) >> 1;
      if (fs[pk] <= fs[k]) break;
      [heap[pk], heap[k]] = [heap[k], heap[pk]];
      [fs[pk], fs[k]] = [fs[k], fs[pk]];
      k = pk;
    }
  };
  const pop = () => {
    const top = heap[0];
    const lastI = heap.pop()!;
    const lastF = fs.pop()!;
    if (heap.length) {
      heap[0] = lastI;
      fs[0] = lastF;
      let k = 0;
      for (;;) {
        const l = k * 2 + 1;
        const r = l + 1;
        let m = k;
        if (l < heap.length && fs[l] < fs[m]) m = l;
        if (r < heap.length && fs[r] < fs[m]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        [fs[m], fs[k]] = [fs[k], fs[m]];
        k = m;
      }
    }
    return top;
  };
  const h = (x: number, z: number) => {
    const dx = Math.abs(x - tx);
    const dz = Math.abs(z - tz);
    return Math.max(dx, dz) + 0.41 * Math.min(dx, dz);
  };
  stamp[start] = gen;
  gScore[start] = 0;
  heightAt[start] = sy;
  kindAt[start] = 0;
  from[start] = -1;
  push(start, h(sx, sz));
  let best = start;
  let bestH = h(sx, sz);
  let expanded = 0;
  const w = g.world;
  while (heap.length && expanded < limit) {
    const cur = pop();
    if (closed[cur] === gen) continue;
    closed[cur] = gen;
    expanded++;
    const cx = cur % SX;
    const cz = (cur / SX) | 0;
    const cy = heightAt[cur];
    const hc = h(cx, cz);
    if (hc < bestH) {
      bestH = hc;
      best = cur;
    }
    if (cur === goal) {
      best = cur;
      break;
    }
    for (let dir = 0; dir < 8; dir++) {
      const dx = [1, -1, 0, 0, 1, 1, -1, -1][dir];
      const dz = [0, 0, 1, -1, 1, -1, 1, -1][dir];
      const nx = cx + dx;
      const nz = cz + dz;
      if (nx < 1 || nz < 1 || nx >= SX - 1 || nz >= SZ - 1) continue;
      const ni = nx + nz * SX;
      if (closed[ni] === gen) continue;
      const diag = dx !== 0 && dz !== 0;
      let ny = standY(g, nx, nz, cy);
      let kind: 0 | 1 | 2 = 0;
      let cost = diag ? 1.41 : 1;
      if (ny >= 0) {
        if (ny > cy + 1) continue;
        if (ny > cy) cost += 0.6;
        if (ny < cy) cost += (cy - ny) * 0.3;
        if (diag) {
          // no cutting corners past walls or over the void
          const a = standY(g, cx + dx, cz, cy);
          const c = standY(g, cx, cz + dz, cy);
          if (a < 0 || c < 0 || Math.abs(a - cy) > 1 || Math.abs(c - cy) > 1) continue;
        }
      } else {
        // is it open air (bridge) or a wall?
        const feet = w.get(nx, cy, nz);
        const head = w.get(nx, cy + 1, nz);
        const below = w.get(nx, cy - 1, nz);
        if (free(feet) && free(head) && below === AIR) {
          if (!canBridge || diag || cy - 1 < 2 || cy - 1 > BUILD_MAX) continue;
          if (noBuildAt(g, nx, cy - 1, nz)) continue;
          ny = cy;
          kind = 1;
          cost = 3.2;
        } else if (!diag && (canBreak(w, nx, cy, nz) || free(feet)) && (canBreak(w, nx, cy + 1, nz) || free(head)) && solidGround(below)) {
          // placed blocks in the way get dug through
          ny = cy;
          kind = 2;
          cost = 6;
        } else continue;
      }
      const ng = gScore[cur] + cost;
      if (stamp[ni] === gen && ng >= gScore[ni]) continue;
      stamp[ni] = gen;
      gScore[ni] = ng;
      from[ni] = cur;
      heightAt[ni] = ny;
      kindAt[ni] = kind;
      push(ni, ng + h(nx, nz));
    }
  }
  const path: Node[] = [];
  for (let i = best; i !== -1 && i !== start; i = from[i]) path.push({ x: i % SX, z: (i / SX) | 0, y: heightAt[i], kind: kindAt[i] as 0 | 1 | 2 });
  path.reverse();
  return path;
}

function noBuildAt(g: Game, x: number, y: number, z: number) {
  for (const b of g.info.noBuild) if (inBox(b, x, y, z)) return true;
  return false;
}

/** Follows (and refreshes) a path to a point: walking, bridging and digging as the path says. */
function walkTo(g: Game, p: Player, b: Brain, x: number, y: number, z: number, sk: Skill, near: number) {
  const body = p.body;
  const key = `${Math.floor(x)},${Math.floor(z)}`;
  const blocks = blockCount(p.inv);
  if (b.pathFor !== key || g.tick - b.pathAt > TPS * 3 || !b.path.length) {
    const sy = Math.round(body.y);
    b.path = findPath(g, Math.floor(body.x), sy, Math.floor(body.z), Math.floor(x), Math.floor(z), blocks > 0);
    b.pathAt = g.tick;
    b.pathFor = key;
  }
  // drop nodes we have reached
  while (b.path.length && Math.hypot(b.path[0].x + 0.5 - body.x, b.path[0].z + 0.5 - body.z) < 0.45 && Math.abs(b.path[0].y - body.y) < 1.2) b.path.shift();
  const node = b.path[0];
  if (!node) {
    if (Math.hypot(x - body.x, z - body.z) > near) {
      faceToward(p, x, y + 1.4, z, sk.turn);
      p.input.forward = 1;
    }
    return;
  }
  const nx = node.x + 0.5;
  const nz = node.z + 0.5;
  // stuck: jump, then try a fresh path
  if (g.tick % 20 === 0) {
    const moved = Math.hypot(body.x - b.lastX, body.z - b.lastZ);
    b.stuck = moved < 0.3 && !b.dig ? b.stuck + 1 : 0;
    b.lastX = body.x;
    b.lastZ = body.z;
    if (b.stuck >= 3) {
      b.path = [];
      b.stuck = 0;
      p.input.jump = true;
    }
  }
  if (node.kind === 1) {
    bridgeTo(g, p, b, sk, node);
    return;
  }
  if (node.kind === 2) {
    // dig through: head then feet
    for (const yy of [node.y + 1, node.y]) {
      if (!free(g.world.get(node.x, yy, node.z)) && canBreak(g.world, node.x, yy, node.z)) {
        mine(g, p, b, sk, node.x, yy, node.z);
        return;
      }
    }
  }
  b.dig = null;
  const yaw = Math.atan2(-(nx - body.x), -(nz - body.z));
  turn(p, yaw, -0.1, sk.turn * 1.2);
  let dyaw = yaw - body.yaw;
  while (dyaw > Math.PI) dyaw -= Math.PI * 2;
  while (dyaw < -Math.PI) dyaw += Math.PI * 2;
  p.input.forward = Math.abs(dyaw) < 0.9 ? 1 : 0.2;
  // walk carefully on narrow ground: sneak where the next step is over the void
  const nextBridge = b.path[1]?.kind === 1;
  p.input.sprint = !nextBridge && Math.abs(dyaw) < 0.4;
  if (node.y > body.y + 0.4 && Math.hypot(nx - body.x, nz - body.z) < 1.6) p.input.jump = true;
  if (!groundAhead(g, p, nx - body.x, nz - body.z) && node.y >= body.y - 0.5) {
    p.input.sneak = true;
    p.input.sprint = false;
  }
}

/** Bridges one block: crouch at the edge, look down at the side of the block we stand on, place, step out. */
function bridgeTo(g: Game, p: Player, b: Brain, sk: Skill, node: Node) {
  const body = p.body;
  const by = node.y - 1;
  if (!g.world.get(node.x, by, node.z) || g.world.get(node.x, by, node.z) === AIR) {
    if (!selectBlock(p, ['wool', 'clay', 'wood', 'endstone'])) {
      b.path = [];
      b.goalUntil = g.tick;
      return;
    }
    const tx = node.x + 0.5;
    const tz = node.z + 0.5;
    // face along the bridge, looking down at the gap
    const yaw = Math.atan2(-(tx - body.x), -(tz - body.z));
    turn(p, yaw, -1.2, sk.turn);
    p.input.sneak = true;
    p.input.forward = 1;
    const dist = Math.hypot(tx - body.x, by + 0.5 - eyeY(p), tz - body.z);
    if (b.placeIn <= 0 && dist < 4) {
      const block = blockFor(heldItem(p)!, p.team);
      if (placeAllowed(g, node.x, by, node.z, block, p.id)) {
        applyAction(g, p, { a: 'place', x: node.x, y: by, z: node.z, slot: p.sel, face: 2, seq: 0 });
        p.swings++;
        b.placeIn = sk.bridge;
      } else {
        b.path = [];
      }
    }
    return;
  }
  // block is down: step onto it (still crouched, so a slip does not end it)
  const yaw = Math.atan2(-(node.x + 0.5 - body.x), -(node.z + 0.5 - body.z));
  turn(p, yaw, -1.0, sk.turn);
  p.input.forward = 1;
  p.input.sneak = true;
}
