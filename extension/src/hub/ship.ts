/**
 * The repos and worktrees Ship lists, chat or no chat, read from disk. Ship's commands name one by its path, taken only when it is on this list.
 */
import * as fs from 'fs'
import * as path from 'path'
import { autoMergeOn, git, mergeBusy, mergeNote, realOf, status, worktreesOf } from './git'
import type { ShipRepo } from './types'

const count = async (root: string, args: string[]) => Number((await git(root, ['rev-list', '--count', ...args])).out.trim()) || 0

async function readOne(root: string, live: (wt: string) => boolean): Promise<ShipRepo | undefined> {
  // A folder for a main checkout; a linked worktree has a .git file and shows under its repo.
  if (!fs.statSync(path.join(root, '.git')).isDirectory()) return undefined
  const s = await status(root)
  // Never pushed: every commit no remote has. No remote: nothing to push.
  const ahead = s.upstream ? s.ahead : (await git(root, ['remote'])).out.trim() ? await count(root, ['HEAD', '--not', '--remotes']) : 0
  const trees = await Promise.all((await worktreesOf(root)).map(async wt => {
    const t = await status(wt).catch(() => undefined)
    if (!t) return []
    const head = (await git(wt, ['rev-parse', 'HEAD'])).out.trim()
    // The project's own spelling of the path, so a tree's id starts with its repo's.
    return [{ id: path.join(root, path.relative(realOf(root), wt)), name: path.basename(wt), ...(t.branch ? { branch: t.branch } : {}), files: t.files.length, commits: head ? await count(root, [`HEAD..${head}`]) : 0, live: live(wt) }]
  }))
  const note = mergeNote(root)
  return {
    id: root, name: path.basename(root), ...(s.branch ? { branch: s.branch } : {}), files: s.files.length, ahead, behind: s.behind, auto: autoMergeOn(root), trees: trees.flat(),
    ...(mergeBusy(root) ? { merging: true } : {}), ...(note ? { merge: { text: note.text, ok: note.ok, at: note.at } } : {}),
  }
}

/** Every root that is a git checkout, once each; one that cannot be read is left out. */
export async function readShip(roots: string[], live: (wt: string) => boolean): Promise<ShipRepo[]> {
  const once = [...new Map(roots.map(r => [realOf(r), r] as const)).values()]
  return (await Promise.all(once.map(r => readOne(r, live).catch(() => undefined)))).flatMap(r => r ?? [])
}

/** The folder a Ship command names, when it is a listed repo or worktree. */
export const shipFolder = (list: ShipRepo[] | undefined, id: string) =>
  list?.some(r => r.id === id || r.trees.some(t => t.id === id)) ? id : undefined
