import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AIR, BED_FOOT, BED_HEAD, CS, CX, CY, CZ, END_STONE, GRASS, OBSIDIAN, PLANKS, WOOL, breakTicks, isPlayerBlock } from '../src/os/arcade/games/bedwars/blocks.ts';
import { World, canBreak, raycast } from '../src/os/arcade/games/bedwars/world.ts';
import { CENTER, TOP, generate, islandLayout } from '../src/os/arcade/games/bedwars/map.ts';
import { HEIGHT, WIDTH, newBody, stepBody, type MoveInput } from '../src/os/arcade/games/bedwars/physics.ts';
import { applyKnock, armorPoints, fallDamage, hurtFilter, meleeKnock, protectionFactor, reduceDamage, weaponDamage } from '../src/os/arcade/games/bedwars/combat.ts';
import { GEN_INTERVAL, HOTBAR, SLOTS, addItem, buy, forgeInterval, freshInventory, inventoryAfterDeath, moveSlot, priceOf, offerById, quickMoveTarget, trapCost, upgradeCost, freshUpgrades } from '../src/os/arcade/games/bedwars/items.ts';
import {
  RESPAWN_TICKS,
  TPS,
  applyAction,
  attack,
  breakBlock,
  createGame,
  damage,
  placeBlock,
  tickGame,
  timeline,
  type Entrant,
  type Game,
} from '../src/os/arcade/games/bedwars/game.ts';
import { meshChunk } from '../src/os/arcade/games/bedwars/mesher.ts';
import { SKILLS, botDigTicks, defenseCells, findPath, nextPurchase, thinkBots } from '../src/os/arcade/games/bedwars/bots.ts';
import {
  CHUNK,
  EventQueue,
  SyncAssembler,
  actPacket,
  eventPackets,
  movePacket,
  parseAction,
  parseEvent,
  parsePacket,
  posEntry,
  posPacket,
  syncPackets,
  syncState,
} from '../src/os/arcade/games/bedwars/net.ts';
import { buildReplica } from '../src/os/arcade/games/bedwars/replica.ts';
import { Session, hostEntrants, type OnlineApi } from '../src/os/arcade/games/bedwars/session.ts';
import { Track } from '../src/os/arcade/games/bedwars/interp.ts';

const still: MoveInput = { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false };
const bots = (n: number): Entrant[] => Array.from({ length: n }, (_, i) => ({ name: `bot${i}`, seat: -1, ctrl: 'bot' as const, skin: 0 }));
const soloWithMe = (): Game => createGame({ mode: 'solo', pace: 'quick', level: 'normal', entrants: [{ name: 'me', seat: 0, ctrl: 'local', skin: 0, team: 0 }, ...bots(7)], seed: 42 });

/** A floor of grass at y = 9 from x 0..9, z 0..9, nothing else. */
function floorWorld() {
  const w = new World();
  w.generating = true;
  for (let x = 0; x < 10; x++) for (let z = 0; z < 10; z++) w.set(x, 9, z, GRASS);
  w.generating = false;
  w.computeTops();
  return w;
}

// ---------------------------------------------------------------------------------------------------------------
// world and physics

test('bodies land on blocks, walk at Minecraft speed and stop at walls', () => {
  const w = floorWorld();
  w.set(5, 10, 8, GRASS);
  const b = newBody(5.5, 12, 2.5, Math.PI);
  for (let i = 0; i < 30; i++) stepBody(w, b, still);
  assert.equal(b.y, 10);
  assert.ok(b.onGround);
  // walk toward +z (yaw pi faces +z) for 2 seconds: about 4.3 blocks a second until the wall at z = 8
  for (let i = 0; i < 40; i++) stepBody(w, b, { ...still, forward: 1 });
  assert.ok(b.z <= 8 - WIDTH / 2 + 1e-6, `stopped by the wall, got ${b.z}`);
  assert.ok(b.z > 7.6, 'reached the wall');
  assert.ok(b.collidedH);
});

test('walking speed, sprinting and jumping match Minecraft', () => {
  const w = floorWorld();
  const b = newBody(1.5, 10, 1.5, Math.PI);
  for (let i = 0; i < 5; i++) stepBody(w, b, still);
  const z0 = b.z;
  for (let i = 0; i < 20; i++) stepBody(w, b, { ...still, forward: 1 });
  const walk = b.z - z0;
  assert.ok(walk > 3.6 && walk < 4.4, `walked ${walk} blocks in a second`);
  const s = newBody(1.5, 10, 0.5, Math.PI);
  for (let i = 0; i < 5; i++) stepBody(w, s, still);
  const s0 = s.z;
  for (let i = 0; i < 20; i++) stepBody(w, s, { ...still, forward: 1, sprint: true });
  assert.ok(s.z - s0 > walk * 1.2, 'sprinting is faster');
  // a jump clears one block but not two
  const j = newBody(5.5, 10, 5.5, 0);
  for (let i = 0; i < 3; i++) stepBody(w, j, still);
  let top = j.y;
  stepBody(w, j, { ...still, jump: true });
  for (let i = 0; i < 12; i++) {
    stepBody(w, j, still);
    top = Math.max(top, j.y);
  }
  assert.ok(top - 10 > 1.1 && top - 10 < 1.3, `jump height ${top - 10}`);
});

test('crouching never walks you off an edge, but you can lean over it', () => {
  const w = floorWorld();
  const b = newBody(5.5, 10, 8.5, Math.PI);
  for (let i = 0; i < 3; i++) stepBody(w, b, still);
  for (let i = 0; i < 80; i++) stepBody(w, b, { ...still, forward: 1, sneak: true });
  assert.equal(b.y, 10, 'still standing on the floor');
  assert.ok(b.z > 10 && b.z < 10 + WIDTH / 2, `hanging over the edge at ${b.z}`);
  // without crouching you fall off
  const f = newBody(5.5, 10, 8.5, Math.PI);
  for (let i = 0; i < 3; i++) stepBody(w, f, still);
  for (let i = 0; i < 40; i++) stepBody(w, f, { ...still, forward: 1 });
  assert.ok(f.y < 9, 'walked off');
});

