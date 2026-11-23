import { journeyWest } from './journey-west'
import { abyss } from './abyss'
import { neon } from './neon'
import { orbit } from './orbit'
import { lantern } from './lantern'

/** palette.panel, trim: the tool belt's plate and border. court: colors for islands, halls, desks and sprites; bands: the sky, top to bottom. */
export type Look = {
  palette: { bg: string; ink: string; accent: string; active: string; done: string; warn: string; panel: string; trim: string }
  court: { colors: CourtColors; bands: string[] }
}
/** The top-level look is day; night is optional, only skins that keep night hours have one. */
export type Skin = Look & {
  id: string; name: string; info: string
  /** Skins that share one story and cast; the theme menu groups them under the family name. preset: this look's name in the group. */
  family?: { id: string; name: string; preset: string }
  /** The art kit that draws the board (components/switchboard/art): pipes, halls, sprites. */
  art: string
  copy: { title: string; empty: string; done: string }
  font: string
  night?: Look
  /** Tool belt: an item name and hint per action. */
  belt: { name: string; items: Record<BeltId, { item: string; hint: string }>; sprites?: Partial<Record<BeltId, string[]>>
    /** Smooth icons in place of the pixel grids: inline SVG markup per item, viewBox 0 0 24 24; 'skin' is the theme picker's. */
    icons?: Partial<Record<BeltId | 'skin', string>> }
  /** Labels, plates, hover bubble, legend and side panel. Left out: today's dark plates in the pixel font. */
  chrome?: Chrome
}
/** plate, edge, text, mute: label card fill, border, title and sub-line colors; font: label font; radius: corner px. */
export type Chrome = { plate: string; edge: string; text: string; mute: string; font: string; radius: number }
export type Mode = 'day' | 'night'
export type BeltId = 'new' | 'next' | 'todo' | 'limits' | 'changes' | 'mode'
export type CourtColors = Record<'ink' | 'ink2' | 'red_dk' | 'red' | 'red_lt' | 'gold_dk' | 'gold' | 'gold_lt' | 'jade_dk' | 'jade' | 'jade_lt' | 'peach_dk' | 'peach' | 'peach_lt'
  | 'cloud' | 'cloud_sh' | 'blue' | 'blue_lt' | 'sky' | 'brown_dk' | 'brown' | 'skin' | 'plum' | 'wood_dk' | 'wood' | 'wood_lt' | 'rail'
  | 'stone_dk' | 'stone' | 'stone_ln' | 'hall' | 'beam' | 'roof' | 'roof_dk' | 'roof_lt' | 'azure' | 'azure_dk' | 'azure_lt', string>

export { journeyWest, abyss, neon, orbit, lantern }
/** Belt theme switch order. */
export const SKINS: Skin[] = [journeyWest, abyss, neon, orbit, lantern]
export const skinById = (id: string) => SKINS.find(s => s.id === id) ?? orbit
/** The theme the user picked on the belt. */
export const SKIN_KEY = 'switchboard.boardTheme'
/** Before themes, every day/night flip wrote journey-west here, so it is not a pick; only its old 'ink' (night) still counts. */
export const LEGACY_SKIN_KEY = 'switchboard.boardSkin'
export const MODE_KEY = 'switchboard.boardMode'
/** The skin with its night palette swapped in; day when the skin has no night. */
export const lookOf = (skin: Skin, mode: Mode): Skin => mode === 'night' && skin.night ? { ...skin, ...skin.night } : skin

/** Stored picks to a skin and mode. 'ink' was the old night skin; an unset mode follows the system. url: a ?skin= review link, wins over the stored pick. */
export function readPick(skin: string | null, mode: string | null, dark: boolean, url?: string | null): { id: string; mode: Mode } {
  const m: Mode = mode === 'day' || mode === 'night' ? mode : skin === 'ink' || dark ? 'night' : 'day'
  const known = (id?: string | null) => SKINS.some(s => s.id === id) ? id! : undefined
  return { id: known(url) ?? known(skin) ?? orbit.id, mode: m }
}
