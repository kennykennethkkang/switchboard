import * as fs from 'node:fs'

/** Calls .cmd/.bat shims through cmd.exe, quoting every argument. */
const PLATFORM: NodeJS.Platform = typeof process === 'undefined' ? 'linux' : process.platform

function resolveCommand(bin: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string {
  if (platform !== 'win32' || /[\\/]/.test(bin)) return bin
  const extensions = /\.[^\\/.]+$/.test(bin) ? [''] : (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';')
  for (const dir of (env.PATH ?? '').split(';')) {
    for (const ext of extensions) {
      const candidate = `${dir}/${bin}${ext}`
      if (fs.existsSync(candidate)) return candidate
    }
  }
  return bin
}

// cross-spawn's metaCharsRegExp; the space matters for C:\Program Files paths
const META = /[()\][%!^"`<>&|;, *?]/g

function escapeCommand(value: string): string {
  return value.replace(META, '^$&')
}

function escapeArgument(value: string, twice: boolean): string {
  let escaped = `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/g, '$1$1')}"`
  escaped = escaped.replace(META, '^$&')
  return twice ? escaped.replace(META, '^$&') : escaped
}

// windowsVerbatimArguments: without it Node quotes the cmd line again and cmd.exe sees \" (callers pass it into spawn/execFile)
export function cliCall(bin: string, args: string[], platform: NodeJS.Platform = PLATFORM, env: NodeJS.ProcessEnv = process.env): { cmd: string; args: string[]; windowsVerbatimArguments?: boolean } {
  if (platform !== 'win32') return { cmd: bin, args }
  const command = resolveCommand(bin, platform, env)
  if (!/\.(?:cmd|bat)$/i.test(command)) return { cmd: command, args }
  if ([command, ...args].some(arg => /[\r\n\0]/.test(arg))) throw new Error('Command shim arguments cannot contain line breaks or NUL')
  const twice = /(?:^|[\\/])npm(?:\.cmd)?$/i.test(command)
  // Escaping follows cross-spawn (MIT, Andre Cruz).
  const commandLine = [escapeCommand(command), ...args.map(arg => escapeArgument(arg, twice))].join(' ')
  return { cmd: 'cmd.exe', args: ['/d', '/s', '/c', `"${commandLine}"`], windowsVerbatimArguments: true }
}

export { displayPath, insidePath, samePath } from './win-path'
