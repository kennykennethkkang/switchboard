// Orbital Fleet: the court as a fleet in orbit. Planetoid decks, station modules, warp lanes and a nebula sky in the same layout.
import type { CourtColors as C } from '@/lib/skins'
import { orbit as skin } from '../../../lib/skins/orbit'
import { ORBIT } from '../../../lib/court-cast'
import { bakeOnce, ell, glow, glowAt, rect, type G } from '../board-art'
import type { ArtKit, Realm } from './types'

const NIGHT_INK = skin.night!.court.colors.ink
const dark = (c: C) => c.ink === NIGHT_INK
const hash = (a: number, b: number) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s) }
const PI = Math.PI

// Realm worlds: deck top, rim (the planet's body), shadow, the AI's light, and its atmosphere.
const REALM_ORBIT: Record<string, Realm> = {
  codex: { top: '#1c3054', rim: '#4a7cc0', dk: '#0e1a38', hi: '#6fd4ff', glow: '#c8f0ff' },
  jev: { top: '#2a2354', rim: '#6c58b4', dk: '#161032', hi: '#b6f26e', glow: '#e6ffc4' },
  perplexity: { top: '#0e3a48', rim: '#26929a', dk: '#07222c', hi: '#7ff0e6', glow: '#d8fffa' },
  gemini: { top: '#1e2464', rim: '#4b60d0', dk: '#10133c', hi: '#a9c1ff', glow: '#fff3c4' },
  claude: { top: '#3a2034', rim: '#8e5a6a', dk: '#2a1020', hi: '#ff9f7a', glow: '#ffd9c4' },
}

// Planet bodies under the decks: base, shadow, light, atmosphere; rock gets craters, gas gets bands.
// No orange bodies: stuck badges are orange.
type World = { base: string; dk: string; lt: string; atm: string; rock: boolean }
const WORLDS: World[] = [
  { base: '#7c4e5e', dk: '#2e1628', lt: '#d49aae', atm: '#e8a0c0', rock: true },
  { base: '#5f8fc4', dk: '#1e2e58', lt: '#c4e8ff', atm: '#8fd8ff', rock: false },
  { base: '#7a5ac0', dk: '#261a52', lt: '#c8aaff', atm: '#c49cff', rock: false },
  { base: '#2f9a8e', dk: '#10343e', lt: '#8ff0d8', atm: '#7af7d6', rock: true },
  { base: '#b8925a', dk: '#42301f', lt: '#f4d89a', atm: '#ffd98a', rock: true },
]
const MOON: World = { base: '#7d8199', dk: '#262840', lt: '#d4d8ea', atm: '#b8c8ff', rock: true }
const CORE: World = { base: '#3a52b0', dk: '#121a48', lt: '#a8c0ff', atm: '#ffd27a', rock: false }

// 2px checker in one color: the dither between lit and shaded.
const dith = (g: G, col: string) => g.createPattern(bakeOnce(`orbit-dith${col}`, 2, 2, p => { p.fillStyle = col; p.fillRect(0, 0, 1, 1); p.fillRect(1, 1, 1, 1) }), 'repeat')!

// Soft atmosphere: the baked glow stretched over an ellipse.
function halo(g: G, col: string, x: number, y: number, rx: number, ry: number, a: number) {
  const o = g.globalAlpha; g.globalAlpha = o * a; g.drawImage(glow(col, 48), x - rx, y - ry, rx * 2, ry * 2); g.globalAlpha = o
}

// The lower half of a planet under a deck at (x, y): bands or craters, a dithered terminator, a scatter rim. Bake time only.
function sphere(g: G, x: number, y: number, rx: number, ry: number, drop: number, W: World, c: C, seed: number) {
  const H = ry + drop, night = dark(c)
  g.save()
  g.beginPath(); g.ellipse(x, y, rx, H, 0, 0, PI); g.closePath()
  g.fillStyle = W.base; g.fill(); g.clip()
  for (let yy = 0, k = 0; yy < H; yy += 2 + ((k * 7 + seed) % 4), k++) {
    g.globalAlpha = W.rock ? 0.16 : 0.34; g.fillStyle = k % 2 ? W.dk : W.lt
    for (let xx = -rx; xx < rx; xx += 3) g.fillRect(Math.round(x + xx), Math.round(y + yy + Math.sin((xx + seed * 13) * 0.07 + k) * 1.4), 3, k % 3 ? 1 : 2)
  }
  g.globalAlpha = 1
  if (W.rock) for (let i = 0; i < 4 + Math.round(rx / 14); i++) {
    const cx = x + (hash(seed, i) - 0.5) * rx * 1.5, cy = y + 3 + hash(i, seed) * H * 0.75, r = 1.5 + (i % 3) * 1.2
    ell(g, cx, cy, r, r * 0.6, W.dk, 0.55); ell(g, cx + 0.6, cy + 0.6, r * 0.7, r * 0.35, W.lt, 0.35)
  }
  // Night side, lower right: a dither band, then full shade at the far edge.
  const shade = (k: number, fill: string | CanvasPattern, a: number) => {
    g.globalAlpha = a; g.fillStyle = fill; g.beginPath(); g.rect(x - rx - 2, y - 2, rx * 2 + 4, H + 4)
    g.ellipse(x - rx * 0.32, y - H * 0.25, rx * k, H * k, 0, 0, 7); g.fill('evenodd')
  }
  shade(1.0, dith(g, W.dk), 1); shade(1.14, W.dk, night ? 0.92 : 0.8)
  // City lights on the dark side by night.
  if (night) for (let i = 0; i < 7; i++) { g.globalAlpha = 0.9; rect(g, x + rx * (0.35 + hash(seed, i + 9) * 0.5), y + H * (0.3 + hash(i + 9, seed) * 0.5), 1, 1, i % 3 ? c.gold_lt : W.atm) }
  // Scatter on the lit limb.
  g.globalAlpha = night ? 0.9 : 0.75; g.strokeStyle = W.atm; g.lineWidth = 1.5
  g.beginPath(); g.ellipse(x, y, rx - 0.75, H - 0.75, 0, PI * 0.5, PI); g.stroke()
  g.restore()
  g.strokeStyle = c.ink; g.lineWidth = 1; g.beginPath(); g.ellipse(x, y, rx + 0.5, H + 0.5, 0, 0, PI); g.stroke()
}

