import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { Installed } from '../src/hub/types'
import { ask } from '../src/hub/projects'
import { FLAGGED, clearIndefinite, indefiniteOn, syncIndefinite, chatSettings, cleanName, handoffSettings, isNoRemote, nameNote, cleanProfile, defaultProfile, startProfile, profileSettings, readProfiles, resumeSettingsArg, saveProfile, toolsNote, turnOn, withLibrary, TOOLS_NOTE } from '../src/hub/tools'

const inv: Installed[] = [
  { kind: 'plugin', name: 'superpowers@superpowers-dev', enabled: true, description: 'TDD and plans' },
  { kind: 'plugin', name: 'bland@bland', enabled: true, description: 'Voice agents' },
  { kind: 'plugin', name: 'marketing-skills@marketingskills', enabled: true },
  { kind: 'plugin', name: 'auth0@claude-plugins-official', enabled: false },
  { kind: 'plugin', name: 'aws-core@claude-plugins-official', enabled: false },
  { kind: 'mod', name: 'usage-meter@kenneth-mods', enabled: true },
  { kind: 'skill', name: 'phone', enabled: true, description: 'Call the owner' },
  { kind: 'skill', name: 'taste-design', enabled: true },
  { kind: 'skill', name: 'old-one', enabled: false },
  { kind: 'role', name: 'engineer', enabled: true },
]

const LB = { skillListingBudgetFraction: 0.02 }
const BY = { ...LB, permissions: { defaultMode: 'bypassPermissions' }, skipDangerousModePermissionPrompt: true, enableAllProjectMcpServers: true }

test('defaultProfile: every plugin on but the gated bundles, mods and archived skills left out', () => {
  assert.deepEqual(defaultProfile(inv), {
    plugins: { 'superpowers@superpowers-dev': true, 'bland@bland': false, 'marketing-skills@marketingskills': false, 'auth0@claude-plugins-official': true, 'aws-core@claude-plugins-official': false },
    skills: { phone: true, 'taste-design': true },
  })
})

test('defaultProfile: everything on but the second security-guidance, whose hooks would run twice', () => {
  const names = ['auth0@claude-plugins-official', 'stitch-design@google-labs-code-stitch-skills', 'code-simplifier@claude-plugins-official', 'github@claude-plugins-official', 'security-guidance@claude-code-plugins']
  const d = defaultProfile([...names.map(name => ({ kind: 'plugin' as const, name, enabled: false })), ...['image-to-code-skill', 'gsap-greensock'].map(name => ({ kind: 'skill' as const, name, enabled: true }))])
  assert.deepEqual(FLAGGED, ['security-guidance@claude-code-plugins'])
  assert.equal(d.plugins['security-guidance@claude-code-plugins'], false)
  assert.ok(Object.entries(d.plugins).every(([k, on]) => on || FLAGGED.includes(k)))
  assert.ok(Object.values(d.skills).every(Boolean))
})

test('flagged: a hand toggle and tool_on still turn it on', () => {
  const withFlagged: Installed[] = [...inv, { kind: 'plugin', name: 'security-guidance@claude-code-plugins', enabled: true }]
  const d = defaultProfile(withFlagged)
  assert.equal(cleanProfile({ plugins: { 'security-guidance@claude-code-plugins': true }, skills: {} }, withFlagged).plugins['security-guidance@claude-code-plugins'], true)
  assert.equal(turnOn(d, withFlagged, 'security-guidance@claude-code-plugins')?.profile.plugins['security-guidance@claude-code-plugins'], true)
})

test('startProfile: the panel profile cleaned, else all on with no model call; nothing installed is none', () => {
  assert.deepEqual(startProfile(inv, undefined), defaultProfile(inv))
  assert.equal(startProfile([], undefined), undefined)
  assert.deepEqual(startProfile(inv, { plugins: { 'bland@bland': false }, skills: {} }), cleanProfile({ plugins: { 'bland@bland': false }, skills: {} }, inv))
})

