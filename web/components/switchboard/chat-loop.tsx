'use client'

// A chat's loop (Turn, Goal, Timer, Proactive), its time and cost line, and Refine now, under its title.
import { useEffect, useId, useState, type PointerEvent } from 'react'
import type { ChatProfile, ChatRow } from '@/lib/hub-types'
import { vscodeBridge, type HubCommand } from '@/lib/vscode-bridge'
import { budgetFill, budgetForm, budgetLine, budgetMsg, checkBackCount } from '@/lib/budget-ui'
import { indefiniteHint } from '@/lib/indefinite'
import { EVERY, ROUTINES_URL, everyText, loopOf, scheduleText, type Every, type LoopChoice, type LoopMode } from '@/lib/loop'
import { Pick } from './gear'
import { TaskBar } from './chat-cards'
import { label } from './look'
import './chat-view.css'

const field = { font: 'inherit', padding: '7px 10px', borderRadius: 8, minWidth: 0, background: 'var(--hub-canvas)', color: 'var(--hub-ink)', border: '1px solid var(--hub-hair)' } as const
const mute = { margin: 0, fontSize: 13, color: 'var(--hub-mute)' } as const

export const MODES: Array<[LoopMode, string, string]> = [
  ['turn', 'Turn', 'Does the task, then waits for you'],
  ['goal', 'Goal', 'Keeps going until the goal is met'],
  ['timer', 'Timer', 'Sends a prompt on an interval while the chat is open'],
  ['proactive', 'Proactive', 'A cloud routine: runs on a schedule or a GitHub event, even with this Mac off'],
]
const AUTO: [LoopChoice, string, string] = ['auto', 'Auto', 'Picks one of the four from your message']
/** The hover card per loop: what it is for, when it stops, and an example. */
export const LOOP_INFO: Record<LoopChoice, { use: string; stops: string; example: string }> = {
  auto: { use: 'Any message. Turn, unless it asks to keep going (Goal), to check back (Timer) or to run on a schedule (Proactive).', stops: 'Like the mode it picks, shown below before you start. Click a mode to pick it yourself; each mode you change and each chat you approve teaches it.', example: 'Fix the login bug until all tests pass: Goal' },
  turn: { use: 'Questions, fixes and steps you want to look at before the next one.', stops: 'When it answers. You send the next message.', example: 'Why does the build fail on Windows?' },
  goal: { use: 'Long jobs with a clear finish: tests to pass, a score to reach, a list to clear.', stops: "When the goal file's check passes, the gate command exits 0, or a time or cost limit is hit.", example: 'Get Lighthouse to 90 or more on every page' },
  timer: { use: 'Watching something while the chat is open: CI, a deploy, an inbox.', stops: 'After 12 sends or when the chat ends. Needs this Mac and the chat open.', example: 'Every 30 min, check CI and fix what fails' },
  proactive: { use: "Jobs on a schedule or a GitHub event that run in Anthropic's cloud, even with this Mac off.", stops: 'When you pause or delete it on claude.ai routines. Hourly at most; it uses your plan.', example: 'Every weekday at 9am, triage new issues' },
}
export const EVERY_OPTIONS: Array<[string, string]> = EVERY.map(m => [String(m), everyText(m)])
export const PROACTIVE_NOTE = "Made with /schedule in a new Claude chat. It runs in Anthropic's cloud, hourly at most or on GitHub events, and uses your plan."

