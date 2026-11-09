'use client'
import { useEffect, useRef, useState } from 'react'
import { chipText, type LinkChip } from '@/lib/wait-links'

const key = (c: LinkChip) => `${c.dir}:${c.id}`
// Corner tags: out pills top right, in pills top left, one row each. Units are % of the stage.
const rowY = (i: number) => 6 + i * 10
const path = (c: LinkChip, i: number) => {
  // Ends under the pill's middle and arrives level with it.
  const y = rowY(i), out = c.dir === 'out', x = out ? 84 : 16, sx = out ? 56 : 44, cx = sx + (x - sx) * 0.35
  // in arcs run from the waiter's pill to the lead, so the dashes flow the way the wait points.
  return out ? `M${sx} 47 Q ${cx} ${y} ${x} ${y}` : `M${x} ${y} Q ${cx} ${y} ${sx} 47`
}

/** Thin arcs from the picked chat's lead to the chats it waits on (right) and that wait on it (left). An ended link flashes green and fades. */
export function WaitArcs({ chatId, chips }: { chatId: string; chips: LinkChip[] }) {
  const [ended, setEnded] = useState<LinkChip[]>([])
  const prev = useRef({ chatId, chips })
  const sig = chips.map(key).join()
  useEffect(() => {
    const was = prev.current
    prev.current = { chatId, chips }
    if (was.chatId !== chatId) { setEnded([]); return }
    const gone = was.chips.filter(p => !chips.some(c => key(c) === key(p)))
    if (!gone.length) return
    setEnded(e => [...e, ...gone])
    setTimeout(() => setEnded(e => e.filter(x => !gone.includes(x))), 1100)
  }, [chatId, sig]) // eslint-disable-line react-hooks/exhaustive-deps
  const all = [...chips.map(c => ({ c, end: false })), ...ended.map(c => ({ c, end: true }))]
  if (!all.length) return null
  const rows = { out: 0, in: 0 }
  const placed = all.map(a => ({ ...a, i: rows[a.c.dir]++ }))
  return (
    <div className="ov-wait" aria-hidden>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        {placed.map(({ c, end, i }) => <path key={key(c) + end} d={path(c, i)} data-end={end || undefined} vectorEffect="non-scaling-stroke" />)}
      </svg>
      {placed.map(({ c, end, i }) => <span key={key(c) + end} className="hub-chip hub-wait" data-dir={c.dir} data-end={end || undefined} style={{ top: `${rowY(i)}%` }}><i /><span>{end ? `${c.name} done` : chipText(c)}</span></span>)}
    </div>
  )
}
