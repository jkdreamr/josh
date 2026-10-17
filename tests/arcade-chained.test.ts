import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CHAIN_L,
  DIR,
  EDGE_TOL,
  JUMP_V,
  MAX_RISE,
  R_CORE,
  R_REF,
  SOUL_R,
  SPRING_V,
  TOP,
  ZONES,
  angDiff,
  buildLevel,
  jumpApex,
  maxGap,
  maxRise,
  pose,
  rad,
  reach,
  spawnAt,
  zoneIndex,
  type Level,
  type Platform,
} from '../src/os/arcade/games/chained/level.ts';
import {
  COUNTDOWN,
  CRUMBLE_BACK,
  CRUMBLE_WARN,
  FALL_TOO_FAR,
  GRIP_V,
  LAVA_DELAY,
  LAVA_RISE,
  LAVA_RISE_SOLO,
  MODES,
  RANKED_MODES,
  RESPAWN_T,
  WIND_FROM,
  applyRemote,
  chainOf,
  createGame,
  crumbleState,
  fmtTime,
  isMode,
  lavaAt,
  liveOf,
  neighbours,
  over,
  scheduleRespawn,
  seatSouls,
  step,
  teamHeight,
  windAt,
  type Driver,
  type Game,
  type Input,
  type Mode,
  type Soul,
} from '../src/os/arcade/games/chained/logic.ts';
import { configOf, endOf, events, guestState, hostState, parsePacket, reportOf, syncClock, type NetEv } from '../src/os/arcade/games/chained/net.ts';
import { BPM, SONGS, STEPS, Sequencer, hz, midi } from '../src/os/arcade/games/chained/music.ts';
import { DT as SHADE_DT, SHADE_INFO, SHADE_LEVELS, attachShades, climb, createShade, driveShade, type ShadeLevel } from '../src/os/arcade/games/chained/shade.ts';

const DT = 1 / 60;
const idle: Input = { side: 0, fwd: 0, jump: false, hold: false };
const spec = (seat: number, kind: 'local' | 'remote' = 'local') => ({ seat, name: `p${seat}`, color: '#fff', kind });

/** A game past the countdown with n local souls. */
function game(n = 2, mode: 'normal' | 'beginner' | 'lava' = 'normal', level?: Level): Game {
  return createGame({ mode, souls: Array.from({ length: n }, (_, i) => spec(i)), countdown: 0, level });
}

type Who = { team: number; driver?: Driver; pace?: number };
/** Two souls for one team: a pair of players, or a pair of shades at a pace. */
const pair = (team: number, driver?: Driver, pace?: number): Who[] => [
  { team, driver, pace },
  { team, driver, pace },
];
/** A race past the countdown: local souls from `who`, two per team by default, team 0 first. */
function race(opts: { mode?: Mode; level?: Level; who?: Who[] } = {}): Game {
  const who = opts.who ?? [...pair(0), ...pair(1)];
  return createGame({ mode: opts.mode ?? 'race', souls: who.map((w, i) => ({ ...spec(i), ...w })), countdown: 0, level: opts.level });
}
/** Steps a game frame by frame, the way the shell does, until it is decided or the limit is up. */
function playOut(g: Game, limit = 900) {
  while (g.won === null && !g.lost && g.time < limit) step(g, SHADE_DT);
  return g;
}

/** Puts a soul on a ledge at arc offset `off` metres from its centre (positive is onwards up the climb), standing still. */
function put(g: Game, s: Soul, p: Platform, off = 0, r = p.r0 + 1.2) {
  const q = pose(p, g.time);
  const a = q.a + DIR * (off / r);
  s.x = Math.cos(a) * r;
  s.z = Math.sin(a) * r;
  s.y = q.y;
  s.vx = s.vy = s.vz = 0;
  s.grounded = true;
  s.ground = p.id;
  s.coyote = 0;
  s.air = 0;
  s.fallFrom = s.y;
  s.burned = -1;
}

/** Moves a soul straight out from the core to radius r. */
function outTo(s: Soul, r: number) {
  const k = r / Math.hypot(s.x, s.z);
  s.x *= k;
  s.z *= k;
}

const run = (g: Game, seconds: number, inputs?: (g: Game, t: number) => void) => {
  const frames = Math.round(seconds / DT);
  for (let i = 0; i < frames; i++) {
    inputs?.(g, i * DT);
    step(g, DT);
  }
};
const drain = (g: Game) => g.events.splice(0);
const arcOf = (s: { x: number; z: number }) => Math.atan2(s.z, s.x);

// ---------------------------------------------------------------------------------------------------------------
// the tower

test('the same seed builds the same tower, and TOP is where the goal is', () => {
  const a = buildLevel();
  const b = buildLevel();
  assert.deepEqual(
    a.platforms.map((p) => [p.kind, p.a, p.y, p.span]),
    b.platforms.map((p) => [p.kind, p.a, p.y, p.span]),
  );
  assert.equal(a.goal.y, TOP);
  assert.equal(a.goal.kind, 'goal');
  assert.ok(a.platforms.length > 60 && a.platforms.length < 140, `${a.platforms.length} ledges`);
  const other = buildLevel(99);
  assert.notDeepEqual(
    a.platforms.map((p) => p.y),
    other.platforms.map((p) => p.y),
  );
});

test('six circles stack from the floor to the top, each with a beacon at its door', () => {
  assert.equal(ZONES.length, 6);
  assert.equal(ZONES[0].from, 0);
  assert.equal(ZONES[ZONES.length - 1].to, TOP);
  for (let i = 1; i < ZONES.length; i++) assert.equal(ZONES[i].from, ZONES[i - 1].to);
  assert.equal(zoneIndex(-5), 0);
  assert.equal(zoneIndex(TOP + 10), 5);
  const lv = buildLevel();
  assert.equal(lv.checkpoints.length, ZONES.length + 1, 'floor, one beacon per circle after the first, and the goal');
  lv.checkpoints.forEach((p, i) => {
    assert.equal(p.cp, i);
    if (i > 0) assert.ok(p.y > lv.checkpoints[i - 1].y);
    if (i > 0 && i < ZONES.length) assert.equal(p.zone, i, `beacon ${i} opens circle ${i}`);
  });
  const kinds = new Set(lv.platforms.map((p) => p.kind));
  for (const k of ['stone', 'crumble', 'lift', 'swing', 'ice', 'spring', 'checkpoint']) assert.ok(kinds.has(k as Platform['kind']), `the tower has ${k} ledges`);
});

test('every step of the route fits inside a running jump', () => {
  const lv = buildLevel();
  assert.ok(reach(0) > reach(1) && reach(MAX_RISE) > 0 && reach(jumpApex() + 0.01) === 0);
  assert.ok(maxRise(0) === MAX_RISE && maxRise(3.5) < 1);
  let fromTop = lv.floor.y;
  let fromEdge = Infinity; // arc position of the previous ledge's far edge, in metres at R_REF
  let launch = JUMP_V;
  for (let i = 1; i < lv.route.length; i++) {
    const p = lv.route[i];
    const prev = lv.route[i - 1];
    // arc metres: the climb runs in direction DIR, so onwards is -DIR * angle
    const centre = DIR * p.a * R_REF;
    const half = p.span * R_REF;
    const sway = p.kind === 'swing' ? p.amp * R_REF : 0;
    const near = centre - half - sway;
    const gap = prev.kind === 'floor' ? 0 : near - fromEdge;
    const low = p.kind === 'lift' ? p.y - p.amp : p.y;
    const rise = low - fromTop;
    if (prev.kind !== 'floor') {
      assert.ok(gap >= 0.3, `${p.kind} #${i} gap ${gap.toFixed(2)} at ${p.y.toFixed(1)} m`);
      assert.ok(rise <= (launch > JUMP_V ? 4.3 : MAX_RISE) + 1e-6, `${p.kind} #${i} rise ${rise.toFixed(2)} at ${p.y.toFixed(1)} m`);
      assert.ok(gap <= maxGap(Math.max(0, rise), launch) + 1e-6, `${p.kind} #${i} gap ${gap.toFixed(2)} for rise ${rise.toFixed(2)} (max ${maxGap(Math.max(0, rise), launch).toFixed(2)})`);
    }
    fromTop = p.kind === 'lift' ? p.y + p.amp : p.y;
    fromEdge = centre + half + sway;
    launch = p.kind === 'spring' ? SPRING_V : JUMP_V;
    assert.ok(p.r0 >= R_CORE && p.r1 > p.r0 + 1.5, 'ledges are at least a stride deep');
  }
});

