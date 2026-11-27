/**
 * Hub states for when no extension is there: empty, and a sample for the browser demo.
 * The sample mirrors a real week on Kenneth's Mac so the demo reads true.
 */
import type { HubCommand } from './vscode-bridge'
import { holdOf, runIds, type Held } from './todo'
import { projectName, splitVersion } from './archive'
import { looksMulti } from './split-plan'
import type { ChangedFile, ChatLink, ChatProfile, ChatProgress, HubState, RepoView, TodoItem, TodoList, ToolCall, ShipRepo, ShipTree } from './hub-types'
import { isShipId, shipOf } from './ship-list'
import type { RunCall, RunDetail } from './runs'
import type { ChatAnswer, ChatAsk, ChatMessage, ChatOutputs } from './chat-view'
import { demoSourceChecks } from './source-check-demo'
import { demoStations } from './stations-demo'
import type { SmartPickRow, SmartState, SmartVerdict } from './smart'

export const emptyHub = (): HubState => ({
  live: [], history: [], sessions: [], plan: null,
  servers: [], git: null, aws: [], signIns: { chrome: [], projects: {} }, jev: [], waits: [], installed: [], connections: [], rc: { atStartup: false },
  keep: { autoCompact: true, autoContinue: false, onFull: 'fresh', freshBranch: false },
  projects: [],
  controls: {
    claude: { tui: 'default', statusLine: false, push: false, needInput: false },
    switchboard: { hooks: false, statusBar: true, idleMinutes: 15, brief: true, askBrain: true, syncRules: true, accessNote: true, autoStart: true, autoFix: true, name: '' },
    statusLineReady: false,
  },
  chats: [], rcServers: [], ais: [], starred: [], progress: [], archive: [],
  changes: null, search: null, webUrl: null, phoneUrls: null,
  tools: { flagged: DEMO_FLAGGED, pick: null, chats: {} },
})

const DEMO_TAILNET = 'http://mac.tail1234.ts.net'
// Same list as extension/src/hub/tools.ts FLAGGED.
const DEMO_FLAGGED: string[] = []
/** The extension asks a model; the demo turns on what the goal names, plus superpowers, and never a flagged one. */
const demoPick = (h: HubState, goal: string): ChatProfile => {
  const g = goal.toLowerCase(), named = (n: string) => g.includes(n.split('@')[0].split('-')[0])
  return {
    plugins: Object.fromEntries(h.installed.filter(i => i.kind === 'plugin').map(i => [i.name, !DEMO_FLAGGED.includes(i.name) && (i.name.startsWith('superpowers@') || named(i.name))])),
    skills: Object.fromEntries(h.installed.filter(i => i.kind === 'skill' && i.enabled).map(i => [i.name, named(i.name)])),
    extras: Object.fromEntries(h.installed.filter(i => i.kind === 'builtin' || i.kind === 'mcp').map(i => [i.name, i.kind === 'mcp' || named(i.name)])),
  }
}

const DAY = 86_400_000
const REREAD = [128.0, 0, 0, 428.2, 699.1, 1281.7, 1631.5, 685.5, 1751.8, 929.7, 1436.5, 229.7, 1306.3, 236.0]
const CALLS = [185, 0, 0, 869, 1212, 2486, 2885, 1240, 3011, 1790, 2702, 401, 5698, 704]

/** Opt-in board fx: ?demo=pause holds three chats (resume=<s> sets when they resume), ?demo=unlink ends the clash link after 6 s. */
export function demoFx(search: string, now: number): { pause?: HubState['pause']; unlinkAt?: number } {
  const q = new URLSearchParams(search), on = new Set((q.get('demo') ?? '').split(',')), resume = Number(q.get('resume')) || 83 * 60 + 4
  return {
    ...(on.has('pause') ? { pause: { kind: 'five_hour', percent: 96, resumeAt: now + resume * 1e3, chats: [{ sessionId: 'd-work' }, { sessionId: 'd-wrap' }, { sessionId: 'd-almost' }] } } : {}),
    ...(on.has('unlink') ? { unlinkAt: now + 6e3 } : {}),
  }
}
let unlinkAt: number | undefined
/** ?view=coder turns Coder view on; ?view=first leaves it unset, so the Simple or everything choice shows. */
const demoView = (search: string) => { const v = new URLSearchParams(search).get('view'); return v === 'first' ? {} : { coderView: v === 'coder' } }

// The demo's stand-in for the extension's plan (todo.ts upcoming), which the web cannot import.
// The extension's hold order: a chain says the first of these any of its items has.
const HOLDS: Held[] = ['blocked', 'you', 'ok', 'date', 'stopped']
// ctx: the window's autopilot switch, its wait links, how a chat is named, and which wait targets are still open.
function demoPlan(l: TodoList, live: Set<string>, ctx: { autoStart: boolean; links: ChatLink[]; name: (id: string) => string; open: (id: string) => string | undefined; now: number }): NonNullable<TodoList['plan']> {
  const todo = l.todo.filter(t => !(t.chat && live.has(t.chat))), taken = new Set<string>(), runs: Array<{ n: number; ids: string[] }> = []
  const ok = (t: TodoItem) => !holdOf(t, ctx.now) && !taken.has(t.id)
  const chain = (t: TodoItem) => { const s = runIds(todo, [t.id]); return todo.filter(x => s.has(x.id) && x !== t).concat(t) }
  for (let t; (t = todo.find(x => ok(x) && chain(x).every(ok)));) { const ids = chain(t).map(x => x.id); ids.forEach(id => taken.add(id)); runs.push({ n: (l.seq ?? 0) + runs.length + 1, ids }) }
  const why = (t: TodoItem) => { const h = chain(t).map(x => holdOf(x, ctx.now)); return HOLDS.find(k => h.includes(k)) ?? 'stopped' }
  // The hold only where the extension holds (todo.ts holdReason): autopilot on, something queued. A live to-do chat holds the start.
  const holder = l.todo.find(t => t.chat && live.has(t.chat)), out = holder ? (ctx.links.find(x => x.from === holder.chat)?.to ?? []) : []
  const open = out.flatMap(id => { const t = ctx.open(id); return t ? [ctx.name(t)] : [] })
  const hold = !(l.pilot?.on ?? ctx.autoStart) || !runs.length ? undefined : l.pilot?.paused ? { kind: 'paused' as const, text: 'Next to-do waits: autopilot is paused' } : holder && (open.length ? { kind: 'waiting' as const, text: `Next to-do waits: ${holder.text} is waiting on ${open.join(', ')} to finish` } : { kind: 'running' as const, text: `Next to-do starts when ${holder.text} finishes` })
  return { runs, held: todo.filter(t => !taken.has(t.id)).map(t => ({ id: t.id, why: why(t) })), ...(hold ? { hold } : {}) }
}
const withPlans = (h: HubState, now: number): HubState => {
  const live = new Set(h.chats.filter(c => c.live).map(c => c.sessionId))
  const name = (id: string) => h.chats.find(c => c.sessionId === id)?.name ?? id
  // A target that is done or waiting on Kenneth is no longer waited on (the extension's outcomeIn, from progress only here).
  const open = (id: string) => { const st = h.progress.find(p => p.sessionId === id)?.state; return st === 'done' || st === 'needs-you' ? undefined : id }
  const ctx = { autoStart: h.controls.switchboard.autoStart, links: h.links ?? [], name, open, now }
  return { ...h, todos: Object.fromEntries(Object.entries(h.todos ?? {}).map(([f, l]) => [f, { ...l, plan: demoPlan(l, live, ctx) }])) }
}

// ?demo=stalled shows the MiroFish sim as Stalled and the crowd-ab run as Stopped.
const demoSmart = (now: number): SmartState => {
  const m = 60e3
  const pick = (ago: number, session: string, title: string, kind: string, task: string, p: string, why: string, verdict: SmartVerdict, final?: string): SmartPickRow => ({ at: now - ago * m, session, title, kind, task, pick: p, why, verdict, ...(final ? { final } : {}) })
  return {
    rates: [
      { kind: 'ponytail', task: 'fix', pick: 'full', n: 14, useful: 12 }, { kind: 'ponytail', task: 'ui', pick: 'lite', n: 6, useful: 5 }, { kind: 'ponytail', task: 'tiny', pick: 'ultra', n: 9, useful: 8 },
      { kind: 'model', task: 'fix', pick: 'sonnet', n: 12, useful: 10 }, { kind: 'model', task: 'fix', pick: 'haiku', n: 5, useful: 2 }, { kind: 'model', task: 'feature', pick: 'opus', n: 7, useful: 6 }, { kind: 'model', task: 'tiny', pick: 'haiku', n: 11, useful: 10 },
      { kind: 'effort', task: 'fix', pick: 'medium', n: 12, useful: 9 }, { kind: 'effort', task: 'feature', pick: 'high', n: 8, useful: 6 },
      { kind: 'role', task: 'review', pick: 'qa on haiku', n: 6, useful: 5 }, { kind: 'role', task: 'ui', pick: 'designer on sonnet', n: 4, useful: 3 },
      { kind: 'question', task: 'name', pick: 'Keep Closet', n: 12, useful: 10 }, { kind: 'question', task: 'finish', pick: 'Approve', n: 20, useful: 18 },
    ],
    picks: [
      pick(6, 'd-ask', 'Outfit picker copy', 'question', 'name', 'Keep Closet', 'learned: Keep Closet kept 83% of 12', 'pending'),
      pick(22, 'd-work', 'Fix login redirect v4', 'model', 'fix', 'sonnet', 'a bug fix in a few files', 'pending'),
      pick(22, 'd-work', 'Fix login redirect v4', 'ponytail', 'fix', 'full', 'a fix wants the smallest diff that passes', 'pending'),
      pick(95, 'd-done', 'Hub AIs and Starred', 'role', 'review', 'qa on haiku', 'small diff, low risk', 'useful'),
      pick(180, 'd-tree', 'Fix login (worktree)', 'model', 'fix', 'haiku', 'a typo-sized change', 'not', 'sonnet'),
      pick(300, 'd-close', 'Size filter', 'effort', 'feature', 'high', 'new feature across several files', 'useful'),
      pick(1500, 'd-old', 'Receipts export', 'ponytail', 'ui', 'lite', 'screens need room for design choices', 'useful'),
    ],
  }
}
type DemoResearch = NonNullable<HubState['research']>[number]

const DEMO_RESEARCH_BODY: Record<string, string> = {
  r1: `## Answer
Use **sqlite-vec** on top of the official SQLite WASM build [1][2]. It runs inside the extension host with no native module, so the VSIX stays one package for every platform [3].

**Confidence:** High

## Key findings
- sqlite-vec's WASM build answers a 384 dimension top 10 query over 50k rows in 12 to 18 ms on an M2 [2].
- LanceDB and Chroma both pull native binaries; the VSIX would need a build per platform [4][5].
- hnswlib-wasm is faster on huge sets but keeps the index in memory and has no persistence story [6].
- Orama is pure JS and fine under 10k notes, but its vector search slows past that [7].
- One SQLite file keeps notes, links and vectors together, so the memory graph and recall read the same store [1].

## What to do
1. Add the WASM SQLite build and sqlite-vec as a loadable extension.
2. Embed notes in a background job; store vectors next to the note rows.
3. Keep the current keyword recall as a fallback when the index is cold.

## Sources
- [1] sqlite-vec docs https://alexgarcia.xyz/sqlite-vec/
- [2] sqlite-vec WASM benchmarks https://github.com/asg017/sqlite-vec/blob/main/benchmarks/README.md
- [3] VS Code platform specific extensions https://code.visualstudio.com/api/working-with-extensions/publishing-extension
- [4] LanceDB Node install https://lancedb.github.io/lancedb/basic/
- [5] Chroma JS client https://docs.trychroma.com/docs/overview/getting-started
- [6] hnswlib-wasm https://github.com/ShravanSunder/hnswlib-wasm
- [7] Orama vector search https://docs.orama.com/open-source/usage/search/vector-search
- [8] SQLite WASM https://sqlite.org/wasm/doc/trunk/index.md
- [9] Extension host limits https://code.visualstudio.com/api/advanced-topics/extension-host
`,
  r2: `## Answer
Both engines ship same-origin cross-document View Transitions through the **@view-transition** rule [1][2]. The gaps left are small but real for Armasu's page transitions.

**Confidence:** Medium

## Key findings
- Safari ignores **view-transition-class** on groups nested inside another named group [3].
- Types set in the pageswap event are dropped in Safari; Chrome applies them [4].
- Chrome caps the capture at the viewport; Safari captures the full element, so tall cards can jank [5].
- Both honor prefers-reduced-motion only if the CSS says so; neither turns transitions off by itself [6].

## What to do
1. Keep the opacity fallback for Safari on nested groups.
2. Set transition types from CSS media queries, not pageswap, until Safari catches up.

## Sources
- [1] MDN @view-transition https://developer.mozilla.org/en-US/docs/Web/CSS/@view-transition
- [2] WebKit features in Safari 18.2 https://webkit.org/blog/16301/webkit-features-in-safari-18-2/
- [3] WebKit bug 283511 https://bugs.webkit.org/show_bug.cgi?id=283511
- [4] Chrome cross-document transitions https://developer.chrome.com/docs/web-platform/view-transitions/cross-document
- [5] Can I use view transitions https://caniuse.com/view-transitions
- [6] CSS View Transitions Level 2 https://www.w3.org/TR/css-view-transitions-2/
- [7] Jake Archibald notes https://jakearchibald.com/2024/view-transitions-handling-aspect-ratio-changes/
`,
  r3: `## Answer
Pace by **tokens per minute** with a token bucket sized from the window, and stop new work at 85% of the window used [1][2].

**Confidence:** Medium

## Key findings
- Counting workers fails because one deep researcher can burn ten times a quick qa pass [3].
- A bucket refilled at window size divided by 300 minutes smoothed bursts in every published harness [2][4].
- Exponential backoff alone still caused retry storms when six workers hit the limit together [5].
- Jittered backoff plus a shared bucket cut 429s to near zero in the tests read [5][6].

## Sources
- [1] Anthropic rate limits https://docs.anthropic.com/en/api/rate-limits
- [2] Token bucket explained https://en.wikipedia.org/wiki/Token_bucket
- [3] Multi-agent research system https://www.anthropic.com/engineering/multi-agent-research-system
- [4] OpenAI rate limit guide https://platform.openai.com/docs/guides/rate-limits
- [5] AWS backoff and jitter https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
- [6] Google SRE handling overload https://sre.google/sre-book/handling-overload/

## Added 2026-11-22: What happens when two chats share one window?
Both draw from the same bucket, so pace by the account, not the chat [1][2].
- Give each chat a floor of one request a minute so none starves [2].
- Re-read the window size from the response headers, not a constant [1].

## Added 2026-11-24: Does the 85% stop apply to background runs too?
Yes, but let background runs stop at 70% so a foreground chat always has headroom [3].
- Mark runs as background when no one has typed for 10 minutes [3].
`,
  r4: `## Answer
The first prompt is slow because zsh rebuilds its completion cache and loads nvm on every start. Caching the completions and loading nvm on demand brings it from 1.4 s to about 0.3 s [1][2].

confidence: high

## Findings
- compinit scans every fpath folder each time unless it reads a dump file younger than a day [1].
- nvm.sh alone costs about 0.4 s; a lazy wrapper pays that on the first node call instead [3].
- Spotlight indexing node_modules adds CPU load that shows up as stalls after installs [4].
- Xcode simulator caches hold 18 GB here and rebuild on demand [5].

## Sources
- [1] zsh compinit docs https://zsh.sourceforge.io/Doc/Release/Completion-System.html
- [2] Faster zsh startup https://htr3n.github.io/2018/07/faster-zsh/
- [3] nvm lazy loading https://github.com/nvm-sh/nvm#deeper-shell-integration
- [4] Excluding folders from Spotlight https://support.apple.com/guide/mac-help/spotlight-privacy-mchl1b9d5bf2/mac
- [5] simctl delete https://developer.apple.com/documentation/xcode/simulator
`,
  r5: `## Answer
A Mac stays awake overnight for a run if a launch agent holds caffeinate for the life of the run. App Nap and a changing router address are the other two causes of dropped runs [1][2].

confidence: medium

## Findings
- caffeinate -i blocks idle sleep and ends when its parent exits [1].
- A DHCP reservation keeps the phone link address stable across sleeps [2].

## Sources
- [1] caffeinate man page https://ss64.com/mac/caffeinate.html
- [2] DHCP reservations explained https://en.wikipedia.org/wiki/Dynamic_Host_Configuration_Protocol
`,
}

