import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { BLACK, groupStones, newGame, pass, play, resign, score, undo, WHITE, type GameState, type Ownership, type Point } from '../games/go';
import { newOmok, omokAiMove, playOmok, undoOmok, type OmokState } from '../games/omok';
import { useOS, type AppProps } from '../types';
import './game-controls.css';
import './Baduk.css';

type Mode = 'computer' | 'friend';
type GameMode = 'go' | 'omok';
type WorkerResponse =
  | { id: number; type: 'ai'; move: Point | null }
  | { id: number; type: 'ownership'; values: Ownership[] };

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
  const [gameMode, setGameMode] = useState<GameMode>(() => typeof window !== 'undefined' && window.localStorage.getItem('baduk-game') === 'omok' ? 'omok' : 'go');
  const [mode, setMode] = useState<Mode>('computer');
  const [difficulty, setDifficulty] = useState<'easy' | 'normal'>('normal');
  const [hovered, setHovered] = useState<Point | null>(null);
  const [deadSet, setDeadSet] = useState<Set<number>>(() => new Set());
  const [counted, setCounted] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisReady, setAnalysisReady] = useState(false);
  const gameRef = useRef(game);
  const modeRef = useRef(mode);
  const gameModeRef = useRef(gameMode);
  const workerRef = useRef<Worker | null>(null);
  const jobRef = useRef(0);
  gameRef.current = game;
  modeRef.current = mode;
  gameModeRef.current = gameMode;

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
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (gameMode !== 'go' || mode !== 'computer' || game.phase !== 'play' || game.toPlay !== WHITE) return;
    const worker = workerRef.current;
    if (!worker) return;
    const id = ++jobRef.current;
    setThinking(true);
    worker.postMessage({ id, type: 'ai', state: game, budgetMs: difficulty === 'easy' ? 150 : 700 });
    return () => {
      if (jobRef.current === id) jobRef.current += 1;
    };
  }, [gameMode, mode, game, difficulty]);

  useEffect(() => {
    if (gameMode !== 'go' || game.phase !== 'mark' || analysisReady) return;
    const worker = workerRef.current;
    if (!worker) return;
    const id = ++jobRef.current;
    setAnalyzing(true);
    worker.postMessage({ id, type: 'ownership', state: game, playouts: 400 });
    return () => {
      if (jobRef.current === id) jobRef.current += 1;
    };
  }, [gameMode, game, analysisReady]);

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
    jobRef.current += 1;
    setGame(newGame(9));
    setOmok(newOmok());
    setDeadSet(new Set());
    setCounted(false);
    setThinking(false);
    setAnalyzing(false);
    setAnalysisReady(false);
  };

  const placeStone = (point: Point) => {
    if (gameMode === 'omok') {
      if (thinking || omok.winner !== null) return;
      const result = playOmok(omok, point.x, point.y);
      if (result.ok) setOmok(result.state);
      return;
    }
    if (game.phase === 'mark') {
      const group = groupStones(game, point.x, point.y);
      if (!group.length) return;
      setDeadSet((current) => {
        const next = new Set(current);
        const shouldAdd = group.some((index) => !next.has(index));
        group.forEach((index) => shouldAdd ? next.add(index) : next.delete(index));
        return next;
      });
      setCounted(false);
      return;
    }
    if (thinking || game.phase !== 'play') return;
    const result = play(game, point.x, point.y);
    if (result.ok) {
      setGame(result.state);
      setCounted(false);
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
    jobRef.current += 1;
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
    if (thinking || game.phase !== 'play') return;
    setGame(pass(game));
    setCounted(false);
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
  const canHover = gameMode === 'omok'
    ? omok.winner === null && !thinking && hovered && board[hoverIndex] === 0
    : game.phase === 'play' && !thinking && hovered && board[hoverIndex] === 0;
  const omokStatus = omok.winner === 1 ? 'Black wins' : omok.winner === -1 ? 'White wins' : omok.winner === 0 ? 'Draw' : omok.toPlay === BLACK ? 'Black to play' : 'White to play';
  const lastWinPoint = omok.winLine[omok.winLine.length - 1];

  return (
    <div className={`baduk-app gc-dark ${os.mobile ? 'is-mobile' : ''}`} style={{ '--tint': '#9a6a2f' } as CSSProperties}>
      <header className="baduk-header">
        <div className="baduk-header-main">
          <h1>Baduk <span>바둑</span></h1>
          <div className="baduk-game-mode gseg" aria-label="Game">
            <button aria-pressed={gameMode === 'go'} onClick={() => { setGameMode('go'); window.localStorage.setItem('baduk-game', 'go'); startNewGame(); }}>Go</button>
            <button aria-pressed={gameMode === 'omok'} onClick={() => { setGameMode('omok'); window.localStorage.setItem('baduk-game', 'omok'); startNewGame(); }}>Omok</button>
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
              <small>{gameMode === 'omok' ? 'Omok' : game.phase === 'mark' ? 'Mark the dead stones' : game.phase === 'resigned' ? 'Game over' : thinking ? 'Thinking' : 'Go'}</small>
              <b>{gameMode === 'omok' ? omokStatus : game.phase === 'mark' ? 'Count the board' : game.phase === 'resigned' ? 'Resigned' : game.toPlay === BLACK ? 'Black to play' : 'White to play'}</b>
            </div>
          </div>
          {gameMode === 'go' && <div className="baduk-captures">
            <span><i className="is-black" /> Black captured <b>{game.captures.black}</b></span>
            <span><i className="is-white" /> White captured <b>{game.captures.white}</b></span>
          </div>}
          <div className="baduk-mode">
            <span className="glabel">Opponent</span>
            <div className="gseg">
              <button aria-pressed={mode === 'computer'} onClick={() => { setMode('computer'); startNewGame(); }}>Vs Computer</button>
              <button aria-pressed={mode === 'friend'} onClick={() => { setMode('friend'); startNewGame(); }}>Vs Friend</button>
            </div>
          </div>
          {mode === 'computer' && (
            <label className="baduk-difficulty">
              <span className="glabel">Difficulty</span>
              <select className="ginput" value={difficulty} onChange={(event) => setDifficulty(event.target.value as 'easy' | 'normal')}>
                <option value="easy">Easy · Quick</option>
                <option value="normal">Normal · Thoughtful</option>
              </select>
            </label>
          )}
          <div className="baduk-actions">
            {gameMode === 'go' && <button className="gbtn" onClick={passTurn} disabled={game.phase !== 'play' || thinking}>Pass</button>}
            <button className="gbtn" onClick={undoTurn} disabled={gameMode === 'omok' ? !omok.past.length : !game.past.length}>Undo</button>
            <button className="gbtn" onClick={startNewGame}>New Game</button>
            {gameMode === 'go' && <button className="gbtn gbtn-destructive" onClick={() => setGame(resign(game))} disabled={game.phase !== 'play' || thinking}>Resign</button>}
          </div>
          {gameMode === 'go' && game.phase === 'mark' && (
            <section className="baduk-count-panel">
              <div><small>two passes. review the board.</small><b>{analyzing ? 'reading 400 playouts…' : `${deadSet.size} stones marked dead`}</b></div>
              <p>tap a group to toggle it, then count the board.</p>
              <button className="gbtn gbtn-primary" onClick={() => setCounted(true)} disabled={analyzing}>Count</button>
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
          <footer>{gameMode === 'omok' ? 'Black plays first · five or more in a row wins' : 'Black plays first · area scoring · 7.5 komi'}</footer>
        </aside>
      </main>
      <div className="baduk-touch-hint">{gameMode === 'omok' ? omokStatus : game.phase === 'mark' ? 'Tap stones to mark a group dead' : game.toPlay === BLACK ? 'Black to play' : 'White to play'}</div>
      <span className="baduk-screenreader" aria-live="polite">{thinking ? 'Computer thinking' : gameMode === 'omok' ? omokStatus : game.phase === 'mark' ? 'Mark dead stones' : ''}</span>
    </div>
  );
}
