/** Simple view's Home: guided (checklist on top) until every first-run step is done or the list is hidden, then the ask box leads. */
import type { HubState } from './hub-types'
import { laneRow } from './now'

type FirstRun = NonNullable<HubState['firstRun']>
export const guidedHome = (run?: FirstRun) => !!run && !run.dismissed && !(run.github && run.claude && run.project && run.chat && run.approved)

/** The first open chat waiting for an OK, for the checklist's approve step. */
export function readyChat(hub: Pick<HubState, 'chats' | 'progress'>): { id: string; name: string } | undefined {
  for (const p of hub.progress) {
    const c = p.state === 'done' && hub.chats.find(x => x.sessionId === p.sessionId)
    if (c) return { id: c.sessionId, name: laneRow({ chat: c }).name }
  }
}

/** The first-run steps, with chat and approve ticked when the data already shows them (a chat exists, one was approved). */
export function ticked(run: FirstRun | undefined, hub: Pick<HubState, 'chats' | 'archive'>): FirstRun | undefined {
  if (!run) return run
  const chat = run.chat || hub.chats.length > 0
  const approved = run.approved || (hub.archive ?? []).some(a => a.approvedAt)
  return chat === run.chat && approved === run.approved ? run : { ...run, chat, approved }
}
