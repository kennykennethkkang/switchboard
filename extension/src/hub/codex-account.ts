import { spawn } from 'node:child_process'
import type { Limit } from './types'

export type CodexAccount = { windows: Limit[]; planType?: string; resets?: number; daily: { day: string; tokens: number }[] }

export function parseCodexAccount(value: unknown, now: number): CodexAccount {
  const v = value && typeof value === 'object' ? value as Record<string, any> : {}
  const windows: Limit[] = []
  for (const [key, kind] of [['primary', 'codex_five_hour'], ['secondary', 'codex_seven_day']] as const) {
    const w = v.rateLimits?.[key]
    if (typeof w?.usedPercent === 'number' && typeof w?.resetsAt === 'number') windows.push({ kind, percentUsed: w.resetsAt * 1000 <= now ? 0 : w.usedPercent, resetsAt: new Date(w.resetsAt * 1000).toISOString() })
  }
  const daily = Array.isArray(v.dailyUsageBuckets) ? v.dailyUsageBuckets.filter((b: any) => typeof b?.startDate === 'string' && typeof b?.tokens === 'number').slice(-30).map((b: any) => ({ day: b.startDate, tokens: b.tokens })) : []
  return { windows, ...(typeof v.planType === 'string' ? { planType: v.planType } : {}), ...(typeof v.rateLimitResetCredits?.availableCount === 'number' ? { resets: v.rateLimitResetCredits.availableCount } : {}), daily }
}

export function readCodexAccount(command = 'codex'): Promise<CodexAccount> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, ['app-server'], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true })
    let buffer = '', initialized = false, rate: unknown, usage: unknown, done = false
    const timer = setTimeout(() => finish(new Error('Codex account read timed out')), 15_000)
    const finish = (error?: Error) => {
      if (done) return
      done = true; clearTimeout(timer); child.kill()
      if (error) reject(error)
      else {
        const r = rate as any, u = usage as any
        resolve(parseCodexAccount({ ...r, dailyUsageBuckets: u?.dailyUsageBuckets ?? r?.dailyUsageBuckets }, Date.now()))
      }
    }
    const send = (x: unknown) => child.stdin.write(`${JSON.stringify(x)}\n`)
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      for (const line of buffer.split('\n').slice(0, -1)) {
        let msg: any
        try { msg = JSON.parse(line) } catch { continue }
        if (msg.id === 1) {
          if (msg.error) return finish(new Error('Codex app-server initialize failed'))
          initialized = true; send({ jsonrpc: '2.0', method: 'initialized', params: {} })
          send({ jsonrpc: '2.0', id: 2, method: 'account/rateLimits/read', params: {} })
          send({ jsonrpc: '2.0', id: 3, method: 'account/usage/read', params: {} })
        } else if (msg.id === 2) { if (msg.error) return finish(new Error('Codex rate limits unavailable')); rate = msg.result }
        else if (msg.id === 3) { if (msg.error) return finish(new Error('Codex usage unavailable')); usage = msg.result }
        if (initialized && rate !== undefined && usage !== undefined) finish()
      }
      buffer = buffer.split('\n').at(-1) ?? ''
    })
    child.stdin.on('error', () => finish(new Error('Codex app-server closed early')))
    child.on('error', () => finish(new Error('Could not start Codex app-server')))
    child.on('exit', code => { if (!done) finish(new Error(`Codex app-server exited (${code ?? 'unknown'})`)) })
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'switchboard', version: '1' } } })
  })
}
