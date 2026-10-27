import { useEffect, useState } from 'react';
import { FIELD, jerseyNumber, matchClock, type World } from './logic.ts';
import { recordSoccerHudCommit, soccerPerfEnabled } from './perf.ts';

type HudPlayer = Pick<World['players'][number], 'id' | 'team' | 'x' | 'z' | 'controlled' | 'action' | 'stamina' | 'vx' | 'vz' | 'slot'> & { slide: boolean };
type HudWorld = Pick<World, 'clock' | 'halfLength' | 'half' | 'score' | 'event' | 'eventTime' | 'phase'> & {
  players: HudPlayer[];
  ball: Pick<World['ball'], 'x' | 'z'>;
};
export type HudModel = {
  world: HudWorld;
  targetId: number | null;
  selectedId: number;
  watching: boolean;
  replaying: boolean;
  power: number | null;
  contain: boolean;
  state: string | null;
};

export function createHudModel(world: World, targetId: number | null, selectedId: number, power: number | null, contain: boolean, watching: boolean, replaying: boolean): HudModel {
  const round = (value: number, step: number) => Math.round(value / step) * step;
  const selected = world.players[selectedId];
  const state = selected?.action === 'jockey' ? contain ? 'CONTAIN' : 'JOCKEY' : selected?.action === 'shield' ? 'SHIELD'
    : selected?.slide ? 'SLIDE' : selected && Math.hypot(selected.vx, selected.vz) > 7.1 ? 'SPRINT' : null;
  return {
    world: {
      clock: world.clock,
      halfLength: world.halfLength,
      half: world.half,
      score: [world.score[0], world.score[1]],
      event: world.event,
      eventTime: round(world.eventTime, 0.1),
      phase: world.phase,
      players: world.players.map((player) => ({
        id: player.id, team: player.team, x: round(player.x, 0.05), z: round(player.z, 0.05),
        controlled: player.controlled, action: player.action, slide: !!player.slide,
        stamina: round(player.stamina, 0.02), vx: player.vx, vz: player.vz, slot: player.slot,
      })),
      ball: { x: round(world.ball.x, 0.05), z: round(world.ball.z, 0.05) },
    },
    targetId,
    selectedId,
    power: power === null ? null : round(power, 0.02),
    contain,
    watching,
    replaying,
    state,
  };
}

function sameHudModel(a: HudModel, b: HudModel) {
  const aw = a.world, bw = b.world;
  if (matchClock(aw) !== matchClock(bw) || aw.halfLength !== bw.halfLength || aw.half !== bw.half
    || aw.score[0] !== bw.score[0] || aw.score[1] !== bw.score[1] || aw.event !== bw.event
    || aw.eventTime !== bw.eventTime || aw.phase !== bw.phase || a.targetId !== b.targetId
    || a.selectedId !== b.selectedId || a.power !== b.power || a.contain !== b.contain
    || a.watching !== b.watching || a.replaying !== b.replaying || a.state !== b.state
    || aw.ball.x !== bw.ball.x || aw.ball.z !== bw.ball.z || aw.players.length !== bw.players.length) return false;
  for (let i = 0; i < aw.players.length; i++) {
    const ap = aw.players[i]!, bp = bw.players[i]!;
    if (ap.x !== bp.x || ap.z !== bp.z || ap.controlled !== bp.controlled
      || ap.stamina !== bp.stamina || ap.action !== bp.action || ap.slide !== bp.slide) return false;
  }
  return true;
}

export function Hud({ source }: { source: { current: (model: HudModel) => void } }) {
  const [model, setModel] = useState<HudModel | null>(null);
  useEffect(() => {
    const publish = (next: HudModel) => setModel((previous) => !previous || !sameHudModel(previous, next) ? next : previous);
    source.current = publish;
    return () => { if (source.current === publish) source.current = () => {}; };
  }, [source]);
  useEffect(() => {
    if (soccerPerfEnabled) recordSoccerHudCommit();
  }, [model]);
  if (!model) return null;
  const { world, targetId, selectedId, watching, replaying, power, state } = model;
  const clock = matchClock(world);
  const selected = world.players[selectedId];
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

function Radar({ world, targetId }: { world: HudWorld; targetId: number | null }) {
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