// A thin ring round a world, back half or front half.
function ring(g: G, x: number, y: number, rx: number, ry: number, cols: string[], front: boolean, a: number) {
  for (let i = 0; i < cols.length; i++) {
    g.globalAlpha = a * (i === 1 ? 1 : 0.55); g.strokeStyle = cols[i]; g.lineWidth = 1
    g.beginPath(); g.ellipse(x, y, rx + i * 1.6, ry + i * 0.5, -0.06, front ? 0 : PI, front ? PI : PI * 2); g.stroke()
  }
  g.globalAlpha = 1
}

// A station disc: a lit metal side, a segmented plating ring round a plain center, lights on the near edge. Pad marks a landing plaza.
function deck(g: G, x: number, y: number, rx: number, ry: number, top: string, rim: string, seam: string, side: [string, string], lights: string[], pad: boolean, c: C) {
  ell(g, x, y + 5, rx + 1, ry + 1, c.ink); ell(g, x, y + 4, rx, ry, side[1]); ell(g, x - 1, y + 3, rx - 1, ry, side[0])
  ell(g, x, y, rx + 1, ry + 1, c.ink); ell(g, x, y, rx, ry, rim); ell(g, x, y + 1, rx - 1.5, ry - 2, top)
  // Plating ring: alternate plates a shade lighter, seams between.
  const n = Math.max(12, Math.round(rx / 3) * 2), ox = rx - 2, oy = ry - 2.5, ix = rx * 0.72, iy = ry * 0.68
  for (let i = 0; i < n; i += 2) {
    const a0 = (i / n) * PI * 2, a1 = ((i + 1) / n) * PI * 2
    g.globalAlpha = 0.22; g.fillStyle = rim; g.beginPath(); g.ellipse(x, y + 1, ox, oy, 0, a0, a1); g.ellipse(x, y + 1, ix, iy, 0, a1, a0, true); g.closePath(); g.fill()
  }
  g.globalAlpha = 0.7; g.strokeStyle = seam; g.lineWidth = 1; g.beginPath(); g.ellipse(x, y + 1, ix, iy, 0, 0, 7); g.stroke()
  g.globalAlpha = 0.35; g.strokeStyle = rim; g.beginPath(); g.ellipse(x, y + 2, ix - 1, iy - 1, 0, PI * 0.15, PI * 0.85); g.stroke()
  g.save(); g.beginPath(); g.ellipse(x, y + 1, rx - 1.5, ry - 2, 0, 0, 7); g.clip()
  ell(g, x - rx * 0.3, y - ry * 0.55, rx * 0.85, ry * 0.5, c.cloud, dark(c) ? 0.04 : 0.08)
  g.restore()
  if (pad) {
    g.globalAlpha = 0.55; g.strokeStyle = c.gold_dk; g.setLineDash([3, 3]); g.beginPath(); g.ellipse(x, y + 1, rx * 0.56, ry * 0.52, 0, 0, 7); g.stroke(); g.setLineDash([]); g.globalAlpha = 1
  }
  g.globalAlpha = 1
  const m = Math.max(7, Math.round(rx / 5))
  for (let i = 0; i < m; i++) {
    const a = PI * (0.06 + (0.88 * i) / (m - 1)), px = x + Math.cos(a) * (rx - 0.5), py = y + Math.sin(a) * ry + 3, col = lights[i % lights.length]
    glowAt(g, col, px, py, 4, dark(c) ? 0.75 : 0.5); rect(g, px, py, 1, 1, col)
  }
}

