'use client'

/**
 * Accounts. This project's picks first, then the saved AWS profiles, web logins and API keys, then other projects.
 * Every account row: name and state on the left, one action and a more menu on the right, "Opens in" under it.
 * The extension checks names, regions and URLs again; this panel only keeps obvious typos from being sent.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { ApiKey, AwsProfile, ChatRow, HubState, WebApp, WebLogin } from '@/lib/hub-types'
import { vscodeBridge, type HubCommand } from '@/lib/vscode-bridge'
import { projectName } from '@/lib/archive'
import { focusBack } from '@/lib/focus-back'
import { repoOf } from './look'
import { Pick } from './gear'
import './sign-ins.css'

type Send = (c: HubCommand) => void
type Problem = { text: string; at: number } | null

const NAME = /^[A-Za-z0-9._@+-]{1,64}$/
const REGION = /^[a-z]{2}(-[a-z]+)+-\d{1,2}$/
const URL_OK = /^https?:\/\/[^\s/@]+(\/\S*)?$/
const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
const home = (p: string) => p.replace(/^\/Users\/[^/]+/, '~')
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const named = (a: AwsProfile) => (a.label ? `${a.label} (${a.name})` : a.name)

// An older extension sends no stale flag.
const stale = (p: AwsProfile) => p.stale ?? p.name.startsWith('previous-default-')

/** The profile picked for the deepest project folder holding cwd; the extension's profileFor in aws.ts. */
export function profileFor(projects: Record<string, string>, cwd: string): string | undefined {
  const c = norm(cwd)
  const hit = Object.keys(projects).filter(k => c === norm(k) || c.startsWith(`${norm(k)}/`)).sort((a, b) => b.length - a.length)[0]
  return hit ? projects[hit] : undefined
}

/** This window's project browser, which sign-ins with no Chrome pick of their own use. */
const projectBrowser = (hub: HubState) => {
  const w = hub.signIns?.window ?? hub.thisWindow
  return w ? profileFor(hub.signIns?.browsers ?? {}, w) || undefined : undefined
}

type Tone = 'green' | 'yellow' | 'red' | 'ash'
function Chip({ tone, text }: { tone: Tone; text: string }) {
  const soft = tone === 'ash' ? 'transparent' : `var(--hub-${tone}-soft)`
  return <span className="hub-chip" style={{ color: `var(--hub-${tone === 'ash' ? 'mute' : tone})`, background: soft, boxShadow: tone === 'ash' ? 'inset 0 0 0 1px var(--hub-hair)' : 'none' }}><i aria-hidden />{text}</span>
}

const timeLeft = (ms: number) => ms >= 3_600_000 ? `${Math.floor(ms / 3_600_000)} h ${Math.floor((ms % 3_600_000) / 60_000)} min` : `${Math.max(1, Math.round(ms / 60_000))} min`
/** Up to when an aws login session lasts: AWS caps it at 12 h, an IAM principal can have less. */
const ends = (p: AwsProfile) => (p.status === 'signed-in' && p.expiresAt && p.expiresAt > Date.now() ? `Session ends in ${timeLeft(p.expiresAt - Date.now())} at most` : undefined)

/** One chip per profile: Failed wins over a dead session, under an hour left reads as Ends in. */
function AwsState({ p, failed }: { p: AwsProfile; failed?: string }) {
  if (failed && p.status !== 'signed-in') return <Chip tone="red" text="Failed" />
  if (p.status === 'expired') return <Chip tone="yellow" text="Expired" />
  if (p.status === 'never') return <Chip tone="ash" text="Not signed in" />
  const left = p.expiresAt ? p.expiresAt - Date.now() : Infinity
  return left < 3_600_000 && left > 0 ? <Chip tone="yellow" text={`Ends in ${timeLeft(left)}`} /> : <Chip tone="green" text="Signed in" />
}

/** A sign-in's last failure, as the CLI or Chrome said it. */
function Failed({ text }: { text?: string }) {
  if (!text) return null
  return <span role="alert" className="si-err">Last sign-in failed: {text}</span>
}

/** Where a sign-in went instead of a Chrome profile that was deleted. */
function Note({ text }: { text?: string }) {
  return text ? <span className="si-note">{text}</span> : null
}

