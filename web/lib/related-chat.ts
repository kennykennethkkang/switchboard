/** New chat's "Related: X. Send there instead?": the live chat whose name and task read most like the new text. */
import type { ChatRow } from './hub-types'
import { inProject } from './start-wait'

// route_test.py's tokenizing. Replay on 28 days of typed prompts (2026-11-12): every 0.2 hit was filler, link bits or the project name, hence the extra stopwords.
const STOP = new Set('the and for that this with you are not but have from what when then them they your just also into only like make made need want can will its was were all any each one two use using should would could about there here which out how get see new add now our more than some been does done did dont it is to of in on a an be as at by or if do so we i my me no yes please sure these those inside other directly being rather including works ask questions issue issues still seems'.split(' '))
const MIN = 0.2

// To-do dispatches share a header and footer (extension/src/hub/todo.ts); keep the first item's text.
const stripTemplate = (t: string) => t
  .replace(/(Switchboard to-do, in this order:\s*1\.\s*)+/g, '')
  .replace(/\(id [\w-]+[^)]*\)[\s\S]*/, '')
  .replace(/Do prerequisites first\.[\s\S]*/, '')

export const words = (t: string) => (stripTemplate(t).replace(/https?:\/\/\S+/g, '').toLowerCase().match(/[a-z][a-z0-9]+/g) ?? []).filter(w => w.length > 2 && !STOP.has(w))

/** texts: a chat's task or first prompt by sessionId, read with its name. */
export function relatedChat(text: string, chats: ChatRow[], project?: string, texts: Record<string, string> = {}): { sessionId: string; name: string; score: number } | undefined {
  const pool = chats.filter(c => c.live && c.takes && (!project || inProject(c, project)))
  const own = new Set(words((project ?? '').split('/').pop() ?? ''))
  const q = words(text).filter(w => !own.has(w))
  if (!q.length || !pool.length) return
  const docs = [q, ...pool.map(c => words(`${c.name ?? ''} ${texts[c.sessionId] ?? ''}`).filter(w => !own.has(w)))].map(ws => {
    const tf = new Map<string, number>()
    for (const w of ws) tf.set(w, (tf.get(w) ?? 0) + 1)
    return tf
  })
  const df = new Map<string, number>()
  for (const d of docs) for (const w of d.keys()) df.set(w, (df.get(w) ?? 0) + 1)
  // ponytail: +1 smoothing (the replay had hundreds of docs; here a lone shared word would weigh 0). Calibrate on a live corpus if 0.2 misfires.
  const vec = (d: Map<string, number>) => {
    const v = new Map([...d].map(([w, c]) => [w, (1 + Math.log(c)) * (Math.log((docs.length + 1) / (df.get(w)! + 1)) + 1)] as const))
    const norm = Math.hypot(...v.values()) || 1
    for (const [w, x] of v) v.set(w, x / norm)
    return v
  }
  const [qv, ...vs] = docs.map(vec)
  let best: { sessionId: string; name: string; score: number } | undefined
  vs.forEach((v, i) => {
    let s = 0
    for (const [w, x] of qv) s += x * (v.get(w) ?? 0)
    if (s >= MIN && (!best || s > best.score)) best = { sessionId: pool[i].sessionId, name: pool[i].name ?? pool[i].sessionId.slice(0, 8), score: s }
  })
  return best
}
