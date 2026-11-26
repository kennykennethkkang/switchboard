'use client'
import { useState } from 'react'
import { Seg } from '../page-kit'
import { isStale, whenWord } from '@/lib/workbench'
import { actionsOf, idOf, partsOf, pending, select, useWorkbench } from '@/lib/workbench-store'
import { ActionCard, ApplyAll, Badge, ChangeDetail, Chip, Composer, DeviceStrip, ResetSample, Safety } from './parts'

/** The Workbench page: one split. Suggested and Changes in a list on the left, the picked one in full on the right. */
export function Workbench({ onChat }: { onChat?: (id: string) => void }) {
  const s = useWorkbench()
  const [seg, setSeg] = useState<'sug' | 'chg'>('sug')
  const [solo, setSolo] = useState(false)
  const [chgId, setChgId] = useState<string>()
  const n = pending(s).length
  const pickedChange = s.changes.find(c => c.id === chgId) ?? s.changes[0]
  const groups = s.suggestions.filter(g => actionsOf(s, g.report).length)
  const first = groups[0] && idOf(groups[0].report, actionsOf(s, groups[0].report)[0].key)
  const sel = s.sel && actionsOf(s, partsOf(s.sel)[0]).some(a => idOf(partsOf(s.sel!)[0], a.key) === s.sel) ? s.sel : first
  const [rep, key] = partsOf(sel ?? '')
  const sg = s.suggestions.find(x => x.report === rep)
  const act = sg && actionsOf(s, rep).find(a => a.key === key)
  return (
    <div className="wb" data-solo={solo || undefined}>
      <div className="wb-top"><DeviceStrip /><Composer /></div>
      <div className="wb-split">
        <div className="wb-list">
          <Seg label="Workbench list" value={seg} onChange={v => { setSeg(v); setSolo(false) }} options={[['sug', 'Suggested', n], ['chg', 'Changes', s.changes.length]]} />
          {seg === 'sug' ? !groups.length ? <p className="wb-empty">No suggested changes. A research report that finds something worth changing lists it here, or ask above.</p> : groups.map(g => {
            const list = actionsOf(s, g.report)
            return (
              <section key={g.report} className="wb-lgroup" aria-label={g.question}>
                <header><h3>{g.question}</h3><ApplyAll report={g.report} list={list} /></header>
                <ul>{list.map(a => {
                  const id = idOf(g.report, a.key)
                  return <li key={a.key}><button type="button" className="wb-row" aria-current={sel === id ? 'true' : undefined} onClick={() => { select(id); setSolo(true) }}>
                    <span className="wb-row-t">{a.title}</span>
                    <span className="wb-meta"><Chip area={a.area} />{a.area !== 'project' && <Safety ask={a.ask} />}{a.state !== 'new' && <Badge state={a.state} />}</span>
                  </button></li>
                })}</ul>
              </section>
            )
          }) : <ul className="wb-lgroup">{s.changes.map(c => (
            <li key={c.id}><button type="button" className="wb-row" aria-current={pickedChange?.id === c.id ? 'true' : undefined} onClick={() => { setChgId(c.id); setSolo(true) }}>
              <span className="wb-row-t">{c.title}</span>
              <span className="wb-meta"><Chip area={c.area} /><Badge state={c.status} stale={isStale(c)} /><span>{whenWord(c.at)}</span></span>
            </button></li>
          ))}</ul>}
          <ResetSample />
        </div>
        <div className="wb-view">
          <button type="button" className="wb-back" onClick={() => setSolo(false)}>
            <svg aria-hidden width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M10 3 5 8l5 5" /></svg>{seg === 'sug' ? 'Suggested' : 'Changes'}
          </button>
          {seg === 'sug'
            ? (sg && act ? <ActionCard src={{ report: sg.report, question: sg.question }} a={act} /> : <p className="wb-empty">Pick a suggested change.</p>)
            : (pickedChange ? <ChangeDetail c={pickedChange} onChat={onChat} /> : <p className="wb-empty">No changes yet.</p>)}
        </div>
      </div>
    </div>
  )
}
