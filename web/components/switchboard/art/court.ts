// Celestial Court: lacquer, cloud and lanterns. The default kit; a kit that leaves a hook out gets this one.
import type { CourtColors as C } from '@/lib/skins'
import { bakeOnce, cloud, ell, glowAt, lantern, puff, puffs, rect, ridgeBand, tile, type G } from '../board-art'
import type { ArtKit, Realm } from './types'

export const REALM: Record<string, Realm> = {
  codex: { top: '#2a3550', rim: '#48608e', dk: '#141b2c', hi: '#5ad1ff', glow: '#c4f2ff' },
  jev: { top: '#3b2d5e', rim: '#6c55a6', dk: '#1d1533', hi: '#b6f26e', glow: '#e6ffc4' },
  perplexity: { top: '#0e4a50', rim: '#1f8a92', dk: '#072a2e', hi: '#7ff0e6', glow: '#d8fffa' },
  gemini: { top: '#232a6e', rim: '#4b5fd0', dk: '#121640', hi: '#a9c1ff', glow: '#fff3c4' },
  claude: { top: '#5a2c1e', rim: '#b8603f', dk: '#2c140d', hi: '#f0a07a', glow: '#ffe2cf' },
}

function ridge(c: C, night: boolean) {
  const layers: Array<[string, number, number, number]> = night ? [[c.azure, 0.5, 34, 1], [c.azure_dk, 0.7, 20, 1.9]] : [[c.azure_lt, 0.3, 40, 1], [c.azure, 0.32, 22, 1.9]]
  // A pagoda on the far ridge.
  return ridgeBand(`court-ridge${night}${c.azure}${c.ink}`, layers, true, g => {
    g.globalAlpha = night ? 0.55 : 0.35; g.fillStyle = c.azure_dk; g.fillRect(52, 26, 5, 10); g.fillRect(50, 25, 9, 2); g.fillRect(51, 21, 7, 2); g.fillRect(53, 18, 3, 3)
  })
}
function sea(c: C, night: boolean) {
  return bakeOnce(`sea${night}${c.cloud}`, 200, 34, g => {
    g.globalAlpha = night ? 0.5 : 0.85
    for (let i = 0; i < 9; i++) { const s = 6 + ((i * 5) % 4) * 2; for (const [fill, dy] of [[c.cloud_sh, 2], [c.cloud, 0]] as const) { g.fillStyle = fill; for (const [dx, py, r] of puffs) { g.beginPath(); g.arc(i * 23 + dx * s, 18 + py * s + dy - (i % 3) * 3, r * s, 0, 7); g.fill() } } }
    g.fillStyle = c.cloud; g.fillRect(0, 24, 200, 10)
  })
}

