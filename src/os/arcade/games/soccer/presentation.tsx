import { createContext, memo, useContext, useEffect, useRef, useState, type CSSProperties } from 'react';
import { CLUBS, broadcastClock, passAccuracy, playerName, possessionShare, type MatchStats, type TickerItem, type TeamStats } from './broadcast.ts';
import { FORMATION, jerseyNumber, teamOf, type World } from './logic.ts';

export type Presentation = 'intro' | 'live' | 'half-time' | 'full-time';
export type MatchData = { world: World | null; stats: MatchStats | null };
type MatchRef = { current: MatchData | null };
export const MatchContext = createContext<MatchRef | null>(null);

export const Scoreboard = memo(function Scoreboard({ score0, score1, clock, added, half }: {
  score0: number;
  score1: number;
  clock: string;
  added: number | null;
  half: 1 | 2;
}) {
  return (
    <div className="g-soccer-scoreboard">
      <div className="g-soccer-club g-soccer-home"><i /><b>{CLUBS[0].abbr}</b></div>
      <strong key={score0} className="g-soccer-score-home">{score0}</strong>
      <span className="g-soccer-score-separator">:</span>
      <strong key={score1} className="g-soccer-score-away">{score1}</strong>
      <div className="g-soccer-club g-soccer-away"><b>{CLUBS[1].abbr}</b><i /></div>
      <div className="g-soccer-clock"><b>{clock}</b>{added !== null && <em>+{added}</em>}</div>
      <small className="g-soccer-half">{half === 1 ? '1st half' : '2nd half'}</small>
    </div>
  );
});

export const EventBanner = memo(function EventBanner({ event, eventTime, eventKey, phase }: {
  event: string;
  eventTime: number;
  eventKey: number;
  phase: World['phase'];
}) {
  if (!event || eventTime <= 0 || phase === 'goal' || /goal!$/i.test(event)) return null;
  return (
    <div key={eventKey} className="g-soccer-banner">
      <b>{event}</b>
    </div>
  );
});

export const GoalBanner = memo(function GoalBanner({ statsVersion }: { statsVersion: number }) {
  const match = useContext(MatchContext);
  const [goal, setGoal] = useState<TickerItem | null>(null);
  const lastGoal = useRef(0);
  useEffect(() => {
    const item = match?.current?.stats?.goals.at(-1);
    if (!item) {
      lastGoal.current = 0;
      setGoal(null);
      return;
    }
    if (item.id === lastGoal.current) return;
    lastGoal.current = item.id;
    setGoal(item);
  }, [match, statsVersion]);
  useEffect(() => {
    if (!goal) return;
    const timer = window.setTimeout(() => setGoal(null), 4500);
    return () => window.clearTimeout(timer);
  }, [goal?.id]);
  if (!goal) return null;
  const club = goal.team === 1 ? CLUBS[1] : CLUBS[0];
  const score = match?.current?.world?.score ?? [0, 0];
  const scorer = goal.scorer === undefined ? 'unknown player' : playerName(goal.scorer);
  return (
    <div key={goal.id} className={`g-soccer-goal-banner${goal.kind === 'own-goal' ? ' is-own-goal' : ''}`} style={{ '--g-soccer-goal': club.primary, '--g-soccer-goal-ink': club.secondary } as CSSProperties}>
      <div className="g-soccer-goal-word">{goal.kind === 'own-goal' ? 'own goal' : 'goal'}</div>
      <div className="g-soccer-goal-copy">
        <span>{goal.minute} · {club.short}</span>
        <b>{scorer}</b>
        {goal.assist != null && <small>assist {playerName(goal.assist)}</small>}
      </div>
      <strong>{CLUBS[0].abbr} {score[0]} - {score[1]} {CLUBS[1].abbr}</strong>
    </div>
  );
});

const tickerGlyph: Record<TickerItem['kind'], string> = {
  goal: '⚽', 'own-goal': '↗', save: '●', corner: '◢', foul: '!', penalty: '●', chance: '↗', 'half-time': 'Ⅱ', 'full-time': 'Ⅲ',
};

