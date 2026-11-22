import { test } from 'node:test'
import assert from 'node:assert/strict'
import { demoApply, demoChat, demoFx, demoHub, demoRunDetails, demoSplit, demoTick, demoUpload } from './hub-demo'

test('a demo New chat puts a working chat on top, named from the goal', () => {
  const h = demoApply(demoHub(), { type: 'hub-new-chat', path: '/Users/k/Documents/GitHub/Armasu', text: 'fix the closet door animation on settings page', remote: false })
  assert.equal(h.chats[0].name, 'Fix the closet door animation')
  assert.equal(h.chats[0].cwd, '/Users/k/Documents/GitHub/Armasu')
  assert.equal(h.progress[0].sessionId, h.chats[0].sessionId)
  assert.equal(h.progress[0].state, 'working')
})

test('demoTick adds a tool call to the working chat, keeps them, and turns the roles', () => {
  let h = demoHub(0)
  for (let t = 0; t < 10; t++) h = demoTick(h, 1000 + t * 900)
  const w = h.progress.find(p => p.sessionId === 'd-work')!
  assert.ok((w.tools?.length ?? 0) >= 10)
  assert.equal(w.tools?.at(-1)?.at, 1000 + 9 * 900)
  assert.deepEqual(w.roles.filter(r => r.role !== 'jev').map(r => [r.id, r.state]), [['r1', 'done'], ['r2', 'active'], ['e1', 'active'], ['e2', 'active']])
  const qa = demoTick(h, 19_000).progress.find(p => p.sessionId === 'd-work')!
  assert.deepEqual(qa.roles.filter(r => r.role !== 'jev' && r.state === 'active').map(r => r.id), ['e2', 'q1', 'q2'])
  assert.equal(qa.tools?.at(-1)?.role, 'qa')
  assert.deepEqual(qa.tasks.map(t => t.status), ['completed', 'completed', 'completed', 'in_progress'])
  assert.deepEqual(h.progress.find(p => p.sessionId === 'd-done'), demoHub(0).progress.find(p => p.sessionId === 'd-done'))
  assert.ok(h.live.some(l => l.sessionId === 'd-work' && l.tokens && l.compactAt && l.costUsd))
})

test('the demo working chat opens with two engineers, a researcher and qa running, and one researcher done', () => {
  const w = demoHub(0).progress.find(p => p.sessionId === 'd-work')!
  const on = (role: string) => w.roles.filter(r => r.role === role && r.state === 'active').length
  assert.deepEqual([on('engineer'), on('researcher'), on('qa')], [2, 1, 1])
  assert.equal(w.roles.filter(r => r.role === 'researcher' && r.state === 'done').length, 1)
})

test('the demo answers Changes for a chat and History search in its notes', () => {
  const h = demoApply(demoHub(), { type: 'hub-changes', sessionId: 'd-work' })
  assert.equal(h.changes?.sessionId, 'd-work')
  assert.ok(h.changes!.files.length >= 3)
  assert.ok(h.changes!.files.some(f => f.diff) && h.changes!.files.some(f => f.note))
  const s = demoApply(h, { type: 'hub-search', q: 'Cookie' })
  assert.equal(s.search?.q, 'Cookie')
  assert.deepEqual(s.search?.hits.map(x => x.sessionId), ['d-fix-v3'])
  assert.match(s.search!.hits[0].snippet, /cookie/i)
  assert.equal(demoApply(s, { type: 'hub-search', q: ' ' }).search, null)
})

test('the demo working chat has a Jev bubble, and a tick now and then draws a Jev pill from it', () => {
  const h = demoHub(0)
  const w = h.progress.find(p => p.sessionId === 'd-work')!
  assert.ok(w.roles.some(r => r.role === 'jev' && r.state === 'done'))
  let t = h
  for (let i = 0; i < 12; i++) t = demoTick(t, 1000 + i * 900)
  const tw = t.progress.find(p => p.sessionId === 'd-work')!
  assert.ok(tw.roles.some(r => r.role === 'jev'), 'the tick keeps the Jev role')
  const pill = tw.tools!.find(c => c.role === 'jev')!
  assert.match(pill.target ?? '', /items · \$/)
  assert.ok(h.jev.length >= 2)
})

