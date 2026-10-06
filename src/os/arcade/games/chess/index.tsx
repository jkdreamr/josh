import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { GameShell, sfx, useCanvas, useKeys, useShell } from '../../kit';
import type { GameProps } from '../../types';
import { bestMove, type Level } from './ai.ts';
import {
  BLACK, FLAG_CASTLE, FLAG_EP, WHITE,
  colorOf, fileOf, findMove, inCheck, isPromotion, moveCaptured, moveFlags, moveFrom, movePromo, moveTo, newGame, pieces, play, rankOf, square, squareName,
  type Color, type Game as ChessGame, type Position,
} from './engine.ts';
import { meta } from './meta';
import { BISHOP, KNIGHT, Piece, QUEEN, ROOK } from './pieces.tsx';
import type { AiReply, AiRequest } from './worker.ts';
import './chess.css';

type Mode = 'cpu' | '2p';
const LEVELS = ['easy', 'normal', 'hard'] as const;
const prefs: { mode: Mode; level: Level; color: Color } = { mode: 'cpu', level: 1, color: WHITE };
const MIN_THINK_MS = 450;
const ENDINGS = { checkmate: 'checkmate', stalemate: 'stalemate', repetition: 'draw by repetition', fifty: 'draw, fifty-move rule', insufficient: 'draw, insufficient material' } as const;
const DRAWS = { stalemate: 'stalemate', repetition: 'threefold repetition', fifty: 'the fifty-move rule', insufficient: 'insufficient material' } as const;

export default function Game({ compact, onExit }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} lowerIsBetter formatScore={(n) => `${n} ${n === 1 ? 'move' : 'moves'}`}>
      <Chess />
    </GameShell>
  );
}

function Setup({ onStart }: { onStart: (mode: Mode, level: Level, color: Color) => void }) {
  const [mode, setMode] = useState<Mode>(prefs.mode);
  const [level, setLevel] = useState<Level>(prefs.level);
  const [color, setColor] = useState<Color>(prefs.color);
  const seg = <T,>(label: string, value: T, items: [T, string][], set: (v: T) => void, hidden = false) => (
    <div className={`g-chess-seg ${hidden ? 'hidden' : ''}`} role="radiogroup" aria-label={label}>
      {items.map(([v, text]) => (
        <button key={text} type="button" role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => set(v)}>
          {text}
        </button>
      ))}
    </div>
  );
  return (
    <div className="g-chess-setup">
      {seg<Mode>('Mode', mode, [['cpu', 'vs computer'], ['2p', '2 players']], setMode)}
      {seg<Level>('Difficulty', level, LEVELS.map((l, i) => [i as Level, l]), setLevel, mode !== 'cpu')}
      {seg<Color>('Play as', color, [[WHITE, 'play white'], [BLACK, 'play black']], setColor, mode !== 'cpu')}
      <button type="button" className="g-chess-go" onClick={() => onStart(mode, level, color)}>
        start
      </button>
    </div>
  );
}

type Drag = { pid: number; from: number; moved: boolean };

function nextIds(ids: Map<number, number>, pos: Position, m: number) {
  const out = new Map(ids);
  const from = moveFrom(m);
  const to = moveTo(m);
  const flags = moveFlags(m);
  const id = out.get(from)!;
  out.delete(from);
  if (flags & FLAG_EP) out.delete(to + (pos.turn === WHITE ? -16 : 16));
  out.set(to, id);
  if (flags & FLAG_CASTLE) {
    const rookFrom = to > from ? from + 3 : from - 4;
    const rookTo = to > from ? to - 1 : to + 1;
    const r = out.get(rookFrom)!;
    out.delete(rookFrom);
    out.set(rookTo, r);
  }
  return out;
}

const initialIds = (pos: Position) => new Map(pieces(pos).map(([sq], i) => [sq, i + 1]));

