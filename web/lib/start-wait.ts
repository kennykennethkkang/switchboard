/** Wait on chat for a chat not started yet: which live chats it can wait on, and the line that says so. */
import type { AiId, ChatRow } from './hub-types'
import { projectName } from './archive'
import { insidePath } from '../../extension/src/hub/win-path'

/** project: a folder path (the chat's folder or one under it) or a project name. */
export const inProject = (c: ChatRow, project: string) =>
  /[\\/]/.test(project) ? c.cwd === project || insidePath(project, c.cwd) : projectName(c) === project

/** Live chats in the picked project. None for a new Codex chat: its id is only known once it runs, so waits cannot be attached. */
export const startTargets = (chats: ChatRow[], project: string, ai: AiId = 'claude') =>
  ai === 'codex' || !project ? [] : chats.filter(c => c.live && inProject(c, project))

export const toggleId = (ids: string[], id: string) => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]

/** Starts after Auth finishes / Auth and Billing finish / Auth, Billing and Copy finish. */
export function startsAfter(names: string[]): string {
  if (!names.length) return ''
  if (names.length === 1) return `Starts after ${names[0]} finishes`
  return `Starts after ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} finish`
}
