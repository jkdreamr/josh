import type { ReactNode } from 'react';
import { defineSetting } from '../../kit';
import { DRILLS, drillById, type DrillId, type PracticeState, type TutorialState } from './practice.ts';

export const PRACTICE_MODE_OPTION = ['practice', 'Practice'] as const;
export const DRILL = defineSetting<DrillId>('soccer:drill', DRILLS.map((drill) => drill.id), 'free');

export type ControlScheme = 'phone' | 'keys' | 'touch';
const LABELS: Record<ControlScheme, Record<string, string>> = {
  phone: { stick: 'the left stick', A: 'A', B: 'B', RB: 'RB', LB: 'LB', sprint: 'Sprint' },
  keys: { stick: 'WASD', A: 'J', B: 'K', RB: 'U', LB: 'U', sprint: 'Shift' },
  touch: { stick: 'the stick', A: 'pass', B: 'shoot', RB: 'skill / finesse', LB: 'skill / finesse', sprint: 'sprint' },
};

export function controlText(text: string, scheme: ControlScheme): ReactNode[] {
  return text.split(/\{(\w+)\}/).map((part, index) => index % 2 ? <kbd key={index}>{LABELS[scheme][part] ?? part}</kbd> : part);
}

export const plainControlText = (text: string, scheme: ControlScheme) => text.replace(/\{(\w+)\}/g, (_, key: string) => LABELS[scheme][key] ?? key);

export type PracticeView = {
  drill: DrillId; prompt: string; hint: string; score: string; best: string; clock: string; done: boolean; newBest: boolean;
};

const formatScore = (drill: DrillId, value: number | null) => value === null || drill === 'slalom' && value <= 0 ? '--' : drill === 'slalom' ? `${value.toFixed(2)}s` : String(value);

export function practiceView(state: PracticeState): PracticeView {
  const remaining = state.limit ? Math.max(0, Math.ceil(state.limit - state.time)) : null;
  const progress = state.attempts ? `${Math.min(state.attempts, state.attempt + (state.phase === 'done' ? 0 : 1))}/${state.attempts}` : '';
  return {
    drill: state.drill, prompt: state.prompt, hint: state.hint,
    score: formatScore(state.drill, state.drill === 'slalom' && !state.runs.length ? null : state.score),
    best: state.drill === 'free' ? '' : formatScore(state.drill, state.best),
    clock: remaining !== null ? `0:${String(remaining).padStart(2, '0')}` : progress,
    done: state.phase === 'done', newBest: state.newBest,
  };
}

export function DrillPicker({ drill, onPick }: { drill: DrillId; onPick: (drill: DrillId) => void }) {
  return (
    <div className="g-soccer-drills" role="group" aria-label="Practice drill">
      {DRILLS.map((item, index) => (
        <button key={item.id} type="button" className={item.id === drill ? 'is-on' : ''} aria-pressed={item.id === drill}
          title={item.blurb} onClick={() => onPick(item.id)} onPointerDown={(event) => event.stopPropagation()}>
          <span>{index}</span>{item.name}
        </button>
      ))}
    </div>
  );
}

export function PracticePanel({ view, scheme, onPick, compact = false }: { view: PracticeView; scheme: ControlScheme; onPick: (drill: DrillId) => void; compact?: boolean }) {
  const drill = drillById(view.drill);
  return (
    <div className={`g-soccer-practice${compact ? ' is-compact' : ''}`}>
      <DrillPicker drill={view.drill} onPick={onPick} />
      <div className="g-soccer-practice-card" aria-live="polite">
        <div className="g-soccer-practice-head">
          <b>{drill.name}</b>
          {view.clock && <span>{view.clock}</span>}
        </div>
        <p className="g-soccer-practice-prompt">{controlText(view.prompt, scheme)}</p>
        <p className="g-soccer-practice-hint">{controlText(view.done ? `${view.newBest ? 'new best! ' : ''}tap {A} to go again, or pick a drill` : view.hint, scheme)}</p>
        <div className="g-soccer-practice-score">
          <span>{view.drill === 'free' ? 'goals' : 'score'} <b>{view.score}</b></span>
          {view.best && <span>best <b>{view.best}</b></span>}
        </div>
      </div>
    </div>
  );
}

const TUTORIAL_TEXT: Record<TutorialState['step'], string> = {
  move: 'move your player with {stick}',
  pass: 'tap {A} to pass to a teammate',
  shoot: 'hold {B}, aim, then let go to shoot',
  done: "you're ready. have fun!",
};
export const tutorialText = (tutorial: TutorialState, defending = false) =>
  tutorial.step === 'pass' && defending ? 'Win the ball, then tap {A} to pass' : TUTORIAL_TEXT[tutorial.step];

export function TutorialOverlay({ tutorial, scheme, seconds, defending = false, onSkip }: { tutorial: TutorialState; scheme: ControlScheme; seconds: number; defending?: boolean; onSkip: () => void }) {
  const steps = ['move', 'pass', 'shoot'] as const;
  const index = tutorial.step === 'done' ? steps.length : steps.indexOf(tutorial.step);
  return (
    <div className="g-soccer-tutorial" role="dialog" aria-label="Quick tutorial">
      <div className="g-soccer-tutorial-steps">
        {steps.map((step, i) => <i key={step} className={i < index ? 'is-done' : i === index ? 'is-on' : ''}>{i + 1} · {step}</i>)}
      </div>
      <p>{controlText(tutorialText(tutorial, defending), scheme)}</p>
      <div className="g-soccer-tutorial-bar"><span style={{ width: `${Math.max(0, 100 - (tutorial.total / seconds) * 100)}%` }} /></div>
      <button type="button" onClick={onSkip} onPointerDown={(event) => event.stopPropagation()}>Skip tutorial</button>
    </div>
  );
}

export type PhonePracticeStatus = { drill: string; prompt: string; hint: string; score: string; best: string; done: boolean; tutorial: string };

export function PhonePracticeStrip({ status, onPick }: { status: PhonePracticeStatus; onPick: (pick: string) => void }) {
  const drill = DRILLS.find((item) => item.id === status.drill);
  return (
    <div className="g-soccer-phone-practice">
      {status.tutorial ? (
        <div className="g-soccer-phone-practice-row">
          <p>{controlText(status.tutorial, 'phone')}</p>
          <button type="button" onClick={() => onPick('skip')}>Skip</button>
        </div>
      ) : drill && (
        <div className="g-soccer-phone-practice-row">
          <p>{controlText(status.done ? 'done! tap {A} to go again' : status.prompt, 'phone')}</p>
          <strong>{status.score}</strong>
        </div>
      )}
    </div>
  );
}
