// Lantern Sea: smooth illustrated night islands, additive lamp light, bone-rigged keepers. Dusk is its day mode.
import type { CourtColors as C } from '@/lib/skins'
import { lantern as skin } from '../../../lib/skins/lantern'
import { bakeOnce, glow, glowAt, tile, type G } from '../board-art'
import type { ArtKit, FigureBox, Realm } from './types'
import type { CourtNode } from '@/lib/court-map'
import type { Cast } from '@/lib/court-cast'
import { makeCache } from './pad'
import { cast } from '../../../lib/court-cast'
import type { Keeper } from './keeper-style'
import { inkStyle as st } from './lantern-ink'

const NIGHT_INK = skin.night!.court.colors.ink
const dark = (c: C) => c.ink === NIGHT_INK
const PI = Math.PI, TAU = PI * 2
const hash = (a: number, b: number) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s) }
const sat = (v: number) => Math.max(0, Math.min(1, v))

// Mix two hex colors, and an rgba string for gradient stops.
const rgb = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const mix = (a: string, b: string, k: number) => {
  const x = rgb(a), y = rgb(b)
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * k).toString(16).padStart(2, '0')).join('')
}
const rgba = (h: string, a: number) => { const [r, g, b] = rgb(h); return `rgba(${r},${g},${b},${a})` }

const REALM_LANTERN: Record<string, Realm> = {
  codex: { top: '#1d4a66', rim: '#5ab0e0', dk: '#0c2038', hi: '#7fe0ff', glow: '#c8f4ff' },
  jev: { top: '#2f3f6a', rim: '#7a78d0', dk: '#141a3c', hi: '#b6f26e', glow: '#e6ffc4' },
  perplexity: { top: '#0f4a58', rim: '#38b0b0', dk: '#082630', hi: '#7ff0e6', glow: '#d8fffa' },
  gemini: { top: '#2a3478', rim: '#6a82e0', dk: '#101644', hi: '#a9c1ff', glow: '#fff3c4' },
  claude: { top: '#4a2c4a', rim: '#d0807a', dk: '#2a1230', hi: '#ff9f7a', glow: '#ffd9c4' },
}

// Run fn with additive compositing.
function add(g: G, fn: () => void) { const o = g.globalCompositeOperation; g.globalCompositeOperation = 'lighter'; fn(); g.globalCompositeOperation = o }
// The baked glow stretched over an ellipse.
function pool(g: G, col: string, x: number, y: number, rx: number, ry: number, a: number) {
  if (a <= 0) return
  const o = g.globalAlpha; g.globalAlpha = o * Math.min(1, a); g.drawImage(glow(col, 48), x - rx, y - ry, rx * 2, ry * 2); g.globalAlpha = o
}
const lin = (g: G, x0: number, y0: number, x1: number, y1: number, stops: Array<[number, string]>) => {
  const gr = g.createLinearGradient(x0, y0, x1, y1); for (const [o, c] of stops) gr.addColorStop(o, c); return gr
}
const rad = (g: G, x: number, y: number, r0: number, r1: number, stops: Array<[number, string]>, x1 = x, y1 = y) => {
  const gr = g.createRadialGradient(x, y, r0, x1, y1, r1); for (const [o, c] of stops) gr.addColorStop(o, c); return gr
}
const star4 = (g: G, x: number, y: number, r: number) => {
  g.beginPath()
  for (let i = 0; i < 8; i++) { const a = (i * PI) / 4 - PI / 2, rr = i % 2 ? r * 0.28 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) }
  g.closePath()
}

// Island: a lit floating rock, soft painted top, rim light on the upper left, lamp dots along the front edge.
function isle(g: G, x: number, y: number, rx: number, ry: number, depth: number, top: string, rim: string, plaza: boolean, c: C, halo?: string) {
  const night = dark(c), seed = Math.round(x * 3 + y * 7), H = depth + ry * 0.9 + rx * 0.3
  add(g, () => pool(g, halo ?? rim, x, y + H * 0.45, rx * 1.55, H * 1.1 + ry, night ? 0.2 : 0.1))
  g.beginPath(); g.moveTo(x - rx, y)
  g.bezierCurveTo(x - rx, y + H * 0.5, x - rx * 0.5, y + H * 0.78, x - rx * 0.22, y + H * 0.92)
  g.lineTo(x - rx * 0.08, y + H * 0.8); g.lineTo(x + rx * 0.05, y + H)
  g.lineTo(x + rx * 0.2, y + H * 0.78); g.lineTo(x + rx * 0.32, y + H * 0.86)
  g.bezierCurveTo(x + rx * 0.62, y + H * 0.66, x + rx, y + H * 0.4, x + rx, y)
  g.ellipse(x, y, rx, ry, 0, 0, PI, false); g.closePath()
  g.fillStyle = lin(g, 0, y, 0, y + H, [[0, mix(rim, c.ink, 0.45)], [0.45, mix(rim, c.ink, 0.72)], [1, c.ink]]); g.fill()
  g.save(); g.clip()
  g.fillStyle = lin(g, x - rx, 0, x + rx * 0.3, 0, [[0, rgba(mix(rim, '#ffffff', 0.25), night ? 0.4 : 0.5)], [1, 'rgba(0,0,0,0)']]); g.fillRect(x - rx, y, rx * 2, H)
  g.strokeStyle = rgba(c.ink, 0.35); g.lineWidth = 1
  for (let i = 0; i < 5; i++) { const px = x + (hash(seed, i) - 0.5) * rx * 1.5; g.beginPath(); g.moveTo(px, y + ry * 0.8); g.quadraticCurveTo(px + (hash(i, seed) - 0.5) * 12, y + H * 0.5, px + (hash(i, 9) - 0.5) * 18, y + H * (0.55 + hash(seed, i + 3) * 0.3)); g.stroke() }
  g.restore()
  g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU)
  const lit = night ? mix(top, rim, 0.28) : top
  g.fillStyle = rad(g, x - rx * 0.3, y - ry * 0.45, rx * 0.05, rx * 1.05, [[0, mix(lit, '#ffffff', night ? 0.3 : 0.3)], [0.55, lit], [1, mix(lit, c.ink, 0.55)]], x, y); g.fill()
  g.save(); g.clip()
  for (let i = 0; i < 9; i++) {
    const px = x + (hash(seed, i + 5) - 0.5) * rx * 1.5, py = y + (hash(i + 5, seed) - 0.5) * ry * 1.4, r = rx * (0.14 + hash(i, seed + 2) * 0.2)
    g.fillStyle = rad(g, px, py, 0, r, [[0, rgba(mix(top, rim, 0.5), 0.38)], [1, 'rgba(0,0,0,0)']]); g.fillRect(px - r, py - r, r * 2, r * 2)
  }
  if (plaza) {
    const px = rx * 0.8, py = ry * 0.74
    g.beginPath(); g.ellipse(x, y + 1, px, py, 0, 0, TAU)
    g.fillStyle = rad(g, x - px * 0.3, y - py * 0.4, 1, px * 1.1, [[0, mix(c.stone, '#ffffff', 0.25)], [1, mix(c.stone, c.ink, 0.5)]], x, y); g.fill()
    g.strokeStyle = rgba(c.roof_lt, 0.22); g.lineWidth = 1
    for (const k of [0.92, 0.62]) { g.beginPath(); g.ellipse(x, y + 1, px * k, py * k, 0, 0, TAU); g.stroke() }
  }
  g.restore()
  if (night) { g.lineWidth = 2.4; g.strokeStyle = rgba(rim, 0.55); g.beginPath(); g.ellipse(x, y, rx - 0.5, ry - 0.5, 0, PI * 0.02, PI * 0.98); g.stroke() }
  g.lineWidth = 1.6; g.strokeStyle = rgba(mix(rim, '#ffffff', 0.55), night ? 0.85 : 0.95)
  g.beginPath(); g.ellipse(x, y, rx - 0.6, ry - 0.6, 0, PI * 1.02, PI * 1.62); g.stroke()
  g.strokeStyle = rgba(rim, 0.3); g.lineWidth = 4; g.beginPath(); g.ellipse(x, y, rx - 1, ry - 1, 0, PI * 1.05, PI * 1.55); g.stroke()
  g.strokeStyle = rgba(c.ink, 0.4); g.lineWidth = 1; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0.1, PI - 0.1); g.stroke()
  const m = Math.max(5, Math.round(rx / 9)), at = (i: number) => { const a = PI * (0.1 + (0.8 * i) / (m - 1)); return [x + Math.cos(a) * (rx - 3), y + Math.sin(a) * (ry - 1.5)] }
  add(g, () => { for (let i = 0; i < m; i++) { const [px, py] = at(i); glowAt(g, i % 2 ? c.gold_lt : c.rail, px, py, 6, night ? 0.7 : 0.4) } })
  for (let i = 0; i < m; i++) { const [px, py] = at(i); g.fillStyle = i % 2 ? c.gold_lt : c.rail; g.beginPath(); g.arc(px, py, 1.1, 0, TAU); g.fill() }
}