test('cleanProfile: unknown names dropped, missing ones from defaults, a flagged one the user turned on kept', () => {
  const p = cleanProfile({ plugins: { 'auth0@claude-plugins-official': true, 'evil@x': true }, skills: { phone: false, nope: true } }, inv)
  assert.equal(p.plugins['auth0@claude-plugins-official'], true)
  assert.equal(p.plugins['evil@x'], undefined)
  // A gap takes the default, and bland is gated.
  assert.equal(p.plugins['bland@bland'], false)
  assert.deepEqual(p.skills, { phone: false, 'taste-design': true })
})

test('cleanProfile: an always-on plugin like superpowers stays on when turned off by hand', () => {
  assert.equal(cleanProfile({ plugins: { 'superpowers@superpowers-dev': false }, skills: {} }, inv).plugins['superpowers@superpowers-dev'], true)
})

test('profileSettings: every plugin written out, only off skills overridden', () => {
  assert.deepEqual(profileSettings({ plugins: { 'a@b': true, 'c@d': false }, skills: { phone: false, x: true } }), {
    enabledPlugins: { 'a@b': true, 'c@d': false }, skillOverrides: { phone: 'off' }, ...BY,
  })
})

test('saveProfile and readProfiles round trip; resume finds the settings file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-'))
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e'
  const p = { plugins: { 'a@b': false }, skills: { phone: false } }
  const file = saveProfile(id, p, dir)
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), profileSettings(p))
  assert.deepEqual(readProfiles([id, 'missing'], dir), { [id]: p })
  assert.equal(resumeSettingsArg(id, dir, '', 'posix'), ` --settings '${file}'`)
  assert.equal(resumeSettingsArg('abc', dir), '')
  assert.throws(() => saveProfile('../x', p, dir))
})

test('chatSettings: a to-do chat starts with Remote Control off, a normal new chat keeps the user setting', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-'))
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e'
  const p = { plugins: { 'a@b': true }, skills: {} }
  const off = chatSettings(id, p, true, dir)!
  assert.deepEqual(JSON.parse(fs.readFileSync(off, 'utf8')), { ...profileSettings(p), remoteControlAtStartup: false })
  const normal = chatSettings('1f8fad5b-d9cb-469f-a165-70867728950e', p, false, dir)!
  assert.deepEqual(JSON.parse(fs.readFileSync(normal, 'utf8')), profileSettings(p))
  assert.ok(!('remoteControlAtStartup' in profileSettings(p)))
  // No tool profile: the off switch goes inline, and a normal chat passes no --settings at all.
  assert.deepEqual(JSON.parse(chatSettings(undefined, undefined, true, dir)!), { remoteControlAtStartup: false, ...BY })
  // A normal chat without a profile still gets the bypass inline, so a project's own permission mode cannot bring prompts back.
  assert.deepEqual(JSON.parse(chatSettings(undefined, undefined, false, dir)!), BY)
  assert.deepEqual(JSON.parse(chatSettings('2f8fad5b-d9cb-469f-a165-70867728950e', undefined, false, dir)!), BY)
})

test('no remote is kept per chat: a tools change rewrites the settings with the switch still off', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-'))
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e'
  chatSettings(id, { plugins: {}, skills: {} }, true, dir)
  assert.equal(isNoRemote(id, dir), true)
  // saveChatTools writes through saveProfile with no switch of its own.
  const p = { plugins: { 'a@b': false }, skills: { phone: false } }
  const file = saveProfile(id, p, dir)
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { ...profileSettings(p), remoteControlAtStartup: false })
  const other = '1f8fad5b-d9cb-469f-a165-70867728950e'
  assert.deepEqual(JSON.parse(fs.readFileSync(saveProfile(other, p, dir), 'utf8')), profileSettings(p))
  assert.equal(isNoRemote(other, dir), false)
  assert.equal(isNoRemote('../x', dir), false)
})

