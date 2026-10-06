import { useEffect, useState } from 'react';
import { siGithub, siInstagram, siX } from 'simple-icons';
import { folders, linkedin, links, profile } from '../data';
import { useOS, type AppProps } from '../types';
import { ExternalIcon, Favicon, openExternal } from '../util';

const Svg = ({ path, size = 16 }: { path: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d={path} />
  </svg>
);

/* --------------------------------- instagram --------------------------------- */

const igAccounts = {
  personal: { handle: 'joshuaykoo', name: 'Joshua Koo', bio: ['stanford', 'cs + math · cox', 'building, investing, making music'], url: links.instagram, hue: 0 },
  music: { handle: 'atkelix', name: 'kelix', bio: ['music', '“fairytale” out now', 'soundcloud.com/atkelix'], url: links.instagramMusic, hue: 1 },
} as const;

export function Instagram({ args }: AppProps) {
  const [acct, setAcct] = useState<'personal' | 'music'>(args.account ?? 'personal');
  useEffect(() => {
    if (args.account) setAcct(args.account);
  }, [args.nonce, args.account]);
  const a = igAccounts[acct];
  return (
    <div className="ig">
      <div className="ig-switch">
        {(Object.keys(igAccounts) as (keyof typeof igAccounts)[]).map((k) => (
          <button key={k} className={k === acct ? 'is-sel' : ''} onClick={() => setAcct(k)}>
            @{igAccounts[k].handle}
          </button>
        ))}
      </div>
      <div className="ig-top">
        <span className={`ig-ring hue-${a.hue}`}>
          <span className="ig-avatar">{a.name === 'kelix' ? 'k' : 'JK'}</span>
        </span>
        <div className="ig-id">
          <h2>{a.handle}</h2>
          <div className="ig-btns">
            <button className="btn btn-ig" onClick={() => openExternal(a.url)}>
              Follow
            </button>
            <button className="btn btn-ghost" onClick={() => openExternal(a.url)}>
              View profile <ExternalIcon size={10} />
            </button>
          </div>
        </div>
      </div>
      <div className="ig-bio">
        <b>{a.name}</b>
        {a.bio.map((l) => (
          <span key={l}>{l}</span>
        ))}
      </div>
      <div className="ig-tabs">
        <span className="is-sel">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><rect x="3" y="3" width="18" height="18" /><path d="M3 9h18M3 15h18M9 3v18M15 3v18" /></svg> POSTS
        </span>
      </div>
      <button className={`ig-grid hue-${a.hue}`} onClick={() => openExternal(a.url)}>
        {Array.from({ length: 9 }, (_, i) => (
          <i key={i} style={{ animationDelay: `${i * 0.12}s` }} />
        ))}
        <span className="ig-grid-cta">
          <Svg path={siInstagram.path} size={22} />
          see posts on Instagram
        </span>
      </button>
    </div>
  );
}

/* ------------------------------------- x ------------------------------------- */

export function XApp(_: AppProps) {
  return (
    <div className="xapp">
      <div className="x-banner" />
      <div className="x-head">
        <span className="x-avatar">JK</span>
        <button className="btn btn-x" onClick={() => openExternal(links.x)}>
          Follow
        </button>
      </div>
      <div className="x-id">
        <h2>{profile.name}</h2>
        <p className="x-handle">@joshuaykoo</p>
        <p className="x-bio">cs + math @ stanford · coxswain · {profile.tagline.toLowerCase()}</p>
        <p className="x-meta">
          <span><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ verticalAlign: -2, marginRight: 3 }} aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.4" /></svg>{profile.location}</span>
          <a href="https://joshuakoo.xyz" target="_blank" rel="noreferrer">joshuakoo.xyz</a>
        </p>
      </div>
      <div className="x-tabs">
        <span className="is-sel">Posts</span>
        <span>Replies</span>
        <span>Media</span>
      </div>
      <button className="x-cta" onClick={() => openExternal(links.x)}>
        <Svg path={siX.path} size={26} />
        <b>see what i’m posting</b>
        <span>
          x.com/joshuaykoo <ExternalIcon size={10} />
        </span>
      </button>
    </div>
  );
}

/* ---------------------------------- linkedin ---------------------------------- */

const work = folders.find((f) => f.id === 'work')!.entries;
const school = folders.find((f) => f.id === 'school')!.entries;

