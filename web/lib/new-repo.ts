/** New chat's Project picker: two extra options that make the folder first. The extension checks again. */
export const NEW_REPO = '__new'
export const CLONE_REPO = '__clone'

const NAME = /^(?![.-])[A-Za-z0-9_.-]{1,100}$/
// Same rules as cloneTarget in extension/src/hub/projects.ts.
const PART = '[A-Za-z0-9_][A-Za-z0-9_.-]*?'
const CLONE = [
  new RegExp(`^(${PART})/(${PART})$`),
  new RegExp(`^https://github\\.com/(${PART})/(${PART})(?:\\.git)?/?$`),
  new RegExp(`^git@github\\.com:(${PART})/(${PART})(?:\\.git)?$`),
]

export function repoAsk(path: string, input: string, isPrivate: boolean): { create: string; private: boolean } | { clone: string } | undefined {
  const s = input.trim()
  if (path === NEW_REPO) return NAME.test(s) ? { create: s, private: isPrivate } : undefined
  if (path === CLONE_REPO) return CLONE.some(r => r.test(s)) ? { clone: s } : undefined
}