// '' is Chrome's last used profile; a sign-in with no pick of its own falls back to the project's browser first.
const LAST_USED = 'Chrome, last used profile'
const chromeName = (hub: HubState, dir?: string) => {
  const c = dir ? hub.signIns?.chrome.find(x => x.dir === dir) : undefined
  return c ? `Chrome: ${c.name}` : LAST_USED
}
const profiles = (hub: HubState): Array<[string, string]> => (hub.signIns?.chrome ?? []).map(c => [c.dir, `Chrome: ${c.name}`])

/** Opens in [Chrome profile]: the same control on every account. fallback: the project's browser, used for ''. */
function Opens({ hub, value, onChange, label, fallback }: { hub: HubState; value: string; onChange: (v: string) => void; label: string; fallback?: string }) {
  const chrome = hub.signIns?.chrome ?? []
  if (!chrome.length) return null
  const email = chrome.find(c => c.dir === (value || fallback))?.email
  return (
    <label className="si-opens">
      <span>Opens in</span>
      <select aria-label={label} title={email} value={value} onChange={e => onChange(e.target.value)}>
        <option value="">{fallback ? `Project browser (${chromeName(hub, fallback)})` : LAST_USED}</option>
        {profiles(hub).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select>
    </label>
  )
}

type Item = { label: string; run: () => void; hint?: string; danger?: boolean }
/** Secondary actions behind a more button; arrows move, Escape closes. Same keys as ChatMenu. */
function More({ name, items }: { name: string; items: Item[] }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const wrap = useRef<HTMLSpanElement>(null), btn = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    wrap.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    const down = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', down)
    return () => document.removeEventListener('pointerdown', down)
  }, [open])
  if (!items.length) return null
  const key = (e: KeyboardEvent) => {
    const all = [...(wrap.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    const at = all.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'Escape' && open) { e.preventDefault(); setOpen(false); btn.current?.focus() }
    else if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); all[(at + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus() }
    else if (e.key === 'Tab') setOpen(false)
  }
  return (
    <span ref={wrap} className="hub-more" data-open={open || undefined} onKeyDown={key}>
      <button ref={btn} type="button" className="hub-more-btn" aria-haspopup="menu" aria-expanded={open} aria-controls={id} aria-label={`More for ${name}`} title="More" onClick={() => setOpen(!open)}>
        <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><circle cx="3.5" cy="8" r="1.4" /><circle cx="8" cy="8" r="1.4" /><circle cx="12.5" cy="8" r="1.4" /></svg>
      </button>
      {open && (
        <span id={id} role="menu" aria-label={`Actions for ${name}`} className="hub-menu">
          {items.map(it => (
            <button key={it.label} type="button" role="menuitem" tabIndex={-1} title={it.hint} className={it.danger ? 'si-danger' : undefined}
              onClick={() => { setOpen(false); btn.current?.focus(); it.run() }}>{it.label}</button>
          ))}
        </span>
      )}
    </span>
  )
}

/** Delete, asked once more inline before it is sent. */
function Confirm({ what, note, onYes, onNo }: { what: string; note: string; onYes: () => void; onNo: () => void }) {
  const box = useRef<HTMLSpanElement>(null)
  const no = () => { focusBack(box.current); onNo() }
  return (
    <span ref={box} role="group" aria-label={`Delete ${what}?`} className="si-confirm" onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); no() } }}>
      <span>Delete {what}? {note}</span>
      <button type="button" className="hub-btn danger" onClick={onYes}>Yes, delete</button>
      <button type="button" className="hub-btn" autoFocus onClick={no}>Cancel</button>
    </span>
  )
}

/** A name edited in place: Enter saves, Escape puts it back. */
function Rename({ value, label, onSave, onDone }: { value: string; label: string; onSave: (v: string) => void; onDone: () => void }) {
  const [v, setV] = useState(value)
  const form = useRef<HTMLFormElement>(null)
  const done = () => { focusBack(form.current); onDone() }
  return (
    <form ref={form} className="si-rename" onSubmit={e => { e.preventDefault(); onSave(v); done() }}>
      <input autoFocus aria-label={label} value={v} maxLength={80} onChange={e => setV(e.target.value)} placeholder="Display name"
        onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); done() } }} />
      <button type="submit" className="hub-btn">Save</button>
    </form>
  )
}

/** A folded add form under a list. */
function Add({ title, open, children }: { title: string; open?: boolean; children: ReactNode }) {
  return (
    <details className="hub-fold-list" open={open}>
      <summary><b aria-hidden>›</b><span style={{ flex: 1, color: 'var(--hub-ink)' }}>{title}</span></summary>
      {children}
    </details>
  )
}

