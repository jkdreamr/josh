import type { Key3 } from './keyboard';

export type Mods = { shift: boolean; caps: boolean; meta: boolean; ctrl: boolean; alt: boolean };

type Field = HTMLInputElement | HTMLTextAreaElement;

const TEXT_INPUTS = new Set(['text', 'search', 'url', 'email', 'password', 'tel', 'number', '']);
const isField = (el: Element | null): el is Field =>
  !!el && ((el instanceof HTMLInputElement && TEXT_INPUTS.has(el.type) && !el.readOnly && !el.disabled) || (el instanceof HTMLTextAreaElement && !el.readOnly && !el.disabled));
const isEditable = (el: Element | null): el is HTMLElement => isField(el) || !!(el instanceof HTMLElement && el.isContentEditable);

/** Sets a field's value through the prototype setter so React's change tracking sees it. */
function setValue(el: Field, v: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, v);
}

function replaceSelection(el: Field, text: string, inputType: string) {
  let s = el.value.length;
  let e = s;
  try {
    s = el.selectionStart ?? s;
    e = el.selectionEnd ?? s;
  } catch {
    /* some input types have no selection */
  }
  if (inputType === 'deleteContentBackward' && s === e) {
    if (s === 0) return;
    s -= 1;
  }
  setValue(el, el.value.slice(0, s) + text + el.value.slice(e));
  try {
    el.setSelectionRange(s + text.length, s + text.length);
  } catch {
    /* ignore */
  }
  el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType, data: text || null }));
}

function moveCaret(el: Field, delta: number, shift: boolean) {
  try {
    const s = el.selectionStart ?? 0;
    const e = el.selectionEnd ?? 0;
    const focus = el.selectionDirection === 'backward' ? s : e;
    const next = Math.max(0, Math.min(el.value.length, (delta > 0 ? e : s) + (s === e || shift ? delta : 0)));
    if (shift) {
      const anchor = el.selectionDirection === 'backward' ? e : s;
      const f = Math.max(0, Math.min(el.value.length, focus + delta));
      el.setSelectionRange(Math.min(anchor, f), Math.max(anchor, f), f < anchor ? 'backward' : 'forward');
    } else el.setSelectionRange(next, next);
  } catch {
    /* ignore */
  }
}

export type VerticalDirection = 'up' | 'down';
export type CaretPoint = { offset: number; x: number; y: number; affinity?: 'upstream' | 'downstream' };
export type CaretLine = { y: number; points: CaretPoint[] };
export type CaretSelection = { start: number; end: number; direction: 'forward' | 'backward' | 'none' };
const CARET_X_SNAP_TOLERANCE = 0.5;

export function groupCaretPointsByLine(points: readonly CaretPoint[], tolerance = 0.5): CaretLine[] {
  const lines: CaretLine[] = [];
  for (const point of [...points].sort((a, b) => a.offset - b.offset)) {
    const line = lines.at(-1);
    if (!line || Math.abs(line.y - point.y) > tolerance) lines.push({ y: point.y, points: [point] });
    else line.points.push(point);
  }
  return lines;
}

function caretLineIndex(lines: readonly CaretLine[], offset: number, preferred?: number): number {
  if (preferred != null && lines[preferred]?.points.some((point) => point.offset === offset)) return preferred;
  const downstream = lines.findIndex((line) =>
    line.points.some((point) => point.offset === offset && point.affinity !== 'upstream'),
  );
  return downstream >= 0 ? downstream : lines.findIndex((line) => line.points.some((point) => point.offset === offset));
}

function findAdjacentCaretPoint(
  lines: readonly CaretLine[],
  currentLineIndex: number,
  direction: VerticalDirection,
  goalX: number,
): { point: CaretPoint | null; lineIndex: number } {
  const lineIndex = currentLineIndex + (direction === 'up' ? -1 : 1);
  const targetLine = lines[lineIndex];
  if (!targetLine?.points.length) return { point: null, lineIndex: currentLineIndex };

  let closest = targetLine.points[0];
  let closestDistance = Math.abs(closest.x - goalX);
  for (const point of targetLine.points.slice(1)) {
    const distance = Math.abs(point.x - goalX);
    if (distance < closestDistance - CARET_X_SNAP_TOLERANCE) {
      closest = point;
      closestDistance = distance;
    }
  }
  return { point: closest, lineIndex };
}

