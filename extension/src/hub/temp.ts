import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

// Anchored, so a folder merely named tmp (~/tmp/app) stays a project. Claude scratchpads live under /private/tmp.
const TEMP = /^(\/private)?\/(tmp|var\/folders)\//
const realTmp = () => { try { return fs.realpathSync(os.tmpdir()) } catch { return os.tmpdir() } }
const TMPDIRS = [...new Set([os.tmpdir(), realTmp()])]
/** A chat running in a temp folder: scratchpads, bench runs, headless `claude -p`. Every view reads the hub, which drops these. */
export const isTempDir = (cwd: string) => TEMP.test(cwd) || TMPDIRS.some(d => cwd.startsWith(d + path.sep))
