// Path helpers with no node imports, so web/ can share them.
const PLATFORM: NodeJS.Platform = typeof process === 'undefined' ? 'linux' : process.platform

export function displayPath(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).slice(-2).join('/')
}

const norm = (value: string, platform: NodeJS.Platform) => {
  const absolute = value.replace(/\\/g, '/').replace(/\/{2,}/g, '/')
  const drive = /^[A-Za-z]:/.exec(absolute)?.[0] ?? ''
  const rest = drive ? absolute.slice(2) : absolute
  const parts: string[] = []
  for (const part of rest.split('/')) {
    if (!part || part === '.') continue
    if (part === '..' && parts.length && parts.at(-1) !== '..') parts.pop()
    else if (part !== '..' || !absolute.startsWith('/')) parts.push(part)
  }
  const prefix = drive ? `${drive}${rest.startsWith('/') ? '/' : ''}` : absolute.startsWith('/') ? '/' : ''
  const resolved = `${prefix}${parts.join('/')}`.replace(/\/$/, '')
  return platform === 'win32' ? resolved.toLowerCase() : resolved
}

export function insidePath(root: string, candidate: string, platform: NodeJS.Platform = PLATFORM): boolean {
  const base = norm(root, platform), full = norm(candidate, platform)
  return full.startsWith(`${base}/`)
}

export const samePath = (a: string, b: string, platform: NodeJS.Platform = PLATFORM) => {
  return norm(a, platform) === norm(b, platform)
}