test('no remote on resume: with a profile its file, without one the switch inline, a normal chat neither', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-'))
  const bare = '2f8fad5b-d9cb-469f-a165-70867728950e'
  chatSettings(bare, undefined, true, dir)
  assert.equal(resumeSettingsArg(bare, dir, '', 'posix'), ` --settings '{"remoteControlAtStartup":false,"skillListingBudgetFraction":0.02,"permissions":{"defaultMode":"bypassPermissions"},"skipDangerousModePermissionPrompt":true,"enableAllProjectMcpServers":true}'`)
  const withTools = '3f8fad5b-d9cb-469f-a165-70867728950e'
  const file = chatSettings(withTools, { plugins: {}, skills: {} }, true, dir)!
  assert.equal(resumeSettingsArg(withTools, dir, '', 'posix'), ` --settings '${file}'`)
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).remoteControlAtStartup, false)
  assert.equal(resumeSettingsArg('4f8fad5b-d9cb-469f-a165-70867728950e', dir, '', 'posix'), ` --settings '{"skillListingBudgetFraction":0.02,"permissions":{"defaultMode":"bypassPermissions"},"skipDangerousModePermissionPrompt":true,"enableAllProjectMcpServers":true}'`)
})

test('no remote follows a handoff to the fresh chat, with or without tools; a normal chat hands off as before', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-'))
  const old = '5f8fad5b-d9cb-469f-a165-70867728950e', fresh = '6f8fad5b-d9cb-469f-a165-70867728950e', fresh2 = '7f8fad5b-d9cb-469f-a165-70867728950e'
  chatSettings(old, undefined, true, dir)
  const p = { plugins: {}, skills: {} }
  const a = handoffSettings(old, fresh, p, dir)
  assert.equal(a.off, true)
  assert.equal(isNoRemote(fresh, dir), true)
  assert.equal(JSON.parse(fs.readFileSync(a.settings!, 'utf8')).remoteControlAtStartup, false)
  assert.deepEqual(handoffSettings(old, fresh2, undefined, dir), { settings: '{"remoteControlAtStartup":false,"skillListingBudgetFraction":0.02,"permissions":{"defaultMode":"bypassPermissions"},"skipDangerousModePermissionPrompt":true,"enableAllProjectMcpServers":true}', off: true })
  const normal = '8f8fad5b-d9cb-469f-a165-70867728950e', next = '9f8fad5b-d9cb-469f-a165-70867728950e'
  const b = handoffSettings(normal, next, p, dir)
  assert.equal(b.off, false)
  assert.equal(isNoRemote(next, dir), false)
  assert.deepEqual(JSON.parse(fs.readFileSync(b.settings!, 'utf8')), profileSettings(p))
  assert.deepEqual(handoffSettings(normal, 'a0f8fad5-d9cb-469f-a165-70867728950e', undefined, dir), { settings: JSON.stringify(BY), off: false })
})

test('routes: tool commands checked, a profile must be two maps of booleans', async () => {
  const { commandProblem } = await import('../src/hub/routes')
  const tools = { plugins: { 'a@b': true }, skills: {} }
  assert.equal(commandProblem({ type: 'hub-new-chat', path: '/p', remote: false, tools }), undefined)
  assert.equal(commandProblem({ type: 'hub-new-chat', path: '/p', remote: false }), undefined)
  assert.equal(commandProblem({ type: 'hub-new-chat', path: '', remote: false, repo: { create: 'new-app', private: true } }), undefined)
  assert.equal(commandProblem({ type: 'hub-new-chat', path: '', remote: false, repo: { clone: 'o/r' } }), undefined)
  assert.ok(commandProblem({ type: 'hub-new-chat', path: '', remote: false, repo: { create: '..', private: true } }))
  assert.ok(commandProblem({ type: 'hub-new-chat', path: '', remote: false, repo: { clone: 'rm -rf' } }))
  assert.equal(commandProblem({ type: 'hub-pick-tools', text: 'x' }), undefined)
  assert.equal(commandProblem({ type: 'hub-pick-tools', text: '', path: '/p' }), undefined)
  assert.equal(commandProblem({ type: 'hub-chat-tools', sessionId: 'x', tools }), undefined)
  assert.ok(commandProblem({ type: 'hub-chat-tools', sessionId: 'x', tools: { plugins: { a: 'yes' }, skills: {} } }))
  assert.ok(commandProblem({ type: 'hub-new-chat', path: '/p', remote: false, tools: { plugins: [] } }))
  assert.equal(commandProblem({ type: 'hub-chat-tools', sessionId: 'x', tools: { ...tools, assets: { 'a.md': true } } }), undefined)
  assert.ok(commandProblem({ type: 'hub-chat-tools', sessionId: 'x', tools: { ...tools, assets: 'all' } }))
})

