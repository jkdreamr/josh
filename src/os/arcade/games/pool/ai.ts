// Computer opponent for pool. Deterministic per seed; budgets its thinking time.
// Unlike logic.ts, trig/log are fine here, determinism is only an engine requirement.

import {
  type Game,
  type Group,
  type Seat,
  type Shot,
  HEAD_X,
  L,
  POCKETS,
  R,
  W,
  clampPlace,
  cloneGame,
  groupOf,
  legalTargets,
  pocketFor,
  remaining,
  resolve,
  rng,
  runSim,
  startShot,
  traceAim,
} from './logic.ts';

export type Level = 0 | 1 | 2; // easy normal hard

const norm = (x: number, y: number) => Math.sqrt(x * x + y * y);

const rot = (dx: number, dy: number, ang: number) => {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return { x: dx * c - dy * s, y: dx * s + dy * c };
};

const gauss = (rand: () => number) => {
  const u = Math.max(1e-9, rand());
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

// a point a little way inside the pocket mouth, so aims don't clip the jaws
const pocketAim = (i: number) => {
  const p = POCKETS[i];
  const cx = L / 2 - p.x;
  const cy = W / 2 - p.y;
  const d = norm(cx, cy) || 1;
  const pull = p.side ? 0.045 : 0.05;
  return { x: p.x + (cx / d) * pull, y: p.y + (cy / d) * pull };
};

type Cand = {
  ball: number;
  pocket: number;
  ghost: { x: number; y: number };
  aim: { x: number; y: number }; // unit cue-ball aim direction
  cut: number; // cut angle, radians
  dist: number; // cue->ball + ball->pocket
  place?: { x: number; y: number };
};

// is the corridor from the object ball to the pocket clear of other balls?
const pathClear = (game: Game, from: { x: number; y: number }, dir: { x: number; y: number }, dist: number, skip: number) => {
  for (const b of game.balls) {
    if (b.down || b.id === 0 || b.id === skip) continue;
    const ox = b.x - from.x;
    const oy = b.y - from.y;
    const t = ox * dir.x + oy * dir.y;
    if (t < 0 || t > dist) continue;
    const perp = Math.abs(ox * dir.y - oy * dir.x);
    if (perp < 2 * R - 0.002) return false;
  }
  return true;
};

function candidates(game: Game, seat: Seat): Cand[] {
  const cue = game.balls[0];
  const out: Cand[] = [];
  const targets = legalTargets(game, seat);
  const spots: ({ x: number; y: number } | undefined)[] = [undefined];
  for (const id of targets) {
    const b = game.balls[id];
    if (b.down) continue;
    for (let pi = 0; pi < POCKETS.length; pi++) {
      const aim = pocketAim(pi);
      const px = aim.x - b.x;
      const py = aim.y - b.y;
      const pd = norm(px, py);
      if (pd < 1e-6) continue;
      const ux = px / pd;
      const uy = py / pd;
      const ghost = { x: b.x - 2 * R * ux, y: b.y - 2 * R * uy };
      const places = game.ballInHand ? spots.concat(placeSpots(game, ghost)) : [undefined];
      for (const place of places) {
        const from = place ?? { x: cue.x, y: cue.y };
        const ax = ghost.x - from.x;
        const ay = ghost.y - from.y;
        const ad = norm(ax, ay);
        if (ad < 1e-6) continue;
        const dir = { x: ax / ad, y: ay / ad };
        const cosCut = dir.x * ux + dir.y * uy;
        const cut = Math.acos(Math.min(1, Math.max(-1, cosCut)));
        if (cut > (80 * Math.PI) / 180) continue;
        // traceAim takes the start point explicitly and ignores the cue ball, so
        // the same call validates shots from a placement too.
        const tr = traceAim(game, from, dir.x, dir.y);
        if (tr.hit !== id) continue;
        if (!pathClear(game, b, { x: ux, y: uy }, pd, id)) continue;
        out.push({ ball: id, pocket: pi, ghost, aim: dir, cut, dist: ad + pd, place });
      }
    }
  }
  return out;
}

// placements on the line behind the ghost position, 0.15-0.35 back
function placeSpots(game: Game, ghost: { x: number; y: number }): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const back of [0.15, 0.22, 0.3, 0.35]) {
    for (const a of [0, 0.35, -0.35, 0.7, -0.7]) {
      // walk back from the ghost along the table-centre direction (a heuristic "behind")
      const bx = L / 2 - ghost.x;
      const by = W / 2 - ghost.y;
      const bd = norm(bx, by) || 1;
      const dir = rot(bx / bd, by / bd, a);
      const px = ghost.x + dir.x * back;
      const py = ghost.y + dir.y * back;
      const spot = clampPlace(game, px, py);
      if (spot) out.push(spot);
    }
  }
  return out;
}

