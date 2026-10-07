import type { ReactNode } from 'react';
import { sfx } from './sfx';

export type PlayMode = 'cpu' | '2p';
export type LevelName = 'easy' | 'normal' | 'hard';
export const PLAY_MODES = ['cpu', '2p'] as const;
export const LEVEL_NAMES = ['easy', 'normal', 'hard'] as const;
export const modeOptions = [
  ['cpu', 'vs Computer'],
  ['2p', '2 Players'],
] as const satisfies readonly (readonly [PlayMode, string])[];
export const levelOptions = [
  ['easy', 'Easy'],
  ['normal', 'Normal'],
  ['hard', 'Hard'],
] as const satisfies readonly (readonly [LevelName, string])[];
/** 0, 1, 2 for easy, normal, hard. */
export const levelIndex = (l: LevelName) => LEVEL_NAMES.indexOf(l) as 0 | 1 | 2;
export const levelLabel = (l: LevelName) => levelOptions[levelIndex(l)][1];

export type SegmentedProps<T extends string> = {
  value: T;
  options: readonly (readonly [T, ReactNode])[];
  onChange: (v: T) => void;
  label?: string;
  className?: string;
};

/** macOS style segmented control, dark variant for the shell's cards and light variant via .is-light. */
export function Segmented<T extends string>({ value, options, onChange, label, className }: SegmentedProps<T>) {
  const seg = (
    <div className={['arcade-seg', className ?? ''].join(' ')} role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button
          type="button"
          key={v}
          aria-pressed={v === value}
          onClick={() => {
            if (v === value) return;
            sfx.play('select');
            onChange(v);
          }}
        >
          {text}
        </button>
      ))}
    </div>
  );
  if (!label) return seg;
  return (
    <div className="arcade-field">
      <span>{label}</span>
      {seg}
    </div>
  );
}
