# Tennis player asset licenses

The two GLBs in this directory contain only the MakeHuman/MPFB assets listed below. No source models, generator scripts, or Blender project files are included.

## Sources

- MakeHuman asset-pack index: <https://static.makehumancommunity.org/assets/assetpacks/index.html>
- MakeHuman system asset pack listing: <https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html>
- CC0 system asset archive: <https://files2.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip>
- Downloaded system asset archive SHA-256: `b542127a8e25547c7c29c19f2d1d2adb9a664c80396ecd694095dbc8028a0107`

## Embedded assets

The MakeHuman base mesh, macro targets, skin textures, eye assets, and eyebrow asset are MakeHuman system assets released under CC0.

| Asset | Used by | Source |
| --- | --- | --- |
| `hm08` base mesh and macro targets | Female and male | MakeHuman system assets; base mesh and targets are CC0 |
| `young_caucasian_female` skin and diffuse texture | Female | `skins/young_caucasian_female/young_caucasian_female.mhmat` and referenced image; CC0 |
| `young_caucasian_male` skin and diffuse texture | Male | `skins/young_caucasian_male/young_caucasian_male.mhmat` and referenced image; CC0 |
| `low-poly` eyes, brown eye material, and texture | Female and male | `eyes/low-poly/low-poly.mhclo`, `materials/brown.mhmat`, and referenced texture; CC0 |
| `eyebrow001` mesh, material, and alpha texture | Female and male | `eyebrows/eyebrow001/`; CC0 |
| `ponytail01` mesh, material, and alpha texture | Female | `hair/ponytail01/`; CC0 |
| `short04` mesh, material, and alpha texture | Male | `hair/short04/`; CC0 |
| `female_sportsuit01` clothing mesh and material | Female | `clothes/female_sportsuit01/`; trimmed to a sports top and shorts with the shoulder seams and exposed waist masked in the matching shirt material for full coverage; CC0 |
| `male_casualsuit01` clothing mesh and material | Male | `clothes/male_casualsuit01/`; sleeves and trouser legs trimmed; CC0 |
| `shoes06` shoe mesh and material | Female and male | `clothes/shoes06/`; CC0 |
| `game_engine` rig weights | Female and male | MPFB `weights.game_engine.json`; declares CC0 |

Each used clothing and hair `.mhclo`/`.mhmat` asset includes this explicit metadata license line:

> This asset was explicitly released as CC0 in september 2020. The license text for CC0 can be found in the root of this repository.

The generated skeleton uses MPFB's `game_engine` rig definition; that definition has no license field. The associated weight data declares CC0. The GLBs contain the generated skeleton and weights, not MPFB source code.

## Optimization

The GLBs are size-optimized copies of the exported files: textures re-encoded to WebP (`EXT_texture_webp`) and geometry quantized and compressed with meshopt (`KHR_mesh_quantization`, `EXT_meshopt_compression`), using glTF-Transform 4.2.1 (`gltf-transform webp --quality 88`, then `gltf-transform meshopt --level medium`). Asset content, names, materials, and licenses are unchanged.
