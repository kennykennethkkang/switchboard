// Unsent text per box, kept in localStorage so a re-render, chat switch, reload or killed tab loses nothing.
// Keys: msg:<sessionId>, newchat. Each entry carries the time it was saved, used for expiry and as its stamp.

const KEY = 'switchboard-drafts'
export const DRAFT_DAYS = 7
export const MAX_DRAFT = 20_000
export const MAX_DRAFTS = 50

type Draft = { t: string; at: number }
type All = Record<string, Draft>

function load(now: number): All {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    if (!all || typeof all !== 'object') return {}
    const out: All = {}
    for (const [k, d] of Object.entries(all as All))
      if (typeof d?.t === 'string' && typeof d.at === 'number' && now - d.at < DRAFT_DAYS * 86_400_000) out[k] = d
    return out
  } catch { return {} }
}

function save(all: All) {
  // Oldest go first past the cap.
  const keep = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_DRAFTS)
  try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(keep))) } catch { /* no storage or full */ }
}

export function getDraft(key: string, now = Date.now()): string {
  return load(now)[key]?.t ?? ''
}

/** Saves text under key (empty removes it) and returns the stamp for clearDraft. */
export function setDraft(key: string, text: string, now = Date.now()): number {
  const all = load(now)
  if (text) all[key] = { t: text.slice(0, MAX_DRAFT), at: now }
  else delete all[key]
  save(all)
  return now
}

/** Removes the draft; with a stamp, only if nothing was saved after it. */
export function clearDraft(key: string, stamp?: number, now = Date.now()) {
  const all = load(now)
  if (!all[key] || (stamp !== undefined && all[key].at !== stamp)) return
  delete all[key]
  save(all)
}
