// Lantern Sea cast, anime ink style: tall figures, tapered brush lines, hard cel shade, warm lantern rim on the left.
// Feet space: origin at the feet, y up is negative, head center near (0, -50). Baked at 12 frames, so moves are
// built from windup, one fast strike frame, hold, recover. All colors are 6-digit hex.
import type { CourtColors as C } from '@/lib/skins'
import type { G } from '../board-art'
import type { Keeper, KeeperStyle } from './keeper-style'

const PI = Math.PI, TAU = PI * 2
const rgb = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const mix = (a: string, b: string, k: number) => {
  const x = rgb(a), y = rgb(b)
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * k).toString(16).padStart(2, '0')).join('')
}
const rgba = (h: string, a: number) => { const [r, g, b] = rgb(h); return `rgba(${r},${g},${b},${cl(a)})` }
const cl = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v))
const lerp = (a: number, b: number, k: number) => a + (b - a) * k
const eo = (k: number) => 1 - (1 - cl(k)) ** 3
const ei = (k: number) => cl(k) ** 3
const eio = (k: number) => { k = cl(k); return k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2 }
const RIM = '#ffc866', SHD = '#080d2a', WHT = '#ffffff'

type P = (g: G) => void
// Cel fill: base, one hard shadow crescent (lower right), one hard warm rim crescent (left), inked outline heavier low-right.
function cel(g: G, path: P, base: string, c: C, o: { w?: number; sh?: number; rim?: number; d?: number } = {}) {
  const w = o.w ?? 1.2, sh = o.sh ?? 0.45, rim = o.rim ?? 0.75, d = o.d ?? 2.4
  const at = (dx: number, dy: number) => { g.save(); g.translate(dx, dy); path(g); g.restore() }
  g.lineJoin = g.lineCap = 'round'
  g.beginPath(); path(g); g.fillStyle = base; g.fill()
  g.save(); g.beginPath(); path(g); g.clip()
  g.beginPath(); g.rect(-60, -100, 120, 120); at(-d, -d * 0.6); g.fillStyle = mix(base, SHD, sh); g.fill('evenodd')
  if (rim > 0) { g.beginPath(); g.rect(-60, -100, 120, 120); at(1.3, 0.1); g.fillStyle = rgba(RIM, rim); g.fill('evenodd') }
  g.restore()
  g.strokeStyle = c.ink; g.lineWidth = w; g.beginPath(); path(g); g.stroke()
  g.lineWidth = w * 0.8; g.beginPath(); at(0.45, 0.55); g.stroke()
}
const poly = (pts: number[]): P => g => { g.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]); g.closePath() }
const circ = (x: number, y: number, r: number): P => g => { g.moveTo(x + r, y); g.arc(x, y, r, 0, TAU) }
const ell = (x: number, y: number, rx: number, ry: number, a = 0): P => g => { g.moveTo(x + rx * Math.cos(a), y + rx * Math.sin(a)); g.ellipse(x, y, rx, ry, a, 0, TAU) }
// Brush stroke along a polyline, width w0 to w1.
const ribbon = (pts: number[], w0: number, w1: number): P => g => {
  const n = pts.length / 2, L: number[] = [], R: number[] = []
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1), dx = pts[b * 2] - pts[a * 2], dy = pts[b * 2 + 1] - pts[a * 2 + 1], d = Math.hypot(dx, dy) || 1
    const w = lerp(w0, w1, i / (n - 1)) / 2, nx = -dy / d * w, ny = dx / d * w
    L.push(pts[i * 2] + nx, pts[i * 2 + 1] + ny); R.unshift(pts[i * 2] - nx, pts[i * 2 + 1] - ny)
  }
  const all = [...L, ...R]; g.moveTo(all[0], all[1]); for (let i = 2; i < all.length; i += 2) g.lineTo(all[i], all[i + 1]); g.closePath()
}
const bez = (x0: number, y0: number, cx: number, cy: number, x1: number, y1: number, n = 7) => {
  const o: number[] = []
  for (let i = 0; i <= n; i++) { const t = i / n, a = (1 - t) ** 2, b = 2 * (1 - t) * t, d = t * t; o.push(a * x0 + b * cx + d * x1, a * y0 + b * cy + d * y1) }
  return o
}
const stroke = (g: G, col: string, w: number, pts: number[]) => {
  g.strokeStyle = col; g.lineWidth = w; g.lineCap = g.lineJoin = 'round'; g.beginPath(); g.moveTo(pts[0], pts[1])
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]); g.stroke()
}
const inkRibbon = (g: G, c: C, col: string, pts: number[], w0: number, w1: number, o = {}) => cel(g, ribbon(pts, w0, w1), col, c, { w: 1, ...o })
const star = (g: G, x: number, y: number, r: number, col: string) => {
  if (r <= 0) return
  g.fillStyle = col; g.beginPath(); g.moveTo(x, y - r); g.quadraticCurveTo(x, y, x + r, y); g.quadraticCurveTo(x, y, x, y + r)
  g.quadraticCurveTo(x, y, x - r, y); g.quadraticCurveTo(x, y, x, y - r); g.fill()
}
// Curved speed line: thin tapered streak.
const streak = (g: G, col: string, x0: number, y0: number, x1: number, y1: number, w: number) => { g.fillStyle = col; g.beginPath(); ribbon([x0, y0, (x0 + x1) / 2, (y0 + y1) / 2, x1, y1], w, 0.2)(g); g.fill() }
const rot = (a: number, x: number, y: number): [number, number] => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]

// Spiky hair crown around (cx, cy): n points across the top, tips lag with sway.
const spikes = (cx: number, cy: number, r: number, n: number, len: number, sway: number, a0 = -PI * 1.02, a1 = 0.02): number[] => {
  const o: number[] = []
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), a = lerp(a0, a1, t), l = len * (0.7 + 0.5 * ((i * 0.618) % 1)), vr = r
    o.push(cx + Math.cos(a - 0.09) * vr, cy + Math.sin(a - 0.09) * vr * 1.05)
    o.push(cx + Math.cos(a) * (r + l) + sway * (l / len) * 1.6, cy + Math.sin(a) * (r + l) * 1.05 + Math.abs(sway) * 0.3)
    o.push(cx + Math.cos(a + 0.09) * vr, cy + Math.sin(a + 0.09) * vr * 1.05)
  }
  return o
}

type Eyes = 'open' | 'sleep' | 'happy' | 'wince' | 'wide' | 'side'
type Pose = { dx: number; dy: number; rot: number; tilt: number; hl: [number, number]; hr: [number, number]; pa: number; eyes: Eyes; mouth: 'flat' | 'o' | 'smile' | 'grin' | 'frown'; brow: number; a: number; sw: number; tuck: number; hit: number }

// Strike curve: windup (0..1), snap past zero, hold, ease home.
const strike = (u: number) => u < 0.45 ? eio(u / 0.45) : u < 0.52 ? lerp(1, -0.3, eo((u - 0.45) / 0.07)) : u < 0.72 ? -0.3 : lerp(-0.3, 0, eio((u - 0.72) / 0.28))
const leap = (u: number) => u < 0.2 ? -0.35 * eio(u / 0.2) : u < 0.62 ? Math.sin(PI * (u - 0.2) / 0.42) : u < 0.72 ? -0.25 * Math.sin(PI * (u - 0.62) / 0.1) : 0
const hop = (u: number) => Math.max(0, Math.sin(PI * ((u * 2) % 1)))

