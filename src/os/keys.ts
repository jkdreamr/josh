export type KeyKind = 'c' | '2' | 'l' | 'r' | 'fn' | 'touch';
export type KeyDef = { a?: string; b?: string; w?: number; k?: KeyKind };

const sym = (pairs: string) => pairs.split(' ').map((p): KeyDef => ({ a: p[0], b: p[1], k: '2' }));
const letters = (row: string) => [...row].map((b): KeyDef => ({ b, k: 'c' }));

/** MacBook Pro (US ANSI) layout; widths are in key units, every row sums to 14.5 (the last row plus a 3-unit arrow cluster). */
export const keyRows: KeyDef[][] = [
  [{ b: 'esc', w: 1.5, k: 'l' }, ...Array.from({ length: 12 }, (_, i): KeyDef => ({ b: `F${i + 1}`, k: 'fn' })), { k: 'touch' }],
  [...sym('~` !1 @2 #3 $4 %5 ^6 &7 *8 (9 )0 _- +='), { b: 'delete', w: 1.5, k: 'r' }],
  [{ b: 'tab', w: 1.5, k: 'l' }, ...letters('QWERTYUIOP'), ...sym('{[ }] |\\')],
  [{ b: 'caps lock', w: 1.8, k: 'l' }, ...letters('ASDFGHJKL'), ...sym(':; "\''), { b: 'return', w: 1.7, k: 'r' }],
  [{ b: 'shift', w: 2.3, k: 'l' }, ...letters('ZXCVBNM'), ...sym('<, >. ?/'), { b: 'shift', w: 2.2, k: 'r' }],
  [
    { b: 'fn', k: 'l' },
    { a: '⌃', b: 'control', k: 'l' },
    { a: '⌥', b: 'option', k: 'l' },
    { a: '⌘', b: 'command', w: 1.25, k: 'l' },
    { w: 5 },
    { a: '⌘', b: 'command', w: 1.25, k: 'r' },
    { a: '⌥', b: 'option', k: 'r' },
  ],
];
