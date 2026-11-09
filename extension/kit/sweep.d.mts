// Types for sweep.mjs, so src/hub/sweep.ts and the tests can import it.
import type { SweepRecord, SweepReview, SweepVerdict } from '../src/hub/types'
export type { SweepRecord, SweepReview, SweepVerdict }
type Run = (cmd: string, args: string[]) => Promise<{ error?: (Error & { code?: unknown }) | null; stderr: string }>
type Scan = (dir: string) => Promise<SweepVerdict>

export function sweepFile(home?: string): string
export function skillspector(home?: string): string
export function verdict(report: unknown): SweepVerdict
export function scan(dir: string, o?: { bin?: string; run?: Run }): Promise<SweepVerdict>
export function digest(dir: string): string
export function symlinkIn(dir: string): string | undefined
export function readSweep(home?: string): Record<string, SweepRecord>
export function held(rec: SweepRecord | undefined): boolean
export function needsApproval(rec: SweepRecord | undefined, current?: string): boolean
export function sweepOne(name: string, kind: 'plugin' | 'skill', dir: string, o?: { home?: string; scan?: Scan; force?: boolean }): Promise<SweepRecord>
export function approve(name: string, o?: { home?: string; path?: string; digest?: string }): SweepRecord | undefined
export function markReviewed(home: string, name: string, verdict: SweepReview['verdict'], why: string): SweepRecord | undefined
export function intakeSkill(src: string, name: string, o?: { home?: string; scan?: Scan; hold?: boolean }): Promise<SweepRecord>
export function pluginDir(id: string, home?: string): string | undefined
export function intakePlugin(id: string, o: { home?: string; scan?: Scan; set: (id: string, on: boolean) => Promise<unknown>; hold?: boolean }): Promise<SweepRecord | undefined>
export function repoOf(input: unknown): string | undefined
