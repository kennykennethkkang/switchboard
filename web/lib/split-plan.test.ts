import { test } from 'node:test'
import assert from 'node:assert/strict'
import { looksMulti, mergeBack, newGroupId } from './split-plan'

test('looksMulti: real multi asks', () => {
  assert.equal(looksMulti("Please fix it so it doesn't require user access to use plugins and switchboard gives automatic access to it. Using gemini or any other skills look at these videos. Please make sure cache keeper is implemented. Remove any redundancy inside of instructions. Also allow user to click on lead to see what is going on."), true)
  assert.equal(looksMulti('Make sure to rename agent-flow folder into switchboard do it all for me. Also another thing to make sure is if any mcp needs a key it asks once.'), true)
})

test('looksMulti: lists of two or more', () => {
  assert.equal(looksMulti('1. fix the login loop\n2. add dark mode'), true)
  assert.equal(looksMulti('- fix the login loop\n- add dark mode'), true)
  assert.equal(looksMulti('Do these: 1) fix the login loop 2) add dark mode'), true)
  assert.equal(looksMulti('1. fix the login loop'), false)
})

test('looksMulti: single asks stay single', () => {
  assert.equal(looksMulti('Please ask all questions at the beginning and then let me know when it is ready for ship.'), false)
  assert.equal(looksMulti('Fix the login redirect. It loops on Safari.'), false)
  assert.equal(looksMulti('Add version 2.0 support'), false)
  assert.equal(looksMulti(''), false)
})

test('looksMulti: a later sentence opening with a joiner', () => {
  assert.equal(looksMulti('Fix the login redirect. Plus, add a dark mode toggle.'), true)
  assert.equal(looksMulti('Fix the login redirect. And then add a dark mode toggle.'), true)
  assert.equal(looksMulti('Fix the login redirect. Another thing: the footer overlaps on phones.'), true)
})

test('looksMulti: inline numbered asks, a joiner on a new line or after a comma, second and third', () => {
  assert.equal(looksMulti('Switchboard to-do, in this order: 1. Release the agent drawer. 2. Fix worktrees.'), true)
  assert.equal(looksMulti('Fix the header spacing\nAlso the to-do list keeps finished items'), true)
  assert.equal(looksMulti('Lets do research on switchboard, also did you add the stage view'), true)
  assert.equal(looksMulti('Couple of issues the to-do tracks finished items. Second is that the folder is still called agent flow.'), true)
  assert.equal(looksMulti('Bump it to 2. Then ship it.'), false)
  assert.equal(looksMulti('Refactor the parser, and then run the tests.'), false)
  assert.equal(looksMulti('Make the list scroll, plus keep the header fixed.'), false)
  assert.equal(looksMulti('Fix the login redirect. Third-party auth breaks on Safari.'), false)
})

test('newGroupId is g- and base36 time', () => {
  assert.equal(newGroupId(1_800_000_000_000), `g-${(1_800_000_000_000).toString(36)}`)
  assert.match(newGroupId(), /^g-[0-9a-z]+$/)
})

test('mergeBack: untouched asks give the original message back', () => {
  assert.equal(mergeBack('1. a\n2. b', ['a', 'b'], ['a', 'b']), '1. a\n2. b')
})

test('mergeBack: edited, removed or blank asks keep what is left', () => {
  assert.equal(mergeBack('1. a\n2. b', ['a', 'b'], ['a2', 'b']), 'a2\n\nb')
  assert.equal(mergeBack('1. a\n2. b\n3. c', ['a', 'b', 'c'], ['a', 'c']), 'a\n\nc')
  assert.equal(mergeBack('1. a\n2. b', ['a', 'b'], ['a', '  ']), 'a')
})
