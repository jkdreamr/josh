import { useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { OSContext } from '../../types';
import type { GameMeta } from '../types';
import { ShellContext, type GameOverInfo, type GameStatus, type ShellApi } from './context';
import { ArcadeHost, ArcadeInvite } from './host';
import { KeyState, scrollKeys } from './keys';
import { useHighScore } from './score';
import { ARCADE_API, NAME_MAX, boardFor, cleanName, formatBoardScore, saveName, savedName } from './leaderboard';
import { BoardList, BoardScopeNote, useRoundBoard, validName } from './board';
import { sfx, useMusicOn, useMuted } from './sfx';
import { useBackgroundMusic } from './music';
import { defineSetting, getSetting, isGameSetting, onSettingChange, setSetting, trackSettingChange, useSetting } from './settings';
import { BotStepper, OnlinePanel, OnlineProvider, QuickPanel, ROOM_VISIBILITY, ROOM_WATCHERS, RoomCode, RoomRoster, VisibilityPicker, WatchPicker, type HandOff } from './online';
import { MAX_SEATS, botPlayers, canStartNext, handOffScores, handOffSeat, handOffSettled, nextOnlineRound, parseRacePacket, roundLeftVerdict, raceSeats, raceStandings, raceVerdict, RoundRouter, type RaceScores, type SettledRace } from './online-core';
import { createRoom, quickRoom, RoomLink, type RoomPlayer, type RoomTransport } from './room';
import { countPlay } from '../../stats';
import { useBadge } from '../../badges';
import { usePlayingReport } from '../playing';
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
  /** Quick play (games with `online.quick`): one line on its card about who else plays, e.g. that bots fill the rest. */
  quickNote?: string;
  /** Quick play: the Start card's button for playing on this device with the game's own settings (default Play Offline). */
  soloLabel?: string;
  /** Make phone-room creation the primary Start-card action for games that use a phone as their main controller. */
  phoneFirst?: boolean;
  /**
   * Quick play: a picker shown with the Start card's Play (a mode, say), and the pool it picks (`useOnline().pool`):
   * quick play only puts people in the same pool together.
   */
  quickSetup?: ReactNode;
  quickPool?: string;
  /**
   * Online: the game copes with people leaving itself (it hands their seat to a bot between rounds), so the shell
   * doesn't end a round when nobody is left to play against, as with quick play.
   */
  handlesLeavers?: boolean;
  className?: string;
  style?: CSSProperties;
};

/** What to tell someone the room is gone for, or turned them away (see RoomLink's closed event). */
const closedReason = (reason: string) =>
  ({
    'host-left': 'Host Left',
    'room-closed': 'The Room Closed',
    'not-found': 'No Room Has That Code',
    started: 'That Room Is Already Playing',
    full: 'That Room Is Full',
    'no-watching': 'The Host Turned Watching Off',
  })[reason] ?? 'Connection Lost';

/** How long keys are ignored on an online Game Over card after the round ends. */
const KEY_LOCKOUT_MS = 900;

