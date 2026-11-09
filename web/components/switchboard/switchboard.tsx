'use client'
import { Fragment, lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useHub } from '@/hooks/use-hub'
import { chatProjects, hideDone, inProjects, liveChats, projectName } from '@/lib/archive'
import { ApproveBar } from './approve'
import { switcherItems, type SwitchItem } from '@/lib/switcher'
import { todayView } from '@/lib/today'
import { projectOf } from '@/lib/flow-map'
import { byNeed, taskTotals } from '@/lib/progress'
import { roleModels } from '@/lib/gear-rows'
import { limitMeters } from '@/lib/limits'
import { boxNote } from '@/lib/message-box'
import { ChatCards, History, ProjectFilter, type Card } from './chat-cards'
import { ChatPicture } from './chat-picture'
import { MessageBox } from './message-box'
import { ChangesPanel } from './changes'
import { GitPanel } from './git-panel'
import { ShipCard } from './ship-card'
import { TodoPanel, todoFolder } from './todo-panel'
import { busiestTodo, finishUp, openCount, ordered, withHome } from '@/lib/todo'
import { JevCard } from './jev-card'
import { MirofishCard } from './mirofish-card'
import { Switcher } from './switcher'
import { TodayCard } from './today'
import { NewChat } from './new-chat'
import { Gear, type Section } from './gear'
import { PhoneAddress, PhoneQr } from './phone-qr'
import { DevRows, onMac } from './dev-rows'
import { Terminals } from './terminals'
import { StuckStrip } from './stuck-strip'
import { Jarvis } from './jarvis'
import { ChatMenu } from './chat-menu'
import { PauseBanner } from './pause-banner'
import { linkChips, waitTargets } from '@/lib/wait-links'
import { ChatView } from './chat-view'
import { placeOf } from './look'
import { useDismiss } from './use-popover'
import './needs.css'
// Its own chunk with three in it, loaded on the first open.
const MemoryView = lazy(() => import('./memory').then(m => ({ default: m.MemoryView })))
const FlowMapView = lazy(() => import('./flow-map').then(m => ({ default: m.FlowMapView })))
const BoardView = lazy(() => import('./board').then(m => ({ default: m.BoardView })))

const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); return true } catch { return false } }
const PROJECTS_KEY = 'switchboard.projects'
const CHAT_KEY = 'switchboard.chat'
const isMac = () => typeof navigator !== 'undefined' && /Mac|iP/.test(navigator.platform)
const NARROW = '(max-width: 760px)'

const Ic = ({ d }: { d: string }) => <svg className="hub-ic" aria-hidden width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
const ICON = {
  find: 'M7 12.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11ZM11 11l3.5 3.5',
  plus: 'M8 3v10M3 8h10',
  phone: 'M5 1.5h6a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1ZM7 12.2h2',
  awake: 'M8 1.8v5.4M4.4 4a5.2 5.2 0 1 0 7.2 0',
  call: 'M5.6 2 3.4 2.3C2.6 3 2.3 3.9 2.5 4.8a11.2 11.2 0 0 0 8.7 8.7c.9.2 1.8-.1 2.5-.9l.3-2.2-2.7-1.3-1.3 1.4a7.6 7.6 0 0 1-3.5-3.5l1.4-1.3L5.6 2Z',
  gear: 'M6.84 3.34L7.08 1.46L8.92 1.46L9.16 3.34A4.8 4.8 0 0 1 11.45 4.67L13.2 3.94L14.12 5.53L12.61 6.68A4.8 4.8 0 0 1 12.61 9.32L14.12 10.47L13.2 12.06L11.45 11.33A4.8 4.8 0 0 1 9.16 12.66L8.92 14.54L7.08 14.54L6.84 12.66A4.8 4.8 0 0 1 4.55 11.33L2.8 12.06L1.88 10.47L3.39 9.32A4.8 4.8 0 0 1 3.39 6.68L1.88 5.53L2.8 3.94L4.55 4.67A4.8 4.8 0 0 1 6.84 3.34ZM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  board: 'M8 2v3M8 5 4 9M8 5l4 4M4 9v2.5M12 9v2.5M2.5 13.5h3M10.5 13.5h3',
  flow: 'M2.5 3.5h4v3h-4zM9.5 9.5h4v3h-4zM4.5 6.5v4.5h5M9.5 5h4',
  memory: 'M4 4.5a1.5 1.5 0 1 0 0-.01M12 3.5a1.5 1.5 0 1 0 0-.01M8 12.5a1.5 1.5 0 1 0 0-.01M5.3 5l1.9 6M10.8 4.6 8.8 11M5.5 4.2h5',
}

