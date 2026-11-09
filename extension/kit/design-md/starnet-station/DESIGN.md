---
version: alpha
name: StarNet-station-analysis
description: "A pixel 'crew station' for watching AI agents work: every agent is a sprite at a desk in a top-down room, a lit desk means a live run, tools show up as furniture (signal dish for web, cabinet for files, workbench for terminal), and a COMMS side panel carries the real controls. Terminal voice in the chrome: numbered sections, bracketed [ BUTTONS ], // comment subheads."
when: "Use for an agent or job dashboard that should feel alive and spatial: each worker gets a seat, state reads from the room before any text. Skip it for dense tables, billing, or anything a user scans in under a second."
sources:
  - https://starnetos.com
colors:
  canvas: "#0e1016"
  floor: "#1b1f2a"
  floor-tile-line: "#262b38"
  wall: "#2e3445"
  desk-off: "#3a3f4f"
  desk-lit: "#ffd27a"
  lamp-glow: "#ffb84a"
  ink: "#e8ecf4"
  ink-muted: "#8b93a7"
  ok: "#6fdc8c"
  warn: "#ffb84a"
  error: "#ff6b6b"
typography:
  chrome:
    fontFamily: "monospace pixel face (Silkscreen, Press Start 2P, or a system mono)"
    fontSize: 12px
    letterSpacing: 0.08em
    textTransform: uppercase
  body:
    fontFamily: "system sans"
    fontSize: 14px
    lineHeight: 1.5
rounded:
  none: 0px
spacing:
  tile: 16px
  scale: "integer multiples only (2x, 3x, 4x)"
---

## Overview

StarNet is a local-first agent harness whose main screen is a pixel station rather than a log. The idea worth taking is the mapping, not the art: a run is a body in a seat, a capability is an object in the room, and the side panel is where you act. Colors above are a Switchboard reading for a night station, not StarNet's own tokens.

**Key characteristics:**
- One bay per agent working in parallel. Empty bay = idle slot, lit desk = live run, dark desk = done or parked.
- Gear as furniture: what an agent may touch is visible as objects beside its desk, so permissions read spatially.
- A lead hands work to specialists and the result walks back; delegation is drawn as movement between bays.
- COMMS panel: text in, Stop button, real run timer. The room is for reading, the panel is for doing.
- Marketing chrome in terminal voice: numbered sections 01 to 04, `[ DOWNLOAD ]` style buttons, `//` subheads.

## Colors

Dark cool floor so warm light carries state. The only warm hue on screen should be a lit desk or lamp; status chips reuse ok, warn and error and never decorate.

## Typography

Pixel or mono face for labels, tabs and numbers only, uppercase with wide tracking. Body text and anything longer than a line stays in a readable sans at 14px or more; pixel fonts below 12px fail.

## Layout and grid

- 16px tile, scaled by whole integers with `image-rendering: pixelated`. Never fractional scale.
- Room on the left or center, a fixed-width side panel (280 to 360px) on the right with tabs: Delegation, Workflows, Tools, Schedules, Models and Budgets.
- Bays in a row or grid with a one-tile corridor so sprites can walk between them.

## Motion

- Sprites idle on a 2 to 4 frame loop at 4 to 8 fps; typing at a desk is the "working" loop.
- Lamp turns on in one step (no fade) when a run starts; that snap is the event.
- Replay from real harness events, not invented animation, so motion never lies about state.
- Reduced motion: hold the first frame, keep the lit-desk color change.

## UI patterns

- Hover or focus a sprite to show name, task, elapsed time and cost in a small framed tooltip.
- Click a bay to pin its detail in the side panel.
- Budget or cost readout lives with each bay, not only in a global header.

## Do and don't

- Do let every visual state map to a real state. Don't add ambient wandering that looks like work.
- Do keep controls in HTML (44px targets, focusable). Don't make the canvas the only way to act.