/** Picks for one folder: where its sign-ins open, its AWS profile (only this window's can change) and the login per web app. */
function Uses({ hub, send, folder, here }: { hub: HubState; send: Send; folder: string; here: boolean }) {
  const si = hub.signIns
  const uses = si?.links?.[folder] ?? {}
  const repo = repoOf(folder)
  const profile = profileFor(si?.projects ?? {}, folder)
  const p = hub.aws.find(a => a.name === (profile ?? 'default'))
  const def = hub.aws.find(a => a.isDefault)
  // The browser picked here, for the profile it was picked for.
  const [pick, setPick] = useState<{ name: string; dir: string }>()
  const chrome = pick && pick.name === p?.name ? pick.dir : p?.chrome ?? ''
  const setChrome = (dir: string) => p && setPick({ name: p.name, dir })
  const awsOptions: Array<[string, string]> = [['', `Default${def ? `: ${def.label || def.name}` : ''}`], ...hub.aws.filter(a => a.name === profile || (!stale(a) && !(a.isDefault && a.name === 'default'))).map((a): [string, string] => [a.name, named(a)])]
  const link = (app: string, v: string) => send({ type: 'hub-login-link', folder, app, login: v === 'off' ? 'off' : v || null })
  // undefined: no project pick; '' Chrome's last used profile.
  const browser = profileFor(si?.browsers ?? {}, folder)
  const [picks, setPicks] = useState<Record<string, string>>({})
  const browserOptions: Array<[string, string]> = [['unset', 'Each account\'s own pick'], ['', LAST_USED], ...profiles(hub)]
  const awsErr = p ? si?.errors?.[`aws:${p.name}`] : undefined
  return (
    <ul role="list" className="si-list">
      <li className="si-row">
        <span className="si-main">
          <span className="si-title"><strong>Opens in</strong></span>
          <span className="si-note">{browser === undefined
            ? 'No project pick: each account opens where it was saved.'
            : `Accounts without their own pick${here ? ', and aws login or gh auth login in this project\'s terminals,' : ''} open here.`}</span>
        </span>
        <span className="si-acts">
          <Pick label={`Browser for ${repo}`} options={browserOptions} value={browser ?? 'unset'} muted={browser === undefined}
            onChange={v => send({ type: 'hub-browser', folder, chrome: v === 'unset' ? null : v })} />
        </span>
      </li>
      <li className="si-row">
        <span className="si-main">
          <span className="si-title"><strong>AWS</strong>{p && <AwsState p={p} failed={awsErr} />}</span>
          <span className="si-note">{here ? `New terminals get ${profile ? `AWS_PROFILE=${profile}` : 'no AWS_PROFILE, so the default'}.` : `Open ${repo} in VS Code to change.`}</span>
          {here && p && ends(p) && <span className="si-note">{ends(p)}</span>}
          {here && p && <Opens hub={hub} value={chrome} onChange={setChrome} fallback={browser} label={`This project: opens in for ${p.name}`} />}
          {here && <Failed text={awsErr} />}
          {here && p && <Note text={si?.notes?.[`aws:${p.name}`]} />}
        </span>
        <span className="si-acts">
          {here
            ? <Pick label={`AWS profile for ${repo}`} options={awsOptions} value={profile ?? ''} muted={!profile} onChange={v => send({ type: 'hub-aws-window', profile: v || null })} />
            : <span className="si-meta" style={{ color: 'var(--hub-body)' }}>{profile ?? 'Default'}</span>}
          {here && p && <button type="button" className={`hub-btn${p.status === 'signed-in' ? '' : ' primary'}`} onClick={() => send({ type: 'hub-aws-login', profile: p.name, chrome })}>{p.status === 'signed-in' ? 'Sign in again' : 'Sign in'}</button>}
        </span>
      </li>
      {(si?.apps ?? []).map(app => {
        const on = app.id in uses
        const chosen = uses[app.id] ?? null
        const active = app.logins.find(l => l.id === app.active)
        const l = app.logins.find(x => x.id === (chosen ?? app.active))
        const err = on && l ? si?.errors?.[`login:${app.id}:${l.id}`] : undefined
        return (
          <li key={app.id} className="si-row">
            <span className="si-main">
              <span className="si-title"><strong>{app.name}</strong>{err && <Chip tone="red" text="Failed" />}</span>
              {(!on || !l) && <span className="si-note">{!on ? 'Not used here' : 'No saved logins yet'}</span>}
              {on && l && <Opens hub={hub} value={picks[l.id] ?? l.chrome ?? ''} onChange={v => setPicks(x => ({ ...x, [l.id]: v }))} fallback={browser} label={`This project: opens in for ${app.name} ${l.label}`} />}
              <Failed text={err} />
              {on && l && <Note text={si?.notes?.[`login:${app.id}:${l.id}`]} />}
            </span>
            <span className="si-acts">
              <Pick label={`${app.name} login for ${repo}`} muted={!on} value={on ? chosen ?? '' : 'off'} onChange={v => link(app.id, v)}
                options={[['off', 'Not used'], ['', `Default${active ? `: ${active.label}` : ''}`], ...app.logins.map((x): [string, string] => [x.id, x.label])]} />
              {on && l && <button type="button" className="hub-btn" onClick={() => send({ type: 'hub-login-open', app: app.id, id: l.id, folder, ...(picks[l.id] !== undefined ? { chrome: picks[l.id] } : {}) })}>Sign in</button>}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

function ThisProject({ hub, send }: { hub: HubState; send: Send }) {
  const si = hub.signIns
  const here = si?.window ?? hub.thisWindow
  return (
    <section aria-labelledby="si-this" className="si-sec">
      <header><h3 id="si-this">This project</h3></header>
      <p className="si-help">Which accounts this project's chats and terminals use, and where their sign-ins open.</p>
      {here
        ? <div className="si-card">
            <header><strong title={here}>{repoOf(here)}</strong><span title={here}>{home(here)}</span></header>
            <Uses hub={hub} send={send} folder={here} here={!!si?.window && norm(si.window) === norm(here)} />
          </div>
        : <p className="si-empty">Open a project folder in this window to pick its accounts.</p>}
    </section>
  )
}

function Others({ hub, send }: { hub: HubState; send: Send }) {
  const si = hub.signIns
  const here = si?.window ?? hub.thisWindow
  const seen = new Set<string>()
  // Only folders hub-login-link accepts: this window's and the project list.
  const others = hub.projects.map(p => p.path)
    .filter(f => norm(f) !== norm(here ?? '') && !seen.has(norm(f)) && !!seen.add(norm(f)))
  if (!others.length) return null
  const sum = (f: string) => {
    const uses = si?.links?.[f] ?? {}
    const apps = (si?.apps ?? []).filter(a => a.id in uses).map(a => {
      const id = uses[a.id] ?? a.active
      return `${a.name}: ${a.logins.find(l => l.id === id)?.label ?? 'default'}`
    })
    return [`AWS: ${profileFor(si?.projects ?? {}, f) ?? 'default'}`, ...apps].join(', ')
  }
  return (
    <section aria-labelledby="si-others" className="si-sec">
      <header><h3 id="si-others">Other projects</h3></header>
      <p className="si-help">Their browser and web logins can change here. Their AWS profile changes from a VS Code window on that project.</p>
      {others.map(f => (
        <details key={f} className="hub-fold-list si-other">
          <summary>
            <b aria-hidden>›</b>
            <span style={{ color: 'var(--hub-ink)', flex: '0 0 auto' }}>{repoOf(f)}</span>
            <span>{sum(f)}</span>
          </summary>
          <div style={{ marginLeft: 22 }}><Uses hub={hub} send={send} folder={f} here={false} /></div>
        </details>
      ))}
    </section>
  )
}

function Profile({ p, hub, send, users, askedAt, onDelete, problem }: { p: AwsProfile; hub: HubState; send: Send; users: ChatRow[]; askedAt?: number; onDelete: () => void; problem: Problem }) {
  const [renaming, setRenaming] = useState(false)
  const [asking, setAsking] = useState(false)
  const [chrome, setChrome] = useState(p.chrome ?? '')
  const [late, setLate] = useState(false)
  // A delete that worked drops this row; one still here after a moment was refused.
  useEffect(() => {
    setLate(false)
    if (!askedAt) return
    const t = setTimeout(() => setLate(true), 2500)
    return () => clearTimeout(t)
  }, [askedAt])
  const why = askedAt && problem && problem.at >= askedAt && problem.text.startsWith('aws-delete failed') && problem.text.includes(p.name)
    ? problem.text.replace(/^aws-delete failed: /, '') : undefined
  const refused = why ?? (late ? 'Not deleted. VS Code shows why in its notifications.' : undefined)
  const old = stale(p)
  const err = old ? undefined : hub.signIns?.errors?.[`aws:${p.name}`]
  const detail = [p.label ? p.name : '', p.account, p.region].filter(Boolean).join(' · ')
  const items: Item[] = [
    ...(!old && !p.isDefault ? [{ label: 'Make default', hint: '[default] takes this profile\'s settings; the old default is kept as a backup', run: () => send({ type: 'hub-aws-default', profile: p.name }) }] : []),
    ...(!old ? [{ label: 'Rename', run: () => setRenaming(true) }] : []),
    ...(!p.isDefault ? [{ label: 'Delete', danger: true, run: () => setAsking(true) }] : []),
  ]
  return (
    <li className="si-row">
      <span className="si-main">
        <span className="si-title">
          {renaming
            ? <Rename value={p.label ?? ''} label={`Name for ${p.name}`} onSave={label => send({ type: 'hub-aws-label', profile: p.name, label })} onDone={() => setRenaming(false)} />
            : <strong title={p.label || p.name}>{p.label || p.name}</strong>}
          {p.isDefault && <span className="hub-chip" style={{ color: 'var(--hub-blue)', background: 'var(--hub-blue-soft)' }}>Default</span>}
          {p.root && <span className="hub-chip ver" title="Signs in as the account root">Root</span>}
          {!old && <AwsState p={p} failed={err} />}
        </span>
        {detail && <span title={detail} className="si-meta">{detail}</span>}
        {!old && ends(p) && <span className="si-note">{ends(p)}</span>}
        {users.length > 0 && <span className="si-note">Used by {users.map(c => c.name || projectName(c)).join(', ')}</span>}
        {!old && <Opens hub={hub} value={chrome} onChange={setChrome} fallback={projectBrowser(hub)} label={`Browser for signing in to ${p.name}`} />}
        <Failed text={err} />
        {!old && <Note text={hub.signIns?.notes?.[`aws:${p.name}`]} />}
        {refused && <span role="alert" className="si-err">{refused}</span>}
      </span>
      <span className="si-acts">
        {!old && <button type="button" className={`hub-btn${p.status === 'signed-in' ? '' : ' primary'}`} onClick={() => send({ type: 'hub-aws-login', profile: p.name, chrome })}>
          {p.status === 'never' ? 'Sign in' : 'Sign in again'}
        </button>}
        <More name={named(p)} items={items} />
      </span>
      {asking && <Confirm what={p.name} note="~/.aws/config is backed up first." onYes={() => { setAsking(false); onDelete() }} onNo={() => setAsking(false)} />}
    </li>
  )
}

function Aws({ hub, send, problem }: { hub: HubState; send: Send; problem: Problem }) {
  const [name, setName] = useState('')
  const [region, setRegion] = useState('us-west-1')
  const [chrome, setChrome] = useState('')
  const [asked, setAsked] = useState<Record<string, number>>({})
  const [askAll, setAskAll] = useState(false)
  const projects = hub.signIns?.projects ?? {}
  const bad = (name && !NAME.test(name)) || (region && !REGION.test(region))
  const taken = hub.aws.some(a => a.name === name)
  const live = hub.chats.filter(c => c.live)
  const del = (names: string[]) => {
    const at = Date.now()
    setAsked(a => ({ ...a, ...Object.fromEntries(names.map(n => [n, at])) }))
    for (const n of names) send({ type: 'hub-aws-delete', profile: n })
  }
  const item = (p: AwsProfile) => <Profile key={`${p.name}:${p.chrome ?? ''}`} p={p} hub={hub} send={send} problem={problem}
    askedAt={asked[p.name]} onDelete={() => del([p.name])}
    users={live.filter(c => (profileFor(projects, c.cwd) ?? 'default') === p.name)} />
  const old = hub.aws.filter(stale)
  const current = hub.aws.filter(p => !stale(p))
  return (
    <section aria-labelledby="si-aws" className="si-sec">
      <header>
        <h3 id="si-aws">AWS profiles{current.length > 0 && <small>{current.length}</small>}</h3>
        <button type="button" className="hub-link" onClick={() => send({ type: 'hub-aws-check' })}>Check now</button>
      </header>
      <p className="si-help">
        From ~/.aws/config. Sign in runs aws login in the Chrome profile shown.
        {hub.aws.some(p => p.root) && ' Root sign-ins end when AWS says so; an IAM user with SignInLocalDevelopmentAccess stays signed in up to 12 hours.'}
      </p>
      {current.length
        ? <ul role="list" className="si-list">{current.map(item)}</ul>
        : <p className="si-empty">No profiles in ~/.aws/config yet. Add one and Switchboard signs you in.</p>}
      {old.length > 0 && (
        <details className="hub-fold-list">
          <summary><b aria-hidden>›</b><span style={{ flex: 1, minWidth: 0, color: 'var(--hub-ink)' }}>Backups of old defaults</span><span style={{ font: '400 12px/1 var(--hub-mono)', color: 'var(--hub-mute)' }}>{old.length}</span></summary>
          <div style={{ marginLeft: 22, display: 'grid' }}>
            <div className="si-row" style={{ borderTop: 0, paddingTop: 0 }}>
              <p className="si-note" style={{ margin: 0 }}>Kept when another profile became the default.</p>
              <span className="si-acts">{!askAll && <button type="button" className="hub-btn" onClick={() => setAskAll(true)}>Delete all backups</button>}</span>
              {askAll && <Confirm what={plural(old.length, 'backup')} note="~/.aws/config is backed up first." onYes={() => { setAskAll(false); del(old.map(p => p.name)) }} onNo={() => setAskAll(false)} />}
            </div>
            <ul role="list" className="si-list">{old.map(item)}</ul>
          </div>
        </details>
      )}
      <Add title="Add profile" open={!hub.aws.length || undefined}>
        <form className="si-form" onSubmit={e => { e.preventDefault(); if (name && !bad && !taken) { send({ type: 'hub-aws-add', profile: name, region, chrome }); setName('') } }}>
          <input aria-label="New profile name" placeholder="Profile name" value={name} maxLength={64} onChange={e => setName(e.target.value.trim())} style={{ flex: '2 1 140px' }} />
          <input aria-label="Region" placeholder="us-west-1" value={region} onChange={e => setRegion(e.target.value.trim())} style={{ flex: '1 1 100px' }} />
          <button type="submit" className="hub-btn primary" disabled={!name || !!bad || taken}>Add and sign in</button>
          <span className="si-wide"><Opens hub={hub} value={chrome} onChange={setChrome} fallback={projectBrowser(hub)} label="Browser for the new profile's sign-in" /></span>
          {(bad || taken) && <span role="alert" className="si-err si-wide">
            {taken ? `${name} already exists.` : 'Names use letters, digits and . _ @ + - (up to 64). Regions look like us-west-1.'}
          </span>}
        </form>
      </Add>
    </section>
  )
}

function Login({ app, l, hub, send }: { app: WebApp; l: WebLogin; hub: HubState; send: Send }) {
  const [renaming, setRenaming] = useState(false)
  const [asking, setAsking] = useState(false)
  const [chrome, setChrome] = useState(l.chrome ?? '')
  const ids = { app: app.id, id: l.id }
  const active = app.active === l.id
  const err = hub.signIns?.errors?.[`login:${app.id}:${l.id}`]
  const items: Item[] = [
    ...(!active ? [{ label: 'Make default', hint: `Projects that use ${app.name} without a pick get this login`, run: () => send({ type: 'hub-login-active', ...ids }) }] : []),
    { label: 'Rename', run: () => setRenaming(true) },
    { label: 'Delete', danger: true, run: () => setAsking(true) },
  ]
  return (
    <li className="si-row">
      <span className="si-main">
        <span className="si-title">
          {renaming
            ? <Rename value={l.label} label={`Name for ${l.label}`} onSave={label => send({ type: 'hub-login-rename', ...ids, label })} onDone={() => setRenaming(false)} />
            : <strong title={l.label}>{l.label}</strong>}
          {active && <span className="hub-chip" style={{ color: 'var(--hub-blue)', background: 'var(--hub-blue-soft)' }}>Default</span>}
          {err && <Chip tone="red" text="Failed" />}
        </span>
        <span title={l.url} className="si-meta">{l.url}</span>
        <Opens hub={hub} value={chrome} onChange={setChrome} fallback={projectBrowser(hub)} label={`Browser for ${l.label}`} />
        <Failed text={err} />
        <Note text={hub.signIns?.notes?.[`login:${app.id}:${l.id}`]} />
      </span>
      <span className="si-acts">
        <button type="button" className="hub-btn" onClick={() => send({ type: 'hub-login-open', ...ids, chrome })}>Sign in</button>
        <More name={`${app.name} ${l.label}`} items={items} />
      </span>
      {asking && <Confirm what={l.label} note="Only the saved entry goes." onYes={() => { setAsking(false); send({ type: 'hub-login-delete', ...ids }) }} onNo={() => setAsking(false)} />}
    </li>
  )
}

/** One web app: its saved logins and a folded form for another. */
function App({ app, hub, send }: { app: WebApp; hub: HubState; send: Send }) {
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState(app.url)
  const [chrome, setChrome] = useState('')
  const [asking, setAsking] = useState(false)
  const bad = !!url && !URL_OK.test(url)
  const n = app.logins.length
  return (
    <div role="group" aria-label={app.name} className="si-app">
      <header>
        <h4 title={app.name}>{app.name}<small>{n}</small></h4>
        <More name={app.name} items={[{ label: 'Delete app', danger: true, run: () => setAsking(true) }]} />
      </header>
      {asking && <div className="si-row" style={{ borderTop: 0, paddingTop: 0 }}>
        <Confirm what={app.name} note={n ? `Its ${plural(n, 'saved login')} ${n === 1 ? 'goes' : 'go'} too.` : ''} onYes={() => { setAsking(false); send({ type: 'hub-login-app-delete', app: app.id }) }} onNo={() => setAsking(false)} />
      </div>}
      {n
        ? <ul role="list" className="si-list">{app.logins.map(l => <Login key={`${l.id}:${l.chrome ?? ''}`} app={app} l={l} hub={hub} send={send} />)}</ul>
        : <p className="si-empty">No saved logins yet. Add one for each account you use.</p>}
      <Add title={`Add ${app.name} login`}>
        <form className="si-form" onSubmit={e => { e.preventDefault(); if (label.trim() && url && !bad) { send({ type: 'hub-login-add', app: app.id, label, url, chrome }); setLabel('') } }}>
          <input aria-label={`New ${app.name} login name`} placeholder="Name, like Work tenant" value={label} maxLength={80} onChange={e => setLabel(e.target.value)} style={{ flex: '1 1 140px' }} />
          <input aria-label={`${app.name} login URL`} placeholder={app.url} value={url} onChange={e => setUrl(e.target.value.trim())} style={{ flex: '2 1 200px' }} />
          <button type="submit" className="hub-btn" disabled={!label.trim() || !url || bad}>Add login</button>
          <span className="si-wide"><Opens hub={hub} value={chrome} onChange={setChrome} fallback={projectBrowser(hub)} label={`Browser for the new ${app.name} login`} /></span>
          {bad && <span role="alert" className="si-err si-wide">Login URLs start with https:// or http://.</span>}
        </form>
      </Add>
    </div>
  )
}

function Apps({ hub, send }: { hub: HubState; send: Send }) {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const apps = hub.signIns?.apps
  const taken = (apps ?? []).some(a => a.name.toLowerCase() === name.trim().toLowerCase())
  const bad = !!url && !URL_OK.test(url)
  return (
    <section aria-labelledby="si-apps" className="si-sec">
      <header><h3 id="si-apps">Web apps</h3></header>
      <p className="si-help">Saved logins per app, like a work and a personal tenant. Each project picks one; Default covers projects that do not.</p>
      {!apps
        ? <p className="si-empty">Update the Switchboard extension to save web logins.</p>
        : <>
            {apps.length === 0 && <p className="si-empty">No web apps yet. Add one, like Vercel or Auth0, then save a login for each account.</p>}
            {apps.map(a => <App key={a.id} app={a} hub={hub} send={send} />)}
            <Add title="Add app" open={!apps.length || undefined}>
              <form className="si-form" onSubmit={e => { e.preventDefault(); if (name.trim() && url && !bad && !taken) { send({ type: 'hub-login-app-add', name, url }); setName(''); setUrl('') } }}>
                <input aria-label="App name" placeholder="App name, like Vercel" value={name} maxLength={40} onChange={e => setName(e.target.value)} style={{ flex: '1 1 140px' }} />
                <input aria-label="App login URL" placeholder="https://vercel.com/login" value={url} onChange={e => setUrl(e.target.value.trim())} style={{ flex: '2 1 200px' }} />
                <button type="submit" className="hub-btn" disabled={!name.trim() || !url || bad || taken}>Add app</button>
                {(bad || taken) && <span role="alert" className="si-err si-wide">{taken ? `${name.trim()} is already listed.` : 'Login URLs start with https:// or http://.'}</span>}
              </form>
            </Add>
          </>}
    </section>
  )
}

const KEY_ROWS: Record<ApiKey['name'], { label: string; url: string }> = {
  GEMINI_API_KEY: { label: 'Gemini', url: 'https://aistudio.google.com/apikey' },
  OPENROUTER_API_KEY: { label: 'Jev / OpenRouter', url: 'https://openrouter.ai/settings/keys' },
}
const KEY_SHAPE = /^[A-Za-z0-9._-]{16,128}$/
const ago = (at: number) => {
  const m = Math.round((Date.now() - at) / 60_000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(at).toLocaleDateString()
}

function KeyStatus({ k }: { k: ApiKey }) {
  if (!k.saved) return <Chip tone="ash" text="Missing" />
  if (!k.checked) return <span className="hub-chip" style={{ color: 'var(--hub-blue)', background: 'var(--hub-blue-soft)' }}><i aria-hidden />Saved</span>
  return k.checked.ok ? <Chip tone="green" text="Works" /> : <Chip tone="red" text="Failed" />
}

/** One API key: status, a paste field and Save, Test, Remove. The key goes out once on Save and never comes back. */
function KeyRow({ k, send }: { k: ApiKey; send: Send }) {
  const [v, setV] = useState('')
  const [asking, setAsking] = useState(false)
  const { label, url } = KEY_ROWS[k.name]
  const value = v.trim()
  const bad = !!value && !KEY_SHAPE.test(value)
  const detail = [k.name, k.saved ? `ends ${k.last4}` : '', k.checked ? `${k.checked.ok ? 'tested' : 'failed'} ${ago(k.checked.at)}` : ''].filter(Boolean).join(' · ')
  return (
    <li className="si-row">
      <span className="si-main">
        <span className="si-title">
          <strong>{label}</strong>
          <KeyStatus k={k} />
          <a className="hub-link" href={url} target="_blank" rel="noreferrer" aria-label={`Get a ${label} key`}
            onClick={e => { if (vscodeBridge?.isVSCode) { e.preventDefault(); send({ type: 'hub-open-url', url }) } }}>Get a key</a>
        </span>
        <span className="si-meta">{detail}</span>
        {k.checked && !k.checked.ok && k.checked.reason && <span role="alert" className="si-err">{k.checked.reason}</span>}
        <form className="si-form" style={{ margin: '4px 0 0', width: '100%' }} onSubmit={e => { e.preventDefault(); if (value && !bad) { send({ type: 'hub-key-save', name: k.name, value }); setV('') } }}>
          <input type="password" autoComplete="off" spellCheck={false} aria-label={`${label} API key`} placeholder={k.saved ? 'Paste a new key to replace it' : 'Paste the key'}
            value={v} maxLength={128} onChange={e => setV(e.target.value)} style={{ flex: '1 1 180px' }} />
          <button type="submit" className="hub-btn primary" disabled={!value || bad}>Save</button>
          {bad && <span role="alert" className="si-err si-wide">That does not look like a key: letters, digits, - and _ only.</span>}
        </form>
      </span>
      <span className="si-acts">
        {k.saved && <button type="button" className="hub-btn" onClick={() => send({ type: 'hub-key-test', name: k.name })}>Test</button>}
        {k.saved && <More name={label} items={[{ label: 'Remove', danger: true, run: () => setAsking(true) }]} />}
      </span>
      {asking && <Confirm what={`the ${label} key`} note="It is taken out of the Keychain." onYes={() => { setAsking(false); send({ type: 'hub-key-remove', name: k.name }) }} onNo={() => setAsking(false)} />}
    </li>
  )
}

function Keys({ hub, send }: { hub: HubState; send: Send }) {
  const keys = hub.signIns?.keys
  return (
    <section aria-labelledby="si-keys" className="si-sec">
      <header><h3 id="si-keys">API keys</h3></header>
      <p className="si-help">Kept in the macOS Keychain. The gemini and Jev skills read them from there; a key in the shell env still wins.</p>
      {keys ? <ul role="list" className="si-list">{keys.map(k => <KeyRow key={k.name} k={k} send={send} />)}</ul> : <p className="si-empty">Update the Switchboard extension to save API keys.</p>}
    </section>
  )
}

/** Accounts, inside Settings. problem: the standalone app's last refused command. */
export function SignIns({ hub, send, problem = null }: { hub: HubState; send: Send; problem?: Problem }) {
  return (
    <div className="si">
      <ThisProject hub={hub} send={send} />
      <Aws hub={hub} send={send} problem={problem} />
      <Apps hub={hub} send={send} />
      <Keys hub={hub} send={send} />
      <Others hub={hub} send={send} />
    </div>
  )
}
