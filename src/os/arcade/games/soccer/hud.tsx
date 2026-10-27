import { FIELD, jerseyNumber, matchClock, type World } from './logic.ts';

export function Hud({ world, targetId, selectedId, watching, replaying }: { world: World; targetId: number | null; selectedId?: number; watching: boolean; replaying: boolean }) {
  const clock = matchClock(world);
  const selected = world.players[selectedId ?? world.controlled[0]];
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
      </div>
      <Radar world={world} targetId={targetId} />
      {replaying && <div className="g-soccer-replay">REPLAY</div>}
      {watching && <div className="g-soccer-watching">watching</div>}
    </div>
  );
}

function Radar({ world, targetId }: { world: World; targetId: number | null }) {
  const x = (value: number) => `${((value + FIELD.length / 2) / FIELD.length) * 100}%`;
  const z = (value: number) => `${((value + FIELD.width / 2) / FIELD.width) * 100}%`;
  return (
    <div className="g-soccer-radar" aria-label="Match radar">
      <div className="g-soccer-radar-half" />
      <div className="g-soccer-radar-circle" />
      {world.players.map((player) => (
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