const myGroup = (game: Game, seat: Seat): Group | null => game.groups[seat];

// geometric ease of the best available pot for `seat` from the given ball layout (no sim)
function ease(game: Game, seat: Seat): number {
  const cue = game.balls[0];
  let best = 0;
  for (const id of legalTargets(game, seat)) {
    const b = game.balls[id];
    if (b.down) continue;
    for (let pi = 0; pi < POCKETS.length; pi++) {
      const aim = pocketAim(pi);
      const px = aim.x - b.x;
      const py = aim.y - b.y;
      const pd = norm(px, py);
      if (pd < 1e-6) continue;
      const ux = px / pd;
      const uy = py / pd;
      const gx = b.x - 2 * R * ux;
      const gy = b.y - 2 * R * uy;
      const ax = gx - cue.x;
      const ay = gy - cue.y;
      const ad = norm(ax, ay);
      if (ad < 1e-6) continue;
      const cosCut = (ax * ux + ay * uy) / ad;
      const cut = Math.acos(Math.min(1, Math.max(-1, cosCut)));
      if (cut > 1.35) continue;
      if (!pathClear(game, b, { x: ux, y: uy }, pd, id)) continue;
      const score = Math.cos(cut) / (0.4 + ad + pd * 0.7);
      if (score > best) best = score;
    }
  }
  return best;
}

// simulate a shot on a scratch copy and grade the outcome for `seat`
function evalShot(game: Game, seat: Seat, shot: Shot): { score: number; game: Game } {
  const before = cloneGame(game);
  const sim = runSim(startShot(before, shot));
  const g2 = resolve(before, shot, sim);
  const opp: Seat = seat === 0 ? 1 : 0;
  let score = 0;
  if (g2.winner === seat) score += 10000;
  if (g2.winner === opp) score -= 10000;
  if (g2.foul) score -= 400;
  if (!g2.foul && g2.turn === seat) score += 60;
  const grp = myGroup(game, seat);
  for (const id of sim.potted) {
    if (id === 0) score -= 300;
    else if (id === 8) continue;
    else if (grp === null || groupOf(id) === grp) score += 100;
    else score -= 40;
  }
  // mild preference for cue shape near the middle
  const cue = g2.balls[0];
  score -= (Math.abs(cue.x - L / 2) + Math.abs(cue.y - W / 2)) * 8;
  return { score, game: g2 };
}

// ball-in-hand shots must carry a legal place; find one if the candidate lacks it
const ensurePlace = (game: Game, shot: Shot): Shot => {
  if (!game.ballInHand || shot.place) return shot;
  const spot =
    clampPlace(game, game.balls[0].x, game.balls[0].y) ??
    clampPlace(game, HEAD_X * 0.6, W / 2) ??
    clampPlace(game, L / 2, W / 2);
  return spot ? { ...shot, place: spot } : shot;
};

function unit(x: number, y: number) {
  const d = norm(x, y) || 1;
  return { x: x / d, y: y / d };
}

function fallbackShot(game: Game, seat: Seat, rand: () => number, power = 0.6): Shot {
  // aim full-ball at the nearest legal target; guaranteed a legal attempt
  const cue = game.balls[0];
  const targets = legalTargets(game, seat);
  let bestId = targets[0] ?? 8;
  let bestD = Infinity;
  for (const id of targets) {
    const b = game.balls[id];
    if (b.down) continue;
    const d = norm(b.x - cue.x, b.y - cue.y);
    if (d < bestD) {
      bestD = d;
      bestId = id;
    }
  }
  const b = game.balls[bestId];
  const dir = b && !b.down ? unit(b.x - cue.x, b.y - cue.y) : { x: 1, y: 0 };
  const shot: Shot = { dx: dir.x, dy: dir.y, power };
  if (b && bestId === 8) {
    const call = pocketFor(game, 8, { x: dir.x, y: dir.y });
    if (call !== null) shot.call = call;
  }
  if (game.ballInHand) {
    const spot = clampPlace(game, cue.x, cue.y) ?? clampPlace(game, HEAD_X * 0.6, W / 2);
    if (spot) shot.place = spot;
  }
  void rand;
  return shot;
}

