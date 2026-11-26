// A sample 30 days for the browser demo, where no extension answers /hub/usage.
import type { UsageChat, UsageReport, UsageRow } from './usage'

type Seed = [ai: 'claude' | 'codex', model: string, project: string, role: string, perDay: number, price: [number, number, number, number]]
const SEEDS: Seed[] = [
  ['claude', 'claude-opus-5-5', 'Switchboard', 'lead', 1, [4, 20, 0.2, 8]],
  ['claude', 'claude-opus-5-5', 'Armasu', 'lead', 0.7, [4, 20, 0.2, 8]],
  ['claude', 'claude-opus-5-5', 'Switchboard', 'engineer', 0.6, [4, 20, 0.2, 5]],
  ['claude', 'claude-sonnet-5-5', 'Armasu', 'qa', 0.5, [2, 10, 0.1, 2.5]],
  ['claude', 'claude-sonnet-5-5', 'Switchboard', 'designer', 0.35, [2, 10, 0.1, 2.5]],
  ['claude', 'claude-haiku-5-5', 'Switchboard', 'researcher', 0.4, [0.1, 0.5, 0.01, 0.125]],
  ['codex', 'gpt-6-luna', 'Switchboard', 'engineer-codex', 0.12, [0.1, 0.5, 0.01, 0.125]],
  ['codex', 'gpt-5.6-luna', 'Armasu', 'qa-codex', 0.15, [0.2, 1.2, 0.02, 0.25]],
]
const dayKey = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const daysAgo = (now: number, n: number) => { const d = new Date(now); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - n); return d.getTime() }

const CHATS: [name: string, project: string, ai: 'claude' | 'codex', agents: number, cost: number, ago: number][] = [
  ['Usage page', 'Switchboard', 'claude', 6, 31.2, 0], ['Closet import polish', 'Armasu', 'claude', 9, 27.4, 0], ['Ship area decoupling', 'Switchboard', 'claude', 4, 18.9, 1],
  ['Try-on lighting', 'Armasu', 'claude', 3, 14.1, 2], ['Research library', 'Switchboard', 'claude', 7, 12.6, 4], ['Review of the import diff', 'Armasu', 'codex', 0, 0.38, 1],
  ['Receipts empty state', 'Armasu', 'claude', 1, 6.2, 9], ['Phone sign-in', 'Switchboard', 'claude', 2, 5.1, 15],
]

export function demoUsage(now = Date.now()): UsageReport {
  const rows: UsageRow[] = []
  for (let i = 29; i >= 0; i--) {
    const day = dayKey(daysAgo(now, i)), weekend = [0, 6].includes(new Date(daysAgo(now, i)).getDay())
    const wave = (weekend ? 0.45 : 1) * (0.75 + 0.45 * Math.abs(Math.sin(i * 1.7)))
    SEEDS.forEach(([ai, model, project, role, per, [pi, po, pr, pw]], s) => {
      const k = per * wave * (0.8 + 0.4 * Math.abs(Math.cos(i + s * 2)))
      const t = { input: Math.round(60e3 * k * (ai === 'codex' ? 8 : 1)), output: Math.round(420e3 * k), cacheRead: Math.round(62e6 * k), cacheWrite: Math.round(ai === 'codex' ? 0 : 1.9e6 * k) }
      const split = { input: t.input * pi / 1e6, output: t.output * po / 1e6, cacheRead: t.cacheRead * pr / 1e6, cacheWrite: t.cacheWrite * pw / 1e6, search: 0 }
      const costUsd = split.input + split.output + split.cacheRead + split.cacheWrite
      rows.push({ day, ai, model, project, role, ...t, thinking: Math.round(t.output * 0.3), calls: Math.round(380 * k), searches: 0, costUsd, split, savedUsd: t.cacheRead * (pi - pr) / 1e6 })
    })
  }
  const chats: UsageChat[] = CHATS.map(([label, project, ai, agents, cost, ago], i) => {
    const at = now - ago * 86_400_000 - 40 * 60_000
    const days = { [dayKey(daysAgo(now, ago))]: { costUsd: cost * 0.7, tokens: cost * 0.7 * 3.1e6, calls: Math.round(cost * 14) }, [dayKey(daysAgo(now, ago + 1))]: { costUsd: cost * 0.3, tokens: cost * 0.3 * 3.1e6, calls: Math.round(cost * 6) } }
    return { sessionId: `demo-usage-${i}`, ai, label, project, startedAt: at - 5 * 3_600_000, lastAt: at, agents, models: [ai === 'codex' ? 'gpt-5.6-luna' : 'claude-opus-5-5'], days }
  })
  return { at: now, from: dayKey(daysAgo(now, 29)), rows, chats }
}
