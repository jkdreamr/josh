// Sound on the arcade synth: gunshots by gun (a close crack and thump, a far rumble that arrives late at the speed of
// sound), footsteps you can hear coming, hits, knockouts, reloads, grenades, the round cues, and a royale's pickups,
// heals, jump, canopy and zone warnings.
import { sfx } from '../../kit';
import type { Ev, Match } from './match.ts';
import { WEAPONS, type WeaponClass } from './weapons.ts';

const SHOT: Record<WeaponClass, { noise: number; vol: number; thump: number; crack: number; range: number }> = {
  pistol: { noise: 0.07, vol: 0.2, thump: 150, crack: 0, range: 110 },
  smg: { noise: 0.06, vol: 0.17, thump: 160, crack: 0, range: 120 },
  shotgun: { noise: 0.2, vol: 0.32, thump: 85, crack: 0, range: 150 },
  rifle: { noise: 0.1, vol: 0.24, thump: 110, crack: 2400, range: 220 },
  dmr: { noise: 0.13, vol: 0.28, thump: 100, crack: 2600, range: 260 },
  sniper: { noise: 0.22, vol: 0.36, thump: 70, crack: 3000, range: 380 },
};

const jit = () => 0.94 + Math.random() * 0.12;

export function shotSound(cls: WeaponClass, dist: number, mine: boolean) {
  const s = SHOT[cls];
  if (mine) {
    sfx.noise(s.noise, s.vol);
    sfx.tone({ freq: s.thump * jit(), to: 38, dur: 0.14, type: 'sine', vol: s.vol * 0.9 });
    sfx.tone({ freq: s.thump * 2.2 * jit(), to: 90, dur: 0.05, type: 'square', vol: s.vol * 0.18 });
    sfx.noise(0.35, s.vol * 0.08, 0.06);
    return;
  }
  const k = Math.max(0, 1 - dist / s.range);
  if (k <= 0.01) return;
  const delay = Math.min(1.2, dist / 343);
  // a supersonic crack when it passes near, then the report arriving late with distance
  if (s.crack && dist > 25) sfx.tone({ freq: s.crack * jit(), to: s.crack * 0.4, dur: 0.03, type: 'triangle', vol: 0.05 * k });
  sfx.noise(s.noise * (1 + (1 - k) * 2.5), s.vol * k * k * 0.7 + 0.01, delay);
  sfx.tone({ freq: s.thump * (0.7 + k * 0.3), to: 30, dur: 0.18 + (1 - k) * 0.25, type: 'sine', vol: s.vol * k * 0.6, delay });
}

export function stepSound(dist: number, mine: boolean, loud: boolean, surface: string) {
  const v = mine ? 0.035 : loud ? Math.max(0, 1 - dist / 26) * 0.09 : 0;
  if (v <= 0.004) return;
  sfx.noise(surface === 'water' ? 0.12 : 0.045, v);
  sfx.tone({ freq: 90 * jit(), to: 60, dur: 0.04, type: 'sine', vol: v * 0.6 });
}

export function hitConfirm(head: boolean, kill: boolean, armor: boolean) {
  if (kill) {
    sfx.tone({ freq: 880, dur: 0.07, type: 'triangle', vol: 0.12 });
    sfx.tone({ freq: 1320, dur: 0.12, type: 'triangle', vol: 0.12, delay: 0.07 });
    return;
  }
  if (head) {
    sfx.tone({ freq: 2300, dur: 0.07, type: 'triangle', vol: 0.11 });
    sfx.tone({ freq: 3100, dur: 0.05, type: 'sine', vol: 0.06, delay: 0.01 });
    return;
  }
  sfx.tone({ freq: armor ? 1500 : 1100, dur: 0.035, type: 'triangle', vol: 0.07 });
}

export function hurtSound(head: boolean) {
  sfx.tone({ freq: 160 * jit(), to: 60, dur: 0.18, type: 'sine', vol: 0.2 });
  sfx.noise(0.08, 0.12);
  if (head) sfx.tone({ freq: 3600, to: 3000, dur: 0.3, type: 'sine', vol: 0.04 });
}

export function reloadSound(w: keyof typeof WEAPONS) {
  const t = WEAPONS[w].reload;
  sfx.tone({ freq: 700, dur: 0.03, type: 'square', vol: 0.05, delay: 0.1 });
  sfx.noise(0.05, 0.05, t * 0.35);
  sfx.tone({ freq: 520, dur: 0.04, type: 'square', vol: 0.06, delay: t * 0.6 });
  sfx.tone({ freq: 900, dur: 0.03, type: 'square', vol: 0.06, delay: t * 0.85 });
}