/** The folder each demo report belongs in; Smart organize files the unfiled ones by this. */
const DEMO_FOLDERS = ['Memory and search', 'Web platform', 'Agents and cost', 'Release and CI', 'Design']
const DEMO_FILING: Record<string, string> = {
  r1: 'Memory and search', r2: 'Web platform', r3: 'Agents and cost', r17: 'Web platform', r18: 'Memory and search', r6: 'Design', r7: 'Release and CI', r8: 'Agents and cost',
  r9: 'Web platform', r10: 'Design', r11: 'Release and CI', r12: 'Design', r13: 'Memory and search', r14: 'Design', r15: 'Web platform', r16: 'Release and CI',
}
const DEMO_UNFILED = ['r1', 'r17', 'r6', 'r14']
const SRC_POOL: [string, string][] = [
  ['MDN reference', 'https://developer.mozilla.org/en-US/docs/Web'], ['web.dev guide', 'https://web.dev/articles'], ['SQLite docs', 'https://sqlite.org/docs.html'],
  ['WebKit blog', 'https://webkit.org/blog/'], ['Apple HIG', 'https://developer.apple.com/design/human-interface-guidelines/'], ['Anthropic docs', 'https://docs.anthropic.com/en/docs'],
]
type Spec = [id: string, question: string, project: string | undefined, agoMin: number, seen: boolean, summary: string, findings: string[]]
const SPECS: Spec[] = [
  ['r17', 'Which image format should closet previews use, AVIF or WebP?', 'Armasu', 40, false, 'Serve AVIF with a WebP fallback. AVIF is about 30% smaller at the same look, and every browser Armasu supports decodes it now.', ['AVIF beat WebP by 25 to 35% on photos of clothing [1][2].', 'Encoding AVIF is slow, so do it at upload time, not on request [2].', 'Safari decodes AVIF since 16.4, so the fallback only matters for old iPads [3].']],
  ['r18', 'How should long chat transcripts be chunked so recall keeps the question with its answer?', 'Switchboard', 31 * 60, false, 'Chunk by turn pairs, not by size. A question and its reply stay together, and a small overlap of one turn keeps follow-ups attached.', ['Fixed 500 token chunks split a reply from its question in 38% of cases [1].', 'Turn-pair chunks with one turn of overlap raised recall at 5 by 11 points [2].', 'Store the chunk title as the question, so keyword search finds it too [3].']],
  ['r6', 'Should receipt OCR run on the device or through an API?', 'Receipts', 2 * 1440 + 60, true, 'Start on the device with Apple Vision, and send only low confidence receipts to the API. It is free, private and good enough for printed totals.', ['Vision reads printed totals at 97% on a 200 receipt sample [1].', 'Handwritten tips and faded thermal paper drop to 70% [2].', 'An API fallback for the weak ones costs under a cent a receipt [3].']],
  ['r7', 'What does a safe staged rollout look like for a desktop app updater?', 'Atlas', 2 * 1440 + 400, true, 'Roll out in three steps: 5%, 25%, all. Gate on crash free sessions, and keep the previous build one click away.', ['Every mature updater ships by percentage with a kill switch [1][2].', 'Crash free sessions under 99.5% is the common stop line [2].', 'Keep one older build downloadable for at least 30 days [3].']],
  ['r8', 'Does prompt caching survive a model switch in the middle of a chat?', 'Switchboard', 3 * 1440 + 200, true, 'No. The cache is per model, so a switch re-reads the whole context at full price once. Switch at the start of a task, not in the middle.', ['Cache entries are keyed by model and prefix [1].', 'A switch costs one full read of the context, then caches again [1][2].', 'The five minute lifetime means idle chats lose it anyway [3].']],
  ['r9', 'Are scroll driven animations safe to use in Safari 26?', 'Armasu', 4 * 1440, true, 'Yes for animation-timeline: scroll() and view(), with a static fallback. Ranges work; named timelines on nested scrollers are still buggy.', ['Safari 26 shipped scroll() and view() timelines [1].', 'animation-range works, but nested named timelines flicker [2].', 'Wrap in @supports so older Safari sees the final state [3].']],
  ['r10', 'Which tap target size do WCAG 2.2 and Apple guidance agree on?', 'Atlas', 5 * 1440, true, 'Use 44 by 44 points. WCAG 2.2 AA asks for 24 px with spacing, Apple asks for 44, so 44 satisfies both.', ['WCAG 2.5.8 sets a 24 px minimum, with a spacing exception [1].', 'Apple HIG asks for 44 points on touch [2].', 'Inline links in text are exempt, but give them room [3].']],
  ['r11', 'Can the app ship through a Homebrew cask without notarization?', 'Switchboard', 6 * 1440, true, 'Technically yes, but users then see a quarantine warning on first run. Notarize, then publish the cask against the notarized zip.', ['Casks can strip the quarantine flag, but Homebrew discourages it [1].', 'Notarization needs a paid developer account and takes about a minute [2].', 'Cask audit fails on unsigned apps for new submissions [3].']],
  ['r12', 'What do empty states in finance apps show first?', 'Receipts', 7 * 1440, true, 'A single next step with a sample row. Apps that showed an example entry had more first-day adds than ones with only a prompt.', ['Top apps lead with one action, not a tour [1].', 'A greyed sample row teaches the layout without a tutorial [2].', 'Import from a bank is the second action, never the first [3].']],
  ['r13', 'SQLite FTS5 or trigram index for fuzzy file name search?', 'Atlas', 8 * 1440, false, 'Trigram for file names, FTS5 for note text. Trigram finds typos and partial words; FTS5 ranks prose better.', ['FTS5 trigram tokenizer handles substring and typo search [1].', 'Index size is about 3x larger than plain FTS5 [2].', 'Query time stays under 5 ms at 200k names [3].']],
  ['r14', 'How do other tools show queued agent work on a phone?', 'Switchboard', 9 * 1440, true, 'One list, grouped by state, with the thing that needs you on top. Nobody shows a board on a phone.', ['Linear and Things both group by state on mobile [1].', 'Needs you items get a badge on the tab, not a banner [2].', 'Swipe actions beat buttons for approve and dismiss [3].']],
  ['r15', 'Do container queries for card grids cost layout time on Safari?', 'Armasu', 10 * 1440, true, 'No measurable cost under 200 containers. Keep containment to inline-size and avoid querying height.', ['Safari lays out 150 query containers in under 4 ms [1].', 'size containment (both axes) is the costly one [2].', 'Name the containers so a rule never matches the wrong parent [3].']],
  ['r16', 'Should a staged web rollout flag travel in a cookie or a header?', 'Atlas', 12 * 1440, true, 'A cookie for the browser, a header for API calls. Both read one assignment made at the edge, so a user never flips between versions.', ['Sticky assignment needs a stable id, and a cookie is the simplest [1].', 'Headers suit service to service calls [2].', 'Assign at the edge so cache keys include the bucket [3].']],
]
const specBody = (s: Spec) => {
  const i = Number(s[0].slice(1)), n = 3 + (i % 3)
  const srcs = SRC_POOL.slice(0, n).map(([t, u], k) => `- [${k + 1}] ${t} ${u}`).join('\n')
  return `## Answer\n${s[5]} [1][2]\n\n**Confidence:** ${i % 3 === 0 ? 'Medium' : 'High'}\n\n## Key findings\n${s[6].map(f => `- ${f}`).join('\n')}\n\n## What to do\n1. Try it on one screen first.\n2. Keep the old path as a fallback until it holds.\n\n## Sources\n${srcs}\n`
}
for (const s of SPECS) DEMO_RESEARCH_BODY[s[0]] = specBody(s)
// Parts the demo's Ask more adds while it runs, keyed "<id>:<n>".
const DEMO_ADDED: Record<string, string> = {}
let organizeAt = 0
let organizeOp: 'run' | 'all' = 'run'
let organizeUndo: Record<string, string | undefined> | undefined

/** Saved research runs for the demo; their markdown comes from demoResearchBody. */
export function demoResearch(now = Date.now()): DemoResearch[] {
  const MIN = 60_000, DAY = 86_400_000
  const t0 = now
  const base: DemoResearch[] = [
  {
    id: 'r1', question: 'Which local vector store fits a VS Code extension that cannot ship native modules?', project: 'Switchboard',
    chat: 'Memory recall speedup', sessionId: 'demo-research-1', at: t0 - 4 * MIN, sources: 9, seen: false,
    summary: 'Use sqlite-vec through the WASM build of SQLite. It loads in the extension host with no native binary, handles 50k notes under 20 ms per query, and keeps the memory graph in one file.',
    asks: [{ question: 'Compare index size at 100k notes for sqlite-vec and hnswlib-wasm', at: t0 - 90_000, sessionId: 'demo-research-ask-1' }],
  },
  {
    id: 'r2', question: 'Where do Safari and Chrome still differ on cross-document View Transitions?', project: 'Armasu',
    chat: 'Page transitions pass', sessionId: 'demo-research-2', at: t0 - 26 * 60 * MIN, sources: 7, seen: true,
    summary: 'Both ship same-origin cross-document transitions now. Safari still drops view-transition-class on nested groups and ignores types set from pageswap, so keep the fallback fade for Safari.',
  },
  {
    id: 'r3', question: 'How should an agent fan-out be paced under a rolling 5 hour usage window?',
    chat: 'Research space', sessionId: 'demo-research-3', at: t0 - 3 * DAY, sources: 11, seen: true,
    summary: 'Cap live workers by tokens per minute, not by count. A token bucket refilled from the window size, with a hard stop at 85% used, kept every tested setup inside the window with no 429 storms.',
    added: { at: t0 - 5 * MIN, n: 2 },
  },
  {
    id: 'r4', question: 'Why does the first shell prompt take 1.4 seconds?',
    chat: 'Shell speed', sessionId: 'demo-research-4', at: t0 - 2 * 60 * MIN, sources: 5, seen: true,
    summary: 'zsh rebuilds its completion cache and loads nvm on every start. Caching completions and loading nvm on demand cuts the prompt from 1.4 s to about 0.3 s.',
  },
  {
    id: 'r5', question: 'Which Mac settings keep long agent runs alive overnight?',
    chat: 'Overnight runs', sessionId: 'demo-research-5', at: t0 - 5 * DAY, sources: 2, seen: true,
    summary: 'Hold caffeinate with a launch agent for the life of the run, and give the Mac a fixed address so the phone link survives sleeps.',
  },
  ...SPECS.map((s, k): DemoResearch => ({ id: s[0], question: s[1], project: s[2], chat: ['Closet previews', 'Recall tuning', 'Scan flow', 'Updater', 'Cost pass', 'Scroll pass', 'Touch pass', 'Packaging', 'First run', 'Fuzzy find', 'Phone queue', 'Card grid', 'Rollout'][k % 13], sessionId: `demo-research-${s[0].slice(1)}`, at: t0 - s[3] * MIN, sources: 3 + (Number(s[0].slice(1)) % 3), seen: s[4], summary: s[5] })),
  ]
  return base.map(r => ({ ...r, folder: DEMO_UNFILED.includes(r.id) ? undefined : DEMO_FILING[r.id] })).sort((a, b) => b.at - a.at)
}
export const demoResearchFolders = (): NonNullable<HubState['researchFolders']> => ({ names: [...DEMO_FOLDERS], auto: false })

/** The saved markdown for a demo research run, or undefined. */
export const demoResearchBody = (id: string): string | undefined => {
  const base = DEMO_RESEARCH_BODY[id]
  if (base === undefined) return undefined
  const more = Object.keys(DEMO_ADDED).filter(k => k.startsWith(`${id}:`)).sort().map(k => DEMO_ADDED[k]).join('')
  return base + more
}

