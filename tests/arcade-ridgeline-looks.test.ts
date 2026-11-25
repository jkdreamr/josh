import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { LOOK_IDS, LOOK_WEIGHTS, lookOf, lookRoll, seedFor, withLook, type LookId, type SkyChoice } from '../src/os/arcade/games/ridgeline/looks.ts';
import { MAPS, MAP_IDS } from '../src/os/arcade/games/ridgeline/maps.ts';
import { LOOK_SKIES } from '../src/os/arcade/games/ridgeline/gfx/sky.ts';
import { createMatch, idleInput, step, type Match } from '../src/os/arcade/games/ridgeline/match.ts';
import { Session, type OnlineApi } from '../src/os/arcade/games/ridgeline/online.ts';
import { buildWorld, sunDir, worldFor } from '../src/os/arcade/games/ridgeline/world.ts';
import { relight } from '../src/os/arcade/games/ridgeline/relight.ts';

const CHOICES: SkyChoice[] = ['auto', 'day', 'dusk', 'overcast'];

test('looks: the same seed always gives the same look, and the looks come up about half, a quarter and a quarter', () => {
  const n = 20000;
  const count: Record<LookId, number> = { day: 0, dusk: 0, overcast: 0 };
  for (let i = 0; i < n; i++) {
    const seed = (i * 2654435761) >>> 0;
    const a = lookOf('royale', seed, 'auto', MAPS.vale);
    assert.equal(lookOf('royale', seed, 'auto', MAPS.vale), a);
    count[a]++;
    const r = lookRoll(seed);
    assert.ok(r >= 0 && r < 1);
  }
  for (const id of LOOK_IDS) assert.ok(Math.abs(count[id] / n - LOOK_WEIGHTS[id]) < 0.02, `${id}: ${count[id] / n}`);
  // neighbouring seeds do not all pick alike
  const firsts = new Set(Array.from({ length: 16 }, (_, i) => lookOf('royale', 1000 + i, 'auto', MAPS.mesa)));
  assert.equal(firsts.size, 3);
});

test('looks: breach and deathmatch always play by day, whatever the seed or the Sky setting', () => {
  for (const mode of ['breach', 'dm'])
    for (const choice of CHOICES)
      for (let seed = 0; seed < 300; seed++) for (const id of MAP_IDS) assert.equal(lookOf(mode, seed * 7919, choice, MAPS[id]), 'day');
});

test('looks: the Sky setting forces a look in a royale, and a seed without a match or a missing recipe means day', () => {
  for (const id of MAP_IDS)
    for (let seed = 0; seed < 50; seed++) {
      assert.equal(lookOf('royale', seed, 'day', MAPS[id]), 'day');
      assert.equal(lookOf('royale', seed, 'dusk', MAPS[id]), 'dusk');
      assert.equal(lookOf('royale', seed, 'overcast', MAPS[id]), 'overcast');
    }
  assert.equal(lookOf('royale', undefined, 'auto', MAPS.vale), 'day');
  assert.equal(lookOf('royale', 5, 'dusk', { looks: undefined }), 'day');
  assert.equal(lookOf('royale', 5, 'overcast', { looks: { dusk: MAPS.vale.looks!.dusk } }), 'day');
});

test('looks: the online host carries its Sky choice in the seed, so a guest reading the seed alone gets the same look', () => {
  for (const choice of CHOICES)
    for (let k = 0; k < 200; k++) {
      const seed = (k * 40503 + 17) >>> 0;
      const s = seedFor(seed, choice);
      if (choice === 'auto') assert.equal(s, seed);
      else assert.equal(lookOf('royale', s, 'auto', MAPS.isles), choice);
    }
});

test('looks: each map has a dusk and an overcast recipe and photo, and a look swaps only the light, sky, haze and grade', () => {
  for (const id of MAP_IDS) {
    const def = MAPS[id];
    assert.equal(withLook(def, 'day'), def);
    for (const look of ['dusk', 'overcast'] as const) {
      const l = def.looks?.[look];
      assert.ok(l, `${id} ${look}`);
      assert.ok(LOOK_SKIES[id][look].src.endsWith('_puresky'));
      const d = withLook(def, look);
      assert.equal(d.sun, l.sun);
      assert.equal(d.sky, l.sky);
      assert.equal(d.fog, l.fog);
      assert.equal(d.grade, l.grade);
      assert.equal(d.ambient, l.ambient);
      for (const k of Object.keys(def) as (keyof typeof def)[]) if (!['sun', 'sky', 'fog', 'ambient', 'grade'].includes(k)) assert.equal(d[k], def[k], k);
      assert.ok(l.sun.el > 0 && l.sun.el < 90 && l.sun.intensity > 0 && l.ambient > 0 && l.grade.exposure > 0.8 && l.grade.exposure < 2.5);
      // an overcast keeps the map's own sun where it is (its far shadows stay the baked ones), only dimmed
      if (look === 'overcast') {
        assert.equal(l.sun.az, def.sun.az);
        assert.equal(l.sun.el, def.sun.el);
        assert.ok(l.sun.intensity < def.sun.intensity / 2);
      }
    }
  }
});

