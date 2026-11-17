import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RESULT_SECS, bearingTo, compassOffset, headingOf, mapToWorld, milestone, milestoneText, nearestOnCircle, newTally, placeBonus, placeLabels, royaleResult, tallyKill, topGun, worldToMap, zoneGuide, zoneLabel } from '../src/os/arcade/games/ridgeline/hud-royale-math.ts';
import { createMatch, idleInput, step, viewDir, type Kill } from '../src/os/arcade/games/ridgeline/match.ts';
import { ROYALE_PLAYERS, ZONES, type ZonePhase } from '../src/os/arcade/games/ridgeline/royale.ts';
import { worldFor, yawTo } from '../src/os/arcade/games/ridgeline/world.ts';

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

test('royale hud: the compass reads the game\'s own heading (0 north, -z; 90 east, +x) and wraps round 0', () => {
  assert.ok(near(headingOf(0), 0));
  assert.ok(near(headingOf(-Math.PI / 2), 90));
  assert.ok(near(headingOf(Math.PI / 2), 270));
  assert.ok(near(headingOf(Math.PI), 180));
  assert.ok(near(bearingTo(0, 0, 0, -10), 0), 'north is -z');
  assert.ok(near(bearingTo(0, 0, 10, 0), 90), 'east is +x');
  assert.ok(near(bearingTo(5, 5, 5, 15), 180));
  assert.ok(near(bearingTo(0, 0, -3, 0), 270));
  // the way a view faces (viewDir) has the bearing of that view's heading, and yawTo agrees
  for (let k = 0; k < 64; k++) {
    const yaw = -7 + k * 0.23;
    const d = viewDir(yaw, 0);
    assert.ok(near(compassOffset(bearingTo(0, 0, d.x, d.z), headingOf(yaw)), 0, 1e-6), `yaw ${yaw}`);
    assert.ok(near(compassOffset(headingOf(yawTo(d.x, d.z)), headingOf(yaw)), 0, 1e-6));
  }
  // the offset from where you face: left negative, right positive, across 359 to 0 both ways
  assert.ok(near(compassOffset(359, 0), -1));
  assert.ok(near(compassOffset(0, 359), 1));
  assert.ok(near(compassOffset(1, 359), 2));
  assert.ok(near(compassOffset(350, 10), -20));
  assert.ok(near(compassOffset(90, 0), 90));
  assert.ok(near(compassOffset(270, 0), -90));
  assert.ok(Math.abs(compassOffset(180, 0)) === 180);
  assert.ok(near(compassOffset(720 + 30, -330), 0));
  // turning right (the yaw going down) moves something straight ahead to the left of the middle
  const ahead = bearingTo(0, 0, 0, -1);
  assert.ok(compassOffset(ahead, headingOf(-0.2)) < 0);
});

test('royale hud: a point on the big map goes to the land and back, the inverse of how the map is drawn', () => {
  const span = worldFor('vale', true).minimap.span;
  // as hud.tsx draws the big map on its canvas (centred on 0, the whole span), shown at another size on screen
  const size = 360;
  const scale = size / (2 * span);
  const toX = (x: number) => x * scale + size / 2;
  const toY = (z: number) => z * scale + size / 2;
  const shown = 611;
  for (const [x, z] of [
    [0, 0],
    [-span, -span],
    [span, span],
    [123.4, -250.5],
    [-77, 310],
  ]) {
    const cssX = (toX(x) * shown) / size;
    const cssY = (toY(z) * shown) / size;
    const w = mapToWorld(cssX, cssY, shown, shown, span);
    assert.ok(near(w.x, x, 1e-6) && near(w.z, z, 1e-6), `${x}, ${z}`);
    const back = worldToMap(w.x, w.z, shown, shown, span);
    assert.ok(near(back.x, cssX, 1e-6) && near(back.y, cssY, 1e-6));
  }
  // the top of the map is north (-z), its left west (-x)
  assert.ok(mapToWorld(0, 0, 500, 500, span).z < 0 && mapToWorld(0, 0, 500, 500, span).x < 0);
});

