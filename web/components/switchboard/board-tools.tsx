'use client'
import React from 'react'
// Board tool belt: one pixel item per Switchboard action. Items without a callback are left out.
import type { HubState } from '../../lib/hub-types'
import { limitMeters } from '../../lib/limits'
import { SKINS, type BeltId, type Chrome, type CourtColors, type Skin } from '../../lib/skins'
import './board-tools.css'

// usage: both windows spelled out, for the Usage item's name and title.
// todoAll: open to-do across every project; the todo badge counts this project's only.
export type BeltCounts = Partial<Record<BeltId, number | string>> & { usage?: string; todoAll?: number }

const ORDER: BeltId[] = ['new', 'next', 'todo', 'limits', 'changes', 'mode']
// short: under the sprite; label: the accessible name.
const PLAIN: Record<BeltId, { short: string; label: string }> = {
  new: { short: 'New', label: 'New chat' },
  next: { short: 'Next', label: 'Next chat that needs you' },
  todo: { short: 'To-do', label: 'To-do' },
  limits: { short: 'Usage', label: 'Usage and limits' },
  changes: { short: 'Commit', label: 'Changes and commit' },
  mode: { short: 'Day', label: 'Night mode' },
}
const COUNT_WORD: Partial<Record<BeltId, string>> = { next: 'waiting', todo: 'open', limits: 'used', changes: 'files' }

// 12x12, one char per pixel; '.' is clear.
const INK: Record<string, keyof CourtColors> = {
  y: 'gold_lt', g: 'gold', G: 'gold_dk', r: 'red', R: 'red_dk', w: 'cloud', s: 'cloud_sh', k: 'ink2', b: 'brown', B: 'brown_dk',
  j: 'jade', J: 'jade_dk', p: 'peach', P: 'peach_dk', q: 'peach_lt', u: 'blue_lt', U: 'blue', l: 'jade_lt',
}
const SPRITE: Record<BeltId | 'moon' | 'skin', string[]> = {
  new: ['..........yg', '.........ygG', '........rrG.', '.......rrR..', '......rrR...', '.....rrR....', '....rrR.....', '...rrR......', '..rrR.......', '.ygG........', 'ygG.........', 'gG..........'],
  next: ['............', '...www......', '..wwwww.ww..', '.wwsswwwwww.', 'wwswwwsswwww', 'wwwwwwwwwsww', '.wwsssswwww.', '..wwwwwwss..', '...ss..ss...', '........ss..', '.........s..', '............'],
  todo: ['............', 'BbbbbbbbbbbB', '.wwwwwwwwww.', '.wkkkwkkkkw.', '.wwwwwwwwww.', '.wkkwkkkkkw.', '.wwwwwwwwww.', '.wkkkkkwkkw.', '.wwwwwwwwww.', 'BbbbbbbbbbbB', '.r........r.', '.r........r.'],
  limits: ['.....BB.....', '.....bb.....', '....gggg....', '...ggyggg...', '...ggggGg...', '....rrrr....', '..ggggggGG..', '.ggyggggggG.', '.gyggggggGG.', '.ggggggggGG.', '..ggggggGG..', '...GGGGGG...'],
  changes: ['............', '............', '...pp..jj...', '..pppp.jjj..', 'gggggggggggg', 'GbbbbbbbbbbG', '.bbbbbbbbbB.', '.bbbbbbbbBB.', '..bbbbbbBB..', '...BBBBBB...', '....GGGG....', '............'],
  // Sun by day, moon by night.
  mode: ['.....yy.....', '.y........y.', '..y......y..', '....gggg....', '...gyyggG...', 'yy.gygggG.yy', 'yy.ggggGG.yy', '...gggGGG...', '....GGGG....', '..y......y..', '.y........y.', '.....yy.....'],
  // Theme switch: one half gold, one half sea.
  skin: ['.....gu.....', '....ggUu....', '...gggUuu...', '..ggggUuuu..', '.gggggUuuuu.', 'gyggggUuuuuu', 'ggggggUuulul', '.gggggUuuuu.', '..ggggUuuu..', '...gggUuu...', '....ggUu....', '.....gU.....'],
  moon: ['.....www....', '...wwss...y.', '..wws.......', '.wws........', '.ws.......y.', 'wwws........', 'wwws........', '.ws.....y...', '.wws........', '..wws.......', '...wwss.....', '.....www....'],
}

