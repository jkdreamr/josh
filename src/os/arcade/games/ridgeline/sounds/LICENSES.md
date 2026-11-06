# Ridgeline sound credits

Every recorded sound in the game is in the five files here, each a mono Opus (WebM) "sprite" of short clips packed
one after another with a little silence between them (`samples.ts` has the table of where each clip starts and how
long it is). For the game the takes were cut out of the original recordings, folded to mono (the stronger side of a
spaced stereo pair, so nothing comb filters), trimmed of the silence before and after, faded out, normalized to the
same peak, and encoded at 32 to 64 kbit/s. The close gunshots were also gently saturated so their body comes up under
the first crack, as game gunfire usually is. Nothing else was changed.

All of them are CC0 (public domain, <https://creativecommons.org/publicdomain/zero/1.0/>) except the ones marked
CC BY 3.0 (Creative Commons Attribution 3.0, <https://creativecommons.org/licenses/by/3.0/>), whose authors are credited
here and in the game's How to Play.

## `guns.webm`: gunshots and bullet cracks

From **The Free Firearm Sound Library** (the "Prepared SFX Library"), recorded by the FreeFirearmSFX team (Still North
Media) and funded on Kickstarter, released CC0. Mirrored on OpenGameArt by bart:
<https://opengameart.org/content/the-free-firearm-sound-library> (original site: <http://freefirearmsfx.com>). Each gun
was recorded close to the shooter and from down range; the close takes are the near shots, the down range takes the
far reports (from where the report starts, after the bullet's crack), and four cracks of supersonic rounds passing the
down range microphone are the bullet cracks.

| Clip | Gun in the recording | Close take | Down range take |
| --- | --- | --- | --- |
| `rifle` (Kestrel, Talon) | AR-15, 5.56 | `AR-15/D_32P.wav` | `AR-15/D_24P.wav` |
| `smg` (Hornet) | Carl Gustav M45, 9 mm | `Carl Gustav M45/G_31P.wav` | `Carl Gustav M45/G_20P.wav` |
| `pistol` (Wren) | Walther PPQ, 9 mm | `Walther PPQ/X_39P.wav` | `Walther PPQ/X_31P.wav` |
| `shotgun` (Thresher) | Benelli Nova, 12 gauge | `Nova/O_21P.wav` | `Nova/O_17P.wav` |
| `dmr` (Lancer) | Norinco SKS, 7.62x39 | `SKS/U_14P.wav` | `SKS/U_19P.wav` |
| `sniper` (Longbow) | Tikka T3, .30-06 | `Tikka/W_29P.wav` | `Tikka/W_24P.wav` |
| `lmg` (Rampart) | AK-47, 7.62x39 | `AK-47/C_28P.wav` | `AK-47/C_31P.wav` |
| `bulwark` | Colt 1911, .45 | `1911/A_42P.wav` | `1911/A_34P.wav` |
| `marshal` | Smith & Wesson 642, .38 | `Smith & Wesson 642/V_27P.wav` | `Smith & Wesson 642/V_22P.wav` |
| `wasp` | PPSh-41 (close only; far uses `smg`) | `PPSh/P_30P.wav` | |
| `mauler` | Charles Daly pump, 12 gauge | `CD/H_21P.wav` | `CD/H_16P.wav` |
| `crack` | AR-15, Tikka T3, Springfield 1917, Arisaka | | `AR-15/D_24P.wav`, `Tikka/W_24P.wav`, `1917/B_16P.wav`, `Arisaka/E_18P.wav` |

## `steps.webm`: footsteps

| Clip | Source | Author | License |
| --- | --- | --- | --- |
| `leaf` (grass), `wood`, `metal`, `water` | Footsteps on different surfaces, <https://opengameart.org/content/footsteps-on-different-surfaces> (`grass`, `wood`, `metal`, `water`) | congusbongus, from footstep-grass.wav, footstep-wood.wav and footstep-concrete.wav by swuing (freesound 38874, 38876, 38873), boots on aluminum ladder 01 by Eelke (freesound 462598) and Water Footsteps by EminYILDIRIM (freesound 608663) | CC BY 3.0 |
| `dirt` | the same pack's `gravel` steps | congusbongus, from the Gravel Footsteps pack by Ali_6868 (freesound pack 21608) | CC0 |
| `stone`, `sand` | Fantozzi's Footsteps (Grass/Sand & Stone), <https://opengameart.org/content/fantozzis-footsteps-grasssand-stone> | Fantozzi, cut by qubodup | CC0 |
| `snow` | 42 Snow and Gravel Footsteps, <https://opengameart.org/content/42-snow-and-gravel-footsteps> (`snow_covered_gravel_01` to `05`) | Corsica_S, cut by qubodup | CC0 |

## `foley.webm`: reloads, the empty click, drawing a gun, bullet impacts

| Clip | Source | Author | License |
| --- | --- | --- | --- |
| `magout`, `magin` | Gun reload sounds, `assaultriflereload1.wav`, <https://opengameart.org/content/gun-reload-sounds> | SpringySpringo | CC0 |
| `pmagout`, `pmagin`, `slide` | the same, `gunreload1.wav` | SpringySpringo | CC0 |
| `shell`, `rack` | Shotgun Reload Sound effects, `Subsequent Shells.mp3` and `Rack.mp3`, <https://opengameart.org/content/shotgun-reload-sound-effects> | zer0_sol | CC0 |
| `bolt` | equipment clicks III (a bolt action rifle being worked), <https://opengameart.org/content/equipment-clicks-iii> | LFA | CC0 |
| `charge`, `empty` | 2 metal weapon clicks, `weapload.wav` and `outofammo.wav`, <https://opengameart.org/content/2-metal-weapon-clicks> | Michel Baradari (apollo-music.de), published by qubodup | CC BY 3.0 |
| `draw` | Gun Reload Sound Effects, `clipload2.wav`, <https://opengameart.org/content/gun-reload-sound-effects> | BMacZero | CC0 |
| `imp.metal`, `imp.stone`, `imp.wood`, `imp.flesh` | Impact, <https://opengameart.org/content/impact> | qubodup | CC0 |
| `imp.metal` (the three clinks) | Metal Impact Sounds, `clink1.wav` to `clink3.wav`, <https://opengameart.org/content/metal-impact-sounds> | BMacZero | CC0 |

## `booms.webm`: blasts

| Clip | Source | Author | License |
| --- | --- | --- | --- |
| `nade`, `big` | 2 High Quality Explosions, `explodemini.wav` and `explode.wav`, <https://opengameart.org/content/2-high-quality-explosions> | Michel Baradari (apollo-music.de), published by qubodup | CC BY 3.0 |
| `far` | Explosion somewhere far, <https://opengameart.org/content/explosion-somewhere-far> | pauliuw | CC0 |

## `prop.webm`: the transport's propeller

| Clip | Source | Author | License |
| --- | --- | --- | --- |
| the loop | Airplane Prop Loop, <https://opengameart.org/content/airplane-prop-loop> | AntumDeluge, from airplane prop noise by jakobthiesen | CC BY 3.0 |

## Still synthesized

The vehicle engines (no clean, license-clean jeep or motorbike loop was found), the crossbow, fire, flashbangs,
smoke, the hit markers, the charge's beeps, the sirens and horns, and the soft impacts (a bullet into earth, sand, snow
or water) are made in code in `audio.ts`, as is every recorded sound until its file has loaded.
