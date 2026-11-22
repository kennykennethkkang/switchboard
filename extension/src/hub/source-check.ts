/**
 * Source-check runs for the Live page, read from ~/.claude/switchboard/source-check/<id>.json: the source-check CLI's --json
 * result, as is. A caller may add `at` (ISO), `done: false` while it still writes, and `report` (an html path); a sibling <id>.html also counts.
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { HubState } from './types'

type Run = NonNullable<HubState['sourceChecks']>[number]
type Band = Run['sources'][number]['band']

const DIR = path.join(os.homedir(), '.claude', 'switchboard', 'source-check')
// A run older than this is history; the report file stays on disk.
const FRESH_MS = 7 * 24 * 3600_000
const RUNS = 5, SOURCES = 12, REASONS = 4, REASON_LEN = 160
const BANDS: Band[] = ['Reliable', 'Mixed', 'Unreliable', 'Satire', 'Retracted', 'Unverifiable']

type Row = Record<string, unknown>
const obj = (v: unknown): Row => (v && typeof v === 'object' ? v as Row : {})
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const bandOf = (score: number): Band => (score >= 75 ? 'Reliable' : score >= 45 ? 'Mixed' : 'Unreliable')

// Adjustments first (they explain a cap), then flags, then what each signal added; a signal with no value says nothing.
function reasonsOf(s: Row): string[] {
  const list = (v: unknown) => (Array.isArray(v) ? v : [])
  const adjust = list(s.adjustments).map(a => text(obj(a).reason)).filter(r => r && !/^rounded/.test(r))
  const flags = list(s.flags).map(text).filter(Boolean)
  const signals = list(s.contributions).map(obj).filter(c => c.value != null && list(c.reasons).length && text(list(c.reasons)[0]))
    .sort((a, b) => Number(b.points) - Number(a.points)).map(c => `${text(c.label) || text(c.id)}: ${text(list(c.reasons)[0])}`)
  return [...adjust, ...flags, ...signals].slice(0, REASONS).map(r => r.slice(0, REASON_LEN))
}

function fromFile(file: string, mtime: number): Run | undefined {
  let j: Row
  try { j = obj(JSON.parse(fs.readFileSync(file, 'utf8'))) } catch { return undefined }
  const sources = (Array.isArray(j.sources) ? j.sources : []).map(obj).filter(s => text(s.url) && Number.isFinite(Number(s.score))).slice(0, SOURCES).map(s => {
    const score = Number(s.score), v = text(s.verdict) as Band
    return { url: text(s.url), band: BANDS.includes(v) ? v : bandOf(score), score, reasons: reasonsOf(s) }
  })
  if (!sources.length) return undefined
  const at = Date.parse(text(j.at)), report = text(j.report)
  return { id: path.basename(file, '.json'), question: text(j.question) || text(j.root) || sources[0].url, at: Number.isFinite(at) ? at : mtime, done: j.done !== false, sources, ...(report ? { report } : {}) }
}

// Parsed runs by file, kept until its mtime or size changes; the Live page asks every few seconds.
const cache = new Map<string, { stamp: string; run?: Run }>()

/** The newest runs within a week, newest first; undefined when there are none. */
export function sourceChecks(dir = DIR, now = Date.now()): Run[] | undefined {
  let names: string[] = []
  try { names = fs.readdirSync(dir).filter(f => f.endsWith('.json')) } catch { return undefined }
  const runs: Run[] = []
  for (const f of names) {
    const file = path.join(dir, f)
    try {
      const st = fs.statSync(file), stamp = `${st.mtimeMs}:${st.size}`
      let hit = cache.get(file)
      if (hit?.stamp !== stamp) {
        if (cache.size > 60) cache.clear()
        hit = { stamp, run: fromFile(file, st.mtimeMs) }
        cache.set(file, hit)
      }
      if (!hit.run || now - hit.run.at > FRESH_MS) continue
      // The html lands after the json, so it is looked up each time, not cached.
      const html = path.join(dir, `${hit.run.id}.html`)
      runs.push(hit.run.report || !fs.existsSync(html) ? hit.run : { ...hit.run, report: html })
    } catch { /* a file that vanished mid-read */ }
  }
  return runs.length ? runs.sort((a, b) => b.at - a.at).slice(0, RUNS) : undefined
}
