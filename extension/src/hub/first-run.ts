/** The first-run checklist from hub state; github comes from gh auth status, dismissed from globalState. */
import type { HubState } from './types'

export type FirstRun = NonNullable<HubState['firstRun']>

export function firstRunOf(s: Pick<HubState, 'ais' | 'projects' | 'chats' | 'archive'>, github: boolean, dismissed: boolean): FirstRun {
  const archive = s.archive ?? []
  return {
    github,
    claude: s.ais.some(a => a.id === 'claude' && a.signedIn),
    project: s.projects.length > 0,
    chat: s.chats.length > 0 || archive.length > 0,
    approved: archive.some(a => !!a.approvedAt),
    ...(dismissed ? { dismissed: true } : {}),
  }
}