const projInv: Installed[] = [
  ...inv,
  { kind: 'skill', name: 'apple-design', enabled: true, source: 'project', description: 'Apple motion for the web' },
  { kind: 'asset', name: 'apple', enabled: true, source: 'project', path: 'design-md/apple/DESIGN.md', description: 'Photography-first gallery look' },
  { kind: 'asset', name: 'raycast-DESIGN', enabled: true, source: 'project', path: 'docs/design/raycast-DESIGN.md', description: 'Raycast dark' },
]

test('defaultProfile: project skills and assets on; no assets key without assets', () => {
  const d = defaultProfile(projInv)
  assert.equal(d.skills['apple-design'], true)
  assert.deepEqual(d.assets, { 'design-md/apple/DESIGN.md': true, 'docs/design/raycast-DESIGN.md': true })
  assert.equal(defaultProfile(inv).assets, undefined)
})

test('cleanProfile: keeps an asset turned off, drops unknown ones', () => {
  const p = cleanProfile({ plugins: {}, skills: {}, assets: { 'design-md/apple/DESIGN.md': false, '../etc/passwd': true } }, projInv)
  assert.deepEqual(p.assets, { 'design-md/apple/DESIGN.md': false, 'docs/design/raycast-DESIGN.md': true })
})

test('toolsNote: tells the chat to read the design references on before UI work', () => {
  assert.equal(toolsNote({ plugins: {}, skills: {} }), TOOLS_NOTE)
  const n = toolsNote({ plugins: {}, skills: {}, assets: { 'design-md/apple/DESIGN.md': true, 'x.md': false } })
  assert.match(n, /read these design references first: design-md\/apple\/DESIGN\.md\.$/)
  assert.doesNotMatch(n, /x\.md/)
})

test('profileSettings: a project skill turned off goes through skillOverrides', () => {
  assert.deepEqual(profileSettings({ plugins: {}, skills: { 'apple-design': false }, assets: { 'a.md': true } }), { enabledPlugins: {}, skillOverrides: { 'apple-design': 'off' }, ...BY })
})

