import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { MirofishPoller, mirofishPage, saveReport, savedReports } from '../src/hub/mirofish'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mirofish-'))

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
    const poller = new MirofishPoller({ dir: tmp(), fetch: fetcher, now: () => now })

    const state = await poller.poll()

    assert.deepEqual(state, {
      simId: 'sim-1', step: 'rounds', round: 7, rounds: 10, percent: 70,
      startedAt: '2026-11-08T12:00:00Z', elapsedMs: 600_000, etaMs: 257_143,
      reportReady: false,
    })
    assert.equal(poller.nextPollMs, 10_000)
    assert.equal(calls.length, 3)
    assert.match(calls[2][0], /\/sim-1\/actions\?limit=24$/)
  })

  it('treats both completed platforms as round completion and uses the report', async () => {
    const calls: string[] = []
    const fetcher = async (url: string) => {
      calls.push(url)
      if (url.endsWith('/api/simulation/list')) return response({ data: [{ simulation_id: 'sim-2', status: 'running' }] })
      if (url.endsWith('/sim-2/run-status')) return response({ data: { current_round: 10, total_rounds: 10, progress_percent: 100, runner_status: 'running', twitter_completed: true, reddit_completed: true } })
      return response({ data: { status: 'completed', markdown_content: '# Summary\nThe **crowd** shifted.' } })
    }
    const state = await new MirofishPoller({ dir: tmp(), fetch: fetcher, now: () => 10_000 }).poll()
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
    const poller = new MirofishPoller({ dir: tmp(), fetch: stopped('2026-11-08T20:19:52', { ok: true, body: { data: { status: 'planning', markdown_content: '' } } }), now: at('2026-11-08T21:00:00') })
    const state = await poller.poll()
    assert.equal(state?.simId, 'sim-3')
    assert.equal(state?.step, 'report')
    assert.equal(state?.reportReady, false)
    assert.equal(poller.nextPollMs, 10_000)
  })

  it('a stopped sim with no report yet still shows the report step', async () => {
    const state = await new MirofishPoller({ dir: tmp(), fetch: stopped('2026-11-08T20:19:52', { ok: false, body: { success: false } }), now: at('2026-11-08T21:00:00') }).poll()
    assert.equal(state?.step, 'report')
  })

  it('drops a sim that stopped more than 6 hours ago', async () => {
    const poller = new MirofishPoller({ dir: tmp(), fetch: stopped('2026-11-08T08:00:00', { ok: true, body: { data: { status: 'completed', markdown_content: 'x' } } }), now: at('2026-11-08T21:00:00') })
    assert.equal(await poller.poll(), undefined)
    assert.equal(poller.nextPollMs, 60_000)
  })

  it('a finished report polls slowly and reads as clean sentences, cut at a word with an ellipsis', async () => {
    const md = '# Roles blur\nFirst-time users read **simulation_id** as a label.\n\n' + 'word '.repeat(120)
    const poller = new MirofishPoller({ dir: tmp(), fetch: stopped('2026-11-08T20:19:52', { ok: true, body: { data: { status: 'completed', markdown_content: md } } }), now: at('2026-11-08T21:00:00') })
    const state = await poller.poll()
    assert.equal(state?.step, 'done')
    assert.ok(state?.reportExcerpt?.startsWith('Roles blur. First-time users read simulation_id as a label.'))
    assert.ok(state!.reportExcerpt!.endsWith('\u2026'))
    assert.ok(state!.reportExcerpt!.length <= 401)
    assert.equal(poller.nextPollMs, 60_000)
  })

  it('backs off for a minute when the backend is unavailable', async () => {
    const poller = new MirofishPoller({ dir: tmp(), fetch: async () => { throw new Error('offline') }, now: () => 0 })
    assert.equal(await poller.poll(), undefined)
    assert.equal(poller.nextPollMs, 60_000)
  })

  it('clears its scheduled poll when disposed', async () => {
    let scheduled: { callback: () => void; delay: number; id: NodeJS.Timeout } | undefined
    const cleared: NodeJS.Timeout[] = []
    const poller = new MirofishPoller({ dir: tmp(),
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

  it('shows the newest agent actions while rounds run, and keeps progress when the feed fails', async () => {
    const base = async (url: string) => {
      if (url.endsWith('/api/simulation/list')) return response({ data: [{ simulation_id: 'sim-4', status: 'running' }] })
      if (url.endsWith('/sim-4/run-status')) return response({ data: { current_round: 2, total_rounds: 10 } })
      return undefined
    }
    const actions = [
      { action_type: 'CREATE_COMMENT', agent_name: 'Omar', platform: 'reddit', timestamp: '2026-11-18T19:40:10', action_args: { content: 'Weather  aware\nstyling' } },
      { action_type: 'DO_NOTHING', agent_name: 'Idle', platform: 'twitter' },
      { action_type: 'LIKE_POST', agent_id: 3, platform: 'twitter', timestamp: '2026-11-18T19:40:09', action_args: { post_content: 'x'.repeat(200) } },
    ]
    const ok = await new MirofishPoller({ dir: tmp(), fetch: async url => (await base(url)) ?? response({ data: { actions } }), now: () => 0 }).poll()
    assert.deepEqual(ok?.feed?.[0], { at: '2026-11-18T19:40:10', who: 'Omar', platform: 'reddit', action: 'commented', text: 'Weather aware styling' })
    assert.equal(ok?.feed?.length, 2)
    assert.equal(ok?.feed?.[1].who, 'Agent 3')
    assert.equal(ok?.feed?.[1].text?.length, 160)
    const failed = await new MirofishPoller({ dir: tmp(), fetch: async url => (await base(url)) ?? { ok: false, json: async () => ({}) }, now: () => 0 }).poll()
    assert.equal(failed?.round, 2)
    assert.equal(failed?.feed, undefined)
  })
})

describe('Open MiroFish', () => {
  it('opens the sim page straight away when the web app is up', async () => {
    let started = false
    const r = await mirofishPage('sim 1', { fetch: async () => response({}), start: () => { started = true } })
    assert.deepEqual(r, { url: 'http://localhost:3100/simulation/sim%201/start' })
    assert.equal(started, false)
  })

  it('starts the web app from the found folder and waits for it', async () => {
    let calls = 0, startedIn = ''
    const fetch = async () => { if (++calls < 3) throw new Error('down'); return response({}) }
    const r = await mirofishPage(undefined, { fetch, folder: () => '/m', start: d => { startedIn = d }, sleep: async () => {} })
    assert.deepEqual(r, { url: 'http://localhost:3100' })
    assert.equal(startedIn, '/m')
  })

  it('says what is wrong when there is no folder or it never comes up', async () => {
    const down = async (): Promise<never> => { throw new Error('down') }
    assert.match((await mirofishPage('s', { fetch: down, folder: () => undefined }) as { problem: string }).problem, /folder not found/)
    assert.match((await mirofishPage('s', { fetch: down, folder: () => '/m', start: () => {}, sleep: async () => {}, waitMs: 1000 }) as { problem: string }).problem, /did not start/)
  })
})

describe('Open MiroFish start problems', () => {
  it('returns the start problem instead of waiting', async () => {
    let slept = 0
    const r = await mirofishPage('s', { fetch: async () => { throw new Error('down') }, folder: () => '/m', start: () => 'npm not found', sleep: async () => { slept++ } })
    assert.deepEqual(r, { problem: 'npm not found' })
    assert.equal(slept, 0)
  })
})

describe('MiroFish report', () => {
  const finished = (runner: string, report: (url: string, init?: RequestInit) => { ok: boolean; status?: number; body: unknown }) => {
    const calls: Array<[string, string]> = []
    const fetcher = async (url: string, init?: RequestInit) => {
      calls.push([url, String(init?.method ?? 'GET')])
      if (url.endsWith('/api/simulation/list')) return response({ data: [{ simulation_id: 'sim-9', status: 'running' }] })
      if (url.endsWith('/sim-9/run-status')) return response({ data: { current_round: 10, total_rounds: 10, runner_status: runner, twitter_completed: true, reddit_completed: true } })
      const r = report(url, init)
      return { ok: r.ok, status: r.status, json: async () => r.body }
    }
    return { calls, fetcher }
  }

  it('ends an idle runner, then starts the report once across windows', async () => {
    const dir = tmp()
    const { calls, fetcher } = finished('running', url => url.includes('by-simulation') ? { ok: false, status: 404, body: {} } : { ok: true, body: { data: {} } })
    let now = 0
    const poller = new MirofishPoller({ dir, fetch: fetcher, now: () => now })
    await poller.poll()
    assert.equal(calls.filter(c => c[1] === 'POST').length, 0, 'waits for the chat that ran the sim')
    now = 2 * 60_000
    const state = await poller.poll()
    assert.deepEqual(calls.filter(c => c[1] === 'POST').map(c => c[0].replace(/.*\/api/, '')), ['/simulation/stop', '/report/generate'])
    assert.equal(state?.step, 'report')
    assert.equal(state?.reportPercent, 0)
    const again = finished('stopped', url => url.includes('by-simulation') ? { ok: false, status: 404, body: {} } : { ok: true, body: {} })
    await new MirofishPoller({ dir, fetch: again.fetcher, now: () => 0 }).poll()
    assert.equal(again.calls.filter(c => c[1] === 'POST').length, 0)
  })

  it('retries a refused report 5 minutes apart, 3 times, then asks for a look', async () => {
    const dir = tmp()
    const { calls, fetcher } = finished('stopped', url => url.includes('by-simulation') ? { ok: false, status: 404, body: {} } : { ok: false, status: 409, body: { error: 'graph not built' } })
    let now = 0
    const poller = new MirofishPoller({ dir, fetch: fetcher, now: () => now })
    const generates = () => calls.filter(c => c[0].endsWith('/report/generate')).length
    await poller.poll()
    now = 2 * 60_000
    let state = await poller.poll()
    assert.equal(state?.reportError, 'Report did not start: graph not built. Trying again shortly.')
    now += 60_000
    await poller.poll()
    assert.equal(generates(), 1, 'waits 5 minutes before the next try')
    now += 5 * 60_000; await poller.poll()
    now += 5 * 60_000; await poller.poll()
    now += 5 * 60_000; state = await poller.poll()
    assert.equal(generates(), 3)
    assert.equal(state?.reportGaveUp, true)
    assert.match(String(state?.reportError), /Tried 3 times/)
  })

  it('a dropped connection counts as a try instead of locking the sim out', async () => {
    const dir = tmp()
    let drop = true
    const { calls, fetcher } = finished('stopped', url => {
      if (url.includes('by-simulation')) return { ok: false, status: 404, body: {} }
      if (drop) throw new Error('ECONNRESET')
      return { ok: true, body: { data: {} } }
    })
    let now = 0
    const poller = new MirofishPoller({ dir, fetch: fetcher, now: () => now })
    await poller.poll()
    now = 2 * 60_000
    const state = await poller.poll()
    assert.match(String(state?.reportError), /ECONNRESET/)
    drop = false
    now += 5 * 60_000
    const next = await poller.poll()
    assert.equal(calls.filter(c => c[0].endsWith('/report/generate')).length, 2)
    assert.equal(next?.reportError, undefined)
  })

  it('regenerates a report whose progress stopped moving', async () => {
    const dir = tmp()
    let noProgress = false
    const bodies: string[] = [], languages: string[] = []
    const fetcher = async (url: string, init?: RequestInit) => {
      if (init?.body) { bodies.push(String(init.body)); languages.push(String((init.headers as Record<string, string>)['Accept-Language'])) }
      if (url.endsWith('/api/simulation/list')) return response({ data: [{ simulation_id: 'sim-9', status: 'stopped', updated_at: '2026-11-18T20:00:00' }] })
      if (url.endsWith('/sim-9/run-status')) return response({ data: { current_round: 10, total_rounds: 10, runner_status: 'stopped', twitter_completed: true, reddit_completed: true } })
      if (url.includes('by-simulation')) return response({ data: { report_id: 'rep-1', status: 'planning', created_at: '2026-11-18T20:01:00' } })
      if (url.endsWith('/progress')) return noProgress ? { ok: false, json: async () => ({}) } : response({ data: { progress: 20, updated_at: '2026-11-18T20:00:00' } })
      return response({ data: {} })
    }
    const state = await new MirofishPoller({ dir, fetch: fetcher, now: () => Date.parse('2026-11-18T20:30:00') }).poll()
    assert.deepEqual(bodies, [JSON.stringify({ simulation_id: 'sim-9', force_regenerate: true })])
    assert.equal(languages[0], 'en', 'asks for the report in English')
    assert.equal(state?.reportPercent, 0)
    noProgress = true
    bodies.length = 0
    await new MirofishPoller({ dir: tmp(), fetch: fetcher, now: () => Date.parse('2026-11-18T20:30:00') }).poll()
    assert.equal(bodies.length, 1, 'a report with no progress file, created long ago, counts as stalled')
  })

  it('after three stalled tries says it stalled, not that it never started', async () => {
    const dir = tmp()
    const fetcher = async (url: string) => {
      if (url.endsWith('/api/simulation/list')) return response({ data: [{ simulation_id: 'sim-9', status: 'stopped', updated_at: '2026-11-18T20:00:00' }] })
      if (url.endsWith('/sim-9/run-status')) return response({ data: { current_round: 10, total_rounds: 10, runner_status: 'stopped', twitter_completed: true, reddit_completed: true } })
      if (url.includes('by-simulation')) return response({ data: { report_id: 'rep-1', status: 'generating', created_at: '2026-11-18T20:01:00' } })
      if (url.endsWith('/progress')) return response({ data: { progress: 40, updated_at: '2026-11-18T20:00:00' } })
      return response({ data: {} })
    }
    let now = Date.parse('2026-11-18T20:30:00')
    const poller = new MirofishPoller({ dir, fetch: fetcher, now: () => now })
    let state
    for (let i = 0; i < 4; i++) { state = await poller.poll(); now += 6 * 60_000 }
    assert.match(String(state?.reportError), /^Report stalled at 40%\. Tried 3 times/)
    assert.equal(state?.reportGaveUp, true)
  })

  it('follows report progress, then saves it once and lists it newest first', async () => {
    const dir = tmp()
    const writing = finished('stopped', url => url.includes('by-simulation') ? { ok: true, body: { data: { report_id: 'rep-1', status: 'generating' } } } : { ok: true, body: { data: { progress: 45, completed_sections: ['a'] } } })
    const mid = await new MirofishPoller({ dir, fetch: writing.fetcher, now: () => 0 }).poll()
    assert.deepEqual([mid?.step, mid?.reportPercent, mid?.reportSections, mid?.reportId], ['report', 45, 1, 'rep-1'])
    assert.ok(writing.calls.some(c => c[0].endsWith('/report/rep-1/progress')))

    const report = { report_id: 'rep-1', status: 'completed', completed_at: '2026-11-18T20:04:15', markdown_content: '# Trust split\n\nThree camps.', outline: { title: 'Trust split', summary: 'Three camps.' }, simulation_requirement: 'Pick an app' }
    const done = finished('stopped', () => ({ ok: true, body: { data: report } }))
    const state = await new MirofishPoller({ dir, fetch: done.fetcher, now: () => 0 }).poll()
    assert.deepEqual([state?.step, state?.saved], ['done', true])
    assert.equal(fs.readFileSync(path.join(dir, 'sim-9.md'), 'utf8'), '# Trust split\n\nThree camps.')
    fs.writeFileSync(path.join(dir, 'old.json'), JSON.stringify({ simId: 'old', title: 'Old', at: '2026-11-01T00:00:00' }))
    const list = savedReports(dir)
    assert.deepEqual(list.map(r => [r.simId, r.title, r.summary, !!r.markdown]), [['sim-9', 'Trust split', 'Three camps.', true], ['old', 'Old', undefined, false]])
    assert.equal(list[0].file, path.join(dir, 'sim-9.md'))
  })

  it('saves the report of another sim that finished while a newer one runs', async () => {
    const dir = tmp()
    const fetcher = async (url: string) => {
      if (url.endsWith('/api/simulation/list')) return response({ data: [{ simulation_id: 'new', status: 'running' }, { simulation_id: 'old', status: 'stopped', updated_at: '2026-11-18T20:00:00' }] })
      if (url.endsWith('/new/run-status')) return response({ data: { current_round: 2, total_rounds: 10 } })
      if (url.endsWith('/old/run-status')) return response({ data: { current_round: 10, total_rounds: 10, runner_status: 'stopped' } })
      if (url.endsWith('/by-simulation/old')) return response({ data: { report_id: 'r-old', status: 'completed', markdown_content: '# Old run\n\nDone.' } })
      return response({ data: {} })
    }
    const state = await new MirofishPoller({ dir, fetch: fetcher, now: () => Date.parse('2026-11-18T21:00:00') }).poll()
    assert.equal(state?.simId, 'new')
    assert.equal(fs.readFileSync(path.join(dir, 'old.md'), 'utf8'), '# Old run\n\nDone.')
  })

  it('skips finished sims it gave up on so a fourth one still gets its report', async () => {
    const dir = tmp()
    for (const id of ['a', 'b', 'c']) fs.writeFileSync(path.join(dir, `${id}.requested`), JSON.stringify({ n: 3, at: 0, error: 'x' }))
    const asked: string[] = []
    const fetcher = async (url: string) => {
      if (url.endsWith('/api/simulation/list')) return response({ data: [{ simulation_id: 'live', status: 'running' }, ...['a', 'b', 'c', 'd'].map(id => ({ simulation_id: id, status: 'stopped', updated_at: '2026-11-18T20:00:00' }))] })
      if (url.endsWith('/live/run-status')) return response({ data: { current_round: 1, total_rounds: 10 } })
      if (url.endsWith('/run-status')) return response({ data: { current_round: 10, total_rounds: 10, runner_status: 'stopped' } })
      if (url.includes('by-simulation/')) { asked.push(url.split('/').pop()!); return response({ data: { report_id: 'r', status: 'completed', markdown_content: '# x' } }) }
      return response({ data: {} })
    }
    await new MirofishPoller({ dir, fetch: fetcher, now: () => Date.parse('2026-11-18T21:00:00') }).poll()
    assert.deepEqual(asked, ['d'])
  })

  it('does not ask when the report shows up just before Switchboard would', async () => {
    let looks = 0
    // 1st look: grace starts; 2nd: still none; 3rd (the last look before asking): the other chat's report is there.
    const { calls, fetcher } = finished('stopped', url => url.includes('by-simulation') ? (++looks < 3 ? { ok: false, status: 404, body: {} } : { ok: true, body: { data: {} } }) : { ok: true, body: {} })
    let now = 0
    const poller = new MirofishPoller({ dir: tmp(), fetch: fetcher, now: () => now })
    await poller.poll()
    now = 2 * 60_000
    await poller.poll()
    assert.equal(looks, 3)
    assert.equal(calls.filter(c => c[1] === 'POST').length, 0)
  })
})

describe('MiroFish in English', () => {
  const settle = () => new Promise(r => setTimeout(r, 0))

  it('translates Chinese posts in one batch and shows the English from the next poll', async () => {
    const asked: string[] = []
    const translate = async (t: string) => { asked.push(t); return '1. I installed the app.\n2. Too many photos.' }
    const fetcher = async (url: string) => {
      if (url.endsWith('/api/simulation/list')) return response({ data: [{ simulation_id: 's', status: 'running' }] })
      if (url.endsWith('/s/run-status')) return response({ data: { current_round: 1, total_rounds: 10 } })
      return response({ data: { actions: [
        { action_type: 'CREATE_POST', agent_name: 'Mei', platform: 'reddit', action_args: { content: '我安装了这个应用' } },
        { action_type: 'CREATE_POST', agent_name: 'Li', platform: 'reddit', action_args: { content: '照片太多了' } },
        { action_type: 'CREATE_POST', agent_name: 'Sam', platform: 'reddit', action_args: { content: 'Already English' } },
      ] } })
    }
    const poller = new MirofishPoller({ dir: tmp(), fetch: fetcher, now: () => 0, translate })
    const first = await poller.poll()
    assert.equal(first?.feed?.[0].text, '我安装了这个应用')
    assert.deepEqual(asked, ['1. 我安装了这个应用\n2. 照片太多了'])
    await settle()
    const next = await poller.poll()
    assert.deepEqual(next?.feed?.map(p => [p.text, !!p.translated]), [['I installed the app.', true], ['Too many photos.', true], ['Already English', false]])
    assert.equal(asked.length, 1)
  })

  it('writes an English copy of a Chinese report once, and lists it in place of the original', async () => {
    const dir = tmp()
    fs.writeFileSync(path.join(dir, 'sim-z.json'), JSON.stringify({ simId: 'sim-z', title: '信任分裂', at: '2026-11-18T20:00:00', summary: '三个阵营' }))
    fs.writeFileSync(path.join(dir, 'sim-z.md'), '# 信任分裂\n\n三个阵营。')
    fs.writeFileSync(path.join(dir, 'sim-e.json'), JSON.stringify({ simId: 'sim-e', title: 'Fine', at: '2026-11-17T20:00:00' }))
    fs.writeFileSync(path.join(dir, 'sim-e.md'), '# Fine\n\nAlready English.')
    const asked: string[] = []
    const translate = async (t: string) => { asked.push(t); return '# Trust split\n\nThree camps.' }
    const fetcher = async (url: string) => url.endsWith('/list') ? response({ data: [] }) : response({ data: {} })
    const poller = new MirofishPoller({ dir, fetch: fetcher, now: () => 0, translate })
    await poller.poll()
    await settle(); await settle()
    await poller.poll()
    assert.deepEqual(asked, ['# 信任分裂\n\n三个阵营。'])
    const [z, e] = savedReports(dir)
    assert.deepEqual([z.title, z.markdown, z.translated, z.summary, z.file.endsWith('sim-z.en.md')], ['Trust split', '# Trust split\n\nThree camps.', true, undefined, true])
    assert.deepEqual([e.title, e.translated], ['Fine', undefined])
    assert.equal(fs.existsSync(path.join(dir, 'sim-z.en.pending')), false)
  })

  it('waits out the lock before retrying a report translation that failed', async () => {
    const dir = tmp()
    fs.writeFileSync(path.join(dir, 'sim-z.json'), JSON.stringify({ simId: 'sim-z', title: '信任分裂', at: '2026-11-18T20:00:00' }))
    fs.writeFileSync(path.join(dir, 'sim-z.md'), '# 信任分裂')
    let asked = 0
    const translate = async () => { asked++; throw new Error('no claude') }
    const fetcher = async (url: string) => url.endsWith('/list') ? response({ data: [] }) : response({ data: {} })
    const poller = new MirofishPoller({ dir, fetch: fetcher, now: () => 0, translate })
    await poller.poll(); await settle(); await settle()
    await poller.poll(); await settle(); await settle()
    assert.equal(asked, 1)
    assert.equal(fs.existsSync(path.join(dir, 'sim-z.en.pending')), true)
  })
})

describe('MiroFish stalled and dismissed sims', () => {
  const running = (round: () => number) => async (url: string) => {
    if (url.endsWith('/api/simulation/list')) return response({ data: [{ simulation_id: 'sim-s', status: 'running' }] })
    if (url.endsWith('/sim-s/run-status')) return response({ data: { current_round: round(), total_rounds: 10, runner_status: 'running', twitter_completed: false, reddit_completed: false } })
    return response({ data: {} })
  }
  it('flags a running sim with no new round for 30 minutes, and a new round clears it', async () => {
    let now = 0, round = 3
    const poller = new MirofishPoller({ dir: tmp(), fetch: running(() => round), now: () => now })
    assert.equal((await poller.poll())?.stalled, undefined)
    now = 29 * 60_000
    assert.equal((await poller.poll())?.stalled, undefined)
    now = 31 * 60_000
    assert.equal((await poller.poll())?.stalled, true)
    round = 4
    assert.equal((await poller.poll())?.stalled, undefined)
  })
  it('dismiss hides the sim for every window', async () => {
    const dir = tmp()
    const poller = new MirofishPoller({ dir, fetch: running(() => 3), now: () => 0 })
    assert.equal((await poller.poll())?.simId, 'sim-s')
    poller.dismiss('sim-s')
    assert.equal(await poller.poll(), undefined)
    assert.equal(await new MirofishPoller({ dir, fetch: running(() => 3), now: () => 0 }).poll(), undefined)
  })
})

describe('MiroFish shared files', () => {
  it('saves a report even when another window left its temp file behind', () => {
    const dir = tmp()
    fs.mkdirSync(path.join(dir, 'sim-t.md.tmp'))
    assert.equal(saveReport(dir, 'sim-t', { markdown_content: '# Hi\nbody' }), true)
    assert.match(fs.readFileSync(path.join(dir, 'sim-t.md'), 'utf8'), /body/)
    assert.deepEqual(fs.readdirSync(dir).filter(f => f.endsWith('.tmp') && f !== 'sim-t.md.tmp'), [])
  })
  const stuck = (onAgain?: () => void) => {
    const calls: string[] = []
    return {
      calls, fetcher: async (url: string, init?: RequestInit) => {
        calls.push(`${init?.method ?? 'GET'} ${url}`)
        if (url.endsWith('/api/simulation/list')) return response({ data: [{ simulation_id: 'sim-9', status: 'stopped', updated_at: '1970-01-01T00:00:00Z' }] })
        if (url.endsWith('/sim-9/run-status')) return response({ data: { current_round: 10, total_rounds: 10, runner_status: 'stopped', twitter_completed: true, reddit_completed: true } })
        if (url.includes('by-simulation')) { if (calls.filter(c => c.includes('by-simulation')).length > 2) onAgain?.(); return { ok: false, status: 404, json: async () => ({}) } }
        return { ok: false, status: 409, json: async () => ({ error: 'no graph' }) }
      },
    }
  }
  const generates = (calls: string[]) => calls.filter(c => c.endsWith('/report/generate')).length
  it('skips a retry when another window holds the claim lock', async () => {
    const dir = tmp()
    fs.writeFileSync(path.join(dir, 'sim-9.requested'), JSON.stringify({ n: 1, at: 0, error: 'x' }))
    fs.writeFileSync(path.join(dir, 'sim-9.requested.lock'), '')
    const s = stuck()
    let now = 8 * 60_000
    const poller = new MirofishPoller({ dir, fetch: s.fetcher, now: () => now })
    await poller.poll()
    now += 3 * 60_000
    await poller.poll()
    assert.equal(generates(s.calls), 0)
  })
  it('rereads the count under the lock and skips when another window already claimed', async () => {
    const dir = tmp(), mark = path.join(dir, 'sim-9.requested')
    fs.writeFileSync(mark, JSON.stringify({ n: 1, at: 0, error: 'x' }))
    const s = stuck(() => fs.writeFileSync(mark, JSON.stringify({ n: 2, at: 10 * 60_000, error: '' })))
    let now = 8 * 60_000
    const poller = new MirofishPoller({ dir, fetch: s.fetcher, now: () => now })
    await poller.poll()
    now += 3 * 60_000
    await poller.poll()
    assert.equal(generates(s.calls), 0)
    assert.equal(fs.existsSync(`${mark}.lock`), false, 'lock released')
  })
  it('takes over a stale lock', async () => {
    const dir = tmp(), lock = path.join(dir, 'sim-9.requested.lock')
    fs.writeFileSync(path.join(dir, 'sim-9.requested'), JSON.stringify({ n: 1, at: 0, error: 'x' }))
    fs.writeFileSync(lock, '')
    fs.utimesSync(lock, new Date(Date.now() - 120_000), new Date(Date.now() - 120_000))
    const s = stuck()
    let now = 8 * 60_000
    const poller = new MirofishPoller({ dir, fetch: s.fetcher, now: () => now })
    await poller.poll()
    now += 3 * 60_000
    await poller.poll()
    assert.equal(generates(s.calls), 1)
  })
})

describe('MiroFish dismissed sims', () => {
  const sim = (status: string, updated: string, runUpdated?: string) => async (url: string) => {
    if (url.endsWith('/api/simulation/list')) return response({ data: [{ simulation_id: 'sim-d', status, updated_at: updated }] })
    if (url.endsWith('/sim-d/run-status')) return response({ data: { current_round: status === 'running' ? 3 : 10, total_rounds: 10, runner_status: status, twitter_completed: status !== 'running', reddit_completed: status !== 'running', ...(runUpdated ? { updated_at: runUpdated } : {}) } })
    if (url.includes('by-simulation')) return response({ data: { status: 'completed', markdown_content: '# Done\nbody' } })
    return response({ data: {} })
  }
  it('still saves the report of a dismissed sim', async () => {
    const dir = tmp()
    fs.writeFileSync(path.join(dir, 'sim-d.dismissed'), '')
    const now = Date.parse('2026-11-19T12:00:00Z')
    assert.equal(await new MirofishPoller({ dir, fetch: sim('completed', '2026-11-19T11:50:00Z'), now: () => now }).poll(), undefined)
    assert.equal(fs.existsSync(path.join(dir, 'sim-d.md')), true)
  })
  it('forgets a dismissed marker after 24 hours', async () => {
    const dir = tmp(), mark = path.join(dir, 'sim-d.dismissed')
    fs.writeFileSync(mark, '')
    const old = new Date(Date.now() - 25 * 3600_000)
    fs.utimesSync(mark, old, old)
    const poller = new MirofishPoller({ dir, fetch: sim('running', '2026-11-19T11:50:00Z'), now: () => 0 })
    assert.equal((await poller.poll())?.simId, 'sim-d')
    assert.equal(fs.existsSync(mark), false)
  })
  it('falls back to the sim list update time for the stall clock', async () => {
    let now = 0
    const poller = new MirofishPoller({ dir: tmp(), fetch: sim('running', '1970-01-01T00:20:00Z'), now: () => now })
    await poller.poll()
    now = 31 * 60_000
    assert.equal((await poller.poll())?.stalled, undefined)
    now = 51 * 60_000
    assert.equal((await poller.poll())?.stalled, true)
  })
})
