import { useEffect, useState, useSyncExternalStore } from 'react';
import type * as T from 'three';
import { loadThree } from '../../kit';
import femaleUrl from './models/female.glb?url';
import maleUrl from './models/male.glb?url';

type Three = typeof import('three');
type SceneModule = typeof import('./scene.ts');
export type SoccerModel = { scene: T.Object3D; clone: (source: T.Object3D) => T.Object3D };
export type SoccerStadium = { THREE: Three; createScene: SceneModule['createScene'] };
export type SoccerLoad = { progress: number; ready: boolean };
type SoccerView = NonNullable<ReturnType<SceneModule['createScene']>>;

/** Content-hashed by the build, so they are cached like any other /_astro file. */
export const MODEL_URLS = { female: femaleUrl, male: maleUrl } as const;
/** Rough compressed sizes, for progress when a response has no usable Content-Length. */
const MODEL_BYTES = 400_000;
const WEIGHT = { three: 0.3, scene: 0.1, models: 0.45, shaders: 0.15 };

const parts = { three: 0, scene: 0, shaders: 0 };
const modelParts = new Map<string, number>(Object.values(MODEL_URLS).map((url) => [url, 0]));
let snapshot: SoccerLoad = { progress: 0, ready: false };
const listeners = new Set<() => void>();

function publish() {
  let models = 0;
  for (const value of modelParts.values()) models += value / modelParts.size;
  const progress = Math.min(1, parts.three * WEIGHT.three + parts.scene * WEIGHT.scene + models * WEIGHT.models + parts.shaders * WEIGHT.shaders);
  const ready = parts.shaders === 1;
  if (Math.abs(progress - snapshot.progress) < 0.005 && ready === snapshot.ready) return;
  snapshot = { progress, ready };
  if (import.meta.env.DEV && ready) console.info('[soccer] stadium ready', Math.round(performance.now()), 'ms');
  for (const listener of listeners) listener();
}

/** Loading progress of three.js, the 3D scene code, the player models and the shader warm-up (0 to 1). */
export function useSoccerLoad(): SoccerLoad {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    () => snapshot,
    () => snapshot,
  );
}

/** Called once the scene's shaders are compiled, so the first rendered frame doesn't stall. */
export function markShadersReady() {
  parts.shaders = 1;
  publish();
}

let libs: Promise<{ GLTFLoader: typeof import('three/examples/jsm/loaders/GLTFLoader.js').GLTFLoader; clone: SoccerModel['clone']; decoder: typeof import('three/examples/jsm/libs/meshopt_decoder.module.js').MeshoptDecoder }> | null = null;
const models = new Map<string, Promise<SoccerModel>>();

/** A parsed player model, fetched once and shared by every scene (the GLBs are meshopt-compressed). */
export function loadSoccerModel(url: string): Promise<SoccerModel> {
  let pending = models.get(url);
  if (pending) return pending;
  libs ??= Promise.all([
    import('three/examples/jsm/loaders/GLTFLoader.js'),
    import('three/examples/jsm/utils/SkeletonUtils.js'),
    import('three/examples/jsm/libs/meshopt_decoder.module.js'),
  ]).then(([loader, skeleton, meshopt]) => ({ GLTFLoader: loader.GLTFLoader, clone: skeleton.clone, decoder: meshopt.MeshoptDecoder }));
  const done = () => { modelParts.set(url, 1); publish(); };
  pending = libs.then(async ({ GLTFLoader, clone, decoder }) => {
    const loader = new GLTFLoader().setMeshoptDecoder(decoder);
    const gltf = await loader.loadAsync(url, (event) => {
      const total = event.lengthComputable && event.total > 0 ? event.total : MODEL_BYTES;
      modelParts.set(url, Math.min(0.95, event.loaded / total));
      publish();
    });
    done();
    return { scene: gltf.scene, clone };
  });
  pending.catch(() => {
    // Players fall back to the procedural figure; a later scene may try again.
    models.delete(url);
    libs = null;
    done();
  });
  models.set(url, pending);
  return pending;
}

let stadium: Promise<SoccerStadium> | null = null;

const idle = () => new Promise<void>((resolve) => {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(() => resolve(), { timeout: 600 });
  else setTimeout(resolve, 50);
});

/**
 * Starts loading everything the 3D match needs, in the background: three.js, the scene code and both player models.
 * Resolves once they're in (a model that fails just leaves its procedural stand-in) and the page has a moment to
 * spare, so building the scene never holds up the lobby.
 */
export function preloadSoccer(): Promise<SoccerStadium> {
  stadium ??= (async () => {
    const urls = Object.values(MODEL_URLS);
    const three = loadThree().then((t) => { parts.three = 1; publish(); return t; });
    const scene = import('./scene.ts').then((m) => { parts.scene = 1; publish(); return m; });
    const assets = Promise.allSettled(urls.map(loadSoccerModel));
    const [THREE, { createScene }] = await Promise.all([three, scene]);
    await assets;
    await idle();
    return { THREE, createScene };
  })().catch((error) => {
    stadium = null;
    throw error;
  });
  return stadium;
}

/** The loaded three.js and scene factory (null while loading). A failed download is rethrown to the nearest error boundary. */
export function useSoccerStadium(): SoccerStadium | null {
  const [value, setValue] = useState<SoccerStadium | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    let alive = true;
    preloadSoccer().then(
      (v) => alive && setValue(v),
      (e) => alive && setError(e ?? new Error('soccer failed to load')),
    );
    return () => { alive = false; };
  }, []);
  if (error) throw error;
  return value;
}

const PARK_MS = 15_000;
let parked: { view: SoccerView; lite: boolean; timer: ReturnType<typeof setTimeout> } | null = null;

/**
 * Keeps an unmounted match's scene for a moment. The lobby's scene is remounted at kickoff, and building and compiling
 * a fresh one there would stall the first frames of the match.
 */
export function parkSoccerView(view: SoccerView, lite: boolean) {
  if (parked) {
    clearTimeout(parked.timer);
    parked.view.dispose();
  }
  const timer = setTimeout(() => {
    if (parked?.view !== view) return;
    parked = null;
    view.dispose();
  }, PARK_MS);
  parked = { view, lite, timer };
}

/** The parked scene, if it was built for the same kind of device. */
export function takeSoccerView(lite: boolean): SoccerView | null {
  if (!parked || parked.lite !== lite) return null;
  const { view, timer } = parked;
  clearTimeout(timer);
  parked = null;
  return view;
}