test('the demo Sign-ins: rename, email, add again, pick for this window', () => {
  let h = demoHub()
  assert.ok(h.signIns.chrome.length > 0 && h.signIns.window)
  assert.ok(!Object.values(h.signIns.links ?? {}).some(r => Object.values(r).includes(null as never)), 'no Default picks')
  h = demoApply(h, { type: 'hub-aws-window', profile: 'yo' })
  h = demoApply(h, { type: 'hub-aws-rename', profile: 'yo', to: 'sandbox' })
  assert.ok(h.aws.some(a => a.name === 'sandbox') && !h.aws.some(a => a.name === 'yo'))
  assert.equal(h.signIns.projects[h.signIns.window!], 'sandbox')
  h = demoApply(h, { type: 'hub-aws-label', profile: 'sandbox', label: 'me@work.com' })
  assert.equal(h.aws.find(a => a.name === 'sandbox')?.label, 'me@work.com')
  h = demoApply(h, { type: 'hub-aws-add', profile: 'new', region: 'us-east-2' })
  assert.equal(h.aws.find(a => a.name === 'new')?.status, 'never')
  h = demoApply(h, { type: 'hub-aws-add', profile: 'new', region: 'eu-west-1' })
  assert.deepEqual(h.aws.filter(a => a.name === 'new').map(a => a.region), ['eu-west-1'])
  h = demoApply(h, { type: 'hub-aws-window', profile: 'yo' })
  assert.equal(h.signIns.projects[h.signIns.window!], 'yo')
  h = demoApply(h, { type: 'hub-aws-window', profile: null })
  assert.equal(h.signIns.projects[h.signIns.window!], undefined)
})

test('demo accounts show an expiring session and failures; signing in again clears one', () => {
  let h = demoHub(0)
  assert.ok(h.aws.some(a => a.status === 'signed-in' && a.expiresAt && a.expiresAt - 0 < 3_600_000))
  assert.ok(h.signIns.errors?.['aws:yo'] && h.signIns.errors['login:auth0:a-me'])
  assert.ok(h.signIns.browsers?.[h.signIns.window!])
  h = demoApply(h, { type: 'hub-aws-login', profile: 'yo', chrome: '' })
  assert.equal(h.signIns.errors?.['aws:yo'], undefined)
  assert.equal(h.aws.find(a => a.name === 'yo')?.status, 'signed-in')
  h = demoApply(h, { type: 'hub-login-open', app: 'auth0', id: 'a-me' })
  assert.equal(h.signIns.errors?.['login:auth0:a-me'], undefined)
})

test('the demo browser per project: set, system browser, forget', () => {
  let h = demoHub()
  const folder = h.signIns.window!, dir = h.signIns.chrome[0].dir
  h = demoApply(h, { type: 'hub-browser', folder, chrome: dir })
  assert.equal(h.signIns.browsers?.[folder], dir)
  h = demoApply(h, { type: 'hub-browser', folder, chrome: '' })
  assert.equal(h.signIns.browsers?.[folder], '')
  h = demoApply(h, { type: 'hub-browser', folder, chrome: null })
  assert.equal(folder in (h.signIns.browsers ?? {}), false)
})

test('a demo role model pick changes only that role', () => {
  const h = demoApply(demoHub(0), { type: 'hub-role-model', role: 'ops', model: 'haiku' })
  assert.equal(h.installed.find(i => i.name === 'ops')?.model, 'haiku')
  assert.equal(h.installed.find(i => i.name === 'qa')?.model, 'sonnet')
})

