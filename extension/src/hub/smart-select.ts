/**
 * Smart select: the ledger of terminal selections (smart-picks.jsonl), whether each one held up, and the learned table
 * (smart-learned.json) the scorer reads. Writers of pick and final rows: this extension (model, effort) and the mods
 * (ponytail, role, question). Only this file writes smart-learned.json. No vscode here.
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { readJsonOr, writeJsonAtomic } from '../fs-utils'
import { EFFORTS, pickRun, roleBounds, type PickInput, type RunPick } from './pick-run'
import type { SmartState } from './types'
import { smartPick, taskLabel, type Stats } from './smart-pick'
import { LOOP_MODES, type SmartLoop } from './loop'

export { smartPick, taskLabel, type Stats } from './smart-pick'

const DIR = path.join(os.homedir(), '.claude', 'switchboard')
export const SMART_PICKS = path.join(DIR, 'smart-picks.jsonl')
export const SMART_LEARNED = path.join(DIR, 'smart-learned.json')
const ROW_CAP = 5000
const TAIL = 8 << 20
const SHOWN = 50

export type Kind = 'ponytail' | 'model' | 'effort' | 'role' | 'question' | 'loop'
export type SmartRow =
  | { t: 'pick'; at: number; session: string; cwd?: string; kind: Kind; task: string; pick: string; why: string; options?: string[]; key: string }
  | { t: 'final'; at: number; session: string; kind: Kind; key: string; final: string }
/** What the chat's end says about its picks. */
export type Outcome = { approvedAt?: number; sentBack?: number; doneMissing?: boolean; escalated?: boolean }

/** One row appended; a ledger that cannot be written never stops a chat. */
export function logSmart(row: SmartRow, file = SMART_PICKS): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, `${JSON.stringify(row)}\n`, { mode: 0o600 })
  } catch { /* no ledger, no problem */ }
}

/** A pick row for model or effort, with the key the final row will use. */
export const pickRow = (kind: Kind, session: string, cwd: string, task: string, pick: string, why: string, options: string[], at = Date.now()): SmartRow =>
  ({ t: 'pick', at, session, cwd, kind, task, pick, why, options, key: `${kind}:${at}` })

export const RECOMMENDED = /\s*\(Recommended\)\s*$/i
/** A label without its (Recommended) mark. */
export const stripRecommended = (s: string) => s.replace(RECOMMENDED, '').trim()
/** Question rows join on the bucket, whatever task the writer used (the header, or a bucket already), and on labels without the mark. */
function normalize(r: SmartRow): SmartRow {
  if (r.kind !== 'question') return r
  return r.t === 'pick' ? { ...r, task: questionBucket(r.task), pick: stripRecommended(r.pick) } : { ...r, final: stripRecommended(r.final) }
}

const STALE_MS = 60 * 86_400_000

const tail = (file: string): string => {
  try {
    const size = fs.statSync(file).size, fd = fs.openSync(file, 'r')
    try { const n = Math.min(size, TAIL), b = Buffer.alloc(n); fs.readSync(fd, b, 0, n, size - n); return b.toString('utf8') } finally { fs.closeSync(fd) }
  } catch { return '' }
}

/** The last `cap` rows by time: the ledger file plus every *.jsonl in smart-picks.d beside it (one writer per file, the mods'); torn or foreign lines are dropped. */
export function readSmartRows(file = SMART_PICKS, cap = ROW_CAP, now = Date.now()): SmartRow[] {
  const dir = path.join(path.dirname(file), 'smart-picks.d')
  let more: string[] = []
  // One file per chat piles up; a chat quiet for 60 days teaches nothing new.
  const fresh = (f: string) => { try { return now - fs.statSync(f).mtimeMs < STALE_MS } catch { return false } }
  try { more = fs.readdirSync(dir).filter(n => n.endsWith('.jsonl')).map(n => path.join(dir, n)).filter(fresh) } catch { /* no mod rows yet */ }
  const rows: SmartRow[] = []
  for (const text of [file, ...more].map(tail)) {
    for (const line of text.split('\n')) {
      try {
        const r = JSON.parse(line) as SmartRow
        if ((r.t === 'pick' || r.t === 'final') && typeof r.session === 'string' && typeof r.key === 'string' && typeof r.kind === 'string') rows.push(normalize(r))
      } catch { /* torn line */ }
    }
  }
  return rows.sort((x, y) => x.at - y.at).slice(-cap)
}

