import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { GameShell, LEVEL_NAMES, PLAY_MODES, Segmented, defineSetting, getSetting, levelIndex, levelLabel, levelOptions, modeOptions, sfx, useCanvas, useGameLoop, useKeys, useOnline, useSetting, useShell } from '../../kit';
import type { GameProps } from '../../types';
import { BLACK, RED, bestMove, colOf, colorOf, count, isKing, movesFrom, newGame, play, rowOf, sq, type Board, type Color, type Game as CheckersGame, type Level, type Move } from './checkers.ts';
import { meta } from './meta';
import type { AiReply, AiRequest } from './worker.ts';
import './checkers.css';

const MODE = defineSetting('checkers:mode', PLAY_MODES, 'cpu');
const LEVEL = defineSetting('checkers:level', LEVEL_NAMES, 'normal');
const HUMAN: Color = RED;
const STEP_MS = 190;
const MIN_THINK_MS = 420;
const NAMES: Record<Color, string> = { [RED]: 'Red', [BLACK]: 'Black' };
const SIDE_W = 176;
// Online, the host plays Red in odd rounds and Black in even ones, so the first move alternates.
const onlineColorOf = (seat: number, round: number): Color => ((round % 2 === 1) === (seat === 0) ? RED : BLACK);
const seatOfColor = (color: Color, round: number) => (onlineColorOf(0, round) === color ? 0 : 1);
const frameU = (el: HTMLElement) => {
  const k = el.offsetWidth ? el.getBoundingClientRect().width / el.offsetWidth : 1;
  return k > 0.2 && k < 0.99 ? Math.min(2, 1 / k) : 1;
};
type GameTimer = { remaining: number; fn: () => void };
type PendingAI = { game: CheckersGame; id: number; started: number; move: Move | null; ready: boolean; scheduled: boolean; cleanup?: () => void };

function useGameTimers() {
  const timers = useRef<GameTimer[]>([]);
  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push({ remaining: Math.max(0, ms) / 1000, fn });
  }, []);
  useGameLoop((dt) => {
    const due: GameTimer[] = [];
    timers.current = timers.current.filter((timer) => {
      timer.remaining -= dt;
      if (timer.remaining <= 0) {
        due.push(timer);
        return false;
      }
      return true;
    });
    due.forEach((timer) => timer.fn());
  });
  useEffect(() => () => {
    timers.current = [];
  }, []);
  return later;
}

export default function Game({ compact, onExit, roomCode }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} roomCode={roomCode} lowerIsBetter formatScore={(n) => `${n} ${n === 1 ? 'move' : 'moves'}`} setup={<Setup />}>
      <Checkers />
    </GameShell>
  );
}

function Setup() {
  const [mode, setMode] = useSetting(MODE);
  const [level, setLevel] = useSetting(LEVEL);
  return (
    <>
      <Segmented label="Mode" value={mode} options={modeOptions} onChange={setMode} />
      {mode === 'cpu' && <Segmented label="Difficulty" value={level} options={levelOptions} onChange={setLevel} />}
    </>
  );
}

type Anim = { piece: number; at: number; path: number[]; captured: number[]; step: number; move: Move };
type Drag = { pid: number; from: number; moved: boolean };

