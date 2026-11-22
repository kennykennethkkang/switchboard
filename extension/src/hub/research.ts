/**
 * Research mode: one folder, ~/Documents/Research, that is always a project. Chats there skip the aar gate and the finish hold,
 * and recall can be limited to its memory. usage-meter offers it to a chat that looks like research; the offers sit in
 * HubState.researchOffers until dismissed or 30 minutes old.
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { foldPathCase } from '../fs-utils'
import type { HubState } from './types'

export const RESEARCH_ROOT = path.join(os.homedir(), 'Documents', 'Research')

/** The research folder, made when it is not there yet. */
export function ensureResearchRoot(dir = RESEARCH_ROOT): string {
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

const key = (p: string) => foldPathCase(p.replace(/\\/g, '/').replace(/\/+$/, ''))

/** Whether cwd is the research folder or inside it. Text only, no disk read. */
export function isResearch(cwd: unknown, root = RESEARCH_ROOT): boolean {
  if (typeof cwd !== 'string' || !cwd) return false
  const r = key(root), c = key(path.posix.normalize(cwd.replace(/\\/g, '/')))
  return c === r || c.startsWith(`${r}/`)
}

export type ResearchOffer = NonNullable<HubState['researchOffers']>[number]
export const OFFER_MS = 30 * 60_000
// Sessions whose offer was dismissed, so the next prompt does not bring it back. Memory only, newest 200.
const dismissed = new Set<string>()

const fresh = (list: ResearchOffer[], now: number) => list.filter(o => now - o.at < OFFER_MS)

/** The list with this offer added: one per session, none for a dismissed session, expired ones dropped. */
export function addOffer(list: ResearchOffer[] | undefined, offer: Omit<ResearchOffer, 'at'>, now = Date.now()): ResearchOffer[] {
  const live = fresh(list ?? [], now)
  if (dismissed.has(offer.sessionId) || live.some(o => o.sessionId === offer.sessionId)) return live
  return [...live, { ...offer, at: now }]
}

/** The list without this session's offer; the session is not offered again. */
export function dropOffer(list: ResearchOffer[] | undefined, sessionId: string): ResearchOffer[] {
  dismissed.add(sessionId)
  if (dismissed.size > 200) dismissed.delete(dismissed.values().next().value as string)
  return (list ?? []).filter(o => o.sessionId !== sessionId)
}

type Hub = { get(): HubState; set(part: Partial<HubState>): void }

/** Stores an offer in hub state, and drops it again once it is old. */
export function offerResearch(hub: Hub, offer: Omit<ResearchOffer, 'at'>): void {
  hub.set({ researchOffers: addOffer(hub.get().researchOffers, offer) })
  setTimeout(() => hub.set({ researchOffers: fresh(hub.get().researchOffers ?? [], Date.now()) }), OFFER_MS + 1000).unref?.()
}

/** hub-research-dismiss: Kenneth said no to this session's offer. */
export const dismissOffer = (hub: Hub, sessionId: string): void => hub.set({ researchOffers: dropOffer(hub.get().researchOffers, sessionId) })
