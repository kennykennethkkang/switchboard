import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { PipelineInfo } from './types'

const root = () => path.join(os.homedir(), '.claude', 'switchboard', 'pipelines')
const plain = (s: string) => !!s && s !== '.' && s !== '..' && !/[\\/]/.test(s)
const rows = (f: string): { status?: string }[] => { try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); return Array.isArray(j) ? j : [] } catch { return [] } }
const stageDirs = (dir: string) => fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name)

/** Copies <cwd>/.switchboard/stages/<run>/ stages.json and each CONTEXT.md (no outputs) to ~/.claude/switchboard/pipelines/<slug>/. */
export function savePipeline(cwd: string, run: string, name: string): PipelineInfo {
  if (!plain(run)) throw new Error(`${run} is not a stage run`)
  const src = path.join(cwd, '.switchboard', 'stages', run)
  const stages = rows(path.join(src, 'stages.json'))
  if (!stages.length) throw new Error(`${run} has no readable stages.json`)
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50)
  if (!slug) throw new Error('give the pipeline a name')
  const dest = path.join(root(), slug)
  const tmp = `${dest}.tmp-${process.pid}-${Date.now()}`
  const info: PipelineInfo = { slug, name, stages: stages.length, savedAt: Date.now() }
  try {
    fs.mkdirSync(tmp, { recursive: true })
    fs.copyFileSync(path.join(src, 'stages.json'), path.join(tmp, 'stages.json'))
    for (const d of stageDirs(src)) {
      const ctx = path.join(src, d, 'CONTEXT.md')
      if (!fs.existsSync(ctx)) continue
      fs.mkdirSync(path.join(tmp, d), { recursive: true })
      fs.copyFileSync(ctx, path.join(tmp, d, 'CONTEXT.md'))
    }
    fs.writeFileSync(path.join(tmp, 'pipeline.json'), JSON.stringify(info))
    fs.rmSync(dest, { recursive: true, force: true })
    fs.renameSync(tmp, dest)
  } catch (err) {
    fs.rmSync(tmp, { recursive: true, force: true })
    throw err
  }
  return info
}

/** Every saved pipeline, newest first. */
export function listPipelines(): PipelineInfo[] {
  let slugs: string[] = []
  try { slugs = fs.readdirSync(root()) } catch { return [] }
  const out: PipelineInfo[] = []
  for (const slug of slugs) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(root(), slug, 'pipeline.json'), 'utf8'))
      if (typeof m.name === 'string' && typeof m.stages === 'number' && typeof m.savedAt === 'number') out.push({ slug, name: m.name, stages: m.stages, savedAt: m.savedAt })
    } catch { /* not a pipeline */ }
  }
  return out.sort((a, b) => b.savedAt - a.savedAt)
}

/** Seeds <cwd>/.switchboard/stages/<runId>/ from a saved pipeline with every status reset to todo; returns the run folder. */
export function seedPipeline(slug: string, cwd: string, runId: string): string {
  if (!plain(slug) || !plain(runId)) throw new Error('bad pipeline or run name')
  const src = path.join(root(), slug)
  const stages = rows(path.join(src, 'stages.json'))
  if (!stages.length) throw new Error(`no pipeline ${slug}`)
  const dest = path.join(cwd, '.switchboard', 'stages', runId)
  if (fs.existsSync(dest)) throw new Error(`${runId} already exists`)
  fs.mkdirSync(dest, { recursive: true })
  fs.writeFileSync(path.join(dest, 'stages.json'), `${JSON.stringify(stages.map(s => ({ ...s, status: 'todo' })), null, 2)}\n`)
  for (const d of stageDirs(src)) {
    fs.mkdirSync(path.join(dest, d, 'output'), { recursive: true })
    fs.copyFileSync(path.join(src, d, 'CONTEXT.md'), path.join(dest, d, 'CONTEXT.md'))
  }
  fs.writeFileSync(path.join(dest, '.seeded'), String(Date.now()))
  return dest
}

/** The first-prompt line for a chat started right after a seed: names the seeded run and drops its marker. Empty when none is fresh (5 min). */
export function takeSeeded(cwd: string, now = Date.now()): string {
  const root = path.join(cwd, '.switchboard', 'stages')
  let names: string[] = []
  try { names = fs.readdirSync(root) } catch { return '' }
  for (const run of names) {
    const mark = path.join(root, run, '.seeded')
    const at = Number(fs.existsSync(mark) ? fs.readFileSync(mark, 'utf8') : 0)
    if (!at || now - at > 5 * 60_000) continue
    fs.rmSync(mark)
    return `A saved pipeline seeded .switchboard/stages/${run}/ (stages.json and a CONTEXT.md per stage, every status todo). Run it with the stages skill.`
  }
  return ''
}
