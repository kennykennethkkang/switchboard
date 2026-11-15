// chats_check and chats_wait for chats that have no chat-wait mod (Codex). Same rules and wording as
// kit/mods/chat-wait/hooks/register.ts, which is TypeScript on the Claude hook engine and cannot be imported here: keep them in step.
const APPROVE = 'Approve this chat as finished'
const GRACE_MS = 10 * 60_000
export const STEP_MS = 4 * 60_000
export const POLL_MS = 5000
export const NO_HUB = 'No Switchboard window holds this folder, so other chats cannot be seen.'
export const REMOVED = 'The user removed this wait in Switchboard; continue on your own.'

export const norm = p => p.replace(/\\/g, '/').replace(/\/+$/, '')
const inside = (p, dir) => p === dir || p.startsWith(`${dir}/`)

export function peersOf(s, self, cwd) {
  const own = s.chats.find(c => c.sessionId === self)
  const home = norm(own?.cwd ?? cwd)
  return s.chats.filter(c => c.live && c.sessionId !== self && (own?.project && c.project
    ? own.project === c.project
    : inside(norm(c.cwd), home) || inside(home, norm(c.cwd))))
}

export function matchTargets(peers, wanted) {
  const ids = [], missing = []
  for (const w of wanted.map(x => x.trim()).filter(Boolean)) {
    const hit = peers.find(p => p.name?.toLowerCase() === w.toLowerCase())
      ?? peers.find(p => p.sessionId === w || (w.length >= 4 && p.sessionId.startsWith(w)))
    if (hit) { if (!ids.includes(hit.sessionId)) ids.push(hit.sessionId) } else missing.push(w)
  }
  return { ids, missing }
}

export function waitsOn(links = [], from, to) {
  const seen = new Set(), next = [from]
  while (next.length) {
    const at = next.pop()
    for (const id of links.filter(l => l.from === at).flatMap(l => l.to)) {
      if (id === to) return true
      if (!seen.has(id)) { seen.add(id); next.push(id) }
    }
  }
  return false
}

export function outcomeOf(p) {
  if (!p) return { finished: true, clean: false }
  if (p.limited) return { finished: false, clean: false }
  if (p.state === 'needs-you' && p.question?.includes(APPROVE) && !p.running?.length) return { finished: true, clean: p.tests?.ok !== false }
  if ((p.running?.length || p.waiting || p.jobs?.length) && p.state !== 'done') return { finished: false, clean: false }
  const worked = p.tasks.length > 0 || !!p.report
  const finished = p.state === 'done' || p.state === 'needs-you' || (p.state === 'idle' && worked)
  return { finished, clean: finished && p.state !== 'needs-you' && p.tests?.ok !== false }
}

/** missing: id -> when its progress first went missing; a live target with none is a reload for GRACE_MS. */
export function outcomeIn(s, id, now, missing = new Map()) {
  const p = s.progress.find(x => x.sessionId === id)
  if (s.pause?.chats?.some(c => c.sessionId === id) || s.waits?.some(w => w.sessionId === id)) return { finished: false, clean: false }
  if (!p && s.archive?.some(a => a.sessionId === id && a.approvedAt)) return { finished: true, clean: true }
  if (!p && s.chats.find(c => c.sessionId === id)?.live && now - (missing.get(id) ?? now) < GRACE_MS) return { finished: false, clean: false }
  return outcomeOf(p)
}

export function follow(s, id) {
  const c = s.chats.find(x => x.sessionId === id)
  if (c?.live || !c?.chain) return id
  return s.chats.find(x => x.live && x.chain === c.chain && x.sessionId !== id)?.sessionId ?? id
}

export const label = c => `${c.name ?? 'unnamed'} (${c.sessionId.slice(0, 8)}${c.ai ? `, ${c.ai}` : ''})`
const lastReport = p => p?.report?.done.at(-1) ?? p?.report?.left.at(-1)

export function peerLine(s, c) {
  const p = s.progress.find(x => x.sessionId === c.sessionId)
  const task = p?.tasks.find(t => t.status === 'in_progress')?.subject
  const file = s.live.find(x => x.sessionId === c.sessionId)?.file
  const report = lastReport(p)
  return `- ${label(c)}: ${p?.state ?? 'no progress'}${task ? `, task: ${task}` : ''}${file ? `, file: ${file}` : ''}${report ? `. Last report: ${report}` : ''}`
}