export const demoHub = (now = Date.now()): HubState => {
  const h = { ...demoStations(withPlans(baseHub(now), now), now), smart: demoSmart(now) } as HubState
  if (typeof location === 'undefined' || !new URLSearchParams(location.search).get('demo')?.split(',').includes('stalled')) return h
  return { ...h, mirofish: h.mirofish && { ...h.mirofish, stalled: true }, crowdAb: h.crowdAb && { ...h.crowdAb, lastAt: now - 8 * 60e3, stopped: true } }
}
function baseHub(now: number): HubState {
  const fx = demoFx(typeof location === 'undefined' ? '' : location.search, now)
  unlinkAt = fx.unlinkAt
  const day = (i: number) => {
    const d = new Date(now - (13 - i) * DAY)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  return {
    ...emptyHub(),
    update: { current: '0.21.190', state: 'idle' },
    controls: {
      claude: { model: 'opus', tui: 'fullscreen', statusLine: false, push: true, needInput: true },
      switchboard: { hooks: true, statusBar: true, idleMinutes: 15, brief: true, askBrain: true, syncRules: true, accessNote: true, autoStart: true, autoFix: true, name: '', advancedMode: { '/Users/k/Documents/GitHub/Armasu': true }, ...demoView(typeof location === 'undefined' ? '' : location.search) },
      statusLineReady: true,
    },
    uploads: {
      Armasu: { count: 3, last: [
        { name: 'login-bug.png', at: now - 20 * 60e3, size: '412 KB', chat: 'Fix login redirect v4' },
        { name: 'outfit-copy.md', at: now - 2 * 3600e3, size: '6 KB', chat: 'Outfit picker copy' },
      ] },
      switchboard: { count: 1, last: [{ name: 'court-sketch.jpg', at: now - 26 * 3600e3, size: '1.2 MB', chat: 'Hub AIs and starred' }] },
    },
    snapshots: [
      { id: 's2', label: 'before undo', at: now - 12 * 60e3, paths: ['rules.md'] },
      { id: 's1', label: 'aar: rules and memory', at: now - 3 * 3600e3, paths: ['rules.md', 'agents/qa.md', 'memory/MEMORY.md'], chat: 'd-work' },
    ],
    health: { busy: false, at: now - 5 * 60e3, results: [
      { id: 'hook', label: 'Hook server answers', status: 'ok', fixable: false },
      { id: 'kit', label: 'Kit version matches', status: 'warn', detail: '0.21.4 installed, 0.21.5 shipped', fixable: true },
      { id: 'codex', label: 'Codex CLI on PATH', status: 'fail', detail: 'not found', fixable: false },
    ] },
    pipelines: [{ slug: 'research-build-qa', name: 'Research, build, QA', stages: 3, savedAt: now - DAY }],
    codexKept: [{ kind: 'codex_five_hour', percentUsed: 7, resetsAt: new Date(now + 3 * 3600e3).toISOString() }, { kind: 'codex_seven_day', percentUsed: 2, resetsAt: new Date(now + 5 * DAY).toISOString() }], codexResets: 1, codexDaily: [13.9e6, 15.4e6, 56e3, 6.8e6].map((tokens, i) => ({ day: new Date(now - (5 - i) * DAY).toISOString().slice(0, 10), tokens })),
    spend: [{ key: 'openrouter', label: 'OpenRouter', mode: 'ask', monthlyUsd: 10, calls: 3, usd: 1.2 }],
    // claude-mods and Gemini-Test have work and no chat; one Armasu worktree is ready, two have chats, one still running.
    ship: [
      { id: '/Users/k/GitHub/Armasu', name: 'Armasu', branch: 'fix/login-redirect', files: 4, ahead: 2, behind: 0, auto: true, trees: [
        { id: '/Users/k/GitHub/Armasu/.claude/worktrees/cookie-banner', name: 'cookie-banner', branch: 'worktree-cookie-banner', files: 3, commits: 0, live: true, queued: true },
        { id: '/Users/k/GitHub/Armasu/.claude/worktrees/fix-login', name: 'fix-login', branch: 'worktree-fix-login', files: 2, commits: 1, live: true },
        { id: '/Users/k/GitHub/Armasu/.claude/worktrees/size-chart', name: 'size-chart', branch: 'worktree-size-chart', files: 5, commits: 0, live: false },
        { id: '/Users/k/GitHub/Armasu/.claude/worktrees/old-footer', name: 'old-footer', branch: 'worktree-old-footer', files: 1, commits: 0, live: false },
      ], merge: { text: 'Merged hero-copy into fix/login-redirect as uncommitted changes; typecheck and test passed. Nothing was committed or pushed', ok: true, at: now - 22 * 60e3 } },
      { id: '/Users/k/GitHub/claude-mods', name: 'claude-mods', branch: 'main', files: 71, ahead: 0, behind: 0, auto: true, trees: [] },
      { id: '/Users/k/Documents/GitHub/Gemini-Test', name: 'Gemini-Test', branch: 'main', files: 42, ahead: 0, behind: 0, auto: false, trees: [] },
      { id: '/Users/k/GitHub/switchboard', name: 'switchboard', branch: 'main', files: 2, ahead: 2, behind: 0, auto: true, trees: [] },
      { id: '/Users/k/Documents/GitHub/GogoOrder', name: 'GogoOrder', branch: 'main', files: 0, ahead: 0, behind: 0, auto: true, trees: [] },
      { id: '/Users/k/Documents/GitHub/QR-Test', name: 'QR-Test', branch: 'main', files: 0, ahead: 0, behind: 0, auto: true, trees: [] },
    ],
    trend: { day: '2026-11-13', chats: { value: 6, vsDay: 2, vsWeek: -1 }, costUsd: { value: 12.4, vsDay: -3.1, vsWeek: 0 }, approved: { value: 5, vsDay: 1, vsWeek: 2 }, sentBack: { value: 1, vsDay: 0, vsWeek: -1 } },
    // Advanced mode in Armasu: one run running, one sent back, one waiting on review.
    stages: { '/Users/k/Documents/GitHub/Armasu': [
      { run: 'login-fix', sessionId: 'd-work', at: now - 20 * 60e3, stages: [{ n: 1, name: 'Find the redirect loop', role: 'researcher', status: 'done' }, { n: 2, name: 'Fix the cookie check', role: 'engineer', status: 'doing' }, { n: 3, name: 'Run tests and review', role: 'qa', status: 'todo' }, { n: 4, name: 'Polish the sign-in screen copy and spacing', role: 'designer', status: 'todo' }] },
      { run: 'picker-copy', sessionId: 'd-ask', at: now - 4 * 60e3, stages: [{ n: 1, name: 'Plan', role: 'researcher', status: 'done' }, { n: 2, name: 'Picker screens', role: 'designer', status: 'redo' }, { n: 3, name: 'Wire up', role: 'engineer', status: 'todo' }] },
      { run: 'filters', sessionId: 'd-close', at: now - 30 * 60e3, stages: [{ n: 1, name: 'Research', role: 'researcher', status: 'done' }, { n: 2, name: 'Build the size filter', role: 'engineer', status: 'done' }, { n: 3, name: 'Review', role: 'qa', status: 'todo' }] },
    ] },
    escalations: { '/Users/k/Documents/GitHub/Armasu': [
      { project: '/Users/k/Documents/GitHub/Armasu', role: 'qa', from: 'sonnet', to: 'opus', files: ['auth/middleware.ts'], reason: 'after 3 redesign rounds', at: now - DAY },
      { project: '/Users/k/Documents/GitHub/Armasu', role: 'designer', from: 'opus', to: 'fable', files: ['app/closet/picker.css', 'app/closet/picker.tsx'], reason: 'after 3 redesign rounds', at: now - 2 * DAY },
    ] },
    projects: [
      { name: 'Armasu', path: '/Users/k/Documents/GitHub/Armasu', kind: 'repo', isOpen: true },
      { name: 'switchboard', path: '/Users/k/GitHub/switchboard', kind: 'repo', isOpen: false },
      { name: 'Gemini-Test', path: '/Users/k/Documents/GitHub/Gemini-Test', kind: 'repo', isOpen: false },
      { name: 'claude-mods', path: '/Users/k/Documents/GitHub/claude-mods', kind: 'repo', isOpen: false },
      { name: 'CSEN122', path: '/Users/k/Documents/CSEN122', kind: 'project', isOpen: false },
    ],
    // A browser has no window of its own, so no thisWindow; claude-mods has no window open and lands in Other.
    windows: [
      { workspace: '/Users/k/GitHub/switchboard', name: 'switchboard', color: 'violet' },
      { workspace: '/Users/k/GitHub/Armasu', name: 'Armasu', color: 'amber' },
    ],
    doneChecks: { 'd-close': { verified: false, missing: ['tests after last edit', 'standup'] } },
    chats: [
      { pid: 1, sessionId: 'd-work', ai: 'codex', takes: true, name: 'Fix login redirect v4', chain: 'Fix login redirect', cwd: '/Users/k/GitHub/Armasu', link: '', live: true, why: [], elapsedMs: 95 * 60e3, costUsd: 3.4, budget: { maxHours: 4, maxCostUsd: 5, gate: 'pnpm test' }, checkBack: { everyMin: 30, count: 3 } },
      { pid: 2, sessionId: 'd-done', takes: true, name: 'Hub AIs and Starred', cwd: '/Users/k/GitHub/switchboard', link: '', live: true, why: [] },
      { pid: 3, sessionId: 'd-ask', takes: true, name: 'Outfit picker copy', cwd: '/Users/k/GitHub/Armasu', link: '', live: true, why: [] },
      { pid: 9, sessionId: 'd-tree2', takes: true, name: 'Cookie banner (worktree)', cwd: '/Users/k/GitHub/Armasu/.claude/worktrees/cookie-banner', link: '', live: true, why: [] },
      { pid: 8, sessionId: 'd-tree', takes: true, name: 'Fix login (worktree)', cwd: '/Users/k/GitHub/Armasu/.claude/worktrees/fix-login', link: '', live: true, why: [] },
      { pid: 7, sessionId: 'd-close', takes: true, name: 'Search filters', cwd: '/Users/k/GitHub/Armasu', link: '', live: true, why: [] },
      // Started from one split message; d-wrap also waits on d-almost (links).
      { pid: 6, sessionId: 'd-almost', takes: true, name: 'Finished receipt', cwd: '/Users/k/GitHub/switchboard', link: '', live: true, why: [], group: 'g-demo' },
      { pid: 5, sessionId: 'd-wrap', takes: true, name: 'Accurate Done state', cwd: '/Users/k/GitHub/switchboard', link: '', live: true, why: [], group: 'g-demo' },
      { pid: 4, sessionId: 'd-idle', name: 'Kit cleanup', cwd: '/Users/k/GitHub/claude-mods', link: '', live: true, why: [] },
    ],
    // Armasu has Jev set up with the AI-tell check off; switchboard has none, so its card offers Set up Jev.
    jevProjects: {
      '/Users/k/GitHub/Armasu': { project: 'armasu', jobs: { done: true, gate: true, tells: false, route: true }, costUsd: 0.00081, runs: [
        { job: 'gate', at: now - 2 * 60e3, items: 1, costUsd: 0.00002, result: 'ask' },
        { job: 'gate', at: now - 9 * 60e3, items: 1, costUsd: 0.00002, result: 'pass' },
        { job: 'done', at: now - 25 * 60e3, items: 4, costUsd: 0.00009 },
        { job: 'route', at: now - 70 * 60e3, items: 8, costUsd: 0.0002 },
      ] },
    },
    mirofish: { simId: 'sim-demo-7', step: 'rounds', round: 7, rounds: 10, percent: 70, startedAt: new Date(now - 18 * 60e3).toISOString(), elapsedMs: 18 * 60e3, etaMs: Math.round(18 * 60e3 * 3 / 7), reportReady: false , feed: [
      { at: new Date(now - 20e3).toISOString(), who: 'Priya Shah', platform: 'reddit', action: 'commented', text: 'The status dots are what I look at first. I never open the map unless something is red.', translated: true },
      { at: new Date(now - 45e3).toISOString(), who: 'Marcus Lee', platform: 'twitter', action: 'liked', text: 'Switchboard finally shows which chat needs me without me hunting through tabs.' },
      { at: new Date(now - 70e3).toISOString(), who: 'Dana Ortiz', platform: 'twitter', action: 'posted', text: 'Tried the phone mode today. It called me for a design pick while I was out. Weird but useful.' },
    ] },
    mirofishReports: [
      { simId: 'sim-demo-6', reportId: 'report-demo-6', title: 'Status first, map second', at: new Date(now - 2 * 3600e3).toISOString(), requirement: 'Which view do people open first to see which chats need them?', file: '/Users/k/.claude/switchboard/mirofish/sim-demo-6.md',
        markdown: '# Status first, map second\n\n> Most of the panel checked the list of status dots before anything else; the map was opened when something looked wrong.\n\n## What people did\n\n**Busy users** scanned the dots and left within seconds. **Curious users** opened the map after a red dot to see which agent was stuck.\n\n- 7 of 10 agents posted about the list first\n- 3 asked for the map to open on a red dot\n\n## What it means\n\nKeep the list as the landing view and link each red dot straight to its spot on the map.' },
      { simId: 'sim-demo-5', title: 'Phone calls for design picks', at: new Date(now - 26 * 3600e3).toISOString(), file: '/Users/k/.claude/switchboard/mirofish/sim-demo-5.en.md', translated: true, requirement: 'Would people pick up a call from their coding agent?',
        markdown: '# Phone calls for design picks\n\nMost agents said a call is fine for a real choice and annoying for anything the agent could settle itself.\n\n## Where it worked\n\n1. Picking between two finished designs\n2. Approving a paid step\n\n---\n\nKeep calls rare and say the choice in the first sentence.' },
    ],
    crowdAb: { run: 'demo-crowd', startedAt: now - 50e3, lastAt: now - 1e3, items: 2000, done: 1340, ended: false, votes: [{ label: 'List', n: 402 }, { label: 'Map', n: 188 }], noPreference: 80, feed: [
      { at: now - 1e3, who: '65+, tablet, low vision', option: 'List', appeal: 3.4, reason: 'accessible' },
      { at: now - 1e3, who: '65+, tablet, low vision', option: 'Map', appeal: 1.9, reason: 'none' },
      { at: now - 2e3, who: '25-34, phone', option: 'Map', appeal: 3.1, reason: 'looks' },
      { at: now - 2e3, who: '25-34, phone', option: 'List', appeal: 2.7, reason: 'clearer' },
    ] },
    // Several items, one prerequisite, one in progress, one from a finished chat, one whose chat ended; switchboard's show as "in other projects".
    todos: {
      '/Users/k/GitHub/Armasu': { sync: { state: 'synced', canSync: true }, todo: [
        { id: 'dt1', text: 'Add CSV export to the receipts page', at: now - 3 * DAY },
        { id: 'dt2', text: 'Put a Stripe test key in .env.local', at: now - 2 * DAY, before: 'dt1', from: 'd-work', chat: 'd-work', run: 2, auto: true },
        { id: 'dt4', text: 'Check the outfit picker on a real phone', at: now - 5 * 60e3, from: 'd-gone' },
        { id: 'dt5', text: 'Move the route release preset to the shared kit', at: now - 60 * 60e3, chat: 'd-gone' },
        // Long on purpose: the panel must show it whole, not cut at a fixed length.
        { id: 'dt7', text: 'Make the receipts export match what accounting asked for: one row per line item, the tax split into its own column, refunds as negative rows on the day they happened, and the file named by month so it sorts in Finder. Keep the old CSV format behind a toggle until they confirm the new one imports cleanly into Xero.', at: now - 26 * 60 * 60e3, from: 'd-done', name: 'Receipts export' },
        // One of each wait: an approval gating the next item, a dated one, a stopped one, a blocked one.
        { id: 'dt11', text: 'Proposed kit edit (AAR v3): batch agent-browser steps into one call in the aar skill. Needs Kenneth OK before it runs.', short: 'Approve kit rule: batch browser steps', needsOk: true, before: 'dt12', at: now - 16 * 36e5, from: 'd-done' },
        { id: 'dt12', text: 'Batch the browser steps in the aar skill', short: 'Batch browser steps in aar', at: now - 16 * 36e5 },
        { id: 'dt13', text: 'Check the push alerts after two weeks live and tell me if they ring too often', short: 'Check push alerts, 2 weeks live', notBefore: now + 10 * DAY, at: now - 2 * DAY },
        { id: 'dt14', text: 'Review memory consolidation (5 merges) before they land in the vault', short: 'Review memory consolidation', stopped: true, at: now - 16 * 36e5 },
        { id: 'dt15', text: 'Channel3 purchase matching, waiting on their API key', short: 'Channel3 purchase matching', why: 'blocked', at: now - 3 * DAY },
      ], ticked: [{ id: 'dt6', text: 'Fix the login redirect on Safari', at: now - 20 * 60e3, by: 'd-done', from: 'd-work', run: 1, auto: true },
        // Auto-ticked: a commit already said it.
        { id: 'dt8', text: 'Show a spinner while the outfit picker loads', at: now - 3 * 60 * 60e3, from: 'd-old', shipped: { sha: '9f3c2a17be04d1', subject: 'Outfit picker: loading spinner and empty state' } },
        { id: 'dt9', text: 'Bump the Stripe SDK to v15', at: now - 2 * DAY, shipped: { sha: 'CHANGELOG', subject: '0.9.2: Stripe SDK 15' } },
        { id: 'dt10', text: 'Old finished work nobody needs to see', at: now - 20 * DAY, by: 'd-done' }],
      // An auto chain: To-do 1 done, 2 running in d-work, the rest queued.
      seq: 2, streak: 1, pilot: { on: true, at: now - 60 * 60e3 },
      // What finished chats left, waiting for Accept or Dismiss; d-old is gone from the chat list, so it reads by project and date.
      suggested: [
        { id: 'ds1', text: 'Add the Stripe webhook secret to the Vercel env', at: now - 40 * 60e3, from: 'd-done', name: 'Hub AIs and Starred', why: 'you' },
        { id: 'ds2', text: 'Show tax lines on receipts once the API returns them', at: now - 40 * 60e3, from: 'd-done', why: 'blocked' },
        { id: 'ds3', text: 'Move receipts to the new PDF library', at: now - 2 * DAY, from: 'd-old', why: 'scope' },
      ] },
      // No open work, only an old tick: the redesign hides it.
      '/Users/k/GitHub/notes': { todo: [], ticked: [{ id: 'dn1', text: 'Archive the 2025 notes', at: now - 40 * DAY }] },
      '/Users/k/GitHub/switchboard': { sync: { state: 'local', why: 'public repo', canSync: true }, todo: [
        { id: 'da1', text: 'Rebuild the vsix and reload VS Code', at: now - 4 * 60e3, from: 'd-almost' },
      ], pilot: { on: true, paused: true, at: now - 10 * 60e3 }, suggested: [
        { id: 'da2', text: 'Check the phone layout on a real device', at: now - 4 * 60e3, from: 'd-almost', why: 'you' },
        { id: 'da3', text: 'add dark mode to the settings page', at: now - 3 * 60e3, from: 'd-almost', why: 'missed' },
      ] },
      // A list outside every project folder.
      '/Users/k/.claude/switchboard/misc': { todo: [{ id: 'dm1', text: 'Proposed kit edit: add a Reviewer line to the toolchain skill', short: 'Add Reviewer line to toolchain', at: now - 9 * DAY }] },
    },
    ...(fx.pause ? { pause: fx.pause } : {}),
    // One link Kenneth made on the cards, one from an edit clash on the same file.
    links: [
      { from: 'd-ask', to: ['d-work'], reason: 'Kenneth linked these in Switchboard', auto: false, since: now - 6 * 60e3 },
      { from: 'd-work', to: ['d-wrap'], reason: 'Kenneth linked these in Switchboard', auto: false, since: now - 3 * 60e3 },
      { from: 'd-wrap', to: ['d-almost'], reason: '/Users/k/GitHub/switchboard/extension/src/hub/hub-service.ts', auto: true, since: now - 2 * 60e3 },
    ],
    firstRun: { github: true, claude: true, project: true, chat: false, approved: false },
    researchOffers: [{ sessionId: 'd-ask', score: 0.82, reason: 'Picker copy leans on claims about what shoppers prefer; a research run can check them', at: now - 3 * 60e3 }],
    research: demoResearch(now),
    researchFolders: demoResearchFolders(),
    sourceChecks: demoSourceChecks(now),
    // The hung test run that started this check: a subagent's pnpm test, two hours on one core.
    stuck: [
      { id: 'job:d-wrap:t9', kind: 'job', sessionId: 'd-wrap', what: 'Subagent background job "Run the extension tests": no new output', since: now - 124 * 60e3, cpu: 98, rss: 1.4 * 1024 ** 3, pid: 48213, started: now - 131 * 60e3, command: 'pnpm test', last: 'Bash pnpm test' },
      { id: 'agent:d-work:q2', kind: 'agent', sessionId: 'd-work', what: 'qa subagent: no tool call', since: now - 12 * 60e3, last: 'Read src/auth/session.ts' },
    ],
    progress: [
      { sessionId: 'd-work', cwd: '/Users/k/GitHub/Armasu', state: 'working', startedAt: now - 30 * 60e3, at: now,
        roles: [...demoRuns(11_000, now), JEV_ROLE],
        helpers: [{ ai: 'perplexity', label: 'search', state: 'working', since: now - 90e3, last: now - 4e3, count: 3 }],
        // Timed so the estimate shows: 8 and 16 min done, 6 min into the third.
        tasks: [
          { id: '1', subject: 'Find where the redirect loops', status: 'completed', role: 'researcher', startedAt: now - 30 * 60e3, doneAt: now - 22 * 60e3 },
          { id: '2', subject: 'Write a failing test', status: 'completed', role: 'engineer', startedAt: now - 22 * 60e3, doneAt: now - 6 * 60e3 },
          { id: '3', subject: 'Fix the cookie check', status: 'in_progress', role: 'engineer', startedAt: now - 6 * 60e3 },
          { id: '4', subject: 'Run tests and review', status: 'pending', role: 'qa' },
        ],
        tools: [
          { tool: 'Grep', target: 'redirect', role: 'researcher', at: now - 50e3 },
          { tool: 'Read', target: 'auth/middleware.ts', role: 'researcher', at: now - 40e3 },
          { tool: 'Write', target: 'auth/redirect.test.ts', role: 'engineer', at: now - 20e3 },
          { tool: 'Edit', target: 'auth/middleware.ts', role: 'engineer', at: now - 5e3 },
          { ...JEV_CALL, at: now - 3e3 },
        ],
        tests: { command: 'npx tsx --test auth/*.test.ts', ok: false, at: now - 2 * 60e3, failed: 2, total: 538, first: 'redirects once after a Safari login',
          tail: ['ℹ tests 538', 'ℹ pass 536', 'ℹ fail 2', 'ℹ duration_ms 4210', '✖ failing tests:', '✖ redirects once after a Safari login (4.1ms)', '  AssertionError: expected 1 redirect, got 3', '✖ keeps the session cookie on refresh (2.7ms)'] } },
      { sessionId: 'd-done', cwd: '/Users/k/GitHub/switchboard', state: 'done', startedAt: now - 42 * 60e3, at: now - 60e3,
        roles: (['researcher', 'engineer', 'qa'] as const).map((role, i) => ({ id: `${role[0]}1`, role, state: 'done' as const, startedAt: now - (40 - i * 10) * 60e3 })),
        tasks: [{ id: '1', subject: 'Types', status: 'completed' }, { id: '2', subject: 'AI registry', status: 'completed' }],
        commit: 'feat(hub): multi-AI chats and Starred chats\n\n- Codex chats beside Claude in one list\n- Star a chat and resume it later\n\nCo-Authored-By: Claude <noreply@anthropic.com>', finishedAt: now - 60e3, finishing: true,
        tests: { command: 'pnpm run lint && pnpm test', ok: true, at: now - 2 * 60e3, total: 538 },
        asked: ['Add Codex to the hub next to Claude', 'Let me star chats and resume them later'], covered: [0.95, 0.91],
        report: { done: ['Chats from Claude and Codex in one list', 'Starred chats with a resume command', 'Tests and build pass'], left: [] },
        tools: [
          { tool: 'Edit', target: 'hub/types.ts', role: 'engineer', at: now - 5 * 60e3 },
          { tool: 'Bash', target: 'pnpm test', role: 'qa', at: now - 2 * 60e3 },
        ] },
      // Finished, but one request is not covered: almost done, in teal. Its Left items are in the to-do.
      { sessionId: 'd-almost', cwd: '/Users/k/GitHub/switchboard', state: 'done', startedAt: now - 70 * 60e3, at: now - 4 * 60e3,
        roles: (['researcher', 'engineer', 'qa', 'designer'] as const).map((role, i) => ({ id: `${role[0]}2`, role, state: 'done' as const, startedAt: now - (65 - i * 12) * 60e3 })),
        tasks: [{ id: '1', subject: 'Parse the standup', status: 'completed', role: 'engineer' }, { id: '2', subject: 'Receipt on the card', status: 'completed', role: 'designer' }, { id: '3', subject: 'QA pass', status: 'completed', role: 'qa' }],
        commit: 'Show what is left on a finished chat', finishedAt: now - 4 * 60e3, finishing: true,
        asked: ['Make finished unmistakable: full green only when everything is done', 'And a different color for almost done', 'Send me a summary at the end of the day'], covered: [0.93, 0.9, 0.08],
        report: { done: ['Standup parsed from the last message', 'Almost done chip in teal', 'Receipt on the card and the picture'], left: ['Rebuild the vsix and reload VS Code', 'Check the phone layout on a real device'] },
        tools: [{ tool: 'Bash', target: 'npm test', role: 'qa', at: now - 5 * 60e3 }] },
      // The lead stopped with a commit block, but an engineer and a test run still go, so it is not finished.
      { sessionId: 'd-wrap', cwd: '/Users/k/GitHub/switchboard', state: 'working', waiting: true, finishing: true, startedAt: now - 25 * 60e3, at: now - 20e3,
        // Three past engineer runs give the time left a range.
        roles: [{ id: 'r1', role: 'researcher', state: 'done', startedAt: now - 24 * 60e3, at: now - 20 * 60e3 },
          ...[[24, 12], [22, 8], [20, 10]].map(([from, len], i) => ({ id: `e0${i}`, role: 'engineer', state: 'done' as const, startedAt: now - from * 60e3, at: now - (from - len) * 60e3 })),
          { id: 'e1', role: 'engineer', state: 'active', startedAt: now - 4 * 60e3 }, { id: 'e2', role: 'engineer', state: 'active', startedAt: now - 3 * 60e3 }, { id: 'e3', role: 'engineer', state: 'active', startedAt: now - 2 * 60e3 }],
        running: ['e1', 'e2', 'e3'], jobs: [{ id: 'toolu_demo', label: 'Run root and extension test suites', startedAt: now - 3 * 60e3 }],
        tasks: [
          { id: '1', subject: 'Trace the Stop handling', status: 'completed', role: 'researcher' },
          { id: '2', subject: 'Done waits for background work', status: 'completed', role: 'engineer' },
          { id: '3', subject: 'Task tracker on the cards', status: 'completed', role: 'engineer' },
        ],
        commit: 'fix(hub): done only when nothing runs' },
      { sessionId: 'd-ask', cwd: '/Users/k/GitHub/Armasu', state: 'needs-you', startedAt: now - 5 * 60e3, at: now, asked: ['Write the outfit picker copy so shoppers get what each filter does'],
        roles: [{ id: 'g1', role: 'designer', state: 'active', startedAt: now - 4 * 60e3 }, { id: 'g2', role: 'engineer-codex', state: 'active', startedAt: now - 2 * 60e3 }],
        helpers: [{ ai: 'jev', label: 'score closet-names', state: 'done', since: now - 4 * 60e3, last: now - 3 * 60e3, count: 2 }],
        tasks: [{ id: '1', subject: 'Draft the picker labels', status: 'completed', role: 'designer' }, { id: '4', subject: 'Wire the picker labels', status: 'in_progress', role: 'engineer-codex' }, { id: '2', subject: 'Pick the closet name', status: 'in_progress', role: 'designer' }, { id: '3', subject: 'Ship copy for review', status: 'pending', role: 'growth' }],
        question: "Keep 'Closet' or rename it to 'Wardrobe'?",
        ask: { id: 'toolu_demo_closet', kind: 'question', tool: 'AskUserQuestion', options: [],
          questions: [{ header: 'Name', question: "Keep 'Closet' or rename it to 'Wardrobe'?", options: ['Keep Closet', 'Rename to Wardrobe', 'Use Wardrobe in the app, Closet in docs'], details: ['No changes; matches the docs', 'Renames labels, routes and copy', 'App says Wardrobe, docs keep Closet'], smart: { option: 0, rate: 0.83, n: 12 } }] } },
      // Asking the closing question with the done-check short of two items: Needs you shows the red stamp.
      { sessionId: 'd-close', cwd: '/Users/k/GitHub/Armasu', state: 'needs-you', startedAt: now - 30 * 60e3, at: now - 30e3,
        roles: [{ id: 'q1', role: 'qa', state: 'done', startedAt: now - 12 * 60e3, at: now - 2 * 60e3 }],
        tasks: [{ id: '1', subject: 'Add the size filter', status: 'completed', role: 'engineer' }, { id: '2', subject: 'Review the filter change', status: 'completed', role: 'qa' }, { id: '3', subject: 'Run the tests after the last edit', status: 'pending', role: 'engineer' }],
        question: 'Approve this chat as finished?',
        ask: { id: 'toolu_demo_close', kind: 'question', tool: 'AskUserQuestion', options: [],
          questions: [{ header: 'Finish', question: 'Approve this chat as finished?', options: ['Approve', 'Send back'] }] } },
      { sessionId: 'd-idle', cwd: '/Users/k/GitHub/claude-mods', state: 'idle', startedAt: now - 90 * 60e3, at: now - 30 * 60e3,
        roles: [], tasks: [{ id: '1', subject: 'Drop old presets', status: 'pending' }] },
      { sessionId: 'd-tree2', cwd: '/Users/k/GitHub/Armasu/.claude/worktrees/cookie-banner', state: 'done', startedAt: now - 50 * 60e3, at: now - 8 * 60e3, finishedAt: now - 8 * 60e3,
        roles: [], tasks: [{ id: '1', subject: 'Shorten the cookie banner copy', status: 'completed' }], commit: 'Shorter cookie banner copy' },
      { sessionId: 'd-tree', cwd: '/Users/k/GitHub/Armasu/.claude/worktrees/fix-login', state: 'working', startedAt: now - 20 * 60e3, at: now - 10e3,
        roles: [], tasks: [{ id: '1', subject: 'Fix the login redirect on its own branch', status: 'in_progress' }],
        compacted: { at: now - 6 * 60e3, trigger: 'auto' }, denied: { at: now - 3 * 60e3, tool: 'Bash', target: 'rm -rf node_modules', reason: 'outside the task' },
        rules: ['.claude/rules.md', 'kit/rules.md', 'Armasu/CLAUDE.md'] },
    ],
    ais: [
      { id: 'claude', name: 'Claude Code', installed: true, chats: 3 },
      { id: 'codex', name: 'Codex', installed: false, detail: 'CLI not installed: npm i -g @openai/codex', chats: 0 },
    ],
    starred: [
      { sessionId: 'd1b7e00d-d8c7-429e-a4b3-4420e8b32e67', ai: 'claude', name: 'boardChat', cwd: '/Users/k/Documents/GitHub/switchboard', starredAt: now - DAY, live: false,
        digest: { lastPrompt: 'add codex to the hub', resume: 'claude --resume d1b7e00d-d8c7-429e-a4b3-4420e8b32e67', updatedAt: now - 3600_000 } },
    ],
    // The working chat's three earlier chats, each closed when it filled up, and one older chain.
    archive: [...[1, 2, 3].map(v => ({
      sessionId: `d-fix-v${v}`, ai: 'claude' as const, name: v === 1 ? 'Fix login redirect' : `Fix login redirect v${v}`, origin: 'Fix login redirect', version: v,
      cwd: '/Users/k/GitHub/Armasu', project: 'Armasu', note: `/Users/k/.claude/handoffs/Armasu/fix-login-redirect-v${v}.md`,
      startedAt: now - (4 - v) * 5 * 3600_000 - 3 * 3600_000, archivedAt: now - (4 - v) * 5 * 3600_000,
    })), {
      sessionId: 'd-banner-v1', ai: 'claude' as const, name: 'Cookie banner copy', origin: 'Cookie banner copy', version: 1,
      cwd: '/Users/k/GitHub/Armasu', project: 'Armasu', note: '/Users/k/.claude/handoffs/Armasu/cookie-banner-copy-v1.md',
      startedAt: now - 5 * DAY - 2 * 3600_000, archivedAt: now - 5 * DAY,
    }],
    rcServers: [{ folder: '/Users/k/Documents/GitHub', name: 'Mac', on: true }],
    live: [{ sessionId: 'd-work', cwd: '/Users/k/GitHub/Armasu', label: 'Fix login redirect v4', model: 'claude-opus-5-5', tokens: 64_000, compactAt: 167_000, costUsd: 1.84, at: now, limits: [] },
      { sessionId: 'demo-1', cwd: '/Users/k/Documents/GitHub/Armasu', label: 'Setupfeatures', model: 'claude-opus-5-5', tokens: 82_000, compactAt: 167_000, at: now,
      limits: [{ kind: 'five_hour', percentUsed: 41, resetsAt: new Date(now + 130 * 60_000).toISOString() }, { kind: 'seven_day', percentUsed: 78, resetsAt: new Date(now + 2.1 * DAY).toISOString() }] }],
    history: REREAD.map((m, i) => ({ day: day(i), reread: m * 1e6, written: m * 2e4, io: m * 4e3, calls: CALLS[i], sessions: CALLS[i] ? 1 + (i % 3) : 0 })),
    sessions: [
      { sessionId: 'demo-1', label: 'Setupfeatures', project: 'Armasu', reread: 363.7e6, calls: 2100, startedAt: now - 9 * 3600_000, lastAt: now - 4 * 60_000 },
      { sessionId: 'demo-2', label: 'Closet regen button', project: 'Armasu', reread: 1.03e9, calls: 5100, startedAt: now - 20 * 3600_000, lastAt: now - 4 * 60_000 },
      { sessionId: 'demo-3', label: 'CSEN122 notes', project: 'CSEN122', reread: 20.3e6, calls: 140, startedAt: now - 3 * DAY, lastAt: now - 2 * DAY },
    ],
    plan: { name: '2026-10-23-switchboard.md', tasks: [
      { title: '1 Fork identity and a clean build', done: 4, total: 4 }, { title: '2 Contract, hub service and the feed routes', done: 5, total: 5 },
      { title: '3 History and sessions from the transcripts', done: 3, total: 3 }, { title: '4 The usage mod becomes the feed', done: 2, total: 4 },
      { title: '5 Hub tab', done: 0, total: 4 }, { title: '6 Timeline', done: 0, total: 5 },
    ] },
    servers: [
      { pid: 29313, command: 'node', port: 3000, folder: 'GitHub/Armasu' },
      { pid: 2635, command: 'Python', port: 4211, folder: 'scratchpad/profile-site' },
      { pid: 18558, command: 'node', port: 4262, folder: 'GitHub/Armasu' },
    ],
    git: { branch: 'Social-media-dev', ahead: 0, behind: 0, changed: 55, staged: 0, untracked: 7 },
    dev: [
      { folder: '/Users/k/Documents/GitHub/Armasu', project: 'Armasu', repo: 'Armasu', command: 'pnpm run dev', port: 3000, link: `${DEMO_TAILNET}:13000` },
      { folder: '/Users/k/Documents/GitHub/QR-Test', project: 'QR-Test', repo: 'QR-Test', command: 'npm run dev' },
    ],
    tailscale: true,
    awake: false,
    tools: { flagged: DEMO_FLAGGED, pick: null, precedence: { 'claude-x-jev': 'always', 'aws-core@claude-plugins-official': 'never' }, smart: { 'd-tree': { why: { 'claude-x-jev': 'Jev: needed (0.91)', phone: 'Jev: not needed (0.08)', 'aws-core@claude-plugins-official': 'Jev: not needed (0.12)', 'stitch-design@google-labs-code-stitch-skills': 'design words in the prompt' }, on: {}, refused: [], library: [], pending: false, at: now - 15 * 60e3 } }, chats: { 'd-work': { plugins: { 'superpowers@superpowers-dev': true, 'aws-core@claude-plugins-official': false, 'stitch-design@google-labs-code-stitch-skills': false }, skills: { 'claude-x-jev': false, phone: false }, assets: { 'docs/design/raycast-DESIGN.md': true, ...Object.fromEntries(['airbnb', 'apple', 'linear', 'notion', 'raycast', 'stripe', 'vercel'].map(b => [`/Users/demo/.claude/switchboard/design-md/${b}/DESIGN.md`, false])) } } } },
    installed: [
      { kind: 'mod', name: 'usage-meter@kenneth-mods', enabled: true }, { kind: 'mod', name: 'repo-rules@kenneth-mods', enabled: true }, { kind: 'mod', name: 'paid-guard@kenneth-mods', enabled: true },
      { kind: 'plugin', name: 'superpowers@superpowers-dev', enabled: true, skills: ['brainstorming', 'test-driven-development', 'writing-plans'], description: 'Planning, test-first coding and review habits for every chat.' }, { kind: 'plugin', name: 'aws-core@claude-plugins-official', enabled: true, description: 'AWS docs, CLI help and account checks.' }, { kind: 'plugin', name: 'stitch-design@google-labs-code-stitch-skills', enabled: false },
      { kind: 'skill', name: 'claude-x-jev', enabled: true, description: 'Sorts and scores many items cheaply with Jev.' }, { kind: 'skill', name: 'phone', enabled: true, description: 'Sends a push notification to your phone.' }, { kind: 'skill', name: 'drei', enabled: false },
      { kind: 'role', name: 'researcher', enabled: true, model: 'haiku' }, { kind: 'role', name: 'engineer', enabled: true, model: 'opus' }, { kind: 'role', name: 'qa', enabled: true, model: 'sonnet' },
      { kind: 'role', name: 'designer', enabled: true, model: 'opus' }, { kind: 'role', name: 'ops', enabled: true, model: 'haiku' }, { kind: 'role', name: 'growth', enabled: true, model: 'sonnet' },
      { kind: 'role', name: 'qa-codex', enabled: true, model: 'sonnet', codex: true, codexModel: 'gpt-6-luna', codexEffort: 'high' },
      { kind: 'builtin', name: 'Artifact', enabled: true, description: 'publish an HTML page to claude.ai, or upload an image or file into a Claude Docs document' }, { kind: 'builtin', name: 'Workflow', enabled: true, description: 'run a scripted multi-agent workflow, only when the user asks for one' }, { kind: 'mcp', name: 'mcp:openrouter', enabled: true },
      { kind: 'preset', name: 'armasu-copy-check', enabled: true }, { kind: 'preset', name: 'armasu-route-release', enabled: true },
    ],
    connections: [
      { kind: 'mcp', name: 'openrouter', status: 'on', detail: 'Armasu' }, { kind: 'mcp', name: 'aws-mcp', status: 'error', detail: 'sign in' }, { kind: 'app', name: 'Claude Docs', status: 'on' },
      { kind: 'project', name: 'Armasu', status: 'on', detail: 'Claude Code history' }, { kind: 'project', name: 'CSEN122', status: 'on', detail: 'Claude Code history' },
      { kind: 'window', name: 'Armasu', status: 'on', detail: 'Switchboard window' }, { kind: 'repo', name: 'Gemini-Test', status: 'on', detail: 'GitHub' },
    ],
    aws: [
      { name: 'Armasu', account: '111122223333', who: 'armasu', email: 'k@example.com', region: 'us-west-1', status: 'signed-in', chrome: 'Default', checkedAt: now, root: true, expiresAt: now + 9 * 3_600_000 },
      { name: 'live', account: '111122223333', who: 'armasu', email: 'k@example.com', region: 'us-west-1', status: 'signed-in', chrome: 'Default', checkedAt: now, expiresAt: now + 3 * 3_600_000 + 20 * 60e3 },
      { name: 'yo', account: '444455556666', label: 'sandbox@example.com', region: 'us-east-1', status: 'expired', chrome: 'Profile 2', checkedAt: now },
      { name: 'scratch', region: 'eu-central-1', status: 'never', checkedAt: now },
      { name: 'owner', account: '777788889999', who: 'Acme Holdings', region: 'us-east-1', status: 'signed-in', checkedAt: now, root: true, expiresAt: now + 40 * 60e3 },
    ],
    signIns: {
      chrome: [{ dir: 'Default', name: 'Personal', email: 'k@example.com' }, { dir: 'Profile 2', name: 'Work', email: 'k@work.example' }],
      projects: { '/Users/k/Documents/GitHub/Armasu': 'live' },
      window: '/Users/k/Documents/GitHub/Armasu',
      browsers: { '/Users/k/Documents/GitHub/Armasu': 'Default' },
      errors: {
        'aws:yo': 'aws login: the device code expired before it was approved. Sign in again and approve it in Chrome within 10 minutes.',
        'login:auth0:a-me': 'Chrome could not open profile "Personal": it is in use by another Chrome window.',
      },
      keys: [{ name: 'GEMINI_API_KEY', saved: true, last4: 'q7Xk', checked: { ok: true, at: now - 3_600_000 } }, { name: 'OPENROUTER_API_KEY', saved: false }],
      apps: [{
        id: 'auth0', name: 'Auth0', url: 'https://manage.auth0.com/', active: 'a-work', cli: true,
        logins: [
          { id: 'a-work', label: 'acme-prod', url: 'https://manage.auth0.com/dashboard/', chrome: 'Profile 2', email: 'k@acme.com', domain: 'acme-prod.us.auth0.com', status: 'signed-in' },
          { id: 'a-dev', label: 'acme-dev', url: 'https://manage.auth0.com/dashboard/', chrome: 'Profile 2', domain: 'acme-dev.us.auth0.com', status: 'expired' },
          { id: 'a-me', label: 'Personal', url: 'https://manage.auth0.com/', chrome: 'Default', email: 'k@example.com' },
        ],
      }, {
        id: 'vercel', name: 'Vercel', url: 'https://vercel.com/login', active: 'v-me',
        logins: [{ id: 'v-me', label: 'k@example.com personal team', url: 'https://vercel.com/login', chrome: 'Default' }],
      }],
      links: { '/Users/k/Documents/GitHub/Armasu': { auth0: 'a-dev', vercel: 'v-me' }, '/Users/k/Documents/GitHub/Gemini-Test': { auth0: 'a-me' } },
    },
    jev: [
      { sessionId: 'd-work', preset: 'triage-comments', items: 24, costUsd: 0.0061, seconds: 7.2, at: now - 8 * 60e3 },
      { sessionId: 'd-done', preset: 'lead-score', items: 40, costUsd: 0.0123, seconds: 11.4, at: now - 30 * 60e3 },
    ],
  }
}

const ROLES = ['researcher', 'engineer', 'qa']
// The working demo chat ran Jev, so the orbit shows its bubble and, every sixth tick, a Jev pill.
const JEV_ROLE = { id: 'jev', role: 'jev', state: 'done', startedAt: 0 } as const
// The working demo chat's subagents over one 20 s loop: [id, role, start, end] in ms, so bubbles pop in and out.
const RUNS: [string, string, number, number][] = [
  ['r1', 'researcher', 0, 6_667], ['r2', 'researcher', 1_200, 12_000],
  ['e1', 'engineer', 6_667, 15_000], ['e2', 'engineer', 8_000, 20_000],
  ['q1', 'qa', 10_000, 20_000], ['q2', 'qa', 15_500, 20_000],
]
/** The runs started by ms into the loop; at 11 s: two engineers, a researcher and qa running, one researcher done. */
const demoRuns = (ms: number, now: number) => RUNS.filter(r => r[2] <= ms)
  .map(([id, role, start, end]) => ({ id, role, state: end <= ms ? 'done' as const : 'active' as const, startedAt: now - (ms - start) }))
const JEV_CALL = { tool: 'triage-comments', target: '24 items · $0.0061', role: 'jev' }
const CALLS_BY_ROLE: Record<string, [string, string][]> = {
  researcher: [['Grep', 'redirect'], ['Read', 'auth/middleware.ts'], ['Glob', '**/*.test.ts'], ['Read', 'lib/session.ts']],
  engineer: [['Edit', 'auth/middleware.ts'], ['Write', 'auth/redirect.test.ts'], ['Bash', 'pnpm test auth'], ['Edit', 'lib/session.ts']],
  qa: [['Bash', 'pnpm test'], ['Bash', 'pnpm tsc --noEmit'], ['Read', 'auth/middleware.ts'], ['Grep', 'TODO']],
}

/** One more tool call on the working demo chat; the calling role turns researcher, engineer, qa every 20 s, and subagents start and stop on RUNS. */
// When the demo mic started listening; it stops on a made-up pause.
let listenAt = 0
const DEMO_HEARD = 'what is running'
const DEMO_DRAFT = [
  'Stop the login redirect loop on Safari',
  '',
  'Auth',
  '- Middleware skips the login redirect on the login page itself',
  '- Signed-in users on /login go to /home',
  '- readSession no longer drops Safari cookies',
  '',
  'Tests',
  '- Redirect test covers the Safari loop',
].join('\n')

export function demoTick(h: HubState, now: number): HubState {
  if (h.pause?.resumeAt && now >= h.pause.resumeAt) h = { ...h, pause: undefined }
  // Pure, since strict mode runs state updaters twice.
  if (unlinkAt && now >= unlinkAt && h.links?.some(l => l.auto)) h = { ...h, links: h.links.filter(l => !l.auto) }
  if (h.researchFolders?.busy && now - organizeAt >= 1500 && organizeOp === 'run' && !h.research?.some(r => !r.folder)) {
    h = { ...h, researchFolders: { ...h.researchFolders, busy: false, problem: 'Nothing is unfiled. Use Re-sort everything to start over.' } }
  }
  if (h.researchFolders?.busy && now - organizeAt >= 1500) {
    const was: Record<string, string | undefined> = {}
    const research = h.research?.map(r => {
      const to = DEMO_FILING[r.id]
      if (!to || (organizeOp === 'run' && r.folder) || r.folder === to) return r
      was[r.id] = r.folder
      return { ...r, folder: to }
    })
    organizeUndo = was
    h = { ...h, research, researchFolders: { ...h.researchFolders, busy: false, undo: Object.keys(was).length ? { moved: Object.keys(was).length, at: now } : undefined } }
  }
  if (h.research?.some(r => r.asks?.some(a => a.sessionId?.startsWith('demo-ask-') ? now - a.at >= 9000 : !a.sessionId && now - a.at >= 2500))) {
    h = { ...h, research: h.research.map(r => {
      if (!r.asks?.length) return r
      let added = r.added
      const asks: NonNullable<typeof r.asks> = []
      for (const a of r.asks) {
        if (a.sessionId?.startsWith('demo-ask-') && now - a.at >= 9000) {
          const n = (added?.n ?? 0) + 1
          const date = new Date(now).toLocaleDateString('en-CA')
          DEMO_ADDED[`${r.id}:${String(n).padStart(3, '0')}`] = `\n## Added ${date}: ${a.question}\nThe follow up found two more points worth keeping [1].\n- The first holds up in the sources already read [1].\n- The second needs a quick test on real data before it is trusted.\n`
          added = { at: now, n }
        } else asks.push(!a.sessionId && now - a.at >= 2500 ? { ...a, sessionId: `demo-ask-${a.at}` } : a)
      }
      return { ...r, asks, added, seen: added === r.added ? r.seen : false }
    }) }
  }
  if (h.voice === 'listening' && now - listenAt > 3500) h = { ...h, voice: null, heard: { text: DEMO_HEARD, at: now } }
  if (h.repo?.draft?.busy && now - h.repo.draft.at >= 1500) h = { ...h, repo: { ...h.repo, draft: { text: DEMO_DRAFT, box: 'filled', at: now } } }
  const i = Math.floor((now % 20_000) / (20_000 / 3)), role = ROLES[i]
  const pick = CALLS_BY_ROLE[role][Math.floor(now / 900) % 4]
  const call: ToolCall = Math.floor(now / 900) % 6 === 0 ? { ...JEV_CALL, at: now } : { tool: pick[0], target: pick[1], role, at: now }
  return { ...h, progress: h.progress.map(p => p.sessionId !== 'd-work' ? p : {
    ...p, at: now,
    roles: [...demoRuns(now % 20_000, now), JEV_ROLE],
    tasks: p.tasks.map((t, n) => {
      // A role with two tasks is on its later one.
      const j = ROLES.indexOf(t.role ?? ''), later = p.tasks.slice(n + 1).some(u => u.role === t.role)
      return { ...t, status: j < i || (j === i && later) ? 'completed' : j === i ? 'in_progress' : 'pending' }
    }),
    tools: [...(p.tools ?? []), call].slice(-200),
  }) }
}

// What the demo's handoff notes say, for History search.
const NOTES: Record<string, string> = {
  'd-fix-v1': 'Found the redirect loop in auth/middleware.ts: /login sends a signed-in user back to /login.',
  'd-fix-v2': 'Wrote the failing test in auth/redirect.test.ts. Next: the session check in lib/session.ts.',
  'd-fix-v3': 'The cookie check skipped SameSite on Safari, so the session looked empty and the redirect looped. Fix the check next.',
  'd-banner-v1': 'Rewrote the banner text to match the new privacy page. Waiting on legal for the last line.',
}

const diffOf = (rows: string[]) => rows.join('\n')
/** The demo chats' uncommitted files. */
const CHANGES: Record<string, ChangedFile[]> = {
  'd-work': [
    { path: 'auth/middleware.ts', added: 18, removed: 6, status: 'modified', diff: diffOf(['@@ -12,9 +12,21 @@ export function middleware(req: Request) {', '   const session = readSession(req)', '-  if (!session) return redirect(\'/login\')', '+  if (!session && !isLogin(req)) return redirect(\'/login\')', '+  if (session && isLogin(req)) return redirect(\'/home\')', '   return next()']) },
    { path: 'auth/redirect.test.ts', added: 24, removed: 0, status: 'untracked', diff: diffOf(['+import { next } from \'./middleware\'', '+', "+it('stops the redirect loop', async () => {", "+  expect(await next('/login')).toBe('/home')", '+})']) },
    { path: 'lib/session.ts', added: 0, removed: 3, status: 'modified', diff: diffOf(['@@ -40,7 +40,4 @@ export function readSession(req: Request) {', '-  // TODO: cover the loop', '-  if (ua.includes(\'Safari\')) return null', '-', '   return parse(req.headers.get(\'cookie\'))']) },
    { path: 'public/login-hero.png', added: 0, removed: 0, status: 'modified', note: 'Binary file: no text diff.' },
  ],
  'd-done': [
    { path: 'extension/src/hub/ais.ts', added: 149, removed: 0, status: 'added', note: 'This diff is too big to show here (152 lines). Open it in VS Code.' },
    { path: 'extension/src/hub/types.ts', added: 6, removed: 1, status: 'modified', diff: diffOf(['@@ -60,7 +60,12 @@', "-export type ChatRow = { pid: number; sessionId: string }", "+export type AiId = 'claude' | 'codex'", '+export type ChatRow = { pid: number; sessionId: string; ai?: AiId }']) },
  ],
}

/** The demo's Git panel: the chat's changed files on a feature branch two commits ahead. */
const demoRepo = (h: HubState, sessionId: string): RepoView => {
  const own = shipOf(h.ship ?? [], isShipId(sessionId) ? sessionId : undefined)
  if (own) return demoShipRepo(own, sessionId)
  const cwd = h.chats.find(x => x.sessionId === sessionId)?.cwd ?? ''
  const files = (CHANGES[sessionId] ?? []).map(f => ({ path: f.path, status: f.status }))
  const branch = sessionId === 'd-done' ? 'main' : sessionId === 'd-tree' ? 'worktree-fix-login' : 'fix/login-redirect'
  return {
    sessionId, name: cwd.split('/').pop() ?? '', branch, upstream: `origin/${branch}`, ahead: 2, behind: 0, files, ship: { files: files.map(f => f.path), kept: [] },
    branches: [branch, 'main', 'design/outfit-copy'].filter((b, i, a) => a.indexOf(b) === i), sync: { kind: 'push', label: 'Push 2' },
    log: [{ hash: 'a41c9e2', subject: 'Wrote the failing redirect test', when: '12 minutes ago' }, { hash: '7d03b18', subject: 'Read the session cookie on Safari', when: '40 minutes ago' }, { hash: '1f9e0aa', subject: 'Add login page hero', when: '2 days ago' }],
    stashes: 0, github: `https://github.com/kennykennethkkang/${cwd.split('/').pop()}`, at: Date.now(),
    ...(sessionId === 'd-work' ? demoMerge(Date.now()) : {}),
    ...(sessionId === 'd-done' ? demoLanes(Date.now()) : {}),
    ...(sessionId === 'd-tree' ? { worktree: true, into: 'fix/login-redirect', auto: true, branch: 'worktree-fix-login', upstream: undefined, branches: ['worktree-fix-login', 'main'], sync: { kind: 'publish' as const, label: 'Publish branch' } } : {}),
  }
}

/** A repo or worktree picked on Ship, as many files as its row says. */
const demoShipRepo = ({ repo, tree }: { repo: ShipRepo; tree?: ShipTree }, sessionId: string): RepoView => {
  const branch = (tree ?? repo).branch ?? 'main', ahead = tree ? 0 : repo.ahead
  const files = demoShipFiles((tree ?? repo).files).map(f => ({ path: f.path, status: f.status }))
  return {
    sessionId, name: (tree ?? repo).name, branch, ...(tree ? { worktree: true, into: repo.branch, auto: repo.auto } : { upstream: `origin/${branch}` }), ahead, behind: 0, files, ship: { files: files.map(f => f.path), kept: [] },
    branches: [...new Set([branch, 'main'])], sync: tree ? { kind: 'publish', label: 'Publish branch' } : ahead ? { kind: 'push', label: `Push ${ahead}` } : { kind: 'fetch', label: 'Fetch' },
    log: [{ hash: '7d03b18', subject: 'Read the session cookie on Safari', when: '40 minutes ago' }, { hash: '1f9e0aa', subject: 'Add login page hero', when: '2 days ago' }],
    stashes: 0, github: `https://github.com/kennykennethkkang/${repo.name}`, at: Date.now(),
    ...(!tree && files.length ? { pending: { text: 'Size chart copy and hook fixes\n\n- size chart reads the saved unit\n- paid-guard asks once per provider', last: 'Size chart copy and hook fixes', at: 1 } } : {}),
  }
}
const demoShipFiles = (n: number): ChangedFile[] => Array.from({ length: n }, (_, i) => ({ path: `src/part-${i + 1}.ts`, added: 12 + i, removed: i % 5, status: i % 4 ? 'modified' : 'added', diff: diffOf(['@@ -1,2 +1,2 @@', "-const unit = 'cm'", "+const unit = saved.unit ?? 'cm'"]) }))

/** The ship card's lanes: two local commits on main, one from Sam already on origin. */
const demoLanes = (now: number): Pick<RepoView, 'lanes' | 'outgoing'> => {
  const ago = (m: number) => now - m * 60e3
  return {
    lanes: { against: 'origin/main', fork: { hash: '1f9e0aa', author: 'You', at: ago(2880), subject: 'Add login page hero', side: 'fork' }, commits: [
      { hash: 'a41c9e2', author: 'You', at: ago(12), subject: 'Starred chats with a resume command', side: 'head' },
      { hash: '7d03b18', author: 'You', at: ago(40), subject: 'Codex chats in the hub list', side: 'head' },
    ] },
    outgoing: [{ path: 'extension/src/hub/ais.ts', added: 142, removed: 8 }, { path: 'extension/src/hub/starred.ts', added: 96, removed: 0 }, { path: 'web/components/switchboard/chat-cards.tsx', added: 31, removed: 12 }],
  }
}

/** The PR and CI cards: main moved on under the login fix, with Lena's key rotation on the same lines, and CI failed on it. */
const demoMerge = (now: number): Pick<RepoView, 'pr' | 'merge' | 'ci'> => {
  const ago = (m: number) => now - m * 60e3
  return {
    ci: { id: 9182736451, workflow: 'CI', status: 'completed', conclusion: 'failure', url: 'https://github.com/kennykennethkkang/Armasu/actions/runs/9182736451', sha: 'a41c9e2', at: ago(3),
      jobs: [{ name: 'lint', status: 'completed', conclusion: 'success' }, { name: 'typecheck', status: 'completed', conclusion: 'success' }, { name: 'test (node 22)', status: 'completed', conclusion: 'failure', step: 'npm test' }, { name: 'build', status: 'completed', conclusion: 'skipped' }] },
    pr: { url: 'https://github.com/kennykennethkkang/Armasu/pull/128', state: 'OPEN', title: 'Stop the login redirect loop on Safari', number: 128, additions: 482, deletions: 37, base: 'main' },
    merge: {
      base: 'main', behind: 4, files: 3,
      conflicts: [
        { path: 'auth/auth.ts', by: 'Lena', line: 42, theirs: 'const key = await rotateSessionKey(user.id)', ours: 'const key = readSessionKey(req, { safari: true })' },
        { path: 'auth/middleware.ts', by: 'Lena', line: 18, theirs: 'if (!session || session.expired) return redirect(\'/login\')', ours: 'if (!session && !isLogin(req)) return redirect(\'/login\')' },
        { path: 'lib/session.ts', by: 'Lena', line: 7, theirs: 'export const KEY_TTL = 60 * 60', ours: '' },
      ],
      commits: [
        { hash: 'a41c9e2', author: 'You', at: ago(0) }, { hash: 'c7e21f0', author: 'Lena', at: ago(6) }, { hash: '7d03b18', author: 'You', at: ago(18) },
        { hash: '5b8d4a1', author: 'Lena', at: ago(41) }, { hash: '0e6f3c9', author: 'Sam', at: ago(120) },
      ],
    },
  }
}

/** The browser demo has no extension behind it, so the Hub's own settings apply here. */
let demoSeq = 0
export function demoApply(h: HubState, c: HubCommand): HubState {
  switch (c.type) {
    // Like approveChat: an approved row in the archive; the card leaves the live list.
    case 'hub-approve': {
      const chat = h.chats.find(x => x.sessionId === c.sessionId), p = h.progress.find(x => x.sessionId === c.sessionId)
      if (!chat || h.archive?.some(a => a.sessionId === c.sessionId)) return h
      const { origin, version } = splitVersion(chat.name)
      const row = { sessionId: chat.sessionId, ai: chat.ai ?? 'claude', name: chat.name ?? origin, origin, version, cwd: chat.cwd, project: projectName(chat), startedAt: p?.startedAt, archivedAt: Date.now(), approvedAt: Date.now(), ...(p?.commit ? { commit: p.commit } : {}) }
      return { ...h, archive: [row, ...(h.archive ?? [])] }
    }
    // Answering the closing question with Approve is an Approve; other picks have no demo effect.
    case 'hub-answer': {
      const ask = h.progress.find(x => x.sessionId === c.sessionId)?.ask
      const pick = c.choice[0]
      return typeof pick === 'number' && ask?.questions?.[0]?.options[pick] === 'Approve' ? demoApply(h, { type: 'hub-approve', sessionId: c.sessionId }) : h
    }
    // A full chat always continues fresh, so only the branch switch applies.
    case 'hub-keep': return c.freshBranch === undefined ? h : { ...h, keep: { ...h.keep, freshBranch: c.freshBranch } }
    case 'hub-setting': {
      const keep = { ...h.keep }, claude = { ...h.controls.claude }
      if (c.key === 'autoCompactEnabled') keep.autoCompact = c.value === true
      if (c.key === 'autoContinueAtUsageLimit') keep.autoContinue = c.value === true
      if (c.key === 'autoCompactWindow' && typeof c.value === 'number') keep.window = c.value
      if (c.key === 'model') claude.model = (c.value ?? undefined) as typeof claude.model
      if (c.key === 'effortLevel') claude.effortLevel = (c.value ?? undefined) as typeof claude.effortLevel
      if (c.key === 'tui') claude.tui = c.value === 'fullscreen' ? 'fullscreen' : 'default'
      if (c.key === 'statusLine') claude.statusLine = c.value === true
      if (c.key === 'agentPushNotifEnabled') claude.push = c.value === true
      if (c.key === 'inputNeededNotifEnabled') claude.needInput = c.value === true
      return { ...h, keep, controls: { ...h.controls, claude } }
    }
    case 'hub-switchboard': return { ...h, controls: { ...h.controls, switchboard: { ...h.controls.switchboard, [c.key]: c.value } } }
    case 'hub-toggle': return { ...h, installed: h.installed.map(i => (i.kind === c.kind && i.name === c.name ? { ...i, enabled: c.enabled } : i)) }
    case 'hub-rc': {
      if (!c.sessionId) return { ...h, rc: { ...h.rc, atStartup: c.on } }
      const bridgeId = `session_01${c.sessionId}`
      return { ...h, chats: h.chats.map(x => (x.sessionId !== c.sessionId ? x : c.on ? { ...x, bridgeId, link: `https://claude.ai/code/${bridgeId}`, why: [] } : { ...x, bridgeId: undefined, link: 'https://claude.ai/code', why: ['not connected'] })) }
    }
    case 'hub-star': {
      if (!c.on) return { ...h, starred: h.starred.filter(s => s.sessionId !== c.sessionId) }
      const chat = h.chats.find(x => x.sessionId === c.sessionId), row = h.sessions.find(x => x.sessionId === c.sessionId)
      const resume = c.ai === 'codex' ? `codex resume ${c.sessionId}` : `claude --resume ${c.sessionId}`
      return { ...h, starred: [...h.starred.filter(s => s.sessionId !== c.sessionId), { sessionId: c.sessionId, ai: c.ai, name: chat?.name ?? row?.label ?? c.sessionId.slice(0, 8), cwd: chat?.cwd ?? '', starredAt: Date.now(), live: !!chat?.live, digest: { resume } }] }
    }
    case 'hub-new-chat': {
      // The extension asks a model for the name; the demo takes the goal's first five words.
      const first = (c.text ?? '').split(/\s+/).filter(Boolean).slice(0, 5).join(' ')
      const name = first ? first[0].toUpperCase() + first.slice(1) : 'New chat'
      const sessionId = `d-new-${h.chats.length + 1}`, now = Date.now()
      return {
        ...h,
        chats: [{ pid: 0, sessionId, name, cwd: c.path, link: '', live: true, why: [], takes: true, ...(c.group ? { group: c.group } : {}) }, ...h.chats],
        ...(c.waitOn?.length ? { links: [...h.links ?? [], { from: sessionId, to: c.waitOn, reason: 'Kenneth picked these in New chat', auto: false, since: now }] } : {}),
        progress: [{ sessionId, cwd: c.path, state: 'working', roles: [], tasks: [], startedAt: now, at: now }, ...h.progress],
        ...(h.tools ? { tools: { ...h.tools, pick: null, chats: { ...h.tools.chats, [sessionId]: c.tools ?? demoPick(h, c.text ?? '') } } } : {}),
      }
    }
    case 'hub-pick-tools': return h.tools ? { ...h, tools: { ...h.tools, pick: { goal: c.text, folder: c.path, profile: demoPick(h, c.text) } } } : h
    case 'hub-chat-tools': return h.tools ? { ...h, tools: { ...h.tools, chats: { ...h.tools.chats, [c.sessionId]: c.tools } } } : h
    case 'hub-tool-precedence': { if (!h.tools) return h; const p = { ...h.tools.precedence }; if (c.value === 'auto') delete p[c.name]; else p[c.name] = c.value; return { ...h, tools: { ...h.tools, precedence: p } } }
    case 'hub-loop': {
      // Goal is Run indefinitely in the profile; Timer is the chat row's check-back, as the extension reports it.
      const cur = h.tools?.chats[c.sessionId] ?? { plugins: {}, skills: {} }
      const { indefinite: was, checkBack: _, ...rest } = cur
      const goal = c.loop.mode === 'goal', timer = c.loop.mode === 'timer' && c.loop.everyMin
      const checkBack = timer ? { everyMin: c.loop.everyMin!, count: 0, ...(c.loop.text ? { text: c.loop.text } : {}) } : undefined
      const chats = h.chats.map(x => (x.sessionId === c.sessionId ? { ...x, checkBack } : x))
      return { ...h, chats, ...(h.tools ? { tools: { ...h.tools, chats: { ...h.tools.chats, [c.sessionId]: goal ? { ...rest, indefinite: was ?? Date.now() } : rest } } } : {}) }
    }
    case 'hub-focus-chat': return h
    case 'hub-open-chat': return { ...h, openChat: { sessionId: c.sessionId, at: Date.now() } }
    case 'hub-terminal': return h
    case 'hub-summary': {
      const name = h.chats.find(x => x.sessionId === c.sessionId)?.name ?? 'This chat'
      const text = `Demo: ${name} is a Switchboard demo chat. It has worked through its first tasks and is waiting on the last one. A real summary comes from one short Haiku call on the transcript.`
      return { ...h, summaries: { ...h.summaries, [c.sessionId]: { text, at: Date.now() } } }
    }
    case 'hub-changes': {
      const own = shipOf(h.ship ?? [], isShipId(c.sessionId) ? c.sessionId : undefined)
      if (own) return { ...h, changes: { sessionId: c.sessionId, cwd: c.sessionId, files: demoShipFiles((own.tree ?? own.repo).files), at: Date.now() }, repo: demoRepo(h, c.sessionId) }
      const cwd = h.chats.find(x => x.sessionId === c.sessionId)?.cwd ?? ''
      return { ...h, changes: { sessionId: c.sessionId, cwd, files: CHANGES[c.sessionId] ?? [], at: Date.now() }, repo: demoRepo(h, c.sessionId) }
    }
    case 'hub-auto-merge': return { ...h, ship: h.ship?.map(r => (r.id === c.repo ? { ...r, auto: c.on } : r)) }
    case 'hub-git': {
      const at = shipOf(h.ship ?? [], isShipId(c.sessionId) ? c.sessionId : undefined)
      if (at && (c.op === 'merge-back' || c.op === 'merge-all')) {
        const gone = c.op === 'merge-all' ? at.repo.trees.filter(t => !t.live) : at.tree ? [at.tree] : []
        const trees = at.tree?.live ? at.repo.trees.map(t => (t.id === at.tree!.id ? { ...t, queued: true } : t)) : at.repo.trees.filter(t => !gone.includes(t))
        const merge = { text: `Merged ${gone.map(t => t.name).join(', ')} into ${at.repo.branch} as uncommitted changes; typecheck and test passed. Nothing was committed or pushed`, ok: true, at: Date.now() }
        const next = { ...h, ship: h.ship!.map(r => (r.id === at.repo.id ? { ...r, trees, ...(at.tree?.live ? {} : { merge, files: r.files + gone.reduce((n, t) => n + t.files, 0) }) } : r)) }
        return h.repo && isShipId(h.repo.sessionId) ? demoApply(next, { type: 'hub-changes', sessionId: h.repo.sessionId }) : next
      }
      const r = h.repo?.sessionId === c.sessionId ? h.repo : demoRepo(h, c.sessionId)
      const done = (text: string, patch: Partial<RepoView> = {}) => ({ ...h, repo: { ...r, ...patch, result: { text: `Demo: ${text}`, ok: true, at: Date.now() } } })
      // A commit moves HEAD, which drops the draft like the extension does.
      const head = { log: [{ hash: Date.now().toString(16).slice(-7), subject: c.summary?.trim() || 'Demo commit', when: 'just now' }, ...r.log], draft: undefined }
      if (c.op === 'commit') return done(`committed ${c.files?.length ?? 0} files to ${r.branch}`, { ...head, files: r.files.filter(f => !c.files?.includes(f.path)), ahead: r.ahead + 1, sync: { kind: 'push', label: `Push ${r.ahead + 1}` } })
      if (c.op === 'ship') return done(`committed ${r.files.length} files and pushed to ${r.upstream}`, { ...head, files: [], ship: { files: [], kept: [] }, ahead: 0, outgoing: [], lanes: r.lanes && { ...r.lanes, commits: [] }, sync: { kind: 'fetch', label: 'Fetch' } })
      if (c.op === 'push') return done(r.ahead ? `pushed ${r.ahead} commits to ${r.upstream}` : 'nothing to send', { ahead: 0, outgoing: [], sync: { kind: 'fetch', label: 'Fetch' } })
      if (c.op === 'sync') return done(`pushed ${r.ahead} commits to ${r.upstream}`, { ahead: 0, sync: { kind: 'fetch', label: 'Fetch' } })
      if (c.op === 'rerun' && r.ci) return done(`re-running the failed jobs in ${r.ci.workflow}`, { ci: { ...r.ci, status: 'in_progress', conclusion: undefined, jobs: r.ci.jobs.map(j => j.conclusion === 'success' ? j : { name: j.name, status: 'queued' }) } })
      return done(`git ${c.op} would run here`)
    }
    // Busy now; demoTick fills it in about 1.5 s, like the Haiku call.
    case 'hub-draft-commit': {
      const r = h.repo?.sessionId === c.sessionId ? h.repo : demoRepo(h, c.sessionId)
      return r.draft?.busy ? h : { ...h, repo: { ...r, draft: { busy: true, at: Date.now() } } }
    }
    case 'hub-search': {
      const q = c.q.trim()
      if (!q) return { ...h, search: null }
      const hits = h.archive.flatMap(a => {
        const text = NOTES[a.sessionId] ?? '', at = text.toLowerCase().indexOf(q.toLowerCase())
        return at < 0 ? [] : [{ sessionId: a.sessionId, snippet: `${at > 30 ? '...' : ''}${text.slice(Math.max(0, at - 30), at + q.length + 50)}...` }]
      })
      return { ...h, search: { q, hits } }
    }
    case 'hub-voice':
      if (c.on) { listenAt = Date.now(); return { ...h, voice: 'listening' } }
      return h.voice === 'listening' ? { ...h, voice: null, heard: { text: DEMO_HEARD, at: Date.now() } } : h
    case 'hub-jarvis': {
      // The extension runs jarvis.ts; the demo only tells a start from a question.
      const q = c.q.trim(), at = Date.now()
      if (!q) return { ...h, jarvis: null }
      const goal = /^(?:start|open)\s+(?:a\s+)?(?:new\s+)?chat\s+(?:to\s+)?(.+)$/i.exec(q)?.[1]
      const open = h.projects.find(p => p.isOpen)
      if (goal && open) return { ...h, jarvis: { q, at, start: { folder: open.path, project: open.name, goal } } }
      const working = h.progress.filter(p => p.state === 'working').map(p => h.chats.find(x => x.sessionId === p.sessionId)?.name ?? p.sessionId)
      return { ...h, jarvis: { q, at, answer: working.length ? `Working: ${working.join(', ')}.` : 'No chat is working right now.' } }
    }
    case 'hub-aws-rename': {
      if (!h.aws.some(a => a.name === c.profile) || h.aws.some(a => a.name === c.to)) return h
      const projects = Object.fromEntries(Object.entries(h.signIns.projects).map(([f, n]) => [f, n === c.profile ? c.to : n]))
      return { ...h, aws: h.aws.map(a => a.name === c.profile ? { ...a, name: c.to } : a), signIns: { ...h.signIns, projects } }
    }
    case 'hub-aws-label': {
      const row = h.aws.find(a => a.name === c.profile)
      if (!row) return h
      const same = (a: typeof row) => (row.account ? a.account === row.account : a.name === row.name)
      return { ...h, aws: h.aws.map(a => same(a) ? { ...a, label: c.label.trim() || undefined } : a) }
    }
    case 'hub-aws-add':
      return h.aws.some(a => a.name === c.profile)
        ? { ...h, aws: h.aws.map(a => a.name === c.profile ? { ...a, region: c.region, chrome: c.chrome ?? a.chrome } : a) }
        : { ...h, aws: [...h.aws, { name: c.profile, region: c.region, status: 'never', chrome: c.chrome ?? '', checkedAt: Date.now() }] }
    case 'hub-aws-login': {
      const { [`aws:${c.profile}`]: _err, ...errors } = h.signIns.errors ?? {}
      return { ...h, signIns: { ...h.signIns, errors }, aws: h.aws.map(a => a.name === c.profile ? { ...a, status: 'signed-in', chrome: c.chrome ?? '', expiresAt: Date.now() + 12 * 3_600_000 } : a) }
    }
    case 'hub-aws-window': {
      const w = h.signIns.window
      if (!w) return h
      const { [w]: _was, ...rest } = h.signIns.projects
      return { ...h, signIns: { ...h.signIns, projects: c.profile === null ? rest : { ...rest, [w]: c.profile } } }
    }
    case 'hub-coder-view': return { ...h, controls: { ...h.controls, switchboard: { ...h.controls.switchboard, coderView: c.on } } }
    case 'hub-research-dismiss': return { ...h, researchOffers: h.researchOffers?.filter(o => o.sessionId !== c.sessionId) }
    case 'hub-research-seen': return { ...h, research: h.research?.map(r => (r.id === c.id ? { ...r, seen: true } : r)) }
    case 'hub-research-delete': return { ...h, research: h.research?.filter(r => r.id !== c.id) }
    case 'hub-research-ask': {
      const text = c.text.trim()
      if (!text) return h
      return { ...h, research: h.research?.map(r => r.id === c.id ? { ...r, asks: [...(r.asks ?? []), { question: text, at: Date.now() }] } : r) }
    }
    case 'hub-research-folder': {
      const f = h.researchFolders ?? { names: [], auto: false }
      const name = c.name.trim(), to = c.to?.trim()
      if (c.op === 'add') return !name || f.names.includes(name) ? h : { ...h, researchFolders: { ...f, names: [...f.names, name] } }
      if (c.op === 'rename') return !to || !f.names.includes(name) || f.names.includes(to) ? h : { ...h, researchFolders: { ...f, names: f.names.map(n => n === name ? to : n) }, research: h.research?.map(r => r.folder === name ? { ...r, folder: to } : r) }
      return { ...h, researchFolders: { ...f, names: f.names.filter(n => n !== name) }, research: h.research?.map(r => r.folder === name ? { ...r, folder: undefined } : r) }
    }
    case 'hub-research-move': return { ...h, research: h.research?.map(r => c.ids.includes(r.id) ? { ...r, folder: c.folder || undefined } : r) }
    case 'hub-research-organize': {
      const f = h.researchFolders ?? { names: [], auto: false }
      if (c.op === 'auto-on' || c.op === 'auto-off') return { ...h, researchFolders: { ...f, auto: c.op === 'auto-on' } }
      if (c.op === 'undo') {
        const was = organizeUndo
        return { ...h, researchFolders: { ...f, undo: undefined }, research: h.research?.map(r => was && r.id in was ? { ...r, folder: was[r.id] } : r) }
      }
      organizeAt = Date.now(); organizeOp = c.op
      return { ...h, researchFolders: { ...f, busy: true, undo: undefined, problem: undefined } }
    }
    case 'hub-first-run': return h.firstRun ? { ...h, firstRun: { ...h.firstRun, dismissed: c.dismissed || undefined } } : h
    case 'hub-advanced': return { ...h, controls: { ...h.controls, switchboard: { ...h.controls.switchboard, advancedMode: { ...h.controls.switchboard.advancedMode, [c.path]: c.on } } } }
    case 'hub-stage': return { ...h, stages: { ...h.stages, [c.path]: (h.stages?.[c.path] ?? []).map(r => r.run !== c.run ? r : { ...r, stages: r.stages.map(st => {
      if (st.n === c.n) return { ...st, status: c.status }
      // Looks good starts the next stage.
      return c.status === 'done' && st.n === c.n + 1 && st.status === 'todo' ? { ...st, status: 'doing' as const } : st
    }) }) } }
    case 'hub-escalation-reset': return { ...h, escalations: { ...h.escalations, [c.project]: (h.escalations?.[c.project] ?? []).filter(e => e.role !== c.role || e.files.join() !== c.files.join()) } }
    case 'hub-role-model': return { ...h, installed: h.installed.map(i => (i.kind === 'role' && i.name === c.role ? { ...i, model: c.model } : i)) }
    case 'hub-role-codex': return { ...h, installed: h.installed.map(i => {
      if (i.kind !== 'role' || i.name !== c.role) return i
      const { codexModel: _m, codexEffort: _e, ...rest } = i
      return { ...rest, ...(c.model !== 'default' ? { codexModel: c.model } : {}), ...(c.effort !== 'default' ? { codexEffort: c.effort } : {}) }
    }) }
    case 'hub-aws-delete':
      return { ...h, aws: h.aws.filter(a => a.name !== c.profile) }
    case 'hub-login-app-add': {
      const apps = h.signIns.apps ?? []
      if (!c.name.trim() || apps.some(a => a.name.toLowerCase() === c.name.trim().toLowerCase())) return h
      return { ...h, signIns: { ...h.signIns, apps: [...apps, { id: `app-${Date.now()}`, name: c.name.trim(), url: c.url, logins: [] }] } }
    }
    case 'hub-key-save':
    case 'hub-key-test':
    case 'hub-key-remove': {
      const keys = (h.signIns.keys ?? []).map(k => k.name !== c.name ? k
        : c.type === 'hub-key-remove' ? { name: k.name, saved: false }
        : c.type === 'hub-key-save' ? { name: k.name, saved: true, last4: c.value.trim().slice(-4), checked: { ok: true, at: Date.now() } }
        : { ...k, checked: { ok: true, at: Date.now() } })
      return { ...h, signIns: { ...h.signIns, keys } }
    }
    case 'hub-login-app-delete':
      return { ...h, signIns: { ...h.signIns, apps: (h.signIns.apps ?? []).filter(a => a.id !== c.app) } }
    case 'hub-browser': {
      const { [c.folder]: _was, ...rest } = h.signIns.browsers ?? {}
      return { ...h, signIns: { ...h.signIns, browsers: c.chrome === null ? rest : { ...rest, [c.folder]: c.chrome } } }
    }
    case 'hub-login-link': {
      const links = h.signIns.links ?? {}
      const { [c.app]: _was, ...rest } = links[c.folder] ?? {}
      return { ...h, signIns: { ...h.signIns, links: { ...links, [c.folder]: c.login === 'off' || c.login === null ? rest : { ...rest, [c.app]: c.login } } } }
    }
    case 'hub-login-add':
    case 'hub-login-open':
    case 'hub-login-active':
    case 'hub-login-rename':
    case 'hub-login-delete': {
      const apps = (h.signIns.apps ?? []).map(a => {
        if (a.id !== c.app) return a
        if (c.type === 'hub-login-add') {
          const id = `l-${Date.now()}`
          return { ...a, logins: [...a.logins, { id, label: c.label.trim(), url: c.url, chrome: c.chrome, ...(c.email ? { email: c.email.trim() } : {}) }], active: a.active ?? id }
        }
        if (c.type === 'hub-login-active') return { ...a, active: c.id }
        if (c.type === 'hub-login-delete') {
          const logins = a.logins.filter(l => l.id !== c.id)
          return { ...a, logins, active: a.active === c.id ? logins[0]?.id : a.active }
        }
        return { ...a, logins: a.logins.map(l => l.id !== c.id ? l : c.type === 'hub-login-rename' ? { ...l, label: c.label.trim() || l.label, ...(c.email !== undefined ? { email: c.email.trim() || undefined } : {}) } : { ...l, chrome: c.chrome ?? l.chrome }) }
      })
      if (c.type !== 'hub-login-open') return { ...h, signIns: { ...h.signIns, apps } }
      const { [`login:${c.app}:${c.id}`]: _err, ...errors } = h.signIns.errors ?? {}
      return { ...h, signIns: { ...h.signIns, apps, errors } }
    }
    case 'hub-dev-start':
    case 'hub-dev-stop': {
      const row = h.dev?.find(d => d.folder === c.folder)
      if (!row) return h
      const { port: _p, link: _l, ...stopped } = row
      const next = c.type === 'hub-dev-stop' ? stopped : row.port ? row : { ...row, port: 5173, link: `${DEMO_TAILNET}:15173` }
      return { ...h, dev: h.dev?.map(d => (d === row ? next : d)) }
    }
    case 'hub-todo-add':
    case 'hub-todo-edit':
    case 'hub-todo-remove':
    case 'hub-todo-restore':
    case 'hub-todo-accept':
    case 'hub-todo-dismiss':
    case 'hub-todo-move':
    case 'hub-todo-pilot':
    case 'hub-todo-run': {
      // Like the extension, the first item for a project with no list starts one.
      const list = h.todos?.[c.path] ?? (c.type === 'hub-todo-add' ? { todo: [] } : undefined)
      if (!list) return h
      const set = (l: typeof list) => withPlans({ ...h, todos: { ...h.todos, [c.path]: l } }, now)
      const now = Date.now(), id = `dt-${now.toString(36)}-${++demoSeq}`
      if (c.type === 'hub-todo-pilot') return set({ ...list, pilot: { ...list.pilot, ...(c.on !== undefined ? { on: c.on } : {}), ...(c.paused !== undefined ? { paused: c.paused } : {}), at: now } })
      if (c.type === 'hub-todo-add') return c.text.trim() ? set({ ...list, todo: [...list.todo, { id, text: c.text.trim(), at: now }] }) : h
      if (c.type === 'hub-todo-move') { const at = new Map(c.ids.map((id, i) => [id, i])); return set({ ...list, todo: list.todo.map((t, i) => ({ t, k: at.get(t.id) ?? c.ids.length + i })).sort((x, y) => x.k - y.k).map(x => x.t) }) }
      if (c.type === 'hub-todo-edit') return set({ ...list, todo: list.todo.map(t => (t.id === c.id ? { ...t, text: c.text.trim() || t.text, at: now } : t)) })
      if (c.type === 'hub-todo-remove') {
        const t = list.todo.find(x => x.id === c.id) ?? list.suggested?.find(x => x.id === c.id)
        if (!t) return h
        // Keeps why and from like the extension's tickRow, so Put back brings a Finish up step back as one.
        const { chat: _c, host: _h, at: _a, ...row } = t as TodoItem
        return set({ ...list, todo: list.todo.filter(x => x !== t), suggested: list.suggested?.filter(x => x !== t), ticked: [{ ...row, at: now }, ...list.ticked ?? []].slice(0, 10) })
      }
      if (c.type === 'hub-todo-accept' || c.type === 'hub-todo-dismiss') {
        const t = list.suggested?.find(x => x.id === c.id)
        if (!t) return h
        const rest = list.suggested!.filter(x => x !== t)
        return set({ ...list, suggested: rest, ...(c.type === 'hub-todo-accept' ? { todo: [...list.todo, { ...t, id, at: now }] } : {}) })
      }
      if (c.type === 'hub-todo-restore') {
        const t = list.ticked?.find(x => x.id === c.id)
        if (!t) return h
        const { id: _i, at: _a, by: _b, ...more } = t
        return set({ ...list, ticked: list.ticked!.filter(x => x !== t), todo: [...list.todo, { ...more, id, at: now }] })
      }
      // Run: a new demo chat (or the one named) takes the items and their open prerequisites.
      const run = runIds(list.todo, c.ids), items = list.todo.filter(t => run.has(t.id))
      const started = c.to ? h : demoApply(h, { type: 'hub-new-chat', path: c.path, text: items.map(t => t.text).join('; '), remote: false })
      const chat = c.to ?? started.chats[0].sessionId
      const n = (list.seq ?? 0) + 1
      return withPlans({ ...started, todos: { ...h.todos, [c.path]: { ...list, seq: n, streak: list.streak ?? n, todo: list.todo.map(t => (run.has(t.id) ? { ...t, chat, at: now, run: n } : t)) } } }, now)
    }
    case 'hub-live-dismiss': return c.kind === 'mirofish' ? { ...h, mirofish: undefined } : { ...h, crowdAb: undefined }
    case 'hub-awake': return { ...h, awake: c.on }
    // The demo has no processes: Stop and Dismiss both take the item off.
    case 'hub-stuck-stop':
    case 'hub-stuck-dismiss':
    case 'hub-stuck-fix': return { ...h, stuck: h.stuck?.filter(i => i.id !== c.id) }
    case 'hub-wait-for': return { ...h, links: [...(h.links ?? []).filter(l => l.from !== c.from || l.to.join() !== c.to), { from: c.from, to: [c.to], reason: 'Kenneth linked these in Switchboard', auto: false, since: Date.now() }] }
    case 'hub-unlink': return { ...h, links: h.links?.flatMap(l => { const to = l.from === c.from ? l.to.filter(t => t !== c.to) : l.to; return to.length ? [{ ...l, to }] : [] }) }
    case 'hub-rc-server': return { ...h, rcServers: h.rcServers.map(r => (r.folder === c.folder ? { ...r, on: c.on } : r)) }
    default: return h
  }
}

/** Where a demo upload says it went, laid out like the real uploads folder. */
/** The demo's hub-split-result: a multi message comes back as three asks, list items or sentences first. */
export function demoSplit(text: string): string[] {
  const t = text.trim()
  if (!looksMulti(t)) return [t]
  const items = t.split(/\n+/).map(l => l.replace(/^\s*(?:\d+[.)]|[-*\u2022])\s+/, '').trim()).filter(Boolean)
  const parts = items.length >= 2 ? items : t.split(/(?<=[.!?])\s+/).map(s => s.replace(/^(?:also|plus|another thing:?|and then)[\s,]*/i, '').trim()).filter(Boolean)
  return [...parts, 'Check it on a phone', 'Write the tests for it'].slice(0, 3)
}

