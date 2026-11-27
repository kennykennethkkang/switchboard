'use client'
// Simple view's Home: the first-run checklist as one line on top until it is done or hidden, then the ask box; three plain lanes under both.
// At 760px or less Needs you comes first, then the ask box and the checklist line, then Working and Done.
import { useState, type ReactNode } from 'react'
import type { ArchivedChat, HubState } from '@/lib/hub-types'
import type { HubCommand } from '@/lib/vscode-bridge'
import { laneRow } from '@/lib/now'
import { ago } from '@/lib/look'
import { guidedHome, readyChat } from '@/lib/simple-home'
import { Pick } from './gear'
import type { Card } from './chat-cards'
import './layout.css'
import './simple-home.css'

type FirstRun = NonNullable<HubState['firstRun']>
export type Step = Exclude<keyof FirstRun, 'dismissed'>
const STEPS: [Step, string, string][] = [
  ['github', 'Connect GitHub', 'Show how'],
  ['claude', 'Sign in to Claude', 'Sign in'],
  ['project', 'Pick a project folder', 'Choose'],
  ['chat', 'Start your first chat', 'Start'],
  ['approved', 'Approve a finished change', ''],
]
// What a ticked step was found from, so a tick nobody did by hand still makes sense.
const FOUND: Partial<Record<Step, string>> = { github: 'Found: the gh tool is signed in on this Mac' }

/** Shown while Coder view is unset: a small banner, neither option picked. */
export function ViewChoice({ onPick }: { onPick: (coder: boolean) => void }) {
  return (
    <section className="sh-choice" aria-labelledby="sh-choice-h">
      <div>
        <h2 id="sh-choice-h">How much should Switchboard show?</h2>
        <p>Simple is Home, Chats, Plan and Settings. Everything adds Live, Ship, Map and more. Change it any time in Settings.</p>
      </div>
      <div className="sh-choice-opts">
        <button type="button" className="hub-btn sm" onClick={() => onPick(false)}>Keep it simple</button>
        <button type="button" className="hub-btn sm" onClick={() => onPick(true)}>Show everything</button>
      </div>
    </section>
  )
}

/** compact: one line with the next step; full: every step with its button. All done reads as one line either way.
 *  ready: a chat waiting for its OK; the approve step opens it, and with none it says what it waits for. */
export function FirstRunCard({ run, onStep, onHide, compact, ready }: { run: FirstRun; onStep: (s: Step) => void; onHide: () => void; compact?: boolean; ready?: { name: string; open: () => void } }) {
  const [how, setHow] = useState(false)
  const done = STEPS.filter(([k]) => run[k]).length
  const next = STEPS.find(([k]) => !run[k])
  const act = (k: Step) => (k === 'github' ? setHow(h => !h) : k === 'approved' ? ready?.open() : onStep(k))
  const button = (k: Step, verb: string, main?: boolean) => k !== 'approved' ? <button type="button" className="hub-btn sm" data-next={main || undefined} onClick={() => act(k)}>{verb}</button>
    : ready ? <button type="button" className="hub-btn sm fr-ready" data-next={main || undefined} onClick={() => act(k)}>Review {ready.name}</button>
    : <span className="fr-wait">Waits for a chat to finish</span>
  const hint = how && <p className="fr-how">In Terminal, run <code>gh auth login</code> and follow the steps. This list ticks itself.</p>
  const head = (
    <div className="fr-head">
      <h2 id="fr-h">{next ? 'Get set up' : 'You are set up'}</h2>
      <span className="fr-n">{done} of {STEPS.length}</span>
      <span className="fr-bar" aria-hidden><b style={{ transform: `scaleX(${done / STEPS.length})` }} /></span>
      <button type="button" className="hub-btn sm fr-hide" onClick={onHide}>{next ? 'Hide' : 'Done'}</button>
    </div>
  )
  if (compact || !next) return (
    <section className="fr" data-compact aria-labelledby="fr-h">
      {head}
      {next && <p className="fr-next">Next: {next[1]} {button(next[0], next[2])}</p>}
      {hint}
    </section>
  )
  return (
    <section className="fr" aria-labelledby="fr-h">
      {head}
      <ol className="fr-steps">
        {STEPS.map(([k, text, verb]) => (
          <li key={k} data-done={run[k] || undefined}>
            <i aria-hidden>{run[k] && <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 5.2 4.1 7.2 8 3" /></svg>}</i>
            <span>{text}<span className="sr-only">{run[k] ? ', done' : ', to do'}</span>{run[k] && FOUND[k] && <small className="fr-found">{FOUND[k]}</small>}</span>
            {!run[k] && button(k, verb, k === next[0])}
          </li>
        ))}
      </ol>
      {hint}
    </section>
  )
}

/** Starts a chat in the picked project; with no project yet it sends you to pick one. */
function AskBox({ hub, send, onProject }: { hub: HubState; send: (c: HubCommand) => void; onProject: () => void }) {
  const here = hub.thisWindow ?? hub.lastWindow
  const [path, setPath] = useState('')
  const [text, setText] = useState('')
  const at = hub.projects.some(p => p.path === path) ? path : hub.projects.find(p => p.path === here)?.path ?? hub.projects[0]?.path ?? ''
  const start = () => { const t = text.trim(); if (!t || !at) return; send({ type: 'hub-new-chat', path: at, text: t, remote: false }); setText('') }
  return (
    <form className="sh-ask" onSubmit={e => { e.preventDefault(); start() }}>
      <label htmlFor="sh-ask">What should we work on?</label>
      <textarea id="sh-ask" rows={3} value={text} onChange={e => setText(e.target.value)} placeholder="Describe the task in a sentence, like: the login page breaks on phones"
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); start() } }} />
      <div className="sh-ask-row">
        {hub.projects.length
          ? <Pick label="Project" value={at} onChange={setPath} options={hub.projects.map(p => [p.path, p.name])} />
          : <button type="button" className="hub-btn" onClick={onProject}>Pick a project folder first</button>}
        <button type="submit" className="hub-btn primary" disabled={!text.trim() || !at}>Start chat</button>
      </div>
    </form>
  )
}

