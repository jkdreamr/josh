import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { GameCategory, GameMeta, GameProps } from './types';

type MetaModule = { meta: GameMeta };
type GameModule = { default: ComponentType<GameProps> };

export const categories: { id: GameCategory; label: string }[] = [
  { id: 'arcade', label: 'Arcade' },
  { id: 'puzzle', label: 'Puzzles' },
  { id: '3d', label: '3D' },
  { id: 'multiplayer', label: 'Multiplayer' },
];

const metaModules = import.meta.glob<MetaModule>(['./games/*/meta.ts', '!./games/_*/meta.ts'], { eager: true });
const gameModules = import.meta.glob<GameModule>(['./games/*/index.tsx', '!./games/_*/index.tsx']);

/** Dev only: set localStorage 'arcade:dev' to '1' to list folders starting with '_' (like _example). */
const devOn = () => {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem('arcade:dev') === '1';
  } catch {
    return false;
  }
};
const devMetas = import.meta.env.DEV && devOn() ? import.meta.glob<MetaModule>('./games/_*/meta.ts', { eager: true }) : {};
const devGames = import.meta.env.DEV && devOn() ? import.meta.glob<GameModule>('./games/_*/index.tsx') : {};

const folderOf = (path: string) => path.split('/')[2];
const rank = (c: GameCategory) => categories.findIndex((x) => x.id === c);

const loaderById = new Map<string, () => Promise<GameModule>>();
for (const [path, load] of Object.entries({ ...gameModules, ...devGames })) loaderById.set(folderOf(path).replace(/^_/, ''), load);

/** Every playable game, sorted by category then order then title. */
export const metas: GameMeta[] = Object.values({ ...metaModules, ...devMetas })
  .map((m) => m.meta)
  .filter((m) => m && loaderById.has(m.id))
  .sort((a, b) => rank(a.category) - rank(b.category) || a.order - b.order || a.title.localeCompare(b.title));

const metaById = new Map(metas.map((m) => [m.id, m]));

export const getMeta = (id: string) => metaById.get(id);
export const hasGame = (id: string) => metaById.has(id);

/** One React.lazy component per game id; each game is its own chunk and only downloads when rendered. */
export const loaders: Record<string, LazyExoticComponent<ComponentType<GameProps>>> = Object.fromEntries(
  [...loaderById].map(([id, load]) => [id, lazy(load)]),
);

/** Swap in a fresh lazy component so a game that failed to download can be retried. */
export function reloadGame(id: string) {
  const load = loaderById.get(id);
  if (load) loaders[id] = lazy(load);
  return loaders[id];
}