export function demoUpload(name: string, cwd: string, now = new Date()): string {
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return `~/.claude/switchboard/uploads/${cwd.split('/').filter(Boolean).pop() ?? 'misc'}/${day}/${name.split(/[/\\]/).pop()}`
}

const DEMO_JOBS: Record<string, { title: string; brief: string; files: Array<[string, number, number]>; changed: string[]; checked: string[]; open: string[]; tools: Array<[string, string]> }> = {
  researcher: { title: 'Find where the redirect loops', brief: 'Goal: find why Safari loops on /login after sign in.\nKnown: auth/middleware.ts redirects on no session.\nReport: Status, Found, Checked, Open.',
    files: [], changed: ['auth/middleware.ts:14 redirects to /login even on /login', 'lib/session.ts:42 drops the cookie for Safari'], checked: ['Read both files and the Safari cookie notes'], open: ['Not reproduced on a real iPhone'],
    tools: [['Grep', 'redirect'], ['Read', 'auth/middleware.ts'], ['Read', 'lib/session.ts'], ['Grep', 'Safari'], ['WebFetch', 'webkit.org']] },
  engineer: { title: 'Fix the cookie check', brief: 'Goal: stop the login redirect loop.\nKnown: middleware.ts:14 and session.ts:42 (from researcher).\nRuled out: new auth library.\nUse: superpowers:test-driven-development.\nReport: Status, Changed, Checked, Open.',
    files: [['auth/middleware.ts', 18, 6], ['auth/redirect.test.ts', 41, 0], ['lib/session.ts', 0, 3]], changed: ['auth/middleware.ts:12-24 no redirect on /login itself', 'lib/session.ts:40 drops the Safari special case', 'auth/redirect.test.ts new, 4 cases'], checked: ['npx tsx --test auth/*.test.ts, 538 pass', 'tsc --noEmit clean'], open: ['Safari on a real phone not tried'],
    tools: [['Read', 'auth/middleware.ts'], ['Write', 'auth/redirect.test.ts'], ['Bash', 'npx tsx --test auth'], ['Edit', 'auth/middleware.ts'], ['Edit', 'lib/session.ts'], ['Bash', 'npx tsx --test auth'], ['Bash', 'tsc --noEmit']] },
  qa: { title: 'Run tests and review', brief: 'Review the redirect fix. Run the auth tests and tsc. Report only verified problems.', files: [], changed: ['auth/middleware.ts:18 /login?next= still loops'], checked: ['npx tsx --test auth, 2 fail', 'tsc clean'], open: [],
    tools: [['Bash', 'git diff'], ['Read', 'auth/middleware.ts'], ['Bash', 'npx tsx --test auth']] },
  designer: { title: 'Card states', brief: 'Draw the picker labels in the existing tokens. Light and dark.', files: [['app/picker.tsx', 22, 9], ['app/globals.css', 6, 2]], changed: ['app/picker.tsx labels and empty state'], checked: ['Looked at 375px and 1280px, both themes'], open: [],
    tools: [['Read', 'app/picker.tsx'], ['Edit', 'app/picker.tsx'], ['Edit', 'app/globals.css']] },
}

