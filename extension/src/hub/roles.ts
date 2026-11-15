/**
 * The model: line of a role file's frontmatter (~/.claude/agents/<role>.md), read for the hub
 * and rewritten by the gear's Role models rows. No vscode here.
 */
import * as fs from 'fs'
import * as path from 'path'

/** What the gear may write; inherit runs the role on the main chat's model. */
export const ROLE_MODELS = ['inherit', 'fable', 'opus', 'sonnet', 'haiku'] as const

const FRONT = /^---\r?\n[\s\S]*?\r?\n---(?=\r?\n|$)/
const LINE = /^model:[ \t]*(.*?)[ \t]*$/m

export function modelOf(text: string): string | undefined {
  const v = FRONT.exec(text)?.[0].match(LINE)?.[1].replace(/^["']|["']$/g, '')
  return v || undefined
}

/** text with its frontmatter model set (added before the closing fence when missing); undefined with no frontmatter. */
export function withModel(text: string, model: string): string | undefined {
  const front = FRONT.exec(text)?.[0]
  if (front === undefined) return undefined
  const nl = front.includes('\r\n') ? '\r\n' : '\n'
  const next = LINE.test(front) ? front.replace(LINE, `model: ${model}`) : front.replace(/\r?\n---$/, `${nl}model: ${model}${nl}---`)
  return next + text.slice(front.length)
}

/** Rewrites one role's model line; the reason when refused. role must name a file already in dir. */
export function setRoleModel(dir: string, role: string, model: string): string | undefined {
  if (!(ROLE_MODELS as readonly string[]).includes(model)) return `unknown model ${model}`
  let names: string[] = []
  try { names = fs.readdirSync(dir) } catch { /* no agents folder */ }
  if (!/^[\w.-]+$/.test(role) || !names.includes(`${role}.md`)) return `no role named ${role}`
  const file = path.join(dir, `${role}.md`)
  try {
    const next = withModel(fs.readFileSync(file, 'utf8'), model)
    if (next === undefined) return `${role}.md has no frontmatter`
    fs.writeFileSync(file, next)
  } catch (err) { return `could not write ${role}.md (${(err as Error).message})` }
  return undefined
}

export const CODEX_MODELS = ['gpt-6-luna', 'gpt-5.6-terra', 'gpt-5.6-luna'] as const
export const CODEX_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

// -m and -c model_reasoning_effort= flags straight after the command line's codex exec (not the description's); the file's command line is the only state.
const EXEC = /^(SWITCHBOARD_ROLE_RUN=\S+ codex exec)((?: -m \S+| -c model_reasoning_effort=\S+)*)/m

/** The Codex model and effort on a role's codex exec line (undefined = config.toml default); undefined when the body has no such line. */
export function codexOf(text: string): { model?: string; effort?: string } | undefined {
  const flags = EXEC.exec(text)?.[2]
  if (flags === undefined) return undefined
  return { model: /-m (\S+)/.exec(flags)?.[1], effort: /model_reasoning_effort=(\S+)/.exec(flags)?.[1] }
}

/** text with the codex exec flags replaced ('default' leaves a flag out); undefined with no codex exec line. */
export function withCodex(text: string, model: string, effort: string): string | undefined {
  if (!EXEC.test(text)) return undefined
  const flags = (model === 'default' ? '' : ` -m ${model}`) + (effort === 'default' ? '' : ` -c model_reasoning_effort=${effort}`)
  return text.replace(EXEC, (_, head: string) => head + flags)
}

/** Rewrites one role's codex exec flags; the reason when refused. */
export function setRoleCodex(dir: string, role: string, model: string, effort: string): string | undefined {
  if (model !== 'default' && !(CODEX_MODELS as readonly string[]).includes(model)) return `unknown model ${model}`
  if (effort !== 'default' && !(CODEX_EFFORTS as readonly string[]).includes(effort)) return `unknown effort ${effort}`
  let names: string[] = []
  try { names = fs.readdirSync(dir) } catch { /* no agents folder */ }
  if (!/^[\w.-]+$/.test(role) || !names.includes(`${role}.md`)) return `no role named ${role}`
  const file = path.join(dir, `${role}.md`)
  try {
    const next = withCodex(fs.readFileSync(file, 'utf8'), model, effort)
    if (next === undefined) return `${role}.md has no codex exec line`
    fs.writeFileSync(file, next)
  } catch (err) { return `could not write ${role}.md (${(err as Error).message})` }
  return undefined
}
