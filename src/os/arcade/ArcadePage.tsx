import { useEffect, useState, type KeyboardEvent } from 'react';
import { BoardList, BoardScopeNote } from './kit/board';
import { appGames } from './apps';
import { ArcadeChat } from './Chat';
import { ARCADE_API, boardsOf, formatBoardScore, getBoard, type Board, type BoardEntry, type BoardInfo } from './kit/leaderboard';
import { categories, metas } from './manifest';
import type { GameMeta } from './types';

const owners = [...metas, ...appGames];
type BoardChoice = { key: string; title: string; id: string } & ({ kind: 'score'; info: BoardInfo } | { kind: 'wins' });
const boardChoices: BoardChoice[] = [
  ...owners.flatMap((game) => boardsOf(game)).map((info): BoardChoice => ({ key: `score:${info.id}`, title: info.title, id: info.id, kind: 'score', info })),
  ...owners.filter((game) => game.online).map((game): BoardChoice => ({ key: `wins:${game.id}`, title: `${game.title} Online Wins`, id: game.id, kind: 'wins' })),
].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'score' ? -1 : 1) || a.title.localeCompare(b.title));
const WINS_UNAVAILABLE = 'Online wins are unavailable right now.';

async function getWins(game: string): Promise<Board> {
  if (!ARCADE_API) return { entries: [], scope: 'global', error: WINS_UNAVAILABLE };
  try {
    const response = await fetch(`${ARCADE_API}/wins?game=${encodeURIComponent(game)}`);
    if (!response.ok) throw new Error('unavailable');
    const body = (await response.json()) as { entries?: unknown };
    if (!Array.isArray(body.entries)) throw new Error('invalid response');
    const entries = body.entries.filter((entry): entry is BoardEntry =>
      !!entry && typeof entry === 'object' &&
      typeof (entry as BoardEntry).name === 'string' &&
      Number.isFinite((entry as BoardEntry).score) &&
      typeof (entry as BoardEntry).date === 'string',
    );
    return { entries, scope: 'global' };
  } catch {
    return { entries: [], scope: 'global', error: WINS_UNAVAILABLE };
  }
}

