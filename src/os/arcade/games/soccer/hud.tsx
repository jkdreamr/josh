import { FIELD, jerseyNumber, type World } from './logic.ts';
import { clockLabel } from './rules.ts';

export function Hud({ world, targetId, selectedId, watching, replaying, power, contain }: { world: World; targetId: number | null; selectedId?: number; watching: boolean; replaying: boolean; power?: number | null; contain?: boolean }) {
  const clock = clockLabel(world);
  const selected = world.players[selectedId ?? world.controlled[0]];
  const state = selected?.action === 'jockey' ? contain ? 'CONTAIN' : 'JOCKEY' : selected?.action === 'shield' ? 'SHIELD'
    : selected?.slide ? 'SLIDE' : selected && Math.hypot(selected.vx, selected.vz) > 7.1 ? 'SPRINT' : null;
  return (
    <div className="g-soccer-hud">
      <div className="g-soccer-scoreboard">
        <div className="g-soccer-club g-soccer-home"><i />BAY</div>
        <strong>{world.score[0]} <span>:</span> {world.score[1]}</strong>
        <div className="g-soccer-club g-soccer-away">NSU<i /></div>
        <div className="g-soccer-clock"><b>{clock}'</b><span>{world.half === 1 ? '1ST HALF' : '2ND HALF'}</span></div>
      </div>
      {world.eventTime > 0 && world.event && (
        <div
          key={world.event}
          className={`g-soccer-banner ${world.phase === 'goal' ? 'is-goal' : ''}`}
          style={{ animationDuration: `${Math.max(0.8, world.eventTime)}s` }}
        >
          <b>{world.event}</b>
        </div>
      )}
      <div className="g-soccer-player-tag">
        <b>NO. {selected ? jerseyNumber(selected.id) : 8}</b>
        <span>{selected?.slot === 'ST' ? 'M. RIVERA' : selected?.slot === 'GK' ? 'A. MORGAN' : selected?.slot === 'CM' ? 'J. KIM' : 'D. PARK'}</span>
        <small>stamina</small><i><em style={{ width: `${(selected?.stamina ?? 1) * 100}%` }} /></i>
        {state && <strong className="g-soccer-state">{state}</strong>}
        {power != null && <PowerMeter power={power} />}
      </div>
      <Radar world={world} targetId={targetId} />
      {replaying && <div className="g-soccer-replay">REPLAY</div>}
      {watching && <div className="g-soccer-watching">watching</div>}
    </div>
  );
}

export function PowerMeter({ power }: { power: number }) {
  return <div className={`g-soccer-power${power > 0.85 ? ' is-over' : ''}`} role="progressbar" aria-label="Kick power" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(power * 100)}>
    <i style={{ width: `${power * 100}%` }} /><span>85%</span>
  </div>;
}

function Radar({ world, targetId }: { world: World; targetId: number | null }) {
  const x = (value: number) => `${((value + FIELD.length / 2) / FIELD.length) * 100}%`;
  const z = (value: number) => `${((value + FIELD.width / 2) / FIELD.width) * 100}%`;
  return (
    <div className="g-soccer-radar" aria-label="Match radar">
      <div className="g-soccer-radar-half" />
      <div className="g-soccer-radar-circle" />
      {world.players.filter((player) => !player.sentOff).map((player) => (
        <i
          key={player.id}
          className={`g-soccer-radar-dot ${player.team === 0 ? 'is-home' : 'is-away'}${player.id === targetId ? ' is-target' : ''}${player.controlled ? ' is-controlled' : ''}`}
          style={{ left: x(player.x), top: z(player.z) }}
        />
      ))}
      <i className="g-soccer-radar-ball" style={{ left: x(world.ball.x), top: z(world.ball.z) }} />
    </div>
  );
}