test('ledges never sit inside one another', () => {
  const lv = buildLevel();
  const ps = lv.platforms.filter((p) => p.kind !== 'floor');
  for (let i = 0; i < ps.length; i++)
    for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i];
      const b = ps[j];
      if (Math.abs(a.y - b.y) > 1.6) continue;
      const reachA = a.span + (a.kind === 'swing' ? a.amp : 0);
      const reachB = b.span + (b.kind === 'swing' ? b.amp : 0);
      assert.ok(Math.abs(angDiff(a.a, b.a)) > reachA + reachB + rad(0.25), `${a.kind} #${a.id} and ${b.kind} #${b.id} overlap at ${a.y.toFixed(1)} m`);
    }
});

test('lifts bob and swings sway inside their travel, and still ledges stay put', () => {
  const lv = buildLevel();
  const lift = lv.platforms.find((p) => p.kind === 'lift')!;
  const swing = lv.platforms.find((p) => p.kind === 'swing')!;
  const stone = lv.platforms.find((p) => p.kind === 'stone')!;
  let lo = Infinity;
  let hi = -Infinity;
  for (let t = 0; t < 20; t += 0.05) {
    const q = pose(lift, t);
    lo = Math.min(lo, q.y);
    hi = Math.max(hi, q.y);
    assert.equal(q.a, lift.a);
    const w = pose(swing, t);
    assert.ok(Math.abs(w.a - swing.a) <= swing.amp + 1e-9 && w.y === swing.y);
    const st = pose(stone, t);
    assert.ok(st.a === stone.a && st.y === stone.y && st.vy === 0 && st.va === 0);
  }
  assert.ok(Math.abs(lo - (lift.y - lift.amp)) < 0.01 && Math.abs(hi - (lift.y + lift.amp)) < 0.01);
});

test('spawn spots line the souls up along the beacon a metre apart', () => {
  const lv = buildLevel();
  const a = spawnAt(lv, 1, 0, 3);
  const b = spawnAt(lv, 1, 1, 3);
  const c = spawnAt(lv, 1, 2, 3);
  const cp = lv.checkpoints[1];
  for (const s of [a, b, c]) {
    assert.equal(s.y, cp.y);
    assert.ok(over(cp, cp.a, s.x, s.z), 'on the beacon ledge');
  }
  assert.ok(Math.abs(Math.hypot(a.x - b.x, a.z - b.z) - 1.05) < 0.05);
  assert.ok(Math.abs(Math.hypot(b.x - c.x, b.z - c.z) - 1.05) < 0.05);
});

// ---------------------------------------------------------------------------------------------------------------
// moving

test('a jump reaches its apex and lands back on the floor, and letting go early cuts it short', () => {
  const g = game(1);
  const s = g.souls[0];
  let top = 0;
  run(g, 1.5, (g, t) => {
    s.input = { ...idle, jump: t < DT, hold: true };
    top = Math.max(top, s.y);
  });
  assert.ok(Math.abs(top - jumpApex()) < 0.12, `apex ${top.toFixed(2)} vs ${jumpApex().toFixed(2)}`);
  assert.ok(s.grounded && s.y === 0);
  const ev = drain(g);
  assert.ok(ev.some((e) => e.t === 'jump') && ev.some((e) => e.t === 'land'));

  const h = game(1);
  let low = 0;
  run(h, 1.5, (h, t) => {
    h.souls[0].input = { ...idle, jump: t < DT, hold: t < 0.08 };
    low = Math.max(low, h.souls[0].y);
  });
  assert.ok(low < top * 0.75, `a tapped jump (${low.toFixed(2)}) is lower than a held one (${top.toFixed(2)})`);
});

test('nothing moves during the countdown', () => {
  const g = createGame({ mode: 'normal', souls: [spec(0)] });
  assert.equal(g.time, -COUNTDOWN);
  const x0 = g.souls[0].x;
  run(g, COUNTDOWN - 0.1, (g) => (g.souls[0].input = { side: 1, fwd: 0, jump: true, hold: true }));
  assert.equal(g.souls[0].x, x0);
  run(g, 0.5, (g) => (g.souls[0].input = { side: 1, fwd: 0, jump: false, hold: false }));
  assert.notEqual(g.souls[0].x, x0);
  assert.ok(g.events.some((e) => e.t === 'go'));
});

test('right is onwards up the climb, in is toward the core, and the core cannot be entered', () => {
  const g = game(1);
  const s = g.souls[0];
  const a0 = arcOf(s);
  run(g, 1, (g) => (g.souls[0].input = { side: 1, fwd: 0, jump: false, hold: false }));
  assert.ok(Math.sign(angDiff(arcOf(s), a0)) === DIR, 'moved in the climbing direction');
  const r0 = Math.hypot(s.x, s.z);
  run(g, 2, (g) => (g.souls[0].input = { side: 0, fwd: 1, jump: false, hold: false }));
  const r1 = Math.hypot(s.x, s.z);
  assert.ok(r1 < r0 && Math.abs(r1 - (R_CORE + SOUL_R)) < 0.01, `pressed against the core at r ${r1.toFixed(2)}`);
});

test('walking off a ledge gives a moment of coyote time, then a fall onto whatever is below', () => {
  const lv = buildLevel();
  const g = game(1, 'normal', lv);
  const s = g.souls[0];
  const ledge = lv.route[3];
  put(g, s, ledge, ledge.span * (ledge.r0 + 1.2) - 0.1);
  run(g, 0.4, (g) => (g.souls[0].input = { side: 1, fwd: 0, jump: false, hold: false }));
  assert.ok(!s.grounded || s.ground !== ledge.id, 'left the ledge');
  run(g, 3);
  assert.ok(s.grounded, 'landed again');
  assert.ok(s.y < ledge.y, 'lower down');
});

test('ledges are one way: a soul rising through one passes, a soul falling onto it lands', () => {
  const lv = buildLevel();
  const g = game(1, 'normal', lv);
  const s = g.souls[0];
  const ledge = lv.route[1];
  put(g, s, ledge);
  s.y = ledge.y - 1.2;
  s.grounded = false;
  s.ground = -1;
  s.vy = 9;
  step(g, DT);
  step(g, DT);
  assert.ok(!s.grounded && s.y > ledge.y - 1.2, 'still rising through the slab');
  run(g, 1.5);
  assert.ok(s.grounded && s.ground === ledge.id && Math.abs(s.y - ledge.y) < 1e-6, 'landed on it on the way down');
});

test('a lift carries whoever stands on it and a swing takes them round', () => {
  const lv = buildLevel();
  const g = game(1, 'normal', lv);
  const s = g.souls[0];
  const lift = lv.platforms.find((p) => p.kind === 'lift')!;
  put(g, s, lift);
  const y0 = s.y;
  run(g, lift.period / 4);
  assert.ok(s.grounded && s.ground === lift.id);
  assert.ok(Math.abs(s.y - pose(lift, g.time).y) < 1e-6 && s.y !== y0, 'rode the lift');
  const swing = lv.platforms.find((p) => p.kind === 'swing')!;
  put(g, s, swing);
  const a0 = arcOf(s);
  run(g, swing.period / 4);
  assert.ok(s.grounded && s.ground === swing.id && Math.abs(angDiff(arcOf(s), a0)) > 0.05, 'swung round with it');
});

test('a crumbling ledge shakes, drops, and comes back', () => {
  const lv = buildLevel();
  const g = game(1, 'normal', lv);
  const s = g.souls[0];
  const crumble = lv.platforms.find((p) => p.kind === 'crumble')!;
  put(g, s, crumble);
  s.y += 0.5;
  s.grounded = false;
  s.ground = -1;
  run(g, 0.6);
  assert.ok(s.grounded && s.ground === crumble.id);
  assert.equal(crumbleState(g, crumble.id).phase, 'warn');
  assert.ok(g.events.some((e) => e.t === 'crumble' && e.phase === 'warn'));
  run(g, CRUMBLE_WARN);
  assert.equal(crumbleState(g, crumble.id).phase, 'fall');
  assert.ok(!s.grounded || s.ground !== crumble.id, 'the ground gave way');
  assert.ok(g.events.some((e) => e.t === 'crumble' && e.phase === 'fall'));
  run(g, 2);
  assert.equal(crumbleState(g, crumble.id).phase, 'gone');
  run(g, CRUMBLE_BACK);
  assert.equal(crumbleState(g, crumble.id).phase, 'none');
});