export const QUESTION_BUCKETS = ['finish', 'design', 'scope', 'approach', 'setup', 'naming', 'priority', 'other'] as const
// First match wins. Question rows use the bucket as their task so rates pool across free-text headers.
const BUCKETS: Array<[string, RegExp]> = [
  ['finish', /\b(approve|finished?|send back|sign.?off|on close|on finish|ship it|commit|done)\b/],
  ['naming', /\b(names?|rename|titles?|label|wording|copy|words|stamp|codes?)\b/],
  ['priority', /\b(next|first|order|priority|now|later|meanwhile|phase|timing|start|v1)\b/],
  ['setup', /\b(setup|set up|install|keys?|tokens?|accounts?|aws|auth0?|sign.?in|log.?in|deploy|hosts?|hosting|cloudflare|cf|domain|vsix|reload|quit|access|env|plugins?|servers?|database|rds|ses|s3|https|network|tailscale|release|updates?|migration|provider|firewall|credit|spend|quota|paid|ebay|gemini|perplexity|resend|expo|admins?|owners?|retention|telemetry|backups?|sync|export|download|save|upload|worktree|repos?|git|branches|cloudtrail|analytics|ecc|codex|stack)\b/],
  ['design', /\b(design|ui|ux|look|layout|hero|panel|page|pages|screen|view|colors?|theme|icons?|logo|style|styles|board|cards?|map|mocks?|visual|visuals|animation|anim|button|btn|font|header|picker|strip|pause|rope|realm|realms|frost|sprite|reel|photos?|videos?|phone|size|title bar|depth|borders|disclosure|placement|location|spot|shows?|click|characters|outfits|dresses|404)\b/],
  ['scope', /\b(scope|include|includes|what ships|only|rules?|limits?|cap|policy|filters?|rows|items|tasks|allow|allowlist|enforce|guard|checks?|gate|visibility|defaults?|who|where|which|features|everything|sources|suggestions|removals|duplicates|dead code|old|overhaul|revamp|rework)\b/],
  ['approach', /\b(approach|how|path|method|strategy|direction|model|models|fix|fixes|build|plan|flow|route|routing|implement|test|testing|merge|rollout|structure|architecture|arch|split|execute|intake|learning|auto|smart|pick|effort|kit|edit|edits|engineer|designer|qa|review|audit|research|growth|discussion|downgrade|mode|redeploy|regen)\b/],
]
/** A question's bucket from its header and text; 'other' when no keyword fits. Copy this function into the claude-mods mod. */
export function questionBucket(header: string | undefined, question = ''): string {
  const h = (header ?? '').toLowerCase().trim(), q = question.toLowerCase()
  if ((QUESTION_BUCKETS as readonly string[]).includes(h)) return h
  return (BUCKETS.find(([, re]) => re.test(h)) ?? BUCKETS.find(([, re]) => re.test(q)) ?? ['other'])[0]
}

/** Did the pick hold up: switched, sent back, done-check missing or escalated is not; unfinished is pending. */
export function verdictOf(p: SmartRow & { t: 'pick' }, final: string | undefined, o: Outcome | undefined): 'useful' | 'not' | 'pending' {
  if (final !== undefined && final !== p.pick) return 'not'
  if (o?.sentBack) return 'not'
  if (!o?.approvedAt) return 'pending'
  if (o.doneMissing || (o.escalated && (p.kind === 'model' || p.kind === 'role'))) return 'not'
  return 'useful'
}

export type Joined = { stats: Stats; verdicts: Map<string, 'useful' | 'not' | 'pending'>; finals: Map<string, string> }

