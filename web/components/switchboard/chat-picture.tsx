'use client'
import type { LinkChip } from '@/lib/wait-links'
import { readStore, writeStore } from '@/lib/store'
import { useEffect, useMemo, useReducer, useState, type ReactNode } from 'react'
import type { Ask, ChatProfile, Choice, DoneCheck, ChatProgress, ChatRow, Connection, Installed, Limit, RepoView, SessionLive, SmartRecord, StuckItem, TaskRow } from '@/lib/hub-types'
import { askChoice } from '@/lib/ask'
import { optionSmart, smartMarkText } from '@/lib/smart'
import { hookNotes, limitLine, testsPrompt } from '@/lib/checks'
import { eta, say, sayLeft, timeLeft, type Eta } from '@/lib/eta'
import { projectName } from '@/lib/archive'
import { INDEFINITE_LABEL, indefiniteHint, indefiniteOn } from '@/lib/indefinite'
import { ago, almostDone, coverage } from '@/lib/look'
import { OrbitView } from './orbits'
import { Switch } from './gear'
import { Check, CopyCommit, Receipt, chipOf, finishedLine, hhmm, plural, stillRunning } from './chat-cards'
import { ToolsCard } from './tools-card'
import { WorktreeMerge } from './worktree-merge'
import { CommitText } from './commit-text'
import { ChatBudget } from './chat-budget'
import { TestsCard } from './check-cards'
import { onMac } from './dev-rows'
import { vscodeBridge, type HubCommand } from '@/lib/vscode-bridge'
import { CheckStamp, Warn } from './approve'
import { chatShown } from '@/lib/chat-state'
import './centre.css'
import './smart-select.css'

const TOOLS_KEY = 'switchboard.toolCalls'
const clock = (at: number) => new Date(at).toTimeString().slice(0, 8)
const row = { display: 'flex', gap: 8, flexWrap: 'wrap' } as const
const field = { font: '400 13px/1.4 var(--hub-sans)', padding: '7px 10px', borderRadius: 8, minWidth: 0, background: 'var(--hub-canvas)', color: 'var(--hub-ink)', border: '1px solid var(--hub-hair)' } as const
/** "42 min", "1 h 25 min", "under a minute". */
const dur = (ms: number) => say(ms).replace(/^about /, '')
const cap = (s: string) => s.replace(/^./, c => c.toUpperCase())

/** "waiting on Fix login · auth.ts" from the chat's outgoing wait links; undefined when it holds for nobody. */
export const waitWord = (links: LinkChip[] = []) => {
  const out = links.filter(l => l.dir === 'out')
  return out.length ? `waiting on ${out.map(l => l.file ? `${l.name} · ${l.file}` : l.name).join(', ')}` : undefined
}