type Look = { skin: string; hair: string; hi: string; eye: string; coat: string; coat2: string; trim: string; pants: string; boot: string; hw: number; hy: number; fl: number }
const LOOK: Record<Keeper, Look> = {
  lead: { skin: '#f1cfb5', hair: '#2b3156', hi: '#6d7cc0', eye: '#4fb4e8', coat: '#27386e', coat2: '#1a2650', trim: '#e8b84a', pants: '#161d3a', boot: '#0f1226', hw: 11, hy: -8, fl: 1.2 },
  engineer: { skin: '#efc29b', hair: '#d8602a', hi: '#ffb06a', eye: '#ffb02e', coat: '#7a4a2e', coat2: '#e9d6b8', trim: '#e8a02e', pants: '#3a2a2a', boot: '#241612', hw: 8.5, hy: -17, fl: 0.6 },
  qa: { skin: '#e6c6b2', hair: '#c9d6ee', hi: '#ffffff', eye: '#9fe8ff', coat: '#27407a', coat2: '#1b2c58', trim: '#8ec8ff', pants: '#141c38', boot: '#0e1226', hw: 12, hy: -5, fl: 1.6 },
  designer: { skin: '#f8d8c0', hair: '#a35ad8', hi: '#e08aff', eye: '#ff7ad1', coat: '#f0e2cc', coat2: '#d8c4a8', trim: '#ff7ad1', pants: '#3a2a4e', boot: '#2a1e3a', hw: 10, hy: -11, fl: 1 },
  researcher: { skin: '#efd0c0', hair: '#e2e8ff', hi: '#ffffff', eye: '#ffd34e', coat: '#2c2f7e', coat2: '#3e44a8', trim: '#ffd34e', pants: '#1a1c4a', boot: '#10123a', hw: 12, hy: -5, fl: 1.4 },
  ops: { skin: '#d4a074', hair: '#1c1c2a', hi: '#4a4a6a', eye: '#e8c060', coat: '#6f7a3e', coat2: '#565f2e', trim: '#d9b85a', pants: '#2a2a30', boot: '#161618', hw: 12, hy: -9, fl: 1 },
  growth: { skin: '#fbe9dc', hair: '#fff4ec', hi: '#ffffff', eye: '#ff7a3a', coat: '#fff4ec', coat2: '#ff7a3a', trim: '#ff9a5a', pants: '#ff7a3a', boot: '#a8481e', hw: 9, hy: -12, fl: 1.2 },
  pilgrim: { skin: '#f4d2b4', hair: '#8a5a2e', hi: '#d8a05a', eye: '#6fe0c8', coat: '#e8b858', coat2: '#c8943a', trim: '#26b59b', pants: '#3a3050', boot: '#241a2a', hw: 9, hy: -10, fl: 1.2 },
}
// Prop reach above and below the hand (up, down) and the point that glows, in prop space.
const REACH: Record<Keeper, [number, number, number]> = { lead: [50, 24, -42], engineer: [20, 8, -16], qa: [14, 4, -8], designer: [24, 12, -22], researcher: [20, 8, -13], ops: [40, 36, -22], growth: [8, 0, -6], pilgrim: [4, 15, 9] }
const BASE: Record<Keeper, { hl: [number, number]; hr: [number, number]; pa: number }> = {
  lead: { hl: [-7, -21], hr: [9, -22], pa: 0.05 }, engineer: { hl: [-7, -21], hr: [8, -23], pa: -0.5 }, qa: { hl: [-8, -22], hr: [8, -30], pa: 0.9 },
  designer: { hl: [-7, -22], hr: [8, -26], pa: 0.5 }, researcher: { hl: [-7, -22], hr: [8, -30], pa: 0.1 }, ops: { hl: [10, -36], hr: [9, -26], pa: -0.14 },
  growth: { hl: [-8, -20], hr: [8, -20], pa: 0 }, pilgrim: { hl: [-7, -21], hr: [7, -21], pa: 0 },
}

function poseOf(role: Keeper, state: string | undefined, u: number): Pose {
  const s = (k: number, ph = 0) => Math.sin(TAU * (u * k + ph))
  const B = BASE[role]
  const p: Pose = { dx: 0, dy: 0, rot: 0, tilt: 0, hl: [...B.hl], hr: [...B.hr], pa: B.pa, eyes: 'open', mouth: 'flat', brow: 0, a: 0, sw: s(1, -0.12) * 0.5, tuck: 0, hit: 0 }
  switch (state) {
    case 'working': working(role, u, p); break
    case 'needs': {
      const w = s(2), up = Math.abs(s(2, 0.25))
      Object.assign(p, { dy: -up * 1.4, rot: -0.03, tilt: w * 0.08, hr: [10 + w * 2.5, -62 - up * 1.5], hl: [-8, -26], pa: 0.15 + w * 0.2, eyes: 'wide', mouth: 'o', brow: 1, a: up, sw: w })
      break
    }
    case 'done': {
      const h = hop(u), j = Math.sin(PI * ((u * 2) % 1))
      Object.assign(p, { dy: -h * 9, tilt: s(2) * 0.1, hr: [11, -58 - h * 2], hl: [-11, -58 - h * 2], pa: 0.2 + s(2) * 0.2, eyes: 'happy', mouth: 'grin', brow: 1, a: j, sw: -h, tuck: h })
      break
    }
    case 'stuck': {
      const j = s(6), j2 = s(5)
      Object.assign(p, { dx: j * 1.3, dy: Math.abs(j2) * -0.6, rot: j2 * 0.04, tilt: j * 0.1, hl: [-5.5, -52 + j], hr: [5.5, -52 - j], pa: j * 0.3, eyes: 'wince', mouth: 'frown', brow: -1, a: j, sw: j })
      break
    }
    case 'waiting': {
      const blink = u > 0.82 && u < 0.9
      Object.assign(p, { dy: s(1) * 0.4, tilt: s(1) * 0.05, eyes: blink ? 'sleep' : (u > 0.3 && u < 0.6 ? 'side' : 'open'), mouth: 'smile' })
      break
    }
    default: {
      // Sleepy: slow breath, head drooping, shoulders low.
      Object.assign(p, { dy: 0.8 + s(1) * 0.3, rot: 0.04, tilt: 0.2 + Math.max(0, s(1, -0.1)) * 0.1, eyes: 'sleep', mouth: 'flat', brow: -0.5, sw: s(1, -0.1) * 0.3 })
    }
  }
  return p
}

function working(role: Keeper, u: number, p: Pose) {
  const s = (k: number, ph = 0) => Math.sin(TAU * (u * k + ph))
  const a = strike(u), up = Math.max(0, a), hit = u > 0.5 && u < 0.72 ? 1 - (u - 0.5) / 0.22 : 0
  p.a = a; p.hit = hit; p.sw = (u >= 0.45 && u < 0.6 ? -1.2 : 0.3) + s(1, -0.1) * 0.3
  switch (role) {
    case 'lead': Object.assign(p, { dy: -up * 1.2, rot: -a * 0.05, hr: [9 + up * 3, lerp(-26, -50, up)], hl: [-2, lerp(-30, -40, up)], pa: -0.05 - a * 0.1, eyes: 'open', mouth: a < 0 ? 'o' : 'smile', brow: 0.4 }); break
    case 'engineer': Object.assign(p, { dx: -a * 1.5, dy: a < 0 ? 1 : 0, rot: -a * 0.06, hr: [lerp(11, 8, up), lerp(-23, -52, up)], hl: [13, -22], pa: lerp(1.5, -0.7, up), eyes: 'open', mouth: a < 0 ? 'o' : 'flat', brow: -0.5 + (a < 0 ? 1 : 0) }); break
    case 'qa': Object.assign(p, { dx: s(1) * 0.8, tilt: s(1) * 0.06, hr: [10, -52], hl: [-6, -26], pa: 0.15, eyes: 'open', mouth: 'flat', brow: -0.4, a: s(1) }); break
    case 'designer': {
      const t = eio(u / 0.7)
      Object.assign(p, { dx: t * 1.5, rot: -t * 0.06, tilt: 0.05, hr: [paintAt(t)[0] - 10.5, paintAt(t)[1] + 19.3], hl: [-6, -26], pa: 0.5, eyes: 'open', mouth: 'smile', brow: 0.4, a: t })
      break
    }
    case 'researcher': Object.assign(p, { dy: s(2) * 0.4, tilt: -0.08, hr: [9, -52], hl: [-9, -50 + s(2) * 2], pa: 0.1, eyes: 'wide', mouth: 'o', brow: 0.6, a: u }); break
    case 'ops': Object.assign(p, { dx: up * -1 + -a * 2, rot: -a * 0.1, hr: [9 + up * 1.5, -26], hl: [10, -36 + up * 2], pa: lerp(-0.1, -0.42, up) + (a < 0 ? 0.2 : 0), eyes: 'open', mouth: 'flat', brow: -0.3 }); break
    case 'growth': {
      const l = leap(u)
      Object.assign(p, { dy: -Math.max(0, l) * 14, rot: l > 0 ? Math.sin(PI * (u - 0.2) / 0.42) * -0.35 : 0, hr: [12, -46], hl: [-12, -46], eyes: 'happy', mouth: 'grin', brow: 0.5, tuck: Math.max(0, l), a: l })
      break
    }
    default: Object.assign(p, { dy: -Math.abs(s(2)) * 0.8, hr: [9, -50 + s(1) * 4], hl: [-8, -30], pa: s(1) * 0.9, eyes: 'wide', mouth: 'smile', brow: 0.5, a: s(1) })
  }
}
const paintAt = (t: number): [number, number] => [10 + 17 * t, -60 + Math.sin(t * PI * 1.5) * 7]

