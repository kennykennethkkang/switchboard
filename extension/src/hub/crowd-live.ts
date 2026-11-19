/**
 * The newest crowd-ab run, read from the per-run files jev.py (and crowd-ab's haiku panel) write to ~/.claude/switchboard/jev.
 * Each persona rates every option alone; a persona counts once all its options are in.
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { CrowdLive, CrowdVote } from './types'

const LIVE = path.join(os.homedir(), '.claude', 'switchboard', 'jev')
// A run that stopped writing this long ago is history.
const FRESH_MS = 30 * 60_000
// No new rating for this long and no end row: the run died.
const STOPPED_MS = 5 * 60_000
const FEED = 12
const DISMISSED = 'dismissed.txt'
// Same tie rule as crowd-ab.mjs votesFromRatings.
const TIE = 0.15

type Row = Record<string, unknown>
const lines = (text: string): Row[] => text.split('\n').flatMap(l => { try { return [JSON.parse(l) as Row] } catch { return [] } })
// Parsed rows by file, kept until its mtime or size changes; a 1000 persona run is about 1.5 MB.
const cache = new Map<string, { stamp: string; rows: Row[] }>()
function parsed(file: string): Row[] {
  try {
    const st = fs.statSync(file), stamp = `${st.mtimeMs}:${st.size}`
    const hit = cache.get(file)
    if (hit?.stamp === stamp) return hit.rows
    const rows = lines(fs.readFileSync(file, 'utf8'))
    if (cache.size > 40) cache.clear()
    cache.set(file, { stamp, rows })
    return rows
  } catch { return [] }
}
const isCrowd = (start: Row) => {
  const display = Array.isArray(start.display) ? start.display : []
  return start.preset === 'crowd-ab' || (display.includes('o') && display.includes('patience'))
}
const show = (r: Row) => (r.show && typeof r.show === 'object' ? r.show : {}) as Record<string, string>
const labelOf = (s: Record<string, string>) => s.label || (s.o !== undefined ? `Option ${String.fromCharCode(65 + Number(s.o))}` : '?')
const whoOf = (s: Record<string, string>) => [s.age, s.device, s.access && s.access !== 'none' ? s.access : ''].filter(Boolean).join(', ')

// Lines of `run lastAt dismissedAt`; a run is hidden until it has newer rows, and a line is dropped after a day.
const dismissals = (dir: string): Map<string, number> => {
  const file = path.join(dir, DISMISSED)
  let text = ''
  try { text = fs.readFileSync(file, 'utf8') } catch { return new Map() }
  const keep = text.split('\n').filter(l => { const [run, , at] = l.split(' '); return run && Date.now() - Number(at) < 24 * 3600_000 })
  if (keep.length !== text.split('\n').filter(Boolean).length) try { fs.writeFileSync(file, keep.map(l => `${l}\n`).join('')) } catch { /* next read prunes */ }
  return new Map(keep.map(l => { const [run, last] = l.split(' '); return [run, Number(last)] as const }))
}
/** Hides a run from the card until new rows arrive; lastAt is the newest row it had. */
export function dismissCrowd(run: string, dir = LIVE, lastAt = crowdLive(dir)?.lastAt ?? 0): void {
  try { fs.mkdirSync(dir, { recursive: true }); fs.appendFileSync(path.join(dir, DISMISSED), `${run} ${lastAt} ${Date.now()}\n`) } catch { /* stays on the card */ }
}

export function crowdLive(dir = LIVE, now = Date.now()): CrowdLive | undefined {
  let files: string[] = []
  try { files = fs.readdirSync(dir).filter(f => /^\d+-\d+\.jsonl$/.test(f)).sort((a, b) => parseInt(b) - parseInt(a)) } catch { return undefined }
  // Newest crowd-ab run plus any crowd-ab runs started just before it (the pilot).
  const runs: { start: Row; rows: Row[]; end?: Row; call?: string }[] = []
  let pending = 0
  for (const f of files.slice(0, 12)) {
    const rows = parsed(path.join(dir, f)), start = rows.find(r => r.t === 'start')
    if (!start || !isCrowd(start)) { if (runs.length) break; continue }
    const end = rows.find(r => r.t === 'end')
    // A run with no rows yet is the main run just after its pilot: count it and keep reading back.
    if (!runs.length && !rows.some(r => r.t === 'd')) { pending += Number(start.items ?? 0); continue }
    // crowd-ab tags every item with its call id; untagged runs (older crowd-ab) stand alone.
    const call = show(rows.find(r => r.t === 'd') ?? {}).call
    if (runs.length && (!call || call !== runs[0].call)) break
    runs.push({ start, rows: rows.filter(r => r.t === 'd'), call, ...(end ? { end } : {}) })
  }
  if (!runs.length) return undefined
  const newest = runs[0], oldest = runs[runs.length - 1]
  const rows = runs.flatMap(r => r.rows).sort((a, b) => Number(a.at) - Number(b.at))
  const lastAt = Number(newest.end?.at ?? rows[rows.length - 1]?.at ?? newest.start.at)
  if (now - lastAt > FRESH_MS) return undefined
  const hidden = dismissals(dir).get(String(oldest.start.run ?? ''))
  if (hidden !== undefined && lastAt <= hidden) return undefined

  const counts = new Map<string, number>()
  let noPreference = 0
  // Panel rows carry the pick; Jev rows carry one appeal score per option.
  const byPersona = new Map<string, Row[]>()
  for (const r of rows) {
    const s = show(r)
    if (typeof r.pick === 'string') {
      if (r.pick === 'none') noPreference++
      else counts.set(r.pick, (counts.get(r.pick) ?? 0) + 1)
    } else if (typeof r.appeal === 'number' && s.p !== undefined) {
      const list = byPersona.get(s.p) ?? []
      list.push(r)
      byPersona.set(s.p, list)
      if (!counts.has(labelOf(s))) counts.set(labelOf(s), 0)
    }
  }
  const k = Math.max(0, ...[...byPersona.values()].map(l => new Set(l.map(r => show(r).o)).size))
  for (const list of byPersona.values()) {
    if (k < 2 || new Set(list.map(r => show(r).o)).size < k) continue
    const [a, b] = [...list].sort((x, y) => Number(y.appeal) - Number(x.appeal))
    if (Number(a.appeal) - Number(b.appeal) < TIE) noPreference++
    else counts.set(labelOf(show(a)), (counts.get(labelOf(show(a))) ?? 0) + 1)
  }

  const feed: CrowdVote[] = rows.slice(-FEED).reverse().map(r => {
    const s = show(r)
    return {
      at: Number(r.at), who: whoOf(s) || 'persona', option: typeof r.pick === 'string' ? (r.pick === 'none' ? 'no preference' : r.pick) : labelOf(s),
      ...(typeof r.appeal === 'number' ? { appeal: r.appeal } : {}),
      ...(typeof r.reason === 'string' ? { reason: r.reason } : {}),
      ...(typeof r.why === 'string' && r.why ? { why: r.why.slice(0, 160) } : {}),
    }
  })
  return {
    run: String(oldest.start.run ?? ''), startedAt: Number(oldest.start.at), lastAt,
    items: pending + runs.reduce((n, r) => n + Number(r.start.items ?? 0), 0), done: rows.length, ended: !pending && !!newest.end,
    ...(!newest.end && now - lastAt > STOPPED_MS ? { stopped: true } : {}),
    votes: [...counts].map(([label, n]) => ({ label, n })).sort((a, b) => a.label.localeCompare(b.label)), noPreference, feed,
  }
}
