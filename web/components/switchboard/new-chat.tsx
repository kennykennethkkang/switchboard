'use client'
import { useDialog } from '@/hooks/use-dialog'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AiId, ChatProfile, ChatRow, HubState } from '@/lib/hub-types'
import type { HubCommand } from '@/lib/vscode-bridge'
import { caps } from './look'
import { ToolChips } from './tool-chips'
import { MAX_MESSAGE, withAttached, type Upload } from '@/lib/attach'
import { AttachButton, AttachChips, dropStyle, useAttach } from './attach'
import { useDraft } from '@/hooks/use-draft'
import { CLONE_REPO, NEW_REPO, repoAsk } from '@/lib/new-repo'
import { startTargets, startsAfter, toggleId } from '@/lib/start-wait'
import { WaitOnChips } from './start-wait'
import { looksMulti, mergeBack, newGroupId } from '@/lib/split-plan'
import { freshRun } from '@/lib/budget-ui'
import { relatedChat } from '@/lib/related-chat'
import { ModelEffort } from './model-effort'
import { fiveHourUse, runFields, startPicks, type RunPicks } from '@/lib/model-effort'

/** Asks the editor to split one message into separate asks; resolves [text] on failure. */
export type SplitAsks = (path: string, text: string) => Promise<string[]>

// Settles 400ms after typing stops, so the match does not flicker per key.
function useRelated(text: string, chats: ChatRow[], project: string, texts: Record<string, string>) {
  const [hit, setHit] = useState<ReturnType<typeof relatedChat>>()
  useEffect(() => {
    const t = setTimeout(() => setHit(text.trim() ? relatedChat(text, chats, project, texts) : undefined), 400)
    return () => clearTimeout(t)
  }, [text, chats, project, texts])
  return hit
}

function Related({ text, chats, project, texts, onSend }: { text: string; chats: ChatRow[]; project: string; texts: Record<string, string>; onSend: (sessionId: string) => void }) {
  const hit = useRelated(text, chats, project, texts)
  if (!hit) return null
  return <p className="hub-related"><span>Related: <b>{hit.name}</b></span>
    <button type="button" className="hub-btn" onClick={() => onSend(hit.sessionId)} title={`Send this to ${hit.name} instead of starting a new chat`}>Send there</button></p>
}