test('a demo Codex pick sets model and effort, default clears them', () => {
  let h = demoHub(0)
  assert.equal(h.installed.find(i => i.name === 'qa-codex')?.kind, 'role')
  h = demoApply(h, { type: 'hub-role-codex', role: 'qa-codex', model: 'gpt-5.6-terra', effort: 'xhigh' })
  const r = h.installed.find(i => i.name === 'qa-codex')
  assert.equal(r?.codexModel, 'gpt-5.6-terra')
  assert.equal(r?.codexEffort, 'xhigh')
  assert.equal(r?.model, 'sonnet')
  h = demoApply(h, { type: 'hub-role-codex', role: 'qa-codex', model: 'default', effort: 'default' })
  assert.equal(h.installed.find(i => i.name === 'qa-codex')?.codexModel, undefined)
})

test('the demo shows a dev row per project, and Dev, Stop and Keep awake change it', () => {
  const h = demoHub(0)
  const qr = h.dev?.find(d => d.project === 'QR-Test')
  assert.ok(qr && !qr.port && h.tailscale)
  const on = demoApply(h, { type: 'hub-dev-start', folder: qr.folder }).dev?.find(d => d.folder === qr.folder)
  assert.ok(on?.port && on.link?.endsWith(`:${on.port + 10000}`))
  const off = demoApply(demoApply(h, { type: 'hub-dev-start', folder: qr.folder }), { type: 'hub-dev-stop', folder: qr.folder }).dev?.find(d => d.folder === qr.folder)
  assert.deepEqual(off, qr)
  assert.equal(demoApply(h, { type: 'hub-dev-start', folder: '/etc' }).dev, h.dev)
  assert.equal(demoApply(h, { type: 'hub-awake', on: true }).awake, true)
})

test('the demo applies to-do commands to its sample list, with one item a chat ticked off to put back', () => {
  const at = '/Users/k/GitHub/Armasu'
  let h = demoHub(0)
  const list = () => h.todos![at]
  assert.equal(list().ticked?.length, 4)
  h = demoApply(h, { type: 'hub-todo-remove', path: at, id: 'dt1' })
  assert.ok(!list().todo.some(t => t.id === 'dt1'))
  assert.equal(list().ticked?.[0].id, 'dt1')
  h = demoApply(h, { type: 'hub-todo-add', path: at, text: ' New one ' })
  assert.equal(list().todo.at(-1)?.text, 'New one')
  h = demoApply(h, { type: 'hub-todo-edit', path: at, id: 'dt4', text: 'Edited' })
  assert.equal(list().todo.find(t => t.id === 'dt4')?.text, 'Edited')
  const ticked = list().ticked![1]
  h = demoApply(h, { type: 'hub-todo-restore', path: at, id: ticked.id })
  assert.equal(list().ticked?.length, 4)
  assert.ok(list().todo.some(t => t.text === ticked.text && t.id !== ticked.id && t.from === ticked.from && t.before === ticked.before))
  h = demoApply(h, { type: 'hub-todo-run', path: at, ids: ['dt4'] })
  assert.ok(list().todo.find(t => t.id === 'dt4')?.chat)

  assert.equal(demoApply(h, { type: 'hub-todo-remove', path: '/nowhere', id: 'x' }), h)
})

test('the demo suggests what finished chats left, with a reason and the chat, and takes Accept or Dismiss', () => {
  const at = '/Users/k/GitHub/Armasu'
  let h = demoHub(0)
  const list = () => h.todos![at]
  const [first, second] = list().suggested!
  assert.ok(first.why && first.from && second)
  h = demoApply(h, { type: 'hub-todo-accept', path: at, id: first.id })
  assert.ok(!list().suggested?.some(t => t.id === first.id))
  assert.ok(list().todo.some(t => t.text === first.text && t.from === first.from && t.why === first.why))
  h = demoApply(h, { type: 'hub-todo-dismiss', path: at, id: second.id })
  assert.ok(!list().suggested?.some(t => t.id === second.id))
  assert.ok(!list().todo.some(t => t.text === second.text))
})

test('the name setting round-trips in the demo, empty by default', () => {
  assert.equal(demoHub().controls.switchboard.name, '')
  const h = demoApply(demoHub(), { type: 'hub-switchboard', key: 'name', value: 'Kenneth' })
  assert.equal(h.controls.switchboard.name, 'Kenneth')
})

