/**
 * A pointer click on a card button counts only when the press started on that button. Holding Gas through the
 * finish and lifting on the result card would otherwise click whatever button sits under the finger.
 * Keyboard activation always counts.
 */
export function strayCardClick(click: { detail: number; pointerType?: string }, button: { contains(n: never): boolean } | null, pressedOn: unknown): boolean {
  return !!button && fromPointer(click) && !(pressedOn && button.contains(pressedOn as never));
}

/** Chrome's touch click is a PointerEvent with detail 0, Safari's a MouseEvent with detail 1; Enter or Space give neither. */
const fromPointer = (click: { detail: number; pointerType?: string }) => !!click.pointerType || click.detail > 0;
