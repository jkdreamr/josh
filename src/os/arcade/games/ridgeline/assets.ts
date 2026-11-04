// The real models (soldier, guns, vehicles, cover, clutter, rocks, plants and loot), meshopt compressed glTF in ./models,
// and the photographed textures (ground, walls, roofs, floors, rusted steel and burlap) in ./textures. They load in the
// background while the map generates, once per page, and are shared by every view. Anything that fails to load just
// leaves its procedural stand-in, so the game always starts. A map's sky photo is fetched on its own when a view asks for it.
import { useEffect, useState } from 'react';
import type * as T from 'three';
import type { MapId } from './maps.ts';
import ak from './models/ak-lite.glb?url';
import ammoCan from './models/ammo-can.glb?url';
import ammoCrate from './models/ammo-crate.glb?url';
import awpLite from './models/awp-lite.glb?url';
import awp from './models/awp.glb?url';
import barrel from './models/barrel.glb?url';
import barricade from './models/barricade.glb?url';
import berettaLite from './models/beretta-lite.glb?url';
import boulder from './models/boulder.glb?url';
import branches from './models/branches.glb?url';
import btr from './models/btr.glb?url';
import crateMil from './models/crate-mil.glb?url';
import crateWood from './models/crate-wood.glb?url';
import cup from './models/cup.glb?url';
import deagleLite from './models/deagle-lite.glb?url';
import deagle from './models/deagle.glb?url';
import dumpsters from './models/dumpsters.glb?url';
import fern from './models/fern.glb?url';
import fenceBase from './models/fence-base.glb?url';
import fenceHalf from './models/fence-half.glb?url';
import fenceWheel from './models/fence-wheel.glb?url';
import fenceWood from './models/fence-wood.glb?url';
import gas from './models/gas.glb?url';
import generator from './models/generator.glb?url';
import helmet from './models/helmet.glb?url';
import jerry from './models/jerry.glb?url';
import jersey from './models/jersey.glb?url';
import log from './models/log.glb?url';
import m4Lite from './models/m4-lite.glb?url';
import m4 from './models/m4.glb?url';
import m67 from './models/m67.glb?url';
import medkit from './models/medkit.glb?url';
import mp5Lite from './models/mp5-lite.glb?url';
import mp5 from './models/mp5.glb?url';
import outfitLod from './models/outfit-lod.glb?url';
import outfit from './models/outfit.glb?url';
import pan from './models/pan.glb?url';
import pile from './models/pile.glb?url';
import propane from './models/propane.glb?url';
import rgd5 from './models/rgd5.glb?url';
import rock from './models/rock.glb?url';
import shield from './models/shield.glb?url';
import shrub2 from './models/shrub2.glb?url';
import shrub from './models/shrub.glb?url';
import soldierLod from './models/soldier-lod.glb?url';
import soldier from './models/soldier.glb?url';
import stump from './models/stump.glb?url';
import stump2 from './models/stump2.glb?url';
import tape from './models/tape.glb?url';
import toolbox from './models/toolbox.glb?url';
import tyre from './models/tyre.glb?url';
import ural from './models/ural.glb?url';
import vmM4 from './models/vm-m4.glb?url';
import vmMk23 from './models/vm-mk23.glb?url';
import vmVector from './models/vm-vector.glb?url';
import wire from './models/wire.glb?url';
import xdLite from './models/xd-lite.glb?url';
import xd from './models/xd.glb?url';
import burlapN from './textures/burlap-n.webp?url';
import burlap from './textures/burlap.webp?url';
import concreteN from './textures/concrete-n.webp?url';
import concrete from './textures/concrete.webp?url';
import floorN from './textures/floor-n.webp?url';
import floor from './textures/floor.webp?url';
import groundAlbedo from './textures/ground-albedo.webp?url';
import groundNormal from './textures/ground-normal.webp?url';
import metalN from './textures/metal-n.webp?url';
import metal from './textures/metal.webp?url';
import plasterN from './textures/plaster-n.webp?url';
import plaster from './textures/plaster.webp?url';
import roofN from './textures/roof-n.webp?url';
import roof from './textures/roof.webp?url';
import rustN from './textures/rust-n.webp?url';
import rust from './textures/rust.webp?url';
import skyFrost2 from './textures/sky-frost-2k.webp?url';
import skyFrost4 from './textures/sky-frost-4k.webp?url';
import skyIsles2 from './textures/sky-isles-2k.webp?url';
import skyIsles4 from './textures/sky-isles-4k.webp?url';
import skyMesa2 from './textures/sky-mesa-2k.webp?url';
import skyMesa4 from './textures/sky-mesa-4k.webp?url';
import skyVale2 from './textures/sky-vale-2k.webp?url';
import skyVale4 from './textures/sky-vale-4k.webp?url';
import woodN from './textures/wood-n.webp?url';
import wood from './textures/wood.webp?url';