// Hall: a lantern pavilion drawn in pixel-kit units and scaled, base centered on (x + w/2, y + 27).
const HS = 1.55
function pavilion(g: G, x: number, y: number, w: number, roof: [string, string, string], walls: string, tiers: number, beam: string, c: C) {
  const night = dark(c), hw = w / 2
  g.save(); g.translate(x + hw, y + 27); g.scale(HS, HS)
  add(g, () => pool(g, beam, 0, -8, hw * 1.3, 14, night ? 0.35 : 0.2))
  g.fillStyle = rgba(c.ink, 0.35); g.beginPath(); g.ellipse(0, 1, hw + 4, 4, 0, 0, TAU); g.fill()
  g.beginPath(); g.roundRect(-hw, -20, w, 20, 2)
  g.fillStyle = lin(g, 0, -20, 0, 0, [[0, mix(walls, '#ffffff', 0.18)], [1, mix(walls, c.ink, 0.45)]]); g.fill()
  g.fillStyle = beam; g.globalAlpha = 0.85; g.fillRect(-hw, -19, w, 1.6); g.globalAlpha = 1
  g.strokeStyle = rgba(mix(walls, '#ffffff', 0.6), 0.5); g.lineWidth = 0.8; g.beginPath(); g.moveTo(-hw + 0.5, -19); g.lineTo(-hw + 0.5, -1); g.stroke()
  for (let i = 6; i < w - 5; i += 9) {
    if (Math.abs(i - hw) < 8) continue
    const wx = -hw + i
    add(g, () => glowAt(g, c.gold_lt, wx, -10, 7, night ? 0.75 : 0.35))
    g.fillStyle = rad(g, wx, -10, 0.5, 3.5, [[0, '#fff6c8'], [1, c.gold]]); g.beginPath(); g.roundRect(wx - 2, -13, 4, 6, 1.5); g.fill()
  }
  add(g, () => glowAt(g, c.gold_lt, 0, -6, 9, night ? 0.8 : 0.4))
  g.fillStyle = lin(g, 0, -13, 0, 0, [[0, c.gold_lt], [1, c.gold_dk]]); g.beginPath(); g.moveTo(-4, 0); g.lineTo(-4, -8); g.arc(0, -8, 4, PI, 0); g.lineTo(4, 0); g.fill()
  let top = -20
  for (let t = 0; t <= tiers; t++) {
    const rw = hw * (1.18 - t * 0.28) + 3, ry = top - 2, hgt = 9 - t
    g.beginPath(); g.moveTo(-rw - 2, ry + 1); g.quadraticCurveTo(-rw * 0.5, ry + 1, 0, ry - hgt); g.quadraticCurveTo(rw * 0.5, ry + 1, rw + 2, ry + 1)
    g.quadraticCurveTo(0, ry + 3, -rw - 2, ry + 1); g.closePath()
    g.fillStyle = lin(g, -rw, ry - hgt, rw, ry + 2, [[0, roof[2]], [0.5, roof[0]], [1, roof[1]]]); g.fill()
    g.strokeStyle = rgba(roof[2], 0.7); g.lineWidth = 0.8; g.beginPath(); g.moveTo(-rw - 2, ry + 1); g.quadraticCurveTo(-rw * 0.5, ry + 1, 0, ry - hgt); g.stroke()
    top = ry - hgt + 3
  }
  g.strokeStyle = c.roof_lt; g.lineWidth = 1; g.beginPath(); g.moveTo(0, top - 3); g.lineTo(0, top - 11); g.stroke()
  add(g, () => glowAt(g, c.red_lt, 0, top - 12, 9, 0.85))
  g.fillStyle = c.red_lt; g.beginPath(); g.arc(0, top - 12, 2.2, 0, TAU); g.fill()
  g.restore()
}

