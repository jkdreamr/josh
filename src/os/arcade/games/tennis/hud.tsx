import type { World } from './logic.ts';
import { pointLabel, scoreText, serverOf } from './logic.ts';
import { rallyCounterLabel } from './replay.ts';
import { characterOf, TEMPO_MAX } from './roster.ts';
import type { CSSProperties } from 'react';

export type HudModel = {
  world: World;
  seat: number | null;
  watching: boolean;
  call: string;
  timing: 'early' | 'perfect' | 'late' | '';
  bounceCue: boolean;
  rallyShots?: number;
  replaying?: boolean;
  feedback?: 'PERFECT!' | 'NICE!' | 'Smash!' | '';
  touch?: boolean;
  shout?: string;
  intro?: boolean;
  wipe?: number;
};

const lengthLabels = { game: '1 game', three: 'first to 2', set: '1 set' } as const;

function teamNames(world: World, team: number, seat: number | null, watching: boolean) {
  return world.players
    .filter((player) => player.team === team)
    .map((player) => player.seat === seat && !watching ? 'you' : player.name)
    .join(' + ') || `team ${team === 0 ? 'a' : 'b'}`;
}

export function Hud({ world, seat, watching, call, timing, bounceCue, rallyShots = 0, replaying = false, feedback = '', touch = false, shout = '', intro = false, wipe = 0 }: HudModel) {
  const server = serverOf(world);
  const rally = rallyCounterLabel(rallyShots);
  const pointA = world.match.tiebreak ? String(world.match.tbPoints[0]) : world.match.points[0] >= 3 && world.match.points[1] >= 3 ? world.match.points[0] === world.match.points[1] ? '40' : world.match.points[0] > world.match.points[1] ? 'AD' : '40' : pointLabel(world.match.points[0]);
  const pointB = world.match.tiebreak ? String(world.match.tbPoints[1]) : world.match.points[0] >= 3 && world.match.points[1] >= 3 ? world.match.points[0] === world.match.points[1] ? '40' : world.match.points[1] > world.match.points[0] ? 'AD' : '40' : pointLabel(world.match.points[1]);
  const meTeam = world.players.find((player) => player.seat === seat)?.team;
  return (
    <div className="g-tennis-hud" aria-live="polite">
      <div className="g-tennis-brand"><b>KOO OPEN</b><small>Palo Alto</small></div>
      <section className="g-tennis-scorebar" aria-label="Match score">
        {([0, 1] as const).map((team) => (
          <div className={`g-tennis-side g-tennis-side-${team === 0 ? 'a' : 'b'}${meTeam === team ? ' g-tennis-side-me' : ''}`} key={team}>
            <div className="g-tennis-side-label">
              <span className="g-tennis-team-dot" />
              <span>{teamNames(world, team, seat, watching)}</span>
              {server?.team === team && <i className="g-tennis-serving" aria-label="serving" />}
            </div>
            <div className="g-tennis-tempo" aria-label="tempo">
              {world.players.filter((player) => player.team === team).map((player) => (
                <span key={player.seat} style={{ '--kit': characterOf(player.character).shirt } as CSSProperties}>
                  {Array.from({ length: TEMPO_MAX }, (_, index) => <i key={index} className={index < player.tempo ? 'on' : ''} />)}
                </span>
              ))}
            </div>
            <div className="g-tennis-score-numbers">
              {world.match.length === 'set' && <b className="g-tennis-sets">{world.match.sets[team]}</b>}
              <b className="g-tennis-games">{world.match.games[team]}</b>
              <b className="g-tennis-point">{team === 0 ? pointA : pointB}</b>
            </div>
          </div>
        ))}
      </section>
      <div className="g-tennis-status">
        <div className="g-tennis-call" aria-live="assertive">{call || (world.phase === 'serve-ready' ? 'first serve' : world.phase === 'serve-toss' ? 'time your serve' : world.phase === 'rally' || world.phase === 'serve-flight' ? scoreText(world) : '')}</div>
        {world.serveSpeed > 0 && world.callClock > 0.05 && <div className="g-tennis-speed">{world.serveSpeed}<small> km/h</small></div>}
      </div>
      {wipe > 0 && <div className="g-tennis-wipe" key={wipe} aria-hidden="true"><span>KOO OPEN · REPLAY</span></div>}
      {replaying && <div className="g-tennis-replay-tag">REPLAY</div>}
      {intro && !replaying && (
        <div className="g-tennis-intro" role="status">
          <small>Koo Open · {lengthLabels[world.match.length]}</small>
          <strong>{world.players.filter((player) => player.team === 0).map((player) => player.name).join(' + ')}</strong>
          <em>vs</em>
          <strong>{world.players.filter((player) => player.team === 1).map((player) => player.name).join(' + ')}</strong>
        </div>
      )}
      {shout && !intro && !replaying && <div className="g-tennis-shout" key={shout}>{shout}</div>}
      {rally && <div className="g-tennis-rally-chip">{rally}</div>}
      {bounceCue && <div className="g-tennis-bounce-cue" role="status">Bounce! Swing!</div>}
      {feedback && <div className={`g-tennis-feedback g-tennis-feedback-${feedback === 'PERFECT!' ? 'perfect' : feedback === 'NICE!' ? 'nice' : 'smash'}`}>{feedback}</div>}
      {timing && <div className={`g-tennis-timing g-tennis-timing-${timing}`}><span className="g-tennis-timing-ring" />{timing}</div>}
      <div className="g-tennis-controls-hint">
        {touch
          ? null
          : <span>WASD/arrows move · Space topspin · K slice · I lob · U drop · L flat</span>}
      </div>
      {watching && <div className="g-tennis-watch-label">watching</div>}
    </div>
  );
}
