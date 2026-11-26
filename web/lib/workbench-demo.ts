// Sample Workbench data for the demo; workbench-store.ts plays Apply, Skip and Undo on it.
import type { ActionState, Change, ReportAction, SuggestedChanges } from './workbench'

const keyOf = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)

const MIN = 60_000, H = 3_600_000, DAY = 86_400_000
export const DEVICE_LINE = 'MacBook Air M2 · 16 GB · 67 GB free · macOS 26.4'
export const DEMO_DEVICE = 'MacBook Air M2'

const act = (title: string, area: ReportAction['area'], detail: string, undo?: string, ask = false, cites: number[] = []): ReportAction =>
  ({ key: keyOf(title), area, ask, title, detail, undo, cites })

export function seedSuggestions(now: number): SuggestedChanges[] {
  const s = (report: string, question: string, project: string | undefined, ago: number, actions: ReportAction[]): SuggestedChanges =>
    ({ report, question, project, at: now - ago, actions: actions.map(a => ({ ...a, state: 'new' as ActionState })) })
  return [
    s('r4', 'Why does the first shell prompt take 1.4 seconds?', undefined, 2 * H, [
      act('Cache zsh completions', 'dev', 'Adds a cached compinit to ~/.zshrc so completions rebuild once a day, not on every shell. The prompt drops from 1.4 s to about 0.3 s.', 'cp ~/.zshrc.bak-wb ~/.zshrc', false, [2, 3]),
      act('Load nvm only when called', 'dev', 'Wraps nvm, node and npm in a lazy loader in ~/.zshrc. Saves about 0.4 s per shell.', 'cp ~/.zshrc.bak-wb ~/.zshrc', false, [4]),
      act('Keep node_modules out of Spotlight', 'mac', 'Adds a .metadata_never_index file to 14 node_modules folders under ~/Documents/GitHub. Stops mdworker from eating CPU after installs.', 'xargs rm < ~/.claude/switchboard/adjustments/spotlight.list', false, [5]),
      act('Clear Xcode simulator caches', 'mac', 'Deletes 18 GB under ~/Library/Developer/CoreSimulator/Caches. They rebuild on the next simulator launch.', undefined, true, [6]),
    ]),
    s('r1', 'Which local vector store fits a VS Code extension that cannot ship native modules?', 'Switchboard', 4 * MIN, [
      act('Try sqlite-vec in the memory graph', 'project', 'Starts a chat in Switchboard that adds the WASM SQLite build and a vector table next to the note rows. Nothing outside that repo changes.', undefined, false, [1, 2]),
      act('Pin Node 22 for extension tests', 'dev', 'Writes 22 into ~/.config/fnm/default so the extension host tests match the shipped runtime.', 'fnm default 24', false, [3]),
      act('Add a vector note to the memory skill', 'kit', 'Appends 6 lines on sqlite-vec limits to ~/.claude/skills/memory/SKILL.md.', 'cp ~/.claude/skills/memory/SKILL.md.bak-wb ~/.claude/skills/memory/SKILL.md', false, [1]),
    ]),
    s('r2', 'Where do Safari and Chrome still differ on cross-document View Transitions?', 'Armasu', 26 * H, [
      act('Show the Safari Develop menu', 'mac', 'Sets IncludeDevelopMenu for Safari so Web Inspector can open on the test pages.', 'defaults write com.apple.Safari IncludeDevelopMenu -bool false', false, [1]),
      act('Install the Playwright WebKit browser', 'dev', 'Downloads about 90 MB to ~/Library/Caches/ms-playwright for the Safari checks.', 'npx playwright uninstall webkit', false, [3]),
      act('File the nested group bug with WebKit', 'other', 'Posts a reduced test case on bugs.webkit.org from your account.', undefined, true, [4]),
    ]),
    s('r3', 'How should an agent fan-out be paced under a rolling 5 hour usage window?', undefined, 3 * DAY, [
      act('Cap live subagents at 6', 'kit', 'Edits ~/.claude/rules.md so no brief fans out past 6 workers at once.', 'cp ~/.claude/rules.md.bak-wb ~/.claude/rules.md', false, [2]),
      act('Stop App Nap for Terminal', 'mac', 'Sets NSAppSleepDisabled for Terminal so long runs keep their pace in the background.', 'defaults delete com.apple.Terminal NSAppSleepDisabled', false, [5]),
      act('Add a pacing alias to the dev shell', 'dev', 'Adds a wbpace alias that prints the used share of the window.', 'sed -i "" "/alias wbpace/d" ~/.zshrc', false, [6]),
    ]),
    s('r5', 'Which Mac settings keep long agent runs alive overnight?', undefined, 5 * DAY, [
      act('Prevent sleep with a launch agent', 'mac', 'Installs ~/Library/LaunchAgents/wb.keepawake.plist, which runs caffeinate while a Switchboard run is open.', 'launchctl bootout gui/$UID/wb.keepawake', false, [2]),
      act('Reserve a fixed address for the Mac mini', 'other', 'Sets a DHCP reservation on the router so the phone link keeps its address.', undefined, true, [3]),
    ]),
  ]
}

