// Switchboard's ask tool, plus todo_add, todo_done, tool_on, sweep and discuss (and, under Codex, chats_check, chats_wait, hub_ask, hub_recall): an MCP stdio server, no dependencies. The question goes to the terminal
// (an elicitation dialog) and to the Switchboard window at once; the first answer wins, the other is closed.
import { createInterface } from 'node:readline'
import { randomBytes } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { checkInput, toSchema, fromContent, fromChoice, pickWindow } from './ask-core.mjs'
import { checkText, waitStep, NO_HUB } from './chats.mjs'

const DECLINED = 'The user declined to answer. Decide yourself and say what you decided.'
const TOOL = {
  name: 'ask',
  description: 'Ask the user a question only they can answer, with 2 to 4 options each (same shape as AskUserQuestion). Works from subagents too. It shows in the terminal and in Switchboard; returns their answer.',
  inputSchema: {
    type: 'object',
    properties: {
      questions: {
        type: 'array', minItems: 1, maxItems: 4,
        items: {
          type: 'object',
          properties: {
            question: { type: 'string' },
            header: { type: 'string', description: 'A short label, a few words' },
            options: { type: 'array', minItems: 2, maxItems: 4, items: { type: 'object', properties: { label: { type: 'string' }, description: { type: 'string' } }, required: ['label'] } },
            multiSelect: { type: 'boolean' },
          },
          required: ['question', 'options'],
        },
      },
    },
    required: ['questions'],
  },
}

const project = { type: 'string', description: 'The project folder; defaults to this chat\'s' }
const TODO_TOOLS = [
  {
    name: 'todo_add',
    description: 'Add future work to the project\'s Switchboard to-do, kept across chats until done. With before_id or before_text it is a prerequisite: something that must be done before that item. Steps only the user can do by hand (reload, sign in, commit, save a key, test on a device) go under For you in your standup instead, where they show as Finish up, not here.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' }, before_id: { type: 'string', description: 'Id of the item this must come before' }, before_text: { type: 'string', description: 'Text of that item, when the id is not known' }, project }, required: ['text'] },
  },
  {
    name: 'todo_done',
    description: 'Mark a Switchboard to-do item done, by its id or its text. When your work completes any open to-do item, even one you were not asked to do, call todo_done with its id before you finish.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' }, project } },
  },
  {
    name: 'tool_on',
    description: 'Turn on an installed plugin or skill that is off in this chat. You have full access to all of them: call this instead of asking. Give the plugin id, its short name, plugin:skill, or the skill name; it answers with the file to read to use it now.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
  {
    name: 'sweep',
    description: 'The SkillSpector sweep of installed plugins and skills. With name: rescan that one and answer its verdict. With nothing: start a sweep of everything installed; results show in Switchboard. It never approves: only the user turns a flagged tool on. With name and offer_approve: true, after the rescan it opens the Approve dialog in Switchboard for the user to answer Yes or No; use it when your review is done instead of telling them where to click.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, offer_approve: { type: 'boolean' } } },
  },
]

const out = m => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n')
const reply = (id, text, isError) => out({ id, result: { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) } })
const alive = pid => { try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' } }

/** workspace: only that folder's window, for a retry; the reload may change its pid and port, never its folder. */
function findWindow(workspace) {
  const dir = path.join(os.homedir(), '.claude', 'switchboard')
  let cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd()
  try { cwd = fs.realpathSync(cwd) } catch { /* keep as is */ }
  const files = []
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json') || f === 'workspaces.json') continue
      try { files.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) } catch { /* broken file */ }
    }
  } catch { return undefined }
  return pickWindow(workspace ? files.filter(d => d?.workspace === workspace) : files, cwd, alive)
}

