import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { editorName } from './editor'

describe('editorName', () => {
  it('uses the editor the hub runs in', () => assert.equal(editorName({ editor: 'Cursor' }), 'Cursor'))
  it('falls back to VS Code for an older extension or no state', () => {
    assert.equal(editorName({}), 'VS Code')
    assert.equal(editorName(null), 'VS Code')
  })
})
