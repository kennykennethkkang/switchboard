'use client'
import { Fragment, useState } from 'react'
import type { Changes } from '@/lib/hub-types'
import { caps, panel } from './look'
import { baseName } from '@/lib/path'
import { CopyCommit } from './chat-cards'
import { reviewNote } from '@/lib/diff-line'

const mono = { font: '400 12px/1.5 var(--hub-mono)' } as const
const Counts = ({ a, r }: { a: number; r: number }) => <span style={{ ...mono, whiteSpace: 'nowrap' }}><span style={{ color: 'var(--hub-green)' }}>+{a}</span> <span style={{ color: 'var(--hub-red)' }}>-{r}</span></span>
const TAG = { modified: '', added: 'new', deleted: 'deleted', untracked: 'new' } as const

/** The files a chat's folder has uncommitted, each with an inline diff, to review before committing. */
export function ChangesPanel({ changes, sessionId, cwd, commit, onCopy, onOpen, onNote, editor = 'VS Code' }: {
  editor?: string
  /** set on a chat's page: tapping a diff line opens a note box that sends the note to that chat */
  onNote?: (text: string) => void
  changes: Changes | null; sessionId: string; cwd: string; commit?: string; onCopy: (text: string) => Promise<boolean>; onOpen: (file: string) => void
}) {
  const [open, setOpen] = useState<string>()
  const [note, setNote] = useState<{ file: string; at: number; text: string }>()
  const [sent, setSent] = useState<string>()
  const mine = changes?.sessionId === sessionId ? changes : null
  const files = mine?.files ?? []
  const target = files.find(f => f.path === open) ?? files[0]
  return (
    <section aria-label="Changes" style={panel}>
      <h3 style={caps}>
        <span>Changes{mine ? ` · ${files.length} ${files.length === 1 ? 'file' : 'files'}` : ''}</span>
        {files.length > 0 && <Counts a={files.reduce((n, f) => n + f.added, 0)} r={files.reduce((n, f) => n + f.removed, 0)} />}
      </h3>
      {!mine && <p style={{ margin: 0, color: 'var(--hub-ash)', fontSize: 13 }}>Reading the changes in {baseName(cwd)}…</p>}
      {mine?.problem && <p role="alert" style={{ margin: 0, color: 'var(--hub-red)', fontSize: 13 }}>{mine.problem}</p>}
      {mine && !mine.problem && !files.length && <p style={{ margin: 0, color: 'var(--hub-ash)', fontSize: 13 }}>No uncommitted changes in {baseName(cwd)}.</p>}
      {files.length > 0 && <>
        <p style={{ margin: 0, color: 'var(--hub-ash)', fontSize: 12 }}>Uncommitted in {baseName(cwd)}: other chats in this folder may have made some of these.</p>
        <ul role="list" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
          {files.map(f => {
            const on = open === f.path
            return (
              <li key={f.path} style={{ border: '1px solid var(--hub-hair)', borderRadius: 6, overflow: 'hidden', minWidth: 0 }}>
                <button type="button" className="hub-link hub-fold" aria-expanded={on} onClick={() => setOpen(on ? undefined : f.path)}
                  style={{ display: 'flex', width: '100%', justifyContent: 'space-between', gap: 10, alignItems: 'center', padding: '8px 10px', borderRadius: 0, color: 'var(--hub-body)' }}>
                  <span style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
                    <b aria-hidden>›</b>
                    <span title={f.path} style={{ ...mono, display: 'flex', minWidth: 0, whiteSpace: 'nowrap' }}>
                      {f.path.includes('/') && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{f.path.slice(0, f.path.lastIndexOf('/') + 1)}</span>}
                      <span style={{ flex: 'none' }}>{f.path.slice(f.path.lastIndexOf('/') + 1)}</span>
                    </span>
                    {TAG[f.status] && <span className="hub-chip ver">{TAG[f.status]}</span>}
                  </span>
                  <Counts a={f.added} r={f.removed} />
                </button>
                {on && (f.diff
                  ? <div className="hub-diff" role="region" aria-label={`Diff of ${f.path}`}>
                      {f.diff.split('\n').map((l, i, rows) => {
                        const cls = l.startsWith('+') ? 'a' : l.startsWith('-') ? 'r' : l.startsWith('@@') ? 'h' : undefined
                        const can = !!onNote && !!reviewNote(f.path, rows, i, 'x')
                        const pick = () => { setSent(undefined); setNote({ file: f.path, at: i, text: '' }) }
                        const here = note?.file === f.path && note.at === i
                        const msg = here ? reviewNote(f.path, rows, i, note.text) : undefined
                        return <Fragment key={i}>
                          <div className={[cls, can && 'note'].filter(Boolean).join(' ') || undefined}
                            {...can && { role: 'button', tabIndex: 0, title: 'Add a review note on this line', 'aria-label': `Add a review note on line ${i + 1} of the diff`, onClick: pick, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick() } } }}>{l || ' '}</div>
                          {here && <form className="hub-diff-note" onSubmit={e => { e.preventDefault(); if (msg && onNote) { onNote(msg); setSent(msg); setNote(undefined) } }}>
                            <textarea autoFocus rows={2} aria-label="Review note" placeholder="What should the chat change here?" value={note.text}
                              onChange={e => setNote({ ...note, text: e.target.value })}
                              onKeyDown={e => { if (e.key === 'Escape') setNote(undefined); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit() }} />
                            <span>
                              <button type="submit" className="hub-btn sm primary" disabled={!msg}>Send to chat</button>
                              <button type="button" className="hub-btn sm" onClick={() => setNote(undefined)}>Cancel</button>
                            </span>
                          </form>}
                        </Fragment>
                      })}
                    </div>
                  : <p style={{ margin: 0, padding: '8px 10px', borderTop: '1px solid var(--hub-hair)', color: 'var(--hub-ash)', fontSize: 12 }}>{f.note ?? 'No text diff.'}</p>)}
              </li>
            )
          })}
        </ul>
      </>}
      {sent && <p role="status" style={{ margin: 0, color: 'var(--hub-ash)', fontSize: 12 }}>Sent to the chat: {sent}</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {commit && !(mine && !files.length) && <CopyCommit small text={commit} onCopy={onCopy} />}
        {target && <button type="button" className="hub-btn sm" onClick={() => onOpen(target.path)}
          title={`Opens ${target.path} against the last commit`}>Open in {editor} diff</button>}
      </div>
    </section>
  )
}
