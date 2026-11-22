// A scripted deep-research run for ?research=demo: the same events the extension sends, on a timer.
import type { AgentEvent } from './bridge-types'

export const DEMO_SESSION = 'demo'
export const DEMO_CHAT = 'Cold climate heat pumps'

type Step = { at: number; event: AgentEvent }

const A = 'Field data below -20 C'
const B = 'Cold-climate model specs'
const C = 'Backup heat in cold snaps'

const ANSWER = [
  '**Answer:** Yes. Cold-climate air-source heat pumps keep heating at -25 C, at a lower efficiency (COP around 1.5 to 2) and with less output, so most homes size for it or keep a small backup [1][2].',
  '**Confidence:** high for output and COP (field data and specs agree), medium for grid load.',
  '## Findings',
  '- Field studies measured a COP of 1.5 to 2.1 between -20 and -26 C, still well above resistance heat [1].',
  '- Cold-climate rated units keep 70 to 100 percent of rated output at -15 C and run down to about -30 C [2][3].',
  '- In long cold snaps, backup heat covers the gap; sizing to the design temperature keeps it rare [4].',
  '## Sources',
  '[1] Cold climate field study, 2023. https://www.nrel.gov/docs/fy23/cold-climate-heat-pump-field-study.pdf',
  '[2] Cold climate heat pump specification. https://neep.org/heating-electrification/ccashp-specification',
  '[3] The Future of Heat Pumps. https://www.iea.org/reports/the-future-of-heat-pumps',
  '[4] Heat pump systems. https://www.energy.gov/energysaver/heat-pump-systems',
]

/** The run, about 28 s long; at: ms from the start. */
export function demoScript(): Step[] {
  const steps: Step[] = []
  let ms = 0
  const add = (gap: number, type: string, payload: Record<string, unknown>) => {
    ms += gap
    steps.push({ at: ms, event: { time: 1 + ms / 1000, type, payload, sessionId: DEMO_SESSION } })
  }
  const search = (gap: number, agent: string, query: string, took = 900) => {
    add(gap, 'tool_call_start', { agent, tool: 'WebSearch', args: query, inputData: { query } })
    const at = ms
    return () => { if (ms < at + took) ms = at + took; add(0, 'tool_call_end', { agent, tool: 'WebSearch', result: '10 results' }) }
  }
  const fetchStart = (gap: number, agent: string, url: string) => add(gap, 'tool_call_start', { agent, tool: 'WebFetch', args: url, inputData: { url, prompt: 'Pull the numbers for COP and output below -20 C' } })
  const fetchEnd = (gap: number, agent: string, result = 'Read the page') => add(gap, 'tool_call_end', { agent, tool: 'WebFetch', result })
  const lane = (gap: number, name: string, task: string, brief: string) => {
    add(gap, 'subagent_dispatch', { parent: 'orchestrator', child: name, task })
    add(0, 'agent_spawn', { name, parent: 'orchestrator', task })
    add(120, 'message', { agent: name, role: 'user', content: brief })
  }
  const say = (gap: number, content: string) => add(gap, 'message', { agent: 'orchestrator', role: 'assistant', content })

  add(0, 'agent_spawn', { name: 'orchestrator', isMain: true, task: DEMO_CHAT })
  add(200, 'message', { agent: 'orchestrator', role: 'user', content: 'Do air-source heat pumps still heat a house at -25 C, and what backs them up in a long cold snap?' })
  add(500, 'tool_call_start', { agent: 'orchestrator', tool: 'Skill', args: 'deep-research' })
  say(700, 'Depth: deep. Broad and partly contested, so I will fan out three researchers: field data, model specs, and backup heat.')
  let done = search(600, 'orchestrator', 'cold climate air source heat pump performance -25 C')
  done()
  done = search(300, 'orchestrator', 'heat pump COP field study below -20 C')
  done()

  lane(700, A, 'Field data on heat pump output below -20 C', 'Find measured COP and output below -20 C from field studies; primary sources only.')
  lane(250, B, 'Cold-climate model specs and ratings', 'What do cold-climate rated models promise at -15 and -25 C? Use specs and rating programs.')
  lane(250, C, 'Backup heat and grid load in cold snaps', 'How do homes cover the gap in long cold snaps, and what does it do to grid load?')

  const a1 = search(500, A, 'NREL cold climate heat pump field study')
  const b1 = search(250, B, 'NEEP cold climate heat pump specification')
  const c1 = search(250, C, 'heat pump backup heat cold snap grid peak')
  a1(); b1(); c1()
  fetchStart(300, A, 'https://www.nrel.gov/docs/fy23/cold-climate-heat-pump-field-study.pdf')
  fetchStart(250, B, 'https://neep.org/heating-electrification/ccashp-specification')
  fetchStart(300, C, 'https://www.energy.gov/energysaver/heat-pump-systems')
  fetchEnd(1300, B)
  fetchStart(300, B, 'https://www.iea.org/reports/the-future-of-heat-pumps')
  fetchEnd(700, A)
  fetchStart(300, A, 'https://www.canada.ca/en/natural-resources-canada/news/heat-pumps-in-cold-climates.html')
  fetchEnd(500, C)
  const c2 = search(300, C, 'ERCOT winter storm heat pump demand')
  c2()
  fetchStart(300, C, 'https://www.ercot.com/news/winter-storm-review')
  fetchEnd(900, A)
  fetchStart(300, A, 'https://arxiv.org/abs/2304.09813')
  fetchEnd(600, C, '[FAILED] Request failed with status code 403')
  fetchStart(300, C, 'https://en.wikipedia.org/wiki/Air_source_heat_pump')
  fetchEnd(800, B)
  const b2 = search(300, B, 'Mitsubishi Hyper-Heat rated output -25 C')
  b2()
  fetchStart(300, B, 'https://www.mitsubishicomfort.com/hyper-heating-technology')
  fetchEnd(900, A)
  add(300, 'subagent_return', { child: A, parent: 'orchestrator', summary: '6 ledger rows' })
  add(0, 'agent_complete', { name: A })
  fetchEnd(500, C)
  add(500, 'subagent_return', { child: C, parent: 'orchestrator', summary: '4 ledger rows' })
  add(0, 'agent_complete', { name: C })
  fetchEnd(700, B)
  add(400, 'subagent_return', { child: B, parent: 'orchestrator', summary: '5 ledger rows' })
  add(0, 'agent_complete', { name: B })

  say(800, 'Merging 15 ledger rows. Two sources disagree on output at -25 C; re-checking both before I write.')
  fetchStart(700, 'orchestrator', 'https://www.nrel.gov/docs/fy23/cold-climate-heat-pump-field-study.pdf')
  fetchStart(200, 'orchestrator', 'https://neep.org/heating-electrification/ccashp-specification')
  fetchEnd(1100, 'orchestrator')
  fetchEnd(300, 'orchestrator')
  // The answer forms a few lines at a time.
  for (const n of [1, 2, 4, 5, 6, ANSWER.length]) say(n === 1 ? 700 : 650, ANSWER.slice(0, n).join('\n\n'))
  add(900, 'agent_complete', { name: 'orchestrator' })
  return steps
}
