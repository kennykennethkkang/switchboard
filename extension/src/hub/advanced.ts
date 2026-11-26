/** Advanced mode and smart model switch: company.json for the mods, the .switchboard folder, its stage runs and model-learn escalations. */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { readJsonOr, writeJsonAtomic } from '../fs-utils'
import type { Escalation, Stage, StageRun } from './types'

const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** usage-meter reads both from company.json; other keys there are left as they are. coderView unset drops the key; codexFirst is written only when off. */
export function writeCompany(file: string, s: { smartModelSwitch: boolean; advancedMode: Record<string, boolean>; coderView?: boolean; codexFirst?: boolean }): void {
  const was = readJsonOr(file)
  const { coderView: _old, codexFirst: _was, ...rest } = obj(was) ? was : {}
  writeJsonAtomic(file, { ...rest, smartModelSwitch: s.smartModelSwitch, advancedMode: s.advancedMode, ...(s.codexFirst === false ? { codexFirst: false } : {}), ...(s.coderView === undefined ? {} : { coderView: s.coderView }) })
}

/** Makes <project>/.switchboard and keeps it out of git through .git/info/exclude. */
export function keepSwitchboardDir(project: string): void {
  fs.mkdirSync(path.join(project, '.switchboard'), { recursive: true })
  excludeSwitchboard(project)
}

/** The exclude line alone, for every repo a chat may work in (chat notes and stage runs live there). */
export const excludeSwitchboard = (project: string) => excludeLine(project, '.switchboard')

/** Own-worktree chats live in <project>/.claude/worktrees; keep them out of git too. */
export const excludeWorktrees = (project: string) => excludeLine(project, '.claude/worktrees')

function excludeLine(project: string, line: string): void {
  const git = path.join(project, '.git')
  const st = fs.statSync(git, { throwIfNoEntry: false })
  if (!st) return
  let exclude = path.join(git, 'info', 'exclude')
  // A worktree's .git is a file; git knows where its exclude lives.
  if (!st.isDirectory()) {
    const r = spawnSync('git', ['rev-parse', '--git-path', 'info/exclude'], { cwd: project, encoding: 'utf8', timeout: 10_000 })
    if (r.status !== 0 || !r.stdout.trim()) return
    exclude = path.resolve(project, r.stdout.trim())
  }
  let text = ''
  try { text = fs.readFileSync(exclude, 'utf8') } catch { /* none yet */ }
  if (text.split('\n').some(l => [line, `${line}/`, `/${line}`, `/${line}/`].includes(l.trim()))) return
  fs.mkdirSync(path.dirname(exclude), { recursive: true })
  fs.writeFileSync(exclude, `${text}${text && !text.endsWith('\n') ? '\n' : ''}${line}/\n`)
}

const STATUS = new Set(['todo', 'doing', 'done', 'redo'])
const isStage = (s: unknown): s is Stage => obj(s) && typeof s.n === 'number' && typeof s.name === 'string' && typeof s.role === 'string' && STATUS.has(s.status as string)

/** The newest run per chat whose id is in a run folder's name; with none named, the newest run. Broken files are skipped. */
export function readStages(project: string, chatIds: string[]): StageRun[] {
  const root = path.join(project, '.switchboard', 'stages')
  let names: string[] = []
  try { names = fs.readdirSync(root) } catch { return [] }
  const runs = names.flatMap(run => {
    const f = path.join(root, run, 'stages.json')
    const rows = readJsonOr(f)
    if (!Array.isArray(rows)) return []
    return [{ run, at: fs.statSync(f).mtimeMs, stages: rows.filter(isStage).map(({ n, name, role, status }) => ({ n, name, role, status })) }]
  }).sort((a, b) => b.at - a.at)
  const mine = chatIds.flatMap(id => { const r = runs.find(x => x.run.includes(id)); return r ? [{ ...r, sessionId: id }] : [] })
  return mine.length ? mine : runs.slice(0, 1)
}

/** model-learn.json rows by project; bad rows are dropped. */
export function escalationsByProject(file: string): Record<string, Escalation[]> {
  const rows = readJsonOr(file)
  const out: Record<string, Escalation[]> = {}
  if (!Array.isArray(rows)) return out
  for (const e of rows) {
    if (!obj(e) || typeof e.project !== 'string' || typeof e.role !== 'string' || typeof e.from !== 'string' || typeof e.to !== 'string' || typeof e.at !== 'number') continue
    const files = Array.isArray(e.files) ? e.files.filter((x): x is string => typeof x === 'string') : []
    const row: Escalation = { project: e.project, role: e.role, files, from: e.from, to: e.to, reason: typeof e.reason === 'string' ? e.reason : '', at: e.at, ...(typeof e.resolvedBy === 'string' ? { resolvedBy: e.resolvedBy } : {}) }
    ;(out[e.project] ??= []).push(row)
  }
  return out
}

/** Sets stage n's status in one run's stages.json, keeping every other field; a problem string when refused. */
export function setStageStatus(project: string, run: string, n: number, status: 'done' | 'redo'): string | undefined {
  if (!run || run === '.' || run === '..' || /[\\/]/.test(run)) return `${run} is not a stage run`
  const f = path.join(project, '.switchboard', 'stages', run, 'stages.json')
  const rows = readJsonOr(f)
  if (!Array.isArray(rows)) return `${run} has no readable stages.json`
  const row = rows.find(r => obj(r) && r.n === n)
  if (!row) return `${run} has no stage ${n}`
  row.status = status
  writeJsonAtomic(f, rows)
  return undefined
}

const sameFiles = (a: unknown, b: string[]) => Array.isArray(a) && a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n')

/** Drops the model-learn.json rows for this project, role and file set; usage-meter writes the rest, so they stay. */
export function resetEscalations(file: string, project: string, role: string, files: string[]): void {
  const rows = readJsonOr(file)
  if (!Array.isArray(rows)) return
  const kept = rows.filter(e => !(obj(e) && e.project === project && e.role === role && sameFiles(e.files, files)))
  if (kept.length !== rows.length) writeJsonAtomic(file, kept)
}
