import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
 */

export const HISTORY_FILE = 'asset-history.json';
export const KEEP_MS = 7 * 24 * 60 * 60 * 1000;
/** Newest first; older files past this total are dropped, so a burst of deploys can't balloon the upload. */
export const MAX_BYTES = 64 * 1024 * 1024;

/** File name to when it stopped being built (ms), or 0 for files this deploy builds itself. */
export type History = { files: Record<string, number> };

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
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Production builds pass `from` (the live site). Without it the build only records its own files. */
export default function keepOldAssets({ from }: { from?: string }): AstroIntegration {
  return {
    name: 'keep-old-assets',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const out = fileURLToPath(dir);
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
