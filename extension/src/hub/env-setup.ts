/**
 * Writes a project's .env from saved keys: a built-in recipe, else .env.example / .env.sample.
 * A set value is never overwritten. The result holds names only; values never leave this file.
 */
import * as fs from 'fs'
import * as path from 'path'
import { isKeyName, redact, type KeyStore } from './keys'
import type { ApiKeyName, EnvSetup } from './types'

type Want = { key?: ApiKeyName; value?: string }

// Keyed by folder name, lower case. A recipe replaces the template so optional keys stay out.
const RECIPES: Record<string, Record<string, Want>> = {
  mirofish: {
    // local Ollama costs nothing; sb-pilot.py picks free or paid OpenRouter per run
    LLM_API_KEY: { value: 'ollama' },
    LLM_BASE_URL: { value: 'http://localhost:11434/v1' },
    LLM_MODEL_NAME: { value: 'gemma3-mirofish' },
    ZEP_API_KEY: { key: 'ZEP_API_KEY' },
    OASIS_DEFAULT_MAX_ROUNDS: { value: '10' },
  },
}
const TEMPLATES = ['.env.example', '.env.sample']
const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/
// Template stand-ins count as unset: your_api_key_here, changeme, <token>.
const unset = (v: string) => { const s = v.replace(/^["']|["']$/g, ''); return !s || /^your[_-]|_here$|^changeme$|^<.*>$/i.test(s) }

function fromTemplate(dir: string): Record<string, Want> | undefined {
  const t = TEMPLATES.map(f => path.join(dir, f)).find(f => fs.existsSync(f))
  if (!t) return undefined
  const out: Record<string, Want> = {}
  for (const l of fs.readFileSync(t, 'utf8').split(/\r?\n/)) {
    const m = LINE.exec(l)
    if (!m) continue
    out[m[1]] = isKeyName(m[1]) ? { key: m[1] } : unset(m[2]) ? {} : { value: m[2] }
  }
  return out
}

const writeAtomic = (file: string, text: string) => {
  const tmp = `${file}.tmp-${process.pid}`
  try {
    fs.writeFileSync(tmp, text, { mode: 0o600 })
    fs.chmodSync(tmp, 0o600)
    fs.renameSync(tmp, file)
  } finally { fs.rmSync(tmp, { force: true }) }
}

export function envSetup(dir: string, store: KeyStore, o: { write?: (file: string, text: string) => void; now?: number } = {}): EnvSetup | { error: string } {
  let want: Record<string, Want> | undefined
  try { want = RECIPES[path.basename(dir).toLowerCase()] ?? fromTemplate(dir) } catch (err) { return { error: `could not read the template: ${(err as NodeJS.ErrnoException).code ?? 'error'}` } }
  if (!want) return { error: `no recipe, ${TEMPLATES.join(' or ')} in ${path.basename(dir)}` }
  const file = path.join(dir, '.env')
  let lines: string[] = []
  try { lines = fs.readFileSync(file, 'utf8').split(/\r?\n/) } catch (err) {
    // Only a missing file starts fresh; anything else would wipe the values in it.
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') return { error: `could not read the .env: ${code ?? 'error'}` }
  }
  if (lines.at(-1) === '') lines.pop()
  const at = new Map<string, number>()
  lines.forEach((l, i) => { const m = LINE.exec(l); if (m) at.set(m[1], i) })

  const r: EnvSetup = { folder: dir, file, filled: [], kept: [], missing: [], at: o.now ?? Date.now() }
  const secrets: string[] = []
  for (const [name, w] of Object.entries(want)) {
    const i = at.get(name)
    if (i !== undefined && !unset(LINE.exec(lines[i])![2])) { r.kept.push(name); continue }
    const v = w.key ? store.get(w.key) : w.value
    if (w.key && v) secrets.push(v)
    if (v) r.filled.push(name)
    else r.missing.push(w.key ? { name, key: w.key } : { name })
    const line = `${name}=${v ?? ''}`
    if (i !== undefined) lines[i] = line
    else lines.push(line)
  }
  try { (o.write ?? writeAtomic)(file, lines.join('\n') + '\n') } catch (err) {
    return { error: redact(`could not write ${file}: ${(err as Error).message}`, secrets) }
  }
  return r
}

/** After a key is saved: fills each listed project whose recipe uses it. Template projects wait for the button. */
export const fillRecipes = (dirs: string[], name: ApiKeyName, store: KeyStore) =>
  [...new Set(dirs)].filter(d => Object.values(RECIPES[path.basename(d).toLowerCase()] ?? {}).some(w => w.key === name)).map(d => envSetup(d, store))