function Leaderboards() {
  const [id, setId] = useState(boardChoices[0]?.key ?? '');
  const [board, setBoard] = useState<Board | null>(null);
  const choice = boardChoices.find((item) => item.key === id);
  useEffect(() => {
    setBoard(null);
    if (!choice) return;
    let live = true;
    const request = choice.kind === 'wins'
      ? getWins(choice.id)
      : getBoard(choice.id, choice.info.spec);
    request.then((b) => live && setBoard(b));
    return () => {
      live = false;
    };
  }, [choice]);
  if (!choice) return null;
  return (
    <section className="arcade-boards" aria-label="Leaderboards">
      <div className="arcade-boards-bar">
        <select aria-label="Game" value={id} onChange={(e) => setId(e.target.value)}>
          {(['score', 'wins'] as const).map((kind) => (
            <optgroup key={kind} label={kind === 'score' ? 'Top Scores' : 'Online Wins'}>
              {boardChoices.filter((item) => item.kind === kind).map((item) => (
                <option key={item.key} value={item.key}>
                  {item.title}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      {choice.kind === 'wins' && board?.error ? (
        <p className="arcade-lb-empty">{WINS_UNAVAILABLE}</p>
      ) : (
        <>
          <BoardScopeNote board={board} />
          {choice.kind === 'wins' && <div className="arcade-board-measure">Wins</div>}
          {choice.kind === 'score' && choice.info.spec.measure && <div className="arcade-board-measure">{choice.info.spec.measure}</div>}
          {choice.kind === 'wins' && board && !board.entries.length
            ? <p className="arcade-lb-empty">No Wins Yet</p>
            : <BoardList board={board} fmt={(n) => choice.kind === 'wins' ? Math.floor(n).toLocaleString('en-US') : formatBoardScore(n, choice.info.spec)} />}
        </>
      )}
    </section>
  );
}

/** Arrow keys move between tiles, using layout positions so it works at any column count. */
function onGridKey(e: KeyboardEvent<HTMLDivElement>) {
  const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
  if (!keys.includes(e.key) || e.metaKey || e.ctrlKey || e.altKey) return;
  const tiles = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('.arcade-tile')];
  const i = tiles.indexOf(document.activeElement as HTMLButtonElement);
  if (i < 0) return;
  e.preventDefault();
  e.stopPropagation();
  // .arcade-sections is position: relative, so every tile shares it as offsetParent (untransformed layout coords).
  const pos = (el: HTMLElement) => ({ x: el.offsetLeft + el.offsetWidth / 2, y: el.offsetTop + el.offsetHeight / 2, h: el.offsetHeight });
  let next = i;
  if (e.key === 'ArrowLeft') next = Math.max(0, i - 1);
  else if (e.key === 'ArrowRight') next = Math.min(tiles.length - 1, i + 1);
  else {
    const here = pos(tiles[i]);
    const dir = e.key === 'ArrowDown' ? 1 : -1;
    let bestD = Infinity;
    tiles.forEach((t, j) => {
      const p = pos(t);
      const dy = (p.y - here.y) * dir;
      if (dy < here.h / 2) return;
      const d = dy * 4 + Math.abs(p.x - here.x);
      if (d < bestD) {
        bestD = d;
        next = j;
      }
    });
  }
  tiles[next].focus();
}

function Tile({ g, onOpen }: { g: GameMeta; onOpen: (id: string) => void }) {
  return (
    <button className="arcade-tile" style={{ ['--accent' as string]: g.accent }} onClick={() => onOpen(g.id)}>
      <span className="arcade-tile-icon">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={g.glyph} />
        </svg>
      </span>
      <span className="arcade-tile-text">
        <span className="arcade-tile-top">
          <b>{g.title}</b>
          <em>{g.players}</em>
        </span>
        <span className="arcade-tile-blurb">{g.blurb}</span>
      </span>
    </button>
  );
}

export function ArcadePage({ onOpen }: { onOpen: (id: string) => void }) {
  const [view, setView] = useState<'games' | 'boards' | 'chat'>('games');
  const toggle = (next: 'boards' | 'chat') => setView(view === next ? 'games' : next);
  const groups = categories.map((c) => ({ ...c, games: metas.filter((m) => m.category === c.id) })).filter((c) => c.games.length);
  return (
    <div className={view === 'chat' ? 'arcade is-chat' : 'arcade'}>
      <header className="arcade-head">
        <div className="arcade-head-row">
          <h1>{view === 'boards' ? 'Leaderboards' : view === 'chat' ? 'Chat' : 'Arcade'}</h1>
          <div className="arcade-head-actions">
            <button type="button" className="arcade-pbtn" onClick={() => toggle('chat')}>
              {view === 'chat' ? 'All Games' : 'Chat'}
            </button>
            {boardChoices.length > 0 && (
              <button type="button" className="arcade-pbtn" onClick={() => toggle('boards')}>
                {view === 'boards' ? 'All Games' : 'Leaderboards'}
              </button>
            )}
          </div>
        </div>
        <p>{view === 'boards' ? 'Top 100 Scores and Online Wins for Each Game.' : view === 'chat' ? 'Find someone to play with, or just say hi. Be kind.' : metas.length ? `${metas.length} games, made for this computer.` : 'Games are on the way.'}</p>
      </header>
      {view === 'boards' ? (
        <Leaderboards />
      ) : view === 'chat' ? (
        <ArcadeChat />
      ) : (
      <div className="arcade-sections" onKeyDown={onGridKey}>
        {groups.map((c) => (
          <section key={c.id} className="arcade-section" aria-label={c.label}>
            <h2>{c.label}</h2>
            <div className="arcade-grid">
              {c.games.map((g) => (
                <Tile key={g.id} g={g} onOpen={onOpen} />
              ))}
            </div>
          </section>
        ))}
      </div>
      )}
    </div>
  );
}
