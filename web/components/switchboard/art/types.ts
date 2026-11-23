import type { CourtColors as C } from '@/lib/skins'
import type { G } from '../board-art'
import type { Cast, Icon } from '@/lib/court-cast'
import type { CourtNode, CourtState } from '@/lib/court-map'

/** One AI's realm palette: deck top, rim, shadow, the bright hue for text and lights, and a glow. */
export type Realm = { top: string; rim: string; dk: string; hi: string; glow: string }

/** A look for the board's art. A kit fills any hook; the rest come from court. Each hook draws a whole piece, so a kit can redraw it. */
export type ArtKit = {
  /** Realm palette per AI id. */
  realms: Record<string, Realm>
  /** Name plate fill for non-council labels. */
  plate: string
  /** Sprites wear a glass helmet and carry a glow. */
  helm: boolean
  /** Halo ring under a realm isle, drawn after its first halo. */
  realmHalo: (g: G, x: number, y: number, rx: number, ry: number, R: Realm, c: C) => void
  /** Extra detail on a realm isle deck, after its pattern and before its landmark. */
  realmDeco: (g: G, x: number, y: number, rx: number, ry: number, R: Realm, c: C) => void
  /** Screen layers behind the court, sky to sea. px is the view's x in art px for parallax; t is 0 under reduced motion. */
  backdrop: (g: G, w: number, h: number, t: number, px: number, c: C, night: boolean) => void
  /** One drifting item at (x, y) with radius r; i is its index. */
  drift: (g: G, x: number, y: number, r: number, t: number, i: number, c: C) => void
  /** A chat arriving at (x, y), p 0..1; returns the sprite's lift in art px. */
  arrive: (g: G, x: number, y: number, p: number, t: number, c: C) => number
  /** Needs-you mark under a sprite at (x, y). */
  ping: (g: G, x: number, y: number, t: number, c: C) => void
  /** Far sky dots baked into the court frame; w and h are the frame's px. */
  bakeSky: (g: G, w: number, h: number, c: C) => void
  /** A bridge segment from (ax, ay) to (bx, by), width w, drawn first (the shared deck base). */
  bridgeBase: (g: G, ax: number, ay: number, bx: number, by: number, w: number, c: C) => void
  /** A bridge segment's detail, drawn over bridgeBase. */
  bridgeDeck: (g: G, ax: number, ay: number, bx: number, by: number, w: number, c: C) => void
  /** Island top, rim and dot colors from the node's own; the dots are the island's speckle. */
  islandColors: (top: string, rim: string, c: C) => { top: string; rim: string; dot: string }
  /** Below an island at (x, y), radii rx and ry, side depth: clouds or kelp. */
  islandUnder: (g: G, x: number, y: number, rx: number, ry: number, depth: number, c: C) => void
  /** Over an island's top: coral, or nothing. */
  islandTop: (g: G, x: number, y: number, rx: number, ry: number, c: C) => void
  /** A hall's wall face: wood slats or portholes. x, y is the hall's top left, w its width. */
  hallWalls: (g: G, x: number, y: number, w: number, c: C) => void
  /** A hall's roof: stacked tiers, or a dome. tiers is the rank; roof is the tier palette. */
  hallRoof: (g: G, x: number, y: number, w: number, tiers: number, roof: [string, string, string], c: C) => void
  /** The council's staff at (hx, hy) with its lanterns or beacon. */
  councilMast: (g: G, hx: number, hy: number, c: C) => void
  /** Optional, court has none: draws the whole island (sides, top, plaza) in place of the default shell; colors already passed through islandColors. */
  island?: (g: G, x: number, y: number, rx: number, ry: number, depth: number, top: string, rim: string, plaza: boolean, c: C) => void
  /** Optional: the whole hall in place of walls, door, beam and roof. x, y is its top left as for hallWalls. */
  hall?: (g: G, x: number, y: number, w: number, roof: [string, string, string], walls: string, tiers: number, beam: string, c: C) => void
  /** Optional: a realm isle's halo, underside, deck and pattern; realmDeco, the landmark and gate still follow. */
  realmShell?: (g: G, x: number, y: number, rx: number, ry: number, ai: string | undefined, R: Realm, c: C) => void
  /** Art px per world unit. Default 2: whole device pixels per art px. A smaller unit draws finer art, and the court bake lowers it when the canvas would pass 16e6 px. */
  res?: number
  /** Smooth kit: the art layer is image-smoothed and zoom is continuous, not stepped to whole pixels. */
  smooth?: boolean
  /** Optional: a desk's figure, anchor (x, y) at its feet. Returns its box; the hit box, hover anchor, tap check and badges follow it. Frozen figures come in at t 0 and get an ice wash, drawn within 16 art px either side, 28 up and 6 down of the anchor. */
  figure?: (g: G, x: number, y: number, p: FigurePose, c: C) => FigureBox
  /** Optional: the AI badge or state badge, icon at top left (x, y). */
  badge?: (g: G, ic: Icon, x: number, y: number, c: C) => void
  /** Optional: a speech bubble over a sprite at (x, y); st may be undefined, draw nothing then. */
  bubble?: (g: G, x: number, y: number, st: CourtState | undefined, step: number, c: C) => void
  /** Optional: sleep marks rising from (x, y) over an idle sprite. */
  zzz?: (g: G, x: number, y: number, t: number, c: C) => void
  /** Optional: a done twinkle at (x, y); i is the desk's index. */
  sparkle?: (g: G, x: number, y: number, t: number, i: number, c: C) => void
  /** Optional: a desk whose pixel top left is (x, y), 24 by 9 art px; lit while working. R is the realm palette on a realm isle, else undefined. */
  desk?: (g: G, x: number, y: number, lit: boolean, R: Realm | undefined, c: C) => void
  /** Optional: a realm's landmark standing on its pixel base (bx, by). */
  landmark?: (g: G, ai: string | undefined, bx: number, by: number, R: Realm, c: C) => void
  /** Optional: a realm's gate at pixel anchor (gx, gy); yardAi is the AI of the courtyard it opens to. The AI badge is drawn after it. */
  gate?: (g: G, gx: number, gy: number, R: Realm, yardAi: string | undefined, c: C) => void
  /** Optional: a ring place's building centered on (x, y), on the islet island() draws. */
  placeArt?: (g: G, n: CourtNode, island: (n: CourtNode, top: string, rim: string, plaza: boolean) => void, c: C, x: number, y: number) => void
  /** Optional: the done burst around a sprite at (x, y); cheer runs 0 to 1. */
  confetti?: (g: G, x: number, y: number, cheer: number, c: C) => void
  /** Optional: the theme's own characters by role, like court-cast SEA; a role left out keeps its CAST character. */
  cast?: Record<string, Cast>
}
/** A desk's figure state for the figure hook: t is the clock (0 still), frozen means a usage pause holds it. */
export type FigurePose = { role: string | undefined; ai: string | undefined; leg: number; state: CourtState | undefined; t: number; frozen: boolean }
/** A figure's box in art px from its anchor: top above it, bottom below, half its width each side, tall its height for the tap check. The sprite is { top: 22, bottom: 2, half: 7, tall: 16 }. */
export type FigureBox = { top: number; bottom: number; half: number; tall: number }