test('a spring launches far higher than a jump', () => {
  const lv = buildLevel();
  const g = game(1, 'normal', lv);
  const s = g.souls[0];
  const spring = lv.platforms.find((p) => p.kind === 'spring')!;
  put(g, s, spring);
  s.y += 0.3;
  s.grounded = false;
  s.ground = -1;
  let top = 0;
  run(g, 1.6, () => (top = Math.max(top, s.y - spring.y)));
  assert.ok(g.events.some((e) => e.t === 'spring'));
  assert.ok(top > 4 && top < 5.5, `sprang ${top.toFixed(2)} m`);
});

test('ice is slippery: a soul slides much further after letting go', () => {
  const lv = buildLevel();
  const slideOn = (p: Platform) => {
    const g = game(1, 'normal', lv);
    const s = g.souls[0];
    put(g, s, p, -p.span * (p.r0 + 1.2) + 0.3);
    run(g, 0.5, (g) => (g.souls[0].input = { side: 1, fwd: 0, jump: false, hold: false }));
    const a0 = arcOf(s);
    run(g, 0.6, (g) => (g.souls[0].input = idle));
    return Math.abs(angDiff(arcOf(s), a0)) * (p.r0 + 1.2);
  };
  const ice = lv.platforms.find((p) => p.kind === 'ice' && p.span * (p.r0 + 1.2) > 1.6)!;
  const stone = lv.platforms.find((p) => p.kind === 'stone' && p.span * (p.r0 + 1.2) > 1.6)!;
  const onIce = slideOn(ice);
  const onStone = slideOn(stone);
  assert.ok(onIce > onStone * 3, `ice slide ${onIce.toFixed(2)} vs stone ${onStone.toFixed(2)}`);
});

test('the wind blows only above the cathedral, in gusts that alternate', () => {
  assert.equal(windAt(1).phase, 'calm');
  assert.equal(windAt(6).phase, 'build');
  assert.equal(windAt(7).phase, 'gust');
  assert.notEqual(windAt(7).dir, windAt(16).dir);
  const lv = buildLevel();
  const high = lv.platforms.find((p) => p.y > WIND_FROM && p.kind === 'stone')!;
  const low = lv.platforms.find((p) => p.y > 30 && p.y < 60 && p.kind === 'stone')!;
  const drift = (p: Platform) => {
    const g = game(1, 'normal', lv);
    g.time = 6.6;
    const s = g.souls[0];
    put(g, s, p);
    s.y += 0.1;
    s.grounded = false;
    s.ground = -1;
    const a0 = arcOf(s);
    run(g, 0.3);
    return Math.abs(angDiff(arcOf(s), a0));
  };
  assert.ok(drift(high) > drift(low) + 0.01, 'pushed sideways up in the stars, not down in the forge');
});

// ---------------------------------------------------------------------------------------------------------------
// the chain

test('the chain holds a hanging soul without moving the one standing', () => {
  const lv = buildLevel();
  const g = game(2, 'normal', lv);
  const [a, b] = g.souls;
  const ledge = lv.route[6];
  put(g, a, ledge, 0.8);
  put(g, b, ledge, 0.8);
  b.y -= 2;
  outTo(b, ledge.r1 + 1.2);
  b.grounded = false;
  b.ground = -1;
  const ax = a.x;
  const az = a.z;
  run(g, 8);
  assert.ok(a.grounded && a.ground === ledge.id, 'still standing');
  assert.ok(Math.hypot(a.x - ax, a.z - az) < 0.25, `held fast (moved ${Math.hypot(a.x - ax, a.z - az).toFixed(3)} m)`);
  assert.ok(!b.grounded, 'the other one hangs');
  assert.ok(b.hanging);
  const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  assert.ok(d <= CHAIN_L + 0.05, `the chain is ${d.toFixed(2)} long`);
  assert.ok(Math.abs(b.vy) < 1.5, 'and it has stopped swinging wildly');
});

test('walking away from the edge hauls a hanging soul up onto the ledge', () => {
  const lv = buildLevel();
  const g = game(2, 'normal', lv);
  const [a, b] = g.souls;
  const ledge = lv.platforms.find((p) => p.kind === 'checkpoint')!;
  put(g, a, ledge, -2.5);
  put(g, b, ledge, -2.5);
  outTo(b, ledge.r1 + 1.0);
  b.y -= 3;
  b.grounded = false;
  b.ground = -1;
  run(g, 1);
  assert.ok(!b.grounded);
  // walk along the ledge, stopping short of its far end, then wait
  run(g, 3, (g) => {
    const me = g.souls[0];
    const room = angDiff(ledge.a + DIR * ledge.span, arcOf(me)) * DIR * Math.hypot(me.x, me.z);
    me.input = { side: room > 0.7 ? 1 : 0, fwd: 0, jump: false, hold: false };
  });
  run(g, 1.5, (g) => (g.souls[0].input = idle));
  assert.ok(b.grounded && b.ground === ledge.id, 'hauled up');
  assert.ok(a.grounded && a.ground === ledge.id, 'the hauler stayed on');
});

test('a sharp fall yanks a soul standing near the edge off it, and leaves one standing well back', () => {
  const lv = buildLevel();
  const ledge = lv.platforms.find((p) => p.kind === 'checkpoint' && p.y > 40)!;
  const dropNear = (back: number) => {
    const g = game(2, 'normal', lv);
    const [a, b] = g.souls;
    put(g, a, ledge, 0);
    outTo(a, ledge.r1 + EDGE_TOL - back);
    put(g, b, ledge, 0);
    outTo(b, ledge.r1 + 1.2);
    // the chain runs from a to the rim, then down to b: start b with it just slack and falling hard
    const toRim = ledge.r1 - Math.hypot(a.x, a.z);
    b.y -= Math.sqrt(Math.max(1, (CHAIN_L - toRim - 0.5) ** 2 - 1.2 * 1.2));
    b.vy = -16;
    b.grounded = false;
    b.ground = -1;
    run(g, 1.2);
    return { g, a, b };
  };
  const near = dropNear(0.1);
  assert.ok(!near.a.grounded || near.a.ground !== ledge.id, 'pulled off the rim');
  assert.ok(near.g.events.some((e) => e.t === 'yank' || e.t === 'taut'));
  const far = dropNear(2.2);
  assert.ok(far.a.grounded && far.a.ground === ledge.id, 'held on from further back');
});

test('two souls hanging off one standing soul drag it, unless it keeps walking', () => {
  const lv = buildLevel();
  // a beacon with nothing in the drop beneath it, so both souls hang free instead of landing on a lower ledge
  const ledge = lv.checkpoints.find((p) => p.cp === 3)!;
  const hang = (walk: boolean) => {
    const g = game(3, 'normal', lv);
    const [a, b, c] = g.souls;
    put(g, a, ledge, 0);
    outTo(a, ledge.r1 - 1.0);
    for (const [s, dy] of [
      [b, -(CHAIN_L - 1.5)],
      [c, -(2 * CHAIN_L - 3)],
    ] as [Soul, number][]) {
      put(g, s, ledge, 0);
      outTo(s, ledge.r1 + 0.6);
      s.y += dy;
      s.grounded = false;
      s.ground = -1;
    }
    run(g, 4, (g) => (g.souls[0].input = walk ? { side: 0, fwd: 1, jump: false, hold: false } : idle));
    return a;
  };
  const dragged = hang(false);
  assert.ok(!dragged.grounded || dragged.ground !== ledge.id, 'two hanging souls pulled the stander off');
  const walker = hang(true);
  assert.ok(walker.grounded && walker.ground === ledge.id, 'walking inward held the ledge');
});

