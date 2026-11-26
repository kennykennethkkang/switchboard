/** The hub state as JSON by top-level field, for the panel's pushes and GET /hub/state. A full state is over 1 MB and mostly still. */

// Over 80% of a state. Each is replaced whole, never edited in place, so its text is kept while the object stays the same.
const BIG = new Set(['tools', 'archive', 'mirofishReports', 'sweep', 'changes', 'repo', 'installed', 'connections', 'smart'])
const kept = new WeakMap<object, string>()

function fieldJson(k: string, v: unknown): string | undefined {
  if (!BIG.has(k) || typeof v !== 'object' || v === null) return JSON.stringify(v)
  let json = kept.get(v)
  if (json === undefined) kept.set(v, json = JSON.stringify(v))
  return json
}

/** Each field's JSON text; an undefined field has none, as in JSON.stringify. */
export function fieldsJson(state: object, only?: ReadonlySet<string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(state)) {
    if (only && !only.has(k)) continue
    const json = fieldJson(k, v)
    if (json !== undefined) out[k] = json
  }
  return out
}

/** JSON.stringify(state), or only the named fields. */
export const stateJson = (state: object, only?: ReadonlySet<string>) =>
  `{${Object.entries(fieldsJson(state, only)).map(([k, json]) => `${JSON.stringify(k)}:${json}`).join(',')}}`
