/** Demo data for Live > Source check: one finished run with every band, one still being written. hub-demo.ts reads it as `sourceChecks`. */
import type { SourceRun } from './source-check'

export const demoSourceChecks = (now: number): SourceRun[] => [
  {
    id: 'demo-sc-2', question: 'Is one app per team cheaper than a shared board?', at: now - 40e3, done: false,
    sources: [
      { url: 'https://www.nngroup.com/articles/dashboards-preattentive/', band: 'Reliable', score: 84, reasons: ['Citations: 9 of 9 links resolve; 6 are primary studies', 'Domain prior: rated high in Lin et al. 2023'] },
      { url: 'https://blog.example-saas.com/10-reasons-boards-win', band: 'Unverifiable', score: 31, reasons: ['Only the outlet could be checked: no byline, no citations on the page', 'Cross-source: no independent outlet covers it'] },
    ],
  },
  {
    id: 'demo-sc-1', question: 'Does the MMR vaccine cause autism?', at: now - 2 * 3600e3, done: true, report: '/Users/k/.claude/switchboard/source-check/demo-sc-1.html',
    sources: [
      { url: 'https://www.cdc.gov/vaccine-safety/about/autism.html', band: 'Reliable', score: 91, reasons: ['Domain prior: government health agency', 'Citations: 14 of 14 links resolve; 11 are primary sources', 'Cross-source: 8 independent outlets agree'] },
      { url: 'https://www.cochrane.org/CD004407/', band: 'Reliable', score: 88, reasons: ['Citations: 60 references deposited with Crossref', 'Author: ORCID confirmed for 4 of 5 authors'] },
      { url: 'https://www.nytimes.com/2019/03/05/health/vaccines-autism.html', band: 'Mixed', score: 69, reasons: ['Wikipedia RSP: generally reliable', 'Citations: 4 of 6 checked links resolve; blocked links are not counted', 'Author: named byline, no ORCID'] },
      { url: 'https://babylonbee.com/news/study-vaccines', band: 'Satire', score: 38, reasons: ['Lateral reputation: Wikipedia calls the outlet satire', 'Citations: no outbound links'] },
      { url: 'https://doi.org/10.1016/S0140-6736(97)11096-0', band: 'Retracted', score: 10, reasons: ['Crossref lists a retraction: capped at 10', 'Retraction: retracted 2010-02-06 (via Retraction Watch)', 'Citations: 12 of 12 cited sources are primary or well rated'] },
      { url: 'https://naturalnews-demo.example/vaccine-cover-up', band: 'Unreliable', score: 17, reasons: ['Domain prior: rated low in Lin et al. 2023', 'Wikipedia RSP: deprecated', 'Cross-source: no independent outlet covers it; a debunking headline costs 2'] },
    ],
  },
]
