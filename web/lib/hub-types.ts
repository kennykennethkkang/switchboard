/**
 * The Hub tab's data, shared word for word between extension/src/hub/types.ts and web/lib/hub-types.ts.
 *
 * Live arrives from each Claude Code session's usage mod (POST /hub); the rest
 * the extension gathers itself.
 */

export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
export type KeptLimits = { at: number; windows: Limit[]; out?: { resetsAt?: number; text?: string } }
export type LimitPause = { kind: string; percent: number; resumeAt?: number; chats: { sessionId: string; name?: string }[] }

export type SessionLive = {
  sessionId: string
  cwd: string
  label?: string
  model?: string
  tokens?: number
  compactAt?: number
  limits: Limit[]
  costUsd?: number
  /** The latest prompt, redacted and cut short by the usage mod. */
  prompt?: string
  /** The latest file a tool read or wrote, and when it changed. */
  file?: string
  fileAt?: number
  at: number
}

/** A change a research report suggests, from its Actions section (adjust-actions.ts). ask: it cannot be undone. */
export type ReportAction = { key: string; area: 'mac' | 'dev' | 'kit' | 'other' | 'project'; ask: boolean; title: string; detail: string; undo?: string; cites: number[] }
export type SuggestedChanges = { report: string; question: string; project?: string; at: number; actions: (ReportAction & { state: 'new' | 'open' | 'applied' | 'failed' | 'undone' })[] }
/** One logged change from ~/.claude/switchboard/adjustments (kit/skills/adjust). before null: the file was new. */
export type Change = {
  id: string; title: string; why: string; area: 'mac' | 'dev' | 'kit' | 'other'; target: string; device: string
  status: 'open' | 'applied' | 'failed' | 'undone' | 'undo-failed'
  at: number; doneAt?: number; undoneAt?: number; sessionId?: string; chat?: string; report?: string; action?: string
  files: { path: string; link?: string; backup: string | null; before: string | null; after?: string | null; mode?: number }[]
  undo?: string; noUndo?: string; check?: { cmd: string; ok: boolean; out: string }; problem?: string
}

/** A chat's prompt cache as the cache-keeper mod last posted it; warmUntil is when it goes cold unless pinged. */
export type CacheKeep = { sessionId: string; state: 'warm' | 'cold' | 'off'; warmUntil: number; tokens: number; pings: number; at: number }