/** Verdicts for every pick row, and the table of finished ones. outcome: by session id; esc: whether an escalation hit this pick. */
export function computeStats(rows: SmartRow[], outcome: (session: string, pickAt: number) => Outcome | undefined): Joined {
  const finals = new Map<string, string>()
  for (const r of rows) if (r.t === 'final') finals.set(`${r.session}|${r.key}`, r.final)
  const stats: Stats = {}, verdicts = new Map<string, 'useful' | 'not' | 'pending'>()
  for (const r of rows) {
    if (r.t !== 'pick') continue
    const k = `${r.session}|${r.key}`, v = verdictOf(r, finals.get(k), outcome(r.session, r.at))
    verdicts.set(k, v)
    if (v === 'pending') continue
    const c = ((stats[r.kind] ??= {})[r.task] ??= {})[r.pick] ??= { n: 0, useful: 0 }
    c.n++
    if (v === 'useful') c.useful++
  }
  return { stats, verdicts, finals }
}

/** The table as the scorer reads it, from the learned file; empty when missing. */
export function readLearned(file = SMART_LEARNED): Stats {
  const s = (readJsonOr(file) as { stats?: Stats } | undefined)?.stats
  return s && typeof s === 'object' ? s : {}
}

type Files = { picks: string; archive: string; doneCheck: string; learn: string; learned: string }
export const SMART_FILES: Files = { picks: SMART_PICKS, archive: path.join(DIR, 'archive.json'), doneCheck: path.join(DIR, 'done-check'), learn: path.join(DIR, 'model-learn.json'), learned: SMART_LEARNED }

/** Reads the ledger and the outcome files, writes smart-learned.json and returns the hub state. title: a live chat's name, for chats not archived yet. */
export function buildSmart(files: Files = SMART_FILES, title: (session: string) => string | undefined = () => undefined): SmartState {
  const rows = readSmartRows(files.picks)
  const archive = new Map<string, Record<string, any>>()
  const a = readJsonOr(files.archive)
  if (Array.isArray(a)) for (const r of a) if (r && typeof r.sessionId === 'string') archive.set(r.sessionId, r)
  const learn = readJsonOr(files.learn)
  const esc: Array<{ project: string; at: number }> = Array.isArray(learn) ? learn.filter(e => e && typeof e.project === 'string' && typeof e.at === 'number') : []
  const missing = (session: string, d?: { verified?: boolean; missing?: unknown[] }) => {
    const c = d ?? (readJsonOr(path.join(files.doneCheck, `${session}.json`)) as { verified?: boolean; missing?: unknown[] } | undefined)
    return !!c && c.verified === false && Array.isArray(c.missing) && c.missing.length > 0
  }
  const { stats, verdicts, finals } = computeStats(rows, (session, at) => {
    const r = archive.get(session)
    if (!r) return undefined
    const end = r.archivedAt ?? Infinity
    return {
      approvedAt: r.approvedAt, sentBack: r.sentBack, doneMissing: r.approvedAt ? missing(session, r.doneCheck) : false,
      escalated: esc.some(e => e.project === r.project && e.at >= at && e.at <= end),
    }
  })
  try { writeJsonAtomic(files.learned, { updatedAt: Date.now(), stats }) } catch { /* the scorer reads the old table */ }
  const picks = rows.filter((r): r is SmartRow & { t: 'pick' } => r.t === 'pick').slice(-SHOWN).reverse().map(r => {
    const k = `${r.session}|${r.key}`, name = archive.get(r.session)?.name ?? title(r.session), final = finals.get(k)
    return { at: r.at, session: r.session, ...(name ? { title: name } : {}), kind: r.kind, task: r.task, pick: r.pick, why: r.why, ...(final !== undefined ? { final } : {}), verdict: verdicts.get(k) ?? 'pending' }
  })
  const flat = Object.entries(stats).flatMap(([kind, t]) => Object.entries(t).flatMap(([task, p]) => Object.entries(p).map(([pick, c]) => ({ kind, task, pick, n: c.n, useful: c.useful }))))
  return { picks, rates: flat }
}

