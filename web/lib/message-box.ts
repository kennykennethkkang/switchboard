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

/** A map panel's reply box: the live chat it sends to, and why messages cannot reach it, if so. Ended chats get no box. */
export function replyBox(chats: ChatRow[], sessionId: string | undefined): { sessionId: string; note?: string } | undefined {
  const chat = sessionId ? chats.find(c => c.sessionId === sessionId) : undefined
  return chat?.live ? { sessionId: chat.sessionId, note: boxNote(chat) } : undefined
}

/** The failure text for this send only: a late failure of an earlier send is not this one's. */
export function sendFailure(sent: HubCommand | undefined, problem: { text: string; at: number; for?: HubCommand } | null): string | undefined {
  return sent && problem?.for === sent ? problem.text : undefined
}

export type Keywords = { ultrathink: boolean; ultracode: boolean }
/** Claude Code's prompt keywords, added at the end for one send: ultrathink thinks harder this turn, ultracode runs a multi-agent workflow. */
/** A slash command keeps its line as typed, or the words would land in its arguments. A leading path like /Users/x is no command. */
export function withKeywords(text: string, on: Keywords): string {
  const add = (['ultrathink', 'ultracode'] as const).filter(k => on[k])
  return text && add.length && !/^\/[a-z][\w:-]*(\s|$)/i.test(text) ? `${text} ${add.join(' ')}` : text
}

/** This send's keywords with the chat's sticky Ultracode switch. */
export const sendKeywords = (kw: Keywords, ultracode?: boolean): Keywords => ({ ...kw, ultracode: kw.ultracode || !!ultracode })

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type Effort = typeof EFFORTS[number] | 'default'
/** What the chat's effort pick types into it. Claude Code also saves it as the default for new sessions. */
export const effortCommand = (e: Effort) => `/effort ${e === 'default' ? 'auto' : e}`

/** Per chat picks from the message row: the effort last sent and the sticky Ultracode switch. Unset = Default, off. */
export type ChatOpts = { effort?: Exclude<Effort, 'default'>; ultracode?: true }
export const OPTS_KEY = 'switchboard-chat-opts'
export const MAX_OPTS = 100

function parseOpts(raw: string | null): Record<string, ChatOpts> {
  try {
    const all = JSON.parse(raw ?? '{}')
    return all && typeof all === 'object' && !Array.isArray(all) ? all : {}
  } catch { return {} }
}

export function readOpts(raw: string | null, sessionId: string): ChatOpts {
  const o = parseOpts(raw)[sessionId]
  return {
    ...((EFFORTS as readonly unknown[]).includes(o?.effort) ? { effort: o!.effort } : {}),
    ...(o?.ultracode === true ? { ultracode: true as const } : {}),
  }
}

/** The stored map with this chat's picks moved last; past MAX_OPTS the oldest chats drop. */
export function writeOpts(raw: string | null, sessionId: string, next: { effort?: Effort; ultracode?: boolean }): string {
  const all = parseOpts(raw)
  delete all[sessionId]
  const o: ChatOpts = { ...(next.effort && next.effort !== 'default' ? { effort: next.effort } : {}), ...(next.ultracode ? { ultracode: true } : {}) }
  if (o.effort || o.ultracode) all[sessionId] = o
  return JSON.stringify(Object.fromEntries(Object.entries(all).slice(-MAX_OPTS)))
}
