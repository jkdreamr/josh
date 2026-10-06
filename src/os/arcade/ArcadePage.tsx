import type { KeyboardEvent } from 'react';
import { categories, metas } from './manifest';
import type { GameMeta } from './types';

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
  const groups = categories.map((c) => ({ ...c, games: metas.filter((m) => m.category === c.id) })).filter((c) => c.games.length);
  return (
    <div className="arcade">
      <header className="arcade-head">
        <h1>
          arcade<span>.</span>
        </h1>
        <p>{metas.length ? `${metas.length} little games, built for this computer. pick one.` : 'the cabinets are still being wheeled in. check back soon.'}</p>
      </header>
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
    </div>
  );
}
