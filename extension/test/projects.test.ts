/**
 * Projects and new chats: the project list, what a clone box accepts, and the
 * command a new chat runs.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { ask, askMode, isRepoAsk, repoPlan, chainBase, chainVersion, chatLabel, codexArgs, cloneTarget, codexNote, crossNote, freshPrompt, handoffFile, labelNote, mergeProjects, newChatCommand, nextChainName, projectName, repoTop, scriptBody, scriptLine, stillRunning, ultracodeFlags } from '../src/hub/projects'

describe('projectName', () => {
  it('names a folder by the git repo holding it, else its last part', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-repo-'))
    try {
      fs.mkdirSync(path.join(tmp, 'switchboard', '.git'), { recursive: true })
      fs.mkdirSync(path.join(tmp, 'switchboard', 'extension', 'src'), { recursive: true })
      // A worktree or submodule has a .git file.
      fs.mkdirSync(path.join(tmp, 'wt', 'app'), { recursive: true })
      fs.writeFileSync(path.join(tmp, 'wt', '.git'), 'gitdir: /x')
      fs.mkdirSync(path.join(tmp, 'plain'))
      assert.equal(projectName(path.join(tmp, 'switchboard', 'extension')), 'switchboard')
      assert.equal(projectName(path.join(tmp, 'switchboard', 'extension', 'src')), 'switchboard')
      assert.equal(repoTop(path.join(tmp, 'switchboard', 'extension')), path.join(tmp, 'switchboard'))
      assert.equal(projectName(path.join(tmp, 'wt', 'app')), 'wt')
      assert.equal(projectName(path.join(tmp, 'plain')), 'plain')
      assert.equal(repoTop(path.join(tmp, 'plain')), undefined)
      assert.equal(projectName('/gone/folder/'), 'folder')
    } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  })
})

describe('projects', () => {
  it('lists repos and Claude Code projects once each, the open one marked', () => {
    const list = mergeProjects(['/u/GitHub/Armasu', '/u/GitHub/claude-mods'], ['/u/GitHub/Armasu', '/u/Documents/CSEN122'], '/u/GitHub/Armasu')
    assert.deepEqual(list.map(p => [p.name, p.kind, p.isOpen]), [
      ['Armasu', 'repo', true],
      ['claude-mods', 'repo', false],
      ['CSEN122', 'project', false],
    ])
  })

  it('lists a folder once when a chat ran from it under another case', () => {
    const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-case-')))
    try {
      const real = path.join(tmp, 'Switchboard')
      fs.mkdirSync(real)
      const lower = path.join(tmp, 'switchboard')
      // Only a case-insensitive disk sees both spellings as one folder.
      if (!fs.existsSync(lower)) return
      const list = mergeProjects([real], [lower])
      assert.deepEqual(list.map(p => p.path), [real])
      assert.deepEqual(mergeProjects([], [lower]).map(p => [p.name, p.path]), [['Switchboard', real]])
      // A window opened under the other spelling keeps it for its own row.
      assert.deepEqual(mergeProjects([real], [lower], lower).map(p => [p.path, p.isOpen]), [[lower, true]])
    } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  })

  it('accepts GitHub repos as owner/repo or a URL and refuses anything else', () => {
    assert.deepEqual(cloneTarget('kennykennethkkang/Armasu'), { url: 'https://github.com/kennykennethkkang/Armasu.git', name: 'Armasu' })
    assert.deepEqual(cloneTarget('https://github.com/patoles/switchboard'), { url: 'https://github.com/patoles/switchboard.git', name: 'switchboard' })
    assert.deepEqual(cloneTarget('git@github.com:patoles/switchboard.git'), { url: 'git@github.com:patoles/switchboard.git', name: 'switchboard' })
    assert.equal(cloneTarget('https://evil.example/x/y'), undefined)
    assert.equal(cloneTarget('a/b; rm -rf ~'), undefined)
    assert.equal(cloneTarget('../../etc'), undefined)
  })

  it('types a short line that runs the command from a file, since a typed line past 1024 bytes is cut before the shell is ready', () => {
    assert.equal(scriptLine("/var/folders/x/T/switchboard-1.sh", 'posix'), ". '/var/folders/x/T/switchboard-1.sh'")
    assert.equal(scriptLine("C:\\Temp\\it's.ps1", 'powershell'), "iex (Get-Content -Raw 'C:\\Temp\\it''s.ps1')")
    assert.equal(scriptBody('/t/a b.sh', 'claude', 'posix'), "rm -f -- '/t/a b.sh'\nclaude\n")
    assert.equal(scriptBody('C:\\t\\a.ps1', 'claude', 'powershell'), "Remove-Item -LiteralPath 'C:\\t\\a.ps1' -ErrorAction SilentlyContinue\nclaude\n")
  })
  it('builds the new chat command, quoting the first message for the shell', () => {
    assert.equal(newChatCommand({}, 'posix'), 'claude')
    // --remote-control takes an optional name, so the name always comes first or it would swallow the message.
    assert.equal(newChatCommand({ text: "Fix the closet's filter", remote: 'Armasu' }, 'posix'), "claude --remote-control 'Armasu' 'Fix the closet'\\''s filter'")
    assert.equal(newChatCommand({ text: "it's\nfine", remote: undefined }, 'powershell'), "claude 'it''s fine'")
    assert.equal(newChatCommand({ branch: 'claude/fix-filter' }, 'posix'), "git switch -c 'claude/fix-filter' && claude")
    assert.equal(newChatCommand({ branch: 'claude/fix-filter' }, 'powershell'), "git switch -c 'claude/fix-filter'; if ($?) { claude }")
  })

  it('starts a profiled chat under its own session id, settings file and tools note', () => {
    assert.equal(newChatCommand({ text: 'go', name: 'Go', sessionId: '0f8fad5b-d9cb-469f-a165-70867728950e', settings: '/h/p.json', system: "Ask, don't guess." }, 'posix'),
      "claude --name 'Go' --session-id 0f8fad5b-d9cb-469f-a165-70867728950e --settings '/h/p.json' --append-system-prompt 'Ask, don'\\''t guess.' 'go'")
    assert.throws(() => newChatCommand({ sessionId: 'x; rm -rf ~' }, 'posix'))
  })

  it('passes the picked model and effort, and nothing when unset', () => {
    assert.equal(newChatCommand({ model: 'opus', effort: 'high', text: 'go' }, 'posix'), "claude --model 'opus' --effort 'high' 'go'")
    assert.equal(newChatCommand({ model: 'opus[1m]', name: 'Go' }, 'posix'), "claude --name 'Go' --model 'opus[1m]'")
    assert.equal(newChatCommand({ effort: 'ultracode' }, 'powershell'), "claude --effort 'ultracode'")
    assert.equal(newChatCommand({ text: 'go' }, 'posix'), "claude 'go'")
    for (const bad of ['x; echo hi', '', 'a b', '$(id)']) assert.throws(() => newChatCommand({ model: bad }, 'posix'), /model/)
    for (const bad of ['huge', 'High', '']) assert.throws(() => newChatCommand({ effort: bad }, 'posix'), /effort/)
  })

  it('ultracode at xhigh is --effort ultracode; at any other effort it is a key in the settings', () => {
    assert.deepEqual(ultracodeFlags({ effort: 'xhigh', ultracode: true, settings: '{"a":1}' }), { effort: 'ultracode', settings: '{"a":1}' })
    assert.deepEqual(ultracodeFlags({ effort: 'high', ultracode: true, settings: '{"a":1}' }), { effort: 'high', settings: '{"a":1,"ultracode":true}' })
    assert.deepEqual(ultracodeFlags({ effort: 'max', ultracode: true }), { effort: 'max', settings: '{"ultracode":true}' })
    // no effort picked: Claude Code's own level stays, ultracode rides in the settings
    assert.deepEqual(ultracodeFlags({ ultracode: true }), { effort: undefined, settings: '{"ultracode":true}' })
    assert.deepEqual(ultracodeFlags({ effort: 'high', settings: '/h/p.json' }), { effort: 'high', settings: '/h/p.json' })
    assert.deepEqual(ultracodeFlags({ effort: 'xhigh', ultracode: false }), { effort: 'xhigh', settings: undefined })
  })

  it('ultracode in a settings file is written into it, other keys kept', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-ultra-'))
    try {
      const file = path.join(dir, 'c.settings.json')
      fs.writeFileSync(file, '{"permissions":{"defaultMode":"bypassPermissions"}}')
      assert.deepEqual(ultracodeFlags({ effort: 'medium', ultracode: true, settings: file }), { effort: 'medium', settings: file })
      assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { permissions: { defaultMode: 'bypassPermissions' }, ultracode: true })
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })

  it('reads a first message from its file, so a long one never overflows the terminal line', () => {
    assert.equal(newChatCommand({ text: 'ignored', textFile: "/t/it's.txt" }, 'posix'), `claude "$(cat '/t/it'\\''s.txt')"`)
    assert.equal(newChatCommand({ textFile: '/t/m.txt' }, 'powershell'), "claude (Get-Content -Raw '/t/m.txt')")
  })

  it('doubles every single quote PowerShell reads as one, curly ones too', () => {
    assert.equal(newChatCommand({ text: 'it\u2019s \u2018x\u2019 \u201ay\u201b' }, 'powershell'), "claude 'it\u2019\u2019s \u2018\u2018x\u2019\u2019 \u201a\u201ay\u201b\u201b'")
  })

  it('quotes any branch git may take, and refuses only one read as a flag, empty, or with spaces', () => {
    assert.equal(newChatCommand({ branch: 'fix#12' }, 'posix'), "git switch -c 'fix#12' && claude")
    assert.equal(newChatCommand({ branch: "a;b'c" }, 'posix'), "git switch -c 'a;b'\\''c' && claude")
    for (const bad of ['-x', 'a b', '', 'a\nb']) assert.throws(() => newChatCommand({ branch: bad }, 'posix'), /branch/)
  })
})

describe('chain names', () => {
  it('labels a chat from its plan, else its task, else continued', () => {
    assert.equal(chatLabel('Armasu', '/u/Armasu/docs/superpowers/plans/2026-10-01-p4-accessories-fit-and-more.md'), 'Armasu · P4 accessories fit')
    assert.equal(chatLabel('Armasu', undefined, 'fix the closet regen button'), 'Armasu · Fix the closet')
    assert.equal(chatLabel('Armasu'), 'Armasu · continued')
    assert.ok(chatLabel('x'.repeat(80)).length <= 60)
  })
  it('names the next chat after its origin with a version: origin is v1, then v2, v3', () => {
    assert.equal(nextChainName('Fix login redirect', 'Armasu'), 'Fix login redirect v2')
    assert.equal(nextChainName('Fix login redirect v2', 'Armasu'), 'Fix login redirect v3')
    assert.equal(nextChainName('Fix login redirect v9', 'Armasu'), 'Fix login redirect v10')
    // A legacy `Base · N` chain carries on in the new scheme.
    assert.equal(nextChainName('Armasu · P4 accessories fit · 2', 'Armasu'), 'Armasu · P4 accessories fit v3')
    assert.equal(nextChainName(undefined, 'Armasu', undefined, 'regen button'), 'Armasu · Regen button v2')
    assert.equal(nextChainName(undefined, 'Armasu'), 'Armasu · continued v2')
  })
  it('caps a long name without cutting off its version', () => {
    const next = nextChainName(`${'x'.repeat(80)} v12`, 'Armasu')
    assert.ok(next.length <= 60)
    assert.match(next, /^x+ v13$/)
  })
  it('finds the origin and version of a chain name', () => {
    assert.equal(chainBase('Fix login redirect v3'), 'Fix login redirect')
    assert.equal(chainBase('Armasu · P4 accessories fit · 3'), 'Armasu · P4 accessories fit')
    assert.equal(chainBase('Fix closet 2'), undefined)
    assert.equal(chainBase('Fix login redirect'), undefined)
    assert.equal(chainBase(undefined), undefined)
    assert.equal(chainVersion('Fix login redirect v3'), 3)
    assert.equal(chainVersion('Armasu · continued · 2'), 2)
    assert.equal(chainVersion('Fix login redirect'), 1)
    assert.equal(chainVersion(undefined), 1)
  })
  it('passes the name to claude', () => {
    assert.equal(newChatCommand({ name: 'Armasu · continued · 2', text: 'go' }, 'posix'), "claude --name 'Armasu · continued · 2' 'go'")
  })
})

describe('handoff notes', () => {
  const fields = { n: 2, base: 'Fix closet', from: 'Fix closet', id8: 'abcd1234', to: 'Fix closet v2', branch: 'main', plan: 'none' }
  it('puts a header on a note once', () => {
    const once = labelNote('# Handoff: Armasu\nbody', fields)
    assert.equal(once, '# Handoff v2 · Fix closet\nFrom: Fix closet (abcd1234)\nTo:   Fix closet v2\nBranch: main · Plan: none\n\n# Handoff: Armasu\nbody')
    assert.equal(labelNote(once, { ...fields, n: 3 }), once)
    // A note labeled by an older Switchboard keeps its header too.
    const legacy = '# Handoff 1 · Armasu · continued\nbody'
    assert.equal(labelNote(legacy, fields), legacy)
  })
  it('tells the fresh chat to recreate every open task before other work', () => {
    const text = freshPrompt('/u/.claude/handoffs/A/n-abcdef12.md')
    assert.match(text, /^Continue from \/u\/\.claude\/handoffs\/A\/n-abcdef12\.md: read it first/)
    assert.match(text, /recreate every open task .* with the task tools before any other work/)
  })
  it('lists subagents still running at the cap with where their output is', () => {
    assert.equal(stillRunning('note\n', undefined), 'note\n')
    const out = stillRunning('note\n', ['engineer e1'])
    assert.match(out, /## Still running at the 30 minute wait cap/)
    assert.match(out, /- engineer e1: output in subagents\/agent-e1\.jsonl next to the old transcript/)
  })
  it('names a note by date, project, label and id', () => {
    assert.equal(handoffFile('Armasu', 'P4 accessories fit', 'abcd1234-ffff', Date.UTC(2026, 9, 27, 9, 5)), '2026-10-27-0905-armasu-p4-accessories-fit-abcd1234.md')
  })
  it('writes a Codex handoff note', () => {
    const note = codexNote({ project: 'Armasu', cwd: '/u/Armasu', branch: 'main', plan: '/u/Armasu/p.md', prompt: 'x'.repeat(600) }, Date.UTC(2026, 9, 27, 9, 5))
    assert.match(note, /^# Handoff: Armasu, 2026-10-27 09:05 UTC\n/)
    assert.match(note, /Folder: \/u\/Armasu\nBranch: main\nPlan: \/u\/Armasu\/p\.md\n/)
    assert.ok(note.includes('x'.repeat(500)) && !note.includes('x'.repeat(501)))
  })
})

describe('crossNote', () => {
  it('seeds the other AI with goal, summary and files', () => {
    const n = crossNote({ from: 'claude', project: 'switchboard', cwd: '/r/switchboard', asked: ['first ask', 'Fix the login row'], done: ['Added detect'], tools: [{ tool: 'Edit', target: 'src/a.ts' }, { tool: 'Bash', target: 'pnpm test' }, { tool: 'Write', target: 'src/a.ts' }, { tool: 'apply_patch', target: 'src/b.ts' }] })
    assert.match(n, /^Handoff from Claude in switchboard/)
    assert.match(n, /Goal: Fix the login row/)
    assert.match(n, /- Added detect/)
    assert.match(n, /Files touched: src\/a\.ts, src\/b\.ts$/m)
    assert.doesNotMatch(n, /pnpm test/)
  })
  it('says so when there is nothing to carry', () => {
    const n = crossNote({ from: 'codex', project: 'p', cwd: '/p' })
    assert.match(n, /^Handoff from Codex in p/)
    assert.match(n, /Goal: \(not recorded\)/)
  })
})

it('starts and resumes Codex chats with no approval prompts and our hooks trusted', () => {
  const flags = ['--dangerously-bypass-approvals-and-sandbox', '--dangerously-bypass-hook-trust']
  assert.deepEqual(codexArgs(['Fix login']), [...flags, 'Fix login'])
  assert.deepEqual(codexArgs([]), flags)
  assert.deepEqual(codexArgs(['resume', 'abc']), ['resume', ...flags, 'abc'])
})

it('Ask before actions on for Codex: approvals come back, our hooks stay trusted', () => {
  ask.codex = true
  try {
    assert.deepEqual(codexArgs(['Fix login']), ['--dangerously-bypass-hook-trust', 'Fix login'])
    assert.deepEqual(codexArgs(['resume', 'abc']), ['resume', '--dangerously-bypass-hook-trust', 'abc'])
  } finally { ask.codex = false }
})

it('Codex chat model and effort go in as -m and -c on new and resumed chats, nothing when unset', () => {
  const hook = '--dangerously-bypass-hook-trust'
  ask.codex = true
  try {
    ask.codexModel = 'gpt-5.6-terra'
    assert.deepEqual(codexArgs(['Fix']), [hook, '-m', 'gpt-5.6-terra', 'Fix'])
    ask.codexEffort = 'xhigh'
    assert.deepEqual(codexArgs(['Fix']), [hook, '-m', 'gpt-5.6-terra', '-c', 'model_reasoning_effort=xhigh', 'Fix'])
    assert.deepEqual(codexArgs(['resume', 'abc']), ['resume', hook, '-m', 'gpt-5.6-terra', '-c', 'model_reasoning_effort=xhigh', 'abc'])
    ask.codexModel = undefined
    assert.deepEqual(codexArgs([]), [hook, '-c', 'model_reasoning_effort=xhigh'])
    ask.codexEffort = undefined
    assert.deepEqual(codexArgs([]), [hook])
  } finally { ask.codex = false; ask.codexModel = undefined; ask.codexEffort = undefined }
})

it("a chat's own Codex model and effort beat the gear's, and resume keeps to the gear", () => {
  const hook = '--dangerously-bypass-hook-trust'
  ask.codex = true
  try {
    ask.codexModel = 'gpt-5.6-terra'
    ask.codexEffort = 'high'
    assert.deepEqual(codexArgs(['Fix'], { model: 'gpt-6-luna', effort: 'xhigh' }), [hook, '-m', 'gpt-6-luna', '-c', 'model_reasoning_effort=xhigh', 'Fix'])
    assert.deepEqual(codexArgs(['Fix'], { effort: 'medium' }), [hook, '-m', 'gpt-5.6-terra', '-c', 'model_reasoning_effort=medium', 'Fix'])
    assert.deepEqual(codexArgs(['Fix'], {}), [hook, '-m', 'gpt-5.6-terra', '-c', 'model_reasoning_effort=high', 'Fix'])
    ask.codexModel = undefined
    ask.codexEffort = undefined
    assert.deepEqual(codexArgs(['Fix'], { model: 'gpt-6-luna' }), [hook, '-m', 'gpt-6-luna', 'Fix'])
    assert.deepEqual(codexArgs(['resume', 'abc'], { model: 'gpt-6-luna' }), ['resume', hook, 'abc'])
  } finally { ask.codex = false; ask.codexModel = undefined; ask.codexEffort = undefined }
})

askMode.file = path.join(os.tmpdir(), `ask-mode-${process.pid}.json`)
it('Ask before actions for Claude goes to ask-mode.json, so bash-approve keeps the prompt', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'askmode-'))
  const was = askMode.file
  askMode.file = path.join(dir, 'ask-mode.json')
  try {
    Object.assign(ask, { claude: true, codex: false })
    assert.deepEqual(JSON.parse(fs.readFileSync(askMode.file, 'utf8')), { claude: true })
    ask.claude = false
    assert.deepEqual(JSON.parse(fs.readFileSync(askMode.file, 'utf8')), { claude: false })
    assert.equal(ask.claude, false)
  } finally { askMode.file = was; fs.rmSync(dir, { recursive: true, force: true }) }
})

describe('repoPlan', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-root-'))
  it('creates with gh in the repos root, private or public', () => {
    assert.deepEqual(repoPlan({ create: 'my-app', private: true }, root, '/bin/gh'), { folder: path.join(root, 'my-app'), file: '/bin/gh', args: ['repo', 'create', 'my-app', '--private', '--clone'], cwd: root })
    assert.deepEqual((repoPlan({ create: 'my.app_2', private: false }, root, '/bin/gh') as { args: string[] }).args, ['repo', 'create', 'my.app_2', '--public', '--clone'])
  })
  it('clones with git into root/<name>', () => {
    assert.deepEqual(repoPlan({ clone: 'https://github.com/o/r.git' }, root, undefined), { folder: path.join(root, 'r'), file: 'git', args: ['clone', 'https://github.com/o/r.git', path.join(root, 'r')], cwd: root })
  })
  it('refuses bad names, a missing gh and an existing folder', () => {
    for (const create of ['', '.x', '-x', 'a b', 'a/b', '..', 'x'.repeat(101)]) assert.equal(typeof repoPlan({ create, private: true }, root, '/bin/gh'), 'string', create)
    assert.equal(typeof repoPlan({ clone: 'not a repo' }, root, undefined), 'string')
    assert.match(repoPlan({ create: 'ok', private: true }, root, undefined) as string, /gh/)
    fs.mkdirSync(path.join(root, 'taken'))
    assert.match(repoPlan({ create: 'taken', private: true }, root, '/bin/gh') as string, /already exists/)
    assert.match(repoPlan({ clone: 'o/taken' }, root, undefined) as string, /already exists/)
  })
  it('isRepoAsk takes only the two exact shapes', () => {
    assert.ok(isRepoAsk({ create: 'x', private: false }))
    assert.ok(isRepoAsk({ clone: 'o/r' }))
    for (const v of [null, 'x', {}, { create: 'x' }, { create: 1, private: true }, { create: 'x', private: true, clone: 'o/r' }, { clone: 'nope nope' }, { create: '-x', private: true }]) assert.equal(isRepoAsk(v), false, JSON.stringify(v))
  })
})
