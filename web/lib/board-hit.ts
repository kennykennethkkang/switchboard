type Box = { x: number; y: number; w: number; h: number; id: string }

/** The box under q; later boxes are drawn on top. With min (touch), a miss falls back to the nearest box whose min-sized area holds q. */
export function pickHit(hits: Box[], q: { x: number; y: number }, min = 0): string | undefined {
  for (let i = hits.length - 1; i >= 0; i--) { const b = hits[i]; if (q.x >= b.x && q.x <= b.x + b.w && q.y >= b.y && q.y <= b.y + b.h) return b.id }
  if (!min) return undefined
  let best: string | undefined, bd = Infinity
  for (const b of hits) {
    const px = Math.max(0, (min - b.w) / 2), py = Math.max(0, (min - b.h) / 2)
    if (q.x < b.x - px || q.x > b.x + b.w + px || q.y < b.y - py || q.y > b.y + b.h + py) continue
    const d = Math.hypot(q.x - (b.x + b.w / 2), q.y - (b.y + b.h / 2))
    if (d < bd) { bd = d; best = b.id }
  }
  return best
}
