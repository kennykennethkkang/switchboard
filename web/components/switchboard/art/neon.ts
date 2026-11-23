// Neon Harbor: rooftop platforms over a synthwave city. Islands are chamfered roofs on lit towers, halls are stacked blocks, bridges are light rails.
import type { CourtColors as C } from '@/lib/skins'
import { neon as skin } from '../../../lib/skins/neon'
import { NEON } from '../../../lib/court-cast'
import { bakeOnce, glow, glowAt, rect, tile, type G } from '../board-art'
import type { ArtKit, Realm } from './types'

const REALM_NEON: Record<string, Realm> = {
  claude: { top: '#24132e', rim: '#5a2350', dk: '#12081a', hi: '#ff6fb5', glow: '#ffd0e8' },
  codex: { top: '#0f1d33', rim: '#1d4a72', dk: '#070e1c', hi: '#4fe3ff', glow: '#c8f8ff' },
  jev: { top: '#14221a', rim: '#2f5a26', dk: '#0a120c', hi: '#b8ff5a', glow: '#ecffc8' },
  perplexity: { top: '#0b2228', rim: '#156060', dk: '#051214', hi: '#5dffe0', glow: '#d0fff6' },
  gemini: { top: '#171838', rim: '#3a3ea0', dk: '#0b0b22', hi: '#9aa8ff', glow: '#fff0c8' },
}
const nightOf = (c: C) => c.ink === skin.night!.court.colors.ink
// Cheap stable hash to 0..1, for window lights and skyline.
const hsh = (a: number, b: number) => { let n = (a * 374761393 + b * 668265263) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296 }
const WIN = ['#ffcf6a', '#ffcf6a', '#ffe9b0', '#ff7ac8']
const K = 0.36

// Chamfered octagon path; o shifts it half a pixel so 1px strokes land crisp.
function oct(g: G, x: number, y: number, rx: number, ry: number, o = 0) {
  const cx = Math.round(rx * K), cy = Math.round(ry * K), X = (v: number) => Math.round(x + v) + o, Y = (v: number) => Math.round(y + v) + o
  g.beginPath(); g.moveTo(X(-rx + cx), Y(-ry)); g.lineTo(X(rx - cx), Y(-ry)); g.lineTo(X(rx), Y(-ry + cy)); g.lineTo(X(rx), Y(ry - cy))
  g.lineTo(X(rx - cx), Y(ry)); g.lineTo(X(-rx + cx), Y(ry)); g.lineTo(X(-rx), Y(ry - cy)); g.lineTo(X(-rx), Y(-ry + cy)); g.closePath()
}
const poly = (g: G, pts: number[][], col: string) => { g.fillStyle = col; g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.fill() }

