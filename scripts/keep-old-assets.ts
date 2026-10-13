import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { AstroIntegration } from 'astro';

/**
 * Every deploy renames the files it changed, and the old names stop existing. A page opened before the deploy
 * still asks for the old names the first time it lazily loads something (a game, three.js, a worker) and would
 * get a 404. So each production build downloads the files the live site has that this build doesn't, and ships
 * them alongside its own for a week after they were last live. Old pages keep working on their own version.
 *
 * asset-history.json, published with each deploy, records when each kept file stopped being built, so files from
 * several deploys back are still found. The live site's own files are found by following its page and scripts,
 * which also covers the first deploy, before any history exists.
 *
 * A script older than that is answered with scripts/missing-file.js instead of a 404, which gives pages from before
 * any of this a working Reload card in place of the dead end they would otherwise show.
 */

export const HISTORY_FILE = 'asset-history.json';
export const KEEP_MS = 7 * 24 * 60 * 60 * 1000;
/** Newest first; older files past this total are dropped, so a burst of deploys can't balloon the upload. */
export const MAX_BYTES = 64 * 1024 * 1024;

/** File name to when it stopped being built (ms), or 0 for files this deploy builds itself. */
export type History = { files: Record<string, number> };

/** Where the stand-in for a missing script is published, and the header that marks its responses. */
export const MISSING_FILE = '_missing.js';
const MISSING_HEADER = 'x-missing-file';
/**
 * Vercel only reaches the routes after `filesystem` for files that don't exist. Workers (built as `*worker-<hash>.js`)
 * are left out: a missing worker must fail to load (Baduk shows its Reload card for that), not start and throw.
 */
export const MISSING_ROUTE = {
  src: '^/_astro/(?![^/]*worker-)[^/]+\\.js$',
  dest: `/${MISSING_FILE}`,
  headers: { 'cache-control': 'no-store', [MISSING_HEADER]: '1' },
};
/**
 * The Vercel adapter's year-long cache header for /_astro sits after the filesystem check, so it only ever lands
 * on 404s, and a cached 404 would stick even once the file is back. Misses are never cached instead.
 */
export const MISS_HEADERS_ROUTE = { src: '^/_astro/', headers: { 'cache-control': 'no-store' }, continue: true };
type Route = Record<string, unknown>;

/** The Vercel routes with ours right after the filesystem check, or null if there is no such check. */
export function withMissingRoute(routes: Route[]): Route[] | null {
  const at = routes.findIndex((route) => route.handle === 'filesystem');
  if (at < 0) return null;
  // Routes from there to the next `handle` only run for misses. In that stretch, drop earlier copies of ours and
  // header-only /_astro routes (the adapter's). Later phases, such as headers for files that exist, stay as they are.
  const next = routes.findIndex((route, i) => i > at && route.handle);
  const end = next < 0 ? routes.length : next;
  const misses = routes.slice(at + 1, end).filter((route) => route.dest !== MISSING_ROUTE.dest && !(String(route.src).startsWith('^/_astro/') && !route.dest));
  return [...routes.slice(0, at + 1), MISSING_ROUTE, MISS_HEADERS_ROUTE, ...misses, ...routes.slice(end)];
}

/** Arcade game titles to ids, from each game's meta, so the stand-in can reopen the game it was. */
export async function gameIds(gamesDir: string): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const folder of existsSync(gamesDir) ? readdirSync(gamesDir) : []) {
    const file = join(gamesDir, folder, 'meta.ts');
    if (folder.startsWith('_') || !existsSync(file)) continue;
    // Like scripts/arcade-specs.ts. A meta that won't load just reopens the arcade grid instead of its game.
    const meta = await import(pathToFileURL(file).href).then((m: { meta?: { id?: unknown; title?: unknown } }) => m.meta, () => null);
    if (typeof meta?.id === 'string' && typeof meta.title === 'string') ids[meta.title] = meta.id;
  }
  return ids;
}

