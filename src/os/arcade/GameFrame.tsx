import { Component, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { isChunkError, reloadInto, siteReachable, type Resume } from '../reload';
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
 * The game's file didn't download. Nearly always the site was redeployed since this page loaded and the old file
 * is gone, so keep the spinner up and reload onto the new deploy, which reopens this game. Offline, wait instead.
 */
function Missing({ meta, compact, onExit, resume }: FrameProps) {
  const [state, setState] = useState<'checking' | 'offline' | 'failed'>('checking');
  const live = useRef(true);
  const check = (force: boolean) => {
    setState('checking');
    siteReachable().then((ok) => {
      if (!live.current || (ok && reloadInto(resume, { force }))) return;
      setState(ok ? 'failed' : 'offline');
    });
  };
  useEffect(() => {
    live.current = true;
    check(false);
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    if (state !== 'offline') return;
    const online = () => check(true);
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, [state]);

  if (state === 'checking') return <Loading meta={meta} compact={compact} />;
  return (
    <Notice
      title={`${meta.title} didn't load`}
      body={state === 'offline' ? "you're offline. it'll start on its own once you're back." : 'the download failed. give it another try in a moment.'}
      compact={compact}
      actions={
        <>
          <button className="btn btn-primary" onClick={() => check(true)}>Try again</button>
          {onExit && <button className="btn btn-ghost" onClick={onExit}>Back to arcade</button>}
        </>
      }
    />
  );
}

/**
 * Loads a game by id with a spinner. If its file is gone after a deploy, reloads the page and comes back to it
 * (`resume` says how to reopen it). If the game itself throws, offers a restart instead of a blank page.
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
        isChunkError(error) ? (
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
