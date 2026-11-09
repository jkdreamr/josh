import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { GameShell, LEVEL_NAMES, Segmented, TouchControls, defineSetting, levelOptions, sfx, useCanvas, useGameLoop, useKeys, useOnline, useSetting, useShell, useThree } from '../../kit';
import type { GameProps } from '../../types';
import { createAudio } from './audio.ts';
import { Hud } from './hud.tsx';
import type { HudModel } from './hud.tsx';
import { createWorld, movePlayer, predictContactPoint, previewTarget, strikeRadius, STEP, stepWorld, teamSeats, timingLabel, type Command, type Format, type Level, type MatchLength, type MoveInput, type Player, type PointCall, type ShotKind, type Swing, type World } from './logic.ts';
import { configOf, commandOf, eventOf, moveOf, parsePacket, serveOf, stateOf, swingOf } from './net.ts';
import { meta } from './meta.ts';
import { createScene, type View } from './scene.ts';
import { CHARACTER_IDS, characterOf, lineup, ROSTER, seatCharacter, STAT_NAMES, TEMPO_MAX, type CharacterId } from './roster.ts';
import { appendReplayFrame, REPLAY_SOURCE_SECONDS, sampleReplay, selectReplay, replayProgress, type ReplaySelection } from './replay.ts';
import './tennis.css';

type LevelName = (typeof LEVEL_NAMES)[number];
type StageMode = 'offline' | 'online';

const FORMAT = defineSetting('tennis:format', ['singles', 'doubles'] as const, 'singles');
const LENGTH = defineSetting('tennis:length', ['game', 'three', 'set'] as const, 'three');
const LEVEL = defineSetting('tennis:level', LEVEL_NAMES, 'normal');
const CHARACTER = defineSetting<CharacterId>('tennis:character', CHARACTER_IDS, 'josh');
const RIVAL = defineSetting<CharacterId | 'random'>('tennis:rival', ['random', ...CHARACTER_IDS], 'random');
const shotShouts: Partial<Record<ShotKind, string>> = { smash: 'SMASH!', volley: 'VOLLEY!', drop: 'DROP SHOT' };
const callShouts: Partial<Record<PointCall, string>> = { out: 'OUT!', net: 'NET!', fault: 'FAULT', 'double fault': 'DOUBLE FAULT', let: 'LET' };
const formatOptions = [['singles', 'Singles'], ['doubles', 'Doubles']] as const;
const lengthOptions = [['game', '1 Game'], ['three', 'First to 2'], ['set', '1 Set']] as const;
const BOT_NAMES = ['Ace', 'Rally', 'Volley'] as const;
const difficulty = (name: LevelName): Level => name === 'easy' ? 0 : name === 'hard' ? 2 : 1;
const levelName = (level: Level): LevelName => level === 0 ? 'easy' : level === 2 ? 'hard' : 'normal';
const formatLabel = (format: Format) => format === 'singles' ? 'Singles' : 'Doubles';

export default function Game({ compact, onExit, roomCode }: GameProps) {
  return (
    <GameShell
      meta={meta}
      compact={compact}
      onExit={onExit}
      roomCode={roomCode}
      setup={<Setup />}
      hostSetup={<OnlineSetup />}
      botNames={BOT_NAMES}
      defaultBots={3}
      quickNote="Doubles with normal bots fills the other seats."
    >
      <Stage />
    </GameShell>
  );
}

function Setup() {
  const [format, setFormat] = useSetting(FORMAT);
  const [length, setLength] = useSetting(LENGTH);
  const [level, setLevel] = useSetting(LEVEL);
  return (
    <>
      <CharacterPicker />
      <Segmented label="Mode" value={format} options={formatOptions} onChange={setFormat} />
      <Segmented label="Match" value={length} options={lengthOptions} onChange={setLength} />
      <Segmented label="Difficulty" value={level} options={levelOptions} onChange={setLevel} />
    </>
  );
}

