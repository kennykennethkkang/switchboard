'use client'

/**
 * Settings, in sections: a nav on the left (a wrapping row on a phone) and the picked section's rows.
 * Claude Code rows go through the extension's whitelist into ~/.claude/settings.json, so new chats pick them up.
 * Search runs across every section; installed lists sit in folds apart from the switches.
 */
import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { useFlash } from '@/hooks/use-flash'
import type { HubState, SettingKey, SwitchboardKey } from '@/lib/hub-types'
import { editorName } from '@/lib/editor'
import { chatGroups, benchPrompt, blockHits, gearRows, pauseValue, sweepBadge, sweptNow } from '@/lib/gear-rows'
import type { HubCommand } from '@/lib/vscode-bridge'
import { SignIns } from './sign-ins'
import { Credits } from './credits'
import { Health } from './health'
import { ToolPrecedence } from './tool-precedence'
import { PhoneAlerts, phoneAlertsShown } from './phone-alerts'
import { ADVANCED_HINT } from './stages'
import { ago } from '@/lib/look'
import { advancedRows, raiseLine, raisesFor } from '@/lib/stages-ui'
import './gear.css'

export function Switch({ on, onChange, label, text, disabled }: { on: boolean; onChange: (next: boolean) => void; label: string; text?: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" className="hub-switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}>
      <span aria-hidden />{text}
    </button>
  )
}

