import { it } from 'node:test'
import assert from 'node:assert/strict'
import { withDeadline } from '../src/hub/deadline'

it('withDeadline gives the answer, or undefined on error and on a slow answer', async () => {
  assert.equal(await withDeadline(async () => 'x', 50), 'x')
  assert.equal(await withDeadline(async () => { throw new Error('no') }, 50), undefined)
  assert.equal(await withDeadline(() => new Promise<string>(r => setTimeout(() => r('late'), 200)), 20), undefined)
})
