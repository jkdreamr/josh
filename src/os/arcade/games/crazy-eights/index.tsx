import { useEffect, useLayoutEffect, useReducer, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { GameShell, LEVEL_NAMES, Segmented, defineSetting, levelIndex, levelOptions, sfx, useGameLoop, useKeys, useOnline, useSetting, useShell } from '../../kit';
import type { GameProps } from '../../types';
import { decide, type Level } from './ai.ts';
import { applyMut, isLegal, legalMoves, newMatch, nextHand, observe, parseMove, rankLabel, rankOf, suitLabel, suitOf, top, viewMoves, type Card, type Ev, type Move, type State, type View } from './logic.ts';
import { meta } from './meta';
import type { AiReply, AiRequest } from './worker.ts';
import { tableLayout } from './layout.ts';
import './crazy-eights.css';

const RIVALS = defineSetting('crazy-eights:rivals', ['1', '2', '3'] as const, '2');
const LEVEL = defineSetting('crazy-eights:level', LEVEL_NAMES, 'normal');
const BOT_LEVEL = defineSetting('crazy-eights:bot-level', LEVEL_NAMES, 'normal');
const rivalOptions = [
  ['1', '1 Rival'],
  ['2', '2 Rivals'],
  ['3', '3 Rivals'],
] as const;
const CPU_NAMES = ['Mabel', 'Otis', 'Juno'];
const SYMBOLS = ['\u2660', '\u2665', '\u2666', '\u2663'];
/** Spades, hearts, clubs, diamonds: suits alternate colors in your hand. */
const SUIT_ORDER = [0, 1, 3, 2];
const DEAL_GAP = 0.075;
const HARD_MS = 380;

export default function Game({ compact, onExit, roomCode }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} roomCode={roomCode} setup={<Setup />} hostSetup={<OnlineSetup />} botNames={CPU_NAMES} defaultBots={1}>
      <Table />
    </GameShell>
  );
}

function Setup() {
  const [rivals, setRivals] = useSetting(RIVALS);
  const [level, setLevel] = useSetting(LEVEL);
  return (
    <>
      <Segmented label="Rivals" value={rivals} options={rivalOptions} onChange={setRivals} />
      <Segmented label="Difficulty" value={level} options={levelOptions} onChange={setLevel} />
    </>
  );
}

/** Online, the host picks how well the bots play (the host's game drives them). */
function OnlineSetup() {
  const online = useOnline();
  const [level, setLevel] = useSetting(BOT_LEVEL);
  if (!online?.isHost || !online.bots.length) return null;
  return <Segmented label="Bot Level" value={level} options={levelOptions} onChange={setLevel} />;
}

type SeatInfo = { name: string; cpu: boolean; left: boolean };
type Seat = SeatInfo & { level: Level; room: number };
type Match = { s: State; seats: Seat[]; me: number; key: string; seq: number; started: boolean };
type Tbl = { v: View; seats: SeatInfo[]; ev: Ev[]; seq: number; key: string };
type Think = { id: number; turn: string; at: number; move: Move | null };

const seatInfo = (seats: Seat[]): SeatInfo[] => seats.map(({ name, cpu, left }) => ({ name, cpu, left }));
const sortKey = (c: Card) => (rankOf(c) === 8 ? 100 + SUIT_ORDER.indexOf(suitOf(c)) : SUIT_ORDER.indexOf(suitOf(c)) * 20 + (rankOf(c) === 1 ? 14 : rankOf(c)));
const frameU = (el: HTMLElement, touch: boolean) => {
  const k = el.offsetWidth ? el.getBoundingClientRect().width / el.offsetWidth : 1;
  return touch && k > 0.2 && k < 0.99 ? Math.ceil(Math.min(2, 1 / k) * 1000) / 1000 : 1;
};
const sortHand = (hand: readonly Card[]) => hand.slice().sort((a, b) => sortKey(a) - sortKey(b));
const tilt = (c: Card) => ((c * 37) % 11) - 5;
const fmtSuit = (s: number) => `${SYMBOLS[s]} ${suitLabel(s)}`;
const turnKey = (s: State) => `${s.handNo}:${s.turn}:${s.pile.length}:${s.deck.length}:${s.drew ?? -1}:${s.pending}:${s.hands[s.turn].length}`;

