/**
 * The Learn run's contradiction probe: notes that seed the same recall query are paired, Jev judges each pair once
 * (cached by both notes' text), and readGraph lists the hits as health.probed for memory-fix to walk. Report only: no note is changed.
 */
import { execFile } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { writeJsonAtomic } from '../fs-utils'
import { PROBE_AT, PROBE_MODEL, PROBE_V, probedPairs, probeFile, probeKey, readGraph, seedsOf, typedPairs, type GraphNode, type MemoryGraph, type ProbeVerdict } from './graph'
import { JEV } from './picker'
import type { HubState } from './types'

// shortcut: at most this many new pairs judged per run; the cache fills the rest over later runs.
export const PROBE_MAX = 400
const PRESET = {
  name: 'memory-contradiction', version: PROBE_V, model: PROBE_MODEL,
  description: 'Do two memory notes say things that cannot both be true. Used by Switchboard\'s Learn run',
  state_fields: ['a', 'b'], display_fields: ['_id'],
  questions: { conflict: { type: 'noul', instructions: 'Do `a` and `b` make claims about the same thing that cannot both hold, such as different values, opposite instructions, or one saying a step works where the other says it fails? Notes on different subjects, or one adding detail the other lacks, do not conflict.' } },
  thresholds: { conflict: { low: 1 - PROBE_AT, high: PROBE_AT } },
  rules: [],
}

const KINDS = new Set<GraphNode['kind']>(['memory', 'wiki'])
// memory:<folder>/<name>; vault notes have no folder.
const folder = (id: string) => (id.startsWith('memory:') ? id.slice(7, id.indexOf('/')) : undefined)

/** Live memory and wiki notes in the top 3 of one query (each note's description or name, then extra queries), as sorted pairs.
 * Notes from two project folders are not paired: a rule may differ by project. Pairs with a typed relation are left out. */
export async function probePairs(graph: MemoryGraph, queries: string[] = []): Promise<[GraphNode, GraphNode][]> {
  const live = graph.nodes.filter(n => KINDS.has(n.kind) && !n.superseded)
  const typed = typedPairs(graph), pairs = new Map<string, [GraphNode, GraphNode]>()
  for (const q of [...live.map(n => n.description || n.label), ...queries]) {
    const s = seedsOf(graph, q).filter(n => KINDS.has(n.kind) && !n.superseded).sort((a, b) => a.id.localeCompare(b.id))
    for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) {
      const k = `${s[i].id}\n${s[j].id}`, fa = folder(s[i].id), fb = folder(s[j].id)
      if (!(fa && fb && fa !== fb) && !typed.has(k)) pairs.set(k, [s[i], s[j]])
    }
    // Hundreds of queries: let the extension host breathe between them.
    await new Promise(r => setImmediate(r))
  }
  return [...pairs.values()]
}

export type Ask = (preset: string, input: string) => Promise<string | undefined>
const viaJev: Ask = (preset, input) => new Promise(done => execFile('python3', [JEV, 'ask', '--preset', preset, '--input', input, '--concurrency', '8', '--max-chars', '3000'],
  { timeout: 10 * 60_000, maxBuffer: 16 << 20 }, (err, out) => done(err ? undefined : String(out))))
const side = (n: GraphNode) => `${n.label}: ${n.description ?? ''}\n\n${n.text ?? ''}`

/** Judges the pairs it has no verdict for, keeps verdicts only for pairs still found, and says what it found. */
export async function probeMemory(state: HubState, ask: Ask = viaJev, home = os.homedir(), read: (s: HubState, home: string) => Promise<MemoryGraph> = readGraph): Promise<string> {
  if (ask === viaJev && !fs.existsSync(JEV)) return 'contradiction probe skipped: Jev is not installed'
  const graph = await read(state, home), file = probeFile(home)
  const json = <T>(f: string, or: T): T => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) as T } catch { return or } }
  const old = json<{ pairs?: Record<string, ProbeVerdict> }>(file, {}).pairs ?? {}
  const gold = json<Array<{ q?: unknown }>>(path.join(home, '.claude', 'memory-gold.json'), []).map(g => g?.q).filter((q): q is string => typeof q === 'string')
  const keyed = (await probePairs(graph, Array.isArray(gold) ? gold : [])).map(([a, b]) => ({ k: probeKey(a, b), a, b }))
  const pairs: Record<string, ProbeVerdict> = Object.fromEntries(keyed.filter(x => old[x.k]).map(x => [x.k, old[x.k]]))
  const fresh = keyed.filter(x => !old[x.k]).slice(0, PROBE_MAX)
  let judged = 0
  if (fresh.length) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-probe-'))
    try {
      fs.writeFileSync(path.join(dir, 'preset.json'), JSON.stringify(PRESET))
      fs.writeFileSync(path.join(dir, 'items.json'), JSON.stringify(fresh.map(x => ({ _id: x.k, a: side(x.a), b: side(x.b) }))))
      const out = await ask(path.join(dir, 'preset.json'), path.join(dir, 'items.json'))
      if (out === undefined) return `contradiction probe: Jev failed on ${fresh.length} pairs`
      const byKey = new Map(fresh.map(x => [x.k, x]))
      for (const line of out.split('\n')) {
        let r: { _id?: unknown; conflict?: unknown }
        try { r = JSON.parse(line) } catch { continue }
        const x = typeof r._id === 'string' ? byKey.get(r._id) : undefined
        if (x && typeof r.conflict === 'number') { pairs[x.k] = { a: x.a.id, b: x.b.id, p: r.conflict }; judged++ }
      }
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  writeJsonAtomic(file, { v: PROBE_V, pairs })
  const hits = probedPairs(graph, pairs).length
  return `contradiction probe: ${judged} of ${keyed.length} pairs judged now${fresh.length > judged ? ` (${fresh.length - judged} failed, retried next run)` : ''}, ${hits} possible contradiction${hits === 1 ? '' : 's'}`
}
