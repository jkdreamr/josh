import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, type Ref } from 'react';
import { FIELD, type World } from './logic.ts';
import { recordSoccerHudCommit, soccerPerfEnabled } from './perf.ts';
import { EventBanner, GoalBanner, PlayerTag, Scoreboard, Ticker } from './presentation.tsx';
import { setPieceLabels, shootoutScore } from './setpieces.ts';
import { clubById, matchKits, rosterName } from './teams.ts';
export type HudState = {
  score0: number;
  score1: number;
  clock: string;
  added: number | null;
  half: 1 | 2;
  phase: World['phase'];
  event: string;
  eventKey: number;
  eventTime: number;
  selectedId: number;
  stamina: number;
  state: string | null;
  targetId: number | null;
  power: number | null;
  replaying: boolean;
  statsVersion: number;
  presentation: 'intro' | 'live' | 'half-time' | 'full-time';
};

export type RadarHandle = { draw(world: World, targetId?: number | null): void };

export const Hud = memo(function Hud({ state, watching, radarRef, world }: {
  state: HudState;
  watching: boolean;
  radarRef: Ref<RadarHandle>;
  world: World;
}) {
  const live = state.presentation === 'live';
  const selected = world.players[state.selectedId];
  const labels = setPieceLabels(world, selected?.team ?? 0, selected?.id);
  const pens = shootoutScore(world);
  const clubs = [clubById(world.clubs?.[0]), clubById(world.clubs?.[1])] as const;
  const kits = matchKits(clubs[0], clubs[1]);
  useEffect(() => {
    if (soccerPerfEnabled) recordSoccerHudCommit();
  }, [state]);
  return (
    <div className="g-soccer-hud">
      <Scoreboard score0={state.score0} score1={state.score1} clock={state.clock} added={state.added} half={state.half} clubs={clubs} kits={kits} />
      {(labels || world.shootout) && <div className="g-soccer-setpiece-status">
        {world.shootout && <div>PENS {pens.join(' - ')} <span className="g-soccer-pen-dots">{world.shootout.kicks.map((kicks, team) => <span key={team} aria-label={`${clubs[team]?.name ?? `Team ${team + 1}`} penalties`}>{kicks.map((scored, i) => <i key={i} className={scored ? 'is-scored' : 'is-missed'} aria-label={scored ? 'scored' : 'missed'} />)}</span>)}</span></div>}
        {labels && <small>{labels.title}</small>}
      </div>}
      {live && <>
        <EventBanner key={state.eventKey} event={state.event} eventKey={state.eventKey} eventTime={state.eventTime} phase={state.phase} />
        <GoalBanner statsVersion={state.statsVersion} />
        <Ticker statsVersion={state.statsVersion} />
        <PlayerTag selectedId={state.selectedId} stamina={state.stamina} state={state.state} power={state.power} playerName={selected ? rosterName(clubs[selected.team], selected.id % 11) : 'player'} />
      </>}
      <Radar ref={radarRef} world={world} />
      {state.replaying && <div className="g-soccer-replay">replay</div>}
      {watching && <div className="g-soccer-watching">watching</div>}
    </div>
  );
});

const Radar = memo(forwardRef<RadarHandle, { world: World }>(function Radar({ world }, ref) {
  const dots = useRef<(HTMLElement | null)[]>([]);
  const ball = useRef<HTMLElement | null>(null);
  const draw = useCallback((world: World, targetId: number | null = world.passTarget) => {
    for (const player of world.players) {
      const dot = dots.current[player.id];
      if (!dot) continue;
      const x = (player.x + FIELD.length / 2) / FIELD.length * 100;
      const z = (player.z + FIELD.width / 2) / FIELD.width * 100;
      dot.style.left = `${x}%`;
      dot.style.top = `${z}%`;
      dot.classList.toggle('is-controlled', player.controlled);
      dot.classList.toggle('is-target', player.id === targetId);
    }
    if (ball.current) {
      const x = (world.ball.x + FIELD.length / 2) / FIELD.length * 100;
      const z = (world.ball.z + FIELD.width / 2) / FIELD.width * 100;
      ball.current.style.left = `${x}%`;
      ball.current.style.top = `${z}%`;
    }
  }, []);
  useImperativeHandle(ref, () => ({ draw }), [draw]);
  useLayoutEffect(() => {
    draw(world);
  }, [draw, world]);
  return (
    <div className="g-soccer-radar" aria-label="match radar">
      <div className="g-soccer-radar-half" />
      <div className="g-soccer-radar-circle" />
      {Array.from({ length: 22 }, (_, id) => (
        <i
          key={id}
          ref={(element) => { dots.current[id] = element; }}
          className={`g-soccer-radar-dot ${id < 11 ? 'is-home' : 'is-away'}`}
        />
      ))}
      <i ref={(element) => { ball.current = element; }} className="g-soccer-radar-ball" />
    </div>
  );
}));