export const Ticker = memo(function Ticker({ statsVersion }: { statsVersion: number }) {
  const match = useContext(MatchContext);
  const items = match?.current?.stats?.ticker.filter((item) => item.kind !== 'half-time' && item.kind !== 'full-time').slice(-3) ?? [];
  if (!items.length) return null;
  return (
    <div className="g-soccer-ticker" aria-live="polite" data-version={statsVersion}>
      {items.map((item) => (
        <div className={`g-soccer-ticker-item is-${item.kind}`} key={item.id}>
          <time>{item.minute}</time>
          <i aria-hidden="true">{tickerGlyph[item.kind]}</i>
          <span>{item.text}</span>
        </div>
      ))}
    </div>
  );
});

export function PowerMeter({ power }: { power: number }) {
  return (
    <div className={`g-soccer-power${power > 0.85 ? ' is-over' : ''}`} role="progressbar" aria-label="Kick power" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(power * 100)}>
      <i style={{ width: `${power * 100}%` }} /><span>85%</span>
    </div>
  );
}

export const PlayerTag = memo(function PlayerTag({ selectedId, stamina, state, power }: {
  selectedId: number;
  stamina: number;
  state: string | null;
  power: number | null;
}) {
  const team = teamOf(selectedId);
  const level = stamina > 0.6 ? 'high' : stamina > 0.3 ? 'mid' : 'low';
  return (
    <div className="g-soccer-player-tag">
      <b className={`g-soccer-player-number is-team-${team}`}>{jerseyNumber(selectedId)}</b>
      <div className="g-soccer-player-name">
        <strong>{playerName(selectedId)}</strong>
        <small>{FORMATION[selectedId % 11]!.slot}</small>
      </div>
      <div className={`g-soccer-stamina is-${level}`}><i><em style={{ width: `${stamina * 100}%` }} /></i></div>
      {state && <strong className="g-soccer-state">{state.toLowerCase()}</strong>}
      {power != null && <PowerMeter power={power} />}
    </div>
  );
});

export function IntroCard() {
  return (
    <div className="g-soccer-intro" aria-label="matchday">
      <div className="g-soccer-intro-card">
        <small>matchday · harbor park</small>
        <div className="g-soccer-intro-clubs">
          {CLUBS.map((club) => (
            <span key={club.abbr} className="g-soccer-intro-crest" style={{ '--g-soccer-crest': club.primary, '--g-soccer-crest-ink': club.secondary } as CSSProperties}><b>{club.abbr}</b></span>
          ))}
        </div>
        <h1><b>{CLUBS[0].name}</b><span>vs</span><b>{CLUBS[1].name}</b></h1>
        <p>4-3-3 · 4-3-3 <i /> harbor park · kick off</p>
        <div className="g-soccer-intro-rosters">
          {CLUBS.map((club) => (
            <section key={club.abbr}>
              <h2>{club.short}</h2>
              <ol>
                {club.roster.map((name, index) => (
                  <li key={name}><span>{index + 1}</span><b>{name}</b><small>{FORMATION[index]!.slot}</small></li>
                ))}
              </ol>
            </section>
          ))}
        </div>
        <strong className="g-soccer-intro-hint">press any button to skip</strong>
      </div>
    </div>
  );
}

const emptyStats: TeamStats = {
  goals: 0, shots: 0, onTarget: 0, passes: 0, completed: 0, tackles: 0,
  fouls: 0, corners: 0, saves: 0, xg: 0, possession: 0,
};

