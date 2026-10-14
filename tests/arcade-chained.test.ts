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
  WIND_FROM,
  applyRemote,
  createGame,
  crumbleState,
  fmtTime,
  lavaAt,
  over,
  scheduleRespawn,
  step,
  windAt,
  type Game,
  type Input,
  type Soul,
} from '../src/os/arcade/games/chained/logic.ts';
import { configOf, endOf, events, guestState, hostState, parsePacket, reportOf, syncClock } from '../src/os/arcade/games/chained/net.ts';
import { BPM, SONGS, STEPS, Sequencer, hz, midi } from '../src/os/arcade/games/chained/music.ts';
import { climb } from './chained-bot.ts';

const DT = 1 / 60;
const idle: Input = { side: 0, fwd: 0, jump: false, hold: false };
const spec = (seat: number, kind: 'local' | 'remote' = 'local') => ({ seat, name: `p${seat}`, color: '#fff', kind });

/** A game past the countdown with n local souls. */
function game(n = 2, mode: 'normal' | 'beginner' | 'lava' = 'normal', level?: Level): Game {
  return createGame({ mode, souls: Array.from({ length: n }, (_, i) => spec(i)), countdown: 0, level });
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
  const near = dropNear(0.25);
  assert.ok(!near.a.grounded || near.a.ground !== ledge.id, 'pulled off the rim');
  assert.ok(near.g.events.some((e) => e.t === 'yank' || e.t === 'taut'));
  const far = dropNear(2.2);
  assert.ok(far.a.grounded && far.a.ground === ledge.id, 'held on from further back');
});

test('two souls hanging off one standing soul drag it, unless it keeps walking', () => {
  const lv = buildLevel();
  const ledge = lv.platforms.find((p) => p.kind === 'checkpoint')!;
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
    assert.ok(b.burned >= 0 && g.respawn, 'burned and a respawn is coming');
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
  assert.ok(me.burned >= 0 && g.respawn === null, 'burned, but waiting for the host');
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
  assert.equal(g.zone, ZONES.length - 1);
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
// packets

test('soul reports round trip through host and guest packets', () => {
  const g = game(2);
  const s = g.souls[0];
  s.x = 1.23456;
  s.vy = -3.3333;
  s.grounded = false;
  s.hanging = true;
  const rep = reportOf(s);
  assert.equal(rep.x, 1.23);
  assert.equal(rep.vy, -3.33);
  assert.equal(rep.flags, 8);
  const guest = parsePacket(JSON.parse(JSON.stringify(guestState(3, rep))));
  assert.deepEqual(guest, { k: 's', round: 3, soul: rep });
  const host = parsePacket(JSON.parse(JSON.stringify(hostState(3, 12.345, 2, 'lava', [0, 1, 2], [{ seat: 0, ...rep }, { seat: 2, ...reportOf(g.souls[1]) }]))));
  assert.ok(host && host.k === 'S');
  if (host && host.k === 'S') {
    assert.equal(host.time, 12.35);
    assert.equal(host.cp, 2);
    assert.equal(host.mode, 'lava');
    assert.deepEqual(host.roster, [0, 1, 2]);
    assert.equal(host.souls.length, 2);
    assert.equal(host.souls[1].seat, 2);
    assert.deepEqual(host.souls[0], { seat: 0, ...rep });
  }
});

test('events, results and the host pick survive the wire and bad packets are dropped', () => {
  const ev = parsePacket(JSON.parse(JSON.stringify(events(2, 1, [{ y: 'crumble', id: 14, at: 33.2 }, { y: 'burn' }, { y: 'respawn', cp: 3, at: 40 }, { y: 'cp', cp: 2 }, { y: 'fell' }, { y: 'nope' } as never]))));
  assert.ok(ev && ev.k === 'e');
  if (ev && ev.k === 'e') {
    assert.equal(ev.o, 1);
    assert.deepEqual(ev.ev, [{ y: 'crumble', id: 14, at: 33.2 }, { y: 'burn' }, { y: 'respawn', cp: 3, at: 40 }, { y: 'cp', cp: 2 }, { y: 'fell' }]);
  }
  assert.deepEqual(parsePacket(JSON.parse(JSON.stringify(endOf(5, true, 187.654, 120)))), { k: 'end', round: 5, won: true, time: 187.65, height: 120 });
  assert.deepEqual(parsePacket(JSON.parse(JSON.stringify(configOf(1, 'beginner')))), { k: 'cfg', round: 1, mode: 'beginner' });
  assert.equal(parsePacket(configOf(1, 'nightmare' as never)), null);
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
