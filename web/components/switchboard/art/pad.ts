// Frozen-figure pad and a pixel-capped canvas cache, shared by the art kits.
import type { FigureBox } from './types'

/** Margin in art px around a figure box: the pad a frozen figure is drawn in. */
export const figurePad = (b: FigureBox) => ({ x: b.half + 6, up: b.top + 8, down: b.bottom + 4 })

export type Sized = { width: number; height: number }
/** Cache of canvases by key. Past cap pixels it clears whole, so the held pixels never pass cap. */
export function makeCache<V extends Sized>(cap: number) {
  const m = new Map<string, V>()
  let px = 0
  return {
    get: (k: string) => m.get(k),
    put(k: string, v: V) {
      const n = v.width * v.height
      if (px + n > cap) { m.clear(); px = 0 }
      m.set(k, v); px += n
    },
    get px() { return px },
    get size() { return m.size },
  }
}
