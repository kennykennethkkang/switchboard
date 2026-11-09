'use client'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ChatRow } from '@/lib/hub-types'
import type { HubCommand } from '@/lib/vscode-bridge'
import { boxNote, sendFailure, withKeywords, type Keywords } from '@/lib/message-box'
import { MAX_MESSAGE as MAX, withAttached, type Upload } from '@/lib/attach'
import { AttachButton, AttachChips, dropStyle, useAttach, type Attached } from './attach'
import { chip } from './tool-chips'
import { useDraft } from '@/hooks/use-draft'
import { useDismiss } from './use-popover'

const OFF: Keywords = { ultrathink: false, ultracode: false }
// Both only append the word to this one send; withKeywords in lib/message-box.
const KW = {
  ultrathink: { label: 'Ultrathink', hint: 'Adds ultrathink to this message, so Claude thinks longer before answering' },
  ultracode: { label: 'Ultracode', hint: 'Adds ultracode to this message, so Claude runs it as a multi-agent workflow' },
} as const

/** The Tools button in the message row and its popover: this send's keywords, then the chat's tools (from ChatPicture). */
function ToolsPop({ kw, setKw, codex, children }: { kw: Keywords; setKw: (k: Keywords) => void; codex: boolean; children?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLSpanElement>(null), btn = useRef<HTMLButtonElement>(null)
  useDismiss(open, wrap, () => { setOpen(false); if (wrap.current?.contains(document.activeElement)) btn.current?.focus() })
  const on = (Object.keys(KW) as Array<keyof Keywords>).filter(k => kw[k])
  return (
    <span ref={wrap} className="cp-tools">
      <button ref={btn} type="button" className="hub-btn" aria-expanded={open} aria-controls="cp-pop" onClick={() => setOpen(!open)}>
        Tools{on.length > 0 && <span className="cp-role">: {on.map(k => KW[k].label).join(', ')}</span>}
      </button>
      {open && (
        // Enter in the popover's search must not send the message.
        <div id="cp-pop" role="group" aria-label="Tools" className="cp-pop" onKeyDown={e => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') e.preventDefault() }}>
          {!codex && <div className="cp-kw" role="group" aria-label="For this message only">
            <span className="cp-label" style={{ gridColumn: '1 / -1' }}>For this message only</span>
            {(Object.keys(KW) as Array<keyof Keywords>).map(k => <div key={k} style={{ display: 'contents' }}>
              <button type="button" aria-pressed={kw[k]} aria-describedby={`cp-kw-${k}`} style={chip(kw[k])} onClick={() => setKw({ ...kw, [k]: !kw[k] })}>{KW[k].label}</button>
              <span id={`cp-kw-${k}`} className="cp-hint">{KW[k].hint}</span>
            </div>)}
          </div>}
          {children}
        </div>
      )}
    </span>
  )
}

/** Types a message into the shown chat as if typed there. Keyed by chat, so each chat keeps its own unsent text. */
/** tools: the chat's Tools popover body, from ChatPicture. */
export function MessageBox({ chat, send, upload, problem, tools }: { chat: ChatRow; send: (c: HubCommand) => void; upload: Upload; problem: { text: string; at: number; for?: HubCommand } | null; tools?: ReactNode }) {
  // Saved as typed, so a refresh, switch or reload keeps it; dropped on send, put back from memory if it fails.
  const [text, setText, clearText, restoredDraft] = useDraft(`msg:${chat.sessionId}`)
  const [kept, setKept] = useState(false)
  // Claude's prompt keywords, for the next send only.
  const [kw, setKw] = useState(OFF)
  // raw and items: what was in the box, put back if the send fails.
  const [sent, setSent] = useState<{ text: string; at: number; raw: string; items: Attached[]; kw: typeof OFF; cmd: HubCommand }>()
  const files = useAttach(upload, chat.cwd, chat.sessionId)
  const note = boxNote(chat)
  const failed = sendFailure(sent?.cmd, problem)
  const restored = useRef(0)
  useEffect(() => {
    if (!failed || !sent || restored.current === sent.at) return
    restored.current = sent.at
    // Only into an empty box, so nothing typed since is lost.
    if (!text && !files.items.length) { setText(sent.raw); files.restore(sent.items); setKw(sent.kw); setKept(true) }
  }, [failed])
  // Touch keyboards have no Shift+Enter, so the key hint is for fine pointers only.
  const [touch, setTouch] = useState(false)
  useEffect(() => { setTouch(matchMedia('(pointer: coarse)').matches) }, [])
  const codex = chat.ai === 'codex'
  const msg = codex ? withAttached(text, files.paths) : withKeywords(withAttached(text, files.paths), kw)
  const over = msg.length - MAX
  const go = () => {
    if (!msg || note || files.busy || over > 0) return
    const cmd: HubCommand = { type: 'hub-send', sessionId: chat.sessionId, text: msg }
    send(cmd)
    const n = files.paths.length
    setSent({ text: text.trim() || `${n} file${n === 1 ? '' : 's'}`, at: Date.now(), raw: text, items: files.items, kw, cmd })
    clearText()
    setKept(false)
    setKw(OFF)
    files.clear()
  }
  const hint = over > 0 ? `${over} characters over the ${MAX} limit with the file paths` : files.busy ? 'Uploading, Send waits for it' : undefined
  return (
    <form onSubmit={e => { e.preventDefault(); go() }} {...(note ? {} : files.drop)} className="cp-msg" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 8, padding: '0 20px 16px', ...dropStyle(files.over) }}>
      <label htmlFor="say" className="sr-only">Message this chat</label>
      {note
        ? <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <p role="status" style={{ margin: 0, flex: 1, minWidth: 0, fontSize: 13, color: 'var(--hub-ash)' }}>{note}</p>
            <ToolsPop kw={kw} setKw={setKw} codex>{tools}</ToolsPop>
          </div>
        : <>
            <textarea id="say" aria-label={`Message to ${codex ? 'Codex' : 'Claude'}`} rows={2} maxLength={MAX} value={text} onChange={e => setText(e.target.value)} onPaste={files.onPaste} placeholder={`Message this chat. Sent to ${codex ? 'Codex' : 'Claude'} as if you typed it`}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); go() } }}
              className="cp-say" />
            <AttachChips items={files.items} onRemove={files.remove} />
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span role="status" style={{ minWidth: 0, flex: 1, fontSize: 13, color: failed || over > 0 ? 'var(--hub-red)' : 'var(--hub-ash)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {(failed ? (kept ? `Not sent, your text is kept: ${failed}` : failed) : undefined) ?? hint ?? (restoredDraft ? 'Draft restored' : undefined) ?? (sent ? `${codex ? 'Typed into its terminal' : 'Queued, picked up within seconds'}: ${sent.text}` : touch ? '' : 'Enter to send, Shift+Enter new line')}
              </span>
              <ToolsPop kw={kw} setKw={setKw} codex={codex}>{tools}</ToolsPop>
              <AttachButton onFiles={files.add} />
              <button type="submit" className="hub-btn primary" disabled={!msg || files.busy || over > 0}>Send ⏎</button>
            </div>
          </>}
    </form>
  )
}
