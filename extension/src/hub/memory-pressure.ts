import { sharedRun } from './shared-run'

const CACHE_MS = 30_000
let cached: { at: number; level: number | undefined } | undefined

export const memoryPressure = (output: string): number | undefined => {
  const value = output.trim()
  return /^[124]$/.test(value) ? Number(value) : undefined
}

export function readMemoryPressure(directory?: string): Promise<number | undefined> {
  if (process.platform !== 'darwin') return Promise.resolve(undefined)
  if (cached && Date.now() - cached.at < CACHE_MS) return Promise.resolve(cached.level)
  return sharedRun('sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'], { ttlMs: CACHE_MS, timeoutMs: 800, directory })
    .then(output => { const level = memoryPressure(output); cached = { at: Date.now(), level }; return level })
}
