/**
 * Finished research runs, kept as markdown under ~/.claude/switchboard/research/<project base name or general>/.
 * Ids are the path relative to the library, e.g. cell-lab/2026-11-22-slug.md; the trash and seen state sit beside them.
 */
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { HubState } from './types'

export type ResearchItem = NonNullable<HubState['research']>[number]
export const LIBRARY = path.join(os.homedir(), '.claude', 'switchboard', 'research')
export const LIST_MAX = 100
const SEEN = '.seen.json'
const TRASH = '.trash'
const SUMMARY_MAX = 240
const MAX_BYTES = 1 << 20

export type ResearchRun = { question: string; answer: string; chat: string; sessionId: string; project?: string; date: string; at: number }

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()

/** The report's Answer line, else its first body line, cut to a card's length. */
export function summaryOf(answer: string): string {
  const line = answer.match(/\*\*Answer:?\*\*:?\s*([^\n]+)/)?.[1] ?? answer.split('\n').find(l => l.trim() && !/^#/.test(l)) ?? ''
  return oneLine(line).slice(0, SUMMARY_MAX)
}

/** Distinct links in the report. */
export const sourceCount = (answer: string): number => new Set(answer.match(/https?:\/\/[^\s)\]>"']+/g) ?? []).size

const slug = (q: string) => q.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').split('-').slice(0, 7).join('-') || 'research'
const folderOf = (project?: string) => (project ? path.basename(project).replace(/[\\/:*?"<>|]/g, '-').replace(/^\.+/, '') || 'project' : 'general')
const quote = (s: string) => JSON.stringify(s)

function render(r: ResearchRun, question: string, answer: string, sources: number): string {
  return [
    '---',
    `question: ${quote(question)}`,
    `chat: ${quote(r.chat)}`,
    `sessionId: ${quote(r.sessionId)}`,
    `project: ${r.project ? quote(r.project) : 'none'}`,
    `date: ${r.date}`,
    `at: ${r.at}`,
    `sources: ${sources}`,
    '---',
    '',
    answer,
    '',
  ].join('\n')
}

/** Reads the frontmatter back. Undefined for a file this module did not write. */
function parse(id: string, text: string): ResearchItem | undefined {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/)
  if (!m) return undefined
  const field = (k: string) => m[1].split('\n').find(l => l.startsWith(`${k}: `))?.slice(k.length + 2)
  const str = (k: string) => { try { return JSON.parse(field(k) ?? '""') as string } catch { return undefined } }
  const question = str('question'), sessionId = str('sessionId'), at = Number(field('at'))
  if (question === undefined || sessionId === undefined || !Number.isFinite(at)) return undefined
  const project = field('project') === 'none' ? undefined : str('project')
  return {
    id, question, sessionId, at, project, chat: str('chat') ?? '', sources: Number(field('sources')) || 0,
    summary: summaryOf(text.slice(m[0].length)), seen: false,
  }
}

/** The file for an id in the library, or a throw. Trash and seen state are not runs; links and anything outside are refused. */
function locate(root: string, id: string): string {
  const bad = () => new Error('Not a saved research run')
  if (typeof id !== 'string' || !/^[^/\\.][^/\\]*\/[^/\\]+\.md$/.test(id) || id.includes('..')) throw bad()
  const file = path.join(root, id)
  let base: string
  try {
    if (!fs.lstatSync(file).isFile()) throw bad()
    base = fs.realpathSync(root)
    if (!fs.realpathSync(file).startsWith(base + path.sep)) throw bad()
  } catch { throw bad() }
  return file
}

function readSeen(root: string): Set<string> {
  try { return new Set(JSON.parse(fs.readFileSync(path.join(root, SEEN), 'utf8')) as string[]) } catch { return new Set() }
}

/** Each run file in one folder of the library (the library itself, or its trash) with its text. */
function* runFiles(base: string): Generator<{ id: string; text: string }> {
  let folders: fs.Dirent[] = []
  try { folders = fs.readdirSync(base, { withFileTypes: true }) } catch { return }
  for (const dir of folders) {
    if (!dir.isDirectory() || dir.name.startsWith('.')) continue
    for (const f of fs.readdirSync(path.join(base, dir.name))) {
      if (!f.endsWith('.md')) continue
      const id = `${dir.name}/${f}`
      let text: string
      try { text = fs.readFileSync(path.join(base, id), 'utf8') } catch { continue }
      yield { id, text }
    }
  }
}

/** The runs in one folder of the library, newest first. */
function scan(base: string, seen: Set<string>, cap = LIST_MAX): ResearchItem[] {
  const items: ResearchItem[] = []
  for (const { id, text } of runFiles(base)) {
    const item = parse(id, text)
    if (item) items.push({ ...item, seen: seen.has(id) })
  }
  return items.sort((a, b) => b.at - a.at).slice(0, cap)
}

/** Every run in the library, newest first, capped at LIST_MAX. */
export function listResearch(root: string): ResearchItem[] {
  return scan(root, readSeen(root))
}

const claimFile = (root: string, sessionId: string, question: string, answer: string) =>
  path.join(root, '.claims', crypto.createHash('sha1').update(`${sessionId}\n${question}\n${answer}`).digest('hex'))

/** One claim file per session, question and report, kept even after the run is deleted. True for the first caller only. */
export function claimRun(root: string, sessionId: string, question: string, answer: string): boolean {
  fs.mkdirSync(path.join(root, '.claims'), { recursive: true })
  try { fs.closeSync(fs.openSync(claimFile(root, sessionId, question, answer), 'wx')); return true }
  catch { return false }
}

export const CLAIM_MAX_AGE = 30 * 24 * 3600_000

/** Drops claim files older than CLAIM_MAX_AGE unless their run is still in the library or its trash. */
export function pruneClaims(root: string, now = Date.now()): void {
  const dir = path.join(root, '.claims')
  let names: string[]
  try { names = fs.readdirSync(dir) } catch { return }
  const old = names.filter(n => { try { return now - fs.statSync(path.join(dir, n)).mtimeMs > CLAIM_MAX_AGE } catch { return false } })
  if (!old.length) return
  const kept = new Set<string>()
  for (const base of [root, path.join(root, TRASH)]) {
    for (const { id, text } of runFiles(base)) {
      const item = parse(id, text)
      // render() writes a blank line before the answer and a newline after it
      if (item) kept.add(path.basename(claimFile(root, item.sessionId, item.question, text.slice(text.indexOf('\n---\n') + 5).replace(/^\n/, '').replace(/\n$/, ''))))
    }
  }
  for (const n of old) if (!kept.has(n)) fs.rmSync(path.join(dir, n), { force: true })
}

/** Saves a finished run. The same report for a session and question (kept, or deleted into the trash) is never written again; a rerun with a new report is. */
export function saveResearch(root: string, r: ResearchRun, scrub: (s: string) => string = s => s): { item?: ResearchItem; created: boolean } {
  const question = scrub(oneLine(r.question)).slice(0, 300)
  const answer = scrub(r.answer.trim()).slice(0, MAX_BYTES)
  const run = { ...r, question, answer }
  if (!claimRun(root, r.sessionId, question, answer)) {
    return { item: listResearch(root).find(x => x.sessionId === r.sessionId && x.question === question), created: false }
  }
  try {
    const folder = folderOf(r.project)
    fs.mkdirSync(path.join(root, folder), { recursive: true })
    const base = `${r.date}-${slug(question)}`
    let name = `${base}.md`
    for (let n = 2; fs.existsSync(path.join(root, folder, name)); n++) name = `${base}-${n}.md`
    const id = `${folder}/${name}`
    const sources = sourceCount(answer)
    fs.writeFileSync(path.join(root, id), render(run, question, answer, sources))
    try { pruneClaims(root) } catch { /* housekeeping only */ }
    return { item: { id, question, project: r.project, chat: r.chat, sessionId: r.sessionId, at: r.at, sources, summary: summaryOf(answer), seen: false }, created: true }
  } catch (err) {
    // Not written: drop the claim so a later Stop or another window can save it.
    fs.rmSync(claimFile(root, r.sessionId, question, answer), { force: true })
    throw err
  }
}

/** The saved markdown of one run. */
export function readResearch(root: string, id: string): string {
  const fd = fs.openSync(locate(root, id), 'r')
  try {
    const size = fs.fstatSync(fd).size
    const buf = Buffer.alloc(Math.min(size, MAX_BYTES))
    fs.readSync(fd, buf, 0, buf.length, 0)
    return size > MAX_BYTES ? `${buf.toString('utf8')}\n\n...the report is longer than 1 MiB; the rest is in the file` : buf.toString('utf8')
  } finally { fs.closeSync(fd) }
}

/** Marks a run seen; kept in .seen.json beside the folders. */
export function markSeen(root: string, id: string): void {
  locate(root, id)
  const seen = readSeen(root)
  seen.add(id)
  fs.mkdirSync(root, { recursive: true })
  fs.writeFileSync(path.join(root, SEEN), JSON.stringify([...seen]))
}

/** Moves a run into .trash/<folder>, never removes it. */
export function deleteResearch(root: string, id: string): void {
  const file = locate(root, id)
  const dir = path.join(root, TRASH, path.dirname(id))
  fs.mkdirSync(dir, { recursive: true })
  let dest = path.join(dir, path.basename(id))
  for (let n = 2; fs.existsSync(dest); n++) dest = path.join(dir, path.basename(id, '.md') + `-${n}.md`)
  fs.renameSync(file, dest)
  const seen = readSeen(root)
  if (seen.delete(id)) fs.writeFileSync(path.join(root, SEEN), JSON.stringify([...seen]))
}
