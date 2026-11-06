# Ridgeline model credits

## The soldier outfit (provided by the project owner)

`outfit.glb` and `outfit-lod.glb` are the Soldier Outfit (v1) and its helmet (Soldier Helmet
Outfit v1), with their texture sets, provided by the project owner for this game. They are not under the licenses
below. For the game the outfit and the helmet were baked into one file: posed as bound, turned to face the game's
front and scaled to its soldier, the sniper rifle slung on the back left out, the fingers curled round a grip, the skin
weights of the outfit's skeleton summed onto the game's twenty bones, and a lofted head in a knit balaclava with
wraparound glasses added (the outfit is made for a separate head). The seven texture sets and the helmet's set (its
2K maps) were packed into one atlas: base color (its alpha says how much a kit may recolor each texel), normal (turned
from DirectX to glTF's convention) and AO/roughness/metal, WebP at 2048 (color) and 1024 (the rest). The meshes were
welded, simplified with meshoptimizer (the body to 15,000 triangles and the helmet to 3,000; the far copy to 2,600 and
350, with no textures of its own), quantized and meshopt compressed with glTF Transform. The outfit's emissive maps
(black) and the sniper rifle's textures are not used.

## Sketchfab models

Every model in the first table was downloaded from Sketchfab and then reduced for the game: stray parts removed,
re-oriented and scaled to meters, simplified, textures resized and re-encoded as WebP, and the files meshopt compressed. The soldier
was also skinned to the game's skeleton. The `-lite` files are low detail copies with the textures baked into vertex
colors, for guns held by other soldiers. The `vm-` files are animated first person arms with a gun: kept with their
skins and animations (each clip moved to start at zero and resampled), cameras dropped, materials converted to
metal/rough.

All of those are licensed under Creative Commons Attribution 4.0 (CC BY 4.0, <http://creativecommons.org/licenses/by/4.0/>),
except the AWP, which is Creative Commons Attribution-NonCommercial 4.0 (CC BY-NC 4.0,
<http://creativecommons.org/licenses/by-nc/4.0/>) and may only be used non-commercially, and the Mark 23 arms
(`vm-mk23.glb`), which are under the Sketchfab Standard license (<https://sketchfab.com/licenses>).

| File | Model | Author | License | Source |
| --- | --- | --- | --- | --- |
| `soldier.glb`, `soldier-lod.glb` (the stand-in, fetched only when `outfit.glb` fails to load) | Modern Tactical Soldier | ItsKrish7 | CC BY 4.0 | <https://sketchfab.com/3d-models/modern-tactical-soldier-ab88f581b1ba46f2a0bd33de06040533> |
| `m4.glb`, `m4-lite.glb` | Modern Warefare M4A1 | Nneako | CC BY 4.0 | <https://sketchfab.com/3d-models/modern-warefare-m4a1-167dd49ffff14d41ab11b6417f128bf1> |
| `ak-lite.glb` | AK-47 Assault rifle | Nneako | CC BY 4.0 | <https://sketchfab.com/3d-models/ak-47-assault-rifle-948f6b1beeb749759b91bf1d5a6db481> |
| `mp5.glb`, `mp5-lite.glb` | MP5 Submachine Gun | Rotuma | CC BY 4.0 | <https://sketchfab.com/3d-models/mp5-submachine-gun-a73b61932a0e4eecb5db5c63c158aa24> |
| `awp.glb`, `awp-lite.glb` | Sniper Rifle - AWP | MKoegler3D | CC BY-NC 4.0 | <https://sketchfab.com/3d-models/sniper-rifle-awp-8fc399244b9d49bfb6841d477f968c0e> |
| `deagle.glb`, `deagle-lite.glb` | Desert Eagle | ELIZION | CC BY 4.0 | <https://sketchfab.com/3d-models/desert-eagle-cabde59f5cf24effaf80536e35d04e95> |
| `xd.glb`, `xd-lite.glb` | Springfield XD-MOD2 - Tan | Orshia 3D | CC BY 4.0 | <https://sketchfab.com/3d-models/springfield-xd-mod2-tan-0a775c7a54b7484a8d5be57d986cf00d> |
| `beretta-lite.glb` | Beretta Px4 Storm Sub-Compact, Free Lowpoly | Vlasov Daniil | CC BY 4.0 | <https://sketchfab.com/3d-models/beretta-px4-storm-sub-compact-free-lowpoly-55958f5ee3674f5fbb1a5cb93ca84e44> |
| `m67.glb` | M67 Grenade | Nneako | CC BY 4.0 | <https://sketchfab.com/3d-models/m67-grenade-36a23ce20b8d47beb1fa26cfe9b0a129> |
| `rgd5.glb` | Grenade RGD-5 | _Alexandr | CC BY 4.0 | <https://sketchfab.com/3d-models/grenade-rgd-5-886637c9482b4cc4960d0112684baac6> |
| `ural.glb` | Ural 4320 | Brout | CC BY 4.0 | <https://sketchfab.com/3d-models/ural-4320-f953c51a5dbc4a15949f4dcc0905c4e8> |
| `btr.glb` | Abandoned Soviet BTR - 80 | GameDev Nick | CC BY 4.0 | <https://sketchfab.com/3d-models/abandoned-soviet-btr-80-32145d6303e5487e9d92097b9845ef02> |
| `barricade.glb` | Low Poly Barricade Game Ready II | Arthur.Zim | CC BY 4.0 | <https://sketchfab.com/3d-models/low-poly-barricade-game-ready-ii-89a79068de614a478aeaea49371cfef8> |
| `pile.glb` | Crate Pile | Blender3D | CC BY 4.0 | <https://sketchfab.com/3d-models/crate-pile-bbeaa4b040c34a2f80fa8127783f2ff4> |
| `wire.glb` | Barrier _ Wooden_ Barbed_ Wire Protection_13_MB | Mehdi Shahsavan | CC BY 4.0 | <https://sketchfab.com/3d-models/barrier---wooden--barbed--wire-protection-13-mb-a99f8daa113a4439b24869e41643ecb4> |
| `dumpsters.glb` | Trash can | bazz4r | CC BY 4.0 | <https://sketchfab.com/3d-models/trash-can-3836ff67877248c2a820e6a969984aac> |
| `fence-*.glb` | Fences, Concretes, Metal, Desert, Old, Pack | Erroratten | CC BY 4.0 | <https://sketchfab.com/3d-models/fences-concretes-metal-desert-old-pack-0cbf546419cf499cbabfee3af0916215> |
| `jerry.glb` | Game Ready Jerry Cans | Liam3D | CC BY 4.0 | <https://sketchfab.com/3d-models/game-ready-jerry-cans-01fea903b3464194a4d0eec7d9a1a5d1> |
| `gas.glb` | Gas Bottles Set | Gamefruit | CC BY 4.0 | <https://sketchfab.com/3d-models/gas-bottles-set-d671d93577b546b3bc8eda586ee75b31> |
| `propane.glb` | Propane Tank | Oliver Triplett | CC BY 4.0 | <https://sketchfab.com/3d-models/propane-tank-d0fd95adb402424c84ef6f715d529363> |
| `helmet.glb` | tactical helmet | Sergeydesign09 | CC BY 4.0 | <https://sketchfab.com/3d-models/tactical-helmet-9a0f198cc8864035800eafb4a10624f2> |
| `shield.glb` | ballistic shield | sanyaork | CC BY 4.0 | <https://sketchfab.com/3d-models/ballistic-shield-142c4ec45e3b403d8d0104e3150efb14> |
| `cup.glb` | WW2 Soviet Old Metall Cup FREE | Kozlov Maksim | CC BY 4.0 | <https://sketchfab.com/3d-models/ww2-soviet-old-metall-cup-free-cac613a4f08142f3a541ec6f21946c11> |
| `pan.glb` | Old Frying Pan | GameDev Nick | CC BY 4.0 | <https://sketchfab.com/3d-models/old-frying-pan-dbac7c1a1a5f4b79a1cb8bdacdd42aff> |
| `vm-m4.glb` | M4 - FPS Weapon Animations Pack v.1 | BarcodeGames | CC BY 4.0 | <https://sketchfab.com/3d-models/m4-fps-weapon-animations-pack-v1-662fc74dda2646cfb48fc610705768ef> |
| `vm-vector.glb` | Kriss Vector Animated (FREE) | BarcodeGame | CC BY 4.0 | <https://sketchfab.com/3d-models/kriss-vector-animated-free-54530c888cfd4ae7aab3c3852b229c7e> |
| `vm-mk23.glb` | Mark 23 Animated (FREE) | BarcodeGames | Sketchfab Standard | <https://sketchfab.com/3d-models/mark-23-animated-free-7abebe340aca4f46b36368417b3ca920> |

## Poly Haven models (CC0)

These come from [Poly Haven](https://polyhaven.com) and are dedicated to the public domain under Creative Commons Zero
(CC0 1.0, <https://creativecommons.org/publicdomain/zero/1.0/>, <https://polyhaven.com/license>): no attribution is
required, the authors are listed as a courtesy. They were taken as 1K glTF bundles from the copies in
[m4tthewdavis/fallout-minnesota](https://github.com/m4tthewdavis/fallout-minnesota), whose
[`assets/CREDITS.md`](https://github.com/m4tthewdavis/fallout-minnesota/blob/main/assets/CREDITS.md) lists each one
with its Poly Haven page, author and the CC0 license. For the game they were laid out (the crate stacks are four long
crates, or eight closed ammo crates, fitted to the 1.1 m crate boxes; the barrier is fitted to the barricade's collider),
grounded and centered, simplified with meshoptimizer, their textures resized to 512 and re-encoded as WebP, and the
files meshopt compressed.

| File | Model | Author | License | Source | Mirror |
| --- | --- | --- | --- | --- | --- |
| `jersey.glb` | Concrete Road Barrier | Amal Kumar | CC0 1.0 | <https://polyhaven.com/a/concrete_road_barrier> | <https://github.com/m4tthewdavis/fallout-minnesota/tree/main/assets/models/concrete_road_barrier> |
| `crate-wood.glb` | Wooden Crate 02 | James Ray Cock, Jurita Burger | CC0 1.0 | <https://polyhaven.com/a/wooden_crate_02> | <https://github.com/m4tthewdavis/fallout-minnesota/tree/main/assets/models/wooden_crate_02> |
| `crate-mil.glb`, `ammo-crate.glb` | Old Military Crate | Jack Mava | CC0 1.0 | <https://polyhaven.com/a/old_military_crate> | <https://github.com/m4tthewdavis/fallout-minnesota/tree/main/assets/models/old_military_crate> |
| `barrel.glb` | Barrel 03 | Serhii Khromov | CC0 1.0 | <https://polyhaven.com/a/barrel_03> | <https://github.com/m4tthewdavis/fallout-minnesota/tree/main/assets/models/barrel_03> |
| `tyre.glb` | Old Tyre | MP | CC0 1.0 | <https://polyhaven.com/a/old_tyre> | <https://github.com/m4tthewdavis/fallout-minnesota/tree/main/assets/models/old_tyre> |
| `generator.glb` | Portable Generator | James Ray Cock | CC0 1.0 | <https://polyhaven.com/a/portable_generator> | <https://github.com/m4tthewdavis/fallout-minnesota/tree/main/assets/models/portable_generator> |
| `toolbox.glb` | Metal Toolbox | Mateusz Sadek | CC0 1.0 | <https://polyhaven.com/a/metal_toolbox> | <https://github.com/m4tthewdavis/fallout-minnesota/tree/main/assets/models/metal_toolbox> |
| `ammo-can.glb` | Ammo Box | DanKit | CC0 1.0 | <https://polyhaven.com/a/ammo_box> | <https://github.com/m4tthewdavis/fallout-minnesota/tree/main/assets/models/ammo_box> |
| `medkit.glb` | Medical Box | Ulan Cabanilla | CC0 1.0 | <https://polyhaven.com/a/medical_box> | <https://github.com/m4tthewdavis/fallout-minnesota/tree/main/assets/models/medical_box> |
| `boulder.glb` | Boulder 01 | Rico Cilliers | CC0 1.0 | <https://polyhaven.com/a/boulder_01> | <https://github.com/m4tthewdavis/fallout-minnesota/tree/main/assets/models/boulder_01> |
| `rock.glb` | Rock 07 | Jenelle van Heerden | CC0 1.0 | <https://polyhaven.com/a/rock_07> | <https://github.com/m4tthewdavis/fallout-minnesota/tree/main/assets/models/rock_07> |
| `stump.glb` | Tree Stump 01 | Rob Tuytel | CC0 1.0 | <https://polyhaven.com/a/tree_stump_01> | <https://github.com/m4tthewdavis/fallout-minnesota/tree/main/assets/models/tree_stump_01> |
| `stump2.glb` | Tree Stump 02 | Rob Tuytel | CC0 1.0 | <https://polyhaven.com/a/tree_stump_02> | <https://github.com/m4tthewdavis/fallout-minnesota/tree/main/assets/models/tree_stump_02> |
| `log.glb` | Dead Tree Trunk | Rob Tuytel | CC0 1.0 | <https://polyhaven.com/a/dead_tree_trunk> | <https://github.com/m4tthewdavis/fallout-minnesota/tree/main/assets/models/dead_tree_trunk> |

## More Poly Haven assets (CC0)

Also from [Poly Haven](https://polyhaven.com), under CC0 1.0 (<https://creativecommons.org/publicdomain/zero/1.0/>,
<https://polyhaven.com/license>), taken straight from Poly Haven's file server through its API
(<https://api.polyhaven.com>). No attribution is required; the authors are listed as a courtesy.

The skies are 4K pure sky HDRIs, cropped to the sky above the horizon with the sun taken out (the game draws its own
sun disc where it stood), tone compressed as x / (1 + x) and saved as WebP at 4096 x 1024 and 2048 x 512
(`../textures/sky-<map>-4k.webp` and `-2k.webp`). Each map's sun was set to its HDRI's sun height and color, and the
sky is turned so its sun stands where the map's sun does.

| File | Asset | Author | License | Source |
| --- | --- | --- | --- | --- |
| `../textures/sky-vale-*.webp` | Sunflowers (Pure Sky) | Jarod Guest, Sergej Majboroda | CC0 1.0 | <https://polyhaven.com/a/sunflowers_puresky> |
| `../textures/sky-mesa-*.webp` | Kloofendal 38d Partly Cloudy (Pure Sky) | Greg Zaal, Jarod Guest | CC0 1.0 | <https://polyhaven.com/a/kloofendal_38d_partly_cloudy_puresky> |
| `../textures/sky-frost-*.webp` | Table Mountain 1 (Pure Sky) | Greg Zaal, Jarod Guest | CC0 1.0 | <https://polyhaven.com/a/table_mountain_1_puresky> |
| `../textures/sky-isles-*.webp` | Qwantani Sunset (Pure Sky) | Greg Zaal, Jarod Guest | CC0 1.0 | <https://polyhaven.com/a/qwantani_sunset_puresky> |

The ground textures are 1K PBR sets packed into two strips of five layers (grass, dirt, rock, sand, snow):
`../textures/ground-albedo.webp` (1024 per layer: color with its mean taken out, so each map's palette tints it, and
roughness in alpha) and `../textures/ground-normal.webp` (512 per layer: normal x and y, height, ambient occlusion).
The wall, plank, roof, sheet metal and concrete sets are resized to 512: `../textures/<part>.webp` (color partly
desaturated, so a building's own color tints it, and roughness in alpha) and `<part>-n.webp` (the normal map).

| File | Asset | Author | License | Source |
| --- | --- | --- | --- | --- |
| `../textures/ground-*.webp`, layer 1 | Leafy Grass | Charlotte Baglioni | CC0 1.0 | <https://polyhaven.com/a/leafy_grass> |
| `../textures/ground-*.webp`, layer 2 | Forest Ground 04 | Rob Tuytel, Rico Cilliers | CC0 1.0 | <https://polyhaven.com/a/forest_ground_04> |
| `../textures/ground-*.webp`, layer 3 | Rock Face 03 | Dario Barresi, Rico Cilliers | CC0 1.0 | <https://polyhaven.com/a/rock_face_03> |
| `../textures/ground-*.webp`, layer 4 | Coast Sand 01 | Rob Tuytel | CC0 1.0 | <https://polyhaven.com/a/coast_sand_01> |
| `../textures/ground-*.webp`, layer 5 | Snow 02 | Rob Tuytel | CC0 1.0 | <https://polyhaven.com/a/snow_02> |
| `../textures/plaster*.webp` | Rough Plaster Brick 04 | Rob Tuytel | CC0 1.0 | <https://polyhaven.com/a/rough_plaster_brick_04> |
| `../textures/wood*.webp` | Weathered Plank Siding | Dimitrios Savva | CC0 1.0 | <https://polyhaven.com/a/weathered_plank_siding> |
| `../textures/roof*.webp` | Clay Roof Tiles 02 | Amal Kumar | CC0 1.0 | <https://polyhaven.com/a/clay_roof_tiles_02> |
| `../textures/metal*.webp` | Worn Corrugated Iron | Jenelle van Heerden, Dimitrios Savva | CC0 1.0 | <https://polyhaven.com/a/worn_corrugated_iron> |
| `../textures/concrete*.webp` | Concrete Layers 02 | Rob Tuytel | CC0 1.0 | <https://polyhaven.com/a/concrete_layers_02> |
| `../textures/floor*.webp` | Wood Floor Worn | Dimitrios Savva | CC0 1.0 | <https://polyhaven.com/a/wood_floor_worn> |
| `../textures/rust*.webp` | Rusty Painted Metal | Amal Kumar | CC0 1.0 | <https://polyhaven.com/a/rusty_painted_metal> |
| `../textures/burlap*.webp` | Hessian 230 | colormass (photography), Rico Cilliers (processing) | CC0 1.0 | <https://polyhaven.com/a/hessian_230> |

The floor boards, rusted paint and burlap were taken the same way, from the 1K JPEG sets (color, roughness and OpenGL
normal map): `floor` at 512 (color partly desaturated), `rust` at 512 (color fully desaturated, so a container's or a
car's paint tints it; the normal map's alpha holds a mask of where the paint has rusted through, drawn from the dark,
brown streaks of the color, which the shader turns brown whatever the paint), and `burlap` at 256 (the weave of the
sandbags and the canvas of the tents and mattresses). Their sizes: `floor.webp` 101 KB and `floor-n.webp` 16 KB,
`rust.webp` 104 KB and `rust-n.webp` 37 KB, `burlap.webp` 70 KB and `burlap-n.webp` 27 KB.

The buildings' finer detail and the military props (shipping containers, wrecked cars, watchtowers, tents, sandbags,
pallets, razor wire, camo nets, broken walls) are not models: they are built in code (`../gfx/dress.ts`) from boxes and
simple shapes of our own design, dressed in the textures above. The camo net's garnish is painted in code. The fuel
drums are the Poly Haven barrel above, tinted.

The plants and the tape are 1K glTF bundles, reduced like the models above: the meshes wanted kept (one of the four
bushes in Shrub 02 for each of `shrub.glb` and `shrub2.glb`, one of the four ferns), the leaf cards' separate alpha
map merged into the color, set on the ground at the origin, welded, simplified with meshoptimizer, textures resized to
512 and re-encoded as WebP, quantized and meshopt compressed with glTF Transform.

| File | Model | Author | License | Source |
| --- | --- | --- | --- | --- |
| `shrub.glb`, `shrub2.glb` | Shrub 02 | Rico Cilliers | CC0 1.0 | <https://polyhaven.com/a/shrub_02> |
| `fern.glb` | Fern 02 | Rob Tuytel, Rico Cilliers | CC0 1.0 | <https://polyhaven.com/a/fern_02> |
| `branches.glb` | Dry Branches Medium 01 | Rico Cilliers | CC0 1.0 | <https://polyhaven.com/a/dry_branches_medium_01> |
| `tape.glb` | Medical Tape | Miroslav Turura | CC0 1.0 | <https://polyhaven.com/a/medical_tape> |

## Sounds

The recorded sounds (gunshots, bullet cracks, footsteps, reloads, impacts, blasts and the propeller) live in
`../sounds/`, with every source, author and license listed in `../sounds/LICENSES.md`. Most are CC0; the footsteps on
grass, wood, metal and water (congusbongus, from recordings by swuing, Eelke and EminYILDIRIM), the grenade and big
blasts and two weapon clicks (Michel Baradari) and the propeller loop (AntumDeluge, from a recording by jakobthiesen)
are CC BY 3.0.