test('royale hud: how far the next circle is, and whether a run gets you in before it closes', () => {
  const at = (over: Partial<{ i: number; t: number; shrinking: boolean; nx: number; nz: number; nr: number }>) => ({ i: 0, t: 30, shrinking: false, nx: 100, nz: 0, nr: 50, ...over });
  // inside: nothing to go, never late
  let g = zoneGuide(at({}), ZONES, 110, 10, 5.8);
  assert.equal(g.toNext, 0);
  assert.equal(g.late, false);
  assert.equal(g.phase, 1);
  assert.equal(g.phases, ZONES.length);
  // 250 m from the middle: 200 m out; holding, the time left is the wait and the whole closing
  g = zoneGuide(at({}), ZONES, -150, 0, 5.8);
  assert.ok(near(g.toNext, 200));
  assert.ok(near(g.left, 30 + ZONES[0].shrink));
  assert.equal(g.late, 200 / 5.8 > 30 + ZONES[0].shrink);
  // closing: only what is left of it
  g = zoneGuide(at({ shrinking: true, t: 12 }), ZONES, -150, 0, 5.8);
  assert.ok(near(g.left, 12));
  assert.equal(g.late, true, '200 m in 12 s is too far');
  g = zoneGuide(at({ shrinking: true, t: 12 }), ZONES, 40, 0, 5.8);
  assert.ok(near(g.toNext, 10));
  assert.equal(g.late, false, '10 m in 12 s is fine');
  // much faster (a vehicle), not late; in the air never
  assert.equal(zoneGuide(at({ shrinking: true, t: 12 }), ZONES, -150, 0, 25).late, false);
  assert.equal(zoneGuide(at({ shrinking: true, t: 12 }), ZONES, -150, 0, Infinity).late, false);
  // a circle closed to nothing: the distance to its middle
  assert.ok(near(zoneGuide(at({ i: ZONES.length - 1, nr: 0 }), ZONES, 103, 4, 5.8).toNext, 5));
  // all closed: the last phase of however many there are, nothing more to reach
  g = zoneGuide(at({ i: ZONES.length }), ZONES, -900, 0, 5.8);
  assert.deepEqual([g.phase, g.phases, g.toNext, g.late], [ZONES.length, ZONES.length, 0, false]);
  // whatever the table's length (six phases or seven)
  const seven: ZonePhase[] = [120, 65, 50, 45, 40, 30, 20].map((wait, i) => ({ wait, shrink: 30, r: [250, 165, 105, 62, 34, 16, 0][i], dps: i + 1 }));
  g = zoneGuide(at({ i: 6 }), seven, 0, 0, 5.8);
  assert.deepEqual([g.phase, g.phases], [7, 7]);
  assert.equal(zoneLabel(g.phase, g.phases, false, false), 'zone 7 of 7, holds');
  assert.equal(zoneLabel(3, 7, true, false), 'zone 3 of 7, closing');
  assert.equal(zoneLabel(7, 7, false, true), 'zone closed');
  // the minimap's line ends on the circle's edge, the point nearest you
  const p = nearestOnCircle(-150, 0, 100, 0, 50);
  assert.ok(near(p.x, 50) && near(p.z, 0));
  const q = nearestOnCircle(100, 300, 100, 0, 50);
  assert.ok(near(q.x, 100) && near(q.z, 50));
  assert.deepEqual(nearestOnCircle(7, 7, 3, 4, 0), { x: 3, z: 4 });
});

test('royale hud: the players left get a banner at 50, 25, 10, 5 and 2, each once', () => {
  assert.equal(milestone(51, 50), 50);
  assert.equal(milestone(50, 49), null);
  assert.equal(milestone(100, 100), null);
  assert.equal(milestone(27, 24), 25);
  assert.equal(milestone(12, 4), 5, 'several at once: the smallest');
  assert.equal(milestone(3, 2), 2);
  assert.equal(milestone(2, 1), null);
  const seen: number[] = [];
  let prev = 100;
  for (const now of [100, 99, 80, 51, 50, 50, 49, 30, 26, 25, 11, 10, 9, 6, 5, 4, 3, 2, 1]) {
    const n = milestone(prev, now);
    if (n) seen.push(n);
    prev = now;
  }
  assert.deepEqual(seen, [50, 25, 10, 5, 2]);
  for (const n of [50, 25, 10, 5, 2]) {
    const t = milestoneText(n);
    assert.ok(t.title && t.sub);
    assert.ok(!/\u2014/.test(t.title + t.sub));
  }
});

test('royale hud: your knockouts tallied from the kill events, for the result panel', () => {
  const me = 0;
  const t = newTally();
  const events: [Pick<Kill, 'killer' | 'victim' | 'w' | 'head'>, number][] = [
    [{ killer: 0, victim: 5, w: 'kestrel', head: false }, 22.4],
    [{ killer: 3, victim: 9, w: 'longbow', head: true }, 300],
    [{ killer: 0, victim: 7, w: 'longbow', head: true }, 141.6],
    [{ killer: 0, victim: 8, w: 'frag', head: false }, 9],
    [{ killer: 0, victim: 11, w: 'kestrel', head: true }, 12],
    [{ killer: 0, victim: 0, w: 'frag', head: false }, 0],
    [{ killer: -1, victim: 12, w: 'zone', head: false }, NaN],
  ];
  const counted = events.map(([k, d]) => tallyKill(t, k, me, d));
  assert.deepEqual(counted, [true, false, true, true, true, false, false]);
  assert.equal(t.kills, 4);
  assert.equal(t.heads, 2);
  assert.ok(near(t.longest, 141.6));
  assert.equal(topGun(t), 'kestrel', 'two kills with the Kestrel; the frag is no gun');
  assert.equal(t.guns.get('longbow'), 1);
  // a tie goes to the gun that got there first
  const tie = newTally();
  tallyKill(tie, { killer: 0, victim: 1, w: 'wasp', head: false }, 0, 5);
  tallyKill(tie, { killer: 0, victim: 2, w: 'lancer', head: false }, 0, 5);
  assert.equal(topGun(tie), 'wasp');
  assert.equal(topGun(newTally()), null);
});