type Deck = { deck: string; line: string; trim: string; pat: 'grid' | 'check' | 'rings'; plaza: boolean; lit: string }
// A roof platform on a tower that fades into the haze, baked once per size and look; returns the canvas and its center.
function roof(rx: number, ry: number, H: number, d: Deck, c: C) {
  const pad = 18, ox = rx + pad, oy = ry + pad, n = nightOf(c)
  const cv = bakeOnce(`neon-roof${rx},${ry},${H},${d.deck}${d.trim}${d.pat}${d.plaza}${c.ink}`, ox * 2, oy * 2 + H, p => {
    const cx = Math.round(rx * K), cy = Math.round(ry * K), seed = rx * 31 + ry
    p.globalAlpha = n ? 0.55 : 0.36; p.drawImage(glow(d.trim, 32), 0, pad * 0.4, ox * 2, oy * 2); p.globalAlpha = 1
    // Tower faces under the deck: left catches the light, right falls away.
    const L = ox - rx, R = ox + rx, F0 = ox - rx + cx, F1 = ox + rx - cx, top = oy + ry, side = oy + ry - cy
    poly(p, [[L - 1, side], [F0, top + 1], [F1, top + 1], [R + 1, side], [R + 1, side + H], [F1, top + H + 1], [F0, top + H + 1], [L - 1, side + H]], c.ink)
    poly(p, [[L, side], [F0, top], [F0, top + H], [L, side + H]], c.azure)
    poly(p, [[F0, top], [F1, top], [F1, top + H], [F0, top + H]], c.azure_dk)
    poly(p, [[F1, top], [R, side], [R, side + H], [F1, top + H]], c.wood_dk)
    const on = n ? 0.42 : 0.3, win = (x: number, y: number, w: number) => { const r = hsh(x + seed, y); if (r < on) rect(p, x, y, w, 1, r < 0.05 ? d.lit : WIN[(r * 40) % 4 | 0]) }
    for (let wx = F0 + 3; wx < F1 - 3; wx += 4) for (let wy = top + 4; wy < top + H - 2; wy += 4) win(wx, wy, 2)
    for (let wx = L + 2; wx < F0 - 1; wx += 3) for (let wy = 4; wy < H; wy += 4) win(wx, Math.round(side + ((wx - L) / cx) * cy + wy), 1)
    for (let wx = F1 + 2; wx < R - 1; wx += 3) for (let wy = 4; wy < H; wy += 4) win(wx, Math.round(top - ((wx - F1) / cx) * cy + wy), 1)
    // Corner light strips run down the front edges.
    p.globalAlpha = 0.7; rect(p, F0, top + 2, 1, H * 0.6, d.trim); rect(p, F1 - 1, top + 2, 1, H * 0.6, d.trim); p.globalAlpha = 1
    p.globalCompositeOperation = 'destination-out'
    const fade = p.createLinearGradient(0, side + H * 0.3, 0, top + H + 1); fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(1, 'rgba(0,0,0,1)')
    p.fillStyle = fade; p.fillRect(0, side + H * 0.3, ox * 2, H + cy + 2); p.globalCompositeOperation = 'source-over'
    // Light spill from the trim onto the wall below it.
    p.strokeStyle = d.trim; p.globalAlpha = 0.22; p.lineWidth = 5
    p.beginPath(); p.moveTo(L, side + 3); p.lineTo(F0, top + 3); p.lineTo(F1, top + 3); p.lineTo(R, side + 3); p.stroke()
    // Deck: bloom, ink, fill, pattern, neon edge.
    p.globalAlpha = n ? 0.5 : 0.35; p.lineWidth = 5; oct(p, ox, oy, rx, ry); p.stroke(); p.globalAlpha = 1
    p.strokeStyle = c.ink; p.lineWidth = 2; oct(p, ox, oy, rx, ry); p.stroke()
    p.fillStyle = d.deck; oct(p, ox, oy, rx, ry); p.fill()
    p.save(); oct(p, ox, oy, rx - 2, ry - 2); p.clip()
    p.globalAlpha = 0.75
    if (d.pat === 'check') { for (let gx = -rx; gx < rx; gx += 5) for (let gy = -ry; gy < ry; gy += 5) if (((gx + gy) / 5) % 2 === 0) rect(p, ox + gx, oy + gy, 5, 5, d.line) }
    else if (d.pat === 'rings') { p.strokeStyle = d.line; p.lineWidth = 1; for (let i = 1; i < 5; i++) { oct(p, ox, oy, (rx * i) / 5, (ry * i) / 5, 0.5); p.stroke() } }
    else { for (let gx = -rx + 3; gx < rx; gx += 7) rect(p, ox + gx, oy - ry, 1, ry * 2, d.line); for (let gy = -ry + 3; gy < ry; gy += 5) rect(p, ox - rx, oy + gy, rx * 2, 1, d.line) }
    p.globalAlpha = 0.08; poly(p, [[ox - rx, oy - ry], [ox + rx * 0.3, oy - ry], [ox - rx, oy + ry * 0.5]], '#ffffff')
    if (d.plaza) {
      p.globalAlpha = 1; p.fillStyle = c.stone; oct(p, ox, oy, rx * 0.8, ry * 0.76); p.fill()
      for (let gy = -ry; gy < ry; gy += 4) rect(p, ox - rx, oy + gy, rx * 2, 1, c.stone_ln)
      p.strokeStyle = c.rail; p.lineWidth = 1; p.setLineDash([2, 2]); oct(p, ox, oy, rx * 0.8, ry * 0.76, 0.5); p.stroke(); p.setLineDash([])
    }
    p.restore()
    p.globalAlpha = 1; p.strokeStyle = d.trim; p.lineWidth = 1; oct(p, ox, oy, rx, ry, 0.5); p.stroke()
    p.globalAlpha = 0.35; oct(p, ox, oy, rx - 3, ry - 3, 0.5); p.stroke(); p.globalAlpha = 1
    // Corner beacons.
    for (const [vx, vy] of [[-rx + cx, -ry], [rx - cx, -ry], [rx, -ry + cy], [rx, ry - cy], [rx - cx, ry], [-rx + cx, ry], [-rx, ry - cy], [-rx, -ry + cy]]) {
      p.globalAlpha = 0.6; p.drawImage(glow(d.trim, 5), ox + vx - 5, oy + vy - 5); p.globalAlpha = 1; rect(p, ox + vx, oy + vy, 1, 1, '#ffffff')
    }
  })
  return { cv, ox, oy }
}
const put = (g: G, b: { cv: HTMLCanvasElement; ox: number; oy: number }, x: number, y: number) => g.drawImage(b.cv, Math.round(x - b.ox), Math.round(y - b.oy))

