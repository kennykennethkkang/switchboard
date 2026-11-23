// Dragon Palace of the East Sea: Ao Guang's crystal palace, where Wukong took the staff. Glazed pagodas, lacquer bridges, pearls, kelp and a dragon in the far water.
import type { CourtColors as C } from '@/lib/skins'
import { SEA } from '../../../lib/court-cast'
import { bakeOnce, ell, glowAt, rect, ridgeBand, tile, type G } from '../board-art'
import { court } from './court'
import type { ArtKit, Realm } from './types'

// Fixed palettes, not skin colors: the skin's reds also paint courtyards. Cool decks and halos per AI, the AI's accent on the rim lights.
const REALM_SEA: Record<string, Realm> = {
  codex: { top: '#163a52', rim: '#2f6f94', dk: '#0a2234', hi: '#5ad1ff', glow: '#c4f2ff' },
  jev: { top: '#1f3550', rim: '#47609a', dk: '#0e1a30', hi: '#b6f26e', glow: '#e6ffc4' },
  perplexity: { top: '#0c4248', rim: '#1f8a92', dk: '#062a2e', hi: '#7ff0e6', glow: '#d8fffa' },
  gemini: { top: '#1a2f60', rim: '#3f62b8', dk: '#0d1a3c', hi: '#a9c1ff', glow: '#fff3c4' },
  claude: { top: '#124a50', rim: '#2a8a8c', dk: '#08292e', hi: '#ff9fb8', glow: '#ffe0ea' },
}

// Light shafts from the surface, baked per night.
function shafts(c: C, night: boolean) {
  return bakeOnce(`abyss-shaft${night}${c.cloud}`, 180, 140, g => {
    for (const [x0, w, a] of [[10, 18, 0.1], [70, 10, 0.07], [120, 26, 0.09]]) {
      const gr = g.createLinearGradient(0, 0, 0, 140); gr.addColorStop(0, c.cloud); gr.addColorStop(1, 'rgba(0,0,0,0)')
      g.globalAlpha = night ? a * 0.35 : a; g.fillStyle = gr
      g.beginPath(); g.moveTo(x0, 0); g.lineTo(x0 + w, 0); g.lineTo(x0 + w + 40, 140); g.lineTo(x0 + 30, 140); g.fill()
    }
  })
}
// Kelp bed: two depths of blades with leaves and a rocky floor, baked once so the bed costs one drawImage per tile.
function kelp(c: C, night: boolean) {
  return bakeOnce(`abyss-kelp${night}${c.jade}`, 200, 78, g => {
    for (const [n, col, hi, a, top] of [[22, c.jade_dk, c.jade_dk, night ? 0.55 : 0.6, 10], [13, c.jade_dk, c.jade, 1, 26]] as const) {
      g.globalAlpha = a
      for (let i = 0; i < n; i++) {
        const bx = (i * 200) / n + ((i * 7) % 5), tall = 78 - top - ((i * 13) % 4) * 8, w = 2 + (i % 2)
        for (let s = 0; s < tall; s += 2) {
          const x = Math.round(bx + Math.sin(s * 0.11 + i) * s * 0.08)
          g.fillStyle = col; g.fillRect(x, 78 - s - 2, w, 2)
          if (s % 8 === 4) { g.fillStyle = hi; g.fillRect(x + (i % 2 ? w : -3), 78 - s - 2, 3, 1) }
        }
      }
    }
    g.globalAlpha = 1
    for (let x = 0; x < 200; x += 3) { const r = 2 + ((x * 7) % 5); g.fillStyle = c.ink; g.fillRect(x, 78 - r, 4, r); g.fillStyle = c.stone_dk; g.fillRect(x + 1, 78 - r, 2, 1) }
  })
}
function ridge(c: C) {
  // A sunken pagoda on the far reef.
  return ridgeBand(`abyss-ridge${c.azure_dk}${c.ink}`, [[c.azure_dk, 0.55, 30, 0.9], [c.ink, 0.7, 16, 1.7]], false, g => {
    g.globalAlpha = 0.5; g.fillStyle = c.azure_dk
    for (const [x, y, w] of [[132, 24, 13], [134, 19, 9], [136, 14, 5]]) { g.fillRect(x, y, w, 5); g.fillRect(x - 2, y, w + 4, 1) }
    g.fillRect(138, 10, 1, 4)
  })
}
// The East Sea dragon, far off, winding past; t 0 leaves it still.
function dragon(g: G, w: number, h: number, t: number, px: number, c: C, night: boolean) {
  const span = w + 200, hx = ((((t * 14 + w * 0.35 - px * 0.03) % span) + span) % span) - 100, hy = h * 0.3, o = g.globalAlpha
  g.globalAlpha = o * (night ? 0.32 : 0.22)
  for (let k = 30; k >= 0; k--) {
    const x = hx - k * 4, y = hy + Math.sin(t * 1.2 + k * 0.35) * 6, r = k < 2 ? 4 : Math.max(1, 3 - k / 14)
    rect(g, x - r, y - r, r * 2, r * 2, c.azure_dk); if (k % 4 === 2 && k < 26) rect(g, x - 1, y - r - 2, 2, 2, c.azure_dk)
  }
  const y = hy + Math.sin(t * 1.2) * 6
  rect(g, hx + 3, y - 2, 5, 4, c.azure_dk); rect(g, hx - 1, y - 8, 1, 4, c.azure_dk); rect(g, hx + 2, y - 7, 1, 3, c.azure_dk)
  for (let k = 0; k < 9; k++) rect(g, hx + 7 + k, y + 2 + Math.round(Math.sin(t * 2 + k * 0.6) * 1.5), 1, 1, c.azure_dk)
  g.globalAlpha = o
}

