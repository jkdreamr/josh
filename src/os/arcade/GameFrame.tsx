import { Component, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { isLoadError, reloadedRecently, reloadInto, siteState, type Resume } from '../reload';
import { ArcadeInvite } from './kit/host';
import { getMeta, loaders } from './manifest';
import type { GameMeta } from './types';

type BoundaryProps = { children: ReactNode; fallback: (error: unknown, retry: () => void) => ReactNode };

class Boundary extends Component<BoundaryProps, { failed: boolean; error: unknown }> {
  state = { failed: false, error: null as unknown };
  static getDerivedStateFromError(error: unknown) {
    return { failed: true, error };
  }
  retry = () => this.setState({ failed: false, error: null });
  render() {
    return this.state.failed ? this.props.fallback(this.state.error, this.retry) : this.props.children;
  }
}

function Notice({ title, body, compact, actions }: { title: string; body: string; compact?: boolean; actions?: ReactNode }) {
  return (
    <div className={`arcade-notice ${compact ? 'is-compact' : ''}`} role="alert">
      <b>{title}</b>
      <span>{body}</span>
      {actions && <div className="arcade-notice-row">{actions}</div>}
    </div>
  );
}

function Loading({ meta, compact }: { meta: GameMeta; compact?: boolean }) {
  return (
    <div className={`arcade-loading ${compact ? 'is-compact' : ''}`} aria-label={`Loading ${meta.title}`}>
      <span className="arcade-spin" style={{ borderTopColor: meta.accent }} />
    </div>
  );
}

type FrameProps = { meta: GameMeta; compact?: boolean; onExit?: () => void; resume?: Resume };

/**
 * The game's code didn't load. Nearly always the page is older than the files the site still keeps. Never reload on
 * our own (another window may hold a half-written message): say what happened and offer a reload that comes straight
 * back to this game.
 */
function Missing({ meta, compact, onExit, resume }: FrameProps) {
  const [state, setState] = useState<'checking' | 'offline' | 'down' | 'updated' | 'failed' | 'broken'>('checking');
  const live = useRef(true);
  const check = () => {
    setState('checking');
    siteState().then((site) => live.current && setState(site !== 'current' ? site : reloadedRecently() ? 'broken' : 'failed'));
  };
  useEffect(() => {
    live.current = true;
    check();
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    if (state !== 'offline') return;
    window.addEventListener('online', check);
    return () => window.removeEventListener('online', check);
  }, [state]);

  if (state === 'checking') return <Loading meta={meta} compact={compact} />;
  const didnt = `${meta.title} didn't load`;
  const reload = { label: 'Reload', run: () => reloadInto(resume) };
  const retry = { label: 'Try again', run: check };
  const { title, body, action } = {
    offline: { title: didnt, body: "you're offline. connect to the internet and try again.", action: retry },
    down: { title: didnt, body: "the site isn't answering. give it a minute and try again.", action: retry },
    updated: { title: `${meta.title} was updated`, body: "reload to play the new version. you'll land right back here.", action: reload },
    failed: { title: didnt, body: "the download was interrupted. reload and you'll land right back here.", action: reload },
    broken: { title: didnt, body: "something's off on our end. give it a minute and try again.", action: { ...reload, label: 'Try again' } },
  }[state];
  return (
    <Notice
      title={title}
      body={body}
      compact={compact}
      actions={
        <>
          <button className="btn btn-primary" onClick={action.run}>{action.label}</button>
          {onExit && <button className="btn btn-ghost" onClick={onExit}>Back to arcade</button>}
        </>
      }
    />
  );
}

/**
 * Loads a game by id with a spinner. If its code won't load, offers a reload that comes back to it (`resume` says
 * how to reopen it). If the game itself throws, offers a restart instead of a blank page.
 */
export function GameFrame({ id, compact, onExit, roomCode, resume }: { id: string; compact?: boolean; onExit?: () => void; roomCode?: string; resume?: Resume }) {
  const meta = getMeta(id);
  const Game = loaders[id];
  if (!meta || !Game)
    return (
      <Notice
        title="game not found"
        body={`there's no game called "${id}" in the arcade.`}
        compact={compact}
        actions={onExit && <button className="btn btn-primary" onClick={onExit}>Back to arcade</button>}
      />
    );
  return (
    <Boundary
      fallback={(error, retry) =>
        isLoadError(error) ? (
          <Missing meta={meta} compact={compact} onExit={onExit} resume={resume} />
        ) : (
          <Notice
            title={`${meta.title} hit a snag`}
            body="something broke while it was running. a restart usually fixes it."
            compact={compact}
            actions={
              <>
                <button className="btn btn-primary" onClick={retry}>Restart</button>
                {onExit && <button className="btn btn-ghost" onClick={onExit}>Back to arcade</button>}
              </>
            }
          />
        )
      }
    >
      <Suspense fallback={<Loading meta={meta} compact={compact} />}>
        <ArcadeInvite.Provider value={roomCode}>
          <Game compact={compact} onExit={onExit} roomCode={roomCode} />
        </ArcadeInvite.Provider>
      </Suspense>
    </Boundary>
  );
}