/** simple: Simple view, without Wait on, Pipeline, Own worktree and Tools (a busy project still gets its own worktree). */
export function NewChat({ hub, send, upload, split, simple, onDone }: { hub: HubState; send: (c: HubCommand) => void; upload: Upload; split?: SplitAsks; simple?: boolean; onDone: () => void }) {
  useDialog()
  // autoFocus loses to the click that opened the panel, so focus once it has settled.
  const goalRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { const t = setTimeout(() => goalRef.current?.focus(), 0); return () => clearTimeout(t) }, [])
  const open = hub.projects.find(p => p.isOpen) ?? hub.projects[0]
  const [path, setPath] = useState(open?.path ?? '')
  // Research: starts in ~/Documents/Research with the research note; path stays a listed project for the extension.
  const [research, setResearch] = useState(false)
  // New GitHub repo or Clone: the folder is made on Start, so Tools waits and files go under the open project.
  const making = path === NEW_REPO || path === CLONE_REPO
  const toResearch = (on: boolean) => { setResearch(on); if (on && making) setPath(open?.path ?? '') }
  const [repoInput, setRepoInput] = useState('')
  const [priv, setPriv] = useState(true)
  const repo = repoAsk(path, repoInput, priv)
  // Kept across a closed dialog, reload or killed tab; dropped on Start.
  const [text, setText, clearText, restored] = useDraft('newchat')
  // Claude unless another installed AI is picked; the picker only shows when there is one.
  const [ai, setAi] = useState<AiId>('claude')
  const [picks, setPicks] = useState<RunPicks>(() => startPicks(hub))
  // Advanced projects with saved pipelines get a picker; '' starts a plain chat.
  const advanced = !research && !simple && hub.controls.switchboard.advancedMode?.[path] === true
  const [pipe, setPipe] = useState('')
  useEffect(() => { if (advanced) send({ type: 'hub-pipelines' }) }, [advanced]) // eslint-disable-line react-hooks/exhaustive-deps
  const pipes = advanced ? hub.pipelines ?? [] : []
  const slug = pipes.some(p => p.slug === pipe) ? pipe : ''
  const others = (hub.ais ?? []).filter(a => a.installed && a.id !== 'claude')
  // Tools left closed: everything on at Start. Opened: the folder's all-on set, then Kenneth's toggles, kept while the goal is edited.
  const [toolsFor, setToolsFor] = useState('')
  const [edited, setEdited] = useState<ChatProfile>()
  const goal = text.trim()
  const project = making ? '' : hub.projects.find(p => p.path === path)?.name ?? ''
  // What each chat is on, for the related match: its running task, else its first.
  const texts = useMemo(() => Object.fromEntries(hub.progress.map(p => [p.sessionId, (p.tasks.find(t => t.status === 'in_progress') ?? p.tasks[0])?.subject ?? ''])), [hub.progress])
  const targets = startTargets(hub.chats, project, ai)
  const [picked, setPicked] = useState<string[]>([])
  // A second Claude chat in a busy project gets its own git worktree unless unticked.
  const [own, setOwn] = useState(true)
  const busyProject = !making && !research && ai === 'claude' && targets.length > 0
  const waitOn = picked.filter(id => targets.some(c => c.sessionId === id))
  const after = startsAfter(waitOn.map(id => targets.find(c => c.sessionId === id)?.name || id.slice(0, 8)))
  const waitProps = { targets, progress: hub.progress, project, picked: waitOn, onToggle: (id: string) => setPicked(p => toggleId(p, id)) }
  // Files go under the project picked when they were added; their paths are absolute, so a later switch still works.
  const files = useAttach(upload, making ? open?.path ?? '' : path)
  const msg = withAttached(text, files.paths)
  const over = msg.length - MAX_MESSAGE
  const ready = !!msg && !!path && (!making || !!repo) && !files.busy && over <= 0
  const pick = hub.tools?.pick?.folder === path ? hub.tools.pick.profile : undefined
  const tools = toolsFor === path && !research ? edited ?? pick : undefined
  const askPick = () => {
    if (!path || making) return
    setToolsFor(path)
    setEdited(undefined)
    send({ type: 'hub-pick-tools', text: goal, path })
  }
  // Split preview: undefined while editing, [] while the editor checks, else one card per ask.
  const [asks, setAsks] = useState<string[]>()
  const req = useRef(0)
  const splitGot = useRef<string[]>([])
  const startOne = (text: string, group?: string) => {
    // Seeded first: the extension adds the run to this chat's first prompt.
    if (slug && !group) send({ type: 'hub-pipeline-seed', slug, path, run: freshRun(slug) })
    send({ type: 'hub-new-chat', path: repo ? '' : path, text, ...(repo ? { repo } : {}), remote: hub.rc.atStartup, ...(ai !== 'claude' ? { ai } : tools ? { tools } : {}), ...(waitOn.length ? { waitOn } : {}), ...(group ? { group } : {}), ...(busyProject && own ? { worktree: true } : {}), ...runFields(picks, ai), ...(research ? { research: true } : {}) })
  }
  const finish = () => { clearText(); files.clear(); onDone() }
  const start = () => {
    if (!ready || asks) return
    if (!split || making || !looksMulti(goal)) { startOne(msg); finish(); return }
    const n = ++req.current
    setAsks([])
    split(path, text).then(got => {
      if (n !== req.current) return
      const parts = got.map(a => a.trim()).filter(Boolean)
      if (parts.length >= 2) { splitGot.current = parts; setAsks(parts) }
      else { setAsks(undefined); startOne(msg); finish() }
    }, () => { if (n === req.current) { setAsks(undefined); startOne(msg); finish() } })
  }
  // Edited asks go back into the box, so Escape or Merge back never drops them.
  const merge = () => { req.current++; if (asks?.length) setText(mergeBack(text, splitGot.current, asks)); setAsks(undefined) }
  const startAll = () => {
    const each = (asks ?? []).map(a => a.trim()).filter(Boolean)
    if (!each.length) return
    const group = each.length > 1 ? newGroupId() : undefined
    for (const a of each) startOne(withAttached(a, files.paths), group)
    finish()
  }
  const sendTo = (sessionId: string, text: string) => { send({ type: 'hub-send', sessionId, text }); finish() }
  if (asks) return (
    <form onSubmit={e => { e.preventDefault(); startAll() }} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); merge() } }} className="hub-split" style={{ padding: 16, border: '1px solid var(--hub-hair)', background: 'var(--hub-elev)', borderRadius: 10 }}>
      {!asks.length
        ? <p role="status" className="hub-checking"><i aria-hidden />Checking for separate asks</p>
        : <>
          <p role="status" className="hub-split-head">{asks.length} separate asks. <span>Each gets its own chat.</span></p>
          <ul className="hub-split-list">{asks.map((a, i) => <li key={i} className="hub-split-card">
            <textarea aria-label={`Ask ${i + 1}`} autoFocus={i === 0} rows={2} value={a} onChange={e => setAsks(asks.map((x, j) => j === i ? e.target.value : x))} />
            <button type="button" className="hub-btn icon hub-split-x" aria-label={`Remove ask ${i + 1}`} disabled={asks.length < 2} onClick={() => setAsks(asks.filter((_, j) => j !== i))}>
              <svg aria-hidden width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M3 3l8 8M11 3l-8 8" /></svg>
            </button>
            <Related text={a} chats={hub.chats} project={project} texts={texts} onSend={id => {
              // One ask goes to the related chat; the rest stay in the preview.
              send({ type: 'hub-send', sessionId: id, text: withAttached(a, files.paths) })
              const rest = asks.filter((_, j) => j !== i)
              if (rest.length) setAsks(rest); else finish()
            }} />
          </li>)}</ul>
          {after && <p className="hub-waiton-after"><i aria-hidden />{after}</p>}
        </>}
      <div className="hub-split-acts">
        <button type="button" className="hub-btn" onClick={merge}>{asks.length ? 'Merge back' : 'Cancel'}</button>
        {asks.length > 0 && <button type="button" className="hub-btn" onClick={() => { startOne(withAttached(mergeBack(text, splitGot.current, asks), files.paths)); finish() }}>Start as one</button>}
        {asks.length > 0 && <button type="submit" className="hub-btn primary">{asks.length > 1 ? 'Start all' : 'Start'}</button>}
      </div>
    </form>
  )
  return (
    <form onSubmit={e => { e.preventDefault(); start() }} onKeyDown={e => { if (e.key === 'Escape') onDone() }} {...files.drop} style={{ display: 'grid', gap: 10, padding: 16, border: '1px solid var(--hub-hair)', background: 'var(--hub-elev)', ...dropStyle(files.over), borderRadius: 10 }}>
      <label htmlFor="goal" style={{ fontWeight: 500, color: 'var(--hub-ink)' }}>What should this chat do?</label>
      <textarea id="goal" ref={goalRef} autoFocus rows={3} value={text} onChange={e => setText(e.target.value)} onPaste={files.onPaste}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); start() }
        }} style={{ font: 'inherit', padding: 10, borderRadius: 8, resize: 'vertical', background: 'var(--hub-canvas)', color: 'var(--hub-ink)', border: '1px solid var(--hub-hair)' }} />
      <AttachChips items={files.items} onRemove={files.remove} />
      {!making && goal && <Related text={text} chats={hub.chats} project={project} texts={texts} onSend={id => sendTo(id, msg)} />}
      {restored && over <= 0 && !files.busy && <p role="status" style={{ ...caps, textTransform: 'none' }}>Draft restored</p>}
      {(over > 0 || files.busy) && <p role="status" style={{ ...caps, textTransform: 'none', color: over > 0 ? 'var(--hub-red)' : undefined }}>{over > 0 ? `${over} characters over the ${MAX_MESSAGE} limit with the file paths` : 'Uploading, Start waits for it'}</p>}
      <div className="nc-foot" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <button type="button" role="switch" className="hub-switch" aria-checked={research} onClick={() => toResearch(!research)}
          title="Starts in the Research space (~/Documents/Research) for questions, not code. Skips worktrees, pipelines and the finishing steps."><span aria-hidden />Research</button>
        {research
          ? <span style={{ color: 'var(--hub-mute)', fontSize: 13 }}>Folder: <b style={{ color: 'var(--hub-ink)', fontWeight: 500 }}>Research space</b></span>
          : <span style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
        <label htmlFor="folder" style={{ color: 'var(--hub-mute)', fontSize: 13 }}>Project</label>
        <select id="folder" value={path} onChange={e => setPath(e.target.value)} style={{ font: 'inherit', padding: '7px 10px', borderRadius: 8, minWidth: 0, background: 'var(--hub-canvas)', color: 'var(--hub-ink)', border: '1px solid var(--hub-hair)' }}>
          {hub.projects.map(p => <option key={p.path} value={p.path}>{p.name}</option>)}
          <option disabled>──────────</option>
          <option value={NEW_REPO}>New GitHub repo…</option>
          <option value={CLONE_REPO}>Clone from GitHub…</option>
        </select>
        </span>}
        {others.length > 0 && <span style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
          <label htmlFor="ai" style={{ color: 'var(--hub-mute)', fontSize: 13 }}>AI</label>
          <select id="ai" value={ai} onChange={e => setAi(e.target.value as AiId)} style={{ font: 'inherit', padding: '7px 10px', borderRadius: 8, minWidth: 0, background: 'var(--hub-canvas)', color: 'var(--hub-ink)', border: '1px solid var(--hub-hair)' }}>
            <option value="claude">Claude</option>
            {others.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </span>}
        <ModelEffort ai={ai} value={picks} onChange={setPicks} usage={fiveHourUse(hub, ai)} task={goal} />
        <AttachButton onFiles={files.add} />
        <button type="submit" className="hub-btn primary nc-start" disabled={!ready}>Start ⏎</button>
      </div>
      {!simple && <details className="nc-more">
        <summary>More options</summary>
        <div className="nc-more-in">
          {!making && <WaitOnChips {...waitProps} />}
          <div className="nc-more-row">
        {pipes.length > 0 && !making && <span style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
          <label htmlFor="pipeline" style={{ color: 'var(--hub-mute)', fontSize: 13 }}>Multi-step flow</label>
          <select id="pipeline" value={slug} onChange={e => setPipe(e.target.value)} style={{ font: 'inherit', padding: '7px 10px', borderRadius: 8, minWidth: 0, background: 'var(--hub-canvas)', color: 'var(--hub-ink)', border: '1px solid var(--hub-hair)' }}>
            <option value="">Just a chat</option>
            {pipes.map(p => <option key={p.slug} value={p.slug}>{p.name} ({p.stages} steps)</option>)}
          </select>
        </span>}
        {busyProject && !simple && <label className="nc-own" style={{ display: 'flex', gap: 6, alignItems: 'center', color: 'var(--hub-mute)', fontSize: 13 }} title="Starts in .claude/worktrees on its own branch, so it cannot clobber the other chat's files. Merge back on its Git card.">
          <input type="checkbox" checked={own} onChange={e => setOwn(e.target.checked)} /> Separate copy of the project</label>}
        {!research && !simple && <button type="button" className="hub-btn nc-tools" disabled={!path || making || ai !== 'claude'} onClick={askPick} title="Every plugin and skill starts on; turn any off for this chat">Choose tools</button>}
          </div>
      {toolsFor && !research && (toolsFor !== path
        ? <p style={{ ...caps, textTransform: 'none' }}>Project changed. Press Choose tools again, or Start with everything on.</p>
        : tools
          ? <ToolChips profile={tools} flagged={hub.tools?.flagged ?? []} onChange={setEdited} />
          : <p style={{ ...caps, textTransform: 'none' }}>Loading tools…</p>)}
        </div>
      </details>}
      {after && <p role="status" className="hub-waiton-after"><i aria-hidden />{after}</p>}
      {making && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <label htmlFor="repo" style={{ color: 'var(--hub-mute)', fontSize: 13 }}>{path === NEW_REPO ? 'Repo name' : 'owner/repo or GitHub link'}</label>
        <input id="repo" value={repoInput} onChange={e => setRepoInput(e.target.value)} spellCheck={false} autoCapitalize="off" autoCorrect="off"
          placeholder={path === NEW_REPO ? 'my-app' : 'owner/repo'} style={{ font: 'inherit', padding: '7px 10px', borderRadius: 8, flex: '1 1 160px', minWidth: 0, background: 'var(--hub-canvas)', color: 'var(--hub-ink)', border: '1px solid var(--hub-hair)' }} />
        {path === NEW_REPO && <span role="radiogroup" aria-label="Visibility" style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 13, color: 'var(--hub-ink)' }}>
          <label><input type="radio" name="vis" checked={priv} onChange={() => setPriv(true)} /> Private</label>
          <label><input type="radio" name="vis" checked={!priv} onChange={() => setPriv(false)} /> Public</label>
        </span>}
      </div>}
    </form>
  )
}
