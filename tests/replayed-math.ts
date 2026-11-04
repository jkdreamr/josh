// What a verifier replays, as source: for a test that greps it for math an engine may round its own way (see
// verify/dmath.ts). It starts from verify.ts and follows what it uses into the modules it imports (top-level functions
// and constants by name, then what those use, and so on), so drawing and sound code beside the rules is left out.
//
//   assert.doesNotMatch(replayedSource(new URL('../src/os/arcade/games/snake/verify.ts', import.meta.url)), UNSTABLE_MATH);
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Math that engines need not compute to the same last bit (Math.random is left out: a replay passes its own rng). */
export const UNSTABLE_MATH = /Math\.(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|hypot|exp|expm1|log|log1p|log2|log10|pow|cbrt|fround)\b|\*\*/;

type Module = { decls: Map<string, string>; imports: Map<string, { url: string; name: string }> };

const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

function parse(url: string): Module {
  const src = strip(readFileSync(fileURLToPath(url), 'utf8'));
  const imports = new Map<string, { url: string; name: string }>();
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'(\.[^']+)'/g)) {
    const file = /\.[cm]?[jt]sx?$/.test(m[2]) ? m[2] : `${m[2]}.ts`;
    const target = new URL(file, url).href;
    for (const part of m[1].split(',')) {
      const p = part.trim();
      if (!p || p.startsWith('type ')) continue;
      const [name, local] = p.split(/\s+as\s+/);
      imports.set((local ?? name).trim(), { url: target, name: name.trim() });
    }
  }
  // top-level declarations: each runs from its first line to the next line that starts at the margin
  const decls = new Map<string, string>();
  let name: string | null = null;
  let body: string[] = [];
  const close = () => {
    if (name) decls.set(name, body.join('\n'));
  };
  for (const line of src.split('\n')) {
    if (/^[^\s})\]]/.test(line)) {
      close();
      const d = /^(?:export\s+)?(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/.exec(line);
      name = d ? d[1] : null;
      body = [];
    }
    body.push(line);
  }
  close();
  return { decls, imports };
}

/** The source of a verifier and of everything in its game's modules that it reaches. */
export function replayedSource(verify: URL): string {
  const modules = new Map<string, Module>();
  const mod = (url: string) => {
    if (!modules.has(url)) modules.set(url, parse(url));
    return modules.get(url)!;
  };
  const root = strip(readFileSync(verify, 'utf8')).replace(/^import[^;]*;/gm, '');
  const seen = new Set<string>();
  const out = [root];
  const queue: { url: string; text: string }[] = [{ url: verify.href, text: root }];
  while (queue.length) {
    const { url, text } = queue.pop()!;
    const here = mod(url);
    for (const id of new Set(text.match(/[A-Za-z_$][\w$]*/g) ?? [])) {
      const target = here.decls.has(id) ? { url, name: id } : here.imports.get(id);
      if (!target) continue;
      const key = `${target.url}#${target.name}`;
      const decl = mod(target.url).decls.get(target.name);
      if (seen.has(key) || decl === undefined) continue;
      seen.add(key);
      out.push(decl);
      queue.push({ url: target.url, text: decl });
    }
  }
  return out.join('\n');
}
