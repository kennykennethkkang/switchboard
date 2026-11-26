/**
 * Finished research runs, kept as markdown under ~/.claude/switchboard/research/<project base name or general>/.
 * Ids are the path relative to the library, e.g. cell-lab/2026-11-22-slug.md; the trash and seen state sit beside them.
 */
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { withLock } from '../fs-utils'
import type { HubState } from './types'

export type ResearchItem = NonNullable<HubState['research']>[number]
export const LIBRARY = path.join(os.homedir(), '.claude', 'switchboard', 'research')
export const LIST_MAX = 100
const SEEN = '.seen.json'
const ASKS = '.asks.json'
const TRASH = '.trash'
const LOCK_MS = 1000
const SUMMARY_MAX = 240
const MAX_BYTES = 1 << 20
const atomic = (file: string, text: string) => {
  const tmp = `${file}.${crypto.randomUUID()}.tmp`
  try {
    fs.writeFileSync(tmp, text)
    fs.renameSync(tmp, file)
  } catch (e) {
    fs.rmSync(tmp, { force: true })
    throw e
  }
}

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
    `claims: ${JSON.stringify([claimName(r.sessionId, question, answer)])}`,
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
    ...(field('added') ? { added: { at: Number(field('addedAt')) || at, n: Number(field('added')) || 0 } } : {}),
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
export const locateResearch = locate

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
  return items.sort((a, b) => (b.added?.at ?? b.at) - (a.added?.at ?? a.at)).slice(0, cap)
}

/** Every run in the library, newest first, capped at LIST_MAX. */
export function listResearch(root: string): ResearchItem[] {
  const asks = readAsks(root)
  let of: Record<string, string> = {}
  try {
    of = JSON.parse(fs.readFileSync(path.join(root, '.folders.json'), 'utf8')).of ?? {}
  } catch {}
  return scan(root, readSeen(root)).map(item => {
    const itemAsks = asks.filter(a => a.id === item.id).map(({ id: _id, ...a }) => a)
    return { ...item, folder: of[item.id], ...(itemAsks.length ? { asks: itemAsks } : {}) }
  })
}

type PendingAsk = { id: string; question: string; at: number; sessionId?: string }
const ASK_MAX_AGE = 3 * 3600_000

function readAsks(root: string): PendingAsk[] {
  try { return (JSON.parse(fs.readFileSync(path.join(root, ASKS), 'utf8')) as PendingAsk[]).filter(a => Date.now() - a.at < ASK_MAX_AGE) } catch { return [] }
}

/** Changes the waiting asks with other windows kept out, writing only when something changed. Never throws: hooks call it. */
function changeAsks(root: string, fn: (rows: PendingAsk[]) => PendingAsk[]): void {
  const changed = () => { const rows = readAsks(root), next = fn(rows); return next.length !== rows.length || next.some((a, i) => a !== rows[i]) ? next : undefined }
  if (!changed()) return
  try {
    withLock(path.join(root, '.asks.lock'), () => {
      const next = changed()
      if (next) atomic(path.join(root, ASKS), JSON.stringify(next))
    }, LOCK_MS)
  } catch { /* the ask only shows progress; it ages out */ }
}

export function addResearchAsk(root: string, id: string, question: string, at = Date.now()): void {
  locate(root, id)
  changeAsks(root, rows => [...rows.filter(a => a.id !== id || a.question !== question), { id, question, at }])
}

export function bindResearchAsk(root: string, sessionId: string, id: string, question: string): void {
  changeAsks(root, rows => rows.map(a => (a.id === id && a.question === question && !a.sessionId ? { ...a, sessionId } : a)))
}

export function removeResearchAsk(root: string, sessionId: string): void {
  changeAsks(root, rows => rows.filter(a => a.sessionId !== sessionId))
}

export function cancelResearchAsk(root: string, id: string, question: string): void {
  changeAsks(root, rows => rows.filter(a => a.id !== id || a.question !== question))
}

const claimName = (sessionId: string, question: string, answer: string) => crypto.createHash('sha1').update(`${sessionId}\n${question}\n${answer}`).digest('hex')
const claimFile = (root: string, sessionId: string, question: string, answer: string) => path.join(root, '.claims', claimName(sessionId, question, answer))

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
      if (item) {
        try {
          const claims = text.match(/^claims: (.+)$/m)?.[1]
          if (claims) for (const name of JSON.parse(claims) as string[]) kept.add(name)
        } catch {}
        kept.add(path.basename(claimFile(root, item.sessionId, item.question, text.slice(text.indexOf('\n---\n') + 5).replace(/^\n/, '').replace(/\n$/, ''))))
      }
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
    const sources = sourceCount(answer), text = render(run, question, answer, sources)
    // wx: another window saving the same question now takes the next name, not this file.
    for (let n = 2; ; n++) {
      try { fs.writeFileSync(path.join(root, folder, name), text, { flag: 'wx' }); break }
      catch (err) { if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err }
      name = `${base}-${n}.md`
    }
    const id = `${folder}/${name}`
    try { pruneClaims(root) } catch { /* housekeeping only */ }
    return { item: { id, question, project: r.project, chat: r.chat, sessionId: r.sessionId, at: r.at, sources, summary: summaryOf(answer), seen: false }, created: true }
  } catch (err) {
    // Not written: drop the claim so a later Stop or another window can save it.
    fs.rmSync(claimFile(root, r.sessionId, question, answer), { force: true })
    throw err
  }
}

