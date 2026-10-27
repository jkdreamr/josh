import type { World } from './logic.ts';
import './referee.css';

export function Referee({ world }: { world: World }) {
  const flag = world.rules?.flag;
  if (!flag) return null;
  return (
    <div className="g-soccer-referee" aria-live="polite">
      <div className={`g-soccer-ref-offside ${flag.x < 0 ? 'is-left' : 'is-right'}`} role="status">
        <i aria-hidden="true"><b /></i>
        <span><b>OFFSIDE</b><small>ASSISTANT REFEREE FLAG</small></span>
      </div>
    </div>
  );
}
