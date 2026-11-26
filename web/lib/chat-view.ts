/**
 * The chat view's data, as extension/src/hub/chat-view.ts reads it (same shapes), and how to get it:
 * the panel's chat-get in VS Code, else the app's /hub/chat/* proxy.
 */
import { vscodeBridge } from './vscode-bridge'
import { downReason } from './hub-remote'
import type { Report } from './hub-types'
import type { Screen } from './screen'

export type ChatQuestion = { question: string; answer?: string }
export type ChatReport = { id: string; label: string; role?: string; text: string }
export type ChatTest = { command: string; ok: boolean; failed?: number; total?: number; first?: string }
export type ChatError = { tool: string; text: string }
export type ChatOutputs = {
  final?: string; standup?: Report; commit?: string; questions: ChatQuestion[]; reports: ChatReport[]
  tests: ChatTest[]; errors: ChatError[]; files: string[]; shots: string[]; codex?: true
}
export type ChatMessage = { role: 'you' | 'claude' | 'tool' | 'subagent'; text: string }
export type ChatTranscript = { messages: ChatMessage[]; before: number | null; transcript?: 'unsupported'; codex?: true }
export type ChatAnswer = { outputs?: ChatOutputs; transcript?: ChatTranscript; shot?: string; screen?: Screen; problem?: string }
export type ChatAsk = { before?: number; path?: string }

const get = async (path: string, q: Record<string, string>, f: typeof fetch) =>
  f(`/hub/chat/${path}?${new URLSearchParams(q)}`, { headers: { 'X-Switchboard': '1' }, cache: 'no-store' })

/** null: no such chat. A string: why it could not be read. */
export async function loadOutputs(session: string, f: typeof fetch = fetch): Promise<ChatOutputs | null | string> {
  if (vscodeBridge?.isVSCode) return vscodeBridge.chat(session, 'outputs').then(a => a.problem ?? a.outputs ?? null)
  try {
    const r = await get('outputs', { session }, f)
    return r.ok ? ((await r.json()) as ChatOutputs) : r.status === 404 ? null : downReason(r.status)
  } catch {
    return downReason(undefined)
  }
}

export async function loadTranscript(session: string, before?: number, f: typeof fetch = fetch): Promise<ChatTranscript | null | string> {
  if (vscodeBridge?.isVSCode) return vscodeBridge.chat(session, 'transcript', { before }).then(a => a.problem ?? a.transcript ?? null)
  try {
    const r = await get('transcript', { session, ...(before !== undefined ? { before: String(before) } : {}) }, f)
    return r.ok ? ((await r.json()) as ChatTranscript) : r.status === 404 ? null : downReason(r.status)
  } catch {
    return downReason(undefined)
  }
}

/** An image src for one screenshot: a data URL from VS Code, a blob URL in the app (an img cannot send the proxy's header). */
export async function loadShot(session: string, path: string, f: typeof fetch = fetch): Promise<string | undefined> {
  if (vscodeBridge?.isVSCode) return vscodeBridge.chat(session, 'shot', { path }).then(a => a.shot)
  try {
    const r = await get('shot', { session, path }, f)
    return r.ok ? URL.createObjectURL(await r.blob()) : undefined
  } catch {
    return undefined
  }
}

export const fileName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p