test('a hanging soul halves a jump, so you get your partner up first', () => {
  const lv = buildLevel();
  const ledge = lv.platforms.find((p) => p.kind === 'checkpoint')!;
  const jumpWith = (hanging: boolean) => {
    const g = game(2, 'normal', lv);
    const [a, b] = g.souls;
    put(g, a, ledge, 0);
    put(g, b, ledge, 0.9);
    if (hanging) {
      // b hangs off the outer rim with the chain over the edge just slack
      outTo(b, ledge.r1 + 0.6);
      const toRim = ledge.r1 - Math.hypot(a.x, a.z);
      b.y -= Math.sqrt(Math.max(1, (CHAIN_L - toRim - 0.3) ** 2 - 0.36));
      b.grounded = false;
      b.ground = -1;
      run(g, 1.5);
      assert.ok(!b.grounded && a.grounded, 'b hangs, a stands');
    }
    let top = a.y;
    run(g, 1.2, (g, t) => {
      g.souls[0].input = { ...idle, jump: t < DT, hold: true };
      top = Math.max(top, a.y);
    });
    return top - ledge.y;
  };
  const free = jumpWith(false);
  const loaded = jumpWith(true);
  assert.ok(free > 1.9, `a free jump rises ${free.toFixed(2)}`);
  assert.ok(loaded < free * 0.85, `a loaded jump rises ${loaded.toFixed(2)} against ${free.toFixed(2)}`);
});

test('the grip speed and chain length are what the tower was built for', () => {
  assert.ok(GRIP_V > 0.5 && GRIP_V < 3);
  assert.ok(CHAIN_L >= 5 && CHAIN_L <= 8);
});

// ---------------------------------------------------------------------------------------------------------------
// modes

test('lava only rises in Lava mode, after a head start', () => {
  assert.equal(lavaAt('normal', 100), lavaAt('normal', 0));
  assert.equal(lavaAt('beginner', 100), lavaAt('beginner', 0));
  assert.equal(lavaAt('lava', LAVA_DELAY), lavaAt('lava', 0));
  assert.ok(Math.abs(lavaAt('lava', LAVA_DELAY + 10) - (lavaAt('lava', 0) + 10 * LAVA_RISE)) < 1e-9);
  // the lava reaches the top in a few minutes: too slow is boring, too fast is impossible
  const toTop = LAVA_DELAY + (TOP - lavaAt('lava', 0)) / LAVA_RISE;
  assert.ok(toTop > 200 && toTop < 400, `lava reaches the top in ${toTop.toFixed(0)} s`);
  // one player climbing two souls takes every ledge twice, so the lava gives them longer
  const soloTop = LAVA_DELAY + (TOP - lavaAt('lava', 0, true)) / LAVA_RISE_SOLO;
  assert.ok(soloTop > toTop && soloTop < 600, `solo lava reaches the top in ${soloTop.toFixed(0)} s`);
});

test('touching lava in Lava mode loses the climb for everyone, with the height reached', () => {
  const g = game(2, 'lava');
  g.time = LAVA_DELAY + 20;
  const [a] = g.souls;
  a.best = 17;
  a.y = -3;
  a.grounded = false;
  a.ground = -1;
  step(g, DT);
  assert.ok(g.lost && g.lost.height === 17);
  assert.ok(g.events.some((e) => e.t === 'burn') && g.events.some((e) => e.t === 'lose'));
  const x = g.souls[1].x;
  run(g, 1, (g) => (g.souls[1].input = { side: 1, fwd: 0, jump: false, hold: false }));
  assert.equal(g.souls[1].x, x, 'nothing moves after the loss');
});

test('in Normal mode burning sends the team back to the floor; in Beginner, back to the last beacon', () => {
  const lv = buildLevel();
  for (const mode of ['normal', 'beginner'] as const) {
    const g = game(2, mode, lv);
    const [a, b] = g.souls;
    const beacon = lv.checkpoints[2];
    put(g, a, beacon);
    put(g, b, beacon, 1);
    g.cp = 2;
    b.y = -3;
    b.grounded = false;
    b.ground = -1;
    step(g, DT);
    assert.ok(b.burned >= 0 && g.respawn[0], 'burned and a respawn is coming');
    run(g, 1.6);
    assert.equal(b.burned, -1);
    const home = lv.checkpoints[mode === 'normal' ? 0 : 2];
    for (const s of [a, b]) {
      assert.ok(s.grounded && s.ground === home.id, `${mode}: back on ${home.kind}`);
      assert.equal(s.y, home.y);
    }
    assert.ok(g.events.some((e) => e.t === 'respawn'));
  }
});

test('Beginner sends a team that falls too far back to its beacon; Normal lets it climb back up', () => {
  const lv = buildLevel();
  const beacon = lv.checkpoints[3];
  for (const mode of ['beginner', 'normal'] as const) {
    const g = game(2, mode, lv);
    g.cp = 3;
    const [a, b] = g.souls;
    put(g, a, beacon);
    put(g, b, beacon, 1);
    a.y -= FALL_TOO_FAR + 2;
    a.grounded = false;
    a.ground = -1;
    b.y = a.y;
    b.grounded = false;
    b.ground = -1;
    run(g, 2);
    if (mode === 'beginner') assert.ok(a.ground === beacon.id && b.ground === beacon.id, 'back on the beacon');
    else assert.ok(a.y < beacon.y - 5, 'still down below');
  }
});

test('beacons light up as you pass them and the team checkpoint only moves up', () => {
  const lv = buildLevel();
  const g = game(2, 'beginner', lv);
  const [a, b] = g.souls;
  const two = lv.checkpoints[2];
  put(g, a, two);
  a.y += 0.5;
  a.grounded = false;
  a.ground = -1;
  put(g, b, two, 1);
  run(g, 0.5);
  assert.equal(g.cp, 2);
  assert.ok(g.lit[2] && !g.lit[3]);
  assert.ok(g.events.some((e) => e.t === 'checkpoint' && e.cp === 2));
  const one = lv.checkpoints[1];
  put(g, a, one);
  a.y += 0.5;
  a.grounded = false;
  a.ground = -1;
  run(g, 0.5);
  assert.equal(g.cp, 2, 'going back down does not lower it');
});

test('the climb is won when every soul stands on the top ledge, and the time stops', () => {
  const lv = buildLevel();
  const g = game(2, 'normal', lv);
  const [a, b] = g.souls;
  put(g, a, lv.goal, 0);
  put(g, b, lv.goal, 1.5);
  b.y += 1;
  b.grounded = false;
  b.ground = -1;
  g.time = 200;
  step(g, DT);
  assert.equal(g.won, null, 'not while one is still in the air');
  run(g, 1);
  assert.ok(g.won !== null && Math.abs(g.won - 200) < 1.1, `won at ${g.won}`);
  assert.ok(g.events.some((e) => e.t === 'win'));
  assert.ok(g.events.some((e) => e.t === 'zone' && e.zone === 5));
});

test('a guest never decides respawns or the result on its own, and takes the host word for them', () => {
  const lv = buildLevel();
  const g = createGame({ mode: 'beginner', souls: [spec(0, 'remote'), spec(1, 'local')], authority: false, countdown: 0, level: lv });
  const me = g.souls[1];
  me.y = -3;
  me.grounded = false;
  me.ground = -1;
  step(g, DT);
  assert.ok(me.burned >= 0 && g.respawn[0] === null, 'burned, but waiting for the host');
  scheduleRespawn(g, 0, g.time + 0.2);
  run(g, 0.5);
  assert.equal(me.burned, -1);
  assert.ok(me.grounded);
  // the remote soul follows its reports and never gets moved by our chain
  const other = g.souls[0];
  applyRemote(g, other, { x: 4, y: 30, z: 0, vx: 0, vy: 0, vz: 0, flags: 1 });
  run(g, 1);
  assert.ok(Math.abs(other.x - 4) < 0.05 && Math.abs(other.y - 30) < 0.05, 'the remote soul sits where it was reported');
  assert.ok(other.grounded);
});

test('remote burns are believed; remote finishes count toward the host calling the win', () => {
  const lv = buildLevel();
  const g = createGame({ mode: 'lava', souls: [spec(0, 'local'), spec(1, 'remote')], countdown: 0, level: lv });
  applyRemote(g, g.souls[1], { x: 4, y: 0, z: 0, vx: 0, vy: 0, vz: 0, flags: 4 });
  assert.ok(g.lost, 'a guest burning ends a Lava climb');
  const h = createGame({ mode: 'normal', souls: [spec(0, 'local'), spec(1, 'remote')], countdown: 0, level: lv });
  put(h, h.souls[0], lv.goal);
  h.time = 100;
  run(h, 0.5);
  assert.equal(h.won, null);
  applyRemote(h, h.souls[1], { x: lv.goal.r0 + 1, y: TOP, z: 0, vx: 0, vy: 0, vz: 0, flags: 1 | 2 });
  run(h, 0.5);
  assert.ok(h.won !== null);
});

