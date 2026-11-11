import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shortEditor } from '../src/editor'
import { EDITOR } from '../src/hub/stuck-sampler'

test('shortEditor: names the running editor, VS Code shortened', () => {
  assert.equal(shortEditor('Visual Studio Code'), 'VS Code')
  assert.equal(shortEditor('Visual Studio Code - Insiders'), 'VS Code - Insiders')
  assert.equal(shortEditor('Cursor'), 'Cursor')
  assert.equal(shortEditor(''), 'VS Code')
  assert.equal(shortEditor(undefined), 'VS Code')
})

test('EDITOR guard: every VS Code family helper process', () => {
  for (const c of ['/Applications/Visual Studio Code.app/Contents/MacOS/Electron', 'Code Helper (Plugin)', 'Code - Insiders Helper', 'Cursor Helper (Renderer)',
    '/Applications/Windsurf.app/Contents/Frameworks/Windsurf Helper (Plugin).app/Contents/MacOS/Windsurf Helper (Plugin)',
    '/Applications/Antigravity.app/Contents/Frameworks/Antigravity Helper (Renderer).app/Contents/MacOS/Antigravity Helper (Renderer)',
    '/Applications/VSCodium.app/Contents/Frameworks/VSCodium Helper (GPU).app/Contents/MacOS/VSCodium Helper (GPU)']) assert.match(c, EDITOR, c)
  assert.doesNotMatch('node server.js', EDITOR)
})
