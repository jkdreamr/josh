// Builds a puzzle off the main thread. Message in: a Level. Message out: a Puzzle.
import { generate, type Level } from './logic';

const scope = self as unknown as { onmessage: ((e: MessageEvent<Level>) => void) | null; postMessage(data: unknown): void };
scope.onmessage = (e) => scope.postMessage(generate(e.data));
