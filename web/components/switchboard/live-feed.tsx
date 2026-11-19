import type { ReactNode } from 'react'

// Newest first; the top row fades in so a fresh entry reads as live without moving the rest.
export function LiveFeed({ label, rows }: { label: string; rows: { key: string; head: ReactNode; text?: string }[] }) {
  if (!rows.length) return null
  return (
    <ol aria-label={label} aria-live="polite" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
      {rows.map((r, i) => (
        <li key={r.key} className={i === 0 ? 'hub-feed-new' : undefined} style={{ display: 'grid', gap: 2, minWidth: 0, opacity: i === 0 ? 1 : Math.max(0.55, 1 - i * 0.08) }}>
          <span style={{ fontSize: 12, color: 'var(--hub-mute)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.head}</span>
          {r.text && <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--hub-body)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{r.text}</span>}
        </li>
      ))}
    </ol>
  )
}