function Table() {
  const shell = useShell();
  const online = useOnline();
  const keys = useKeys();
  const [rivals] = useSetting(RIVALS);
  const [levelName] = useSetting(LEVEL);
  const [botLevelName] = useSetting(BOT_LEVEL);
  const host = !online || online.isHost;
  const m = useRef<Match | null>(null);
  const [tbl, setTbl] = useState<Tbl | null>(null);
  const tblRef = useRef<Tbl | null>(null);
  tblRef.current = tbl;
  const think = useRef<Think | null>(null);
  const reqId = useRef(0);
  const worker = useRef<Worker | null>(null);
  const lock = useRef(0);
  const autoPass = useRef(0);
  const handTimer = useRef(0);
  const ended = useRef('');
  const sent = useRef(0);
  const hello = useRef(0);
  const [, poke] = useReducer((x: number) => x + 1, 0);
  const [picker, setPicker] = useState<Card | null>(null);
  const [toast, setToast] = useState<{ text: string; id: number; tone: string } | null>(null);
  const [hint, setHint] = useState<{ text: string; id: number } | null>(null);
  const [shake, setShake] = useState<{ card: Card; id: number } | null>(null);
  const [sel, setSel] = useState(-1);
  const [dealing, setDealing] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [size, setSize] = useState({ w: 640, h: 420 });
  // In the phone and iPad frames the whole screen is scaled down; u grows text and controls back to their real size.
  const [u, setU] = useState(1);
  const [chrome, setChrome] = useState({ nameH: 42, barH: 44 });
  const tableRef = useRef<HTMLDivElement>(null);
  const lastRect = useRef<DOMRect | null>(null);
  const prevHand = useRef<Set<Card>>(new Set());
  const prevCounts = useRef<number[]>([]);
  const prevKey = useRef('');
  const tick = useRef(0);

  // The AI thinks off the main thread so the table never stalls.
  useEffect(() => {
    let w: Worker | null = null;
    try {
      if (typeof Worker !== 'undefined') w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    } catch {
      w = null;
    }
    const onReply = (e: MessageEvent<AiReply>) => {
      const t = think.current;
      if (t && e.data.id === t.id) t.move = e.data.move;
    };
    w?.addEventListener('message', onReply);
    worker.current = w;
    return () => {
      w?.removeEventListener('message', onReply);
      w?.terminate();
      worker.current = null;
    };
  }, []);

  useEffect(() => {
    const el = tableRef.current;
    if (!el) return;
    const measure = () => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
      setU(frameU(el, shell.touch));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    measure();
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [shell.touch]);

  // The top rival's label and your bar set how much height is left for the cards.
  useLayoutEffect(() => {
    const el = tableRef.current;
    if (!el) return;
    const name = el.querySelector<HTMLElement>('.g-crazy-eights-seat.pos-top .g-crazy-eights-name');
    const bar = el.querySelector<HTMLElement>('.g-crazy-eights-bar');
    const nameH = name ? name.offsetHeight : chrome.nameH;
    const barH = bar ? bar.offsetHeight : chrome.barH;
    if (Math.abs(nameH - chrome.nameH) > 0.5 || Math.abs(barH - chrome.barH) > 0.5) setChrome({ nameH, barH });
    // The frame can still be animating in when the table first measures, and that never resizes the table, so check again on every render.
    const next = frameU(el, shell.touch);
    if (Math.abs(next - u) > 0.01) setU(next);
  });

  function nameFor(seat: number) {
    if (!online) return 'You';
    return online.players.find((p) => p.seat === seat)?.name ?? online.bots.find((b) => b.seat === seat)?.name ?? `Player ${seat + 1}`;
  }

  function reset() {
    think.current = null;
    ended.current = '';
    setPicker(null);
    setShowSummary(false);
    const seed = (Math.random() * 4294967296) >>> 0;
    if (online) {
      if (!online.isHost) return;
      const room = [...new Set([...online.players.map((p) => p.seat), ...online.bots.map((b) => b.seat)])].sort((a, b) => a - b);
      const bots = new Set(online.bots.map((b) => b.seat));
      const level = levelIndex(botLevelName);
      const seats: Seat[] = room.map((r) => ({ name: nameFor(r), cpu: bots.has(r), left: false, level, room: r }));
      m.current = { s: newMatch(Math.max(2, seats.length), seed), seats, me: room.indexOf(online.seat), key: `${online.round}:${seed}`, seq: 0, started: false };
      return;
    }
    const n = Number(rivals) + 1;
    const level = levelIndex(levelName);
    const seats: Seat[] = Array.from({ length: n }, (_, i) => (i === 0 ? { name: 'You', cpu: false, left: false, level, room: 0 } : { name: CPU_NAMES[i - 1], cpu: true, left: false, level, room: i }));
    m.current = { s: newMatch(n, seed), seats, me: 0, key: `solo:${seed}`, seq: 0, started: false };
  }

  // A new match for each start, and online for each room round, with the people and bots playing it.
  useEffect(() => {
    if (shell.status === 'ready' || (host && (!m.current || (online && !m.current.key.startsWith(`${online.round}:`))))) {
      reset();
      setTbl(null);
    }
  }, [rivals, levelName, shell.status === 'ready', online?.round, host]);

  /** Shows the table as it is now and, online, sends each person only what they may see. */
  function publish(target?: number) {
    const match = m.current;
    if (!match) return;
    if (target === undefined) {
      match.seq++;
      setTbl({ v: observe(match.s, match.me), seats: seatInfo(match.seats), ev: match.s.log.slice(), seq: match.seq, key: match.key });
    }
    if (!online?.isHost) return;
    match.seats.forEach((seat, i) => {
      if (seat.cpu || i === match.me || (target !== undefined && seat.room !== target)) return;
      online.send({ game: 'crazy-eights', type: 'state', key: match.key, seq: match.seq, seats: seatInfo(match.seats), view: observe(match.s, i), ev: match.s.log }, { to: seat.room });
    });
  }

  function hostMove(p: number, move: Move) {
    const match = m.current;
    if (!match) return false;
    const s = match.s;
    s.log = [];
    if (!applyMut(s, p, move)) return false;
    think.current = null;
    autoPass.current = 0;
    lock.current = performance.now() + (s.log.some((e) => e.k === 'play') ? 420 : 300);
    if (s.phase !== 'play') handTimer.current = performance.now();
    publish();
    return true;
  }

  // Someone who leaves mid-match hands their seat to a bot, which plays it out from what that seat could see.
  useEffect(() => {
    const match = m.current;
    if (!online?.isHost || !match || !match.started) return;
    let changed = false;
    for (const seat of match.seats) {
      if (seat.cpu || seat.room === online.seat || online.players.some((p) => p.seat === seat.room)) continue;
      seat.cpu = true;
      seat.left = true;
      seat.level = 1;
      changed = true;
    }
    if (changed) publish();
  }, [online?.players]);

  useEffect(() => online?.onMessage((from, data) => {
    if (!online || from === online.seat || !data || typeof data !== 'object') return;
    const msg = data as { game?: unknown; type?: unknown; key?: unknown; seq?: unknown; seats?: unknown; view?: unknown; ev?: unknown; move?: unknown };
    if (msg.game !== 'crazy-eights') return;
    if (online.isHost) {
      const match = m.current;
      if (!match) return;
      const i = match.seats.findIndex((x) => x.room === from);
      if (i < 0 || match.seats[i].cpu) return;
      if (msg.type === 'hello') {
        if (match.started) publish(from);
        return;
      }
      if (msg.type === 'move') {
        const move = parseMove(msg.move);
        if (!move || match.s.phase !== 'play' || !hostMove(i, move)) publish(from);
      }
      return;
    }
    if (from !== 0 || msg.type !== 'state' || typeof msg.key !== 'string' || typeof msg.seq !== 'number' || !msg.view || !Array.isArray(msg.seats)) return;
    const cur = tblRef.current;
    if (cur && cur.key === msg.key && cur.seq >= msg.seq) {
      if (sent.current > 0) {
        sent.current = 0;
        poke();
      }
      return;
    }
    sent.current = 0;
    setTbl({ v: msg.view as View, seats: msg.seats as SeatInfo[], ev: Array.isArray(msg.ev) ? (msg.ev as Ev[]) : [], seq: msg.seq, key: msg.key });
  }), [online?.onMessage, online?.seat, online?.isHost]);

  // Sounds, banners and the deal for each change at the table.
  useEffect(() => {
    if (!tbl) return;
    const { v, ev, seats } = tbl;
    const name = (p: number) => (p === v.me ? 'you' : seats[p]?.name ?? 'someone');
    for (const e of ev) {
      if (e.k === 'deal') {
        setDealing(true);
        lock.current = Math.max(lock.current, performance.now() + ((v.counts.reduce((a, b) => a + b, 0) + 1) * DEAL_GAP + 0.5) * 1000);
        sfx.play('tick', 0.8);
      } else if (e.k === 'play') {
        const r = rankOf(e.card);
        if (r === 8) {
          sfx.play('coin');
          say(`${fmtSuit(e.suit)}`, 'suit');
        } else if (r === 2) {
          sfx.play('hit', 1.2);
          say(`+${v.pending || 2}`, 'two');
        } else sfx.play('blip', 0.9 + (r % 5) * 0.06);
      } else if (e.k === 'skip') say(e.p === v.me ? 'you are skipped' : `${name(e.p)} is skipped`, 'skip');
      else if (e.k === 'reverse') {
        sfx.play('select');
        say('reverse', 'reverse');
      } else if (e.k === 'draw') sfx.play('tick', e.forced ? 0.7 : 1.1);
      else if (e.k === 'out') sfx.play(e.p === v.me ? 'win' : 'lose');
    }
    if (v.phase === 'play') setShowSummary(false);
    setSel((s) => Math.min(s, v.hand.length - 1));
  }, [tbl?.seq, tbl?.key]);

  function say(text: string, tone: string) {
    setToast({ text, tone, id: ++tick.current });
  }

  // Play ends the solo match on the shell's Game Over card, and online every person reports the same winner.
  useEffect(() => {
    if (!tbl || tbl.v.phase !== 'match-over' || ended.current === tbl.key) return;
    ended.current = tbl.key;
    const { v, seats } = tbl;
    const winner = v.winner ?? 0;
    const id = window.setTimeout(() => {
      const order = v.scores.map((score, i) => ({ score, name: seats[i]?.name ?? '' })).sort((a, b) => b.score - a.score);
      const detail = order.map((o) => `${o.name} ${o.score}`).join(', ');
      if (online) {
        const match = m.current;
        const winnerSeat = online.isHost && match ? match.seats[winner].room : null;
        // Guests learn the winner's seat from the host's seat list order: seats are listed in room order.
        const roomSeats = [...new Set([...online.players.map((p) => p.seat), ...online.bots.map((b) => b.seat)])].sort((a, b) => a - b);
        online.reportResult(online.round, winnerSeat ?? roomSeats[winner] ?? null);
      }
      shell.gameOver(v.scores[v.me], { title: winner === v.me ? 'You Win' : `${seats[winner]?.name ?? 'Someone'} Wins`, detail: `${detail}.` });
    }, 2600);
    return () => window.clearTimeout(id);
  }, [tbl?.v.phase, tbl?.key]);

  useEffect(() => {
    if (tbl) shell.setScore(tbl.v.scores[tbl.v.me]);
  }, [tbl?.v.scores[tbl.v.me]]);

  // Timers run on the wall clock, like the card animations, so a slow frame never holds the table up.
  useGameLoop(() => {
    const now = performance.now();
    const locked = now < lock.current;
    if (dealing && !locked) setDealing(false);
    if (!host) {
      // A guest asks the host for the table until it arrives, and again if a move goes unanswered.
      if (online && (!tblRef.current || (sent.current > 0 && now - sent.current > 2500)) && now > hello.current) {
        hello.current = now + 1500;
        sent.current = 0;
        poke();
        online.send({ game: 'crazy-eights', type: 'hello' });
      }
      return;
    }
    const match = m.current;
    if (!match) return;
    if (!match.started) {
      match.started = true;
      publish();
      return;
    }
    const s = match.s;
    if (s.phase === 'hand-over') {
      if (now - handTimer.current > 1100 && !showSummary) setShowSummary(true);
      if (online && now - handTimer.current > 9000) startNextHand();
      return;
    }
    if (s.phase !== 'play' || locked) return;
    const p = s.turn;
    const seat = match.seats[p];
    if (!seat.cpu) {
      const moves = legalMoves(s, p);
      if (moves.length === 1 && moves[0].t === 'pass' && s.drew === null) {
        if (!autoPass.current) autoPass.current = now;
        else if (now - autoPass.current > 1300) hostMove(p, moves[0]);
      }
      return;
    }
    const key = turnKey(s);
    let t = think.current;
    if (!t || t.turn !== key) {
      const id = ++reqId.current;
      t = think.current = { id, turn: key, at: now + (seat.level === 0 ? 500 : 620) + Math.random() * 300, move: null };
      const req: AiRequest = { id, view: observe(s, p), level: seat.level, seed: (Math.random() * 4294967296) >>> 0, ms: HARD_MS };
      if (worker.current) worker.current.postMessage(req);
      else {
        const rnd = Math.random;
        t.move = decide(req.view, req.level, rnd, { ms: 120 });
      }
    }
    if (now < t.at || !t.move) return;
    const move = isLegal(s, p, t.move) ? t.move : legalMoves(s, p)[0];
    if (move) hostMove(p, move);
  });

  function startNextHand() {
    const match = m.current;
    if (!match || match.s.phase !== 'hand-over') return;
    match.s = nextHand(match.s);
    setShowSummary(false);
    publish();
  }

  useEffect(() => {
    if (tbl?.v.phase === 'hand-over' && !host) {
      const id = window.setTimeout(() => setShowSummary(true), 1100);
      return () => window.clearTimeout(id);
    }
  }, [tbl?.v.phase, tbl?.v.handNo, host]);

  const v = tbl?.v ?? null;
  const myTurn = !!v && v.phase === 'play' && v.turn === v.me && shell.status === 'playing' && !dealing;
  const moves = myTurn && v ? viewMoves(v) : [];
  const waiting = !host && sent.current > 0;

  function commit(move: Move) {
    if (!v || !myTurn || waiting) return;
    if (host) {
      if (!hostMove(v.me, move)) sfx.play('hit');
      return;
    }
    if (!moves.some((x) => x.t === move.t && (x.t !== 'play' || (move.t === 'play' && x.card === move.card && x.suit === move.suit)))) return;
    sent.current = performance.now();
    poke();
    online?.send({ game: 'crazy-eights', type: 'move', move });
  }

  function reject(card: Card, text: string) {
    sfx.play('hit', 0.6);
    setShake({ card, id: ++tick.current });
    setHint({ text, id: tick.current });
  }

  function tryPlay(card: Card, rect?: DOMRect) {
    if (!v) return;
    if (!myTurn) return reject(card, v.phase === 'play' ? 'not your turn yet' : 'hang on');
    const fits = moves.some((x) => x.t === 'play' && x.card === card);
    if (!fits) {
      if (v.pending > 0) return reject(card, `only a two stops the draw ${v.pending}`);
      if (v.drew !== null && v.drew >= 0) return reject(card, 'play the card you drew, or keep it');
      return reject(card, `match ${suitLabel(v.suit).toLowerCase()} or a ${rankLabel(top(v)).toLowerCase()}, or play an eight`);
    }
    lastRect.current = rect ?? null;
    if (rankOf(card) === 8) {
      setPicker(card);
      return;
    }
    commit({ t: 'play', card });
  }

  const canDraw = moves.some((x) => x.t === 'draw');
  const canKeep = !!v && v.drew !== null && v.drew >= 0 && moves.some((x) => x.t === 'pass');
  const hand = v ? sortHand(v.hand) : [];

  useKeys((code) => {
    if (shell.status !== 'playing' || !v) return;
    if (picker !== null) {
      const i = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(code);
      if (i >= 0) {
        setPicker(null);
        commit({ t: 'play', card: picker, suit: i });
      }
      return;
    }
    if (code === 'ArrowLeft' || code === 'KeyA') setSel((s) => (hand.length ? (s <= 0 ? hand.length - 1 : s - 1) : -1));
    else if (code === 'ArrowRight' || code === 'KeyD') setSel((s) => (hand.length ? (s + 1) % hand.length : -1));
    else if ((code === 'Enter' || code === 'Space') && sel >= 0 && hand[sel] !== undefined) tryPlay(hand[sel]);
    else if (code === 'ArrowUp' || code === 'KeyW') {
      if (canDraw) commit({ t: 'draw' });
      else if (canKeep) commit({ t: 'pass' });
    }
  });

  // Each card that just arrived flies in from where it came: the deck, a rival's seat, or where you let go of it.
  useLayoutEffect(() => {
    const root = tableRef.current;
    if (!root || !v) return;
    const base = root.getBoundingClientRect();
    const scale = root.offsetWidth ? base.width / root.offsetWidth : 1;
    root.querySelectorAll<HTMLElement>('[data-fly]').forEach((el) => {
      const fly = el.dataset.fly!;
      if (el.dataset.done === fly) return;
      el.dataset.done = fly;
      const [from, delay, flip] = fly.split('|').slice(1);
      const src = from === 'mine' ? lastRect.current : root.querySelector(`[data-anchor="${from}"]`)?.getBoundingClientRect();
      if (!src) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--fx', `${(src.left + src.width / 2 - r.left - r.width / 2) / scale}px`);
      el.style.setProperty('--fy', `${(src.top + src.height / 2 - r.top - r.height / 2) / scale}px`);
      el.style.setProperty('--fs', from === 'mine' ? '1' : from === 'deck' ? '0.9' : '0.55');
      el.style.animation = 'none';
      void el.offsetWidth;
      el.style.animation = `g-crazy-eights-${flip === '1' ? 'flip' : 'fly'} ${from === 'mine' ? 260 : 420}ms cubic-bezier(0.2, 0.75, 0.25, 1) ${delay}ms both`;
    });
    prevHand.current = new Set(v.hand);
    prevCounts.current = v.counts.slice();
    prevKey.current = `${tbl!.key}:${v.handNo}`;
  }, [tbl?.seq, tbl?.key]);

  const paused = shell.status !== 'playing';
  if (!v || !tbl) {
    return (
      <div ref={tableRef} className="g-crazy-eights-table">
        <div className="g-crazy-eights-wait">{online && !host ? 'waiting for the deal' : ''}</div>
      </div>
    );
  }

  const n = v.n;
  const fresh = prevKey.current !== `${tbl.key}:${v.handNo}`;
  const dealt = tbl.ev.some((e) => e.k === 'deal');
  const played = tbl.ev.find((e): e is Extract<Ev, { k: 'play' }> => e.k === 'play');
  const seq = tbl.seq;
  const layout = tableLayout({ w: size.w, h: size.h, n, online: !!online, nameH: chrome.nameH, barH: chrome.barH });
  const { short, cw, ch } = layout;
  const rel = (i: number) => (i - v.me + n) % n;
  const posOf = (i: number) => {
    const r = rel(i);
    if (n === 2) return 'top';
    if (n === 3) return r === 1 ? 'left' : 'right';
    return ['', 'left', 'top', 'right'][r];
  };
  const dealOrder = (i: number) => (i - v.dealer - 1 + n) % n;
  const dealDelay = (round: number, i: number) => Math.round((round * n + dealOrder(i)) * DEAL_GAP * 1000);
  const playable = new Set(moves.flatMap((x) => (x.t === 'play' ? [x.card] : [])));

  // The fan: as wide as the table allows, overlapping more as the hand grows, with a gentle arc.
  const k = hand.length;
  const handW = short ? size.w - Math.round(cw * 2.45 + 28) : size.w;
  const room = handW - 24;
  const gap = k > 1 ? Math.min(cw * 0.72, (room - cw) / (k - 1)) : 0;
  const x0 = (handW - (cw + gap * (k - 1))) / 2;
  const arc = Math.min(9, k * 1.1);

  const topCard = top(v);
  const pileShown = v.pile.slice(-4);
  const turnName = v.turn === v.me ? 'you' : tbl.seats[v.turn]?.name ?? '';
  let status = '';
  if (v.phase === 'play') {
    if (dealing) status = 'dealing';
    else if (v.turn === v.me) {
      if (v.pending > 0) status = moves.some((x) => x.t === 'play') ? `stack a two or draw ${v.pending}` : `draw ${v.pending}`;
      else if (canKeep) status = 'play the card you drew, or keep it';
      else if (playable.size) status = 'your turn';
      else if (canDraw) status = 'nothing fits, draw a card';
      else status = 'no moves, passing';
    } else status = `${turnName} is up`;
  }

  return (
    <div
      ref={tableRef}
      className={['g-crazy-eights-table', `n-${n}`, short ? 'is-short' : '', online ? 'is-online' : '', shell.touch ? 'is-touch' : '', !short && size.w < 560 ? 'is-narrow' : '', paused ? 'is-paused' : '', myTurn ? 'is-mine' : ''].join(' ')}
      style={{ '--cw': `${cw}px`, '--ch': `${ch}px`, '--g-crazy-eights-u': u } as CSSProperties}
    >
      <div className="g-crazy-eights-rivals">
      {tbl.seats.map((seat, i) => {
        if (i === v.me) return null;
        const count = v.counts[i];
        const shown = Math.min(count, 10);
        const prev = fresh ? 0 : Math.min(prevCounts.current[i] ?? 0, 10);
        return (
          <div
            key={i}
            className={`g-crazy-eights-seat pos-${posOf(i)}${v.turn === i && v.phase === 'play' ? ' is-turn' : ''}`}
            style={!short && posOf(i) === 'top' ? { top: layout.seatTop } : undefined}
            data-anchor={`seat-${i}`}
          >
            <div className="g-crazy-eights-backs">
              {Array.from({ length: shown }, (_, j) => (
                <div
                  key={j}
                  className="g-crazy-eights-mini"
                  style={{ transform: `translateX(${(j - (shown - 1) / 2) * Math.min(cw * 0.2, 60 / Math.max(1, shown - 1))}px) rotate(${(j - (shown - 1) / 2) * 4}deg)` }}
                  data-fly={j >= prev ? `${seq}|deck|${dealt ? dealDelay(j, i) : (j - prev) * 90}|0` : undefined}
                />
              ))}
            </div>
            <div className="g-crazy-eights-name">
              <b>{seat.name}</b>
              <span>{short ? `${count} · ${v.scores[i]}` : `${count} ${count === 1 ? 'card' : 'cards'} · ${v.scores[i]}`}</span>
              {seat.left && <em>left, bot playing</em>}
            </div>
          </div>
        );
      })}
      </div>

      <div className="g-crazy-eights-middle" style={short ? undefined : { paddingTop: layout.pad }}>
        <div className={`g-crazy-eights-ring dir-${v.dir === 1 ? 'cw' : 'ccw'}`} style={short ? undefined : { top: `calc(50% + ${layout.pad / 2}px)` }} aria-hidden="true" />
        <button
          type="button"
          className={`g-crazy-eights-deck${canDraw ? ' can-draw' : ''}`}
          data-anchor="deck"
          aria-label={canDraw ? (v.pending ? `Draw ${v.pending}` : 'Draw a Card') : `${v.deckCount} cards to draw`}
          onClick={() => canDraw && commit({ t: 'draw' })}
          disabled={!canDraw}
        >
          {v.deckCount > 0 && <span className="g-crazy-eights-back is-deck" />}
          <span className="g-crazy-eights-count">{v.deckCount}</span>
          {v.pending > 0 && <span className="g-crazy-eights-pending">+{v.pending}</span>}
        </button>
        <div className="g-crazy-eights-pile" data-anchor="pile" aria-label={`Top card ${rankLabel(topCard)} of ${suitLabel(suitOf(topCard))}`}>
          {pileShown.map((c, j) => {
            const isTop = j === pileShown.length - 1;
            const from = isTop && played && played.card === c ? (played.p === v.me ? (lastRect.current ? 'mine' : 'hand') : `seat-${played.p}`) : isTop && dealt ? 'deck' : null;
            const delay = dealt ? Math.round(v.counts.reduce((a, b) => a + b, 0) * DEAL_GAP * 1000) : 0;
            return (
              <div key={c} className="g-crazy-eights-pilecard" style={{ transform: `rotate(${tilt(c)}deg)` }} data-fly={from ? `${seq}|${from}|${delay}|${from.startsWith('seat') || from === 'deck' ? 1 : 0}` : undefined}>
                <Face card={c} />
              </div>
            );
          })}
          {rankOf(topCard) === 8 || v.suit !== suitOf(topCard) ? (
            <div className={`g-crazy-eights-called suit-${v.suit}`} key={`${topCard}-${v.suit}`}>
              {fmtSuit(v.suit)}
            </div>
          ) : null}
        </div>
        {toast && (
          <div key={toast.id} className={`g-crazy-eights-toast tone-${toast.tone}`} onAnimationEnd={() => setToast(null)}>
            {toast.text}
          </div>
        )}
      </div>

      <div className="g-crazy-eights-bar">
        <div className={`g-crazy-eights-me${myTurn ? ' is-turn' : ''}`} hidden={short}>
          <b>{tbl.seats[v.me]?.name === 'You' || !online ? 'You' : tbl.seats[v.me]?.name}</b>
          <span>{v.scores[v.me]} of {v.target}</span>
        </div>
        <div className="g-crazy-eights-status" aria-live="polite">
          {hint ? (
            <span key={hint.id} className="is-hint" onAnimationEnd={() => setHint(null)}>
              {hint.text}
            </span>
          ) : (
            <span key={status}>{status}</span>
          )}
        </div>
        <div className="g-crazy-eights-actions">
          {canDraw && (
            <button type="button" className="arcade-btn" onClick={() => commit({ t: 'draw' })}>
              {v.pending ? `Draw ${v.pending}` : 'Draw'}
            </button>
          )}
          {canKeep && (
            <button type="button" className="arcade-btn" onClick={() => commit({ t: 'pass' })}>
              Keep It
            </button>
          )}
        </div>
      </div>

      <div className="g-crazy-eights-hand" style={{ height: ch + (short ? 10 : 22) }}>
        {hand.map((c, i) => {
          const t = k > 1 ? (i - (k - 1) / 2) / ((k - 1) / 2) : 0;
          const isNew = fresh || !prevHand.current.has(c);
          const delay = fresh || dealt ? dealDelay(i, v.me) : 0;
          return (
            <HandCard
              key={c}
              card={c}
              x={x0 + i * gap}
              y={t * t * arc * 1.2}
              rot={t * arc}
              z={i}
              live={myTurn && playable.has(c)}
              dim={myTurn && !playable.has(c)}
              drawn={v.drew === c}
              selected={sel === i}
              shake={shake?.card === c ? shake.id : 0}
              fly={isNew ? `${seq}|deck|${delay}|1` : undefined}
              onPlay={tryPlay}
            />
          );
        })}
      </div>

      {picker !== null && (
        <div className="g-crazy-eights-sheet" role="dialog" aria-label="Pick a Suit">
          <div className="g-crazy-eights-picker">
            <p>eight is wild. pick the suit</p>
            <div className="g-crazy-eights-suits">
              {[0, 1, 3, 2].map((s) => (
                <button
                  type="button"
                  key={s}
                  className={`g-crazy-eights-suit suit-${s}`}
                  onClick={() => {
                    setPicker(null);
                    commit({ t: 'play', card: picker, suit: s });
                  }}
                >
                  <i>{SYMBOLS[s]}</i>
                  {suitLabel(s)}
                </button>
              ))}
            </div>
            <button type="button" className="arcade-btn is-light" onClick={() => setPicker(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {showSummary && v.last && v.phase !== 'play' && (
        <div className="g-crazy-eights-sheet">
          <Summary v={v} seats={tbl.seats} host={host} online={!!online} onNext={startNextHand} />
        </div>
      )}
    </div>
  );
}

function Summary({ v, seats, host, online, onNext }: { v: View; seats: SeatInfo[]; host: boolean; online: boolean; onNext: () => void }) {
  const last = v.last!;
  const who = last.winner === v.me ? 'you' : seats[last.winner]?.name ?? 'someone';
  const title = last.blocked ? `nobody can move, ${who} ${last.winner === v.me ? 'have' : 'has'} the lightest hand` : `${who} ${last.winner === v.me ? 'go' : 'goes'} out`;
  return (
    <div className="g-crazy-eights-summary">
      <h3>{title}</h3>
      <p className="g-crazy-eights-gain">+{last.gained}</p>
      <ul>
        {seats.map((seat, i) => (
          <li key={i} className={i === last.winner ? 'is-winner' : ''}>
            <span className="g-crazy-eights-who">{i === v.me ? 'You' : seat.name}</span>
            <span className="g-crazy-eights-left">{i === last.winner ? (last.blocked ? `${last.points[i]} held` : 'out') : `${last.hands[i].length} left, ${last.points[i]}`}</span>
            <span className="g-crazy-eights-meter">
              <i style={{ width: `${Math.min(100, (v.scores[i] / v.target) * 100)}%` }} />
            </span>
            <b>{v.scores[i]}</b>
          </li>
        ))}
      </ul>
      {v.phase === 'hand-over' ? (
        host ? (
          <button type="button" className="arcade-btn arcade-btn-primary arcade-btn-lg" onClick={onNext}>
            Next Hand
          </button>
        ) : (
          <p className="g-crazy-eights-note">next hand soon</p>
        )
      ) : (
        <p className="g-crazy-eights-note">first to {v.target}</p>
      )}
      {online && host && v.phase === 'hand-over' && <p className="g-crazy-eights-note">deals on its own in a few seconds</p>}
    </div>
  );
}

function HandCard({ card, x, y, rot, z, live, dim, drawn, selected, shake, fly, onPlay }: {
  card: Card;
  x: number;
  y: number;
  rot: number;
  z: number;
  live: boolean;
  dim: boolean;
  drawn: boolean;
  selected: boolean;
  shake: number;
  fly?: string;
  onPlay: (card: Card, rect?: DOMRect) => void;
}) {
  const inner = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);

  function release() {
    const el = inner.current;
    drag.current = null;
    if (!el) return;
    el.classList.remove('is-dragging');
    el.style.transform = '';
  }

  function down(e: RPointerEvent<HTMLButtonElement>) {
    if (e.button !== 0 || drag.current) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function move(e: RPointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    const el = inner.current;
    if (!d || d.id !== e.pointerId || !el) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 9) return;
    d.moved = true;
    el.classList.add('is-dragging');
    const host = el.closest('.g-crazy-eights-table') as HTMLElement | null;
    const scale = host && host.offsetWidth ? host.getBoundingClientRect().width / host.offsetWidth : 1;
    el.style.transform = `translate(${dx / scale}px, ${dy / scale}px) rotate(${-rot}deg) scale(1.08)`;
  }

  function up(e: RPointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    const el = inner.current;
    if (!d || d.id !== e.pointerId || !el) return;
    if (!d.moved) {
      release();
      onPlay(card, el.getBoundingClientRect());
      return;
    }
    const pile = el.closest('.g-crazy-eights-table')?.querySelector('[data-anchor="pile"]')?.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    const pad = 48;
    const overPile = pile && e.clientX > pile.left - pad && e.clientX < pile.right + pad && e.clientY > pile.top - pad && e.clientY < pile.bottom + pad;
    const flung = d.y - e.clientY > rect.height * 1.1;
    release();
    if (overPile || flung) onPlay(card, rect);
  }

  return (
    <div className="g-crazy-eights-slot" style={{ transform: `translate(${x}px, ${y}px) rotate(${rot}deg)`, zIndex: z }} data-fly={fly}>
      <button
        ref={inner}
        type="button"
        key={shake}
        className={['g-crazy-eights-card', live ? 'is-live' : '', dim ? 'is-dim' : '', drawn ? 'is-drawn' : '', selected ? 'is-selected' : '', shake ? 'is-shake' : ''].join(' ')}
        aria-label={`${rankLabel(card)} of ${suitLabel(suitOf(card))}`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={release}
        onLostPointerCapture={() => drag.current && release()}
        onClick={(e) => {
          // Keyboard activation; pointer taps are handled on pointerup.
          if (e.detail === 0) onPlay(card, inner.current?.getBoundingClientRect());
        }}
      >
        <Face card={card} />
      </button>
    </div>
  );
}

function Face({ card }: { card: Card }) {
  const r = rankOf(card);
  const s = suitOf(card);
  const label = rankLabel(card);
  return (
    <span className={`g-crazy-eights-face suit-${s}${r === 8 ? ' is-eight' : ''}${r > 10 ? ' is-court' : ''}`}>
      <span className="g-crazy-eights-corner">
        <b>{label}</b>
        <i>{SYMBOLS[s]}</i>
      </span>
      <span className="g-crazy-eights-pip">{r > 10 || r === 8 ? <><b>{label}</b><i>{SYMBOLS[s]}</i></> : SYMBOLS[s]}</span>
      <span className="g-crazy-eights-corner is-flip">
        <b>{label}</b>
        <i>{SYMBOLS[s]}</i>
      </span>
    </span>
  );
}