/** Run details for the demo's drawer, one per run the demo chat shows for that role. */
export function demoRunDetails(p: ChatProgress | undefined, role: string, now = Date.now()): RunDetail[] {
  if (role === 'lead') return p ? [demoLead(p, now)] : []
  const job = DEMO_JOBS[role] ?? DEMO_JOBS.designer
  const steps = [...(p?.roles ?? [])].filter(r => r.role === role).sort((a, b) => a.startedAt - b.startedAt)
  return steps.map((r, i): RunDetail => {
    const done = r.state === 'done', end = done ? r.at ?? Math.min(now, r.startedAt + (8 + i * 3) * 60e3) : now
    const span = Math.max(1000, end - r.startedAt)
    const calls: RunCall[] = job.tools.map(([tool, target], k) => ({ tool, target, at: r.startedAt + ((k + 1) / (job.tools.length + 1)) * span }))
    const sentBack = role === 'engineer' && i === 0 && steps.length > 1
    const cached = 180_000 + i * 90_000
    return {
      id: r.id, role, title: steps.length > 1 && i < steps.length - 1 ? `${job.title}, round ${i + 1}` : job.title, model: 'claude-opus-5-5',
      startedAt: r.startedAt, endedAt: end, finished: done, brief: job.brief,
      ...(done || i < steps.length - 1 ? { report: { status: role === 'qa' ? 'done with concerns' : 'done', changed: job.changed, checked: job.checked, open: job.open }, reportText: `Status: done\nChanged:\n${job.changed.map(c => `- ${c}`).join('\n')}\nChecked:\n${job.checked.map(c => `- ${c}`).join('\n')}${job.open.length ? `\nOpen:\n${job.open.map(c => `- ${c}`).join('\n')}` : ''}` } : {}),
      files: job.files.map(([path, added, removed]) => ({ path, added, removed })), calls, callCount: calls.length,
      loops: sentBack ? [{ at: r.startedAt + span * 0.9, by: 'qa', text: 'qa found /login?next= still loops: middleware.ts:18 checks the path before stripping the query. Fix it and add a test.' }] : [],
      tokens: { input: 1200 + i * 300, output: 9_000 + i * 2_000, cacheRead: cached, cacheWrite: 24_000 }, costUsd: 0.4 + i * 0.35, file: '',
    }
  })
}