test('step up onto half blocks like beds, and fall damage after three blocks', () => {
  const w = floorWorld();
  w.set(5, 10, 6, BED_FOOT);
  const b = newBody(5.5, 10, 4.5, Math.PI);
  for (let i = 0; i < 3; i++) stepBody(w, b, still);
  let top = 0;
  for (let i = 0; i < 20; i++) {
    stepBody(w, b, { ...still, forward: 1 });
    top = Math.max(top, b.y);
  }
  assert.ok(top > 10.5, 'stepped onto the bed without jumping');
  assert.equal(fallDamage(3, 0), 0);
  assert.equal(fallDamage(5.2, 0), 3);
  assert.equal(fallDamage(5.2, 5), 0, 'jump boost forgives');
  const d = newBody(2.5, 20, 2.5, 0);
  for (let i = 0; i < 40; i++) stepBody(w, d, still);
  assert.ok(d.landed > 9.5 && d.landed < 10.5, `landed after ${d.landed}`);
});

test('raycasts find the first block and the face it hits', () => {
  const w = floorWorld();
  const hit = raycast(w, 5.5, 11.5, 5.5, 0, -1, 0, 5);
  assert.ok(hit);
  assert.deepEqual([hit.x, hit.y, hit.z, hit.face], [5, 9, 5, 2]);
  assert.equal(raycast(w, 5.5, 20, 5.5, 0, -1, 0, 5), null, 'out of reach');
});

test('only placed blocks (and beds) can be broken; the map cannot', () => {
  const w = floorWorld();
  w.set(1, 10, 1, WOOL, true);
  w.set(2, 10, 1, END_STONE);
  w.set(3, 10, 1, BED_HEAD);
  assert.ok(canBreak(w, 1, 10, 1));
  assert.ok(!canBreak(w, 2, 10, 1), 'end stone that came with the map');
  assert.ok(!canBreak(w, 1, 9, 1), 'the floor');
  assert.ok(canBreak(w, 3, 10, 1), 'beds always');
  assert.ok(isPlayerBlock(WOOL) && !isPlayerBlock(GRASS));
});

test('tools follow Minecraft break times', () => {
  const kit = { pick: 0, axe: 0, shears: false };
  assert.equal(breakTicks(WOOL, 'none', kit), 24, 'wool by hand');
  assert.equal(breakTicks(WOOL, 'shears', { ...kit, shears: true }), 5, 'wool with shears');
  assert.equal(breakTicks(END_STONE, 'none', kit), 300, 'end stone by hand is slow');
  assert.ok(breakTicks(END_STONE, 'pick', { ...kit, pick: 2 }) < 12, 'iron pickaxe');
  assert.ok(breakTicks(PLANKS, 'axe', { ...kit, axe: 1 }) < breakTicks(PLANKS, 'none', kit));
  assert.ok(breakTicks(OBSIDIAN, 'pick', { ...kit, pick: 3 }) > 200, 'gold pickaxe cannot harvest obsidian');
  assert.ok(breakTicks(OBSIDIAN, 'pick', { ...kit, pick: 4 }) < 100, 'diamond pickaxe can');
  assert.ok(breakTicks(WOOL, 'none', kit, 2) < 24, 'haste helps');
  assert.equal(breakTicks(WOOL, 'none', kit, 0, false), 120, 'mining in the air is five times slower');
  assert.equal(breakTicks(GRASS, 'pick', { ...kit, pick: 4 }), Infinity);
});

test('the map: eight islands with beds, generators, and a mesher that culls hidden faces', () => {
  const { world, info } = generate('solo');
  assert.equal(info.teams.length, 8);
  assert.equal(info.gens.filter((g) => g.kind === 'diamond').length, 4);
  assert.equal(info.gens.filter((g) => g.kind === 'emerald').length, 4);
  for (const t of info.teams) {
    assert.equal(world.get(t.bedFoot[0], t.bedFoot[1], t.bedFoot[2]), BED_FOOT + t.team);
    assert.equal(world.get(t.bedHead[0], t.bedHead[1], t.bedHead[2]), BED_HEAD + t.team);
    assert.notEqual(world.get(t.spawn[0], t.spawn[1] - 1, t.spawn[2]), AIR, 'ground under spawn');
  }
  assert.notEqual(world.get(CENTER - 2, TOP + 10, CENTER - 1), AIR, 'Hoover Tower');
  assert.equal(islandLayout('doubles').length, 4);
  // a solid 2x2x2 cube shows 24 faces, not 48
  const w = new World();
  for (let x = 0; x < 2; x++) for (let y = 0; y < 2; y++) for (let z = 0; z < 2; z++) w.set(x + 4, y + 4, z + 4, END_STONE);
  w.computeTops();
  const m = meshChunk(w, 0, 0, 0);
  assert.equal(m.opaque?.quads, 24);
  assert.equal(m.cutout, null);
  // and the whole map meshes
  let quads = 0;
  for (let cy = 0; cy < CY; cy++)
    for (let cz = 0; cz < CZ; cz++)
      for (let cx = 0; cx < CX; cx++) {
        const c = meshChunk(world, cx, cy, cz);
        quads += (c.opaque?.quads ?? 0) + (c.cutout?.quads ?? 0) + (c.glass?.quads ?? 0);
      }
  assert.ok(quads > 5000 && quads < 80000, `${quads} quads`);
  assert.equal(CS, 16);
});