test('times format as minutes, seconds and hundredths', () => {
  assert.equal(fmtTime(0), '0:00.00');
  assert.equal(fmtTime(65.432), '1:05.43');
  assert.equal(fmtTime(600.999), '10:00.99');
});

// ---------------------------------------------------------------------------------------------------------------
// the whole climb: two souls that take turns, the way a solo player swaps between them

test('a careful pair of souls can climb all the way out in Normal mode', () => {
  const { g, time } = climb('normal');
  assert.ok(g.won !== null, `never got out: reached ${Math.max(...g.souls.map((s) => s.best)).toFixed(1)} m of ${TOP}`);
  assert.ok(time < 600, `took ${fmtTime(time)}`);
  assert.ok(g.lit.every(Boolean), 'lit every beacon on the way');
  assert.equal(g.zones[0], ZONES.length - 1);
});

test('a careful pair of souls can climb out in Beginner mode without ever needing a beacon', () => {
  const { g } = climb('beginner');
  assert.ok(g.won !== null);
});

test('a careful pair of souls stays ahead of the lava', () => {
  const { g, time } = climb('lava');
  assert.ok(g.won !== null, `the lava caught them at ${g.lost?.height.toFixed(1)} m after ${fmtTime(time)}`);
  assert.ok(lavaAt('lava', time, true) < TOP - 5, `the lava was ${(TOP - lavaAt('lava', time, true)).toFixed(1)} m below the top at the finish`);
});

// ---------------------------------------------------------------------------------------------------------------
// the race: two chains on one tower

test('a race puts each team on its own chain, and a climb has one chain and one respawn', () => {
  const g = race();
  assert.deepEqual(g.chains, [[0, 1], [2, 3]]);
  assert.deepEqual(g.chain, [0, 1, 2, 3]);
  assert.equal(g.teams, 2);
  assert.deepEqual(g.respawn, [null, null]);
  assert.deepEqual(g.zones, [0, 0]);
  assert.deepEqual(chainOf(g, 3), [2, 3]);
  assert.deepEqual(g.souls.map((s) => [s.team, s.driver, s.pace]), [[0, 'human', 1], [0, 'human', 1], [1, 'human', 1], [1, 'human', 1]]);
  // teams keep chain order even when the specs interleave them
  const mixed = race({ who: [{ team: 0 }, { team: 1 }, { team: 0 }, { team: 1 }] });
  assert.deepEqual(mixed.chains, [[0, 2], [1, 3]]);
  assert.deepEqual(mixed.chain, [0, 2, 1, 3]);
  const one = game(2);
  assert.deepEqual(one.chains, [[0, 1]]);
  assert.deepEqual(one.chain, [0, 1]);
  assert.equal(one.teams, 1);
  assert.deepEqual(one.respawn, [null]);
});

test('the chain only couples a team: a soul hanging off its partner never tugs the rival chain', () => {
  const lv = buildLevel();
  const g = race({ level: lv });
  const [a, b, c, d] = g.souls;
  const ledge = lv.route[6];
  put(g, a, ledge, 0.8);
  put(g, b, ledge, 0.8);
  b.y -= 2;
  outTo(b, ledge.r1 + 1.2);
  b.grounded = false;
  b.ground = -1;
  // the other team stands on a ledge 20 m further up, well beyond the chain
  const far = lv.route.find((p) => p.kind === 'stone' && p.y > ledge.y + 20 && p.span * (p.r0 + 1.2) > 1)!;
  put(g, c, far, -0.4);
  put(g, d, far, 0.4);
  const before = [c, d].map((s) => [s.x, s.y, s.z]);
  run(g, 1);
  assert.ok(b.hanging && !b.grounded, 'b hangs off a');
  assert.ok(a.grounded && a.ground === ledge.id, 'a holds');
  assert.deepEqual([c, d].map((s) => [s.x, s.y, s.z]), before, 'the rival team did not move at all');
  assert.ok(c.grounded && d.grounded && !c.taut && !d.taut);
  assert.deepEqual(neighbours(g, 0).map((s) => s.idx), [1]);
  assert.deepEqual(neighbours(g, 1).map((s) => s.idx), [0]);
  assert.deepEqual(neighbours(g, 2).map((s) => s.idx), [3]);
});

test('the first team standing on the way out wins the race, and the tower freezes for everyone', () => {
  const lv = buildLevel();
  const g = race({ level: lv });
  const [a, , c, d] = g.souls;
  g.time = 100;
  put(g, c, lv.goal, 0);
  put(g, d, lv.goal, 1.5);
  run(g, 0.5);
  assert.ok(g.won !== null && Math.abs(g.won - 100) < 0.1, `won at ${g.won}`);
  assert.equal(g.winner, 1);
  assert.equal(teamHeight(g, 1), TOP);
  assert.ok(g.events.some((e) => e.t === 'win' && e.team === 1));
  assert.ok(g.events.some((e) => e.t === 'zone' && e.zone === 5 && e.team === 1));
  const x = a.x;
  run(g, 1, (g) => (g.souls[0].input = { side: 1, fwd: 0, jump: false, hold: false }));
  assert.equal(a.x, x, 'the other team cannot move on');
  assert.ok(g.won !== null && g.won < 100.1 && g.winner === 1, 'and the result stands');
});

test('a burned team in a race goes back to the floor on its own, and the crumbled ledges stay out', () => {
  const lv = buildLevel();
  const crumble = lv.platforms.find((p) => p.kind === 'crumble')!;
  const g = race({ level: lv });
  const [a, , c, d] = g.souls;
  const ledge = lv.route[4];
  put(g, c, ledge);
  put(g, d, ledge, 1);
  g.crumbles.set(crumble.id, g.time);
  const home = [a.x, a.y, a.z];
  d.y = -3;
  d.grounded = false;
  d.ground = -1;
  step(g, DT);
  assert.ok(d.burned >= 0 && g.events.some((e) => e.t === 'burn' && e.i === 3));
  assert.ok(g.respawn[1] && g.respawn[1].cp === 0, 'team 1 is going back to the floor');
  assert.equal(g.respawn[0], null, 'team 0 is not');
  assert.deepEqual(liveOf(g, 1), [2]);
  run(g, RESPAWN_T + 0.1);
  assert.equal(d.burned, -1);
  for (const s of [c, d]) assert.ok(s.grounded && s.ground === lv.floor.id && s.y === lv.floor.y, 'team 1 is back on the floor');
  assert.deepEqual([a.x, a.y, a.z], home, 'team 0 kept its place');
  assert.ok(g.events.some((e) => e.t === 'respawn' && e.team === 1) && !g.events.some((e) => e.t === 'respawn' && e.team === 0));
  assert.ok(g.crumbles.has(crumble.id), 'a shared ledge is not put back by a rival respawn');
  // a climb has nobody else on the tower, so its ledges come back with the team
  const h = game(2, 'normal', lv);
  h.crumbles.set(crumble.id, h.time);
  h.souls[1].y = -3;
  h.souls[1].grounded = false;
  h.souls[1].ground = -1;
  run(h, RESPAWN_T + 0.1);
  assert.equal(h.souls[1].burned, -1);
  assert.equal(h.crumbles.size, 0);
});

test('each team keeps its own circle: the rival reaching a higher one does not change yours', () => {
  const lv = buildLevel();
  const g = race({ level: lv });
  const [, , c, d] = g.souls;
  const high = lv.route.find((p) => p.kind === 'stone' && zoneIndex(p.y) === 3 && p.span * (p.r0 + 1.2) > 1)!;
  put(g, c, high, -0.4);
  put(g, d, high, 0.4);
  run(g, 0.5);
  assert.equal(g.zones[1], 3);
  assert.equal(g.zones[0], 0);
  assert.ok(g.events.some((e) => e.t === 'zone' && e.zone === 3 && e.team === 1));
  assert.ok(!g.events.some((e) => e.t === 'zone' && e.team === 0));
});