/** Tasks as a checkbox list, roles in ash; the head says time left or how long it ran. */
function Tasks({ p, e, now, models, since, links, running, timeleft }: { p?: ChatProgress; e?: Eta; now: number; models: Record<string, string>; since: string; links: LinkChip[]; running?: string; timeleft?: ReturnType<typeof timeLeft> }) {
  const tasks = p?.tasks ?? [], stopped = p?.state === 'idle', open = e ? e.total - e.done : 0
  const role = (t: TaskRow) => t.role ? `${t.role}${models[t.role] ? ` · ${models[t.role]}` : ''}` : ''
  const done = tasks.filter(t => t.status === 'completed')
  const hid = done.length > 5 ? done.length - 3 : 0
  const shown = tasks.filter(t => t.status !== 'completed' || done.indexOf(t) >= hid)
  const order = { completed: 0, in_progress: 1, pending: 2 }
  shown.sort((a, b) => order[a.status] - order[b.status])
  const subs = (p?.roles ?? []).filter(r => r.state === 'active' && p?.running?.includes(r.id))
  const out = links.filter(l => l.dir === 'out'), into = links.filter(l => l.dir === 'in')
  const right = !e ? '' : !open ? 'All done' : stopped ? `Stopped, ${open} left` : e.leftMs !== undefined ? `${cap(dur(e.leftMs))} left` : `Running ${dur(e.elapsedMs)}`
  return (
    <section className="cp-panel" aria-labelledby="cp-tasks-h">
      <h3 id="cp-tasks-h" className="cp-h"><span>Tasks</span>{right && <small role="status">{right}</small>}</h3>
      {tasks.length
        ? <ul className="cp-tasks" data-stopped={stopped || undefined} aria-label={e ? `${e.done} of ${e.total} done` : undefined}>
            {hid > 0 && <li className="cp-task cp-more">{hid} earlier tasks done</li>}
            {shown.map(t => <li key={t.id} className="cp-task" data-s={t.status} aria-current={t.id === e?.current?.id ? 'step' : undefined}>
              <span className="cp-box" aria-hidden>{t.status === 'completed' && <Check size={9} />}</span>
              <span>
                <span className="sr-only">{t.status === 'completed' ? 'done: ' : t.status === 'in_progress' ? 'now: ' : 'left: '}</span>{t.subject}
                {role(t) && <span className="cp-role"> · {role(t)}</span>}
                {t.status === 'in_progress' && t.startedAt !== undefined && <span className="cp-role"> · for {dur(now - t.startedAt)}</span>}
                {t.status === 'completed' && t.startedAt !== undefined && t.doneAt !== undefined && <span className="cp-role"> · {dur(t.doneAt - t.startedAt)}</span>}
              </span>
            </li>)}
          </ul>
        : <p className="cp-empty">No task list yet{stopped ? `. Quiet for ${since}.` : '.'}</p>}
      {e && open > 0 && !stopped && e.leftMs !== undefined && <p className="cp-empty">At {dur(e.perTaskMs!)} per task so far.</p>}
      {running && <div role="status" className="cp-run">
        <p>{running}{timeleft && timeleft !== 'estimating' && <span> · {sayLeft(timeleft)}</span>}</p>
        <ul>
          {subs.map(r => <li key={r.id}>{r.role} · since {hhmm(r.startedAt)}</li>)}
          {(p?.jobs ?? []).map(j => <li key={j.id}>{j.label ?? 'Background command'} · since {hhmm(j.startedAt)}</li>)}
        </ul>
      </div>}
      {(out.length > 0 || into.length > 0) && <p className="cp-foot">
        {out.length > 0 && <>Waits on {out.map(l => l.file ? `${l.name} (${l.file})` : l.name).join(', ')}</>}
        {out.length > 0 && into.length > 0 && '. '}
        {into.length > 0 && <>{into.map(l => l.name).join(', ')} {into.length > 1 ? 'wait' : 'waits'} on this</>}
      </p>}
    </section>
  )
}

/** The requests a finished chat missed, by Jev's check. */
function Missed({ p }: { p: ChatProgress }) {
  const items = (p.asked ?? []).filter((_, i) => coverage(p, i) === 'missed')
  if (!items.length) return null
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <span className="cp-label">Not covered</span>
      <ul className="cp-tasks">
        {items.map((t, i) => <li key={i} className="cp-task" data-s="pending"><span className="cp-box" aria-hidden /><span>{t}</span></li>)}
      </ul>
    </div>
  )
}

