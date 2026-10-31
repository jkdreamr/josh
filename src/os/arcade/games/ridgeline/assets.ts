// The real models (soldier, guns, vehicles, cover and clutter), meshopt compressed glTF in ./models. They load in the
// background while the map generates, once per page, and are shared by every view. Anything that fails to load just
// leaves its procedural stand-in, so the game always starts.
import { useEffect, useState } from 'react';
import type * as T from 'three';
import ak from './models/ak-lite.glb?url';
import awpLite from './models/awp-lite.glb?url';
import awp from './models/awp.glb?url';
import barricade from './models/barricade.glb?url';
import berettaLite from './models/beretta-lite.glb?url';
import btr from './models/btr.glb?url';
import cup from './models/cup.glb?url';
import deagleLite from './models/deagle-lite.glb?url';
import deagle from './models/deagle.glb?url';
import dumpsters from './models/dumpsters.glb?url';
import fenceBase from './models/fence-base.glb?url';
import fenceHalf from './models/fence-half.glb?url';
import fenceWheel from './models/fence-wheel.glb?url';
import fenceWood from './models/fence-wood.glb?url';
import gas from './models/gas.glb?url';
import helmet from './models/helmet.glb?url';
import jerry from './models/jerry.glb?url';
import m4Lite from './models/m4-lite.glb?url';
import m4 from './models/m4.glb?url';
import m67 from './models/m67.glb?url';
import mp5Lite from './models/mp5-lite.glb?url';
import mp5 from './models/mp5.glb?url';
import pan from './models/pan.glb?url';
import pile from './models/pile.glb?url';
import propane from './models/propane.glb?url';
import rgd5 from './models/rgd5.glb?url';
import shield from './models/shield.glb?url';
import soldier from './models/soldier.glb?url';
import ural from './models/ural.glb?url';
import wire from './models/wire.glb?url';
import xdLite from './models/xd-lite.glb?url';
import xd from './models/xd.glb?url';

const URLS = {
  soldier,
  xd,
  'xd-lite': xdLite,
  'beretta-lite': berettaLite,
  deagle,
  'deagle-lite': deagleLite,
  mp5,
  'mp5-lite': mp5Lite,
  m4,
  'm4-lite': m4Lite,
  'ak-lite': ak,
  awp,
  'awp-lite': awpLite,
  m67,
  rgd5,
  ural,
  btr,
  barricade,
  pile,
  wire,
  dumpsters,
  'fence-base': fenceBase,
  'fence-half': fenceHalf,
  'fence-wood': fenceWood,
  'fence-wheel': fenceWheel,
  jerry,
  gas,
  propane,
  helmet,
  shield,
  cup,
  pan,
} as const;

export type AssetKey = keyof typeof URLS;
/** Each loaded model's scene (a model that failed is missing). */
export type Assets = Partial<Record<AssetKey, T.Object3D>>;

let pending: Promise<Assets> | null = null;
let loaded: Assets | null = null;

/** Starts loading every model (once per page); resolves when all have arrived or failed. */
export function loadAssets(): Promise<Assets> {
  pending ??= (async () => {
    const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([import('three/examples/jsm/loaders/GLTFLoader.js'), import('three/examples/jsm/libs/meshopt_decoder.module.js')]);
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const out: Assets = {};
    await Promise.all(
      (Object.entries(URLS) as [AssetKey, string][]).map(([key, url]) =>
        loader.loadAsync(url).then(
          (g) => {
            out[key] = g.scene;
          },
          () => {
            if (import.meta.env.DEV) console.warn('[ridgeline] model failed to load', key);
          },
        ),
      ),
    );
    loaded = out;
    return out;
  })().catch(() => {
    // the loader itself failed (offline, blocked chunk): play with the procedural models
    pending = null;
    loaded = {};
    return {};
  });
  return pending;
}

/** The loaded models, or null while they're on the way. */
export function useAssets(): Assets | null {
  const [assets, setAssets] = useState<Assets | null>(loaded);
  useEffect(() => {
    if (assets) return;
    let alive = true;
    loadAssets().then((a) => alive && setAssets(a));
    return () => {
      alive = false;
    };
  }, [assets]);
  return assets;
}
