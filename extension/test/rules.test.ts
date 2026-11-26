/**
 * Rules and roles sync: when a rules file is written, skipped or given a managed block, and when a role file is touched.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { withCodex } from '../src/hub/roles'
import { BLOCK_END, CODEX_MAP, PATH_RULE_MARK, BLOCK_START, GENERIC, HEADER, decideAgent, decideRules, rulesFile, rulesSha, shippedSha, syncRules, upsertBlock, withPointer } from '../src/hub/rules'

const RULES = '# Working style\n\nBe brief.\n'
const V = '2026-10-28T10:00:00Z'

describe('rules file', () => {
  it('carries the kit header and a version line with the hash', () => {
    const t = rulesFile(RULES, V)
    assert.ok(t.startsWith(HEADER))
    assert.match(t, new RegExp(`<!-- rules-version: ${V} sha256:${rulesSha(RULES)} -->`))
    assert.ok(t.endsWith(RULES))
    assert.equal(rulesSha(RULES).length, 12)
  })

  it('writes a missing file', () => {
    assert.deepEqual(decideRules(undefined, RULES, V), { action: 'write', text: rulesFile(RULES, V), why: 'missing' })
  })

  it('leaves a generated file whose rules already match, with or without a version line', () => {
    assert.equal(decideRules(rulesFile(RULES, V), RULES, V).action, 'skip')
    assert.equal(decideRules(`${HEADER}\n${RULES}`, RULES, V).action, 'skip')
  })

  it('never downgrades rules the kit wrote later', () => {
    const d = decideRules(rulesFile('# Newer\n', '2026-11-01T00:00:00Z'), RULES, V)
    assert.deepEqual([d.action, d.why], ['skip', 'kit newer'])
  })

  it('rewrites older generated rules, and old ones with no version line', () => {
    assert.equal(decideRules(rulesFile('# Old\n', '2026-01-01T00:00:00Z'), RULES, V).action, 'write')
    assert.equal(decideRules(`${HEADER}\n# Old\n`, RULES, V).action, 'write')
  })

  it('adds a managed block to a hand-written file and keeps the rest', () => {
    const d = decideRules('# Mine\n', RULES, V)
    assert.equal(d.action, 'write')
    assert.ok(d.text!.startsWith('# Mine\n'))
    assert.ok(d.text!.includes(`${BLOCK_START}\n${RULES.trimEnd()}\n${BLOCK_END}`))
    assert.equal(decideRules(d.text, RULES, V).action, 'skip')
  })

  it('replaces a stale managed block in place', () => {
    const old = upsertBlock('# Mine\n', '# Old\n')!
    const next = upsertBlock(`${old}\n# After\n`, RULES)!
    assert.ok(!next.includes('# Old'))
    assert.ok(next.includes('# After'))
    assert.equal(next.split(BLOCK_START).length, 2)
  })
  it('leaves a start marker with no end alone, so the text after it is never eaten', () => {
    const t = `# Mine\n${BLOCK_START}\nold\n\n## My own notes\n- keep me\n`
    assert.equal(upsertBlock(t, RULES), undefined)
    assert.deepEqual(decideRules(t, RULES, V), { action: 'skip', why: 'block broken' })
    // An end before the start is no end for it.
    assert.equal(upsertBlock(`${BLOCK_END}\n${t}`, RULES), undefined)
    // A stray end before a whole block still updates the block.
    assert.ok(upsertBlock(`${BLOCK_END}\nstray\n${BLOCK_START}\nold\n${BLOCK_END}\n`, RULES)!.includes(`stray\n${BLOCK_START}\n${RULES.trimEnd()}`))
  })

  it('reads a generated file saved with Windows line endings as generated', () => {
    const crlf = rulesFile(RULES, V).replace(/\n/g, '\r\n')
    assert.equal(decideRules(crlf, RULES, V).action, 'skip')
    const older = rulesFile('# Old\n', '2026-01-01T00:00:00Z').replace(/\n/g, '\r\n')
    const d = decideRules(older, RULES, V)
    assert.equal(d.why, 'older')
    assert.ok(!d.text!.includes(BLOCK_START))
  })
})

describe('generic bundle', () => {
  const G = `${RULES}\n${GENERIC}\n`
  it('never replaces a personal kit copy, even an older one', () => {
    const d = decideRules(rulesFile(RULES, '2026-01-01T00:00:00Z'), G, V, true)
    assert.equal(d.action, 'skip')
    assert.equal(d.why, 'personal copy')
  })
  it('updates an older generic copy and writes a missing file', () => {
    assert.equal(decideRules(rulesFile(`old\n${GENERIC}\n`, '2026-01-01T00:00:00Z'), G, V, true).action, 'write')
    assert.equal(decideRules(undefined, G, V, true).action, 'write')
  })
  it('a personal bundle still replaces older rules', () => {
    assert.equal(decideRules(rulesFile('old', '2026-01-01T00:00:00Z'), RULES, V, false).action, 'write')
  })
  it('keeps a personal role, updates an old generic one', () => {
    const old = `old\n${GENERIC}\n`, next = `new\n${GENERIC}\n`
    assert.equal(decideAgent('mine', next, [rulesSha('mine')], true), 'personal')
    assert.equal(decideAgent(old, next, [rulesSha(old)], true), 'update')
    assert.equal(decideAgent(undefined, next, [], true), 'install')
    assert.equal(decideAgent('old', 'new', [rulesSha('old')], false), 'update')
  })
  it('updates a copy an older Switchboard shipped without the marker, and nothing else', () => {
    const shipped = [shippedSha('Kenneth rules\n'), shippedSha('---\nname: qa\nmodel: opus\n---\nqa v1\n')]
    const old = rulesFile('Kenneth rules\n', '2026-01-01T00:00:00Z')
    assert.equal(decideRules(old, G, V, true, shipped).action, 'write')
    assert.equal(decideRules(old.replace(/\n/g, '\r\n'), G, V, true, shipped).action, 'write')
    assert.equal(decideRules(rulesFile('Kenneth rules, edited\n', '2026-01-01T00:00:00Z'), G, V, true, shipped).why, 'personal copy')
    const next = `---\nname: qa\nmodel: opus\n---\nqa v2\n${GENERIC}\n`
    assert.equal(decideAgent('---\nname: qa\nmodel: opus\n---\nqa v1\n\n', next, [], true, shipped), 'update')
    assert.equal(decideAgent('---\nname: qa\nmodel: haiku\n---\nqa v1\n', next, [], true, shipped), 'retune')
    assert.equal(decideAgent('---\nname: qa\nmodel: opus\n---\nqa v1 mine\n', next, [], true, shipped), 'personal')
  })
  it('lists the 0.17 copies in kit/shipped.json', () => {
    const list = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'kit', 'shipped.json'), 'utf8')) as string[]
    assert.ok(list.length >= 8 && list.every(h => /^[0-9a-f]{64}$/.test(h)))
  })
  it('syncRules keeps a personal setup whole and says so', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-rules-')), k = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-rules-'))
    fs.mkdirSync(path.join(k, 'agents'), { recursive: true })
    fs.writeFileSync(path.join(k, 'rules.md'), G)
    fs.writeFileSync(path.join(k, 'agents', 'qa.md'), `qa v2\n${GENERIC}\n`)
    fs.writeFileSync(path.join(k, 'bundle.json'), JSON.stringify({ rulesVersion: V, generic: true, history: { 'qa.md': [rulesSha('qa v1')] } }))
    fs.mkdirSync(path.join(home, '.claude', 'agents'), { recursive: true })
    const mine = rulesFile('Kenneth rules', '2026-01-01T00:00:00Z')
    fs.writeFileSync(path.join(home, '.claude', 'CLAUDE.md'), mine)
    fs.writeFileSync(path.join(home, '.claude', 'agents', 'qa.md'), 'qa v1')
    const r = syncRules({ home, kit: k, write: true })
    assert.equal(fs.readFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'utf8'), mine)
    assert.equal(fs.readFileSync(path.join(home, '.claude', 'agents', 'qa.md'), 'utf8'), 'qa v1')
    assert.ok(!fs.existsSync(path.join(home, '.claude', 'agents', 'qa.md.switchboard-new')))
    assert.deepEqual(r.ready, { claude: true, codex: false, hermes: false })
    assert.match(r.note, /kept your own kit copy of CLAUDE\.md, qa\.md/)
  })
})

describe('role files', () => {
  const sha = rulesSha
  it('installs, skips, updates an untouched old copy, keeps an edited one', () => {
    assert.equal(decideAgent(undefined, 'new', []), 'install')
    assert.equal(decideAgent('new', 'new', []), 'skip')
    assert.equal(decideAgent('old', 'new', [sha('old')]), 'update')
    assert.equal(decideAgent('mine', 'new', [sha('old')]), 'edited')
  })
  it('a model picked in the gear is not an edit', () => {
    const v1 = '---\nname: qa\nmodel: opus\n---\nv1\n', v2 = '---\nname: qa\nmodel: opus\n---\nv2\n'
    const picked = (t: string) => t.replace('model: opus', 'model: haiku')
    assert.equal(decideAgent(picked(v2), v2, []), 'skip')
    assert.equal(decideAgent(picked(v1), v2, [sha(v1)]), 'retune')
    assert.equal(decideAgent(picked(v1).replace('v1', 'mine'), v2, [sha(v1)]), 'edited')
  })
})

describe('syncRules', () => {
  const kit = (dir: string) => {
    fs.mkdirSync(path.join(dir, 'agents'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'rules.md'), RULES)
    fs.writeFileSync(path.join(dir, 'agents', 'qa.md'), 'qa v2')
    fs.writeFileSync(path.join(dir, 'agents', 'engineer.md'), 'eng v2')
    fs.writeFileSync(path.join(dir, 'bundle.json'), JSON.stringify({ rulesVersion: V, history: { 'qa.md': [rulesSha('qa v1')] } }))
  }
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sb-rules-'))

  it('writes only for installed tools, keeps edited roles as .switchboard-new, and is quiet the second time', () => {
    const home = tmp(), k = tmp()
    kit(k)
    fs.mkdirSync(path.join(home, '.claude', 'agents'), { recursive: true })
    fs.writeFileSync(path.join(home, '.claude', 'agents', 'engineer.md'), 'my engineer')
    const r = syncRules({ home, kit: k, write: true })
    assert.equal(fs.readFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'utf8'), rulesFile(RULES, V))
    assert.ok(!fs.existsSync(path.join(home, '.codex')))
    assert.deepEqual(r.ready, { claude: true, codex: false, hermes: false })
    assert.equal(fs.readFileSync(path.join(home, '.claude', 'agents', 'qa.md'), 'utf8'), 'qa v2')
    assert.equal(fs.readFileSync(path.join(home, '.claude', 'agents', 'engineer.md'), 'utf8'), 'my engineer')
    assert.equal(fs.readFileSync(path.join(home, '.claude', 'agents', 'engineer.md.switchboard-new'), 'utf8'), 'eng v2')
    assert.match(r.note, /engineer\.md edited/)
    assert.equal(syncRules({ home, kit: k, write: true }).changed.length, 0)
  })

  it('dry mode touches nothing', () => {
    const home = tmp(), k = tmp()
    kit(k)
    fs.mkdirSync(path.join(home, '.claude'))
    const r = syncRules({ home, kit: k, write: false })
    assert.ok(r.changed.length > 0)
    assert.equal(r.ready.claude, false)
    assert.deepEqual(fs.readdirSync(path.join(home, '.claude')), [])
  })

  it('says when a hand edit broke the managed block, and writes nothing', () => {
    const home = tmp(), k = tmp()
    kit(k)
    fs.mkdirSync(path.join(home, '.claude'))
    const broken = `# Mine\n${BLOCK_START}\n- keep me\n`
    fs.writeFileSync(path.join(home, '.claude', 'CLAUDE.md'), broken)
    const r = syncRules({ home, kit: k, write: true })
    assert.equal(fs.readFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'utf8'), broken)
    assert.equal(r.ready.claude, false)
    assert.match(r.note, /CLAUDE\.md has a switchboard rules start line with no end line/)
  })

  it('says up to date when everything matches', () => {
    const home = tmp(), k = tmp()
    kit(k)
    fs.mkdirSync(path.join(home, '.claude'))
    syncRules({ home, kit: k, write: true })
    assert.equal(syncRules({ home, kit: k, write: true }).note, 'Rules and roles: up to date')
  })

  it('updates an old role whose model was picked in the gear and keeps that model', () => {
    const home = tmp(), k = tmp()
    kit(k)
    const v1 = '---\nname: qa\nmodel: opus\n---\nv1\n', v2 = '---\nname: qa\nmodel: opus\n---\nv2\n'
    fs.writeFileSync(path.join(k, 'agents', 'qa.md'), v2)
    fs.writeFileSync(path.join(k, 'bundle.json'), JSON.stringify({ rulesVersion: V, history: { 'qa.md': [rulesSha(v1)] } }))
    fs.mkdirSync(path.join(home, '.claude', 'agents'), { recursive: true })
    fs.writeFileSync(path.join(home, '.claude', 'agents', 'qa.md'), v1.replace('opus', 'haiku'))
    syncRules({ home, kit: k, write: true })
    assert.equal(fs.readFileSync(path.join(home, '.claude', 'agents', 'qa.md'), 'utf8'), v2.replace('opus', 'haiku'))
    assert.ok(!fs.existsSync(path.join(home, '.claude', 'agents', 'qa.md.switchboard-new')))
  })
})

describe('withPointer', () => {
  it('adds the bundled rules path only for a tool whose rules are missing, and never makes a message out of nothing', () => {
    assert.equal(withPointer('go', true, '/k'), 'go')
    assert.equal(withPointer('', false, '/k'), '')
    assert.equal(withPointer('go', false, '/k'), 'go\n\nFollow the working style in /k/rules.md; role briefs are in /k/agents.')
  })
})

describe('a Codex pick in the gear is not an edit', () => {
  const kit = fs.readFileSync(path.join(__dirname, '..', 'kit', 'agents', 'qa-codex.md'), 'utf8')
  const picked = withCodex(kit, 'gpt-5.6-luna', 'max') ?? ''
  it('skips a role that differs only by the pick', () => {
    assert.notEqual(picked, kit)
    assert.equal(decideAgent(picked, kit, []), 'skip')
    assert.equal(decideAgent(picked, kit, [], true), 'skip')
  })
  it('retunes an old copy and still edited when the body changed', () => {
    const old = kit.replace('Return', 'Send back')
    const oldPicked = withCodex(old, 'default', 'low') ?? ''
    assert.equal(decideAgent(oldPicked, kit, [rulesSha(old)]), 'retune')
    assert.equal(decideAgent(picked + 'mine\n', kit, []), 'edited')
  })
})

describe('codex tool map', () => {
  it('rides on the Codex copy only and counts as current', () => {
    const codex = rulesFile(RULES, V, CODEX_MAP)
    assert.ok(codex.endsWith(CODEX_MAP) && codex.includes('mcp__switchboard__ask'))
    assert.match(CODEX_MAP, /request_user_input[^\n]*fallback only[^\n]*title and options/)
    assert.match(CODEX_MAP, /ListAgents[^\n]*claude agents --json[^\n]*chats_check/)
    assert.match(CODEX_MAP, /SendMessage[^\n]*ask the user[^\n]*mcp__switchboard__ask/)
    assert.ok(!rulesFile(RULES, V).includes('Codex tool map'))
    assert.equal(decideRules(codex, RULES, V, false, [], CODEX_MAP).action, 'skip')
    assert.equal(decideRules(rulesFile(RULES, V), RULES, '2026-11-01T00:00:00Z', false, [], CODEX_MAP).action, 'write')
  })
})

describe('path rules', () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sb-prules-'))
  const PR = '---\npaths:\n  - "**/*.test.*"\n---\n\nUse the repo runner.\n'
  const kit = (dir: string) => {
    fs.mkdirSync(path.join(dir, 'agents'), { recursive: true })
    fs.mkdirSync(path.join(dir, 'rules'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'rules.md'), RULES)
    fs.writeFileSync(path.join(dir, 'rules', 'tests.md'), PR)
    fs.writeFileSync(path.join(dir, 'bundle.json'), JSON.stringify({ rulesVersion: V }))
  }

  it('installs them beside CLAUDE.md, marked, and Codex gets the full text', () => {
    const home = tmp(), k = tmp()
    kit(k)
    fs.mkdirSync(path.join(home, '.claude'))
    fs.mkdirSync(path.join(home, '.codex'))
    syncRules({ home, kit: k, write: true })
    const got = fs.readFileSync(path.join(home, '.claude', 'rules', 'switchboard-tests.md'), 'utf8')
    assert.ok(got.startsWith('---\npaths:'))
    assert.ok(got.includes(PATH_RULE_MARK))
    assert.ok(!fs.readFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'utf8').includes('Use the repo runner'))
    const codex = fs.readFileSync(path.join(home, '.codex', 'AGENTS.md'), 'utf8')
    assert.ok(codex.includes('Use the repo runner.') && !codex.includes('paths:'))
  })

  it('removes ours that left the kit, never one without the mark', () => {
    const home = tmp(), k = tmp()
    kit(k)
    const dir = path.join(home, '.claude', 'rules')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'switchboard-old.md'), `---\npaths:\n  - "x"\n---\n${PATH_RULE_MARK}\nold\n`)
    fs.writeFileSync(path.join(dir, 'switchboard-mine.md'), 'hand written\n')
    fs.writeFileSync(path.join(dir, 'style.md'), 'mine\n')
    syncRules({ home, kit: k, write: true })
    assert.deepEqual(fs.readdirSync(dir).sort(), ['style.md', 'switchboard-mine.md', 'switchboard-tests.md'])
  })

  it('does not overwrite a hand written file of the same name', () => {
    const home = tmp(), k = tmp()
    kit(k)
    const dir = path.join(home, '.claude', 'rules')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'switchboard-tests.md'), 'mine\n')
    syncRules({ home, kit: k, write: true })
    assert.equal(fs.readFileSync(path.join(dir, 'switchboard-tests.md'), 'utf8'), 'mine\n')
  })

  it('dry mode writes none', () => {
    const home = tmp(), k = tmp()
    kit(k)
    fs.mkdirSync(path.join(home, '.claude'))
    syncRules({ home, kit: k, write: false })
    assert.ok(!fs.existsSync(path.join(home, '.claude', 'rules')))
  })
})
