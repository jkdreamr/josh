import assert from 'node:assert/strict';
import { test } from 'node:test';
import { autopilot, createState, hover, resize, rng32, step, STEP } from '../src/os/arcade/games/flappy/logic.ts';
import { checkRun, parseProof, PROOF_VERSION, replay, type FlappyProof } from '../src/os/arcade/games/flappy/proof.ts';

/**
 * Flies a run the way the page does (index.tsx): the tree hovers, the first flap starts it on the seed's course, every
 * frame resizes first, then steps with that frame's flap, which is stamped with the step count it came on.
 */
function fly(seed: number, frameDt: (i: number) => number, opts: { w?: number; resizeAt?: number; resizeTo?: number; idle?: number; flapEvery?: number } = {}) {
  const w = createState(opts.w ?? 462);
  const rng = rng32(seed);
  let t = 0;
  let started = false;
  let proof: FlappyProof | null = null;
  for (let i = 0; i < 200_000 && !w.grounded; i++) {
    const dt = frameDt(i);
    const vw = opts.resizeAt !== undefined && w.ticks >= opts.resizeAt ? opts.resizeTo ?? 700 : opts.w ?? 462;
    if (w.w !== vw) {
      resize(w, vw);
      if (proof && !w.dead) proof.sizes.push([w.ticks, vw]);
    }
    t += dt;
    let flapIn: boolean;
    if (!started) {
      w.y = hover(t);
      flapIn = t > (opts.idle ?? 0.6);
      if (flapIn) {
        started = true;
        proof = { v: PROOF_VERSION, w: w.w, y0: w.y, flaps: [], sizes: [] };
      }
    } else flapIn = opts.flapEvery ? i % opts.flapEvery === 0 : autopilot(w);
    if (!started) continue;
    if (flapIn && proof && !w.dead) proof.flaps.push(w.ticks);
    step(w, dt, { flap: flapIn }, rng);
  }
  return { score: w.score, ticks: w.ticks, proof: proof!, world: w };
}

const at = (hz: number) => () => 1 / hz;
const jitter = (seed: number) => {
  const r = rng32(seed);
  return () => (1 / 60) * (0.4 + r() * 1.4);
};

test('a run replays to the same score and steps at any frame rate, with the window resized mid-flight', () => {
  const rates: [string, (i: number) => number][] = [['60 Hz', at(60)], ['144 Hz', at(144)], ['30 Hz', at(30)], ['jittery', jitter(5)]];
  let scored = 0;
  for (const [label, dt] of rates) {
    for (const seed of [3, 41, 977]) {
      const flown = fly(seed, dt, { resizeAt: 2400, resizeTo: 640 });
      const again = replay(seed, flown.proof);
      assert.ok(again, `${label} seed ${seed} did not replay`);
      assert.equal(again.score, flown.score, `${label} seed ${seed}`);
      assert.equal(again.ticks, flown.ticks, `${label} seed ${seed}`);
      scored += flown.score;
    }
  }
  assert.ok(scored > 50, `the runs should clear some columns (cleared ${scored})`);
});

test('an honest run passes, flown in about the time it took', () => {
  const flown = fly(11, at(60));
  assert.ok(flown.score > 5);
  const ms = flown.ticks * STEP * 1000;
  assert.equal(checkRun(11, flown.proof, flown.score, ms + 1200), null);
  // (with a minute of pauses too)
  assert.equal(checkRun(11, flown.proof, flown.score, ms + 60_000), null);
  // and it survives the trip as JSON
  assert.equal(checkRun(11, JSON.parse(JSON.stringify(flown.proof)), flown.score, ms + 1200), null);
});

test('a score that is not what the run flew is refused', () => {
  const flown = fly(11, at(60));
  const ms = flown.ticks * STEP * 1000 + 1000;
  assert.equal(checkRun(11, flown.proof, flown.score + 1, ms), 'score does not replay');
  assert.equal(checkRun(11, flown.proof, 507, ms), 'score does not replay');
  assert.equal(checkRun(11, flown.proof, flown.score - 1, ms), 'score does not replay');
});

test('the flaps only fly the course of their own seed', () => {
  const flown = fly(11, at(60));
  const ms = flown.ticks * STEP * 1000 + 1000;
  let refused = 0;
  for (const other of [12, 13, 14, 15, 16]) if (checkRun(other, flown.proof, flown.score, ms) !== null) refused++;
  assert.ok(refused >= 4, `another seed's course flew to the same score ${5 - refused} times in 5`);
});

test('a run claimed faster than it can be flown, or slowed right down, is refused', () => {
  const flown = fly(11, at(60));
  const ms = flown.ticks * STEP * 1000;
  assert.equal(checkRun(11, flown.proof, flown.score, ms - 5_000), 'too fast');
  assert.equal(checkRun(11, flown.proof, flown.score, 0), 'too fast');
  assert.equal(checkRun(11, flown.proof, flown.score, ms * 2 + 120_000), 'too slow');
});

test('edited proofs are refused', () => {
  const flown = fly(11, at(60));
  const ms = flown.ticks * STEP * 1000 + 1000;
  const edit = (change: (p: FlappyProof) => void) => {
    const p = structuredClone(flown.proof);
    change(p);
    return checkRun(11, p, flown.score, ms);
  };
  // a flap after the crash, a flap dropped, the tree started outside its hover
  assert.notEqual(edit((p) => p.flaps.push(flown.ticks + 5)), null);
  assert.notEqual(edit((p) => p.flaps.splice(Math.floor(p.flaps.length / 2), 1)), null);
  // (the course is the same on every window width, so a different width flies the same run: nothing to gain)
  assert.equal(edit((p) => (p.w = 2000)), null);
  assert.equal(edit((p) => (p.y0 = 100)), 'bad proof');
  assert.equal(edit((p) => (p.v = 2 as typeof PROOF_VERSION)), 'bad proof');
  assert.equal(edit((p) => p.flaps.reverse()), 'bad proof');
  assert.equal(edit((p) => (p.flaps = [])), 'bad proof');
  assert.equal(edit((p) => (p.flaps[0] = -1)), 'bad proof');
  assert.equal(edit((p) => (p.flaps[1] = 1.5)), 'bad proof');
  assert.equal(edit((p) => (p.sizes = [[10, 50]])), 'bad proof');
});

test('malformed proofs never replay', () => {
  for (const bad of [null, 1, 'x', [], {}, { v: 1 }, { v: 1, w: 400, y0: 252, flaps: 'no', sizes: [] }, { v: 1, w: 400, y0: 252, flaps: [0], sizes: [[0]] }, { v: 1, w: Number.NaN, y0: 252, flaps: [0], sizes: [] }]) {
    assert.equal(parseProof(bad), null, JSON.stringify(bad));
    assert.equal(checkRun(1, bad, 0, 10_000), 'bad proof');
  }
});

test('a run that keeps flapping without end is cut off rather than replayed forever', () => {
  // flaps every 12 frames from the floor of the course hold the tree up until it hits a column
  const flown = fly(7, at(60), { flapEvery: 12 });
  const again = replay(7, flown.proof);
  assert.ok(again);
  assert.equal(again.score, flown.score);
  // a proof that claims a flap an hour and more in is out of range
  assert.equal(parseProof({ ...flown.proof, flaps: [...flown.proof.flaps, 3600 * 120 + 1] }), null);
});
