import type { ReportAction } from './types'

// A report suggests a dozen; follow-ups filed into it (## Added) bring their own.
export const MAX_ACTIONS = 36
const areas = new Set(['mac', 'dev', 'kit', 'other', 'project'])
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '')

/** Parses action bullets from every Actions section in a research report. */
export function parseActions(markdown: string): ReportAction[] {
  const lines = markdown.split(/\r?\n/)
  const actions: ReportAction[] = []
  const seen = new Set<string>()
  let section = 0, fenced = false
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue }
    if (fenced) continue
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (heading) {
      const level = heading[1].length
      if (section && level <= section) section = 0
      if (/^actions\s*$/i.test(heading[2])) section = level
      continue
    }
    if (section && actions.length && /^\s+Undo:\s*/i.test(line)) {
      actions[actions.length - 1].undo = line.replace(/^\s+Undo:\s*/i, '').replace(/\s*\[\d+\]/g, '').replace(/\s+/g, ' ').trim() || undefined
      continue
    }
    if (!section || actions.length >= MAX_ACTIONS) continue
    const bullet = line.match(/^\s*(?:[-*]|\d+[.)])\s+\[(.*?)\]\s+(.+)$/)
    if (!bullet) continue
    const bits = bullet[1].split(/[\s,]+/).filter(Boolean).map(s => s.toLowerCase())
    const area = bits.find(s => areas.has(s)) as ReportAction['area'] | undefined
    if (!area) continue
    const titleMatch = bullet[2].match(/^\*\*(.+?)\*\*\s*:\s*(.*)$/) ?? bullet[2].match(/^\*\*(.+?):?\*\*\s*(.*)$/)
    if (!titleMatch) continue
    const title = titleMatch[1].trim()
    const key = slug(title)
    if (!key || seen.has(key)) continue
    seen.add(key)
    const body = titleMatch[2]
    const split = body.match(/(?:^|\s)Undo:\s*/i)
    const detailRaw = split ? body.slice(0, split.index).trim() : body.trim()
    const undoRaw = split ? body.slice(split.index! + split[0].length).trim() : undefined
    const cites = [...detailRaw.matchAll(/\[(\d+)\]/g)].map(m => Number(m[1]))
    const detail = detailRaw.replace(/\s*\[\d+\]/g, '').replace(/\s+/g, ' ').trim()
    actions.push({ key, area, ask: bits.includes('ask'), title, detail, undo: undoRaw?.replace(/\s*\[\d+\]/g, '').replace(/\s+/g, ' ').trim() || undefined, cites })
  }
  return actions
}

/** Separates changes to the report's project from device and shared work. */
export function splitActions(actions: ReportAction[]): { workbench: ReportAction[]; project: ReportAction[] } {
  return { workbench: actions.filter(a => a.area !== 'project'), project: actions.filter(a => a.area === 'project') }
}