// Figure: the ink-style cast from lantern-ink.ts, baked per (role, ai, state, leg, frame) at 3x; light effects draw live on top.
const FS = 2, FW = 76, FH = 94, FOOT = 8, NF = 12
// Figure canvases are FW*FS by FH*FS each; capped by pixels, about 280 frames, so 20+ animating figures stay baked.
const figs = makeCache<HTMLCanvasElement>(8e6)
// Lantern Sea's own cast: lamp folk of the night harbor.
const LANTERN_CAST: Record<string, Cast> = {
  lead: { name: 'Harbor Master', tag: 'tall hat, long coat, brass lantern pole' },
  engineer: { name: 'Lamp Smith', tag: 'goggles, leather apron, tongs, sparks' },
  qa: { name: 'Night Watch', tag: 'hood, spyglass, sweeping signal lamp' },
  designer: { name: 'Lantern Painter', tag: 'brush that paints glowing strokes, paper lanterns' },
  researcher: { name: 'Stargazer', tag: 'star-map robe, astrolabe, drifting star motes' },
  ops: { name: 'Ferryman', tag: 'straw cloak, punt pole, bow lamp' },
  growth: { name: 'Koi Spirit', tag: 'koi head, fin sleeves, leaps' },
  pilgrim: { name: 'Firefly Child', tag: 'jar of fireflies, paper boat' },
}
const AI_COL: Record<string, string> = { claude: '#ff9f7a', codex: '#7fe0ff', jev: '#b6f26e', perplexity: '#7ff0e6', gemini: '#a9c1ff' }
// Anime keepers stand about 58 px; badges and the bubble sit above the hair.
const FIG_BOX: FigureBox = { top: 64, bottom: 4, half: 14, tall: 40 }
function lampLight(state: string | undefined, t: number, i: number, c: C) {
  let col = '#ff9a4a', a = 0.16
  if (state === 'working') { col = c.gold; a = 0.6 + 0.3 * Math.sin(t * 6 + i) }
  else if (state === 'waiting') { col = c.cloud_sh; a = 0.45 + 0.1 * Math.sin(t * 1.5 + i) }
  else if (state === 'stuck') { col = c.red; a = 0.45 + 0.4 * Math.sin(t * 17 + i) * Math.sin(t * 7) }
  else if (state === 'needs') { col = c.red_lt; a = 0.7 + 0.3 * Math.sin(t * 4) }
  else if (state === 'done') { col = c.jade_lt; a = 0.55 + 0.45 * Math.max(0, Math.sin(t * 2.4 + i)) ** 3 }
  return [col, sat(a)] as const
}