/** A model or effort pick before its chat has a session id; final: what Kenneth set himself. */
export type SmartDraft = { kind: 'model' | 'effort'; task: string; pick: string; why: string; options: string[]; final?: string }
const MODELS = ['haiku', 'sonnet', 'opus', 'fable']

/**
 * The rule's model and effort for a Claude run, moved by the learned table when it clearly knows better, plus the ledger drafts.
 * Kenneth's own model or effort stands as the run's value and shows as a final next to what the pick would have been.
 * Learned picks stay within the role's floor and ceiling (pick-run's roleBounds), and at or under opus and high unless the rule itself went higher, so they never reach what the usage gate holds back.
 */
export function smartRun(input: PickInput, p: RunPick, goal: string, stats: Stats): { run: RunPick; drafts: SmartDraft[] } {
  const x = input.explicit ?? {}
  const base = x.model || x.effort ? pickRun({ ...input, explicit: { ultracode: x.ultracode } }) : p
  // Offered: from the role's floor (pick-run's own) up to the rule pick or opus and high, whichever is higher, never past the role's ceiling.
  const bounds = roleBounds(input.role)
  const span = (all: readonly string[], rule: string, soft: string, [lo, hi]: readonly string[]) =>
    all.slice(all.indexOf(lo), Math.max(all.indexOf(rule), Math.min(all.indexOf(soft), all.indexOf(hi))) + 1)
  const upTo = (all: readonly string[], rule: string) => span(all, rule, all === MODELS ? 'opus' : 'high', all === MODELS ? bounds.model : bounds.effort)
  const task = taskLabel(goal)
  const m = smartPick('model', task, base.model, upTo(MODELS, base.model), stats)
  const e = smartPick('effort', task, base.effort, upTo(EFFORTS, base.effort), stats)
  const run = { ...p, model: x.model ?? m.pick, effort: (x.effort ?? e.pick) as RunPick['effort'] }
  const learned = [!x.model && m.why, !x.effort && e.why].filter(Boolean).join('; ')
  if (learned) run.reason = `${p.reason}; ${learned}`
  const draft = (kind: 'model' | 'effort', r: { pick: string; why?: string }, rule: string, own?: string): SmartDraft =>
    ({ kind, task, pick: r.pick, why: r.why ?? p.reason, options: kind === 'model' ? upTo(MODELS, rule) : upTo(EFFORTS, rule), ...(own ? { final: own } : {}) })
  return { run, drafts: [draft('model', m, base.model, x.model), draft('effort', e, base.effort, x.effort)] }
}

/** The drafts as ledger rows for a chat that now has an id; nothing when the cwd or id is missing. */
export function logDrafts(drafts: SmartDraft[] | undefined, session: string | undefined, cwd: string, at = Date.now(), file = SMART_PICKS): void {
  if (!session) return
  for (const d of drafts ?? []) {
    const row = pickRow(d.kind, session, cwd, d.task, d.pick, d.why, d.options, at)
    logSmart(row, file)
    if (d.final !== undefined && row.t === 'pick') logSmart({ t: 'final', at, session, kind: d.kind, key: row.key, final: d.final }, file)
  }
}

/** New chat's loop: Auto's pick, plus Kenneth's own when he chose another (the final), each judged by how the chat ends. */
export function logLoop(session: string, cwd: string, s: SmartLoop, at = Date.now(), file = SMART_PICKS): void {
  const row = pickRow('loop', session, cwd, s.task, s.pick, s.why, LOOP_MODES, at)
  logSmart(row, file)
  if (s.final === undefined || s.final === s.pick) return
  logSmart({ t: 'final', at, session, kind: 'loop', key: row.key, final: s.final }, file)
  logSmart(pickRow('loop', session, cwd, s.task, s.final, 'picked by hand', LOOP_MODES, at + 1), file)
}