/** The terminal's prompt with its options as buttons; several questions, a multiSelect one or Other text are filled in first, then sent together. */
function AskButtons({ ask, onAnswer, block }: { ask: Ask; onAnswer: (askId: string, choice: Choice) => void; /** Why Approve is held (approveBlock); the Approve option is disabled with this reason. */ block?: string }) {
  const [picks, setPicks] = useState<Array<number | number[] | undefined>>([])
  const [others, setOthers] = useState<Record<number, string>>({})
  useEffect(() => { setPicks([]); setOthers({}) }, [ask.id])
  if (ask.kind === 'permission') return <>
    <p style={{ margin: 0, color: 'var(--hub-mute)', fontSize: 13 }}>{ask.tool}</p>
    {ask.preview && <code style={{ font: '400 12px/1.5 var(--hub-mono)', color: 'var(--hub-ink)', background: 'var(--hub-hair)', padding: '4px 8px', borderRadius: 6, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{ask.preview}</code>}
    <div style={row}>{ask.options.map((o, i) => <button key={i} type="button" className="hub-btn" onClick={() => onAnswer(ask.id, [i])}>{o}</button>)}</div>
  </>
  const qs = ask.questions ?? []
  const multi = qs.some(q => q.multiSelect)
  const together = qs.length > 1 || multi || Object.keys(others).length > 0
  const picked = (n: number) => [picks[n] ?? []].flat()
  const closeOther = (n: number) => { const rest = { ...others }; delete rest[n]; setOthers(rest) }
  const pick = (n: number, i: number) => {
    const next = [...picks]
    next[n] = qs[n].multiSelect ? (picked(n).includes(i) ? picked(n).filter(x => x !== i) : [...picked(n), i]) : i
    // A single-select question takes one answer, so an option closes its Other.
    if (!qs[n].multiSelect && n in others) closeOther(n)
    if (qs.length === 1 && !multi) onAnswer(ask.id, [i]); else setPicks(next)
  }
  const toggleOther = (n: number) => {
    if (n in others) return closeOther(n)
    setOthers({ ...others, [n]: '' })
    if (!qs[n].multiSelect) { const next = [...picks]; next[n] = undefined; setPicks(next) }
  }
  const choice = askChoice(qs, picks, others)
  const held = (o: string) => o === 'Approve' && !!block
  return <>
    {qs.map((q, n) => (
      <div key={n} role="group" aria-label={q.header ?? q.question} style={{ display: 'grid', gap: 6 }}>
        {qs.length > 1 && <p className="cp-subq">{q.header && <span className="cp-role">{q.header} · </span>}{q.question}</p>}
        {q.multiSelect && <span className="cp-hint">Pick any that apply</span>}
        <div style={row}>
          {q.options.map((o, i) => <button key={i} type="button" className="hub-btn hub-opt" aria-pressed={together ? picked(n).includes(i) : undefined} disabled={held(o)} onClick={() => pick(n, i)}>{o}{optionSmart(q, i) && <span className="ss-mark">{smartMarkText(optionSmart(q, i)!)}</span>}{q.details?.[i] ? <span className="hub-opt-d">{q.details[i]}</span> : null}</button>)}
          <button type="button" className="hub-btn hub-opt cp-other" aria-pressed={n in others} onClick={() => toggleOther(n)}>Other</button>
        </div>
        {n in others && <input type="text" autoFocus maxLength={200} style={field} aria-label={`Other answer for ${q.header ?? q.question}`} placeholder="Type your answer"
          value={others[n]} onChange={e => setOthers({ ...others, [n]: e.target.value })}
          onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229 && choice) onAnswer(ask.id, choice) }} />}
      </div>
    ))}
    {block && qs.some(q => q.options.includes('Approve')) && <p role="status" className="cp-hint" style={{ color: 'var(--hub-red)' }}>Approve is held: {block}.</p>}
    {together && <div><button type="button" className="hub-btn primary" disabled={!choice} onClick={() => choice && onAnswer(ask.id, choice)}>{qs.length > 1 ? 'Send answers' : 'Send answer'}</button></div>}
  </>
}

/** What a finished or stopped chat did and what is left, one line each. */
export const outcome = (p: ChatProgress) => {
  const done = p.report?.done.length ? p.report.done : p.tasks.filter(t => t.status === 'completed').map(t => t.subject)
  const open = p.tasks.filter(t => t.status !== 'completed').map(t => t.subject)
  const you = p.report?.you ?? [], left = p.report?.left ?? []
  const result = done.length ? `${done[0]}${done.length > 1 ? `, and ${done.length - 1} more` : ''}` : undefined
  const rest = you.length ? `Needs you: ${you.join('; ')}`
    : open.length ? `${plural(open.length, 'task')} left: ${open.join('; ')}`
    : left.length ? `${plural(left.length, 'item')} left, in the to-do`
    : 'Nothing left'
  return { result, rest, needs: you.length > 0 }
}

