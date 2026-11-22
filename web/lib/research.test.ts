import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentEvent } from './bridge-types'
import { answerBlocks, citations, elapsedOf, emptyRun, fmtElapsed, foldResearch, inline, isCited, reduceResearch, siteOf, visibleLanes } from './research'

const S = 'sess-1'
let t = 0
const ev = (type: string, payload: Record<string, unknown>, sessionId = S): AgentEvent => ({ time: ++t, type, payload, sessionId })
const user = (content: string, agent = 'orchestrator') => ev('message', { agent, role: 'user', content })
const said = (content: string, agent = 'orchestrator') => ev('message', { agent, role: 'assistant', content })
const start = (agent: string, tool: string, args: string, inputData?: Record<string, unknown>) => ev('tool_call_start', { agent, tool, args, inputData })
const end = (agent: string, tool: string, result = 'ok') => ev('tool_call_end', { agent, tool, result })
const fold = (events: AgentEvent[]) => foldResearch(events, S, 1000)

test('nothing shows before research starts; the question is the user message before it', () => {
  t = 0
  const before = fold([user('Do heat pumps work at -25 C?'), said('Let me look.')])
  assert.equal(before.status, 'waiting')
  assert.equal(before.feed.length, 0)
  const run = fold([user('Do heat pumps work at -25 C?'), start('orchestrator', 'Skill', 'deep-research')])
  assert.equal(run.status, 'running')
  assert.equal(run.question, 'Do heat pumps work at -25 C?')
})

test('events from other sessions are ignored', () => {
  t = 0
  const run = fold([start('orchestrator', 'WebSearch', 'x', { query: 'x' }), ev('tool_call_start', { agent: 'orchestrator', tool: 'WebSearch', args: 'y', inputData: { query: 'y' } }, 'other')])
  assert.deepEqual(run.feed.map(f => f.kind === 'search' && f.query), ['x'])
})

test('searches run then finish, matched by agent and tool', () => {
  t = 0
  let run = fold([start('orchestrator', 'WebSearch', 'cold climate heat pump', { query: 'cold climate heat pump' })])
  assert.equal(run.feed[0].kind, 'search')
  assert.equal(run.feed[0].state, 'running')
  run = reduceResearch(run, end('orchestrator', 'WebSearch'), S, 2000)
  assert.equal(run.feed[0].state, 'done')
})

test('sources: reading then read, re-reads count once, failures show', () => {
  t = 0
  const url = 'https://www.nrel.gov/docs/fy23/heat-pumps.pdf#p2'
  const run = fold([
    start('orchestrator', 'WebFetch', 'nrel.gov/docs', { url, prompt: 'COP at -25' }),
    end('orchestrator', 'WebFetch', 'COP is 1.8 at -25 C'),
    start('orchestrator', 'WebFetch', 'nrel.gov/docs', { url: 'https://www.nrel.gov/docs/fy23/heat-pumps.pdf' }),
    start('orchestrator', 'WebFetch', 'example.com', { url: 'https://example.com/a' }),
    end('orchestrator', 'WebFetch', 'ok'),
    end('orchestrator', 'WebFetch', '[FAILED] Request failed with status code 403'),
  ])
  const sources = run.feed.filter(f => f.kind === 'source')
  assert.equal(sources.length, 2)
  assert.equal(sources[0].kind === 'source' && sources[0].reads, 2)
  assert.equal(sources[0].state, 'read')
  assert.equal(sources[1].state, 'failed')
})

