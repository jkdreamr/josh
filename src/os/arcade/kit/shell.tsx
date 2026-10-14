import { useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { OSContext } from '../../types';
import type { GameMeta } from '../types';
import { ShellContext, type GameOverInfo, type GameStatus, type ShellApi } from './context';
import { ArcadeHost, ArcadeInvite } from './host';
import { KeyState, scrollKeys } from './keys';
import { useHighScore } from './score';
import { ARCADE_API, NAME_MAX, boardFor, formatBoardScore, savedName } from './leaderboard';
import { BoardList, BoardScopeNote, useRoundBoard, validName } from './board';
import { sfx, useMuted } from './sfx';
import { defineSetting, getSetting, isGameSetting, onSettingChange, setSetting, trackSettingChange, useSetting } from './settings';
import { BotStepper, OnlinePanel, OnlineProvider, ROOM_VISIBILITY, VisibilityPicker } from './online';
import { botPlayers, nextOnlineRound, parseRacePacket, raceStandings, type RaceScores } from './online-core';
import { createRoom, RoomLink, type RoomPlayer, type RoomTransport } from './room';
import { countPlay } from '../../stats';
import './kit.css';

export type GameShellProps = {
  meta: GameMeta;
  compact?: boolean;
  onExit?: () => void;
  children: ReactNode;
  /** Skip the Start overlay and begin playing immediately. */
  autoStart?: boolean;
  /** For time-based scores where smaller wins. */
  lowerIsBetter?: boolean;
  formatScore?: (score: number) => string;
  /** Remount children on restart so every round starts from fresh state (default true). */
  remount?: boolean;
  /** Room to join automatically from an arcade invite link. */
  roomCode?: string;
  /** Mode and difficulty controls, shown on the Start card above Play and again on the Pause card. */
  setup?: ReactNode;
  /**
   * Settings for online rounds (a speed class, a course): shown in the room lobby and on the online Game Over card,
   * where the host picks them for everyone. The game sends the host's choice with its own messages.
   */
  hostSetup?: ReactNode;
  /** Names for online bots in seat order (games with `online.bots`); the rest are Bot 1, Bot 2 and so on. */
  botNames?: readonly string[];
  /** Bots a host's room starts with until they pick a number of their own, which is remembered (default none). */
  defaultBots?: number;
  className?: string;
  style?: CSSProperties;
};

type Result = { id: number; score?: number; best: number | null; isBest: boolean } & GameOverInfo;
/** A room holds sixteen seats at most, so a host never asks for more bots than that. */
const BOT_COUNTS = Array.from({ length: 16 }, (_, i) => String(i));

const Icon = ({ d, size = 14 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
const ic = {
  pause: 'M9 5v14M15 5v14',
  play: 'M7 4.5v15l12-7.5z',
  restart: 'M4 12a8 8 0 1 0 2.4-5.7M4 4v5h5',
  sound: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4zM16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11',
  muted: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4zM16.5 9.5l5 5M21.5 9.5l-5 5',
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
};

/** Focus without scrolling: the laptop screen is projected HTML and must never scroll. */
const autoFocus = (b: HTMLButtonElement | null) => b?.focus({ preventScroll: true });

const isTouchDevice = () =>
  typeof window !== 'undefined' && (window.matchMedia?.('(hover: none) and (pointer: coarse)').matches || navigator.maxTouchPoints > 1);

/**
 * Frame every game renders into: Start, Pause and Game Over overlays, a top-right control row
 * (pause, restart, mute, back to arcade), live score, key capture and auto-pause.
 * Put the game's logic in a child component and read the shell with useShell().
 */
export function GameShell({ meta, compact = false, onExit, children, autoStart, lowerIsBetter, formatScore, remount = true, setup, hostSetup, botNames, defaultBots = 0, roomCode, className, style }: GameShellProps) {
  const host = useContext(ArcadeHost);
  const invite = useContext(ArcadeInvite);
  const joinCode = roomCode ?? invite;
  const os = useContext(OSContext);
  const root = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<GameStatus>(autoStart ? 'playing' : 'ready');
  const [round, setRound] = useState(0);
  const [score, setScoreState] = useState<number | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [docVisible, setDocVisible] = useState(true);
  const [seen, setSeen] = useState(true);
  const [touch, setTouch] = useState(false);
  const { best, submit } = useHighScore(meta.id, { lowerIsBetter });
  const [muted, setMuted] = useMuted();
  const keys = useMemo(() => new KeyState(), []);
  const statusRef = useRef(status);
  statusRef.current = status;
  const roundBoard = useMemo(() => (compact ? null : boardFor(meta, result?.board)), [compact, meta, result?.board]);
  const board = useRoundBoard(roundBoard?.id ?? meta.id, roundBoard?.spec, result?.rank ?? result?.score, result?.id);
  const [boardOpen, setBoardOpen] = useState(false);
  const [name, setName] = useState('');
  const [onlineOpen, setOnlineOpen] = useState(false);
  const [onlineName, setOnlineName] = useState(() => savedName());
  const [onlineLink, setOnlineLink] = useState<RoomLink | null>(null);
  const [onlineCode, setOnlineCode] = useState('');
  const [onlineSeat, setOnlineSeat] = useState<number | null>(null);
  const [onlineSeats, setOnlineSeats] = useState(0);
  const [onlineRound, setOnlineRound] = useState(0);
  const [onlinePlayers, setOnlinePlayers] = useState<RoomPlayer[]>([]);
  const [onlineTransport, setOnlineTransport] = useState<RoomTransport>('relay');
  const [onlineBusy, setOnlineBusy] = useState(false);
  const [onlineError, setOnlineError] = useState('');
  const [onlineInProgress, setOnlineInProgress] = useState(false);
  /** Seats bots would take if the host started now (null: this room has no bots), and the ones playing this round. */
  const [onlineBots, setOnlineBots] = useState<number[] | null>(null);
  const [roundBots, setRoundBots] = useState<number[]>([]);
  const roundBotsRef = useRef<number[]>([]);
  /** Whether the room is listed in Open Rooms (null: the server doesn't say), and the kind of room Create Room makes. */
  const [onlineListed, setOnlineListed] = useState<boolean | null>(null);
  const [visibility, setVisibility] = useSetting(ROOM_VISIBILITY);
  /** How many bots this game's rooms start with when this player hosts: the last number they picked. */
  const botsSetting = useMemo(() => defineSetting(`${meta.id}:bots`, BOT_COUNTS, String(Math.max(0, Math.min(15, Math.floor(defaultBots))))), [meta.id, defaultBots]);
  const [onlineMode, setOnlineMode] = useState(false);
  const onlineModeRef = useRef(onlineMode);
  onlineModeRef.current = onlineMode;
  const race = !!meta.online?.race;
  const [raceScores, setRaceScores] = useState<RaceScores>({});
  const raceRef = useRef<{ link: RoomLink | null; seat: number | null; round: number; scores: RaceScores }>({ link: null, seat: null, round: 0, scores: {} });
  const raceReported = useRef(-1);
  const active = onlineMode || (host.active && docVisible && seen);
  const consumedRoom = useRef<string | null>(null);
  const fmt = useCallback((n: number) => (formatScore ? formatScore(n) : n.toLocaleString('en-US')), [formatScore]);

  useEffect(() => setTouch(!!os?.mobile || isTouchDevice()), [os?.mobile]);
  useEffect(() => sfx.retain(), []);
  // Opening a game counts as a play, and so does every round after it. The New Tab strip counts only once someone starts it.
  useEffect(() => {
    if (!compact || autoStart) countPlay(meta.id);
  }, [meta.id, compact, autoStart]);

  const focusRoot = useCallback(() => root.current?.focus({ preventScroll: true }), []);
  const start = useCallback(() => {
    countPlay(meta.id);
    sfx.unlock();
    keys.clear();
    setResult(null);
    setStatus('playing');
    focusRoot();
  }, [meta.id, keys, focusRoot]);

  const restart = useCallback(() => {
    countPlay(meta.id);
    sfx.unlock();
    keys.clear();
    setResult(null);
    setBoardOpen(false);
    setScoreState(null);
    setRound((r) => r + 1);
    setStatus('playing');
    focusRoot();
  }, [meta.id, keys, focusRoot]);
  /** From the Pause or Game Over card straight to Play Online: the round in progress is dropped. */
  const goOnline = useCallback(() => {
    keys.clear();
    setResult(null);
    setBoardOpen(false);
    setScoreState(null);
    setRound((r) => r + 1);
    setStatus('ready');
    setOnlineError('');
    setOnlineOpen(true);
  }, [keys]);
  /** Score race: guests send their score to the host, the host shares everyone's. */
  const applyRaceScores = useCallback((scores: RaceScores) => {
    raceRef.current.scores = scores;
    setRaceScores(scores);
    const { link, seat, round } = raceRef.current;
    if (link && seat === 0) link.send({ t: 'race-all', round, scores });
  }, []);
  const finishRace = useCallback((score: number | null) => {
    const { link, seat, round, scores } = raceRef.current;
    if (!link || seat === null) return;
    if (seat === 0) applyRaceScores({ ...scores, [seat]: score });
    else {
      raceRef.current.scores = { ...scores, [seat]: score };
      setRaceScores(raceRef.current.scores);
      link.send({ t: 'race', round, score });
    }
  }, [applyRaceScores]);
  const gameOver = useCallback(
    (final?: number, info: GameOverInfo = {}) => {
      if (statusRef.current === 'over') return;
      keys.clear();
      const isBest = final !== undefined && submit(final);
      setResult({ id: Date.now(), score: final, best: null, isBest, ...info });
      setBoardOpen(false);
      setName(savedName());
      setStatus('over');
      if (race && onlineModeRef.current) finishRace(info.rank ?? final ?? null);
    },
    [keys, submit, race, finishRace],
  );
  const playAgain = useCallback(() => {
    if (onlineModeRef.current) {
      if (onlineSeat === 0) onlineLink?.start();
      return;
    }
    restart();
  }, [onlineLink, onlineSeat, restart]);

  const clearBots = useCallback(() => {
    roundBotsRef.current = [];
    setRoundBots([]);
    setOnlineBots(null);
    setOnlineListed(null);
  }, []);

  const leaveRoom = useCallback(() => {
    onlineModeRef.current = false;
    raceRef.current = { link: null, seat: null, round: 0, scores: {} };
    setRaceScores({});
    onlineLink?.close();
    setOnlineLink(null);
    setOnlineCode('');
    setOnlineSeat(null);
    setOnlineSeats(0);
    setOnlineRound(0);
    setOnlinePlayers([]);
    setOnlineTransport('relay');
    setOnlineMode(false);
    setOnlineOpen(false);
    setOnlineError('');
    setOnlineInProgress(false);
    clearBots();
  }, [clearBots, onlineLink]);

  const connectRoom = useCallback((code: string) => {
    setOnlineError('');
    onlineModeRef.current = false;
    setOnlineMode(false);
    setOnlineRound(0);
    setOnlineTransport('relay');
    const link = new RoomLink(code, onlineName);
    raceRef.current = { link, seat: null, round: 0, scores: {} };
    setRaceScores({});
    setOnlineLink(link);
    setOnlineCode(code);
    setOnlineSeat(null);
    setOnlineSeats(meta.online?.seats ?? 0);
    setOnlinePlayers([]);
    setOnlineInProgress(false);
    clearBots();
    link.on('welcome', (message) => {
      raceRef.current.seat = message.seat;
      setOnlineCode(message.code);
      setOnlineSeat(message.seat);
      setOnlineSeats(message.seats);
      setOnlinePlayers(message.players);
      setOnlineInProgress(message.started);
      setOnlineBots(message.bots);
      const remembered = Math.min(Number(getSetting(botsSetting)), message.seats - 1);
      if (message.seat === 0 && message.bots && remembered > 0) link.setBots(remembered);
    });
    link.on('bots', setOnlineBots);
    link.on('listed', setOnlineListed);
    link.on('players', (players) => {
      setOnlinePlayers(players);
      // Bots keep playing a round that someone leaves; it ends only when nobody is left to play against.
      if (!onlineModeRef.current || players.length + roundBotsRef.current.length >= 2) return;
      gameOver(undefined, { title: 'Opponent Left', detail: 'Your opponent left the room.' });
      onlineModeRef.current = false;
      raceRef.current = { link: null, seat: null, round: 0, scores: {} };
      link.close();
      setOnlineLink(null);
      setOnlineCode('');
      setOnlineSeat(null);
      setOnlineSeats(0);
      setOnlinePlayers([]);
      setOnlineTransport('relay');
      setOnlineMode(false);
      setOnlineOpen(false);
      clearBots();
    });
    link.on('transport', setOnlineTransport);
    link.on('start', ({ round: serverRound, bots }) => {
      setOnlineOpen(false);
      setOnlineInProgress(false);
      roundBotsRef.current = bots;
      setRoundBots(bots);
      raceRef.current.round = nextOnlineRound(raceRef.current.round, serverRound);
      raceRef.current.scores = {};
      setRaceScores({});
      setOnlineRound(raceRef.current.round);
      if (onlineModeRef.current) {
        restart();
      } else {
        onlineModeRef.current = true;
        setOnlineMode(true);
        start();
      }
    });
    if (race) {
      link.on('msg', ({ from, d }) => {
        const packet = parseRacePacket(d);
        if (!packet || packet.round !== raceRef.current.round) return;
        if (packet.t === 'race' && raceRef.current.seat === 0 && from !== 0) applyRaceScores({ ...raceRef.current.scores, [from]: packet.score });
        else if (packet.t === 'race-all' && from === 0 && raceRef.current.seat !== 0) {
          raceRef.current.scores = packet.scores;
          setRaceScores(packet.scores);
        }
      });
    }
    link.on('closed', ({ reason }) => {
      onlineModeRef.current = false;
      raceRef.current = { link: null, seat: null, round: 0, scores: {} };
      setRaceScores({});
      link.close();
      setOnlineLink(null);
      setOnlineSeat(null);
      setOnlineSeats(0);
      setOnlineRound(0);
      setOnlinePlayers([]);
      setOnlineTransport('relay');
      setOnlineMode(false);
      setOnlineCode('');
      setOnlineError(reason === 'host-left' ? 'Host Left' : 'Connection Lost');
      setOnlineOpen(true);
      setStatus('ready');
      clearBots();
    });
    return link;
  }, [applyRaceScores, botsSetting, clearBots, gameOver, meta.online?.seats, onlineName, race, restart, start]);

  const makeRoom = useCallback(async () => {
    setOnlineBusy(true);
    setOnlineError('');
    try {
      const code = await createRoom(meta.id, { listed: visibility === 'public' });
      connectRoom(code);
    } catch (error) {
      setOnlineError(error instanceof Error ? error.message : 'Could Not Create Room');
    } finally {
      setOnlineBusy(false);
    }
  }, [connectRoom, meta.id, visibility]);

  const joinRoom = useCallback((code: string) => {
    setOnlineBusy(true);
    setOnlineError('');
    try {
      connectRoom(code.toUpperCase());
    } catch (error) {
      setOnlineError(error instanceof Error ? error.message : 'Could Not Join Room');
    } finally {
      setOnlineBusy(false);
    }
  }, [connectRoom]);

  useEffect(() => {
    if (!joinCode || !meta.online || compact || consumedRoom.current === joinCode) return;
    consumedRoom.current = joinCode;
    setOnlineOpen(true);
    joinRoom(joinCode);
  }, [compact, joinRoom, meta.online, joinCode]);

  useEffect(() => () => onlineLink?.close(), [onlineLink]);
  const pause = useCallback(() => {
    if (onlineModeRef.current) return;
    keys.clear();
    setStatus((s) => (s === 'playing' ? 'paused' : s));
  }, [keys]);
  // Settings changed on the Pause card no longer match the round in progress, so it can only start over.
  const setupChanges = useRef(new Map<string, string>());
  const [setupChanged, setSetupChanged] = useState(false);
  useEffect(() => {
    setupChanges.current.clear();
    setSetupChanged(false);
  }, [status]);
  useEffect(
    () =>
      onSettingChange((change) => {
        if (statusRef.current === 'paused' && isGameSetting(change.key, meta.id)) setSetupChanged(trackSettingChange(setupChanges.current, change));
      }),
    [meta.id],
  );
  const resume = useCallback(() => {
    if (setupChanges.current.size) return;
    sfx.unlock();
    setStatus((s) => (s === 'paused' ? 'playing' : s));
    focusRoot();
  }, [focusRoot]);
  const setScore = useCallback((n: number | null) => setScoreState(n), []);

  const listeners = useRef(new Set<() => void>());
  const invalidate = useCallback(() => listeners.current.forEach((f) => f()), []);
  const onInvalidate = useCallback((fn: () => void) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  // Auto-pause when the game stops being visible.
  useEffect(() => {
    if (!onlineMode && !active && status === 'playing') pause();
  }, [active, onlineMode, status, pause]);
  useEffect(() => {
    if (status !== 'playing') invalidate();
  }, [status, invalidate]);

  // Visibility: page hidden, element scrolled away, or hidden/minimized by the window manager.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const check = () => {
      const r = el.getBoundingClientRect();
      const inView = r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
      const shown = el.checkVisibility ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) : el.offsetParent !== null;
      setSeen(inView && shown);
    };
    const io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(check) : null;
    io?.observe(el);
    const t = window.setInterval(check, 400);
    const onVis = () => setDocVisible(!document.hidden);
    onVis();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      io?.disconnect();
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  // Key capture: only while focus is inside the game; never swallow Cmd/Ctrl/Alt combos.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const onDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      const st = statusRef.current;
      const onButton = t !== el && !!t.closest?.('button, a');
      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (onlineMode) {
          if (e.code === 'KeyP') {
            e.preventDefault();
            e.stopPropagation();
          }
          return;
        }
        if (st === 'playing' || st === 'paused') {
          e.preventDefault();
          e.stopPropagation();
          if (!e.repeat) (st === 'playing' ? pause : resume)();
        }
        return;
      }
      if (onButton && (e.code === 'Enter' || e.code === 'Space')) {
        e.stopPropagation();
        return;
      }
      e.stopPropagation();
      if (scrollKeys.has(e.code)) e.preventDefault();
      if (st === 'ready' || st === 'over' || st === 'paused') {
        if ((e.code === 'Enter' || e.code === 'Space') && !e.repeat) (st === 'ready' ? start : st === 'over' ? playAgain : setupChanges.current.size ? restart : resume)();
        return;
      }
      if (st === 'playing') keys.press(e.code, e);
    };
    const onUp = (e: KeyboardEvent) => {
      keys.release(e.code);
      if (!e.metaKey && !e.ctrlKey && !e.altKey) e.stopPropagation();
    };
    const onOut = (e: FocusEvent) => {
      if (!el.contains(e.relatedTarget as Node | null)) keys.clear();
    };
    const onBlur = () => keys.clear();
    el.addEventListener('keydown', onDown);
    el.addEventListener('keyup', onUp);
    el.addEventListener('focusout', onOut);
    window.addEventListener('blur', onBlur);
    return () => {
      el.removeEventListener('keydown', onDown);
      el.removeEventListener('keyup', onUp);
      el.removeEventListener('focusout', onOut);
      window.removeEventListener('blur', onBlur);
    };
  }, [keys, onlineMode, pause, playAgain, restart, resume, start]);

  const api = useMemo<ShellApi>(
    () => ({ meta, status, round, active, compact, touch, keys, root, start, pause, resume, restart, gameOver, setScore, invalidate, onInvalidate }),
    [meta, status, round, active, compact, touch, keys, start, pause, resume, restart, gameOver, setScore, invalidate, onInvalidate],
  );

  // Party games keep scores and secrets in the round, so Restart asks for a second tap within a few seconds.
  const confirmRestart = meta.category === 'party' || meta.category === 'drinking';
  const [restartArmed, setRestartArmed] = useState(false);
  useEffect(() => {
    if (!restartArmed) return;
    const t = window.setTimeout(() => setRestartArmed(false), 3000);
    return () => window.clearTimeout(t);
  }, [restartArmed]);
  useEffect(() => setRestartArmed(false), [status, round]);
  const restartFromBar = useCallback(() => {
    if (confirmRestart && !restartArmed) {
      setRestartArmed(true);
      return;
    }
    setRestartArmed(false);
    restart();
  }, [confirmRestart, restartArmed, restart]);
  const ctl = (fn: () => void) => () => {
    fn();
    focusRoot();
  };
  const bestNow = result?.isBest ? result.score : best;
  const glyph = (
    <span className="arcade-glyph" style={{ background: meta.accent }}>
      <Icon d={meta.glyph} size={compact ? 16 : 26} />
    </span>
  );
  const canPlayOnline = !compact && !!meta.online && !!ARCADE_API;
  const gameOnline = onlineMode && onlineLink !== null && onlineSeat !== null;
  // Games see this round's bots while it is under way and the lobby's between rounds. Names are keyed by their text,
  // so a list written inline in the game's JSX does not count as a change every render.
  const botNameKey = botNames?.join('\n') ?? '';
  const lobbyBots = useMemo(() => (onlineBots ? botPlayers(onlineBots, botNameKey ? botNameKey.split('\n') : []) : null), [onlineBots, botNameKey]);
  const playingBots = useMemo(() => botPlayers(roundBots, botNameKey ? botNameKey.split('\n') : []), [roundBots, botNameKey]);
  const gameBots = onlineMode && status === 'playing' ? playingBots : lobbyBots ?? playingBots;
  const setBots = useCallback((n: number) => {
    setSetting(botsSetting, String(n));
    onlineLink?.setBots(n);
  }, [botsSetting, onlineLink]);
  const hostBots = gameOnline && onlineSeat === 0 && lobbyBots ? <BotStepper count={lobbyBots.length} max={Math.max(0, onlineSeats - onlinePlayers.length)} onChange={setBots} /> : null;
  const setListed = useCallback((on: boolean) => onlineLink?.setListed(on), [onlineLink]);
  // Between rounds of a game people can join late, the host can still open the room up (or close it).
  const hostListed = gameOnline && onlineSeat === 0 && meta.online?.lateJoin && onlineListed !== null ? <VisibilityPicker value={onlineListed ? 'public' : 'private'} onChange={(v) => setListed(v === 'public')} /> : null;
  const raceNow = race && gameOnline ? raceStandings(raceScores, onlinePlayers.map((p) => p.seat), lowerIsBetter) : null;
  const raceDone = !!raceNow?.done;
  const raceWinner = raceNow?.winner ?? null;
  const boardFmt = result?.rank !== undefined && roundBoard ? (n: number) => formatBoardScore(n, roundBoard.spec) : fmt;

  // Every player reports the race winner once all scores are in; the Worker records it when they agree.
  useEffect(() => {
    if (!raceDone || !onlineLink || raceReported.current === onlineRound) return;
    raceReported.current = onlineRound;
    onlineLink.reportResult(onlineRound, raceWinner);
  }, [raceDone, raceWinner, onlineLink, onlineRound]);
  const backToArcade = useCallback(() => {
    if (onlineLink) leaveRoom();
    onExit?.();
  }, [leaveRoom, onExit, onlineLink]);

  return (
    <OnlineProvider
      link={onlineLink}
      seat={onlineSeat}
      seats={onlineSeats}
      round={onlineRound}
      players={onlinePlayers}
      bots={gameBots}
      transport={onlineTransport}
    >
    <ShellContext.Provider value={api}>
      <div
        ref={root}
        className={['arcade-shell', `g-${meta.id}`, compact ? 'is-compact' : '', `st-${status}`, className ?? ''].join(' ')}
        style={{ ['--accent' as string]: meta.accent, ...style }}
        tabIndex={0}
        role="application"
        aria-label={meta.title}
        onPointerDown={(e) => {
          sfx.unlock();
          if (!(e.target as HTMLElement).closest('button, a, input, textarea, select')) focusRoot();
        }}
        onKeyDown={() => sfx.unlock()}
        onMouseDown={(e) => {
          if (!(e.target as HTMLElement).closest('button, a, input, textarea, select')) e.preventDefault();
        }}
      >
        <div className="arcade-stage" key={remount ? round : 0}>
          {children}
        </div>

        {score !== null && status !== 'ready' && <div className="arcade-score">{fmt(score)}</div>}
        {gameOnline && status === 'playing' && <div className="arcade-online-status">{onlineTransport === 'direct' ? 'Direct' : 'Relayed'}</div>}

        {!compact && (
          <div className="arcade-ctrl">
            {(status === 'playing' || (status === 'paused' && !setupChanged)) && !onlineMode && (
              <button type="button" aria-label={status === 'paused' ? 'Resume' : 'Pause'} title={status === 'paused' ? 'Resume' : 'Pause'} onClick={status === 'paused' ? resume : pause}>
                <Icon d={status === 'paused' ? ic.play : ic.pause} />
              </button>
            )}
            {status !== 'ready' && !onlineMode && (
              <button
                type="button"
                className={restartArmed ? 'is-armed' : undefined}
                aria-label={restartArmed ? 'Tap again to restart' : 'Restart'}
                title={restartArmed ? 'Tap again to restart' : 'Restart'}
                onClick={restartFromBar}
              >
                <Icon d={ic.restart} />
                {restartArmed && <span className="arcade-ctrl-confirm">Restart?</span>}
              </button>
            )}
            <button type="button" aria-label={muted ? 'Unmute' : 'Mute'} title={muted ? 'Unmute' : 'Mute'} onClick={ctl(() => setMuted(!muted))}>
              <Icon d={muted ? ic.muted : ic.sound} />
            </button>
            {onExit && (
              <button type="button" aria-label="Arcade" title="Arcade" onClick={backToArcade}>
                <Icon d={ic.grid} />
              </button>
            )}
          </div>
        )}

        {status === 'ready' && onlineOpen && canPlayOnline && (
          <OnlinePanel
            game={meta.id}
            code={onlineCode}
            players={onlinePlayers}
            bots={lobbyBots}
            listed={onlineListed}
            visibility={visibility}
            seat={onlineSeat}
            seats={onlineSeats}
            inProgress={onlineInProgress}
            busy={onlineBusy}
            error={onlineError}
            name={onlineName}
            onName={setOnlineName}
            onVisibility={setVisibility}
            onCreate={makeRoom}
            onJoin={joinRoom}
            onStart={() => onlineLink?.start()}
            onBots={setBots}
            onListed={setListed}
            onLeave={leaveRoom}
            note={race ? 'A score race: everyone plays their own round at the same time and the best score wins.' : undefined}
            setup={hostSetup}
          />
        )}

        {status === 'ready' && !onlineOpen &&
          (compact ? (
            <button type="button" className="arcade-ov arcade-ov-compact" onClick={start}>
              {glyph}
              <span>
                <b>{meta.title}</b> {touch ? 'Tap to Play' : 'Press Space to Play'}
                {best !== null && <em> · Best {fmt(best)}</em>}
              </span>
            </button>
          ) : (
            <div className="arcade-ov">
              <div className="arcade-card">
                {glyph}
                <h2>{meta.title}</h2>
                <p>{meta.controls}</p>
                {setup && <div className="arcade-setup">{setup}</div>}
                <button type="button" className="arcade-btn arcade-btn-primary arcade-btn-lg" onClick={start} ref={autoFocus}>
                  Play
                </button>
                {canPlayOnline && (
                  <button type="button" className="arcade-btn arcade-btn-lg" onClick={() => { setOnlineError(''); setOnlineOpen(true); }}>
                    Play Online
                  </button>
                )}
                {best !== null && <small>Best {fmt(best)}</small>}
              </div>
            </div>
          ))}

        {status === 'paused' &&
          (compact ? (
            <button type="button" className="arcade-ov arcade-ov-compact" onClick={resume}>
              <Icon d={ic.play} />
              <span>
                <b>Paused</b> {touch ? 'Tap to Resume' : 'Press Space to Resume'}
              </span>
            </button>
          ) : (
            <div className="arcade-ov">
              <div className="arcade-card">
                <h2>Paused</h2>
                <p>{setupChanged ? 'New Settings Need A New Game.' : meta.controls}</p>
                {setup && <div className="arcade-setup">{setup}</div>}
                <button type="button" className="arcade-btn arcade-btn-primary arcade-btn-lg" onClick={setupChanged ? restart : resume} ref={autoFocus}>
                  {setupChanged ? 'New Game' : 'Resume'}
                </button>
                <div className="arcade-row">
                  {!setupChanged && (
                    <button type="button" className="arcade-btn" onClick={restart}>
                      {setup ? 'New Game' : 'Restart'}
                    </button>
                  )}
                  {canPlayOnline && (
                    <button type="button" className="arcade-btn" onClick={goOnline}>
                      Play Online
                    </button>
                  )}
                  {onExit && (
                    <button type="button" className="arcade-btn" onClick={backToArcade}>
                      Arcade
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}

        {status === 'over' && !compact && boardOpen && (
          <div className="arcade-ov">
            <div className="arcade-card arcade-lb-card">
              <h2>Leaderboard</h2>
              <BoardScopeNote board={board.board} />
              <BoardList board={board.board} fmt={boardFmt} mine={board.mine} />
              <div className="arcade-row">
                <button type="button" className="arcade-btn" onClick={() => setBoardOpen(false)}>
                  Back
                </button>
                {gameOnline && onlineSeat !== 0 ? (
                  <button type="button" className="arcade-btn" onClick={leaveRoom}>
                    Leave
                  </button>
                ) : (
                  <button type="button" className="arcade-btn arcade-btn-primary" onClick={playAgain} ref={autoFocus}>
                    Play Again
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {status === 'over' &&
          !boardOpen &&
          (compact ? (
            <button type="button" className="arcade-ov arcade-ov-compact" onClick={restart}>
              <Icon d={ic.restart} />
              <span>
                <b>{result?.title ?? 'Game Over'}</b>
                {result?.score !== undefined && ` ${fmt(result.score)}`}
                {bestNow != null && <em> · Best {fmt(bestNow)}</em>} · {touch ? 'Tap to Play Again' : 'Press Space to Play Again'}
              </span>
            </button>
          ) : (
            <div className="arcade-ov">
              <div className="arcade-card">
                <h2>{result?.title ?? 'Game Over'}</h2>
                {result?.score !== undefined && (
                  <div className="arcade-final">
                    <b>{fmt(result.score)}</b>
                    {result.isBest ? <span className="arcade-new">New Best</span> : bestNow != null && <span>Best {fmt(bestNow)}</span>}
                  </div>
                )}
                {result?.detail && <p>{result.detail}</p>}
                {raceNow && (
                  <ol className="arcade-race" aria-label="Race Standings">
                    {raceNow.standings.map((entry) => (
                      <li key={entry.seat} className={entry.seat === onlineSeat ? 'is-mine' : undefined}>
                        <span className="arcade-race-place">{entry.place ?? '-'}</span>
                        <span className="arcade-race-name">{onlinePlayers.find((p) => p.seat === entry.seat)?.name ?? `Player ${entry.seat + 1}`}</span>
                        <span className="arcade-race-score">
                          {Object.hasOwn(raceScores, entry.seat) ? (entry.score === null ? 'No Score' : fmt(entry.score)) : 'Playing'}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
                {raceNow && (
                  <small>
                    {!raceDone ? 'Waiting For Everyone to Finish' : raceWinner === null ? 'A Tie' : raceWinner === onlineSeat ? 'You Win the Race' : `${onlinePlayers.find((p) => p.seat === raceWinner)?.name ?? 'Someone'} Wins the Race`}
                  </small>
                )}
                {board.canSubmit && (
                  <form
                    className="arcade-lb-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (validName(name) && !board.busy) board.submit(name).then(() => setBoardOpen(true));
                    }}
                  >
                    <span>{board.board?.scope === 'global' ? 'A Top 100 Score. Add Your Name.' : 'A Top 100 Score on This Device.'}</span>
                    <div className="arcade-lb-field">
                      <input
                        className="arcade-input"
                        type="text"
                        aria-label="Your Name"
                        placeholder="Your Name"
                        maxLength={NAME_MAX}
                        autoComplete="nickname"
                        enterKeyHint="send"
                        spellCheck={false}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        onKeyDown={(e) => {
                          if (!e.metaKey && !e.ctrlKey) e.stopPropagation();
                        }}
                      />
                      <button type="submit" className="arcade-btn" disabled={!validName(name) || board.busy}>
                        Submit
                      </button>
                    </div>
                  </form>
                )}
                {setup && !gameOnline && <div className="arcade-setup">{setup}</div>}
                {gameOnline && (hostListed || hostBots || hostSetup) && (
                  <div className="arcade-setup">
                    {hostListed}
                    {hostBots}
                    {hostSetup}
                  </div>
                )}
                {gameOnline ? onlineSeat === 0 ? (
                  <button type="button" className="arcade-btn arcade-btn-primary arcade-btn-lg" onClick={playAgain} ref={autoFocus}>
                    Play Again
                  </button>
                ) : (
                  <>
                    <p>Waiting For The Host</p>
                    <button type="button" className="arcade-btn arcade-btn-lg" onClick={leaveRoom} ref={autoFocus}>
                      Leave
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" className="arcade-btn arcade-btn-primary arcade-btn-lg" onClick={restart} ref={autoFocus}>
                      Play Again
                    </button>
                    {canPlayOnline && (
                      <button type="button" className="arcade-btn arcade-btn-lg" onClick={goOnline}>
                        Play Online
                      </button>
                    )}
                  </>
                )}
                {(onExit || board.enabled) && (
                  <div className="arcade-row">
                    {board.enabled && (
                      <button type="button" className="arcade-btn" onClick={() => setBoardOpen(true)}>
                        Leaderboard
                      </button>
                    )}
                    {onExit && (
                      <button type="button" className="arcade-btn" onClick={backToArcade}>
                        Arcade
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
      </div>
    </ShellContext.Provider>
    </OnlineProvider>
  );
}

/** The surrounding <GameShell>'s state and controls. Throws if used outside one. */
export function useShell(): ShellApi {
  const s = useContext(ShellContext);
  if (!s) throw new Error('useShell must be used inside <GameShell>');
  return s;
}
