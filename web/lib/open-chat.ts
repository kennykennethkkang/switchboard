/** Whether a page goes to the chat opened last, in a terminal or on another page (hub.openChat). */
type Open = { sessionId: string; at: number } | undefined

/** seen: the last one this page went to or picked itself, 0 right after it loads. A page in use is never moved under the reader. */
export function follows(open: Open, seen: number, inUse: boolean, listed: (id: string) => boolean): open is NonNullable<Open> {
  return !!open && open.at > seen && (seen === 0 || !inUse) && listed(open.sessionId)
}
