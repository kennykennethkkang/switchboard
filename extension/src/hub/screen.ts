/**
 * A chat terminal's current screen, for the Screen tab: the shell output VS Code reports is fed into a headless
 * xterm per terminal and read back as plain text or ANSI, secrets masked first. Also the typing allowlist.
 * No vscode import (screen-watch.ts feeds it), so tests drive it directly. Served by GET /hub/chat/screen and
 * POST /hub/chat/keys, token gated, both only in the window that holds the chat's terminal.
 */
import { Terminal, type IBufferCell } from '@xterm/headless'
import { redact } from './brain'

export type Size = { cols: number; rows: number }
/** running: a command is live in the terminal. ansi only when asked for. */
export type ScreenSnap = Size & { text: string; ansi?: string; running: boolean; at: number }

const clamp = (n: number | undefined, lo: number, hi: number, dflt: number) => (n !== undefined && Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : dflt)
const fit = (s?: Partial<Size>): Size => ({ cols: clamp(s?.cols, 20, 400, 120), rows: clamp(s?.rows, 5, 200, 30) })

/** `stty size` prints rows then columns. */
export function parseSize(out: string): Size | undefined {
  const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(out)
  return m && Number(m[1]) > 0 && Number(m[2]) > 0 ? { rows: Number(m[1]), cols: Number(m[2]) } : undefined
}

/** wrapped: the terminal itself wrapped this row onto the one above it. */
type Row = { plain: string; ansi: string; full: boolean; wrapped: boolean }

function sgr(c: IBufferCell): string {
  const p: Array<number | string> = []
  if (c.isBold()) p.push(1)
  if (c.isDim()) p.push(2)
  if (c.isItalic()) p.push(3)
  if (c.isUnderline()) p.push(4)
  if (c.isBlink()) p.push(5)
  if (c.isInverse()) p.push(7)
  if (c.isInvisible()) p.push(8)
  if (c.isStrikethrough()) p.push(9)
  const colour = (rgb: boolean, palette: boolean, v: number, base: number) => {
    if (rgb) p.push(`${base + 8};2;${(v >> 16) & 255};${(v >> 8) & 255};${v & 255}`)
    else if (palette) p.push(v < 8 ? base + v : v < 16 ? base + 60 + v - 8 : `${base + 8};5;${v}`)
  }
  colour(c.isFgRGB(), c.isFgPalette(), c.getFgColor(), 30)
  colour(c.isBgRGB(), c.isBgPalette(), c.getBgColor(), 40)
  return p.join(';')
}

const blank = (c: IBufferCell) => (c.getChars() === '' || c.getChars() === ' ') && sgr(c) === ''

/** The viewport, one entry per row, trailing empty rows dropped. */
function rowsOf(term: Terminal): Row[] {
  const buf = term.buffer.active, cell = buf.getNullCell()
  const out: Row[] = []
  for (let y = 0; y < term.rows; y++) {
    const line = buf.getLine(buf.baseY + y)
    if (!line) { out.push({ plain: '', ansi: '', full: false, wrapped: false }); continue }
    const plain = line.translateToString(true)
    let last = -1
    for (let x = term.cols - 1; x >= 0 && last < 0; x--) { const c = line.getCell(x, cell); if (c && !blank(c)) last = x }
    let ansi = '', cur = ''
    for (let x = 0; x <= last; x++) {
      const c = line.getCell(x, cell)
      if (!c || c.getWidth() === 0) continue
      const st = sgr(c)
      if (st !== cur) { ansi += `\x1b[0${st ? `;${st}` : ''}m`; cur = st }
      ansi += c.getChars() || ' '
    }
    out.push({ plain, ansi: cur ? `${ansi}\x1b[0m` : ansi, full: plain.length >= term.cols - 1, wrapped: line.isWrapped })
  }
  while (out.length && !out.at(-1)!.plain && !out.at(-1)!.ansi) out.pop()
  return out
}

