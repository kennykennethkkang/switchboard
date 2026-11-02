'use client'
import { useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { fmtSize, type Upload } from '@/lib/attach'

export type Attached = { key: number; name: string; size: number; progress: number; path?: string; problem?: string }

/** Files for one message box: each uploads as soon as it is picked, dropped or pasted. Removing one only drops it from the message. */
export function useAttach(upload: Upload, cwd: string, session?: string) {
  const [items, setItems] = useState<Attached[]>([])
  const [over, setOver] = useState(false)
  const next = useRef(0)
  // Removing a chip mid-upload stops it and drops the partial file.
  const stops = useRef(new Map<number, AbortController>())
  const patch = (key: number, p: Partial<Attached>) => setItems(xs => xs.map(x => (x.key === key ? { ...x, ...p } : x)))
  const add = (files: Iterable<File>) => {
    for (const f of files) {
      const key = next.current++
      setItems(xs => [...xs, { key, name: f.name, size: f.size, progress: 0 }])
      const stop = new AbortController()
      stops.current.set(key, stop)
      void upload(f, cwd, session, progress => patch(key, { progress }), stop.signal).then(r => patch(key, r), err => patch(key, { problem: (err as Error).message })).finally(() => stops.current.delete(key))
    }
  }
  const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files')
  return {
    items, over, add,
    remove: (key: number) => { stops.current.get(key)?.abort(); setItems(xs => xs.filter(x => x.key !== key)) },
    clear: () => setItems([]),
    restore: (xs: Attached[]) => setItems(xs),
    busy: items.some(x => !x.path && !x.problem),
    paths: items.flatMap(x => (x.path ? [x.path] : [])),
    drop: {
      onDragOver: (e: DragEvent) => { if (hasFiles(e)) { e.preventDefault(); setOver(true) } },
      onDragLeave: (e: DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false) },
      onDrop: (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); setOver(false); add(e.dataTransfer.files) },
    },
    // A pasted screenshot comes as a file with no text; plain text pastes as usual.
    onPaste: (e: ClipboardEvent) => { const fs = [...e.clipboardData.files]; if (fs.length) { e.preventDefault(); add(fs) } },
  }
}

export const dropStyle = (over: boolean) => ({ outline: over ? '2px dashed var(--hub-blue)' : '2px dashed transparent', outlineOffset: 4, borderRadius: 8, transition: 'outline-color 120ms ease' })

const CLIP = 'M10.5 4.5 5.8 9.2a1.5 1.5 0 0 0 2.1 2.1l5-5a3 3 0 0 0-4.2-4.2l-5 5a4.5 4.5 0 0 0 6.4 6.4L14 9.6'

export function AttachButton({ onFiles }: { onFiles: (files: FileList) => void }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <input ref={input} type="file" multiple hidden tabIndex={-1} onChange={e => { if (e.target.files?.length) onFiles(e.target.files); e.target.value = '' }} />
      <button type="button" className="hub-btn" aria-label="Attach files" title="Attach files (or drop or paste them here)" onClick={() => input.current?.click()} style={{ padding: '0 9px' }}>
        <svg aria-hidden width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={CLIP} /></svg>
      </button>
    </>
  )
}

export function AttachChips({ items, onRemove }: { items: Attached[]; onRemove: (key: number) => void }) {
  if (!items.length) return null
  return (
    <ul aria-label="Attached files" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {items.map(x => {
        const busy = !x.path && !x.problem
        return (
          <li key={x.key} className="hub-chip-file" title={x.problem ?? x.path ?? x.name} style={{ borderColor: x.problem ? 'var(--hub-red)' : undefined }}>
            {busy && <span className="hub-spin" aria-hidden />}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--hub-ink)' }}>{x.name}</span>
            <span role="status" style={{ flexShrink: 0, color: x.problem ? 'var(--hub-red)' : 'var(--hub-ash)', fontVariantNumeric: 'tabular-nums' }}>
              {x.problem ? `failed: ${x.problem}` : busy && x.progress > 0 && x.progress < 1 ? `${Math.round(x.progress * 100)}%` : fmtSize(x.size)}
            </span>
            <button type="button" aria-label={`Remove ${x.name}`} onClick={() => onRemove(x.key)}>×</button>
            {busy && <i aria-hidden style={{ transform: `scaleX(${x.progress})` }} />}
          </li>
        )
      })}
    </ul>
  )
}
