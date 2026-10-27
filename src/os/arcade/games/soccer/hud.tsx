import { FIELD, jerseyNumber, matchClock, type World } from './logic.ts';
import { clubById, matchKits, rosterName } from './teams.ts';
import { Crest } from './crest.tsx';

export function Hud({ world, targetId, selectedId, watching, replaying, power, contain }: { world: World; targetId: number | null; selectedId?: number; watching: boolean; replaying: boolean; power?: number | null; contain?: boolean }) {
  const clubs = [clubById(world.clubs?.[0]), clubById(world.clubs?.[1])] as const;
  const kits = matchKits(clubs[0], clubs[1]);
  const clock = matchClock(world);
  const selected = world.players[selectedId ?? world.controlled[0]];
  const state = selected?.action === 'jockey' ? contain ? 'CONTAIN' : 'JOCKEY' : selected?.action === 'shield' ? 'SHIELD'
    : selected?.slide ? 'SLIDE' : selected && Math.hypot(selected.vx, selected.vz) > 7.1 ? 'SPRINT' : null;
  return (
    <div className="g-soccer-hud">
      <div className="g-soccer-scoreboard">
        <div className="g-soccer-club g-soccer-home"><Crest club={clubs[0]} size={17} /><i style={{ backgroundColor: kits.home.shirt }} />{clubs[0].short}</div>
        <strong>{world.score[0]} <span>:</span> {world.score[1]}</strong>
        <div className="g-soccer-club g-soccer-away">{clubs[1].short}<i style={{ backgroundColor: kits.away.shirt }} /><Crest club={clubs[1]} size={17} /></div>
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
        <span>{selected ? rosterName(clubs[selected.team], selected.id % 11) : 'player'}</span>
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