// Sky parts, each baked once per size and night.
function stars(w: number, h: number, n: boolean) {
  return bakeOnce(`neon-stars${n}${w | 0}${h | 0}`, w, h, p => {
    for (let i = 0; i < (n ? 110 : 40); i++) {
      const x = (i * 89 + 13) % w, y = (i * 47 + (i >> 2) * 7) % (h * 0.9)
      p.globalAlpha = 0.35 + hsh(i, 3) * 0.6; rect(p, x, y, 1, 1, i % 9 ? '#e8e2ff' : '#ff9fe0')
      if (i % 13 === 0) { rect(p, x - 1, y, 3, 1, '#e8e2ff'); rect(p, x, y - 1, 1, 3, '#e8e2ff') }
    }
  })
}
// Synthwave sun: hard color steps, slats widening toward the horizon. Only the part above the horizon.
const sun = () => bakeOnce('neon-sun', 112, 76, p => {
  const r = 56, steps = ['#fff3a8', '#ffd86a', '#ffb050', '#ff8a5a', '#ff5f86', '#ff4fb0']
  for (let y = 0; y < 76; y++) {
    const yy = y - r, f = y / 76, half = Math.sqrt(Math.max(0, r * r - yy * yy))
    if (y > 34 && (y - 34) % 6 < 1 + (y - 34) / 9) continue
    rect(p, 56 - half, y, half * 2, 1, steps[Math.min(5, Math.floor(f * 6))])
  }
})
const moon = () => bakeOnce('neon-moon', 24, 24, p => {
  p.fillStyle = '#f2ecff'; p.beginPath(); p.arc(12, 12, 10, 0, 7); p.fill()
  p.fillStyle = '#b8aee0'; for (const [x, y, r] of [[8, 9, 2], [14, 15, 1.5], [9, 16, 1]]) { p.beginPath(); p.arc(x, y, r, 0, 7); p.fill() }
  p.globalCompositeOperation = 'destination-out'; p.beginPath(); p.arc(17, 8, 9, 0, 7); p.fill()
})
// Skyline strip: towers with lit windows, neon blades and red beacons. near is darker and taller.
function city(n: boolean, near: boolean) {
  return bakeOnce(`neon-city${n}${near}`, 240, 72, p => {
    const body = near ? (n ? '#0c0620' : '#1d0e36') : n ? '#180c34' : '#3a1a5c', edge = n ? '#3a2470' : '#ff8a8a'
    for (let x = 0, i = 0; x < 240; i++) {
      const bw = 6 + Math.floor(hsh(i, near ? 7 : 9) * (near ? 14 : 10)), bh = (near ? 14 : 10) + Math.floor(hsh(i, 2) ** 1.6 * (near ? 52 : 40)), top = 72 - bh
      rect(p, x, top, bw, bh, body)
      p.globalAlpha = near ? 0.55 : 0.3; rect(p, x, top, bw, 1, edge); p.globalAlpha = 1
      if (near) {
        for (let wy = top + 3; wy < 70; wy += 3) for (let wx = x + 1; wx < x + bw - 1; wx += 2) { const r = hsh(wx, wy); if (r < (n ? 0.22 : 0.14)) rect(p, wx, wy, 1, 1, WIN[(r * 70) % 4 | 0]) }
        if (hsh(i, 5) < 0.3 && bh > 24) rect(p, x + 1, top + 5, 1, 10, hsh(i, 6) < 0.5 ? '#ff4fd8' : '#4fe3ff')
        if (bh > 44) { rect(p, x + (bw >> 1), top - 6, 1, 6, body); rect(p, x + (bw >> 1), top - 7, 1, 1, '#ff3050') }
      } else for (let wy = top + 4; wy < 70; wy += 4) for (let wx = x + 1; wx < x + bw - 1; wx += 3) if (hsh(wx, wy) < 0.08) { p.globalAlpha = 0.6; rect(p, wx, wy, 1, 1, '#ffb0e0'); p.globalAlpha = 1 }
      x += bw + (hsh(i, 4) < 0.25 ? 2 : 0)
    }
  })
}
const band = (key: string, col: string, a: number) => bakeOnce(key, 4, 48, p => {
  const gr = p.createLinearGradient(0, 0, 0, 48); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.55, col); gr.addColorStop(1, 'rgba(0,0,0,0)')
  p.globalAlpha = a; p.fillStyle = gr; p.fillRect(0, 0, 4, 48)
})
// Perspective grid rays, baked; the cross lines scroll per frame.
function rays(w: number, gh: number, col: string) {
  return bakeOnce(`neon-rays${col}${w | 0}${gh | 0}`, w, gh, p => {
    p.strokeStyle = col; p.lineWidth = 1
    for (let i = -24; i <= 24; i++) { p.globalAlpha = 0.55; p.beginPath(); p.moveTo(w / 2 + i * 6, 0); p.lineTo(w / 2 + i * 56, gh); p.stroke() }
    p.globalAlpha = 1; p.globalCompositeOperation = 'destination-out'
    const gr = p.createLinearGradient(0, 0, 0, gh); gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.5, 'rgba(0,0,0,0.2)'); gr.addColorStop(1, 'rgba(0,0,0,0)')
    p.fillStyle = gr; p.fillRect(0, 0, w, gh)
  })
}
// Hover car facing right, one per body color.
const car = (col: string, ink: string) => bakeOnce(`neon-car${col}${ink}`, 16, 7, p => {
  rect(p, 3, 0, 8, 3, ink); rect(p, 0, 2, 16, 4, ink)
  rect(p, 4, 1, 6, 2, '#2a2142'); rect(p, 5, 1, 2, 1, '#9ff4ff'); rect(p, 8, 1, 1, 1, '#9ff4ff')
  rect(p, 1, 3, 14, 2, col); rect(p, 1, 3, 14, 1, 'rgba(255,255,255,.35)'); rect(p, 2, 6, 12, 1, ink)
  rect(p, 15, 3, 1, 1, '#ffffff'); rect(p, 0, 4, 1, 1, '#ff3050')
})
const CARS = ['#ffb020', '#4fe3ff', '#ff4fd8', '#9a6bff']

