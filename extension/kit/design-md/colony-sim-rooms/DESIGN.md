---
version: alpha
name: Colony-sim-rooms-analysis
description: "The top-down management view of RimWorld, Prison Architect and Kairosoft: rooms painted on a tile grid with their names drawn on the floor, workers as tiny readable sprites with a job bubble, overlays you toggle to see one dimension at a time, and a thin stat strip with pop-up numbers when something pays off."
when: "Use for any screen that shows many workers in many places at once and must stay legible zoomed out: a board of chats, queues or jobs laid out as rooms. Skip for a single-task view or text-heavy settings."
sources:
  - https://ludeon.com/forums/index.php?msg=411059
  - https://top-mods.com/mods/rimworld/other/14350-labels-on-floor-continued.html
  - https://en.wikipedia.org/wiki/Kairosoft
  - https://pixelsmithstudios.com/game-development-reviews/using-pixel-art-gaming-dungeon-village/
colors:
  ground: "#2b2f26"
  floor-a: "#6b5b45"
  floor-b: "#57606b"
  wall: "#3d3a36"
  room-label: "#ffffff"
  room-label-opacity: 0.35
  selection: "#ffe066"
  overlay-good: "#5ec26a"
  overlay-bad: "#e05a47"
  panel: "#1e1f22"
  panel-edge: "#4a4b50"
  ink: "#ececec"
typography:
  floor-label:
    fontFamily: "bold sans or pixel face"
    fontSize: "scales with zoom; hide below a set zoom"
    textTransform: uppercase
  stat:
    fontFamily: "pixel face"
    fontSize: 12px
    fontVariantNumeric: tabular-nums
rounded:
  panel: 2px
spacing:
  tile: 16px
---

## Overview

Colony sims solve "lots happening, read it at a glance." The room, not the worker, is the unit of meaning: a room has a type, a name and a floor color, and the people in it inherit its purpose. Kairosoft adds the reward loop: small sprites, chunky panels, and numbers that pop up over a room when it earns something.

## Patterns worth taking

- **Floor labels:** the room name is drawn on the floor under the furniture at low opacity, so it never hides sprites. Hide labels in rooms too small to hold them, and below a zoom threshold.
- **Floor color per room type:** one tint per kind of room. Five or six types at most before it turns to noise.
- **Overlays:** a toggle row that recolors the floor by one dimension (cost, age, error rate, budget left). One overlay at a time, with an "all off" switch.
- **Job bubble:** a small icon over a worker's head says what it is doing; hover shows the sentence.
- **Painted rooms:** building is "paint an area, then name it," which makes regrouping cheap. For a board, dragging a card into a room is the same move.
- **Kairosoft stat strip:** a thin top bar with a handful of counters, plus floating +N numbers over the room that produced them, rising one tile and fading in about 600ms.

## Layout and grid

- 16px or 32px tiles, whole-integer zoom levels only.
- Walls one tile thick; doors as gaps make flow between rooms readable.
- Side panel for the selected room or worker; the map never shrinks below about 60% of the width.

## Motion

- Workers step tile to tile (no sub-tile glide) at 4 to 6 steps per second.
- Pop-up numbers and job bubbles are the only motion that should draw the eye; under reduced motion show them without the rise.

## Do and don't

- Do keep sprites tiny and let rooms carry meaning. Don't put text on sprites.
- Do give every overlay a legend. Don't stack two overlays.
