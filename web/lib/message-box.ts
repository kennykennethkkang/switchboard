import type { ChatRow } from './hub-types'
import type { HubCommand } from './vscode-bridge'

/** Why the message box cannot reach a chat, shown in place of it; none when it can. */
export function boxNote(chat: ChatRow): string | undefined {
  if (chat.takes) return undefined
  if (!chat.live) return 'This chat is not running, so messages cannot reach it.'
  return chat.ai === 'codex'
    ? 'This Codex chat was not started or resumed from Switchboard in this window, or has quit, so messages cannot reach it. Type in its terminal.'
    : 'This chat is not collecting messages: it is not running, or the usage-meter mod is not on in it. Type in its terminal.'
}

/** The failure text for this send only: a late failure of an earlier send is not this one's. */
export function sendFailure(sent: HubCommand | undefined, problem: { text: string; at: number; for?: HubCommand } | null): string | undefined {
  return sent && problem?.for === sent ? problem.text : undefined
}

export type Keywords = { ultrathink: boolean; ultracode: boolean }
/** Claude Code's prompt keywords, added at the end for one send: ultrathink thinks harder this turn, ultracode runs a multi-agent workflow. */
export function withKeywords(text: string, on: Keywords): string {
  const add = (['ultrathink', 'ultracode'] as const).filter(k => on[k])
  return text && add.length ? `${text} ${add.join(' ')}` : text
}
