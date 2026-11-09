---
version: alpha
name: Palace-vermilion-analysis
description: "A Forbidden City and celestial-court reading for pixel UI: cinnabar walls, gamboge roofs and ochre framing in a fixed rank order, an axial courtyard plan where importance grows toward the center and the north, and a small motif kit (cloud scrolls, lattice, door studs, roof tiers) used as UI ornament. Journey to the West supplies the story layer: a Jade Emperor's court, ranked officials, and journeys drawn as clouds."
when: "Use when a screen wants an imperial or Chinese-mythic skin, such as Switchboard's Celestial Court board: rank, hierarchy and ceremony made visible. Pair with a layout reference (starnet-station or colony-sim-rooms); this one supplies palette, ornament and hierarchy, not mechanics."
sources:
  - https://chromacathay.pages.dev/gallery/forbidden-city-vermilion
  - https://ruminino.itch.io/celestial-banishment
  - https://en.wikipedia.org/wiki/Forbidden_City
  - https://en.wikipedia.org/wiki/Journey_to_the_West
colors:
  zhu-hong: "#ff4c00"
  zhu-hong-deep: "#b8321a"
  xiang-se: "#f0c239"
  zhe-se: "#955539"
  xuan-se: "#622a1d"
  jade: "#4f9d8c"
  azure-tile: "#2f5d8a"
  stone: "#d9d2c3"
  night: "#1a1418"
  ink: "#f6efe2"
  ink-on-light: "#2a1a14"
typography:
  title:
    fontFamily: "a brush or seal-style CJK face for one or two characters only (Ma Shan Zheng, ZCOOL XiaoWei), else a serif"
    use: "plaques and headers, never body"
  chrome:
    fontFamily: "pixel face (Silkscreen, Zpix for CJK)"
    fontSize: 12px
  body:
    fontFamily: "system sans or Noto Sans SC"
    fontSize: 14px
rounded:
  none: 0px
spacing:
  tile: 16px
---

## Overview

Palace color is a hierarchy, not a swatch set. Cinnabar red (zhu-hong) signals rank and covers walls; gamboge yellow (xiang-se) is the imperial roof; ochre (zhe-se) and earth hold the red in place where wall meets roof. Xuan, a deep red-black, is the shadow. Read that as a token rule: red for the seat of authority, gold for the top of a hierarchy, ochre for frames and borders, xuan for depth.

## Colors

- **Zhu-hong** `#ff4c00`: walls of important halls, the active or lead element. Too hot for large flat UI fills at full strength; use `zhu-hong-deep` for panels and keep the bright value for edges and the one focal hall.
- **Xiang-se** `#f0c239`: roofs, crowns, the highest rank, success at the top level. Scarce.
- **Zhe-se** `#955539`: frames, beams, panel borders, dividers.
- **Xuan-se** `#622a1d`: shadow under eaves, pressed states, deep panel ground.
- Supporting: jade and azure appear in painted beams (caihua) under the eaves; use them for secondary status so red and gold stay rare.
- Text on red and gold needs a check: ink `#f6efe2` on `zhu-hong-deep` passes; bright zhu-hong behind small text does not.

## Layout and grid

- Axial plan: a north-south spine with halls in sequence, each courtyard larger and more important than the last. On a board, the lead or most important room sits on the spine, workers in side halls left and right.
- Roof tiers mark rank: double eaves for the top hall, single for lesser ones. In pixel UI, rank can be a roof tier or plaque size rather than a badge.
- Gates between courtyards are natural stage transitions (queued, working, done).

## Motif kit (draw your own, no borrowed sprites)

- Auspicious cloud scroll (xiangyun): soft ornament for panel corners and the "travel" of a task. Sun Wukong's cloud somersault is a ready metaphor for a handoff.
- Lattice window pattern: panel backgrounds or dividers at low contrast.
- Door studs in a 9 by 9 grid: a progress or capacity grid.
- Hanging plaque over a hall: the room's name, short, in a title face.
- Lanterns: a light-on state, same job as starnet's lit desk.
- Journey to the West cast as roles: the court ranks officials; the golden circlet and the staff are recognizable without copying any one artwork.

## Motion

- Lantern flicker 2 frames at 2 to 3 fps; clouds drift slowly (8 to 20s loops) and stop under reduced motion.
- Gates open in 3 to 4 steps, not a smooth tween.

## Do and don't

- Do keep red and gold rare so they keep rank. Don't paint every panel vermilion.
- Do describe and redraw motifs. Don't trace screenshots, museum photos or stock pixel art; the repo is public.
