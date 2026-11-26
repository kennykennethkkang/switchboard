// node scripts/env.js NAME=value ... -- command args
// Inline NAME=value only works in sh; pnpm runs scripts in cmd.exe on Windows.
const { spawnSync } = require('child_process')
const args = process.argv.slice(2)
const cut = args.indexOf('--')
const env = { ...process.env }
for (const a of args.slice(0, cut)) { const i = a.indexOf('='); env[a.slice(0, i)] = a.slice(i + 1) }
const cmd = args.slice(cut + 1).map(a => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')
const r = spawnSync(cmd, { stdio: 'inherit', env, shell: true })
process.exit(r.status ?? 1)
