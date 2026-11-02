/** Files attached in the message box: the size cap, how the saved paths ride along in the message. */
import type { UploadAck, UploadToExtension } from './vscode-bridge'

/** The panel cuts a message to this (hub-panel.ts sendToChat), paths included. */
export const MAX_MESSAGE = 4000
/** Same cap as extension/src/hub/uploads.ts. */
export const UPLOAD_MAX = 100 * 1024 * 1024

/** Where a file was saved, or why it was not. onProgress: 0 to 1, where the transport can tell. signal: the chip was removed, stop and drop the partial file. */
export type Upload = (file: File, cwd: string, session: string | undefined, onProgress: (f: number) => void, signal?: AbortSignal) => Promise<{ path: string } | { problem: string }>

/** Slice size over the VS Code bridge: one slice in memory at a time instead of the whole file. */
export const SLICE = 4 * 1024 * 1024

/** VS Code's way in: start, then each slice only after the extension acks the last, then end. A done can come early (cap, disk); abort tells the extension to drop the partial file. */
export async function sendSlices(file: File, head: { id: string; cwd: string; session?: string }, post: (m: UploadToExtension) => void, listen: (cb: (m: UploadAck) => void) => () => void,
  onProgress: (f: number) => void, signal?: AbortSignal, size = SLICE): Promise<{ path: string } | { problem: string }> {
  const { id } = head
  const inbox: UploadAck[] = []
  let wake = () => {}
  const unlisten = listen(m => { inbox.push(m); wake() })
  const next = async () => {
    while (!inbox.length) await new Promise<void>(r => (wake = r))
    return inbox.shift()!
  }
  const removed = { type: 'upload-done', id, problem: 'removed' } as const
  const onAbort = () => { post({ type: 'upload-abort', id }); inbox.unshift(removed); wake() }
  if (signal?.aborted) return { problem: 'removed' }
  signal?.addEventListener('abort', onAbort, { once: true })
  const end = (m: UploadAck & { type: 'upload-done' }) => (m.path ? { path: m.path } : { problem: m.problem || 'the upload failed' })
  try {
    post({ type: 'upload-start', ...head, name: file.name })
    for (let at = 0; at < file.size; at += size) {
      const data = await file.slice(at, at + size).arrayBuffer()
      if (inbox[0]?.type === 'upload-done') return end(inbox[0])
      post({ type: 'upload-chunk', id, data })
      const m = await next()
      if (m.type === 'upload-done') return end(m)
      onProgress(Math.min(1, (at + size) / file.size))
    }
    post({ type: 'upload-end', id })
    for (;;) { const m = await next(); if (m.type === 'upload-done') return end(m) }
  } finally {
    signal?.removeEventListener('abort', onAbort)
    unlisten()
  }
}

export const fmtSize = (n: number) => n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`

/** The message as sent: the text, then one line per saved file so the chat can Read it. Empty when there is nothing. */
export function withAttached(text: string, paths: string[]): string {
  const t = text.trim()
  if (!paths.length) return t
  const list = `Attached files:\n${paths.map(p => `- ${p}`).join('\n')}`
  return t ? `${t}\n\n${list}` : list
}
