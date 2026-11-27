import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newChatInputs } from '../src/hub/new-chat-inputs'

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

test('waits for the longer of the run pick and title', async () => {
  let titleStarted = false
  let toolsStarted = false
  let titleReady!: () => void
  let toolsReady!: () => void
  const titleStartedPromise = new Promise<void>(resolve => { titleReady = resolve })
  const toolsStartedPromise = new Promise<void>(resolve => { toolsReady = resolve })
  const inputs = newChatInputs('claude', async () => {
    let timeout: ReturnType<typeof setTimeout>
    try {
      await Promise.race([
        Promise.all([titleStartedPromise, toolsStartedPromise]),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Title and tools did not start before the run pick')), 1000) }),
      ])
    } finally { clearTimeout(timeout!) }
    assert.equal(titleStarted, true)
    assert.equal(toolsStarted, true)
    await delay(70)
    return { ai: 'claude' }
  }, async () => { titleStarted = true; titleReady(); await delay(70); return 'Title' })
  const [picked, title, tools] = await Promise.all([inputs.picked, inputs.title, inputs.toolPick(async () => { toolsStarted = true; toolsReady(); await delay(70); return 'tools' })])
  assert.equal(picked.ai, 'claude')
  assert.equal(title, 'Title')
  assert.equal(tools, 'tools')
})

test('auto waits for the run pick before starting Claude tool pick', async () => {
  let picked = false
  const inputs = newChatInputs('auto', async () => { await delay(20); picked = true; return { ai: 'claude' } }, async () => 'Title')
  const toolPick = inputs.toolPick(async () => { assert.equal(picked, true); return 'tools' })
  assert.equal(await toolPick, 'tools')
})

test('does not start Claude tool pick for a Codex run', async () => {
  let toolPickStarted = false
  const inputs = newChatInputs('auto', async () => ({ ai: 'codex' }), async () => 'Title')
  const toolPick = inputs.toolPick(async () => { toolPickStarted = true; return 'tools' })
  assert.equal(await toolPick, undefined)
  assert.equal(toolPickStarted, false)
})

test('a failed auto pick skips the tool pick', async () => {
  const inputs = newChatInputs('auto', async () => { throw new Error('pick failed') }, async () => 'Title')
  const toolPick = inputs.toolPick(async () => 'tools')
  await assert.rejects(inputs.picked, /pick failed/)
  assert.equal(await toolPick, undefined)
})