// The lead: the chat's own transcript, its Agent calls carrying each role's brief.
function demoLead(p: ChatProgress, now: number): RunDetail {
  const steps = [...p.roles].filter(r => r.role !== 'jev').sort((a, b) => a.startedAt - b.startedAt)
  const start = Math.min(p.startedAt, ...steps.map(r => r.startedAt))
  const dispatches = steps.map(r => { const job = DEMO_JOBS[r.role] ?? DEMO_JOBS.designer; return { at: r.startedAt, role: r.role, title: job.title, brief: job.brief } })
  const calls: RunCall[] = [{ at: start + 2000, tool: 'TaskCreate', target: 'Find the cause' }, ...dispatches.map(d => ({ at: d.at, tool: 'Agent', target: d.role })), ...(p.tools ?? []).filter(t => t.role === 'lead').map(t => ({ at: t.at, tool: t.tool, target: t.target }))].sort((a, b) => a.at - b.at)
  const working = p.state === 'working'
  return {
    id: p.sessionId, role: 'lead', model: 'claude-opus-5-5', startedAt: start, endedAt: working ? now : p.at, finished: !working,
    brief: p.asked?.[0] ?? '', reportText: p.state === 'done' ? 'Done. The redirect loop is fixed and qa passed.' : 'Researcher found the loop in middleware.ts. Sending the engineer to fix it, then qa.',
    files: [], calls, callCount: calls.length, loops: [], dispatches,
    tokens: { input: 2400, output: 31_000, cacheRead: 920_000, cacheWrite: 64_000 }, costUsd: 1.9, file: '',
  }
}

