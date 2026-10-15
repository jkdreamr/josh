import { useEffect, useRef, useState } from 'react';
import { GameShell, Segmented, TouchControls, defineSetting, sfx, useCanvas, useGameLoop, useHighScore, useKeys, useOnline, useSetting, useShell, useThree } from '../../kit';
import type { GameProps } from '../../types';
import { TOP, ZONES, buildLevel, zoneIndex } from './level';
import { COUNTDOWN, FALL_TOO_FAR, LAVA_DELAY, MODES, MODE_INFO, RANKED_MODES, RESPAWN_T, applyRemote, createGame, doRespawn, fmtTime, liveOf, lose, scheduleRespawn, seatSouls, step, teamHeight, win, type Ev, type Game, type Input, type Mode, type Seating, type Soul, type SoulSpec } from './logic';
import { JINGLE_BEACON, JINGLE_BURN, JINGLE_OUT, Sequencer, hz, type Note } from './music';
import { configOf, endOf, events, guestState, hostState, parsePacket, reportOf, syncClock, type NetEv, type SoulReport } from './net';
import { SHADE_INFO, SHADE_LEVELS, SHADE_NAMES, attachShades, createShade, driveShade, type ShadeLevel } from './shade';
import { buildView, type View } from './scene';
import { Altimeter, HowToPlay, TeamStrip, ZoneCard, type SoulChip } from './hud';
import { meta } from './meta';
import './chained.css';

const MODE = defineSetting('chained:mode', MODES, 'normal');
const PARTIES = ['solo', 'local'] as const;
const PARTY = defineSetting('chained:party', PARTIES, 'solo');
const MUSIC = defineSetting('chained:music', ['on', 'off'] as const, 'on', { live: true });
const SHADES = defineSetting('chained:shades', SHADE_LEVELS, 'even');
const modeOptions = MODES.map((m) => [m, MODE_INFO[m].label] as const);
const shadeOptions = SHADE_LEVELS.map((l) => [l, SHADE_INFO[l].label] as const);
type RankedMode = (typeof RANKED_MODES)[number];
const partyOptions = [
  ['solo', 'One Player'],
  ['local', 'Two on This Keyboard'],
] as const;
const musicOptions = [
  ['on', 'On'],
  ['off', 'Off'],
] as const;
/** Souls take their colour from their team and their place on its chain. */
const TEAM_COLORS = [
  ['#e84a3c', '#3b8bea'],
  ['#48b35a', '#f2c230'],
];
const SOLO_NAMES = ['Ember', 'Ash'];
const LOCAL_NAMES = ['Player 1', 'Player 2'];
/** The leaderboard (and local best) for a mode, solo or as a team. */
const boardOf = (team: boolean, mode: RankedMode) => `${team ? 'team' : 'solo'}-${mode}`;
const isRanked = (mode: Mode): mode is RankedMode => (RANKED_MODES as readonly string[]).includes(mode);
/** The host gives everyone a moment to get its first packet before the climb starts. */
const HOST_LEAD = 1.5;
/** Tips pop up during your first few climbs. */
const HINT_CLIMBS = 3;
const CLIMBS_KEY = 'arcade:chained-climbs';
const LEVEL = buildLevel();
const fmtMs = (ms: number) => fmtTime(ms / 1000);

function climbsRun() {
  try {
    return Number(window.localStorage.getItem(CLIMBS_KEY)) || 0;
  } catch {
    return 0;
  }
}
function countClimb() {
  try {
    window.localStorage.setItem(CLIMBS_KEY, String(climbsRun() + 1));
  } catch {
    /* storage blocked: the tips just keep showing */
  }
}

export default function Game({ compact, onExit, roomCode }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} roomCode={roomCode} lowerIsBetter formatScore={fmtMs} setup={<Setup />} hostSetup={<OnlineSetup />}>
      <Stage />
    </GameShell>
  );
}

type Best = ReturnType<typeof useHighScore>;
/** Your best time on every board (the same hooks in the same order every render). */
function useBests() {
  const bests: Record<string, Best> = {};
  for (const team of [false, true]) for (const mode of RANKED_MODES) bests[boardOf(team, mode)] = useHighScore(`chained-${boardOf(team, mode)}`, { lowerIsBetter: true });
  return bests;
}

/** How to Play, and the sheet it opens over the cards. */
function Extras() {
  const shell = useShell();
  const [open, setOpen] = useState(false);
  const close = () => {
    setOpen(false);
    shell.root.current?.focus({ preventScroll: true });
  };
  return (
    <div className="g-chained-extras">
      <button type="button" className="arcade-btn" onClick={() => setOpen(true)}>
        How to Play
      </button>
      {open && <HowToPlay root={shell.root.current} touch={shell.touch} onClose={close} />}
    </div>
  );
}

function Setup() {
  const shell = useShell();
  const [mode, setMode] = useSetting(MODE);
  const [party, setParty] = useSetting(PARTY);
  const [music, setMusic] = useSetting(MUSIC);
  const [shades, setShades] = useSetting(SHADES);
  const bests = useBests();
  const team = party === 'local' && !shell.touch;
  const best = isRanked(mode) ? bests[boardOf(team, mode)].best : null;
  return (
    <>
      <Segmented label="Mode" value={mode} options={modeOptions} onChange={setMode} />
      <small className="g-chained-note">{MODE_INFO[mode].blurb}</small>
      {!shell.touch && <Segmented label="Souls" value={party} options={partyOptions} onChange={setParty} />}
      {mode === 'race' && (
        <>
          <Segmented label="Shades" value={shades} options={shadeOptions} onChange={setShades} />
          <small className="g-chained-note">{team ? 'The two of you race the shades, a pair of souls the game climbs. ' : 'You race the shades, a pair of souls the game climbs. '}{SHADE_INFO[shades].blurb}</small>
        </>
      )}
      <Segmented label="Music" value={music} options={musicOptions} onChange={setMusic} />
      <Extras />
      {best !== null && isRanked(mode) && (
        <small className="g-chained-best">
          Best {team ? 'as a team' : 'on your own'} in {MODE_INFO[mode].label}: {fmtMs(best)}
        </small>
      )}
    </>
  );
}

