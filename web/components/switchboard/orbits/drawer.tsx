'use client'
// The node drawer: one role in this chat as a short story. A headline, the latest run open, earlier runs folded.
// The lead's is one run, the chat's own transcript: its last message and who it sent which brief to.
// Beside the picture on a wide view (an aside, the picture stays clickable); a bottom sheet on a narrow one (a modal dialog).
// Read only: copy, open the transcript, jump to the chat. Nothing here changes a running agent.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useFlash } from '@/hooks/use-flash'
import { teamOf } from '@/lib/orbit-views'
import { sayLeft, type Left } from '@/lib/eta'
import { clockDur, count, loadRuns, roleLeft, runState, statusTone, type RunDetail } from '@/lib/runs'
import { storyOf } from '@/lib/run-story'
import { demoRunDetails } from '@/lib/hub-demo'
import { vscodeBridge } from '@/lib/vscode-bridge'
import type { ChatProgress } from '@/lib/hub-types'
import { Glyph, NAME, TONE, leadState } from './parts'
import { almostDone } from '@/lib/look'
import type { OrbitChat } from './orbit'
import './drawer.css'

export type DrawerProps = {
  chat: OrbitChat; role: string; all: ChatProgress[]; demo?: boolean; sheet: boolean
  onClose: () => void; onFocus?: () => void; onCopy?: (text: string) => Promise<boolean>
}
type Acts = Pick<DrawerProps, 'onCopy' | 'onFocus'>
type St = 'active' | 'done'

const hhmm = (at: number) => new Date(at).toTimeString().slice(0, 5)
const leftWords = (l?: Left) => (!l ? undefined : l === 'estimating' ? 'estimating' : l === 'over' ? 'longer than usual' : sayLeft(l).replace(/ left$/, ''))
const CLOSE = 'M4 4l8 8M12 4l-8 8'
const TONES = { done: 'var(--hub-green)', concerns: 'var(--hub-yellow)', blocked: 'var(--hub-red)', active: 'var(--hub-blue)', idle: 'var(--hub-mute)' }
const WORD = { done: 'Finished', concerns: 'Finished with concerns', blocked: 'Blocked', active: 'Working', idle: 'Done' }
const tone = (r: RunDetail, st: St) => (st === 'active' ? 'active' : statusTone(r.report?.status) ?? (r.report ? 'done' : 'idle'))
const LINES = 4, CALLS_SHOWN = 8

// "Goal: x" lines get a bold lead word, the rest reads as plain paragraphs.
function Text({ text, fold }: { text: string; fold?: boolean }) {
  const [all, setAll] = useState(false)
  // Blank lines and indents stay: briefs are often laid out by hand.
  const lines = text.replace(/^\s*\n|\s+$/g, '').split('\n').map(l => l.trimEnd())
  const more = fold ? lines.length - LINES : 0
  return (
    <div className="ovs-text">
      {(more > 0 && !all ? lines.slice(0, LINES) : lines).map((l, i) => {
        const m = /^([A-Z][\w ]{1,18}):\s*(.*)$/.exec(l)
        return <p key={i}>{m ? <><b>{m[1]}:</b> {m[2]}</> : l}</p>
      })}
      {more > 0 && <button type="button" className="hub-btn ovs-more" aria-expanded={all} onClick={() => setAll(a => !a)}>{all ? 'Show less' : `Show ${more} more line${more === 1 ? '' : 's'}`}</button>}
    </div>
  )
}

function Outcome({ run, st }: { run: RunDetail; st: St }) {
  const r = run.report
  const rows = r ? ([['What changed', r.changed], ['What was checked', r.checked], ['Still open', r.open]] as const).filter(([, xs]) => xs.length) : []
  if (!r && run.reportText) return <Text text={run.reportText} />
  if (!r) return <p className="ovs-mute">{st === 'active' ? 'Still working, no report yet.' : 'No report came back.'}</p>
  return (
    <div className="ovs-rep">
      {rows.map(([k, xs]) => <div key={k}><h5>{k}</h5><ul>{xs.map((x, i) => <li key={i}>{x}</li>)}</ul></div>)}
      {!rows.length && <p className="ovs-mute">The report was empty.</p>}
    </div>
  )
}