function CharacterPicker() {
  const [pick, setPick] = useSetting(CHARACTER);
  const [rival, setRival] = useSetting(RIVAL);
  const me = characterOf(pick);
  const choose = (id: CharacterId) => {
    if (id === pick) return;
    sfx.play('select');
    setPick(id);
    if (rival === id) setRival('random');
  };
  return (
    <>
      <div className="arcade-field">
        <span>Player</span>
        <div className="g-tennis-roster" role="group" aria-label="Player">
          {ROSTER.map((character) => (
            <button
              type="button"
              key={character.id}
              aria-pressed={character.id === pick}
              style={{ '--kit': character.shirt, '--trim': character.accColor } as CSSProperties}
              onClick={() => choose(character.id)}
            >
              <i aria-hidden="true" />
              <b>{character.name}</b>
              <small>{character.style}</small>
            </button>
          ))}
        </div>
        <div className="g-tennis-bio">
          <p>{me.blurb}</p>
          <dl>
            {STAT_NAMES.map((stat) => (
              <div key={stat}>
                <dt>{stat}</dt>
                <dd><i style={{ width: `${me.stats[stat] * 20}%` }} /></dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
      <Segmented
        label="Rival"
        className="g-tennis-rivals"
        value={rival}
        options={[['random', 'Random'], ...ROSTER.filter((character) => character.id !== pick).map((character) => [character.id, character.name] as const)]}
        onChange={setRival}
      />
    </>
  );
}

function OnlineSetup() {
  const online = useOnline();
  const [format, setFormat] = useSetting(FORMAT);
  const [length, setLength] = useSetting(LENGTH);
  const [level, setLevel] = useSetting(LEVEL);
  const [hostPick, setHostPick] = useState<{ format: Format; length: MatchLength; level: Level } | null>(null);
  const extraHumans = !!online?.players.some((player) => player.seat > 1);
  const actualFormat = online?.quick ? 'doubles' : extraHumans ? 'doubles' : format;

  useEffect(() => {
    if (!online?.isHost) return;
    const send = () => online.send(configOf(online.round || 1, actualFormat, online.quick ? 'three' : length, online.quick ? 1 : difficulty(level)));
    send();
    const timer = window.setInterval(send, 2000);
    return () => window.clearInterval(timer);
  }, [online, actualFormat, length, level]);

  useEffect(() => {
    if (!online || online.isHost) return;
    return online.onMessage((from, data) => {
      const packet = parsePacket(data);
      if (from === 0 && packet?.k === 'cfg') setHostPick({ format: packet.format, length: packet.length, level: packet.level });
    });
  }, [online]);

  if (!online) return null;
  if (online.quick) return <p className="arcade-online-hint">Doubles, first to 2 games, normal bots.</p>;
  if (online.isHost) {
    return (
      <>
        {extraHumans
          ? <div className="arcade-field"><span>Mode</span><strong>Doubles, required for 3 or 4 players</strong></div>
          : <Segmented label="Mode" value={actualFormat} options={formatOptions} onChange={setFormat} />}
        <Segmented label="Match" value={length} options={lengthOptions} onChange={setLength} />
        <Segmented label="Bot Level" value={level} options={levelOptions} onChange={setLevel} />
      </>
    );
  }
  return (
    <div className="arcade-field">
      <span>Host Setup</span>
      <div className="g-tennis-hostpick">
        <b>{hostPick ? `${formatLabel(hostPick.format)} · ${hostPick.length} · ${levelName(hostPick.level)}` : 'waiting for host'}</b>
        <small>picked by the host</small>
      </div>
    </div>
  );
}

function Stage() {
  const shell = useShell();
  const online = useOnline();
  const stage = useRef<{ key: string; mode: StageMode }>({ key: 'idle', mode: 'offline' });
  if (shell.status === 'ready') stage.current = { key: 'idle', mode: 'offline' };
  else if (shell.status === 'playing') {
    const key = online ? `online:${online.round}:${online.handoffs}` : 'offline';
    if (key !== stage.current.key) stage.current = { key, mode: online ? 'online' : 'offline' };
  }
  return <Play key={stage.current.key} mode={stage.current.mode} />;
}

function settingsWorld(mode: StageMode, format: Format, length: MatchLength, level: Level, online: ReturnType<typeof useOnline>, pick: CharacterId = 'josh', rival: CharacterId | 'random' = 'random') {
  if (mode === 'online' && online) {
    const actualFormat: Format = online.quick || online.players.some((player) => player.seat > 1) ? 'doubles' : format;
    const count = actualFormat === 'singles' ? 2 : 4;
    const roster = new Map<number, { name: string; ai: Level | null; connected: boolean; character?: string }>();
    for (const player of online.players) {
      if (player.seat >= 0 && player.seat < count) roster.set(player.seat, { name: player.name, ai: null, connected: true });
    }
    for (const bot of online.bots) {
      if (bot.seat >= 0 && bot.seat < count && !roster.has(bot.seat)) roster.set(bot.seat, { name: bot.name, ai: level, connected: true });
    }
    for (let seat = 0; seat < count; seat++) {
      if (!roster.has(seat)) roster.set(seat, { name: BOT_NAMES[seat] ?? `Bot ${seat}`, ai: level, connected: true });
    }
    return createWorld({
      format: actualFormat,
      length: online.quick ? 'three' : length,
      level: online.quick ? 1 : level,
      seed: online.round || 1,
      players: Array.from({ length: count }, (_, seat) => ({ ...roster.get(seat)!, character: seatCharacter(seat, online.round || 1) })),
    });
  }
  const count = format === 'singles' ? 2 : 4;
  const characters = lineup(pick, rival, count, Math.random);
  return createWorld({
    format,
    length,
    level,
    players: characters.map((character, seat) => ({ name: characterOf(character).name, ai: seat === 0 ? null : level, character })),
  });
}

function hudCopy(world: World, seat: number | null, watching: boolean, timing: HudModel['timing'], bounceCue: boolean, rallyShots = 0, replaying = false, feedback: HudModel['feedback'] = '', extra: Pick<HudModel, 'shout' | 'intro' | 'wipe'> = {}): HudModel {
  const copy = { ...world, players: world.players.map((player) => ({ ...player })), ball: { ...world.ball, p: { ...world.ball.p }, v: { ...world.ball.v } }, match: structuredClone(world.match) };
  return { world: copy, seat, watching, call: world.callClock > 0 ? world.lastCall : '', timing, bounceCue, rallyShots, replaying, feedback, ...extra };
}

function Play({ mode }: { mode: StageMode }) {
  const shell = useShell();
  const keyPress = useRef<(code: string, event: KeyboardEvent | null) => void>(() => {});
  const keys = useKeys((code, event) => keyPress.current(code, event));
  const THREE = useThree();
  const online = useOnline();
  const { ref, size } = useCanvas<HTMLDivElement>();
  const [formatSetting] = useSetting(FORMAT);
  const [lengthSetting] = useSetting(LENGTH);
  const [levelSetting] = useSetting(LEVEL);
  const [pickSetting] = useSetting(CHARACTER);
  const [rivalSetting] = useSetting(RIVAL);
  const level = online?.quick ? 1 : difficulty(levelSetting);
  const format = online?.quick ? 'doubles' : formatSetting;
  const length = online?.quick ? 'three' : lengthSetting;
  const onlineRef = useRef(online);
  const shellRef = useRef(shell);
  onlineRef.current = online;
  shellRef.current = shell;

  const world = useRef<World | null>(null);
  world.current ??= settingsWorld(mode, format, length, level, online, pickSetting, rivalSetting);
  const lastHit = useRef<{ kind: Swing['kind']; clock: number } | null>(null);
  const selectedShot = useRef<ShotKind>('topspin');
  const view = useRef<View | null>(null);
  const debugFreezeWorld = useRef(false);
  const [sceneLoadFailed, setSceneLoadFailed] = useState(false);
  const audio = useRef<ReturnType<typeof createAudio> | null>(null);
  const replayFrames = useRef<ReturnType<typeof appendReplayFrame>>([]);
  const replayState = useRef<{ selection: ReplaySelection; elapsed: number; cameraStarted: boolean; outStarted: boolean } | null>(null);
  const replayingRef = useRef(false);
  const pointShots = useRef(0);
  const rallyShots = useRef(0);
  const lastHitterTeam = useRef<number | null>(null);
  const oohPlayed = useRef(false);
  const lastHandledEvent = useRef<string | null>(null);
  const feedbackClock = useRef(0);
  const feedbackRef = useRef<HudModel['feedback']>('');
  const smashCueActive = useRef(false);
  const shoutRef = useRef('');
  const shoutClock = useRef(0);
  const introClock = useRef(2.6);
  const tempoSeen = useRef(0);
  const hitStopUntil = useRef(0);
  const lastReplayAttempt = useRef<object | null>(null);
  const [, setReplaying] = useState(false);
  const [, setFeedback] = useState<HudModel['feedback']>('');
  const skipReplayRef = useRef<() => void>(() => {});
  const wipeRef = useRef(0);
  const localCommands = useRef<Command[]>([]);
  const remoteCommands = useRef<Command[]>([]);
  const guestSnapshots = useRef<{ at: number; state: World }[]>([]);
  const guestPrediction = useRef<Player | null>(null);
  const synced = useRef(mode !== 'online' || !!online?.isHost);
  const reported = useRef(false);
  const lastMoveSent = useRef<MoveInput>({ x: 0, z: 0 });
  const lastMoveAt = useRef(0);
  const lastWorldFrameAt = useRef<number | null>(null);
  const stopMovementRef = useRef<() => void>(() => {});
  const hudClock = useRef(0);
  const timingClock = useRef(0);
  const bounceCueClock = useRef(0);
  const [timing, setTiming] = useState<HudModel['timing']>('');
  const [bounceCue, setBounceCue] = useState(false);
  const timingRef = useRef<HudModel['timing']>('');
  timingRef.current = timing;
  const [hud, setHud] = useState<HudModel>(() => hudCopy(world.current!, online?.seat ?? null, !!online?.watching, '', false));
  const currentSeat = () => mode === 'online' ? onlineRef.current?.seat ?? -1 : 0;
  const myTeam = () => world.current?.players.find((player) => player.seat === currentSeat())?.team ?? 0;
  const localHumanSeats = () => mode === 'online'
    ? new Set((onlineRef.current?.players ?? []).map((player) => player.seat).filter((seat) => seat >= 0))
    : new Set([0]);

  const triggerReplayWipe = () => {
    wipeRef.current++;
    setHud((current) => ({ ...current, wipe: wipeRef.current }));
  };

  const beginReplay = (selection: ReplaySelection) => {
    replayState.current = { selection, elapsed: -0.35, cameraStarted: false, outStarted: false };
    replayingRef.current = true;
    setReplaying(true);
    triggerReplayWipe();
  };

  const skipReplay = () => {
    const active = replayState.current;
    if (!active || active.outStarted) return;
    active.elapsed = Math.max(active.elapsed, active.selection.duration - 0.35);
    active.outStarted = true;
    triggerReplayWipe();
  };
  skipReplayRef.current = skipReplay;

  useEffect(() => {
    audio.current = createAudio();
    return () => {
      audio.current?.dispose();
      audio.current = null;
    };
  }, []);

  useEffect(() => {
    const host = ref.current;
    if (!THREE || !host) return;
    let cancelled = false;
    let retryTimer = 0;
    let next: View | null = null;
    let attempts = 0;
    const initialize = () => {
      if (cancelled) return;
      try {
        next = createScene(THREE, host, shell.touch, world.current!.players.map((player) => player.character));
      } catch (error) {
        if (import.meta.env.DEV) console.warn('Tennis scene initialization failed', error);
      }
      if (!next) {
        if (attempts++ === 0) {
          retryTimer = window.setTimeout(initialize, 180);
          return;
        }
        setSceneLoadFailed(true);
        return;
      }
      view.current = next;
      next.resize(size.w, size.h);
      next.update(world.current!, 0, localHumanSeats(), myTeam());
      setSceneLoadFailed(false);
      shell.invalidate();
    };
    initialize();
    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
      next?.dispose();
      view.current = null;
    };
  }, [THREE, shell.touch]);

  useEffect(() => {
    lastWorldFrameAt.current = null;
  }, [shell.status]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const debugWindow = window as Window & {
      __tennisWorldDebug?: () => object;
      __tennisPoseDebug?: {
        pose: (seat: number, name: import('./player.ts').PoseName, progress?: number) => void;
        camera: (name: 'front' | 'side' | 'back' | 'game', seat?: number) => void;
        forceHighQuality: () => void;
        perfect: () => void;
        smashCue: () => void;
        winner: () => void;
        replay: () => void;
        replayPoint: () => void;
        crowd: () => void;
        trail: () => void;
        freeze: (active?: boolean) => void;
      };
    };
    debugWindow.__tennisWorldDebug = () => {
      const current = world.current;
      if (!current) return {};
      const activeReplay = replayState.current;
      const progress = activeReplay ? replayProgress(activeReplay.selection, activeReplay.elapsed) : null;
      return {
        phase: current.phase,
        clock: current.clock,
        serverSeat: current.serverSeat,
        ball: {
          inPlay: current.ball.inPlay,
          canHitTeam: current.ball.canHitTeam,
          bounces: current.ball.bounces,
          p: { ...current.ball.p },
          v: { ...current.ball.v },
        },
        replay: {
          frames: replayFrames.current.length,
          active: !!activeReplay,
          elapsed: activeReplay?.elapsed ?? null,
          duration: activeReplay?.selection.duration ?? null,
          lastAttempt: lastReplayAttempt.current,
          hitAt: activeReplay?.selection.hitAt ?? null,
          slow: progress?.slow ?? false,
          slowProgress: progress?.slowProgress ?? null,
          wipe: wipeRef.current,
        },
        lastHandledEvent: lastHandledEvent.current,
        pointShots: pointShots.current,
        rallyShots: rallyShots.current,
        players: current.players.map((player) => ({
          seat: player.seat,
          team: player.team,
          x: player.x,
          z: player.z,
          pending: player.pending?.kind ?? null,
        })),
        lastHit: lastHit.current,
      };
    };
    debugWindow.__tennisPoseDebug = {
      pose: (seat, name, progress) => { view.current?.debugPose(seat, name, progress); shell.invalidate(); },
      camera: (name, seat) => {
        if (name === 'game') {
          replayState.current = null;
          replayingRef.current = false;
          setReplaying(false);
          view.current?.replayCamera(false);
        }
        view.current?.debugCamera(name, seat);
        shell.invalidate();
      },
      forceHighQuality: () => { view.current?.debugForceHighQuality?.(); shell.invalidate(); },
      perfect: () => {
        if (mode === 'online') return;
        timingRef.current = 'perfect';
        setTiming('perfect');
        timingClock.current = 0.9;
        feedbackRef.current = 'PERFECT!';
        setFeedback('PERFECT!');
        feedbackClock.current = 0.72;
        hitStopUntil.current = performance.now() + 70;
        view.current?.hit(155, true);
        const current = world.current;
        if (current) view.current?.update(current, 0, localHumanSeats(), myTeam());
        debugFreezeWorld.current = true;
        shell.invalidate();
      },
      smashCue: () => {
        feedbackRef.current = 'Smash!';
        feedbackClock.current = 1.8;
        setFeedback('Smash!');
        shoutRef.current = 'SMASH!';
        shoutClock.current = 1.8;
        setHud((current) => ({ ...current, feedback: 'Smash!', shout: 'SMASH!' }));
        view.current?.punch(1);
        shell.invalidate();
      },
      winner: () => {
        const current = world.current;
        const hitter = current?.players.find((player) => player.team === 1);
        if (!current || !hitter) return;
        current.phase = 'rally';
        current.lastCall = '';
        current.callClock = 0;
        current.rallyShot = 6;
        const p = { x: hitter.x + 0.1, y: 0.6, z: hitter.z + 0.5 };
        current.ball.p = p;
        current.ball.prev = { ...p };
        current.ball.v = { x: 1.25, y: 9, z: 4.5 };
        current.ball.spin = { x: 0, y: 0, z: 0 };
        current.ball.inPlay = false;
        current.ball.hitByTeam = 0;
        current.ball.canHitTeam = 0;
        current.ball.bounces = 0;
        current.ball.lastBounceTeam = -1;
        current.ball.targetTeam = 0;
        current.ball.rallyShot = 5;
        current.ball.shotKind = 'flat';
        pointShots.current = 6;
        rallyShots.current = 6;
        lastHitterTeam.current = 1;
        replayFrames.current = appendReplayFrame([], current);
        current.clock += 0.001;
        current.ball.inPlay = true;
        current.ball.hitByTeam = 1;
        current.ball.rallyShot = 6;
        replayFrames.current = appendReplayFrame(replayFrames.current, current);
        shell.invalidate();
      },
      replay: () => {
        const current = world.current;
        if (!current) return;
        const duration = REPLAY_SOURCE_SECONDS;
        let staged: typeof replayFrames.current = [];
        for (let index = 0; index < 49; index++) {
          const progress = index / 48;
          const at = current.clock - duration + progress * duration;
          const z = progress <= 0.85 ? 7.811 + progress * 4.222 : 11.4 - (progress - 0.85) * 19.3;
          const p = { x: 0.8 - progress * 2.95, y: 0.7 + Math.sin(progress * Math.PI) * 1.8, z };
          const hit = progress >= 0.72;
          staged = appendReplayFrame(staged, {
            ...current,
            clock: at,
            phase: 'rally',
            ball: { ...current.ball, inPlay: true, hitByTeam: hit ? 0 : 1, rallyShot: hit ? 6 : 5, prev: p, p, v: { x: -0.75, y: 2, z: -19.3 } },
          });
        }
        const selection = selectReplay(staged, {
          call: 'out',
          rallyShots: 6,
          pointWinner: 0,
          lastHitter: 0,
        }, current.clock);
        if (!selection) return;
        beginReplay(selection);
        debugFreezeWorld.current = true;
        shell.invalidate();
      },
      replayPoint: () => {
        const current = world.current;
        if (!current || current.phase !== 'point' || current.pointWinner === null) return;
        startReplay(current.pointWinner, current.lastCall || 'point');
        shell.invalidate();
      },
      crowd: () => {
        view.current?.debugCrowdExcitement?.();
        const current = world.current;
        if (current) view.current?.update(current, 0, localHumanSeats(), myTeam());
        debugFreezeWorld.current = true;
        shell.invalidate();
      },
      trail: () => {
        const current = world.current;
        if (!current || mode === 'online') return;
        const p = { x: 2.5, y: 2.4, z: 8.5 };
        const v = { x: -5, y: 0.5, z: 0 };
        current.phase = 'rally';
        current.ball = {
          ...current.ball,
          p,
          prev: { x: p.x - v.x * 0.025, y: p.y - v.y * 0.025, z: p.z - v.z * 0.025 },
          v,
          inPlay: true,
          hitByTeam: 1,
          canHitTeam: 0,
          bounces: 0,
          lastBounceTeam: -1,
          targetTeam: 0,
          rallyShot: 6,
          netCord: false,
        };
        lastHit.current = { kind: 'topspin', clock: current.clock };
        rallyShots.current = 6;
        pointShots.current = 6;
        const stagedBall = current.ball;
        for (let sample = 12; sample >= 1; sample--) {
          const lag = sample * 0.025;
          const trailPoint = {
            x: p.x - stagedBall.v.x * lag,
            y: p.y - stagedBall.v.y * lag,
            z: p.z - stagedBall.v.z * lag,
          };
          current.ball = { ...stagedBall, p: trailPoint, prev: trailPoint };
          view.current?.update(current, 0, localHumanSeats(), myTeam());
        }
        current.ball = stagedBall;
        view.current?.update(current, 0, localHumanSeats(), myTeam());
        debugFreezeWorld.current = true;
        shell.invalidate();
      },
      freeze: (active = true) => {
        debugFreezeWorld.current = active;
        lastWorldFrameAt.current = performance.now();
        shell.invalidate();
      },
    };
    return () => { delete debugWindow.__tennisWorldDebug; delete debugWindow.__tennisPoseDebug; };
  }, []);

  useEffect(() => {
    const reset = () => { lastWorldFrameAt.current = null; };
    document.addEventListener('visibilitychange', reset);
    return () => document.removeEventListener('visibilitychange', reset);
  }, []);

  useEffect(() => {
    const skip = () => skipReplayRef.current();
    document.addEventListener('pointerdown', skip);
    return () => document.removeEventListener('pointerdown', skip);
  }, []);

  useEffect(() => {
    view.current?.resize(size.w, size.h);
    shell.invalidate();
  }, [size.w, size.h, shell]);

  const setTimingResult = (delta: number) => {
    const state = timingLabel(delta);
    timingRef.current = state;
    setTiming(state);
    timingClock.current = 0.9;
  };

  const startReplay = (winner: number, call: PointCall) => {
    const current = world.current;
    if (!current) return;
    const selection = selectReplay(replayFrames.current, {
      call,
      rallyShots: pointShots.current,
      pointWinner: winner,
      lastHitter: lastHitterTeam.current ?? -1,
    }, current.clock);
    lastReplayAttempt.current = {
      call,
      rallyShots: pointShots.current,
      pointWinner: winner,
      lastHitter: lastHitterTeam.current ?? -1,
      frameCount: replayFrames.current.length,
      selected: !!selection,
    };
    if (!selection) return;
    beginReplay(selection);
  };

  const sendCommand = (command: Command) => {
    const o = onlineRef.current;
    const current = world.current;
    if (!current) return;
    if (mode !== 'online' || o?.isHost) {
      localCommands.current.push(command);
      return;
    }
    if (!o || o.seat < 0) return;
    if (command.move) o.send(moveOf(o.round || 1, command.move));
    else if (command.toss) o.send(serveOf(o.round || 1, 'toss'));
    else if (command.serve) o.send(serveOf(o.round || 1, 'serve', command.swing?.aim ?? 0, command.swing?.kind === 'slice' || command.swing?.kind === 'flat' ? command.swing.kind : 'topspin'));
    else if (command.swing) o.send(swingOf(o.round || 1, current.ball.rallyShot, command.swing));
  };

  const sendMovementIfChanged = (player: Player | undefined, input: MoveInput) => {
    const seat = currentSeat();
    const now = performance.now();
    if (player?.ai === null && player.connected
      && (input.x !== lastMoveSent.current.x || input.z !== lastMoveSent.current.z
        || input.x !== player.input.x || input.z !== player.input.z)
      && now - lastMoveAt.current >= 50) {
      lastMoveSent.current = { ...input };
      lastMoveAt.current = now;
      sendCommand({ seat, move: input });
    }
  };

  const movementInput = (): MoveInput => {
    const team = myTeam();
    return {
      x: keys.axis('left', 'right') * (team === 0 ? 1 : -1),
      z: keys.axis('up', 'down') * (team === 0 ? 1 : -1),
    };
  };

  const stopMovement = () => {
    const seat = currentSeat();
    const player = world.current?.players.find((entry) => entry.seat === seat);
    if (player?.ai === null) player.input = { x: 0, z: 0 };
    lastMoveSent.current = { x: 0, z: 0 };
    lastMoveAt.current = performance.now();
    if (player?.ai === null) sendCommand({ seat, move: { x: 0, z: 0 } });
  };
  stopMovementRef.current = stopMovement;

  const shotPress = (kind: Swing['kind']) => {
    const current = world.current;
    if (!current || shellRef.current.status !== 'playing') return;
    if (import.meta.env.DEV && debugFreezeWorld.current) return;
    const seat = currentSeat();
    const player = current.players.find((entry) => entry.seat === seat);
    if (!player || player.ai !== null || !player.connected) return;
    selectedShot.current = kind;
    if ((current.phase === 'serve-ready' || current.phase === 'serve-toss') && current.serverSeat === seat) {
      if (current.phase === 'serve-ready') sendCommand({ seat, toss: true });
      else {
        sendCommand({ seat, serve: true, swing: { kind, aim: player.input.x, delta: 0 } });
      }
      return;
    }
    if ((current.phase !== 'rally' && current.phase !== 'serve-flight') || !current.ball.inPlay || current.ball.canHitTeam !== player.team) return;
    sendCommand({ seat, swing: { kind, aim: player.input.x, delta: 0 } });
  };

  keyPress.current = (code, event) => {
    if (event?.repeat) return;
    if (replayState.current) {
      skipReplayRef.current();
      return;
    }
    if (code === 'Space' || code === 'Enter' || code === 'KeyJ') shotPress('topspin');
    else if (code === 'KeyK') shotPress('slice');
    else if (code === 'KeyL') shotPress('flat');
    else if (code === 'KeyI') shotPress('lob');
    else if (code === 'KeyU') shotPress('drop');
  };

  const finishGame = (team: number) => {
    const current = world.current;
    const o = onlineRef.current;
    if (!current || reported.current) return;
    reported.current = true;
    const winnerSeats = teamSeats(current, team).sort((a, b) => a - b);
    const winnerSeat = winnerSeats[0] ?? null;
    const mine = current.players.find((player) => player.seat === currentSeat());
    const watcher = mode === 'online' && !!o?.watching;
    let title: string;
    if (watcher) title = `team ${team === 0 ? 'a' : 'b'} wins`;
    else if (mode === 'online' && mine?.team === team) title = 'you win';
    else if (mode === 'online') {
      const winner = current.players.find((player) => player.seat === winnerSeat);
      title = `${winner?.name ?? `team ${team === 0 ? 'a' : 'b'}`} wins`;
    }
    else title = team === 0 ? 'you win' : 'match lost';
    const detail = `${current.match.games[0]} - ${current.match.games[1]} games${current.match.length === 'set' ? ` · ${current.match.sets[0]} - ${current.match.sets[1]} sets` : ''}`;
    if (mode === 'online' && o) {
      if (o.isHost) {
        o.reportResult(o.round, winnerSeat);
        o.send(eventOf(o.round || 1, { type: 'end', winner: team }), { fast: false });
      }
      shellRef.current.gameOver(undefined, { title, detail });
      return;
    }
    shellRef.current.gameOver(undefined, { title, detail });
  };

  const shout = (text: string) => {
    shoutRef.current = text;
    shoutClock.current = 1.1;
  };

  const handleEvent = (event: ReturnType<typeof stepWorld>[number], fromHost = false) => {
    lastHandledEvent.current = event.type;
    const currentView = view.current;
    if (event.type === 'hit') {
      if (import.meta.env.DEV) lastHit.current = { kind: event.kind, clock: world.current?.clock ?? 0 };
      pointShots.current++;
      rallyShots.current++;
      const hitter = world.current?.players.find((player) => player.seat === event.seat);
      lastHitterTeam.current = hitter?.team ?? null;
      if (rallyShots.current >= 8 && !oohPlayed.current) {
        oohPlayed.current = true;
        audio.current?.ooh();
      }
      currentView?.crowdOoh(rallyShots.current);
      const perfect = event.delta !== undefined && timingLabel(event.delta) === 'perfect';
      if (event.delta !== undefined) {
        setTimingResult(event.delta);
        feedbackRef.current = perfect ? 'PERFECT!' : 'NICE!';
        setFeedback(feedbackRef.current);
        feedbackClock.current = 0.72;
      }
      currentView?.hit(event.speed, perfect);
      if (event.kind === 'smash') currentView?.punch(1);
      if (perfect && mode === 'offline' && event.seat === currentSeat()) hitStopUntil.current = performance.now() + 70;
      audio.current?.hit(event.speed, event.kind, perfect);
      const label = shotShouts[event.kind];
      if (label && !event.serve) shout(label);
      if (hitter && event.seat === currentSeat()) {
        if (hitter.tempo > tempoSeen.current) audio.current?.tempo(hitter.tempo);
        if (hitter.tempo >= TEMPO_MAX && tempoSeen.current < TEMPO_MAX) shout('IN THE ZONE!');
        tempoSeen.current = hitter.tempo;
      }
    } else if (event.type === 'bounce') {
      const current = world.current;
      const bounceTeam = event.z >= 0 ? 0 : 1;
      if (event.in && current?.players.some((player) => player.seat === currentSeat() && player.team === bounceTeam)) {
        bounceCueClock.current = 0.85;
        setBounceCue(true);
      }
      currentView?.bounce(event.x, event.z, event.line);
      audio.current?.bounce(event.in, event.line);
    } else if (event.type === 'net') {
      currentView?.netHit();
      audio.current?.net();
    } else if (event.type === 'call') {
      audio.current?.call(event.call);
      const label = callShouts[event.call];
      if (label) shout(label);
    } else if (event.type === 'point') {
      const call = world.current?.lastCall;
      if (call !== 'out' && call !== 'net' && call !== 'double fault') {
        shout(pointShots.current <= 1 ? 'ACE!' : 'WINNER!');
        currentView?.punch(0.7);
      }
      const mine = world.current?.players.find((player) => player.seat === currentSeat());
      if (mine && mine.team !== event.winner) tempoSeen.current = 0;
      currentView?.point(event.winner, rallyShots.current >= 8);
      startReplay(event.winner, world.current?.lastCall || 'point');
      if (rallyShots.current >= 8) audio.current?.cheer();
      rallyShots.current = 0;
      pointShots.current = 0;
      lastHitterTeam.current = null;
      oohPlayed.current = false;
    } else if (event.type === 'end') {
      if (mode === 'online' && !onlineRef.current?.isHost) finishGame(event.winner);
    }
    const o = onlineRef.current;
    if (!fromHost && mode === 'online' && o?.isHost) o.send(eventOf(o.round || 1, event), { fast: false });
  };

  const updateWorld = (_frameDt: number) => {
    const now = performance.now();
    const previous = lastWorldFrameAt.current;
    lastWorldFrameAt.current = document.hidden ? null : now;
    if (document.hidden) return;
    const dt = previous === null ? 0 : Math.min(0.1, Math.max(0, (now - previous) / 1000));
    const current = world.current;
    if (!current || shellRef.current.status !== 'playing') return;
    const o = onlineRef.current;
    if (mode === 'online' && o && !o.isHost) {
      const snapshots = guestSnapshots.current;
      if (snapshots.length) {
        const renderAt = performance.now() - 100;
        let before = snapshots[0]!;
        let after = snapshots[snapshots.length - 1]!;
        for (let index = 1; index < snapshots.length; index++) {
          const candidate = snapshots[index]!;
          if (candidate.at >= renderAt) {
            before = snapshots[index - 1]!;
            after = candidate;
            break;
          }
          before = candidate;
        }
        const span = after.at - before.at;
        const alpha = span > 0 ? Math.max(0, Math.min(1, (renderAt - before.at) / span)) : 1;
        const older = before.state;
        const newer = after.state;
        const latest = snapshots[snapshots.length - 1]!.state;
        Object.assign(current, latest);
        current.players = latest.players.map((player, index) => {
          const a = older.players[index] ?? player;
          const b = newer.players[index] ?? player;
          return {
            ...player,
            x: a.x + (b.x - a.x) * alpha,
            z: a.z + (b.z - a.z) * alpha,
            prevX: a.x + (b.x - a.x) * alpha,
            prevZ: a.z + (b.z - a.z) * alpha,
          };
        });
        const a = older.ball.p;
        const b = newer.ball.p;
        current.ball = {
          ...latest.ball,
          p: { x: a.x + (b.x - a.x) * alpha, y: a.y + (b.y - a.y) * alpha, z: a.z + (b.z - a.z) * alpha },
          prev: { x: a.x + (b.x - a.x) * alpha, y: a.y + (b.y - a.y) * alpha, z: a.z + (b.z - a.z) * alpha },
        };
        const local = current.players.find((player) => player.seat === currentSeat());
        if (local) {
          let prediction = guestPrediction.current;
          if (!prediction || prediction.seat !== local.seat) {
            prediction = { ...local, input: { ...local.input }, pending: local.pending && { ...local.pending } };
            guestPrediction.current = prediction;
          }
          const input = movementInput();
          prediction.input = input;
          movePlayer(current, prediction, dt);
          const error = Math.hypot(local.x - prediction.x, local.z - prediction.z);
          if (error > 1.5) {
            prediction.x = local.x;
            prediction.z = local.z;
          } else {
            prediction.x += (local.x - prediction.x) * 0.15;
            prediction.z += (local.z - prediction.z) * 0.15;
          }
          local.x = prediction.x;
          local.z = prediction.z;
          sendMovementIfChanged(local, input);
          local.input = input;
        }
        current.acc = STEP;
      }
    } else {
      if (mode === 'online' && o?.isHost) {
        for (const player of current.players) {
          if (player.ai !== null) continue;
          if (!o.players.some((entry) => entry.seat === player.seat)) {
            player.ai = level;
            player.name = `${player.name} (bot)`;
            player.input = { x: 0, z: 0 };
            player.pending = null;
          }
        }
      }
      const input = movementInput();
      const seat = currentSeat();
      const player = current.players.find((entry) => entry.seat === seat);
      sendMovementIfChanged(player, input);
      const commands = [...localCommands.current, ...remoteCommands.current];
      localCommands.current = [];
      remoteCommands.current = [];
      const events = stepWorld(current, commands, dt);
      events.forEach((event) => handleEvent(event));
      if (current.match.winner !== null) finishGame(current.match.winner);
    }

    timingClock.current = Math.max(0, timingClock.current - dt);
    if (timingClock.current <= 0 && timingRef.current) {
      timingRef.current = '';
      setTiming('');
    }
    bounceCueClock.current = Math.max(0, bounceCueClock.current - dt);
    if (bounceCueClock.current <= 0) setBounceCue(false);
    shoutClock.current = Math.max(0, shoutClock.current - dt);
    if (shoutClock.current <= 0) shoutRef.current = '';
    introClock.current = Math.max(0, introClock.current - dt);
    feedbackClock.current = Math.max(0, feedbackClock.current - dt);
    if (feedbackClock.current <= 0 && feedbackRef.current) {
      feedbackRef.current = '';
      setFeedback('');
    }
    const side = myTeam();
    const aimPlayer = current.players.find((player) => player.seat === currentSeat());
    const aimTarget = aimPlayer && !o?.watching && current.ball.inPlay
      && current.ball.canHitTeam === aimPlayer.team
      && (current.phase === 'rally' || current.phase === 'serve-flight')
      ? previewTarget(current, aimPlayer, selectedShot.current)
      : null;
    const strikePoint = aimPlayer && !o?.watching && current.ball.inPlay
      && current.ball.canHitTeam === aimPlayer.team
      && (current.phase === 'rally' || current.phase === 'serve-flight')
      ? predictContactPoint(current.ball, aimPlayer)
      : null;
    const smashReachable = !!strikePoint && !!aimPlayer
      && strikePoint.y >= 2.2
      && Math.hypot(strikePoint.x - aimPlayer.x, strikePoint.z - aimPlayer.z) <= strikeRadius(current.level);
    if (!replayingRef.current && smashReachable) {
      feedbackRef.current = 'Smash!';
      feedbackClock.current = 0.15;
      smashCueActive.current = true;
      setFeedback('Smash!');
    } else if (smashCueActive.current) {
      if (feedbackRef.current === 'Smash!') {
        feedbackRef.current = '';
        setFeedback('');
      }
      feedbackClock.current = 0;
      smashCueActive.current = false;
    }
    const activeReplay = replayState.current;
    if (activeReplay) {
      activeReplay.elapsed += dt;
      if (!activeReplay.cameraStarted && activeReplay.elapsed >= 0) {
        activeReplay.cameraStarted = true;
        view.current?.replayCamera(true);
      }
      if (!activeReplay.outStarted && activeReplay.elapsed >= activeReplay.selection.duration - 0.35) {
        activeReplay.outStarted = true;
        triggerReplayWipe();
      }
      if (activeReplay.elapsed >= activeReplay.selection.duration) {
        replayState.current = null;
        replayingRef.current = false;
        setReplaying(false);
        view.current?.replayCamera(false);
        view.current?.update(current, dt, localHumanSeats(), side);
        replayFrames.current = appendReplayFrame(replayFrames.current, current);
      } else {
        if (activeReplay.cameraStarted) {
          const progress = replayProgress(activeReplay.selection, activeReplay.elapsed);
          view.current?.replayProgress(progress.t, progress.slow, progress.slowProgress, activeReplay.selection.hitTeam);
          view.current?.update(sampleReplay(activeReplay.selection, activeReplay.elapsed), dt, localHumanSeats(), side);
        } else {
          view.current?.update(current, dt, localHumanSeats(), side, aimTarget);
        }
      }
    } else {
      view.current?.update(current, dt, localHumanSeats(), side, aimTarget);
      replayFrames.current = appendReplayFrame(replayFrames.current, current);
    }
    hudClock.current += dt;
    if (hudClock.current >= 0.1) {
      hudClock.current = 0;
      setHud(hudCopy(current, currentSeat(), !!o?.watching, timingClock.current > 0 ? timingRef.current : '', bounceCue, rallyShots.current, replayingRef.current, feedbackRef.current, { shout: shoutRef.current, intro: introClock.current > 0, wipe: wipeRef.current }));
    }
  };

  useGameLoop(updateWorld, () => {
    if (mode === 'offline' && performance.now() < hitStopUntil.current) return;
    view.current?.render();
  });

  useEffect(() => {
    if (mode !== 'online' || !online) return;
    const off = online.onMessage((from, data) => {
      const o = onlineRef.current;
      if (!o || from === o.seat) return;
      const packet = parsePacket(data);
      if (!packet || packet.r !== (o.round || 1)) return;
      const current = world.current;
      if (!current) return;
      if (o.isHost && packet.k === 'mv') {
        const player = current.players.find((entry) => entry.seat === from);
        if (!player || player.ai !== null || !player.connected) return;
        const command = commandOf(packet, from);
        if (command) remoteCommands.current.push(command);
        return;
      }
      if (o.isHost && (packet.k === 'sw' || packet.k === 'toss' || packet.k === 'serve')) {
        const player = current.players.find((entry) => entry.seat === from);
        if (!player || player.ai !== null || !player.connected) return;
        const command = commandOf(packet, from);
        if (!command) return;
        if (packet.k !== 'sw') {
          if (from !== current.serverSeat) return;
          remoteCommands.current.push(command);
          return;
        }
        if (packet.shot !== current.ball.rallyShot || (current.phase !== 'rally' && current.phase !== 'serve-flight')
          || !current.ball.inPlay || current.ball.canHitTeam !== player.team) return;
        remoteCommands.current.push(command);
        return;
      }
      if (!o.isHost && from === 0 && packet.k === 'S') {
        const incoming = packet.state;
        if (!synced.current || world.current?.format !== incoming.format || world.current?.players.length !== incoming.players.length) {
          world.current = incoming;
          synced.current = true;
          guestPrediction.current = null;
          guestSnapshots.current = [];
        }
        guestSnapshots.current.push({ at: performance.now(), state: incoming });
        if (guestSnapshots.current.length > 12) guestSnapshots.current.shift();
        if (incoming.match.winner !== null) finishGame(incoming.match.winner);
        return;
      }
      if (!o.isHost && from === 0 && packet.k === 'ev') handleEvent(packet.event, true);
    });

    const timer = window.setInterval(() => {
      const current = world.current;
      const o = onlineRef.current;
      if (!current || !o || shellRef.current.status !== 'playing') return;
      if (!o.isHost) return;
      o.send(stateOf(o.round || 1, current), { fast: true });
    }, 1000 / 30);
    return () => {
      off();
      window.clearInterval(timer);
    };
  }, [mode]);

  useEffect(() => {
    const clear = () => stopMovementRef.current();
    window.addEventListener('blur', clear);
    if (shell.status !== 'playing') clear();
    return () => {
      window.removeEventListener('blur', clear);
      clear();
    };
  }, [shell.status]);

  return (
    <div
      className="g-tennis-stage"
      ref={ref}
      aria-label="Tennis court"
    >
      {!THREE && <div className="g-tennis-error"><strong>Preparing the Koo Open…</strong></div>}
      {THREE && sceneLoadFailed && shell.status === 'playing' && <div className="g-tennis-error"><strong>3D court could not load. Try restarting.</strong></div>}
      <Hud {...hud} touch={shell.touch} />
      <TouchControls dpad buttons={[
        { key: 'Space', label: 'topspin' },
        { key: 'KeyK', label: 'slice' },
        { key: 'KeyI', label: 'lob' },
        { key: 'KeyU', label: 'drop' },
      ]} />
    </div>
  );
}
