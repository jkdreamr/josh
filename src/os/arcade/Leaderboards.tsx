import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { appGames } from './apps';
import { BoardList, BoardScopeNote } from './kit/board';
import { WINS_UNAVAILABLE, formatBoardScore, getBoard, getBoardTops, getWins, type Board, type BoardEntry, type BoardTopsResult } from './kit/leaderboard';
import { boardCards, defaultBoard, type BoardCard, type CardBoard } from './leaderboard-cards';
import { categories, metas } from './manifest';
import type { LeaderboardSpec } from './types';
import './Leaderboards.css';

/** Every card on the page: one per game with a score board, then one per game with Online Wins. */
export const leaderboardCards = boardCards([...metas, ...appGames]);

/** What the cards load in one request: every score board (by id, with its spec) and every game with Online Wins. */
const scoreSpecs: Record<string, LeaderboardSpec> = {};
for (const board of leaderboardCards.flatMap((card) => card.boards)) if (board.spec) scoreSpecs[board.id] = board.spec;
const onlineIds = leaderboardCards.filter((card) => card.kind === 'wins').map((card) => card.key);

type Kind = BoardCard['kind'];
/** Up to this many boards switch with chips; more (Palm Drive's courses, Go's sizes and levels) use a menu. */
const CHIPS_MAX = 4;

const cardId = (card: BoardCard) => `${card.kind}:${card.key}`;
const formatWins = (n: number) => Math.floor(n).toLocaleString('en-US');
const formatFor = ({ spec }: CardBoard) => (spec ? (n: number) => formatBoardScore(n, spec) : formatWins);

function Glyph({ card, size }: { card: BoardCard; size: number }) {
  return (
    <span className="arcade-lbc-icon" aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={card.glyph} />
      </svg>
    </span>
  );
}

/** Chips for a few variants, a menu for many. */
function Variants({ card, value, onPick }: { card: BoardCard; value: string; onPick: (id: string) => void }) {
  if (card.boards.length < 2) return null;
  const label = `${card.title} Board`;
  if (card.boards.length > CHIPS_MAX) {
    return (
      <select className="arcade-lbc-select" aria-label={label} value={value} onChange={(e) => onPick(e.target.value)}>
        {card.boards.map((board) => (
          <option key={board.id} value={board.id}>
            {board.label}
          </option>
        ))}
      </select>
    );
  }
  return (
    <div className="arcade-lbc-chips" role="group" aria-label={label}>
      {card.boards.map((board) => (
        <button key={board.id} type="button" aria-pressed={board.id === value} onClick={() => onPick(board.id)}>
          {board.label}
        </button>
      ))}
    </div>
  );
}

/** The card's top three, a placeholder while loading, or an empty note. */
function TopThree({ entries, board, kind }: { entries: BoardEntry[] | null; board: CardBoard; kind: Kind }) {
  if (!entries) {
    return (
      <ol className="arcade-lbc-top is-loading" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <li key={i}>
            <span className="arcade-lbc-rank" />
            <span className="arcade-lbc-skel" />
          </li>
        ))}
      </ol>
    );
  }
  if (!entries.length) return <p className="arcade-lbc-empty">{kind === 'wins' ? 'No wins yet.' : 'No scores yet. Be the first.'}</p>;
  const fmt = formatFor(board);
  return (
    <ol className="arcade-lbc-top">
      {entries.slice(0, 3).map((entry, i) => (
        <li key={`${entry.date}-${i}`}>
          <span className="arcade-lbc-rank">{i + 1}</span>
          <span className="arcade-lbc-name">{entry.name}</span>
          <span className="arcade-lbc-score">{fmt(entry.score)}</span>
        </li>
      ))}
    </ol>
  );
}

function Card({ card, board, entries, onPick, onOpen }: { card: BoardCard; board: CardBoard; entries: BoardEntry[] | null; onPick: (id: string) => void; onOpen: () => void }) {
  const name = `${card.title}${card.boards.length > 1 ? ` ${board.label}` : ''} ${card.kind === 'wins' ? 'Online Wins' : 'Leaderboard'}`;
  return (
    <li className="arcade-lbc-card" style={{ ['--accent' as string]: card.accent }}>
      <div className="arcade-lbc-head">
        <Glyph card={card} size={22} />
        <div className="arcade-lbc-title">
          <h3>
            {/* Covers the whole card (see .arcade-lbc-open::after), so a click anywhere but the variant switch opens the full board. */}
            <button type="button" className="arcade-lbc-open" data-card={cardId(card)} aria-label={name} onClick={onOpen}>
              {card.title}
            </button>
          </h3>
          <p>{card.measure}</p>
        </div>
        <svg className="arcade-lbc-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </div>
      <Variants card={card} value={board.id} onPick={onPick} />
      <TopThree entries={entries} board={board} kind={card.kind} />
    </li>
  );
}