export function findAdjacentVisualCaretOffset(
  lines: readonly CaretLine[],
  offset: number,
  direction: VerticalDirection,
  goalX: number,
  valueLength: number,
  preferredLineIndex?: number,
): number {
  const currentLine = caretLineIndex(lines, offset, preferredLineIndex);
  if (currentLine < 0) return direction === 'up' ? 0 : valueLength;
  const { point } = findAdjacentCaretPoint(lines, currentLine, direction, goalX);
  return point?.offset ?? (direction === 'up' ? 0 : valueLength);
}

export function selectionFocus(selection: CaretSelection): number {
  return selection.direction === 'backward' ? selection.start : selection.end;
}

export function moveCaretSelection(selection: CaretSelection, nextOffset: number, extend: boolean): CaretSelection {
  const next = Math.max(0, nextOffset);
  if (!extend) return { start: next, end: next, direction: 'none' };

  const anchor = selection.direction === 'backward' ? selection.end : selection.start;
  return {
    start: Math.min(anchor, next),
    end: Math.max(anchor, next),
    direction: next < anchor ? 'backward' : next > anchor ? 'forward' : 'none',
  };
}

export function moveCaretToDocumentBoundary(
  selection: CaretSelection,
  valueLength: number,
  direction: VerticalDirection,
  extend: boolean,
): CaretSelection {
  return moveCaretSelection(selection, direction === 'up' ? 0 : valueLength, extend);
}

export function moveCaretToLogicalBoundary(value: string, offset: number, direction: VerticalDirection): number {
  const caret = Math.max(0, Math.min(value.length, Math.trunc(offset)));
  const lineStart = value.lastIndexOf('\n', caret - 1) + 1;
  const lineEndIndex = value.indexOf('\n', caret);
  const lineEnd = lineEndIndex < 0 ? value.length : lineEndIndex;

  if (direction === 'up') {
    if (caret !== lineStart || lineStart === 0) return lineStart;
    return value.lastIndexOf('\n', lineStart - 2) + 1;
  }
  if (caret !== lineEnd || lineEnd === value.length) return lineEnd;
  const nextStart = lineEnd + 1;
  const nextEndIndex = value.indexOf('\n', nextStart);
  return nextEndIndex < 0 ? value.length : nextEndIndex;
}

export function moveLogicalCaret(
  value: string,
  offset: number,
  direction: VerticalDirection,
  goalColumn?: number | null,
): { offset: number; goalColumn: number } {
  const caret = Math.max(0, Math.min(value.length, Math.trunc(offset)));
  const lineStart = value.lastIndexOf('\n', caret - 1) + 1;
  const lineEndIndex = value.indexOf('\n', caret);
  const lineEnd = lineEndIndex < 0 ? value.length : lineEndIndex;
  const column = goalColumn == null ? caret - lineStart : Math.max(0, Math.trunc(goalColumn));

  if (direction === 'up') {
    if (lineStart === 0) return { offset: 0, goalColumn: column };
    const previousEnd = lineStart - 1;
    const previousStart = value.lastIndexOf('\n', previousEnd - 1) + 1;
    return { offset: Math.min(previousStart + column, previousEnd), goalColumn: column };
  }
  if (lineEnd === value.length) return { offset: value.length, goalColumn: column };
  const nextStart = lineEnd + 1;
  const nextEndIndex = value.indexOf('\n', nextStart);
  const nextEnd = nextEndIndex < 0 ? value.length : nextEndIndex;
  return { offset: Math.min(nextStart + column, nextEnd), goalColumn: column };
}

const SPECIAL: Record<string, string> = {
  Enter: 'Enter',
  Backspace: 'Backspace',
  Tab: 'Tab',
  Escape: 'Escape',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  Space: ' ',
};

const MIRROR_STYLE_PROPERTIES = [
  'box-sizing',
  'width',
  'height',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-top-style',
  'border-right-style',
  'border-bottom-style',
  'border-left-style',
  'font',
  'font-family',
  'font-size',
  'font-style',
  'font-variant',
  'font-weight',
  'font-stretch',
  'line-height',
  'letter-spacing',
  'tab-size',
  'text-align',
  'text-indent',
  'text-transform',
  'word-spacing',
  'direction',
  'overflow-x',
  'overflow-y',
] as const;

