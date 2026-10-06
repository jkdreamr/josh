import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { beatStepTime, changeStepPitch, createBeatState, decodeBeatState, encodeBeatState, isStepOn, PENTATONIC_KEYS, PENTATONIC_NOTES, setStepPitch, sixteenthDuration, SYNTH_TRACKS, toggleStep, TRACKS, type BeatState, type PresetName, type SynthTrack, type TrackId } from '../games/beat';
import { useOS, type AppProps } from '../types';
import './game-controls.css';
import './BeatPad.css';

type PresetOption = PresetName | 'custom';
type Scheduler = {
  context: AudioContext;
  noise: AudioBuffer;
  timer: number | null;
  raf: number;
  active: boolean;
  epoch: number;
  nextStep: number;
};

function titleTrack(track: TrackId): string {
  return track.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function makeNoise(context: AudioContext): AudioBuffer {
  const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
  return buffer;
}

function envelope(context: AudioContext, time: number, peak: number, duration: number): GainNode {
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(peak, time + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + Math.max(0.02, duration));
  return gain;
}

function noiseHit(
  context: AudioContext,
  buffer: AudioBuffer,
  time: number,
  duration: number,
  peak: number,
  filterType: BiquadFilterType,
  frequency: number,
) {
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = envelope(context, time, peak, duration);
  source.buffer = buffer;
  filter.type = filterType;
  filter.frequency.setValueAtTime(frequency, time);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(context.destination);
  source.start(time);
  source.stop(time + duration + 0.02);
}

function scheduleSound(
  context: AudioContext,
  noise: AudioBuffer,
  track: TrackId,
  time: number,
  stepDuration: number,
  frequency: number,
) {
  if (track === 'kick') {
    const osc = context.createOscillator();
    const gain = envelope(context, time, 0.72, 0.25);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(145, time);
    osc.frequency.exponentialRampToValueAtTime(42, time + 0.14);
    osc.connect(gain);
    gain.connect(context.destination);
    osc.start(time);
    osc.stop(time + 0.28);
  } else if (track === 'snare') {
    noiseHit(context, noise, time, 0.13, 0.34, 'bandpass', 1650);
    const body = context.createOscillator();
    const gain = envelope(context, time, 0.16, 0.09);
    body.type = 'triangle';
    body.frequency.setValueAtTime(190, time);
    body.frequency.exponentialRampToValueAtTime(100, time + 0.08);
    body.connect(gain);
    gain.connect(context.destination);
    body.start(time);
    body.stop(time + 0.11);
  } else if (track === 'hat') {
    noiseHit(context, noise, time, 0.045, 0.13, 'highpass', 7600);
  } else if (track === 'open hat') {
    noiseHit(context, noise, time, 0.26, 0.19, 'highpass', 6400);
  } else if (track === 'clap') {
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = noise;
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1400, time);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(context.destination);
    gain.gain.setValueAtTime(0.0001, time);
    for (const offset of [0, 0.018, 0.036]) {
      gain.gain.setValueAtTime(0.3, time + offset);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + offset + 0.012);
    }
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.19);
    source.start(time);
    source.stop(time + 0.21);
  } else if (track === 'bass') {
    const osc = context.createOscillator();
    const filter = context.createBiquadFilter();
    const gain = envelope(context, time, 0.2, Math.max(0.09, stepDuration * 0.9));
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(frequency / 2, time);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(290, time);
    filter.frequency.exponentialRampToValueAtTime(115, time + 0.12);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(context.destination);
    osc.start(time);
    osc.stop(time + Math.max(0.12, stepDuration));
  } else if (track === 'keys') {
    const carrier = context.createOscillator();
    const modulator = context.createOscillator();
    const modGain = context.createGain();
    const filter = context.createBiquadFilter();
    const gain = envelope(context, time, 0.14, Math.max(0.14, stepDuration * 1.8));
    carrier.type = 'triangle';
    carrier.frequency.setValueAtTime(frequency, time);
    modulator.frequency.setValueAtTime(frequency * 2, time);
    modGain.gain.setValueAtTime(frequency * 0.12, time);
    modulator.connect(modGain);
    modGain.connect(carrier.frequency);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2400, time);
    carrier.connect(filter);
    filter.connect(gain);
    gain.connect(context.destination);
    carrier.start(time);
    modulator.start(time);
    carrier.stop(time + Math.max(0.2, stepDuration * 2));
    modulator.stop(time + Math.max(0.2, stepDuration * 2));
  } else {
    const filter = context.createBiquadFilter();
    const gain = envelope(context, time, 0.105, Math.max(0.1, stepDuration * 0.9));
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(3100, time);
    for (const detune of [-7, 7]) {
      const osc = context.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(frequency, time);
      osc.detune.setValueAtTime(detune, time);
      osc.connect(filter);
      osc.start(time);
      osc.stop(time + Math.max(0.15, stepDuration));
    }
    filter.connect(gain);
    gain.connect(context.destination);
  }
}

