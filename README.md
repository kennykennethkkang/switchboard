<!-- Switchboard: a VS Code hub to start, watch and talk to Claude Code and Codex chats, built on Agent Flow's live agent visualization. -->
# Switchboard

Switchboard is a VS Code hub for running and watching Claude Code and Codex chats across all your code projects. You start chats from one place, give each a role (lead, researcher, engineer and so on) so work can be delegated, and see what every chat is doing without switching windows.

## Credit

Switchboard is based on [Agent Flow](https://github.com/patoles/agent-flow) by Simon Patole, used under the Apache License 2.0. Agent Flow is a trademark of Simon Patole. Switchboard is not affiliated with or endorsed by the Agent Flow project. See [NOTICE](NOTICE) and [TRADEMARK.md](TRADEMARK.md).

## What it does

- **Always one click away.** An Activity Bar icon opens a sidebar view labeled Switchboard, with an Open in editor button. There is also a status bar button, and `Cmd+Option+A` opens it from anywhere, including a focused terminal.
- **New chat and roles.** Pick a project (or make a new GitHub repo or clone one right there), pick a role (lead, researcher, engineer, qa, designer, ops, growth), and start a Claude Code or Codex chat. Both runtimes are supported.
- **Live chat map.** Every running chat shows as a bubble with its role and its tool calls as they happen.
- **Usage.** Every token Claude and Codex used over 30 days: new input, cache writes, cache rereads and output, with the cost at API list prices by day, model, project, role and chat, how much of each plan is left, and the spend limits of paid tools. Read from the transcripts on this machine, each reply counted once.
- **Codex first.** While Codex has room and Claude has used more of its week, the usage-meter mod sends engineer and code review starts to engineer-codex and qa-codex; a `Claude only:` line in the brief keeps one on Claude. Settings, Models turns it off.
- **Today card.** What ran today, at a glance.
- **Changes panel.** Files a chat changed, with inline diffs and an Open in VS Code diff button. Symlinks and paths outside the project are never shown. On a chat's diff (the Changes fold on a finished chat), tap a line, write a note and Send to chat: the chat gets "Review note on file:line" with the line's text, so review feedback goes straight back to the agent.
- **Research.** Research shows live: the question, each search, every page read and by which subagent, and the answer as it forms. A project chat's research sits on that chat's page under Chats, and its finished answer is saved to the project's Claude memory (a `research-*` note) so later chats there recall it. Research that belongs to no project (the Research switch in New chat, the board's Research desk, a moved research offer) runs in its own Research window on `~/Documents/Research`, a tab beside the project windows, and its panel opens there as a tab once the web work starts; closed, it comes back for that chat only after 30 minutes. Every finished report is also saved under `~/.claude/switchboard/research/` (a folder per project, or `general`), and the Research page in the left rail lists them newest first, with delete moving a report to `.trash` and folders to file them in: drag a report onto a folder or use its Move menu, or let Smart organize sort the unfiled ones (one Haiku call, with Undo; a switch files new reports by itself). Ask more on a report starts a research chat and adds what it finds to the same file, citations renumbered into its one source list.
- **Workbench.** Research that changes things. A report can end with an Actions list (Mac settings and apps, developer setup, the Claude and Switchboard kit, other repos and devices, or its own project); each has Apply, which starts a chat that checks the action still fits this device, makes it and proves it. The Workbench switch in New chat, the Workbench page's box and the map's Research island start one with no report. Chats run in `~/Documents/Research/Workbench` with the `adjust` skill: changes with an undo run at once, anything that cannot be undone asks first, and root commands are handed over as steps. Every change is logged under `~/.claude/switchboard/adjustments/` with backups (0600), its check and its undo, and the Workbench page runs Undo after showing exactly what it will do. Undo stops when a file changed since, unless you say so, and then keeps the newer copy.
- **Quick switcher.** `Cmd+K` jumps to any chat.
- **Full chats continue.** When a chat fills up, work continues in a new chat named "<name> v2", then "v3". The old one closes when idle and moves to History.
- **History.** Chains of versions, search over handoff notes, and resume.
- **Remote Control.** Servers per repo, and at startup.
- **Settings gear** in the app, and a link to the browser version.
- **Answer terminal prompts.** Permission prompts and questions from a chat show in Switchboard and can be answered there.
- **Phone access.** Open Switchboard on your phone over Wi-Fi or Tailscale by scanning a QR code, or email yourself the link: type your address in the Phone popup (kept in that panel only) and Send link opens a draft in your mail app with the link and the steps (install Tailscale, sign in, open it).
- **Phone alerts.** Web Push to the app on your phone's home screen when a chat asks to be approved or is done, and before an AWS sign-in ends. Turn it on in the gear there.
- **Screen tab.** In the app's chat view, a chat's terminal screen as it looks on the Mac, redrawn once a second with secrets masked. Drawn in color at full size on a computer, scrolling inside its box when wider than the window; on a phone it fits the width, with text no smaller than 11px. Copy takes it as plain text. Typing into it (text, Esc, Enter, arrows, Tab, Ctrl-C) stays off until `switchboard.screenTyping` is turned on in this Mac's user settings, and then works only while claude or codex has the terminal. The phone cannot switch it on. Needs VS Code's shell integration; a chat started before the window loaded, or run by Codex, has no screen.
- **Bash runs without prompts.** The Switchboard hook allows Bash calls; deny rules in your settings still apply.
- **One hook process per event.** The extension hook forwards to matching Switchboard windows and standalone app instances, and removes the app's duplicate entries. The app keeps its own hook when the extension is not installed.
- **Idle chats give their memory back.** A chat idle for three hours with nothing running, asked or owed gets one VS Code notice with the memory it holds: Suspend ends it and keeps it under History to resume, Close approves it, Not now waits another three hours.
- **Tabs close themselves.** On macOS, each Chrome tab a chat opens (through `$BROWSER` or Claude in Chrome) is recorded and closed once the chat finishes, ends, or gets the answer to the question that named the page. A tab stays while it shows with Chrome in front, while a question or a For you step needs it, or once you take it to another site (a Claude in Chrome tab goes whatever site it is on). A page that starts Chrome is not recorded. Turning off **Stop dev servers and close tabs when a chat ends** in Settings stops it.
- **Status from every window.** Chats in every open VS Code window show in one list.
- **Sync across computers.** The account menu (rail foot or page header) or Settings, Sync: sign in with GitHub (VS Code's own sign-in) and Switchboard keeps Claude memory notes, the vault (`~/Documents/vault`), Jev presets and its own settings the same on every computer through a private `switchboard-sync` repo in your account. It syncs at start, every 15 minutes and on Sync now, from one window. Memory is matched by each project's git remote, so a Mac and a Windows path for the same repo share notes. Both sides edited: notes are merged line by line, settings files take the other computer's copy and keep yours in `~/.claude/switchboard/backups/sync/`. Transcripts, caches and keys never sync. Nothing is hosted by Switchboard.
- **Updates itself.** A push to main with a new version in `extension/package.json` runs the tests on Linux, macOS and Windows (Windows does not block yet) and publishes a GitHub release with the VSIX and its SHA-256. Each computer checks once a minute after start and every 6 hours, installs a newer release after checking the hash, and asks before reloading. It also pulls claude-mods when that repo has no local edits, then reinstalls the rules and role files if they changed. Off with `agentVisualizer.autoUpdate`; Switchboard: Check for updates runs it by hand, and so does Check for updates in the account menu or Settings, Installed, Updates, which show the installed version, the update state and Reload once a newer release is in.
- **Keyboard and help.** `?` lists the shortcuts, `g` then a letter jumps to a page, `n` starts a new chat, ⌘K finds chats and commands (Check for updates, Sign in, Commit, Push, Open diff), and a skip link jumps past the rail. Help in the rail or the account menu explains the four steps of a chat. Simple view keeps plain words; Coder view shows git commands, session ids, cwd, model and cost.
- **Windows.** Runs on native Windows 11 (Git for Windows recommended, so hooks run in Git Bash). claude, codex, npm and pnpm shims start through `cmd.exe`, and the browser app and process checks use netstat and PowerShell where macOS uses lsof and ps. Mac-only extras (Keep awake, closing Chrome tabs) stay off there. Setup on a new computer: see the claude-mods README.
- **Smart switch.** A chat typed into the wrong project's window gets its first prompt checked by one quick Haiku call. When it is clearly about another listed project, it starts over in that project's window (opened if needed) and the wrong chat closes, with a notice naming where it went. It only moves from one listed project to another, and only a chat in a VS Code terminal. Any doubt, error, slow answer or pasted image keeps it where it is. Chats Switchboard started are never moved.
- **Split asks.** On Start, a New chat message that looks like several unrelated asks gets one quick model call to split it. A preview shows one editable card per ask, with Start all (each its own chat, tied as one group) or Start as one. Nothing starts without a click, and a message with secrets or one ask starts as before. Tested first: on 28 days of chats, routing new asks into a shared lead matched work in the same files only a handful of times, while about 12% of opening messages held separate asks.
- **Related chat and Wait on.** New chat shows "Related: <chat>" with Send there when a live chat in the same project looks like the same work, and a Wait on row of live-chat chips so the new chat starts after the ones picked. The map tags each waiting yard "Starts after X" and ties split siblings with a cord and "Split with X"; the Code view lists the group next to a part's chats.
- **Smart select.** A new Claude chat starts with every plugin and skill on; its first message goes to Jev in one call (about a second, a fraction of a cent), and what the task clearly does not need goes off for that chat, with the keyword rules as backup when Jev is slow or down. Per-tool precedence (Settings, Installed: Always on, Auto, Never; saved in `~/.claude/switchboard/tool-precedence.json`) overrides Jev, and the chat's note lists what is off so it can call `tool_on`. Every choice a chat makes in the terminal (ponytail level, model, effort, the role and model for each subagent, and the suggested answer on a question) is a smart pick with a one-line reason. Each pick is logged with how the chat ended (approved, sent back, escalated, done-check) and a pick that keeps doing better for a kind of task takes over, never below a role's floor. The Live page shows the current picks per task kind with how often they held, and question pop-ups mark the smart option with its record.
- **Smart model switch.** Each role runs on the model in its agent file. When one role redesigns the same component three rounds in a row and it still fails, it moves up a model (Haiku, Sonnet, Opus, Fable) for that component, logs what it learned per project in a memory note, and drops back after 5 clean runs. Debugging never counts. Toggle and Reset in Settings > Models.
- **Advanced mode.** Per project. Big tasks run as numbered stage folders (`.switchboard/stages/`, kept out of git), each with its own context file and output folder, in the style of Interpretable Context Methodology. The chat card shows the current stage and opens into the list, with Looks good and Redo between stages.
- **Loop picker.** One control on each chat and in New chat with four kinds of loop. **Turn**: does the task, then waits. **Goal** (Run indefinitely): the chat asks every question it has once, then keeps building and checking in rounds until it reports `Run indefinitely: done`; an optional "Done when" goes to the goal skill, which writes the goal file and its Check. **Timer**: a prompt every 10 min, 30 min, 1 h, 3 h or daily, up to 12 times. **Proactive**: starts a Claude chat that makes a cloud routine with `/schedule`, which runs on a schedule or a GitHub event with this Mac off; See routines opens claude.ai/code/routines. Goal needs the usage-meter mod for Claude chats; New chat offers loops to Claude chats, the chat page to Codex too. New chat starts on **Auto**, which picks the loop from the message (a schedule or GitHub event is Proactive, "check back" or "every 2 h" is Timer with that interval, "until" or "keep going" is Goal, else Turn) and shows its pick and why before Start. Smart select logs Auto's pick and any mode picked by hand over it, so once a mode has held up clearly better for a kind of task it becomes Auto's pick. Hovering or focusing a mode shows what it is for, when it stops and an example.
- **Budgets and gates.** A Goal loop can carry a time cap, a cost cap and a gate command (run in the project, 10 minute limit). The chat stops when the gate exits 0, and says "budget reached (not a success)" when a cap hits first. A failing gate's last 20 lines go into the next round. All off by default.
- **Goal budget card.** The chat card shows the goal, time since the start and cost so far, with a thin bar toward the nearer cap, and a "used $X over Yh" line when an indefinite run ends.
- **Timer.** An idle chat gets the Timer's prompt typed in at its interval, up to 12 times. With no prompt of its own it sends "Check back: look at progress on open work and continue or report." and only while tasks or background work are open.
- **Refine now and Undo.** Refine now sends the aar skill to a running chat. Before aar, self-improve or Learn edits a kit, rules, agent or memory file, the files are copied to `~/.claude/switchboard/snapshots/` (`kit/skills/aar/scripts/snapshot.mjs`); History lists them with Undo, and undoing snapshots the current state first. Each manifest can carry a one-line `reason` (Learn writes its run and gate verdict), and memory-fix writes `reasons.txt` beside its backups, so a bad rewrite can be traced.
- **Check health.** Settings, Check health tests the hook server, hub port, kit rules and agents against the bundled ones, each mod's installed version, the claude and codex CLIs and the MCP config. Fix safe ones reruns the existing install paths for what is fixable.
- **Daily trends.** The 6 pm summary and the Today card show yesterday's chats, approved and sent back (cost in the summary and on Usage), with an arrow against the day before and the same weekday last week, from the local History archive.
- **Saved pipelines.** Save as pipeline on a stages run keeps its `stages.json` and each `CONTEXT.md` (no outputs) in `~/.claude/switchboard/pipelines/`. A new chat in an Advanced project can pick one: the run folder is seeded with every stage on todo and the first prompt names it.
- **Auto pick per task.** New chat, To-do Start and every subagent get a model, effort (low to max), ultrathink and ultracode picked from the task: a capability score moves the role's model up or down, a thoroughness score sets the effort, and ultracode goes only to big multi-part lead tasks. xhigh, max, fable and ultracode are picked only while 5h usage is under 60%, otherwise one level lower, and the reason line says so. Any pick you make wins. Picks are logged to `~/.claude/switchboard/picks.jsonl`. Switch it off in Settings > Models.
- **Advisor.** New chat and To-do Start have an Advisor select (Fable, Opus, Sonnet) that starts Claude with `--advisor`, so the chat's model consults a stronger one at key moments ([advisor docs](https://code.claude.com/docs/en/advisor)). It lists only advisors ranked at or above the picked model, Auto never picks one, and a Fable advisor bills usage credits.
- **Effort and Ultracode on the chat.** The message row of a Claude chat has an Effort select (Default, low to max) and an Ultracode switch that stays on for that chat. An effort pick sends `/effort` to that chat only; the default for new chats is put back.
- **Simple and Coder view.** Simple is the default: Home, Chats, Plan and Settings with plain names. Home shows a five-step setup list above the ask box until setup is done, then the ask box first with Needs you, Working and Done today. Coder view (Settings, first row) adds Live, Ship, Map, the Screen tab, stages and every setting.
- **Research mode.** The Research switch in New chat runs a chat in `~/Documents/Research`, with its own memory and no aar, standup or Approve gate. A chat whose first message reads like research offers to move there. Any chat can search it with `hub_recall` scope `research`.
- **Stations track.** Each Working card on Now shows Research, Build, Gate, Review and Your call, with round chips when work was sent back, and a Verified badge only when a review ran after the last edit and the last gate passed.
- **To-do.** One page: Decide (Accept, Decline, Snooze), Running, a Queue per project and Waiting with the reason, with status chips that jump to each section, short titles, Move up and down on touch, and model and effort on Start.
- **Memory map.** A 3D map of memory notes, wiki pages and CLAUDE.md files. Each project is a glowing cluster holding its notes, with its name above; click the name or the cluster to open the project. One arc joins each pair of linked projects, thicker the more links it stands for. Notes that need a look carry a "!" badge. Pick a note to glide to it, dim the rest and read it, its links, what replaced it and what it disagrees with in a side panel. It only draws while something moves, so it stays light on phones. The Notebook tab lists every note by project with a full reader. `?mem=3d` keeps the original 3D graph.
- **Memory recall.** `hub_recall` searches every memory note and wiki page by word rarity and answers the best three with the lines that match. A note with `status: unproven` ranks lower and says so; a project note over 90 days old says so too.
- **Light on phones.** The phone and browser app get only the hub state fields that changed each poll, and load the 3D, terminal and map code only when those pages open.
- **Same state on every page.** One rule decides whether a chat is working, waiting, stuck, needs you or done, and every page uses it. Only the window that runs a chat decides if it is stuck, so the VS Code panel, the browser and the phone agree.
- **Source check.** The Live page lists runs of [source-check](https://github.com/kennykennethkkang/source-check), each source with its band, score and reasons.
- **Auto AI pick.** New chat's Auto labels the task with a role through the project's Jev route preset (a word table when Jev is unsure or off): code roles go to Codex, the rest to Claude, and a notice says why.
- **Discuss.** A chat can ask the other AI (Claude or Codex) through the `discuss` tool: a few headless, read-only rounds in the chat's folder that end with what the two agreed and disagreed on.
- **Window colors.** Each VS Code window gets its own color, on its title bar, status bar and in Switchboard. The title bar color goes in the project's `.vscode/settings.json`; turn off `switchboard.colorTitleBar` to skip it.
- **Own worktree.** When a Claude chat starts in a project that already has a live chat, or its task reads as code work (fix, build, add, a UI change), New chat offers Own worktree, ticked; To-do runs with code items start in one too. Settings > Chats > Code chats in their own worktree turns the code-work rule off. The chat runs in `<repo>/.claude/worktrees/<name>` on branch `worktree-<name>` (`claude --worktree`), shows under its project with a Worktree, not merged line on its card, and a band in the open chat folds its work, committed or not, into the branch the main checkout is on as uncommitted changes after the repo's checks pass, then removes the worktree. If you switched branches since the worktree started, only its own work moves over, not the old branch's commits. It waits while the chat runs, keeps a worktree that holds a nested git repo, and never commits or pushes. Ship merges worktrees too, see below.
- **In a container.** New chat's In a container runs a Claude chat inside the repo's devcontainer through Docker (`.devcontainer/devcontainer.json`, else a Node 22 config Switchboard keeps in `~/.claude/switchboard/container/`, never in the repo), with Claude Code added as a devcontainer feature. Each chat folder gets its own container. The repo is mounted at its Mac path and only that chat's transcript folder is shared, so the chat shows on the board as usual; the chat runs with permissions bypassed and no host hooks or plugins, so the container is the guard. The first container chat asks for /login once; the login stays in `~/.claude/switchboard/container/` for every later one. A repo config that sets `initializeCommand` (it runs on the Mac), `runArgs`, `privileged`, `capAdd`, `securityOpt`, `mounts`, `workspaceMount`, `dockerComposeFile` or ports is skipped for the default one, with a notice. The chat folder must be in a git repo, not the home folder. Inside, `.git/hooks` and `.git/config` are copies, so a hook or setting written there never runs on the Mac, and `git config` writes fail; submodules' own hooks are not copied. It needs Docker running (Colima, OrbStack or Docker Desktop) and starts the [devcontainer CLI](https://github.com/devcontainers/cli) with npx.
- **Ship.** Lists every repo with uncommitted or unpushed work and each worktree under it, with or without a chat; pick one to see its changes, commit, push, open a PR or merge the worktree into the branch you are on. Merge all folds every worktree without a running chat, running the repo's typecheck and test scripts after each one and undoing any that break them. A worktree whose work clashes with edits in the main checkout is merged three-way, file by file, from where it started: it lands only when no file has both sides changing the same lines, and otherwise stays with those files named. With Auto merge on (the default, a switch per repo and one for all in Settings), a worktree merges about 2 minutes after its chat ends, and one missed by that is tried again after 15 minutes with no new chat in the repo.
- **Claude chat permissions.** Settings picks Bypass (default), Ask, or Auto, Claude Code's own classifier mode: no prompts, but a classifier blocks risky actions that go beyond what the chat was asked to do. Questions to you still ask in every mode.
- **More chat events.** Cards note when a chat's context was compacted, when a tool call was denied and which rule files loaded, from the PostCompact, PermissionDenied and InstructionsLoaded hooks; TaskCompleted ticks the task list.

## What's included

- **Built-in tools and MCP servers.** Smart select also decides Claude Code's own heavy tools (Artifact, Workflow, ScheduleWakeup, ReportFindings, SendFeedback) and the user's MCP servers and claude.ai connectors. A built-in starts off and goes on when Jev is at least 70% sure the first message needs it or the message says so; a server stays on unless Jev is sure it does not (under 30%); scrapling starts off like a built-in (about 70 MB). With all of them off a chat starts about 21k tokens lighter (measured 2026-11-24, 64.1k to 43.0k). A chat that needs one later calls `tool_on`, which turns it on for the next start and gives a one-off headless call or a stand-in to use until then. Each has the same Always on, Auto and Never switch.
- **Always-on plugins.** superpowers, ponytail, code-review and context7 are on in every Claude chat Switchboard starts and cannot be turned off there. Flagged conflicts (only the second security-guidance, which would run the same hooks twice) start off and are never turned on by a pick; turn one on by hand or with tool_on.
- **Gated bundles.** marketing-skills, aws-core, bland, founder and playwright start off, so the skill listing keeps every other description and a chat does not hold a browser server (about 130 MB) it never uses; a goal or first message naming their field turns one on, and the chat is told how to turn them on with tool_on. Chats also get `skillListingBudgetFraction` 0.02.
- **Picked per chat.** A new Claude chat with a goal gets its own plugins, skills and design references, picked by one quick Haiku call from the goal, each one's description, and the project: folder name, the top of its CLAUDE.md or AGENTS.md, and its dependencies. If the pick fails or is slow, the chat gets your own settings and the fallback is logged. Change the set in the chat's Tools section; it applies when the chat is resumed.
- **Project skills.** Skills in the project's `.claude/skills` and `.agents/skills` are listed for that project's chats and can be turned off per chat like your own.
- **Design references.** `design-md/<brand>/`, `docs/design/*.md` and a root `DESIGN.md` in the project. A pick takes up to three for UI work, and the chat is told their paths.
- **Roles.** lead, researcher, engineer, qa, designer, ops and growth, from `extension/kit/agents`.
- **The kit.** On start, the extension writes the working rules (`extension/kit/rules.md`) to `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md`, and the role agents to `~/.claude/agents`. `extension/kit/bundle.json` holds the rules version, so newer rules are never overwritten by older ones. Rules that only apply to some files (`extension/kit/rules/*.md`, with `paths:` frontmatter) go to `~/.claude/rules/switchboard-<name>.md` and load only when a chat touches a matching file; Codex gets them inline in AGENTS.md. Files there without Switchboard's mark are never touched. A role file you edited is left alone, with the new copy saved beside it. Half a minute after a window starts, skill copies Set up made (Codex's in `~/.agents/skills`, and the bundled skills) are brought up to date; none is added, and one you edited stays.

## Built here

Written by Kenneth, from the repos as they stand:

- **Switchboard.** The VS Code extension (`extension/`), the web app (`web/`) and the phone app (`app/`), all showing the same chats.
- **Mods** in [claude-mods](https://github.com/kennykennethkkang/claude-mods): usage-meter, repo-rules (refuses an edit to a file another live Claude or Codex chat is writing, and a Workbench chat's edit, Claude or Codex, to a file with no logged change), paid-guard, bash-approve, chat-wait, done-check, cache-keeper, phone-mode, todo-band, tab-close, role-rows (every subagent drawn as a tree grouped by role, like the workflow progress tree), smart-select (picks the ponytail level per task and logs every terminal pick for Smart select) and side-pane (a pane beside the chat with what waits on you, running agents with their tasks, Claude and Codex usage, smart picks and the mods that are on; `/side`). The bands above the prompt fold to fit short terminals. Each is described in that README (phone-mode ships in the repo but is not in the install list there).
- **Kit skills:** animation-styles, memory-fix (applies the safe memory graph fixes with backups, lists the rest, including note pairs the Learn run's Jev contradiction probe flags), crowd-ab (synthetic user votes between two options, shown live on the Live page's Crowd A/B card; names a winner only when Jev in both option orders and the haiku panel agree), deep-research (answers with re-read citations, and an Actions list when a finding is worth a change), adjust (backs up, logs, checks and undoes each change made outside a project), gemini (images and video through Gemini), local-draft (a local Ollama model, gemma3:12b by default, writes first drafts and scaffolds; the script rejects a draft whose echoed file names or quotes do not match the sources, and the chat checks the rest before using it), harden (runs BLA to harden a build against AI reverse-engineering before a release), improve-system, model-bench (benchmarks role agents across Claude models with hidden-test tasks and recommends the cheapest model within 5 points of the best), goal (`/goal <spec>`: writes how each function must work and a Check command to `.switchboard/goals/<chat id>.md`; under Run indefinitely every round works toward it and a passing Check ends the run, under Run indefinitely, Claude and Codex chats alike, and handed over to a fresh chat on handoff), stages (runs a big task as numbered stage folders for Advanced mode), phone (calls Kenneth through Bland for a decision), self-improve (tunes a role or skill against held-out tasks, rerun enough times that 30 passes are reachable at 80%; it must pass 30 to count), toolchain (reads a repo's manifests and prints its test, lint, typecheck and build commands and the matching ecc-agents reviewer, so roles work in any language).
- **[source-check](https://github.com/kennykennethkkang/source-check).** A CLI and Claude Code plugin that scores how credible a web source is (retractions, domain priors, citation checks, cross-source agreement, author, domain history, comment threads) and walks N sites for a question, with an HTML report.
- **Role agents:** researcher, engineer, qa, designer, ops, growth, Explore, and the Codex hand-offs engineer-codex and qa-codex (Settings, Models picks their Codex model and effort; they only forward, so they load no CLAUDE.md or memory). qa reviews blind: the lead's brief carries the task, the checks and the diff, never the engineer's report.

## Coming next

In progress, not shipped yet:

- Sign-ins per project: AWS profiles with a default, rename, add, and a per-window override.
- Jev bubbles.

## Run it locally

```bash
pnpm install
pnpm dev
```

`pnpm dev` runs the event relay on port 3001 and the web app on port 3010 with live data (it sets `NEXT_PUBLIC_DEMO=0`). For sample data only, when working on the page, run `pnpm run dev:demo`, which serves it on 3010. Switchboard never uses port 3000.

Checks, from the repo root. Merge all runs the same two on each worktree:

```bash
pnpm typecheck   # tsc on extension src, extension tests and web
pnpm test        # scripts, app and web tests (pnpm run test:root), then the extension suite
```

There is no ESLint or formatter; `tsc` in strict mode is the lint.

The browser version with your real chats is the standalone app. VS Code's browser link finds it on any port:

```bash
pnpm build:app
node app/dist/app.js
```

Build and install the extension:

```bash
cd extension
pnpm run build:all && npx @vscode/vsce package --no-dependencies && code --install-extension switchboard-<version>.vsix --force
```

Switchboard runs in VS Code, VS Code Insiders, Cursor, Windsurf, Antigravity and VSCodium. Install the same .vsix with that editor's CLI:

```bash
code --install-extension switchboard-<version>.vsix --force            # VS Code
code-insiders --install-extension switchboard-<version>.vsix --force   # VS Code Insiders
cursor --install-extension switchboard-<version>.vsix --force          # Cursor
windsurf --install-extension switchboard-<version>.vsix --force        # Windsurf
antigravity --install-extension switchboard-<version>.vsix --force     # Antigravity
codium --install-extension switchboard-<version>.vsix --force          # VSCodium
```

It is not on Open VSX yet, so the forks install it from the .vsix only.

Then run **Developer: Reload Window** in the editor.

Requirements: Node 22+, pnpm 12, VS Code 1.85+ (or one of the editors above), and the Claude Code CLI and/or Codex CLI.

### Without an editor

Working in JetBrains, Zed or a plain terminal? Run the standalone app (`pnpm build:app`, then `node app/dist/app.js`). While no editor window with Switchboard is open, the app runs its own hub; once one opens, the app goes back to that window.

- Works: the chat list, projects, to-do lists, chat progress from hooks, and New chat for Claude and Codex. A new chat starts in a detached tmux session (`tmux attach` to see it) when tmux is installed, else in a Terminal.app window opened behind whatever has focus.
- Missing: terminal tabs, window colors, inline diffs, and every other command (tool picks, dev servers, handoffs, voice). Those answer "Open an editor window with Switchboard for that."

## Moving to another computer

The [claude-mods](../claude-mods) repo carries a kit that sets up plugins, skills, rules, role agents, settings and the Switchboard VSIX on a new machine. Clone it next to this repo and run `node kit/setup.mjs`. Its README has the step list. Keys and sign-ins never travel; memory notes, the vault, Jev presets and Switchboard's settings come over through Settings, Sync (sign in with GitHub on each computer).

## What changed from Agent Flow

- The Hub and Switchboard UI replaced the canvas visualizer.
- Roles for delegating work between chats.
- Versions and History for chats that fill up.
- Remote Control.
- A settings gear in the app.
- The web app runs on port 3010.

## Commands and settings

| Command | What it does |
|---------|--------------|
| `Switchboard: Open` | Open Switchboard |
| `Switchboard: Open to the Side` | Open in a side editor column |
| `Switchboard: Connect to Running Agent` | Connect to a running session by hand |
| `Switchboard: Configure Claude Code Hooks` | Set up hooks for live streaming |

Setting ids keep the upstream `agentVisualizer.` prefix:

| Setting | Default | Description |
|---------|---------|-------------|
| `agentVisualizer.runtime` | `"auto"` | `"auto"` (both), `"claude"` or `"codex"` |
| `agentVisualizer.devServerPort` | `0` | Development server port (0 = production mode) |
| `agentVisualizer.eventLogPath` | `""` | JSONL event log file to watch |
| `agentVisualizer.autoOpen` | `false` | Open when an agent session starts |
| `switchboard.screenTyping` | `false` | Let the Screen tab type into a chat's terminal from a phone or browser. Only this Mac's user settings turn it on |

For a non-default Codex install, set `CODEX_HOME`.

## Credits

Switchboard is a fork of [Agent Flow](https://github.com/patoles/agent-flow), the real-time visualization of Claude Code and Codex agent orchestration created by [Simon Patole](https://github.com/patoles) for [Antics](https://antics.gg). Its hook server and Codex rollout reader are still the base of Switchboard's live data. Used under the Apache License 2.0. Agent Flow is a trademark of Simon Patole; Switchboard is not affiliated with or endorsed by it.

Shipped with Switchboard:

- ECC subagents (kit/mods/ecc-agents) from [ECC](https://github.com/affaan-m/ECC) by Affaan Mustafa, MIT.
- Advanced mode follows Interpretable Context Methodology ([arXiv 2603.16021](https://arxiv.org/abs/2603.16021)) by Jake Van Clief and David McDermott, CC BY 4.0; reference repo [RinDig/Interpretable-Context-Methodology](https://github.com/RinDig/Interpretable-Context-Methodology), MIT. Idea only, no code copied.
- The Loop picker's four kinds (turn, goal, timer, proactive) follow Anthropic's [loop engineering post](https://claude.com/blog/getting-started-with-loops); Proactive uses Claude Code's own `/schedule` cloud routines. Ideas only.
- Budgets and gates, check-back, refine with undo, check health, daily trends and saved pipelines take their ideas from [prime-agent](https://github.com/PrimeIntellect-ai/prime-agent) by Prime Intellect, MIT. Ideas only, no code copied.
- DESIGN.md files (kit/design-md) from [awesome-design-md](https://github.com/VoltAgent/awesome-design-md) by VoltAgent, MIT.
- Silkscreen font by Jason Kottke ([kottke.org](https://kottke.org/plus/type/silkscreen)), SIL Open Font License 1.1.
- Hanken Grotesk font by [The Hanken Grotesk Project Authors](https://github.com/marcologous/hanken-grotesk), SIL Open Font License 1.1.
- Kit skills, each with its LICENSE: memory-fix, ideas from Mem0 ([arxiv 2504.19413](https://arxiv.org/abs/2504.19413)), Graphiti ([arxiv 2501.13956](https://arxiv.org/abs/2501.13956)) and A-MEM ([arxiv 2502.12110](https://arxiv.org/abs/2502.12110)), and the Learn run's contradiction probe from [GBrain](https://github.com/garrytan/gbrain) by Garry Tan, MIT, no code taken; aar, adapted from aar-loop by Cooper Simson, MIT; the awwwards rubric, adapted from [claude-skill-awwwards](https://github.com/tponscr-debug/claude-skill-awwwards) by Thomas Pons, MIT; accessibility, click-path-audit and e2e-testing from ECC by Affaan Mustafa, MIT; accessible-motion, gsap-greensock, hover-interactions, page-transitions and scroll-animations by Dylan Tarre, MIT; image-to-code-skill by Leonxlnx, MIT; extract-design-md, extract-static-html and taste-design from [stitch-skills](https://github.com/google-labs-code/stitch-skills) by Google, Apache 2.0.
- web-design-guidelines by Vercel; claude-x-jev and jev-setup-project by Charles J Dove (Jev).
- The harden skill and the Harden build check run [BLA (bla-agents)](https://github.com/qybaihe/bla) by qybaihe, MIT, to harden a build against AI reverse-engineering; it runs via npx, no code is bundled.
- The Board page's pixel character per agent is an idea from [Pixel Agents](https://github.com/pablodelucca/pixel-agents) by pablodelucca, MIT; no code is copied.
- The Screen tab reads a chat's terminal with [xterm.js](https://github.com/xtermjs/xterm.js) (`@xterm/headless` in the extension, `@xterm/xterm` in the web app) by The xterm.js authors, MIT; both are bundled.
- Memory junk checks (outdated notes, unproven guesses, rules that need proof) are ideas from Sheni Salami's reel [When to delete your second brain](https://www.instagram.com/reel/DgHzMWyhpls/); no code is copied.
- Blind qa (a checker that never saw the engineer's reasoning) is an idea from kem_glitch on [Instagram](https://www.instagram.com/kem_glitch/); no code is copied.
- repo-rules file claims (a file one chat is writing is held from other chats in the same folder) are an idea from kem_glitch on [Instagram](https://www.instagram.com/kem_glitch/); no code is copied.
- deep-research's claim labels (verified or inferred, a dated Checked line, a Not checked list) are ideas from ChiefGyk3D's [Clouds-Against-Humanity](https://github.com/ChiefGyk3D/Clouds-Against-Humanity) and [department-of-internal-arguments](https://github.com/ChiefGyk3D/department-of-internal-arguments), Apache 2.0; no code is copied.
- Auto pick per task follows Anthropic's effort guidance ([effort docs](https://platform.claude.com/docs/en/build-with-claude/effort)) and the cascade idea from RouteLLM ([arXiv 2406.18665](https://arxiv.org/abs/2406.18665)) and FrugalGPT ([arXiv 2305.05176](https://arxiv.org/abs/2305.05176)); ideas only, no code copied.
- Simple and Coder view follow progressive disclosure as described by Jakob Nielsen ([NN/g](https://www.nngroup.com/articles/progressive-disclosure/)); idea only.
- In a container runs the [Dev Container CLI](https://github.com/devcontainers/cli) by Microsoft, MIT, via npx, and installs Claude Code with Anthropic's [claude-code devcontainer feature](https://github.com/anthropics/devcontainer-features); no code is bundled.
- Stripping invisible characters on commit is an idea from [watermarks-remover](https://github.com/guillaumemeyer/watermarks-remover) by Guillaume Meyer, MIT; no code is copied.
- self-improve and Learn count a role or skill as a new version only after 30 approved held-out results, ChiefGyk3D's rule for the personas in [department-of-internal-arguments](https://github.com/ChiefGyk3D/department-of-internal-arguments), Apache 2.0; idea only, no code copied.
- The local-draft skill follows the local-llm-routing pack in [department-of-internal-arguments](https://github.com/ChiefGyk3D/department-of-internal-arguments) by ChiefGyk3D, Apache 2.0 (local output is a draft checked against its source, echo and compare identifiers, quote then answer, output only what was asked); rewritten, no text copied.

Installed by Set up from their own repos (not bundled):

- [superpowers](https://github.com/obra/superpowers) by Jesse Vincent (obra)
- [ponytail](https://github.com/DietrichGebert/ponytail) by Dietrich Gebert
- [impeccable](https://github.com/pbakaus/impeccable) by Paul Bakaus, Apache 2.0
- [skills](https://github.com/emilkowalski/skills) by Emil Kowalski
- [taste-skill-classics](https://github.com/Leonxlnx/taste-skill-classics) and [imagegen-skills](https://github.com/Leonxlnx/imagegen-skills) by Leonxlnx
- [pixelfx](https://github.com/patch-gg/pixelfx) by Patch
- [humanizer](https://github.com/blader/humanizer) by Siqi Chen
- [last30days](https://github.com/mvanhorn/last30days-skill) by Matt Van Horn
- [founder](https://github.com/emotixco/claude-skills-founder) by Emotix, MIT; 14 founder skills (/pricing-strategy, /pitch-deck, /go-to-market and more), off until a chat names founder work
- [Codex plugin for Claude Code](https://github.com/openai/codex-plugin-cc) by OpenAI, Apache 2.0; /codex:rescue and /codex:setup hand a job to the Codex CLI from a chat. Claude only, Codex does not get it
- [find-skills](https://github.com/vercel-labs/skills) by Vercel
- [caveman](https://github.com/JuliusBrussee/caveman) by Julius Brussee, Apache-2.0
- [untangle-codebase](https://github.com/caldoai/skills) by Maze (caldoai), MIT; /untangle-codebase lists every hidden link, needless link and bit of surplus in a repo, then fixes the list
- [ui-sdk](https://github.com/vercel-labs/ui) by Vercel Labs, Apache 2.0; the UI SDK skill, so designer and engineer build keyboard, focus, popup and drag and drop behaviors from @ui-sdk/core instead of hand-rolled ARIA
- [Scrapling](https://github.com/D4Vinci/Scrapling) by Karim Shoair, BSD 3-Clause
- [agent-browser](https://github.com/vercel-labs/agent-browser) by Vercel Labs, Apache 2.0; npm install -g, then agent-browser install for its browser, skipped when already on PATH
- [agent-desktop](https://github.com/vercel-labs/agent-desktop) by Vercel Labs, Apache 2.0; npm install -g on macOS and Windows, skipped when already on PATH
- [cross-spawn](https://github.com/moxystudio/node-cross-spawn) by André Cruz, MIT; its cmd.exe argument escaping is ported into `extension/src/hub/windows.ts` for Windows .cmd shims
- [Playwright MCP](https://github.com/microsoft/playwright-mcp) by Microsoft, Apache 2.0 (the playwright plugin below)
- MCP servers added by Set up: Slack, Cloudflare, 21st.dev, Perplexity and [Firecrawl](https://github.com/firecrawl/firecrawl-mcp-server) (MIT, needs its key saved in Sign-ins), PostHog and Composio Connect (OAuth sign-in with /mcp)
- [MiroFish](https://github.com/666ghj/MiroFish) by 666ghj, AGPL-3.0; run on its own at localhost:5001 for crowd runs, Switchboard reads its API for progress and the newest agent actions, asks it for the report when a sim's rounds finish, and saves finished reports under ~/.claude/switchboard/mirofish
- Claude in Chrome, Anthropic's browser extension, used for Kenneth's signed-in Chrome
- [archify](https://github.com/tt-a1i/archify) by tt-a1i, Apache 2.0
- [diagram-design](https://github.com/cathrynlavery/diagram-design) by Cathryn Lavery
- grill-me by [Matt Pocock](https://github.com/mattpocock/skills)
- Anthropic's [official plugins](https://github.com/anthropics/claude-plugins-official) (code-review, context7, frontend-design, playwright)

Licenses are MIT unless noted. [NOTICE](NOTICE) and [extension/NOTICE](extension/NOTICE) have the full lines.

## License

Apache 2.0. See [LICENSE](LICENSE).

The name "Agent Flow" and its logos are trademarks of Simon Patole. See [TRADEMARK.md](TRADEMARK.md).