/** Settings for online climbs: the host picks the mode for everyone and tells the room as it changes. */
function OnlineSetup() {
  const online = useOnline();
  const [mode, setMode] = useSetting(MODE);
  const [music, setMusic] = useSetting(MUSIC);
  const [shades, setShades] = useSetting(SHADES);
  const [hostPick, setHostPick] = useState<{ mode: Mode; shades: ShadeLevel } | null>(null);
  const host = online?.isHost ?? true;
  useEffect(() => {
    if (!online?.isHost) return;
    const say = () => online.send(configOf(online.round, mode, shades));
    say();
    const timer = window.setInterval(say, 2000);
    return () => window.clearInterval(timer);
  }, [online, mode, shades]);
  useEffect(() => {
    if (!online || online.isHost) return;
    return online.onMessage((from, d) => {
      const p = parsePacket(d);
      if (from === 0 && p?.k === 'cfg') setHostPick({ mode: p.mode, shades: p.shades });
    });
  }, [online]);
  const shown = host ? mode : hostPick?.mode ?? mode;
  const shownShades = host ? shades : hostPick?.shades ?? shades;
  const seats = online?.players.length ?? 1;
  const seating =
    shown !== 'race'
      ? 'Everyone climbs on one chain, in seat order.'
      : seats >= 4
        ? 'Seats 1 and 2 climb one chain, seats 3 and 4 the other.'
        : seats === 3
          ? 'Seats 1 and 2 climb one chain. Seat 3 climbs both souls of the other, swapping between them.'
          : seats === 2
            ? 'The two of you climb one chain against the shades.'
            : 'On your own you climb both souls of your chain against the shades. More players join as seats fill.';
  return (
    <>
      {host ? (
        <Segmented label="Mode" value={mode} options={modeOptions} onChange={setMode} />
      ) : (
        <div className="arcade-field">
          <span>Mode</span>
          <div className="g-chained-hostpick">
            <b>{hostPick ? MODE_INFO[hostPick.mode].label : '…'}</b>
            <small>picked by the host</small>
          </div>
        </div>
      )}
      <small className="g-chained-note">{MODE_INFO[shown].blurb}</small>
      {shown === 'race' &&
        (host ? (
          <Segmented label="Shades" value={shades} options={shadeOptions} onChange={setShades} />
        ) : (
          <div className="arcade-field">
            <span>Shades</span>
            <div className="g-chained-hostpick">
              <b>{SHADE_INFO[shownShades].label}</b>
              <small>picked by the host</small>
            </div>
          </div>
        ))}
      <small className="g-chained-note">
        {seating}
        {host ? ' You pick the mode.' : ''}
      </small>
      <Segmented label="Music" value={music} options={musicOptions} onChange={setMusic} />
      <Extras />
    </>
  );
}

type Kind = 'idle' | 'local' | 'online';

/** A fresh climb for each round, and the foot of the tower behind the Start card. */
function Stage() {
  const shell = useShell();
  const online = useOnline();
  const current = useRef<{ key: string; kind: Kind }>({ key: 'idle', kind: 'idle' });
  if (shell.status === 'ready') current.current = { key: 'idle', kind: 'idle' };
  else if (shell.status === 'playing') {
    const key = online ? `online:${online.round}` : `local:${shell.round}`;
    if (key !== current.current.key) current.current = { key, kind: online ? 'online' : 'local' };
  }
  return <Play key={current.current.key} kind={current.current.kind} />;
}

type OnlineApi = NonNullable<ReturnType<typeof useOnline>>;

/** The souls in an online room from its seating: yours are the ones you move, and the host moves the shades. */
function onlineSouls(o: OnlineApi, seating: Seating[], shades: ShadeLevel): SoulSpec[] {
  return seating.map((seat) => {
    if (seat.shade) return { seat: -1, name: SHADE_NAMES[seat.slot], color: TEAM_COLORS[seat.team][seat.slot], kind: o.isHost ? 'local' : 'remote', team: seat.team, driver: 'shade', pace: SHADE_INFO[shades].pace };
    const name = o.players.find((p) => p.seat === seat.seat)?.name ?? `Player ${seat.seat + 1}`;
    return { seat: seat.seat, name: seat.second ? `${name} II` : name, color: TEAM_COLORS[seat.team][seat.slot], kind: seat.seat === o.seat ? 'local' : 'remote', team: seat.team, driver: 'human' };
  });
}

/** The souls of a climb on this machine: one player with two souls, or two players with one each, and the shades in a race. */
function localSouls(seating: Seating[], coop: boolean, shades: ShadeLevel): SoulSpec[] {
  return seating.map((seat) => {
    if (seat.shade) return { seat: -1, name: SHADE_NAMES[seat.slot], color: TEAM_COLORS[seat.team][seat.slot], kind: 'local', team: seat.team, driver: 'shade', pace: SHADE_INFO[shades].pace };
    return { seat: seat.seat, name: (coop ? LOCAL_NAMES : SOLO_NAMES)[seat.slot], color: TEAM_COLORS[seat.team][seat.slot], kind: 'local', team: seat.team, driver: 'human' };
  });
}

/** The souls you steer: your own, never the shades. */
const steerable = (g: Game) => g.souls.filter((s) => s.kind === 'local' && s.driver === 'human');
/** Your team, the one the camera and the HUD follow. */
const myTeam = (g: Game) => steerable(g)[0]?.team ?? 0;
/** How to call the other chain in a race. */
function rivalName(g: Game) {
  const souls = (g.chains[1 - myTeam(g)] ?? []).map((i) => g.souls[i]);
  if (!souls.length || souls.every((s) => s.driver === 'shade')) return 'The shades';
  const names = [...new Set(souls.map((s) => s.name.replace(/ II$/, '')))];
  return names.length === 1 ? names[0] : `${names[0]} and ${names[1]}`;
}
/** The seat the room records as the winner: the first player on the winning team, or nobody when the shades won. */
function winnerSeat(g: Game, team: number) {
  const human = (g.chains[team] ?? []).map((i) => g.souls[i]).find((s) => s.driver === 'human');
  return human ? human.seat : null;
}

