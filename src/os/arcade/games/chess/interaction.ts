import { FLAG_CASTLE, FLAG_EP, WHITE, fileOf, moveFlags, moveFrom, moveTo, pieces, rankOf, square, type Position } from './engine.ts';

export type Point = { x: number; y: number };
export type BoardQuad = readonly [Point, Point, Point, Point];

// Invert the board's projected plane, including CSS3D perspective, not its bounding box.
export function boardPoint(point: Point, [tl, tr, br, bl]: BoardQuad): Point | null {
  const dx = tl.x - tr.x + br.x - bl.x;
  const dy = tl.y - tr.y + br.y - bl.y;
  const ax = tr.x - br.x;
  const ay = tr.y - br.y;
  const bx = bl.x - br.x;
  const by = bl.y - br.y;
  const det = ax * by - bx * ay;
  if (Math.abs(det) < 1e-8) return null;
  const g = (dx * by - bx * dy) / det;
  const h = (ax * dy - dx * ay) / det;
  const a = tr.x - tl.x + g * tr.x - point.x * g;
  const b = bl.x - tl.x + h * bl.x - point.x * h;
  const d = tr.y - tl.y + g * tr.y - point.y * g;
  const e = bl.y - tl.y + h * bl.y - point.y * h;
  const determinant = a * e - b * d;
  if (Math.abs(determinant) < 1e-8) return null;
  const x = point.x - tl.x;
  const y = point.y - tl.y;
  const local = { x: (x * e - b * y) / determinant, y: (a * y - x * d) / determinant };
  return Number.isFinite(local.x) && Number.isFinite(local.y) ? local : null;
}

export const columnOf = (sq: number, flipped: boolean) => flipped ? 7 - fileOf(sq) : fileOf(sq);
export const rowOf = (sq: number, flipped: boolean) => flipped ? rankOf(sq) : 7 - rankOf(sq);
export const squareAt = (col: number, row: number, flipped: boolean) => square(flipped ? 7 - col : col, flipped ? row : 7 - row);
export function squareAtPoint(point: Point | null, flipped: boolean) {
  if (!point || point.x < 0 || point.y < 0 || point.x >= 1 || point.y >= 1) return -1;
  return squareAt(Math.floor(point.x * 8), Math.floor(point.y * 8), flipped);
}

export type DragView = { from: number; point: Point };
export function pieceTransform(sq: number, flipped: boolean, boardPx: number, drag: DragView | null) {
  if (drag?.from === sq) return `translate(${drag.point.x * boardPx - boardPx / 16}px, ${drag.point.y * boardPx - boardPx / 16}px) scale(1.12)`;
  return `translate(${columnOf(sq, flipped) * 100}%, ${rowOf(sq, flipped) * 100}%)`;
}
type Drag = { pid: number; from: number; start: Point; moved: boolean };
export class PieceDrag {
  current: Drag | null = null;

  begin(pid: number, from: number, start: Point) {
    if (this.current) return false;
    this.current = { pid, from, start, moved: false };
    return true;
  }

  move(pid: number, client: Point, local: Point | null): DragView | null {
    const d = this.current;
    if (!d || d.pid !== pid || !local) return null;
    if (Math.hypot(client.x - d.start.x, client.y - d.start.y) >= 5) d.moved = true;
    return d.moved ? { from: d.from, point: local } : null;
  }

  end(pid: number) {
    if (this.current?.pid !== pid) return null;
    return this.cancel();
  }

  cancel() {
    const d = this.current;
    this.current = null;
    return d;
  }
}

export const initialIds = (pos: Position) => new Map(pieces(pos).map(([sq], i) => [sq, i + 1]));
export function nextIds(ids: Map<number, number>, pos: Position, m: number) {
  const out = new Map(ids);
  const from = moveFrom(m);
  const to = moveTo(m);
  const flags = moveFlags(m);
  const id = out.get(from)!;
  out.delete(from);
  if (flags & FLAG_EP) out.delete(to + (pos.turn === WHITE ? -16 : 16));
  out.set(to, id);
  if (flags & FLAG_CASTLE) {
    const rookFrom = to > from ? from + 3 : from - 4;
    const rookTo = to > from ? to - 1 : to + 1;
    const r = out.get(rookFrom)!;
    out.delete(rookFrom);
    out.set(rookTo, r);
  }
  return out;
}
