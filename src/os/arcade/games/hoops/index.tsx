import { useEffect, useRef, useState } from 'react';
import { GameShell, sfx, useCanvas, useGameLoop, useKeys, useShell, useThree } from '../../kit';
import type { GameProps } from '../../types';
import { clamp } from './gl';
import {
  HOOP_Z,
  MAX_LIVE,
  RIM_Y,
  ROUND_SECONDS,
  SHOT_GAP,
  aimFromDrag,
  canShoot,
  create,
  currentSpot,
  fire,
  fmtClock,
  handPos,
  isThree,
  liveCount,
  makeWindow,
  roundSpec,
  shotVelocity,
  spotPos,
  stepGame,
  targetFor,
  type Aim,
  type Game as State,
  type Spot,
  type Tick,
  type Window,
} from './logic';
import { meta } from './meta';
import { build, type World } from './scene';
import './hoops.css';

export default function Game({ compact, onExit }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit}>
      <Play />
    </GameShell>
  );
}

type Hud = { clock: string; round: number; makes: number; target: number; low: boolean; fire: boolean; three: boolean; online: boolean };
type Pop = { id: number; text: string; kind: 'swish' | 'make' | 'fire'; x: number; y: number };
type Banner = { id: number; text: string; sub: string };

const roundSub = (round: number) => {
  const s = roundSpec(round);
  const moving = s.sway > 0 ? (round === 3 ? ' The hoop moves now.' : ' The hoop moves.') : '';
  return `Make ${s.target} in ${ROUND_SECONDS} seconds.${moving}`;
};

const hudOf = (g: State, online: boolean): Hud => ({
  clock: fmtClock(g.timeLeft),
  round: g.round,
  makes: g.makes,
  target: targetFor(g.round),
  low: g.timeLeft <= 10 && g.timeLeft > 0,
  fire: g.fire,
  three: isThree(currentSpot(g)),
  online,
});

function sounds(out: Tick, g: State) {
  if (out.rim) {
    const v = Math.min(0.2, 0.05 + out.rim * 0.035);
    sfx.tone({ freq: 860 + Math.random() * 160, to: 640, dur: 0.18, type: 'triangle', vol: v });
    sfx.tone({ freq: 1720, to: 1500, dur: 0.09, type: 'sine', vol: v * 0.45 });
  }
  if (out.board) {
    const v = Math.min(0.2, 0.06 + out.board * 0.03);
    sfx.tone({ freq: 190, to: 110, dur: 0.12, type: 'sine', vol: v });
    sfx.noise(0.05, v * 0.5);
  }
  if (out.floor) sfx.tone({ freq: 120, to: 70, dur: 0.08, type: 'sine', vol: Math.min(0.2, out.floor * 0.035) });
  for (const m of out.made ?? []) {
    sfx.noise(m.kind === 'swish' ? 0.24 : 0.14, m.kind === 'swish' ? 0.13 : 0.08);
    sfx.play('coin', m.kind === 'swish' ? 1.25 : 1);
  }
  if (out.fireOn) sfx.play('win', 1.4);
  if (out.fireOff) sfx.tone({ freq: 320, to: 150, dur: 0.25, type: 'sine', vol: 0.1 });
  if (out.buzzer) {
    sfx.tone({ freq: 196, dur: 0.7, type: 'sawtooth', vol: 0.11 });
    sfx.tone({ freq: 247, dur: 0.7, type: 'sawtooth', vol: 0.08 });
  }
  if (out.roundUp) sfx.play('win', 1.2);
  if (out.over) sfx.play('lose');
  void g;
}

