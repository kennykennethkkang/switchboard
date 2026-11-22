/** The muted line under Auto in New chat and To-do Start: what Smart select would pick for this text and why. Same rules as the extension (pick-run.ts). */
import { pickRun } from '../../extension/src/hub/pick-run'
import type { AiId } from './hub-types'

/** A reason from the learned table starts with "learned:"; say the smart pick overrode the rule. */
export const smartReason = (why: string) => why.startsWith('learned:') ? `learned override, ${why.slice(8).trim()}` : why

/** usage5h: the 5h % of the account that will run it. undefined with no task yet or for an AI that gets no picks. */
export function autoLine(text: string, ai: AiId, usage5h: number): string | undefined {
  const task = text.trim()
  if (!task || (ai !== 'claude' && ai !== 'codex')) return undefined
  const p = pickRun({ text: task, role: ai === 'claude' ? 'lead' : undefined, ai, usage5h })
  const shown = [p.model, p.effort, p.ultracode ? 'ultracode' : ''].filter(Boolean).join(' · ')
  return `Smart: ${shown}, ${smartReason(p.reason)}`
}
