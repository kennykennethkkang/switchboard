'use client'
import { useEffect, useState } from 'react'
import type { ChatProfile, HubState } from '@/lib/hub-types'
import type { HubCommand } from '@/lib/vscode-bridge'
import { caps } from './look'
import { ToolChips } from './tool-chips'
import { MAX_MESSAGE, withAttached, type Upload } from '@/lib/attach'
import { AttachButton, AttachChips, dropStyle, useAttach } from './attach'

export function NewChat({ hub, send, upload, onDone }: { hub: HubState; send: (c: HubCommand) => void; upload: Upload; onDone: () => void }) {
  // Focus goes back to whatever opened the dialog.
  const [was] = useState(() => typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null)
  useEffect(() => () => was?.focus(), [was])
  const open = hub.projects.find(p => p.isOpen) ?? hub.projects[0]
  const [path, setPath] = useState(open?.path ?? '')
  const [text, setText] = useState('')
  // Tools left closed: the extension picks at Start. Opened: its pick for this goal and folder, then Kenneth's toggles.
  const [toolsFor, setToolsFor] = useState('')
  const [edited, setEdited] = useState<ChatProfile>()
  const goal = text.trim()
  // Files go under the project picked when they were added; their paths are absolute, so a later switch still works.
  const files = useAttach(upload, path)
  const msg = withAttached(text, files.paths)
  const over = msg.length - MAX_MESSAGE
  const ready = !!msg && !!path && !files.busy && over <= 0
  const key = `${path}\n${goal}`
  const pick = hub.tools?.pick?.goal === goal && hub.tools.pick.folder === path ? hub.tools.pick.profile : undefined
  const tools = toolsFor === key ? edited ?? pick : undefined
  const askPick = () => {
    if (!goal || !path) return
    setToolsFor(key)
    setEdited(undefined)
    send({ type: 'hub-pick-tools', text: goal, path })
  }
  const start = () => {
    if (!ready) return
    send({ type: 'hub-new-chat', path, text: msg, remote: hub.rc.atStartup, ...(tools ? { tools } : {}) })
    setText('')
    files.clear()
    onDone()
  }
  return (
    <form onSubmit={e => { e.preventDefault(); start() }} {...files.drop} style={{ display: 'grid', gap: 10, padding: 16, border: '1px solid var(--hub-hair)', background: 'var(--hub-elev)', ...dropStyle(files.over), borderRadius: 10 }}>
      <label htmlFor="goal" style={{ fontWeight: 500, color: 'var(--hub-ink)' }}>What should this chat do?</label>
      <textarea id="goal" autoFocus rows={3} value={text} onChange={e => setText(e.target.value)} onPaste={files.onPaste}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); start() }
          else if (e.key === 'Escape') onDone()
        }} style={{ font: 'inherit', padding: 10, borderRadius: 8, resize: 'vertical', background: 'var(--hub-canvas)', color: 'var(--hub-ink)', border: '1px solid var(--hub-hair)' }} />
      <AttachChips items={files.items} onRemove={files.remove} />
      {(over > 0 || files.busy) && <p role="status" style={{ ...caps, textTransform: 'none', color: over > 0 ? 'var(--hub-red)' : undefined }}>{over > 0 ? `${over} characters over the ${MAX_MESSAGE} limit with the file paths` : 'Uploading, Start waits for it'}</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <label htmlFor="folder" style={{ color: 'var(--hub-mute)', fontSize: 13 }}>Project</label>
        <select id="folder" value={path} onChange={e => setPath(e.target.value)} style={{ font: 'inherit', padding: '7px 10px', borderRadius: 8, minWidth: 0, background: 'var(--hub-canvas)', color: 'var(--hub-ink)', border: '1px solid var(--hub-hair)' }}>
          {hub.projects.map(p => <option key={p.path} value={p.path}>{p.name}</option>)}
        </select>
        <button type="button" className="hub-btn" style={{ marginLeft: 'auto' }} disabled={!goal} onClick={askPick} title={goal ? 'Pick the plugins and skills for this goal' : 'Type a goal first'}>Pick tools</button>
        <AttachButton onFiles={files.add} />
        <button type="submit" className="hub-btn primary" disabled={!ready}>Start ⏎</button>
      </div>
      {toolsFor && (toolsFor !== key
        ? <p style={{ ...caps, textTransform: 'none' }}>Goal or folder changed. Press Pick tools again, or Start to let it pick.</p>
        : tools
          ? <ToolChips profile={tools} flagged={hub.tools?.flagged ?? []} onChange={setEdited} />
          : <p style={{ ...caps, textTransform: 'none' }}>Picking tools for this goal…</p>)}
    </form>
  )
}