export function boomSound(dist: number) {
  const k = Math.max(0, 1 - dist / 220);
  if (k <= 0) return;
  const delay = Math.min(0.7, dist / 343);
  sfx.noise(0.6 + (1 - k) * 0.5, 0.35 * k + 0.03, delay);
  sfx.tone({ freq: 70, to: 25, dur: 0.6, type: 'sine', vol: 0.35 * k, delay });
}

/** Plays what this frame's events sound like from where you are. */
export function playEvents(m: Match, evs: Ev[], ex: number, ez: number, you: number) {
  const d = (x: number, z: number) => Math.hypot(x - ex, z - ez);
  // a hundred players can fire a lot at once: a few distant shots a frame are enough to hear a fight
  let far = 0;
  let steps = 0;
  for (const e of evs) {
    switch (e.t) {
      case 'shot': {
        const mine = e.a === you;
        const dist = d(e.x, e.z);
        if (!mine && dist > 25 && ++far > 4) break;
        shotSound(WEAPONS[e.w].cls, dist, mine);
        break;
      }
      case 'step': {
        const a = m.actors[e.a];
        if (!a) break;
        const sd = d(a.body.x, a.body.z);
        if (e.a === you || (sd < 26 && ++steps <= 3)) stepSound(sd, e.a === you, e.loud, e.s);
        break;
      }
      case 'hit':
        if (e.a === you && e.v !== you) hitConfirm(e.zone === 'head', e.kill, e.armor);
        if (e.v === you) hurtSound(e.zone === 'head');
        break;
      case 'reload':
        if (e.a === you) reloadSound(e.w);
        break;
      case 'empty':
        if (e.a === you) sfx.tone({ freq: 1200, dur: 0.02, type: 'square', vol: 0.05 });
        break;
      case 'swap':
        if (e.a === you) sfx.noise(0.04, 0.04);
        break;
      case 'throw':
        if (e.a === you) sfx.noise(0.12, 0.05);
        break;
      case 'bounce':
        if (d(e.x, e.z) < 30) sfx.tone({ freq: 1700 * jit(), dur: 0.03, type: 'triangle', vol: 0.05 * (1 - d(e.x, e.z) / 30) });
        break;
      case 'boom':
        boomSound(d(e.x, e.z));
        break;
      case 'smoke':
        if (d(e.x, e.z) < 80) sfx.noise(1.2, 0.08 * (1 - d(e.x, e.z) / 80));
        break;
      case 'jump':
        if (e.a === you) sfx.noise(0.04, 0.03);
        break;
      case 'land':
        if (e.a === you) sfx.tone({ freq: 80, to: 50, dur: 0.06, type: 'sine', vol: 0.08 });
        break;
      case 'buy':
        if (e.a === you) sfx.play('coin');
        break;
      case 'phase':
        if (e.phase === 'live') {
          sfx.tone({ freq: 440, dur: 0.12, type: 'triangle', vol: 0.12 });
          sfx.tone({ freq: 660, dur: 0.2, type: 'triangle', vol: 0.12, delay: 0.12 });
        } else if (e.phase === 'buy') sfx.tone({ freq: 520, dur: 0.1, type: 'triangle', vol: 0.08 });
        break;
      case 'round': {
        const me = m.actors[you];
        const won = e.winner === me.team;
        if (e.winner < 0) sfx.play('tick');
        else sfx.play(won ? 'win' : 'lose');
        break;
      }
      case 'spawn':
        if (e.a === you) sfx.tone({ freq: 600, to: 900, dur: 0.12, type: 'triangle', vol: 0.08 });
        break;
      case 'pickup':
        if (e.a === you) sfx.tone({ freq: e.item.kind === 'gun' ? 340 : 760, to: e.item.kind === 'gun' ? 220 : 980, dur: 0.06, type: 'triangle', vol: 0.07 });
        break;
      case 'heal':
        if (e.a === you) sfx.tone({ freq: e.done ? 620 : 380, to: e.done ? 880 : 420, dur: e.done ? 0.18 : 0.08, type: 'sine', vol: 0.07 });
        break;
      case 'jumpout':
        if (e.a === you) sfx.noise(0.9, 0.09, 0.5);
        break;
      case 'chute':
        if (e.a === you) {
          sfx.noise(0.18, 0.12);
          sfx.tone({ freq: 140, to: 70, dur: 0.25, type: 'sine', vol: 0.1 });
        }
        break;
      case 'zone':
        if (e.shrinking) {
          sfx.tone({ freq: 300, dur: 0.18, type: 'square', vol: 0.05 });
          sfx.tone({ freq: 240, dur: 0.3, type: 'square', vol: 0.05, delay: 0.22 });
        }
        break;
      default:
        break;
    }
  }
}
