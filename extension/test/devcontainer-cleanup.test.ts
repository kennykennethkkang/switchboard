import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { containerChats, sweepContainers } from '../src/hub/devcontainer'

// A fake docker: ids in ps, the args docker top prints per id.
const fake = (procs: Record<string, string[]>, calls: string[][] = []) => async (args: string[]) => {
  calls.push(args)
  if (args[0] === 'ps') return Object.keys(procs).join('\n') + '\n'
  if (args[0] === 'top') return ['PID COMMAND', ...(procs[args[1]] ?? []).map((p, i) => `${i + 10}    ${p}`)].join('\n') + '\n'
  return ''
}

describe('container chat liveness', () => {
  it('keys each live claude pid by its container folder label', async () => {
    const calls: string[][] = []
    const live = await containerChats(async args => {
      calls.push(args)
      if (args[0] === 'ps') return 'a1\t/u/Armasu\nb2\t/u/QR-Test\nc3\t/u/Gone\n'
      if (args[1] === 'c3') throw new Error('No such container')
      return args[1] === 'a1' ? '119\n240\n' : ''
    })
    assert.deepEqual([...live].sort(), ['/u/Armasu\n119', '/u/Armasu\n240'])
    assert.deepEqual(calls[0], ['ps', '--filter', 'label=switchboard.dir', '--format', '{{.ID}}\t{{.Label "switchboard.dir"}}'])
    assert.deepEqual(calls[1].slice(0, 4), ['exec', 'a1', 'sh', '-c'])
  })
})

describe('container cleanup on chat end', () => {
  it('removes a container only after claude ran in it and stopped', async () => {
    const seen = new Set<string>(), calls: string[][] = []
    // booting: no claude yet, so it stays
    assert.deepEqual(await sweepContainers(seen, fake({ c1: ['sleep infinity'] }, calls)), [])
    assert.deepEqual(await sweepContainers(seen, fake({ c1: ['sleep infinity', '/usr/local/bin/claude --resume x'] })), [])
    assert.deepEqual(await sweepContainers(seen, fake({ c1: ['sleep infinity', 'node /usr/lib/node_modules/@anthropic-ai/claude-code/cli.js'] })), [])
    const rm: string[][] = []
    assert.deepEqual(await sweepContainers(seen, fake({ c1: ['sleep infinity'] }, rm)), ['c1'])
    assert.deepEqual(rm.at(-1), ['rm', '-f', 'c1'])
    assert.equal(seen.size, 0)
    assert.deepEqual(calls[0], ['ps', '-q', '--filter', 'label=switchboard.dir'])
  })

  it('forgets containers that are gone and skips quietly when Docker is down', async () => {
    const seen = new Set(['old'])
    assert.deepEqual(await sweepContainers(seen, fake({})), [])
    assert.equal(seen.size, 0)
    assert.deepEqual(await sweepContainers(seen, async () => { throw new Error('Cannot connect to the Docker daemon') }), [])
  })

  it('keeps one container whose top fails and still sweeps the rest', async () => {
    const seen = new Set(['a', 'b'])
    const run = async (args: string[]) => {
      if (args[0] === 'ps') return 'a\nb\n'
      if (args[0] === 'top' && args[1] === 'a') throw new Error('gone')
      return 'PID COMMAND\n12  sleep infinity\n'
    }
    assert.deepEqual(await sweepContainers(seen, run), ['b'])
    assert.ok(seen.has('a'))
  })

  it('removes a container claude was never seen in once it has run past booting', async () => {
    const now = Date.parse('2026-11-27T14:00:00Z'), rm: string[] = []
    const started: Record<string, string> = { old: '2026-11-27T13:40:00.123456789Z', young: '2026-11-27T13:55:00Z', odd: '0001-01-01T00:00:00Z' }
    const run = async (args: string[]) => {
      if (args[0] === 'ps') return 'old\nyoung\nodd\nbad\n'
      if (args[0] === 'top') return 'PID COMMAND\n12  sleep infinity\n'
      if (args[0] === 'inspect') { if (args[3] === 'bad') throw new Error('gone'); return started[args[3]] + '\n' }
      rm.push(args[2])
      return ''
    }
    // odd: StartedAt reads as long ago but is Docker's zero time, so it stays like a failed inspect
    assert.deepEqual(await sweepContainers(new Set(), run, now), ['old'])
    assert.deepEqual(rm, ['old'])
  })

  it('tries every ended container when one rm fails, and keeps the failed one for the next sweep', async () => {
    const seen = new Set(['a', 'b']), rm: string[] = []
    const run = async (args: string[]) => {
      if (args[0] === 'ps') return 'a\nb\n'
      if (args[0] === 'top') return 'PID COMMAND\n12  sleep infinity\n'
      rm.push(args[2])
      if (args[2] === 'a') throw new Error('busy')
      return ''
    }
    await assert.rejects(sweepContainers(seen, run), /a: busy.*removed b/)
    assert.deepEqual(rm, ['a', 'b'])
    assert.deepEqual([...seen], ['a'])
  })
})
