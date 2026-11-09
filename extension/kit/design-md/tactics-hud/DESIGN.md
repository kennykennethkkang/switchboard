---
version: alpha
name: Tactics-HUD-analysis
description: "The legibility rules behind Into the Breach style HUDs and Zach Gage's Three Reads: a screen should say what it is from across a room, what is happening from arm's length, and the numbers only up close. Intent is telegraphed on the board itself (arrows, tile highlights) and the side panel holds detail, never the other way round."
when: "Use when designing a game-like HUD, side panel or status overlay where the user must predict what happens next: a board of running agents, a queue, a turn-based view. Use it to cut, not to decorate; it pairs with any skin reference."
sources:
  - https://gdcvault.com/play/1025772/-Into-the-Breach-Design
  - https://www.gamedeveloper.com/design/video-how-subset-games-designed-i-into-the-breach-i-
  - http://stfj.net/DesigningForSubwayLegibility/
colors:
  board: "#1c2230"
  tile: "#2a3346"
  tile-edge: "#3b4660"
  intent: "#ff5a3c"
  intent-fill-opacity: 0.35
  friendly: "#58b4ff"
  neutral: "#c8ccd6"
  panel: "#11151e"
  panel-edge: "#5a6680"
  ink: "#f1f3f8"
typography:
  hud-number:
    fontFamily: "pixel or condensed mono"
    fontSize: 16px
    fontVariantNumeric: tabular-nums
  panel-body:
    fontFamily: "system sans"
    fontSize: 14px
rounded:
  none: 0px
spacing:
  panel-width: "280-320px"
---

## Overview

Three reads: the first read (silhouette, color masses) tells what kind of screen this is; the second read (shapes and arrows on the board) tells what is about to happen; the third read (numbers and text) explains why. Each extra badge or number on the first-read layer costs the other two.

## Patterns worth taking

- **Telegraph on the board:** what will happen next is drawn where it will happen, as an arrow, a tinted tile or a ghost of the result. The user does not open a panel to predict.
- **One threat color:** a single hot hue means "this will hurt"; friendly and neutral stay cool. Nothing decorative uses the threat hue.
- **Side panel for the selection only:** select a unit, the panel shows its stats and actions; nothing selected, the panel shows the turn summary.
- **Turn order visible:** a numbered sequence badge on each actor when order matters.
- **Undo once, cheaply:** one undo per turn removes fear without hiding consequences.

## Layout

- Board centered, framed by a thin HUD edge; side panel fixed width on one side, a short top strip for global state (turn, time, budget).
- HUD panels are opaque, square cornered, with a 1 or 2px light edge. No glass.

## Motion

- Intent markers pulse at most 1 Hz, or not at all under reduced motion.
- Resolution plays in the telegraphed order, one actor at a time, so the user can check prediction against result.

## Do and don't

- Do test a screenshot at thumbnail size: if the state is unclear, fix the board, not the panel.
- Don't put numbers on the first-read layer. Don't use the threat color for branding.