test('a demo run starts the picked item and its prerequisite, like the extension\'s runOrder', () => {
  const at = '/Users/k/GitHub/Armasu'
  const h = demoApply(demoHub(0), { type: 'hub-todo-run', path: at, ids: ['dt1'] })
  const todo = h.todos![at].todo, chat = todo.find(t => t.id === 'dt1')?.chat
  assert.ok(chat)
  assert.equal(todo.find(t => t.id === 'dt2')?.chat, chat)
  assert.equal(todo.find(t => t.id === 'dt4')?.chat, undefined)
})

test('demo sign-ins name only folders the projects list has', () => {
  const h = demoHub(0), paths = h.projects.map(p => p.path), s = h.signIns!
  for (const f of [...Object.keys(s.projects), s.window!, ...Object.keys(s.links ?? {})]) assert.ok(paths.includes(f), f)
})

test('a demo upload answers a path laid out like the real uploads folder', () => {
  assert.equal(demoUpload('../shot.png', '/Users/k/Documents/GitHub/Armasu', new Date(2026, 9, 3)), '~/.claude/switchboard/uploads/Armasu/2026-10-03/shot.png')
})

test('the demo opens with a stuck job and a quiet agent; Dismiss and Stop take one off', () => {
  const h = demoHub(0)
  assert.deepEqual(h.stuck?.map(i => i.kind), ['job', 'agent'])
  assert.deepEqual(demoApply(h, { type: 'hub-stuck-dismiss', sessionId: 'd-work', id: 'agent:d-work:q2' }).stuck?.map(i => i.kind), ['job'])
  assert.deepEqual(demoApply(h, { type: 'hub-stuck-stop', sessionId: 'd-wrap', id: 'job:d-wrap:t9' }).stuck?.map(i => i.kind), ['agent'])
})

test('a demo Jarvis question proposes a start for an instruction and answers anything else', () => {
  const s = demoApply(demoHub(), { type: 'hub-jarvis', q: 'start a chat to fix the size chart' }).jarvis!
  assert.deepEqual(s.start, { folder: '/Users/k/Documents/GitHub/Armasu', project: 'Armasu', goal: 'fix the size chart' })
  const a = demoApply(demoHub(), { type: 'hub-jarvis', q: 'what is running' }).jarvis!
  assert.equal(a.start, undefined)
  assert.ok(a.answer)
  assert.equal(demoApply(demoHub(), { type: 'hub-jarvis', q: ' ' }).jarvis, null)
})

test('the demo mic listens, stops on a pause or a tap, and puts its words in the box', () => {
  const on = demoApply(demoHub(), { type: 'hub-voice', on: true })
  assert.equal(on.voice, 'listening')
  assert.equal(demoTick(on, Date.now() + 1000).voice, 'listening')
  const paused = demoTick(on, Date.now() + 4000)
  assert.equal(paused.voice, null)
  assert.equal(paused.heard?.text, 'what is running')
  const tapped = demoApply(on, { type: 'hub-voice', on: false })
  assert.equal(tapped.voice, null)
  assert.ok(tapped.heard?.text)
  assert.equal(demoApply(demoHub(), { type: 'hub-voice', on: false }).heard, undefined)
})

test('the demo chat view answers outputs, a paged transcript and a screenshot', () => {
  const h = demoHub(0)
  const o = demoChat(h, 'd-done', 'outputs')
  assert.ok(o.outputs?.final && o.outputs.commit && o.outputs.reports.length >= 2 && o.outputs.shots.length >= 1)
  assert.ok(o.outputs.tests.length && o.outputs.errors.length && o.outputs.files.length && o.outputs.questions.length)
  const first = demoChat(h, 'd-done', 'transcript').transcript!
  assert.equal(first.messages.length, 50)
  assert.ok(first.before !== null)
  const rest = demoChat(h, 'd-done', 'transcript', { before: first.before! }).transcript!
  assert.ok(rest.messages.length > 0 && rest.messages.length < 50)
  assert.equal(rest.before, null)
  assert.match(demoChat(h, 'd-done', 'shot', { path: o.outputs.shots[0] }).shot ?? '', /^data:image\/svg\+xml/)
  assert.equal(demoChat(h, 'd-done', 'shot', { path: '/etc/passwd' }).shot, undefined)
  assert.equal(demoChat(h, 'nope', 'outputs').outputs, undefined)
})

