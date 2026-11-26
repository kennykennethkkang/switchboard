'use client'
import type { ChatProfile, Connection, Installed, SmartRecord } from '@/lib/hub-types'
import { caps, panel } from './look'
import { ToolChips, chip } from './tool-chips'
import { plural } from './chat-cards'

const short = (n: string) => n.split('@')[0]
const hint = { margin: 0, color: 'var(--hub-ash)', fontSize: 13, lineHeight: 1.5 } as const
const DOT = { on: 'var(--hub-green)', off: 'var(--hub-ash)', error: 'var(--hub-red)' } as const
const KIND = { plugin: 'Plugin', skill: 'Skill', asset: 'Design reference' } as const

/**
 * The chat's plugins, skills and design references, what each does, and the MCP servers and apps it can reach.
 * With a saved profile the chips toggle it; without one the chat runs on the defaults, listed read only.
 * onInstalled opens Settings at Installed.
 */
export function ToolsCard({ profile, flagged = [], smart, globalOff = [], installed = [], connections = [], open, onProfile, onInstalled }: {
  profile?: ChatProfile; flagged?: string[]; smart?: SmartRecord; globalOff?: string[]; installed?: Installed[]; connections?: Connection[]; open?: boolean
  onProfile?: (p: ChatProfile) => void; onInstalled?: () => void
}) {
  const tips = Object.fromEntries(installed.flatMap(i => i.description ? [[i.name, i.description], ...(i.path ? [[i.path, i.description]] : [])] : []))
  const on = profile
    ? (['plugins', 'skills', 'assets'] as const).flatMap(k => Object.entries(profile[k] ?? {}).filter(([, v]) => v).map(([n]) => ({ kind: k === 'plugins' ? 'plugin' : k === 'skills' ? 'skill' : 'asset', name: n })))
    : installed.filter(i => i.enabled && (i.kind === 'plugin' || i.kind === 'skill')).map(i => ({ kind: i.kind, name: i.name }))
  const count = (k: string) => on.filter(o => o.kind === k).length
  const extras = Object.values(profile?.extras ?? {}).filter(Boolean).length
  const said = [plural(count('plugin'), 'plugin'), plural(count('skill'), 'skill'), extras ? plural(extras, 'other tool') : '', count('asset') ? plural(count('asset'), 'design reference') : ''].filter(Boolean).join(', ')
  const links = connections.filter(c => c.kind === 'mcp' || c.kind === 'app')
  const described = on.filter(o => tips[o.name])
  return (
    <details className="hub-fold-list hub-tools" open={open} style={{ ...panel, display: 'block' }}>
      <summary style={{ ...caps, alignItems: 'center', padding: 0, borderTop: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><b aria-hidden>›</b>Tools</span>
        <span>{profile ? `${said} on` : `Your defaults: ${said}`}</span>
      </summary>
      <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
        {profile && onProfile
          ? <>
              <p style={hint}>Changes save now and apply when this chat is resumed or restarted. Hover a chip for what it does.</p>
              <ToolChips profile={profile} flagged={flagged} tips={tips} onChange={onProfile} />
            </>
          : <>
              <p style={hint}>This chat runs with your default plugins and skills.</p>
              {on.length > 0 && <ul role="list" aria-label="Default plugins and skills" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {on.map(o => <li key={o.name} title={[o.name, tips[o.name]].filter(Boolean).join('\n')} style={{ ...chip(false), cursor: 'default', color: 'var(--hub-body)' }}>{short(o.name)}</li>)}
              </ul>}
            </>}
        <SkillsMods smart={smart} globalOff={globalOff} installed={installed} />
        {described.length > 0 && (
          <details className="hub-fold-list hub-tools-what">
            <summary style={{ ...caps, alignItems: 'center', padding: '8px 0 0', textTransform: 'none' }}><span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><b aria-hidden>›</b>What each one does</span><span>{described.length}</span></summary>
            <dl style={{ margin: '8px 0 0', display: 'grid', gridTemplateColumns: 'minmax(0, max-content) minmax(0, 1fr)', gap: '6px 14px', fontSize: 13 }}>
              {described.map(o => <div key={o.name} style={{ display: 'contents' }}>
                <dt style={{ color: 'var(--hub-ink)', fontWeight: 500, overflowWrap: 'anywhere' }}>{short(o.name).split(/[/\\]/).slice(-2)[0]}<span className="sr-only"> ({KIND[o.kind as keyof typeof KIND]})</span></dt>
                <dd style={{ margin: 0, color: 'var(--hub-body)' }}>{tips[o.name]}</dd>
              </div>)}
            </dl>
          </details>
        )}
        {links.length > 0 && <div style={{ display: 'grid', gap: 6 }}>
          <h4 style={caps}><span>Connected</span><span>{plural(links.length, 'server')}</span></h4>
          <ul role="list" aria-label="MCP servers and apps" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {links.map(c => <li key={`${c.kind}:${c.name}`} title={[c.kind === 'mcp' ? 'MCP server' : 'App', c.status, c.detail].filter(Boolean).join(' · ')}
              style={{ ...chip(false), cursor: 'default', color: 'var(--hub-body)' }}>
              <i aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: DOT[c.status] }} />{c.name}
              <span className="sr-only">, {c.status === 'on' ? 'connected' : c.status === 'error' ? 'has a problem' : 'off'}</span>
              {c.detail && <span style={{ color: 'var(--hub-ash)' }}>{c.detail}</span>}
            </li>)}
          </ul>
        </div>}
        {onInstalled && <div><button type="button" className="hub-btn sm" onClick={onInstalled}>Everything installed</button></div>}
      </div>
    </details>
  )
}

