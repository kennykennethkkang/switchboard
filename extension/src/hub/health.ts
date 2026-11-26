import * as fs from 'fs'
import * as net from 'net'
import * as os from 'os'
import * as path from 'path'
import { execFile } from 'child_process'
import { readWindows } from './dev'
import { rulesState, syncRules } from './rules'
import { claudeBinary } from './setup'
import { cliCall } from './windows'
import type { HealthResult } from './types'

export type HealthDeps = {
  home: string
  kit: string
  /** setup.json mods, installed as <name>@kenneth-mods. */
  mods: string[]
  ports: () => number[]
  reach: (port: number) => Promise<boolean>
  onPath: (cmd: string) => boolean
  /** The rules and agents sync; write false only reports what would change. */
  sync: (write: boolean) => string[]
  run: (cmd: string, ...args: string[]) => Promise<boolean>
}

const json = (f: string): unknown => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return undefined } }

function defaults(): HealthDeps {
  const home = os.homedir(), kit = rulesState.kit
  const onPath = (cmd: string) => {
    if (cmd === 'claude' && fs.existsSync(claudeBinary())) return true
    return (process.env.PATH ?? '').split(path.delimiter).some(d => ['', '.exe', '.cmd'].some(x => fs.existsSync(path.join(d, cmd + x))))
  }
  return {
    home, kit,
    mods: (json(path.join(kit, 'setup.json')) as { mods?: string[] } | undefined)?.mods ?? [],
    ports: () => readWindows().map(w => w.port),
    reach: port => new Promise(res => {
      const s = net.connect({ port, host: '127.0.0.1', timeout: 2000 }, () => { s.destroy(); res(true) })
      s.on('error', () => res(false)).on('timeout', () => { s.destroy(); res(false) })
    }),
    onPath,
    sync: write => syncRules({ home, kit, write }).changed,
    run: (cmd, ...args) => { const c = cliCall(cmd === 'claude' ? claudeBinary() : cmd, args); return new Promise(res => execFile(c.cmd, c.args, { windowsVerbatimArguments: c.windowsVerbatimArguments, timeout: 120_000, windowsHide: true }, err => res(!err))) },
  }
}

/** The Check health run: hook server, kit version, mods, claude and codex on PATH, hub port, MCP config. */
export async function checkHealth(d: HealthDeps = defaults()): Promise<HealthResult[]> {
  const out: HealthResult[] = []
  const add = (id: string, label: string, status: HealthResult['status'], detail?: string, fixable = false) => out.push({ id, label, status, ...(detail ? { detail } : {}), fixable })
  const up = (await Promise.all(d.ports().map(p => d.reach(p)))).some(Boolean)
  add('hook', 'Hook server answers', up ? 'ok' : 'fail', up ? undefined : 'No window answers; reload the window')
  add('hub', 'Hub port reachable', up ? 'ok' : 'fail', up ? undefined : 'No window answers; reload the window')
  let changed: string[] | undefined
  try { changed = d.kit ? d.sync(false) : undefined } catch { /* reported below */ }
  if (changed === undefined) add('kit', 'Kit rules and agents', 'fail', 'Could not read the bundled kit')
  else add('kit', 'Kit rules and agents', changed.length ? 'warn' : 'ok', changed.length ? `Out of date: ${changed.join(', ')}` : undefined, changed.length > 0)
  const installed = (json(path.join(d.home, '.claude', 'plugins', 'installed_plugins.json')) as { plugins?: Record<string, { version?: string }[]> } | undefined)?.plugins ?? {}
  for (const m of d.mods) {
    const want = (json(path.join(d.kit, 'mods', m, '.claude-plugin', 'plugin.json')) as { version?: string } | undefined)?.version
    const have = installed[`${m}@kenneth-mods`]?.[0]?.version
    if (!want) continue
    if (!have) add(`mod:${m}`, `Mod ${m}`, 'warn', `Not installed (kit has ${want})`, true)
    else add(`mod:${m}`, `Mod ${m}`, have === want ? 'ok' : 'warn', have === want ? undefined : `Installed ${have}, kit has ${want}`, have !== want)
  }
  add('claude', 'claude CLI on PATH', d.onPath('claude') ? 'ok' : 'fail', d.onPath('claude') ? undefined : 'Install Claude Code')
  add('codex', 'codex CLI on PATH', d.onPath('codex') ? 'ok' : 'warn', d.onPath('codex') ? undefined : 'Only needed for Codex chats')
  const cfg = path.join(d.home, '.claude.json')
  if (!fs.existsSync(cfg)) add('mcp', 'MCP config parses', 'warn', 'No ~/.claude.json yet')
  else add('mcp', 'MCP config parses', json(cfg) === undefined ? 'fail' : 'ok', json(cfg) === undefined ? '~/.claude.json is not valid JSON; fix it by hand' : undefined)
  return out
}

/** Reruns the install path for the fixable results among ids (all fixable ones when empty); returns a fresh check. */
export async function fixHealth(ids: string[], d: HealthDeps = defaults()): Promise<HealthResult[]> {
  const todo = (await checkHealth(d)).filter(r => r.fixable && (!ids.length || ids.includes(r.id)))
  if (todo.some(r => r.id === 'kit')) d.sync(true)
  const mods = todo.filter(r => r.id.startsWith('mod:'))
  if (mods.length) {
    await d.run('claude', 'plugin', 'marketplace', 'update', 'kenneth-mods')
    for (const r of mods) {
      const id = `${r.id.slice(4)}@kenneth-mods`
      await d.run('claude', 'plugin', r.detail?.startsWith('Not installed') ? 'install' : 'update', id)
    }
  }
  return checkHealth(d)
}