// Done: a white flash, then sparks with hot heads and colored tails arcing out and falling.
function sparks(g: G, x: number, y: number, cheer: number, c: C) {
  const cols = [c.beam, c.red_lt, c.gold, c.jade_lt], cy = y - 10
  if (cheer < 0.15) { rect(g, x - 2, cy, 5, 1, c.cloud); rect(g, x, cy - 2, 1, 5, c.cloud) }
  for (let i = 0; i < 14; i++) {
    if (cheer > 0.85 && i % 2) continue
    const a = -Math.PI / 2 + (i - 6.5) * 0.36, r = cheer * (14 + (i % 3) * 5), len = Math.round(4 * (1 - cheer)), drop = cheer * cheer * 16
    const sx = x + Math.cos(a) * r, sy = cy + Math.sin(a) * r + drop
    for (let d = len; d >= 0; d--) rect(g, sx - Math.cos(a) * d, sy - Math.sin(a) * d, 1, 1, d ? cols[i % 4] : c.cloud)
  }
}
export const neon: Partial<ArtKit> = {
  confetti: sparks,
  realms: REALM_NEON,
  plate: 'rgba(12,8,26,.92)',
  helm: false,
  cast: NEON,
  realmShell(g, x, y, rx, ry, ai, R, c) {
    rx = Math.round(rx); ry = Math.round(ry)
    put(g, roof(rx, ry, Math.round(ry * 0.9) + 10, { deck: R.top, line: R.rim, trim: R.hi, pat: ai === 'jev' ? 'check' : ai === 'perplexity' ? 'rings' : 'grid', plaza: false, lit: R.hi }, c), x, y)
  },
  island(g, x, y, rx, ry, depth, top, rim, plaza, c) {
    rx = Math.round(rx); ry = Math.round(ry)
    // Night-market variety: each roof picks its trim from where it stands.
    const trim = plaza ? c.gold : top === c.stone_dk ? c.plum : [c.blue_lt, c.peach, c.plum][Math.abs(Math.round(x * 7 + y * 13)) % 3]
    put(g, roof(rx, ry, depth * 3 + 10, { deck: top, line: top === c.stone_dk ? c.stone_ln : c.wood_lt, trim, pat: 'grid', plaza, lit: trim }, c), x, y)
  },
  islandColors: (top, _rim, c) => ({ top: top === c.stone_dk ? c.stone_dk : c.wood, rim: c.blue_lt, dot: c.wood_lt }),
  hall(g, x, y, w, roofs, walls, tiers, beam, c) {
    const base = y + 27, cx = Math.round(x + w / 2), lift = tiers > 1
    const blocks: Array<[number, number, number]> = lift ? [[0, 1, 17], [0.16, 0.84, 10], [0.34, 0.66, 6]] : [[0, 1, 15], [0.2, 0.8, 8]]
    let top = base, sign: [number, number, number, number] = [0, 0, 0, 0]
    blocks.forEach(([a, b, h], i) => {
      const x0 = Math.round(x + w * a), x1 = Math.round(x + w * b), bw = x1 - x0, bt = top - h
      rect(g, x0 - 1, bt - 3, bw + 2, h + 3, c.ink); rect(g, x0, bt, bw, h, walls)
      rect(g, x0, bt, 1, h, roofs[2]); g.globalAlpha = 0.45; rect(g, x1 - 2, bt, 2, h, c.ink); g.globalAlpha = 1
      rect(g, x0, bt - 2, bw, 2, roofs[0]); rect(g, x0, bt - 2, bw, 1, roofs[2])
      for (let wy = bt + 3; wy < top - 2; wy += 3) for (let wx = x0 + 3; wx < x1 - 3; wx += 3) { const r = hsh(wx * 3 + i, wy); rect(g, wx, wy, 2, 1, r < 0.45 ? WIN[(r * 60) % 4 | 0] : r < 0.5 ? beam : roofs[1]) }
      if (i === 1) sign = lift ? [cx - 14, bt + 3, 28, 7] : [x1 + 1, bt - 6, 4, 16]
      top = bt - 2
    })
    // Holo sign in the hall's color, a soft bloom behind it.
    const [sx, sy, sw, sh] = sign
    glowAt(g, beam, sx + sw / 2, sy + sh / 2, lift ? 26 : 14, 0.55)
    rect(g, sx - 1, sy - 1, sw + 2, sh + 2, c.ink); rect(g, sx, sy, sw, sh, beam)
    g.globalAlpha = 0.55
    if (lift) for (let i = 2; i < sw - 2; i += 4) rect(g, sx + i, sy + 2, 2 + (i % 3), 3, c.ink)
    else for (let i = 2; i < sh - 1; i += 4) rect(g, sx + 1, sy + i, 2, 2, c.ink)
    g.globalAlpha = 0.6; rect(g, sx, sy, sw, 1, '#ffffff'); g.globalAlpha = 1
    // Antenna and a red beacon.
    rect(g, cx, top - 7, 1, 7, roofs[2]); glowAt(g, '#ff3050', cx + 0.5, top - 7, 6, 0.8); rect(g, cx, top - 8, 1, 1, '#ff6a80')
    // Lit doorway, its light spilling onto the roof.
    glowAt(g, beam, cx, base, 14, 0.4)
    rect(g, cx - 4, base - 8, 8, 8, c.ink); rect(g, cx - 3, base - 7, 6, 7, beam); rect(g, cx - 3, base - 7, 6, 1, '#ffffff')
  },
  councilMast(g, hx, hy, c) {
    // Lattice comm mast with a dish and a beacon.
    const x = hx - 52, t = hy - 50
    for (const dx of [0, 4]) rect(g, x + dx, t, 1, 52, c.ink)
    for (let yy = t + 2; yy < hy; yy += 4) { rect(g, x, yy, 5, 1, c.roof_lt); rect(g, x + 1 + ((yy >> 2) % 3), yy + 2, 1, 1, c.roof) }
    rect(g, x - 4, t + 10, 6, 4, c.ink); rect(g, x - 3, t + 11, 4, 2, c.cloud_sh)
    glowAt(g, '#ff3050', x + 2.5, t - 2, 9, 0.9); rect(g, x + 2, t - 3, 1, 2, '#ff6a80')
    // Street lamps either side of the hall.
    for (const lx of [hx - 40, hx + 40]) { rect(g, lx, hy - 14, 1, 16, c.ink); rect(g, lx - 1, hy - 15, 4, 2, c.ink); glowAt(g, c.blue_lt, lx + 1.5, hy - 13, 10, 0.6); rect(g, lx, hy - 14, 3, 1, '#c8f8ff') }
  },
  backdrop(g, w, h, t, px, c, n) {
    const hz = Math.round(h * 0.64), gh = h - hz + 2
    g.drawImage(stars(w, hz, n), 0, 0)
    if (n) {
      // Searchlights sweep from the skyline.
      for (const [bx, sp, ph] of [[0.22, 0.23, 0], [0.7, 0.17, 2]] as const) {
        const a = -Math.PI / 2 + Math.sin(t * sp + ph) * 0.5, x0 = w * bx - px * 0.05, L = hz
        g.globalAlpha = 0.06; g.fillStyle = '#b8a8ff'; g.beginPath(); g.moveTo(x0, hz); g.lineTo(x0 + Math.cos(a - 0.05) * L, hz + Math.sin(a - 0.05) * L); g.lineTo(x0 + Math.cos(a + 0.05) * L, hz + Math.sin(a + 0.05) * L); g.fill()
      }
      g.globalAlpha = 1
      const mx = w * 0.8 - px * 0.01, my = hz * 0.26
      glowAt(g, '#b8a8ff', mx, my, 46, 0.35); g.drawImage(moon(), Math.round(mx - 12), Math.round(my - 12))
    } else {
      // Off center so the council cluster never sits on the sun.
      const sx = w * 0.8 - px * 0.015
      glowAt(g, '#ff6a8a', sx, hz - 30, 130, 0.5); glowAt(g, '#ffd86a', sx, hz - 40, 70, 0.35)
      g.drawImage(sun(), Math.round(sx - 56), hz - 74)
    }
    tile(g, city(n, false), -px * 0.03, hz - 72, w)
    g.drawImage(band(`neon-hz${n}`, n ? '#c03cff' : '#ff8a6a', n ? 0.55 : 0.7), 0, hz - 30, w, 48)
    tile(g, city(n, true), -px * 0.07, hz - 70, w)
    const gc = n ? '#4fe3ff' : '#ff5fc8'
    g.globalAlpha = n ? 0.85 : 0.7; rect(g, 0, hz + 1, w, 1, n ? '#d070ff' : '#ffc0a0')
    g.drawImage(rays(w, gh, gc), 0, hz + 1)
    // Cross lines run toward the viewer; still under reduced motion.
    for (let i = 0; i < 12; i++) { const f = ((i + t * 0.6) % 12) / 12; g.globalAlpha = (n ? 0.75 : 0.6) * f; rect(g, 0, hz + 1 + gh * f ** 2.3, w, 1, gc) }
    g.globalAlpha = 1
    if (n) for (let i = 0; i < 70; i++) {
      // Rain, nearest fastest.
      const near = i % 4 === 0, y = ((i * 53 + t * (near ? 260 : 170)) % (h + 20)) - 10, x = ((i * 131 - px * (near ? 0.25 : 0.12) - y * 0.15) % w + w) % w
      g.globalAlpha = near ? 0.32 : 0.18; rect(g, x, y, 1, near ? 7 : 4, '#a8d8ff')
    }
    else for (let i = 0; i < 34; i++) {
      // Embers rise off the market.
      const sp = 6 + (i % 5) * 3, y = hz - ((t * sp + i * 37) % hz), x = ((i * 67 + Math.sin(t * 0.9 + i) * 4 - px * 0.1) % w + w) % w
      g.globalAlpha = 0.25 + 0.6 * (y / hz); rect(g, x, y, i % 6 ? 1 : 2, 1, i % 3 ? '#ffc86a' : '#ff7ac8')
    }
    g.globalAlpha = 1
  },
  drift(g, x, y, r, t, i, c) {
    const bob = Math.round(Math.sin(t * 1.6 + i) * 1.5)
    if (i % 3 === 0) {
      // A far drone: a dark speck with a blinking light.
      rect(g, x - 2, y + bob, 5, 2, c.ink); if (!t || (t * 1.5 + i) % 1 < 0.5) rect(g, x, y - 1 + bob, 1, 1, i % 2 ? '#ff3050' : '#5dffd6')
      return
    }
    const col = CARS[i % 4], yy = y + bob
    glowAt(g, col, x, yy + 6, 11, 0.35)
    for (let k = 1; k < 4; k++) { g.globalAlpha = 0.45 / k; rect(g, x - 8 - k * 5, yy + 1, 5, 1, '#ff3050') }
    g.globalAlpha = 1; g.drawImage(car(col, c.ink), Math.round(x - 8), Math.round(yy - 3))
    glowAt(g, '#fff2c0', x + 10, yy, 7, 0.4)
  },
  arrive(g, x, y, p, t, c) {
    // A cab drops in on a tractor beam, then lifts off as the runner steps out.
    const q = Math.min(1, p / 0.6), e = 1 - (1 - q) ** 3, lift = Math.round((1 - e) * 110), fade = p < 0.6 ? 1 : Math.max(0, 1 - (p - 0.6) / 0.3)
    const o = g.globalAlpha
    if (fade > 0) {
      g.globalAlpha = o * fade * 0.22; rect(g, x - 4, y - lift + 2, 8, lift + 2, c.blue_lt)
      g.globalAlpha = o * fade
      glowAt(g, c.gold, x, y - lift + 2, 16, 0.5); g.drawImage(car(c.gold, c.ink), Math.round(x - 8), y - lift - 2)
    }
    if (p > 0.55 && p < 1) {
      const k = (p - 0.55) / 0.45
      g.globalAlpha = o * (1 - k); g.strokeStyle = c.blue_lt; g.lineWidth = 1; oct(g, x, y + 2, 5 + k * 14, (5 + k * 14) * 0.42, 0.5); g.stroke()
    }
    g.globalAlpha = o
    return lift
  },
  ping(g, x, y, t, c) {
    // Magenta octagon pulses under the runner.
    const o = g.globalAlpha; g.strokeStyle = c.red_lt; g.lineWidth = 1
    for (const k of t ? [0, 0.5] : [0.4]) { const p = t ? (t * 0.7 + k) % 1 : k, rx = 6 + p * 18; g.globalAlpha = o * (1 - p) * 0.95; oct(g, x, y + 2, rx, rx * 0.42, 0.5); g.stroke() }
    g.globalAlpha = o * 0.9; rect(g, x - 1, y + 2, 3, 1, c.red_lt); g.globalAlpha = o
  },
  bakeSky(g, w, h) {
    // Haze motes between the roofs.
    for (let i = 0; i < (w * h) / 1800; i++) rect(g, (i * 137) % w, (i * 71 + (i >> 3)) % h, 1, 1, i % 6 ? 'rgba(170,150,255,.16)' : 'rgba(255,90,210,.3)')
  },
  bridgeBase(g, ax, ay, bx, by, w, c) {
    const trim = w > 5 ? c.gold : c.blue_lt
    for (const [lw, col, a] of [[w + 8, trim, 0.12], [w + 2, c.ink, 1], [w, c.wood_dk, 1]] as const) { g.globalAlpha = a; g.strokeStyle = col; g.lineWidth = lw; g.beginPath(); g.moveTo(ax, ay + 3); g.lineTo(bx, by + 3); g.stroke() }
    g.globalAlpha = 1
  },
  bridgeDeck(g, ax, ay, bx, by, w, c) {
    // Light rail: a deck, two neon edges, a bright dashed core and pulse nodes.
    const trim = w > 5 ? c.gold : c.blue_lt, len = Math.hypot(bx - ax, by - ay) || 1, nx = -(by - ay) / len, ny = (bx - ax) / len
    g.strokeStyle = c.wood; g.lineWidth = w - 2; g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke()
    g.lineWidth = 1; g.strokeStyle = trim
    for (const s of [1, -1]) { const ox = (nx * s * (w - 1)) / 2, oy = (ny * s * (w - 1)) / 2; g.globalAlpha = 0.85; g.beginPath(); g.moveTo(ax + ox, ay + oy); g.lineTo(bx + ox, by + oy); g.stroke() }
    g.globalAlpha = 0.7; g.strokeStyle = '#ffffff'; g.setLineDash([3, 6]); g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke(); g.setLineDash([])
    g.globalAlpha = 1
    for (let d = 10; d < len; d += 22) { const px = ax + ((bx - ax) * d) / len, py = ay + ((by - ay) * d) / len; glowAt(g, trim, px, py, 6, 0.7); rect(g, px - 1, py - 1, 2, 2, '#ffffff') }
  },
}