export type DayUsage = { day: string; reread: number; written: number; io: number; calls: number; sessions: number }
export type SessionRow = { sessionId: string; label: string; project: string; reread: number; calls: number; startedAt: number; lastAt: number }
export type PlanView = { name: string; tasks: { title: string; done: number; total: number }[]; decisions?: string[] }
/** folder: the cwd's last two names, for show; cwd: the full one. */
export type Server = { pid: number; command: string; port: number; folder: string; cwd?: string }
/** A project folder with a dev script. Running when port is set; link is its tailscale serve address, when served. */
export type DevProject = { folder: string; project: string; /** projectName(folder), for the project filter; project stays the terminal's key. */ repo: string; command: string; port?: number; link?: string }
export type GitState = { branch?: string; ahead?: number; behind?: number; changed: number; staged: number; untracked: number }
export type AwsStatus = 'signed-in' | 'expired' | 'never'
/** One ~/.aws/config profile; its name is the user's nickname. label: the email set by hand (aws-labels.json, by account). who, email: what AWS said at the last sign-in (aws-identity.json, by account). chrome: the Chrome profile folder its sign-in opens in ('' = system browser). */
export type AwsProfile = { name: string; label?: string; who?: string; email?: string; account?: string; region?: string; status: AwsStatus; chrome?: string; checkedAt: number; /** Signs in as the account root (aws login): AWS sets the session length, no way to extend it. */ root?: boolean; /** When the aws login session ends at the latest (sign-in + 12 h). */ expiresAt?: number; /** The last check could not tell (timeout, network), so status may be stale. */ unsure?: boolean; /** Signs in through single sign-on (aws sso login). */ sso?: boolean }
export type ChromeProfile = { dir: string; name: string; email?: string }
/** Chrome profiles to sign in with, the AWS profile picked per project folder, and this window's folder. */
/** A saved web login: only where to sign in and in which Chrome profile, never a password or token. */
export type WebLogin = { id: string; label: string; url: string; chrome?: string; /** Who it signs in as, typed by the user. */ email?: string; /** A tenant a CLI login added (Auth0): commands run with --tenant <domain>. */ domain?: string; /** A CLI tenant's last check, as for AWS. */ status?: AwsStatus }
/** A web app with its saved logins (~/.claude/switchboard/logins.json); url is where a new login starts. */
export type WebApp = { id: string; name: string; url: string; logins: WebLogin[]; active?: string; /** Sign in runs the app's CLI login (cli-logins.ts), which adds its tenants. */ cli?: boolean }
/** Apps a project uses, by project folder then app id, then the login it picked. */
export type Links = Record<string, Record<string, string>>
export type ApiKeyName = 'GEMINI_API_KEY' | 'OPENROUTER_API_KEY' | 'PERPLEXITY_API_KEY' | 'FIRECRAWL_API_KEY' | 'ZEP_API_KEY'
/** A saved API key as the UI sees it: never the key, only its last four. checked: the last live test. */
/** What a .env setup did: names only, never a value. key is the saved key a missing name needs. */
export type EnvSetup = { folder: string; file: string; filled: string[]; kept: string[]; missing: Array<{ name: string; key?: ApiKeyName }>; at: number }
export type ApiKey = { name: ApiKeyName; saved: boolean; last4?: string; checked?: { ok: boolean; at: number; reason?: string } }
/** apps, links, keys: an older extension sends none. */
export type SignIns = { chrome: ChromeProfile[]; projects: Record<string, string>; window?: string; apps?: WebApp[]; links?: Links; /** Chrome folder per project folder, '' Chrome's last used profile; a login's own pick wins. */ browsers?: Record<string, string>; keys?: ApiKey[]; envSetup?: EnvSetup; /** The last failed sign-in per row (aws:<profile>, login:<app>:<id>), redacted. */ errors?: Record<string, string>; /** Per row: the Chrome pick a sign-in skipped for being deleted, and where it opened instead. */ notes?: Record<string, string>; /** Web apps with a CLI login running (cli-logins.ts); their Sign in waits for it. */ busy?: string[] }
/** One Jev run from the usage mod, tied to the chat that ran it when known. */
export type JevRun = { sessionId?: string; preset?: string; items: number; costUsd: number; seconds: number; at: number }
/** Set up Jev's jobs for one project, its newest runs (gate: one command each) and what those runs cost. */
export type JevProject = { project: string; jobs: { done: boolean; gate: boolean; tells: boolean; route: boolean }; runs: { job: string; at: number; items: number; costUsd: number; result?: string }[]; costUsd: number }
/** One agent action from a MiroFish sim, newest first in the feed. */
export type MirofishPost = { at: string; who: string; platform: string; action: string; text?: string; /** text is Switchboard's English of a non-English post. */ translated?: boolean }
export type MirofishState = { simId: string; step: 'rounds' | 'report' | 'done'; round: number; rounds: number; percent: number; startedAt?: string; elapsedMs?: number; etaMs?: number; reportReady: boolean; reportExcerpt?: string; feed?: MirofishPost[]; /** While the report is written: percent and sections done. */ reportPercent?: number; reportSections?: number; reportError?: string; /** Switchboard stopped retrying the report. */ reportGaveUp?: boolean; reportId?: string; /** The report is saved in ~/.claude/switchboard/mirofish. */ saved?: boolean; /** The rounds have not moved for 30 minutes. */ stalled?: boolean }
/** A MiroFish report Switchboard saved; only the newest carries its markdown. */
export type MirofishReport = { simId: string; reportId?: string; title: string; at: string; summary?: string; requirement?: string; file: string; markdown?: string; /** markdown is Switchboard's English of a non-English report. */ translated?: boolean }
/** One synthetic user's rating or pick in a crowd-ab run. */
export type CrowdVote = { at: number; who: string; option: string; appeal?: number; reason?: string; why?: string }
/** The newest crowd-ab run, read live from Jev's run files (crowd-live.ts). votes: personas decided so far per option label. */
export type CrowdLive = { run: string; startedAt: number; lastAt: number; items: number; done: number; ended: boolean; /** No new rating for 5 minutes and no end row. */ stopped?: boolean; votes: { label: string; n: number }[]; noPreference: number; feed: CrowdVote[] }
/** A full chat whose handoff waits on its running subagents (Claude) or open turn (Codex). next: the fresh chat's version, like v2. */
export type HandoffWait = { sessionId: string; tasks: number; next: string; since: number }
/** One chat waiting on others (chat-wait mod or a card). auto: an edit clash, reason is the file path; since: epoch ms. */
export type ChatLink = { from: string; to: string[]; reason: string; auto: boolean; since: number }
/** Kenneth removed `to` from `from`'s wait at `at`; kept five minutes so the waiting chat can tell it from a link gone missing. */
export type ChatUnlink = { from: string; to: string; at: number }
/** skills: a plugin's own skill names. model: a role's frontmatter model (inherit, an alias or a full id). codex: its body runs codex exec; codexModel and codexEffort: that line's -m and reasoning effort flags (none = config.toml default). description: plugin.json's or SKILL.md's, cut short. */
/** asset: a design reference in the project; path is relative to the project folder. */
/** provider: the tool's own prepaid credit caps it; cap: Switchboard's monthly dollar cap; ask: every call. */
export type SpendMode = 'provider' | 'cap' | 'ask'
/** usd: estimated, from paid-guard's per call table. */
export type SpendRow = { key: string; label: string; mode: SpendMode; monthlyUsd: number; calls: number; usd: number }
/** held: the sweep holds it until approved (kit/sweep.mjs needsApproval); no chat may turn it on. */
export type Installed = { kind: 'mod' | 'plugin' | 'skill' | 'role' | 'preset' | 'asset' | 'builtin' | 'mcp'; name: string; enabled: boolean; held?: boolean; tokens?: number; source?: string; skills?: string[]; model?: string; codex?: boolean; codexModel?: string; codexEffort?: string; description?: string; path?: string }
/** One chat's plugins (by id) and user skills (by name), on or off; tools.ts turns it into the chat's --settings file. */
/** assets: design references by project-relative path, named to the chat in its system note. indefinite: Run indefinitely is on since this epoch ms. */
export type ChatProfile = { plugins: Record<string, boolean>; skills: Record<string, boolean>; assets?: Record<string, boolean>; /** Built-in tools by name and MCP servers as mcp:<server>, on or off. */ extras?: Record<string, boolean>; indefinite?: number; /** Limits and a gate for Run indefinitely; dropped when it ends. */ budget?: IndefiniteBudget; /** Check-back setting; stays after Run indefinitely ends. */ checkBack?: CheckBack }
/** maxHours, maxCostUsd: stop at the nearer limit (not a success). gate: shell command run in the project folder; exit 0 lets the chat stop. All off when absent. */
export type IndefiniteBudget = { maxHours?: number; maxCostUsd?: number; gate?: string }
/** One indefinite.json value: a bare number is onAt alone (older hubs), an object adds the budget. */
export type IndefiniteEntry = number | ({ onAt: number } & IndefiniteBudget)
/** Idle chats get a check-back every everyMin minutes, up to 12 times: text (the Timer loop's prompt) always, the default text only while work is open. count: sent so far; lastAt: the latest, epoch ms. */
export type CheckBack = { everyMin: 10 | 30 | 60 | 180 | 1440; count: number; lastAt?: number; text?: string }
/** flagged: duplicates kept off unless turned on by hand. pick: the last hub-pick-tools answer (the all-on set), for its goal. chats: saved profiles by session id. */
/** Smart toggle per chat (smart-tools.ts): why: rule per pick; on: what it switched on itself; refused: held picks; library: design library paths it picked; pending: waits for the next start or resume. */
export type SmartRecord = { why: Record<string, string>; on: Record<string, string>; refused: string[]; library: string[]; pending: boolean; at: number }
/** smart: by session id. globalOff: skills ~/.claude/settings.json turns off everywhere. */
export type ToolsState = { flagged: string[]; pick: { goal: string; folder?: string; profile: ChatProfile } | null; chats: Record<string, ChatProfile>; smart?: Record<string, SmartRecord>; globalOff?: string[]; /** Per-tool precedence from tool-precedence.json (unset is auto): always is never turned off, never is off unless turned on by hand. */ precedence?: Record<string, 'always' | 'never'> }
/** A sweep result. review: DO_NOT_INSTALL or a HIGH or CRITICAL issue, or an add that could not be scanned. top: the worst issues, at most 5.
 * hold: held at intake; it stays off until approvedDigest matches its files. Only intake sets it and nothing clears it. offFailed: claude plugin disable failed, so it may still be on. */
