/** Agent work stays off Kenneth's screen: headless Playwright MCP browsers and quiet notices unless he turns them on. */
import * as os from 'os'
import * as path from 'path'
import { readSettingsFile, writeJsonAtomic } from '../hook-entries'

const KEY = 'PLAYWRIGHT_MCP_HEADLESS'
const SETTINGS = path.join(os.homedir(), '.claude', 'settings.json')

/** settings.json env with the headless flag on, or off when Kenneth wants to see agent browsers. */
export function headlessEnv(env: Record<string, string> | undefined, show: boolean | undefined): Record<string, string> {
  const { [KEY]: _old, ...rest } = env ?? {}
  return show ? rest : { ...rest, [KEY]: 'true' }
}

/** Every chat reads Claude's env, and the Playwright MCP server inherits it. Applies to chats started after. */
export function applyAgentBrowsers(show: boolean | undefined, file = SETTINGS): string | undefined {
  const read = readSettingsFile(file)
  if (!read.ok) return `could not read ${file} (${read.error})`
  const env = read.settings.env as Record<string, string> | undefined
  const next = headlessEnv(env, show)
  if (JSON.stringify(next) === JSON.stringify(env ?? {})) return undefined
  const { env: _e, ...rest } = read.settings
  writeJsonAtomic(file, Object.keys(next).length ? { ...rest, env: next } : rest)
  return undefined
}

/** Agent and timer notices: the Mac or Windows notification center unless Kenneth picks a VS Code pop-up or the status bar. An old toasts: true reads as a pop-up. */
export const NOTICE_KINDS = ['system', 'toast', 'status'] as const
export type NoticeKind = (typeof NOTICE_KINDS)[number]
export const noticeKind = (sb: { toasts?: boolean; notices?: NoticeKind }): NoticeKind => sb.notices ?? (sb.toasts === true ? 'toast' : 'system')

/** Toast text: VS Code already names Switchboard as the source, so the prefix goes; one line, cut at 140. */
export function noticeText(text: string): string {
  const t = text.replace(/^Switchboard:\s*/, '').replace(/\s+/g, ' ').trim()
  return t.length > 140 ? t.slice(0, 139).trimEnd() + '…' : t
}

/** Where VS Code puts toasts (workbench.notifications.position). Top right unless Kenneth picks another. */
export const NOTICE_SPOTS = ['top-right', 'bottom-left', 'bottom-right'] as const
export type NoticeSpot = (typeof NOTICE_SPOTS)[number]
export const noticeSpot = (sb: { noticeSpot?: NoticeSpot }): NoticeSpot => sb.noticeSpot ?? 'top-right'