const DEMO_SHOT = '/Users/k/GitHub/switchboard/.playwright-mcp/hub-1440.png'
const DEMO_SHOT2 = '/Users/k/GitHub/switchboard/.playwright-mcp/hub-380.png'
// A small drawn page, so the demo shows an image without shipping one.
const SHOT_SVG = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400"><rect width="640" height="400" fill="#0d0d0d"/><rect x="0" y="0" width="640" height="40" fill="#121212"/><circle cx="24" cy="20" r="6" fill="#59d499"/><rect x="40" y="14" width="120" height="12" rx="6" fill="#434345"/><rect x="16" y="56" width="180" height="328" rx="8" fill="#101111" stroke="#242728"/><rect x="28" y="72" width="156" height="44" rx="6" fill="#121212" stroke="#242728"/><rect x="28" y="124" width="156" height="44" rx="6" fill="#121212" stroke="#242728"/><rect x="212" y="56" width="412" height="328" rx="8" fill="#101111" stroke="#242728"/><rect x="232" y="80" width="200" height="14" rx="7" fill="#f4f4f6"/><rect x="232" y="108" width="360" height="10" rx="5" fill="#434345"/><rect x="232" y="128" width="300" height="10" rx="5" fill="#434345"/><rect x="232" y="168" width="96" height="28" rx="14" fill="#ffffff"/></svg>')}`
const DEMO_LINES: ChatMessage[] = [
  { role: 'you', text: 'Add Codex to the hub next to Claude. Let me star chats and resume them later.' },
  { role: 'claude', text: 'Goal: Codex chats beside Claude ones, plus Starred chats with a resume command. Researcher first, then engineer, then qa.' },
  { role: 'tool', text: 'Agent researcher' },
  { role: 'subagent', text: 'Agent "Find the session sources" completed\nStatus: done. Codex writes ~/.codex/sessions/<date>/*.jsonl.' },
  { role: 'tool', text: 'Read hub/types.ts' },
  { role: 'tool', text: 'result: export type ChatRow = {' },
  { role: 'tool', text: 'Edit hub/types.ts' },
  { role: 'tool', text: 'Bash pnpm test' },
  { role: 'tool', text: 'error: 1 failing: ais.test.ts lists both AIs' },
  { role: 'claude', text: 'One test fails on the AI order. Sending it back to the engineer.' },
]

