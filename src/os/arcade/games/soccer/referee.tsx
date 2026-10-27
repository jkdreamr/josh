import { jerseyNumber, type World } from './logic.ts';
import './referee.css';

const cardLabel = (kind: 'yellow' | 'red' | 'second-yellow') => kind === 'second-yellow'
  ? 'SECOND YELLOW · RED'
  : kind === 'yellow' ? 'YELLOW CARD' : 'RED CARD';

export function Referee({ world }: { world: World }) {
  const rules = world.rules;
  if (!rules) return null;
  const banner = rules.banner;
  const cardKind = banner?.kind === 'yellow' || banner?.kind === 'red' || banner?.kind === 'second-yellow'
    ? banner.kind : null;
  const isOffside = banner?.kind === 'offside';
  const teamName = banner?.team === 0 ? 'BAY CITY' : 'NORTHSHORE';
  return (
    <div className="g-soccer-referee" aria-live="polite">
      {cardKind && banner && (
        <div className={`g-soccer-ref-card is-${cardKind}`} role="status">
          <i aria-hidden="true" />
          <span><b>{cardLabel(cardKind)}</b><small>
            {cardKind !== 'yellow' && 'SENT OFF · '}{teamName} · NO. {jerseyNumber(banner.playerId)}
          </small></span>
        </div>
      )}
      {isOffside && banner && (
        <div className={`g-soccer-ref-offside ${banner.x < 0 ? 'is-left' : 'is-right'}`} role="status">
          <i aria-hidden="true"><b /></i>
          <span><b>OFFSIDE</b><small>ASSISTANT REFEREE FLAG</small></span>
        </div>
      )}
      {rules.advantage && (
        <div className="g-soccer-ref-advantage" role="status">
          <b>ADVANTAGE</b>
          <span aria-label={`${Math.round(rules.advantage.t)} seconds remaining`}>
            <i style={{ transform: `scaleX(${Math.max(0, Math.min(1, rules.advantage.t / 3))})` }} />
          </span>
        </div>
      )}
      {rules.board && (
        <div className="g-soccer-ref-board" role="status">
          <small>ADDED TIME</small><b>+{rules.board.minutes}</b>
        </div>
      )}
    </div>
  );
}
