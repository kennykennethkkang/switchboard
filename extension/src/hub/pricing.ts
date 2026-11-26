export type UsageTokens = { input: number; output: number; cacheRead: number; cacheWrite: number; thinking: number }
export type CostOptions = { cacheWrite5m?: number; cacheWrite1h?: number; searches?: number; speed?: string }

// List prices checked 2026-11-23: https://platform.claude.com/docs/en/about-claude/pricing and https://developers.openai.com/api/docs/pricing
export type UsageCostSplit = { input: number; output: number; cacheRead: number; cacheWrite: number; search: number }

export function costSplit(model: string, t: UsageTokens, opts: CostOptions = {}): UsageCostSplit | undefined {
  const m = model.toLowerCase()
  let input: number, output: number, cached: number, longInput = false
  if (/^(claude-)?(fable|mythos)-5-2/.test(m)) [input, output, cached] = [8, 40, 0.2]
  else if (/^(claude-)?(fable|mythos)-5-1/.test(m)) [input, output, cached] = [10, 50, 0.25]
  else if (/^(claude-)?(fable|mythos)/.test(m)) [input, output, cached] = [10, 50, 1]
  else if (/^(claude-)?opus-5-5/.test(m)) [input, output, cached] = [4, 20, 0.2]
  else if (/^(claude-)?opus-4-(?:1|0|2025)/.test(m)) [input, output, cached] = [15, 75, 1.5]
  else if (/^(claude-)?opus/.test(m)) [input, output, cached] = [5, 25, 0.5]
  else if (/^(claude-)?sonnet-5-5/.test(m)) [input, output, cached] = [2, 10, 0.1]
  else if (/^(claude-)?sonnet-5(?:-|$)/.test(m)) [input, output, cached] = [2, 10, 0.2]
  else if (/^(claude-)?sonnet/.test(m)) [input, output, cached] = [3, 15, 0.3]
  else if (/^(claude-)?haiku-5-5/.test(m)) {
    longInput = t.input + t.cacheRead + t.cacheWrite > 100_000
    ;[input, output, cached] = longInput ? [0.5, 2.5, 0.05] : [0.1, 0.5, 0.01]
  } else if (/^(claude-)?haiku/.test(m)) [input, output, cached] = [1, 5, 0.1]
  else if (/^gpt-/.test(m)) {
    const prices: Record<string, [number, number, number]> = {
      'gpt-6-luna': [0.1, 0.5, 0.01], 'gpt-6-sol': [2, 10, 0.2], 'gpt-6-astra': [10, 50, 1],
      'gpt-6.1-sol': [2, 10, 0.1], 'gpt-6.1-terra': [1, 5, 0.05], 'gpt-6.2-sol': [2, 10, 0.1], 'gpt-6.2-astra': [8, 40, 0.4],
      'gpt-5.6-luna': [0.2, 1.2, 0.02], 'gpt-5.6-terra': [2, 12, 0.2], 'gpt-5.6-sol': [4, 20, 0.4], 'gpt-5.5': [5, 30, 0.5],
      'gpt-5.4': [2.5, 15, 0.25], 'gpt-5.3-codex': [1.75, 14, 0.175],
    }
    const price = prices[m]
    if (!price) return undefined
    ;[input, output, cached] = price
    if (t.input + t.cacheRead + t.cacheWrite > 272_000 && m !== 'gpt-5.3-codex') { input *= 2; cached *= 2; output *= 1.5 }
  } else return undefined
  const write5m = opts.cacheWrite5m === undefined && opts.cacheWrite1h === undefined ? t.cacheWrite : opts.cacheWrite5m ?? 0
  const write1h = opts.cacheWrite1h ?? 0
  const multiplier = opts.speed === 'fast' ? 2 : 1
  return {
    input: multiplier * t.input * input / 1_000_000,
    output: multiplier * t.output * output / 1_000_000,
    cacheRead: multiplier * t.cacheRead * cached / 1_000_000,
    cacheWrite: multiplier * (write5m * input * 1.25 + write1h * input * 2) / 1_000_000,
    search: multiplier * (opts.searches ?? 0) * 0.01,
  }
}

export function costOf(model: string, t: UsageTokens, opts: CostOptions = {}): number | undefined {
  const split = costSplit(model, t, opts)
  return split && split.input + split.output + split.cacheRead + split.cacheWrite + split.search
}
