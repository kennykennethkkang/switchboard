const esbuild = require('esbuild')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const watch = process.argv.includes('--watch')

/** @type {import('esbuild').BuildOptions} */
const config = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  minify: !watch,
}

// claude-mods/kit's rules and role agents ship in the VSIX (kit/), so a machine without the kit gets them too.
const KIT_SRC = process.env.CLAUDE_MODS_KIT || path.join(__dirname, '..', '..', 'claude-mods', 'kit')
const KIT_OUT = path.join(__dirname, 'kit')
// Refuse to bundle anything that looks like a key.
const SECRET = /sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY|gh[pousr]_[A-Za-z0-9]{30,}|xox[abp]-[A-Za-z0-9-]{10,}/
const sha = text => crypto.createHash('sha256').update(text).digest('hex').slice(0, 12)
// The VSIX goes to other people: their rules name the user, gender neutral. Kenneth's own copy has the same version, so his stays.
const genericRules = text => text.replace(/Kenneth('s)?/g, (_, s) => `the user${s ?? ''}`).replace(/\bhimself\b/g, 'themselves').replace(/\bhis own\b/g, 'their own').replace(/(^|[.!?] |^- |\/\/ |\/\*\* |['"`])the user/gm, '$1The user')
// Same marker as src/hub/rules.ts GENERIC: a generic bundle never replaces a kit copy without it.
const GENERIC = '<!-- switchboard generic copy -->'
const marked = text => `${genericRules(text).trimEnd()}\n\n${GENERIC}\n`

function bundleKit() {
  if (!fs.existsSync(path.join(KIT_SRC, 'rules.md'))) {
    console.warn(`kit: ${KIT_SRC} not found, keeping the bundled copy in kit/`)
    return
  }
  const read = p => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : undefined)
  const old = JSON.parse(read(path.join(KIT_OUT, 'bundle.json')) ?? '{"history":{}}')
  const files = [['rules.md', path.join(KIT_SRC, 'rules.md')], ...fs.readdirSync(path.join(KIT_SRC, 'agents')).filter(n => n.endsWith('.md')).map(n => [`agents/${n}`, path.join(KIT_SRC, 'agents', n)])]
  for (const [, src] of files) if (SECRET.test(fs.readFileSync(src, 'utf8'))) throw new Error(`kit: ${src} looks like it holds a secret; not bundled`)
  const rules = marked(fs.readFileSync(path.join(KIT_SRC, 'rules.md'), 'utf8'))
  // Same version as kit/setup.mjs writes: when rules.md last changed, kept while its text is unchanged.
  const rulesVersion = read(path.join(KIT_OUT, 'rules.md')) === rules && old.rulesVersion ? old.rulesVersion : `${fs.statSync(path.join(KIT_SRC, 'rules.md')).mtime.toISOString().slice(0, 19)}Z`
  const history = old.history ?? {}
  fs.mkdirSync(path.join(KIT_OUT, 'agents'), { recursive: true })
  // A role the kit dropped leaves the bundle too.
  for (const n of fs.readdirSync(path.join(KIT_OUT, 'agents'))) if (!files.some(([name]) => name === `agents/${n}`)) fs.rmSync(path.join(KIT_OUT, 'agents', n))
  for (const [name, src] of files) {
    const text = marked(fs.readFileSync(src, 'utf8')), prev = read(path.join(KIT_OUT, name))
    // An earlier bundled copy of a role: a user file matching it was never edited, so it may be updated.
    if (name.startsWith('agents/') && prev !== undefined && prev !== text) {
      const key = path.basename(name)
      history[key] = [...new Set([...(history[key] ?? []), sha(prev)])]
    }
    fs.writeFileSync(path.join(KIT_OUT, name), text)
  }
  fs.writeFileSync(path.join(KIT_OUT, 'bundle.json'), `${JSON.stringify({ rulesVersion, generic: true, history }, null, 2)}\n`)
  console.log(`kit: bundled rules.md (${rulesVersion}) and ${files.length - 1} role agents`)
}

// The mods and their marketplace manifest ship too (kit/mods), for Set up on a machine without claude-mods.
const MODS = ['usage-meter', 'repo-rules', 'paid-guard', 'cache-keeper']
const MODS_OUT = path.join(KIT_OUT, 'mods')

function bundleMods() {
  const root = path.dirname(KIT_SRC)
  if (!fs.existsSync(path.join(root, '.claude-plugin', 'marketplace.json'))) {
    console.warn(`mods: ${root} not found, keeping the bundled copy in kit/mods`)
    return
  }
  fs.rmSync(MODS_OUT, { recursive: true, force: true })
  for (const dir of ['.claude-plugin', ...MODS]) {
    fs.cpSync(path.join(root, dir), path.join(MODS_OUT, dir), { recursive: true, filter: src => !/[\\/](tests|node_modules)$|\.DS_Store$/.test(src) })
  }
  for (const f of fs.readdirSync(MODS_OUT, { recursive: true })) {
    const p = path.join(MODS_OUT, f)
    if (!fs.statSync(p).isFile()) continue
    const text = fs.readFileSync(p, 'utf8')
    if (SECRET.test(text)) throw new Error(`mods: ${p} looks like it holds a secret; not bundled`)
    // Hooks and descriptions name the user too; author and owner names are credit and stay.
    fs.writeFileSync(p, p.endsWith('.json') ? text.replace(/"description": "[^"]*"/g, genericRules) : genericRules(text))
  }
  console.log(`mods: bundled ${MODS.join(', ')}`)
}

// Switchboard's own skills (setup.json "own") ship in kit/skills; Set up copies them to ~/.claude/skills.
const SKILLS_OUT = path.join(KIT_OUT, 'skills')
const ownSkills = () => JSON.parse(fs.readFileSync(path.join(KIT_OUT, 'setup.json'), 'utf8')).own ?? []
// A name becomes a path under kit/skills and ~/.claude/skills: one folder, nothing that climbs out.
const plainName = n => typeof n === 'string' && n !== '' && n !== '.' && n !== '..' && !/[\\/]/.test(n)
// UTF-16 text has NUL bytes too: its decoded text, else '' for what does not decode (a clip or a frame).
const utf16 = buf => { try { return new TextDecoder(buf[0] === 0xfe && buf[1] === 0xff ? 'utf-16be' : 'utf-16le', { fatal: true }).decode(buf) } catch { return '' } }

function bundleSkills(kitSrc = KIT_SRC, out = SKILLS_OUT, own = ownSkills()) {
  for (const n of own) if (!plainName(n)) throw new Error(`skills: ${JSON.stringify(n)} is not a plain folder name`)
  // Checked before anything is removed, so a refused build keeps the old bundle.
  for (const n of own) if (fs.lstatSync(path.join(kitSrc, 'skills', n), { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error(`skills: ${n} is a symlink in ${kitSrc}/skills; bundle a real folder`)
  fs.mkdirSync(out, { recursive: true })
  for (const n of fs.readdirSync(out)) if (!own.includes(n)) fs.rmSync(path.join(out, n), { recursive: true, force: true })
  for (const name of own) {
    const src = path.join(kitSrc, 'skills', name), to = path.join(out, name)
    if (!fs.existsSync(path.join(src, 'SKILL.md'))) { console.warn(`skills: ${src} not found, keeping the bundled copy`); continue }
    fs.rmSync(to, { recursive: true, force: true })
    // No symlinks: the name swap below would write through one into the file it points at.
    fs.cpSync(src, to, { recursive: true, filter: s => !/[\\/](\.DS_Store|__pycache__)$/.test(s) && !fs.lstatSync(s).isSymbolicLink() })
    for (const f of fs.readdirSync(to, { recursive: true })) {
      const p = path.join(to, f)
      if (!fs.lstatSync(p).isFile()) continue
      const buf = fs.readFileSync(p)
      // A NUL byte means a clip, a frame or UTF-16 text: copied as is, never renamed; UTF-16 is still scanned.
      if (buf.includes(0)) { if (SECRET.test(utf16(buf))) throw new Error(`skills: ${p} looks like it holds a secret; not bundled`); continue }
      const text = buf.toString('utf8')
      if (SECRET.test(text)) throw new Error(`skills: ${p} looks like it holds a secret; not bundled`)
      // SKILL.md carries GENERIC, so Set up knows an installed copy is ours to refresh.
      fs.writeFileSync(p, f === 'SKILL.md' ? marked(text) : genericRules(text))
    }
  }
  console.log(`skills: bundled ${own.join(', ')}`)
}

// The browser app (app/dist: app.js and webview/) ships in dist/app, so Open in browser and Phone work from the vsix alone.
const APP_SRC = path.join(__dirname, '..', 'app', 'dist')
const APP_OUT = path.join(__dirname, 'dist', 'app')

function bundleApp() {
  if (!fs.existsSync(path.join(APP_SRC, 'app.js')) || !fs.existsSync(path.join(APP_SRC, 'webview', 'index.js'))) {
    console.warn(`app: ${APP_SRC} not built (node app/build.js), keeping the bundled copy in dist/app`)
    return
  }
  fs.rmSync(APP_OUT, { recursive: true, force: true })
  fs.cpSync(APP_SRC, APP_OUT, { recursive: true })
  console.log('app: bundled app/dist into dist/app')
}

// dist/build.txt: which build this is, so a same-version reinstall can tell it differs (src/hub/self-update.ts pendingReload).
const stamp = list => {
  const h = crypto.createHash('sha256')
  for (const f of list) h.update(path.relative(__dirname, f)).update(fs.readFileSync(f))
  return h.digest('hex').slice(0, 16)
}
const tree = dir => (fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).map(f => path.join(dir, f)).filter(f => fs.statSync(f).isFile()).sort() : [])

// Everything the vsix ships that a window loads at start; a change in any of them is a new build.
const stampFiles = root => [path.join(root, 'dist', 'extension.js'), path.join(root, 'package.json'),
  ...['dist/app', 'dist/webview', 'kit', 'ask', 'voice', 'media', 'keeper'].flatMap(d => tree(path.join(root, d)))]

function writeStamp() {
  const id = stamp(stampFiles(__dirname))
  fs.writeFileSync(path.join(__dirname, 'dist', 'build.txt'), `${id}\n`)
  console.log(`build: ${id}`)
}

async function main() {
  bundleKit()
  bundleMods()
  bundleSkills()
  bundleApp()
  if (watch) {
    const ctx = await esbuild.context(config)
    await ctx.watch()
    console.log('Watching for changes...')
  } else {
    await esbuild.build(config)
    writeStamp()
    console.log('Build complete')
  }
}

module.exports = { genericRules, GENERIC, stamp, stampFiles, bundleSkills }

if (require.main === module) main().catch((e) => {
  console.error(e)
  process.exit(1)
})
