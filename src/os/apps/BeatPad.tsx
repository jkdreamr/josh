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
  GROOVES,
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
  recordHit,
  redoHistory,
  remixPattern,
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

type View = 'drums' | 'melody' | 'pads' | 'song' | 'mix';
type Cell = { track: TrackId; step: number };
type Paint = { id: string; value: Velocity; seen: Set<string>; moved: boolean; timer: number | null };

const VIEWS: Array<{ id: View; label: string }> = [
  { id: 'drums', label: 'Drums' },
  { id: 'melody', label: 'Melody' },
  { id: 'pads', label: 'Pads' },
  { id: 'song', label: 'Song' },
  { id: 'mix', label: 'Mix' },
];
const STORAGE_KEY = 'beatpad.v2';
const TRACK_NAMES: Record<TrackId, string> = { kick: 'Kick', snare: 'Snare', hat: 'Hat', 'open hat': 'Open Hat', clap: 'Clap', bass: 'Bass', keys: 'Keys', lead: 'Lead' };
const DRUM_TRACKS: TrackId[] = ['kick', 'snare', 'hat', 'open hat', 'clap'];
const MELODY_TRACKS: TrackId[] = ['bass', 'keys', 'lead'];
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
    const decoded = raw ? decodeBeatState(raw) : null;
    return decoded ? { ...decoded, groove: decoded.groove ?? null } : null;
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
  className?: string;
};