/** The demo's answers to the chat view's three reads; transcript before counts messages, not bytes. */
export function demoChat(h: HubState, session: string, what: 'outputs' | 'transcript' | 'shot', ask: ChatAsk = {}): ChatAnswer {
  const p = h.progress.find(x => x.sessionId === session)
  if (!p) return {}
  if (what === 'shot') return ask.path === DEMO_SHOT || ask.path === DEMO_SHOT2 ? { shot: SHOT_SVG } : {}
  if (what === 'transcript' && session !== 'd-done') {
    // A short script from the chat's own name, role and first task, so each chat reads as itself.
    const goal = (h.chats.find(c => c.sessionId === session)?.name ?? 'This chat').replace(/ v\d+$/, '')
    const role = p.roles.find(r => r.state === 'active')?.role ?? 'engineer', task = p.tasks[0]?.subject
    const messages: ChatMessage[] = [
      { role: 'you', text: `${goal}, please.` },
      { role: 'claude', text: `Goal: ${goal}. Handing it to the ${role}.` },
      { role: 'tool', text: `Agent ${role}` },
      ...(task ? [{ role: 'tool' as const, text: `TaskCreate ${task}` }] : []),
      { role: 'claude', text: p.question ?? (p.state === 'done' ? `${goal} is done.` : `Still on ${goal}.`) },
    ]
    return { transcript: { messages, before: null } }
  }
  if (what === 'transcript') {
    // d-done: 80 messages, the script above repeated with a round number.
    const all = Array.from({ length: 80 }, (_, i) => { const m = DEMO_LINES[i % DEMO_LINES.length]; return i < DEMO_LINES.length ? m : { ...m, text: `${m.text} (round ${Math.floor(i / DEMO_LINES.length) + 1})` } })
    const end = Math.min(all.length, ask.before ?? all.length), start = Math.max(0, end - 50)
    return { transcript: { messages: all.slice(start, end), before: start > 0 ? start : null } }
  }
  const outputs: ChatOutputs = {
    final: `${p.report ? `Done:\n${p.report.done.map(d => `- ${d}`).join('\n')}` : 'Still working.'}${p.commit ? `\n\nCommit message:\n\`\`\`\n${p.commit}\n\`\`\`` : ''}`,
    ...(p.report ? { standup: p.report } : {}),
    ...(p.commit ? { commit: p.commit } : {}),
    questions: [
      { question: 'Should Codex chats share the Claude list or get their own?', answer: 'One list, with an AI chip' },
      { question: 'Keep the old resume command for Claude chats?' },
    ],
    reports: [
      { id: 'r1', label: 'Find the session sources', role: 'researcher', text: 'Status: done\nFound:\n- Codex sessions live in ~/.codex/sessions/<date>/*.jsonl\n- Each line is one event; the first holds the cwd' },
      { id: 'e1', label: 'Codex chats and Starred', role: 'engineer', text: 'Status: done\nChanged:\n- extension/src/hub/ais.ts: a registry of AIs\n- extension/src/hub/starred.ts: star and resume\nChecked:\n- pnpm test, 538 passed' },
      { id: 'q1', label: 'Review the AI registry', role: 'qa', text: 'Status: done with concerns\nFound: nothing blocking. The Resume command quotes the folder.\nOpen:\n- Starred list has no empty state yet\n- Resume on a folder with spaces needs a manual check' },
    ],
    tests: [{ command: 'pnpm test', ok: false, failed: 1, total: 538, first: 'ais.test.ts lists both AIs' }, { command: 'pnpm run lint && pnpm test', ok: true, total: 538 }],
    errors: [{ tool: 'Bash', text: 'Exit code 1\n1 failing: ais.test.ts lists both AIs' }],
    files: ['/Users/k/GitHub/switchboard/extension/src/hub/ais.ts', '/Users/k/GitHub/switchboard/extension/src/hub/starred.ts', '/Users/k/GitHub/switchboard/extension/src/hub/types.ts', '/Users/k/GitHub/switchboard/extension/src/hub/ais.test.ts', '/Users/k/GitHub/switchboard/extension/src/hub/starred.test.ts', '/Users/k/GitHub/switchboard/web/components/switchboard/chat-row.tsx', '/Users/k/GitHub/switchboard/web/lib/hub-types.ts'],
    shots: [DEMO_SHOT, DEMO_SHOT2],
  }
  return { outputs }
}