function measureTextareaCaretPoints(textarea: HTMLTextAreaElement): CaretPoint[] | null {
  if (typeof document === 'undefined' || !document.body) return null;

  const mirror = document.createElement('div');
  try {
    const computed = getComputedStyle(textarea);
    const number = (property: string) => Number.parseFloat(computed.getPropertyValue(property)) || 0;
    const paddingX = number('padding-left') + number('padding-right');
    const paddingY = number('padding-top') + number('padding-bottom');
    const borderX = number('border-left-width') + number('border-right-width');
    const borderY = number('border-top-width') + number('border-bottom-width');
    for (const property of MIRROR_STYLE_PROPERTIES) {
      mirror.style.setProperty(property, computed.getPropertyValue(property));
    }
    Object.assign(mirror.style, {
      position: 'fixed',
      top: '0',
      left: '-10000px',
      visibility: 'hidden',
      pointerEvents: 'none',
      zIndex: '-1',
      whiteSpace: 'pre-wrap',
      wordWrap: computed.getPropertyValue('word-wrap') || 'break-word',
      overflowWrap: computed.getPropertyValue('overflow-wrap') || 'break-word',
      overflowX: 'hidden',
      overflowY: 'hidden',
    });
    mirror.style.width = `${computed.boxSizing === 'border-box' ? textarea.clientWidth + borderX : textarea.clientWidth - paddingX}px`;
    mirror.style.height = `${computed.boxSizing === 'border-box' ? textarea.clientHeight + borderY : textarea.clientHeight - paddingY}px`;

    const prefix = document.createTextNode('');
    const marker = document.createElement('span');
    const prefixRange = document.createRange();
    mirror.append(prefix, marker);
    document.body.appendChild(mirror);
    const mirrorRect = mirror.getBoundingClientRect();
    const points: CaretPoint[] = [];

    for (let offset = 0; offset <= textarea.value.length; offset += 1) {
      prefix.data = textarea.value.slice(0, offset);
      marker.textContent = textarea.value.slice(offset) || '\u200b';
      mirror.scrollTop = textarea.scrollTop;
      mirror.scrollLeft = textarea.scrollLeft;
      const rect = marker.getClientRects()[0] ?? marker.getBoundingClientRect();
      if (offset > 0 && textarea.value[offset - 1] !== '\n' && textarea.value[offset - 1] !== '\r') {
        prefixRange.setStart(prefix, offset - 1);
        prefixRange.setEnd(prefix, offset);
        const previousRect = prefixRange.getClientRects().item(0);
        if (previousRect && previousRect.top < rect.top - 0.5) {
          points.push({
            offset,
            x: (computed.direction === 'rtl' ? previousRect.left : previousRect.right) - mirrorRect.left,
            y: previousRect.top - mirrorRect.top,
            affinity: 'upstream',
          });
        }
      }
      points.push({ offset, x: rect.left - mirrorRect.left, y: rect.top - mirrorRect.top, affinity: 'downstream' });
    }
    return points;
  } catch {
    return null;
  } finally {
    mirror.remove();
  }
}

function keepTextareaCaretVisible(textarea: HTMLTextAreaElement, point: CaretPoint | undefined) {
  if (!point) return;
  const style = getComputedStyle(textarea);
  const number = (value: string) => Number.parseFloat(value) || 0;
  const visibleTop = number(style.borderTopWidth) + number(style.paddingTop);
  const visibleBottom = number(style.borderTopWidth) + textarea.clientHeight - number(style.paddingBottom);
  if (point.y < visibleTop) textarea.scrollTop = Math.max(0, textarea.scrollTop - (visibleTop - point.y));
  else if (point.y > visibleBottom) textarea.scrollTop += point.y - visibleBottom;
}

type VerticalGoal = { kind: 'x'; value: number; lineIndex: number } | { kind: 'column'; value: number };

function readTextareaSelection(textarea: HTMLTextAreaElement): CaretSelection {
  return {
    start: textarea.selectionStart ?? 0,
    end: textarea.selectionEnd ?? 0,
    direction: textarea.selectionDirection as CaretSelection['direction'],
  };
}

function setTextareaSelection(textarea: HTMLTextAreaElement, selection: CaretSelection) {
  textarea.setSelectionRange(selection.start, selection.end, selection.direction);
}