test('placing a block marks its chunk and the neighbors on the edge dirty', () => {
  const w = new World();
  w.dirty.clear();
  w.set(16, 20, 5, WOOL, true);
  assert.ok(w.dirty.size >= 2, 'both chunks across the edge');
  assert.ok(w.edits.has((20 * 176 + 5) * 176 + 16));
});

// ---------------------------------------------------------------------------------------------------------------
// combat

test('weapons, crits, armor and protection', () => {
  assert.equal(weaponDamage('sword_wood', 0, 0, 0), 5);
  assert.equal(weaponDamage('sword_diamond', 0, 0, 0), 8);
  assert.equal(weaponDamage('sword_iron', 0, 0, 1), 8.25, 'sharpness I');
  assert.equal(weaponDamage(null, 0, 0, 1), 1, 'fists are not sharpened');
  assert.equal(armorPoints(0), 7);
  assert.equal(armorPoints(3), 13);
  assert.ok(reduceDamage(8, 'melee', 3, 0) < reduceDamage(8, 'melee', 0, 0));
  assert.equal(reduceDamage(5, 'fall', 3, 0), 5, 'armor does not stop falls');
  assert.ok(protectionFactor(4) < protectionFactor(1));
  assert.equal(reduceDamage(1000, 'void', 3, 4), 1000);
});

test('hurt immunity lets click spam through only when it hits harder', () => {
  const s = { hurtTicks: 0, lastDamage: 0 };
  assert.deepEqual(hurtFilter(s, 5), { dealt: 5, knock: true });
  s.hurtTicks--;
  assert.deepEqual(hurtFilter(s, 5), { dealt: 0, knock: false }, 'same hit again is blocked');
  assert.deepEqual(hurtFilter(s, 7), { dealt: 2, knock: false }, 'a harder one lands the difference');
  s.hurtTicks = 10;
  assert.equal(hurtFilter(s, 3).knock, true, 'after half a second hits land fully again');
});

test('sprint hits knock further than walking hits', () => {
  const v1 = newBody(0, 10, 0, 0);
  const v2 = newBody(0, 10, 0, 0);
  const a = newBody(0, 10, 2, 0);
  applyKnock(v1, meleeKnock(v1, a, 0));
  applyKnock(v2, meleeKnock(v2, a, 1));
  assert.ok(v1.vz < 0 && v2.vz < v1.vz, 'pushed away from the attacker, more with sprint');
  assert.ok(v1.vy > 0 && v1.vy <= 0.4);
});

test('melee in the rules: reach, teams, damage, kills and resources to the killer', () => {
  const g = soloWithMe();
  const me = g.players[0];
  const foe = g.players[1];
  foe.body.x = me.body.x;
  foe.body.y = me.body.y;
  foe.body.z = me.body.z - 2;
  foe.inv.wallet.iron = 7;
  assert.ok(attack(g, me, foe.id, false));
  assert.ok(foe.hp < 20);
  assert.ok(!attack(g, me, me.id), 'not yourself');
  foe.body.z = me.body.z - 8;
  assert.ok(!attack(g, me, foe.id), 'out of reach');
  damage(g, foe, 1000, me.id, 'magic', null);
  assert.equal(foe.alive, false);
  assert.equal(me.stats.kills, 1);
  assert.equal(me.inv.wallet.iron, 7, 'the killer takes the iron');
  assert.equal(foe.respawn, RESPAWN_TICKS, 'respawns while the bed stands');
});

// ---------------------------------------------------------------------------------------------------------------
// beds, respawns, the end

test('beds: your own is safe, an enemy breaks it, then deaths are final and the last team wins', () => {
  const g = createGame({ mode: 'solo', pace: 'quick', level: 'normal', entrants: [{ name: 'a', seat: 0, ctrl: 'local', skin: 0 }, { name: 'b', seat: 1, ctrl: 'remote', skin: 0 }], seed: 1 });
  const [a, b] = g.players;
  assert.equal(g.teams.filter((t) => t.used).length, 2);
  const bed = g.info.teams[a.team];
  a.body.x = bed.bedFoot[0] + 0.5;
  a.body.z = bed.bedFoot[2] - 1.5;
  assert.ok(!breakBlock(g, a, bed.bedFoot[0], bed.bedFoot[1], bed.bedFoot[2]), 'cannot break your own bed');
  b.body.x = a.body.x;
  b.body.z = a.body.z;
  b.body.y = a.body.y;
  assert.ok(breakBlock(g, b, bed.bedFoot[0], bed.bedFoot[1], bed.bedFoot[2]));
  assert.equal(g.teams[a.team].bed, false);
  assert.equal(g.world.get(bed.bedHead[0], bed.bedHead[1], bed.bedHead[2]), AIR, 'both halves go');
  assert.equal(b.stats.beds, 1);
  assert.ok(g.events.some((e) => e.t === 'msg' && e.k === 'bed'));
  // b dies with a bed: respawns after five seconds
  damage(g, b, 1000, a.id, 'magic', null);
  assert.equal(b.alive, false);
  for (let i = 0; i < RESPAWN_TICKS; i++) tickGame(g);
  assert.equal(b.alive, true, 'respawned');
  // a dies without a bed: final kill, team eliminated, b wins
  damage(g, a, 1000, b.id, 'magic', null);
  assert.equal(a.out, true);
  assert.equal(b.stats.finals, 1);
  assert.equal(g.over, true);
  assert.equal(g.winner, b.team);
});

test('falling into the void kills, credited to whoever hit you last', () => {
  const g = soloWithMe();
  const [me, foe] = g.players;
  foe.body.x = me.body.x;
  foe.body.z = me.body.z - 1;
  foe.body.y = me.body.y;
  attack(g, foe, me.id, false);
  me.body.y = -20;
  tickGame(g);
  assert.equal(me.alive, false);
  assert.ok(g.events.some((e) => e.t === 'msg' && /knocked into the void by/.test(e.text)));
});