test('resumeSettingsArg: a profile with assets resumes with the note', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-'))
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e'
  saveProfile(id, { plugins: {}, skills: {}, assets: { "design-md/o'neil/DESIGN.md": true } }, dir)
  const arg = resumeSettingsArg(id, dir, '', 'posix')
  assert.match(arg, /--settings '.+' --append-system-prompt 'Every installed plugin/)
  assert.match(arg, /o'\\''neil/)
})

const libInv: Installed[] = [
  ...projInv,
  { kind: 'asset', name: 'cursor', enabled: true, source: 'library', path: '/h/lib/cursor/DESIGN.md', description: 'Warm cream editor' },
  { kind: 'asset', name: 'apple', enabled: true, source: 'library', path: '/h/lib/apple/DESIGN.md', description: 'Apple site' },
  ...['a', 'b', 'c'].map((n): Installed => ({ kind: 'asset', name: n, enabled: true, source: 'library', path: `/h/lib/${n}/DESIGN.md` })),
]

test('defaultProfile: library off, project assets on', () => {
  assert.deepEqual(defaultProfile(libInv).assets, {
    'design-md/apple/DESIGN.md': true, 'docs/design/raycast-DESIGN.md': true,
    '/h/lib/cursor/DESIGN.md': false, '/h/lib/apple/DESIGN.md': false, '/h/lib/a/DESIGN.md': false, '/h/lib/b/DESIGN.md': false, '/h/lib/c/DESIGN.md': false,
  })
})

test('cleanProfile: keeps library keys turned on by hand', () => {
  const p = cleanProfile({ plugins: {}, skills: {}, assets: { '/h/lib/cursor/DESIGN.md': true, '/h/other.md': true } }, libInv)
  assert.equal(p.assets!['/h/lib/cursor/DESIGN.md'], true)
  assert.equal(p.assets!['/h/lib/apple/DESIGN.md'], false)
  assert.equal(p.assets!['/h/other.md'], undefined)
  assert.match(toolsNote(p), /\/h\/lib\/cursor\/DESIGN\.md/)
})

test('cleanName: trimmed, one line, capped at 40, junk is empty', () => {
  assert.equal(cleanName('  Kenneth  '), 'Kenneth')
  assert.equal(cleanName('Ken\n  Kang'), 'Ken Kang')
  assert.equal(cleanName('x'.repeat(60)), 'x'.repeat(40))
  assert.equal(cleanName('   '), '')
  assert.equal(cleanName(`O'Brien "K" \`id\` $(x); \u2019a\u0007`), 'OBrien K id (x) a')
  assert.equal(cleanName(42), '')
})

test('nameNote: names the user when set, nothing when empty', () => {
  assert.equal(nameNote(''), undefined)
  assert.equal(nameNote('  '), undefined)
  const n = nameNote(' Kenneth ')!
  assert.match(n, /^Address the user as Kenneth\./)
  assert.match(n, /chat replies only, never files, code or commits/)
  assert.doesNotMatch(n, /Jarvis|Iron Man|sir|'/i)
})

test('resumeSettingsArg: an extra note rides along, with or without a profile', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-'))
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e'
  const inl = ` --settings '${JSON.stringify(BY)}'`
  assert.equal(resumeSettingsArg(id, dir, "Call me O'Neil.", 'posix'), `${inl} --append-system-prompt 'Call me O'\\''Neil.'`)
  assert.equal(resumeSettingsArg(id, dir, "Call me O'Neil.", 'powershell'), `${inl} --append-system-prompt 'Call me O''Neil.'`)
  const file = saveProfile(id, { plugins: {}, skills: {} }, dir)
  assert.equal(resumeSettingsArg(id, dir, 'Hi.', 'posix'), ` --settings '${file}' --append-system-prompt 'Hi.'`)
  assert.equal(resumeSettingsArg(id, dir, '', 'posix'), ` --settings '${file}'`)
})

test('routes: the name setting takes a string', async () => {
  const { commandProblem } = await import('../src/hub/routes')
  assert.equal(commandProblem({ type: 'hub-switchboard', key: 'name', value: 'Kenneth' }), undefined)
  assert.ok(commandProblem({ type: 'hub-switchboard', key: 'nickname', value: 'Kenneth' }))
})

// PowerShell: ; # $ ` " are literal inside '...', where '' is one quote; true when the line is that one token.
const psToken = (q: string) => /^'(?:[^'\u2018-\u201B]|''|[\u2018-\u201B]{2})*'$/.test(q)

test('resume quoting: hostile notes stay one argument in POSIX sh and PowerShell', async () => {
  const { execFileSync } = await import('child_process')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-'))
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e'
  for (const n of [`x'; calc.exe; #`, `"q"`, '`id`', '$(whoami)', 'a;b', '# c', `O\u2019Neil`]) {
    const arg = resumeSettingsArg(id, dir, n, 'posix')
    const out = execFileSync('sh', ['-c', `printf '[%s]\\n'${arg}`]).toString()
    assert.equal(out, `[--settings]\n[${JSON.stringify(BY)}]\n[--append-system-prompt]\n[${n}]\n`, n)
    const ps = resumeSettingsArg(id, dir, n, 'powershell').replace(/^.* --append-system-prompt /, '')
    assert.ok(psToken(ps), `${n} -> ${ps}`)
  }
})

