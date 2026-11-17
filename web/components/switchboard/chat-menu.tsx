'use client'
import { useEffect, useId, useRef, useState } from 'react'
import { useFlash } from '@/hooks/use-flash'
import type { ChatRow } from '@/lib/hub-types'
import type { HubCommand } from '@/lib/vscode-bridge'
import { projectName } from '@/lib/archive'

type Item = { label: string; done: string; cmd: HubCommand; hint: string; /** Two steps: the first press shows this. */ confirm?: string }
type Act = { label: string; hint: string; run: () => void }

/** A chat's extra actions behind a "more" button: star, hand off, hand to the other AI, compact, archive, open its terminal. Arrows move, Esc closes.
 *  inPicture: the chat page has its own Open terminal button, so the menu leaves it out. onRead: opens the chat view.
 *  targets, onWait: Wait for..., which swaps the menu for a pick of the other live chats in the project; a refused pick (problem) reopens it with the reason. */
export function ChatMenu({ chat, starred, send, onMac, inPicture, onRead, targets = [], onWait, problem }: { chat: ChatRow; starred: boolean; send: (c: HubCommand) => void; onMac?: boolean; inPicture?: boolean; onRead?: () => void; targets?: ChatRow[]; onWait?: (to: string) => void; problem?: { text: string; at: number; for?: HubCommand } | null }) {
  const [open, setOpen] = useState(false)
  const [said, setSaid] = useFlash('', 1800)
  const [armed, setArmed] = useState<string>()
  const [choosing, setChoosing] = useState(false)
  const [refused, setRefused] = useState('')
  const askedAt = useRef(0)
  useEffect(() => { if (!open) { setArmed(undefined); setChoosing(false); setRefused('') } }, [open])
  // The extension refuses a wait (target not running, itself, not taking messages): back to the pick, saying why.
  useEffect(() => {
    const f = problem?.for
    if (!problem || f?.type !== 'hub-wait-for' || f.from !== chat.sessionId || problem.at < askedAt.current) return
    setOpen(true); setChoosing(true); setRefused(problem.text.replace(/^[^:]*failed: /, ''))
  }, [problem, chat.sessionId])
  const id = useId()
  const wrap = useRef<HTMLSpanElement>(null), btn = useRef<HTMLButtonElement>(null)
  const sessionId = chat.sessionId
  const items: Item[] = [
    { label: starred ? 'Unstar' : 'Star', done: starred ? 'Unstarred' : 'Starred', hint: 'Starred chats stay easy to find and resume', cmd: { type: 'hub-star', sessionId, ai: chat.ai ?? 'claude', on: !starred } },
    { label: 'Hand off to a fresh chat', done: 'Handing off', hint: 'Writes a handoff note and carries on in a new chat with the next version number', cmd: { type: 'hub-handoff', sessionId }, confirm: 'Press again to hand off' },
    { label: chat.ai === 'codex' ? 'Hand to Claude' : 'Hand to Codex', done: 'Handing over', hint: `Starts a ${chat.ai === 'codex' ? 'Claude' : 'Codex'} chat in this project with the goal, last summary and files touched`, cmd: { type: 'hub-hand-to', sessionId }, confirm: 'Press again to hand over' } as Item,
    { label: 'Compact', done: 'Compact queued', hint: 'Asks this chat to compact its context', cmd: { type: 'hub-compact', sessionId }, confirm: 'Press again to compact' },
    { label: 'Archive', done: 'Archived', hint: 'Takes it off the list; Archive at the bottom brings it back', cmd: { type: 'hub-archive', sessionId }, confirm: 'Press again to archive' },
    ...inPicture ? [] : [{ label: 'Open terminal', done: onMac === false ? 'Opened on the Mac' : 'Opened', hint: onMac === false ? 'Brings up its terminal on the Mac' : 'Brings up its terminal', cmd: { type: 'hub-focus-chat', sessionId } } as Item],
  ]
  const acts: Act[] = onRead ? [{ label: 'Read outputs and transcript', hint: 'What this chat produced, and its transcript', run: onRead }] : []
  useEffect(() => {
    if (!open) return
    wrap.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    fitMenu(wrap.current)
    const down = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', down)
    return () => document.removeEventListener('pointerdown', down)
  }, [open, choosing])
  const key = (e: React.KeyboardEvent) => {
    const all = [...(wrap.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    const at = all.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); btn.current?.focus() }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); all[(at + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus() }
    else if (e.key === 'Tab') setOpen(false)
  }
  const name = chat.name ?? projectName(chat)
  return (
    <span ref={wrap} className="hub-more" data-open={open || undefined} onKeyDown={key}>
      <button ref={btn} type="button" className="hub-more-btn" aria-haspopup="menu" aria-expanded={open} aria-controls={id} aria-label={`More for ${name}`} title="More"
        onClick={() => setOpen(!open)}>
        <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><circle cx="3.5" cy="8" r="1.4" /><circle cx="8" cy="8" r="1.4" /><circle cx="12.5" cy="8" r="1.4" /></svg>
      </button>
      {open && (
        <span id={id} role="menu" aria-label={`Actions for ${name}`} className="hub-menu">
          {choosing ? <>
            <span className="hub-menu-h" aria-hidden>Wait for</span>
            {refused && <span role="alert" className="hub-menu-why">{refused}</span>}
            {targets.map(t => (
              <button key={t.sessionId} type="button" role="menuitem" tabIndex={-1} title={`${name} holds until ${t.name ?? projectName(t)} finishes`}
                onClick={() => { askedAt.current = Date.now(); onWait?.(t.sessionId); setSaid(`Waiting on ${t.name ?? projectName(t)}`); setOpen(false); btn.current?.focus() }}>{t.name ?? projectName(t)}</button>
            ))}
            <button type="button" role="menuitem" tabIndex={-1} className="hub-menu-back" onClick={() => setChoosing(false)}>Back</button>
          </> : <>
          {onWait && targets.length > 0 && <button type="button" role="menuitem" tabIndex={-1} aria-haspopup="menu" title="Hold this chat until another chat in the project finishes"
            onClick={() => setChoosing(true)}>Wait for...</button>}
          {acts.map(a => (
            <button key={a.label} type="button" role="menuitem" tabIndex={-1} title={a.hint}
              onClick={() => { setOpen(false); btn.current?.focus(); a.run() }}>{a.label}</button>
          ))}
          {items.map(it => (
            <button key={it.cmd.type} type="button" role="menuitem" tabIndex={-1} title={it.hint} data-armed={armed === it.cmd.type || undefined}
              onClick={() => {
                if (it.confirm && armed !== it.cmd.type) { setArmed(it.cmd.type); setSaid(it.confirm); return }
                send(it.cmd); setSaid(it.done); setOpen(false); btn.current?.focus()
              }}>{armed === it.cmd.type ? it.confirm : it.label}</button>
          ))}
          </>}
        </span>
      )}
      <span role="status" className="hub-more-said">{said}</span>
    </span>
  )
}

/** Keeps an open .hub-menu on screen: inside a 16px side gutter, and flipped up (or capped) when it would run under the bottom bars.
 * Measured unscaled, as the menu opens with a scale. */
export function fitMenu(wrap: HTMLElement | null) {
  const m = wrap?.querySelector<HTMLElement>('.hub-menu')
  if (!m || !wrap) return
  const r = wrap.getBoundingClientRect(), dx = Math.max(16 - (r.right - m.offsetWidth), Math.min(0, innerWidth - 16 - r.right))
  m.style.translate = dx ? `${dx}px 0` : ''
  const floor = Math.min(innerHeight, ...[...document.querySelectorAll('.nav, .sb')].map(e => e.getBoundingClientRect().top).filter(t => t > innerHeight / 2)) - 8
  if (r.bottom + 4 + m.offsetHeight <= floor) return
  if (r.top - 4 - m.offsetHeight >= 8) Object.assign(m.style, { top: 'auto', bottom: 'calc(100% + 4px)', transformOrigin: 'bottom right' })
  else Object.assign(m.style, { maxHeight: `${Math.max(88, floor - r.bottom - 4)}px`, overflowY: 'auto' })
}