test('looks: a royale keeps its seed, the same on host and guest, and a breach match has none', () => {
  const world = worldFor('vale', true);
  const a = createMatch(world, 'royale', 'normal', { seed: 4242 });
  const b = createMatch(world, 'royale', 'normal', { seed: 4242 });
  assert.equal(a.seed, 4242);
  assert.equal(lookOf(a.mode, a.seed, 'auto', world.def), lookOf(b.mode, b.seed, 'auto', world.def));
  const solo = createMatch(world, 'royale', 'normal');
  assert.equal(typeof solo.seed, 'number');
  const breach = createMatch(worldFor('vale'), 'breach', 'normal', { seed: 4242 });
  assert.equal(breach.seed, undefined);
  assert.equal(lookOf(breach.mode, breach.seed, 'dusk', worldFor('vale').def), 'day');
});

/** Two machines on one line, every message arriving next frame. */
function pair(hostSky: SkyChoice, guestSky: SkyChoice) {
  const handlers: { seat: number; fn: (from: number, d: unknown) => void }[] = [];
  let q: { from: number; to: number; d: string }[] = [];
  const players = [
    { seat: 0, name: 'H' },
    { seat: 1, name: 'G' },
  ];
  const api = (seat: number): OnlineApi => ({
    seat,
    isHost: seat === 0,
    round: 1,
    players,
    send(d, opts) {
      const to = opts?.to !== undefined ? [opts.to] : seat === 0 ? [1] : [0];
      for (const t of to) q.push({ from: seat, to: t, d: JSON.stringify(d) });
    },
    onMessage(fn) {
      handlers.push({ seat, fn });
      return () => {};
    },
  });
  let time = 0;
  const host = new Session(api(0), { mode: 'royale', map: 'vale', level: 'normal', now: () => time, sky: hostSky });
  const guest = new Session(api(1), { mode: 'royale', map: 'vale', level: 'normal', now: () => time, sky: guestSky });
  const world = worldFor('vale', true);
  for (let i = 0; i < 240 && !(host.match && guest.match); i++) {
    time += 1 / 30;
    const due = q;
    q = [];
    for (const x of due) for (const h of handlers) if (h.seat === x.to) h.fn(x.from, JSON.parse(x.d));
    for (const s of [host, guest]) {
      const m: Match | null = s.match ?? s.attach(world);
      if (!m) continue;
      s.before(m);
      step(m, 1 / 30, idleInput(m.actors[m.me].yaw, m.actors[m.me].pitch));
      s.after(m);
    }
  }
  assert.ok(host.match && guest.match, 'the guest joined');
  return { host: host.match, guest: guest.match, def: world.def };
}

test('looks: online, the guest sees the host\'s sky (the host\'s choice, never the guest\'s own setting)', () => {
  for (const [h, g] of [
    ['dusk', 'overcast'],
    ['overcast', 'day'],
    ['day', 'dusk'],
  ] as const) {
    const { host, guest, def } = pair(h, g);
    assert.equal(guest.seed, host.seed);
    assert.equal(lookOf(host.mode, host.seed, 'auto', def), h);
    assert.equal(lookOf(guest.mode, guest.seed, 'auto', def), h);
  }
  const { host, guest, def } = pair('auto', 'dusk');
  assert.equal(lookOf(guest.mode, guest.seed, 'auto', def), lookOf(host.mode, host.seed, 'auto', def));
});

test('looks: baking the light again for the map\'s own sun gives the baked light exactly; a dusk sun changes only the sun and far shadow channels', () => {
  const w = worldFor('mesa', true);
  const drain = (g: Generator<void, Uint8Array>) => {
    for (;;) {
      const r = g.next();
      if (r.done) return r.value;
    }
  };
  const same = drain(relight(w, w.sun));
  assert.deepEqual(same, w.light);
  const dusk = drain(relight(w, sunDir(withLook(w.def, 'dusk'))));
  let changed = 0;
  for (let k = 0; k < dusk.length; k += 4) {
    assert.equal(dusk[k + 1], w.light[k + 1]);
    assert.equal(dusk[k + 3], w.light[k + 3]);
    if (dusk[k] !== w.light[k] || dusk[k + 2] !== w.light[k + 2]) changed++;
  }
  assert.ok(changed > dusk.length / 4 / 10, `only ${changed} texels changed`);
});

test('looks: the breach worlds are built exactly as before (pieces, boxes, loot, spawns, light)', () => {
  const want: Record<string, string> = {
    vale: '915693932278 3cd3e25e399d 1d3b87d27c5a fc2185e43974 9a2d7901bfc2',
    mesa: 'efc8db1c8ea5 7dd657f5b000 ad87a41f30c9 c956d2e44037 e2dfcfe95af8',
    frost: '9afd6341090e e83ca9792b6e c2ad28bcf4b3 941917264b5a 3ace3a97ab65',
    isles: '11b7c22f2da8 337e8504fcc0 4fd9af50543f 0a60d0148606 682d10973692',
  };
  const h = (x: unknown) => createHash('sha1').update(JSON.stringify(x, (_k, v) => (ArrayBuffer.isView(v) ? Array.from(v as Uint8Array) : v))).digest('hex').slice(0, 12);
  for (const id of MAP_IDS) {
    const w = buildWorld(id, false);
    assert.equal([h(w.pieces), h(w.boxes), h(w.loot), h(w.spawns), h(w.light)].join(' '), want[id], id);
  }
});