/** Board label look when a skin sets no chrome: the dark plates in the pixel font. */
export const DEFAULT_CHROME: Chrome = { plate: 'rgba(16,17,17,.94)', edge: 'rgba(255,255,255,.14)', text: '#f4f1ea', mute: '#a29cae', font: 'Silkscreen, ui-monospace, monospace', radius: 4 }
export const chromeOf = (skin: Skin): Chrome => skin.chrome ?? DEFAULT_CHROME

/** Closed button and tip name: a family look reads as its family and preset. */
export const skinLabel = (s: Skin) => s.family ? `${s.family.name}: ${s.family.preset}` : s.name
/** Picker rows in belt order; swatch: the colors the menu previews; family: the group a row sits in. */
export const themeList = (id: string) => SKINS.map(s => ({ id: s.id, name: s.family?.preset ?? s.name, info: s.info, current: s.id === id, swatch: [s.palette.bg, s.palette.panel, s.palette.trim, s.palette.accent, s.palette.active, s.palette.warn], family: s.family && { id: s.family.id, name: s.family.name } }))
/** Rows in order, consecutive rows of one family share a group. */
export const themeGroups = (id: string) => {
  const out: { family?: { id: string; name: string }; rows: ReturnType<typeof themeList> }[] = []
  for (const r of themeList(id)) {
    const g = out[out.length - 1]
    if (r.family && g?.family?.id === r.family.id) g.rows.push(r)
    else out.push({ family: r.family, rows: [r] })
  }
  return out
}
/** Arrow move with wrap. */
export const stepTheme = (i: number, d: number, n = SKINS.length) => (i + d + n) % n

function Sprite({ id, skin }: { id: BeltId | 'moon' | 'skin'; skin: Skin }) {
  const c = skin.court.colors
  const svg = skin.belt.icons?.[id === 'moon' ? 'mode' : id]
  if (svg) return <svg className="bt-sprite bt-icon" viewBox="0 0 24 24" aria-hidden focusable="false" dangerouslySetInnerHTML={{ __html: svg }} />
  return (
    <svg className="bt-sprite" viewBox="0 0 12 12" aria-hidden focusable="false" shapeRendering="crispEdges">
      {(skin.belt.sprites?.[id as BeltId] || SPRITE[id]).flatMap((row, y) => [...row].map((ch, x) => ch === '.' ? null
        : <rect key={`${x}.${y}`} x={x} y={y} width={1} height={1} fill={c[INK[ch]]} />))}
    </svg>
  )
}

/** needs and the fullest usage window, from hub state; to-do and file counts live in Switchboard. */
export function beltCounts(hub: HubState, now = Date.now()): BeltCounts {
  const meters = limitMeters(hub.live, now, hub.limitsKept, hub.codexKept), pct = Math.max(-1, ...meters.map(m => m.percent ?? -1))
  const usage = meters.filter(m => m.percent !== undefined).map(m => `${m.label.toLowerCase()} ${m.level === 'out' ? 'out' : `${m.percent}%`}`).join(', ')
  return { next: hub.progress.filter(p => p.state === 'needs-you').length, ...(pct >= 0 && { limits: `${Math.round(pct)}%` }), ...(usage && { usage: `Usage: ${usage}` }) }
}

