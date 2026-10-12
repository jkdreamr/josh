import { useCallback, useEffect, useRef, useState } from 'react';
import type { LeaderboardSpec } from '../types';
import { NAME_MAX, cleanName, getBoard, nameLength, qualifies, saveName, submitScore, type Board, type BoardEntry, type BoardScope } from './leaderboard';

export const scopeLabel = (scope: BoardScope) => (scope === 'global' ? 'Global' : 'This Device');

const sameEntry = (a: BoardEntry, b: BoardEntry | null | undefined) => !!b && a.name === b.name && a.score === b.score && a.date === b.date;

/** Top 100 list. `mine` highlights the entry just submitted. */
export function BoardList({ board, fmt, mine }: { board: Board | null; fmt: (n: number) => string; mine?: BoardEntry | null }) {
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const row = list.current?.querySelector<HTMLElement>('.is-mine');
    if (row && list.current) list.current.scrollTop = row.offsetTop - list.current.clientHeight / 2;
  }, [board, mine]);
  if (!board) return <p className="arcade-lb-empty">Loading scores</p>;
  if (!board.entries.length) return <p className="arcade-lb-empty">No scores yet. Be the first.</p>;
  return (
    <ol className="arcade-lb-list" ref={list}>
      {board.entries.map((e, i) => (
        <li key={`${e.date}-${i}`} className={sameEntry(e, mine) ? 'is-mine' : undefined}>
          <span className="arcade-lb-rank">{i + 1}</span>
          <span className="arcade-lb-name">{e.name}</span>
          <span className="arcade-lb-score">{fmt(e.score)}</span>
        </li>
      ))}
    </ol>
  );
}

/** One line under the board title saying where the scores come from. */
export function BoardScopeNote({ board }: { board: Board | null }) {
  if (!board) return null;
  return (
    <p className="arcade-lb-scope">
      {board.scope === 'global' ? 'Global Top 100' : 'This Device Top 100. Global scores are unavailable right now.'}
      {board.error && <> {board.error}</>}
    </p>
  );
}

/** Board for a finished round: loads it, says whether the score qualifies and submits a name. */
export function useRoundBoard(game: string, spec: LeaderboardSpec | undefined, score: number | undefined, round: unknown) {
  const [board, setBoard] = useState<Board | null>(null);
  const [mine, setMine] = useState<BoardEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const enabled = !!spec && score !== undefined && round != null;

  useEffect(() => {
    setBoard(null);
    setMine(null);
    setBusy(false);
    if (!spec || score === undefined || round == null) return;
    let live = true;
    getBoard(game, spec).then((b) => live && setBoard(b));
    return () => {
      live = false;
    };
  }, [game, spec, score, round]);

  const canSubmit = enabled && !!board && !mine && qualifies(score!, board.entries, spec!);
  const submit = useCallback(
    async (name: string) => {
      if (!spec || score === undefined) return;
      setBusy(true);
      const clean = cleanName(name);
      saveName(clean);
      const res = await submitScore(game, spec, clean, score);
      setBoard(res);
      setMine(res.entry);
      setBusy(false);
    },
    [game, spec, score],
  );
  return { enabled, board, mine, busy, canSubmit, submit };
}

export const validName = (name: string) => {
  const n = nameLength(cleanName(name));
  return n >= 1 && n <= NAME_MAX;
};