test('blocks: place next to something, never inside people or protected spots, and the hotbar pays', () => {
  const g = soloWithMe();
  const me = g.players[0];
  me.inv.slots[1] = { item: 'wool', n: 2 };
  const site = g.info.teams[0];
  const x = Math.floor(site.bedHead[0]);
  const y = site.bedHead[1];
  const z = Math.floor(site.bedHead[2]) + 1;
  me.body.x = x + 0.5;
  me.body.z = z - 2.5;
  assert.ok(placeBlock(g, me, x, y, z, 1));
  assert.equal(g.world.get(x, y, z), WOOL);
  assert.ok(g.world.isPlaced(x, y, z));
  assert.equal(me.inv.slots[1]?.n, 1);
  assert.ok(!placeBlock(g, me, x, y + 10, z, 1), 'nothing to place against in mid air');
  assert.ok(!placeBlock(g, me, Math.floor(site.spawn[0]), site.spawn[1], Math.floor(site.spawn[2]) + 0, 1), 'spawn is protected');
  assert.ok(applyAction(g, me, { a: 'break', x, y, z, seq: 0 }));
  assert.equal(g.world.get(x, y, z), AIR);
});

test('the shop charges Hypixel prices and tools drop a tier on death', () => {
  const inv = freshInventory();
  assert.deepEqual(buy(inv, 'wool'), { ok: false, why: 'poor' });
  inv.wallet.iron = 50;
  inv.wallet.gold = 20;
  assert.equal(buy(inv, 'wool').ok, true);
  assert.equal(inv.wallet.iron, 46);
  assert.equal(buy(inv, 'sword_stone').ok, true);
  assert.equal(inv.slots[0]?.item, 'sword_stone', 'replaces the wooden sword');
  assert.equal(buy(inv, 'armor_chain').ok, true);
  assert.deepEqual(buy(inv, 'armor_chain'), { ok: false, why: 'owned' });
  inv.wallet.iron = 30;
  assert.equal(buy(inv, 'pick').ok, true);
  assert.equal(buy(inv, 'pick').ok, true);
  assert.equal(inv.pick, 2);
  assert.deepEqual(priceOf(inv, offerById('pick')!), { res: 'gold', cost: 3, name: 'Golden Pickaxe' });
  assert.equal(buy(inv, 'shears').ok, false, 'not enough iron left');
  const after = inventoryAfterDeath(inv);
  assert.equal(after.pick, 1);
  assert.equal(after.armor, 1, 'armor is permanent');
  assert.equal(after.slots[0]?.item, 'sword_wood');
  assert.equal(after.wallet.iron, 0);
  assert.ok(!after.slots.some((s) => s?.item === 'wool'), 'blocks are lost');
  // stacking
  const s = freshInventory();
  assert.equal(addItem(s, 'wool', 100), 0);
  assert.deepEqual(s.slots.filter(Boolean).map((x) => x!.n), [1, 64, 36]);
});

test('team upgrades and traps cost diamonds on the Hypixel ladder', () => {
  const ups = freshUpgrades();
  assert.equal(upgradeCost(ups, 'prot'), 2);
  ups.prot = 3;
  assert.equal(upgradeCost(ups, 'prot'), 16);
  ups.prot = 4;
  assert.equal(upgradeCost(ups, 'prot'), null);
  assert.deepEqual([trapCost(0), trapCost(1), trapCost(2)], [1, 2, 4]);
});

test('forges and generators: timing, tiers, caps and pickups', () => {
  assert.equal(forgeInterval('iron', 0), 25);
  assert.ok(forgeInterval('iron', 4) < forgeInterval('iron', 1));
  assert.equal(forgeInterval('emerald', 0), Infinity);
  assert.ok(isFinite(forgeInterval('emerald', 3)));
  const g = soloWithMe();
  const me = g.players[0];
  const forge = g.info.teams[0].forge;
  me.body.x = 10;
  me.body.z = 10;
  for (let i = 0; i < TPS * 10; i++) tickGame(g);
  const pile = g.drops.find((d) => d.item === 'iron' && Math.abs(d.x - forge[0]) < 1.5 && Math.abs(d.z - forge[2]) < 1.5);
  assert.ok(pile && pile.n >= 6 && pile.n <= 9, `iron piled at the forge: ${pile?.n}`);
  // walking over it picks it all up
  me.body.x = forge[0];
  me.body.z = forge[2];
  me.body.y = forge[1];
  tickGame(g);
  assert.ok(me.inv.wallet.iron >= 6);
  // diamonds: first after 30 seconds, tier II after two minutes on the quick clock
  const t = timeline('quick');
  assert.equal(t[0].kind, 'diamond2');
  assert.equal(t[0].at, 2 * 60 * TPS);
  assert.equal(GEN_INTERVAL.diamond[0], 30 * TPS);
  assert.equal(timeline('classic')[4].at, 30 * 60 * TPS, 'beds go at 30 minutes on classic');
});

// ---------------------------------------------------------------------------------------------------------------
// bots