// What redact's token shapes miss: a password inside a URL, a value named like a secret (env file, JSON, yaml), an auth header.
const URL_PASS = /([a-z][a-z0-9+.-]*:\/\/[^\s:@/]*:)[^\s@/]+(@)/gi
const NAMED = /([\w.-]*(?:passw(?:or)?d|passphrase|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|credential)[\w.-]*["']?[ \t]*[=:][ \t]*)(?:"[^"\n]*"|'[^'\n]*'|[^\s"',]+)/gi
const AUTH = /(authorization[ \t]*[=:][ \t]*(?:(?:bearer|basic|token)[ \t]+)?)[^\s"']+/gi
// Short names (pass, pw, key) with a separator; over-masks a stray "monkey: x", which is the safe side.
const SHORT = /((?:^|[^\w])["']?(?:pass|pw|key)["']?[ \t]*[=:][ \t]*)(?:"[^"\n]*"|'[^'\n]*'|[^\s"',]+)/gi
// CLI flags, mysql's glued -pXXX, and "password is x" / "token x" (value must hold a digit, so "token used" stays).
const FLAG = /(--?(?:password|passwd|pass|token|secret|api-key)[= \t]+)[^\s"']+/gi
const MYSQL = /((?:mysql|mariadb|mysqldump)[^\n]*?[ \t]-p)[^\s"']+/gi
const LOOSE = /((?:passw(?:or)?d|token|secret)[ \t]+(?:is[ \t]+)?)(?=[^\s]*\d)[^\s"',]+/gi
const BEARER = /(bearer[ \t]+)[A-Za-z0-9._~+/=-]{12,}/gi
// No \b in these: the joined-rows check in safe() compares masks, and a word edge would differ between a row alone and joined.
// ponytail: names only, so `echo $PASSWORD` (a bare value on its own line) still shows; nothing on screen says what it is.
const mask = (s: string) => redact(s.replace(URL_PASS, '$1[removed]$2').replace(NAMED, '$1[removed]').replace(AUTH, '$1[removed]')
  .replace(SHORT, '$1[removed]').replace(FLAG, '$1[removed]').replace(MYSQL, '$1[removed]').replace(LOOSE, '$1[removed]').replace(BEARER, '$1[removed]'))

/**
 * Text and ANSI with secrets masked. A full row followed by a row that starts with text may be one wrapped line (the
 * app breaks a long token at the width); the two are joined only when masking them joined finds something the
 * rows alone do not. A row the terminal itself wrapped always joins the row above. A row group that holds a secret loses its colour and becomes one masked line. A match across
 * real line breaks (a private key block) masks the whole screen, colourless.
 */
function safe(rows: Row[]): { text: string; ansi: string } {
  const groups: Row[][] = []
  let head = ''
  for (const r of rows) {
    const g = groups.at(-1)
    if (g && (r.wrapped || (g.at(-1)!.full && /^\S/.test(r.plain) && mask(head + r.plain) !== mask(head) + mask(r.plain)))) { g.push(r); head += r.plain }
    else { groups.push([r]); head = r.plain }
  }
  const joined = groups.map(g => g.map(r => r.plain).join(''))
  const masked = joined.map(mask)
  const whole = mask(joined.join('\n'))
  if (masked.join('\n') !== whole) return { text: whole, ansi: whole }
  const keep = groups.map((g, i) => masked[i] === joined[i] ? { text: g.map(r => r.plain).join('\n'), ansi: g.map(r => r.ansi).join('\n') } : { text: masked[i], ansi: masked[i] })
  return { text: keep.map(k => k.text).join('\n'), ansi: keep.map(k => k.ansi).join('\n') }
}

type Shot = { term: Terminal; running: boolean; at: number; gone: boolean; q: Promise<unknown> }

/** One headless terminal per key. Every step queues behind the one before, since xterm parses writes later. */
export class Screens<K> {
  private all = new Map<K, Shot>()

  private step<T>(s: Shot, f: () => T | Promise<T>): Promise<T | undefined> {
    const next = s.q.then(f).catch(() => undefined) as Promise<T | undefined>
    s.q = next
    return next
  }

  has(key: K): boolean { return this.all.has(key) }

  /** A command started in the terminal: the screen clears, since the last command's frame is not this one's. */
  start(key: K, size?: Partial<Size>): void {
    const { cols, rows } = fit(size)
    let s = this.all.get(key)
    if (!s) {
      // scrollback 0: only what the screen shows is kept.
      s = { term: new Terminal({ cols, rows, scrollback: 0, allowProposedApi: true }), running: true, at: Date.now(), gone: false, q: Promise.resolve() }
      this.all.set(key, s)
      return
    }
    const shot = s
    void this.step(shot, () => { shot.term.reset(); shot.term.resize(cols, rows); shot.running = true; shot.at = Date.now() })
  }

  /** Output of the running command. Nothing before a start: output with no command to tie it to is not kept. */
  write(key: K, data: string): Promise<void> {
    const s = this.all.get(key)
    if (!s) return Promise.resolve()
    return this.step(s, () => new Promise<void>(done => { s.at = Date.now(); s.term.write(data, done) })).then(() => undefined)
  }

  end(key: K): void {
    const s = this.all.get(key)
    if (s) void this.step(s, () => { s.running = false })
  }

  resize(key: K, size: Partial<Size>): void {
    const s = this.all.get(key), { cols, rows } = fit(size)
    if (s) void this.step(s, () => { if (s.term.cols !== cols || s.term.rows !== rows) s.term.resize(cols, rows) })
  }

  /** The screen now, once what was written before it is parsed. Undefined for a terminal never started or dropped. */
  snapshot(key: K, ansi: boolean): Promise<ScreenSnap | undefined> {
    const s = this.all.get(key)
    if (!s) return Promise.resolve(undefined)
    return this.step(s, () => {
      if (s.gone) return undefined
      const { text, ansi: colour } = safe(rowsOf(s.term))
      return { cols: s.term.cols, rows: s.term.rows, text, ...(ansi ? { ansi: colour } : {}), running: s.running, at: s.at }
    })
  }

  /** The terminal closed: its buffer goes with it. */
  drop(key: K): void {
    const s = this.all.get(key)
    if (!s) return
    s.gone = true
    this.all.delete(key)
    void this.step(s, () => s.term.dispose())
  }
}

// Typing: printable text, or one named key. Never a raw byte or an escape, so a request cannot say anything the keyboard could not.
const KEYS: Record<string, string> = { enter: '\r', esc: '\x1b', up: '\x1b[A', down: '\x1b[B', right: '\x1b[C', left: '\x1b[D', tab: '\t', 'ctrl-c': '\x03' }
const TEXT_MAX = 2000
const UNPRINTABLE = /[\p{Cc}\p{Zl}\p{Zp}]/u

/** The bytes to send for a request body {text} or {key}, or why it is refused. */
export function keyBytes(input: unknown): { ok: true; bytes: string } | { ok: false; problem: string } {
  const o = typeof input === 'object' && input !== null && !Array.isArray(input) ? input as Record<string, unknown> : undefined
  if (!o || (o.text === undefined) === (o.key === undefined)) return { ok: false, problem: 'send text or key, one of them' }
  if (o.key !== undefined) return typeof o.key === 'string' && Object.hasOwn(KEYS, o.key) ? { ok: true, bytes: KEYS[o.key] } : { ok: false, problem: `key is one of ${Object.keys(KEYS).join(', ')}` }
  if (typeof o.text !== 'string' || !o.text || o.text.length > TEXT_MAX) return { ok: false, problem: `text is 1 to ${TEXT_MAX} characters` }
  return UNPRINTABLE.test(o.text) ? { ok: false, problem: 'text is printable characters only; Enter, Esc and the arrows are keys' } : { ok: true, bytes: o.text }
}

const AGENTS = new Set(['claude', 'codex'])
const RUNTIMES = new Set(['node', 'nodejs', 'bun', 'deno'])
const base = (p: string) => p.split(/[\\/]/).pop()!.replace(/\.(js|mjs|cjs|exe)$/i, '')

/** The rows of `ps -t <tty> -o stat=,args=`: whether a foreground one (stat has +) runs claude or codex itself. */
export function agentForeground(psOut: string): boolean {
  return psOut.split('\n').some(line => {
    const [stat, prog, ...rest] = line.trim().split(/\s+/)
    if (!stat?.includes('+') || !prog) return false
    if (AGENTS.has(base(prog))) return true
    const script = RUNTIMES.has(base(prog)) ? rest.find(a => !a.startsWith('-')) : undefined
    return !!script && (AGENTS.has(base(script)) || /[\\/]@(anthropic-ai[\\/]claude-code|openai[\\/]codex)[\\/]/.test(script))
  })
}

/** 404: no such terminal; 403: typing is off; 409: claude or codex is not what runs there. */
export type Typed = { status: 204 } | { status: 400 | 403 | 404 | 409; problem: string }
/** What the window that holds the terminals offers; screen-watch.ts sets it. */
export type Host = {
  snapshot(session: string, ansi: boolean): Promise<ScreenSnap | undefined>
  /** The Mac-only setting: off unless this Mac's own settings turned it on. */
  typing(): boolean
  type(session: string, bytes: string): Promise<Typed>
}
let current: Host | undefined
export const setScreenHost = (h?: Host): void => { current = h }

/** The screen for a chat, and whether the page may offer typing: the setting is on and a command runs. */
export async function readScreen(session: string, ansi: boolean, host: Host | undefined = current): Promise<(ScreenSnap & { typing: boolean }) | undefined> {
  const s = await host?.snapshot(session, ansi)
  return s && host ? { ...s, typing: host.typing() && s.running } : undefined
}

/** Checks the input, then the setting, then the host (which checks the terminal and what runs in it). */
export async function typeKeys(session: string, input: unknown, host: Host | undefined = current): Promise<Typed> {
  const k = keyBytes(input)
  if (!k.ok) return { status: 400, problem: k.problem }
  if (!host) return { status: 404, problem: 'no terminal in this window' }
  if (!host.typing()) return { status: 403, problem: 'Typing from here is off. Turn on "Switchboard: Screen Typing" in this Mac\'s settings.' }
  return host.type(session, k.bytes)
}