// Low-value detail, folded: tool calls, tokens, cost.
function Details({ run }: { run: RunDetail }) {
  const [all, setAll] = useState(false)
  const input = run.tokens.input + run.tokens.cacheRead + run.tokens.cacheWrite
  const calls = [...run.calls].reverse(), shown = all ? calls : calls.slice(0, CALLS_SHOWN)
  const bits = [input > 0 && `${count(input)} tokens read`, run.tokens.output > 0 && `${count(run.tokens.output)} written`, run.costUsd !== undefined && `about $${run.costUsd.toFixed(2)}`].filter(Boolean)
  if (!bits.length && !calls.length) return null
  return (
    <details className="ovs-fold">
      <summary>Details</summary>
      {bits.length > 0 && <p className="ovs-mute">{bits.join(', ')}</p>}
      {calls.length > 0 && <>
        <p className="ovs-mute">{run.callCount} tool call{run.callCount === 1 ? '' : 's'}{run.callCount > shown.length ? `, latest ${shown.length}` : ''}</p>
        <ul className="ovs-calls" aria-label="Tool calls, newest first">{shown.map((c, i) => <li key={i}><span>{clockDur(c.at - run.startedAt)}</span><b>{c.tool}</b><span>{c.target ?? ''}</span></li>)}</ul>
        {calls.length > CALLS_SHOWN && <button type="button" className="hub-btn ovs-more" aria-expanded={all} onClick={() => setAll(a => !a)}>{all ? 'Show fewer' : `Show all ${calls.length}`}</button>}
      </>}
    </details>
  )
}

function Buttons({ run, lead, onCopy, onFocus }: { run: RunDetail; lead: boolean } & Acts) {
  const [said, setSaid] = useFlash<string | undefined>(undefined, 1600)
  const copy = async (what: string, t: string) => { if (onCopy && await onCopy(t)) setSaid(`${what} copied`) }
  return (
    <>
      <div className="ovd-acts">
        {onCopy && !lead && <button type="button" className="hub-btn" disabled={!run.brief} onClick={() => void copy('Brief', run.brief)}>Copy brief</button>}
        {onCopy && <button type="button" className="hub-btn" disabled={!run.reportText} onClick={() => void copy(lead ? 'Message' : 'Report', run.reportText ?? '')}>{lead ? 'Copy last message' : 'Copy report'}</button>}
        {vscodeBridge?.isVSCode && run.file && <button type="button" className="hub-btn" onClick={() => vscodeBridge?.openFile(run.file)}>Open transcript</button>}
        {onFocus && <button type="button" className="hub-btn" onClick={onFocus}>Jump to chat</button>}
      </div>
      <p className="ovd-said" role="status">{said}</p>
    </>
  )
}

const Sec = ({ title, children }: { title: string; children: ReactNode }) => <section className="ovs-sec"><h4 className="ovs-h">{title}</h4>{children}</section>

function RunStory({ run, st, lead, ...acts }: { run: RunDetail; st: St; lead?: boolean } & Acts) {
  if (lead) {
    const sent = [...(run.dispatches ?? [])].reverse()
    return (
      <>
        <Sec title="Last message"><Text text={run.reportText || 'No message yet.'} /></Sec>
        <Sec title={`Handed out${sent.length ? ` (${sent.length})` : ''}`}>
          {sent.length ? sent.map((d, i) => <details key={i} className="ovs-fold ovs-sent"><summary>{NAME(d.role)}{d.title ? `: ${d.title}` : ''} <small>{hhmm(d.at)}</small></summary><Text text={d.brief || 'No brief.'} /></details>) : <p className="ovs-mute">No roles sent out yet.</p>}
        </Sec>
        <Details run={run} />
        <Buttons run={run} lead {...acts} />
      </>
    )
  }
  const t = tone(run, st)
  return (
    <>
      <Sec title="How it went">
        <p className="ovs-pill" style={{ '--c': TONES[t] } as CSSProperties}><i aria-hidden />{WORD[t]}{st === 'done' && ` in ${clockDur(run.endedAt - run.startedAt)}`}</p>
        <Outcome run={run} st={st} />
      </Sec>
      {run.loops.length > 0 && <Sec title="Sent back">
        {run.loops.map((l, i) => <p key={i} className="ovs-back" data-by={l.by}><b>{l.by === 'qa' ? 'QA' : 'The lead'} sent it back at {hhmm(l.at)}</b>{l.text}</p>)}
      </Sec>}
      <Sec title="What it was asked"><Text text={run.brief || 'No brief in the transcript.'} fold /></Sec>
      {run.files.length > 0 && <Sec title={`Files changed (${run.files.length})`}>
        <ul className="ovs-files">{run.files.map(f => <li key={f.path}><span title={f.path}><bdi>{f.path}</bdi></span><em>+{f.added}</em><u>-{f.removed}</u></li>)}</ul>
      </Sec>}
      <Details run={run} />
      <Buttons run={run} lead={false} {...acts} />
    </>
  )
}