// Pixel pieces are drawn in their own units; the smooth ones take the same anchors and draw at S.
const S = 2
const SHRINE: Record<string, keyof C> = { claude: 'red_lt', codex: 'blue_lt', gemini: 'sky', jev: 'jade_lt', perplexity: 'sky' }
const panel = (g: G, x: number, y: number, w: number, h: number, r: number, col: string) => { g.fillStyle = col; g.beginPath(); g.roundRect(x, y, w, h, r); g.fill() }
// The desk's top left is (x, y); 24 by 9 in pixel units.
function deskArt(g: G, x: number, y: number, lit: boolean, R: Realm | undefined, c: C) {
  const wood = R ? R.rim : c.brown, dk = R ? R.dk : c.brown_dk, lamp = R ? R.glow : c.gold_lt
  g.save(); g.translate(x - 12, y); g.scale(S, S)
  if (lit) add(g, () => glowAt(g, R ? R.hi : c.gold_lt, 12, 5, 17, 0.32))
  g.fillStyle = rgba(c.ink, 0.4); g.beginPath(); g.ellipse(12, 9.5, 12, 2.2, 0, 0, TAU); g.fill()
  panel(g, 0.5, 0.5, 23, 8.5, 2.5, c.ink)
  g.fillStyle = lin(g, 0, 0, 0, 9, [[0, mix(wood, '#ffffff', 0.2)], [0.5, wood], [1, dk]]); g.beginPath(); g.roundRect(1, 1, 22, 7.5, 2); g.fill()
  panel(g, 4, 2.5, 10, 4, 1, c.cloud); g.fillStyle = c.gold_dk; g.fillRect(4, 2.5, 0.6, 4); g.fillRect(13.4, 2.5, 0.6, 4)
  g.fillStyle = c.ink2; g.beginPath(); g.ellipse(16.5, 5.5, 1.6, 1.3, 0, 0, TAU); g.fill()
  panel(g, 19.5, 1.5, 2.6, 4.5, 1, lit ? lamp : c.gold_dk)
  if (lit) add(g, () => glowAt(g, lamp, 20.8, 2.5, 5, 0.9))
  g.restore()
}
// A realm's landmark: a plinth, a glowing shaft and a crown that tells the AI apart. Base at (bx, by).
function landmarkArt(g: G, ai: string | undefined, bx: number, by: number, R: Realm, c: C) {
  g.save(); g.translate(bx, by); g.scale(S, S)
  g.fillStyle = rgba(c.ink, 0.5); g.beginPath(); g.ellipse(0, 0.5, 8, 2.4, 0, 0, TAU); g.fill()
  panel(g, -6, -3, 12, 3.5, 1, R.rim)
  g.fillStyle = lin(g, -3, 0, 3, 0, [[0, R.rim], [0.5, R.dk], [1, c.ink]]); g.beginPath(); g.moveTo(-2.8, -3); g.lineTo(-1.5, -22); g.lineTo(1.5, -22); g.lineTo(2.8, -3); g.fill()
  g.fillStyle = R.hi; g.fillRect(-1.6, -21, 0.6, 17)
  add(g, () => glowAt(g, R.glow, 0, -23.5, 9, 0.85))
  g.fillStyle = R.glow
  if (ai === 'claude') { star4(g, 0, -26, 5); g.fill() }
  else if (ai === 'jev') { panel(g, -7, -25, 14, 1.4, 0.7, c.gold_lt); g.beginPath(); g.arc(-5.5, -22.5, 1.6, 0, TAU); g.arc(5.5, -22.5, 1.6, 0, TAU); g.fill() }
  else if (ai === 'perplexity') { g.globalAlpha = 0.35; g.beginPath(); g.moveTo(0, -26); g.lineTo(-30, -40); g.lineTo(-30, -30); g.fill(); g.beginPath(); g.moveTo(0, -26); g.lineTo(30, -40); g.lineTo(30, -30); g.fill(); g.globalAlpha = 1; panel(g, -2.4, -28, 4.8, 4, 1.2, R.glow) }
  else if (ai === 'gemini') { panel(g, -5.5, -29, 2.6, 8, 1, R.hi); panel(g, 2.9, -26, 2.6, 6, 1, R.hi); g.beginPath(); g.arc(0, -30, 1.6, 0, TAU); g.fill() }
  else { panel(g, -2.2, -28, 4.4, 6, 1, R.hi) }
  g.restore()
}
// A realm's gate: two arched posts, a lintel in the realm's light and the yard's shrine box on top.
function gateArt(g: G, gx: number, gy: number, R: Realm, yardAi: string | undefined, c: C) {
  g.save(); g.translate(gx, gy); g.scale(S, S)
  for (const px of [-11, 8]) { g.fillStyle = lin(g, px, 0, px + 4.5, 0, [[0, R.hi], [1, R.dk]]); g.beginPath(); g.roundRect(px, -18, 4.5, 20, 2); g.fill() }
  g.fillStyle = lin(g, 0, -23, 0, -17, [[0, R.hi], [1, R.dk]]); g.beginPath(); g.roundRect(-15, -23, 30, 6, 2.5); g.fill()
  const col = c[SHRINE[yardAi ?? ''] ?? 'red_lt']
  add(g, () => glowAt(g, col, 0, -26, 8, 0.7))
  panel(g, -5, -31, 10, 9, 2.5, c.ink); panel(g, -4, -30, 8, 7, 2, col)
  g.restore()
}
// Ring places: the islet keeps its shape; the building on it is smooth, in pixel units at S.
function placeArtSmooth(g: G, n: CourtNode, island: (n: CourtNode, top: string, rim: string, plaza: boolean) => void, c: C, x: number, y: number) {
  const jade = n.kind === 'garden' || n.kind === 'notice' || n.kind === 'study' || n.kind === 'maps'
  const flame = (lx: number, ly: number) => add(g, () => glowAt(g, c.gold_lt, lx, ly, 7, dark(c) ? 0.9 : 0.5))
  if (n.kind === 'uploads' && !n.list?.length) return
  island(n, jade ? c.jade : c.stone_dk, jade ? c.jade_lt : c.stone, false)
  g.save(); g.translate(x, y); g.scale(S, S)
  if (n.kind === 'garden') {
    // Tea bushes and a stone lantern; the resting roles stand to the right.
    g.fillStyle = rgba(c.ink, 0.35); g.beginPath(); g.ellipse(-18, 3, 13, 2.5, 0, 0, TAU); g.fill()
    for (const [dx, dy, r] of [[-24, -2, 5], [-12, -2, 5], [-18, -6, 8]]) { g.fillStyle = rad(g, dx - r * 0.3, dy - r * 0.4, 0.5, r, [[0, c.peach], [1, c.peach_dk]]); g.beginPath(); g.arc(dx, dy, r, 0, TAU); g.fill() }
    panel(g, -20, -2, 2, 6, 1, c.brown_dk)
    for (const [dx, dy] of [[-21, -9], [-15, -7], [-25, -3], [-11, -4]]) { g.fillStyle = c.peach_lt; g.beginPath(); g.arc(dx, dy, 1, 0, TAU); g.fill() }
    panel(g, -2, -4, 4, 9, 1, c.stone_dk); panel(g, -4, -10, 8, 6, 2, c.stone); panel(g, -5, -12, 10, 2.5, 1, c.stone_dk); flame(0, -7)
  }
  else if (n.kind === 'armory') {
    // Tool rack: two shelves of tools in bright handles, a lamp on top.
    panel(g, -22, -14, 44, 18, 2.5, c.wood)
    g.fillStyle = lin(g, 0, -14, 0, 4, [[0, rgba('#ffffff', 0.12)], [1, rgba(c.ink, 0.18)]]); g.beginPath(); g.roundRect(-22, -14, 44, 18, 2.5); g.fill()
    const books = [c.cloud, c.gold, c.jade, c.red_lt, c.blue_lt, c.gold_lt, c.peach, c.cloud_sh]
    for (let s = 0; s < 2; s++) { panel(g, -21, -6 + s * 8, 42, 1.2, 0.6, c.wood_dk); for (let i = 0; i < 8; i++) panel(g, -19 + i * 5, -12 + s * 8, 3, 6, 1, books[(i + s * 3) % 8]) }
    panel(g, -2, -19, 4, 5, 1.5, c.ink2); flame(0, -17)
  }
  else if (n.kind === 'library') { panel(g, -26, -22, 52, 8, 2, c.red); panel(g, -22, -14, 44, 20, 2, c.cloud_sh); for (let i = 0; i < 6; i++) panel(g, -19 + i * 7, -11, 5, 5, 1.5, i % 2 ? c.gold_lt : c.cloud); panel(g, -3, 1, 6, 5, 2, c.wood_dk) }
  else if (n.kind === 'notice') { panel(g, -20, -18, 3, 26, 1, c.wood_dk); panel(g, 17, -18, 3, 26, 1, c.wood_dk); panel(g, -22, -20, 44, 18, 3, c.wood); for (const [dx, dy, col] of [[-18, -17, c.cloud], [-8, -16, c.gold_lt], [3, -17, c.cloud], [12, -15, c.peach]] as const) panel(g, dx, dy, 7, 9, 1, col) }
  else if (n.kind === 'tower') { panel(g, -7, -30, 14, 36, 3, c.cloud_sh); panel(g, -7, -30, 14, 4, 2, c.red); panel(g, -3, -40, 6, 8, 2, c.ink2); flame(0, -36) }
  else if (n.kind === 'study') { panel(g, -18, -6, 36, 8, 2, c.wood); panel(g, -15, 2, 3, 6, 1, c.wood_dk); panel(g, 12, 2, 3, 6, 1, c.wood_dk); panel(g, -11, -12, 10, 7, 1.5, c.cloud); panel(g, 1, -12, 10, 7, 1.5, c.cloud) }
  else if (n.kind === 'treasury') { panel(g, -16, -14, 32, 20, 3, c.wood); panel(g, -15, -14, 30, 6, 2, c.wood_dk); panel(g, -15, -7, 30, 2, 1, c.gold); panel(g, -3, -10, 6, 7, 2, c.gold_lt); flame(0, -5) }
  else if (n.kind === 'uploads') { if (!n.list?.length) { g.restore(); return } panel(g, -20, -18, 40, 26, 2, c.wood_dk); for (const sy of [-15, -4]) { panel(g, -19, sy + 8, 38, 2, 1, c.wood); for (let i = 0; i < 5; i++) { panel(g, -16 + i * 7, sy, 5, 8, 2.5, i % 2 ? c.peach_lt : c.cloud) } } }
  else if (n.kind === 'maps') { panel(g, -20, -14, 40, 20, 2, c.peach_lt); panel(g, -21, -15, 4, 22, 1, c.wood_dk); panel(g, 17, -15, 4, 22, 1, c.wood_dk); for (const [dx, dy] of [[-12, -8], [-6, -4], [0, -7], [6, -2], [11, -6]]) panel(g, dx, dy, 3, 2, 1, c.red); panel(g, -14, -2, 6, 4, 1.5, c.jade); panel(g, 4, -11, 7, 4, 1.5, c.jade) }
  g.restore()
}

