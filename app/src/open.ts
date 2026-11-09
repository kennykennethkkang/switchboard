/** How the app opens its page: -g keeps the browser behind what Kenneth has in front. Windows uses start (server.ts). */
export function openCmd(url: string, platform: NodeJS.Platform = process.platform): { cmd: string; args: string[] } | undefined {
  if (platform === 'win32') return undefined
  return platform === 'darwin' ? { cmd: 'open', args: ['-g', url] } : { cmd: 'xdg-open', args: [url] }
}
