/**
 * Jev per project: which jobs Set up Jev turned on (claude-x-jev's jev-project.mjs), the newest runs and their cost.
 * Presets are <project>-<job>.json in ~/.claude/jev-presets; the hooks sit in the repo's .claude/settings.local.json.
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { projectName, repoTop } from './projects'
import type { JevProject } from './types'

const PRESETS = path.join(os.homedir(), '.claude', 'jev-presets')
const LIVE = path.join(os.homedir(), '.claude', 'switchboard', 'jev')
const RUNS = 5
// gate.jsonl only grows; its tail holds the newest decisions.
const GATE_TAIL = 256 * 1024

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
export const projectSlug = (cwd: string) => slug(projectName(cwd))

/** The project's own preset for a job, when Set up Jev made one. */
export function presetFor(cwd: string, job: string, dir = PRESETS): string | undefined {
  const f = path.join(dir, `${projectSlug(cwd)}-${job}.json`)
  return fs.existsSync(f) ? f : undefined
}

const lines = (text: string) => text.split('\n').flatMap(l => { try { return [JSON.parse(l) as Record<string, unknown>] } catch { return [] } })
const read = (f: string) => { try { return fs.readFileSync(f, 'utf8') } catch { return '' } }
function tail(f: string): string {
  try {
    const size = fs.statSync(f).size, fd = fs.openSync(f, 'r')
    try { const n = Math.min(size, GATE_TAIL), b = Buffer.alloc(n); fs.readSync(fd, b, 0, n, size - n); return b.toString('utf8') } finally { fs.closeSync(fd) }
  } catch { return '' }
}

export function jevProject(folder: string, presets = PRESETS, live = LIVE): JevProject {
  const project = projectSlug(folder)
  const has = (kind: string) => fs.existsSync(path.join(presets, `${project}-${kind}.json`))
  const top = repoTop(folder) ?? folder
  let hooks: Record<string, Array<{ hooks?: Array<{ command?: unknown }> }>> = {}
  try { hooks = JSON.parse(read(path.join(top, '.claude', 'settings.local.json')) || '{}').hooks ?? {} } catch { /* unreadable: hooks off */ }
  const hooked = (event: string, sub: string) => (hooks[event] ?? []).some(e => (e.hooks ?? []).some(h => String(h.command ?? '').includes(`jev-project.mjs" ${sub}`)))
  const jobs = { done: has('done'), gate: has('gate') && hooked('PreToolUse', 'guard'), tells: has('tells') && hooked('Stop', 'tells'), route: has('route') }
  const mine = (preset: unknown) => typeof preset === 'string' && preset.startsWith(`${project}-`) ? preset.slice(project.length + 1) : undefined
  const runs: JevProject['runs'] = []
  let files: string[] = []
  try { files = fs.readdirSync(live).filter(f => f.endsWith('.jsonl') && f !== 'gate.jsonl' && f !== 'corrections.jsonl') } catch { /* no runs yet */ }
  for (const f of files) {
    const rows = lines(read(path.join(live, f)))
    const start = rows.find(r => r.t === 'start'), end = rows.find(r => r.t === 'end')
    const job = mine(start?.preset)
    if (!job || !start) continue
    const flagged = Number(end?.flagged ?? 0)
    runs.push({ job, at: Number(start.at ?? 0), items: Number(start.items ?? 0), costUsd: Number(end?.cost ?? 0), ...(flagged ? { result: `${flagged} flagged` } : {}) })
  }
  for (const r of lines(tail(path.join(live, 'gate.jsonl')))) {
    const job = mine(r.preset)
    if (job) runs.push({ job, at: Number(r.at ?? 0), items: 1, costUsd: Number(r.cost ?? 0), result: String(r.decision ?? '') })
  }
  runs.sort((a, b) => b.at - a.at)
  return { project, jobs, runs: runs.slice(0, RUNS), costUsd: runs.reduce((s, r) => s + r.costUsd, 0) }
}

