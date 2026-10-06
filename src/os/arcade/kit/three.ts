import { useEffect, useState } from 'react';

type Three = typeof import('three');
let pending: Promise<Three> | null = null;

/** Lazily loads three.js once; every 3D game shares the same chunk. */
export function loadThree(): Promise<Three> {
  pending ??= (import('./three-lib') as unknown as Promise<Three>).catch((e) => {
    pending = null;
    throw e;
  });
  return pending;
}

/** THREE once loaded (null while loading). A failed download is rethrown to the nearest error boundary. */
export function useThree(): Three | null {
  const [three, setThree] = useState<Three | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    let alive = true;
    loadThree().then(
      (t) => alive && setThree(t),
      (e) => alive && setError(e ?? new Error('three failed to load')),
    );
    return () => {
      alive = false;
    };
  }, []);
  if (error) throw error;
  return three;
}