function Play() {
  const shell = useShell();
  const keys = useKeys();
  const THREE = useThree();
  const { ref, size } = useCanvas<HTMLDivElement>();
  const world = useRef<World | null>(null);
  const state = useRef<State>(create());
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const aim = useRef<Aim | null>(null);
  const pending = useRef<{ aim: Aim; t: number } | null>(null);
  const kb = useRef({ yaw: 0, charging: false, power: 0, dir: 1, spot: -1 });
  const windows = useRef(new Map<string, Window>());
  const lastTick = useRef(0);
  const lastSecond = useRef(0);
  const hudKey = useRef('');
  const started = useRef(false);
  const popId = useRef(0);
  const [hud, setHud] = useState<Hud>(() => hudOf(state.current, false));
  const [meter, setMeter] = useState<{ power: number; win: Window } | null>(null);
  const [pops, setPops] = useState<Pop[]>([]);
  const [banner, setBanner] = useState<Banner | null>(null);
  const hudRef = useRef<HTMLDivElement | null>(null);

  // keep the HUD clear of the shell's score, controls and online badge, whatever their size
  useEffect(() => {
    const el = hudRef.current;
    const root = shell.root.current;
    if (!el || !root) return;
    const stage = el.parentElement!;
    const sr = stage.getBoundingClientRect();
    const k = stage.clientHeight ? sr.height / stage.clientHeight : 1;
    if (stage.clientHeight < 260) {
      el.style.top = '';
      return;
    }
    const w = el.offsetWidth * k;
    const left = sr.left + sr.width / 2 - w / 2 - 6 * k;
    const right = sr.left + sr.width / 2 + w / 2 + 6 * k;
    const u = parseFloat(getComputedStyle(root).getPropertyValue('--g-hoops-u')) || 1;
    let top = 10 * u;
    for (const b of root.querySelectorAll('.arcade-score, .arcade-ctrl, .arcade-online-status')) {
      const r = b.getBoundingClientRect();
      if (r.width && r.right > left && r.left < right && r.top - sr.top < 80 * k) top = Math.max(top, (r.bottom - sr.top) / k + 6 * u);
    }
    el.style.top = `${Math.round(top)}px`;
  }, [hud, size.w, size.h, shell.status]);

  useEffect(() => {
    if (shell.status !== 'playing') lastTick.current = 0;
    if (shell.status === 'playing' && !started.current) {
      started.current = true;
      state.current.pause = 1.1;
      shell.setScore(0);
      setBanner({ id: Date.now(), text: 'Round 1', sub: roundSub(1) });
    }
    if (shell.status !== 'playing') {
      drag.current = null;
      aim.current = null;
      setMeter(null);
    }
  }, [shell.status]);

  useEffect(() => {
    const host = ref.current;
    if (!THREE || !host) return;
    const w = build(THREE, host);
    if (!w) return;
    world.current = w;
    w.resize(host.clientWidth, host.clientHeight);
    shell.invalidate();
    return () => {
      w.dispose();
      world.current = null;
    };
  }, [THREE]);

  useEffect(() => {
    world.current?.resize(size.w, size.h);
  }, [size.w, size.h, THREE]);

  // the iPad and laptop frames scale the page down; size touch targets and text back up
  useEffect(() => {
    const el = shell.root.current;
    if (!el) return;
    const measure = () => {
      const k = el.offsetWidth ? el.getBoundingClientRect().width / el.offsetWidth : 1;
      const u = k > 0.2 && k < 0.99 ? Math.min(2, Math.ceil((1 / k) * 100) / 100) : 1;
      el.style.setProperty('--g-hoops-u', String(u));
    };
    measure();
    const t = [window.setTimeout(measure, 300), window.setTimeout(measure, 1200)];
    return () => t.forEach((id) => window.clearTimeout(id));
  }, [shell.status, size.w, size.h]);

  useEffect(() => {
    if (!pops.length) return;
    const id = window.setTimeout(() => setPops((p) => p.slice(1)), 1100);
    return () => window.clearTimeout(id);
  }, [pops]);

  useEffect(() => {
    if (!banner) return;
    const id = window.setTimeout(() => setBanner(null), 2000);
    return () => window.clearTimeout(id);
  }, [banner]);

  const windowFor = (s: Spot) => {
    const k = `${s.d}|${s.a}`;
    let w = windows.current.get(k);
    if (!w) {
      w = makeWindow(s);
      windows.current.set(k, w);
    }
    return w;
  };

  const shoot = (a: Aim) => {
    const g = state.current;
    if (!canShoot(g)) {
      if (!g.over && liveCount(g) < MAX_LIVE) pending.current = { aim: a, t: 0.6 };
      return;
    }
    if (!fire(g, a)) return;
    sfx.noise(0.05, 0.05);
    sfx.tone({ freq: 240, to: 330, dur: 0.08, type: 'sine', vol: 0.06 });
  };

  const pop = (text: string, kind: Pop['kind']) => {
    const w = world.current;
    const g = state.current;
    const p = w ? w.project({ x: g.hoop.x, y: RIM_Y + 0.75, z: HOOP_Z }) : { x: size.w / 2, y: size.h * 0.3 };
    const x = clamp(p.x, 60, Math.max(60, size.w - 60));
    const y = clamp(p.y, 54, Math.max(54, size.h - 40));
    setPops((list) => [...list.slice(-2), { id: ++popId.current, text, kind, x, y }]);
  };

  useGameLoop(
    (dt) => {
      const w = world.current;
      const g = state.current;
      const k = kb.current;
      if (!g.over) {
        if (k.spot !== g.spot + g.round * 100) {
          k.spot = g.spot + g.round * 100;
          k.yaw = 0;
        }
        const ax = keys.axis('left', 'right');
        if (ax) k.yaw = clamp(k.yaw + ax * 0.45 * dt, -0.6, 0.6);
        const s = currentSpot(g);
        if (keys.down('action') && !drag.current) {
          if (!k.charging) {
            k.charging = true;
            k.power = 0;
            k.dir = 1;
          }
          k.power += k.dir * (0.55 + Math.min(6, g.round) * 0.05) * dt;
          if (k.power >= 1) {
            k.power = 1;
            k.dir = -1;
          } else if (k.power <= 0) {
            k.power = 0;
            k.dir = 1;
          }
          aim.current = { yaw: k.yaw, power: k.power };
        } else if (k.charging) {
          k.charging = false;
          if (aim.current) shoot(aim.current);
          aim.current = null;
        } else if (!drag.current) aim.current = null;

        if (pending.current) {
          pending.current.t -= dt;
          if (canShoot(g)) {
            const a = pending.current.aim;
            pending.current = null;
            shoot(a);
          } else if (pending.current.t <= 0) pending.current = null;
        }

        const now = performance.now();
        const clockDt = lastTick.current ? Math.min(0.25, (now - lastTick.current) / 1000) : dt;
        lastTick.current = now;
        const out = stepGame(g, dt, clockDt);
        sounds(out, g);
        if (w) {
          if (out.rim) w.kick('rim', out.rim);
          if (out.board) w.kick('board', out.board);
        }
        for (const m of out.made ?? []) {
          w?.kick('swish', m.kind === 'swish' ? 1 : 0.6);
          pop(`${m.kind === 'swish' ? 'Swish' : m.three ? 'Three' : 'Bucket'} +${m.points}`, m.kind);
        }
        if (out.made) shell.setScore(g.score);
        if (out.fireOn) pop('On Fire', 'fire');
        if (out.roundUp) setBanner({ id: Date.now(), text: `Round ${g.round}`, sub: roundSub(g.round) });
        const sec = Math.ceil(g.timeLeft);
        if (sec !== lastSecond.current) {
          if (sec <= 5 && sec > 0 && g.pause <= 0) sfx.play('tick', 1.4);
          lastSecond.current = sec;
        }
        if (out.over) {
          const t = targetFor(g.round);
          shell.gameOver(g.score, {
            detail: `Round ${g.round}: ${g.makes} of ${t}. ${g.totalMakes} of ${g.attempts} shots, best streak ${g.bestStreak}.`,
          });
        }
        const next = hudOf(g, !!shell.root.current?.querySelector('.arcade-online-status'));
        const key = JSON.stringify(next);
        if (key !== hudKey.current) {
          hudKey.current = key;
          setHud(next);
        }
        if (aim.current) setMeter({ power: aim.current.power, win: windowFor(s) });
        else setMeter((m) => (m ? null : m));
      }
      if (!w) return;
      const s = currentSpot(g);
      const ready = !g.over && liveCount(g) < MAX_LIVE && g.moving <= 0 && g.cooldown < SHOT_GAP * 0.5;
      const hp = handPos(s);
      const lift = aim.current ? aim.current.power * 0.18 : 0;
      w.update(
        {
          balls: g.balls,
          hand: ready ? { ...hp, y: hp.y + lift } : null,
          hoopX: g.hoop.x,
          spot: spotPos(s),
          sway: roundSpec(g.round).sway,
          fire: g.fire,
          guide: aim.current && ready ? (({ p0, v }) => ({ p: p0, v }))(shotVelocity(s, aim.current)) : null,
        },
        dt,
      );
    },
    () => world.current?.render(),
  );

  const playing = shell.status === 'playing';
  const full = clamp(size.h * 0.75, 110, 340);

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (!playing || state.current.over || drag.current) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    sfx.unlock();
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    // device frames scale the page; measure the drag in the game's own pixels
    const el = e.currentTarget;
    const k = el.clientHeight ? el.getBoundingClientRect().height / el.clientHeight : 1;
    const dy = (e.clientY - d.y) / (k || 1);
    aim.current = -dy < 6 ? null : aimFromDrag((e.clientX - d.x) / (k || 1), dy, full);
  };
  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    const a = aim.current;
    aim.current = null;
    if (a && a.power > 0.02 && e.type === 'pointerup' && playing) shoot(a);
  };

  const short = size.h > 0 && size.h < 260;
  return (
    <div className={`g-hoops-stage${short ? ' is-short' : ''}`}>
      <div
        ref={ref}
        className={`g-hoops-host${hud.fire ? ' is-fire' : ''}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onLostPointerCapture={onUp}
      />
      <div ref={hudRef} className="g-hoops-hud" aria-live="off">
        <span className={hud.low ? 'is-low' : undefined}>{hud.clock}</span>
        <span>Round {hud.round}</span>
        <span>
          {hud.makes} of {hud.target}
        </span>
        {hud.three && <span>From Three</span>}
        {hud.fire && <span className="is-fire">On Fire</span>}
      </div>
      {meter && (
        <div className="g-hoops-meter" aria-hidden>
          <i className="g-hoops-zone" style={{ bottom: `${meter.win.lo * 100}%`, height: `${(meter.win.hi - meter.win.lo) * 100}%` }} />
          <i className="g-hoops-zone is-swish" style={{ bottom: `${meter.win.swishLo * 100}%`, height: `${Math.max(0.006, meter.win.swishHi - meter.win.swishLo) * 100}%` }} />
          <b
            className={meter.power >= meter.win.lo && meter.power <= meter.win.hi ? 'is-in' : undefined}
            style={{ height: `${meter.power * 100}%` }}
          />
        </div>
      )}
      {pops.map((p) => (
        <div key={p.id} className={`g-hoops-pop is-${p.kind}`} style={{ left: p.x, top: p.y }}>
          {p.text}
        </div>
      ))}
      {banner && playing && (
        <div key={banner.id} className="g-hoops-banner">
          <strong>{banner.text}</strong>
          <small>{banner.sub}</small>
        </div>
      )}
      {playing && state.current.attempts === 0 && !meter && !banner && !short && (
        <div className="g-hoops-hint">{shell.touch ? 'Swipe up to shoot, sideways to aim' : 'Drag up to shoot, or hold Space'}</div>
      )}
    </div>
  );
}
