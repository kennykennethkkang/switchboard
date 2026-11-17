# Changelog

## 0.21.80

- A worktree kept by Merge back is removed once no chat has run in it for 10 minutes, if its branch is merged and the tree is clean (no force); case twins count as one folder
- Denied card note puts the reason in parentheses; the Auto permissions hint says a classifier blocks risky actions beyond the task and asks after 3 blocks in a row
- Demo shows a worktree chat with Merge back and the new card notes

## 0.21.79

- Own worktree: a Claude chat started in a project that already has a live chat can run in its own git worktree (ticked by default); the Git panel gets Merge back, which merges the branch into the main checkout, never pushes, and keeps the worktree while a chat still runs in it
- Settings, Claude chat permissions: Bypass, Ask or Auto (Claude Code's classifier mode, no prompts; a classifier blocks risky actions beyond what the chat was asked)
- Cards note context compactions, denied tool calls and loaded rule files (PostCompact, PermissionDenied, InstructionsLoaded hooks); TaskCompleted ticks the task list
- Path-scoped kit rules: rules for some files only install to ~/.claude/rules and load when a chat touches a match; Codex keeps them inline

## 0.21.78

- To-do suggestions keep any imperative, not only lines that start with a listed verb ("Debounce the save", "Re-run the chain", "Also wire the map"); lines that read as a status report ("X still says...", "Your list is empty...", "The saved list could...") are dropped
- Repos with no open chat get their to-do cleanup written to the local list too (no push); the next sync carries it

## 0.21.77

- Two open windows no longer share a title bar color: when a saved color clashes with another open window, the later one moves to a free color

## 0.21.76

- To-do shows every listed repo that has work, not just this window's project and those with a chat; other repos are read from their local list (no fetch, never auto-started)

## 0.21.75

- To-do panel redesigned: every project with work on one page, your own steps first, then Running, Queue and an add box, then suggestions with Add, Dismiss and Add all; a "N suggested" link in each project title jumps to them; done items sit in a "done this week" fold with Undo
- Suggestions take only real action lines (a verb and a target, after any "Label:" or "Before ...," lead-in); status remarks, fragments and steps addressed to you are dropped, and old ones are cleared on the next read
- Your typed questions and complaints no longer turn into "missed" to-do items
- An item whose words match a recent commit or a CHANGELOG line is ticked as shipped, with the commit shown and Undo; Put back keeps it open for good
- Left lines keep their full text instead of stopping at 160 characters; "can't" in a line no longer marks it blocked
- Test and temp folders (~/.cache, tmp) no longer show up as to-do projects
- Panel controls get 44px touch targets on phones

## 0.21.74

- Every chat that finishes now updates the Source Control commit box, even when it already holds text: the new message goes on top and what was there (earlier chats, your own words, a box kept from before a reload) stays below as bullets

## 0.21.73

- A chat that runs the real Chrome app headless now has that browser stopped when the chat ends, like Playwright and Chrome for Testing; a leftover one caught link clicks from other apps, so links opened nothing

## 0.21.72

- Codex chats follow `/goal` too: the hub finds the goal file from the chat folder up, its Check is the gate, the done line alone cannot end the run while it fails, and the round names the goal file (Codex writes it under its `CODEX_THREAD_ID`)
- A handoff to a fresh chat copies the old chat's goal file to the new one, so Run indefinitely keeps working toward the same goal; a Codex handoff note names the goal file for the new chat to copy
- Run indefinitely for Codex: a new turn that lands while the gate still runs gets its round on a later poll instead of being dropped
- Run indefinitely ask rule says to ask every question up front in one round, then decide; it used to say only "decide yourself" while the up-front round was still open

## 0.21.71

- `/goal <spec>` kit skill: writes how each function must work, what done looks like and a Check command to `.switchboard/goals/<chat id>.md`; asks every open question up front under Run indefinitely, as it goes in a normal chat
- Run indefinitely follows a chat's goal file: each round works toward it, and its Check line is the gate (a hub gate still wins) and the done line cannot end the run while it fails, so the run ends when the goal holds; goal files and the Check use the project root

## 0.21.70

- Run indefinitely for Codex chats honours the time cap and gate: the gate runs in the background, a pass or a spent cap ends the run with the reason and usage, a failing gate's redacted tail goes into the next round
- Undo says which files it skipped (outside your home folder), as a notice and under the snapshot in History
- Send back is recorded: the answer to "Approve this chat as finished?" counts onto the chat's History row, and the daily trend counts real send backs (rows from before keep the old guess)
- Codex chats' limits form hides the cost cap (Codex reports no cost) and says to use hours or a gate
- Undo's "before undo" snapshot keeps the skipped paths, so History still lists them after a refresh
- The map shows a chat's Run indefinitely limits and check-back quietly: a short line in its courtyard tag ("4h $5 gate · back 3/12") and the full one under the chat in a part's list of changers ("limit 4h / $5, gate · check back 30m 3/12")

## 0.21.69

- Run indefinitely budgets and gates: optional time cap, cost cap and gate command; the gate passing or a cap reached ends the run with the reason, and a failing gate's output tail goes into the next round
- Goal budget card, check-back (10, 30 or 60 minutes, at most 12), and Refine now on the chat card
- Undo points: `snapshot.mjs` (aar skill) and Learn copy kit, rules, agent and memory files to `~/.claude/switchboard/snapshots/` before editing them; History lists them with Undo, which snapshots the current state first
- Check health and Fix safe ones in Settings (hook server, hub port, kit, mods, claude and codex on PATH, MCP config)
- Daily summary and Today card show yesterday's chats, cost, approved and sent back with arrows against the day before and last week
- Saved pipelines: Save as pipeline from a stages run, seed a new Advanced chat from one; the stages skill reads a seeded run
- `.switchboard/` is excluded in git worktrees too (the exclude file comes from `git rev-parse --git-path`)
- Run indefinitely now ends with a notice naming the reason and the usage (cost and hours)
- discuss: Codex runs with `--sandbox read-only`, so the read-only discussion cannot change files
- usage-meter 0.5.2 (bundled): model-learn.json is reread and merged before each write, so two chats finishing together no longer drop an entry

## 0.21.68

- Hook forwarder v12: Bash is no longer auto-allowed in a chat running in default or plan mode, or while Ask before actions is on; before, Switchboard's hook allowed every Bash call, so those prompts never showed
- bash-approve 0.1.3 (bundled): turns a Bash ask into an allow only in acceptEdits, auto, dontAsk or bypassPermissions mode
- done-check 0.1.8 (bundled): python and node one-liners that write files count as edits; reads and writes outside the repo do not
- model-bench: role runs are sandboxed (Codex workspace-write, Claude acceptEdits with the Bash sandbox), so a bench agent cannot write outside its run folder

## 0.21.67

- Set up now installs done-check and bash-approve, which the rules already promised: a fresh machine gets the finish hold and the Bash guard (bash-approve still honors Ask before actions)
- Every repo Switchboard lists gets `.switchboard/` in .git/info/exclude, not only Advanced mode projects
- Codex chats get the phone push from Switchboard when they finish, and the Codex tool map says to skip the push step and that request_user_input is a fallback taking title and options
- ask-server comment lists the Codex tools correctly
- ask-server takes the Codex thread id from each call before CODEX_THREAD_ID, so a server started from inside another Codex shell files questions under the right chat
- done-check 0.1.6 (claude-mods, bundled): files written by shell commands (redirects, tee, cp/mv, sed -i, apply_patch) count as edits; writes outside the repo or under .switchboard/ do not; hook-refused calls are neither edits nor checks; a turn that launched background agents is waiting; a chat that edited and checked but stops without the aar, standup and Approve question is held once to finish (main chat only); the hold cap counts per prompt; Windows paths and Codex patch moves and async asks are read right

## 0.21.66

- Run indefinitely switch moved out of the Tools popover into the chat header, next to Terminal, so it is always in view; hover it for the status line

## 0.21.65

- Codex questions go through Switchboard's ask tool (Codex only allows request_user_input in Plan mode): shown on the card and phone, answered there, and an Approve answer closes the chat like Claude's. The ask server reads the Codex thread id from the MCP call and skips Codex's own dialog, which declined under the bypass flags
- Codex chats keep Switchboard's title (saved in codex-titles.json), and their terminal ties to the chat by first message, not display name, so Approve closes it again
- Codex chats get what Claude chats get at start: persona, accounts and tools notes, the to-do env, and New chat's Wait on
- Run indefinitely works on Codex chats: the next round is typed into the chat's terminal when its turn ends, with the usage-meter's stop rules
- Codex guard hooks (claude-mods kit) also run account-guard, phone-mode, paid-guard and tab-close, and treat the Switchboard ask tool as the question tool

## 0.21.64

- Codex chats get names on the board: Codex's own thread title, else the first real message (the AGENTS.md and environment injections are skipped)
- Codex closing question: an "Approve" answer to request_user_input closes the chat and its terminal, read from the rollout since Codex fires no hook for it (plain and exec code mode)
- Ended Codex chats leave the board: archived once their terminal exits, or after 2h quiet with no running terminal; a resumed one comes back
- ~/.codex/AGENTS.md ends with a Codex tool map (request_user_input, spawn_agent, skills under ~/.agents/skills), so Codex asks the Approve question with its own tool
- Rules sync keeps a newer rules copy even when its text matches

## 0.21.63

- Codex chats: Approve closes the terminal and the message box types into it after a window reload too; the tie now falls back to the saved terminal memo, as Claude chats do

## 0.21.62

- Closing question gate: no longer looks for the standup text. Claude Code leaves some assistant text out of the transcript (the standup printed just before the question among them), so 0.21.61 refused a chat that had done both. The aar check stays

## 0.21.61

- Closing question gate: a chat that changed files and asks "Approve this chat as finished?" before it ran the aar and printed a standup with For you and Left gets the question refused, with "Run the aar skill and print the standup (done, for you, left, risks) before the Approve question." Only the turn since the last typed prompt counts; chats that edited nothing skip it

## 0.21.60

- New chat, Related: links, filler words (please, sure, these, ask questions...) and the project's own name no longer count toward a match; a 28-day replay showed every 0.2 hit on typed prompts came from them

## 0.21.59

- model-bench: role runs skip prompts, so they now get only the Claude and Codex sign-in variables; other tokens, keys, passwords and AWS variables are left out of their environment
- Codex meters stay after the Codex chat goes quiet: the last Codex limits are kept in ~/.claude/switchboard/codex-limits.json until their window resets, apart from Claude's kept limits and never in a pause decision
- Codex guard hooks (claude-mods kit): the installed copy in ~/.codex/switchboard-guard rebuilds itself on its next call when a file in the repo is newer, so mod edits reach Codex without rerunning setup

## 0.21.58

- Codex usage meter: Codex chats feed "Codex 5h" and "Codex week" meters from the rate limits in their rollouts. They stay apart from Claude's: they never pause chats, hold auto-start or Learn, or land in limits.json
- Codex chat model and effort: two Settings rows after Lead effort. Default leaves config.toml in charge; a pick adds -m and -c model_reasoning_effort to new and resumed Codex chats
- Codex guard hooks (claude-mods kit): setup installs a plain JS copy in ~/.codex/switchboard-guard, so the hook runs on any Node and survives the repo moving; if its mods fail to load, a built-in list still refuses the worst commands

## 0.21.57

- Open terminal on a chat with no terminal: a chat whose process is gone (killed with no SessionEnd), or that is no longer listed, moves to History as ended instead of sitting on the board as idle, and the toast says so; resuming it brings it back. A running chat started in a plain terminal is found by its pid, and one in another window is shown there. A Codex chat is only warned about, never archived, since a quiet one may still be open. Before, the button did nothing
- Memory health reports supersede loops (`loops`: groups of notes whose supersedes edges run in a circle), counted in the Memory view's health line
- New kit skill memory-fix: a script applies the safe repairs (MEMORY.md drift, superseded notes to archive/, unambiguous dangling links) with backups in ~/.cache/memory-fix, then lists the issues that need judgment; the aar skill points at it
- Learn automatically: after improve-system, a sleep-time memory consolidation pass (after Letta) reads every project's memory notes and proposes rewrites and merges, never edits. It runs as a headless job with no shell and writes only its proposals file, which Switchboard keeps in ~/.claude/switchboard/consolidate/ and files as one to-do; the memory-fix skill holds its instructions
- aar skill: memory-gold.mjs scores a gold set of hub_recall queries (~/.claude/memory-gold.json, query plus expected note slugs) against the running hub; `--save` before a note merge or archive, `--base` after lists lost hits and exits 1

## 0.21.56

- Run indefinitely: a switch on each Claude chat (chat view, under the message box; a tag on its card). On, the chat gets one prompt to ask all its questions in one round, then audits, fixes and checks in rounds with no more questions, until it ends an answer with `Run indefinitely: done`. The flag is kept in the chat's saved profile and in ~/.claude/switchboard/indefinite.json for the usage-meter mod, and follows a handoff to the fresh chat

## 0.21.55

- Set up registers the Codex ask entry with --codex, and re-registers an older entry that lacks it. Without the flag Codex never had chats_check, chats_wait, hub_ask or hub_recall, so the 0.21.53 wait fix could not work; run Set up once to repair an existing install

## 0.21.54

- Skill routing: chats loaded about 200 skills, past Claude Code's listing budget (1% of context), so most descriptions were dropped and chats could not tell when to use a skill. New chats now start with marketing-skills, aws-core and bland off (about 66k of 111k description chars). Smart turns one on from a goal or first message that names its field (AWS service names, Bland pathways, marketing terms such as SEO, cold email or competitor research), and the tools note names each off bundle so tool_on finds it. Every chat's settings also raise skillListingBudgetFraction to 0.02, written again on resume
- Settings, Installed: the sweep's Needs review list and counts skip records for tools no longer installed or for an older plugin version
## 0.21.53

- A Codex chat can be told to wait on another chat (card link and the Wait for picker): it calls chats_wait through the switchboard MCP, which it has had since 0.21.x. The old refusal said it had none. A new Codex chat still cannot start with waits, since its id is only known once it runs
- Checked the cross-chat edit guard against Codex's PreToolUse format: it already answers hookSpecificOutput with permissionDecision deny, and apply_patch paths (including Move to) are caught, so no change there
- discuss tool and POST /hub/discuss: a chat's AI asks the other one (Claude or Codex) headless and read-only in the chat's folder, a few rounds, ending with Agreed on / Disagreed on lines (discuss.ts)
- Sign in to an AI opens its terminal at the project folder and refuses an AI with no sign-in command; sign-in state is read again when the terminal closes (codex-login.ts)
- New chat AI pick Auto: the project's Jev route preset labels the task with a role (a word table when Jev is unsure or off), code roles go to Codex and the rest to Claude, and a notice says which and why (picker.ts)

## 0.21.52

- qa-codex runs gpt-5.6-luna at high effort: it scored 100% on the qa bench (q1, q3) against 88% for gpt-6-luna@high, with half the tokens. engineer-codex stays on gpt-6-luna@high (99% on t12, t13, p2)

## 0.21.51

- Set up installs the Codex plugin for Claude Code (openai/codex-plugin-cc), so every chat has /codex:rescue, /codex:setup and the codex-cli-runtime skill. Claude only: the Codex mirror skips it

## 0.21.50

- Approve closes chat terminals that came back from a window reload with the warning icon: VS Code restores their name and icon after the open event, so they were taken for user terminals and left open. Each sync now claims them back

## 0.21.49

- Transcripts: one bad line no longer drops the rest of a read; null content blocks and tool calls without input are skipped; a watcher that errors closes and is set up again
- Hook server: refuses a non-loopback Host; uploads that fail answer 500 instead of hanging; bodies are read as bytes, so text split across chunks stays intact
- Changes view says why it cannot read a folder instead of staying on Reading; diff cards keep their open file per chat
- Today: no duplicate row keys; 999,500 tokens reads 1.0M, not 1000K; CI jobs that ended neutral or stale show grey, not failed
- AWS delete refusals match the command, not its text

## 0.21.48

- Role models: the Codex roles (engineer-codex, qa-codex) get a Codex model and a Codex effort pick in Settings, Models, written as -m and -c model_reasoning_effort flags on the role's codex exec line. Default drops the flag so config.toml decides. A Codex pick is not an edit, so kit updates still reach the role and keep it. Before, their row only changed the Sonnet relay's model

## 0.21.47

- To-do without git: two windows writing one list take a lock, so neither loses an item; a window that stalls past the lock's timeout re-reads instead of overwriting
- A To-do chat stays off Remote Control even when writing its settings fails
- Old first-message temp files (a day or more) are swept once per window
- Browser app: a loopback request must also carry a loopback Host; -p/--port no longer swallows the next flag and a bad port says so
- Ship card: a failed commit no longer clears the form on the next good result; branch links escape #; the memory view shows an error instead of hanging; Add tenants no longer reuses a hidden Chrome pick

## 0.21.46

- Ship and Commit record only the files you confirmed; a pre-commit hook's fixes reach the real index, a refused hook leaves staging as it was, and a partial staging on an unpicked file survives
- Discard works on a newly added file; git exiting early no longer throws in the extension host; a failed git status shows an error instead of a partial list
- AWS sign-in keeps the real error when it cannot start; closed Codex terminals are let go
- New chat: Escape, Merge back and Start as one keep edited split asks; the first ask gets focus instead of Start all
- Layout: Agents board zoom (+, -, Fit) and its keys sit in the canvas corner like the Code map's, 44px on touch and shown on phones; Needs you leads the header; the map's title and Find share the mode bar; map details keep Close in view; phone New chat is a pill above the usage strip; tool chip tips show on tap and Tab
- Header New repo removed (New chat's "New GitHub repo..." does it); tabbing the agent list no longer opens each panel; phone mic turns off if recording fails
- Kit rule: each chat writes a plain change note in .switchboard/changes

## 0.21.45

- chat-wait 0.2.2: a waiting chat cannot end its turn while a chat it waits on still works (told to call chats_wait again, up to about three hours; never during a usage pause or limit), and once they finish the stop hands it their reports and ends the link, even when the target closed or handed off
- chat-wait: a target with subagents or shells still running counts as working; one at its Approve question or approved counts as finished clean, so the waiter continues instead of stopping to ask

## 0.21.44

- Approve after a reload: a revived terminal whose old chat ended and now runs a new chat belongs to the new one, so approving the old chat leaves it open

## 0.21.43

- Approve closes chat terminals after a window reload too: each chat terminal is remembered by its shell pid in workspace state, so a revived one keeps its chat and first-seen time (before, it came back unbound and looked newer than the approval)

## 0.21.42

- New chat, Split asks: a message with several unrelated asks shows a split preview on Start (one editable card per ask, Start all or Start as one). Chats from one split share a group. One quick model call, skipped when the text holds a secret; works from the phone through POST /hub/split
- New chat, Related: "Related: <chat>" with Send there when a live chat in the project looks like the same work (TF-IDF, threshold 0.2). On a split card it sends that ask and keeps the rest
- New chat, Wait on: a chip row of live chats; the new chat waits on the ones picked, new repo and clone too
- Map: waiting yards say "Starts after X" or "Waiting on X" in their own tag, split siblings get a cord and "Split with X"; Code view shows the group in a part's chat list

## 0.21.41

- Role models: every role starts on its agent file model; usage-meter no longer forces its own table. Engineer now defaults to Sonnet
- Smart model switch (Settings, Models): a role that redesigns the same component three rounds and still fails moves up one model (Haiku, Sonnet, Opus, Fable) for that component, remembers the fix per project in a memory note, and drops back after 5 clean runs. Debugging never counts. A raised role shows its reason and a Reset in its row
- Advanced mode (Settings, Chats, per project): big tasks run as numbered stage folders in .switchboard/stages (kept out of git) with the new stages skill. The chat card shows the current stage and opens into the list, with Looks good and Redo between stages

## 0.21.40

- Map, Agents: a chat is its AI's realm, lead included. Claude and Codex chats look the same; only work handed to another AI (engineer-codex, helpers) docks a separate realm. Each yard keeps a free slot for its landmark so it never covers a desk
- Map, Agents: tapping an agent opens its details on the map instead of the terminal. Live chats get a reply box (no focus change), a question without choices is answered there, research stays open after it starts, notice rows have Done. Open terminal is still in the panel
- Map, Code: rebuilt as an architecture map. The app's parts in flow order with import links routed around boxes; a part's panel lists what it is, files, connects to and used by, the chats that changed it, the skills, plugins, mods and roles they used, and memory notes that name it

## 0.21.39

- Role models: qa and designer default to Sonnet after the model bench (qa 94% vs Opus 93% at under half the cost; designer 92% vs 88%). Engineer stays on Opus
- model-bench: the judge no longer stalls on an unread stderr pipe, and a stuck judge call retries after 4 min instead of 15

## 0.21.38

- Approve: the closing question answered from Switchboard (phone or panel) is taken again; the tap marked the chat working first, so the Approve was refused and the chat never closed. A refused Approve is also written to ~/.claude/switchboard/approve.log with its reason, so it survives a reload

## 0.21.37

- Memory: notes in a project's memory/archive/ folder are read as superseded history; links to them still resolve, but they never show in the health line (broken links, unlinked, superseded, stale, contradictions). Their own supersedes and contradicts no longer touch live notes
- Smart switch: a plain claude chat started in the wrong project's terminal is checked on its first prompt; when it clearly belongs to another listed project, it closes and starts again in that project's window with the same prompt. Named chats, Codex, slash commands, pasted images and folders outside a listed project stay put; the prompt is also left on the clipboard in case the start fails
- Settings: Test models button in Role models starts a chat that runs the new model-bench skill (each role on every Claude model over hidden-test tasks, suggests the cheapest model within 5 points of the best)

## 0.21.36

- Auth0: a sign-in adopts a hand-added login whose dashboard url names the tenant, so one tenant never shows twice

## 0.21.35

- Auth0: Sign in runs `auth0 login` (device login, page opens in the picked Chrome profile behind the front window); its tenants become saved Auth0 logins with a domain and a Signed in, Expired or Not signed in chip, checked on the AWS cadence. Hand-added logins and emails stay; tenants the CLI drops show Not signed in. The CLI part is one table entry per app, so other apps keep opening their URL
- Auth0: a tenant whose check gets no answer keeps its last status (none for a new one) instead of reading Signed in; one auth0 login runs at a time, and Sign in reads Waiting for Chrome until it ends

## 0.21.34

- AWS account name prefers the account alias, then the company name, then the contact name
- account-guard 0.1.3: also checks commands run inside bash -c, sh -c, zsh -c and eval strings

## 0.21.33

- Accounts: no default anywhere. Make default and the Default chip are gone, any AWS profile can be deleted, and a project picks a specific web login or Not used (old Default picks read as Not used)
- AWS: adding a name that already exists signs in again under it with the new region, so a failed sign-in can be retried; Rename renames the profile in ~/.aws/config (backed up first) and moves its project, Chrome and session picks
- AWS: after a sign-in the account name and email come from AWS (alias or contact name, primary email) when it answers; rows show the profile name, then the email, then account name and id; Set email covers accounts AWS gives none for
- Web logins: an optional email, set when adding or from the row menu, shown under the login name
- AWS: no hidden '*' profile for folders without a pick (the browser '*' fallback stays); an email AWS returns wins over a typed one; Rename refuses a name ~/.aws/credentials already has and moves a typed email kept by name; config backups made in the same second no longer collide

## 0.21.32

- Projects: a folder opened under another case (switchboard vs Switchboard) lists once
- Accounts: AWS is optional per project like a web app (Not used until picked); profile rows lead with the profile name and show the account name beside it; Rename is now Name account
- AWS: signing in again as the same user overwrites instead of stacking copies; a new profile that turns out to be the same login folds into the existing one, and Make default keeps no backup of the same login

## 0.21.31

- Set up installs the new tab-close mod: when a chat or role subagent ends its turn, its agent-browser sessions are closed, and an open Playwright browser, Chrome MCP tab, Scrapling session or Firecrawl browser holds the stop once until the agent closes it
- New chats: when no window has the chat's project open, Switchboard opens one and starts the chat there, instead of in the window you clicked from (not for a folder a move is closing)

## 0.21.30

- Folder moves: a window closes itself when ~/.claude/close-window-for-move names its folder, so the agent-flow to switchboard move only waits for chats in that folder instead of quitting VS Code once every project is quiet

## 0.21.29

- Plan page: the To-do project follows the VS Code window used last, in the browser and phone app too; a hand pick holds until another window gets focus
- To-do: after an add, the box stays under the finger through every update that grows the page above it (new row, chain chips, Running row), and lets go once you scroll or click

## 0.21.28

- New repo: a window open on a parent folder (all of ~/Documents/GitHub) no longer takes the new repo's chat; it waits for the repo's own window, also when the click came from that parent window

## 0.21.27

- Brief: the files another chat holds now read "was editing at chat start (check it is still in ListAgents before waiting on it)", so a chat no longer waits on a holder that already ended

## 0.21.26

- Closing question: while a chat asks "Approve this chat as finished?", Needs you and the chat view show its done-check stamp under the question (green Verified, or red Unverified with what is missing), same as the done cards

## 0.21.25

- Chat view: a Codex chat's Transcript tab labels its replies Codex instead of Claude, and keeps the label after Load earlier

## 0.21.24

- Any VS Code family editor: Switchboard names the editor it runs in (Cursor, Windsurf, Antigravity, VSCodium, Insiders) in its notices, buttons and sign-in pages, finds pending reloads in that editor's extensions folder, and the stuck check knows each editor's helper process
- Without an editor: the browser app serves chats, projects and to-do from its own hub when no editor window is open, starts New chat in tmux or a background Terminal window, and gets hook events from chats in any folder; it hands back to the editor once a window opens
- toolchain skill: reads a repo's manifests (JS/TS, Python, Go, Rust, Swift, Java/Kotlin, Ruby, PHP, .NET, C/C++, Dart/Flutter) and prints its test, lint, typecheck and build commands with the matching ecc-agents reviewer; engineer, qa and the lead use it when a repo's CLAUDE.md names no checks

## 0.21.23

- Approve closes the chat's terminal even when the last turn runs past a minute (done-check hold, aar, standup) or a background job is still tracked: every window closes a Switchboard terminal once its approved chat has exited
- New repo button beside New chat: name the repo, pick Private or Public, say what the chat should do; gh makes the repo, it opens in its own VS Code window and the chat starts there
- Links open in the folder's Chrome profile: hub links, git PR pages and the browser app use the folder's Chrome pick (Sign-ins, else the default) instead of Chrome's last used profile
- Board: Claude realms use their own clay palette, and each AI pavilion stands its landmark (Claude spark, Codex monolith, Jev balance, Gemini spires)

## 0.21.22

- Learn automatically: scheduled improve runs save memory notes too; they write a staged copy of the Switchboard project's memory that is copied back, the same way the aar does
- Research island on the board: click it, type any question, and it starts a Claude chat that runs the deep-research skill on it (always present, like the Jev and Gemini islands)
- harden skill: a /harden skill that runs BLA (bla-agents) to harden a build against AI reverse-engineering before a release; the Ship card's Harden build check already runs it on a throwaway copy

## 0.21.21

- Learn automatically: scheduled aar runs save memory notes again; they edit a copy in ~/.cache/switchboard/learn and Switchboard copies new and changed notes back to the project (headless claude refuses writes under ~/.claude)

## 0.21.20

- To-do redesign: an Autopilot bar on top says what is running, what starts next and why, with a To-do 1, 2, 3 chain; then Only you can do these, For your OK (Approve, Dismiss, Approve all), Running, a numbered Queue with Next and Start now, and the add box
- Auto-run next and Pause per project: Pause holds new starts while running chats finish; a project you never set follows Settings, Auto-start chats
- Auto-start no longer waits for other chats in the project, only for a running to-do chat, and starts the next item when that one is done
- Chats started from the to-do are named "To-do N: ..." and keep it through handoffs; the new todo-band mod shows To-do N, auto, the item and who left it above the prompt, also after a resume or handoff
- Blocked items, items behind your own step and items whose chat stopped show as held, never as Next; a stopped one waits for Start again
- Plan page: an Autopilot card with one lane per project (done, running, next, queued, paused)

## 0.21.19

- Approve closes chat terminals again after a window reload, including ones named "Claude Code: ..."
- New chat: the Project list has New GitHub repo (private unless you pick Public) and Clone from GitHub; Start makes or clones it in ~/Documents/GitHub and opens the chat there, and a failure also goes to your phone

## 0.21.18

- A chat approved through its closing question now exits and its terminal closes at the end of that turn; before, the answer arrived mid-turn and the chat stayed open
- Approving a chat clears the requests Jev had marked as missed for it from Suggested, so the Plan page stops listing work that was already accepted as done
- Now: each Your OK row folds open the chat's changes with their diffs above Approve, Needs you rows carry their project's color, and every Jump or Open chat button names its chat for screen readers

## 0.21.17

- Layout: chat names show in full (the cache warm chip moved to the meta line), project headers wrap on a phone, the tab bar drops the brand so Settings and 3-digit badges fit, orbit labels hold their side and Done has its own corner, Find keeps the version chip, Ship keeps file names, and Code map opens fitted to a narrow width, and on a phone the chat menu keeps a 16px gutter, the orbit turns square, Jarvis and terminal rows no longer push the page sideways and Memory filter chips wrap

## 0.21.16

- Map, Code: big repos open as a folder tree (top level first, open one level at a time), search finds any file and opens its folders, file hits show their folder, dense import lines rest until hover, the legend sits below the map, keys work on open and Esc clears search first; opens on this window's project
- Map, Code data: full folder paths, chat names from Claude's titles instead of raw prompts, the map is cached per 5 minutes, and folders that only hold other projects are skipped
- Map, Agents: Fit frames the court beside an open card and fills a phone, labels stay on stage, counts use chats and say done, Treasury ignores old backup profiles and unset keys, empty pavilions say No chats yet
- Map, Memory: project tags always show, rows and cards name their project, superseded notes are marked and sorted last, health counts filter the list, the graph centres on screen; fake broken links from code spans and archived bench or temp chats are gone
- Headless `claude -p` runs (bench runs) and Remote Control's unused standby session no longer show as chats

## 0.21.15

- Chrome pages open in a default profile (`*` in the browser picks) for folders without a pick of their own, instead of Chrome's last used one
- Chat waits: a wait ends as removed only when you unlink it; links survive a window reload, follow a handoff to the next chat, and a chat at its usage limit still counts as working
- A waiting chat that gets a failure or question asks you with a question card, and repeated waits no longer show as a stuck loop
- A new chat started while its project's window reloads opens in that window
- An update registered after its folder appears, or a stray folder from a failed install, no longer leaves a window on the old version
- Keep awake only trusts its own caffeinate, so a reused pid never shows it on or stops another app's
- History keeps the Verified or Unverified stamp when a chat is approved through the closing question
- The git guard stays on its process markers alone, as in 0.21.12

## 0.21.14

- Code map: the footer hint sits on its own backdrop so it no longer runs over the bottom row

## 0.21.13

- Code map: a big map grows downward to fit the screen width at a readable zoom, scrolls with the wheel, and keeps its changed-by and import lines visible at rest

## 0.21.12

- Maps: Code map hides chat-to-tool lines on big maps until a node is hovered, shows each tool's chat count and opens at a readable zoom; Agents board yards with subagent realms sit next to their window instead of far out
- To-do keeps no hand steps: For you lines stay on the chat card, chats open the page for them, and old Finish up rows are cleared
- The done-check ticks any open item or tray line a chat's work covered, also when the chat ends without Done
- System notices pasted into a turn (idle notices, stopped jobs, quiet subagents) no longer land in the tray
- Usage pause: Resume holds across a window reload and in every other window; auto start, the open-tasks nudge, handoffs and the stuck auto-fix wait while chats are paused, and auto start comes back once the limit resets
- done-check lets a paused chat stop, and cache-keeper sends no pings while paused
- Updates reload a window only after 2 idle minutes (no typing, no Commit or Push running, no open question); Install clicked in a window still reloads it at once
- Open questions survive a reload: they are kept on disk and the ask tool posts again to the same project's window
- Keep Switchboard app running off now holds on every window load; the keeper waits longer each time the app crashes soon after starting
- Ask before actions brings back Bash prompts too; phone mode places one call per question, and the closing Approve question works with phone mode on
- Bundled rules and mod hints read gender neutral

## 0.21.11

- Learn finds the clone as switchboard or agent-flow, so it keeps running after the folder rename

## 0.21.10

- Map cleanup: Agents is the board's name (Celestial Court stays as a subtitle), Back is the one exit in every mode, Esc closes a card first, and + - 0 zoom and fit in Agents, Code and Memory
- Code drops its Code/Work/Both switch for the legend chips, Enter in search opens the first match and an open folder lights its files, and the phone list gets the same chips; Memory fills the screen on open and Rules reads CLAUDE.md files
- Agents strip: Commit lands on the git card and Usage shows both windows in its tip
- A finished update reloads every window by itself, no Reload ready click; terminal chats keep running
- Chats in the temp folder itself (Codex runs in /private/tmp) stay out of the lists, and temp folders leave Connections

## 0.21.9

- New layout: a labelled rail of pages (Now, Chats, Plan, Ship, Settings, Map), a status bar with usage, Keep awake and Call me, and Cmd+K Find; on a phone or narrow sidebar the pages sit in a bottom tab bar
- Now page: Needs you, Working and Done today side by side; the project filter has an All projects chip and filters the whole page
- Needs you reads as one list: one heading, "Ready for your OK" with Approve first, answer choices in one row
- Map is one view with an Agents, Code and Memory switch and a Back button
- Write commit message on Ship fills the repo's Source Control box from every changed file; secret files are named, never sent
- "Ready for your OK" everywhere a finished chat waits on you; the ship chip leads with Push so a narrow status bar keeps it
- Set up installs agent-browser and agent-desktop (skipped when already installed); rules pick the cheapest tool first, CLI before MCP

## 0.21.8

- Phone alerts: the phone web app can be added to the home screen and turn on Phone alerts in Settings, Chats; the AWS sign-in heads-up now reaches the phone as a push, about 30 minutes before the session ends
- Pushes only go to Apple, Google, Mozilla and Microsoft push services, and only a signed-in phone or the Mac can subscribe

## 0.21.7

- Git guard: Switchboard installs a pre-commit and pre-push guard in every project repo it lists, refusing commits and pushes from Claude and Codex chats; the Commit and Push buttons, the phone and your own terminals still work
- Chat terminals carry SWITCHBOARD_CHAT so Codex chats are covered; a repo with core.hooksPath or its own hooks is left alone; uninstall removes only Switchboard's guard; a hook symlink is never written through
- Switchboard's own git ops drop chat markers, so Commit and Push still work in a window opened from a chat

## 0.21.6

- One layout: Classic is back as the only design, cleaned up; the Desk layout and its Settings switch are gone
- "Ready to approve" everywhere a finished chat waits on you, with a yellow warning when a request is not covered; Today's Done counts only approved chats and "Your moves" lead with what to do
- Ask cards name the asking chat, show option descriptions, wrap on phones and send every answer path; multi-question cards say how many
- Finished and stopped chats say what they did and what is left; clearer ages ("last reply 21 min ago") and counts that agree
- Celestial Court: a Claude realm for Claude's agents (Codex-led chats too), a memory library with health warnings, and places for keys, to-do, Remote Control, learn runs, projects and uploads; labels never cover each other, and 90 chats lay out
- MiroFish card: rounds, elapsed and estimate, report stage and a preview while a crowd run works; saving the OpenRouter or Zep key fills MiroFish's .env
- Temp chats and learn runs stay out of the chat list and Flow tabs; the stuck watcher leaves quiet dev servers alone

## 0.21.5

- Phone over Tailscale: works on plain http (no Secure cookie there) and the short MagicDNS name; Send, Commit, Push, uploads and the mic all pass from the phone
- Source Control: one pending message per repo grows with every finished chat until the commit, an "Also changed" line names files no chat covered, every change is included by default, Push shows after Commit and after a reload
- Busy bar across the top and a pulse on the pressed button while a command runs
- Nothing an agent or timer does takes focus; updates show Reload ready instead of reloading
- No permission prompts in any start, resume or handoff path; Settings toggles bring them back for Claude or Codex, and Keep Switchboard app running turns the keeper off (with crash backoff)
- To-do: Needs you, Up next, From finished chats and Finished; 5 s Undo (Undo all), 2000 character items that expand on click, no duplicates or chatty asks, a note when old items are cleared
- Flow map: code, work (chats, skills, plugins, mods) or both, with a plain card per part; only known project folders
- Drafts: the message box, New chat, the to-do add box and the commit message keep what was typed
- Usage limits: the meter says Limit reached with the reset time instead of no data; at 99% (Settings) chats pause and resume on their own after the reset
- Spend limits in Settings: tools with prepaid credit run without asking, Gemini runs under a monthly cap, AWS and Stitch still ask
- Needs you strip, Ready to ship chip and the next to-do on the home screen; the open chat survives a reload
- Codex Transcript tab, Jarvis mic on the phone, Test anti-copy hardening (experimental, off), About and credits, skill sources by author, deep-research skill
- Sweep: a triage verdict (APPROVE, CAUTION or REJECT with a why) shows a Reviewed badge with the why as its tooltip until the files change; holds still need Approve, and an approval for older files brings back Review and its Approve button; Settings counts reviewed items
- Chats: idle chats never auto-hide; Archive in each card's menu; History becomes Archive with Bring back and Resume
- Codex chats start and resume with --dangerously-bypass-approvals-and-sandbox, so Bash never asks
- Stuck items: quiet subagents, idle background jobs, CPU and memory hogs in a chat's process tree
- Board page with the Silkscreen font and the journey-west pixel skin
- Set up adds ecc-agents, crowd-ab and self-improve, plus pixelfx, humanizer, last30days, archify, diagram-design, find-skills, Scrapling and Agent Reach; own skills mirrored to ~/.agents/skills for Codex
- Uninstall removes Codex hooks.json entries and the switchboard-app folder
- Renamed to Switchboard: switchboard-app and switchboard-web packages, SWITCHBOARD_* env vars (AGENT_FLOW_RUNTIME still read), discovery folder ~/.claude/switchboard-app
- repo-rules: decodes \u and \x escapes before the hub check, and refuses hub posts whose body or URL is built at run time ($(...), backticks, $VAR, @file, a variable holding /hub/ when the command posts); reading hub state through a variable stays open, and a 50 KB command checks in under a millisecond
- Calm desk: header cut to Find, meters, Push, New chat and one menu; Jarvis and the project filter inside Cmd+K; chat list grouped as Needs you, Ready to approve, Working, Idle and History; Tools behind a button by Send; Today, To-do, Git and Dev servers in a right drawer; Classic unchanged
- Board: Celestial Court with chat courtyards, a petition path the camera follows, and realms for Codex, Jev, Perplexity and Gemini work beside the chat that started it
- Chat-wait: a chat can wait on another (Wait for... in the chat menu, chips, an Orbit arc, auto links when two chats edit one file) and continues when the other ends clean
- Usage pause: frosted pause banner with Resume now and Cancel; a hand resume is no longer undone by the next tick
- Phone mode: Call me rings the phone for questions, stuck, done and pause events, one call per machine
- Codex roles: engineer-codex and qa-codex run Codex with full bypass, no second chat; apply_patch edits go through the same-file guard
- Learning ready card: self-improve wins wait for Approve or Discard, applied only against the candidate's hash
- Keys: Perplexity and Zep with live checks; saving OpenRouter or Zep fills listed MiroFish projects' .env without overwriting set values
- Temp chats and learn runs hidden from the hub; Approve only on the kit closing question; reaped pids checked by start time
- Commit cleaner strips invisible watermark characters from added lines and the message

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