test('a race keeps the lava where it is and has no leaderboard', () => {
  assert.equal(lavaAt('race', 100), lavaAt('normal', 100));
  assert.equal(lavaAt('race', 100), lavaAt('race', 0));
  assert.ok(MODES.includes('race') && isMode('race'));
  assert.ok(!(RANKED_MODES as readonly string[]).includes('race'));
});

test('seats fill a climb in order, and a race two by two, with the shades taking an empty team', () => {
  const seating = (roster: number[], mode: Mode) => seatSouls(roster, mode).map((s) => [s.seat, s.team, s.slot, s.shade, s.second]);
  assert.deepEqual(seating([2, 0, 1], 'normal'), [
    [0, 0, 0, false, false],
    [1, 0, 1, false, false],
    [2, 0, 2, false, false],
  ]);
  assert.deepEqual(seating([0, 1, 2, 3], 'race'), [
    [0, 0, 0, false, false],
    [1, 0, 1, false, false],
    [2, 1, 0, false, false],
    [3, 1, 1, false, false],
  ]);
  // three players: the one alone on team 1 climbs both of its souls
  assert.deepEqual(seating([0, 1, 2], 'race'), [
    [0, 0, 0, false, false],
    [1, 0, 1, false, false],
    [2, 1, 0, false, false],
    [2, 1, 1, false, true],
  ]);
  assert.deepEqual(seating([0, 1], 'race'), [
    [0, 0, 0, false, false],
    [1, 0, 1, false, false],
    [-1, 1, 0, true, false],
    [-1, 1, 1, true, false],
  ]);
  assert.deepEqual(seating([0], 'race'), [
    [0, 0, 0, false, false],
    [0, 0, 1, false, true],
    [-1, 1, 0, true, false],
    [-1, 1, 1, true, false],
  ]);
  assert.deepEqual(seating([], 'race'), [
    [-1, 0, 0, true, false],
    [-1, 0, 1, true, false],
    [-1, 1, 0, true, false],
    [-1, 1, 1, true, false],
  ]);
  assert.deepEqual(seating([1, 1, 0, 0], 'race'), seating([0, 1], 'race'), 'a seat listed twice is one seat');
  assert.deepEqual(seating([0, 0, 1], 'normal'), seating([0, 1], 'normal'));
  assert.equal(seating([0, 1, 2, 3, 4], 'race').length, 4, 'a fifth seat does not climb');
});

test('four souls spawn on the floor at their own spots, a stride apart', () => {
  const g = race();
  for (const s of g.souls) assert.ok(s.grounded && s.ground === g.level.floor.id && s.y === g.level.floor.y, `soul ${s.idx} stands on the floor`);
  for (let i = 0; i < g.souls.length; i++)
    for (let j = i + 1; j < g.souls.length; j++) {
      const d = Math.hypot(g.souls[i].x - g.souls[j].x, g.souls[i].z - g.souls[j].z);
      assert.ok(d >= 0.9, `souls ${i} and ${j} are ${d.toFixed(2)} m apart`);
    }
  run(g, 0.5);
  for (const s of g.souls) assert.ok(s.grounded && s.ground === g.level.floor.id, 'and they stay there');
});

test('the even and swift shades climb out on their own', () => {
  const lv = buildLevel();
  for (const level of ['even', 'swift'] as const) {
    const g = race({ mode: 'normal', level: lv, who: pair(0, 'shade', SHADE_INFO[level].pace) });
    const shades = attachShades(g, level);
    assert.equal(shades.length, 1);
    assert.equal(g.drivers.length, 1);
    playOut(g);
    assert.ok(g.won !== null, `${level}: never got out, reached ${Math.max(...g.souls.map((s) => s.best)).toFixed(1)} m of ${TOP} by ${fmtTime(g.time)}`);
    assert.ok(g.won < 600, `${level} took ${fmtTime(g.won)}`);
  }
});

test('the shades climb out on their own at every setting, and the swift ones are quicker than the slow', () => {
  const lv = buildLevel();
  const times = {} as Record<ShadeLevel, number>;
  for (const level of SHADE_LEVELS) {
    const g = race({ mode: 'normal', level: lv, who: pair(0, 'shade', SHADE_INFO[level].pace) });
    const shades = attachShades(g, level);
    assert.equal(shades.length, 1);
    assert.equal(g.drivers.length, 1);
    playOut(g);
    assert.ok(g.won !== null, `${level}: never got out, reached ${Math.max(...g.souls.map((s) => s.best)).toFixed(1)} m of ${TOP} by ${fmtTime(g.time)}`);
    times[level] = g.won;
  }
  assert.ok(times.swift < times.slow, `swift ${fmtTime(times.swift)} against slow ${fmtTime(times.slow)}`);
});

test('shades racing shades: the swift team wins, and the same race plays out the same way twice', () => {
  const lv = buildLevel();
  const play = () => {
    const g = race({ level: lv, who: [...pair(0, 'shade', SHADE_INFO.slow.pace), ...pair(1, 'shade', SHADE_INFO.swift.pace)] });
    const shades = [createShade(g, 0, 'slow'), createShade(g, 1, 'swift')];
    while (g.won === null && g.time < 900) {
      for (const sh of shades) driveShade(g, sh, SHADE_DT);
      step(g, SHADE_DT);
    }
    return g;
  };
  const first = play();
  assert.ok(first.won !== null, `nobody got out: ${first.souls.map((s) => s.best.toFixed(1)).join(', ')} m`);
  assert.equal(first.winner, 1);
  const again = play();
  assert.equal(again.winner, first.winner);
  assert.equal(again.won, first.won);
  assert.deepEqual(
    again.souls.map((s) => [s.x, s.y, s.z]),
    first.souls.map((s) => [s.x, s.y, s.z]),
  );
});

test('a shade steers only its own chain', () => {
  const g = race({ who: [...pair(0), ...pair(1, 'shade')] });
  const held: Input = { side: 1, fwd: 0, jump: false, hold: false };
  g.souls[0].input = held;
  g.souls[1].input = { ...held };
  const before = g.souls.map((s) => s.input);
  const sh = createShade(g, 1, 'swift');
  driveShade(g, sh, SHADE_DT);
  assert.equal(g.souls[0].input, held, 'the same object, untouched');
  assert.deepEqual(g.souls[1].input, held);
  assert.ok(g.souls[2].input !== before[2] && g.souls[3].input !== before[3], 'its own souls got fresh inputs');
  // attachShades only picks up the team made of shades, and the players keep their inputs through its frames
  const shades = attachShades(g, 'even');
  assert.deepEqual(shades.map((s) => s.team), [1]);
  assert.equal(g.drivers.length, 1);
  run(g, 0.5);
  assert.ok(g.souls[0].input === held && g.souls[1].input.side === 1);
});

// ---------------------------------------------------------------------------------------------------------------
// packets

test('soul reports travel by index through host and guest packets', () => {
  const g = game(2);
  const s = g.souls[0];
  s.x = 1.23456;
  s.vy = -3.3333;
  s.grounded = false;
  s.hanging = true;
  const rep = reportOf(s);
  assert.equal(rep.i, 0);
  assert.equal(rep.x, 1.23);
  assert.equal(rep.vy, -3.33);
  assert.equal(rep.flags, 8);
  const other = reportOf(g.souls[1]);
  assert.equal(other.i, 1);
  const guest = parsePacket(JSON.parse(JSON.stringify(guestState(3, [rep, other]))));
  assert.deepEqual(guest, { k: 's', round: 3, souls: [rep, other] });
  const host = parsePacket(JSON.parse(JSON.stringify(hostState(3, 12.345, 2, 'race', 'even', [0, 1, 2], [rep, { ...other, i: 3 }]))));
  assert.ok(host && host.k === 'S');
  if (host && host.k === 'S') {
    assert.equal(host.time, 12.35);
    assert.equal(host.cp, 2);
    assert.equal(host.mode, 'race');
    assert.equal(host.shades, 'even');
    assert.deepEqual(host.roster, [0, 1, 2]);
    assert.deepEqual(host.souls, [rep, { ...other, i: 3 }]);
  }
  // an index past the last soul is dropped, a repeated index keeps the first report, and no souls is no packet
  assert.deepEqual(parsePacket(guestState(3, [{ ...rep, i: 4 }, other])), { k: 's', round: 3, souls: [other] });
  assert.deepEqual(parsePacket(guestState(3, [{ ...rep, i: -1 }, other])), { k: 's', round: 3, souls: [other] });
  assert.deepEqual(parsePacket(guestState(3, [rep, { ...other, i: 0 }])), { k: 's', round: 3, souls: [rep] });
  assert.equal(parsePacket(guestState(3, [{ ...rep, i: 4 }])), null);
  const empty = parsePacket(hostState(3, 1, 0, 'normal', 'slow', [0], [{ ...rep, i: 7 }]));
  assert.ok(empty && empty.k === 'S' && empty.souls.length === 0, 'a host packet may carry no souls');
  assert.equal(parsePacket(hostState(3, 1, 0, 'normal', 'blazing' as never, [0], [rep])), null, 'a host packet with a bad shades level is dropped');
});

