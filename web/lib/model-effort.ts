/** A run's model, effort and ultracode picks, for New chat and the To-do Start popover. */
import type { AiId, HubState } from './hub-types'
import { limitMeters } from './limits'

/** auto: the extension fills what is unset from the task (picker.ts pickRun). */
export type RunPicks = { model?: string; effort?: string; ultracode?: boolean; advisor?: string; auto: boolean }
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export const EFFORTS: Array<[Effort, string]> = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['xhigh', 'Extra high'], ['max', 'Max']]
/** Only Claude and Codex get picks; the gear's Codex list. */
export const MODELS: Partial<Record<AiId, Array<[string, string]>>> = {
  claude: [['fable', 'Fable'], ['opus', 'Opus'], ['sonnet', 'Sonnet'], ['haiku', 'Haiku']],
  codex: [['gpt-6-luna', 'gpt-6-luna'], ['gpt-5.6-terra', 'gpt-5.6-terra'], ['gpt-5.6-luna', 'gpt-5.6-luna']],
}
// Claude's --advisor: it must rank at or above the chat's model, or Claude Code leaves it off.
const ADVISORS: Array<[string, string]> = [['fable', 'Fable'], ['opus', 'Opus'], ['sonnet', 'Sonnet']]
const RANK = ['haiku', 'sonnet', 'opus', 'fable']
/** The advisors that can serve this model; all of them while the model is unset or a full id. */
export const advisorsFor = (model?: string) => ADVISORS.filter(([a]) => RANK.indexOf(a) >= RANK.indexOf(model ?? ''))

// Same as picker.ts GATE: from here the auto pick holds the costly levels back.
const GATE = 60

/** The fields a hub-new-chat or hub-todo-run carries. */
export function runFields(v: RunPicks, ai: AiId): { auto?: boolean; model?: string; effort?: Effort; ultracode?: boolean; advisor?: string } {
  if (!MODELS[ai]) return {}
  const effort = EFFORTS.find(([e]) => e === v.effort)?.[0]
  return { auto: v.auto, ...(v.model ? { model: v.model } : {}), ...(effort ? { effort } : {}), ...(v.ultracode && ai === 'claude' ? { ultracode: true } : {}),
    ...(ai === 'claude' && advisorsFor(v.model).some(([a]) => a === v.advisor) ? { advisor: v.advisor } : {}) }
}

/** Shown under Auto once the 5h window passes the gate; a hand pick is never held. */
export const heldLine = (pct: number, auto: boolean) => auto && pct >= GATE ? `xhigh/max/ultracode held: 5h at ${pct}%` : undefined

/** The 5h % of the account that will run it. */
export function fiveHourUse(hub: HubState, ai: AiId, now = Date.now()): number {
  const kind = ai === 'codex' ? 'codex_five_hour' : 'five_hour'
  return limitMeters(hub.live, now, hub.limitsKept, hub.codexKept).find(m => m.kind === kind)?.percent ?? 0
}

/** Where a fresh picker starts: Auto unless the gear's Auto pick per task is off. */
export const startPicks = (hub: HubState): RunPicks => ({ auto: hub.controls.switchboard.autoPick !== false })
