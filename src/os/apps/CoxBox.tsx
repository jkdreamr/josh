import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { boatMetrics, callPower10, catchStroke, createRace, startSignal, step, type BoatMetrics, type BoatSpec, type Race, type TracePoint } from '../games/rowing';
import { getBoard, submit, type LeaderboardResult, type RaceDistance } from '../games/leaderboard';
import { useOS, type AppProps } from '../types';
import './game-controls.css';
import './CoxBox.css';

type Mode = 'solo' | 'friend';
type Opponent = 'none' | 'best' | 'jv' | 'cal' | 'world';
type Screen = 'setup' | 'calling' | 'race' | 'finish' | 'leaderboard';
type Preferences = { mode: Mode; distance: RaceDistance; opponent: Opponent; name: string; mute: boolean };
type PersonalBest = { timeMs: number; trace: TracePoint[] };

const DEFAULT_PREFS: Preferences = { mode: 'solo', distance: 500, opponent: 'none', name: '', mute: false };
const DISTANCES: RaceDistance[] = [500, 1000, 2000];
const BOT_PROFILES: Record<'jv' | 'cal' | 'world', { label: string; color: string; accent: string }> = {
  jv: { label: 'JV', color: '#6b8e7d', accent: '#e6f0e9' },
  cal: { label: 'Cal', color: '#003262', accent: '#fdb515' },
  world: { label: 'World Best', color: '#87949a', accent: '#f4f0e7' },
};

function formatTime(seconds: number | null | undefined, decimals = 2): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '--:--.--';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds - minutes * 60).toFixed(decimals).padStart(decimals + 3, '0')}`;
}

function formatPace(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '--:--.-';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds - minutes * 60).toFixed(1).padStart(4, '0')}`;
}

function raceLabel(distance: RaceDistance): string {
  return distance === 1000 ? '1k' : `${distance}m`;
}

function marginLabel(meters: number): string {
  const distance = Math.abs(meters);
  if (distance >= 4.5) return `${(distance / 18).toFixed(1)} lengths`;
  if (distance >= 2.2) {
    const seats = Math.max(1, Math.round(distance / 2.2));
    return `${seats} seat${seats === 1 ? '' : 's'}`;
  }
  return 'by a bow ball';
}

