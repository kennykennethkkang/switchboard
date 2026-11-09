/** The golden carp king (Great King of Spiritual Efficacy) and Guanyin's basket, as pixel rows.
 * One char per pixel, '.' is empty; pal maps chars to colors. Every helper rings the art in ink, one pixel out. */
export const CARP = ['......y.y.....', '.....yyyyy....', '....rgggg..rr.', '..gggGgggg.rrr', '.gwkgggGgggrr.', '.ggggggggGgrr.', '..gggGgggg.rrr', '....rgggg..rr.', '.....r..r.....']
export const BASKET = ['....bbbbbb....', '...b......b...', '..b........b..', 'BBBBBBBBBBBBBB', 'BwBwBwBwBwBwBB', '.BwBwBwBwBwBB.', '..BBBBBBBBBB..']
export type Pal = Record<string, string>
// Journey West day colors.
export const INK = '#1a1423'
export const CARP_PAL: Pal = { y: '#f8d96a', g: '#e8a92a', G: '#a5621a', r: '#cf3f33', w: '#fffaf0', k: INK }
export const BASKET_PAL: Pal = { b: '#5a3a2a', B: '#93503a', w: '#b86e48' }

/** Colors per pixel, padded by one with the ink ring; undefined is clear. */
export function pixGrid(rows: string[], pal: Pal, ink = INK): Array<Array<string | undefined>> {
  const W = rows[0].length + 2, H = rows.length + 2, at = (x: number, y: number) => pal[rows[y - 1]?.[x - 1] ?? '.']
  return Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) =>
    at(x, y) ?? ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => at(x + dx, y + dy)) ? ink : undefined)))
}

/** A canvas at scale device px per art px. Browser only. */
export function pixCanvas(rows: string[], pal: Pal, scale = 1, ink = INK) {
  const grid = pixGrid(rows, pal, ink), cv = document.createElement('canvas'), g = cv.getContext('2d')!
  cv.width = grid[0].length * scale; cv.height = grid.length * scale
  grid.forEach((r, y) => r.forEach((col, x) => { if (col) { g.fillStyle = col; g.fillRect(x * scale, y * scale, scale, scale) } }))
  return cv
}

export function pixSvg(rows: string[], pal: Pal, scale = 1, ink = INK) {
  const grid = pixGrid(rows, pal, ink), w = grid[0].length, h = grid.length
  const px = grid.flatMap((r, y) => r.map((col, x) => col ? `<rect x="${x}" y="${y}" width="1" height="1" fill="${col}"/>` : '')).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w * scale}" height="${h * scale}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges">${px}</svg>`
}

export const carpSvg = (scale = 3, pal = CARP_PAL) => pixSvg(CARP, pal, scale)
export const basketSvg = (scale = 3, pal = BASKET_PAL) => pixSvg(BASKET, pal, scale)
/** For an <img src> or a CSS url(). */
export const svgUrl = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`