test('subagent lanes: dispatch, brief, sources counted, return checks them off', () => {
  t = 0
  const lane = 'Field data on cold climate'
  let run = fold([
    start('orchestrator', 'Skill', 'deep-research'),
    ev('subagent_dispatch', { parent: 'orchestrator', child: lane, task: 'Field data on cold climate heat pumps' }),
    ev('agent_spawn', { name: lane, parent: 'orchestrator', task: 'Field data on cold climate heat pumps' }),
    user('Find measured COP below -20 C from field studies.', lane),
    start(lane, 'WebSearch', 'field study COP', { query: 'field study COP' }),
    start(lane, 'WebFetch', 'iea.org/reports', { url: 'https://www.iea.org/reports/heat-pumps' }),
  ])
  const [l] = visibleLanes(run)
  assert.equal(l.name, lane)
  assert.equal(l.task, 'Field data on cold climate heat pumps')
  assert.equal(l.brief, 'Find measured COP below -20 C from field studies.')
  assert.equal(l.state, 'running')
  assert.equal(l.sources, 1)
  assert.equal(l.searches, 1)
  assert.match(l.last ?? '', /iea\.org/)
  run = reduceResearch(run, ev('subagent_return', { child: lane, parent: 'orchestrator', summary: 'done' }), S, 2000)
  assert.equal(visibleLanes(run)[0].state, 'done')
})

test('a subagent with no web work and no research words stays out of the lanes', () => {
  t = 0
  const run = fold([
    start('orchestrator', 'Skill', 'deep-research'),
    ev('subagent_dispatch', { parent: 'orchestrator', child: 'Fix the build', task: 'Fix the build' }),
    ev('subagent_dispatch', { parent: 'orchestrator', child: 'Research pricing', task: 'Research pricing' }),
  ])
  assert.deepEqual(visibleLanes(run).map(l => l.name), ['Research pricing'])
})

test('answer is the lead latest assistant text after the start; depth is read from it', () => {
  t = 0
  let run = fold([user('q?'), said('ignored, before start'), start('orchestrator', 'Skill', 'deep-research'), said('Depth: deep. Fanning out three researchers.')])
  assert.equal(run.depth, 'deep')
  run = reduceResearch(run, said('Researcher note', 'Some lane'), S, 2000)
  assert.equal(run.answer, 'Depth: deep. Fanning out three researchers.')
  run = reduceResearch(run, said('**Answer:** yes.'), S, 2000)
  assert.equal(run.answer, '**Answer:** yes.')
})

test('the lead finishing ends the run; a new question and a new start begin a fresh one', () => {
  t = 0
  let run = fold([user('first?'), start('orchestrator', 'WebSearch', 'a', { query: 'a' }), ev('agent_complete', { name: 'orchestrator' })])
  assert.equal(run.status, 'done')
  run = reduceResearch(run, user('second?'), S, 2000)
  run = reduceResearch(run, start('orchestrator', 'WebSearch', 'b', { query: 'b' }), S, 2000)
  assert.equal(run.status, 'running')
  assert.equal(run.question, 'second?')
  assert.deepEqual(run.feed.map(f => f.kind === 'search' && f.query), ['b'])
})

test('more web work on the same question after done goes live again, same run', () => {
  t = 0
  let run = fold([user('q?'), start('orchestrator', 'WebSearch', 'a', { query: 'a' }), ev('agent_complete', { name: 'orchestrator' })])
  run = reduceResearch(run, start('orchestrator', 'WebSearch', 'b', { query: 'b' }), S, 2000)
  assert.equal(run.status, 'running')
  assert.equal(run.feed.length, 2)
})

test('an answer with a Sources list and nothing running counts as done', () => {
  t = 0
  const run = fold([start('orchestrator', 'WebSearch', 'a', { query: 'a' }), end('orchestrator', 'WebSearch'), said('**Answer:** yes.\n\n## Sources\n[1] NREL. https://nrel.gov/x')])
  assert.equal(run.status, 'done')
})

test('elapsed comes from event times and ticks on while running', () => {
  const run = { ...emptyRun(), status: 'running' as const, t0: 10, tLast: 70, seenAt: 5000 }
  assert.equal(Math.round(elapsedOf(run, 8000)), 63)
  assert.equal(Math.round(elapsedOf({ ...run, status: 'done' }, 8000)), 60)
  assert.equal(fmtElapsed(63), '1:03')
  assert.equal(fmtElapsed(3725), '1:02:05')
})