function Story({ role, runs, problem, active, left, p, n, ...acts }: { role: string; runs?: RunDetail[]; problem?: string; active: boolean; left?: string; p?: ChatProgress; n: number } & Acts) {
  if (problem) return <p className="ovs-mute">Could not read the transcript: {problem}</p>
  if (!runs) return <p className="ovs-mute" role="status">Reading the transcript...</p>
  const lead = role === 'lead'
  const story = storyOf(role, runs, { active, left })
  const ordered = [...runs].sort((a, b) => a.startedAt - b.startedAt)
  const last = ordered[ordered.length - 1], older = ordered.slice(0, -1).reverse()
  return (
    <div className="ovs">
      <header className="ovs-head">
        <p>{story.headline}</p>
        {story.facts.length > 0 && <ul>{story.facts.map(f => <li key={f}>{f}</li>)}</ul>}
      </header>
      {!last ? n > 0 && <p className="ovs-mute">No transcript for these runs on this Mac.</p> : <>
        <RunStory run={last} st={lead ? (active ? 'active' : 'done') : runState(last, p)} lead={lead} {...acts} />
        {older.length > 0 && <Sec title="Earlier runs">
          {older.map(r => (
            <details key={r.id} className="ovs-fold ovs-old">
              <summary>Run {ordered.indexOf(r) + 1}{r.title ? `: ${r.title}` : ''} <small>{WORD[tone(r, runState(r, p))]}</small></summary>
              <div className="ovs-in"><RunStory run={r} st={runState(r, p)} {...acts} /></div>
            </details>
          ))}
        </Sec>}
      </>}
    </div>
  )
}

export function RoleDrawer({ chat, role, all, demo, sheet, onClose, onFocus, onCopy }: DrawerProps) {
  const p = chat.progress, team = teamOf(p).find(r => r.role === role), lead = role === 'lead'
  const state = lead ? leadState(chat, almostDone(p)) : team?.state ?? 'unused'
  const steps = team?.runs ?? []
  const [runs, setRuns] = useState<RunDetail[]>()
  const [problem, setProblem] = useState<string>()
  const prog = useRef(p)
  prog.current = p
  const active = state === 'active' || state === 'working'

  // Loaded when it opens or the role's runs change; again every 15 s while one works.
  useEffect(() => {
    let stop = false
    const go = () => void (demo ? Promise.resolve(demoRunDetails(prog.current, role)) : loadRuns(chat.id, role)).then(r => {
      if (stop) return
      if (typeof r === 'string') setProblem(r)
      else { setRuns(r); setProblem(undefined) }
    })
    go()
    const t = active ? setInterval(go, 15_000) : undefined
    return () => { stop = true; clearInterval(t) }
  }, [chat.id, role, demo, active, steps.length])
  useEffect(() => { setRuns(undefined); setProblem(undefined) }, [chat.id, role])

  const left = leftWords(roleLeft(p, all, role, Date.now()))
  const model = chat.models?.[role] ?? runs?.[0]?.model
  const n = Math.max(steps.length, runs?.length ?? 0)

  const box = useRef<HTMLElement>(null)
  // The sheet is a modal dialog; the aside takes focus once, on open, so the next Tab reads it.
  useEffect(() => {
    const el = box.current
    if (el instanceof HTMLDialogElement && !el.open) el.showModal()
    el?.querySelector<HTMLElement>('.ovd-h h3')?.focus()
    return () => { if (el instanceof HTMLDialogElement) el.close() }
  }, [sheet])

  const inside = (
    <div className="ovd-in">
      {sheet && <div className="ovd-grab" aria-hidden />}
      <div className="ovd-h">
        <span className="ovd-gl" style={{ '--c': TONE[state] } as CSSProperties}><Glyph k={role} /></span>
        <div><h3 tabIndex={-1} id="ovd-title">{NAME(role)}</h3><small>{lead ? [chat.live?.model ?? runs?.[0]?.model, 'this chat'].filter(Boolean).join(' · ') : [model, `${n} run${n === 1 ? '' : 's'} this chat`].filter(Boolean).join(' · ')}</small></div>
        <button type="button" className="ovd-x" aria-label={`Close ${NAME(role)} details`} onClick={onClose}>
          <svg aria-hidden width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={CLOSE} /></svg>
        </button>
      </div>
      <Story role={role} runs={runs} problem={problem} active={active} left={left} p={p} n={n} onCopy={onCopy} onFocus={onFocus} />
    </div>
  )

  return sheet
    ? <dialog ref={box as React.RefObject<HTMLDialogElement>} id="ov-drawer" className="ovd" data-sheet aria-labelledby="ovd-title"
        onCancel={e => { e.preventDefault(); onClose() }} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>{inside}</dialog>
    : <aside ref={box} id="ov-drawer" className="ovd" aria-labelledby="ovd-title">{inside}</aside>
}
