<!-- Switchboard: a VS Code hub to start, watch and talk to Claude Code and Codex chats, built on Agent Flow's live agent visualization. -->
# Switchboard

Switchboard is a VS Code hub for running and watching Claude Code and Codex chats across all your code projects. You start chats from one place, give each a role (lead, researcher, engineer and so on) so work can be delegated, and see what every chat is doing without switching windows.

## Credit

Switchboard is based on [Agent Flow](https://github.com/patoles/agent-flow) by Simon Patole, used under the Apache License 2.0. Agent Flow is a trademark of Simon Patole. Switchboard is not affiliated with or endorsed by the Agent Flow project. See [NOTICE](NOTICE) and [TRADEMARK.md](TRADEMARK.md).

## What it does

- **Always one click away.** An Activity Bar icon opens a sidebar view labeled Switchboard, with an Open in editor button. There is also a status bar button, and `Cmd+Option+A` opens it from anywhere, including a focused terminal.
- **New chat and roles.** Pick a project (or make a new GitHub repo or clone one right there), pick a role (lead, researcher, engineer, qa, designer, ops, growth), and start a Claude Code or Codex chat. Both runtimes are supported.
- **Live chat map.** Every running chat shows as a bubble with its role and its tool calls as they happen.
- **Today card.** What ran today, at a glance.
- **Changes panel.** Files a chat changed, with inline diffs and an Open in VS Code diff button. Symlinks and paths outside the project are never shown.
- **Quick switcher.** `Cmd+K` jumps to any chat.
- **Full chats continue.** When a chat fills up, work continues in a new chat named "<name> v2", then "v3". The old one closes when idle and moves to History.
- **History.** Chains of versions, search over handoff notes, and resume.
- **Remote Control.** Servers per repo, and at startup.
- **Settings gear** in the app, and a link to the browser version.
- **Answer terminal prompts.** Permission prompts and questions from a chat show in Switchboard and can be answered there.
- **Phone access.** Open Switchboard on your phone over Wi-Fi or Tailscale by scanning a QR code.
- **Bash runs without prompts.** The Switchboard hook allows Bash calls; deny rules in your settings still apply.
- **Status from every window.** Chats in every open VS Code window show in one list.
- **Smart switch.** A chat typed into the wrong project's window gets its first prompt checked by one quick Haiku call. When it is clearly about another listed project, it starts over in that project's window (opened if needed) and the wrong chat closes, with a notice naming where it went. It only moves from one listed project to another, and only a chat in a VS Code terminal. Any doubt, error, slow answer or pasted image keeps it where it is. Chats Switchboard started are never moved.
- **Split asks.** On Start, a New chat message that looks like several unrelated asks gets one quick model call to split it. A preview shows one editable card per ask, with Start all (each its own chat, tied as one group) or Start as one. Nothing starts without a click, and a message with secrets or one ask starts as before. Tested first: on 28 days of chats, routing new asks into a shared lead matched work in the same files only a handful of times, while about 12% of opening messages held separate asks.
- **Related chat and Wait on.** New chat shows "Related: <chat>" with Send there when a live chat in the same project looks like the same work, and a Wait on row of live-chat chips so the new chat starts after the ones picked. The map tags each waiting yard "Starts after X" and ties split siblings with a cord and "Split with X"; the Code view lists the group next to a part's chats.
- **Smart model switch.** Each role runs on the model in its agent file. When one role redesigns the same component three rounds in a row and it still fails, it moves up a model (Haiku, Sonnet, Opus, Fable) for that component, logs what it learned per project in a memory note, and drops back after 5 clean runs. Debugging never counts. Toggle and Reset in Settings > Models.
- **Advanced mode.** Per project. Big tasks run as numbered stage folders (`.switchboard/stages/`, kept out of git), each with its own context file and output folder, in the style of Interpretable Context Methodology. The chat card shows the current stage and opens into the list, with Looks good and Redo between stages.
- **Run indefinitely.** A switch per Claude chat. On, the chat asks every question it has once, then keeps auditing, fixing and checking in rounds (no more questions, no stopping) until it reports `Run indefinitely: done`. Needs the usage-meter mod; Codex chats do not have the switch.
- **Budgets and gates.** Run indefinitely can carry a time cap, a cost cap and a gate command (run in the project, 10 minute limit). The chat stops when the gate exits 0, and says "budget reached (not a success)" when a cap hits first. A failing gate's last 20 lines go into the next round. All off by default.
- **Goal budget card.** The chat card shows the goal, time since the start and cost so far, with a thin bar toward the nearer cap, and a "used $X over Yh" line when an indefinite run ends.
- **Check-back.** A per chat switch (10, 30 or 60 minutes). An idle chat with open tasks or background work gets "Check back: look at progress on open work and continue or report." typed into it, up to 12 times.
- **Refine now and Undo.** Refine now sends the aar skill to a running chat. Before aar, self-improve or Learn edits a kit, rules, agent or memory file, the files are copied to `~/.claude/switchboard/snapshots/` (`kit/skills/aar/scripts/snapshot.mjs`); History lists them with Undo, and undoing snapshots the current state first.
- **Check health.** Settings, Check health tests the hook server, hub port, kit rules and agents against the bundled ones, each mod's installed version, the claude and codex CLIs and the MCP config. Fix safe ones reruns the existing install paths for what is fixable.
- **Daily trends.** The 6 pm summary and the Today card show yesterday's chats, cost, approved and sent back, with an arrow against the day before and the same weekday last week, from the local History archive.
- **Saved pipelines.** Save as pipeline on a stages run keeps its `stages.json` and each `CONTEXT.md` (no outputs) in `~/.claude/switchboard/pipelines/`. A new chat in an Advanced project can pick one: the run folder is seeded with every stage on todo and the first prompt names it.
- **Auto AI pick.** New chat's Auto labels the task with a role through the project's Jev route preset (a word table when Jev is unsure or off): code roles go to Codex, the rest to Claude, and a notice says why.
- **Discuss.** A chat can ask the other AI (Claude or Codex) through the `discuss` tool: a few headless, read-only rounds in the chat's folder that end with what the two agreed and disagreed on.
- **Window colors.** Each VS Code window gets its own color, on its title bar, status bar and in Switchboard. The title bar color goes in the project's `.vscode/settings.json`; turn off `switchboard.colorTitleBar` to skip it.
- **Own worktree.** When a Claude chat starts in a project that already has a live chat, New chat offers Own worktree, ticked. The chat runs in `<repo>/.claude/worktrees/<name>` on branch `worktree-<name>` (`claude --worktree`), shows under its project, and the Git panel's Merge back merges that branch into the main checkout and removes the worktree. It never pushes.
- **Claude chat permissions.** Settings picks Bypass (default), Ask, or Auto, Claude Code's own classifier mode: no prompts, but a classifier blocks risky actions that go beyond what the chat was asked to do. Questions to you still ask in every mode.
- **More chat events.** Cards note when a chat's context was compacted, when a tool call was denied and which rule files loaded, from the PostCompact, PermissionDenied and InstructionsLoaded hooks; TaskCompleted ticks the task list.

## What's included

- **Always-on plugins.** superpowers, ponytail, code-review, context7 and playwright are on in every Claude chat Switchboard starts and cannot be turned off there. Flagged conflicts (only the second security-guidance, which would run the same hooks twice) start off and are never turned on by a pick; turn one on by hand or with tool_on.
- **Gated bundles.** marketing-skills, aws-core and bland start off so the skill listing keeps every other description; a goal or first message naming their field turns one on, and the chat is told how to turn them on with tool_on. Chats also get `skillListingBudgetFraction` 0.02.
- **Picked per chat.** A new Claude chat with a goal gets its own plugins, skills and design references, picked by one quick Haiku call from the goal, each one's description, and the project: folder name, the top of its CLAUDE.md or AGENTS.md, and its dependencies. If the pick fails or is slow, the chat gets your own settings and the fallback is logged. Change the set in the chat's Tools section; it applies when the chat is resumed.
- **Project skills.** Skills in the project's `.claude/skills` and `.agents/skills` are listed for that project's chats and can be turned off per chat like your own.
- **Design references.** `design-md/<brand>/`, `docs/design/*.md` and a root `DESIGN.md` in the project. A pick takes up to three for UI work, and the chat is told their paths.
- **Roles.** lead, researcher, engineer, qa, designer, ops and growth, from `extension/kit/agents`.
- **The kit.** On start, the extension writes the working rules (`extension/kit/rules.md`) to `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md`, and the role agents to `~/.claude/agents`. `extension/kit/bundle.json` holds the rules version, so newer rules are never overwritten by older ones. Rules that only apply to some files (`extension/kit/rules/*.md`, with `paths:` frontmatter) go to `~/.claude/rules/switchboard-<name>.md` and load only when a chat touches a matching file; Codex gets them inline in AGENTS.md. Files there without Switchboard's mark are never touched. A role file you edited is left alone, with the new copy saved beside it.

## Built here

Written by Kenneth, from the repos as they stand:

- **Switchboard.** The VS Code extension (`extension/`), the web app (`web/`) and the phone app (`app/`), all showing the same chats.
- **Mods** in [claude-mods](https://github.com/kennykennethkkang/claude-mods): usage-meter, repo-rules, paid-guard, bash-approve, chat-wait, done-check, cache-keeper, phone-mode, todo-band and tab-close. Each is described in that README (phone-mode ships in the repo but is not in the install list there).
- **Kit skills:** animation-styles, memory-fix (applies the safe memory graph fixes with backups, lists the rest), crowd-ab (synthetic user votes between two options, shown live on the Live page's Crowd A/B card; names a winner only when Jev in both option orders and the haiku panel agree), deep-research (answers with re-read citations), gemini (images and video through Gemini), harden (runs BLA to harden a build against AI reverse-engineering before a release), improve-system, model-bench (benchmarks role agents across Claude models with hidden-test tasks and recommends the cheapest model within 5 points of the best), goal (`/goal <spec>`: writes how each function must work and a Check command to `.switchboard/goals/<chat id>.md`; under Run indefinitely every round works toward it and a passing Check ends the run, under Run indefinitely, Claude and Codex chats alike, and handed over to a fresh chat on handoff), stages (runs a big task as numbered stage folders for Advanced mode), phone (calls Kenneth through Bland for a decision), self-improve (tunes a role or skill against held-out tasks), toolchain (reads a repo's manifests and prints its test, lint, typecheck and build commands and the matching ecc-agents reviewer, so roles work in any language).
- **Role agents:** researcher, engineer, qa, designer, ops, growth, Explore, and the Codex hand-offs engineer-codex and qa-codex (Settings, Models picks their Codex model and effort).

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

Requirements: Node 20+, pnpm, VS Code 1.85+ (or one of the editors above), and the Claude Code CLI and/or Codex CLI.

### Without an editor

Working in JetBrains, Zed or a plain terminal? Run the standalone app (`pnpm build:app`, then `node app/dist/app.js`). While no editor window with Switchboard is open, the app runs its own hub; once one opens, the app goes back to that window.

- Works: the chat list, projects, to-do lists, chat progress from hooks, and New chat for Claude and Codex. A new chat starts in a detached tmux session (`tmux attach` to see it) when tmux is installed, else in a Terminal.app window opened behind whatever has focus.
- Missing: terminal tabs, window colors, inline diffs, and every other command (tool picks, dev servers, handoffs, voice). Those answer "Open an editor window with Switchboard for that."

## Moving to another computer

The [claude-mods](../claude-mods) repo carries a kit that sets up plugins, skills, rules, role agents, settings and the Switchboard VSIX on a new machine. Clone it next to this repo and run `node kit/setup.mjs`. Its README has a five step list. Keys and sign-ins never travel.

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

For a non-default Codex install, set `CODEX_HOME`.

## Credits

Switchboard is a fork of [Agent Flow](https://github.com/patoles/agent-flow), the real-time visualization of Claude Code and Codex agent orchestration created by [Simon Patole](https://github.com/patoles) for [Antics](https://antics.gg). Its hook server and Codex rollout reader are still the base of Switchboard's live data. Used under the Apache License 2.0. Agent Flow is a trademark of Simon Patole; Switchboard is not affiliated with or endorsed by it.

Shipped with Switchboard:

- ECC subagents (kit/mods/ecc-agents) from [ECC](https://github.com/affaan-m/ECC) by Affaan Mustafa, MIT.
- Advanced mode follows Interpretable Context Methodology ([arXiv 2603.16021](https://arxiv.org/abs/2603.16021)) by Jake Van Clief and David McDermott, CC BY 4.0; reference repo [RinDig/Interpretable-Context-Methodology](https://github.com/RinDig/Interpretable-Context-Methodology), MIT. Idea only, no code copied.
- Budgets and gates, check-back, refine with undo, check health, daily trends and saved pipelines take their ideas from [prime-agent](https://github.com/PrimeIntellect-ai/prime-agent) by Prime Intellect, MIT. Ideas only, no code copied.
- DESIGN.md files (kit/design-md) from [awesome-design-md](https://github.com/VoltAgent/awesome-design-md) by VoltAgent, MIT.
- Silkscreen font by Jason Kottke ([kottke.org](https://kottke.org/plus/type/silkscreen)), SIL Open Font License 1.1.
- Hanken Grotesk font by [The Hanken Grotesk Project Authors](https://github.com/marcologous/hanken-grotesk), SIL Open Font License 1.1.
- Kit skills, each with its LICENSE: memory-fix, ideas from Mem0 ([arxiv 2504.19413](https://arxiv.org/abs/2504.19413)), Graphiti ([arxiv 2501.13956](https://arxiv.org/abs/2501.13956)) and A-MEM ([arxiv 2502.12110](https://arxiv.org/abs/2502.12110)), no code taken; aar, adapted from aar-loop by Cooper Simson, MIT; the awwwards rubric, adapted from [claude-skill-awwwards](https://github.com/tponscr-debug/claude-skill-awwwards) by Thomas Pons, MIT; accessibility, click-path-audit and e2e-testing from ECC by Affaan Mustafa, MIT; accessible-motion, gsap-greensock, hover-interactions, page-transitions and scroll-animations by Dylan Tarre, MIT; image-to-code-skill by Leonxlnx, MIT; extract-design-md, extract-static-html and taste-design from [stitch-skills](https://github.com/google-labs-code/stitch-skills) by Google, Apache 2.0.
- web-design-guidelines by Vercel; claude-x-jev and jev-setup-project by Charles J Dove (Jev).
- The harden skill and the Harden build check run [BLA (bla-agents)](https://github.com/qybaihe/bla) by qybaihe, MIT, to harden a build against AI reverse-engineering; it runs via npx, no code is bundled.
- The Board page's pixel character per agent is an idea from [Pixel Agents](https://github.com/pablodelucca/pixel-agents) by pablodelucca, MIT; no code is copied.
- Stripping invisible characters on commit is an idea from [watermarks-remover](https://github.com/guillaumemeyer/watermarks-remover) by Guillaume Meyer, MIT; no code is copied.

Installed by Set up from their own repos (not bundled):

- [superpowers](https://github.com/obra/superpowers) by Jesse Vincent (obra)
- [ponytail](https://github.com/DietrichGebert/ponytail) by Dietrich Gebert
- [impeccable](https://github.com/pbakaus/impeccable) by Paul Bakaus, Apache 2.0
- [skills](https://github.com/emilkowalski/skills) by Emil Kowalski
- [taste-skill-classics](https://github.com/Leonxlnx/taste-skill-classics) and [imagegen-skills](https://github.com/Leonxlnx/imagegen-skills) by Leonxlnx
- [pixelfx](https://github.com/patch-gg/pixelfx) by Patch
- [humanizer](https://github.com/blader/humanizer) by Siqi Chen
- [last30days](https://github.com/mvanhorn/last30days-skill) by Matt Van Horn
- [Codex plugin for Claude Code](https://github.com/openai/codex-plugin-cc) by OpenAI, Apache 2.0; /codex:rescue and /codex:setup hand a job to the Codex CLI from a chat. Claude only, Codex does not get it
- [find-skills](https://github.com/vercel-labs/skills) by Vercel
- [caveman](https://github.com/JuliusBrussee/caveman) by Julius Brussee, Apache-2.0
- [untangle-codebase](https://github.com/caldoai/skills) by Maze (caldoai), MIT; /untangle-codebase lists every hidden link, needless link and bit of surplus in a repo, then fixes the list
- [ui-sdk](https://github.com/vercel-labs/ui) by Vercel Labs, Apache 2.0; the UI SDK skill, so designer and engineer build keyboard, focus, popup and drag and drop behaviors from @ui-sdk/core instead of hand-rolled ARIA
- [Scrapling](https://github.com/D4Vinci/Scrapling) by Karim Shoair, BSD 3-Clause
- [Agent Reach](https://github.com/Panniantong/Agent-Reach) by Panniantong
- [agent-browser](https://github.com/vercel-labs/agent-browser) by Vercel Labs, Apache 2.0; npm install -g, then agent-browser install for its browser, skipped when already on PATH
- [agent-desktop](https://github.com/vercel-labs/agent-desktop) by Vercel Labs, Apache 2.0; npm install -g on macOS and Windows, skipped when already on PATH
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