function arm(g: G, c: C, sx: number, hx: number, hy: number, L: Look, role: Keeper) {
  const sy = -40, l1 = 11.5, l2 = 11.5, dx = hx - sx, dy = hy - sy, d = Math.min(Math.hypot(dx, dy) || 0.01, l1 + l2 - 0.3), a = Math.atan2(dy, dx)
  const ang = Math.acos(cl((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1)), out = Math.sign(sx)
  const cand = [a + ang, a - ang].map(e => [sx + Math.cos(e) * l1, sy + Math.sin(e) * l1])
  const [ex, ey] = cand[0][0] * out > cand[1][0] * out ? cand[0] : cand[1], px = sx + Math.cos(a) * d, py = sy + Math.sin(a) * d
  const sl = role === 'growth' ? L.coat2 : role === 'engineer' ? L.coat2 : role === 'designer' ? L.coat : L.coat
  if (role === 'growth') {
    // Fin sleeve: wide flared panel with ray lines, hanging off the forearm.
    const fx = ex + (px - ex) * 0.5, fy = ey + (py - ey) * 0.5
    cel(g, poly([ex, ey - 1.5, px + out * 6, py + 3, fx + out * 9, fy + 9, px - out * 1, py + 6, ex - out * 2, ey + 2]), '#ff9a5a', c, { w: 1, d: 2 })
    for (const k of [0.3, 0.55, 0.8]) stroke(g, c.ink, 0.5, [ex, ey, lerp(ex, px + out * 6, k) + out * k * 4, lerp(ey, py + 6, k) + k * 3])
  }
  inkRibbon(g, c, sl, [sx, sy, ex, ey], 5, 4.4)
  if (role === 'engineer') inkRibbon(g, c, L.skin, [ex, ey, px, py], 3.8, 3, { sh: 0.3 })
  else inkRibbon(g, c, sl, [ex, ey, px, py], 4.4, 3.4)
  cel(g, circ(px, py, 2.1), L.skin, c, { w: 0.9, sh: 0.3, rim: 0.4, d: 1.2 })
  if (role !== 'growth' && role !== 'engineer') stroke(g, L.trim, 1, [ex + (px - ex) * 0.72 - 1.7, ey + (py - ey) * 0.72 + 0.3, ex + (px - ex) * 0.72 + 1.7, ey + (py - ey) * 0.72 - 0.3])
}

function legs(g: G, c: C, p: Pose, L: Look, role: Keeper) {
  const lw = p.tuck * 5
  for (const sd of [-1, 1]) {
    const hx = sd * 2.2, ax = sd * (3.1 + (role === 'growth' ? 0 : 0.4)) + sd * lw * 0.3, ay = -3.2 - lw
    const kx = sd * 3.4 + sd * lw * 0.5, ky = -14 - lw * 0.5
    inkRibbon(g, c, L.pants, [hx, -26, kx, ky, ax, ay], 4.6, 3.1, { d: 1.8 })
    // Boot: pointed toe, cuff.
    cel(g, poly([ax - 2.4, ay - 3, ax + 2.4, ay - 3, ax + 2.6, ay + 1.6, ax + sd * 4.6, ay + 3.4 + lw, ax - sd * 0.8, ay + 3.4 + lw]), L.boot, c, { w: 1, d: 1.2 })
    stroke(g, L.trim, 0.8, [ax - 2.4, ay - 2.4, ax + 2.4, ay - 2.4])
  }
}

// Behind the body: capes, long hair, tails.
function back(g: G, role: Keeper, p: Pose, u: number, c: C, L: Look) {
  const f = p.sw, s = (k: number, ph = 0) => Math.sin(TAU * (u * k + ph))
  const hx = 0, hy = -50
  if (role === 'lead') cel(g, poly([-5, -41, -9 + f * 3, -22, -12 + f * 7, -6, -5 + f * 6, -9, 0 + f * 4, -4, 6 + f * 5, -9, 12 + f * 7, -6, 9 + f * 3, -22, 5, -41]), '#141c44', c)
  if (role === 'qa') cel(g, poly([-5, -41, -10 + f * 3, -22, -15 + f * 8, -3, -8 + f * 6, -7, -3 + f * 6, -1, 3 + f * 6, -6, 9 + f * 7, -2, 14 + f * 8, -4, 10 + f * 3, -22, 5, -41]), '#16224a', c)
  if (role === 'researcher') cel(g, poly([-5, -41, -10 + f * 3, -20, -14 + f * 6, -5, 14 + f * 6, -5, 10 + f * 3, -20, 5, -41]), '#1c1e5c', c)
  if (role === 'ops') cel(g, poly([-5, -41, -11, -24, -13 + f * 4, -9, 13 + f * 4, -9, 11, -24, 5, -41]), '#565f2e', c)
  if (role === 'engineer') cel(g, poly([hx - 6, hy - 2, hx - 11 + f * 2, hy - 9, hx - 8, hy - 3, hx - 12 + f * 3, hy + 2, hx - 6, hy + 4]), L.hair, c, { w: 0.9 })
  if (role === 'designer') {
    // Long ponytail with a whip tail.
    const pts = bez(-2, -56, -13 + f * 4, -52 + s(2) * 2, -15 + f * 9, -30 + s(2, 0.2) * 3, 8)
    inkRibbon(g, c, L.hair, pts, 5.4, 0.8, { sh: 0.4 })
    stroke(g, L.hi, 0.8, bez(-3, -56, -12 + f * 4, -52, -13 + f * 8, -38, 6))
  }
  if (role === 'researcher') {
    for (const sd of [-1, 1]) inkRibbon(g, c, L.hair, bez(sd * 4, -55, sd * 10 + f * 2, -44, sd * 8 + f * 7, -24 + s(2, sd * 0.1) * 2, 7), 4.6, 0.8, { sh: 0.3 })
  }
  if (role === 'growth') {
    // Koi tail ribbon off the obi plus long back hair.
    const w = f * 4 + s(2) * 2
    cel(g, poly([-2, -27, -9, -24 + w, -17 + w, -30 + w, -14 + w, -20 + w, -19 + w, -12 + w, -10, -16 + w * 0.5, -2, -20]), '#ff7a3a', c, { w: 1 })
    inkRibbon(g, c, L.hair, bez(-3, -55, -11 + f * 3, -48, -10 + f * 7, -34, 6), 4.4, 0.8, { sh: 0.25 })
  }
  if (role === 'pilgrim') cel(g, poly([-5, -41, -10, -24, -12 + f * 3, -12, 12 + f * 3, -12, 10, -24, 5, -41]), L.coat2, c)
}

function coat(g: G, role: Keeper, p: Pose, c: C, u: number, L: Look) {
  const f = p.sw * L.fl, hw = L.hw, hy = L.hy
  const m = hy - 1.5
  const body: P = g => {
    g.moveTo(-6.6, -41); g.lineTo(6.6, -41); g.quadraticCurveTo(7, -33, 4.6, -27)
    g.quadraticCurveTo(hw * 0.7 + f, (hy - 27) / 2 - 24, hw + f * 3, hy)
    g.lineTo(hw * 0.5 + f * 2, m - 3); g.lineTo(f * 1.5, m + 0.5); g.lineTo(-hw * 0.5 + f * 2, m - 3); g.lineTo(-hw + f * 3, hy)
    g.quadraticCurveTo(-hw * 0.7 + f, (hy - 27) / 2 - 24, -4.4, -27); g.quadraticCurveTo(-7, -33, -6.6, -41); g.closePath()
  }
  const base = role === 'growth' || role === 'engineer' ? L.coat : L.coat
  if (role === 'engineer') {
    cel(g, poly([-5.4, -41, 5.4, -41, 5, -26, -5, -26]), L.coat2, c, { sh: 0.3 })
  }
  cel(g, body, base, c, { d: 3 })
  switch (role) {
    case 'lead':
      cel(g, poly([-1.8, -41, 1.8, -41, 3, -9, -3, -9]), '#eef2ff', c, { w: 0.8, sh: 0.2, rim: 0 })
      cel(g, poly([-5.6, -41, -1.8, -41, -3, -34, -0.5, -29]), L.coat2, c, { w: 0.9 }); cel(g, poly([5.6, -41, 1.8, -41, 3, -34, 0.5, -29]), L.coat2, c, { w: 0.9 })
      cel(g, poly([-5.8, -26.5, 5.8, -26.5, 5.4, -23.5, -5.4, -23.5]), L.trim, c, { w: 0.8, sh: 0.3 })
      for (const y of [-37, -31, -20, -14]) { g.fillStyle = L.trim; g.beginPath(); g.arc(0, y, 0.8, 0, TAU); g.fill() }
      for (const sd of [-1, 1]) cel(g, poly([sd * 3, -41.5, sd * 8.2, -40.6, sd * 8, -39, sd * 3.2, -39.5]), L.trim, c, { w: 0.7, sh: 0.2 })
      break
    case 'engineer':
      cel(g, poly([-5, -40, -2, -40, 4, -24, 1, -24]), '#5a3220', c, { w: 0.8, sh: 0.3 })
      cel(g, poly([-5.4, -26, 5.4, -26, 5.6, -22, -5.6, -22]), '#3a2418', c, { w: 0.8, sh: 0.2, rim: 0.3 })
      cel(g, poly([-3.2, -21, 3.2, -21, 3.4, -15, -3.4, -15]), '#5a3220', c, { w: 0.8, sh: 0.3 })
      break
    case 'qa': {
      cel(g, poly([-5.6, -41, 5.6, -41, 3, -34, 0, -33, -3, -34]), L.coat2, c, { w: 0.9 })
      stroke(g, L.trim, 0.9, [-4.6, -38, -1, -32]); stroke(g, L.trim, 0.9, [4.6, -38, 1, -32])
      break
    }
    case 'designer':
      for (const [x, y, col] of [[-3, -33, '#ff7ad1'], [3, -26, '#6ff0c2'], [-4, -19, '#ffd34e'], [4, -35, '#8ec8ff'], [1, -14, '#ff7ad1']] as const) { g.fillStyle = col; g.beginPath(); g.ellipse(x, y, 1.6, 1.1, 0.5, 0, TAU); g.fill() }
      cel(g, poly([-5.4, -41, 5.4, -41, 4.6, -38, -4.6, -38]), L.trim, c, { w: 0.8 })
      break
    case 'researcher': {
      cel(g, poly([-5.6, -41, -3, -45, 0, -41, 3, -45, 5.6, -41, 4, -38, -4, -38]), L.coat2, c, { w: 0.9 })
      star(g, -2.5, -33, 1.6, '#ffd34e'); star(g, 2.8, -26, 1.3, '#fff0c8'); star(g, -3.4, -19, 1.1, '#8ec8ff'); star(g, 3.4, -14, 1, '#fff0c8')
      stroke(g, rgba('#ffd34e', 0.8), 0.5, [-2.5, -33, 2.8, -26, -3.4, -19, 3.4, -14])
      cel(g, poly([-5.4, -26, 5.4, -26, 5.2, -23.6, -5.2, -23.6]), L.trim, c, { w: 0.7, sh: 0.2 })
      stroke(g, L.trim, 0.9, [-hw + 1.5, hy + 2, hw - 1.5, hy + 2])
      break
    }
    case 'ops': {
      cel(g, poly([-6, -41, 6, -41, 4, -33, 0, -29, -4, -33]), L.coat2, c, { w: 0.9 })
      for (let i = 0; i < 6; i++) { const x = -hw + 2 + i * ((hw * 2 - 4) / 5) + f * 3; cel(g, poly([x - 1.4, hy - 1, x + 1.4, hy - 1, x + 0.3 + f * 1.5, hy + 3]), '#a89a4a', c, { w: 0.6, sh: 0.3, rim: 0.3 }) }
      cel(g, poly([-4.4, -26, 4.4, -26, 4.4, -23.6, -4.4, -23.6]), '#3a2a18', c, { w: 0.7 })
      break
    }
    case 'growth': {
      for (let r = 0; r < 4; r++) for (let i = 0; i < 3 - (r === 3 ? 1 : 0); i++) { const x = -3.6 + i * 3.6 + (r % 2) * 1.8, y = -37 + r * 3.6; g.strokeStyle = rgba('#ff7a3a', 0.9); g.lineWidth = 0.7; g.beginPath(); g.arc(x, y, 1.8, 0, PI); g.stroke() }
      cel(g, poly([-5.4, -27, 5.4, -27, 5.6, -22.6, -5.6, -22.6]), '#ff7a3a', c, { w: 0.9, sh: 0.3 })
      cel(g, poly([4, -27, 8, -29, 7, -25.6, 9, -22, 4.5, -22.8]), '#ff9a5a', c, { w: 0.8 })
      break
    }
    default:
      cel(g, poly([-5.4, -29, 5.4, -29, 5.6, -26, -5.6, -26]), L.trim, c, { w: 0.8 })
      cel(g, poly([-5.6, -41, 5.6, -41, 3, -36, -3, -36]), L.trim, c, { w: 0.8 })
  }
}

// Scarf or sash tail that streams behind with the sway.
function tails(g: G, role: Keeper, p: Pose, u: number, c: C, L: Look) {
  const f = p.sw, s = Math.sin(TAU * (u * 2 - 0.2))
  if (role === 'qa' || role === 'pilgrim' || role === 'designer') {
    const col = role === 'qa' ? '#8ec8ff' : role === 'pilgrim' ? '#26b59b' : '#ff7ad1', n = role === 'designer' ? 0.7 : 1
    inkRibbon(g, c, col, bez(-3, -40, -13 + f * 6, -37 + s * 2, -22 + f * 10 * n, -31 + s * 4, 8), 3.4, 0.6, { sh: 0.4 })
    cel(g, poly([-4.6, -41.5, 4.6, -41.5, 4, -38.6, -4, -38.6]), col, c, { w: 0.8 })
  }
}

function eyes(g: G, p: Pose, c: C, L: Look) {
  const y = 0.6, gap = 2.6
  for (const sd of [-1, 1]) {
    const ex = sd * gap, inn = ex - sd * 1.5, out = ex + sd * 2.1
    switch (p.eyes) {
      case 'open': case 'wide': case 'side': {
        const ox = p.eyes === 'side' ? 0.6 : 0, k = p.eyes === 'wide' ? 1.2 : 1
        g.fillStyle = WHT; g.beginPath(); g.ellipse(ex, y + 0.2, 1.8, 1.4 * k, 0, 0, TAU); g.fill()
        g.fillStyle = L.eye; g.beginPath(); g.ellipse(ex + ox, y + 0.2, 1.05, 1.45 * k, 0, 0, TAU); g.fill()
        g.fillStyle = c.ink; g.beginPath(); g.ellipse(ex + ox, y + 0.3, 0.55, 0.9 * k, 0, 0, TAU); g.fill()
        g.fillStyle = WHT; g.beginPath(); g.arc(ex + ox - 0.4, y - 0.5, 0.45, 0, TAU); g.fill()
        // Dark upper lash line with a flick at the outer corner.
        g.fillStyle = c.ink; g.beginPath(); ribbon([inn, y + 0.3, ex, y - 1.5 * k, out, y - 1.3 * k, out + sd * 0.9, y - 2.2 * k], 1.5, 0.3)(g); g.fill()
        break
      }
      case 'happy': stroke(g, c.ink, 1.2, [inn, y + 0.8, ex, y - 0.6, out, y + 0.8]); break
      case 'wince': stroke(g, c.ink, 1.1, [ex - sd * 1.8, y - 1.4, ex + sd * 1.5, y + 0.2, ex - sd * 1.8, y + 1.6]); break
      default: g.fillStyle = c.ink; g.beginPath(); ribbon([inn, y + 0.2, ex, y + 0.9, out, y + 0.3], 1.2, 0.3)(g); g.fill()
    }
    const by = y - 3.3 - p.brow * 0.9, sl = p.brow < 0 ? 1 : -0.4 * p.brow
    g.fillStyle = mix(L.hair, c.ink, 0.6); g.beginPath(); ribbon([ex - sd * 2 - sd * sl * 0.5, by + sl * 0.2, ex + sd * 0.4, by, ex + sd * 2.2, by + (p.brow < 0 ? 0.9 : 0.3 + p.brow * 0.3)], 0.2, 0.9)(g); g.fill()
  }
  const my = 4.2
  g.strokeStyle = c.ink; g.fillStyle = c.ink; g.lineWidth = 0.9; g.beginPath()
  switch (p.mouth) {
    case 'o': g.ellipse(0, my + 0.3, 0.9, 1.3, 0, 0, TAU); g.fill(); break
    case 'grin': g.moveTo(-2.3, my - 0.5); g.quadraticCurveTo(0, my + 3, 2.3, my - 0.5); g.closePath(); g.fill(); g.fillStyle = WHT; g.fillRect(-1.5, my - 0.4, 3, 0.7); break
    case 'smile': g.moveTo(-1.6, my); g.quadraticCurveTo(0, my + 1.2, 1.9, my - 0.4); g.stroke(); break
    case 'frown': g.moveTo(-1.8, my + 1); g.quadraticCurveTo(0, my - 0.8, 1.8, my + 1); g.stroke(); break
    default: g.moveTo(-1.1, my + 0.2); g.lineTo(1.1, my + 0.1); g.stroke()
  }
  g.fillStyle = rgba('#2a1a2a', 0.35); g.beginPath(); g.moveTo(-0.3, 2.4); g.lineTo(0.5, 2.9); g.lineTo(-0.2, 3); g.fill()
}

// Head space: center at origin, face about 11 wide, 13 tall, sharp jaw.
function head(g: G, role: Keeper, p: Pose, c: C, u: number, L: Look) {
  const f = p.sw, s = Math.sin(TAU * (u * 2 - 0.15))
  cel(g, poly([-5.2, -4.5, 5.2, -4.5, 5.6, 1, 3.6, 4.8, 0, 7, -3.6, 4.8, -5.6, 1]), L.skin, c, { w: 1.1, sh: 0.3, rim: 0.7, d: 1.8 })
  cel(g, poly([-1.6, 5.4, 1.6, 5.4, 1.4, 8.8, -1.4, 8.8]), mix(L.skin, SHD, 0.2), c, { w: 0.8, sh: 0.3, rim: 0, d: 0.8 })
  eyes(g, p, c, L)
  // Hair and headgear, front.
  const hs = (k: number) => f * k + s * 0.4
  const cap = (fr: number[], col = L.hair) => cel(g, poly([-6.2, 3, -6.9, -4, -3.6, -8, 3.6, -8, 6.9, -4, 6.2, 3, ...fr]), col, c, { w: 1.1, d: 2 })
  const shine = (pts: number[]) => stroke(g, rgba(L.hi, 0.85), 0.9, pts)
  switch (role) {
    case 'lead':
      cap([5.4, -1.5, 3.6, -3.4, 2.2, -1.2, 0.6, -3.6, -1, -1, -3.4, -3.8 + hs(0.4), -5.4, 0])
      cel(g, poly([-1, -4, 0.4 + hs(1.5), -2, -0.4 + hs(3), 4.6, -2.4, -1.2]), L.hair, c, { w: 0.8 })
      cel(g, poly([-7.6, -4.2, -6.2, -9.6, -3, -12.4, 3, -12.4, 6.2, -9.6, 7.6, -4.2, 4, -5.4, -4, -5.4]), '#2b3a82', c)
      cel(g, poly([-8.4, -4.2, 8.4, -4.2, 11.6, -1.6, 0, -2.6, -11.6, -1.6]), '#141c44', c, { w: 1 })
      cel(g, poly([-7.4, -6.8, 7.4, -6.8, 7.6, -5, -7.6, -5]), L.trim, c, { w: 0.7, sh: 0.2 })
      cel(g, circ(0, -8.6, 1.6), L.trim, c, { w: 0.7, sh: 0.2 })
      break
    case 'engineer':
      cel(g, poly(spikes(0, -2, 6.4, 6, 8, hs(2))), L.hair, c, { w: 1, d: 2 })
      cap([5.4, -2, 4, 0, 2.4, -3, 1, 0, -1, -3.6, -2.6, -0.4, -4.6, -3, -5.6, 0.4])
      shine([-3, -7.4, 0, -8.2, 3, -7])
      cel(g, rrect(-7, -6.6, 14, 2.6, 1), '#3a2a2a', c, { w: 0.9 })
      for (const sd of [-1, 1]) { cel(g, circ(sd * 3.6, -5.4, 2.7), '#2a3a5a', c, { w: 1, d: 1.2 }); g.fillStyle = '#9fe8ff'; g.beginPath(); g.arc(sd * 3.6, -5.4, 1.5, 0, TAU); g.fill(); g.fillStyle = WHT; g.fillRect(sd * 3.6 - 0.9, -6.3, 0.9, 0.9) }
      break
    case 'qa': {
      // Hood: pointed peak, deep brow shadow, glowing eyes stay clear.
      cel(g, poly([-8.8, 9, -8.8, -3, -6, -9.5, -1, -14.5 + hs(-0.4), 5, -10, 8.8, -3, 8.8, 9, 6.6, 7, 6.6, -1, 4.8, -5.6, 0, -6.6, -4.8, -5.6, -6.6, -1, -6.6, 7]), '#2a407e', c, { d: 3 })
      cel(g, poly([-5, -5.6, 0, -6.8, 5, -5.6, 5, -3.6, 0, -4.6, -5, -3.6]), '#0e1430', c, { w: 0.6, sh: 0, rim: 0 })
      for (const sd of [-1, 1]) { g.fillStyle = rgba(L.eye, 0.35); g.beginPath(); g.arc(sd * 2.6, 0.8, 2.6, 0, TAU); g.fill() }
      eyes(g, p, c, L)
      break
    }
    case 'designer':
      cap([5.6, -1.6, 3.8, -3.6, 2, -1, 0.2, -3.8, -2, -1.2, -4, -3.4, -5.8, 0.6])
      cel(g, poly([-4.8, -5.4, 0, -4.6, hs(3) + 4.6, 1, 3, -2.2, -2, -5.2]), L.hair, c, { w: 0.8 })
      shine([-3.4, -7.2, 0, -8, 3.4, -6.8])
      cel(g, ell(3.6, -8.4, 7.2, 2.6, -0.2), '#e0508a', c, { w: 1, d: 1.6 }); cel(g, circ(4, -11, 1.4), '#e0508a', c, { w: 0.8, d: 1 })
      break
    case 'researcher':
      cap([5.6, -1.6, 3.8, -3.4, 2.4, -0.8, 0.6, -3.8, -1.2, -1, -3.4, -3.6, -5.8, 0.4])
      cel(g, poly([4, -1, 6.4 + hs(1), 5, 3.4, 2.6]), L.hair, c, { w: 0.8 }); cel(g, poly([-4, -1, -6.4 + hs(1), 5, -3.4, 2.6]), L.hair, c, { w: 0.8 })
      shine([-3.4, -7.2, 0, -8, 3.4, -6.8])
      star(g, 0, -6.2, 1.8, '#ffd34e'); star(g, -4.6, -5, 1, '#fff0c8')
      break
    case 'ops':
      cap([5.4, -1.6, 4, -2.6, 0, -1.4, -4, -2.6, -5.4, -1.6], L.hair)
      // Straw hat: wide cone, woven ribs, chin cord.
      cel(g, poly([-17, -2, -8, -8.6, -3, -16, 3, -16, 8, -8.6, 17, -2, 10, -3.6, 0, -5.2, -10, -3.6]), '#d9b85a', c, { d: 3 })
      g.strokeStyle = mix('#d9b85a', '#7a5a1a', 0.55); g.lineWidth = 0.6
      for (const x of [-9, -4.5, 0, 4.5, 9]) { g.beginPath(); g.moveTo(x * 0.3, -15.4); g.lineTo(x * 1.7, -3.8); g.stroke() }
      stroke(g, c.ink, 0.6, [-6, -4.4, -5, 4, -3.4, 6.4]); stroke(g, c.ink, 0.6, [6, -4.4, 5, 4, 3.4, 6.4])
      break
    case 'growth': {
      // White hair with orange streaks and a fin crest that flicks.
      cel(g, poly([-1.2, -7, 0 + hs(1), -17 - Math.abs(s) * 1.2, 1.6, -7, 3.6 + hs(1.6), -14, 4, -6, 6 + hs(1.4), -10, 5.6, -4, -4, -6, -3.6 + hs(1), -13, -3, -5.6]), '#ff7a3a', c, { w: 1, d: 1.6 })
      cap([5.6, -1.6, 4.2, -3.6, 2.6, -0.6, 0.8, -4, -1, -0.8, -3, -3.8, -4.8, -2, -5.8, 0.4])
      cel(g, poly([-1.4, -8, 2.4, -8, 1.4, -2.8, -0.4, -3.6]), '#ff7a3a', c, { w: 0.7, sh: 0.3 })
      shine([-3.6, -7, 0, -8, 3, -7])
      break
    }
    default:
      cel(g, poly(spikes(0, -2, 6.4, 5, 4.6, hs(1.4))), L.hair, c, { w: 1, d: 2 })
      cap([5.6, -1.6, 4, -3.2, 2.2, -0.8, 0.6, -3.8, -1.4, -0.4, -3.2, -3.4, -5.8, 0.2])
      shine([-3.2, -7, 0, -7.8, 3, -6.6])
      // Hood pushed back on the shoulders.
      cel(g, poly([-7.4, 5.8, -8.4, 0, -5.2, -1.6, -5.4, 4.6]), '#c8943a', c, { w: 0.8 })
  }
}
const rrect = (x: number, y: number, w: number, h: number, r: number): P => g => { g.moveTo(x + r, y); g.roundRect(x, y, w, h, r) }

// Hand-space props: hand at the origin, up is negative y.
function prop(g: G, role: Keeper, state: string | undefined, p: Pose, u: number, c: C, L: Look) {
  g.lineCap = 'round'
  const lamp = (x: number, y: number, k = 1) => {
    cel(g, rrect(x - 3.2 * k, y - 3.8 * k, 6.4 * k, 7.6 * k, 2 * k), '#e0a83a', c, { w: 1, d: 1.5 })
    g.fillStyle = '#fff0a8'; g.beginPath(); g.roundRect(x - 1.8 * k, y - 2.4 * k, 3.6 * k, 4.8 * k, 1.2 * k); g.fill()
    cel(g, poly([x - 3.8 * k, y - 3.8 * k, x, y - 7 * k, x + 3.8 * k, y - 3.8 * k]), '#6a4416', c, { w: 0.9, d: 1 })
    stroke(g, c.ink, 0.8, [x, y - 7 * k, x, y - 8.4 * k])
  }
  switch (role) {
    case 'lead': {
      inkRibbon(g, c, '#8a6a3a', [0, 24, 0, -38], 2.2, 1.8, { sh: 0.3 })
      for (const y of [-30, 6]) stroke(g, L.trim, 1, [-1.4, y, 1.4, y])
      const ph = state === 'working' && u > 0.52 ? (u - 0.52) : 0
      const swing = state === 'working' ? Math.sin(ph * 28) * 0.45 * Math.exp(-ph * 7) + p.a * 0.15 : Math.sin(TAU * u) * 0.07
      g.save(); g.translate(0, -39); g.rotate(swing); lamp(0, 3.6, 1.15); g.restore()
      break
    }
    case 'engineer': {
      // Hammer: haft plus a heavy square head with a bright face.
      inkRibbon(g, c, '#7a5a3a', [0, 7, 0, -12], 2.4, 2.2, { sh: 0.3 })
      cel(g, poly([-5.4, -20, 5.4, -20, 6.4, -12, -3.6, -12]), '#8a96b8', c, { w: 1.1, d: 1.8 })
      cel(g, poly([5.4, -20, 8.4, -18.4, 8.4, -13.6, 6.4, -12]), '#bcc6e4', c, { w: 0.8, sh: 0.1, rim: 0 })
      break
    }
    case 'qa': {
      if (state === 'working') {
        // Signal lamp: shuttered body, bright lens.
        cel(g, rrect(-4, -11, 8, 9, 1.8), '#3a4a7a', c, { w: 1.1, d: 1.6 })
        g.fillStyle = '#fff0a8'; g.beginPath(); g.roundRect(0.5, -9.4, 4.4, 6, 1); g.fill()
        stroke(g, '#e0a83a', 1.2, [-4, -2, -6, 3])
      } else {
        // Spyglass: brass tubes, glass cap.
        cel(g, poly([-1.6, 4, 1.6, 4, 2.2, -6, -2.2, -6]), '#d8a040', c, { w: 1, d: 1.2 })
        cel(g, poly([-2.2, -6, 2.2, -6, 3.4, -13, -3.4, -13]), '#a07028', c, { w: 1, d: 1.2 })
        g.fillStyle = '#9fe8ff'; g.beginPath(); g.ellipse(0, -13, 3, 0.9, 0, 0, TAU); g.fill()
      }
      break
    }
    case 'designer': {
      inkRibbon(g, c, '#c88a4a', [0, 12, 0, -14], 1.8, 1.4, { sh: 0.3 })
      stroke(g, '#e8d4a8', 2.4, [0, -14, 0, -16]); stroke(g, c.ink, 0.7, [-1.2, -15, 1.2, -15])
      cel(g, poly([-2, -16, 2, -16, 2.6, -20, 0, -26, -2.6, -20]), '#fff4ec', c, { w: 1, d: 1.2 })
      g.fillStyle = mix('#ff7ad1', '#ffd34e', (Math.sin(TAU * u * 2) + 1) / 2); g.beginPath(); g.moveTo(-2, -22); g.lineTo(2, -22); g.lineTo(0, -26.6); g.closePath(); g.fill()
      break
    }
    case 'researcher': {
      // Astrolabe: brass ring, inner rings that turn.
      inkRibbon(g, c, '#c8a040', [0, 7, 0, -3], 1.6, 1.3)
      const spin = state === 'working' ? u * TAU : Math.sin(TAU * u) * 0.3
      cel(g, circ(0, -11, 8), '#e0b850', c, { w: 1.2, d: 1.8 })
      cel(g, circ(0, -11, 5.8), '#1a2060', c, { w: 0.9, sh: 0.2, rim: 0.2, d: 1.2 })
      g.save(); g.translate(0, -11); g.rotate(spin); g.strokeStyle = '#ffd34e'; g.lineWidth = 1
      g.beginPath(); g.ellipse(0, 0, 5, 1.7, 0, 0, TAU); g.stroke(); g.rotate(1.2); g.beginPath(); g.ellipse(0, 0, 5, 1.7, 0, 0, TAU); g.stroke(); g.restore()
      star(g, 0, -11, 1.8, '#fff0c8')
      break
    }
    case 'ops': {
      inkRibbon(g, c, '#9aaa52', [0, 30, 0, -40], 2.2, 1.8, { sh: 0.3 })
      for (const y of [-26, -8, 12]) stroke(g, '#5a6a2a', 0.9, [-1.4, y, 1.4, y])
      cel(g, poly([-2.4, 30, 2.4, 30, 1.2, 33.4, -1.2, 33.4]), '#7a5a2a', c, { w: 0.9, d: 1 })
      // Bow lamp hung on a hook, swaying.
      const sw = Math.sin(TAU * u * 2) * 0.12 + p.sw * 0.1
      stroke(g, c.ink, 0.8, [0, -22, 3.4, -22]); g.save(); g.translate(3.4, -22); g.rotate(sw); stroke(g, c.ink, 0.7, [0, 0, 0, 2]); lamp(0, 7, 0.9); g.restore()
      break
    }
    case 'growth': break
    default: {
      // Jar of fireflies hanging on a cord, swinging.
      const sw = Math.sin(TAU * u * (state === 'working' ? 1 : 2)) * (state === 'working' ? 0.5 : 0.1)
      g.save(); g.rotate(sw)
      stroke(g, c.ink, 0.8, [0, 0, 0, 4])
      cel(g, rrect(-4.2, 4, 8.4, 10.5, 3), '#2a3a6a', c, { w: 1.1, d: 1.6 })
      g.fillStyle = '#ffe27a'; g.beginPath(); g.roundRect(-2.8, 5.4, 5.6, 7.6, 2); g.fill()
      cel(g, rrect(-3.2, 2.4, 6.4, 2.4, 1), '#8a5a2a', c, { w: 0.9, d: 1 })
      g.fillStyle = c.ink
      for (let i = 0; i < 3; i++) { const a = TAU * (u * 2 + i / 3); g.beginPath(); g.arc(Math.cos(a) * 1.4, 9 + Math.sin(a * 1.3) * 2, 0.5, 0, TAU); g.fill() }
      g.restore()
    }
  }
}

// Longest ray length from (x, y) at angle a that stays inside the paint envelope.
const rayLen = (x: number, y: number, a: number) => {
  const dx = Math.cos(a), dy = Math.sin(a), tx = dx > 0 ? (35 - x) / dx : dx < 0 ? (-35 - x) / dx : 1e3, ty = dy > 0 ? (3 - y) / dy : dy < 0 ? (-83 - y) / dy : 1e3
  return Math.max(0, Math.min(tx, ty))
}

// Air effects, drawn in feet space after the body: smears, sparks, paint, motes, beam.
function effects(g: G, role: Keeper, state: string | undefined, p: Pose, u: number, c: C, hx: number, hy: number) {
  const s = (k: number, ph = 0) => Math.sin(TAU * (u * k + ph))
  const w = state === 'working', hit = p.hit
  if (w && role === 'engineer') {
    cel(g, poly([8, -9, 28, -9, 26, -4, 10, -4]), '#4a5a88', c, { w: 1, d: 1.5 })
    cel(g, rrect(13, -12, 10, 3.4, 1), u > 0.5 && u < 0.62 ? '#ffe27a' : '#ff6a1a', c, { w: 0.9, sh: 0.1, rim: 0 })
    if (p.a < 0 && p.a > -0.31) { g.fillStyle = rgba('#fff0a8', 0.55); g.beginPath(); g.moveTo(hx - 4, hy - 16); g.quadraticCurveTo(hx + 14, hy - 8, hx + 10, hy + 6); g.lineTo(hx + 4, hy - 6); g.closePath(); g.fill() }
    if (hit > 0) {
      const k = 1 - hit
      for (let i = 0; i < 9; i++) {
        const a = -PI * (0.06 + 0.55 * ((i * 0.37) % 1)), v = 6 + ((i * 0.61) % 1) * 9, x = 20 + Math.cos(a) * v * k, y = -12 + Math.sin(a) * v * k + 16 * k * k
        stroke(g, i % 2 ? '#ffd34e' : '#fff0a8', 1.4 * hit + 0.3, [x, y, x - Math.cos(a) * 3 * hit, y - Math.sin(a) * 3 * hit])
      }
    }
  }
  if (w && role === 'lead' && hit > 0) {
    g.strokeStyle = rgba('#ffe27a', 0.7 * hit); g.lineWidth = 1.2
    for (let i = 0; i < 2; i++) { g.beginPath(); g.ellipse(hx - 2, 3, 6 + (1 - hit) * 14 + i * 5, 1.5 + i * 0.4, 0, 0, TAU); g.stroke() }
    for (const dx of [-4, 0, 4]) streak(g, rgba('#fff0a8', 0.8 * hit), hx + dx, hy - 34, hx + dx * 1.2, hy - 6, 1.6)
  }
  if (w && role === 'qa') {
    const a = -0.15 + s(1) * 0.55, x0 = hx + 5, y0 = hy - 7, L = Math.min(rayLen(x0, y0, a - 0.2), rayLen(x0, y0, a + 0.2), rayLen(x0, y0, a))
    for (const [d, al] of [[0.2, 0.22], [0.08, 0.32]] as const) {
      g.fillStyle = rgba('#ffe68c', al); g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + Math.cos(a - d) * L, y0 + Math.sin(a - d) * L); g.lineTo(x0 + Math.cos(a + d) * L, y0 + Math.sin(a + d) * L); g.closePath(); g.fill()
    }
  }
  if (w && role === 'designer') {
    const t = eio(u / 0.7), n = 14, fade = u > 0.85 ? 1 - (u - 0.85) / 0.15 : 1
    for (const [off, col, wd] of [[0, '#ff7ad1', 3.2], [4, '#ffd34e', 1.8], [-3, '#6ff0c2', 1.2]] as const) {
      const pts: number[] = []
      for (let i = 0; i <= n; i++) { const tt = t * i / n, q = paintAt(tt); pts.push(q[0], q[1] + off * Math.min(1, tt * 3)) }
      stroke(g, rgba(col, 0.9 * fade), wd, pts)
    }
    for (let i = 0; i < 4; i++) { const q = paintAt(clK(t - i * 0.1)); star(g, q[0] + 2, q[1] - 3 - i, 1.4 * fade, '#fff0c8') }
  }
  if (role === 'researcher' && (w || state === 'waiting' || state === 'needs')) {
    const n = w ? 8 : 4, pts: number[] = []
    for (let i = 0; i < n; i++) {
      const k = (u + i / n) % 1, x = Math.sin(i * 2.3 + 1) * 22, y = -62 - k * 18
      star(g, x + Math.sin(TAU * k * 2 + i) * 3, y, (i % 2 ? 1.5 : 2.3) * (1 - Math.abs(k - 0.5) * 1.3), i % 3 ? '#ffe27a' : '#9fe8ff')
      if (w && i < 5) pts.push(x, y)
    }
    if (w) stroke(g, rgba('#9fe8ff', 0.35), 0.6, pts)
  }
  if (role === 'ops' && w) {
    const k = Math.abs(p.a), bx = hx + 7
    g.strokeStyle = rgba('#9fe8ff', 0.55 * k); g.lineWidth = 1.1
    for (let i = 0; i < 2; i++) { g.beginPath(); g.ellipse(bx, 3.5, 4 + k * 8 + i * 4, 1.2 + i * 0.4, 0, 0, TAU); g.stroke() }
    if (hit > 0) for (const dy of [-4, 2]) streak(g, rgba('#9fe8ff', 0.6 * hit), -14, hy + 8 + dy * 3, -30, hy + 8 + dy * 3, 1.4)
  }
  if (role === 'growth' && (w || state === 'done')) {
    const l = w ? leap(u) : 0
    if (w && u > 0.16 && u < 0.32) for (let i = 0; i < 6; i++) { const k = (u - 0.16) / 0.16, a = -PI * (0.12 + i * 0.15); g.fillStyle = rgba('#9fe8ff', 1 - k); g.beginPath(); g.arc(Math.cos(a) * 14 * k, Math.sin(a) * 10 * k - 1, 1.3, 0, TAU); g.fill() }
    if (l > 0.3) { g.strokeStyle = rgba('#9fe8ff', 0.7); g.lineWidth = 1.2; for (const sd of [-1, 1]) { g.beginPath(); g.moveTo(sd * 4, -34); g.quadraticCurveTo(sd * 9, -20, sd * 5, -6); g.stroke() } }
  }
  if (role === 'pilgrim' && w) for (let i = 0; i < 5; i++) { const a = TAU * (u + i / 5), r = 6 + i * 2.4; star(g, hx + Math.cos(a) * r, hy - 4 + Math.sin(a * 2) * 5, 1.3, '#ffe27a') }
  if (state === 'stuck') {
    g.fillStyle = '#9fe8ff'; g.strokeStyle = c.ink; g.lineWidth = 0.8
    for (const [x, y] of [[11, -62 + ((u * 2) % 1) * 4], [-12, -58 + ((u * 2 + 0.5) % 1) * 4]]) { g.beginPath(); g.moveTo(x, y - 3); g.quadraticCurveTo(x + 2.6, y, x, y + 2); g.quadraticCurveTo(x - 2.6, y, x, y - 3); g.fill(); g.stroke() }
    for (const sd of [-1, 1]) stroke(g, rgba('#9fe8ff', 0.6), 0.8, [sd * 14, -46, sd * 17, -44, sd * 14, -42, sd * 17, -40])
  }
  if (state === 'needs') for (const a of [-0.7, 0, 0.7]) { const [rx, ry] = rot(a, 0, -1); streak(g, rgba('#ff9a9a', 0.5 + 0.4 * p.a), hx + rx * 5, hy - 6 + ry * 5, hx + rx * 11, hy - 6 + ry * 11, 1.2) }
  if (state === 'done') for (let i = 0; i < 5; i++) { const k = (u + i / 5) % 1; star(g, -22 + i * 11, -70 - k * 8, 2.4 * Math.sin(PI * k), i % 2 ? '#ffe27a' : '#6ff0c2') }
}
const clK = (v: number) => cl(v)