export function Switchboard() {
  const { hub, send, upload, isDemo, isVSCode, isLive, problem, down } = useHub()
  // location only exists in the browser; reading it during render made the server and client markup differ
  const [mac, setMac] = useState(false)
  useEffect(() => setMac(onMac()), [])
  // The proxy refuses Mac-only git ops from the phone, so their buttons stay off there.
  const onPhone = !isDemo && !isVSCode && !mac
  const sendRef = useRef(send)
  sendRef.current = send
  const [pick, setPick] = useState<{ id?: string; key: boolean }>({ key: false })
  // The open chat outlives a reload; a gone id falls back to the first chat.
  useEffect(() => { try { const id = localStorage.getItem(CHAT_KEY); if (id) setPick({ id, key: true }) } catch { /* no storage */ } }, [])
  const [panel, setPanel] = useState<'none' | 'new' | 'gear' | 'memory' | 'board' | 'flow'>('none')
  // ?board opens the Board on load.
  useEffect(() => { if (new URLSearchParams(location.search).has('board')) setPanel('board') }, [])
  const [gearAt, setGearAt] = useState<{ at: Section; n: number }>({ at: 'Chats', n: 0 })
  const [finding, setFinding] = useState(false)
  const [phone, setPhone] = useState(false)
  const phoneWrap = useRef<HTMLSpanElement>(null)
  useDismiss(phone, phoneWrap, () => setPhone(false))
  const [reveal, setReveal] = useState<{ chain: string; at: number }>()
  const [reading, setReading] = useState<{ id: string; name: string }>()
  // The project filter is this device's own, like the tool-calls toggle.
  const [projects, setProjects] = useState<string[]>([])
  useEffect(() => { try { const v = JSON.parse(localStorage.getItem(PROJECTS_KEY) ?? '[]'); if (Array.isArray(v)) setProjects(v.filter(p => typeof p === 'string')) } catch { /* no storage: show all */ } }, [])
  const pickProjects = (next: string[]) => { setProjects(next); try { localStorage.setItem(PROJECTS_KEY, JSON.stringify(next)) } catch { /* no storage */ } }
  const cards: Card[] = useMemo(() => byNeed(liveChats(hub.chats, hub.archive ?? [])
    .map(chat => ({ chat, progress: hub.progress.find(p => p.sessionId === chat.sessionId) }))), [hub.chats, hub.archive, hub.progress])
  // The rail shows the picked projects only, and hides chats done past the setting (the picked one stays); Find still reaches every chat.
  const shown = useMemo(() => cards.filter(c => inProjects(c.chat, projects)), [cards, projects])
  const projectChips = useMemo(() => chatProjects(cards.map(c => c.chat), projects), [cards, projects])
  const idleMinutes = hub.controls.switchboard.idleMinutes
  const rail = useMemo(() => hideDone(shown, idleMinutes, pick.id), [shown, idleMinutes, pick.id])
  const current = shown.find(c => c.chat.sessionId === pick.id) ?? rail[0] ?? shown[0]
  const currentId = current?.chat.sessionId
  // The extension reads the shown chat's changes, then again with each refresh; asked again only when the chat or the connection changes.
  useEffect(() => { if (currentId) sendRef.current({ type: 'hub-changes', sessionId: currentId }) }, [currentId, isDemo, isVSCode, isLive])
  // Cmd+K (Ctrl+K elsewhere), caught before VS Code's webview takes it as the start of a chord.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'k' || e.altKey || e.shiftKey || !(isMac() ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey)) return
      e.preventDefault(); e.stopPropagation()
      setFinding(f => !f)
    }
    document.addEventListener('keydown', down, true)
    return () => document.removeEventListener('keydown', down, true)
  }, [])
  const items = useMemo(() => (finding ? switcherItems(cards, hub.archive ?? []) : []), [finding, cards, hub.archive])
  // On a phone the chat page sits below the whole rail, so a tap brings it up.
  const select = (id: string, key: boolean) => {
    setPick({ id, key })
    try { localStorage.setItem(CHAT_KEY, id) } catch { /* no storage */ }
    if (!matchMedia(NARROW).matches) return
    const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches
    requestAnimationFrame(() => document.getElementById('pic-name')?.closest('section')?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' }))
  }
  // A jump to a chat the filter hides clears the filter first.
  const jump = (id: string) => { if (!shown.some(c => c.chat.sessionId === id)) pickProjects([]); select(id, false) }
  const choose = (item: SwitchItem) => {
    setFinding(false)
    // A Find pick outside the filter clears it, so the chat shows. A History chain key starts with its folder.
    if (item.kind === 'live') { select(item.id, true); if (!shown.some(c => c.chat.sessionId === item.id)) pickProjects([]) }
    else { setReveal({ chain: item.chain, at: Date.now() }); const cwd = item.chain.split('\n')[0]; if (!inProjects(hub.archive?.find(a => a.cwd === cwd) ?? { cwd }, projects)) pickProjects([]) }
  }
  const openGear = (at: Section = 'Chats') => { setGearAt(g => ({ at, n: g.n + 1 })); setPanel('gear') }
  // The To-do lists follow the shown chat's project, else this window's. A project with none gets an empty one to add the first item to.
  const todos = useMemo(() => withHome(hub.todos, current?.chat.cwd), [hub.todos, current?.chat.cwd])
  const todoAt = todoFolder(Object.keys(todos), current?.chat.cwd, hub.thisWindow)
  // The Board's Open to-do lands on a project with items when this one has none; cleared when the chat changes.
  const [todoJump, setTodoJump] = useState<string>()
  useEffect(() => setTodoJump(undefined), [todoAt])
  const today = useMemo(() => todayView(cards, hub.history, hub.live, Date.now(), hub.jev, hub.archive), [cards, hub.history, hub.live, hub.jev, hub.archive])
  const tasks = useMemo(() => taskTotals(cards), [cards])
  const models = useMemo(() => roleModels(hub.installed, hub.controls.claude.model), [hub.installed, hub.controls.claude.model])
  // Redraws the countdown every 30 s while a limit or pause shows one.
  const [, tick] = useState(0)
  const counting = !!hub.pause || !!hub.limitsKept?.out
  useEffect(() => { if (!counting) return; const t = setInterval(() => tick(n => n + 1), 30_000); return () => clearInterval(t) }, [counting])
  const meters = limitMeters(hub.live, Date.now(), hub.limitsKept)
  const web = hub.webUrl
  // The QR takes the Mac's name when there is one, since it outlasts an IP change; the IP stays listed below it.
  const pu = hub.phoneUrls
  const phoneLinks = ([['Wi-Fi', pu?.wifiName, pu?.wifi], ['Tailscale', pu?.tailscaleName, pu?.tailscale]] as [string, string | undefined, string | undefined][])
    .flatMap(([name, byName, byIp]) => (byName ?? byIp ? [{ name, url: (byName ?? byIp)!, ip: byName ? byIp : undefined }] : []))
  const windows = hub.windows ?? []
  const starred = useMemo(() => hub.starred.map(s => s.sessionId), [hub.starred])
  // A project's window: the window holding any chat of that project.
  const projectTint = (name: string) => placeOf(cards.find(c => projectName(c.chat) === name)?.chat.cwd, windows)?.color
  const itemTint = (item: SwitchItem) => placeOf(item.kind === 'live' ? cards.find(c => c.chat.sessionId === item.id)?.chat.cwd : item.chain.split('\n')[0], windows)?.color
  const read = (chat: Card['chat']) => () => setReading({ id: chat.sessionId, name: chat.name || projectName(chat) })
  const waitProps = (chat: Card['chat']) => ({ targets: waitTargets(hub.chats, chat, hub.links), problem, onWait: (to: string) => send({ type: 'hub-wait-for', from: chat.sessionId, to }) })
  const chipsOf = (id: string) => linkChips(hub.links, hub.chats, id)
  const held = hub.pause?.chats.map(c => c.sessionId)
  const phoneOn = hub.controls.switchboard.phone === true
  const phoneHint = phoneOn && <p className="hub-phone-mode"><i aria-hidden />Phone mode: questions, stuck and finished chats ring your phone</p>
  const pauseBanner = <PauseBanner pause={hub.pause} onResume={() => send({ type: 'hub-pause', action: 'resume' })} onCancel={() => send({ type: 'hub-pause', action: 'cancel' })} />
  const menu = (chat: Card['chat']) => <ChatMenu chat={chat} starred={starred.includes(chat.sessionId)} send={send} onMac={isVSCode} onRead={read(chat)} {...waitProps(chat)} />
  // Matches the panel: open items plus the ones only Kenneth can do, this project only.
  const todoCount = (todoAt && todos[todoAt] && openCount(todos[todoAt]) + finishUp(todos[todoAt]).length) || 0
  const files = hub.changes?.sessionId === currentId ? hub.changes?.files.length ?? 0 : 0

  const ready = hub.repo && (hub.repo.files.length > 0 || hub.repo.ahead > 0) ? hub.repo : undefined
  const scrollTo = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }))
  const toGit = () => {
    if (ready && ready.sessionId !== currentId) jump(ready.sessionId)
    scrollTo('hub-git')
  }
  const phonePop = (
            <div role="dialog" aria-label="Open Switchboard on your phone" className="hub-pop">
              {phoneLinks.map(({ name, url, ip }) => <Fragment key={name}>
                <PhoneQr url={url} label={`QR code that opens Switchboard on your phone (${name})`} />
                <span style={{ font: '400 12px/1 var(--hub-sans)', color: 'var(--hub-mute)' }}>{name}</span>
                <PhoneAddress url={url} ip={ip} onCopy={copy} />
              </Fragment>)}
              {phoneLinks.length > 0 && hub.phoneUrls?.code && <span style={{ display: 'grid', gap: 4, justifyItems: 'center', paddingTop: 8, borderTop: '1px solid var(--hub-hair)', width: '100%' }}>
                <span style={{ font: '600 18px/1.2 var(--hub-mono)', color: 'var(--hub-ink)', letterSpacing: '0.08em' }}>Code {hub.phoneUrls.code.slice(0, 3)} {hub.phoneUrls.code.slice(3)}</span>
                <span style={{ font: '400 12px/1.4 var(--hub-sans)', color: 'var(--hub-mute)' }}>Type an address, then this code</span>
              </span>}
              {phoneLinks.some(l => l.url.startsWith('http:')) && <span style={{ font: '400 12px/1.5 var(--hub-sans)', color: 'var(--hub-ash)', maxWidth: 220 }}>
                Copy buttons on the phone need HTTPS. Turn on HTTPS Certificates in the Tailscale admin console, DNS page.</span>}
              {!phoneLinks.length && <span style={{ font: '400 12px/1.5 var(--hub-sans)', color: 'var(--hub-ash)' }}>{
                hub.phoneUrls ? hub.phoneUrls.problem ?? 'Checking Tailscale on this Mac…'
                  : web ? 'The running browser app has no phone access (started without --lan). Stop it, then press Phone again.' : 'Starting the browser app…'}</span>}
            </div>
  )
  const shipChip = ready && <button type="button" className="hub-ship-chip" title={`${ready.name} is ready to ship: uncommitted files in the whole repo, from every chat. Open the Git card`} onClick={toGit}>
        <i aria-hidden /><span className="hub-ship-name">{ready.name}: </span>{[ready.files.length > 0 && `${ready.files.length} uncommitted in repo`, ready.ahead > 0 && ready.sync.label].filter(Boolean).join(' · ')}
      </button>
  const limits = (
      <span className="hub-limits">
        {meters.map(m => <span key={m.kind} className="hub-limit" data-level={m.level} title={m.reset || undefined}>
          <i aria-hidden><b style={{ transform: `scaleX(${Math.min(100, m.percent ?? 0) / 100})` }} /></i>
          {m.label} {m.level === 'out' ? m.reset : m.percent === undefined ? 'no data' : `${m.percent}%`}
          {m.level !== 'out' && m.reset && <span className="sr-only"> · {m.reset}</span>}
        </span>)}
      </span>
  )
  const header = (
    <header className="hub-top">
      <strong className="hub-brand"><i aria-hidden /><span className="hub-lbl">Switchboard</span></strong>
      <button type="button" className="hub-btn hub-find" aria-haspopup="dialog" aria-label="Find a chat" onClick={() => setFinding(true)} title="Find a chat, live or in History">
        <Ic d={ICON.find} /><span className="hub-lbl">Find</span> <kbd>{isMac() ? '⌘K' : 'Ctrl K'}</kbd>
      </button>
      {isDemo && <span className="hub-note" title="Sample data: no VS Code window is connected">Sample data</span>}
      {ready && shipChip}
      {down && !isDemo && <span role="status" className="hub-note" style={{ color: 'var(--hub-yellow)' }}>Not live, retrying: {down}</span>}
      {limits}
      <button type="button" className="hub-btn primary hub-new" aria-expanded={panel === 'new'} onClick={() => setPanel(panel === 'new' ? 'none' : 'new')}><Ic d={ICON.plus} />New chat</button>
      {isVSCode && <>
        <span ref={phoneWrap} style={{ position: 'relative' }}>
          {/* Asking for the link also starts the app when it is not running. */}
          <button type="button" className="hub-btn" aria-label="Phone" aria-haspopup="dialog" aria-expanded={phone} onClick={() => { if (!phone) send({ type: 'hub-web', phone: true }); setPhone(!phone) }}><Ic d={ICON.phone} /><span className="hub-lbl">Phone</span></button>
          {phone && phonePop}
        </span>
      </>}
      {hub.awake !== undefined && <button type="button" className="hub-btn hub-awake" aria-label="Keep awake" aria-pressed={hub.awake} onClick={() => send({ type: 'hub-awake', on: !hub.awake })}
        title="Keeps this Mac awake so Switchboard and dev servers answer from anywhere. With the lid closed, only while on power.">
        <Ic d={ICON.awake} /><span className="hub-lbl">{hub.awake ? 'Awake' : 'Keep awake'}</span></button>}
      <button type="button" className="hub-btn hub-call" aria-label={phoneOn ? 'Calls on' : 'Call me'} aria-pressed={phoneOn} title="Phone mode: call me instead of asking in chats"
        onClick={() => send({ type: 'hub-switchboard', key: 'phone', value: !phoneOn })}><Ic d={ICON.call} /><span className="hub-lbl">{phoneOn ? 'Calls on' : 'Call me'}</span></button>
      <button type="button" className="hub-btn" aria-label="Board" title="Board: every agent as a skill tree" onClick={() => setPanel('board')}><Ic d={ICON.board} /><span className="hub-lbl">Board</span></button>
      <button type="button" className="hub-btn" aria-label="Memory" title="Memory: what Claude remembers, as a graph" onClick={() => setPanel('memory')}><Ic d={ICON.memory} /><span className="hub-lbl">Memory</span></button>
      <button type="button" className="hub-btn" aria-label="Flow map" title="Flow map: how this project is built, and which chats built it" onClick={() => setPanel('flow')}><Ic d={ICON.flow} /><span className="hub-lbl">Flow</span></button>
      <button type="button" className="hub-btn hub-gear" aria-label="Settings" title="Settings" aria-expanded={panel === 'gear'} onClick={() => (panel === 'none' || panel === 'new' || panel === 'memory' || panel === 'board' || panel === 'flow' ? openGear() : setPanel('none'))}>
        <Ic d={ICON.gear} />
      </button>
    </header>
  )
  const devices = isVSCode && hub.devices?.map(d => (
    <div key={d.id} role="alert" className="hub-device">
      <span style={{ flex: 1, minWidth: 200 }}>A device wants to open Switchboard: {d.ua} at {d.ip} ({d.network})</span>
      <button type="button" className="hub-btn primary" onClick={() => send({ type: 'hub-device', id: d.id, allow: true })}>Allow</button>
      <button type="button" className="hub-btn" onClick={() => send({ type: 'hub-device', id: d.id, allow: false })}>Deny</button>
    </div>
  ))
  const chatName = (id: string) => { const c = cards.find(x => x.chat.sessionId === id)?.chat; return c ? c.name || projectName(c) : 'A chat' }
  const jarvis = <Jarvis reply={hub.jarvis} voice={hub.voice} heard={hub.heard} mic={isDemo || isVSCode || mac} demo={isDemo} send={send} />
  const ci = hub.repo?.ci
  const fails = ci?.conclusion === 'failure' && hub.repo ? [{ sessionId: hub.repo.sessionId, url: ci.url, what: `CI failed: ${ci.workflow}${ci.jobs.find(j => j.step)?.step ? ` at ${ci.jobs.find(j => j.step)!.step}` : ''}` }] : []
  const asking = cards.filter(c => c.progress?.state === 'needs-you').map(c => ({ sessionId: c.chat.sessionId, question: c.progress?.question, ask: c.chat.ai === 'codex' ? undefined : c.progress?.ask }))
  const approvals = cards.filter(c => c.progress?.state === 'done').map(c => c.chat.sessionId)
  const approveBar = (id: string, small?: boolean) => <ApproveBar sessionId={id} check={hub.doneChecks?.[id]} send={send} small={small} />
  const stuck = <StuckStrip stuck={hub.stuck} learning={hub.learnReady} needs={asking} fails={fails} approvals={approvals} approve={id => approveBar(id, true)} name={chatName} send={send} onCopy={copy} onJump={jump}
    onAnswer={(sessionId, askId, choice) => send({ type: 'hub-answer', sessionId, askId, choice })} />
  const newChat = <NewChat hub={hub} send={send} upload={upload} onDone={() => setPanel('none')} />
  const gear = <Gear key={gearAt.n} hub={hub} send={send} start={gearAt.at} problem={problem} />
  const filter = (projectChips.length > 1 || projects.length > 0) && <ProjectFilter projects={projectChips} picked={projects} tint={projectTint} busy={name => cards.filter(c => c.progress?.state === 'working' && projectName(c.chat) === name).length} onChange={pickProjects} />
  const dev = <DevRows dev={(hub.dev ?? []).filter(d => inProjects({ cwd: d.folder, project: d.repo }, projects))} tailscale={hub.tailscale} isVSCode={isVSCode} send={send} />
  const chatCards = <ChatCards cards={rail} all={hub.progress} stuck={hub.stuck} cache={hub.cache} waits={hub.waits} held={held} links={chipsOf} onUnlink={(from, to) => send({ type: 'hub-unlink', from, to })} selected={currentId} windows={windows} here={hub.thisWindow} onSelect={select} starred={starred} menu={menu}
    extra={c => c.progress?.state === 'done' && approveBar(c.chat.sessionId, true)}
    summaries={hub.summaries} onSummary={(sessionId, refresh) => send({ type: 'hub-summary', sessionId, ...(refresh ? { refresh } : {}) })} onCopy={copy}
    tabs={hub.windowTabs} onTab={!isDemo && (isVSCode || mac) ? (op, workspace) => send({ type: 'hub-window-tab', op, ...(workspace ? { workspace } : {}) }) : undefined}
    empty={cards.length ? 'No chats in the picked projects.' : undefined} send={send} />
  const history = <History archive={(hub.archive ?? []).filter(a => inProjects(a, projects))} chats={cards.map(c => c.chat)} search={hub.search} reveal={reveal}
    onSearch={q => send({ type: 'hub-search', q })}
    onNote={sessionId => send({ type: 'hub-open-note', sessionId })} onResume={(sessionId, ai) => send({ type: 'hub-resume', sessionId, ai })} running={hub.chats.filter(c => c.live).map(c => c.sessionId)} onBack={sessionId => send({ type: 'hub-unarchive', sessionId })} onRead={(id, name) => setReading({ id, name })} />
  const list = todoAt ? todos[todoAt] : undefined
  const next = list && { you: finishUp(list)[0]?.text, up: ordered(list.todo.filter(t => t.why !== 'you'))[0]?.t.text }
  const todayCard = <TodayCard today={today} tasks={tasks} next={next} />
  const todo = todoAt && <TodoPanel key={todoJump ?? todoAt} folder={todoJump ?? todoAt} todos={todos} chats={hub.chats} progress={hub.progress} windows={windows} archive={hub.archive} send={send} />
  // The project the to-do follows gets its Jev card too.
  const jev = todoAt && <JevCard key={`jev-${todoAt}`} folder={todoAt} jev={hub.jevProjects?.[todoAt]} send={send} />
  const place = placeOf(current?.chat.cwd, windows)
  const message = current && ((tools: ReactNode) => <MessageBox key={current.chat.sessionId} chat={current.chat} send={send} upload={upload} problem={problem} tools={tools} />)
  const picture = current
    ? <ChatPicture chat={current.chat} progress={current.progress} all={hub.progress} live={hub.live.find(l => l.sessionId === current.chat.sessionId)} instant={pick.key} models={models} demo={isDemo} links={chipsOf(current.chat.sessionId)}
        profile={hub.tools?.chats[current.chat.sessionId]} flagged={hub.tools?.flagged} smart={hub.tools?.smart?.[current.chat.sessionId]} globalOff={hub.tools?.globalOff} onProfile={tools => send({ type: 'hub-chat-tools', sessionId: current.chat.sessionId, tools })}
        place={place} message={message} menu={<><button type="button" className="hub-btn" onClick={read(current.chat)} title="What this chat produced, and its transcript">Outputs</button><ChatMenu chat={current.chat} starred={starred.includes(current.chat.sessionId)} send={send} onMac={isVSCode} inPicture {...waitProps(current.chat)} /></>}
        installed={hub.installed} connections={hub.connections} onInstalled={() => openGear('Installed')}
        onFocus={() => send({ type: 'hub-focus-chat', sessionId: current.chat.sessionId })}
        onAnswer={(askId, choice) => send({ type: 'hub-answer', sessionId: current.chat.sessionId, askId, choice })} onCopy={copy}
        approve={current.progress?.state === 'done' ? approveBar(current.chat.sessionId) : undefined}
        limits={hub.live.flatMap(l => l.limits)} autoContinue={hub.keep.autoContinue}
        onSend={text => send(boxNote(current.chat) ? { type: 'hub-new-chat', path: current.chat.cwd, text, remote: false } : { type: 'hub-send', sessionId: current.chat.sessionId, text })} />
    : <section style={{ padding: 20, color: 'var(--hub-ash)' }}>Pick a chat, or start one.</section>
  const changes = current && <ChangesPanel key={current.chat.sessionId} changes={hub.changes} sessionId={current.chat.sessionId} cwd={current.chat.cwd} commit={current.progress?.commit}
    onCopy={copy} onOpen={file => send({ type: 'hub-open-diff', sessionId: current.chat.sessionId, file })} />
  const ship = current?.progress?.state === 'done' && <ShipCard key={`ship-${current.chat.sessionId}`} repo={hub.repo} progress={current.progress} sessionId={current.chat.sessionId} send={send} onCopy={copy} phone={onPhone} harden={!!hub.controls.switchboard.hardenBuild} />
  const git = current && <>{ship}<GitPanel key={`git-${current.chat.sessionId}`} repo={hub.repo} sessionId={current.chat.sessionId} chat={current.chat} commit={current.progress?.commit} isVSCode={isVSCode} send={send} shipping={!!ship} phone={onPhone} /></>
  const switcher = finding && <Switcher items={items} tint={itemTint} onPick={choose} onClose={() => setFinding(false)} />
  const chatView = reading && <ChatView key={reading.id} sessionId={reading.id} name={reading.name} demo={isDemo ? hub : undefined} onCopy={copy} onClose={() => setReading(undefined)} />
  const memory = panel === 'memory' ? <Suspense fallback={null}><MemoryView isDemo={isDemo} onClose={() => setPanel('none')} /></Suspense>
    : panel === 'flow' ? <Suspense fallback={null}><FlowMapView isDemo={isDemo} cwds={hub.projects.map(p => p.path)} cwd={projectOf(hub.projects.map(p => p.path), current?.chat.cwd)} onClose={() => setPanel('none')} /></Suspense>
    : panel === 'board' && <Suspense fallback={null}><BoardView hub={hub} isDemo={isDemo} send={send} onClose={() => setPanel('none')}
      onNew={() => setPanel('new')} onTodo={() => { setPanel('none'); if (!todoCount) setTodoJump(busiestTodo(todos)); scrollTo('hub-todo') }} onChanges={() => { setPanel('none'); scrollTo('hub-git') }} onMemory={() => setPanel('memory')} onFlow={() => setPanel('flow')}
      onLimits={() => { setPanel('none'); window.scrollTo({ top: 0 }) }} todoCount={todoCount} files={files}
      onSummary={(sessionId, refresh) => send({ type: 'hub-summary', sessionId, ...(refresh ? { refresh } : {}) })} onCopy={copy} /></Suspense>

  return (
    <div className="hub" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--hub-surface)', color: 'var(--hub-body)', font: '400 14px/1.6 var(--hub-sans)' }}>
      {header}
      {phoneHint}
      {pauseBanner}
      {devices}
      {jarvis}
      {stuck}
      {panel === 'new' && <div style={{ padding: 16, borderBottom: '1px solid var(--hub-hair)' }}>{newChat}</div>}
      {panel === 'gear' && <div style={{ background: 'var(--hub-surface)' }}>
        <div className="hub-sheet-h">
          <h2>Settings</h2>
          <button type="button" className="hub-btn icon" aria-label="Close Settings" onClick={() => setPanel('none')}>
            <svg aria-hidden width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M3 3l8 8M11 3l-8 8" /></svg>
          </button>
        </div>
        {gear}
      </div>}
      <main className="hub-app" style={{ flex: 1 }}>
        <aside className="hub-rail" aria-label="Chats" style={{ padding: 16, background: 'var(--hub-canvas)' }}>
          {filter}{dev}<Terminals hub={hub} send={send} />{chatCards}{history}
        </aside>
        <div style={{ minWidth: 0 }}>
          <div style={{ padding: '20px 20px 0' }}>{todayCard}</div>
          {todo && <div id="hub-todo" style={{ padding: '12px 20px 0' }}>{todo}</div>}
          {jev && <div style={{ padding: '12px 20px 0' }}>{jev}</div>}
          {hub.mirofish && <div style={{ padding: '12px 20px 0' }}><MirofishCard mirofish={hub.mirofish} /></div>}
          {picture}
          {current && <div id="hub-git" style={{ padding: '0 20px 20px', display: 'grid', gap: 12 }}>{changes}{git}</div>}
        </div>
      </main>
      {switcher}
      {memory}
      {chatView}
    </div>
  )
}
