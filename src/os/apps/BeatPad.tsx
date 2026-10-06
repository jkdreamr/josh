import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import {
  BPM_MAX,
  BPM_MIN,
  changeStepDegree,
  clampBpm,
  clearPattern,
  clearTrack,
  createBeatState,
  createHistory,
  cycleVelocity,
  decodeBeatState,
  encodeBeatState,
  isPatternEmpty,
  KIT_NAMES,
  KITS,
  MAX_SONG,
  PATTERN_LENGTHS,
  PATTERN_NAMES,
  pitchForDegree,
  PRESET_NAMES,
  pushHistory,
  randomizePattern,
  redoHistory,
  replacePattern,
  ROOT_NAMES,
  SCALE_NAMES,
  SCALES,
  seededRng,
  setPatternLength,
  setStep,
  settleHistory,
  stepVelocity,
  SWING_MAX,
  SYNTH_TRACKS,
  tapTempo,
  TRACKS,
  undoHistory,
  updateTrack,
  type BeatPattern,
  type BeatState,
  type History,
  type PatternLength,
  type PresetName,
  type SynthTrack,
  type TrackId,
  type Velocity,
} from '../games/beat';
import { BeatEngine } from '../games/beat-audio';
import { useOS, type AppProps } from '../types';
import './game-controls.css';
import './BeatPad.css';

type Panel = 'tempo' | 'kit' | 'track' | 'mix' | 'song' | 'pads';
type Cell = { track: TrackId; step: number };
type Paint = { id: string; value: Velocity; seen: Set<string>; moved: boolean; timer: number | null };

const PANELS: Array<{ id: Panel; label: string }> = [
  { id: 'tempo', label: 'Tempo' },
  { id: 'kit', label: 'Kit' },
  { id: 'track', label: 'Track' },
  { id: 'mix', label: 'Mix' },
  { id: 'song', label: 'Song' },
  { id: 'pads', label: 'Pads' },
];
const STORAGE_KEY = 'beatpad.v2';
const TRACK_NAMES: Record<TrackId, string> = { kick: 'Kick', snare: 'Snare', hat: 'Hat', 'open hat': 'Open Hat', clap: 'Clap', bass: 'Bass', keys: 'Keys', lead: 'Lead' };
const TRACK_SHORT: Record<TrackId, string> = { ...TRACK_NAMES, 'open hat': 'Open' };
const DRUM_KEYS: Record<string, TrackId> = { KeyQ: 'kick', KeyW: 'snare', KeyE: 'hat', KeyR: 'open hat', KeyT: 'clap' };
const KEYS_KEYS = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK'];
const BASS_KEYS = ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM'];
const VELOCITY_NAMES = ['Off', 'Soft', 'Normal', 'Accent'];

function isSynth(track: TrackId): track is SynthTrack {
  return (SYNTH_TRACKS as readonly string[]).includes(track);
}

function loadSaved(): BeatState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? decodeBeatState(raw) : null;
  } catch {
    return null;
  }
}