// Island and realm share this: atmosphere, ring behind, body, ring in front, deck.
function world(g: G, x: number, y: number, rx: number, ry: number, drop: number, W: World, ringCols: string[] | undefined, seed: number, c: C, paint: () => void) {
  const night = dark(c), cy = y + drop / 2, hh = ry + drop / 2
  halo(g, W.atm, x, cy, rx * 1.55, hh * 1.75, night ? 0.5 : 0.34)
  halo(g, W.lt, x, cy, rx * 1.18, hh * 1.3, night ? 0.32 : 0.2)
  const ry2 = ry * 0.42 + 2, rr = rx * 1.32, ringY = y + drop * 0.55
  if (ringCols) ring(g, x, ringY, rr, ry2, ringCols, false, night ? 0.85 : 0.7)
  sphere(g, x, y, rx, ry, drop, W, c, seed)
  if (ringCols) ring(g, x, ringY, rr, ry2, ringCols, true, night ? 0.85 : 0.7)
  paint()
}

// Nebula: soft blobs posterized into steps with a short ordered dither between them, wrapping in x so the strip tiles. Baked at half res, drawn at 2x.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
type Blob = [number, number, number, string, number, number, number]
function nebula(key: string, W: number, H: number, blobs: Blob[], levels: number) {
  return bakeOnce(key, W, H, g => {
    // A blob with no color carves a dark dust lane out of what is already there.
    for (const [fx, fy, r, col, a, sx, rot] of blobs) for (const dx of [-W, 0, W]) {
      g.globalCompositeOperation = col ? 'source-over' : 'destination-out'
      g.setTransform(1, 0, 0, 1, fx * W + dx, fy * H); g.rotate(rot); g.scale(sx, 1)
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, r); const k = col || '#000000'; gr.addColorStop(0, k); gr.addColorStop(0.45, k + '88'); gr.addColorStop(1, k + '00')
      g.globalAlpha = a; g.fillStyle = gr; g.fillRect(-r, -r, r * 2, r * 2)
    }
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'
    const im = g.getImageData(0, 0, W, H), d = im.data
    for (let i = 0; i < d.length; i += 4) { const p = i >> 2, th = 0.5 + ((BAYER[((((p / W) | 0) & 3) << 2) + ((p % W) & 3)] + 0.5) / 16 - 0.5) * 0.55; d[i + 3] = Math.min(255, (Math.floor((d[i + 3] / 255) * levels + th) / levels) * 255) }
    g.putImageData(im, 0, 0)
  })
}
const FAR: Blob[] = [
  [0.15, 0.3, 70, '#6a3ac8', 0.8, 2.2, 0.25], [0.55, 0.62, 80, '#1fb0b0', 0.6, 2.6, -0.2], [0.85, 0.25, 60, '#d04a8a', 0.65, 2, 0.4],
  [0.4, 0.15, 50, '#4a5ae0', 0.55, 2.4, 0.1], [0.7, 0.85, 60, '#7a3ab0', 0.55, 2.2, 0.15],
  [0.3, 0.48, 40, '', 0.7, 3.4, 0.3], [0.72, 0.45, 34, '', 0.6, 3, -0.4], [0.05, 0.8, 36, '', 0.6, 2.8, 0.1], [0.5, 0.05, 30, '', 0.5, 3, 0],
]
const NEAR: Blob[] = [
  [0.2, 0.55, 34, '#ff6aa8', 0.55, 3.2, -0.35], [0.62, 0.35, 30, '#5af0e0', 0.5, 3.6, 0.3], [0.9, 0.7, 26, '#b48aff', 0.55, 3, -0.2],
  [0.24, 0.6, 14, '', 0.8, 4, -0.3], [0.6, 0.3, 12, '', 0.7, 4, 0.35],
]
// Star field tile: dim specks, a few colored, some with a cross.
function stars(key: string, S: number, n: number, cols: string[], cross: boolean) {
  return bakeOnce(key, S, S, g => {
    for (let i = 0; i < n; i++) {
      const x = Math.floor(hash(i, S) * S), y = Math.floor(hash(S, i + 0.5) * S), col = cols[i % cols.length]
      g.fillStyle = col; g.fillRect(x, y, 1, 1)
      if (cross && i % 6 === 0) { g.globalAlpha = 0.45; g.fillRect(x - 1, y, 3, 1); g.fillRect(x, y - 1, 1, 3); g.globalAlpha = 1 }
    }
  })
}
function tile2(g: G, cv: HTMLCanvasElement, ox: number, oy: number, w: number, h: number) {
  const W = cv.width, H = cv.height, x0 = -(((Math.round(ox) % W) + W) % W), y0 = -(((Math.round(oy) % H) + H) % H)
  for (let y = y0; y < h; y += H) for (let x = x0; x < w; x += W) g.drawImage(cv, x, y)
}
function strip(g: G, cv: HTMLCanvasElement, off: number, w: number) {
  const W = cv.width * 2, o = ((Math.round(off) % W) + W) % W
  for (let x = -o; x < w; x += W) g.drawImage(cv, x, 0, W, cv.height * 2)
}

