/**
 * The Git panel's buttons: plain git and gh calls with argument arrays, no shell, never a force push.
 * Only Kenneth's presses run these; chats never commit. Called from hub-panel.ts.
 */
import { execFile } from 'child_process'
import { randomBytes } from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { cliPath } from './ais'
import { excludeWorktrees } from './advanced'
import { cleanInvisible } from './clean-text'
import { hold } from './idle'
import { insideCwd } from './local'
import { cliCall } from './windows'
import { dropPending, leftovers, pendingAt } from './progress'
import type { GitOp, LaneCommit, RepoFile, RepoView } from './types'

const QUICK = 15_000
const SLOW = 60_000
const MAIN = /^(main|master)$/
// No credential prompt, no editor, and status skips index.lock so the refresh never races an op. Pathspecs go literal per call (LIT): set globally it breaks stash -u.
// A window opened by `code` from a chat inherits its markers; the git guard would then refuse the buttons.
export const gitEnv = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const { CLAUDECODE: _a, CLAUDE_CODE_SESSION_ID: _b, SWITCHBOARD_CHAT: _c, ...rest } = env
  return { ...rest, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_EDITOR: 'true', GH_PROMPT_DISABLED: '1', GIT_OPTIONAL_LOCKS: '0' }
}
const ENV = gitEnv(process.env)
const LIT = '--literal-pathspecs'
const FORCE = /^(--force(-with-lease|-if-includes)?(=.*)?|-[a-zA-Z]*f[a-zA-Z]*|\+.*)$/

type Ran = { ok: boolean; out: string; err: string }
type Runner = typeof execFile
let runner: Runner = execFile
export const setGitRunner = (next?: Runner) => { runner = next ?? execFile }
export type GitCmd = { op: GitOp; files?: string[]; summary?: string; description?: string; branch?: string; stash?: boolean; confirmed?: boolean; /** merge-all: just this worktree. */ only?: string }
export type GitResult = { ok: boolean; text: string; open?: string }
type Status = { branch?: string; upstream?: string; ahead: number; behind: number; files: RepoFile[] }

/** input: written to stdin (hash-object --stdin, mktree). */
function exec(file: string, args: string[], timeoutMs: number, cwd?: string, input?: string): Promise<Ran> {
  const call = cliCall(file, args)
  return new Promise(resolve => {
    const c = runner(call.cmd, call.args, { windowsVerbatimArguments: call.windowsVerbatimArguments, cwd, timeout: timeoutMs, maxBuffer: 8 << 20, windowsHide: true, env: ENV }, (err, out, e) =>
      resolve({ ok: !err, out: String(out), err: err?.killed ? `${path.basename(file)} timed out` : String(e) || err?.message || '' }))
    if (input !== undefined) { c.stdin?.on('error', () => {}); c.stdin?.end(input) }
  })
}

// The one forced push: the to-do ref alone, leased on the commit the user saw (todo.ts replaceRemote).
const TODO_LEASE = /^--force-with-lease=refs\/switchboard\/todo:[0-9a-f]{40}$/
const todoLease = (args: string[]) => args.filter(a => FORCE.test(a)).every(a => TODO_LEASE.test(a))
  && args.filter(a => !a.startsWith('-')).join(' ') === 'push origin refs/switchboard/todo:refs/switchboard/todo'

export function git(root: string, args: string[], timeoutMs = QUICK, input?: string): Promise<Ran> {
  if (args[0] === 'push' && args.some(a => FORCE.test(a)) && !todoLease(args)) return Promise.resolve({ ok: false, out: '', err: 'Switchboard never force pushes' })
  return exec('git', ['-C', root, ...args], timeoutMs, undefined, input)
}

/** The first line of stderr worth showing. */
export const why = (r: Ran) => r.err.split('\n').filter(l => !/^\s*hint:/i.test(l)).map(l => l.replace(/^(error|fatal|remote): /i, '').trim()).find(Boolean) ?? 'git failed'

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
const no = (text: string): GitResult => ({ ok: false, text })

/** `git status --porcelain=v2 --branch -z -uall`. */
export function parseRepoStatus(out: string): Status {
  const s: Status = { ahead: 0, behind: 0, files: [] }
  const parts = out.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const row = parts[i], f = row.split(' ')
    if (row.startsWith('# branch.head ')) { if (f[2] !== '(detached)') s.branch = row.slice(14) }
    else if (row.startsWith('# branch.upstream ')) s.upstream = row.slice(18)
    else if (row.startsWith('# branch.ab ')) { s.ahead = Math.abs(Number(f[2])) || 0; s.behind = Math.abs(Number(f[3])) || 0 }
    else if (row.startsWith('1 ')) s.files.push({ path: f.slice(8).join(' '), status: f[1].includes('D') ? 'deleted' : f[1].includes('A') ? 'added' : 'modified' })
    else if (row.startsWith('2 ')) s.files.push({ path: f.slice(9).join(' '), status: 'renamed', from: parts[++i] })
    else if (row.startsWith('u ')) s.files.push({ path: f.slice(10).join(' '), status: 'conflict' })
    else if (row.startsWith('? ')) s.files.push({ path: row.slice(2), status: 'untracked' })
  }
  return s
}

/** The one sync button: publish with no upstream, pull when behind (diverged too), push when ahead, else fetch. */
export function syncAction(s: Pick<Status, 'upstream' | 'ahead' | 'behind'> & { branch?: string }): { kind: 'publish' | 'pull' | 'push' | 'fetch'; label: string } {
  if (!s.upstream) return { kind: 'publish', label: 'Publish branch' }
  if (s.behind) return { kind: 'pull', label: `Pull ${s.behind}` }
  if (s.ahead) return { kind: 'push', label: `Push ${s.ahead}` }
  return { kind: 'fetch', label: 'Fetch' }
}

/** https://github.com/<owner>/<repo> from an https, git@ or ssh:// remote; undefined for anything else. */
export function githubRepo(url: string): string | undefined {
  const m = /^(?:https:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url.trim())
  if (!m || m[1].startsWith('.') || m[2].startsWith('.')) return undefined
  return `https://github.com/${m[1]}/${m[2]}`
}

