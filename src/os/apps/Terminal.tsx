import { useEffect, useRef, useState, type ReactNode } from 'react';
import { folders, linkedin, links, profile, type FolderId } from '../data';
import { useOS, type AppId, type AppProps, type OSApi } from '../types';

type Line = { id: number; node: ReactNode };

const PROMPT = (cwd: string) => (
  <span className="t-prompt">
    <span className="t-user">guest@joshs-macbook</span> <span className="t-cwd">{cwd}</span> %
  </span>
);

const dirMap: Record<string, FolderId> = { school: 'school', work: 'work', projects: 'projects', 'side-projects': 'projects', music: 'music' };
const appNames: Record<string, AppId> = {
  finder: 'finder', chrome: 'chrome', browser: 'chrome', messages: 'messages', notes: 'notes', spotify: 'spotify', soundcloud: 'soundcloud',
  instagram: 'instagram', ig: 'instagram', x: 'x', twitter: 'x', linkedin: 'linkedin', github: 'github', mail: 'mail', email: 'mail',
  coxbox: 'coxbox', 'cox-box': 'coxbox', rowing: 'coxbox', photobooth: 'photobooth', camera: 'photobooth', trash: 'trash', about: 'about',
};

const commands = ['help', 'whoami', 'about', 'ls', 'cd', 'cat', 'open', 'work', 'school', 'projects', 'music', 'socials', 'contact', 'neofetch', 'row', 'date', 'echo', 'history', 'clear', 'exit', 'sudo'];

const ART = String.raw`
       _ _
      (_) | __
      | | |/ /
      | |   <
     _/ |_|\_\
    |__/
`;

let seq = 1;