export default function BeatPad({ args }: AppProps) {
  const os = useOS();
  const incoming = useMemo(() => args.beat ? decodeBeatState(args.beat) : null, [args.beat, args.nonce]);
  const [state, setState] = useState<BeatState>(() => incoming ?? createBeatState());
  const [preset, setPreset] = useState<PresetOption>('kelix lofi');
  const [selectedTrack, setSelectedTrack] = useState<SynthTrack>('bass');
  const [selectedCell, setSelectedCell] = useState<{ track: SynthTrack; step: number } | null>(null);
  const [muted, setMuted] = useState<Record<TrackId, boolean>>(() => Object.fromEntries(TRACKS.map((track) => [track, false])) as Record<TrackId, boolean>);
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(-1);
  const [copied, setCopied] = useState(false);
  const stateRef = useRef(state);
  const mutedRef = useRef(muted);
  const schedulerRef = useRef<Scheduler | null>(null);
  stateRef.current = state;
  mutedRef.current = muted;

  useEffect(() => {
    if (!incoming) return;
    setState(incoming);
    setPreset('custom');
  }, [incoming]);

  const stopPlayback = useCallback(() => {
    const scheduler = schedulerRef.current;
    if (scheduler) {
      scheduler.active = false;
      if (scheduler.timer !== null) window.clearTimeout(scheduler.timer);
      cancelAnimationFrame(scheduler.raf);
    }
    setPlaying(false);
    setPlayhead(-1);
  }, []);

  const startPlayback = useCallback(() => {
    let scheduler = schedulerRef.current;
    if (!scheduler) {
      const context = new AudioContext();
      scheduler = {
        context,
        noise: makeNoise(context),
        timer: null,
        raf: 0,
        active: false,
        epoch: 0,
        nextStep: 0,
      };
      schedulerRef.current = scheduler;
    }
    void scheduler.context.resume();
    scheduler.active = true;
    scheduler.epoch = scheduler.context.currentTime + 0.045;
    scheduler.nextStep = 0;
    const currentScheduler = scheduler;

    const tick = () => {
      if (!currentScheduler.active) return;
      const config = stateRef.current;
      const stepDuration = sixteenthDuration(config.bpm);
      const barDuration = stepDuration * 16;
      while (true) {
        const absolute = currentScheduler.nextStep;
        const step = absolute % 16;
        const bar = Math.floor(absolute / 16);
        const time = currentScheduler.epoch + bar * barDuration + beatStepTime(step, config.bpm, config.swing);
        if (time >= currentScheduler.context.currentTime + 0.1) break;
        for (const track of TRACKS) {
          if (!mutedRef.current[track] && isStepOn(config.pattern, track, step)) {
            const noteIndex = track === 'kick' || track === 'snare' || track === 'hat' || track === 'open hat' || track === 'clap'
              ? 0
              : config.pattern.notes[track][step];
            const note = PENTATONIC_NOTES[config.key][noteIndex];
            scheduleSound(currentScheduler.context, currentScheduler.noise, track, time, stepDuration, note.frequency);
          }
        }
        currentScheduler.nextStep += 1;
      }
      currentScheduler.timer = window.setTimeout(tick, 25);
    };
    const animate = () => {
      if (!currentScheduler.active) return;
      const config = stateRef.current;
      const barDuration = 60 / config.bpm * 4;
      const elapsed = Math.max(0, currentScheduler.context.currentTime - currentScheduler.epoch);
      const inBar = elapsed % barDuration;
      let currentStep = 0;
      for (let step = 0; step < 16; step += 1) {
        if (beatStepTime(step, config.bpm, config.swing) <= inBar) currentStep = step;
        else break;
      }
      setPlayhead(currentStep);
      currentScheduler.raf = requestAnimationFrame(animate);
    };
    tick();
    currentScheduler.raf = requestAnimationFrame(animate);
    setPlaying(true);
  }, []);

  const togglePlayback = useCallback(() => {
    if (schedulerRef.current?.active) stopPlayback();
    else startPlayback();
  }, [startPlayback, stopPlayback]);

  useEffect(() => () => {
    const scheduler = schedulerRef.current;
    if (scheduler) {
      scheduler.active = false;
      if (scheduler.timer !== null) window.clearTimeout(scheduler.timer);
      cancelAnimationFrame(scheduler.raf);
      void scheduler.context.close();
      schedulerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.code !== 'Space' || event.repeat || target?.closest('input, select, textarea, button')) return;
      event.preventDefault();
      event.stopPropagation();
      togglePlayback();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [togglePlayback]);

  const setPresetState = (value: PresetOption) => {
    setPreset(value);
    if (value !== 'custom') {
      stopPlayback();
      setState(createBeatState(value));
    }
  };

  const changePitch = (track: SynthTrack, step: number, amount: number) => {
    setState((current) => ({ ...current, pattern: changeStepPitch(current.pattern, track, step, amount) }));
    setSelectedTrack(track);
    setSelectedCell({ track, step });
    setPreset('custom');
  };

  const copyLink = async () => {
    const url = `${window.location.origin}${window.location.pathname}?beat=${encodeBeatState(state)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const scale = PENTATONIC_NOTES[state.key];
  const selectedPitch = selectedCell?.track === selectedTrack
    ? state.pattern.notes[selectedTrack][selectedCell.step]
    : 0;

  return (
    <div className="beatpad-app gc-dark" style={{ '--tint': '#7c5cff' } as CSSProperties}>
      <header className="beatpad-header">
        <div className="beatpad-brand"><h1>Beat Pad</h1></div>
        <label className="beatpad-preset">
          <span className="glabel">Preset</span>
          <select className="ginput beatpad-select" value={preset} onChange={(event) => setPresetState(event.target.value as PresetOption)}>
            <option value="kelix lofi">Kelix Lo-Fi</option>
            <option value="boom bap">Boom Bap</option>
            <option value="house">House</option>
            <option value="trap">Trap</option>
            {preset === 'custom' && <option value="custom">Custom</option>}
          </select>
        </label>
      </header>
      <div className="beatpad-controls">
        <label className="beatpad-tempo">
          <span className="glabel">Tempo <b>{state.bpm}</b></span>
          <input type="range" min="60" max="160" value={state.bpm} onChange={(event) => { setState((current) => ({ ...current, bpm: Number(event.target.value) })); setPreset('custom'); }} />
        </label>
        <label className="beatpad-swing">
          <span className="glabel">Swing <b>{state.swing}%</b></span>
          <input type="range" min="0" max="60" value={state.swing} onChange={(event) => { setState((current) => ({ ...current, swing: Number(event.target.value) })); setPreset('custom'); }} />
        </label>
        <label className="beatpad-key">
          <span className="glabel">Key</span>
          <select className="ginput beatpad-select" value={state.key} onChange={(event) => { setState((current) => ({ ...current, key: event.target.value as BeatState['key'] })); setPreset('custom'); }}>
            {PENTATONIC_KEYS.map((key) => <option key={key} value={key}>{key}</option>)}
          </select>
        </label>
        <button className="gbtn gbtn-primary" aria-pressed={playing} title="Play or Stop (Space)" onClick={togglePlayback}>
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            {playing ? <rect x="4" y="3" width="3" height="10" rx="1" fill="currentColor" /> : <path d="M5 3.5v9l7-4.5z" fill="currentColor" />}
            {playing && <rect x="9" y="3" width="3" height="10" rx="1" fill="currentColor" />}
          </svg>
          {playing ? 'Stop' : 'Play'}
        </button>
        <button className="gbtn" onClick={() => { stopPlayback(); setState((current) => ({ ...current, pattern: { ...current.pattern, tracks: Object.fromEntries(TRACKS.map((track) => [track, 0])) as BeatState['pattern']['tracks'] } })); setPreset('custom'); }}>Clear</button>
      </div>
      <main className="beatpad-workspace">
        <div className="beatpad-grid-scroll">
          <div className="beatpad-grid">
            <div className="beatpad-grid-head">
              <span>Track</span>
              {Array.from({ length: 16 }, (_, step) => <span key={step} className={step % 4 === 0 ? 'is-bar' : ''}>{step % 4 === 0 ? step / 4 + 1 : '·'}</span>)}
            </div>
            {TRACKS.map((track) => {
              const isSynth = (SYNTH_TRACKS as readonly string[]).includes(track);
              return (
                <div className={`beatpad-grid-row ${isSynth && selectedTrack === track ? 'is-selected' : ''}`} key={track}>
                  <div className="beatpad-track-label">
                    {isSynth
                      ? <button className="gbtn gbtn-plain beatpad-track-name" aria-pressed={selectedTrack === track} onClick={() => setSelectedTrack(track as SynthTrack)}>{titleTrack(track)}</button>
                      : <span className="beatpad-track-name">{titleTrack(track)}</span>}
                    <button className="gbtn gbtn-sm beatpad-mute" aria-label={`${muted[track] ? 'Unmute' : 'Mute'} ${titleTrack(track)}`} aria-pressed={muted[track]} title={`${muted[track] ? 'Unmute' : 'Mute'} ${titleTrack(track)}`} onClick={() => setMuted((current) => ({ ...current, [track]: !current[track] }))}>
                      <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M2 6h3l4-3v10l-4-3H2zM11 5.2a4 4 0 0 1 0 5.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                        {muted[track] && <path d="m11.5 3 3 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />}
                      </svg>
                    </button>
                  </div>
                  {Array.from({ length: 16 }, (_, step) => {
                    const active = isStepOn(state.pattern, track, step);
                    const pitchIndex = isSynth ? state.pattern.notes[track as SynthTrack][step] : 0;
                    const selected = selectedCell?.track === track && selectedCell.step === step;
                    return (
                      <button
                        key={step}
                        className={`beatpad-cell ${active ? 'is-active' : ''} ${step % 4 === 0 ? 'is-bar' : ''} ${playhead === step ? 'is-playhead' : ''} ${selected ? 'is-cell-selected' : ''} track-${track.replace(' ', '-')}`}
                        aria-label={`${track}, step ${step + 1}${active ? ', on' : ', off'}`}
                        aria-pressed={active}
                        onClick={() => {
                          setState((current) => ({ ...current, pattern: toggleStep(current.pattern, track, step) }));
                          if (isSynth) {
                            setSelectedTrack(track as SynthTrack);
                            setSelectedCell({ track: track as SynthTrack, step });
                          }
                          setPreset('custom');
                        }}
                        onWheel={(event) => {
                          if (!isSynth) return;
                          event.preventDefault();
                          changePitch(track as SynthTrack, step, event.deltaY > 0 ? 1 : -1);
                        }}
                        onContextMenu={(event) => {
                          if (!isSynth) return;
                          event.preventDefault();
                          changePitch(track as SynthTrack, step, 1);
                        }}
                      >
                        {active && isSynth && <small>{scale[pitchIndex].name}</small>}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
        <div className="beatpad-pitch-row">
          <div><b>{titleTrack(selectedTrack)}</b><span>Minor pentatonic · scroll or right-click a step to shift</span></div>
          <div className="beatpad-pitches gseg">
            {scale.map((note, index) => (
              <button
                key={note.name}
                aria-pressed={selectedPitch === index}
                onClick={() => {
                  if (selectedCell?.track === selectedTrack) {
                    setState((current) => ({ ...current, pattern: setStepPitch(current.pattern, selectedTrack, selectedCell.step, index) }));
                    setPreset('custom');
                  }
                }}
                title={`${note.name} · ${note.frequency.toFixed(1)} Hz`}
              >{note.name}</button>
            ))}
          </div>
        </div>
      </main>
      <footer className="beatpad-footer">
        <span className="ghelp">Space to Play or Stop · 16 steps · 8 tracks</span>
        <div>
          <button className="gbtn gbtn-sm" onClick={() => void copyLink()}>{copied ? 'Link Copied' : 'Copy Link'}</button>
          <button className="gbtn gbtn-plain" onClick={() => os.open('spotify')}>Listen to Kelix</button>
        </div>
      </footer>
    </div>
  );
}
