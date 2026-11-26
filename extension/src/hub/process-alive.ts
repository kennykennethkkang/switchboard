import { execFileSync } from 'child_process'

export function processAlive(pid: number, platform: NodeJS.Platform = process.platform): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  if (platform === 'win32') {
    try { return execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).Id`], { encoding: 'utf8', windowsHide: true }).trim() === String(pid) } catch { return false }
  }
  try { process.kill(pid, 0); return true } catch { return false }
}
