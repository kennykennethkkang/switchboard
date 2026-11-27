'use client'
// Board: the Celestial Court. Council in the middle, a pavilion per AI, a courtyard per chat, a desk per role.
// Sprites and islands are drawn in code. Animated agents: idea from Pixel Agents (pablodelucca/pixel-agents, MIT), no code taken.
import { pickHit } from '../../lib/board-hit'
import { useDialog } from '@/hooks/use-dialog'
import { useEffect, useMemo, useRef, useState } from 'react'
import { readStore, writeStore } from '@/lib/store'
import { flushSync } from 'react-dom'
import type { Ask, Choice, HubState, TaskRow } from '@/lib/hub-types'
import type { HubCommand } from '@/lib/vscode-bridge'
import { demoGraph, healthLine, loadGraph, relations, type MemoryGraph } from '@/lib/memory-graph'
import { keepGraph, memoryTally, todoRef, withDemoLearn, type GraphHold, type Item } from '@/lib/court-places'
import { replyBox } from '@/lib/message-box'
import { hubCounts } from '@/lib/now'
import { PLACES, PLATE, buildCourt, markSpot, courtSummary, plainWord, YARD_TAG_CAP, forcedSpot, freeSpot, type Box as Box4, chatOf, courtEvents, fitCourt, lod, type Court, type CourtNode, type CourtState } from '@/lib/court-map'
import { askChoice } from '@/lib/ask'
import { optionSmart, smartMarkText } from '@/lib/smart'
import { END_S, THAW_S, arrivals, heldChats, nextPause, pauseLine, ropeAwake, ropesBusy, ropesOf, endedRopes, thawAt, type PauseFx, type Rope, type Thaw } from '@/lib/board-fx'
import { BASKET, CARP, pixCanvas } from '@/lib/sprites/carp'
import { LEGACY_SKIN_KEY, MODE_KEY, SKINS, SKIN_KEY, lookOf, readPick, skinById, type Chrome, type CourtColors as C, type Mode } from '@/lib/skins'
import { ell, glowAt, lantern, puff, sparkle } from './board-art'
import { REALM, kitOf, type ArtKit, type FigureBox, type FigurePose, type Realm } from './art'
import { figurePad, makeCache, type Sized } from './art/pad'
import { BoardTools, DEFAULT_CHROME, beltCounts, chromeOf } from './board-tools'
import { SummaryFold } from './chat-cards'
import { ModelEffort } from './model-effort'
import { fiveHourUse, runFields, startPicks, type RunPicks } from '@/lib/model-effort'
import { onScreen as seen, vscodeBridge } from '@/lib/vscode-bridge'
import { COARSE_DPR, MAX_DPR, frameLoop } from '@/lib/frame-loop'
import './board.css'
import './smart-select.css'

type View = { x: number; y: number; z: number }
type Box = { x: number; y: number; w: number; h: number; id: string }
// q: canvas px per art px; smooth kits bake denser so islands stay sharp at max zoom. px, py: a detail bake's top left in art px.
type Frame = { ox: number; oy: number; cx: number; cy: number; cv: HTMLCanvasElement; sig: string; res: number; q: number; px: number; py: number }
type Part = { x: number; y: number; w: number; h: number; q: number }
export type Send = (m: Extract<HubCommand, { type: 'hub-answer' | 'hub-focus-chat' | 'hub-rc' | 'hub-rc-server' | 'hub-learn' | 'hub-key-test' | 'hub-new-chat' | 'hub-send' | 'hub-todo-remove' }>) => void
// World units per art pixel; the art is drawn at whole-number device pixels per art pixel once zoomed in.
const ART = 2, WALK = 90, STEP_HZ = 4, MAX_Z = 3, BAKE_PX = 16e6
const resOf = (kit: ArtKit) => kit.res ?? ART
// One-off sprite moves, seconds: a tap hop, a finish cheer, a lead and new subagent walking to meet.
type Fx = { kind: 'hop' | 'cheer' | 'meet' | 'move' | 'arrive'; at: number; lead?: string; from?: string; to?: string }
const DUR: Record<Fx['kind'], number> = { hop: 0.45, cheer: 1.6, meet: 2, move: 2.4, arrive: 1.5 }
// Walk cycle: step, pass, other step, pass; the body lifts a pixel on each pass.
const WALK_LEGS = [1, 0, 2, 0], walkFrame = (t: number) => t ? Math.floor(t * 8) % 4 : 0
const CONFETTI = ['gold_lt', 'jade_lt', 'red_lt', 'peach', 'sky'] as const
// Label look of the skin being drawn; draw() sets it each frame.
let CH: Chrome = DEFAULT_CHROME
const PIX = (s: number) => `400 ${s}px ${CH.font}`
const SANS = (s: number, w = 600) => `${w} ${s}px 'Hanken Grotesk', system-ui, sans-serif`
const WORD: Record<CourtState, string> = { working: 'RUN', waiting: 'WAIT', stuck: 'STUCK', done: 'DONE', needs: 'ASK', idle: 'IDLE' }
const SAY: Record<CourtState, string> = { working: 'working', waiting: 'waiting', stuck: 'stuck', done: 'done', needs: 'needs you', idle: 'idle' }
const LEGEND: Array<[CourtState, string]> = [['working', 'Working'], ['stuck', 'Stuck'], ['needs', 'Needs you'], ['waiting', 'Waiting'], ['done', 'Done'], ['idle', 'Idle']]
const RANK: Record<CourtState, number> = { needs: 5, stuck: 4, working: 3, waiting: 2, done: 1, idle: 0 }
const AI_KEY: Record<string, keyof C> = { claude: 'red_lt', codex: 'blue_lt', gemini: 'sky', jev: 'jade_lt', hermes: 'gold_lt', perplexity: 'sky', research: 'plum' }
const ROLE_KEY: Record<string, [keyof C, keyof C]> = { lead: ['gold', 'gold_dk'], researcher: ['blue_lt', 'blue'], engineer: ['red', 'red_dk'], qa: ['jade', 'jade_dk'], designer: ['peach', 'peach_dk'], ops: ['brown', 'brown_dk'], growth: ['plum', 'ink2'], pilgrim: ['brown', 'brown_dk'] }
const KINDS: Record<CourtNode['kind'], string> = { council: 'Council Hall', pavilion: 'Pavilion', window: 'Window', courtyard: 'Courtyard', realm: 'Realm', desk: 'Desk', garden: 'Tea garden', armory: 'Armory', library: 'Memory library', notice: 'Notice board', tower: 'Signal tower', study: 'Study hall', treasury: 'Treasury', maps: 'Map room', uploads: 'Uploads' }
const BIG = new Set<CourtNode['kind']>(['council', 'pavilion', 'window', 'courtyard', 'realm', ...PLACES])
const isPlace = (k: CourtNode['kind']) => (PLACES as readonly string[]).includes(k)
// The board is always dark: --hub-w-* from .hub-dark in globals.css.
const WIN: Record<string, string> = { violet: '#a08bff', amber: '#f2b24c', teal: '#4fd1c9', rose: '#ff7ab3', lime: '#9bd65a', cobalt: '#7ea2ff', slate: '#9aa4b5' }
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
const folder = (p = '') => p.replace(/^\/Users\/[^/]+/, '~')
let PLATE_BG = CH.plate, MUTE = CH.mute, TEXT = CH.text
// With chrome set, the hub's own vars are remapped so the header, legend and side panel follow it.
const chromeVars = (h: Chrome) => ({ '--hub-card': h.plate, '--hub-canvas': h.plate, '--hub-elev': h.plate, '--hub-ink': h.text, '--hub-body': h.text, '--hub-mute': h.mute, '--hub-hair-strong': h.edge, '--hub-hair': h.edge, '--c-plate': h.plate, '--c-edge': h.edge, '--c-text': h.text, '--c-font': h.font, '--c-radius': `${h.radius}px` })
const useChrome = (ch: Chrome) => { CH = ch; PLATE_BG = ch.plate; MUTE = ch.mute; TEXT = ch.text }
// Realm palettes come from the art kit; with no kit (plaques, labels) the court palette is used.
const realmOf = (ai?: string, kit?: ArtKit): Realm => { const P = kit?.realms ?? REALM; return P[ai ?? ''] ?? P.codex }

function realmDesk(g: G, x: number, y: number, lit: boolean, R: Realm, c: C) {
  rect(g, x, y + 1, 24, 9, c.ink); rect(g, x + 1, y, 22, 9, R.rim); rect(g, x + 1, y, 22, 1, R.hi); rect(g, x + 1, y + 6, 22, 3, R.dk)
  rect(g, x + 4, y + 2, 11, 4, '#08101c'); rect(g, x + 5, y + 3, 1 + (lit ? 6 : 3), 1, R.hi); rect(g, x + 18, y + 2, 3, 3, lit ? R.glow : R.dk)
  if (lit) { g.globalAlpha = 0.3; rect(g, x + 15, y - 2, 9, 8, R.hi); g.globalAlpha = 1 }
}
// Where a realm's landmark stands, in art px of the baked frame; a yard's goes in its free slot after k desks.
const markAt = (n: CourtNode, A: (x: number) => number, B: (y: number) => number, res: number, k?: number) => {
  if (k !== undefined) { const [x, y] = markSpot(n, k); return [Math.round(A(x)), Math.round(B(y))] as const }
  return [Math.round(A(n.x + n.w / 2) - (n.w / res / 2) * 0.66), Math.round(B(n.y + n.h / 2) + 2)] as const
}
const deskCount = (court: Court, n: CourtNode) => court.nodes.filter(d => d.kind === 'desk' && d.parent === n.id).length
// Claude a spark on a plinth, Codex a terminal monolith, Jev a balance, Perplexity a lighthouse, Gemini twin spires under a spark.
function landmark(g: G, ai: string | undefined, bx: number, by: number, R: Realm, c: C) {
  if (ai === 'claude') {
    rect(g, bx - 7, by - 4, 14, 5, c.ink); rect(g, bx - 6, by - 3, 12, 3, R.rim); rect(g, bx - 3, by - 14, 6, 11, c.ink); rect(g, bx - 2, by - 13, 4, 10, R.dk)
    g.globalAlpha = 0.3; rect(g, bx - 11, by - 37, 22, 22, R.hi); g.globalAlpha = 1
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]]) {
      const len = dx && dy ? 6 : 9
      for (let i = 2; i <= len; i++) rect(g, bx + dx * i - 1, by - 26 + dy * i - 1, 3, 3, c.ink)
      for (let i = 2; i <= len; i++) rect(g, bx + dx * i, by - 26 + dy * i, 1, 1, i > len - 2 ? R.glow : R.hi)
    }
    rect(g, bx - 2, by - 28, 5, 5, c.ink); rect(g, bx - 1, by - 27, 3, 3, R.glow)
  } else if (ai === 'jev') {
    rect(g, bx - 2, by - 25, 4, 26, c.ink); rect(g, bx - 1, by - 24, 2, 24, c.gold)
    rect(g, bx - 12, by - 25, 24, 3, c.ink); rect(g, bx - 11, by - 24, 22, 1, c.gold_lt)
    rect(g, bx - 9, by - 22, 1, 6, R.glow); rect(g, bx + 8, by - 22, 1, 10, R.glow)
    rect(g, bx - 13, by - 16, 9, 3, c.ink); rect(g, bx - 12, by - 16, 7, 1, R.hi); rect(g, bx + 4, by - 12, 9, 3, c.ink); rect(g, bx + 5, by - 12, 7, 1, R.hi)
    rect(g, bx - 6, by - 1, 12, 3, c.ink); rect(g, bx - 5, by - 1, 10, 2, R.rim)
  } else if (ai === 'perplexity') {
    g.globalAlpha = 0.3; g.fillStyle = R.hi
    for (const s of [1, -1]) { g.beginPath(); g.moveTo(bx, by - 30); g.lineTo(bx + s * 34, by - 40); g.lineTo(bx + s * 34, by - 22); g.fill() }
    g.globalAlpha = 1
    for (let i = 0; i < 26; i++) { const w = 10 - Math.floor(i / 6); rect(g, bx - w / 2 - 1, by - i, w + 2, 1, c.ink); rect(g, bx - w / 2, by - i, w, 1, (i >> 2) % 2 ? R.glow : R.rim) }
    rect(g, bx - 4, by - 32, 8, 7, c.ink); rect(g, bx - 3, by - 31, 6, 4, R.hi); rect(g, bx - 4, by - 34, 8, 2, R.dk)
  } else if (ai === 'gemini') {
    for (const [dx, h] of [[-5, 22], [5, 18]] as const) { rect(g, bx + dx - 3, by - h, 6, h + 1, c.ink); rect(g, bx + dx - 2, by - h + 1, 4, h - 1, R.rim); rect(g, bx + dx - 2, by - h + 1, 1, h - 1, R.hi) }
    rect(g, bx - 3, by - 12, 6, 2, c.ink); rect(g, bx - 8, by - 1, 16, 3, c.ink); rect(g, bx - 7, by - 1, 14, 2, R.dk)
    rect(g, bx - 1, by - 37, 2, 9, R.glow); rect(g, bx - 4, by - 33, 8, 2, R.glow); rect(g, bx - 1, by - 34, 2, 3, '#ffffff')
  } else {
    g.globalAlpha = 0.28; rect(g, bx - 8, by - 31, 16, 34, R.hi); g.globalAlpha = 1
    rect(g, bx - 6, by - 28, 12, 29, c.ink); rect(g, bx - 5, by - 27, 10, 27, R.dk); rect(g, bx - 5, by - 27, 10, 1, R.rim)
    rect(g, bx - 4, by - 23, 8, 8, '#06101c'); rect(g, bx - 3, by - 22, 1, 1, R.hi); rect(g, bx - 2, by - 21, 1, 1, R.hi); rect(g, bx - 3, by - 20, 1, 1, R.hi); rect(g, bx, by - 18, 3, 1, R.hi)
    for (let i = 0; i < 4; i++) rect(g, bx - 4, by - 12 + i * 3, 8, 1, R.rim)
  }
}
// A realm's gate: two posts, a lintel in the realm's light, and the yard's shrine box on top. The AI badge is drawn after it.
function gate(g: G, gx: number, gy: number, R: Realm, yardAi: string | undefined, c: C) {
  for (const px of [gx - 11, gx + 8]) { rect(g, px - 1, gy - 18, 5, 20, c.ink); rect(g, px, gy - 17, 3, 18, R.hi) }
  rect(g, gx - 15, gy - 23, 30, 6, c.ink); rect(g, gx - 14, gy - 22, 28, 2, R.hi); rect(g, gx - 14, gy - 20, 28, 2, R.dk)
  rect(g, gx - 5, gy - 31, 10, 9, c.ink); rect(g, gx - 4, gy - 30, 8, 7, c[AI_KEY[yardAi ?? 'claude'] ?? 'red_lt'])
}
// An annex islet in its own sky, a gate where it meets its courtyard, the origin AI's badge on the lintel.
function realmIsle(g: G, n: CourtNode, yard: CourtNode | undefined, c: C, A: (x: number) => number, B: (y: number) => number, k: number | undefined, kit: ArtKit, res: number) {
  const R = realmOf(n.ai, kit), x = A(n.x + n.w / 2), y = B(n.y + n.h / 2), rx = n.w / res / 2, ry = n.h / res / 2
  if (kit.realmShell) kit.realmShell(g, x, y, rx, ry, n.ai, R, c)
  else {
  ell(g, x, y + 6, rx * 1.65, ry * 1.8, R.rim, 0.24); kit.realmHalo(g, x, y, rx, ry, R, c)
  for (let i = 0; i < 18; i++) { const a = i * 2.4, d = 1.15 + (i % 4) * 0.14; rect(g, x + Math.cos(a) * rx * d, y + 4 + Math.sin(a) * ry * d * 1.2, 1, 1, R.glow) }
  const depth = Math.round(ry * 0.45), bot = y + ry + depth
  for (const [dx, h] of [[-0.55, 9], [-0.2, 17], [0.15, 12], [0.5, 8]]) {
    g.fillStyle = c.ink; g.beginPath(); g.moveTo(x + dx * rx - 5, bot - 4); g.lineTo(x + dx * rx + 5, bot - 4); g.lineTo(x + dx * rx, bot + h + 1); g.fill()
    g.fillStyle = R.dk; g.beginPath(); g.moveTo(x + dx * rx - 4, bot - 4); g.lineTo(x + dx * rx + 4, bot - 4); g.lineTo(x + dx * rx, bot + h); g.fill(); rect(g, x + dx * rx, bot - 2, 1, h * 0.6, R.hi)
  }
  for (let d = depth; d > 0; d--) ell(g, x, y + d, rx * (1 - d * 0.015), ry, d > depth * 0.55 ? R.dk : R.rim)
  ell(g, x, y, rx + 1, ry + 1, c.ink); ell(g, x, y, rx, ry, R.rim); ell(g, x, y + 1, rx - 1, ry - 2, R.top)
  if (n.ai === 'jev') { for (let gx = -rx; gx < rx; gx += 5) for (let gy = -ry; gy < ry; gy += 5) if (((gx + gy) / 5) % 2 === 0 && (gx / rx) ** 2 + (gy / ry) ** 2 < 0.7) rect(g, x + gx, y + gy, 5, 5, R.dk) }
  else if (n.ai === 'perplexity') for (let i = 1; i < 5; i++) { g.strokeStyle = R.rim; g.lineWidth = 1; g.beginPath(); g.ellipse(x, y, rx * i / 5, ry * i / 5, 0, 0, 7); g.stroke() }
  else for (let gx = -rx; gx < rx; gx += 6) for (let gy = -ry; gy < ry; gy += 5) if ((gx / rx) ** 2 + (gy / ry) ** 2 < 0.72) rect(g, x + gx, y + gy, 3, 1, R.rim)
  }
  kit.realmDeco(g, x, y, rx, ry, R, c)
  const [mx, my] = markAt(n, A, B, res, k)
  if (kit.landmark) kit.landmark(g, n.ai, mx, my, R, c)
  else landmark(g, n.ai, mx, my, R, c)
  if (!yard) return
  // Gate halfway between the two rims, on the line between their centers.
  const rim = (m: CourtNode, ux: number, uy: number, k: number) => { const a = (m.w / res / 2) * k, b = (m.h / res / 2) * k, r = a * b / Math.hypot(b * ux, a * uy); return [A(m.x + m.w / 2) + ux * r, B(m.y + m.h / 2) + uy * r] }
  const yx = A(yard.x + yard.w / 2), yy = B(yard.y + yard.h / 2), L = Math.hypot(x - yx, y - yy) || 1, ux = (x - yx) / L, uy = (y - yy) / L
  const [ox, oy] = rim(yard, ux, uy, 1.08), [ex, ey] = rim(n, -ux, -uy, 1), gx = Math.round((ox + ex) / 2), gy = Math.round((oy + ey) / 2) + 2
  if (kit.gate) kit.gate(g, gx, gy, R, yard.ai, c)
  else gate(g, gx, gy, R, yard.ai, c)
  const ic = aiIcon(yard.ai)
  if (ic) (kit.badge ?? badge)(g, ic, gx - 2, gy - 29, c)
}

