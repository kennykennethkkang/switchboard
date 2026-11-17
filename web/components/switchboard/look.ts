// Section heads read their look from tokens, so a layout can restyle them without touching each component.
export const panel = { border: '1px solid var(--hub-hair)', borderRadius: 'var(--hub-r-panel, 10px)', background: 'var(--hub-elev)', padding: 'var(--hub-pad-panel, 14px)', display: 'grid', gap: 10, alignContent: 'start', minWidth: 0 } as const
export const caps = { font: 'var(--hub-caps-font, 500 12px/1 var(--hub-mono))', color: 'var(--hub-caps-color, var(--hub-ash))', textTransform: 'var(--hub-caps-case, uppercase)' as 'uppercase', letterSpacing: 'var(--hub-caps-track, 0.4px)', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '4px 12px', margin: 0 } as const
/** A small field label (Today's rows, the receipt). */
export const label = { font: 'var(--hub-label-font, 500 12px/1.4 var(--hub-mono))', color: 'var(--hub-ash)', textTransform: 'var(--hub-label-case, uppercase)' as 'uppercase', letterSpacing: 'var(--hub-label-track, 0.4px)', margin: 0 } as const
