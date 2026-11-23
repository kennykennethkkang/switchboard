/** Each VS Code window's color, by folder, kept in ~/.claude/switchboard/colors.json. The panel picks the theme's shade by key. */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { WindowColor } from './types'
import { withLock } from '../fs-utils'
import { isResearch } from './research'

export const PALETTE: WindowColor[] = ['violet', 'amber', 'teal', 'rose', 'lime', 'cobalt']
const FILE = path.join(os.homedir(), '.claude', 'switchboard', 'colors.json')

/** Status bar text on light and dark themes, the same shades as the panel's --hub-w-* tokens. Title bar: dark tints, active then inactive. */
export const SHADES: Record<WindowColor, { light: string; dark: string; bar: [string, string] }> = {
  violet: { light: '#6a4cd0', dark: '#a08bff', bar: ['#3a2d6e', '#2d2647'] },
  amber: { light: '#b26b00', dark: '#f2b24c', bar: ['#5a3c0a', '#3d2e15'] },
  teal: { light: '#0b8a87', dark: '#4fd1c9', bar: ['#0f4645', '#173332'] },
  rose: { light: '#b8306f', dark: '#ff7ab3', bar: ['#5c2140', '#3e2030'] },
  lime: { light: '#4a7d12', dark: '#9bd65a', bar: ['#2f4614', '#27331a'] },
  cobalt: { light: '#2f5fd0', dark: '#7ea2ff', bar: ['#1f3566', '#1f2a43'] },
  // The Research window only, so it never looks like a project.
  slate: { light: '#5b6474', dark: '#9aa4b5', bar: ['#2a2f38', '#23272e'] },
}

/**
 * A saved folder keeps its color unless an earlier live window already has it and a free one exists; a new folder gets the
 * first color no other live window has, wrapping when all are taken.
 */
export function assignColors(saved: Record<string, WindowColor>, live: string[], research: (ws: string) => boolean = isResearch): { colors: Record<string, WindowColor>; changed: boolean } {
  const colors = { ...saved }
  let changed = false
  const kept = new Set<WindowColor>()
  for (const ws of live.filter(w => research(w))) colors[ws] = 'slate'
  for (const ws of live.filter(w => !research(w))) {
    const c = colors[ws]
    if (c && !kept.has(c)) { kept.add(c); continue }
    const used = new Set([...kept, ...live.map(w => colors[w]).filter(Boolean)])
    const free = PALETTE.find(p => !used.has(p))
    if (c && !free) continue // every color taken: a clash can't be helped
    colors[ws] = free ?? PALETTE[used.size % PALETTE.length]
    kept.add(colors[ws])
    changed = true
  }
  return { colors, changed }
}

/** Reads the colors file, gives each live folder one and writes it back when that added any. */
function readColors(file: string): Record<string, WindowColor> {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (v && typeof v === 'object' && !Array.isArray(v)) return Object.fromEntries(Object.entries(v).filter(([, c]) => PALETTE.includes(c as WindowColor))) as Record<string, WindowColor>
  } catch { /* none yet, or broken: start over */ }
  return {}
}

export function windowColors(live: string[], file = FILE): Record<string, WindowColor> {
  const first = assignColors(readColors(file), live)
  if (!first.changed) return first.colors
  // Read again under the lock: another window may have just added its folder.
  return withLock(`${file}.lock`, () => {
    const { colors, changed } = assignColors(readColors(file), live)
    if (changed) {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, JSON.stringify(colors, null, 2) + '\n', { mode: 0o600 })
      } catch { /* colors still show, just not kept */ }
    }
    return colors
  })
}

export const titleBarColors = (c: WindowColor): Record<string, string> => ({
  'titleBar.activeBackground': SHADES[c].bar[0],
  'titleBar.activeForeground': '#f4f4f6',
  'titleBar.inactiveBackground': SHADES[c].bar[1],
  'titleBar.inactiveForeground': '#f4f4f699',
})

type Colors = Record<string, unknown>

/**
 * workbench.colorCustomizations with Switchboard's title bar keys in it. A key is only written while absent or still what
 * Switchboard wrote (wrote); one it wrote that `want` lacks is removed. Undefined when nothing changes.
 */
export function titleBar(current: Colors | undefined, wrote: Record<string, string>, want: Record<string, string>): { next: Colors; wrote: Record<string, string> } | undefined {
  const next: Colors = { ...current }
  const mine: Record<string, string> = {}
  for (const k of new Set([...Object.keys(wrote), ...Object.keys(want)])) {
    const ours = next[k] === undefined || next[k] === wrote[k]
    if (!ours) continue
    if (want[k] === undefined) delete next[k]
    else { next[k] = want[k]; mine[k] = want[k] }
  }
  const same = JSON.stringify(next) === JSON.stringify({ ...current })
  return same && JSON.stringify(mine) === JSON.stringify(wrote) ? undefined : { next, wrote: mine }
}