export type SweepIssue = { id: string; severity: string; file?: string; line?: number; finding: string }
export type SweepVerdict = { state: 'clean' | 'review' | 'unscanned'; reason?: string; score?: number; severity?: string; recommendation?: string; issues?: number; top?: SweepIssue[] }
export type SweepRecord = SweepVerdict & { kind: 'plugin' | 'skill'; path: string; digest: string; scannedAt: number; approvedAt?: number; approvedDigest?: string; hold?: boolean; offFailed?: boolean; reviewed?: SweepReview }
/** A human triage of the sweep's findings; only counts while digest matches the record. Never turns a tool on or clears a hold. */
export type SweepReview = { verdict: 'APPROVE' | 'CAUTION' | 'REJECT'; why: string; at: number; digest: string }
export type Connection = { kind: 'mcp' | 'app' | 'project' | 'window' | 'repo'; name: string; status: 'on' | 'off' | 'error'; detail?: string }

/** what: one line, e.g. "1 applied, 2 proposed" or "aar on switchboard chat 1a2b3c4d". */
export type LearnRun = { at: number; kind: 'improve' | 'aar'; what: string }
/** A self-improve run that passed the gate, waiting on Kenneth's Approve. target: path in claude-mods; before, after: held-out pass rates. */
export type LearnReady = { id: string; target: string; before: number; after: number; diff: string }

/** A saved copy of files before an edit: undo puts them back. paths: absolute. chat: the session that made it. */
export type Snapshot = { id: string; label: string; at: number; paths: string[]; chat?: string; /** Files it could not copy. */ skipped?: string[]; /** Why the files changed, one line, to trace a bad rewrite. */ reason?: string }
/** One Check health line. fixable: Fix safe ones can repair it. */
export type HealthResult = { id: string; label: string; status: 'ok' | 'warn' | 'fail'; detail?: string; fixable: boolean }
/** A pipeline saved from a stages run: stages.json and each CONTEXT.md, no outputs. */
export type PipelineInfo = { slug: string; name: string; stages: number; savedAt: number }
/** One number with its change against the day before and the same weekday last week (absent with no data then). */
export type TrendValue = { value: number; vsDay?: number; vsWeek?: number }
/** Yesterday (day: YYYY-MM-DD): chats run, cost, approved and sent back. */
export type DailyTrend = { day: string; chats: TrendValue; costUsd: TrendValue; approved: TrendValue; sentBack: TrendValue }

