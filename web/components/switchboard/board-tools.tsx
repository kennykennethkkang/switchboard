'use client'
import React from 'react'
// Board tool belt: one pixel item per Switchboard action. Items without a callback are left out.
import type { HubState } from '../../lib/hub-types'
import { limitMeters } from '../../lib/limits'
import type { BeltId, CourtColors, Skin } from '../../lib/skins'
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
  j: 'jade', J: 'jade_dk', p: 'peach', P: 'peach_dk', q: 'peach_lt',
}
const SPRITE: Record<BeltId | 'moon', string[]> = {
  new: ['..........yg', '.........ygG', '........rrG.', '.......rrR..', '......rrR...', '.....rrR....', '....rrR.....', '...rrR......', '..rrR.......', '.ygG........', 'ygG.........', 'gG..........'],
  next: ['............', '...www......', '..wwwww.ww..', '.wwsswwwwww.', 'wwswwwsswwww', 'wwwwwwwwwsww', '.wwsssswwww.', '..wwwwwwss..', '...ss..ss...', '........ss..', '.........s..', '............'],
  todo: ['............', 'BbbbbbbbbbbB', '.wwwwwwwwww.', '.wkkkwkkkkw.', '.wwwwwwwwww.', '.wkkwkkkkkw.', '.wwwwwwwwww.', '.wkkkkkwkkw.', '.wwwwwwwwww.', 'BbbbbbbbbbbB', '.r........r.', '.r........r.'],
  limits: ['.....BB.....', '.....bb.....', '....gggg....', '...ggyggg...', '...ggggGg...', '....rrrr....', '..ggggggGG..', '.ggyggggggG.', '.gyggggggGG.', '.ggggggggGG.', '..ggggggGG..', '...GGGGGG...'],
  changes: ['............', '............', '...pp..jj...', '..pppp.jjj..', 'gggggggggggg', 'GbbbbbbbbbbG', '.bbbbbbbbbB.', '.bbbbbbbbBB.', '..bbbbbbBB..', '...BBBBBB...', '....GGGG....', '............'],
  // Sun by day, moon by night.
  mode: ['.....yy.....', '.y........y.', '..y......y..', '....gggg....', '...gyyggG...', 'yy.gygggG.yy', 'yy.ggggGG.yy', '...gggGGG...', '....GGGG....', '..y......y..', '.y........y.', '.....yy.....'],
  moon: ['.....www....', '...wwss...y.', '..wws.......', '.wws........', '.ws.......y.', 'wwws........', 'wwws........', '.ws.....y...', '.wws........', '..wws.......', '...wwss.....', '.....www....'],
}

function Sprite({ id, skin }: { id: BeltId | 'moon'; skin: Skin }) {
  const c = skin.court.colors
  return (
    <svg className="bt-sprite" viewBox="0 0 12 12" aria-hidden focusable="false" shapeRendering="crispEdges">
      {SPRITE[id].flatMap((row, y) => [...row].map((ch, x) => ch === '.' ? null
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

/** night: the mode item's pressed state; the item shows only for skins with a night look. */
export function BoardTools({ skin, on, counts = {}, night = false }: { skin: Skin; on: Partial<Record<BeltId, () => void>>; counts?: BeltCounts; night?: boolean }) {
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
    </div>
  )
}
