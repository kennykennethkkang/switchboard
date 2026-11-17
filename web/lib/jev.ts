/** The Jev card's words: a project's jobs from Set up Jev, its newest runs and their cost. */
import type { JevProject } from './hub-types'
import { ago } from './look'

const JOBS = [['done', 'Done-check'], ['gate', 'Risky commands'], ['tells', 'AI-tell check'], ['route', 'Roles']] as const
const TIP: Record<string, string> = {
  done: "Scores each request in a chat against its Done list, with this project's preset",
  gate: 'Asks you before a Bash command Jev rates destructive, paid or prod; reads and paid-guard calls skip it',
  tells: 'Before a chat finishes, flags em dashes and machine-sounding lines in the diff and commit message',
  route: "Labels tasks with a role and qa's findings by severity, for the lead",
}

export function jevView(p: JevProject | undefined, now = Date.now()) {
  const jobs = JOBS.map(([key, label]) => ({ key, label, on: Boolean(p?.jobs[key]), tip: TIP[key] }))
  const runs = (p?.runs ?? []).map(r => [r.job, r.result ?? `${r.items} item${r.items === 1 ? '' : 's'}`, `${ago(r.at, now)} ago`].join(' · '))
  const cost = p ? `$${p.costUsd.toFixed(p.costUsd < 0.1 ? 4 : 2)}` : ''
  return { jobs, runs, cost, anyOn: jobs.some(j => j.on) }
}

/** What the Set up Jev button types into its new chat. */
export const setupPrompt = (folder: string) => `/jev-setup-project for ${folder}: use the claude-x-jev skill, task setup-project. Draft this repo's presets, check each on a few real items, then turn the jobs on for this project only.`
