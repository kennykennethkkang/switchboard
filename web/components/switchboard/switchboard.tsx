'use client'
import { Fragment, lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useHub } from '@/hooks/use-hub'
import { chatProjects, hideDone, inProjects, liveChats, projectName } from '@/lib/archive'
import { editorName } from '@/lib/editor'
import { ApproveBar } from './approve'
import { defaultCommands, switcherItems, type SwitchItem } from '@/lib/switcher'
import { isMap, pageOf, pageTitle, type Page } from '@/lib/route'
import { dayNumbers, nowLanes, picked } from '@/lib/now'
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
import { AutopilotCard, TodoPanel } from './todo-panel'
import { busiestTodo, finishUp, openCount, ordered, planFolder, withHome } from '@/lib/todo'
import { JevCard } from './jev-card'
import { MirofishCard } from './mirofish-card'
import { Switcher } from './switcher'
import { TodayCard } from './today'
import { Snapshots } from './snapshots'
import { NewChat } from './new-chat'
import { vscodeBridge } from '@/lib/vscode-bridge'
import { demoSplit } from '@/lib/hub-demo'
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
import { MapBar, Nav } from './nav'
import { NowPage } from './now-page'
import { StatusBar } from './status-bar'
import './needs.css'
import { CardStages } from './stages'
// Its own chunk with three in it, loaded on the first open.
const MemoryView = lazy(() => import('./memory').then(m => ({ default: m.MemoryView })))
const FlowMapView = lazy(() => import('./flow-map').then(m => ({ default: m.FlowMapView })))
const BoardView = lazy(() => import('./board').then(m => ({ default: m.BoardView })))

const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); return true } catch { return false } }
const PROJECTS_KEY = 'switchboard.projects'
const CHAT_KEY = 'switchboard.chat'
const PLAN_KEY = 'switchboard.plan'
const isMac = () => typeof navigator !== 'undefined' && /Mac|iP/.test(navigator.platform)
const NARROW = '(max-width: 760px)'

