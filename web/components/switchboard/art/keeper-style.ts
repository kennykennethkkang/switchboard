// Lantern Sea keeper style contract: paints the cast in feet space and adds live light (lantern-ink.ts).
import type { CourtColors as C } from '@/lib/skins'
import type { G } from '../board-art'

/** Lantern Sea cast keys; anything else draws as the pilgrim. */
export const KEEPERS = ['lead', 'engineer', 'qa', 'designer', 'researcher', 'ops', 'growth', 'pilgrim'] as const
export type Keeper = (typeof KEEPERS)[number]

export type KeeperStyle = {
  /** Paint one keeper with its feet at the origin, y up negative. Must stay within x -38..38, y -86..8. u is the loop phase 0..1 (2.4 s), baked at 12 frames. */
  paint: (g: G, role: Keeper, ai: string | undefined, state: string | undefined, leg: number, u: number, c: C, sash: string) => void
  /** Optional live light drawn each frame over the baked keeper at world (x, y). add runs fn additively. */
  fx?: (g: G, x: number, y: number, role: Keeper, state: string | undefined, t: number, u: number, c: C,
    add: (fn: () => void) => void, glowAt: (g: G, col: string, x: number, y: number, r: number, a: number) => void) => void
}
