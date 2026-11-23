/** Cheap first pass on a New chat message: does it hold more than one ask? The extension's hub-split call does the real split. */

const ITEM = /^\s*(?:\d+[.)]|[-*•])\s+\S/gm
const INLINE = /(?:^|\s)\(?\d+\)\s+\S/g
const NUMBERED = /(?:^|\s)\(?1[.)]\s+\S[\s\S]*\s\(?2[.)]\s+\S/
// A later sentence opening with one of these starts a new ask; mid-sentence "and then" stays one ask.
const JOINER = /^(?:also|plus|another thing|one more thing|and then|and also|additionally|separately|second(?:ly)?|third(?:ly)?|unrelated(?:ly)?)(?![\w-])/i
// After a line break or a comma only these do: ", plus" or ", and then" is usually one task.
const SOFT = /^(?:also|second(?:ly)?|third(?:ly)?)(?![\w-])/i

export function looksMulti(text: string): boolean {
  const t = text.trim()
  if ((t.match(ITEM)?.length ?? 0) >= 2 || (t.match(INLINE)?.length ?? 0) >= 2 || NUMBERED.test(t)) return true
  return t.split(/[.!?]+\s+/).slice(1).some(s => JOINER.test(s.trim())) || t.split(/\n+|,\s*/).slice(1).some(s => SOFT.test(s.trim()))
}

/** Chats started from one split share it. */
export const newGroupId = (now = Date.now()) => `g-${now.toString(36)}`

/** Merge back from the split preview: untouched asks give the original message, edited ones are joined so no edit is lost. */
export function mergeBack(original: string, split: string[], asks: string[]): string {
  if (asks.length === split.length && asks.every((a, i) => a === split[i])) return original
  return asks.map(a => a.trim()).filter(Boolean).join('\n\n')
}