/** Plays one note of the soundtrack on the arcade synth, `delay` seconds from now. */
function playNote(note: Note, delay: number, stepLen: number) {
  const dur = note.len * stepLen;
  const f = note.midi ? hz(note.midi) : 0;
  switch (note.voice) {
    case 'drone':
      sfx.tone({ freq: f, dur: dur * 0.95, type: 'sawtooth', vol: 0.016, delay });
      sfx.tone({ freq: f / 2, dur: dur * 0.95, type: 'sine', vol: 0.06, delay });
      break;
    case 'bass':
      sfx.tone({ freq: f, dur: dur * 0.9, type: 'triangle', vol: 0.13, delay });
      break;
    case 'arp':
      sfx.tone({ freq: f, dur: Math.min(dur, 0.3), type: 'square', vol: 0.022, delay });
      break;
    case 'bell':
      sfx.tone({ freq: f, dur: dur * 1.6, type: 'triangle', vol: 0.06, delay });
      sfx.tone({ freq: f * 2.76, dur: dur * 0.5, type: 'sine', vol: 0.012, delay });
      break;
    case 'pad':
      sfx.tone({ freq: f, dur: dur, type: 'triangle', vol: 0.014, delay });
      break;
    case 'choir':
      sfx.tone({ freq: f, dur: dur, type: 'sine', vol: 0.02, delay });
      sfx.tone({ freq: f * 1.004, dur: dur, type: 'triangle', vol: 0.008, delay });
      break;
    case 'shimmer':
      sfx.tone({ freq: f, dur: dur * 1.4, type: 'sine', vol: 0.045, delay });
      break;
    case 'anvil':
      sfx.tone({ freq: 1760, dur: 0.06, type: 'square', vol: 0.05, delay });
      sfx.tone({ freq: 2637, dur: 0.04, type: 'triangle', vol: 0.03, delay });
      sfx.noise(0.04, 0.08, delay);
      break;
    case 'crackle':
      sfx.noise(0.02, 0.05, delay);
      break;
    case 'heart':
      sfx.tone({ freq: 72, to: 40, dur: 0.18, type: 'sine', vol: 0.22, delay });
      break;
  }
}

/** A short tune on the synth right away. */
function playJingle(notes: Note[]) {
  const stepLen = 60 / 76 / 4;
  for (const note of notes) playNote(note, 0.05 + note.step * stepLen, stepLen);
}

type Hud = {
  time: string;
  zone: number;
  cp: number;
  lit: boolean[];
  lava: number;
  souls: SoulChip[];
  active: number;
  heat: number;
  fade: number;
  wind: 'calm' | 'build' | 'gust';
  countdown: number;
  started: boolean;
  /** A race: the rival chain, its name and how many metres you lead by (negative when behind). */
  race: { rivals: SoulChip[]; name: string; lead: number } | null;
};

const soloInput = (keys: ReturnType<typeof useKeys>): Input => ({
  side: keys.axis('left', 'right') as -1 | 0 | 1,
  fwd: keys.axis('down', 'up') as -1 | 0 | 1,
  jump: keys.pressed('Space', 'Enter', 'KeyX'),
  hold: keys.down('Space', 'Enter', 'KeyX'),
});
const p1Input = (keys: ReturnType<typeof useKeys>): Input => ({
  side: ((keys.down('KeyD') ? 1 : 0) - (keys.down('KeyA') ? 1 : 0)) as -1 | 0 | 1,
  fwd: ((keys.down('KeyW') ? 1 : 0) - (keys.down('KeyS') ? 1 : 0)) as -1 | 0 | 1,
  jump: keys.pressed('Space'),
  hold: keys.down('Space'),
});
const p2Input = (keys: ReturnType<typeof useKeys>): Input => ({
  side: ((keys.down('ArrowRight') ? 1 : 0) - (keys.down('ArrowLeft') ? 1 : 0)) as -1 | 0 | 1,
  fwd: ((keys.down('ArrowUp') ? 1 : 0) - (keys.down('ArrowDown') ? 1 : 0)) as -1 | 0 | 1,
  jump: keys.pressed('Enter', 'ShiftRight'),
  hold: keys.down('Enter', 'ShiftRight'),
});
const noInput: Input = { side: 0, fwd: 0, jump: false, hold: false };