test('the demo transcript fits each chat, not the same script for all', () => {
  const h = demoHub(0)
  const work = demoChat(h, 'd-work', 'transcript').transcript!
  assert.match(work.messages[0].text, /Fix login redirect/)
  assert.ok(!work.messages.some(m => /Codex/.test(m.text)))
  assert.equal(work.before, null)
  assert.match(demoChat(h, 'd-done', 'transcript').transcript!.messages.at(-1)!.text, /Codex|engineer|AI/)
})

test('demo lead: one run for the whole chat, a dispatch per role run, and its last message', () => {
  const p = demoHub(0).progress.find(x => x.sessionId === 'd-work')!
  const [lead, ...rest] = demoRunDetails(p, 'lead', 60_000)
  assert.equal(rest.length, 0)
  assert.equal(lead.role, 'lead')
  assert.equal(lead.id, p.sessionId)
  assert.equal(lead.dispatches?.length, p.roles.filter(r => r.role !== 'jev').length)
  assert.equal(lead.dispatches?.[0].role, p.roles[0].role)
  assert.ok(lead.calls.some(c => c.tool === 'Agent'))
  assert.ok(lead.reportText)
  assert.deepEqual(demoRunDetails(undefined, 'lead'), [])
})

test('a demo tool pick names its folder, so New chat shows it', () => {
  const h = demoApply(demoHub(), { type: 'hub-pick-tools', text: 'fix the login page', path: '/Users/k/Documents/GitHub/Armasu' })
  assert.equal(h.tools?.pick?.folder, '/Users/k/Documents/GitHub/Armasu')
})

test('a demo Finish up step ticked and put back stays a Finish up step', () => {
  const h = demoHub(), path = Object.keys(h.todos!)[0]
  const step = { id: 'dt-step', text: 'Reload the window', at: 1, from: 'd-done', why: 'you' as const }
  const h0 = { ...h, todos: { ...h.todos, [path]: { ...h.todos![path], todo: [...h.todos![path].todo, step] } } }
  const h1 = demoApply(h0, { type: 'hub-todo-remove', path, id: step.id })
  const ticked = h1.todos![path].ticked![0]
  assert.equal(ticked.why, 'you')
  assert.equal(ticked.from, step.from)
  const h2 = demoApply(h1, { type: 'hub-todo-restore', path, id: step.id })
  assert.equal(h2.todos![path].todo.at(-1)?.why, 'you')
})

test('demo board fx are opt-in: pause and unlink only from the query', () => {
  assert.deepEqual(demoFx('', 1000), {})
  assert.equal(demoHub().pause, undefined)
  const fx = demoFx('?demo=pause,unlink&resume=10', 1000)
  assert.deepEqual(fx.pause?.chats.map(c => c.sessionId), ['d-work', 'd-wrap', 'd-almost'])
  assert.equal(fx.pause?.resumeAt, 11_000)
  assert.equal(fx.unlinkAt, 7000)
  const h = { ...demoHub(1000), pause: fx.pause }
  assert.equal(demoTick(h, 10_000).pause?.kind, 'five_hour')
  assert.equal(demoTick(h, 11_000).pause, undefined)
})

test('a demo unlink drops one target from a link to several', () => {
  const h = { ...demoHub(), links: [{ from: 'a', to: ['b', 'c'], reason: 'r', auto: false, since: 1 }] }
  const one = demoApply(h, { type: 'hub-unlink', from: 'a', to: 'b' })
  assert.deepEqual(one.links?.map(l => l.to), [['c']])
  assert.deepEqual(demoApply(one, { type: 'hub-unlink', from: 'a', to: 'c' }).links, [])
})