test('turnOn: a plugin by id, short name or plugin:skill, or a skill, and the file to read now', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'turnon-'))
  const plug = path.join(dir, 'bland'), proj = path.join(dir, 'proj')
  fs.mkdirSync(path.join(plug, 'skills', 'calls'), { recursive: true })
  fs.writeFileSync(path.join(plug, 'skills', 'calls', 'SKILL.md'), '')
  fs.mkdirSync(path.join(plug, 'commands'), { recursive: true })
  fs.writeFileSync(path.join(plug, 'commands', 'clone.md'), '')
  fs.mkdirSync(path.join(proj, '.agents', 'skills', 'local-one'), { recursive: true })
  fs.writeFileSync(path.join(proj, '.agents', 'skills', 'local-one', 'SKILL.md'), '')
  const withDir: Installed[] = [...inv.map(i => i.name === 'bland@bland' ? { ...i, path: plug } : i), { kind: 'skill', name: 'local-one', enabled: true, source: 'project' }]
  const off = { plugins: { 'bland@bland': false }, skills: { phone: false } }
  assert.deepEqual(turnOn(off, withDir, 'bland'), { profile: { plugins: { 'bland@bland': true }, skills: { phone: false } }, use: plug })
  assert.equal(turnOn(off, withDir, 'bland:calls')?.use, path.join(plug, 'skills', 'calls', 'SKILL.md'))
  assert.equal(turnOn(off, withDir, 'bland@bland:clone')?.use, path.join(plug, 'commands', 'clone.md'))
  // Not found where skills usually live: the plugin's folder to look in.
  assert.equal(turnOn(off, withDir, 'bland:stitch::odd')?.use, plug)
  assert.equal(turnOn(off, withDir, '/phone')?.profile.skills.phone, true)
  assert.equal(turnOn(off, withDir, 'local-one', proj)?.use, path.join(proj, '.agents', 'skills', 'local-one', 'SKILL.md'))
  assert.equal(turnOn(off, withDir, 'nope'), undefined)
})

test('resume: a settings file from before every chat started all on is rewritten all on, assets as saved', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-'))
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e'
  const old = { plugins: { 'a@b': false, 'security-guidance@claude-code-plugins': false }, skills: { phone: false }, assets: { 'x.md': false, '/l/y.md': true } }
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(old))
  fs.writeFileSync(path.join(dir, `${id}.settings.json`), JSON.stringify({ enabledPlugins: old.plugins, skillOverrides: { phone: 'off' } }))
  resumeSettingsArg(id, dir, '', 'posix', path.join(dir, 'lib'))
  const p = { plugins: { 'a@b': true, 'security-guidance@claude-code-plugins': false }, skills: { phone: true }, assets: old.assets }
  assert.deepEqual(readProfiles([id], dir)[id], p)
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, `${id}.settings.json`), 'utf8')), profileSettings(p))
  // A hand toggle saved since then stays.
  saveProfile(id, { ...p, skills: { phone: false } }, dir)
  resumeSettingsArg(id, dir, '', 'posix')
  assert.equal(readProfiles([id], dir)[id].skills.phone, false)
})

test('resume: library copies saved on in an old profile go off and out of the note', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-')), lib = path.join(dir, 'lib')
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e'
  const brands = ['airbnb', 'apple', 'stripe', 'zapier']
  for (const b of brands) { fs.mkdirSync(path.join(lib, b), { recursive: true }); fs.writeFileSync(path.join(lib, b, 'DESIGN.md'), '') }
  const assets = { ...Object.fromEntries(brands.map(b => [`design-md/${b}/DESIGN.md`, true])), 'design-md/mine/DESIGN.md': true, 'docs/design/raycast-DESIGN.md': true }
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ plugins: {}, skills: {}, assets }))
  fs.writeFileSync(path.join(dir, `${id}.settings.json`), JSON.stringify({ enabledPlugins: {}, skillOverrides: {} }))
  const arg = resumeSettingsArg(id, dir, '', 'posix', lib)
  assert.match(arg, /design-md\/mine\/DESIGN\.md, docs\/design\/raycast-DESIGN\.md\./)
  assert.doesNotMatch(arg, /airbnb|zapier/)
  assert.equal(readProfiles([id], dir)[id].assets!['design-md/airbnb/DESIGN.md'], false)
})

