/**
 * The demo's stand-in for a chat's terminal: a made-up Claude frame that moves each second, and typing that
 * lands on its prompt line. Same shape as extension/src/hub/screen.ts serves, so the Screen tab runs unchanged.
 */
import type { Screen, ScreenInput } from './screen'

/** typed: the prompt line; said: lines sent with Enter, the last three. */
export type DemoTyping = { typed: string; said: string[] }
export const NO_TYPING: DemoTyping = { typed: '', said: [] }

export function demoType(s: DemoTyping, i: ScreenInput): DemoTyping {
  if ('text' in i) return { ...s, typed: s.typed + i.text }
  if (i.key === 'enter') return s.typed ? { typed: '', said: [...s.said, s.typed].slice(-3) } : s
  return i.key === 'esc' || i.key === 'ctrl-c' ? { ...s, typed: '' } : s
}

const COLS = 100, ROWS = 24
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const TASKS = ['Find the failing test', 'Fix the rounding in cart.ts', 'Run the suite', 'Write the commit message']
const DIM = '2', BOLD = '1', ORANGE = '38;5;208', GREEN = '32', BLUE = '34', CYAN = '36', RED = '31'

type Part = string | [text: string, sgr: string]
const row = (...parts: Part[]) => {
  const plain = parts.map(p => typeof p === 'string' ? p : p[0]).join('')
  const ansi = parts.map(p => typeof p === 'string' ? p : `\x1b[0;${p[1]}m${p[0]}\x1b[0m`).join('')
  return { plain, ansi }
}
const right = (s: string, n: number) => ' '.repeat(Math.max(0, n - [...s].length)) + s

/** n: seconds since the view opened; it sets the spinner and how many steps are done. */
export function demoScreen(n: number, ansi: boolean, t: DemoTyping): Screen {
  const done = Math.floor(n / 4) % (TASKS.length + 1)
  const typed = [...t.typed].slice(-(COLS - 6)).join('')
  const rows = [
    row(['╭' + '─'.repeat(COLS - 2) + '╮', DIM]),
    row(['│ ', DIM], ['✻ Claude Code', `${ORANGE};${BOLD}`], [right('~/demo-app', COLS - 16), DIM], ['│', DIM]),
    row(['╰' + '─'.repeat(COLS - 2) + '╯', DIM]),
    row(''),
    ...t.said.map(x => row(['> ', BLUE], x)),
    row(['> ', BLUE], 'fix the failing checkout test'),
    row(''),
    row(['● ', GREEN], 'Read(src/cart.ts)'),
    row(['● ', GREEN], 'Edit(src/cart.ts)', [' +12 -3', DIM]),
    row([`${SPIN[n % SPIN.length]} `, ORANGE], ['Running the suite…', ORANGE], [` (${12 + n}s · esc to interrupt)`, DIM]),
    row(''),
    ...TASKS.map((x, i) => i < done ? row(['  ☒ ', GREEN], [x, DIM]) : row(['  ☐ ', CYAN], x)),
    row(''),
    row(['  1 failing, 41 passing', RED]),
    row(''),
    row(['╭' + '─'.repeat(COLS - 2) + '╮', DIM]),
    row(['│ ', DIM], ['> ', BLUE], typed, ' '.repeat(COLS - 5 - [...typed].length), ['│', DIM]),
    row(['╰' + '─'.repeat(COLS - 2) + '╯', DIM]),
    row(['  opus · high · 41% context', DIM]),
  ].slice(0, ROWS)
  return { cols: COLS, rows: ROWS, text: rows.map(r => r.plain).join('\n'), ...(ansi ? { ansi: rows.map(r => r.ansi).join('\n') } : {}), running: true, at: n, typing: true }
}