test('hub-summary fills a demo summary for that chat', () => {
  const h = demoApply(demoHub(), { type: 'hub-summary', sessionId: 'd-work' })
  assert.match(h.summaries?.['d-work']?.text ?? '', /Fix login redirect/)
})

test('demo Approve moves the chat to History as approved', () => {
  const h = demoApply(demoHub(), { type: 'hub-approve', sessionId: 'd-done' })
  const a = h.archive?.find(x => x.sessionId === 'd-done')
  assert.ok(a?.approvedAt)
  assert.equal(a?.name, 'Hub AIs and Starred')
  assert.equal(demoApply(h, { type: 'hub-approve', sessionId: 'd-done' }).archive?.filter(x => x.sessionId === 'd-done').length, 1)
})

test('demo Write commit message is busy, then fills a draft; a commit moves HEAD and drops it', () => {
  const h = demoApply(demoApply(demoHub(), { type: 'hub-changes', sessionId: 'd-work' }), { type: 'hub-draft-commit', sessionId: 'd-work' })
  const at = h.repo!.draft!.at
  assert.equal(h.repo!.draft!.busy, true)
  assert.equal(demoTick(h, at + 1000).repo!.draft!.busy, true)
  const d = demoTick(h, at + 1600).repo!.draft!
  assert.equal(d.busy, undefined)
  assert.equal(d.box, 'filled')
  const [summary, blank, ...rest] = d.text!.split('\n')
  assert.ok(summary && blank === '' && rest.some(l => l.startsWith('- ')))
  assert.ok(!d.text!.includes(String.fromCharCode(0x2014)))
  const c = demoApply(demoTick(h, at + 1600), { type: 'hub-git', sessionId: 'd-work', op: 'commit', files: ['auth/middleware.ts'], summary })
  assert.equal(c.repo!.draft, undefined)
  assert.notEqual(c.repo!.log[0].hash, h.repo!.log[0].hash)
  assert.equal(c.repo!.log[0].subject, summary)
})

test('demo: split answers three asks for a multi message, one for a single', () => {
  assert.equal(demoSplit('1. fix the login loop\n2. add dark mode\n3. new footer').length, 3)
  assert.equal(demoSplit('Fix the login loop. Also add dark mode.').length, 3)
  assert.deepEqual(demoSplit('fix the login loop'), ['fix the login loop'])
})

test('demo: two chats share a group, one waits on another, new chats keep group and waits', () => {
  const h = demoHub()
  const grouped = h.chats.filter(c => c.group)
  assert.ok(grouped.length >= 2 && grouped.every(c => c.group === grouped[0].group))
  assert.ok(h.links?.some(l => grouped.some(c => c.sessionId === l.from) && l.to.some(t => grouped.some(c => c.sessionId === t))))
  const n = demoApply(h, { type: 'hub-new-chat', path: '/g/app', text: 'add dark mode', remote: false, group: 'g-x', waitOn: ['d-work'] } as Parameters<typeof demoApply>[1])
  assert.equal(n.chats[0].group, 'g-x')
  assert.ok(n.links?.some(l => l.from === n.chats[0].sessionId && l.to.includes('d-work')))
})

test('accepting several suggestions in one tick keeps every row', () => {
  let h = demoHub(); const todos = () => h.todos ?? {}
  const at = Object.keys(todos()).find(k => (todos()[k].suggested ?? []).filter(t => t.why !== 'you').length > 1)!
  const ids = todos()[at].suggested!.filter(t => t.why !== 'you').map(t => t.id), before = todos()[at].todo.length
  for (const id of ids) h = demoApply(h, { type: 'hub-todo-accept', path: at, id })
  const added = todos()[at].todo
  assert.equal(added.length, before + ids.length)
  assert.equal(new Set(added.map(t => t.id)).size, added.length)
})