/** The Turn / Goal / Timer / Proactive buttons (Auto first with auto); hover or keyboard focus shows the mode's card. */
export function LoopSeg<M extends LoopChoice>({ value, onPick, label: name, only, auto }: { value: M; onPick: (m: M) => void; label: string; only?: LoopMode[]; auto?: boolean }) {
  const [tip, setTip] = useState<LoopChoice>()
  const id = useId()
  const list = [...(auto ? [AUTO] : []), ...MODES.filter(([m]) => !only || only.includes(m))]
  const shown = tip && list.find(([m]) => m === tip)
  const mouse = (m?: LoopChoice) => (e: PointerEvent) => { if (e.pointerType === 'mouse') setTip(m) }
  return (
    <span className="hub-tip-at" style={{ width: 'fit-content' }} onPointerLeave={mouse(undefined)} onKeyDown={e => { if (e.key === 'Escape' && tip) { e.stopPropagation(); setTip(undefined) } }}>
      <div role="group" aria-label={name} className="cv-seg">
        {list.map(([m, text]) => <button key={m} type="button" aria-pressed={value === m} aria-describedby={tip === m ? id : undefined} onClick={() => onPick(m as M)}
          onPointerEnter={mouse(m)} onFocus={e => { if (e.currentTarget.matches(':focus-visible')) setTip(m) }} onBlur={() => setTip(undefined)}>{text}</button>)}
      </div>
      {shown && <div id={id} role="tooltip" className="hub-tip" style={{ width: 'min(360px, calc(100vw - 32px))' }}>
        <div style={{ display: 'grid', gap: 6, padding: 12, borderRadius: 10, fontSize: 13, color: 'var(--hub-body)', background: 'var(--hub-elev)', border: '1px solid var(--hub-hair-strong)', boxShadow: 'var(--hub-shadow-pop)' }}>
          <b style={{ fontWeight: 500, color: 'var(--hub-ink)' }}>{shown[1]}: {shown[2]}</b>
          <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 10px', margin: 0 }}>
            {([['For', 'use'], ['Stops', 'stops'], ['Example', 'example']] as const).map(([t, k]) => <div key={k} style={{ display: 'contents' }}>
              <dt style={{ ...label, lineHeight: '19px' }}>{t}</dt><dd style={{ margin: 0, color: k === 'example' ? 'var(--hub-mute)' : undefined }}>{LOOP_INFO[shown[0]][k]}</dd>
            </div>)}
          </dl>
        </div>
      </div>}
    </span>
  )
}

const openUrl = (url: string, send: (c: HubCommand) => void) => (vscodeBridge?.isVSCode ? send({ type: 'hub-open-url', url }) : window.open(url, '_blank', 'noopener'))