// Codex has no hook mods, so it gets the chat-wait tools and the hub_ask and hub_recall brain tools here. Claude chats have the mods: registered with --codex or SWITCHBOARD_AI=codex only.
const CODEX = process.argv.includes('--codex') || process.env.SWITCHBOARD_AI === 'codex'
const SELF = CODEX ? 'codex' : 'claude'
// Codex's MCP server has no thread id in its env, but every tools/call carries it in _meta.
const sessionId = msg => process.env.CLAUDE_CODE_SESSION_ID || msg?.params?._meta?.threadId || process.env.CODEX_THREAD_ID || ''
const cwdOf = () => process.env.CLAUDE_PROJECT_DIR || process.cwd()
const DISCUSS_TOOL = {
  name: 'discuss',
  description: 'Hold a discussion with the other AI (Claude asks Codex, Codex asks Claude), headless and read-only in this folder. Returns the transcript and an Agreed on / Disagreed on summary. A turn can take minutes.',
  inputSchema: { type: 'object', properties: { question: { type: 'string' }, with: { type: 'string', enum: ['claude', 'codex'], description: 'Defaults to the other AI' }, rounds: { type: 'integer', minimum: 1, maximum: 3 }, context: { type: 'string', description: 'Facts the other AI needs; no secrets' } }, required: ['question'] },
}
const CODEX_TOOLS = [
  { name: 'chats_check', description: "This project's other live chats: name, AI, state, current task, the file each is editing, and its last report line.", inputSchema: { type: 'object', properties: {} } },
  { name: 'chats_wait', description: 'Wait for other live chats in this project to finish (names or session ids from chats_check). Returns their reports when done, or after about four minutes with "still waiting"; then call it again. Continue on your own when the result says so; otherwise stop and ask the user.', inputSchema: { type: 'object', properties: { chats: { type: 'array', items: { type: 'string' } }, reason: { type: 'string' } }, required: ['chats', 'reason'] } },
  { name: 'hub_ask', description: "Ask Switchboard's brain about this project's other live chats: who is on what, which files they are editing, what to pick up next. One short paid Haiku call per question; it knows nothing outside this project.", inputSchema: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] } },
  { name: 'hub_recall', description: 'Search Switchboard memory, the knowledge graph of memory notes and the vault, before researching a topic. Answers the best matching notes and how they relate (supersedes, depends-on, part-of, contradicts, related). Free and local.', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
]
const hubUrl = (win, p, more = '') => `http://127.0.0.1:${win.port}/hub${p}?token=${encodeURIComponent(win.hubToken)}${more}`
const stateOf = win => fetch(hubUrl(win, '/state'), { signal: AbortSignal.timeout(3000) }).then(r => (r.ok ? r.json() : undefined), () => undefined)

async function chats(msg) {
  const win = findWindow()
  if (!win) return reply(msg.id, NO_HUB)
  if (msg.params.name === 'chats_check') return reply(msg.id, checkText(await stateOf(win), sessionId(msg), cwdOf()))
  const a = msg.params.arguments ?? {}
  // ponytail: links post to the home window only; the mod posts to every window.
  const io = {
    state: () => stateOf(win), now: () => Date.now(), sleep,
    post: body => fetch(`http://127.0.0.1:${win.port}/hub`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: win.hubToken, ...body }), signal: AbortSignal.timeout(3000) }).catch(() => {}),
  }
  return reply(msg.id, await waitStep(io, { self: sessionId(msg), cwd: cwdOf(), chats: a.chats, reason: a.reason }))
}

/** hub_ask or hub_recall, through the window's /hub/ask and /hub/recall. */
async function brain(msg) {
  const ask = msg.params.name === 'hub_ask'
  const q = ask ? msg.params.arguments?.question : msg.params.arguments?.query
  if (typeof q !== 'string' || !q.trim()) return reply(msg.id, ask ? 'Give a question.' : 'Give a query.', true)
  const win = findWindow()
  if (!win) return reply(msg.id, ask ? 'No Switchboard window holds this folder, so the brain cannot answer.' : 'No Switchboard window holds this folder, so memory cannot be searched.')
  const more = `&cwd=${encodeURIComponent(cwdOf())}&session=${encodeURIComponent(sessionId(msg))}&q=${encodeURIComponent(q.slice(0, 500))}`
  const r = await fetch(hubUrl(win, ask ? '/ask' : '/recall', more), { signal: AbortSignal.timeout(60_000) })
  const text = await r.text()
  return r.ok ? reply(msg.id, text) : reply(msg.id, `${msg.params.name} failed: ${text || `status ${r.status}`}`, true)
}

/** discuss, through the window's /hub/discuss: up to five turns of five minutes. */
async function discuss(msg) {
  const a = msg.params?.arguments ?? {}
  if (typeof a.question !== 'string' || !a.question.trim()) return reply(msg.id, 'Not asked: give a question.', true)
  const win = findWindow()
  if (!win) return reply(msg.id, 'Switchboard is not running here, so the other AI cannot be reached.', true)
  const body = { question: a.question, cwd: cwdOf(), from: SELF, with: a.with, rounds: a.rounds, context: a.context }
  const r = await fetch(hubUrl(win, '/discuss'), { method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(27 * 60_000) })
  const text = await r.text()
  if (!r.ok) return reply(msg.id, `Not discussed: ${text || `status ${r.status}`}`, true)
  const res = JSON.parse(text)
  return reply(msg.id, res.text, !!res.error)
}

let canElicit = false
let nextId = 1
const pending = new Map() // our request id -> resolve
const calls = new Map() // the client's call id -> stop

// A reload takes the window away for a few seconds and may bring it back on another port and token.
const RETRY_MS = Number(process.env.SWITCHBOARD_ASK_RETRY_MS) || 60_000
const sleep = ms => new Promise(r => setTimeout(r, ms))

/** Posts the question, then polls until the window answers. On a failure (network, 404, 410) it finds the window again
 * and posts again, backing off, for RETRY_MS since the last good reply; answer is null after that. */