function Play({ kind }: { kind: Kind }) {
  const shell = useShell();
  const shellRef = useRef(shell);
  shellRef.current = shell;
  const keys = useKeys();
  const THREE = useThree();
  const online = useOnline();
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const live = kind === 'online' && !!online;
  const [mode] = useSetting(MODE);
  const [party] = useSetting(PARTY);
  const [music] = useSetting(MUSIC);
  const [shades] = useSetting(SHADES);
  const musicRef = useRef(music);
  musicRef.current = music;
  /** Two people on this keyboard (or, online, more than one soul on the chain): the lava gives a lone climber more time. */
  const team = live || (party === 'local' && !shell.touch);
  const bests = useBests();
  const { ref, size } = useCanvas<HTMLDivElement>();
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const view = useRef<View | null>(null);
  const game = useRef<Game | null>(null);
  const [gameKey, setGameKey] = useState(0);
  if (!game.current) {
    if (!live) {
      // a climb is two souls on one chain; a race seats two souls per team, the shades on the other chain
      const souls = mode === 'race' ? localSouls(seatSouls(team ? [0, 1] : [0], mode), team, shades) : [0, 1].map((i) => ({ seat: i, name: (team ? LOCAL_NAMES : SOLO_NAMES)[i], color: TEAM_COLORS[0][i], kind: 'local' as const }));
      game.current = createGame({ mode, souls, level: LEVEL, countdown: COUNTDOWN, solo: !team });
      attachShades(game.current, shades, 7 + shell.round);
    } else {
      const roster = [...online!.players].map((p) => p.seat).sort((a, b) => a - b);
      game.current = createGame({ mode, souls: onlineSouls(online!, seatSouls(roster, mode), shades), level: LEVEL, authority: online!.isHost, countdown: online!.isHost ? COUNTDOWN + HOST_LEAD : 60 });
      attachShades(game.current, shades, 7 + online!.round);
    }
  }
  const net = useRef({
    synced: !live || online!.isHost,
    ticks: 0,
    roster: live ? [...online!.players].map((p) => p.seat).sort((a, b) => a - b) : [],
    shades,
    reports: new Map<number, SoulReport>(),
    outbox: [] as NetEv[],
    respawnSent: [] as number[],
    end: null as { won: boolean; time: number; height: number; winner: number } | null,
    endSends: 0,
    over: false,
  });
  const song = useRef<Sequencer | null>(null);
  song.current ??= new Sequencer(playNote);
  /** The soul you are steering (an index into g.souls), when you have more than one. */
  const active = useRef(-1);
  const leadSign = useRef(0);
  const tap = useRef({ swap: false });
  const clock = useRef(0);
  const hudTick = useRef(0);
  const [hud, setHud] = useState<Hud>(() => ({ time: '0:00.00', zone: 0, cp: 0, lit: LEVEL.checkpoints.map((_, i) => i === 0), lava: -3, souls: [], active: 0, heat: 0, fade: 0, wind: 'calm', countdown: 1, started: false, race: null }));
  const [card, setCard] = useState<{ id: number; zone: number } | null>(null);
  const [toast, setToast] = useState<{ id: number; text: string; kind: 'tip' | 'note' | 'warn' } | null>(null);
  const [flash, setFlash] = useState<{ id: number; kind: 'strain' | 'burn' | 'beacon' } | null>(null);
  const [sky, setSky] = useState<{ id: number; zone: number }[]>([{ id: 0, zone: 0 }]);
  const skyZone = useRef(0);
  /** Keys for overlays that remount to restart their animation. */
  const nextId = useRef(0);
  const hints = useRef<{ on: boolean; seen: Set<string>; at: number; counted: boolean } | null>(null);
  hints.current ??= { on: kind !== 'idle' && climbsRun() < HINT_CLIMBS, seen: new Set(), at: -99, counted: false };
  const toastAt = useRef(-99);
  const fadeAt = useRef<number | null>(null);
  const tags = useRef(new Map<number, HTMLDivElement>());
  const hintTimers = useRef({ hanging: false, swap: false });

  /** A tip once per climb during your first few climbs, one at a time. */
  const showHint = (key: string, text: string) => {
    const h = hints.current!;
    if (!h.on || h.seen.has(key) || clock.current - toastAt.current < 4.5) return;
    h.seen.add(key);
    toastAt.current = clock.current;
    setToast({ id: ++nextId.current, text, kind: 'tip' });
  };
  const note = (text: string, kind: 'note' | 'warn' = 'note') => {
    if (clock.current - toastAt.current < 2.2) return;
    toastAt.current = clock.current;
    setToast({ id: ++nextId.current, text, kind });
  };

  useEffect(() => {
    const host = ref.current;
    if (!THREE || !host) return;
    const v = buildView(THREE, host, LEVEL, { lite: shell.touch });
    if (!v) return;
    view.current = v;
    v.resize(sizeRef.current.w, sizeRef.current.h);
    const g = game.current!;
    v.frame(g, focusOf(g), 0, 0, team && !live);
    v.render();
    shell.invalidate();
    return () => {
      v.dispose();
      view.current = null;
    };
  }, [THREE, gameKey]);

  useEffect(() => {
    view.current?.resize(size.w, size.h);
    shell.invalidate();
  }, [size.w, size.h, THREE, gameKey]);

  // dev only (localStorage arcade:dev = 1): lets a playtest put the team on any beacon
  useEffect(() => {
    if (!import.meta.env.DEV || kind === 'idle') return;
    try {
      if (window.localStorage.getItem('arcade:dev') !== '1') return;
    } catch {
      return;
    }
    const w = window as unknown as { __chained?: unknown };
    w.__chained = {
      get game() {
        return game.current;
      },
      beacon: (cp: number, team = 0) => {
        const g = game.current;
        if (g) doRespawn(g, cp, team);
      },
      // runs the simulation ahead by a few seconds, so a playtest can sample a whole climb quickly
      tick: (seconds: number) => {
        const g = game.current;
        if (!g) return;
        for (let t = 0; t < seconds; t += 1 / 60) {
          step(g, 1 / 60);
          for (const e of g.events.splice(0)) react(g, e);
          clock.current += 1 / 60;
          view.current?.frame(g, focusOf(g), 1 / 60, clock.current, team && !live);
        }
      },
      // lets the shades climb your chain too, so a playtest can watch a whole climb or race
      auto: (level: ShadeLevel = 'swift') => {
        const g = game.current;
        if (!g) return;
        const sh = createShade(g, myTeam(g), level, 3);
        g.drivers.push((game, dt) => driveShade(game, sh, dt));
      },
    };
    return () => {
      delete w.__chained;
    };
  }, [kind]);

  /** The souls you steer, with the one you are steering right now made current. */
  function owned(g: Game): Soul[] {
    const own = steerable(g);
    if (!own.some((s) => s.idx === active.current)) active.current = own[0]?.idx ?? 0;
    return own;
  }

  /** Which souls the camera frames: the one you steer first, then the rest of your chain. */
  function focusOf(g: Game): number[] {
    const own = owned(g);
    const chain = g.chains[own[0]?.team ?? 0] ?? g.chain;
    if (!own.length) return chain;
    const lead = active.current;
    return [lead, ...chain.filter((i) => i !== lead)];
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Online: souls at 15 Hz, crumbles and respawns as events, the result from the host.

  const finish = (won: boolean, time: number, height: number, winner: number) => {
    const n = net.current;
    if (n.over) return;
    n.over = true;
    const g = game.current!;
    const ms = Math.round(time * 1000);
    if (g.mode === 'race') {
      const mine = myTeam(g);
      const rival = rivalName(g);
      const gap = Math.max(0, Math.round(Math.abs(teamHeight(g, mine) - teamHeight(g, 1 - mine))));
      if (winner === mine) {
        playJingle(JINGLE_OUT);
        shellRef.current.gameOver(undefined, { title: 'You Won the Race', detail: `Out in ${fmtTime(time)}, with ${rival === 'The shades' ? 'the shades' : rival} ${gap < 2 ? 'right behind you' : `${gap} m below you`}.` });
      } else {
        sfx.play('lose');
        const z = ZONES[zoneIndex(teamHeight(g, mine))];
        shellRef.current.gameOver(undefined, { title: `${rival === 'The shades' ? 'The Shades' : rival} Won the Race`, detail: `They stood on the way out at ${fmtTime(time)}. You were ${gap} m below, in ${z.name}.` });
      }
      if (live && onlineRef.current) onlineRef.current.reportResult(onlineRef.current.round, winner >= 0 ? winnerSeat(g, winner) : null);
      return;
    }
    if (won && isRanked(g.mode)) {
      const newBest = bests[boardOf(team, g.mode)].submit(ms);
      playJingle(JINGLE_OUT);
      shellRef.current.gameOver(undefined, {
        title: 'You Climbed Out',
        detail: `${fmtTime(time)} from the pit to the stars${newBest ? ', a new best' : ''}. ${team ? 'Nobody let go.' : 'Both souls made it.'}`,
        board: boardOf(team, g.mode),
        rank: ms,
      });
    } else {
      const z = ZONES[zoneIndex(height)];
      sfx.play('lose');
      shellRef.current.gameOver(undefined, { title: 'Burned', detail: `The lava caught the team ${Math.floor(height)} m up, in ${z.name}.` });
    }
    if (live && onlineRef.current) onlineRef.current.reportResult(onlineRef.current.round, null);
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;

  useEffect(() => {
    if (!live) return;
    const n = net.current;
    const off = onlineRef.current!.onMessage((from, d) => {
      const o = onlineRef.current;
      const p = parsePacket(d);
      if (!o || !p || p.round !== o.round) return;
      let g = game.current!;
      if (p.k === 's') {
        if (!o.isHost || from === 0) return;
        // a guest moves only the souls seated to it
        for (const r of p.souls) {
          const s = g.souls[r.i];
          if (!s || s.kind !== 'remote' || s.seat !== from) continue;
          n.reports.set(r.i, r);
          applyRemote(g, s, r);
        }
      } else if (p.k === 'S') {
        if (o.isHost || from !== 0) return;
        if (!n.synced) {
          if (!p.roster.includes(o.seat)) return;
          g = game.current = createGame({ mode: p.mode, souls: onlineSouls(o, seatSouls(p.roster, p.mode), p.shades), level: LEVEL, authority: false, countdown: 0 });
          g.time = p.time;
          n.roster = p.roster;
          n.shades = p.shades;
          n.synced = true;
          setGameKey((x) => x + 1);
        } else g.time = syncClock(g.time, p.time);
        if (p.cp > g.cp) {
          g.cp = p.cp;
          for (let i = 0; i <= p.cp && i < g.lit.length; i++) g.lit[i] = true;
        }
        for (const r of p.souls) {
          const s = g.souls[r.i];
          if (s && s.kind === 'remote') applyRemote(g, s, r);
        }
      } else if (p.k === 'e') {
        if (p.o === o.seat) return;
        for (const ev of p.ev) applyNetEvent(g, p.o, ev);
        if (o.isHost) o.send(d);
      } else if (p.k === 'end') {
        if (from !== 0 || o.isHost || n.end) return;
        n.end = { won: p.won, time: p.time, height: p.height, winner: p.winner };
        if (p.won) win(g, p.time, Math.max(0, p.winner));
        else lose(g);
        finishRef.current(p.won, p.time, p.height, p.winner);
      }
    });
    const timer = window.setInterval(() => {
      const o = onlineRef.current;
      const g = game.current;
      if (!o || !g || !n.synced) return;
      n.ticks++;
      // every soul this client moves: yours, and on the host the shades too
      const mine = g.souls.filter((s) => s.kind === 'local');
      if (!mine.length) return;
      if (!o.isHost) {
        o.send(guestState(o.round, mine.map(reportOf)), { fast: n.ticks % 5 !== 0 });
        return;
      }
      const present = new Set(o.players.map((p) => p.seat));
      const souls: SoulReport[] = [...mine.map(reportOf), ...g.souls.filter((s) => s.kind === 'remote' && present.has(s.seat) && n.reports.has(s.idx)).map((s) => n.reports.get(s.idx)!)];
      o.send(hostState(o.round, g.time, g.cp, g.mode, n.shades, n.roster, souls), { fast: n.ticks % 5 !== 0 });
      // the host watches every team for a fall too far below the beacon
      if (g.mode === 'beginner' && g.time > 0) {
        for (let t = 0; t < g.teams; t++) {
          if (g.respawn[t]) continue;
          const alive = liveOf(g, t).map((i) => g.souls[i].y);
          if (alive.length && Math.min(...alive) < g.level.checkpoints[g.cp].y - FALL_TOO_FAR) scheduleRespawn(g, g.cp, g.time + 0.5, t);
        }
      }
      g.respawn.forEach((r, t) => {
        if (r && n.respawnSent[t] !== r.at) {
          n.respawnSent[t] = r.at;
          o.send(events(o.round, o.seat, [{ y: 'respawn', cp: r.cp, at: r.at, team: t }]));
        }
      });
      if (!n.end && (g.won !== null || g.lost)) n.end = { won: g.won !== null, time: g.won ?? g.time, height: g.lost?.height ?? TOP, winner: g.winner ?? -1 };
      if (n.end && n.endSends < 4) {
        n.endSends++;
        o.send(endOf(o.round, n.end.won, n.end.time, n.end.height, n.end.winner));
      }
    }, 66);
    return () => {
      off();
      window.clearInterval(timer);
    };
  }, [live]);

  function applyNetEvent(g: Game, from: number, ev: NetEv) {
    if (ev.y === 'crumble') {
      if (!g.crumbles.has(ev.id)) {
        g.crumbles.set(ev.id, ev.at);
        react(g, { t: 'crumble', id: ev.id, phase: 'warn' });
      }
    } else if (ev.y === 'respawn') {
      g.cp = Math.max(g.cp, ev.cp);
      scheduleRespawn(g, ev.cp, ev.at, ev.team);
    } else if (ev.y === 'cp') {
      if (ev.cp > g.cp) {
        g.cp = ev.cp;
        g.lit[ev.cp] = true;
        react(g, { t: 'checkpoint', cp: ev.cp, i: Math.min(ev.i, g.souls.length - 1) });
      }
    } else if (ev.y === 'fell') {
      if (g.authority && g.mode === 'beginner') scheduleRespawn(g, g.cp, g.time + 0.5, ev.team);
    } else if (ev.y === 'burn') {
      const s = g.souls[ev.i];
      if (s && s.kind === 'remote' && (s.seat === from || from === 0) && s.burned < 0) applyRemote(g, s, { x: s.x, y: s.y, z: s.z, vx: 0, vy: 0, vz: 0, flags: 4 });
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // The frame loop: input, simulation, sounds, camera, HUD.

  useGameLoop(
    (dt) => {
      const g = game.current!;
      const v = view.current;
      const n = net.current;
      clock.current += dt;
      if (kind === 'idle') {
        v?.frame(g, focusOf(g), dt, clock.current, team);
        return;
      }
      if (!n.synced) {
        v?.frame(g, focusOf(g), dt, clock.current, false);
        return;
      }
      // input: two on this keyboard steer a soul each; otherwise you steer one of your souls and swap between them
      const own = owned(g);
      if (team && !live) {
        g.souls[0].input = p1Input(keys);
        g.souls[1].input = p2Input(keys);
      } else {
        if (own.length > 1 && (keys.pressed('ShiftLeft', 'ShiftRight', 'KeyQ', 'KeyE') || tap.current.swap) && g.won === null && !g.lost) {
          const next = own[(own.findIndex((s) => s.idx === active.current) + 1) % own.length];
          if (next.burned < 0) {
            active.current = next.idx;
            sfx.play('select', 0.9);
          }
        }
        for (const s of own) s.input = s.idx === active.current ? soloInput(keys) : noInput;
      }
      tap.current.swap = false;

      step(g, dt);
      for (const e of g.events.splice(0)) {
        react(g, e);
        if (live) outgoing(g, e);
      }
      if (live && onlineRef.current && n.outbox.length) onlineRef.current.send(events(onlineRef.current.round, onlineRef.current.seat, n.outbox.splice(0)));

      // the soundtrack: from the first step to the last, and a heartbeat when the lava is close
      const now = sfx.clock();
      if (musicRef.current === 'on' && now !== null && g.time >= 0 && g.won === null && !g.lost) {
        const low = lowOf(g);
        const danger = g.mode === 'lava' && g.time > LAVA_DELAY - 2 ? Math.max(0, Math.min(1, 1 - (low - g.lava) / 10)) : 0;
        song.current!.tick(now, v?.zone ?? zoneIndex(low), danger);
      }

      if (v) {
        v.frame(g, focusOf(g), dt, clock.current, team && !live);
        placeTags(g, v);
      }

      // the end of the climb
      if (!live) {
        if (g.won !== null) finish(true, g.won, TOP, g.winner ?? 0);
        else if (g.lost) finish(false, g.time, g.lost.height, -1);
      } else if (!n.over) {
        if (g.won !== null && onlineRef.current?.isHost) finish(true, g.won, TOP, g.winner ?? 0);
        else if (g.lost) finish(false, g.time, g.lost.height, -1);
      }
      updateHud(g, dt);
    },
    () => view.current?.render(),
  );

  /** The lowest soul still climbing on your chain. */
  function lowOf(g: Game) {
    const alive = liveOf(g, myTeam(g)).map((i) => g.souls[i].y);
    return alive.length ? Math.min(...alive) : teamHeight(g, myTeam(g));
  }

  function outgoing(g: Game, e: Ev) {
    const out = net.current.outbox;
    if (e.t === 'crumble' && e.phase === 'warn') out.push({ y: 'crumble', id: e.id, at: g.crumbles.get(e.id) ?? g.time });
    else if (e.t === 'burn' && g.souls[e.i]?.kind === 'local') out.push({ y: 'burn', i: e.i });
    else if (e.t === 'checkpoint' && g.souls[e.i]?.kind === 'local') out.push({ y: 'cp', cp: e.cp, i: e.i });
  }

  function react(g: Game, e: Ev) {
    const v = view.current;
    const s = 'i' in e ? g.souls[e.i] : undefined;
    const us = myTeam(g);
    const mine = !s || (s.kind === 'local' && s.driver === 'human');
    const ours = 'team' in e ? e.team === us : !s || s.team === us;
    switch (e.t) {
      case 'go':
        sfx.tone({ freq: 660, dur: 0.16, type: 'square', vol: 0.1 });
        setCard({ id: ++nextId.current, zone: 0 });
        if (!hints.current!.counted) {
          hints.current!.counted = true;
          countClimb();
        }
        if (steerable(g).length > 1) showHint('swap', shellRef.current.touch ? 'You steer one soul at a time. Tap swap to steer the other.' : 'You steer one soul at a time. Shift swaps to the other.');
        if (g.mode === 'race') showHint('race', `${rivalName(g)} climb the same tower. First chain with both souls on the way out wins.`);
        break;
      case 'jump':
        if (mine) sfx.play('jump', 0.85 + (s?.idx ?? 0) * 0.08);
        break;
      case 'land':
        if (e.hard) {
          sfx.noise(0.14, 0.22);
          sfx.tone({ freq: 90, to: 50, dur: 0.16, type: 'sine', vol: 0.2 });
        } else if (e.surface === 'ice') sfx.tone({ freq: 1400, to: 900, dur: 0.05, type: 'triangle', vol: 0.06 });
        else {
          sfx.tone({ freq: 170, to: 110, dur: 0.05, type: 'triangle', vol: mine ? 0.12 : 0.06 });
          sfx.noise(0.03, mine ? 0.06 : 0.03);
        }
        break;
      case 'mantle':
        sfx.tone({ freq: 240, to: 380, dur: 0.09, type: 'triangle', vol: 0.09 });
        break;
      case 'step':
        if (e.surface === 'metal') sfx.tone({ freq: 640 + Math.random() * 60, dur: 0.02, type: 'square', vol: mine ? 0.03 : 0.015 });
        else if (e.surface === 'ice') sfx.tone({ freq: 1500 + Math.random() * 200, dur: 0.02, type: 'triangle', vol: mine ? 0.025 : 0.012 });
        else sfx.noise(0.02, mine ? 0.035 : 0.018);
        break;
      case 'taut':
        if (e.speed > 1.5) {
          const p = 0.9 + Math.min(0.6, e.speed / 20);
          sfx.tone({ freq: 1900 * p, to: 950 * p, dur: 0.06, type: 'square', vol: Math.min(0.1, 0.04 + e.speed / 100) });
          sfx.tone({ freq: 2700 * p, dur: 0.04, type: 'triangle', vol: 0.03 });
        }
        break;
      case 'yank':
        if (!ours) break;
        sfx.tone({ freq: 230, to: 70, dur: 0.16, type: 'sawtooth', vol: 0.14 });
        sfx.noise(0.08, 0.1);
        if (mine) setFlash({ id: ++nextId.current, kind: 'strain' });
        break;
      case 'hang':
        if (!ours) break;
        sfx.tone({ freq: 320, to: 260, dur: 0.14, type: 'triangle', vol: 0.06 });
        if (!hintTimers.current.hanging) {
          hintTimers.current.hanging = true;
          showHint('hang', steerable(g).length > 1 && !team ? 'Your other soul is hanging. Walk away from the edge to haul it up, or swap and climb.' : 'A soul is hanging. Whoever is standing: walk away from the edge to haul them up.');
        }
        break;
      case 'crumble':
        if (e.phase === 'warn') {
          sfx.noise(0.5, 0.08);
          for (let i = 0; i < 4; i++) sfx.tone({ freq: 140 + i * 30, dur: 0.03, type: 'square', vol: 0.04, delay: i * 0.11 });
          showHint('crumble', 'That ledge is giving way. Keep moving, and do not leave anyone standing on one.');
        } else {
          sfx.noise(0.5, 0.25);
          sfx.tone({ freq: 120, to: 55, dur: 0.4, type: 'triangle', vol: 0.15 });
        }
        break;
      case 'spring':
        sfx.tone({ freq: 220, to: 880, dur: 0.26, type: 'sine', vol: 0.15 });
        break;
      case 'checkpoint':
        if (!ours) break;
        playJingle(JINGLE_BEACON);
        setFlash({ id: ++nextId.current, kind: 'beacon' });
        if (g.mode === 'beginner') note(`Beacon ${e.cp} lit. The team starts here now.`);
        else note(`Beacon ${e.cp} lit.`);
        break;
      case 'zone':
        if (!ours) break;
        sfx.tone({ freq: 110, dur: 1.4, type: 'sine', vol: 0.22 });
        sfx.tone({ freq: 220, dur: 1.0, type: 'triangle', vol: 0.06 });
        sfx.tone({ freq: 165, dur: 0.8, type: 'sine', vol: 0.05, delay: 0.1 });
        setCard({ id: ++nextId.current, zone: e.zone });
        if (e.zone === 2) showHint('forge', 'Lifts rise and fall. Springs throw you higher than any jump.');
        else if (e.zone === 3) showHint('frost', 'Ice. You keep sliding after you let go, so brake early.');
        else if (e.zone === 4) showHint('cathedral', 'The slabs here swing on rails. Wait for one to come to you.');
        else if (e.zone === 5) showHint('stars', 'The wind gusts in cycles up here. Cross the long gaps in the calm.');
        break;
      case 'burn':
        if (!ours) {
          sfx.noise(0.3, 0.1);
          note(`${rivalName(g)} fell into the lava.`);
          break;
        }
        sfx.noise(0.6, 0.3);
        sfx.tone({ freq: 400, to: 60, dur: 0.5, type: 'sawtooth', vol: 0.2 });
        playJingle(JINGLE_BURN);
        setFlash({ id: ++nextId.current, kind: 'burn' });
        if (g.mode !== 'lava') fadeAt.current = g.time + RESPAWN_T;
        break;
      case 'respawn':
        if (!ours) break;
        sfx.tone({ freq: 520, to: 780, dur: 0.22, type: 'triangle', vol: 0.1 });
        fadeAt.current = null;
        note(e.cp === 0 ? 'Back at the bottom.' : `Back at beacon ${e.cp}.`);
        break;
      case 'gust':
        if (e.phase === 'build') sfx.noise(1.0, 0.06);
        else sfx.noise(1.6, 0.13);
        if (e.phase === 'gust') note(`Wind from the ${e.dir > 0 ? 'left' : 'right'}.`, 'warn');
        break;
      case 'win':
        break;
      case 'lose':
        break;
    }
    v?.react(e, g);
  }

  /** Name tags over the souls you do not steer: the others online, and the shades. */
  const tagged = (s: Soul) => !(s.kind === 'local' && s.driver === 'human');
  function placeTags(g: Game, v: View) {
    if (!live && g.mode !== 'race') return;
    const { w, h } = sizeRef.current;
    for (const s of g.souls) {
      const el = tags.current.get(s.idx);
      if (!el) continue;
      const p = !tagged(s) || s.burned >= 0 ? null : v.tagOf(s.idx, w, h);
      if (!p || p.x < -40 || p.x > w + 40 || p.y < -20 || p.y > h + 20) el.style.display = 'none';
      else {
        el.style.display = '';
        el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%)`;
      }
    }
  }

  function updateHud(g: Game, dt: number) {
    hudTick.current -= dt;
    if (hudTick.current > 0) return;
    hudTick.current = 1 / 8;
    const v = view.current;
    const us = myTeam(g);
    const own = owned(g);
    const zone = v?.zone ?? zoneIndex(teamHeight(g, us));
    if (zone !== skyZone.current) {
      skyZone.current = zone;
      setSky((list) => [...list.slice(-1), { id: ++nextId.current, zone }]);
    }
    const low = lowOf(g);
    const heat = g.mode === 'lava' ? Math.max(0, Math.min(1, 1 - (low - g.lava) / 7)) : 0;
    let fade = 0;
    const pending = g.respawn[us];
    if (pending) fade = Math.max(0, Math.min(1, 1 - (pending.at - g.time) / RESPAWN_T));
    const chip = (idx: number, rival: boolean): SoulChip => {
      const s = g.souls[idx];
      return {
        idx: s.idx,
        name: s.name,
        color: s.color,
        y: s.y,
        me: !rival && (team && !live ? false : own.length > 1 ? s.idx === active.current : s.kind === 'local' && s.driver === 'human'),
        rival,
        state: s.burned >= 0 ? 'burned' : s.hanging ? 'hanging' : s.finished ? 'out' : s.grounded ? 'climbing' : 'air',
      };
    };
    const souls = (g.chains[us] ?? g.chain).map((idx) => chip(idx, false));
    let race: Hud['race'] = null;
    if (g.mode === 'race' && g.teams > 1) {
      const them = 1 - us;
      const lead = teamHeight(g, us) - teamHeight(g, them);
      race = { rivals: g.chains[them].map((idx) => chip(idx, true)), name: rivalName(g), lead };
      // the lead changing hands is a moment
      const sign = Math.abs(lead) < 1.5 ? leadSign.current : Math.sign(lead);
      if (g.started && g.won === null && sign !== leadSign.current && g.time > 3) {
        if (sign > 0) note('You have the lead.');
        else if (sign < 0) note(`${race.name} ${race.name === 'The shades' ? 'have' : 'has'} the lead.`, 'warn');
      }
      leadSign.current = sign;
    }
    const next: Hud = {
      time: fmtTime(Math.max(0, g.won ?? g.time)),
      zone,
      cp: g.cp,
      lit: g.lit,
      lava: g.lava,
      souls,
      active: active.current,
      heat,
      fade,
      wind: g.gustPhase,
      countdown: g.time < 0 ? -g.time : 0,
      started: g.started,
      race,
    };
    setHud(next);
  }

  const playing = shell.status === 'playing' && kind !== 'idle';
  const g = game.current!;
  /** More than one soul to steer: the swap key, the halo and the "steering" chip. */
  const solo = !(team && !live) && steerable(g).length > 1;
  const leadWord = !hud.race ? '' : Math.abs(hud.race.lead) < 1 ? 'level' : shell.touch ? `${hud.race.lead > 0 ? '+' : '-'}${Math.abs(Math.round(hud.race.lead))} m` : `${Math.abs(Math.round(hud.race.lead))} m ${hud.race.lead > 0 ? 'ahead' : 'behind'}`;
  const skyOf = (zone: number) => {
    const p = ZONES[zone].palette.sky;
    return `linear-gradient(180deg, ${p[0]} 0%, ${p[1]} 55%, ${p[2]} 100%)`;
  };

  return (
    <>
      <div className="g-chained-skies" aria-hidden="true">
        {sky.map((s, i) => (
          <div key={s.id} className={`g-chained-sky${i === sky.length - 1 && sky.length > 1 ? ' is-in' : ''}`} style={{ background: skyOf(s.zone) }} />
        ))}
      </div>
      <div ref={ref} className="g-chained-host" />
      {playing && (
        <>
          <div className="g-chained-top" style={{ ['--ink' as string]: ZONES[hud.zone].palette.ink }}>
            <span className="g-chained-time">{hud.time}</span>
            <span className="g-chained-modetag">{MODE_INFO[g.mode].label}</span>
            {hud.race && hud.started && <span className={`g-chained-lead${hud.race.lead >= 1 ? ' is-ahead' : hud.race.lead <= -1 ? ' is-behind' : ''}`}>{leadWord}</span>}
          </div>
          {hud.countdown > 0 && !live && <div className="g-chained-ready">ready</div>}
          {live && !net.current.synced && <div className="g-chained-ready">waiting for the host</div>}
          {card && (
            <div key={card.id} className="g-chained-cardwrap" onAnimationEnd={() => setCard(null)}>
              <ZoneCard zone={card.zone} />
            </div>
          )}
          <Altimeter souls={hud.race ? [...hud.race.rivals, ...hud.souls] : hud.souls} lava={hud.lava} lit={hud.lit} checkpoints={LEVEL.checkpoints} mode={g.mode} zone={hud.zone} />
          <TeamStrip souls={hud.souls} rivals={hud.race?.rivals} active={hud.active} solo={solo} touch={shell.touch} />
          {toast && (
            <div key={toast.id} className={`g-chained-toast is-${toast.kind}`} onAnimationEnd={() => setToast(null)}>
              {toast.text}
            </div>
          )}
          {hud.wind !== 'calm' && hud.zone === 5 && <div className={`g-chained-windtag is-${hud.wind}`}>{hud.wind === 'build' ? 'wind rising' : 'gust'}</div>}
          {hud.heat > 0 && <div className="g-chained-heat" style={{ opacity: hud.heat }} aria-hidden="true" />}
          {hud.fade > 0 && <div className="g-chained-fade" style={{ opacity: hud.fade }} aria-hidden="true" />}
          {flash && <div key={flash.id} className={`g-chained-flash is-${flash.kind}`} onAnimationEnd={() => setFlash(null)} aria-hidden="true" />}
          {(live || g.mode === 'race') &&
            g.souls.filter(tagged).map((s) => (
              <div
                key={s.idx}
                className="g-chained-tag"
                style={{ ['--soul' as string]: s.color }}
                ref={(el) => {
                  if (el) tags.current.set(s.idx, el);
                  else tags.current.delete(s.idx);
                }}
              >
                {s.name}
              </div>
            ))}
          <TouchControls dpad buttons={solo ? [{ key: 'Space', label: 'jump' }, { key: 'KeyQ', label: 'swap' }] : [{ key: 'Space', label: 'jump' }]} />
        </>
      )}
    </>
  );
}

