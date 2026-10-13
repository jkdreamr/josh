import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { BLACK, engineView, groupStones, newGame, pass, play, resign, score, undo, WHITE, type GameState, type Ownership, type Point } from '../games/go';
import { GO_LEVELS, GO_SIZES, goLevel, isGoLevel, isGoSize, type GoLevelId, type GoSize } from '../games/go-levels';
import { newOmok, omokAiMove, playOmok, undoOmok, type OmokState } from '../games/omok';
import { useOS, type AppProps } from '../types';
import { countPlay } from '../stats';
import { reloadInto } from '../reload';
import { getAppGame, goBoardOwner } from '../arcade/apps';
import { boardFor } from '../arcade/kit/leaderboard';
import { AppBoard, onlineAvailable, RoomPanel, useAppRoom, useInvite } from './online-room';
import './game-controls.css';
import './Baduk.css';

type Mode = 'computer' | 'friend' | 'online';
type Color = typeof BLACK | typeof WHITE;
/** `setup` goes from the host at the start of every Go round: the guest plays on the host's board size. */
type RoomMessage = { t: 'move'; x: number; y: number } | { t: 'pass' } | { t: 'resign' } | { t: 'dead'; list: number[] } | { t: 'count'; list: number[] } | { t: 'setup'; size: GoSize; round: number };

const OMOK_GAME = getAppGame('omok')!;
/** Online: the host plays Black in odd rounds and White in even rounds, so colors swap on every rematch. */
const onlineColorOf = (seat: number, round: number): Color => ((round % 2 === 1) === (seat === 0) ? BLACK : WHITE);
const seatOfColor = (color: Color, round: number) => (onlineColorOf(0, round) === color ? 0 : 1);

function parseRoomMessage(value: unknown, size: number): RoomMessage | null {
  if (!value || typeof value !== 'object') return null;
  const m = value as Record<string, unknown>;
  const onBoard = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) < size;
  const list = (v: unknown) => Array.isArray(v) && v.length <= size * size && v.every((i) => Number.isInteger(i) && i >= 0 && i < size * size) ? (v as number[]) : null;
  if (m.t === 'move') return onBoard(m.x) && onBoard(m.y) ? { t: 'move', x: m.x as number, y: m.y as number } : null;
  if (m.t === 'pass' || m.t === 'resign') return { t: m.t };
  if (m.t === 'setup') return isGoSize(m.size) && Number.isInteger(m.round) ? { t: 'setup', size: m.size, round: m.round as number } : null;
  if (m.t === 'dead' || m.t === 'count') {
    const indices = list(m.list);
    return indices ? { t: m.t, list: indices } : null;
  }
  return null;
}
type GameMode = 'go' | 'omok';
type WorkerResponse =
  | { id: number; type: 'ai'; move: Point | null }
  | { id: number; type: 'ownership'; values: Ownership[] }
  | { type: 'engine'; status: 'loading' | 'ready' | 'failed'; backend?: string };

const SIZE = 420;
/** Board coordinates skip I, as on a real board. */
const LETTERS = 'ABCDEFGHJKLMNOPQRST';
const boardStart = (size: number) => size === 9 ? 44 : size === 13 ? 38 : 34;
const boardSpacing = (size: number) => size === 15 ? 25 : (SIZE - 2 * boardStart(size)) / (size - 1);
const pointPosition = (index: number, size: number) => boardStart(size) + index * boardSpacing(size);
/** 9×9 and Omok keep their roomier stones; 13×13 and 19×19 stones nearly touch, like a real board. */
const stoneRadius = (size: number) => size === 9 ? 15.2 : size === 15 ? 10.2 : boardSpacing(size) * 0.45;

function starPoints(size: number): [number, number][] {
  if (size === 19) return [3, 9, 15].flatMap((x) => [3, 9, 15].map((y): [number, number] => [x, y]));
  const near = size >= 13 ? 3 : 2;
  const far = size - 1 - near;
  const middle = (size - 1) / 2;
  return [[near, near], [far, near], [near, far], [far, far], [middle, middle]];
}

function stored(key: string): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode: the choice lasts for this visit */
  }
}

function pointFromPointer(event: ReactPointerEvent<SVGSVGElement>, size: number): Point | null {
  const rect = event.currentTarget.getBoundingClientRect();
  const scale = Math.min(rect.width, rect.height) / SIZE;
  const offsetX = (rect.width - SIZE * scale) / 2;
  const offsetY = (rect.height - SIZE * scale) / 2;
  const x = (event.clientX - rect.left - offsetX) / scale;
  const y = (event.clientY - rect.top - offsetY) / scale;
  const spacing = boardSpacing(size);
  const pointX = Math.round((x - boardStart(size)) / spacing);
  const pointY = Math.round((y - boardStart(size)) / spacing);
  if (pointX < 0 || pointY < 0 || pointX >= size || pointY >= size) return null;
  if (Math.abs(x - pointPosition(pointX, size)) > spacing * 0.48 || Math.abs(y - pointPosition(pointY, size)) > spacing * 0.48) return null;
  return { x: pointX, y: pointY };
}

