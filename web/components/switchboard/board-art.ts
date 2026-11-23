// Board art primitives: canvas helpers the art kits in ./art share. Gradients and arcs are baked once into a small canvas and reused.
import type { CourtColors as C } from '@/lib/skins'

export type G = CanvasRenderingContext2D
export const rect = (g: G, x: number, y: number, w: number, h: number, col: string) => { g.fillStyle = col; g.fillRect(x | 0, y | 0, w | 0, h | 0) }
const baked = new Map<string, HTMLCanvasElement>()
// Pixel budget too: kits bake screen-size layers keyed by size, so a resize drag would otherwise pile up big canvases.
let bakedPx = 0
export function bakeOnce(key: string, w: number, h: number, paint: (g: G) => void) {
  let cv = baked.get(key)
  if (!cv) {
    cv = document.createElement('canvas'); cv.width = Math.max(1, Math.ceil(w)); cv.height = Math.max(1, Math.ceil(h))
    paint(cv.getContext('2d')!)
    if (baked.size > 300 || bakedPx > 6e6) { baked.clear(); bakedPx = 0 }
    baked.set(key, cv); bakedPx += cv.width * cv.height
  }
  return cv
}

/** Soft round glow, radius r, baked once per color; stands in for shadowBlur. */
export const glow = (col: string, r: number) => bakeOnce(`glow${col}${r}`, r * 2, r * 2, g => {
  const gr = g.createRadialGradient(r, r, 0, r, r, r)
  gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = gr; g.fillRect(0, 0, r * 2, r * 2)
})
export function glowAt(g: G, col: string, x: number, y: number, r: number, a: number) {
  if (a <= 0) return
  const o = g.globalAlpha; g.globalAlpha = o * Math.min(1, a); g.drawImage(glow(col, r), x - r, y - r); g.globalAlpha = o
}

// Cloud of four puffs with a shade under it, baked per size and color. Origin is the first puff's center.
export const puffs = [[0, 0, 1], [0.9, -0.35, 0.8], [1.7, 0, 0.9], [0.8, 0.3, 0.9]]
export function puff(g: G, x: number, y: number, s: number, col: string, sh: string, a = 1) {
  s = Math.max(2, Math.round(s))
  const cv = bakeOnce(`puff${s}${col}${sh}`, s * 3.2, s * 2.6 + 2, p => {
    for (const [fill, dy] of [[sh, 2], [col, 0]] as const) { p.fillStyle = fill; for (const [dx, py, r] of puffs) { p.beginPath(); p.arc(s + dx * s, s * 1.2 + py * s + dy, r * s, 0, 7); p.fill() } }
  })
  const o = g.globalAlpha; g.globalAlpha = o * a; g.drawImage(cv, Math.round(x - s), Math.round(y - s * 1.2)); g.globalAlpha = o
}
/** Unbaked cloud for the sky and islands: four puffs, a shade under each. */
export function cloud(g: G, x: number, y: number, s: number, col: string, sh: string) {
  for (const [fill, dy] of [[sh, 2], [col, 0]] as const) {
    g.fillStyle = fill
    for (const [dx, py, r] of puffs) { g.beginPath(); g.arc(x + dx * s, y + py * s + dy, r * s, 0, 7); g.fill() }
  }
}
export function ell(g: G, x: number, y: number, rx: number, ry: number, col: string, a = 1) { g.globalAlpha = a; g.fillStyle = col; g.beginPath(); g.ellipse(x, y, Math.max(0, rx), Math.max(0, ry), 0, 0, 7); g.fill(); g.globalAlpha = 1 }

/** A hanging lantern: a red paper body with a gold lit wick. */
export function lantern(g: G, x: number, y: number, t: number, c: C) {
  x = Math.round(x); y = Math.round(y)
  const a = g.globalAlpha, lit = t ? 0.18 + 0.06 * Math.sin(t * 7) : 0.2
  rect(g, x, y - 3, 1, 3, c.ink)
  g.globalAlpha = a * lit; g.fillStyle = c.gold_lt; g.beginPath(); g.arc(x + 0.5, y + 4.5, 7, 0, 7); g.fill(); g.globalAlpha = a
  rect(g, x - 3, y, 7, 9, c.ink); rect(g, x - 2, y + 1, 5, 7, c.red); rect(g, x - 2, y + 1, 5, 1, c.gold); rect(g, x - 2, y + 7, 5, 1, c.gold)
  rect(g, x - 1, y + 3, 3, 3, c.red_lt); rect(g, x, y + 3, 1, 3, t && Math.sin(t * 11) > 0.6 ? c.cloud : c.gold_lt)
}

/** Tiles a baked strip across w px, offset by off (wrapping). */
export const tile = (g: G, cv: HTMLCanvasElement, off: number, y: number, w: number) => { const o = ((off % cv.width) + cv.width) % cv.width; for (let x = -o; x < w; x += cv.width) g.drawImage(cv, Math.round(x), Math.round(y)) }

/** A 240 px wide ridge strip: layers of [color, alpha, top, frequency]; jag adds a sawtooth edge. extra paints on top. */
export function ridgeBand(key: string, layers: Array<[string, number, number, number]>, jag: boolean, extra?: (g: G) => void) {
  return bakeOnce(key, 240, 64, g => {
    for (const [col, a, top, f] of layers) {
      g.globalAlpha = a; g.fillStyle = col
      for (let x = 0; x < 240; x++) {
        const yy = Math.round(top + 10 * Math.sin((x / 240) * Math.PI * 2 * f) + 6 * Math.sin((x / 240) * Math.PI * 6 + f) + (jag ? 4 * Math.abs(Math.sin(x * 0.11 * f)) : 0))
        g.fillRect(x, yy, 1, 64 - yy)
      }
    }
    extra?.(g)
    g.globalAlpha = 1
  })
}

/** Done: a four-point star that twinkles now and then over the sprite. */
export function sparkle(g: G, x: number, y: number, t: number, i: number, c: C) {
  const ph = t ? (t * 0.45 + i * 0.37) % 1 : 0.1
  if (ph > 0.22) return
  const s = ph < 0.11 ? 1 : 2
  rect(g, x - s, y, 2 * s + 1, 1, c.jade_lt); rect(g, x, y - s, 1, 2 * s + 1, c.jade_lt); rect(g, x, y, 1, 1, c.cloud)
}
