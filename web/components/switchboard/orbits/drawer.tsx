'use client'
// The node drawer: one role in this chat, then each of its runs, newest first, opening in place.
// The lead's is one run, the chat's own transcript: its calls, who it sent which brief to, and its last message.
// Beside the picture on a wide view (an aside, the picture stays clickable); a bottom sheet on a narrow one (a modal dialog).
// Read only: copy, open the transcript, jump to the chat. Nothing here changes a running agent.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { teamOf } from '@/lib/orbit-views'
import { sayLeft, type Left } from '@/lib/eta'
import { clockDur, count, kindOf, loadRuns, roleLeft, runState, statusTone, type RunDetail } from '@/lib/runs'
import { demoRunDetails } from '@/lib/hub-demo'
import { vscodeBridge } from '@/lib/vscode-bridge'
import type { ChatProgress } from '@/lib/hub-types'
import { Glyph, LABEL, LEAD_WORD, NAME, TONE, leadState } from './parts'
import { almostDone } from '../look'
import type { OrbitChat } from '../orbit'
import './drawer.css'

export type DrawerProps = {
  chat: OrbitChat; role: string; all: ChatProgress[]; demo?: boolean; sheet: boolean
  onClose: () => void; onFocus?: () => void; onCopy?: (text: string) => Promise<boolean>
}

const hhmm = (at: number) => new Date(at).toTimeString().slice(0, 5)
const leftWords = (l?: Left) => (!l ? undefined : l === 'estimating' ? 'estimating' : l === 'over' ? 'longer than usual' : sayLeft(l).replace(/ left$/, ''))
const CALLS_SHOWN = 8
const ICON = {
  copy: 'M5.5 5.5V3.5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2M3.5 5.5h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z',
  file: 'M9 2.5H4.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V6L9 2.5ZM9 2.5V6h3.5',
  jump: 'M5 11 11 5M6 5h5v5',
  close: 'M4 4l8 8M12 4l-8 8',
}
const Ic = ({ d }: { d: string }) => <svg aria-hidden width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>