const BUDGET: Record<Level, number> = { 0: 40, 1: 250, 2: 750 };

// would this shot's first contact be legal (something hit, and a legal target)?
function firstLegal(game: Game, shot: Shot): boolean {
  const sim = runSim(startShot(cloneGame(game), shot));
  return sim.first !== null && legalTargets(game, game.turn).includes(sim.first);
}

// final guard on every non-break return: the computer never misses everything
// and never hits an illegal ball first (scratches / no-rail can still happen).
function legalize(
  game: Game,
  shot: Shot,
  rand: () => number,
  deadline: number,
  redraw?: { dx: number; dy: number; sigmaDeg: number },
): Shot {
  const me = game.turn;
  if (firstLegal(game, shot)) return shot;
  const probe = (s: Shot): 'bad' | 'lose' | 'ok' => {
    const sim = runSim(startShot(cloneGame(game), s));
    if (sim.first === null || !legalTargets(game, me).includes(sim.first)) return 'bad';
    const g2 = resolve(cloneGame(game), s, sim);
    return g2.winner !== null && g2.winner !== me ? 'lose' : 'ok';
  };
  // (a) easy: re-draw the aim noise a few times around the same clean aim
  if (redraw) {
    for (let i = 0; i < 6 && performance.now() < deadline; i++) {
      const d = rot(redraw.dx, redraw.dy, (gauss(rand) * redraw.sigmaDeg * Math.PI) / 180);
      const s = ensurePlace(game, { ...shot, dx: d.x, dy: d.y });
      if (firstLegal(game, s)) return s;
    }
    // (b) the clean noiseless aim
    const s = ensurePlace(game, { ...shot, dx: redraw.dx, dy: redraw.dy });
    if (firstLegal(game, s)) return s;
  }
  // (c) first candidate by geometric ease whose clean aim passes
  const cands = candidates(game, me).sort(
    (a, b) => Math.cos(b.cut) / (0.3 + b.dist) - Math.cos(a.cut) / (0.3 + a.dist),
  );
  for (const c of cands) {
    if (performance.now() > deadline) break;
    const s: Shot = { dx: c.aim.x, dy: c.aim.y, power: 0.55 };
    if (c.place) s.place = c.place;
    if (c.ball === 8) s.call = c.pocket;
    const placed = ensurePlace(game, s);
    if (firstLegal(game, placed)) return placed;
  }
  // (d) sweep 72 directions at power 0.5 for a legal, non-losing contact
  for (let i = 0; i < 72 && performance.now() < deadline; i++) {
    const ang = (i / 72) * Math.PI * 2;
    const s = ensurePlace(game, { dx: Math.cos(ang), dy: Math.sin(ang), power: 0.5 });
    if (probe(s) === 'ok') return s;
  }
  // (e) give up and return what we were given
  return shot;
}

function breakShot(game: Game, yOff: number, power: number, spin: number): Shot {
  const place = clampPlace(game, HEAD_X * 0.6, W / 2 + yOff) ?? clampPlace(game, HEAD_X * 0.5, W / 2);
  const from = place ?? { x: game.balls[0].x, y: game.balls[0].y };
  // aim at the apex ball (smallest x in the rack)
  let apex = game.balls[1];
  for (const b of game.balls) if (!b.down && b.id !== 0 && b.x < apex.x) apex = b;
  const dir = unit(apex.x - from.x, apex.y - from.y);
  const shot: Shot = { dx: dir.x, dy: dir.y, power, spin };
  if (place) shot.place = place;
  return shot;
}

// grade a break for the breaker: any foul is out, then balls down and keeping the table
function breakScore(game: Game, shot: Shot): number {
  const sim = runSim(startShot(cloneGame(game), shot));
  const g2 = resolve(cloneGame(game), shot, sim);
  if (g2.foul) return -1000;
  const down = sim.potted.filter((id) => id !== 0).length;
  return down * 100 + (g2.turn === game.turn ? 60 : 0) + sim.breakRails.length;
}

