'use client'

// Advanced mode on a chat card: the stage line, and under it each stage with the review step between stages.
import { useId, useState } from 'react'
import type { HubState } from '@/lib/hub-types'
import type { HubCommand } from '@/lib/vscode-bridge'
import { chatRun, stageView } from '@/lib/stages-ui'
import './stages.css'

export const ADVANCED_HINT = 'Switchboard splits big tasks into stages that each get their own context, and reviews the work between stages.'

const WORD = { todo: 'To do', doing: 'Running', done: 'Done', redo: 'Sent back' } as const

/** inline: on a Now card, opened at once (a stage sent back or waiting on review), without Save as pipeline. */
export function CardStages({ hub, sessionId, send, inline }: { hub: Pick<HubState, 'stages' | 'controls'>; sessionId: string; send: (c: HubCommand) => void; inline?: boolean }) {
  const [open, setOpen] = useState(!!inline)
  const [name, setName] = useState('')
  const [saved, setSaved] = useState('')
  const id = useId()
  const found = chatRun(hub, sessionId)
  if (!found) return null
  const { path, run } = found, stages = run.stages, v = stageView(stages)
  const mark = (n: number, status: 'done' | 'redo') => send({ type: 'hub-stage', path, run: run.run, n, status })
  const tone = v.at >= 0 ? stages[v.at].status : 'done'
  return (
    <div className="hub-stages" data-quiet={v.quiet || undefined} data-gate={v.gate >= 0 || undefined}>
      <button type="button" className="hub-stages-head" aria-expanded={open} aria-controls={id} title={v.line} onClick={() => setOpen(o => !o)}>
        <span className="hub-stages-segs" aria-hidden>{stages.map(s => <i key={s.n} data-st={s.status} />)}</span>
        <span className="hub-stages-line" data-st={tone}>{v.line}</span>
        <b aria-hidden>›</b>
      </button>
      {open && <ol id={id} aria-label="Stages">
        {stages.map((s, i) => (
          <li key={s.n} data-st={s.status} aria-current={i === v.at ? 'step' : undefined}>
            <span className="hub-stages-dot" aria-hidden>{s.status === 'done' ? '✓' : i + 1}</span>
            <span className="hub-stages-name" title={`${s.name}, ${s.role}`}>{s.name}<span>{s.role}</span></span>
            <span className="hub-stages-st">{WORD[s.status]}</span>
            {i === v.gate && <span className="hub-stages-gate" role="group" aria-label={`Review ${s.name}`}>
              <button type="button" className="hub-btn sm" onClick={() => mark(s.n, 'done')}>Looks good</button>
              <button type="button" className="hub-link" onClick={() => mark(s.n, 'redo')}>Redo</button>
            </span>}
          </li>
        ))}
      </ol>}
      {open && !inline && <form className="hub-stages-save" onSubmit={e => { e.preventDefault(); const n = name.trim(); if (!n) return; send({ type: 'hub-pipeline-save', path, run: run.run, name: n }); setSaved(n); setName('') }}>
        <input aria-label="Pipeline name" placeholder="Pipeline name" maxLength={80} value={name} onChange={e => { setName(e.target.value); setSaved('') }} />
        <button type="submit" className="hub-btn sm" disabled={!name.trim()} title="Keeps these stages and their CONTEXT.md files, without outputs, to start new chats from">Save as pipeline</button>
        {saved && <span role="status">Saved {saved}</span>}
      </form>}
    </div>
  )
}
