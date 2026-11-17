type Store = 'local' | 'session'

const storage = (store: Store) => store === 'session' ? sessionStorage : localStorage

export function readStore(key: string, store: Store = 'local'): string | null {
  try { return storage(store).getItem(key) } catch { return null }
}

export function writeStore(key: string, value: string, store: Store = 'local') {
  try { storage(store).setItem(key, value) } catch { /* storage can be unavailable or full */ }
}

export function removeStore(key: string, store: Store = 'local') {
  try { storage(store).removeItem(key) } catch { /* storage can be unavailable */ }
}