function paint(g: G, role: Keeper, _ai: string | undefined, state: string | undefined, _leg: number, u: number, c: C, _sash: string) {
  const p = poseOf(role, state, u), L = LOOK[role] ?? LOOK.pilgrim
  const sc = role === 'pilgrim' ? 0.93 : 1
  g.save()
  g.lineJoin = g.lineCap = 'round'
  g.fillStyle = 'rgba(4,8,22,0.45)'; g.beginPath(); g.ellipse(p.dx * 0.8, 0.5, 11 + p.dy * 0.3, 2.6, 0, 0, TAU); g.fill()
  g.save(); g.translate(p.dx, p.dy); g.rotate(p.rot); g.scale(sc, sc)
  back(g, role, p, u, c, L)
  legs(g, c, p, L, role)
  coat(g, role, p, c, u, L)
  tails(g, role, p, u, c, L)
  g.save(); g.translate(0, -48.6); g.rotate(p.tilt); g.scale(1.15, 1.15)
  head(g, role, p, c, u, L)
  g.restore()
  // Hand-held items scale down so raised props stay inside the cell.
  const [up, down] = REACH[role], hy = p.dy + p.hr[1]
  const k = cl(Math.min(1, (80 + hy) / Math.max(up, 1), (6 - hy) / Math.max(down, 1)), 0.25)
  arm(g, c, -6.2, p.hl[0], p.hl[1], L, role)
  if (role === 'engineer' && state === 'working') {
    stroke(g, c.ink, 2.6, [p.hl[0], p.hl[1], p.hl[0] + 12, p.hl[1] + 6]); stroke(g, '#9aa4c8', 1.2, [p.hl[0], p.hl[1], p.hl[0] + 12, p.hl[1] + 6])
  }
  arm(g, c, 6.2, p.hr[0], p.hr[1], L, role)
  g.save(); g.translate(p.hr[0], p.hr[1]); g.rotate(p.pa); g.scale(k, k); prop(g, role, state, p, u, c, L); g.restore()
  g.restore()
  effects(g, role, state, p, u, c, p.dx + p.hr[0] * sc, p.dy + p.hr[1] * sc)
  g.restore()
}

