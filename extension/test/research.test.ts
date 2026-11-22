/** Research mode backend: the folder, the offers, the route and the scoped recall. */
import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { OFFER_MS, RESEARCH_ROOT, addOffer, dropOffer, ensureResearchRoot, isResearch } from '../src/hub/research'
import { buildGraph, recall, slugOf } from '../src/hub/graph'
import { HubService, emptyHub } from '../src/hub/hub-service'
import { commandProblem, handleHub, type HubReply } from '../src/hub/routes'
import { projectFolders } from '../src/hub/local'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'research-'))
after(() => fs.rmSync(tmp, { recursive: true, force: true }))

describe('RESEARCH_ROOT and isResearch', () => {
  it('sits in Documents under the home folder', () => {
    assert.equal(RESEARCH_ROOT, path.join(os.homedir(), 'Documents', 'Research'))
  })

  it('takes the root and anything under it, not a sibling or a parent', () => {
    assert.equal(isResearch(RESEARCH_ROOT), true)
    assert.equal(isResearch(`${RESEARCH_ROOT}/`), true)
    assert.equal(isResearch(`${RESEARCH_ROOT}/ai-agents/notes`), true)
    assert.equal(isResearch(`${RESEARCH_ROOT}2`), false)
    assert.equal(isResearch(`${RESEARCH_ROOT}-old/x`), false)
    assert.equal(isResearch(path.dirname(RESEARCH_ROOT)), false)
    assert.equal(isResearch(`${RESEARCH_ROOT}/../GitHub/app`), false)
  })

  it('says no to anything that is not a path', () => {
    for (const v of [undefined, null, 42, '', {}]) assert.equal(isResearch(v), false)
  })

  it('reads a root passed in, with backslashes', () => {
    assert.equal(isResearch('C:\\Users\\k\\Documents\\Research\\a', 'C:\\Users\\k\\Documents\\Research'), true)
    assert.equal(isResearch('/w/GitHub/app', '/w/Research'), false)
  })
})

describe('ensureResearchRoot', () => {
  it('creates the folder once and returns it', () => {
    const dir = path.join(tmp, 'a', 'Research')
    assert.equal(fs.existsSync(dir), false)
    assert.equal(ensureResearchRoot(dir), dir)
    assert.equal(fs.statSync(dir).isDirectory(), true)
    assert.equal(ensureResearchRoot(dir), dir)
  })
})

describe('projectFolders', () => {
  it('always lists the research folder as a project, made on demand', async () => {
    const dir = path.join(tmp, 'b', 'Research')
    const { claude } = await projectFolders([], dir)
    assert.ok(claude.includes(dir))
    assert.equal(fs.existsSync(dir), true)
  })
})

describe('research offers', () => {
  const o = (sessionId: string) => ({ sessionId, score: 0.8, reason: 'asks to compare tools' })

  it('adds an offer with the time it came', () => {
    assert.deepEqual(addOffer(undefined, o('add-1'), 1000), [{ ...o('add-1'), at: 1000 }])
  })

  it('keeps one offer per session', () => {
    const once = addOffer(undefined, o('dup-1'), 1000)
    assert.deepEqual(addOffer(once, { ...o('dup-1'), score: 0.9 }, 2000), once)
    assert.equal(addOffer(once, o('dup-2'), 2000).length, 2)
  })

  it('drops an offer after 30 minutes', () => {
    const list = addOffer(undefined, o('old-1'), 1000)
    assert.equal(OFFER_MS, 30 * 60_000)
    assert.equal(addOffer(list, o('old-2'), 1000 + OFFER_MS - 1).length, 2)
    assert.deepEqual(addOffer(list, o('old-2'), 1000 + OFFER_MS).map(x => x.sessionId), ['old-2'])
  })

  it('drops a dismissed offer and does not offer that session again', () => {
    const list = addOffer(undefined, o('gone-1'), 1000)
    assert.deepEqual(dropOffer(list, 'gone-1'), [])
    assert.deepEqual(addOffer([], o('gone-1'), 2000), [])
    assert.deepEqual(dropOffer(undefined, 'gone-2'), [])
  })
})