export type HubState = {
  update?: { current: string; latest?: string; state: 'idle' | 'checking' | 'available' | 'installed' | 'current' | 'error'; note?: string; checkedAt?: number }
  live: SessionLive[]
  /** Last known limits from limits.json, so the meter still reads with no live chat; out: a limit was hit, until resetsAt (epoch ms). */
  limitsKept?: KeptLimits
  /** Last Codex 5h and week windows, account-wide, kept past the chat that fed them; meter only, never a pause input. */
  codexKept?: Limit[]
  /** Latest Codex account daily token buckets, last 30 days. */
  codexDaily?: { day: string; tokens: number }[]
  /** Codex account's available reset credits. */
  codexResets?: number
  /** Chats paused near the limit, resumed in order at resumeAt (epoch ms). */
  pause?: LimitPause
  history: DayUsage[]
  sessions: SessionRow[]
  plan: PlanView | null
  servers: Server[]
  git: GitState | null
  aws: AwsProfile[]
  signIns: SignIns
  jev: JevRun[]
  waits: HandoffWait[]
  links?: ChatLink[]
  unlinks?: ChatUnlink[]
  installed: Installed[]
  connections: Connection[]
  rc: { atStartup: boolean; requestedAt?: number }
  keep: KeepWorking
  projects: Project[]
  /** Stage runs per project path, for projects with Advanced mode on. */
  stages?: Record<string, StageRun[]>
  /** model-learn.json rows by their project. */
  escalations?: Record<string, Escalation[]>
  controls: Controls
  chats: ChatRow[]
  /** This window's terminals, and its folder's chats that have none (Open resumes them). An older extension sends neither. */
  terminals?: TerminalRow[]
  noTerminal?: { sessionId: string; name?: string; ai?: AiId }[]
  rcServers: RcServer[]
  ais: AiStatus[]
  starred: StarredChat[]
  progress: ChatProgress[]
  /** The newest Learn automatically run (improve-system or an aar), for the home screen. */
  learn?: LearnRun
  learnReady?: LearnReady[]
  /** Files Kenneth attached, by project (the uploads folder's name for it); an older extension sends none. */
  uploads?: Uploads
  /** The Summary button per chat (hub-summary): busy while Haiku writes it, then the text or an error. */
  summaries?: Record<string, ChatSummary>
  archive: ArchivedChat[]
  /** Smart select: the latest picks with whether each held up, and the learned rate per kind, task and pick (smart-select.ts). */
  smart?: SmartState
  /** Done chats' done-check verdicts, by session id. */
  doneChecks?: Record<string, DoneCheck>
  /** The changes of the chat the panel asked for (hub-changes), refreshed with the near data. */
  changes: Changes | null
  /** The last History search (hub-search): closed chats whose handoff note holds q. */
  search: NoteSearch | null
  /** The Jarvis box's last question (hub-jarvis): busy while the brain thinks, then an answer or a start to confirm. An older extension sends none. */
  jarvis?: JarvisReply | null
  /** The Jarvis mic (hub-voice) while it records or transcribes; null or absent otherwise. */
  voice?: 'listening' | 'transcribing' | null
  /** The mic's last transcript, for the box to append; at tells a new one from one already taken. */
  heard?: { text: string; at: number } | null
  /** Where the browser version answers, or null when none runs. */
  webUrl: string | null
  /** The app's phone links with their secret, one per network, for the QRs. Only the VS Code panel gets them; /hub/state blanks them. */
  phoneUrls?: PhoneUrls | null
  /** cache-keeper's state per chat; absent with no such mod. */
  cache?: CacheKeep[]
  /** Per chat tool sets; an older extension sends none. */
  tools?: ToolsState
  /** Snapshots of kit, rules, agents and memory edits, newest first (snapshots.ts); an older extension sends none. */
  snapshots?: Snapshot[]
  /** The last Check health run: busy while it or Fix runs (health.ts). */
  health?: { busy: boolean; at?: number; results: HealthResult[] }
  /** Saved Advanced mode pipelines (pipelines.ts). */
  pipelines?: PipelineInfo[]
  /** Yesterday's numbers against the day before and the same weekday last week (notify.ts dailyTrend). */
  trend?: DailyTrend
  /** The SkillSpector sweep (kit/sweep.mjs): one result per plugin or skill name; busy while a sweep or an add runs; note: the last add's or sweep's outcome; progress: Sweep all's count so far. An older extension sends none. */
  sweep?: { busy: boolean; tools: Record<string, SweepRecord>; note?: string; progress?: { done: number; total: number } }
  /** GitHub sync of memory, the vault and prefs (sync.ts): on after Sign in until Turn off; login and last sync time (ms); busy while a run goes; note: the last problem. */
  sync?: { on: boolean; login?: string; last?: number; busy: boolean; note?: string }
  /** Spend limits per paid tool (spend.ts): mode, cap and this month's count; an older extension sends none. */
  spend?: SpendRow[]
  /** Projects with a dev script; an older extension sends none. */
  dev?: DevProject[]
  /** Whether tailscale is installed and up, for the Phone links. */
  tailscale?: boolean
  /** Keep awake (caffeinate) is on. */
  awake?: boolean
  /** Devices waiting for Allow or Deny; kept out of /hub/state, so only the Mac answers. */
  devices?: DeviceAsk[]
  /** Every open VS Code window and its color; an older extension sends none. */
  windows?: WindowInfo[]
  /** The running editor's name (vscode.env.appName, "Visual Studio Code" shortened); an older extension sends none. */
  editor?: string
  /** The workspace of the window showing the panel; /hub/state leaves it out. */
  thisWindow?: string
  /** The window focused last, from any window; the browser app's Plan page follows it. */
  lastWindow?: string
  /** The chat opened last, in a terminal or on a Switchboard page of this Mac, from any window; the other pages follow it. */
  openChat?: { sessionId: string; at: number }
  /** mac: native tabs can work here; live: nativeTabs was on when this window started, so the tab commands do something. */
  windowTabs?: { mac: boolean; live: boolean }
  /** The Git panel's repo: the one holding the chat (or the Ship repo) hub-changes asked for; sessionId is that chat's id or that repo's path. */
  repo?: RepoView | null
  /** Every known repo and its worktrees (ship.ts); an older extension sends none. */
  ship?: ShipRepo[]
  /** The to-do list by project folder (todo.ts); an older extension sends none. */
  todos?: Record<string, TodoList>
  /** Jev per project folder (jev-project.ts); an older extension sends none. */
  jevProjects?: Record<string, JevProject>
  mirofish?: MirofishState
  /** Saved MiroFish reports, newest first (mirofish.ts); an older extension sends none. */
  mirofishReports?: MirofishReport[]
  /** The newest crowd-ab run while fresh; an older extension sends none. */
  crowdAb?: CrowdLive
  /** Agents, jobs and processes that look stuck (stuck.ts), snoozed ones left out; an older extension sends none. */
  stuck?: StuckItem[]
  /** Chats the usage meter thinks are worth a research run: a score from 0 to 1 and a one-line reason, newest last; an older extension sends none. */
  researchOffers?: { sessionId: string; score: number; reason: string; at: number }[]
  /** Finished research runs, newest first, from ~/.claude/switchboard/research (research-library.ts); summary is the report's Answer line. */
  research?: { id: string; question: string; project?: string; chat: string; sessionId: string; at: number; sources: number; summary: string; seen: boolean; /** The folder it is filed in; unfiled without one. */ folder?: string; /** When Ask more last added to it, and how many times. */ added?: { at: number; n: number }; /** Ask more questions still being researched; sessionId once its chat has started. */ asks?: { question: string; at: number; sessionId?: string }[] }[]
  /** Research folders in the order shown; auto files each new report by itself. busy while Smart organize thinks; undo is what its last run moved; problem says why it failed. */
  researchFolders?: { names: string[]; auto: boolean; busy?: boolean; undo?: { moved: number; at: number }; problem?: string }
  /** Workbench: this device in one line, the changes made outside projects, newest first, what reports suggest, and why the last Undo was refused. An older extension sends none. */
  adjust?: { device: string; changes: Change[]; suggestions: SuggestedChanges[]; said?: { id: string; text: string } }
  /** First-run checklist, each step done or not; dismissed hides the card. An older extension sends none. */
  firstRun?: { github: boolean; claude: boolean; project: boolean; chat: boolean; approved: boolean; dismissed?: boolean }
  /** source-check runs, newest first: each source with its band, score 0 to 100 and reasons; report: the HTML report path. An older extension sends none. */
  sourceChecks?: { id: string; question: string; at: number; done: boolean; sources: { url: string; band: 'Reliable' | 'Mixed' | 'Unreliable' | 'Satire' | 'Retracted' | 'Unverifiable'; score: number; reasons: string[] }[]; report?: string }[]
}