/** night: the mode item's pressed state; the item shows only for skins with a night look. theme: opens the skin menu after the mode item; pick switches to a skin. */
export function BoardTools({ skin, on, counts = {}, night = false, theme }: { skin: Skin; on: Partial<Record<BeltId, () => void>>; counts?: BeltCounts; night?: boolean; theme?: { pick: (id: string) => void } }) {
  const ids = ORDER.filter(id => on[id] && (id !== 'mode' || skin.night))
  if (!ids.length) return null
  return (
    <div role="group" aria-label={skin.belt.name} className="bt"
      style={{ '--bt-panel': skin.palette.panel, '--bt-trim': skin.palette.trim, '--bt-ink': skin.palette.ink, '--bt-hot': skin.palette.warn, '--bt-gold': skin.palette.accent, '--bt-font': skin.font } as React.CSSProperties}>
      {ids.map(id => {
        const { item, hint } = skin.belt.items[id], n = counts[id]
        // next with nobody waiting stays focusable so the tip still reads.
        const idle = id === 'next' && n === 0
        const hot = (id === 'next' && typeof n === 'number' && n > 0) || (id === 'limits' && typeof n === 'string' && parseInt(n) >= 90)
        const named = `${(id === 'limits' && counts.usage) || PLAIN[id].label}, ${item}`, moon = id === 'mode' && night
        const said = id === 'todo' && counts.todoAll !== undefined ? `, ${n ?? 0} here, ${counts.todoAll} in all projects` : n === undefined || (n === 0 && !idle) || (id === 'limits' && counts.usage) ? '' : `, ${n} ${COUNT_WORD[id] ?? ''}`.trimEnd()
        return (
          <button key={id} type="button" className="bt-item" data-id={id} data-hot={hot || undefined} aria-disabled={idle || undefined}
            aria-pressed={id === 'mode' ? night : undefined}
            aria-label={named + said} onClick={() => { if (!idle) on[id]!() }}>
            <Sprite id={moon ? 'moon' : id} skin={skin} />
            <span className="bt-short" aria-hidden>{moon ? 'Night' : PLAIN[id].short}</span>
            {n !== undefined && n !== 0 && <span className="bt-badge" aria-hidden>{n}</span>}
            <span className="bt-tip" aria-hidden>
              <b>{item}</b>
              <span>{idle ? 'Nobody needs you right now' : id === 'mode' ? (night ? 'Click to bring the day back' : 'Click to switch the court to night') : id === 'limits' && counts.usage ? counts.usage : id === 'todo' && counts.todoAll !== undefined ? `${n ?? 0} here, ${counts.todoAll} in all projects` : hint}</span>
            </span>
          </button>
        )
      })}
      {theme && <ThemeMenu skin={skin} pick={theme.pick} />}
    </div>
  )
}

function ThemeMenu({ skin, pick }: { skin: Skin; pick: (id: string) => void }) {
  const [open, setOpen] = React.useState(false), btn = React.useRef<HTMLButtonElement>(null), box = React.useRef<HTMLDivElement>(null)
  const rows = themeList(skin.id), cur = Math.max(0, rows.findIndex(r => r.current))
  const focusRow = (i: number) => box.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]')[i]?.focus()
  const close = (back = true) => { setOpen(false); if (back) btn.current?.focus() }
  React.useEffect(() => { if (open) focusRow(cur) }, [open])
  React.useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])
  const key = (e: React.KeyboardEvent) => {
    // Closed: let Esc reach the board dialog.
    if (!open) return
    const i = [...(box.current?.querySelectorAll('[role="menuitemradio"]') ?? [])].indexOf(document.activeElement as Element)
    const to = e.key === 'ArrowDown' ? stepTheme(i, 1) : e.key === 'ArrowUp' ? stepTheme(i, -1) : e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : -1
    if (to >= 0) { e.preventDefault(); focusRow(to) } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() } else if (e.key === 'Tab') close(false)
  }
  return (
    <div className="bt-theme" onKeyDown={key}>
      <button ref={btn} type="button" className="bt-item" data-id="skin" aria-haspopup="menu" aria-expanded={open} aria-label={`Theme: ${skinLabel(skin)}, choose a theme`} onClick={() => setOpen(o => !o)}
        onKeyDown={e => { if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); setOpen(true) } }}>
        <Sprite id="skin" skin={skin} />
        <span className="bt-short" aria-hidden>Theme</span>
        {!open && <span className="bt-tip" aria-hidden><b>{skinLabel(skin)}</b><span>Click to choose a theme</span></span>}
      </button>
      {open && <div ref={box} className="bt-menu" role="menu" aria-label="Theme">
        {themeGroups(skin.id).map(g => {
          const option = (r: (typeof rows)[number]) => (
            <button key={r.id} type="button" role="menuitemradio" aria-checked={r.current} className="bt-opt" tabIndex={-1} onClick={() => { pick(r.id); close() }}>
              <span className="bt-opt-name">{r.name}<i aria-hidden>{r.current ? '\u2713' : ''}</i></span>
              <span className="bt-opt-info">{r.info}</span>
              <span className="bt-swatch" aria-hidden>{r.swatch.map((c, i) => <b key={i} style={{ background: c }} />)}</span>
            </button>
          )
          if (!g.family) return <React.Fragment key={g.rows[0].id}>{g.rows.map(option)}</React.Fragment>
          const head = `bt-fam-${g.family.id}`
          return (
            <div key={head} role="group" aria-labelledby={head} className="bt-fam">
              <div className="bt-fam-head"><b id={head}>{g.family.name}</b><span>Same cast, two looks</span></div>
              {g.rows.map(option)}
            </div>
          )
        })}
      </div>}
    </div>
  )
}