const f = (path: string, existed = true, after = true) => ({ path, backup: existed ? 'files/0' : null, before: existed ? 'a1f3' : null, after: after ? 'c9d2' : null })

export function seedChanges(now: number): Change[] {
  type O = Pick<Change, 'title' | 'area' | 'status' | 'target' | 'why'> & Partial<Change>
  const c = (id: string, ago: number, o: O): Change =>
    ({ id, device: DEMO_DEVICE, files: [], at: now - ago, doneAt: o.status === 'open' ? undefined : now - ago + 40_000, ...o })
  return [
    c('20261124-1710-move-brew-cache-3a1f', 20 * MIN, { title: 'Move the Homebrew cache to the data volume', area: 'dev', status: 'open', target: '~/.zshenv', why: 'The brew cache was 9 GB on the boot disk.', chat: 'Workbench: Homebrew cache', sessionId: 'demo-wb-1', files: [f('~/.zshenv')], undo: 'cp ~/.zshenv.bak-wb ~/.zshenv' }),
    c('20261123-0915-pnpm-store-time-machine-7b20', 1 * DAY + 2 * H, { title: 'Exclude the pnpm store from Time Machine', area: 'mac', status: 'applied', target: '~/Library/pnpm/store', why: 'The store is 21 GB and rebuilds itself; backups were slow.', report: 'r3', action: 'exclude-pnpm-store', chat: 'Workbench: backups', sessionId: 'demo-wb-2', undo: 'tmutil removeexclusion ~/Library/pnpm/store', check: { cmd: 'tmutil isexcluded ~/Library/pnpm/store', ok: true, out: '[Excluded] ~/Library/pnpm/store' } }),
    c('20261122-1802-switch-to-fnm-92cd', 2 * DAY, { title: 'Switch from nvm to fnm', area: 'dev', status: 'applied', target: '~/.zshrc', why: 'nvm added 0.6 s to every shell start.', report: 'r4', chat: 'Shell speed', sessionId: 'demo-wb-3', files: [f('~/.zshrc')], undo: 'brew uninstall fnm', check: { cmd: 'zsh -i -c "fnm --version"', ok: true, out: 'fnm 1.38.1' } }),
    c('20261121-1130-install-ripgrep-18de', 3 * DAY, { title: 'Install ripgrep from Homebrew', area: 'dev', status: 'failed', target: '/opt/homebrew/bin/rg', why: 'Search across repos was slow with grep.', problem: 'brew could not reach formulae.brew.sh. Nothing was installed.', undo: 'brew uninstall ripgrep', check: { cmd: 'rg --version', ok: false, out: 'zsh: command not found: rg' } }),
    c('20261120-1405-dock-delay-5e77', 4 * DAY, { title: 'Remove the Dock auto-hide delay', area: 'mac', status: 'undone', undoneAt: now - 3 * DAY, target: 'com.apple.dock', why: 'The Dock took half a second to appear.', undo: 'defaults delete com.apple.dock autohide-delay && killall Dock', check: { cmd: 'defaults read com.apple.dock autohide-delay', ok: true, out: '0' } }),
    c('20261119-0950-adjust-skill-kit-c042', 5 * DAY, { title: 'Add the adjust skill to the kit', area: 'kit', status: 'applied', target: '~/.claude/skills/adjust', why: 'Reports can now record their changes.', files: [f('~/.claude/skills/adjust/SKILL.md', false)], check: { cmd: 'test -f ~/.claude/skills/adjust/SKILL.md', ok: true, out: 'ok' } }),
    c('20261118-2010-file-limit-0b9a', 6 * DAY, { title: 'Raise the open file limit for dev servers', area: 'dev', status: 'applied', target: '~/Library/LaunchAgents/limit.maxfiles.plist', why: 'Next dev hit EMFILE on the big monorepo.', report: 'r2', files: [f('~/Library/LaunchAgents/limit.maxfiles.plist', false)], undo: 'launchctl bootout gui/$UID/limit.maxfiles', check: { cmd: 'launchctl limit maxfiles', ok: true, out: 'maxfiles 65536 200000' } }),
    c('20261117-1630-spotlight-github-d3f1', 7 * DAY, { title: 'Turn off Spotlight for the GitHub folder', area: 'mac', status: 'undone', undoneAt: now - 6 * DAY, target: '~/Documents/GitHub', why: 'mdworker held a core during installs.', files: [f('~/Documents/GitHub/.metadata_never_index', false)], check: { cmd: 'mdutil -s ~/Documents/GitHub', ok: true, out: 'Indexing disabled.' } }),
    c('20261116-1205-pull-rebase-armasu-88a4', 8 * DAY, { title: 'Set pull.rebase in the Armasu site repo', area: 'other', status: 'applied', target: '~/Documents/GitHub/armasu-site/.git/config', why: 'Pulls kept making merge commits there.', files: [f('~/Documents/GitHub/armasu-site/.git/config')], undo: 'git -C ~/Documents/GitHub/armasu-site config --unset pull.rebase', check: { cmd: 'git -C ~/Documents/GitHub/armasu-site config pull.rebase', ok: true, out: 'true' } }),
    c('20261115-0840-tailscale-ssh-6c13', 9 * DAY, { title: 'Turn on Tailscale SSH on the Mac mini', area: 'other', status: 'failed', target: 'Mac mini', why: 'Reach the build box from the laptop.', problem: 'The Mac mini was asleep. The command timed out after 120 s.', undo: 'ssh mini "tailscale set --ssh=false"', check: { cmd: 'ssh mini true', ok: false, out: 'ssh: connect to host mini port 22: Operation timed out' } }),
    c('20261114-1915-trim-kit-rules-f90e', 11 * DAY, { title: 'Trim the kit rules to one screen', area: 'kit', status: 'undone', undoneAt: now - 10 * DAY, target: '~/.claude/rules.md', why: 'The rules had grown past what chats read.', files: [f('~/.claude/rules.md')], undo: 'cp ~/.claude/rules.md.bak-wb ~/.claude/rules.md', check: { cmd: 'wc -l ~/.claude/rules.md', ok: true, out: '58' } }),
    c('20261111-1100-archive-screens-4d28', 13 * DAY, { title: 'Move 2023 screenshots to the external disk', area: 'mac', status: 'applied', target: '~/Pictures/Screenshots', why: 'Freed 11 GB on the boot disk.', noUndo: 'The files moved to another disk and the originals are gone. You were asked first.', files: [f('~/Pictures/Screenshots/2023', true, false)], check: { cmd: 'du -sh /Volumes/Data/Archive/2023', ok: true, out: '11G' } }),
  ]
}
