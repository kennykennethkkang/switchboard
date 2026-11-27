/** Smart select's pure parts (the learned override and the task label), so the web UI can show the same pick (loop.ts). */
export type Stats = Record<string, Record<string, Record<string, { n: number; useful: number }>>>
const MIN_N = 5
const LEAD = 0.15

const WORDS: Array<[string, RegExp]> = [
  ['audit', /\b(audit|security review|vulnerab)/i],
  ['review', /\b(review|qa|check the diff)\b/i],
  ['research', /\b(research|investigate|find out|compare|look into|survey)\b/i],
  ['fix', /\b(fix|bug|broken|crash|error|regression|fails?|failing)\b/i],
  ['ui', /\b(ui|screen|button|page|layout|css|style|design|modal|view|panel|mobile)\b/i],
  ['tiny', /\b(typo|rename|one.?liner|tweak|bump|small)\b/i],
  ['feature', /\b(add|build|implement|create|new|support|feature)\b/i],
]
/** The contract's task label for a goal; question rows use their header instead. */
export const taskLabel = (text: string): string => WORDS.find(([, re]) => re.test(text))?.[0] ?? 'other'
/** Code work by the label; New chat and To-do runs start these in their own worktree (codeWorktrees). */
export const codeTask = (text: string) => ['fix', 'ui', 'tiny', 'feature'].includes(taskLabel(text))

const rate = (c?: { n: number; useful: number }) => ((c?.useful ?? 0) + 1) / ((c?.n ?? 0) + 2)

/** The rule pick, unless another offered option for the same kind and task has n >= 5 and a Laplace rate 0.15 higher. */
export function smartPick(kind: string, task: string, rulePick: string, options: string[], stats: Stats): { pick: string; why?: string } {
  const row = stats[kind]?.[task] ?? {}
  let best: string | undefined, top = rate(row[rulePick]) + LEAD
  for (const o of options) {
    const c = row[o]
    if (o === rulePick || !c || c.n < MIN_N) continue
    if (rate(c) >= top) { best = o; top = rate(c) }
  }
  if (!best) return { pick: rulePick }
  const c = row[best]
  return { pick: best, why: `learned: ${best} kept ${Math.round(100 * c.useful / c.n)}% of ${c.n}` }
}

/** The table from the hub's flat rates (SmartState.rates). */
export function statsOf(rates: Array<{ kind: string; task: string; pick: string; n: number; useful: number }> = []): Stats {
  const s: Stats = {}
  for (const r of rates) ((s[r.kind] ??= {})[r.task] ??= {})[r.pick] = { n: r.n, useful: r.useful }
  return s
}