export default function Baduk({ args }: AppProps) {
  const os = useOS();
  const [goSize, setGoSize] = useState<GoSize>(() => {
    const size = Number(stored('baduk-go-size'));
    return isGoSize(size) ? size : 9;
  });
  const [goLevelId, setGoLevelId] = useState<GoLevelId>(() => {
    const level = stored('baduk-go-level');
    return isGoLevel(level) ? level : 'strong';
  });
  const [game, setGame] = useState<GameState>(() => newGame(goSize));
  const [omok, setOmok] = useState<OmokState>(() => newOmok());
  const [gameMode, setGameMode] = useState<GameMode>(() => args.game ?? (typeof window !== 'undefined' && window.localStorage.getItem('baduk-game') === 'omok' ? 'omok' : 'go'));
  const [mode, setMode] = useState<Mode>(() => (args.room ? 'online' : 'computer'));
  const [difficulty, setDifficulty] = useState<'easy' | 'normal'>('normal');
  const [hovered, setHovered] = useState<Point | null>(null);
  const [deadSet, setDeadSet] = useState<Set<number>>(() => new Set());
  const [counted, setCounted] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisReady, setAnalysisReady] = useState(false);
  const [engineStatus, setEngineStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [workerGone, setWorkerGone] = useState(false);
  const [tainted, setTainted] = useState(false);
  const [gameNo, setGameNo] = useState(0);
  /** Touch on 13×13 and 19×19: the first tap previews a stone, a second tap on the same point plays it. */
  const [pending, setPending] = useState<Point | null>(null);
  /** Online guest: the round whose board size the host has sent. Moves wait until it matches. */
  const [setupRound, setSetupRound] = useState(0);
  const goSizeRef = useRef(goSize);
  goSizeRef.current = goSize;
  const hostSizeRef = useRef<GoSize>(9);
  const omokRef = useRef(omok);
  omokRef.current = omok;
  const deadRef = useRef(deadSet);
  deadRef.current = deadSet;
  const room = useAppRoom(gameMode === 'omok' ? 'omok' : 'go', {
    onStart: (round, seat) => {
      startNewGame();
      if (seat === 0 && gameModeRef.current === 'go') room.send({ t: 'setup', size: goSizeRef.current, round });
    },
    onEnd: () => startNewGame(goSizeRef.current),
  });
  const guestRef = useRef(false);
  guestRef.current = room.linked && !room.isHost;
  const onlineColor: Color | null = mode === 'online' && room.status === 'playing' && room.seat !== null ? onlineColorOf(room.seat, room.round) : null;
  const onlineRef = useRef({ color: onlineColor, round: room.round, seat: room.seat });
  onlineRef.current = { color: onlineColor, round: room.round, seat: room.seat };
  const gameRef = useRef(game);
  const modeRef = useRef(mode);
  const gameModeRef = useRef(gameMode);
  const workerRef = useRef<Worker | null>(null);
  const jobRef = useRef(0);
  gameRef.current = game;
  modeRef.current = mode;
  gameModeRef.current = gameMode;

  useEffect(() => countPlay('baduk'), [args.nonce]);
  useEffect(() => setPending(null), [game]);

  useEffect(() => {
    if (!args.game) return;
    jobRef.current += 1;
    setThinking(false);
    setGameMode(args.game);
    window.localStorage.setItem('baduk-game', args.game);
  }, [args.game, args.nonce]);

  useEffect(() => {
    const worker = new Worker(new URL('../games/go.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      if (response.type === 'engine') {
        setEngineStatus(response.status);
        return;
      }
      if (response.id !== jobRef.current) return;
      if (response.type === 'ai') {
        setThinking(false);
        setGame((current) => {
          if (gameModeRef.current !== 'go' || modeRef.current !== 'computer' || current.phase !== 'play' || current.toPlay !== WHITE) return current;
          if (!response.move) return pass(current);
          const result = play(current, response.move.x, response.move.y);
          return result.ok ? result.state : current;
        });
        return;
      }
      const current = gameRef.current;
      setAnalyzing(false);
      if (current.phase !== 'mark') return;
      const dead = new Set<number>();
      response.values.forEach((point, index) => {
        const stone = current.board[index];
        if ((stone === BLACK && point.white > 0.7) || (stone === WHITE && point.black > 0.7)) dead.add(index);
      });
      setDeadSet(dead);
      setAnalysisReady(true);
    };
    // A worker file that is gone (this page is older than the files the site keeps) fires a plain error event; a
    // crash inside it is an ErrorEvent. Without it the computer never moves, so offer a reload.
    worker.onerror = (event) => {
      if (!(event instanceof ErrorEvent)) setWorkerGone(true);
    };
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (gameMode !== 'go' || mode !== 'computer') return;
    const worker = workerRef.current;
    if (!worker) return;
    setEngineStatus('loading');
    worker.postMessage({ type: 'load' });
  }, [gameMode, mode]);

  useEffect(() => {
    if (gameMode !== 'go' || mode !== 'computer' || game.phase !== 'play' || game.toPlay !== WHITE) return;
    const worker = workerRef.current;
    if (!worker) return;
    const id = ++jobRef.current;
    setThinking(true);
    worker.postMessage({ id, type: 'ai', state: engineView(game), level: goLevelId });
    return () => {
      if (jobRef.current === id) jobRef.current += 1;
    };
  }, [gameMode, mode, game, goLevelId]);

  useInvite(room, args.room, args.nonce, () => setMode('online'));

  // A guest plays whatever the host's room was made for.
  useEffect(() => {
    if (room.roomGame !== 'go' && room.roomGame !== 'omok') return;
    if (room.roomGame === gameModeRef.current) return;
    jobRef.current += 1;
    setGameMode(room.roomGame);
    gameModeRef.current = room.roomGame;
  }, [room.roomGame]);

  useEffect(() => {
    if (gameMode !== 'go' || game.phase !== 'mark' || analysisReady) return;
    if (mode === 'online' && !room.isHost) return;
    const worker = workerRef.current;
    if (!worker) return;
    const id = ++jobRef.current;
    setAnalyzing(true);
    worker.postMessage({ id, type: 'ownership', state: engineView(game), playouts: 400 });
    return () => {
      if (jobRef.current === id) jobRef.current += 1;
    };
  }, [gameMode, game, analysisReady, mode, room.isHost]);

  // Online: the host reads the board for dead stones and shares them, so both sides count the same.
  useEffect(() => {
    if (mode === 'online' && room.isHost && analysisReady && game.phase === 'mark') room.send({ t: 'dead', list: [...deadRef.current] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisReady]);

  // The opponent's moves. Each one is checked against whose turn it is and the rules before it lands.
  useEffect(() => room.onMessage((from, data) => {
    const online = onlineRef.current;
    if (online.color === null || from === online.seat) return;
    const omokMode = gameModeRef.current === 'omok';
    const message = parseRoomMessage(data, omokMode ? 15 : gameRef.current.size);
    if (!message) return;
    if (message.t === 'setup') {
      if (omokMode || from !== 0 || online.seat === 0) return;
      hostSizeRef.current = message.size;
      setSetupRound(message.round);
      // Usually the round's empty board is already up; it may be the wrong size if this arrived after the start.
      if (!gameRef.current.past.length && gameRef.current.size !== message.size) setGame(newGame(message.size));
      return;
    }
    const theirs: Color = online.color === BLACK ? WHITE : BLACK;
    if (omokMode) {
      const current = omokRef.current;
      if (message.t === 'move' && current.toPlay === theirs) {
        const result = playOmok(current, message.x, message.y);
        if (result.ok) setOmok(result.state);
      } else if (message.t === 'resign' && current.winner === null) setOmok({ ...current, winner: online.color });
      return;
    }
    const current = gameRef.current;
    if (message.t === 'move' && current.phase === 'play' && current.toPlay === theirs) {
      const result = play(current, message.x, message.y);
      if (result.ok) {
        setGame(result.state);
        setCounted(false);
      }
    } else if (message.t === 'pass' && current.phase === 'play' && current.toPlay === theirs) {
      setGame(pass(current));
      setCounted(false);
    } else if (message.t === 'resign' && current.phase === 'play') {
      setGame({ ...current, phase: 'resigned', winner: online.color });
    } else if ((message.t === 'dead' || message.t === 'count') && current.phase === 'mark') {
      setDeadSet(new Set(message.list));
      setAnalysisReady(true);
      setAnalyzing(false);
      setCounted(message.t === 'count');
    }
  }), [room.code, room.onMessage]);

  useEffect(() => {
    if (gameMode !== 'omok' || mode !== 'computer' || omok.toPlay !== WHITE || omok.winner !== null) return;
    setThinking(true);
    const timer = window.setTimeout(() => {
      setOmok((current) => {
        if (current.winner !== null || current.toPlay !== WHITE) return current;
        const move = omokAiMove(current, difficulty);
        if (!move) return current;
        const result = playOmok(current, move.x, move.y);
        return result.ok ? result.state : current;
      });
      setThinking(false);
    }, 80);
    return () => {
      window.clearTimeout(timer);
      setThinking(false);
    };
  }, [gameMode, mode, omok, difficulty]);

  const startNewGame = (size: GoSize = guestRef.current ? hostSizeRef.current : goSizeRef.current) => {
    countPlay('baduk');
    jobRef.current += 1;
    setTainted(false);
    setGameNo((n) => n + 1);
    setPending(null);
    setGame(newGame(size));
    setOmok(newOmok());
    setDeadSet(new Set());
    setCounted(false);
    setThinking(false);
    setAnalyzing(false);
    setAnalysisReady(false);
  };

  const online = mode === 'online';
  const sizeReady = gameMode === 'omok' || !online || room.isHost || setupRound === room.round;
  const myTurn = (toPlay: Color) => !online || (toPlay === onlineColor && sizeReady);

  const placeStone = (point: Point) => {
    if (online && onlineColor === null) return;
    if (gameMode === 'omok') {
      if (thinking || omok.winner !== null || !myTurn(omok.toPlay)) return;
      const result = playOmok(omok, point.x, point.y);
      if (result.ok) {
        setOmok(result.state);
        if (online) room.send({ t: 'move', x: point.x, y: point.y });
      }
      return;
    }
    if (game.phase === 'mark') {
      const group = groupStones(game, point.x, point.y);
      if (!group.length) return;
      const next = new Set(deadSet);
      const shouldAdd = group.some((index) => !next.has(index));
      group.forEach((index) => shouldAdd ? next.add(index) : next.delete(index));
      setDeadSet(next);
      setCounted(false);
      if (mode === 'computer') setTainted(true);
      if (online) room.send({ t: 'dead', list: [...next] });
      return;
    }
    if (thinking || game.phase !== 'play' || !myTurn(game.toPlay)) return;
    const result = play(game, point.x, point.y);
    if (result.ok) {
      setGame(result.state);
      setCounted(false);
      if (online) room.send({ t: 'move', x: point.x, y: point.y });
    }
  };

  const onBoardPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.pointerType !== 'mouse' || !window.matchMedia('(pointer: fine)').matches) {
      setHovered(null);
      return;
    }
    setHovered(pointFromPointer(event, boardSize));
  };

  const undoTurn = () => {
    if (online) return;
    jobRef.current += 1;
    setTainted(true);
    setThinking(false);
    if (gameMode === 'omok') {
      setOmok((current) => {
        let previous = undoOmok(current);
        if (!previous) return current;
        if (modeRef.current === 'computer' && current.toPlay === BLACK && previous.toPlay === WHITE) {
          previous = undoOmok(previous) ?? previous;
        }
        return previous;
      });
      setDeadSet(new Set());
      setCounted(false);
      setAnalysisReady(false);
      return;
    }
    setGame((current) => {
      let previous = undo(current);
      if (!previous) return current;
      if (modeRef.current === 'computer' && current.toPlay === BLACK && previous.toPlay === WHITE) {
        previous = undo(previous) ?? previous;
      }
      return previous;
    });
    setDeadSet(new Set());
    setCounted(false);
    setAnalysisReady(false);
  };

  const passTurn = () => {
    if (gameMode !== 'go') return;
    if (thinking || game.phase !== 'play' || !myTurn(game.toPlay)) return;
    setGame(pass(game));
    setCounted(false);
    if (online) room.send({ t: 'pass' });
  };

  const resignGame = () => {
    if (online) {
      if (onlineColor === null) return;
      const winner: Color = onlineColor === BLACK ? WHITE : BLACK;
      if (gameMode === 'omok') {
        if (omok.winner !== null) return;
        setOmok({ ...omok, winner });
      } else {
        if (game.phase !== 'play') return;
        setGame({ ...game, phase: 'resigned', winner });
      }
      room.send({ t: 'resign' });
      return;
    }
    setGame(resign(game));
  };

  const countBoard = () => {
    setCounted(true);
    if (online) room.send({ t: 'count', list: [...deadSet] });
  };

  const switchGame = (next: GameMode) => {
    if (room.linked) room.leave();
    setGameMode(next);
    window.localStorage.setItem('baduk-game', next);
    startNewGame(goSizeRef.current);
  };

  const switchMode = (next: Mode) => {
    if (next !== 'online' && room.linked) room.leave();
    setMode(next);
    startNewGame(goSizeRef.current);
  };

  // Online, the host picks the size in the lobby and the guest follows; a round in play keeps its board.
  const sizeLocked = online && (room.status === 'playing' || (room.linked && !room.isHost));
  const switchSize = (next: GoSize) => {
    if (sizeLocked || next === game.size) return;
    setGoSize(next);
    goSizeRef.current = next;
    store('baduk-go-size', String(next));
    startNewGame(next);
  };

  const onBoardPointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    const point = pointFromPointer(event, boardSize);
    if (!point) return;
    const confirm = event.pointerType !== 'mouse' && gameMode === 'go' && game.phase === 'play' && boardSize >= 13;
    if (confirm && (pending?.x !== point.x || pending?.y !== point.y)) {
      setPending(board[point.y * boardSize + point.x] === 0 && myTurn(game.toPlay) && !thinking ? point : null);
      return;
    }
    setPending(null);
    placeStone(point);
  };

  const boardSize = gameMode === 'omok' ? 15 : game.size;
  const start = boardStart(boardSize);
  const end = pointPosition(boardSize - 1, boardSize);
  const board = gameMode === 'omok' ? omok.board : game.board;
  const toPlay = gameMode === 'omok' ? omok.toPlay : game.toPlay;
  const statusStone = gameMode === 'omok'
    ? omok.winner === 0 ? null : omok.winner === null ? omok.toPlay : omok.winner
    : toPlay;
  const lastMove = gameMode === 'omok' ? omok.lastMove : game.lastMove;
  const letters = Array.from({ length: boardSize }, (_, index) => LETTERS[index] ?? '');
  const radius = stoneRadius(boardSize);
  const shownScore = gameMode === 'go' && counted ? score(game, deadSet) : null;
  const preview = gameMode === 'go' && pending ? pending : hovered;
  const previewIndex = preview ? preview.y * boardSize + preview.x : -1;
  const canHover = (!online || (onlineColor !== null && toPlay === onlineColor && sizeReady)) && (gameMode === 'omok'
    ? omok.winner === null && !thinking && preview && board[previewIndex] === 0
    : game.phase === 'play' && !thinking && preview && board[previewIndex] === 0);
  const colorName = (color: Color) => {
    if (onlineColor === null) return color === BLACK ? 'Black' : 'White';
    return color === onlineColor ? 'You' : room.opponent?.name ?? (color === BLACK ? 'Black' : 'White');
  };
  const omokStatus = omok.winner === 1 || omok.winner === -1 ? `${colorName(omok.winner)} ${onlineColor === omok.winner ? 'win' : 'wins'}` : omok.winner === 0 ? 'Draw' : onlineColor !== null ? (omok.toPlay === onlineColor ? 'Your move' : `${colorName(omok.toPlay)} to play`) : omok.toPlay === BLACK ? 'Black to play' : 'White to play';

  // Online results: both sides report the winner's seat once the game ends; the Worker records it when they agree.
  const onlineWinner: Color | 0 | null | undefined = onlineColor === null
    ? undefined
    : gameMode === 'omok'
      ? omok.winner === null ? undefined : omok.winner
      : game.phase === 'resigned' && game.winner ? game.winner : shownScore ? shownScore.winner : undefined;
  const reported = useRef('');
  useEffect(() => {
    if (onlineWinner === undefined) return;
    const key = `${room.code}:${room.round}:${onlineWinner}`;
    if (reported.current === key) return;
    reported.current = key;
    room.reportResult(onlineWinner === 0 ? null : seatOfColor(onlineWinner, room.round));
  }, [onlineWinner, room.code, room.round, room.reportResult]);

  // Leaderboards: a clean win against the computer, no undo and no hand-marked dead stones.
  const ranked = (() => {
    if (mode !== 'computer' || tainted) return null;
    if (gameMode === 'omok' && omok.winner === BLACK) {
      const board = boardFor(OMOK_GAME, difficulty);
      return board ? { board, score: omok.board.filter((stone) => stone === BLACK).length } : null;
    }
    if (gameMode === 'go' && shownScore && shownScore.winner === BLACK && isGoSize(game.size)) {
      const owner = getAppGame(goBoardOwner(game.size));
      const board = owner ? boardFor(owner, goLevelId) : null;
      return board ? { board, score: shownScore.margin } : null;
    }
    return null;
  })();
  const lastWinPoint = omok.winLine[omok.winLine.length - 1];

  return (
    <div className={`baduk-app gc-dark ${os.mobile ? 'is-mobile' : ''}`} style={{ '--tint': '#9a6a2f' } as CSSProperties}>
      <header className="baduk-header">
        <div className="baduk-header-main">
          <h1>Baduk <span>바둑</span></h1>
          <div className="baduk-game-mode gseg" aria-label="Game">
            <button aria-pressed={gameMode === 'go'} onClick={() => switchGame('go')}>Go</button>
            <button aria-pressed={gameMode === 'omok'} onClick={() => switchGame('omok')}>Omok</button>
          </div>
        </div>
        <p>{gameMode === 'omok' ? <>omok <span className="baduk-korean">오목</span>. five in a row wins, black goes first.</> : `Grew up playing this. ${game.size}×${game.size}, area scoring, 7.5 komi.`}</p>
      </header>
      <main className="baduk-main">
        <div className="baduk-board-wrap">
          <svg
            className="baduk-board"
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            role="img"
            aria-label={`${boardSize} by ${boardSize} ${gameMode === 'omok' ? 'Omok' : 'Go'} board`}
            onPointerMove={onBoardPointerMove}
            onPointerLeave={() => setHovered(null)}
            onPointerUp={onBoardPointerUp}
          >
            <defs>
              <linearGradient id="baduk-kaya" x1="0" x2="1" y1="0" y2="1">
                <stop offset="0" stopColor="#dfb87b" />
                <stop offset="0.52" stopColor="#d7ad6e" />
                <stop offset="1" stopColor="#c99a5a" />
              </linearGradient>
              <radialGradient id="baduk-black" cx="34%" cy="28%">
                <stop offset="0" stopColor="#5f6260" />
                <stop offset="0.42" stopColor="#272927" />
                <stop offset="1" stopColor="#090a0a" />
              </radialGradient>
              <radialGradient id="baduk-white" cx="32%" cy="25%">
                <stop offset="0" stopColor="#fff" />
                <stop offset="0.52" stopColor="#f4f0e7" />
                <stop offset="1" stopColor="#c9c3b7" />
              </radialGradient>
              <pattern id="baduk-grain" width="31" height="17" patternUnits="userSpaceOnUse">
                <path d="M0 4c8-2 14 1 23 0M5 13c7 1 15-2 25-1" fill="none" stroke="#82562d" strokeOpacity=".1" strokeWidth=".7" />
              </pattern>
              <filter id="baduk-stone-shadow" x="-40%" y="-40%" width="180%" height="180%">
                <feDropShadow dx="1.2" dy="2" stdDeviation="1.5" floodColor="#4a331b" floodOpacity=".35" />
              </filter>
            </defs>
            <rect x="22" y="22" width="376" height="376" rx="4" fill="url(#baduk-kaya)" />
            <rect x="22" y="22" width="376" height="376" rx="4" fill="url(#baduk-grain)" />
            {Array.from({ length: boardSize }, (_, index) => {
              const pos = pointPosition(index, boardSize);
              return (
                <g key={index}>
                  <line x1={start} x2={end} y1={pos} y2={pos} className="baduk-grid-line" />
                  <line x1={pos} x2={pos} y1={start} y2={end} className="baduk-grid-line" />
                  <text x={pos} y="16" className="baduk-coordinate">{letters[index]}</text>
                  <text x={pos} y="410" className="baduk-coordinate">{letters[index]}</text>
                  <text x="15" y={pos + 3} className="baduk-coordinate">{boardSize - index}</text>
                  <text x="405" y={pos + 3} className="baduk-coordinate">{boardSize - index}</text>
                </g>
              );
            })}
            {starPoints(boardSize).map(([x, y]) => (
              <circle key={`${x}-${y}`} cx={pointPosition(x, boardSize)} cy={pointPosition(y, boardSize)} r="2.1" className="baduk-hoshi" />
            ))}
            {board.map((stone, index) => {
              if (stone === 0) return null;
              const x = index % boardSize;
              const y = Math.floor(index / boardSize);
              const cx = pointPosition(x, boardSize);
              const cy = pointPosition(y, boardSize);
              const isDead = gameMode === 'go' && deadSet.has(index);
              return (
                <g key={index} className={isDead ? 'is-dead' : ''} filter="url(#baduk-stone-shadow)">
                  <circle cx={cx} cy={cy} r={radius} fill={stone === BLACK ? 'url(#baduk-black)' : 'url(#baduk-white)'} stroke={stone === BLACK ? '#050606' : '#bdb7ab'} strokeWidth="1" />
                  {isDead && <path d={`M${cx - radius / 3} ${cy - radius / 3}l${radius / 1.5} ${radius / 1.5}m0-${radius / 1.5}l-${radius / 1.5} ${radius / 1.5}`} className="baduk-dead-mark" />}
                  {lastMove?.x === x && lastMove?.y === y && <circle cx={cx} cy={cy} r={radius * 0.27} className={stone === BLACK ? 'baduk-last-move is-on-black' : 'baduk-last-move'} />}
                </g>
              );
            })}
            {canHover && (
              <circle
                cx={pointPosition(preview!.x, boardSize)}
                cy={pointPosition(preview!.y, boardSize)}
                r={radius - 0.2}
                fill={toPlay === BLACK ? '#111' : '#fff'}
                stroke={toPlay === BLACK ? '#000' : '#999'}
                className="baduk-ghost-stone"
              />
            )}
            {gameMode === 'omok' && omok.winLine.length > 1 && lastWinPoint && (
              <line
                x1={pointPosition(omok.winLine[0].x, boardSize)}
                y1={pointPosition(omok.winLine[0].y, boardSize)}
                x2={pointPosition(lastWinPoint.x, boardSize)}
                y2={pointPosition(lastWinPoint.y, boardSize)}
                className="baduk-win-line"
              />
            )}
            <rect x="24" y="24" width="372" height="372" rx="3" className="baduk-board-border" />
          </svg>
        </div>
        <aside className="baduk-side">
          <div className="baduk-turn-card">
            {statusStone !== null && <span className={`baduk-turn-stone ${statusStone === BLACK ? 'is-black' : 'is-white'}`} />}
            <div>
              <small>{gameMode === 'omok' ? 'Omok' : mode === 'computer' && engineStatus === 'loading' && !workerGone ? <><i className="baduk-engine-spinner" />Loading Engine</> : game.phase === 'mark' ? 'Mark the dead stones' : game.phase === 'resigned' ? 'Game over' : thinking ? 'Thinking' : pending ? 'Tap again to place' : online && !sizeReady ? 'Setting up the board' : 'Go'}</small>
              <b>{gameMode === 'omok' ? omokStatus : game.phase === 'mark' ? 'Count the board' : game.phase === 'resigned' ? 'Resigned' : onlineColor !== null ? (game.toPlay === onlineColor ? 'Your move' : `${colorName(game.toPlay)} to play`) : game.toPlay === BLACK ? 'Black to play' : 'White to play'}</b>
            </div>
          </div>
          {workerGone && gameMode === 'go' && (
            <div className="baduk-turn-card baduk-updated" role="status">
              <div>
                <small>{navigator.onLine ? 'Baduk was updated' : "You're offline"}</small>
                <b>{navigator.onLine ? 'Reload to keep playing' : 'Reconnect, then reload'}</b>
              </div>
              <button type="button" className="gbtn gbtn-primary" onClick={() => reloadInto({ app: 'baduk', args: { game: 'go', room: args.room } })}>Reload</button>
            </div>
          )}
          {gameMode === 'go' && <div className="baduk-captures">
            <span><i className="is-black" /> Black captured <b>{game.captures.black}</b></span>
            <span><i className="is-white" /> White captured <b>{game.captures.white}</b></span>
          </div>}
          {gameMode === 'go' && (
            <div className="baduk-mode baduk-size">
              <span className="glabel">Board</span>
              <div className="gseg" aria-label="Board size">
                {GO_SIZES.map((size) => (
                  <button key={size} aria-pressed={game.size === size} disabled={sizeLocked && game.size !== size} onClick={() => switchSize(size)}>{size}×{size}</button>
                ))}
              </div>
            </div>
          )}
          <div className="baduk-mode">
            <span className="glabel">Opponent</span>
            <div className="gseg">
              <button aria-pressed={mode === 'computer'} onClick={() => switchMode('computer')}>{onlineAvailable ? 'Computer' : 'Vs Computer'}</button>
              <button aria-pressed={mode === 'friend'} onClick={() => switchMode('friend')}>{onlineAvailable ? 'Friend' : 'Vs Friend'}</button>
              {onlineAvailable && <button aria-pressed={mode === 'online'} onClick={() => switchMode('online')}>Online</button>}
            </div>
          </div>
          {online && (room.status !== 'playing' ? (
            <RoomPanel room={room} title={`Online ${gameMode === 'omok' ? 'Omok' : 'Go'}`} note={`Play ${gameMode === 'omok' ? 'Omok' : 'Go'} with a friend anywhere. Colors swap every game.`} />
          ) : (
            <div className="baduk-online">
              <span><i className={onlineColor === BLACK ? 'is-black' : 'is-white'} /> You play {onlineColor === BLACK ? 'Black' : 'White'} vs {room.opponent?.name ?? 'Opponent'}</span>
              <small>Room {room.code} · {room.transport === 'direct' ? 'Direct' : 'Relayed'}</small>
              {room.error && <small className="baduk-online-error">{room.error}</small>}
            </div>
          ))}
          {mode === 'computer' && gameMode === 'go' && (
            <label className="baduk-difficulty">
              <span className="glabel">Level</span>
              <select className="ginput" value={goLevelId} onChange={(event) => {
                const next = event.target.value as GoLevelId;
                setGoLevelId(next);
                store('baduk-go-level', next);
                if (game.past.length) setTainted(true);
              }}>
                {GO_LEVELS.map((level, index) => <option key={level.id} value={level.id}>{index + 1} · {level.label}</option>)}
              </select>
              <small className="baduk-level-note">{goLevel(goLevelId).blurb}</small>
            </label>
          )}
          {mode === 'computer' && gameMode === 'omok' && (
            <label className="baduk-difficulty">
              <span className="glabel">Difficulty</span>
              <select className="ginput" value={difficulty} onChange={(event) => {
                setDifficulty(event.target.value as 'easy' | 'normal');
                if (omok.past.length) setTainted(true);
              }}>
                <option value="easy">Easy · Quick</option>
                <option value="normal">Normal · Thoughtful</option>
              </select>
            </label>
          )}
          {online ? (onlineColor !== null && (
            <div className="baduk-actions">
              {gameMode === 'go' && <button className="gbtn" onClick={passTurn} disabled={game.phase !== 'play' || !myTurn(game.toPlay)}>Pass</button>}
              {room.isHost && <button className="gbtn" onClick={room.start}>New Game</button>}
              <button className="gbtn gbtn-destructive" onClick={resignGame} disabled={gameMode === 'omok' ? omok.winner !== null : game.phase !== 'play'}>Resign</button>
              <button className="gbtn" onClick={room.leave}>Leave</button>
            </div>
          )) : (
            <div className="baduk-actions">
              {gameMode === 'go' && <button className="gbtn" onClick={passTurn} disabled={game.phase !== 'play' || thinking}>Pass</button>}
              <button className="gbtn" onClick={undoTurn} disabled={gameMode === 'omok' ? !omok.past.length : !game.past.length}>Undo</button>
              <button className="gbtn" onClick={() => startNewGame()}>New Game</button>
              {gameMode === 'go' && <button className="gbtn gbtn-destructive" onClick={resignGame} disabled={game.phase !== 'play' || thinking}>Resign</button>}
            </div>
          )}
          {gameMode === 'go' && game.phase === 'mark' && (
            <section className="baduk-count-panel">
              <div><small>two passes. review the board.</small><b>{online && !room.isHost && !analysisReady ? 'the host is reading the board…' : analyzing ? engineStatus === 'ready' ? 'reading the board…' : 'reading 400 playouts…' : `${deadSet.size} stones marked dead`}</b></div>
              <p>{online ? 'either player can tap a group to toggle it, then count the board.' : 'tap a group to toggle it, then count the board.'}</p>
              <button className="gbtn gbtn-primary" onClick={countBoard} disabled={analyzing || (online && !analysisReady)}>Count</button>
            </section>
          )}
          {shownScore && (
            <section className="baduk-score-card">
              <small>area score · 7.5 komi</small>
              <strong>{shownScore.result}</strong>
              <div><span>black</span><b>{shownScore.black.toFixed(1)}</b></div>
              <div><span>white</span><b>{shownScore.white.toFixed(1)}</b></div>
              <div><span>territory</span><b>{shownScore.blackTerritory} · {shownScore.whiteTerritory}</b></div>
              <p>{shownScore.winner === BLACK ? 'black' : 'white'} wins by {shownScore.margin.toFixed(1)}.</p>
            </section>
          )}
          {gameMode === 'go' && game.phase === 'resigned' && game.winner && (
            <section className="baduk-score-card">
              <small>resignation</small>
              <strong>{game.winner === BLACK ? 'B+R' : 'W+R'}</strong>
              <p>{game.winner === BLACK ? 'black' : 'white'} wins.</p>
            </section>
          )}
          {ranked && <AppBoard key={`${ranked.board.id}:${gameNo}`} board={ranked.board} score={ranked.score} round={gameNo} />}
          <footer>{gameMode === 'omok' ? 'Black plays first · five or more in a row wins' : 'Black plays first · area scoring · 7.5 komi'}</footer>
        </aside>
      </main>
      <div className="baduk-touch-hint">{gameMode === 'omok' ? omokStatus : game.phase === 'mark' ? 'Tap stones to mark a group dead' : game.toPlay === BLACK ? 'Black to play' : 'White to play'}</div>
      <span className="baduk-screenreader" aria-live="polite">{thinking ? 'Computer thinking' : gameMode === 'omok' ? omokStatus : game.phase === 'mark' ? 'Mark dead stones' : ''}</span>
    </div>
  );
}