// Easy breaks softer, Hard harder and picks the best of its tries; every level
// simulates its break and drops tries that scratch or fail the four-rail rule.
function chooseBreak(game: Game, level: Level, rand: () => number, deadline: number): Shot {
  const base = level === 2 ? 1 : level === 1 ? 0.95 : 0.75 + rand() * 0.15;
  const tries: Shot[] = [breakShot(game, (rand() - 0.5) * 0.1, base, 0)];
  for (const spin of [-0.4, 0, -0.8, 0.3]) {
    for (const yOff of [0, 0.04, -0.04, 0.08, -0.08]) {
      for (const p of level === 0 ? [base, 0.9] : [base, base - 0.05]) tries.push(breakShot(game, yOff, p, spin));
    }
  }
  let best = tries[0];
  let bestS = -Infinity;
  for (let i = 0; i < tries.length; i++) {
    // always look at a handful even on a slow machine, so a foul is never chosen for lack of time
    if (i >= 6 && performance.now() > deadline) break;
    const s = breakScore(game, tries[i]);
    if (s > bestS) {
      bestS = s;
      best = tries[i];
    }
    if (s > -1000 && level < 2) break; // easy and normal take the first clean break
    if (level === 2 && i >= 12 && bestS > 100) break;
  }
  return best;
}