function filterLabel(amount: number): string {
  if (amount === 50) return 'Open';
  return amount < 50 ? `Low ${50 - amount}` : `High ${amount - 50}`;
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

type SliderProps = {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  onChange: (value: number) => void;
  onSettle: () => void;
};

function Slider({ label, value, display, min, max, onChange, onSettle }: SliderProps) {
  return (
    <label className="beatpad-slider">
      <span className="beatpad-slider-head"><span>{label}</span><b>{display}</b></span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
        onPointerUp={onSettle}
        onKeyUp={onSettle}
        onBlur={onSettle}
      />
    </label>
  );
}

export default function BeatPad({ args }: AppProps) {
  const os = useOS();
  const coarse = os.mobile || os.tablet;
  const incoming = useMemo(() => (args.beat ? decodeBeatState(args.beat) : null), [args.beat, args.nonce]);
  const [history, setHistory] = useState<History<BeatState>>(() => createHistory(incoming ?? loadSaved() ?? createBeatState()));
  const state = history.present;
  const pattern = state.patterns[state.current];
  const [solo, setSolo] = useState<TrackId | null>(null);
  const [selectedTrack, setSelectedTrack] = useState<TrackId>('kick');
  const [selectedCell, setSelectedCell] = useState<Cell | null>(null);
  const [panel, setPanel] = useState<Panel | null>(coarse ? 'pads' : null);
  const [playing, setPlaying] = useState(false);
  const [recording, setRecording] = useState(false);
  const [playhead, setPlayhead] = useState<{ pattern: number; step: number; songIndex: number } | null>(null);
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');
  const [page, setPage] = useState(0);
  const [width, setWidth] = useState(800);

  const rootRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<BeatEngine | null>(null);
  const stateRef = useRef(state);
  const soloRef = useRef(solo);
  const paintRef = useRef<Paint | null>(null);
  const tapsRef = useRef<number[]>([]);
  const rafRef = useRef(0);
  stateRef.current = state;
  soloRef.current = solo;

  const commit = useCallback((updater: (current: BeatState) => BeatState, coalesce: string | null = null) => {
    setHistory((current) => pushHistory(current, updater(current.present), coalesce));
  }, []);
  const settle = useCallback(() => setHistory((current) => settleHistory(current)), []);
  const editPattern = useCallback((updater: (pattern: BeatPattern) => BeatPattern, coalesce: string | null = null, index?: number) => {
    commit((current) => {
      const target = index ?? current.current;
      return replacePattern(current, target, updater(current.patterns[target]));
    }, coalesce);
  }, [commit]);
  /** Changes which pattern is shown without adding an undo step. */
  const setView = useCallback((index: number) => {
    setHistory((current) => (current.present.current === index ? current : { ...current, present: { ...current.present, current: index } }));
  }, []);

  const ensureEngine = useCallback((): BeatEngine => {
    let engine = engineRef.current;
    if (!engine) {
      engine = new BeatEngine({
        getState: () => stateRef.current,
        getSolo: () => soloRef.current,
        onRecord: (patternIndex, step, track) => {
          editPattern((target) => (stepVelocity(target, track, step) ? target : setStep(target, track, step, 2)), 'record', patternIndex);
        },
      });
      engineRef.current = engine;
    }
    return engine;
  }, [editPattern]);

  const stopPlayback = useCallback(() => {
    engineRef.current?.stop();
    cancelAnimationFrame(rafRef.current);
    setPlaying(false);
    setPlayhead(null);
  }, []);

  const startPlayback = useCallback(() => {
    const engine = ensureEngine();
    engine.start();
    setPlaying(true);
    const animate = () => {
      const next = engine.playhead();
      setPlayhead((current) => (current?.pattern === next?.pattern && current?.step === next?.step && current?.songIndex === next?.songIndex ? current : next));
      rafRef.current = requestAnimationFrame(animate);
    };
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(animate);
  }, [ensureEngine]);

  const togglePlayback = useCallback(() => {
    if (engineRef.current?.playing) stopPlayback();
    else startPlayback();
  }, [startPlayback, stopPlayback]);

  const hit = useCallback((track: TrackId, degree?: number) => {
    ensureEngine().hit(track, degree);
  }, [ensureEngine]);

  const undo = useCallback(() => setHistory((current) => undoHistory(current)), []);
  const redo = useCallback(() => setHistory((current) => redoHistory(current)), []);

  useEffect(() => {
    if (!incoming) return;
    setHistory(createHistory(incoming));
    setSelectedCell(null);
  }, [incoming]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, encodeBeatState(state));
      } catch {
        /* private mode or full storage */
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [state]);

  useEffect(() => {
    if (engineRef.current) engineRef.current.recording = recording;
  }, [recording]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next) setWidth(next);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current);
    if (paintRef.current?.timer) window.clearTimeout(paintRef.current.timer);
    engineRef.current?.dispose();
    engineRef.current = null;
  }, []);

  useEffect(() => {
    if (window.matchMedia('(pointer: fine)').matches) rootRef.current?.focus({ preventScroll: true });
  }, []);

  const paged = pattern.length === 32 && width < 760;
  const visibleSteps = paged ? 16 : pattern.length;
  const stepOffset = paged ? page * 16 : 0;
  const cellWidth = (width - 24 - (width <= 430 ? 56 : width <= 560 ? 84 : coarse ? 128 : 112)) / visibleSteps;
  const showNotes = cellWidth >= 27;

  useEffect(() => {
    if (!paged) setPage(0);
  }, [paged]);

  useEffect(() => {
    if (!playhead) return;
    if (state.songMode && playhead.pattern !== state.current) setView(playhead.pattern);
    if (paged && playhead.pattern === state.current) setPage(Math.floor(playhead.step / 16));
  }, [playhead, paged, state.songMode, state.current, setView]);

  useEffect(() => {
    if (selectedCell && selectedCell.step >= pattern.length) setSelectedCell(null);
  }, [pattern.length, selectedCell]);

  const selectPattern = useCallback((index: number) => {
    setView(index);
    setSelectedCell(null);
  }, [setView]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const root = rootRef.current;
      const target = event.target as HTMLElement | null;
      if (!root || event.repeat) return;
      if (target?.closest('input, select, textarea')) return;
      const inside = document.activeElement === document.body || root.contains(document.activeElement);
      if (!inside) return;
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.code === 'KeyZ') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (meta && event.code === 'KeyY') {
        event.preventDefault();
        redo();
        return;
      }
      if (meta || event.altKey) return;
      if (event.code === 'Space') {
        event.preventDefault();
        event.stopPropagation();
        togglePlayback();
        return;
      }
      if (event.code === 'Escape') {
        setSelectedCell(null);
        setPanel(null);
        return;
      }
      if (/^Digit[1-4]$/.test(event.code)) {
        selectPattern(Number(event.code.slice(5)) - 1);
        return;
      }
      const drum = DRUM_KEYS[event.code];
      if (drum) {
        event.preventDefault();
        hit(drum);
        return;
      }
      const keysIndex = KEYS_KEYS.indexOf(event.code);
      if (keysIndex >= 0) {
        event.preventDefault();
        hit('keys', keysIndex);
        return;
      }
      const bassIndex = BASS_KEYS.indexOf(event.code);
      if (bassIndex >= 0) {
        event.preventDefault();
        hit('bass', bassIndex);
        return;
      }
      if (!selectedCell) return;
      const current = stateRef.current;
      const target2 = current.patterns[current.current];
      const { track, step } = selectedCell;
      if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
        event.preventDefault();
        const next = Math.max(0, Math.min(target2.length - 1, step + (event.code === 'ArrowLeft' ? -1 : 1)));
        setSelectedCell({ track, step: next });
        if (paged) setPage(Math.floor(next / 16));
      } else if (event.code === 'ArrowUp' || event.code === 'ArrowDown') {
        event.preventDefault();
        const amount = event.code === 'ArrowUp' ? 1 : -1;
        if (isSynth(track)) editPattern((p) => changeStepDegree(p, track, step, amount, current.scale), `degree-${track}-${step}`);
        else editPattern((p) => setStep(p, track, step, Math.max(0, Math.min(3, stepVelocity(p, track, step) + amount)) as Velocity), `velocity-${track}-${step}`);
      } else if (event.code === 'Enter') {
        event.preventDefault();
        editPattern((p) => setStep(p, track, step, stepVelocity(p, track, step) ? 0 : 2));
      } else if (event.code === 'Backspace' || event.code === 'Delete') {
        event.preventDefault();
        editPattern((p) => setStep(p, track, step, 0));
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [togglePlayback, undo, redo, hit, selectedCell, paged, editPattern, selectPattern]);

  /* ----------------------------------- grid input ----------------------------------- */

  const cellAt = (x: number, y: number): Cell | null => {
    const element = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-step]');
    if (!element || !gridRef.current?.contains(element)) return null;
    return { track: element.dataset.track as TrackId, step: Number(element.dataset.step) };
  };

  const onGridPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const cell = cellAt(event.clientX, event.clientY);
    if (!cell || event.button === 2) return;
    ensureEngine().unlock();
    setSelectedTrack(cell.track);
    setSelectedCell(cell);
    const current = stateRef.current.patterns[stateRef.current.current];
    if (event.shiftKey) {
      editPattern((p) => cycleVelocity(p, cell.track, cell.step));
      return;
    }
    const value: Velocity = stepVelocity(current, cell.track, cell.step) ? 0 : 2;
    const id = `paint-${Date.now()}`;
    const paint: Paint = { id, value, seen: new Set([`${cell.track}:${cell.step}`]), moved: false, timer: null };
    if (event.pointerType === 'touch') {
      paint.timer = window.setTimeout(() => {
        if (!paintRef.current || paintRef.current.moved) return;
        paintRef.current.timer = null;
        editPattern((p) => cycleVelocity(p, cell.track, cell.step), id);
      }, 450);
    }
    paintRef.current = paint;
    gridRef.current?.setPointerCapture(event.pointerId);
    editPattern((p) => setStep(p, cell.track, cell.step, value), id);
  };

  const onGridPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const paint = paintRef.current;
    if (!paint) return;
    const cell = cellAt(event.clientX, event.clientY);
    if (!cell) return;
    const key = `${cell.track}:${cell.step}`;
    if (paint.seen.has(key)) return;
    paint.moved = true;
    if (paint.timer) window.clearTimeout(paint.timer);
    paint.timer = null;
    paint.seen.add(key);
    editPattern((p) => (stepVelocity(p, cell.track, cell.step) === paint.value ? p : setStep(p, cell.track, cell.step, paint.value)), paint.id);
  };

  const endPaint = () => {
    const paint = paintRef.current;
    if (!paint) return;
    if (paint.timer) window.clearTimeout(paint.timer);
    paintRef.current = null;
    settle();
  };

  const onCellWheel = (track: TrackId, step: number, deltaY: number) => {
    if (!isSynth(track)) return;
    editPattern((p) => changeStepDegree(p, track, step, deltaY > 0 ? -1 : 1, stateRef.current.scale), `wheel-${track}-${step}`);
    setSelectedTrack(track);
    setSelectedCell({ track, step });
  };

  /* ----------------------------------- actions ----------------------------------- */

  const tap = () => {
    const now = performance.now();
    tapsRef.current = [...tapsRef.current.filter((time) => now - time < 2000), now];
    const bpm = tapTempo(tapsRef.current);
    if (bpm) commit((current) => ({ ...current, bpm }), 'tap');
    hit('hat');
  };

  const share = async () => {
    const url = `${window.location.origin}${window.location.pathname}?beat=${encodeBeatState(state)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied('done');
    } catch {
      setCopied('failed');
    }
    window.setTimeout(() => setCopied('idle'), 1800);
  };

  const randomize = () => {
    editPattern((p) => randomizePattern(stateRef.current, p, seededRng(Math.floor(Math.random() * 2 ** 31))));
  };

  const togglePanel = (next: Panel) => setPanel((current) => (current === next ? null : next));
  const openTrack = (track: TrackId) => {
    setSelectedTrack(track);
    setPanel('track');
  };
  const toggleSolo = (track: TrackId) => setSolo((current) => (current === track ? null : track));
  const toggleMute = (track: TrackId) => commit((current) => updateTrack(current, track, { muted: !current.tracks[track].muted }));

  const trackSettings = state.tracks[selectedTrack];
  const selected = selectedCell && selectedCell.track === selectedTrack ? selectedCell : null;
  const selectedVelocity = selected ? stepVelocity(pattern, selected.track, selected.step) : 0;
  const selectedNote = selected && isSynth(selected.track) ? pitchForDegree(selected.track, state.root, state.scale, pattern.notes[selected.track][selected.step]) : null;
  const playingPattern = playhead?.pattern ?? null;
  const steps = Array.from({ length: visibleSteps }, (_, index) => index + stepOffset);

  return (
    <div
      ref={rootRef}
      className={`beatpad-app gc-dark ${coarse ? 'is-coarse' : ''}`}
      style={{ '--tint': '#c49c65' } as CSSProperties}
      tabIndex={-1}
      onPointerDownCapture={() => ensureEngine().unlock()}
    >
      <header className="beatpad-toolbar">
        <button className="gbtn gbtn-primary beatpad-play" aria-pressed={playing} title="Play or Stop (Space)" onClick={togglePlayback}>
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            {playing ? <rect x="3" y="3" width="10" height="10" rx="1.5" fill="currentColor" /> : <path d="M5 3.5v9l7-4.5z" fill="currentColor" />}
          </svg>
          {playing ? 'Stop' : 'Play'}
        </button>
        <button className="gbtn beatpad-bpm" aria-pressed={panel === 'tempo'} title="Tempo and Swing" onClick={() => togglePanel('tempo')}>{state.bpm} BPM</button>
        <div className="gseg beatpad-patterns" role="group" aria-label="Pattern">
          {PATTERN_NAMES.map((name, index) => (
            <button
              key={name}
              aria-pressed={state.current === index}
              className={`${isPatternEmpty(state.patterns[index]) ? 'is-empty' : ''} ${playingPattern === index ? 'is-playing' : ''}`}
              title={`Pattern ${name} (${index + 1})`}
              onClick={() => selectPattern(index)}
            >{name}</button>
          ))}
        </div>
        <div className="beatpad-toolbar-right">
          <button className="gbtn beatpad-icon" aria-label="Undo" title="Undo" disabled={!history.past.length} onClick={undo}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4 3 7l3 3M3.5 7H10a3 3 0 0 1 0 6H8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <button className="gbtn beatpad-icon" aria-label="Redo" title="Redo" disabled={!history.future.length} onClick={redo}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="m10 4 3 3-3 3M12.5 7H6a3 3 0 0 0 0 6h2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <button className="gbtn" onClick={() => void share()}>{copied === 'done' ? 'Link Copied' : copied === 'failed' ? 'Copy Failed' : 'Share'}</button>
        </div>
      </header>

      <main className="beatpad-workspace">
        {paged && (
          <div className="beatpad-pages">
            <div className="gseg" role="group" aria-label="Steps">
              <button aria-pressed={page === 0} onClick={() => setPage(0)}>Steps 1 to 16</button>
              <button aria-pressed={page === 1} onClick={() => setPage(1)}>Steps 17 to 32</button>
            </div>
          </div>
        )}
        <div
          ref={gridRef}
          className={`beatpad-grid ${showNotes ? 'show-notes' : ''}`}
          style={{ '--steps': visibleSteps, '--cell': `${Math.round(cellWidth)}px` } as CSSProperties}
          onPointerDown={onGridPointerDown}
          onPointerMove={onGridPointerMove}
          onPointerUp={endPaint}
          onPointerCancel={endPaint}
          onLostPointerCapture={endPaint}
        >
          <div className="beatpad-grid-head">
            <span />
            {steps.map((step) => <span key={step} className={step % 4 === 0 ? 'is-beat' : ''}>{step % 4 === 0 ? step / 4 + 1 : ''}</span>)}
          </div>
          {TRACKS.map((track) => {
            const settings = state.tracks[track];
            const silent = solo ? solo !== track : settings.muted;
            return (
              <div className={`beatpad-row ${selectedTrack === track ? 'is-selected' : ''} ${silent ? 'is-silent' : ''}`} key={track}>
                <div className="beatpad-track">
                  <button className="beatpad-track-name" aria-pressed={selectedTrack === track} title={`${TRACK_NAMES[track]} settings`} onPointerDown={(event) => event.stopPropagation()} onClick={() => openTrack(track)}>
                    <span className="beatpad-track-full">{TRACK_NAMES[track]}</span>
                    <span className="beatpad-track-short">{TRACK_SHORT[track]}</span>
                  </button>
                  <div className="beatpad-track-switches" onPointerDown={(event) => event.stopPropagation()}>
                    <button className="beatpad-switch" aria-pressed={settings.muted} aria-label={`Mute ${TRACK_NAMES[track]}`} title="Mute" onClick={() => toggleMute(track)}>M</button>
                    <button className="beatpad-switch is-solo" aria-pressed={solo === track} aria-label={`Solo ${TRACK_NAMES[track]}`} title="Solo" onClick={() => toggleSolo(track)}>S</button>
                  </div>
                </div>
                {steps.map((step) => {
                  const velocity = stepVelocity(pattern, track, step);
                  const degree = isSynth(track) ? pattern.notes[track][step] : 0;
                  const isSelected = selectedCell?.track === track && selectedCell.step === step;
                  const isPlayhead = playhead?.pattern === state.current && playhead.step === step;
                  return (
                    <button
                      key={step}
                      type="button"
                      data-track={track}
                      data-step={step}
                      data-velocity={velocity}
                      className={`beatpad-cell track-${track.replace(' ', '-')} ${velocity ? 'is-on' : ''} ${step % 4 === 0 ? 'is-beat' : ''} ${isPlayhead ? 'is-playhead' : ''} ${isSelected ? 'is-selected' : ''}`}
                      style={isSynth(track) ? ({ '--pitch': degree / 14 } as CSSProperties) : undefined}
                      aria-label={`${TRACK_NAMES[track]} step ${step + 1}, ${VELOCITY_NAMES[velocity]}${isSynth(track) && velocity ? `, ${pitchForDegree(track, state.root, state.scale, degree).name}` : ''}`}
                      aria-pressed={velocity > 0}
                      onClick={(event) => {
                        if (event.detail !== 0) return;
                        setSelectedTrack(track);
                        setSelectedCell({ track, step });
                        editPattern((p) => setStep(p, track, step, stepVelocity(p, track, step) ? 0 : 2));
                      }}
                      onWheel={(event) => { if (isSynth(track)) { event.preventDefault(); onCellWheel(track, step, event.deltaY); } }}
                      onContextMenu={(event) => { event.preventDefault(); if (isSynth(track)) onCellWheel(track, step, -1); }}
                    >
                      {velocity > 0 && isSynth(track) && <small>{pitchForDegree(track, state.root, state.scale, degree).name}</small>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </main>

      <nav className="beatpad-bar">
        <div className="gseg beatpad-tabs" role="group" aria-label="Controls">
          {PANELS.map((item) => (
            <button key={item.id} aria-pressed={panel === item.id} onClick={() => togglePanel(item.id)}>{item.label}</button>
          ))}
        </div>
        <div className="beatpad-bar-right">
          <button className="gbtn gbtn-sm" onClick={randomize}>Randomize</button>
          <button className="gbtn gbtn-sm" disabled={isPatternEmpty(pattern)} onClick={() => editPattern(clearPattern)}>Clear</button>
        </div>
      </nav>

      {panel && (
        <section className={`beatpad-panel panel-${panel}`} aria-label={PANELS.find((item) => item.id === panel)?.label}>
          {panel === 'tempo' && (
            <>
              <Slider label="Tempo" value={state.bpm} display={`${state.bpm} BPM`} min={BPM_MIN} max={BPM_MAX} onChange={(bpm) => commit((c) => ({ ...c, bpm: clampBpm(bpm) }), 'bpm')} onSettle={settle} />
              <Slider label="Swing" value={state.swing} display={state.swing ? `${state.swing}%` : 'Off'} min={0} max={SWING_MAX} onChange={(swing) => commit((c) => ({ ...c, swing }), 'swing')} onSettle={settle} />
              <div className="beatpad-field">
                <button className="gbtn" onPointerDown={(event) => { event.preventDefault(); tap(); }}>Tap Tempo</button>
                <span className="ghelp">Tap along to set the tempo.</span>
              </div>
            </>
          )}

          {panel === 'kit' && (
            <>
              <div className="beatpad-field">
                <span className="glabel">Kit</span>
                <div className="gseg" role="group" aria-label="Kit">
                  {KITS.map((kit) => <button key={kit} aria-pressed={state.kit === kit} onClick={() => commit((c) => ({ ...c, kit }))}>{KIT_NAMES[kit]}</button>)}
                </div>
              </div>
              <div className="beatpad-field beatpad-field-row">
                <label className="beatpad-select-field">
                  <span className="glabel">Key</span>
                  <select className="ginput beatpad-select" value={state.root} onChange={(event) => commit((c) => ({ ...c, root: Number(event.target.value) }))}>
                    {ROOT_NAMES.map((name, index) => <option key={name} value={index}>{name}</option>)}
                  </select>
                </label>
                <label className="beatpad-select-field">
                  <span className="glabel">Scale</span>
                  <select className="ginput beatpad-select" value={state.scale} onChange={(event) => commit((c) => ({ ...c, scale: event.target.value as BeatState['scale'] }))}>
                    {SCALES.map((scale) => <option key={scale} value={scale}>{SCALE_NAMES[scale]}</option>)}
                  </select>
                </label>
                <label className="beatpad-select-field">
                  <span className="glabel">Preset</span>
                  <select className="ginput beatpad-select" value="" onChange={(event) => { if (event.target.value) { commit(() => createBeatState(event.target.value as PresetName)); setSelectedCell(null); } }}>
                    <option value="">Load</option>
                    {(Object.keys(PRESET_NAMES) as PresetName[]).map((name) => <option key={name} value={name}>{PRESET_NAMES[name]}</option>)}
                  </select>
                </label>
              </div>
            </>
          )}

          {panel === 'track' && (
            <>
              <div className="beatpad-panel-title">
                <b>{TRACK_NAMES[selectedTrack]}</b>
                <div className="beatpad-panel-actions">
                  <button className="gbtn gbtn-sm" aria-pressed={trackSettings.muted} onClick={() => toggleMute(selectedTrack)}>{trackSettings.muted ? 'Muted' : 'Mute'}</button>
                  <button className="gbtn gbtn-sm" aria-pressed={solo === selectedTrack} onClick={() => toggleSolo(selectedTrack)}>Solo</button>
                  <button className="gbtn gbtn-sm" onClick={() => editPattern((p) => clearTrack(p, selectedTrack))}>Clear Track</button>
                </div>
              </div>
              <div className="beatpad-sliders">
                <Slider label="Volume" value={trackSettings.volume} display={`${trackSettings.volume}%`} min={0} max={100} onChange={(volume) => commit((c) => updateTrack(c, selectedTrack, { volume }), `volume-${selectedTrack}`)} onSettle={settle} />
                <Slider label="Pitch" value={trackSettings.pitch} display={trackSettings.pitch === 0 ? '0' : `${signed(trackSettings.pitch)} st`} min={-12} max={12} onChange={(pitch) => commit((c) => updateTrack(c, selectedTrack, { pitch }), `pitch-${selectedTrack}`)} onSettle={settle} />
                <Slider label="Decay" value={trackSettings.decay} display={`${trackSettings.decay}%`} min={0} max={100} onChange={(decay) => commit((c) => updateTrack(c, selectedTrack, { decay }), `decay-${selectedTrack}`)} onSettle={settle} />
              </div>
              {selected ? (
                <div className="beatpad-field beatpad-field-row beatpad-step-field">
                  <div className="beatpad-select-field">
                    <span className="glabel">Step {selected.step + 1}</span>
                    <div className="gseg" role="group" aria-label="Velocity">
                      {[1, 2, 3].map((velocity) => (
                        <button key={velocity} aria-pressed={selectedVelocity === velocity} onClick={() => editPattern((p) => setStep(p, selected.track, selected.step, velocity as Velocity))}>{VELOCITY_NAMES[velocity]}</button>
                      ))}
                    </div>
                  </div>
                  {selectedNote && isSynth(selected.track) && (
                    <div className="beatpad-select-field">
                      <span className="glabel">Note</span>
                      <div className="beatpad-note">
                        <button className="gbtn gbtn-sm" onClick={() => onCellWheel(selected.track, selected.step, 1)}>Lower</button>
                        <b>{selectedNote.name}</b>
                        <button className="gbtn gbtn-sm" onClick={() => onCellWheel(selected.track, selected.step, -1)}>Higher</button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <span className="ghelp">Select a step to set its velocity{isSynth(selectedTrack) ? ' and note' : ''}.</span>
              )}
            </>
          )}

          {panel === 'mix' && (
            <div className="beatpad-sliders">
              <Slider label="Filter" value={state.fx.filter} display={filterLabel(state.fx.filter)} min={0} max={100} onChange={(filter) => commit((c) => ({ ...c, fx: { ...c.fx, filter } }), 'filter')} onSettle={settle} />
              <Slider label="Reverb" value={state.fx.reverb} display={state.fx.reverb ? `${state.fx.reverb}%` : 'Off'} min={0} max={100} onChange={(reverb) => commit((c) => ({ ...c, fx: { ...c.fx, reverb } }), 'reverb')} onSettle={settle} />
              <Slider label="Delay" value={state.fx.delay} display={state.fx.delay ? `${state.fx.delay}%` : 'Off'} min={0} max={100} onChange={(delay) => commit((c) => ({ ...c, fx: { ...c.fx, delay } }), 'delay')} onSettle={settle} />
            </div>
          )}

          {panel === 'song' && (
            <>
              <div className="beatpad-field beatpad-field-row">
                <div className="beatpad-select-field">
                  <span className="glabel">Pattern {PATTERN_NAMES[state.current]} Length</span>
                  <div className="gseg" role="group" aria-label="Pattern length">
                    {PATTERN_LENGTHS.map((length) => <button key={length} aria-pressed={pattern.length === length} onClick={() => editPattern((p) => setPatternLength(p, length as PatternLength))}>{length} Steps</button>)}
                  </div>
                </div>
                <div className="beatpad-select-field">
                  <span className="glabel">Copy {PATTERN_NAMES[state.current]} To</span>
                  <div className="gseg" role="group" aria-label="Copy pattern to">
                    {PATTERN_NAMES.map((name, index) => (
                      <button key={name} disabled={index === state.current} onClick={() => commit((c) => replacePattern(c, index, c.patterns[c.current]))}>{name}</button>
                    ))}
                  </div>
                </div>
                <div className="beatpad-select-field">
                  <span className="glabel">Play</span>
                  <div className="gseg" role="group" aria-label="Play mode">
                    <button aria-pressed={!state.songMode} onClick={() => commit((c) => ({ ...c, songMode: false }))}>Pattern</button>
                    <button aria-pressed={state.songMode} disabled={!state.song.length} onClick={() => commit((c) => ({ ...c, songMode: true }))}>Song</button>
                  </div>
                </div>
              </div>
              <div className="beatpad-field">
                <span className="glabel">Song</span>
                <div className="beatpad-chain">
                  {state.song.map((index, position) => (
                    <button
                      key={position}
                      className={`gbtn gbtn-sm beatpad-chip ${state.songMode && playhead?.songIndex === position ? 'is-playing' : ''}`}
                      title="Remove from song"
                      onClick={() => commit((c) => {
                        const song = c.song.filter((_, at) => at !== position);
                        return { ...c, song, songMode: song.length ? c.songMode : false };
                      })}
                    >{PATTERN_NAMES[index]}</button>
                  ))}
                  {state.song.length < MAX_SONG && (
                    <div className="gseg beatpad-chain-add" role="group" aria-label="Add pattern to song">
                      {PATTERN_NAMES.map((name, index) => <button key={name} title={`Add ${name}`} onClick={() => commit((c) => ({ ...c, song: [...c.song, index] }))}>Add {name}</button>)}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {panel === 'pads' && (
            <>
              <div className="beatpad-pads">
                {TRACKS.map((track) => (
                  <button
                    key={track}
                    className={`gpad beatpad-pad track-${track.replace(' ', '-')}`}
                    onPointerDown={(event) => { event.preventDefault(); hit(track); }}
                    onKeyDown={(event) => { if (event.code === 'Enter') hit(track); }}
                  >{TRACK_NAMES[track]}</button>
                ))}
              </div>
              <div className="beatpad-field beatpad-pads-foot">
                <button className={`gbtn ${recording ? 'is-recording' : ''}`} aria-pressed={recording} onClick={() => setRecording((current) => !current)}>{recording ? 'Recording' : 'Record'}</button>
                <span className="ghelp">{recording ? 'Hits land on the nearest step while the beat plays.' : coarse ? 'Tap a pad to play it.' : 'Q to T play drums, A to K play keys, Z to M play bass.'}</span>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
