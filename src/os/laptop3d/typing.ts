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

/**
 * Turns clicks on the 3D keys into typing inside the projected screen. Characters go to the focused text field
 * (or the one focused most recently); everything else is dispatched as a KeyboardEvent so the OS and apps react
 * exactly as they do to a physical keyboard. Modifiers are sticky: click shift, then a letter.
 */
export function createTyper(host: HTMLElement, onMods: (m: Mods) => void) {
  const mods: Mods = { shift: false, caps: false, meta: false, ctrl: false, alt: false };
  let last: HTMLElement | null = null;
  const onFocus = (e: FocusEvent) => {
    const t = e.target as Element;
    if (isEditable(t)) last = t;
  };
  host.addEventListener('focusin', onFocus);

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
        const name = base === 'Control' ? 'ctrl' : base === 'Alt' ? 'alt' : base === 'CapsLock' ? 'caps' : (base.toLowerCase() as 'shift' | 'meta');
        mods[name] = !mods[name];
        onMods({ ...mods });
        return;
      }
      const key = keyFor(k);
      if (key === null) return;
      const chord = mods.meta || mods.ctrl || mods.alt;
      const el = field();
      const target = el ?? anchor();

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
          if (isField(el) && !(el instanceof HTMLTextAreaElement)) moveCaret(el, key === 'ArrowUp' ? -el.value.length : el.value.length, mods.shift);
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
    },
  };
}
