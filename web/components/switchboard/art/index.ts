import type { ArtKit } from './types'
import { court } from './court'
import { abyss } from './abyss'
import { neon } from './neon'
import { orbit } from './orbit'
import { lantern } from './lantern'

export type { ArtKit, Realm, FigureBox, FigurePose } from './types'
/** Kit id to kit. A skin's `art` names one of these. */
export const KITS: Record<string, Partial<ArtKit>> = { court, abyss, neon, orbit, lantern }
/** A kit with court filled in for every hook it leaves out. */
export const withCourt = (kit: Partial<ArtKit>): ArtKit => ({ ...court, ...kit })
export const kitOf = (id: string): ArtKit => withCourt(KITS[id] ?? {})
export { REALM } from './court'