function Checkers() {
  const shell = useShell();
  const online = useOnline();
  const { ref: stageRef, size } = useCanvas<HTMLDivElement>();
  const boardRef = useRef<HTMLDivElement | null>(null);
  const moverRef = useRef<HTMLDivElement | null>(null);
  const [game, setGame] = useState<CheckersGame>(() => newGame());
  const [vis, setVis] = useState<Board>(game.board);
  const [anim, setAnim] = useState<Anim | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [thinking, setThinking] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [gone, setGone] = useState<number[]>([]);
  const [nope, setNope] = useState<number | null>(null);
  const drag = useRef<Drag | null>(null);
  const [mode] = useSetting(MODE);
  const [levelName] = useSetting(LEVEL);
  const cfg = useRef<{ mode: typeof mode; level: Level }>({ mode: getSetting(MODE), level: levelIndex(getSetting(LEVEL)) });
  const worker = useRef<Worker | null>(null);
  const reqId = useRef(0);
  const aiTask = useRef<PendingAI | null>(null);
  const [aiRevision, setAiRevision] = useState(0);
  const statusRef = useRef(shell.status);
  statusRef.current = shell.status;
  const gameRef = useRef(game);
  gameRef.current = game;
  const gameOverScheduled = useRef<CheckersGame | null>(null);
  const commitRef = useRef<(move: Move) => void>(() => {});
  const later = useGameTimers();

  const lastMove = game.history.at(-1);
  // The color this screen plays, or null when both sides share it (pass and play).
  const myColor: Color | null = online ? onlineColorOf(online.seat, online.round) : cfg.current.mode === 'cpu' ? HUMAN : null;
  const myColorRef = useRef(myColor);
  myColorRef.current = myColor;
  const flip = myColor === BLACK;
  const view = (i: number) => (flip ? 63 - i : i);
  const humanTurn = game.status === 'playing' && !anim && (myColor === null || game.turn === myColor);
  const fromSquares = useMemo(() => new Set(game.legal.map((m) => m.from)), [game.legal]);
  const targets = useMemo(() => (sel === null ? new Map<number, Move>() : new Map(movesFrom(game.legal, sel).map((m) => [m.to, m]))), [sel, game.legal]);

  // Commit animates the piece along its path, removing captured men as it passes, then updates the rules state.
  const commit = useCallback(
    (m: Move) => {
      setSel(null);
      setCursor(null);
      const piece = game.board[m.from];
      const board = new Uint8Array(game.board);
      board[m.from] = 0;
      setVis(board);
      setAnim({ piece, at: m.from, path: m.path, captured: m.captured, step: 0, move: m });
      sfx.play(m.captured.length ? 'hit' : 'tick', 0.9);
      m.path.forEach((square, i) => {
        later(() => {
          setAnim((a) => (a ? { ...a, at: square, step: i + 1 } : a));
          if (m.captured[i] !== undefined) {
            const cap = m.captured[i];
            setGone((g) => [...g, cap]);
            later(() => {
              setVis((b) => {
                const nb = new Uint8Array(b);
                nb[cap] = 0;
                return nb;
              });
              setGone((g) => g.filter((x) => x !== cap));
            }, STEP_MS * 0.6);
            sfx.play('hit', 1.3 + i * 0.15);
          }
        }, 30 + i * STEP_MS);
      });
      later(() => {
        const next = play(game, m);
        setGame(next);
        setVis(next.board);
        setAnim(null);
        setGone([]);
        if (isKing(next.board[m.to]) && !isKing(piece)) sfx.play('coin');
        const mine = myColorRef.current;
        if (next.status !== 'playing') sfx.play(next.status === 'draw' ? 'select' : mine !== null && next.status !== (mine === RED ? 'red' : 'black') ? 'lose' : 'win');
      }, 30 + m.path.length * STEP_MS + 40);
    },
    [game, later],
  );
  commitRef.current = commit;

  // Setup changes made on the Start card apply to the game that is about to begin.
  useEffect(() => {
    if (shell.status !== 'ready') return;
    cfg.current = { mode: online ? '2p' : mode, level: levelIndex(levelName) };
    const g = newGame();
    setGame(g);
    setVis(g.board);
    setAnim(null);
    setSel(null);
    setCursor(null);
    setGone([]);
  }, [mode, levelName, shell.status, online?.seat, online?.round]);

  // The opponent's move. One that arrives while our own move is still animating (the turn hasn't passed yet here,
  // e.g. in a tab that was hidden) waits for it instead of being lost, which would leave both sides waiting.
  const pendingRemote = useRef<{ from: number; move: Move } | null>(null);
  const takeRemote = (from: number, move: Move) => {
    const expected = online ? seatOfColor(gameRef.current.turn, online.round) : -1;
    if (from !== expected || anim) return false;
    const legal = gameRef.current.legal.find((candidate) =>
      candidate.from === move.from && candidate.to === move.to && candidate.path.join() === move.path.join() && candidate.captured.join() === move.captured.join(),
    );
    if (legal) commitRef.current(legal);
    return true;
  };
  const takeRemoteRef = useRef(takeRemote);
  takeRemoteRef.current = takeRemote;
  useEffect(() => online?.onMessage((from, data) => {
    if (!online || from === online.seat || !data || typeof data !== 'object') return;
    const message = data as { game?: unknown; move?: unknown };
    if (message.game !== 'checkers' || !message.move || typeof message.move !== 'object') return;
    const move = message.move as Move;
    if (!Array.isArray(move.path) || !Array.isArray(move.captured)) return;
    if (!takeRemoteRef.current(from, move)) pendingRemote.current = { from, move };
  }), [online?.onMessage, online?.seat]);
  useEffect(() => {
    const pending = pendingRemote.current;
    if (pending && takeRemoteRef.current(pending.from, pending.move)) pendingRemote.current = null;
  }, [game, anim]);

  useEffect(() => {
    let w: Worker | null = null;
    try {
      if (typeof Worker !== 'undefined') w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    } catch {
      w = null;
    }
    worker.current = w;
    return () => {
      aiTask.current?.cleanup?.();
      aiTask.current = null;
      w?.terminate();
      worker.current = null;
    };
  }, []);

  useEffect(() => {
    let task = aiTask.current;
    if (task && (task.game !== game || cfg.current.mode !== 'cpu' || game.status !== 'playing' || game.turn === HUMAN || anim)) {
      task.cleanup?.();
      aiTask.current = null;
      task = null;
    }
    if (shell.status !== 'playing' || cfg.current.mode !== 'cpu' || game.status !== 'playing' || game.turn === HUMAN || anim) return;

    if (!task) {
      const pending: PendingAI = { game, id: ++reqId.current, started: performance.now(), move: null, ready: false, scheduled: false };
      task = pending;
      aiTask.current = pending;
      setThinking(true);
      const receive = (move: Move | null) => {
        if (aiTask.current !== pending || pending.ready) return;
        pending.move = move;
        pending.ready = true;
        setAiRevision((revision) => revision + 1);
      };
      const fallback = () => {
        later(() => {
          if (aiTask.current === pending) receive(bestMove(game.board, game.turn, cfg.current.level));
        }, 30);
      };
      const w = worker.current;
      if (w) {
        const remove = () => {
          w.removeEventListener('message', onMessage);
          w.removeEventListener('error', onError);
          pending.cleanup = undefined;
        };
        const onMessage = (e: MessageEvent<AiReply>) => {
          if (e.data.id !== pending.id || aiTask.current !== pending) return;
          remove();
          receive(e.data.move);
        };
        const onError = () => {
          remove();
          fallback();
        };
        pending.cleanup = remove;
        w.addEventListener('message', onMessage);
        w.addEventListener('error', onError);
        const req: AiRequest = { id: pending.id, board: Array.from(game.board), side: game.turn, level: cfg.current.level };
        w.postMessage(req);
      } else fallback();
    }

    if (task?.ready && !task.scheduled) {
      task.scheduled = true;
      const pending = task;
      later(() => {
        if (aiTask.current !== pending || statusRef.current !== 'playing' || gameRef.current !== pending.game) return;
        pending.cleanup?.();
        aiTask.current = null;
        setThinking(false);
        const legal = pending.move && game.legal.find((x) => x.from === pending.move!.from && x.to === pending.move!.to && x.path.join() === pending.move!.path.join());
        if (legal) commit(legal);
      }, Math.max(0, MIN_THINK_MS - (performance.now() - task.started)));
    }
  }, [game, anim, commit, later, shell.status, aiRevision]);

  useEffect(() => {
    if (game.status === 'playing') {
      gameOverScheduled.current = null;
      return;
    }
    if (shell.status !== 'playing' || gameOverScheduled.current === game) return;
    gameOverScheduled.current = game;
    later(() => {
      if (statusRef.current !== 'playing' || gameRef.current !== game) return;
      const moves = Math.ceil(game.history.length / 2);
      const { mode } = cfg.current;
      if (game.status === 'draw') {
        if (online) online.reportResult(online.round, null);
        shell.gameOver(undefined, { title: 'Draw', detail: `Forty moves without progress after ${moves} moves.` });
      }
      else {
        const winner: Color = game.status === 'red' ? RED : BLACK;
        const winnerSeat = online ? seatOfColor(winner, online.round) : winner === RED ? 0 : 1;
        const winnerName = online?.players.find((player) => player.seat === winnerSeat)?.name ?? NAMES[winner];
        const title = online ? (winnerSeat === online.seat ? 'You Win' : `${winnerName} Wins`) : mode === 'cpu' ? (winner === HUMAN ? 'You Win' : 'Computer Wins') : `${NAMES[winner]} Wins`;
        const left = count(game.board, winner);
        const detail = `${left.men + left.kings} ${left.men + left.kings === 1 ? 'piece' : 'pieces'} left after ${moves} ${moves === 1 ? 'move' : 'moves'}.`;
        if (online) online.reportResult(online.round, winnerSeat);
        shell.gameOver(!online && mode === 'cpu' && winner === HUMAN ? moves : undefined, { title, detail });
      }
    }, 500);
  }, [game, shell.round, shell.status, shell.gameOver, later, online]);

  // Touch frames (phone, iPad) are scaled down; --g-checkers-u grows text and controls back to full size on screen.
  useEffect(() => {
    const el = shell.root.current;
    if (!el || !shell.touch || typeof ResizeObserver === 'undefined') return;
    const measure = () => el.style.setProperty('--g-checkers-u', frameU(el).toFixed(3));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      ro.disconnect();
      el.style.removeProperty('--g-checkers-u');
    };
  }, [shell.touch]);

  // Geometry: a tall stage stacks status, board and counts; a short wide one (the framed laptop window) puts them beside the board.
  const TOP = 44;
  const FOOT = 40;
  const stacked = Math.floor(Math.min(size.w - 24, size.h - TOP - FOOT - 16));
  const besideBoard = Math.floor(Math.min(size.h - 16, size.w - 40 - SIDE_W));
  const beside = besideBoard > stacked + 24;
  const boardPx = Math.max(96, beside ? besideBoard : stacked);
  const rim = Math.round(Math.max(4, Math.min(14, boardPx * 0.026)));
  const gridPx = boardPx - rim * 2;
  const sqPx = gridPx / 8;

  const squareFromEvent = (e: { clientX: number; clientY: number }) => {
    const b = boardRef.current;
    if (!b) return -1;
    const r = b.getBoundingClientRect();
    const col = Math.floor(((e.clientX - r.left) / r.width) * 8);
    const row = Math.floor(((e.clientY - r.top) / r.height) * 8);
    if (col < 0 || col > 7 || row < 0 || row > 7) return -1;
    return view(sq(row, col));
  };
  const place = (i: number) => `translate(${colOf(view(i)) * 100}%, ${rowOf(view(i)) * 100}%)`;

  const tryMove = (from: number, to: number) => {
    const m = movesFrom(game.legal, from).find((x) => x.to === to);
    if (!m) return false;
    if (online) online.send({ game: 'checkers', move: m });
    commit(m);
    return true;
  };

  // A piece of yours that can't move (usually because a capture is forced elsewhere) shakes, and the jumpers light up.
  const refuse = (s: number) => {
    setNope(s);
    sfx.play('blip', 0.5);
    later(() => setNope((n) => (n === s ? null : n)), 450);
  };
  const ownPiece = (s: number) => !!game.board[s] && colorOf(game.board[s]) === game.turn;

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (!humanTurn || e.button > 0) return;
    const s = squareFromEvent(e);
    if (s < 0) return;
    setCursor(null);
    if (fromSquares.has(s)) {
      if (sel !== s) sfx.play('tick', 1.4);
      setSel(s);
      drag.current = { pid: e.pointerId, from: s, moved: false };
      boardRef.current?.setPointerCapture(e.pointerId);
      return;
    }
    if (sel !== null && tryMove(sel, s)) return;
    if (ownPiece(s)) refuse(s);
    setSel(null);
  };
  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const b = boardRef.current;
    if (!d || d.pid !== e.pointerId || !b) return;
    const r = b.getBoundingClientRect();
    const k = b.offsetWidth ? r.width / b.offsetWidth : 1;
    const x = (e.clientX - r.left) / k;
    const y = (e.clientY - r.top) / k;
    if (!d.moved) {
      const hx = colOf(view(d.from)) * sqPx + sqPx / 2;
      const hy = rowOf(view(d.from)) * sqPx + sqPx / 2;
      if (Math.hypot(x - hx, y - hy) < 5) return;
      d.moved = true;
      setDragFrom(d.from);
    }
    const el = b.querySelector<HTMLDivElement>(`[data-sq="${d.from}"]`);
    if (el) el.style.transform = `translate(${x - sqPx / 2}px, ${y - sqPx / 2}px)`;
  };
  const endDrag = (e: RPointerEvent<HTMLDivElement>, cancelled = false) => {
    const d = drag.current;
    if (!d || d.pid !== e.pointerId) return;
    drag.current = null;
    const el = boardRef.current?.querySelector<HTMLDivElement>(`[data-sq="${d.from}"]`);
    if (el) el.style.transform = place(d.from);
    setDragFrom(null);
    if (!d.moved || cancelled) return;
    const to = squareFromEvent(e);
    if (to >= 0 && to !== d.from && !tryMove(d.from, to)) setSel(fromSquares.has(to) ? to : d.from);
  };

  // Keyboard: the first arrow or Enter lands on a piece that can move, then arrows step across the board as seen.
  const firstPick = () => {
    const list = [...fromSquares].sort((x, y) => view(y) - view(x));
    return list[Math.floor((list.length - 1) / 2)] ?? null;
  };
  useKeys((code, e) => {
    const dirs: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1], KeyA: [-1, 0], KeyD: [1, 0], KeyW: [0, -1], KeyS: [0, 1] };
    if (dirs[code]) {
      if (!humanTurn) return;
      const [dx, dy] = flip ? [-dirs[code][0], -dirs[code][1]] : dirs[code];
      const cur = cursor ?? sel;
      if (cur === null) setCursor(firstPick());
      else setCursor(sq(Math.max(0, Math.min(7, rowOf(cur) + dy)), Math.max(0, Math.min(7, colOf(cur) + dx))));
      return;
    }
    if ((code === 'Enter' || code === 'Space') && !e?.repeat && humanTurn) {
      if (cursor === null) {
        setCursor(sel ?? firstPick());
        return;
      }
      if (sel !== null && cursor !== sel && tryMove(sel, cursor)) return;
      if (fromSquares.has(cursor)) {
        sfx.play('tick', 1.4);
        setSel(cursor);
        const first = movesFrom(game.legal, cursor)[0];
        if (first) setCursor(first.to);
      } else {
        if (ownPiece(cursor)) refuse(cursor);
        setSel(null);
      }
    }
    if (code === 'Escape') setSel(null);
  });

  const nameOf = (c: Color) => {
    if (c === myColor && (online || cfg.current.mode === 'cpu')) return 'You';
    if (online) return online.players.find((p) => p.seat === seatOfColor(c, online.round))?.name ?? NAMES[c];
    return cfg.current.mode === 'cpu' ? 'Computer' : NAMES[c];
  };
  const mustJump = game.status === 'playing' && !!game.legal[0]?.captured.length;
  const status = (() => {
    if (game.status === 'draw') return 'Draw';
    if (game.status !== 'playing') return `${nameOf(game.status === 'red' ? RED : BLACK)} ${game.status === (myColor === RED ? 'red' : 'black') ? 'win' : 'wins'}`;
    if (nope !== null && mustJump) return 'You have to jump';
    if (myColor !== null && game.turn !== myColor) return cfg.current.mode === 'cpu' && !online ? 'Thinking' : `${nameOf(game.turn)} to move`;
    const who = myColor !== null ? 'Your move' : `${NAMES[game.turn]} to move`;
    return mustJump ? `${who}, jump` : who;
  })();

  const counts = { [RED]: count(vis, RED), [BLACK]: count(vis, BLACK) } as Record<Color, ReturnType<typeof count>>;
  const near: Color = flip ? BLACK : RED;
  const far: Color = flip ? RED : BLACK;
  const squares = useMemo(() => Array.from({ length: 64 }, (_, i) => i), []);
  const modeLabel = online ? 'Online' : cfg.current.mode === 'cpu' ? levelLabel(LEVEL_NAMES[cfg.current.level]) : 'Pass and Play';
  const side = (c: Color, cls = '') => {
    const n = counts[c];
    const on = game.turn === c && game.status === 'playing';
    return (
      <span className={`g-checkers-side ${c === RED ? 'red' : 'black'} ${on ? 'on' : ''} ${cls}`}>
        <i />
        <span className="g-checkers-who">{nameOf(c)}</span>
        <b>{n.men + n.kings}</b>
      </span>
    );
  };
  const statusEl = (
    <div className={`g-checkers-status ${thinking ? 'busy' : ''} ${nope !== null && mustJump ? 'warn' : ''}`} aria-live="polite">
      {thinking && <span className="g-checkers-dots" aria-hidden="true" />}
      <span>{status}</span>
    </div>
  );

  return (
    <div ref={stageRef} className={`g-checkers-stage ${beside ? 'beside' : 'stacked'}`}>
      {!beside && statusEl}
      <div className="g-checkers-body" style={beside ? undefined : { paddingTop: TOP }}>
        <div className="g-checkers-frame" style={{ width: boardPx, height: boardPx, padding: rim }}>
          <div
            ref={boardRef}
            className={`g-checkers-board ${humanTurn ? 'live' : ''}`}
            style={{ width: gridPx, height: gridPx, ['--g-checkers-sq' as string]: `${sqPx}px` }}
            role="grid"
            aria-label="Checkers board"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={(e) => endDrag(e, true)}
            onLostPointerCapture={(e) => endDrag(e, true)}
            onContextMenu={(e) => e.preventDefault()}
          >
            {squares.map((i) => {
              const darkSq = (rowOf(i) + colOf(i)) % 2 === 1;
              const isLast = !!lastMove && !anim && (lastMove.from === i || lastMove.path.includes(i));
              const hint = targets.has(i);
              const canPick = humanTurn && fromSquares.has(i) && sel === null;
              const v = view(i);
              const cls = ['g-checkers-sq', darkSq ? 'dark' : 'light', sel === i ? 'sel' : '', isLast ? 'last' : '', cursor === i ? 'cursor' : '', hint ? 'hint' : '', canPick ? (mustJump ? 'pick jump' : 'pick') : '', canPick && nope !== null && mustJump ? 'flash' : ''].join(' ');
              return <div key={i} className={cls} style={{ left: `${colOf(v) * 12.5}%`, top: `${rowOf(v) * 12.5}%` }} role="gridcell" />;
            })}
            {squares.map((i) => {
              const p = vis[i];
              if (!p) return null;
              const c = colorOf(p);
              return (
                <div
                  key={i}
                  data-sq={i}
                  className={`g-checkers-piece ${c === RED ? 'red' : 'black'} ${isKing(p) ? 'king' : ''} ${dragFrom === i ? 'drag' : ''} ${gone.includes(i) ? 'gone' : ''} ${nope === i ? 'nope' : ''} ${sel === i && dragFrom !== i ? 'up' : ''}`}
                  style={{ transform: place(i) }}
                >
                  <Disc king={isKing(p)} />
                </div>
              );
            })}
            {anim && (
              <div ref={moverRef} className={`g-checkers-piece mover ${colorOf(anim.piece) === RED ? 'red' : 'black'} ${isKing(anim.piece) ? 'king' : ''}`} style={{ transform: place(anim.at) }}>
                <Disc key={anim.step} king={isKing(anim.piece)} hop={anim.captured.length > 0 && anim.step > 0} />
              </div>
            )}
          </div>
        </div>
        {beside ? (
          <div className="g-checkers-panel" style={{ width: SIDE_W }}>
            {side(far, 'far')}
            {statusEl}
            {side(near, 'near')}
            <span className="g-checkers-mode">{modeLabel}</span>
          </div>
        ) : (
          <div className="g-checkers-foot" style={{ width: boardPx }}>
            {side(near)}
            <span className="g-checkers-mode">{modeLabel}</span>
            {side(far, 'end')}
          </div>
        )}
      </div>
    </div>
  );
}

function Disc({ king, hop = false }: { king: boolean; hop?: boolean }) {
  return (
    <span className={`g-checkers-disc ${hop ? 'hop' : ''}`}>
      <Crown show={king} />
    </span>
  );
}

function Crown({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 16h14l1-8-4.2 3L12 5l-3.8 6L4 8z" fill="currentColor" />
    </svg>
  );
}
