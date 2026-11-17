import { journeyWest } from './journey-west'

/** palette.panel, trim: the tool belt's plate and border. court: colors for islands, halls, desks and sprites; bands: the sky, top to bottom. */
export type Look = {
  palette: { bg: string; ink: string; accent: string; active: string; done: string; warn: string; panel: string; trim: string }
  court: { colors: CourtColors; bands: string[] }
}
/** The top-level look is day; night is optional, only skins that keep night hours have one. */
export type Skin = Look & {
  id: string; name: string; info: string
  copy: { title: string; empty: string; done: string }
  font: string
  night?: Look
  /** Tool belt: an item name and hint per action. */
  belt: { name: string; items: Record<BeltId, { item: string; hint: string }> }
}
export type Mode = 'day' | 'night'
export type BeltId = 'new' | 'next' | 'todo' | 'limits' | 'changes' | 'mode'
export type CourtColors = Record<'ink' | 'ink2' | 'red_dk' | 'red' | 'red_lt' | 'gold_dk' | 'gold' | 'gold_lt' | 'jade_dk' | 'jade' | 'jade_lt' | 'peach_dk' | 'peach' | 'peach_lt'
  | 'cloud' | 'cloud_sh' | 'blue' | 'blue_lt' | 'sky' | 'brown_dk' | 'brown' | 'skin' | 'plum' | 'wood_dk' | 'wood' | 'wood_lt' | 'rail'
  | 'stone_dk' | 'stone' | 'stone_ln' | 'hall' | 'beam' | 'roof' | 'roof_dk' | 'roof_lt' | 'azure' | 'azure_dk' | 'azure_lt', string>

export { journeyWest }
export const SKIN_KEY = 'switchboard.boardSkin'
export const MODE_KEY = 'switchboard.boardMode'
/** The skin with its night palette swapped in; day when the skin has no night. */
export const lookOf = (skin: Skin, mode: Mode): Skin => mode === 'night' && skin.night ? { ...skin, ...skin.night } : skin

/** Stored picks to a skin and mode. 'ink' was the old night skin; an unset mode follows the system. */
export function readPick(skin: string | null, mode: string | null, dark: boolean): { id: string; mode: Mode } {
  const m: Mode = mode === 'day' || mode === 'night' ? mode : skin === 'ink' || dark ? 'night' : 'day'
  return { id: journeyWest.id, mode: m }
}