// Wait ropes between courtyards and the usage pause freeze; timing in lib/board-fx.ts.
const EMPTY: Partial<Record<CourtNode['kind'], string>> = { garden: 'Every role is at work.', armory: 'No tools enabled.', notice: 'Nothing on the to-do list.', study: 'No Learn runs yet.', treasury: 'No keys or AWS profiles saved.', maps: 'No projects found.' }
const LIMIT: Record<string, string> = { five_hour: '5h limit', seven_day: 'Weekly limit' }
const ICE_HI = '#eaf8ff', ICE = '#a9dcf3', ICE_DK = '#5f9fc6'
// Sand runs top to bottom every 4s; half full and still under reduced motion.
function hourglass(g: G, x: number, y: number, t: number, c: C) {
  const rows: Array<[number, number]> = [[0, 5], [0, 5], [1, 3], [2, 1], [2, 1], [1, 3], [0, 5], [0, 5]], f = t ? (t / 4) % 1 : 0.5
  rows.forEach(([dx, w], i) => rect(g, x + dx - 1, y + i - 1, w + 2, 3, c.ink))
  rows.forEach(([dx, w], i) => rect(g, x + dx, y + i, w, 1, i === 0 || i === 7 ? c.gold : c.cloud_sh))
  if (f < 0.5) rect(g, x, y + 1, 5, 1, c.gold_lt)
  if (f < 0.85) rect(g, x + 1, y + 2, 3, 1, c.gold_lt)
  if (f > 0.55) rect(g, x + 1, y + 5, 3, 1, c.gold_lt)
  if (f > 0.15) rect(g, x, y + 6, 5, 1, c.gold_lt)
  if (t && f < 0.95) rect(g, x + 2, y + 3, 1, 2 + ((t * 4) | 0) % 2, c.gold_lt)
}
// Pixel pieces on a finer-res kit draw scaled up about their anchor; the callback gets that origin. At u 1 it is the same draw.
const grow = (g: G, u: number, x: number, y: number, draw: (ox: number, oy: number) => void) => {
  if (u === 1) return draw(x, y)
  g.save(); g.translate(x, y); g.scale(u, u); draw(0, 0); g.restore()
}
// Frozen sprites: the same art washed in ice, cached per sprite canvas.
const icy = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>()
function iced(cv: HTMLCanvasElement) {
  let out = icy.get(cv)
  if (!out) {
    out = document.createElement('canvas'); out.width = cv.width; out.height = cv.height
    const g = out.getContext('2d')!
    g.drawImage(cv, 0, 0); g.globalCompositeOperation = 'source-atop'; g.fillStyle = 'rgba(150,212,245,.55)'; g.fillRect(0, 0, cv.width, cv.height)
    icy.set(cv, out)
  }
  return out
}
function iceBlock(g: G, x: number, y: number, a: number) {
  g.save(); g.globalAlpha = 0.3 * a; rect(g, x - 8, y - 17, 16, 20, ICE_HI); g.globalAlpha = 0.8 * a
  rect(g, x - 8, y - 17, 16, 1, ICE_HI); rect(g, x - 8, y - 17, 1, 20, ICE_HI); rect(g, x + 7, y - 16, 1, 19, ICE_DK); rect(g, x - 6, y - 15, 3, 1, '#fff')
  g.restore()
}
function frostDesk(g: G, x: number, y: number, a: number) {
  g.save(); g.globalAlpha = a; rect(g, x + 1, y, 22, 2, ICE_HI); rect(g, x + 1, y + 2, 22, 1, ICE)
  for (const dx of [2, 7, 15, 20]) rect(g, x + dx, y + 3, 1, 1 + (dx % 3), ICE_HI)
  g.restore()
}
// A held courtyard freezes over: a sheet on the plaza, an icy rim with icicles; cracks as it thaws.
function iceYards(g: G, by: Map<string, CourtNode>, held: Set<string>, th: Thaw, A: (x: number) => number, B: (y: number) => number, res: number) {
  if (th.ice <= 0) return
  for (const id of held) {
    const n = by.get(`yard:${id}`)
    if (!n) continue
    const x = A(n.x + n.w / 2), y = B(n.y + n.h / 2), rx = (n.w / res / 2) * 1.08, ry = (n.h / res / 2) * 1.1
    const oval = (dx: number) => { g.beginPath(); g.ellipse(x, y, rx + dx, ry + dx, 0, 0, 7) }
    g.save(); g.globalAlpha = th.ice
    g.fillStyle = 'rgba(200,236,255,.4)'; oval(0); g.fill()
    g.strokeStyle = ICE; g.lineWidth = 3; oval(0); g.stroke(); g.strokeStyle = ICE_HI; g.lineWidth = 1; oval(-1); g.stroke()
    for (let i = 0; i < 16; i++) {
      const ang = Math.PI * (0.1 + (0.8 * i) / 15), px = x + Math.cos(ang) * rx, py = y + Math.sin(ang) * ry + 1, len = 3 + ((i * 7) % 5)
      rect(g, px, py, 2, len, ICE); rect(g, px, py, 1, len - 1, ICE_HI)
    }
    for (let i = 0; i < 12; i++) { const q = i * 2.4, r = Math.sqrt((i + 0.5) / 12); rect(g, x + Math.cos(q) * r * rx * 0.8, y + Math.sin(q) * r * ry * 0.7, 2, 1, ICE_HI) }
    if (th.crack) for (let k = 0; k < 6; k++) {
      let ang = k * 1.05 + 0.3
      g.beginPath(); g.moveTo(x, y)
      for (let j = 1; j <= 5; j++) { ang += (((k * 7 + j * 3) % 5) - 2) * 0.14; const r = (j / 5) * th.crack * 0.95; g.lineTo(x + Math.cos(ang) * rx * r, y + Math.sin(ang) * ry * r) }
      g.strokeStyle = ICE_DK; g.lineWidth = 2; g.stroke(); g.strokeStyle = '#fff'; g.lineWidth = 1; g.stroke()
    }
    g.restore()
  }
}
// A rope in world units, rim to rim with a sag. end: 0..1 through its end flash, undefined while it waits.
type Span = { r: Rope; end?: number; s: [number, number]; m: [number, number]; e: [number, number] }
const qp = (r: Span, u: number): [number, number] => [0, 1].map(i => (1 - u) ** 2 * r.s[i] + 2 * u * (1 - u) * r.m[i] + u * u * r.e[i]) as [number, number]
function spans(by: Map<string, CourtNode>, ropes: Rope[], ends: Map<string, { r: Rope; at: number }>, now: number): Span[] {
  const rim = (n: CourtNode, ux: number, uy: number): [number, number] => {
    const rr = 0.8 * (n.w / 2) * (n.h / 2) / Math.hypot((n.h / 2) * ux, (n.w / 2) * uy)
    return [n.x + n.w / 2 + ux * rr, n.y + n.h / 2 + uy * rr]
  }
  const all: Array<[Rope, number | undefined]> = [...ropes.map(r => [r, undefined] as [Rope, undefined]), ...[...ends.values()].map(x => [x.r, Math.min(1, (now - x.at) / 1000 / END_S)] as [Rope, number])]
  return all.flatMap(([r, end]) => {
    const a = by.get(`yard:${r.from}`), b = by.get(`yard:${r.to}`)
    if (!a || !b) return []
    const dx = b.x + b.w / 2 - (a.x + a.w / 2), dy = b.y + b.h / 2 - (a.y + a.h / 2), d = Math.hypot(dx, dy) || 1
    const s = rim(a, dx / d, dy / d), e = rim(b, -dx / d, -dy / d), sag = Math.hypot(e[0] - s[0], e[1] - s[1]) * 0.18
    return [{ r, end, s, e, m: [(s[0] + e[0]) / 2, (s[1] + e[1]) / 2 + sag] as [number, number] }]
  })
}
// Chats split from one message: a still jade cord chaining their yards, a knot on each rim.
function tetherArt(g: G, court: Court, A: (x: number) => number, B: (y: number) => number, c: C) {
  if (!court.ties?.length) return
  g.save(); g.lineCap = 'round'; g.globalAlpha = 0.75
  // Rim to rim, like the wait ropes, so the cord never crosses an island.
  const rim = (n: CourtNode | undefined, p: [number, number], q: [number, number]): [number, number] => {
    if (!n) return p
    const dx = q[0] - p[0], dy = q[1] - p[1], d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d
    const rr = 0.8 * (n.w / 2) * (n.h / 2) / Math.hypot((n.h / 2) * ux, (n.w / 2) * uy)
    return [p[0] + ux * rr, p[1] + uy * rr]
  }
  for (const t of court.ties) {
    const ps = t.points, a = ps[0], z = ps[ps.length - 1]
    const pts = [rim(court.nodes.find(n => n.id === t.from), a, ps[1] ?? z), ...ps.slice(1, -1), rim(court.nodes.find(n => n.id === t.to), z, ps[ps.length - 2] ?? a)]
    const path = () => { g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(A(x), B(y)) : g.moveTo(A(x), B(y))) }
    g.setLineDash([1, 5]); g.strokeStyle = c.jade_dk; g.lineWidth = 3; path(); g.stroke()
    g.strokeStyle = c.jade_lt; g.lineWidth = 1.5; path(); g.stroke(); g.setLineDash([])
    // A knot on each rim, so touching siblings still read as tied.
    for (const [x, y] of [pts[0], pts[pts.length - 1]]) { g.globalAlpha = 1; rect(g, A(x) - 3, B(y) - 3, 6, 6, c.ink); rect(g, A(x) - 2, B(y) - 2, 4, 4, c.jade_lt) }
  }
  g.restore()
}
// Quiet at Fit: a thin dim dashed line. Awake: lantern, endpoints and full gold. Ending: a green glow with a spark to the far end, plain green under reduced motion.
function ropeArt(g: G, sp: Span[], A: (x: number) => number, B: (y: number) => number, t: number, c: C, awake: (r: Rope) => boolean) {
  sp.forEach((r, i) => {
    const [sx, sy] = [A(r.s[0]), B(r.s[1])], [mx, my] = [A(r.m[0]), B(r.m[1])], [ex, ey] = [A(r.e[0]), B(r.e[1])], e = r.end, hot = e !== undefined || awake(r.r)
    const path = () => { g.beginPath(); g.moveTo(sx, sy); g.quadraticCurveTo(mx, my, ex, ey) }
    g.save(); g.lineCap = 'round'; g.globalAlpha = e === undefined ? (hot ? 1 : 0.45) : t ? 1 - e * e : 1 - e
    const u = e === undefined ? 0 : Math.min(1, e / 0.5), pulse = t && e !== undefined ? Math.sin(u * Math.PI) : 0
    if (pulse > 0) {
      // Layered strokes stand in for shadowBlur, which cost a blur pass per frame.
      g.save(); g.strokeStyle = c.jade_lt
      for (const [lw, a] of [[14, 0.12], [9, 0.22], [4, 1]]) { g.globalAlpha = pulse * a; g.lineWidth = lw; path(); g.stroke() }
      g.restore()
      for (let j = 0; j < 7; j++) { const [px, py] = qp(r, Math.max(0, u - j * 0.03)); rect(g, A(px) - 1.5, B(py) - 1.5, 3, 3, j ? c.jade_lt : c.cloud) }
    }
    if (hot) { g.strokeStyle = e === undefined ? c.gold_dk : c.jade_dk; g.lineWidth = 2.5; path(); g.stroke() }
    g.strokeStyle = e === undefined ? (hot ? c.gold_lt : c.gold_dk) : c.jade_lt; g.lineWidth = hot ? 1.5 : 1; g.setLineDash([4, 2]); path(); g.stroke(); g.setLineDash([])
    if (hot) for (const [px, py] of [[sx, sy], [ex, ey]]) { rect(g, px - 2, py - 2, 4, 4, c.ink); rect(g, px - 1, py - 1, 2, 2, e === undefined ? c.gold_lt : c.jade_lt) }
    if (e === undefined && hot) {
      const v = t ? (t * 0.08 + i * 0.37) % 1 : 0.5, [lx, ly] = qp(r, v)
      g.globalAlpha = t ? Math.min(1, v * 6, (1 - v) * 6) : 1
      lantern(g, A(lx), B(ly) + 2, t, c)
    }
    g.restore()
  })
}
const pixArts = new Map<string, HTMLCanvasElement>()
const pixArt = (rows: string[], pal: Record<string, string>, ink: string) => {
  const key = rows[0] + ink + pal[rows[0].replace(/\./g, '')[0]]
  let cv = pixArts.get(key)
  if (!cv) pixArts.set(key, cv = pixCanvas(rows, pal, 1, ink))
  return cv
}

export const stateColor = (s: CourtState | undefined, c: C) =>
  s === 'working' ? c.gold : s === 'stuck' ? c.red : s === 'needs' ? c.red_lt : s === 'done' ? c.jade_lt : s === 'waiting' ? c.cloud_sh : '#8a8496'