function askHub(first, id, questions, signal, session) {
  let win = first
  const url = (p, more = '') => `http://127.0.0.1:${win.port}/hub/question${p}?token=${encodeURIComponent(win.hubToken)}${more}`
  const body = JSON.stringify({ sessionId: session, id, questions })
  const post = () => fetch(url(''), { method: 'POST', body }).then(r => r.ok, () => false)
  let posted = post()
  const poll = async () => {
    let ok = await posted, since = 0, wait = 250
    for (;;) {
      if (ok) {
        const g = await fetch(url('', `&id=${id}`), { signal }).catch(() => undefined)
        if (g?.status === 200) return (await g.json()).choice ?? null
        if (g?.status === 204) { since = 0; wait = 250; continue }
      }
      if (signal.aborted) return null
      since ||= Date.now()
      if (Date.now() - since > RETRY_MS) return null
      await sleep(wait)
      wait = Math.min(wait * 2, 4000)
      if (signal.aborted) return null
      // Another project's window would hold a copy nobody answers: wait for this one.
      win = findWindow(first.workspace) ?? win
      posted = post()
      ok = await posted
    }
  }
  const answer = poll().catch(() => null)
  // After the post, so done never reaches the window before its question.
  const done = () => posted.then(ok => ok && fetch(url('/done', `&id=${id}`), { method: 'POST' })).catch(() => {})
  return { answer, done }
}

async function call(msg) {
  const input = checkInput(msg.params?.arguments)
  if (typeof input === 'string') return reply(msg.id, `Not asked: ${input}`, true)
  const { questions } = input
  const id = randomBytes(16).toString('hex')
  const ctl = new AbortController()
  // Codex's own dialog comes back declined under bypass flags and would beat the hub; there the hub is the only path.
  const elicit = canElicit && !CODEX
  const win = findWindow()
  if (!elicit && !win) return reply(msg.id, 'No way to reach the user here. Decide yourself and say what you decided.', true)

  const eid = `sb-${nextId++}`
  const dialog = elicit ? new Promise(resolve => pending.set(eid, resolve)) : Promise.resolve({ error: { message: 'no dialog in this client' } })
  if (elicit) {
    const more = questions.length > 1 ? ` (and ${questions.length - 1} more)` : ''
    out({ id: eid, method: 'elicitation/create', params: { message: questions[0].question + more, requestedSchema: toSchema(questions) } })
  }
  const stopped = new Promise(resolve => calls.set(msg.id, () => resolve({ stop: true })))
  const h = win && askHub(win, id, questions, ctl.signal, sessionId(msg))
  const done = () => { ctl.abort(); h?.done() }

  // A side that fails drops out; the other may still answer. None left: say so, never hang.
  const sides = new Map([['dialog', dialog.then(m => ({ m }))], ['hub', (h ? h.answer : Promise.resolve(null)).then(choice => ({ choice }))], ['stop', stopped]])
  let why = 'no reply'
  for (;;) {
    const r = await Promise.race(sides.values())
    if (r.stop) { calls.delete(msg.id); pending.delete(eid); return done() }
    if ('choice' in r) {
      if (r.choice) {
        calls.delete(msg.id)
        ctl.abort()
        if (pending.delete(eid)) out({ method: 'notifications/cancelled', params: { requestId: eid, reason: 'answered in Switchboard' } })
        return reply(msg.id, fromChoice(questions, r.choice))
      }
      sides.delete('hub')
    } else {
      const res = r.m.result
      if (res?.action) {
        calls.delete(msg.id)
        done()
        return reply(msg.id, res.action === 'accept' ? fromContent(questions, res.content) : DECLINED)
      }
      why = r.m.error?.message ?? why
      sides.delete('dialog')
    }
    if (!sides.has('hub') && !sides.has('dialog')) {
      calls.delete(msg.id)
      done()
      return reply(msg.id, `The question could not be shown (${why}). Decide yourself and say what you decided.`)
    }
  }
}

/** tool_on, through the window's /hub/tool-on. */
async function toolOn(msg) {
  const name = typeof msg.params?.arguments?.name === 'string' ? msg.params.arguments.name.trim() : ''
  if (!name) return reply(msg.id, 'Not changed: give the plugin or skill name.', true)
  const win = findWindow()
  if (!win) return reply(msg.id, 'Switchboard is not running here; use the plugin or skill anyway, from its files under ~/.claude.', true)
  const r = await fetch(`http://127.0.0.1:${win.port}/hub/tool-on?token=${encodeURIComponent(win.hubToken)}`, { method: 'POST', body: JSON.stringify({ session: sessionId(msg), name }), signal: AbortSignal.timeout(5000) })
  const text = await r.text()
  return r.ok ? reply(msg.id, text) : reply(msg.id, `Not changed: ${text || `status ${r.status}`}`, true)
}