test('events, results and the host pick survive the wire and bad packets are dropped', () => {
  const sent: NetEv[] = [
    { y: 'crumble', id: 14, at: 33.2 },
    { y: 'burn', i: 2 },
    { y: 'respawn', cp: 3, at: 40, team: 1 },
    { y: 'cp', cp: 2, i: 0 },
    { y: 'fell', team: 0 },
  ];
  const bad = [{ y: 'burn', i: 4 }, { y: 'fell', team: 2 }, { y: 'respawn', cp: 1, at: 5 }, { y: 'cp', cp: 1 }, { y: 'nope' }] as never[];
  const ev = parsePacket(JSON.parse(JSON.stringify(events(2, 1, [...sent, ...bad]))));
  assert.ok(ev && ev.k === 'e');
  if (ev && ev.k === 'e') {
    assert.equal(ev.o, 1);
    assert.deepEqual(ev.ev, sent);
  }
  assert.deepEqual(parsePacket(JSON.parse(JSON.stringify(endOf(5, true, 187.654, 120, 1)))), { k: 'end', round: 5, won: true, time: 187.65, height: 120, winner: 1 });
  assert.deepEqual(parsePacket(endOf(5, false, 60, 33.333)), { k: 'end', round: 5, won: false, time: 60, height: 33.33, winner: 0 });
  assert.deepEqual(parsePacket({ t: 'ch', r: 5, k: 'end', w: true, tm: 1, h: 1 }), { k: 'end', round: 5, won: true, time: 1, height: 1, winner: 0 }, 'no winner on the wire means team 0');
  assert.deepEqual(parsePacket(endOf(5, true, 1, 1, 7)), { k: 'end', round: 5, won: true, time: 1, height: 1, winner: 1 }, 'a winner past the last team is clamped');
  assert.deepEqual(parsePacket(endOf(5, false, 1, 1, -5)), { k: 'end', round: 5, won: false, time: 1, height: 1, winner: -1 });
  assert.deepEqual(parsePacket(JSON.parse(JSON.stringify(configOf(1, 'race', 'slow')))), { k: 'cfg', round: 1, mode: 'race', shades: 'slow' });
  assert.equal(parsePacket(configOf(1, 'nightmare' as never, 'even')), null);
  assert.equal(parsePacket(configOf(1, 'race', 'blazing' as never)), null, 'a cfg with a bad shades level is dropped');
  assert.equal(parsePacket({ t: 'pk', r: 1, k: 'S' }), null, 'a Palm Drive packet is not ours');
  assert.equal(parsePacket({ t: 'ch', r: 1, k: 's', so: [1, 2] }), null);
  assert.equal(parsePacket({ t: 'ch', r: 'x', k: 'end' }), null);
  assert.equal(parsePacket(null), null);
});

test('a guest clock snaps when far off and eases when close', () => {
  assert.equal(syncClock(10, 20), 20);
  assert.ok(Math.abs(syncClock(10, 10.2) - 10.02) < 1e-9);
});

// ---------------------------------------------------------------------------------------------------------------
// the soundtrack

test('every circle has a piece, in tune and on the grid', () => {
  assert.equal(SONGS.length, ZONES.length);
  assert.equal(midi('A4'), 69);
  assert.equal(midi('C4'), 60);
  assert.equal(midi('Bb3'), 58);
  assert.equal(midi('F#4'), 66);
  assert.equal(hz(69), 440);
  for (const song of SONGS) {
    assert.equal(song.length, STEPS);
    let notes = 0;
    for (const stepNotes of song)
      for (const n of stepNotes) {
        notes++;
        assert.ok(n.len > 0 && n.step >= 0 && n.step < STEPS);
        if (n.voice !== 'anvil' && n.voice !== 'crackle' && n.voice !== 'heart') assert.ok(n.midi >= 24 && n.midi <= 108, `${n.voice} ${n.midi}`);
      }
    assert.ok(notes >= 24, 'each piece has something going on');
  }
  assert.ok(BPM >= 60 && BPM <= 100, 'slow');
});

test('the sequencer schedules ahead, swaps pieces on the bar, and adds a heartbeat in danger', () => {
  const played: { voice: string; delay: number }[] = [];
  const seq = new Sequencer((n, delay) => played.push({ voice: n.voice, delay }));
  seq.tick(0, 0);
  assert.ok(played.length > 0 && played.every((p) => p.delay >= 0 && p.delay <= 0.4));
  const before = played.length;
  seq.tick(0.1, 0);
  assert.ok(played.length >= before);
  for (let t = 0.2; t < 1; t += 0.1) seq.tick(t, 0);
  seq.tick(1, 5);
  assert.equal(seq.zone, 0, 'the new piece waits for the next bar');
  for (let t = 1.1; t < 16; t += 0.1) seq.tick(t, 5);
  assert.equal(seq.zone, 5);
  played.length = 0;
  for (let t = 16; t < 20; t += 0.1) seq.tick(t, 5, 1);
  assert.ok(played.some((p) => p.voice === 'heart'));
});

// ---------------------------------------------------------------------------------------------------------------
// the dressing helpers

import { arch, box, hash, onLedge, prism, ringBand, scatter, sector, tangentFrame, tri, wedge, type RGB, type Tri } from '../src/os/arcade/games/chained/dress.ts';

const GREY: RGB = [0.5, 0.5, 0.5];
/** each triangle of a Tri: its stored normal, the normal its winding implies and its centroid */
const facesOf = (t: Tri) => {
  const faces: { nor: number[]; wind: number[]; mid: number[] }[] = [];
  for (let i = 0; i < t.pos.length; i += 9) {
    const a = t.pos.slice(i, i + 3);
    const b = t.pos.slice(i + 3, i + 6);
    const c = t.pos.slice(i + 6, i + 9);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const w = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(w[0], w[1], w[2]);
    if (l < 1e-9) continue;
    faces.push({ nor: t.nor.slice(i, i + 3), wind: w.map((x) => x / l), mid: [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3] });
  }
  return faces;
};
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** every face winds the way its normal says and looks away from the centre */
const assertOutward = (t: Tri, centre: number[], what: string, skip: (f: { nor: number[]; mid: number[] }) => boolean = () => false) => {
  const faces = facesOf(t);
  assert.ok(faces.length > 0, `${what} has faces`);
  for (const f of faces) {
    assert.ok(Math.abs(Math.hypot(...f.nor) - 1) < 1e-6, `${what} unit normal`);
    assert.ok(dot(f.nor, f.wind) > 0.999, `${what} winding agrees with its normal`);
    if (skip(f)) continue;
    const away = [f.mid[0] - centre[0], f.mid[1] - centre[1], f.mid[2] - centre[2]];
    assert.ok(dot(f.nor, away) > 1e-6, `${what} face at ${f.mid.map((v) => v.toFixed(2))} normal ${f.nor.map((v) => v.toFixed(2))} points away from the centre`);
  }
};