const URLS = {
  // the project owner's soldier outfit (with its helmet), near and far
  outfit,
  'outfit-lod': outfitLod,
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
  'vm-m4': vmM4,
  'vm-vector': vmVector,
  'vm-mk23': vmMk23,
  // Poly Haven props, rocks and loot (CC0)
  jersey,
  'crate-wood': crateWood,
  'crate-mil': crateMil,
  'ammo-crate': ammoCrate,
  barrel,
  tyre,
  generator,
  toolbox,
  'ammo-can': ammoCan,
  medkit,
  boulder,
  rock,
  stump,
  stump2,
  log,
  // Poly Haven plants and loot (CC0)
  shrub,
  shrub2,
  fern,
  branches,
  tape,
} as const;

/** Models fetched only when another failed: the old soldier, if the outfit doesn't load. */
const FALLBACK = {
  soldier: ['outfit', soldier],
  'soldier-lod': ['outfit', soldierLod],
} as const;

/** Photographed textures (Poly Haven, CC0): the ground's layer strips, and a color and a normal map per finish (walls,
 * planks, roof tiles, sheet metal, concrete, floor boards, rusted paint and burlap). */
const IMAGES = {
  'ground-albedo': groundAlbedo,
  'ground-normal': groundNormal,
  plaster,
  'plaster-n': plasterN,
  wood,
  'wood-n': woodN,
  roof,
  'roof-n': roofN,
  metal,
  'metal-n': metalN,
  concrete,
  'concrete-n': concreteN,
  floor,
  'floor-n': floorN,
  rust,
  'rust-n': rustN,
  burlap,
  'burlap-n': burlapN,
} as const;

/** Each map's sky photo, small and large. */
const SKIES: Record<MapId, [string, string]> = { vale: [skyVale2, skyVale4], mesa: [skyMesa2, skyMesa4], frost: [skyFrost2, skyFrost4], isles: [skyIsles2, skyIsles4] };

export type AssetKey = keyof typeof URLS | keyof typeof FALLBACK;
export type ImageKey = keyof typeof IMAGES;
/** Each loaded model's scene, its animation clips in `animations` (a model that failed is missing), and the images. */
export type Assets = Partial<Record<AssetKey, T.Object3D>> & { images?: Partial<Record<ImageKey, ImageBitmap>> };

/** An image decoded as stored: no color conversion and no premultiplied alpha (the alpha carries roughness). */
async function bitmap(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status}`);
  return createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
}

const skies = new Map<string, Promise<ImageBitmap | null>>();
/** A map's sky photo (the large one for the higher tiers), or null when it can't be had. Fetched once per page. */
export function skyImage(id: MapId, large: boolean): Promise<ImageBitmap | null> {
  const url = SKIES[id][large ? 1 : 0];
  let p = skies.get(url);
  if (!p) {
    p = typeof createImageBitmap === 'function' ? bitmap(url).catch(() => null) : Promise.resolve(null);
    skies.set(url, p);
  }
  return p;
}

let pending: Promise<Assets> | null = null;
let loaded: Assets | null = null;

/** Starts loading every model (once per page); resolves when all have arrived or failed. */
export function loadAssets(): Promise<Assets> {
  pending ??= (async () => {
    const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([import('three/examples/jsm/loaders/GLTFLoader.js'), import('three/examples/jsm/libs/meshopt_decoder.module.js')]);
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const out: Assets = {};
    const images: NonNullable<Assets['images']> = {};
    out.images = images;
    const pics = typeof createImageBitmap === 'function' ? (Object.entries(IMAGES) as [ImageKey, string][]) : [];
    const model = (key: AssetKey, url: string) =>
      loader.loadAsync(url).then(
        (g) => {
          // the clips ride along on the scene (the animated first person arms play them)
          g.scene.animations = g.animations;
          out[key] = g.scene;
        },
        () => {
          if (import.meta.env.DEV) console.warn('[ridgeline] model failed to load', key);
        },
      );
    await Promise.all([
      ...pics.map(([key, url]) =>
        bitmap(url).then(
          (b) => {
            images[key] = b;
          },
          () => {
            if (import.meta.env.DEV) console.warn('[ridgeline] image failed to load', key);
          },
        ),
      ),
      ...(Object.entries(URLS) as [AssetKey, string][]).map(([key, url]) => model(key, url)),
    ]);
    await Promise.all((Object.entries(FALLBACK) as [AssetKey, readonly [AssetKey, string]][]).filter(([, [instead]]) => !out[instead]).map(([key, [, url]]) => model(key, url)));
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