test('withLibrary: a profile saved before the library gets every look, off; ones it has stay as set', () => {
  const lib: Installed[] = ['airbnb', 'stripe'].map(b => ({ kind: 'asset', name: b, enabled: true, source: 'library', path: `/l/${b}/DESIGN.md` }))
  assert.deepEqual(withLibrary({ plugins: {}, skills: {} }, lib).assets, { '/l/airbnb/DESIGN.md': false, '/l/stripe/DESIGN.md': false })
  const p = { plugins: {}, skills: {}, assets: { 'x.md': true, '/l/stripe/DESIGN.md': true } }
  assert.deepEqual(withLibrary(p, lib).assets, { '/l/airbnb/DESIGN.md': false, 'x.md': true, '/l/stripe/DESIGN.md': true })
  assert.equal(withLibrary({ plugins: {}, skills: {} }, []).assets, undefined)
})

test('Ask before actions on: new and resumed chats start in default mode, and back off again in bypass', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-'))
  const id = 'af8fad5b-d9cb-469f-a165-70867728950e'
  const p = { plugins: {}, skills: {} }
  const file = saveProfile(id, p, dir)
  ask.claude = true
  try {
    assert.deepEqual(profileSettings(p).permissions, { defaultMode: 'default' })
    assert.equal('skipDangerousModePermissionPrompt' in profileSettings(p), false)
    assert.equal('enableAllProjectMcpServers' in profileSettings(p), false)
    assert.deepEqual(JSON.parse(chatSettings(undefined, undefined, false, dir)!), { ...LB, permissions: { defaultMode: 'default' } })
    assert.deepEqual(JSON.parse(chatSettings(undefined, undefined, false, dir)!).permissions, { defaultMode: 'default' })
    // A chat saved in bypass resumes asking: its settings file is rewritten.
    assert.equal(resumeSettingsArg(id, dir, '', 'posix'), ` --settings '${file}'`)
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).permissions, { defaultMode: 'default' })
  } finally { ask.claude = false }
  resumeSettingsArg(id, dir, '', 'posix')
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), profileSettings(p))
  // Profile gone, settings file left: the mode is still rewritten, tools kept.
  fs.rmSync(path.join(dir, `${id}.json`))
  ask.claude = true
  try {
    resumeSettingsArg(id, dir, '', 'posix')
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { enabledPlugins: {}, skillOverrides: {}, ...LB, permissions: { defaultMode: 'default' } })
  } finally { ask.claude = false }
  resumeSettingsArg(id, dir, '', 'posix')
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { enabledPlugins: {}, skillOverrides: {}, ...BY })
  assert.deepEqual(profileSettings(p), { enabledPlugins: {}, skillOverrides: {}, ...BY })
})

test('handoffSettings: a settings write that fails still keeps a to-do chat off Remote Control', { skip: process.getuid?.() === 0 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-'))
  const from = '0f8fad5b-d9cb-469f-a165-70867728950e', to = '1f8fad5b-d9cb-469f-a165-70867728950e'
  chatSettings(from, undefined, true, dir)
  fs.chmodSync(dir, 0o500)
  try { assert.equal(handoffSettings(from, to, { plugins: {}, skills: {} }, dir).off, true) } finally { fs.chmodSync(dir, 0o700) }
})

test('toolsNote: names the gated bundles that are off, with what each is for', () => {
  const n = toolsNote(defaultProfile(inv))
  assert.match(n, /Off until needed, turn on with tool_on[^.]*: marketing-skills \(SEO[^)]*\), aws-core \(AWS services\)|bland \(voice agents/)
  for (const g of ['marketing-skills', 'aws-core', 'bland']) assert.ok(n.includes(`${g} (`), g)
  assert.ok(!toolsNote({ plugins: { 'bland@bland': true }, skills: {} }).includes('Off until needed'))
})