export function StatsScreen({ presentation, statsVersion }: { presentation: 'half-time' | 'full-time'; statsVersion: number }) {
  const match = useContext(MatchContext);
  const stats = match?.current?.stats;
  const home = stats?.teams[0] ?? emptyStats;
  const away = stats?.teams[1] ?? emptyStats;
  const score = match?.current?.world?.score ?? [0, 0];
  const [seconds, setSeconds] = useState(10);
  useEffect(() => {
    if (presentation !== 'half-time') return;
    const started = Date.now();
    const update = () => setSeconds(Math.max(0, 10 - Math.floor((Date.now() - started) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [presentation]);
  const [homePossession, awayPossession] = stats ? possessionShare(stats) : [50, 50];
  const rows: { label: string; home: number; away: number; displayHome: string; displayAway: string }[] = [
    { label: 'possession', home: homePossession, away: awayPossession, displayHome: `${homePossession}%`, displayAway: `${awayPossession}%` },
    { label: 'shots', home: home.shots, away: away.shots, displayHome: `${home.shots}`, displayAway: `${away.shots}` },
    { label: 'shots on target', home: home.onTarget, away: away.onTarget, displayHome: `${home.onTarget}`, displayAway: `${away.onTarget}` },
    { label: 'xg', home: home.xg, away: away.xg, displayHome: home.xg.toFixed(1), displayAway: away.xg.toFixed(1) },
    { label: 'passes', home: home.passes, away: away.passes, displayHome: `${home.passes}`, displayAway: `${away.passes}` },
    { label: 'pass accuracy', home: passAccuracy(home), away: passAccuracy(away), displayHome: `${passAccuracy(home)}%`, displayAway: `${passAccuracy(away)}%` },
    { label: 'tackles', home: home.tackles, away: away.tackles, displayHome: `${home.tackles}`, displayAway: `${away.tackles}` },
    { label: 'fouls', home: home.fouls, away: away.fouls, displayHome: `${home.fouls}`, displayAway: `${away.fouls}` },
    { label: 'corners', home: home.corners, away: away.corners, displayHome: `${home.corners}`, displayAway: `${away.corners}` },
    { label: 'saves', home: home.saves, away: away.saves, displayHome: `${home.saves}`, displayAway: `${away.saves}` },
  ];
  return (
    <div className="g-soccer-stats-overlay" data-version={statsVersion}>
      <section className="g-soccer-stats-panel">
        <header><small>harbor park · match report</small><h2>{presentation === 'half-time' ? 'half time' : 'full time'}</h2></header>
        <div className="g-soccer-stats-score">
          <i className="is-home" /><b className="is-home">{CLUBS[0].abbr}</b><strong>{score[0]}</strong><span>:</span><strong>{score[1]}</strong><b className="is-away">{CLUBS[1].abbr}</b><i className="is-away" />
        </div>
        <div className="g-soccer-scorers">
          {[0, 1].map((team) => (
            <div key={team}>
              {stats?.goals.filter((goal) => goal.team === team).map((goal) => (
                <span key={goal.id}>{goal.scorer === undefined ? 'unknown player' : playerName(goal.scorer)} <small>{goal.minute}{goal.kind === 'own-goal' ? ' · og' : ''}</small></span>
              ))}
            </div>
          ))}
        </div>
        <div className="g-soccer-stat-rows">
          {rows.map((row) => {
            const total = row.home + row.away || 1;
            return (
              <div className="g-soccer-stat-row" key={row.label}>
                <b>{row.displayHome}</b><span>{row.label}</span><b>{row.displayAway}</b>
                <i className="g-soccer-stat-bar"><em style={{ width: `${row.home / total * 50}%` }} /><small style={{ width: `${row.away / total * 50}%` }} /></i>
              </div>
            );
          })}
        </div>
        <footer>{presentation === 'half-time' ? `second half starts in ${seconds}s · press any button` : 'press any button to continue'}</footer>
      </section>
    </div>
  );
}

export function PausePanel({ match }: { match: MatchData }) {
  if (!match.world || !match.stats) return null;
  const { world, stats } = match;
  const clock = broadcastClock(world, stats);
  const [homePossession, awayPossession] = possessionShare(stats);
  const home = stats.teams[0];
  const away = stats.teams[1];
  return (
    <section className="g-soccer-pause-panel">
      <div className="g-soccer-pause-score">
        <i className="is-home" /><b className="is-home">{CLUBS[0].abbr}</b><strong>{world.score[0]}</strong><span>:</span><strong>{world.score[1]}</strong><b className="is-away">{CLUBS[1].abbr}</b><i className="is-away" /><time>{clock.label}</time>
      </div>
      <div className="g-soccer-pause-stats">
        <span>possession <b>{homePossession}-{awayPossession}%</b></span>
        <span>shots <b>{home.shots}-{away.shots}</b></span>
        <span>on target <b>{home.onTarget}-{away.onTarget}</b></span>
        <span>xg <b>{home.xg.toFixed(1)}-{away.xg.toFixed(1)}</b></span>
      </div>
      <ul>{stats.ticker.slice(-3).map((item) => <li key={item.id}><time>{item.minute}</time> {item.text}</li>)}</ul>
    </section>
  );
}
