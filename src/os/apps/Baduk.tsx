import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { BLACK, groupStones, newGame, pass, play, resign, score, undo, WHITE, type GameState, type Ownership, type Point } from '../games/go';
import { newOmok, omokAiMove, playOmok, undoOmok, type OmokState } from '../games/omok';
import { useOS, type AppProps } from '../types';
import { countPlay } from '../stats';
import { reloadInto } from '../reload';
import { getAppGame } from '../arcade/apps';
import { boardFor } from '../arcade/kit/leaderboard';
import { AppBoard, onlineAvailable, RoomPanel, useAppRoom, useInvite } from './online-room';
import './game-controls.css';
import './Baduk.css';

type Mode = 'computer' | 'friend' | 'online';
type Color = typeof BLACK | typeof WHITE;
type RoomMessage = { t: 'move'; x: number; y: number } | { t: 'pass' } | { t: 'resign' } | { t: 'dead'; list: number[] } | { t: 'count'; list: number[] };

const GO_GAME = getAppGame('go')!;
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
const GO_LETTERS = 'ABCDEFGHJ';
const OMOK_LETTERS = 'ABCDEFGHJKLMNOP';
const boardStart = (size: number) => size === 15 ? 34 : 44;
const boardSpacing = (size: number) => size === 15 ? 25 : 41.5;
const pointPosition = (index: number, size: number) => boardStart(size) + index * boardSpacing(size);

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
  const [game, setGame] = useState<GameState>(() => newGame(9));
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
  const omokRef = useRef(omok);
  omokRef.current = omok;
  const deadRef = useRef(deadSet);
  deadRef.current = deadSet;
  const room = useAppRoom(gameMode === 'omok' ? 'omok' : 'go', {
    onStart: () => startNewGame(),
    onEnd: () => startNewGame(),
  });
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
    worker.postMessage({ id, type: 'ai', state: game, level: difficulty === 'easy' ? 'fast' : 'strong' });
    return () => {
      if (jobRef.current === id) jobRef.current += 1;
    };
  }, [gameMode, mode, game, difficulty]);

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
    worker.postMessage({ id, type: 'ownership', state: game, playouts: 400 });
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
    const message = parseRoomMessage(data, omokMode ? 15 : 9);
    if (!message) return;
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

  const startNewGame = () => {
    countPlay('baduk');
    jobRef.current += 1;
    setTainted(false);
    setGameNo((n) => n + 1);
    setGame(newGame(9));
    setOmok(newOmok());
    setDeadSet(new Set());
    setCounted(false);
    setThinking(false);
    setAnalyzing(false);
    setAnalysisReady(false);
  };

  const online = mode === 'online';
  const myTurn = (toPlay: Color) => !online || toPlay === onlineColor;

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
    setHovered(pointFromPointer(event, gameMode === 'omok' ? 15 : 9));
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
    startNewGame();
  };

  const switchMode = (next: Mode) => {
    if (next !== 'online' && room.linked) room.leave();
    setMode(next);
    startNewGame();
  };

  const boardSize = gameMode === 'omok' ? 15 : 9;
  const start = boardStart(boardSize);
  const end = pointPosition(boardSize - 1, boardSize);
  const board = gameMode === 'omok' ? omok.board : game.board;
  const toPlay = gameMode === 'omok' ? omok.toPlay : game.toPlay;
  const statusStone = gameMode === 'omok'
    ? omok.winner === 0 ? null : omok.winner === null ? omok.toPlay : omok.winner
    : toPlay;
  const lastMove = gameMode === 'omok' ? omok.lastMove : game.lastMove;
  const letters = Array.from({ length: boardSize }, (_, index) => (gameMode === 'omok' ? OMOK_LETTERS : GO_LETTERS)[index] ?? '');
  const shownScore = gameMode === 'go' && counted ? score(game, deadSet) : null;
  const hoverIndex = hovered ? hovered.y * boardSize + hovered.x : -1;
  const canHover = (!online || (onlineColor !== null && toPlay === onlineColor)) && (gameMode === 'omok'
    ? omok.winner === null && !thinking && hovered && board[hoverIndex] === 0
    : game.phase === 'play' && !thinking && hovered && board[hoverIndex] === 0);
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
    if (gameMode === 'go' && shownScore && shownScore.winner === BLACK) {
      const board = boardFor(GO_GAME, difficulty === 'easy' ? 'fast' : 'strong');
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
        <p>{gameMode === 'omok' ? <>omok <span className="baduk-korean">오목</span>. five in a row wins, black goes first.</> : 'Grew up playing this. 9×9, area scoring, 7.5 komi.'}</p>
      </header>
      <main className="baduk-main">
        <div className="baduk-board-wrap">
          <svg
            className="baduk-board"
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            role="img"
            aria-label={gameMode === 'omok' ? '15 by 15 Omok board' : '9 by 9 Go board'}
            onPointerMove={onBoardPointerMove}
            onPointerLeave={() => setHovered(null)}
            onPointerUp={(event) => {
              const point = pointFromPointer(event, boardSize);
              if (point) placeStone(point);
            }}
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
            {(gameMode === 'omok' ? [[3, 3], [11, 3], [3, 11], [11, 11], [7, 7]] : [[2, 2], [6, 2], [2, 6], [6, 6], [4, 4]]).map(([x, y]) => (
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
                  <circle cx={cx} cy={cy} r={boardSize === 15 ? '10.2' : '15.2'} fill={stone === BLACK ? 'url(#baduk-black)' : 'url(#baduk-white)'} stroke={stone === BLACK ? '#050606' : '#bdb7ab'} strokeWidth="1" />
                  {isDead && <path d={`M${cx - 5} ${cy - 5}l10 10m0-10l-10 10`} className="baduk-dead-mark" />}
                  {lastMove?.x === x && lastMove?.y === y && <circle cx={cx} cy={cy} r={boardSize === 15 ? '3' : '4'} className={stone === BLACK ? 'baduk-last-move is-on-black' : 'baduk-last-move'} />}
                </g>
              );
            })}
            {canHover && (
              <circle
                cx={pointPosition(hovered!.x, boardSize)}
                cy={pointPosition(hovered!.y, boardSize)}
                r={boardSize === 15 ? '10' : '15'}
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
              <small>{gameMode === 'omok' ? 'Omok' : mode === 'computer' && engineStatus === 'loading' && !workerGone ? <><i className="baduk-engine-spinner" />Loading Engine</> : game.phase === 'mark' ? 'Mark the dead stones' : game.phase === 'resigned' ? 'Game over' : thinking ? 'Thinking' : 'Go'}</small>
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
          {mode === 'computer' && (
            <label className="baduk-difficulty">
              <span className="glabel">Difficulty</span>
              <select className="ginput" value={difficulty} onChange={(event) => {
                setDifficulty(event.target.value as 'easy' | 'normal');
                if (game.past.length || omok.past.length) setTainted(true);
              }}>
                <option value="easy">{gameMode === 'go' ? 'Fast' : 'Easy · Quick'}</option>
                <option value="normal">{gameMode === 'go' ? 'Strong' : 'Normal · Thoughtful'}</option>
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
              <button className="gbtn" onClick={startNewGame}>New Game</button>
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