/** A quick check; git check-ref-format has the last word. */
export function branchProblem(name: string): string | undefined {
  if (!name || name.length > 200) return 'Give a branch name'
  if (name === '@') return '"@" is not a valid branch name'
  if (/^[-+]/.test(name) || /[\s~^:?*[\\]|\.\.|@\{/.test(name)) return `"${name}" is not a valid branch name`
  return undefined
}

export function commitArgs(summary: string, description: string): string[] | string {
  const s = summary.trim(), d = description.trim()
  if (!s) return 'Write a commit summary first'
  return d ? ['commit', '-m', s, '-m', d] : ['commit', '-m', s]
}

/** Only files git status lists, by their exact repo-relative path; a string says why not. */
export function pickFiles(listed: RepoFile[], asked: string[]): RepoFile[] | string {
  if (!asked.length) return 'Check at least one file'
  const got: RepoFile[] = []
  for (const p of new Set(asked)) {
    const f = listed.find(x => x.path === p)
    if (!f || !insideCwd('/r', p) || (f.from && !insideCwd('/r', f.from))) return `${p} is not in this repo's changes`
    got.push(f)
  }
  return got
}

export const status = async (root: string) => {
  const r = await git(root, ['status', '--porcelain=v2', '--branch', '-z', '-uall'])
  if (!r.ok) throw new Error(why(r))
  return parseRepoStatus(r.out)
}
const config = async (root: string, key: string) => (await git(root, ['config', '--get', key])).out.trim()
const branches = async (root: string) => (await git(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])).out.split('\n').filter(Boolean)

/** Where a push goes: the branch's own upstream, or origin when it has none yet (publish). Never another remote by default. */
async function pushTarget(root: string, s: Status): Promise<{ remote: string; name: string; publish: boolean }> {
  const b = s.branch ?? ''
  if (!s.upstream) return { remote: 'origin', name: b, publish: true }
  const merge = await config(root, `branch.${b}.merge`)
  const remote = (await config(root, `branch.${b}.remote`)) || 'origin', name = merge.replace(/^refs\/heads\//, '') || b
  // A feature branch made with --track origin/main publishes under its own name instead.
  if (MAIN.test(name) && !MAIN.test(b)) return { remote, name: b, publish: true }
  return { remote, name, publish: false }
}

// HEAD:refs/heads/<name> so a branch name can never read as a flag or a +force refspec.
const push = (root: string, t: { remote: string; name: string; publish: boolean }) =>
  git(root, ['push', ...(t.publish ? ['-u'] : []), t.remote, `HEAD:refs/heads/${t.name}`], SLOW)

let ghAt: string | undefined
/** VS Code's PATH often lacks Homebrew's bin. A miss is not cached, so installing gh later works. */
export const ghPath = async () => (ghAt ??= (await cliPath('gh')) ?? ['/opt/homebrew/bin/gh', '/usr/local/bin/gh', path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'GitHub CLI', 'gh.exe')].find(f => fs.existsSync(f)))

const prs = new Map<string, { at: number; pr?: RepoView['pr'] }>()
const PR_MS = 2 * 60_000
async function prFor(root: string, repo: string, branch: string, gh: string): Promise<RepoView['pr']> {
  const key = `${repo}\n${branch}`, hit = prs.get(key)
  if (hit && Date.now() - hit.at < PR_MS) return hit.pr
  const r = await exec(gh, ['pr', 'view', branch, '--repo', repo.replace('https://github.com/', ''), '--json', 'url,state,title,number,additions,deletions,baseRefName'], QUICK, root)
  let pr: RepoView['pr']
  try {
    const j = JSON.parse(r.out)
    if (typeof j.url === 'string') pr = { url: j.url, state: String(j.state), title: String(j.title), number: Number(j.number) || undefined, additions: Number(j.additions) || 0, deletions: Number(j.deletions) || 0, base: typeof j.baseRefName === 'string' ? j.baseRefName : undefined }
  } catch { /* none, or gh not signed in */ }
  prs.set(key, { at: Date.now(), pr })
  return pr
}

type Ci = NonNullable<RepoView['ci']>
const RUN_MS = 30_000
const FAILED = new Set(['failure', 'timed_out', 'startup_failure'])
const text = (v: unknown) => (typeof v === 'string' && v ? v : undefined)

/** `gh run list --json ...` and `gh run view --json jobs` as the CI card's run; undefined with no run. */
export function parseRun(list: string, view?: string): Ci | undefined {
  let r: Record<string, unknown> | undefined, jobs: unknown[] = []
  try { r = JSON.parse(list)[0] } catch { return undefined }
  if (!r || typeof r.databaseId !== 'number' || !text(r.url)) return undefined
  try { jobs = view ? JSON.parse(view).jobs ?? [] : [] } catch { /* none yet */ }
  const conclusion = text(r.conclusion)
  return {
    id: r.databaseId, workflow: text(r.workflowName) ?? 'Workflow', status: String(r.status), ...(conclusion ? { conclusion } : {}), url: String(r.url),
    sha: String(r.headSha ?? '').slice(0, 7), at: Date.parse(String(r.updatedAt)) || 0,
    jobs: (Array.isArray(jobs) ? jobs : []).map(j => {
      const o = j as { name?: unknown; status?: unknown; conclusion?: unknown; steps?: { name?: unknown; conclusion?: unknown }[] }
      const c = text(o.conclusion), step = c && FAILED.has(c) ? text(o.steps?.find(st => FAILED.has(String(st.conclusion)))?.name) : undefined
      return { name: text(o.name) ?? 'job', status: String(o.status), ...(c ? { conclusion: c } : {}), ...(step ? { step } : {}) }
    }),
  }
}

const runs = new Map<string, { at: number; ci?: Ci }>()
/** The branch's newest Actions run; cached shorter while it runs. */
async function runFor(root: string, repo: string, branch: string, gh: string): Promise<Ci | undefined> {
  const key = `${repo}\n${branch}`, hit = runs.get(key)
  if (hit && Date.now() - hit.at < (hit.ci && hit.ci.status !== 'completed' ? RUN_MS : PR_MS)) return hit.ci
  const R = ['--repo', repo.replace('https://github.com/', '')]
  const l = await exec(gh, ['run', 'list', ...R, '--branch', branch, '--limit', '1', '--json', 'databaseId,status,conclusion,workflowName,url,headSha,updatedAt'], QUICK, root)
  const first = l.ok ? parseRun(l.out) : undefined
  // Jobs for the dots row: one more call only when the run changed.
  const same = !!first && hit?.ci?.id === first.id && hit.ci.at === first.at
  const ci = same ? hit!.ci : first && parseRun(l.out, (await exec(gh, ['run', 'view', String(first.id), ...R, '--json', 'jobs'], QUICK, root)).out)
  runs.set(key, { at: Date.now(), ci })
  return ci
}

type Merge = NonNullable<RepoView['merge']>
const CUT = 120

/** The branch a PR would merge into: the PR's base, else origin/HEAD's, else main or master. ref prefers the remote-tracking one. */
export function pickBase(prBase: string | undefined, originHead: string, refs: string[], remote: string): { name: string; ref: string } | undefined {
  const names = prBase ? [prBase] : [originHead.startsWith(`${remote}/`) ? originHead.slice(remote.length + 1) : '', 'main', 'master'].filter(Boolean)
  for (const name of names) {
    if (branchProblem(name)) continue
    const ref = [`${remote}/${name}`, name].find(r => refs.includes(r))
    if (ref) return { name, ref }
  }
  return undefined
}

/** `git merge-tree --write-tree -z --name-only --no-messages`: the merged tree, then each conflicted path. undefined when git is too old (< 2.38). */
export function parseMergeTree(out: string): { tree: string; files: string[] } | undefined {
  const [tree, ...rest] = out.split('\0')
  if (!/^[0-9a-f]{40,64}$/.test(tree)) return undefined
  return { tree, files: [...new Set(rest.filter(Boolean))] }
}

/** The first conflict hunk in a merged file: the first line where the two sides differ, numbered as in ours. */
export function firstConflict(text: string): { line: number; ours: string; theirs: string } | undefined {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex(l => l.startsWith('<<<<<<<'))
  if (start < 0) return undefined
  const ours: string[] = [], theirs: string[] = []
  let side: string[] | undefined = ours
  for (const l of lines.slice(start + 1)) {
    if (l.startsWith('>>>>>>>')) break
    if (l.startsWith('|||||||')) side = undefined
    else if (l === '=======') side = theirs
    else side?.push(l)
  }
  let k = 0
  while (k < ours.length && k < theirs.length && ours[k] === theirs[k]) k++
  if (k >= ours.length && k >= theirs.length) k = 0
  const cut = (s = '') => s.trim().slice(0, CUT)
  return { line: start + 1 + k, ours: cut(ours[k]), theirs: cut(theirs[k]) }
}

const SIDE: Record<string, LaneCommit['side']> = { '>': 'head', '<': 'base', '-': 'fork' }

/** `git log --format=%h%x00%an%x00%ae%x00%ct` rows, plus `%x00%m%x00%s` for the card's lanes; my own email reads as You. */
export function parseCommits(out: string, me: string): LaneCommit[] {
  return out.split('\n').filter(Boolean).map(l => {
    const [hash, name, email, ct, mark, subject] = l.split('\0')
    const c: LaneCommit = { hash, author: me && email?.toLowerCase() === me.toLowerCase() ? 'You' : name, at: Number(ct) * 1000 }
    if (subject !== undefined) c.subject = subject
    if (mark && SIDE[mark]) c.side = SIDE[mark]
    return c
  })
}

/** `git diff --numstat -z`; a rename counts under its new path, a binary as 0 and 0. */
export function parseNumstat(out: string): { path: string; added: number; removed: number }[] {
  const parts = out.split('\0'), got: { path: string; added: number; removed: number }[] = []
  for (let i = 0; i < parts.length; i++) {
    const m = /^(-|\d+)\t(-|\d+)\t(.*)$/.exec(parts[i])
    if (!m) continue
    const p = m[3] || (i += 2, parts[i])
    got.push({ path: p, added: Number(m[1]) || 0, removed: Number(m[2]) || 0 })
  }
  return got
}

// Kept out of Commit & push: agent files never get committed, wherever they sit.
const AGENT = /(^|\/)(\.claude|\.superpowers|\.playwright-mcp|docs\/superpowers)(\/|$)|(^|\/)(CLAUDE(\.local)?\.md|AGENTS\.md|skills-lock\.json|\.mcp\.json)$/
export const agentPath = (p: string) => AGENT.test(p)

/** Commit & push's split of git status. A rename touching an agent file stays out whole.
 *  held: deleted in the index but still on disk (untracked on purpose): the deletion ships, the file stays untracked. */
export function shipFiles(listed: RepoFile[]): { take: RepoFile[]; kept: RepoFile[]; held: Set<string> } {
  const held = new Set(listed.filter(f => f.status === 'deleted' && listed.some(u => u.status === 'untracked' && u.path === f.path)).map(f => f.path))
  const rest = listed.filter(f => !(f.status === 'untracked' && held.has(f.path)))
  const out = (f: RepoFile) => agentPath(f.path) || (!!f.from && agentPath(f.from))
  return { take: rest.filter(f => !out(f)), kept: rest.filter(out), held }
}
const shown = (f: RepoFile) => (f.from ? `${f.from} → ${f.path}` : f.path)
const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join('\0') === [...b].sort().join('\0')
const isLink = (p: string) => { try { return fs.lstatSync(p).isSymbolicLink() } catch { return false } }

// Never rewritten: binaries and lockfiles.
const RAW = /\.(vsix|png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|woff2?|ttf|otf|mp[34]|mov|wasm|exe|dll|so|dylib)$|(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|Cargo\.lock|poetry\.lock)$/i

type Scrubbed = { n: number; saved: Map<string, Buffer> }

/** Strips invisible characters from the lines this commit adds (lines already in HEAD stay as they are), in the working tree before staging.
 *  Skips symlinks, files with a NUL in the first 8 KB, and anything not plain UTF-8. saved: originals, for putBack. */
async function scrub(root: string, files: RepoFile[]): Promise<Scrubbed> {
  const got: Scrubbed = { n: 0, saved: new Map() }
  for (const f of files) {
    if (f.status === 'deleted' || RAW.test(f.path)) continue
    const full = path.join(root, f.path)
    if (!(await fs.promises.lstat(full).catch(() => undefined))?.isFile()) continue
    const buf = await fs.promises.readFile(full)
    if (buf.subarray(0, 8192).includes(0)) continue
    const raw = buf.toString('utf8')
    if (!Buffer.from(raw).equals(buf)) continue
    // ponytail: line multiset, not a real diff; a moved line counts as old.
    const head = await git(root, ['show', `HEAD:${f.from ?? f.path}`])
    const old = new Map<string, number>()
    if (head.ok) for (const l of head.out.split('\n')) old.set(l, (old.get(l) ?? 0) + 1)
    let count = 0
    const text = raw.split('\n').map((l, i) => {
      const k = old.get(l)
      if (k) { old.set(l, k - 1); return l }
      const c = cleanInvisible(l, i === 0)
      count += c.count
      return c.text
    }).join('\n')
    if (!count) continue
    got.saved.set(full, buf)
    await fs.promises.writeFile(full, text)
    got.n += count
  }
  return got
}

/** A failed add or commit: restore what scrub changed and stage it as it was. */
async function putBack(root: string, s: Scrubbed, paths: string[], err: string): Promise<GitResult> {
  if (!s.saved.size) return no(err)
  for (const [full, buf] of s.saved) await fs.promises.writeFile(full, buf)
  await stage(root, paths)
  return no(`${err}; cleaned files were put back`)
}
const removed = (n: number) => (n ? `. Removed ${plural(n, 'invisible character')}` : '')

/** git add -A on the paths git can match: a staged rename's old path is gone from disk and index, and add fails on it. */
async function stage(root: string, paths: string[]): Promise<Ran> {
  if (!paths.length) return { ok: true, out: '', err: '' }
  const indexed = new Set((await git(root, [LIT, 'ls-files', '-z', '--', ...paths])).out.split('\0'))
  const real = paths.filter(p => indexed.has(p) || fs.existsSync(path.join(root, p)) || isLink(path.join(root, p)))
  return real.length ? git(root, [LIT, 'add', '-A', '--', ...real]) : { ok: true, out: '', err: '' }
}

/** Unstages everything but keep, so a commit with no pathspec records just those and hooks write the real index. */
async function stageOnly(root: string, keep: string[]): Promise<Ran & { extra: string[] }> {
  const d = await git(root, [LIT, 'diff', '--cached', '--no-renames', '--name-only', '-z'])
  if (!d.ok) return { ...d, extra: [] }
  const k = new Set(keep), extra = d.out.split('\0').filter(p => p && !k.has(p))
  return { ...(extra.length ? await git(root, [LIT, 'reset', '-q', '--', ...extra]) : d), extra }
}

/** After a commit: puts the unstaged paths back as tree had them, skipping any the commit or a hook touched. */
async function restage(root: string, tree: string | undefined, paths: string[]): Promise<void> {
  if (!tree || !paths.length) return
  const names = async (args: string[]) => (await git(root, [LIT, ...args])).out.split('\0')
  const [made, now] = await Promise.all([names(['diff-tree', '--root', '--no-commit-id', '--no-renames', '-r', '--name-only', '-z', 'HEAD']), names(['diff', '--cached', '--no-renames', '--name-only', '-z'])])
  const touched = new Set([...made, ...now])
  const back = paths.filter(p => !touched.has(p))
  if (back.length) await git(root, [LIT, 'reset', '-q', tree, '--', ...back])
}

/** The message without attribution trailers. */
export const cleanMessage = (text: string) => text.split('\n').filter(l => !/^\s*(co-authored-by|claude-session):/i.test(l)).join('\n').trim()

const LANE_FORMAT = '--format=%h%x00%an%x00%ae%x00%ct%x00%m%x00%s'

/** HEAD against ref on two lanes, newest first, with the merge base they split at. */
async function readLanes(root: string, ref: string, me: string): Promise<NonNullable<RepoView['lanes']>> {
  const [log, fork] = await Promise.all([
    git(root, ['log', '-12', '--left-right', LANE_FORMAT, `${ref}...HEAD`]),
    git(root, ['merge-base', 'HEAD', ref]),
  ])
  const at = fork.out.trim()
  const base = at ? parseCommits((await git(root, ['log', '-1', LANE_FORMAT, at])).out, me)[0] : undefined
  return { against: ref, ...(base ? { fork: { ...base, side: 'fork' as const } } : {}), commits: parseCommits(log.out, me) }
}

// Keyed by both tips, so a refresh with nothing new runs no merge-tree.
const merges = new Map<string, { key: string; merge: Merge }>()

/** The PR card's data: how this branch stands against its base. Read only: merge-tree writes objects, never the worktree, index, HEAD or refs. */
export async function readMerge(root: string, branch: string, remote: string, prBase?: string): Promise<Merge | undefined> {
  const [head, refs, me] = await Promise.all([
    git(root, ['symbolic-ref', '-q', '--short', `refs/remotes/${remote}/HEAD`]),
    git(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads', `refs/remotes/${remote}`]),
    config(root, 'user.email'),
  ])
  const base = pickBase(prBase, head.out.trim(), refs.out.split('\n').filter(Boolean), remote)
  if (!base || base.name === branch) return undefined
  const tips = await git(root, ['rev-parse', 'HEAD', base.ref])
  if (!tips.ok) return undefined
  const key = `${base.ref} ${tips.out} ${me}`, hit = merges.get(root)
  if (hit?.key === key) return hit.merge
  const [log, count] = await Promise.all([
    git(root, ['log', '-8', '--format=%h%x00%an%x00%ae%x00%ct', `${base.ref}...HEAD`]),
    git(root, ['rev-list', '--count', `HEAD..${base.ref}`]),
  ])
  const merge: Merge = { base: base.name, behind: Number(count.out.trim()) || 0, files: 0, conflicts: [], commits: parseCommits(log.out, me) }
  // Only a base that moved past the merge-base can conflict.
  if (merge.behind) {
    const t = parseMergeTree((await git(root, ['merge-tree', '--write-tree', '-z', '--name-only', '--no-messages', 'HEAD', base.ref])).out)
    if (!t) merge.conflicts = undefined
    else {
      merge.files = t.files.length
      merge.conflicts = await Promise.all(t.files.slice(0, 5).map(async p => {
        const [blob, by] = await Promise.all([
          git(root, ['cat-file', 'blob', `${t.tree}:${p}`]),
          git(root, [LIT, 'log', '-1', '--format=%h%x00%an%x00%ae%x00%ct', `HEAD..${base.ref}`, '--', p]),
        ])
        return { path: p, by: parseCommits(by.out, me)[0]?.author ?? base.name, ...firstConflict(blob.out) }
      }))
    }
  }
  merges.set(root, { key, merge })
  return merge
}

const roots = new Map<string, string>()
export const repoRoot = async (cwd: string) => {
  const hit = roots.get(cwd)
  if (hit && fs.existsSync(path.join(hit, '.git')) && !(cwd !== hit && fs.existsSync(path.join(cwd, '.git')))) return hit
  roots.delete(cwd)
  const r = await git(cwd, ['rev-parse', '--show-toplevel'])
  if (!r.ok) return undefined
  const root = r.out.trim()
  roots.set(cwd, root)
  return root
}

/** The worktree's folder and its main checkout, or undefined in a plain checkout (git dir equals the common dir). */
async function worktreeOf(root: string): Promise<{ wt: string; main: string } | undefined> {
  const r = await git(root, ['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir', '--show-toplevel'])
  const [dir, common, top] = r.out.trim().split('\n')
  return r.ok && top && dir !== common && path.basename(common) === '.git' ? { wt: top, main: path.dirname(common) } : undefined
}

const WT_DIR = /^(.*[\\/]\.claude[\\/]worktrees[\\/][^\\/]+)/

const WT_IDLE_MS = 10 * 60_000
const WT_FAST_MS = 2 * 60_000
const wasLive = new WeakMap<Map<string, number | undefined>, Set<string>>()
export const realOf = (p: string) => { try { return fs.realpathSync.native(p) } catch { return p } }

/**
 * Worktree folders that have had no live chat for 10 minutes straight. seen carries the state between calls:
 * a worktree maps to when it was first seen without a live chat, or undefined while one is live. Keys are real paths.
 * fast collects the ones a chat was seen live in that have had none for 2 minutes, so a live flag that blinks off for a refresh
 * or two never removes a folder under a running chat. Never seen live: the 10 minutes.
 */
export function endedWorktrees(seen: Map<string, number | undefined>, chats: { live: boolean; cwd: string }[], now = Date.now(), onDisk: string[] = [], fast: string[] = []): string[] {
  const live = new Set(chats.flatMap(c => { const w = c.live ? WT_DIR.exec(c.cwd)?.[1] : undefined; return w ? [realOf(w)] : [] }))
  // Left over from before a reload, or from a chat that moved in after starting: start its clock now.
  for (const w of onDisk.map(realOf)) if (!live.has(w) && !seen.has(w)) seen.set(w, now)
  const ended: string[] = []
  for (const [w, since] of seen) {
    if (live.has(w)) continue
    const had = wasLive.get(seen) ?? wasLive.set(seen, new Set()).get(seen)!
    if (since === undefined) { seen.set(w, now); had.add(w) }
    else if (now - since >= WT_IDLE_MS) { ended.push(w); seen.delete(w); had.delete(w) }
    else if (had.has(w) && now - since >= WT_FAST_MS) { fast.push(w); had.delete(w) }
  }
  for (const w of live) seen.set(w, undefined)
  return ended
}

/** Chats for the sweep: a chat killed without SessionEnd (a window reload) keeps its progress row, so its worktree counts as live until a resume or the row goes stale. */
export const sweepChats = (chats: { live: boolean; cwd: string }[], progress: { cwd: string }[]) => [...chats, ...progress.map(p => ({ live: true, cwd: p.cwd }))]

/** Folders under <repo>/.claude/worktrees for the repos these chats run in, plus any other repo roots given (every known project). */
export function worktreeDirs(cwds: string[], extra: string[] = []): string[] {
  const roots = new Set([...cwds.map(c => WT_DIR.exec(c)?.[1].replace(/[\\/]\.claude[\\/]worktrees[\\/][^\\/]+$/, '') ?? c), ...extra])
  return [...roots].flatMap(r => { const d = path.join(r, '.claude', 'worktrees'); try { return fs.readdirSync(d).map(n => path.join(d, n)) } catch { return [] } })
}

/** repo/.claude/worktrees/<slug> on branch worktree-<slug>, from the repo's HEAD, so the chat starts in it as a plain checkout. */
export async function addWorktree(repo: string, slug: string): Promise<{ ok: true; dir: string } | { ok: false; error: string }> {
  if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(slug)) return { ok: false, error: 'Not a usable worktree name' }
  const dir = path.join(repo, '.claude', 'worktrees', slug)
  const r = await git(repo, ['worktree', 'add', '-q', '-b', `worktree-${slug}`, dir, 'HEAD'], SLOW)
  if (!r.ok) return { ok: false, error: `Could not create the worktree: ${why(r)}` }
  // Where it starts, for otherFork; the reflog says so too but expires.
  const start = (await git(dir, ['rev-parse', 'HEAD'])).out.trim()
  if (start) await git(repo, ['config', `branch.worktree-${slug}.switchboardFork`, start])
  excludeWorktrees(repo)
  return { ok: true, dir }
}

/** The branch's PR state on GitHub when its head is exactly this commit; undefined with no gh, no GitHub remote or another head. */
async function prState(main: string, branch: string, sha: string): Promise<string | undefined> {
  const gh = await ghPath()
  const repo = githubRepo((await git(main, ['remote', 'get-url', 'origin'])).out)
  if (!gh || !repo) return undefined
  const r = await exec(gh, ['pr', 'view', branch, '--repo', repo.replace('https://github.com/', ''), '--json', 'state,headRefOid'], QUICK, main)
  try { const j = JSON.parse(r.out); return j.headRefOid === sha ? String(j.state) : undefined } catch { return undefined }
}

const pidAlive = (pid: number) => { try { process.kill(pid, 0); return true } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM' } }

/** Unlocks a worktree whose lock names a pid that is no longer running (Claude Code locks its own). False while it stays locked. */
async function unlockStale(main: string, wt: string): Promise<boolean> {
  const block = (await git(main, ['worktree', 'list', '--porcelain'])).out.split('\n\n').find(b => b.split('\n')[0] === `worktree ${wt}`)
  const lock = block?.split('\n').find(l => l === 'locked' || l.startsWith('locked '))
  if (lock === undefined) return true
  const pid = /\bpid (\d+)/.exec(lock)?.[1]
  if (!pid || pidAlive(Number(pid))) return false
  return (await git(main, ['worktree', 'unlock', wt])).ok
}

/**
 * Removes a worktree with no changes once its work is merged: its branch is in the main checkout's HEAD, or its PR is merged
 * on GitHub with that very head (a squash never makes an ancestor, so the branch goes with -D). Anything else stays. Never forced.
 * Its gitignored files are copied to .git/switchboard-merged first; if that fails it stays.
 */
export async function cleanWorktree(wt: string, pr: (main: string, branch: string, sha: string) => Promise<string | undefined> = prState): Promise<boolean> {
  const w = await worktreeOf(wt)
  if (!w || !fs.existsSync(wt)) return false
  const branch = (await git(wt, ['rev-parse', '--abbrev-ref', 'HEAD'])).out.trim()
  if (!branch || branch === 'HEAD') return false
  if ((await status(wt)).files.length) return false
  const ancestor = (await git(w.main, ['merge-base', '--is-ancestor', branch, 'HEAD'])).ok
  if (!ancestor && await pr(w.main, branch, (await git(wt, ['rev-parse', 'HEAD'])).out.trim()) !== 'MERGED') return false
  if (!(await unlockStale(w.main, w.wt))) return false
  const kept = keptDir(w.main, w.wt)
  try { await saveIgnored(w.wt, path.join(kept, 'ignored')) } catch { fs.rmSync(kept, { recursive: true, force: true }); return false }
  if (!(await git(w.main, ['worktree', 'remove', w.wt])).ok) { fs.rmSync(kept, { recursive: true, force: true }); return false }
  await git(w.main, ['branch', ancestor ? '-d' : '-D', branch])
  return true
}

/** True for a worktree folder (real path) that a live chat runs in. held: counts a chat the live flag misses (a Codex terminal still open). */
export const liveIn = (chats: { live: boolean; cwd: string; sessionId?: string }[], held: (sessionId: string) => boolean = () => false) => (wt: string) =>
  chats.some(c => { if (!c.live && !(c.sessionId && held(c.sessionId))) return false; const d = realOf(c.cwd); return d === wt || d.startsWith(wt + path.sep) })

/** Worktree chats (sessionId to cwd) that merge back once the chat ends: queued by Approve, or by Merge into main while the chat runs. A reload drops it; Merge all picks those up. */
export const mergeOnEnd = new Map<string, string>()
export const inWorktree = (cwd: string) => WT_DIR.test(cwd)
/** Takes the queued worktrees whose chat has ended off the queue and returns [sessionId, folder] pairs. */
export function endedMerges(queue: Map<string, string>, live: (wt: string) => boolean): [string, string][] {
  const out: [string, string][] = []
  for (const [id, cwd] of queue) {
    const wt = WT_DIR.exec(cwd)?.[1]
    if (!wt || !fs.existsSync(wt)) { queue.delete(id); continue }
    if (live(realOf(wt))) continue
    queue.delete(id)
    out.push([id, wt])
  }
  return out
}

const RETRY_MS = 10 * 60_000
/** The worktree folder a path is in, if any. */
export const worktreeFolder = (cwd: string) => WT_DIR.exec(cwd)?.[1]
/** The checkout a worktree folder hangs off. */
export const mainOf = (wt: string) => wt.replace(/[\\/]\.claude[\\/]worktrees[\\/][^\\/]+$/, '')
/** Auto merge: queues a worktree whose chat ended, keyed by its folder. Not while Approve already queued it or any window tried it in the last 10 minutes. */
export function queueEnded(queue: Map<string, string>, wt: string, on = true, now = Date.now()): void {
  if (!on || [...queue.values()].some(c => { const q = worktreeFolder(c); return !!q && realOf(q) === realOf(wt) })) return
  if (!triedLately(wt, now)) queue.set(wt, wt)
}
/** Any window tried this worktree in the last 10 minutes. */
export const triedLately = (wt: string, now = Date.now()) => now - (mergeNote(mainOf(wt))?.tried?.[path.basename(wt)] ?? 0) < RETRY_MS

export type Check = (dir: string) => Promise<{ ok: boolean; text: string }>
const CHECK_MS = 10 * 60_000

/** The repo's own checks: the root package.json's typecheck and test scripts, run with the lockfile's package manager. No package.json: nothing to run. */
export const repoChecks: Check = async dir => {
  let scripts: Record<string, string>
  try { scripts = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).scripts ?? {} } catch { return { ok: true, text: 'no checks found' } }
  const pm = fs.existsSync(path.join(dir, 'pnpm-lock.yaml')) ? 'pnpm' : fs.existsSync(path.join(dir, 'yarn.lock')) ? 'yarn' : 'npm'
  const bin = await cliPath(pm) ?? pm
  const run = ['typecheck', 'test'].filter(s => scripts[s])
  for (const s of run) {
    const r = await exec(bin, ['run', s], CHECK_MS, dir)
    if (!r.ok) return { ok: false, text: `${pm} run ${s} failed` }
  }
  return { ok: true, text: run.length ? `${run.join(' and ')} passed` : 'no checks found' }
}

/** The branch a worktree merges into: whatever the repo's checkout is on. undefined on a detached HEAD. */
export const checkoutBranch = async (main: string) => (await git(main, ['symbolic-ref', '-q', '--short', 'HEAD'])).out.trim() || undefined

/** Where the worktree's branch was made, when the checkout has since moved to a branch without that commit; else undefined. */
async function otherFork(main: string, wt: string): Promise<string | undefined> {
  const branch = (await git(wt, ['symbolic-ref', '-q', 'HEAD'])).out.trim()
  if (!branch) return undefined
  // Saved when Switchboard made it; else the reflog's first entry (one cut short by expiry is not the start, so it does not count).
  const saved = await config(wt, `${branch.replace(/^refs\/heads\//, 'branch.')}.switchboardFork`)
  const [first, how] = (await git(wt, ['log', '-g', '--format=%H%x09%gs', branch, '--'])).out.trim().split('\n').at(-1)!.split('\t')
  const sha = saved || (/^branch: Created from/.test(how ?? '') ? first : '')
  if (!sha) return undefined
  if ((await git(main, ['merge-base', '--is-ancestor', sha, 'HEAD'])).ok) return undefined
  return (await git(wt, ['merge-base', '--is-ancestor', sha, 'HEAD'])).ok ? sha : undefined
}

/** The worktree's work as one binary patch against where it forked from main's HEAD (or started, see otherFork): its commits plus every uncommitted and new file. */
async function worktreePatch(main: string, wt: string): Promise<Ran & { base?: string }> {
  const head = (await git(wt, ['rev-parse', 'HEAD'])).out.trim()
  const base = await otherFork(main, wt) ?? (await git(main, ['merge-base', 'HEAD', head])).out.trim()
  if (!head || !base) return { ok: false, out: '', err: 'no common commit with main' }
  // A throwaway index, so the worktree's own index is never touched.
  const idx = path.join(os.tmpdir(), `sb-merge-${process.pid}-${Date.now()}`)
  const inIdx = (args: string[]) => new Promise<Ran>(done => execFile('git', ['-C', wt, ...args], { timeout: SLOW, maxBuffer: 8 << 20, windowsHide: true, env: { ...ENV, GIT_INDEX_FILE: idx } },
    (err, out, e) => done({ ok: !err, out: String(out), err: String(e) || err?.message || '' })))
  try {
    for (const args of [['read-tree', 'HEAD'], ['add', '-A']]) { const r = await inIdx(args); if (!r.ok) return r }
    const tree = await inIdx(['write-tree'])
    if (!tree.ok) return tree
    return { ...await git(wt, ['diff', '--binary', base, tree.out.trim()], SLOW), base }
  } finally { fs.rmSync(idx, { force: true }) }
}

// Buffers, not git(): its utf8 string would mangle any file that is not utf8.
const gitBuf = (args: string[]) => new Promise<{ code: number; out: Buffer }>(done => execFile('git', args, { encoding: 'buffer', timeout: SLOW, maxBuffer: 64 << 20, windowsHide: true, env: ENV },
  (err, out) => done({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, out })))

/**
 * For a patch that clashes with main: each file merged three-way from base with git merge-file, all or nothing. Renames, mode changes,
 * binaries and links are left to a person. Returns how to put main's copies back, or the files that conflict.
 */
async function mergeThreeWay(main: string, wt: string, base: string, patch: string, skip: string[]): Promise<{ undo: () => Promise<Ran> } | { clash: string[]; err?: string }> {
  if (/^(rename from|copy from|old mode|new mode|GIT binary patch)/m.test(patch)) return { clash: [] }
  const list = await git(main, ['apply', '--numstat', '-z', ...skip.map(f => `--exclude=${f}`)], SLOW, patch)
  if (!list.ok) return { clash: [] }
  const files = list.out.split('\0').filter(Boolean).map(r => r.split('\t').slice(2).join('\t'))
  const read = (p: string) => {
    let s: fs.Stats
    try { s = fs.lstatSync(p) } catch { return undefined }
    return s.isFile() ? { buf: fs.readFileSync(p), mode: s.mode } : 'other' as const
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-merge3-'))
  const plan: { f: string; was?: { buf: Buffer; mode: number }; next?: { buf: Buffer; mode: number } }[] = [], clash: string[] = []
  try {
    for (const f of files) {
      const mine = read(path.join(main, f)), theirs = read(path.join(wt, f))
      if (mine === 'other' || theirs === 'other') { clash.push(f); continue }
      const b = await gitBuf(['-C', main, 'cat-file', 'blob', `${base}:${f}`])
      const was = b.code ? undefined : b.out
      if (!theirs) {
        // Deleted in the worktree: only if main still has base's copy.
        if (mine && was && mine.buf.equals(was)) plan.push({ f, was: mine })
        else if (mine) clash.push(f)
        continue
      }
      if (!mine) { if (was) clash.push(f); else plan.push({ f, next: theirs }); continue }
      // Added on both sides: main's copy is its own work, even when empty.
      if (!was) { clash.push(f); continue }
      if (mine.buf.equals(was)) { plan.push({ f, was: mine, next: { buf: theirs.buf, mode: mine.mode } }); continue }
      const [o, a, t] = ['main', 'base', 'worktree'].map(n => path.join(tmp, n))
      fs.writeFileSync(o, mine.buf); fs.writeFileSync(a, was); fs.writeFileSync(t, theirs.buf)
      // Exit code = conflict count.
      const m = await gitBuf(['merge-file', '-p', o, a, t])
      if (m.code) clash.push(f)
      else plan.push({ f, was: mine, next: { buf: m.out, mode: mine.mode } })
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  if (clash.length || !plan.length) return { clash }
  const put = (f: string, v?: { buf: Buffer; mode: number }) => {
    const p = path.join(main, f)
    if (!v) { fs.rmSync(p, { force: true }); return }
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, v.buf)
    fs.chmodSync(p, v.mode & 0o7777)
  }
  const undo = async (): Promise<Ran> => {
    try { for (const s of plan) put(s.f, s.was); return { ok: true, out: '', err: '' } } catch (err) { return { ok: false, out: '', err: (err as Error).message } }
  }
  try { for (const s of plan) put(s.f, s.next) } catch (err) { const back = await undo(); return { clash: [], err: `could not write the merge (${(err as Error).message})${back.ok ? '' : `, and putting main back failed (${back.err}); check main`}` } }
  return { undo }
}

/** Gitlinks (nested repos) in the patch that main does not track as one: the patch carries only their commit id, and removing the folder deletes them. */
async function newGitlinks(main: string, patch: string): Promise<string[]> {
  const links = new Set<string>()
  let file = ''
  for (const l of patch.split('\n')) {
    const d = /^diff --git a\/.* b\/(.*)$/.exec(l)
    if (d) file = d[1]
    else if (/^(new file mode|new mode|index \S+) 160000$/.test(l)) links.add(file)
  }
  const out: string[] = []
  for (const f of links) if (!(await git(main, [LIT, 'ls-files', '-s', '--', f])).out.startsWith('160000')) out.push(f)
  return out
}

/** Patch files the main checkout already holds byte for byte (copied in by hand), so the apply skips them instead of clashing. */
function sameInMain(main: string, wt: string, patch: string): string[] {
  // lstat, so a link is compared as a link and a dangling one is not "missing"; mode counts too.
  const sig = (f: string) => {
    let s: fs.Stats
    try { s = fs.lstatSync(f) } catch { return 'none' }
    if (s.isSymbolicLink()) return `link:${fs.readlinkSync(f)}`
    if (!s.isFile()) return undefined
    return `file:${s.mode & 0o111 ? 'x' : '-'}:${fs.readFileSync(f).toString('base64')}`
  }
  // git C-quotes names with non-ASCII bytes or odd characters: "caf\303\251".
  const unq = (s: string) => {
    if (!s.startsWith('"')) return s
    const esc: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13 }
    const b: number[] = []
    for (let i = 1; i < s.length - 1; i++) {
      if (s[i] !== '\\') { b.push(...Buffer.from(s[i])); continue }
      const o = /^[0-7]{3}/.exec(s.slice(i + 1))
      if (o) { b.push(parseInt(o[0], 8)); i += 3 } else { i++; b.push(esc[s[i]] ?? s.charCodeAt(i)) }
    }
    return Buffer.from(b).toString('utf8')
  }
  const files: { a?: string; b?: string; ren?: boolean }[] = []
  for (const l of patch.split('\n')) {
    if (l.startsWith('diff --git ')) {
      // Backreference: only an unrenamed file has the same name twice, so spaces in it cannot mislead the split.
      const d = /^diff --git (?:"a\/(.*)" "b\/\1"|a\/(.*) b\/\2)$/.exec(l)
      const f = d ? (d[1] !== undefined ? unq(`"${d[1]}"`) : d[2]) : undefined
      files.push({ a: f, b: f })
    }
    const r = /^rename (from|to) (.*)$/.exec(l)
    if (r && files.length) Object.assign(files[files.length - 1], { [r[1] === 'from' ? 'a' : 'b']: unq(r[2]), ren: true })
  }
  const out: string[] = []
  for (const { a, b, ren } of files) {
    // Glob characters would make --exclude skip other files too.
    if (!a || !b || (ren ? a === b : a !== b) || /[*?[\\]/.test(a + b)) continue
    const s = sig(path.join(main, b))
    if (s === undefined || s !== sig(path.join(wt, b))) continue
    // A rename is merged only once the old name is gone from main too; -R matches the old name, so exclude both.
    if (ren && (sig(path.join(main, a)) !== 'none' || sig(path.join(wt, a)) !== 'none')) continue
    out.push(...(ren ? [a, b] : [b]))
  }
  return out
}

const mergeLock = (main: string) => path.join(main, '.git', 'switchboard-merge.lock')
const ranFile = (main: string) => path.join(main, '.git', 'switchboard-merge-ran')
// Touched before every step, so only a lock nobody touched for longer than one worktree's checks is from a crash.
const LOCK_STALE_MS = 2 * CHECK_MS + 5 * 60_000
/** One merge-all per repo across every window. The token lets a run drop only its own lock. */
function takeLock(main: string): string | undefined {
  const f = mergeLock(main), token = `${process.pid}-${Math.random().toString(36).slice(2)}`
  try { if (Date.now() - fs.statSync(f).mtimeMs > LOCK_STALE_MS) fs.rmSync(f, { force: true }) } catch { /* none */ }
  try { fs.writeFileSync(f, token, { flag: 'wx' }); return token } catch { return undefined }
}
const touchLock = (main: string) => { try { const t = new Date(); fs.utimesSync(mergeLock(main), t, t) } catch { /* gone */ } }
function dropLock(main: string, token: string): void {
  try { if (fs.readFileSync(mergeLock(main), 'utf8') === token) fs.rmSync(mergeLock(main), { force: true }) } catch { /* gone */ }
}
/** True while any window merges a worktree into this repo. */
export const mergeBusy = (main: string) => { try { return Date.now() - fs.statSync(mergeLock(main)).mtimeMs < LOCK_STALE_MS && pidAlive(parseInt(fs.readFileSync(mergeLock(main), 'utf8'), 10)) } catch { return false } }
const autoOff = (main: string) => path.join(main, '.git', 'switchboard-no-auto-merge')
/** Worktrees of this repo merge on their own unless turned off on Ship; a file in .git, so every window reads the same. */
export const autoMergeOn = (main: string) => !fs.existsSync(autoOff(main))
export function setAutoMerge(main: string, on: boolean): void {
  if (on) fs.rmSync(autoOff(main), { force: true })
  else fs.writeFileSync(autoOff(main), '')
  repoCache.clear()
}
const noteFile = (main: string) => path.join(main, '.git', 'switchboard-merge-note')
export type MergeNote = { text: string; ok: boolean; at: number; /** Worktree name to when it was last tried. */ tried?: Record<string, number> }
/** The last worktree merge in this repo, by any window. */
export function mergeNote(main: string): MergeNote | undefined {
  try { const n = JSON.parse(fs.readFileSync(noteFile(main), 'utf8')) as MergeNote; return typeof n.text === 'string' && typeof n.at === 'number' ? n : undefined } catch { return undefined }
}
function noteMerge(main: string, r: GitResult, names: string[], now = Date.now()): void {
  const old = Object.entries(mergeNote(main)?.tried ?? {}).filter(([, at]) => now - at < RETRY_MS)
  const tried = Object.fromEntries([...old, ...names.map(n => [n, now] as const)])
  try { fs.writeFileSync(noteFile(main), JSON.stringify({ text: r.text, ok: r.ok, at: now, tried })) } catch { /* only the note is lost */ }
}
/** When any window last finished a merge-all in this repo (0: never). */
export const lastMergeRun = (main: string) => { try { return fs.statSync(ranFile(main)).mtimeMs } catch { return 0 } }

// Rebuilt by an install, so not worth a copy.
const REBUILT = new Set(['node_modules', '.next', 'dist', 'build', 'out', '.turbo', 'coverage'])
const keptDir = (main: string, wt: string) => path.join(main, '.git', 'switchboard-merged', `${path.basename(wt)}-${Date.now()}-${randomBytes(4).toString('hex')}`)
/** Copies the worktree's gitignored files (env files, local settings, notes) next to its patch, since the patch leaves them out. */
async function saveIgnored(wt: string, dir: string): Promise<void> {
  const r = await git(wt, ['ls-files', '-o', '-i', '--exclude-standard', '--directory', '-z'])
  if (!r.ok) throw new Error(why(r))
  for (const f of r.out.split('\0').filter(Boolean)) {
    if (f.replace(/\/$/, '').split('/').some(p => REBUILT.has(p))) continue
    fs.cpSync(path.join(wt, f), path.join(dir, f), { recursive: true })
  }
}

/** The repo's Switchboard worktrees on disk, as real paths. */
export const worktreesOf = async (main: string) => (await git(main, ['worktree', 'list', '--porcelain'])).out.split('\n\n').map(b => b.split('\n')[0].replace(/^worktree /, ''))
  .filter(w => WT_DIR.test(w) && fs.existsSync(w)).map(realOf)

/**
 * Merge all: every worktree under <main>/.claude/worktrees with no live chat goes into the branch the main checkout is on, as uncommitted
 * changes, so Kenneth commits it like any other work. Checks run on main first, then after each worktree; one that breaks them, does not apply
 * cleanly or changes while its checks run is undone and kept. A merged worktree is removed; its patch and gitignored files stay in
 * .git/switchboard-merged. live is asked again before each removal. Never commits, never pushes. only: just that worktree (Merge back).
 */
export async function mergeWorktrees(root: string, live: (wt: string) => boolean, check: Check = repoChecks, only?: string): Promise<GitResult> {
  const main = (await worktreeOf(root))?.main ?? root
  const all = (await worktreesOf(main)).filter(w => !only || w === realOf(only))
  const idle = all.filter(w => !live(w))
  if (!idle.length) return no(all.length ? 'Every worktree still has a chat running in it' : 'No worktrees to merge')
  const token = takeLock(main)
  if (!token) return no('A merge is already running for this repo')
  const into = await checkoutBranch(main) ?? 'the main checkout'
  let last: GitResult | undefined
  try {
    const first = await check(main)
    if (!first.ok) return last = no(`Checks already fail in the main checkout (${first.text}), so nothing was merged`)
    const merged: string[] = [], kept: string[] = []
    const undo = async (name: string, rev: () => Promise<Ran>, why1: string) => {
      const back = await rev()
      kept.push(back.ok ? `${name}: ${why1}, undone` : `${name}: ${why1}, and undoing it failed (${why(back)}); check main`)
    }
    for (const wt of idle) {
      const name = path.basename(wt)
      touchLock(main)
      if (!(await unlockStale(main, wt))) { kept.push(`${name}: a chat holds it`); continue }
      const p = await worktreePatch(main, wt)
      if (!p.ok) { kept.push(`${name}: ${why(p)}`); continue }
      const nested = await newGitlinks(main, p.out)
      if (nested.length) { kept.push(`${name}: holds a nested git repo (${nested.join(', ')}) that would be lost`); continue }
      const skip = sameInMain(main, wt, p.out)
      let rev = () => git(main, ['apply', '-R', '--binary', ...skip.map(f => `--exclude=${f}`)], SLOW, p.out)
      if (p.out.trim()) {
        const a = await git(main, ['apply', '--binary', ...skip.map(f => `--exclude=${f}`)], SLOW, p.out)
        if (!a.ok) {
          const m: Awaited<ReturnType<typeof mergeThreeWay>> = p.base ? await mergeThreeWay(main, wt, p.base, p.out, skip) : { clash: [] }
          if ('clash' in m) { kept.push(`${name}: clashes with ${into} (${m.clash.length ? `both changed the same lines in ${m.clash.join(', ')}` : m.err ?? why(a)})`); continue }
          rev = m.undo
        }
        const c = await check(main)
        touchLock(main)
        if (!c.ok) { await undo(name, rev, c.text); continue }
      }
      // Anything written there while the checks ran would go with the folder.
      const again = await worktreePatch(main, wt)
      if (live(wt) || !again.ok || again.out !== p.out) {
        const reason = live(wt) ? 'a chat started in it' : 'it changed while merging'
        if (p.out.trim()) await undo(name, rev, reason); else kept.push(`${name}: ${reason}`)
        continue
      }
      const dir = path.join(main, '.git', 'switchboard-merged', `${name}-${Date.now()}`)
      try {
        fs.mkdirSync(dir, { recursive: true })
        if (p.out.trim()) fs.writeFileSync(path.join(dir, 'work.patch'), p.out)
        await saveIgnored(wt, path.join(dir, 'ignored'))
      } catch (err) {
        merged.push(`${name} (folder stayed: could not copy its ignored files, ${(err as Error).message})`)
        continue
      }
      const branch = (await git(wt, ['rev-parse', '--abbrev-ref', 'HEAD'])).out.trim()
      // Forced: its work is in main and its ignored files are copied. The branch goes only if git sees it merged, so unmerged commits keep a ref.
      const rm = await git(main, ['worktree', 'remove', '--force', wt])
      if (rm.ok && branch && branch !== 'HEAD') await git(main, ['branch', '-d', branch])
      merged.push(rm.ok ? name : `${name} (folder stayed: ${why(rm)})`)
    }
    const text = [merged.length ? `Merged ${merged.join(', ')} into ${into} as uncommitted changes; ${first.text}` : 'Nothing merged',
      kept.length ? `Kept ${kept.join('; ')}` : '', idle.length < all.length ? `${plural(all.length - idle.length, 'worktree')} with a running chat left alone` : '']
    return last = { ok: merged.length > 0, text: text.filter(Boolean).join('. ') + '. Nothing was committed or pushed' }
  } finally {
    if (last) noteMerge(main, last, idle.map(w => path.basename(w)))
    // One worktree's merge is not the quiet sweep.
    if (!only) try { fs.writeFileSync(ranFile(main), String(Date.now())) } catch { /* next run just repeats */ }
    dropLock(main, token)
  }
}

export const QUIET_MS = 15 * 60_000
export type MergeClock = { seen: Set<string>; since: Map<string, number>; fired: Map<string, number> }
/**
 * Repo roots due an automatic merge-all: worktrees on disk and 15 minutes since the last chat this window had not seen started there.
 * After a reload every chat is new, so the clock starts over. One run per quiet spell, in any window (ranAt: the repo's last run).
 */
export function mergeDue(m: MergeClock, chats: { sessionId: string; cwd: string }[], roots: string[], now = Date.now(),
  dirsOf = (r: string) => worktreeDirs([], [r]), ranAt: (r: string) => number = lastMergeRun): string[] {
  for (const c of chats) {
    if (m.seen.has(c.sessionId)) continue
    m.seen.add(c.sessionId)
    const r = roots.find(r => c.cwd === r || c.cwd.startsWith(r + path.sep))
    if (r) m.since.set(r, now)
  }
  return roots.filter(r => {
    const since = m.since.get(r) ?? m.since.set(r, now).get(r)!
    if (now - since < QUIET_MS || ranAt(r) >= since || m.fired.get(r) === since || !dirsOf(r).length) return false
    m.fired.set(r, since)
    return true
  })
}

type RepoCache = { at: number; key: string; view: Omit<RepoView, 'sessionId' | 'busy' | 'result'>; dirs: string[] }
// Under a minute, so an idle chat's once-a-minute read is a full one.
const KEEP_READ_MS = 45_000
const repoCache = new Map<string, RepoCache>()
let repoClock = () => Date.now()
export const setRepoClock = (clock?: () => number) => { repoClock = clock ?? (() => Date.now()) }
export const repoReadKey = (root: string) => { const hit = repoCache.get(root); return hit ? `${hit.at}\n${hit.key}` : undefined }
const statKey = (file: string) => { try { const s = fs.lstatSync(file); return `${s.mtimeMs}:${s.size}` } catch { return '' } }
function cacheKey(root: string, out: string, dirs: string[]): string {
  const status = parseRepoStatus(out)
  const files = status.files.flatMap(f => [f.path, ...(f.from ? [f.from] : [])]).map(f => `${f}:${statKey(path.join(root, f))}`)
  const meta = dirs.flatMap(d => {
    const refs: string[] = []
    const walk = (refdir: string) => {
      try {
        for (const name of fs.readdirSync(refdir)) {
          const file = path.join(refdir, name)
          refs.push(path.relative(d, file))
          if (fs.lstatSync(file).isDirectory()) walk(file)
        }
      } catch { /* no refs */ }
    }
    walk(path.join(d, 'refs/remotes'))
    walk(path.join(d, 'refs/heads'))
    return ['HEAD', 'index', 'packed-refs', 'logs/HEAD', 'FETCH_HEAD', 'config', 'refs/stash', 'switchboard-no-auto-merge', ...refs].map(f => `${d}/${f}:${statKey(path.join(d, f))}`)
  })
  return `${out}\n${files.join('|')}\n${meta.join('|')}`
}
const statusHead = (out: string) => { const head = out.split('\0').find(line => line.startsWith('# branch.oid '))?.slice(13); return head && head !== '(initial)' ? head : undefined }
export async function readRepo(root: string, gh?: string): Promise<Omit<RepoView, 'sessionId' | 'busy' | 'result'>> {
  const check = await git(root, ['status', '--porcelain=v2', '--branch', '-z', '-uall'])
  if (!check.ok) throw new Error(why(check))
  let cached = repoCache.get(root)
  if (!cached) {
    const dirs = await git(root, ['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir'])
    cached = { at: 0, key: '', view: undefined as never, dirs: dirs.out.trim().split('\n').filter(Boolean) }
  }
  const key = cacheKey(root, check.out, cached.dirs)
  if (cached.at && repoClock() - cached.at < KEEP_READ_MS && key === cached.key) {
    const view = { ...cached.view, at: Date.now() }
    return withPending(root, statusHead(check.out), view)
  }
  const [s, heads, log, stash] = await Promise.all([Promise.resolve(parseRepoStatus(check.out)), branches(root), git(root, ['log', '-15', '--format=%h%x09%s%x09%ar']), git(root, ['stash', 'list', '--format=%gd'])])
  const remote = (s.branch && (await config(root, `branch.${s.branch}.remote`))) || 'origin'
  const github = githubRepo((await git(root, ['remote', 'get-url', remote])).out)
  const pr = github && gh && s.branch && s.upstream ? await prFor(root, github, (await pushTarget(root, s)).name, gh) : undefined
  const merge = s.branch ? await readMerge(root, s.branch, remote, pr?.base).catch(() => undefined) : undefined
  // The card's lanes: a branch against its base (the remote one when there is one), main against its upstream.
  const baseRef = merge && ((await git(root, ['rev-parse', '--verify', '-q', `${remote}/${merge.base}`])).ok ? `${remote}/${merge.base}` : merge.base)
  const against = baseRef ?? s.upstream
  const me = await config(root, 'user.email')
  const lanes = against ? await readLanes(root, against, me).catch(() => undefined) : undefined
  const sent = s.upstream ?? baseRef
  const outgoing = sent ? parseNumstat((await git(root, [LIT, 'diff', '--numstat', '-z', `${sent}...HEAD`])).out) : undefined
  const ci = github && gh && s.branch && s.upstream ? await runFor(root, github, (await pushTarget(root, s)).name, gh).catch(() => undefined) : undefined
  const ship = (({ take, kept }) => ({ files: take.map(f => f.path), kept: kept.map(shown) }))(shipFiles(s.files))
  const view = {
    merge, ...(lanes ? { lanes } : {}), ...(outgoing ? { outgoing } : {}), ship,
    ...await (async () => { const w = await worktreeOf(root), into = w && await checkoutBranch(w.main); return w ? { worktree: true, auto: autoMergeOn(w.main), ...(into ? { into } : {}) } : {} })(),
    name: path.basename(root), branch: s.branch, upstream: s.upstream, ahead: s.ahead, behind: s.behind, files: s.files, branches: heads, sync: syncAction(s),
    log: log.out.split('\n').filter(Boolean).map(l => { const [hash, subject, when] = l.split('\t'); return { hash, subject: subject ?? '', when: when ?? '' } }),
    stashes: stash.out.split('\n').filter(Boolean).length, github, pr, ...(ci ? { ci } : {}), at: Date.now(),
  }
  repoCache.set(root, { at: repoClock(), key, view, dirs: cached.dirs })
  return withPending(root, statusHead(check.out), view)
}
const withPending = (root: string, head: string | undefined, view: Omit<RepoView, 'sessionId' | 'busy' | 'result'>) => {
  const p = pendingAt(root, head)
  return { ...view, ...(p ? { pending: { text: leftovers(p.text, view.ship?.files ?? []), last: p.last, at: p.at } } : {}) }
}

/** Deletes untracked files one by one, only plain paths whose folder stays inside the repo. */
async function removeUntracked(root: string, files: RepoFile[]): Promise<string | undefined> {
  const top = await fs.promises.realpath(root)
  for (const f of files) {
    const full = path.join(root, f.path)
    const dir = await fs.promises.realpath(path.dirname(full)).catch(() => '')
    if (dir !== top && !dir.startsWith(top + path.sep)) return `${f.path} leads outside the repo, so it was left alone`
    if ((await fs.promises.lstat(full)).isDirectory()) return `${f.path} is a folder, so it was left alone`
    await fs.promises.unlink(full)
  }
  return undefined
}

type Parked = { file: string; temp: string; dir: string }
async function parkFiles(root: string, files: RepoFile[]): Promise<Parked[]> {
  const moved: Parked[] = []
  try {
    for (const f of files) {
      const file = path.join(root, f.path), dir = await fs.promises.mkdtemp(path.join(path.dirname(file), '.switchboard-'))
      const temp = path.join(dir, path.basename(file))
      try { await fs.promises.rename(file, temp) } catch (err) { await fs.promises.rmdir(dir); throw err }
      moved.push({ file, temp, dir })
    }
    return moved
  } catch (err) {
    await unparkFiles(moved)
    throw err
  }
}
async function unparkFiles(moved: Parked[]): Promise<void> {
  for (const { file, temp, dir } of moved.reverse()) {
    await fs.promises.rename(temp, file)
    await fs.promises.rmdir(dir)
  }
}

/** One button press. Refuses rather than guesses; confirmed comes from the in-page confirm. */
/** Holds off an update reload while the op runs. */
/** inUse: a live chat runs in this folder (merge-back then keeps the worktree). */
/** live: which worktrees a running chat holds, for merge-all and an uncommitted merge-back. */
export async function gitOp(root: string, c: GitCmd, gh?: string, inUse = false, live: (wt: string) => boolean = () => true): Promise<GitResult> {
  const release = hold()
  try { return await runOp(root, c, gh, inUse, live) } finally { repoCache.delete(root); release() }
}

async function runOp(root: string, c: GitCmd, gh: string | undefined, inUse: boolean, live: (wt: string) => boolean): Promise<GitResult> {
  // Any op may change the branch's PR and run; look again after it.
  prs.clear()
  runs.clear()
  const s = await status(root)
  const pushConfirm = (t: { remote: string; name: string }) => (MAIN.test(t.name) && !c.confirmed ? `Confirm the push to ${t.remote}/${t.name} first` : undefined)
  switch (c.op) {
    case 'commit':
    case 'commit-push': {
      const sum = cleanInvisible(c.summary ?? '', false), desc = cleanInvisible(cleanMessage(c.description ?? ''), false)
      const args = commitArgs(sum.text, desc.text)
      if (typeof args === 'string') return no(args)
      if (!s.branch) return no('Not on a branch (detached HEAD), so nothing was committed')
      const files = pickFiles(s.files, c.files ?? [])
      if (typeof files === 'string') return no(files)
      const t = await pushTarget(root, s)
      const ask = c.op === 'commit-push' ? pushConfirm(t) : undefined
      if (ask) return no(ask)
      const paths = files.flatMap(f => (f.from ? [f.from, f.path] : [f.path]))
      // Agent files the user checked still go in, untouched.
      const sc = await scrub(root, shipFiles(files).take)
      const gone = sum.count + desc.count + sc.n
      // Anything else already staged stays out, and goes back after. No pathspec: a pathspec commit uses a temp index that hooks' git add never leaves.
      const tree = (await git(root, ['write-tree'])).out.trim() || undefined
      const only = await stageOnly(root, paths)
      if (!only.ok) return putBack(root, sc, paths, why(only))
      const add = await stage(root, paths)
      if (!add.ok) return putBack(root, sc, paths, why(add))
      // Hooks may run, hence the long timeout.
      const made = await git(root, [LIT, ...args], SLOW)
      if (!made.ok) {
        const out = await putBack(root, sc, paths, why(made))
        // Nothing was recorded, so the index goes back exactly as the user had it.
        if (tree) await git(root, [LIT, 'read-tree', tree])
        return out
      }
      await restage(root, tree, only.extra)
      dropPending(root)
      const done = `Committed ${plural(files.length, 'file')} to ${s.branch}`
      if (c.op === 'commit') return { ok: true, text: done + removed(gone) }
      const p = await push(root, t)
      return p.ok ? { ok: true, text: `${done} and pushed to ${t.remote}/${t.name}${removed(gone)}` } : no(`${done}, but the push failed: ${why(p)}${removed(gone)}`)
    }
    case 'ship': {
      // The card's one press: every change but agent files, then push. Never pulls, never forces.
      if (!c.confirmed) return no('Confirm the commit and push first')
      if (!s.branch) return no('Not on a branch (detached HEAD), so nothing was committed')
      if (s.files.some(f => f.status === 'conflict')) return no('Resolve the conflicts first')
      const { take, kept, held } = shipFiles(s.files)
      if (!sameSet(c.files ?? [], take.map(f => f.path))) return no('Changed since you confirmed; review again')
      const t = await pushTarget(root, s)
      if (s.behind && !t.publish) return no(`Pull first: ${s.upstream} has ${plural(s.behind, 'commit')} this branch does not`)
      const m = await readMerge(root, s.branch, t.remote).catch(() => undefined)
      if (m?.files) return no(`Merge ${m.base} first: ${plural(m.files, 'file')} would conflict`)
      if (!take.length && !s.ahead && !t.publish) return no(kept.length ? `Only agent files changed (${kept.map(shown).join(', ')}), so nothing was committed` : 'Nothing to commit or push')
      // Reach the remote before committing, and catch a push made since the last fetch.
      if (!(await git(root, ['remote', 'get-url', t.remote])).ok) return no(`There is no remote named ${t.remote}, so nothing was committed`)
      const ls = await git(root, ['ls-remote', t.remote, `refs/heads/${t.name}`])
      if (!ls.ok) return no(`Can't reach ${t.remote} (${why(ls)}), so nothing was committed`)
      const tip = ls.out.split('\t')[0].trim()
      if (tip && !(await git(root, ['merge-base', '--is-ancestor', tip, 'HEAD'])).ok) return no(`Pull first: ${t.remote}/${t.name} has commits this branch does not`)
      let done = '', gone = 0
      if (take.length) {
        const sum = cleanInvisible(c.summary ?? '', false), desc = cleanInvisible(cleanMessage(c.description ?? ''), false)
        const args = commitArgs(sum.text, desc.text)
        if (typeof args === 'string') return no(args)
        // Index holds only the confirmed paths (agent files and anything staged since out), then commit it with no pathspec.
        const commitPaths = take.flatMap(f => f.from ? [f.from, f.path] : [f.path])
        const tree = (await git(root, ['write-tree'])).out.trim() || undefined
        const only = await stageOnly(root, commitPaths)
        if (!only.ok) return no(why(only))
        const ship = take.filter(f => !held.has(f.path))
        const sc = await scrub(root, ship), shipPaths = ship.flatMap(f => f.from ? [f.from, f.path] : [f.path])
        const parked = await parkFiles(root, take.filter(f => held.has(f.path)))
        gone = sum.count + desc.count + sc.n
        const add = await stage(root, shipPaths)
        if (!add.ok) { await unparkFiles(parked); return putBack(root, sc, shipPaths, why(add)) }
        const made = await git(root, [LIT, ...args], SLOW)
        await unparkFiles(parked)
        if (!made.ok) {
          const out = await putBack(root, sc, shipPaths, why(made))
          if (tree) await git(root, [LIT, 'read-tree', tree])
          return out
        }
        dropPending(root)
        done = `Committed ${plural(take.length, 'file')} to ${s.branch}`
      }
      const p = await push(root, t)
      const left = kept.length ? `; left out ${kept.map(shown).join(', ')}` : ''
      if (!p.ok) return no(`${done ? `${done}, but the push failed` : 'The push failed'}: ${why(p)}${removed(gone)}`)
      return { ok: true, text: `${done ? `${done} and pushed` : `Pushed ${s.branch}`} to ${t.remote}/${t.name}${left}${removed(gone)}` }
    }
    case 'push': {
      // The phone's push: the current branch to its own upstream, fast-forward only (git refuses anything else without force).
      if (!s.branch) return no('Not on a branch (detached HEAD)')
      const t = await pushTarget(root, s)
      if (!t.publish && !s.ahead) return no('Nothing to push')
      if (s.behind && !t.publish) return no(`Pull first: ${s.upstream} has ${plural(s.behind, 'commit')} this branch does not`)
      const ask = pushConfirm(t)
      if (ask) return no(ask)
      const p = await push(root, t)
      if (!p.ok) return no(why(p))
      return { ok: true, text: t.publish ? `Published ${s.branch} to ${t.remote}/${t.name}` : `Pushed ${plural(s.ahead, 'commit')} to ${t.remote}/${t.name}` }
    }
    case 'sync': {
      if (!s.branch) return no('Not on a branch (detached HEAD)')
      const kind = syncAction(s).kind
      if (kind === 'push' || kind === 'publish') {
        const t = await pushTarget(root, s)
        const ask = pushConfirm(t)
        if (ask) return no(ask)
        const p = await push(root, t)
        if (!p.ok) return no(why(p))
        return { ok: true, text: kind === 'publish' ? `Published ${s.branch} to ${t.remote}/${t.name}` : `Pushed ${plural(s.ahead, 'commit')} to ${t.remote}/${t.name}` }
      }
      if (kind === 'pull') {
        const p = await git(root, ['pull', '--ff-only'], SLOW)
        return p.ok ? { ok: true, text: `Pulled ${plural(s.behind, 'commit')} into ${s.branch}` } : no(why(p))
      }
      const f = await git(root, ['fetch'], SLOW)
      if (!f.ok) return no(why(f))
      const after = await status(root)
      return { ok: true, text: after.behind ? `Fetched: ${plural(after.behind, 'commit')} to pull` : 'Fetched: up to date' }
    }
    case 'undo': {
      if (!c.confirmed) return no('Confirm the undo first')
      if (!(await git(root, ['rev-parse', '--verify', '-q', 'HEAD~1'])).ok) return no('There is no earlier commit to go back to')
      if ((await git(root, ['branch', '-r', '--contains', 'HEAD'])).out.trim()) return no('The last commit is already pushed, so it stays')
      const subject = (await git(root, ['log', '-1', '--format=%s'])).out.trim()
      const r = await git(root, ['reset', '--soft', 'HEAD~1'])
      return r.ok ? { ok: true, text: `Undid "${subject}": its changes are staged again` } : no(why(r))
    }
    case 'discard': {
      if (!c.confirmed) return no('Confirm the discard first')
      const files = pickFiles(s.files, c.files ?? [])
      if (typeof files === 'string') return no(files)
      const tracked = files.filter(f => f.status !== 'untracked').flatMap(f => (f.from ? [f.from, f.path] : [f.path]))
      const added = files.filter(f => f.status === 'added').map(f => f.path)
      if (added.length) {
        const r = await git(root, [LIT, 'rm', '--force', '--', ...added])
        if (!r.ok) return no(why(r))
      }
      const restore = tracked.filter(p => !added.includes(p))
      if (restore.length) {
        const r = await git(root, [LIT, 'restore', '--source=HEAD', '--staged', '--worktree', '--', ...restore])
        if (!r.ok) return no(why(r))
      }
      const problem = await removeUntracked(root, files.filter(f => f.status === 'untracked'))
      return problem ? no(problem) : { ok: true, text: `Discarded ${plural(files.length, 'file')}` }
    }
    case 'switch': {
      const b = c.branch ?? ''
      // A ref made outside git branch can look like a flag (--orphan=x).
      if (branchProblem(b)) return no(`Switchboard won't switch to ${b}`)
      if (!(await branches(root)).includes(b)) return no(`There is no local branch named ${b}`)
      if (b === s.branch) return no(`Already on ${b}`)
      if (s.files.length) {
        if (!c.stash) return no('Commit or stash the changes first')
        const st = await git(root, ['stash', 'push', '-u', '-m', `Switchboard: before switching to ${b}`])
        if (!st.ok) return no(why(st))
      }
      const r = await git(root, ['switch', b])
      return r.ok ? { ok: true, text: `Switched to ${b}${s.files.length ? '; the changes are in the stash' : ''}` } : no(why(r))
    }
    case 'create': {
      const b = c.branch?.trim() ?? ''
      const bad = branchProblem(b)
      if (bad) return no(bad)
      if (!(await git(root, ['check-ref-format', '--branch', b])).ok) return no(`"${b}" is not a valid branch name`)
      if ((await branches(root)).includes(b)) return no(`${b} already exists`)
      const r = await git(root, ['switch', '-c', b])
      return r.ok ? { ok: true, text: `Created ${b} and switched to it` } : no(why(r))
    }
    case 'delete-branch': {
      const b = c.branch ?? ''
      if (!c.confirmed) return no('Confirm the delete first')
      if (branchProblem(b)) return no(`Switchboard won't delete ${b}`)
      if (MAIN.test(b)) return no(`${b} is never deleted from here`)
      if (b === s.branch) return no('That is the current branch')
      if (!(await branches(root)).includes(b)) return no(`There is no local branch named ${b}`)
      // -d, not -D: git keeps a branch with unmerged commits.
      const r = await git(root, ['branch', '-d', b])
      return r.ok ? { ok: true, text: `Deleted ${b}` } : no(why(r))
    }
    case 'merge-back': {
      if (!c.confirmed) return no('Confirm the merge first')
      const w = await worktreeOf(root)
      if (!w) return no('This is not a worktree, so there is nothing to merge back')
      // A branch made off another one would bring that branch's commits along in a git merge.
      if (s.files.length || await otherFork(w.main, w.wt)) {
        // Uncommitted work goes the Merge all way (commits ride along in its patch), never while a chat can still write there.
        if (!WT_DIR.test(realOf(w.wt))) return no('Only Switchboard worktrees under .claude/worktrees merge back from here')
        if (inUse || live(realOf(w.wt))) return no('A chat is still running in it; Merge back once it ends')
        return mergeWorktrees(root, live, repoChecks, w.wt)
      }
      if (!s.branch) return no('The worktree is on a detached HEAD, so nothing was merged')
      const head = (await git(w.main, ['rev-parse', '--abbrev-ref', 'HEAD'])).out.trim()
      if (!head || head === 'HEAD') return no('The main checkout is on a detached HEAD, so nothing was merged')
      const token = takeLock(w.main)
      if (!token) return no('A merge is already running for this repo')
      const m = await git(w.main, ['merge', '--no-edit', s.branch], SLOW)
      if (!m.ok) await git(w.main, ['merge', '--abort'])
      dropLock(w.main, token)
      if (!m.ok) {
        const conflict = /CONFLICT/.test(m.out)
        return no(conflict ? `Merge conflict merging ${s.branch} into ${head}. Nothing was changed; merge ${head} into the worktree branch and fix it there first` : why(m))
      }
      // A chat still running there would lose its cwd, so the worktree and branch stay until it ends.
      if (inUse) return { ok: true, text: `Merged; worktree kept while the chat runs. ${s.branch} went into ${head}, nothing was pushed` }
      try { await saveIgnored(w.wt, path.join(keptDir(w.main, w.wt), 'ignored')) } catch (err) {
        return { ok: true, text: `Merged ${s.branch} into ${head}, but the worktree stayed: could not copy its ignored files (${(err as Error).message})` }
      }
      // Never forced: a worktree git will not remove stays, with the merge already done.
      await unlockStale(w.main, w.wt)
      const rm = await git(w.main, ['worktree', 'remove', w.wt])
      if (!rm.ok) return { ok: true, text: `Merged ${s.branch} into ${head}, but the worktree stayed: ${why(rm)}` }
      await git(w.main, ['branch', '-d', s.branch])
      noteMerge(w.main, { ok: true, text: `Merged ${s.branch} into ${head}. Nothing was pushed` }, [path.basename(w.wt)])
      return { ok: true, text: `Merged ${s.branch} into ${head} and removed the worktree. Nothing was pushed` }
    }
    case 'merge-all': return c.confirmed ? mergeWorktrees(root, live, repoChecks, c.only) : no('Confirm the merge first')
    case 'stash': {
      if (!s.files.length) return no('Nothing to stash')
      const r = await git(root, ['stash', 'push', '-u', '-m', `Switchboard ${new Date().toISOString().slice(0, 16)}`])
      return r.ok ? { ok: true, text: `Stashed ${plural(s.files.length, 'file')}` } : no(why(r))
    }
    case 'pop': {
      const r = await git(root, ['stash', 'pop'])
      return r.ok ? { ok: true, text: 'Popped the last stash' } : no(why(r))
    }
    case 'rerun': {
      // The run is looked up here, never taken from the page.
      if (!gh || !s.branch || !s.upstream) return no('No GitHub Actions run to re-run')
      const t = await pushTarget(root, s)
      const repo = githubRepo((await git(root, ['remote', 'get-url', t.remote])).out)
      const ci = repo && await runFor(root, repo, t.name, gh)
      if (!repo || !ci || ci.status !== 'completed' || !FAILED.has(ci.conclusion ?? '')) return no('The last run did not fail, so nothing was re-run')
      const r = await exec(gh, ['run', 'rerun', String(ci.id), '--failed', '--repo', repo.replace('https://github.com/', '')], QUICK, root)
      runs.clear()
      return r.ok ? { ok: true, text: `Re-running the failed jobs in ${ci.workflow}` } : no(why(r))
    }
    case 'pr': {
      if (!s.branch || !s.upstream) return no('Publish the branch first')
      const t = await pushTarget(root, s)
      const repo = githubRepo((await git(root, ['remote', 'get-url', t.remote])).out)
      if (!repo) return no(`${t.remote} is not a GitHub remote`)
      const compare = `${repo}/compare/${t.name.split('/').map(encodeURIComponent).join('/')}?expand=1`
      if (!gh) return { ok: true, text: 'Opened the compare page (gh is not installed)', open: compare }
      if (!(await exec(gh, ['auth', 'status'], QUICK, root)).ok) return { ok: true, text: 'gh is not signed in (run gh auth login), so the compare page opened', open: compare }
      // --repo pins the base to this branch's remote, never another one gh might pick.
      const r = await exec(gh, ['pr', 'create', '--repo', repo.replace('https://github.com/', ''), '--head', t.name, '--fill', '--web'], SLOW, root)
      return r.ok ? { ok: true, text: 'Opened the new pull request in your browser' } : { ok: true, text: `gh said: ${why(r)}; the compare page opened`, open: compare }
    }
  }
}