test('bots shop, defend, bridge and finish a game', () => {
  const g = createGame({ mode: 'solo', pace: 'quick', level: 'normal', entrants: bots(8), seed: 7 });
  const p = g.players[0];
  p.inv.wallet.iron = 30;
  assert.equal(nextPurchase(g, p), 'wool');
  assert.equal(defenseCells(g, 0, 1).length, 8, 'eight cells wrap a two block bed');
  // a path from an island to the middle needs a bridge over the void
  const site = g.info.teams[0];
  const path = findPath(g, Math.floor(site.spawn[0]), site.spawn[1], Math.floor(site.spawn[2]), CENTER, CENTER, true);
  assert.ok(path.some((n) => n.kind === 1), 'bridges');
  assert.equal(findPath(g, Math.floor(site.spawn[0]), site.spawn[1], Math.floor(site.spawn[2]), CENTER, CENTER, false).some((n) => n.kind === 1), false, 'no blocks, no bridge');
  let placed = 0;
  let beds = 0;
  for (let t = 0; t < TPS * 60 * 16 && !g.over; t++) {
    thinkBots(g);
    tickGame(g);
    for (const e of g.events.splice(0)) {
      if (e.t === 'block' && e.placed) placed++;
      if (e.t === 'bed') beds++;
    }
  }
  assert.ok(placed > 50, `bots built (${placed} blocks)`);
  assert.ok(beds >= 4, `beds fell (${beds})`);
  assert.ok(g.over, 'the game ended');
  assert.ok(SKILLS.hard.reaction < SKILLS.easy.reaction);
});

test('bots only fight who they can see and miss when their aim is off', () => {
  const g = createGame({ mode: 'solo', pace: 'quick', level: 'easy', entrants: [{ name: 'me', seat: 0, ctrl: 'local', skin: 0 }, ...bots(1)], seed: 3 });
  const [me, bot] = g.players;
  // the bot is on its own island far away: it cannot see or reach us
  for (let i = 0; i < 40; i++) {
    thinkBots(g);
    tickGame(g);
  }
  assert.equal(me.hp, 20);
  void bot;
});

test('bot-only games end with a winner, not the draw clock (the last bots hunt each other down)', () => {
  for (const level of ['easy', 'hard'] as const)
    for (const seed of [1, 3]) {
      const g = createGame({ mode: 'solo', pace: 'quick', level, entrants: bots(8), seed });
      const end = g.phases.find((ph) => ph.kind === 'end')!.at;
      while (!g.over && g.tick < end + TPS) {
        thinkBots(g);
        tickGame(g);
        g.events.length = 0;
      }
      assert.ok(g.over && g.winner >= 0, `${level} seed ${seed}: winner ${g.winner} at ${Math.round(g.tick / TPS)}s`);
    }
});

test('traps work on bots: blindness hides anyone past a few blocks, miner fatigue slows their digging', () => {
  for (const blind of [false, true]) {
    const g = createGame({ mode: 'solo', pace: 'quick', level: 'normal', entrants: [{ name: 'me', seat: 0, ctrl: 'local', skin: 0, team: 1 }, { name: 'b', seat: -1, ctrl: 'bot', skin: 0, team: 0 }], seed: 4 });
    const [me, bot] = g.players;
    const fx = -Math.sin(bot.body.yaw);
    const fz = -Math.cos(bot.body.yaw);
    if (blind) bot.fx.blind = 200;
    for (let i = 0; i < 12; i++) {
      me.body.x = bot.body.x + fx * 6;
      me.body.z = bot.body.z + fz * 6;
      me.body.y = bot.body.y;
      thinkBots(g);
    }
    assert.equal((bot.brain as { enemy: number }).enemy, blind ? -1 : me.id, blind ? 'blind: nobody in sight' : 'sees you six blocks ahead');
  }
  const g = soloWithMe();
  const bot = g.players[1];
  const plain = botDigTicks(g, bot, END_STONE, 'none');
  bot.fx.fatigue = 100;
  assert.ok(Math.abs(botDigTicks(g, bot, END_STONE, 'none') - plain * 3.3) < 1e-9, 'three times slower and then some');
});

// ---------------------------------------------------------------------------------------------------------------
// network

test('packets round trip through the parser and reject junk', () => {
  const g = soloWithMe();
  const p = parsePacket(JSON.parse(JSON.stringify(movePacket(3, 2, [1, 2, 3, 0, 0, 0, 0.5, -0.2, 9], 4, 10, 0))));
  assert.deepEqual(p, { k: 'move', round: 3, ep: 2, b: [1, 2, 3, 0, 0, 0, 0.5, -0.2, 9], sel: 4, sw: 10, dr: 0 });
  const act = parsePacket(JSON.parse(JSON.stringify(actPacket(3, 9, { a: 'place', x: 1, y: 2, z: 3, slot: 1, face: 2, seq: 9 }))));
  assert.equal(act?.k, 'act');
  assert.equal(parseAction({ a: 'place', x: 1.5, y: 2, z: 3, slot: 1, face: 2, seq: 1 }), null, 'fractional coordinates');
  assert.equal(parseAction({ a: 'buy', id: 'x'.repeat(100) }), null);
  assert.equal(parseAction({ a: 'nope' }), null);
  assert.equal(parsePacket({ t: 'bw', r: 1, k: 'M', ep: 0, b: [NaN, 0, 0, 0, 0, 0, 0, 0, 0], sel: 0, sw: 0, dr: 0 }), null);
  assert.equal(parsePacket({ t: 'other', r: 1, k: 'M' }), null);
  assert.equal(parseEvent({ t: 'block', x: 1, y: 2, z: 3, id: 999, by: 0, placed: true, was: 0 }), null, 'unknown block id');
  assert.equal(parseEvent({ t: 'kb', p: 1, k: { dx: 0, dz: 0, ex: 50, ey: 0, ez: 0, base: true } }), null, 'absurd knockback');
  const pos = parsePacket(JSON.parse(JSON.stringify(posPacket(1, 20, g.players.map(posEntry)))));
  assert.equal(pos?.k === 'pos' && pos.p.length, 8);
  // events split under the size limit and keep their order
  const evs = Array.from({ length: 300 }, (_, i) => ({ t: 'block' as const, x: i, y: 1, z: 2, id: 32, by: 0, placed: true, was: 0 }));
  const { packets, seq } = eventPackets(1, 10, evs);
  assert.ok(packets.length > 1);
  assert.equal(seq, 10 + packets.length);
  for (const pk of packets) assert.ok(JSON.stringify(pk).length < 8000);
  const back = packets.flatMap((pk) => (parsePacket(JSON.parse(JSON.stringify(pk))) as { e: { x: number }[] }).e.map((e) => e.x));
  assert.deepEqual(back, evs.map((e) => e.x));
});

