'use client'
import { useEffect, useRef, useState } from 'react'
import type { ChatProgress, ChatRow } from '@/lib/hub-types'
import type { HubCommand } from '@/lib/vscode-bridge'
import { chatShown } from '@/lib/chat-state'
import './worktree-merge.css'

/** The worktree folder name of a chat started in its own worktree, else undefined. */
export const worktreeOf = (cwd: string) => /\/\.claude\/worktrees\/([^/]+)/.exec(cwd)?.[1]

const askText = (base: string) => `Merge this worktree's changes into ${base}? They land as uncommitted changes, the repo's checks run first, and the worktree is removed. Nothing is committed or pushed.`
const WAIT = 'Merge back once the chat ends'

export const Branch = () => (
  <svg aria-hidden width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
    <circle cx="3" cy="2.5" r="1.5" /><circle cx="3" cy="9.5" r="1.5" /><circle cx="9" cy="4" r="1.5" /><path d="M3 4v4M9 5.5c0 2-6 1.5-6 2.5" />
  </svg>
)

/** Status on the chat's card: its worktree work is not in the main checkout yet. Not a control. */
export function WorktreeMark({ cwd }: { cwd: string }) {
  if (!worktreeOf(cwd)) return null
  return <span className="wt-mark"><Branch />Worktree, not merged</span>
}

/**
 * The band in the open chat: merge the worktree into the main checkout, with a confirm step.
 * Held while the chat still runs. base: the branch the main checkout is on; auto: it merges on its own (Ship's switch); files: changed files, when known; result: the Git op's answer for this chat.
 */
export function WorktreeMerge({ chat, progress, send, base = 'your branch', auto = true, files, result }: { chat: ChatRow; progress?: ChatProgress; send: (c: HubCommand) => void; base?: string; auto?: boolean; files?: number; result?: string }) {
  const [ask, setAsk] = useState(false)
  const [sent, setSent] = useState(false)
  const before = useRef<string | undefined>(undefined)
  const [late, setLate] = useState(false)
  // The answer only reaches the band when the Git card watches this chat; stop holding after 3 min.
  useEffect(() => { if (!sent) return; const t = setTimeout(() => setLate(true), 180_000); return () => clearTimeout(t) }, [sent])
  const btn = useRef<HTMLButtonElement>(null)
  const slug = worktreeOf(chat.cwd)
  if (!slug) return null
  const count = files ? ` ${files} changed ${files === 1 ? 'file' : 'files'}.` : ''
  const shown = chatShown(progress)
  // Waiting on Kenneth (the Approve question) is not running: the merge queues and runs once the chat ends.
  const running = chat.live && shown !== 'done' && shown !== 'idle' && shown !== 'needs'
  const approving = shown === 'needs' && [progress?.question, ...(progress?.ask?.questions ?? []).map(q => q.question)].includes('Approve this chat as finished?')
  // Approve queues the merge (approveChat), so no button here.
  if (approving) {
    return (
      <div className="wt" role="group" aria-label={`Worktree ${slug}`}>
        <span className="wt-name"><Branch />Worktree <code>{slug}</code></span>
        <span className="wt-note" role="status">{auto ? `Approve merges it into ${base} as uncommitted changes, after the repo checks pass.` : 'Auto merge is off for this repo, so Approve leaves it here. Merge it on Ship.'}{count}</span>
      </div>
    )
  }
  // Held from the send until the Git op answers; a kept worktree can be tried again.
  const answered = sent && result !== before.current
  const held = running || (sent && !answered && !late)
  const id = `wt-${chat.sessionId}`
  const close = () => { setAsk(false); requestAnimationFrame(() => btn.current?.focus()) }
  const note = running ? WAIT : answered ? result : late ? 'No answer yet; the Git card on Ship shows the result.' : sent ? 'Merging. The repo checks run first, this can take a minute.' : `Its changes are not in ${base} yet.${count}`
  return (
    <div className="wt" role="group" aria-label={`Worktree ${slug}`}>
      <span className="wt-name"><Branch />Worktree <code>{slug}</code></span>
      <span id={`${id}-note`} className={`wt-note${running || sent ? '' : ' plain'}`} role="status">{note}</span>
      {/* aria-disabled keeps it focusable, so the reason is read with it. */}
      <button ref={btn} type="button" className={`hub-btn sm${held ? '' : ' primary'}`} aria-disabled={held || undefined}
        aria-describedby={`${id}-note`} aria-expanded={ask} title={running ? WAIT : `Merge into ${base}, then remove the worktree`}
        onClick={() => { if (!held) setAsk(!ask) }}>Merge into {base}</button>
      {ask && <div role="alertdialog" aria-label="Merge back" aria-describedby={`${id}-ask`} className="wt-ask" onKeyDown={e => { if (e.key === 'Escape') close() }}>
        <p id={`${id}-ask`}>{askText(base)}</p>
        <span className="wt-acts">
          <button type="button" className="hub-btn sm primary" autoFocus onClick={() => { before.current = result; setLate(false); send({ type: 'hub-git', sessionId: chat.sessionId, op: 'merge-back', confirmed: true }); setSent(true); close() }}>Merge back</button>
          <button type="button" className="hub-btn sm" onClick={close}>Cancel</button>
        </span>
      </div>}
    </div>
  )
}
