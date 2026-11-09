import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { MirofishPoller } from '../src/hub/mirofish'

const response = (body: unknown) => ({ ok: true, json: async () => body })

describe('MiroFish poller', () => {
  it('derives round progress, estimate and report excerpt', async () => {
    const now = Date.parse('2026-11-08T12:10:00Z')
    const calls: Array<[string, RequestInit?]> = []
    const fetcher = async (url: string, init?: RequestInit) => {
      calls.push([url, init])
      if (url.endsWith('/api/simulation/list')) return response({ data: [{ simulation_id: 'sim-1', status: 'running' }] })
      if (url.endsWith('/sim-1/run-status')) return response({ data: { simulation_id: 'sim-1', runner_status: 'running', current_round: 7, total_rounds: 10, progress_percent: 70, started_at: '2026-11-08T12:00:00Z', twitter_completed: false, reddit_completed: false } })
      if (url.endsWith('/api/report/generate/status')) return response({ data: { status: 'completed' } })
      return response({ data: { markdown_content: '# Results\n\n**Crowd** moved.' } })
    }
    const poller = new MirofishPoller({ fetch: fetcher, now: () => now })

    const state = await poller.poll()

    assert.deepEqual(state, {
      simId: 'sim-1', step: 'rounds', round: 7, rounds: 10, percent: 70,
      startedAt: '2026-11-08T12:00:00Z', elapsedMs: 600_000, etaMs: 257_143,
      reportReady: false,
    })
    assert.equal(poller.nextPollMs, 10_000)
    assert.equal(calls.length, 2)
  })

  it('treats both completed platforms as round completion and uses the report', async () => {
    const calls: string[] = []
    const fetcher = async (url: string) => {
      calls.push(url)
      if (url.endsWith('/api/simulation/list')) return response({ data: [{ simulation_id: 'sim-2', status: 'running' }] })
      if (url.endsWith('/sim-2/run-status')) return response({ data: { current_round: 10, total_rounds: 10, progress_percent: 100, runner_status: 'running', twitter_completed: true, reddit_completed: true } })
      return response({ data: { status: 'completed', markdown_content: '# Summary\nThe **crowd** shifted.' } })
    }
    const state = await new MirofishPoller({ fetch: fetcher, now: () => 10_000 }).poll()
    assert.equal(state?.step, 'done')
    assert.equal(state?.reportReady, true)
    assert.equal(state?.reportExcerpt, 'Summary. The crowd shifted.')
    assert.equal(calls[2], 'http://localhost:5001/api/report/by-simulation/sim-2')
  })

  // Real MiroFish: the sim reads "stopped" once its runner ends, and the report sits in "planning" for a while.
  const stopped = (updatedAt: string, report: { ok: boolean; body: unknown }) => async (url: string) => {
    if (url.endsWith('/api/simulation/list')) return response({ data: [{ simulation_id: 'old', status: 'stopped', updated_at: '2026-11-07T08:00:00' }, { simulation_id: 'sim-3', status: 'stopped', updated_at: updatedAt }] })
    if (url.endsWith('/sim-3/run-status')) return response({ data: { current_round: 10, total_rounds: 10, progress_percent: 100, runner_status: 'stopped', twitter_completed: true, reddit_completed: true } })
    if (url.includes('/report/by-simulation/')) return { ok: report.ok, json: async () => report.body }
    throw new Error(`unexpected ${url}`)
  }
  const at = (iso: string) => () => Date.parse(iso)

  it('keeps a recently stopped sim on the card while its report is written, polling fast', async () => {
    const poller = new MirofishPoller({ fetch: stopped('2026-11-08T20:19:52', { ok: true, body: { data: { status: 'planning', markdown_content: '' } } }), now: at('2026-11-08T21:00:00') })
    const state = await poller.poll()
    assert.equal(state?.simId, 'sim-3')
    assert.equal(state?.step, 'report')
    assert.equal(state?.reportReady, false)
    assert.equal(poller.nextPollMs, 10_000)
  })

  it('a stopped sim with no report yet still shows the report step', async () => {
    const state = await new MirofishPoller({ fetch: stopped('2026-11-08T20:19:52', { ok: false, body: { success: false } }), now: at('2026-11-08T21:00:00') }).poll()
    assert.equal(state?.step, 'report')
  })

  it('drops a sim that stopped more than 6 hours ago', async () => {
    const poller = new MirofishPoller({ fetch: stopped('2026-11-08T08:00:00', { ok: true, body: { data: { status: 'completed', markdown_content: 'x' } } }), now: at('2026-11-08T21:00:00') })
    assert.equal(await poller.poll(), undefined)
    assert.equal(poller.nextPollMs, 60_000)
  })

  it('a finished report polls slowly and reads as clean sentences, cut at a word with an ellipsis', async () => {
    const md = '# Roles blur\nFirst-time users read **simulation_id** as a label.\n\n' + 'word '.repeat(120)
    const poller = new MirofishPoller({ fetch: stopped('2026-11-08T20:19:52', { ok: true, body: { data: { status: 'completed', markdown_content: md } } }), now: at('2026-11-08T21:00:00') })
    const state = await poller.poll()
    assert.equal(state?.step, 'done')
    assert.ok(state?.reportExcerpt?.startsWith('Roles blur. First-time users read simulation_id as a label.'))
    assert.ok(state!.reportExcerpt!.endsWith('\u2026'))
    assert.ok(state!.reportExcerpt!.length <= 401)
    assert.equal(poller.nextPollMs, 60_000)
  })

  it('backs off for a minute when the backend is unavailable', async () => {
    const poller = new MirofishPoller({ fetch: async () => { throw new Error('offline') }, now: () => 0 })
    assert.equal(await poller.poll(), undefined)
    assert.equal(poller.nextPollMs, 60_000)
  })

  it('clears its scheduled poll when disposed', async () => {
    let scheduled: { callback: () => void; delay: number; id: NodeJS.Timeout } | undefined
    const cleared: NodeJS.Timeout[] = []
    const poller = new MirofishPoller({
      fetch: async () => { throw new Error('offline') }, now: () => 0,
      setTimeout: ((callback: () => void, delay: number) => {
        const id = {} as NodeJS.Timeout
        scheduled = { callback, delay, id }
        return id
      }) as typeof setTimeout,
      clearTimeout: ((id: NodeJS.Timeout) => { cleared.push(id) }) as typeof clearTimeout,
    })

    poller.start(() => {})
    await new Promise(resolve => setImmediate(resolve))
    poller.dispose()

    assert.equal(scheduled?.delay, 60_000)
    assert.deepEqual(cleared, [scheduled?.id])
  })
})
