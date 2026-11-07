# Changelog

## 0.21.4

- To-do redesigned as a compact list: one line per item, a round tick to finish, click the text to edit, one short note per row, counts as badges, no hint paragraphs
- Picking items to run is a "Select to run" mode whose run bar takes the add field's place, so the list no longer jumps
- Finish up and Suggested are compact groups at the top; every Finish up step, older accepted ones included, has Dismiss
- Project, "elsewhere" and tab counts leave out Needs you steps that only show under Finish up; long items no longer push the page wider than the window
- Suggestions skip pasted blocks, other chats' messages, usage-limit prompts and follow-up nudges; real requests, questions included, stay
- A suggestion that points at an open to-do item or repeats one is dropped, matched on whole words, and every device keeps the same copy
- For you steps expire after 3 days and a project keeps one of each hand step, matched on verb and object
- Lists are cleaned when the hub loads them; accepted and typed items are never removed, only a chat's exact repeat
- A test no longer writes temp repos into the real todo-sync.json, and temp paths there are ignored
- Sweep: plugins and skills Set up installs are scanned with NVIDIA SkillSpector (no LLM) and badged; anything added from outside the kit that the sweep flags, or that cannot be scanned, stays off until you approve it in a VS Code dialog
- Settings, Installed: Add a plugin or skill from a GitHub repo, swept on the way in; a repo holding a symlink is refused
- Settings, Installed: Sweep all runs in the background with progress, badges on swept plugins and skills, and Rescan, Approve and Fix in a chat for flagged ones; turning a flagged tool on asks first
- New `sweep` tool for chats: rescan one tool or start Sweep all; approving stays with you
- Set up adds the improve-system and awwwards skills and the Cloudflare MCP (https://mcp.cloudflare.com/mcp, OAuth on first use)
- Header shows both the 5-hour and the weekly limit, each with % used and when it resets; yellow from 80%, red only at a real 100%, "no data" when no chat reports a window; meters show on phone too
- Limit reset times read from ISO, epoch seconds or epoch ms, so auto-continue waits for the real reset instead of falling back to 30 minutes
- The usage-limit card's reset line uses the same 12-hour wording as the header
- Sweep: a tool held at intake stays off in every chat and in tool_on until you approve it, and an approval lapses if its files change
- Chats can no longer run any Switchboard git button (commit, undo, discard, stash, branch ops) through /hub/command; only you press them
- On the phone, the Git tab and Ship card hide the ops only the Mac may run (push, sync, commit and push, discard, PR, ship, delete branch); Commit stays
- The API key error states the real rule: 16 to 128 characters, letters, digits, '.', '-' or '_'
- The Classic layout's Settings has a heading and a Close button
- Demo: New chat Tools loads, and Put back keeps a Finish up step in Finish up

## 0.21.3

- A chat's Done fills Source Control in every repo it names: `Commit message (<repo folder>):` blocks go to that repo in whichever window has it open (claude-mods in its own window too), the plain `Commit message:` block to the chat's own repo
- A new message is merged into one Switchboard wrote that is not committed yet: the new summary line, then its lines and the old ones it lacks; your own text in the box is still never touched, and after a commit the box starts fresh
- Kit skills: a UTF-16 text file is scanned for keys too, and a skill folder that is a symlink is refused before the bundled copy is touched

## 0.21.2

- A window opened on a repo subfolder or a worktree trusts that repo's root for Claude, so chats there start without the trust dialog; matched by the repository's git dir, so a nested repo, a submodule or an unrelated parent repo is never trusted this way
- Memory graph route test fixture carries the health field
- Switchboard's own skills ship in the vsix (kit/skills): aar, and animation-styles with its gallery, 20 reel clips and 20 frames
- Set up copies each one to ~/.claude/skills when it is missing, and replaces an older copy Switchboard put there; a symlinked skill folder or one you wrote yourself is never touched
- The build takes them from claude-mods/kit/skills, keeps the bundled copy when claude-mods is missing, scans text files for keys and leaves clips and frames byte for byte

## 0.21.1

- Memory is a knowledge graph: notes can say `supersedes`, `depends-on`, `part-of`, `contradicts` and `related` (comma, `[a, b]` or `- a` lists, at the top or under metadata), take `aliases`, and link to the chat that wrote them; links resolve by name, then alias, ignoring case
- Frontmatter is read only at the top level and directly under metadata, so a `description: |` block or a nested key can no longer set a note's name, type or relations
- Memory health: broken links, unlinked notes, names shared within a folder or the vault, contradictions, superseded, invalid (no description or type) and stale project notes (90 days, by modified or the file's time); counted in the list view
- Memory view colors edges by relation, fades superseded notes, lists typed relations in the details and finds notes by alias
- `hub_recall` tool: a chat searches memory and the vault before researching, free and local; the best three notes and how they relate within two hops, the chat's own project first on a tie, superseded notes only by name, any script, about 1500 characters; the graph is read at most once per 30 s and kept in memory only
- Lock tests for chains and window colors no longer race a timer under the full suite
- Auto-start claims on a git-synced to-do are confirmed by the remote before a chat starts, so two machines cannot start the same item; an offline or rejected claim starts nothing and that project waits 5 minutes
- A Run press during an auto-start claim wins cleanly instead of both launching
- Trust is written on the repo root (the main checkout for a worktree), which is what Claude checks, so chats started in a repo subfolder no longer stop at the trust dialog
- A folder open in any trusted Switchboard window can be trusted from another window, so resumes and handoffs into other projects start without the dialog

## 0.21.0

- Auto-start chats (Settings, Chats, on by default): an idle project with no usage limit hit starts a chat for its next ready to-do item, one chat per project, only from the window that owns the project
- A chat that hit a usage limit and then closed is resumed after the reset with the continue prompt; ending it with clear or logout drops the retry
- Folders are marked trusted in Claude before a chat starts there, so the trust dialog no longer stops new chats, resumes, handoffs or the RC server; only inside a workspace VS Code already trusts
- To-do claims are checked against the file before a chat starts, so Run and auto-start cannot put one item in two chats; Run can take over another machine's claim after 2 minutes
- After an update the browser app keeps retrying its restart for about 2 minutes, so it no longer stays on the old version when every window reloads at once
- Kit: aar skill (After Action Review into memory, the vault and proposed to-do edits) runs on handoff and before the standup when installed; animation-styles skill with 20 styles and a live gallery; gemini skill falls back to ffmpeg contact sheets

## 0.20.1

- Apple Notes access note is "Switchboard Access", tagged #SwitchboardAccess, with the address to type and the one-tap link; it is checked against the live address every 30 minutes and fixed when stale
- Access note sync works again on iCloud: notes are found folder by folder, skipping Recently Deleted (reading a note's container failed there, so the note had not updated since the move to Tailscale serve)
- The app's own phone page gets the same viewport-fit cover and theme colors as the hub

## 0.20.0

- Phone link works without Tailscale HTTPS certs: the app falls back to `tailscale serve --http=80` inside the tailnet, accepts the plain Host and Origin, drops `Secure` from the sign-in cookie in that mode, and moves to https within a minute once certs are on
- UI pass over the hub in VS Code, the browser and on phones:
  - Phone: inputs 16px on touch (no iOS zoom), viewport-fit cover and theme color, no tap flash or pull-to-refresh, `dvh` heights, 44px touch targets on small buttons, chips, git rows, orbit and lanes nodes
  - Needs attention and Jarvis show only on the Chats tab on phones
  - Focus rings on every button, contrast fixes for light Desk green and amber, the dark switch knob and placeholders, color-scheme per theme
  - One small button style, one popover shadow, radii and type sizes on the design scale
  - Header tab order matches what you see; chat names no longer squeezed by status chips
  - First to-do item can be added for a project with no list
  - Uncommitted files listed once and one primary commit button per view; Git shows a loading line
  - Git commit form strips Co-Authored-By and session trailers, like Ship
  - Branch menu and git confirms close on Escape; destructive confirms focus Cancel
  - Enter no longer submits mid-composition (Korean, Japanese, Chinese input) in New chat, Find and Memory
  - A failed send puts the message and attachments back in the box
  - Hand off and Compact ask for a second press
  - Settings search matches whole keywords; popovers never scroll the page sideways
  - Demo data gives each chat its own transcript

## 0.19.0

- Gemini skill in the kit: images, video and YouTube summaries, and answers cited from a folder of sources
- Sign-ins hold the Gemini and Jev API keys: macOS Keychain (a 0600 file elsewhere), the UI only sees the last four
- ECC skills added (accessibility, click-path-audit, e2e-testing) and the skill picker audited
- Suggested to-do tray: what finished chats left behind waits for Accept or Dismiss
- Ship card on a finished chat: Pull, Merge main, or Commit & push from its git state and test run
- Memory view: memory files, projects, chats, to-do and CLAUDE.md files as one 3D graph
- Jev per project: Set up Jev drafts presets for one repo and checks them on real items
- Busy state on chat cards with an estimate of time left
- Node detail drawer in the orbit view
- Stuck detection: chats that stop making progress show in a strip
- Design library list no longer comes up empty while the library is being copied
- Comments and docs swept of em dashes

## 0.18.1

- File upload: attach files in the message box and New chat by click, drag and drop or paste, from VS Code or the phone (100 MB cap). Saved under `~/.claude/switchboard/uploads/<project>/<date>/` with an `INDEX.md` per project; the message carries the saved paths
- Security: the app rejects requests with a foreign Host (DNS rebinding could read `/events`); paid-guard catches AWS changes with flags before the service or verb and `rm`, `sync`, `cp`, `mv`, `mb`, `rb`, `invoke`
- Telemetry removed
- Transcripts: half-written lines are read again instead of dropped; ended sessions release their watchers and polls; permission waits detected reliably; Codex no longer rescans on every write
- Hub: History no longer double counts on overlapping scans; chats and plugins load in windows where the panel was never opened; unchanged state is not re-posted; refreshes no longer stack; to-do writes outside git are queued; `claude` found when VS Code's PATH lacks it
- App: proxied replies end cleanly when a window dies, static files served gzipped with ETag, `--port=N` accepted
- UI: sheets focus their first field, readable switches and field borders in Desk dark, stable hub state and send, compact to-do rows, message box above Tools, orbit labels fit on phones, fixed Settings height, red destructive git confirms, Classic uses the loaded font
- Uploads from VS Code go in 4 MB slices with a percentage; removing a chip cancels the upload on both routes
- usage-meter: window calls time out after 2 s and fan out; a refused handoff says so, is retried after 5 minutes, and no longer winds the chat down
- Rules sync skips a damaged block instead of deleting text, and handles CRLF files
- Self-update pulls in one window at a time with jitter and retries a failed install
- Ended chats stay listed (last 50); a resumed chat no longer repeats its last turn
- Relay live feed sends a heartbeat and drops stalled clients
- Shared file lock for chains, archive, colors, access note and self-update
- AWS checks skip backup profiles, two at a time; sign-in links like ?authuser=1 are allowed while run-together secret names are still refused
- Removed five hub commands nothing sent (refresh, stop server, open in VS Code, open project, clone)
- Path matching folds case on Windows for handoff closing and jev runs
- Light Desk field borders reach 3:1
- `build:extension` and `dev:extension` scripts point at the right package

## 0.9.2

- Fix: hook setup no longer removes other tools' hooks from `~/.claude/settings.json` (#73)
  - Setup (`npx agent-flow-app`, `pnpm run setup`, and the VS Code extension) treated any hook URL starting with `http://127.0.0.1:` as its own, so loopback HTTP hooks registered by other tools were deleted on install. On every activation, the VS Code extension also rewrote them into Agent Flow command hooks
  - Only Agent Flow's own command hook and its legacy bare-origin HTTP hook (`http://127.0.0.1:<port>`) are matched now. This also fixes setup being skipped when another tool's loopback hook made it look already installed
  - A `settings.json` that can't be parsed is now left untouched with an error, instead of being replaced by a file that only contains hooks
  - Settings are written via a temp file and rename, so an interrupted write can't truncate them
- Fix: uninstalling the VS Code extension now removes its hooks. The uninstall script was excluded from the packaged extension, so `vscode:uninstall` had nothing to run and Agent Flow's hooks stayed in `settings.json`
- Fix: background subagents were marked done the moment they launched (#92)
  - Claude Code runs `Agent`/`Task` subagents in the background by default. Their immediate tool_result only confirms the launch, but Agent Flow treated it as the finish, so the node completed at once and then looked busy again on its next tool call, or vanished and silently dropped the rest of its events
  - Background subagents now complete when their `<task-notification>` arrives, including ones launched before Agent Flow attached. Failed or killed runs are marked in the return summary
- Fix: per-agent model detection (#91)
  - Subagents get their model from the parent transcript (`resolvedModel` on the launch result), so replayed or branched sessions and subagents whose transcript is never tailed now show a model
  - Placeholder `<synthetic>` model ids (written on API errors and interrupts) no longer replace the real model
- Fix: in review mode, the elapsed time, scrubber knob and counters stood still while playback ran through a stretch with no events, and only caught up on the next event or on pause (#90)
- Fix: session switching and replay races in the web view (#78)
  - Re-selecting the session already on screen no longer freezes event delivery, and live events no longer skip events that hadn't been replayed yet
  - Restoring a paused snapshot no longer plays it at 1x under the LIVE badge, and the snapshot cache is cleared on reset

## 0.9.1

- Fix: Claude Code session discovery on Windows: workspace-to-project-dir matching is now case-insensitive on win32 (#57, part of #4)
  - VS Code reports drive letters lowercase (`c:\...`) while Claude Code encodes them uppercase (`C--...`), so the encoded-directory lookup, the subfolder-session prefix check, and the cwd containment check could all silently miss, no sessions appeared at all
  - The workspace project dir is now resolved to its actual on-disk casing at startup, and all path comparisons are case-folded on Windows (matching the Codex-side fix from 0.9.0)

## 0.9.0

- **New model support: Claude Fable 5 / Mythos 5, Sonnet 5, Opus 4.8, GPT-5.x Codex** (#57)
  - Context window sizing: `fable`/`mythos` family recognized as 1M context (previously fell back to 200k, showing the gauge 5× overfull); `gpt-*` family recognized as 400k as the fallback when Codex doesn't report its own authoritative window. Sonnet 5 / Opus 4.8 already matched the existing family patterns
  - Cost display: per-model-family blended $/M rates (Fable/Mythos $10/$50, Opus $5/$25, Sonnet $3/$15, Haiku $1/$5, GPT-5.x Codex $1.75/$14) replace the single Sonnet-class rate that was applied to every agent. Agents now carry the detected model ID, and the cost pill, summary panel, and per-tool breakdown all use the owning agent's rate
- **Codex session discovery fixes**: addresses reports of Codex sessions not appearing
  - Windows: workspace/cwd matching is now case-insensitive on win32 (VS Code reports `c:\...`, Codex writes `C:\...`, so sessions never matched)
  - Large `session_meta`: the first-line reader now grows up to 1MB instead of a fixed 64KB. Newer Codex versions embed full base instructions and AGENTS.md content, which silently broke cwd extraction and skipped the session
  - Silent cwd mismatch: when recent Codex sessions exist but none ran in the current workspace, a warning now says so (the most common cause: launching `npx agent-flow-app` from a different directory than the Codex session). Warnings are visible without `--verbose`
- Fix: assistant messages in Codex sessions were labeled "CLAUDE" in the transcript panels and canvas bubbles; the label now follows the session runtime ("CODEX") (#49)

## 0.8.1

- **Opt-out anonymous usage telemetry**: Agent Flow now tracks whether people come back after day 1 so we can tell whether it's actually useful. Only aggregate session metadata is sent, never prompts, file paths, or code
  - What's sent: session count, duration, event count, OS/arch, Agent Flow version, distinct Claude/Codex model IDs observed during each session, which runtimes were watched (`claude`, `codex`, or `claude,codex`), and error class names on crashes
  - What's NEVER sent: prompts, tool calls, tool responses, file paths, repo names, user name/email/hostname, environment variables, error messages or stack traces
  - Turn off: `export AGENT_FLOW_TELEMETRY=false` or `export DO_NOT_TRACK=1`. Disabled installs write nothing to disk: no `~/.agent-flow/` state file, no telemetry dir
  - Only the published `npx agent-flow-app` binary emits. `pnpm run dev` stays silent so contributor iterations don't land in the data
  - Inspect the exact payload locally: `cat ~/.agent-flow/telemetry/events.jsonl`
- Remove `@vercel/analytics`; it conflicts with the first-party-only commitment in the privacy doc

## 0.8.0

- **Codex runtime support**: available in all three entry points (VS Code extension, `pnpm run dev`, and `npx agent-flow-app`). Agent Flow now watches Codex rollouts at `~/.codex/sessions/**/rollout-*.jsonl` alongside Claude Code sessions
  - New `agentVisualizer.runtime` setting (VS Code only): `"auto"` (default, watches both), `"claude"`, or `"codex"`
  - `AGENT_FLOW_RUNTIME` environment variable (`claude` / `codex` / `auto`) gives the same opt-out in `pnpm run dev` and `npx agent-flow-app`
  - Respects `CODEX_HOME` for non-default installs
  - Parses all five Codex rollout record types (`session_meta`, `turn_context`, `response_item`, `event_msg`, `compacted`) and surfaces tool calls (`exec_command`, `apply_patch`, `write_stdin`, `update_plan`), reasoning, web searches
  - Uses Codex's own authoritative token counts (`event_msg.token_count.info.last_token_usage.input_tokens` and `model_context_window`) instead of estimating
  - Handles auto-compaction via the `compacted` event; the context gauge resets cleanly instead of staying frozen
  - Filters Codex's IDE-context wrapper (`# Context from my IDE setup:` + `## My request for Codex:`) and pure injections (AGENTS.md, environment_context, turn_aborted) from user messages
- Refactor: new `AgentSessionWatcher` interface and shared watcher→panel wiring (`session-runtime.ts`) replaces per-runtime duplication. The Codex watcher is vscode-free so it works in the relay/CLI without modification
- Parser unit test suite with real-shape rollout fixture, run with `pnpm test`

## 0.7.0

- **Opus 4.7 support** (#43)
  - Context window sizing now uses family-based pattern matching, so new Opus/Sonnet releases (4.7, future 4.x / 5.x) pick up their 1M context without a code change
  - Redacted thinking blocks (Opus 4.7 returns thinking as an encrypted signature by default) now show a "Thinking..." placeholder bubble instead of being silently dropped
- Fix: Windows hook deduplication: `isAgentFlowHook` now normalizes path separators before matching, so old entries are correctly replaced on re-registration (prevents settings.json from accumulating duplicates) (#42)
- Fix: respect `CLAUDE_CODE_DISABLE_1M_CONTEXT` env var and setting; the context gauge caps to 200k when set (#39)
- Fix: relay path encoding for non-ASCII workspace paths (CJK, Cyrillic, accented Latin) (#38)
- Fix: duplicate subagent nodes from hook server and transcript parser race (#34)
- Fix: duplicate React key warning on session switch (#33)
- Fix: web app SSE connection failure in standalone dev mode (#32)

## 0.6.2

- Fix: session detection for workspace paths containing underscores or other special characters (#18, #19)

## 0.6.1

- npx support: `npx agent-flow-app` starts the visualizer without cloning the repo
- Internal refactor: shared relay module and build config

## 0.6.0

- Standalone web app: run Agent Flow in the browser without VS Code (`pnpm run dev`)
- pnpm workspace monorepo setup
- VS Code debug and dev configuration
- Fix: event loss from React strict mode double-invocation
- Fix: SSE relay security hardening (localhost-only binding, restricted CORS, bounded event buffer)

## 0.5.0

- Fix: heavy performance degradation during long sessions with many agents (#20)
  - Decouple canvas rendering from React state: canvas reads from a ref at 60fps, React re-renders only on data changes
  - Virtualize transcript and message feed panels for constant render cost regardless of message count
  - Replace timeline panel DOM with canvas rendering
  - Fix tool call cleanup leak that caused unbounded object growth after ~5000 events
  - Fix event log cap causing mass event replay in mock/stress mode
  - Cap simulation loop at 60fps to reduce CPU/GPU usage
- Add stress test scenarios for profiling (`?stress=light|medium|heavy|extreme`)
- Add performance overlay for debugging (`?perf`)
- Fix passive event listener warning when panning canvas
- File attention panel: show agent count instead of full name list

## 0.4.7

- Fix: reset button in review mode no longer breaks the extension
  - Active agents are preserved across reset; only completed state and visual history are cleared
  - Event log is trimmed to retain agent_spawn events so review mode seeking works correctly

## 0.4.6

- Updated README: clarified automatic hook configuration behavior
- Updated description and tagline

## 0.4.5

- Initial public release
- Real-time visualization of Claude Code agent execution flows
- Auto-detection of Claude Code sessions via transcript watching
- Claude Code hooks integration for live event streaming
- Multi-session support with session tabs
- Interactive canvas with agent nodes, tool calls, and particles
- Timeline, file attention, and transcript panels
- JSONL event log file watching
