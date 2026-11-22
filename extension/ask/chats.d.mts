// Types for chats.mjs, so src/hub can use its outcome and follow helpers.
import type { HubState } from '../src/hub/types'
export function outcomeIn(s: HubState, id: string, now: number, missing?: Map<string, number>): { finished: boolean; clean: boolean }
export function follow(s: HubState, id: string): string