function fx(g: G, x: number, y: number, role: Keeper, state: string | undefined, t: number, u: number, c: C,
  add: (fn: () => void) => void, glowAt: (g: G, col: string, x: number, y: number, r: number, a: number) => void) {
  const p = poseOf(role, state, u), [up, down, gy] = REACH[role], sc = role === 'pilgrim' ? 0.93 : 1
  const hx = x + p.dx + p.hr[0] * sc, hy = y + p.dy + p.hr[1] * sc
  const k = cl(Math.min(1, (80 + p.dy + p.hr[1]) / Math.max(up, 1), (6 - p.dy - p.hr[1]) / Math.max(down, 1)), 0.25)
  const [rx, ry] = rot(p.pa, 0, gy * k), tx = hx + rx, ty = hy + ry
  const fl = 0.8 + 0.2 * Math.sin(t * 13) * Math.sin(t * 7.3), w = state === 'working'
  const gl = (col: string, px: number, py: number, r: number, a: number) => glowAt(g, col, px, py, Math.max(1, Math.round(r)), a)
  add(() => {
    if (state === 'needs') gl(c.red_lt, tx, ty, 15, 0.7 + 0.2 * Math.sin(t * 9))
    if (role === 'lead') gl(c.gold, tx, ty, 16 * fl, 0.65)
    if (role === 'engineer' && w) { gl('#ff8a2a', x + 20, y - 10, 6, 0.6); if (p.hit > 0) gl('#ffcf3a', x + 22, y - 10, 16, 0.9 * p.hit) }
    if (role === 'qa' && w) gl('#ffe58a', tx + 3, ty - 3, 9, 0.7)
    if (role === 'designer' && w) { const q = paintAt(eio(u / 0.7)); gl('#ff7ad1', x + q[0], y + q[1], 9, 0.6) }
    if (role === 'researcher') gl('#ffd34e', tx, ty, 11, 0.3 + 0.1 * Math.sin(t * 2))
    if (role === 'ops') gl('#ffb36b', tx + 3, ty + 7, 8 * fl, 0.7)
    if (role === 'pilgrim') gl('#ffe27a', tx, ty + 1, 12 * fl, 0.6)
    if (role === 'lead' || role === 'researcher') gl('#ffd34e', x, y - 50, 13, 0.12)
  })
}

export const inkStyle: KeeperStyle = { paint, fx }