test('royale hud: the result panel has the numbers the game over card gets', () => {
  const actor = (o: Partial<{ alive: boolean; place: number; kills: number; damage: number; cs: number; deathT: number }>) => ({ alive: false, place: 2, kills: 0, damage: 0, cs: 0, deathT: 0, ...o });
  const t = newTally();
  tallyKill(t, { killer: 0, victim: 3, w: 'talon', head: true }, 0, 61.2);
  // offline, knocked out 17th: the match is over and the place bonus is already in the score
  const bonus17 = placeBonus(17, ROYALE_PLAYERS);
  const lost = royaleResult({ me: 0, time: 400, phase: 'over', actors: [actor({ place: 17, kills: 1, damage: 212.6, cs: 1000 + bonus17, deathT: 371.4 }), actor({ alive: true })] }, t, ROYALE_PLAYERS);
  assert.deepEqual(
    { won: lost.won, place: lost.place, total: lost.total, kills: lost.kills, damage: lost.damage, heads: lost.heads, longest: lost.longest, time: lost.time, gun: lost.gun, score: lost.score, combat: lost.combat, bonus: lost.bonus },
    { won: false, place: 17, total: 2, kills: 1, damage: 213, heads: 1, longest: 61, time: 371.4, gun: 'Talon', score: 1000 + bonus17, combat: 1000, bonus: bonus17 },
  );
  // the last one standing
  const won = royaleResult({ me: 0, time: 612, phase: 'over', actors: [actor({ alive: true, place: 1, cs: 2400 + placeBonus(1, ROYALE_PLAYERS) }), actor({ place: 2 })] }, newTally(), ROYALE_PLAYERS);
  assert.equal(won.won, true);
  assert.equal(won.place, 1);
  assert.equal(won.time, 612);
  assert.equal(won.combat, 2400);
  assert.equal(won.bonus, ROYALE_PLAYERS * 12 + 600);
  assert.equal(won.gun, null);
  // online, out while the others play on: the bonus is not in yet, the score shows what it will be
  const out = royaleResult({ me: 0, time: 300, phase: 'live', actors: [actor({ place: 40, cs: 500, deathT: 280 }), actor({ alive: true })] }, newTally(), ROYALE_PLAYERS);
  assert.equal(out.score, 500 + placeBonus(40, ROYALE_PLAYERS));
  assert.equal(out.combat, 500);
  assert.ok(RESULT_SECS >= 3 && RESULT_SECS <= 6);
});

test('royale hud: the place bonus is the one the match adds at the end', () => {
  const m = createMatch(worldFor('vale', true), 'royale', 'normal', { seed: 3 });
  const you = m.actors[m.me];
  you.cs = 0;
  // everyone else out at once: you are the last one standing
  for (const a of m.actors) if (a !== you) a.alive = false;
  m.alive = 1;
  step(m, 1 / 60, idleInput());
  assert.equal(m.phase, 'over');
  assert.equal(you.place, 1);
  const r = royaleResult(m, newTally(), ROYALE_PLAYERS);
  assert.equal(r.won, true);
  assert.equal(Math.round(you.cs), placeBonus(1, ROYALE_PLAYERS));
  assert.equal(r.combat, 0);
  assert.equal(r.score, Math.max(1, Math.round(you.cs)));
});

test('royale hud: town names on the big map never sit on each other', () => {
  const items = [
    { x: 100, y: 100, w: 60, h: 11 },
    { x: 110, y: 102, w: 60, h: 11 },
    { x: 105, y: 99, w: 60, h: 11 },
    { x: 300, y: 300, w: 40, h: 11 },
    { x: 102, y: 101, w: 60, h: 11 },
    { x: 101, y: 100, w: 60, h: 11 },
    { x: 100, y: 101, w: 60, h: 11 },
  ];
  const at = placeLabels(items);
  assert.deepEqual(at[0], { x: 100, y: 100 }, 'the first goes where it is');
  assert.deepEqual(at[3], { x: 300, y: 300 });
  const boxes = at.map((p, i) => (p ? { x0: p.x - items[i].w / 2, x1: p.x + items[i].w / 2, y0: p.y - items[i].h / 2, y1: p.y + items[i].h / 2 } : null)).filter((b) => !!b);
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      assert.ok(!(a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0), `labels ${i} and ${j} overlap`);
    }
  assert.ok(at.some((p) => p === null), 'one with no room left is left off');
  // a real royale world: every town in the arena is a candidate, and the ones placed keep apart
  const w = worldFor('vale', true);
  const towns = w.towns.filter((t) => Math.abs(t.x) <= w.arena && Math.abs(t.z) <= w.arena);
  assert.ok(towns.length >= 10);
  const placed = placeLabels(towns.map((t) => ({ x: ((t.x + w.minimap.span) / (2 * w.minimap.span)) * 360, y: ((t.z + w.minimap.span) / (2 * w.minimap.span)) * 360, w: t.name.length * 5.5, h: 11 })));
  assert.ok(placed.filter((p) => p).length >= towns.length - 3, 'nearly all named');
});