function moveTextareaVertically(
  textarea: HTMLTextAreaElement,
  direction: VerticalDirection,
  extend: boolean,
  goal: VerticalGoal | null,
): VerticalGoal {
  const selection = readTextareaSelection(textarea);
  const focus = selectionFocus(selection);
  const points = goal?.kind === 'column' ? null : measureTextareaCaretPoints(textarea);

  if (points) {
    const lines = groupCaretPointsByLine(points);
    const currentLine = caretLineIndex(lines, focus, goal?.kind === 'x' ? goal.lineIndex : undefined);
    const currentPoint =
      lines[currentLine]?.points.find((point) => point.offset === focus && point.affinity !== 'upstream') ??
      lines[currentLine]?.points.find((point) => point.offset === focus);
    if (currentPoint) {
      const goalX = goal?.kind === 'x' ? goal.value : currentPoint.x;
      const next = findAdjacentCaretPoint(lines, currentLine, direction, goalX);
      const nextOffset = next.point?.offset ?? (direction === 'up' ? 0 : textarea.value.length);
      keepTextareaCaretVisible(textarea, next.point ?? points.find((point) => point.offset === nextOffset));
      setTextareaSelection(textarea, moveCaretSelection(selection, nextOffset, extend));
      return { kind: 'x', value: goalX, lineIndex: next.lineIndex };
    }
  }

  const fallback = moveLogicalCaret(textarea.value, focus, direction, goal?.kind === 'column' ? goal.value : null);
  setTextareaSelection(textarea, moveCaretSelection(selection, fallback.offset, extend));
  return { kind: 'column', value: fallback.goalColumn };
}

function moveTextareaToBoundary(
  textarea: HTMLTextAreaElement,
  direction: VerticalDirection,
  extend: boolean,
): void {
  const selection = readTextareaSelection(textarea);
  setTextareaSelection(textarea, moveCaretToDocumentBoundary(selection, textarea.value.length, direction, extend));
}

function moveTextareaToLogicalBoundary(
  textarea: HTMLTextAreaElement,
  direction: VerticalDirection,
  extend: boolean,
): void {
  const selection = readTextareaSelection(textarea);
  const next = moveCaretToLogicalBoundary(textarea.value, selectionFocus(selection), direction);
  setTextareaSelection(textarea, moveCaretSelection(selection, next, extend));
}

/**
 * Turns clicks on the 3D keys into typing inside the projected screen. Characters go to the focused text field
 * (or the one focused most recently); everything else is dispatched as a KeyboardEvent so the OS and apps react
 * exactly as they do to a physical keyboard. Modifiers are sticky: click shift, then a letter.
 */