export function chooseShot(game: Game, level: Level, opts?: { budgetMs?: number; seed?: number }): Shot {
  const t0 = performance.now();
  const budget = opts?.budgetMs ?? BUDGET[level];
  const over = () => performance.now() - t0 > budget;
  const rand = rng(opts?.seed ?? game.seed + game.shots);
  const me = game.turn;

  // --- the break ---
  if (game.phase === 'break') return chooseBreak(game, level, rand, t0 + budget);

  const on8 = game.groups[me] !== null && remaining(game, game.groups[me] as Group).length === 0;
  const cands = candidates(game, me);
  const deadline = t0 + budget + 150; // legalize may over-run the budget a little

  if (level === 0) {
    // geometric pick, no simulation
    let clean: Shot;
    if (cands.length) {
      let best = cands[0];
      let bestS = -Infinity;
      for (const c of cands) {
        const s = Math.cos(c.cut) / (0.3 + c.dist);
        if (s > bestS) {
          bestS = s;
          best = c;
        }
      }
      clean = { dx: best.aim.x, dy: best.aim.y, power: 0.35 + rand() * 0.45 };
      if (best.place) clean.place = best.place;
      if (best.ball === 8) {
        const call = pocketFor(game, 8, unit(best.ghost.x - game.balls[8].x, best.ghost.y - game.balls[8].y));
        clean.call = call ?? best.pocket;
      }
    } else {
      clean = fallbackShot(game, me, rand, 0.5);
      if (game.ballInHand && !clean.place) {
        const spot = clampPlace(game, W / 2, W / 2) ?? clampPlace(game, L / 2, W / 2);
        if (spot) clean.place = spot;
      }
    }
    const dir = rot(clean.dx, clean.dy, (gauss(rand) * 1.8 * Math.PI) / 180);
    const shot = ensurePlace(game, { ...clean, dx: dir.x, dy: dir.y });
    return legalize(game, shot, rand, deadline, { dx: clean.dx, dy: clean.dy, sigmaDeg: 1.8 });
  }

  // normal + hard: simulate candidates
  const powers = level === 1 ? [0.4, 0.6, 0.85] : [0.35, 0.5, 0.65, 0.8, 0.95];
  const spins = level === 1 ? [0] : [-0.6, 0, 0.6];
  type Scored = { shot: Shot; score: number; after: Game; cand: Cand };
  const scored: Scored[] = [];
  for (const c of cands) {
    if (over()) break;
    for (const p of powers) {
      for (const sp of spins) {
        if (over()) break;
        const shot: Shot = { dx: c.aim.x, dy: c.aim.y, power: p, spin: sp };
        if (c.place) shot.place = c.place;
        if (c.ball === 8) shot.call = c.pocket;
        const { score, game: g2 } = evalShot(game, me, shot);
        let s = score + Math.cos(c.cut) * 15 - c.dist * 4 - Math.abs(sp) * 3;
        if (level === 2) {
          // 1-ply lookahead: ease of the next shot for whoever is on it
          const next = g2.turn;
          const e = ease(g2, next);
          s += next === me ? e * 30 : -e * 30;
        }
        scored.push({ shot, score: s, after: g2, cand: c });
      }
    }
  }

  scored.sort((a, b) => b.score - a.score);

  if (level === 1) {
    const noise = (gauss(rand) * 0.5 * Math.PI) / 180;
    // prefer the best scored shot that doesn't itself resolve to a foul or a loss
    const pick =
      scored.find((s) => !s.after.foul && !(s.after.winner !== null && s.after.winner !== me)) ?? scored[0];
    if (pick && pick.score > -350) {
      const s = pick.shot;
      const dir = rot(s.dx, s.dy, noise);
      const noisy = ensurePlace(game, { ...s, dx: dir.x, dy: dir.y });
      // the noise can turn a winning line into a foul or a lost 8; check it
      const chk = evalShot(game, me, noisy);
      const chosen =
        chk.game.foul || (chk.game.winner !== null && chk.game.winner !== me)
          ? ensurePlace(game, s)
          : noisy;
      return legalize(game, chosen, rand, deadline);
    }
    return legalize(game, fallbackShot(game, me, rand, 0.55), rand, deadline);
  }

  // hard: robustness re-check of the top candidates under +-0.25deg aim error
  const noiseH = (gauss(rand) * 0.1 * Math.PI) / 180;
  const top = scored.slice(0, 6);
  let bestShot: Shot | null = null;
  let bestScore = -Infinity;
  for (const s of top) {
    if (over()) break;
    let total = s.score;
    for (const da of [-0.0044, 0.0044]) {
      const dir = rot(s.shot.dx, s.shot.dy, da);
      const { score } = evalShot(game, me, { ...s.shot, dx: dir.x, dy: dir.y });
      total += Math.min(0, score) * 0.5; // penalize outcomes that collapse under error
    }
    if (total > bestScore) {
      bestScore = total;
      bestShot = s.shot;
    }
  }

  // if nothing pots reliably, play a safety: legal first contact + a rail, minimize opp ease
  if (bestShot === null || bestScore < -200) {
    let safe: Shot | null = null;
    let safeScore = -Infinity;
    const targets = legalTargets(game, me);
    const cue = game.balls[0];
    for (let i = 0; i < 48; i++) {
      if (over()) break;
      const ang = (i / 48) * Math.PI * 2;
      const dir = { x: Math.cos(ang), y: Math.sin(ang) };
      for (const p of [0.25, 0.5, 0.75]) {
        const shot: Shot = { dx: dir.x, dy: dir.y, power: p };
        if (game.ballInHand) {
          const spot = clampPlace(game, cue.x, cue.y);
          if (!spot) continue;
          shot.place = spot;
        }
        const sim = runSim(startShot(cloneGame(game), shot));
        if (sim.first === null || !targets.includes(sim.first)) continue;
        if (!sim.railAfterFirst && sim.potted.length === 0) continue;
        const g2 = resolve(cloneGame(game), shot, sim);
        if (g2.foul) continue;
        if (g2.winner !== null && g2.winner !== me) continue; // never pick a losing safety
        const s = -ease(g2, me === 0 ? 1 : 0);
        if (s > safeScore) {
          safeScore = s;
          safe = shot;
        }
      }
    }
    if (safe) bestShot = safe;
  }

  if (bestShot === null) return legalize(game, fallbackShot(game, me, rand, 0.55), rand, deadline);
  bestShot = ensurePlace(game, bestShot);
  if (on8 && bestShot.call === undefined) {
    const call = pocketFor(game, 8, { x: bestShot.dx, y: bestShot.dy });
    if (call !== null) bestShot = { ...bestShot, call };
  }
  const dir = rot(bestShot.dx, bestShot.dy, noiseH);
  const noisy = { ...bestShot, dx: dir.x, dy: dir.y };
  let chosen = noisy;
  if (!over()) {
    // verify the noisy aim still does what the clean one was picked for
    const chk = evalShot(game, me, noisy);
    if (chk.game.foul || (chk.game.winner !== null && chk.game.winner !== me)) chosen = bestShot;
  }
  return legalize(game, chosen, rand, deadline);
}