const roleKey = (r?: string) => cast(r)
const roleColor = (r: string | undefined, c: C) => c[ROLE_KEY[roleKey(r)][0]]
const fmt = (ms: number) => {
  const s = Math.max(0, (ms / 1000) | 0), h = (s / 3600) | 0, m = ((s % 3600) / 60) | 0, p = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${p(m)}:${p(s % 60)}` : `${m}:${p(s % 60)}`
}
const timer = (n: CourtNode, now: number) => {
  const st = n.state ?? 'idle'
  return (st === 'working' || st === 'stuck' || st === 'needs') && n.since ? `${WORD[st]} ${fmt(now - n.since)}` : WORD[st]
}
const roleTag = (n: CourtNode) => `${n.role ?? 'lead'}${n.model ? ` · ${n.model}` : ''}`.toUpperCase()
const tally = (n: CourtNode) => `${n.runs ?? 0} ${n.runs === 1 ? 'run' : 'runs'} · ${n.shipped ?? 0} done`

// 12x16 chibi per role, hat by role, sash in the AI's color, outlined in ink.
const BODY = ['...hhhh...', '..hhhhhh..', '..hssssh..', '..sesses..', '..ssssss..', '...rrrr...', '..rrkkrr..', '.srrkkrrs.', '..rrrrrr..', '..rrrrrr..', '..ff..ff..']
const LEGS = ['..ff...f..', '...f..ff..']
// Cast: Journey to the West, one character per role; grid letters and pal in court-cast.ts.
import { ICONS, badgeOf, cast, castOf, type Cast, type Icon } from '@/lib/court-cast'
const AI_NAME: Record<string, string> = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini', jev: 'Jev', hermes: 'Hermes', perplexity: 'Perplexity', research: 'Research' }
const aiName = (ai = 'claude') => AI_NAME[ai] ?? ai
// Moved from: the chat's handover, or a desk run on another AI than its courtyard's.
const fromOf = (n: CourtNode, by: Map<string, CourtNode>) => {
  const y = by.get(n.parent ?? '')?.ai
  return n.from ?? (n.kind === 'desk' && n.ai && y && y !== n.ai ? y : undefined)
}
const aiIcon = (ai = 'claude') => ai === 'claude' || ai === 'codex' ? ICONS[ai] : undefined
// Grid of colors to a canvas with a 1px ink outline.
function paint(grid: Array<Array<string | undefined>>, ink: string) {
  const H = grid.length, W = grid[0].length, cv = document.createElement('canvas'); cv.width = W; cv.height = H
  const g = cv.getContext('2d')!
  g.fillStyle = ink
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
    if (!grid[y][x] && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => grid[y + dy]?.[x + dx])) g.fillRect(x, y, 1, 1)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (grid[y][x]) { g.fillStyle = grid[y][x]!; g.fillRect(x, y, 1, 1) }
  return cv
}
const badges = new Map<string, HTMLCanvasElement>()
// An Icon with its outline, top-left at x,y.
function badge(g: G, ic: Icon, x: number, y: number, c: C) {
  const key = `${ic.name}|${c.ink}`
  let cv = badges.get(key)
  if (!cv) {
    const grid = [[], ...ic.rows.map(r => [undefined, ...[...r].map(ch => { const k = ic.pal[ch]; return k ? c[k] : undefined }), undefined]), []]
      .map(r => Array.from({ length: ic.rows[0].length + 2 }, (_, i) => r[i]))
    badges.set(key, cv = paint(grid, c.ink))
  }
  g.drawImage(cv, x - 1, y - 1)
}
const sprites = new Map<string, HTMLCanvasElement>()
// Abyss divers wear a glass helmet with a brass collar.
const HELM = ['...wwwwww...', '..w......w..', '.w........w.', '.w........w.', '.w........w.', '.w........w.', '..w......w..', '...bbbbbb...']
// set: the kit's own cast, if it has one.
function sprite(role: string | undefined, ai: string | undefined, leg: number, c: C, helm = false, set?: Record<string, Cast>) {
  const r = roleKey(role), look = castOf(r, set), key = `${r}|${ai}|${leg}|${c.ink}|${helm}|${look.name}`
  const hit = sprites.get(key)
  if (hit) return hit
  const [r0, r1] = ROLE_KEY[r], W = 12, H = 16
  const col: Record<string, string> = { h: c.ink2, s: c.skin, e: c.ink, r: c[r0], k: c[AI_KEY[ai ?? ''] ?? 'red_lt'], f: c.ink, g: c.gold, c: c[r1], p: c.peach_dk, w: c.cloud }
  for (const [ch, k] of Object.entries(look.pal ?? {})) col[ch] = c[k!]
  const grid: Array<Array<string | undefined>> = Array.from({ length: H }, () => Array(W).fill(undefined))
  const put = (rows: string[], y0: number) => rows.forEach((row, y) => [...row].forEach((ch, x) => { if (col[ch] && grid[y0 + y]) grid[y0 + y][x + 1] = col[ch] }))
  const body = (look.body ?? BODY).slice()
  if (leg) body[10] = LEGS[leg - 1]
  put(body, 3); put(look.hat ?? [], 1); put(look.item ?? [], look.itemY ?? 3)
  if (helm) HELM.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.') grid[y][x] = ch === 'b' ? c.gold : c.blue_lt }))
  const cv = paint(grid, c.ink)
  sprites.set(key, cv)
  return cv
}

type G = CanvasRenderingContext2D
const rect = (g: G, x: number, y: number, w: number, h: number, col: string) => { g.fillStyle = col; g.fillRect(x | 0, y | 0, w | 0, h | 0) }
// Lacquered desk with a scroll and an inkstone; the lamp glows while the role works.
function desk(g: G, x: number, y: number, lit: boolean, c: C) {
  rect(g, x, y + 1, 24, 9, c.ink); rect(g, x + 1, y, 22, 9, c.brown); rect(g, x + 1, y, 22, 2, c.red_lt); rect(g, x + 1, y + 2, 22, 1, c.red); rect(g, x + 1, y + 8, 22, 2, c.brown_dk)
  rect(g, x + 4, y + 3, 10, 4, c.cloud); rect(g, x + 4, y + 3, 1, 4, c.gold_dk); rect(g, x + 13, y + 3, 1, 4, c.gold_dk); rect(g, x + 6, y + 4, 6, 1, c.cloud_sh)
  rect(g, x + 16, y + 4, 3, 3, c.ink2); rect(g, x + 20, y + 3, 2, 3, lit ? c.gold_lt : c.gold_dk)
  if (lit) { g.globalAlpha = 0.25; rect(g, x + 17, y, 8, 8, c.gold_lt); g.globalAlpha = 1 }
}
function bubble(g: G, x: number, y: number, st: CourtState | undefined, step: number, c: C) {
  if (!st || st === 'idle') return
  rect(g, x - 4, y - 7, 9, 7, c.ink); rect(g, x - 3, y - 8, 7, 7, c.cloud); rect(g, x, y - 1, 1, 2, c.ink)
  if (st === 'working' || st === 'stuck') { const hot = st === 'stuck'; rect(g, x - 1, y - 7, 1, 4, hot ? c.red : c.gold_dk); rect(g, x, y - 6, 2, 1, hot ? c.red_lt : c.gold); rect(g, x + 1, y - 7, 1, 1, step && !hot ? c.gold_lt : hot ? c.red : c.gold) }
  else if (st === 'waiting') [-2, 0, 2].forEach((d, i) => rect(g, x + d, y - 4, 1, 1, (step + i) % 3 ? c.cloud_sh : c.ink2))
  else if (st === 'done') [[-2, -4], [-1, -3], [0, -4], [1, -5], [2, -6]].forEach(([dx, dy]) => rect(g, x + dx, y + dy, 1, 1, c.jade))
  // Needs you in the legend's needs color, so it never reads as stuck.
  else { rect(g, x - 3, y - 8, 7, 7, c.red_lt); rect(g, x, y - 7, 1, 3, c.ink); rect(g, x, y - 3, 1, 1, c.ink) }
}
// Zzz rising off an idle sprite, one letter a second; all three when still.
// The done burst: pixel bits fanning out from the sprite and dropping as they go.
function confetti(g: G, x: number, y: number, cheer: number, c: C) {
  CONFETTI.forEach((col, i) => {
    for (const j of [0, 1]) {
      const a = i * 1.26 + j * 0.6, r = 4 + cheer * (12 + j * 4)
      rect(g, x + Math.cos(a) * r, y - 10 + Math.sin(a) * r * 0.8 + cheer * cheer * 10, 1, 1, c[col])
    }
  })
}
function zzz(g: G, x: number, y: number, t: number, c: C) {
  const n = t ? Math.floor(t) % 3 : 2
  for (let i = 0; i <= n; i++) {
    const zx = x + 4 + i * 3, zy = y - 4 - i * 4, s = i < 2 ? 3 : 4
    rect(g, zx - 1, zy - 1, s + 2, s + 2, c.ink)
    rect(g, zx, zy, s, 1, c.cloud); rect(g, zx, zy + s - 1, s, 1, c.cloud)
    for (let d = 1; d < s - 1; d++) rect(g, zx + s - 1 - d, zy + d, 1, 1, c.cloud)
  }
}

// A yard can hang off a sibling yard; its home is the first non-yard up the chain.
const homeOf = (court: Court, n: CourtNode) => { let p = n.parent; for (let i = 0; i < 99 && p?.startsWith('yard:'); i++) p = court.nodes.find(m => m.id === p)?.parent; return p }

/** Everything that only changes with the layout: sky, bridges, islands, halls. Drawn once per layout at one art pixel per pixel. */
// The newer ring places: an island and one small landmark each, centered on x, y.
function placeArt(g: G, n: CourtNode, island: (n: CourtNode, top: string, rim: string, plaza: boolean) => void, c: C, x: number, y: number) {
  if (n.kind === 'library') {
    // Archive hall: red roof, stone walls, scroll racks.
    island(n, c.stone_dk, c.stone, false)
    rect(g, x - 26, y - 22, 52, 8, c.ink); rect(g, x - 25, y - 21, 50, 6, c.red); rect(g, x - 25, y - 21, 50, 2, c.red_lt)
    rect(g, x - 22, y - 14, 44, 20, c.ink); rect(g, x - 21, y - 13, 42, 18, c.cloud_sh)
    for (let i = 0; i < 6; i++) { rect(g, x - 19 + i * 7, y - 11, 5, 5, i % 2 ? c.gold_lt : c.cloud); rect(g, x - 19 + i * 7, y - 4, 5, 5, i % 3 ? c.cloud : c.peach) }
    rect(g, x - 3, y + 1, 6, 5, c.wood_dk)
  } else if (n.kind === 'notice') {
    island(n, c.jade, c.jade_lt, false)
    rect(g, x - 20, y - 18, 3, 26, c.wood_dk); rect(g, x + 17, y - 18, 3, 26, c.wood_dk)
    rect(g, x - 22, y - 20, 44, 18, c.ink); rect(g, x - 21, y - 19, 42, 16, c.wood)
    for (const [dx, dy, col] of [[-18, -17, c.cloud], [-8, -16, c.gold_lt], [3, -17, c.cloud], [12, -15, c.peach]] as const) { rect(g, x + dx, y + dy, 7, 9, col); rect(g, x + dx + 3, y + dy, 1, 1, c.red) }
  } else if (n.kind === 'tower') {
    island(n, c.stone_dk, c.stone, false)
    rect(g, x - 7, y - 30, 14, 36, c.ink); rect(g, x - 6, y - 29, 12, 34, c.cloud_sh); rect(g, x - 6, y - 29, 12, 3, c.red)
    rect(g, x - 3, y - 38, 6, 8, c.ink); rect(g, x - 2, y - 37, 4, 6, c.gold_lt)
    rect(g, x - 2, y - 18, 4, 5, c.ink)
  } else if (n.kind === 'study') {
    island(n, c.jade, c.jade_lt, false)
    rect(g, x - 18, y - 6, 36, 8, c.ink); rect(g, x - 17, y - 5, 34, 6, c.wood); rect(g, x - 15, y + 2, 3, 6, c.wood_dk); rect(g, x + 12, y + 2, 3, 6, c.wood_dk)
    rect(g, x - 11, y - 12, 22, 7, c.ink); rect(g, x - 10, y - 11, 9, 5, c.cloud); rect(g, x + 1, y - 11, 9, 5, c.cloud); rect(g, x - 8, y - 9, 5, 1, c.cloud_sh); rect(g, x + 3, y - 9, 5, 1, c.cloud_sh)
  } else if (n.kind === 'treasury') {
    island(n, c.stone_dk, c.stone, false)
    rect(g, x - 16, y - 14, 32, 20, c.ink); rect(g, x - 15, y - 13, 30, 18, c.wood); rect(g, x - 15, y - 13, 30, 6, c.wood_dk)
    rect(g, x - 15, y - 7, 30, 2, c.gold); rect(g, x - 3, y - 9, 6, 7, c.gold_lt); rect(g, x - 1, y - 6, 2, 2, c.ink)
  } else if (n.kind === 'uploads') {
    // Scroll rack: a wood frame, two shelves of rolled scrolls.
    if (!n.list?.length) return
    island(n, c.stone_dk, c.stone, false)
    rect(g, x - 20, y - 18, 40, 26, c.ink); rect(g, x - 19, y - 17, 38, 24, c.wood_dk)
    for (const sy of [-15, -4]) {
      rect(g, x - 19, sy + 8, 38, 2, c.wood)
      for (let i = 0; i < 5; i++) { rect(g, x - 16 + i * 7, sy, 5, 8, i % 2 ? c.peach_lt : c.cloud); rect(g, x - 16 + i * 7, sy + 3, 5, 1, i % 3 ? c.red : c.gold) }
    }
  } else if (n.kind === 'maps') {
    island(n, c.jade, c.jade_lt, false)
    rect(g, x - 20, y - 14, 40, 20, c.ink); rect(g, x - 19, y - 13, 38, 18, c.peach_lt)
    rect(g, x - 21, y - 15, 4, 22, c.wood_dk); rect(g, x + 17, y - 15, 4, 22, c.wood_dk)
    for (const [dx, dy] of [[-12, -8], [-6, -4], [0, -7], [6, -2], [11, -6]]) rect(g, x + dx, y + dy, 3, 2, c.red)
    rect(g, x - 14, y - 2, 6, 4, c.jade); rect(g, x + 4, y - 11, 7, 4, c.jade)
  }
}
function bake(court: Court, c: C, sig: string, kit: ArtKit, part?: Part): Frame {
  const xs: number[] = [], ys: number[] = []
  for (const n of court.nodes) xs.push(n.x, n.x + n.w), ys.push(n.y, n.y + n.h)
  for (const l of court.links) for (const [x, y] of l.points) xs.push(x), ys.push(y)
  const pad = 200, x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad, x1 = Math.max(...xs) + pad, y1 = Math.max(...ys) + pad
  // A court too big for BAKE_PX at the kit's res bakes coarser instead of blowing the canvas limit.
  let res = resOf(kit)
  const area = (x1 - x0) * (y1 - y0) / (res * res)
  if (area > BAKE_PX) res *= Math.sqrt(area / BAKE_PX)
  const w = Math.ceil((x1 - x0) / res), h = Math.ceil((y1 - y0) / res)
  // Enough canvas px for one per device px at MAX_Z, within what BAKE_PX leaves.
  const dpr = Math.min(matchMedia('(pointer: coarse)').matches ? COARSE_DPR : MAX_DPR, devicePixelRatio || 1)
  const q = part?.q ?? (kit.smooth ? Math.max(1, Math.min(MAX_Z * dpr * res, Math.sqrt(BAKE_PX / (w * h)))) : 1)
  const cv = document.createElement('canvas')
  cv.width = Math.ceil((part?.w ?? w) * q); cv.height = Math.ceil((part?.h ?? h) * q)
  const g = cv.getContext('2d')!, A = (x: number) => (x - x0) / res, B = (y: number) => (y - y0) / res, u = Math.max(1, ART / res)
  g.scale(q, q)
  if (part) g.translate(-part.x, -part.y)
  kit.bakeSky(g, w, h, c)
  const by = new Map(court.nodes.map(n => [n.id, n]))
  // Bridges: planks with red rail posts.
  for (const l of court.links) {
    if (by.get(l.to)?.kind === 'desk' || by.get(l.to)?.kind === 'realm') continue
    const w = by.get(l.from)?.kind === 'council' ? 7 : 5
    for (let i = 1; i < l.points.length; i++) {
      const ax = A(l.points[i - 1][0]), ay = B(l.points[i - 1][1]), bx = A(l.points[i][0]), by2 = B(l.points[i][1])
      g.lineCap = 'butt'
      kit.bridgeBase(g, ax, ay, bx, by2, w, c)
      kit.bridgeDeck(g, ax, ay, bx, by2, w, c)
    }
  }
  const island = (n: CourtNode, top: string, rim: string, plaza: boolean) => {
    const x = A(n.x + n.w / 2), y = B(n.y + n.h / 2), rx = (n.w / res / 2) * 1.08, ry = (n.h / res / 2) * 1.1, depth = Math.min(16, Math.round(ry * 0.3))
    const K = kit.islandColors(top, rim, c)
    top = K.top; rim = K.rim
    if (kit.island) return kit.island(g, x, y, rx, ry, depth, top, rim, plaza, c)
    kit.islandUnder(g, x, y, rx, ry, depth, c)
    for (let d = depth; d > 0; d--) { g.fillStyle = d > depth * 0.66 ? c.wood_dk : d > depth * 0.33 ? c.wood : c.wood_lt; g.beginPath(); g.ellipse(x, y + d, rx * (1 - d * 0.012), ry, 0, 0, 7); g.fill() }
    g.fillStyle = c.ink; g.beginPath(); g.ellipse(x, y, rx + 1, ry + 1, 0, 0, 7); g.fill()
    g.fillStyle = rim; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, 7); g.fill()
    g.fillStyle = top; g.beginPath(); g.ellipse(x, y + 1, rx - 1, ry - 2, 0, 0, 7); g.fill()
    const dots = (rx * ry) / 14
    for (let i = 0; i < dots; i++) { const a = i * 2.4, r = Math.sqrt(i / dots); rect(g, x + Math.cos(a) * r * rx * 0.9, y + Math.sin(a) * r * ry * 0.85, 1, 1, K.dot) }
    kit.islandTop(g, x, y, rx, ry, c)
    if (!plaza) return
    const px = rx * 0.82, py = ry * 0.76
    g.fillStyle = c.stone_dk; g.beginPath(); g.ellipse(x, y + 1, px, py, 0, 0, 7); g.fill()
    g.fillStyle = c.stone; g.beginPath(); g.ellipse(x, y, px, py, 0, 0, 7); g.fill()
    for (let yy = -py + 3; yy < py; yy += 5) { const half = px * Math.sqrt(1 - (yy / py) ** 2); rect(g, x - half, y + yy, half * 2, 1, c.stone_ln) }
  }
  // A hall: walls, a beam in its color, one roof tier per rank.
  const hall = (n: CourtNode, w: number, roof: [string, string, string], walls: string, tiers: number, beam: string, dx = 0) => {
    const x = Math.round(A(n.x + n.w / 2) - w / 2) + dx, y = Math.round(B(n.y + n.h / 2)) - 26
    if (kit.hall) return kit.hall(g, x, y, w, roof, walls, tiers, beam, c)
    rect(g, x - 1, y + 8, w + 2, 20, c.ink); rect(g, x, y + 8, w, 19, walls)
    kit.hallWalls(g, x, y, w, c)
    rect(g, x + w / 2 - 4, y + 17, 8, 10, c.wood_dk); rect(g, x, y + 8, w, 2, beam); rect(g, x, y + 10, w, 1, c.azure)
    kit.hallRoof(g, x, y, w, tiers, roof, c)
  }
  const shipped = court.nodes.reduce((s, n) => s + (n.kind === 'desk' ? n.shipped ?? 0 : 0), 0)
  for (const n of court.nodes) {
    if (n.kind === 'council') {
      island(n, c.jade, c.jade_lt, true); hall(n, 70, [c.roof, c.roof_dk, c.roof_lt], c.hall, 2, c.beam)
      // The golden-banded staff planted by the hall, lanterns on the eaves; a beacon mast under the sea.
      const hx = Math.round(A(n.x + n.w / 2)), hy = Math.round(B(n.y + n.h / 2))
      kit.councilMast(g, hx, hy, c)
      // Gate studs: 9 by 9, one per shipped run.
      const sx = Math.round(A(n.x + n.w / 2)) + 42, sy = Math.round(B(n.y + n.h / 2)) + 4
      grow(g, u, sx, sy, (sx, sy) => { for (let i = 0; i < 81; i++) rect(g, sx + (i % 9) * 3, sy + Math.floor(i / 9) * 3, 2, 2, i < shipped ? c.roof : c.stone_dk) })
    } else if (n.kind === 'pavilion') {
      // An AI with a realm stands its realm's landmark beside the hall, so pavilion and realm read as one system.
      const own = REALM[n.ai ?? ''] ? realmOf(n.ai, kit) : undefined
      island(n, c.jade, c.jade_lt, false); hall(n, 40, [c.azure, c.azure_dk, c.azure_lt], c.wood, 1, c[AI_KEY[n.ai ?? ''] ?? 'cloud'], own ? -10 : 0)
      if (own) (kit.landmark ?? landmark)(g, n.ai, Math.round(A(n.x + n.w / 2)) + 28, Math.round(B(n.y + n.h / 2)) + 4, own, c)
    }
    else if (n.kind === 'window') {
      island(n, c.jade, c.jade_lt, false)
      // Banner on a pole in the window's color; here gets a gold finial.
      const x = Math.round(A(n.x + n.w / 2)) - 10, y = Math.round(B(n.y + n.h / 2)) - 30, flag = WIN[n.color ?? ''] ?? c.stone
      grow(g, u, x, y, (x, y) => {
        rect(g, x - 1, y - 1, 4, 34, c.ink); rect(g, x, y, 2, 32, c.wood_dk); rect(g, x - 2, y + 31, 6, 3, c.ink)
        rect(g, x + 2, y + 1, 22, 15, c.ink); rect(g, x + 3, y + 2, 20, 13, flag); rect(g, x + 3, y + 2, 20, 2, 'rgba(255,255,255,.3)')
        rect(g, x + 21, y + 8, 3, 3, c.ink)
        if (n.here) { rect(g, x - 2, y - 4, 6, 4, c.ink); rect(g, x - 1, y - 3, 4, 2, c.gold_lt) }
      })
      if (n.here) (kit.badge ?? badge)(g, ICONS.kenneth, x + 10, y + 5, c)
    }
    else if (n.kind === 'courtyard') { if (REALM[n.ai ?? '']) realmIsle(g, n, undefined, c, A, B, deskCount(court, n), kit, res); else island(n, c.jade, c.jade_lt, true) }
    else if (n.kind === 'realm') realmIsle(g, n, by.get(n.parent ?? ''), c, A, B, undefined, kit, res)
    else if (n.kind === 'garden' && !kit.placeArt) {
      island(n, c.jade, c.jade_lt, false)
      const x = A(n.x + n.w / 2), y = B(n.y + n.h / 2)
      grow(g, u, x, y, (x, y) => {
        for (const [dx, dy, r] of [[-18, -6, 8], [-24, -2, 5], [-12, -2, 5]]) { g.fillStyle = c.peach_dk; g.beginPath(); g.arc(x + dx, y + dy, r, 0, 7); g.fill() }
        g.fillStyle = c.peach; g.beginPath(); g.arc(x - 19, y - 8, 5, 0, 7); g.fill(); rect(g, x - 19, y, 2, 6, c.brown_dk)
      })
    } else if (n.kind === 'armory' && !kit.placeArt) {
      island(n, c.stone_dk, c.stone, false)
      const x = Math.round(A(n.x + n.w / 2)) - 22, y = Math.round(B(n.y + n.h / 2)) - 14
      grow(g, u, x, y, (x, y) => {
        rect(g, x, y, 44, 18, c.ink); rect(g, x + 1, y + 1, 42, 16, c.wood)
        const books = [c.cloud, c.gold, c.jade, c.red_lt, c.blue_lt, c.gold_lt, c.peach, c.cloud_sh]
        for (let s = 0; s < 2; s++) { rect(g, x + 2, y + 8 + s * 8, 40, 1, c.wood_dk); for (let i = 0; i < 8; i++) rect(g, x + 3 + i * 5, y + 2 + s * 8, 3, 6, books[(i + s * 3) % 8]) }
      })
    } else if (isPlace(n.kind)) (kit.placeArt ?? placeArt)(g, n, island, c, Math.round(A(n.x + n.w / 2)), Math.round(B(n.y + n.h / 2)))
  }
  return { ox: x0, oy: y0, cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2, cv, sig, res, q, px: part?.x ?? 0, py: part?.y ?? 0 }
}
// Only what bake draws: big nodes, bridges and the stud count. Timers and states change every second and stay out of it.
const sigOf = (court: Court, skin: string) => skin + 'v2' + court.nodes.filter(n => BIG.has(n.kind)).map(n => `${n.id}${n.x},${n.y},${n.w},${n.h}${n.color ?? ''}${n.here ? '!' : ''}`).join() + court.links.length +
  court.nodes.reduce((s, n) => s + (n.kind === 'desk' ? n.shipped ?? 0 : 0), 0)

// Sky: dithered bands, dawn at the bottom, on screen so it never ends at the court's edge. One 8px strip, repeated across.
let sky: { key: string; cv: HTMLCanvasElement; pat?: CanvasPattern | null; g?: G } | undefined
// The repeat pattern is made once per strip and context, not every frame.
function skyFill(g: G, h: number, bands: string[]) {
  const cv = skyStrip(h, bands)
  if (sky!.g !== g || !sky!.pat) { sky!.pat = g.createPattern(cv, 'repeat-x'); sky!.g = g }
  return sky!.pat!
}
function skyStrip(h: number, bands: string[]) {
  const key = h + bands.join()
  if (sky?.key === key) return sky.cv
  const cv = document.createElement('canvas'); cv.width = 8; cv.height = h
  const g = cv.getContext('2d')!
  for (let y = 0; y < h; y++) {
    const f = (y / h) * (bands.length - 1), i = Math.floor(f), t = f - i
    for (let x = 0; x < 8; x += 2) rect(g, x, y, 2, 1, bands[Math.min(bands.length - 1, i + (t > (((x >> 1) + y) % 4) / 4 + 0.12 ? 1 : 0))])
  }
  sky = { key, cv }
  return cv
}

const cuts = new Map<string, string>()
function fit(g: G, s: string, max: number) {
  const key = g.font + max + s
  let r = cuts.get(key)
  if (r === undefined) {
    r = s
    if (g.measureText(r).width > max) { while (r.length > 1 && g.measureText(r + '…').width > max) r = r.slice(0, -1); r = r.trimEnd() + '…' }
    if (cuts.size > 4000) cuts.clear()
    cuts.set(key, r)
  }
  return r
}
const widths = new Map<string, number>()
function wid(g: G, font: string, s: string) {
  const key = font + s
  let w = widths.get(key)
  if (w === undefined) { g.font = font; w = g.measureText(s).width; if (widths.size > 4000) widths.clear(); widths.set(key, w) }
  return w
}
// Lookups that only change with the court, built once per court instead of per frame.
const indexes = new WeakMap<Court, { by: Map<string, CourtNode>; kids: Map<string, CourtNode[]>; desks: CourtNode[]; sub: string }>()
function index(court: Court) {
  let ix = indexes.get(court)
  if (!ix) {
    const by = new Map(court.nodes.map(n => [n.id, n])), kids = new Map<string, CourtNode[]>(), desks = court.nodes.filter(n => n.kind === 'desk')
    for (const n of court.nodes) if (n.parent) kids.set(n.parent, [...kids.get(n.parent) ?? [], n])
    const sub = courtSummary(court)
    ix = { by, kids, desks, sub }; indexes.set(court, ix)
  }
  return ix
}
function text(g: G, s: string, x: number, y: number, font: string, col: string, max: number, align: CanvasTextAlign = 'left') {
  g.font = font; g.fillStyle = col; g.textAlign = align; g.fillText(fit(g, s, max), x, y)
}
// A hard pixel shadow under every plate keeps it apart from the busy sky.
const SHADE = 'rgba(6,4,16,.45)'
function card(g: G, x: number, y: number, w: number, h: number, edge: string, hot = false) {
  g.fillStyle = SHADE; g.beginPath(); g.roundRect(x + 2, y + 2, w, h, CH.radius); g.fill()
  g.fillStyle = PLATE_BG; g.beginPath(); g.roundRect(x, y, w, h, CH.radius); g.fill()
  g.strokeStyle = hot ? edge : CH.edge; g.lineWidth = hot ? 1.5 : 1; g.stroke()
}

/** inset: CSS px the tool belt (left), bottom bars and the side panel (right) cover, from the last Fit. */
type St = { court: Court; frame?: Frame; /** Smooth kits zoomed past the frame's q: the view rebaked sharp. */ detail?: Frame; detailKey?: string; detailT?: ReturnType<typeof setTimeout>; wake?: () => void; kit: ArtKit; night: boolean; /** Ambient clock: holds still while nothing animates, so the 1 s tick never steps the kelp or stars. */ ta: number; inset?: [number, number, number]; view: View; zc: number; colors: C; chrome?: Chrome; bands: string[]; picked?: string; pet?: { id: string; at: number }; hits: Box[]; fx: Map<string, Fx>; hover?: string
  /** over: any hit under the mouse; ropes: live wait ropes; ends: ropes playing their end flash; waits: chats waiting on another. */
  over?: string; ropes: Rope[]; ends: Map<string, { r: Rope; at: number }>; waits: Set<string> } & PauseFx
/** Where the petitioning lead is on its path: world point, and whether it still walks. */
function walker(court: Court, pet: St['pet'], now: number, still: boolean): [number, number, boolean] | undefined {
  const path = court.petition?.path
  if (!path?.length || !pet) return undefined
  let d = still ? Infinity : ((now - pet.at) / 1000) * WALK
  for (let i = 1; i < path.length; i++) {
    const [x0, y0] = path[i - 1], [x1, y1] = path[i], l = Math.hypot(x1 - x0, y1 - y0)
    if (d <= l) return [x0 + ((x1 - x0) * d) / (l || 1), y0 + ((y1 - y0) * d) / (l || 1), true]
    d -= l
  }
  return [...path[path.length - 1], false]
}

// The 12x16 sprite's box from its anchor at the feet: heads run 22 up to 2 down, the tap check uses its 16 px height.
const SPRITE: FigureBox = { top: 22, bottom: 2, half: 7, tall: 16 }
// A frozen figure: the kit's figure drawn once per pose, washed in ice, cached by pose and scale. The pad comes from the kit's box.
const ICE_PX = 3e6
type IceFig = Sized & { cv: HTMLCanvasElement; box: FigureBox; pad: ReturnType<typeof figurePad> }
type IceCache = { get(k: string): IceFig | undefined; put(k: string, v: IceFig): void }
const iceCache = new WeakMap<object, IceCache>()
function iceFigure(fig: NonNullable<ArtKit['figure']>, g: G, x: number, y: number, k: number, p: FigurePose, c: C): FigureBox {
  let cache = iceCache.get(fig)
  if (!cache) { cache = makeCache<IceFig>(ICE_PX); iceCache.set(fig, cache) }
  // Power-of-two scale so a smooth zoom reuses the bake instead of a new canvas per frame.
  k = 2 ** Math.ceil(Math.log2(Math.max(k, 0.25)))
  const key = `${k}|${p.role}|${p.ai}|${p.state}|${p.leg}|${c.ink}`
  let e = cache.get(key)
  if (!e) {
    const q = { ...p, t: 0, frozen: true }
    const box = fig(document.createElement('canvas').getContext('2d')!, 0, 0, q, c), pad = figurePad(box)
    const cv = document.createElement('canvas')
    cv.width = Math.ceil(pad.x * 2 * k); cv.height = Math.ceil((pad.up + pad.down) * k)
    const o = cv.getContext('2d')!
    o.setTransform(k, 0, 0, k, pad.x * k, pad.up * k)
    fig(o, 0, 0, q, c)
    o.setTransform(1, 0, 0, 1, 0, 0); o.globalCompositeOperation = 'source-atop'; o.fillStyle = 'rgba(150,212,245,.55)'; o.fillRect(0, 0, cv.width, cv.height)
    e = { cv, box, pad, width: cv.width, height: cv.height }
    cache.put(key, e)
  }
  g.drawImage(e.cv, x - e.pad.x, y - e.pad.up, e.pad.x * 2, e.pad.up + e.pad.down)
  return e.box
}

// Zoomed in past the frame's q, bake the view (plus a margin) at the zoom once it holds still for 200 ms.
function detailFor(s: St, F: Frame, k: number, x0: number, y0: number, x1: number, y1: number, inD: boolean) {
  if (k <= F.q * 1.2) { s.detail = undefined; clearTimeout(s.detailT); s.detailKey = undefined; return }
  if (inD && s.detail!.q >= k * 0.9) { clearTimeout(s.detailT); s.detailKey = undefined; return }
  const mx = (x1 - x0) / 4, my = (y1 - y0) / 4, fw = F.cv.width / F.q, fh = F.cv.height / F.q
  const x = Math.max(0, x0 - mx), y = Math.max(0, y0 - my), w = Math.min(fw, x1 + mx) - x, h = Math.min(fh, y1 + my) - y
  if (w <= 0 || h <= 0) return
  const key = `${F.sig}|${k}|${Math.round(x)},${Math.round(y)}`
  if (key === s.detailKey) return
  s.detailKey = key; clearTimeout(s.detailT)
  s.detailT = setTimeout(() => {
    if (s.frame !== F) return
    s.detail = bake(s.court, s.colors, F.sig, s.kit, { x, y, w, h, q: Math.min(k, Math.sqrt(BAKE_PX / (w * h))) }); s.wake?.()
  }, 200)
}

function draw(s: St, g: G, W: number, H: number, dpr: number, t: number, now: number, wall: number) {
  useChrome(s.chrome ?? DEFAULT_CHROME)
  const { court, frame: F, view: v, colors: c } = s, hits: Box[] = []
  s.hits = hits
  g.setTransform(1, 0, 0, 1, 0, 0); g.imageSmoothingEnabled = false
  const sk = Math.max(1, Math.round(resOf(s.kit) * dpr))
  g.setTransform(sk, 0, 0, sk, 0, 0); g.fillStyle = skyFill(g, Math.ceil(H / sk), s.bands); g.fillRect(0, 0, W / sk + 1, H / sk + 1)
  s.kit.backdrop(g, W / sk, H / sk, s.ta, (v.x * dpr) / sk, c, s.night)
  g.setTransform(1, 0, 0, 1, 0, 0)
  if (!F) return
  const k = v.z * dpr * F.res, X0 = Math.round(v.x * dpr), Y0 = Math.round(v.y * dpr), u = Math.max(1, ART / F.res)
  const sx0 = Math.max(0, Math.floor(-X0 / k)), sy0 = Math.max(0, Math.floor(-Y0 / k))
  const sx1 = Math.min(F.cv.width / F.q, Math.ceil((W - X0) / k)), sy1 = Math.min(F.cv.height / F.q, Math.ceil((H - Y0) / k))
  g.imageSmoothingEnabled = !!s.kit.smooth
  const D = s.detail, inD = D?.sig === F.sig && sx0 >= D.px && sy0 >= D.py && sx1 <= D.px + D.cv.width / D.q && sy1 <= D.py + D.cv.height / D.q
  const S = inD ? D : F
  if (s.kit.smooth) detailFor(s, F, k, sx0, sy0, sx1, sy1, inD)
  if (sx1 > sx0 && sy1 > sy0) g.drawImage(S.cv, (sx0 - S.px) * S.q, (sy0 - S.py) * S.q, (sx1 - sx0) * S.q, (sy1 - sy0) * S.q, X0 + sx0 * k, Y0 + sy0 * k, (sx1 - sx0) * k, (sy1 - sy0) * k)
  const A = (x: number) => (x - F.ox) / F.res, B = (y: number) => (y - F.oy) / F.res
  const X = (x: number) => (X0 + A(x) * k) / dpr, Y = (y: number) => (Y0 + B(y) * k) / dpr, cw = W / dpr, ch = H / dpr
  const seen = (n: { x: number; y: number; w: number; h: number }, m = 160) => X(n.x + n.w) > -m && X(n.x) < cw + m && Y(n.y + n.h) > -m && Y(n.y) < ch + m
  const boxOf = (n: CourtNode): Box => ({ x: X(n.x), y: Y(n.y), w: n.w * v.z, h: n.h * v.z, id: n.id })
  const { by, kids, desks, sub: councilSub } = index(court)
  for (const n of court.nodes) if (BIG.has(n.kind)) hits.push(boxOf(n))
  const step = t ? Math.floor(t * STEP_HZ) % 2 : 0
  const walk = walker(court, s.pet, now, !t)
  // Art px to CSS px; a sprite is tappable once it is at least 12px tall on screen.
  const P = (a: number) => (X0 + a * k) / dpr, Q = (b: number) => (Y0 + b * k) / dpr, ak = k / dpr
  const heads = new Map<string, [number, number, number, number]>()
  const sprHit = (id: string, x: number, y: number, b: FigureBox) => {
    heads.set(id, [P(x), Q(y - b.top), Q(y + b.bottom), b.half * ak])
    if (ak * b.tall >= 12) hits.push({ x: P(x - b.half), y: Q(y - b.top - 1), w: 2 * b.half * ak, h: (b.top + b.bottom + 1) * ak, id: `spr:${id}` })
  }
  // A desk's figure at anchor (x, y): the kit's figure hook, or the 12x16 sprite. Returns the box its offsets follow.
  const figure = (role: string | undefined, ai: string | undefined, x: number, y: number, leg: number, state: CourtState | undefined, frozen: boolean): FigureBox => {
    const fig = s.kit.figure
    if (fig) return frozen ? iceFigure(fig, g, x, y, k, { role, ai, leg, state, t: 0, frozen }, c) : fig(g, x, y, { role, ai, leg, state, t, frozen }, c)
    const sp = sprite(role, ai, leg, c, s.kit.helm, s.kit.cast)
    g.drawImage(frozen ? iced(sp) : sp, x - 6, y - 14)
    return SPRITE
  }
  // Live fx by sprite; a meet also moves its lead. Spent ones drop out so the loop can stop.
  const live = new Map<string, [Fx, number]>(), meets = new Map<string, string>()
  for (const [id, f] of s.fx) {
    const p = (now - f.at) / 1000 / DUR[f.kind]
    if (p >= 1 || p < 0) { s.fx.delete(id); continue }
    if (!t) continue
    live.set(id, [f, p])
    if (f.lead) meets.set(f.lead, id)
  }
  // Out, a beat together, back: 0..1..0.
  const reach = (p: number) => (p < 0.35 ? p / 0.35 : p < 0.65 ? 1 : (1 - p) / 0.35)

  for (const [key, x] of s.ends) if (now - x.at >= END_S * 1000) s.ends.delete(key)
  const te = s.thaw === undefined ? 0 : (now - s.thaw) / 1000 / THAW_S
  if (te >= 1) { s.pause = undefined; s.thaw = undefined }
  const th = s.pause ? thawAt(te, !t) : undefined, held = th ? heldChats(s.pause) : new Set<string>()
  const hotChats = [s.hover, s.over, s.picked].map(id => id ? chatOf(court, id) : undefined)
  const awake = (r: Rope) => ropeAwake(r, v.z, hotChats), sp = spans(by, s.ropes, s.ends, now)
  // Art layer, in art pixels.
  g.setTransform(k, 0, 0, k, X0, Y0)
  // A drifting cloud skips the stretch where it would cover an island (it hid the treasury chest).
  if (t) for (let i = 0; i < 7; i++) {
    const x = ((i * 311 + s.ta * (i % 3 ? 5 + i * 2 : 2.5)) % (F.cv.width / F.q + 120)) - 60, y = ((i + 0.5) / 7) * F.cv.height / F.q, r = 9 + (i % 3) * 3
    if (court.nodes.some(n => BIG.has(n.kind) && x + 2.7 * r > A(n.x) && x - r < A(n.x + n.w) && y + 1.4 * r > B(n.y) && y - 1.4 * r < B(n.y + n.h))) continue
    s.kit.drift(g, x, y, r, s.ta, i, c)
  }
  // A working realm's landmark breathes; still under reduced motion (t is 0).
  for (const n of court.nodes) {
    if (!(n.kind === 'realm' || (n.kind === 'courtyard' && REALM[n.ai ?? ''])) || n.state !== 'working' || !seen(n)) continue
    const [mx, my] = markAt(n, A, B, F.res, n.kind === 'courtyard' ? deskCount(court, n) : undefined), R = realmOf(n.ai, s.kit)
    ell(g, mx, my - 18, 15, 20, R.glow, 0.16 + (t ? 0.12 * Math.sin(t * 2.4) : 0.06)); ell(g, mx, my - 18, 8, 11, R.hi, 0.18 + (t ? 0.1 * Math.sin(t * 2.4) : 0))
  }
  if (th) iceYards(g, by, held, th, A, B, F.res)
  for (let di = 0; di < desks.length; di++) {
    const n = desks[di]
    if (!seen(n, 40)) continue
    const x = Math.round(A(n.x + n.w / 2)), y = Math.round(B(n.y + n.h / 2)), busy = n.state === 'working' || n.state === 'needs'
    const tea = by.get(n.parent ?? '')?.kind === 'garden', away = !!walk && court.petition?.deskId === n.id
    const ai = n.ai ?? by.get(n.parent ?? '')?.ai
    // Busy roles bounce with the step clock; the rest breathe, a pixel down now and then, each on its own beat.
    let sx = x, sy = y, leg = 0, bob = busy && step ? -1 : !busy && t && Math.sin(t * 2.2 + di * 1.7) > 0.6 ? 1 : 0, cheer = -1, lift = 0, scroll: [number, number] | undefined
    const fx = live.get(n.id), own = fx?.[0].kind === 'meet' ? fx : undefined, mate = own ? own[0].lead : meets.get(n.id)
    const meet = own ?? (mate ? live.get(mate) : undefined), other = mate ? by.get(mate) : undefined
    if (meet && other) {
      const m = reach(meet[1]), ox = A(other.x + other.w / 2), oy = B(other.y + other.h / 2), dx = ox - x, dy = oy - y, len = Math.hypot(dx, dy) || 1, go = Math.max(0, len / 2 - 8) * m
      const wf = walkFrame(t), moving = m > 0 && m < 1
      sx = Math.round(x + (dx / len) * go); sy = Math.round(y + (dy / len) * go); leg = moving ? WALK_LEGS[wf] : 0; bob = moving && wf % 2 ? -1 : 0
      // Together for a beat: the lead holds out the brief.
      if (m === 1 && !own) scroll = [Math.round((x + ox) / 2), Math.round((y + oy) / 2) - 9]
    } else if (fx?.[0].kind === 'hop') bob = -Math.round(Math.sin(Math.PI * fx[1]) * 5)
    else if (fx?.[0].kind === 'cheer') { bob = -Math.round(Math.abs(Math.sin(Math.PI * fx[1] * 3)) * 4); cheer = fx[1] }
    else if (fx?.[0].kind === 'arrive' && !away) { lift = s.kit.arrive(g, x, y, fx[1], t, c); bob = -lift }
    // Held by the pause: frozen mid pose. Waiting: the lead sits by its hourglass.
    const seat = !n.chatId ? undefined : held.has(n.chatId) && th?.frozen ? 'pause' : n.role === 'lead' && s.waits.has(n.chatId) ? 'wait' : undefined
    if (seat) bob = 0
    if (seat === 'wait') sy += 3
    if (!away) {
      const helm = s.kit.helm
      if (helm && seat !== 'pause') glowAt(g, roleColor(n.role, c), sx, sy - 7 + bob, 13, 0.3 + (t ? 0.08 * Math.sin(t * 2 + di) : 0))
      if (n.state === 'needs' && !lift) s.kit.ping(g, sx, sy, t, c)
      const box = figure(n.role, ai, sx, sy + bob, leg, n.state, seat === 'pause')
      // Badges: the AI on the left shoulder, the state on the right.
      const aic = aiIcon(ai), sb = badgeOf(n.state), bd = s.kit.badge ?? badge
      if (aic) bd(g, aic, sx - box.half - 5, sy - box.top + 10 + bob, c)
      // A job handed to another AI than its chat's: a gold arrow into the badge.
      if (aic && fromOf(n, by)) { rect(g, sx - box.half - 10, sy - box.top + 13 + bob, 4, 1, c.gold_lt); rect(g, sx - box.half - 7, sy - box.top + 12 + bob, 1, 3, c.gold_lt) }
      if (sb) bd(g, sb, sx + box.half, sy - box.top + 10 + bob, c)
      if (seat === 'pause') grow(g, u, sx, sy, (ox, oy) => iceBlock(g, ox, oy, th!.ice))
      else if (n.state === 'idle') (s.kit.zzz ?? zzz)(g, sx, sy - box.top + 8, t, c)
      else if (!(meet && sx !== x)) { if (s.kit.bubble) s.kit.bubble(g, sx, sy - box.top - 1 + bob, n.state, step, c); else bubble(g, sx, sy - box.top + 7 + bob, n.state, step, c) }
      if (n.state === 'done' && !lift) (s.kit.sparkle ?? sparkle)(g, sx + box.half - 1, sy - box.top + 2 + bob, t, di, c)
      if (cheer >= 0) (s.kit.confetti ?? confetti)(g, sx, sy, cheer, c)
      sprHit(n.id, sx, sy + bob, box)
    }
    const up = by.get(n.parent ?? '')
    const UR = up?.kind === 'realm' || (up?.kind === 'courtyard' && REALM[up.ai ?? '']) ? realmOf(up.ai, s.kit) : undefined
    if (!tea) { if (s.kit.desk) s.kit.desk(g, x - 12, y - 2, n.state === 'working', UR, c); else if (UR) realmDesk(g, x - 12, y - 2, n.state === 'working', UR, c); else desk(g, x - 12, y - 2, n.state === 'working', c) }
    // A lit lamp throws a soft pool of light that flickers while the role works.
    if (!tea && n.state === 'working' && seat !== 'pause') glowAt(g, UR ? UR.glow : c.gold_lt, x + 9, y + 1, 11, t ? 0.32 + 0.1 * Math.sin(t * 5 + di) : 0.38)
    if (seat === 'wait' && !tea) grow(g, u, x - 9, y - 1, (ox, oy) => hourglass(g, ox, oy, t, c))
    if (seat === 'pause' && !tea) grow(g, u, x - 12, y - 2, (ox, oy) => frostDesk(g, ox, oy, th!.ice))
    // Typing: hands take turns on the desk and a line of ink grows across the scroll.
    if (!tea && !away && seat !== 'pause' && sx === x && sy === y && n.state === 'working' && t) {
      grow(g, u, x, y, (ox, oy) => { rect(g, ox + (step ? 1 : -4), oy - 2, 3, 1, c.skin); rect(g, ox - 6, oy + 3, 1 + (Math.floor(t * 6) % 7), 1, c.ink2) })
    }
    if (scroll) grow(g, u, scroll[0], scroll[1], (ox, oy) => { rect(g, ox - 3, oy - 1, 6, 4, c.ink); rect(g, ox - 2, oy, 4, 2, c.cloud); rect(g, ox - 3, oy, 1, 2, c.gold_dk); rect(g, ox + 2, oy, 1, 2, c.gold_dk) })
    hits.push(boxOf(n))
  }
  tetherArt(g, court, A, B, c)
  ropeArt(g, sp, A, B, t, c, awake)
  // Handed between AIs: the old AI's badge, an arrow, the new one, on the courtyard's rim.
  for (const n of court.nodes) {
    if (n.kind !== 'courtyard' || !n.from || !seen(n, 40)) continue
    const a = aiIcon(n.from), b = aiIcon(n.ai), x = Math.round(A(n.x)) + 4, y = Math.round(B(n.y)) + 2
    if (a) (s.kit.badge ?? badge)(g, a, x, y, c)
    rect(g, x + 7, y + 2, 4, 1, c.gold_lt); rect(g, x + 10, y + 1, 1, 3, c.gold_lt)
    if (b) (s.kit.badge ?? badge)(g, b, x + 13, y, c)
  }
  // The handover itself, once: the old AI's badge rides a cloud from its pavilion to the new one.
  for (const [, [f, p]] of live) {
    if (f.kind !== 'move') continue
    const a = by.get(`ai:${f.from}`), b = by.get(`ai:${f.to}`), ic = aiIcon(f.from)
    if (!a || !b) continue
    const e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2, ax = A(a.x + a.w / 2), ay = B(a.y + a.h / 2) - 30, bx = A(b.x + b.w / 2), by2 = B(b.y + b.h / 2) - 30
    const x = Math.round(ax + (bx - ax) * e), y = Math.round(ay + (by2 - ay) * e - Math.sin(Math.PI * e) * 24)
    puff(g, x - 7, y + 4, 4, c.cloud, c.cloud_sh)
    if (ic) (s.kit.badge ?? badge)(g, ic, x - 2, y - 4, c)
  }
  const pet = court.petition
  if (pet && walk) {
    g.save(); g.strokeStyle = '#ff5a3c'; g.lineWidth = 1; g.setLineDash([3, 2]); g.lineDashOffset = -t * 8
    g.beginPath(); pet.path.forEach(([x, y], i) => (i ? g.lineTo(A(x), B(y)) : g.moveTo(A(x), B(y)))); g.stroke(); g.restore()
    const d = by.get(pet.deskId), x = Math.round(A(walk[0])), y = Math.round(B(walk[1]))
    puff(g, x - 7, y + 2, 4, c.cloud, c.peach_lt)
    const wf = walkFrame(t), bob = (walk[2] && wf % 2 ? -1 : 0) + (live.get(pet.deskId)?.[0].kind === 'hop' ? -Math.round(Math.sin(Math.PI * live.get(pet.deskId)![1]) * 5) : 0)
    const box = figure(d?.role, d?.ai ?? by.get(d?.parent ?? '')?.ai, x, y + bob, walk[2] && t ? WALK_LEGS[wf] : 0, d?.state, false)
    if (s.kit.bubble) s.kit.bubble(g, x, y + bob - box.top - 1, 'needs', step, c); else bubble(g, x, y + bob - box.top + 7, 'needs', step, c)
    sprHit(pet.deskId, x, y + bob, box)
  }
  // Selection: dim everything else and ring the pick in gold, before the labels so they stay legible.
  const on = s.picked ? by.get(s.picked) : undefined
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  // A petitioner out on the road is ringed where it walks.
  const road = on && walk && on.id === pet?.deskId ? heads.get(on.id) : undefined
  if (on && (road || seen(on, 400))) {
    const isle = BIG.has(on.kind), cx0 = road ? road[0] : 0
    const b = road ? { x: cx0 - (road[3] + 4 * ak), y: road[1] - 2 * ak, w: 2 * (road[3] + 4 * ak), h: road[2] - road[1] + 6 * ak } : boxOf(on), cx = b.x + b.w / 2
    const shape = (dir = false) => isle ? g.ellipse(cx, b.y + b.h / 2 + 4 * v.z, b.w * 0.58, b.h * 0.62, 0, 0, 2 * Math.PI, dir) : g.roundRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8, 6)
    g.beginPath(); g.rect(0, 0, cw, ch); shape(); g.fillStyle = 'rgba(8,6,18,.5)'; g.fill('evenodd')
    g.save(); g.strokeStyle = c.gold_lt
    for (const [lw, a] of [[12, 0.1], [7, 0.2], [2, 1]]) { g.globalAlpha = a; g.lineWidth = lw; g.beginPath(); shape(); g.stroke() }
    g.restore()
    // Pixel marker: a gold arrow over the pick, bobbing with the step clock. Off while a hover bubble is up, so it never sits on the tail.
    if (!(s.hover && heads.get(s.hover))) {
    const my = Math.min(b.y, heads.get(on.id)?.[1] ?? b.y) - (isle ? 10 : 8) - step * 2, px = Math.max(3, Math.round(ak * 1.5))
    for (let r = 0; r < 4; r++) { rect(g, cx - (4 - r) * px, my + r * px - px, (8 - 2 * r) * px, px, c.ink); rect(g, cx - (3 - r) * px, my + r * px - px, Math.max(px, (6 - 2 * r) * px), px, c.gold_lt) }
    }
  }

  // Text layer, in CSS pixels: plates, cards and plaques stay crisp at any zoom.
  g.textBaseline = 'middle'
  // Every label tries its spots in order and takes the first that covers no other label and no island but its owner's.
  const taken: Box4[] = []
  const isles = court.nodes.filter(n => BIG.has(n.kind) && seen(n, 300)).map(n => ({ id: n.id, r: [X(n.x), Y(n.y), n.w * v.z, n.h * v.z] as Box4 }))
  const [il, ib, ir] = s.inset ?? [0, 0, 0], stageBox: Box4 = [il + 4, 4, cw - 8 - il - ir, ch - 8 - ib]
  const place = (spots: Array<[number, number]>, w: number, h: number, owner?: string, inside = false) => {
    const at = freeSpot(spots, w, h, taken, isles, owner, inside ? stageBox : undefined)
    if (at) taken.push([at[0], at[1], w, h])
    return at
  }
  const plaque = (n: CourtNode, sub: string | undefined, council = false, edge?: string, subCol?: string) => {
    if (!seen(n)) return
    const big = PIX(council ? 9 : 8), top = n.label.toUpperCase()
    const w1 = wid(g, big, top), w2 = sub ? wid(g, SANS(11, 500), sub) : 0
    const cx = X(n.x + n.w / 2), above = Y(n.y) - 4, below = Y(n.y + n.h) + 4, mid = Y(n.y + n.h / 2)
    // Full plaque above, below or beside, then the title alone.
    // A realm always keeps its from line.
    // A realm keeps its from line, down to the title alone when nothing else fits.
    for (const withSub of sub ? [true, false] : [false]) {
      let w = Math.min(220, Math.max(w1, withSub ? w2 : 0) + 18)
      const h = withSub ? 32 : 18
      const spots: Array<[number, number]> = [[cx - w / 2, above - h], [cx - w / 2, below], [X(n.x + n.w) + 4, mid - h / 2], [X(n.x) - w - 4, mid - h / 2]]
      // A realm's plaque goes out in its own sky, away from the courtyard, so stacked realms never share one gap.
      const yd = n.kind === 'realm' ? by.get(n.parent ?? '') : undefined
      if (yd) spots.unshift(...spots.splice(n.x > yd.x ? 2 : 3, 1))
      // A realm with no free spot goes further out or narrower, never onto another label or the petition.
      let at = place(spots, w, h, n.id, true)
      const forced = !at && n.kind === 'realm' ? forcedSpot(spots, w, h, [cx, mid], taken, isles, n.id, stageBox) : undefined
      if (forced) { at = forced.at; w = forced.w; taken.push([at[0], at[1], w, h]) }
      if (!at) continue
      const [x, y] = at
      g.fillStyle = SHADE; g.beginPath(); g.roundRect(x + 2, y + 2, w, h, 3); g.fill()
      g.fillStyle = council ? c.red_dk : s.kit.plate; g.beginPath(); g.roundRect(x, y, w, h, 3); g.fill()
      g.strokeStyle = edge ?? (council ? c.gold : c.gold_dk); g.lineWidth = edge ? 2 : 1.5; g.stroke()
      text(g, top, x + w / 2, y + 10, big, council ? c.gold_lt : TEXT, w - 10, 'center')
      if (withSub) text(g, sub!, x + w / 2, y + 24, SANS(11, 500), subCol ?? '#e8dccb', w - 10, 'center')
      hits.push({ x, y, w, h, id: n.id })
      return
    }
  }
  for (const n of court.nodes) {
    if (n.kind === 'council') plaque(n, councilSub, true)
    else if (n.kind === 'window') plaque(n, n.here ? `You are here · ${folder(n.window)}` : n.window ? folder(n.window) : 'Chats outside every window', false, WIN[n.color ?? ''] ?? c.stone, n.here ? c.gold_lt : undefined)
    else if (n.kind === 'pavilion') plaque(n, n.runs !== undefined ? (n.shipped !== undefined ? tally(n) : `${n.runs} runs`) : undefined)
  }
  if (pet && walk) {
    const d = by.get(pet.deskId), yard = by.get(d?.parent ?? ''), wx = X(walk[0]), wy = Y(walk[1])
    const owner = isles.find(i => wx >= i.r[0] && wx <= i.r[0] + i.r[2] && wy >= i.r[1] && wy <= i.r[1] + i.r[3])?.id
    // Below the walker, above, to either side; then a one-line petition.
    for (const [w, h] of [[230, 36], [170, 22]]) {
      const at = place([[wx - w / 2, wy + 14 * v.z + 8], [wx - w / 2, wy - 32 * v.z - h - 4], [wx + 14 * v.z + 6, wy - h / 2], [wx - 14 * v.z - 6 - w, wy - h / 2]], w, h, owner, true)
      if (!at) continue
      const [x, y] = at
      g.fillStyle = c.red_dk; g.beginPath(); g.roundRect(x, y, w, h, 3); g.fill(); g.strokeStyle = c.red_lt; g.lineWidth = 1.5; g.stroke()
      if (h > 22) text(g, `PETITION (ASKS YOU) · ${yard?.label ?? 'chat'}`.toUpperCase(), x + 8, y + 11, PIX(8), c.peach_lt, w - 16)
      text(g, d?.ask ?? 'Needs your answer', x + 8, y + h - 10, SANS(12), TEXT, w - 16)
      hits.push({ x, y, w, h, id: pet.deskId })
      break
    }
  }
  const order = court.nodes.filter(n => n.kind === 'courtyard').sort((a, b) => +(kids.get(b.id) ?? []).some(d => d.state === 'needs') - +(kids.get(a.id) ?? []).some(d => d.state === 'needs'))
  let tags = 0
  for (const yard of order) {
    if (!seen(yard, 260)) continue
    const own = kids.get(yard.id) ?? [], desks = [...own, ...own.filter(r => r.kind === 'realm').flatMap(r => kids.get(r.id) ?? [])].filter(d => d.kind === 'desk')
    const hot = desks.some(d => d.state === 'needs'), level = lod(v.z, yard.w)
    // A yard with a realm palette is that AI's realm: titled so, the chat name under it.
    const YR = REALM[yard.ai ?? ''], realmTitle = YR ? `${aiName(yard.ai).toUpperCase()} REALM` : undefined
    // Wait or split note rides inside the yard's own tag, so crowded courts still show it.
    const sibs = yard.group ? order.filter(o => o !== yard && o.group === yard.group).map(o => o.label) : []
    const wait = yard.waitsOn?.length ? `${yard.state === 'waiting' || yard.state === 'idle' ? 'STARTS AFTER' : 'WAITING ON'} ${yard.waitsOn.join(', ').toUpperCase()}` : sibs.length ? `SPLIT WITH ${sibs.join(', ').toUpperCase()}` : undefined
    const note = [wait, yard.limits?.toUpperCase()].filter(Boolean).join(' \u00b7 ') || undefined
    const noteCol = yard.waitsOn?.length ? c.gold_lt : c.jade_lt
    if (level === 'plate') {
      for (const d of desks) {
        if (!seen(d)) continue
        const w = Math.min(PLATE.maxW, Math.max(PLATE.minW, d.w * v.z - 6)), x = X(d.x + d.w / 2) - w / 2, y = Y(d.y + d.h) + 2, t = timer(d, wall)
        const up = by.get(d.parent ?? ''), HR = up?.kind === 'realm' ? realmOf(up.ai, s.kit) : undefined, rc = HR ? HR.hi : roleColor(d.role, c)
        card(g, x, y, w, PLATE.h, HR ? HR.hi : c.red_lt, d.state === 'needs' || !!HR)
        if (HR) { g.globalAlpha = 0.6; g.fillStyle = HR.dk; g.beginPath(); g.roundRect(x + 1, y + 1, w - 2, PLATE.h - 2, 3); g.fill(); g.globalAlpha = 1 }
        rect(g, x, y + 1, 3, PLATE.h - 2, d.state === 'needs' ? c.red_lt : rc)
        // The timer keeps its width; the role gives way.
        const tw = wid(g, PIX(8), t)
        text(g, t, x + w - 6, y + 9, PIX(8), stateColor(d.state, c), tw + 1, 'right')
        text(g, roleTag(d), x + 8, y + 9, PIX(8), rc, w - tw - 22)
        text(g, d.task ?? SAY[d.state ?? 'idle'], x + 8, y + 23, SANS(12), d.state === 'waiting' || d.state === 'idle' ? MUTE : TEXT, w - 14)
        text(g, tally(d), x + 8, y + 37, SANS(10, 500), MUTE, w - 14)
        hits.push({ x, y, w, h: PLATE.h, id: d.id })
      }
      continue
    }
    if (level === 'card') {
      const rows = desks.slice(0, 6), w = 236, h = 26 + rows.length * 20 + (desks.length > 6 ? 16 : 0) + (note ? 16 : 0)
      const r = X(yard.x + yard.w) + 6, l = X(yard.x) - w - 6, top = Y(yard.y), mid = Y(yard.y + yard.h / 2) - h / 2
      const at = place([[r, top], [l, top], [r, mid], [l, mid]], w, h, yard.id, true)
      if (at) {
        const [x, y] = at
        card(g, x, y, w, h, c.red_lt, hot)
        rect(g, x + 8, y + 9, 7, 7, hot ? c.red_lt : c[AI_KEY[yard.ai ?? ''] ?? 'gold'])
        text(g, realmTitle ? `${realmTitle} · ${yard.label.toUpperCase()}` : yard.label.toUpperCase(), x + 21, y + 13, PIX(8), YR?.hi ?? TEXT, w - 30)
        hits.push({ x, y, w, h: 24, id: yard.id })
        rows.forEach((d, i) => {
          const ry = y + 24 + i * 20, t = timer(d, wall)
          const tw = wid(g, PIX(8), t)
          const up = by.get(d.parent ?? ''), HR = up?.kind === 'realm' ? realmOf(up.ai, s.kit) : undefined
          rect(g, x + 1, ry, w - 2, 1, 'rgba(255,255,255,.07)')
          if (HR) rect(g, x + 1, ry + 1, 3, 18, HR.hi)
          text(g, roleTag(d), x + 8, ry + 10, PIX(8), HR ? HR.hi : roleColor(d.role, c), 62)
          text(g, d.task ?? SAY[d.state ?? 'idle'], x + 74, ry + 10, SANS(12), d.state === 'waiting' || d.state === 'idle' ? MUTE : TEXT, w - 90 - tw)
          text(g, t, x + w - 8, ry + 10, PIX(8), stateColor(d.state, c), tw + 1, 'right')
          hits.push({ x, y: ry, w, h: 20, id: d.id })
        })
        if (desks.length > 6) text(g, `+${desks.length - 6} more`, x + 8, y + h - 9 - (note ? 16 : 0), SANS(10, 500), MUTE, w - 16)
        if (note) text(g, note, x + 8, y + h - 9, PIX(8), noteCol, w - 16)
        continue
      }
    }
    // A name tag above or below, staggered, shortened if it must; with no room at all, the state dot on the island (tap it for the name).
    const worst = desks.reduce<CourtState>((m, d) => (RANK[d.state ?? 'idle'] > RANK[m] ? d.state ?? 'idle' : m), 'idle')
    const cx = X(yard.x + yard.w / 2), above = Y(yard.y) - 20, below = Y(yard.y + yard.h) + 2, my = Y(yard.y + yard.h / 2) - 9
    let dot: [number, number] = [cx, Y(yard.y + yard.h / 2)]
    g.font = PIX(8)
    // Crowded phone Fit: a short stub beside the island still beats a bare dot.
    // full name on two lines first, then the shortened one-liners
    const name = yard.label.toUpperCase()
    const two = (max: number): string[] => {
      if (g.measureText(name).width <= max) return [name]
      const words = name.split(' ')
      let a = ''
      while (words.length > 1 && g.measureText(a ? `${a} ${words[0]}` : words[0]).width <= max) a = a ? `${a} ${words.shift()}` : words.shift()!
      return a ? [a, fit(g, words.join(' '), max)] : [fit(g, name, max)]
    }
    // Past the cap only the ones asking for you keep a tag; the rest stay a dot.
    const capped = tags >= YARD_TAG_CAP && !hot && s.picked !== yard.id
    for (const [max, force, wrap] of capped ? [] : [[180, false, true], [180, false, false], [120, false, false], [90, false, false], [90, true, false]] as const) {
      const lines = [...(realmTitle ? [fit(g, realmTitle, max), fit(g, name, max)] : wrap ? two(max) : [fit(g, name, max)]), ...(note ? [fit(g, note, max)] : [])]
      let w = Math.max(...lines.map(l => g.measureText(l).width)) + 26
      const h = 18 + (lines.length - 1) * 12, up = above - (h - 18)
      const spots: Array<[number, number]> = [[cx - w / 2, up], [cx - w / 2, below], [cx - w, up], [cx, up], [cx - w, below], [cx, below], ...([[X(yard.x + yard.w) + 4, my], [X(yard.x) - w - 4, my]] as Array<[number, number]>).filter(([x]) => x >= 4 && x + w <= cw - 4)]
      let at = place(spots, w, h, yard.id, true)
      // Last try: pushed further out or narrower, but never onto another label (crowded phone Fit stacked them before).
      const pushed = !at && force ? forcedSpot(spots, w, h, [cx, my + 9], taken, isles, yard.id, stageBox) : undefined
      if (pushed) { at = pushed.at; w = pushed.w; taken.push([at[0], at[1], w, h]) }
      if (!at) continue
      const [x, y] = at
      card(g, x, y, w, h, hot || !YR ? c.red_lt : YR.hi, hot); lines.forEach((l, i) => text(g, l, x + 17, y + 9.5 + i * 12, PIX(8), note && i === lines.length - 1 ? noteCol : YR && !i ? YR.hi : TEXT, Math.min(max + 10, w - 22)))
      hits.push({ x, y, w, h, id: yard.id })
      dot = [x + 9, y + 9]
      tags++
      break
    }
    g.fillStyle = c.ink; g.beginPath(); g.arc(dot[0], dot[1], 5, 0, 7); g.fill()
    g.fillStyle = stateColor(worst, c); g.beginPath(); g.arc(dot[0], dot[1], 3.5, 0, 7); g.fill()
  }
  // Garden task: idle roles, comma list; armory task: "<n> tools".
  for (const n of court.nodes) {
    if (n.kind === 'realm') plaque(n, n.sub, false, realmOf(n.ai, s.kit).hi, realmOf(n.ai, s.kit).glow)
    else if (n.kind === 'garden') plaque(n, n.task ? `${n.task.split(',').length} resting` : undefined)
    else if (n.kind === 'armory' || isPlace(n.kind)) plaque(n, n.task, false, n.warn ? c.red_lt : undefined)
    // Problem count on a place: memory health, missing keys, proposals waiting.
    if (n.warn && isPlace(n.kind) && seen(n)) {
      const x = X(n.x + n.w) - 8, y = Y(n.y) + 8, s = String(n.warn)
      g.fillStyle = c.ink; g.beginPath(); g.arc(x, y, 9, 0, 7); g.fill()
      g.fillStyle = c.red; g.beginPath(); g.arc(x, y, 7.5, 0, 7); g.fill()
      text(g, s, x, y + 3, PIX(8), TEXT, 14, 'center')
    }
  }
  // Rope tags: an auto link's file, at the rope's middle, once awake.
  for (const r of sp) {
    if (!r.r.file || !(r.end !== undefined || awake(r.r))) continue
    const name = r.r.file, [wx, wy] = qp(r, 0.5), mx = X(wx), my = Y(wy), w = wid(g, SANS(11, 600), name) + 30
    const at = place([[mx - w / 2, my + 10], [mx - w / 2, my - 30]], w, 20)
    if (!at) continue
    const [x, y] = at, col = r.end === undefined ? c.gold : c.jade_lt
    g.save(); g.globalAlpha = r.end === undefined ? 1 : 1 - r.end
    card(g, x, y, w, 20, col, true)
    rect(g, x + 8, y + 5, 7, 10, col); rect(g, x + 12, y + 5, 3, 3, PLATE_BG); rect(g, x + 10, y + 9, 3, 1, c.ink); rect(g, x + 10, y + 11, 3, 1, c.ink)
    text(g, name, x + 21, y + 10.5, SANS(11, 600), TEXT, w - 26)
    g.restore()
  }
  if (th && s.pause) {
    // Frost on held plates.
    if (th.ice > 0) for (const d of desks) {
      const yard = by.get(`yard:${d.chatId}`)
      if (!held.has(d.chatId ?? '') || !yard || !seen(d) || lod(v.z, yard.w) !== 'plate') continue
      const w = Math.min(PLATE.maxW, Math.max(PLATE.minW, d.w * v.z - 6)), x = X(d.x + d.w / 2) - w / 2, y = Y(d.y + d.h) + 2
      g.save(); g.globalAlpha = th.ice
      g.fillStyle = 'rgba(190,232,255,.14)'; g.beginPath(); g.roundRect(x, y, w, PLATE.h, 4); g.fill(); g.strokeStyle = ICE; g.lineWidth = 1; g.stroke()
      for (const [fx, fy] of [[x + 2, y + 2], [x + w - 9, y + PLATE.h - 5]]) { rect(g, fx, fy, 7, 1, ICE_HI); rect(g, fx, fy, 1, 3, ICE_HI); rect(g, fx + 2, fy + 1, 2, 1, ICE) }
      g.restore()
    }
    // The banner, icy edged, with the golden carp king who froze the Tongtian River on it. Thawing, he drops into Guanyin's basket.
    const p = s.pause
    const top = `USAGE PAUSE · ${LIMIT[p.kind] ?? p.kind} at ${p.percent}%`
    const sub = pauseLine(p, id => by.has(`yard:${id}`), wall, s.thaw !== undefined, fmt)
    const w = Math.min(cw - 32, Math.max(wid(g, PIX(8), top), wid(g, SANS(12), sub)) + 70), h = 40, x = Math.round(cw / 2 - w / 2), y = 22
    if (th.banner > 0) {
      g.save(); g.globalAlpha = th.banner
      card(g, x, y, w, h, ICE, true)
      rect(g, x + 1, y + 1, w - 2, 2, 'rgba(234,248,255,.5)')
      for (let i = 0; i < w - 12; i += 9) rect(g, x + 6 + i, y + h - 1, 2, 2 + (i % 4), ICE)
      text(g, top, x + 60, y + 13, PIX(8), ICE_HI, w - 68)
      text(g, sub, x + 60, y + 28, SANS(12), TEXT, w - 68)
      const S = 3, bx = x + 4, byy = y + h + 4, j = th.jump, bob = t && !j ? (Math.floor(t * 2) % 2) * -1 : 0
      if (th.basket) g.drawImage(pixArt(BASKET, { b: c.brown_dk, B: c.wood, w: c.wood_lt }, c.ink), bx, byy + (1 - th.basket) * 20, 16 * S, 9 * S)
      const carp = pixArt(CARP, { y: c.gold_lt, g: c.gold, G: c.gold_dk, r: c.red, w: c.cloud, k: c.ink }, c.ink)
      if (j < 1) g.drawImage(carp, bx, y - 18 + bob + (byy - 12 - (y - 18)) * j - Math.sin(Math.PI * j) * 14, 16 * S, 11 * S)
      else rect(g, bx + 20, byy - 2, 4, 3, c.red)
      g.restore()
    }
  }
  // Hover: a pixel speech bubble over the sprite with its state and task.
  const hh = s.hover ? heads.get(s.hover) : undefined, hn = s.hover ? by.get(s.hover) : undefined
  if (hh && hn) {
    const st = hn.state ?? 'idle', word = `${castOf(hn.role, s.kit.cast).name} · ${aiName(hn.ai)} · ${SAY[st]}`.toUpperCase()
    const hf = fromOf(hn, by), task = (hf ? `Moved from ${aiName(hf)} · ` : '') + (hn.task ?? hn.raise ?? hn.ask ?? 'Tap to open its chat')
    const w = Math.round(Math.min(240, Math.max(wid(g, PIX(8), word) + 14, wid(g, SANS(12), task)) + 20)), h = 36
    const x = Math.round(Math.max(6, Math.min(cw - w - 6, hh[0] - w / 2))), up = hh[1] - h - 10 > 6, y = Math.round(up ? hh[1] - h - 10 : hh[2] + 10)
    rect(g, x, y - 2, w, h + 4, c.ink); rect(g, x - 2, y, w + 4, h, c.ink); rect(g, x, y, w, h, c.cloud)
    const tx = Math.round(Math.max(x + 8, Math.min(x + w - 8, hh[0])))
    for (let i = 0; i < 3; i++) { const ty = up ? y + h + 2 + i * 2 : y - 4 - i * 2; rect(g, tx - 3 + i, ty, 6 - 2 * i, 2, c.ink); if (i < 2) rect(g, tx - 2 + i, up ? ty - 2 : ty + 2, 4 - 2 * i, 2, c.cloud) }
    rect(g, x + 8, y + 8, 6, 6, c.ink); rect(g, x + 9, y + 9, 4, 4, stateColor(st, c))
    text(g, word, x + 19, y + 11, PIX(8), c.ink, w - 27)
    text(g, task, x + 8, y + 26, SANS(12), c.ink2, w - 16)
  }
}

/** Demo only: ?board=90 repeats live chats until the court has about n nodes, for the frame time check. */
function scaleHub(h: HubState, n: number): HubState {
  const live = h.chats.filter(c => c.live)
  let out = h
  // Node count only; a stage keeps each build quick.
  for (let i = 1; live.length && buildCourt(out, { w: 1440, h: 900 }).nodes.length < n && i < 50; i++) {
    const c = live[(i - 1) % live.length]
    out = { ...out, chats: [...out.chats, { ...c, sessionId: `${c.sessionId}~${i}`, name: `${c.name ?? 'chat'} ${i + 1}` }],
      progress: [...out.progress, ...h.progress.filter(p => p.sessionId === c.sessionId).map(p => ({ ...p, sessionId: `${p.sessionId}~${i}` }))] }
  }
  return out
}

function AskBlock({ ask, sent, onAnswer }: { ask: Ask; sent?: string; onAnswer: (choice: Choice, said: string) => void }) {
  const [picks, setPicks] = useState<Array<number | number[] | undefined>>([])
  if (sent) return <section className="bp-ask"><p className="bp-eye">Sent</p><p>{sent}. The lead walks back to its courtyard.</p></section>
  const qs = ask.questions ?? []
  if (ask.kind === 'permission' || !qs.length) return (
    <section className="bp-ask"><p className="bp-eye">{ask.kind === 'permission' ? `Allow ${ask.tool}?` : 'Question for you'}</p>
      {ask.preview && <p><code>{ask.preview}</code></p>}
      {ask.options.map((o, i) => <button key={i} type="button" className="bp-opt" onClick={() => onAnswer([i], o)}>{o}</button>)}
    </section>
  )
  // One single-select question sends on the tap; several wait for Submit. Other text stays in the chat view.
  const one = qs.length === 1 && !qs[0].multiSelect, choice = askChoice(qs, picks, {})
  const pick = (n: number, i: number) => {
    if (one) return onAnswer([i], qs[0].options[i])
    setPicks(p => { const next = p.slice(), cur = [next[n] ?? []].flat(); next[n] = qs[n].multiSelect ? (cur.includes(i) ? cur.filter(x => x !== i) : [...cur, i]) : i; return next })
  }
  return (
    <section className="bp-ask">
      <p className="bp-eye">Question for you</p>
      {qs.map((q, n) => <div key={n} role="group" aria-label={q.header ?? q.question}><p>{q.question}</p>
        {q.options.map((o, i) => <button key={i} type="button" className="bp-opt" aria-pressed={one ? undefined : [picks[n] ?? []].flat().includes(i)} onClick={() => pick(n, i)}>{o}{optionSmart(q, i) && <span className="ss-mark">{smartMarkText(optionSmart(q, i)!)}</span>}</button>)}</div>)}
      {!one && <button type="button" className="bp-opt bp-send" disabled={!choice} onClick={() => choice && onAnswer(choice, 'Answers sent')}>Submit answers</button>}
    </section>
  )
}

// A ring place's action per row: switches for the tower, Approve or Discard for the study, Test for a saved key.
function rowAct(kind: CourtNode['kind'], i: Item, hub: HubState, send: Send) {
  if (kind === 'tower' && i.id) {
    const rc = i.id === 'rc', folder = i.id.slice(3), on = !i.ok
    return <button type="button" className="hub-btn sm" aria-pressed={!!i.ok} onClick={() => send(rc ? { type: 'hub-rc', on } : { type: 'hub-rc-server', folder, on })}>{i.ok ? 'Turn off' : 'Turn on'}</button>
  }
  if (kind === 'study' && i.id) return <span className="bp-acts">
    <button type="button" className="hub-btn primary sm" onClick={() => send({ type: 'hub-learn', id: i.id!, ok: true })}>Approve</button>
    <button type="button" className="hub-btn sm" onClick={() => send({ type: 'hub-learn', id: i.id!, ok: false })}>Discard</button></span>
  const todo = kind === 'notice' ? todoRef(i.id) : undefined
  if (todo) return <button type="button" className="hub-btn sm" onClick={() => send({ type: 'hub-todo-remove', ...todo })}>Done</button>
  if (kind === 'treasury' && i.id) { const k = hub.signIns.keys?.find(x => x.name === i.id); if (k) return <button type="button" className="hub-btn sm" onClick={() => send({ type: 'hub-key-test', name: k.name })}>Test</button> }
  return null
}

// Messages the chat from the map; the toast says so if it does not arrive.
function ReplyBox({ to, send, label = 'Message this chat' }: { to: { sessionId: string; note?: string }; send: Send; label?: string }) {
  const [text, setText] = useState(''), [said, setSaid] = useState('')
  if (to.note) return <p className="bp-sub">{to.note}</p>
  const go = () => { const t = text.trim(); if (!t) return; send({ type: 'hub-send', sessionId: to.sessionId, text: t }); setText(''); setSaid(t) }
  return <div className="bp-form">
    <textarea className="bp-text" rows={3} aria-label={label} placeholder={label} value={text}
      onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); go() } }} />
    <button type="button" className="hub-btn primary sm" disabled={!text.trim()} onClick={go}>Send</button>
    <p className="bp-said" role="status">{said && <>Sent: {said}</>}</p>
  </div>
}

function Library({ g, onMemory }: { g: MemoryGraph; onMemory?: () => void }) {
  const t = memoryTally(g), health = healthLine(g.health)
  return <>
    <dl className="bp-stats">{([[t.counts.memory, 'memories'], [t.counts.wiki, 'wiki pages'], [t.counts.raw, 'sources']] as const).map(([v, l]) => <div key={l}><dt>{l}</dt><dd>{v}</dd></div>)}</dl>
    <p className="bp-sub">{t.counts.rule} {t.counts.rule === 1 ? 'rule file' : 'rule files'} in reach</p>
    {health && <p className="bp-sub bp-warn">{health}</p>}
    {onMemory && <div className="bp-pad"><button type="button" className="hub-btn primary sm" onClick={onMemory}>Open memory map</button></div>}
    <p className="bp-eye bp-pad">Recent notes</p>
    <ul className="bp-list">{t.recent.map(n => {
      const r = relations(g, n.id), rel = [...r.typed.map(x => `${x.title}: ${x.list.map(m => m.label).join(', ')}`), ...r.to.length ? [`Links: ${r.to.map(m => m.label).join(', ')}`] : []]
      return <li key={n.id} data-ok={g.health.dangling.includes(n.id) || g.health.contradictions.some(p => p.includes(n.id)) ? '0' : undefined}><i aria-hidden />
        <span><b>{n.label}</b>{n.kind === 'wiki' ? ' (wiki)' : ''}{n.description && <small>{n.description}</small>}{rel.map(x => <small key={x}>{x}</small>)}</span></li>
    })}</ul>
  </>
}

function Panel({ node, court, hub, shared, colors: c, cast: set, sent, onPick, onAnswer, onClose, onSummary, onCopy, mem, send, ways }: {
  node: CourtNode; court: Court; hub: HubState; shared: ReturnType<typeof hubCounts>; colors: C; cast?: Record<string, Cast>; sent: Record<string, string>; onSummary?: BoardWays['onSummary']; onCopy?: BoardWays['onCopy']
  mem?: GraphHold; send: Send; ways: Pick<BoardWays, 'onMemory' | 'onFlow' | 'onTodo'>
  onPick: (id: string) => void; onAnswer: (sessionId: string, ask: Ask, choice: Choice, said: string) => void; onClose: () => void
}) {
  const [tab, setTab] = useState<'t' | 'd'>('t')
  const [ask0, setAsk0] = useState(''), [asked, setAsked] = useState('')
  const [picks, setPicks] = useState<RunPicks>(() => startPicks(hub))
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const i = setInterval(() => { if (seen()) setNow(Date.now()) }, 1000); return () => clearInterval(i) }, [])
  // A pavilion's chats are its AI's, wherever they hang.
  const desks = court.nodes.filter(n => n.kind === 'desk'), kids = court.nodes.filter(m => node.kind === 'pavilion' ? m.kind === 'courtyard' && m.ai === node.ai : node.kind === 'window' ? m.kind === 'courtyard' && homeOf(court, m) === node.id : m.parent === node.id)
  const p = node.chatId ? hub.progress.find(x => x.sessionId === node.chatId) : undefined
  const up = node.kind === 'desk' ? court.nodes.find(n => n.id === node.parent) : undefined
  const yard = up?.kind === 'realm' ? court.nodes.find(n => n.id === up.parent) : up ?? node
  const lead = node.kind === 'desk' && roleKey(node.role) === 'lead'
  const ask = p?.ask && (node.kind === 'courtyard' || lead || node.state === 'needs') ? p.ask : undefined
  const chat = node.kind === 'courtyard' || node.kind === 'desk' ? chatOf(court, node.id) : undefined, reply = replyBox(hub.chats, chat)
  const bare = !ask && p?.question && p.state === 'needs-you' && (node.kind === 'courtyard' || lead)
  // Chats, like the header.
  const count = (st: CourtState) => court.nodes.filter(d => d.kind === 'courtyard' && d.state === st).length
  const roster = node.kind === 'council' ? desks.filter(d => d.state === 'needs') : kids
  const eye = node.kind === 'desk' ? `${node.role ?? 'lead'}${node.model ? ` · ${node.model}` : ''}` : node.here ? 'This window' : node.kind === 'courtyard' ? (REALM[node.ai ?? ''] ? `${aiName(node.ai)} realm` : `${node.ai ?? 'chat'} courtyard`) : node.kind === 'realm' ? `${aiName(node.ai)} realm` : KINDS[node.kind]
  const eyeColor = node.kind === 'desk' ? roleColor(node.role, c) : node.kind === 'council' ? c.gold : node.kind === 'window' ? WIN[node.color ?? ''] ?? MUTE : node.kind === 'realm' ? realmOf(node.ai).hi : c[AI_KEY[node.ai ?? ''] ?? 'jade_lt']
  const placeSub = isPlace(node.kind) ? node.task : undefined
  const title = node.kind === 'realm' ? node.task ?? SAY[node.state ?? 'idle'] : node.kind === 'desk' ? node.task ?? node.ask ?? yard?.label ?? SAY[node.state ?? 'idle'] : node.kind === 'council' ? 'Switchboard' : node.label
  const nf = node.from ?? (node.kind === 'desk' && yard?.ai && node.ai && yard.ai !== node.ai && up?.kind !== 'realm' ? yard.ai : undefined), via = nf ? ` · Moved from ${aiName(nf)}` : ''
  const sub = node.kind === 'desk' ? `${castOf(node.role, set).name} · ${aiName(node.ai)}${yard ? ` · ${yard.label}` : ''}${via}${node.raise ? ` · ${node.raise}` : ''}` : node.kind === 'council' ? courtSummary(court)
    : node.kind === 'courtyard' ? `${aiName(node.ai)} · ${plural(kids.filter(k => k.kind === 'desk').length, 'agent')}${via}` : node.kind === 'pavilion' && !kids.length ? 'No chats yet' : node.kind === 'realm' ? node.sub : node.kind === 'window' ? (node.window ? folder(node.window) : 'Chats outside every open window') : placeSub
  // Split siblings and wait targets, under the courtyard's sub line.
  const sibs = node.kind === 'courtyard' && node.group ? court.nodes.filter(m => m.kind === 'courtyard' && m.group === node.group && m.id !== node.id).map(m => m.label) : []
  const ties = [sibs.length ? `Split with ${sibs.join(', ')}` : '', node.kind === 'courtyard' && node.waitsOn?.length ? `Waiting on ${node.waitsOn.join(', ')}` : ''].filter(Boolean)
  const stats: Array<[string, string, boolean?]> = node.kind === 'desk' ? [[timer(node, now), 'status', node.state === 'needs'], [`${node.runs ?? 0}`, 'runs'], [`${node.shipped ?? 0}`, 'done']]
    : node.kind === 'council' ? [[`${shared.working}`, 'working'], [`${shared.needs}`, 'need you', shared.needs > 0], [`${shared.done}`, 'done today']]
    : node.kind === 'window' ? [[`${kids.length}`, 'chats'], [`${kids.filter(k => k.state === 'needs').length}`, 'need you', kids.some(k => k.state === 'needs')], [`${kids.filter(k => k.state === 'done').length}`, 'done']]
    : node.kind === 'pavilion' ? [[`${kids.length}`, 'chats'], [`${node.runs ?? 0}`, 'runs'], [`${node.shipped ?? 0}`, 'done']]
    : node.kind === 'realm' ? [[timer(node, now), 'status'], [`${node.runs ?? 0}`, 'runs'], [`${kids.length}`, 'desks']] : []
  // A realm lists its helper's jobs and the tasks of the desks handed to it.
  const mine = node.kind === 'realm' ? new Set([node.ai, ...kids.map(k => k.id.split(':').pop())]) : undefined
  // A `claude -p` helper shows in a Claude realm too, unless a desk task already says the same.
  const deskTasks = mine ? p?.tasks.filter(t => mine.has(t.role)) ?? [] : []
  const tasks: TaskRow[] = mine ? [...deskTasks, ...(p?.helpers ?? []).filter(h => h.ai === node.ai && !deskTasks.some(t => t.subject === h.label))
    .map((h, i) => ({ id: `h${i}`, subject: h.label, status: h.state === 'working' ? 'in_progress' as const : h.state === 'done' ? 'completed' as const : 'pending' as const }))] : p ? (lead || node.kind === 'courtyard' || !p.tasks.some(t => t.role === node.role) ? p.tasks : p.tasks.filter(t => t.role === node.role)) : []
  const made = [...p?.report?.done ?? [], ...p?.commit ? [`Commit: ${p.commit.split('\n')[0]}`] : [], ...p?.tests ? [`Tests ${p.tests.ok ? 'pass' : 'fail'}${p.tests.total !== undefined ? ` (${p.tests.total - (p.tests.failed ?? 0)}/${p.tests.total})` : ''}`] : []]
  return (
    <aside className="bp" aria-label={`${title} details`}>
      <button type="button" className="bp-close" aria-label="Close details" onClick={onClose}>×</button>
      <header><p className="bp-eye" style={{ color: eyeColor }}>{eye}</p><h3>{title}</h3>{plainWord(node.kind) && <p className="bp-sub">{plainWord(node.kind)}</p>}{sub && <p className="bp-sub">{sub}</p>}{ties.map(t => <p key={t} className="bp-sub bp-tie" data-wait={t.startsWith('Split') ? undefined : ''}>{t}</p>)}</header>
      {stats.length > 0 && <dl className="bp-stats">{stats.map(([v, l, hot]) => <div key={l}><dt>{l}</dt><dd className={hot ? 'hot' : undefined}>{v}</dd></div>)}</dl>}
      {node.kind === 'pavilion' && node.ai === 'research' && (() => {
        const proj = hub.projects.find(p => p.isOpen)?.path ?? hub.projects[0]?.path
        const go = (workbench?: boolean) => { if (ask0.trim() && proj) { send({ type: 'hub-new-chat', path: proj, text: workbench ? ask0.trim() : `Deep research this and report with checked citations: ${ask0.trim()}`, remote: false, research: true, ...(workbench ? { workbench } : {}), ...runFields(picks, 'claude') }); setAsked(`${workbench ? 'Workbench' : 'Research'}: ${ask0.trim()}`); setAsk0('') } }
        return <div className="bp-pad bp-form">
          <textarea className="bp-text" rows={3} aria-label="Research question" placeholder="What should it look into, or change on this device?" value={ask0}
            onChange={e => setAsk0(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) go() }} />
          <ModelEffort ai="claude" value={picks} onChange={setPicks} usage={fiveHourUse(hub, 'claude')} compact />
          <button type="button" className="hub-btn primary sm" disabled={!ask0.trim() || !proj} onClick={() => go()}>Research</button>
          <button type="button" className="hub-btn sm" disabled={!ask0.trim() || !proj} onClick={() => go(true)} title="Starts a Workbench chat that makes the change on this device, with a log and Undo">Change it</button>
          <p className="bp-said" role="status">{asked && <>Started in the Research window. {asked}</>}</p>
        </div>
      })()}
      {node.kind === 'courtyard' && node.chatId && onSummary && <div className="bp-pad"><SummaryFold id={node.chatId} name={node.label} summary={hub.summaries?.[node.chatId]} onAsk={refresh => onSummary(node.chatId!, refresh)} onCopy={onCopy} /></div>}
      {ask && node.chatId && <AskBlock key={ask.id} ask={ask} sent={sent[ask.id]} onAnswer={(ch, said) => onAnswer(node.chatId!, ask, ch, said)} />}
      {bare && <section className="bp-ask"><p className="bp-eye">Question for you</p><p>{p.question}</p>
        {reply ? <ReplyBox to={reply} send={send} label="Your answer" /> : <p className="bp-sub">No choices came with it; answer in the chat.</p>}</section>}
      {reply && !bare && <div className="bp-pad"><ReplyBox to={reply} send={send} label={lead || node.kind === 'courtyard' ? 'Message this chat' : 'Message its lead'} /></div>}
      {chat && <p className="bp-pad"><button type="button" className="bp-link" onClick={() => send({ type: 'hub-focus-chat', sessionId: chat })}>Open terminal</button></p>}
      {p && <>
        <div className="bp-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 't'} onClick={() => setTab('t')}>Tasks</button>
          <button type="button" role="tab" aria-selected={tab === 'd'} onClick={() => setTab('d')}>Deliverables</button>
        </div>
        {tab === 't' ? <ul className="bp-list" role="tabpanel" aria-label="Tasks">
          {tasks.length ? tasks.map(t => <li key={t.id} data-s={t.status}><i aria-hidden />{t.subject}<span className="sr-only">, {t.status.replace('_', ' ')}</span></li>) : <li className="bp-empty">No tasks yet.</li>}
        </ul> : <ul className="bp-list" role="tabpanel" aria-label="Deliverables">
          {made.length ? made.map((m, i) => <li key={i} data-s="completed"><i aria-hidden />{m}</li>) : <li className="bp-empty">Nothing delivered yet.</li>}
        </ul>}
      </>}
      {node.kind === 'library' && (mem?.graph ? <>{mem.error && <p className="bp-sub bp-warn">Showing the last read; refresh failed: {mem.error}</p>}<Library g={mem.graph} onMemory={ways.onMemory} /></> : <p className="bp-sub">{mem?.error ?? 'Reading the memory graph...'}</p>)}
      {node.kind === 'notice' && ways.onTodo && <div className="bp-pad"><button type="button" className="hub-btn primary sm" onClick={ways.onTodo}>Open to-do</button></div>}
      {node.kind === 'maps' && ways.onFlow && <div className="bp-pad"><button type="button" className="hub-btn primary sm" onClick={ways.onFlow}>Open flow map</button></div>}
      {isPlace(node.kind) && node.list && (node.list.length ? <ul className="bp-list bp-place">{node.list.map((i, k) => <li key={i.id ?? `${i.name}${k}`} data-ok={i.ok === undefined ? undefined : i.ok ? '1' : '0'}>
        <i aria-hidden style={node.kind === 'garden' ? { borderColor: roleColor(i.name, c) } : undefined} /><span><b>{i.name}</b>{i.note && <small>{i.note}</small>}</span>{rowAct(node.kind, i, hub, send)}</li>)}</ul>
        : <p className="bp-sub">{EMPTY[node.kind] ?? 'Nothing here yet.'}</p>)}
      {roster.length > 0 && <>
        <p className="bp-eye bp-pad" title={node.kind === 'council' ? plainWord('petition') : undefined}>{node.kind === 'council' ? 'Petitions: chats asking for you' : node.kind === 'pavilion' || node.kind === 'window' ? 'Courtyards' : isPlace(node.kind) ? 'Nearby places' : 'Desks'}</p>
        <ul className="bp-roster">{roster.map(r => <li key={r.id}><button type="button" onClick={() => onPick(r.id)}>
          <b style={{ color: r.kind === 'desk' ? roleColor(r.role, c) : undefined }}>{r.kind === 'desk' ? (node.kind === 'council' ? court.nodes.find(y => y.id === r.parent)?.label : `${r.role ?? 'lead'}${r.model ? ` · ${r.model}` : ''}`) : r.label}</b>
          <span>{r.kind === 'desk' ? (node.kind === 'council' ? r.ask : r.task) ?? SAY[r.state ?? 'idle'] : r.task ?? ''}</span>
          {r.state && <em style={{ color: stateColor(r.state, c) }}>{timer(r, now)}</em>}
        </button></li>)}</ul>
      </>}
    </aside>
  )
}

/** on*: the tool belt's way out to the rest of Switchboard; todoCount and files are its badges. */
export type BoardWays = { onNew?: () => void; onTodo?: () => void; /** The Memory and Flow map views, from the library and the map room. */ onMemory?: () => void; onFlow?: () => void; onLimits?: () => void; onChanges?: () => void; todoCount?: number; files?: number
  /** A courtyard card's Summary fold, as on the chat cards. */
  onSummary?: (sessionId: string, refresh: boolean) => void; onCopy?: (text: string) => Promise<boolean>
  /** The chat open on the other pages, and a chat whose card opened here. */
  chat?: string; onChat?: (sessionId: string) => void }
export function BoardView({ hub, isDemo, send: sendHub, onClose, onNew, onTodo, onLimits, onChanges, todoCount, files, onSummary, onCopy, onMemory, onFlow, chat, onChat }: { hub: HubState; isDemo: boolean; send: Send; onClose: () => void } & BoardWays) {
  // Demo: a sample Learn run so the study hall's Approve and Discard show; deciding it clears it here.
  const [learned, setLearned] = useState<string[]>([])
  const send: Send = m => { if (isDemo && m.type === 'hub-learn') setLearned(l => [...l, m.id]); else sendHub(m) }
  const shown = useMemo(() => {
    const n = isDemo && typeof location !== 'undefined' ? Number(new URLSearchParams(location.search).get('board')) : 0
    const h = isDemo ? withDemoLearn(hub, learned) : hub
    return n > 0 ? scaleHub(h, n) : h
  }, [hub, isDemo, learned])
  const [stage, setStage] = useState<[number, number]>([1280, 800])
  // Memory is not in hub state: read the graph on open, then every minute.
  const [mem, setMem] = useState<GraphHold>()
  useEffect(() => {
    if (isDemo) { setMem({ graph: demoGraph() }); return }
    let stop = false
    const read = () => void loadGraph().then(g => { if (!stop) setMem(m => keepGraph(m, g)) })
    read(); const i = setInterval(() => { if (seen()) read() }, 60_000)
    return () => { stop = true; clearInterval(i) }
  }, [isDemo])
  const court = useMemo(() => buildCourt(shown, { w: stage[0], h: stage[1] }, mem?.graph), [shown, stage, mem?.graph])
  const [mode, setMode] = useState<Mode>('day'), [skinId, setSkinId] = useState('journey-west')
  const skin = useMemo(() => lookOf(skinById(skinId), mode), [skinId, mode])
  const [picked, setPicked] = useState<string>()
  const [sent, setSent] = useState<Record<string, string>>({})
  const canvas = useRef<HTMLCanvasElement>(null), dlg = useRef<HTMLDialogElement>(null)
  const zoomed = useRef(false)
  const st = useRef<St & { fit: boolean; stage: string; wake: () => void; zoom: (dir: number) => void; refit: () => void; show: (id: string, close?: boolean) => void; go: (id: string) => void }>({
    court, kit: kitOf('court'), night: false, ta: 0, view: { x: 0, y: 0, z: 0.5 }, zc: 0.5, colors: skin.court.colors, bands: skin.court.bands, hits: [], fx: new Map(), fit: false, stage: '', ropes: [], ends: new Map(), waits: new Set(),
    wake: () => {}, zoom: () => {}, refit: () => {}, show: () => {}, go: () => {},
  })
  // An open chat card follows the chat opened elsewhere, and a card opened here counts as opening its chat.
  const card = court.nodes.find(n => n.id === picked)
  const cardChat = card && (card.kind === 'courtyard' || card.kind === 'desk') ? chatOf(court, card.id) : undefined
  const lastChat = useRef(chat)
  useEffect(() => {
    const moved = chat !== lastChat.current
    lastChat.current = chat
    if (!cardChat || cardChat === chat) return
    if (moved && court.nodes.some(n => n.id === `yard:${chat}`)) setPicked(`yard:${chat}`)
    else if (!moved) onChat?.(cardChat)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat, cardChat])
  // A sprite tap hops and opens its details; the panel's Open terminal link is the way to the chat.
  const go = (id: string) => {
    const s = st.current
    s.fx.set(id, { kind: 'hop', at: performance.now() }); s.wake()
    setPicked(id)
  }
  useEffect(() => { st.current.go = go })

  useEffect(() => {
    let skin = null, mode = null
    skin = readStore(SKIN_KEY) ?? (readStore(LEGACY_SKIN_KEY) === 'ink' ? 'ink' : null); mode = readStore(MODE_KEY)
    // ?skin=abyss or ?skin=journey-west opens a review link in that theme without saving it.
    const p = readPick(skin, mode, matchMedia('(prefers-color-scheme: dark)').matches, new URLSearchParams(location.search).get('skin'))
    setMode(p.mode); setSkinId(p.id)
  }, [])
  useDialog(dlg)
  // Canvas text does not pull in a web font by itself.
  useEffect(() => {
    let stop = false
    void Promise.all([document.fonts?.load(PIX(8)), document.fonts?.load(SANS(12))]).then(() => { if (!stop) { cuts.clear(); widths.clear(); st.current.wake() } }).catch(() => {})
    return () => { stop = true }
  }, [])
  // The art bakes again only when islands or bridges move; a petition starts its walk when it first shows.
  useEffect(() => {
    const s = st.current, sig = sigOf(court, `${skin.id}.${mode}.${resOf(kitOf(skin.art))}`), ev = courtEvents(s.court, court), at = performance.now()
    for (const m of ev.meet) s.fx.set(m.deskId, { kind: 'meet', at, lead: m.leadId })
    for (const m of ev.move) s.fx.set(`move:${m.yardId}`, { kind: 'move', at, from: m.from, to: m.to })
    for (const id of ev.cheer) s.fx.set(id, { kind: 'cheer', at })
    for (const id of arrivals(s.court, court)) s.fx.set(id, { kind: 'arrive', at })
    s.court = court; s.colors = skin.court.colors; s.chrome = chromeOf(skin); s.bands = skin.court.bands; s.kit = kitOf(skin.art); s.night = mode === 'night'
    if (court.nodes.length && s.frame?.sig !== sig) s.frame = bake(court, s.colors, sig, s.kit)
    const id = court.petition?.deskId
    if (id !== s.pet?.id) s.pet = id ? { id, at: performance.now() } : undefined
    if (s.stage !== `${stage}`) { s.stage = `${stage}`; s.fit = false }
    s.wake()
  }, [court, skin, mode, stage])
  useEffect(() => { st.current.picked = picked; st.current.wake() }, [picked])
  // A wait that ends flashes its rope once; a pause that clears thaws before it goes.
  useEffect(() => {
    const s = st.current, next = ropesOf(shown.links), at = performance.now()
    for (const r of endedRopes(s.ropes, next)) s.ends.set(r.key, { r, at })
    for (const r of next) s.ends.delete(r.key)
    s.ropes = next; s.waits = new Set(shown.links?.map(l => l.from))
    Object.assign(s, nextPause(s, shown.pause, at))
    s.wake()
  }, [shown.links, shown.pause])

  useEffect(() => {
    const el = canvas.current!, g = el.getContext('2d')!, s = st.current
    const motion = matchMedia('(prefers-reduced-motion: reduce)')
    let W = 0, H = 0, dpr = 1, onScreen = true, tick = 0
    const t0 = performance.now()
    // Whole device pixels per art pixel once zoomed in; quarter steps below one so the whole court still fits.
    // The baked frame's res, or the kit's before the first bake.
    const res = () => s.frame?.res ?? resOf(s.kit)
    const snap = (z: number, down = false) => {
      // Smooth kits keep the zoom continuous, within the same clamps.
      if (s.kit.smooth) return Math.min(Math.max(z, 1 / (16 * dpr * res())), MAX_Z)
      const k = z * dpr * res(), r = down ? Math.floor : Math.round
      // Whole art pixels from 1 up; sixteenths below, so a low Fit zoom is not cut by up to a quarter.
      return Math.min(k >= 1 ? r(k) : Math.max(1 / 16, r(k * 16) / 16), Math.floor(MAX_Z * dpr * res())) / (dpr * res())
    }
    const setZ = (nz: number, cx: number, cy: number) => { const v = s.view; v.x = cx - ((cx - v.x) * nz) / v.z; v.y = cy - ((cy - v.y) * nz) / v.z; v.z = nz }
    const fit = () => {
      if (!s.frame) return
      // Fit in the sky the tool belt and legend leave free: a tall belt takes the left edge, wide bars the bottom.
      const stage = el.getBoundingClientRect(), cw = W / dpr, ch = H / dpr
      // The open card panel docks right on desktop, at the bottom on a phone.
      let l = 0, b = 0, rt = 0
      for (const o of el.parentElement?.querySelectorAll('.bt, .board-legend, .bp') ?? []) {
        const r = o.getBoundingClientRect()
        if (!r.width) continue
        if (o.classList.contains('bp')) { if (r.left - stage.left > cw / 3) rt = Math.max(rt, stage.right - r.left); else b = Math.max(b, stage.bottom - r.top) }
        else if (r.height > r.width && r.left - stage.left < cw / 3) l = Math.max(l, r.right - stage.left)
        else if (r.top - stage.top > ch / 3) b = Math.max(b, stage.bottom - r.top)
      }
      s.inset = [l, b, rt]
      const f = fitCourt(s.court, cw - l - rt, ch - b), z = snap(f.zoom, true)
      // Center on the box Fit framed (plaques in), not the baked art.
      s.view = { z, x: l + (cw - l - rt) / 2 - (f.cx - s.frame.ox) * z, y: f.sy - (f.cy - s.frame.oy) * z }
      s.zc = z
    }
    // After a needs-you jump the camera eases after the walker until it arrives, the panel closes, or the user moves the view.
    let following = false, lastFollow = 0
    const follow = (now: number) => {
      const walk = s.picked === s.court.petition?.deskId ? walker(s.court, s.pet, now, motion.matches) : undefined
      if (!walk?.[2] || !s.frame) { following = false; return }
      // 12% of the gap per 60 Hz frame, scaled by elapsed time so 120 Hz screens ease the same.
      const dt = Math.min(100, lastFollow ? now - lastFollow : 1000 / 60), k = 1 - Math.pow(0.88, dt * 0.06)
      lastFollow = now
      const [vw, vh] = area(), z = s.view.z
      s.view.x += (vw / 2 - (s.view.x + (walk[0] - s.frame.ox) * z)) * k
      s.view.y += (vh / 2 - (s.view.y + (walk[1] - s.frame.oy) * z)) * k
    }
    const frame = (now: number) => {
      if (!W || !H) return
      if (following) follow(now)
      if (!s.fit && s.frame) { fit(); s.fit = true }
      const t = motion.matches ? 0 : (now - t0) / 1000
      if (!t || live()) s.ta = t
      draw(s, g, W, H, dpr, t, now, Date.now())
    }
    const fading = () => s.ends.size > 0 || s.thaw !== undefined
    const awake = () => ropesBusy(s.ropes, s.view.z, [s.hover, s.over, s.picked].map(id => id ? chatOf(s.court, id) : undefined))
    const live = () => fading() || awake() || s.fx.size > 0 || s.court.nodes.some(n => n.state === 'working' || n.state === 'needs')
    // Runs while something moves and can be seen; reduced motion still ticks once a second for the timers, and runs a fade through.
    const run = () => (!motion.matches || fading()) && onScreen && !document.hidden && vscodeBridge?.shown !== false && live()
    // 30 fps focused, 15 fps unfocused; a drag, zoom or hover draws its own frame.
    const { wake, stop, running } = frameLoop(now => frame(now), run, () => document.hasFocus() ? 30 : 63)
    s.wake = wake
    // Once a second also lifts the Zzz of idle sprites, so a quiet board needs no rAF.
    tick = window.setInterval(() => { if (!running() && onScreen && seen() && (live() || !!s.pause || s.court.nodes.some(n => n.kind === 'desk' && n.state === 'idle'))) frame(performance.now()) }, 1000)
    const size = () => {
      const r = el.getBoundingClientRect()
      dpr = Math.min(matchMedia('(pointer: coarse)').matches ? COARSE_DPR : MAX_DPR, devicePixelRatio || 1)
      W = Math.round(r.width * dpr); H = Math.round(r.height * dpr)
      if (el.width !== W || el.height !== H) { el.width = W; el.height = H }
      setStage(cur => { const nx = Math.round(r.width / 40) * 40, ny = Math.round(r.height / 40) * 40; return cur[0] === nx && cur[1] === ny ? cur : [nx, ny] })
      frame(performance.now())
    }
    const zoomAt = (cx: number, cy: number, f: number) => {
      s.zc = Math.min(MAX_Z, Math.max(0.25 / (dpr * res()), s.zc * f))
      const nz = snap(s.zc)
      if (nz !== s.view.z) setZ(nz, cx, cy)
    }
    s.zoom = dir => {
      following = false
      const k = s.view.z * dpr * res(), nk = dir > 0 ? (k >= 1 ? Math.floor(k) + 1 : k * 2) : k > 1 ? Math.ceil(k) - 1 : k / 2, nz = snap(nk / (dpr * res()))
      setZ(nz, W / dpr / 2, H / dpr / 2); s.zc = nz; frame(performance.now())
    }
    s.refit = () => { following = false; fit(); frame(performance.now()) }
    // Keyboard focus or a roster pick brings the node on screen.
    // The open panel hides part of the stage: left of a side panel, above a bottom sheet.
    const area = () => {
      const bp = el.parentElement?.querySelector('.bp')?.getBoundingClientRect(), stage = el.getBoundingClientRect()
      if (!bp) return [W / dpr, H / dpr]
      return bp.width < stage.width * 0.7 ? [bp.left - stage.left, H / dpr] : [W / dpr, bp.top - stage.top]
    }
    s.show = (id, close) => {
      const n = s.court.nodes.find(m => m.id === id), F = s.frame
      if (!n || !F) return
      const [vw, vh] = area()
      // The petitioning lead may be out on the road; aim at where it is now.
      const walk = id === s.court.petition?.deskId ? walker(s.court, s.pet, performance.now(), motion.matches) : undefined
      const wx = walk ? walk[0] : n.x + n.w / 2, wy = walk ? walk[1] : n.y + n.h / 2
      if (close && s.view.z < 1) { s.view.z = s.zc = snap(1) }
      const z = s.view.z, x = s.view.x + (wx - F.ox) * z, y = s.view.y + (wy - F.oy) * z
      if (close || x < 40 || y < 40 || x > vw - 40 || y > vh - 40) { s.view.x += vw / 2 - x; s.view.y += vh / 2 - y }
      // Still on the road: keep it in view until it arrives.
      following = !!(close && walk?.[2]); lastFollow = 0
      frame(performance.now())
    }
    const pts = new Map<number, { x: number; y: number }>()
    let travel = 0
    const local = (e: PointerEvent | WheelEvent) => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }
    const coarse = matchMedia('(pointer: coarse)')
    const hitAt = (q: { x: number; y: number }) => pickHit(s.hits, q, coarse.matches ? 44 : 0)
    const down = (e: PointerEvent) => { following = false; el.setPointerCapture(e.pointerId); pts.set(e.pointerId, local(e)); travel = 0 }
    const move = (e: PointerEvent) => {
      const prev = pts.get(e.pointerId)
      if (!prev) {
        if (e.pointerType !== 'mouse') return
        const id = hitAt(local(e)), hov = id?.startsWith('spr:') ? id.slice(4) : undefined
        el.style.cursor = id ? 'pointer' : ''
        const over = id?.replace(/^spr:/, '')
        if (over !== s.over) { s.over = over; if (s.ropes.length && hov === s.hover) frame(performance.now()) }
        if (hov !== s.hover) { s.hover = hov; frame(performance.now()) }
        return
      }
      const cur = local(e)
      if (pts.size === 1) { s.view.x += cur.x - prev.x; s.view.y += cur.y - prev.y }
      else {
        const [a, b] = [...pts.entries()].map(([id, p]) => (id === e.pointerId ? cur : p)), [a0, b0] = [...pts.values()]
        const d0 = Math.hypot(a0.x - b0.x, a0.y - b0.y), d1 = Math.hypot(a.x - b.x, a.y - b.y)
        if (d0 > 0) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d1 / d0)
      }
      travel += Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y)
      pts.set(e.pointerId, cur)
      frame(performance.now())
    }
    const up = (e: PointerEvent) => {
      const p = pts.get(e.pointerId)
      pts.delete(e.pointerId)
      if (!p || travel > 6 || pts.size || e.type === 'pointercancel') return
      const id = hitAt(p)
      if (id?.startsWith('spr:')) s.go(id.slice(4)); else setPicked(id)
    }
    const leave = () => { s.over = undefined; if (s.hover) { s.hover = undefined; el.style.cursor = ''; frame(performance.now()) } }
    const wheel = (e: WheelEvent) => { following = false; e.preventDefault(); const p = local(e); zoomAt(p.x, p.y, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002))); frame(performance.now()) }
    el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('pointerleave', leave)
    el.addEventListener('wheel', wheel, { passive: false })
    const ro = new ResizeObserver(size); ro.observe(el)
    const io = new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; wake() }); io.observe(el)
    motion.addEventListener('change', wake); document.addEventListener('visibilitychange', wake)
    const offShown = vscodeBridge?.onShown(wake)
    return () => {
      stop(); clearInterval(tick); ro.disconnect(); io.disconnect()
      motion.removeEventListener('change', wake); document.removeEventListener('visibilitychange', wake); offShown?.()
      el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); el.removeEventListener('pointerleave', leave)
      el.removeEventListener('wheel', wheel); clearTimeout(s.detailT)
    }
  }, [])

  // Day and night crossfade; the second frame lets the canvas repaint before the new snapshot.
  const fade = (swap: () => void) => {
    const vt = (document as Document & { startViewTransition?: (f: () => Promise<void>) => unknown }).startViewTransition
    if (!vt || matchMedia('(prefers-reduced-motion: reduce)').matches) return swap()
    vt.call(document, () => new Promise<void>(done => { flushSync(swap); requestAnimationFrame(() => requestAnimationFrame(() => done())) }))
  }
  const flip = () => { const next: Mode = mode === 'night' ? 'day' : 'night'; fade(() => { setMode(next); writeStore(MODE_KEY, next) }) }
  // The belt's theme menu picks a skin with the same crossfade.
  const reskin = (id: string) => { if (id !== skinId) fade(() => { setSkinId(id); writeStore(SKIN_KEY, id) }) }
  // Aimed after the panel renders, so its size is known.
  const open = (id: string, close?: boolean) => { zoomed.current = !!close; setPicked(id); requestAnimationFrame(() => st.current.show(id, close)) }
  // Closing a card that zoomed in puts the board back to the fit view.
  const unpick = () => { setPicked(undefined); if (zoomed.current) { zoomed.current = false; st.current.refit() } }
  const answer = (sessionId: string, ask: Ask, choice: Choice, said: string) => { send({ type: 'hub-answer', sessionId, askId: ask.id, choice }); setSent(m => ({ ...m, [ask.id]: said })) }
  const desks = court.nodes.filter(n => n.kind === 'desk'), yards = court.nodes.filter(n => n.kind === 'courtyard')
  // Header counts chats, the same unit as its chats total.
  const shared = hubCounts(hub)
  const needs = court.petition?.deskId
  const note = !yards.length ? skin.copy.empty : desks.length && desks.every(d => d.state === 'done') ? skin.copy.done : undefined
  const node = picked ? court.nodes.find(n => n.id === picked) : undefined
  // A realm desk reads as its chat, then the realm: "Outfit picker copy, Codex realm".
  const deskWhere = (d: CourtNode) => { const up = court.nodes.find(y => y.id === d.parent); return up?.kind === 'realm' ? `${court.nodes.find(y => y.id === up.parent)?.label ?? ''}, ${aiName(up.ai)} realm` : up?.label ?? '' }
  const c = skin.court.colors
  return (
    <dialog ref={dlg} className="hub hub-dark board" aria-label="Agents" style={{ '--b-bg': skin.court.bands[0], '--b-ink': skin.palette.ink, '--b-font': skin.font, '--b-hot': c.red_lt, '--b-gold': c.gold, ...(skin.chrome && chromeVars(skin.chrome)) } as React.CSSProperties}
      // Esc is handled on keydown: Chrome only lets a dialog cancel be stopped once per user activation.
      onCancel={e => { e.preventDefault(); if (picked) unpick(); else onClose() }}
      onKeyDown={e => {
        if (e.key === 'Escape') {
          e.preventDefault()
          // Cast list first, then the card, then the board.
          const cast = (e.currentTarget as HTMLElement).querySelector<HTMLDetailsElement>('.board-cast details[open]')
          if (cast) { cast.open = false; cast.querySelector('summary')?.focus() } else if (picked) unpick(); else onClose()
          return
        }
        if ((e.target as HTMLElement).closest?.('input, select')) return; if (e.key === '+' || e.key === '=') st.current.zoom(1); else if (e.key === '-') st.current.zoom(-1); else if (e.key === '0') st.current.refit() }}>
      <header className="board-head">
        <h2>Agents</h2>
        <span className="board-sub" title={plainWord('court')}>{skin.copy.title}</span>
        <span className="board-plain">{plainWord('court')}</span>
        <span className="board-meta"><b>{shared.working}</b> working <b>{shared.done}</b> done today <b>{yards.length}</b> chats{shared.needs > 0 && !needs && <> <b>{shared.needs}</b> need you</>}</span>
        {needs && shared.needs > 0 && <button type="button" className="hub-btn board-need" aria-label={`${shared.needs} needs you`} onClick={() => open(needs, true)}><i aria-hidden />{shared.needs}<span className="board-need-word"> needs you</span></button>}
        <span className="board-zoom" role="group" aria-label="Zoom">
          {/* Same order as the Code map's controls: in, out, fit. */}
          <button type="button" className="hub-btn board-z" aria-label="Zoom in" aria-keyshortcuts="+" title="Zoom in (+)" onClick={() => st.current.zoom(1)}>+</button>
          <button type="button" className="hub-btn board-z" aria-label="Zoom out" aria-keyshortcuts="-" title="Zoom out (-)" onClick={() => st.current.zoom(-1)}>-</button>
          <button type="button" className="hub-btn board-fit" aria-label="Fit board" aria-keyshortcuts="0" title="Fit board (0)" onClick={() => st.current.refit()}>Fit</button>
        </span>
      </header>
      <div className="board-stage">
        <canvas ref={canvas} className="board-canvas" aria-hidden />
        {note && <p className="board-note">{note}</p>}
        <BoardTools skin={skin} night={mode === 'night'} theme={{ pick: reskin }} counts={{ ...beltCounts(shown), next: yards.filter(y => y.state === 'needs').length, todo: todoCount, todoAll: court.nodes.find(n => n.kind === 'notice')?.list?.length, changes: files }}
          on={{ new: onNew, next: () => { if (needs) { open(needs, true); go(needs) } }, todo: onTodo, limits: onLimits, changes: onChanges, mode: flip }} />
        <ul className="board-legend" aria-label="Legend">
          {LEGEND.map(([k, word]) => <li key={k}><i style={{ background: stateColor(k, c) }} />{word}</li>)}
          <li className="board-cast"><details>
            <summary>Cast</summary>
            <dl aria-label="Cast">
              {Object.entries(ROLE_KEY).map(([r, [k]]) => <div key={r}><dt style={{ color: `color-mix(in srgb, ${c[k]} 55%, #fff)` }}>{castOf(r, kitOf(skin.art).cast).name}</dt><dd>{r === 'pilgrim' ? 'any other role' : r}</dd></div>)}
              {(['claude', 'codex', 'kenneth'] as const).map(k => <div key={k}><dt>{ICONS[k].name}</dt><dd>{k === 'kenneth' ? 'you' : aiName(k)}</dd></div>)}
              {LEGEND.map(([k, word]) => badgeOf(k) && <div key={k}><dt>{badgeOf(k)!.name}</dt><dd>{word.toLowerCase()}</dd></div>)}
            </dl>
          </details></li>
        </ul>
        {/* The canvas for screen readers and keys: one button per island and desk; click or Enter opens its panel. */}
        <ul className="sr-only">
          {court.nodes.map(n => (
            <li key={n.id}><button type="button" onClick={() => (n.kind === 'desk' ? go(n.id) : open(n.id))}>
              {KINDS[n.kind]}: {n.kind === 'desk' ? `${n.role ?? 'lead'}, ${deskWhere(n)}` : n.label}
              {n.state ? `, ${SAY[n.state]}` : ''}{n.task ? `, ${n.task}` : ''}{n.raise ? `, ${n.raise}` : ''}{n.ask ? `, asks: ${n.ask}` : ''}
            </button></li>
          ))}
        </ul>
        {node && <Panel key={node.id} node={node} court={court} hub={shown} shared={shared} colors={c} cast={kitOf(skin.art).cast} sent={sent} onPick={open} onAnswer={answer} onClose={unpick} onSummary={onSummary} onCopy={onCopy} mem={mem} send={send} ways={{ onMemory, onFlow, onTodo }} />}
      </div>
    </dialog>
  )
}
