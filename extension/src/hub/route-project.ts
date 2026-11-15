/**
 * Smart switch: a chat's first prompt, typed in the wrong project's window, is matched to one of the
 * listed projects by one quick model call. Any doubt, error or slow answer keeps it where it is.
 */
import * as fs from 'fs'
import * as path from 'path'

export const ROUTE_MS = 8000
/** The moved chat's first line; a prompt starting with it is never moved again. */
export const MOVED = 'Moved here from'

export const promptText = (prompt: string) => prompt.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim()
const realPath = (p: string) => { try { return fs.realpathSync.native(p) } catch { return p } }
const within = (dir: string, p: string) => p === dir || p.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep)

/** The listed project the prompt belongs to when that is not the one cwd is in; else undefined. */
export async function routeProject(prompt: string, cwd: string, projects: { name: string; path: string }[], ask: (prompt: string, ms: number) => Promise<string>, ms = ROUTE_MS, real = realPath): Promise<string | undefined> {
  const text = promptText(prompt)
  // A pasted image cannot ride along to the new chat.
  if (!text || text.startsWith('/') || text.startsWith(MOVED) || text.includes('[Image #')) return undefined
  const here = real(cwd)
  const current = projects.filter(p => within(real(p.path), here)).sort((a, b) => b.path.length - a.path.length)[0]
  const others = projects.filter(p => !within(real(p.path), here))
  // Only from one listed project to another: ~ or a parent folder may be open on purpose.
  if (!current || !others.length) return undefined
  const list = others.map((p, i) => `${i + 1}. ${p.name} (${p.path})`).join('\n')
  const q = `A coding task was typed in the folder ${cwd}. Which project is it about?\n0. ${current.name} (the folder it was typed in)\n${list}\n\nAnswer 0 unless the task clearly names or is about one of the other projects. Answer with the number only.\n\nTask: ${text.slice(0, 1500)}`
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<undefined>(r => { timer = setTimeout(() => r(undefined), ms) })
  const answer = await Promise.race([ask(q, ms).catch(() => undefined), timeout])
  clearTimeout(timer)
  const n = Number(answer?.trim().match(/^\d+/)?.[0])
  return n >= 1 ? others[n - 1]?.path : undefined
}