/** agent: a subagent with no tool call; job: a background shell or monitor with no output or end; process: one in the chat's tree eating CPU or memory.
 * since: when it went quiet or hot. cpu: percent of one core; rss: bytes. pid and started (its start time) only when the process is known; command: cut to 120 and redacted. last: the last tool call. */
export type StuckItem = { id: string; kind: 'agent' | 'job' | 'process'; sessionId: string; what: string; since: number; cpu?: number; rss?: number; pid?: number; started?: number; command?: string; last?: string }

/** A palette key, not a hex: the panel picks the theme's shade. */
export type WindowColor = 'violet' | 'amber' | 'teal' | 'rose' | 'lime' | 'cobalt' | 'slate'
export type WindowInfo = { workspace: string; name: string; color: WindowColor }

/** One uncommitted file in a chat's folder. diff: from the first hunk, capped; note: why there is none (binary, too big). */
export type ChangedFile = { path: string; added: number; removed: number; status: 'modified' | 'added' | 'deleted' | 'untracked'; diff?: string; note?: string }
/** problem: why the files could not be read (no folder, folder gone, git failed); files is empty then. */
export type Changes = { sessionId: string; cwd: string; files: ChangedFile[]; at: number; problem?: string }
/** A worktree Ship lists under its repo. commits: ones the checkout's HEAD lacks; live: a chat runs in it. */
export type ShipTree = { id: string; name: string; branch?: string; files: number; commits: number; live: boolean; /** Merges once its chat ends. */ queued?: boolean }
/** A repo Ship lists, chat or no chat. id: its path, which hub-changes and hub-git take in place of a chat's sessionId. auto: worktrees merge on their own.
 * merging: a merge runs now, in any window; merge: the last one's outcome. */