/** sweep, through the window's /hub/sweep. A rescan of a big plugin takes about a minute. */
async function sweep(msg) {
  const a = msg.params?.arguments ?? {}
  const name = typeof a.name === 'string' && a.name.trim() ? a.name.trim() : undefined
  const win = findWindow()
  if (!win) return reply(msg.id, 'Switchboard is not running here, so nothing was swept.', true)
  const r = await fetch(`http://127.0.0.1:${win.port}/hub/sweep?token=${encodeURIComponent(win.hubToken)}`, { method: 'POST', body: JSON.stringify({ name }), signal: AbortSignal.timeout(660_000) })
  const text = await r.text()
  if (!r.ok) return reply(msg.id, `Not swept: ${text || `status ${r.status}`}`, true)
  if (!name || a.offer_approve !== true) return reply(msg.id, text)
  // Opens the same modal as the panel's Approve; only the user's Yes approves.
  const c = await fetch(`http://127.0.0.1:${win.port}/hub/command?token=${encodeURIComponent(win.hubToken)}`, { method: 'POST', body: JSON.stringify({ type: 'hub-sweep-approve', name }), signal: AbortSignal.timeout(5000) }).catch(() => undefined)
  return reply(msg.id, c?.ok ? `${text}\nThe Approve dialog is open in Switchboard; the user answers it. Tell them your verdict.` : `${text}\nCould not open the Approve dialog; tell the user to use Approve under Settings, Installed.`)
}

/** todo_add or todo_done, through the window's /hub/todo. */
async function todo(msg) {
  const a = msg.params?.arguments ?? {}
  const s = v => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
  const add = msg.params.name === 'todo_add'
  if (add ? !s(a.text) : !s(a.id) && !s(a.text)) return reply(msg.id, add ? 'Not added: text is empty.' : 'Not changed: give the id or text of the item.', true)
  const win = findWindow()
  if (!win) return reply(msg.id, 'Switchboard is not running here, so the to-do was not changed.', true)
  const body = { op: add ? 'add' : 'done', cwd: s(a.project) ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd(), text: s(a.text), id: add ? undefined : s(a.id), before: add ? s(a.before_id) ?? s(a.before_text) : undefined, session: sessionId(msg) || undefined }
  const r = await fetch(`http://127.0.0.1:${win.port}/hub/todo?token=${encodeURIComponent(win.hubToken)}`, { method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(5000) })
  const text = await r.text()
  return r.ok ? reply(msg.id, text) : reply(msg.id, `Not changed: ${text || `status ${r.status}`}`, true)
}

const rl = createInterface({ input: process.stdin })
rl.on('line', l => {
  let m
  try { m = JSON.parse(l) } catch { return }
  if (!m.method) {
    // A reply to our elicitation.
    pending.get(m.id)?.(m)
    pending.delete(m.id)
    return
  }
  if (m.method === 'initialize') {
    canElicit = !!m.params?.capabilities?.elicitation
    return out({ id: m.id, result: { protocolVersion: m.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'switchboard', version: '1' } } })
  }
  if (m.method === 'tools/list') return out({ id: m.id, result: { tools: [TOOL, ...TODO_TOOLS, DISCUSS_TOOL, ...(CODEX ? CODEX_TOOLS : [])] } })
  if (m.method === 'tools/call') {
    if (m.params?.name === 'todo_add' || m.params?.name === 'todo_done') return void todo(m).catch(err => reply(m.id, `${m.params.name} failed: ${err.message}`, true))
    if (m.params?.name === 'tool_on') return void toolOn(m).catch(err => reply(m.id, `tool_on failed: ${err.message}`, true))
    if (m.params?.name === 'sweep') return void sweep(m).catch(err => reply(m.id, `sweep failed: ${err.message}`, true))
    const n = m.params?.name
    if (n === 'discuss') return void discuss(m).catch(err => reply(m.id, `discuss failed: ${err.message}`, true))
    if (CODEX && (n === 'chats_check' || n === 'chats_wait')) return void chats(m).catch(err => reply(m.id, `${n} failed: ${err.message}`, true))
    if (CODEX && (n === 'hub_ask' || n === 'hub_recall')) return void brain(m).catch(err => reply(m.id, `${n} failed: ${err.message}`, true))
    if (m.params?.name !== 'ask') return out({ id: m.id, error: { code: -32602, message: `Unknown tool ${m.params?.name}` } })
    return void call(m).catch(err => reply(m.id, `ask failed: ${err.message}`, true))
  }
  if (m.method === 'notifications/cancelled') return calls.get(m.params?.requestId)?.()
  if (m.id != null) out({ id: m.id, result: {} })
})
// The session ended: tell the window, then go.
rl.on('close', () => { for (const stop of calls.values()) stop() })
