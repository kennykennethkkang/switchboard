import type { ChatProgress, ChatState, WindowColor, WindowInfo } from './hub-types'
import { windowOf } from './windows'
import { formatDuration } from './duration'

type Key = 'blue' | 'green' | 'red' | 'yellow' | 'teal'
export const STATE: Record<ChatState, { label: string; color: string; soft: string; key: Key }> = {
  working: { label: 'Working', color: 'var(--hub-blue)', soft: 'var(--hub-blue-soft)', key: 'blue' },
  done: { label: 'Finished', color: 'var(--hub-green)', soft: 'var(--hub-green-soft)', key: 'green' },
  'needs-you': { label: 'Needs you', color: 'var(--hub-red)', soft: 'var(--hub-red-soft)', key: 'red' },
  idle: { label: 'Idle', color: 'var(--hub-yellow)', soft: 'var(--hub-yellow-soft)', key: 'yellow' },
}
export const coverage = (p: ChatProgress, i: number) => { const s = p.covered?.[i]; return s == null ? undefined : s <= 0.2 ? 'missed' : s >= 0.8 ? 'covered' : undefined }
export const missedCount = (p?: ChatProgress) => p?.covered?.length !== p?.asked?.length ? 0 : (p?.asked ?? []).filter((_, i) => coverage(p!, i) === 'missed').length
export const almostDone = (p?: ChatProgress) => p?.state === 'done' && missedCount(p) > 0
export const ALMOST = { label: 'Ready for your OK', color: 'var(--hub-yellow)', soft: 'var(--hub-yellow-soft)', key: 'teal' as Key }
export const ORDER = ['researcher', 'engineer', 'qa', 'designer', 'ops', 'growth']
export const ago = (at: number, now = Date.now()) => formatDuration(now - at, 'ago')
export const WINDOW_VAR: Record<WindowColor, string> = {
  violet: 'var(--hub-w-violet)', amber: 'var(--hub-w-amber)', teal: 'var(--hub-w-teal)', rose: 'var(--hub-w-rose)', lime: 'var(--hub-w-lime)', cobalt: 'var(--hub-w-cobalt)', slate: 'var(--hub-w-slate)',
}
export const placeOf = (cwd: string | undefined, windows: WindowInfo[] = []) => {
  const w = cwd ? windowOf(cwd, windows) : undefined
  return w ? { name: w.name, workspace: w.workspace, color: WINDOW_VAR[w.color] } : undefined
}
