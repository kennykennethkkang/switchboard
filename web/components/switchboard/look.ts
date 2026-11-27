// Section heads read their look from tokens, so a layout can restyle them without touching each component.
export const panel = { border: '1px solid var(--hub-hair)', borderRadius: 'var(--hub-r-panel, 10px)', background: 'var(--hub-elev)', padding: 'var(--hub-pad-panel, 14px)', display: 'grid', gap: 10, alignContent: 'start', minWidth: 0 } as const
export const caps = { font: 'var(--hub-caps-font, 500 12px/1 var(--hub-mono))', color: 'var(--hub-caps-color, var(--hub-ash))', textTransform: 'var(--hub-caps-case, uppercase)' as 'uppercase', letterSpacing: 'var(--hub-caps-track, 0.4px)', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '4px 12px', margin: 0 } as const
/** A small field label (Today's rows, the receipt). */
export const label = { font: 'var(--hub-label-font, 500 12px/1.4 var(--hub-mono))', color: 'var(--hub-ash)', textTransform: 'var(--hub-label-case, uppercase)' as 'uppercase', letterSpacing: 'var(--hub-label-track, 0.4px)', margin: 0 } as const

export type Tone = 'red' | 'yellow' | 'green' | 'blue' | 'mute'
import { plainBlock } from '@/lib/approve'
/** The one status tone map: text color and chip tint per tone. Cards, chips and stat values read from here. */
export const toneOf = (t: Tone) => ({ color: `var(--hub-${t})`, soft: `color-mix(in srgb, var(--hub-${t}) 14%, transparent)` })
/** Reason text and element id for an Approve the extension holds back, so the button can point at it. */
export const heldText = (block: string, simple?: boolean) => `Can't approve yet: ${simple ? plainBlock(block) : block}.`
export const heldId = (sessionId: string) => `held-${sessionId}`
