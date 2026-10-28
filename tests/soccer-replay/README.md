# Soccer input replays

Run with Node 24: `node --test tests/arcade-soccer-scenarios.test.ts`.
These recordings are simulation inputs, not the game's visual replay buffer.

Version 1 recordings use zero-based frames and inclusive RLE `from` / `to`
ranges. Missing commands mean neutral input; overlapping commands for the same
seat are invalid. `recordFrames` copies commands, so later input mutations do not
rewrite history. Fixtures are JSON, loaded relative to the helper, not the cwd.

`seats` maps controller seat numbers to initial player IDs. It is authoritative
over the default humans created by `createWorld`; `humans` is its constructor
setting. CPU commands come from the real `computeAI` on every simulation tick,
then recorded human commands override them. `mode` records the controller
arrangement; it does not alter simulation physics. Setup runs once, before input:
an optional real `setRestart`, then ball/player overrides. With `setup.park: true`,
players start in two far, spread lines (x = ±35, z = (id % 11 - 5) × 5);
only relevant exceptions need overrides. `createReplayWorld` exposes this initial
geometry for deriving intended receivers. `cpuRestarts: true` hands human seats
to the CPU during restarts, then restores recorded control when play resumes.
Identity changes,
arbitrary world mutation, and mid-replay teleports are deliberately unsupported.

Every scenario runs the global invariants. Event assertions describe outcomes,
not exact positions. Direction fixtures surround the passer with eight distinct
options and use the movement stick (no separate aim) to select each one.
Direction tests assert both selection and actual reception. The keeper fixture
accepts either a hold or parry: keeper touch, unchanged score, never inNet.
Foul input first creates advantage with a loose ball
ahead of the victim, then another human takes possession to recall the foul.

Phone presence uses the exported `missingPhoneSeats` and mirrors the host gate
in `index.tsx`: skip AI/physics and discard elapsed time while missing a seat.
The test compares the resumed world to an uninterrupted run of the same number
of simulation steps. This verifies the deterministic gate contract, not React's
render loop or networking; no game-source seam was added.

The stuck-ball invariant uses the simulation's `nearestCarrier` control
eligibility, not mere proximity: any live, uncontrolled ball staying within
0.5 m of its anchor for over three seconds fails, including balls wedged near
players who cannot control them.

## CPU soak

`node --test tests/arcade-soccer-soak.test.ts` exercises six full four-minute
matches and invariant/metric validation. Its one-seed samples deliberately do
not assert population balance; the full soak does.

`npm run soccer:soak` runs 50 seeded eight-minute matches per same-level and
cross-level pairing in six workers. Override with `--seeds COUNT --start INTEGER`
or `SOCCER_SOAK_SEEDS` / `SOCCER_SOAK_START`. Seeds are successive integers
multiplied by 113. Every match uses the global invariant observer and
`createMatchStatsObserver`; failures are collected so the table is complete.
The command exits nonzero on invariant, balance, completion, or ladder failure.

Bands in `bands.ts` retain the existing tests' numbers; W/L count thresholds
are expressed as rates using the original 8/10-match denominators. The same
goals, shots, passing, possession, foul/offside and card limits are checked
for each same-level difficulty; cross-level rows assert the ladder instead.
No empirical save-percentage band exists in the current soccer tests, so that
metric is reported without inventing a tuning threshold.

## Known gameplay regression

The seed-47 four-minute fast soak also has executable TODOs, reproduced with
the same observer against the clean main worktree: easy/easy players 9/10
overlap for more than 0.5 seconds at frame 3420; hard/easy players 20/21 overlap
at frame 2334 and an uncontrolled ball remains anchored for over three seconds
at frame 3613. The full soak retains these invariants as hard failures.

`kick-in.json` is an executable TODO, with its intended assertion intact.
A ball at (10, 34) moving outwards at 14 m/s bounces back into play rather than
awarding a throw-in to team 1. `physics.ts:stepBall` clamps z to 34 and reverses
velocity on each substep; `logic.ts:stepWorld` calls `resolveBoundary` afterwards,
which requires |z| > 34.04. The boundary rule itself works when invoked on an
already-outside ball. Fix the physics/rules ordering rather than accepting the
bounce as the scenario's expected result.
