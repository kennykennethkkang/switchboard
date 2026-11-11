import { it } from 'node:test'
import * as os from 'os'
import * as path from 'path'
import assert from 'node:assert/strict'
import { isTempDir } from '../src/hub/temp'

it('treats the bench kit under ~/.claude as temp, not the rest of ~/.claude', () => {
  const kit = path.join(os.homedir(), '.claude', 'bench-kit')
  for (const p of [kit, path.join(kit, 'runs', 'a1')]) assert.equal(isTempDir(p), true, p)
  for (const p of [path.join(os.homedir(), '.claude'), path.join(os.homedir(), '.claude', 'bench-kitchen')]) assert.equal(isTempDir(p), false, p)
})