export type ShipRepo = { id: string; name: string; branch?: string; files: number; ahead: number; behind: number; auto: boolean; trees: ShipTree[]; merging?: boolean; merge?: { text: string; ok: boolean; at: number } }
/** One file git status lists, relative to the repo root. from: a rename's old path. */
export type RepoFile = { path: string; status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflict'; from?: string }
export type GitOp = 'sync' | 'commit' | 'commit-push' | 'switch' | 'create' | 'undo' | 'discard' | 'pr' | 'stash' | 'pop' | 'delete-branch' | 'rerun' | 'ship' | 'push' | 'merge-back' | 'merge-all'
/** Git ops only the Mac may run: the phone hides them and the app's proxy refuses them. push (fast-forward only) is the phone's. */
export const MAC_ONLY_GIT: ReadonlySet<GitOp> = new Set<GitOp>(['sync', 'commit-push', 'pr', 'ship', 'discard', 'delete-branch', 'merge-back', 'merge-all'])
/** sync: the one sync button (Publish branch, Pull N, Push N or Fetch). github: the repo's page, from the branch's remote (origin by default). pr: the branch's open PR when gh can tell. busy: the op running now; result: the last one's outcome. */
export type RepoView = {
  /** A Claude worktree (own-worktree chat): Merge back puts its work in the branch the main checkout is on. */
  worktree?: boolean
  /** For a worktree: the branch the main checkout is on, and whether it merges on its own (Ship's switch). */
  into?: string; auto?: boolean
  sessionId: string; name: string; branch?: string; upstream?: string; ahead: number; behind: number; files: RepoFile[]; branches: string[]
  sync: { kind: 'publish' | 'pull' | 'push' | 'fetch'; label: string }
  log: { hash: string; subject: string; when: string }[]; stashes: number; github?: string
  pr?: { url: string; state: string; title: string; number?: number; additions?: number; deletions?: number; base?: string }
  /** Against the PR's base (or origin/HEAD's): behind, conflicted file count, up to 5 conflicts with one line pair each (undefined: git < 2.38), the last 8 commits on both sides. by and author: You for my own. */
  merge?: { base: string; behind: number; files: number; conflicts?: { path: string; by: string; line?: number; ours?: string; theirs?: string }[]; commits: { hash: string; author: string; at: number }[] }
  /** The branch's newest GitHub Actions run, when gh can tell. step: a failed job's first failed step. */
  ci?: CiRun
  /** The card's lanes: HEAD against the merge base's ref (a branch) or its upstream (main), newest first; fork: where they split. */
  lanes?: { against: string; fork?: LaneCommit; commits: LaneCommit[] }
  /** Line counts of the commits not on the upstream yet (or the base, before the first push). */
  outgoing?: { path: string; added: number; removed: number }[]
  /** What Commit & push takes (paths, sent back with the confirm) and leaves out (agent files; a rename as old → new). */
  ship?: { files: string[]; kept: string[] }
  /** Every finished chat's message since the last commit, merged, plus a bullet for files none named. last: the newest one's summary; at: when it last grew. */
  pending?: { text: string; last: string; at: number }
  busy?: GitOp | 'harden'; result?: { text: string; ok: boolean; at: number }; at: number
  /** Write commit message (hub-draft-commit), per repo: busy while Haiku writes, then the text or an error. box: what Source Control got (typed: Kenneth's text kept; missing: no box in this window). */
  draft?: { busy?: boolean; text?: string; error?: string; box?: 'filled' | 'typed' | 'missing'; at: number }
}
export type LaneCommit = { hash: string; author: string; at: number; subject?: string; side?: 'head' | 'base' | 'fork' }
export type CiRun = { id: number; workflow: string; status: string; conclusion?: string; url: string; sha: string; at: number; jobs: { name: string; status: string; conclusion?: string; step?: string }[] }
export type NoteSearch = { q: string; hits: { sessionId: string; snippet: string }[] }

/** The settings behind the Keep working card. A full chat always continues in a fresh chat: onFull stays for usage mods that still ask. */
export type KeepWorking = { autoCompact: boolean; window?: number; autoContinue: boolean; onFull: 'fresh'; freshBranch: boolean }
export type KeepSetting = 'autoCompactEnabled' | 'autoCompactWindow' | 'autoContinueAtUsageLimit'
/** The Claude Code settings a switch may write; the whitelist and its values are in controls.ts. */
export type SettingKey = KeepSetting | 'remoteControlAtStartup' | 'agentPushNotifEnabled' | 'inputNeededNotifEnabled' | 'model' | 'effortLevel' | 'tui' | 'statusLine'
export type ClaudeControls = { model?: 'fable' | 'opus' | 'sonnet' | 'haiku'; effortLevel?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'; tui: 'default' | 'fullscreen'; statusLine: boolean; push: boolean; needInput: boolean }
/** Switchboard's own switches, kept in VS Code's globalState. idleMinutes null: never hide. */
export type SwitchboardControls = { hooks: boolean; statusBar: boolean; idleMinutes: number | null; brief: boolean; askBrain: boolean; syncRules: boolean; accessNote: boolean; autoStart: boolean; autoFix: boolean; name: string; /** Stop a chat's dev servers and test browsers when it ends; off only when false. */ stopServers?: boolean; askClaude?: boolean; /** Claude chat permissions: bypass (default), ask or auto; unset reads askClaude. */ claudeMode?: 'bypass' | 'ask' | 'auto'; askCodex?: boolean; keepApp?: boolean; hardenBuild?: boolean; pauseAt?: number | null; learn?: boolean; /** Every window as a native macOS tab (window.nativeTabs); takes a quit and reopen. */ oneWindow?: boolean; /** Agent browsers in a window; off runs Playwright MCP headless. */ showBrowsers?: boolean; /** VS Code toasts for agent notices; off uses the status bar. Read only when notices is unset. */ toasts?: boolean; /** Where agent notices go: the Mac or Windows notification center (unset), a VS Code pop-up, or the status bar. */ notices?: 'system' | 'toast' | 'status'; /** Where VS Code toasts show (workbench.notifications.position); unset is top right. */ noticeSpot?: 'top-right' | 'bottom-left' | 'bottom-right'; /** Phone mode: questions, needs-you, done and usage pauses ring Kenneth through the phone skill. */ phone?: boolean; /** Roles move up a model when a cheap one misses; off only when false. */ smartModelSwitch?: boolean; /** Route new engineer and code review jobs to Codex when it has room. */ codexFirst?: boolean; /** Advanced mode (stage folders) per project path, set with hub-advanced; off unless true. */ advancedMode?: Record<string, boolean>; /** Model for new and resumed Codex chats (-m); unset leaves it to config.toml. */ codexModel?: string; /** Reasoning effort for Codex chats (-c model_reasoning_effort=); unset leaves it to config.toml. */ codexEffort?: string; /** Coder view: every page and control; off is the Simple view, unset too, and unset also shows the first-run choice. Global, saved in company.json by hub-coder-view. */ coderView?: boolean; /** Auto pick per task: new chats and Start runs get their model and effort picked from the task; off only when false. */ autoPick?: boolean; /** Merge every idle worktree into main after 15 minutes with no new chat in the repo; off only when false. */ autoMerge?: boolean; /** New code chats and To-do runs start in their own worktree, even in an idle project; off only when false. */ codeWorktrees?: boolean }
export type SwitchboardKey = keyof SwitchboardControls
/** rulesNote: what the last rules and roles sync did, one line. */
export type Controls = { claude: ClaudeControls; switchboard: SwitchboardControls; statusLineReady: boolean; rulesNote?: string }
/** The brain's view for hub_ask: live chats by project, and what it suggests. */
export type BoardChat = { sessionId: string; label?: string; prompt?: string; file?: string; percent?: number; at: number }
export type BoardProject = { project: string; cwd: string; chats: BoardChat[] }
export type Suggestion = { id: string; kind: 'clash' | 'full' | 'task' | 'server'; text: string; sessions: string[]; folder?: string; task?: string }
export type Project = { name: string; path: string; kind: 'repo' | 'project'; isOpen: boolean }
/** One stage of an Advanced mode run, from <project>/.switchboard/stages/<run>/stages.json. */
export type Stage = { n: number; name: string; role: string; status: 'todo' | 'doing' | 'done' | 'redo' }
/** A stage run: the newest per chat named in its folder (sessionId), or the project's newest when none is named. at: stages.json mtime. */
export type StageRun = { run: string; sessionId?: string; at: number; stages: Stage[] }
/** A role smart model switch moved to another model, from model-learn.json. resolvedBy: who settled it. */
export type Escalation = { project: string; role: string; files: string[]; from: string; to: string; reason: string; at: number; resolvedBy?: string }
/** One running chat, and why it may be missing from the Claude app. fill: a Codex chat's context, 0..1. chain: the handoff chain it is in. takes: the message box reaches it. */
export type ChatRow = { pid: number; sessionId: string; name?: string; cwd: string; status?: string; /** When Claude Code last changed status (busy, waiting, idle, shell), and what a waiting one waits for. */ statusAt?: number; waitingFor?: string; version?: string; kind?: string; updatedAt?: number; bridgeId?: string; link: string; live: boolean; why: string[]; ai?: AiId; fill?: number; chain?: string; takes?: boolean; /** The repo's name (projectName), so a chat in switchboard/extension reads switchboard. */ project?: string; /** Chats started from one split message share it. */ group?: string; /** Goal budget card: ms since the chat started, its cost so far (usage feed) and its Run indefinitely limits. */ elapsedMs?: number; costUsd?: number; budget?: IndefiniteBudget; checkBack?: CheckBack; /** Runs in a dev container: pid 0 (its own pid means nothing on the Mac), live from Docker, and no mods in there, so messages are typed into its terminal. */ container?: true }

/** A terminal in this window: who opened it, the chat in it and how that chat is doing. id: per window, until reload. */
export type TerminalRow = { id: number; owner: 'switchboard' | 'user'; name: string; state: 'running' | 'ended' | 'exited'; sessionId?: string; chat?: string }
/** The AIs the hub knows; a new one is one member here and one entry in ais.ts. */
export type AiId = 'claude' | 'codex' | 'hermes'
/** What New chat can pick: an AI, or auto, which the extension resolves to claude or codex. */
export type NewChatAi = AiId | 'auto'
/** The AI Auto picked and why, shown as "Auto: Codex, because <reason>". */
export type AutoPick = { ai: 'claude' | 'codex'; reason: string }
export type AiStatus = { id: AiId; name: string; installed: boolean; detail?: string; /** From the AI's status command; absent when unknown. */ signedIn?: boolean; chats: number }
/** A starred chat and what the hub knows of it, read from disk with no model call. */
export type StarredChat = { sessionId: string; ai: AiId; name: string; cwd: string; starredAt: number; live: boolean; chain?: string; digest: { lastPrompt?: string; note?: string; resume: string; updatedAt?: number } }
/** A chat closed by a handoff, shown under History. origin: its chain's first chat's name; version: 1 for the origin. note: the handoff note it wrote. */
export type ArchivedChat = { sessionId: string; ai: AiId; name: string; origin: string; version: number; cwd: string; project: string; note?: string; startedAt?: number; archivedAt: number; /** Its cost when archived (usage feed). */ costUsd?: number; /** It ended on its own; it leaves the archive once it runs again. */ ended?: true; /** Kenneth approved it done. */ approvedAt?: number; /** Times he answered Send back to the closing question; 0 when never, absent on rows from before it was recorded. */ sentBack?: number; /** The last Send back. */ sentBackAt?: number; commit?: string; doneCheck?: DoneCheck }
/** What the done-check mod found: verified, or what is missing. */
export type DoneCheck = { verified: boolean; missing?: string[] }
/** Where a chat is: working, done (finished with a commit message or every task; almost done while a request is not covered), needs you (a question), idle (stopped, work open). */
export type ChatState = 'working' | 'done' | 'needs-you' | 'idle'
/** One subagent run, keyed by its agent id (the role when a payload has none). at: its last call, or when it ended once done. */
export type RoleStep = { id: string; role: string; state: 'active' | 'done'; startedAt: number; at?: number }
export type TaskRow = { id: string; subject: string; status: 'pending' | 'in_progress' | 'completed'; role?: string; /** When it went in progress, and when it completed; drive the time estimate. */ startedAt?: number; doneAt?: number }
/** One chat's progress, built from its hook events with no model call. */
/** A background Bash or Monitor, keyed by its tool_use_id; label is its description. */
/** task: the shell's backgroundTaskId, the name TaskStop uses. */
/** command: the Bash command, cut short, to find its shell; agent: the subagent that started it. */
export type BgJob = { id: string; label?: string; task?: string; command?: string; agent?: string; startedAt: number }
/** One tool call for the picture: role is "lead" for the main chat, else the subagent type. target: the file, pattern or command it touched, cut short. */
export type ToolCall = { tool: string; target?: string; role: string; at: number }
/** Work handed to another AI: Codex subagents, Jev, Perplexity and Gemini calls. One per ai (per role for Codex); label is the latest call, never its prompt. since: that call's start. */
/** claude: a `claude -p` a lead ran from its shell, as a Codex chat does to hand a role to Claude. */
export type HelperAi = 'codex' | 'claude' | 'jev' | 'perplexity' | 'gemini'
export type Helper = { ai: HelperAi; role?: string; label: string; state: 'working' | 'done' | 'idle'; since: number; last: number; count: number }
export type ChatProgress = { sessionId: string; cwd: string; state: ChatState; roles: RoleStep[]; tasks: TaskRow[]; question?: string; commit?: string; /** Commit message (<repo folder>) blocks from the same message, for other repos' boxes. */ commits?: Record<string, string>; startedAt: number; at: number; /** The newest tool calls, oldest first, at most 200. */ tools?: ToolCall[]; /** Subagents still running, by agent id (or role); they outlive the chat's Stop. */ running?: string[]; /** Agent ids that stopped lately and when, kept past the role trim so a late hook from one is ignored. */ ended?: Record<string, number>; /** The lead's turn ended while some still ran. */ waiting?: boolean; /** Background shells and monitors the lead started, until their task-notification. */ jobs?: BgJob[]; /** Background shells subagents started, until that subagent's transcript says they ended. */ subJobs?: BgJob[]; /** The lead's last turn ended with a commit block or every task done; Done once nothing runs. */ finishing?: true; /** When it last reached Done. */ finishedAt?: number; /** The prompt the terminal shows, while it waits. */ ask?: Ask; /** Every prompt waiting, oldest (ask) first. */ asks?: Ask[]; /** The lead's last turn died on an API error (StopFailure), until it makes real progress. */ limited?: { at: number; error: string }; /** The standup in the lead's last message; its Left items go to the to-do. */ report?: Report; /** Kenneth's own prompts in this chat, newest last, at most 8. */ asked?: string[]; /** Jev's score per asked item (0 to 1, null: no answer) for whether Done covers it. */ covered?: Array<number | null>; /** The newest test run any role made, from its Bash hook. */ tests?: TestRun; /** Other AIs this chat handed work to. */ helpers?: Helper[]; /** The last compaction (PostCompact) and what triggered it. */ compacted?: { at: number; trigger: string }; /** The newest call auto mode denied (PermissionDenied). */ denied?: { at: number; tool: string; target?: string; reason?: string }; /** Rule files loaded into the chat (InstructionsLoaded), last two path parts each, at most 20. */ rules?: string[] }
/** One INDEX.md line: the file name only, its time, size as written ("1.2 KB") and the chat label. */
export type UploadRow = { name: string; at: number; size: string; chat: string }
/** last: the newest few, newest first. */
export type Uploads = Record<string, { count: number; last: UploadRow[] }>
/** A test command's outcome. failed, total, first: parsed from its output when it says; tail: its last 8 lines. */
export type TestRun = { command: string; ok: boolean; at: number; failed?: number; total?: number; first?: string; tail?: string[] }
/** A standup's Done and Left items, cut short. */
export type Report = { done: string[]; left: string[]; /** For you: steps only the user can do by hand; absent when none. */ you?: string[] }
/** A chat Jarvis would start once Kenneth taps Confirm. */
export type JarvisStart = { folder: string; project: string; goal: string }
export type JarvisReply = { q: string; at: number; busy?: true; answer?: string; start?: JarvisStart }
/** Future work. chat: in progress there; from: the chat that left or added it; before: the id of the item it must precede. */
/** Why a chat left something: blocked, needs Kenneth (you), out of scope, later, or a request Jev found not covered (missed). */
export type TodoWhy = 'blocked' | 'you' | 'scope' | 'later' | 'missed'
/** from: the chat that added it; name: that chat's name when it was added; why: set on what a finished chat left. */
export type TodoItem = { id: string; text: string; at: number; chat?: string; /** The machine that started chat. */ host?: string; from?: string; before?: string; name?: string; why?: TodoWhy; /** To-do N: the run that started it. */ run?: number; /** Started by the autopilot, not Start. */ auto?: true; /** Its chat died before finishing (clearGone); auto-start skips it until Start again. */ stopped?: true; /** Put back after a shipped auto-tick; never auto-ticked again. */ kept?: true; /** Needs Kenneth's OK: auto-start skips it, Start runs it. false once he gave it (unset means an older device dropped the field). */ needsOk?: boolean; /** Not before this time (ms); auto-start skips it until then. 0 once cleared. */ notBefore?: number; /** A title of at most 60 characters, made when the item came in; none on older items. */ short?: string }
/** How a project's lists sync: synced (private repo or opted in), local only (why), or failing (the last error). canSync: a git repo with an origin. remote: the unreadable remote list's commit, which Replace leases on. */
export type TodoSync = { state: 'synced' | 'local' | 'failing'; why?: string; canSync?: boolean; optIn?: boolean; remote?: string }
/** A finished item (by: the chat that finished it, none when the user did), kept so the user can put it back. */
export type TickedItem = Pick<TodoItem, 'id' | 'text' | 'at' | 'from' | 'before' | 'name' | 'why' | 'run' | 'auto' | 'short'> & { by?: string; /** Ticked because this commit (sha) or CHANGELOG line (sha CHANGELOG) already says it; Put back undoes it. */ shipped?: { sha: string; subject: string } }
export type TodoList = { todo: TodoItem[]; sync?: TodoSync; /** Newest first, at most 10. */ ticked?: TickedItem[]; /** Left by finished chats, waiting for Accept or Dismiss; an older extension sends none. */ suggested?: TodoItem[]; /** How many the last prune cleared (repeats, stale suggestions); their text is gone. */ cleared?: number; pilot?: TodoPilot; /** The last run number. */ seq?: number; /** The first run number of the current chain; none once the queue went empty. */ streak?: number; /** What auto-start runs next (todo.ts upcoming); an older extension sends none. */ plan?: { runs: Array<{ n: number; ids: string[] }>; held: Array<{ id: string; why: 'blocked' | 'you' | 'stopped' | 'ok' | 'date' }>; /** Why auto-start holds the next item (todo.ts holdReason); absent when it does not. */ hold?: { kind: 'waiting' | 'running' | 'limit' | 'sync' | 'paused' | 'memory'; text: string } } }
/** The project's autopilot: on unset follows the global Auto-start; paused holds new starts, running chats go on. The newest at wins a merge. */
export type TodoPilot = { on?: boolean; paused?: boolean; at: number }
/** todo.json on refs/switchboard/todo; removed: tombstones by id (`<id>.back` for a ticked item put back), kept so a merge never brings one back. */
export type TodoDoc = TodoList & { version: 1; removed: Record<string, number>; /** The last drag in the panel; the newer one wins a merge. */ order?: { ids: string[]; at: number } }
/** One AskUserQuestion question; options in the terminal's order. */
export type AskQuestion = { header?: string; question: string; options: string[]; /** Option descriptions, same order; empty string for none. */ details?: string[]; multiSelect?: boolean; /** The option that is Smart select's pick, with how often its kind of pick held up (learned). */ smart?: { option: number; rate?: number; n?: number } }
/** A prompt in the chat's terminal and its choices in order. id: a stale answer is refused. preview: what the tool will run, cut short. */
export type Ask = { id: string; kind: 'permission' | 'question'; tool: string; preview?: string; options: string[]; questions?: AskQuestion[]; /** Raised by a subagent, so the lead's own calls leave it. */ sub?: true; /** From the switchboard ask tool: answered through the hub, not keystrokes. */ via?: 'hub' }
/** Typed text for a question's Other, with a multiSelect question's ticked options. */
export type OtherPick = { picks?: number[]; other: string }
/** An answer: an option index per question, several for a multiSelect one, or Other text. */
export type Choice = Array<number | number[] | OtherPick>
/** One Smart select pick: verdict useful or not once the chat finished, pending before. */
export type SmartPickRow = { at: number; session: string; title?: string; kind: string; task: string; pick: string; why: string; final?: string; verdict: 'useful' | 'not' | 'pending' }
export type SmartState = { picks: SmartPickRow[]; rates: Array<{ kind: string; task: string; pick: string; n: number; useful: number }> }
/** A `claude remote-control` server for a folder, so the Claude app can start chats there. */
export type RcServer = { folder: string; name: string; on: boolean }

export type InboxDraft = { kind: 'prompt'; text: string } | { kind: 'rc' } | { kind: 'compact' } | { kind: 'close' } | { kind: 'handoff' }
export type InboxItem = InboxDraft & { id: string }

// code: typed with an address on a device that has no cookie yet. The *Name links use this Mac's mDNS or MagicDNS name, which outlast an IP change.
export type PhoneUrls = { wifi?: string; tailscale?: string; wifiName?: string; tailscaleName?: string; code?: string; problem?: string }
/** A device on the sign-in page that asked the Mac to let it in. */
export type DeviceAsk = { id: string; ip: string; ua: string; network: 'Wi-Fi' | 'Tailscale' }

/** A chat's few-sentence summary; at is when it was written. */
export type ChatSummary = { busy?: boolean; text?: string; error?: string; at?: number }
