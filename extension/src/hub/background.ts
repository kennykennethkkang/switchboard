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

/** Agent and timer notices: a VS Code toast only when Kenneth turned toasts on, else the status bar. */
export const noticeKind = (sb: { toasts?: boolean }): 'toast' | 'status' => (sb.toasts === true ? 'toast' : 'status')
