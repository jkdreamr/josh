import { useSoccerLoad } from './load.ts';
import './loading.css';

/** A slim progress bar for the stadium loading in the background; fades out once it's ready. */
export function LoadProgress({ className = '' }: { className?: string }) {
  const { progress, ready } = useSoccerLoad();
  const percent = Math.round(progress * 100);
  return (
    <div className={`g-soccer-load ${ready ? 'is-ready' : ''} ${className}`} role="progressbar" aria-label="Loading stadium" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-hidden={ready || undefined}>
      <span className="g-soccer-load-track"><span className="g-soccer-load-fill" style={{ transform: `scaleX(${Math.max(0.02, progress)})` }} /></span>
      <span className="g-soccer-load-label">{ready ? 'Stadium ready' : `Loading stadium · ${percent}%`}</span>
    </div>
  );
}
