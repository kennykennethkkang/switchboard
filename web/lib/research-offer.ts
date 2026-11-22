/** The Research offer's Move: the chat's newest ask again, as a research chat. */
import type { HubState } from './hub-types'
import type { HubCommand } from './vscode-bridge'
import { projectOf } from './flow-map'

/** path: the chat's own project, else the open one (the extension only starts chats from a listed project). Undefined with no ask to move. */
export function moveToResearch(hub: HubState, sessionId: string): Extract<HubCommand, { type: 'hub-new-chat' }> | undefined {
  const p = hub.progress.find(x => x.sessionId === sessionId)
  const text = p?.asked?.at(-1)?.trim()
  const path = projectOf(hub.projects.map(x => x.path), p?.cwd) ?? (hub.projects.find(x => x.isOpen) ?? hub.projects[0])?.path
  if (!text || !path) return undefined
  return { type: 'hub-new-chat', path, text, remote: hub.rc.atStartup, research: true }
}
