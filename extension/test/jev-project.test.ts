import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { jevProject, presetFor } from '../src/hub/jev-project'

const tmp = (name = '') => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-proj-')); const f = path.join(d, name); fs.mkdirSync(f, { recursive: true }); return f }
const line = (o: object) => JSON.stringify(o) + '\n'

describe('jev project', () => {
  it('finds a project preset by the repo name, lower case', () => {
    const repo = tmp('My App'), presets = tmp()
    fs.mkdirSync(path.join(repo, '.git'))
    fs.mkdirSync(path.join(repo, 'web'))
    assert.equal(presetFor(path.join(repo, 'web'), 'done', presets), undefined)
    fs.writeFileSync(path.join(presets, 'my-app-done.json'), '{}')
    assert.equal(presetFor(path.join(repo, 'web'), 'done', presets), path.join(presets, 'my-app-done.json'))
  })

  it('shows which jobs are on, the newest runs and their cost', () => {
    const repo = tmp('demo'), presets = tmp(), live = tmp()
    fs.mkdirSync(path.join(repo, '.git'))
    for (const j of ['done', 'gate', 'tells', 'route']) fs.writeFileSync(path.join(presets, `demo-${j}.json`), '{}')
    fs.mkdirSync(path.join(repo, '.claude'))
    // The gate hook is in, the tells hook is not: tells is off though its preset exists.
    fs.writeFileSync(path.join(repo, '.claude', 'settings.local.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node "$HOME/.claude/skills/claude-x-jev/scripts/jev-project.mjs" guard' }] }] } }))
    fs.writeFileSync(path.join(live, '100-1.jsonl'), line({ t: 'start', preset: 'demo-done', items: 3, at: 100 }) + line({ t: 'end', at: 101, cost: 0.0002 }))
    fs.writeFileSync(path.join(live, '300-1.jsonl'), line({ t: 'start', preset: 'demo-tells', items: 12, at: 300 }) + line({ t: 'end', at: 301, cost: 0.0004, flagged: 2 }))
    fs.writeFileSync(path.join(live, '200-1.jsonl'), line({ t: 'start', preset: 'other-done', items: 3, at: 200 }) + line({ t: 'end', at: 201, cost: 1 }))
    fs.writeFileSync(path.join(live, 'gate.jsonl'), line({ t: 'gate', at: 250, preset: 'demo-gate', decision: 'ask', cost: 0.00002 }) + line({ t: 'gate', at: 260, preset: 'other-gate', decision: 'ask', cost: 1 }) + 'half a li')
    const p = jevProject(repo, presets, live)
    assert.equal(p.project, 'demo')
    assert.deepEqual(p.jobs, { done: true, gate: true, tells: false, route: true })
    assert.deepEqual(p.runs.map(r => [r.job, r.at, r.items, r.result]), [['tells', 300, 12, '2 flagged'], ['gate', 250, 1, 'ask'], ['done', 100, 3, undefined]])
    assert.equal(p.costUsd.toFixed(5), '0.00062')
  })

  it('a project with nothing set up shows every job off and no runs', () => {
    const repo = tmp('bare')
    const p = jevProject(repo, tmp(), path.join(tmp(), 'missing'))
    assert.deepEqual(p.jobs, { done: false, gate: false, tells: false, route: false })
    assert.deepEqual(p.runs, [])
  })

})
