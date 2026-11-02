'use client'
import { useEffect, useRef, useState } from 'react'
import type { ChatRow } from '@/lib/hub-types'
import type { HubCommand } from '@/lib/vscode-bridge'
import { boxNote, sendFailure } from '@/lib/message-box'
import { MAX_MESSAGE as MAX, withAttached, type Upload } from '@/lib/attach'
import { AttachButton, AttachChips, dropStyle, useAttach, type Attached } from './attach'

/** Types a message into the shown chat as if Kenneth typed it there. Keyed by chat, so a switch starts empty. */
export function MessageBox({ chat, send, upload, problem }: { chat: ChatRow; send: (c: HubCommand) => void; upload: Upload; problem: { text: string; at: number; for?: HubCommand } | null }) {
  const [text, setText] = useState('')
  // raw and items: what was in the box, put back if the send fails.
  const [sent, setSent] = useState<{ text: string; at: number; raw: string; items: Attached[]; cmd: HubCommand }>()
  const files = useAttach(upload, chat.cwd, chat.sessionId)
  const note = boxNote(chat)
  const failed = sendFailure(sent?.cmd, problem)
  const restored = useRef(0)
  useEffect(() => {
    if (!failed || !sent || restored.current === sent.at) return
    restored.current = sent.at
    // Only into an empty box, so nothing typed since is lost.
    if (!text && !files.items.length) { setText(sent.raw); files.restore(sent.items) }
  }, [failed])
  // Touch keyboards have no Shift+Enter, so the key hint is for fine pointers only.
  const [touch, setTouch] = useState(false)
  useEffect(() => { setTouch(matchMedia('(pointer: coarse)').matches) }, [])
  const msg = withAttached(text, files.paths)
  const over = msg.length - MAX
  const go = () => {
    if (!msg || note || files.busy || over > 0) return
    const cmd: HubCommand = { type: 'hub-send', sessionId: chat.sessionId, text: msg }
    send(cmd)
    const n = files.paths.length
    setSent({ text: text.trim() || `${n} file${n === 1 ? '' : 's'}`, at: Date.now(), raw: text, items: files.items, cmd })
    setText('')
    files.clear()
  }
  const codex = chat.ai === 'codex'
  const hint = over > 0 ? `${over} characters over the ${MAX} limit with the file paths` : files.busy ? 'Uploading, Send waits for it' : undefined
  return (
    <form onSubmit={e => { e.preventDefault(); go() }} {...(note ? {} : files.drop)} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 8, padding: '0 20px 16px', ...dropStyle(files.over) }}>
      <label htmlFor="say" style={{ font: '500 13px/1 var(--hub-sans)', color: 'var(--hub-ink)' }}>Message this chat</label>
      {note
        ? <p role="status" style={{ margin: 0, fontSize: 13, color: 'var(--hub-ash)' }}>{note}</p>
        : <>
            <textarea id="say" rows={2} maxLength={MAX} value={text} onChange={e => setText(e.target.value)} onPaste={files.onPaste} placeholder={`Sent to ${codex ? 'Codex' : 'Claude'} as if you typed it`}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); go() } }}
              style={{ font: 'inherit', padding: 10, borderRadius: 8, resize: 'vertical', background: 'var(--hub-canvas)', color: 'var(--hub-ink)', border: '1px solid var(--hub-hair)' }} />
            <AttachChips items={files.items} onRemove={files.remove} />
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span role="status" style={{ minWidth: 0, flex: 1, fontSize: 13, color: failed || over > 0 ? 'var(--hub-red)' : 'var(--hub-ash)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {failed ?? hint ?? (sent ? `${codex ? 'Typed into its terminal' : 'Queued, picked up within seconds'}: ${sent.text}` : touch ? '' : 'Enter to send, Shift+Enter new line')}
              </span>
              <AttachButton onFiles={files.add} />
              <button type="submit" className="hub-btn primary" disabled={!msg || files.busy || over > 0}>Send ⏎</button>
            </div>
          </>}
    </form>
  )
}
