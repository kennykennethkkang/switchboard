/** ?demo=stations: a send-back (R1 R2), a Verified chat at Review, and Done's three groups, so the Now stations show in the demo. */
import type { ArchivedChat, HubState, RoleStep } from './hub-types'

const MIN = 60e3

export function demoStations(h: HubState, now: number, search = typeof location === 'undefined' ? '' : location.search): HubState {
  if (!new URLSearchParams(search).get('demo')?.split(',').includes('stations')) return h
  const qa = (id: string, from: number, to: number): RoleStep => ({ id, role: 'qa', state: 'done', startedAt: now - from * MIN, at: now - to * MIN })
  const progress = h.progress.map(p => {
    // qa between the old engineer runs and the new ones: review sent it back
    if (p.sessionId === 'd-wrap') return { ...p, roles: [...p.roles.filter(r => r.state === 'done'), qa('q0', 8, 5), ...p.roles.filter(r => r.state !== 'done')] }
    // built, gate green, then a review after both: Verified, sitting at Review
    if (p.sessionId === 'd-tree') return { ...p, roles: [{ id: 'e1', role: 'engineer', state: 'done' as const, startedAt: now - 18 * MIN, at: now - 9 * MIN }, qa('q1', 6, 1)],
      tools: [{ tool: 'Edit', target: 'auth/redirect.ts', role: 'engineer', at: now - 10 * MIN }], tests: { command: 'pnpm test', ok: true, at: now - 7 * MIN, total: 412 } }
    return p
  })
  const row = (sessionId: string, name: string, extra: Partial<ArchivedChat>): ArchivedChat =>
    ({ sessionId, ai: 'claude', name, origin: name, version: 1, cwd: '/Users/k/GitHub/Armasu', project: 'Armasu', startedAt: now - 3 * 3600e3, archivedAt: now - 30 * MIN, ...extra })
  // the same subject as the demo Git panel's log, which replaces this repo once a chat is opened
  const subject = 'Read the session cookie on Safari'
  const done = [
    row('d-merged', 'Safari session cookie', { approvedAt: now - 40 * MIN, commit: subject, costUsd: 2.1 }),
    row('d-approved', 'Receipts empty state', { approvedAt: now - 15 * MIN, commit: 'Empty state for receipts', costUsd: 0.64 }),
    row('d-stopped', 'Size chart scrape', { ended: true, archivedAt: now - 50 * MIN }),
  ]
  return {
    ...h, progress, archive: [...done, ...(h.archive ?? [])],
    repo: h.repo ?? { sessionId: 'd-merged', name: 'Armasu', ahead: 0, behind: 0, files: [], branches: ['main'], sync: { kind: 'fetch', label: 'Fetch' }, stashes: 0, at: now,
      log: [{ hash: 'c41d2e0', subject, when: '40 minutes ago' }] },
  }
}