function readPreferences(): Preferences {
  try {
    const value = JSON.parse(localStorage.getItem('coxbox-prefs') ?? 'null');
    if (!value || typeof value !== 'object') return DEFAULT_PREFS;
    return {
      mode: value.mode === 'friend' ? 'friend' : 'solo',
      distance: DISTANCES.includes(value.distance) ? value.distance : 500,
      opponent: ['none', 'best', 'jv', 'cal', 'world'].includes(value.opponent) ? value.opponent : 'none',
      name: typeof value.name === 'string' ? value.name.slice(0, 16) : '',
      mute: value.mute === true,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function readPersonalBest(distance: RaceDistance): PersonalBest | null {
  try {
    const value = JSON.parse(localStorage.getItem(`coxbox-pb-${distance}`) ?? 'null');
    if (Array.isArray(value)) return { timeMs: (value.at(-1)?.t ?? 0) * 1000, trace: value };
    if (!value || !Array.isArray(value.trace) || !Number.isFinite(value.timeMs)) return null;
    return value as PersonalBest;
  } catch {
    return null;
  }
}

function BoatSvg({ metrics, color, accent, ghost = false }: { metrics: BoatMetrics; color: string; accent: string; ghost?: boolean }) {
  const progress = metrics.phase === 'drive' ? metrics.fraction : 1 - metrics.fraction;
  return (
    <svg className="cox-hull-svg" viewBox="0 0 100 232" role="img" aria-label={`${metrics.name} rowing`}>
      {Array.from({ length: 8 }, (_, i) => {
        const y = 27 + i * 23;
        const side = i % 2 === 0 ? -1 : 1;
        const angle = -0.34 + progress * 0.68;
        const endX = 50 + side * 43 * Math.cos(angle);
        const endY = y + side * 43 * Math.sin(angle);
        return (
          <g className="cox-oar" key={i}>
            {metrics.phase === 'drive' && <ellipse cx={endX} cy={endY + 4} rx="5.5" ry="2.3" />}
            <line x1={50 + side * 8} y1={y} x2={endX} y2={endY} />
            <circle cx={50 + side * 8} cy={y} r="3.1" />
          </g>
        );
      })}
      <path className="cox-hull" d="M50 4 C42 14 35 36 35 67 L39 195 Q50 222 61 195 L65 67 C65 36 58 14 50 4Z" fill={color} />
      <path className="cox-hull-accent" d="M50 16 L50 198" stroke={accent} />
      <path className="cox-stern" d="M40 193 Q50 203 60 193 L57 210 Q50 217 43 210Z" fill={accent} />
      {Array.from({ length: 8 }, (_, i) => {
        const y = 27 + i * 23;
        const shift = (progress - 0.5) * 4;
        return (
          <g className="cox-seat-rower" key={i} transform={`translate(0 ${shift})`}>
            <path className="cox-rower-body" d={`M46 ${y - 1} Q50 ${y - 4} 54 ${y - 1} L53 ${y + 5} L47 ${y + 5}Z`} />
            <circle className="cox-rower-head" cx="50" cy={y - 5} r="2.4" />
          </g>
        );
      })}
      <path className="cox-coxswain-body" d="M46 214 Q50 209 54 214 L53 220 L47 220Z" />
      <circle className="cox-coxswain" cx="50" cy="211" r="2.7" />
      {ghost && <path className="cox-ghost-wash" d="M50 4 C42 14 35 36 35 67 L39 195 Q50 222 61 195 L65 67 C65 36 58 14 50 4Z" />}
    </svg>
  );
}

function MetricsPanel({ metrics, compact = false }: { metrics: BoatMetrics; compact?: boolean }) {
  return (
    <div className={`cox-metrics ${compact ? 'is-compact' : ''}`}>
      <div className="cox-primary-metrics">
        <div className="cox-big-metric">
          <small>Rate</small>
          <b>{metrics.rate === null ? '--' : Math.round(metrics.rate)}</b>
          <span>spm</span>
        </div>
        <div className="cox-big-metric">
          <small>Split</small>
          <b>{formatPace(metrics.split)}</b>
          <span>/500 m</span>
        </div>
        <div className="cox-small-metric"><small>Time</small><b>{formatTime(metrics.elapsed)}</b></div>
        <div className="cox-small-metric"><small>Meters</small><b>{Math.floor(metrics.distance)}</b></div>
      </div>
      <div className="cox-secondary-metrics">
        <span><small>Avg split</small><b>{metrics.distance < 50 ? '--' : formatPace(metrics.avgSplit)}</b></span>
        <span><small>Strokes</small><b>{metrics.strokes}</b></span>
        <span><small>Dps</small><b>{metrics.dps === null ? '--' : metrics.dps.toFixed(1)} m</b></span>
      </div>
      {!compact && (
        <div className="cox-bio-metrics">
          <div className="cox-legs-meter">
            <span><small>Legs</small><b>{Math.round(metrics.legs * 100)}%</b></span>
            <i><em style={{ width: `${metrics.legs * 100}%` }} /></i>
          </div>
          <div className="cox-swing-meter">
            <span><small>Swing</small><b>{Math.round(metrics.swing * 100)}%</b></span>
            <i><em style={{ width: `${metrics.swing * 100}%` }} /></i>
          </div>
          <div className="cox-power-pips" aria-label={`${metrics.power10} power tens remaining`}>
            <small>Power 10</small>
            <span>{Array.from({ length: metrics.power10Max }, (_, i) => <i key={i} className={i < metrics.power10 ? 'is-ready' : ''} />)}</span>
            {metrics.power10Left > 0 && <b>{metrics.power10Left} left</b>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function CoxBox(_: AppProps) {
  const os = useOS();
  const rootRef = useRef<HTMLDivElement>(null);
  const riverRef = useRef<HTMLDivElement>(null);
  const raceRef = useRef<Race | null>(null);
  const timerRef = useRef<number | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const traceRef = useRef<TracePoint[]>([]);
  const traceNextRef = useRef(0.1);
  const callHoldRef = useRef(0);
  const callRef = useRef('');
  const lastRateRef = useRef<number | null>(null);
  const settleCalledRef = useRef(false);
  const finishedRef = useRef(false);
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [screen, setScreen] = useState<Screen>('setup');
  const [metrics, setMetrics] = useState<BoatMetrics[]>([]);
  const [callText, setCallText] = useState('sit ready when you are.');
  const [falseStart, setFalseStart] = useState(false);
  const [rowSignal, setRowSignal] = useState(false);
  const [pbAvailable, setPbAvailable] = useState(false);
  const [riverHeight, setRiverHeight] = useState(300);
  const [names, setNames] = useState(['', 'friend']);
  const [boardDistance, setBoardDistance] = useState<RaceDistance>(500);
  const [board, setBoard] = useState<LeaderboardResult>({ entries: [], scope: 'device' });
  const [boardLoading, setBoardLoading] = useState(false);
  const [posting, setPosting] = useState<number | null>(null);
  const [posted, setPosted] = useState<Array<{ name: string; timeMs: number; rank: number | null } | null>>([null, null]);
  const [highlight, setHighlight] = useState<{ name: string; timeMs: number } | null>(null);

  useEffect(() => {
    const saved = readPreferences();
    setPrefs(saved);
    setNames([saved.name, 'friend']);
    setPrefsLoaded(true);
    setPbAvailable(Boolean(readPersonalBest(saved.distance)));
  }, []);

  useEffect(() => {
    setNames((current) => [prefs.name, current[1] || 'friend']);
  }, [prefs.name]);

  useEffect(() => {
    if (window.matchMedia('(pointer: fine)').matches) rootRef.current?.focus();
  }, [screen]);

  useEffect(() => {
    if (!prefsLoaded) return;
    try {
      localStorage.setItem('coxbox-prefs', JSON.stringify(prefs));
    } catch {
      // preferences are optional
    }
  }, [prefs, prefsLoaded]);

  useEffect(() => setPbAvailable(Boolean(readPersonalBest(prefs.distance))), [prefs.distance]);

  useEffect(() => {
    if (screen !== 'leaderboard') return;
    let alive = true;
    setBoardLoading(true);
    getBoard(boardDistance).then((result) => {
      if (!alive) return;
      setBoard(result);
      setBoardLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [screen, boardDistance]);

  useEffect(() => {
    if (screen !== 'race' || !riverRef.current) return;
    const river = riverRef.current;
    const update = () => setRiverHeight(river.clientHeight || 300);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(river);
    return () => observer.disconnect();
  }, [screen]);

  const setCall = useCallback((text: string, force = false) => {
    const now = performance.now();
    if (!force && now < callHoldRef.current) return;
    if (callRef.current !== text) {
      callRef.current = text;
      setCallText(text);
    }
    callHoldRef.current = now + 1200;
  }, []);

  const playBeep = useCallback(() => {
    if (prefs.mute || !audioRef.current) return;
    const context = audioRef.current;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 740;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.18);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.19);
  }, [prefs.mute]);

  const buildRace = useCallback(() => {
    const specs: BoatSpec[] = prefs.mode === 'friend'
      ? [
          { kind: 'human', name: 'p1', color: '#8c1515' },
          { kind: 'human', name: 'p2', color: '#003262' },
        ]
      : [{ kind: 'human', name: 'you', color: '#8c1515' }];
    if (prefs.mode === 'solo' && prefs.opponent !== 'none') {
      if (prefs.opponent === 'best') {
        const best = readPersonalBest(prefs.distance);
        if (best) specs.push({ kind: 'replay', name: 'your best', color: '#d9eaf0', trace: best.trace });
      } else {
        const profile = BOT_PROFILES[prefs.opponent];
        specs.push({ kind: 'bot', profile: prefs.opponent, name: profile.label, color: profile.color });
      }
    }
    const race = createRace({ distance: prefs.distance, boats: specs });
    raceRef.current = race;
    traceRef.current = [{ t: 0, d: 0 }];
    traceNextRef.current = 0.1;
    setMetrics(race.boats.map((_, index) => boatMetrics(race, index)));
    return race;
  }, [prefs.distance, prefs.mode, prefs.opponent]);

  const beginStart = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    const race = buildRace();
    finishedRef.current = false;
    lastRateRef.current = null;
    settleCalledRef.current = false;
    setFalseStart(false);
    setRowSignal(false);
    setScreen('calling');
    setCall('attention.', true);
    if (!prefs.mute && !audioRef.current) {
      try {
        audioRef.current = new AudioContext();
        void audioRef.current.resume().catch(() => undefined);
      } catch {
        audioRef.current = null;
      }
    }
    timerRef.current = window.setTimeout(() => {
      if (raceRef.current !== race) return;
      startSignal(race);
      setScreen('race');
      setRowSignal(true);
      setCall('high ten!', true);
      playBeep();
      timerRef.current = window.setTimeout(() => setRowSignal(false), 650);
    }, 800 + Math.random() * 1700);
  }, [buildRace, playBeep, prefs.mute, setCall]);

  const triggerCatch = useCallback((index: number) => {
    const race = raceRef.current;
    if (!race) return;
    const result = catchStroke(race, index);
    if (result === 'false-start') {
      setFalseStart(true);
      setCall('false start. back it down.', true);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => beginStart(), 1300);
      return;
    }
    if (result !== 'caught') return;
    const row = boatMetrics(race, index);
    if (row.power10Left > 0) setCall(`power ten! ${row.power10Left} to go. this is ours.`, true);
    else if (row.strokes <= 10) setCall('high ten!', true);
    setMetrics(race.boats.map((_, i) => boatMetrics(race, i)));
  }, [beginStart, setCall]);

  const triggerPower10 = useCallback((index: number) => {
    const race = raceRef.current;
    if (!race || !callPower10(race, index)) return;
    setCall('power ten in two… this is ours.', true);
    setMetrics(race.boats.map((_, i) => boatMetrics(race, i)));
  }, [setCall]);

  const showMenu = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    setRowSignal(false);
    setScreen('setup');
    setFalseStart(false);
    callRef.current = '';
    setCall('sit ready when you are.', true);
    rootRef.current?.focus();
  }, [setCall]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
    const key = event.key.toLowerCase();
    if (key === 'f') {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    let action: (() => void) | null = null;
    if (screen === 'calling' || screen === 'race') {
      if (prefs.mode === 'friend') {
        if (key === 'a') action = () => triggerCatch(0);
        else if (key === 'q') action = () => triggerPower10(0);
        else if (key === 'l') action = () => triggerCatch(1);
        else if (key === 'p') action = () => triggerPower10(1);
      } else if (event.code === 'Space' || key === ' ') action = () => triggerCatch(0);
      else if (key === 'p') action = () => triggerPower10(0);
    }
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    action();
  };

  useEffect(() => {
    if (screen !== 'race') return;
    let frame = 0;
    let lastFrame = performance.now();
    const tick = (now: number) => {
      const race = raceRef.current;
      if (!race || !race.started) {
        frame = requestAnimationFrame(tick);
        return;
      }
      const dt = Math.min(0.25, (now - lastFrame) / 1000);
      lastFrame = now;
      const previousTime = race.elapsed;
      const previousDistance = race.boats[0].distance;
      step(race, dt);
      const nextMetrics = race.boats.map((_, index) => boatMetrics(race, index));
      setMetrics(nextMetrics);
      const own = nextMetrics[0];
      const sampleUntil = Math.min(race.elapsed, own.finishTime ?? race.elapsed);
      const endDistance = own.finishTime === null ? own.distance : prefs.distance;
      while (traceNextRef.current <= sampleUntil + 1e-9) {
        const ratio = sampleUntil > previousTime ? (traceNextRef.current - previousTime) / (sampleUntil - previousTime) : 0;
        const distance = previousDistance + (endDistance - previousDistance) * Math.max(0, Math.min(1, ratio));
        traceRef.current.push({ t: traceNextRef.current, d: distance });
        traceNextRef.current = Math.round((traceNextRef.current + 0.1) * 10) / 10;
      }
      const opponent = nextMetrics[1];
      const previousRate = lastRateRef.current;
      if (!settleCalledRef.current && own.rate !== null && previousRate !== null && own.rate < previousRate - 1) {
        settleCalledRef.current = true;
        setCall('settle in two… one… two.', true);
      }
      if (own.rate !== null) lastRateRef.current = own.rate;
      if (own.strokes > 10 && own.power10Left <= 0) {
        const gap = opponent ? own.distance - opponent.distance : 0;
        let phrase = 'long and strong.';
        if (own.distance >= prefs.distance - 40) phrase = 'last ten!';
        else if (own.distance >= prefs.distance - 250) phrase = 'last 250, sprint! up two!';
        else if (own.lenRush < 0.999) phrase = 'rushing the slide. let it run.';
        else if (own.legs < 0.2) phrase = 'legs are going, stay long.';
        else if (own.rate !== null && own.rate > 42) phrase = 'too high, sit up and settle.';
        else if (opponent && Math.abs(gap) > 18) phrase = gap > 0 ? "we've got open water." : `we're down in open water to ${opponent.name}, walk on them.`;
        else if (opponent && Math.abs(gap) >= 2.2) phrase = gap > 0 ? `we're up ${marginLabel(gap)} on ${opponent.name}.` : `we're down ${marginLabel(gap)} on ${opponent.name}, walk on them.`;
        else if (opponent && Math.abs(gap) > 0.1) phrase = gap > 0 ? `we're up ${marginLabel(gap)} on ${opponent.name}.` : `we're down ${marginLabel(gap)} on ${opponent.name}, walk on them.`;
        else if (own.swing > 0.8) phrase = "there it is, that's swing.";
        else if (own.rate !== null && own.rate >= 31 && own.rate <= 37) phrase = "that's our base. long and strong.";
        if (callRef.current !== phrase) setCall(phrase);
      }
      if (race.finished && !finishedRef.current) {
        finishedRef.current = true;
        const finishTime = own.finishTime ?? race.elapsed;
        const last = traceRef.current.at(-1);
        if (!last || last.t < finishTime) traceRef.current.push({ t: finishTime, d: prefs.distance });
        const saved = readPersonalBest(prefs.distance);
        if (!saved || finishTime * 1000 < saved.timeMs) {
          try {
            localStorage.setItem(`coxbox-pb-${prefs.distance}`, JSON.stringify({ timeMs: finishTime * 1000, trace: traceRef.current }));
          } catch {
            // a local replay is optional
          }
        }
        setMetrics(nextMetrics);
        setScreen('finish');
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [prefs.distance, screen, setCall]);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    audioRef.current?.close().catch(() => undefined);
  }, []);

  const updatePrefs = (patch: Partial<Preferences>) => setPrefs((value) => ({ ...value, ...patch }));
  const currentMetrics = metrics;
  const humanCount = prefs.mode === 'friend' ? 2 : 1;
  const ownMetrics = currentMetrics[0];
  const opponentMetrics = currentMetrics[1];
  const gap = ownMetrics && opponentMetrics ? ownMetrics.distance - opponentMetrics.distance : 0;
  const lanes = prefs.mode === 'friend' ? 2 : prefs.opponent === 'none' ? 2 : 3;
  const scale = 0.82;
  const visibleMeters = riverHeight / scale;
  const camera = ownMetrics && opponentMetrics && prefs.mode === 'friend' && Math.abs(gap) > visibleMeters * 0.85
    ? Math.max(ownMetrics.distance, opponentMetrics.distance)
    : ownMetrics && opponentMetrics && prefs.mode === 'friend'
      ? (ownMetrics.distance + opponentMetrics.distance) / 2
      : ownMetrics?.distance ?? 0;
  const firstBuoy = Math.floor((camera - visibleMeters / 2) / 10);
  const buoyMarkers = Array.from({ length: Math.ceil(visibleMeters / 10) + 2 }, (_, index) => (firstBuoy + index) * 10)
    .filter((distance) => distance >= 0 && distance <= prefs.distance);
  const farPlayer = prefs.mode === 'friend' && Math.abs(gap) > visibleMeters * 0.85
    ? gap > 0 ? { name: opponentMetrics?.name ?? 'p2', distance: Math.abs(gap) } : { name: ownMetrics?.name ?? 'p1', distance: Math.abs(gap) }
    : null;
  const markers = Array.from({ length: Math.floor(prefs.distance / 250) }, (_, index) => (index + 1) * 250);

  const paletteFor = (index: number) => {
    const boat = raceRef.current?.boats[index];
    if (boat?.kind === 'replay') return { color: '#d9eaf0', accent: '#ffffff', ghost: true };
    if (boat?.kind === 'bot' && boat.profile) {
      const profile = BOT_PROFILES[boat.profile];
      return { color: profile.color, accent: profile.accent, ghost: false };
    }
    return { color: boat?.color ?? (index === 1 ? '#003262' : '#8c1515'), accent: index === 1 ? '#fdb515' : '#f5d8d8', ghost: false };
  };

  const marginFor = (index: number) => {
    const own = currentMetrics[index];
    const other = currentMetrics[index === 0 ? 1 : 0];
    if (!own?.finishTime || !other?.finishTime) return null;
    const seconds = other.finishTime - own.finishTime;
    return { seconds, lengths: Math.abs(seconds) * (prefs.distance / own.finishTime) / 18 };
  };

  const postTime = async (index: number) => {
    const row = currentMetrics[index];
    if (!row?.finishTime) return;
    const name = names[index]?.trim().slice(0, 16) || (index === 0 ? 'rower' : 'friend');
    setPosting(index);
    const result = await submit({
      distance: prefs.distance,
      name,
      timeMs: Math.round(row.finishTime * 1000),
      avgRate: Math.round((row.strokes * 60) / row.finishTime),
      strokes: row.strokes,
    });
    const timeMs = Math.round(row.finishTime * 1000);
    const rank = result.entries.findIndex((entry) => entry.name === name && entry.timeMs === timeMs);
    setPosted((current) => current.map((value, i) => i === index ? { name, timeMs, rank: rank >= 0 ? rank + 1 : null } : value));
    setHighlight({ name, timeMs });
    setBoard(result);
    setPosting(null);
    if (index === 0) updatePrefs({ name });
  };

  const rowPointer = (index: number) => (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    triggerCatch(index);
  };

  return (
    <div className={`cox gc-light phase-${screen} ${os.mobile ? 'is-mobile' : ''} ${os.fullscreen ? 'is-fullscreen' : ''}`} style={{ '--tint': '#8c1515' } as CSSProperties} ref={rootRef} tabIndex={0} onKeyDown={handleKeyDown}>
      {screen === 'setup' && (
        <div className="cox-setup">
          <div className="cox-setup-main">
            <div className="cox-brand">
              <div className="cox-brand-mark">08<span>+</span></div>
                <div><h1>Cox Box</h1><p>Find the rhythm. Take the line.</p></div>
            </div>
            <div className="cox-control-group">
              <span className="glabel">Crew</span>
              <div className="gseg">
                <button aria-pressed={prefs.mode === 'solo'} onClick={() => updatePrefs({ mode: 'solo' })}>Solo</button>
                <button aria-pressed={prefs.mode === 'friend'} onClick={() => updatePrefs({ mode: 'friend', opponent: 'none' })}>Vs Friend</button>
              </div>
            </div>
            <div className="cox-control-group">
              <span className="glabel">Distance</span>
              <div className="gseg">
                {DISTANCES.map((distance) => <button key={distance} aria-pressed={prefs.distance === distance} onClick={() => updatePrefs({ distance })}>{distance === 500 ? '500 m' : distance === 1000 ? '1,000 m' : '2,000 m'}</button>)}
              </div>
            </div>
            {prefs.mode === 'solo' && (
              <div className="cox-control-group">
                <span className="glabel">Pace boat</span>
                <div className="gseg">
                  {(['none', 'best', 'jv', 'cal', 'world'] as const).map((opponent) => (
                    <button
                      key={opponent}
                      aria-pressed={prefs.opponent === opponent}
                      disabled={opponent === 'best' && !pbAvailable}
                      onClick={() => updatePrefs({ opponent })}
                    >
                      {opponent === 'none' ? 'None' : opponent === 'best' ? 'Your Best' : BOT_PROFILES[opponent].label}
                    </button>
                  ))}
                </div>
                {prefs.opponent === 'best' && pbAvailable && <small className="ghelp cox-helper">your fastest {raceLabel(prefs.distance)} piece</small>}
              </div>
            )}
            <div className="cox-control-group cox-name-field">
              <label className="glabel" htmlFor="cox-name">Your name</label>
              <input
                id="cox-name"
                className="ginput"
                maxLength={16}
                value={prefs.name}
                onChange={(event) => {
                  updatePrefs({ name: event.target.value.slice(0, 16) });
                  setNames((current) => [event.target.value.slice(0, 16), current[1]]);
                }}
                placeholder="name on the board"
              />
            </div>
            <div className="cox-setup-actions">
              <button className="gbtn gbtn-primary gbtn-lg" onClick={beginStart}>Start Race</button>
              <button className="gbtn" onClick={() => { setBoardDistance(prefs.distance); setScreen('leaderboard'); }}>Leaderboard</button>
              <button className="gbtn gbtn-plain" onClick={() => updatePrefs({ mute: !prefs.mute })}>{prefs.mute ? 'Sound Off' : 'Sound On'}</button>
            </div>
          </div>
          <aside className="cox-setup-side">
            <div className="cox-device">
              <div className="cox-device-top"><i /><i /><i /><span>cox box · 08</span></div>
              <div className="cox-device-screen">
                <small>ready for a piece</small><strong>00:00.0</strong>
                <div><span>rate</span><b>--</b><span>split</span><b>--:--.-</b></div>
              </div>
              <div className="cox-device-bottom"><i /><i /><i /></div>
            </div>
            <div className="cox-control-hint">
              <p className="ghelp cox-keyboard-help">{prefs.mode === 'friend' ? 'A and Q for P1 · L and P for P2' : 'Space to row · P for a power ten'}</p>
              <span className="cox-control-note">Hold your rhythm. Let the boat run.</span>
            </div>
          </aside>
        </div>
      )}

      {screen === 'calling' && (
        <div className="cox-call-screen">
          <header className="cox-screen-top"><span className="cox-brand-mini"><i /> Cox Box</span><button className="gbtn gbtn-plain" onClick={() => updatePrefs({ mute: !prefs.mute })}>{prefs.mute ? 'Sound Off' : 'Sound On'}</button></header>
          <div className={`cox-attention ${falseStart ? 'has-false-start' : ''}`}>
            <span className="cox-signal-light" />
            <small className="cox-call-detail">{raceLabel(prefs.distance)} · {prefs.mode === 'friend' ? 'Two Seats' : prefs.opponent === 'none' ? 'Solo Piece' : `With ${prefs.opponent === 'best' ? 'Your Best' : BOT_PROFILES[prefs.opponent].label}`}</small>
            <h1>{falseStart ? 'False Start' : 'Attention'}</h1>
            <p>{falseStart ? 'back it down. let the boat settle.' : 'sit ready. wait for the light.'}</p>
          </div>
          <div className="cox-call-controls">
            <span className="ghelp cox-keyboard-help">{prefs.mode === 'friend' ? 'A and Q for P1 · L and P for P2' : 'Space to row · P for a power ten'}</span>
            {prefs.mode === 'friend' ? (
              <div className="cox-friend-buttons">
                <div className="cox-player-touch-controls">
                  <span className="cox-player-caption">P1</span>
                  <button className="gpad" title="Row (A)" onPointerDown={rowPointer(0)}>Row</button>
                </div>
                <div className="cox-player-touch-controls" style={{ '--tint': '#003262' } as CSSProperties}>
                  <span className="cox-player-caption">P2</span>
                  <button className="gpad" title="Row (L)" onPointerDown={rowPointer(1)}>Row</button>
                </div>
              </div>
            ) : (
              <button className="gpad" title="Row (Space)" onPointerDown={rowPointer(0)}>Row</button>
            )}
          </div>
        </div>
      )}

      {screen === 'race' && ownMetrics && (
        <div className={`cox-race ${prefs.mode === 'friend' ? 'is-friend-race' : ''}`}>
          {rowSignal && <div className="cox-row-signal"><i /><b>row!</b></div>}
          <header className="cox-race-head">
            <span className="cox-brand-mini"><i /> Cox Box</span>
            <div className="cox-race-status"><span className="cox-live-dot" /> {raceLabel(prefs.distance)} piece</div>
            <button className="gbtn gbtn-plain" onClick={() => updatePrefs({ mute: !prefs.mute })}>{prefs.mute ? 'Sound Off' : 'Sound On'}</button>
          </header>
          {prefs.mode === 'friend' ? (
            <div className="cox-friend-huds">
              {currentMetrics.slice(0, 2).map((row, index) => (
                <section className={`cox-friend-hud player-${index + 1}`} key={row.name}>
                  <header><b>{row.name}</b><span>P{index + 1}</span></header>
                  <MetricsPanel metrics={row} compact />
                </section>
              ))}
            </div>
          ) : <MetricsPanel metrics={ownMetrics} />}
          <div className="cox-river" ref={riverRef}>
            <div className="cox-water-glow" />
            {Array.from({ length: lanes + 1 }, (_, i) => <div className="cox-lane-line" key={i} style={{ left: `${(i / lanes) * 100}%` }} />)}
            {buoyMarkers.flatMap((distance) => Array.from({ length: lanes + 1 }, (_, divider) => {
              const top = riverHeight / 2 + (camera - distance) * scale;
              return <i className={`cox-course-buoy ${distance % 250 === 0 ? 'is-major' : ''}`} key={`${distance}-${divider}`} style={{ left: `${(divider / lanes) * 100}%`, top }} />;
            }))}
            {markers.map((value) => {
              const top = riverHeight / 2 + (camera - value) * scale;
              return <div className={`cox-distance-marker ${value === prefs.distance ? 'is-finish' : ''}`} key={value} style={{ top }}><span>{value === prefs.distance ? 'finish' : value}</span></div>;
            })}
            {currentMetrics.map((row, index) => {
              const palette = paletteFor(index);
              const top = riverHeight / 2 + (camera - row.distance) * scale;
              return (
                <div className={`cox-boat-position ${palette.ghost ? 'is-ghost' : ''}`} key={`${row.kind}-${index}`} style={{ left: `${((index + 0.5) / lanes) * 100}%`, top, '--boat-color': palette.color } as CSSProperties}>
                  <BoatSvg metrics={row} color={palette.color} accent={palette.accent} ghost={palette.ghost} />
                  <span>{row.name}</span>
                </div>
              );
            })}
            {farPlayer && <div className={`cox-edge-chip ${gap > 0 ? 'is-low' : 'is-high'}`}>{farPlayer.name} −{Math.round(farPlayer.distance)} m</div>}
          </div>
          <div className="cox-call-strip"><span className="cox-call-wave">≈</span><p>{callText}</p></div>
          <div className="cox-race-controls">
            <span className="ghelp cox-keyboard-help">{prefs.mode === 'friend' ? 'A and Q for P1 · L and P for P2' : 'Space to row · P for a power ten'}</span>
            {prefs.mode === 'friend' ? (
              <div className="cox-friend-buttons">
                <div className="cox-player-touch-controls">
                  <span className="cox-player-caption">P1</span>
                  <button className="gpad" title="Row (A)" onPointerDown={rowPointer(0)}>Row</button>
                  <button className="gpad gpad-secondary" title="Power 10 (Q)" onPointerDown={(event) => { event.preventDefault(); triggerPower10(0); }}>Power 10</button>
                </div>
                <div className="cox-player-touch-controls" style={{ '--tint': '#003262' } as CSSProperties}>
                  <span className="cox-player-caption">P2</span>
                  <button className="gpad" title="Row (L)" onPointerDown={rowPointer(1)}>Row</button>
                  <button className="gpad gpad-secondary" title="Power 10 (P)" onPointerDown={(event) => { event.preventDefault(); triggerPower10(1); }}>Power 10</button>
                </div>
              </div>
            ) : (
              <div className="cox-solo-buttons">
                <button className="gpad gpad-secondary" title="Power 10 (P)" onPointerDown={(event) => { event.preventDefault(); triggerPower10(0); }}>Power 10</button>
                <button className="gpad" title="Row (Space)" onPointerDown={rowPointer(0)}>Row</button>
              </div>
            )}
          </div>
        </div>
      )}

      {screen === 'finish' && (
        <div className="cox-finish-screen">
          <header className="cox-finish-header"><span className="cox-brand-mini"><i /> Race Complete</span></header>
          <div className="cox-finish-scroll">
            <div className="cox-finish-hero"><small className="cox-finish-detail">{raceLabel(prefs.distance)} · Weigh Enough</small><h1>{formatTime(ownMetrics?.finishTime)}</h1><p>that was a piece. nice work.</p></div>
            <div className={`cox-results-grid ${humanCount === 2 ? 'is-dual' : ''}`}>
              {currentMetrics.slice(0, humanCount).map((row, index) => {
                const margin = marginFor(index);
                const displayName = row.name.charAt(0).toUpperCase() + row.name.slice(1);
                const postedEntry = posted[index];
                return (
                  <section className={`cox-result-card player-${index + 1}`} key={row.name}>
                    <header><b>{displayName}</b><span>{index === 0 ? 'Stanford' : 'Friend'}</span></header>
                    <div className="cox-result-time">{formatTime(row.finishTime)}</div>
                    <div className="cox-result-stats">
                      <span><small>Avg split</small><b>{formatPace(row.avgSplit)}</b></span>
                      <span><small>Avg rate</small><b>{Math.round((row.strokes * 60) / (row.finishTime ?? 1))}</b></span>
                      <span><small>Strokes</small><b>{row.strokes}</b></span>
                      <span><small>Dps</small><b>{row.dps?.toFixed(1) ?? '--'} m</b></span>
                    </div>
                    {margin && <p className="cox-margin">{margin.seconds >= 0 ? 'up' : 'down'} {Math.abs(margin.seconds).toFixed(2)} s<span>{marginLabel(Math.abs(margin.lengths) * 18)}</span></p>}
                    <div className="cox-result-name">
                      <label className="glabel" htmlFor={`cox-result-name-${index}`}>Name on the leaderboard</label>
                      <div className="cox-post-row">
                        <input id={`cox-result-name-${index}`} className="ginput" maxLength={16} value={names[index] ?? ''} onChange={(event) => setNames((current) => current.map((name, i) => i === index ? event.target.value.slice(0, 16) : name))} placeholder="Your name" />
                        {!postedEntry && <button className="gbtn" disabled={posting === index} onClick={() => void postTime(index)}>{posting === index ? 'Posting…' : 'Post Time'}</button>}
                      </div>
                      {postedEntry && <div className="cox-posted-rank">{postedEntry.rank ? `Rank ${postedEntry.rank}` : 'Time posted'} · {board.scope === 'global' ? 'Global' : 'On this device'}</div>}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
          <footer className="cox-finish-actions">
            <button className="gbtn gbtn-primary" onClick={beginStart}>Race Again</button>
            <button className="gbtn" onClick={showMenu}>Menu</button>
            <button className="gbtn" onClick={() => { setBoardDistance(prefs.distance); setScreen('leaderboard'); }}>Leaderboard</button>
          </footer>
        </div>
      )}

      {screen === 'leaderboard' && (
        <div className="cox-board-screen">
          <header className="cox-board-header">
            <div><span className="cox-brand-mini"><i /> Race Results</span><h1>Leaderboard</h1></div>
            <button className="gbtn gbtn-plain" onClick={() => setScreen('setup')}>Back</button>
          </header>
          <div className="cox-board-tabs">
            <div className="gseg">
              {DISTANCES.map((distance) => <button key={distance} aria-pressed={boardDistance === distance} onClick={() => setBoardDistance(distance)}>{distance === 500 ? '500 m' : distance === 1000 ? '1,000 m' : '2,000 m'}</button>)}
            </div>
            <span className="ghelp cox-scope-badge">{board.scope === 'global' ? 'Global' : 'On this device'}</span>
          </div>
          <div className="cox-board-table-wrap">
            {boardLoading ? <p className="cox-board-empty">loading times…</p> : board.entries.length === 0 ? <p className="cox-board-empty">no times yet. row a piece and put one up.</p> : (
              <table className="cox-board-table">
                <thead><tr><th>#</th><th>rower</th><th>time</th><th>avg split</th><th>date</th></tr></thead>
                <tbody>
                  {board.entries.map((entry, index) => (
                    <tr className={highlight?.name === entry.name && highlight.timeMs === entry.timeMs ? 'is-highlighted' : ''} key={`${entry.name}-${entry.timeMs}-${entry.date}`}>
                      <td>{String(index + 1).padStart(2, '0')}</td><td>{entry.name}</td><td>{formatTime(entry.timeMs / 1000)}</td>
                      <td>{formatPace((entry.timeMs / 1000) / boardDistance * 500)}</td>
                      <td>{new Date(entry.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toLowerCase()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <footer className="cox-board-footer"><span>Top Ten · {raceLabel(boardDistance)}</span><button className="gbtn" onClick={() => setScreen('setup')}>Back to Setup</button></footer>
        </div>
      )}
    </div>
  );
}