/** hint: one line under the head saying what lands in the lane. */
function Lane({ id, tone, title, hint, count, empty, children }: { id: string; tone: 'red' | 'blue' | 'green'; title: string; hint: string; count: number; empty: string; children?: ReactNode }) {
  return (
    <section className="now-lane" aria-labelledby={id} aria-describedby={`${id}-hint`}>
      <h2 id={id} className="now-lane-head"><span className="now-badge" data-tone={tone}><i aria-hidden />{title}</span><span className="now-count">{count}</span></h2>
      <p id={`${id}-hint`} className="sh-hint">{hint}</p>
      {count ? children : <p className="now-empty">{empty}</p>}
    </section>
  )
}

/** needs: the shell's Needs you strip as-is. tint: a folder's project color. asking: New chat is open above, so the ask box steps aside. */
export function SimpleHome({ hub, send, run, onStep, onHide, onProject, asking, needs, needsCount, working, done, onOpen, onDone, tint, now = Date.now() }: {
  hub: HubState; send: (c: HubCommand) => void; run?: FirstRun; onStep: (s: Step) => void; onHide: () => void; onProject: () => void; asking?: boolean
  needs: ReactNode; needsCount: number; working: Card[]; done: ArchivedChat[]; onOpen: (id: string) => void; onDone: (a: ArchivedChat) => void; tint: (cwd: string) => string | undefined; now?: number
}) {
  const guided = guidedHome(run)
  const ready = readyChat(hub)
  const card = run && !run.dismissed && <FirstRunCard run={run} onStep={onStep} onHide={onHide} compact ready={ready && { name: ready.name, open: () => onOpen(ready.id) }} />
  return (
    <div className="sh-home">
      {guided && card}
      {!asking && <AskBox hub={hub} send={send} onProject={onProject} />}
      {!guided && card}
      <div className="now-lanes">
        <Lane id="sh-needs" tone="red" title="Needs you" hint="A question to answer, or finished work to check." count={needsCount} empty="Nothing needs you. Questions and finished work show up here.">{needs}</Lane>
        <Lane id="sh-working" tone="blue" title="Working" hint="Busy on their own. Nothing to do yet." count={working.length} empty="No chat is working. Describe a task above to start one.">
          <ul className="now-rows">{working.map(c => { const r = laneRow(c); return (
            <li key={r.id}><button type="button" className="now-row" onClick={() => onOpen(r.id)} title={`Open ${r.name}`}>
              <strong>{r.name}</strong>
              <span className="now-meta"><i aria-hidden style={{ background: tint(c.chat.cwd) ?? 'var(--hub-mute)' }} />{r.total ? `${r.done} of ${r.total} steps` : r.project}
                {r.total > 0 && <span className="now-bar" aria-hidden><b style={{ transform: `scaleX(${r.done / r.total})` }} /></span>}</span>
            </button></li>) })}</ul>
        </Lane>
        <Lane id="sh-done" tone="green" title="Done today" hint="Approved today." count={done.length} empty="Nothing approved yet today.">
          <ul className="now-rows">{done.map(a => { const when = ago(a.approvedAt!, now); return (
            <li key={a.sessionId}><button type="button" className="now-row" onClick={() => onDone(a)} title={`Show ${a.name} in Chats`}>
              <strong>{a.name}</strong>
              <span className="now-meta"><i aria-hidden style={{ background: tint(a.cwd) ?? 'var(--hub-mute)' }} />{when === 'now' ? 'approved just now' : `approved ${when} ago`}</span>
            </button></li>) })}</ul>
        </Lane>
      </div>
    </div>
  )
}
