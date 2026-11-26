/** Import first: code that takes its paths from the home folder at import then writes to a throwaway one. */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-home-'))
fs.mkdirSync(path.join(home, '.claude', 'switchboard'), { recursive: true })
process.env.HOME = home
process.env.USERPROFILE = home
process.on('exit', () => fs.rmSync(home, { recursive: true, force: true }))