// Done: peach blossom petals blown up off the pilgrim, then drifting down and thinning out.
function petals(g: G, x: number, y: number, cheer: number, c: C) {
  const cols = [c.peach_lt, c.peach, c.peach_dk, c.peach, c.cloud]
  for (let i = 0; i < 12; i++) {
    if (cheer > 0.8 && i % 2) continue
    const a = -Math.PI / 2 + (i - 5.5) * 0.27, r = 3 + cheer * (14 + (i % 3) * 3)
    const px = x + Math.cos(a) * r + Math.sin(cheer * 9 + i) * 2 * cheer, py = y - 12 + Math.sin(a) * r * 0.7 + cheer * cheer * 24
    if (i % 4 === 0) { rect(g, px, py, 1, 1, c.gold_lt); continue }
    const col = cols[i % cols.length], flip = Math.sin(cheer * 12 + i) > 0
    rect(g, px, py, 2, 1, col); rect(g, px + (flip ? 1 : 0), py + 1, 1, 1, c.peach_dk)
  }
}
export const court: ArtKit = {
  confetti: petals,
  realms: REALM,
  plate: '#3a2320',
  helm: false,
  res: 2,
  realmHalo: (g, x, y, rx, ry, R) => ell(g, x, y + 4, rx * 1.25, ry * 1.35, R.hi, 0.12),
  realmDeco: () => {},
  backdrop(g, w, h, t, px, c, night) {
    // Sun or moon, stars at night.
    const sx = w - 46, sy = 30
    if (night) {
      for (let i = 0; i < 36; i++) {
        if (t && (t * 0.9 + i * 0.37) % 1 < 0.12) continue
        const x = (i * 89 + 13) % w, y = (i * 47 + 5) % Math.max(20, h * 0.6)
        rect(g, x, y, 1, 1, c.cloud); if (i % 7 === 0) { rect(g, x - 1, y, 3, 1, c.cloud); rect(g, x, y - 1, 1, 3, c.cloud) }
      }
      glowAt(g, c.cloud, sx, sy, 30, 0.35)
      g.fillStyle = c.cloud; g.beginPath(); g.arc(sx, sy, 9, 0, 7); g.fill()
      g.fillStyle = c.cloud_sh; for (const [dx, dy, r] of [[-3, -2, 2], [3, 3, 1.5], [1, -4, 1]]) { g.beginPath(); g.arc(sx + dx, sy + dy, r, 0, 7); g.fill() }
      // The jade rabbit at its mortar.
      rect(g, sx - 2, sy + 1, 3, 2, c.jade_lt); rect(g, sx - 2, sy - 1, 1, 2, c.jade_lt); rect(g, sx + 2, sy + 2, 2, 1, c.jade_lt)
    } else {
      glowAt(g, c.gold_lt, sx, sy, 34, 0.4)
      const spin = t * 0.15
      for (let i = 0; i < 8; i++) { const a = spin + (i * Math.PI) / 4, l = 13 + (i % 2) * 3; rect(g, sx + Math.cos(a) * l - 1, sy + Math.sin(a) * l - 1, 2, 2, c.gold_lt) }
      g.fillStyle = c.gold_lt; g.beginPath(); g.arc(sx, sy, 9, 0, 7); g.fill(); g.fillStyle = c.gold; g.beginPath(); g.arc(sx + 1, sy + 1, 6, 0, 7); g.fill()
      // The three-legged golden crow.
      rect(g, sx - 2, sy - 1, 4, 2, c.red_dk); rect(g, sx + 2, sy - 2, 1, 1, c.red_dk)
    }
    // Far layers stay quiet by day so plates and badges keep their contrast.
    const o = g.globalAlpha; g.globalAlpha = night ? 1 : 0.7
    tile(g, ridge(c, night), -px * 0.05, h - 82, w)
    tile(g, sea(c, night), -px * 0.12 - t * 3, h - 34, w)
    g.globalAlpha = o
  },
  drift(g, x, y, r, t, i, c) {
    const far = i % 3 === 0
    puff(g, x, y, far ? r * 0.6 : r, c.cloud, c.cloud_sh, far ? 0.45 : 0.8)
  },
  arrive(g, x, y, p, t, c) {
    const q = Math.min(1, p / 0.6), e = 1 - (1 - q) ** 3, lift = Math.round((1 - e) * 110), fade = p < 0.6 ? 1 : Math.max(0, 1 - (p - 0.6) / 0.3)
    const o = g.globalAlpha
    if (fade > 0) {
      // Wukong's somersault cloud drops the chat in.
      g.globalAlpha = o * fade
      for (let k = 1; k < 4; k++) puff(g, x - 4, y - lift - 4 - k * 10, 5 - k, c.cloud, c.gold_lt, 0.6 / k)
      rect(g, x - 1, y - lift - 40, 1, 26, c.gold_lt)
      puff(g, x - 7, y - lift + 3, 5, c.cloud, c.gold_lt)
    }
    // Landing: a ring of puffs.
    if (p > 0.55 && p < 1) {
      const k = (p - 0.55) / 0.45
      g.globalAlpha = o * (1 - k)
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2, r = 5 + k * 12; rect(g, x + Math.cos(a) * r, y + 2 + Math.sin(a) * r * 0.4, 2, 2, c.cloud) }
    }
    g.globalAlpha = o
    return lift
  },
  ping(g, x, y, t, c) {
    // A red ripple on the court.
    const col = c.red_lt, o = g.globalAlpha
    g.strokeStyle = col; g.lineWidth = 1
    for (const k of t ? [0, 0.5] : [0.4]) {
      const p = t ? (t * 0.7 + k) % 1 : k, rx = 6 + p * 20
      g.globalAlpha = o * (1 - p) * 0.9; g.beginPath(); g.ellipse(x, y + 2, rx, rx * 0.42, 0, 0, 7); g.stroke()
    }
    g.globalAlpha = o
  },
  bakeSky(g, w, h, c) {
    for (let i = 0; i < (w * h) / 30000; i++) cloud(g, (i * 137) % w, (i * 71) % h, 8 + (i % 4) * 3, 'rgba(251,246,236,.45)', 'rgba(217,212,230,.3)')
  },
  bridgeBase(g, ax, ay, bx, by, w, c) {
    for (const [lw, col] of [[w + 2, c.ink], [w, c.wood]] as const) { g.strokeStyle = col; g.lineWidth = lw; g.beginPath(); g.moveTo(ax, ay + 3); g.lineTo(bx, by + 3); g.stroke() }
  },
  bridgeDeck(g, ax, ay, bx, by, w, c) {
    // Planks with red rail posts.
    const len = Math.hypot(bx - ax, by - ay) || 1, nx = -(by - ay) / len, ny = (bx - ax) / len
    for (let d = 0; d < len; d += 3) {
      const px = ax + ((bx - ax) * d) / len, py = ay + ((by - ay) * d) / len
      rect(g, px - (nx * w) / 2, py - (ny * w) / 2, 1, 1, c.wood_dk)
      if (d % 12 < 3) { rect(g, px + nx * (w / 2 + 1), py + ny * (w / 2 + 1) - 2, 1, 2, c.rail); rect(g, px - nx * (w / 2 + 1), py - ny * (w / 2 + 1) - 2, 1, 2, c.rail) }
    }
    g.strokeStyle = c.wood_lt; g.lineWidth = w - 2; g.setLineDash([2, 1]); g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke(); g.setLineDash([])
  },
  islandColors: (top, rim, c) => ({ top, rim, dot: c.jade_dk }),
  islandUnder(g, x, y, rx, ry, depth, c) {
    // The court's islands float on clouds.
    cloud(g, x - rx * 0.9, y + ry + depth * 0.6, ry * 0.4, c.cloud, c.cloud_sh); cloud(g, x + rx * 0.15, y + ry + depth * 0.9, ry * 0.45, c.cloud, c.cloud_sh)
  },
  islandTop: () => {},
  hallWalls(g, x, y, w, c) { for (let i = 0; i < w; i += 6) rect(g, x + i, y + 12, 1, 15, c.wood_dk) },
  hallRoof(g, x, y, w, tiers, roof, c) {
    for (let t = 0; t < tiers; t++) {
      const ty = y - t * 9, ex = 6 - t * 2
      rect(g, x - ex - 1, ty - 1, w + 2 * ex + 2, 10, c.ink); rect(g, x - ex, ty, w + 2 * ex, 8, roof[0])
      for (let i = x - ex; i < x + w + ex; i += 3) rect(g, i, ty + 3, 1, 5, roof[1])
      rect(g, x - ex, ty, w + 2 * ex, 1, roof[2]); rect(g, x - ex - 2, ty + 5, 3, 3, roof[0]); rect(g, x + w + ex - 1, ty + 5, 3, 3, roof[0])
    }
  },
  councilMast(g, hx, hy, c) {
    rect(g, hx - 52, hy - 46, 3, 48, c.ink); rect(g, hx - 51, hy - 45, 1, 46, c.gold)
    for (const yy of [hy - 46, hy - 2]) { rect(g, hx - 53, yy, 5, 4, c.ink); rect(g, hx - 52, yy + 1, 3, 2, c.red) }
    lantern(g, hx - 40, hy - 17, 0, c); lantern(g, hx + 40, hy - 17, 0, c)
  },
}