type Result = { id: number; score?: number; best: number | null; isBest: boolean } & GameOverInfo;
/** A room holds MAX_SEATS seats at most, so a host never asks for more bots than that. */
const BOT_COUNTS = Array.from({ length: MAX_SEATS }, (_, i) => String(i));

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
  music: 'M9 18V6l11-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  musicOff: 'M9 18V6l11-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM3 3l18 18',
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  chat: 'M20 12.5a7.5 7.5 0 0 1-11 6.6L4 20.5l1.4-4.6A7.5 7.5 0 1 1 20 12.5z',
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
export function GameShell({ meta, compact = false, onExit, children, autoStart, lowerIsBetter, formatScore, remount = true, setup, hostSetup, botNames, defaultBots = 0, quickNote, soloLabel = 'Play Offline', phoneFirst = false, quickSetup, quickPool, handlesLeavers = false, roomCode, className, style }: GameShellProps) {
  const host = useContext(ArcadeHost);
  const invite = useContext(ArcadeInvite);
  const joinCode = roomCode ?? invite;
  const os = useContext(OSContext);
  const root = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<GameStatus>(autoStart ? 'playing' : 'ready');
  const [round, setRound] = useState(0);
  const [score, setScoreState] = useState<number | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [hidePhoneFirstResultCard, setHidePhoneFirstResultCard] = useState(false);
  const [docVisible, setDocVisible] = useState(true);
  const [seen, setSeen] = useState(true);
  const [touch, setTouch] = useState(false);
  const { best, submit } = useHighScore(meta.id, { lowerIsBetter });
  const [muted, setMuted] = useMuted();
  const [musicOn, setMusicOn] = useMusicOn();
  /** The How to Play card is up over the Start or Pause card. */
  const [howOpen, setHowOpen] = useState(false);
  const howRef = useRef(false);
  howRef.current = howOpen;
  const keys = useMemo(() => new KeyState(), []);
  const statusRef = useRef(status);
  statusRef.current = status;
  /** When the round last ended, so keys pressed in the moment it ends don't count on the Game Over card. */
  const overAt = useRef(0);
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
  /** The room connection dropped and the link is getting this player's seat back. */
  const [onlineReconnecting, setOnlineReconnecting] = useState(false);
  const [onlineHandoffs, setOnlineHandoffs] = useState(0);
  const [handedOff, setHandedOff] = useState<HandOff[]>([]);
  const [onlineBusy, setOnlineBusy] = useState(false);
  const [onlineError, setOnlineError] = useState('');
  const [onlineInProgress, setOnlineInProgress] = useState(false);
  /** Seats bots would take if the host started now (null: this room has no bots), and the ones playing this round. */
  const [onlineBots, setOnlineBots] = useState<number[] | null>(null);
  const [roundBots, setRoundBots] = useState<number[]>([]);
  const roundBotsRef = useRef<number[]>([]);
  /** Seats of the people playing this round (late joiners sit it out), and the room this player last lost touch with. */
  const [roundSeats, setRoundSeats] = useState<number[]>([]);
  const roundSeatsRef = useRef<number[]>([]);
  const [lostCode, setLostCode] = useState('');
  /** Whether the room is listed in Open Rooms (null: the server doesn't say), and the kind of room Create Room makes. */
  const [onlineListed, setOnlineListed] = useState<boolean | null>(null);
  /**
   * Quick play: whether this is a quick-play room (or the card that finds one is up), when its match starts (a
   * performance.now() time, while it gathers), and how many rooms in a row turned out to be under way or full.
   */
  const [quick, setQuick] = useState(false);
  const quickRef = useRef(false);
  quickRef.current = quick;
  const handlesLeaversRef = useRef(handlesLeavers);
  handlesLeaversRef.current = handlesLeavers;
  /** The quick-play pool of the room we're in ('' for none). */
  const [pool, setPool] = useState('');
  const [gatherAt, setGatherAt] = useState<number | null>(null);
  const quickTries = useRef(0);
  const findMatchRef = useRef<() => void>(() => {});
  /**
   * Spectating (games with `online.watch`): in as a spectator, who is watching the room, whether its host lets people
   * watch (null: nobody can watch this game), and whether the room is playing a round right now.
   */
  const [watching, setWatching] = useState(false);
  const [watchers, setWatchers] = useState<string[]>([]);
  const [watchable, setWatchable] = useState<boolean | null>(null);
  const [roomStarted, setRoomStarted] = useState(false);
  const [, setWatchSetting] = useSetting(ROOM_WATCHERS);
  const connectRef = useRef<(code: string, quickPlay?: boolean, watch?: boolean, nameOverride?: string) => RoomLink>(null!);
  // The Lounge shows what you're playing, and your room while it's public, so people there can join you.
  usePlayingReport(compact ? null : meta.id, onlineLink && onlineListed && onlineCode ? onlineCode : null);
  const loungeUnread = useBadge('lounge');
  const [visibility, setVisibility] = useSetting(ROOM_VISIBILITY);
  /** How many bots this game's rooms start with when this player hosts: the last number they picked. */
  const botsSetting = useMemo(() => defineSetting(`${meta.id}:bots`, BOT_COUNTS, String(Math.max(0, Math.min(MAX_SEATS - 1, Math.floor(defaultBots))))), [meta.id, defaultBots]);
  const [onlineMode, setOnlineMode] = useState(false);
  const onlineModeRef = useRef(onlineMode);
  onlineModeRef.current = onlineMode;
  const race = !!meta.online?.race;
  /** The game takes over a round its host leaves (see OnlineSpec migrate), so the round goes on. */
  const migrates = !!meta.online?.migrate;
  /** The Start card's Play is quick play, and Play with Bots plays alone. */
  const phoneFirstOn = !compact && phoneFirst && !!ARCADE_API;
  const quickOn = !phoneFirstOn && !compact && !!meta.online?.quick && !!ARCADE_API;
  const [raceScores, setRaceScores] = useState<RaceScores>({});
  const [raceSettled, setRaceSettled] = useState<SettledRace | null>(null);
  const raceRef = useRef<{ link: RoomLink | null; seat: number | null; round: number; scores: RaceScores }>({ link: null, seat: null, round: 0, scores: {} });
  const raceReported = useRef(-1);
  const active = onlineMode || (host.active && docVisible && seen);
  const consumedRoom = useRef<string | null>(null);
  const autoPhoneConnect = useRef(false);
  const router = useMemo(() => new RoundRouter(), []);
  const fmt = useCallback((n: number) => (formatScore ? formatScore(n) : n.toLocaleString('en-US')), [formatScore]);

  useEffect(() => setTouch(!!os?.mobile || isTouchDevice()), [os?.mobile]);
  useEffect(() => sfx.retain(), []);
  useBackgroundMusic(meta.id, compact ? undefined : meta.music, round, status === 'playing');
  useEffect(() => {
    if (status !== 'ready' && status !== 'paused') setHowOpen(false);
  }, [status]);
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
    statusRef.current = 'playing';
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
    statusRef.current = 'playing';
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
      // Over at once, before the next render: a second ending in the same moment (the host leaving, then the room
      // saying who's left) must not replace the first.
      statusRef.current = 'over';
      keys.clear();
      const isBest = final !== undefined && submit(final);
      setHidePhoneFirstResultCard(!!(phoneFirstOn && info?.hideShellCard));
      setResult({ id: Date.now(), score: final, best: null, isBest, ...info });
      setBoardOpen(false);
      setName(savedName());
      overAt.current = performance.now();
      setStatus('over');
      if (race && onlineModeRef.current) finishRace(info.rank ?? final ?? null);
    },
    [keys, submit, race, finishRace, phoneFirstOn],
  );
  /** Changes the card that is up, for a round that goes on after this player is out. */
  const updateOver = useCallback((info: GameOverInfo) => {
    setResult((r) => (!r || (r.title === info.title && r.detail === info.detail && r.wait === info.wait) ? r : { ...r, title: info.title, detail: info.detail, wait: info.wait }));
  }, []);
  /** What the host's Play Again waits on (see canStartNext). */
  const nextRound = useRef({ ready: true, waiting: false, racing: false });
  const playAgain = useCallback((force = false) => {
    if (onlineModeRef.current && quickRef.current) {
      // quick play goes back in the queue for the next match, once this one is over for everyone the host runs it for
      if (!nextRound.current.waiting) requeue();
      return;
    }
    if (onlineModeRef.current) {
      if (onlineSeat === 0 && canStartNext(nextRound.current, force)) onlineLink?.start();
      return;
    }
    restart();
  }, [onlineLink, onlineSeat, restart]);
  // A race's Play Again asks twice while someone is still playing, since starting ends their round.
  const [startArmed, setStartArmed] = useState(false);
  useEffect(() => {
    if (!startArmed) return;
    const t = window.setTimeout(() => setStartArmed(false), 3000);
    return () => window.clearTimeout(t);
  }, [startArmed]);

  const clearBots = useCallback(() => {
    roundBotsRef.current = [];
    setRoundBots([]);
    roundSeatsRef.current = [];
    setRoundSeats([]);
    setOnlineBots(null);
    setOnlineListed(null);
    setWatchers([]);
    setWatchable(null);
    setRoomStarted(false);
  }, []);

  const leaveRoom = useCallback(() => {
    onlineModeRef.current = false;
    raceRef.current = { link: null, seat: null, round: 0, scores: {} };
    setRaceScores({});
    setRaceSettled(null);
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
    setQuick(false);
    setPool('');
    setGatherAt(null);
    setWatching(false);
    clearBots();
  }, [clearBots, onlineLink]);

  /** Off the Game Over card (or out of a round) and back to the Start card, or on to the next quick match. */
  const toStart = useCallback(() => {
    keys.clear();
    leaveRoom();
    setResult(null);
    setBoardOpen(false);
    setScoreState(null);
    setRound((r) => r + 1);
    setStatus('ready');
  }, [keys, leaveRoom]);
  function requeue() {
    toStart();
    quickTries.current = 0;
    findMatchRef.current();
  }

  /** `quick`: a room quick play found. A room that says it is a quick-play room plays as one however it was joined. */
  const connectRoom = useCallback((code: string, quickPlay = false, watch = false, nameOverride?: string) => {
    setOnlineError('');
    setWatching(watch);
    setQuick(quickPlay);
    quickRef.current = quickPlay;
    setGatherAt(null);
    onlineModeRef.current = false;
    setOnlineMode(false);
    setOnlineRound(0);
    setOnlineTransport('relay');
    setOnlineReconnecting(false);
    setHandedOff([]);
    const link = new RoomLink(code, nameOverride ?? onlineName, ARCADE_API, { watch });
    raceRef.current = { link, seat: null, round: 0, scores: {} };
    setRaceScores({});
    setRaceSettled(null);
    setOnlineLink(link);
    setOnlineCode(code);
    setOnlineSeat(null);
    setOnlineSeats(meta.online?.seats ?? 0);
    setOnlinePlayers([]);
    setOnlineInProgress(false);
    clearBots();
    router.join(0);
    link.on('msg', ({ from, d }) => router.receive(from, d, onlineModeRef.current || router.holding));
    link.on('welcome', (message) => {
      // Quick play only joins a match that is gathering: one under way (or over) means on to the next.
      if (message.quick && !message.watching && (message.started || message.startIn === null)) {
        link.close();
        // a quick match someone picked from Open Rooms or a link, under way: watch it, when people can
        if (!quickRef.current && message.started && message.watchable) {
          connectRef.current(link.code, false, true);
          return;
        }
        if (quickTries.current++ < 3) findMatchRef.current();
        else {
          setOnlineLink(null);
          setOnlineCode('');
          setOnlineError('No Match Is Starting. Try Again in a Moment.');
        }
        return;
      }
      if (message.quick) {
        quickRef.current = true;
        setQuick(true);
      }
      setPool(link.pool);
      router.join(message.round);
      raceRef.current.seat = message.seat;
      setOnlineCode(message.code);
      setOnlineSeat(message.seat);
      setOnlineSeats(message.seats);
      setOnlinePlayers(message.players);
      if (phoneFirst && isTouchDevice() && message.seat > 0 && !message.watching) {
        setOnlineOpen(false);
        setOnlineRound(message.round);
      }
      setOnlineInProgress(message.started);
      setRoomStarted(message.started);
      setOnlineBots(message.bots);
      const remembered = Math.min(Number(getSetting(botsSetting)), message.seats - 1);
      if (message.seat === 0 && message.bots && remembered > 0 && !message.quick) link.setBots(remembered);
      // A spectator who comes in mid-round watches it from here: the game draws the host's next broadcasts.
      if (message.watching && message.started) {
        roundBotsRef.current = message.roundBots;
        setRoundBots(message.roundBots);
        roundSeatsRef.current = message.players.map((player) => player.seat);
        setRoundSeats(roundSeatsRef.current);
        raceRef.current.round = message.round;
        setOnlineRound(message.round);
        setOnlineOpen(false);
        setOnlineInProgress(false);
        onlineModeRef.current = true;
        setOnlineMode(true);
        start();
      }
    });
    let watchSaid = false;
    link.on('watchers', ({ names, on }) => {
      setWatchers(names);
      setWatchable(on);
      // the host's own choice, the first time the room says (a quick-play room is everyone's, so it stays open)
      if (!watchSaid && link.seat === 0 && !link.quick && on && getSetting(ROOM_WATCHERS) === 'off') link.setWatchable(false);
      watchSaid = true;
    });
    link.on('gather', (ms) => setGatherAt(ms === null ? null : performance.now() + ms));
    link.on('bots', setOnlineBots);
    link.on('listed', setOnlineListed);
    // Someone joining for the next round sees when the one under way ends.
    link.on('started', (started) => {
      setRoomStarted(started);
      if (!onlineModeRef.current) setOnlineInProgress(started);
    });
    // The host left and someone took over. Their game ran the round, so it's over (unless the new host's game takes it
    // over); everyone stays in the room.
    link.on('host', ({ from, seat, players, started }) => {
      raceRef.current.seat = seat;
      // the room renumbered its seats: race scores and the round's lineup follow, so nobody's result moves to someone else
      roundSeatsRef.current = roundSeatsRef.current.map((s) => handOffSeat(s, from));
      setRoundSeats(roundSeatsRef.current);
      raceRef.current.scores = handOffScores(raceRef.current.scores, from);
      setRaceScores(raceRef.current.scores);
      setOnlineSeat(seat);
      setOnlineInProgress(false);
      const host = players.find((player) => player.seat === 0);
      // a finished race keeps its standings and names, now under the new seat numbers
      setRaceSettled((settled) => settled && handOffSettled(settled, from));
      setOnlineHandoffs((n) => n + 1);
      if (migrates && onlineModeRef.current && started) {
        // the round goes on, the new host's game running it (a room that ended it instead, with nobody from it left to
        // run it or on a server from before, ends it here as for any game): a card already up on the new host holds the
        // next round until its game says this one is over
        setHandedOff((h) => [...h, { round: raceRef.current.round, from }]);
        if (seat === 0) setResult((r) => (r && !r.wait ? { ...r, wait: 'The Match Goes On.' } : r));
        return;
      }
      // a card waiting on the round the old host ran waits no more
      setResult((r) => (r?.wait ? { ...r, wait: undefined } : r));
      if (onlineModeRef.current && statusRef.current === 'playing') {
        const detail = quickRef.current && !link.watching ? 'The Match Ended With Them. Play Again for the Next One.' : seat === 0 ? 'You Are the Host Now.' : `${host?.name ?? 'Someone Else'} Is the Host Now.`;
        gameOver(undefined, { title: 'Host Left', detail });
      }
    });
    link.on('players', (players) => {
      setOnlinePlayers(players);
      // Bots keep playing a round that someone leaves; it ends only when nobody is left to play against. Everyone stays
      // in the room, so someone else can join and the host can start the next round.
      // Quick play and games that handle their own leavers do not end the round here.
      if (!onlineModeRef.current || statusRef.current !== 'playing' || quickRef.current || handlesLeaversRef.current) return;
      const verdict = roundLeftVerdict({
        phoneFirst,
        watching: link.watching,
        inRound: players.filter((player) => roundSeatsRef.current.includes(player.seat)).length,
        bots: roundBotsRef.current.length,
        players: players.length,
      });
      if (verdict) gameOver(undefined, verdict);
    });
    link.on('transport', setOnlineTransport);
    link.on('link', (state) => setOnlineReconnecting(state === 'reconnecting'));
    link.on('start', ({ round: serverRound, bots, players }) => {
      setOnlineOpen(false);
      setOnlineInProgress(false);
      setRoomStarted(true);
      roundBotsRef.current = bots;
      setRoundBots(bots);
      roundSeatsRef.current = players.map((player) => player.seat);
      setRoundSeats(roundSeatsRef.current);
      // The round's lineup, so a game set up from online.players includes someone who joined as the host pressed start.
      setOnlinePlayers(players);
      raceRef.current.round = nextOnlineRound(raceRef.current.round, serverRound);
      router.begin(raceRef.current.round);
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
    link.on('closed', ({ reason, watch: canWatch }) => {
      // a quick-play room that filled up as we got there: another one
      if (quickRef.current && link.seat === null && !link.watching && quickTries.current++ < 3) {
        link.close();
        findMatchRef.current();
        return;
      }
      // A room that is playing (or full) and lets people watch: watch it, and take a seat once one opens up.
      if (!quickRef.current && !link.watching && (reason === 'started' || reason === 'full') && canWatch) {
        link.close();
        connectRef.current(link.code, false, true);
        return;
      }
      onlineModeRef.current = false;
      raceRef.current = { link: null, seat: null, round: 0, scores: {} };
      setRaceScores({});
      setRaceSettled(null);
      link.close();
      setOnlineLink(null);
      setOnlineSeat(null);
      setOnlineSeats(0);
      setOnlineRound(0);
      setOnlinePlayers([]);
      setOnlineTransport('relay');
      setOnlineMode(false);
      setOnlineCode('');
      setLostCode(link.code);
      setOnlineError(closedReason(reason));
      setWatching(false);
      setOnlineOpen(true);
      setStatus('ready');
      setGatherAt(null);
      clearBots();
    });
    return link;
  }, [applyRaceScores, botsSetting, clearBots, gameOver, meta.online?.seats, migrates, onlineName, phoneFirst, race, restart, router, start]);
  connectRef.current = connectRoom;
  /** A spectator takes a seat: out of the room as a spectator and straight back in to play the next round. */
  const takeSeat = useCallback(() => {
    if (!onlineLink) return;
    const code = onlineLink.code;
    keys.clear();
    leaveRoom();
    setResult(null);
    setBoardOpen(false);
    setScoreState(null);
    setRound((r) => r + 1);
    setStatus('ready');
    setOnlineOpen(true);
    connectRoom(code);
  }, [connectRoom, keys, leaveRoom, onlineLink]);
  /** Someone waiting for the next round watches this one: back in as a spectator, with Play the Next Round after it. */
  const watchRound = useCallback(() => {
    if (!onlineLink) return;
    const code = onlineLink.code;
    leaveRoom();
    setOnlineOpen(true);
    connectRoom(code, false, true);
  }, [connectRoom, leaveRoom, onlineLink]);
  const setRoomWatchable = useCallback((on: boolean) => {
    setWatchSetting(on ? 'on' : 'off');
    onlineLink?.setWatchable(on);
  }, [onlineLink, setWatchSetting]);

  const makeRoom = useCallback(async (options?: { listed?: boolean; name?: string }) => {
    setOnlineBusy(true);
    setOnlineError('');
    try {
      const code = await createRoom(meta.id, { listed: options?.listed ?? visibility === 'public' });
      connectRoom(code, false, false, options?.name);
    } catch (error) {
      setOnlineError(error instanceof Error ? error.message : 'Could Not Create Room');
    } finally {
      setOnlineBusy(false);
    }
  }, [connectRoom, meta.id, visibility]);

  const connectPhone = useCallback(() => {
    const hostName = onlineName.trim() ? cleanName(onlineName) : 'Screen';
    if (!onlineName.trim()) {
      setOnlineName(hostName);
      saveName(hostName);
    }
    setVisibility('private');
    setQuick(false);
    quickRef.current = false;
    setOnlineError('');
    setOnlineOpen(true);
    void makeRoom({ listed: false, name: hostName });
  }, [makeRoom, onlineName, setVisibility]);

  useEffect(() => {
    if (!phoneFirstOn || status !== 'ready' || joinCode || autoPhoneConnect.current) return;
    if (touch || !!os?.mobile || isTouchDevice()) return;
    autoPhoneConnect.current = true;
    connectPhone();
  }, [connectPhone, joinCode, os?.mobile, phoneFirstOn, status, touch]);

  /** Quick play: into a match that is gathering people, or a new one for others to find. */
  const findMatch = useCallback(async () => {
    setOnlineOpen(true);
    setQuick(true);
    quickRef.current = true;
    setOnlineBusy(true);
    setOnlineError('');
    try {
      const code = await quickRoom(meta.id, ARCADE_API, quickPool);
      if (quickRef.current) connectRoom(code, true);
    } catch (error) {
      setOnlineError(error instanceof Error ? error.message : 'Could Not Find A Match');
    } finally {
      setOnlineBusy(false);
    }
  }, [connectRoom, meta.id, quickPool]);
  findMatchRef.current = () => void findMatch();
  /** The Start card's Play: straight to finding a match, or first a name to play under (kept for next time). */
  const play = useCallback((named = false) => {
    sfx.unlock();
    quickTries.current = 0;
    if (onlineName.trim()) {
      if (named) saveName(cleanName(onlineName));
      void findMatch();
    } else {
      setOnlineError('');
      setQuick(true);
      setOnlineOpen(true);
    }
  }, [findMatch, onlineName]);

  const joinRoom = useCallback((code: string) => {
    setOnlineBusy(true);
    setOnlineError('');
    try {
      const phoneName = phoneFirst && isTouchDevice() && !onlineName.trim() ? 'Phone 1' : undefined;
      connectRoom(code.toUpperCase(), false, false, phoneName);
    } catch (error) {
      setOnlineError(error instanceof Error ? error.message : 'Could Not Join Room');
    } finally {
      setOnlineBusy(false);
    }
  }, [connectRoom, onlineName, phoneFirst]);

  useEffect(() => {
    if (!joinCode || !meta.online || compact || consumedRoom.current === joinCode) return;
    consumedRoom.current = joinCode;
    setOnlineOpen(true);
    joinRoom(joinCode);
  }, [compact, joinRoom, meta.online, joinCode]);

  useEffect(() => () => onlineLink?.close(), [onlineLink]);
  // Runs after the round's freshly mounted game has subscribed (a parent's effects follow its children's), so the
  // messages that arrived before it are handed over now.
  useEffect(() => router.release(), [router, onlineRound, round]);
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
      // How to Play is up: Escape closes it, and nothing starts or resumes behind it
      if (howRef.current) {
        if (onButton && (e.code === 'Enter' || e.code === 'Space')) return void e.stopPropagation();
        e.preventDefault();
        e.stopPropagation();
        if (e.code === 'Escape' && !e.repeat) setHowOpen(false);
        return;
      }
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
        // Online, a key still held or mashed from the round never starts the next one for everybody.
        if (st === 'over' && onlineMode && performance.now() - overAt.current < KEY_LOCKOUT_MS) return;
        // with quick play, Play finds a match (and nothing starts while its card is up)
        if (st === 'ready' && quickOn && (onlineOpen || quickRef.current)) return;
        if ((e.code === 'Enter' || e.code === 'Space') && !e.repeat) (st === 'ready' ? (quickOn ? () => play() : start) : st === 'over' ? playAgain : setupChanges.current.size ? restart : resume)();
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
  }, [keys, onlineMode, onlineOpen, pause, play, playAgain, quickOn, restart, resume, start]);

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
  const phoneGuest = phoneFirst && touch && onlineSeat !== null && onlineSeat > 0 && !watching;
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
  // Anyone can join between rounds, so the host can still open the room up (or close it) on the Game Over card.
  const hostListed = gameOnline && onlineSeat === 0 && onlineListed !== null ? <VisibilityPicker value={onlineListed ? 'public' : 'private'} onChange={(v) => setListed(v === 'public')} /> : null;
  const hostWatch = gameOnline && onlineSeat === 0 && watchable !== null && !quick ? <WatchPicker value={watchable} onChange={setRoomWatchable} /> : null;
  // The race is between the people who started it and are still here; anyone who joined since waits for the next.
  // Once everyone has finished the result is settled, and someone leaving the card no longer changes it.
  const presentRacers = onlinePlayers.filter((p) => !roundSeats.length || roundSeats.includes(p.seat)).map((p) => p.seat);
  const racers = raceSeats(presentRacers, raceSettled, onlineRound);
  // A race that started with others settles for whoever is left once they have all finished.
  const raceNow = race && gameOnline ? raceStandings(raceScores, racers, lowerIsBetter, roundSeats.length >= 2 ? 1 : 2) : null;
  const raceAlone = racers.length < 2;
  const racerName = (seat: number) => (raceSettled?.round === onlineRound ? raceSettled.names[seat] : undefined) ?? onlinePlayers.find((p) => p.seat === seat)?.name;
  const raceDone = !!raceNow?.done;
  const raceWinner = raceNow?.winner ?? null;
  const roomReady = onlinePlayers.length + (lobbyBots?.length ?? 0) >= 2;
  const stillRacing = !!raceNow && !raceDone && racers.length >= 2;
  // a player out early: the round goes on for the others until the game says it's over
  const waiting = gameOnline && status === 'over' && !!result?.wait;
  nextRound.current = { ready: roomReady, waiting, racing: stillRacing };
  const hostPlayAgain = () => {
    if (stillRacing && !startArmed) setStartArmed(true);
    else {
      setStartArmed(false);
      playAgain(true);
    }
  };
  const playAgainLabel = !roomReady ? 'Waiting For Players' : stillRacing ? (startArmed ? 'Tap Again to Start' : 'Start Now') : 'Play Again';

  // The host tells the room when its round is over (a race once everyone has finished), so people can join for the next.
  const endedRound = useRef(0);
  useEffect(() => {
    if (!gameOnline || onlineSeat !== 0 || status !== 'over' || stillRacing || waiting || !onlineLink || endedRound.current === onlineRound) return;
    endedRound.current = onlineRound;
    onlineLink.endRound(onlineRound);
  }, [gameOnline, onlineSeat, status, stillRacing, waiting, onlineLink, onlineRound]);
  const boardFmt = result?.rank !== undefined && roundBoard ? (n: number) => formatBoardScore(n, roundBoard.spec) : fmt;

  const racersKey = racers.join(',');
  useEffect(() => {
    if (!raceNow?.done || raceSettled?.round === onlineRound) return;
    const seats = racersKey.split(',').map(Number);
    setRaceSettled({ round: onlineRound, seats, names: Object.fromEntries(onlinePlayers.filter((p) => seats.includes(p.seat)).map((p) => [p.seat, p.name])) });
  }, [raceNow?.done, raceSettled, onlineRound, racersKey, onlinePlayers]);

  // Every player reports the race winner once all scores are in; the Worker records it when they agree.
  useEffect(() => {
    if (!raceDone || raceAlone || !onlineLink || raceReported.current === onlineRound) return;
    raceReported.current = onlineRound;
    onlineLink.reportResult(onlineRound, raceWinner);
  }, [raceDone, raceAlone, raceWinner, onlineLink, onlineRound]);
  const shareRoom = () => os?.open('lounge', { invite: { game: meta.id, code: onlineCode } });
  const backToArcade = useCallback(() => {
    if (onlineLink) leaveRoom();
    onExit?.();
  }, [leaveRoom, onExit, onlineLink]);
  const api = useMemo<ShellApi>(
    () => ({
      meta, status, round, active, compact, touch, keys, root, start, pause, resume, restart,
      ...(phoneFirstOn ? { playAgain: () => playAgain(), backToArcade } : {}),
      gameOver, updateOver, setScore, invalidate, onInvalidate,
    }),
    [meta, status, round, active, compact, touch, keys, start, pause, resume, restart, playAgain, backToArcade, phoneFirstOn, gameOver, updateOver, setScore, invalidate, onInvalidate],
  );

  return (
    <OnlineProvider
      link={onlineLink}
      router={router}
      seat={onlineSeat}
      seats={onlineSeats}
      round={onlineRound}
      started={phoneFirstOn ? onlineInProgress : false}
      players={onlinePlayers}
      bots={gameBots}
      transport={onlineTransport}
      reconnecting={onlineReconnecting}
      handoffs={onlineHandoffs}
      handedOff={handedOff}
      quick={quick}
      pool={pool}
      watching={watching}
      watchers={watchers}
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
        {gameOnline && status === 'playing' && <div className="arcade-online-status">{watching ? `Watching${watchers.length > 1 ? ` · ${watchers.length} Watching` : ''}` : onlineTransport === 'direct' ? 'Direct' : 'Relayed'}</div>}

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
            {meta.music && (
              <button type="button" aria-label={musicOn ? 'Music off' : 'Music on'} aria-pressed={musicOn} title={musicOn ? 'Music off' : 'Music on'} onClick={ctl(() => setMusicOn(!musicOn))}>
                <Icon d={musicOn ? ic.music : ic.musicOff} />
              </button>
            )}
            {/* The Lounge opens next to the game (over it on a phone), so you can chat while you play. */}
            {os && (
              <button type="button" className={loungeUnread ? 'has-dot' : undefined} aria-label={loungeUnread ? `Lounge, ${loungeUnread} unread` : 'Lounge'} title="Lounge" onClick={() => os.open('lounge')}>
                <Icon d={ic.chat} />
              </button>
            )}
            {onExit && (
              <button type="button" aria-label="Arcade" title="Arcade" onClick={backToArcade}>
                <Icon d={ic.grid} />
              </button>
            )}
          </div>
        )}

        {status === 'ready' && onlineOpen && canPlayOnline && quick && (
          <QuickPanel
            code={onlineCode}
            linked={!!onlineLink}
            players={onlinePlayers}
            seat={onlineSeat}
            seats={onlineSeats}
            startAt={gatherAt}
            busy={onlineBusy}
            error={onlineError}
            name={onlineName}
            onName={setOnlineName}
            onFind={() => play(true)}
            onLeave={leaveRoom}
            note={quickNote}
            setup={hostSetup}
          />
        )}

        {status === 'ready' && onlineOpen && canPlayOnline && !quick && (
          phoneFirstOn ? (
            <div className="arcade-ov arcade-phone-first-overlay">
              <div className={`arcade-card arcade-phone-first-card${phoneFirst && touch && !!joinCode && onlineSeat !== 0 ? ' is-phone-join' : ''}`}>
                {phoneFirst && touch && !!joinCode && onlineSeat !== 0 ? (
                  onlineError ? (
                    <>
                      <p className="arcade-phone-first-error" role="alert">Couldn't reach the Mac</p>
                      <button type="button" className="arcade-btn arcade-btn-primary arcade-btn-lg" disabled={onlineBusy} onClick={() => joinRoom(lostCode || joinCode)}>
                        {onlineBusy ? 'Connecting to your Mac…' : 'Try again'}
                      </button>
                    </>
                  ) : (
                    <div className="g-soccer-phone-connecting" role="status">
                      <span className="g-soccer-phone-spinner" aria-hidden="true" />
                      <p>Connecting to your Mac…</p>
                    </div>
                  )
                ) : (
                  <>
                    {onlineError && (
                      <p className="arcade-phone-first-error" role="alert">
                        {onlineError}
                      </p>
                    )}
                    {onlineSeat === 0 ? hostSetup : onlineBusy ? <p role="status">Getting your room ready…</p> : hostSetup}
                    {onlineError && !touch && <button type="button" className="arcade-btn arcade-btn-primary arcade-btn-lg" onClick={connectPhone}>Try again</button>}
                  </>
                )}
                <button type="button" className="arcade-phone-first-cancel" onClick={leaveRoom}>Cancel</button>
              </div>
            </div>
          ) : (
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
              onShare={os && onlineCode ? shareRoom : undefined}
              lastCode={lostCode}
              watching={watching}
              watchers={watchers}
              watchable={watchable}
              onWatchable={setRoomWatchable}
              onTakeSeat={takeSeat}
              onWatchRound={watchRound}
              note={race ? 'A score race: everyone plays their own round at the same time and the best score wins.' : undefined}
              setup={hostSetup}
              setupFirst={phoneFirstOn}
            />
          )
        )}

        {(status === 'ready' || status === 'paused') && !onlineOpen && !compact && howOpen && meta.howTo && <HowToCard meta={meta} onClose={() => setHowOpen(false)} />}

        {status === 'ready' && !phoneGuest && !onlineOpen && !howOpen &&
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
                {phoneFirstOn && <p>Your iPhone is the controller.</p>}
                {!phoneFirstOn && <p>{meta.controls}</p>}
                {setup && !quickOn && !phoneFirstOn && <div className="arcade-setup">{setup}</div>}
                {quickOn && quickSetup && <div className="arcade-setup">{quickSetup}</div>}
                <button type="button" className="arcade-btn arcade-btn-primary arcade-btn-lg" onClick={phoneFirstOn ? connectPhone : quickOn ? () => play() : start} ref={autoFocus}>
                  {phoneFirstOn ? 'Connect Phone' : 'Play'}
                </button>
                {/* with quick play, the game's settings are for playing on this device, so they go with that button */}
                {quickOn && (
                  <>
                    <div className="arcade-online-divider"><span>Or Alone</span></div>
                    {setup && <div className="arcade-setup">{setup}</div>}
                    <button type="button" className="arcade-btn arcade-btn-lg" onClick={start}>
                      {soloLabel}
                    </button>
                  </>
                )}
                {canPlayOnline && !phoneFirstOn && (
                  <button type="button" className={quickOn ? 'arcade-btn' : 'arcade-btn arcade-btn-lg'} onClick={() => { setOnlineError(''); setOnlineOpen(true); }}>
                    {quickOn ? 'Play with Friends' : 'Play Online'}
                  </button>
                )}
                {meta.howTo && !phoneFirstOn && (
                  <button type="button" className="arcade-btn" onClick={() => setHowOpen(true)}>
                    How to Play
                  </button>
                )}
                {best !== null && !phoneFirstOn && <small>Best {fmt(best)}</small>}
              </div>
            </div>
          ))}

        {status === 'paused' && !howOpen &&
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
                {meta.howTo && (
                  <button type="button" className="arcade-btn" onClick={() => setHowOpen(true)}>
                    How to Play
                  </button>
                )}
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
                {gameOnline && quick ? (
                  <button type="button" className="arcade-btn arcade-btn-primary" disabled={waiting} onClick={() => playAgain()}>
                    Play Again
                  </button>
                ) : gameOnline && onlineSeat !== 0 ? (
                  <button type="button" className="arcade-btn" onClick={leaveRoom}>
                    Leave
                  </button>
                ) : gameOnline ? (
                  <button type="button" className="arcade-btn arcade-btn-primary" disabled={!roomReady || waiting} onClick={hostPlayAgain}>
                    {playAgainLabel}
                  </button>
                ) : (
                  <button type="button" className="arcade-btn arcade-btn-primary" onClick={() => playAgain()} ref={autoFocus}>
                    Play Again
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {status === 'over' &&
          !(phoneFirstOn && hidePhoneFirstResultCard) &&
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
                {result?.detail && <p className="arcade-detail">{result.detail}</p>}
                {raceNow && (
                  <ol className="arcade-race" aria-label="Race Standings">
                    {raceNow.standings.map((entry) => (
                      <li key={entry.seat} className={entry.seat === onlineSeat ? 'is-mine' : undefined}>
                        <span className="arcade-race-place">{entry.place ?? '-'}</span>
                        <span className="arcade-race-name">{racerName(entry.seat) ?? `Player ${entry.seat + 1}`}</span>
                        <span className="arcade-race-score">
                          {Object.hasOwn(raceScores, entry.seat) ? (entry.score === null ? 'No Score' : fmt(entry.score)) : 'Playing'}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
                {raceNow && (
                  <small>
                    {raceVerdict(raceNow, raceAlone, onlineSeat, racerName)}
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
                {/* who is still here for the next round, as people come and go */}
                {gameOnline && (
                  <RoomRoster players={onlinePlayers} bots={quick ? [] : lobbyBots ?? []} watchers={watchers} seat={onlineSeat} seats={quick ? 0 : onlineSeats} label={quick ? 'Still Here' : 'In the Room'} />
                )}
                {gameOnline && !quick && !watching && (hostListed || hostWatch || hostBots || hostSetup) && (
                  <div className="arcade-setup">
                    {hostListed}
                    {hostWatch}
                    {hostBots}
                    {hostSetup}
                  </div>
                )}
                {/* Online, nothing is focused: a key or tap carried over from the round must not start or leave anything. */}
                {gameOnline && !quick && <RoomCode game={meta.id} code={onlineCode} onShare={os ? shareRoom : undefined} onLeave={leaveRoom} />}
                {/* Quick play: Play Again finds the next match (a host first sees this one out for everyone it runs it for). */}
                {gameOnline && quick ? (
                  <>
                    <button type="button" className="arcade-btn arcade-btn-primary arcade-btn-lg" disabled={waiting} onClick={() => playAgain()}>
                      {watching ? 'Play' : 'Play Again'}
                    </button>
                    {waiting && <small>{result?.wait}</small>}
                    <div className="arcade-row">
                      <button type="button" className="arcade-btn" disabled={waiting} onClick={() => { toStart(); start(); }}>
                        {soloLabel}
                      </button>
                      <button type="button" className="arcade-btn" onClick={toStart}>
                        Leave
                      </button>
                    </div>
                  </>
                ) : gameOnline ? onlineSeat === 0 ? (
                  <>
                    <button type="button" className="arcade-btn arcade-btn-primary arcade-btn-lg" disabled={!roomReady || waiting} onClick={hostPlayAgain}>
                      {playAgainLabel}
                    </button>
                    {waiting && <small>{result?.wait}</small>}
                    {!roomReady && !waiting && <small>{onlineListed ? 'Anyone Can Join From Open Rooms.' : 'Share the Code to Play Again.'}</small>}
                    {roomReady && stillRacing && !waiting && <small>Starting Now Ends the Round for Anyone Still Playing.</small>}
                  </>
                ) : watching ? (
                  <>
                    <p>{roomStarted ? 'The Next Round Is Starting.' : 'You Are Watching. The Next Round Shows Here When the Host Starts It.'}</p>
                    {!roomStarted && onlinePlayers.length < onlineSeats && (
                      <button type="button" className="arcade-btn arcade-btn-primary arcade-btn-lg" onClick={takeSeat}>
                        Play the Next Round
                      </button>
                    )}
                  </>
                ) : (
                  <p>{onlinePlayers.length < 2 ? 'Waiting For Players' : 'Waiting For The Host'}</p>
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

/** The game's rules (meta.howTo) and its controls line, over the Start or Pause card. */
function HowToCard({ meta, onClose }: { meta: GameMeta; onClose: () => void }) {
  return (
    <div className="arcade-ov">
      <div className="arcade-card arcade-howto" role="dialog" aria-label={`How to play ${meta.title}`}>
        <h2>How to Play</h2>
        <ol>
          {meta.howTo?.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
        <p className="arcade-howto-controls">
          <b>Controls</b> {meta.controls}
        </p>
        <button type="button" className="arcade-btn arcade-btn-primary arcade-btn-lg" onClick={onClose} ref={autoFocus}>
          Got It
        </button>
      </div>
    </div>
  );
}

/** The surrounding <GameShell>'s state and controls. Throws if used outside one. */
export function useShell(): ShellApi {
  const s = useContext(ShellContext);
  if (!s) throw new Error('useShell must be used inside <GameShell>');
  return s;
}