export function LinkedIn(_: AppProps) {
  return (
    <div className="li">
      <div className="li-card">
        <div className="li-banner" />
        <span className="li-avatar">JK</span>
        <div className="li-id">
          <h2>{profile.name}</h2>
          <p className="li-headline">{linkedin.headline}</p>
          <p className="li-muted">Cognition · Stanford University</p>
          <div className="li-btns">
            <button className="btn btn-li" onClick={() => openExternal(links.linkedin)}>
              Connect
            </button>
            <button className="btn btn-li-ghost" onClick={() => openExternal(links.linkedin)}>
              View on LinkedIn <ExternalIcon size={10} />
            </button>
          </div>
        </div>
      </div>
      <section className="li-card li-sec">
        <h3>About</h3>
        <p>{linkedin.about}.</p>
      </section>
      <section className="li-card li-sec">
        <h3>Experience</h3>
        {work.map((w) => (
          <div className="li-row" key={w.name}>
            <Favicon url={w.href} name={w.name} size={44} radius={6} />
            <div>
              <b>{w.role ? w.role.charAt(0).toUpperCase() + w.role.slice(1) : w.name}</b>
              <span>{w.name}</span>
              {w.meta && <small>{w.meta === 'now' ? 'Present' : w.meta}</small>}
            </div>
          </div>
        ))}
      </section>
      <section className="li-card li-sec">
        <h3>Education</h3>
        <div className="li-row">
          <Favicon url="https://www.stanford.edu/" name="Stanford" size={44} radius={6} />
          <div>
            <b>Stanford University</b>
            <span>Computer Science + Mathematics</span>
            <small>Activities: {school.slice(1).map((s) => s.name).join(', ')}</small>
          </div>
        </div>
      </section>
      <section className="li-card li-sec">
        <h3>Projects</h3>
        {linkedin.projects.map((p) => (
          <div className="li-plain" key={p.title}>
            <b>{p.title}</b>
            <span>{p.blurb}</span>
          </div>
        ))}
      </section>
      <section className="li-card li-sec">
        <h3>Honors &amp; awards</h3>
        {linkedin.awards.map((a) => (
          <div className="li-plain" key={a.title}>
            <b>{a.title}</b>
            <span>{a.meta}</span>
          </div>
        ))}
      </section>
      <section className="li-card li-sec">
        <h3>Publications</h3>
        {linkedin.publications.map((p) => (
          <div className="li-plain" key={p.title}>
            <b>{p.title}</b>
            <span>{p.meta}</span>
          </div>
        ))}
      </section>
      <section className="li-card li-sec">
        <h3>Languages</h3>
        {linkedin.languages.map((l) => (
          <div className="li-plain" key={l.name}>
            <b>{l.name}</b>
            <span>{l.level} proficiency</span>
          </div>
        ))}
      </section>
    </div>
  );
}

/* ----------------------------------- github ----------------------------------- */

type GhUser = { login: string; name: string | null; bio: string | null; avatar_url: string; public_repos: number; followers: number; following: number };
type GhRepo = { id: number; name: string; description: string | null; language: string | null; stargazers_count: number; html_url: string; fork: boolean; pushed_at: string };

const langColor: Record<string, string> = { TypeScript: '#3178c6', JavaScript: '#f1e05a', Python: '#3572A5', HTML: '#e34c26', CSS: '#563d7c', Astro: '#ff5a03', Swift: '#F05138', Rust: '#dea584', Go: '#00ADD8' };

let ghCache: Promise<{ user: GhUser; repos: GhRepo[] } | null> | null = null;
const loadGh = () =>
  (ghCache ??= Promise.all([
    fetch('https://api.github.com/users/jkdreamr').then((r) => (r.ok ? r.json() : Promise.reject())),
    fetch('https://api.github.com/users/jkdreamr/repos?per_page=100&sort=pushed').then((r) => (r.ok ? r.json() : Promise.reject())),
  ])
    .then(([user, repos]) => ({ user: user as GhUser, repos: (repos as GhRepo[]).filter((r) => !r.fork).slice(0, 8) }))
    .catch(() => {
      ghCache = null;
      return null;
    }));

export function GitHub(_: AppProps) {
  const os = useOS();
  const [data, setData] = useState<{ user: GhUser; repos: GhRepo[] } | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    loadGh().then((d) => alive && setData(d));
    return () => {
      alive = false;
    };
  }, []);
  const user = data?.user;
  return (
    <div className="gh">
      <aside className="gh-side">
        {user ? <img src={user.avatar_url} alt="" width={120} height={120} /> : <span className="gh-avatar"><Svg path={siGithub.path} size={56} /></span>}
        <h2>{user?.name ?? profile.name}</h2>
        <p className="gh-login">jkdreamr</p>
        {user?.bio && <p className="gh-bio">{user.bio}</p>}
        <button className="btn btn-gh" onClick={() => openExternal(links.github)}>
          Follow <ExternalIcon size={10} />
        </button>
        {user && (
          <p className="gh-stats">
            <b>{user.followers}</b> followers · <b>{user.following}</b> following
          </p>
        )}
      </aside>
      <div className="gh-main">
        <h3>{data ? 'Recently pushed' : 'Repositories'}</h3>
        {data === undefined && <div className="gh-skel">{Array.from({ length: 4 }, (_, i) => <i key={i} />)}</div>}
        {data === null && (
          <div className="gh-off">
            <p>GitHub is rate-limiting this browser right now.</p>
            <button className="btn btn-gh" onClick={() => openExternal(links.github)}>
              See repos on github.com <ExternalIcon size={10} />
            </button>
          </div>
        )}
        {data && (
          <div className="gh-repos">
            {data.repos.map((r) => (
              <button key={r.id} className="gh-repo" onClick={() => openExternal(r.html_url)}>
                <b>{r.name}</b>
                <span>{r.description ?? 'no description'}</span>
                <small>
                  {r.language && (
                    <>
                      <i style={{ background: langColor[r.language] ?? '#8b949e' }} />
                      {r.language}
                    </>
                  )}
                  {r.stargazers_count > 0 && <> · ★ {r.stargazers_count}</>}
                </small>
              </button>
            ))}
          </div>
        )}
        <button className="gh-term" onClick={() => os.open('terminal')}>
          prefer a shell? <b>open terminal →</b>
        </button>
      </div>
    </div>
  );
}
