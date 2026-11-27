'use client'
// Model, effort, ultracode and advisor for one run: New chat's footer and the To-do Start popover.
// Auto on: picker.ts picks per task. Off: the selects show, '' leaves that flag to the defaults.
import { useId, type CSSProperties } from 'react'
import type { AiId } from '@/lib/hub-types'
import { EFFORTS, MODELS, advisorsFor, heldLine, type RunPicks } from '@/lib/model-effort'
import { autoLine } from '@/lib/auto-reason'

const lab: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', minWidth: 0, color: 'var(--hub-mute)', fontSize: 13 }
const hint: CSSProperties = { font: '400 12px/1.4 var(--hub-sans)', color: 'var(--hub-mute)', minWidth: 0 }

/** task: the text Auto reads, for the one-line pick under the switch. usage: the 5h % of the account that will run it (fiveHourUse); from 60% Auto holds the costly picks and says so. Hermes gets nothing. */
export function ModelEffort({ ai, value, onChange, compact, usage, task }: { ai: AiId; value: RunPicks; onChange: (v: RunPicks) => void; compact?: boolean; usage?: number; task?: string }) {
  const id = useId()
  const models = MODELS[ai]
  if (!models) return null
  const set = (p: Partial<RunPicks>) => onChange({ ...value, ...p })
  const why = value.auto && task ? autoLine(task, ai, usage ?? 0) : undefined
  const held = usage === undefined ? undefined : heldLine(usage, value.auto)
  const advisors = advisorsFor(value.auto ? undefined : value.model)
  const select = (name: string, list: Array<[string, string]>, v: string | undefined, to: (v: string | undefined) => void) =>
    <label style={compact ? { ...lab, display: 'grid', gridTemplateColumns: '52px 1fr' } : lab}>{name}
      <select className="hub-select" value={v ?? ''} onChange={e => to(e.target.value || undefined)} style={{ color: v ? undefined : 'var(--hub-mute)', flex: compact ? 1 : undefined }}>
        <option value="">Default</option>
        {list.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
      </select>
    </label>
  return (
    <div role="group" aria-label="Model and effort" style={compact ? { display: 'grid', gap: 8 } : { display: 'flex', flexWrap: 'wrap', gap: '4px 12px', alignItems: 'center', minWidth: 0 }}>
      <button type="button" role="switch" className="hub-switch" aria-checked={value.auto} aria-describedby={`${id}h`} onClick={() => set({ auto: !value.auto })}>
        <span aria-hidden />Auto (recommended)
      </button>
      {value.auto
        ? <span id={`${id}h`} style={{ ...hint, display: 'grid', gap: 2 }}>
          {why ?? 'Auto picks per task'}
          {held && <span role="status" style={{ color: 'var(--hub-yellow)' }}>{held}</span>}
        </span>
        : <>
          <span id={`${id}h`} className="sr-only">Off: the model and effort below, or the defaults from Settings</span>
          {select('Model', models, value.model, model => set({ model }))}
          {select('Effort', EFFORTS, value.effort, effort => set({ effort }))}
          {ai === 'claude' && <button type="button" role="switch" className="hub-switch" aria-checked={!!value.ultracode} title="Runs the first message as a multi-agent workflow"
            onClick={() => set({ ultracode: !value.ultracode })}><span aria-hidden />Ultracode</button>}
        </>}
      {/* Auto never picks an advisor, so it shows in both modes; a model change drops one ranked below it. */}
      {ai === 'claude' && select('Advisor', advisors, advisors.some(([a]) => a === value.advisor) ? value.advisor : undefined, advisor => set({ advisor }))}
    </div>
  )
}