test('toolsNote: a held gated bundle is left out, it needs Approve, not tool_on', () => {
  const n = toolsNote({ plugins: { 'bland@bland': false, 'aws-core@claude-plugins-official': false }, skills: {} }, new Set(['bland@bland']))
  assert.ok(n.includes('aws-core ('))
  assert.ok(!n.includes('bland ('))
})

test('indefinite: the flag file lists every profile that has it, and survives clean and handoff', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-'))
  const file = path.join(dir, 'indefinite.json')
  const a = '5f8fad5b-d9cb-469f-a165-70867728950e', b = '6f8fad5b-d9cb-469f-a165-70867728950e', c = '7f8fad5b-d9cb-469f-a165-70867728950e'
  saveProfile(a, { plugins: {}, skills: {}, indefinite: 111 }, dir)
  saveProfile(b, { plugins: {}, skills: {} }, dir)
  assert.deepEqual(syncIndefinite(dir, file), { [a]: 111 })
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { [a]: 111 })
  assert.equal(cleanProfile({ plugins: {}, skills: {}, indefinite: 111 }, inv).indefinite, 111)
  assert.equal(indefiniteOn(a, dir), 111)
  // handoff: the fresh id gets it, the old id drops it
  const carried = readProfiles([a], dir)[a]
  handoffSettings(a, c, carried, dir)
  clearIndefinite(a, dir, file)
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { [c]: 111 })
  assert.equal(readProfiles([a], dir)[a].indefinite, undefined)
  // done: cleared everywhere
  assert.equal(clearIndefinite(c, dir, file)?.indefinite, undefined)
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {})
  assert.deepEqual(clearIndefinite(b, dir, file), { plugins: {}, skills: {} })
  assert.equal(clearIndefinite('8f8fad5b-d9cb-469f-a165-70867728950e', dir, file), undefined)
})

test('indefinite: a budget widens the file entry, a plain number still reads as onAt', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-'))
  const file = path.join(dir, 'indefinite.json')
  const a = '5f8fad5b-d9cb-469f-a165-70867728950e', b = '6f8fad5b-d9cb-469f-a165-70867728950e'
  saveProfile(a, { plugins: {}, skills: {}, indefinite: 111, budget: { maxHours: 2, gate: 'pnpm test' } }, dir)
  saveProfile(b, { plugins: {}, skills: {}, indefinite: 222, budget: {} }, dir)
  assert.deepEqual(syncIndefinite(dir, file), { [a]: { onAt: 111, maxHours: 2, gate: 'pnpm test' }, [b]: 222 })
  assert.equal(indefiniteOn(a, dir), 111)
  const kept = cleanProfile({ plugins: {}, skills: {}, indefinite: 1, budget: { maxCostUsd: 5 }, checkBack: { everyMin: 30, count: 2 } }, inv)
  assert.deepEqual([kept.budget, kept.checkBack], [{ maxCostUsd: 5 }, { everyMin: 30, count: 2 }])
  // done drops the budget with the flag, the check-back stays
  saveProfile(a, { plugins: {}, skills: {}, indefinite: 111, budget: { maxHours: 2 }, checkBack: { everyMin: 10, count: 0 } }, dir)
  const rest = clearIndefinite(a, dir, file)
  assert.deepEqual([rest?.budget, rest?.checkBack], [undefined, { everyMin: 10, count: 0 }])
})

test('Auto mode: chats start with defaultMode auto and keep the project MCP prompt', () => {
  ask.auto = true
  try {
    assert.deepEqual(profileSettings({ plugins: {}, skills: {} }).permissions, { defaultMode: 'auto' })
    assert.equal('skipDangerousModePermissionPrompt' in profileSettings({ plugins: {}, skills: {} }), false)
  } finally { ask.auto = false }
})
