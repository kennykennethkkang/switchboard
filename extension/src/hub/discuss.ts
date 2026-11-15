// A discussion between the two AIs: the chat's own asks the other one, headless, in the chat's folder.
import { spawn as nodeSpawn } from 'child_process'
import { claudeBinary } from './setup'

export type Ai = 'claude' | 'codex'
export type Turn = { ai: Ai; text: string }
/** Runs one headless turn and answers its text; rejects with the CLI's output, or SpawnTimeout. */
export type Spawn = (ai: Ai, prompt: string, cwd: string) => Promise<string>
export type DiscussInput = { question: string; from: Ai; with?: Ai; rounds?: number; context?: string; cwd: string }
export type DiscussResult = { turns: Turn[]; text: string; error?: string }

export const TURN_MS = 5 * 60_000
export class SpawnTimeout extends Error {}

export const otherAi = (a: Ai): Ai => (a === 'claude' ? 'codex' : 'claude')

const NO_FILES = 'Read-only: do not edit, create or delete files, and do not run commands that change anything. Never open or quote secret-looking files (.env*, *.pem, *.key, id_*, *secret*, *credential*); name them only.'

/** Only the final turn asks for the Agreed/Disagreed lines. */
export function turnPrompt(ai: Ai, question: string, turns: Turn[], last: boolean, context?: string): string {
  const log = turns.map(t => `${t.ai.toUpperCase()}:\n${t.text}`).join('\n\n')
  return [
    `You are ${ai}, in a short discussion with another AI about a question from a developer's chat.`,
    NO_FILES,
    `Question: ${question}`,
    context ? `Context: ${context}` : '',
    log ? `So far:\n${log}\n\nReply to the last message: say what you accept, what you dispute and why. Be brief.` : 'Give your answer and reasons. Be brief.',
    last ? 'End with exactly two lines: "Agreed on: ..." and "Disagreed on: ..." (write "none" when empty).' : '',
  ].filter(Boolean).join('\n\n')
}

/** The Agreed/Disagreed lines of the last reply. */
export function summaryOf(reply: string): string {
  const pick = (k: string) => reply.match(new RegExp(`^\\W*${k} on:\\s*(.+)$`, 'im'))?.[1].trim() ?? 'not stated'
  return `Agreed on: ${pick('Agreed')}\nDisagreed on: ${pick('Disagreed')}`
}

/** A plain reason for a CLI that failed. */
export function failureText(ai: Ai, output: string, timedOut = false): string {
  if (timedOut) return `${ai} timed out (${TURN_MS / 60_000} min); try a smaller question.`
  const login = ai === 'codex' ? 'codex login' : 'claude, then /login'
  if (/not logged in|not signed in|log ?in|sign ?in|unauthorized|401|authentication/i.test(output)) return `${ai} is signed out; sign in with ${login}.`
  if (/usage limit|rate limit|hit your|quota|429|too many requests/i.test(output)) return `${ai} hit its usage limit; try again when it resets.`
  return `${ai} failed: ${output.trim().split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 300) || 'no output'}`
}

export async function discuss(input: DiscussInput, run: Spawn): Promise<DiscussResult> {
  const other = input.with ?? otherAi(input.from)
  const mine = otherAi(other)
  const rounds = Math.min(3, Math.max(1, Math.floor(input.rounds ?? 1)))
  // The other AI speaks `rounds` times; between its turns the chat's own AI answers.
  const total = rounds * 2 - 1
  const turns: Turn[] = []
  const show = () => turns.map(t => `${t.ai}:\n${t.text}`).join('\n\n')
  for (let i = 0; i < total; i++) {
    const ai = i % 2 === 0 ? other : mine
    try {
      const reply = (await run(ai, turnPrompt(ai, input.question, turns, i === total - 1, input.context), input.cwd)).trim()
      turns.push({ ai, text: reply })
    } catch (err) {
      const e = failureText(ai, String((err as Error).message ?? err), err instanceof SpawnTimeout)
      return { turns, text: `${show()}${turns.length ? '\n\n' : ''}Discussion stopped: ${e}`, error: e }
    }
  }
  return { turns, text: `${show()}\n\n${summaryOf(turns[turns.length - 1].text)}` }
}

/** Both sides read-only: Codex in its read-only sandbox, Claude with read tools only. */
export const cliArgs = (ai: Ai): [string, string[]] => ai === 'codex'
  ? ['codex', ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '-']]
  : [claudeBinary(), ['-p', '--no-session-persistence', '--tools', 'Read,Grep,Glob']]

/** The real thing: the prompt on stdin, the reply on stdout. */
export const runCli: Spawn = (ai, prompt, cwd) => new Promise((resolve, reject) => {
  const [cmd, args] = cliArgs(ai)
  const child = nodeSpawn(cmd, args, { cwd, env: { ...process.env, CLAUDE_CODE_CHILD_SESSION: '1' }, stdio: ['pipe', 'pipe', 'pipe'] })
  let out = '', err = '', timedOut = false
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, TURN_MS)
  child.stdout.on('data', d => { out += d })
  child.stderr.on('data', d => { err += d })
  child.on('error', e => { clearTimeout(timer); reject(e) })
  child.on('close', code => {
    clearTimeout(timer)
    if (timedOut) return reject(new SpawnTimeout('timeout'))
    if (code === 0 && out.trim()) return resolve(out)
    reject(new Error(`${err}\n${out}`.trim() || `exit ${code}`))
  })
  child.stdin.on('error', () => {})
  child.stdin.end(prompt)
})
