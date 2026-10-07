// Original flat piece set, 100x100 viewBox.
import { BISHOP, KING, KNIGHT, PAWN, QUEEN, ROOK, WHITE, colorOf, typeOf } from './engine.ts';

const SHAPES: Record<number, { fill: string[]; line?: string[] }> = {
  [PAWN]: {
    fill: ['M50 20a11 11 0 1 1 0 22a11 11 0 1 1 0-22z', 'M38 56c0-8 5-13 12-13s12 5 12 13l6 20H32z', 'M26 78h48a3 3 0 0 1 3 3v6a1 1 0 0 1-1 1H24a1 1 0 0 1-1-1v-6a3 3 0 0 1 3-3z'],
  },
  [ROOK]: {
    fill: ['M28 18h11v9h7v-9h8v9h7v-9h11v17l-4 6v30l4 6H28l4-6V41l-4-6z', 'M26 78h48a3 3 0 0 1 3 3v6a1 1 0 0 1-1 1H24a1 1 0 0 1-1-1v-6a3 3 0 0 1 3-3z'],
    line: ['M36 42h28', 'M36 72h28'],
  },
  [KNIGHT]: {
    fill: [
      'M30 78c-1-14 3-26 14-36l-5-6c-2-4 0-10 4-13l2-9 6 7 4-7c6 2 8 8 9 12l12 6c3 2 2 7-1 8l-6 4c2 10 4 20 4 34z',
      'M26 78h48a3 3 0 0 1 3 3v6a1 1 0 0 1-1 1H24a1 1 0 0 1-1-1v-6a3 3 0 0 1 3-3z',
    ],
    line: ['M57 34a1.5 1.5 0 1 0 .1 0', 'M41 44c-4 5-6 12-6 24'],
  },
  [BISHOP]: {
    fill: ['M50 10a5 5 0 1 1 0 10a5 5 0 1 1 0-10z', 'M50 20c-12 8-17 20-15 32h30c2-12-3-24-15-32z', 'M38 56h24l4 20H34z', 'M26 78h48a3 3 0 0 1 3 3v6a1 1 0 0 1-1 1H24a1 1 0 0 1-1-1v-6a3 3 0 0 1 3-3z'],
    line: ['M50 30v14', 'M44 40h12'],
  },
  [QUEEN]: {
    fill: [
      'M26 40l10-18 8 16 6-20 6 20 8-16 10 18-6 36H32z',
      'M36 18a4 4 0 1 1 0 8a4 4 0 1 1 0-8zM50 14a4 4 0 1 1 0 8a4 4 0 1 1 0-8zM64 18a4 4 0 1 1 0 8a4 4 0 1 1 0-8zM26 36a4 4 0 1 1 0 8a4 4 0 1 1 0-8zM74 36a4 4 0 1 1 0 8a4 4 0 1 1 0-8z',
      'M26 78h48a3 3 0 0 1 3 3v6a1 1 0 0 1-1 1H24a1 1 0 0 1-1-1v-6a3 3 0 0 1 3-3z',
    ],
    line: ['M34 62h32'],
  },
  [KING]: {
    fill: ['M47 8h6v8h8v6h-8v8h-6v-8h-8v-6h8z', 'M30 52c0-12 8-18 20-18s20 6 20 18l-4 24H34z', 'M26 78h48a3 3 0 0 1 3 3v6a1 1 0 0 1-1 1H24a1 1 0 0 1-1-1v-6a3 3 0 0 1 3-3z'],
    line: ['M36 62h28'],
  },
};

export function Piece({ piece, className }: { piece: number; className?: string }) {
  const white = colorOf(piece) === WHITE;
  const shape = SHAPES[typeOf(piece)];
  const fill = white ? '#f7f7f5' : '#2c2c31';
  const stroke = white ? '#3a3a40' : '#121216';
  const detail = white ? '#3a3a40' : '#8d8d96';
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <g fill={fill} stroke={stroke} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round">
        {shape.fill.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
      {shape.line && (
        <g fill="none" stroke={detail} strokeWidth="2.6" strokeLinecap="round">
          {shape.line.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>
      )}
    </svg>
  );
}

export { BISHOP, KNIGHT, QUEEN, ROOK };