test('siteOf: host, short path and a monogram from the site name', () => {
  const s = siteOf('https://en.wikipedia.org/wiki/Heat_pump?x=1')
  assert.equal(s.host, 'en.wikipedia.org')
  assert.equal(s.path, '/wiki/Heat_pump')
  assert.equal(s.letter, 'W')
  assert.equal(siteOf('https://www.bbc.co.uk/news').letter, 'B')
  assert.equal(siteOf('https://www.bbc.co.uk/news').host, 'bbc.co.uk')
  assert.ok(siteOf('https://arxiv.org/abs/1').hue >= 0 && siteOf('https://arxiv.org/abs/1').hue < 6)
  assert.equal(siteOf('not a url').host, 'not a url')
})

test('citations map [n] to its URL; cited sources are found in the answer', () => {
  const text = '**Answer:** yes [1].\n\n## Sources\n[1] NREL report, 2023. https://www.nrel.gov/docs/x.pdf\n[2] IEA. <https://iea.org/r>'
  assert.deepEqual(citations(text), { 1: 'https://www.nrel.gov/docs/x.pdf', 2: 'https://iea.org/r' })
  assert.equal(isCited(text, 'https://www.nrel.gov/docs/x.pdf'), true)
  assert.equal(isCited(text, 'https://nrel.gov/docs/x.pdf/'), true)
  assert.equal(isCited(text, 'https://other.org/'), false)
})

test('answerBlocks: headings, lists and paragraphs', () => {
  const blocks = answerBlocks('## Findings\nLine one\nline two\n\n- a\n- b\n1. c')
  assert.deepEqual(blocks.map(b => b.type), ['h', 'p', 'li', 'li', 'li'])
  assert.equal(blocks[1].text, 'Line one line two')
  assert.equal(blocks[4].type === 'li' && blocks[4].n, 1)
})

test('inline: bold, code, links, bare urls and citations', () => {
  const parts = inline('**Yes** see `x` [NREL](https://nrel.gov) or https://iea.org. [2]')
  assert.deepEqual(parts.map(p => p.t), ['b', 'text', 'code', 'text', 'link', 'text', 'link', 'text', 'cite'])
  const bare = parts[6]
  assert.equal(bare.t === 'link' && bare.href, 'https://iea.org')
})

test('the demo script plays a whole run: three lanes back, one failed read, cited sources, done', async () => {
  const { demoScript, DEMO_SESSION } = await import('./research-demo')
  const steps = demoScript()
  const run = foldResearch(steps.map(s => s.event), DEMO_SESSION, 0)
  const last = steps[steps.length - 1].at
  assert.ok(last > 20_000 && last < 32_000, `length ${last}`)
  assert.equal(run.status, 'done')
  assert.equal(run.depth, 'deep')
  assert.deepEqual(visibleLanes(run).map(l => l.state), ['done', 'done', 'done'])
  const sources = run.feed.filter(f => f.kind === 'source')
  assert.equal(sources.filter(s => s.state === 'failed').length, 1)
  assert.ok(sources.filter(s => s.kind === 'source' && isCited(run.answer, s.url)).length >= 4)
})

test('looksLikeAnswer tells the report from a progress note', async () => {
  const { looksLikeAnswer } = await import('./research')
  assert.equal(looksLikeAnswer('Depth: deep. Fanning out three researchers.'), false)
  assert.equal(looksLikeAnswer('**Answer:** yes.'), true)
  assert.equal(looksLikeAnswer('## Findings\n- a'), true)
})

test('qa: the report from a researcher subagent is the answer; later lead chatter does not replace it', () => {
  t = 0
  const lane = 'Research heat pumps'
  let run = fold([
    user('q?'),
    ev('subagent_dispatch', { parent: 'orchestrator', child: lane, task: lane }),
    start(lane, 'WebSearch', 'a', { query: 'a' }),
    said('Working on it.'),
    said('**Answer:** yes [1].\n\n## Sources\n[1] X. https://x.org/a', lane),
  ])
  assert.match(run.answer ?? '', /\*\*Answer:\*\*/)
  run = reduceResearch(run, said('Next I will fix the build.'), S, 2000)
  assert.match(run.answer ?? '', /\*\*Answer:\*\*/)
})

