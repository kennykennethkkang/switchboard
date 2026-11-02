import { test } from 'node:test'
import assert from 'node:assert/strict'
import { focusBack } from './focus-back'

type Fake = { sel: string; buttons: Record<string, string> }
const el = (tree: Fake[]) => ({
  closest: (s: string) => {
    const hit = tree.find(t => s.split(',').map(x => x.trim()).includes(t.sel))
    return hit ? { querySelector: (q: string) => (hit.buttons[q] ? { focus: () => focused.push(hit.buttons[q]) } : null) } : null
  },
})
let focused: string[] = []
const now = (f: () => void) => f()

test('returns focus to the row\'s More button once a Confirm or Rename closes', () => {
  focused = []
  focusBack(el([{ sel: 'li', buttons: { '.hub-more-btn': 'more', button: 'sign in' } }]), now)
  assert.deepEqual(focused, ['more'])
})

test('an app\'s confirm goes back to the app\'s More, not the wrapper row it sits in', () => {
  focused = []
  focusBack(el([{ sel: '.si-row', buttons: { button: 'gone' } }, { sel: '.si-app', buttons: { '.hub-more-btn': 'app more' } }]), now)
  assert.deepEqual(focused, ['app more'])
})

test('a row with no More button gets its first button', () => {
  focused = []
  focusBack(el([{ sel: '.si-row', buttons: { button: 'Delete all backups' } }]), now)
  assert.deepEqual(focused, ['Delete all backups'])
  focusBack(null, now)
  assert.deepEqual(focused, ['Delete all backups'])
})