test('a sync survives chunking and rebuilds the same world on a guest', () => {
  const g = createGame({ mode: 'doubles', pace: 'quick', level: 'normal', entrants: [{ name: 'host', seat: 0, ctrl: 'local', skin: 0 }, { name: 'guest', seat: 3, ctrl: 'remote', skin: 2 }, ...bots(6)], seed: 5 });
  // lots of edits so it needs several chunks
  for (let i = 0; i < 1500; i++) g.world.set(20 + (i % 30), 40 + Math.floor(i / 900), 20 + Math.floor(i / 30) % 30, WOOL + 1, true);
  const pks = syncPackets(7, 1, syncState(g, 12));
  assert.ok(pks.length > 1, 'chunked');
  for (const pk of pks) assert.ok(JSON.stringify(pk).length < 8000);
  const asm = new SyncAssembler();
  let state = null;
  // chunks arrive out of order
  for (const pk of [...pks].reverse()) {
    const parsed = parsePacket(JSON.parse(JSON.stringify(pk)));
    assert.equal(parsed?.k, 'sync');
    if (parsed?.k === 'sync') state = asm.add(parsed) ?? state;
  }
  assert.ok(state);
  assert.equal(state.seq, 12);
  const { game, me } = buildReplica(state, 3);
  assert.equal(game.players[me].name, 'guest');
  assert.equal(game.players[me].ctrl, 'local');
  assert.equal(game.players[me].team, g.players[1].team);
  assert.equal(game.world.get(25, 40, 21), WOOL + 1);
  assert.ok(game.world.isPlaced(25, 40, 21));
  assert.equal(game.world.edits.size, g.world.edits.size);
});

test('the event queue holds early packets, applies in order and flags a lasting gap', () => {
  const q = new EventQueue();
  q.reset(5);
  const ev = (x: number) => [{ t: 'block' as const, x, y: 0, z: 0, id: 0, by: 0, placed: false, was: 0 }];
  assert.deepEqual(q.push(4, ev(4), 0), [], 'old');
  assert.deepEqual(q.push(6, ev(6), 0), [], 'early');
  assert.deepEqual(q.push(5, ev(5), 0.1).map((e) => (e as { x: number }).x), [5, 6]);
  q.push(8, ev(8), 1);
  assert.equal(q.stalled(2), false);
  assert.equal(q.stalled(3), true, 'seq 7 never came');
});