function Block({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return <section className="ovd-blk"><h4><span>{title}</span>{aside !== undefined && <span>{aside}</span>}</h4>{children}</section>
}

type BodyProps = { run: RunDetail; state: 'active' | 'done'; left?: string; lead?: boolean } & Pick<DrawerProps, 'onCopy' | 'onFocus'>

function Run({ run, n, state, left, onCopy, onFocus, open, toggle }: Omit<BodyProps, 'lead'> & { n: number; open: boolean; toggle: () => void }) {
  const time = state === 'active' ? `${clockDur(Date.now() - run.startedAt)} so far` : clockDur(run.endedAt - run.startedAt)
  const body = `ovd-run-${run.id}`
  return (
    <li data-x={open || undefined} data-s={state}>
      <button type="button" className="ovd-rh" aria-expanded={open} aria-controls={body} onClick={toggle}>
        <i aria-hidden style={{ '--c': TONE[state] } as React.CSSProperties} />
        <span>{n}. {run.title ?? `Run ${n}`}</span>
        <small>{time}</small>
        <svg className="ovd-chev" viewBox="0 0 16 16" aria-hidden><path d="m6 3.5 4.5 4.5L6 12.5" /></svg>
      </button>
      <div className="ovd-fold" id={body}><div inert={!open || undefined}><div className="ovd-rc">
        <RunBody run={run} state={state} left={left} onCopy={onCopy} onFocus={onFocus} />
      </div></div></div>
    </li>
  )
}

function RunBody({ run, state, left, lead, onCopy, onFocus }: BodyProps) {
  const [all, setAll] = useState(false)
  const [said, setSaid] = useState<string>()
  const now = Date.now(), end = state === 'active' ? now : run.endedAt, span = Math.max(1000, end - run.startedAt)
  const time = state === 'active' ? `${clockDur(now - run.startedAt)} so far` : clockDur(run.endedAt - run.startedAt)
  const tone = statusTone(run.report?.status)
  const input = run.tokens.input + run.tokens.cacheRead + run.tokens.cacheWrite
  const added = run.files.reduce((s, f) => s + f.added, 0), removed = run.files.reduce((s, f) => s + f.removed, 0)
  const calls = [...run.calls].reverse(), shown = all ? calls : calls.slice(0, CALLS_SHOWN)
  const pos = (at: number) => `${(Math.min(1, Math.max(0, (at - run.startedAt) / span)) * 100).toFixed(2)}%`
  const report = run.report ?? (state === 'done' && run.reportText ? undefined : null)
  const copy = async (what: string, text: string) => { if (onCopy && await onCopy(text)) { setSaid(`${what} copied`); setTimeout(() => setSaid(undefined), 1600) } }
  const sent = [...(run.dispatches ?? [])].reverse()
  return (
      <>
        <p className="ovd-meta">{[`${hhmm(run.startedAt)} start`, time, state === 'active' && left, input && `${count(input)} tokens`, run.costUsd !== undefined && `about $${run.costUsd.toFixed(2)}`].filter(Boolean).join(' · ')}</p>

        {lead ? <>
          <Block title="Last message"><pre className="ovd-brief">{run.reportText || 'No message yet.'}</pre></Block>
          <Block title="Sent out" aside={sent.length || undefined}>
            {sent.length ? sent.map((d, i) => <p key={i} className="ovd-note" data-by="lead"><b>{NAME(d.role)} at {hhmm(d.at)}{d.title ? `, ${d.title}` : ''}</b>{d.brief || 'No brief.'}</p>)
              : <p className="ovd-mute">No roles sent out yet.</p>}
          </Block>
        </> : <><Block title="Brief"><pre className="ovd-brief">{run.brief || 'No brief in the transcript.'}</pre></Block>

        <Block title="Report" aside={run.report?.status && <span className="ovd-chip" data-t={tone}>{run.report.status}</span>}>
          {report ? <dl className="ovd-rep">
            {([['Changed', report.changed], ['Checked', report.checked], ['Open', report.open]] as const).filter(([, xs]) => xs.length).map(([k, xs]) => (
              <div key={k}><dt>{k}</dt><dd><ul>{xs.map((x, i) => <li key={i}>{x}</li>)}</ul></dd></div>
            ))}
          </dl>
            : report === undefined ? <pre className="ovd-brief">{run.reportText}</pre>
            : <p className="ovd-mute">Still running, no report yet.</p>}
        </Block></>}

        {run.loops.length > 0 && <Block title="Sent back" aside={`${run.loops.length} time${run.loops.length > 1 ? 's' : ''}`}>
          {run.loops.map((l, i) => <p key={i} className="ovd-note" data-by={l.by}><b>{l.by === 'qa' ? 'By QA' : 'By the lead'} at {hhmm(l.at)}</b>{l.text}</p>)}
        </Block>}

        {run.files.length > 0 && <Block title="Files changed" aside={`${run.files.length}, +${added} -${removed}`}>
          <ul className="ovd-files">{run.files.map(f => <li key={f.path}><span title={f.path}><bdi>{f.path}</bdi></span><span className="ovd-add">+{f.added}</span><span className="ovd-del">-{f.removed}</span></li>)}</ul>
        </Block>}

        <Block title="Tool calls" aside={run.callCount > run.calls.length ? `last ${run.calls.length} of ${run.callCount}` : run.callCount}>
          {run.calls.length > 0 ? <>
            <div className="ovd-tl" aria-hidden>
              {run.calls.map((c, i) => <i key={i} data-t={kindOf(c.tool)} style={{ left: pos(c.at) }} />)}
              {run.loops.map((l, i) => <b key={`l${i}`} style={{ left: pos(l.at) }} />)}
            </div>
            <ul className="ovd-calls" aria-label="Tool calls, newest first">
              {shown.map((c, i) => <li key={i}><span>{clockDur(c.at - run.startedAt)}</span><b data-t={kindOf(c.tool)}>{c.tool}</b><span>{c.target ?? ''}</span></li>)}
            </ul>
            {calls.length > CALLS_SHOWN && <button type="button" className="ovd-more" onClick={() => setAll(a => !a)}>{all ? 'Show fewer' : `Show all ${calls.length}`}</button>}
          </> : <p className="ovd-mute">No tool calls.</p>}
        </Block>

        <Block title="Tokens and cost">
          <div className="ovd-kv">
            <div><small>Input</small><b>{count(input)}</b></div>
            <div><small>Cached</small><b>{count(run.tokens.cacheRead)}</b></div>
            <div><small>Output</small><b>{count(run.tokens.output)}</b></div>
            <div><small>Cost</small><b>{run.costUsd !== undefined ? `$${run.costUsd.toFixed(2)}` : 'unknown'}</b></div>
          </div>
        </Block>

        <div className="ovd-acts">
          {onCopy && !lead && <button type="button" className="hub-btn" disabled={!run.brief} onClick={() => void copy('Brief', run.brief)}><Ic d={ICON.copy} />Copy brief</button>}
          {onCopy && <button type="button" className="hub-btn" disabled={!run.reportText} onClick={() => void copy(lead ? 'Message' : 'Report', run.reportText ?? '')}><Ic d={ICON.copy} />{lead ? 'Copy last message' : 'Copy report'}</button>}
          {vscodeBridge?.isVSCode && run.file && <button type="button" className="hub-btn" onClick={() => vscodeBridge?.openFile(run.file)}><Ic d={ICON.file} />Open transcript</button>}
          {onFocus && <button type="button" className="hub-btn" onClick={onFocus}><Ic d={ICON.jump} />Jump to chat</button>}
        </div>
        <p className="ovd-said" role="status">{said}</p>
      </>
  )
}

export function RoleDrawer({ chat, role, all, demo, sheet, onClose, onFocus, onCopy }: DrawerProps) {
  const p = chat.progress, team = teamOf(p).find(r => r.role === role), lead = role === 'lead'
  const state = lead ? leadState(chat, almostDone(p)) : team?.state ?? 'unused'
  const steps = team?.runs ?? []
  const [runs, setRuns] = useState<RunDetail[]>()
  const [problem, setProblem] = useState<string>()
  const [x, setX] = useState<Record<string, boolean>>({})
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
  useEffect(() => { setRuns(undefined); setProblem(undefined); setX({}) }, [chat.id, role])

  const now = Date.now()
  const ordered = [...(runs ?? [])].sort((a, b) => a.startedAt - b.startedAt)
  const total = runs ? runs.reduce((s, r) => s + ((runState(r, p) === 'active' ? now : r.endedAt) - r.startedAt), 0)
    : steps.reduce((s, r) => s + ((r.state === 'active' ? now : r.at ?? r.startedAt) - r.startedAt), 0)
  const left = leftWords(roleLeft(p, all, role, now))
  const model = chat.models?.[role] ?? runs?.[0]?.model
  const n = Math.max(steps.length, runs?.length ?? 0)
  const main = lead ? runs?.[0] : undefined

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
        <span className="ovd-gl" style={{ '--c': TONE[state] } as React.CSSProperties}><Glyph k={role} /></span>
        <div><h3 tabIndex={-1} id="ovd-title">{NAME(role)}</h3><small>{lead ? [chat.live?.model ?? main?.model, 'this chat'].filter(Boolean).join(' · ') : [model, `${n} run${n === 1 ? '' : 's'} this chat`].filter(Boolean).join(' · ')}</small></div>
        <button type="button" className="ovd-x" aria-label={`Close ${NAME(role)} details`} onClick={onClose}><Ic d={ICON.close} /></button>
      </div>
      {lead ? <>
        <div className="ovd-stats">
          <div><small>Total time</small><b>{main ? clockDur((active ? now : main.endedAt) - main.startedAt) : '0s'}</b></div>
          <div><small>Tool calls</small><b>{main?.callCount ?? 0}</b></div>
          <div><small>State</small><b style={{ color: TONE[state] }}>{LEAD_WORD[state]}</b></div>
          <div><small>Sent out</small><b>{main?.dispatches?.length ?? 0}</b></div>
        </div>
        {problem ? <p className="ovd-mute">Could not read the transcript: {problem}</p>
          : !runs ? <p className="ovd-mute" role="status">Reading the transcript…</p>
          : !main ? <p className="ovd-mute">No transcript for this chat on this Mac.</p>
          : <div className="ovd-rc ovd-lead"><RunBody run={main} state={active ? 'active' : 'done'} lead onCopy={onCopy} onFocus={onFocus} /></div>}
      </> : <>
      <div className="ovd-stats">
        <div><small>Total time</small><b>{total > 0 ? clockDur(total) : '0s'}</b></div>
        <div><small>Runs</small><b>{n}</b></div>
        <div><small>State</small><b style={{ color: TONE[state] }}>{LABEL[team?.state ?? 'unused']}</b></div>
        <div><small>Time left</small><b>{left ?? (active ? 'estimating' : 'none')}</b></div>
      </div>
      <div>
        <h4 className="ovd-h4"><span>Runs</span><span>newest first</span></h4>
        {problem ? <p className="ovd-mute">Could not read the runs: {problem}</p>
          : !runs ? <p className="ovd-mute" role="status">Reading the transcripts…</p>
          : !runs.length ? <p className="ovd-mute">{n ? 'No transcript for these runs on this Mac.' : `${NAME(role)} has not run in this chat.`}</p>
          : <ul className="ovd-runs">
              {[...ordered].reverse().map((r, i) => {
                const k = ordered.indexOf(r) + 1, st = runState(r, p)
                const runLeft = st === 'active' && p ? leftWords(roleLeft({ ...p, running: [r.id] }, all, role, now)) : undefined
                return <Run key={r.id} run={r} n={k} state={st} left={runLeft && `${runLeft} left`} open={x[r.id] ?? i === 0} toggle={() => setX(o => ({ ...o, [r.id]: !(o[r.id] ?? i === 0) }))} onCopy={onCopy} onFocus={onFocus} />
              })}
            </ul>}
      </div>
      </>}
    </div>
  )

  return sheet
    ? <dialog ref={box as React.RefObject<HTMLDialogElement>} id="ov-drawer" className="ovd" data-sheet aria-labelledby="ovd-title"
        onCancel={e => { e.preventDefault(); onClose() }} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>{inside}</dialog>
    : <aside ref={box} id="ov-drawer" className="ovd" aria-labelledby="ovd-title">{inside}</aside>
}