// The ringed gas giant in the corner, banded and lit from the left.
const BANDS = ['#3a2668', '#54348a', '#7c4492', '#b25e86', '#dc8a7e', '#f2bc8e', '#d08280', '#9a5490', '#6a3a8c', '#46307a', '#302460']
function giant(r: number, night: boolean) {
  const W = Math.ceil(r * 3.6), H = Math.ceil(r * 2.6), cx = W / 2, cy = H / 2, tilt = -0.3
  return bakeOnce(`orbit-giant${r}${night}`, W, H, g => {
    const pass = (front: boolean) => {
      for (let k = 0; k < 18; k++) {
        const f = k / 17, rr = r * (1.28 + 0.5 * f)
        if (f > 0.56 && f < 0.66) continue
        g.globalAlpha = (0.3 + 0.5 * Math.sin(f * PI)) * (night ? 0.75 : 1); g.strokeStyle = k % 4 === 0 ? '#c8789a' : k % 3 ? '#ecc8a6' : '#fff0d8'; g.lineWidth = 1
        g.beginPath(); g.ellipse(cx, cy, rr, rr * 0.22, tilt, front ? 0 : PI, front ? PI : PI * 2); g.stroke()
      }
      g.globalAlpha = 1
    }
    const at = g.createRadialGradient(cx, cy, r * 0.92, cx, cy, r * 1.3); at.addColorStop(0, night ? 'rgba(200,140,255,.45)' : 'rgba(255,190,210,.5)'); at.addColorStop(1, 'rgba(255,190,210,0)')
    g.fillStyle = at; g.beginPath(); g.arc(cx, cy, r * 1.3, 0, 7); g.fill()
    pass(false)
    g.save(); g.beginPath(); g.arc(cx, cy, r, 0, 7); g.clip()
    g.translate(cx, cy); g.rotate(tilt)
    for (let yy = -r - 4; yy < r + 4; yy++) for (let xx = -r - 4; xx < r + 4; xx += 2) {
      const f = (yy / r + 1) / 2 + 0.035 * Math.sin(xx * 0.09 + yy * 0.3) + 0.02 * Math.sin(xx * 0.21)
      g.fillStyle = BANDS[Math.max(0, Math.min(BANDS.length - 1, Math.floor(f * BANDS.length)))]; g.fillRect(xx, yy, 2, 1)
    }
    // The storm.
    ell(g, r * 0.28, r * 0.3, r * 0.2, r * 0.08, '#f6c0a0', 0.9); ell(g, r * 0.28, r * 0.3, r * 0.12, r * 0.045, '#c86a6a', 0.9)
    g.setTransform(1, 0, 0, 1, 0, 0)
    for (const [k, fill, a] of [[0.98, dith(g, '#120a26'), 1], [1.12, '#120a26', night ? 0.92 : 0.82]] as const) {
      g.globalAlpha = a; g.fillStyle = fill; g.beginPath(); g.rect(0, 0, W, H); g.arc(cx - r * 0.36, cy - r * 0.3, r * k, 0, 7); g.fill('evenodd')
    }
    // Ring shadow across the face.
    g.globalAlpha = 0.45; g.strokeStyle = '#120a26'; g.lineWidth = 2; g.beginPath(); g.ellipse(cx, cy + 3, r * 1.3, r * 0.28, tilt, PI * 1.1, PI * 1.9); g.stroke()
    g.restore()
    g.globalAlpha = 0.85; g.strokeStyle = night ? '#d8b8ff' : '#ffe0ec'; g.lineWidth = 1.5; g.beginPath(); g.arc(cx, cy, r - 0.75, PI * 0.85, PI * 1.55); g.stroke(); g.globalAlpha = 1
    pass(true)
  })
}

// Small craft for the drift lane and the arrival: k ink, s shade, w hull, u glass, g engine.
const SHIP = ['....kkkkk.......', '..kksswwwkk.....', 'kksswwwwwuukkk..', 'kgsswwwwwuuuwwkk', 'kksswwwwwwwwkkk.', '..kksswwwkk.....', '....kkkkk.......']
const ROCK = ['...kkkk...', '.kkssask..', 'kssaassak.', 'ksaasssakk', 'kssssaassk', '.kasssssk.', '..kkaakk..']
function pix(key: string, rows: string[], pal: Record<string, string>) {
  return bakeOnce(key, rows[0].length, rows.length, g => rows.forEach((row, y) => [...row].forEach((ch, x) => { if (pal[ch]) { g.fillStyle = pal[ch]; g.fillRect(x, y, 1, 1) } })))
}