export function createTyper(host: HTMLElement, onMods: (m: Mods) => void) {
  const mods: Mods = { shift: false, caps: false, meta: false, ctrl: false, alt: false };
  let verticalGoal: VerticalGoal | null = null;
  let last: HTMLElement | null = null;
  const onFocus = (e: FocusEvent) => {
    const t = e.target as Element;
    if (isEditable(t)) last = t;
  };
  const onPointerDown = () => {
    verticalGoal = null;
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.isTrusted || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) verticalGoal = null;
  };
  host.addEventListener('focusin', onFocus);
  host.addEventListener('pointerdown', onPointerDown, true);
  host.addEventListener('keydown', onKeyDown, true);

  const field = (): HTMLElement | null => {
    const a = document.activeElement;
    if (a && host.contains(a) && isEditable(a)) return a;
    if (last && last.isConnected && host.contains(last)) {
      last.focus({ preventScroll: true });
      return last;
    }
    return null;
  };
  const anchor = (): Element => {
    const a = document.activeElement;
    return a && host.contains(a) ? a : host;
  };
  const fire = (type: 'keydown' | 'keyup', target: Element, key: string, code: string) => {
    const ev = new KeyboardEvent(type, { key, code, bubbles: true, cancelable: true, shiftKey: mods.shift, metaKey: mods.meta, ctrlKey: mods.ctrl, altKey: mods.alt });
    target.dispatchEvent(ev);
    return ev;
  };
  const insert = (el: HTMLElement, text: string) => {
    if (isField(el)) replaceSelection(el, text, 'insertText');
    else document.execCommand('insertText', false, text);
  };
  const focusables = () =>
    [...host.querySelectorAll<HTMLElement>('input, textarea, button, a[href], [tabindex]:not([tabindex="-1"])')].filter(
      (el) => !el.hasAttribute('disabled') && el.tabIndex >= 0 && el.getClientRects().length > 0,
    );
  const clearOneShot = () => {
    if (!mods.shift && !mods.meta && !mods.ctrl && !mods.alt) return;
    mods.shift = mods.meta = mods.ctrl = mods.alt = false;
    onMods({ ...mods });
  };

  const keyFor = (k: Key3): string | null => {
    const base = k.code.replace(/(Left|Right)$/, '');
    if (SPECIAL[k.code]) return SPECIAL[k.code];
    if (k.k === 'c') return mods.shift !== mods.caps ? k.b! : k.b!.toLowerCase();
    if (k.k === '2') return mods.shift ? k.a! : k.b!;
    if (/^F\d+$/.test(k.code)) return k.code;
    return base === 'Power' || base === 'Fn' ? null : base;
  };

  return {
    mods: () => ({ ...mods }),
    press(k: Key3) {
      const base = k.code.replace(/(Left|Right)$/, '');
      if (base === 'Shift' || base === 'Meta' || base === 'Control' || base === 'Alt' || base === 'CapsLock') {
        verticalGoal = null;
        const name = base === 'Control' ? 'ctrl' : base === 'Alt' ? 'alt' : base === 'CapsLock' ? 'caps' : (base.toLowerCase() as 'shift' | 'meta');
        mods[name] = !mods[name];
        onMods({ ...mods });
        return;
      }
      const key = keyFor(k);
      if (key === null) {
        verticalGoal = null;
        return;
      }
      const chord = mods.meta || mods.ctrl || mods.alt;
      const el = field();
      const target = el ?? anchor();

      if (el instanceof HTMLTextAreaElement && (key === 'ArrowUp' || key === 'ArrowDown') && chord) {
        const direction = key === 'ArrowUp' ? 'up' : 'down';
        const ev = fire('keydown', target, key, k.code);
        if (!ev.defaultPrevented) {
          if (mods.meta || mods.ctrl) moveTextareaToBoundary(el, direction, mods.shift);
          else if (mods.alt) moveTextareaToLogicalBoundary(el, direction, mods.shift);
        }
        fire('keyup', target, key, k.code);
        verticalGoal = null;
        clearOneShot();
        return;
      }

      if (chord) {
        // Shortcuts such as ⌘K are handled by the OS's own keydown listeners.
        fire('keydown', target, key.length === 1 ? key.toLowerCase() : key, k.code);
        fire('keyup', target, key, k.code);
        clearOneShot();
        return;
      }

      if (key.length === 1) {
        if (el) {
          const ev = fire('keydown', el, key, k.code);
          if (!ev.defaultPrevented) insert(el, key);
          fire('keyup', el, key, k.code);
        }
        clearOneShot();
        return;
      }

      const ev = fire('keydown', target, key, k.code);
      if (!ev.defaultPrevented && el) {
        if (key === 'Enter') {
          if (el instanceof HTMLTextAreaElement) replaceSelection(el, '\n', 'insertLineBreak');
          else if (el instanceof HTMLInputElement && el.form) el.form.requestSubmit();
        } else if (key === 'Backspace') {
          if (isField(el)) replaceSelection(el, '', 'deleteContentBackward');
          else document.execCommand('delete');
        } else if (key === 'ArrowLeft' || key === 'ArrowRight') {
          if (isField(el)) moveCaret(el, key === 'ArrowLeft' ? -1 : 1, mods.shift);
        } else if (key === 'ArrowUp' || key === 'ArrowDown') {
          if (el instanceof HTMLTextAreaElement) {
            verticalGoal = moveTextareaVertically(el, key === 'ArrowUp' ? 'up' : 'down', mods.shift, verticalGoal);
          } else if (isField(el)) moveCaret(el, key === 'ArrowUp' ? -el.value.length : el.value.length, mods.shift);
        }
      }
      if (key === 'Tab' && !ev.defaultPrevented) {
        const list = focusables();
        const i = list.indexOf(document.activeElement as HTMLElement);
        const next = list[(i + (mods.shift ? -1 : 1) + list.length) % list.length];
        next?.focus({ preventScroll: true });
      }
      fire('keyup', target, key, k.code);
      clearOneShot();
    },
    dispose() {
      host.removeEventListener('focusin', onFocus);
      host.removeEventListener('pointerdown', onPointerDown, true);
      host.removeEventListener('keydown', onKeyDown, true);
    },
  };
}