function Outcome({ p }: { p: ChatProgress }) {
  const o = outcome(p)
  return <div className="cp-out">
    <p>{o.result ?? 'Nothing finished yet'}</p>
    <p data-needs={o.needs || undefined}>{o.rest}</p>
  </div>
}

const NO_MODELS: Record<string, string> = {}

/** models: each role's model, for the orbit and the task list. */
/** profile: the chat's own plugins and skills, when Switchboard started it with a set; onProfile saves a change. */
/** limits and autoContinue: for the usage-limit note; onSend: queues a message to this chat. note: an extra mute line under the head (a pause). */
/** place: the VS Code window holding the chat. menu: Outputs and the more menu. message: the message box; given a function, it gets the Tools popover body. */
export function ChatPicture({ chat, progress, stuckItems, all = [], live, instant, demo, models = NO_MODELS, profile, flagged = [], smart, globalOff, limits = [], autoContinue = false, repo, place, menu, message, note, installed, connections, toolsOpen, onInstalled, onProfile, onIndefinite, onCommand, onFocus, onAnswer, onCopy, onSend, approve, block, check, links = [] }: {
  chat: ChatRow; progress?: ChatProgress; /** hub.stuck, for the stuck look. */ stuckItems?: StuckItem[]; /** Every chat's progress, the history behind the estimate. */ all?: ChatProgress[]; live?: SessionLive; instant?: boolean; models?: Record<string, string>; /** The browser demo: the node drawer shows sample runs. */ demo?: boolean
  profile?: ChatProfile; flagged?: string[]; smart?: SmartRecord; globalOff?: string[]; limits?: Limit[]; autoContinue?: boolean; onProfile?: (p: ChatProfile) => void; onIndefinite?: (on: boolean) => void; onCommand?: (c: HubCommand) => void; onFocus: () => void; onAnswer?: (askId: string, choice: Choice) => void; onCopy: (text: string) => Promise<boolean>; onSend?: (text: string) => void; /** The Approve bar, while it waits for approval. */ approve?: ReactNode; /** Why an Approve answer is held (approveBlock). */ block?: string; /** The done-check stamp under the closing question. */ check?: DoneCheck
  /** hub.repo: the Merge back band reads the main branch and changed-file count from it. */ repo?: RepoView | null
  place?: { name: string; color: string }; menu?: ReactNode; message?: ReactNode | ((tools: ReactNode) => ReactNode); note?: ReactNode; installed?: Installed[]; connections?: Connection[]; toolsOpen?: boolean; onInstalled?: () => void; /** Its wait links, for the Orbit arcs and the waiting word. */ links?: LinkChip[]
}) {
  const [showTools, setShowTools] = useState(true)
  useEffect(() => { if (readStore(TOOLS_KEY) === 'off') setShowTools(false) }, [])
  // Durations move with the clock, not only with hook events.
  const [, tick] = useReducer((n: number) => n + 1, 0)
  useEffect(() => { const t = setInterval(tick, 30e3); return () => clearInterval(t) }, [])
  // Off the Mac (phone, LAN) the button can only raise the terminal on the Mac. Read after mount so SSR matches.
  const [remote, setRemote] = useState(false)
  useEffect(() => setRemote(!vscodeBridge?.isVSCode && !onMac()), [])
  const toggle = (on: boolean) => { setShowTools(on); writeStore(TOOLS_KEY, on ? 'on' : 'off') }

  const state = progress?.state ?? 'idle', stuck = chatShown(progress, stuckItems) === 'stuck', s = chipOf(progress), name = chat.name ?? projectName(chat)
  const since = ago(progress?.at ?? chat.updatedAt ?? Date.now())
  // A held chat reads as waiting, never idle.
  const wait = state === 'done' || state === 'needs-you' ? undefined : waitWord(links)
  // The views redraw when this changes, so it changes only with what they show.
  const orbit = useMemo(() => ({ id: chat.sessionId, name, state, ...(stuck ? { stuck: true } : {}), ago: since, wait, progress, live, models }), [chat.sessionId, name, state, stuck, since, wait, progress, live, models])
  const tasks = progress?.tasks ?? [], now = Date.now(), e = progress && tasks.length ? eta(progress, now) : undefined
  const running = stillRunning(progress), timeleft = progress && timeLeft(progress, all, now)
  const feed = [...(progress?.tools ?? [])].reverse().slice(0, 6)
  const cost = [live?.costUsd !== undefined ? `$${live.costUsd.toFixed(2)}` : '', live?.tokens ? `${Math.round(live.tokens / 1000)}k tokens` : ''].filter(Boolean).join(' · ')
  const role = e?.current?.role
  const notes = [
    progress?.limited ? limitLine(limits, autoContinue) : '',
    ...(progress ? hookNotes(progress) : []),
  ].filter(Boolean)

  const first = state === 'needs-you'
    ? <section className="cp-card cp-ask" aria-labelledby="cp-q">
        <span className="cp-label">{progress?.limited ? 'Usage limit' : `${progress?.ask?.sub ? 'A subagent in ' : ''}${name} asks`}</span>
        <p id="cp-q" className="cp-q">{(progress?.ask?.questions?.length ?? 0) > 1 ? `${progress!.ask!.questions!.length} questions` : progress?.question ?? 'This chat is waiting on you.'}</p>
        <CheckStamp check={check} wrap />
        {progress?.ask && onAnswer && chat.ai !== 'codex' && <AskButtons ask={progress.ask} onAnswer={onAnswer} block={block} />}
        <div className="cp-alt"><button type="button" className={progress?.ask && onAnswer ? 'hub-btn sm' : 'hub-btn primary'} onClick={onFocus}>{remote ? 'Open terminal on Mac' : 'Answer in terminal'}</button></div>
      </section>
    : state === 'done' && progress
      ? <section className="cp-card" aria-label={s.label}>
          <p role="status" className="cp-done" style={{ color: almostDone(progress) ? 'var(--hub-yellow)' : s.color }}>
            {almostDone(progress)
              ? <span className="cp-warn"><Warn size={18} /></span>
              : <span className="cp-tick" style={{ background: s.color }}><Check size={11} /></span>}
            <span>{finishedLine(progress)}.</span>
            {progress.finishedAt && <span className="cp-role">{hhmm(progress.finishedAt)}</span>}
          </p>
          <Outcome p={progress} />
          {approve}
          {almostDone(progress) && <Missed p={progress} />}
          {progress.commit
            ? <div style={{ display: 'grid', gap: 8, justifyItems: 'start', minWidth: 0 }}>
                <div style={{ display: 'grid', width: '100%', minWidth: 0 }}><CommitText text={progress.commit} color={s.color} soft={s.soft} /></div>
                <CopyCommit text={progress.commit} onCopy={onCopy} />
              </div>
            : <p className="cp-empty">No commit message.</p>}
          <details className="cp-fold">
            <summary>What you asked and what was done</summary>
            <Receipt p={progress} />
          </details>
        </section>
      : state === 'idle' && !wait && progress
        ? <section className="cp-card" aria-label="Where it stopped">
            <span className="cp-label">Stopped, quiet for {since}</span>
            <Outcome p={progress} />
          </section>
        : null

  const tools = <>
    <div className="cp-pop-row">
      <Switch on={showTools} onChange={toggle} label="Tool calls on the Orbit picture" text="Tool calls" />
      <span className="cp-hint">Shows each tool call as a spark on the Orbit picture</span>
    </div>
    {/* Not the bare session id: the message box beside it is keyed by that. */}
    {chat.ai !== 'codex' && (
      <ToolsCard key={`tools-${chat.sessionId}`} profile={profile} flagged={flagged} smart={smart} globalOff={globalOff} installed={installed} connections={connections} open={toolsOpen} onProfile={onProfile} onInstalled={onInstalled} />
    )}
  </>

  return (
    <section aria-labelledby="pic-name" className="hub-pic cp">
      <div className="cp-head">
        <div style={{ minWidth: 0 }}>
          <h1 id="pic-name" className="cp-title">{name}</h1>
          <p className="cp-sub">
            <span><i aria-hidden className="cp-dot" style={{ background: wait ? 'var(--hub-mute)' : s.color }} />{wait ? cap(wait) : approve ? 'Ready for your OK' : s.label}</span>
            <span>
              {place && <span title={`In the ${place.name} window`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: place.color, marginRight: place.name === projectName(chat) ? 0 : 6 }}><i aria-hidden style={{ width: 8, height: 8, borderRadius: 2, background: 'currentColor' }} />{place.name}{place.name === projectName(chat) && <span className="sr-only"> window</span>}</span>}
              {place?.name === projectName(chat) ? '' : projectName(chat)}
            </span>
            {role && <span>{role}</span>}
            {e && <span>{e.done} of {e.total} tasks</span>}
            <span>{since}</span>
          </p>
        </div>
        <div className="hub-pic-acts cp-acts">
          {onIndefinite && <span className="cp-loop" title={indefiniteHint(profile, now, chat.budget ?? profile?.budget)}><Switch on={indefiniteOn(profile)} onChange={onIndefinite} label={INDEFINITE_LABEL} text={INDEFINITE_LABEL} /></span>}
          <button type="button" className="hub-btn" onClick={onFocus} title={remote ? 'Brings up its terminal on the Mac' : "Brings up this chat's terminal"}>{remote ? 'Terminal on Mac' : 'Terminal'}</button>
          {menu}
        </div>
      </div>
      {(notes.length > 0 || note) && <p className="cp-note">{notes.join(' · ')}{notes.length > 0 && note ? ' · ' : ''}{note}</p>}
      {onCommand && <WorktreeMerge key={`wt-${chat.sessionId}`} chat={chat} progress={progress} send={onCommand} base={repo?.sessionId === chat.sessionId ? repo.merge?.base : undefined} files={repo?.sessionId === chat.sessionId ? repo.merge?.files : undefined} result={repo?.sessionId === chat.sessionId ? repo.result?.text : undefined} />}
      {onCommand && <ChatBudget key={`budget-${chat.sessionId}`} chat={chat} send={onCommand} loop={indefiniteOn(profile)} />}
      {first}
      {progress?.tests && !progress.tests.ok && <TestsCard run={progress.tests} onSend={onSend && (() => onSend(testsPrompt(progress.tests!)))} />}
      <div className="cp-split">
        <section className="cp-panel cp-agents" aria-label="Agents">
          <OrbitView chat={orbit} showTools={showTools} instant={instant} all={all} demo={demo} links={links} onFocus={onFocus} onCopy={onCopy} />
          <details className="cp-fold">
            <summary>Recent tool calls{feed.length ? ` (${feed.length})` : ''}{cost && <span className="cp-role"> · {cost}</span>}</summary>
            {feed.length
              ? <ul className="hub-feed" aria-label="Latest tool calls, newest first" style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'grid', gap: 6, font: '400 12px/1.5 var(--hub-mono)' }}>
                  {feed.map(c => (
                    <li key={`${c.at}:${c.tool}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 64px) minmax(0, 80px) minmax(0, 1fr)', gap: 8, color: 'var(--hub-mute)', whiteSpace: 'nowrap' }}>
                      <span>{clock(c.at)}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.role}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--hub-body)' }}><span style={{ color: 'var(--hub-ink)' }}>{c.tool}</span>{c.target ? ` ${c.target}` : ''}</span>
                    </li>
                  ))}
                </ul>
              : <p className="cp-empty" style={{ marginTop: 8 }}>No tool calls yet.</p>}
          </details>
        </section>
        <Tasks p={progress} e={e} now={now} models={models} since={since} links={links} running={running} timeleft={timeleft} />
      </div>
      {typeof message === 'function' ? message(tools) : <>{message}<div className="cp-panel">{tools}</div></>}
    </section>
  )
}