/** A native select in the hub's look; long option text truncates in the box. */
export function Pick({ options, value, onChange, label, muted, disabled }: { options: Array<[string, string]>; value: string; onChange: (v: string) => void; label: string; muted?: boolean; disabled?: boolean }) {
  return (
    <select className="hub-select" aria-label={label} value={value} disabled={disabled} onChange={e => onChange(e.target.value)} style={muted ? { color: 'var(--hub-mute)' } : undefined}>
      {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
    </select>
  )
}

const MODELS: Array<[string, string]> = [['default', 'Default'], ['fable', 'Fable'], ['opus', 'Opus'], ['sonnet', 'Sonnet'], ['haiku', 'Haiku']]
const ROLE_MODELS: Array<[RoleModel, string]> = [['fable', 'Fable'], ['opus', 'Opus'], ['sonnet', 'Sonnet'], ['haiku', 'Haiku']]
type RoleModel = Extract<HubCommand, { type: 'hub-role-model' }>['model']
type CodexModel = Extract<HubCommand, { type: 'hub-role-codex' }>['model']
type CodexEffort = Extract<HubCommand, { type: 'hub-role-codex' }>['effort']
const CODEX_MODELS: Array<[string, string]> = [['default', 'Default (config.toml)'], ['gpt-6-luna', 'gpt-6-luna'], ['gpt-5.6-terra', 'gpt-5.6-terra'], ['gpt-5.6-luna', 'gpt-5.6-luna']]
const CLAUDE_MODES: Array<[string, string]> = [['bypass', 'Bypass'], ['ask', 'Ask'], ['auto', 'Auto']]
const NOTICE_SPOTS: Array<[string, string]> = [['top-right', 'Top right'], ['bottom-left', 'Bottom left'], ['bottom-right', 'Bottom right']]
const CODEX_EFFORTS: Array<[string, string]> = [['default', 'Default'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['xhigh', 'Extra high'], ['max', 'Max']]
const EFFORTS: Array<[string, string]> = [['default', 'Model default'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['xhigh', 'Extra high'], ['max', 'Max']]
const IDLE: Array<[string, string]> = [['5', 'After 5 min'], ['15', 'After 15 min'], ['30', 'After 30 min'], ['60', 'After 1 h'], ['never', 'Never']]

const SECTIONS = ['Chats', 'Models', 'Accounts', 'Integrations', 'Installed'] as const
export type Section = typeof SECTIONS[number]
// Simple view: these sections and rows only; Coder view shows them all.
const SIMPLE_SECTIONS: readonly Section[] = ['Chats', 'Accounts']
const SIMPLE_ROWS = ['Your name', 'Continue at usage limit', 'Pause near the limit', 'Phone mode']
// group: rows the panel sets apart under their own heading.
// group: advanced rows sit under their own heading; roles and tail split the Models pane.
type Row = { label: string; control: ReactNode; hint?: string; section: Section; group?: 'advanced' | 'roles' | 'tail' }
/** pane: the settings page a search hit lives on, shown as a small label. */
const syncAgo = (at: number) => { const a = ago(at); return a === 'now' ? 'just now' : `${a} ago` }

function Line({ row, pane }: { row: Row; pane?: string }) {
  // A switch or a pick saves at once, so the row says so for a moment.
  const [saved, setSaved] = useFlash(0, 2000)
  const flash = () => setSaved(Date.now())
  return (
    <div className="hub-set-row">
      <span style={{ display: 'grid', gap: 2, minWidth: 0 }}>
        {pane && <span style={{ fontSize: 11, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--hub-ash)' }}>{pane}</span>}
        <span style={{ color: 'var(--hub-ink)' }}>{row.label}<span role="status" style={{ marginLeft: 8, fontSize: 12, color: 'var(--hub-green)' }}>{saved ? 'Saved' : ''}</span></span>
        {row.hint && <span style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--hub-ash)' }}>{row.hint}</span>}
      </span>
      <span style={{ display: 'contents' }}
        onClickCapture={e => { if ((e.target as Element).closest('[role=switch]')) flash() }}
        onChangeCapture={e => { if ((e.target as Element).tagName === 'SELECT') flash() }}>{row.control}</span>
    </div>
  )
}

const sub = { font: '600 14px/1.2 var(--hub-sans)', color: 'var(--hub-ink)', margin: '28px 0 4px', paddingTop: 16, borderTop: '1px solid var(--hub-hair)' } as const

/** start: the section to open on. layout: this device's own pick, kept in its browser storage. */
// Same check as kit/sweep.mjs repoOf, so a typo shows here; the extension checks again.
const REPO = /^(?:https:\/\/github\.com\/[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}?(?:\.git)?\/?|[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100})$/

/** Add a plugin or skill from GitHub, Sweep all, and each tool the sweep flagged with Fix in a chat, Rescan and Approve. */
function Sweep({ hub, send }: { hub: HubState; send: (c: HubCommand) => void }) {
  const [repo, setRepo] = useState('')
  const s = hub.sweep
  const busy = !!s?.busy
  const ok = REPO.test(repo.trim())
  const now = sweptNow(hub)
  const flagged = now.filter(([, r]) => sweepBadge(r) === 'Review').sort(([a], [b]) => a.localeCompare(b))
  const count = (b: string) => now.filter(([, r]) => sweepBadge(r) === b).length
  const add = () => { if (ok && !busy) { send({ type: 'hub-tool-add', repo: repo.trim() }); setRepo('') } }
  return (
    <>
      <Line row={{ section: 'Installed', label: 'Add a plugin or skill', hint: 'A GitHub repo as owner/repo or its link. It is swept first; one the sweep flags is added but left off.',
        control: (
          <span style={{ display: 'inline-flex', gap: 8 }}>
            <input className="hub-select" aria-label="GitHub repo" placeholder="owner/repo" value={repo} maxLength={200} style={{ cursor: 'text' }}
              onChange={e => setRepo(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }} />
            <button type="button" className="hub-btn" disabled={!ok || busy} onClick={add}>Add</button>
          </span>
        ) }} />
      <Line row={{ section: 'Installed', label: 'Sweep', hint: [busy ? (s?.progress ? `Sweeping ${s.progress.done} of ${s.progress.total}.` : 'Sweeping now.') : s?.note, now.length ? `${count('Clean')} clean, ${count('Review')} to review, ${count('Reviewed')} reviewed, ${count('Approved')} approved. NVIDIA SkillSpector, no LLM.` : 'Nothing swept yet. Sweep all checks every plugin and skill with NVIDIA SkillSpector, no LLM.'].filter(Boolean).join(' '),
        control: <button type="button" className="hub-btn" disabled={busy} onClick={() => send({ type: 'hub-sweep' })}>{busy ? 'Sweeping' : 'Sweep all'}</button> }} />
      {flagged.length > 0 && <>
        <h4 style={sub}>Needs review</h4>
        {flagged.map(([name, r]) => (
          <Line key={name} row={{ section: 'Installed', label: name.split('@')[0],
            hint: [`${r.severity ?? r.recommendation ?? 'Flagged'}, ${r.issues ?? 0} issues, ${hub.installed.some(i => i.name === name && i.enabled) ? 'on' : 'off'}.`, r.top?.[0] && `Worst: ${r.top[0].id} in ${r.top[0].file ?? '?'}${r.top[0].line ? `:${r.top[0].line}` : ''}.`].filter(Boolean).join(' '),
            control: (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="hub-link" disabled={busy} onClick={() => send({ type: 'hub-sweep', name })}>Rescan</button>
                <button type="button" className="hub-link" onClick={() => send({ type: 'hub-sweep-approve', name })}>Approve</button>
                <button type="button" className="hub-btn sm" onClick={() => send({ type: 'hub-sweep-fix', name })}>Fix in a chat</button>
              </span>
            ) }} />
        ))}
      </>}
    </>
  )
}

export function Gear({ hub, send, problem, start = 'Chats', folder }: { hub: HubState; send: (c: HubCommand) => void; problem?: { text: string; at: number; for?: HubCommand } | null; start?: Section; folder?: string }) {
  const ed = editorName(hub)
  const [q, setQ] = useState('')
  const [at, setAt] = useState<Section>(start)
  const c = hub.controls.claude
  const sb = hub.controls.switchboard
  const set = (key: SettingKey, value: boolean | string | null) => send({ type: 'hub-setting', key, value })
  const own = (key: SwitchboardKey, value: boolean | number | string | null) => send({ type: 'hub-switchboard', key, value })
  const query = q.trim().toLowerCase()
  // The last pause % survives the switch being off, and a reload, in this browser.
  const [lastPause, setLastPause] = useState<number | undefined>(() => { try { return Number(localStorage.getItem('sb-pause-at')) || undefined } catch { return undefined } })
  useEffect(() => {
    if (typeof sb.pauseAt !== 'number') return
    setLastPause(sb.pauseAt)
    try { localStorage.setItem('sb-pause-at', String(sb.pauseAt)) } catch { /* private window */ }
  }, [sb.pauseAt])
  const noCodex = hub.ais?.find(a => a.id === 'codex')?.installed === false
  // Codex pickers stay put but off, with a way to the Accounts page where the install is shown.
  const codexGate = (pickers: ReactNode) => noCodex
    ? <span className="hub-set-ctl" style={{ gap: 8 }}><button type="button" className="hub-link" onClick={() => { setAt('Accounts'); setQ('') }}>Codex not installed</button>{pickers}</span>
    : pickers
  const lead = c.model ?? 'default'
  const alerts = phoneAlertsShown()
  const smart = sb.smartModelSwitch !== false
  const raises = smart ? raisesFor(hub, folder) : {}
  const coder = sb.coderView === true
  const sections: readonly Section[] = coder ? SECTIONS : SIMPLE_SECTIONS
  const pane = sections.includes(at) ? at : 'Chats'
  const coderRow: Row = { section: 'Chats', label: 'Coder view', hint: 'On adds Live, Ship, Map, terminals, models, integrations and every setting. Off keeps Home, Chats, Plan and the basic settings in plain words.',
    control: <Switch label="Coder view" on={coder} onChange={on => send({ type: 'hub-coder-view', on })} /> }
  const adv = advancedRows(hub, folder)
  const advSwitch = (r: typeof adv[number]) => <Switch label={`Advanced mode in ${r.name}`} on={r.on} onChange={on => send({ type: 'hub-advanced', path: r.path, on })} />
  // One project: a single row. Several: a heading and a switch each.
  const advanced: Row[] = adv.length === 1
    ? [{ section: 'Chats', label: `Advanced mode in ${adv[0].name}`, hint: ADVANCED_HINT, control: advSwitch(adv[0]) }]
    : adv.map(r => ({ section: 'Chats' as const, group: 'advanced' as const, label: r.name, control: advSwitch(r) }))

  const rows: Row[] = [
    { section: 'Chats', label: 'Your name', hint: 'Chats call you by this name. Leave it empty to skip it.',
      // Keyed by the saved name, so a save from another window shows here.
      control: <input key={sb.name} className="hub-select" aria-label="Your name" placeholder="Name" maxLength={40} defaultValue={sb.name} style={{ cursor: 'text' }}
        onBlur={e => { const v = e.target.value.trim(); if (v !== sb.name) own('name', v) }}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} /> },
    { section: 'Chats', label: 'Hide done chats', hint: 'A done chat that is no longer running leaves the list once quiet this long; running and idle chats always stay. Find still has it.',
      control: <Pick label="Hide done chats" options={IDLE} value={sb.idleMinutes === null ? 'never' : String(sb.idleMinutes)} onChange={v => own('idleMinutes', v === 'never' ? null : Number(v))} /> },
    { section: 'Chats', label: 'Continue at usage limit', hint: 'Claude Code\'s own setting: a chat that hits a limit goes on by itself when it resets. Off, Switchboard sends the continue message instead. Either way the chat comes back.',
      control: <Switch label="Continue at usage limit" on={hub.keep.autoContinue} onChange={next => set('autoContinueAtUsageLimit', next)} /> },
    { section: 'Chats', label: 'Pause near the limit', hint: 'When the 5-hour or weekly limit reaches this %, every chat is told to stop and wait; Switchboard resumes them in order a minute after it resets. Applies to the 5-hour and weekly limits alike. Terminals stay open.',
      control: <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
        <Switch label="Pause near the limit" on={sb.pauseAt !== null} onChange={next => own('pauseAt', pauseValue(next, lastPause))} />
        {sb.pauseAt !== null && <input key={sb.pauseAt ?? 99} type="number" min={50} max={100} className="hub-select" aria-label="Pause chats at %" defaultValue={sb.pauseAt ?? 99} style={{ width: 64, cursor: 'text' }}
          onBlur={e => { const v = Math.round(Number(e.target.value)); if (v >= 50 && v <= 100 && v !== (sb.pauseAt ?? 99)) own('pauseAt', v) }}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />}
        {sb.pauseAt !== null && <span aria-hidden style={{ color: 'var(--hub-ash)' }}>%</span>}
      </span> },
    { section: 'Chats', label: 'Auto-start chats', hint: 'When nothing runs in this window\'s project, a chat starts on the next to-do item. Never while a usage limit is used up or a pause is on.',
      control: <Switch label="Auto-start chats" on={sb.autoStart !== false} onChange={next => own('autoStart', next)} /> },
    { section: 'Chats', label: 'Fix stuck items', hint: 'Something stuck for twice its limit gets Fix once: a quiet subagent is checked on, a stuck job or process is stopped and the chat told. A chat waiting on you is paused instead.',
      control: <Switch label="Fix stuck items" on={sb.autoFix !== false} onChange={next => own('autoFix', next)} /> },
    { section: 'Chats', label: 'Learn automatically', hint: 'Twice a week, under the pause threshold, a background run reviews recent chats and tests rule and role edits; one that beats the old version on held-out cases is applied to claude-mods with an Undo note in the to-do, the rest become to-do proposals. Long chats that end get an after action review. Never commits.',
      control: <Switch label="Learn automatically" on={sb.learn !== false} onChange={next => own('learn', next)} /> },
    { section: 'Chats', label: 'Stop dev servers and close tabs when a chat ends', hint: 'When a chat ends for good, the dev servers and test browsers it started stop too. On macOS the Chrome tabs it opened close once it finishes, ends, or gets the answer that named the page; one you are looking at waits. Never port 3000 or 3131, a chat waiting out a usage limit, or anything another live chat uses.',
      control: <Switch label="Stop dev servers and close tabs when a chat ends" on={sb.stopServers !== false} onChange={next => own('stopServers', next)} /> },
    { section: 'Chats', label: 'Merge worktrees automatically', hint: 'About 2 minutes after a worktree\'s chat ends, its work goes into the branch that repo is on, as uncommitted changes. The repo\'s checks run after each one, and one that breaks them is undone and kept. One missed by that (a reload, a failed check) is tried again after 15 minutes with no new chat. Never commits or pushes. Ship has the same switch per repo.',
      control: <Switch label="Merge worktrees automatically" on={sb.autoMerge !== false} onChange={next => own('autoMerge', next)} /> },
    { section: 'Chats', label: 'Show agent browsers', hint: 'Browsers agents drive through Playwright open in a window you can see. Off runs them headless, so nothing lands on your screen. Applies to chats started after the change.',
      control: <Switch label="Show agent browsers" on={sb.showBrowsers === true} onChange={next => own('showBrowsers', next)} /> },
    { section: 'Chats', label: 'Chat notices', hint: `Done, question, stuck and AWS sign-in notices. System sends them to the Mac or Windows notification center only, where they fade on their own. ${ed} pop-up adds one with a Show button, gone after about 10 seconds once ${ed} has focus. Status bar adds a line there for 20 seconds. The Needs you strip always shows them.`,
      control: <Pick label="Chat notices" options={[['system', 'System'], ['toast', `${ed} pop-up`], ['status', 'Status bar']]} value={sb.notices ?? (sb.toasts === true ? 'toast' : 'system')} onChange={v => own('notices', v)} /> },
    { section: 'Chats', label: 'Where pop-ups show', hint: `Where ${ed} puts every pop-up, from Switchboard and other extensions. Top right keeps them clear of the terminal and chat input.`,
      control: <Pick label="Where pop-ups show" options={NOTICE_SPOTS} value={sb.noticeSpot ?? 'top-right'} onChange={v => own('noticeSpot', v)} /> },
    { section: 'Chats', label: 'Claude chat permissions', hint: 'Bypass runs commands and tools without asking and trusts project MCP servers. Ask brings the approval prompts back. Auto lets a classifier approve each call and block risky ones beyond the task; after 3 blocks in a row it asks you. Applies to chats started or resumed after the change. Chats you reach from the Claude app (Remote Control) pick it up the next time Remote Control restarts.',
      control: <Pick label="Claude chat permissions" options={CLAUDE_MODES} value={sb.claudeMode ?? (sb.askClaude ? 'ask' : 'bypass')} onChange={v => own('claudeMode', v)} /> },
    { section: 'Chats', label: 'Ask before actions (Codex)', hint: 'Codex chats ask before running commands, inside its sandbox. Off runs them without asking or a sandbox. Applies to chats started or resumed after the change.',
      control: <Switch label="Ask before actions (Codex)" on={!!sb.askCodex} onChange={next => own('askCodex', next)} /> },
    { section: 'Chats', label: 'One window', hint: hub.windowTabs?.mac === false ? 'Needs macOS.' : `Every ${ed} window shows as a tab of one window; Merge all, Split all, Show and Pop out sit above the chat list. Quit and reopen ${ed} after changing it. Off puts your old setting back.`,
      control: <Switch label="One window" on={!!sb.oneWindow} onChange={next => own('oneWindow', next)} /> },
    { section: 'Chats', label: 'Keep Switchboard app running', hint: 'Starts this Mac\'s Switchboard page again if it stops, waiting longer each time it keeps crashing. Off leaves it stopped.',
      control: <Switch label="Keep Switchboard app running" on={sb.keepApp !== false} onChange={next => own('keepApp', next)} /> },
    { section: 'Chats', label: 'Test anti-copy hardening (experimental)', hint: 'Tries BLA\'s anti-clone hardening on a copy of your build and tells you if the app still works. Off by default.',
      control: <Switch label="Test anti-copy hardening (experimental)" on={!!sb.hardenBuild} onChange={next => own('hardenBuild', next)} /> },
    { section: 'Chats', label: 'Fresh branch for new chats', hint: 'A chat that continues from a full one starts on its own git branch.',
      control: <Switch label="Fresh branch for new chats" on={hub.keep.freshBranch} onChange={next => send({ type: 'hub-keep', freshBranch: next })} /> },
    { section: 'Chats', label: 'Brief for new chats', hint: 'New chats first read what other chats in the project are doing.',
      control: <Switch label="Brief for new chats" on={sb.brief} onChange={next => own('brief', next)} /> },
    { section: 'Chats', label: 'Phone mode', hint: 'Call me instead of asking in chats: questions, stuck and finished chats, and usage pauses and resumes ring your phone.',
      control: <Switch label="Phone mode" on={sb.phone === true} onChange={next => own('phone', next)} /> },
    { section: 'Chats', label: 'Push to your phone', hint: 'Lets a chat push through the Claude app. Finished chats come through Phone alerts.', control: <Switch label="Push to your phone" on={c.push} onChange={next => set('agentPushNotifEnabled', next)} /> },
    ...(alerts ? [{ section: 'Chats' as const, label: 'Phone alerts', hint: alerts === 'https'
      ? 'Needs HTTPS: turn on HTTPS Certificates on the DNS page of the Tailscale admin console, then open the https link.'
      : alerts === 'hint'
      ? 'On iPhone, tap Share then Add to Home Screen, open Switchboard from there and turn this on.'
      : 'Finished chats and AWS sign-in heads-ups on this device, even with the app closed.',
      control: alerts === 'switch' ? <PhoneAlerts /> : null }] : []),
    { section: 'Chats', label: 'Keep phone access in Apple Notes', hint: 'One private note, "Switchboard access", with the code and links; updated when they change. Off stops updates.',
      control: <Switch label="Keep phone access in Apple Notes" on={sb.accessNote} onChange={next => own('accessNote', next)} /> },
    ...advanced,
    { section: 'Chats', label: 'Notify when a chat needs input', hint: 'Claude Code sends a push to your phone when a chat stops to ask you something.', control: <Switch label="Notify when a chat needs input" on={c.needInput} onChange={next => set('inputNeededNotifEnabled', next)} /> },

    { section: 'Models', label: 'Auto pick per task', hint: 'New chats and To-do Start runs pick their model and effort from the task, and hold xhigh, max and ultracode once the 5h window passes 60%. Off starts the picker on the settings below; you can still pick per chat.',
      control: <Switch label="Auto pick per task" on={sb.autoPick !== false} onChange={next => own('autoPick', next)} /> },
    { section: 'Models', label: 'Lead model', hint: 'The main chat, and every role set to Inherit.',
      control: <Pick label="Lead model" options={MODELS} value={lead} onChange={v => set('model', v === 'default' ? null : v)} /> },
    { section: 'Models', label: 'Lead effort', hint: 'The main chat, and every role set to Inherit.',
      control: <Pick label="Lead effort" options={EFFORTS} value={c.effortLevel ?? 'default'} onChange={v => set('effortLevel', v === 'default' ? null : v)} /> },
    { section: 'Models', label: 'Codex chat model', hint: 'New and resumed Codex chats. Default leaves it to ~/.codex/config.toml.',
      control: codexGate(<Pick label="Codex chat model" options={CODEX_MODELS} value={sb.codexModel ?? 'default'} muted={!sb.codexModel} disabled={noCodex} onChange={v => own('codexModel', v === 'default' ? null : v)} />) },
    { section: 'Models', label: 'Codex chat effort', hint: 'New and resumed Codex chats. Default leaves it to ~/.codex/config.toml.',
      control: codexGate(<Pick label="Codex chat effort" options={CODEX_EFFORTS} value={sb.codexEffort ?? 'default'} muted={!sb.codexEffort} disabled={noCodex} onChange={v => own('codexEffort', v === 'default' ? null : v)} />) },
    { section: 'Models', label: 'Smart model switch', hint: 'When a role keeps redoing the same part, its next run there gets the next model up. Debugging never counts. Off keeps each role on its own model.',
      control: <Switch label="Smart model switch" on={smart} onChange={next => own('smartModelSwitch', next)} /> },
    { section: 'Models', label: 'Codex first', hint: 'While Codex has room and Claude has used more of its week, engineer and code review jobs go to Codex. Off leaves it to each chat.',
      control: codexGate(<Switch label="Codex first" on={sb.codexFirst !== false} onChange={next => own('codexFirst', next)} />) },
    ...hub.installed.filter(i => i.kind === 'role').map((r): Row => {
      if (r.codex) {
        const model = r.codexModel ?? 'default'
        const effort = r.codexEffort ?? 'default'
        const options = CODEX_MODELS.some(o => o[0] === model) ? CODEX_MODELS : [...CODEX_MODELS, [model, model] as [string, string]]
        const pick = (m: string, e: string) => send({ type: 'hub-role-codex', role: r.name, model: m as CodexModel, effort: e as CodexEffort })
        return { section: 'Models', group: 'roles', label: r.name, hint: noCodex ? 'Needs Codex, which is not installed.' : 'Runs on Codex; the Claude relay stays on Sonnet.',
          control: codexGate(<span className="hub-set-ctl">
            <Pick label={`${r.name} Codex model`} options={options} value={model} muted={model === 'default'} disabled={noCodex} onChange={v => { if (v !== model) pick(v, effort) }} />
            <Pick label={`${r.name} Codex effort`} options={CODEX_EFFORTS} value={effort} muted={effort === 'default'} disabled={noCodex} onChange={v => { if (v !== effort) pick(model, v) }} />
          </span>) }
      }
      const value = r.model && r.model !== 'inherit' ? r.model : 'inherit'
      const options: Array<[string, string]> = [['inherit', `Inherit (${lead})`], ...ROLE_MODELS]
      // A full model id in the file shows as its own option.
      if (!options.some(o => o[0] === value)) options.push([value, value])
      const pick = <Pick label={`${r.name} model`} options={options} value={value} muted={value === 'inherit'} onChange={v => { if (v !== value) send({ type: 'hub-role-model', role: r.name, model: v as RoleModel }) }} />
      // A raise rides in the role's own row, with Reset beside the pick.
      const up = raises[r.name]
      return { section: 'Models', group: 'roles', label: r.name, hint: up && `R${raiseLine(up).slice(r.name.length + 2)}, from ${up.from}.`,
        control: up ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><button type="button" className="hub-link hub-reset" aria-label={`Reset ${r.name} to its own model`} onClick={() => send({ type: 'hub-escalation-reset', project: up.project, role: up.role, files: up.files })}>Reset</button>{pick}</span> : pick }
    }),
    // folder: the project the To-do and Jev card follow; no project, no button.
    ...(folder ? [{ section: 'Models', group: 'tail', label: 'Test models', hint: 'Runs each role on every model and suggests the best value.',
      control: <button type="button" className="hub-btn" onClick={() => send({ type: 'hub-new-chat', path: folder, text: benchPrompt, remote: false })}>Test models</button> }] satisfies Row[] : []),

    { section: 'Integrations', label: 'Hooks', hint: 'Claude Code reports each chat\'s progress to Switchboard. Off removes the hooks from ~/.claude/settings.json.',
      control: <Switch label="Hooks" on={sb.hooks} onChange={next => own('hooks', next)} /> },
    { section: 'Integrations', label: 'Status bar button', hint: `The Switchboard button in ${ed}'s status bar.`,
      control: <Switch label="Status bar button" on={sb.statusBar} onChange={next => own('statusBar', next)} /> },
    { section: 'Integrations', label: 'Status line', hint: hub.controls.statusLineReady ? 'One row under each chat in the terminal: model, context used, the 5 hour and weekly limits, cost and branch.' : 'Needs claude-mods/kit/statusline.mjs.',
      control: hub.controls.statusLineReady ? <Switch label="Status line" on={c.statusLine} onChange={next => set('statusLine', next)} /> : <span style={{ color: 'var(--hub-ash)', fontSize: 12 }}>Not set up</span> },
    { section: 'Integrations', label: 'Sync rules and roles', hint: `${hub.controls.rulesNote ?? 'Not synced yet'}. Writes ~/.claude/CLAUDE.md, ~/.codex/AGENTS.md and ~/.claude/agents; files you edited are kept.`,
      control: (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <button type="button" className="hub-link" onClick={() => send({ type: 'hub-rules-sync' })}>Sync now</button>
          <Switch label="Sync rules and roles" on={sb.syncRules} onChange={next => own('syncRules', next)} />
        </span>
      ) },
    { section: 'Integrations', label: 'Remote Control at startup', hint: 'Lets the Claude app reach new chats.', control: <Switch label="Remote Control at startup" on={hub.rc.atStartup} onChange={on => send({ type: 'hub-rc', on })} /> },
    ...hub.rcServers.map((r): Row => ({ section: 'Integrations', label: `Remote Control server: ${r.name}`, hint: `Chats you start from the Claude app begin in ${r.folder.replace(/^\/Users\/[^/]+/, '~')} and can work in any repo under it.`,
      control: <Switch label={`Remote Control server: ${r.name}`} on={r.on} onChange={on => send({ type: 'hub-rc-server', folder: r.folder, on })} /> })),
  ]

  const lists = gearRows(hub, query)
  const shown = [coderRow, ...(coder ? rows : rows.filter(r => SIMPLE_ROWS.includes(r.label)))]
  const hits = query ? shown.filter(row => `${row.label} ${row.hint ?? ''} ${row.section}`.toLowerCase().includes(query)) : []
  const blocks = blockHits(query)
  const listHits = query ? lists.filter(l => l.match) : []

  const installed = (only = lists) => (
    <div style={{ display: 'grid' }}>
      {only.map(l => (
        // Remounts open while searching, so every hit shows.
        <details key={`${l.label}:${query ? 'q' : ''}`} open={query ? true : undefined} className="hub-fold-list">
          <summary>
            <b aria-hidden>›</b>
            <span style={{ flex: 1, minWidth: 0, color: 'var(--hub-ink)' }}>{l.label}</span>
            <span style={{ font: '400 12px/1 var(--hub-mono)', color: 'var(--hub-ash)' }}>{l.names.length}</span>
          </summary>
          {l.names.length
            ? <ul role="list" className="hub-names">{l.names.map((n, i) => <li key={n} title={l.tips[i] ? `${n}: ${l.tips[i]}` : n}>{n}</li>)}</ul>
            : <p style={{ margin: '0 0 10px 22px', fontSize: 12, color: 'var(--hub-ash)' }}>None</p>}
        </details>
      ))}
    </div>
  )

  const body = (s: Section) => {
    if (s === 'Accounts') return <SignIns hub={hub} send={send} problem={problem} />
    if (s === 'Installed') return (
      <>
        <Line row={{ section: 'Installed', label: 'Set up', hint: 'Installs the plugins, mods, MCP servers, rules and roles Switchboard works with. Skips what you have.',
          control: <button type="button" className="hub-btn" onClick={() => send({ type: 'hub-setup' })}>Set up</button> }} />
        <Line row={{ section: 'Installed', label: 'Export kit', hint: 'Roles, skills, plugins and mods as one folder you can copy to another Mac.',
          control: <button type="button" className="hub-btn" onClick={() => send({ type: 'hub-kit-export' })}>Export</button> }} />
        <Line row={{ section: 'Installed', label: 'Sync', hint: hub.sync?.on
          ? `Signed in as ${hub.sync.login ?? 'GitHub'}, last sync ${hub.sync.last ? syncAgo(hub.sync.last) : 'never'}${hub.sync.note ? `. ${hub.sync.note}` : ''}`
          : 'Sign in with GitHub to keep memory, the vault and settings the same on every computer.',
          control: hub.sync?.on
            ? <><button type="button" className="hub-btn" disabled={hub.sync.busy} onClick={() => send({ type: 'hub-sync-now' })}>{hub.sync.busy ? 'Syncing' : 'Sync now'}</button> <button type="button" className="hub-btn" onClick={() => send({ type: 'hub-sync-off' })}>Turn off</button></>
            : <button type="button" className="hub-btn" onClick={() => send({ type: 'hub-sync-sign-in' })}>Sign in</button> }} />
        <Sweep hub={hub} send={send} />
        <ToolPrecedence hub={hub} send={send} />
        <h4 style={sub}>Installed</h4>
        {installed()}
      </>
    )
    const all = shown.filter(r => r !== coderRow && r.section === s), mine = all.filter(r => !r.group), grouped = all.filter(r => r.group === 'advanced'), roles = all.filter(r => r.group === 'roles')
    if (s === 'Chats') return (
      <>
        <Line row={coderRow} />
        {chatGroups(mine).map(([head, rs]) => <Fragment key={head}><h4 style={sub}>{head}</h4>{rs.map(r => <Line key={r.label} row={r} />)}</Fragment>)}
        {grouped.length > 0 && <>
          <h4 style={sub}>Advanced mode</h4>
          <p style={{ margin: '0 0 4px', fontSize: 12, lineHeight: 1.45, color: 'var(--hub-ash)' }}>{ADVANCED_HINT} Per project.</p>
          {grouped.map(r => <Line key={r.label} row={r} />)}
        </>}
      </>
    )
    if (s !== 'Models') return (
      <>
        {mine.map(r => <Line key={r.label} row={r} />)}
        {grouped.length > 0 && <>
          <h4 style={sub}>Advanced mode</h4>
          <p style={{ margin: '0 0 4px', fontSize: 12, lineHeight: 1.45, color: 'var(--hub-ash)' }}>{ADVANCED_HINT} Per project.</p>
          {grouped.map(r => <Line key={r.label} row={r} />)}
        </>}
      </>
    )
    return (
      <>
        {mine.map(r => <Line key={r.label} row={r} />)}
        {roles.length > 0 && <h4 style={sub}>Roles</h4>}
        {roles.map(r => <Line key={r.label} row={r} />)}
        {all.filter(r => r.group === 'tail').map(r => <Line key={r.label} row={r} />)}
      </>
    )
  }

  return (
    <section aria-label="Settings" className="hub-settings">
      <nav aria-label="Settings sections" className="hub-set-nav">
        <input type="search" className="hub-search" aria-label="Find a setting" placeholder="Find a setting" value={q} onChange={e => setQ(e.target.value)} />
        <div>
          {sections.map(s => (
            <button key={s} type="button" aria-current={!query && pane === s ? 'page' : undefined} onClick={() => { setAt(s); setQ('') }}>{s}</button>
          ))}
        </div>
      </nav>
      <div role="region" aria-label={query ? 'Search results' : pane} className="hub-set-panel" style={{ minWidth: 0 }}>
        {query
          ? <>
              {hits.map(r => <Line key={r.label} row={r} pane={r.section} />)}
              {blocks.map(b => <Line key={b.label} row={{ section: b.to ?? 'Chats', label: b.label, hint: b.hint,
                control: b.to ? <button type="button" className="hub-btn" onClick={() => { setAt(b.to!); setQ('') }}>Open</button> : null }} />)}
              {listHits.length > 0 && <><h4 style={sub}>Installed</h4>{installed(listHits)}</>}
              {!hits.length && !blocks.length && !listHits.length && <p style={{ color: 'var(--hub-ash)', margin: '8px 0' }}>Nothing matches.</p>}
            </>
          : body(pane)}
        {!query && pane === 'Integrations' && !!hub.spend?.length && <p style={{ color: 'var(--hub-ash)', margin: '16px 0 0', fontSize: 13 }}>Spend limits for paid tools are on <a href="#usage" className="hub-link">Usage</a>.</p>}
        {!query && coder && pane === 'Chats' && <Health hub={hub} send={send} />}
        <details className="hub-fold-list" style={{ marginTop: 16 }}
          onToggle={e => { const d = e.currentTarget; if (d.open) requestAnimationFrame(() => d.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })) }}>
          <summary>
            <b aria-hidden>›</b>
            <span style={{ flex: 1, minWidth: 0, color: 'var(--hub-ink)' }}>About and credits</span>
          </summary>
          <div style={{ margin: '0 0 10px 22px' }}><Credits /></div>
        </details>
      </div>
    </section>
  )
}