export function finishText(s, ids) {
  let clean = true
  const lines = ids.map(id => {
    const c = s.chats.find(x => x.sessionId === id) ?? { sessionId: id, cwd: '', live: false }
    const p = s.progress.find(x => x.sessionId === id)
    clean &&= outcomeIn(s, id, Infinity).clean
    const tests = p?.tests ? `, tests ${p.tests.ok ? 'passed' : `failing (${p.tests.command ?? 'last run'})`}` : ''
    const r = p?.report
    const report = r ? `\n  Done: ${r.done.join('; ') || 'none'}\n  Left: ${r.left.join('; ') || 'none'}${r.you?.length ? `\n  For the user: ${r.you.join('; ')}` : ''}` : '\n  No report.'
    return `- ${label(c)}: ${p?.state ?? 'ended'}${tests}${p?.question ? `, asking: ${p.question}` : ''}${report}`
  })
  const next = clean
    ? 'Continue on your own: read the report above and pick up your work.'
    : 'Stop and ask the user before going on: a chat you waited for needs them, ended without a report, or has failing tests.'
  return `Finished:\n${lines.join('\n')}\n\n${next}`
}

export function checkText(s, self, cwd) {
  if (!s) return NO_HUB
  const peers = peersOf(s, self, cwd)
  return peers.length ? `Other live chats in this project:\n${peers.map(c => peerLine(s, c)).join('\n')}` : 'No other live chats in this project.'
}

const sameIds = (a, b) => a.length === b.length && a.every(x => b.includes(x))

/** One wait step, about four minutes. io: { state(), post(body), sleep(ms), now() }. */
export async function waitStep(io, { self, cwd, chats, reason }) {
  const wanted = Array.isArray(chats) ? chats.filter(x => typeof x === 'string') : []
  if (!wanted.length) return 'Give chats: the names or session ids to wait for.'
  let s = await io.state()
  if (!s) return NO_HUB
  const peers = peersOf(s, self, cwd)
  const { ids: first, missing: none } = matchTargets(peers, wanted)
  if (none.length) return `No live chat in this project matches ${none.join(', ')}. Live ones:\n${peers.map(c => peerLine(s, c)).join('\n') || '(none)'}`
  const loopText = id => `${label(s.chats.find(p => p.sessionId === id) ?? { sessionId: id, cwd: '', live: true })} already waits on this chat, so both would wait forever. Do not wait on it: continue on your own or ask the user.`
  const loop0 = first.find(id => waitsOn(s.links, id, self))
  if (loop0) return loopText(loop0)
  const start = io.now()
  const missing = new Map()
  let ids = first, linked = first
  const why = String(reason ?? '')
  // Only the user's unlink ends a wait; a handoff moves it to the target's next chat.
  const drop = async () => {
    const gone = new Set(s.unlinks?.filter(u => u.from === self).map(u => u.to))
    const next = [...new Set(ids.filter(id => !gone.has(id)).map(id => follow(s, id)))]
    if (next.length && !sameIds(next, linked)) {
      await io.post({ kind: 'link-end', from: self, to: linked })
      await io.post({ kind: 'link', from: self, to: next, reason: why, auto: false, since: start })
      linked = next
    }
    ids = next
    const loop = ids.find(id => waitsOn(s.links, id, self))
    if (loop) { await io.post({ kind: 'link-end', from: self, to: linked }); return loopText(loop) }
  }
  const looped = await drop()
  if (looped) return looped
  if (!ids.length) return REMOVED
  linked = ids
  await io.post({ kind: 'link', from: self, to: ids, reason: why, auto: false, since: start })
  for (;;) {
    const now = io.now()
    for (const id of ids) { if (s.progress.some(p => p.sessionId === id)) missing.delete(id); else if (!missing.has(id)) missing.set(id, now) }
    if (ids.every(id => outcomeIn(s, id, now, missing).finished)) {
      await io.post({ kind: 'link-end', from: self, to: linked })
      return finishText(s, ids)
    }
    if (now - start >= STEP_MS) {
      const lines = ids.flatMap(id => { const c = s.chats.find(x => x.sessionId === id); return c ? [peerLine(s, c)] : [] }).join('\n')
      return `Still waiting${lines ? `:\n${lines}` : '.'}\nCall chats_wait again with the same chats to keep waiting.`
    }
    await io.sleep(POLL_MS)
    s = (await io.state()) ?? s
    const again = await drop()
    if (again) return again
    if (!ids.length) return REMOVED
  }
}
