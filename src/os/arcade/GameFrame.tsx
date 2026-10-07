import { Component, Suspense, useState, type ReactNode } from 'react';
import { getMeta, loaders, reloadGame } from './manifest';

type BoundaryProps = { children: ReactNode; fallback: (retry: () => void) => ReactNode; onRetry: () => void };

class Boundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  retry = () => {
    this.props.onRetry();
    this.setState({ failed: false });
  };
  render() {
    return this.state.failed ? this.props.fallback(this.retry) : this.props.children;
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

/** Loads a game by id with a spinner, and shows a friendly tile instead of a blank page if it fails. */
export function GameFrame({ id, compact, onExit }: { id: string; compact?: boolean; onExit?: () => void }) {
  const meta = getMeta(id);
  const [Game, setGame] = useState(() => loaders[id]);
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
      onRetry={() => setGame(() => reloadGame(id))}
      fallback={(retry) => (
        <Notice
          title={`${meta.title} didn't load`}
          body="something went wrong starting this game. check your connection and try again."
          compact={compact}
          actions={
            <>
              <button className="btn btn-primary" onClick={retry}>Try again</button>
              {onExit && <button className="btn btn-ghost" onClick={onExit}>Back to arcade</button>}
            </>
          }
        />
      )}
    >
      <Suspense
        fallback={
          <div className={`arcade-loading ${compact ? 'is-compact' : ''}`} aria-label={`Loading ${meta.title}`}>
            <span className="arcade-spin" style={{ borderTopColor: meta.accent }} />
          </div>
        }
      >
        <Game compact={compact} onExit={onExit} />
      </Suspense>
    </Boundary>
  );
}
