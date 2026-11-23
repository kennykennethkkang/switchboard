'use client'
/** Pieces of the Code view around the graph: project summary, ranked list, legend, note row. */
import { useState } from 'react'
import { colName, when, type Parts } from '@/lib/flow-map'
import type { GraphNode } from '@/lib/memory-graph'
import { ago, byActivity, type Heat } from './fm-data'

export const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
export const partName = (p: { path: string; name: string }) => (p.path === '.' ? p.name : p.path)

export function Note({ n }: { n: GraphNode }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="fm-note-i">
      <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)}><span>{n.label}</span>{n.description && <small>{n.description}</small>}</button>
      {open && <p>{n.text || n.description || 'No text.'}</p>}
    </li>
  )
}

/** Short, one line each; the old key was a sentence. */
export function Legend({ back }: { back: boolean }) {
  return (
    <ul className="fm-key" aria-label="Key">
      <li><svg aria-hidden width="26" height="10"><path d="M1 5h20" /><path d="M19 1.5 24 5l-5 3.5z" className="head" /></svg>Uses, thicker is more</li>
      <li><svg aria-hidden width="26" height="10"><path d="M1 5h22" className="out" /></svg>Uses of hovered</li>
      <li><svg aria-hidden width="26" height="10"><path d="M1 5h22" className="in" /></svg>Used by hovered</li>
      {back && <li><svg aria-hidden width="26" height="10"><path d="M1 5h22" className="back" /></svg>Back a column</li>}
      <li><i className="fm-entry" aria-hidden />Entry</li>
      <li><i className="fm-hot-key" aria-hidden />Hot: changed lately, with its age</li>
    </ul>
  )
}

type Pick = (id: string) => void

/** Parts ranked by recent activity, one row each. */
export function Rank({ all, heat, max, picked, onPick }: { all: Parts; heat: Map<string, Heat>; max: number; picked?: string; onPick: Pick }) {
  const rows = [...all.parts].sort(byActivity(heat))
  return (
    <div className="fm-rank">
      <ul>
        <li className="fm-rank-h" aria-hidden><span>Part</span><span>Activity</span><span>Last change</span><span>Files</span><span>Uses</span></li>
        {rows.map(p => {
          const h = heat.get(p.id)!
          const out = all.links.filter(l => l.from === p.id).length, ins = all.links.filter(l => l.to === p.id).length
          return (
            <li key={p.id}>
              <button type="button" aria-pressed={p.id === picked} data-hot={h.hot || undefined} onClick={() => onPick(p.id)}>
                <span className="fm-r-name"><b>{partName(p)}</b><small>{p.about ?? p.files.slice(0, 3).map(f => f.split('/').pop()).join(', ')}</small></span>
                <span className="fm-r-act"><i className="fm-bar-h"><i style={{ width: `${h.n ? Math.max(6, (h.n / max) * 100) : 0}%` }} /></i><em>{h.n ? `${h.hot ? 'Hot, ' : ''}${plural(h.n, 'change')}` : 'quiet'}</em></span>
                <span className="fm-r-last">{h.last ? <>{when(h.last)}, {ago(h.last)}<small>{h.who}</small></> : <small>none</small>}</span>
                <span className="fm-r-n" data-l="files">{p.files.length}</span>
                <span className="fm-r-n" data-l="links" title={`Used by ${plural(ins, 'part')}, uses ${plural(out, 'part')}`}>used by {ins}, uses {out}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Layers, for the phone: no canvas, so the flow is columns of rows. */
export function Layers({ all, heat, picked, onPick }: { all: Parts; heat: Map<string, Heat>; picked?: string; onPick: Pick }) {
  const depths = [...new Set(all.parts.map(p => p.depth))].sort((a, b) => a - b)
  return (
    <div className="fm-list">
      {depths.map((d, i) => {
        const of = all.parts.filter(p => p.depth === d)
        return (
          <section key={d}>
            <h4>{colName(i, !all.links.length || of.some(p => p.alone))} <b>{of.length}</b></h4>
            <ul>{of.map(p => {
              const h = heat.get(p.id)
              const uses = all.links.filter(l => l.from === p.id).map(l => l.to.slice(2))
              return (
                <li key={p.id}>
                  <button type="button" aria-pressed={p.id === picked} onClick={() => onPick(p.id)}>
                    <span><b>{h?.hot && <i className="fm-hot-key" aria-hidden />}{partName(p)}</b>
                      <small>{[plural(p.files.length, 'file'), h?.n ? plural(h.n, 'change') : '', h?.last ? ago(h.last) : '', p.notes.length ? plural(p.notes.length, 'note') : ''].filter(Boolean).join(', ')}{uses.length ? `, uses ${uses.join(', ')}` : ''}</small></span>
                  </button>
                </li>
              )
            })}</ul>
          </section>
        )
      })}
    </div>
  )
}
