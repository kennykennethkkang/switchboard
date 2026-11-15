'use client'

// Goal budget line, its editor, the check-back pick and Refine now, under a chat's title.
import { useState } from 'react'
import type { ChatRow } from '@/lib/hub-types'
import type { HubCommand } from '@/lib/vscode-bridge'
import { CHECK_BACK_OPTIONS, budgetFill, budgetForm, budgetLine, budgetMsg, checkBackCount, checkBackValue } from '@/lib/budget-ui'
import { Pick } from './gear'
import { TaskBar } from './chat-cards'
import { label } from './look'

const field = { font: 'inherit', padding: '7px 10px', borderRadius: 8, minWidth: 0, background: 'var(--hub-canvas)', color: 'var(--hub-ink)', border: '1px solid var(--hub-hair)' } as const

export function ChatBudget({ chat, send, loop }: { chat: ChatRow; send: (c: HubCommand) => void; loop: boolean }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(() => budgetForm(chat.budget))
  const id = chat.sessionId
  const codex = chat.ai === 'codex'
  const line = budgetLine(chat), fill = budgetFill(chat)
  const save = () => { send({ type: 'hub-budget', sessionId: id, ...budgetMsg(form.hours, codex ? '' : form.usd, form.gate) }); setOpen(false) }
  const pick = (v: string) => send(v === '0' ? { type: 'hub-checkback-clear', sessionId: id } : { type: 'hub-checkback', sessionId: id, everyMin: Number(v) as 10 | 30 | 60 })
  return (
    <div className="cp-budget" style={{ display: 'grid', gap: 8, minWidth: 0 }}>
      {(line || fill !== undefined) && <div style={{ display: 'grid', gap: 6 }}>
        {line && <span className="hub-num" style={{ fontSize: 13, color: 'var(--hub-body)' }} title="Time since the chat started and what it has cost">{line}</span>}
        {fill !== undefined && <TaskBar done={Math.round(fill * 100)} total={100} label="Progress toward the time or cost limit" height={3} />}
      </div>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        {(loop || !!chat.budget) && <button type="button" className="hub-btn" aria-expanded={open} onClick={() => { setForm(budgetForm(chat.budget)); setOpen(o => !o) }} title="Limits and a gate command for Run indefinitely">{chat.budget ? 'Edit limits' : 'Set limits'}</button>}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Pick label="Check back" options={CHECK_BACK_OPTIONS} value={checkBackValue(chat.checkBack)} onChange={pick} muted={!chat.checkBack} />
          {chat.checkBack && <span className="hub-num" style={{ fontSize: 12, color: 'var(--hub-mute)' }} title="Check-backs sent so far, of 12">{checkBackCount(chat.checkBack)}</span>}
        </span>
        <button type="button" className="hub-btn" onClick={() => send({ type: 'hub-refine', sessionId: id })} title="Runs the aar skill on this chat now, then it carries on">Refine now</button>
      </div>
      {open && <form onSubmit={e => { e.preventDefault(); save() }} style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', padding: 10, border: '1px solid var(--hub-hair)', borderRadius: 8, background: 'var(--hub-surface)' }}>
        <label style={{ display: 'grid', gap: 4 }}><span style={label}>Max hours</span>
          <input inputMode="decimal" style={field} value={form.hours} placeholder="No limit" onChange={e => setForm({ ...form, hours: e.target.value })} /></label>
        {codex
          ? <span style={{ alignSelf: 'end', fontSize: 12, color: 'var(--hub-mute)' }}>Codex reports no cost; use hours or a gate</span>
          : <label style={{ display: 'grid', gap: 4 }}><span style={label}>Max cost ($)</span>
            <input inputMode="decimal" style={field} value={form.usd} placeholder="No limit" onChange={e => setForm({ ...form, usd: e.target.value })} /></label>}
        <label style={{ display: 'grid', gap: 4, gridColumn: '1 / -1' }}><span style={label}>Gate command</span>
          <input style={{ ...field, font: '400 13px/1.4 var(--hub-mono)' }} value={form.gate} maxLength={500} spellCheck={false} autoCapitalize="off" placeholder="npm test (the chat may stop when it exits 0)" onChange={e => setForm({ ...form, gate: e.target.value })} /></label>
        <span style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="hub-btn" onClick={() => setOpen(false)}>Cancel</button>
          <button type="submit" className="hub-btn primary">Save</button>
        </span>
      </form>}
    </div>
  )
}