const FILE = /^[\w-]+(?:\.[\w-]+)*\.(?:m?js|css|wasm)$/;
const REF = /(?:\.\/|\/?_astro\/)([\w-]+(?:\.[\w-]+)*\.(?:m?js|css|wasm))\b/g;
// `import"./x.js"` and `from"./x.js"`: loaded with the importer. `import("./x.js")` is lazy and does not match.
const STATIC_REF = /\b(?:from|import)\s*["'`]\.\/([\w-]+(?:\.[\w-]+)*\.m?js)["'`]/g;

/** Names of the /_astro files a page, script or stylesheet refers to. */
export function refsIn(text: string): string[] {
  return [...new Set([...text.matchAll(REF)].map((m) => m[1]))];
}

/**
 * The files a page loads before it starts: everything the page links, and everything those import statically.
 * An open page already holds these, so they never need keeping. `text` reads a file's contents by name.
 */
export function bootFiles(page: string, text: (name: string) => string | undefined): Set<string> {
  const boot = new Set<string>();
  const stack = refsIn(page);
  while (stack.length) {
    const name = stack.pop()!;
    if (boot.has(name)) continue;
    boot.add(name);
    for (const m of (text(name) ?? '').matchAll(STATIC_REF)) stack.push(m[1]);
  }
  return boot;
}

/**
 * Which files to keep from older deploys (newest first, with when each retired) and the history this deploy
 * publishes for its own files. `live` are the files the site serves right now, which retire with this deploy;
 * `boot` are the live page's startup files, which no open page will ask for again.
 */
export function plan(prev: History | null, live: string[], built: string[], now: number, boot: Set<string> = new Set()) {
  const own = new Set(built);
  const retired = new Map<string, number>();
  const retire = (name: string, at: number) => {
    if (!own.has(name) && !boot.has(name) && FILE.test(name) && now - at < KEEP_MS) retired.set(name, Math.max(retired.get(name) ?? 0, at));
  };
  for (const name of live) retire(name, now);
  for (const [name, at] of Object.entries(prev?.files ?? {})) if (Number.isFinite(at) && at >= 0) retire(name, at || now);
  const keep = [...retired].sort((a, b) => b[1] - a[1]);
  return { keep, files: Object.fromEntries(built.map((name) => [name, 0])) as Record<string, number> };
}

async function get(url: string): Promise<Buffer | null> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (res.status === 404 || res.headers.get(MISSING_HEADER)) return null;
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Production builds pass `from` (the live site). Without it the build only records its own files. */
export default function keepOldAssets({ from }: { from?: string }): AstroIntegration {
  let root = process.cwd();
  return {
    name: 'keep-old-assets',
    hooks: {
      'astro:config:done': ({ config }) => {
        root = fileURLToPath(config.root);
      },
      'astro:build:done': async ({ dir, logger }) => {
        const out = fileURLToPath(dir);
        // The stand-in for missing scripts, and the route that serves it. The Vercel adapter has written its
        // config by now (it runs first) and copies the files out after this.
        const games = JSON.stringify(await gameIds(join(root, 'src', 'os', 'arcade', 'games')));
        writeFileSync(join(out, MISSING_FILE), readFileSync(join(root, 'scripts', 'missing-file.js'), 'utf8').replace(/__GAMES__/g, () => games));
        const config = join(root, '.vercel', 'output', 'config.json');
        if (existsSync(config)) {
          const vercel = JSON.parse(readFileSync(config, 'utf8')) as { routes?: Route[] };
          const routes = withMissingRoute(vercel.routes ?? []);
          if (routes) writeFileSync(config, JSON.stringify({ ...vercel, routes }, null, '\t'));
          else logger.warn('no filesystem route in the Vercel config, so missing scripts will 404');
        }
        const assets = join(out, '_astro');
        const built = readdirSync(assets).filter((name) => statSync(join(assets, name)).isFile());
        const now = Date.now();
        let { keep, files } = plan(null, [], built, now);
        let kept = 0;
        let bytes = 0;
        if (from) {
          const site = from.replace(/\/+$/, '');
          const fetched = new Map<string, Buffer>();
          const texts = new Map<string, string>();
          try {
            const history = await get(`${site}/${HISTORY_FILE}`).then((b) => (b ? (JSON.parse(b.toString()) as History) : null)).catch(() => null);
            // Follow the live page's references. Files this build also has are the same bytes (the name is a hash).
            const live = new Set<string>();
            const page = (await get(`${site}/`))?.toString() ?? '';
            const queue = refsIn(page);
            while (queue.length) {
              const name = queue.pop()!;
              if (live.has(name)) continue;
              live.add(name);
              if (name.endsWith('.wasm')) continue;
              const body = built.includes(name) ? readFileSync(join(assets, name)) : await get(`${site}/_astro/${name}`).catch(() => null);
              if (!body) continue;
              if (!built.includes(name)) fetched.set(name, body);
              texts.set(name, body.toString());
              queue.push(...refsIn(texts.get(name)!));
            }
            ({ keep, files } = plan(history?.files ? history : null, [...live], built, now, bootFiles(page, (name) => texts.get(name))));
            for (const [name, at] of keep) {
              const body = fetched.get(name) ?? (await get(`${site}/_astro/${name}`).catch(() => null));
              if (!body || bytes + body.length > MAX_BYTES) continue;
              writeFileSync(join(assets, name), body);
              files[name] = at;
              bytes += body.length;
              kept++;
            }
          } catch (e) {
            logger.warn(`couldn't read ${site}, so pages open before this deploy may need a reload: ${e instanceof Error ? e.message : e}`);
          }
        }
        writeFileSync(join(out, HISTORY_FILE), JSON.stringify({ files } satisfies History));
        if (from) logger.info(`kept ${kept} files (${(bytes / 1048576).toFixed(1)} MB) from recent deploys for pages still open`);
      },
    },
  };
}