function Slider({ label, value, display, min, max, onChange, onSettle, className = '' }: SliderProps) {
  return (
    <label className={`beatpad-slider ${className}`}>
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
  const [history, setHistory] = useState<History<BeatState>>(() => createHistory(incoming ?? loadSaved() ?? createBeatState('boom bap')));
  const state = history.present;
  const pattern = state.patterns[state.current];
  const [solo, setSolo] = useState<TrackId | null>(null);
  const [selectedTrack, setSelectedTrack] = useState<TrackId>('kick');
  const [selectedCell, setSelectedCell] = useState<Cell | null>(null);
  const [view, setView] = useState<View>('drums');
  const [playing, setPlaying] = useState(false);
  const [recording, setRecording] = useState(false);
  const [playhead, setPlayhead] = useState<{ pattern: number; step: number; songIndex: number } | null>(null);
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');
  const [padLit, setPadLit] = useState<Partial<Record<TrackId, boolean>>>({});
  const [page, setPage] = useState(0);
  const [width, setWidth] = useState(800);
  const [visualizerReady, setVisualizerReady] = useState(true);

  const rootRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<BeatEngine | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const analyserTapRef = useRef<AudioNode | null>(null);
  const analyserDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const visualizerAttemptedRef = useRef(false);
  const stateRef = useRef(state);
  const soloRef = useRef(solo);
  const paintRef = useRef<Paint | null>(null);
  const padTimersRef = useRef<Partial<Record<TrackId, number>>>({});
  const tapsRef = useRef<number[]>([]);
  const rafRef = useRef(0);
  const animationRef = useRef<() => void>(() => undefined);
  const lastAudioHitRef = useRef(0);
  const lastHeadRef = useRef('');
  const copiedTimerRef = useRef(0);
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
  const setPatternView = useCallback((index: number) => {
    setHistory((current) => (current.present.current === index ? current : { ...current, present: { ...current.present, current: index } }));
  }, []);

  const flashPad = useCallback((track: TrackId) => {
    setPadLit((current) => (current[track] ? current : { ...current, [track]: true }));
    const oldTimer = padTimersRef.current[track];
    if (oldTimer) window.clearTimeout(oldTimer);
    padTimersRef.current[track] = window.setTimeout(() => {
      setPadLit((current) => ({ ...current, [track]: false }));
      padTimersRef.current[track] = undefined;
    }, 180);
  }, []);

  const drawVisualizer = useCallback((active: boolean) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const canvasWidth = Math.max(1, Math.round(bounds.width * dpr));
    const canvasHeight = Math.max(1, Math.round(bounds.height * dpr));
    if (canvas.width !== canvasWidth || canvas.height !== canvasHeight) {
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;
    }
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvasWidth, canvasHeight);

    const analyser = analyserRef.current;
    const barCount = 16;
    const gap = Math.max(1, Math.round(dpr));
    const barWidth = (canvasWidth - gap * (barCount - 1)) / barCount;
    if (!active || !analyser) {
      canvas.dataset.level = '0';
      context.fillStyle = 'rgba(196, 156, 101, 0.28)';
      const idleHeight = Math.max(2 * dpr, Math.round(canvasHeight * 0.12));
      for (let bar = 0; bar < barCount; bar += 1) {
        context.fillRect(bar * (barWidth + gap), canvasHeight - idleHeight, barWidth, idleHeight);
      }
      return;
    }

    const data = analyserDataRef.current;
    if (!data) return;
    analyser.getByteFrequencyData(data);
    const average = data.reduce((sum, sample) => sum + sample, 0) / Math.max(1, data.length);
    canvas.dataset.level = String(Math.max(0, Math.min(255, Math.round(average))));
    const availableHeight = Math.max(1, canvasHeight - 2 * dpr);
    context.fillStyle = '#c49c65';
    for (let bar = 0; bar < barCount; bar += 1) {
      const start = Math.floor((bar / barCount) * data.length);
      const end = Math.max(start + 1, Math.floor(((bar + 1) / barCount) * data.length));
      let total = 0;
      for (let bin = start; bin < end; bin += 1) total += data[bin] ?? 0;
      const level = total / Math.max(1, end - start);
      const height = Math.max(dpr, (level / 255) * availableHeight);
      context.fillRect(bar * (barWidth + gap), canvasHeight - height, barWidth, height);
    }
  }, []);

  useEffect(() => {
    drawVisualizer(false);
  }, [drawVisualizer]);

  const ensureVisualizer = useCallback((engine: BeatEngine) => {
    if (analyserRef.current) return true;
    if (visualizerAttemptedRef.current) return false;
    visualizerAttemptedRef.current = true;
    try {
      const tap = (engine as unknown as { filter?: AudioNode }).filter;
      if (!tap) {
        setVisualizerReady(false);
        return false;
      }
      const analyser = engine.context.createAnalyser();
      analyser.fftSize = 64;
      tap.connect(analyser);
      analyserRef.current = analyser;
      analyserTapRef.current = tap;
      analyserDataRef.current = new Uint8Array(analyser.frequencyBinCount);
      setVisualizerReady(true);
      return true;
    } catch {
      setVisualizerReady(false);
      return false;
    }
  }, []);

  const ensureEngine = useCallback((): BeatEngine => {
    let engine = engineRef.current;
    if (!engine) {
      engine = new BeatEngine({
        getState: () => stateRef.current,
        getSolo: () => soloRef.current,
        onRecord: (patternIndex, step, track) => {
          editPattern((target) => recordHit(target, track, step), 'record', patternIndex);
        },
      });
      engineRef.current = engine;
    }
    return engine;
  }, [editPattern]);

  const animationFrame = useCallback(() => {
    const engine = engineRef.current;
    const now = performance.now();
    const hiddenWindow = rootRef.current?.closest('[aria-hidden="true"], .is-min');
    if (document.visibilityState === 'hidden' || hiddenWindow) {
      engine?.stop();
      if (engine) engine.recording = false;
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      setPlaying(false);
      setRecording(false);
      setPlayhead(null);
      drawVisualizer(false);
      return;
    }

    if (engine?.playing) {
      const next = engine.playhead();
      if (next) {
        setPlayhead((current) => (
          current?.pattern === next.pattern && current?.step === next.step && current?.songIndex === next.songIndex
            ? current
            : next
        ));
        const headKey = `${next.pattern}:${next.step}:${next.songIndex}`;
        if (headKey !== lastHeadRef.current) {
          lastHeadRef.current = headKey;
          const current = stateRef.current;
          const soundingPattern = current.patterns[next.pattern];
          for (const track of TRACKS) {
            const trackState = current.tracks[track];
            const audible = soloRef.current ? soloRef.current === track : !trackState.muted;
            if (audible && stepVelocity(soundingPattern, track, next.step)) flashPad(track);
          }
        }
      }
    }

    const active = Boolean(engine?.playing) || now - lastAudioHitRef.current < 600;
    drawVisualizer(active);
    if (active) {
      rafRef.current = requestAnimationFrame(() => animationRef.current());
    } else {
      rafRef.current = 0;
    }
  }, [drawVisualizer, flashPad]);
  animationRef.current = animationFrame;

  const requestAnimation = useCallback(() => {
    if (!rafRef.current) rafRef.current = requestAnimationFrame(() => animationRef.current());
  }, []);

  const stopPlayback = useCallback(() => {
    const engine = engineRef.current;
    engine?.stop();
    if (engine) engine.recording = false;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    setPlaying(false);
    setRecording(false);
    setPlayhead(null);
    const recentHit = performance.now() - lastAudioHitRef.current < 600;
    drawVisualizer(recentHit);
    if (recentHit && document.visibilityState !== 'hidden') requestAnimation();
  }, [drawVisualizer, requestAnimation]);

  const startPlayback = useCallback(() => {
    const engine = ensureEngine();
    engine.unlock();
    ensureVisualizer(engine);
    engine.start();
    lastHeadRef.current = '';
    setPlaying(true);
    requestAnimation();
  }, [ensureEngine, ensureVisualizer, requestAnimation]);

  const togglePlayback = useCallback(() => {
    if (engineRef.current?.playing) stopPlayback();
    else startPlayback();
  }, [startPlayback, stopPlayback]);

  const hit = useCallback((track: TrackId, degree?: number) => {
    const engine = ensureEngine();
    engine.unlock();
    ensureVisualizer(engine);
    engine.hit(track, degree);
    lastAudioHitRef.current = performance.now();
    flashPad(track);
    requestAnimation();
  }, [ensureEngine, ensureVisualizer, flashPad, requestAnimation]);

  const undo = useCallback(() => setHistory((current) => undoHistory(current)), []);
  const redo = useCallback(() => setHistory((current) => redoHistory(current)), []);

  useEffect(() => {
    if (!incoming) return;
    setHistory(createHistory({ ...incoming, groove: incoming.groove ?? null }));
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

  useEffect(() => {
    const stopWhenHidden = () => {
      if (document.visibilityState === 'hidden') stopPlayback();
    };
    document.addEventListener('visibilitychange', stopWhenHidden);
    return () => document.removeEventListener('visibilitychange', stopWhenHidden);
  }, [stopPlayback]);

  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current);
    if (paintRef.current?.timer) window.clearTimeout(paintRef.current.timer);
    for (const timer of Object.values(padTimersRef.current)) {
      if (timer) window.clearTimeout(timer);
    }
    if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
    const analyser = analyserRef.current;
    const tap = analyserTapRef.current;
    if (analyser && tap) {
      try {
        tap.disconnect(analyser);
      } catch {
        /* audio graph may already be closed */
      }
    }
    try {
      analyser?.disconnect();
    } catch {
      /* audio graph may already be closed */
    }
    engineRef.current?.dispose();
    engineRef.current = null;
  }, []);

  useEffect(() => {
    if (window.matchMedia('(pointer: fine)').matches) rootRef.current?.focus({ preventScroll: true });
  }, []);

  const narrow = coarse && width < 560;
  const paged = pattern.length === 32 && width < 760;
  const visibleSteps = paged ? 16 : pattern.length;
  const stepOffset = paged ? page * 16 : 0;
  const cellWidth = (width - 24 - (narrow ? 68 : coarse ? 128 : 112)) / (narrow ? 8 : visibleSteps);
  const showNotes = cellWidth >= 27;
  const tracks = view === 'melody' ? MELODY_TRACKS : DRUM_TRACKS;
  const steps = Array.from({ length: visibleSteps }, (_, index) => index + stepOffset);
  const blocks = narrow
    ? [steps.slice(0, 8), ...(visibleSteps > 8 ? [steps.slice(8, 16)] : [])]
    : [steps];

  useEffect(() => {
    if (!paged) setPage(0);
  }, [paged]);

  useEffect(() => {
    if (!playhead) return;
    if (state.songMode && playhead.pattern !== state.current) setPatternView(playhead.pattern);
    if (paged && playhead.pattern === state.current) setPage(Math.floor(playhead.step / 16));
  }, [playhead, paged, state.songMode, state.current, setPatternView]);

  useEffect(() => {
    if (selectedCell && selectedCell.step >= pattern.length) setSelectedCell(null);
  }, [pattern.length, selectedCell]);

  const selectPattern = useCallback((index: number) => {
    setPatternView(index);
    setSelectedCell(null);
  }, [setPatternView]);

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
        setView('drums');
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
      const targetPattern = current.patterns[current.current];
      const { track, step } = selectedCell;
      if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
        event.preventDefault();
        const next = Math.max(0, Math.min(targetPattern.length - 1, step + (event.code === 'ArrowLeft' ? -1 : 1)));
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
    if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = window.setTimeout(() => setCopied('idle'), 1800);
  };

  const randomize = () => {
    editPattern((p) => randomizePattern(stateRef.current, p, seededRng(Math.floor(Math.random() * 2 ** 32) >>> 0)));
  };

  const remix = () => {
    const seed = Math.floor(Math.random() * 2 ** 32) >>> 0;
    editPattern((p) => remixPattern(state, p, seededRng(seed)), 'remix');
  };

  const clearCurrent = () => {
    commit((current) => {
      const next = replacePattern(current, current.current, clearPattern(current.patterns[current.current]));
      return next.patterns.every(isPatternEmpty) ? { ...next, groove: null } : next;
    });
  };

  const chooseGroove = (groove: PresetName) => {
    commit(() => createBeatState(groove));
    setSelectedCell(null);
    setSolo(null);
  };

  const changeTempo = (amount: number) => {
    commit((current) => ({ ...current, bpm: clampBpm(current.bpm + amount) }), 'bpm');
  };

  const toggleSolo = (track: TrackId) => setSolo((current) => (current === track ? null : track));
  const toggleMute = (track: TrackId) => commit((current) => updateTrack(current, track, { muted: !current.tracks[track].muted }));

  const toggleRecording = () => {
    const next = !recording;
    const engine = next || engineRef.current ? ensureEngine() : null;
    setRecording(next);
    if (engine) engine.recording = next;
    if (next && !engine?.playing) startPlayback();
  };

  const trackSettings = state.tracks[selectedTrack];
  const selected = selectedCell && selectedCell.track === selectedTrack ? selectedCell : null;
  const selectedVelocity = selected ? stepVelocity(pattern, selected.track, selected.step) : 0;
  const selectedNote = selected && isSynth(selected.track)
    ? pitchForDegree(selected.track, state.root, state.scale, pattern.notes[selected.track][selected.step])
    : null;
  const selectedSynthTrack = selected && isSynth(selected.track) ? selected.track : null;
  const selectedPattern = playhead?.pattern ?? null;
  const patternHint = state.current !== 0 || state.songMode ? `Pattern ${PATTERN_NAMES[state.current]}. ` : '';
  const hint = view === 'pads'
    ? coarse ? 'Tap a pad to play it. Press Record to add hits to the loop.' : 'Drums Q-T, keys A-K, bass Z-M.'
    : view === 'melody'
      ? 'Set Key and Scale, then edit notes.'
      : view === 'song'
        ? 'Arrange patterns and choose playback.'
        : view === 'mix'
          ? 'Adjust track and effect levels.'
          : coarse
            ? 'Tap Play, then tap squares to edit.'
            : 'Press Play, then click squares to edit.';

  const renderGridBlock = (block: number[], blockIndex: number) => (
    <div
      key={`${block[0] ?? 'empty'}-${blockIndex}`}
      className="beatpad-grid"
      style={{ '--steps': block.length, '--tracks': tracks.length } as CSSProperties}
    >
      <div className="beatpad-grid-head">
        <span className="beatpad-grid-corner" />
        {block.map((step) => (
          <span key={step} className={step % 4 === 0 ? 'is-beat' : ''}>
            {step % 4 === 0 ? (step % 16) / 4 + 1 : ''}
          </span>
        ))}
      </div>
      {tracks.map((track) => {
        const settings = state.tracks[track];
        const silent = solo ? solo !== track : settings.muted;
        return (
          <div className={`beatpad-row ${selectedTrack === track ? 'is-selected' : ''} ${silent ? 'is-silent' : ''}`} key={track}>
            <button
              className="beatpad-track-name"
              aria-pressed={selectedTrack === track}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => setSelectedTrack(track)}
            >{TRACK_NAMES[track]}</button>
            {block.map((step) => {
              const velocity = stepVelocity(pattern, track, step);
              const degree = isSynth(track) ? pattern.notes[track][step] : 0;
              const isSelected = selectedCell?.track === track && selectedCell.step === step;
              const isPlayhead = playhead?.pattern === state.current && playhead.step === step;
              const group = Math.floor((step % 16) / 4);
              return (
                <button
                  key={step}
                  type="button"
                  data-track={track}
                  data-step={step}
                  data-velocity={velocity}
                  className={`beatpad-cell track-${track.replace(' ', '-')} ${velocity ? 'is-on' : ''} ${step % 4 === 0 ? 'is-beat' : ''} ${group % 2 ? 'is-group-alt' : ''} ${isPlayhead ? 'is-playhead' : ''} ${isPlayhead && velocity ? 'is-hit' : ''} ${isSelected ? 'is-selected' : ''}`}
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
  );

  const renderMixTrack = (track: TrackId) => {
    const settings = state.tracks[track];
    return (
      <div className={`beatpad-mix-track ${selectedTrack === track ? 'is-selected' : ''}`} key={track}>
        <button className="beatpad-mix-name" aria-pressed={selectedTrack === track} onClick={() => setSelectedTrack(track)}>{TRACK_NAMES[track]}</button>
        <Slider
          className="beatpad-volume-slider"
          label={`${TRACK_NAMES[track]} Volume`}
          value={settings.volume}
          display={`${settings.volume}%`}
          min={0}
          max={100}
          onChange={(volume) => commit((current) => updateTrack(current, track, { volume }), `volume-${track}`)}
          onSettle={settle}
        />
        <button className="gbtn gbtn-sm beatpad-mix-toggle" aria-pressed={settings.muted} onClick={() => toggleMute(track)}>{settings.muted ? 'Muted' : 'Mute'}</button>
        <button className="gbtn gbtn-sm beatpad-mix-toggle" aria-pressed={solo === track} onClick={() => toggleSolo(track)}>Solo</button>
      </div>
    );
  };

  return (
    <div
      ref={rootRef}
      className={`beatpad-app gc-dark ${coarse ? 'is-coarse' : ''}`}
      style={{ '--tint': '#c49c65' } as CSSProperties}
      tabIndex={-1}
      onPointerDownCapture={() => {
        const engine = ensureEngine();
        engine.unlock();
        ensureVisualizer(engine);
      }}
    >
      <header className="beatpad-toolbar">
        <button className="gbtn gbtn-primary gbtn-lg beatpad-play" aria-pressed={playing} title="Play or Stop (Space)" onClick={togglePlayback}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            {playing ? <rect x="3" y="3" width="10" height="10" rx="1.5" fill="currentColor" /> : <path d="M5 3.5v9l7-4.5z" fill="currentColor" />}
          </svg>
          {playing ? 'Stop' : 'Play'}
        </button>
        <div className="beatpad-tempo" role="group" aria-label="Tempo">
          <button className="gbtn beatpad-tempo-step" aria-label="Decrease tempo" disabled={state.bpm <= BPM_MIN} onClick={() => changeTempo(-1)}>−</button>
          <span className="beatpad-tempo-value" aria-live="polite">{state.bpm} BPM</span>
          <button className="gbtn beatpad-tempo-step" aria-label="Increase tempo" disabled={state.bpm >= BPM_MAX} onClick={() => changeTempo(1)}>+</button>
        </div>
        <button className="gbtn beatpad-tap" onPointerDown={(event) => { event.preventDefault(); tap(); }}>Tap Tempo</button>
        <label className="beatpad-kit">
          <span className="beatpad-sr-only">Kit</span>
          <select className="ginput beatpad-select" aria-label="Kit" value={state.kit} onChange={(event) => commit((current) => ({ ...current, kit: event.target.value as BeatState['kit'] }))}>
            {KITS.map((kit) => <option key={kit} value={kit}>{KIT_NAMES[kit]}</option>)}
          </select>
        </label>
        <div className="beatpad-spectrum-slot">
          {visualizerReady && <canvas ref={canvasRef} className="beatpad-spectrum" width="88" height="24" data-level="0" aria-label="Audio spectrum" />}
        </div>
        <div className="beatpad-toolbar-right">
          <button className="gbtn beatpad-icon" aria-label="Undo" title="Undo" disabled={!history.past.length} onClick={undo}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4 3 7l3 3M3.5 7H10a3 3 0 0 1 0 6H8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <button className="gbtn beatpad-icon" aria-label="Redo" title="Redo" disabled={!history.future.length} onClick={redo}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="m10 4 3 3-3 3M12.5 7H6a3 3 0 0 0 0 6h2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <button className="gbtn beatpad-share" onClick={() => void share()}>{copied === 'done' ? 'Link Copied' : copied === 'failed' ? 'Copy Failed' : 'Share'}</button>
        </div>
      </header>

      <section className="beatpad-groove-row">
        <span className="beatpad-section-label">Grooves</span>
        <div className="gseg beatpad-grooves" role="group" aria-label="Grooves">
          {GROOVES.map((groove) => (
            <button key={groove} aria-pressed={state.groove === groove} onClick={() => chooseGroove(groove)}>{PRESET_NAMES[groove]}</button>
          ))}
        </div>
        <div className="beatpad-groove-actions">
          <button className="gbtn" onClick={remix}>Remix</button>
          <button className="gbtn" disabled={isPatternEmpty(pattern)} onClick={clearCurrent}>Clear</button>
        </div>
      </section>

      <div className="beatpad-hint-nav">
        <p className="beatpad-hint" aria-live="polite">{patternHint}{hint}</p>
        <nav className="beatpad-view-nav" aria-label="Beat Pad Views">
          <div className="gseg beatpad-views" role="group" aria-label="Views">
            {VIEWS.map((item) => (
              <button key={item.id} aria-pressed={view === item.id} onClick={() => setView(item.id)}>{item.label}</button>
            ))}
          </div>
        </nav>
      </div>

      {view === 'drums' && (
        <main className="beatpad-content beatpad-grid-content" aria-label="Drum pattern">
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
            className={`beatpad-grid-layout ${narrow ? 'is-narrow' : 'is-wide'} ${showNotes ? 'show-notes' : ''}`}
            style={{ '--label-width': narrow ? '62px' : coarse ? '128px' : '112px' } as CSSProperties}
            onPointerDown={onGridPointerDown}
            onPointerMove={onGridPointerMove}
            onPointerUp={endPaint}
            onPointerCancel={endPaint}
            onLostPointerCapture={endPaint}
          >
            {blocks.map(renderGridBlock)}
          </div>
        </main>
      )}

      {view === 'melody' && (
        <main className="beatpad-content beatpad-melody-content" aria-label="Melody pattern">
          <div className="beatpad-melody-header">
            <label className="beatpad-select-field">
              <span className="beatpad-section-label">Key</span>
              <select className="ginput beatpad-select" value={state.root} onChange={(event) => commit((current) => ({ ...current, root: Number(event.target.value) }))}>
                {ROOT_NAMES.map((name, index) => <option key={name} value={index}>{name}</option>)}
              </select>
            </label>
            <label className="beatpad-select-field">
              <span className="beatpad-section-label">Scale</span>
              <select className="ginput beatpad-select" value={state.scale} onChange={(event) => commit((current) => ({ ...current, scale: event.target.value as BeatState['scale'] }))}>
                {SCALES.map((scale) => <option key={scale} value={scale}>{SCALE_NAMES[scale]}</option>)}
              </select>
            </label>
          </div>
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
            className={`beatpad-grid-layout ${narrow ? 'is-narrow' : 'is-wide'} ${showNotes ? 'show-notes' : ''}`}
            style={{ '--label-width': narrow ? '62px' : coarse ? '128px' : '112px' } as CSSProperties}
            onPointerDown={onGridPointerDown}
            onPointerMove={onGridPointerMove}
            onPointerUp={endPaint}
            onPointerCancel={endPaint}
            onLostPointerCapture={endPaint}
          >
            {blocks.map(renderGridBlock)}
          </div>
        </main>
      )}

      {view === 'pads' && (
        <main className="beatpad-content beatpad-pads-content" aria-label="Live Pads">
          <div className="beatpad-pads">
            {TRACKS.map((track) => (
              <button
                key={track}
                className={`gpad beatpad-pad track-${track.replace(' ', '-')} ${padLit[track] ? 'is-lit' : ''}`}
                aria-pressed={Boolean(padLit[track])}
                onPointerDown={(event) => { event.preventDefault(); hit(track); }}
                onKeyDown={(event) => { if (event.code === 'Enter' || event.code === 'Space') { event.preventDefault(); hit(track); } }}
              >{TRACK_NAMES[track]}</button>
            ))}
          </div>
          <div className="beatpad-pads-foot">
            <button className={`gbtn ${recording ? 'is-recording' : ''}`} aria-pressed={recording} onClick={toggleRecording}>{recording ? 'Recording' : 'Record'}</button>
          </div>
        </main>
      )}

      {view === 'song' && (
        <main className="beatpad-content beatpad-song-content" aria-label="Song arrangement">
          <div className="beatpad-song-pattern">
            <span className="beatpad-section-label">Current Pattern {PATTERN_NAMES[state.current]}</span>
            <div className="gseg beatpad-patterns" role="group" aria-label="Pattern">
              {PATTERN_NAMES.map((name, index) => (
                <button
                  key={name}
                  aria-pressed={state.current === index}
                  className={`${isPatternEmpty(state.patterns[index]) ? 'is-empty' : ''} ${selectedPattern === index ? 'is-playing' : ''}`}
                  title={`Pattern ${name} (${index + 1})`}
                  onClick={() => selectPattern(index)}
                >{name}</button>
              ))}
            </div>
          </div>
          <div className="beatpad-field-row">
            <div className="beatpad-select-field">
              <span className="beatpad-section-label">Pattern Length</span>
              <div className="gseg beatpad-control-segment" role="group" aria-label="Pattern length">
                {PATTERN_LENGTHS.map((length) => <button key={length} aria-pressed={pattern.length === length} onClick={() => editPattern((p) => setPatternLength(p, length as PatternLength))}>{length} Steps</button>)}
              </div>
            </div>
            <div className="beatpad-select-field">
              <span className="beatpad-section-label">Copy Pattern To</span>
              <div className="gseg beatpad-control-segment" role="group" aria-label="Copy pattern to">
                {PATTERN_NAMES.map((name, index) => (
                  <button key={name} disabled={index === state.current} onClick={() => commit((current) => replacePattern(current, index, current.patterns[current.current]))}>{name}</button>
                ))}
              </div>
            </div>
            <div className="beatpad-select-field">
              <span className="beatpad-section-label">Play Mode</span>
              <div className="gseg beatpad-control-segment" role="group" aria-label="Play mode">
                <button aria-pressed={!state.songMode} onClick={() => commit((current) => ({ ...current, songMode: false }))}>Pattern</button>
                <button aria-pressed={state.songMode} disabled={!state.song.length} onClick={() => commit((current) => ({ ...current, songMode: true }))}>Song</button>
              </div>
            </div>
            <button className="gbtn" onClick={randomize}>New Pattern</button>
          </div>
          <div className="beatpad-song-chain-field">
            <span className="beatpad-section-label">Song Chain</span>
            <div className="beatpad-chain">
              {state.song.map((index, position) => (
                <button
                  key={position}
                  className={`gbtn beatpad-chip ${state.songMode && playhead?.songIndex === position ? 'is-playing' : ''}`}
                  aria-label={`Remove Pattern ${PATTERN_NAMES[index]} from song`}
                  title={`Remove Pattern ${PATTERN_NAMES[index]}`}
                  onClick={() => commit((current) => {
                    const song = current.song.filter((_, at) => at !== position);
                    return { ...current, song, songMode: song.length ? current.songMode : false };
                  })}
                >{PATTERN_NAMES[index]}</button>
              ))}
              {state.song.length < MAX_SONG && (
                <div className="gseg beatpad-chain-add" role="group" aria-label="Add pattern to song">
                  {PATTERN_NAMES.map((name, index) => (
                    <button key={name} aria-label={`Add Pattern ${name}`} title={`Add Pattern ${name}`} onClick={() => commit((current) => ({ ...current, song: [...current.song, index] }))}>Add {name}</button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </main>
      )}

      {view === 'mix' && (
        <main className="beatpad-content beatpad-mix-content" aria-label="Mixer">
          <div className="beatpad-mix-effects">
            <Slider label="Swing" value={state.swing} display={state.swing ? `${state.swing}%` : 'Off'} min={0} max={SWING_MAX} onChange={(swing) => commit((current) => ({ ...current, swing }), 'swing')} onSettle={settle} />
            <Slider label="Filter" value={state.fx.filter} display={filterLabel(state.fx.filter)} min={0} max={100} onChange={(filter) => commit((current) => ({ ...current, fx: { ...current.fx, filter } }), 'filter')} onSettle={settle} />
            <Slider label="Reverb" value={state.fx.reverb} display={state.fx.reverb ? `${state.fx.reverb}%` : 'Off'} min={0} max={100} onChange={(reverb) => commit((current) => ({ ...current, fx: { ...current.fx, reverb } }), 'reverb')} onSettle={settle} />
            <Slider label="Delay" value={state.fx.delay} display={state.fx.delay ? `${state.fx.delay}%` : 'Off'} min={0} max={100} onChange={(delay) => commit((current) => ({ ...current, fx: { ...current.fx, delay } }), 'delay')} onSettle={settle} />
          </div>
          <div className="beatpad-mix-list">{TRACKS.map(renderMixTrack)}</div>
          <section className="beatpad-track-detail" aria-label={`${TRACK_NAMES[selectedTrack]} settings`}>
            <div className="beatpad-track-detail-head">
              <b>{TRACK_NAMES[selectedTrack]}</b>
              <button className="gbtn gbtn-sm" onClick={() => editPattern((p) => clearTrack(p, selectedTrack))}>Clear Track</button>
            </div>
            <div className="beatpad-track-detail-sliders">
              <Slider label="Pitch" value={trackSettings.pitch} display={trackSettings.pitch === 0 ? '0' : `${signed(trackSettings.pitch)} st`} min={-12} max={12} onChange={(pitch) => commit((current) => updateTrack(current, selectedTrack, { pitch }), `pitch-${selectedTrack}`)} onSettle={settle} />
              <Slider label="Decay" value={trackSettings.decay} display={`${trackSettings.decay}%`} min={0} max={100} onChange={(decay) => commit((current) => updateTrack(current, selectedTrack, { decay }), `decay-${selectedTrack}`)} onSettle={settle} />
            </div>
            {selected ? (
              <div className="beatpad-selected-cell">
                <div className="beatpad-selected-cell-title">
                  <span>Step {selected.step + 1}</span>
                  <span>{TRACK_NAMES[selected.track]}</span>
                </div>
                <div className="gseg beatpad-velocity" role="group" aria-label="Velocity">
                  {[0, 1, 2, 3].map((velocity) => (
                    <button key={velocity} aria-pressed={selectedVelocity === velocity} onClick={() => editPattern((p) => setStep(p, selected.track, selected.step, velocity as Velocity))}>{VELOCITY_NAMES[velocity]}</button>
                  ))}
                </div>
                {selectedNote && selectedSynthTrack && (
                  <div className="beatpad-note">
                    <button className="gbtn gbtn-sm" onClick={() => editPattern((p) => changeStepDegree(p, selectedSynthTrack, selected.step, -1, state.scale))}>Lower</button>
                    <b>{selectedNote.name}</b>
                    <button className="gbtn gbtn-sm" onClick={() => editPattern((p) => changeStepDegree(p, selectedSynthTrack, selected.step, 1, state.scale))}>Higher</button>
                  </div>
                )}
              </div>
            ) : (
              <span className="ghelp">Select a step in the grid to edit velocity or note.</span>
            )}
          </section>
        </main>
      )}
    </div>
  );
}