// Coral under an island rim.
export function coral(g: G, x: number, y: number, s: number, c: C) {
  for (const [dx, dy, r, col] of [[-1, 0, 1, c.peach_dk], [0.2, -0.4, 0.8, c.peach], [1.1, 0.1, 0.7, c.plum]] as const) { g.fillStyle = col; g.beginPath(); g.arc(x + dx * s, y + dy * s, r * s, 0, 7); g.fill() }
  for (let k = 0; k < 3; k++) rect(g, x - s + k * s, y + s * 0.6, 1, s * (1 + k * 0.4), c.jade_dk)
}
// A night-shining pearl with its glow.
function pearl(g: G, x: number, y: number, r: number, c: C) {
  glowAt(g, c.cloud, x, y, r * 5, 0.45)
  g.fillStyle = c.cloud_sh; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill()
  g.fillStyle = c.cloud; g.beginPath(); g.arc(x - r * 0.25, y - r * 0.25, r * 0.7, 0, 7); g.fill()
}

// Done: a column of bubbles wobbling up from the guest, popping into dots at the top.
function bubbles(g: G, x: number, y: number, cheer: number, c: C) {
  const cols = [c.cloud, c.jade_lt, c.blue_lt]
  for (let i = 0; i < 9; i++) {
    const k = cheer * 1.25 - (i % 3) * 0.12
    if (k <= 0 || k >= 1) continue
    const bx = Math.round(x + (i - 4) * 2.5 + Math.sin(k * 8 + i * 1.9) * 2), by = Math.round(y - 8 - k * (24 + (i % 4) * 5)), col = cols[i % 3]
    if (k > 0.88) { for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2]]) rect(g, bx + dx, by + dy, 1, 1, col); continue }
    const s = 1 + (i % 2) + (k > 0.45 ? 1 : 0)
    rect(g, bx + 1, by, s, 1, col); rect(g, bx + 1, by + s + 1, s, 1, col); rect(g, bx, by + 1, 1, s, col); rect(g, bx + s + 1, by + 1, 1, s, col)
    rect(g, bx + 1, by + 1, 1, 1, c.cloud)
  }
}
export const abyss: Partial<ArtKit> = {
  confetti: bubbles,
  realms: REALM_SEA,
  plate: '#0a2a2c',
  helm: false,
  cast: SEA,
  realmHalo: (g, x, y, rx, ry, R) => ell(g, x, y + 4, rx * 1.25, ry * 1.35, R.rim, 0.12),
  realmDeco(g, x, y, rx, ry, R, c) {
    // A string of pearls round the deck edge, every third lit in the realm's hue.
    for (let i = 0, m = Math.max(10, Math.round(rx / 5)); i < m; i++) { const a = (i / m) * Math.PI * 2, px = x + Math.cos(a) * rx * 0.88, py = y + Math.sin(a) * ry * 0.8; rect(g, px - 1, py - 1, 3, 3, c.cloud_sh); rect(g, px - 1, py - 1, 2, 2, i % 3 ? c.cloud : R.hi) }
  },
  backdrop(g, w, h, t, px, c, night) {
    tile(g, shafts(c, night), -px * 0.04 + Math.sin(t * 0.3) * 6, 0, w)
    dragon(g, w, h, t, px, c, night)
    tile(g, ridge(c), -px * 0.06, h - 64, w)
    tile(g, kelp(c, night), -px * 0.1, h - 78, w)
    // A few near strands sway in front of the bed, nearest fastest.
    for (let i = 0; i < 9; i++) {
      const bx = (((i * w) / 9 + 11 - px * 0.15) % w + w) % w, tall = 30 + ((i * 13) % 5) * 8
      for (let s = 0; s < tall; s += 3) {
        const x = bx + Math.sin(t * 1.1 + i + s * 0.09) * s * 0.12
        rect(g, x, h - s - 3, 3, 3, c.jade); if (s % 9 === 6) rect(g, x + (i % 2 ? 3 : -3), h - s - 2, 3, 1, c.jade_lt)
      }
    }
    for (let i = 0; i < 18; i++) {
      const sp = 6 + (i % 5) * 3, y = h - ((t * sp + i * 41) % (h + 16)), x = ((i * 53 + Math.sin(t * 1.3 + i) * 3 - px * 0.1) % w + w) % w, big = i % 4 === 0
      g.globalAlpha = 0.55; rect(g, x, y, big ? 3 : 2, big ? 3 : 2, c.cloud_sh); g.globalAlpha = 0.9; rect(g, x, y, 1, 1, c.cloud); g.globalAlpha = 1
    }
    // Plankton glints in the dark water.
    if (night) for (let i = 0; i < 22; i++) { if (t && (t * 0.7 + i * 0.29) % 1 > 0.55) continue; rect(g, (i * 71 + 17) % w, (i * 37 + 9) % (h - 40), 1, 1, i % 3 ? c.jade_lt : c.peach) }
  },
  drift(g, x, y, r, t, i, c) {
    // Every third is a golden carp swimming for the Dragon Gate, the rest jellyfish.
    if (i % 3 === 1) {
      const y0 = y + Math.round(Math.sin(t * 1.6 + i) * 2), flick = t && Math.sin(t * 6 + i) > 0 ? 1 : 0
      rect(g, x - 6, y0 - 2 - flick, 3, 2, c.peach); rect(g, x - 6, y0 + 1 + flick, 3, 2, c.peach)
      rect(g, x - 4, y0 - 2, 9, 5, c.ink); rect(g, x - 3, y0 - 2, 7, 4, c.gold); rect(g, x - 3, y0 + 1, 7, 1, c.red); rect(g, x - 1, y0 - 3, 3, 1, c.peach)
      rect(g, x + 2, y0 - 1, 1, 1, c.ink); rect(g, x - 1, y0 - 1, 1, 1, c.gold_lt)
      return
    }
    const bob = Math.round(Math.sin(t * 1.4 + i) * 3), y0 = y + bob, sq = t && Math.sin(t * 2.8 + i) > 0.3 ? 1 : 0, col = i % 2 ? c.peach : c.blue_lt
    glowAt(g, col, x, y0, 14, 0.4)
    rect(g, x - 3, y0 - 4 + sq, 7, 1, col); rect(g, x - 4, y0 - 3 + sq, 9, 3 - sq, col); rect(g, x - 2, y0 - 3 + sq, 2, 1, c.cloud)
    for (let k = 0; k < 4; k++) for (let j = 0; j < 4; j++) rect(g, x - 3 + k * 2 + Math.round(Math.sin(t * 3 + j * 0.8 + k) * 0.8), y0 + j * 2, 1, 2, col)
  },
  arrive(g, x, y, p, t, c) {
    // A dragon pearl sinks to the deck, bubbles rising off it.
    const q = Math.min(1, p / 0.6), e = 1 - (1 - q) ** 3, lift = Math.round((1 - e) * 110), fade = p < 0.6 ? 1 : Math.max(0, 1 - (p - 0.6) / 0.3)
    const o = g.globalAlpha
    if (fade > 0) {
      g.globalAlpha = o * fade
      for (let k = 1; k < 6; k++) rect(g, x - 4 + ((k * 5) % 9) + Math.sin(t * 6 + k) * 1.5, y - lift - 18 - k * 7, 2, 2, c.cloud_sh)
      pearl(g, x, y - lift + 2, 4, c)
      g.strokeStyle = c.gold; g.lineWidth = 1; g.beginPath(); g.arc(x, y - lift + 2, 6, t * 3, t * 3 + 4.4); g.stroke()
    }
    // Landing: a burst of bubbles.
    if (p > 0.55 && p < 1) {
      const k = (p - 0.55) / 0.45
      g.globalAlpha = o * (1 - k)
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2, r = 5 + k * 12; rect(g, x + Math.cos(a) * r, y + 2 + Math.sin(a) * r * 0.4 - k * 10, 2, 2, c.cloud_sh) }
    }
    g.globalAlpha = o
    return lift
  },
  ping(g, x, y, t, c) {
    // The court's ripple, then a pearl glint.
    court.ping(g, x, y, t, c)
    const o = g.globalAlpha; g.globalAlpha = o * 0.8; rect(g, x - 1, y + 2, 2, 1, c.red_lt); g.globalAlpha = o
  },
  bakeSky(g, w, h, c) {
    // Marine snow under the sea.
    for (let i = 0; i < (w * h) / 900; i++) rect(g, (i * 137) % w, (i * 71 + (i >> 3)) % h, 1, 1, i % 5 ? 'rgba(200,240,255,.18)' : 'rgba(111,245,207,.35)')
  },
  islandColors(top, rim, c) {
    // Deep teal decks, kelp trailing under them.
    if (top === c.jade) { top = c.jade_dk; rim = c.jade }
    return { top, rim, dot: c.jade }
  },
  islandUnder(g, x, y, rx, ry, depth, c) {
    for (let k = 0; k < 4; k++) rect(g, x - rx * 0.45 + k * rx * 0.3, y + ry + depth - 2, 1, 5 + (k % 2) * 4, c.jade_dk)
  },
  islandTop(g, x, y, rx, ry, c) {
    coral(g, x - rx * 0.8, y + ry * 0.25, 2.5, c); coral(g, x + rx * 0.78, y - ry * 0.05, 3, c)
  },
  hallRoof(g, x, y, w, tiers, roof, c) {
    // Glazed pagoda tiers with a pearl on the ridge.
    court.hallRoof(g, x, y, w, tiers, roof, c)
    pearl(g, x + w / 2, y - (tiers - 1) * 9 - 3, 2.5, c)
  },
  councilMast(g, hx, hy, c) {
    // The sea-calming pillar: black iron, a gold hoop at each end, the staff before Wukong took it.
    glowAt(g, c.gold_lt, hx - 51, hy - 22, 26, 0.3)
    rect(g, hx - 54, hy - 50, 7, 54, c.ink); rect(g, hx - 53, hy - 49, 5, 52, c.ink2); rect(g, hx - 52, hy - 49, 1, 52, c.stone)
    for (const yy of [hy - 52, hy - 2]) { rect(g, hx - 55, yy, 9, 6, c.ink); rect(g, hx - 54, yy + 1, 7, 4, c.gold); rect(g, hx - 54, yy + 1, 7, 1, c.gold_lt) }
    pearl(g, hx - 40, hy - 14, 3, c); pearl(g, hx + 40, hy - 14, 3, c)
  },
}
