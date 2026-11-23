/**
 * Research mode: one folder, ~/Documents/Research, that is always a project. Chats there skip the aar gate and the finish hold,
 * and recall can be limited to its memory. usage-meter offers it to a chat that looks like research; the offers sit in
 * HubState.researchOffers until dismissed or 30 minutes old.
 */
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { foldPathCase } from '../fs-utils'
import type { HubState } from './types'
import { emptyRun, isRealResearch, looksLikeAnswer, reduceResearch, type ResearchRun } from './research-run'

export const RESEARCH_ROOT = path.join(os.homedir(), 'Documents', 'Research')

/** The research folder, made when it is not there yet. */
export function ensureResearchRoot(dir = RESEARCH_ROOT): string {
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

const key = (p: string) => foldPathCase(p.replace(/\\/g, '/').replace(/\/+$/, ''))

/** Whether cwd is the research folder or inside it. Text only, no disk read. */
export function isResearch(cwd: unknown, root = RESEARCH_ROOT): boolean {
  if (typeof cwd !== 'string' || !cwd) return false
  const r = key(root), c = key(path.posix.normalize(cwd.replace(/\\/g, '/')))
  return c === r || c.startsWith(`${r}/`)
}

export type ResearchOffer = NonNullable<HubState['researchOffers']>[number]
export const OFFER_MS = 30 * 60_000
// Sessions whose offer was dismissed, so the next prompt does not bring it back. Memory only, newest 200.
const dismissed = new Set<string>()

const fresh = (list: ResearchOffer[], now: number) => list.filter(o => now - o.at < OFFER_MS)

/** The list with this offer added: one per session, none for a dismissed session, expired ones dropped. */
export function addOffer(list: ResearchOffer[] | undefined, offer: Omit<ResearchOffer, 'at'>, now = Date.now()): ResearchOffer[] {
  const live = fresh(list ?? [], now)
  if (dismissed.has(offer.sessionId) || live.some(o => o.sessionId === offer.sessionId)) return live
  return [...live, { ...offer, at: now }]
}

/** The list without this session's offer; the session is not offered again. */
export function dropOffer(list: ResearchOffer[] | undefined, sessionId: string): ResearchOffer[] {
  dismissed.add(sessionId)
  if (dismissed.size > 200) dismissed.delete(dismissed.values().next().value as string)
  return (list ?? []).filter(o => o.sessionId !== sessionId)
}

type Hub = { get(): HubState; set(part: Partial<HubState>): void }

/** Stores an offer in hub state, and drops it again once it is old. */
export function offerResearch(hub: Hub, offer: Omit<ResearchOffer, 'at'>): void {
  hub.set({ researchOffers: addOffer(hub.get().researchOffers, offer) })
  setTimeout(() => hub.set({ researchOffers: fresh(hub.get().researchOffers ?? [], Date.now()) }), OFFER_MS + 1000).unref?.()
}

/** hub-research-dismiss: Kenneth said no to this session's offer. */
export const dismissOffer = (hub: Hub, sessionId: string): void => hub.set({ researchOffers: dropOffer(hub.get().researchOffers, sessionId) })

const INDEX = 'project-research'
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').split('-').slice(0, 7).join('-')
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()

/** The listed project holding cwd (a worktree counts as its repo), or undefined for the Research space and unknown folders. */
export function researchProject(cwd: string, projects: string[], root = RESEARCH_ROOT): string | undefined {
  if (isResearch(cwd, root)) return undefined
  const c = key(cwd)
  return projects.filter(p => !isResearch(p, root) && (c === key(p) || c.startsWith(`${key(p)}/`))).sort((a, b) => b.length - a.length)[0]
}

const REPORT_MAX = 6000
/** A long report keeps its head and its Sources section, which later chats need to trust it. */
export function trimReport(text: string, max = REPORT_MAX): string {
  if (text.length <= max) return text
  const at = text.search(/^#+\s*Sources\b/im)
  const sources = at > 0 ? text.slice(at).slice(0, Math.floor(max / 2)) : ''
  return `${text.slice(0, max - sources.length).trimEnd()}\n...\n${sources ? `\n${sources}` : ''}`.trimEnd()
}

export type ResearchSave = { question: string; answer: string; chat?: string; date: string }

/** A project memory note for a finished research answer, and its MEMORY.md line. Pure. */
export function researchNote(r: ResearchSave): { name: string; text: string; line: string } {
  const q = oneLine(r.question).slice(0, 200)
  const name = `research-${words(q) || 'answer'}-${crypto.createHash('sha1').update(q.toLowerCase()).digest('hex').slice(0, 6)}`
  const lead = oneLine(r.answer.match(/\*\*Answer:?\*\*:?\s*([^\n]+)/)?.[1] ?? r.answer.split('\n').find(l => l.trim() && !/^#/.test(l)) ?? '').slice(0, 160)
  const text = [
    '---',
    `name: ${name}`,
    `description: ${JSON.stringify(`Research ${r.date}: ${q}`.slice(0, 200))}`,
    'metadata:',
    '  type: reference',
    `part-of: ${INDEX}`,
    '---',
    '',
    `Question: ${q}`,
    `Checked ${r.date}${r.chat ? ` in the chat "${oneLine(r.chat)}"` : ''}. Part of [[${INDEX}]].`,
    '',
    trimReport(r.answer.trim()),
    '',
  ].join('\n')
  return { name, text, line: `- [Research: ${q.slice(0, 60)}](${name}.md): ${lead || r.date}` }
}

const INDEX_TEXT = `---\nname: ${INDEX}\ndescription: Research answers saved from this project's chats; each research-* note is part of it\nmetadata:\n  type: reference\n---\n\nSwitchboard saves a project chat's finished research here as research-* notes, so later chats in this project can recall them.\n`

/** Saves the note into the project's Claude memory and indexes it once. Answers the note's path. */
export function saveResearchMemory(project: string, r: ResearchSave, scrub: (s: string) => string, home = os.homedir()): string {
  const dir = path.join(home, '.claude', 'projects', project.replace(/[^A-Za-z0-9]/g, '-'), 'memory')
  fs.mkdirSync(dir, { recursive: true })
  const note = researchNote({ ...r, question: scrub(r.question), answer: scrub(r.answer) })
  const file = path.join(dir, `${note.name}.md`)
  // Archived by hand: leave it there. Same report again (a reopened hub): no rewrite.
  if (fs.existsSync(path.join(dir, 'archive', `${note.name}.md`))) return file
  const body = (t: string) => t.slice(t.indexOf('\n---\n'))
  if (fs.existsSync(file) && body(fs.readFileSync(file, 'utf8')).replace(/Checked \S+/, '') === body(note.text).replace(/Checked \S+/, '')) return file
  fs.writeFileSync(file, note.text)
  const indexFile = path.join(dir, `${INDEX}.md`)
  if (!fs.existsSync(indexFile)) fs.writeFileSync(indexFile, INDEX_TEXT)
  const memory = path.join(dir, 'MEMORY.md')
  const had = fs.existsSync(memory) ? fs.readFileSync(memory, 'utf8') : ''
  const add = [`(${INDEX}.md)`, `(${note.name}.md)`].filter(ref => !had.includes(ref))
    .map(ref => ref === `(${INDEX}.md)` ? `- [Project research](${INDEX}.md): research answers saved from this project's chats` : note.line)
  if (add.length) fs.writeFileSync(memory, `${had}${had && !had.endsWith('\n') ? '\n' : ''}${add.join('\n')}\n`)
  return file
}

type Ev = Parameters<typeof reduceResearch>[1]

/** Every chat's research run, folded from the same events the panels get, so a window with no Switchboard view open still saves. */
export class ResearchSaves {
  private runs = new Map<string, ResearchRun>()
  // Chat + question pairs already handed out, so a later reply in the same chat never re-saves under the old question.
  private saved = new Set<string>()

  /** One event in; answers the run once, when a real research run ends with a report. */
  feed(e: Ev, now = Date.now()): ResearchRun | undefined {
    if (!e.sessionId) return undefined
    const prev = this.runs.get(e.sessionId) ?? emptyRun()
    const next = reduceResearch(prev, e, e.sessionId, now)
    if (next === prev) return undefined
    this.runs.set(e.sessionId, next)
    const once = `${e.sessionId}\n${next.question ?? ''}`
    if (next.status !== 'done' || !next.answer || !looksLikeAnswer(next.answer) || !isRealResearch(next) || this.saved.has(once)) return undefined
    this.saved.add(once)
    if (this.saved.size > 500) this.saved.delete(this.saved.values().next().value as string)
    return next
  }
}
