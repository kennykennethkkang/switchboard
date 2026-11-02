/**
 * The standalone page reloads itself once its server serves another build, e.g. the app restarted on a
 * rebuilt Switchboard. The build is the ETags of index.js and index.css (app/src/static.ts); no-cache
 * revalidates against the copy the page loaded, so an unchanged build costs a 304.
 */
const FILES = ['/index.js', '/index.css']

async function served(f: typeof fetch): Promise<string | undefined> {
  try {
    const tags = await Promise.all(FILES.map(async p => (await f(p, { cache: 'no-cache' })).headers.get('ETag')))
    return tags.every(Boolean) ? tags.join(' ') : undefined
  } catch { return undefined }
}

/** One check per call: the first answer is what this page loaded; a later different one reloads. */
export function buildWatcher(reload: () => void, f: typeof fetch = fetch): () => Promise<void> {
  let loaded: string | undefined
  return async () => {
    const now = await served(f)
    if (!now) return
    if (!loaded) loaded = now
    else if (now !== loaded) reload()
  }
}