function Chess() {
  const shell = useShell();
  const { ref: stageRef, size } = useCanvas<HTMLDivElement>();
  const boardRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLOListElement | null>(null);
  const pieceEls = useRef(new Map<number, HTMLDivElement>());
  const [phase, setPhase] = useState<'setup' | 'play'>('setup');
  const [game, setGame] = useState<ChessGame>(() => newGame());
  const [ids, setIds] = useState(() => initialIds(game.pos));
  const [sel, setSel] = useState<number | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [promo, setPromo] = useState<{ from: number; to: number } | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const drag = useRef<Drag | null>(null);
  const cfg = useRef({ mode: prefs.mode, level: prefs.level, color: prefs.color });
  const worker = useRef<Worker | null>(null);
  const reqId = useRef(0);
  const timers = useRef(new Set<number>());

  const later = useCallback((fn: () => void, ms: number) => {
    const t = window.setTimeout(() => {
      timers.current.delete(t);
      fn();
    }, ms);
    timers.current.add(t);
  }, []);
  useEffect(
    () => () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current.clear();
    },
    [],
  );

  const humanTurn = phase === 'play' && game.status === 'playing' && (cfg.current.mode === '2p' || game.pos.turn === cfg.current.color);
  const lastMove = game.history.at(-1)?.move;
  const checkSq = inCheck(game.pos) ? game.pos.kings[game.pos.turn === WHITE ? 0 : 1] : -1;
  const targets = useMemo(() => (sel === null ? new Set<number>() : new Set(game.legal.filter((m) => moveFrom(m) === sel).map(moveTo))), [sel, game.legal]);

  const commit = useCallback(
    (m: number) => {
      setGame((g) => {
        if (!g.legal.includes(m)) return g;
        const next = play(g, m);
        setIds((ids) => nextIds(ids, g.pos, m));
        const cap = moveCaptured(m);
        if (next.status === 'checkmate') sfx.play(cfg.current.mode === 'cpu' && next.pos.turn === cfg.current.color ? 'lose' : 'win');
        else if (next.status !== 'playing') sfx.play('select', 0.7);
        else if (inCheck(next.pos)) sfx.play('blip', 1.3);
        else if (movePromo(m)) sfx.play('coin');
        else if (moveFlags(m) & FLAG_CASTLE) sfx.play('select');
        else if (cap) sfx.play('hit', 1.6);
        else sfx.play('tick', 0.7);
        return next;
      });
      setSel(null);
      setPromo(null);
    },
    [],
  );

  const tryMove = useCallback(
    (from: number, to: number) => {
      if (isPromotion(game.legal, from, to)) {
        setPromo({ from, to });
        setSel(from);
        return true;
      }
      const m = findMove(game.legal, from, to);
      if (m === undefined) return false;
      commit(m);
      return true;
    },
    [game.legal, commit],
  );

  const begin = (mode: Mode, level: Level, color: Color) => {
    Object.assign(prefs, { mode, level, color });
    cfg.current = { mode, level, color };
    const g = newGame();
    setGame(g);
    setIds(initialIds(g.pos));
    setFlipped(mode === 'cpu' && color === BLACK);
    setSel(null);
    setPromo(null);
    sfx.play('select');
    setPhase('play');
    shell.root.current?.focus({ preventScroll: true });
  };

  // Computer: a Web Worker when available, otherwise the same search on a timer.
  useEffect(() => {
    let w: Worker | null = null;
    try {
      if (typeof Worker !== 'undefined') w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    } catch {
      w = null;
    }
    worker.current = w;
    return () => {
      w?.terminate();
      worker.current = null;
    };
  }, []);

  useEffect(() => {
    if (phase !== 'play' || cfg.current.mode !== 'cpu' || game.status !== 'playing' || game.pos.turn === cfg.current.color) return;
    const id = ++reqId.current;
    const started = performance.now();
    setThinking(true);
    let cancelled = false;
    const deliver = (from: number, to: number, promoPiece: number) => {
      if (cancelled || id !== reqId.current) return;
      const wait = Math.max(0, MIN_THINK_MS - (performance.now() - started));
      later(() => {
        if (cancelled || id !== reqId.current) return;
        setThinking(false);
        const m = findMove(game.legal, from, to, promoPiece);
        if (m !== undefined) commit(m);
      }, wait);
    };
    const fallback = () =>
      later(() => {
        const r = bestMove(game.pos, cfg.current.level, game.keys);
        if (r) deliver(moveFrom(r.move), moveTo(r.move), movePromo(r.move));
      }, 30);
    const w = worker.current;
    if (w) {
      const onMessage = (e: MessageEvent<AiReply>) => {
        if (e.data.id !== id) return;
        w.removeEventListener('message', onMessage);
        w.removeEventListener('error', onError);
        if (e.data.from >= 0) deliver(e.data.from, e.data.to, e.data.promo);
      };
      const onError = () => {
        w.removeEventListener('message', onMessage);
        w.removeEventListener('error', onError);
        fallback();
      };
      w.addEventListener('message', onMessage);
      w.addEventListener('error', onError);
      const req: AiRequest = { id, fen: game.history.at(-1)?.fen ?? toFenOf(game), keys: game.keys, level: cfg.current.level };
      w.postMessage(req);
      return () => {
        cancelled = true;
        w.removeEventListener('message', onMessage);
        w.removeEventListener('error', onError);
      };
    }
    fallback();
    return () => {
      cancelled = true;
    };
  }, [game, phase, commit, later]);

  // Game over -> shell overlay, after the last move has settled.
  useEffect(() => {
    if (phase !== 'play' || game.status === 'playing') return;
    later(() => {
      const { mode, color } = cfg.current;
      const winner = game.status === 'checkmate' ? (game.pos.turn === WHITE ? BLACK : WHITE) : null;
      const moves = Math.ceil(game.history.length / 2);
      if (game.status === 'checkmate') {
        const who = mode === 'cpu' ? (winner === color ? 'you win' : 'computer wins') : `${winner === WHITE ? 'white' : 'black'} wins`;
        const score = mode === 'cpu' && winner === color ? moves : undefined;
        shell.gameOver(score, { title: 'checkmate', detail: `${who} in ${moves} ${moves === 1 ? 'move' : 'moves'}.` });
      } else {
        const why = DRAWS[game.status as keyof typeof DRAWS];
        shell.gameOver(undefined, { title: 'draw', detail: `by ${why} after ${moves} ${moves === 1 ? 'move' : 'moves'}.` });
      }
    }, 650);
  }, [game, phase, shell, later]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [game.history.length]);

  // Geometry
  const flip = flipped;
  const colOf = (sq: number) => (flip ? 7 - fileOf(sq) : fileOf(sq));
  const rowOf = (sq: number) => (flip ? rankOf(sq) : 7 - rankOf(sq));
  const sqAt = (col: number, row: number) => square(flip ? 7 - col : col, flip ? row : 7 - row);
  const TOP = 44;
  const wide = size.w >= 540 && size.w > size.h * 0.95;
  const panelW = wide ? Math.min(240, Math.max(170, size.w * 0.3)) : 0;
  const panelH = wide ? 0 : 104;
  const boardPx = Math.max(120, Math.floor(wide ? Math.min(size.h - TOP - 20, size.w - panelW - 36) : Math.min(size.w - 24, size.h - TOP - panelH - 24)));
  const sqPx = boardPx / 8;

  const squareFromEvent = (e: { clientX: number; clientY: number }) => {
    const b = boardRef.current;
    if (!b) return -1;
    const r = b.getBoundingClientRect();
    const col = Math.floor(((e.clientX - r.left) / r.width) * 8);
    const row = Math.floor(((e.clientY - r.top) / r.height) * 8);
    if (col < 0 || col > 7 || row < 0 || row > 7) return -1;
    return sqAt(col, row);
  };

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (!humanTurn || promo) return;
    const sq = squareFromEvent(e);
    if (sq < 0) return;
    const pc = game.pos.board[sq];
    setCursor(null);
    if (pc && colorOf(pc) === game.pos.turn) {
      setSel(sq);
      drag.current = { pid: e.pointerId, from: sq, moved: false };
      boardRef.current?.setPointerCapture(e.pointerId);
      return;
    }
    if (sel !== null && tryMove(sel, sq)) return;
    setSel(null);
  };
  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const b = boardRef.current;
    if (!d || d.pid !== e.pointerId || !b) return;
    const r = b.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    if (!d.moved) {
      const home = { x: colOf(d.from) * sqPx + sqPx / 2, y: rowOf(d.from) * sqPx + sqPx / 2 };
      if (Math.hypot(x - home.x, y - home.y) < 5) return;
      d.moved = true;
      setDragFrom(d.from);
    }
    const el = pieceEls.current.get(ids.get(d.from) ?? -1);
    if (el) el.style.transform = `translate(${x - sqPx / 2}px, ${y - sqPx / 2}px) scale(1.12)`;
  };
  const endDrag = (e: RPointerEvent<HTMLDivElement>, cancelled = false) => {
    const d = drag.current;
    if (!d || d.pid !== e.pointerId) return;
    drag.current = null;
    const el = pieceEls.current.get(ids.get(d.from) ?? -1);
    if (el) el.style.transform = '';
    setDragFrom(null);
    if (!d.moved || cancelled) return;
    const to = squareFromEvent(e);
    if (to >= 0 && to !== d.from) {
      if (!tryMove(d.from, to)) {
        const pc = game.pos.board[to];
        setSel(pc && colorOf(pc) === game.pos.turn ? to : null);
      }
    }
  };

  // Keyboard: arrows move a cursor, Enter or Space selects and moves, F flips.
  useKeys((code, e) => {
    if (e?.repeat && (code === 'Enter' || code === 'Space' || code === 'KeyF')) return;
    if (code === 'KeyF') return setFlipped((f) => !f);
    if (phase !== 'play') return;
    const dirs: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1], KeyA: [-1, 0], KeyD: [1, 0], KeyW: [0, -1], KeyS: [0, 1] };
    if (dirs[code]) {
      const [dx, dy] = dirs[code];
      setCursor((c) => {
        const cur = c ?? sel ?? sqAt(4, 7);
        const col = Math.max(0, Math.min(7, colOf(cur) + dx));
        const row = Math.max(0, Math.min(7, rowOf(cur) + dy));
        return sqAt(col, row);
      });
      return;
    }
    if ((code === 'Enter' || code === 'Space') && cursor !== null && humanTurn) {
      if (promo) return;
      const pc = game.pos.board[cursor];
      if (sel !== null && cursor !== sel && tryMove(sel, cursor)) return;
      if (pc && colorOf(pc) === game.pos.turn) setSel(cursor);
      else setSel(null);
    }
    if (code === 'Escape' || code === 'Backspace') {
      setSel(null);
      setPromo(null);
    }
  });

  const status = (() => {
    if (phase !== 'play') return '';
    if (game.status !== 'playing') return ENDINGS[game.status];
    const side = game.pos.turn === WHITE ? 'white' : 'black';
    const check = checkSq >= 0 ? ' · check' : '';
    if (cfg.current.mode === 'cpu') return (thinking ? 'computer is thinking' : 'your move') + check;
    return `${side} to move${check}`;
  })();

  const squares = useMemo(() => {
    const out: { sq: number; col: number; row: number }[] = [];
    for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) out.push({ sq: sqAt(col, row), col, row });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flip]);

  const rows: { n: number; w?: string; b?: string }[] = [];
  game.history.forEach((h, i) => {
    if (i % 2 === 0) rows.push({ n: i / 2 + 1, w: h.san });
    else rows[rows.length - 1].b = h.san;
  });

  return (
    <div ref={stageRef} className={`g-chess-stage ${wide ? 'wide' : 'tall'}`}>
      {phase === 'play' && (
        <>
          <div className={`g-chess-status ${thinking ? 'busy' : ''}`} aria-live="polite">
            {thinking && <span className="g-chess-dots" aria-hidden="true" />}
            {status}
          </div>
          <div className="g-chess-body" style={{ paddingTop: TOP }}>
            <div
              ref={boardRef}
              className={`g-chess-board ${humanTurn ? 'live' : ''}`}
              style={{ width: boardPx, height: boardPx }}
              role="grid"
              aria-label="Chess board"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={(e) => endDrag(e, true)}
              onContextMenu={(e) => e.preventDefault()}
            >
              {squares.map(({ sq, col, row }) => {
                const light = (fileOf(sq) + rankOf(sq)) % 2 === 1;
                const isLast = lastMove !== undefined && (moveFrom(lastMove) === sq || moveTo(lastMove) === sq);
                const hint = targets.has(sq);
                const capture = hint && game.pos.board[sq] !== 0;
                const cls = ['g-chess-sq', light ? 'light' : 'dark', sel === sq ? 'sel' : '', isLast ? 'last' : '', checkSq === sq ? 'check' : '', cursor === sq ? 'cursor' : '', hint ? (capture ? 'hint capture' : 'hint') : ''].join(' ');
                return (
                  <div key={sq} className={cls} style={{ left: `${col * 12.5}%`, top: `${row * 12.5}%` }} role="gridcell" aria-label={squareName(sq)}>
                    {col === 0 && <span className="g-chess-rank">{rankOf(sq) + 1}</span>}
                    {row === 7 && <span className="g-chess-file">{'abcdefgh'[fileOf(sq)]}</span>}
                  </div>
                );
              })}
              {pieces(game.pos).map(([sq, pc]) => {
                const id = ids.get(sq) ?? sq + 1000;
                const dragging = dragFrom === sq;
                return (
                  <div
                    key={id}
                    ref={(el) => {
                      if (el) pieceEls.current.set(id, el);
                      else pieceEls.current.delete(id);
                    }}
                    className={`g-chess-piece ${dragging ? 'drag' : ''} ${colorOf(pc) === game.pos.turn && humanTurn ? 'own' : ''}`}
                    style={{ transform: `translate(${colOf(sq) * 100}%, ${rowOf(sq) * 100}%)` }}
                  >
                    <Piece piece={pc} />
                  </div>
                );
              })}
              {promo && (
                <div className="g-chess-promo" role="dialog" aria-label="Promote to">
                  <span>promote to</span>
                  <div>
                    {[QUEEN, ROOK, BISHOP, KNIGHT].map((t) => (
                      <button key={t} type="button" onClick={() => commit(findMove(game.legal, promo.from, promo.to, t)!)} aria-label={['', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king'][t]}>
                        <Piece piece={t | game.pos.turn} />
                      </button>
                    ))}
                  </div>
                  <button type="button" className="g-chess-cancel" onClick={() => setPromo(null)}>
                    cancel
                  </button>
                </div>
              )}
            </div>
            <aside className="g-chess-panel" style={wide ? { width: panelW, height: boardPx } : { height: panelH, width: boardPx }}>
              <div className="g-chess-tools">
                <span className="g-chess-mode">{cfg.current.mode === 'cpu' ? `vs computer · ${LEVELS[cfg.current.level]}` : 'two players'}</span>
                <button type="button" className="g-chess-flip" onClick={() => setFlipped((f) => !f)} aria-label="Flip board" title="Flip board (F)">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M7 4v13M3.5 13.5L7 17l3.5-3.5M17 20V7M13.5 10.5L17 7l3.5 3.5" />
                  </svg>
                </button>
              </div>
              <ol ref={listRef} className="g-chess-moves" aria-label="Moves">
                {rows.length === 0 && <li className="g-chess-empty">{cfg.current.mode === 'cpu' && cfg.current.color === BLACK ? 'white opens.' : 'white to open.'}</li>}
                {rows.map((r) => (
                  <li key={r.n}>
                    <em>{r.n}.</em>
                    <b className={r.b === undefined && r.n === rows.length ? 'cur' : ''}>{r.w}</b>
                    <b className={r.b !== undefined && r.n === rows.length ? 'cur' : ''}>{r.b ?? ''}</b>
                  </li>
                ))}
              </ol>
            </aside>
          </div>
        </>
      )}
      {phase === 'setup' && <Setup onStart={begin} />}
    </div>
  );
}

function toFenOf(g: ChessGame) {
  // The start position is the only game state without a recorded fen.
  return g.history.length ? g.history[g.history.length - 1].fen : 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
}