export const lantern: Partial<ArtKit> = {
  realms: REALM_LANTERN,
  cast: LANTERN_CAST,
  plate: '#0a1230',
  helm: false,
  res: 1,
  smooth: true,
  realmHalo: () => {},
  realmDeco: (g, x, y, rx, ry, R, c) => {
    // Crystals ringing the isle.
    const at = (i: number) => { const a = i * 0.9 + 0.3; return [x + Math.cos(a) * rx * 1.12, y + Math.sin(a) * ry * 1.25 - 4] }
    add(g, () => { for (let i = 0; i < 7; i++) { const [px, py] = at(i); glowAt(g, R.glow, px, py, 7, dark(c) ? 0.55 : 0.3) } })
    g.fillStyle = R.glow
    for (let i = 0; i < 7; i++) { const [px, py] = at(i); star4(g, px, py, 2.4); g.fill() }
  },
  realmShell: (g, x, y, rx, ry, _ai, R, c) => isle(g, x, y, rx, ry, Math.round(ry * 0.5), R.top, R.rim, false, c, R.glow),
  backdrop(g, w, h, t, px, c, night) {
    const hy = Math.round(h * 0.42), o = g.globalAlpha
    g.fillStyle = lin(g, 0, 0, 0, hy, night ? [[0, '#03071a'], [0.55, '#091536'], [1, '#1a3358']] : [[0, '#3b2f6e'], [0.45, '#8a5a9a'], [0.8, '#e88a8c'], [1, '#ffc79a']]); g.fillRect(0, 0, w + 1, hy + 1)
    g.fillStyle = lin(g, 0, hy, 0, h, night ? [[0, '#14345a'], [0.35, '#0b2145'], [1, '#050d22']] : [[0, '#7a78b0'], [0.35, '#4f5a96'], [1, '#2a3270']]); g.fillRect(0, hy, w + 1, h - hy + 1)
    // Gradient halo behind the court, like a lit globe's atmosphere.
    add(g, () => {
      const cx = w * 0.5, cy = h * 0.56, r = Math.max(w, h) * 0.72, br = t ? 0.04 * Math.sin(t * 0.4) : 0
      g.fillStyle = rad(g, cx, cy, 0, r, night ? [[0, `rgba(70,120,255,${0.2 + br})`], [0.45, 'rgba(90,70,210,0.09)'], [1, 'rgba(0,0,0,0)']] : [[0, `rgba(255,170,120,${0.22 + br})`], [0.5, 'rgba(255,120,160,0.08)'], [1, 'rgba(0,0,0,0)']]); g.fillRect(0, 0, w, h)
    })
    const ns = night ? 110 : 22
    for (let i = 0; i < ns; i++) {
      const x = hash(i, 1) * w, y = hash(2, i) * hy * 0.92, tw = t ? 0.55 + 0.45 * Math.sin(t * (0.8 + hash(i, 5) * 1.6) + i * 2.1) : 0.75
      g.globalAlpha = o * tw * (night ? 0.9 : 0.5); g.fillStyle = i % 5 ? '#ffffff' : '#bcd8ff'
      g.beginPath(); g.arc(x, y, i % 9 === 0 ? 1.5 : 0.8, 0, TAU); g.fill()
      if (i % 9 === 0 && tw > 0.85) { g.fillRect(x - 4, y - 0.4, 8, 0.8); g.fillRect(x - 0.4, y - 4, 0.8, 8) }
    }
    g.globalAlpha = o
    // Moon at night, low sun at dusk, each with a halo.
    const mx = w * (night ? 0.76 : 0.24) - px * 0.015, my = night ? hy * 0.42 : hy - 6
    add(g, () => pool(g, night ? '#9fc0ff' : '#ff9a5a', mx, my, night ? 190 : 260, night ? 190 : 200, night ? 0.5 : 0.7))
    g.save(); g.beginPath(); g.rect(0, 0, w, hy); g.clip()
    g.fillStyle = rad(g, mx - 6, my - 6, 2, 26, night ? [[0, '#fffdf0'], [1, '#cddcff']] : [[0, '#fff2c8'], [1, '#ffb070']]); g.beginPath(); g.arc(mx, my, night ? 22 : 30, 0, TAU); g.fill()
    if (night) { g.fillStyle = 'rgba(120,140,190,.22)'; for (const [dx, dy, r] of [[-7, -4, 5], [6, 5, 4], [3, -9, 3]]) { g.beginPath(); g.arc(mx + dx, my + dy, r, 0, TAU); g.fill() } }
    g.restore()
    // Far ridges, two parallax layers.
    for (let L = 0; L < 2; L++) {
      const col = night ? (L ? '#0a1a3a' : '#0d2248') : (L ? '#5a4a8a' : '#6e5a9c'), top = 34 - L * 12
      const cv = bakeOnce(`lantern-ridge${col}${L}`, 640, 70, p => {
        p.fillStyle = col; p.beginPath(); p.moveTo(0, 70)
        for (let x = 0; x <= 640; x += 8) p.lineTo(x, top + 14 * Math.sin((x / 640) * TAU * (2 + L)) + 8 * Math.sin((x / 640) * TAU * (5 + L * 2) + L) + 5 * Math.abs(Math.sin(x * 0.07 + L)))
        p.lineTo(640, 70); p.closePath(); p.fill()
      })
      tile(g, cv, px * (0.06 + L * 0.05), hy - 66 + L * 6, w)
    }
    g.fillStyle = lin(g, 0, hy - 26, 0, hy + 26, [[0, 'rgba(255,255,255,0)'], [0.5, night ? 'rgba(150,190,255,.12)' : 'rgba(255,220,200,.25)'], [1, 'rgba(255,255,255,0)']]); g.fillRect(0, hy - 26, w, 52)
    // Light path on the water: lenses that widen toward the viewer.
    add(g, () => {
      for (let j = 0; j < 24; j++) {
        const y = hy + 6 + j * ((h - hy) / 26), wd = 5 + j * 4.2, sh = t ? Math.sin(t * 1.3 + j * 1.7) * 4 : 0, a = (1 - j / 26) * (0.45 + 0.25 * (t ? Math.sin(t * 2 + j) : 0))
        g.fillStyle = night ? `rgba(190,215,255,${a})` : `rgba(255,190,130,${a})`; g.beginPath(); g.ellipse(mx + sh, y, wd, 1 + j * 0.12, 0, 0, TAU); g.fill()
      }
    })
    g.lineWidth = 1; g.lineCap = 'round'
    for (let i = 0; i < 70; i++) {
      const f = hash(i, 7), y = hy + 10 + f * f * (h - hy - 10), sc = 0.4 + (y - hy) / (h - hy), len = 20 * sc + hash(i, 3) * 30 * sc
      const x = (((hash(i, 2) * (w + 120) + (t ? t * (3 + f * 8) : 0) - px * 0.2 * sc) % (w + 120)) + (w + 120)) % (w + 120) - 60
      g.strokeStyle = night ? `rgba(150,195,255,${0.1 + 0.12 * f})` : `rgba(255,225,205,${0.12 + 0.14 * f})`
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + len / 2, y - 2 * sc, x + len, y); g.stroke()
    }
  },
  drift(g, x, y, r, t, i, c) {
    // Fireflies by night, a warm haze at dusk.
    if (!dark(c)) { pool(g, '#ffd8c0', x + r, y, r * 3.2, r * 0.9, 0.18); return }
    add(g, () => {
      for (let k = 0; k < 4; k++) {
        const ph = i * 3.1 + k * 1.9, px = x + Math.cos(t * 0.5 + ph) * r * 1.6 + Math.sin(t * 0.9 + ph * 2) * 5, py = y + Math.sin(t * 0.7 + ph) * r * 0.9, b = 0.35 + 0.65 * Math.max(0, Math.sin(t * 2.2 + ph * 3))
        glowAt(g, i % 2 ? '#ffe27a' : '#b6f26e', px, py, 7, b * 0.9)
      }
    })
  },
  arrive(g, x, y, p, t, c) {
    // A lantern wisp drops in with a trail and sets down in a ring of light.
    const q = Math.min(1, p / 0.6), e = 1 - (1 - q) ** 3, lift = Math.round((1 - e) * 150), fade = p < 0.6 ? 1 : Math.max(0, 1 - (p - 0.6) / 0.3)
    const o = g.globalAlpha
    add(g, () => {
      if (fade > 0) {
        g.globalAlpha = o * fade
        for (let j = 0; j < 6; j++) glowAt(g, c.gold_lt, x + Math.sin(t * 9 + j) * 2, y - lift + 10 + j * 7, 9 - j, 0.5 - j * 0.07)
        glowAt(g, '#ffffff', x, y - lift, 12, 0.9)
      }
      if (p > 0.55) {
        const k = (p - 0.55) / 0.45
        g.globalAlpha = o * (1 - k); g.strokeStyle = c.rail; g.lineWidth = 1.5; g.beginPath(); g.ellipse(x, y + 2, 6 + k * 28, (6 + k * 28) * 0.38, 0, 0, TAU); g.stroke()
      }
    })
    g.globalAlpha = o
    return lift
  },
  ping(g, x, y, t, c) {
    const o = g.globalAlpha
    add(g, () => {
      g.strokeStyle = c.red_lt; g.lineWidth = 1.4
      for (const k of t ? [0, 0.5] : [0.4]) {
        const p = t ? (t * 0.7 + k) % 1 : k, rx = 8 + p * 30
        g.globalAlpha = o * (1 - p) * 0.9; g.beginPath(); g.ellipse(x, y + 2, rx, rx * 0.36, 0, 0, TAU); g.stroke()
      }
      g.globalAlpha = o
    })
  },
  bakeSky(g, w, h) {
    g.fillStyle = 'rgba(190,215,255,.22)'
    for (let i = 0; i < (w * h) / 5200; i++) { g.globalAlpha = 0.25 + (i % 4) * 0.1; g.beginPath(); g.ellipse((i * 137) % w, (i * 71 + (i >> 3)) % h, 2 + (i % 3), 0.7, 0, 0, TAU); g.fill() }
    g.globalAlpha = 1
  },
  bridgeBase(g, ax, ay, bx, by, w, c) {
    // A boardwalk ribbon with a lit edge and a soft glow under it.
    g.lineCap = 'round'
    add(g, () => { g.strokeStyle = rgba(c.rail, dark(c) ? 0.1 : 0.08); g.lineWidth = w * 1.5 + 6; g.beginPath(); g.moveTo(ax, ay + 4); g.lineTo(bx, by + 4); g.stroke() })
    g.strokeStyle = rgba(c.ink, 0.5); g.lineWidth = w * 1.25 + 2; g.beginPath(); g.moveTo(ax, ay + 3); g.lineTo(bx, by + 3); g.stroke()
    g.strokeStyle = lin(g, 0, Math.min(ay, by) - w, 0, Math.max(ay, by) + w, [[0, mix(c.wood_lt, '#ffffff', 0.15)], [1, c.wood]]); g.lineWidth = w * 1.1; g.beginPath(); g.moveTo(ax, ay + 2); g.lineTo(bx, by + 2); g.stroke()
    g.strokeStyle = rgba(c.roof_lt, 0.4); g.lineWidth = 1; g.beginPath(); g.moveTo(ax, ay + 2 - w * 0.55); g.lineTo(bx, by + 2 - w * 0.55); g.stroke()
  },
  bridgeDeck(g, ax, ay, bx, by, w, c) {
    const night = dark(c), len = Math.hypot(bx - ax, by - ay) || 1, n = Math.floor(len / 8), nx = (by - ay) / len, ny = -(bx - ax) / len
    g.strokeStyle = rgba(c.ink, 0.3); g.lineWidth = 1
    for (let i = 1; i < n; i++) { const u = i / n, x = ax + (bx - ax) * u, y = ay + (by - ay) * u + 2; g.beginPath(); g.moveTo(x - nx * w * 0.55, y - ny * w * 0.55); g.lineTo(x + nx * w * 0.55, y + ny * w * 0.55); g.stroke() }
    for (let i = 2; i < n; i += 4) {
      const u = i / n, x = ax + (bx - ax) * u + nx * w * 0.6, y = ay + (by - ay) * u + 1 + ny * w * 0.6
      add(g, () => glowAt(g, c.gold_lt, x, y - 4, 8, night ? 0.75 : 0.4))
      g.fillStyle = c.gold_lt; g.beginPath(); g.arc(x, y - 4, 1.5, 0, TAU); g.fill()
      g.strokeStyle = c.ink2; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - 3); g.stroke()
    }
  },
  islandColors: (top, _rim, c) => top === c.stone_dk ? { top: '#2a3566', rim: '#7a8ad0', dot: c.stone_ln } : { top: dark(c) ? '#1f4d5c' : '#5a7a8c', rim: dark(c) ? '#6fc4c0' : '#ffc79a', dot: c.stone_ln },
  islandUnder: () => {},
  islandTop: () => {},
  island: (g, x, y, rx, ry, depth, top, rim, plaza, c) => isle(g, x, y, rx, ry, depth, top, rim, plaza, c),
  hallWalls: () => {},
  hallRoof: () => {},
  hall: pavilion,
  councilMast(g, hx, hy, c) {
    // A tall staff with three hanging paper lanterns.
    const x = hx - 92, top = hy - 78, night = dark(c)
    g.strokeStyle = c.ink; g.lineWidth = 5; g.lineCap = 'round'; g.beginPath(); g.moveTo(x, hy + 2); g.lineTo(x, top); g.stroke()
    g.strokeStyle = lin(g, x - 2, 0, x + 2, 0, [[0, c.gold_lt], [1, c.gold_dk]]); g.lineWidth = 3; g.beginPath(); g.moveTo(x, hy + 2); g.lineTo(x, top); g.stroke()
    for (let i = 0; i < 3; i++) {
      const ly = top + 8 + i * 18, lx = x + (i % 2 ? 9 : -9)
      add(g, () => glowAt(g, i === 1 ? c.red_lt : c.gold_lt, lx, ly + 7, 16, night ? 0.8 : 0.45))
      g.strokeStyle = c.ink2; g.lineWidth = 1; g.beginPath(); g.moveTo(x, ly - 2); g.lineTo(lx, ly); g.stroke()
      g.fillStyle = rad(g, lx, ly + 7, 1, 8, [[0, '#fff6d8'], [0.6, i === 1 ? c.red_lt : c.gold], [1, c.gold_dk]]); g.beginPath(); g.ellipse(lx, ly + 7, 5.5, 7.5, 0, 0, TAU); g.fill()
    }
  },
  figure(g, x, y, p, c) {
    const role = cast(p.role) as Keeper, night = dark(c), t = p.t
    const frame = t ? Math.floor(t * NF / 2.4) % NF : 0, key = `${role}|${p.ai}|${p.state}|${p.leg}|${frame}|${night}`
    let cv = figs.get(key)
    if (!cv) {
      cv = document.createElement('canvas'); cv.width = FW * FS; cv.height = FH * FS
      const f = cv.getContext('2d')!
      f.setTransform(FS, 0, 0, FS, (FW / 2) * FS, (FH - FOOT) * FS)
      st.paint(f, role, p.ai, p.state, p.leg, frame / NF, c, AI_COL[p.ai ?? ''] ?? c.red_lt)
      figs.put(key, cv)
    }
    // Lamp post at the keeper's right: its light follows the state.
    const [col, a] = lampLight(p.state, t, x * 0.13, c), lx = x + 14, ly = y - 27, o = g.globalAlpha
    if (!p.frozen) add(g, () => {
      pool(g, col, x + 6, y + 3, 30, 9, a * (night ? 0.55 : 0.35))
      glowAt(g, col, lx, ly, 15, a * (night ? 0.95 : 0.6))
      if (p.state === 'done') { g.globalAlpha = o * a; g.fillStyle = col; star4(g, lx, ly, 9 * a); g.fill(); g.globalAlpha = o }
    })
    g.strokeStyle = c.ink2; g.lineWidth = 1.8; g.lineCap = 'round'; g.beginPath(); g.moveTo(lx, y + 1); g.lineTo(lx, ly + 3); g.stroke()
    g.fillStyle = rgba(c.ink, 0.5); g.beginPath(); g.roundRect(lx - 3.4, ly - 4.4, 6.8, 8.4, 2); g.fill()
    g.fillStyle = rad(g, lx, ly, 0.5, 4, [[0, '#ffffff'], [0.45, col], [1, mix(col, c.ink, 0.55)]]); g.globalAlpha = o * (0.45 + 0.55 * a); g.beginPath(); g.roundRect(lx - 2.6, ly - 3.6, 5.2, 6.8, 1.8); g.fill(); g.globalAlpha = o
    g.drawImage(cv, x - FW / 2, y - (FH - FOOT), FW, FH)
    if (!p.frozen) st.fx?.(g, x, y, role, p.state, t, frame / NF, c, fn => add(g, fn), glowAt)
    return FIG_BOX
  },
  badge(g, ic, x, y, c) {
    const cx = x + 7, cy = y + 7, n = ic.name
    const spec: Record<string, [string, string]> = {
      "Red Boy's flame": [c.red_lt, '#ffffff'], 'White Bone Demon': [c.sky, c.ink], 'Palm-leaf fan': [c.red, '#ffffff'], 'Peach of immortality': [c.plum, '#ffffff'],
      'Sutra scroll': [c.jade, '#ffffff'], 'Somersault cloud': [c.gold, c.ink], 'White Dragon Horse': ['#ff9f7a', '#ffffff'], 'Taishang Laojun': ['#5a8ee0', '#ffffff'], "Buddha's palm": [c.gold, c.ink],
    }
    const [bg, fg] = spec[n] ?? [c.azure, '#ffffff']
    g.fillStyle = rad(g, cx - 2, cy - 2.5, 0.5, 9, [[0, mix(bg, '#ffffff', 0.4)], [0.6, bg], [1, mix(bg, c.ink, 0.45)]]); g.beginPath(); g.arc(cx, cy, 6.8, 0, TAU); g.fill()
    g.strokeStyle = rgba(c.ink, 0.55); g.lineWidth = 1; g.stroke()
    g.strokeStyle = g.fillStyle = fg; g.lineWidth = 1.5; g.lineCap = g.lineJoin = 'round'
    g.beginPath()
    if (n === "Red Boy's flame") { g.moveTo(cx, cy - 4); g.quadraticCurveTo(cx + 4, cy, cx + 2, cy + 3); g.quadraticCurveTo(cx, cy + 4.5, cx - 2, cy + 3); g.quadraticCurveTo(cx - 3.5, cy, cx, cy - 4); g.fill() }
    else if (n === 'White Bone Demon') { g.arc(cx, cy, 3, 0.4, TAU - 0.8); g.stroke() }
    else if (n === 'Palm-leaf fan') { g.moveTo(cx, cy - 3.6); g.lineTo(cx, cy + 0.8); g.stroke(); g.beginPath(); g.arc(cx, cy + 3.4, 0.9, 0, TAU); g.fill() }
    else if (n === 'Peach of immortality') { g.arc(cx, cy, 3.6, PI * 0.35, PI * 1.65); g.arc(cx + 1.4, cy - 0.4, 3, PI * 1.55, PI * 0.45, true); g.fill() }
    else if (n === 'Sutra scroll') { g.moveTo(cx - 3, cy); g.lineTo(cx - 0.8, cy + 2.4); g.lineTo(cx + 3.2, cy - 2.4); g.stroke() }
    else if (n === 'Somersault cloud') { star4(g, cx, cy, 4.2); g.fill() }
    else if (n === 'White Dragon Horse') { for (let k = 0; k < 4; k++) { const a = (k * PI) / 4; g.moveTo(cx - Math.cos(a) * 3.8, cy - Math.sin(a) * 3.8); g.lineTo(cx + Math.cos(a) * 3.8, cy + Math.sin(a) * 3.8) } g.stroke() }
    else if (n === 'Taishang Laojun') { g.moveTo(cx - 1.6, cy - 3); g.lineTo(cx - 3.6, cy); g.lineTo(cx - 1.6, cy + 3); g.moveTo(cx + 1.6, cy - 3); g.lineTo(cx + 3.6, cy); g.lineTo(cx + 1.6, cy + 3); g.stroke() }
    else { g.arc(cx, cy, 2.8, 0, TAU); g.stroke() }
  },
  bubble(g, x, y, st, step, c) {
    if (!st || st === 'idle') return
    const col = st === 'working' ? c.gold : st === 'stuck' ? c.red : st === 'needs' ? c.red_lt : st === 'done' ? c.jade_lt : c.cloud_sh, bx = x - 13, by = y - 26
    g.beginPath(); g.roundRect(bx, by, 26, 19, 7); g.moveTo(x - 3, by + 18.6); g.lineTo(x, y); g.lineTo(x + 3, by + 18.6)
    g.fillStyle = lin(g, 0, by, 0, by + 19, [[0, '#ffffff'], [1, mix(c.cloud, c.sky, 0.45)]]); g.fill()
    g.strokeStyle = col; g.lineWidth = 1.6; g.lineJoin = 'round'; g.stroke()
    g.fillStyle = g.strokeStyle = col; g.lineCap = 'round'
    const cx = x, cy = by + 9.5
    // Shape per state: dots working, pause bars waiting, check done, cross stuck, bang needs.
    if (st === 'working') for (let i = -1; i <= 1; i++) { g.beginPath(); g.arc(cx + i * 6, cy + ((step + i + 1) % 3 === 0 ? -1.8 : 0), 1.9, 0, TAU); g.fill() }
    else if (st === 'waiting') { g.fillRect(cx - 3.6, cy - 4.5, 2.4, 9); g.fillRect(cx + 1.2, cy - 4.5, 2.4, 9) }
    else if (st === 'done') { g.lineWidth = 2.2; g.beginPath(); g.moveTo(cx - 5, cy); g.lineTo(cx - 1.5, cy + 3.5); g.lineTo(cx + 5, cy - 4); g.stroke() }
    else if (st === 'stuck') { g.lineWidth = 2.2; g.beginPath(); g.moveTo(cx - 4, cy - 4); g.lineTo(cx + 4, cy + 4); g.moveTo(cx + 4, cy - 4); g.lineTo(cx - 4, cy + 4); g.stroke() }
    else { g.lineWidth = 2.4; g.beginPath(); g.moveTo(cx, cy - 5); g.lineTo(cx, cy + 1.2); g.stroke(); g.beginPath(); g.arc(cx, cy + 4.6, 1.5, 0, TAU); g.fill() }
  },
  zzz(g, x, y, t, c) {
    const o = g.globalAlpha
    for (let i = 0; i < 3; i++) {
      const ph = t ? (t * 0.45 + i / 3) % 1 : (i + 0.5) / 3, zx = x + 7 + ph * 12, zy = y - ph * 26, s = 3.5 + ph * 4.5
      g.globalAlpha = o * Math.sin(PI * ph); g.strokeStyle = c.cloud; g.lineWidth = 1.7; g.lineJoin = 'round'
      g.beginPath(); g.moveTo(zx - s, zy - s); g.lineTo(zx + s, zy - s); g.lineTo(zx - s, zy + s); g.lineTo(zx + s, zy + s); g.stroke()
    }
    g.globalAlpha = o
  },
  sparkle(g, x, y, t, i, c) {
    const ph = t ? (t * 0.7 + i * 0.37) % 1 : 0.2
    if (ph > 0.5) return
    const k = Math.sin((PI * ph) / 0.5)
    add(g, () => { glowAt(g, c.jade_lt, x, y, 12, 0.8 * k); g.fillStyle = '#ffffff'; star4(g, x, y, 8 * k); g.fill() })
  },
  desk: deskArt,
  landmark: landmarkArt,
  gate: gateArt,
  placeArt: placeArtSmooth,
  // Done: five sky lanterns lifting off the desk, swaying as they rise, fading high up.
  confetti(g, x, y, cheer, c) {
    const o = g.globalAlpha
    for (let i = 0; i < 5; i++) {
      const k = Math.min(1, Math.max(0, cheer * 1.25 - i * 0.06))
      if (!k) continue
      const s = 1 - k * 0.35, lx = x + (i - 2) * 7 + Math.sin(k * 5 + i * 1.7) * 2.5, ly = y - 12 - k * (30 + (i % 3) * 8)
      const a = Math.min(1, k * 6) * (1 - Math.max(0, (k - 0.7) / 0.3)), w0 = 2 * s, w1 = 2.8 * s, h = 7 * s
      add(g, () => glowAt(g, c.gold, lx, ly, 10 * s, 0.8 * a))
      g.globalAlpha = o * a
      g.fillStyle = c.cloud_sh; g.beginPath(); g.moveTo(lx - w1, ly - h / 2); g.lineTo(lx + w1, ly - h / 2); g.lineTo(lx + w0, ly + h / 2); g.lineTo(lx - w0, ly + h / 2); g.closePath(); g.fill()
      g.fillStyle = c.gold_lt; g.beginPath(); g.ellipse(lx, ly + h * 0.15, w0 * 0.7, h * 0.3, 0, 0, TAU); g.fill()
      g.fillStyle = '#ffffff'; g.beginPath(); g.arc(lx, ly + h / 2, 0.8 * s, 0, TAU); g.fill()
    }
    g.globalAlpha = o
  },
}
