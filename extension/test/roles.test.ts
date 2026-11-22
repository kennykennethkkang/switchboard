/**
 * Role models: reading and rewriting the model: line of a role file's frontmatter.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { CODEX_EFFORTS, CODEX_MODELS, codexOf, setRoleCodex, withCodex, modelOf, setRoleModel, withModel } from '../src/hub/roles'
import { commandProblem } from '../src/hub/routes'

const QA = '---\nname: qa\ndescription: tests\nmodel: opus\nmaxTurns: 40\n---\n\nmodel: not this one\n'

describe('modelOf and withModel', () => {
  it('read and rewrite only the frontmatter line', () => {
    assert.equal(modelOf(QA), 'opus')
    assert.equal(withModel(QA, 'haiku'), QA.replace('model: opus', 'model: haiku'))
    assert.equal(modelOf('no frontmatter\nmodel: x\n'), undefined)
    assert.equal(withModel('no frontmatter\n', 'opus'), undefined)
  })
  it('adds the line before the closing fence when the role has none', () => {
    const bare = '---\nname: ops\n---\nbody\n'
    assert.equal(modelOf(bare), undefined)
    assert.equal(withModel(bare, 'inherit'), '---\nname: ops\nmodel: inherit\n---\nbody\n')
  })
  it('keeps CRLF files intact', () => {
    const crlf = '---\r\nname: qa\r\nmodel: opus\r\n---\r\n'
    assert.equal(modelOf(crlf), 'opus')
    assert.equal(withModel(crlf, 'sonnet'), '---\r\nname: qa\r\nmodel: sonnet\r\n---\r\n')
  })
})

describe('setRoleModel', () => {
  const dir = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-roles-')); fs.writeFileSync(path.join(d, 'qa.md'), QA); return d }
  it('rewrites the one role file', () => {
    const d = dir()
    assert.equal(setRoleModel(d, 'qa', 'sonnet'), undefined)
    assert.equal(fs.readFileSync(path.join(d, 'qa.md'), 'utf8'), QA.replace('model: opus', 'model: sonnet'))
  })
  it('refuses unknown models, missing roles and paths', () => {
    const d = dir()
    assert.match(setRoleModel(d, 'qa', 'gpt-5') ?? '', /model/)
    assert.match(setRoleModel(d, 'nobody', 'opus') ?? '', /no role/)
    assert.match(setRoleModel(d, '../qa', 'opus') ?? '', /no role/)
    assert.match(setRoleModel(d, 'qa.md', 'opus') ?? '', /no role/)
    assert.equal(fs.readFileSync(path.join(d, 'qa.md'), 'utf8'), QA)
  })
})

describe('hub-role-model command', () => {
  it('takes a role name and one of the picker models', () => {
    assert.equal(commandProblem({ type: 'hub-role-model', role: 'qa', model: 'inherit' }), undefined)
    assert.match(commandProblem({ type: 'hub-role-model', role: 'qa', model: 'gpt-5' }) ?? '', /model/)
    assert.match(commandProblem({ type: 'hub-role-model', model: 'opus' }) ?? '', /role/)
  })
})

const KIT_QA = fs.readFileSync(path.join(__dirname, '..', 'kit', 'agents', 'qa-codex.md'), 'utf8')
const CX = '---\nname: engineer-codex\nmodel: sonnet\n---\nSWITCHBOARD_ROLE_RUN=engineer-codex codex exec --ephemeral --skip-git-repo-check -o "$d/last" - < "$d/prompt"\n'

describe('codexOf and withCodex', () => {
  it('read none when the line has no flags', () => {
    assert.deepEqual(codexOf(CX), { model: undefined, effort: undefined })
    assert.equal(codexOf(QA), undefined)
  })
  it('add both flags right after codex exec, and read them back', () => {
    const next = withCodex(CX, 'gpt-6-luna', 'high') ?? ''
    assert.match(next, /codex exec -m gpt-6-luna -c model_reasoning_effort=high --ephemeral /)
    assert.deepEqual(codexOf(next), { model: 'gpt-6-luna', effort: 'high' })
  })
  it('replace existing flags and drop them for default', () => {
    const one = withCodex(CX, 'gpt-6-luna', 'high') ?? ''
    const two = withCodex(one, 'gpt-5.6-terra', 'default') ?? ''
    assert.deepEqual(codexOf(two), { model: 'gpt-5.6-terra', effort: undefined })
    assert.equal(withCodex(two, 'default', 'default'), CX)
  })
  it('read and rewrite the command line of the real kit file, not its description', () => {
    assert.deepEqual(codexOf(KIT_QA), { model: 'gpt-5.6-luna', effort: 'high' })
    const next = withCodex(KIT_QA, 'gpt-5.6-terra', 'default') ?? ''
    assert.deepEqual(codexOf(next), { model: 'gpt-5.6-terra', effort: undefined })
    assert.equal(next.split('\n')[2], KIT_QA.split('\n')[2])
    assert.equal(withCodex(next, 'gpt-5.6-luna', 'high'), KIT_QA)
  })
  it('refuse a file with no codex exec line', () => {
    assert.equal(withCodex(QA, 'gpt-6-luna', 'high'), undefined)
  })
})

describe('setRoleCodex and the command', () => {
  const dir = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-roles-')); fs.writeFileSync(path.join(d, 'qa.md'), QA); fs.writeFileSync(path.join(d, 'engineer-codex.md'), CX); return d }
  it('rewrites the one role file', () => {
    const d = dir()
    assert.equal(setRoleCodex(d, 'engineer-codex', 'gpt-5.6-luna', 'xhigh'), undefined)
    assert.deepEqual(codexOf(fs.readFileSync(path.join(d, 'engineer-codex.md'), 'utf8')), { model: 'gpt-5.6-luna', effort: 'xhigh' })
  })
  it('refuses unknown picks, plain roles and paths', () => {
    const d = dir()
    assert.match(setRoleCodex(d, 'engineer-codex', 'opus', 'high') ?? '', /model/)
    assert.match(setRoleCodex(d, 'engineer-codex', 'gpt-6-luna', 'huge') ?? '', /effort/)
    assert.match(setRoleCodex(d, 'qa', 'gpt-6-luna', 'high') ?? '', /codex/)
    assert.match(setRoleCodex(d, '../qa', 'gpt-6-luna', 'high') ?? '', /no role/)
    assert.equal(fs.readFileSync(path.join(d, 'qa.md'), 'utf8'), QA)
  })
  it('validates hub-role-codex', () => {
    for (const model of [...CODEX_MODELS, 'default']) assert.equal(commandProblem({ type: 'hub-role-codex', role: 'qa-codex', model, effort: 'default' }), undefined)
    for (const effort of CODEX_EFFORTS) assert.equal(commandProblem({ type: 'hub-role-codex', role: 'qa-codex', model: 'default', effort }), undefined)
    assert.match(commandProblem({ type: 'hub-role-codex', role: 'qa-codex', model: 'opus', effort: 'high' }) ?? '', /model/)
    assert.match(commandProblem({ type: 'hub-role-codex', role: 'qa-codex', model: 'default', effort: 'huge' }) ?? '', /effort/)
    assert.match(commandProblem({ type: 'hub-role-codex', model: 'default', effort: 'high' }) ?? '', /role/)
  })
})

describe('kit role colors', () => {
  const COLORS: Record<string, string> = { researcher: 'blue', engineer: 'red', qa: 'green', designer: 'orange', ops: 'yellow', growth: 'purple', Explore: 'cyan', 'engineer-codex': 'pink', 'qa-codex': 'pink' }
  const dir = path.join(__dirname, '..', 'kit', 'agents')
  it('every kit role file has the color matching the board', () => {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3)).sort()
    assert.deepEqual(files, Object.keys(COLORS).sort())
    for (const role of files) {
      const m = /^color: *(\S+) *\r?$/m.exec(fs.readFileSync(path.join(dir, `${role}.md`), 'utf8').split(/\r?\n---/)[0])
      assert.equal(m?.[1], COLORS[role], role)
    }
  })
})

describe('blind qa', () => {
  const kit = path.join(__dirname, '..', 'kit')
  it('qa judges the diff, not the engineer', () => {
    assert.match(fs.readFileSync(path.join(kit, 'agents', 'qa.md'), 'utf8'), /not the engineer's claims/)
  })
  it('the lead keeps the engineer report out of the qa brief', () => {
    assert.match(fs.readFileSync(path.join(kit, 'rules.md'), 'utf8'), /qa brief carries only the task, the acceptance checks and the diff or paths/)
  })
})
