import { execFile } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

// Claude in a container: the repo is mounted at the Mac's own path and the chat's transcript folder is
// bound in, so the hub reads it like any chat. The login lives in DATA on the Mac, shared by every container chat.
const CLI = 'npx -y @devcontainers/cli@0'
const CONFIG = '/sb-claude'
export const DATA = path.join(os.homedir(), '.claude', 'switchboard', 'container')
const FEATURES = JSON.stringify({ 'ghcr.io/anthropics/devcontainer-features/claude-code:1': {} })
/** Used when the repo has no devcontainer.json of its own; written to DATA, never into the repo. */
export const DEFAULT_CONFIG = { name: 'Switchboard chat', image: 'mcr.microsoft.com/devcontainers/javascript-node:22', remoteUser: 'node' }
/** No host hooks or plugins in there, so the container is the guard: bypass, without its first-run warning. */
export const CONTAINER_SETTINGS = JSON.stringify({ permissions: { defaultMode: 'bypassPermissions' }, skipDangerousModePermissionPrompt: true })

export const hasOwnConfig = (dir: string) => ['.devcontainer/devcontainer.json', '.devcontainer.json'].some(f => fs.existsSync(path.join(dir, f)))

// Keys that run on the Mac (initializeCommand) or widen the container past the repo; a bypass chat never takes them from a repo.
const RISKY = /"(initializeCommand|runArgs|privileged|capAdd|securityOpt|mounts|workspaceMount|dockerComposeFile|appPort|forwardPorts)"\s*:/g
/** The keys a repo's devcontainer.json sets that make Switchboard use its default config instead. A text scan, so a commented-out key counts too. */
export function riskyKeys(dir: string): string[] {
  const file = ['.devcontainer/devcontainer.json', '.devcontainer.json'].map(f => path.join(dir, f)).find(f => fs.existsSync(f))
  if (!file) return []
  try { return [...new Set([...fs.readFileSync(file, 'utf8').matchAll(RISKY)].map(m => m[1]))] } catch { return ['unreadable'] }
}

/**
 * What goes in front of `claude ...` in the chat's terminal: start or reuse the chat folder's own container
 * (id-label per folder, so each worktree gets one), then run the rest in it from the same path.
 * repo: the git top, mounted whole so a worktree's .git link resolves. override: the default config's file.
 */
export function containerPrefix(o: { repo: string; cwd: string; override?: string; home?: string; data?: string; exists?: (p: string) => boolean }): string {
  const home = o.home ?? os.homedir()
  // shellQuote folds whitespace, which would point a mount at another folder.
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
  // macOS paths ignore case, so a lowercase twin of home must not slip past.
  const fold = (p: string) => process.platform === 'darwin' ? p.toLowerCase() : p
  if (fold(home) === fold(o.repo) || fold(home).startsWith(`${fold(o.repo).replace(/\/+$/, '')}/`)) throw new Error('A container chat needs a project folder inside your home folder, not the home folder itself')
  if ([o.repo, o.cwd, home, o.data ?? ''].some(p => p.includes(','))) throw new Error('A container chat cannot mount a path with a comma in it')
  const key = path.join(home, '.claude', 'projects', o.cwd.replace(/[^a-zA-Z0-9]/g, '-')), data = o.data ?? DATA
  const where = `--workspace-folder ${q(o.repo)} --id-label ${q(`switchboard.dir=${o.cwd}`)}${o.override ? ` --override-config ${q(o.override)}` : ''}`
  // Hooks or git config written in there would run on the Mac at the next git command, so the container
  // gets copies (--mount has no readonly): an empty hooks folder and the config as it was at start.
  const gitDir = path.join(o.repo, '.git'), shadow = path.join(home, '.claude', 'switchboard', 'container-git', o.repo.replace(/[^a-zA-Z0-9]/g, '-'))
  const git = (o.exists ?? fs.existsSync)(path.join(gitDir, 'config'))
  const mounts = [[o.repo, o.repo], ...(git ? [[path.join(shadow, 'hooks'), path.join(gitDir, 'hooks')], [path.join(shadow, 'config'), path.join(gitDir, 'config')]] : []), [data, CONFIG], [key, `${CONFIG}/projects/${path.basename(key)}`]]
    .map(([s, t]) => ` --mount ${q(`type=bind,source=${s},target=${t}`)}`).join('')
  const copy = git ? ` ${q(path.join(shadow, 'hooks'))} && cp ${q(path.join(gitDir, 'config'))} ${q(path.join(shadow, 'config'))}` : ''
  // The repo shows as root-owned in there, so git refuses it without safe.directory; env config counts as command line.
  const env = ` --remote-env CLAUDE_CONFIG_DIR=${CONFIG} --remote-env IS_SANDBOX=1 --remote-env GIT_CONFIG_COUNT=1 --remote-env GIT_CONFIG_KEY_0=safe.directory --remote-env 'GIT_CONFIG_VALUE_0=*'`
  // Our own config has no lockfile; without --no-lockfile the CLI writes one into the repo's .devcontainer, and fails when that folder is missing.
  return `mkdir -p ${q(key)} ${q(data)}${copy} && ${CLI} up${o.override ? ' --no-lockfile' : ''} ${where}${mounts} --additional-features ${q(FEATURES)} > /dev/null && ${CLI} exec ${where}${env} sh -c 'cd "$1" && shift && exec "$@"' sh ${q(o.cwd)} `
}