/** One board's full top 100, with the card's variant switch and a way back to the cards. */
function Detail({ card, board, onPick, onBack }: { card: BoardCard; board: CardBoard; onPick: (id: string) => void; onBack: () => void }) {
  const [data, setData] = useState<Board | null>(null);
  useEffect(() => {
    setData(null);
    let live = true;
    (board.spec ? getBoard(board.id, board.spec) : getWins(board.id)).then((b) => live && setData(b));
    return () => {
      live = false;
    };
  }, [board]);
  const wins = card.kind === 'wins';
  return (
    <div className="arcade-boards arcade-lbc-detail" style={{ ['--accent' as string]: card.accent }}>
      <button type="button" className="arcade-pbtn arcade-lbc-back" onClick={onBack}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 6l-6 6 6 6" />
        </svg>
        All Boards
      </button>
      <div className="arcade-lbc-head">
        <Glyph card={card} size={26} />
        <div className="arcade-lbc-title">
          <h2 tabIndex={-1}>{card.title}</h2>
          <p>{card.measure}</p>
        </div>
      </div>
      <Variants card={card} value={board.id} onPick={onPick} />
      {wins && data?.error ? (
        <p className="arcade-lb-empty">{WINS_UNAVAILABLE}</p>
      ) : (
        <>
          <BoardScopeNote board={data} />
          {wins && data && !data.entries.length ? <p className="arcade-lb-empty">No Wins Yet</p> : <BoardList board={data} fmt={formatFor(board)} />}
        </>
      )}
    </div>
  );
}

/** The arcade home's Leaderboards view: a card per game with its top three, and a game's full board when its card opens. */
export function Leaderboards() {
  const [kind, setKind] = useState<Kind>('score');
  const [tops, setTops] = useState<BoardTopsResult | null>(null);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<BoardCard | null>(null);
  const root = useRef<HTMLElement>(null);
  /** The card that opened the full board and where the page was scrolled, to come back to both. */
  const from = useRef<{ card: string; top: number } | null>(null);

  useEffect(() => {
    let live = true;
    getBoardTops(scoreSpecs, onlineIds).then((t) => live && setTops(t));
    return () => {
      live = false;
    };
  }, []);

  useLayoutEffect(() => {
    const scroller = root.current?.closest<HTMLElement>('.arcade');
    if (open) {
      if (scroller) scroller.scrollTop = 0;
      root.current?.querySelector<HTMLElement>('.arcade-lbc-detail h2')?.focus({ preventScroll: true });
      return;
    }
    const back = from.current;
    from.current = null;
    if (!back) return;
    if (scroller) scroller.scrollTop = back.top;
    root.current?.querySelector<HTMLElement>(`[data-card="${back.card}"]`)?.focus({ preventScroll: true });
  }, [open]);

  const listsOf = (card: BoardCard) => (tops ? (card.kind === 'wins' ? tops.wins : tops.boards) : null);
  const boardOf = (card: BoardCard) => card.boards.find((board) => board.id === picked[cardId(card)]) ?? defaultBoard(card.boards, listsOf(card));
  const pick = (card: BoardCard, id: string) => setPicked((p) => ({ ...p, [cardId(card)]: id }));
  const openCard = (card: BoardCard) => {
    from.current = { card: cardId(card), top: root.current?.closest('.arcade')?.scrollTop ?? 0 };
    pick(card, boardOf(card).id);
    setOpen(card);
  };

  if (open) {
    return (
      <section className="arcade-lbc" aria-label="Leaderboards" ref={root}>
        <Detail card={open} board={boardOf(open)} onPick={(id) => pick(open, id)} onBack={() => setOpen(null)} />
      </section>
    );
  }

  const cards = leaderboardCards.filter((card) => card.kind === kind);
  const groups = categories.map((c) => ({ ...c, cards: cards.filter((card) => card.category === c.id) })).filter((c) => c.cards.length);
  return (
    <section className="arcade-lbc" aria-label="Leaderboards" ref={root}>
      <div className="arcade-lbc-bar">
        <div className="arcade-lbc-seg" role="group" aria-label="Board Type">
          <button type="button" aria-pressed={kind === 'score'} onClick={() => setKind('score')}>
            Top Scores
          </button>
          <button type="button" aria-pressed={kind === 'wins'} onClick={() => setKind('wins')}>
            Online Wins
          </button>
        </div>
        {tops?.scope === 'device' && kind === 'score' && <p className="arcade-lbc-note">This Device Top 3. Global scores are unavailable right now.</p>}
      </div>
      {kind === 'wins' && tops && !tops.wins ? (
        <p className="arcade-lbc-note arcade-lbc-unavailable">{WINS_UNAVAILABLE}</p>
      ) : (
        groups.map((c) => (
          <section key={c.id} className="arcade-section" aria-label={c.label}>
            <h2>{c.label}</h2>
            <ul className="arcade-lbc-grid" aria-busy={!tops}>
              {c.cards.map((card) => {
                const board = boardOf(card);
                const lists = listsOf(card);
                return (
                  <Card
                    key={card.key}
                    card={card}
                    board={board}
                    entries={lists ? (lists[board.id] ?? []) : null}
                    onPick={(id) => pick(card, id)}
                    onOpen={() => openCard(card)}
                  />
                );
              })}
            </ul>
          </section>
        ))
      )}
    </section>
  );
}
