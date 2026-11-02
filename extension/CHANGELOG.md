# Changelog

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