const Ic = ({ d }: { d: string }) => <svg className="hub-ic" aria-hidden width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
const PLUS = 'M8 3v10M3 8h10'
const FIND = 'M7 12.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11ZM11 11l3.5 3.5'

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
  const [panel, setPanel] = useState<'none' | 'new'>('none')
  // The page lives in the hash; a map's Back returns to the last page that was not a map.
  const [page, setPage] = useState<Page>('now')
  const back = useRef<Page>('now')
  useEffect(() => {
    const read = () => setPage(pageOf(location.hash, location.search))
    read()
    addEventListener('hashchange', read)
    return () => removeEventListener('hashchange', read)
  }, [])
  useEffect(() => { if (!isMap(page)) back.current = page }, [page])
  const go = (p: Page) => { if (location.hash !== `#${p}`) location.hash = p; setPage(p); if (!isMap(p)) window.scrollTo({ top: 0 }) }
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
  useEffect(() => { sendRef.current({ type: 'hub-trend' }) }, [isDemo, isVSCode, isLive])
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
  const ready = hub.repo && (hub.repo.files.length > 0 || hub.repo.ahead > 0) ? hub.repo : undefined
  const phoneOn = hub.controls.switchboard.phone === true
  const items = useMemo(() => (finding ? switcherItems(cards, hub.archive ?? [], defaultCommands({ cards, repoChanges: !!ready, vscode: isVSCode, awake: hub.awake, calls: phoneOn })) : []),
    [finding, cards, hub.archive, ready, isVSCode, hub.awake, phoneOn])
  // On a phone the chat page sits below the whole rail, so a tap brings it up.
  const select = (id: string, key: boolean) => {
    setPick({ id, key })
    try { localStorage.setItem(CHAT_KEY, id) } catch { /* no storage */ }
    if (!matchMedia(NARROW).matches) return
    const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches
    requestAnimationFrame(() => document.getElementById('pic-name')?.closest('section')?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' }))
  }
  // A jump to a chat the filter hides clears the filter first.
  const jump = (id: string) => { if (!shown.some(c => c.chat.sessionId === id)) pickProjects([]); go('chats'); select(id, false) }
  const command = (id: string) => {
    if (id.startsWith('go:')) return go(pageOf(id.slice(3)))
    if (id.startsWith('do:approve:')) return send({ type: 'hub-approve', sessionId: id.slice(11) })
    if (id === 'do:new') { setPanel('new'); window.scrollTo({ top: 0 }) }
    else if (id === 'do:commit-draft' && ready) { send({ type: 'hub-draft-commit', sessionId: ready.sessionId }); toGit() }
    else if (id === 'do:awake') send({ type: 'hub-awake', on: !hub.awake })
    else if (id === 'do:calls') send({ type: 'hub-switchboard', key: 'phone', value: !phoneOn })
    else if (id === 'do:phone') { send({ type: 'hub-web', phone: true }); setPhone(true) }
  }
  const choose = (item: SwitchItem) => {
    setFinding(false)
    if (item.kind === 'command') return command(item.id)
    // A history pick shows on Chats; a live pick too, unless a map is up.
    if (item.kind === 'history' || !isMap(page)) go('chats')
    // A Find pick outside the filter clears it, so the chat shows. A History chain key starts with its folder.
    if (item.kind === 'live') { select(item.id, true); if (!shown.some(c => c.chat.sessionId === item.id)) pickProjects([]) }
    else { setReveal({ chain: item.chain, at: Date.now() }); const cwd = item.chain.split('\n')[0]; if (!inProjects(hub.archive?.find(a => a.cwd === cwd) ?? { cwd }, projects)) pickProjects([]) }
  }
  const openGear = (at: Section = 'Chats') => { setGearAt(g => ({ at, n: g.n + 1 })); go('settings') }
  // The To-do lists follow this window, or in the browser app the window used last, else the picked chat. Not the rail's top chat: that reorders as chats change state.
  // A project with none gets an empty one to add the first item to.
  const pickedCwd = cards.find(c => c.chat.sessionId === pick.id)?.chat.cwd
  const here = hub.thisWindow ?? hub.lastWindow
  const todos = useMemo(() => withHome(hub.todos, here ?? pickedCwd), [hub.todos, pickedCwd, here])
  // A project picked by hand (or the Board's Open to-do) holds, across reloads too, until the followed project changes (another window gets focus).
  const [planPick, setPlanPick] = useState<{ at: string; folder: string }>()
  useEffect(() => { try { const v = JSON.parse(localStorage.getItem(PLAN_KEY) ?? 'null'); if (typeof v?.at === 'string' && typeof v?.folder === 'string') setPlanPick(v) } catch { /* no storage */ } }, [])
  const plan = planFolder(Object.keys(todos), pickedCwd, here, planPick)
  const todoAt = plan.at
  const pickPlan = (folder: string) => { if (!todoAt) return; const v = { at: todoAt, folder }; setPlanPick(v); try { localStorage.setItem(PLAN_KEY, JSON.stringify(v)) } catch { /* no storage */ } }
  const today = useMemo(() => todayView(cards, hub.history, hub.live, Date.now(), hub.jev, hub.archive), [cards, hub.history, hub.live, hub.jev, hub.archive])
  const tasks = useMemo(() => taskTotals(cards), [cards])
  const models = useMemo(() => roleModels(hub.installed, hub.controls.claude.model), [hub.installed, hub.controls.claude.model])
  // Redraws the countdown every 30 s while a limit or pause shows one.
  const [, tick] = useState(0)
  const counting = !!hub.pause || !!hub.limitsKept?.out
  useEffect(() => { if (!counting) return; const t = setInterval(() => tick(n => n + 1), 30_000); return () => clearInterval(t) }, [counting])
  const meters = limitMeters(hub.live, Date.now(), hub.limitsKept, hub.codexKept)
  const web = hub.webUrl
  // The QR takes the Mac's name when there is one, since it outlasts an IP change; the IP stays listed below it.
  const pu = hub.phoneUrls
  const phoneLinks = ([['Wi-Fi', pu?.wifiName, pu?.wifi], ['Tailscale', pu?.tailscaleName, pu?.tailscale]] as [string, string | undefined, string | undefined][])
    .flatMap(([name, byName, byIp]) => (byName ?? byIp ? [{ name, url: (byName ?? byIp)!, ip: byName ? byIp : undefined }] : []))
  const windows = hub.windows ?? []
  const starred = useMemo(() => hub.starred.map(s => s.sessionId), [hub.starred])
  // A project's window: the window holding any chat of that project.
  const projectTint = (name: string) => placeOf(cards.find(c => projectName(c.chat) === name)?.chat.cwd, windows)?.color
  const itemTint = (item: SwitchItem) => item.kind === 'command' ? undefined : placeOf(item.kind === 'live' ? cards.find(c => c.chat.sessionId === item.id)?.chat.cwd : item.chain.split('\n')[0], windows)?.color
  const read = (chat: Card['chat']) => () => setReading({ id: chat.sessionId, name: chat.name || projectName(chat) })
  const waitProps = (chat: Card['chat']) => ({ targets: waitTargets(hub.chats, chat, hub.links), problem, onWait: (to: string) => send({ type: 'hub-wait-for', from: chat.sessionId, to }) })
  const chipsOf = (id: string) => linkChips(hub.links, hub.chats, id)
  const held = hub.pause?.chats.map(c => c.sessionId)
  const phoneHint = phoneOn && <p className="hub-phone-mode"><i aria-hidden />Phone mode: questions, stuck and finished chats ring your phone</p>
  const pauseBanner = <PauseBanner pause={hub.pause} onResume={() => send({ type: 'hub-pause', action: 'resume' })} onCancel={() => send({ type: 'hub-pause', action: 'cancel' })} />
  const menu = (chat: Card['chat']) => <ChatMenu chat={chat} starred={starred.includes(chat.sessionId)} send={send} onMac={isVSCode} onRead={read(chat)} {...waitProps(chat)} />
  // Matches the panel: open items plus the ones only Kenneth can do, this project only.
  const todoCount = (todoAt && todos[todoAt] && openCount(todos[todoAt]) + finishUp(todos[todoAt]).length) || 0
  const files = hub.changes?.sessionId === currentId ? hub.changes?.files.length ?? 0 : 0

  const scrollTo = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }))
  const toGit = () => {
    if (ready && ready.sessionId !== currentId) jump(ready.sessionId)
    go('ship'); scrollTo('hub-git')
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
        <i aria-hidden /><span className="hub-ship-name">{ready.name}: </span>{[ready.ahead > 0 && ready.sync.label, ready.files.length > 0 && `${ready.files.length} uncommitted in repo`].filter(Boolean).join(' · ')}
      </button>
  const header = (
    <header className="hub-top">
      <h1 className="hub-page-title">{pageTitle(page)}</h1>
      {isDemo && <span className="hub-note" title="Sample data: no editor window is connected">Sample data</span>}
      {down && !isDemo && <span role="status" className="hub-note" style={{ color: 'var(--hub-yellow)' }}>Not live, retrying: {down}</span>}
      <span className="hub-top-acts">
        <button type="button" className="hub-btn hub-top-find" aria-label="Find" aria-haspopup="dialog" onClick={() => setFinding(true)}><Ic d={FIND} /></button>
        <button type="button" className="hub-btn primary hub-new" aria-expanded={panel === 'new'} onClick={() => setPanel(panel === 'new' ? 'none' : 'new')}><Ic d={PLUS} />New chat</button>
      </span>
    </header>
  )
  // Asking for the link also starts the app when it is not running.
  const phoneButton = isVSCode && <span ref={phoneWrap} className="sb-phone" style={{ position: 'relative' }}>
    <button type="button" className="sb-btn" aria-haspopup="dialog" aria-expanded={phone} onClick={() => { if (!phone) send({ type: 'hub-web', phone: true }); setPhone(!phone) }}>Phone</button>
    {phone && phonePop}
  </span>
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
  const allFails = ci?.conclusion === 'failure' && hub.repo ? [{ sessionId: hub.repo.sessionId, url: ci.url, what: `CI failed: ${ci.workflow}${ci.jobs.find(j => j.step)?.step ? ` at ${ci.jobs.find(j => j.step)!.step}` : ''}` }] : []
  // Now follows the project filter; the nav count does not, so a pick never hides an ask.
  const fails = picked(allFails, cards, projects)
  const pickedStuck = picked(hub.stuck ?? [], cards, projects)
  const asking = shown.filter(c => c.progress?.state === 'needs-you').map(c => ({ sessionId: c.chat.sessionId, question: c.progress?.question, ask: c.chat.ai === 'codex' ? undefined : c.progress?.ask, check: hub.doneChecks?.[c.chat.sessionId] }))
  const approvals = shown.filter(c => c.progress?.state === 'done').map(c => c.chat.sessionId)
  const approveBar = (id: string, small?: boolean, noLabel?: boolean) => <ApproveBar sessionId={id} check={hub.doneChecks?.[id]} send={send} small={small} noLabel={noLabel} />
  const stuck = <StuckStrip stuck={pickedStuck} learning={hub.learnReady} needs={asking} fails={fails} approvals={approvals} approve={id => approveBar(id, true, true)} name={chatName} send={send} onCopy={copy} onJump={jump} bare
    tint={id => placeOf(cards.find(c => c.chat.sessionId === id)?.chat.cwd, windows)?.color}
    diff={id => { const c = cards.find(x => x.chat.sessionId === id); return c && <ChangesPanel key={id} editor={editorName(hub)} changes={hub.changes} sessionId={id} cwd={c.chat.cwd} commit={c.progress?.commit} onCopy={copy} onOpen={file => send({ type: 'hub-open-diff', sessionId: id, file })} /> }}
    onDiff={id => { const to = id ?? currentId; if (to) send({ type: 'hub-changes', sessionId: to }) }}
    onAnswer={(sessionId, askId, choice) => send({ type: 'hub-answer', sessionId, askId, choice })} />
  // Split check: the editor answers, from VS Code or the phone; the demo fakes one.
  const split = isDemo ? (_: string, t: string) => new Promise<string[]>(r => setTimeout(() => r(demoSplit(t)), 600)) : vscodeBridge ? vscodeBridge.split.bind(vscodeBridge) : undefined
  const newChat = <NewChat key={panel} hub={hub} send={send} upload={upload} split={split} onDone={() => setPanel('none')} />
  const gear = <Gear key={gearAt.n} hub={hub} send={send} start={gearAt.at} problem={problem} folder={todoAt} />
  const filter = (projectChips.length > 1 || projects.length > 0) && <ProjectFilter projects={projectChips} picked={projects} tint={projectTint} busy={name => cards.filter(c => c.progress?.state === 'working' && projectName(c.chat) === name).length} onChange={pickProjects} />
  const dev = <DevRows dev={(hub.dev ?? []).filter(d => inProjects({ cwd: d.folder, project: d.repo }, projects))} tailscale={hub.tailscale} isVSCode={isVSCode} send={send} />
  const chatCards = <ChatCards looping={Object.entries(hub.tools?.chats ?? {}).filter(([, p]) => p.indefinite).map(([id]) => id)} editor={editorName(hub)} cards={rail} all={hub.progress} stuck={hub.stuck} cache={hub.cache} waits={hub.waits} held={held} links={chipsOf} onUnlink={(from, to) => send({ type: 'hub-unlink', from, to })} selected={currentId} windows={windows} here={hub.thisWindow} onSelect={select} starred={starred} menu={menu}
    top={c => <CardStages hub={hub} sessionId={c.chat.sessionId} send={send} />}
    extra={c => c.progress?.state === 'done' && approveBar(c.chat.sessionId, true)}
    summaries={hub.summaries} onSummary={(sessionId, refresh) => send({ type: 'hub-summary', sessionId, ...(refresh ? { refresh } : {}) })} onCopy={copy}
    tabs={hub.windowTabs} onTab={!isDemo && (isVSCode || mac) ? (op, workspace) => send({ type: 'hub-window-tab', op, ...(workspace ? { workspace } : {}) }) : undefined}
    empty={cards.length ? 'No chats in the picked projects.' : undefined} send={send} />
  const history = <History archive={(hub.archive ?? []).filter(a => inProjects(a, projects))} chats={cards.map(c => c.chat)} search={hub.search} reveal={reveal}
    onSearch={q => send({ type: 'hub-search', q })}
    onNote={sessionId => send({ type: 'hub-open-note', sessionId })} onResume={(sessionId, ai) => send({ type: 'hub-resume', sessionId, ai })} running={hub.chats.filter(c => c.live).map(c => c.sessionId)} onBack={sessionId => send({ type: 'hub-unarchive', sessionId })} onRead={(id, name) => setReading({ id, name })} />
  const list = todoAt ? todos[todoAt] : undefined
  const next = list && { you: finishUp(list)[0]?.text, up: ordered(list.todo.filter(t => t.why !== 'you'))[0]?.t.text }
  const todayCard = <TodayCard today={today} tasks={tasks} next={next} trend={hub.trend} />
  const todo = plan.folder && <TodoPanel key={plan.folder} folder={plan.folder} onFolder={pickPlan} todos={todos} chats={hub.chats} progress={hub.progress} windows={windows} archive={hub.archive} autoStart={hub.controls.switchboard.autoStart} send={send} />
  // The project the to-do follows gets its Jev card too.
  const jev = todoAt && <JevCard key={`jev-${todoAt}`} folder={todoAt} jev={hub.jevProjects?.[todoAt]} send={send} />
  const place = placeOf(current?.chat.cwd, windows)
  const message = current && ((tools: ReactNode) => <MessageBox key={current.chat.sessionId} chat={current.chat} send={send} upload={upload} problem={problem} tools={tools} />)
  const picture = current
    ? <ChatPicture chat={current.chat} progress={current.progress} all={hub.progress} live={hub.live.find(l => l.sessionId === current.chat.sessionId)} instant={pick.key} models={models} demo={isDemo} links={chipsOf(current.chat.sessionId)}
        profile={hub.tools?.chats[current.chat.sessionId]} flagged={hub.tools?.flagged} smart={hub.tools?.smart?.[current.chat.sessionId]} globalOff={hub.tools?.globalOff} onProfile={tools => send({ type: 'hub-chat-tools', sessionId: current.chat.sessionId, tools })} onCommand={send} onIndefinite={on => send({ type: 'hub-indefinite', sessionId: current.chat.sessionId, on })}
        place={place} message={message} menu={<><button type="button" className="hub-btn" onClick={read(current.chat)} title="What this chat produced, and its transcript">Outputs</button><ChatMenu chat={current.chat} starred={starred.includes(current.chat.sessionId)} send={send} onMac={isVSCode} inPicture {...waitProps(current.chat)} /></>}
        installed={hub.installed} connections={hub.connections} onInstalled={() => openGear('Installed')}
        onFocus={() => send({ type: 'hub-focus-chat', sessionId: current.chat.sessionId })}
        onAnswer={(askId, choice) => send({ type: 'hub-answer', sessionId: current.chat.sessionId, askId, choice })} onCopy={copy}
        approve={current.progress?.state === 'done' ? approveBar(current.chat.sessionId) : undefined}
        check={current.progress?.state === 'needs-you' ? hub.doneChecks?.[current.chat.sessionId] : undefined}
        limits={hub.live.flatMap(l => l.limits)} autoContinue={hub.keep.autoContinue}
        onSend={text => send(boxNote(current.chat) ? { type: 'hub-new-chat', path: current.chat.cwd, text, remote: false } : { type: 'hub-send', sessionId: current.chat.sessionId, text })} />
    : <section style={{ padding: 20, color: 'var(--hub-ash)' }}>Pick a chat, or start one.</section>
  const changes = current && <ChangesPanel editor={editorName(hub)} key={current.chat.sessionId} changes={hub.changes} sessionId={current.chat.sessionId} cwd={current.chat.cwd} commit={current.progress?.commit}
    onCopy={copy} onOpen={file => send({ type: 'hub-open-diff', sessionId: current.chat.sessionId, file })} />
  const ship = current?.progress?.state === 'done' && <ShipCard key={`ship-${current.chat.sessionId}`} repo={hub.repo} progress={current.progress} sessionId={current.chat.sessionId} send={send} onCopy={copy} phone={onPhone} harden={!!hub.controls.switchboard.hardenBuild} />
  const git = current && <>{ship}<GitPanel key={`git-${current.chat.sessionId}`} repo={hub.repo} sessionId={current.chat.sessionId} chat={current.chat} commit={current.progress?.commit} isVSCode={isVSCode} send={send} shipping={!!ship} phone={onPhone} /></>
  const switcher = finding && <Switcher items={items} tint={itemTint} onPick={choose} onClose={() => setFinding(false)} />
  const chatView = reading && <ChatView key={reading.id} sessionId={reading.id} name={reading.name} demo={isDemo ? hub : undefined} onCopy={copy} onClose={() => setReading(undefined)} />
  const mapView = page === 'map-memory' ? <Suspense fallback={null}><MemoryView isDemo={isDemo} onClose={() => go(back.current)} /></Suspense>
    : page === 'map-flow' ? <Suspense fallback={null}><FlowMapView isDemo={isDemo} cwds={hub.projects.map(p => p.path)} here={projectOf(hub.projects.map(p => p.path), hub.thisWindow)} cwd={projectOf(hub.projects.map(p => p.path), current?.chat.cwd)} hub={hub} onClose={() => go(back.current)} /></Suspense>
    : page === 'map-board' && <Suspense fallback={null}><BoardView hub={hub} isDemo={isDemo} send={send} onClose={() => go(back.current)}
      onNew={() => { go(back.current); setPanel('new') }} onTodo={() => { if (!todoCount) { const b = busiestTodo(todos); if (b) pickPlan(b) } go('plan'); scrollTo('hub-todo') }} onChanges={() => { go('ship'); scrollTo('hub-git') }} onMemory={() => go('map-memory')} onFlow={() => go('map-flow')}
      onLimits={() => go('now')} todoCount={todoCount} files={files}
      onSummary={(sessionId, refresh) => send({ type: 'hub-summary', sessionId, ...(refresh ? { refresh } : {}) })} onCopy={copy} /></Suspense>
  const lanes = nowLanes(shown, (hub.archive ?? []).filter(a => inProjects(a, projects)))
  const learnCount = hub.learnReady?.length ?? 0
  const needsCount = asking.length + approvals.length + fails.length + pickedStuck.length + learnCount
  const needsAll = cards.filter(c => c.progress?.state === 'needs-you' || c.progress?.state === 'done').length + allFails.length + (hub.stuck?.length ?? 0) + learnCount
  const openChat = (id: string) => { go('chats'); select(id, false) }
  const pages: Record<Exclude<Page, `map-${string}`>, ReactNode> = {
    now: <NowPage day={dayNumbers(today, tasks)} needs={stuck} needsCount={needsCount} working={lanes.working} done={lanes.done} jarvis={jarvis} filter={filter}
      onOpen={openChat} onDone={a => { go('chats'); setReveal({ chain: `${a.cwd}\n${a.origin}`, at: Date.now() }) }} tint={cwd => placeOf(cwd, windows)?.color} />,
    chats: <div className="hub-chats">
      <aside className="hub-rail" aria-label="Chats">{filter}{chatCards}{history}<Snapshots hub={hub} send={send} /></aside>
      <div className="hub-chat-main">{picture}</div>
    </div>,
    plan: <>
      {todayCard}
      <AutopilotCard todos={todos} chats={hub.chats} autoStart={hub.controls.switchboard.autoStart} />
      {todo && <div id="hub-todo">{todo}</div>}
      {jev}
      {hub.mirofish && <MirofishCard mirofish={hub.mirofish} />}
    </>,
    ship: <>
      {dev}<Terminals hub={hub} send={send} />
      {ready && <div className="hub-ship-head">{shipChip}</div>}
      {current && <div id="hub-git" style={{ display: 'grid', gap: 12 }}>{changes}{git}</div>}
      {!current && <p style={{ margin: 0, color: 'var(--hub-ash)' }}>Pick a chat to see its changes and git.</p>}
    </>,
    settings: gear,
  }

  return (
    <div className="hub hub-shell" data-page={page} data-map={isMap(page) || undefined} style={{ background: 'var(--hub-surface)', color: 'var(--hub-body)', font: '400 14px/1.6 var(--hub-sans)' }}>
      <Nav page={page} go={go} onFind={() => setFinding(true)} findKey={isMac() ? '⌘K' : 'Ctrl K'}
        counts={{ needs: needsAll, chats: cards.length, plan: todoCount, ship: ready?.files.length ?? 0 }} />
      <div className="hub-col">
        {header}
        {phoneHint}
        {pauseBanner}
        {devices}
        {panel !== 'none' && <div style={{ padding: 16, borderBottom: '1px solid var(--hub-hair)' }}>{newChat}</div>}
        <main className="hub-page" aria-label={page}>{isMap(page) ? null : pages[page as keyof typeof pages]}</main>
        <StatusBar meters={meters} dev={(hub.dev ?? []).map(d => ({ running: d.port ? 1 : 0, label: `${d.repo} :${d.port}` }))} onDev={() => go('ship')}
          awake={hub.awake} onAwake={on => send({ type: 'hub-awake', on })} calls={phoneOn} onCalls={on => send({ type: 'hub-switchboard', key: 'phone', value: on })}
          phone={phoneButton} ship={shipChip} />
      </div>
      {switcher}
      {mapView}
      {isMap(page) && <MapBar page={page} go={go} onBack={() => go(back.current)} />}
      {chatView}
    </div>
  )
}