/** The default config file, rewritten on each start so a new build ships its changes; its path for --override-config. */
export function defaultConfigFile(dir = DATA): string {
  const file = path.join(dir, 'devcontainer.json')
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  fs.writeFileSync(file, JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n')
  return file
}

// Session files are <pid>.json with the pid inside the container; a live one is a claude process there ($$ is this sh, whose script says claude).
const LIVE_PIDS = `for f in ${CONFIG}/sessions/*.json; do p=\${f##*/}; p=\${p%.json}; case $p in ''|*[!0-9]*) continue;; esac; [ "$p" != "$$" ] && grep -qs claude /proc/$p/cmdline && echo "$p"; done; true`

const dockerBin = () => ['/opt/homebrew/bin/docker', '/usr/local/bin/docker'].find(p => fs.existsSync(p)) ?? 'docker'
const docker = (args: string[]) => new Promise<string>((ok, no) => execFile(dockerBin(), args, { timeout: 20_000 }, (err, out) => err ? no(err) : ok(out)))

/** "<chat folder>\n<pid>" for each claude running in a chat container. Every container sees all of DATA/sessions, so the folder label tells whose file it is. */
export async function containerChats(run = docker): Promise<Set<string>> {
  const live = new Set<string>()
  const rows = (await run(['ps', '--filter', 'label=switchboard.dir', '--format', '{{.ID}}\t{{.Label "switchboard.dir"}}'])).split('\n').filter(Boolean)
  await Promise.all(rows.map(async row => {
    const [id, dir] = row.split('\t')
    const pids = await run(['exec', id, 'sh', '-c', LIVE_PIDS]).catch(() => '')
    for (const p of pids.split('\n').filter(Boolean)) live.add(`${dir}\n${p}`)
  }))
  return live
}

// up builds the image before the container starts, so this covers postCreateCommand and the exec into claude.
const STALE_MS = 15 * 60_000
async function pastBoot(id: string, run: typeof docker, now: number): Promise<boolean> {
  const started = Date.parse((await run(['inspect', '-f', '{{.State.StartedAt}}', id]).catch(() => '')).trim())
  // Docker's zero time (year 1) parses negative.
  return started > 0 && now - started > STALE_MS
}

/**
 * docker rm -f each chat container whose claude has exited (SessionEnd, or Approve closing the terminal).
 * Keys on claude inside the container, not the hub's chat list: a container chat's session file lives in
 * there, so the hub reads it as ended while it runs. seen: ids where claude ran, so a booting one stays.
 * seen is per window and sampled every 30 s, so a container whose chat ended before a reload, or ran under
 * 30 s, is never in it: one with no claude goes once it has run longer than any boot (STALE_MS).
 */
export async function sweepContainers(seen: Set<string>, run = docker, now = Date.now()): Promise<string[]> {
  let ids: string[]
  try { ids = (await run(['ps', '-q', '--filter', 'label=switchboard.dir'])).split('\n').filter(Boolean) } catch { return [] }
  for (const id of seen) if (!ids.includes(id)) seen.delete(id)
  const gone: string[] = [], failed: string[] = []
  for (const id of ids) {
    let procs: string
    try { procs = await run(['top', id, '-o', 'pid,args']) } catch { continue }
    if (procs.split('\n').slice(1).some(l => /(^|[/ ])claude(\s|$)|claude-code\//.test(l))) { seen.add(id); continue }
    if (!seen.has(id) && !(await pastBoot(id, run, now))) continue
    // A failed rm stays in seen, so the next sweep tries again.
    try { await run(['rm', '-f', id]) } catch (err) { failed.push(`${id}: ${err instanceof Error ? err.message : err}`); continue }
    seen.delete(id)
    gone.push(id)
  }
  if (failed.length) throw new Error(`docker rm failed for ${failed.join('; ')}${gone.length ? ` (removed ${gone.join(', ')})` : ''}`)
  return gone
}