export function ChatLoop({ chat, profile, send }: { chat: ChatRow; profile?: ChatProfile; send: (c: HubCommand) => void }) {
  const id = chat.sessionId, codex = chat.ai === 'codex'
  const active = loopOf({ indefinite: profile?.indefinite, checkBack: chat.checkBack ?? profile?.checkBack })
  const [view, setView] = useState<LoopMode>(active)
  useEffect(() => setView(active), [active])
  const [doneWhen, setDoneWhen] = useState('')
  const cb = chat.checkBack ?? profile?.checkBack
  const [every, setEvery] = useState<string>(String(cb?.everyMin ?? 30))
  const [prompt, setPrompt] = useState(cb?.text ?? '')
  const [what, setWhat] = useState('')
  const [made, setMade] = useState(false)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(() => budgetForm(chat.budget))
  const line = budgetLine(chat), fill = budgetFill(chat)
  const pick = (m: LoopMode) => { setView(m); setMade(false); if (m === 'turn' && active !== 'turn') send({ type: 'hub-loop', sessionId: id, loop: { mode: 'turn' } }) }
  const goal = () => { send({ type: 'hub-loop', sessionId: id, loop: { mode: 'goal', ...(doneWhen.trim() ? { doneWhen: doneWhen.trim() } : {}) } }); setDoneWhen('') }
  const timer = () => send({ type: 'hub-loop', sessionId: id, loop: { mode: 'timer', everyMin: Number(every) as Every, ...(prompt.trim() ? { text: prompt.trim() } : {}) } })
  const routine = () => { if (!what.trim()) return; send({ type: 'hub-new-chat', path: chat.cwd, text: scheduleText(what), remote: false }); setWhat(''); setMade(true) }
  const save = () => { send({ type: 'hub-budget', sessionId: id, ...budgetMsg(form.hours, codex ? '' : form.usd, form.gate) }); setOpen(false) }
  return (
    <div className="cp-budget" style={{ display: 'grid', gap: 8, minWidth: 0 }}>
      {(line || fill !== undefined) && <div style={{ display: 'grid', gap: 6 }}>
        {line && <span className="hub-num" style={{ fontSize: 13, color: 'var(--hub-body)' }} title="Time since the chat started and what it has cost">{line}</span>}
        {fill !== undefined && <TaskBar done={Math.round(fill * 100)} total={100} label="Progress toward the time or cost limit" height={3} />}
      </div>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <LoopSeg value={view} onPick={pick} label="Loop" />
        <button type="button" className="hub-btn" onClick={() => send({ type: 'hub-refine', sessionId: id })} title="Runs the aar skill on this chat now, then it carries on">Refine now</button>
      </div>
      {view === 'turn' && <p style={mute}>{MODES[0][2]}.</p>}
      {view === 'goal' && <form onSubmit={e => { e.preventDefault(); goal() }} style={{ display: 'grid', gap: 8 }}>
        <p style={mute}>{active === 'goal' ? indefiniteHint(profile, Date.now(), chat.budget ?? profile?.budget) : 'Asks its questions once, then keeps going until the goal is met. The goal file\'s Check command or the gate decides.'}</p>
        <label style={{ display: 'grid', gap: 4 }}><span style={label}>{active === 'goal' ? 'New goal (optional)' : 'Done when (optional)'}</span>
          <input style={field} value={doneWhen} maxLength={2000} placeholder="All tests pass and Lighthouse scores 90 or more" onChange={e => setDoneWhen(e.target.value)} /></label>
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {(active !== 'goal' || doneWhen.trim()) && <button type="submit" className="hub-btn primary">{active === 'goal' ? 'Send goal' : 'Start goal loop'}</button>}
          {(active === 'goal' || !!chat.budget) && <button type="button" className="hub-btn" aria-expanded={open} onClick={() => { setForm(budgetForm(chat.budget)); setOpen(o => !o) }} title="Time and cost caps and a gate command for the goal loop">{chat.budget ? 'Edit limits' : 'Set limits'}</button>}
        </span>
      </form>}
      {view === 'goal' && open && <form onSubmit={e => { e.preventDefault(); save() }} style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', padding: 10, border: '1px solid var(--hub-hair)', borderRadius: 8, background: 'var(--hub-surface)' }}>
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
      {view === 'timer' && <form onSubmit={e => { e.preventDefault(); timer() }} style={{ display: 'grid', gap: 8 }}>
        <p style={mute}>Sends the prompt when the chat has been idle that long, up to 12 times. Stops when the chat ends{active === 'timer' && cb ? `. Sent ${checkBackCount(cb)}` : ''}.</p>
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <Pick label="How often" options={EVERY_OPTIONS} value={every} onChange={setEvery} />
          <input aria-label="Prompt" style={{ ...field, flex: '1 1 220px' }} value={prompt} maxLength={500} placeholder="Check back on open work (default)" onChange={e => setPrompt(e.target.value)} />
          <button type="submit" className="hub-btn primary">{active === 'timer' ? 'Save timer' : 'Start timer'}</button>
        </span>
      </form>}
      {view === 'proactive' && <form onSubmit={e => { e.preventDefault(); routine() }} style={{ display: 'grid', gap: 8 }}>
        <p style={mute}>{PROACTIVE_NOTE}</p>
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <input aria-label="What the routine does, and when" style={{ ...field, flex: '1 1 260px' }} value={what} maxLength={2000} placeholder="Every weekday at 9am, triage new GitHub issues and draft replies" onChange={e => { setWhat(e.target.value); setMade(false) }} />
          <button type="submit" className="hub-btn primary" disabled={!what.trim()}>Create routine</button>
          <button type="button" className="hub-btn" onClick={() => openUrl(ROUTINES_URL, send)} title="Your cloud routines on claude.ai, where you pause or delete them">See routines</button>
        </span>
        {made && <p role="status" style={mute}>Started a Claude chat that sets it up with /schedule.</p>}
      </form>}
    </div>
  )
}