// Done: a star burst, a shrinking core cross, a cyan shock ring and spinning gold stars flying out.
function starburst(g: G, x: number, y: number, cheer: number, c: C) {
  const cy = y - 10, R = 3 + cheer * 18, s = Math.round(4 * (1 - cheer))
  if (s > 0) { rect(g, x - s, cy, s * 2 + 1, 1, c.cloud); rect(g, x, cy - s, 1, s * 2 + 1, c.cloud) }
  if (cheer < 0.6) for (let j = 0; j < 16; j++) { const a = (j * PI) / 8, r = 2 + cheer * 14; rect(g, x + Math.cos(a) * r, cy + Math.sin(a) * r * 0.8, 1, 1, c.rail) }
  for (let i = 0; i < 10; i++) {
    const a = (i * PI) / 5 + cheer * 0.6, px = Math.round(x + Math.cos(a) * R), py = Math.round(cy + Math.sin(a) * R * 0.8)
    if (i % 2 || cheer > 0.7) { rect(g, px, py, 1, 1, i % 2 ? c.blue_lt : c.gold_lt); continue }
    rect(g, px - 1, py, 3, 1, c.gold_lt); rect(g, px, py - 1, 1, 3, c.gold_lt); rect(g, px, py, 1, 1, c.cloud)
  }
}
export const orbit: Partial<ArtKit> = {
  confetti: starburst,
  realms: REALM_ORBIT,
  plate: 'rgba(9,12,30,.92)',
  helm: true,
  cast: ORBIT,
  realmShell(g, x, y, rx, ry, ai, R, c) {
    const W: World = { base: R.rim, dk: R.dk, lt: R.hi, atm: R.hi, rock: ai === 'claude' || ai === 'jev' }
    const drop = Math.round(Math.min(rx * 0.56, ry + 16)), seed = Math.round(x * 3 + y * 7)
    halo(g, R.glow, x, y + drop / 2, rx * 1.9, (ry + drop / 2) * 2.1, dark(c) ? 0.3 : 0.18)
    const rings = ai === 'perplexity' || ai === 'jev' ? undefined : [R.dk, R.hi, R.glow]
    world(g, x, y, rx, ry, drop, W, rings, seed, c, () => {
      deck(g, x, y, rx, ry, R.top, R.rim, R.dk, [R.rim, R.dk], [R.hi, R.glow, c.gold_lt], false, c)
      g.save(); g.beginPath(); g.ellipse(x, y + 1, rx * 0.72, ry * 0.68, 0, 0, 7); g.clip(); g.globalAlpha = 0.5
      if (ai === 'jev') { for (let gx = -rx; gx < rx; gx += 6) for (let gy = -ry; gy < ry; gy += 6) if (((gx + gy) / 6) % 2 === 0) rect(g, x + gx, y + gy, 6, 6, R.dk) }
      else if (ai === 'perplexity') { g.strokeStyle = R.rim; g.lineWidth = 1; for (let i = 1; i < 4; i++) { g.beginPath(); g.ellipse(x, y + 1, rx * 0.72 * i / 4, ry * 0.68 * i / 4, 0, 0, 7); g.stroke() } }
      else for (let gx = -rx; gx < rx; gx += 8) for (let gy = -ry; gy < ry; gy += 6) rect(g, x + gx + ((gy / 6) % 2 ? 4 : 0), y + gy, 3, 1, R.rim)
      g.restore()
    })
    // Moonlets that keep the realm company.
    for (let i = 0; i < 3; i++) { const a = PI * (1.1 + i * 0.32) + hash(seed, i), d = 1.35 + i * 0.12, mx = x + Math.cos(a) * rx * d, my = y + drop * 0.4 + Math.sin(a) * ry * d * 1.1; ell(g, mx, my, 2.5 - i * 0.5, 2.5 - i * 0.5, c.ink); ell(g, mx, my, 2 - i * 0.5, 2 - i * 0.5, R.rim); rect(g, mx - 1, my - 1, 1, 1, R.glow) }
  },
  backdrop(g, w, h, t, px, c, night) {
    const hh = Math.ceil(h / 2), o = g.globalAlpha
    // The star the fleet orbits, by day.
    if (!night) {
      const sx = Math.round(w * 0.22), sy = Math.round(Math.min(40, h * 0.1))
      glowAt(g, '#ffc8a0', sx, sy, 200, 0.4); glowAt(g, '#fff4e0', sx, sy, 70, 0.75); glowAt(g, '#ffffff', sx, sy, 14, 1)
      for (const [dx, dy, l] of [[1, 0, 90], [0, 1, 40], [1, 1, 22], [1, -1, 22]]) for (let i = 3; i < l; i++) { g.globalAlpha = o * (1 - i / l) * 0.8; for (const s of [1, -1]) rect(g, sx + dx * i * s, sy + dy * i * s, 1, 1, '#fff4e0') }
      g.globalAlpha = o
    }
    g.globalAlpha = o * (night ? 0.7 : 1)
    strip(g, nebula(`orbit-neb-far${hh}`, 320, hh, FAR, 7), px * 0.015 + t * 0.4, w)
    g.globalAlpha = o * (night ? 0.55 : 0.85)
    strip(g, nebula(`orbit-neb-near${hh}`, 260, hh, NEAR, 6), px * 0.035 + t * 0.9, w)
    g.globalAlpha = o * (night ? 1 : 0.7)
    tile2(g, stars('orbit-st0', 211, 160, ['#5a6890', '#8090c0', '#6a5aa0'], false), px * 0.01 + t * 0.3, 0, w, h)
    tile2(g, stars('orbit-st1', 263, 70, ['#cfe0ff', '#ffd6ef', '#9fe8ff', '#ffffff'], true), px * 0.03 + t * 0.7, 37, w, h)
    g.globalAlpha = o
    // The ringed giant, top right, smaller on a phone.
    const r = w < 420 ? 28 : 58, cv = giant(r, night)
    g.drawImage(cv, Math.round(w - cv.width * 0.78 - px * 0.008), Math.round(-cv.height * 0.12))
    // Twinkles.
    for (let i = 0; i < 26; i++) {
      const x = Math.round(hash(i, 4) * w), y = Math.round(hash(5, i) * h), a = t ? 0.5 + 0.5 * Math.sin(t * (1.2 + (i % 4) * 0.5) + i * 1.7) : 0.7, col = i % 3 ? '#ffffff' : i % 2 ? '#9fe8ff' : '#ffc6e6'
      g.globalAlpha = o * a; rect(g, x, y, 1, 1, col)
      if (a > 0.75) { g.globalAlpha = o * (a - 0.5); rect(g, x - 2, y, 5, 1, col); rect(g, x, y - 2, 1, 5, col) }
    }
    g.globalAlpha = o
    // A convoy far out, crossing slowly.
    const cx0 = ((w * 0.3 + t * 5) % (w + 60)) - 30, cyy = Math.round(h * 0.42)
    for (let i = 0; i < 3; i++) { const x = Math.round(cx0 - i * 7), y = cyy + i * 3; rect(g, x, y, 3, 1, '#c8d4f0'); g.globalAlpha = o * 0.8; rect(g, x - 1, y, 1, 1, '#ffb45a'); g.globalAlpha = o }
    // Comets, one pass every half minute or so; one holds still when motion is off.
    for (let i = 0; i < 2; i++) {
      const per = 26 + i * 11, ph = t ? ((t + i * 13) % per) / per : 0.32 + i * 0.4
      if (ph > 0.45) continue
      const k = ph / 0.45, x = w * (1.05 - k * 1.25), y = h * (0.08 + i * 0.3) + k * h * 0.28
      for (let j = 1; j < 22; j++) { g.globalAlpha = o * (1 - j / 22) * 0.85; rect(g, x + j * 1.7, y - j * 0.4, 1, j < 5 ? 2 : 1, j < 8 ? '#e8f6ff' : '#7cc8ff') }
      g.globalAlpha = o; glowAt(g, '#9fe8ff', x, y, 8, 0.8); rect(g, x - 1, y, 2, 2, '#ffffff')
    }
  },
  drift(g, x, y, r, t, i, c) {
    const yy = Math.round(y + Math.sin(t * 0.8 + i) * 2)
    if (i % 3 === 0) { g.drawImage(pix(`orbit-rock${c.ink}`, ROCK, { k: c.ink, s: '#6e7290', a: '#9ca2c0' }), Math.round(x), yy); return }
    const ship = pix(`orbit-ship${c.ink}`, SHIP, { k: c.ink, s: c.roof_dk, w: c.roof, u: c.blue_lt, g: c.gold })
    const fl = t ? 2 + Math.round(Math.abs(Math.sin(t * 13 + i)) * 3) : 3
    glowAt(g, '#ffb45a', x - 1, yy + 3, 7, 0.55); rect(g, x - fl, yy + 3, fl, 1, c.gold_lt)
    g.drawImage(ship, Math.round(x), yy)
  },
  arrive(g, x, y, p, t, c) {
    // A lander drops in on its thruster, a ring of light where it sets down.
    const q = Math.min(1, p / 0.6), e = 1 - (1 - q) ** 3, lift = Math.round((1 - e) * 110), fade = p < 0.6 ? 1 : Math.max(0, 1 - (p - 0.6) / 0.3)
    const o = g.globalAlpha
    if (fade > 0) {
      g.globalAlpha = o * fade
      const ly = y - lift, fl = 3 + (t ? Math.round(Math.abs(Math.sin(t * 17)) * 3) : 2)
      glowAt(g, '#ffb45a', x, ly + 5, 12, 0.7)
      rect(g, x - 1, ly + 2, 3, fl, c.gold); rect(g, x, ly + 2, 1, fl + 1, c.gold_lt)
      rect(g, x - 6, ly - 5, 13, 7, c.ink); rect(g, x - 5, ly - 4, 11, 5, c.roof); rect(g, x - 5, ly - 4, 11, 1, c.roof_lt); rect(g, x - 5, ly, 11, 1, c.roof_dk)
      rect(g, x - 2, ly - 3, 4, 2, c.blue_lt); rect(g, x - 7, ly + 1, 2, 3, c.ink); rect(g, x + 6, ly + 1, 2, 3, c.ink)
    }
    if (p > 0.55 && p < 1) {
      const k = (p - 0.55) / 0.45
      g.globalAlpha = o * (1 - k); g.strokeStyle = c.rail; g.lineWidth = 1
      g.beginPath(); g.ellipse(x, y + 2, 4 + k * 16, (4 + k * 16) * 0.4, 0, 0, 7); g.stroke()
    }
    g.globalAlpha = o
    return lift
  },
  ping(g, x, y, t, c) {
    // A distress beacon: rings out, a blinking light at the center.
    const o = g.globalAlpha
    g.strokeStyle = c.red_lt; g.lineWidth = 1
    for (const k of t ? [0, 0.5] : [0.4]) {
      const p = t ? (t * 0.7 + k) % 1 : k, rx = 5 + p * 18
      g.globalAlpha = o * (1 - p) * 0.9; g.beginPath(); g.ellipse(x, y + 2, rx, rx * 0.4, 0, 0, 7); g.stroke()
    }
    g.globalAlpha = o
    if (!t || Math.sin(t * 6) > -0.3) { glowAt(g, c.red_lt, x, y + 2, 7, 0.5); rect(g, x - 1, y + 2, 3, 1, c.red_lt); rect(g, x, y + 1, 1, 3, c.red_lt) }
  },
  bakeSky(g, w, h) {
    // Dust between the stations.
    for (let i = 0; i < (w * h) / 1400; i++) { g.globalAlpha = 0.18 + (i % 4) * 0.08; rect(g, (i * 137) % w, (i * 71 + (i >> 3)) % h, 1, 1, i % 7 ? '#c8d8ff' : '#ffc6e6') }
    g.globalAlpha = 1
  },
  bridgeBase(g, ax, ay, bx, by, w, c) {
    // A warp lane: a soft band of light, bowed a little.
    const [mx, my] = bow(ax, ay, bx, by)
    for (const [lw, a] of [[w + 7, 0.07], [w + 2, 0.12], [1, 0.45]] as const) {
      g.globalAlpha = a; g.strokeStyle = lw === 1 ? c.rail : c.blue_lt; g.lineWidth = lw
      g.beginPath(); g.moveTo(ax, ay + 3); g.quadraticCurveTo(mx, my + 3, bx, by + 3); g.stroke()
    }
    g.globalAlpha = 1
  },
  bridgeDeck(g, ax, ay, bx, by, w, c) {
    // Running lights along the lane, brighter every fourth.
    const [mx, my] = bow(ax, ay, bx, by), len = Math.hypot(bx - ax, by - ay) || 1, n = Math.floor(len / 5)
    for (let i = 1; i < n; i++) {
      const u = i / n, v = 1 - u, px = v * v * ax + 2 * u * v * mx + u * u * bx, py = v * v * ay + 2 * u * v * my + u * u * by + 3
      if (i % 4 === 0) { glowAt(g, c.rail, px, py, 4, 0.6); rect(g, px - (w > 5 ? 1 : 0), py, w > 5 ? 2 : 1, 1, '#ffffff') } else { g.globalAlpha = 0.7; rect(g, px, py, 1, 1, c.rail); g.globalAlpha = 1 }
    }
  },
  islandColors: (top, rim, c) => top === c.stone_dk ? { top: c.stone_dk, rim: c.stone, dot: c.stone_ln } : { top: c.stone, rim: c.roof_dk, dot: c.stone_ln },
  island(g, x, y, rx, ry, depth, top, rim, plaza, c) {
    const seed = Math.round(x * 3 + y * 7), moon = top === c.stone_dk, W = plaza ? CORE : moon ? MOON : WORLDS[seed % WORLDS.length]
    const drop = Math.round(Math.min(rx * 0.6, ry * 1.1 + depth)), rings = plaza ? ['#8a5a20', '#ffd27a', '#fff0c0'] : !moon && hash(seed, 3) < 0.4 ? [W.dk, W.lt, W.atm] : undefined
    world(g, x, y, rx, ry, drop, W, rings, seed, c, () => deck(g, x, y, rx, ry, top, rim, c.wood_lt, [c.roof_dk, c.wood], [c.rail, c.cloud, c.gold_lt], plaza, c))
  },
  hall(g, x, y, w, roof, _walls, tiers, beam, c) {
    const night = dark(c), L = Math.round(w * 0.34) + 6, pw = L - 5
    // Solar wings on trusses, behind the module.
    for (const px of [x - L, x + w + 5]) {
      const tx = px < x ? px + pw : x + w
      rect(g, tx, y + 13, 5, 3, c.ink); rect(g, tx, y + 14, 5, 1, c.roof_dk)
      rect(g, px - 1, y + 5, pw + 2, 13, c.ink); rect(g, px, y + 6, pw, 11, '#1a2c66')
      for (let i = 0; i < pw; i += 3) rect(g, px + i, y + 6, 1, 11, '#0c1640')
      rect(g, px, y + 11, pw, 1, '#0c1640'); rect(g, px, y + 6, pw, 1, '#4a7ae0')
      g.globalAlpha = night ? 0.25 : 0.45; for (let i = 0; i < 5; i++) rect(g, px + 1 + i + Math.round(pw * 0.2), y + 7 + i, 2, 1, '#bfe0ff'); g.globalAlpha = 1
    }
    // The module: a ribbed hull, a lit band in the owner's color, portholes, an airlock.
    rect(g, x - 3, y + 9, w + 6, 18, c.ink); rect(g, x - 2, y + 10, 2, 16, c.roof_dk); rect(g, x + w, y + 10, 2, 16, c.roof_dk)
    rect(g, x - 1, y + 7, w + 2, 22, c.ink); rect(g, x, y + 8, w, 20, c.hall); rect(g, x, y + 8, w, 2, c.roof_lt); rect(g, x, y + 22, w, 6, c.roof_dk)
    for (let i = 10; i < w - 4; i += 12) { g.globalAlpha = 0.5; rect(g, x + i, y + 10, 1, 12, c.roof_dk); g.globalAlpha = 1 }
    halo(g, beam, x + w / 2, y + 12, w / 2 + 8, 9, night ? 0.5 : 0.3)
    rect(g, x, y + 11, w, 2, beam)
    const door = x + Math.round(w / 2)
    for (let i = 4; i < w - 4; i += 7) {
      if (Math.abs(x + i + 1 - door) < 8) continue
      glowAt(g, c.gold_lt, x + i + 1, y + 17, 5, night ? 0.7 : 0.35)
      rect(g, x + i - 1, y + 15, 4, 4, c.ink); rect(g, x + i, y + 16, 2, 2, c.gold_lt)
    }
    rect(g, door - 5, y + 16, 10, 12, c.ink); rect(g, door - 4, y + 17, 8, 11, c.ink2); rect(g, door - 4, y + 17, 8, 1, beam); rect(g, door - 1, y + 19, 2, 7, c.roof_dk)
    // One upper module per rank, an antenna on the top one.
    let top = y + 8
    for (let t = 0; t < tiers; t++) {
      const mw = Math.round(w * (0.62 - t * 0.2)), mx = x + Math.round((w - mw) / 2), my = y + 1 - t * 8
      rect(g, mx - 1, my - 1, mw + 2, 9, c.ink); rect(g, mx, my, mw, 7, roof[0]); rect(g, mx, my, mw, 1, roof[2]); rect(g, mx, my + 5, mw, 2, roof[1])
      for (let i = 3; i < mw - 2; i += 5) rect(g, mx + i, my + 3, 1, 1, c.gold_lt)
      top = my - 1
    }
    const ax = x + Math.round(w / 2)
    rect(g, ax, top - 9, 1, 9, c.roof_lt); glowAt(g, c.red_lt, ax, top - 10, 6, 0.8); rect(g, ax - 1, top - 11, 3, 2, c.red_lt)
  },
  councilMast(g, hx, hy, c) {
    // A lattice comm tower with a dish.
    const x = hx - 52, top = hy - 50
    for (let yy = top; yy < hy + 2; yy++) { rect(g, x - 3, yy, 7, 1, c.ink); rect(g, x - 2, yy, 1, 1, c.roof_dk); rect(g, x + 2, yy, 1, 1, c.roof_dk); rect(g, x - 2 + ((yy - top) % 5), yy, 1, 1, c.roof) }
    g.fillStyle = c.ink; g.beginPath(); g.ellipse(x + 2, top - 1, 9, 4, -0.5, 0, 7); g.fill()
    g.fillStyle = c.roof_lt; g.beginPath(); g.ellipse(x + 2, top - 1, 8, 3, -0.5, 0, 7); g.fill()
    g.fillStyle = c.roof_dk; g.beginPath(); g.ellipse(x + 3, top, 5, 1.5, -0.5, 0, 7); g.fill()
    rect(g, x - 4, top - 6, 1, 5, c.roof_lt); glowAt(g, c.red_lt, x - 4, top - 7, 7, 0.9); rect(g, x - 5, top - 8, 3, 2, c.red_lt)
  },
}

// Control point that bows a lane sideways by a fraction of its length.
function bow(ax: number, ay: number, bx: number, by: number): [number, number] {
  const dx = bx - ax, dy = by - ay
  return [(ax + bx) / 2 - dy * 0.08, (ay + by) / 2 + dx * 0.08]
}