test('interpolation tracks fill the gaps between snapshots and drop stale ones', () => {
  const t = new Track();
  t.push(0, 0, 0, 0, 0, 0);
  t.push(0.1, 1, 0, 0, 0, 0);
  t.push(0.05, 9, 9, 9, 0, 0);
  const out = { t: 0, x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  t.sample(0.05, out);
  assert.equal(out.x, 0.5);
  t.sample(0.2, out);
  assert.ok(out.x > 1 && out.x <= 2.5, 'extrapolates a little past the newest');
});

/** A star of in-memory rooms: reliable messages arrive in order, fast ones can be dropped or swapped. */
function fakeRoom(seats: number[], lossy: boolean) {
  type Msg = { from: number; to: number; d: unknown; fast: boolean };
  const queue: Msg[] = [];
  const listeners = new Map<number, ((from: number, d: unknown) => void)[]>();
  let rnd = 99;
  const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
  const api = (seat: number): OnlineApi => ({
    seat,
    isHost: seat === 0,
    round: 1,
    players: seats.map((s) => ({ seat: s, name: s === 0 ? 'host' : `guest${s}` })),
    transport: 'direct',
    send(d, o = {}) {
      const to = seat === 0 ? (o.to === undefined ? seats.filter((s) => s !== 0) : [o.to]) : [0];
      for (const t of to) queue.push({ from: seat, to: t, d: JSON.parse(JSON.stringify(d)), fast: !!o.fast });
    },
    onMessage(fn) {
      const l = listeners.get(seat) ?? [];
      l.push(fn);
      listeners.set(seat, l);
      return () => listeners.set(seat, (listeners.get(seat) ?? []).filter((x) => x !== fn));
    },
  });
  const deliver = () => {
    const batch = queue.splice(0);
    const order: Msg[] = [];
    for (const m of batch) {
      if (lossy && m.fast && rand() < 0.3) continue;
      if (lossy && m.fast && order.length && rand() < 0.3) order.splice(order.length - 1, 0, m);
      else order.push(m);
    }
    for (const m of order) for (const fn of listeners.get(m.to) ?? []) fn(m.from, m.d);
  };
  return { api, deliver };
}

test('host and guests stay in step through lost and reordered fast packets', () => {
  const room = fakeRoom([0, 1, 2], true);
  const ready = new Map<number, { game: Game; me: number }>();
  const fake = (time: () => number) => ({ get time() { return time(); }, onEvent() {}, hooks: {} }) as never;
  let clock = 0;
  const sessions = [0, 1, 2].map((seat) => {
    const s = new Session(room.api(seat), {
      mode: 'solo',
      level: 'normal',
      pace: 'quick',
      bots: true,
      skin: 0,
      botNames: ['a', 'b', 'c', 'd', 'e', 'f'],
      onReady: (game, me) => ready.set(seat, { game, me }),
    });
    s.client = fake(() => clock);
    return s;
  });
  for (let i = 0; i < 6; i++) room.deliver();
  assert.equal(ready.size, 3, 'everyone has a game');
  const host = ready.get(0)!;
  const g1 = ready.get(1)!;
  assert.equal(host.game.players.length, 8);
  assert.equal(g1.game.players[g1.me].name, 'guest1');
  // run a few seconds: the host plays bots, guest 1 walks and bridges, guest 2 stands still
  const me1 = g1.game.players[g1.me];
  me1.inv.slots[1] = { item: 'wool', n: 16 };
  host.game.players[g1.me].inv.slots[1] = { item: 'wool', n: 16 };
  for (let t = 0; t < TPS * 6; t++) {
    clock += 1 / TPS;
    thinkBots(host.game);
    tickGame(host.game);
    sessions[0].broadcast(host.game.events.splice(0));
    stepBody(g1.game.world, me1.body, { ...still, forward: 1, sneak: true });
    if (t === 30) {
      const x = Math.floor(me1.body.x) + 1;
      const y = Math.floor(me1.body.y);
      const z = Math.floor(me1.body.z);
      g1.game.world.set(x, y, z, WOOL + me1.team, true);
      sessions[1].send({ a: 'place', x, y, z, slot: 1, face: 2, seq: 1 }, 1);
    }
    for (const s of sessions) s.tick();
    room.deliver();
  }
  // the host sees guest 1 where guest 1 is
  const seen = host.game.players[g1.me].body;
  assert.ok(Math.hypot(seen.x - me1.body.x, seen.z - me1.body.z) < 1.5, 'host sees the guest move');
  // blocks the bots placed reached both guests, and the guest's block reached the host
  for (const seat of [1, 2]) {
    const g = ready.get(seat)!.game;
    for (const [i, id] of host.game.world.edits) assert.equal(g.world.blocks[i], id, `guest ${seat} world matches`);
  }
  assert.ok([...host.game.world.edits.values()].includes(WOOL + me1.team), 'the guest placed a block on the host');
  // drops the host made are on the guests too
  assert.equal(ready.get(2)!.game.drops.length, host.game.drops.length);
  for (const s of sessions) s.dispose();
  void hostEntrants;
  void CHUNK;
  void HEIGHT;
});

test('host entrants: humans by seat on their own islands in solo, paired in doubles, bots on the rest', () => {
  const solo = hostEntrants('solo', [{ seat: 0, name: 'a', skin: 0 }, { seat: 2, name: 'c', skin: 1 }, { seat: 1, name: 'b', skin: 0 }], 0, true, ['x']);
  assert.equal(solo.length, 8);
  assert.deepEqual(solo.slice(0, 3).map((e) => [e.name, e.team, e.ctrl]), [
    ['a', 0, 'local'],
    ['b', 1, 'remote'],
    ['c', 2, 'remote'],
  ]);
  const duo = hostEntrants('doubles', [{ seat: 0, name: 'a', skin: 0 }, { seat: 1, name: 'b', skin: 0 }, { seat: 2, name: 'c', skin: 0 }], 1, false, []);
  assert.deepEqual(duo.map((e) => e.team), [0, 0, 1]);
  assert.equal(duo[1].ctrl, 'local');
});

test('doubles without bots never puts everyone on one island', () => {
  const two = [{ seat: 0, name: 'a', skin: 0 }, { seat: 1, name: 'b', skin: 0 }];
  assert.deepEqual(hostEntrants('doubles', two, 0, false, []).map((e) => e.team), [0, 1], 'two friends play each other');
  const four = [...two, { seat: 2, name: 'c', skin: 0 }, { seat: 3, name: 'd', skin: 0 }];
  assert.deepEqual(hostEntrants('doubles', four, 0, false, []).map((e) => e.team), [0, 0, 1, 1], 'four make two pairs');
  // a lone human (everyone else left before the start) gets a bot to fight
  const lone = hostEntrants('doubles', [two[0]], 0, false, ['x']);
  assert.deepEqual(lone.map((e) => [e.team, e.ctrl]), [
    [0, 'local'],
    [1, 'bot'],
  ]);
  // and the game it makes has two sides, so a death does not hand out a win
  const g = createGame({ mode: 'doubles', pace: 'quick', level: 'normal', entrants: hostEntrants('doubles', two, 0, false, []), seed: 3 });
  assert.equal(g.teams.filter((t) => t.used).length, 2);
  g.players[1].body.y = -200;
  for (let i = 0; i < 5; i++) tickGame(g);
  assert.equal(g.players[1].alive, false);
  assert.equal(g.over, false, 'a death with the bed standing is no win');
});

test('the inventory: buys land in the hotbar first, overflow goes behind it, and you can move it back', () => {
  const inv = freshInventory();
  inv.wallet.iron = 200;
  inv.wallet.gold = 60;
  inv.wallet.emerald = 20;
  // a back row stack never soaks up a buy while the hotbar has room
  inv.slots[9] = { item: 'wool', n: 20 };
  assert.equal(buy(inv, 'wool').ok, true);
  assert.equal(inv.slots[1]?.item, 'wool', 'new wool shows up in the hotbar');
  assert.equal(inv.slots[1]?.n, 16);
  assert.equal(inv.slots[9]?.n, 20, 'the stack behind is untouched');
  assert.equal(buy(inv, 'wool').ok, true);
  assert.equal(inv.slots[1]?.n, 32, 'hotbar stacks top up first');
  // fill the hotbar: the next buy goes behind it, still paid for and still reachable
  for (const id of ['pick', 'axe', 'shears', 'endstone', 'bow', 'arrow', 'gapple']) assert.equal(buy(inv, id).ok, true, id);
  assert.ok(inv.slots.slice(0, HOTBAR).every(Boolean), 'hotbar full');
  const iron = inv.wallet.iron;
  assert.equal(buy(inv, 'fireball').ok, true);
  assert.equal(inv.wallet.iron, iron - 40);
  const at = inv.slots.findIndex((s) => s?.item === 'fireball');
  assert.ok(at >= HOTBAR, 'in the back row');
  // the inventory screen: pick it up and put it where the bow is (they swap)
  const bow = inv.slots.findIndex((s) => s?.item === 'bow');
  assert.ok(moveSlot(inv, at, bow));
  assert.equal(inv.slots[bow]?.item, 'fireball');
  assert.equal(inv.slots[at]?.item, 'bow');
  // the same item tops the stack up and leaves the rest behind
  inv.slots[12] = { item: 'wool', n: 60 };
  assert.ok(moveSlot(inv, 12, 1));
  assert.equal(inv.slots[1]?.n, 64);
  assert.equal(inv.slots[12]?.n, 28);
  assert.equal(moveSlot(inv, 3, 3), false, 'nowhere to go');
  assert.equal(moveSlot(inv, 0, SLOTS), false, 'off the end');
  // shift click: from the back row to a free hotbar slot, or in place of what you hold
  inv.slots[5] = null;
  assert.equal(quickMoveTarget(inv, 12, 2), 5);
  inv.slots[5] = { item: 'ladder', n: 1 };
  assert.equal(quickMoveTarget(inv, 12, 2), 2);
  assert.equal(quickMoveTarget(inv, 2, 2) >= HOTBAR, true, 'and back again');
  // completely full: refused, and nothing is charged
  const full = freshInventory();
  full.wallet.gold = 50;
  for (let i = 1; i < SLOTS; i++) full.slots[i] = { item: 'ladder', n: 64 };
  assert.deepEqual(buy(full, 'tnt'), { ok: false, why: 'full' });
  assert.equal(full.wallet.gold, 50);
});

test('tools come back into the hotbar after a death, even if they sat in the back row', () => {
  const inv = freshInventory();
  inv.pick = 2;
  inv.axe = 1;
  inv.slots[10] = { item: 'pick', n: 1 };
  inv.slots[4] = { item: 'axe', n: 1 };
  const after = inventoryAfterDeath(inv);
  assert.equal(after.slots[4]?.item, 'axe', 'a hotbar tool keeps its slot');
  const pick = after.slots.findIndex((s) => s?.item === 'pick');
  assert.ok(pick > 0 && pick < HOTBAR, `pickaxe in the hotbar, at ${pick}`);
});

test('moving stacks is an action: the host checks it, guests send it, and a full hotbar says where a buy went', () => {
  const g = soloWithMe();
  const me = g.players[0];
  me.inv.slots[11] = { item: 'pearl', n: 1 };
  assert.ok(applyAction(g, me, { a: 'swap', from: 11, to: 3 }));
  assert.equal(me.inv.slots[3]?.item, 'pearl');
  assert.ok(g.events.some((e) => e.t === 'inv' && e.p === me.id));
  assert.equal(applyAction(g, me, { a: 'swap', from: 11, to: 4 }), false, 'nothing there to move');
  assert.deepEqual(parseAction({ a: 'swap', from: 11, to: 3 }), { a: 'swap', from: 11, to: 3 });
  assert.equal(parseAction({ a: 'swap', from: 3, to: 3 }), null);
  assert.equal(parseAction({ a: 'swap', from: 0, to: 18 }), null);
  // at the shop with a full hotbar
  const site = g.info.teams[0];
  me.body.x = site.shop[0] + 1;
  me.body.z = site.shop[2];
  me.body.y = site.shop[1];
  for (let i = 1; i < HOTBAR; i++) me.inv.slots[i] = { item: 'ladder', n: 1 };
  me.inv.wallet.iron = 10;
  g.events.length = 0;
  assert.ok(applyAction(g, me, { a: 'buy', id: 'wool' }));
  assert.ok(me.inv.slots.slice(HOTBAR).some((s) => s?.item === 'wool'));
  assert.ok(g.events.some((e) => e.t === 'msg' && e.to === me.id && /hotbar is full, so it went in your inventory/.test(e.text)));
});

test('your record counts streaks and unlocks cosmetics at the milestones', async () => {
  const { addGame, freshRecord, loadRecord, newUnlocks, saveRecord, isUnlocked } = await import('../src/os/arcade/games/bedwars/stats.ts');
  let r = freshRecord();
  assert.ok(isUnlocked(r, 'skin', '0') && !isUnlocked(r, 'skin', '1'));
  const before = r;
  r = addGame(r, { won: true, kills: 3, finals: 2, beds: 1, deaths: 1 });
  assert.deepEqual(newUnlocks(before, r).map((c) => c.name), ['Coxswain']);
  r = addGame(r, { won: true, kills: 0, finals: 0, beds: 0, deaths: 2 });
  r = addGame(r, { won: true, kills: 0, finals: 0, beds: 4, deaths: 0 });
  assert.equal(r.streak, 3);
  assert.ok(isUnlocked(r, 'skin', '5'), 'a three game streak');
  assert.ok(isUnlocked(r, 'bed', 'blast'), 'five beds');
  r = addGame(r, { won: false, kills: 0, finals: 0, beds: 0, deaths: 1 });
  assert.equal(r.streak, 0);
  assert.equal(r.best, 3);
  // storage round trip, and junk in storage reads as a fresh record
  const mem = new Map<string, string>();
  const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  saveRecord(r, store);
  assert.deepEqual(loadRecord(store), r);
  mem.set('arcade:bedwars-record', '{"wins": -4, "games": "x"}');
  assert.equal(loadRecord(store).wins, 0);
});