describe('/hub/research-offer', () => {
  const body = (sessionId: string, extra: object = {}) => encodeURIComponent(JSON.stringify({ sessionId, score: 0.7, reason: 'wants a survey', ...extra }))
  const get = (h: HubService, q: string, token = h.token) => handleHub(h, 'GET', `/hub/research-offer?token=${token}&cwd=/w/app&session=s&q=${q}`, '') as HubReply

  it('stores the offer in hub state', () => {
    const h = new HubService()
    assert.equal(get(h, body('route-1')).status, 200)
    const [offer] = h.get().researchOffers!
    assert.deepEqual({ ...offer, at: 0 }, { sessionId: 'route-1', score: 0.7, reason: 'wants a survey', at: 0 })
    assert.ok(Math.abs(offer.at - Date.now()) < 5000)
  })

  it('does not store a session twice', () => {
    const h = new HubService()
    get(h, body('route-2'))
    get(h, body('route-2'))
    assert.equal(h.get().researchOffers!.length, 1)
  })

  it('refuses a wrong token and a body that is not an offer', () => {
    const h = new HubService()
    assert.equal(get(h, body('route-3'), 'nope').status, 403)
    assert.equal(get(h, 'not-json').status, 400)
    assert.equal(get(h, encodeURIComponent('{"sessionId":"x"}')).status, 400)
    assert.equal(get(h, body('route-3', { score: 'high' })).status, 400)
    assert.equal(get(h, body('route-3', { reason: 'r'.repeat(300) })).status, 400)
    assert.equal(get(h, body('')).status, 400)
    assert.equal(h.get().researchOffers, undefined)
  })

  it('takes hub-research-dismiss with a session id only', () => {
    assert.equal(commandProblem({ type: 'hub-research-dismiss', sessionId: 'route-4' }), undefined)
    assert.ok(commandProblem({ type: 'hub-research-dismiss' }))
    assert.ok(commandProblem({ type: 'hub-research-dismiss', sessionId: 4 }))
  })
})

describe('recall scope', () => {
  const mem = (name: string, links = '') => `---\nname: ${name}\ndescription: ${name} notes\nmetadata:\n  type: reference\n---\nAbout ${name}.${links}\n`
  const state = { ...emptyHub(), projects: [{ name: 'Research', path: RESEARCH_ROOT, kind: 'project' as const, isOpen: false }, { name: 'app', path: '/w/app', kind: 'repo' as const, isOpen: false }] }
  const g = buildGraph(state, [
    { dir: slugOf(RESEARCH_ROOT), file: 'agent-survey.md', text: mem('agent-survey', ' See [[agent-code]].') },
    { dir: slugOf('/w/app'), file: 'agent-code.md', text: mem('agent-code') },
    { dir: slugOf('/w/app'), file: 'agent-ui.md', text: mem('agent-ui') },
  ], [])

  it('answers from every project with no scope', () => {
    const r = recall(g, 'agent')
    assert.match(r, /agent-survey: agent-survey notes/)
    assert.match(r, /\n\(agent-survey\) --\[link\]--> \(agent-code\)/)
    assert.match(r, /agent-ui: agent-ui notes/)
  })

  it('answers from the research folder only with scope research', () => {
    const r = recall(g, 'agent', 2, undefined, 'research')
    assert.match(r, /agent-survey: agent-survey notes/)
    assert.doesNotMatch(r, /\(agent-code\)|agent-ui/)
  })

  it('says so when research holds nothing on the query', () => {
    assert.equal(recall(g, 'ui', 2, undefined, 'research'), 'Nothing in memory matches "ui".')
  })

  it('reads ?scope=research on the route, takes all as no scope and refuses another scope', async () => {
    const h = new HubService()
    const read = () => Promise.resolve(g)
    const hit = (scope: string) => handleHub(h, 'GET', `/hub/recall?token=${h.token}&q=agent${scope}`, '', undefined, undefined, read) as Promise<HubReply>
    assert.doesNotMatch((await hit('&scope=research')).body, /\(agent-code\)|agent-ui/)
    assert.match((await hit('')).body, /agent-ui/)
    const all = await hit('&scope=all')
    assert.equal(all.status, 200)
    assert.match(all.body, /agent-ui/)
    assert.equal((await hit('&scope=other')).status, 400)
  })
})