export default function Terminal(_: AppProps) {
  const os = useOS();
  const [lines, setLines] = useState<Line[]>(() => [
    { id: seq++, node: <span className="t-dim">Last login: {new Date().toDateString()} on ttys001</span> },
    { id: seq++, node: <span>welcome to josh’s machine. type <b className="t-hl">help</b> to see what you can do.</span> },
  ]);
  const [input, setInput] = useState('');
  const [cwd, setCwd] = useState('~');
  const [hist, setHist] = useState<string[]>([]);
  const [hIdx, setHIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [lines]);

  useEffect(() => {
    if (!os.mobile) inputRef.current?.focus();
  }, [os.mobile]);

  const print = (...nodes: ReactNode[]) => setLines((l) => [...l, ...nodes.map((node) => ({ id: seq++, node }))]);

  const list = (id: FolderId) =>
    folders
      .find((f) => f.id === id)!
      .entries.map((e) => (
        <span key={e.name}>
          <span className="t-file">{e.name}</span>
          {(e.role || e.meta) && <span className="t-dim"> — {[e.role, e.meta].filter(Boolean).join(', ')}</span>}
        </span>
      ));

  const run = (raw: string, api: OSApi) => {
    const [cmd = '', ...rest] = raw.trim().split(/\s+/);
    const arg = rest.join(' ');
    const c = cmd.toLowerCase();
    switch (c) {
      case '':
        return;
      case 'help':
        return print(
          <div className="t-grid">
            {[
              ['whoami', 'who is josh?'],
              ['ls / cd <dir>', 'look around (school, work, projects, music)'],
              ['open <app>', 'open any app — e.g. open spotify'],
              ['work · school · projects · music', 'shortcuts'],
              ['socials · contact', 'where to find me'],
              ['neofetch', 'system info'],
              ['row', 'play Cox Box'],
              ['clear · history · exit', 'the usual'],
            ].map(([a, b]) => (
              <span key={a}>
                <b className="t-hl">{a}</b>
                <span className="t-dim">{b}</span>
              </span>
            ))}
          </div>,
        );
      case 'whoami':
      case 'about':
        return print(
          <span>
            <b>{profile.name}</b> — {linkedin.headline}. {linkedin.about}. {profile.tagline}
          </span>,
        );
      case 'ls': {
        const target = (arg || (cwd === '~' ? '' : cwd.replace('~/', ''))).replace(/\/$/, '').toLowerCase();
        if (!target) return print(<span className="t-row">{['school/', 'work/', 'projects/', 'music/', 'about-me.txt'].map((n) => <span key={n} className={n.endsWith('/') ? 't-dir' : 't-file'}>{n}</span>)}</span>);
        const id = dirMap[target];
        return id ? print(...list(id)) : print(<span className="t-err">ls: {arg}: No such file or directory</span>);
      }
      case 'cd': {
        const t = arg.replace(/\/$/, '').toLowerCase();
        if (!t || t === '~' || t === '..') return setCwd('~');
        if (dirMap[t]) return setCwd(`~/${t}`);
        return print(<span className="t-err">cd: no such file or directory: {arg}</span>);
      }
      case 'cat':
        if (/about/.test(arg)) return run('whoami', api);
        return print(<span className="t-err">cat: {arg || 'missing operand'}: try about-me.txt</span>);
      case 'work':
      case 'school':
      case 'music':
      case 'projects':
        return print(...list(c as FolderId));
      case 'open': {
        const a = arg.toLowerCase().replace(/\.app$/, '');
        if (!a) return print(<span className="t-err">usage: open &lt;app|folder&gt;</span>);
        if (appNames[a]) {
          api.open(appNames[a]);
          return print(<span className="t-dim">opening {a}…</span>);
        }
        if (dirMap[a]) {
          api.open('finder', { folder: dirMap[a] });
          return print(<span className="t-dim">opening {a}/…</span>);
        }
        if (/\./.test(a)) {
          api.openUrl(a.startsWith('http') ? a : `https://${a}`);
          return print(<span className="t-dim">opening {a}…</span>);
        }
        return print(<span className="t-err">The application “{arg}” can’t be found. try: {Object.keys(appNames).slice(0, 8).join(', ')}…</span>);
      }
      case 'socials':
        return print(
          ...([
            ['x', links.x],
            ['instagram', links.instagram],
            ['instagram (music)', links.instagramMusic],
            ['linkedin', links.linkedin],
            ['github', links.github],
            ['soundcloud', links.soundcloud],
          ] as const).map(([k, v]) => (
            <span key={k}>
              <span className="t-hl">{k.padEnd(18, ' ')}</span>
              <a href={v} target="_blank" rel="noreferrer">{v.replace('https://', '')}</a>
            </span>
          )),
        );
      case 'contact':
        return print(
          <span>
            email: <a href={`mailto:${profile.email}`}>{profile.email}</a> <span className="t-dim">(or run: open mail)</span>
          </span>,
        );
      case 'neofetch':
        return print(
          <div className="t-neo">
            <pre>{ART}</pre>
            <div>
              <b className="t-hl">guest</b>@<b className="t-hl">joshs-macbook</b>
              <span className="t-dim">-------------------</span>
              {[
                ['OS', 'joshOS 2026 (rebranded)'],
                ['Host', 'Stanford University'],
                ['Kernel', 'CS + Math'],
                ['Uptime', 'since the class of ’28 started'],
                ['Shell', 'coxswain — Stanford Varsity Rowing'],
                ['CPU', "Cognition · Korea"],
                ['Memory', 'CRV · NEAR · Pantera · CodeTree'],
                ['Audio', 'Fairytale · all i need · kelix'],
                ['Locale', 'ko_KR · en_US · zh_CN'],
              ].map(([k, v]) => (
                <span key={k}>
                  <b className="t-hl">{k}</b>: {v}
                </span>
              ))}
              <span className="t-swatch">
                {['#ff5f57', '#febc2e', '#28c840', '#2f8cff', '#bf5af2', '#ff9a8b', '#e6e6e6'].map((c) => (
                  <i key={c} style={{ background: c }} />
                ))}
              </span>
            </div>
          </div>,
        );
      case 'row':
        api.open('coxbox');
        return print(<span className="t-dim">attention… row!</span>);
      case 'date':
        return print(<span>{new Date().toString()}</span>);
      case 'echo':
        return print(<span>{arg}</span>);
      case 'history':
        return print(...hist.map((h, i) => <span key={i} className="t-dim">{String(i + 1).padStart(4, ' ')}  {h}</span>));
      case 'clear':
        return setLines([]);
      case 'exit':
        return api.close('terminal');
      case 'sudo':
        return print(<span className="t-err">guest is not in the sudoers file. this incident will be reported (to josh, who will laugh).</span>);
      default:
        return print(<span className="t-err">zsh: command not found: {cmd}. try <b>help</b></span>);
    }
  };

  const submit = () => {
    const v = input;
    print(
      <span>
        {PROMPT(cwd)} {v}
      </span>,
    );
    if (v.trim()) setHist((h) => [...h, v]);
    setHIdx(-1);
    setInput('');
    run(v, os);
  };

  return (
    <div className="term" onClick={() => window.getSelection()?.isCollapsed && inputRef.current?.focus()}>
      <header className="term-bar" data-drag>
        guest — zsh — 80×24
      </header>
      <div className="term-out">
        {lines.map((l) => (
          <div key={l.id} className="t-line">
            {l.node}
          </div>
        ))}
        <div className="t-line t-input-line" ref={endRef}>
          {PROMPT(cwd)}
          <input
            ref={inputRef}
            value={input}
            aria-label="Terminal input"
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
              else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (!hist.length) return;
                const i = hIdx < 0 ? hist.length - 1 : Math.max(0, hIdx - 1);
                setHIdx(i);
                setInput(hist[i]);
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (hIdx < 0) return;
                const i = hIdx + 1;
                if (i >= hist.length) {
                  setHIdx(-1);
                  setInput('');
                } else {
                  setHIdx(i);
                  setInput(hist[i]);
                }
              } else if (e.key === 'Tab') {
                e.preventDefault();
                const [c, ...r] = input.split(' ');
                if (!r.length) {
                  const m = commands.filter((x) => x.startsWith(c));
                  if (m.length === 1) setInput(m[0] + ' ');
                } else {
                  const pool = c === 'open' ? [...Object.keys(appNames), ...Object.keys(dirMap)] : Object.keys(dirMap);
                  const m = pool.filter((x) => x.startsWith(r.join(' ')));
                  if (m.length === 1) setInput(`${c} ${m[0]}`);
                }
              } else if (e.key === 'l' && e.ctrlKey) {
                e.preventDefault();
                setLines([]);
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}