type Source = { n: number; url: string; line: string }
const URL_RE = /https?:\/\/[^\s)\]>"']+/
type SourceSection = { start: number; end: number; heading: string; bodyStart: number; body: string }

function linesOutsideCode(text: string): Array<{ start: number; end: number; line: string }> {
  const lines: Array<{ start: number; end: number; line: string }> = []
  let offset = 0, fence = ''
  for (const line of text.match(/[^\n]*(?:\n|$)/g) ?? []) {
    if (!line && offset === text.length) continue
    const value = line.replace(/\n$/, '')
    const marker = value.match(/^\s*(`{3,}|~{3,})/)
    if (!fence && marker) fence = marker[1][0]
    else if (fence && new RegExp(`^\\s*${fence}{3,}\\s*$`).test(value)) fence = ''
    else if (!fence) lines.push({ start: offset, end: offset + value.length, line: value })
    offset += line.length
  }
  return lines
}

function sourceSection(text: string): SourceSection | undefined {
  const headings = linesOutsideCode(text).flatMap(({ start, end, line }) => {
    const match = line.match(/^(#{1,6})\s+Sources(?::|\s+\(\d+\))?\s*$/)
    return match ? [{ start, end, heading: line }] : []
  })
  const heading = headings.at(-1)
  if (!heading) return undefined
  const bodyStart = heading.end + (text[heading.end] === '\n' ? 1 : 0)
  const nextHeading = linesOutsideCode(text).find(({ start, line }) => start >= bodyStart && /^#{1,6}\s+[^\s#][^\n]*$/.test(line))
  const end = nextHeading?.start ?? text.length
  return { ...heading, bodyStart, end, body: text.slice(bodyStart, end) }
}

function parseSource(line: string): Source | undefined {
  // Reports write "- [1] Title https://..." or "- [1] [Title](https://...)", and may add a note after the link.
  const url = line.match(URL_RE)?.[0]
  return url ? { n: Number(line.match(/^\s*[-*]?\s*\[(\d+)\]/)?.[1] ?? 0), url, line } : undefined
}

function sourcesOf(text: string): Source[] {
  const block = sourceSection(text)?.body ?? ''
  return linesOutsideCode(block).flatMap(({ line }) => {
    const source = parseSource(line)
    return source ? [source] : []
  })
}

function maxCitation(text: string): number {
  return linesOutsideCode(text).reduce((max, { line }) => {
    for (const match of line.matchAll(/\[(\d+)\](?!\()/g)) max = Math.max(max, Number(match[1]))
    return max
  }, 0)
}

function citationBody(text: string, remap: Map<number, number>): string {
  return linesOutsideCode(text).reduceRight((result, { start, end, line }) => {
    const updated = line.replace(/\[(\d+)\](?!\()/g, (all, n: string) => `[${remap.get(Number(n)) ?? Number(n)}]`)
    return result.slice(0, start) + updated + result.slice(end)
  }, text)
}

function demoteHeadings(text: string): string {
  return linesOutsideCode(text).reduceRight((result, { start, end, line }) => {
    const updated = line.replace(/^(#{1,6})(?=\s)/, (_, hashes: string) => '#'.repeat(Math.min(hashes.length + 2, 6)))
    return result.slice(0, start) + updated + result.slice(end)
  }, text)
}

function answerBody(text: string, section?: SourceSection): string {
  const body = section ? `${text.slice(0, section.start)}${text.slice(section.end)}` : text
  return body.replace(/^#\s+[^\n]*\n+/, '').trim()
}

/** Adds one claimed follow-up to its original report; the run claim is retained in frontmatter. */
export function addToResearch(root: string, id: string, r: ResearchRun, scrub: (s: string) => string = s => s): { item?: ResearchItem; created: boolean } {
  return withLock(path.join(root, '.add.lock'), () => appendRun(root, id, r, scrub), LOCK_MS)
}

function appendRun(root: string, id: string, r: ResearchRun, scrub: (s: string) => string): { item?: ResearchItem; created: boolean } {
  const question = scrub(oneLine(r.question)).slice(0, 300), answer = scrub(r.answer.trim())
  const claim = claimFile(root, r.sessionId, question, answer)
  if (!claimRun(root, r.sessionId, question, answer)) {
    removeResearchAsk(root, r.sessionId)
    return { item: listResearch(root).find(x => x.id === id), created: false }
  }
  let written = false
  try {
    const file = locate(root, id), text = fs.readFileSync(file, 'utf8'), head = text.match(/^---\n[\s\S]*?\n---\n\n?/)?.[0]
    if (!head) throw new Error('Not a saved research run')
    const body = text.slice(head.length), oldSection = sourceSection(body), followSection = sourceSection(answer), oldSources = sourcesOf(body), newSources = sourcesOf(answer)
    const nums = new Map<string, number>(), remap = new Map<number, number>()
    let next = Math.max(0, ...oldSources.map(s => s.n), maxCitation(body)) + 1
    oldSources.forEach(s => nums.set(s.url, s.n || next++))
    newSources.forEach((source, index) => {
      const number = nums.get(source.url) ?? next++
      nums.set(source.url, number)
      remap.set(source.n || index + 1, number)
    })
    const existing = oldSection ? body.slice(0, oldSection.start) : body
    const trailing = oldSection ? body.slice(oldSection.end) : ''
    const follow = demoteHeadings(citationBody(answerBody(answer, followSection), remap))
    const section = `## Added ${r.date}: ${question}\n\n${follow}`
    const appended: string[] = [], writtenUrls = new Set(oldSources.map(source => source.url))
    for (const source of newSources) {
      if (writtenUrls.has(source.url)) continue
      writtenUrls.add(source.url)
      appended.push(source.n ? source.line.replace(/^\s*(?:[-*]\s*)?\[\d+\]/, `- [${nums.get(source.url)}]`) : `- [${nums.get(source.url)}] ${source.url}`)
    }
    const parsedFollowLines = new Set(newSources.map(source => source.line))
    if (followSection) {
      for (const line of followSection.body.split('\n')) {
        if (line.trim() && !parsedFollowLines.has(line) && !oldSources.some(source => source.line === line)) appended.push(line)
      }
    }
    const sourceBlock = oldSection
      ? `${oldSection.heading}${body.slice(oldSection.start + oldSection.heading.length, oldSection.end)}${appended.length ? `${oldSection.body.endsWith('\n') ? '' : '\n'}${appended.join('\n')}\n` : ''}`
      : `## Sources\n${appended.join('\n')}\n`
    const merged = `${existing}${existing.endsWith('\n\n') ? '' : '\n\n'}${section}\n\n${sourceBlock}${trailing}`
    if (Buffer.byteLength(`${head}${merged}`) > MAX_BYTES) {
      fs.rmSync(claim, { force: true })
      const original = parse(id, text)
      const fallback = saveResearch(root, { ...r, project: original?.project ?? r.project }, scrub)
      if (fallback.created && fallback.item) {
        try {
          const added = fallback.item.id
          withLock(path.join(root, '.folders.lock'), () => {
            const file = path.join(root, '.folders.json'), data = JSON.parse(fs.readFileSync(file, 'utf8'))
            if (typeof data.of?.[id] !== 'string') return
            data.of[added] = data.of[id]
            atomic(file, JSON.stringify(data))
          }, LOCK_MS)
        } catch {}
      }
      removeResearchAsk(root, r.sessionId)
      return fallback
    }
    const claims = new Set<string>()
    for (const match of head.matchAll(/^claims: (.+)$/gm)) {
      try {
        for (const name of JSON.parse(match[1]) as string[]) claims.add(name)
      } catch {}
    }
    const original = parse(id, text)
    if (!claims.size && original) claims.add(claimName(original.sessionId, original.question, body.trim()))
    claims.add(path.basename(claim))
    const at = r.at, n = Number(head.match(/^added: (\d+)$/m)?.[1] ?? 0) + 1
    let updated = head.replace(/^sources: .*$/m, `sources: ${nums.size}`)
    for (const [key, value] of [['added', String(n)], ['addedAt', String(at)], ['claims', JSON.stringify([...claims])]]) {
      const line = new RegExp(`^${key}: .*\\n`, 'm')
      updated = line.test(updated) ? updated.replace(line, `${key}: ${value}\n`) : updated.replace(/\n---\n/, `\n${key}: ${value}\n---\n`)
    }
    atomic(file, `${updated}${merged}`)
    written = true
    try {
      const seen = readSeen(root)
      seen.delete(id)
      atomic(path.join(root, SEEN), JSON.stringify([...seen]))
    } catch {}
    removeResearchAsk(root, r.sessionId)
    const item = listResearch(root).find(x => x.id === id)
    return { item, created: true }
  } catch (err) {
    if (!written) fs.rmSync(claim, { force: true })
    throw err
  }
}

/** The saved report of one run, without the file's header. */
export function readResearch(root: string, id: string): string {
  const fd = fs.openSync(locate(root, id), 'r')
  try {
    const size = fs.fstatSync(fd).size
    const buf = Buffer.alloc(Math.min(size, MAX_BYTES))
    fs.readSync(fd, buf, 0, buf.length, 0)
    const text = buf.toString('utf8').replace(/^---\n[\s\S]*?\n---\n\n?/, '')
    return size > MAX_BYTES ? `${text}\n\n...the report is longer than 1 MiB; the rest is in the file` : text
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
  try {
    withLock(path.join(root, '.folders.lock'), () => {
      const file = path.join(root, '.folders.json'), data = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (!data.of?.[id]) return
      delete data.of[id]
      atomic(file, JSON.stringify(data))
    }, LOCK_MS)
  } catch { /* no folders yet */ }
  changeAsks(root, rows => rows.filter(a => a.id !== id))
}
