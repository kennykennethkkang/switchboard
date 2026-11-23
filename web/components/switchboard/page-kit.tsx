'use client'
import type { ReactNode } from 'react'
import './page-kit.css'

// Shared pieces for the Live, Plan, Ship and Code pages so they read as one site.

export type Stat = { label: string; value: ReactNode; tone?: 'blue' | 'green' | 'red' | 'yellow'; hint?: string; onClick?: () => void }

/** A row of key numbers under the page title. */
export function PageStats({ items, label }: { items: Stat[]; label: string }) {
  return (
    <dl className="pk-stats" aria-label={label}>
      {items.map(s => (
        // A clickable stat keeps valid dl markup: the button sits in the dt and stretches over the tile.
        <div key={s.label} data-click={s.onClick ? true : undefined}>
          <dt>{s.onClick ? <button type="button" onClick={s.onClick}>{s.label}</button> : s.label}</dt>
          <dd data-tone={s.tone}>{s.value}</dd>
          {s.hint && <dd className="pk-hint">{s.hint}</dd>}
        </div>
      ))}
    </dl>
  )
}

/** Segmented switch; buttons with aria-pressed, like the Map modes. */
export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string, number?][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="pk-seg" role="group" aria-label={label}>
      {options.map(([v, word, n]) => (
        <button key={v} type="button" aria-pressed={v === value} onClick={() => onChange(v)}>
          {word}{n !== undefined && <span className="pk-n">{n}</span>}
        </button>
      ))}
    </div>
  )
}

/** A titled section: heading, optional count and right-side actions, then the body. */
export function Sec({ id, title, count, note, actions, children, flat }: { id: string; title: string; count?: number; note?: ReactNode; actions?: ReactNode; children: ReactNode; flat?: boolean }) {
  return (
    <section className="pk-sec" data-flat={flat || undefined} aria-labelledby={id}>
      <header className="pk-sec-head">
        <h2 id={id}>{title}{count !== undefined && <span className="pk-n">{count}</span>}</h2>
        {actions && <span className="pk-sec-acts">{actions}</span>}
        {note && <p className="pk-note">{note}</p>}
      </header>
      {children}
    </section>
  )
}
