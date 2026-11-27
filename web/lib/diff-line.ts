/** Line number a unified diff row points at: the new file's for added and kept rows, the old file's for removed ones. */
export function diffLine(rows: string[], at: number): { line: number; side: 'new' | 'old' } | undefined {
  let oldN = 0, newN = 0, inHunk = false
  for (let i = 0; i <= at && i < rows.length; i++) {
    const r = rows[i]
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(r)
    if (h) { oldN = +h[1]; newN = +h[2]; inHunk = true; if (i === at) return undefined; continue }
    if (!inHunk || r.startsWith('\\')) { if (i === at) return undefined; continue }
    if (r.startsWith('-')) { if (i === at) return { line: oldN, side: 'old' }; oldN++ }
    else if (r.startsWith('+')) { if (i === at) return { line: newN, side: 'new' }; newN++ }
    else { if (i === at) return { line: newN, side: 'new' }; oldN++; newN++ }
  }
  return undefined
}

/** The message a review note sends to the chat, or undefined for an empty note or a row with no line. */
export function reviewNote(file: string, rows: string[], at: number, note: string): string | undefined {
  const n = note.trim(), d = diffLine(rows, at)
  if (!n || !d) return undefined
  const text = rows[at].length > 120 ? rows[at].slice(0, 119) + '…' : rows[at]
  return `Review note on ${file}:${d.line}${d.side === 'old' ? ', removed line' : ''} (\`${text}\`): ${n}`
}