const brand = (p: string) => p.split(/[/\\]/).slice(-2)[0]
const row = { display: 'grid', gridTemplateColumns: 'minmax(0, max-content) minmax(0, 1fr)', gap: '4px 14px', margin: 0, fontSize: 13 } as const

/** Skills and mods: what the smart toggle picked for this chat and why, the library in use, and what is on or off for every chat. */
function SkillsMods({ smart, globalOff, installed }: { smart?: SmartRecord; globalOff: string[]; installed: Installed[] }) {
  const picked = Object.entries(smart?.why ?? {}).filter(([n]) => !smart?.library.includes(n))
  const mods = installed.filter(i => i.kind === 'mod')
  return (
    <section aria-label="Skills and mods" style={{ display: 'grid', gap: 8 }}>
      <h4 style={caps}><span>Skills and mods</span><span>{smart?.pending ? 'Applies on next start or resume' : smart ? 'In use' : 'No picks yet'}</span></h4>
      {smart
        ? <dl style={row}>
            {picked.map(([n, rule]) => <div key={n} style={{ display: 'contents' }}>
              <dt style={{ color: 'var(--hub-ink)', overflowWrap: 'anywhere' }}>{short(n)}{smart.on[n] ? '' : <span style={{ color: 'var(--hub-ash)' }}> (already on)</span>}</dt>
              <dd style={{ margin: 0, color: 'var(--hub-body)' }}>{smart.refused.includes(n) ? `Needs approval in Settings, Installed (${rule})` : rule}</dd>
            </div>)}
          </dl>
        : <p style={hint}>Each prompt turns on what the task needs (design words or the designer role bring every design skill) and says why here.</p>}
      {smart && smart.library.length > 0 && <p style={hint}>Design library: {smart.library.map(brand).join(', ')}</p>}
      <p style={hint}>
        Every chat: {mods.length ? `mods ${mods.map(m => `${short(m.name)} ${m.enabled ? 'on' : 'off'}`).join(', ')}` : 'no mods'}
        {globalOff.length > 0 ? `; off in settings.json: ${globalOff.map(n => n.split(':').pop()).join(', ')}` : '; no skills off in settings.json'}
      </p>
    </section>
  )
}
