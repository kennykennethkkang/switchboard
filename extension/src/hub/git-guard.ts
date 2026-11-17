/**
 * Git hooks that refuse commits and pushes from chats. Claude Code marks its shells with CLAUDECODE and
 * CLAUDE_CODE_SESSION_ID; Codex has no marker, so Switchboard's chat terminals set SWITCHBOARD_CHAT (actions.ts).
 * The Commit/Push buttons, the phone and Kenneth's own terminal carry none of them.
 */
import { execFile } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { promisify } from 'util'

export const GUARD_MARK = '# switchboard-git-guard'
const HOOKS = ['pre-commit', 'pre-push']
const SCRIPT = `#!/bin/sh
${GUARD_MARK}: chats leave commits and pushes to Kenneth. Switchboard rewrites this file.
if [ -n "$CLAUDECODE$CLAUDE_CODE_SESSION_ID$SWITCHBOARD_CHAT" ]; then
  echo "Refused: Kenneth commits and pushes himself. Leave the work modified." >&2
  exit 1
fi
`
const run = promisify(execFile)
const git = async (cwd: string, args: string[]) => (await run('git', args, { cwd })).stdout.trim()
const read = (f: string) => { try { return fs.readFileSync(f, 'utf8') } catch { return undefined } }

/** The repo's shared hooks dir (a worktree's main repo), or undefined when not a repo or core.hooksPath points elsewhere. */
async function hooksDir(root: string): Promise<string | undefined> {
  try {
    // config exits 1 when unset
    if (await git(root, ['config', 'core.hooksPath']).catch(() => '')) return undefined
    return path.join(await git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']), 'hooks')
  } catch { return undefined }
}

/** Writes our pre-commit and pre-push; a hook without our marker is someone else's and stays. Returns the hooks dir. */
export async function installGuard(root: string): Promise<string | undefined> {
  const dir = await hooksDir(root)
  if (!dir) return undefined
  fs.mkdirSync(dir, { recursive: true })
  for (const h of HOOKS) {
    const f = path.join(dir, h)
    // A symlink, even a dangling one, belongs to some hook manager: writing would follow it.
    if (fs.lstatSync(f, { throwIfNoEntry: false })?.isSymbolicLink()) continue
    const now = read(f)
    if (now !== undefined && !now.includes(GUARD_MARK)) continue
    if (now !== SCRIPT) fs.writeFileSync(f, SCRIPT)
    fs.chmodSync(f, 0o755)
  }
  return dir
}