test('qa: settles once every research lane is back and the lead spoke after them', () => {
  t = 0
  const lane = 'Research pricing'
  let run = fold([
    user('q?'),
    ev('subagent_dispatch', { parent: 'orchestrator', child: lane, task: lane }),
    start(lane, 'WebSearch', 'a', { query: 'a' }),
    end(lane, 'WebSearch'),
    said('Waiting on the researcher.'),
    ev('subagent_return', { child: lane, parent: 'orchestrator', summary: 'rows' }),
  ])
  assert.equal(run.status, 'running')
  run = reduceResearch(run, said('Here is what it found, roughly.'), S, 2000)
  assert.equal(run.status, 'done')
  run = reduceResearch(run, ev('subagent_dispatch', { parent: 'orchestrator', child: 'Fix the build', task: 'Fix the build' }), S, 3000)
  assert.equal(run.status, 'done')
})

test('qa: lanes count as research by web work, researcher type or a research verb first', () => {
  t = 0
  const run = fold([
    start('orchestrator', 'Skill', 'deep-research'),
    ev('subagent_dispatch', { parent: 'orchestrator', child: 'Fix comets map review findings', task: 'Fix comets map review findings' }),
    ev('subagent_dispatch', { parent: 'orchestrator', child: 'Security review of Research routes', task: 'Security review of Research routes' }),
    ev('subagent_dispatch', { parent: 'orchestrator', child: 'Investigate COP data', task: 'Investigate COP data' }),
    ev('agent_spawn', { name: 'pricing', parent: 'orchestrator', task: 'pricing', subagent_type: 'researcher' }),
    ev('subagent_dispatch', { parent: 'orchestrator', child: 'Grid load', task: 'Grid load' }),
    start('Grid load', 'WebFetch', 'x.org', { url: 'https://x.org' }),
  ])
  assert.deepEqual(visibleLanes(run).map(l => l.name), ['Investigate COP data', 'pricing', 'Grid load'])
})

test('qa: tool_call_end with a URL closes that source, not the oldest', () => {
  t = 0
  const run = fold([
    start('orchestrator', 'WebFetch', 'a', { url: 'https://a.org/1' }),
    start('orchestrator', 'WebFetch', 'b', { url: 'https://b.org/2' }),
    ev('tool_call_end', { agent: 'orchestrator', tool: 'WebFetch', result: 'ok', url: 'https://b.org/2' }),
  ])
  assert.deepEqual(run.feed.map(f => f.state), ['reading', 'read'])
})

test('qa: the question posted after the replay fills an empty question', () => {
  t = 0
  let run = fold([
    ev('agent_spawn', { name: 'orchestrator', isMain: true, task: 'chat' }),
    ev('subagent_dispatch', { parent: 'orchestrator', child: 'Research pricing', task: 'Research pricing' }),
  ])
  assert.equal(run.status, 'running')
  assert.equal(run.question, undefined)
  run = reduceResearch(run, user('What does X cost?'), S, 2000)
  assert.equal(run.question, 'What does X cost?')
  const ended = reduceResearch(fold([ev('subagent_dispatch', { parent: 'orchestrator', child: 'Research pricing', task: 'Research pricing' }), ev('agent_complete', { name: 'orchestrator' })]), user('Q?'), S, 2000)
  assert.equal(ended.question, 'Q?')
  assert.equal(ended.fresh, undefined)
})

test('a qa or engineer report never replaces the research answer', () => {
  t = 0
  const lane = 'Research heat pumps'
  let run = fold([
    user('q?'),
    ev('subagent_dispatch', { parent: 'orchestrator', child: lane, task: lane }),
    start(lane, 'WebSearch', 'a', { query: 'a' }),
    said('**Answer:** yes [1].\n\n## Sources\n[1] X. https://x.org/a', lane),
    ev('subagent_dispatch', { parent: 'orchestrator', child: 'QA research window change', task: 'QA research window change' }),
  ])
  run = reduceResearch(run, said('**Status: done.**\n\n## Findings\n1. a bug', 'QA research window change'), S, 2000)
  assert.match(run.answer ?? '', /^\*\*Answer:\*\* yes/)
})