test('sector, box, wedge, prism and arch wind outward', () => {
  const s = tri();
  sector(s, 0.2, 1.1, 4, 6, 1, 1.6, GREY, GREY, { segs: 4 });
  // the sector's centre is a point in the middle of its arc
  const am = 0.65;
  assertOutward(s, [Math.cos(am) * 5, 1.3, Math.sin(am) * 5], 'sector');
  const dressed = tri();
  const rng = scatter(7);
  sector(dressed, 0.2, 1.1, 4, 6, 1, 1.6, GREY, GREY, { segs: 5, rough: rng, undercut: 0.12, skew: [0.02, 0.01], lip: { w: 0.2, h: 0.08, k: 1.1 }, cornerShade: 0.7, bottomBand: [0.1, 0.1, 0.1], topOf: (i) => (i % 2 ? GREY : [0.6, 0.6, 0.6]) });
  // the lip's inner face looks back across the ledge, every other face looks away from the middle
  assertOutward(dressed, [Math.cos(am) * 5, 1.3, Math.sin(am) * 5], 'dressed sector', (f) => f.mid[1] > 1.6 && Math.hypot(f.mid[0], f.mid[2]) < 5.9 && Math.abs(f.nor[1]) < 0.5);
  const b = tri();
  box(b, 1, 2, 3, 0.5, 0.3, 0.2, 0.7, GREY, GREY);
  assertOutward(b, [1, 2, 3], 'box');
  const w = tri();
  wedge(w, 0.4, 4, 4.6, 2, 0.5, 0.4, GREY);
  assertOutward(w, [Math.cos(0.4) * 4.3, 1.9, Math.sin(0.4) * 4.3], 'wedge');
  const p = tri();
  prism(p, [[-1, -1], [-1, 1], [1, 1], [1, -1]], 0, 2, GREY, GREY);
  assertOutward(p, [0, 1, 0], 'prism');
  const pt = tri();
  prism(pt, [[0, -1], [-1, 1], [1, 1]], 0, 1, GREY, GREY);
  assertOutward(pt, [0, 0.5, 0.3], 'triangular prism');
  const a = tri();
  arch(a, 2, 1, -3, 0.9, 1.2, 1.5, 0.12, 6, GREY);
  const faces = facesOf(a);
  assert.ok(faces.length >= 2 * 6 * 4 * 2, 'four faces per arc step');
  for (const f of faces) assert.ok(dot(f.nor, f.wind) > 0.999, 'arch winding agrees with its normal');
  // every face looks the way its class says: the extrados away from its arc centre, the intrados toward it, the
  // front and back out of the plane on their own side
  const yaw = 0.9;
  const U = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const N = [Math.sin(yaw), 0, Math.cos(yaw)];
  const aw = 1.2;
  const ah = 1.5;
  const R = (aw * aw * 0.25 + ah * ah) / aw;
  const d = R - aw / 2;
  const checked = { ext: 0, int: 0, side: 0 };
  for (const f of faces) {
    const rel = [f.mid[0] - 2, f.mid[1] - 1, f.mid[2] + 3];
    const u = dot(rel, U);
    const n = dot(rel, N);
    if (Math.abs(f.nor[1]) > 0.99) continue;
    if (Math.abs(dot(f.nor, N)) > 0.99) {
      assert.ok(dot(f.nor, N) * n > 0, `arch side face at ${f.mid.map((v) => v.toFixed(2))} looks out of the plane`);
      checked.side++;
      continue;
    }
    const cu = u < 0 ? d : -d;
    const du = u - cu;
    const rho = Math.hypot(du, rel[1]);
    const e = [(U[0] * du) / rho, rel[1] / rho, (U[2] * du) / rho];
    const along = dot(f.nor, e);
    if (rho > R + 0.03) {
      assert.ok(along > 0.9, `arch extrados at ${f.mid.map((v) => v.toFixed(2))} normal ${f.nor.map((v) => v.toFixed(2))}`);
      checked.ext++;
    } else if (rho < R - 0.03) {
      assert.ok(along < -0.9, `arch intrados at ${f.mid.map((v) => v.toFixed(2))} normal ${f.nor.map((v) => v.toFixed(2))}`);
      checked.int++;
    }
  }
  assert.ok(checked.ext >= 12 && checked.int >= 12 && checked.side >= 24, `arch faces checked ${JSON.stringify(checked)}`);
  // the feet stand on the line through the centre and the apex is h above it
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 1; i < a.pos.length; i += 3) {
    lo = Math.min(lo, a.pos[i]);
    hi = Math.max(hi, a.pos[i]);
  }
  assert.ok(Math.abs(lo - 1) < 1e-9 && hi > 2.4 && hi < 2.7, `arch spans ${lo}..${hi}`);
});

test('a rough lipped sector keeps its inner radius exact and the walkable top level enough', () => {
  const t = tri();
  const rng = scatter(3);
  sector(t, -0.5, 0.5, 4, 6, 1, 1.6, GREY, GREY, { segs: 6, rough: rng, lip: { w: 0.25, h: 0.1, k: 1.1 }, undercut: 0.1 });
  let inner = 0;
  let maxTop = -Infinity;
  for (let i = 0; i < t.pos.length; i += 3) {
    const r = Math.hypot(t.pos[i], t.pos[i + 2]);
    assert.ok(r > 4 - 1e-9, 'nothing inside the inner radius');
    if (Math.abs(r - 4) < 1e-9) inner++;
    if (r < 5.6) maxTop = Math.max(maxTop, t.pos[i + 1]);
    assert.ok(r < 6.15, 'the rim jitters at most 0.14 m out');
  }
  assert.ok(inner >= 6 * 4, 'the inner edge sits exactly on r0');
  assert.ok(maxTop <= 1.6 + 0.03 + 1e-9, 'the walkable top jitters at most 0.03 m');
});

test('ringBand covers the whole ring without end caps', () => {
  const t = tri();
  ringBand(t, 3, 4, 0, 0.5, GREY, GREY, 24);
  const half = tri();
  sector(half, 0, Math.PI, 3, 4, 0, 0.5, GREY, GREY, { segs: 12 });
  // a full ring is two halves minus the four end faces (each two triangles of three vertices)
  assert.equal(t.pos.length, half.pos.length * 2 - 4 * 2 * 3 * 3);
  let seen = 0;
  for (let k = 0; k < 24; k++) {
    const a = ((k + 0.5) / 24) * Math.PI * 2;
    const x = Math.cos(a) * 3.5;
    const z = Math.sin(a) * 3.5;
    let near = false;
    for (let i = 0; i < t.pos.length && !near; i += 3) near = Math.hypot(t.pos[i] - x, t.pos[i + 2] - z) < 0.8;
    if (near) seen++;
  }
  assert.equal(seen, 24, 'stone all the way round');
  assertOutward(t, [0, 0.25, 0], 'ring band', (f) => Math.abs(f.nor[1]) < 0.5 && Math.hypot(f.mid[0], f.mid[2]) < 3.5);
});

test('hash is deterministic and in 0..1', () => {
  const seen = new Set<number>();
  for (let i = -5; i < 40; i++)
    for (let j = -5; j < 40; j++) {
      const h = hash(i, j);
      assert.equal(h, hash(i, j));
      assert.ok(h >= 0 && h < 1);
      seen.add(h);
    }
  assert.ok(seen.size > 1900, 'spread out');
  assert.notEqual(hash(1, 2), hash(2, 1));
});

test('onLedge stays inside the ledge and tangentFrame is an orthonormal frame', () => {
  const level = buildLevel(11);
  const rng = scatter(5);
  for (const p of level.platforms) {
    for (let k = 0; k < 8; k++) {
      const s = onLedge(p, rng);
      assert.equal(s.y, p.y);
      assert.ok(s.r >= p.r0 && s.r <= p.r1, `r ${s.r} within ${p.r0}..${p.r1}`);
      assert.ok(Math.abs(s.a - p.a) <= p.span * 0.8 + 1e-9);
      assert.ok(Math.abs(Math.hypot(s.x, s.z) - s.r) < 1e-9);
      const tight = onLedge(p, rng, { rIn: 0.1, rOut: 0.1, spanK: 0.5 });
      assert.ok(tight.r >= p.r0 + 0.1 - 1e-9 && tight.r <= p.r1 - 0.1 + 1e-9);
      assert.ok(Math.abs(tight.a - p.a) <= p.span * 0.5 + 1e-9);
    }
  }
  for (const a of [0, 0.7, 2.5, -1.3, 7]) {
    const f = tangentFrame(a);
    for (const v of [f.out, f.tan, f.up]) assert.ok(Math.abs(Math.hypot(...v) - 1) < 1e-9);
    assert.ok(Math.abs(dot(f.out, f.tan)) < 1e-9 && Math.abs(dot(f.out, f.up)) < 1e-9 && Math.abs(dot(f.tan, f.up)) < 1e-9);
    // tan points along the growing angle
    const ahead = [Math.cos(a + 0.01), 0, Math.sin(a + 0.01)];
    assert.ok(dot(ahead, f.tan) > 0);
  }
});
